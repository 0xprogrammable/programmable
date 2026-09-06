// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { SqrtPriceMath } from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Plan, Position } from "@uniswap/liquidity-launcher/src/types/PositionPlannerTypes.sol";
import { Test } from "forge-std/Test.sol";

import { ClassicPositionPlannerV1 } from "../../src/ClassicPositionPlannerV1.sol";
import { ClassicModulePositionPlannerV1 } from "../../src/classic-modules/ClassicModulePositionPlannerV1.sol";

contract ClassicModulePositionPlannerV1Test is Test {
    uint256 private constant Q96 = 1 << 96;
    uint256 private constant RATIO_SCALE = 1 ether;

    ClassicModulePositionPlannerV1 private planner;
    ClassicPositionPlannerV1 private previousPlanner;
    PoolKey private key;
    address private recipient;

    function setUp() public {
        planner = new ClassicModulePositionPlannerV1();
        previousPlanner = new ClassicPositionPlannerV1();
        recipient = makeAddr("module-position-recipient");
        key = PoolKey(Currency.wrap(address(0)), Currency.wrap(makeAddr("token")), 0, 200, IHooks(address(0)));
    }

    function test_singleCompleteSupplyPositionUsesMinimumUsableTick() public view {
        (Plan memory plan, Position memory position, uint256 dust) = planner.buildOneSidedPlan(key, recipient);
        assertEq(planner.LIQUIDITY_TICK_LOWER(), TickMath.minUsableTick(200));
        assertEq(position.tickLower, -887_200);
        assertEq(position.tickUpper, 204_200);
        assertEq(position.amount0, 0);
        assertEq(position.amount1 + dust, 1_000_000_000 ether);
        assertEq(position.recipient, recipient);
        assertEq(plan.actions.length, 4);
    }

    function test_openingLiquidityRatioMatchesFullSupplyFormula() public {
        (, Position memory wide,) = planner.buildOneSidedPlan(key, recipient);
        (, Position memory narrow,) = previousPlanner.buildOneSidedPlan(key, recipient);
        uint256 upper = TickMath.getSqrtPriceAtTick(204_200);
        uint256 wideLower = TickMath.getSqrtPriceAtTick(-887_200);
        uint256 narrowLower = TickMath.getSqrtPriceAtTick(174_800);
        uint256 supply = planner.TOKEN_SUPPLY();
        // With only currency1 at the upper boundary, L = floor(supply * Q96 / (sqrtUpper - sqrtLower)).
        assertEq(wide.liquidity, FullMath.mulDiv(supply, Q96, upper - wideLower));
        assertEq(narrow.liquidity, FullMath.mulDiv(supply, Q96, upper - narrowLower));
        uint256 measuredRatio = FullMath.mulDiv(wide.liquidity, RATIO_SCALE, narrow.liquidity);
        uint256 geometricRatio = FullMath.mulDiv(upper - narrowLower, RATIO_SCALE, upper - wideLower);
        assertApproxEqAbs(measuredRatio, geometricRatio, 1);
        assertGt(measuredRatio, 0.769 ether);
        assertLt(measuredRatio, 0.771 ether);
        emit log_named_uint("wide opening liquidity", wide.liquidity);
        emit log_named_uint("previous opening liquidity", narrow.liquidity);
        emit log_named_uint("wide / previous, scaled 1e18", measuredRatio);
        emit log_named_uint("opening liquidity reduction, scaled 1e18", RATIO_SCALE - measuredRatio);
    }

    function test_priceEndpointUsesV4BoundsAndExceedsOneSwapAmountRepresentation() public {
        (, Position memory position,) = planner.buildOneSidedPlan(key, recipient);
        uint160 lower = TickMath.getSqrtPriceAtTick(position.tickLower);
        uint160 upper = TickMath.getSqrtPriceAtTick(position.tickUpper);
        uint256 netNativeToLower = SqrtPriceMath.getAmount0Delta(lower, upper, uint128(position.liquidity), true);
        // This mathematical aggregate curve amount is not a practical liquidity promise or an allowed single swap.
        assertGt(lower, TickMath.MIN_SQRT_PRICE);
        assertGt(netNativeToLower, 8 ether);
        assertGt(netNativeToLower, uint256(uint128(type(int128).max)));
        emit log_named_uint("mathematical net native at minimum usable tick, wei", netNativeToLower);
    }
}
