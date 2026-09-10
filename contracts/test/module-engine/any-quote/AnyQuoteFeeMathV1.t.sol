// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {AnyQuoteFeeMathV1 as F} from "../../../src/module-engine/any-quote/AnyQuoteFeeMathV1.sol";

contract AnyQuoteFeeMathHarness {
    function gross(uint256 amount, uint16 bps, F.Carry memory carry) external pure returns (F.Result memory) {
        return F.quoteGross(amount, bps, carry);
    }

    function net(uint256 amount, uint16 bps, F.Carry memory carry) external pure returns (uint256, F.Result memory) {
        return F.quoteNet(amount, bps, carry);
    }
}

contract AnyQuoteFeeMathV1Test is Test {
    uint256 private constant MAX_AMOUNT = uint256(uint128(type(int128).max));
    AnyQuoteFeeMathHarness private harness = new AnyQuoteFeeMathHarness();

    function testBothFeesUseSameGrossBasis() public pure {
        F.Result memory result = F.quoteGross(100 ether, 100, F.Carry(0, 0));
        assertEq(result.platform, 0.3 ether);
        assertEq(result.creator, 1 ether);
        assertEq(100 ether - result.platform - result.creator, 98.7 ether);
    }

    function testNetIsNotMonotoneAtJointRoundingBoundary() public pure {
        F.Result memory beforeJump = F.quoteGross(999, 100, F.Carry(0, 0));
        F.Result memory afterJump = F.quoteGross(1_000, 100, F.Carry(0, 0));
        assertEq(999 - beforeJump.platform - beforeJump.creator, 988);
        assertEq(1_000 - afterJump.platform - afterJump.creator, 987);
        (uint256 gross, F.Result memory result) = F.quoteNet(987, 100, F.Carry(0, 0));
        assertEq(gross, 998);
        assertEq(gross - result.platform - result.creator, 987);
    }

    function testDustWithTwoCarriedFeesDoesNotUnderflowInInversion() public pure {
        F.Carry memory carry = F.Carry(9_999, 9_999);
        F.Result memory dust = F.quoteGross(1, 1_000, carry);
        assertEq(dust.platform + dust.creator, 2);
        (uint256 gross, F.Result memory result) = F.quoteNet(1, 1_000, carry);
        assertEq(gross, 3);
        assertEq(gross - result.platform - result.creator, 1);
    }

    function testInvalidParametersAndUnrepresentableGrossReject() public {
        vm.expectRevert(F.InvalidFeeParameters.selector);
        harness.gross(1, 1_001, F.Carry(0, 0));
        vm.expectRevert(F.InvalidFeeParameters.selector);
        harness.gross(1, 0, F.Carry(10_000, 0));
        vm.expectRevert(F.InvalidFeeAmount.selector);
        harness.gross(0, 0, F.Carry(0, 0));
        vm.expectRevert(F.InvalidFeeAmount.selector);
        harness.gross(MAX_AMOUNT + 1, 0, F.Carry(0, 0));
        vm.expectRevert(F.NoPositiveNetAmount.selector);
        harness.net(MAX_AMOUNT, 1_000, F.Carry(0, 0));
    }

    function testFuzzSplittingGrossPreservesTotalFeesAndRemainders(uint128 first, uint128 second, uint16 bps) public {
        first = uint128(bound(first, 1, MAX_AMOUNT / 2));
        second = uint128(bound(second, 1, MAX_AMOUNT / 2));
        bps = uint16(bound(bps, 0, 1_000));
        F.Result memory one = F.quoteGross(first, bps, F.Carry(0, 0));
        F.Result memory two = F.quoteGross(second, bps, one.next);
        F.Result memory joined = F.quoteGross(uint256(first) + second, bps, F.Carry(0, 0));
        assertEq(one.platform + two.platform, joined.platform);
        assertEq(one.creator + two.creator, joined.creator);
        assertEq(two.next.platform, joined.next.platform);
        assertEq(two.next.creator, joined.next.creator);
    }

    function testFuzzExactOutputUsesSmallestExactGross(uint128 net, uint16 bps, uint16 rp, uint16 rc) public {
        net = uint128(bound(net, 1, MAX_AMOUNT * 8_970 / 10_000 - 2));
        bps = uint16(bound(bps, 0, 1_000));
        rp = uint16(bound(rp, 0, 9_999));
        rc = uint16(bound(rc, 0, 9_999));
        F.Carry memory carry = F.Carry(rp, rc);
        (uint256 gross, F.Result memory result) = F.quoteNet(net, bps, carry);
        assertEq(gross - result.platform - result.creator, net);
        assertLt(result.next.platform, 10_000);
        assertLt(result.next.creator, 10_000);
        uint256 lower = gross > 4 ? gross - 4 : 1;
        for (uint256 candidate = lower; candidate < gross; ++candidate) {
            F.Result memory prior = F.quoteGross(candidate, bps, carry);
            uint256 fee = prior.platform + prior.creator;
            assertTrue(fee >= candidate || candidate - fee != net);
        }
    }
}
