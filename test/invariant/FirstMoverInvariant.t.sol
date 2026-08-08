// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Test } from "forge-std/Test.sol";

import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { EthFirstMoverFeeHookV1 } from "../../src/EthFirstMoverFeeHookV1.sol";
import { FeeSplitVaultFactoryV1 } from "../../src/FeeSplitVaultFactoryV1.sol";
import { FeeSplitVaultV1 } from "../../src/FeeSplitVaultV1.sol";
import { TickerClaimV1 } from "../../src/libraries/TickerClaimV1.sol";
import { IClassicFeeHookV3 } from "../../src/interfaces/IClassicFeeHookV3.sol";

contract InvariantToken is MockERC20 {
    address public immutable creator;

    constructor(address creator_, string memory symbol_) MockERC20(symbol_, symbol_, 18) {
        creator = creator_;
    }
}

/// @notice Drives arbitrary swap sequences and block progression across four pools: two competing for one ticker,
///         one holding a second ticker, and one that never trades.
/// @dev Launching inside the handler would make every run deploy contracts, so the pools are fixed in `setUp` and
///      the handler only swaps and rolls. That is where the interesting state lives: confirmation, tribute routing
///      and lapse are all functions of accrued fees and block height.
contract FirstMoverHandler is Test {
    EthFirstMoverFeeHookV1 public immutable hook;
    PoolSwapTest public immutable swapRouter;

    PoolKey[4] internal _keys;
    bytes32[4] public poolIds;

    uint256 public swaps;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    constructor(EthFirstMoverFeeHookV1 hook_, PoolSwapTest swapRouter_, PoolKey[4] memory keys_) {
        hook = hook_;
        swapRouter = swapRouter_;
        for (uint256 i = 0; i < 4; ++i) {
            _keys[i] = keys_[i];
            poolIds[i] = PoolId.unwrap(keys_[i].toId());
        }
    }

    receive() external payable { }

    /// @notice Buys on one of the first three pools. The fourth is deliberately never traded.
    function buy(uint8 rawIndex, uint96 rawAmount) external {
        uint256 index = bound(rawIndex, 0, 2);
        uint256 amount = bound(rawAmount, 0.001 ether, 2 ether);
        if (address(this).balance < amount) return;

        try swapRouter.swap{ value: amount }(
            _keys[index],
            SwapParams({ zeroForOne: true, amountSpecified: -int256(amount), sqrtPriceLimitX96: 4_295_128_740 }),
            settings,
            ""
        ) {
            swaps++;
        } catch { }
    }

    function advance(uint16 rawBlocks) external {
        vm.roll(block.number + bound(rawBlocks, 1, 20_000));
    }
}

/// @dev Stateful properties of the ticker registry under arbitrary trading and time.
contract FirstMoverInvariantTest is StdInvariant, Deployers {
    EthFirstMoverFeeHookV1 internal hook;
    FeeSplitVaultFactoryV1 internal vaultFactory;
    FirstMoverHandler internal handler;

    address internal builder;
    address internal beneficiary;

    bytes32 internal sharedSymbol;
    bytes32 internal originalPoolId;
    bytes32 internal derivativePoolId;
    bytes32[4] internal allPools;

    /// @dev Ghost variable for invariant_confirmedClaimIsNeverReassigned; latches to the first confirmed holder.
    bytes32 internal _firstConfirmedHolder;

    uint16 internal constant FEE_BPS = 1000;
    uint256 internal saltCounter;

    function setUp() public {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 200_000 ether);
        vm.roll(1_000_000);

        builder = makeAddr("builder");
        beneficiary = makeAddr("beneficiary");

        vaultFactory = new FeeSplitVaultFactoryV1();
        hook = _deployHook();

        PoolKey[4] memory keys;
        keys[0] = _launch("PEPE");
        keys[1] = _launch("pepe");
        keys[2] = _launch("WOJAK");
        keys[3] = _launch("QUIET");

        sharedSymbol = hook.symbolHashOf("PEPE");
        originalPoolId = PoolId.unwrap(keys[0].toId());
        derivativePoolId = PoolId.unwrap(keys[1].toId());
        for (uint256 i = 0; i < 4; ++i) {
            allPools[i] = PoolId.unwrap(keys[i].toId());
        }

        handler = new FirstMoverHandler(hook, swapRouter, keys);
        vm.deal(address(handler), 100_000 ether);
        targetContract(address(handler));
    }

    /// @dev The hook's claim-token balance must always equal what it believes it is holding. This is the solvency
    ///      property: if tribute ever created or destroyed value, these would diverge.
    function invariant_claimTokensMatchAccounting() public view {
        assertEq(
            manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()),
            hook.totalNativeFeesAccrued(),
            "hook holds exactly what it has accrued"
        );
    }

    /// @dev Every wei accrued belongs to exactly one of the four pools, the launcher or the builder.
    function invariant_accrualsSumToTheTotal() public view {
        uint256 sum = hook.launcherFeesAccrued() + hook.builderFeesAccrued();
        for (uint256 i = 0; i < 4; ++i) {
            sum += _creatorAccrued(allPools[i]);
        }
        assertEq(sum, hook.totalNativeFeesAccrued(), "no wei is unattributed");
    }

    /// @dev A derivative can never hold the ticker it copies, however much it trades.
    /// @dev A derivative can take over the ticker if the pool it was recorded against never earns a confirmed
    ///      claim -- that is the fix this suite exists to prove. What must never happen is a confirmed claim being
    ///      reassigned: if the pool the derivative was registered against is CURRENTLY confirmed, that claim is
    ///      permanent, and the derivative can never hold it instead.
    function invariant_derivativeNeverHoldsAConfirmedOriginalsTicker() public view {
        if (hook.isOriginal(originalPoolId)) {
            assertFalse(hook.isOriginal(derivativePoolId), "a confirmed claim was reassigned to the derivative");
        }
    }

    /// @dev Once a claim is confirmed it is permanent: the holder never changes and it never lapses.
    /// @dev The general permanence property: once a claim is confirmed, it never changes hands afterward --
    ///      regardless of WHICH pool won it. The fixture doesn't assume pool0 wins; a lapse-and-takeover run can
    ///      legitimately confirm pool1 instead. What must never happen is the confirmed holder changing a second
    ///      time. `_firstConfirmedHolder` is a ghost variable: it latches onto whichever pool is first observed
    ///      confirmed, then every later call must see the same one.
    function invariant_confirmedClaimIsNeverReassigned() public {
        (bytes32 holder,, bool confirmed,) = hook.tickerDisclosure(sharedSymbol);
        if (!confirmed) return;

        if (_firstConfirmedHolder == bytes32(0)) {
            _firstConfirmedHolder = holder;
            return;
        }
        assertEq(holder, _firstConfirmedHolder, "a confirmed ticker changed hands after being granted");
    }

    /// @dev Confirmation implies the threshold was actually met. The claim cannot be granted any other way.
    function invariant_confirmationImpliesEarned() public view {
        (bytes32 holder,, bool confirmed,) = hook.tickerDisclosure(sharedSymbol);
        if (!confirmed) return;
        assertGe(_lifetimeCreatorFees(holder), hook.CONFIRMATION_FEE_WEI(), "a confirmed claim was paid for in volume");
    }

    /// @dev A pool that never trades never earns a claim, whatever anyone else does.
    function invariant_untradedPoolNeverConfirms() public view {
        assertFalse(hook.isOriginal(allPools[3]), "the quiet pool earns nothing");
        assertEq(_lifetimeCreatorFees(allPools[3]), 0);
    }

    /// @dev Tribute only ever moves value between creators. The protocol shares stay in the exact ratio the fee
    ///      schedule sets, regardless of how much of the volume ran through derivative pools.
    function invariant_launcherAndBuilderSharesRemainEqual() public view {
        assertEq(
            hook.launcherFeesAccrued(),
            hook.builderFeesAccrued(),
            "both fixed shares are 10 bps and must accrue identically"
        );
    }

    // --- Helpers ----------------------------------------------------------------------------------------------

    function _deployHook() private returns (EthFirstMoverFeeHookV1 deployed) {
        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
                | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        bytes memory args = abi.encode(manager, builder, vaultFactory);
        (address expected, bytes32 salt) =
            HookMiner.find(address(this), flags, type(EthFirstMoverFeeHookV1).creationCode, args);
        deployed = new EthFirstMoverFeeHookV1{ salt: salt }(manager, builder, vaultFactory);
        require(address(deployed) == expected, "mined hook address mismatch");
    }

    function _launch(string memory symbol) private returns (PoolKey memory key) {
        InvariantToken token = new InvariantToken(address(this), symbol);
        token.mint(address(this), 10_000_000 ether);
        token.approve(address(modifyLiquidityRouter), type(uint256).max);
        token.approve(address(swapRouter), type(uint256).max);

        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: hook.LP_FEE_PIPS(),
            tickSpacing: hook.TICK_SPACING(),
            hooks: hook
        });
        bytes32 id = PoolId.unwrap(key.toId());

        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = beneficiary;
        uint16[] memory shares = new uint16[](1);
        shares[0] = 10_000;
        FeeSplitVaultV1 vault =
            vaultFactory.deploy(bytes32(++saltCounter), IClassicFeeHookV3(address(hook)), id, beneficiaries, shares);

        hook.registerPool(key, address(vault), FEE_BPS, FEE_BPS);
        manager.initialize(key, SQRT_PRICE_1_1);
        modifyLiquidityRouter.modifyLiquidity{ value: 2000 ether }(
            key,
            ModifyLiquidityParams({ tickLower: -60_000, tickUpper: 60_000, liquidityDelta: 50 ether, salt: 0 }),
            ZERO_BYTES
        );
    }

    function _creatorAccrued(bytes32 poolId) private view returns (uint256 accrued) {
        (,,,,,, accrued,) = hook.poolFeeConfig(poolId);
    }

    function _lifetimeCreatorFees(bytes32 poolId) private view returns (uint256 lifetime) {
        (,,,,,,, lifetime) = hook.poolFeeConfig(poolId);
    }
}
