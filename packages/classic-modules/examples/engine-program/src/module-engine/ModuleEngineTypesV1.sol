// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

library ModuleEngineTypesV1 {
    uint8 internal constant ROLE_NONE = 0;
    uint8 internal constant ROLE_PRIMARY = 1;
    uint8 internal constant ROLE_QUOTE = 2;
    uint8 internal constant ROLE_NATIVE = 4;
    uint8 internal constant AUTH_PUBLIC = 0;
    uint8 internal constant AUTH_CREATOR = 1;

    /// @dev Canonical constructor: constructor(Context memory context, bytes memory configuration).
    struct Context {
        address host;
        bytes32 launchId;
        address token;
        address creator;
        address quoteAsset;
        address feeCollector;
    }

    /// @dev The host supplies actor and consumes nonce. Asset amounts are raw units, never display decimals.
    struct Operation {
        bytes32 operationId;
        address actor;
        address recipient;
        address inputAsset;
        uint256 inputAmount;
        address outputAsset;
        uint256 minimumOutput;
        uint256 deadline;
        uint256 nonce;
        bytes data;
    }

    struct Permission {
        bytes32 operationId;
        uint8 inputRoles;
        uint8 outputRoles;
        uint8 authorization;
    }

    /// @dev Review binds compiler-derived immutable locations to words in the actual constructor encoding.
    struct Revision {
        bytes32 familyId;
        bytes32 creationCodeHash;
        bytes32 runtimeTemplateHash;
        bytes32 manifestHash;
        address fixedQuoteAsset;
        bytes32 fixedConfigurationHash;
        bytes32 initialOperationId;
        uint32 executionGas;
        uint8 moneyRights;
        uint8 coinRights;
        bool enabled;
    }
}
