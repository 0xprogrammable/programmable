// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { IProgrammableCreate2GraphDeployerV1 } from "../interfaces/IProgrammableCreate2GraphDeployerV1.sol";

interface IProgrammableMultiRoleLaunchStampRouterV2 {
    enum LaunchKindV2 {
        Invalid,
        CustomGraph
    }

    enum ComponentScopeV2 {
        Invalid,
        Exclusive
    }

    struct ExpectedGraphOutputV2 {
        uint8 targetIndex;
        bytes32 targetIdHash;
        address account;
        bytes32 runtimeCodeHash;
    }

    struct CustomGraphRouteV2 {
        bytes32 routeNamespace;
        bytes32 routeNonce;
        bytes32 topologyHash;
        bytes32 graphCommitment;
        IProgrammableCreate2GraphDeployerV1.Target[] targets;
        ExpectedGraphOutputV2[] expectedOutputs;
        bytes32 expectedGraphDeploymentHash;
    }

    /// @dev roleMask: 0 auxiliary, 1 token, 2 hook, 3 token+hook. Unknown bits are invalid.
    struct ComponentV2 {
        uint8 resultIndex;
        address account;
        bytes32 runtimeCodeHash;
        uint8 roleMask;
        ComponentScopeV2 scope;
    }

    struct StampRequestV2 {
        bytes32 launchId;
        address token;
        bytes32 tokenRuntimeCodeHash;
        PoolKey poolKey;
        bytes32 hookRuntimeCodeHash;
        ComponentV2[] components;
    }

    struct LaunchPermitV2 {
        uint256 chainId;
        address router;
        address launchWallet;
        LaunchKindV2 kind;
        bytes32 routePayloadHash;
        bytes32 expectedResultHash;
        bytes32 stampRequestHash;
        bytes32 nonce;
        uint64 validAfter;
        uint64 deadline;
        uint256 value;
    }

    struct StampRecordV2 {
        LaunchKindV2 kind;
        address launchWallet;
        address token;
        address hook;
        address poolManager;
        bytes32 poolId;
        bytes32 poolKeyHash;
        bytes32 componentSetHash;
        bytes32 routePayloadHash;
        address routeLauncher;
        bytes32 routeLauncherRuntimeCodeHash;
        bytes32 expectedResultHash;
        bytes32 permitDigest;
        bytes32 stampHash;
    }

    event ProgrammableLaunchStampedV2(
        bytes32 indexed launchId,
        address indexed token,
        address indexed hook,
        address poolManager,
        bytes32 poolId,
        bytes32 stampHash
    );

    event ProgrammableLaunchRouteStampedV2(
        bytes32 indexed launchId,
        LaunchKindV2 indexed kind,
        bytes32 indexed routePayloadHash,
        bytes32 expectedResultHash,
        bytes32 permitDigest
    );

    event ProgrammableComponentStampedV2(
        bytes32 indexed launchId, address indexed component, uint8 indexed roleMask, bytes32 runtimeCodeHash
    );

    function launchAndStampV2(
        LaunchPermitV2 calldata permit,
        StampRequestV2 calldata stampRequest,
        bytes calldata routePayload,
        bytes calldata signature
    ) external payable returns (bytes32 stampHash);

    function launchStampV2(bytes32 launchId) external view returns (StampRecordV2 memory);

    function launchIdByToken(address token) external view returns (bytes32 launchId);

    function launchIdByPool(address poolManager, bytes32 poolId) external view returns (bytes32 launchId);

    function launchIdByComponent(address component) external view returns (bytes32 launchId);

    function componentRuntimeCodeHash(address component) external view returns (bytes32 runtimeCodeHash);

    function stampProofV2(address component) external view returns (bytes32 launchId, bytes32 stampHash);
}
