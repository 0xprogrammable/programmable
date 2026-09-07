// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ModuleEngineBaseV1 } from "./ModuleEngineBaseV1.sol";
import { ModuleEngineTypesV1 as T } from "./ModuleEngineTypesV1.sol";

/// @notice Independent contributor reference for a funded, non-trade operation with actor-scoped liabilities.
/// @dev A no-market conformance profile, not the spot launch profile. Its fixed-supply primary token remains locked.
///      Deposits/withdrawals are not trades and have no invented swap fee basis. There is no admin withdrawal.
contract ModuleQuoteEscrowEngineV1 is ModuleEngineBaseV1 {
    using SafeERC20 for IERC20;
    bytes32 public constant DEPOSIT = keccak256("escrow.deposit.v1");
    bytes32 public constant WITHDRAW = keccak256("escrow.withdraw.v1");
    mapping(address actor => uint256) public credit;
    uint256 public totalLiability;
    uint256 public unlockTime;
    error InvalidEscrowOperation();

    constructor(T.Context memory context_, bytes memory configuration) ModuleEngineBaseV1(context_) {
        (address fixedQuote, uint256 unlockTime_) = abi.decode(configuration, (address, uint256));
        if (fixedQuote != address(0) && fixedQuote != context_.quoteAsset) revert InvalidEscrowOperation();
        unlockTime = unlockTime_;
    }

    function _initialize(bytes calldata launchData) internal view override returns (bytes32 resourcesHash) {
        if (launchData.length != 0) revert InvalidEscrowOperation();
        return keccak256(abi.encode(_context.quoteAsset, unlockTime));
    }

    function _execute(T.Operation calldata op) internal override returns (bytes memory) {
        if (msg.value != 0) revert InvalidEscrowOperation();
        if (op.operationId == DEPOSIT) {
            if (
                op.inputAsset != _context.quoteAsset || op.inputAmount == 0 || op.minimumOutput != 0
                    || op.data.length != 0
            ) {
                revert InvalidEscrowOperation();
            }
            credit[op.actor] += op.inputAmount;
            totalLiability += op.inputAmount;
        } else if (op.operationId == WITHDRAW) {
            uint256 amount = abi.decode(op.data, (uint256));
            if (
                block.timestamp < unlockTime || op.inputAmount != 0 || amount == 0 || amount > credit[op.actor]
                    || op.outputAsset != _context.quoteAsset || op.minimumOutput != amount
            ) revert InvalidEscrowOperation();
            credit[op.actor] -= amount;
            totalLiability -= amount;
            IERC20(_context.quoteAsset).safeTransfer(op.recipient, amount);
        } else {
            revert InvalidEscrowOperation();
        }
        if (IERC20(_context.quoteAsset).balanceOf(address(this)) < totalLiability) revert InvalidEscrowOperation();
        return abi.encode(credit[op.actor], totalLiability);
    }
}
