// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { IHookEvents } from "@openzeppelin/uniswap-hooks/src/interfaces/IHookEvents.sol";
import { CurrencySettler } from "@openzeppelin/uniswap-hooks/src/utils/CurrencySettler.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { ProtocolFeeLibrary } from "@uniswap/v4-core/src/libraries/ProtocolFeeLibrary.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary,
    toBeforeSwapDelta
} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { IHookSwapEvents } from "../interfaces/IHookSwapEvents.sol";
import { ClassicModuleTypes as T } from "./ClassicModuleTypes.sol";
import { ClassicModuleRecipeV1 } from "./ClassicModuleRecipeV1.sol";
import { IClassicModuleV1 } from "./IClassicModuleV1.sol";
import { ClassicModuleCalls } from "./ClassicModuleCalls.sol";
import { ClassicModuleRegistryV1 } from "./ClassicModuleRegistryV1.sol";
import { ClassicModuleFeeLedgerV1, IClassicModuleAuthorRegistry } from "./ClassicModuleFeeLedgerV1.sol";

interface IClassicModuleTokenCreator {
    function creator() external view returns (address);
}

/// @notice One immutable V4 engine composes reviewed, bounded effect providers; recipes are snapshots at registration.
/// @dev Native quote only. Creator fees are additional to 20 bps protocol fees. No admin can change an existing recipe.
contract ClassicModuleHookV1 is BaseHook, IHookEvents, IHookSwapEvents {
    using SafeCast for *;
    using CurrencySettler for Currency;

    uint16 public constant PROTOCOL_FEE_BPS = 20;
    uint16 public constant MAX_CREATOR_FEE_BPS = 1000;
    uint16 public constant CREATOR_FEE_STEP_BPS = 100;
    uint24 public constant LP_FEE_PIPS = 0;
    int24 public constant TICK_SPACING = 200;
    Currency private constant NATIVE = Currency.wrap(address(0));

    ClassicModuleRegistryV1 public immutable registry;
    ClassicModuleFeeLedgerV1 public immutable ledger;

    struct PoolConfig {
        address registrar;
        address launchWallet;
        uint64 createdAt;
        uint16 buyCreatorFeeBps;
        uint16 sellCreatorFeeBps;
        bytes32 recipeHash;
    }

    struct PendingSwap {
        bytes32 requestHash;
        address sender;
        uint16 creatorFeeBps;
        uint256 quoteLimit;
    }

    mapping(bytes32 => PoolConfig) public poolConfig;
    mapping(bytes32 => T.ModuleSnapshot[]) private _modules;
    mapping(bytes32 => PendingSwap) private _pending;

    error InvalidDependency();
    error InvalidPool();
    error InvalidRegistrar();
    error InvalidCreatorFee();
    error InvalidModuleCount();
    error UnavailableModule(bytes32 versionId);
    error InvalidModuleOrder(bytes32 familyId);
    error ExclusiveEffectConflict();
    error InvalidModuleConfig(bytes32 versionId);
    error ModuleCodeChanged(bytes32 versionId);
    error InvalidModuleEffect(bytes32 versionId);
    error SwapAlreadyActive();
    error InvalidSwapContext();
    error PartialFillUnsupported();
    error QuoteLimitExceeded(uint256 grossQuote, uint256 limit);

    event RecipeRegistered(bytes32 indexed poolId, bytes32 indexed recipeHash, address indexed launchWallet);
    event RecipeModuleBound(
        bytes32 indexed poolId,
        bytes32 indexed versionId,
        bytes32 indexed familyId,
        address implementation,
        bytes32 codeHash,
        uint8 kind,
        bytes config
    );
    event NativeFeesAccrued(
        bytes32 indexed poolId, bool isBuy, uint256 grossNative, uint256 platformFee, uint256 creatorFee
    );

    constructor(
        IPoolManager poolManager_,
        ClassicModuleRegistryV1 registry_,
        address treasury,
        address rewardAdmin,
        address noModuleRecipient
    ) BaseHook(poolManager_) {
        if (address(poolManager_).code.length == 0 || address(registry_).code.length == 0) {
            revert InvalidDependency();
        }
        registry = registry_;
        ledger = new ClassicModuleFeeLedgerV1(
            poolManager_, IClassicModuleAuthorRegistry(address(registry_)), treasury, rewardAdmin, noModuleRecipient
        );
    }

    /// @dev Registration itself does not confer Programmable provenance. Only the manifest-bound launcher does.
    function registerPool(PoolKey calldata key, T.PoolRegistration calldata registration)
        external
        returns (bytes32 recipeHash)
    {
        _validateShape(key);
        bytes32 poolId = PoolId.unwrap(key.toId());
        if (poolConfig[poolId].registrar != address(0) || registration.launchWallet == address(0)) {
            revert InvalidPool();
        }
        if (IClassicModuleTokenCreator(Currency.unwrap(key.currency1)).creator() != msg.sender) {
            revert InvalidRegistrar();
        }
        T.ModuleSnapshot[] memory snapshots;
        (recipeHash, snapshots) =
            previewRecipe(registration.buyCreatorFeeBps, registration.sellCreatorFeeBps, registration.modules);
        poolConfig[poolId] = PoolConfig(
            msg.sender,
            registration.launchWallet,
            uint64(block.timestamp),
            registration.buyCreatorFeeBps,
            registration.sellCreatorFeeBps,
            recipeHash
        );
        bytes32[] memory families = new bytes32[](snapshots.length);
        for (uint256 i; i < snapshots.length; ++i) {
            T.ModuleSnapshot memory snapshot = snapshots[i];
            _modules[poolId].push(snapshot);
            families[i] = snapshot.familyId;
            emit RecipeModuleBound(
                poolId,
                snapshot.versionId,
                snapshot.familyId,
                snapshot.implementation,
                snapshot.codeHash,
                snapshot.kind,
                snapshot.config
            );
        }
        ledger.registerPool(poolId, registration.creatorWallets, registration.creatorSharesBps, families);
        // Validate the composition at launch time, including limits and fee-only capabilities.
        quotePolicy(poolId);
        emit RecipeRegistered(poolId, recipeHash, registration.launchWallet);
    }

    function previewRecipe(uint16 buyFee, uint16 sellFee, T.ModuleSelection[] calldata selections)
        public
        view
        returns (bytes32 recipeHash, T.ModuleSnapshot[] memory snapshots)
    {
        _validateBaseFee(buyFee);
        _validateBaseFee(sellFee);
        if (selections.length > T.MAX_MODULES) revert InvalidModuleCount();
        snapshots = new T.ModuleSnapshot[](selections.length);
        bytes32[] memory hashes = new bytes32[](selections.length);
        bool hasFeePolicy;
        bytes32 previousFamily;
        for (uint256 i; i < selections.length; ++i) {
            T.ModuleSnapshot memory snapshot = _snapshot(selections[i], buyFee, sellFee);
            if (snapshot.familyId <= previousFamily) revert InvalidModuleOrder(snapshot.familyId);
            previousFamily = snapshot.familyId;
            if (snapshot.kind == T.FEE_POLICY) {
                if (hasFeePolicy) revert ExclusiveEffectConflict();
                hasFeePolicy = true;
            }
            snapshots[i] = snapshot;
            hashes[i] = ClassicModuleRecipeV1.snapshotHash(snapshot);
        }
        recipeHash =
            ClassicModuleRecipeV1.recipeHash(block.chainid, address(this), address(registry), buyFee, sellFee, hashes);
    }

    function _snapshot(T.ModuleSelection calldata selection, uint16 buyFee, uint16 sellFee)
        private
        view
        returns (T.ModuleSnapshot memory)
    {
        ClassicModuleRegistryV1.Version memory version = registry.getVersion(selection.versionId);
        if (!version.enabled) revert UnavailableModule(selection.versionId);
        if (version.implementation.codehash != version.codeHash) revert ModuleCodeChanged(selection.versionId);
        if (selection.config.length > T.MAX_CONFIG_BYTES) revert InvalidModuleConfig(selection.versionId);
        bytes memory valid = ClassicModuleCalls.read(
            version.implementation,
            abi.encodeCall(IClassicModuleV1.validateConfig, (selection.config, buyFee, sellFee)),
            32
        );
        if (abi.decode(valid, (uint256)) != 1) revert InvalidModuleConfig(selection.versionId);
        return T.ModuleSnapshot(
            selection.versionId,
            version.familyId,
            version.implementation,
            version.codeHash,
            version.kind,
            selection.config
        );
    }

    function recipeOf(bytes32 poolId) external view returns (bytes32) {
        return _config(poolId).recipeHash;
    }

    function recipeModules(bytes32 poolId) external view returns (T.ModuleSnapshot[] memory) {
        _config(poolId);
        return _modules[poolId];
    }

    /// @notice Evaluates a snapshot, without consulting mutable catalogue availability.
    function quotePolicy(bytes32 poolId) public view returns (T.Effect memory policy) {
        PoolConfig storage config = _config(poolId);
        policy.buyCreatorFeeBps = config.buyCreatorFeeBps;
        policy.sellCreatorFeeBps = config.sellCreatorFeeBps;
        T.Context memory context = T.Context(
            poolId, uint64(block.timestamp - config.createdAt), config.buyCreatorFeeBps, config.sellCreatorFeeBps
        );
        T.ModuleSnapshot[] storage modules = _modules[poolId];
        for (uint256 i; i < modules.length; ++i) {
            T.ModuleSnapshot storage module = modules[i];
            if (module.implementation.codehash != module.codeHash) revert ModuleCodeChanged(module.versionId);
            T.Effect memory effect = abi.decode(
                ClassicModuleCalls.read(
                    module.implementation, abi.encodeCall(IClassicModuleV1.evaluate, (context, module.config)), 128
                ),
                (T.Effect)
            );
            if (module.kind == T.FEE_POLICY) {
                if (
                    effect.buyCreatorFeeBps > config.buyCreatorFeeBps
                        || effect.sellCreatorFeeBps > config.sellCreatorFeeBps || effect.buyQuoteLimit != 0
                        || effect.sellQuoteLimit != 0
                ) revert InvalidModuleEffect(module.versionId);
                policy.buyCreatorFeeBps = effect.buyCreatorFeeBps;
                policy.sellCreatorFeeBps = effect.sellCreatorFeeBps;
            } else if (module.kind == T.TRADE_LIMIT) {
                if (effect.buyCreatorFeeBps != 0 || effect.sellCreatorFeeBps != 0) {
                    revert InvalidModuleEffect(module.versionId);
                }
                policy.buyQuoteLimit = _intersection(policy.buyQuoteLimit, effect.buyQuoteLimit);
                policy.sellQuoteLimit = _intersection(policy.sellQuoteLimit, effect.sellQuoteLimit);
            } else {
                revert InvalidModuleEffect(module.versionId);
            }
        }
    }

    function quoteGrossFees(uint256 grossNative, uint16 creatorFeeBps)
        external
        pure
        returns (uint256 creatorFee, uint256 platformFee)
    {
        return _fees(grossNative, creatorFeeBps, false);
    }

    /// @notice Current hook rates and separate PoolManager fees. Pool protocol fees can be set by Uniswap authority.
    /// @dev These use different bases; a UI must quote the route, not add pips and bps as a single flat rate.
    function feeComponents(bytes32 poolId, bool isBuy)
        external
        view
        returns (uint16 creatorBps, uint16 platformBps, uint16 poolProtocolPips, uint24 poolLpPips)
    {
        T.Effect memory policy = quotePolicy(poolId);
        creatorBps = isBuy ? policy.buyCreatorFeeBps : policy.sellCreatorFeeBps;
        platformBps = PROTOCOL_FEE_BPS;
        uint24 packedProtocol;
        (,, packedProtocol, poolLpPips) = StateLibrary.getSlot0(poolManager, PoolId.wrap(poolId));
        poolProtocolPips = isBuy
            ? ProtocolFeeLibrary.getZeroForOneFee(packedProtocol)
            : ProtocolFeeLibrary.getOneForZeroFee(packedProtocol);
    }

    function quoteExactOutputFees(uint256 netNative, uint16 creatorFeeBps)
        external
        pure
        returns (uint256 creatorFee, uint256 platformFee)
    {
        return _fees(netNative, creatorFeeBps, true);
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory p) {
        p.beforeInitialize = true;
        p.beforeSwap = true;
        p.afterSwap = true;
        p.beforeSwapReturnDelta = true;
        p.afterSwapReturnDelta = true;
    }

    function _beforeInitialize(address sender, PoolKey calldata key, uint160) internal view override returns (bytes4) {
        _validateShape(key);
        if (_config(PoolId.unwrap(key.toId())).registrar != sender) revert InvalidRegistrar();
        return IHooks.beforeInitialize.selector;
    }

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        _validateShape(key);
        bytes32 poolId = PoolId.unwrap(key.toId());
        if (_pending[poolId].requestHash != bytes32(0)) revert SwapAlreadyActive();
        if (params.amountSpecified == 0) revert InvalidSwapContext();
        T.Effect memory policy = quotePolicy(poolId);
        PendingSwap memory pending = PendingSwap(
            keccak256(abi.encode(sender, params)),
            sender,
            params.zeroForOne ? policy.buyCreatorFeeBps : policy.sellCreatorFeeBps,
            params.zeroForOne ? policy.buyQuoteLimit : policy.sellQuoteLimit
        );
        _pending[poolId] = pending;
        bool nativeSpecified = params.zeroForOne == (params.amountSpecified < 0);
        if (!nativeSpecified) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        uint256 fee = _charge(poolId, params, _absolute(params.amountSpecified), pending);
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(fee.toInt256().toInt128(), 0), 0);
    }

    function _afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) internal override returns (bytes4, int128) {
        _validateShape(key);
        bytes32 poolId = PoolId.unwrap(key.toId());
        PendingSwap memory pending = _pending[poolId];
        if (pending.requestHash != keccak256(abi.encode(sender, params))) revert InvalidSwapContext();
        delete _pending[poolId];
        bool nativeSpecified = params.zeroForOne == (params.amountSpecified < 0);
        uint256 specified = _absolute(params.amountSpecified);
        if (nativeSpecified) {
            (uint256 creatorFee, uint256 platformFee) =
                _fees(specified, pending.creatorFeeBps, params.amountSpecified > 0);
            uint256 fee = creatorFee + platformFee;
            uint256 expected = params.amountSpecified > 0 ? specified + fee : specified - fee;
            if (_absolute(int256(delta.amount0())) != expected) revert PartialFillUnsupported();
            return (IHooks.afterSwap.selector, 0);
        }
        if (_absolute(int256(delta.amount1())) != specified) revert PartialFillUnsupported();
        uint256 charged = _charge(poolId, params, _absolute(int256(delta.amount0())), pending);
        return (IHooks.afterSwap.selector, charged.toInt256().toInt128());
    }

    function _charge(bytes32 poolId, SwapParams calldata params, uint256 nativeAmount, PendingSwap memory pending)
        private
        returns (uint256 fee)
    {
        bool amountIsNet = params.amountSpecified > 0;
        (uint256 creatorFee, uint256 platformFee) = _fees(nativeAmount, pending.creatorFeeBps, amountIsNet);
        fee = creatorFee + platformFee;
        uint256 gross = nativeAmount + (amountIsNet ? fee : 0);
        if (pending.quoteLimit != 0 && gross > pending.quoteLimit) {
            revert QuoteLimitExceeded(gross, pending.quoteLimit);
        }
        if (fee == 0) return 0;
        // Mint fully backed native claims before notifying the fixed ledger. It never calls recipients during accrual.
        NATIVE.take(poolManager, address(ledger), fee, true);
        ledger.accrue(poolId, platformFee, creatorFee);
        emit HookFee(poolId, pending.sender, fee.toUint128(), 0);
        emit HookSwap(
            PoolId.wrap(poolId),
            pending.sender,
            -fee.toInt256().toInt128(),
            0,
            uint24(pending.creatorFeeBps + PROTOCOL_FEE_BPS) * 100
        );
        emit NativeFeesAccrued(poolId, params.zeroForOne, gross, platformFee, creatorFee);
    }

    function _fees(uint256 nativeAmount, uint16 creatorBps, bool amountIsNet)
        private
        pure
        returns (uint256 creatorFee, uint256 platformFee)
    {
        if (creatorBps > MAX_CREATOR_FEE_BPS) revert InvalidCreatorFee();
        uint256 totalBps = creatorBps + PROTOCOL_FEE_BPS;
        uint256 gross = amountIsNet ? FullMath.mulDivRoundingUp(nativeAmount, 10_000, 10_000 - totalBps) : nativeAmount;
        uint256 total = amountIsNet ? gross - nativeAmount : FullMath.mulDiv(gross, totalBps, 10_000);
        if (creatorBps == 0) return (0, total);
        platformFee = FullMath.mulDiv(gross, PROTOCOL_FEE_BPS, 10_000);
        creatorFee = total - platformFee;
    }

    function _validateBaseFee(uint16 fee) private pure {
        if (fee > MAX_CREATOR_FEE_BPS || fee % CREATOR_FEE_STEP_BPS != 0) revert InvalidCreatorFee();
    }

    function _validateShape(PoolKey calldata key) private view {
        if (
            Currency.unwrap(key.currency0) != address(0) || Currency.unwrap(key.currency1).code.length == 0
                || address(key.hooks) != address(this) || key.fee != LP_FEE_PIPS || key.tickSpacing != TICK_SPACING
        ) {
            revert InvalidPool();
        }
    }

    function _config(bytes32 poolId) private view returns (PoolConfig storage config) {
        config = poolConfig[poolId];
        if (config.registrar == address(0)) revert InvalidPool();
    }

    function _intersection(uint256 a, uint256 b) private pure returns (uint256) {
        return a == 0 ? b : b == 0 ? a : a < b ? a : b;
    }

    function _absolute(int256 value) private pure returns (uint256) {
        return value >= 0 ? uint256(value) : uint256(-(value + 1)) + 1;
    }
}
