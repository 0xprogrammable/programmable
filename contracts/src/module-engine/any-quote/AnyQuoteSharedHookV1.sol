// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary,
    toBeforeSwapDelta
} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";

import { AnyQuoteTypesV1 as A } from "./AnyQuoteTypesV1.sol";
import { AnyQuoteFeeMathV1 as F } from "./AnyQuoteFeeMathV1.sol";
import { AnyQuoteLedgerV1 } from "./AnyQuoteLedgerV1.sol";
import { IAnyQuoteLedgerV1 } from "./IAnyQuoteLedgerV1.sol";
import { IAnyQuoteSharedHookV1 } from "./IAnyQuoteSharedHookV1.sol";

/// @notice One immutable V4 fee hook shared by the reviewed Any Quote module's launches.
/// @dev Only the host can register pools. Swaps need no privileged router or hook data. Fees stay as
///      PoolManager ERC-6909 claims until separately claimed; the hook never calls PoolManager.swap.
contract AnyQuoteSharedHookV1 is BaseHook, IAnyQuoteSharedHookV1, ReentrancyGuardTransient {
    using PoolIdLibrary for PoolKey;

    uint256 private constant MAX_AMOUNT = uint256(uint128(type(int128).max));

    address public immutable override host;
    address public immutable override ledger;
    mapping(bytes32 poolId => A.PoolRegistration registration) private _pools;
    mapping(bytes32 launchId => bytes32 poolId) public poolIdOfLaunch;
    mapping(bytes32 poolId => mapping(bool buy => F.Carry)) public feeCarry;

    struct Settlement {
        bool buy;
        bool exactInput;
        bool quoteSpecified;
        uint256 gross;
        uint256 fee;
        F.Result fees;
    }

    error InvalidInfrastructure();
    error UnauthorizedHost();
    error InvalidRegistration();
    error AlreadyRegistered();
    error PoolNotRegistered();
    error InvalidInitialization();
    error InvalidSwap();
    error InvalidSettlement();
    error PartialFillUnsupported();

    event SharedQuotePoolBound(
        bytes32 indexed poolId,
        bytes32 indexed launchId,
        address indexed token,
        address quoteAsset,
        address engine,
        bytes32 revisionId,
        bytes32 familyId,
        bytes32 configurationHash,
        int24 initialTick,
        uint16 buyCreatorFeeBps,
        uint16 sellCreatorFeeBps
    );
    event QuotePoolSwap(
        bytes32 indexed poolId,
        bytes32 indexed launchId,
        address indexed swapSender,
        bool buy,
        bool exactInput,
        uint256 grossQuote,
        uint256 platformQuote,
        uint256 creatorQuote,
        int128 coreAmount0,
        int128 coreAmount1
    );

    constructor(IPoolManager manager, address host_, address rewardAdmin) BaseHook(manager) {
        if (
            block.chainid != A.CHAIN_ID || address(manager).code.length == 0 || host_ == address(0)
                || host_ == address(manager) || host_ == address(this) || rewardAdmin == address(0)
        ) revert InvalidInfrastructure();
        // The host creates the hook from its constructor, so host code need not exist yet.
        host = host_;
        ledger = address(new AnyQuoteLedgerV1(manager, host_, rewardAdmin));
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory permissions) {
        permissions.beforeInitialize = true;
        permissions.beforeSwap = true;
        permissions.afterSwap = true;
        permissions.beforeSwapReturnDelta = true;
        permissions.afterSwapReturnDelta = true;
    }

    function registerPool(
        A.PoolRegistration calldata registration,
        address[] calldata creatorWallets,
        uint16[] calldata creatorSharesBps
    ) external override nonReentrant returns (bytes32 poolId) {
        if (msg.sender != host) revert UnauthorizedHost();
        _validateRegistration(registration);
        poolId = PoolId.unwrap(_key(registration).toId());
        if (_pools[poolId].launchId != bytes32(0) || poolIdOfLaunch[registration.launchId] != bytes32(0)) {
            revert AlreadyRegistered();
        }
        _pools[poolId] = registration;
        poolIdOfLaunch[registration.launchId] = poolId;
        IAnyQuoteLedgerV1(ledger)
            .registerLaunch(registration.launchId, registration.quoteAsset, creatorWallets, creatorSharesBps);
        _emitRegistration(poolId, registration);
    }

    function _emitRegistration(bytes32 poolId, A.PoolRegistration calldata registration) private {
        emit SharedQuotePoolBound(
            poolId,
            registration.launchId,
            registration.token,
            registration.quoteAsset,
            registration.initializer,
            registration.revisionId,
            registration.familyId,
            registration.configurationHash,
            registration.initialTick,
            registration.buyCreatorFeeBps,
            registration.sellCreatorFeeBps
        );
    }

    function poolKey(bytes32 poolId) external view override returns (PoolKey memory) {
        return _key(_registered(poolId));
    }

    function poolConfig(bytes32 poolId) external view override returns (A.PoolRegistration memory) {
        return _registered(poolId);
    }

    function previewGrossFees(bytes32 poolId, bool buy, uint256 grossQuote)
        external
        view
        override
        returns (uint256 platformQuote, uint256 creatorQuote, uint16 nextPlatformRemainder, uint16 nextCreatorRemainder)
    {
        A.PoolRegistration storage config = _registered(poolId);
        F.Result memory result = F.quoteGross(grossQuote, _creatorBps(config, buy), feeCarry[poolId][buy]);
        return (result.platform, result.creator, result.next.platform, result.next.creator);
    }

    function previewNetFees(bytes32 poolId, bool buy, uint256 netQuote)
        external
        view
        override
        returns (
            uint256 grossQuote,
            uint256 platformQuote,
            uint256 creatorQuote,
            uint16 nextPlatformRemainder,
            uint16 nextCreatorRemainder
        )
    {
        A.PoolRegistration storage config = _registered(poolId);
        F.Result memory result;
        (grossQuote, result) = F.quoteNet(netQuote, _creatorBps(config, buy), feeCarry[poolId][buy]);
        return (grossQuote, result.platform, result.creator, result.next.platform, result.next.creator);
    }

    function _beforeInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96)
        internal
        view
        override
        returns (bytes4)
    {
        A.PoolRegistration storage config = _registered(PoolId.unwrap(key.toId()));
        if (sender != config.initializer || sqrtPriceX96 != TickMath.getSqrtPriceAtTick(config.initialTick)) {
            revert InvalidInitialization();
        }
        return IHooks.beforeInitialize.selector;
    }

    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        view
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        bytes32 poolId = PoolId.unwrap(key.toId());
        A.PoolRegistration storage config = _registered(poolId);
        uint256 specified = _specifiedAmount(params.amountSpecified);
        bool quote0 = config.quoteAsset < config.token;
        if ((params.zeroForOne == (params.amountSpecified < 0)) != quote0) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }
        bool buy = params.zeroForOne == quote0;
        F.Result memory result;
        uint256 gross = specified;
        if (buy) result = F.quoteGross(gross, config.buyCreatorFeeBps, feeCarry[poolId][buy]);
        else (gross, result) = F.quoteNet(specified, config.sellCreatorFeeBps, feeCarry[poolId][buy]);
        uint256 fee = _checkedFee(gross, result);
        // Do not commit carry here. afterSwap validates the actual fill and commits once.
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(int128(int256(fee)), 0), 0);
    }

    function _afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) internal override nonReentrant returns (bytes4, int128) {
        bytes32 poolId = PoolId.unwrap(key.toId());
        A.PoolRegistration storage config = _registered(poolId);
        Settlement memory settled = _settlement(poolId, config, params, delta);
        feeCarry[poolId][settled.buy] = settled.fees.next;
        if (settled.fee != 0) {
            // Claims require no quote reserves before the first buyer settles. The returned hook delta
            // balances this mint's debt within the same PoolManager unlock.
            poolManager.mint(ledger, Currency.wrap(config.quoteAsset).toId(), settled.fee);
        }
        IAnyQuoteLedgerV1(ledger).accrueQuote(config.launchId, settled.fees.platform, settled.fees.creator);
        _emitSwap(poolId, config.launchId, sender, settled, delta);
        return (IHooks.afterSwap.selector, settled.quoteSpecified ? int128(0) : int128(int256(settled.fee)));
    }

    function _emitSwap(bytes32 poolId, bytes32 launchId, address sender, Settlement memory settled, BalanceDelta delta)
        private
    {
        emit QuotePoolSwap(
            poolId,
            launchId,
            sender,
            settled.buy,
            settled.exactInput,
            settled.gross,
            settled.fees.platform,
            settled.fees.creator,
            delta.amount0(),
            delta.amount1()
        );
    }

    function _settlement(
        bytes32 poolId,
        A.PoolRegistration storage config,
        SwapParams calldata params,
        BalanceDelta delta
    ) private view returns (Settlement memory settled) {
        uint256 specified = _specifiedAmount(params.amountSpecified);
        bool quote0 = config.quoteAsset < config.token;
        settled.buy = params.zeroForOne == quote0;
        settled.exactInput = params.amountSpecified < 0;
        settled.quoteSpecified = settled.buy == settled.exactInput;
        int128 quoteDelta = quote0 ? delta.amount0() : delta.amount1();
        int128 tokenDelta = quote0 ? delta.amount1() : delta.amount0();
        uint256 quoteAmount = _absolute(quoteDelta);
        if (!settled.quoteSpecified && _absolute(tokenDelta) != specified) revert PartialFillUnsupported();
        if (settled.exactInput) {
            settled.gross = settled.buy ? specified : quoteAmount;
            settled.fees = F.quoteGross(settled.gross, _creatorBps(config, settled.buy), feeCarry[poolId][settled.buy]);
        } else {
            (settled.gross, settled.fees) = F.quoteNet(
                settled.buy ? quoteAmount : specified, _creatorBps(config, settled.buy), feeCarry[poolId][settled.buy]
            );
        }
        settled.fee = _checkedFee(settled.gross, settled.fees);
        if (settled.quoteSpecified && quoteAmount != (settled.buy ? settled.gross - settled.fee : settled.gross)) {
            revert PartialFillUnsupported();
        }
        if (settled.buy ? quoteDelta >= 0 || tokenDelta <= 0 : quoteDelta <= 0 || tokenDelta >= 0) {
            revert InvalidSettlement();
        }
    }

    function _validateRegistration(A.PoolRegistration calldata r) private view {
        if (
            r.launchId == bytes32(0) || r.revisionId == bytes32(0) || r.familyId == bytes32(0)
                || r.configurationHash == bytes32(0) || r.token == r.quoteAsset || !_validAsset(r.token)
                || !_validAsset(r.quoteAsset) || r.initializer.code.length == 0 || r.initializer == address(this)
                || r.initializer == address(poolManager) || r.initializer == ledger || r.initializer == host
                || r.initialTick % A.TICK_SPACING != 0 || r.initialTick <= TickMath.minUsableTick(A.TICK_SPACING)
                || r.initialTick >= TickMath.maxUsableTick(A.TICK_SPACING) || r.buyCreatorFeeBps > A.MAX_CREATOR_BPS
                || r.sellCreatorFeeBps > A.MAX_CREATOR_BPS || r.buyCreatorFeeBps % 100 != 0
                || r.sellCreatorFeeBps % 100 != 0
        ) revert InvalidRegistration();
    }

    function _validAsset(address asset) private view returns (bool) {
        return asset.code.length != 0 && asset != address(this) && asset != address(poolManager) && asset != ledger
            && asset != host;
    }

    function _registered(bytes32 poolId) private view returns (A.PoolRegistration storage config) {
        config = _pools[poolId];
        if (config.launchId == bytes32(0)) revert PoolNotRegistered();
    }

    function _key(A.PoolRegistration memory r) private view returns (PoolKey memory) {
        bool quote0 = r.quoteAsset < r.token;
        return PoolKey({
            currency0: Currency.wrap(quote0 ? r.quoteAsset : r.token),
            currency1: Currency.wrap(quote0 ? r.token : r.quoteAsset),
            fee: 0,
            tickSpacing: A.TICK_SPACING,
            hooks: IHooks(address(this))
        });
    }

    function _creatorBps(A.PoolRegistration storage config, bool buy) private view returns (uint16) {
        return buy ? config.buyCreatorFeeBps : config.sellCreatorFeeBps;
    }

    function _checkedFee(uint256 gross, F.Result memory result) private pure returns (uint256 fee) {
        fee = result.platform + result.creator;
        if (gross == 0 || gross > MAX_AMOUNT || fee >= gross) revert InvalidSwap();
    }

    function _specifiedAmount(int256 amount) private pure returns (uint256 absolute) {
        if (amount == 0 || amount > int256(MAX_AMOUNT) || amount < -int256(MAX_AMOUNT)) revert InvalidSwap();
        return amount < 0 ? uint256(-amount) : uint256(amount);
    }

    function _absolute(int128 amount) private pure returns (uint256) {
        return amount < 0 ? uint256(-int256(amount)) : uint256(int256(amount));
    }
}
