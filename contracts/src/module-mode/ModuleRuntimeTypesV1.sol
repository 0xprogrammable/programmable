// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Candidate native runtime wire types. They do not establish engine admission or trade authenticity.
library ModuleRuntimeTypesV1 {
    struct LaunchBinding {
        address source;
        address launchWallet;
        address token;
        address poolManager;
        bytes32 poolId;
        bytes32 recipeHash;
        bytes32 programHash;
    }

    struct Selection {
        bytes32 packageId;
        address factory;
        bytes32 factoryCodeHash;
        bytes32 moduleCodeHash;
        uint32 callbackGas;
        bytes config;
    }

    struct InstanceBinding {
        address runtime;
        bytes32 launchKey;
        bytes32 instanceId;
        bytes32 packageId;
        bytes32 configHash;
    }

    /// @dev The immutable engine must derive these from a real atomic settlement, including actual routing actors.
    ///      grossNative includes hook fees; tokenAmount is the actual executed token quantity. Neither is a quote.
    struct Trade {
        uint64 sequence;
        address actor;
        address payer;
        address recipient;
        uint256 grossNative;
        uint256 tokenAmount;
        bool isBuy;
        bool exactInput;
        bool initialBuy;
    }

    struct TradeContext {
        bytes32 launchKey;
        bytes32 instanceId;
        bytes32 executionId;
        Trade trade;
    }

    struct ActionContext {
        bytes32 launchKey;
        bytes32 instanceId;
        bytes32 executionId;
        address actor;
        uint64 nonce;
        bytes32 actionId;
    }
}
