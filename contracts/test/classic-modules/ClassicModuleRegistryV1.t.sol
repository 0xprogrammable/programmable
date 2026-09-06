// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ClassicModuleRegistryV1 as Registry } from "../../src/classic-modules/ClassicModuleRegistryV1.sol";
import { FallingCreatorFeeV1 } from "../../src/classic-modules/modules/FallingCreatorFeeV1.sol";

contract ClassicModuleRegistryV1Test is Test {
    Registry private registry;
    address private author;
    bytes32 private family;
    address private implementation;

    function setUp() public {
        registry = new Registry(address(this));
        author = makeAddr("author");
        vm.prank(author);
        family = registry.registerFamily(bytes32("original"), author);
        implementation = address(new FallingCreatorFeeV1());
    }

    function test_familyIsAuthenticatedAndCannotBeOverwritten() public {
        assertEq(family, keccak256(abi.encode(author, bytes32("original"))));
        vm.prank(author);
        vm.expectRevert(Registry.InvalidFamily.selector);
        registry.registerFamily(bytes32("original"), makeAddr("other"));
        (address owner, address wallet) = registry.families(family);
        assertEq(owner, author);
        assertEq(wallet, author);
    }

    function test_reviewerCannotRedirectAuthorPayout() public {
        vm.expectRevert(Registry.UnauthorizedAuthor.selector);
        registry.changeAuthorWallet(family, address(this));
        vm.prank(author);
        registry.changeAuthorWallet(family, makeAddr("next"));
        assertEq(registry.authorWallet(family), makeAddr("next"));
    }

    function test_onlyReviewerCanApproveAndAvailabilityDoesNotRewriteVersion() public {
        vm.prank(author);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, author));
        registry.approveVersion(family, 1, implementation, keccak256("review"), 1);
        bytes32 id = registry.approveVersion(family, 1, implementation, keccak256("review"), 1);
        assertEq(id, keccak256(abi.encode(family, uint32(1))));
        registry.setVersionEnabled(id, false);
        vm.expectRevert(Registry.VersionAlreadyExists.selector);
        registry.approveVersion(family, 1, implementation, keccak256("changed"), 1);
        Registry.Version memory record = registry.getVersion(id);
        assertFalse(record.enabled);
        assertEq(record.manifestHash, keccak256("review"));
        assertEq(record.implementation, implementation);
        assertEq(record.codeHash, implementation.codehash);
    }

    function test_reviewerTransferDoesNotTransferAuthorRights() public {
        address next = makeAddr("newReviewer");
        registry.transferOwnership(next);
        assertEq(registry.owner(), address(this));
        vm.prank(next);
        registry.acceptOwnership();
        vm.prank(next);
        vm.expectRevert(Registry.UnauthorizedAuthor.selector);
        registry.changeAuthorWallet(family, next);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        registry.approveVersion(family, 1, implementation, keccak256("review"), 1);
    }

    function test_missingCodeUnsupportedKindAndMissingEvidenceCannotBeApproved() public {
        vm.expectRevert(Registry.InvalidModule.selector);
        registry.approveVersion(family, 1, makeAddr("empty"), keccak256("review"), 1);
        vm.expectRevert(Registry.InvalidModule.selector);
        registry.approveVersion(family, 1, implementation, keccak256("review"), 2);
        vm.expectRevert(Registry.InvalidVersion.selector);
        registry.approveVersion(family, 0, implementation, keccak256("review"), 1);
        vm.expectRevert(Registry.InvalidVersion.selector);
        registry.approveVersion(family, 1, implementation, bytes32(0), 1);
    }

    function test_unknownWalletOrVersionNeverReturnsPlausibleDefaults() public {
        vm.expectRevert(Registry.InvalidFamily.selector);
        registry.authorWallet(bytes32("unknown"));
        vm.expectRevert(Registry.InvalidVersion.selector);
        registry.getVersion(bytes32("unknown"));
    }
}
