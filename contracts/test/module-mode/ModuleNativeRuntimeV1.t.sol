// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { ModuleRuntimeTypesV1 as T } from "../../src/module-mode/ModuleRuntimeTypesV1.sol";
import { ModuleNativeRuntimeV1 } from "../../src/module-mode/ModuleNativeRuntimeV1.sol";
import { ModuleNativeBudgetVaultV1 } from "../../src/module-mode/ModuleNativeBudgetVaultV1.sol";
import { ModuleProgramBaseV1 } from "../../src/module-mode/ModuleProgramBaseV1.sol";
import { IModuleProgramV1 } from "../../src/module-mode/IModuleProgramV1.sol";
import { EveryNthBuyRewardV1, EveryNthBuyRewardFactoryV1 } from "../../src/module-mode/modules/EveryNthBuyRewardV1.sol";
import { TimedWalletBuyCapV1, TimedWalletBuyCapFactoryV1 } from "../../src/module-mode/modules/TimedWalletBuyCapV1.sol";
import {
    RuntimeEngineHarness,
    RuntimeIdentityFixture,
    RuntimeProbeProgram,
    RuntimeProbeFactory,
    WrongBindingFactory,
    RevertingBudgetRecipient,
    ReentrantBudgetRecipient,
    ForcedRuntimeDonation
} from "./RuntimeFixtures.sol";

abstract contract ModuleRuntimeTestBase is Test {
    RuntimeEngineHarness internal engine;
    ModuleNativeRuntimeV1 internal runtime;
    ModuleNativeBudgetVaultV1 internal vault;
    RuntimeProbeFactory internal probeFactory;
    EveryNthBuyRewardFactoryV1 internal rewardFactory;
    TimedWalletBuyCapFactoryV1 internal capFactory;
    RuntimeIdentityFixture internal manager;
    address internal alice;
    address internal bob;

    function setUp() public virtual {
        vm.warp(1_000_000);
        vm.deal(address(this), 1000 ether);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        engine = new RuntimeEngineHarness();
        runtime = new ModuleNativeRuntimeV1(address(engine));
        engine.bind(runtime);
        vault = runtime.vault();
        manager = new RuntimeIdentityFixture();
        probeFactory = new RuntimeProbeFactory();
        rewardFactory = new EveryNthBuyRewardFactoryV1();
        capFactory = new TimedWalletBuyCapFactoryV1();
    }

    function _probe(uint8 mode) internal view returns (T.Selection memory) {
        return T.Selection(
            keccak256("test.probe.v1"),
            address(probeFactory),
            address(probeFactory).codehash,
            probeFactory.moduleCodeHash(),
            300_000,
            abi.encode(mode)
        );
    }

    function _reward(uint32 everyN, bool includeInitial) internal view returns (T.Selection memory) {
        return T.Selection(
            keccak256("example.nth-buy.v1"),
            address(rewardFactory),
            address(rewardFactory).codehash,
            rewardFactory.moduleCodeHash(),
            300_000,
            abi.encode(
                everyN,
                uint128(0.01 ether),
                uint128(0.001 ether),
                uint64(block.timestamp + 1 days),
                includeInitial,
                alice
            )
        );
    }

    function _cap(uint128 cap, bool includeInitial) internal view returns (T.Selection memory) {
        return T.Selection(
            keccak256("example.wallet-cap.v1"),
            address(capFactory),
            address(capFactory).codehash,
            capFactory.moduleCodeHash(),
            300_000,
            abi.encode(cap, uint64(1 hours), includeInitial)
        );
    }

    function _single(T.Selection memory selected) internal pure returns (T.Selection[] memory result) {
        result = new T.Selection[](1);
        result[0] = selected;
    }

    function _binding(T.Selection[] memory selected, uint256 salt) internal returns (T.LaunchBinding memory) {
        return T.LaunchBinding(
            address(engine),
            alice,
            address(new RuntimeIdentityFixture()),
            address(manager),
            keccak256(abi.encode("pool", salt)),
            keccak256(abi.encode("recipe", salt)),
            runtime.programHash(selected)
        );
    }

    function _register(T.Selection[] memory selected, uint256 salt)
        internal
        returns (bytes32 key, ModuleNativeRuntimeV1.Instance[] memory instances_)
    {
        key = engine.register(_binding(selected, salt), selected);
        instances_ = runtime.instances(key);
    }

    function _trade(bytes32 key, address actor, uint256 gross, bool buy) internal view returns (T.Trade memory) {
        return T.Trade(runtime.lastTradeSequence(key) + 1, actor, actor, actor, gross, 1 ether, buy, true, false);
    }

    function _assertBacking() internal view {
        assertEq(vault.totalFunded() - vault.totalClaimed(), vault.totalAvailable() + vault.totalOutstandingClaims());
        assertGe(address(vault).balance, vault.totalAvailable() + vault.totalOutstandingClaims());
    }
}

contract ModuleNativeRuntimeV1Test is ModuleRuntimeTestBase {
    function test_onlyPinnedEngineCanBindAndSupplyTradeFacts() public {
        T.Selection[] memory selected = _single(_probe(0));
        T.LaunchBinding memory binding = _binding(selected, 1);
        vm.expectRevert(ModuleNativeRuntimeV1.OnlyEngine.selector);
        runtime.registerLaunch(binding, selected);
        bytes32 key = engine.register(binding, selected);
        T.Trade memory trade = _trade(key, alice, 1, true);
        vm.expectRevert(ModuleNativeRuntimeV1.OnlyEngine.selector);
        runtime.executeTrade(key, trade);
        vm.etch(address(engine), hex"00");
        vm.prank(address(engine));
        vm.expectRevert(ModuleNativeRuntimeV1.EngineCodeChanged.selector);
        runtime.executeTrade(key, trade);
    }

    function test_rejectsEOAEngine() public {
        vm.expectRevert(ModuleNativeRuntimeV1.InvalidEngine.selector);
        new ModuleNativeRuntimeV1(alice);
    }

    function test_exactProgramConfigurationAndBindingsCannotBeReplaced() public {
        T.Selection[] memory selected = _single(_probe(0));
        T.LaunchBinding memory binding = _binding(selected, 1);
        bytes32 key = engine.register(binding, selected);
        assertEq(key, runtime.launchKeyFor(binding));
        assertEq(abi.encode(runtime.launchBinding(key)), abi.encode(binding));
        ModuleNativeRuntimeV1.Instance memory item = runtime.instances(key)[0];
        assertEq(item.configHash, keccak256(selected[0].config));
        assertEq(item.module.codehash, selected[0].moduleCodeHash);
        assertEq(runtime.launchForToken(binding.source, binding.token), key);
        assertEq(runtime.launchForPool(binding.poolManager, binding.poolId), key);
        vm.expectRevert(ModuleNativeRuntimeV1.InvalidLaunch.selector);
        engine.register(binding, selected);
        selected[0].config = abi.encode(uint8(1));
        vm.expectRevert(ModuleNativeRuntimeV1.InvalidProgram.selector);
        engine.register(binding, selected);
        binding.programHash = runtime.programHash(selected);
        binding.recipeHash = bytes32(uint256(42));
        vm.expectRevert(ModuleNativeRuntimeV1.InvalidLaunch.selector);
        engine.register(binding, selected);
        binding.token = address(new RuntimeIdentityFixture());
        vm.expectRevert(ModuleNativeRuntimeV1.InvalidLaunch.selector);
        engine.register(binding, selected);
    }

    function test_multipleInstancesOfOnePackageHaveSeparateStateAndBudgets() public {
        T.Selection[] memory selected = new T.Selection[](2);
        selected[0] = _probe(1);
        selected[1] = _probe(1);
        (bytes32 key, ModuleNativeRuntimeV1.Instance[] memory instances_) = _register(selected, 1);
        assertTrue(instances_[0].module != instances_[1].module);
        assertTrue(instances_[0].instanceId != instances_[1].instanceId);
        vault.fund{ value: 3 }(instances_[0].instanceId);
        vault.fund{ value: 7 }(instances_[1].instanceId);
        engine.applyTrade(key, _trade(key, alice, 1, true));
        assertEq(vault.available(instances_[0].instanceId), 2);
        assertEq(vault.available(instances_[1].instanceId), 6);
        assertEq(vault.claimable(instances_[0].instanceId, alice), 1);
        assertEq(vault.claimable(instances_[1].instanceId, alice), 1);
        _assertBacking();
    }

    function test_atMostOnceAndGapRejectionArePerLaunch() public {
        (bytes32 key,) = _register(_single(_probe(0)), 1);
        (bytes32 other,) = _register(_single(_probe(0)), 2);
        T.Trade memory trade = _trade(key, alice, 1, true);
        bytes32 id = engine.applyTrade(key, trade);
        vm.expectRevert(abi.encodeWithSelector(ModuleNativeRuntimeV1.InvalidSequence.selector, uint64(2), uint64(1)));
        engine.applyTrade(key, trade);
        trade.sequence = 3;
        vm.expectRevert(abi.encodeWithSelector(ModuleNativeRuntimeV1.InvalidSequence.selector, uint64(2), uint64(3)));
        engine.applyTrade(key, trade);
        trade.sequence = 1;
        assertTrue(engine.applyTrade(other, trade) != id);
        assertEq(engine.appliedCalls(), 2);
    }

    function test_rejectsMissingActorsAmountsAndRepeatedInitialBuy() public {
        (bytes32 key,) = _register(_single(_probe(0)), 1);
        T.Trade memory trade = _trade(key, alice, 1, true);
        trade.actor = address(0);
        vm.expectRevert(ModuleNativeRuntimeV1.InvalidTrade.selector);
        engine.applyTrade(key, trade);
        trade.actor = alice;
        trade.payer = address(0);
        vm.expectRevert(ModuleNativeRuntimeV1.InvalidTrade.selector);
        engine.applyTrade(key, trade);
        trade.payer = alice;
        trade.recipient = address(0);
        vm.expectRevert(ModuleNativeRuntimeV1.InvalidTrade.selector);
        engine.applyTrade(key, trade);
        trade.recipient = alice;
        trade.grossNative = 0;
        vm.expectRevert(ModuleNativeRuntimeV1.InvalidTrade.selector);
        engine.applyTrade(key, trade);
        trade.grossNative = 1;
        trade.tokenAmount = 0;
        vm.expectRevert(ModuleNativeRuntimeV1.InvalidTrade.selector);
        engine.applyTrade(key, trade);
        trade.tokenAmount = 1;
        trade.initialBuy = true;
        engine.applyTrade(key, trade);
        trade.sequence = 2;
        vm.expectRevert(ModuleNativeRuntimeV1.InvalidTrade.selector);
        engine.applyTrade(key, trade);
    }

    function test_moduleCannotReceiveForgedDirectTradeOrSpendOutsideCallback() public {
        (bytes32 key, ModuleNativeRuntimeV1.Instance[] memory instances_) = _register(_single(_probe(1)), 1);
        T.TradeContext memory context =
            T.TradeContext(key, instances_[0].instanceId, bytes32(uint256(1)), _trade(key, alice, 1, true));
        vm.expectRevert(ModuleProgramBaseV1.OnlyBoundRuntime.selector);
        IModuleProgramV1(instances_[0].module).onTrade(context);
        vm.prank(instances_[0].module);
        vm.expectRevert(ModuleNativeRuntimeV1.OnlyActiveModule.selector);
        runtime.credit(alice, 1);
        vm.expectRevert(ModuleNativeBudgetVaultV1.OnlyRuntime.selector);
        vault.credit(instances_[0].instanceId, alice, 1);
    }

    function test_actionsAuthenticateCallerAndBindNonceDeadline() public {
        (bytes32 key, ModuleNativeRuntimeV1.Instance[] memory instances_) = _register(_single(_probe(0)), 1);
        vault.fund{ value: 10 }(instances_[0].instanceId);
        vm.prank(alice);
        runtime.executeAction(key, 0, bytes32("credit"), abi.encode(uint256(4)), 0, block.timestamp);
        assertEq(RuntimeProbeProgram(instances_[0].module).lastActionActor(), alice);
        assertEq(vault.claimable(instances_[0].instanceId, alice), 4);
        assertEq(runtime.actionNonce(key, alice), 1);
        vm.prank(alice);
        vm.expectRevert(ModuleNativeRuntimeV1.InvalidAction.selector);
        runtime.executeAction(key, 0, bytes32("credit"), abi.encode(uint256(4)), 0, block.timestamp);
        vm.prank(bob);
        vm.expectRevert(ModuleNativeRuntimeV1.InvalidAction.selector);
        runtime.executeAction(key, 0, bytes32("credit"), abi.encode(uint256(4)), 0, block.timestamp - 1);
        vm.prank(bob);
        runtime.executeAction(key, 0, bytes32("credit"), abi.encode(uint256(6)), 0, block.timestamp + 1);
        assertEq(vault.claimable(instances_[0].instanceId, bob), 6);
        _assertBacking();
    }

    function test_callbackCannotReenterActionsOrDirectlyCallVault() public {
        for (uint8 mode = 2; mode <= 3; ++mode) {
            (bytes32 key, ModuleNativeRuntimeV1.Instance[] memory instances_) = _register(_single(_probe(mode)), mode);
            vault.fund{ value: 5 }(instances_[0].instanceId);
            engine.applyTrade(key, _trade(key, alice, 1, true));
            assertTrue(RuntimeProbeProgram(instances_[0].module).forbiddenCallRejected());
            assertEq(vault.claimable(instances_[0].instanceId, alice), 1);
        }
        _assertBacking();
    }

    function test_nestedEngineTradeCannotReenterRuntime() public {
        (bytes32 key, ModuleNativeRuntimeV1.Instance[] memory instances_) = _register(_single(_probe(9)), 1);
        T.Trade memory trade = _trade(key, alice, 1, true);
        vm.expectRevert(abi.encodeWithSelector(ModuleNativeRuntimeV1.ModuleCallFailed.selector, instances_[0].module));
        engine.applyTrade(key, trade);
        assertEq(engine.appliedCalls(), 0);
        assertEq(runtime.lastTradeSequence(key), 0);
    }

    function test_nestedTradeAcrossLaunchesCannotEnterAnotherInstance() public {
        (bytes32 target, ModuleNativeRuntimeV1.Instance[] memory targetInstances) = _register(_single(_probe(1)), 1);
        vault.fund{ value: 10 }(targetInstances[0].instanceId);
        T.Selection memory attacker = _probe(10);
        attacker.config = abi.encode(uint8(10), target);
        (bytes32 key, ModuleNativeRuntimeV1.Instance[] memory instances_) = _register(_single(attacker), 2);
        T.Trade memory trade = _trade(key, alice, 1, true);
        vm.expectRevert(abi.encodeWithSelector(ModuleNativeRuntimeV1.ModuleCallFailed.selector, instances_[0].module));
        engine.applyTrade(key, trade);
        assertEq(runtime.lastTradeSequence(key), 0);
        assertEq(runtime.lastTradeSequence(target), 0);
        assertEq(RuntimeProbeProgram(targetInstances[0].module).calls(), 0);
        assertEq(vault.available(targetInstances[0].instanceId), 10);
        assertEq(vault.totalOutstandingClaims(), 0);
        _assertBacking();
    }

    function test_faultyCallbacksRollbackAllPreviousCreditsStateAndEngineWork() public {
        for (uint8 mode = 4; mode <= 8; ++mode) {
            T.Selection[] memory selected = new T.Selection[](2);
            selected[0] = _probe(1);
            selected[1] = _probe(mode);
            (bytes32 key, ModuleNativeRuntimeV1.Instance[] memory instances_) = _register(selected, mode);
            vault.fund{ value: 100 }(instances_[0].instanceId);
            vault.fund{ value: 100 }(instances_[1].instanceId);
            T.Trade memory trade = _trade(key, alice, 1, true);
            vm.expectRevert(
                abi.encodeWithSelector(ModuleNativeRuntimeV1.ModuleCallFailed.selector, instances_[1].module)
            );
            engine.applyTrade(key, trade);
            assertEq(vault.available(instances_[0].instanceId), 100);
            assertEq(vault.available(instances_[1].instanceId), 100);
            assertEq(vault.claimable(instances_[0].instanceId, alice), 0);
            assertEq(RuntimeProbeProgram(instances_[0].module).calls(), 0);
            assertEq(RuntimeProbeProgram(instances_[1].module).calls(), 0);
            assertEq(runtime.lastTradeSequence(key), 0);
            assertEq(engine.appliedCalls(), 0);
        }
        _assertBacking();
    }

    function test_wrongFactoryOrModuleHashesAndBindingFailBeforeUse() public {
        T.Selection[] memory selected = _single(_probe(0));
        selected[0].factoryCodeHash = bytes32(uint256(1));
        T.LaunchBinding memory binding = _binding(selected, 1);
        vm.expectRevert(abi.encodeWithSelector(ModuleNativeRuntimeV1.CodeHashMismatch.selector, address(probeFactory)));
        engine.register(binding, selected);
        selected[0] = _probe(0);
        selected[0].moduleCodeHash = bytes32(uint256(1));
        binding = _binding(selected, 1);
        vm.expectRevert();
        engine.register(binding, selected);
        WrongBindingFactory wrong = new WrongBindingFactory();
        selected[0] = _probe(0);
        selected[0].factory = address(wrong);
        selected[0].factoryCodeHash = address(wrong).codehash;
        binding = _binding(selected, 1);
        vm.expectRevert();
        engine.register(binding, selected);
    }

    function test_changedInstanceCodeCannotRun() public {
        (bytes32 key, ModuleNativeRuntimeV1.Instance[] memory instances_) = _register(_single(_probe(0)), 1);
        T.Trade memory trade = _trade(key, alice, 1, true);
        vm.etch(instances_[0].module, hex"00");
        vm.expectRevert(abi.encodeWithSelector(ModuleNativeRuntimeV1.CodeHashMismatch.selector, instances_[0].module));
        engine.applyTrade(key, trade);
    }

    function test_resourceBoundsCoverAggregateGasConfigAndActionBytes() public {
        T.Selection[] memory selected = new T.Selection[](17);
        T.LaunchBinding memory binding = _binding(selected, 1);
        vm.expectRevert(ModuleNativeRuntimeV1.ResourceLimit.selector);
        engine.register(binding, selected);
        selected = _single(_probe(0));
        selected[0].config = new bytes(16_385);
        binding = _binding(selected, 1);
        vm.expectRevert(ModuleNativeRuntimeV1.ResourceLimit.selector);
        engine.register(binding, selected);
        selected = new T.Selection[](5);
        for (uint256 i; i < 5; ++i) {
            selected[i] = _probe(0);
            selected[i].callbackGas = 500_000;
        }
        binding = _binding(selected, 1);
        vm.expectRevert(ModuleNativeRuntimeV1.ResourceLimit.selector);
        engine.register(binding, selected);
        (bytes32 key,) = _register(_single(_probe(0)), 1);
        vm.expectRevert(ModuleNativeRuntimeV1.InvalidAction.selector);
        runtime.executeAction(key, 0, bytes32("credit"), new bytes(16_385), 0, block.timestamp);
    }

    function test_emptyProgramIsValidButHasNoBudgetAuthority() public {
        T.Selection[] memory empty = new T.Selection[](0);
        (bytes32 key,) = _register(empty, 1);
        engine.applyTrade(key, _trade(key, alice, 1, true));
        assertEq(runtime.lastTradeSequence(key), 1);
        assertEq(runtime.instances(key).length, 0);
        assertEq(vault.totalFunded(), 0);
    }
}
