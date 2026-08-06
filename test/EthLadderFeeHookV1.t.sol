// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { ClassicPerformanceUnlockWalletV1 } from "../src/ClassicPerformanceUnlockWalletV1.sol";
import { EthLadderFeeHookV1 } from "../src/EthLadderFeeHookV1.sol";
import { FeeSplitVaultFactoryV1 } from "../src/FeeSplitVaultFactoryV1.sol";
import { FeeSplitVaultV1 } from "../src/FeeSplitVaultV1.sol";
import { IClassicFeeHookV3 } from "../src/interfaces/IClassicFeeHookV3.sol";

contract LadderCreatorToken is MockERC20 {
    address public immutable creator;

    constructor(address creator_) MockERC20("Ladder", "LDR", 18) {
        creator = creator_;
    }
}

/// @dev End-to-end coverage for the Ladder model against a live PoolManager: registration, fee accounting,
///      observation through real swaps, unlock transitions, custody release and forfeiture.
contract EthLadderFeeHookV1Test is Deployers {
    uint16 internal constant BUY_FEE_BPS = 200;
    uint16 internal constant SELL_FEE_BPS = 700;
    uint256 internal constant BASIS_POINTS = 10_000;
    uint32 internal constant DWELL = 7200;

    // A lower tick is a higher token price: ETH is currency0, so the tick falls as the token appreciates.
    int24 internal constant TICK_1 = -200;
    int24 internal constant TICK_2 = -600;
    int24 internal constant TICK_3 = -1200;

    FeeSplitVaultFactoryV1 internal vaultFactory;
    EthLadderFeeHookV1 internal hook;
    FeeSplitVaultV1 internal vault;
    LadderCreatorToken internal token;
    ClassicPerformanceUnlockWalletV1 internal custody;

    PoolKey internal hookKey;
    bytes32 internal poolId;
    uint64 internal anchorBlock;

    address internal treasury;
    address internal builder;
    address internal creatorPayout;
    address internal alice;
    address internal bob;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    function setUp() public {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 10_000 ether);
        vm.roll(1_000_000);

        treasury = makeAddr("programmableTreasury");
        builder = makeAddr("hookBuilder");
        creatorPayout = makeAddr("creatorPayout");
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        vaultFactory = new FeeSplitVaultFactoryV1();
        hook = _deployHook();

        token = new LadderCreatorToken(address(this));
        token.mint(address(this), 10_000_000 ether);
        token.approve(address(modifyLiquidityRouter), type(uint256).max);
        token.approve(address(swapRouter), type(uint256).max);

        hookKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: hook.LP_FEE_PIPS(),
            tickSpacing: hook.TICK_SPACING(),
            hooks: hook
        });
        poolId = PoolId.unwrap(hookKey.toId());

        vault = _deployVault(poolId, _addresses2(alice, bob), _shares2(6000, 4000), bytes32("main"));
        assertEq(hook.registerPool(hookKey, address(vault), BUY_FEE_BPS, SELL_FEE_BPS, _ladder(), DWELL), poolId);

        manager.initialize(hookKey, SQRT_PRICE_1_1);
        anchorBlock = uint64(block.number);

        // 20 units across +/-12000 ticks holds roughly 16.4 ETH and 25 tokens. Swaps below are sized well inside
        // that so the tick moves without exhausting the position.
        LIQUIDITY_PARAMS =
            ModifyLiquidityParams({ tickLower: -12_000, tickUpper: 12_000, liquidityDelta: 20 ether, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity{ value: 500 ether }(hookKey, LIQUIDITY_PARAMS, ZERO_BYTES);

        custody = new ClassicPerformanceUnlockWalletV1(
            IERC20(address(token)),
            creatorPayout,
            hook,
            poolId,
            uint64(block.timestamp),
            _shares3(3000, 3000, 4000),
            180
        );
        token.transfer(address(custody), 1_000_000 ether);
    }

    // --- Registration -----------------------------------------------------------------------------------------

    function test_disclosureRecordsTheLadderAndTheThreeWaySplit() public view {
        (
            uint16 buy,
            uint16 sell,
            uint16 buyCreator,
            uint16 sellCreator,
            uint16 launcher,
            uint16 builderBps,
            uint16 transferTax,
            uint24 lpFee,
            address rewardVault
        ) = hook.feeDisclosure(poolId);

        assertEq(buy, BUY_FEE_BPS);
        assertEq(sell, SELL_FEE_BPS);
        assertEq(buyCreator, BUY_FEE_BPS - 20, "creator takes the total less both fixed shares");
        assertEq(sellCreator, SELL_FEE_BPS - 20);
        assertEq(launcher, 10);
        assertEq(builderBps, 10);
        assertEq(transferTax, 0);
        assertEq(lpFee, 0);
        assertEq(rewardVault, address(vault));

        (int24[] memory ticks, uint32 dwell, uint64 anchor) = hook.ladderDisclosure(poolId);
        assertEq(ticks.length, 3);
        assertEq(ticks[0], TICK_1);
        assertEq(ticks[1], TICK_2);
        assertEq(ticks[2], TICK_3);
        assertEq(dwell, DWELL);
        assertEq(anchor, anchorBlock, "anchor is the initialization block");
    }

    function test_rejectsNonCreatorRegistrar() public {
        (PoolKey memory key, bytes32 id) = _freshPool("second");
        FeeSplitVaultV1 v = _deployVaultFor(id, bytes32("second"));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(EthLadderFeeHookV1.InvalidRegistrar.selector, alice, address(this)));
        hook.registerPool(key, address(v), BUY_FEE_BPS, SELL_FEE_BPS, _ladder(), DWELL);
    }

    function test_rejectsVaultBoundToAnotherPool() public {
        (PoolKey memory key,) = _freshPool("third");
        vm.expectRevert(abi.encodeWithSelector(EthLadderFeeHookV1.InvalidRewardVault.selector, address(vault)));
        hook.registerPool(key, address(vault), BUY_FEE_BPS, SELL_FEE_BPS, _ladder(), DWELL);
    }

    function test_rejectsAscendingTicks() public {
        (PoolKey memory key, bytes32 id) = _freshPool("descending");
        FeeSplitVaultV1 v = _deployVaultFor(id, bytes32("descending"));

        int24[] memory ticks = new int24[](2);
        ticks[0] = TICK_2;
        ticks[1] = TICK_1; // ascending ticks are a falling price target and must be rejected

        vm.expectRevert(abi.encodeWithSelector(EthLadderFeeHookV1.TicksMustDescend.selector, 1, TICK_2, TICK_1));
        hook.registerPool(key, address(v), BUY_FEE_BPS, SELL_FEE_BPS, ticks, DWELL);
    }

    function test_rejectsTicksOffSpacing() public {
        (PoolKey memory key, bytes32 id) = _freshPool("unaligned");
        FeeSplitVaultV1 v = _deployVaultFor(id, bytes32("unaligned"));

        int24[] memory ticks = new int24[](1);
        ticks[0] = -250;

        vm.expectRevert(abi.encodeWithSelector(EthLadderFeeHookV1.TickNotOnSpacing.selector, 0, int24(-250)));
        hook.registerPool(key, address(v), BUY_FEE_BPS, SELL_FEE_BPS, ticks, DWELL);
    }

    function test_rejectsDwellBelowFloor() public {
        (PoolKey memory key, bytes32 id) = _freshPool("shortdwell");
        FeeSplitVaultV1 v = _deployVaultFor(id, bytes32("shortdwell"));

        vm.expectRevert(abi.encodeWithSelector(EthLadderFeeHookV1.DwellOutOfRange.selector, uint32(7199)));
        hook.registerPool(key, address(v), BUY_FEE_BPS, SELL_FEE_BPS, _ladder(), 7199);
    }

    function test_rejectsSecondRegistration() public {
        vm.expectRevert(abi.encodeWithSelector(EthLadderFeeHookV1.AlreadyRegistered.selector, poolId));
        hook.registerPool(hookKey, address(vault), BUY_FEE_BPS, SELL_FEE_BPS, _ladder(), DWELL);
    }

    function test_onlyPoolManagerCanCallHookCallbacks() public {
        SwapParams memory params =
            SwapParams({ zeroForOne: true, amountSpecified: -int256(0.01 ether), sqrtPriceLimitX96: MIN_PRICE_LIMIT });

        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.beforeInitialize(address(this), hookKey, SQRT_PRICE_1_1);

        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.beforeSwap(address(this), hookKey, params, "");

        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.afterSwap(address(this), hookKey, params, BalanceDelta.wrap(0), "");

        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.unlockCallback("");
    }

    // --- Fee accounting ---------------------------------------------------------------------------------------

    function test_buyExactInputSplitsThreeWays() public {
        uint256 gross = 1 ether;
        _buy(gross);

        (uint256 creatorFee, uint256 launcherFee, uint256 builderFee) = hook.quoteGrossFees(gross, BUY_FEE_BPS);
        assertEq(launcherFee, FullMath.mulDiv(gross, 10, BASIS_POINTS), "launcher takes exactly 10 bps");
        assertEq(builderFee, FullMath.mulDiv(gross, 10, BASIS_POINTS), "builder takes exactly 10 bps");
        assertEq(
            creatorFee + launcherFee + builderFee,
            FullMath.mulDiv(gross, BUY_FEE_BPS, BASIS_POINTS),
            "fixed shares are carved from the total, not added on top"
        );
        _assertAccrued(creatorFee, launcherFee, builderFee);
    }

    function test_onlyBuilderCanClaimTheBuilderShare() public {
        _buy(1 ether);
        uint256 accrued = hook.builderFeesAccrued();
        assertGt(accrued, 0);

        vm.prank(treasury);
        vm.expectRevert(abi.encodeWithSelector(EthLadderFeeHookV1.UnauthorizedFeeRedirect.selector, treasury, builder));
        hook.claimBuilderFees();

        vm.prank(builder);
        hook.claimBuilderFees();
        assertEq(builder.balance, accrued);
        assertEq(hook.builderFeesAccrued(), 0);
    }

    // --- Observation ------------------------------------------------------------------------------------------

    function test_swapAboveEveryTrancheRecordsNoBreach() public {
        _buy(4 ether);
        assertLt(_currentTick(), TICK_3, "setup: price must clear the top rung");

        assertEq(hook.trancheBreachBlock(poolId, 0), 0);
        assertEq(hook.trancheBreachBlock(poolId, 1), 0);
        assertEq(hook.trancheBreachBlock(poolId, 2), 0);
    }

    function test_breachStampsTheSuffixOnly() public {
        _buy(4 ether);
        assertLt(_currentTick(), TICK_3);

        vm.roll(block.number + 100);
        _sellUntilPriceBelow(TICK_2);

        int24 tick = _currentTick();
        assertGt(tick, TICK_2, "price fell under the second rung");
        assertLe(tick, TICK_1, "setup: land between the first and second rung");

        assertEq(hook.trancheBreachBlock(poolId, 0), 0, "the rung the price still clears is untouched");
        assertEq(hook.trancheBreachBlock(poolId, 1), block.number);
        assertEq(hook.trancheBreachBlock(poolId, 2), block.number);
    }

    // --- Unlocking --------------------------------------------------------------------------------------------

    function test_unlockRequiresTheFullDwellThenHolds() public {
        _buy(4 ether);
        assertLt(_currentTick(), TICK_3);

        assertFalse(hook.isTrancheUnlocked(poolId, 0), "nothing unlocks on the first swap");

        vm.roll(anchorBlock + DWELL - 1);
        assertFalse(hook.isTrancheUnlocked(poolId, 0), "one block short is still locked");

        vm.roll(anchorBlock + DWELL);
        assertTrue(hook.isTrancheUnlocked(poolId, 0));
        assertTrue(hook.isTrancheUnlocked(poolId, 1));
        assertTrue(hook.isTrancheUnlocked(poolId, 2));
    }

    function test_breachResetsTheClockInFull() public {
        _buy(4 ether);
        vm.roll(anchorBlock + DWELL);
        assertTrue(hook.isTrancheUnlocked(poolId, 2));

        _sellUntilPriceBelow(TICK_3);
        uint64 breach = uint64(block.number);
        assertEq(hook.trancheBreachBlock(poolId, 2), breach);

        _buy(4 ether);
        assertLt(_currentTick(), TICK_3, "price recovers above the rung");

        vm.roll(breach + DWELL - 1);
        assertFalse(hook.isTrancheUnlocked(poolId, 2), "the clock restarted from the breach");

        vm.roll(breach + DWELL);
        assertTrue(hook.isTrancheUnlocked(poolId, 2));
    }

    function test_heldThenDumpedReleasesNothing() public {
        _buy(4 ether);
        vm.roll(anchorBlock + DWELL);
        assertTrue(hook.isTrancheUnlocked(poolId, 2));

        _sellUntilPriceBelow(TICK_1);
        assertFalse(hook.isTrancheUnlocked(poolId, 0), "current price is checked, not only history");
        assertFalse(hook.isTrancheUnlocked(poolId, 2));
    }

    // --- Custody ----------------------------------------------------------------------------------------------

    function test_releasePaysExactlyTheTrancheShare() public {
        _buy(4 ether);
        vm.roll(anchorBlock + DWELL);

        uint256 custodied = token.balanceOf(address(custody));
        assertTrue(custody.releasable(0));

        custody.release(0);
        assertEq(token.balanceOf(creatorPayout), (custodied * 3000) / BASIS_POINTS);
        assertEq(custody.releasedSharesBps(), 3000);
    }

    function test_releaseRefusesASecondClaimOfTheSameTranche() public {
        _buy(4 ether);
        vm.roll(anchorBlock + DWELL);
        custody.release(0);

        vm.expectRevert(abi.encodeWithSelector(ClassicPerformanceUnlockWalletV1.TrancheAlreadyReleased.selector, 0));
        custody.release(0);
    }

    function test_releaseRefusesAnUnearnedTranche() public {
        _buy(4 ether);
        vm.expectRevert(abi.encodeWithSelector(ClassicPerformanceUnlockWalletV1.TrancheNotUnlocked.selector, 0));
        custody.release(0);
    }

    function test_releaseIsPermissionlessButPaysOnlyTheBeneficiary() public {
        _buy(4 ether);
        vm.roll(anchorBlock + DWELL);

        uint256 custodied = token.balanceOf(address(custody));
        vm.prank(alice);
        custody.release(0);

        assertEq(token.balanceOf(creatorPayout), (custodied * 3000) / BASIS_POINTS);
        assertEq(token.balanceOf(alice), 0, "the caller gains nothing");
    }

    function test_finalTrancheSweepsTheRemainder() public {
        _buy(4 ether);
        vm.roll(anchorBlock + DWELL);

        custody.release(0);
        custody.release(1);
        custody.release(2);

        assertEq(token.balanceOf(address(custody)), 0, "no dust is stranded");
        assertEq(custody.releasedSharesBps(), 10_000);
    }

    function test_beneficiaryIsImmutable() public {
        vm.expectRevert(ClassicPerformanceUnlockWalletV1.ImmutableBeneficiary.selector);
        custody.transferOwnership(alice);

        vm.expectRevert(ClassicPerformanceUnlockWalletV1.ImmutableBeneficiary.selector);
        custody.renounceOwnership();
    }

    // --- Forfeiture -------------------------------------------------------------------------------------------

    function test_forfeitRevertsBeforeExpiry() public {
        vm.expectRevert();
        custody.forfeit();
    }

    function test_forfeitBurnsTheRemainderAndIsPermissionless() public {
        uint256 custodied = token.balanceOf(address(custody));
        vm.warp(block.timestamp + 181 days);

        vm.prank(bob);
        custody.forfeit();

        assertEq(token.balanceOf(address(custody)), 0);
        assertEq(token.balanceOf(custody.FORFEIT_RECIPIENT()), custodied, "the remainder can only be burned");
        assertTrue(custody.forfeited());
    }

    function test_releaseIsBlockedOnceExpired() public {
        _buy(4 ether);
        vm.roll(anchorBlock + DWELL);
        vm.warp(block.timestamp + 181 days);

        assertFalse(custody.releasable(0));
        vm.expectRevert();
        custody.release(0);
    }

    // --- Helpers ----------------------------------------------------------------------------------------------

    function _ladder() private pure returns (int24[] memory ticks) {
        ticks = new int24[](3);
        ticks[0] = TICK_1;
        ticks[1] = TICK_2;
        ticks[2] = TICK_3;
    }

    function _deployHook() private returns (EthLadderFeeHookV1 deployed) {
        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
                | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        bytes memory args = abi.encode(manager, treasury, builder, vaultFactory);
        (address expected, bytes32 salt) =
            HookMiner.find(address(this), flags, type(EthLadderFeeHookV1).creationCode, args);

        deployed = new EthLadderFeeHookV1{ salt: salt }(manager, treasury, builder, vaultFactory);
        assertEq(address(deployed), expected, "mined hook address mismatch");
    }

    function _deployVault(bytes32 id, address[] memory beneficiaries, uint16[] memory shares, bytes32 salt)
        private
        returns (FeeSplitVaultV1)
    {
        return vaultFactory.deploy(salt, IClassicFeeHookV3(address(hook)), id, beneficiaries, shares);
    }

    function _deployVaultFor(bytes32 id, bytes32 salt) private returns (FeeSplitVaultV1) {
        return _deployVault(id, _addresses2(alice, bob), _shares2(6000, 4000), salt);
    }

    function _freshPool(bytes32 label) private returns (PoolKey memory key, bytes32 id) {
        LadderCreatorToken other = new LadderCreatorToken(address(this));
        other.mint(address(this), 1000 ether);
        label; // silence unused
        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(other)),
            fee: hook.LP_FEE_PIPS(),
            tickSpacing: hook.TICK_SPACING(),
            hooks: hook
        });
        id = PoolId.unwrap(key.toId());
    }

    function _buy(uint256 ethIn) private returns (BalanceDelta) {
        return _swap(true, -int256(ethIn), ethIn);
    }

    /// @dev Sells until the token's price falls back under `target`, which means the tick rises above it.
    ///
    ///      Increments are small relative to the range's depth so that no single swap can exhaust the position and
    ///      trip the partial-fill invariant, which is asserted separately.
    function _sellUntilPriceBelow(int24 target) private {
        for (uint256 i = 0; i < 120; ++i) {
            if (_currentTick() > target) return;
            _swap(false, -int256(0.5 ether), 0);
        }
        revert("could not push the price below the target");
    }

    function _swap(bool zeroForOne, int256 amountSpecified, uint256 value) private returns (BalanceDelta) {
        return swapRouter.swap{ value: value }(
            hookKey,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
            }),
            settings,
            ""
        );
    }

    function _currentTick() private view returns (int24 tick) {
        (, tick,,) = StateLibrary.getSlot0(manager, PoolId.wrap(poolId));
    }

    function _creatorAccrued() private view returns (uint256 accrued) {
        (,,,,,,,, accrued) = hook.poolFeeConfig(poolId);
    }

    function _assertAccrued(uint256 creatorFee, uint256 launcherFee, uint256 builderFee) private view {
        assertEq(_creatorAccrued(), creatorFee, "creator accrual");
        assertEq(hook.launcherFeesAccrued(), launcherFee, "launcher accrual");
        assertEq(hook.builderFeesAccrued(), builderFee, "builder accrual");
        assertEq(hook.totalNativeFeesAccrued(), creatorFee + launcherFee + builderFee);
        assertEq(
            manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()),
            creatorFee + launcherFee + builderFee,
            "claim tokens match the accounting"
        );
    }

    function _addresses2(address a, address b) private pure returns (address[] memory values) {
        values = new address[](2);
        values[0] = a;
        values[1] = b;
    }

    function _shares2(uint16 a, uint16 b) private pure returns (uint16[] memory values) {
        values = new uint16[](2);
        values[0] = a;
        values[1] = b;
    }

    function _shares3(uint16 a, uint16 b, uint16 c) private pure returns (uint16[] memory values) {
        values = new uint16[](3);
        values[0] = a;
        values[1] = b;
        values[2] = c;
    }
}
