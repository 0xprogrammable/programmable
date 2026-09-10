// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Pool } from "@uniswap/v4-core/src/libraries/Pool.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams, ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { LiquidityAmounts } from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import { ModuleEngineBaseV1 } from "../ModuleEngineBaseV1.sol";
import { ModuleEngineTypesV1 as T } from "../ModuleEngineTypesV1.sol";
import { AnyQuoteTypesV1 as A } from "./AnyQuoteTypesV1.sol";
import { IAnyQuoteSharedHookV1 } from "./IAnyQuoteSharedHookV1.sol";

interface IAnyQuoteHookManagerV1 {
    function poolManager() external view returns (IPoolManager);
}

/// @notice Immutable LP custodian for a standard launch coin paired with a compatible ERC20 on Chain 4663.
/// @dev The separate shared hook charges every pool swap, including swaps through external V4 routers.
/// This engine has no hook callbacks, fee collection, LP removal, rescue, approvals, mint or upgrade path.
/// All initial primary inventory is locked in the position or retained as unspendable rounding dust.
contract AnyQuoteLPModuleV1 is ModuleEngineBaseV1, IUnlockCallback, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    bytes32 public constant BUY = keccak256("spot.buy.exact-input.v1");
    bytes32 public constant SELL = keccak256("spot.sell.exact-input.v1");
    bytes32 public constant HOST_PROFILE = A.PROFILE_ID;
    uint256 public constant CHAIN_ID = A.CHAIN_ID;
    uint256 public constant TOKEN_SUPPLY = A.TOKEN_SUPPLY;
    int24 public constant TICK_SPACING = A.TICK_SPACING;
    bytes32 public constant POSITION_SALT = keccak256("permanently-locked-primary-inventory.v1");

    IPoolManager public immutable poolManager;
    address public immutable sharedHook;
    // Derived constructor values use storage so the existing compiler-immutable admission map stays compatible.
    // There are no setters; only values directly present in Context/configuration are compiler immutables.
    bytes32 public configurationHash;
    bytes32 public immutable poolManagerCodeHash;
    bytes32 public hostCodeHash;
    bytes32 public sharedHookCodeHash;
    bytes32 public primaryCodeHash;
    bytes32 public quoteCodeHash;
    bytes32 public poolId;
    uint8 public quoteDecimals;
    int24 public immutable initialTick;
    int24 public tickLower;
    int24 public tickUpper;
    uint128 public lockedLiquidity;
    uint256 public lockedTokenDust;

    // Callback authority exists only during our own initialization or optional host swap.
    uint8 private _phase;

    error InvalidConfiguration();
    error WrongChain();
    error InvalidOperation();
    error InvalidPool();
    error UnauthorizedCallback();
    error InvalidSettlement();
    error DeadlineExpired();

    constructor(T.Context memory context_, bytes memory configuration) ModuleEngineBaseV1(context_) {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        if (configuration.length != 256) revert InvalidConfiguration();
        A.Configuration memory config = abi.decode(configuration, (A.Configuration));
        if (config.validUntil == 0 || block.timestamp > config.validUntil) revert DeadlineExpired();
        if (
            config.schemaId != A.SCHEMA_ID || config.priceEvidenceHash == bytes32(0)
                || config.quoteAsset != context_.quoteAsset || config.poolManager.code.length == 0
                || config.poolManager.codehash != config.poolManagerCodeHash || context_.token.code.length == 0
                || context_.quoteAsset.code.length == 0 || context_.host.code.length == 0
                || config.sharedHook.code.length == 0 || config.poolManager == context_.host
                || config.sharedHook == context_.host || config.sharedHook == config.poolManager
                || context_.quoteAsset == config.poolManager || context_.token == config.poolManager
                || context_.quoteAsset == config.sharedHook || context_.token == config.sharedHook
                || config.initialTick % TICK_SPACING != 0 || config.initialTick <= TickMath.minUsableTick(TICK_SPACING)
                || config.initialTick >= TickMath.maxUsableTick(TICK_SPACING)
        ) revert InvalidConfiguration();
        IAnyQuoteSharedHookV1 hook = IAnyQuoteSharedHookV1(config.sharedHook);
        address ledger = hook.ledger();
        if (
            hook.host() != context_.host
                || address(IAnyQuoteHookManagerV1(config.sharedHook).poolManager()) != config.poolManager
                || ledger.code.length == 0 || context_.feeCollector != ledger
        ) revert InvalidConfiguration();
        uint8 decimals_ = IERC20Metadata(context_.quoteAsset).decimals();
        if (
            decimals_ > 36 || IERC20Metadata(context_.token).decimals() != 18
                || IERC20(context_.quoteAsset).totalSupply() == 0
                || IERC20(context_.token).totalSupply() != TOKEN_SUPPLY
        ) revert InvalidConfiguration();

        poolManager = IPoolManager(config.poolManager);
        sharedHook = config.sharedHook;
        configurationHash = keccak256(configuration);
        poolManagerCodeHash = config.poolManagerCodeHash;
        hostCodeHash = context_.host.codehash;
        sharedHookCodeHash = config.sharedHook.codehash;
        primaryCodeHash = context_.token.codehash;
        quoteCodeHash = context_.quoteAsset.codehash;
        quoteDecimals = decimals_;
        initialTick = config.initialTick;
        bool quote0 = context_.quoteAsset < context_.token;
        int24 lower = quote0 ? TickMath.minUsableTick(TICK_SPACING) : config.initialTick;
        int24 upper = quote0 ? config.initialTick : TickMath.maxUsableTick(TICK_SPACING);
        tickLower = lower;
        tickUpper = upper;

        // The configured tick already represents the raw-unit ratio. No decimal exponent or price cap is used.
        uint160 lowerPrice = TickMath.getSqrtPriceAtTick(lower);
        uint160 upperPrice = TickMath.getSqrtPriceAtTick(upper);
        uint128 liquidity = quote0
            ? LiquidityAmounts.getLiquidityForAmount1(lowerPrice, upperPrice, TOKEN_SUPPLY)
            : LiquidityAmounts.getLiquidityForAmount0(lowerPrice, upperPrice, TOKEN_SUPPLY);
        if (liquidity == 0 || liquidity > Pool.tickSpacingToMaxLiquidityPerTick(TICK_SPACING)) {
            revert InvalidConfiguration();
        }
        lockedLiquidity = liquidity;
        poolId = PoolId.unwrap(poolKey().toId());
    }

    function poolKey() public view returns (PoolKey memory) {
        bool quote0 = _context.quoteAsset < _context.token;
        return PoolKey({
            currency0: Currency.wrap(quote0 ? _context.quoteAsset : _context.token),
            currency1: Currency.wrap(quote0 ? _context.token : _context.quoteAsset),
            fee: 0,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(sharedHook)
        });
    }

    function _initialize(bytes calldata launchData) internal override nonReentrant returns (bytes32) {
        _checkDependencies();
        if (
            launchData.length != 0 || IERC20(_context.token).balanceOf(address(this)) != TOKEN_SUPPLY
                || IERC20(_context.token).totalSupply() != TOKEN_SUPPLY
        ) revert InvalidConfiguration();
        A.PoolRegistration memory registered = IAnyQuoteSharedHookV1(sharedHook).poolConfig(poolId);
        if (
            registered.initializer != address(this) || registered.launchId != _context.launchId
                || registered.token != _context.token || registered.quoteAsset != _context.quoteAsset
                || registered.initialTick != initialTick || registered.configurationHash != configurationHash
                || PoolId.unwrap(IAnyQuoteSharedHookV1(sharedHook).poolKey(poolId).toId()) != poolId
        ) revert InvalidPool();

        _phase = 1;
        if (poolManager.initialize(poolKey(), TickMath.getSqrtPriceAtTick(initialTick)) != initialTick) {
            revert InvalidPool();
        }
        poolManager.unlock("");
        _phase = 0;
        lockedTokenDust = IERC20(_context.token).balanceOf(address(this));
        return keccak256(abi.encode(poolId, tickLower, tickUpper, lockedLiquidity, lockedTokenDust, quoteDecimals));
    }

    /// @dev Optional pre-funded exact-input adapter. The host authenticates actor/nonce and funds the input first.
    /// PoolManager's returned deltas already include the shared hook's fees. Do not deduct fees a second time.
    function _execute(T.Operation calldata op) internal override nonReentrant returns (bytes memory) {
        if (op.operationId != BUY && op.operationId != SELL) revert InvalidOperation();
        bool buy = op.operationId == BUY;
        if (op.deadline == 0 || op.deadline < block.timestamp) revert DeadlineExpired();
        if (
            op.inputAmount == 0 || op.inputAmount > uint256(uint128(type(int128).max)) || op.minimumOutput == 0
                || msg.value != 0 || op.actor == address(0) || op.recipient == address(0)
                || op.recipient == address(this) || op.recipient == address(poolManager)
                || op.recipient == _context.host || op.recipient == sharedHook || op.recipient == _context.feeCollector
                || op.inputAsset != (buy ? _context.quoteAsset : _context.token)
                || op.outputAsset != (buy ? _context.token : _context.quoteAsset) || op.data.length != 32
        ) revert InvalidOperation();
        _checkDependencies();
        uint256 quoteBefore = IERC20(_context.quoteAsset).balanceOf(address(this));
        uint256 tokenBefore = IERC20(_context.token).balanceOf(address(this));
        if (
            tokenBefore < lockedTokenDust
                || (buy ? quoteBefore < op.inputAmount : tokenBefore - lockedTokenDust < op.inputAmount)
        ) revert InvalidSettlement();

        _phase = 2;
        uint256 output =
            abi.decode(poolManager.unlock(abi.encode(buy, op.inputAmount, abi.decode(op.data, (uint160)))), (uint256));
        if (output < op.minimumOutput) revert InvalidSettlement();
        _transferOutputExactly(op.outputAsset, op.recipient, output);
        if (
            IERC20(_context.quoteAsset).balanceOf(address(this)) != quoteBefore - (buy ? op.inputAmount : 0)
                || IERC20(_context.token).balanceOf(address(this)) != tokenBefore - (buy ? 0 : op.inputAmount)
        ) revert InvalidSettlement();
        _phase = 0;
        // Canonical operation events come from the host; every pool trade is emitted by the shared hook.
        return abi.encode(output);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager) || _phase == 0) revert UnauthorizedCallback();
        bool quote0 = _context.quoteAsset < _context.token;
        if (_phase == 1) {
            if (data.length != 0) revert InvalidSettlement();
            (BalanceDelta liquidityDelta,) = poolManager.modifyLiquidity(
                poolKey(),
                ModifyLiquidityParams({
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    liquidityDelta: int256(uint256(lockedLiquidity)),
                    salt: POSITION_SALT
                }),
                ""
            );
            int128 tokenDelta = quote0 ? liquidityDelta.amount1() : liquidityDelta.amount0();
            // One-sided launch: the position requires primary tokens and exactly zero quote tokens.
            if ((quote0 ? liquidityDelta.amount0() : liquidityDelta.amount1()) != 0 || tokenDelta >= 0) {
                revert InvalidSettlement();
            }
            uint256 debt = uint256(-int256(tokenDelta));
            if (debt > TOKEN_SUPPLY) revert InvalidSettlement();
            _settleExactly(_context.token, debt);
            return "";
        }
        if (_phase != 2) revert UnauthorizedCallback();
        (bool buy, uint256 input, uint160 priceLimit) = abi.decode(data, (bool, uint256, uint160));
        bool zeroForOne = buy == quote0;
        if (priceLimit == 0) priceLimit = zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        BalanceDelta delta = poolManager.swap(poolKey(), SwapParams(zeroForOne, -int256(input), priceLimit), "");
        int128 inputDelta = zeroForOne ? delta.amount0() : delta.amount1();
        int128 outputDelta = zeroForOne ? delta.amount1() : delta.amount0();
        if (inputDelta >= 0 || outputDelta <= 0 || uint256(-int256(inputDelta)) != input) revert InvalidSettlement();

        uint256 output = uint256(int256(outputDelta));
        _settleExactly(buy ? _context.quoteAsset : _context.token, input);
        address outputAsset = buy ? _context.token : _context.quoteAsset;
        uint256 beforeBalance = IERC20(outputAsset).balanceOf(address(this));
        uint256 managerBefore = IERC20(outputAsset).balanceOf(address(poolManager));
        poolManager.take(Currency.wrap(outputAsset), address(this), output);
        if (
            IERC20(outputAsset).balanceOf(address(this)) - beforeBalance != output
                || managerBefore - IERC20(outputAsset).balanceOf(address(poolManager)) != output
        ) revert InvalidSettlement();
        return abi.encode(output);
    }

    function _settleExactly(address asset, uint256 amount) private {
        IERC20 token = IERC20(asset);
        uint256 payerBefore = token.balanceOf(address(this));
        uint256 managerBefore = token.balanceOf(address(poolManager));
        poolManager.sync(Currency.wrap(asset));
        token.safeTransfer(address(poolManager), amount);
        if (
            payerBefore - token.balanceOf(address(this)) != amount
                || token.balanceOf(address(poolManager)) - managerBefore != amount || poolManager.settle() != amount
        ) revert InvalidSettlement();
    }

    function _transferOutputExactly(address asset, address recipient, uint256 amount) private {
        IERC20 token = IERC20(asset);
        uint256 beforeBalance = token.balanceOf(recipient);
        token.safeTransfer(recipient, amount);
        if (token.balanceOf(recipient) - beforeBalance != amount) revert InvalidSettlement();
    }

    function _checkDependencies() private view {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        if (
            address(poolManager).codehash != poolManagerCodeHash || _context.host.codehash != hostCodeHash
                || sharedHook.codehash != sharedHookCodeHash || _context.token.codehash != primaryCodeHash
                || _context.quoteAsset.codehash != quoteCodeHash
                || IERC20Metadata(_context.quoteAsset).decimals() != quoteDecimals
        ) revert InvalidConfiguration();
    }
}
