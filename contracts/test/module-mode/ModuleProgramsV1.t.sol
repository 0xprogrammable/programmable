// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ModuleRuntimeTestBase } from "./ModuleNativeRuntimeV1.t.sol";
import { ModuleRuntimeTypesV1 as T } from "../../src/module-mode/ModuleRuntimeTypesV1.sol";
import { ModuleNativeRuntimeV1 } from "../../src/module-mode/ModuleNativeRuntimeV1.sol";
import { EveryNthBuyRewardV1 } from "../../src/module-mode/modules/EveryNthBuyRewardV1.sol";
import { TimedWalletBuyCapV1 } from "../../src/module-mode/modules/TimedWalletBuyCapV1.sol";

contract ModuleProgramsV1Test is ModuleRuntimeTestBase {
    function test_nthBuyUsesAuthenticatedActorAndPreexistingBudget() public {
        (bytes32 key, ModuleNativeRuntimeV1.Instance[] memory instances_) = _register(_single(_reward(3, false)), 1);
        bytes32 instance = instances_[0].instanceId;
        vault.fund{ value: 0.005 ether }(instance);
        EveryNthBuyRewardV1 reward = EveryNthBuyRewardV1(instances_[0].module);
        T.Trade memory trade = _trade(key, alice, 0.1 ether, true);
        trade.initialBuy = true;
        engine.applyTrade(key, trade);
        engine.applyTrade(key, _trade(key, alice, 0.1 ether, false));
        engine.applyTrade(key, _trade(key, alice, 0.001 ether, true));
        assertEq(reward.qualifiedBuys(), 0);
        vm.prank(alice);
        engine.callerTrade(key, 0.1 ether);
        vm.prank(alice);
        engine.callerTrade(key, 0.1 ether);
        trade = _trade(key, bob, 0.1 ether, true);
        trade.payer = alice;
        trade.recipient = alice;
        trade.exactInput = false;
        engine.applyTrade(key, trade);
        assertEq(reward.qualifiedBuys(), 3);
        assertEq(reward.rewardedBuys(), 1);
        assertEq(vault.claimable(instance, bob), 0.001 ether);
        assertEq(vault.claimable(instance, alice), 0);
        assertEq(vault.available(instance), 0.004 ether);
        uint256 before = bob.balance;
        vault.claim(instance, bob);
        assertEq(bob.balance - before, 0.001 ether);
        _assertBacking();
    }

    function test_depletedRewardSkipsWithoutDebtAndExpirationStopsQualification() public {
        (bytes32 key, ModuleNativeRuntimeV1.Instance[] memory instances_) = _register(_single(_reward(1, true)), 1);
        EveryNthBuyRewardV1 reward = EveryNthBuyRewardV1(instances_[0].module);
        engine.applyTrade(key, _trade(key, alice, 0.1 ether, true));
        assertEq(reward.qualifiedBuys(), 1);
        assertEq(reward.rewardedBuys(), 0);
        assertEq(vault.totalOutstandingClaims(), 0);
        vault.fund{ value: 0.001 ether }(instances_[0].instanceId);
        engine.applyTrade(key, _trade(key, bob, 0.1 ether, true));
        assertEq(vault.claimable(instances_[0].instanceId, alice), 0);
        assertEq(vault.claimable(instances_[0].instanceId, bob), 0.001 ether);
        vm.warp(reward.endsAt());
        engine.applyTrade(key, _trade(key, alice, 0.1 ether, true));
        assertEq(reward.qualifiedBuys(), 2);
        _assertBacking();
    }

    function test_walletCapAggregatesSplitBuysAndDoesNotLimitSells() public {
        (bytes32 key, ModuleNativeRuntimeV1.Instance[] memory instances_) =
            _register(_single(_cap(uint128(0.1 ether), true)), 1);
        TimedWalletBuyCapV1 cap = TimedWalletBuyCapV1(instances_[0].module);
        engine.applyTrade(key, _trade(key, alice, 0.04 ether, true));
        engine.applyTrade(key, _trade(key, alice, 0.06 ether, true));
        assertEq(cap.spentNative(alice), 0.1 ether);
        T.Trade memory rejected = _trade(key, alice, 1, true);
        vm.expectRevert(abi.encodeWithSelector(ModuleNativeRuntimeV1.ModuleCallFailed.selector, address(cap)));
        engine.applyTrade(key, rejected);
        engine.applyTrade(key, _trade(key, bob, 0.1 ether, true));
        engine.applyTrade(key, _trade(key, alice, 100 ether, false));
        assertEq(cap.spentNative(alice), 0.1 ether);
        vm.warp(cap.endsAt());
        engine.applyTrade(key, _trade(key, alice, 100 ether, true));
        assertEq(cap.spentNative(alice), 0.1 ether);
    }

    function test_laterCapFailureRollsBackEarlierRewardCredit() public {
        T.Selection[] memory selected = new T.Selection[](2);
        selected[0] = _reward(1, true);
        selected[1] = _cap(uint128(0.1 ether), true);
        (bytes32 key, ModuleNativeRuntimeV1.Instance[] memory instances_) = _register(selected, 1);
        vault.fund{ value: 1 ether }(instances_[0].instanceId);
        T.Trade memory rejected = _trade(key, alice, 0.11 ether, true);
        vm.expectRevert(abi.encodeWithSelector(ModuleNativeRuntimeV1.ModuleCallFailed.selector, instances_[1].module));
        engine.applyTrade(key, rejected);
        assertEq(vault.claimable(instances_[0].instanceId, alice), 0);
        assertEq(vault.available(instances_[0].instanceId), 1 ether);
        assertEq(EveryNthBuyRewardV1(instances_[0].module).qualifiedBuys(), 0);
        assertEq(TimedWalletBuyCapV1(instances_[1].module).spentNative(alice), 0);
        assertEq(runtime.lastTradeSequence(key), 0);
        engine.applyTrade(key, _trade(key, alice, 0.1 ether, true));
        assertEq(vault.claimable(instances_[0].instanceId, alice), 0.001 ether);
        _assertBacking();
    }

    function test_initialBuyParticipationIsImmutableConfiguration() public {
        (bytes32 first, ModuleNativeRuntimeV1.Instance[] memory firstInstances) = _register(_single(_cap(1, false)), 1);
        (bytes32 second,) = _register(_single(_cap(1, true)), 2);
        T.Trade memory trade = _trade(first, alice, 2, true);
        trade.initialBuy = true;
        engine.applyTrade(first, trade);
        assertEq(TimedWalletBuyCapV1(firstInstances[0].module).spentNative(alice), 0);
        vm.expectRevert();
        engine.applyTrade(second, trade);
        assertEq(runtime.lastTradeSequence(second), 0);
    }

    function test_invalidReferenceConfigurationsFailAtInstantiation() public {
        T.Selection[] memory selected = _single(_reward(0, true));
        T.LaunchBinding memory binding = _binding(selected, 1);
        vm.expectRevert();
        engine.register(binding, selected);
        selected = _single(_cap(0, true));
        binding = _binding(selected, 1);
        vm.expectRevert();
        engine.register(binding, selected);
        selected = _single(_reward(1, true));
        selected[0].config = abi.encode(uint32(1), uint128(1), uint128(1), uint64(block.timestamp), true, alice);
        binding = _binding(selected, 1);
        vm.expectRevert();
        engine.register(binding, selected);
    }

    function test_reclaimRequiresRefundActorAfterExpiryAndPreservesWinnerClaims() public {
        (bytes32 key, ModuleNativeRuntimeV1.Instance[] memory instances_) = _register(_single(_reward(1, true)), 1);
        EveryNthBuyRewardV1 reward = EveryNthBuyRewardV1(instances_[0].module);
        bytes32 id = instances_[0].instanceId;
        bytes32 actionId = reward.RECLAIM_UNUSED();
        uint64 endTime = reward.endsAt();
        vault.fund{ value: 0.005 ether }(id);
        engine.applyTrade(key, _trade(key, bob, 0.1 ether, true));
        assertEq(vault.claimable(id, bob), 0.001 ether);
        assertEq(vault.available(id), 0.004 ether);

        vm.prank(alice);
        vm.expectRevert();
        runtime.executeAction(key, 0, actionId, "", 0, endTime);
        assertEq(runtime.actionNonce(key, alice), 0);
        vm.warp(reward.endsAt());
        vm.prank(bob);
        vm.expectRevert();
        runtime.executeAction(key, 0, actionId, "", 0, block.timestamp);
        assertEq(runtime.actionNonce(key, bob), 0);
        vm.prank(alice);
        runtime.executeAction(key, 0, actionId, "", 0, block.timestamp);
        assertEq(runtime.actionNonce(key, alice), 1);
        assertEq(vault.claimable(id, alice), 0.004 ether);
        assertEq(vault.claimable(id, bob), 0.001 ether);
        assertEq(vault.available(id), 0);
        assertEq(reward.totalReclaimed(), 0.004 ether);
        vault.claim(id, alice);
        assertEq(alice.balance, 0.004 ether);
        assertEq(vault.claimable(id, bob), 0.001 ether);
        vault.claim(id, bob);
        assertEq(bob.balance, 0.001 ether);
        _assertBacking();
    }

    function test_reclaimNoOpRetriesFreshFundingAndOtherInstanceIsolation() public {
        (bytes32 key, ModuleNativeRuntimeV1.Instance[] memory instances_) = _register(_single(_reward(1, true)), 1);
        (, ModuleNativeRuntimeV1.Instance[] memory otherInstances) = _register(_single(_reward(1, true)), 2);
        EveryNthBuyRewardV1 reward = EveryNthBuyRewardV1(instances_[0].module);
        bytes32 id = instances_[0].instanceId;
        bytes32 actionId = reward.RECLAIM_UNUSED();
        vault.fund{ value: 0.01 ether }(otherInstances[0].instanceId);
        vm.warp(reward.endsAt());
        vm.prank(alice);
        runtime.executeAction(key, 0, actionId, "", 0, block.timestamp);
        assertEq(runtime.actionNonce(key, alice), 1);
        assertEq(reward.totalReclaimed(), 0);
        vault.fund{ value: 0.002 ether }(id);
        vm.prank(alice);
        vm.expectRevert(ModuleNativeRuntimeV1.InvalidAction.selector);
        runtime.executeAction(key, 0, actionId, "", 0, block.timestamp);
        vm.prank(alice);
        runtime.executeAction(key, 0, actionId, "", 1, block.timestamp);
        vm.prank(alice);
        runtime.executeAction(key, 0, actionId, "", 2, block.timestamp);
        assertEq(runtime.actionNonce(key, alice), 3);
        assertEq(reward.totalReclaimed(), 0.002 ether);
        assertEq(vault.claimable(id, alice), 0.002 ether);
        assertEq(vault.available(otherInstances[0].instanceId), 0.01 ether);
        _assertBacking();
    }

    function test_reclaimRejectsWrongActionAndUnexpectedInputs() public {
        (bytes32 key, ModuleNativeRuntimeV1.Instance[] memory instances_) = _register(_single(_reward(1, true)), 1);
        EveryNthBuyRewardV1 reward = EveryNthBuyRewardV1(instances_[0].module);
        bytes32 actionId = reward.RECLAIM_UNUSED();
        vm.warp(reward.endsAt());
        vm.prank(alice);
        vm.expectRevert();
        runtime.executeAction(key, 0, bytes32("different-action"), "", 0, block.timestamp);
        vm.prank(alice);
        vm.expectRevert();
        runtime.executeAction(key, 0, actionId, hex"00", 0, block.timestamp);
        assertEq(runtime.actionNonce(key, alice), 0);
    }

    function test_oldConfigAndZeroRefundWalletAreRejected() public {
        T.Selection[] memory selected = _single(_reward(1, true));
        selected[0].config = abi.encode(uint32(1), uint128(1), uint128(1), uint64(block.timestamp + 1), true);
        T.LaunchBinding memory binding = _binding(selected, 1);
        vm.expectRevert();
        engine.register(binding, selected);
        selected[0].config =
            abi.encode(uint32(1), uint128(1), uint128(1), uint64(block.timestamp + 1), true, address(0));
        binding = _binding(selected, 1);
        vm.expectRevert();
        engine.register(binding, selected);
    }

    function testFuzz_rewardsNeverExceedPrefunding(uint96 funding, uint8 buys, uint8 every) public {
        uint32 n = uint32(bound(every, 1, 20));
        uint256 count = bound(buys, 1, 50);
        uint256 funded = bound(funding, 1, 0.02 ether);
        (bytes32 key, ModuleNativeRuntimeV1.Instance[] memory instances_) = _register(_single(_reward(n, true)), 1);
        vault.fund{ value: funded }(instances_[0].instanceId);
        for (uint256 i; i < count; ++i) {
            engine.applyTrade(key, _trade(key, alice, 0.01 ether, true));
        }
        uint256 expected = count / n;
        if (expected > funded / 0.001 ether) expected = funded / 0.001 ether;
        assertEq(vault.claimable(instances_[0].instanceId, alice), expected * 0.001 ether);
        assertEq(vault.available(instances_[0].instanceId), funded - expected * 0.001 ether);
        _assertBacking();
    }
}
