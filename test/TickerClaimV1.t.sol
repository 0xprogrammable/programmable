// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";

import { ClaimState, TickerClaim, TickerClaimV1 } from "../src/libraries/TickerClaimV1.sol";

/// @dev Exercises the claim lifecycle and tribute arithmetic in isolation. No pool, no hook.
contract TickerClaimV1Test is Test {
    uint64 internal constant GRACE = TickerClaimV1.GRACE_BLOCKS;
    uint64 internal constant CLAIM_BLOCK = 1_000_000;
    bytes32 internal constant POOL = bytes32(uint256(1));

    function _claim(bool confirmed) internal pure returns (TickerClaim memory) {
        return TickerClaim({ poolId: POOL, claimBlock: CLAIM_BLOCK, confirmed: confirmed });
    }

    // --- Normalization --------------------------------------------------------------------------------------------

    function test_foldsAsciiCase() public pure {
        bytes32 expected = TickerClaimV1.normalize("PEPE");
        assertEq(TickerClaimV1.normalize("pepe"), expected);
        assertEq(TickerClaimV1.normalize("Pepe"), expected);
        assertEq(TickerClaimV1.normalize("pEpE"), expected);
    }

    function test_leavesNonLetterBytesAlone() public pure {
        assertTrue(TickerClaimV1.normalize("W3B") != TickerClaimV1.normalize("W3b0"));
        assertEq(TickerClaimV1.normalize("w3b"), TickerClaimV1.normalize("W3B"));
    }

    /// @dev Non-ASCII lookalikes are deliberately distinct tickers. This asserts the documented limitation rather
    ///      than a protection, so that a future change to normalization has to update this test consciously.
    function test_nonAsciiLookalikesAreDistinctTickers() public pure {
        // "PEPE" in Cyrillic capital letters.
        assertTrue(TickerClaimV1.normalize(unicode"РЕРЕ") != TickerClaimV1.normalize("PEPE"));
    }

    function test_rejectsEmptySymbol() public {
        vm.expectRevert(TickerClaimV1.SymbolEmpty.selector);
        this.normalizeExternal("");
    }

    function test_rejectsOverlongSymbol() public {
        string memory long = "123456789012345678901234567890123";
        vm.expectRevert(abi.encodeWithSelector(TickerClaimV1.SymbolTooLong.selector, 33));
        this.normalizeExternal(long);
    }

    function normalizeExternal(string calldata symbol) external pure returns (bytes32) {
        return TickerClaimV1.normalize(symbol);
    }

    /// @dev Normalizing an already-uppercase symbol is a fixed point: folding twice equals folding once.
    function testFuzz_normalizationIsIdempotent(bytes memory raw) public pure {
        vm.assume(raw.length > 0 && raw.length <= 32);

        bytes memory upper = new bytes(raw.length);
        for (uint256 i = 0; i < raw.length; ++i) {
            bytes1 c = raw[i];
            upper[i] = (c >= 0x61 && c <= 0x7A) ? bytes1(uint8(c) - 32) : c;
        }

        assertEq(TickerClaimV1.normalize(string(raw)), TickerClaimV1.normalize(string(upper)));
    }

    /// @dev Two symbols that differ outside the ASCII letter range must never collide.
    function testFuzz_distinctNonLetterSymbolsDoNotCollide(uint8 rawA, uint8 rawB) public pure {
        uint8 a = uint8(bound(rawA, 0x30, 0x39));
        uint8 b = uint8(bound(rawB, 0x30, 0x39));
        vm.assume(a != b);

        bytes memory left = new bytes(1);
        bytes memory right = new bytes(1);
        left[0] = bytes1(a);
        right[0] = bytes1(b);

        assertTrue(TickerClaimV1.normalize(string(left)) != TickerClaimV1.normalize(string(right)));
    }

    // --- Claim lifecycle ------------------------------------------------------------------------------------------

    function test_unclaimedWhenNoPool() public pure {
        TickerClaim memory empty;
        assertTrue(TickerClaimV1.stateOf(empty, GRACE, CLAIM_BLOCK) == ClaimState.Unclaimed);
        assertTrue(TickerClaimV1.isAvailable(empty, GRACE, CLAIM_BLOCK));
    }

    function test_provisionalInsideTheGraceWindow() public pure {
        assertTrue(TickerClaimV1.stateOf(_claim(false), GRACE, CLAIM_BLOCK) == ClaimState.Provisional);
        assertTrue(TickerClaimV1.stateOf(_claim(false), GRACE, CLAIM_BLOCK + GRACE - 1) == ClaimState.Provisional);
        assertFalse(TickerClaimV1.isAvailable(_claim(false), GRACE, CLAIM_BLOCK + GRACE - 1));
    }

    function test_lapsesExactlyAtTheGraceBoundary() public pure {
        assertTrue(TickerClaimV1.stateOf(_claim(false), GRACE, CLAIM_BLOCK + GRACE) == ClaimState.Lapsed);
        assertTrue(TickerClaimV1.isAvailable(_claim(false), GRACE, CLAIM_BLOCK + GRACE));
    }

    /// @dev A confirmed claim is permanent. No block height makes it available again.
    function testFuzz_confirmedClaimNeverLapses(uint256 blockNumber) public pure {
        assertTrue(TickerClaimV1.stateOf(_claim(true), GRACE, blockNumber) == ClaimState.Confirmed);
        assertFalse(TickerClaimV1.isAvailable(_claim(true), GRACE, blockNumber));
    }

    /// @dev The lifecycle predicate is total: it returns for every input and never reverts. The hook reads it inside
    ///      registration and inside accrual, so a panic here would brick a launch or a swap.
    function testFuzz_stateOfNeverReverts(bytes32 poolId, uint64 claimBlock, bool confirmed, uint256 blockNumber)
        public
        pure
    {
        TickerClaim memory claim = TickerClaim({ poolId: poolId, claimBlock: claimBlock, confirmed: confirmed });
        TickerClaimV1.stateOf(claim, GRACE, blockNumber);
        TickerClaimV1.isAvailable(claim, GRACE, blockNumber);
    }

    /// @dev Availability and liveness are exact complements. There is no state that is neither takeable nor held.
    function testFuzz_availableIsExactlyUnclaimedOrLapsed(
        bytes32 poolId,
        uint64 claimBlock,
        bool confirmed,
        uint256 blockNumber
    ) public pure {
        TickerClaim memory claim = TickerClaim({ poolId: poolId, claimBlock: claimBlock, confirmed: confirmed });
        ClaimState state = TickerClaimV1.stateOf(claim, GRACE, blockNumber);
        bool available = TickerClaimV1.isAvailable(claim, GRACE, blockNumber);

        assertEq(available, state == ClaimState.Unclaimed || state == ClaimState.Lapsed);
    }

    function testFuzz_earnedIsMonotonicInFees(uint256 fees) public pure {
        fees = bound(fees, 0, 1000 ether);
        bool earned = TickerClaimV1.isEarned(fees, TickerClaimV1.CONFIRMATION_FEE_WEI);
        assertEq(earned, fees >= TickerClaimV1.CONFIRMATION_FEE_WEI);
    }

    // --- Tribute --------------------------------------------------------------------------------------------------

    function test_tributeIsTwentyPercentOfTheCreatorShare() public pure {
        (uint256 retained, uint256 tribute) = TickerClaimV1.splitTribute(1 ether, TickerClaimV1.TRIBUTE_SHARE_BPS);
        assertEq(tribute, 0.2 ether);
        assertEq(retained, 0.8 ether);
    }

    function test_zeroShareLeavesTheFeeIntact() public pure {
        (uint256 retained, uint256 tribute) = TickerClaimV1.splitTribute(1 ether, 0);
        assertEq(retained, 1 ether);
        assertEq(tribute, 0);
    }

    /// @dev The split is exact. Nothing is created and nothing is lost, at any amount or rate.
    function testFuzz_splitAlwaysSumsToTheInput(uint256 creatorFee, uint16 shareBps) public pure {
        creatorFee = bound(creatorFee, 0, 1_000_000_000 ether);
        shareBps = uint16(bound(shareBps, 0, TickerClaimV1.BASIS_POINTS));

        (uint256 retained, uint256 tribute) = TickerClaimV1.splitTribute(creatorFee, shareBps);
        assertEq(retained + tribute, creatorFee, "split must conserve the fee");
    }

    /// @dev Tribute can never exceed the fee it is drawn from, so a derivative's creator can never end up owing.
    function testFuzz_tributeNeverExceedsTheFee(uint256 creatorFee, uint16 shareBps) public pure {
        creatorFee = bound(creatorFee, 0, 1_000_000_000 ether);
        shareBps = uint16(bound(shareBps, 0, TickerClaimV1.BASIS_POINTS));

        (, uint256 tribute) = TickerClaimV1.splitTribute(creatorFee, shareBps);
        assertLe(tribute, creatorFee);
    }

    /// @dev Rounding favours the derivative's own creator, never the original.
    function testFuzz_roundingFavoursTheDerivative(uint256 creatorFee) public pure {
        creatorFee = bound(creatorFee, 0, 1_000_000_000 ether);

        (uint256 retained, uint256 tribute) = TickerClaimV1.splitTribute(creatorFee, TickerClaimV1.TRIBUTE_SHARE_BPS);
        uint256 exact = FullMath.mulDiv(creatorFee, TickerClaimV1.TRIBUTE_SHARE_BPS, TickerClaimV1.BASIS_POINTS);

        assertEq(tribute, exact);
        assertGe(retained, creatorFee - exact);
    }

    /// @dev Total over the whole uint256 range, not merely over realistic fee amounts. Fuzzing originally found a
    ///      plain multiplication here that overflowed near the type maximum; the split now uses `FullMath.mulDiv`
    ///      like every other fee calculation in the repository.
    function testFuzz_splitNeverReverts(uint256 creatorFee, uint16 shareBps) public pure {
        shareBps = uint16(bound(shareBps, 0, TickerClaimV1.BASIS_POINTS));
        (uint256 retained, uint256 tribute) = TickerClaimV1.splitTribute(creatorFee, shareBps);
        assertEq(retained + tribute, creatorFee, "conserved even at the extremes");
    }
}
