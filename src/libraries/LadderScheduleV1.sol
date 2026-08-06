// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @notice One performance tranche. `unlockTick` is an absolute Uniswap v4 tick on the pool's ETH/token pair.
/// @param unlockTick The tick the pool must reach and hold for this tranche to release. In a native-ETH pool the
///        tick falls as the token's ETH price rises, so a higher price target is a lower tick.
/// @param sharesBps The portion of the custodied balance this tranche releases, in basis points.
struct LadderTranche {
    int24 unlockTick;
    uint16 sharesBps;
}

/// @notice The immutable performance-unlock terms for one launch.
/// @param tranches Up to five tranches, in strictly descending tick order, with shares summing to 10,000.
/// @param dwellBlocks Consecutive blocks the pool must hold at or above a tranche's tick before it releases.
/// @param expiryDays Days after launch at which unreleased tranches are permanently forfeited. Zero disables expiry.
struct LadderCustodyConfig {
    LadderTranche[] tranches;
    uint32 dwellBlocks;
    uint16 expiryDays;
}

/// @title LadderScheduleV1
/// @notice Pure schedule arithmetic for performance-based Initial Buy custody.
/// @dev Isolated from custody and from the hook so that the release rule can be reviewed and fuzzed without a pool,
///      a wallet or a PoolManager. Every function here is `pure`.
///
///      The rule this library encodes: a tranche releases once the pool's tick has been at or above the tranche's
///      `unlockTick` continuously for `dwellBlocks` blocks. Continuity is established by the hook, which records the
///      most recent block at which the pool was observed *below* each tranche's tick. Because a Uniswap v4 pool's
///      tick changes only on a swap, and the hook observes every swap, an absence of recorded breaches across a
///      window is proof that no breach occurred in that window.
library LadderScheduleV1 {
    using SafeCast for uint256;

    uint8 internal constant MAX_TRANCHES = 5;
    uint16 internal constant TOTAL_SHARES_BPS = 10_000;
    uint16 internal constant MIN_TRANCHE_SHARES_BPS = 500;
    uint32 internal constant MIN_DWELL_BLOCKS = 7200;
    uint32 internal constant MAX_DWELL_BLOCKS = 216_000;
    uint16 internal constant MIN_EXPIRY_DAYS = 30;
    uint16 internal constant MAX_EXPIRY_DAYS = 3650;
    int24 internal constant MIN_UNLOCK_TICK = -887_200;
    int24 internal constant MAX_UNLOCK_TICK = 887_200;

    error DwellOutOfRange(uint32 dwellBlocks);
    error ExpiryOutOfRange(uint16 expiryDays);
    error ShareBelowMinimum(uint8 index, uint16 sharesBps);
    error SharesMustTotalOneHundredPercent(uint16 totalSharesBps);
    error TicksMustDescend(uint8 index, int24 previousTick, int24 unlockTick);
    error TickOutOfRange(uint8 index, int24 unlockTick);
    error TrancheCountOutOfRange(uint256 count);

    /// @notice Reverts unless `config` is a well-formed ladder.
    /// @dev Descending ticks are required so that a pool at any given tick satisfies a contiguous prefix of the
    ///      ladder. This makes the breach scan in the hook a single ordered pass and keeps the ladder legible: each
    ///      tranche demands a higher token price than the one before it.
    ///
    ///      Ticks descend rather than ascend because these pools pair a token against native ETH as `currency0`.
    ///      The pool's tick measures token per ETH, so it falls as the token's ETH price rises. A 2x price target
    ///      is a lower tick than the launch tick, and a 5x target is lower still.
    function validate(LadderCustodyConfig memory config) internal pure {
        uint256 count = config.tranches.length;
        if (count == 0 || count > MAX_TRANCHES) revert TrancheCountOutOfRange(count);

        if (config.dwellBlocks < MIN_DWELL_BLOCKS || config.dwellBlocks > MAX_DWELL_BLOCKS) {
            revert DwellOutOfRange(config.dwellBlocks);
        }

        if (config.expiryDays != 0 && (config.expiryDays < MIN_EXPIRY_DAYS || config.expiryDays > MAX_EXPIRY_DAYS)) {
            revert ExpiryOutOfRange(config.expiryDays);
        }

        uint256 totalSharesBps;
        int24 previousTick = type(int24).min;

        for (uint8 i = 0; i < count; ++i) {
            LadderTranche memory tranche = config.tranches[i];

            if (tranche.unlockTick < MIN_UNLOCK_TICK || tranche.unlockTick > MAX_UNLOCK_TICK) {
                revert TickOutOfRange(i, tranche.unlockTick);
            }
            if (i != 0 && tranche.unlockTick >= previousTick) {
                revert TicksMustDescend(i, previousTick, tranche.unlockTick);
            }
            if (tranche.sharesBps < MIN_TRANCHE_SHARES_BPS) {
                revert ShareBelowMinimum(i, tranche.sharesBps);
            }

            previousTick = tranche.unlockTick;
            totalSharesBps += tranche.sharesBps;
        }

        if (totalSharesBps != TOTAL_SHARES_BPS) revert SharesMustTotalOneHundredPercent(totalSharesBps.toUint16());
    }

    /// @notice Returns whether a tranche has satisfied its dwell requirement.
    /// @dev A tranche releases when the pool has not been observed below `unlockTick` for `dwellBlocks` blocks, and
    ///      the pool is not below it now. `lastBreachBlock` is the most recent block at which the hook observed the
    ///      pool below this tranche's tick; zero means the pool has been at or above it since the anchor.
    /// @param anchorBlock The block at which the pool was initialized.
    /// @param lastBreachBlock The most recent observed breach of this tranche's tick, or zero if never breached.
    /// @param currentTick The pool's tick now. Lower is a higher token price.
    /// @param unlockTick The tranche's tick. The pool must be at or below it.
    /// @param dwellBlocks The required dwell length.
    /// @param blockNumber The block height to evaluate at.
    function isUnlocked(
        uint64 anchorBlock,
        uint64 lastBreachBlock,
        int24 currentTick,
        int24 unlockTick,
        uint32 dwellBlocks,
        uint256 blockNumber
    ) internal pure returns (bool) {
        // An uninitialized pool has no price history and can satisfy nothing.
        if (anchorBlock == 0 || blockNumber <= anchorBlock) return false;

        // A tranche cannot release while the pool sits below its target price, however long it held previously.
        // A tick above the unlock tick is a token price below the target.
        if (currentTick > unlockTick) return false;

        // Dwell is measured from the later of the last breach and the anchor, so a pool that opened above a tranche
        // still has to hold it for the full window rather than releasing on its first swap.
        uint64 dwellStart = lastBreachBlock > anchorBlock ? lastBreachBlock : anchorBlock;

        // A dwell start at or beyond the evaluated height means no window has accrued. Returning false rather than
        // subtracting keeps this function total: it must never revert, because the custody wallet calls it from a
        // view and from its release path, and a panic there would strand an earned tranche.
        if (blockNumber <= dwellStart) return false;

        return blockNumber - dwellStart >= dwellBlocks;
    }

    /// @notice Returns the token amount a set of released tranches entitles the beneficiary to.
    /// @dev Computed against the original custodied balance so that repeated partial releases can never over-pay:
    ///      the caller subtracts what has already been released.
    function releasableAmount(uint256 custodiedAmount, uint16 releasedSharesBps) internal pure returns (uint256) {
        if (releasedSharesBps == 0) return 0;
        if (releasedSharesBps >= TOTAL_SHARES_BPS) return custodiedAmount;
        return (custodiedAmount * releasedSharesBps) / TOTAL_SHARES_BPS;
    }

    /// @notice Returns the timestamp at which unreleased tranches are forfeited, or zero if expiry is disabled.
    function forfeitTimestamp(uint64 launchTimestamp, LadderCustodyConfig memory config)
        internal
        pure
        returns (uint64)
    {
        if (config.expiryDays == 0) return 0;
        return (uint256(launchTimestamp) + uint256(config.expiryDays) * 1 days).toUint64();
    }
}
