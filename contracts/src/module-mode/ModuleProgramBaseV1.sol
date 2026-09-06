// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ModuleRuntimeTypesV1 as T } from "./ModuleRuntimeTypesV1.sol";
import { IModuleProgramV1 } from "./IModuleProgramV1.sol";

/// @dev Constructor-only storage keeps the compiled runtime hash identical across instances. There are no setters.
///      Code admission must exclude mutable proxy/dependency paths; a direct codehash alone cannot prove that.
abstract contract ModuleProgramBaseV1 is IModuleProgramV1 {
    T.InstanceBinding private _binding;

    error InvalidBinding();
    error OnlyBoundRuntime();
    error UnsupportedAction();

    constructor(T.InstanceBinding memory binding) {
        if (
            binding.runtime.code.length == 0 || binding.launchKey == bytes32(0) || binding.instanceId == bytes32(0)
                || binding.packageId == bytes32(0)
        ) revert InvalidBinding();
        _binding = binding;
    }

    function bindingHash() external view returns (bytes32) {
        return keccak256(abi.encode(_binding));
    }

    function instanceBinding() external view returns (T.InstanceBinding memory) {
        return _binding;
    }

    function _authenticate(bytes32 launchKey, bytes32 instanceId) internal view {
        if (msg.sender != _binding.runtime || launchKey != _binding.launchKey || instanceId != _binding.instanceId) {
            revert OnlyBoundRuntime();
        }
    }

    function _runtime() internal view returns (address) {
        return _binding.runtime;
    }

    function _instanceId() internal view returns (bytes32) {
        return _binding.instanceId;
    }
}
