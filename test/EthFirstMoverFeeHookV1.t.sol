// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { EthFirstMoverFeeHookV1 } from "../src/EthFirstMoverFeeHookV1.sol";
import { FeeSplitVaultFactoryV1 } from "../src/FeeSplitVaultFactoryV1.sol";
import { FeeSplitVaultV1 } from "../src/FeeSplitVaultV1.sol";
import { ClaimState, TickerClaimV1 } from "../src/libraries/TickerClaimV1.sol";
import { IClassicFeeHookV3 } from "../src/interfaces/IClassicFeeHookV3.sol";

contract FirstMoverToken is MockERC20 {
    address public immutable creator;

    constructor(address creator_, string memory name_, string memory symbol_) MockERC20(name_, symbol_, 18) {
        creator = creator_;
    }
}

/// @dev Registry behaviour end to end: claiming, confirming, lapsing, derivative detection and tribute routing.
contract EthFirstMoverFeeHookV1Test is Deployers {
    uint16 internal constant FEE_BPS = 1000;
    uint256 internal constant BASIS_POINTS = 10_000;

    FeeSplitVaultFactoryV1 internal vaultFactory;
    EthFirstMoverFeeHookV1 internal hook;

    address internal builder;
    address internal alice;
    address internal bob;

    uint256 internal saltCounter;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    struct Launch {
        FirstMoverToken token;
        PoolKey key;
        bytes32 poolId;
        FeeSplitVaultV1 vault;
    }

    function setUp() public {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 100_000 ether);
        vm.roll(1_000_000);

        builder = makeAddr("hookBuilder");
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        vaultFactory = new FeeSplitVaultFactoryV1();
        hook = _deployHook();
    }

    // --- Normalization --------------------------------------------------------------------------------------------

    /// @dev The launcher share can only ever go to Programmable's real treasury, not to a value a deployer
    ///      supplies. Hardcoded as a constant rather than merely checked at construction, so an incorrect address
    ///      is not a possible deployment, not just one that was validated against at the time.
    function test_launcherFeeRecipientIsTheEnforcedProgrammableTreasury() public view {
        assertEq(hook.PROGRAMMABLE_TREASURY(), 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c);
        assertEq(hook.launcherFeeRecipient(), hook.PROGRAMMABLE_TREASURY());
    }

    function test_symbolNormalizationFoldsCase() public view {
        bytes32 upper = hook.symbolHashOf("PEPE");
        assertEq(hook.symbolHashOf("pepe"), upper);
        assertEq(hook.symbolHashOf("Pepe"), upper);
        assertEq(hook.symbolHashOf("pEpE"), upper);
        assertTrue(hook.symbolHashOf("PEPE2") != upper, "a different symbol is a different ticker");
    }

    // --- Claiming -------------------------------------------------------------------------------------------------

    function test_firstRegistrationTakesAProvisionalClaim() public {
        Launch memory first = _launch("PEPE");
        bytes32 symbolHash = hook.symbolHashOf("PEPE");

        (bytes32 poolId,, bool confirmed, ClaimState state) = hook.tickerDisclosure(symbolHash);
        assertEq(poolId, first.poolId);
        assertFalse(confirmed, "registration alone does not earn the ticker");
        assertTrue(state == ClaimState.Provisional);
        assertFalse(hook.isOriginal(first.poolId), "not original until confirmed");
    }

    function test_claimIsEarnedByTradingNotByRegistering() public {
        Launch memory first = _launch("PEPE");
        bytes32 symbolHash = hook.symbolHashOf("PEPE");

        _buy(first, 2 ether);

        (,, bool confirmed, ClaimState state) = hook.tickerDisclosure(symbolHash);
        assertTrue(confirmed, "enough volume earns the claim");
        assertTrue(state == ClaimState.Confirmed);
        assertTrue(hook.isOriginal(first.poolId));
    }

    function test_confirmedClaimNeverLapses() public {
        Launch memory first = _launch("PEPE");
        _buy(first, 2 ether);

        vm.roll(block.number + hook.GRACE_BLOCKS() * 10);
        assertTrue(hook.claimState(hook.symbolHashOf("PEPE")) == ClaimState.Confirmed);
        assertTrue(hook.isOriginal(first.poolId));
    }

    function test_unearnedClaimLapsesAndFreesTheTicker() public {
        Launch memory squatter = _launch("PEPE");
        bytes32 symbolHash = hook.symbolHashOf("PEPE");

        vm.roll(block.number + hook.GRACE_BLOCKS());
        assertTrue(hook.claimState(symbolHash) == ClaimState.Lapsed, "a ticker nobody traded frees up");

        Launch memory second = _launch("PEPE");
        (bytes32 poolId,,,) = hook.tickerDisclosure(symbolHash);
        assertEq(poolId, second.poolId, "the lapsed ticker is takeable");
        assertFalse(hook.isOriginal(squatter.poolId));
    }

    // --- Derivatives ----------------------------------------------------------------------------------------------

    function test_copyIsRecordedAsDerivativeNotRejected() public {
        Launch memory original = _launch("PEPE");
        _buy(original, 2 ether);

        Launch memory copycat = _launch("pepe");

        (bytes32 originalPoolId, bool tributeActive) = hook.derivativeOf(copycat.poolId);
        assertEq(originalPoolId, original.poolId, "case-folded symbols are the same ticker");
        assertTrue(tributeActive);
        assertFalse(hook.isOriginal(copycat.poolId));
        assertTrue(hook.isOriginal(original.poolId));
    }

    function test_differentSymbolsDoNotCollide() public {
        Launch memory pepe = _launch("PEPE");
        _buy(pepe, 2 ether);

        Launch memory wojak = _launch("WOJAK");
        (, bool tributeActive) = hook.derivativeOf(wojak.poolId);
        assertFalse(tributeActive, "an unrelated ticker owes nothing");
        assertTrue(hook.isOriginal(wojak.poolId) == false, "still provisional until traded");

        _buy(wojak, 2 ether);
        assertTrue(hook.isOriginal(wojak.poolId));
    }

    // --- Tribute --------------------------------------------------------------------------------------------------

    function test_tributeRoutesToTheOriginalsVault() public {
        Launch memory original = _launch("PEPE");
        _buy(original, 2 ether);
        uint256 originalBefore = _creatorAccrued(original.poolId);

        Launch memory copycat = _launch("PEPE");
        uint256 gross = 1 ether;
        _buy(copycat, gross);

        (uint256 creatorFee,,) = hook.quoteGrossFees(gross, FEE_BPS);
        (uint256 retained, uint256 tribute) = TickerClaimV1.splitTribute(creatorFee, hook.TRIBUTE_SHARE_BPS());

        assertGt(tribute, 0, "a copy pays the original");
        assertEq(_creatorAccrued(copycat.poolId), retained, "the copy keeps the remainder");
        assertEq(_creatorAccrued(original.poolId) - originalBefore, tribute, "the original receives it without acting");
    }

    /// @dev The trader is charged exactly the same on a derivative as on any other pool. Tribute moves value between
    ///      creators; it never reaches the swapper, the launcher share or the builder share.
    function test_tributeIsInvisibleToTheTrader() public {
        Launch memory original = _launch("PEPE");
        _buy(original, 2 ether);

        Launch memory copycat = _launch("PEPE");
        uint256 launcherBefore = hook.launcherFeesAccrued();
        uint256 builderBefore = hook.builderFeesAccrued();
        uint256 totalBefore = hook.totalNativeFeesAccrued();

        uint256 gross = 1 ether;
        _buy(copycat, gross);

        (uint256 creatorFee, uint256 launcherFee, uint256 builderFee) = hook.quoteGrossFees(gross, FEE_BPS);
        assertEq(hook.launcherFeesAccrued() - launcherBefore, launcherFee, "launcher share untouched");
        assertEq(hook.builderFeesAccrued() - builderBefore, builderFee, "builder share untouched");
        assertEq(
            hook.totalNativeFeesAccrued() - totalBefore,
            creatorFee + launcherFee + builderFee,
            "the total taken from the swap is unchanged"
        );
    }

    function test_noTributeWhileTheOriginalIsOnlyProvisional() public {
        Launch memory provisional = _launch("PEPE");
        Launch memory copycat = _launch("PEPE");

        (, bool tributeActive) = hook.derivativeOf(copycat.poolId);
        assertFalse(tributeActive, "an unearned claim collects nothing");

        uint256 gross = 1 ether;
        uint256 originalBefore = _creatorAccrued(provisional.poolId);
        _buy(copycat, gross);

        (uint256 creatorFee,,) = hook.quoteGrossFees(gross, FEE_BPS);
        assertEq(_creatorAccrued(copycat.poolId), creatorFee, "the copy keeps its whole share");
        assertEq(_creatorAccrued(provisional.poolId), originalBefore);
    }

    function test_tributeStopsIfTheOriginalsClaimLapses() public {
        Launch memory provisional = _launch("PEPE");
        Launch memory copycat = _launch("PEPE");
        provisional;

        vm.roll(block.number + hook.GRACE_BLOCKS());

        (, bool tributeActive) = hook.derivativeOf(copycat.poolId);
        assertFalse(tributeActive, "a lapsed original releases its derivatives");

        uint256 gross = 1 ether;
        _buy(copycat, gross);
        (uint256 creatorFee,,) = hook.quoteGrossFees(gross, FEE_BPS);
        assertEq(_creatorAccrued(copycat.poolId), creatorFee);
    }

    /// @dev A derivative can never confirm the ticker it copies, however much it trades.
    /// @dev A CONFIRMED original's claim is permanent. No amount of volume on a derivative unseats it, because a
    ///      confirmed claim never lapses.
    function test_derivativeCannotTakeAnAlreadyConfirmedTicker() public {
        Launch memory original = _launch("PEPE");
        _buy(original, 2 ether);
        assertTrue(hook.isOriginal(original.poolId), "setup: the original is confirmed before the copy registers");

        Launch memory copycat = _launch("PEPE");
        _buy(copycat, 4 ether);

        (bytes32 poolId,,,) = hook.tickerDisclosure(hook.symbolHashOf("PEPE"));
        assertEq(poolId, original.poolId, "the confirmed original keeps the ticker");
        assertFalse(hook.isOriginal(copycat.poolId));
    }

    /// @dev The bug this guards against: a pool recorded as a derivative at registration is not permanently
    ///      second-class. If the pool that registered first never earns its claim and the window lapses, a pool
    ///      that registered later -- and was marked a derivative of it at the time -- can still take the ticker
    ///      outright once it earns the threshold itself. Being first to register is not the same as being first to
    ///      matter, for the whole life of the ticker, not just at the moment of registration.
    function test_derivativeCanTakeOverAfterTheOriginalsClaimLapses() public {
        Launch memory neverTrades = _launch("PEPE");
        Launch memory laterEarnsIt = _launch("PEPE");

        (, bool tributeActiveBeforeLapse) = hook.derivativeOf(laterEarnsIt.poolId);
        assertFalse(tributeActiveBeforeLapse, "the original is only provisional, so no tribute flows yet");

        vm.roll(block.number + hook.GRACE_BLOCKS());
        assertTrue(hook.claimState(hook.symbolHashOf("PEPE")) == ClaimState.Lapsed);

        _buy(laterEarnsIt, 2 ether);

        assertTrue(
            hook.isOriginal(laterEarnsIt.poolId),
            "earning the claim after a lapse succeeds despite having been a derivative"
        );
        assertFalse(hook.isOriginal(neverTrades.poolId));

        (bytes32 poolId,,,) = hook.tickerDisclosure(hook.symbolHashOf("PEPE"));
        assertEq(poolId, laterEarnsIt.poolId, "the ticker now belongs to the pool that actually traded it");
    }

    /// @dev While the original's claim is still live (provisional, not yet lapsed), a derivative cannot take over
    ///      even if it has already earned more than the confirmation threshold itself -- the original's window has
    ///      not yet closed.
    function test_derivativeCannotTakeOverWhileTheOriginalsClaimIsStillLive() public {
        Launch memory stillWithinWindow = _launch("PEPE");
        Launch memory copycat = _launch("PEPE");

        _buy(copycat, 4 ether);

        assertFalse(hook.isOriginal(copycat.poolId), "the original's provisional window has not lapsed yet");
        (bytes32 poolId,,,) = hook.tickerDisclosure(hook.symbolHashOf("PEPE"));
        assertEq(poolId, stillWithinWindow.poolId);
    }

    // --- Fee-rounding regressions -------------------------------------------------------------------------------

    /// @dev The exploit this guards against: previously, if a single swap's gross amount was small enough that the
    ///      fixed 10 bps launcher/builder share floored to zero -- while creatorFee at the pool's higher total rate
    ///      still accrued -- repeating that swap indefinitely never paid the launcher or builder anything, because
    ///      each swap independently floored to zero and forgot. Cumulative accounting closes this: summed over many
    ///      swaps, the two fixed shares converge to their exact bps of cumulative volume.
    function test_launcherAndBuilderFeesConvergeAcrossManyTinySwaps() public {
        Launch memory dust = _launch("DUST");

        uint256 tinyBuy = 60; // wei
        (uint256 tinyCreatorFee, uint256 tinyLauncherFee, uint256 tinyBuilderFee) =
            hook.quoteGrossFees(tinyBuy, FEE_BPS);
        assertGt(tinyCreatorFee, 0, "setup: creator fee is still nonzero at this size");
        assertEq(tinyLauncherFee, 0, "setup: the naive per-swap launcher share floors to zero");
        assertEq(tinyBuilderFee, 0, "setup: the naive per-swap builder share floors to zero");

        uint256 repeats = 400;
        for (uint256 i = 0; i < repeats; ++i) {
            _buy(dust, tinyBuy);
        }

        uint256 expectedLauncher = (repeats * tinyBuy * hook.LAUNCHER_FEE_BPS()) / BASIS_POINTS;
        uint256 expectedBuilder = (repeats * tinyBuy * hook.BUILDER_FEE_BPS()) / BASIS_POINTS;
        assertGt(expectedLauncher, 0, "setup: repeated enough times the exact total is nonzero");

        assertApproxEqAbs(
            hook.launcherFeesAccrued(), expectedLauncher, 1, "launcher fees converge to the exact cumulative total"
        );
        assertApproxEqAbs(
            hook.builderFeesAccrued(), expectedBuilder, 1, "builder fees converge to the exact cumulative total"
        );
    }

    /// @dev The same convergence holds selling into the pool, not just buying.
    function test_launcherAndBuilderFeesConvergeOnTheSellSideToo() public {
        Launch memory dust = _launch("DUST2");
        _buy(dust, 10 ether);
        uint256 held = dust.token.balanceOf(address(this));

        uint256 tinySell = 60; // wei of the token
        uint256 repeats = 300;
        assertLe(repeats * tinySell, held, "setup: enough tokens on hand for every sell");

        uint256 launcherBefore = hook.launcherFeesAccrued();
        uint256 builderBefore = hook.builderFeesAccrued();

        for (uint256 i = 0; i < repeats; ++i) {
            _sellExactInput(dust, tinySell);
        }

        assertGt(
            hook.launcherFeesAccrued() - launcherBefore, 0, "the sell side converges instead of losing the fixed share"
        );
        assertGt(hook.builderFeesAccrued() - builderBefore, 0);
    }

    /// @dev And on exact-output swaps, which take a different path to the same charging function.
    function test_launcherAndBuilderFeesConvergeOnExactOutputToo() public {
        Launch memory dust = _launch("DUST3");

        uint256 tinyTokenOut = 60; // wei of the token
        uint256 repeats = 300;
        uint256 launcherBefore = hook.launcherFeesAccrued();

        for (uint256 i = 0; i < repeats; ++i) {
            _buyExactOutput(dust, tinyTokenOut, 1 ether);
        }

        assertGt(hook.launcherFeesAccrued() - launcherBefore, 0, "exact-output swaps converge the same way");
    }

    /// @dev Direct split-vs-aggregate comparison: the fixed shares collected from many small swaps whose amounts
    ///      sum to a total converge to the same amount as one swap of that total size, to within the single wei of
    ///      dust that has not yet resolved into a whole unit at the moment either window is measured.
    function test_splitSwapsConvergeToSameFixedSharesAsOneLargeSwap() public {
        Launch memory splitPool = _launch("SPLIT");
        Launch memory singlePool = _launch("SINGLE");

        uint256 chunk = 70; // wei
        uint256 chunks = 250;
        uint256 total = chunk * chunks;

        uint256 before = hook.launcherFeesAccrued();
        for (uint256 i = 0; i < chunks; ++i) {
            _buy(splitPool, chunk);
        }
        uint256 launcherFromSplit = hook.launcherFeesAccrued() - before;

        before = hook.launcherFeesAccrued();
        _buy(singlePool, total);
        uint256 launcherFromSingle = hook.launcherFeesAccrued() - before;

        assertApproxEqAbs(
            launcherFromSplit, launcherFromSingle, 1, "splitting into many swaps does not reduce the fixed share paid"
        );
    }

    // --- Guards ---------------------------------------------------------------------------------------------------

    function test_rejectsNonCreatorRegistrar() public {
        FirstMoverToken token = new FirstMoverToken(address(this), "Ghost", "GHOST");
        (PoolKey memory key, bytes32 id) = _keyFor(token);
        FeeSplitVaultV1 v = _deployVault(id, _nextSalt());

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(EthFirstMoverFeeHookV1.InvalidRegistrar.selector, alice, address(this)));
        hook.registerPool(key, address(v), FEE_BPS, FEE_BPS);
    }

    function test_onlyPoolManagerCanCallHookCallbacks() public {
        Launch memory first = _launch("PEPE");
        SwapParams memory params =
            SwapParams({ zeroForOne: true, amountSpecified: -int256(0.01 ether), sqrtPriceLimitX96: MIN_PRICE_LIMIT });

        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.beforeInitialize(address(this), first.key, SQRT_PRICE_1_1);

        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.beforeSwap(address(this), first.key, params, "");

        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.afterSwap(address(this), first.key, params, BalanceDelta.wrap(0), "");

        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.unlockCallback("");
    }

    function test_onlyBuilderCanClaimTheBuilderShare() public {
        Launch memory first = _launch("PEPE");
        _buy(first, 1 ether);

        uint256 accrued = hook.builderFeesAccrued();
        assertGt(accrued, 0);

        address notTheBuilder = makeAddr("notTheBuilder");
        vm.prank(notTheBuilder);
        vm.expectRevert(
            abi.encodeWithSelector(EthFirstMoverFeeHookV1.UnauthorizedFeeRedirect.selector, notTheBuilder, builder)
        );
        hook.claimBuilderFees();

        vm.prank(builder);
        hook.claimBuilderFees();
        assertEq(builder.balance, accrued);
    }

    // --- Helpers --------------------------------------------------------------------------------------------------

    function _deployHook() private returns (EthFirstMoverFeeHookV1 deployed) {
        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
                | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        bytes memory args = abi.encode(manager, builder, vaultFactory);
        (address expected, bytes32 salt) =
            HookMiner.find(address(this), flags, type(EthFirstMoverFeeHookV1).creationCode, args);

        deployed = new EthFirstMoverFeeHookV1{ salt: salt }(manager, builder, vaultFactory);
        assertEq(address(deployed), expected, "mined hook address mismatch");
    }

    function _nextSalt() private returns (bytes32) {
        return bytes32(++saltCounter);
    }

    function _keyFor(FirstMoverToken token) private view returns (PoolKey memory key, bytes32 id) {
        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: hook.LP_FEE_PIPS(),
            tickSpacing: hook.TICK_SPACING(),
            hooks: hook
        });
        id = PoolId.unwrap(key.toId());
    }

    function _deployVault(bytes32 id, bytes32 salt) private returns (FeeSplitVaultV1) {
        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = alice;
        uint16[] memory shares = new uint16[](1);
        shares[0] = 10_000;
        return vaultFactory.deploy(salt, IClassicFeeHookV3(address(hook)), id, beneficiaries, shares);
    }

    /// @dev Deploys a token with `symbol`, registers, initializes and funds its pool.
    function _launch(string memory symbol) private returns (Launch memory launch) {
        FirstMoverToken token = new FirstMoverToken(address(this), symbol, symbol);
        token.mint(address(this), 10_000_000 ether);
        token.approve(address(modifyLiquidityRouter), type(uint256).max);
        token.approve(address(swapRouter), type(uint256).max);

        (PoolKey memory key, bytes32 id) = _keyFor(token);
        FeeSplitVaultV1 vault = _deployVault(id, _nextSalt());
        hook.registerPool(key, address(vault), FEE_BPS, FEE_BPS);
        manager.initialize(key, SQRT_PRICE_1_1);

        modifyLiquidityRouter.modifyLiquidity{ value: 500 ether }(
            key,
            ModifyLiquidityParams({ tickLower: -12_000, tickUpper: 12_000, liquidityDelta: 20 ether, salt: 0 }),
            ZERO_BYTES
        );

        launch = Launch({ token: token, key: key, poolId: id, vault: vault });
    }

    function _buy(Launch memory launch, uint256 ethIn) private returns (BalanceDelta) {
        return swapRouter.swap{ value: ethIn }(
            launch.key,
            SwapParams({ zeroForOne: true, amountSpecified: -int256(ethIn), sqrtPriceLimitX96: MIN_PRICE_LIMIT }),
            settings,
            ""
        );
    }

    /// @dev Exact-input sell: spends `tokenIn` of the launch token for native ETH.
    function _sellExactInput(Launch memory launch, uint256 tokenIn) private returns (BalanceDelta) {
        return swapRouter.swap(
            launch.key,
            SwapParams({ zeroForOne: false, amountSpecified: -int256(tokenIn), sqrtPriceLimitX96: MAX_PRICE_LIMIT }),
            settings,
            ""
        );
    }

    /// @dev Exact-output buy: spends whatever native ETH is required to receive exactly `tokenOut`.
    function _buyExactOutput(Launch memory launch, uint256 tokenOut, uint256 ethBudget) private returns (BalanceDelta) {
        return swapRouter.swap{ value: ethBudget }(
            launch.key,
            SwapParams({ zeroForOne: true, amountSpecified: int256(tokenOut), sqrtPriceLimitX96: MIN_PRICE_LIMIT }),
            settings,
            ""
        );
    }

    function _creatorAccrued(bytes32 poolId) private view returns (uint256 accrued) {
        (,,,,,, accrued,) = hook.poolFeeConfig(poolId);
    }
}
