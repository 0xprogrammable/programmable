// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { LiquidityGrowthFullRangePolicyV3 as Policy } from "../LiquidityGrowthFullRangePolicyV3.sol";

interface IModuleV3OraclePoolV1 {
    function factory() external view returns (address);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function liquidity() external view returns (uint128);
    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool);
    function observations(uint256 index) external view returns (uint32, int56, uint160, bool);
    function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory, uint160[] memory);
}

/// @notice Bounded, same-pool V3 fee-sale guard; not an external fair-value oracle.
/// @dev Reuses existing Deep time/deviation/impact policy and Uniswap TickMath. V4 hook-specific observation
///      helpers cannot read V3 pools. Tick/liquidity cumulative arithmetic follows V3's modular conventions.
library ModuleV3FeeOracleV1 {
    uint256 internal constant MIN_WETH_DEPTH = 10 ether;
    uint256 internal constant MAX_NOTIONAL_BPS = 10;

    struct Snapshot {
        address pool;
        address weth;
        int24 spotTick;
        int24 longTick;
        int24 shortTick;
        uint128 harmonicLiquidity;
        uint128 currentLiquidity;
        uint32 latestObservation;
        uint256 minimumEth;
        uint256 twapEth;
        bytes32 observationHash;
    }

    error InvalidOracle();
    error InsufficientHistory();
    error StaleObservation();
    error InsufficientLiquidity();
    error OracleDeviation();
    error ExcessiveNotional();
    error ExcessiveImpact();

    function read(address poolAddress, address quote, address weth, uint256 amount, uint24 fee)
        internal
        view
        returns (Snapshot memory s)
    {
        if (amount == 0 || amount > type(uint128).max || fee == 0 || fee > 10_000) revert InvalidOracle();
        s.pool = poolAddress;
        s.weth = weth;
        IModuleV3OraclePoolV1 pool = IModuleV3OraclePoolV1(poolAddress);
        _slotState(pool, s);
        _observe(pool, s);
        if (
            _difference(s.shortTick, s.longTick) > uint24(Policy.MAX_SHORT_LONG_TWAP_DEVIATION_TICKS)
                || _difference(s.spotTick, s.longTick) > uint24(Policy.MAX_PRE_SPOT_TWAP_DEVIATION_TICKS)
        ) revert OracleDeviation();
        s.currentLiquidity = pool.liquidity();
        _priceAndDepth(s, quote < weth, amount, fee);
        s.observationHash = keccak256(abi.encode(block.chainid, block.timestamp, s));
    }

    function _slotState(IModuleV3OraclePoolV1 pool, Snapshot memory s) private view {
        uint16 index;
        uint16 cardinality;
        uint16 next;
        bool unlocked;
        uint160 sqrtPrice;
        (sqrtPrice,, index, cardinality, next,, unlocked) = pool.slot0();
        if (!unlocked || sqrtPrice < TickMath.MIN_SQRT_PRICE || sqrtPrice >= TickMath.MAX_SQRT_PRICE) {
            revert InvalidOracle();
        }
        s.spotTick = TickMath.getTickAtSqrtPrice(sqrtPrice);
        if (cardinality < 2 || next < Policy.MIN_OBSERVATION_CARDINALITY_NEXT) revert InsufficientHistory();
        bool initialized;
        (s.latestObservation,,, initialized) = pool.observations(index);
        uint32 age;
        unchecked {
            age = uint32(block.timestamp) - s.latestObservation;
        }
        if (!initialized || age > Policy.SHORT_TWAP_WINDOW) revert StaleObservation();
    }

    function _priceAndDepth(Snapshot memory s, bool quote0, uint256 amount, uint24 fee) private view {
        int24 lowerTick = s.longTick - Policy.MAX_POST_SPOT_TWAP_DEVIATION_TICKS;
        int24 upperTick = s.longTick + Policy.MAX_POST_SPOT_TWAP_DEVIATION_TICKS;
        if (lowerTick < TickMath.MIN_TICK || upperTick > TickMath.MAX_TICK) revert InvalidOracle();
        uint128 trustedLiquidity = uint128(Math.min(s.harmonicLiquidity, s.currentLiquidity));
        uint256 trustedDepth = Math.min(
            _wethDepth(trustedLiquidity, TickMath.getSqrtPriceAtTick(lowerTick), quote0),
            _wethDepth(trustedLiquidity, TickMath.getSqrtPriceAtTick(upperTick), quote0)
        );
        trustedDepth = Math.min(trustedDepth, IERC20(s.weth).balanceOf(s.pool));
        if (trustedDepth < MIN_WETH_DEPTH) revert InsufficientLiquidity();
        s.twapEth = amountAtTick(s.longTick, amount, quote0);
        if (s.twapEth > Math.mulDiv(trustedDepth, MAX_NOTIONAL_BPS, 10_000)) revert ExcessiveNotional();
        int24 adverseTick = quote0 ? lowerTick : upperTick;
        s.minimumEth =
            Math.mulDiv(amountAtTick(adverseTick, amount, quote0), 1_000_000 - fee, 1_000_000, Math.Rounding.Ceil);
    }

    function afterSwap(Snapshot memory s) internal view {
        (uint160 sqrtPrice,,,,,, bool unlocked) = IModuleV3OraclePoolV1(s.pool).slot0();
        if (!unlocked || sqrtPrice < TickMath.MIN_SQRT_PRICE || sqrtPrice >= TickMath.MAX_SQRT_PRICE) {
            revert InvalidOracle();
        }
        int24 afterTick = TickMath.getTickAtSqrtPrice(sqrtPrice);
        if (
            _difference(afterTick, s.spotTick) > uint24(Policy.MAX_INTERNAL_SWAP_IMPACT_TICKS)
                || _difference(afterTick, s.longTick) > uint24(Policy.MAX_POST_SPOT_TWAP_DEVIATION_TICKS)
        ) revert ExcessiveImpact();
        if (IERC20(s.weth).balanceOf(s.pool) < MIN_WETH_DEPTH) revert InsufficientLiquidity();
    }

    function _observe(IModuleV3OraclePoolV1 pool, Snapshot memory s) private view {
        uint32[] memory windows = new uint32[](3);
        windows[0] = uint32(Policy.TWAP_WINDOW);
        windows[1] = uint32(Policy.SHORT_TWAP_WINDOW);
        (int56[] memory ticks, uint160[] memory liquidityCumulatives) = pool.observe(windows);
        if (ticks.length != 3 || liquidityCumulatives.length != 3) revert InvalidOracle();
        s.longTick = _meanTick(ticks[0], ticks[2], windows[0]);
        s.shortTick = _meanTick(ticks[1], ticks[2], windows[1]);
        uint160 delta;
        unchecked {
            delta = liquidityCumulatives[2] - liquidityCumulatives[0];
        }
        if (delta == 0) revert InsufficientLiquidity();
        uint256 harmonic = uint256(windows[0]) * type(uint160).max / (uint256(delta) << 32);
        if (harmonic == 0 || harmonic > type(uint128).max) revert InsufficientLiquidity();
        s.harmonicLiquidity = uint128(harmonic);
    }

    function _meanTick(int56 start, int56 end, uint32 window) private pure returns (int24) {
        int56 delta;
        unchecked {
            delta = end - start;
        }
        int256 mean = int256(delta) / int256(uint256(window));
        if (delta < 0 && int256(delta) % int256(uint256(window)) != 0) --mean;
        if (mean < TickMath.MIN_TICK || mean > TickMath.MAX_TICK) revert InvalidOracle();
        return int24(mean);
    }

    function _wethDepth(uint128 liquidity, uint160 sqrtPrice, bool weth1) private pure returns (uint256) {
        return weth1 ? Math.mulDiv(liquidity, sqrtPrice, 1 << 96) : Math.mulDiv(liquidity, 1 << 96, sqrtPrice);
    }

    function amountAtTick(int24 tick, uint256 amount, bool input0) internal pure returns (uint256) {
        uint256 sqrt = TickMath.getSqrtPriceAtTick(tick);
        if (sqrt <= type(uint128).max) {
            uint256 ratioX192 = sqrt * sqrt;
            return input0
                ? Math.mulDiv(amount, ratioX192, 1 << 192, Math.Rounding.Ceil)
                : Math.mulDiv(amount, 1 << 192, ratioX192, Math.Rounding.Ceil);
        }
        uint256 ratioX128 = Math.mulDiv(sqrt, sqrt, 1 << 64);
        return input0
            ? Math.mulDiv(amount, ratioX128, 1 << 128, Math.Rounding.Ceil)
            : Math.mulDiv(amount, 1 << 128, ratioX128, Math.Rounding.Ceil);
    }

    function _difference(int24 a, int24 b) private pure returns (uint24) {
        return uint24(a > b ? a - b : b - a);
    }
}
