// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { IClassicModuleV1 } from "./IClassicModuleV1.sol";
import { ClassicModuleTypes as T } from "./ClassicModuleTypes.sol";
import { ClassicModuleCalls } from "./ClassicModuleCalls.sol";

/// @notice Review authority controls new catalogue use, never existing recipes or contributor payouts.
/// @dev An approval records reviewed evidence; codehash and interface checks alone are not a security review.
contract ClassicModuleRegistryV1 is Ownable2Step {
    struct Family {
        address author;
        address wallet;
    }

    struct Version {
        bytes32 familyId;
        uint32 version;
        address implementation;
        bytes32 codeHash;
        bytes32 manifestHash;
        uint8 kind;
        bool enabled;
    }

    mapping(bytes32 => Family) public families;
    mapping(bytes32 => Version) private _versions;

    error InvalidFamily();
    error InvalidVersion();
    error InvalidModule();
    error UnauthorizedAuthor();
    error VersionAlreadyExists();

    event FamilyRegistered(bytes32 indexed familyId, address indexed author, address wallet);
    event AuthorWalletChanged(bytes32 indexed familyId, address indexed oldWallet, address indexed newWallet);
    event VersionApproved(
        bytes32 indexed versionId,
        bytes32 indexed familyId,
        uint32 version,
        address implementation,
        bytes32 codeHash,
        bytes32 manifestHash,
        uint8 kind
    );
    event VersionAvailabilityChanged(bytes32 indexed versionId, bool enabled);

    constructor(address reviewer) Ownable(reviewer) { }

    function familyIdFor(address author, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(author, salt));
    }

    /// @notice Authenticated authors establish their family and initial payout themselves, before review.
    function registerFamily(bytes32 salt, address wallet) external returns (bytes32 familyId) {
        familyId = familyIdFor(msg.sender, salt);
        if (wallet == address(0) || families[familyId].author != address(0)) revert InvalidFamily();
        families[familyId] = Family(msg.sender, wallet);
        emit FamilyRegistered(familyId, msg.sender, wallet);
    }

    function authorWallet(bytes32 familyId) external view returns (address) {
        address wallet = families[familyId].wallet;
        if (wallet == address(0)) revert InvalidFamily();
        return wallet;
    }

    /// @dev Ledgers have already credited previous swaps. This changes only the wallet read by future accruals.
    function changeAuthorWallet(bytes32 familyId, address wallet) external {
        Family storage family = families[familyId];
        if (family.author != msg.sender) revert UnauthorizedAuthor();
        if (wallet == address(0)) revert InvalidFamily();
        address previous = family.wallet;
        family.wallet = wallet;
        emit AuthorWalletChanged(familyId, previous, wallet);
    }

    function versionIdFor(bytes32 familyId, uint32 version) public pure returns (bytes32) {
        return keccak256(abi.encode(familyId, version));
    }

    function approveVersion(bytes32 familyId, uint32 version, address implementation, bytes32 manifestHash, uint8 kind)
        external
        onlyOwner
        returns (bytes32 versionId)
    {
        if (families[familyId].author == address(0)) revert InvalidFamily();
        if (version == 0 || manifestHash == bytes32(0)) revert InvalidVersion();
        versionId = versionIdFor(familyId, version);
        if (_versions[versionId].implementation != address(0)) revert VersionAlreadyExists();
        if (implementation.code.length == 0 || (kind != T.FEE_POLICY && kind != T.TRADE_LIMIT)) {
            revert InvalidModule();
        }
        bytes memory result =
            ClassicModuleCalls.read(implementation, abi.encodeCall(IClassicModuleV1.moduleKind, ()), 32);
        if (abi.decode(result, (uint256)) != kind) revert InvalidModule();
        bytes32 codeHash = implementation.codehash;
        _versions[versionId] = Version(familyId, version, implementation, codeHash, manifestHash, kind, true);
        emit VersionApproved(versionId, familyId, version, implementation, codeHash, manifestHash, kind);
    }

    function setVersionEnabled(bytes32 versionId, bool enabled) external onlyOwner {
        Version storage version = _versions[versionId];
        if (version.implementation == address(0)) revert InvalidVersion();
        version.enabled = enabled;
        emit VersionAvailabilityChanged(versionId, enabled);
    }

    function getVersion(bytes32 versionId) external view returns (Version memory) {
        Version memory version = _versions[versionId];
        if (version.implementation == address(0)) revert InvalidVersion();
        return version;
    }
}
