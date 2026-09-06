// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ModuleRuntimeTypesV1 as T } from "../ModuleRuntimeTypesV1.sol";
import { ModuleProgramBaseV1 } from "../ModuleProgramBaseV1.sol";
import { IModuleProgramV1, IModuleProgramFactoryV1, IModuleNativeBudgetRuntimeV1 } from "../IModuleProgramV1.sol";

/// @notice Each Nth qualifying buy can earn a fixed native reward from this instance's existing budget.
/// @dev Predictable ordering permits strategic buying; wallet identity does not establish different human owners.
///      A depleted budget skips that reward permanently, without creating debt or blocking a trade.
contract EveryNthBuyRewardV1 is ModuleProgramBaseV1 {
    bytes32 public constant RECLAIM_UNUSED = keccak256("programmable.module-mode.reward.reclaim-unused.v1");
    uint32 public everyN;
    uint128 public minimumGrossNative;
    uint128 public rewardNative;
    uint64 public endsAt;
    bool public includeInitialBuy;
    address public refundWallet;
    uint256 public qualifiedBuys;
    uint256 public rewardedBuys;
    uint256 public totalReclaimed;

    error InvalidConfiguration();
    error ReclaimNotAvailable();

    event RewardEarned(bytes32 indexed executionId, address indexed beneficiary, uint256 qualifyingBuy, uint256 amount);
    event RewardSkipped(bytes32 indexed executionId, uint256 qualifyingBuy, uint256 availableNative);
    event UnusedBudgetReclaimed(bytes32 indexed executionId, address indexed beneficiary, uint256 amount);

    constructor(T.InstanceBinding memory binding, bytes memory config) ModuleProgramBaseV1(binding) {
        if (config.length != 192 || keccak256(config) != binding.configHash) revert InvalidConfiguration();
        (everyN, minimumGrossNative, rewardNative, endsAt, includeInitialBuy, refundWallet) =
            abi.decode(config, (uint32, uint128, uint128, uint64, bool, address));
        if (
            everyN == 0 || minimumGrossNative == 0 || rewardNative == 0 || endsAt <= block.timestamp
                || refundWallet == address(0)
        ) {
            revert InvalidConfiguration();
        }
    }

    function onTrade(T.TradeContext calldata context) external returns (bytes4) {
        _authenticate(context.launchKey, context.instanceId);
        if (
            !context.trade.isBuy || block.timestamp >= endsAt || context.trade.grossNative < minimumGrossNative
                || (context.trade.initialBuy && !includeInitialBuy)
        ) return IModuleProgramV1.onTrade.selector;
        uint256 count = ++qualifiedBuys;
        if (count % everyN != 0) return IModuleProgramV1.onTrade.selector;
        IModuleNativeBudgetRuntimeV1 host = IModuleNativeBudgetRuntimeV1(_runtime());
        uint256 balance = host.available(_instanceId());
        if (balance < rewardNative) {
            emit RewardSkipped(context.executionId, count, balance);
            return IModuleProgramV1.onTrade.selector;
        }
        ++rewardedBuys;
        host.credit(context.trade.actor, rewardNative);
        emit RewardEarned(context.executionId, context.trade.actor, count, rewardNative);
        return IModuleProgramV1.onTrade.selector;
    }

    function onAction(T.ActionContext calldata context, bytes calldata inputs) external returns (bytes4) {
        _authenticate(context.launchKey, context.instanceId);
        if (context.actionId != RECLAIM_UNUSED || inputs.length != 0) revert UnsupportedAction();
        if (context.actor != refundWallet || block.timestamp < endsAt) revert ReclaimNotAvailable();
        IModuleNativeBudgetRuntimeV1 host = IModuleNativeBudgetRuntimeV1(_runtime());
        uint256 balance = host.available(_instanceId());
        if (balance != 0) {
            totalReclaimed += balance;
            host.credit(refundWallet, balance);
            emit UnusedBudgetReclaimed(context.executionId, refundWallet, balance);
        }
        return IModuleProgramV1.onAction.selector;
    }
}

contract EveryNthBuyRewardFactoryV1 is IModuleProgramFactoryV1 {
    error OnlyBindingRuntime();

    function create(T.InstanceBinding calldata binding, bytes calldata config) external returns (address) {
        if (msg.sender != binding.runtime) revert OnlyBindingRuntime();
        return address(new EveryNthBuyRewardV1(binding, config));
    }

    function moduleCodeHash() external pure returns (bytes32) {
        return keccak256(type(EveryNthBuyRewardV1).runtimeCode);
    }
}
