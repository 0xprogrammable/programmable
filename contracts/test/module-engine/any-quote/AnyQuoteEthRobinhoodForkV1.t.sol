// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TransientStateLibrary } from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
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

interface AnyQuoteForkPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

interface AnyQuoteForkRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

/// @dev Opt-in, fixed-block local fork. Only test ETH is funded; chain contracts and market storage are untouched.
contract AnyQuoteEthRobinhoodForkV1Test is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;
    uint256 private constant SNAPSHOT_BLOCK = 60_166_703;
    uint256 private constant INITIAL_ETH = 0.0001 ether;
    address private constant ALICE = address(0xA11CE);
    address private constant AUTHOR = A.PLATFORM_RECIPIENT;
    address private constant MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address private constant ROUTER = 0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99;
    address private constant QUOTE = address(0xC60bA256B44334A0Cd2C7242E98B88f031abB006);
    address private constant QUOTE_HOOK = address(0x720e649549F7BC2118aCBA9F4C9ae6fCC7586080);
    address private constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    bytes32 private constant REVISION = keccak256("native fee actual Robinhood fork");
    bytes32 private constant LP_CREATION_HASH = 0xce84d052ba7574b525d141cfb31ea40513df6e292d24179582059998150cedc3;
    bytes32 private constant LP_RUNTIME_TEMPLATE_HASH =
        0x45f1a071a9b22b2f2d3de84869e9e71c1a2844158ca4a3ff81c268c68792e3c6;
    Host private host;
    Guard private guard;
    AnyQuoteEthSharedHookV1 private hook;
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
        string memory rpc = vm.envOr("ANY_QUOTE_ETH_ROBINHOOD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);
        assertEq(block.chainid, 4663);
        assertEq(block.timestamp, 1_789_120_505);
        vm.deal(address(this), 1 ether);
        vm.deal(ALICE, 1 ether);
        manager = IPoolManager(MANAGER);
        assertEq(MANAGER.codehash, bytes32(0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626));
        market = PoolKey(Currency.wrap(address(0)), Currency.wrap(QUOTE), 8_388_608, 60, IHooks(QUOTE_HOOK));
        assertEq(
            PoolId.unwrap(market.toId()), bytes32(0x3df16f271060e4941c0386047def159f42e629dc0455db623c5b363eeacbcc1d)
        );
        assertGt(manager.getLiquidity(market.toId()), 0);
        assertGt(QUOTE_HOOK.code.length, 0);
        registry = new ModuleNativeRegistryV1(address(this));
        family = registry.registerReviewedFamily(AUTHOR, bytes32("native author"), AUTHOR, bytes32("fork submission"));
        factory = UERC20Factory(0x754e8c1ADe3C6C4c863590a91F2ED020baF8E779);
        policy = ClassicModuleLaunchPolicyV1(0xF3FF250759A66EDc7893bbA9D34dAF4ba4Ae4caA);
        guard = Guard(0x92C1D5735a89488a77841634c48d922cd3f2c0e4);
        address predictedHost = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        hook = _deployHook(predictedHost);
        host = Host(deployCode("ModuleEngineAnyQuoteEthHostV1.sol:ModuleEngineAnyQuoteEthHostV1", _hostArgs(hook)));
        assertEq(address(host), predictedHost);
        assertLe(address(host).code.length, 24_576);
        assertEq(ROUTER.codehash, host.UNIVERSAL_ROUTER_CODE_HASH());
        _bindings();
        _approve();
    }

    function test_forkActualPgramPoolAtomicEthLaunchSellAndNativeClaims() public {
        Host.LaunchParameters memory p = _nativeParams(1);
        assertEq(IERC20(QUOTE).balanceOf(ALICE), 0, "no quote funding");
        uint256 aliceBefore = ALICE.balance;
        vm.prank(ALICE);
        Host.Launch memory launched = host.launch{ value: INITIAL_ETH }(p);
        AnyQuoteEthLedgerV1 ledger = host.ledger();
        uint256 bought = IERC20(launched.token).balanceOf(ALICE);
        assertGt(bought, 0);
        assertEq(ALICE.balance, aliceBefore - INITIAL_ETH);
        assertGt(ledger.claimableEth(ALICE), 0);
        assertGt(ledger.claimableEth(A.PLATFORM_RECIPIENT), 0);
        uint256 buyFees = ledger.totalReceived();
        assertEq(manager.balanceOf(address(ledger), 0), buyFees);
        assertEq(manager.balanceOf(address(ledger), uint256(uint160(QUOTE))), 0);
        assertEq(hook.nativeFeeRouteHash(host.poolIdOf(launched.launchId)), keccak256(p.launchData));
        uint256 sellReceived = _sell(launched.token, bought);
        assertGt(sellReceived, 0);
        assertEq(IERC20(launched.token).balanceOf(ALICE), 0);
        assertEq(IERC20(QUOTE).balanceOf(ALICE), 0);
        assertGt(ledger.totalReceived(), buyFees);
        uint256 creatorEth = ledger.claimableEth(ALICE);
        uint256 platformEth = ledger.claimableEth(A.PLATFORM_RECIPIENT);
        uint256 platformBefore = A.PLATFORM_RECIPIENT.balance;
        uint256 creatorBefore = ALICE.balance;
        vm.prank(ALICE);
        assertEq(ledger.claimEthTo(ALICE), creatorEth);
        assertEq(ledger.claimEthFor(A.PLATFORM_RECIPIENT), platformEth);
        assertEq(ALICE.balance - creatorBefore, creatorEth);
        assertEq(A.PLATFORM_RECIPIENT.balance - platformBefore, platformEth);
        assertEq(ledger.totalReceived(), ledger.totalClaimed());
        assertEq(manager.balanceOf(address(ledger), 0), 0);
        assertEq(IERC20(QUOTE).balanceOf(address(ledger)), 0);
        assertEq(manager.currencyDelta(address(hook), Currency.wrap(address(0))), 0);
        assertEq(manager.currencyDelta(address(hook), Currency.wrap(QUOTE)), 0);
        assertFalse(manager.isUnlocked());
        emit log_named_uint("RPC snapshot L2 block", SNAPSHOT_BLOCK);
        emit log_named_uint("initial ETH input", INITIAL_ETH);
        emit log_named_uint("token bought", bought);
        emit log_named_uint("sell ETH output", sellReceived);
        emit log_named_uint("creator native ETH fee", creatorEth);
        emit log_named_uint("platform native ETH fee", platformEth);
    }

    function _sell(address token, uint256 amount) private returns (uint256 received) {
        PoolKey memory primary = hook.poolKey(host.poolIdOf(host.launchIdOf(token)));
        bytes[] memory params = new bytes[](4);
        params[0] = abi.encode(token, amount, true);
        params[1] = abi.encode(RouterExactInputSingle(primary, token < QUOTE, uint128(amount), 1, 0, ""));
        params[2] = abi.encode(RouterExactInputSingle(market, false, 0, 1, 0, ""));
        params[3] = abi.encode(address(0), ALICE, uint256(0));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"0b06060e", params);
        vm.startPrank(ALICE);
        // UERC20 fixes the token's Permit2 allowance at infinity. The actual router grant stays bounded.
        assertGe(IERC20(token).allowance(ALICE, PERMIT2), amount);
        AnyQuoteForkPermit2(PERMIT2).approve(token, ROUTER, uint160(amount), uint48(block.timestamp + 600));
        uint256 beforeEth = ALICE.balance;
        AnyQuoteForkRouter(ROUTER).execute(hex"10", inputs, block.timestamp + 600);
        received = ALICE.balance - beforeEth;
        vm.stopPrank();
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
                QUOTE < token ? int24(50_400) : int24(-50_400),
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
        params[0] = abi.encode(address(0), uint128(INITIAL_ETH), false);
        params[1] = abi.encode(RouterExactInputSingle(market, true, uint128(INITIAL_ETH), 1, 0, ""));
        params[2] = abi.encode(RouterExactInputSingle(primary, quote0, 0, 1, 0, ""));
        params[3] = abi.encode(token, ALICE, uint256(0));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"0b06060e", params);
        p.initialOperation = T.Operation(
            host.NATIVE_BUY(),
            ALICE,
            ALICE,
            address(0),
            uint128(INITIAL_ETH),
            token,
            1,
            block.timestamp + 600,
            0,
            abi.encode(hex"10", inputs)
        );
    }
}
