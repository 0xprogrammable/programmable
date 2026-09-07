// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IModuleEngineV1 } from "./IModuleEngineV1.sol";
import { ModuleEngineTypesV1 as T } from "./ModuleEngineTypesV1.sol";

/// @notice Minimal contributor base. No delegatecall, token minting, external approvals or shared custody.
abstract contract ModuleEngineBaseV1 is IModuleEngineV1 {
    T.Context internal _context;
    bytes32 public contextHash;
    bool public initialized;

    error UnauthorizedHost();
    error AlreadyInitialized();
    error NotInitialized();
    error InvalidContext();

    constructor(T.Context memory context_) {
        if (
            context_.host != msg.sender || context_.host == address(0) || context_.token == address(0)
                || context_.creator == address(0) || context_.quoteAsset == address(0)
                || context_.token == context_.quoteAsset || context_.launchId == bytes32(0)
                || context_.feeCollector == address(0)
        ) revert InvalidContext();
        _context = context_;
        contextHash = keccak256(abi.encode(context_));
    }

    modifier onlyHost() {
        if (msg.sender != _context.host) revert UnauthorizedHost();
        _;
    }

    function context() external view returns (T.Context memory) {
        return _context;
    }

    function initialize(bytes calldata launchData) external onlyHost returns (bytes32 resourcesHash) {
        if (initialized) revert AlreadyInitialized();
        initialized = true;
        return _initialize(launchData);
    }

    function execute(T.Operation calldata operation) external payable onlyHost returns (bytes memory result) {
        if (!initialized) revert NotInitialized();
        return _execute(operation);
    }

    function _initialize(bytes calldata launchData) internal virtual returns (bytes32 resourcesHash);
    function _execute(T.Operation calldata operation) internal virtual returns (bytes memory result);
}
