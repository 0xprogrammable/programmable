// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Immutable economics identity shared by the V2 source, engine, route and fee ledger.
library ModuleNativeEconomicsV2 {
    bytes32 internal constant POLICY_ID = keccak256("programmable.module-mode.native-economics.v2");
    uint16 internal constant PROTOCOL_FEE_BPS = 10;
    uint16 internal constant AUTHOR_POOL_FEE_BPS = 20;

    function platformFeeBps(uint256 eligibleFamilies) internal pure returns (uint16) {
        return PROTOCOL_FEE_BPS + (eligibleFamilies == 0 ? 0 : AUTHOR_POOL_FEE_BPS);
    }
}
