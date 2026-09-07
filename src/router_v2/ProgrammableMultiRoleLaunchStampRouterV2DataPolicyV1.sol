// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IProgrammableCreate2GraphDeployerV1 } from "../interfaces/IProgrammableCreate2GraphDeployerV1.sol";
import { ProgrammableMultiRoleLaunchStampRouterV2 } from "./ProgrammableMultiRoleLaunchStampRouterV2.sol";

/// @title ProgrammableMultiRoleLaunchStampRouterV2DataPolicyV1
/// @notice A separately deployed V2 Router with conservative runtime-data recognition.
/// @dev Keeps the V2 launch/permit ABI. Its distinct address binds the permit domain and provenance.
///      Admission must verify this exact reviewed runtime, not trust the policy getter by itself.
contract ProgrammableMultiRoleLaunchStampRouterV2DataPolicyV1 is ProgrammableMultiRoleLaunchStampRouterV2 {
    error UnsupportedRuntimeMode(uint256 targetIndex);

    constructor(address permitAuthority, IProgrammableCreate2GraphDeployerV1 graphFactory, IPoolManager poolManager)
        ProgrammableMultiRoleLaunchStampRouterV2(permitAuthority, graphFactory, poolManager)
    { }

    function runtimeInstructionPolicy() external pure returns (bytes32) {
        return keccak256("programmable.runtime-instructions.reachable.v1");
    }

    /// @dev Decode the complete legacy-EVM byte stream, including nonexecuting regions, so JUMPDEST
    ///      validity exactly respects every PUSH immediate. PC 0 and every decoded JUMPDEST are
    ///      potential entry points, without assuming a stack value or resolving dynamic jumps.
    ///      Only no-fallthrough instructions close a region. A later JUMPDEST always reopens it.
    ///      Other undefined opcodes are conservatively treated as fallthrough; no metadata offsets,
    ///      compiler markers, topic hashes, or caller-supplied classifications are trusted.
    ///      This does not prove constructors, external CALL dependencies, liveness, or economics.
    function _validateRuntimeOpcodes(uint256 targetIndex, bytes memory runtimeCode) internal pure override {
        uint256 length = runtimeCode.length;
        // The proof below applies to legacy EVM code, not EOF containers or delegation designators.
        if (length != 0 && runtimeCode[0] == 0xef) revert UnsupportedRuntimeMode(targetIndex);
        bool executable = true;
        for (uint256 pc; pc < length;) {
            uint8 opcode = uint8(runtimeCode[pc]);
            if (opcode == 0x5b) executable = true;
            if (executable && (opcode == 0xff || opcode == 0xf2 || opcode == 0xf4)) {
                revert ForbiddenRuntimeOpcode(targetIndex, pc, opcode);
            }
            if (opcode == 0x00 || opcode == 0x56 || opcode == 0xf3 || opcode == 0xfd || opcode == 0xfe) {
                executable = false;
            }
            // This also skips PUSH data in dead regions; truncated data cannot create a jump target.
            pc += opcode >= 0x60 && opcode <= 0x7f ? uint256(opcode) - 0x5f + 1 : 1;
        }
    }
}
