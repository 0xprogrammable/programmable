// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { LadderCustodyConfig, LadderScheduleV1, LadderTranche } from "../src/libraries/LadderScheduleV1.sol";

/// @dev Exercises the unlock rule in isolation. No pool, no PoolManager, no wallet. Every property the Ladder model
///      claims in its documentation is asserted here against the pure arithmetic the hook and wallet actually call.
contract LadderScheduleV1Test is Test {
    uint64 internal constant ANCHOR = 1_000_000;
    uint32 internal constant DWELL = 7200;
    int24 internal constant TICK = -20_000;

    function _config(uint8 count, uint32 dwellBlocks, uint16 expiryDays)
        internal
        pure
        returns (LadderCustodyConfig memory config)
    {
        LadderTranche[] memory tranches = new LadderTranche[](count);
        uint16 share = uint16(LadderScheduleV1.TOTAL_SHARES_BPS / count);
        for (uint8 i = 0; i < count; ++i) {
            tranches[i] = LadderTranche({ unlockTick: -int24(uint24(i + 1)) * 10_000, sharesBps: share });
        }
        tranches[count - 1].sharesBps = uint16(LadderScheduleV1.TOTAL_SHARES_BPS - uint256(share) * (count - 1));
        config = LadderCustodyConfig({ tranches: tranches, dwellBlocks: dwellBlocks, expiryDays: expiryDays });
    }

    // --- Validation ------------------------------------------------------------------------------------------------

    function test_acceptsWellFormedLadders() public pure {
        for (uint8 count = 1; count <= LadderScheduleV1.MAX_TRANCHES; ++count) {
            LadderScheduleV1.validate(_config(count, DWELL, 90));
        }
    }

    function test_acceptsDisabledExpiry() public pure {
        LadderScheduleV1.validate(_config(3, DWELL, 0));
    }

    function test_rejectsEmptyLadder() public {
        LadderCustodyConfig memory config =
            LadderCustodyConfig({ tranches: new LadderTranche[](0), dwellBlocks: DWELL, expiryDays: 90 });
        vm.expectRevert(abi.encodeWithSelector(LadderScheduleV1.TrancheCountOutOfRange.selector, 0));
        this.validateExternal(config);
    }

    function test_rejectsTooManyTranches() public {
        LadderCustodyConfig memory config = _config(5, DWELL, 90);
        LadderTranche[] memory tranches = new LadderTranche[](6);
        for (uint8 i = 0; i < 5; ++i) {
            tranches[i] = config.tranches[i];
        }
        tranches[5] = LadderTranche({ unlockTick: -60_000, sharesBps: 1000 });
        config.tranches = tranches;
        vm.expectRevert(abi.encodeWithSelector(LadderScheduleV1.TrancheCountOutOfRange.selector, 6));
        this.validateExternal(config);
    }

    function test_rejectsNonDescendingTicks() public {
        LadderCustodyConfig memory config = _config(3, DWELL, 90);
        config.tranches[2].unlockTick = config.tranches[1].unlockTick;
        vm.expectRevert();
        this.validateExternal(config);
    }

    function test_rejectsSharesNotTotallingFull() public {
        LadderCustodyConfig memory config = _config(2, DWELL, 90);
        config.tranches[0].sharesBps = 1000;
        vm.expectRevert();
        this.validateExternal(config);
    }

    function test_rejectsDwellBelowFloor() public {
        LadderCustodyConfig memory config = _config(2, LadderScheduleV1.MIN_DWELL_BLOCKS - 1, 90);
        vm.expectRevert();
        this.validateExternal(config);
    }

    function test_rejectsDustTranche() public {
        LadderCustodyConfig memory config = _config(2, DWELL, 90);
        config.tranches[0].sharesBps = 100;
        config.tranches[1].sharesBps = 9900;
        vm.expectRevert();
        this.validateExternal(config);
    }

    function validateExternal(LadderCustodyConfig memory config) external pure {
        LadderScheduleV1.validate(config);
    }

    // --- The unlock rule -------------------------------------------------------------------------------------------

    function _unlocked(uint64 lastBreach, int24 currentTick, uint256 at) internal pure returns (bool) {
        return LadderScheduleV1.isUnlocked(ANCHOR, lastBreach, currentTick, TICK, DWELL, at);
    }

    function test_unanchoredPoolNeverUnlocks() public pure {
        assertFalse(LadderScheduleV1.isUnlocked(0, 0, TICK - 1, TICK, DWELL, 9_999_999));
    }

    function test_belowTargetPriceNeverUnlocks() public pure {
        assertFalse(_unlocked(0, TICK + 1, ANCHOR + 1_000_000));
    }

    /// @dev The pool opening above a tranche must not release it on the first swap.
    function test_openingAboveDoesNotReleaseImmediately() public pure {
        assertFalse(_unlocked(0, TICK - 1, ANCHOR + 1));
        assertFalse(_unlocked(0, TICK - 1, ANCHOR + DWELL - 1));
    }

    function test_releasesAtExactDwell() public pure {
        assertTrue(_unlocked(0, TICK - 1, ANCHOR + DWELL));
    }

    function test_releasesAtExactTick() public pure {
        assertTrue(_unlocked(0, TICK, ANCHOR + DWELL));
    }

    /// @dev A breach restarts the clock in full.
    function test_breachRestartsDwell() public pure {
        uint64 breach = ANCHOR + 5000;
        assertFalse(_unlocked(breach, TICK - 1, breach + DWELL - 1));
        assertTrue(_unlocked(breach, TICK - 1, breach + DWELL));
    }

    /// @dev A pump held for the full window and then dumped releases nothing, because the current tick is checked.
    function test_pumpAndDumpReleasesNothing() public pure {
        uint64 breach = ANCHOR + 100;
        assertTrue(_unlocked(breach, TICK - 1, breach + DWELL));
        assertFalse(_unlocked(breach, TICK + 1, breach + DWELL));
    }

    // --- Invariants ------------------------------------------------------------------------------------------------

    /// @dev Nothing can unlock before at least a full dwell window has passed since launch.
    function testFuzz_neverUnlocksBeforeDwellFromAnchor(uint64 lastBreach, int24 currentTick, uint256 at) public pure {
        at = bound(at, ANCHOR, ANCHOR + DWELL - 1);
        assertFalse(LadderScheduleV1.isUnlocked(ANCHOR, lastBreach, currentTick, TICK, DWELL, at));
    }

    /// @dev A breach at block B blocks any unlock before B + dwell, whatever happened earlier.
    function testFuzz_breachBlocksUntilFullWindow(uint64 lastBreach, int24 currentTick, uint256 offset) public pure {
        lastBreach = uint64(bound(lastBreach, ANCHOR + 1, ANCHOR + 5_000_000));
        offset = bound(offset, 0, DWELL - 1);
        assertFalse(
            LadderScheduleV1.isUnlocked(ANCHOR, lastBreach, currentTick, TICK, DWELL, uint256(lastBreach) + offset)
        );
    }

    /// @dev Once satisfied, an unlock cannot be undone by time alone — only by a price fall.
    function testFuzz_unlockIsStableWhilePriceHolds(uint256 stepA, uint256 stepB) public pure {
        stepA = bound(stepA, DWELL, 5_000_000);
        stepB = bound(stepB, stepA, 5_000_000);
        assertTrue(_unlocked(0, TICK - 1, ANCHOR + stepA));
        assertTrue(_unlocked(0, TICK - 1, ANCHOR + stepB));
    }

    // --- Release accounting ----------------------------------------------------------------------------------------

    function test_fullSharesReturnFullAmount() public pure {
        assertEq(LadderScheduleV1.releasableAmount(1000 ether, LadderScheduleV1.TOTAL_SHARES_BPS), 1000 ether);
    }

    function test_zeroSharesReturnNothing() public pure {
        assertEq(LadderScheduleV1.releasableAmount(1000 ether, 0), 0);
    }

    function testFuzz_partialSharesNeverExceedCustody(uint256 amount, uint16 sharesBps) public pure {
        amount = bound(amount, 0, 1_000_000_000 ether);
        sharesBps = uint16(bound(sharesBps, 0, LadderScheduleV1.TOTAL_SHARES_BPS));
        assertLe(LadderScheduleV1.releasableAmount(amount, sharesBps), amount);
    }

    /// @dev Releasing every tranche separately must never pay out more than the custodied balance.
    function testFuzz_trancheSumNeverExceedsCustody(uint256 amount, uint16 splitBps) public pure {
        amount = bound(amount, 0, 1_000_000_000 ether);
        splitBps = uint16(bound(splitBps, 500, LadderScheduleV1.TOTAL_SHARES_BPS - 500));

        uint256 first = LadderScheduleV1.releasableAmount(amount, splitBps);
        uint256 second = LadderScheduleV1.releasableAmount(amount, LadderScheduleV1.TOTAL_SHARES_BPS - splitBps);
        assertLe(first + second, amount);
    }

    // --- Forfeiture ------------------------------------------------------------------------------------------------

    function test_forfeitDisabledReturnsZero() public pure {
        assertEq(LadderScheduleV1.forfeitTimestamp(1_700_000_000, _config(2, DWELL, 0)), 0);
    }

    function test_forfeitTimestampIsLaunchPlusExpiry() public pure {
        uint64 launch = 1_700_000_000;
        assertEq(LadderScheduleV1.forfeitTimestamp(launch, _config(2, DWELL, 90)), launch + 90 days);
    }
}
