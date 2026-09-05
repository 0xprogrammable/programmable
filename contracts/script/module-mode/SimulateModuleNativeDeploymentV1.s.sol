// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";

/// @notice Executes the exact prepared zero-value calls only in Forge's local fork.
/// @dev No startBroadcast, signing, private key or live transaction path exists in this script.
///      Simulation proves constructor execution and full immutable runtime bytes, not publication or finality.
contract SimulateModuleNativeDeploymentV1 is Script {
    function run() external {
        vm.createSelectFork(vm.envString("MODULE_MODE_SIMULATION_RPC_URL"), vm.envUint("MODULE_MODE_SIMULATION_BLOCK"));
        bytes memory encoded = vm.readFileBinary(vm.envString("MODULE_MODE_SIMULATION_INPUT"));
        (
            uint256 expectedChain,
            address[] memory senders,
            address[] memory targets,
            bytes[] memory payloads,
            address[] memory codeTargets,
            bytes32[] memory codeHashes
        ) = abi.decode(encoded, (uint256, address[], address[], bytes[], address[], bytes32[]));
        require(block.chainid == 4663 && expectedChain == block.chainid, "chain mismatch");
        require(senders.length == targets.length && targets.length == payloads.length, "invalid calls");
        require(codeTargets.length == codeHashes.length, "invalid code pins");
        for (uint256 i; i < targets.length; ++i) {
            // The deterministic deployment proxy returns the deployed 20-byte address. This call is local only.
            uint256 beforeGas = gasleft();
            vm.prank(senders[i]);
            (bool success, bytes memory result) = targets[i].call(payloads[i]);
            require(success && result.length == 20, "deployment simulation failed");
            console2.log("Stage", i);
            console2.log("Local call gas (not a transaction estimate)", beforeGas - gasleft());
        }
        for (uint256 i; i < codeTargets.length; ++i) {
            require(codeTargets[i].code.length != 0 && codeTargets[i].codehash == codeHashes[i], "runtime mismatch");
        }
        console2.log("All prepared constructor and runtime assertions passed on a local fork");
    }
}
