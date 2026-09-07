// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ModuleNativeRegistryV1 } from "./ModuleNativeRegistryV1.sol";

/// @notice Adds separately reviewed family fee eligibility to the unchanged native revision registry.
/// @dev Only explicit selected revisions can create a slot in HookV2. Imports and the native base engine are not
///      selected families. Default eligibility is false. Changes apply to future recipe commitments; launched pools
///      retain their snapshot, while author-wallet rotation keeps the V1 future-accrual semantics.
contract ModuleNativeRegistryV2 is ModuleNativeRegistryV1 {
    struct FeeEligibility {
        bool eligible;
        bytes32 reviewDigest;
    }

    mapping(bytes32 familyId => FeeEligibility) public familyFeeEligibility;

    error InvalidEligibilityReview();

    event FamilyFeeEligibilityReviewed(
        bytes32 indexed familyId, bool eligible, bytes32 indexed reviewDigest, address indexed reviewer
    );

    constructor(address reviewAuthority) ModuleNativeRegistryV1(reviewAuthority) { }

    /// @dev Review binds a distinct functional family, not a version, instance, import or team member.
    function setFamilyFeeEligibility(bytes32 familyId, bool eligible, bytes32 reviewDigest) external onlyOwner {
        if (families[familyId].author == address(0)) revert InvalidFamily();
        if (reviewDigest == bytes32(0)) revert InvalidEligibilityReview();
        familyFeeEligibility[familyId] = FeeEligibility(eligible, reviewDigest);
        emit FamilyFeeEligibilityReviewed(familyId, eligible, reviewDigest, msg.sender);
    }
}
