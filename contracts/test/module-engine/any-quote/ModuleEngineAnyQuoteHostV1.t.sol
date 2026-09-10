// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { ClassicModuleLaunchPolicyV1 } from "../../../src/classic-modules/ClassicModuleLaunchPolicyV1.sol";
import { ModuleNativeRegistryV1 } from "../../../src/module-mode/engine/ModuleNativeRegistryV1.sol";
import { IModuleEngineReviewAuthorityV1 } from "../../../src/module-engine/ModuleEngineHostV1.sol";
import { ModuleEngineTypesV1 as T } from "../../../src/module-engine/ModuleEngineTypesV1.sol";
import {
    ModuleEngineAnyQuoteHostV1 as Host
} from "../../../src/module-engine/any-quote/ModuleEngineAnyQuoteHostV1.sol";
import {
    AnyQuoteNativeRouteGuardV1 as Guard
} from "../../../src/module-engine/any-quote/AnyQuoteNativeRouteGuardV1.sol";
import { AnyQuoteSharedHookV1 } from "../../../src/module-engine/any-quote/AnyQuoteSharedHookV1.sol";
import { AnyQuoteLPModuleV1 } from "../../../src/module-engine/any-quote/AnyQuoteLPModuleV1.sol";
import { AnyQuoteLedgerV1 } from "../../../src/module-engine/any-quote/AnyQuoteLedgerV1.sol";
import { AnyQuoteTypesV1 as A } from "../../../src/module-engine/any-quote/AnyQuoteTypesV1.sol";
import { ModuleEngineAnyQuoteHostRouterFixture } from "./ModuleEngineAnyQuoteHostRouterFixture.sol";

/// @dev Local wrapped-native token only. Router code, PoolManager, host, hook and engine are real.
contract AnyQuoteHostWethFixture is ERC20 {
    constructor() ERC20("Wrapped Ether fixture", "WETH") { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool sent,) = msg.sender.call{ value: amount }("");
        require(sent);
    }
}

contract ModuleEngineAnyQuoteHostV1Test is Test {
    address private constant ALICE = address(0xA11CE);
    address private constant AUTHOR = address(0xA077);
    address private constant MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address private constant ROUTER = 0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99;
    address private constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    bytes32 private constant REVISION = keccak256("reviewed any quote host integration");
    uint256 private constant CONTRACT_BALANCE = 1 << 255;
    Host private host;
    Guard private guard;
    AnyQuoteHostWethFixture private weth;
    ModuleNativeRegistryV1 private registry;
    UERC20Factory private factory;
    ClassicModuleLaunchPolicyV1 private policy;
    bytes32 private family;
    uint32[] private runtimeOffsets;
    uint32[] private constructorOffsets;

    struct Location {
        uint256 length;
        uint256 start;
    }

    // Universal Router 2.1.1 includes minHopPriceX36 in its V4 exact-input tuple.
    struct RouterExactInputSingle {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        uint256 minHopPriceX36;
        bytes hookData;
    }

    function setUp() public {
        vm.chainId(4663);
        vm.warp(1_800_000_000);
        vm.deal(ALICE, 100 ether);
        deployCodeTo("PoolManager.sol:PoolManager", abi.encode(address(this)), MANAGER);
        deployCodeTo("ModuleEngineAnyQuoteHostRouterFixture.sol:ModuleEngineAnyQuoteHostRouterFixture", ROUTER);
        deployCodeTo("AnyQuoteHostWethFixture", WETH);
        weth = AnyQuoteHostWethFixture(WETH);
        weth.mint(ALICE, 100 ether);
        registry = new ModuleNativeRegistryV1(address(this));
        family = registry.registerReviewedFamily(AUTHOR, bytes32("author salt"), AUTHOR, bytes32("submission digest"));
        factory = new UERC20Factory();
        policy = new ClassicModuleLaunchPolicyV1();
        guard = new Guard();
        address predictedHost = computeCreateAddress(address(this), vm.getNonce(address(this)));
        bytes32 hookInitHash = keccak256(
            bytes.concat(
                vm.getCode("AnyQuoteSharedHookV1.sol:AnyQuoteSharedHookV1"),
                abi.encode(MANAGER, predictedHost, address(this))
            )
        );
        uint160 flags = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
        bytes32 salt;
        for (uint256 i;; ++i) {
            salt = bytes32(i);
            address hook = computeCreate2Address(salt, hookInitHash, predictedHost);
            if (uint160(hook) & Hooks.ALL_HOOK_MASK == flags) break;
        }
        bytes memory args = abi.encode(factory, policy, registry, IPoolManager(MANAGER), address(this), salt, guard);
        assertLe(vm.getCode("ModuleEngineAnyQuoteHostV1.sol:ModuleEngineAnyQuoteHostV1").length + args.length, 49_152);
        host = Host(deployCode("ModuleEngineAnyQuoteHostV1.sol:ModuleEngineAnyQuoteHostV1", args));
        assertEq(address(host), predictedHost);
        assertLe(address(host).code.length, 24_576);
        assertEq(address(guard).codehash, host.NATIVE_ROUTE_GUARD_CODE_HASH());
        _bindings();
        _approve(REVISION, bytes32(0));
        vm.prank(ALICE);
        weth.approve(address(host), type(uint256).max);
    }

    function _bindings() private {
        string memory json = vm.readFile("out/AnyQuoteLPModuleV1.sol/AnyQuoteLPModuleV1.json");
        string memory root = ".deployedBytecode.immutableReferences";
        string[] memory keys = vm.parseJsonKeys(json, root);
        assertEq(keys.length, 4, "only direct constructor words may be immutable");
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

    function _approve(bytes32 revisionId, bytes32 fixedConfig) private {
        T.Revision memory revision = T.Revision(
            family,
            keccak256(vm.getCode("AnyQuoteLPModuleV1.sol:AnyQuoteLPModuleV1")),
            keccak256(vm.getDeployedCode("AnyQuoteLPModuleV1.sol:AnyQuoteLPModuleV1")),
            bytes32("source reviewed manifest"),
            address(0),
            fixedConfig,
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
        host.approveRevision(revisionId, revision, runtimeOffsets, constructorOffsets, permissions, families);
    }

    function _params(uint256 salt) private view returns (Host.LaunchParameters memory p) {
        p.name = "Other pool asset";
        p.symbol = "ANY";
        p.creatorSalt = bytes32(salt);
        p.revisionId = REVISION;
        p.quoteAsset = WETH;
        (address token,) = host.predictTokenAddress(p.name, p.symbol, ALICE, p.creatorSalt);
        p.configuration = abi.encode(
            A.Configuration(
                A.SCHEMA_ID,
                MANAGER,
                MANAGER.codehash,
                address(host.sharedHook()),
                WETH,
                WETH < token ? int24(120_000) : int24(-120_000),
                uint64(block.timestamp + 180),
                keccak256("bound price evidence")
            )
        );
        p.creationCode = vm.getCode("AnyQuoteLPModuleV1.sol:AnyQuoteLPModuleV1");
        p.runtimeTemplate = vm.getDeployedCode("AnyQuoteLPModuleV1.sol:AnyQuoteLPModuleV1");
        p.creatorWallets = new address[](1);
        p.creatorSharesBps = new uint16[](1);
        p.creatorWallets[0] = ALICE;
        p.creatorSharesBps[0] = 10_000;
        p.buyCreatorFeeBps = 100;
        p.sellCreatorFeeBps = 200;
    }

    function _launch(uint256 salt) private returns (Host.Launch memory launched) {
        Host.LaunchParameters memory p = _params(salt);
        vm.prank(ALICE);
        return host.launch(p);
    }

    function _operation(Host.Launch memory launched, bool buy, uint256 amount, uint256 nonce)
        private
        view
        returns (T.Operation memory)
    {
        return T.Operation(
            buy ? host.BUY() : host.SELL(),
            ALICE,
            ALICE,
            buy ? WETH : launched.token,
            amount,
            buy ? launched.token : WETH,
            1,
            block.timestamp + 600,
            nonce,
            abi.encode(uint160(0))
        );
    }

    function _nativeParams(uint256 salt) private view returns (Host.LaunchParameters memory p) {
        p = _params(salt);
        (address token,) = host.predictTokenAddress(p.name, p.symbol, ALICE, p.creatorSalt);
        bool quote0 = WETH < token;
        PoolKey memory key = PoolKey(
            Currency.wrap(quote0 ? WETH : token),
            Currency.wrap(quote0 ? token : WETH),
            0,
            200,
            IHooks(address(host.sharedHook()))
        );
        bytes[] memory actions = new bytes[](3);
        actions[0] = abi.encode(WETH, CONTRACT_BALANCE, false);
        actions[1] = abi.encode(RouterExactInputSingle(key, quote0, 0, 1, 0, ""));
        actions[2] = abi.encode(token, ALICE, uint256(0));
        bytes[] memory inputs = new bytes[](2);
        inputs[0] = abi.encode(address(2), 1 ether);
        inputs[1] = abi.encode(hex"0b060e", actions);
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
            abi.encode(hex"0b10", inputs)
        );
    }

    function test_realZeroQuoteLaunchSourceBindingAndPermanentIdentity() public {
        Host.Launch memory launched = _launch(1);
        AnyQuoteLPModuleV1 engine = AnyQuoteLPModuleV1(launched.engine);
        assertEq(weth.balanceOf(MANAGER), 0);
        assertEq(IERC20(launched.token).totalSupply(), A.TOKEN_SUPPLY);
        assertEq(IERC20(launched.token).balanceOf(MANAGER) + engine.lockedTokenDust(), A.TOKEN_SUPPLY);
        assertEq(engine.context().feeCollector, address(host.ledger()));
        assertEq(engine.contextHash(), keccak256(abi.encode(engine.context())));
        assertEq(engine.poolId(), host.poolIdOf(launched.launchId));
        (address author, address wallet) = registry.families(family);
        assertEq(author, AUTHOR);
        assertEq(wallet, AUTHOR);
        assertEq(AnyQuoteLedgerV1(address(host.ledger())).treasury(), A.PLATFORM_RECIPIENT);
    }

    function test_quoteBuySellChargeWholeBaseToPlatformAndRemainTradableAfterExpiryAndDisable() public {
        Host.Launch memory launched = _launch(2);
        vm.warp(block.timestamp + 181);
        host.setRevisionEnabled(REVISION, false);
        T.Operation memory buy = _operation(launched, true, 1 ether, 0);
        vm.prank(ALICE);
        host.execute(launched.launchId, buy);
        uint256 received = IERC20(launched.token).balanceOf(ALICE);
        assertGt(received, 0);
        assertEq(host.ledger().claimableQuote(WETH, A.PLATFORM_RECIPIENT), 0.003 ether);
        assertEq(host.ledger().claimableQuote(WETH, ALICE), 0.01 ether);
        vm.prank(ALICE);
        IERC20(launched.token).approve(address(host), received);
        T.Operation memory sell = _operation(launched, false, received, 1);
        uint256 before = weth.balanceOf(ALICE);
        vm.prank(ALICE);
        host.execute(launched.launchId, sell);
        assertGt(weth.balanceOf(ALICE), before);
        assertGt(host.ledger().claimableQuote(WETH, A.PLATFORM_RECIPIENT), 0.003 ether);
        assertEq(IERC20(launched.token).balanceOf(ALICE), 0);
        assertEq(weth.allowance(address(host), ROUTER), 0);
    }

    function test_nativeInitialBuyUsesPinnedProductionRouterAtomicallyWithoutQuoteApproval() public {
        Host.LaunchParameters memory p = _nativeParams(3);
        vm.prank(ALICE);
        weth.approve(address(host), 0);
        uint256 nativeBefore = ALICE.balance;
        uint256 quoteBefore = weth.balanceOf(ALICE);
        vm.prank(ALICE);
        Host.Launch memory launched = host.launch{ value: 1 ether }(p);
        assertGt(IERC20(launched.token).balanceOf(ALICE), 0);
        assertEq(ALICE.balance, nativeBefore - 1 ether);
        assertEq(weth.balanceOf(ALICE), quoteBefore);
        assertEq(host.ledger().claimableQuote(WETH, A.PLATFORM_RECIPIENT), 0.003 ether);
        assertEq(host.nonces(launched.launchId, ALICE), 1);
        assertEq(address(host).balance, 0);
        assertEq(weth.balanceOf(address(host)), 0);
        assertEq(weth.allowance(address(host), ROUTER), 0);
    }

    function test_nativeMinimumFailureRollsBackTokenPoolAndFunding() public {
        Host.LaunchParameters memory p = _nativeParams(4);
        address token = p.initialOperation.outputAsset;
        p.initialOperation.minimumOutput = A.TOKEN_SUPPLY;
        vm.prank(ALICE);
        vm.expectRevert(Host.InsufficientOutput.selector);
        host.launch{ value: 1 ether }(p);
        assertEq(token.code.length, 0);
        assertEq(ALICE.balance, 100 ether);
        assertEq(weth.balanceOf(MANAGER), 0);
    }

    function test_nativeExcessFundingAndWrongActorAreRejectedAtomically() public {
        Host.LaunchParameters memory p = _nativeParams(5);
        vm.prank(ALICE);
        vm.expectRevert(Host.InvalidFunding.selector);
        host.launch{ value: 2 ether }(p);
        p.initialOperation.actor = AUTHOR;
        vm.prank(ALICE);
        vm.expectRevert(Host.InvalidOperation.selector);
        host.launch{ value: 1 ether }(p);
        assertEq(p.initialOperation.outputAsset.code.length, 0);
        assertEq(ALICE.balance, 100 ether);
    }

    function test_preparationExpiryFarFutureAndMalformedTickRejectBeforeCreation() public {
        Host.LaunchParameters memory p = _params(6);
        A.Configuration memory config = abi.decode(p.configuration, (A.Configuration));
        config.validUntil = uint64(block.timestamp + 181);
        p.configuration = abi.encode(config);
        vm.prank(ALICE);
        vm.expectRevert(Host.InvalidQuoteInfrastructure.selector);
        host.launch(p);
        config.validUntil = uint64(block.timestamp);
        p.configuration = abi.encode(config);
        vm.prank(ALICE);
        vm.expectRevert(Host.InvalidQuoteInfrastructure.selector);
        host.launch(p);
        config.validUntil = uint64(block.timestamp + 180);
        config.initialTick = 120_001;
        p.configuration = abi.encode(config);
        vm.prank(ALICE);
        vm.expectRevert(Host.InvalidQuoteInfrastructure.selector);
        host.launch(p);
    }

    function test_staleNonceWrongActorAndRuntimeMutationCannotSpendUserQuote() public {
        Host.Launch memory launched = _launch(7);
        T.Operation memory op = _operation(launched, true, 1 ether, 1);
        vm.prank(ALICE);
        vm.expectRevert(Host.StaleNonce.selector);
        host.execute(launched.launchId, op);
        op.nonce = 0;
        op.actor = AUTHOR;
        vm.prank(ALICE);
        vm.expectRevert(Host.UnauthorizedOperation.selector);
        host.execute(launched.launchId, op);
        op.actor = ALICE;
        vm.etch(launched.engine, hex"00");
        vm.prank(ALICE);
        vm.expectRevert(Host.InvalidCodeBinding.selector);
        host.execute(launched.launchId, op);
        assertEq(weth.balanceOf(ALICE), 100 ether);
        assertEq(host.nonces(launched.launchId, ALICE), 0);
    }

    function test_guardRejectsAllowRevertPermitWrongRecipientAndPayer() public {
        Host.LaunchParameters memory p = _nativeParams(8);
        (bytes memory commands, bytes[] memory inputs) = abi.decode(p.initialOperation.data, (bytes, bytes[]));
        commands[1] = bytes1(uint8(0x90));
        vm.expectRevert(Guard.InvalidNativeRoute.selector);
        guard.routerCallData(abi.encode(commands, inputs), ALICE, 1 ether, block.timestamp + 1);
        commands[1] = bytes1(uint8(0x0a));
        vm.expectRevert(Guard.InvalidNativeRoute.selector);
        guard.routerCallData(abi.encode(commands, inputs), ALICE, 1 ether, block.timestamp + 1);
        commands = hex"0b10";
        inputs[0] = abi.encode(AUTHOR, 1 ether);
        vm.expectRevert(Guard.InvalidNativeRoute.selector);
        guard.routerCallData(abi.encode(commands, inputs), ALICE, 1 ether, block.timestamp + 1);
        inputs[0] = abi.encode(address(2), 1 ether);
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(WETH, CONTRACT_BALANCE, true);
        params[1] = "";
        inputs[1] = abi.encode(hex"0b06", params);
        vm.expectRevert(Guard.InvalidNativeRoute.selector);
        guard.routerCallData(abi.encode(commands, inputs), ALICE, 1 ether, block.timestamp + 1);
    }
}
