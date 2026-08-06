// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { IHookEvents } from "@openzeppelin/uniswap-hooks/src/interfaces/IHookEvents.sol";
import { CurrencySettler } from "@openzeppelin/uniswap-hooks/src/utils/CurrencySettler.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
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

import { FeeSplitVaultFactoryV1 } from "./FeeSplitVaultFactoryV1.sol";
import { FeeSplitVaultV1 } from "./FeeSplitVaultV1.sol";
import { IHookSwapEvents } from "./interfaces/IHookSwapEvents.sol";
import { LadderScheduleV1 } from "./libraries/LadderScheduleV1.sol";

interface ILadderCreatorToken {
    function creator() external view returns (address);
}

/// @title EthLadderFeeHookV1
/// @notice Charges immutable Classic buy and sell fees, and records the price history a performance-unlock custody
///         wallet needs to release the Initial Buy.
/// @dev The fee path is carried over from the Classic release without modification: same bounds, same directional
///      configuration, same fixed 0.10 percentage-point Programmable share deducted from the total, same vault
///      authentication, same claim authority, same partial-fill invariant.
///
///      The addition is observation. A Uniswap v4 pool's tick changes only when a swap executes, and this hook runs
///      on every swap in its pools. It therefore records, per ladder tranche, the most recent block at which the
///      pool was seen below that tranche's tick. The absence of a recorded breach across a window is proof that no
///      breach occurred in that window, without polling, keepers or an oracle.
///
///      The hook holds no tokens on behalf of a ladder and releases nothing. It only answers whether a tranche's
///      dwell requirement is met. Custody lives in `ClassicPerformanceUnlockWalletV1`.
///
///      The hook is non-upgradeable and has no administrative controls.
contract EthLadderFeeHookV1 is BaseHook, IUnlockCallback, ReentrancyGuardTransient, IHookEvents, IHookSwapEvents {
    using BeforeSwapDeltaLibrary for BeforeSwapDelta;
    using CurrencySettler for Currency;
    using SafeCast for *;
    using StateLibrary for IPoolManager;

    uint16 public constant BASIS_POINTS = 10_000;
    uint16 public constant LAUNCHER_FEE_BPS = 10;
    uint16 public constant BUILDER_FEE_BPS = 10;
    /// @dev The floor must exceed the two fixed shares so that a creator configuration can never be constructed in
    ///      which the launcher or builder allocation is unpayable. Classic's 1.00% floor already satisfies this.
    uint16 public constant MIN_TOTAL_SWAP_FEE_BPS = 100;
    uint16 public constant MAX_TOTAL_SWAP_FEE_BPS = 1000;
    uint16 public constant TOTAL_SWAP_FEE_STEP_BPS = 100;
    uint16 public constant TRANSFER_TAX_BPS = 0;
    uint24 public constant LP_FEE_PIPS = 0;
    int24 public constant TICK_SPACING = 200;

    uint8 public constant MAX_TRANCHES = 5;

    Currency private constant NATIVE = Currency.wrap(address(0));

    struct PoolFeeConfig {
        // slot 0
        address rewardVault;
        uint16 buySwapFeeBps;
        uint16 sellSwapFeeBps;
        bool registered;
        // slot 1
        address registrar;
        uint32 dwellBlocks;
        uint8 trancheCount;
        // slot 2
        uint64 anchorBlock;
        // slot 3
        uint256 creatorFeesAccrued;
    }

    /// @dev Descending unlock ticks: a lower tick is a higher token price. Only the first `trancheCount` entries
    ///      are meaningful.
    struct LadderTicks {
        int24 tick0;
        int24 tick1;
        int24 tick2;
        int24 tick3;
        int24 tick4;
    }

    /// @dev Most recent block at which the pool was observed above each tranche's tick, meaning below its target
    ///      price. Zero means never breached
    ///      since the anchor. Packed into one slot; uint48 covers block heights for the life of the chain.
    struct LadderBreaches {
        uint48 breach0;
        uint48 breach1;
        uint48 breach2;
        uint48 breach3;
        uint48 breach4;
    }

    /// @notice The immutable address that receives Programmable's fixed 0.10 percentage-point share.
    address public immutable launcherFeeRecipient;

    /// @notice The immutable address that receives the accepted hook builder's fixed 0.10 percentage-point share.
    /// @dev Set once at deployment under the Hook Builder Program. Programmable cannot redirect or reduce it, and
    ///      only this address may claim it or nominate a different destination for a claim.
    address public immutable builderFeeRecipient;

    /// @notice The only vault factory accepted during pool registration.
    FeeSplitVaultFactoryV1 public immutable feeSplitVaultFactory;

    mapping(bytes32 poolId => PoolFeeConfig config) public poolFeeConfig;
    mapping(bytes32 poolId => LadderTicks ticks) private _ladderTicks;
    mapping(bytes32 poolId => LadderBreaches breaches) private _ladderBreaches;

    uint256 public launcherFeesAccrued;
    uint256 public builderFeesAccrued;
    uint256 public totalNativeFeesAccrued;

    error AlreadyRegistered(bytes32 poolId);
    error DwellOutOfRange(uint32 dwellBlocks);
    error InvalidCurrencyOrder(address currency0, address currency1);
    error InvalidHook(address actual, address expected);
    error InvalidLpFee(uint24 actual, uint24 expected);
    error InvalidRegistrar(address caller, address recordedCreator);
    error InvalidRewardVault(address rewardVault);
    error InvalidTickSpacing(int24 actual, int24 expected);
    error InvalidTotalSwapFee(uint16 totalSwapFeeBps);
    error NoFeesToClaim();
    error PartialFillUnsupported(uint256 expectedNativePoolAmount, uint256 actualNativePoolAmount);
    error PoolNotRegistered(bytes32 poolId);
    error TicksMustDescend(uint8 index, int24 previousTick, int24 unlockTick);
    error TickNotOnSpacing(uint8 index, int24 unlockTick);
    error TickOutOfRange(uint8 index, int24 unlockTick);
    error TrancheCountOutOfRange(uint256 count);
    error TrancheIndexOutOfRange(uint8 index, uint8 trancheCount);
    error UnauthorizedCreatorClaim(address caller, address expectedVault);
    error UnauthorizedFeeRedirect(address caller, address expected);
    error UnauthorizedInitializer(address caller, address expected);
    error UnexpectedUnlockResult();
    error UnrecognizedToken(address token);
    error ZeroAddress();

    event PoolRegistered(
        bytes32 indexed poolId,
        address indexed token,
        address indexed rewardVault,
        address registrar,
        uint16 buySwapFeeBps,
        uint16 sellSwapFeeBps,
        bytes32 rewardConfigurationHash
    );
    event PoolFeeDisclosure(
        bytes32 indexed poolId,
        address indexed token,
        address indexed rewardVault,
        uint16 buySwapFeeBps,
        uint16 sellSwapFeeBps,
        uint16 buyCreatorFeeBps,
        uint16 sellCreatorFeeBps,
        uint16 launcherFeeBps,
        uint16 builderFeeBps,
        uint16 transferTaxBps,
        uint24 lpFeePips
    );
    event LadderDisclosure(bytes32 indexed poolId, address indexed token, int24[] unlockTicks, uint32 dwellBlocks);
    event LadderAnchored(bytes32 indexed poolId, uint64 anchorBlock);
    event NativeSwapFeesAccrued(
        bytes32 indexed poolId,
        address indexed swapSender,
        bool indexed isBuy,
        uint16 appliedTotalSwapFeeBps,
        uint256 grossNativeAmount,
        uint256 creatorFee,
        uint256 launcherFee,
        uint256 builderFee
    );
    event CreatorFeesClaimed(
        bytes32 indexed poolId, address indexed rewardVault, address indexed caller, uint256 amount
    );
    event LauncherFeesClaimed(
        address indexed treasury, address indexed recipient, address indexed caller, uint256 amount
    );
    event BuilderFeesClaimed(
        address indexed builder, address indexed recipient, address indexed caller, uint256 amount
    );

    constructor(
        IPoolManager poolManager_,
        address launcherFeeRecipient_,
        address builderFeeRecipient_,
        FeeSplitVaultFactoryV1 feeSplitVaultFactory_
    ) BaseHook(poolManager_) {
        if (
            address(poolManager_) == address(0) || launcherFeeRecipient_ == address(0)
                || builderFeeRecipient_ == address(0) || address(feeSplitVaultFactory_) == address(0)
                || address(feeSplitVaultFactory_).code.length == 0
        ) {
            revert ZeroAddress();
        }
        launcherFeeRecipient = launcherFeeRecipient_;
        builderFeeRecipient = builderFeeRecipient_;
        feeSplitVaultFactory = feeSplitVaultFactory_;
    }

    /// @notice Registers one native ETH/token pool with immutable directional fees, reward vault and ladder terms.
    /// @param unlockTicks Descending ticks, aligned to the pool's tick spacing. One to five entries. These pools
    ///        pair a token against native ETH as `currency0`, so the tick falls as the token's ETH price rises and a
    ///        higher price target is a lower tick.
    /// @param dwellBlocks Consecutive blocks a tranche's tick must hold before that tranche releases.
    function registerPool(
        PoolKey calldata key,
        address rewardVault,
        uint16 buySwapFeeBps,
        uint16 sellSwapFeeBps,
        int24[] calldata unlockTicks,
        uint32 dwellBlocks
    ) external returns (bytes32 poolId) {
        _validatePoolShape(key);
        _validateTotalSwapFee(buySwapFeeBps);
        _validateTotalSwapFee(sellSwapFeeBps);
        _validateLadder(unlockTicks, dwellBlocks);

        address token = Currency.unwrap(key.currency1);
        address recordedCreator = _recordedTokenCreator(token);
        if (recordedCreator != msg.sender) revert InvalidRegistrar(msg.sender, recordedCreator);

        poolId = PoolId.unwrap(key.toId());
        if (poolFeeConfig[poolId].registered) revert AlreadyRegistered(poolId);
        bytes32 rewardConfigurationHash = _validateRewardVault(rewardVault, poolId);

        poolFeeConfig[poolId] = PoolFeeConfig({
            rewardVault: rewardVault,
            buySwapFeeBps: buySwapFeeBps,
            sellSwapFeeBps: sellSwapFeeBps,
            registered: true,
            registrar: msg.sender,
            dwellBlocks: dwellBlocks,
            trancheCount: uint8(unlockTicks.length),
            anchorBlock: 0,
            creatorFeesAccrued: 0
        });
        _storeLadderTicks(poolId, unlockTicks);
        _emitRegistrationDisclosures(poolId, token, rewardConfigurationHash);
    }

    /// @dev Emits the registration record from storage rather than from `registerPool`'s locals. Reading the values
    ///      back keeps `registerPool` within the EVM's stack depth without requiring the IR pipeline, and guarantees
    ///      the disclosure reflects what was actually written.
    function _emitRegistrationDisclosures(bytes32 poolId, address token, bytes32 rewardConfigurationHash) private {
        PoolFeeConfig storage config = poolFeeConfig[poolId];

        emit PoolRegistered(
            poolId,
            token,
            config.rewardVault,
            config.registrar,
            config.buySwapFeeBps,
            config.sellSwapFeeBps,
            rewardConfigurationHash
        );
        emit PoolFeeDisclosure(
            poolId,
            token,
            config.rewardVault,
            config.buySwapFeeBps,
            config.sellSwapFeeBps,
            config.buySwapFeeBps - LAUNCHER_FEE_BPS - BUILDER_FEE_BPS,
            config.sellSwapFeeBps - LAUNCHER_FEE_BPS - BUILDER_FEE_BPS,
            LAUNCHER_FEE_BPS,
            BUILDER_FEE_BPS,
            TRANSFER_TAX_BPS,
            LP_FEE_PIPS
        );
        emit LadderDisclosure(poolId, token, _loadLadderTicks(poolId, config.trancheCount), config.dwellBlocks);
    }

    /// @notice Returns all immutable fee and reward routing information for `poolId`.
    function feeDisclosure(bytes32 poolId)
        external
        view
        returns (
            uint16 buySwapFeeBps,
            uint16 sellSwapFeeBps,
            uint16 buyCreatorFeeBps,
            uint16 sellCreatorFeeBps,
            uint16 launcherFeeBps,
            uint16 builderFeeBps,
            uint16 transferTaxBps,
            uint24 lpFeePips,
            address rewardVault
        )
    {
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        if (!config.registered) revert PoolNotRegistered(poolId);

        buySwapFeeBps = config.buySwapFeeBps;
        sellSwapFeeBps = config.sellSwapFeeBps;
        buyCreatorFeeBps = buySwapFeeBps - LAUNCHER_FEE_BPS - BUILDER_FEE_BPS;
        sellCreatorFeeBps = sellSwapFeeBps - LAUNCHER_FEE_BPS - BUILDER_FEE_BPS;
        launcherFeeBps = LAUNCHER_FEE_BPS;
        builderFeeBps = BUILDER_FEE_BPS;
        transferTaxBps = TRANSFER_TAX_BPS;
        lpFeePips = LP_FEE_PIPS;
        rewardVault = config.rewardVault;
    }

    /// @notice Returns the immutable ladder terms recorded for `poolId`.
    function ladderDisclosure(bytes32 poolId)
        external
        view
        returns (int24[] memory unlockTicks, uint32 dwellBlocks, uint64 anchorBlock)
    {
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        if (!config.registered) revert PoolNotRegistered(poolId);

        unlockTicks = _loadLadderTicks(poolId, config.trancheCount);
        dwellBlocks = config.dwellBlocks;
        anchorBlock = config.anchorBlock;
    }

    /// @notice Returns the most recent block at which the pool was observed below tranche `index`'s tick.
    /// @dev Zero means the pool has not been observed below that tick since the anchor.
    function trancheBreachBlock(bytes32 poolId, uint8 index) public view returns (uint64) {
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        if (!config.registered) revert PoolNotRegistered(poolId);
        if (index >= config.trancheCount) revert TrancheIndexOutOfRange(index, config.trancheCount);
        return _breachAt(_ladderBreaches[poolId], index);
    }

    /// @notice Returns whether tranche `index` has satisfied its dwell requirement as of this block.
    /// @dev This is the only function a custody wallet needs. It reports a fact about price history; it does not
    ///      move tokens and has no side effects.
    function isTrancheUnlocked(bytes32 poolId, uint8 index) external view returns (bool) {
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        if (!config.registered) revert PoolNotRegistered(poolId);
        if (index >= config.trancheCount) revert TrancheIndexOutOfRange(index, config.trancheCount);

        (, int24 currentTick,,) = poolManager.getSlot0(PoolId.wrap(poolId));

        return LadderScheduleV1.isUnlocked(
            config.anchorBlock,
            _breachAt(_ladderBreaches[poolId], index),
            currentTick,
            _tickAt(_ladderTicks[poolId], index),
            config.dwellBlocks,
            block.number
        );
    }

    function totalSwapFeeBpsFor(bytes32 poolId, bool isBuy) public view returns (uint16) {
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        if (!config.registered) revert PoolNotRegistered(poolId);
        return isBuy ? config.buySwapFeeBps : config.sellSwapFeeBps;
    }

    function quoteGrossFees(uint256 grossNativeAmount, uint16 totalSwapFeeBps)
        external
        pure
        returns (uint256 creatorFee, uint256 launcherFee, uint256 builderFee)
    {
        _validateTotalSwapFee(totalSwapFeeBps);
        return _feesForGross(grossNativeAmount, totalSwapFeeBps);
    }

    function quoteExactOutputFees(uint256 netNativeAmount, uint16 totalSwapFeeBps)
        external
        pure
        returns (uint256 creatorFee, uint256 launcherFee, uint256 builderFee)
    {
        _validateTotalSwapFee(totalSwapFeeBps);
        return _feesForNet(netNativeAmount, totalSwapFeeBps);
    }

    /// @notice Redeems all currently accrued creator fees to the registered vault.
    function claimCreatorFees(bytes32 poolId) external nonReentrant returns (uint256 amount) {
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        if (!config.registered) revert PoolNotRegistered(poolId);
        if (msg.sender != config.rewardVault) revert UnauthorizedCreatorClaim(msg.sender, config.rewardVault);

        amount = config.creatorFeesAccrued;
        if (amount == 0) return 0;
        config.creatorFeesAccrued = 0;
        totalNativeFeesAccrued -= amount;
        _redeemNative(config.rewardVault, amount);

        emit CreatorFeesClaimed(poolId, config.rewardVault, msg.sender, amount);
    }

    /// @notice Redeems Programmable fees to the immutable treasury.
    function claimLauncherFees() external nonReentrant returns (uint256 amount) {
        if (msg.sender != launcherFeeRecipient) {
            revert UnauthorizedFeeRedirect(msg.sender, launcherFeeRecipient);
        }
        return _claimLauncherFees(launcherFeeRecipient);
    }

    /// @notice Lets only the immutable treasury choose an alternative payout destination for this claim.
    function claimLauncherFeesTo(address recipient) external nonReentrant returns (uint256 amount) {
        if (msg.sender != launcherFeeRecipient) {
            revert UnauthorizedFeeRedirect(msg.sender, launcherFeeRecipient);
        }
        if (recipient == address(0)) revert ZeroAddress();
        return _claimLauncherFees(recipient);
    }

    function _claimLauncherFees(address recipient) private returns (uint256 amount) {
        amount = launcherFeesAccrued;
        if (amount == 0) revert NoFeesToClaim();

        launcherFeesAccrued = 0;
        totalNativeFeesAccrued -= amount;
        _redeemNative(recipient, amount);
        // Every external entry point holds ReentrancyGuardTransient and all accounting effects precede the unlock.
        // slither-disable-next-line reentrancy-events
        emit LauncherFeesClaimed(launcherFeeRecipient, recipient, msg.sender, amount);
    }

    /// @notice Redeems the accepted builder's share to the immutable builder beneficiary.
    /// @dev Only that beneficiary can initiate the claim. Programmable has no path to this balance.
    function claimBuilderFees() external nonReentrant returns (uint256 amount) {
        if (msg.sender != builderFeeRecipient) {
            revert UnauthorizedFeeRedirect(msg.sender, builderFeeRecipient);
        }
        return _claimBuilderFees(builderFeeRecipient);
    }

    /// @notice Lets only the immutable builder beneficiary choose an alternative payout destination for this claim.
    /// @dev Changing where a claim is paid does not change the builder allocation itself.
    function claimBuilderFeesTo(address recipient) external nonReentrant returns (uint256 amount) {
        if (msg.sender != builderFeeRecipient) {
            revert UnauthorizedFeeRedirect(msg.sender, builderFeeRecipient);
        }
        if (recipient == address(0)) revert ZeroAddress();
        return _claimBuilderFees(recipient);
    }

    function _claimBuilderFees(address recipient) private returns (uint256 amount) {
        amount = builderFeesAccrued;
        if (amount == 0) revert NoFeesToClaim();

        builderFeesAccrued = 0;
        totalNativeFeesAccrued -= amount;
        _redeemNative(recipient, amount);
        // slither-disable-next-line reentrancy-events
        emit BuilderFeesClaimed(builderFeeRecipient, recipient, msg.sender, amount);
    }

    /// @inheritdoc BaseHook
    function getHookPermissions() public pure override returns (Hooks.Permissions memory permissions) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta: true,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @dev Records the ladder anchor. Initialization is single-shot in the PoolManager, so the anchor is write-once.
    function _beforeInitialize(address sender, PoolKey calldata key, uint160) internal override returns (bytes4) {
        _validatePoolShape(key);
        bytes32 poolId = PoolId.unwrap(key.toId());
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        if (!config.registered) revert PoolNotRegistered(poolId);
        if (sender != config.registrar) revert UnauthorizedInitializer(sender, config.registrar);

        uint64 anchorBlock = uint64(block.number);
        config.anchorBlock = anchorBlock;

        emit LadderAnchored(poolId, anchorBlock);
        return IHooks.beforeInitialize.selector;
    }

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        bytes32 poolId = _registeredPoolId(key);
        bool nativeIsSpecified = params.zeroForOne == (params.amountSpecified < 0);
        if (!nativeIsSpecified) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        uint256 nativeAmount = _absolute(params.amountSpecified);
        uint256 totalFee = _chargeNative(poolId, sender, nativeAmount, params.amountSpecified > 0, params.zeroForOne);
        if (totalFee == 0) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(totalFee.toInt256().toInt128(), 0), 0);
    }

    function _afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) internal override returns (bytes4, int128) {
        bytes32 poolId = _registeredPoolId(key);
        uint16 appliedFeeBps = totalSwapFeeBpsFor(poolId, params.zeroForOne);
        bool nativeIsSpecified = params.zeroForOne == (params.amountSpecified < 0);

        // Observation happens after the swap has moved the tick, and before any fee accounting can revert, so the
        // ladder sees exactly the prices the pool actually traded at.
        _observeLadder(poolId);

        if (nativeIsSpecified) {
            _assertFullFill(params, delta, appliedFeeBps);
            return (IHooks.afterSwap.selector, 0);
        }

        uint256 nativeAmount = _absolute(int256(delta.amount0()));
        uint256 totalFee = _chargeNative(poolId, sender, nativeAmount, params.amountSpecified > 0, params.zeroForOne);
        if (totalFee == 0) return (IHooks.afterSwap.selector, 0);
        return (IHooks.afterSwap.selector, totalFee.toInt256().toInt128());
    }

    /// @dev Reverts unless the pool moved exactly the native amount the charged fee implies.
    ///
    ///      The fee is taken in `beforeSwap` for an exact-input swap, so the pool must settle the requested amount
    ///      net of that fee precisely. A shortfall means the swap filled partially, which this model does not
    ///      support because the fee would no longer correspond to the trade that executed.
    ///
    ///      Kept out of `_afterSwap` so that the three fee components do not push that function past the EVM's
    ///      stack depth under the non-IR pipeline.
    function _assertFullFill(SwapParams calldata params, BalanceDelta delta, uint16 appliedFeeBps) private pure {
        uint256 requestedNativeAmount = _absolute(params.amountSpecified);
        (uint256 creatorFee, uint256 launcherFee, uint256 builderFee) = params.amountSpecified > 0
            ? _feesForNet(requestedNativeAmount, appliedFeeBps)
            : _feesForGross(requestedNativeAmount, appliedFeeBps);

        uint256 expectedTotalFee = creatorFee + launcherFee + builderFee;
        uint256 expectedNativePoolAmount = params.amountSpecified > 0
            ? requestedNativeAmount + expectedTotalFee
            : requestedNativeAmount - expectedTotalFee;
        uint256 actualNativePoolAmount = _absolute(int256(delta.amount0()));

        if (actualNativePoolAmount != expectedNativePoolAmount) {
            revert PartialFillUnsupported(expectedNativePoolAmount, actualNativePoolAmount);
        }
    }

    function unlockCallback(bytes calldata data) external onlyPoolManager returns (bytes memory) {
        (address recipient, uint256 amount) = abi.decode(data, (address, uint256));
        NATIVE.settle(poolManager, address(this), amount, true);
        NATIVE.take(poolManager, recipient, amount, false);
        return "";
    }

    /// @dev Stamps the current block against every tranche whose target price the pool now sits below.
    ///
    ///      Unlock ticks descend, so the set of breached tranches is always a suffix of the ladder: if the pool is
    ///      below tranche i's price it is below every target above i. One ordered pass therefore settles the whole
    ///      ladder, and the packed breach record is written at most once per swap.
    ///
    ///      A pool at or above every target price writes nothing.
    function _observeLadder(bytes32 poolId) private {
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        uint8 trancheCount = config.trancheCount;
        if (trancheCount == 0) return;

        (, int24 currentTick,,) = poolManager.getSlot0(PoolId.wrap(poolId));

        LadderTicks storage ticks = _ladderTicks[poolId];
        LadderBreaches memory breaches = _ladderBreaches[poolId];
        uint48 currentBlock = uint48(block.number);
        bool dirty;

        for (uint8 i = 0; i < trancheCount; ++i) {
            if (currentTick <= _tickAt(ticks, i)) continue;
            // From here up, every tranche is breached.
            for (uint8 j = i; j < trancheCount; ++j) {
                _setBreach(breaches, j, currentBlock);
            }
            dirty = true;
            break;
        }

        if (dirty) _ladderBreaches[poolId] = breaches;
    }

    function _accrue(
        bytes32 poolId,
        PoolFeeConfig storage config,
        address sender,
        bool isBuy,
        uint16 appliedFeeBps,
        uint256 grossNativeAmount,
        uint256 creatorFee,
        uint256 launcherFee,
        uint256 builderFee
    ) private {
        uint256 totalFee = creatorFee + launcherFee + builderFee;
        config.creatorFeesAccrued += creatorFee;
        launcherFeesAccrued += launcherFee;
        builderFeesAccrued += builderFee;
        totalNativeFeesAccrued += totalFee;

        emit HookFee(poolId, sender, totalFee.toUint128(), 0);
        emit HookSwap(PoolId.wrap(poolId), sender, -totalFee.toInt256().toInt128(), 0, uint24(appliedFeeBps) * 100);
        emit NativeSwapFeesAccrued(
            poolId, sender, isBuy, appliedFeeBps, grossNativeAmount, creatorFee, launcherFee, builderFee
        );
    }

    function _chargeNative(bytes32 poolId, address sender, uint256 nativeAmount, bool amountIsNet, bool isBuy)
        private
        returns (uint256 totalFee)
    {
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        uint16 appliedFeeBps = isBuy ? config.buySwapFeeBps : config.sellSwapFeeBps;
        (uint256 creatorFee, uint256 launcherFee, uint256 builderFee) =
            amountIsNet ? _feesForNet(nativeAmount, appliedFeeBps) : _feesForGross(nativeAmount, appliedFeeBps);
        totalFee = creatorFee + launcherFee + builderFee;
        if (totalFee == 0) return 0;

        _accrue(
            poolId,
            config,
            sender,
            isBuy,
            appliedFeeBps,
            nativeAmount + (amountIsNet ? totalFee : 0),
            creatorFee,
            launcherFee,
            builderFee
        );
        NATIVE.take(poolManager, address(this), totalFee, true);
    }

    function _redeemNative(address recipient, uint256 amount) private {
        bytes memory result = poolManager.unlock(abi.encode(recipient, amount));
        if (result.length != 0) revert UnexpectedUnlockResult();
    }

    function _storeLadderTicks(bytes32 poolId, int24[] calldata unlockTicks) private {
        LadderTicks storage ticks = _ladderTicks[poolId];
        uint256 count = unlockTicks.length;
        if (count > 0) ticks.tick0 = unlockTicks[0];
        if (count > 1) ticks.tick1 = unlockTicks[1];
        if (count > 2) ticks.tick2 = unlockTicks[2];
        if (count > 3) ticks.tick3 = unlockTicks[3];
        if (count > 4) ticks.tick4 = unlockTicks[4];
    }

    function _loadLadderTicks(bytes32 poolId, uint8 trancheCount) private view returns (int24[] memory unlockTicks) {
        LadderTicks storage ticks = _ladderTicks[poolId];
        unlockTicks = new int24[](trancheCount);
        for (uint8 i = 0; i < trancheCount; ++i) {
            unlockTicks[i] = _tickAt(ticks, i);
        }
    }

    function _tickAt(LadderTicks storage ticks, uint8 index) private view returns (int24) {
        if (index == 0) return ticks.tick0;
        if (index == 1) return ticks.tick1;
        if (index == 2) return ticks.tick2;
        if (index == 3) return ticks.tick3;
        return ticks.tick4;
    }

    function _breachAt(LadderBreaches storage breaches, uint8 index) private view returns (uint64) {
        if (index == 0) return breaches.breach0;
        if (index == 1) return breaches.breach1;
        if (index == 2) return breaches.breach2;
        if (index == 3) return breaches.breach3;
        return breaches.breach4;
    }

    function _setBreach(LadderBreaches memory breaches, uint8 index, uint48 blockNumber) private pure {
        if (index == 0) breaches.breach0 = blockNumber;
        else if (index == 1) breaches.breach1 = blockNumber;
        else if (index == 2) breaches.breach2 = blockNumber;
        else if (index == 3) breaches.breach3 = blockNumber;
        else breaches.breach4 = blockNumber;
    }

    function _registeredPoolId(PoolKey calldata key) private view returns (bytes32 poolId) {
        _validatePoolShape(key);
        poolId = PoolId.unwrap(key.toId());
        if (!poolFeeConfig[poolId].registered) revert PoolNotRegistered(poolId);
    }

    function _validatePoolShape(PoolKey calldata key) private view {
        address currency0 = Currency.unwrap(key.currency0);
        address currency1 = Currency.unwrap(key.currency1);
        if (currency0 != address(0) || currency1 == address(0)) {
            revert InvalidCurrencyOrder(currency0, currency1);
        }
        if (address(key.hooks) != address(this)) revert InvalidHook(address(key.hooks), address(this));
        if (key.fee != LP_FEE_PIPS) revert InvalidLpFee(key.fee, LP_FEE_PIPS);
        if (key.tickSpacing != TICK_SPACING) revert InvalidTickSpacing(key.tickSpacing, TICK_SPACING);
    }

    /// @dev Ticks must align to the pool's spacing so that a tranche's threshold is a price the pool can actually
    ///      settle on, rather than one that rounds unpredictably. They must strictly descend, because a lower tick
    ///      is a higher token price in a native-ETH pool.
    function _validateLadder(int24[] calldata unlockTicks, uint32 dwellBlocks) private pure {
        uint256 count = unlockTicks.length;
        if (count == 0 || count > MAX_TRANCHES) revert TrancheCountOutOfRange(count);
        if (dwellBlocks < LadderScheduleV1.MIN_DWELL_BLOCKS || dwellBlocks > LadderScheduleV1.MAX_DWELL_BLOCKS) {
            revert DwellOutOfRange(dwellBlocks);
        }

        int24 previousTick = type(int24).min;
        for (uint8 i = 0; i < count; ++i) {
            int24 unlockTick = unlockTicks[i];
            if (unlockTick < LadderScheduleV1.MIN_UNLOCK_TICK || unlockTick > LadderScheduleV1.MAX_UNLOCK_TICK) {
                revert TickOutOfRange(i, unlockTick);
            }
            if (unlockTick % TICK_SPACING != 0) revert TickNotOnSpacing(i, unlockTick);
            if (i != 0 && unlockTick >= previousTick) revert TicksMustDescend(i, previousTick, unlockTick);
            previousTick = unlockTick;
        }
    }

    function _validateRewardVault(address rewardVault, bytes32 expectedPoolId)
        private
        view
        returns (bytes32 configurationHash)
    {
        if (
            rewardVault == address(0) || rewardVault.code.length == 0
                || feeSplitVaultFactory.configurationHashOf(rewardVault) == bytes32(0)
        ) {
            revert InvalidRewardVault(rewardVault);
        }

        FeeSplitVaultV1 vault = FeeSplitVaultV1(payable(rewardVault));
        if (
            address(vault.feeHook()) != address(this) || address(vault.poolManager()) != address(poolManager)
                || vault.poolId() != expectedPoolId
        ) {
            revert InvalidRewardVault(rewardVault);
        }
        configurationHash = vault.configurationHash();
        if (configurationHash != feeSplitVaultFactory.configurationHashOf(rewardVault)) {
            revert InvalidRewardVault(rewardVault);
        }
    }

    function _recordedTokenCreator(address token) private view returns (address recordedCreator) {
        if (token.code.length == 0) revert UnrecognizedToken(token);
        try ILadderCreatorToken(token).creator() returns (address creator) {
            recordedCreator = creator;
        } catch {
            revert UnrecognizedToken(token);
        }
        if (recordedCreator == address(0)) revert UnrecognizedToken(token);
    }

    /// @dev The launcher and builder shares are carved out of the declared total, never added on top. Where the
    ///      total cannot cover both fixed shares the creator receives nothing and the shortfall is split in favour
    ///      of the launcher, so the protocol share can never be starved by rounding.
    function _feesForGross(uint256 grossNativeAmount, uint16 totalSwapFeeBps)
        private
        pure
        returns (uint256 creatorFee, uint256 launcherFee, uint256 builderFee)
    {
        uint256 totalFee = FullMath.mulDiv(grossNativeAmount, totalSwapFeeBps, BASIS_POINTS);
        launcherFee = FullMath.mulDiv(grossNativeAmount, LAUNCHER_FEE_BPS, BASIS_POINTS);
        builderFee = FullMath.mulDiv(grossNativeAmount, BUILDER_FEE_BPS, BASIS_POINTS);
        (launcherFee, builderFee, creatorFee) = _apportion(totalFee, launcherFee, builderFee);
    }

    function _feesForNet(uint256 netNativeAmount, uint16 totalSwapFeeBps)
        private
        pure
        returns (uint256 creatorFee, uint256 launcherFee, uint256 builderFee)
    {
        uint256 grossNativeAmount =
            FullMath.mulDivRoundingUp(netNativeAmount, BASIS_POINTS, BASIS_POINTS - totalSwapFeeBps);
        uint256 totalFee = grossNativeAmount - netNativeAmount;
        launcherFee = FullMath.mulDiv(grossNativeAmount, LAUNCHER_FEE_BPS, BASIS_POINTS);
        builderFee = FullMath.mulDiv(grossNativeAmount, BUILDER_FEE_BPS, BASIS_POINTS);
        (launcherFee, builderFee, creatorFee) = _apportion(totalFee, launcherFee, builderFee);
    }

    /// @dev Clamps the two fixed shares to the available total and returns the creator remainder.
    function _apportion(uint256 totalFee, uint256 launcherFee, uint256 builderFee)
        private
        pure
        returns (uint256, uint256, uint256)
    {
        if (launcherFee > totalFee) launcherFee = totalFee;
        uint256 remaining = totalFee - launcherFee;
        if (builderFee > remaining) builderFee = remaining;
        return (launcherFee, builderFee, remaining - builderFee);
    }

    function _validateTotalSwapFee(uint16 totalSwapFeeBps) private pure {
        if (
            totalSwapFeeBps < MIN_TOTAL_SWAP_FEE_BPS || totalSwapFeeBps > MAX_TOTAL_SWAP_FEE_BPS
                || totalSwapFeeBps % TOTAL_SWAP_FEE_STEP_BPS != 0
        ) {
            revert InvalidTotalSwapFee(totalSwapFeeBps);
        }
    }

    function _absolute(int256 value) private pure returns (uint256) {
        if (value >= 0) return value.toUint256();
        return (-(value + 1)).toUint256() + 1;
    }
}
