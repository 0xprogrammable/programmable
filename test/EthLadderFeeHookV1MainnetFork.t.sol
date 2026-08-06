// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolModifyLiquidityTest } from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";
import { Test } from "forge-std/Test.sol";

import { ClassicPerformanceUnlockWalletFactoryV1 } from "../src/ClassicPerformanceUnlockWalletFactoryV1.sol";
import { ClassicPerformanceUnlockWalletV1 } from "../src/ClassicPerformanceUnlockWalletV1.sol";
import { EthLadderFeeHookFactoryV1 } from "../src/EthLadderFeeHookFactoryV1.sol";
import { EthLadderFeeHookV1 } from "../src/EthLadderFeeHookV1.sol";
import { FeeSplitVaultFactoryV1 } from "../src/FeeSplitVaultFactoryV1.sol";
import { FeeSplitVaultV1 } from "../src/FeeSplitVaultV1.sol";
import { IClassicFeeHookV3 } from "../src/interfaces/IClassicFeeHookV3.sol";

contract LadderForkToken is MockERC20 {
    address public immutable creator;

    constructor(address creator_) MockERC20("Ladder Fork", "LDRF", 18) {
        creator = creator_;
    }
}

/// @notice Runs Ladder's full lifecycle against the real, currently-deployed Ethereum mainnet `PoolManager`.
/// @dev Classic's mainnet-fork test exercises `MemeLaunchV2`, which integrates the real Universal Router, Permit2,
///      PositionManager and UERC20 factory because that launcher owns locked-liquidity positioning end to end.
///      Ladder is not wired into that launcher -- it is a standalone custody mode, submitted as source and
///      specification, with no atomic launch path of its own to fork-test. What this file verifies instead is the
///      claim this model actually makes: that `EthLadderFeeHookV1` and `ClassicPerformanceUnlockWalletV1` behave
///      correctly against the real `PoolManager` bytecode on mainnet, not merely against the fresh copy
///      `Deployers` deploys in the rest of this suite. Liquidity provisioning and swaps use the same `PoolSwapTest`
///      and `PoolModifyLiquidityTest` routers the rest of the suite uses, deployed fresh and pointed at the real,
///      pinned `PoolManager` address, since those are testing utilities with no canonical mainnet deployment to pin.
contract EthLadderFeeHookV1MainnetForkTest is Test {
    // PoolManager refunds any ETH sent in excess of what a modifyLiquidity or swap call actually needs. Unlike the
    // Deployers-based integration suite, this contract inherits only forge-std's Test, which has no receive
    // function, so that refund would otherwise revert.
    receive() external payable { }

    uint256 internal constant SNAPSHOT_BLOCK = 25_639_000;
    address internal constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    bytes32 internal constant POOL_MANAGER_CODE_HASH =
        0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;

    uint16 internal constant BUY_FEE_BPS = 200;
    uint16 internal constant SELL_FEE_BPS = 700;
    uint32 internal constant DWELL = 7200;
    int24 internal constant TICK_1 = -200;
    int24 internal constant TICK_2 = -600;
    int24 internal constant TICK_3 = -1200;

    IPoolManager internal poolManager;
    PoolSwapTest internal swapRouter;
    PoolModifyLiquidityTest internal modifyLiquidityRouter;

    FeeSplitVaultFactoryV1 internal vaultFactory;
    EthLadderFeeHookFactoryV1 internal hookFactory;
    ClassicPerformanceUnlockWalletFactoryV1 internal walletFactory;
    EthLadderFeeHookV1 internal hook;

    LadderForkToken internal token;
    PoolKey internal hookKey;
    bytes32 internal poolId;
    uint64 internal anchorBlock;

    address internal treasury;
    address internal builder;
    address internal creatorPayout;
    address internal alice;
    address internal bob;
    address internal trader;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://eth.drpc.org"));
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);

        assertEq(POOL_MANAGER.codehash, POOL_MANAGER_CODE_HASH, "pinned PoolManager bytecode has changed");
        poolManager = IPoolManager(POOL_MANAGER);
        swapRouter = new PoolSwapTest(poolManager);
        modifyLiquidityRouter = new PoolModifyLiquidityTest(poolManager);

        treasury = makeAddr("forkTreasury");
        builder = makeAddr("forkBuilder");
        creatorPayout = makeAddr("forkCreatorPayout");
        alice = makeAddr("forkAlice");
        bob = makeAddr("forkBob");
        trader = makeAddr("forkTrader");
        vm.deal(address(this), 1000 ether);
        vm.deal(trader, 200 ether);

        vaultFactory = new FeeSplitVaultFactoryV1();
        walletFactory = new ClassicPerformanceUnlockWalletFactoryV1();
        hookFactory = new EthLadderFeeHookFactoryV1();

        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
                | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        (, bytes32 hookSalt) = HookMiner.find(
            address(hookFactory),
            flags,
            type(EthLadderFeeHookV1).creationCode,
            abi.encode(poolManager, treasury, builder, vaultFactory)
        );
        hook = hookFactory.deploy(hookSalt, poolManager, treasury, builder, vaultFactory);

        token = new LadderForkToken(address(this));
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

        address[] memory beneficiaries = new address[](2);
        beneficiaries[0] = alice;
        beneficiaries[1] = bob;
        uint16[] memory rewardShares = new uint16[](2);
        rewardShares[0] = 6000;
        rewardShares[1] = 4000;
        FeeSplitVaultV1 vault = vaultFactory.deploy(
            bytes32("fork-vault"), IClassicFeeHookV3(address(hook)), poolId, beneficiaries, rewardShares
        );

        int24[] memory ticks = new int24[](3);
        ticks[0] = TICK_1;
        ticks[1] = TICK_2;
        ticks[2] = TICK_3;
        assertEq(hook.registerPool(hookKey, address(vault), BUY_FEE_BPS, SELL_FEE_BPS, ticks, DWELL), poolId);

        poolManager.initialize(hookKey, 79_228_162_514_264_337_593_543_950_336);
        anchorBlock = uint64(block.number);

        modifyLiquidityRouter.modifyLiquidity{ value: 500 ether }(
            hookKey,
            ModifyLiquidityParams({ tickLower: -12_000, tickUpper: 12_000, liquidityDelta: 20 ether, salt: 0 }),
            ""
        );
    }

    /// @dev Registration, breach observation, unlock timing, custody release and forfeiture, all against the real
    ///      mainnet PoolManager. Mirrors the properties already proven in the Deployers-based integration suite;
    ///      the point of running it again here is the PoolManager underneath, not new behavior.
    function test_fullLifecycleAgainstTheRealPoolManager() public {
        (int24[] memory unlockTicks, uint32 dwellBlocks, uint64 anchor) = hook.ladderDisclosure(poolId);
        assertEq(unlockTicks.length, 3);
        assertEq(dwellBlocks, DWELL);
        assertEq(anchor, anchorBlock);

        uint16[] memory walletShares = new uint16[](3);
        walletShares[0] = 3000;
        walletShares[1] = 3000;
        walletShares[2] = 4000;
        ClassicPerformanceUnlockWalletV1 custody = walletFactory.deployOrGet(
            bytes32("fork-wallet"),
            IERC20(address(token)),
            creatorPayout,
            hook,
            poolId,
            uint64(block.timestamp),
            walletShares,
            180
        );
        token.transfer(address(custody), 1_000_000 ether);

        _buy(4 ether);

        // The sell leg below needs the trader to spend LDRF back into the pool.
        vm.prank(trader);
        token.approve(address(swapRouter), type(uint256).max);
        assertLt(_currentTick(), TICK_3, "setup: price clears the top rung");
        assertEq(hook.trancheBreachBlock(poolId, 0), 0);

        assertFalse(hook.isTrancheUnlocked(poolId, 0));
        vm.roll(anchorBlock + DWELL);
        assertTrue(hook.isTrancheUnlocked(poolId, 0));
        assertTrue(hook.isTrancheUnlocked(poolId, 2));

        uint256 custodied = token.balanceOf(address(custody));
        assertTrue(custody.releasable(0));
        custody.release(0);
        assertEq(token.balanceOf(creatorPayout), (custodied * 3000) / 10_000);

        vm.expectRevert(abi.encodeWithSelector(ClassicPerformanceUnlockWalletV1.TrancheAlreadyReleased.selector, 0));
        custody.release(0);

        _sellUntilPriceBelow(TICK_1);
        assertFalse(hook.isTrancheUnlocked(poolId, 2), "current price is checked, not only history");

        vm.warp(block.timestamp + 181 days);
        assertFalse(custody.releasable(2));
        uint256 remainderBeforeForfeit = token.balanceOf(address(custody));
        vm.prank(trader);
        custody.forfeit();
        assertTrue(custody.forfeited());
        assertEq(token.balanceOf(address(custody)), 0, "the remainder is fully swept");
        assertEq(token.balanceOf(custody.FORFEIT_RECIPIENT()), remainderBeforeForfeit, "forfeiture only ever burns");

        (,,,,,,,, uint256 creatorFees) = hook.poolFeeConfig(poolId);
        uint256 launcherFees = hook.launcherFeesAccrued();
        uint256 builderFees = hook.builderFeesAccrued();
        assertGt(creatorFees, 0);
        assertGt(launcherFees, 0);
        assertGt(builderFees, 0);
        assertEq(poolManager.balanceOf(address(hook), Currency.wrap(address(0)).toId()), hook.totalNativeFeesAccrued());

        vm.prank(builder);
        hook.claimBuilderFees();
        assertEq(builder.balance, builderFees);
    }

    function _buy(uint256 ethIn) private returns (BalanceDelta) {
        vm.prank(trader);
        return swapRouter.swap{ value: ethIn }(
            hookKey,
            SwapParams({ zeroForOne: true, amountSpecified: -int256(ethIn), sqrtPriceLimitX96: 4_295_128_740 }),
            settings,
            ""
        );
    }

    /// @dev Clamps each sell to the trader's remaining balance rather than a fixed step: earlier sells consume the
    ///      trader's holdings, and a fixed amount that exceeded what was left would underflow the token transfer
    ///      rather than simply fail cleanly.
    function _sellUntilPriceBelow(int24 target) private {
        for (uint256 i = 0; i < 120; ++i) {
            if (_currentTick() > target) return;
            uint256 remaining = token.balanceOf(trader);
            if (remaining == 0) revert("trader has no tokens left to push the price down with");
            uint256 sellAmount = remaining < 0.5 ether ? remaining : 0.5 ether;
            vm.prank(trader);
            swapRouter.swap(
                hookKey,
                SwapParams({
                    zeroForOne: false,
                    amountSpecified: -int256(sellAmount),
                    sqrtPriceLimitX96: 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_341
                }),
                settings,
                ""
            );
        }
        revert("could not push the price below the target");
    }

    function _currentTick() private view returns (int24 tick) {
        (, tick,,) = StateLibrary.getSlot0(poolManager, PoolId.wrap(poolId));
    }
}
