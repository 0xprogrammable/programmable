// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ModuleEngineBaseV1 } from "./ModuleEngineBaseV1.sol";
import { ModuleEngineTypesV1 as T } from "./ModuleEngineTypesV1.sol";

/// @notice Funded request/fulfill/refund contributor profile with a fixed beneficiary and bounded expiry.
/// @dev The payer explicitly trusts this launch's creator to attest fulfillment before the refund time. An evidence
///      hash records that attestation; it is not an oracle proof. The creator cannot change the payer, beneficiary,
///      amount, expiry or obligation. No administrator withdrawal, shared cross-launch funds or invented swap fees.
contract ModuleQuoteSettlementEngineV1 is ModuleEngineBaseV1 {
    using SafeERC20 for IERC20;

    bytes32 public constant REQUEST = keccak256("settlement.request.v1");
    bytes32 public constant FULFILL = keccak256("settlement.fulfill.v1");
    bytes32 public constant REFUND = keccak256("settlement.refund.v1");

    enum Status {
        Missing,
        Pending,
        Fulfilled,
        Refunded
    }

    struct Request {
        address payer;
        address beneficiary;
        uint256 amount;
        uint256 refundAfter;
        bytes32 obligationHash;
        Status status;
    }

    mapping(bytes32 requestId => Request) public requests;
    uint256 public totalLiability;
    uint256 public minimumWindow;
    uint256 public maximumWindow;

    error InvalidSettlementConfiguration();
    error InvalidSettlementOperation();
    error UnknownOrClosedRequest();
    error UnauthorizedSettlement();
    error InvalidSettlementTiming();
    error InvalidSettlementTransfer();

    event SettlementRequested(
        bytes32 indexed requestId,
        address indexed payer,
        address indexed beneficiary,
        address asset,
        uint256 amount,
        uint256 refundAfter,
        bytes32 obligationHash
    );
    event SettlementFulfilled(
        bytes32 indexed requestId, address indexed beneficiary, uint256 amount, bytes32 evidenceHash
    );
    event SettlementRefunded(bytes32 indexed requestId, address indexed payer, uint256 amount);

    constructor(T.Context memory context_, bytes memory configuration) ModuleEngineBaseV1(context_) {
        (minimumWindow, maximumWindow) = abi.decode(configuration, (uint256, uint256));
        if (minimumWindow == 0 || maximumWindow < minimumWindow || maximumWindow > 365 days) {
            revert InvalidSettlementConfiguration();
        }
    }

    function requestIdFor(address payer, uint256 nonce) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, _context.host, _context.launchId, address(this), payer, nonce));
    }

    function _initialize(bytes calldata launchData) internal view override returns (bytes32 resourcesHash) {
        if (launchData.length != 0) revert InvalidSettlementConfiguration();
        return keccak256(abi.encode(_context.quoteAsset, _context.creator, minimumWindow, maximumWindow));
    }

    function _execute(T.Operation calldata op) internal override returns (bytes memory result) {
        if (msg.value != 0) revert InvalidSettlementOperation();
        if (op.operationId == REQUEST) result = _request(op);
        else if (op.operationId == FULFILL) result = _fulfill(op);
        else if (op.operationId == REFUND) result = _refund(op);
        else revert InvalidSettlementOperation();
        if (IERC20(_context.quoteAsset).balanceOf(address(this)) < totalLiability) revert InvalidSettlementTransfer();
    }

    function _request(T.Operation calldata op) private returns (bytes memory) {
        if (
            op.inputAsset != _context.quoteAsset || op.inputAmount == 0 || op.outputAsset != address(0)
                || op.minimumOutput != 0
        ) {
            revert InvalidSettlementOperation();
        }
        (address beneficiary, uint256 refundAfter, bytes32 obligationHash) =
            abi.decode(op.data, (address, uint256, bytes32));
        if (
            beneficiary == address(0) || beneficiary == address(this) || beneficiary == _context.host
                || obligationHash == 0
        ) {
            revert InvalidSettlementOperation();
        }
        if (refundAfter < block.timestamp + minimumWindow || refundAfter > block.timestamp + maximumWindow) {
            revert InvalidSettlementTiming();
        }
        bytes32 requestId = requestIdFor(op.actor, op.nonce);
        if (requests[requestId].status != Status.Missing) revert UnknownOrClosedRequest();
        requests[requestId] =
            Request(op.actor, beneficiary, op.inputAmount, refundAfter, obligationHash, Status.Pending);
        totalLiability += op.inputAmount;
        emit SettlementRequested(
            requestId, op.actor, beneficiary, _context.quoteAsset, op.inputAmount, refundAfter, obligationHash
        );
        return abi.encode(requestId);
    }

    function _fulfill(T.Operation calldata op) private returns (bytes memory) {
        (bytes32 requestId, bytes32 evidenceHash) = abi.decode(op.data, (bytes32, bytes32));
        Request storage request = requests[requestId];
        if (request.status != Status.Pending) revert UnknownOrClosedRequest();
        if (op.actor != _context.creator) revert UnauthorizedSettlement();
        if (block.timestamp >= request.refundAfter) revert InvalidSettlementTiming();
        if (evidenceHash == 0) revert InvalidSettlementOperation();
        _validatePayment(op, request.beneficiary, request.amount);
        request.status = Status.Fulfilled;
        totalLiability -= request.amount;
        _payExactly(request.beneficiary, request.amount);
        emit SettlementFulfilled(requestId, request.beneficiary, request.amount, evidenceHash);
        return abi.encode(requestId, Status.Fulfilled);
    }

    function _refund(T.Operation calldata op) private returns (bytes memory) {
        bytes32 requestId = abi.decode(op.data, (bytes32));
        Request storage request = requests[requestId];
        if (request.status != Status.Pending) revert UnknownOrClosedRequest();
        if (op.actor != request.payer) revert UnauthorizedSettlement();
        if (block.timestamp < request.refundAfter) revert InvalidSettlementTiming();
        _validatePayment(op, request.payer, request.amount);
        request.status = Status.Refunded;
        totalLiability -= request.amount;
        _payExactly(request.payer, request.amount);
        emit SettlementRefunded(requestId, request.payer, request.amount);
        return abi.encode(requestId, Status.Refunded);
    }

    function _validatePayment(T.Operation calldata op, address recipient, uint256 amount) private view {
        if (
            op.inputAsset != address(0) || op.inputAmount != 0 || op.outputAsset != _context.quoteAsset
                || op.recipient != recipient || op.minimumOutput != amount
        ) revert InvalidSettlementOperation();
    }

    function _payExactly(address recipient, uint256 amount) private {
        IERC20 quote = IERC20(_context.quoteAsset);
        uint256 beforeEngine = quote.balanceOf(address(this));
        uint256 beforeRecipient = quote.balanceOf(recipient);
        quote.safeTransfer(recipient, amount);
        if (
            beforeEngine - quote.balanceOf(address(this)) != amount
                || quote.balanceOf(recipient) - beforeRecipient != amount
        ) {
            revert InvalidSettlementTransfer();
        }
    }
}
