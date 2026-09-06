// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
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

/// @dev Synthetic preimages independently encoded by Solidity and the backend V2 codec.
///      These bytes are never sent to a deployment function or authority and make no executable-graph claim.
contract ProgrammableMultiRoleLaunchStampRouterV2GoldenTest is Test {
    using PoolIdLibrary for PoolKey;

    address private constant ROUTER = 0x1111111111111111111111111111111111111111;
    address private constant WALLET = 0x2222222222222222222222222222222222222222;
    address private constant TOKEN_HOOK = 0x3333333333333333333333333333333333333333;
    address private constant AUXILIARY = 0x4444444444444444444444444444444444444444;
    address private constant MANAGER = 0x5555555555555555555555555555555555555555;
    bytes32 private constant OUTPUT_TYPEHASH = keccak256(
        "ProgrammableExpectedGraphOutputV2(uint8 targetIndex,bytes32 targetIdHash,address account,bytes32 runtimeCodeHash)"
    );
    bytes32 private constant RESULT_TYPEHASH =
        keccak256("ProgrammableExpectedGraphResultV2(bytes32 expectedOutputsHash,bytes32 graphDeploymentHash)");
    bytes32 private constant PERMIT_TYPEHASH = keccak256(
        "ProgrammableLaunchPermitV2(uint256 chainId,address router,address launchWallet,uint8 kind,bytes32 routePayloadHash,bytes32 expectedResultHash,bytes32 stampRequestHash,bytes32 nonce,uint64 validAfter,uint64 deadline,uint256 value)"
    );
    bytes32 private constant STAMP_TYPEHASH = keccak256(
        "ProgrammableLaunchStampV2(uint256 chainId,address router,bytes32 launchId,address launchWallet,uint8 kind,bytes32 routePayloadHash,bytes32 expectedResultHash,bytes32 stampRequestHash,bytes32 permitDigest,address poolManager,bytes32 poolId)"
    );

    Router private router;

    function setUp() public {
        vm.chainId(4663);
        vm.etch(address(0xA1), hex"00");
        vm.etch(address(0xA2), hex"00");
        vm.etch(MANAGER, hex"00");
        Router deployed = new Router(address(0xA1), IGraph(address(0xA2)), IPoolManager(MANAGER));
        // EIP712 rebuilds the domain for this address; only read-only hashing helpers are called.
        vm.etch(ROUTER, address(deployed).code);
        router = Router(ROUTER);
    }

    function test_sharedBackendGoldenHashesAndEntireCalldata() public view {
        IRouter.CustomGraphRouteV2 memory route = _route();
        IRouter.StampRequestV2 memory stamp = _stamp();
        bytes memory routePayload = abi.encode(route);
        assertEq(routePayload.length, 1248);
        assertEq(keccak256(routePayload), 0x7d78477f8dc99a0405ea3dc1575fc5b6da1082eee48cc6c76d47eab68f0d707f);
        assertEq(
            router.computePoolKeyHashV2(stamp.poolKey),
            0xe95edffe275932c1bdf5d074b7e7595cae59e376a4b2f70d4c14d43d406163cb
        );
        assertEq(
            PoolId.unwrap(stamp.poolKey.toId()), 0x232b4f6865c0a96e4f1e95151bacbb5671998e98a80fe392bea655c088317d9b
        );
        assertEq(
            router.computeComponentSetHashV2(stamp.components),
            0x14fc3797c04f6545feee97940b6bf76cf79a933aba038de191445796101093b8
        );
        IRouter.LaunchPermitV2 memory permit = IRouter.LaunchPermitV2({
            chainId: 4663,
            router: ROUTER,
            launchWallet: WALLET,
            kind: IRouter.LaunchKindV2.CustomGraph,
            routePayloadHash: keccak256(routePayload),
            expectedResultHash: _expectedResultHash(route),
            stampRequestHash: router.computeStampRequestHashV2(stamp),
            nonce: route.routeNonce,
            validAfter: 1_700_000_000,
            deadline: 1_700_000_300,
            value: 26
        });
        assertEq(permit.expectedResultHash, 0xa736e1a4d9073fb69cdd277846a788ccc3767148674c69fe8755269b999a3e8c);
        assertEq(permit.stampRequestHash, 0xa146e3300d959ff5662be114fe669d092afbbbabd4cc7411120deac45301f663);
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, permit));
        assertEq(structHash, 0x82dcd1a93a6aa1953166eb15817d7a627c2acbc181c1dfa06969d4dfc9256058);
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ProgrammableLaunchStampRouter"),
                keccak256("2"),
                uint256(4663),
                ROUTER
            )
        );
        assertEq(domainSeparator, 0xd4505f53707527aa670d6dcd0c92716b9683f1314f57232aeb42906b82f71cd6);
        bytes32 digest = router.permitDigestV2(permit);
        assertEq(digest, keccak256(abi.encodePacked(hex"1901", domainSeparator, structHash)));
        assertEq(digest, 0x18478ea6e975c1807bb69085ef87a37f0a4fb2e19feea0a639376ccac4ec739c);
        bytes memory callData = abi.encodeCall(IRouter.launchAndStampV2, (permit, stamp, routePayload, hex"1234"));
        assertEq(bytes4(callData), bytes4(0x3d9895de));
        assertEq(callData.length, 2468);
        assertEq(keccak256(callData), 0xbe9e690375b1ef8dc78d9615eb634a5f3bff6d918b1e38b3fd6859721bafd773);
        assertEq(_stampHash(permit, stamp, digest), 0x1dfcece1dbfa89a4bc1178a94539471fb5bbe177f7dcd7bb7b1e26741172362f);
    }

    function _route() private pure returns (IRouter.CustomGraphRouteV2 memory route) {
        route.routeNamespace = _word(0xa1);
        route.routeNonce = _word(0xa2);
        route.topologyHash = _word(0xa3);
        route.graphCommitment = _word(0xa4);
        route.expectedGraphDeploymentHash = _word(0xe0);
        route.targets = new IGraph.Target[](2);
        route.targets[0] = IGraph.Target(_word(0xb0), _word(0xc0), 3, 5, hex"6000", hex"abcd");
        route.targets[1] = IGraph.Target(_word(0xb1), _word(0xc1), 7, 11, hex"6001600055", hex"");
        route.expectedOutputs = new IRouter.ExpectedGraphOutputV2[](2);
        route.expectedOutputs[0] = IRouter.ExpectedGraphOutputV2(0, _word(0xb0), TOKEN_HOOK, _word(0xd0));
        route.expectedOutputs[1] = IRouter.ExpectedGraphOutputV2(1, _word(0xb1), AUXILIARY, _word(0xd1));
    }

    function _stamp() private pure returns (IRouter.StampRequestV2 memory stamp) {
        stamp.launchId = _word(0xf0);
        stamp.token = TOKEN_HOOK;
        stamp.tokenRuntimeCodeHash = _word(0xd0);
        stamp.hookRuntimeCodeHash = _word(0xd0);
        stamp.poolKey = PoolKey(Currency.wrap(address(0)), Currency.wrap(TOKEN_HOOK), 3000, 60, IHooks(TOKEN_HOOK));
        stamp.components = new IRouter.ComponentV2[](2);
        stamp.components[0] = IRouter.ComponentV2(0, TOKEN_HOOK, _word(0xd0), 3, IRouter.ComponentScopeV2.Exclusive);
        stamp.components[1] = IRouter.ComponentV2(1, AUXILIARY, _word(0xd1), 0, IRouter.ComponentScopeV2.Exclusive);
    }

    function _word(uint8 byteValue) private pure returns (bytes32) {
        return bytes32(uint256(byteValue) * (type(uint256).max / 255));
    }

    function _expectedResultHash(IRouter.CustomGraphRouteV2 memory route) private pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](route.expectedOutputs.length);
        for (uint256 index; index < hashes.length; ++index) {
            hashes[index] = keccak256(abi.encode(OUTPUT_TYPEHASH, route.expectedOutputs[index]));
        }
        return keccak256(
            abi.encode(RESULT_TYPEHASH, keccak256(abi.encodePacked(hashes)), route.expectedGraphDeploymentHash)
        );
    }

    function _stampHash(IRouter.LaunchPermitV2 memory permit, IRouter.StampRequestV2 memory stamp, bytes32 digest)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                STAMP_TYPEHASH,
                uint256(4663),
                ROUTER,
                stamp.launchId,
                WALLET,
                uint8(permit.kind),
                permit.routePayloadHash,
                permit.expectedResultHash,
                permit.stampRequestHash,
                digest,
                MANAGER,
                PoolId.unwrap(stamp.poolKey.toId())
            )
        );
    }
}
