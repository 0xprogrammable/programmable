// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Versioned wire types shared by the Classic engine, contributors and SDK.
library ClassicModuleTypes {
    uint8 internal constant FEE_POLICY = 1;
    uint8 internal constant TRADE_LIMIT = 2;
    uint256 internal constant MAX_MODULES = 8;
    uint256 internal constant MAX_CONFIG_BYTES = 256;
    uint256 internal constant MODULE_CALL_GAS = 100_000;
    bytes32 internal constant RECIPE_DOMAIN = keccak256("programmable.classic.recipe.v1");

    struct ModuleSelection {
        bytes32 versionId;
        bytes config;
    }

    struct ModuleSnapshot {
        bytes32 versionId;
        bytes32 familyId;
        address implementation;
        bytes32 codeHash;
        uint8 kind;
        bytes config;
    }

    struct PoolRegistration {
        address launchWallet;
        uint16 buyCreatorFeeBps;
        uint16 sellCreatorFeeBps;
        address[] creatorWallets;
        uint16[] creatorSharesBps;
        ModuleSelection[] modules;
    }

    struct Context {
        bytes32 poolId;
        uint64 elapsed;
        uint16 baseBuyFeeBps;
        uint16 baseSellFeeBps;
    }

    /// @dev Fee policies populate only fees; limit modules populate only limits. Zero limit means unbounded.
    struct Effect {
        uint16 buyCreatorFeeBps;
        uint16 sellCreatorFeeBps;
        uint256 buyQuoteLimit;
        uint256 sellQuoteLimit;
    }
}
