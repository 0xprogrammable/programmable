// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { PositionManager } from "@uniswap/v4-periphery/src/PositionManager.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { Vm } from "forge-std/Vm.sol";

import { ClassicModulePositionPlannerV1 } from "../../../src/classic-modules/ClassicModulePositionPlannerV1.sol";
import { ClassicModuleLaunchPolicyV1 } from "../../../src/classic-modules/ClassicModuleLaunchPolicyV1.sol";
import { ClassicModuleFeeLedgerV1 } from "../../../src/classic-modules/ClassicModuleFeeLedgerV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../../../src/LockedPositionFeeForwarderFactoryV1.sol";
import { IProgrammableClassicLaunchV1 } from "../../../src/interfaces/IProgrammableClassicLaunchV1.sol";
import { ModuleNativeLaunchV1 } from "../../../src/module-mode/engine/ModuleNativeLaunchV1.sol";
import { ModuleNativeHookV1 } from "../../../src/module-mode/engine/ModuleNativeHookV1.sol";
import { ModuleNativeSwapRouterV1 } from "../../../src/module-mode/engine/ModuleNativeSwapRouterV1.sol";
import { ModuleNativeSwapRouterFactoryV1 } from "../../../src/module-mode/engine/ModuleNativeSwapRouterFactoryV1.sol";
import { ModuleNativeRegistryV1 } from "../../../src/module-mode/engine/ModuleNativeRegistryV1.sol";
import { ModuleNativeRuntimeFactoryV1 } from "../../../src/module-mode/engine/ModuleNativeRuntimeFactoryV1.sol";
import { ModuleNativeRuntimeV1 } from "../../../src/module-mode/ModuleNativeRuntimeV1.sol";
import { ModuleNativeBudgetVaultV1 } from "../../../src/module-mode/ModuleNativeBudgetVaultV1.sol";
import { ModuleRuntimeTypesV1 as T } from "../../../src/module-mode/ModuleRuntimeTypesV1.sol";
import { ModuleNativeEngineTypesV1 as E } from "../../../src/module-mode/engine/ModuleNativeEngineTypesV1.sol";
import {
    EveryNthBuyRewardV1,
    EveryNthBuyRewardFactoryV1
} from "../../../src/module-mode/modules/EveryNthBuyRewardV1.sol";
import {
    TimedWalletBuyCapV1,
    TimedWalletBuyCapFactoryV1
} from "../../../src/module-mode/modules/TimedWalletBuyCapV1.sol";
import { ModuleProgramBaseV1 } from "../../../src/module-mode/ModuleProgramBaseV1.sol";
import { IModuleProgramV1, IModuleProgramFactoryV1 } from "../../../src/module-mode/IModuleProgramV1.sol";

contract EngineReentryProbeProgramV1 is ModuleProgramBaseV1 {
    bool public reentrySucceeded;
    bytes4 public rejection;
    constructor(T.InstanceBinding memory binding) ModuleProgramBaseV1(binding) { }

    function onTrade(T.TradeContext calldata context) external returns (bytes4) {
        _authenticate(context.launchKey, context.instanceId);
        ModuleNativeRuntimeV1 host = ModuleNativeRuntimeV1(_runtime());
        T.LaunchBinding memory launch = host.launchBinding(context.launchKey);
        ModuleNativeHookV1 target = ModuleNativeHookV1(host.engine());
        (bool ok, bytes memory result) = target.routerOf(launch.poolId)
            .call(
                abi.encodeCall(
                    ModuleNativeSwapRouterV1.swap,
                    (launch.token, false, -int256(1), uint256(1), address(this), block.timestamp)
                )
            );
        reentrySucceeded = ok;
        if (result.length >= 4) rejection = bytes4(result);
        return IModuleProgramV1.onTrade.selector;
    }

    function onAction(T.ActionContext calldata, bytes calldata) external pure returns (bytes4) {
        revert UnsupportedAction();
    }
}

contract EngineReentryProbeFactoryV1 is IModuleProgramFactoryV1 {
    function create(T.InstanceBinding calldata binding, bytes calldata) external returns (address) {
        require(msg.sender == binding.runtime);
        return address(new EngineReentryProbeProgramV1(binding));
    }
}

/// @dev A fixture exercises a nested contract-wallet launch; it is not a production wallet implementation.
contract EngineSmartWalletFixtureV1 {
    function launch(ModuleNativeLaunchV1 source, ModuleNativeLaunchV1.LaunchParameters calldata parameters)
        external
        payable
        returns (ModuleNativeLaunchV1.LaunchRecord memory)
    {
        return source.launch{ value: msg.value }(parameters);
    }
}

contract ModuleNativeEngineV1Test is Deployers {
    using StateLibrary for IPoolManager;

    uint256 private constant MIN_BUY = 0.0003 ether;
    uint160 private constant HOOK_FLAGS = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
        | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
    ModuleNativeRegistryV1 private registry;
    ModuleNativeHookV1 private hook;
    ModuleNativeLaunchV1 private launcher;
    ModuleNativeSwapRouterV1 private route;
    ModuleNativeRuntimeV1 private runtime;
    ClassicModuleFeeLedgerV1 private ledger;
    PositionManager private positions;
    address private creator;
    address private buyer;
    address private treasury;
    address private noModules;
    address private authorA;
    address private authorB;
    bytes32 private rewardFamily;
    bytes32 private capFamily;
    bytes32 private constant REWARD_PACKAGE = keccak256("reward-package-source-v1");
    bytes32 private constant CAP_PACKAGE = keccak256("cap-package-source-v1");
    EveryNthBuyRewardFactoryV1 private rewardFactory;
    TimedWalletBuyCapFactoryV1 private capFactory;

    function setUp() public {
        vm.chainId(4663);
        vm.warp(1_800_000_000);
        deployFreshManagerAndRouters();
        positions = PositionManager(
            payable(deployCode(
                    "PositionManager.sol:PositionManager",
                    abi.encode(manager, address(0), uint256(0), address(0), address(0))
                ))
        );
        registry = new ModuleNativeRegistryV1(address(this));
        ModuleNativeRuntimeFactoryV1 hostFactory = new ModuleNativeRuntimeFactoryV1();
        treasury = makeAddr("treasury");
        noModules = makeAddr("no-modules");
        bytes memory args = abi.encode(manager, registry, hostFactory, treasury, makeAddr("reward-admin"), noModules);
        (address predicted, bytes32 salt) =
            HookMiner.find(address(this), HOOK_FLAGS, type(ModuleNativeHookV1).creationCode, args);
        hook = new ModuleNativeHookV1{ salt: salt }(
            manager, registry, hostFactory, treasury, makeAddr("reward-admin"), noModules
        );
        assertEq(address(hook), predicted);
        ModuleNativeSwapRouterFactoryV1 routeFactory = new ModuleNativeSwapRouterFactoryV1();
        launcher = new ModuleNativeLaunchV1(
            manager,
            positions,
            new UERC20Factory(),
            hook,
            new ClassicModulePositionPlannerV1(),
            new ClassicModuleLaunchPolicyV1(),
            new LockedPositionFeeForwarderFactoryV1(positions),
            routeFactory,
            address(routeFactory).codehash,
            MIN_BUY
        );
        route = launcher.swapRouter();
        runtime = hook.runtime();
        ledger = hook.ledger();
        creator = makeAddr("creator");
        buyer = makeAddr("buyer");
        authorA = makeAddr("author-a");
        authorB = makeAddr("author-b");
        vm.deal(creator, 100 ether);
        vm.deal(buyer, 100 ether);
        vm.prank(authorA);
        rewardFamily = registry.registerFamily(bytes32("reward"), authorA);
        vm.prank(authorB);
        capFamily = registry.registerFamily(bytes32("cap"), authorB);
        rewardFactory = new EveryNthBuyRewardFactoryV1();
        capFactory = new TimedWalletBuyCapFactoryV1();
        registry.approveRevision(
            REWARD_PACKAGE,
            rewardFamily,
            address(rewardFactory),
            rewardFactory.moduleCodeHash(),
            keccak256("reward-review"),
            400_000
        );
        registry.approveRevision(
            CAP_PACKAGE, capFamily, address(capFactory), capFactory.moduleCodeHash(), keccak256("cap-review"), 200_000
        );
    }

    function test_plainLaunchUsesRealPoolManagerCanonicalIdentityAndPermanentlyLockedSupply() public {
        ModuleNativeLaunchV1.LaunchRecord memory result = _launch(_parameters());
        assertEq(result.launchWallet, creator);
        assertGt(result.initialBuyTokens, 0);
        assertEq(IERC20(result.token).balanceOf(creator), result.initialBuyTokens);
        assertEq(IERC20(result.token).totalSupply(), 1_000_000_000 ether);
        assertEq(IERC20Metadata(result.token).decimals(), 18);
        assertEq(IERC20(result.token).balanceOf(address(launcher)), 0);
        assertEq(IERC20(result.token).balanceOf(address(positions)), 0);
        assertEq(address(launcher).balance, 0);
        assertEq(address(route).balance, 0);
        assertEq(result.runtime, address(runtime));
        assertEq(runtime.lastTradeSequence(result.launchKey), 1);
        assertEq(runtime.instances(result.launchKey).length, 0);
        assertEq(ledger.claimable(treasury), MIN_BUY / 1000);
        assertEq(ledger.claimable(noModules), MIN_BUY / 1000);
        IProgrammableClassicLaunchV1.LaunchIdentity memory identity = launcher.getLaunchIdentity(result.token);
        assertEq(identity.launchId, result.launchId);
        assertEq(identity.recipeHash, result.recipeHash);
        assertEq(identity.poolManager, address(manager));
        assertEq(identity.hook, address(hook));
        assertEq(IERC721(address(positions)).ownerOf(result.positionTokenId), result.positionRecipient);
        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(result.positionRecipient));
        assertEq(forwarder.operator(), address(0));
        assertEq(forwarder.timelockBlockNumber(), type(uint256).max);
        vm.prank(creator);
        vm.expectRevert();
        IERC721(address(positions)).transferFrom(result.positionRecipient, creator, result.positionTokenId);
    }

    function test_nativeFeesAllFourRoutesZeroCreatorFee() public {
        _fourRoutes(0);
    }

    function test_nativeFeesAllFourRoutesTenPercentCreatorFee() public {
        _fourRoutes(1000);
    }

    function _fourRoutes(uint16 bps) private {
        ModuleNativeLaunchV1.LaunchParameters memory p = _parameters();
        p.buyCreatorFeeBps = bps;
        p.sellCreatorFeeBps = bps;
        p.initialBuyNative = 0.1 ether;
        ModuleNativeLaunchV1.LaunchRecord memory result = _launch(p);
        uint256 before = ledger.totalFeesReceived();
        vm.prank(buyer);
        (uint256 nativeIn, uint256 bought) =
            route.swap{ value: 0.02 ether }(result.token, true, -int256(0.02 ether), 1, buyer, block.timestamp);
        _assertGrossFeeDelta(before, nativeIn, bps);
        assertEq(nativeIn, 0.02 ether);
        uint256 initialBuyerBalance = buyer.balance;
        before = ledger.totalFeesReceived();
        vm.prank(buyer);
        (nativeIn,) =
            route.swap{ value: 0.05 ether }(result.token, true, int256(bought / 4), 0.05 ether, buyer, block.timestamp);
        assertEq(initialBuyerBalance - buyer.balance, nativeIn);
        _assertNetFeeDelta(before, nativeIn, bps);
        vm.prank(buyer);
        IERC20(result.token).approve(address(route), type(uint256).max);
        before = ledger.totalFeesReceived();
        vm.prank(buyer);
        (uint256 nativeOut,) = route.swap(result.token, false, -int256(bought / 4), 1, buyer, block.timestamp);
        uint256 fee = ledger.totalFeesReceived() - before;
        _assertGrossFeeDelta(before, nativeOut + fee, bps);
        before = ledger.totalFeesReceived();
        vm.prank(buyer);
        (nativeOut,) = route.swap(result.token, false, int256(0.001 ether), bought, buyer, block.timestamp);
        assertEq(nativeOut, 0.001 ether);
        (uint256 creatorFee, uint256 platformFee) = hook.quoteExactOutputFees(nativeOut, bps);
        assertEq(ledger.totalFeesReceived() - before, creatorFee + platformFee);
        assertEq(runtime.lastTradeSequence(result.launchKey), 5);
    }

    function test_fundedInitialBuyRewardAndOrdinaryEvmAuthorWallets() public {
        ModuleNativeLaunchV1.LaunchParameters memory p = _parameters();
        p.modules = new T.Selection[](1);
        p.modules[0] = _reward(1, true);
        p.moduleFunding = new uint256[](1);
        p.moduleFunding[0] = 0.01 ether;
        ModuleNativeLaunchV1.LaunchRecord memory result = _launch(p);
        ModuleNativeRuntimeV1.Instance memory instance = runtime.instances(result.launchKey)[0];
        ModuleNativeBudgetVaultV1 vault = runtime.vault();
        assertEq(vault.claimable(instance.instanceId, creator), 0.001 ether);
        assertEq(vault.available(instance.instanceId), 0.009 ether);
        assertEq(EveryNthBuyRewardV1(instance.module).qualifiedBuys(), 1);
        assertEq(ledger.claimable(authorA), MIN_BUY / 1000);
        uint256 before = creator.balance;
        vault.claim(instance.instanceId, creator);
        assertEq(creator.balance - before, 0.001 ether);
        assertEq(vault.totalFunded(), vault.totalAvailable() + vault.totalOutstandingClaims() + vault.totalClaimed());
        assertEq(ledger.totalFeesReceived(), MIN_BUY * 20 / 10_000);
    }

    function test_statefulWalletCapVetoRollsBackSwapFeesAndOtherModuleState() public {
        ModuleNativeLaunchV1.LaunchParameters memory p = _parameters();
        p.modules = _twoModules();
        p.moduleFunding = new uint256[](2);
        uint256 rewardIndex = p.modules[0].packageId == REWARD_PACKAGE ? 0 : 1;
        p.moduleFunding[rewardIndex] = 0.01 ether;
        ModuleNativeLaunchV1.LaunchRecord memory result = _launch(p);
        vm.prank(buyer);
        route.swap{ value: 0.001 ether }(result.token, true, -int256(0.001 ether), 1, buyer, block.timestamp);
        ModuleNativeRuntimeV1.Instance[] memory selected = runtime.instances(result.launchKey);
        TimedWalletBuyCapV1 cap = TimedWalletBuyCapV1(selected[1 - rewardIndex].module);
        EveryNthBuyRewardV1 reward = EveryNthBuyRewardV1(selected[rewardIndex].module);
        uint256 received = ledger.totalFeesReceived();
        uint256 balance = IERC20(result.token).balanceOf(buyer);
        uint256 nativeBalance = buyer.balance;
        uint256 qualified = reward.qualifiedBuys();
        uint256 claims = runtime.vault().totalOutstandingClaims();
        (uint160 price,,,) = manager.getSlot0(PoolId.wrap(result.poolId));
        vm.prank(buyer);
        vm.expectRevert();
        route.swap{ value: 0.0011 ether }(result.token, true, -int256(0.0011 ether), 1, buyer, block.timestamp);
        assertEq(cap.spentNative(buyer), 0.001 ether);
        assertEq(ledger.totalFeesReceived(), received);
        assertEq(IERC20(result.token).balanceOf(buyer), balance);
        assertEq(buyer.balance, nativeBalance);
        assertEq(reward.qualifiedBuys(), qualified);
        assertEq(runtime.vault().totalOutstandingClaims(), claims);
        assertEq(runtime.lastTradeSequence(result.launchKey), 2);
        (uint160 afterPrice,,,) = manager.getSlot0(PoolId.wrap(result.poolId));
        assertEq(afterPrice, price);
        assertEq(ledger.claimable(authorA), ledger.claimable(authorB));
    }

    function test_unauthenticatedRouterAndSpoofedHookDataCannotBypassWalletLimit() public {
        ModuleNativeLaunchV1.LaunchRecord memory result = _launch(_parameters());
        E.RouteContext memory forged = E.RouteContext(creator, creator, buyer, 2, false);
        PoolKey memory key = launcher.poolKey(result.token);
        vm.prank(buyer);
        vm.expectRevert();
        swapRouter.swap{ value: MIN_BUY }(
            key,
            SwapParams(true, -int256(MIN_BUY), TickMath.MIN_SQRT_PRICE + 1),
            PoolSwapTest.TestSettings(false, false),
            abi.encode(forged)
        );
        assertEq(runtime.lastTradeSequence(result.launchKey), 1);
        vm.prank(buyer);
        vm.expectRevert(ModuleNativeSwapRouterV1.UnauthorizedSource.selector);
        route.initialBuy{ value: MIN_BUY }(result.token, creator, 1, block.timestamp);
        vm.expectRevert(ModuleNativeSwapRouterV1.InvalidCallback.selector);
        route.unlockCallback("");
    }

    function test_disablingCatalogueStopsNewLaunchesButKeepsExistingProgramTrading() public {
        ModuleNativeLaunchV1.LaunchParameters memory p = _parameters();
        p.modules = new T.Selection[](1);
        p.modules[0] = _reward(1, false);
        p.moduleFunding = new uint256[](1);
        ModuleNativeLaunchV1.LaunchRecord memory result = _launch(p);
        registry.setRevisionEnabled(REWARD_PACKAGE, false);
        vm.prank(buyer);
        route.swap{ value: MIN_BUY }(result.token, true, -int256(MIN_BUY), 1, buyer, block.timestamp);
        p.creatorSalt = bytes32("next");
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(ModuleNativeRegistryV1.UnavailableRevision.selector, REWARD_PACKAGE));
        launcher.launch{ value: MIN_BUY }(p);
        assertEq(runtime.lastTradeSequence(result.launchKey), 2);
    }

    function test_ctoRecipientReplacementPreservesPastWholeClaims() public {
        ModuleNativeLaunchV1.LaunchParameters memory p = _parameters();
        p.buyCreatorFeeBps = 1000;
        ModuleNativeLaunchV1.LaunchRecord memory result = _launch(p);
        uint256 past = ledger.claimable(creator);
        address[] memory replacements = new address[](1);
        replacements[0] = makeAddr("cto");
        vm.prank(treasury);
        ledger.replaceCreatorWallets(result.poolId, replacements, 0, block.timestamp + 1);
        vm.prank(buyer);
        route.swap{ value: MIN_BUY }(result.token, true, -int256(MIN_BUY), 1, buyer, block.timestamp);
        assertEq(ledger.claimable(creator), past);
        assertEq(ledger.claimable(replacements[0]), past);
        uint256 before = creator.balance;
        ledger.claim(creator);
        assertEq(creator.balance - before, past);
    }

    function test_initialBuySlippageRevertsTokenPoolProgramFundingAndFees() public {
        ModuleNativeLaunchV1.LaunchParameters memory p = _parameters();
        p.modules = new T.Selection[](1);
        p.modules[0] = _reward(1, true);
        p.moduleFunding = new uint256[](1);
        p.moduleFunding[0] = 0.01 ether;
        p.minimumInitialTokenOut = type(uint256).max;
        (address predicted,) = launcher.predictTokenAddress(p.name, p.symbol, creator, p.creatorSalt);
        uint256 nextPosition = positions.nextTokenId();
        uint256 before = creator.balance;
        vm.prank(creator);
        vm.expectRevert();
        launcher.launch{ value: MIN_BUY + 0.01 ether }(p);
        assertEq(predicted.code.length, 0);
        assertEq(positions.nextTokenId(), nextPosition);
        assertEq(creator.balance, before);
        assertEq(runtime.launchForToken(address(launcher), predicted), bytes32(0));
        assertEq(runtime.vault().totalFunded(), 0);
        assertEq(ledger.totalFeesReceived(), 0);
        assertEq(launcher.getLaunchIdentity(predicted).launchId, bytes32(0));
    }

    function test_moduleCannotReenterTheAuthenticatingRouter() public {
        bytes32 family = registry.registerFamily(bytes32("reentry-probe"), authorA);
        EngineReentryProbeFactoryV1 factory = new EngineReentryProbeFactoryV1();
        bytes32 packageId = keccak256("reviewed-test-reentry-probe");
        bytes32 codeHash = keccak256(type(EngineReentryProbeProgramV1).runtimeCode);
        registry.approveRevision(packageId, family, address(factory), codeHash, keccak256("test-only-review"), 400_000);
        ModuleNativeLaunchV1.LaunchParameters memory p = _parameters();
        p.modules = new T.Selection[](1);
        p.modules[0] = T.Selection(packageId, address(factory), address(factory).codehash, codeHash, 400_000, "");
        p.moduleFunding = new uint256[](1);
        ModuleNativeLaunchV1.LaunchRecord memory result = _launch(p);
        EngineReentryProbeProgramV1 probe = EngineReentryProbeProgramV1(runtime.instances(result.launchKey)[0].module);
        assertFalse(probe.reentrySucceeded());
        assertEq(probe.rejection(), bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        assertEq(runtime.lastTradeSequence(result.launchKey), 1);
        vm.prank(buyer);
        route.swap{ value: MIN_BUY }(result.token, true, -int256(MIN_BUY), 1, buyer, block.timestamp);
        assertFalse(probe.reentrySucceeded());
        assertEq(runtime.lastTradeSequence(result.launchKey), 2);
    }

    function test_duplicateFunctionalFamilyCannotMultiplyAuthorShares() public {
        bytes32 nextPackage = keccak256("next-reward-revision");
        registry.approveRevision(
            nextPackage,
            rewardFamily,
            address(rewardFactory),
            rewardFactory.moduleCodeHash(),
            keccak256("next-review"),
            400_000
        );
        ModuleNativeLaunchV1.LaunchParameters memory p = _parameters();
        p.modules = new T.Selection[](2);
        p.modules[0] = _reward(1, true);
        p.modules[1] = _reward(2, false);
        p.modules[1].packageId = nextPackage;
        p.moduleFunding = new uint256[](2);
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(ModuleNativeHookV1.InvalidModuleOrder.selector, rewardFamily));
        launcher.launch{ value: MIN_BUY }(p);
    }

    function test_changedFactoryAndInventedModuleHashRejectedBeforeTokenDeployment() public {
        ModuleNativeLaunchV1.LaunchParameters memory p = _parameters();
        p.modules = new T.Selection[](1);
        p.modules[0] = _reward(1, true);
        p.modules[0].moduleCodeHash = keccak256("invented-runtime");
        p.moduleFunding = new uint256[](1);
        (address token,) = launcher.predictTokenAddress(p.name, p.symbol, creator, p.creatorSalt);
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(ModuleNativeRegistryV1.SelectionMismatch.selector, REWARD_PACKAGE));
        launcher.launch{ value: MIN_BUY }(p);
        assertEq(token.code.length, 0);
        p.modules[0] = _reward(1, true);
        vm.etch(address(rewardFactory), hex"00");
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(ModuleNativeRegistryV1.SelectionMismatch.selector, REWARD_PACKAGE));
        launcher.launch{ value: MIN_BUY }(p);
        assertEq(token.code.length, 0);
    }

    function test_quoteRecipientIsAuthenticatedSeparatelyFromCapAndRewardActor() public {
        ModuleNativeLaunchV1.LaunchParameters memory p = _parameters();
        p.modules = new T.Selection[](1);
        p.modules[0] = _reward(1, false);
        p.moduleFunding = new uint256[](1);
        p.moduleFunding[0] = 0.01 ether;
        ModuleNativeLaunchV1.LaunchRecord memory result = _launch(p);
        address recipient = makeAddr("gift-recipient");
        vm.prank(buyer);
        (, uint256 received) =
            route.swap{ value: MIN_BUY }(result.token, true, -int256(MIN_BUY), 1, recipient, block.timestamp);
        bytes32 instanceId = runtime.instances(result.launchKey)[0].instanceId;
        assertEq(IERC20(result.token).balanceOf(recipient), received);
        assertEq(IERC20(result.token).balanceOf(buyer), 0);
        assertEq(runtime.vault().claimable(instanceId, buyer), 0.001 ether);
        assertEq(runtime.vault().claimable(instanceId, recipient), 0);
    }

    function test_authorWalletRotationChangesOnlyFutureAccrual() public {
        ModuleNativeLaunchV1.LaunchParameters memory p = _parameters();
        p.modules = new T.Selection[](1);
        p.modules[0] = _reward(1, false);
        p.moduleFunding = new uint256[](1);
        ModuleNativeLaunchV1.LaunchRecord memory result = _launch(p);
        uint256 previous = ledger.claimable(authorA);
        address next = makeAddr("next-author-wallet");
        vm.prank(authorA);
        registry.changeAuthorWallet(rewardFamily, next);
        vm.prank(buyer);
        route.swap{ value: MIN_BUY }(result.token, true, -int256(MIN_BUY), 1, buyer, block.timestamp);
        assertEq(ledger.claimable(authorA), previous);
        assertEq(ledger.claimable(next), previous);
    }

    function test_nonzeroInitialPurchaseAndCreatorFeeStepsEnforced() public {
        ModuleNativeLaunchV1.LaunchParameters memory p = _parameters();
        p.initialBuyNative = 0;
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(ModuleNativeLaunchV1.InitialBuyBelowMinimum.selector, 0, MIN_BUY));
        launcher.launch(p);
        p.initialBuyNative = MIN_BUY;
        p.buyCreatorFeeBps = 101;
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(ClassicModuleLaunchPolicyV1.InvalidCreatorFee.selector, uint16(101)));
        launcher.launch{ value: MIN_BUY }(p);
        p.buyCreatorFeeBps = 1100;
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(ClassicModuleLaunchPolicyV1.InvalidCreatorFee.selector, uint16(1100)));
        launcher.launch{ value: MIN_BUY }(p);
    }

    function test_exactOutputInsufficientMaxInputRollsBackFeesAndProgramSequence() public {
        ModuleNativeLaunchV1.LaunchRecord memory result = _launch(_parameters());
        uint256 fees = ledger.totalFeesReceived();
        vm.prank(buyer);
        vm.expectRevert();
        route.swap{ value: 1 }(result.token, true, int256(result.initialBuyTokens), 1, buyer, block.timestamp);
        assertEq(ledger.totalFeesReceived(), fees);
        assertEq(runtime.lastTradeSequence(result.launchKey), 1);
        assertEq(IERC20(result.token).balanceOf(buyer), 0);
    }

    function test_routerExpiryAndIncorrectNativeFundingRejectBeforeExecution() public {
        ModuleNativeLaunchV1.LaunchRecord memory result = _launch(_parameters());
        vm.prank(buyer);
        vm.expectRevert(ModuleNativeSwapRouterV1.InvalidRequest.selector);
        route.swap{ value: MIN_BUY }(result.token, true, -int256(MIN_BUY), 1, buyer, block.timestamp - 1);
        vm.prank(buyer);
        vm.expectRevert(ModuleNativeSwapRouterV1.InvalidRequest.selector);
        route.swap{ value: MIN_BUY - 1 }(result.token, true, -int256(MIN_BUY), 1, buyer, block.timestamp);
        assertEq(runtime.lastTradeSequence(result.launchKey), 1);
    }

    function test_reviewedApiFamilyPreservesAuthenticatedAuthorAndOrdinaryRewardWallet() public {
        address author = makeAddr("api-authenticated-author");
        address payout = makeAddr("api-reward-wallet");
        bytes32 salt = keccak256("api-family-salt");
        bytes32 digest = keccak256("immutable-api-submission");
        bytes32 family = registry.registerReviewedFamily(author, salt, payout, digest);
        assertEq(family, keccak256(abi.encode(author, salt)));
        assertEq(registry.authorWallet(family), payout);
        vm.expectRevert(ModuleNativeRegistryV1.InvalidFamily.selector);
        registry.registerReviewedFamily(author, salt, creator, digest);
        vm.expectRevert(ModuleNativeRegistryV1.UnauthorizedAuthor.selector);
        registry.changeAuthorWallet(family, creator);
        vm.prank(author);
        registry.changeAuthorWallet(family, creator);
        assertEq(registry.authorWallet(family), creator);
        vm.prank(buyer);
        vm.expectRevert();
        registry.registerReviewedFamily(buyer, bytes32("forgery"), buyer, digest);
    }

    function test_rewardManageActionReturnsExpiredUnusedFundsAndPreservesWinnerClaims() public {
        ModuleNativeLaunchV1.LaunchParameters memory p = _parameters();
        p.modules = new T.Selection[](1);
        p.modules[0] = _reward(1, false);
        p.moduleFunding = new uint256[](1);
        p.moduleFunding[0] = 0.01 ether;
        ModuleNativeLaunchV1.LaunchRecord memory result = _launch(p);
        vm.prank(buyer);
        route.swap{ value: MIN_BUY }(result.token, true, -int256(MIN_BUY), 1, buyer, block.timestamp);
        ModuleNativeRuntimeV1.Instance memory instance = runtime.instances(result.launchKey)[0];
        EveryNthBuyRewardV1 reward = EveryNthBuyRewardV1(instance.module);
        bytes32 action = reward.RECLAIM_UNUSED();
        vm.prank(creator);
        vm.expectRevert();
        runtime.executeAction(result.launchKey, 0, action, "", 0, block.timestamp + 1);
        assertEq(runtime.actionNonce(result.launchKey, creator), 0);
        vm.warp(reward.endsAt());
        vm.prank(buyer);
        vm.expectRevert();
        runtime.executeAction(result.launchKey, 0, action, "", 0, block.timestamp + 1);
        uint256 fees = ledger.totalFeesReceived();
        vm.prank(creator);
        runtime.executeAction(result.launchKey, 0, action, "", 0, block.timestamp + 1);
        assertEq(runtime.vault().available(instance.instanceId), 0);
        assertEq(runtime.vault().claimable(instance.instanceId, creator), 0.009 ether);
        assertEq(runtime.vault().claimable(instance.instanceId, buyer), 0.001 ether);
        assertEq(ledger.totalFeesReceived(), fees);
        assertEq(runtime.lastTradeSequence(result.launchKey), 2);
        vm.prank(creator);
        runtime.executeAction(result.launchKey, 0, action, "", 1, block.timestamp + 1);
        assertEq(runtime.vault().claimable(instance.instanceId, creator), 0.009 ether);
        assertEq(runtime.actionNonce(result.launchKey, creator), 2);
        vm.prank(buyer);
        route.swap{ value: MIN_BUY }(result.token, true, -int256(MIN_BUY), 1, buyer, block.timestamp);
        assertEq(reward.qualifiedBuys(), 1);
        assertEq(runtime.lastTradeSequence(result.launchKey), 3);
    }

    function test_forcedNativeBalancesCannotBeSpentByAnotherTraderOrLaunch() public {
        vm.deal(address(launcher), 1 ether);
        vm.deal(address(route), 2 ether);
        ModuleNativeLaunchV1.LaunchRecord memory result = _launch(_parameters());
        assertEq(address(launcher).balance, 1 ether);
        assertEq(address(route).balance, 2 ether);
        vm.prank(buyer);
        route.swap{ value: MIN_BUY }(result.token, true, -int256(MIN_BUY), 1, buyer, block.timestamp);
        assertEq(address(launcher).balance, 1 ether);
        assertEq(address(route).balance, 2 ether);
        vm.prank(buyer);
        vm.expectRevert(ModuleNativeSwapRouterV1.InvalidRequest.selector);
        route.swap(result.token, true, -int256(MIN_BUY), 1, buyer, block.timestamp);
        assertEq(address(route).balance, 2 ether);
    }

    function test_runtimeInitializationCannotBeRedirectedOrRepeated() public {
        address initial = address(runtime);
        vm.prank(buyer);
        assertEq(address(hook.ensureRuntime()), initial);
        assertEq(runtime.engine(), address(hook));
        assertEq(runtime.engineCodeHash(), address(hook).codehash);
        assertEq(address(hook.runtimeFactory().runtimeOf(address(hook))), initial);
        assertEq(hook.runtimeFactory().predict(address(hook)), initial);
        assertEq(launcher.swapRouterFactory().predict(address(launcher), manager, hook), address(route));
    }

    function test_runtimeFactoryPredictionSurvivesOtherEngineCreation() public {
        ModuleNativeRuntimeFactoryV1 factory = new ModuleNativeRuntimeFactoryV1();
        address expected = factory.predict(address(hook));
        vm.prank(address(positions));
        ModuleNativeRuntimeV1 other = factory.create();
        assertNotEq(address(other), expected);
        assertEq(factory.predict(address(hook)), expected);
        vm.prank(address(hook));
        ModuleNativeRuntimeV1 created = factory.create();
        assertEq(address(created), expected);
        assertEq(created.engine(), address(hook));
        assertEq(created.engineCodeHash(), address(hook).codehash);
        vm.prank(address(hook));
        assertEq(address(factory.create()), expected);
    }

    function test_routerFactoryPredictionSurvivesOtherSourceCreation() public {
        ModuleNativeSwapRouterFactoryV1 factory = new ModuleNativeSwapRouterFactoryV1();
        address expected = factory.predict(address(launcher), manager, hook);
        vm.prank(buyer);
        ModuleNativeSwapRouterV1 other = factory.create(manager, hook);
        assertNotEq(address(other), expected);
        assertEq(factory.predict(address(launcher), manager, hook), expected);
        vm.prank(address(launcher));
        ModuleNativeSwapRouterV1 created = factory.create(manager, hook);
        assertEq(address(created), expected);
        assertEq(created.source(), address(launcher));
        assertEq(address(created.hook()), address(hook));
        assertEq(address(created.poolManager()), address(manager));
        vm.prank(address(launcher));
        vm.expectRevert(ModuleNativeSwapRouterFactoryV1.RouterAlreadyCreated.selector);
        factory.create(manager, hook);
    }

    function test_hookDeploymentRejectsUnreviewedRegistryCodeEvenWhenAddressHasCode() public {
        ModuleNativeRuntimeFactoryV1 factory = hook.runtimeFactory();
        address alternate = makeAddr("alternate-no-module-recipient");
        address administrator = ledger.rewardAdmin();
        bytes memory args = abi.encode(manager, registry, factory, treasury, administrator, alternate);
        (, bytes32 salt) = HookMiner.find(address(this), HOOK_FLAGS, type(ModuleNativeHookV1).creationCode, args);
        vm.etch(address(registry), hex"00");
        vm.expectRevert(ModuleNativeHookV1.InvalidDependency.selector);
        new ModuleNativeHookV1{ salt: salt }(manager, registry, factory, treasury, administrator, alternate);
    }

    function test_smartWalletLaunchEmitsSaltAndGraffitiWithoutOuterCalldataAssumptions() public {
        EngineSmartWalletFixtureV1 wallet = new EngineSmartWalletFixtureV1();
        ModuleNativeLaunchV1.LaunchParameters memory p = _parameters();
        p.creatorSalt = keccak256("contract-wallet-salt");
        (address predicted, bytes32 graffiti) =
            launcher.predictTokenAddress(p.name, p.symbol, address(wallet), p.creatorSalt);
        vm.recordLogs();
        vm.prank(creator);
        ModuleNativeLaunchV1.LaunchRecord memory result = wallet.launch{ value: MIN_BUY }(launcher, p);
        assertEq(result.token, predicted);
        assertEq(result.launchWallet, address(wallet));
        assertEq(IERC20(result.token).balanceOf(address(wallet)), result.initialBuyTokens);
        assertEq(launcher.getLaunchIdentity(result.token).launchWallet, address(wallet));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256("ModuleNativeTokenIdentityBound(bytes32,bytes32,bytes32)");
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(launcher) || logs[i].topics[0] != topic) continue;
            assertEq(logs[i].topics[1], result.launchId);
            assertEq(logs[i].data, abi.encode(p.creatorSalt, graffiti));
            found = true;
        }
        assertTrue(found);
    }

    function testFuzz_nativeRoundtripKeepsAllHookClaimsBacked(uint96 rawInput, uint16 rawFee) public {
        uint256 input = bound(uint256(rawInput), MIN_BUY, 0.02 ether);
        uint16 bps = uint16(rawFee % 11) * 100;
        ModuleNativeLaunchV1.LaunchParameters memory p = _parameters();
        p.buyCreatorFeeBps = bps;
        p.sellCreatorFeeBps = bps;
        p.initialBuyNative = 0.1 ether;
        ModuleNativeLaunchV1.LaunchRecord memory result = _launch(p);
        uint256 fees = ledger.totalFeesReceived();
        vm.prank(buyer);
        (, uint256 bought) = route.swap{ value: input }(result.token, true, -int256(input), 1, buyer, block.timestamp);
        assertEq(ledger.totalFeesReceived() - fees, input * (uint256(bps) + 20) / 10_000);
        vm.prank(buyer);
        IERC20(result.token).approve(address(route), bought);
        fees = ledger.totalFeesReceived();
        vm.prank(buyer);
        (uint256 nativeOut,) = route.swap(result.token, false, -int256(bought / 2), 1, buyer, block.timestamp);
        uint256 charged = ledger.totalFeesReceived() - fees;
        assertEq(charged, (nativeOut + charged) * (uint256(bps) + 20) / 10_000);
        assertEq(manager.balanceOf(address(ledger), 0), ledger.totalFeesReceived() - ledger.totalClaimed());
        assertEq(runtime.lastTradeSequence(result.launchKey), 3);
        assertEq(IERC20(result.token).totalSupply(), 1_000_000_000 ether);
    }

    function _assertGrossFeeDelta(uint256 before, uint256 gross, uint16 bps) private view {
        assertEq(ledger.totalFeesReceived() - before, gross * (uint256(bps) + 20) / 10_000);
    }

    function _assertNetFeeDelta(uint256 before, uint256 gross, uint16 bps) private view {
        uint256 fees = ledger.totalFeesReceived() - before;
        uint256 net = gross - fees;
        uint256 denominator = 10_000 - uint256(bps) - 20;
        uint256 expectedGross = (net * 10_000 + denominator - 1) / denominator;
        assertEq(fees, expectedGross - net);
    }

    function _parameters() private view returns (ModuleNativeLaunchV1.LaunchParameters memory p) {
        p.name = "Module Coin";
        p.symbol = "MODULE";
        p.creatorSalt = bytes32("first");
        p.metadata = UERC20Metadata("Module test", "https://example.test", "https://example.test/token.png", "");
        p.creatorWallets = new address[](1);
        p.creatorWallets[0] = creator;
        p.creatorSharesBps = new uint16[](1);
        p.creatorSharesBps[0] = 10_000;
        p.modules = new T.Selection[](0);
        p.moduleFunding = new uint256[](0);
        p.initialBuyNative = MIN_BUY;
        p.minimumInitialTokenOut = 1;
        p.deadline = block.timestamp + 1;
    }

    function _launch(ModuleNativeLaunchV1.LaunchParameters memory p)
        private
        returns (ModuleNativeLaunchV1.LaunchRecord memory)
    {
        uint256 value = p.initialBuyNative;
        for (uint256 i; i < p.moduleFunding.length; ++i) {
            value += p.moduleFunding[i];
        }
        vm.prank(creator);
        return launcher.launch{ value: value }(p);
    }

    function _reward(uint32 everyN, bool includeInitial) private view returns (T.Selection memory) {
        return T.Selection(
            REWARD_PACKAGE,
            address(rewardFactory),
            address(rewardFactory).codehash,
            rewardFactory.moduleCodeHash(),
            400_000,
            abi.encode(
                everyN,
                uint128(MIN_BUY),
                uint128(0.001 ether),
                uint64(block.timestamp + 1 days),
                includeInitial,
                creator
            )
        );
    }

    function _twoModules() private view returns (T.Selection[] memory selected) {
        selected = new T.Selection[](2);
        uint256 rewardIndex = rewardFamily < capFamily ? 0 : 1;
        selected[rewardIndex] = _reward(1, false);
        selected[1 - rewardIndex] = T.Selection(
            CAP_PACKAGE,
            address(capFactory),
            address(capFactory).codehash,
            capFactory.moduleCodeHash(),
            200_000,
            abi.encode(uint128(0.002 ether), uint64(1 hours), true)
        );
    }
}
