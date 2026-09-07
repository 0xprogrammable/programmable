// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { CurrencySettler } from "@openzeppelin/uniswap-hooks/src/utils/CurrencySettler.sol";
import { Plan, Position } from "@uniswap/liquidity-launcher/src/types/PositionPlannerTypes.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { BeforeSwapDelta, BeforeSwapDeltaLibrary } from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { PositionInfo } from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import { StockPairedPositionPlannerV3 } from "../StockPairedPositionPlannerV3.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../LockedPositionFeeForwarderFactoryV1.sol";
import { ModuleEngineBaseV1 } from "./ModuleEngineBaseV1.sol";
import { ModuleEngineTypesV1 as T } from "./ModuleEngineTypesV1.sol";
import { IModuleEngineFeeCollectorV1 } from "./IModuleEngineV1.sol";
import { IModuleQuoteEthConverterV1 } from "./ModuleQuoteEthConverterV1.sol";

/// @notice Contributor reference: fixed-supply, locked V4 spot market with a generic ERC20 quote address.
/// @dev Supports exact-input buys/sells. Every swap is gated through its host and atomically converts quote fees
///      into actually received ETH. It reuses the stock launcher's planner/LP lock without its ticker whitelist,
///      quote-only fee ledger or assumption that quote always has 18 decimals.
contract ModuleQuoteEngineV1 is ModuleEngineBaseV1, BaseHook, IUnlockCallback {
    using SafeERC20 for IERC20;
    using SafeCast for *;
    using CurrencySettler for Currency;

    bytes32 public constant BUY = keccak256("spot.buy.exact-input.v1");
    bytes32 public constant SELL = keccak256("spot.sell.exact-input.v1");
    uint256 public constant TOKEN_SUPPLY = 1_000_000_000 ether;
    int24 public constant TICK_SPACING = 200;

    struct Configuration {
        address poolManager;
        address positionManager;
        address positionPlanner;
        address positionForwarderFactory;
        address converter;
        bytes32 converterCodeHash;
        uint256 initialQuotePerTokenX18;
        address fixedQuoteAsset;
    }

    struct TradeLimits {
        uint256 minimumEthFees;
        uint160 sqrtPriceLimitX96;
        bytes conversionRoute;
    }

    struct Trade {
        bool buy;
        uint256 quoteBefore;
        uint256 tokenBefore;
        uint256 grossQuote;
        uint256 tokenAmount;
        uint256 platformQuote;
        uint256 creatorQuote;
        uint256 platformEth;
        uint256 creatorEth;
        uint256 output;
    }

    IPositionManager public positionManager;
    StockPairedPositionPlannerV3 public positionPlanner;
    LockedPositionFeeForwarderFactoryV1 public positionForwarderFactory;
    IModuleQuoteEthConverterV1 public converter;
    bytes32 public converterCodeHash;
    bytes32 public positionManagerCodeHash;
    bytes32 public positionPlannerCodeHash;
    bytes32 public positionForwarderFactoryCodeHash;
    bytes32 public poolManagerCodeHash;
    uint8 public quoteDecimals;
    int24 public initialAbsoluteTick;
    address public positionRecipient;
    uint256 public positionTokenId;
    uint256 public lockedTokenDust;
    bytes32 public poolId;
    bool private _swapping;

    error InvalidConfiguration();
    error InvalidOperationShape();
    error InvalidPool();
    error UnauthorizedSwap();
    error InvalidSettlement();
    error InvalidConversion();
    error InvalidPosition();

    event QuoteTradeSettled(
        bytes32 indexed launchId,
        address indexed actor,
        bool buy,
        uint256 grossQuote,
        uint256 tokenAmount,
        uint256 quoteFees,
        uint256 platformEth,
        uint256 creatorEth
    );

    constructor(T.Context memory context_, bytes memory configuration)
        ModuleEngineBaseV1(context_)
        BaseHook(IPoolManager(abi.decode(configuration, (Configuration)).poolManager))
    {
        Configuration memory config = abi.decode(configuration, (Configuration));
        if (
            config.positionPlanner.codehash != keccak256(type(StockPairedPositionPlannerV3).runtimeCode)
                || config.positionManager.code.length == 0 || config.positionForwarderFactory.code.length == 0
                || config.poolManager.code.length == 0 || config.converter.code.length == 0
                || config.converter.codehash != config.converterCodeHash
                || (config.fixedQuoteAsset != address(0) && config.fixedQuoteAsset != context_.quoteAsset)
        ) revert InvalidConfiguration();
        positionManager = IPositionManager(config.positionManager);
        positionPlanner = StockPairedPositionPlannerV3(config.positionPlanner);
        positionForwarderFactory = LockedPositionFeeForwarderFactoryV1(config.positionForwarderFactory);
        if (
            address(positionManager.poolManager()) != config.poolManager
                || address(positionForwarderFactory.positionManager()) != config.positionManager
        ) revert InvalidConfiguration();
        converter = IModuleQuoteEthConverterV1(config.converter);
        converterCodeHash = config.converterCodeHash;
        positionManagerCodeHash = config.positionManager.codehash;
        positionPlannerCodeHash = config.positionPlanner.codehash;
        positionForwarderFactoryCodeHash = config.positionForwarderFactory.codehash;
        poolManagerCodeHash = config.poolManager.codehash;
        quoteDecimals = IERC20Metadata(context_.quoteAsset).decimals();
        if (quoteDecimals > 18) revert InvalidConfiguration();
        uint256 quoteUnit = 10 ** quoteDecimals;
        if (config.initialQuotePerTokenX18 == 0 || config.initialQuotePerTokenX18 >= 1e36 / quoteUnit) {
            revert InvalidConfiguration();
        }
        // Keep the price rational until after sqrt conversion. A whole primary token can cost less than one
        // raw quote unit (particularly with 6 decimals); rounding that quote amount first would reject valid prices.
        uint256 denominator = config.initialQuotePerTokenX18 * quoteUnit;
        uint256 ratioX128 = FullMath.mulDiv(1e36, 1 << 128, denominator);
        uint160 sqrtPriceX96 = (Math.sqrt(ratioX128) << 32).toUint160();
        int24 tick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);
        initialAbsoluteTick = (tick / TICK_SPACING) * TICK_SPACING;
        if (initialAbsoluteTick <= 0 || initialAbsoluteTick >= TickMath.maxUsableTick(TICK_SPACING)) {
            revert InvalidConfiguration();
        }
    }

    receive() external payable {
        if (msg.sender != address(converter) || !_swapping) revert InvalidConversion();
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory permissions) {
        permissions.beforeInitialize = true;
        permissions.beforeSwap = true;
    }

    function poolKey() public view returns (PoolKey memory key) {
        bool quote0 = _context.quoteAsset < _context.token;
        return PoolKey({
            currency0: Currency.wrap(quote0 ? _context.quoteAsset : _context.token),
            currency1: Currency.wrap(quote0 ? _context.token : _context.quoteAsset),
            fee: 0,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(this))
        });
    }

    function _initialize(bytes calldata launchData) internal override returns (bytes32 resourcesHash) {
        if (launchData.length != 0 || IERC20(_context.token).balanceOf(address(this)) != TOKEN_SUPPLY) {
            revert InvalidConfiguration();
        }
        _checkDependencies();
        PoolKey memory key = poolKey();
        bool quote0 = _context.quoteAsset < _context.token;
        int24 tick = quote0 ? initialAbsoluteTick : -initialAbsoluteTick;
        poolId = PoolId.unwrap(key.toId());
        positionRecipient = _positionRecipient();
        if (poolManager.initialize(key, TickMath.getSqrtPriceAtTick(tick)) != tick) revert InvalidPool();
        (Plan memory plan, Position memory position, uint256 dust) =
            positionPlanner.buildOneSidedPlan(key, positionRecipient, quote0, initialAbsoluteTick);
        lockedTokenDust = dust;
        positionTokenId = positionManager.nextTokenId();
        if (positionTokenId == 0) revert InvalidPosition();
        IERC20(_context.token).safeTransfer(address(positionManager), TOKEN_SUPPLY);
        positionManager.modifyLiquidities(abi.encode(plan.actions, plan.params), block.timestamp);
        _verifyPosition(position);
        return keccak256(abi.encode(poolId, positionTokenId, positionRecipient, tick, quoteDecimals, lockedTokenDust));
    }

    function _execute(T.Operation calldata op) internal override returns (bytes memory result) {
        Trade memory trade;
        trade.buy = op.operationId == BUY;
        if (
            (!trade.buy && op.operationId != SELL) || op.inputAmount == 0 || op.minimumOutput == 0 || msg.value != 0
                || op.inputAsset != (trade.buy ? _context.quoteAsset : _context.token)
                || op.outputAsset != (trade.buy ? _context.token : _context.quoteAsset)
        ) revert InvalidOperationShape();
        _checkDependencies();
        TradeLimits memory limits = abi.decode(op.data, (TradeLimits));
        (uint16 platformBps, uint16 creatorBps) =
            IModuleEngineFeeCollectorV1(_context.feeCollector).feeTerms(_context.launchId, trade.buy);
        trade.quoteBefore = IERC20(_context.quoteAsset).balanceOf(address(this));
        trade.tokenBefore = IERC20(_context.token).balanceOf(address(this));
        uint256 swapInput = op.inputAmount;
        if (trade.buy) {
            trade.grossQuote = op.inputAmount;
            (trade.platformQuote, trade.creatorQuote) = _fees(trade.grossQuote, platformBps, creatorBps);
            swapInput -= trade.platformQuote + trade.creatorQuote;
        }
        _swapping = true;
        bytes memory swapResult = poolManager.unlock(abi.encode(trade.buy, swapInput, limits.sqrtPriceLimitX96));
        uint256 consumed;
        (trade.output, consumed) = abi.decode(swapResult, (uint256, uint256));
        if (consumed != swapInput) revert InvalidSettlement();
        if (trade.buy) {
            trade.tokenAmount = trade.output;
        } else {
            trade.tokenAmount = op.inputAmount;
            trade.grossQuote = trade.output;
            (trade.platformQuote, trade.creatorQuote) = _fees(trade.grossQuote, platformBps, creatorBps);
            trade.output -= trade.platformQuote + trade.creatorQuote;
        }
        (trade.platformEth, trade.creatorEth) =
            _convertFees(trade.platformQuote, trade.creatorQuote, op.deadline, limits);
        _transferOutputExactly(op.outputAsset, op.recipient, trade.output);
        _swapping = false;
        if (
            IERC20(_context.quoteAsset).balanceOf(address(this)) != trade.quoteBefore - (trade.buy ? op.inputAmount : 0)
                || IERC20(_context.token).balanceOf(address(this))
                    != trade.tokenBefore - (trade.buy ? 0 : op.inputAmount) || trade.output < op.minimumOutput
        ) revert InvalidSettlement();
        _emitTrade(op.actor, trade);
        return abi.encode(trade.output, trade.grossQuote, trade.tokenAmount, trade.platformEth, trade.creatorEth);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager) || !_swapping) revert UnauthorizedSwap();
        (bool buy, uint256 input, uint160 priceLimit) = abi.decode(data, (bool, uint256, uint160));
        bool quote0 = _context.quoteAsset < _context.token;
        bool zeroForOne = buy == quote0;
        if (priceLimit == 0) priceLimit = zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        BalanceDelta delta = poolManager.swap(poolKey(), SwapParams(zeroForOne, -input.toInt256(), priceLimit), "");
        int128 inputDelta = zeroForOne ? delta.amount0() : delta.amount1();
        int128 outputDelta = zeroForOne ? delta.amount1() : delta.amount0();
        if (inputDelta >= 0 || outputDelta <= 0) revert InvalidSettlement();
        uint256 consumed = uint256(-int256(inputDelta));
        uint256 output = uint256(int256(outputDelta));
        Currency.wrap(buy ? _context.quoteAsset : _context.token).settle(poolManager, address(this), consumed, false);
        Currency.wrap(buy ? _context.token : _context.quoteAsset).take(poolManager, address(this), output, false);
        return abi.encode(output, consumed);
    }

    function _beforeInitialize(address sender, PoolKey calldata key, uint160) internal view override returns (bytes4) {
        if (sender != address(this) || PoolId.unwrap(key.toId()) != poolId) revert InvalidPool();
        return BaseHook.beforeInitialize.selector;
    }

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata, bytes calldata)
        internal
        view
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (sender != address(this) || !_swapping || PoolId.unwrap(key.toId()) != poolId) {
            revert UnauthorizedSwap();
        }
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function _convertFees(uint256 platformQuote, uint256 creatorQuote, uint256 deadline, TradeLimits memory limits)
        private
        returns (uint256 platformEth, uint256 creatorEth)
    {
        uint256 quoteAmount = platformQuote + creatorQuote;
        if (quoteAmount == 0) return (0, 0);
        if (limits.minimumEthFees == 0 || address(converter).codehash != converterCodeHash) revert InvalidConversion();
        IERC20 quote = IERC20(_context.quoteAsset);
        uint256 quoteBefore = quote.balanceOf(address(this));
        uint256 ethBefore = address(this).balance;
        quote.forceApprove(address(converter), quoteAmount);
        uint256 ethAmount = converter.convert(
            _context.quoteAsset, quoteAmount, limits.minimumEthFees, deadline, limits.conversionRoute
        );
        quote.forceApprove(address(converter), 0);
        if (
            ethAmount < limits.minimumEthFees || address(this).balance - ethBefore != ethAmount
                || quoteBefore - quote.balanceOf(address(this)) != quoteAmount
        ) revert InvalidConversion();
        platformEth = FullMath.mulDiv(ethAmount, platformQuote, quoteAmount);
        creatorEth = ethAmount - platformEth;
        IModuleEngineFeeCollectorV1(_context.feeCollector).depositFees{ value: ethAmount }(platformEth, creatorEth);
        if (address(this).balance != ethBefore) revert InvalidConversion();
    }

    function _fees(uint256 grossQuote, uint16 platformBps, uint16 creatorBps) private pure returns (uint256, uint256) {
        return (FullMath.mulDiv(grossQuote, platformBps, 10_000), FullMath.mulDiv(grossQuote, creatorBps, 10_000));
    }

    function _transferOutputExactly(address asset, address recipient, uint256 amount) private {
        IERC20 token = IERC20(asset);
        uint256 beforeBalance = token.balanceOf(recipient);
        token.safeTransfer(recipient, amount);
        if (token.balanceOf(recipient) - beforeBalance != amount) revert InvalidSettlement();
    }

    function _emitTrade(address actor, Trade memory trade) private {
        emit QuoteTradeSettled(
            _context.launchId,
            actor,
            trade.buy,
            trade.grossQuote,
            trade.tokenAmount,
            trade.platformQuote + trade.creatorQuote,
            trade.platformEth,
            trade.creatorEth
        );
    }

    function _checkDependencies() private view {
        if (
            address(poolManager).codehash != poolManagerCodeHash
                || address(positionManager).codehash != positionManagerCodeHash
                || address(positionForwarderFactory).codehash != positionForwarderFactoryCodeHash
                || address(positionPlanner).codehash != positionPlannerCodeHash
        ) revert InvalidConfiguration();
    }

    function _verifyPosition(Position memory expected) private view {
        (PoolKey memory actualKey, PositionInfo info) = positionManager.getPoolAndPositionInfo(positionTokenId);
        if (
            positionManager.nextTokenId() != positionTokenId + 1
                || IERC721(address(positionManager)).ownerOf(positionTokenId) != positionRecipient
                || PoolId.unwrap(actualKey.toId()) != poolId || info.tickLower() != expected.tickLower
                || info.tickUpper() != expected.tickUpper
                || positionManager.getPositionLiquidity(positionTokenId) != expected.liquidity
                || IERC20(_context.token).balanceOf(address(this)) != 0
                || IERC20(_context.token).balanceOf(address(positionManager)) != 0
        ) revert InvalidPosition();
    }

    function _positionRecipient() private returns (address recipient) {
        recipient = positionForwarderFactory.predict(_context.launchId, _context.creator);
        if (recipient.code.length == 0) {
            recipient = address(positionForwarderFactory.deploy(_context.launchId, _context.creator));
        }
        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(recipient));
        if (
            positionForwarderFactory.configurationHashOf(recipient) == bytes32(0)
                || address(forwarder.positionManager()) != address(positionManager)
                || forwarder.operator() != address(0) || forwarder.timelockBlockNumber() != type(uint256).max
                || forwarder.feeRecipient() != _context.creator
        ) revert InvalidPosition();
    }
}
