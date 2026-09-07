// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import { IProgrammableCreate2GraphDeployerV1 } from "../interfaces/IProgrammableCreate2GraphDeployerV1.sol";
import { IProgrammableMultiRoleLaunchStampRouterV2 } from "./IProgrammableMultiRoleLaunchStampRouterV2.sol";

/// @title ProgrammableMultiRoleLaunchStampRouterV2
/// @notice Executes one authority-permitted launch and writes its provenance stamp atomically.
/// @dev V2 supports one custom graph and one pool. A unique deployment can bear both token and hook roles.
///      Role masks describe provenance; they do not prove fees, initialization safety, or trade behavior.
///      The authority must bind those separate proofs to the exact V2 request. Classic remains on V1.
///      V1 graph deployment salts/commitments are reused, while every Router commitment and permit domain is V2.
///      A stamp proves origin through this exact Router. It is not an audit, safety, or tradability claim.
contract ProgrammableMultiRoleLaunchStampRouterV2 is
    IProgrammableMultiRoleLaunchStampRouterV2,
    EIP712,
    ReentrancyGuard
{
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint256 private constant MAX_CUSTOM_GRAPH_TARGETS = 16;
    uint64 private constant MAX_PERMIT_LIFETIME = 1 hours;
    string private constant EIP712_NAME = "ProgrammableLaunchStampRouter";
    string private constant EIP712_VERSION = "2";

    bytes32 private constant EXPECTED_GRAPH_OUTPUT_TYPEHASH = keccak256(
        "ProgrammableExpectedGraphOutputV2(uint8 targetIndex,bytes32 targetIdHash,address account,bytes32 runtimeCodeHash)"
    );
    bytes32 private constant COMPONENT_TYPEHASH = keccak256(
        "ProgrammableLaunchComponentV2(uint8 resultIndex,address account,bytes32 runtimeCodeHash,uint8 roleMask,uint8 scope)"
    );
    bytes32 private constant POOL_KEY_TYPEHASH = keccak256(
        "ProgrammablePoolKeyV2(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)"
    );
    bytes32 private constant STAMP_REQUEST_TYPEHASH = keccak256(
        "ProgrammableStampRequestV2(bytes32 launchId,address token,bytes32 tokenRuntimeCodeHash,bytes32 poolKeyHash,bytes32 hookRuntimeCodeHash,bytes32 componentSetHash)"
    );
    bytes32 private constant EXPECTED_GRAPH_RESULT_TYPEHASH =
        keccak256("ProgrammableExpectedGraphResultV2(bytes32 expectedOutputsHash,bytes32 graphDeploymentHash)");
    bytes32 private constant LAUNCH_PERMIT_TYPEHASH = keccak256(
        "ProgrammableLaunchPermitV2(uint256 chainId,address router,address launchWallet,uint8 kind,bytes32 routePayloadHash,bytes32 expectedResultHash,bytes32 stampRequestHash,bytes32 nonce,uint64 validAfter,uint64 deadline,uint256 value)"
    );
    bytes32 private constant LAUNCH_STAMP_TYPEHASH = keccak256(
        "ProgrammableLaunchStampV2(uint256 chainId,address router,bytes32 launchId,address launchWallet,uint8 kind,bytes32 routePayloadHash,bytes32 expectedResultHash,bytes32 stampRequestHash,bytes32 permitDigest,address poolManager,bytes32 poolId)"
    );

    uint8 private constant BIND_PERMIT_AUTHORITY = 1;
    uint8 private constant BIND_GRAPH_FACTORY = 2;
    uint8 private constant BIND_POOL_MANAGER = 3;
    uint8 private constant BIND_COLLISION = 4;
    uint8 private constant BIND_PERMIT_ENVELOPE = 5;
    uint8 private constant BIND_PERMIT_LIFETIME = 6;
    uint8 private constant BIND_OBSERVED_RESULT = 7;
    uint8 private constant BIND_GRAPH_AUTHORIZATION = 21;
    uint8 private constant BIND_EXPECTED_RESULT = 22;
    uint8 private constant BIND_EXPECTED_OUTPUT = 23;
    uint8 private constant BIND_DUPLICATE_OUTPUT = 24;
    uint8 private constant BIND_EXCLUSIVE_COMPONENT_SET = 25;
    uint8 private constant BIND_TOKEN_COMPONENT = 26;
    uint8 private constant BIND_HOOK_COMPONENT = 27;
    uint8 private constant BIND_COMPONENT_KIND = 28;
    uint8 private constant BIND_REQUIRED_COMPONENTS = 29;
    uint8 private constant BIND_POOL_KEY = 30;
    uint8 private constant BIND_POOL_UNINITIALIZED = 31;
    uint8 private constant BIND_RESULT_WRITE = 32;
    uint8 private constant BIND_MISSING_RESULT_COMPONENT = 33;

    uint8 private constant ARRAY_GRAPH_TARGETS = 2;
    uint8 private constant ARRAY_GRAPH_OUTPUTS = 3;
    uint8 private constant ARRAY_GRAPH_COMPONENTS = 4;

    uint8 private constant RESULT_ENVELOPE = 1;
    uint8 private constant RESULT_DEPLOYMENT = 2;
    uint8 private constant RESULT_COMPONENT = 3;

    address public immutable PERMIT_AUTHORITY;
    bytes32 public immutable PERMIT_AUTHORITY_RUNTIME_CODE_HASH;
    IProgrammableCreate2GraphDeployerV1 public immutable GRAPH_FACTORY;
    bytes32 public immutable GRAPH_FACTORY_RUNTIME_CODE_HASH;
    IPoolManager public immutable POOL_MANAGER;
    bytes32 public immutable POOL_MANAGER_RUNTIME_CODE_HASH;
    uint256 public immutable CHAIN_ID;

    mapping(bytes32 launchId => StampRecordV2 record) private _launchStamp;
    mapping(address token => bytes32 launchId) public override launchIdByToken;
    mapping(address component => bytes32 launchId) public override launchIdByComponent;
    mapping(address component => bytes32 runtimeCodeHash) public override componentRuntimeCodeHash;
    mapping(address launchWallet => mapping(bytes32 nonce => bool used)) private _usedNonce;
    mapping(bytes32 permitDigest => bool used) private _usedPermitDigest;
    mapping(bytes32 poolLookupKey => bytes32 launchId) private _launchIdByPool;

    struct GraphExecutionV2 {
        address[] deployments;
        bytes32[] runtimeCodeHashes;
        bytes[] runtimeCodes;
        bytes32 graphDeploymentHash;
    }

    struct RouteExecutionV2 {
        bytes32 observedResultHash;
        address launcher;
        bytes32 launcherRuntimeCodeHash;
    }

    struct ValidatedMarketV2 {
        address hook;
        bytes32 poolId;
        bytes32 poolKeyHash;
        bytes32 componentSetHash;
    }

    error ComponentAlreadyStamped(address component, bytes32 launchId);
    error DuplicateOrUnsortedComponent(address previous, address current);
    error FactoryResultMismatch(uint8 field, uint256 index);
    error ForbiddenRuntimeOpcode(uint256 targetIndex, uint256 programCounter, uint8 opcode);
    error InvalidArrayLength(uint8 field, uint256 actual, uint256 expected);
    error InvalidBinding(uint8 field);
    error InvalidComponent(address component, bytes32 supplied, bytes32 actual);
    error InvalidRoleMask(address component, uint8 roleMask);
    error InvalidPermitSignature();
    error LaunchAlreadyStamped(bytes32 launchId);
    error NonCanonicalRoutePayload();
    error NonceAlreadyUsed(address launchWallet, bytes32 nonce);
    error PermitAlreadyUsed(bytes32 permitDigest);
    error PermitOutsideValidityWindow(uint256 timestamp, uint256 validAfter, uint256 deadline);
    error PoolAlreadyStamped(address poolManager, bytes32 poolId, bytes32 launchId);
    error PoolAlreadyInitialized(address poolManager, bytes32 poolId);
    error ResidualLaunchValue(uint256 expected, uint256 actual);
    error UnauthorizedLaunchWallet(address caller, address launchWallet);
    error UnsupportedLaunchKind(LaunchKindV2 kind);

    constructor(address permitAuthority, IProgrammableCreate2GraphDeployerV1 graphFactory, IPoolManager poolManager)
        EIP712(EIP712_NAME, EIP712_VERSION)
    {
        _requireCode(BIND_PERMIT_AUTHORITY, permitAuthority);
        _requireCode(BIND_GRAPH_FACTORY, address(graphFactory));
        _requireCode(BIND_POOL_MANAGER, address(poolManager));
        if (
            permitAuthority == address(graphFactory) || permitAuthority == address(poolManager)
                || address(graphFactory) == address(poolManager)
        ) revert InvalidBinding(BIND_COLLISION);

        PERMIT_AUTHORITY = permitAuthority;
        PERMIT_AUTHORITY_RUNTIME_CODE_HASH = permitAuthority.codehash;
        GRAPH_FACTORY = graphFactory;
        GRAPH_FACTORY_RUNTIME_CODE_HASH = address(graphFactory).codehash;
        POOL_MANAGER = poolManager;
        POOL_MANAGER_RUNTIME_CODE_HASH = address(poolManager).codehash;
        CHAIN_ID = block.chainid;
    }

    /// @notice The Router's sole market-bearing entry point.
    function launchAndStampV2(
        LaunchPermitV2 calldata permit,
        StampRequestV2 calldata stampRequest,
        bytes calldata routePayload,
        bytes calldata signature
    ) external payable override nonReentrant returns (bytes32 stampHash) {
        uint256 preexistingBalance = address(this).balance - msg.value;
        _validatePermitEnvelope(permit, stampRequest, routePayload);
        bytes32 digest = permitDigestV2(permit);
        if (_usedPermitDigest[digest]) revert PermitAlreadyUsed(digest);
        if (_usedNonce[permit.launchWallet][permit.nonce]) {
            revert NonceAlreadyUsed(permit.launchWallet, permit.nonce);
        }
        if (!SignatureChecker.isValidERC1271SignatureNow(PERMIT_AUTHORITY, digest, signature)) {
            revert InvalidPermitSignature();
        }

        _usedPermitDigest[digest] = true;
        _usedNonce[permit.launchWallet][permit.nonce] = true;

        RouteExecutionV2 memory execution;
        if (permit.kind == LaunchKindV2.CustomGraph) {
            execution.observedResultHash = _executeCustomGraph(routePayload, stampRequest, permit);
            execution.launcher = address(GRAPH_FACTORY);
            execution.launcherRuntimeCodeHash = GRAPH_FACTORY_RUNTIME_CODE_HASH;
        } else {
            revert UnsupportedLaunchKind(permit.kind);
        }

        ValidatedMarketV2 memory market = _validateMarket(stampRequest);
        stampHash = _stampHash(permit, stampRequest.launchId, market.poolId, digest);
        _writeStamp(permit, stampRequest, market, execution, digest, stampHash);

        if (address(this).balance != preexistingBalance) {
            revert ResidualLaunchValue(preexistingBalance, address(this).balance);
        }
    }

    function permitDigestV2(LaunchPermitV2 calldata permit) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    LAUNCH_PERMIT_TYPEHASH,
                    permit.chainId,
                    permit.router,
                    permit.launchWallet,
                    uint8(permit.kind),
                    permit.routePayloadHash,
                    permit.expectedResultHash,
                    permit.stampRequestHash,
                    permit.nonce,
                    permit.validAfter,
                    permit.deadline,
                    permit.value
                )
            )
        );
    }

    function computeStampRequestHashV2(StampRequestV2 calldata request) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                STAMP_REQUEST_TYPEHASH,
                request.launchId,
                request.token,
                request.tokenRuntimeCodeHash,
                computePoolKeyHashV2(request.poolKey),
                request.hookRuntimeCodeHash,
                computeComponentSetHashV2(request.components)
            )
        );
    }

    function computeComponentSetHashV2(ComponentV2[] calldata components) public pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](components.length);
        address previous;
        for (uint256 index; index < components.length; ++index) {
            ComponentV2 calldata component = components[index];
            if (component.account == address(0) || (index != 0 && component.account <= previous)) {
                revert DuplicateOrUnsortedComponent(previous, component.account);
            }
            if (component.roleMask > 3) revert InvalidRoleMask(component.account, component.roleMask);
            previous = component.account;
            hashes[index] = keccak256(
                abi.encode(
                    COMPONENT_TYPEHASH,
                    component.resultIndex,
                    component.account,
                    component.runtimeCodeHash,
                    component.roleMask,
                    uint8(component.scope)
                )
            );
        }
        return keccak256(abi.encodePacked(hashes));
    }

    function computePoolKeyHashV2(PoolKey calldata poolKey) public pure returns (bytes32) {
        return _poolKeyHash(poolKey);
    }

    function launchIdByPool(address poolManager, bytes32 poolId) external view override returns (bytes32) {
        return _launchIdByPool[_poolLookupKey(poolManager, poolId)];
    }

    function launchStampV2(bytes32 launchId) external view override returns (StampRecordV2 memory) {
        return _launchStamp[launchId];
    }

    function stampProofV2(address component) external view override returns (bytes32 launchId, bytes32 stampHash) {
        launchId = launchIdByComponent[component];
        if (launchId != bytes32(0)) stampHash = _launchStamp[launchId].stampHash;
    }

    function _validatePermitEnvelope(
        LaunchPermitV2 calldata permit,
        StampRequestV2 calldata stampRequest,
        bytes calldata routePayload
    ) private view {
        _requireRuntime(PERMIT_AUTHORITY, PERMIT_AUTHORITY_RUNTIME_CODE_HASH);
        _requireRuntime(address(GRAPH_FACTORY), GRAPH_FACTORY_RUNTIME_CODE_HASH);
        _requireRuntime(address(POOL_MANAGER), POOL_MANAGER_RUNTIME_CODE_HASH);
        if (msg.sender != permit.launchWallet || permit.launchWallet == address(0)) {
            revert UnauthorizedLaunchWallet(msg.sender, permit.launchWallet);
        }
        if (
            permit.chainId != CHAIN_ID || block.chainid != CHAIN_ID || permit.router != address(this)
                || permit.kind == LaunchKindV2.Invalid || permit.routePayloadHash != keccak256(routePayload)
                || permit.stampRequestHash != computeStampRequestHashV2(stampRequest) || permit.value != msg.value
                || permit.nonce == bytes32(0) || stampRequest.launchId == bytes32(0)
        ) revert InvalidBinding(BIND_PERMIT_ENVELOPE);
        if (
            block.timestamp < permit.validAfter || block.timestamp > permit.deadline
                || permit.validAfter > permit.deadline
        ) revert PermitOutsideValidityWindow(block.timestamp, permit.validAfter, permit.deadline);
        if (permit.deadline - permit.validAfter > MAX_PERMIT_LIFETIME) {
            revert InvalidBinding(BIND_PERMIT_LIFETIME);
        }
        if (_launchStamp[stampRequest.launchId].stampHash != bytes32(0)) {
            revert LaunchAlreadyStamped(stampRequest.launchId);
        }
        PoolId poolId = stampRequest.poolKey.toId();
        (uint160 sqrtPriceX96,,,) = POOL_MANAGER.getSlot0(poolId);
        if (sqrtPriceX96 != 0) revert PoolAlreadyInitialized(address(POOL_MANAGER), PoolId.unwrap(poolId));
        bytes32 existingPoolLaunchId = _launchIdByPool[_poolLookupKey(address(POOL_MANAGER), PoolId.unwrap(poolId))];
        if (existingPoolLaunchId != bytes32(0)) {
            revert PoolAlreadyStamped(address(POOL_MANAGER), PoolId.unwrap(poolId), existingPoolLaunchId);
        }
    }

    function _executeCustomGraph(
        bytes calldata routePayload,
        StampRequestV2 calldata stampRequest,
        LaunchPermitV2 calldata permit
    ) private returns (bytes32 observedResultHash) {
        CustomGraphRouteV2 memory route = _decodeCustomGraphRoute(routePayload);
        _validateCustomGraphShape(route, stampRequest, permit);
        IProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization =
            _authorization(route, permit.value);

        GraphExecutionV2 memory execution;
        (execution.deployments, execution.runtimeCodeHashes, execution.runtimeCodes, execution.graphDeploymentHash) =
            GRAPH_FACTORY.deployGraph{ value: permit.value }(authorization, route.targets);

        _validateGraphExecution(route, stampRequest, execution);
        observedResultHash = _expectedGraphResultHash(route.expectedOutputs, execution.graphDeploymentHash);
        if (observedResultHash != permit.expectedResultHash) revert InvalidBinding(BIND_OBSERVED_RESULT);
    }

    function _decodeCustomGraphRoute(bytes calldata routePayload)
        private
        pure
        returns (CustomGraphRouteV2 memory route)
    {
        route = abi.decode(routePayload, (CustomGraphRouteV2));
        if (keccak256(routePayload) != keccak256(abi.encode(route))) revert NonCanonicalRoutePayload();
    }

    function _authorization(CustomGraphRouteV2 memory route, uint256 value)
        private
        view
        returns (IProgrammableCreate2GraphDeployerV1.GraphAuthorization memory)
    {
        return IProgrammableCreate2GraphDeployerV1.GraphAuthorization({
            routeNamespace: route.routeNamespace,
            routeNonce: route.routeNonce,
            topologyHash: route.topologyHash,
            graphCommitment: route.graphCommitment,
            authorizedLauncher: address(this),
            totalValue: value
        });
    }

    function _validateCustomGraphShape(
        CustomGraphRouteV2 memory route,
        StampRequestV2 calldata stampRequest,
        LaunchPermitV2 calldata permit
    ) private view {
        uint256 length = route.targets.length;
        if (length == 0 || length > MAX_CUSTOM_GRAPH_TARGETS) {
            revert InvalidArrayLength(ARRAY_GRAPH_TARGETS, length, MAX_CUSTOM_GRAPH_TARGETS);
        }
        if (route.expectedOutputs.length != length) {
            revert InvalidArrayLength(ARRAY_GRAPH_OUTPUTS, route.expectedOutputs.length, length);
        }
        if (stampRequest.components.length != length) {
            revert InvalidArrayLength(ARRAY_GRAPH_COMPONENTS, stampRequest.components.length, length);
        }
        if (
            route.routeNamespace == bytes32(0) || route.routeNonce != permit.nonce || route.topologyHash == bytes32(0)
                || route.graphCommitment == bytes32(0) || route.expectedGraphDeploymentHash == bytes32(0)
        ) revert InvalidBinding(BIND_GRAPH_AUTHORIZATION);

        bytes32 expectedResultHash = _expectedGraphResultHash(route.expectedOutputs, route.expectedGraphDeploymentHash);
        if (expectedResultHash != permit.expectedResultHash) revert InvalidBinding(BIND_EXPECTED_RESULT);

        bool[] memory targetSeen = new bool[](length);
        bool foundToken;
        bool foundHook;
        address hook = address(stampRequest.poolKey.hooks);
        for (uint256 index; index < length; ++index) {
            ExpectedGraphOutputV2 memory output = route.expectedOutputs[index];
            if (
                output.targetIndex != index || output.targetIdHash != route.targets[index].targetIdHash
                    || output.account == address(0) || output.runtimeCodeHash == bytes32(0)
            ) revert InvalidBinding(BIND_EXPECTED_OUTPUT);
            for (uint256 prior; prior < index; ++prior) {
                if (route.expectedOutputs[prior].account == output.account) {
                    revert InvalidBinding(BIND_DUPLICATE_OUTPUT);
                }
            }

            ComponentV2 calldata component = stampRequest.components[index];
            uint256 targetIndex = component.resultIndex;
            if (
                targetIndex >= length || targetSeen[targetIndex] || component.scope != ComponentScopeV2.Exclusive
                    || component.account != route.expectedOutputs[targetIndex].account
                    || component.runtimeCodeHash != route.expectedOutputs[targetIndex].runtimeCodeHash
                    || component.account == address(GRAPH_FACTORY) || component.account == address(POOL_MANAGER)
            ) revert InvalidBinding(BIND_EXCLUSIVE_COMPONENT_SET);
            targetSeen[targetIndex] = true;
            bytes32 existingLaunchId = launchIdByComponent[component.account];
            if (existingLaunchId != bytes32(0)) revert ComponentAlreadyStamped(component.account, existingLaunchId);

            uint8 expectedRoleMask;
            if (component.account == stampRequest.token) {
                if (component.runtimeCodeHash != stampRequest.tokenRuntimeCodeHash) {
                    revert InvalidBinding(BIND_TOKEN_COMPONENT);
                }
                expectedRoleMask |= 1;
                foundToken = true;
            }
            if (component.account == hook) {
                if (component.runtimeCodeHash != stampRequest.hookRuntimeCodeHash) {
                    revert InvalidBinding(BIND_HOOK_COMPONENT);
                }
                expectedRoleMask |= 2;
                foundHook = true;
            }
            if (component.roleMask != expectedRoleMask) revert InvalidBinding(BIND_COMPONENT_KIND);
        }
        if (!foundToken || !foundHook) {
            revert InvalidBinding(BIND_REQUIRED_COMPONENTS);
        }
    }

    function _validateGraphExecution(
        CustomGraphRouteV2 memory route,
        StampRequestV2 calldata stampRequest,
        GraphExecutionV2 memory execution
    ) private view {
        uint256 length = route.expectedOutputs.length;
        if (
            execution.deployments.length != length || execution.runtimeCodeHashes.length != length
                || execution.runtimeCodes.length != length
                || execution.graphDeploymentHash != route.expectedGraphDeploymentHash
        ) revert FactoryResultMismatch(RESULT_ENVELOPE, 0);

        for (uint256 index; index < length; ++index) {
            ExpectedGraphOutputV2 memory expected = route.expectedOutputs[index];
            if (
                execution.deployments[index] != expected.account
                    || execution.runtimeCodeHashes[index] != expected.runtimeCodeHash
                    || keccak256(execution.runtimeCodes[index]) != expected.runtimeCodeHash
                    || expected.account.code.length == 0 || expected.account.codehash != expected.runtimeCodeHash
            ) revert FactoryResultMismatch(RESULT_DEPLOYMENT, index);

            _validateRuntimeOpcodes(index, execution.runtimeCodes[index]);

            ComponentV2 calldata component = _componentByResultIndex(stampRequest.components, uint8(index));
            if (component.account != expected.account || component.runtimeCodeHash != expected.runtimeCodeHash) {
                revert FactoryResultMismatch(RESULT_COMPONENT, index);
            }
        }
    }

    /// @dev Applies to every hash-matched graph target, including auxiliary outputs. PUSH immediates are data.
    ///      This linear scan rejects destruction and delegated execution in runtime code; it does not prove
    ///      constructor behavior, external CALL dependencies, initialization safety, or economic properties.
    ///      Trusted exact constructor/source admission remains required; this is not a post-transaction liveness proof.
    function _validateRuntimeOpcodes(uint256 targetIndex, bytes memory runtimeCode) internal pure virtual {
        uint256 length = runtimeCode.length;
        for (uint256 pc; pc < length;) {
            uint8 opcode = uint8(runtimeCode[pc]);
            if (opcode == 0xff || opcode == 0xf2 || opcode == 0xf4) {
                revert ForbiddenRuntimeOpcode(targetIndex, pc, opcode);
            }
            // Truncated PUSH data is still data; the cursor may pass the byte-array end.
            pc += opcode >= 0x60 && opcode <= 0x7f ? uint256(opcode) - 0x5f + 1 : 1;
        }
    }

    function _validateMarket(StampRequestV2 calldata request) private view returns (ValidatedMarketV2 memory market) {
        market.hook = address(request.poolKey.hooks);
        address currency0 = Currency.unwrap(request.poolKey.currency0);
        address currency1 = Currency.unwrap(request.poolKey.currency1);
        if (
            currency0 >= currency1 || request.token == address(0) || market.hook == address(0)
                || (request.token != currency0 && request.token != currency1)
        ) revert InvalidBinding(BIND_POOL_KEY);

        _requireRuntime(request.token, request.tokenRuntimeCodeHash);
        _requireRuntime(market.hook, request.hookRuntimeCodeHash);
        for (uint256 index; index < request.components.length; ++index) {
            _requireRuntime(request.components[index].account, request.components[index].runtimeCodeHash);
        }

        PoolId poolId = request.poolKey.toId();
        market.poolId = PoolId.unwrap(poolId);
        (uint160 sqrtPriceX96,,,) = POOL_MANAGER.getSlot0(poolId);
        if (sqrtPriceX96 == 0) revert InvalidBinding(BIND_POOL_UNINITIALIZED);
        bytes32 existingPoolLaunchId = _launchIdByPool[_poolLookupKey(address(POOL_MANAGER), market.poolId)];
        if (existingPoolLaunchId != bytes32(0)) {
            revert PoolAlreadyStamped(address(POOL_MANAGER), market.poolId, existingPoolLaunchId);
        }
        bytes32 existingTokenLaunchId = launchIdByToken[request.token];
        if (existingTokenLaunchId != bytes32(0)) {
            revert ComponentAlreadyStamped(request.token, existingTokenLaunchId);
        }
        market.poolKeyHash = computePoolKeyHashV2(request.poolKey);
        market.componentSetHash = computeComponentSetHashV2(request.components);
    }

    function _stampHash(LaunchPermitV2 calldata permit, bytes32 launchId, bytes32 poolId, bytes32 digest)
        private
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                LAUNCH_STAMP_TYPEHASH,
                CHAIN_ID,
                address(this),
                launchId,
                permit.launchWallet,
                uint8(permit.kind),
                permit.routePayloadHash,
                permit.expectedResultHash,
                permit.stampRequestHash,
                digest,
                address(POOL_MANAGER),
                poolId
            )
        );
    }

    function _writeStamp(
        LaunchPermitV2 calldata permit,
        StampRequestV2 calldata request,
        ValidatedMarketV2 memory market,
        RouteExecutionV2 memory execution,
        bytes32 digest,
        bytes32 stampHash
    ) private {
        if (execution.observedResultHash != permit.expectedResultHash) {
            revert InvalidBinding(BIND_RESULT_WRITE);
        }
        _launchStamp[request.launchId] = StampRecordV2({
            kind: permit.kind,
            launchWallet: permit.launchWallet,
            token: request.token,
            hook: market.hook,
            poolManager: address(POOL_MANAGER),
            poolId: market.poolId,
            poolKeyHash: market.poolKeyHash,
            componentSetHash: market.componentSetHash,
            routePayloadHash: permit.routePayloadHash,
            routeLauncher: execution.launcher,
            routeLauncherRuntimeCodeHash: execution.launcherRuntimeCodeHash,
            expectedResultHash: permit.expectedResultHash,
            permitDigest: digest,
            stampHash: stampHash
        });
        launchIdByToken[request.token] = request.launchId;
        _launchIdByPool[_poolLookupKey(address(POOL_MANAGER), market.poolId)] = request.launchId;

        for (uint256 index; index < request.components.length; ++index) {
            ComponentV2 calldata component = request.components[index];
            if (component.scope == ComponentScopeV2.Exclusive) {
                launchIdByComponent[component.account] = request.launchId;
                componentRuntimeCodeHash[component.account] = component.runtimeCodeHash;
            }
            emit ProgrammableComponentStampedV2(
                request.launchId, component.account, component.roleMask, component.runtimeCodeHash
            );
        }
        emit ProgrammableLaunchRouteStampedV2(
            request.launchId, permit.kind, permit.routePayloadHash, permit.expectedResultHash, digest
        );
        emit ProgrammableLaunchStampedV2(
            request.launchId, request.token, market.hook, address(POOL_MANAGER), market.poolId, stampHash
        );
    }

    function _expectedGraphResultHash(ExpectedGraphOutputV2[] memory outputs, bytes32 graphDeploymentHash)
        private
        pure
        returns (bytes32)
    {
        bytes32[] memory outputHashes = new bytes32[](outputs.length);
        for (uint256 index; index < outputs.length; ++index) {
            ExpectedGraphOutputV2 memory output = outputs[index];
            outputHashes[index] = keccak256(
                abi.encode(
                    EXPECTED_GRAPH_OUTPUT_TYPEHASH,
                    output.targetIndex,
                    output.targetIdHash,
                    output.account,
                    output.runtimeCodeHash
                )
            );
        }
        return keccak256(
            abi.encode(EXPECTED_GRAPH_RESULT_TYPEHASH, keccak256(abi.encodePacked(outputHashes)), graphDeploymentHash)
        );
    }

    function _poolKeyHash(PoolKey memory poolKey) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                POOL_KEY_TYPEHASH,
                Currency.unwrap(poolKey.currency0),
                Currency.unwrap(poolKey.currency1),
                poolKey.fee,
                poolKey.tickSpacing,
                address(poolKey.hooks)
            )
        );
    }

    function _componentByResultIndex(ComponentV2[] calldata components, uint8 resultIndex)
        private
        pure
        returns (ComponentV2 calldata component)
    {
        for (uint256 index; index < components.length; ++index) {
            if (components[index].resultIndex == resultIndex) return components[index];
        }
        revert InvalidBinding(BIND_MISSING_RESULT_COMPONENT);
    }

    function _requireCode(uint8 field, address account) private view {
        if (account == address(0) || account.code.length == 0) revert InvalidBinding(field);
    }

    function _requireRuntime(address account, bytes32 expected) private view {
        bytes32 actual = account.codehash;
        if (account.code.length == 0 || expected == bytes32(0) || actual != expected) {
            revert InvalidComponent(account, expected, actual);
        }
    }

    function _poolLookupKey(address poolManager, bytes32 poolId) private pure returns (bytes32) {
        return keccak256(abi.encode(poolManager, poolId));
    }
}
