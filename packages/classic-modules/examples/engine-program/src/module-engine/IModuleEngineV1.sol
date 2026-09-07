// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ModuleEngineTypesV1 as T } from "./ModuleEngineTypesV1.sol";

interface IModuleEngineV1 {
    function contextHash() external view returns (bytes32);
    function initialize(bytes calldata launchData) external returns (bytes32 resourcesHash);
    function execute(T.Operation calldata operation) external payable returns (bytes memory result);
}

interface IModuleEngineFeeCollectorV1 {
    function feeTerms(bytes32 launchId, bool buy) external view returns (uint16 platformBps, uint16 creatorBps);
    function depositFees(uint256 platformFee, uint256 creatorFee) external payable;
}

interface IModuleEngineAdmissionV1 {
    function fixedConfigurationHash(bytes32 launchId) external view returns (bytes32);
}
