// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
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
import {
    ClassicModuleFeeLedgerV1,
    IClassicModuleAuthorRegistry
} from "../../classic-modules/ClassicModuleFeeLedgerV1.sol";
import { ModuleRuntimeTypesV1 as T } from "../ModuleRuntimeTypesV1.sol";
import { ModuleNativeRuntimeV1 } from "../ModuleNativeRuntimeV1.sol";
import { ModuleNativeRegistryV1 } from "./ModuleNativeRegistryV1.sol";
import { ModuleNativeRuntimeFactoryV1 } from "./ModuleNativeRuntimeFactoryV1.sol";
import { ModuleNativeEngineTypesV1 as E } from "./ModuleNativeEngineTypesV1.sol";

interface IModuleNativeTokenCreatorV1 {
    function creator() external view returns (address);
}

interface IModuleNativeRouteBindingV1 {
    function source() external view returns (address);
    function poolManager() external view returns (IPoolManager);
    function hook() external view returns (address);
}

/// @notice Native ETH/token V4 engine with immutable package instances and atomic stateful callbacks.
/// @dev Every supported swap goes through its launch's pinned router. Other pools and transfers are outside this
///      policy. Module programs receive neither LP custody nor Creator/author fee withdrawal authority.
contract ModuleNativeHookV1 is BaseHook {
    using SafeCast for *;
    using CurrencySettler for Currency;

    uint16 public constant PROTOCOL_FEE_BPS = 20;
    uint16 public constant MAX_CREATOR_FEE_BPS = 1000;
    uint16 public constant CREATOR_FEE_STEP_BPS = 100;
    uint24 public constant LP_FEE_PIPS = 0;
    int24 public constant TICK_SPACING = 200;
    uint256 public constant MAX_MODULE_FAMILIES = 8;
    Currency private constant NATIVE = Currency.wrap(address(0));

    ModuleNativeRegistryV1 public immutable registry;
    ModuleNativeRuntimeFactoryV1 public immutable runtimeFactory;
    ClassicModuleFeeLedgerV1 public immutable ledger;
    ModuleNativeRuntimeV1 public runtime;

    struct PoolConfig {
        address registrar;
        address launchWallet;
        address router;
        bytes32 routerCodeHash;
        uint16 buyCreatorFeeBps;
        uint16 sellCreatorFeeBps;
        bytes32 recipeHash;
        bytes32 launchKey;
    }

    struct PendingSwap {
        bytes32 requestHash;
        uint16 creatorFeeBps;
        E.RouteContext route;
    }
    mapping(bytes32 => PoolConfig) public poolConfig;
    bytes32 private _activeSwapPool;
    PendingSwap private _pending;
    bool private _registering;

    error InvalidDependency();
    error InvalidPool();
    error InvalidRegistrar();
    error InvalidRouter();
    error InvalidCreatorFee();
    error InvalidModuleCount();
    error InvalidModuleOrder(bytes32 familyId);
    error SwapAlreadyActive();
    error InvalidSwapContext();
    error PartialFillUnsupported();

    event NativeRecipeRegistered(
        bytes32 indexed poolId,
        bytes32 indexed recipeHash,
        bytes32 indexed launchKey,
        address source,
        address launchWallet,
        address router
    );
    event NativeFeesAccrued(
        bytes32 indexed poolId,
        address indexed actor,
        bool isBuy,
        uint256 grossNative,
        uint256 platformFee,
        uint256 creatorFee
    );
    event RuntimeCreated(address indexed runtime, address indexed vault);

    constructor(
        IPoolManager poolManager_,
        ModuleNativeRegistryV1 registry_,
        ModuleNativeRuntimeFactoryV1 runtimeFactory_,
        address treasury,
        address rewardAdmin,
        address noModuleRecipient
    ) BaseHook(poolManager_) {
        if (
            address(poolManager_).code.length == 0
                || address(registry_).codehash != keccak256(type(ModuleNativeRegistryV1).runtimeCode)
                || address(runtimeFactory_).codehash != keccak256(type(ModuleNativeRuntimeFactoryV1).runtimeCode)
        ) revert InvalidDependency();
        registry = registry_;
        runtimeFactory = runtimeFactory_;
        ledger = new ClassicModuleFeeLedgerV1(
            poolManager_, IClassicModuleAuthorRegistry(address(registry_)), treasury, rewardAdmin, noModuleRecipient
        );
    }

    /// @notice Anyone may finish this fixed deployment step. The runtime target/code cannot be chosen or replaced.
    function ensureRuntime() public returns (ModuleNativeRuntimeV1 result) {
        result = runtime;
        if (address(result) == address(0)) {
            result = runtimeFactory.create();
            runtime = result;
            emit RuntimeCreated(address(result), address(result.vault()));
        }
    }

    function previewRecipe(uint16 buyFee, uint16 sellFee, T.Selection[] calldata modules)
        public
        view
        returns (bytes32 recipeHash, bytes32[] memory families)
    {
        _validateBaseFee(buyFee);
        _validateBaseFee(sellFee);
        if (modules.length > MAX_MODULE_FAMILIES) revert InvalidModuleCount();
        families = new bytes32[](modules.length);
        bytes32 previous;
        for (uint256 i; i < modules.length; ++i) {
            families[i] = registry.validateSelection(modules[i]);
            if (families[i] <= previous) revert InvalidModuleOrder(families[i]);
            previous = families[i];
        }
        recipeHash = keccak256(
            abi.encode(
                "programmable.module-mode.native-recipe.v1",
                block.chainid,
                address(this),
                address(registry),
                buyFee,
                sellFee,
                families,
                modules
            )
        );
    }

    /// @dev A manifest-authenticated launcher establishes provenance; implementing token.creator alone does not.
    function registerPool(PoolKey calldata key, E.PoolRegistration calldata registration)
        external
        returns (bytes32 recipeHash)
    {
        if (_activeSwapPool != bytes32(0) || _registering) revert SwapAlreadyActive();
        _registering = true;
        _validateShape(key);
        bytes32 poolId = PoolId.unwrap(key.toId());
        if (poolConfig[poolId].registrar != address(0) || registration.launchWallet == address(0)) {
            revert InvalidPool();
        }
        if (IModuleNativeTokenCreatorV1(Currency.unwrap(key.currency1)).creator() != msg.sender) {
            revert InvalidRegistrar();
        }
        IModuleNativeRouteBindingV1 router = IModuleNativeRouteBindingV1(registration.router);
        if (
            registration.router.code.length == 0 || router.source() != msg.sender
                || address(router.poolManager()) != address(poolManager) || router.hook() != address(this)
        ) revert InvalidRouter();
        bytes32[] memory families;
        (recipeHash, families) =
            previewRecipe(registration.buyCreatorFeeBps, registration.sellCreatorFeeBps, registration.modules);
        ModuleNativeRuntimeV1 host = ensureRuntime();
        T.LaunchBinding memory binding = T.LaunchBinding(
            msg.sender,
            registration.launchWallet,
            Currency.unwrap(key.currency1),
            address(poolManager),
            poolId,
            recipeHash,
            host.programHash(registration.modules)
        );
        bytes32 launchKey = host.registerLaunch(binding, registration.modules);
        poolConfig[poolId] = PoolConfig(
            msg.sender,
            registration.launchWallet,
            registration.router,
            registration.router.codehash,
            registration.buyCreatorFeeBps,
            registration.sellCreatorFeeBps,
            recipeHash,
            launchKey
        );
        ledger.registerPool(poolId, registration.creatorWallets, registration.creatorSharesBps, families);
        _registering = false;
        emit NativeRecipeRegistered(
            poolId, recipeHash, launchKey, msg.sender, registration.launchWallet, registration.router
        );
    }

    function recipeOf(bytes32 poolId) external view returns (bytes32) {
        return _config(poolId).recipeHash;
    }

    function launchKeyOf(bytes32 poolId) external view returns (bytes32) {
        return _config(poolId).launchKey;
    }

    function routerOf(bytes32 poolId) external view returns (address) {
        return _config(poolId).router;
    }

    function quoteGrossFees(uint256 amount, uint16 bps) external pure returns (uint256 creator, uint256 platform) {
        return _fees(amount, bps, false);
    }

    function quoteExactOutputFees(uint256 amount, uint16 bps)
        external
        pure
        returns (uint256 creator, uint256 platform)
    {
        return _fees(amount, bps, true);
    }

    /// @dev PoolManager protocol fees are a separate base controlled by its own authority. Quote the actual route.
    function feeComponents(bytes32 poolId, bool isBuy)
        external
        view
        returns (uint16 creatorBps, uint16 platformBps, uint16 poolProtocolPips, uint24 poolLpPips)
    {
        PoolConfig storage config = _config(poolId);
        creatorBps = isBuy ? config.buyCreatorFeeBps : config.sellCreatorFeeBps;
        platformBps = PROTOCOL_FEE_BPS;
        uint24 packedProtocol;
        (,, packedProtocol, poolLpPips) = StateLibrary.getSlot0(poolManager, PoolId.wrap(poolId));
        poolProtocolPips = isBuy
            ? ProtocolFeeLibrary.getZeroForOneFee(packedProtocol)
            : ProtocolFeeLibrary.getOneForZeroFee(packedProtocol);
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

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        _validateShape(key);
        if (_activeSwapPool != bytes32(0) || _registering) revert SwapAlreadyActive();
        bytes32 poolId = PoolId.unwrap(key.toId());
        PoolConfig storage config = _config(poolId);
        if (sender != config.router || sender.codehash != config.routerCodeHash) revert InvalidRouter();
        if (params.amountSpecified == 0 || hookData.length != 160) revert InvalidSwapContext();
        E.RouteContext memory route = abi.decode(hookData, (E.RouteContext));
        if (
            route.actor == address(0) || route.actor != route.payer || route.recipient == address(0)
                || route.sequence != runtime.lastTradeSequence(config.launchKey) + 1
                || route.initialBuy != (route.sequence == 1)
                || (route.initialBuy && (!params.zeroForOne || route.actor != config.launchWallet))
        ) revert InvalidSwapContext();
        _activeSwapPool = poolId;
        _pending = PendingSwap(
            keccak256(abi.encode(sender, params, hookData)),
            params.zeroForOne ? config.buyCreatorFeeBps : config.sellCreatorFeeBps,
            route
        );
        bool nativeSpecified = params.zeroForOne == (params.amountSpecified < 0);
        if (!nativeSpecified) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        uint256 fee = _charge(poolId, params, _absolute(params.amountSpecified), _pending);
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(fee.toInt256().toInt128(), 0), 0);
    }

    function _afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) internal override returns (bytes4, int128) {
        _validateShape(key);
        bytes32 poolId = PoolId.unwrap(key.toId());
        PendingSwap memory pending = _pending;
        if (_activeSwapPool != poolId || pending.requestHash != keccak256(abi.encode(sender, params, hookData))) {
            revert InvalidSwapContext();
        }
        (uint256 gross, uint256 charged) = _settleHookFees(poolId, params, delta, pending);
        _applyTrade(poolId, params, delta, pending.route, gross);
        // Keep the guard through every program callback. A later settlement or slippage failure reverts all effects.
        delete _pending;
        delete _activeSwapPool;
        return (IHooks.afterSwap.selector, charged.toInt256().toInt128());
    }

    function _settleHookFees(bytes32 poolId, SwapParams calldata params, BalanceDelta delta, PendingSwap memory pending)
        private
        returns (uint256 gross, uint256 charged)
    {
        bool nativeSpecified = params.zeroForOne == (params.amountSpecified < 0);
        uint256 specified = _absolute(params.amountSpecified);
        uint256 nativeAmount = nativeSpecified ? specified : _absolute(int256(delta.amount0()));
        (uint256 creatorFee, uint256 platformFee) =
            _fees(nativeAmount, pending.creatorFeeBps, params.amountSpecified > 0);
        uint256 fee = creatorFee + platformFee;
        if (nativeSpecified) {
            uint256 expected = params.amountSpecified > 0 ? specified + fee : specified - fee;
            if (_absolute(int256(delta.amount0())) != expected) revert PartialFillUnsupported();
        } else {
            if (_absolute(int256(delta.amount1())) != specified) revert PartialFillUnsupported();
            charged = _charge(poolId, params, nativeAmount, pending);
        }
        gross = nativeAmount + (params.amountSpecified > 0 ? fee : 0);
    }

    function _applyTrade(
        bytes32 poolId,
        SwapParams calldata params,
        BalanceDelta delta,
        E.RouteContext memory route,
        uint256 gross
    ) private {
        if (
            (params.zeroForOne && (delta.amount0() >= 0 || delta.amount1() <= 0))
                || (!params.zeroForOne && (delta.amount0() <= 0 || delta.amount1() >= 0))
        ) revert InvalidSwapContext();
        T.Trade memory trade = T.Trade(
            route.sequence,
            route.actor,
            route.payer,
            route.recipient,
            gross,
            _absolute(int256(delta.amount1())),
            params.zeroForOne,
            params.amountSpecified < 0,
            route.initialBuy
        );
        runtime.executeTrade(poolConfig[poolId].launchKey, trade);
    }

    function _charge(bytes32 poolId, SwapParams calldata params, uint256 nativeAmount, PendingSwap memory pending)
        private
        returns (uint256 fee)
    {
        bool amountIsNet = params.amountSpecified > 0;
        (uint256 creatorFee, uint256 platformFee) = _fees(nativeAmount, pending.creatorFeeBps, amountIsNet);
        fee = creatorFee + platformFee;
        if (fee != 0) {
            NATIVE.take(poolManager, address(ledger), fee, true);
            ledger.accrue(poolId, platformFee, creatorFee);
        }
        emit NativeFeesAccrued(
            poolId,
            pending.route.actor,
            params.zeroForOne,
            nativeAmount + (amountIsNet ? fee : 0),
            platformFee,
            creatorFee
        );
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
        ) revert InvalidPool();
    }

    function _config(bytes32 poolId) private view returns (PoolConfig storage config) {
        config = poolConfig[poolId];
        if (config.registrar == address(0)) revert InvalidPool();
    }

    function _absolute(int256 value) private pure returns (uint256) {
        return value >= 0 ? uint256(value) : uint256(-(value + 1)) + 1;
    }
}
