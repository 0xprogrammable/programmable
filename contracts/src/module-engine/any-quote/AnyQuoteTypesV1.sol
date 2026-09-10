// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

library AnyQuoteTypesV1 {
    uint256 internal constant CHAIN_ID = 4663;
    uint256 internal constant TOKEN_SUPPLY = 1_000_000_000 ether;
    uint16 internal constant PLATFORM_BPS = 30;
    uint16 internal constant MAX_CREATOR_BPS = 1_000;
    int24 internal constant TICK_SPACING = 200;
    address internal constant PLATFORM_RECIPIENT = 0xD88539d3c4C460136a733A3Fd60cf6BF269079da;
    bytes32 internal constant SCHEMA_ID = keccak256("programmable.any-quote.configuration.v1");
    bytes32 internal constant PROFILE_ID = keccak256("robinhood-any-quote.shared-hook.v1");
    bytes32 internal constant ECONOMICS_POLICY_ID = keccak256("programmable.any-quote.base-30.creator-0-1000.v1");

    /// @dev Exact ABI tuple, 256 bytes. Prices are prepared offchain; their evidence is bound, not an onchain oracle.
    struct Configuration {
        bytes32 schemaId;
        address poolManager;
        bytes32 poolManagerCodeHash;
        address sharedHook;
        address quoteAsset;
        int24 initialTick;
        uint64 validUntil;
        bytes32 priceEvidenceHash;
    }

    struct PoolRegistration {
        bytes32 launchId;
        bytes32 revisionId;
        bytes32 familyId;
        bytes32 configurationHash;
        address token;
        address quoteAsset;
        address initializer;
        int24 initialTick;
        uint16 buyCreatorFeeBps;
        uint16 sellCreatorFeeBps;
    }
}
