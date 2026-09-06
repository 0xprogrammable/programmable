// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { ModuleNativeRuntimeV1 } from "../ModuleNativeRuntimeV1.sol";

/// @notice Creates exactly one fixed runtime for each already-deployed engine; no administrator or substitutions.
/// @dev Kept outside hook runtime bytecode to preserve EIP-170 deployment size limits.
contract ModuleNativeRuntimeFactoryV1 {
    bytes32 public constant SALT_DOMAIN = keccak256("programmable.module-mode.native-runtime.v1");
    mapping(address engine => ModuleNativeRuntimeV1) public runtimeOf;

    function create() external returns (ModuleNativeRuntimeV1 runtime) {
        runtime = runtimeOf[msg.sender];
        if (address(runtime) == address(0)) {
            runtime = new ModuleNativeRuntimeV1{ salt: deploymentSalt(msg.sender) }(msg.sender);
            runtimeOf[msg.sender] = runtime;
        }
    }

    /// @notice Other engines cannot consume this engine's address or affect it by advancing a factory nonce.
    function predict(address engine) external view returns (address) {
        return Create2.computeAddress(
            deploymentSalt(engine),
            keccak256(abi.encodePacked(type(ModuleNativeRuntimeV1).creationCode, abi.encode(engine)))
        );
    }

    function deploymentSalt(address engine) public pure returns (bytes32) {
        return keccak256(abi.encode(SALT_DOMAIN, engine));
    }
}
