// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { EngineHostTestBase } from "./ModuleEngineHostV1.t.sol";
import { ModuleEngineHostV1 } from "../../src/module-engine/ModuleEngineHostV1.sol";
import { ModuleQuoteSettlementEngineV1 as Settlement } from "../../src/module-engine/ModuleQuoteSettlementEngineV1.sol";
import { ModuleEngineTypesV1 as T } from "../../src/module-engine/ModuleEngineTypesV1.sol";

contract ModuleQuoteSettlementEngineV1Test is EngineHostTestBase {
    bytes32 internal constant REVISION = keccak256("bounded settlement contributor");
    bytes32 internal constant REQUEST = keccak256("settlement.request.v1");
    bytes32 internal constant FULFILL = keccak256("settlement.fulfill.v1");
    bytes32 internal constant REFUND = keccak256("settlement.refund.v1");
    address internal beneficiary = address(0x4444);
    ModuleEngineHostV1.Launch internal launched;
    Settlement internal engine;

    function setUp() public {
        _setUpHost();
        T.Revision memory revision =
            _revision(type(Settlement).creationCode, type(Settlement).runtimeCode, 0, T.ROLE_QUOTE);
        revision.fixedConfigurationHash = keccak256(abi.encode(uint256(60), uint256(30 days)));
        T.Permission[] memory permissions = new T.Permission[](3);
        permissions[0] = T.Permission(REQUEST, T.ROLE_QUOTE, 0, T.AUTH_PUBLIC);
        permissions[1] = T.Permission(FULFILL, 0, T.ROLE_QUOTE, T.AUTH_CREATOR);
        permissions[2] = T.Permission(REFUND, 0, T.ROLE_QUOTE, T.AUTH_PUBLIC);
        host.approveRevision(REVISION, revision, new uint32[](0), new uint32[](0), permissions, new bytes32[](0));
        launched = host.launch(_settlementParameters(1));
        engine = Settlement(launched.engine);
    }

    function _settlementParameters(uint256 salt) private view returns (ModuleEngineHostV1.LaunchParameters memory p) {
        p = _params(REVISION, address(quote), salt);
        p.configuration = abi.encode(uint256(60), uint256(30 days));
        p.creationCode = type(Settlement).creationCode;
        p.runtimeTemplate = type(Settlement).runtimeCode;
    }

    function _request(uint256 amount, uint256 nonce, uint256 refundAfter) private returns (bytes32 requestId) {
        T.Operation memory op = _op(REQUEST, alice, address(quote), amount, address(0), 0, nonce);
        op.data = abi.encode(beneficiary, refundAfter, keccak256("payer's fixed obligation"));
        vm.prank(alice);
        bytes memory returned = host.execute(launched.launchId, op);
        return abi.decode(returned, (bytes32));
    }

    function _close(bytes32 id, bool fulfill, uint256 amount, uint256 nonce)
        private
        view
        returns (T.Operation memory op)
    {
        op = _op(
            fulfill ? FULFILL : REFUND, fulfill ? address(this) : alice, address(0), 0, address(quote), amount, nonce
        );
        op.recipient = fulfill ? beneficiary : alice;
        op.data = fulfill ? abi.encode(id, keccak256("creator attestation")) : abi.encode(id);
    }

    function test_requestFulfillPaysOnlyBoundBeneficiaryAndClosesOnce() public {
        bytes32 id = _request(10 ether, 0, block.timestamp + 1 hours);
        assertEq(id, engine.requestIdFor(alice, 0));
        assertEq(engine.totalLiability(), 10 ether);
        assertEq(quote.balanceOf(beneficiary), 0);
        T.Operation memory fulfill = _close(id, true, 10 ether, 0);
        host.execute(launched.launchId, fulfill);
        assertEq(quote.balanceOf(beneficiary), 10 ether);
        assertEq(engine.totalLiability(), 0);
        (,,,,, Settlement.Status status) = engine.requests(id);
        assertEq(uint8(status), uint8(Settlement.Status.Fulfilled));
        fulfill.nonce = 1;
        vm.expectRevert(Settlement.UnknownOrClosedRequest.selector);
        host.execute(launched.launchId, fulfill);
        vm.warp(block.timestamp + 1 days);
        T.Operation memory refund = _close(id, false, 10 ether, 1);
        vm.prank(alice);
        vm.expectRevert(Settlement.UnknownOrClosedRequest.selector);
        host.execute(launched.launchId, refund);
        assertEq(host.ledger().totalFeesReceived(), 0);
    }

    function test_expiredRequestRefundRestoresPayerAndBlocksLateFulfill() public {
        uint256 expires = block.timestamp + 1 hours;
        bytes32 id = _request(10 ether, 0, expires);
        T.Operation memory refund = _close(id, false, 10 ether, 1);
        vm.prank(alice);
        vm.expectRevert(Settlement.InvalidSettlementTiming.selector);
        host.execute(launched.launchId, refund);
        vm.warp(expires);
        T.Operation memory fulfill = _close(id, true, 10 ether, 0);
        vm.expectRevert(Settlement.InvalidSettlementTiming.selector);
        host.execute(launched.launchId, fulfill);
        vm.prank(alice);
        host.execute(launched.launchId, refund);
        assertEq(quote.balanceOf(alice), 1000 ether);
        assertEq(engine.totalLiability(), 0);
        (,,,,, Settlement.Status status) = engine.requests(id);
        assertEq(uint8(status), uint8(Settlement.Status.Refunded));
    }

    function test_cannotRedirectChangeAmountOrFulfillWithoutAuthority() public {
        bytes32 id = _request(10 ether, 0, block.timestamp + 1 hours);
        T.Operation memory fulfill = _close(id, true, 10 ether, 0);
        fulfill.recipient = address(this);
        vm.expectRevert(Settlement.InvalidSettlementOperation.selector);
        host.execute(launched.launchId, fulfill);
        fulfill.recipient = beneficiary;
        fulfill.minimumOutput = 9 ether;
        vm.expectRevert(Settlement.InvalidSettlementOperation.selector);
        host.execute(launched.launchId, fulfill);
        fulfill.minimumOutput = 10 ether;
        fulfill.actor = alice;
        fulfill.nonce = 1;
        vm.prank(alice);
        vm.expectRevert(ModuleEngineHostV1.UnauthorizedOperation.selector);
        host.execute(launched.launchId, fulfill);
        assertEq(engine.totalLiability(), 10 ether);
        assertEq(quote.balanceOf(launched.engine), 10 ether);
        assertEq(quote.balanceOf(beneficiary), 0);
    }

    function test_requestCannotSpendAnotherRequestOrAnotherLaunch() public {
        bytes32 firstId = _request(10 ether, 0, block.timestamp + 1 hours);
        bytes32 secondId = _request(20 ether, 1, block.timestamp + 2 hours);
        ModuleEngineHostV1.Launch memory other = host.launch(_settlementParameters(2));
        T.Operation memory fulfill = _close(firstId, true, 10 ether, 0);
        vm.expectRevert(Settlement.UnknownOrClosedRequest.selector);
        host.execute(other.launchId, fulfill);
        host.execute(launched.launchId, fulfill);
        assertEq(engine.totalLiability(), 20 ether);
        assertEq(quote.balanceOf(launched.engine), 20 ether);
        assertEq(quote.balanceOf(other.engine), 0);
        (,,,,, Settlement.Status status) = engine.requests(secondId);
        assertEq(uint8(status), uint8(Settlement.Status.Pending));
    }

    function test_badTransferCannotCloseRequestOrConsumeOtherLiability() public {
        bytes32 id = _request(10 ether, 0, block.timestamp + 1 hours);
        _request(20 ether, 1, block.timestamp + 1 hours);
        quote.setTax(true);
        T.Operation memory fulfill = _close(id, true, 10 ether, 0);
        vm.expectRevert(Settlement.InvalidSettlementTransfer.selector);
        host.execute(launched.launchId, fulfill);
        assertEq(engine.totalLiability(), 30 ether);
        assertEq(quote.balanceOf(launched.engine), 30 ether);
        assertEq(quote.balanceOf(beneficiary), 0);
        (,,,,, Settlement.Status status) = engine.requests(id);
        assertEq(uint8(status), uint8(Settlement.Status.Pending));
        assertEq(host.nonces(launched.launchId, address(this)), 0);
    }

    function test_missingObligationAndOutOfBoundsDeadlineRejectBeforeLiability() public {
        T.Operation memory request = _op(REQUEST, alice, address(quote), 10 ether, address(0), 0, 0);
        request.data = abi.encode(beneficiary, block.timestamp + 1 hours, bytes32(0));
        vm.prank(alice);
        vm.expectRevert(Settlement.InvalidSettlementOperation.selector);
        host.execute(launched.launchId, request);
        request.data = abi.encode(beneficiary, block.timestamp + 1, bytes32("obligation"));
        vm.prank(alice);
        vm.expectRevert(Settlement.InvalidSettlementTiming.selector);
        host.execute(launched.launchId, request);
        assertEq(engine.totalLiability(), 0);
        assertEq(quote.balanceOf(alice), 1000 ether);
    }

    receive() external payable { }
}
