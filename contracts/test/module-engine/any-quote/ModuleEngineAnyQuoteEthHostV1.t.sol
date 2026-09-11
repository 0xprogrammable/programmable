// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TransientStateLibrary } from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolModifyLiquidityTest } from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { ClassicModuleLaunchPolicyV1 } from "../../../src/classic-modules/ClassicModuleLaunchPolicyV1.sol";
import { ModuleNativeRegistryV1 } from "../../../src/module-mode/engine/ModuleNativeRegistryV1.sol";
import { ModuleEngineTypesV1 as T } from "../../../src/module-engine/ModuleEngineTypesV1.sol";
import {
    ModuleEngineAnyQuoteEthHostV1 as Host
} from "../../../src/module-engine/any-quote/ModuleEngineAnyQuoteEthHostV1.sol";
import {
    AnyQuoteNativeRouteGuardV1 as Guard
} from "../../../src/module-engine/any-quote/AnyQuoteNativeRouteGuardV1.sol";
import { AnyQuoteEthSharedHookV1 } from "../../../src/module-engine/any-quote/AnyQuoteEthSharedHookV1.sol";
import { IAnyQuoteEthSharedHookV1 } from "../../../src/module-engine/any-quote/IAnyQuoteEthSharedHookV1.sol";
import { AnyQuoteLPModuleV1 } from "../../../src/module-engine/any-quote/AnyQuoteLPModuleV1.sol";
import { AnyQuoteEthLedgerV1 } from "../../../src/module-engine/any-quote/AnyQuoteEthLedgerV1.sol";
import { AnyQuoteTypesV1 as A } from "../../../src/module-engine/any-quote/AnyQuoteTypesV1.sol";
import { AnyQuoteNativeFeeRouteV1 as R } from "../../../src/module-engine/any-quote/AnyQuoteNativeFeeRouteV1.sol";
import { ModuleEngineAnyQuoteHostRouterFixture } from "./ModuleEngineAnyQuoteHostRouterFixture.sol";

/// @dev Plain local ERC20, deliberately without wrap/unwrap. Native conversion must use the real V4 market.
contract AnyQuoteEthHostQuoteFixture is ERC20 {
    constructor() ERC20("Any Quote ETH host fixture", "QUOTE") { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract ModuleEngineAnyQuoteEthHostV1Test is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;

    address private constant ALICE = address(0xA11CE);
    address private constant AUTHOR = address(0xA077);
    address private constant MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address private constant ROUTER = 0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99;
    address private constant QUOTE = address(0x9009);
    bytes32 private constant REVISION = keccak256("reviewed native fee host integration");
    // Compiled from the unchanged LP source at 5ef62135, Solidity 0.8.26, optimizer 1000, Cancun.
    bytes32 private constant LP_CREATION_HASH = 0xce84d052ba7574b525d141cfb31ea40513df6e292d24179582059998150cedc3;
    bytes32 private constant LP_RUNTIME_TEMPLATE_HASH =
        0x45f1a071a9b22b2f2d3de84869e9e71c1a2844158ca4a3ff81c268c68792e3c6;

    Host private host;
    Guard private guard;
    AnyQuoteEthSharedHookV1 private hook;
    AnyQuoteEthHostQuoteFixture private quote;
    ModuleNativeRegistryV1 private registry;
    UERC20Factory private factory;
    ClassicModuleLaunchPolicyV1 private policy;
    IPoolManager private manager;
    PoolKey private market;
    bytes32 private family;
    uint32[] private runtimeOffsets;
    uint32[] private constructorOffsets;

    struct Location {
        uint256 length;
        uint256 start;
    }

    // The pinned Universal Router 2.1.1 exact-input tuple includes minHopPriceX36.
    struct RouterExactInputSingle {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        uint256 minHopPriceX36;
        bytes hookData;
    }

    receive() external payable { }

    function setUp() public {
        vm.chainId(4663);
        vm.warp(1_800_000_000);
        vm.deal(address(this), 2_000_000 ether);
        vm.deal(ALICE, 100 ether);
        deployCodeTo("PoolManager.sol:PoolManager", abi.encode(address(this)), MANAGER);
        deployCodeTo("ModuleEngineAnyQuoteHostRouterFixture.sol:ModuleEngineAnyQuoteHostRouterFixture", ROUTER);
        deployCodeTo("AnyQuoteEthHostQuoteFixture", QUOTE);
        manager = IPoolManager(MANAGER);
        quote = AnyQuoteEthHostQuoteFixture(QUOTE);
        _seedExistingMarket();

        registry = new ModuleNativeRegistryV1(address(this));
        family = registry.registerReviewedFamily(AUTHOR, bytes32("native author"), AUTHOR, bytes32("submission"));
        factory = new UERC20Factory();
        policy = new ClassicModuleLaunchPolicyV1();
        guard = new Guard();
        address predictedHost = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        hook = _deployHook(predictedHost);
        host = Host(deployCode("ModuleEngineAnyQuoteEthHostV1.sol:ModuleEngineAnyQuoteEthHostV1", _hostArgs(hook)));
        assertEq(address(host), predictedHost);
        assertEq(address(hook).codehash, host.sharedHookCodeHash());
        assertEq(address(guard).codehash, host.NATIVE_ROUTE_GUARD_CODE_HASH());
        assertEq(ROUTER.codehash, host.UNIVERSAL_ROUTER_CODE_HASH());
        _bindings();
        _approve();
    }

    function testCanonicalRouteAndPlanBindUnchangedLpWithNoNewQuoteSeed() public {
        Host.LaunchParameters memory p = _params(1);
        bytes32 expectedPlan = keccak256(abi.encode(block.chainid, address(host), ALICE, p));
        bytes32 expectedRoute = keccak256(p.launchData);
        uint256 beforeQuote = quote.balanceOf(MANAGER);
        uint256 beforeNative = MANAGER.balance;
        vm.recordLogs();
        vm.prank(ALICE);
        Host.Launch memory launched = host.launch(p);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 poolId = host.poolIdOf(launched.launchId);
        AnyQuoteLPModuleV1 engine = AnyQuoteLPModuleV1(launched.engine);
        assertEq(launched.planHash, expectedPlan);
        assertEq(hook.nativeFeeRouteHash(poolId), expectedRoute);
        assertEq(keccak256(abi.encode(hook.nativeFeeRoute(poolId))), expectedRoute);
        assertEq(keccak256(p.creationCode), LP_CREATION_HASH);
        assertEq(keccak256(p.runtimeTemplate), LP_RUNTIME_TEMPLATE_HASH);
        assertEq(quote.balanceOf(MANAGER), beforeQuote, "new pool needs zero quote seed");
        assertEq(MANAGER.balance, beforeNative);
        assertEq(quote.balanceOf(ALICE), 0);
        assertEq(quote.balanceOf(launched.engine), 0);
        assertEq(engine.context().feeCollector, address(host.ledger()));
        assertEq(engine.poolId(), poolId);
        assertTrue(engine.initialized(), "route envelope must not be forwarded to the unchanged LP initializer");
        assertEq(IERC20(launched.token).totalSupply(), A.TOKEN_SUPPLY);
        assertEq(IERC20(launched.token).balanceOf(MANAGER) + engine.lockedTokenDust(), A.TOKEN_SUPPLY);
        assertEq(host.ledger().totalReceived(), 0);
        assertEq(host.ledger().treasury(), A.PLATFORM_RECIPIENT);
        _assertBoundEvents(logs, launched.launchId, poolId, expectedRoute, keccak256(abi.encode(p)));

        R.FeeHop[] memory changed = abi.decode(p.launchData, (R.FeeHop[]));
        changed[0].hookData = hex"01";
        p.launchData = abi.encode(changed);
        assertNotEq(keccak256(p.launchData), expectedRoute);
        assertNotEq(keccak256(abi.encode(block.chainid, address(host), ALICE, p)), expectedPlan);
    }

    function testAtomicNativeInitialBuyAccruesAndClaimsEthThroughPinnedRouter() public {
        Host.LaunchParameters memory p = _nativeParams(2);
        uint256 aliceBefore = ALICE.balance;
        vm.prank(ALICE);
        Host.Launch memory launched = host.launch{ value: 1 ether }(p);
        AnyQuoteEthLedgerV1 ledger = host.ledger();
        uint256 creatorEth = ledger.claimableEth(ALICE);
        uint256 platformEth = ledger.claimableEth(A.PLATFORM_RECIPIENT);
        assertGt(IERC20(launched.token).balanceOf(ALICE), 0);
        assertEq(ALICE.balance, aliceBefore - 1 ether);
        assertEq(quote.balanceOf(ALICE), 0, "creator supplies only native ETH");
        assertEq(quote.allowance(ALICE, address(host)), 0);
        assertEq(quote.allowance(address(host), ROUTER), 0);
        assertEq(quote.balanceOf(address(host)), 0);
        assertEq(quote.balanceOf(launched.engine), 0);
        assertEq(address(host).balance, 0);
        assertGt(creatorEth, 0);
        assertGt(platformEth, 0);
        assertEq(ledger.totalReceived(), creatorEth + platformEth);
        assertEq(manager.balanceOf(address(ledger), 0), creatorEth + platformEth);
        assertEq(manager.balanceOf(address(ledger), uint256(uint160(QUOTE))), 0);
        assertEq(quote.balanceOf(address(ledger)), 0);
        assertEq(address(ledger).balance, 0);
        assertEq(manager.currencyDelta(address(hook), Currency.wrap(address(0))), 0);
        assertEq(manager.currencyDelta(address(hook), Currency.wrap(QUOTE)), 0);
        assertEq(host.nonces(launched.launchId, ALICE), 1);
        assertFalse(manager.isUnlocked());

        uint256 platformBefore = A.PLATFORM_RECIPIENT.balance;
        vm.prank(ALICE);
        assertEq(ledger.claimEthTo(ALICE), creatorEth);
        assertEq(ledger.claimEthFor(A.PLATFORM_RECIPIENT), platformEth);
        assertEq(ALICE.balance, aliceBefore - 1 ether + creatorEth);
        assertEq(A.PLATFORM_RECIPIENT.balance, platformBefore + platformEth);
        assertEq(ledger.claimedBy(ALICE), creatorEth);
        assertEq(ledger.claimedBy(A.PLATFORM_RECIPIENT), platformEth);
        assertEq(ledger.totalReceived(), ledger.totalClaimed());
        assertEq(manager.balanceOf(address(ledger), 0), 0);
    }

    function testAbsentNoncanonicalAndWrongDirectionRoutesLeaveNoLaunch() public {
        Host.LaunchParameters memory p = _params(3);
        (address token,) = host.predictTokenAddress(p.name, p.symbol, ALICE, p.creatorSalt);
        bytes memory validRoute = p.launchData;
        uint256 quoteBefore = quote.balanceOf(MANAGER);
        p.launchData = "";
        vm.prank(ALICE);
        vm.expectRevert(Host.InvalidQuoteInfrastructure.selector);
        host.launch(p);
        p.launchData = bytes.concat(validRoute, bytes32(0));
        vm.prank(ALICE);
        vm.expectRevert(AnyQuoteEthSharedHookV1.InvalidNativeFeeRouteData.selector);
        host.launch(p);
        p.launchData = abi.encode(new R.FeeHop[](0));
        vm.prank(ALICE);
        vm.expectRevert(R.InvalidNativeFeeRoute.selector);
        host.launch(p);
        R.FeeHop[] memory hops = abi.decode(validRoute, (R.FeeHop[]));
        hops[0].zeroForOne = true;
        p.launchData = abi.encode(hops);
        vm.prank(ALICE);
        vm.expectRevert(R.InvalidNativeFeeRoute.selector);
        host.launch(p);
        assertEq(token.code.length, 0);
        assertEq(host.launchIdOf(token), bytes32(0));
        assertEq(quote.balanceOf(MANAGER), quoteBefore);
        assertEq(host.ledger().totalReceived(), 0);
    }

    function testUnavailableFeeMarketLeavesNoLaunch() public {
        Host.LaunchParameters memory p = _params(4);
        (address token,) = host.predictTokenAddress(p.name, p.symbol, ALICE, p.creatorSalt);
        R.FeeHop[] memory hops = abi.decode(p.launchData, (R.FeeHop[]));
        hops[0].key.fee = 500;
        p.launchData = abi.encode(hops);
        vm.prank(ALICE);
        vm.expectRevert(R.NativeFeeMarketUnavailable.selector);
        host.launch(p);
        assertEq(token.code.length, 0);
        assertEq(host.launchIdOf(token), bytes32(0));
    }

    function testNativeMinimumFailureRollsBackFeesPoolTokenAndEth() public {
        Host.LaunchParameters memory p = _nativeParams(5);
        p.initialOperation.minimumOutput = A.TOKEN_SUPPLY;
        uint256 quoteBefore = quote.balanceOf(MANAGER);
        uint256 nativeBefore = MANAGER.balance;
        vm.prank(ALICE);
        vm.expectRevert(Host.InsufficientOutput.selector);
        host.launch{ value: 1 ether }(p);
        assertEq(p.initialOperation.outputAsset.code.length, 0);
        assertEq(ALICE.balance, 100 ether);
        assertEq(quote.balanceOf(MANAGER), quoteBefore);
        assertEq(MANAGER.balance, nativeBefore);
        assertEq(host.ledger().totalReceived(), 0);
        assertEq(manager.balanceOf(address(host.ledger()), 0), 0);
    }

    function testConstructorRejectsWrongHookRuntimeAndNonreciprocalHost() public {
        bytes memory wrongHash =
            abi.encode(factory, policy, registry, manager, address(this), hook, bytes32(uint256(1)), guard);
        (address deployed, bytes memory reason) = _attemptHost(wrongHash);
        assertEq(deployed, address(0));
        assertEq(bytes4(reason), Host.InvalidQuoteInfrastructure.selector);
        // Runtime is genuine, but this hook points to the existing host, not a newly deployed one.
        (deployed, reason) = _attemptHost(_hostArgs(hook));
        assertEq(deployed, address(0));
        assertEq(bytes4(reason), Host.InvalidQuoteInfrastructure.selector);
    }

    function testHookRuntimeMutationCannotAdmitNewLaunch() public {
        Host.LaunchParameters memory p = _params(6);
        (address token,) = host.predictTokenAddress(p.name, p.symbol, ALICE, p.creatorSalt);
        vm.etch(address(hook), hex"00");
        vm.prank(ALICE);
        vm.expectRevert(Host.InvalidQuoteInfrastructure.selector);
        host.launch(p);
        assertEq(token.code.length, 0);
    }

    function testAllRuntimeAndFullInitcodeSizesFitEipLimits() public {
        assertLe(address(host).code.length, 24_576, "host EIP-170");
        assertLe(address(hook).code.length, 24_576, "hook EIP-170");
        assertLe(address(host.ledger()).code.length, 24_576, "ledger EIP-170");
        assertLe(address(guard).code.length, 24_576, "guard EIP-170");
        assertLe(
            vm.getCode("ModuleEngineAnyQuoteEthHostV1.sol:ModuleEngineAnyQuoteEthHostV1").length
                + _hostArgs(hook).length,
            49_152,
            "host complete EIP-3860 initcode"
        );
        assertLe(
            vm.getCode("AnyQuoteEthSharedHookV1.sol:AnyQuoteEthSharedHookV1").length
                + abi.encode(manager, address(host), address(this)).length,
            49_152,
            "hook complete EIP-3860 initcode"
        );
        assertLe(
            vm.getCode("AnyQuoteEthLedgerV1.sol:AnyQuoteEthLedgerV1").length
                + abi.encode(manager, address(host), address(this)).length,
            49_152,
            "ledger complete EIP-3860 initcode"
        );
        Host.LaunchParameters memory p = _params(7);
        vm.prank(ALICE);
        Host.Launch memory launched = host.launch(p);
        AnyQuoteLPModuleV1 engine = AnyQuoteLPModuleV1(launched.engine);
        assertLe(launched.engine.code.length, 24_576, "LP EIP-170");
        assertLe(p.creationCode.length + abi.encode(engine.context(), p.configuration).length, 49_152, "LP initcode");
    }

    function _seedExistingMarket() private {
        market = PoolKey(Currency.wrap(address(0)), Currency.wrap(QUOTE), 3000, 60, IHooks(address(0)));
        manager.initialize(market, TickMath.getSqrtPriceAtTick(0));
        PoolModifyLiquidityTest provider = new PoolModifyLiquidityTest(manager);
        quote.mint(address(this), 1_000_000 ether);
        quote.approve(address(provider), type(uint256).max);
        provider.modifyLiquidity{ value: 1_000_000 ether }(
            market, ModifyLiquidityParams(-887_220, 887_220, int256(1_000_000 ether), bytes32(0)), ""
        );
        assertGt(manager.getLiquidity(market.toId()), 0);
    }

    function _deployHook(address predictedHost) private returns (AnyQuoteEthSharedHookV1 result) {
        bytes memory init = bytes.concat(
            vm.getCode("AnyQuoteEthSharedHookV1.sol:AnyQuoteEthSharedHookV1"),
            abi.encode(manager, predictedHost, address(this))
        );
        bytes32 initHash = keccak256(init);
        uint160 flags = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
        bytes32 salt;
        for (uint256 i;; ++i) {
            salt = bytes32(i);
            address predictedHook = vm.computeCreate2Address(salt, initHash, address(this));
            if (uint160(predictedHook) & Hooks.ALL_HOOK_MASK == flags) break;
        }
        address deployed;
        assembly ("memory-safe") { deployed := create2(0, add(init, 32), mload(init), salt) }
        require(deployed != address(0), "native hook deployment failed");
        result = AnyQuoteEthSharedHookV1(deployed);
    }

    function _hostArgs(AnyQuoteEthSharedHookV1 targetHook) private view returns (bytes memory) {
        return abi.encode(
            factory, policy, registry, manager, address(this), targetHook, address(targetHook).codehash, guard
        );
    }

    function _attemptHost(bytes memory args) private returns (address deployed, bytes memory reason) {
        bytes memory init =
            bytes.concat(vm.getCode("ModuleEngineAnyQuoteEthHostV1.sol:ModuleEngineAnyQuoteEthHostV1"), args);
        assembly ("memory-safe") {
            deployed := create(0, add(init, 32), mload(init))
            let size := returndatasize()
            reason := mload(0x40)
            mstore(reason, size)
            returndatacopy(add(reason, 32), 0, size)
            mstore(0x40, add(add(reason, 32), and(add(size, 31), not(31))))
        }
    }

    function _bindings() private {
        string memory json = vm.readFile("out/AnyQuoteLPModuleV1.sol/AnyQuoteLPModuleV1.json");
        string memory root = ".deployedBytecode.immutableReferences";
        string[] memory keys = vm.parseJsonKeys(json, root);
        assertEq(keys.length, 4);
        for (uint256 i; i < keys.length; ++i) {
            for (uint256 j = i + 1; j < keys.length; ++j) {
                if (vm.parseUint(keys[j]) < vm.parseUint(keys[i])) (keys[i], keys[j]) = (keys[j], keys[i]);
            }
        }
        uint32[4] memory words = [uint32(288), uint32(352), uint32(320), uint32(416)];
        for (uint256 i; i < keys.length; ++i) {
            Location[] memory locations =
                abi.decode(vm.parseJson(json, string.concat(root, ".", keys[i])), (Location[]));
            for (uint256 j; j < locations.length; ++j) {
                assertEq(locations[j].length, 32);
                runtimeOffsets.push(uint32(locations[j].start));
                constructorOffsets.push(words[i]);
            }
        }
        for (uint256 i; i < runtimeOffsets.length; ++i) {
            for (uint256 j = i + 1; j < runtimeOffsets.length; ++j) {
                if (runtimeOffsets[j] < runtimeOffsets[i]) {
                    (runtimeOffsets[i], runtimeOffsets[j]) = (runtimeOffsets[j], runtimeOffsets[i]);
                    (constructorOffsets[i], constructorOffsets[j]) = (constructorOffsets[j], constructorOffsets[i]);
                }
            }
        }
    }

    function _approve() private {
        T.Revision memory revision = T.Revision(
            family,
            LP_CREATION_HASH,
            LP_RUNTIME_TEMPLATE_HASH,
            bytes32("native reviewed manifest"),
            address(0),
            bytes32(0),
            host.BUY(),
            10_000_000,
            3,
            0,
            true
        );
        T.Permission[] memory permissions = new T.Permission[](2);
        permissions[0] = T.Permission(host.BUY(), T.ROLE_QUOTE, T.ROLE_PRIMARY, T.AUTH_PUBLIC);
        permissions[1] = T.Permission(host.SELL(), T.ROLE_PRIMARY, T.ROLE_QUOTE, T.AUTH_PUBLIC);
        bytes32[] memory families = new bytes32[](1);
        families[0] = family;
        host.approveRevision(REVISION, revision, runtimeOffsets, constructorOffsets, permissions, families);
    }

    function _params(uint256 salt) private view returns (Host.LaunchParameters memory p) {
        p.name = "Native fee quote coin";
        p.symbol = "ANY";
        p.creatorSalt = bytes32(salt);
        p.revisionId = REVISION;
        p.quoteAsset = QUOTE;
        (address token,) = host.predictTokenAddress(p.name, p.symbol, ALICE, p.creatorSalt);
        p.configuration = abi.encode(
            A.Configuration(
                A.SCHEMA_ID,
                MANAGER,
                MANAGER.codehash,
                address(hook),
                QUOTE,
                QUOTE < token ? int24(120_000) : int24(-120_000),
                uint64(block.timestamp + 180),
                keccak256("bound native market price evidence")
            )
        );
        p.creationCode = vm.getCode("AnyQuoteLPModuleV1.sol:AnyQuoteLPModuleV1");
        p.runtimeTemplate = vm.getDeployedCode("AnyQuoteLPModuleV1.sol:AnyQuoteLPModuleV1");
        R.FeeHop[] memory hops = new R.FeeHop[](1);
        hops[0] = R.FeeHop(market, false, "");
        p.launchData = abi.encode(hops);
        p.creatorWallets = new address[](1);
        p.creatorSharesBps = new uint16[](1);
        p.creatorWallets[0] = ALICE;
        p.creatorSharesBps[0] = 10_000;
        p.buyCreatorFeeBps = 100;
        p.sellCreatorFeeBps = 200;
    }

    function _nativeParams(uint256 salt) private view returns (Host.LaunchParameters memory p) {
        p = _params(salt);
        (address token,) = host.predictTokenAddress(p.name, p.symbol, ALICE, p.creatorSalt);
        bool quote0 = QUOTE < token;
        PoolKey memory primary = PoolKey(
            Currency.wrap(quote0 ? QUOTE : token), Currency.wrap(quote0 ? token : QUOTE), 0, 200, IHooks(address(hook))
        );
        bytes[] memory params = new bytes[](4);
        params[0] = abi.encode(address(0), 1 ether, false);
        params[1] = abi.encode(RouterExactInputSingle(market, true, 1 ether, 1, 0, ""));
        params[2] = abi.encode(RouterExactInputSingle(primary, quote0, 0, 1, 0, ""));
        params[3] = abi.encode(token, ALICE, uint256(0));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"0b06060e", params);
        p.initialOperation = T.Operation(
            host.NATIVE_BUY(),
            ALICE,
            ALICE,
            address(0),
            1 ether,
            token,
            1,
            block.timestamp + 600,
            0,
            abi.encode(hex"10", inputs)
        );
    }

    function _assertBoundEvents(
        Vm.Log[] memory logs,
        bytes32 launchId,
        bytes32 poolId,
        bytes32 routeHash,
        bytes32 encodedParametersHash
    ) private view {
        bool routeFound;
        bool parametersFound;
        for (uint256 i; i < logs.length; ++i) {
            if (
                logs[i].emitter == address(hook)
                    && logs[i].topics[0] == keccak256("NativeFeeRouteBound(bytes32,bytes32,bytes32)")
            ) {
                assertEq(logs[i].topics[1], poolId);
                assertEq(logs[i].topics[2], launchId);
                assertEq(logs[i].topics[3], routeHash);
                routeFound = true;
            }
            if (
                logs[i].emitter == address(host)
                    && logs[i].topics[0] == keccak256("EngineLaunchParametersBound(bytes32,bytes)")
            ) {
                assertEq(logs[i].topics[1], launchId);
                assertEq(keccak256(abi.decode(logs[i].data, (bytes))), encodedParametersHash);
                parametersFound = true;
            }
        }
        assertTrue(routeFound, "native route receipt missing");
        assertTrue(parametersFound, "full launch parameters receipt missing");
    }
}
