// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @dev Extends the existing Native/Classic bounded-call pattern to dynamic engine results without copying a
///      contributor-controlled returndata payload first. Revert diagnostics are separately bounded at 4096 bytes.
library ModuleEngineCallsV1 {
    error EngineReturnLimit(address engine, uint256 actual, uint256 maximum);

    function invoke(address engine, uint256 value, uint32 budget, bytes memory input, uint256 maximum)
        internal
        returns (bytes memory output)
    {
        bool ok;
        uint256 size;
        assembly ("memory-safe") {
            ok := call(budget, engine, value, add(input, 32), mload(input), 0, 0)
            size := returndatasize()
        }
        uint256 limit = ok ? maximum : 4096;
        if (size > limit) revert EngineReturnLimit(engine, size, limit);
        output = new bytes(size);
        assembly ("memory-safe") { returndatacopy(add(output, 32), 0, size) }
        if (!ok) {
            assembly ("memory-safe") { revert(add(output, 32), size) }
        }
    }
}
