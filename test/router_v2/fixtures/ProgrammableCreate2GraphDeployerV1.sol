// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title ProgrammableCreate2GraphDeployerV1
/// @notice Canonical atomic CREATE2 deployment route for reviewed multi-contract Programmable projects.
/// @dev Target addresses are derived from a pre-graph route namespace and target salts, not from the graph
///      commitment. This avoids an impossible fixed point when an acyclic constructor dependency embeds another
///      target's predicted address. The offchain compiler must topologically validate constructor dependencies;
///      mutual cycles must be moved to the post-deployment initializer phase. All targets deploy first, then all
///      initializers execute in reviewed order. Any constructor, deployment, initializer, runtime, value, or event
///      failure reverts the complete graph. Runtime bytes/hashes are observed after initialization and intentionally
///      remain outside the pre-salt graph commitment. A factory event is evidence only; the separately signed permit
///      and strict post-issuance finality pipeline decide whether a matching transaction is an official launch.
///      There is no receive function, administrator, upgrade, or sweep. Forced ETH remains inert and is never added
///      to the exact `msg.value` distributed across the current graph.
contract ProgrammableCreate2GraphDeployerV1 {
    uint256 public constant MAX_TARGETS = 16;
    uint256 public constant MAX_TOTAL_INPUT_BYTES = 524_288;
    uint256 public constant MAX_TARGET_INIT_CODE_BYTES = 49_152;
    uint256 public constant MAX_TARGET_INITIALIZER_BYTES = 131_072;
    uint256 public constant MAX_INITIALIZER_REVERT_BYTES = 2048;

    bytes32 public constant GRAPH_TARGET_COMMITMENT_TYPEHASH = keccak256(
        "ProgrammableCreate2GraphTargetCommitmentV1(uint256 targetIndex,bytes32 targetIdHash,bytes32 applicantSalt,uint256 deploymentValue,uint256 initializerValue,bytes32 initCodeHash,bytes32 initializerCalldataHash)"
    );
    bytes32 public constant GRAPH_COMMITMENT_TYPEHASH = keccak256(
        "ProgrammableCreate2GraphCommitmentV1(uint256 chainId,address factory,bytes32 routeNamespace,bytes32 routeNonce,bytes32 topologyHash,address authorizedLauncher,uint256 totalValue,bytes32 targetCommitmentsHash)"
    );
    bytes32 public constant TARGET_SALT_TYPEHASH = keccak256(
        "ProgrammableCreate2GraphTargetSaltV1(uint256 chainId,address factory,bytes32 routeNamespace,bytes32 routeNonce,bytes32 targetIdHash,bytes32 applicantSalt,address authorizedLauncher)"
    );
    bytes32 public constant GRAPH_AUTHORIZATION_KEY_TYPEHASH = keccak256(
        "ProgrammableCreate2GraphAuthorizationKeyV1(uint256 chainId,address factory,bytes32 routeNamespace,bytes32 routeNonce,address authorizedLauncher)"
    );
    bytes32 public constant GRAPH_DEPLOYMENT_ACCUMULATOR_TYPEHASH = keccak256(
        "ProgrammableCreate2GraphDeploymentAccumulatorV1(bytes32 previous,uint256 targetIndex,bytes32 targetIdHash,address deployment,bytes32 effectiveSalt,bytes32 initCodeHash,bytes32 initializerCalldataHash,bytes32 runtimeCodeHash,uint256 deploymentValue,uint256 initializerValue)"
    );

    struct GraphAuthorization {
        bytes32 routeNamespace;
        bytes32 routeNonce;
        bytes32 topologyHash;
        bytes32 graphCommitment;
        address authorizedLauncher;
        uint256 totalValue;
    }

    struct Target {
        bytes32 targetIdHash;
        bytes32 applicantSalt;
        uint256 deploymentValue;
        uint256 initializerValue;
        bytes initCode;
        bytes initializerCalldata;
    }

    struct GraphExecution {
        address[] deployments;
        bytes32[] salts;
        bytes32[] initCodeHashes;
        bytes32[] initializerCalldataHashes;
        bytes32[] runtimeCodeHashes;
        bytes[] runtimeCodes;
    }

    mapping(bytes32 authorizationKey => bool consumed) public consumedGraphAuthorization;
    bool private graphDeploymentActive;

    error EmptyGraph();
    error GraphTargetLimitExceeded(uint256 actual, uint256 maximum);
    error GraphInputBytesLimitExceeded(uint256 actual, uint256 maximum);
    error InvalidGraphAuthorization();
    error InvalidGraphTarget(uint256 targetIndex);
    error ReentrantGraphDeployment();
    error UnauthorizedLauncher(address caller, address authorizedLauncher);
    error GraphValueMismatch(uint256 actual, uint256 authorized);
    error GraphTargetValueSumMismatch(uint256 targetSum, uint256 authorized);
    error GraphCommitmentMismatch(bytes32 actual, bytes32 reviewed);
    error GraphAuthorizationAlreadyConsumed(bytes32 authorizationKey);
    error DuplicateTargetId(uint256 firstIndex, uint256 duplicateIndex, bytes32 targetIdHash);
    error DuplicateEffectiveSalt(uint256 firstIndex, uint256 duplicateIndex, bytes32 effectiveSalt);
    error DuplicateDeploymentAddress(uint256 firstIndex, uint256 duplicateIndex, address deployment);
    error DeploymentAddressAlreadyOccupied(uint256 targetIndex, address deployment);
    error DeploymentAddressMismatch(uint256 targetIndex, address actual, address predicted);
    error DeploymentRuntimeCodeMissing(uint256 targetIndex, address deployment);
    error InitializerCallFailed(
        uint256 targetIndex, address deployment, uint256 returnDataLength, bytes boundedReturnData
    );

    event ProgrammableCreate2GraphTargetDeployed(
        bytes32 indexed graphCommitment,
        bytes32 indexed targetIdHash,
        address indexed deployment,
        uint256 targetIndex,
        bytes32 effectiveSalt,
        bytes32 initCodeHash,
        bytes32 initializerCalldataHash,
        bytes32 runtimeCodeHash,
        uint256 deploymentValue,
        uint256 initializerValue
    );

    event ProgrammableCreate2GraphDeployed(
        bytes32 indexed routeNamespace,
        bytes32 indexed graphCommitment,
        bytes32 indexed graphDeploymentHash,
        bytes32 routeNonce,
        bytes32 topologyHash,
        address authorizedLauncher,
        uint256 totalValue,
        uint256 targetCount
    );

    /// @notice Deploys every exact target, then initializes each target atomically in reviewed order.
    function deployGraph(GraphAuthorization calldata authorization, Target[] calldata targets)
        external
        payable
        returns (
            address[] memory deployments,
            bytes32[] memory runtimeCodeHashes,
            bytes[] memory runtimeCodes,
            bytes32 graphDeploymentHash
        )
    {
        if (graphDeploymentActive) revert ReentrantGraphDeployment();
        graphDeploymentActive = true;
        uint256 targetCount = targets.length;
        if (targetCount == 0) revert EmptyGraph();
        if (targetCount > MAX_TARGETS) revert GraphTargetLimitExceeded(targetCount, MAX_TARGETS);
        _validateAuthorization(authorization);
        if (msg.sender != authorization.authorizedLauncher) {
            revert UnauthorizedLauncher(msg.sender, authorization.authorizedLauncher);
        }
        if (msg.value != authorization.totalValue) {
            revert GraphValueMismatch(msg.value, authorization.totalValue);
        }

        (bytes32 reviewedCommitment, uint256 targetValueSum) = _reviewedGraphCommitment(authorization, targets);
        if (targetValueSum != authorization.totalValue) {
            revert GraphTargetValueSumMismatch(targetValueSum, authorization.totalValue);
        }
        if (reviewedCommitment != authorization.graphCommitment) {
            revert GraphCommitmentMismatch(reviewedCommitment, authorization.graphCommitment);
        }
        bytes32 authorizationKey = graphAuthorizationKey(authorization);
        if (consumedGraphAuthorization[authorizationKey]) {
            revert GraphAuthorizationAlreadyConsumed(authorizationKey);
        }
        consumedGraphAuthorization[authorizationKey] = true;

        GraphExecution memory execution = GraphExecution({
            deployments: new address[](targetCount),
            salts: new bytes32[](targetCount),
            initCodeHashes: new bytes32[](targetCount),
            initializerCalldataHashes: new bytes32[](targetCount),
            runtimeCodeHashes: new bytes32[](targetCount),
            runtimeCodes: new bytes[](targetCount)
        });

        _deriveAndValidateTargets(authorization, targets, execution);
        _deployTargets(targets, execution);
        _initializeTargets(targets, execution.deployments);
        graphDeploymentHash = _observeAndEmitTargets(authorization, targets, execution);

        deployments = execution.deployments;
        runtimeCodeHashes = execution.runtimeCodeHashes;
        runtimeCodes = execution.runtimeCodes;

        _emitGraphSummary(authorization, graphDeploymentHash, targetCount);
        graphDeploymentActive = false;
    }

    /// @notice Computes the exact reviewed graph commitment. `authorization.graphCommitment` is intentionally ignored.
    function computeGraphCommitment(GraphAuthorization calldata authorization, Target[] calldata targets)
        external
        view
        returns (bytes32 commitment, uint256 targetValueSum)
    {
        return _reviewedGraphCommitment(authorization, targets);
    }

    /// @notice Computes one target salt without depending on any target init code or runtime.
    function effectiveTargetSalt(GraphAuthorization calldata authorization, bytes32 targetIdHash, bytes32 applicantSalt)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                TARGET_SALT_TYPEHASH,
                block.chainid,
                address(this),
                authorization.routeNamespace,
                authorization.routeNonce,
                targetIdHash,
                applicantSalt,
                authorization.authorizedLauncher
            )
        );
    }

    /// @notice Predicts one target address independently so an acyclic constructor graph can be materialized.
    function predictTarget(GraphAuthorization calldata authorization, Target calldata target)
        external
        view
        returns (address)
    {
        if (target.targetIdHash == bytes32(0) || target.initCode.length == 0) {
            revert InvalidGraphTarget(0);
        }
        return _computeAddress(
            effectiveTargetSalt(authorization, target.targetIdHash, target.applicantSalt), keccak256(target.initCode)
        );
    }

    /// @notice One route nonce is globally single-use for this factory, namespace, chain, and launcher.
    function graphAuthorizationKey(GraphAuthorization calldata authorization) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                GRAPH_AUTHORIZATION_KEY_TYPEHASH,
                block.chainid,
                address(this),
                authorization.routeNamespace,
                authorization.routeNonce,
                authorization.authorizedLauncher
            )
        );
    }

    function _validateAuthorization(GraphAuthorization calldata authorization) private pure {
        if (
            authorization.routeNamespace == bytes32(0) || authorization.routeNonce == bytes32(0)
                || authorization.topologyHash == bytes32(0) || authorization.graphCommitment == bytes32(0)
                || authorization.authorizedLauncher == address(0)
        ) revert InvalidGraphAuthorization();
    }

    function _emitGraphSummary(
        GraphAuthorization calldata authorization,
        bytes32 graphDeploymentHash,
        uint256 targetCount
    ) private {
        emit ProgrammableCreate2GraphDeployed(
            authorization.routeNamespace,
            authorization.graphCommitment,
            graphDeploymentHash,
            authorization.routeNonce,
            authorization.topologyHash,
            authorization.authorizedLauncher,
            authorization.totalValue,
            targetCount
        );
    }

    function _reviewedGraphCommitment(GraphAuthorization calldata authorization, Target[] calldata targets)
        private
        view
        returns (bytes32 commitment, uint256 targetValueSum)
    {
        uint256 targetCount = targets.length;
        if (targetCount == 0) revert EmptyGraph();
        if (targetCount > MAX_TARGETS) revert GraphTargetLimitExceeded(targetCount, MAX_TARGETS);
        bytes32[] memory targetCommitments = new bytes32[](targetCount);
        uint256 totalInputBytes = 0;
        for (uint256 index; index < targetCount; ++index) {
            Target calldata target = targets[index];
            if (
                target.targetIdHash == bytes32(0) || target.initCode.length == 0
                    || target.initCode.length > MAX_TARGET_INIT_CODE_BYTES
                    || target.initializerCalldata.length > MAX_TARGET_INITIALIZER_BYTES
                    || (target.initializerValue != 0 && target.initializerCalldata.length == 0)
            ) {
                revert InvalidGraphTarget(index);
            }
            totalInputBytes += target.initCode.length + target.initializerCalldata.length;
            if (totalInputBytes > MAX_TOTAL_INPUT_BYTES) {
                revert GraphInputBytesLimitExceeded(totalInputBytes, MAX_TOTAL_INPUT_BYTES);
            }
            targetValueSum += target.deploymentValue + target.initializerValue;
            targetCommitments[index] = keccak256(
                abi.encode(
                    GRAPH_TARGET_COMMITMENT_TYPEHASH,
                    index,
                    target.targetIdHash,
                    target.applicantSalt,
                    target.deploymentValue,
                    target.initializerValue,
                    keccak256(target.initCode),
                    keccak256(target.initializerCalldata)
                )
            );
        }
        commitment = keccak256(
            abi.encode(
                GRAPH_COMMITMENT_TYPEHASH,
                block.chainid,
                address(this),
                authorization.routeNamespace,
                authorization.routeNonce,
                authorization.topologyHash,
                authorization.authorizedLauncher,
                authorization.totalValue,
                keccak256(abi.encode(targetCommitments))
            )
        );
    }

    function _deriveAndValidateTargets(
        GraphAuthorization calldata authorization,
        Target[] calldata targets,
        GraphExecution memory execution
    ) private view {
        for (uint256 index; index < targets.length; ++index) {
            Target calldata target = targets[index];
            bytes32 salt = effectiveTargetSalt(authorization, target.targetIdHash, target.applicantSalt);
            bytes32 initCodeHash = keccak256(target.initCode);
            address deployment = _computeAddress(salt, initCodeHash);
            for (uint256 previous; previous < index; ++previous) {
                if (targets[previous].targetIdHash == target.targetIdHash) {
                    revert DuplicateTargetId(previous, index, target.targetIdHash);
                }
                if (execution.salts[previous] == salt) {
                    revert DuplicateEffectiveSalt(previous, index, salt);
                }
                if (execution.deployments[previous] == deployment) {
                    revert DuplicateDeploymentAddress(previous, index, deployment);
                }
            }
            if (deployment.code.length != 0) {
                revert DeploymentAddressAlreadyOccupied(index, deployment);
            }
            execution.deployments[index] = deployment;
            execution.salts[index] = salt;
            execution.initCodeHashes[index] = initCodeHash;
            execution.initializerCalldataHashes[index] = keccak256(target.initializerCalldata);
        }
    }

    function _deployTargets(Target[] calldata targets, GraphExecution memory execution) private {
        for (uint256 index; index < targets.length; ++index) {
            bytes memory creationCode = targets[index].initCode;
            address actual;
            uint256 value = targets[index].deploymentValue;
            bytes32 salt = execution.salts[index];
            assembly ("memory-safe") {
                actual := create2(value, add(creationCode, 0x20), mload(creationCode), salt)
            }
            if (actual != execution.deployments[index]) {
                revert DeploymentAddressMismatch(index, actual, execution.deployments[index]);
            }
        }
    }

    function _initializeTargets(Target[] calldata targets, address[] memory deployments) private {
        for (uint256 index; index < targets.length; ++index) {
            if (targets[index].initializerCalldata.length != 0) {
                _initialize(
                    index, deployments[index], targets[index].initializerCalldata, targets[index].initializerValue
                );
            }
        }
    }

    function _observeAndEmitTargets(
        GraphAuthorization calldata authorization,
        Target[] calldata targets,
        GraphExecution memory execution
    ) private returns (bytes32 accumulator) {
        accumulator = authorization.graphCommitment;
        for (uint256 index; index < targets.length; ++index) {
            bytes memory runtimeCode = execution.deployments[index].code;
            if (runtimeCode.length == 0) {
                revert DeploymentRuntimeCodeMissing(index, execution.deployments[index]);
            }
            bytes32 runtimeCodeHash = keccak256(runtimeCode);
            execution.runtimeCodes[index] = runtimeCode;
            execution.runtimeCodeHashes[index] = runtimeCodeHash;
            accumulator = _accumulateTargetDeployment(accumulator, index, targets[index], execution, runtimeCodeHash);
            _emitTargetDeployment(authorization.graphCommitment, index, targets[index], execution, runtimeCodeHash);
        }
    }

    function _accumulateTargetDeployment(
        bytes32 previous,
        uint256 targetIndex,
        Target calldata target,
        GraphExecution memory execution,
        bytes32 runtimeCodeHash
    ) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                GRAPH_DEPLOYMENT_ACCUMULATOR_TYPEHASH,
                previous,
                targetIndex,
                target.targetIdHash,
                execution.deployments[targetIndex],
                execution.salts[targetIndex],
                execution.initCodeHashes[targetIndex],
                execution.initializerCalldataHashes[targetIndex],
                runtimeCodeHash,
                target.deploymentValue,
                target.initializerValue
            )
        );
    }

    function _emitTargetDeployment(
        bytes32 graphCommitment,
        uint256 targetIndex,
        Target calldata target,
        GraphExecution memory execution,
        bytes32 runtimeCodeHash
    ) private {
        emit ProgrammableCreate2GraphTargetDeployed(
            graphCommitment,
            target.targetIdHash,
            execution.deployments[targetIndex],
            targetIndex,
            execution.salts[targetIndex],
            execution.initCodeHashes[targetIndex],
            execution.initializerCalldataHashes[targetIndex],
            runtimeCodeHash,
            target.deploymentValue,
            target.initializerValue
        );
    }

    function _initialize(
        uint256 targetIndex,
        address deployment,
        bytes calldata initializerCalldata,
        uint256 initializerValue
    ) private {
        bytes memory payload = initializerCalldata;
        bool success;
        uint256 returnDataLength;
        assembly ("memory-safe") {
            success := call(gas(), deployment, initializerValue, add(payload, 0x20), mload(payload), 0, 0)
            returnDataLength := returndatasize()
        }
        if (!success) {
            uint256 boundedLength = returnDataLength;
            if (boundedLength > MAX_INITIALIZER_REVERT_BYTES) {
                boundedLength = MAX_INITIALIZER_REVERT_BYTES;
            }
            bytes memory boundedReturnData = new bytes(boundedLength);
            assembly ("memory-safe") {
                returndatacopy(add(boundedReturnData, 0x20), 0, boundedLength)
            }
            revert InitializerCallFailed(targetIndex, deployment, returnDataLength, boundedReturnData);
        }
    }

    function _computeAddress(bytes32 salt, bytes32 initCodeHash) private view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)))));
    }
}
