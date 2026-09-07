// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { ClassicModuleLaunchPolicyV1 } from "../classic-modules/ClassicModuleLaunchPolicyV1.sol";
import { ClassicModuleFeeLedgerV2 } from "../classic-modules/ClassicModuleFeeLedgerV2.sol";
import { IClassicModuleAuthorRegistry } from "../classic-modules/ClassicModuleFeeLedgerV1.sol";
import { ClassicModuleCalls } from "../classic-modules/ClassicModuleCalls.sol";
import { IModuleEngineV1, IModuleEngineFeeCollectorV1 } from "./IModuleEngineV1.sol";
import { ModuleEngineCallsV1 } from "./ModuleEngineCallsV1.sol";
import { ModuleEngineTypesV1 as T } from "./ModuleEngineTypesV1.sol";

interface IModuleEngineReviewAuthorityV1 is IClassicModuleAuthorRegistry {
    function owner() external view returns (address);
    function families(bytes32 familyId) external view returns (address author, address wallet);
}

/// @notice Additional EVM engine host. Existing native sources, registries and claims remain unchanged.
/// @dev Admission uses the existing registry owner. It has no post-launch engine/config/asset/fee-rate setters.
///      An engine owns only its launch resources. The host never grants engine allowances or mint permissions.
contract ModuleEngineHostV1 is ReentrancyGuardTransient, IModuleEngineFeeCollectorV1 {
    using SafeERC20 for IERC20;

    uint256 public constant TOKEN_SUPPLY = 1_000_000_000 ether;
    uint256 public constant MAX_CONFIGURATION_BYTES = 16_384;
    uint256 public constant MAX_OPERATIONS = 32;
    uint256 public constant MAX_IMMUTABLE_REFERENCES = 128;
    // Canonical ABI/metadata overhead 7,744 + init payload 48,896 + runtime 24,576 + two data fields 32,768.
    uint256 public constant MAX_LAUNCH_PARAMETERS_BYTES = 113_984;
    bytes32 public constant SOURCE_VERSION = keccak256("programmable.module-engine.evm.v1");

    UERC20Factory public immutable tokenFactory;
    ClassicModuleLaunchPolicyV1 public immutable launchPolicy;
    IModuleEngineReviewAuthorityV1 public immutable registry;
    ClassicModuleFeeLedgerV2 public immutable ledger;

    struct LaunchParameters {
        string name;
        string symbol;
        bytes32 creatorSalt;
        bytes32 revisionId;
        address quoteAsset;
        bytes configuration;
        bytes creationCode;
        bytes runtimeTemplate;
        bytes32 engineSalt;
        bytes launchData;
        UERC20Metadata metadata;
        address[] creatorWallets;
        uint16[] creatorSharesBps;
        uint16 buyCreatorFeeBps;
        uint16 sellCreatorFeeBps;
        T.Operation initialOperation;
    }

    struct Launch {
        bytes32 launchId;
        bytes32 revisionId;
        address creator;
        address token;
        address quoteAsset;
        address engine;
        bytes32 engineCodeHash;
        bytes32 constructorHash;
        bytes32 initCodeHash;
        bytes32 configurationHash;
        bytes32 planHash;
        bytes32 resourcesHash;
        uint16 buyCreatorFeeBps;
        uint16 sellCreatorFeeBps;
    }

    mapping(bytes32 revisionId => T.Revision) private _revisions;
    mapping(bytes32 revisionId => uint32[]) private _runtimeOffsets;
    mapping(bytes32 revisionId => uint32[]) private _constructorOffsets;
    mapping(bytes32 revisionId => bytes32[]) private _feeFamilies;
    mapping(bytes32 revisionId => mapping(bytes32 operationId => T.Permission)) private _permissions;
    mapping(bytes32 launchId => Launch) private _launches;
    mapping(address token => bytes32 launchId) public launchIdOf;
    mapping(address engine => bytes32 launchId) public engineLaunchId;
    mapping(bytes32 launchId => mapping(address actor => uint256)) public nonces;
    address private _activeEngine;

    error UnauthorizedReviewer();
    error InvalidRevision();
    error RevisionExists();
    error InvalidFamily();
    error UnavailableRevision();
    error FixedValueOverride();
    error InvalidCodeBinding();
    error InvalidConstructorBinding();
    error InvalidToken();
    error InvalidOperation();
    error UnauthorizedOperation();
    error StaleNonce();
    error DeadlineExpired();
    error InvalidFunding();
    error UnsupportedAsset();
    error InsufficientOutput();
    error UnauthorizedFeeDeposit();

    event EngineRevisionApproved(bytes32 indexed revisionId, bytes32 indexed familyId, T.Revision revision);
    event EngineRevisionAvailabilityChanged(bytes32 indexed revisionId, bool enabled);
    event EngineLaunchBound(
        bytes32 indexed launchId,
        address indexed token,
        address indexed engine,
        address creator,
        address quoteAsset,
        bytes32 revisionId,
        bytes32 constructorHash,
        bytes32 initCodeHash,
        bytes32 runtimeCodeHash,
        bytes32 configurationHash,
        bytes32 resourcesHash,
        bytes32 economicsPolicyId,
        bytes32 planHash
    );
    event EngineLaunchParametersBound(bytes32 indexed launchId, bytes encodedParameters);
    event EngineOperationExecuted(
        bytes32 indexed launchId,
        bytes32 indexed operationId,
        address indexed actor,
        address recipient,
        uint256 nonce,
        address inputAsset,
        uint256 inputAmount,
        address outputAsset,
        uint256 outputAmount,
        bytes32 resultHash
    );

    constructor(
        UERC20Factory tokenFactory_,
        ClassicModuleLaunchPolicyV1 launchPolicy_,
        IModuleEngineReviewAuthorityV1 registry_,
        IPoolManager poolManager_,
        address treasury_,
        address rewardAdmin_
    ) {
        if (
            address(tokenFactory_).codehash != keccak256(type(UERC20Factory).runtimeCode)
                || address(launchPolicy_).codehash != keccak256(type(ClassicModuleLaunchPolicyV1).runtimeCode)
                || address(registry_).code.length == 0 || registry_.owner() == address(0)
        ) revert InvalidCodeBinding();
        tokenFactory = tokenFactory_;
        launchPolicy = launchPolicy_;
        registry = registry_;
        ledger = new ClassicModuleFeeLedgerV2(poolManager_, registry_, treasury_, rewardAdmin_);
    }

    function approveRevision(
        bytes32 revisionId,
        T.Revision calldata revision,
        uint32[] calldata runtimeOffsets,
        uint32[] calldata constructorOffsets,
        T.Permission[] calldata permissions,
        bytes32[] calldata eligibleFamilies
    ) external {
        if (msg.sender != registry.owner()) revert UnauthorizedReviewer();
        if (_revisions[revisionId].creationCodeHash != bytes32(0)) revert RevisionExists();
        if (
            revisionId == bytes32(0) || revision.creationCodeHash == bytes32(0)
                || revision.runtimeTemplateHash == bytes32(0) || revision.manifestHash == bytes32(0)
                || revision.coinRights != 0 || revision.moneyRights > 7 || !revision.enabled
                || revision.executionGas < 50_000 || revision.executionGas > 10_000_000 || permissions.length == 0
                || permissions.length > MAX_OPERATIONS || runtimeOffsets.length != constructorOffsets.length
                || runtimeOffsets.length > MAX_IMMUTABLE_REFERENCES || eligibleFamilies.length > 8
        ) revert InvalidRevision();
        _requireFamily(revision.familyId);
        for (uint256 i; i < runtimeOffsets.length; ++i) {
            if ((i != 0 && runtimeOffsets[i] < uint256(runtimeOffsets[i - 1]) + 32) || constructorOffsets[i] % 32 != 0) revert InvalidConstructorBinding();
        }
        for (uint256 i; i < permissions.length; ++i) {
            T.Permission calldata grant = permissions[i];
            if (
                grant.operationId == bytes32(0) || _permissions[revisionId][grant.operationId].operationId != 0
                    || grant.inputRoles > 7 || grant.outputRoles > 7 || grant.authorization > 1
                    || (grant.inputRoles & ~revision.moneyRights) != 0
            ) revert InvalidRevision();
            _permissions[revisionId][grant.operationId] = grant;
        }
        if (revision.initialOperationId != 0 && _permissions[revisionId][revision.initialOperationId].operationId == 0) revert InvalidRevision();
        for (uint256 i; i < eligibleFamilies.length; ++i) {
            _requireFamily(eligibleFamilies[i]);
            if (i != 0 && eligibleFamilies[i] <= eligibleFamilies[i - 1]) {
                revert InvalidFamily();
            }
        }
        _revisions[revisionId] = revision;
        _runtimeOffsets[revisionId] = runtimeOffsets;
        _constructorOffsets[revisionId] = constructorOffsets;
        _feeFamilies[revisionId] = eligibleFamilies;
        emit EngineRevisionApproved(revisionId, revision.familyId, revision);
    }

    /// @notice Availability affects future launches only, never existing engines or claims.
    function setRevisionEnabled(bytes32 revisionId, bool enabled) external {
        if (msg.sender != registry.owner()) revert UnauthorizedReviewer();
        if (_revisions[revisionId].creationCodeHash == 0) revert InvalidRevision();
        _revisions[revisionId].enabled = enabled;
        emit EngineRevisionAvailabilityChanged(revisionId, enabled);
    }

    function getRevision(bytes32 revisionId)
        external
        view
        returns (
            T.Revision memory revision,
            uint32[] memory runtimeOffsets,
            uint32[] memory constructorOffsets,
            bytes32[] memory eligibleFamilies
        )
    {
        return (
            _revisions[revisionId],
            _runtimeOffsets[revisionId],
            _constructorOffsets[revisionId],
            _feeFamilies[revisionId]
        );
    }

    function permission(bytes32 revisionId, bytes32 operationId) external view returns (T.Permission memory) {
        return _permissions[revisionId][operationId];
    }

    function getLaunch(bytes32 launchId) external view returns (Launch memory) {
        return _launches[launchId];
    }

    function predictTokenAddress(string calldata name, string calldata symbol, address creator, bytes32 salt)
        external
        view
        returns (address token, bytes32 graffiti)
    {
        graffiti = _graffiti(creator, salt);
        token = tokenFactory.getUERC20Address(name, symbol, 18, address(this), graffiti);
    }

    function launch(LaunchParameters calldata parameters) external payable nonReentrant returns (Launch memory result) {
        T.Revision storage revision = _revisions[parameters.revisionId];
        _validateLaunch(parameters, revision);
        result = _createLaunch(parameters);
        _launches[result.launchId] = result;
        launchIdOf[result.token] = result.launchId;
        engineLaunchId[result.engine] = result.launchId;
        ledger.registerPool(
            result.launchId, parameters.creatorWallets, parameters.creatorSharesBps, _feeFamilies[result.revisionId]
        );
        IERC20(result.token).safeTransfer(result.engine, TOKEN_SUPPLY);
        if (IERC20(result.token).balanceOf(result.engine) != TOKEN_SUPPLY) revert InvalidToken();
        _activeEngine = result.engine;
        result.resourcesHash = abi.decode(
            ModuleEngineCallsV1.invoke(
                result.engine,
                0,
                revision.executionGas,
                abi.encodeCall(IModuleEngineV1.initialize, (parameters.launchData)),
                32
            ),
            (bytes32)
        );
        _activeEngine = address(0);
        _launches[result.launchId].resourcesHash = result.resourcesHash;
        if (parameters.initialOperation.operationId != 0) {
            if (parameters.initialOperation.operationId != revision.initialOperationId) revert InvalidOperation();
            _execute(result, parameters.initialOperation);
        } else if (revision.initialOperationId != 0 || msg.value != 0) {
            revert InvalidOperation();
        }
        _emitLaunch(result);
        bytes memory encodedParameters = abi.encode(parameters);
        if (encodedParameters.length > MAX_LAUNCH_PARAMETERS_BYTES) revert InvalidCodeBinding();
        emit EngineLaunchParametersBound(result.launchId, encodedParameters);
    }

    function execute(bytes32 launchId, T.Operation calldata operation)
        external
        payable
        nonReentrant
        returns (bytes memory result)
    {
        Launch memory launched = _launches[launchId];
        if (launched.engine == address(0)) revert InvalidOperation();
        return _execute(launched, operation);
    }

    function feeTerms(bytes32 launchId, bool buy) external view returns (uint16 platformBps, uint16 creatorBps) {
        Launch storage launched = _launches[launchId];
        if (launched.engine == address(0)) revert InvalidOperation();
        return (ledger.platformFeeBps(launchId), buy ? launched.buyCreatorFeeBps : launched.sellCreatorFeeBps);
    }

    /// @notice Only actual ETH received during this engine's operation enters the shared V2 claims ledger.
    function depositFees(uint256 platformFee, uint256 creatorFee) external payable {
        if (_activeEngine != msg.sender || msg.sender == address(0)) revert UnauthorizedFeeDeposit();
        ledger.accrueNative{ value: msg.value }(engineLaunchId[msg.sender], platformFee, creatorFee);
    }

    function _validateLaunch(LaunchParameters calldata p, T.Revision storage revision) private view {
        if (!revision.enabled) revert UnavailableRevision();
        if (p.quoteAsset.code.length == 0 || IERC20Metadata(p.quoteAsset).decimals() > 18) revert UnsupportedAsset();
        if (
            (revision.fixedQuoteAsset != address(0) && p.quoteAsset != revision.fixedQuoteAsset)
                || (revision.fixedConfigurationHash != 0
                    && keccak256(p.configuration) != revision.fixedConfigurationHash)
        ) revert FixedValueOverride();
        if (
            p.configuration.length > MAX_CONFIGURATION_BYTES || p.launchData.length > MAX_CONFIGURATION_BYTES
                || p.initialOperation.data.length > MAX_CONFIGURATION_BYTES
                || p.creationCode.length + 256 + ((p.configuration.length + 31) & ~uint256(31)) > 49_152
                || p.runtimeTemplate.length > 24_576 || keccak256(p.creationCode) != revision.creationCodeHash
                || keccak256(p.runtimeTemplate) != revision.runtimeTemplateHash
        ) revert InvalidCodeBinding();
        launchPolicy.validate(
            p.name, p.symbol, p.metadata, p.creatorWallets, p.creatorSharesBps, p.buyCreatorFeeBps, p.sellCreatorFeeBps
        );
    }

    function _createLaunch(LaunchParameters calldata p) private returns (Launch memory r) {
        r.revisionId = p.revisionId;
        r.creator = msg.sender;
        r.quoteAsset = p.quoteAsset;
        r.configurationHash = keccak256(p.configuration);
        r.planHash = keccak256(abi.encode(block.chainid, address(this), msg.sender, p));
        r.buyCreatorFeeBps = p.buyCreatorFeeBps;
        r.sellCreatorFeeBps = p.sellCreatorFeeBps;
        bytes32 graffiti = _graffiti(msg.sender, p.creatorSalt);
        r.token = tokenFactory.getUERC20Address(p.name, p.symbol, 18, address(this), graffiti);
        if (r.token.code.length != 0 || r.token == r.quoteAsset) revert InvalidToken();
        r.launchId = keccak256(abi.encode(block.chainid, address(this), r.token, r.revisionId, r.configurationHash));
        T.Context memory context =
            T.Context(address(this), r.launchId, r.token, msg.sender, r.quoteAsset, address(this));
        bytes memory constructorArgs = abi.encode(context, p.configuration);
        r.constructorHash = keccak256(constructorArgs);
        bytes memory initCode = bytes.concat(p.creationCode, constructorArgs);
        r.initCodeHash = keccak256(initCode);
        r.engineCodeHash = _runtimeHash(p.revisionId, p.runtimeTemplate, constructorArgs);
        bytes32 salt = keccak256(abi.encode(msg.sender, p.engineSalt, r.launchId));
        r.engine = Create2.deploy(0, salt, initCode);
        if (r.engine.codehash != r.engineCodeHash) revert InvalidCodeBinding();
        _assertContext(r.engine, context);
        _createToken(p, r.token, graffiti);
    }

    function _createToken(LaunchParameters calldata p, address token, bytes32 graffiti) private {
        address deployed = tokenFactory.createToken(
            p.name, p.symbol, 18, TOKEN_SUPPLY, address(this), abi.encode(p.metadata), graffiti
        );
        if (
            deployed != token || IERC20(deployed).totalSupply() != TOKEN_SUPPLY
                || IERC20(deployed).balanceOf(address(this)) != TOKEN_SUPPLY
                || IERC20Metadata(deployed).decimals() != 18
        ) revert InvalidToken();
    }

    function _requireFamily(bytes32 familyId) private view {
        (address author, address wallet) = registry.families(familyId);
        if (author == address(0) || wallet == address(0)) revert InvalidFamily();
    }

    function _assertContext(address engine, T.Context memory context) private view {
        bytes memory readback = ClassicModuleCalls.read(engine, abi.encodeCall(IModuleEngineV1.contextHash, ()), 32);
        if (abi.decode(readback, (bytes32)) != keccak256(abi.encode(context))) revert InvalidConstructorBinding();
    }

    function _runtimeHash(bytes32 revisionId, bytes memory runtime, bytes memory constructorArgs)
        private
        view
        returns (bytes32)
    {
        uint32[] storage offsets = _runtimeOffsets[revisionId];
        uint32[] storage bindings = _constructorOffsets[revisionId];
        for (uint256 i; i < offsets.length; ++i) {
            uint256 offset = offsets[i];
            uint256 binding = bindings[i];
            if (offset + 32 > runtime.length || binding + 32 > constructorArgs.length) {
                revert InvalidConstructorBinding();
            }
            bytes32 original;
            bytes32 value;
            assembly ("memory-safe") {
                original := mload(add(add(runtime, 32), offset))
                value := mload(add(add(constructorArgs, 32), binding))
            }
            if (original != bytes32(0)) revert InvalidConstructorBinding();
            assembly ("memory-safe") { mstore(add(add(runtime, 32), offset), value) }
        }
        return keccak256(runtime);
    }

    function _execute(Launch memory r, T.Operation calldata requested) private returns (bytes memory result) {
        T.Permission storage allowed = _permissions[r.revisionId][requested.operationId];
        if (
            allowed.operationId == 0 || requested.recipient == address(0)
                || requested.data.length > MAX_CONFIGURATION_BYTES
        ) {
            revert InvalidOperation();
        }
        if (allowed.authorization == T.AUTH_CREATOR && msg.sender != r.creator) revert UnauthorizedOperation();
        if (requested.actor != msg.sender) revert UnauthorizedOperation();
        if (requested.deadline < block.timestamp) revert DeadlineExpired();
        if (requested.nonce != nonces[r.launchId][msg.sender]++) revert StaleNonce();
        uint8 inputRole = _role(r, requested.inputAsset, requested.inputAmount);
        uint8 outputRole = _role(r, requested.outputAsset, requested.minimumOutput);
        if ((inputRole & allowed.inputRoles) != inputRole || (outputRole & allowed.outputRoles) != outputRole) {
            revert UnauthorizedOperation();
        }
        if (r.engine.codehash != r.engineCodeHash) revert InvalidCodeBinding();
        uint256 beforeOutput = _balance(requested.outputAsset, requested.recipient);
        uint256 nativeInput = inputRole == T.ROLE_NATIVE ? requested.inputAmount : 0;
        if (msg.value != nativeInput) revert InvalidFunding();
        if (inputRole != T.ROLE_NATIVE && requested.inputAmount != 0) {
            _pullExactly(requested.inputAsset, r.engine, requested.inputAmount);
        }
        _activeEngine = r.engine;
        result = abi.decode(
            ModuleEngineCallsV1.invoke(
                r.engine,
                nativeInput,
                _revisions[r.revisionId].executionGas,
                abi.encodeCall(IModuleEngineV1.execute, (requested)),
                MAX_CONFIGURATION_BYTES + 64
            ),
            (bytes)
        );
        _activeEngine = address(0);
        uint256 afterOutput = _balance(requested.outputAsset, requested.recipient);
        // Same-asset operations may return deposited funds; compare the net output after the exact input debit.
        if (
            requested.inputAsset == requested.outputAsset && requested.recipient == msg.sender
                && inputRole != T.ROLE_NATIVE
        ) {
            beforeOutput -= requested.inputAmount;
        }
        if (afterOutput < beforeOutput || afterOutput - beforeOutput < requested.minimumOutput) {
            revert InsufficientOutput();
        }
        _emitOperation(r.launchId, requested, afterOutput - beforeOutput, keccak256(result));
    }

    function _role(Launch memory r, address asset, uint256 amount) private pure returns (uint8) {
        if (asset == address(0)) return amount == 0 ? T.ROLE_NONE : T.ROLE_NATIVE;
        if (asset == r.token) return T.ROLE_PRIMARY;
        if (asset == r.quoteAsset) return T.ROLE_QUOTE;
        revert UnsupportedAsset();
    }

    function _balance(address asset, address recipient) private view returns (uint256) {
        return asset == address(0) ? recipient.balance : IERC20(asset).balanceOf(recipient);
    }

    function _pullExactly(address asset, address recipient, uint256 amount) private {
        IERC20 input = IERC20(asset);
        uint256 beforeInput = input.balanceOf(recipient);
        uint256 beforePayer = input.balanceOf(msg.sender);
        input.safeTransferFrom(msg.sender, recipient, amount);
        if (input.balanceOf(recipient) - beforeInput != amount || beforePayer - input.balanceOf(msg.sender) != amount) {
            revert InvalidFunding();
        }
    }

    function _graffiti(address creator, bytes32 salt) private pure returns (bytes32) {
        return keccak256(abi.encode("programmable.module-engine.token.v1", creator, salt));
    }

    function _emitLaunch(Launch memory r) private {
        emit EngineLaunchBound(
            r.launchId,
            r.token,
            r.engine,
            r.creator,
            r.quoteAsset,
            r.revisionId,
            r.constructorHash,
            r.initCodeHash,
            r.engineCodeHash,
            r.configurationHash,
            r.resourcesHash,
            ledger.ECONOMICS_POLICY_ID(),
            r.planHash
        );
    }

    function _emitOperation(bytes32 launchId, T.Operation calldata requested, uint256 outputAmount, bytes32 resultHash)
        private
    {
        emit EngineOperationExecuted(
            launchId,
            requested.operationId,
            msg.sender,
            requested.recipient,
            requested.nonce,
            requested.inputAsset,
            requested.inputAmount,
            requested.outputAsset,
            outputAmount,
            resultHash
        );
    }
}
