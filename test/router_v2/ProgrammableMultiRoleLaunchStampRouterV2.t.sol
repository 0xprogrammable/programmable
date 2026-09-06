// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import {
    ProgrammableMultiRoleLaunchStampRouterV2 as Router
} from "../../src/router_v2/ProgrammableMultiRoleLaunchStampRouterV2.sol";
import {
    IProgrammableMultiRoleLaunchStampRouterV2 as IRouter
} from "../../src/router_v2/IProgrammableMultiRoleLaunchStampRouterV2.sol";
import {
    IProgrammableCreate2GraphDeployerV1 as IGraph
} from "../../src/interfaces/IProgrammableCreate2GraphDeployerV1.sol";
import { ProgrammableCreate2GraphDeployerV1 as Graph } from "./fixtures/ProgrammableCreate2GraphDeployerV1.sol";

/// @dev Local digest allowlist only: no signing key or externally usable signature exists in this fixture.
contract RouterV2TestAuthority is IERC1271 {
    mapping(bytes32 => bool) public allowed;

    function allow(bytes32 digest, bool valid) external {
        allowed[digest] = valid;
    }

    function isValidSignature(bytes32 digest, bytes memory signature) external view returns (bytes4) {
        return allowed[digest] && keccak256(signature) == keccak256(hex"c0ffee")
            ? IERC1271.isValidSignature.selector
            : bytes4(0xffffffff);
    }
}

contract RouterV2TestToken is ERC20 {
    constructor() ERC20("Router V2 fixture", "RV2") {
        _mint(address(0xB0B), 1_000_000 ether);
    }
}

/// @dev A real ERC20 and beforeInitialize hook at one address. It makes no fee or swap-safety claim.
contract RouterV2TestTokenHook is ERC20 {
    IPoolManager public manager;
    address public factory;
    uint256 public beforeInitializeCalls;

    constructor(IPoolManager manager_, address factory_) ERC20("Combined fixture", "COMBO") {
        manager = manager_;
        factory = factory_;
        _mint(address(0xB0B), 1_000_000 ether);
    }

    function beforeInitialize(address, PoolKey calldata, uint160) external returns (bytes4) {
        require(msg.sender == address(manager), "manager only");
        ++beforeInitializeCalls;
        return IHooks.beforeInitialize.selector;
    }

    function initializeSelf(PoolKey calldata key) external payable {
        require(msg.sender == factory, "factory only");
        require(Currency.unwrap(key.currency1) == address(this) && address(key.hooks) == address(this), "self key");
        manager.initialize(key, uint160(1 << 96));
    }
}

contract RouterV2TestHook {
    IPoolManager public manager;
    uint256 public beforeInitializeCalls;

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    function beforeInitialize(address, PoolKey calldata, uint160) external returns (bytes4) {
        require(msg.sender == address(manager), "manager only");
        ++beforeInitializeCalls;
        return IHooks.beforeInitialize.selector;
    }
}

contract RouterV2TestInitializer {
    IPoolManager public manager;
    address public factory;

    constructor(IPoolManager manager_, address factory_) {
        manager = manager_;
        factory = factory_;
    }

    function initialize(PoolKey calldata key) external payable {
        require(msg.sender == factory, "factory only");
        manager.initialize(key, uint160(1 << 96));
    }
}

/// @dev Passive byte-array validation only. Supplied bytes are never deployed or executed.
contract RouterV2OpcodeScanHarness is Router {
    constructor(address authority, IGraph graph, IPoolManager manager) Router(authority, graph, manager) { }

    function validateRuntimeOpcodes(uint256 targetIndex, bytes memory runtimeCode) external pure {
        _validateRuntimeOpcodes(targetIndex, runtimeCode);
    }
}

contract ProgrammableMultiRoleRuntimeOpcodeScanV2Test is Test {
    RouterV2OpcodeScanHarness private scanner;

    function setUp() public {
        scanner = new RouterV2OpcodeScanHarness(
            address(new RouterV2TestAuthority()),
            IGraph(address(new Graph())),
            IPoolManager(address(new PoolManager(address(this))))
        );
    }

    function test_runtimeScanRejectsEachForbiddenInstructionWithIndexAndPc() public {
        bytes memory opcodes = hex"fff2f4";
        for (uint256 index; index < opcodes.length; ++index) {
            bytes memory runtimeCode = abi.encodePacked(hex"60005b", opcodes[index]);
            vm.expectRevert(
                abi.encodeWithSelector(Router.ForbiddenRuntimeOpcode.selector, 15, 3, uint8(opcodes[index]))
            );
            scanner.validateRuntimeOpcodes(15, runtimeCode);
        }
    }

    function test_runtimeScanAcceptsForbiddenBytesInsideEveryPushWidth() public view {
        for (uint256 width = 1; width <= 32; ++width) {
            bytes memory runtimeCode = new bytes(width + 2);
            runtimeCode[0] = bytes1(uint8(0x5f + width));
            for (uint256 index = 1; index <= width; ++index) {
                runtimeCode[index] = index % 3 == 0 ? bytes1(0xff) : index % 3 == 1 ? bytes1(0xf2) : bytes1(0xf4);
            }
            runtimeCode[width + 1] = 0x5b;
            scanner.validateRuntimeOpcodes(0, runtimeCode);
        }
    }

    function test_runtimeScanRejectsInstructionImmediatelyAfterEveryPushWidth() public {
        for (uint256 width = 1; width <= 32; ++width) {
            bytes memory runtimeCode = new bytes(width + 2);
            runtimeCode[0] = bytes1(uint8(0x5f + width));
            runtimeCode[width + 1] = 0xff;
            vm.expectRevert(
                abi.encodeWithSelector(Router.ForbiddenRuntimeOpcode.selector, width - 1, width + 1, uint8(0xff))
            );
            scanner.validateRuntimeOpcodes(width - 1, runtimeCode);
        }
    }

    function test_runtimeScanHandlesPushZeroAndTruncatedPushData() public {
        scanner.validateRuntimeOpcodes(0, hex"5f607f00");
        scanner.validateRuntimeOpcodes(0, hex"7ffff2f4");
        scanner.validateRuntimeOpcodes(0, hex"60");
        vm.expectRevert(abi.encodeWithSelector(Router.ForbiddenRuntimeOpcode.selector, 0, 1, uint8(0xf4)));
        scanner.validateRuntimeOpcodes(0, hex"5ff4");
    }

    function test_runtimeScanDoesNotIgnoreBytesAfterStopOrReturn() public {
        vm.expectRevert(abi.encodeWithSelector(Router.ForbiddenRuntimeOpcode.selector, 3, 1, uint8(0xf2)));
        scanner.validateRuntimeOpcodes(3, hex"00f2");
        vm.expectRevert(abi.encodeWithSelector(Router.ForbiddenRuntimeOpcode.selector, 4, 1, uint8(0xff)));
        scanner.validateRuntimeOpcodes(4, hex"f3ff");
    }

    function test_runtimeScanAcceptsOrdinaryRuntimeInstructions() public view {
        scanner.validateRuntimeOpcodes(0, hex"5f3560005260206000f3");
        scanner.validateRuntimeOpcodes(0, hex"f0f1fafdfef5");
        scanner.validateRuntimeOpcodes(0, hex"");
    }
}

contract ProgrammableMultiRoleLaunchStampRouterV2Test is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    bytes32 private constant OUTPUT_TYPEHASH = keccak256(
        "ProgrammableExpectedGraphOutputV2(uint8 targetIndex,bytes32 targetIdHash,address account,bytes32 runtimeCodeHash)"
    );
    bytes32 private constant RESULT_TYPEHASH =
        keccak256("ProgrammableExpectedGraphResultV2(bytes32 expectedOutputsHash,bytes32 graphDeploymentHash)");
    bytes32 private constant PERMIT_TYPEHASH_V1 = keccak256(
        "ProgrammableLaunchPermitV1(uint256 chainId,address router,address launchWallet,uint8 kind,bytes32 routePayloadHash,bytes32 expectedResultHash,bytes32 stampRequestHash,bytes32 nonce,uint64 validAfter,uint64 deadline,uint256 value)"
    );
    bytes32 private constant PERMIT_TYPEHASH_V2 = keccak256(
        "ProgrammableLaunchPermitV2(uint256 chainId,address router,address launchWallet,uint8 kind,bytes32 routePayloadHash,bytes32 expectedResultHash,bytes32 stampRequestHash,bytes32 nonce,uint64 validAfter,uint64 deadline,uint256 value)"
    );
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAMESPACE = keccak256("router-v2-test");
    bytes32 private constant NONCE = keccak256("router-v2-nonce");
    bytes32 private constant LAUNCH_ID = keccak256("router-v2-launch");
    address private constant WALLET = address(0xB0B);

    Router private router;
    RouterV2TestAuthority private authority;
    Graph private graph;
    IPoolManager private manager;

    struct Request {
        IRouter.LaunchPermitV2 permit;
        IRouter.StampRequestV2 stamp;
        IRouter.CustomGraphRouteV2 route;
    }

    // Exact static permit field order of the existing, unrelated nested-factory Router V2.
    struct NestedFactoryPermit {
        uint256 chainId;
        address router;
        address launchWallet;
        bytes32 routeIdHash;
        bytes32 routeVersionHash;
        bytes32 profileKey;
        bytes32 routePayloadHash;
        bytes32 expectedResultHash;
        bytes32 stampRequestHash;
        bytes32 nonce;
        uint64 validAfter;
        uint64 deadline;
        uint256 value;
    }

    function setUp() public {
        vm.chainId(4663);
        vm.warp(1_800_000_000);
        authority = new RouterV2TestAuthority();
        graph = new Graph();
        manager = IPoolManager(address(new PoolManager(address(this))));
        router = new Router(address(authority), IGraph(address(graph)), manager);
        vm.deal(WALLET, 100 ether);
    }

    function test_combinedTokenHookDeploysOnceAndStampsAtomicGraph() public {
        Request memory request = _request(true, false, LAUNCH_ID, NONCE);
        vm.recordLogs();
        bytes32 stampHash = _launch(request);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        _assertStamped(request, stampHash);
        assertEq(request.route.targets.length, 2);
        assertEq(request.stamp.token, address(request.stamp.poolKey.hooks));
        assertEq(RouterV2TestTokenHook(request.stamp.token).beforeInitializeCalls(), 1);
        assertEq(RouterV2TestTokenHook(request.stamp.token).totalSupply(), 1_000_000 ether);
        uint256 deployments;
        uint256 combinedEvents;
        bytes32 deploymentTopic = keccak256(
            "ProgrammableCreate2GraphTargetDeployed(bytes32,bytes32,address,uint256,bytes32,bytes32,bytes32,bytes32,uint256,uint256)"
        );
        bytes32 componentTopic = keccak256("ProgrammableComponentStampedV2(bytes32,address,uint8,bytes32)");
        for (uint256 index; index < logs.length; ++index) {
            if (logs[index].emitter == address(graph) && logs[index].topics[0] == deploymentTopic) ++deployments;
            if (
                logs[index].emitter == address(router) && logs[index].topics[0] == componentTopic
                    && logs[index].topics[2] == bytes32(uint256(uint160(request.stamp.token)))
            ) {
                assertEq(logs[index].topics[3], bytes32(uint256(3)));
                ++combinedEvents;
            }
        }
        assertEq(deployments, 2, "one deployment per unique component");
        assertEq(combinedEvents, 1, "one combined role event");
    }

    function test_splitTokenHookKeepsIndependentRolesAndAtomicStamp() public {
        Request memory request = _request(false, false, LAUNCH_ID, NONCE);
        _assertStamped(request, _launch(request));
        assertEq(request.route.targets.length, 3);
        assertNotEq(request.stamp.token, address(request.stamp.poolKey.hooks));
        assertEq(RouterV2TestHook(address(request.stamp.poolKey.hooks)).beforeInitializeCalls(), 1);
        assertEq(_component(request, request.stamp.token).roleMask, 1);
        assertEq(_component(request, address(request.stamp.poolKey.hooks)).roleMask, 2);
    }

    function test_colocatedInitializerProvesOnlyStampAndShowsSelfCallbackBypass() public {
        Request memory request = _request(true, true, LAUNCH_ID, NONCE);
        _assertStamped(request, _launch(request));
        assertEq(request.route.targets.length, 1);
        assertEq(request.stamp.components[0].roleMask, 3);
        // Uniswap intentionally skips a hook's self-call. This success is not initialization/fee proof.
        assertEq(RouterV2TestTokenHook(request.stamp.token).beforeInitializeCalls(), 0);
    }

    function test_duplicateComponentAddressRejectedBeforeDeployment() public {
        Request memory request = _request(true, false, LAUNCH_ID, NONCE);
        request.stamp.components[1].account = request.stamp.components[0].account;
        vm.expectRevert(
            abi.encodeWithSelector(
                Router.DuplicateOrUnsortedComponent.selector,
                request.stamp.components[0].account,
                request.stamp.components[0].account
            )
        );
        _launch(request);
        _assertUnconsumed(request);
    }

    function test_unsortedComponentsRejectedBeforeDeployment() public {
        Request memory request = _request(true, false, LAUNCH_ID, NONCE);
        (request.stamp.components[0], request.stamp.components[1]) =
        (request.stamp.components[1], request.stamp.components[0]);
        vm.expectRevert(
            abi.encodeWithSelector(
                Router.DuplicateOrUnsortedComponent.selector,
                request.stamp.components[0].account,
                request.stamp.components[1].account
            )
        );
        _launch(request);
        _assertUnconsumed(request);
    }

    function test_unknownRoleBitsRejected() public {
        Request memory request = _request(true, false, LAUNCH_ID, NONCE);
        request.stamp.components[0].roleMask = 4;
        vm.expectRevert(
            abi.encodeWithSelector(Router.InvalidRoleMask.selector, request.stamp.components[0].account, uint8(4))
        );
        _launch(request);
        _assertUnconsumed(request);
    }

    function test_combinedRoleCannotOmitHookBit() public {
        Request memory request = _request(true, false, LAUNCH_ID, NONCE);
        _component(request, request.stamp.token).roleMask = 1;
        _bind(request);
        _expectBinding(request, 28);
    }

    function test_combinedRoleCannotOmitTokenBit() public {
        Request memory request = _request(true, false, LAUNCH_ID, NONCE);
        _component(request, request.stamp.token).roleMask = 2;
        _bind(request);
        _expectBinding(request, 28);
    }

    function test_splitHookCannotClaimTokenRole() public {
        Request memory request = _request(false, false, LAUNCH_ID, NONCE);
        _component(request, address(request.stamp.poolKey.hooks)).roleMask = 3;
        _bind(request);
        _expectBinding(request, 28);
    }

    function test_auxiliaryCannotClaimASecondTokenRole() public {
        Request memory request = _request(true, false, LAUNCH_ID, NONCE);
        address auxiliary = request.route.expectedOutputs[1].account;
        _component(request, auxiliary).roleMask = 1;
        _bind(request);
        _expectBinding(request, 28);
    }

    function test_hookMustBeInDeploymentComponents() public {
        Request memory request = _request(false, false, LAUNCH_ID, NONCE);
        _component(request, address(request.stamp.poolKey.hooks)).roleMask = 0;
        request.stamp.poolKey.hooks = IHooks(address(0x2000));
        _bind(request);
        _expectBinding(request, 29);
    }

    function test_duplicateOutputAddressRejected() public {
        Request memory request = _request(true, false, LAUNCH_ID, NONCE);
        request.route.expectedOutputs[1].account = request.route.expectedOutputs[0].account;
        // Address order decides whether the component-to-output binding or duplicate-output gate sees it first.
        uint8 expectedGate = request.stamp.components[0].resultIndex == 0 ? 24 : 25;
        _bind(request);
        _expectBinding(request, expectedGate);
    }

    function test_duplicateResultIndexRejected() public {
        Request memory request = _request(true, false, LAUNCH_ID, NONCE);
        request.stamp.components[1].resultIndex = request.stamp.components[0].resultIndex;
        _bind(request);
        _expectBinding(request, 25);
    }

    function test_combinedTokenRuntimeHashIndependentlyBound() public {
        Request memory request = _request(true, false, LAUNCH_ID, NONCE);
        request.stamp.tokenRuntimeCodeHash = keccak256("wrong token runtime");
        _bind(request);
        _expectBinding(request, 26);
    }

    function test_combinedHookRuntimeHashIndependentlyBound() public {
        Request memory request = _request(true, false, LAUNCH_ID, NONCE);
        request.stamp.hookRuntimeCodeHash = keccak256("wrong hook runtime");
        _bind(request);
        _expectBinding(request, 27);
    }

    function test_oldV1DomainAndTypeCannotAuthorizeV2() public {
        Request memory request = _request(true, false, LAUNCH_ID, NONCE);
        authority.allow(router.permitDigestV2(request.permit), false);
        bytes32 oldDigest = _digest(request.permit, PERMIT_TYPEHASH_V1, "1");
        authority.allow(oldDigest, true);
        assertNotEq(oldDigest, router.permitDigestV2(request.permit));
        vm.expectRevert(Router.InvalidPermitSignature.selector);
        _launch(request);
        _assertUnconsumed(request);
    }

    function test_oldDomainRejectedEvenWithV2PermitType() public {
        Request memory request = _request(true, false, LAUNCH_ID, NONCE);
        authority.allow(router.permitDigestV2(request.permit), false);
        authority.allow(_digest(request.permit, PERMIT_TYPEHASH_V2, "1"), true);
        vm.expectRevert(Router.InvalidPermitSignature.selector);
        _launch(request);
        _assertUnconsumed(request);
    }

    function test_oldPermitTypeRejectedEvenWithV2Domain() public {
        Request memory request = _request(true, false, LAUNCH_ID, NONCE);
        authority.allow(router.permitDigestV2(request.permit), false);
        authority.allow(_digest(request.permit, PERMIT_TYPEHASH_V1, "2"), true);
        vm.expectRevert(Router.InvalidPermitSignature.selector);
        _launch(request);
        _assertUnconsumed(request);
    }

    function test_existingNestedFactoryV2PermitCannotAuthorizeMultiRoleRouter() public {
        Request memory request = _request(true, false, LAUNCH_ID, NONCE);
        authority.allow(router.permitDigestV2(request.permit), false);
        NestedFactoryPermit memory nested;
        nested.chainId = request.permit.chainId;
        nested.router = address(router);
        nested.launchWallet = WALLET;
        nested.routeIdHash = keccak256("nested-factory");
        nested.routeVersionHash = keccak256("1.0.0");
        nested.profileKey = keccak256("existing profile");
        nested.routePayloadHash = request.permit.routePayloadHash;
        nested.expectedResultHash = request.permit.expectedResultHash;
        nested.stampRequestHash = request.permit.stampRequestHash;
        nested.nonce = request.permit.nonce;
        nested.validAfter = request.permit.validAfter;
        nested.deadline = request.permit.deadline;
        nested.value = request.permit.value;
        bytes32 nestedTypehash = keccak256(
            "ProgrammableLaunchPermitV2(uint256 chainId,address router,address launchWallet,bytes32 routeIdHash,bytes32 routeVersionHash,bytes32 profileKey,bytes32 routePayloadHash,bytes32 expectedResultHash,bytes32 stampRequestHash,bytes32 nonce,uint64 validAfter,uint64 deadline,uint256 value)"
        );
        bytes32 digest = _typedDigest(keccak256(abi.encode(nestedTypehash, nested)), "2");
        assertNotEq(digest, router.permitDigestV2(request.permit));
        authority.allow(digest, true);
        vm.expectRevert(Router.InvalidPermitSignature.selector);
        _launch(request);
        _assertUnconsumed(request);
    }

    function test_v1SelectorIsAbsentAndV2SelectorIsExplicit() public {
        assertEq(IRouter.launchAndStampV2.selector, bytes4(0x3d9895de));
        Request memory request = _request(true, false, LAUNCH_ID, NONCE);
        bytes4 oldSelector = bytes4(
            keccak256(
                "launchAndStampV1((uint256,address,address,uint8,bytes32,bytes32,bytes32,bytes32,uint64,uint64,uint256),(bytes32,address,bytes32,(address,address,uint24,int24,address),bytes32,(uint8,address,bytes32,uint8,uint8)[]),bytes,bytes)"
            )
        );
        bytes memory payload = abi.encodeWithSelector(
            oldSelector, request.permit, request.stamp, abi.encode(request.route), hex"c0ffee"
        );
        vm.prank(WALLET);
        (bool success,) = address(router).call{ value: request.permit.value }(payload);
        assertFalse(success);
        _assertUnconsumed(request);
    }

    function test_callerIsBoundBeforeDeployment() public {
        Request memory request = _request(true, false, LAUNCH_ID, NONCE);
        vm.deal(address(this), 1 ether);
        vm.expectRevert(abi.encodeWithSelector(Router.UnauthorizedLaunchWallet.selector, address(this), WALLET));
        router.launchAndStampV2{ value: 1 ether }(request.permit, request.stamp, abi.encode(request.route), hex"c0ffee");
        _assertUnconsumed(request);
    }

    function test_nativeValueMustMatchPermitExactly() public {
        Request memory request = _request(true, false, LAUNCH_ID, NONCE);
        vm.expectRevert(abi.encodeWithSelector(Router.InvalidBinding.selector, uint8(5)));
        vm.prank(WALLET);
        router.launchAndStampV2{ value: 1 ether - 1 }(
            request.permit, request.stamp, abi.encode(request.route), hex"c0ffee"
        );
        _assertUnconsumed(request);
    }

    function test_chainAndRouterAreBound() public {
        Request memory request = _request(true, false, LAUNCH_ID, NONCE);
        request.permit.chainId = 1;
        _expectBinding(request, 5);
        request.permit.chainId = block.chainid;
        request.permit.router = address(1);
        _expectBinding(request, 5);
    }

    function test_nonceReplayAcrossNewUninitializedPoolRejectedBeforeDeployment() public {
        Request memory first = _request(true, false, LAUNCH_ID, NONCE);
        _launch(first);
        Request memory second = _request(false, false, keccak256("second launch"), NONCE);
        vm.expectRevert(abi.encodeWithSelector(Router.NonceAlreadyUsed.selector, WALLET, NONCE));
        _launch(second);
        for (uint256 index; index < second.route.expectedOutputs.length; ++index) {
            assertEq(second.route.expectedOutputs[index].account.code.length, 0);
        }
        assertEq(router.launchStampV2(second.stamp.launchId).stampHash, bytes32(0));
    }

    function test_badObservedRuntimeRollsBackGraphAndPermitAndCorrectedRequestSucceeds() public {
        Request memory request = _request(true, false, LAUNCH_ID, NONCE);
        bytes32 actual = request.route.expectedOutputs[1].runtimeCodeHash;
        request.route.expectedOutputs[1].runtimeCodeHash = keccak256("wrong observed runtime");
        _component(request, request.route.expectedOutputs[1].account).runtimeCodeHash =
        request.route.expectedOutputs[1].runtimeCodeHash;
        request.route.expectedGraphDeploymentHash = _deploymentHash(request.route);
        _bind(request);
        vm.expectRevert(abi.encodeWithSelector(Router.FactoryResultMismatch.selector, uint8(1), uint256(0)));
        _launch(request);
        _assertUnconsumed(request);
        request.route.expectedOutputs[1].runtimeCodeHash = actual;
        _component(request, request.route.expectedOutputs[1].account).runtimeCodeHash = actual;
        request.route.expectedGraphDeploymentHash = _deploymentHash(request.route);
        _bind(request);
        _assertStamped(request, _launch(request));
    }

    function test_wrongInitializedPoolRollsBackAllDeploymentAndPoolState() public {
        Request memory request = _request(true, false, LAUNCH_ID, NONCE);
        PoolKey memory wrongKey = abi.decode(abi.encode(request.stamp.poolKey), (PoolKey));
        wrongKey.fee = 1;
        request.route.targets[1].initializerCalldata = abi.encodeCall(RouterV2TestInitializer.initialize, (wrongKey));
        _commit(request);
        _bind(request);
        _expectBinding(request, 31);
        (uint160 sqrtPriceX96,,,) = manager.getSlot0(wrongKey.toId());
        assertEq(sqrtPriceX96, 0);
    }

    function test_authorityRuntimeDriftFailsBeforeDeployment() public {
        Request memory request = _request(true, false, LAUNCH_ID, NONCE);
        vm.etch(address(authority), hex"00");
        vm.expectRevert(
            abi.encodeWithSelector(
                Router.InvalidComponent.selector,
                address(authority),
                router.PERMIT_AUTHORITY_RUNTIME_CODE_HASH(),
                address(authority).codehash
            )
        );
        _launch(request);
        _assertUnconsumed(request);
    }

    function test_forcedEtherRemainsIsolated() public {
        vm.deal(address(router), 7 ether);
        Request memory request = _request(true, false, LAUNCH_ID, NONCE);
        _launch(request);
        assertEq(address(router).balance, 7 ether);
        assertEq(request.route.expectedOutputs[1].account.balance, 1 ether);
        assertEq(address(graph).balance, 0);
    }

    function test_permitLifetimeAndValidityBoundaries() public {
        Request memory request = _request(true, false, LAUNCH_ID, NONCE);
        request.permit.deadline += 1;
        _expectBinding(request, 6);
        request.permit.deadline -= 1;
        vm.warp(request.permit.deadline + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                Router.PermitOutsideValidityWindow.selector,
                block.timestamp,
                request.permit.validAfter,
                request.permit.deadline
            )
        );
        _launch(request);
        _assertUnconsumed(request);
        vm.warp(request.permit.deadline);
        _assertStamped(request, _launch(request));
    }

    function _request(bool combined, bool selfInitializer, bytes32 launchId, bytes32 nonce)
        private
        returns (Request memory request)
    {
        require(combined || !selfInitializer, "self initializer requires combined fixture");
        uint256 length = combined ? (selfInitializer ? 1 : 2) : 3;
        request.route.routeNamespace = NAMESPACE;
        request.route.routeNonce = nonce;
        request.route.topologyHash = keccak256(abi.encode(combined, selfInitializer));
        request.route.targets = new IGraph.Target[](length);
        request.route.expectedOutputs = new IRouter.ExpectedGraphOutputV2[](length);
        request.stamp.components = new IRouter.ComponentV2[](length);
        request.stamp.launchId = launchId;

        bytes memory tokenCode = combined
            ? abi.encodePacked(type(RouterV2TestTokenHook).creationCode, abi.encode(manager, address(graph)))
            : type(RouterV2TestToken).creationCode;
        request.route.targets[0] = _target(keccak256("token"), tokenCode);
        if (!combined) {
            request.route.targets[1] = _target(
                keccak256("hook"), abi.encodePacked(type(RouterV2TestHook).creationCode, abi.encode(manager))
            );
        }
        if (!selfInitializer) {
            request.route.targets[length - 1] = _target(
                keccak256("initializer"),
                abi.encodePacked(type(RouterV2TestInitializer).creationCode, abi.encode(manager, address(graph)))
            );
        }
        for (uint256 index; index < length; ++index) {
            request.route.targets[index].applicantSalt =
                keccak256(abi.encode(request.route.targets[index].applicantSalt, request.route.topologyHash));
        }
        uint256 hookIndex = combined ? 0 : 1;
        Graph.GraphAuthorization memory authorization = _authorization(request.route);
        _mineHook(authorization, request.route.targets[hookIndex]);
        for (uint256 index; index < length; ++index) {
            address predicted = graph.predictTarget(authorization, _factoryTarget(request.route.targets[index]));
            bytes32 runtimeHash = combined && index == 0
                ? keccak256(type(RouterV2TestTokenHook).runtimeCode)
                : index == 0
                    ? keccak256(type(RouterV2TestToken).runtimeCode)
                    : index == hookIndex
                        ? keccak256(type(RouterV2TestHook).runtimeCode)
                        : keccak256(type(RouterV2TestInitializer).runtimeCode);
            request.route.expectedOutputs[index] = IRouter.ExpectedGraphOutputV2({
                targetIndex: uint8(index),
                targetIdHash: request.route.targets[index].targetIdHash,
                account: predicted,
                runtimeCodeHash: runtimeHash
            });
            request.stamp.components[index] = IRouter.ComponentV2({
                resultIndex: uint8(index),
                account: predicted,
                runtimeCodeHash: runtimeHash,
                roleMask: index == 0 ? (combined ? 3 : 1) : (index == hookIndex ? 2 : 0),
                scope: IRouter.ComponentScopeV2.Exclusive
            });
        }
        request.stamp.token = request.route.expectedOutputs[0].account;
        request.stamp.tokenRuntimeCodeHash = request.route.expectedOutputs[0].runtimeCodeHash;
        request.stamp.hookRuntimeCodeHash = request.route.expectedOutputs[hookIndex].runtimeCodeHash;
        request.stamp.poolKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(request.stamp.token),
            fee: 0,
            tickSpacing: 60,
            hooks: IHooks(request.route.expectedOutputs[hookIndex].account)
        });
        request.route.targets[length - 1].initializerValue = 1 ether;
        request.route.targets[length - 1].initializerCalldata = selfInitializer
            ? abi.encodeCall(RouterV2TestTokenHook.initializeSelf, (request.stamp.poolKey))
            : abi.encodeCall(RouterV2TestInitializer.initialize, (request.stamp.poolKey));
        _sort(request.stamp.components);
        _commit(request);
        request.permit = IRouter.LaunchPermitV2({
            chainId: block.chainid,
            router: address(router),
            launchWallet: WALLET,
            kind: IRouter.LaunchKindV2.CustomGraph,
            routePayloadHash: bytes32(0),
            expectedResultHash: bytes32(0),
            stampRequestHash: bytes32(0),
            nonce: nonce,
            validAfter: uint64(block.timestamp),
            deadline: uint64(block.timestamp + 1 hours),
            value: 1 ether
        });
        _bind(request);
    }

    function _target(bytes32 id, bytes memory creationCode) private pure returns (IGraph.Target memory) {
        return IGraph.Target({
            targetIdHash: id,
            applicantSalt: keccak256(abi.encode(id)),
            deploymentValue: 0,
            initializerValue: 0,
            initCode: creationCode,
            initializerCalldata: ""
        });
    }

    function _factoryTarget(IGraph.Target memory target) private pure returns (Graph.Target memory) {
        return abi.decode(abi.encode(target), (Graph.Target));
    }

    function _authorization(IRouter.CustomGraphRouteV2 memory route)
        private
        view
        returns (Graph.GraphAuthorization memory)
    {
        return Graph.GraphAuthorization({
            routeNamespace: route.routeNamespace,
            routeNonce: route.routeNonce,
            topologyHash: route.topologyHash,
            graphCommitment: route.graphCommitment,
            authorizedLauncher: address(router),
            totalValue: 1 ether
        });
    }

    function _mineHook(Graph.GraphAuthorization memory authorization, IGraph.Target memory target) private {
        // Only fixture generation is excluded from gas metering; the complete launch remains metered.
        vm.pauseGasMetering();
        bytes32 typehash = graph.TARGET_SALT_TYPEHASH();
        bytes32 initCodeHash = keccak256(target.initCode);
        for (uint256 attempt; attempt < 1_000_000; ++attempt) {
            bytes32 applicantSalt = bytes32(attempt);
            bytes32 salt = keccak256(
                abi.encode(
                    typehash,
                    block.chainid,
                    address(graph),
                    authorization.routeNamespace,
                    authorization.routeNonce,
                    target.targetIdHash,
                    applicantSalt,
                    authorization.authorizedLauncher
                )
            );
            address predicted =
                address(uint160(uint256(keccak256(abi.encodePacked(hex"ff", address(graph), salt, initCodeHash)))));
            if (uint160(predicted) & uint160((1 << 14) - 1) == uint160(1 << 13)) {
                target.applicantSalt = applicantSalt;
                vm.resumeGasMetering();
                return;
            }
        }
        revert("fixture hook salt not found");
    }

    function _commit(Request memory request) private view {
        Graph.Target[] memory targets = abi.decode(abi.encode(request.route.targets), (Graph.Target[]));
        (request.route.graphCommitment,) = graph.computeGraphCommitment(_authorization(request.route), targets);
        request.route.expectedGraphDeploymentHash = _deploymentHash(request.route);
    }

    function _deploymentHash(IRouter.CustomGraphRouteV2 memory route) private view returns (bytes32 accumulator) {
        accumulator = route.graphCommitment;
        Graph.GraphAuthorization memory authorization = _authorization(route);
        for (uint256 index; index < route.targets.length; ++index) {
            IGraph.Target memory target = route.targets[index];
            accumulator = keccak256(
                abi.encode(
                    graph.GRAPH_DEPLOYMENT_ACCUMULATOR_TYPEHASH(),
                    accumulator,
                    index,
                    target.targetIdHash,
                    route.expectedOutputs[index].account,
                    graph.effectiveTargetSalt(authorization, target.targetIdHash, target.applicantSalt),
                    keccak256(target.initCode),
                    keccak256(target.initializerCalldata),
                    route.expectedOutputs[index].runtimeCodeHash,
                    target.deploymentValue,
                    target.initializerValue
                )
            );
        }
    }

    function _bind(Request memory request) private {
        request.permit.routePayloadHash = keccak256(abi.encode(request.route));
        bytes32[] memory hashes = new bytes32[](request.route.expectedOutputs.length);
        for (uint256 index; index < hashes.length; ++index) {
            IRouter.ExpectedGraphOutputV2 memory output = request.route.expectedOutputs[index];
            hashes[index] = keccak256(
                abi.encode(
                    OUTPUT_TYPEHASH, output.targetIndex, output.targetIdHash, output.account, output.runtimeCodeHash
                )
            );
        }
        request.permit.expectedResultHash = keccak256(
            abi.encode(RESULT_TYPEHASH, keccak256(abi.encodePacked(hashes)), request.route.expectedGraphDeploymentHash)
        );
        request.permit.stampRequestHash = router.computeStampRequestHashV2(request.stamp);
        authority.allow(router.permitDigestV2(request.permit), true);
    }

    function _sort(IRouter.ComponentV2[] memory components) private pure {
        for (uint256 index = 1; index < components.length; ++index) {
            uint256 cursor = index;
            while (cursor != 0 && components[cursor].account < components[cursor - 1].account) {
                (components[cursor], components[cursor - 1]) = (components[cursor - 1], components[cursor]);
                --cursor;
            }
        }
    }

    function _component(Request memory request, address account)
        private
        pure
        returns (IRouter.ComponentV2 memory component)
    {
        for (uint256 index; index < request.stamp.components.length; ++index) {
            if (request.stamp.components[index].account == account) return request.stamp.components[index];
        }
        revert("missing fixture component");
    }

    function _launch(Request memory request) private returns (bytes32) {
        vm.prank(WALLET);
        return router.launchAndStampV2{ value: request.permit.value }(
            request.permit, request.stamp, abi.encode(request.route), hex"c0ffee"
        );
    }

    function _expectBinding(Request memory request, uint8 field) private {
        vm.expectRevert(abi.encodeWithSelector(Router.InvalidBinding.selector, field));
        _launch(request);
        _assertUnconsumed(request);
    }

    function _assertUnconsumed(Request memory request) private view {
        assertFalse(graph.consumedGraphAuthorization(graph.graphAuthorizationKey(_authorization(request.route))));
        for (uint256 index; index < request.route.expectedOutputs.length; ++index) {
            address account = request.route.expectedOutputs[index].account;
            assertEq(account.code.length, 0);
            assertEq(router.launchIdByComponent(account), bytes32(0));
        }
        assertEq(router.launchStampV2(request.stamp.launchId).stampHash, bytes32(0));
        (uint160 sqrtPriceX96,,,) = manager.getSlot0(request.stamp.poolKey.toId());
        assertEq(sqrtPriceX96, 0);
    }

    function _assertStamped(Request memory request, bytes32 stampHash) private view {
        assertNotEq(stampHash, bytes32(0));
        assertTrue(graph.consumedGraphAuthorization(graph.graphAuthorizationKey(_authorization(request.route))));
        assertEq(router.launchIdByToken(request.stamp.token), request.stamp.launchId);
        assertEq(
            router.launchIdByPool(address(manager), PoolId.unwrap(request.stamp.poolKey.toId())), request.stamp.launchId
        );
        IRouter.StampRecordV2 memory record = router.launchStampV2(request.stamp.launchId);
        assertEq(record.token, request.stamp.token);
        assertEq(record.hook, address(request.stamp.poolKey.hooks));
        assertEq(record.stampHash, stampHash);
        assertEq(record.routeLauncher, address(graph));
        assertEq(record.routeLauncherRuntimeCodeHash, address(graph).codehash);
        assertEq(record.expectedResultHash, request.permit.expectedResultHash);
        assertEq(record.componentSetHash, router.computeComponentSetHashV2(request.stamp.components));
        assertEq(record.permitDigest, router.permitDigestV2(request.permit));
        for (uint256 index; index < request.stamp.components.length; ++index) {
            IRouter.ComponentV2 memory component = request.stamp.components[index];
            assertEq(component.account.codehash, component.runtimeCodeHash);
            assertEq(router.componentRuntimeCodeHash(component.account), component.runtimeCodeHash);
            (bytes32 launchId, bytes32 proof) = router.stampProofV2(component.account);
            assertEq(launchId, request.stamp.launchId);
            assertEq(proof, stampHash);
        }
        (uint160 sqrtPriceX96,,,) = manager.getSlot0(request.stamp.poolKey.toId());
        assertEq(sqrtPriceX96, uint160(1 << 96));
        assertEq(request.route.expectedOutputs[request.route.targets.length - 1].account.balance, 1 ether);
        assertEq(address(router).balance, 0);
        assertEq(address(graph).balance, 0);
    }

    function _digest(IRouter.LaunchPermitV2 memory permit, bytes32 typehash, string memory version)
        private
        view
        returns (bytes32)
    {
        // The permit is entirely static; nested tuple encoding has the same contiguous field words.
        return _typedDigest(keccak256(abi.encode(typehash, permit)), version);
    }

    function _typedDigest(bytes32 structHash, string memory version) private view returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256("ProgrammableLaunchStampRouter"),
                keccak256(bytes(version)),
                block.chainid,
                address(router)
            )
        );
        return keccak256(abi.encodePacked(hex"1901", domain, structHash));
    }
}
