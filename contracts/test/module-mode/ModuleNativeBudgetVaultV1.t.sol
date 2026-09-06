// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ModuleRuntimeTestBase } from "./ModuleNativeRuntimeV1.t.sol";
import { ModuleNativeRuntimeV1 } from "../../src/module-mode/ModuleNativeRuntimeV1.sol";
import { ModuleNativeBudgetVaultV1 } from "../../src/module-mode/ModuleNativeBudgetVaultV1.sol";
import { RevertingBudgetRecipient, ReentrantBudgetRecipient, ForcedRuntimeDonation } from "./RuntimeFixtures.sol";

contract ModuleNativeBudgetVaultV1Test is ModuleRuntimeTestBase {
    function test_fundingRequiresAnExistingInstanceAndCannotAllocateForcedDonations() public {
        vm.expectRevert(ModuleNativeBudgetVaultV1.InvalidInstance.selector);
        vault.fund{ value: 1 }(bytes32(uint256(1)));
        (, ModuleNativeRuntimeV1.Instance[] memory instances_) = _register(_single(_probe(0)), 1);
        vm.expectRevert(ModuleNativeBudgetVaultV1.InvalidAmount.selector);
        vault.fund(instances_[0].instanceId);
        new ForcedRuntimeDonation{ value: 1 ether }(payable(address(vault)));
        assertEq(address(vault).balance, 1 ether);
        assertEq(vault.available(instances_[0].instanceId), 0);
        assertEq(vault.totalFunded(), 0);
        _assertBacking();
    }

    function test_noModuleCanSpendAnotherInstancesBacking() public {
        (bytes32 first, ModuleNativeRuntimeV1.Instance[] memory firstInstances) = _register(_single(_probe(1)), 1);
        (, ModuleNativeRuntimeV1.Instance[] memory secondInstances) = _register(_single(_probe(1)), 2);
        vault.fund{ value: 100 }(secondInstances[0].instanceId);
        vm.expectRevert();
        engine.callerTrade(first, 1);
        assertEq(vault.available(secondInstances[0].instanceId), 100);
        assertEq(vault.claimable(firstInstances[0].instanceId, address(this)), 0);
        assertEq(vault.totalOutstandingClaims(), 0);
        _assertBacking();
    }

    function test_existingClaimsCannotBeSpentAsAvailableBudget() public {
        (bytes32 key, ModuleNativeRuntimeV1.Instance[] memory instances_) = _register(_single(_probe(0)), 1);
        bytes32 id = instances_[0].instanceId;
        vault.fund{ value: 10 }(id);
        vm.prank(alice);
        runtime.executeAction(key, 0, bytes32("credit"), abi.encode(uint256(10)), 0, block.timestamp);
        assertEq(vault.available(id), 0);
        vm.prank(bob);
        vm.expectRevert();
        runtime.executeAction(key, 0, bytes32("credit"), abi.encode(uint256(1)), 0, block.timestamp);
        assertEq(vault.claimable(id, alice), 10);
        assertEq(vault.claimable(id, bob), 0);
        assertEq(runtime.actionNonce(key, bob), 0);
        _assertBacking();
    }

    function test_claimsAreRecipientBoundAndOnlyBeneficiaryCanRedirect() public {
        (bytes32 key, ModuleNativeRuntimeV1.Instance[] memory instances_) = _register(_single(_probe(0)), 1);
        bytes32 id = instances_[0].instanceId;
        vault.fund{ value: 10 }(id);
        vm.prank(alice);
        runtime.executeAction(key, 0, bytes32("credit"), abi.encode(uint256(10)), 0, block.timestamp);
        vm.prank(bob);
        vm.expectRevert(ModuleNativeBudgetVaultV1.InvalidAmount.selector);
        vault.claimTo(id, bob);
        vm.prank(alice);
        vault.claimTo(id, bob);
        assertEq(bob.balance, 10);
        assertEq(alice.balance, 0);
        assertEq(vault.claimed(id, alice), 10);
        vm.expectRevert(ModuleNativeBudgetVaultV1.InvalidAmount.selector);
        vault.claim(id, alice);
        _assertBacking();
    }

    function test_revertingReceiverDoesNotBlockTradesAndRetainsItsClaim() public {
        (bytes32 key, ModuleNativeRuntimeV1.Instance[] memory instances_) = _register(_single(_probe(1)), 1);
        bytes32 id = instances_[0].instanceId;
        vault.fund{ value: 10 }(id);
        RevertingBudgetRecipient recipient = new RevertingBudgetRecipient();
        engine.applyTrade(key, _trade(key, address(recipient), 1, true));
        vm.expectRevert();
        vault.claim(id, address(recipient));
        assertEq(vault.claimable(id, address(recipient)), 1);
        assertEq(vault.claimed(id, address(recipient)), 0);
        engine.applyTrade(key, _trade(key, alice, 1, true));
        recipient.claimTo(vault, id, bob);
        assertEq(bob.balance, 1);
        _assertBacking();
    }

    function test_reentrantClaimCannotPayTwice() public {
        (bytes32 key, ModuleNativeRuntimeV1.Instance[] memory instances_) = _register(_single(_probe(1)), 1);
        bytes32 id = instances_[0].instanceId;
        vault.fund{ value: 10 }(id);
        ReentrantBudgetRecipient recipient = new ReentrantBudgetRecipient();
        recipient.setup(vault, id);
        engine.applyTrade(key, _trade(key, address(recipient), 1, true));
        vault.claim(id, address(recipient));
        assertTrue(recipient.blocked());
        assertEq(address(recipient).balance, 1);
        assertEq(vault.claimed(id, address(recipient)), 1);
        assertEq(vault.claimable(id, address(recipient)), 0);
        _assertBacking();
    }

    function testFuzz_budgetAndClaimsConserveFundsAcrossFragmentation(
        uint96 a,
        uint96 b,
        uint96 creditA,
        uint96 creditB
    ) public {
        uint256 firstFund = bound(a, 1, 10 ether);
        uint256 secondFund = bound(b, 1, 10 ether);
        uint256 firstCredit = bound(creditA, 1, firstFund);
        uint256 secondCredit = bound(creditB, 1, firstFund - firstCredit + secondFund);
        (bytes32 key, ModuleNativeRuntimeV1.Instance[] memory instances_) = _register(_single(_probe(0)), 1);
        bytes32 id = instances_[0].instanceId;
        vault.fund{ value: firstFund }(id);
        vm.prank(alice);
        runtime.executeAction(key, 0, bytes32("credit"), abi.encode(firstCredit), 0, block.timestamp);
        vault.fund{ value: secondFund }(id);
        vm.prank(bob);
        runtime.executeAction(key, 0, bytes32("credit"), abi.encode(secondCredit), 0, block.timestamp);
        vault.claim(id, bob);
        _assertBacking();
        vault.claim(id, alice);
        assertEq(vault.available(id), firstFund + secondFund - firstCredit - secondCredit);
        assertEq(vault.totalOutstandingClaims(), 0);
        assertEq(alice.balance, firstCredit);
        assertEq(bob.balance, secondCredit);
        _assertBacking();
    }
}
