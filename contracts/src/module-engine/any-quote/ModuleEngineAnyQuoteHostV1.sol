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
import { ClassicModuleLaunchPolicyV1 } from "../../classic-modules/ClassicModuleLaunchPolicyV1.sol";
import { IModuleEngineReviewAuthorityV1 } from "../ModuleEngineHostV1.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { AnyQuoteTypesV1 as A } from "./AnyQuoteTypesV1.sol";
import { AnyQuoteNativeRouteGuardV1 } from "./AnyQuoteNativeRouteGuardV1.sol";
import { AnyQuoteSharedHookV1 } from "./AnyQuoteSharedHookV1.sol";
import { IAnyQuoteSharedHookV1 } from "./IAnyQuoteSharedHookV1.sol";
import { IAnyQuoteLedgerV1 } from "./IAnyQuoteLedgerV1.sol";
import { ClassicModuleCalls } from "../../classic-modules/ClassicModuleCalls.sol";
import { IModuleEngineV1, IModuleEngineAdmissionV1 } from "../IModuleEngineV1.sol";
import { ModuleEngineCallsV1 } from "../ModuleEngineCallsV1.sol";
import { ModuleEngineTypesV1 as T } from "../ModuleEngineTypesV1.sol";

interface IAnyQuoteUniversalRouterV1 {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

/// @notice Source-bound Any Quote launches with one immutable shared fee hook and independently locked LP engines.
/// @dev Host swaps are optional. Fees also apply when users trade through normal external V4 routers.
contract ModuleEngineAnyQuoteHostV1 is ReentrancyGuardTransient, IModuleEngineAdmissionV1 {
    using SafeERC20 for IERC20;

    uint256 public constant TOKEN_SUPPLY = 1_000_000_000 ether;
    uint256 public constant MAX_CONFIGURATION_BYTES = 16_384;
    uint256 public constant MAX_IMMUTABLE_REFERENCES = 128;
    // Canonical ABI/metadata overhead 7,744 + init payload 48,896 + runtime 24,576 + two data fields 32,768.
    uint256 public constant MAX_LAUNCH_PARAMETERS_BYTES = 113_984;
    bytes32 public constant SOURCE_VERSION = keccak256("programmable.module-engine.any-quote.v1");

    UERC20Factory public immutable tokenFactory;
    ClassicModuleLaunchPolicyV1 public immutable launchPolicy;
    IModuleEngineReviewAuthorityV1 public immutable registry;
    IAnyQuoteSharedHookV1 public immutable sharedHook;
    AnyQuoteNativeRouteGuardV1 public immutable nativeRouteGuard;
    IAnyQuoteLedgerV1 public immutable ledger;
    IPoolManager public immutable quotePoolManager;
    bytes32 public immutable quotePoolManagerCodeHash;
    bytes32 public constant BUY = keccak256("spot.buy.exact-input.v1");
    bytes32 public constant SELL = keccak256("spot.sell.exact-input.v1");
    uint256 public constant CHAIN_ID = 4663;

    bytes32 public constant NATIVE_BUY = keccak256("spot.buy.native-exact-input.v1");
    uint256 public constant MAX_PREPARATION_AGE = 180;
    address public constant UNIVERSAL_ROUTER = 0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99;
    bytes32 public constant UNIVERSAL_ROUTER_CODE_HASH =
        0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5;
    bytes32 public constant TOKEN_FACTORY_CODE_HASH =
        0x9354ef051bafa1edccb95c91d999e31025c012ee8d93392a78a51d83594845f2;
    bytes32 public constant LAUNCH_POLICY_CODE_HASH =
        0x1c485a64c77174e0b2a78adf2527128792180def26cbab2ca00fcfa74b73ba91;
    bytes32 public constant NATIVE_ROUTE_GUARD_CODE_HASH =
        0x704f8f3c1903e1f15dd041b2dd29673a8c98bee9c87f645da90978c2315cf4ee;
    address private constant ROUTER_BALANCE = address(2);

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
    mapping(bytes32 launchId => bytes32 poolId) public poolIdOf;
    mapping(address engine => bytes32 launchId) public engineLaunchId;
    mapping(bytes32 launchId => mapping(address actor => uint256)) public nonces;

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
    error InvalidQuoteInfrastructure();

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
        address rewardAdmin_,
        bytes32 hookSalt_,
        AnyQuoteNativeRouteGuardV1 nativeRouteGuard_
    ) {
        if (
            address(tokenFactory_).codehash != TOKEN_FACTORY_CODE_HASH
                || address(launchPolicy_).codehash != LAUNCH_POLICY_CODE_HASH || address(registry_).code.length == 0
                || registry_.owner() == address(0)
        ) revert InvalidCodeBinding();
        if (
            block.chainid != CHAIN_ID || address(poolManager_).code.length == 0
                || UNIVERSAL_ROUTER.codehash != UNIVERSAL_ROUTER_CODE_HASH
                || address(nativeRouteGuard_).codehash != NATIVE_ROUTE_GUARD_CODE_HASH
        ) revert InvalidQuoteInfrastructure();
        quotePoolManager = poolManager_;
        quotePoolManagerCodeHash = address(poolManager_).codehash;
        tokenFactory = tokenFactory_;
        nativeRouteGuard = nativeRouteGuard_;
        launchPolicy = launchPolicy_;
        registry = registry_;
        sharedHook = IAnyQuoteSharedHookV1(
            address(new AnyQuoteSharedHookV1{ salt: hookSalt_ }(poolManager_, address(this), rewardAdmin_))
        );
        ledger = IAnyQuoteLedgerV1(sharedHook.ledger());
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
                || revision.coinRights != 0 || !revision.enabled || revision.executionGas < 50_000
                || revision.executionGas > 10_000_000 || runtimeOffsets.length != constructorOffsets.length
                || runtimeOffsets.length > MAX_IMMUTABLE_REFERENCES || eligibleFamilies.length > 8
        ) revert InvalidRevision();
        if (revision.initialOperationId != BUY || revision.moneyRights != 3 || permissions.length != 2) {
            revert InvalidRevision();
        }
        _requireFamily(revision.familyId);
        for (uint256 i; i < runtimeOffsets.length; ++i) {
            if ((i != 0 && runtimeOffsets[i] < uint256(runtimeOffsets[i - 1]) + 32) || constructorOffsets[i] % 32 != 0) revert InvalidConstructorBinding();
        }
        for (uint256 i; i < permissions.length; ++i) {
            T.Permission calldata grant = permissions[i];
            if (_permissions[revisionId][grant.operationId].operationId != 0) revert InvalidRevision();
            if (
                grant.authorization != T.AUTH_PUBLIC
                    || (grant.operationId == BUY
                        && (grant.inputRoles != T.ROLE_QUOTE || grant.outputRoles != T.ROLE_PRIMARY))
                    || (grant.operationId == SELL
                        && (grant.inputRoles != T.ROLE_PRIMARY || grant.outputRoles != T.ROLE_QUOTE))
                    || (grant.operationId != BUY && grant.operationId != SELL)
            ) revert InvalidRevision();
            _permissions[revisionId][grant.operationId] = grant;
        }
        // Exactly two distinct BUY/SELL grants above imply the mandatory BUY grant exists.
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

    function fixedConfigurationHash(bytes32 launchId) external view returns (bytes32) {
        Launch storage launched = _launches[launchId];
        if (launched.engine == address(0)) revert InvalidOperation();
        return _revisions[launched.revisionId].fixedConfigurationHash;
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
        A.Configuration memory config = abi.decode(parameters.configuration, (A.Configuration));
        poolIdOf[result.launchId] = sharedHook.registerPool(
            A.PoolRegistration({
                launchId: result.launchId,
                revisionId: result.revisionId,
                familyId: revision.familyId,
                configurationHash: result.configurationHash,
                token: result.token,
                quoteAsset: result.quoteAsset,
                initializer: result.engine,
                initialTick: config.initialTick,
                buyCreatorFeeBps: result.buyCreatorFeeBps,
                sellCreatorFeeBps: result.sellCreatorFeeBps
            }),
            parameters.creatorWallets,
            parameters.creatorSharesBps
        );
        IERC20(result.token).safeTransfer(result.engine, TOKEN_SUPPLY);
        if (IERC20(result.token).balanceOf(result.engine) != TOKEN_SUPPLY) revert InvalidToken();
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
        _launches[result.launchId].resourcesHash = result.resourcesHash;
        if (parameters.initialOperation.operationId == NATIVE_BUY) {
            _executeNativeInitialBuy(result, parameters.initialOperation);
        } else if (parameters.initialOperation.operationId != 0) {
            if (parameters.initialOperation.operationId != revision.initialOperationId) revert InvalidOperation();
            _execute(result, parameters.initialOperation);
        } else {
            if (parameters.initialOperation.data.length != 0) revert InvalidOperation();
            if (msg.value != 0) revert InvalidFunding();
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

    function quoteFeeProfileId() external pure returns (bytes32) {
        return A.PROFILE_ID;
    }

    function _validateLaunch(LaunchParameters calldata p, T.Revision storage revision) private view {
        if (!revision.enabled) revert UnavailableRevision();
        if (p.configuration.length != 256 || p.launchData.length != 0) revert InvalidQuoteInfrastructure();
        A.Configuration memory configuration = abi.decode(p.configuration, (A.Configuration));
        if (
            configuration.schemaId != A.SCHEMA_ID || configuration.poolManager != address(quotePoolManager)
                || configuration.poolManagerCodeHash != quotePoolManagerCodeHash
                || address(quotePoolManager).codehash != quotePoolManagerCodeHash
                || configuration.sharedHook != address(sharedHook) || configuration.quoteAsset != p.quoteAsset
                || p.quoteAsset == address(quotePoolManager) || p.quoteAsset == address(this)
                || p.quoteAsset == address(sharedHook) || p.quoteAsset == address(ledger)
                || configuration.initialTick <= TickMath.minUsableTick(A.TICK_SPACING)
                || configuration.initialTick >= TickMath.maxUsableTick(A.TICK_SPACING)
                || configuration.initialTick % A.TICK_SPACING != 0 || configuration.validUntil <= block.timestamp
                || configuration.validUntil > block.timestamp + MAX_PREPARATION_AGE
                || configuration.priceEvidenceHash == bytes32(0)
        ) revert InvalidQuoteInfrastructure();
        if (p.quoteAsset.code.length == 0 || IERC20Metadata(p.quoteAsset).decimals() > 36) revert UnsupportedAsset();
        if (
            (revision.fixedQuoteAsset != address(0) && p.quoteAsset != revision.fixedQuoteAsset)
                || (revision.fixedConfigurationHash != 0
                    && keccak256(p.configuration) != revision.fixedConfigurationHash)
        ) revert FixedValueOverride();
        if (
            p.initialOperation.data.length > MAX_CONFIGURATION_BYTES || p.creationCode.length + 512 > 49_152
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
        _createToken(p, r.token, graffiti);
        T.Context memory context =
            T.Context(address(this), r.launchId, r.token, msg.sender, r.quoteAsset, address(ledger));
        bytes memory constructorArgs = abi.encode(context, p.configuration);
        r.constructorHash = keccak256(constructorArgs);
        bytes memory initCode = bytes.concat(p.creationCode, constructorArgs);
        r.initCodeHash = keccak256(initCode);
        r.engineCodeHash = _runtimeHash(p.revisionId, p.runtimeTemplate, constructorArgs);
        bytes32 salt = keccak256(abi.encode(msg.sender, p.engineSalt, r.launchId));
        r.engine = Create2.deploy(0, salt, initCode);
        if (r.engine.codehash != r.engineCodeHash) revert InvalidCodeBinding();
        _assertContext(r.engine, context);
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
        bool buy = requested.operationId == BUY;
        if (
            (requested.operationId != BUY && requested.operationId != SELL) || requested.inputAmount == 0
                || requested.inputAmount > uint256(uint128(type(int128).max)) || requested.minimumOutput == 0
                || requested.deadline == 0 || requested.recipient == r.engine || requested.recipient == address(this)
                || requested.recipient == address(ledger) || requested.recipient == address(quotePoolManager)
                || requested.inputAsset != (buy ? r.quoteAsset : r.token)
                || requested.outputAsset != (buy ? r.token : r.quoteAsset)
        ) revert InvalidOperation();
        if (address(quotePoolManager).codehash != quotePoolManagerCodeHash) revert InvalidQuoteInfrastructure();
        T.Permission storage allowed = _permissions[r.revisionId][requested.operationId];
        if (
            allowed.operationId == 0 || requested.recipient == address(0)
                || requested.data.length > MAX_CONFIGURATION_BYTES
        ) {
            revert InvalidOperation();
        }
        if (requested.actor != msg.sender) revert UnauthorizedOperation();
        if (requested.deadline < block.timestamp) revert DeadlineExpired();
        if (requested.nonce != nonces[r.launchId][msg.sender]++) revert StaleNonce();
        if (r.engine.codehash != r.engineCodeHash) revert InvalidCodeBinding();
        uint256 beforeOutput = IERC20(requested.outputAsset).balanceOf(requested.recipient);
        if (msg.value != 0) revert InvalidFunding();
        _pullExactly(requested.inputAsset, r.engine, requested.inputAmount);
        result = abi.decode(
            ModuleEngineCallsV1.invoke(
                r.engine,
                0,
                _revisions[r.revisionId].executionGas,
                abi.encodeCall(IModuleEngineV1.execute, (requested)),
                MAX_CONFIGURATION_BYTES + 64
            ),
            (bytes)
        );
        uint256 afterOutput = IERC20(requested.outputAsset).balanceOf(requested.recipient);
        if (afterOutput < beforeOutput || afterOutput - beforeOutput < requested.minimumOutput) {
            revert InsufficientOutput();
        }
        _emitOperation(r.launchId, requested, afterOutput - beforeOutput, keccak256(result));
    }

    /// @dev Native buys are a launch-only convenience. The router receives exactly this caller's funding;
    ///      the host never approves it or Permit2, and checks the recipient's actual final token balance.
    function _executeNativeInitialBuy(Launch memory r, T.Operation calldata requested) private {
        if (
            requested.actor != msg.sender || requested.recipient == address(0) || requested.recipient == address(1)
                || requested.recipient == ROUTER_BALANCE || requested.recipient == address(this)
                || requested.recipient == r.engine || requested.recipient == address(sharedHook)
                || requested.recipient == address(ledger) || requested.recipient == address(quotePoolManager)
                || requested.recipient == UNIVERSAL_ROUTER || requested.inputAsset != address(0)
                || requested.outputAsset != r.token || requested.inputAmount == 0
                || requested.inputAmount > uint256(uint128(type(int128).max)) || requested.minimumOutput == 0
                || requested.deadline == 0 || requested.data.length > MAX_CONFIGURATION_BYTES
        ) revert InvalidOperation();
        if (requested.deadline < block.timestamp) revert DeadlineExpired();
        if (requested.nonce != nonces[r.launchId][msg.sender]++) revert StaleNonce();
        if (msg.value != requested.inputAmount) revert InvalidFunding();
        if (
            UNIVERSAL_ROUTER.codehash != UNIVERSAL_ROUTER_CODE_HASH
                || address(quotePoolManager).codehash != quotePoolManagerCodeHash
        ) revert InvalidQuoteInfrastructure();
        bytes memory routerData = nativeRouteGuard.routerCallData(
            requested.data, requested.recipient, requested.inputAmount, requested.deadline
        );
        uint256 beforeOutput = IERC20(r.token).balanceOf(requested.recipient);
        uint256 nativeBefore = address(this).balance - msg.value;
        uint256 tokenBefore = IERC20(r.token).balanceOf(address(this));
        uint256 quoteBefore = IERC20(r.quoteAsset).balanceOf(address(this));
        ModuleEngineCallsV1.invoke(UNIVERSAL_ROUTER, msg.value, _revisions[r.revisionId].executionGas, routerData, 0);
        uint256 afterOutput = IERC20(r.token).balanceOf(requested.recipient);
        if (afterOutput < beforeOutput || afterOutput - beforeOutput < requested.minimumOutput) {
            revert InsufficientOutput();
        }
        if (
            address(this).balance != nativeBefore || IERC20(r.token).balanceOf(address(this)) != tokenBefore
                || IERC20(r.quoteAsset).balanceOf(address(this)) != quoteBefore
        ) revert InvalidFunding();
        _emitOperation(r.launchId, requested, afterOutput - beforeOutput, keccak256(requested.data));
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
        return keccak256(abi.encode("programmable.module-engine.any-quote-token.v1", creator, salt));
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
            A.ECONOMICS_POLICY_ID,
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
