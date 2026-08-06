// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Test } from "forge-std/Test.sol";

import { LadderScheduleV1 } from "../../src/libraries/LadderScheduleV1.sol";

/// @notice Drives an arbitrary sequence of pool observations against the ladder's breach-recording rule.
/// @dev Mirrors `EthLadderFeeHookV1._observeLadder` exactly: unlock ticks ascend, so the breached set is always a
///      suffix, and one ordered pass settles the whole ladder. Reproducing the rule here lets the stateful
///      invariants run over thousands of observation sequences without standing up a PoolManager, a token and a
///      reward vault for each one. The pool-level equivalents belong in the mainnet-fork lifecycle.
contract LadderObservationHandler is Test {
    uint64 internal constant ANCHOR = 1_000_000;
    uint32 internal constant DWELL = 7200;
    uint8 internal constant COUNT = 3;

    int24[3] internal _ticks = [int24(-10_000), int24(-20_000), int24(-30_000)];
    uint64[3] internal _breaches;

    uint64 public currentBlock = ANCHOR;
    int24 public currentTick;
    uint256 public observations;

    /// @notice Advances the chain and applies one swap's worth of observation.
    function observe(int24 tick, uint16 blockAdvance) external {
        currentBlock += uint64(bound(blockAdvance, 1, 5000));
        currentTick = int24(bound(tick, -60_000, 50_000));

        for (uint8 i = 0; i < COUNT; ++i) {
            if (currentTick <= _ticks[i]) continue;
            for (uint8 j = i; j < COUNT; ++j) {
                _breaches[j] = currentBlock;
            }
            break;
        }

        observations++;
    }

    function trancheCount() external pure returns (uint8) {
        return COUNT;
    }

    function anchorBlock() external pure returns (uint64) {
        return ANCHOR;
    }

    function dwellBlocks() external pure returns (uint32) {
        return DWELL;
    }

    function tickAt(uint8 index) external view returns (int24) {
        return _ticks[index];
    }

    function breachAt(uint8 index) external view returns (uint64) {
        return _breaches[index];
    }

    function isUnlocked(uint8 index) external view returns (bool) {
        return LadderScheduleV1.isUnlocked(ANCHOR, _breaches[index], currentTick, _ticks[index], DWELL, currentBlock);
    }
}

/// @dev Stateful properties of the Ladder unlock rule under arbitrary trading.
contract LadderScheduleInvariantTest is StdInvariant, Test {
    LadderObservationHandler internal handler;

    function setUp() public {
        handler = new LadderObservationHandler();
        targetContract(address(handler));
    }

    /// @dev Recorded breaches never move backwards. A breach is a fact about the past and cannot be unwound.
    function invariant_breachesNeverDecrease() public view {
        uint8 count = handler.trancheCount();
        for (uint8 i = 0; i < count; ++i) {
            assertLe(handler.breachAt(i), handler.currentBlock());
        }
    }

    /// @dev Because unlock ticks descend, a higher tranche breaches whenever a lower one does. Its recorded breach
    ///      is therefore never older than the one below it.
    function invariant_breachesAscendWithTranches() public view {
        uint8 count = handler.trancheCount();
        for (uint8 i = 1; i < count; ++i) {
            assertGe(handler.breachAt(i), handler.breachAt(i - 1));
        }
    }

    /// @dev The unlocked set is always a prefix of the ladder. A creator can never hold a higher rung without also
    ///      holding every rung beneath it, so tranches cannot be released out of order.
    function invariant_unlockedSetIsPrefix() public view {
        uint8 count = handler.trancheCount();
        for (uint8 i = 1; i < count; ++i) {
            if (handler.isUnlocked(i)) {
                assertTrue(handler.isUnlocked(i - 1), "higher tranche unlocked while a lower one is not");
            }
        }
    }

    /// @dev No tranche reports unlocked while the pool sits below its target price, however long it held
    ///      previously. A tick above the unlock tick is a price below the target.
    function invariant_nothingUnlocksBelowItsTarget() public view {
        uint8 count = handler.trancheCount();
        for (uint8 i = 0; i < count; ++i) {
            if (handler.currentTick() > handler.tickAt(i)) {
                assertFalse(handler.isUnlocked(i), "unlocked below its own target price");
            }
        }
    }

    /// @dev Nothing can release before a full dwell window has elapsed since launch, whatever the price did.
    function invariant_nothingUnlocksBeforeOneDwellFromAnchor() public view {
        if (handler.currentBlock() - handler.anchorBlock() >= handler.dwellBlocks()) return;

        uint8 count = handler.trancheCount();
        for (uint8 i = 0; i < count; ++i) {
            assertFalse(handler.isUnlocked(i), "unlocked before one dwell window from the anchor");
        }
    }

    /// @dev A tranche whose breach is more recent than one dwell window cannot be unlocked.
    function invariant_recentBreachBlocksUnlock() public view {
        uint8 count = handler.trancheCount();
        for (uint8 i = 0; i < count; ++i) {
            if (handler.currentBlock() - handler.breachAt(i) < handler.dwellBlocks() && handler.breachAt(i) != 0) {
                assertFalse(handler.isUnlocked(i), "unlocked within a dwell window of a breach");
            }
        }
    }

    /// @dev The predicate is total. Every call returns; none reverts. The custody wallet depends on this, because a
    ///      panic in `releasable()` or `release()` would strand an earned tranche.
    function invariant_unlockPredicateNeverReverts() public view {
        uint8 count = handler.trancheCount();
        for (uint8 i = 0; i < count; ++i) {
            handler.isUnlocked(i);
        }
    }
}
