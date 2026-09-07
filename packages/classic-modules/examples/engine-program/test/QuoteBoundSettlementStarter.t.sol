// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { QuoteBoundSettlementV1 } from "../src/QuoteBoundSettlementV1.sol";
import { ModuleQuoteSettlementEngineV1 as Settlement } from "../src/module-engine/ModuleQuoteSettlementEngineV1.sol";
import { ModuleEngineBaseV1 } from "../src/module-engine/ModuleEngineBaseV1.sol";
import { ModuleEngineTypesV1 as T } from "../src/module-engine/ModuleEngineTypesV1.sol";

interface Vm {
    function warp(uint256 timestamp) external;
    function prank(address caller) external;
    function expectRevert(bytes4 selector) external;
}

/// @dev Local standard-token fixture with an explicit transfer-tax switch for rollback checks.
contract StarterAsset {
    mapping(address => uint256) public balanceOf;
    bool public tax;

    function mint(address recipient, uint256 amount) external {
        balanceOf[recipient] += amount;
    }

    function setTax(bool enabled) external {
        tax = enabled;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += tax ? amount - 1 : amount;
        return true;
    }
}

/// @dev This test contract supplies the canonical host ABI context. It is not a deployable host or registry.
contract QuoteBoundSettlementStarterTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant PAYER = address(0xA11CE);
    address private constant BENEFICIARY = address(0xBEEF);
    address private constant PRIMARY = address(0x1001);
    bytes32 private constant REQUEST = keccak256("settlement.request.v1");
    bytes32 private constant FULFILL = keccak256("settlement.fulfill.v1");
    bytes32 private constant REFUND = keccak256("settlement.refund.v1");
    StarterAsset private quote;
    QuoteBoundSettlementV1 private engine;

    function setUp() public {
        vm.warp(1_800_000_100);
        quote = new StarterAsset();
        engine = new QuoteBoundSettlementV1(_context(address(quote)), _configuration(address(quote)));
        require(
            engine.initialize("")
                == keccak256(abi.encode(address(quote), address(this), uint256(60), uint256(30 days))),
            "resources"
        );
    }

    function _context(address asset) private view returns (T.Context memory) {
        return T.Context(address(this), keccak256("local engine fixture"), PRIMARY, address(this), asset, address(this));
    }

    function _configuration(address asset) private pure returns (bytes memory) {
        return abi.encode(asset, uint256(60), uint256(30 days));
    }

    function _operation(bytes32 id, address actor) private view returns (T.Operation memory op) {
        op.operationId = id;
        op.actor = actor;
        op.recipient = actor;
        op.deadline = block.timestamp + 1 days;
    }

    function _request(uint256 nonce, uint256 amount) private returns (bytes32 id) {
        quote.mint(PAYER, amount);
        vm.prank(PAYER);
        quote.transfer(address(engine), amount);
        T.Operation memory op = _operation(REQUEST, PAYER);
        op.inputAsset = address(quote);
        op.inputAmount = amount;
        op.nonce = nonce;
        op.data = abi.encode(BENEFICIARY, uint256(1_800_003_700), keccak256("fixed delivery obligation"));
        id = abi.decode(engine.execute(op), (bytes32));
        require(id == engine.requestIdFor(PAYER, nonce), "request identity");
    }

    function _close(bytes32 id, bool fulfill, uint256 amount) private view returns (T.Operation memory op) {
        op = _operation(fulfill ? FULFILL : REFUND, fulfill ? address(this) : PAYER);
        op.recipient = fulfill ? BENEFICIARY : PAYER;
        op.outputAsset = address(quote);
        op.minimumOutput = amount;
        op.data = fulfill ? abi.encode(id, keccak256("creator attestation")) : abi.encode(id);
    }

    function test_twoQuoteAssetsShareCreationCodeAndFixedWindowsCannotChange() public {
        StarterAsset other = new StarterAsset();
        QuoteBoundSettlementV1 second =
            new QuoteBoundSettlementV1(_context(address(other)), _configuration(address(other)));
        require(address(second).codehash == address(engine).codehash, "storage context has stable runtime");
        require(second.context().quoteAsset == address(other), "second quote");
        vm.expectRevert(QuoteBoundSettlementV1.QuoteContextMismatch.selector);
        new QuoteBoundSettlementV1(_context(address(other)), _configuration(address(quote)));
        vm.expectRevert(QuoteBoundSettlementV1.FixedWindowOverride.selector);
        new QuoteBoundSettlementV1(_context(address(quote)), abi.encode(address(quote), uint256(61), uint256(30 days)));
        vm.expectRevert(QuoteBoundSettlementV1.InvalidConfigurationBytes.selector);
        new QuoteBoundSettlementV1(_context(address(quote)), bytes.concat(_configuration(address(quote)), hex"00"));
    }

    function test_requestFulfillIsBoundToBeneficiaryAmountAndCreator() public {
        bytes32 id = _request(0, 100);
        T.Operation memory op = _close(id, true, 100);
        op.actor = PAYER;
        vm.expectRevert(Settlement.UnauthorizedSettlement.selector);
        engine.execute(op);
        op.actor = address(this);
        op.recipient = PAYER;
        vm.expectRevert(Settlement.InvalidSettlementOperation.selector);
        engine.execute(op);
        op.recipient = BENEFICIARY;
        op.minimumOutput = 99;
        vm.expectRevert(Settlement.InvalidSettlementOperation.selector);
        engine.execute(op);
        op.minimumOutput = 100;
        engine.execute(op);
        require(quote.balanceOf(BENEFICIARY) == 100 && engine.totalLiability() == 0, "exact fulfillment");
        (,,,,, Settlement.Status status) = engine.requests(id);
        require(status == Settlement.Status.Fulfilled, "terminal status");
        vm.expectRevert(Settlement.UnknownOrClosedRequest.selector);
        engine.execute(op);
    }

    function test_expiryRefundPaysOnlyOriginalPayer() public {
        bytes32 id = _request(0, 100);
        T.Operation memory refund = _close(id, false, 100);
        vm.expectRevert(Settlement.InvalidSettlementTiming.selector);
        engine.execute(refund);
        vm.warp(1_800_003_700);
        T.Operation memory fulfill = _close(id, true, 100);
        vm.expectRevert(Settlement.InvalidSettlementTiming.selector);
        engine.execute(fulfill);
        refund.actor = BENEFICIARY;
        vm.expectRevert(Settlement.UnauthorizedSettlement.selector);
        engine.execute(refund);
        refund.actor = PAYER;
        engine.execute(refund);
        require(quote.balanceOf(PAYER) == 100 && engine.totalLiability() == 0, "exact refund");
        (,,,,, Settlement.Status status) = engine.requests(id);
        require(status == Settlement.Status.Refunded, "refund status");
        vm.expectRevert(Settlement.UnknownOrClosedRequest.selector);
        engine.execute(refund);
    }

    function test_fulfillmentCannotConsumeAnotherRequestOrRefundAfterPayment() public {
        bytes32 first = _request(0, 100);
        bytes32 second = _request(1, 200);
        engine.execute(_close(first, true, 100));
        require(engine.totalLiability() == 200 && quote.balanceOf(address(engine)) == 200, "other liability");
        (,,,,, Settlement.Status status) = engine.requests(second);
        require(status == Settlement.Status.Pending, "other request");
        vm.warp(1_800_003_700);
        T.Operation memory refund = _close(first, false, 100);
        vm.expectRevert(Settlement.UnknownOrClosedRequest.selector);
        engine.execute(refund);
    }

    function test_taxedTransferRevertsTheEntireSettlement() public {
        bytes32 id = _request(0, 100);
        quote.setTax(true);
        T.Operation memory op = _close(id, true, 100);
        vm.expectRevert(Settlement.InvalidSettlementTransfer.selector);
        engine.execute(op);
        require(quote.balanceOf(BENEFICIARY) == 0 && quote.balanceOf(address(engine)) == 100, "transfer rollback");
        require(engine.totalLiability() == 100, "liability rollback");
        (,,,,, Settlement.Status status) = engine.requests(id);
        require(status == Settlement.Status.Pending, "status rollback");
    }

    function test_directCallerAndRepeatedInitializeAreRejected() public {
        T.Operation memory op = _operation(REQUEST, PAYER);
        vm.prank(PAYER);
        vm.expectRevert(ModuleEngineBaseV1.UnauthorizedHost.selector);
        engine.execute(op);
        vm.prank(PAYER);
        vm.expectRevert(ModuleEngineBaseV1.UnauthorizedHost.selector);
        engine.initialize("");
        vm.expectRevert(ModuleEngineBaseV1.AlreadyInitialized.selector);
        engine.initialize("");
    }
}
