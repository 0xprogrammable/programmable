// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Stable identity reader for Classic coins, independent of the selected module implementation.
/// @dev Query only a source authenticated by the chain's released Programmable deployment manifest. Implementing
///      this interface or returning version 1 does not grant provenance. Bind reads to the authenticated launch
///      event and its canonical block. Chain ID and source address are part of the caller's evidence envelope.
interface IProgrammableClassicLaunchV1 {
    /// @dev Exact field order is the V1 wire format. Market-specific amounts and custody details belong in the
    ///      engine's versioned detail record. A missing token returns the all-zero struct.
    struct LaunchIdentity {
        bytes32 launchId;
        address launchWallet;
        address token;
        address poolManager;
        bytes32 poolId;
        address hook;
        bytes32 recipeHash;
    }

    /// @notice Identity ABI version, not an engine version, safety approval or proof of origin.
    function launchIdentityVersion() external pure returns (uint256);

    /// @notice Returns the original launch identity; module catalogue and payout changes do not rewrite it.
    function getLaunchIdentity(address token) external view returns (LaunchIdentity memory);
}
