// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ClassicModuleTypes as T } from "./ClassicModuleTypes.sol";

/// @dev Copies only the fixed ABI result, including when a defective module returns an oversized payload.
library ClassicModuleCalls {
    error ModuleCallFailed(address implementation);

    function read(address implementation, bytes memory input, uint256 expectedBytes)
        internal
        view
        returns (bytes memory output)
    {
        output = new bytes(expectedBytes);
        bool ok;
        uint256 actual;
        uint256 budget = T.MODULE_CALL_GAS;
        assembly ("memory-safe") {
            ok := staticcall(budget, implementation, add(input, 0x20), mload(input), add(output, 0x20), expectedBytes)
            actual := returndatasize()
        }
        if (!ok || actual != expectedBytes) revert ModuleCallFailed(implementation);
    }
}
