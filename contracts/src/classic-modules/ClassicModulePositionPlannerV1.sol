// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { PositionPlanner } from "@uniswap/liquidity-launcher/src/libraries/PositionPlanner.sol";
import {
    CurrencyAmounts,
    Plan,
    Position,
    PositionDefinition
} from "@uniswap/liquidity-launcher/src/types/PositionPlannerTypes.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @title ClassicModulePositionPlannerV1
/// @notice Builds the one immutable, complete-supply Classic liquidity position.
/// @dev The new module engine places the complete fixed supply in a single native/token position from the minimum
///      usable tick to the unchanged opening tick. This removes the earlier Classic engine's narrow price endpoint;
///      V4 price, amount and liquidity limits still apply. A wider range redistributes existing capital and reduces
///      opening active liquidity relative to the older concentrated range. It neither creates capital nor provides
///      guaranteed growing depth. There is no migration, selectable range or post-launch configuration change.
contract ClassicModulePositionPlannerV1 {
    uint256 public constant TOKEN_SUPPLY = 1_000_000_000 ether;
    int24 public constant INITIAL_TICK = 204_200;
    int24 public constant LIQUIDITY_TICK_LOWER = -887_200;
    int24 public constant TICK_SPACING = 200;
    uint24 private constant POSITION_WEIGHT = 10_000_000;

    error InvalidPosition(uint256 count, uint256 amount0, int24 tickLower, int24 tickUpper);

    /// @notice Resolves one complete-supply one-sided position and its PositionManager plan.
    function buildOneSidedPlan(PoolKey calldata key, address positionRecipient)
        external
        pure
        returns (Plan memory plan, Position memory position, uint256 lockedTokenDust)
    {
        uint160 initialSqrtPriceX96 = TickMath.getSqrtPriceAtTick(INITIAL_TICK);
        PositionDefinition[] memory definitions = new PositionDefinition[](1);
        definitions[0] = PositionDefinition({
            offsetLower: LIQUIDITY_TICK_LOWER - INITIAL_TICK,
            offsetUpper: 0,
            weight: POSITION_WEIGHT,
            overridePositionRecipient: positionRecipient
        });

        CurrencyAmounts memory available = CurrencyAmounts({ amount0: 0, amount1: TOKEN_SUPPLY });
        (Position[] memory positions, CurrencyAmounts memory remaining) =
            PositionPlanner.resolve(definitions, initialSqrtPriceX96, TICK_SPACING, available, positionRecipient);
        if (
            positions.length != 1 || positions[0].amount0 != 0 || positions[0].tickLower != LIQUIDITY_TICK_LOWER
                || positions[0].tickUpper != INITIAL_TICK
        ) {
            uint256 amount0 = positions.length == 0 ? 0 : positions[0].amount0;
            int24 tickLower = positions.length == 0 ? int24(0) : positions[0].tickLower;
            int24 tickUpper = positions.length == 0 ? int24(0) : positions[0].tickUpper;
            revert InvalidPosition(positions.length, amount0, tickLower, tickUpper);
        }

        position = positions[0];
        lockedTokenDust = remaining.amount1;
        plan = PositionPlanner.toPlan(positions, key, positionRecipient);
    }
}
