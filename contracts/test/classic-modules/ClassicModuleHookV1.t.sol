// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";
import { Vm } from "forge-std/Vm.sol";
import { ClassicModuleTypes as T } from "../../src/classic-modules/ClassicModuleTypes.sol";
import { ClassicModuleHookV1 } from "../../src/classic-modules/ClassicModuleHookV1.sol";
import { ClassicModuleRegistryV1 } from "../../src/classic-modules/ClassicModuleRegistryV1.sol";
import { ClassicModuleFeeLedgerV1 } from "../../src/classic-modules/ClassicModuleFeeLedgerV1.sol";
import { ClassicModuleCalls } from "../../src/classic-modules/ClassicModuleCalls.sol";
import { FallingCreatorFeeV1 } from "../../src/classic-modules/modules/FallingCreatorFeeV1.sol";
import { QuoteTradeLimitV1 } from "../../src/classic-modules/modules/QuoteTradeLimitV1.sol";

contract ModuleFixtureToken is MockERC20 {
    address public immutable creator;

    constructor() MockERC20("Module fixture", "MOD", 18) {
        creator = msg.sender;
    }
}

contract FaultyEffectModule {
    function moduleKind() external pure returns (uint8) {
        return T.FEE_POLICY;
    }

    function validateConfig(bytes calldata, uint16, uint16) external pure returns (bool) {
        return true;
    }

    function evaluate(T.Context calldata context, bytes calldata) external pure returns (T.Effect memory effect) {
        effect.buyCreatorFeeBps = context.elapsed == 0 ? context.baseBuyFeeBps : 10_000;
    }
}

contract OversizedModule {
    function moduleKind() external pure returns (uint8) {
        return T.TRADE_LIMIT;
    }

    function validateConfig(bytes calldata, uint16, uint16) external pure returns (bool) {
        return true;
    }

    function evaluate(T.Context calldata, bytes calldata) external pure returns (T.Effect memory) {
        assembly ("memory-safe") { return(0, 4096) }
    }
}

contract ClassicModuleHookV1Test is Deployers {
    ClassicModuleRegistryV1 internal registry;
    ClassicModuleHookV1 internal hook;
    ClassicModuleFeeLedgerV1 internal ledger;
    ModuleFixtureToken internal token;
    bytes32 internal poolId;
    address internal treasury;
    address internal creator;
    address internal authorA;
    address internal authorB;
    bytes32 internal feeVersion;
    bytes32 internal limitVersion;
    bytes32 internal feeFamily;
    bytes32 internal limitFamily;
    PoolSwapTest.TestSettings internal settings = PoolSwapTest.TestSettings(false, false);

    function setUp() public {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 1000 ether);
        treasury = makeAddr("treasury");
        creator = makeAddr("creator");
        authorA = makeAddr("authorA");
        authorB = makeAddr("authorB");
        registry = new ClassicModuleRegistryV1(address(this));
        vm.prank(authorA);
        feeFamily = registry.registerFamily(bytes32("fee"), authorA);
        vm.prank(authorB);
        limitFamily = registry.registerFamily(bytes32("limit"), authorB);
        feeVersion =
            registry.approveVersion(feeFamily, 1, address(new FallingCreatorFeeV1()), keccak256("fee-review"), 1);
        limitVersion =
            registry.approveVersion(limitFamily, 1, address(new QuoteTradeLimitV1()), keccak256("limit-review"), 2);
        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
                | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        bytes memory args = abi.encode(manager, registry, treasury, makeAddr("admin"), treasury);
        (, bytes32 salt) = HookMiner.find(address(this), flags, type(ClassicModuleHookV1).creationCode, args);
        hook = new ClassicModuleHookV1{ salt: salt }(manager, registry, treasury, makeAddr("admin"), treasury);
        ledger = hook.ledger();
        token = new ModuleFixtureToken();
        token.mint(address(this), 1_000_000 ether);
        token.approve(address(modifyLiquidityRouter), type(uint256).max);
        token.approve(address(swapRouter), type(uint256).max);
        key = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(token)), 0, 200, hook);
        poolId = PoolId.unwrap(key.toId());
        hook.registerPool(key, _registration(_selections()));
        manager.initialize(key, SQRT_PRICE_1_1);
        modifyLiquidityRouter.modifyLiquidity{ value: 20 ether }(
            key, ModifyLiquidityParams(-200, 200, 1000 ether, 0), ZERO_BYTES
        );
    }

    function test_allFourSwapQuadrantsAccrueBackedFees() public {
        _assertSwapFees(true, -int256(0.1 ether), 0.1 ether);
        _assertSwapFees(false, -int256(0.05 ether), 0);
        _assertSwapFees(true, int256(0.025 ether), 0.1 ether);
        _assertSwapFees(false, int256(0.01 ether), 0);
        assertGt(ledger.claimable(treasury), 0);
        assertEq(ledger.claimable(authorA), ledger.claimable(authorB));
        assertGt(ledger.claimable(creator), 0);
        assertGe(manager.balanceOf(address(ledger), 0), ledger.totalCredited() - ledger.totalClaimed());
        uint256 amount = ledger.claimable(authorA);
        ledger.claim(authorA);
        assertEq(authorA.balance, amount);
    }

    function test_eventsUseActualRouterSender() public {
        vm.recordLogs();
        _swap(true, -int256(0.1 ether), 0.1 ether);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256("HookSwap(bytes32,address,int128,int128,uint24)");
        uint256 matches;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(hook) && logs[i].topics[0] == topic) {
                assertEq(address(uint160(uint256(logs[i].topics[2]))), address(swapRouter));
                ++matches;
            }
        }
        assertEq(matches, 1);
    }

    function test_disclosureReadsSeparateMutableUniswapProtocolFees() public {
        vm.warp(block.timestamp + 60);
        manager.setProtocolFeeController(address(this));
        manager.setProtocolFee(key, uint24(1000 | (500 << 12)));
        (uint16 creatorBps, uint16 platformBps, uint16 protocolPips, uint24 lpPips) = hook.feeComponents(poolId, true);
        assertEq(creatorBps, 0);
        assertEq(platformBps, 20);
        assertEq(protocolPips, 1000);
        assertEq(lpPips, 0);
        (,, protocolPips,) = hook.feeComponents(poolId, false);
        assertEq(protocolPips, 500);
        _swap(true, -int256(0.1 ether), 0.1 ether);
        assertEq(ledger.totalFeesReceived(), 0.0002 ether);
        assertEq(manager.protocolFeesAccrued(Currency.wrap(address(0))), 0.000_099_8 ether);
    }

    function test_disabledCatalogueVersionLeavesExistingRecipeAndFeesUnchanged() public {
        bytes32 recipe = hook.recipeOf(poolId);
        registry.setVersionEnabled(feeVersion, false);
        _swap(true, -int256(0.1 ether), 0.1 ether);
        assertEq(hook.recipeOf(poolId), recipe);
        T.ModuleSelection[] memory selections = _selections();
        vm.expectRevert(abi.encodeWithSelector(ClassicModuleHookV1.UnavailableModule.selector, feeVersion));
        hook.previewRecipe(100, 200, selections);
    }

    function test_fallingPolicyEndsAtZeroCreatorAndKeepsProtocolFee() public {
        vm.warp(block.timestamp + 60);
        T.Effect memory policy = hook.quotePolicy(poolId);
        assertEq(policy.buyCreatorFeeBps, 0);
        assertEq(policy.sellCreatorFeeBps, 0);
        _swap(true, -int256(0.1 ether), 0.1 ether);
        assertEq(ledger.claimable(creator), 0);
        assertEq(ledger.claimable(treasury), 0.0001 ether);
        assertEq(ledger.claimable(authorA), 0.000_05 ether);
        assertEq(ledger.claimable(authorB), 0.000_05 ether);
    }

    function test_walletRotationOnlyAffectsLaterAccrual() public {
        _swap(true, -int256(0.1 ether), 0.1 ether);
        uint256 prior = ledger.claimable(authorA);
        address next = makeAddr("nextAuthor");
        vm.prank(authorA);
        registry.changeAuthorWallet(feeFamily, next);
        _swap(true, -int256(0.1 ether), 0.1 ether);
        assertEq(ledger.claimable(authorA), prior);
        assertEq(ledger.claimable(next), prior);
    }

    function test_duplicateFamilyAndExclusiveFeePoliciesFail() public {
        T.ModuleSelection[] memory selected = new T.ModuleSelection[](2);
        selected[0] = T.ModuleSelection(feeVersion, abi.encode(uint256(0), uint256(0), uint256(60)));
        selected[1] = selected[0];
        vm.expectRevert(abi.encodeWithSelector(ClassicModuleHookV1.InvalidModuleOrder.selector, feeFamily));
        hook.previewRecipe(100, 200, selected);
        bytes32 family = registry.registerFamily(bytes32("second-fee"), address(this));
        bytes32 version = registry.approveVersion(family, 1, address(new FallingCreatorFeeV1()), keccak256("r"), 1);
        selected[1] = T.ModuleSelection(version, abi.encode(uint256(0), uint256(0), uint256(60)));
        if (family < feeFamily) {
            T.ModuleSelection memory swap = selected[0];
            selected[0] = selected[1];
            selected[1] = swap;
        }
        vm.expectRevert(ClassicModuleHookV1.ExclusiveEffectConflict.selector);
        hook.previewRecipe(100, 200, selected);
    }

    function test_hardModuleCountAndConfigurationLimits() public {
        T.ModuleSelection[] memory selected = new T.ModuleSelection[](9);
        vm.expectRevert(ClassicModuleHookV1.InvalidModuleCount.selector);
        hook.previewRecipe(0, 0, selected);
        selected = new T.ModuleSelection[](1);
        selected[0] = T.ModuleSelection(limitVersion, new bytes(257));
        vm.expectRevert(abi.encodeWithSelector(ClassicModuleHookV1.InvalidModuleConfig.selector, limitVersion));
        hook.previewRecipe(0, 0, selected);
    }

    function test_tradeLimitFailureRollsBackFeesAndBalances() public {
        uint256 feesBefore = ledger.totalFeesReceived();
        uint256 tokenBefore = token.balanceOf(address(this));
        vm.expectRevert();
        _swap(true, -int256(2 ether), 2 ether);
        assertEq(ledger.totalFeesReceived(), feesBefore);
        assertEq(token.balanceOf(address(this)), tokenBefore);
        _swap(true, -int256(0.1 ether), 0.1 ether);
    }

    function test_changedModuleCodeCannotRun() public {
        ClassicModuleRegistryV1.Version memory version = registry.getVersion(feeVersion);
        vm.etch(version.implementation, hex"00");
        vm.expectRevert(abi.encodeWithSelector(ClassicModuleHookV1.ModuleCodeChanged.selector, feeVersion));
        hook.quotePolicy(poolId);
    }

    function test_badEffectCannotRaiseCreatorFeeOrTouchProtocolShare() public {
        bytes32 family = registry.registerFamily(bytes32("faulty"), address(this));
        bytes32 version = registry.approveVersion(family, 1, address(new FaultyEffectModule()), keccak256("r"), 1);
        (PoolKey memory another, bytes32 anotherId) = _registerAnother(version);
        manager.initialize(another, SQRT_PRICE_1_1);
        vm.warp(block.timestamp + 1);
        vm.expectRevert(abi.encodeWithSelector(ClassicModuleHookV1.InvalidModuleEffect.selector, version));
        hook.quotePolicy(anotherId);
    }

    function test_oversizedModuleResultIsRejectedAtRegistration() public {
        bytes32 family = registry.registerFamily(bytes32("oversized"), address(this));
        address implementation = address(new OversizedModule());
        bytes32 version = registry.approveVersion(family, 1, implementation, keccak256("r"), 2);
        ModuleFixtureToken another = new ModuleFixtureToken();
        PoolKey memory anotherKey = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(another)), 0, 200, hook);
        T.ModuleSelection[] memory modules = new T.ModuleSelection[](1);
        modules[0] = T.ModuleSelection(version, "");
        vm.expectRevert(abi.encodeWithSelector(ClassicModuleCalls.ModuleCallFailed.selector, implementation));
        hook.registerPool(anotherKey, _registration(modules));
    }

    function test_callbacksRequireActualPoolManager() public {
        SwapParams memory params = SwapParams(true, -int256(0.1 ether), MIN_PRICE_LIMIT);
        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.beforeSwap(address(this), key, params, "");
        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.afterSwap(address(this), key, params, BalanceDelta.wrap(0), "");
    }

    function testFuzz_feeConservation(uint128 amount, uint16 creatorBps) public view {
        creatorBps = uint16(bound(creatorBps, 0, 1000));
        (uint256 creatorFee, uint256 protocolFee) = hook.quoteGrossFees(amount, creatorBps);
        assertEq(creatorFee + protocolFee, uint256(amount) * (creatorBps + 20) / 10_000);
        if (creatorBps == 0) assertEq(creatorFee, 0);
        (creatorFee, protocolFee) = hook.quoteExactOutputFees(amount, creatorBps);
        uint256 gross = uint256(amount) + creatorFee + protocolFee;
        assertGe(gross * (10_000 - creatorBps - 20), uint256(amount) * 10_000);
        if (amount > 0) assertLt((gross - 1) * (10_000 - creatorBps - 20), uint256(amount) * 10_000);
    }

    function _registerAnother(bytes32 version) private returns (PoolKey memory anotherKey, bytes32 anotherId) {
        ModuleFixtureToken another = new ModuleFixtureToken();
        anotherKey = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(another)), 0, 200, hook);
        anotherId = PoolId.unwrap(anotherKey.toId());
        T.ModuleSelection[] memory modules = new T.ModuleSelection[](1);
        modules[0] = T.ModuleSelection(version, "");
        hook.registerPool(anotherKey, _registration(modules));
    }

    function _registration(T.ModuleSelection[] memory selected) private view returns (T.PoolRegistration memory r) {
        r.launchWallet = creator;
        r.buyCreatorFeeBps = 100;
        r.sellCreatorFeeBps = 200;
        r.creatorWallets = new address[](1);
        r.creatorWallets[0] = creator;
        r.creatorSharesBps = new uint16[](1);
        r.creatorSharesBps[0] = 10_000;
        r.modules = selected;
    }

    function _selections() private view returns (T.ModuleSelection[] memory selected) {
        selected = new T.ModuleSelection[](2);
        selected[0] = T.ModuleSelection(feeVersion, abi.encode(uint256(0), uint256(0), uint256(60)));
        selected[1] = T.ModuleSelection(limitVersion, abi.encode(uint256(1 ether), uint256(1 ether)));
        if (limitFamily < feeFamily) {
            T.ModuleSelection memory swap = selected[0];
            selected[0] = selected[1];
            selected[1] = swap;
        }
    }

    function _swap(bool buy, int256 amount, uint256 value) private returns (BalanceDelta) {
        return swapRouter.swap{ value: value }(
            key, SwapParams(buy, amount, buy ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT), settings, ZERO_BYTES
        );
    }

    function _assertSwapFees(bool buy, int256 specified, uint256 value) private {
        (uint256 priorPlatform, uint256 priorCreator,,,) = ledger.poolAccounting(poolId);
        uint256 balanceBefore = address(this).balance;
        uint256 managerBefore = address(manager).balance;
        BalanceDelta delta = _swap(buy, specified, value);
        (uint256 platform, uint256 creatorFee,,,) = ledger.poolAccounting(poolId);
        platform -= priorPlatform;
        creatorFee -= priorCreator;
        uint256 actualNative = buy ? uint256(-int256(delta.amount0())) : uint256(int256(delta.amount0()));
        uint256 gross = buy ? actualNative : actualNative + platform + creatorFee;
        uint256 totalBps = buy ? 120 : 220;
        assertEq(platform, gross * 20 / 10_000);
        if (specified < 0) {
            assertEq(platform + creatorFee, gross * totalBps / 10_000);
        } else {
            uint256 net = gross - platform - creatorFee;
            assertEq(gross, (net * 10_000 + (10_000 - totalBps) - 1) / (10_000 - totalBps));
        }
        if (buy) {
            assertEq(balanceBefore - address(this).balance, actualNative);
            assertEq(address(manager).balance - managerBefore, actualNative);
        } else {
            assertEq(address(this).balance - balanceBefore, actualNative);
            assertEq(managerBefore - address(manager).balance, actualNative);
        }
        if (buy == (specified < 0)) {
            assertEq(actualNative, specified < 0 ? uint256(-specified) : uint256(specified));
        } else {
            uint256 tokens = buy ? uint256(int256(delta.amount1())) : uint256(-int256(delta.amount1()));
            assertEq(tokens, specified < 0 ? uint256(-specified) : uint256(specified));
        }
    }
}
