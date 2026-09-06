// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ModuleRuntimeTypesV1 as T } from "../ModuleRuntimeTypesV1.sol";

/// @notice Review authority for immutable native-engine package revisions, with no effect-kind enumeration.
/// @dev Admission is a reviewed code/configuration policy, not a claim that arbitrary contracts are safe. Existing
///      pool snapshots never consult enabled status. Author wallet rotation affects only future fee accrual.
contract ModuleNativeRegistryV1 is Ownable {
    struct Family {
        address author;
        address wallet;
    }

    struct Revision {
        bytes32 familyId;
        address factory;
        bytes32 factoryCodeHash;
        bytes32 moduleCodeHash;
        bytes32 manifestHash;
        uint32 callbackGas;
        bool enabled;
    }

    mapping(bytes32 familyId => Family) public families;
    mapping(bytes32 packageId => Revision) private _revisions;

    error InvalidFamily();
    error UnauthorizedAuthor();
    error InvalidRevision();
    error RevisionAlreadyExists();
    error UnavailableRevision(bytes32 packageId);
    error SelectionMismatch(bytes32 packageId);

    event FamilyRegistered(bytes32 indexed familyId, address indexed author, address indexed wallet);
    event ReviewedFamilyBound(bytes32 indexed familyId, bytes32 indexed submissionDigest, address indexed reviewer);
    event AuthorWalletChanged(bytes32 indexed familyId, address indexed previousWallet, address indexed wallet);
    event RevisionApproved(bytes32 indexed packageId, bytes32 indexed familyId, Revision revision);
    event RevisionAvailabilityChanged(bytes32 indexed packageId, bool enabled);

    constructor(address reviewAuthority) Ownable(reviewAuthority) { }

    function registerFamily(bytes32 salt, address rewardWallet) external returns (bytes32 familyId) {
        return _registerFamily(msg.sender, salt, rewardWallet);
    }

    /// @notice The existing review authority can bind an API-authenticated contributor without a second author tx.
    /// @dev Source review must verify author consent/wallet binding and the exact immutable submission digest.
    ///      This never transfers an existing family or grants the reviewer author-wallet rotation rights.
    function registerReviewedFamily(address author, bytes32 salt, address rewardWallet, bytes32 submissionDigest)
        external
        onlyOwner
        returns (bytes32 familyId)
    {
        if (author == address(0) || submissionDigest == bytes32(0)) revert InvalidFamily();
        familyId = _registerFamily(author, salt, rewardWallet);
        emit ReviewedFamilyBound(familyId, submissionDigest, msg.sender);
    }

    function _registerFamily(address author, bytes32 salt, address rewardWallet) private returns (bytes32 familyId) {
        if (rewardWallet == address(0)) revert InvalidFamily();
        familyId = keccak256(abi.encode(author, salt));
        if (families[familyId].author != address(0)) revert InvalidFamily();
        families[familyId] = Family(author, rewardWallet);
        emit FamilyRegistered(familyId, author, rewardWallet);
    }

    function authorWallet(bytes32 familyId) external view returns (address) {
        return families[familyId].wallet;
    }

    function changeAuthorWallet(bytes32 familyId, address rewardWallet) external {
        Family storage family = families[familyId];
        if (family.author != msg.sender) revert UnauthorizedAuthor();
        if (rewardWallet == address(0)) revert InvalidFamily();
        address previous = family.wallet;
        family.wallet = rewardWallet;
        emit AuthorWalletChanged(familyId, previous, rewardWallet);
    }

    /// @dev Review must bind the package's exact source/artifact and functional-family attribution. A proxy or a
    ///      factory that delegates into mutable code is not made immutable merely by matching its own code hash.
    function approveRevision(
        bytes32 packageId,
        bytes32 familyId,
        address factory,
        bytes32 moduleCodeHash,
        bytes32 manifestHash,
        uint32 callbackGas
    ) external onlyOwner {
        if (families[familyId].author == address(0)) revert InvalidFamily();
        if (_revisions[packageId].factory != address(0)) revert RevisionAlreadyExists();
        if (
            packageId == bytes32(0) || factory.code.length == 0 || moduleCodeHash == bytes32(0)
                || manifestHash == bytes32(0) || callbackGas < 25_000 || callbackGas > 500_000
        ) revert InvalidRevision();
        Revision memory revision =
            Revision(familyId, factory, factory.codehash, moduleCodeHash, manifestHash, callbackGas, true);
        _revisions[packageId] = revision;
        emit RevisionApproved(packageId, familyId, revision);
    }

    function setRevisionEnabled(bytes32 packageId, bool enabled) external onlyOwner {
        if (_revisions[packageId].factory == address(0)) revert InvalidRevision();
        _revisions[packageId].enabled = enabled;
        emit RevisionAvailabilityChanged(packageId, enabled);
    }

    function getRevision(bytes32 packageId) external view returns (Revision memory) {
        if (_revisions[packageId].factory == address(0)) revert InvalidRevision();
        return _revisions[packageId];
    }

    function validateSelection(T.Selection calldata selection) external view returns (bytes32 familyId) {
        Revision storage revision = _revisions[selection.packageId];
        if (!revision.enabled) revert UnavailableRevision(selection.packageId);
        if (
            selection.factory != revision.factory || selection.factoryCodeHash != revision.factoryCodeHash
                || selection.factory.codehash != revision.factoryCodeHash
                || selection.moduleCodeHash != revision.moduleCodeHash || selection.callbackGas != revision.callbackGas
        ) revert SelectionMismatch(selection.packageId);
        return revision.familyId;
    }
}
