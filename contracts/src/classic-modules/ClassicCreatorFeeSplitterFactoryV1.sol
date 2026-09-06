// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { ClassicCreatorFeeSplitterV1 } from "./ClassicCreatorFeeSplitterV1.sol";

/// @notice Permissionless, caller-salted deployment of immutable Creator fee allocations.
contract ClassicCreatorFeeSplitterFactoryV1 {
    event SplitterCreated(address indexed caller, address indexed splitter, bytes32 indexed salt, bytes32 root);

    function deploy(bytes32 salt, bytes calldata allocations) external returns (ClassicCreatorFeeSplitterV1 splitter) {
        splitter = new ClassicCreatorFeeSplitterV1{ salt: keccak256(abi.encode(msg.sender, salt)) }(allocations);
        emit SplitterCreated(msg.sender, address(splitter), salt, splitter.root());
    }

    function predict(address deployer, bytes32 salt, bytes calldata allocations) external view returns (address) {
        return Create2.computeAddress(
            keccak256(abi.encode(deployer, salt)),
            keccak256(abi.encodePacked(type(ClassicCreatorFeeSplitterV1).creationCode, abi.encode(allocations))),
            address(this)
        );
    }
}
