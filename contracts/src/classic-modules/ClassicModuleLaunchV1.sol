// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { CurrencySettler } from "@openzeppelin/uniswap-hooks/src/utils/CurrencySettler.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { Plan, Position } from "@uniswap/liquidity-launcher/src/types/PositionPlannerTypes.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { PositionInfo } from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";

import { ClassicModulePositionPlannerV1 } from "./ClassicModulePositionPlannerV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../LockedPositionFeeForwarderFactoryV1.sol";
import { ClassicModuleHookV1 } from "./ClassicModuleHookV1.sol";
import { ClassicModuleLaunchPolicyV1 } from "./ClassicModuleLaunchPolicyV1.sol";
import { ClassicModuleTypes as T } from "./ClassicModuleTypes.sol";
import { IProgrammableClassicLaunchV1 } from "../interfaces/IProgrammableClassicLaunchV1.sol";

/// @title ClassicModuleLaunchV1
/// @notice Permissionless, atomic Classic launch with a fixed supply, pinned recipe and permanently locked LP.
/// @dev This is a new launch source. It neither emits nor impersonates the older router's launch stamp. The
///      immutable V1 engine is the finite-range native/token AMM curve in ClassicModulePositionPlannerV1; it has no
/// sale phase, migration, custody option, transfer tax or later mutable launch configuration. The caller receives
///      the initial tokens directly. Native minimum purchase and network gas are separate quantities.
contract ClassicModuleLaunchV1 is IUnlockCallback, IProgrammableClassicLaunchV1, ReentrancyGuardTransient {
    using CurrencySettler for Currency;
    using SafeCast for *;

    uint8 public constant TOKEN_DECIMALS = 18;
    uint256 public constant TOKEN_SUPPLY = 1_000_000_000 ether;
    int24 public constant INITIAL_TICK = 204_200;
    int24 public constant TICK_SPACING = 200;
    uint24 public constant LP_FEE_PIPS = 0;
    Currency private constant NATIVE = Currency.wrap(address(0));

    IPoolManager public immutable poolManager;
    IPositionManager public immutable positionManager;
    UERC20Factory public immutable tokenFactory;
    ClassicModuleHookV1 public immutable feeHook;
    ClassicModulePositionPlannerV1 public immutable positionPlanner;
    ClassicModuleLaunchPolicyV1 public immutable launchPolicy;
    LockedPositionFeeForwarderFactoryV1 public immutable positionForwarderFactory;
    uint256 public immutable minInitialBuyNative;

    struct LaunchParameters {
        string name;
        string symbol;
        uint16 buyCreatorFeeBps;
        uint16 sellCreatorFeeBps;
        bytes32 creatorSalt;
        UERC20Metadata metadata;
        address[] creatorWallets;
        uint16[] creatorSharesBps;
        T.ModuleSelection[] modules;
        uint256 minimumInitialTokenOut;
        uint256 deadline;
    }

    /// @dev Field order is also the canonical event order and public provenance-reader ABI.
    struct LaunchRecord {
        bytes32 launchId;
        address launchWallet;
        address token;
        bytes32 poolId;
        bytes32 recipeHash;
        address hook;
        address positionRecipient;
        uint256 positionTokenId;
        uint256 initialBuyNative;
        uint256 initialBuyTokens;
    }

    struct LiquidityRecord {
        uint256 tokenLiquidityAmount;
        uint256 lockedTokenDust;
        Position position;
    }

    struct InitialBuyCallbackData {
        PoolKey key;
        address recipient;
        uint256 nativeAmount;
    }

    mapping(address token => LaunchRecord record) private _launches;
    bytes32 private _initialBuyCallbackHash;

    error DeadlineExpired(uint256 deadline, uint256 timestamp);
    error InitialBuyBelowMinimum(uint256 actual, uint256 minimum);
    error InitialBuyOutputTooLow(uint256 actual, uint256 minimum);
    error InvalidDependency(address dependency);
    error InvalidInitialBuyCallback();
    error InvalidInitialBuyDelta(int128 nativeDelta, int128 tokenDelta);
    error InvalidInitialBuyRecipientBalance(uint256 actual, uint256 expected);
    error InvalidInitialBuyResult(uint256 tokenAmount, uint256 residualNativeBalance);
    error InvalidInitialBuySettlement(uint256 actual, uint256 expected);
    error InvalidInitialTick(int24 actual, int24 expected);
    error InvalidPositionManager(address expectedPoolManager, address actualPoolManager);
    error InvalidPositionManagerFactory(address expectedPositionManager, address actualPositionManager);
    error InvalidPositionLiquidity(uint256 positionTokenId, uint128 actualLiquidity, uint128 expectedLiquidity);
    error InvalidPositionOwner(uint256 positionTokenId, address actualOwner, address expectedOwner);
    error InvalidPositionPool(uint256 positionTokenId, bytes32 actualPoolId, bytes32 expectedPoolId);
    error InvalidPinnedDependency(address dependency, bytes32 actualCodeHash, bytes32 expectedCodeHash);
    error InvalidPositionTicks(
        uint256 positionTokenId,
        int24 actualTickLower,
        int24 actualTickUpper,
        int24 expectedTickLower,
        int24 expectedTickUpper
    );
    error InvalidPositionTokenId(uint256 actualNextTokenId, uint256 expectedNextTokenId);
    error InvalidSharedHook(address expectedPoolManager, uint24 lpFeePips, int24 tickSpacing);
    error InvalidTokenSupply(uint256 actualSupply, uint256 launcherBalance, uint8 actualDecimals);
    error InvalidMinimumInitialBuy();
    error MissingMinimumInitialTokenOut();
    error RecipeHashMismatch(bytes32 actual, bytes32 expected);
    error TokenAddressMismatch(address actual, address predicted);
    error TokenAlreadyExists(address token);
    error TokenCustodyMismatch(uint256 launcherBalance, uint256 positionManagerBalance);
    error UnauthorizedUnlockCallback(address caller);
    error UnrecognizedFactoryDeployment(address deployment);

    event ClassicModuleLaunched(
        bytes32 indexed launchId,
        address indexed launchWallet,
        address indexed token,
        bytes32 poolId,
        bytes32 recipeHash,
        address hook,
        address positionRecipient,
        uint256 positionTokenId,
        uint256 initialBuyNative,
        uint256 initialBuyTokens
    );
    event ClassicModuleLiquidityConfigured(
        bytes32 indexed launchId,
        address indexed token,
        uint256 totalSupply,
        uint256 tokenLiquidityAmount,
        uint256 lockedTokenDust,
        int24 initialTick,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        uint24 lpFeePips
    );
    event ClassicModuleConfigurationBound(
        bytes32 indexed launchId, bytes32 metadataHash, bytes32 creatorConfigurationHash, bytes32 economicsHash
    );

    constructor(
        IPoolManager poolManager_,
        IPositionManager positionManager_,
        UERC20Factory tokenFactory_,
        ClassicModuleHookV1 feeHook_,
        ClassicModulePositionPlannerV1 positionPlanner_,
        ClassicModuleLaunchPolicyV1 launchPolicy_,
        LockedPositionFeeForwarderFactoryV1 positionForwarderFactory_,
        uint256 minInitialBuyNative_
    ) {
        _requireContract(address(poolManager_));
        _requireContract(address(positionManager_));
        _requireContract(address(tokenFactory_));
        _requireContract(address(feeHook_));
        _requireContract(address(positionPlanner_));
        _requireContract(address(launchPolicy_));
        _requireContract(address(positionForwarderFactory_));
        _requirePinned(address(positionPlanner_), keccak256(type(ClassicModulePositionPlannerV1).runtimeCode));
        _requirePinned(address(launchPolicy_), keccak256(type(ClassicModuleLaunchPolicyV1).runtimeCode));
        _requirePinned(address(tokenFactory_), keccak256(type(UERC20Factory).runtimeCode));
        if (minInitialBuyNative_ == 0) revert InvalidMinimumInitialBuy();
        address actualPoolManager = address(positionManager_.poolManager());
        if (actualPoolManager != address(poolManager_)) {
            revert InvalidPositionManager(address(poolManager_), actualPoolManager);
        }
        address factoryPositionManager = address(positionForwarderFactory_.positionManager());
        if (factoryPositionManager != address(positionManager_)) {
            revert InvalidPositionManagerFactory(address(positionManager_), factoryPositionManager);
        }
        if (
            address(feeHook_.poolManager()) != address(poolManager_) || feeHook_.LP_FEE_PIPS() != LP_FEE_PIPS
                || feeHook_.TICK_SPACING() != TICK_SPACING
        ) {
            revert InvalidSharedHook(address(poolManager_), feeHook_.LP_FEE_PIPS(), feeHook_.TICK_SPACING());
        }
        _requireContract(address(feeHook_.ledger()));
        poolManager = poolManager_;
        positionManager = positionManager_;
        tokenFactory = tokenFactory_;
        feeHook = feeHook_;
        positionPlanner = positionPlanner_;
        launchPolicy = launchPolicy_;
        positionForwarderFactory = positionForwarderFactory_;
        minInitialBuyNative = minInitialBuyNative_;
    }

    /// @notice Launch using the caller's own wallet, without a platform signer or per-launch approval.
    function launch(LaunchParameters calldata parameters)
        external
        payable
        nonReentrant
        returns (LaunchRecord memory result)
    {
        _validateLaunch(parameters);
        (result.recipeHash,) =
            feeHook.previewRecipe(parameters.buyCreatorFeeBps, parameters.sellCreatorFeeBps, parameters.modules);
        result.launchWallet = msg.sender;
        result.initialBuyNative = msg.value;
        result.hook = address(feeHook);

        bytes32 effectiveGraffiti = _effectiveGraffiti(msg.sender, parameters.creatorSalt);
        result.token = tokenFactory.getUERC20Address(
            parameters.name, parameters.symbol, TOKEN_DECIMALS, address(this), effectiveGraffiti
        );
        if (result.token.code.length != 0) revert TokenAlreadyExists(result.token);
        PoolKey memory key = _poolKey(result.token);
        result.poolId = PoolId.unwrap(key.toId());
        result.positionRecipient = _deployOrReusePositionRecipient(result.token, msg.sender);
        _createToken(parameters, effectiveGraffiti, result.token);
        bytes32 registeredRecipe = feeHook.registerPool(
            key,
            T.PoolRegistration({
                launchWallet: msg.sender,
                buyCreatorFeeBps: parameters.buyCreatorFeeBps,
                sellCreatorFeeBps: parameters.sellCreatorFeeBps,
                creatorWallets: parameters.creatorWallets,
                creatorSharesBps: parameters.creatorSharesBps,
                modules: parameters.modules
            })
        );
        if (registeredRecipe != result.recipeHash) revert RecipeHashMismatch(registeredRecipe, result.recipeHash);
        int24 initializedTick = poolManager.initialize(key, TickMath.getSqrtPriceAtTick(INITIAL_TICK));
        if (initializedTick != INITIAL_TICK) revert InvalidInitialTick(initializedTick, INITIAL_TICK);

        LiquidityRecord memory liquidity;
        (result.positionTokenId, liquidity) = _mintAndVerifyPosition(key, result, parameters.deadline);
        result.initialBuyTokens = _executeInitialBuy(key, msg.sender, msg.value, parameters.minimumInitialTokenOut);
        _recordLaunch(parameters, result, liquidity);
    }

    function getLaunch(address token) external view returns (LaunchRecord memory) {
        return _launches[token];
    }

    function launchIdentityVersion() external pure override returns (uint256) {
        return 1;
    }

    /// @dev The common reader deliberately does not depend on the recipe's supported module kinds.
    function getLaunchIdentity(address token) external view override returns (LaunchIdentity memory identity) {
        LaunchRecord storage record = _launches[token];
        if (record.token == address(0)) return identity;
        return LaunchIdentity(
            record.launchId,
            record.launchWallet,
            record.token,
            address(poolManager),
            record.poolId,
            record.hook,
            record.recipeHash
        );
    }

    function predictTokenAddress(
        string calldata name,
        string calldata symbol,
        address launchWallet,
        bytes32 creatorSalt
    ) external view returns (address token, bytes32 effectiveGraffiti) {
        effectiveGraffiti = _effectiveGraffiti(launchWallet, creatorSalt);
        token = tokenFactory.getUERC20Address(name, symbol, TOKEN_DECIMALS, address(this), effectiveGraffiti);
    }

    function poolKey(address token) external view returns (PoolKey memory) {
        return _poolKey(token);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert UnauthorizedUnlockCallback(msg.sender);
        if (_initialBuyCallbackHash == bytes32(0) || keccak256(data) != _initialBuyCallbackHash) {
            revert InvalidInitialBuyCallback();
        }
        delete _initialBuyCallbackHash;
        InitialBuyCallbackData memory callback = abi.decode(data, (InitialBuyCallbackData));
        BalanceDelta delta = poolManager.swap(
            callback.key,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -callback.nativeAmount.toInt256(),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            ""
        );
        int128 nativeDelta = delta.amount0();
        int128 tokenDelta = delta.amount1();
        if (nativeDelta >= 0 || tokenDelta <= 0) revert InvalidInitialBuyDelta(nativeDelta, tokenDelta);
        uint256 nativeSettlement = (-int256(nativeDelta)).toUint256();
        if (nativeSettlement != callback.nativeAmount) {
            revert InvalidInitialBuySettlement(nativeSettlement, callback.nativeAmount);
        }
        uint256 tokenAmount = int256(tokenDelta).toUint256();
        NATIVE.settle(poolManager, address(this), nativeSettlement, false);
        callback.key.currency1.take(poolManager, callback.recipient, tokenAmount, false);
        return abi.encode(tokenAmount);
    }

    function _validateLaunch(LaunchParameters calldata parameters) private view {
        if (block.timestamp > parameters.deadline) revert DeadlineExpired(parameters.deadline, block.timestamp);
        if (parameters.minimumInitialTokenOut == 0) revert MissingMinimumInitialTokenOut();
        if (msg.value < minInitialBuyNative) revert InitialBuyBelowMinimum(msg.value, minInitialBuyNative);
        launchPolicy.validate(
            parameters.name,
            parameters.symbol,
            parameters.metadata,
            parameters.creatorWallets,
            parameters.creatorSharesBps,
            parameters.buyCreatorFeeBps,
            parameters.sellCreatorFeeBps
        );
    }

    function _createToken(LaunchParameters calldata parameters, bytes32 effectiveGraffiti, address predictedToken)
        private
    {
        address token = tokenFactory.createToken(
            parameters.name,
            parameters.symbol,
            TOKEN_DECIMALS,
            TOKEN_SUPPLY,
            address(this),
            abi.encode(parameters.metadata),
            effectiveGraffiti
        );
        if (token != predictedToken) revert TokenAddressMismatch(token, predictedToken);
        uint256 supply = IERC20(token).totalSupply();
        uint256 launcherBalance = IERC20(token).balanceOf(address(this));
        uint8 decimals = IERC20Metadata(token).decimals();
        if (supply != TOKEN_SUPPLY || launcherBalance != TOKEN_SUPPLY || decimals != TOKEN_DECIMALS) {
            revert InvalidTokenSupply(supply, launcherBalance, decimals);
        }
    }

    function _mintAndVerifyPosition(PoolKey memory key, LaunchRecord memory result, uint256 deadline)
        private
        returns (uint256 positionTokenId, LiquidityRecord memory liquidity)
    {
        Plan memory plan;
        (plan, liquidity.position, liquidity.lockedTokenDust) =
            positionPlanner.buildOneSidedPlan(key, result.positionRecipient);
        liquidity.tokenLiquidityAmount = liquidity.position.amount1;
        uint256 nextTokenIdBefore = positionManager.nextTokenId();
        if (nextTokenIdBefore == 0) revert InvalidPositionTokenId(nextTokenIdBefore, 1);
        Currency.wrap(result.token).transfer(address(positionManager), TOKEN_SUPPLY);
        positionManager.modifyLiquidities(abi.encode(plan.actions, plan.params), deadline);
        uint256 nextTokenIdAfter = positionManager.nextTokenId();
        if (nextTokenIdAfter != nextTokenIdBefore + 1) {
            revert InvalidPositionTokenId(nextTokenIdAfter, nextTokenIdBefore + 1);
        }
        positionTokenId = nextTokenIdBefore;
        uint256 launcherBalance = IERC20(result.token).balanceOf(address(this));
        uint256 positionManagerBalance = IERC20(result.token).balanceOf(address(positionManager));
        if (launcherBalance != 0 || positionManagerBalance != 0) {
            revert TokenCustodyMismatch(launcherBalance, positionManagerBalance);
        }
        _verifyMintedPosition(positionTokenId, result, liquidity.position);
    }

    function _verifyMintedPosition(uint256 positionTokenId, LaunchRecord memory result, Position memory expected)
        private
        view
    {
        address actualOwner = IERC721(address(positionManager)).ownerOf(positionTokenId);
        if (actualOwner != result.positionRecipient) {
            revert InvalidPositionOwner(positionTokenId, actualOwner, result.positionRecipient);
        }
        (PoolKey memory actualKey, PositionInfo actualInfo) = positionManager.getPoolAndPositionInfo(positionTokenId);
        bytes32 actualPoolId = PoolId.unwrap(actualKey.toId());
        if (actualPoolId != result.poolId) revert InvalidPositionPool(positionTokenId, actualPoolId, result.poolId);
        int24 actualLower = actualInfo.tickLower();
        int24 actualUpper = actualInfo.tickUpper();
        if (actualLower != expected.tickLower || actualUpper != expected.tickUpper) {
            revert InvalidPositionTicks(
                positionTokenId, actualLower, actualUpper, expected.tickLower, expected.tickUpper
            );
        }
        uint128 actualLiquidity = positionManager.getPositionLiquidity(positionTokenId);
        uint128 expectedLiquidity = expected.liquidity.toUint128();
        if (actualLiquidity != expectedLiquidity) {
            revert InvalidPositionLiquidity(positionTokenId, actualLiquidity, expectedLiquidity);
        }
    }

    function _executeInitialBuy(PoolKey memory key, address recipient, uint256 nativeAmount, uint256 minimumTokenOut)
        private
        returns (uint256 tokenAmount)
    {
        // Forced native transfers cannot block a launch or be consumed as someone else's initial buy.
        uint256 residualNativeBalance = address(this).balance - nativeAmount;
        address token = Currency.unwrap(key.currency1);
        uint256 recipientBefore = IERC20(token).balanceOf(recipient);
        bytes memory callback =
            abi.encode(InitialBuyCallbackData({ key: key, recipient: recipient, nativeAmount: nativeAmount }));
        _initialBuyCallbackHash = keccak256(callback);
        tokenAmount = abi.decode(poolManager.unlock(callback), (uint256));
        if (_initialBuyCallbackHash != bytes32(0)) revert InvalidInitialBuyCallback();
        if (tokenAmount == 0 || address(this).balance != residualNativeBalance) {
            revert InvalidInitialBuyResult(tokenAmount, address(this).balance);
        }
        uint256 recipientIncrease = IERC20(token).balanceOf(recipient) - recipientBefore;
        if (recipientIncrease != tokenAmount) revert InvalidInitialBuyRecipientBalance(recipientIncrease, tokenAmount);
        if (recipientIncrease < minimumTokenOut) revert InitialBuyOutputTooLow(recipientIncrease, minimumTokenOut);
    }

    function _deployOrReusePositionRecipient(address token, address launchWallet) private returns (address recipient) {
        bytes32 salt =
            keccak256(abi.encode("programmable.classic-module-position.v1", block.chainid, address(this), token));
        recipient = positionForwarderFactory.predict(salt, launchWallet);
        if (recipient.code.length == 0) recipient = address(positionForwarderFactory.deploy(salt, launchWallet));
        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(recipient));
        if (
            positionForwarderFactory.configurationHashOf(recipient) == bytes32(0)
                || address(forwarder.positionManager()) != address(positionManager)
                || forwarder.operator() != address(0) || forwarder.timelockBlockNumber() != type(uint256).max
                || forwarder.feeRecipient() != launchWallet
        ) {
            revert UnrecognizedFactoryDeployment(recipient);
        }
    }

    function _recordLaunch(
        LaunchParameters calldata parameters,
        LaunchRecord memory result,
        LiquidityRecord memory liquidity
    ) private {
        bytes32 metadataHash = keccak256(abi.encode(parameters.name, parameters.symbol, parameters.metadata));
        bytes32 creatorConfigurationHash = keccak256(abi.encode(parameters.creatorWallets, parameters.creatorSharesBps));
        bytes32 economicsHash = _economicsHash(parameters, result, liquidity, creatorConfigurationHash);
        result.launchId = keccak256(
            abi.encode(
                "programmable.classic-module-launch.v1",
                block.chainid,
                address(this),
                result.launchWallet,
                result.token,
                address(poolManager),
                result.poolId,
                result.recipeHash,
                metadataHash,
                economicsHash
            )
        );
        _launches[result.token] = result;
        emit ClassicModuleLaunched(
            result.launchId,
            result.launchWallet,
            result.token,
            result.poolId,
            result.recipeHash,
            result.hook,
            result.positionRecipient,
            result.positionTokenId,
            result.initialBuyNative,
            result.initialBuyTokens
        );
        emit ClassicModuleConfigurationBound(result.launchId, metadataHash, creatorConfigurationHash, economicsHash);
        _emitLiquidity(result, liquidity);
    }

    function _economicsHash(
        LaunchParameters calldata parameters,
        LaunchRecord memory result,
        LiquidityRecord memory liquidity,
        bytes32 creatorConfigurationHash
    ) private view returns (bytes32) {
        bytes32 liquidityHash = keccak256(
            abi.encode(
                address(positionManager),
                address(positionPlanner),
                result.positionRecipient,
                result.positionTokenId,
                TOKEN_SUPPLY,
                TOKEN_DECIMALS,
                liquidity,
                INITIAL_TICK,
                TICK_SPACING,
                LP_FEE_PIPS
            )
        );
        bytes32 tradeHash = keccak256(
            abi.encode(
                minInitialBuyNative,
                result.initialBuyNative,
                result.initialBuyTokens,
                parameters.minimumInitialTokenOut,
                parameters.deadline,
                parameters.buyCreatorFeeBps,
                parameters.sellCreatorFeeBps,
                creatorConfigurationHash
            )
        );
        return keccak256(abi.encode(result.hook, address(feeHook.ledger()), liquidityHash, tradeHash));
    }

    function _emitLiquidity(LaunchRecord memory result, LiquidityRecord memory liquidity) private {
        emit ClassicModuleLiquidityConfigured(
            result.launchId,
            result.token,
            TOKEN_SUPPLY,
            liquidity.tokenLiquidityAmount,
            liquidity.lockedTokenDust,
            INITIAL_TICK,
            liquidity.position.tickLower,
            liquidity.position.tickUpper,
            liquidity.position.liquidity.toUint128(),
            LP_FEE_PIPS
        );
    }

    function _poolKey(address token) private view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: LP_FEE_PIPS,
            tickSpacing: TICK_SPACING,
            hooks: feeHook
        });
    }

    function _effectiveGraffiti(address launchWallet, bytes32 creatorSalt) private view returns (bytes32) {
        return keccak256(
            abi.encode("programmable.classic-module-token.v1", block.chainid, address(this), launchWallet, creatorSalt)
        );
    }

    function _requireContract(address dependency) private view {
        if (dependency == address(0) || dependency.code.length == 0) revert InvalidDependency(dependency);
    }

    function _requirePinned(address dependency, bytes32 expectedCodeHash) private view {
        bytes32 actualCodeHash = dependency.codehash;
        if (actualCodeHash != expectedCodeHash) {
            revert InvalidPinnedDependency(dependency, actualCodeHash, expectedCodeHash);
        }
    }
}
