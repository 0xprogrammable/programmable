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
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { PositionManager } from "@uniswap/v4-periphery/src/PositionManager.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { PositionInfo } from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import { Vm } from "forge-std/Vm.sol";

import { ClassicModulePositionPlannerV1 } from "../../src/classic-modules/ClassicModulePositionPlannerV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../../src/LockedPositionFeeForwarderFactoryV1.sol";
import { ClassicModuleHookV1 } from "../../src/classic-modules/ClassicModuleHookV1.sol";
import { ClassicModuleRegistryV1 } from "../../src/classic-modules/ClassicModuleRegistryV1.sol";
import { ClassicModuleLaunchV1 } from "../../src/classic-modules/ClassicModuleLaunchV1.sol";
import { ClassicModuleLaunchPolicyV1 } from "../../src/classic-modules/ClassicModuleLaunchPolicyV1.sol";
import { ClassicModuleTypes as T } from "../../src/classic-modules/ClassicModuleTypes.sol";
import { FallingCreatorFeeV1 } from "../../src/classic-modules/modules/FallingCreatorFeeV1.sol";
import { QuoteTradeLimitV1 } from "../../src/classic-modules/modules/QuoteTradeLimitV1.sol";
import { ClassicCreatorFeeSplitterV1 } from "../../src/classic-modules/ClassicCreatorFeeSplitterV1.sol";
import { ClassicModuleFeeLedgerV1 } from "../../src/classic-modules/ClassicModuleFeeLedgerV1.sol";
import { IProgrammableClassicLaunchV1 } from "../../src/interfaces/IProgrammableClassicLaunchV1.sol";

interface IClassicModuleLedgerForLaunchTest {
    function claimable(address beneficiary) external view returns (uint256);
    function claim(address beneficiary) external;
}

contract ClassicModuleLaunchV1Test is Deployers {
    using StateLibrary for IPoolManager;

    uint256 private constant MIN_BUY = 0.0003 ether;
    bytes32 private constant LAUNCH_EVENT = keccak256(
        "ClassicModuleLaunched(bytes32,address,address,bytes32,bytes32,address,address,uint256,uint256,uint256)"
    );
    uint160 private constant HOOK_FLAGS = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
        | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;

    PositionManager private positionManager;
    UERC20Factory private tokenFactory;
    ClassicModuleRegistryV1 private registry;
    ClassicModuleHookV1 private hook;
    ClassicModulePositionPlannerV1 private planner;
    ClassicModuleLaunchPolicyV1 private policy;
    LockedPositionFeeForwarderFactoryV1 private forwarderFactory;
    ClassicModuleLaunchV1 private launcher;
    IClassicModuleLedgerForLaunchTest private ledger;
    address private creator;
    address private treasury;
    address private noModuleRecipient;
    address private feeAuthor;
    address private limitAuthor;
    bytes32 private feeFamily;
    bytes32 private limitFamily;
    bytes32 private feeVersion;
    bytes32 private limitVersion;

    function setUp() public {
        vm.chainId(4663);
        vm.warp(1_800_000_000);
        deployFreshManagerAndRouters();
        positionManager = PositionManager(
            payable(deployCode(
                    "PositionManager.sol:PositionManager",
                    abi.encode(manager, address(0), uint256(0), address(0), address(0))
                ))
        );
        tokenFactory = new UERC20Factory();
        registry = new ClassicModuleRegistryV1(address(this));
        treasury = makeAddr("treasury");
        noModuleRecipient = makeAddr("no-module-recipient");
        address rewardAdmin = makeAddr("reward-admin");
        bytes memory args = abi.encode(manager, registry, treasury, rewardAdmin, noModuleRecipient);
        (address predicted, bytes32 salt) =
            HookMiner.find(address(this), HOOK_FLAGS, type(ClassicModuleHookV1).creationCode, args);
        hook = new ClassicModuleHookV1{ salt: salt }(manager, registry, treasury, rewardAdmin, noModuleRecipient);
        assertEq(address(hook), predicted);
        ledger = IClassicModuleLedgerForLaunchTest(address(hook.ledger()));
        planner = new ClassicModulePositionPlannerV1();
        policy = new ClassicModuleLaunchPolicyV1();
        forwarderFactory = new LockedPositionFeeForwarderFactoryV1(positionManager);
        launcher = new ClassicModuleLaunchV1(
            manager, positionManager, tokenFactory, hook, planner, policy, forwarderFactory, MIN_BUY
        );
        creator = makeAddr("creator");
        vm.deal(creator, 100 ether);
        feeAuthor = makeAddr("fee-author");
        limitAuthor = makeAddr("limit-author");
        vm.prank(feeAuthor);
        feeFamily = registry.registerFamily(bytes32("falling-fees"), feeAuthor);
        vm.prank(limitAuthor);
        limitFamily = registry.registerFamily(bytes32("trade-limit"), limitAuthor);
        feeVersion = registry.approveVersion(
            feeFamily, 1, address(new FallingCreatorFeeV1()), keccak256("review-fee"), T.FEE_POLICY
        );
        limitVersion = registry.approveVersion(
            limitFamily, 1, address(new QuoteTradeLimitV1()), keccak256("review-limit"), T.TRADE_LIMIT
        );
    }

    function test_permissionlessLaunchBindsRealEventRecordAndLockedPosition() public {
        ClassicModuleLaunchV1.LaunchParameters memory parameters = _parameters();
        uint256 nextId = positionManager.nextTokenId();
        (address predicted,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, creator, parameters.creatorSalt);
        vm.recordLogs();
        ClassicModuleLaunchV1.LaunchRecord memory result = _launch(parameters, MIN_BUY);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(result.token, predicted);
        assertEq(result.launchWallet, creator);
        assertEq(result.hook, address(hook));
        assertEq(result.positionTokenId, nextId);
        assertGt(result.positionTokenId, 0);
        assertEq(result.initialBuyNative, MIN_BUY);
        assertGt(result.initialBuyTokens, 0);
        assertEq(IERC20(result.token).balanceOf(creator), result.initialBuyTokens);
        assertEq(IERC20(result.token).totalSupply(), 1_000_000_000 ether);
        assertEq(IERC20Metadata(result.token).decimals(), 18);
        assertEq(IERC20(result.token).balanceOf(address(launcher)), 0);
        assertEq(IERC20(result.token).balanceOf(address(positionManager)), 0);
        assertEq(address(launcher).balance, 0);
        assertEq(keccak256(abi.encode(launcher.getLaunch(result.token))), keccak256(abi.encode(result)));
        assertEq(result.recipeHash, hook.recipeOf(result.poolId));
        assertTrue(result.launchId != bytes32(0));
        _assertLaunchEvent(logs, result);
        _assertLockedPosition(result);
        assertEq(ledger.claimable(treasury), MIN_BUY / 1000);
        assertEq(ledger.claimable(noModuleRecipient), MIN_BUY / 1000);
        assertEq(ledger.claimable(creator), 0);
    }

    function test_sameIdentityReaderBindsPlainAndModuleLaunchesAfterCatalogueAndCtoChanges() public {
        IProgrammableClassicLaunchV1 reader = IProgrammableClassicLaunchV1(address(launcher));
        assertEq(reader.launchIdentityVersion(), 1);
        ClassicModuleLaunchV1.LaunchParameters memory parameters = _parameters();
        ClassicModuleLaunchV1.LaunchRecord memory plain = _launch(parameters, MIN_BUY);
        parameters.creatorSalt = keccak256("second-identity-launch");
        parameters.buyCreatorFeeBps = 100;
        parameters.sellCreatorFeeBps = 100;
        parameters.modules = _modules();
        ClassicModuleLaunchV1.LaunchRecord memory modular = _launch(parameters, MIN_BUY);

        _assertIdentity(reader, plain);
        _assertIdentity(reader, modular);
        assertTrue(plain.token != modular.token);
        assertTrue(plain.recipeHash != modular.recipeHash);
        bytes32 identityBefore = keccak256(abi.encode(reader.getLaunchIdentity(modular.token)));

        registry.setVersionEnabled(feeVersion, false);
        address[] memory newWallets = new address[](1);
        newWallets[0] = makeAddr("next-cto-team");
        ClassicModuleFeeLedgerV1 feeLedger = hook.ledger();
        vm.prank(treasury);
        feeLedger.replaceCreatorWallets(modular.poolId, newWallets, 0, block.timestamp + 1);
        _swap(modular.token, true, -int256(MIN_BUY), MIN_BUY);
        assertEq(keccak256(abi.encode(reader.getLaunchIdentity(modular.token))), identityBefore);
        _assertIdentity(reader, modular);
    }

    function test_identityReaderReturnsAllZerosForUnknownOrRolledBackLaunch() public {
        IProgrammableClassicLaunchV1 reader = IProgrammableClassicLaunchV1(address(launcher));
        IProgrammableClassicLaunchV1.LaunchIdentity memory empty;
        assertEq(abi.encode(reader.getLaunchIdentity(makeAddr("not-launched"))), abi.encode(empty));
        ClassicModuleLaunchV1.LaunchParameters memory parameters = _parameters();
        parameters.minimumInitialTokenOut = type(uint256).max;
        (address predicted,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, creator, parameters.creatorSalt);
        _assertAtomicRevert(parameters, MIN_BUY, ClassicModuleLaunchV1.InitialBuyOutputTooLow.selector);
        assertEq(predicted.code.length, 0);
        assertEq(abi.encode(reader.getLaunchIdentity(predicted)), abi.encode(empty));
    }

    function _assertIdentity(IProgrammableClassicLaunchV1 reader, ClassicModuleLaunchV1.LaunchRecord memory expected)
        private
        view
    {
        IProgrammableClassicLaunchV1.LaunchIdentity memory identity = reader.getLaunchIdentity(expected.token);
        assertEq(
            abi.encode(identity),
            abi.encode(
                expected.launchId,
                expected.launchWallet,
                expected.token,
                address(manager),
                expected.poolId,
                expected.hook,
                expected.recipeHash
            )
        );
        assertEq(keccak256(abi.encode(launcher.getLaunch(expected.token))), keccak256(abi.encode(expected)));
    }

    function test_initialBuyBuySellAndPullClaimsUseRealPoolManager() public {
        ClassicModuleLaunchV1.LaunchParameters memory parameters = _parameters();
        parameters.buyCreatorFeeBps = 300;
        parameters.sellCreatorFeeBps = 500;
        parameters.modules = _modules();
        ClassicModuleLaunchV1.LaunchRecord memory result = _launch(parameters, 0.01 ether);
        uint256 initialTokens = IERC20(result.token).balanceOf(creator);
        uint256 initialNativeFees = ledger.claimable(treasury);
        _swap(result.token, true, -int256(0.02 ether), 0.02 ether);
        assertGt(IERC20(result.token).balanceOf(creator), initialTokens);
        uint256 nativeBeforeSell = creator.balance;
        _swap(result.token, false, -int256(initialTokens / 2), 0);
        assertGt(creator.balance, nativeBeforeSell);
        assertGt(ledger.claimable(treasury), initialNativeFees);
        assertGt(ledger.claimable(creator), 0);
        assertEq(ledger.claimable(feeAuthor), ledger.claimable(limitAuthor));
        assertEq(ledger.claimable(noModuleRecipient), 0);
        _claimAndCheck(treasury);
        _claimAndCheck(feeAuthor);
        _claimAndCheck(limitAuthor);
        _claimAndCheck(creator);
        _assertLockedPosition(result);
    }

    function test_tenCreatorWalletsKeepArbitraryBasisPointShares() public {
        ClassicModuleLaunchV1.LaunchParameters memory parameters = _parameters();
        parameters.buyCreatorFeeBps = 300;
        parameters.creatorWallets = new address[](10);
        parameters.creatorSharesBps = new uint16[](10);
        for (uint256 i; i < 10; ++i) {
            parameters.creatorWallets[i] = address(uint160(10_000 + i));
            parameters.creatorSharesBps[i] = i == 9 ? 1 : 1111;
        }
        _launch(parameters, 0.01 ether);
        uint256 creatorFee = 0.01 ether * 300 / 10_000;
        uint256 total;
        for (uint256 i; i < 10; ++i) {
            uint256 claim = ledger.claimable(parameters.creatorWallets[i]);
            assertEq(claim, creatorFee * parameters.creatorSharesBps[i] / 10_000);
            total += claim;
        }
        assertEq(total, creatorFee);
    }

    function test_realLaunchWithSplitterAndAdminCtoKeepsOldTeamEarnedFees() public {
        address first = address(0x1111);
        address second = address(0x2222);
        ClassicCreatorFeeSplitterV1 splitter =
            new ClassicCreatorFeeSplitterV1(abi.encodePacked(first, uint16(2000), second, uint16(8000)));
        ClassicModuleLaunchV1.LaunchParameters memory parameters = _parameters();
        parameters.buyCreatorFeeBps = 300;
        parameters.sellCreatorFeeBps = 500;
        parameters.creatorWallets[0] = address(splitter);
        ClassicModuleLaunchV1.LaunchRecord memory result = _launch(parameters, 0.01 ether);
        uint256 oldTeamFees = ledger.claimable(address(splitter));
        assertEq(oldTeamFees, 0.01 ether * 300 / 10_000);
        ClassicModuleFeeLedgerV1 concrete = hook.ledger();
        address[] memory replacement = new address[](1);
        replacement[0] = address(0xC700);
        vm.prank(concrete.rewardAdmin());
        concrete.replaceCreatorWallets(result.poolId, replacement, 0, block.timestamp + 1 hours);
        _swap(result.token, true, -int256(0.01 ether), 0.01 ether);
        assertEq(ledger.claimable(address(splitter)), oldTeamFees);
        assertEq(ledger.claimable(replacement[0]), oldTeamFees);
        ledger.claim(address(splitter));
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = splitter.leafHash(1, second, 8000);
        assertEq(splitter.claim(0, first, 2000, proof), oldTeamFees * 2000 / 10_000);
        _claimAndCheck(replacement[0]);
        _assertLockedPosition(result);
    }

    function test_catalogueDisableStopsNewLaunchButLeavesExistingRecipeTrading() public {
        ClassicModuleLaunchV1.LaunchParameters memory parameters = _parameters();
        parameters.buyCreatorFeeBps = 300;
        parameters.sellCreatorFeeBps = 500;
        parameters.modules = _modules();
        ClassicModuleLaunchV1.LaunchRecord memory result = _launch(parameters, MIN_BUY);
        registry.setVersionEnabled(feeVersion, false);
        vm.warp(block.timestamp + 1 days);
        T.Effect memory effect = hook.quotePolicy(result.poolId);
        assertEq(effect.buyCreatorFeeBps, 0);
        assertEq(effect.sellCreatorFeeBps, 0);
        _swap(result.token, true, -int256(MIN_BUY), MIN_BUY);
        assertEq(hook.recipeOf(result.poolId), result.recipeHash);
        parameters.creatorSalt = bytes32("new-disabled-launch");
        parameters.deadline = block.timestamp + 600;
        _assertAtomicRevert(parameters, MIN_BUY, ClassicModuleHookV1.UnavailableModule.selector);
    }

    function test_missingMinimumOutputRejectsBeforeAnyCreation() public {
        ClassicModuleLaunchV1.LaunchParameters memory parameters = _parameters();
        parameters.minimumInitialTokenOut = 0;
        _assertAtomicRevert(parameters, MIN_BUY, ClassicModuleLaunchV1.MissingMinimumInitialTokenOut.selector);
    }

    function test_expiredDeadlineRejectsBeforeAnyCreation() public {
        ClassicModuleLaunchV1.LaunchParameters memory parameters = _parameters();
        parameters.deadline = block.timestamp - 1;
        _assertAtomicRevert(parameters, MIN_BUY, ClassicModuleLaunchV1.DeadlineExpired.selector);
    }

    function test_insufficientInitialNativeRejectsBeforeAnyCreation() public {
        _assertAtomicRevert(_parameters(), MIN_BUY - 1, ClassicModuleLaunchV1.InitialBuyBelowMinimum.selector);
    }

    function test_unsatisfiedMinimumOutputRollsBackTokenPoolPositionAndFees() public {
        ClassicModuleLaunchV1.LaunchParameters memory parameters = _parameters();
        parameters.minimumInitialTokenOut = launcher.TOKEN_SUPPLY();
        _assertAtomicRevert(parameters, MIN_BUY, ClassicModuleLaunchV1.InitialBuyOutputTooLow.selector);
    }

    function test_moduleLimitFailureRollsBackCompleteInitialBuy() public {
        ClassicModuleLaunchV1.LaunchParameters memory parameters = _parameters();
        parameters.modules = new T.ModuleSelection[](1);
        parameters.modules[0] = T.ModuleSelection(limitVersion, abi.encode(MIN_BUY - 1, uint256(0)));
        // PoolManager wraps hook failures; all effects still roll back atomically.
        _assertAtomicRevert(parameters, MIN_BUY, bytes4(0));
    }

    function test_eightNativeLaunchAndLaterBuySellPassBeyondOldCurveEndpoint() public {
        ClassicModuleLaunchV1.LaunchRecord memory result = _launch(_parameters(), 8 ether);
        assertEq(result.initialBuyNative, 8 ether);
        uint256 initialTokens = IERC20(result.token).balanceOf(creator);
        assertGt(initialTokens, 0);
        assertLt(initialTokens, launcher.TOKEN_SUPPLY());
        _swap(result.token, true, -int256(1 ether), 1 ether);
        assertGt(IERC20(result.token).balanceOf(creator), initialTokens);
        uint256 nativeBeforeSell = creator.balance;
        _swap(result.token, false, -int256(initialTokens / 4), 0);
        assertGt(creator.balance, nativeBeforeSell);
        _assertLockedPosition(result);
    }

    function test_unrepresentableNativeSwapAmountRollsBackAtomically() public {
        // The engine retains V4's signed-int128 per-swap delta boundary. This is an amount-representation
        // boundary, not a claim that a small aggregate native amount exhausts the new price range.
        uint256 amount = uint256(uint128(type(int128).max)) + 1;
        vm.deal(creator, amount);
        _assertAtomicRevert(_parameters(), amount, bytes4(0));
    }

    function test_duplicateFamilyCannotMultiplyAuthorShares() public {
        ClassicModuleLaunchV1.LaunchParameters memory parameters = _parameters();
        parameters.modules = new T.ModuleSelection[](2);
        parameters.modules[0] = T.ModuleSelection(limitVersion, abi.encode(uint256(1 ether), uint256(1 ether)));
        parameters.modules[1] = parameters.modules[0];
        _assertAtomicRevert(parameters, MIN_BUY, ClassicModuleHookV1.InvalidModuleOrder.selector);
    }

    function test_creatorFeeMustUseWholePercentSteps() public {
        ClassicModuleLaunchV1.LaunchParameters memory parameters = _parameters();
        parameters.buyCreatorFeeBps = 25;
        _assertAtomicRevert(parameters, MIN_BUY, ClassicModuleLaunchPolicyV1.InvalidCreatorFee.selector);
        parameters.buyCreatorFeeBps = 1100;
        _assertAtomicRevert(parameters, MIN_BUY, ClassicModuleLaunchPolicyV1.InvalidCreatorFee.selector);
    }

    function test_invalidCreatorAllocationsCannotReachPoolCreation() public {
        ClassicModuleLaunchV1.LaunchParameters memory parameters = _parameters();
        parameters.creatorWallets = new address[](11);
        parameters.creatorSharesBps = new uint16[](11);
        _assertAtomicRevert(parameters, MIN_BUY, ClassicModuleLaunchPolicyV1.InvalidBeneficiaryCount.selector);
        parameters = _parameters();
        parameters.creatorSharesBps[0] = 9999;
        _assertAtomicRevert(parameters, MIN_BUY, ClassicModuleLaunchPolicyV1.InvalidRewardShareTotal.selector);
    }

    function test_forcedNativeBalanceDoesNotBlockOrSubsidizeLaunch() public {
        vm.deal(address(launcher), 2 ether);
        ClassicModuleLaunchV1.LaunchRecord memory result = _launch(_parameters(), MIN_BUY);
        assertEq(address(launcher).balance, 2 ether);
        assertEq(result.initialBuyNative, MIN_BUY);
        assertEq(ledger.claimable(treasury), MIN_BUY / 1000);
    }

    function test_sameSaltIsBoundToWalletAndChain() public {
        ClassicModuleLaunchV1.LaunchParameters memory parameters = _parameters();
        (address original, bytes32 graffiti) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, creator, parameters.creatorSalt);
        address otherCreator = makeAddr("other-creator");
        (address otherWallet,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, otherCreator, parameters.creatorSalt);
        assertNotEq(original, otherWallet);
        vm.chainId(1);
        (address otherChain,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, creator, parameters.creatorSalt);
        assertNotEq(original, otherChain);
        vm.chainId(4663);
        assertEq(
            graffiti,
            keccak256(
                abi.encode(
                    "programmable.classic-module-token.v1",
                    block.chainid,
                    address(launcher),
                    creator,
                    parameters.creatorSalt
                )
            )
        );
        ClassicModuleLaunchV1.LaunchRecord memory result = _launch(parameters, MIN_BUY);
        assertEq(result.token, original);
        _assertDuplicateLaunchRevert(parameters, result.token);
    }

    function test_predeployedCorrectForwarderCannotGriefLaunch() public {
        ClassicModuleLaunchV1.LaunchParameters memory parameters = _parameters();
        (address token,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, creator, parameters.creatorSalt);
        bytes32 salt =
            keccak256(abi.encode("programmable.classic-module-position.v1", block.chainid, address(launcher), token));
        address forwarder = address(forwarderFactory.deploy(salt, creator));
        ClassicModuleLaunchV1.LaunchRecord memory result = _launch(parameters, MIN_BUY);
        assertEq(result.positionRecipient, forwarder);
        _assertLockedPosition(result);
    }

    function test_callbackNeedsPoolManagerAndActiveExactPayload() public {
        vm.expectRevert(
            abi.encodeWithSelector(ClassicModuleLaunchV1.UnauthorizedUnlockCallback.selector, address(this))
        );
        launcher.unlockCallback("");
        vm.prank(address(manager));
        vm.expectRevert(ClassicModuleLaunchV1.InvalidInitialBuyCallback.selector);
        launcher.unlockCallback("");
    }

    function test_zeroDeploymentMinimumIsRejected() public {
        vm.expectRevert(ClassicModuleLaunchV1.InvalidMinimumInitialBuy.selector);
        new ClassicModuleLaunchV1(manager, positionManager, tokenFactory, hook, planner, policy, forwarderFactory, 0);
    }

    function _parameters() private view returns (ClassicModuleLaunchV1.LaunchParameters memory p) {
        p.name = "Classic Module Test";
        p.symbol = "CMT";
        p.creatorSalt = bytes32("one-launch");
        p.metadata = UERC20Metadata("A local module-engine fixture", "https://example.com", "ipfs://example", "");
        p.creatorWallets = new address[](1);
        p.creatorWallets[0] = creator;
        p.creatorSharesBps = new uint16[](1);
        p.creatorSharesBps[0] = 10_000;
        p.modules = new T.ModuleSelection[](0);
        p.minimumInitialTokenOut = 1;
        p.deadline = block.timestamp + 600;
    }

    function _modules() private view returns (T.ModuleSelection[] memory selections) {
        selections = new T.ModuleSelection[](2);
        T.ModuleSelection memory fee =
            T.ModuleSelection(feeVersion, abi.encode(uint256(0), uint256(0), uint256(1 days)));
        T.ModuleSelection memory limit =
            T.ModuleSelection(limitVersion, abi.encode(uint256(0.2 ether), uint256(0.2 ether)));
        selections[0] = feeFamily < limitFamily ? fee : limit;
        selections[1] = feeFamily < limitFamily ? limit : fee;
    }

    function _launch(ClassicModuleLaunchV1.LaunchParameters memory p, uint256 amount)
        private
        returns (ClassicModuleLaunchV1.LaunchRecord memory)
    {
        vm.prank(creator);
        return launcher.launch{ value: amount }(p);
    }

    function _swap(address token, bool isBuy, int256 amount, uint256 nativeValue) private returns (BalanceDelta) {
        PoolKey memory pool = launcher.poolKey(token);
        vm.startPrank(creator);
        IERC20(token).approve(address(swapRouter), type(uint256).max);
        BalanceDelta delta = swapRouter.swap{ value: nativeValue }(
            pool,
            SwapParams(isBuy, amount, isBuy ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
        vm.stopPrank();
        return delta;
    }

    function _claimAndCheck(address beneficiary) private {
        uint256 amount = ledger.claimable(beneficiary);
        uint256 before = beneficiary.balance;
        ledger.claim(beneficiary);
        assertEq(beneficiary.balance - before, amount);
        assertEq(ledger.claimable(beneficiary), 0);
    }

    function _assertLockedPosition(ClassicModuleLaunchV1.LaunchRecord memory result) private {
        assertEq(IERC721(address(positionManager)).ownerOf(result.positionTokenId), result.positionRecipient);
        assertEq(IERC721(address(positionManager)).getApproved(result.positionTokenId), address(0));
        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(result.positionRecipient));
        assertEq(forwarder.operator(), address(0));
        assertEq(forwarder.timelockBlockNumber(), type(uint256).max);
        assertEq(forwarder.feeRecipient(), creator);
        (PoolKey memory pool, PositionInfo info) = positionManager.getPoolAndPositionInfo(result.positionTokenId);
        assertEq(PoolId.unwrap(pool.toId()), result.poolId);
        assertEq(info.tickLower(), planner.LIQUIDITY_TICK_LOWER());
        assertEq(info.tickUpper(), 204_200);
        uint128 liquidity = positionManager.getPositionLiquidity(result.positionTokenId);
        assertGt(liquidity, 0);
        vm.prank(creator);
        vm.expectRevert();
        IERC721(address(positionManager)).transferFrom(result.positionRecipient, creator, result.positionTokenId);
        vm.expectRevert();
        forwarder.approveOperator();
        forwarder.collectFees(result.positionTokenId);
        assertEq(positionManager.getPositionLiquidity(result.positionTokenId), liquidity);
        assertEq(IERC721(address(positionManager)).ownerOf(result.positionTokenId), result.positionRecipient);
    }

    function _assertAtomicRevert(ClassicModuleLaunchV1.LaunchParameters memory p, uint256 amount, bytes4 selector)
        private
    {
        (address predicted,) = launcher.predictTokenAddress(p.name, p.symbol, creator, p.creatorSalt);
        uint256 nextId = positionManager.nextTokenId();
        uint256 creatorNativeBefore = creator.balance;
        uint256 treasuryBefore = ledger.claimable(treasury);
        vm.prank(creator);
        (bool ok, bytes memory reason) = address(launcher).call{ value: amount }(abi.encodeCall(launcher.launch, (p)));
        assertFalse(ok);
        if (selector != bytes4(0)) assertEq(bytes4(reason), selector);
        assertEq(predicted.code.length, 0);
        assertEq(positionManager.nextTokenId(), nextId);
        assertEq(creator.balance, creatorNativeBefore);
        assertEq(ledger.claimable(treasury), treasuryBefore);
        assertEq(launcher.getLaunch(predicted).launchId, bytes32(0));
        (uint160 sqrtPrice,,,) = manager.getSlot0(launcher.poolKey(predicted).toId());
        assertEq(sqrtPrice, 0);
    }

    function _assertDuplicateLaunchRevert(ClassicModuleLaunchV1.LaunchParameters memory p, address token) private {
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(ClassicModuleLaunchV1.TokenAlreadyExists.selector, token));
        launcher.launch{ value: MIN_BUY }(p);
    }

    function _assertLaunchEvent(Vm.Log[] memory logs, ClassicModuleLaunchV1.LaunchRecord memory result) private view {
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(launcher) || logs[i].topics[0] != LAUNCH_EVENT) continue;
            assertEq(logs[i].topics.length, 4);
            assertEq(logs[i].topics[1], result.launchId);
            assertEq(logs[i].topics[2], bytes32(uint256(uint160(result.launchWallet))));
            assertEq(logs[i].topics[3], bytes32(uint256(uint160(result.token))));
            assertEq(
                logs[i].data,
                abi.encode(
                    result.poolId,
                    result.recipeHash,
                    result.hook,
                    result.positionRecipient,
                    result.positionTokenId,
                    result.initialBuyNative,
                    result.initialBuyTokens
                )
            );
            found = true;
        }
        assertTrue(found);
    }
}
