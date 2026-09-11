// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TransientStateLibrary } from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @notice Immutable V4 routes for converting a collected quote fee into native Core claims.
/// @dev The fixed 5% loss bound includes external pool fees and execution impact. Its reference is
///      the route's spot state at conversion entry, not an independent oracle or an MEV guarantee.
library AnyQuoteNativeFeeRouteV1 {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;

    uint256 internal constant MAX_HOPS = 4;
    uint256 internal constant MAX_HOOK_DATA_BYTES = 2048;
    uint256 internal constant MAX_AMOUNT = uint256(uint128(type(int128).max));
    uint256 internal constant MIN_RETAINED_BPS = 9500;

    struct FeeHop {
        PoolKey key;
        bool zeroForOne;
        bytes hookData;
    }

    struct StoredHop {
        FeeHop hop;
        bytes32 hookCodeHash;
        bytes32 inputCodeHash;
        bytes32 outputCodeHash;
    }

    struct Route {
        bytes32 hash;
        StoredHop[] hops;
    }

    struct Conversion {
        uint160[] prices;
        int256[] entryDeltas;
        uint256 minimumNative;
    }

    error InvalidNativeFeeRoute();
    error NativeFeeRouteChanged();
    error NativeFeeMarketUnavailable();
    error NativeFeeAmountTooSmall();
    error NativeFeePartialFill();
    error NativeFeeSlippage();
    error NativeFeeDeltaMismatch();

    function bind(Route storage route, IPoolManager manager, address quote, address token, FeeHop[] memory hops)
        internal
        returns (bytes32 routeHash)
    {
        if (route.hash != bytes32(0) || hops.length == 0 || hops.length > MAX_HOPS) revert InvalidNativeFeeRoute();
        address[] memory currencies = new address[](hops.length + 1);
        bytes32[] memory pools = new bytes32[](hops.length);
        currencies[0] = quote;
        for (uint256 i; i < hops.length; ++i) {
            FeeHop memory hop = hops[i];
            address input = Currency.unwrap(hop.zeroForOne ? hop.key.currency0 : hop.key.currency1);
            address output = Currency.unwrap(hop.zeroForOne ? hop.key.currency1 : hop.key.currency0);
            if (
                input != currencies[i] || input == token || output == token
                    || Currency.unwrap(hop.key.currency0) >= Currency.unwrap(hop.key.currency1)
                    || hop.key.tickSpacing <= 0 || hop.key.tickSpacing > type(int16).max
                    || address(hop.key.hooks) == address(this) || hop.hookData.length > MAX_HOOK_DATA_BYTES
                    || (output == address(0) && i + 1 != hops.length)
            ) revert InvalidNativeFeeRoute();
            for (uint256 j; j <= i; ++j) {
                if (output == currencies[j]) revert InvalidNativeFeeRoute();
            }
            bytes32 poolId = PoolId.unwrap(hop.key.toId());
            for (uint256 j; j < i; ++j) {
                if (pools[j] == poolId) revert InvalidNativeFeeRoute();
            }
            _market(manager, hop.key);
            route.hops.push();
            StoredHop storage stored = route.hops[i];
            stored.hop = hop;
            stored.hookCodeHash = _codeHash(address(hop.key.hooks));
            stored.inputCodeHash = _codeHash(input);
            stored.outputCodeHash = _codeHash(output);
            currencies[i + 1] = output;
            pools[i] = poolId;
        }
        if (currencies[hops.length] != address(0)) revert InvalidNativeFeeRoute();
        routeHash = keccak256(abi.encode(hops));
        route.hash = routeHash;
    }

    function read(Route storage route) internal view returns (FeeHop[] memory result) {
        result = new FeeHop[](route.hops.length);
        for (uint256 i; i < result.length; ++i) {
            result[i] = route.hops[i].hop;
        }
    }

    /// @dev Called during the outer pool's afterSwap. Inner quote debt is balanced by the outer
    ///      returned hook delta only after this function returns. No physical assets move here.
    function convertAndMint(Route storage route, IPoolManager manager, address ledger, uint256 quoteAmount)
        internal
        returns (uint256 nativeAmount)
    {
        if (quoteAmount == 0 || quoteAmount > MAX_AMOUNT) revert NativeFeeAmountTooSmall();
        Conversion memory conversion = _prepare(route, manager, quoteAmount);
        nativeAmount = quoteAmount;
        for (uint256 i; i < route.hops.length; ++i) {
            StoredHop storage stored = route.hops[i];
            _checkCode(stored);
            FeeHop storage hop = stored.hop;
            BalanceDelta delta = manager.swap(
                hop.key,
                SwapParams(hop.zeroForOne, -int256(nativeAmount), _limit(conversion.prices[i], hop.zeroForOne)),
                hop.hookData
            );
            int128 input = hop.zeroForOne ? delta.amount0() : delta.amount1();
            int128 output = hop.zeroForOne ? delta.amount1() : delta.amount0();
            if (input >= 0 || uint256(-int256(input)) != nativeAmount) revert NativeFeePartialFill();
            if (output <= 0) revert NativeFeeAmountTooSmall();
            nativeAmount = uint256(int256(output));
        }
        if (nativeAmount < conversion.minimumNative) revert NativeFeeSlippage();
        manager.mint(ledger, 0, nativeAmount);
        _assertDeltas(route, manager, conversion.entryDeltas, quoteAmount);
    }

    function _prepare(Route storage route, IPoolManager manager, uint256 quoteAmount)
        private
        view
        returns (Conversion memory result)
    {
        uint256 length = route.hops.length;
        if (length == 0) revert InvalidNativeFeeRoute();
        result.prices = new uint160[](length);
        result.entryDeltas = new int256[](length + 1);
        uint256 spotAmount = quoteAmount;
        for (uint256 i; i < length; ++i) {
            StoredHop storage stored = route.hops[i];
            _checkCode(stored);
            FeeHop storage hop = stored.hop;
            uint160 price = _market(manager, hop.key);
            result.prices[i] = price;
            spotAmount = _spotOutput(spotAmount, price, hop.zeroForOne);
            Currency input = hop.zeroForOne ? hop.key.currency0 : hop.key.currency1;
            result.entryDeltas[i] = manager.currencyDelta(address(this), input);
        }
        result.entryDeltas[length] = manager.currencyDelta(address(this), Currency.wrap(address(0)));
        result.minimumNative = FullMath.mulDivRoundingUp(spotAmount, MIN_RETAINED_BPS, 10_000);
        if (result.minimumNative == 0) result.minimumNative = 1;
    }

    function _assertDeltas(Route storage route, IPoolManager manager, int256[] memory entry, uint256 quoteAmount)
        private
        view
    {
        for (uint256 i; i < route.hops.length; ++i) {
            StoredHop storage stored = route.hops[i];
            _checkCode(stored);
            FeeHop storage hop = stored.hop;
            Currency input = hop.zeroForOne ? hop.key.currency0 : hop.key.currency1;
            int256 expected = entry[i] - (i == 0 ? int256(quoteAmount) : int256(0));
            if (manager.currencyDelta(address(this), input) != expected) revert NativeFeeDeltaMismatch();
        }
        if (manager.currencyDelta(address(this), Currency.wrap(address(0))) != entry[route.hops.length]) {
            revert NativeFeeDeltaMismatch();
        }
    }

    function _spotOutput(uint256 amount, uint160 sqrtPrice, bool input0) private pure returns (uint256) {
        uint256 sqrt = uint256(sqrtPrice);
        if (sqrt <= type(uint128).max) {
            uint256 ratioX192 = sqrt * sqrt;
            return input0
                ? FullMath.mulDivRoundingUp(amount, ratioX192, 1 << 192)
                : FullMath.mulDivRoundingUp(amount, 1 << 192, ratioX192);
        }
        uint256 ratioX128 = FullMath.mulDiv(sqrt, sqrt, 1 << 64);
        return input0
            ? FullMath.mulDivRoundingUp(amount, ratioX128, 1 << 128)
            : FullMath.mulDivRoundingUp(amount, 1 << 128, ratioX128);
    }

    function _limit(uint160 price, bool zeroForOne) private pure returns (uint160) {
        // A bounded marginal-price move; the stricter whole-route output floor includes all fees.
        uint256 limit = zeroForOne
            ? FullMath.mulDiv(uint256(price), MIN_RETAINED_BPS, 10_000)
            : FullMath.mulDiv(uint256(price), 10_000, MIN_RETAINED_BPS);
        if (limit <= TickMath.MIN_SQRT_PRICE) return TickMath.MIN_SQRT_PRICE + 1;
        if (limit >= TickMath.MAX_SQRT_PRICE) return TickMath.MAX_SQRT_PRICE - 1;
        return uint160(limit);
    }

    function _market(IPoolManager manager, PoolKey memory key) private view returns (uint160 price) {
        (price,,,) = manager.getSlot0(key.toId());
        if (
            price <= TickMath.MIN_SQRT_PRICE || price >= TickMath.MAX_SQRT_PRICE
                || manager.getLiquidity(key.toId()) == 0
        ) {
            revert NativeFeeMarketUnavailable();
        }
    }

    function _codeHash(address target) private view returns (bytes32) {
        if (target == address(0)) return bytes32(0);
        if (target.code.length == 0) revert InvalidNativeFeeRoute();
        return target.codehash;
    }

    function _checkCode(StoredHop storage stored) private view {
        FeeHop storage hop = stored.hop;
        address input = Currency.unwrap(hop.zeroForOne ? hop.key.currency0 : hop.key.currency1);
        address output = Currency.unwrap(hop.zeroForOne ? hop.key.currency1 : hop.key.currency0);
        if (
            _codeHash(address(hop.key.hooks)) != stored.hookCodeHash || _codeHash(input) != stored.inputCodeHash
                || _codeHash(output) != stored.outputCodeHash
        ) revert NativeFeeRouteChanged();
    }
}
