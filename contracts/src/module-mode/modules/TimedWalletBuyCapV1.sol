// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ModuleRuntimeTypesV1 as T } from "../ModuleRuntimeTypesV1.sol";
import { ModuleProgramBaseV1 } from "../ModuleProgramBaseV1.sol";
import { IModuleProgramV1, IModuleProgramFactoryV1 } from "../IModuleProgramV1.sol";

/// @notice Aggregates each authenticated actor's gross native buys during the fixed opening window.
/// @dev This is a per-wallet buy cap, not proof of anti-sniping or anti-Sybil protection. Sells are never capped here.
contract TimedWalletBuyCapV1 is ModuleProgramBaseV1 {
    uint128 public capNative;
    uint64 public endsAt;
    bool public includeInitialBuy;
    mapping(address actor => uint256) public spentNative;

    error InvalidConfiguration();
    error WalletBuyCapExceeded(address actor, uint256 attempted, uint256 cap);

    event BuyCounted(bytes32 indexed executionId, address indexed actor, uint256 cumulativeNative);

    constructor(T.InstanceBinding memory binding, bytes memory config) ModuleProgramBaseV1(binding) {
        if (config.length != 96 || keccak256(config) != binding.configHash) revert InvalidConfiguration();
        uint64 duration;
        (capNative, duration, includeInitialBuy) = abi.decode(config, (uint128, uint64, bool));
        if (capNative == 0 || duration == 0 || duration > 30 days || block.timestamp > type(uint64).max - duration) {
            revert InvalidConfiguration();
        }
        endsAt = uint64(block.timestamp) + duration;
    }

    function onTrade(T.TradeContext calldata context) external returns (bytes4) {
        _authenticate(context.launchKey, context.instanceId);
        if (!context.trade.isBuy || block.timestamp >= endsAt || (context.trade.initialBuy && !includeInitialBuy)) {
            return IModuleProgramV1.onTrade.selector;
        }
        uint256 cumulative = spentNative[context.trade.actor] + context.trade.grossNative;
        if (cumulative > capNative) revert WalletBuyCapExceeded(context.trade.actor, cumulative, capNative);
        spentNative[context.trade.actor] = cumulative;
        emit BuyCounted(context.executionId, context.trade.actor, cumulative);
        return IModuleProgramV1.onTrade.selector;
    }

    function onAction(T.ActionContext calldata context, bytes calldata) external view returns (bytes4) {
        _authenticate(context.launchKey, context.instanceId);
        revert UnsupportedAction();
    }
}

contract TimedWalletBuyCapFactoryV1 is IModuleProgramFactoryV1 {
    error OnlyBindingRuntime();

    function create(T.InstanceBinding calldata binding, bytes calldata config) external returns (address) {
        if (msg.sender != binding.runtime) revert OnlyBindingRuntime();
        return address(new TimedWalletBuyCapV1(binding, config));
    }

    function moduleCodeHash() external pure returns (bytes32) {
        return keccak256(type(TimedWalletBuyCapV1).runtimeCode);
    }
}
