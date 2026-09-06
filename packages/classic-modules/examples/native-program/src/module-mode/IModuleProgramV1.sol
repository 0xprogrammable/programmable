// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ModuleRuntimeTypesV1 as T } from "./ModuleRuntimeTypesV1.sol";

/// @notice Ordinary per-launch program code; a successful callback acknowledges the exact invoked selector.
interface IModuleProgramV1 {
    function bindingHash() external view returns (bytes32);
    function onTrade(T.TradeContext calldata context) external returns (bytes4);
    function onAction(T.ActionContext calldata context, bytes calldata inputs) external returns (bytes4);
}

interface IModuleProgramFactoryV1 {
    function create(T.InstanceBinding calldata binding, bytes calldata config) external returns (address);
}

interface IModuleNativeBudgetRuntimeV1 {
    function available(bytes32 instanceId) external view returns (uint256);
    function credit(address beneficiary, uint256 amount) external;
}
