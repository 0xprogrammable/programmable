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
import { ClaimState, TickerClaim, TickerClaimV1 } from "./libraries/TickerClaimV1.sol";

interface IFirstMoverToken {
    function creator() external view returns (address);
    function symbol() external view returns (string memory);
}

/// @title EthFirstMoverFeeHookV1
/// @notice Charges immutable Classic buy and sell fees, and settles which pool owns a ticker.
/// @dev A token symbol is claimed by the first pool to trade it, not the first pool to register it. Registration
///      takes a provisional claim; the claim becomes permanent only once the pool has accrued enough creator fees to
///      prove genuine volume. An unconfirmed claim lapses after a grace window and the ticker frees up.
///
///      A pool registering a symbol that is already live is not rejected. The model does not censor launches. It is
///      recorded as a derivative of the original and routes a portion of its own creator share to the original's
///      reward vault for as long as the original's claim stands.
///
///      Tribute is a redistribution of the creator share alone. The total fee charged on a swap, the fixed 0.10
///      percentage-point Programmable share and the fixed 0.10 percentage-point builder share are all identical to a
///      non-derivative pool, so a trader cannot tell the difference and is never charged more.
///
///      The fee path is otherwise carried over from the Classic release without modification. The hook is
///      non-upgradeable and has no administrative controls.
contract EthFirstMoverFeeHookV1 is BaseHook, IUnlockCallback, ReentrancyGuardTransient, IHookEvents, IHookSwapEvents {
    using BeforeSwapDeltaLibrary for BeforeSwapDelta;
    using CurrencySettler for Currency;
    using SafeCast for *;

    uint16 public constant BASIS_POINTS = 10_000;

    /// @notice The Programmable treasury that receives the fixed 0.10 percentage-point launcher share.
    /// @dev Hardcoded rather than accepted as a constructor argument. The launcher share is Programmable's own
    ///      protocol revenue, not a parameter a deployer should be able to redirect; enforcing it as a constant
    ///      makes an incorrect or malicious value impossible to deploy rather than merely validated against at
    ///      construction. This is the same address Classic's own mainnet deployment pays. The builder beneficiary
    ///      remains a constructor argument -- that one legitimately varies per accepted hook and is not
    ///      Programmable's own wallet.
    address public constant PROGRAMMABLE_TREASURY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    uint16 public constant LAUNCHER_FEE_BPS = 10;
    uint16 public constant BUILDER_FEE_BPS = 10;
    uint16 public constant MIN_TOTAL_SWAP_FEE_BPS = 100;
    uint16 public constant MAX_TOTAL_SWAP_FEE_BPS = 1000;
    uint16 public constant TOTAL_SWAP_FEE_STEP_BPS = 100;
    uint16 public constant TRANSFER_TAX_BPS = 0;
    uint24 public constant LP_FEE_PIPS = 0;
    int24 public constant TICK_SPACING = 200;

    uint256 public constant CONFIRMATION_FEE_WEI = TickerClaimV1.CONFIRMATION_FEE_WEI;
    uint64 public constant GRACE_BLOCKS = TickerClaimV1.GRACE_BLOCKS;
    uint16 public constant TRIBUTE_SHARE_BPS = TickerClaimV1.TRIBUTE_SHARE_BPS;

    Currency private constant NATIVE = Currency.wrap(address(0));

    /// @dev Deliberately holds no notion of "original" or "derivative": that relationship is not a fact fixed at
    ///      registration, it is a live property of the ticker registry and can change as claims lapse and are
    ///      superseded. Every place that needs it -- fee accrual, `isOriginal`, `derivativeOf` -- looks it up fresh
    ///      from `tickerClaim` rather than trusting a stored snapshot that could go stale.
    struct PoolFeeConfig {
        // slot 0
        address rewardVault;
        uint16 buySwapFeeBps;
        uint16 sellSwapFeeBps;
        bool registered;
        // slot 1
        address registrar;
        // slot 2
        bytes32 symbolHash;
        // slot 3
        uint256 creatorFeesAccrued;
        // slot 4
        uint256 lifetimeCreatorFees;
    }

    /// @notice The immutable address that receives Programmable's fixed 0.10 percentage-point share.
    address public immutable launcherFeeRecipient;

    /// @notice The immutable address that receives the accepted hook builder's fixed 0.10 percentage-point share.
    address public immutable builderFeeRecipient;

    /// @notice The only vault factory accepted during pool registration.
    FeeSplitVaultFactoryV1 public immutable feeSplitVaultFactory;

    mapping(bytes32 poolId => PoolFeeConfig config) public poolFeeConfig;

    /// @notice The current claim on each normalized symbol.
    mapping(bytes32 symbolHash => TickerClaim claim) public tickerClaim;

    uint256 public launcherFeesAccrued;
    uint256 public builderFeesAccrued;
    uint256 public totalNativeFeesAccrued;

    /// @dev Fractional-wei remainder (scaled by BASIS_POINTS) not yet resolved into a whole wei, carried forward
    ///      across swaps so the launcher and builder shares converge exactly to their bps of cumulative volume
    ///      rather than losing precision to per-swap flooring.
    uint256 private _launcherFeeRemainderNumerator;
    uint256 private _builderFeeRemainderNumerator;

    /// @dev Whole wei resolved as owed to the launcher or builder but not yet paid, because the swap that resolved
    ///      it had too small a totalFee to cover it. Carried forward and retried on every subsequent swap until
    ///      paid in full; never dropped.
    uint256 private _launcherFeeOwedWei;
    uint256 private _builderFeeOwedWei;

    error AlreadyRegistered(bytes32 poolId);
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
    error UnauthorizedCreatorClaim(address caller, address expectedVault);
    error UnauthorizedFeeRedirect(address caller, address expected);
    error UnauthorizedInitializer(address caller, address expected);
    error UnexpectedUnlockResult();
    error UnreadableSymbol(address token);
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
    /// @dev Emitted when a pool takes a provisional claim on a symbol nobody currently holds.
    event TickerClaimed(bytes32 indexed symbolHash, bytes32 indexed poolId, address indexed token, uint64 claimBlock);
    /// @dev Emitted once, when a provisional claim is earned and becomes permanent.
    event TickerConfirmed(bytes32 indexed symbolHash, bytes32 indexed poolId, uint256 lifetimeCreatorFees);
    /// @dev Emitted when a pool registers a symbol that is already live and becomes a derivative of its holder.
    event DerivativeRegistered(
        bytes32 indexed symbolHash, bytes32 indexed poolId, bytes32 indexed originalPoolId, address token
    );
    /// @dev Emitted whenever a derivative's creator share is split with the original it copies.
    event TributePaid(bytes32 indexed poolId, bytes32 indexed originalPoolId, uint256 amount);
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

    constructor(IPoolManager poolManager_, address builderFeeRecipient_, FeeSplitVaultFactoryV1 feeSplitVaultFactory_)
        BaseHook(poolManager_)
    {
        if (
            address(poolManager_) == address(0) || builderFeeRecipient_ == address(0)
                || address(feeSplitVaultFactory_) == address(0) || address(feeSplitVaultFactory_).code.length == 0
        ) {
            revert ZeroAddress();
        }
        launcherFeeRecipient = PROGRAMMABLE_TREASURY;
        builderFeeRecipient = builderFeeRecipient_;
        feeSplitVaultFactory = feeSplitVaultFactory_;
    }

    /// @notice Registers one native ETH/token pool and settles its position in the ticker registry.
    /// @dev Takes the symbol from the token itself rather than an argument, so a registrant cannot claim a ticker
    ///      their token does not actually use.
    function registerPool(PoolKey calldata key, address rewardVault, uint16 buySwapFeeBps, uint16 sellSwapFeeBps)
        external
        returns (bytes32 poolId)
    {
        _validatePoolShape(key);
        _validateTotalSwapFee(buySwapFeeBps);
        _validateTotalSwapFee(sellSwapFeeBps);

        address token = Currency.unwrap(key.currency1);
        address recordedCreator = _recordedTokenCreator(token);
        if (recordedCreator != msg.sender) revert InvalidRegistrar(msg.sender, recordedCreator);

        poolId = PoolId.unwrap(key.toId());
        if (poolFeeConfig[poolId].registered) revert AlreadyRegistered(poolId);
        bytes32 rewardConfigurationHash = _validateRewardVault(rewardVault, poolId);

        bytes32 symbolHash = TickerClaimV1.normalize(_recordedTokenSymbol(token));

        poolFeeConfig[poolId] = PoolFeeConfig({
            rewardVault: rewardVault,
            buySwapFeeBps: buySwapFeeBps,
            sellSwapFeeBps: sellSwapFeeBps,
            registered: true,
            registrar: msg.sender,
            symbolHash: symbolHash,
            creatorFeesAccrued: 0,
            lifetimeCreatorFees: 0
        });

        _settleTicker(poolId, token, symbolHash);
        _emitRegistrationDisclosures(poolId, token, rewardConfigurationHash);
    }

    /// @dev Takes the ticker if it is currently free. Otherwise emits a purely informational record of who held it
    ///      at registration time -- nothing is written to this pool's own storage, because being a derivative is
    ///      not a fact about this pool, it is a fact about who currently holds the claim, and that can change after
    ///      this call returns. `_maybeConfirm` re-derives it fresh every time a pool earns enough to matter.
    function _settleTicker(bytes32 poolId, address token, bytes32 symbolHash) private {
        TickerClaim memory claim = tickerClaim[symbolHash];

        if (TickerClaimV1.isAvailable(claim, GRACE_BLOCKS, block.number)) {
            uint64 claimBlock = uint64(block.number);
            tickerClaim[symbolHash] = TickerClaim({ poolId: poolId, claimBlock: claimBlock, confirmed: false });
            emit TickerClaimed(symbolHash, poolId, token, claimBlock);
            return;
        }

        emit DerivativeRegistered(symbolHash, poolId, claim.poolId, token);
    }

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
    }

    // --- Registry views -------------------------------------------------------------------------------------------

    /// @notice Returns the lifecycle state of a symbol's claim as of this block.
    function claimState(bytes32 symbolHash) public view returns (ClaimState) {
        return TickerClaimV1.stateOf(tickerClaim[symbolHash], GRACE_BLOCKS, block.number);
    }

    /// @notice Returns whether `poolId` holds a permanent claim on its symbol.
    /// @dev This is the question an interface asks to badge a token as the original. It is a fact about the
    ///      registry, not a curation decision.
    function isOriginal(bytes32 poolId) external view returns (bool) {
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        if (!config.registered) revert PoolNotRegistered(poolId);

        TickerClaim memory claim = tickerClaim[config.symbolHash];
        return claim.poolId == poolId && claim.confirmed;
    }

    /// @notice Returns the pool this one currently owes tribute to, and whether that tribute is presently active.
    /// @dev Both are live, not historical: if the pool this one was recorded as a derivative of at registration has
    ///      since lapsed and been superseded (or superseded by this pool itself), this reflects that, not the
    ///      registration-time snapshot.
    function derivativeOf(bytes32 poolId) external view returns (bytes32 originalPoolId, bool tributeActive) {
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        if (!config.registered) revert PoolNotRegistered(poolId);

        (tributeActive, originalPoolId) = _tributeActive(poolId, config);
    }

    /// @notice Returns the full claim record and derived state for a symbol.
    function tickerDisclosure(bytes32 symbolHash)
        external
        view
        returns (bytes32 poolId, uint64 claimBlock, bool confirmed, ClaimState state)
    {
        TickerClaim memory claim = tickerClaim[symbolHash];
        return (claim.poolId, claim.claimBlock, claim.confirmed, claimState(symbolHash));
    }

    /// @notice Returns the canonical hash a symbol registers under.
    function symbolHashOf(string calldata symbol) external pure returns (bytes32) {
        return TickerClaimV1.normalize(symbol);
    }

    // --- Fee disclosure and quotes --------------------------------------------------------------------------------

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

    // --- Claims ---------------------------------------------------------------------------------------------------

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

    function claimLauncherFees() external nonReentrant returns (uint256 amount) {
        if (msg.sender != launcherFeeRecipient) revert UnauthorizedFeeRedirect(msg.sender, launcherFeeRecipient);
        return _claimLauncherFees(launcherFeeRecipient);
    }

    function claimLauncherFeesTo(address recipient) external nonReentrant returns (uint256 amount) {
        if (msg.sender != launcherFeeRecipient) revert UnauthorizedFeeRedirect(msg.sender, launcherFeeRecipient);
        if (recipient == address(0)) revert ZeroAddress();
        return _claimLauncherFees(recipient);
    }

    function claimBuilderFees() external nonReentrant returns (uint256 amount) {
        if (msg.sender != builderFeeRecipient) revert UnauthorizedFeeRedirect(msg.sender, builderFeeRecipient);
        return _claimBuilderFees(builderFeeRecipient);
    }

    function claimBuilderFeesTo(address recipient) external nonReentrant returns (uint256 amount) {
        if (msg.sender != builderFeeRecipient) revert UnauthorizedFeeRedirect(msg.sender, builderFeeRecipient);
        if (recipient == address(0)) revert ZeroAddress();
        return _claimBuilderFees(recipient);
    }

    function _claimLauncherFees(address recipient) private returns (uint256 amount) {
        amount = launcherFeesAccrued;
        if (amount == 0) revert NoFeesToClaim();

        launcherFeesAccrued = 0;
        totalNativeFeesAccrued -= amount;
        _redeemNative(recipient, amount);
        // slither-disable-next-line reentrancy-events
        emit LauncherFeesClaimed(launcherFeeRecipient, recipient, msg.sender, amount);
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

    // --- Hook callbacks -------------------------------------------------------------------------------------------

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

    function _beforeInitialize(address sender, PoolKey calldata key, uint160) internal view override returns (bytes4) {
        _validatePoolShape(key);
        bytes32 poolId = PoolId.unwrap(key.toId());
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        if (!config.registered) revert PoolNotRegistered(poolId);
        if (sender != config.registrar) revert UnauthorizedInitializer(sender, config.registrar);
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

        if (nativeIsSpecified) {
            _assertFullFill(params, delta, appliedFeeBps);
            return (IHooks.afterSwap.selector, 0);
        }

        uint256 nativeAmount = _absolute(int256(delta.amount0()));
        uint256 totalFee = _chargeNative(poolId, sender, nativeAmount, params.amountSpecified > 0, params.zeroForOne);
        if (totalFee == 0) return (IHooks.afterSwap.selector, 0);
        return (IHooks.afterSwap.selector, totalFee.toInt256().toInt128());
    }

    function unlockCallback(bytes calldata data) external onlyPoolManager returns (bytes memory) {
        (address recipient, uint256 amount) = abi.decode(data, (address, uint256));
        NATIVE.settle(poolManager, address(this), amount, true);
        NATIVE.take(poolManager, recipient, amount, false);
        return "";
    }

    /// @dev Reverts unless the pool moved exactly the native amount the charged fee implies.
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

    // --- Accrual --------------------------------------------------------------------------------------------------

    /// @dev Returns whether `poolId` currently owes tribute, and to whom. True only when some *other* pool holds a
    ///      confirmed claim on the same symbol right now. This is computed fresh from the registry on every call
    ///      rather than read from a stored flag: the pool this one owes tribute to is whichever pool currently and
    ///      validly holds the claim, which can change if that holder's claim later lapses and a different pool
    ///      -- including this one -- takes it over. A provisional (unconfirmed) claim never receives tribute.
    function _tributeActive(bytes32 poolId, PoolFeeConfig storage config)
        private
        view
        returns (bool active, bytes32 recipientPoolId)
    {
        TickerClaim memory claim = tickerClaim[config.symbolHash];
        if (claim.confirmed && claim.poolId != poolId) {
            return (true, claim.poolId);
        }
        return (false, bytes32(0));
    }

    /// @dev Attempts to settle the ticker in this pool's favor once it has earned enough to prove real trading.
    ///
    ///      Being recorded as a derivative at registration is never a permanent demotion. What matters is the
    ///      claim's live state each time this runs:
    ///        - Already confirmed to this pool: nothing to do.
    ///        - Already confirmed to a *different* pool: that pool won the ticker outright and a confirmed claim
    ///          never lapses, so this pool cannot take it. It keeps paying tribute via `_tributeActive`.
    ///        - Provisionally held by this pool: earned it first-hand; confirm it.
    ///        - Provisionally held by a different pool whose window has lapsed, or genuinely unclaimed: this pool
    ///          takes the claim outright, regardless of whether it was registered while the ticker was live and
    ///          marked a derivative at the time. A pool that has done real volume is not permanently second-class
    ///          just because another pool happened to register first and then never traded.
    ///        - Provisionally held by a different pool whose window has *not* lapsed: that claim is still live and
    ///          might yet be earned by its own holder. This pool cannot take over yet, and tries again on its next
    ///          accrual in case the situation has changed by then.
    function _maybeConfirm(bytes32 poolId, PoolFeeConfig storage config) private {
        if (!TickerClaimV1.isEarned(config.lifetimeCreatorFees, CONFIRMATION_FEE_WEI)) return;

        TickerClaim storage claim = tickerClaim[config.symbolHash];
        if (claim.confirmed) return;

        if (claim.poolId == poolId) {
            claim.confirmed = true;
            emit TickerConfirmed(config.symbolHash, poolId, config.lifetimeCreatorFees);
            return;
        }

        if (TickerClaimV1.isAvailable(claim, GRACE_BLOCKS, block.number)) {
            claim.poolId = poolId;
            claim.claimBlock = uint64(block.number);
            claim.confirmed = true;
            emit TickerConfirmed(config.symbolHash, poolId, config.lifetimeCreatorFees);
        }
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

        uint256 retained = creatorFee;
        (bool owesTribute, bytes32 currentOriginalPoolId) = _tributeActive(poolId, config);
        if (owesTribute) {
            uint256 tribute;
            (retained, tribute) = TickerClaimV1.splitTribute(creatorFee, TRIBUTE_SHARE_BPS);
            if (tribute != 0) {
                poolFeeConfig[currentOriginalPoolId].creatorFeesAccrued += tribute;
                emit TributePaid(poolId, currentOriginalPoolId, tribute);
            }
        }

        config.creatorFeesAccrued += retained;
        config.lifetimeCreatorFees += retained;
        launcherFeesAccrued += launcherFee;
        builderFeesAccrued += builderFee;
        totalNativeFeesAccrued += totalFee;

        _maybeConfirm(poolId, config);

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

        uint256 grossNativeAmount = nativeAmount + (amountIsNet ? totalFee : 0);

        // The launcher and builder shares are recomputed here rather than taken from _feesForNet/_feesForGross
        // above, which floor independently per swap and can be driven to zero by splitting one trade into many
        // tiny ones while creatorFee still accrues. _accrueFixedShares tracks what has been earned but not yet
        // paid and carries it forward, so the two fixed shares converge exactly to their bps of cumulative volume
        // regardless of how it is split into swaps. totalFee itself is unchanged; only how it divides shifts.
        (launcherFee, builderFee) = _accrueFixedShares(grossNativeAmount, totalFee);
        creatorFee = totalFee - launcherFee - builderFee;

        _accrue(poolId, config, sender, isBuy, appliedFeeBps, grossNativeAmount, creatorFee, launcherFee, builderFee);
        NATIVE.take(poolManager, address(this), totalFee, true);
    }

    /// @dev Returns the launcher and builder fee to collect on a swap of `grossNativeAmount`, given a `totalFee`
    ///      ceiling this swap can actually supply.
    ///
    ///      Two kinds of loss are avoided, not just one. `_launcherFeeRemainderNumerator` (scaled by BASIS_POINTS)
    ///      carries forward the fractional wei each individual mulDiv floors away, so the sum of what this function
    ///      returns over any sequence of swaps converges exactly to floor(cumulative grossNativeAmount * bps /
    ///      BASIS_POINTS) -- splitting a trade into many tiny swaps no longer lets the fixed shares round to zero
    ///      every time while creatorFee keeps accruing. `_launcherFeeOwedWei` separately carries forward any whole
    ///      wei that was resolved as owed but could not be paid because that swap's totalFee was too small to cover
    ///      it (the fixed shares are a small fraction of the pool's own swap fee, so this is rare, but a low-fee
    ///      pool combined with a large previously-accumulated remainder is a real case). An owed amount is retried
    ///      on every subsequent swap until it is paid in full; it is never silently dropped the way it would be if
    ///      the remainder numerator were reset before confirming the payment actually went through.
    function _accrueFixedShares(uint256 grossNativeAmount, uint256 totalFee)
        private
        returns (uint256 launcherFee, uint256 builderFee)
    {
        uint256 launcherNumerator = grossNativeAmount * LAUNCHER_FEE_BPS + _launcherFeeRemainderNumerator;
        uint256 launcherOwed = _launcherFeeOwedWei + launcherNumerator / BASIS_POINTS;
        _launcherFeeRemainderNumerator = launcherNumerator % BASIS_POINTS;

        uint256 builderNumerator = grossNativeAmount * BUILDER_FEE_BPS + _builderFeeRemainderNumerator;
        uint256 builderOwed = _builderFeeOwedWei + builderNumerator / BASIS_POINTS;
        _builderFeeRemainderNumerator = builderNumerator % BASIS_POINTS;

        launcherFee = launcherOwed <= totalFee ? launcherOwed : totalFee;
        uint256 remainingAfterLauncher = totalFee - launcherFee;
        builderFee = builderOwed <= remainingAfterLauncher ? builderOwed : remainingAfterLauncher;

        _launcherFeeOwedWei = launcherOwed - launcherFee;
        _builderFeeOwedWei = builderOwed - builderFee;
    }

    function _redeemNative(address recipient, uint256 amount) private {
        bytes memory result = poolManager.unlock(abi.encode(recipient, amount));
        if (result.length != 0) revert UnexpectedUnlockResult();
    }

    // --- Validation -----------------------------------------------------------------------------------------------

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
        try IFirstMoverToken(token).creator() returns (address creator) {
            recordedCreator = creator;
        } catch {
            revert UnrecognizedToken(token);
        }
        if (recordedCreator == address(0)) revert UnrecognizedToken(token);
    }

    function _recordedTokenSymbol(address token) private view returns (string memory symbol) {
        try IFirstMoverToken(token).symbol() returns (string memory recorded) {
            symbol = recorded;
        } catch {
            revert UnreadableSymbol(token);
        }
    }

    // --- Fee arithmetic -------------------------------------------------------------------------------------------

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
