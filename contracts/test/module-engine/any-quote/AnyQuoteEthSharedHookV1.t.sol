// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { PoolModifyLiquidityTest } from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TransientStateLibrary } from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { BeforeSwapDelta, BeforeSwapDeltaLibrary } from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";

import { AnyQuoteTypesV1 as A } from "../../../src/module-engine/any-quote/AnyQuoteTypesV1.sol";
import { AnyQuoteEthSharedHookV1 } from "../../../src/module-engine/any-quote/AnyQuoteEthSharedHookV1.sol";
import { IAnyQuoteEthLedgerV1 } from "../../../src/module-engine/any-quote/IAnyQuoteEthLedgerV1.sol";
import { AnyQuoteNativeFeeRouteV1 as R } from "../../../src/module-engine/any-quote/AnyQuoteNativeFeeRouteV1.sol";
import { AnyQuoteHookTestToken, AnyQuoteHookTestPosition } from "./AnyQuoteSharedHookV1.t.sol";

contract AnyQuoteEthRouteDynamicHook is BaseHook {
    uint24 public fee = 3000;
    PoolKey private _reentrantPool;

    constructor(IPoolManager manager) BaseHook(manager) { }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory permissions) {
        permissions.beforeSwap = true;
    }

    function configure(uint24 nextFee, PoolKey memory reentrantPool) external {
        fee = nextFee;
        _reentrantPool = reentrantPool;
    }

    function _beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (address(_reentrantPool.hooks) != address(0)) {
            poolManager.swap(_reentrantPool, SwapParams(true, -int256(1000), TickMath.MIN_SQRT_PRICE + 1), "");
        }
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | 0x400000);
    }
}

contract AnyQuoteEthSharedHookV1Test is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;

    IPoolManager private manager;
    AnyQuoteEthSharedHookV1 private hook;
    IAnyQuoteEthLedgerV1 private ledger;
    PoolSwapTest private router;
    PoolModifyLiquidityTest private liquidityRouter;
    address private alice;
    address private creator;
    address private rewardAdmin;
    uint256 private serial;

    struct Fixture {
        AnyQuoteHookTestToken token;
        AnyQuoteHookTestToken quote;
        AnyQuoteHookTestPosition position;
        A.PoolRegistration registration;
        PoolKey key;
        bytes32 poolId;
        bool quote0;
        R.FeeHop[] route;
    }

    struct Converted {
        uint256 quoteAmount;
        uint256 ethAmount;
        uint256 platform;
        uint256 creatorFee;
    }

    function setUp() public {
        vm.chainId(A.CHAIN_ID);
        vm.deal(address(this), 1_000_000_000 ether);
        alice = makeAddr("independent-trader");
        creator = makeAddr("creator");
        rewardAdmin = makeAddr("reward-admin");
        manager = IPoolManager(address(new PoolManager(address(this))));
        hook = _deployHook();
        ledger = IAnyQuoteEthLedgerV1(hook.ledger());
        router = new PoolSwapTest(manager);
        liquidityRouter = new PoolModifyLiquidityTest(manager);
    }

    receive() external payable { }

    function test_allFourFormsQuoteCurrency0() public {
        _fourForms(true);
    }

    function test_allFourFormsQuoteCurrency1() public {
        _fourForms(false);
    }

    function test_exactOutputFirstBuyNeedsNoLaunchQuoteSeed() public {
        Fixture memory f = _fixture(true, 100, 300, 1, 3000, IHooks(address(0)));
        _trade(f, true, int256(1 ether));
        assertGt(ledger.claimableEth(A.PLATFORM_RECIPIENT), 0);
    }

    function test_fourHopRouteSettlesIntermediateDeltas() public {
        Fixture memory f = _fixture(false, 100, 300, 4, 3000, IHooks(address(0)));
        Converted memory got = _trade(f, true, -int256(1 ether));
        assertGt(got.ethAmount, got.quoteAmount * 9500 / 10_000);
        for (uint256 i; i < f.route.length; ++i) {
            Currency currency = f.route[i].zeroForOne ? f.route[i].key.currency0 : f.route[i].key.currency1;
            assertEq(manager.currencyDelta(address(hook), currency), 0);
        }
    }

    function test_sixDecimalIntermediatePreservesNativeMinimumAndRounding() public {
        Fixture memory f = _fixture(true, 100, 300, 1, 3000, IHooks(address(0)));
        f.registration.launchId = keccak256("low-decimal-launch");
        f.position = new AnyQuoteHookTestPosition(manager);
        f.registration.initializer = address(f.position);
        f.token = new AnyQuoteHookTestToken("LOW-DECIMAL-PRIMARY", 18);
        f.registration.token = address(f.token);
        f.quote0 = address(f.quote) < address(f.token);
        f.registration.initialTick = f.quote0 ? int24(100_000) : int24(-100_000);
        address intermediate = address(new AnyQuoteHookTestToken("SIX", 6));
        f.route = new R.FeeHop[](2);
        f.route[0] = _seedHop(address(f.quote), intermediate, 3000, IHooks(address(0)), -276_320, 1 ether);
        f.route[1] = _seedHop(intermediate, address(0), 3000, IHooks(address(0)), 276_320, 1 ether);
        (address[] memory wallets, uint16[] memory shares) = _recipients();
        f.poolId = hook.registerPoolWithNativeFeeRoute(f.registration, wallets, shares, f.route);
        f.key = hook.poolKey(f.poolId);
        f.token.mint(address(f.position), A.TOKEN_SUPPLY);
        f.position.initialize(f.key, address(f.token), f.registration.initialTick);
        vm.prank(alice);
        f.token.approve(address(router), type(uint256).max);
        Converted memory got = _trade(f, true, -int256(1 ether));
        assertGe(got.ethAmount, got.quoteAmount * 9500 / 10_000);
        assertEq(manager.currencyDelta(address(hook), Currency.wrap(intermediate)), 0);
        // A positive fee below one intermediate raw unit must revert, leaving all carry intact.
        _assertFailedTradeUnchanged(f, 10_000);
    }

    function test_anotherUnprivilegedRouterWithEmptyHookDataWorks() public {
        Fixture memory f = _fixture(true, 100, 300, 1, 3000, IHooks(address(0)));
        router = new PoolSwapTest(manager);
        vm.startPrank(alice);
        f.quote.approve(address(router), type(uint256).max);
        f.token.approve(address(router), type(uint256).max);
        vm.stopPrank();
        _trade(f, true, -int256(1 ether));
    }

    function test_nativeAndQuoteDonationsAreNotFeeFunding() public {
        Fixture memory f = _fixture(true, 100, 300, 1, 3000, IHooks(address(0)));
        uint256 snapshot = vm.snapshotState();
        Converted memory plain = _trade(f, true, -int256(1 ether));
        assertTrue(vm.revertToState(snapshot));
        vm.deal(address(hook), 7 ether);
        vm.deal(address(manager), address(manager).balance + 11 ether);
        f.quote.mint(address(hook), 23 ether);
        f.quote.mint(address(manager), 29 ether);
        Converted memory donated = _trade(f, true, -int256(1 ether));
        assertEq(donated.ethAmount, plain.ethAmount);
        assertEq(donated.platform, plain.platform);
        assertEq(address(hook).balance, 7 ether);
        assertEq(f.quote.balanceOf(address(hook)), 23 ether);
    }

    function test_excessiveExternalFeeRevertsEntireTradeAndCarry() public {
        Fixture memory f = _fixture(true, 100, 300, 1, 60_000, IHooks(address(0)));
        _assertFailedTradeUnchanged(f, 1 ether + 337);
    }

    function test_dynamicFeeRouteWorksAndCannotReenterSharedHook() public {
        AnyQuoteEthRouteDynamicHook externalHook = _deployDynamicHook();
        Fixture memory f = _fixture(true, 100, 300, 1, 0x800000, IHooks(address(externalHook)));
        _trade(f, true, -int256(1 ether));
        externalHook.configure(3000, f.key);
        _assertFailedTradeUnchanged(f, 1 ether + 337);
    }

    function test_positiveQuoteFeeProducingZeroEthRevertsWithoutPendingQuote() public {
        Fixture memory f = _fixture(true, 0, 0, 1, 3000, IHooks(address(0)));
        // 334 raw quote charges one raw unit. V4's fee rounding consumes it with zero output.
        _assertFailedTradeUnchanged(f, 334);
        assertEq(manager.balanceOf(hook.ledger(), uint256(uint160(address(f.quote)))), 0);
    }

    function test_zeroQuoteFeePreservesRemainderWithoutNativeConversion() public {
        Fixture memory f = _fixture(true, 0, 0, 1, 3000, IHooks(address(0)));
        vm.prank(alice);
        router.swap(
            f.key, SwapParams(f.quote0, -int256(1), _limit(f.quote0)), PoolSwapTest.TestSettings(false, false), ""
        );
        (uint16 remainder,) = hook.feeCarry(f.poolId, true);
        assertEq(remainder, 30);
        assertEq(manager.balanceOf(hook.ledger(), 0), 0);
    }

    function test_feeAndEthSplitCarryIsolatedAcrossPoolAndDirection() public {
        Fixture memory a = _fixture(true, 100, 300, 1, 3000, IHooks(address(0)));
        Fixture memory b = _fixture(false, 1000, 0, 1, 3000, IHooks(address(0)));
        for (uint256 i; i < 12; ++i) {
            _trade(a, true, -int256(1 ether + 337));
        }
        (uint16 p, uint16 c) = hook.feeCarry(b.poolId, true);
        assertEq(p, 0);
        assertEq(c, 0);
        assertEq(hook.platformEthRemainderX128(b.poolId, true), 0);
        assertEq(hook.platformEthRemainderX128(a.poolId, false), 0);
        _trade(b, true, -int256(1 ether));
        _trade(a, false, -int256(1 ether));
    }

    function test_nativeSplitCarriesActualFractionAcrossRepeatedConversions() public {
        Fixture memory f = _fixture(true, 100, 300, 1, 3000, IHooks(address(0)));
        uint256 received;
        uint256 platform;
        for (uint256 i; i < 32; ++i) {
            Converted memory got = _trade(f, true, -int256(1 ether));
            received += got.ethAmount;
            platform += got.platform;
        }
        // At this exact gross input each quote split is 30:100. Q128 truncation over 32
        // conversions is below one wei; it must never award more than actual entitlement.
        uint256 entitlement = received * 3 / 13;
        assertLe(platform, entitlement);
        assertLe(entitlement - platform, 1);
    }

    function test_routeHashBindsOriginalAbiAndCannotBeRegisteredAgain() public {
        Fixture memory f = _fixture(true, 100, 300, 1, 3000, IHooks(address(0)));
        assertEq(hook.nativeFeeRouteHash(f.poolId), keccak256(abi.encode(f.route)));
        assertEq(keccak256(abi.encode(hook.nativeFeeRoute(f.poolId))), keccak256(abi.encode(f.route)));
        (address[] memory wallets, uint16[] memory shares) = _recipients();
        vm.expectRevert(AnyQuoteEthSharedHookV1.AlreadyRegistered.selector);
        hook.registerPoolWithNativeFeeRoute(f.registration, wallets, shares, f.route);
        vm.expectRevert(AnyQuoteEthSharedHookV1.NativeFeeRouteRequired.selector);
        hook.registerPool(f.registration, wallets, shares);
    }

    function test_rawRouteRequiresCanonicalBoundedEncoding() public {
        Fixture memory f = _fixture(true, 100, 300, 1, 3000, IHooks(address(0)));
        f.registration.launchId = keccak256("raw-route-launch");
        f.registration.token = address(new AnyQuoteHookTestToken("RAW", 18));
        (address[] memory wallets, uint16[] memory shares) = _recipients();
        bytes memory encoded = abi.encode(f.route);
        vm.expectRevert(AnyQuoteEthSharedHookV1.InvalidNativeFeeRouteData.selector);
        hook.registerPoolWithNativeFeeRouteData(f.registration, wallets, shares, bytes.concat(encoded, hex"00"));
        vm.expectRevert(AnyQuoteEthSharedHookV1.InvalidNativeFeeRouteData.selector);
        hook.registerPoolWithNativeFeeRouteData(f.registration, wallets, shares, "");
        vm.expectRevert(AnyQuoteEthSharedHookV1.InvalidNativeFeeRouteData.selector);
        hook.registerPoolWithNativeFeeRouteData(f.registration, wallets, shares, new bytes(16_385));
        bytes32 poolId = hook.registerPoolWithNativeFeeRouteData(f.registration, wallets, shares, encoded);
        assertEq(hook.nativeFeeRouteHash(poolId), keccak256(encoded));
    }

    function test_selfRouteAndCyclicRouteRejected() public {
        Fixture memory f = _fixture(true, 100, 300, 1, 3000, IHooks(address(0)));
        (address[] memory wallets, uint16[] memory shares) = _recipients();
        f.registration.launchId = keccak256("other-launch");
        f.registration.token = address(new AnyQuoteHookTestToken("NEW", 18));
        f.route[0].key.hooks = IHooks(address(hook));
        vm.expectRevert(R.InvalidNativeFeeRoute.selector);
        hook.registerPoolWithNativeFeeRoute(f.registration, wallets, shares, f.route);
        f.route = new R.FeeHop[](2);
        PoolKey memory externalKey =
            PoolKey(Currency.wrap(address(0)), Currency.wrap(address(f.quote)), 3000, 60, IHooks(address(0)));
        f.route[0] = R.FeeHop(externalKey, false, "");
        f.route[1] = R.FeeHop(externalKey, true, "");
        vm.expectRevert(R.InvalidNativeFeeRoute.selector);
        hook.registerPoolWithNativeFeeRoute(f.registration, wallets, shares, f.route);
    }

    function test_boundQuoteRuntimeChangeRejectsTrade() public {
        Fixture memory f = _fixture(true, 100, 300, 1, 3000, IHooks(address(0)));
        vm.etch(address(f.quote), hex"60006000fd");
        vm.prank(alice);
        vm.expectRevert();
        router.swap(
            f.key, SwapParams(f.quote0, -int256(1 ether), _limit(f.quote0)), PoolSwapTest.TestSettings(false, false), ""
        );
    }

    function test_nativeClaimsRedeemToOriginalRecipients() public {
        Fixture memory f = _fixture(true, 100, 300, 1, 3000, IHooks(address(0)));
        _trade(f, true, -int256(1 ether));
        uint256 owed = ledger.claimableEth(A.PLATFORM_RECIPIENT);
        assertEq(ledger.claimEthFor(A.PLATFORM_RECIPIENT), owed);
        assertEq(A.PLATFORM_RECIPIENT.balance, owed);
        owed = ledger.claimableEth(creator);
        vm.prank(creator);
        assertEq(ledger.claimEthTo(creator), owed);
        assertEq(creator.balance, owed);
        assertEq(manager.balanceOf(hook.ledger(), 0), 0);
    }

    function _fourForms(bool quote0) private {
        Fixture memory f = _fixture(quote0, 100, 300, 1, 3000, IHooks(address(0)));
        _trade(f, true, -int256(1 ether + 337));
        _trade(f, false, -int256(f.token.balanceOf(alice) / 3));
        _trade(f, true, int256(2 ether));
        _trade(f, false, int256(0.0001 ether + 337));
    }

    function _trade(Fixture memory f, bool buy, int256 specified) private returns (Converted memory result) {
        uint256 beforePlatform = ledger.claimableEth(A.PLATFORM_RECIPIENT);
        uint256 beforeCreator = ledger.claimableEth(creator);
        uint256 beforeClaims = manager.balanceOf(hook.ledger(), 0);
        vm.recordLogs();
        vm.prank(alice);
        BalanceDelta delta = router.swap(
            f.key,
            SwapParams(buy == f.quote0, specified, _limit(buy == f.quote0)),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (
                logs[i].emitter == address(hook)
                    && logs[i].topics[0]
                        == keccak256("NativeFeesConverted(bytes32,bytes32,bytes32,uint256,uint256,uint256,uint256)")
            ) {
                assertFalse(found);
                found = true;
                result = abi.decode(logs[i].data, (Converted));
                assertEq(logs[i].topics[1], f.poolId);
                assertEq(logs[i].topics[2], f.registration.launchId);
                assertEq(logs[i].topics[3], keccak256(abi.encode(f.route)));
            }
        }
        assertTrue(found);
        assertGt(result.ethAmount, 0);
        assertEq(result.platform + result.creatorFee, result.ethAmount);
        assertEq(ledger.claimableEth(A.PLATFORM_RECIPIENT) - beforePlatform, result.platform);
        assertEq(ledger.claimableEth(creator) - beforeCreator, result.creatorFee);
        assertEq(manager.balanceOf(hook.ledger(), 0) - beforeClaims, result.ethAmount);
        int128 quoteDelta = f.quote0 ? delta.amount0() : delta.amount1();
        int128 tokenDelta = f.quote0 ? delta.amount1() : delta.amount0();
        if (specified < 0) assertEq(buy ? int256(quoteDelta) : int256(tokenDelta), specified);
        else assertEq(buy ? int256(tokenDelta) : int256(quoteDelta), specified);
        assertEq(manager.balanceOf(hook.ledger(), uint256(uint160(address(f.quote)))), 0);
        assertEq(manager.currencyDelta(address(hook), Currency.wrap(address(f.quote))), 0);
        assertEq(manager.currencyDelta(address(hook), Currency.wrap(address(0))), 0);
    }

    function _assertFailedTradeUnchanged(Fixture memory f, uint256 amount) private {
        (uint160 beforePrice,,,) = manager.getSlot0(PoolId.wrap(f.poolId));
        (uint16 p, uint16 c) = hook.feeCarry(f.poolId, true);
        uint128 splitCarry = hook.platformEthRemainderX128(f.poolId, true);
        uint256 claims = manager.balanceOf(hook.ledger(), 0);
        vm.prank(alice);
        vm.expectRevert();
        router.swap(
            f.key, SwapParams(f.quote0, -int256(amount), _limit(f.quote0)), PoolSwapTest.TestSettings(false, false), ""
        );
        (uint160 afterPrice,,,) = manager.getSlot0(PoolId.wrap(f.poolId));
        assertEq(beforePrice, afterPrice);
        (uint16 afterP, uint16 afterC) = hook.feeCarry(f.poolId, true);
        assertEq(afterP, p);
        assertEq(afterC, c);
        assertEq(hook.platformEthRemainderX128(f.poolId, true), splitCarry);
        assertEq(manager.balanceOf(hook.ledger(), 0), claims);
    }

    function _fixture(bool quote0, uint16 buyBps, uint16 sellBps, uint256 hops, uint24 fee, IHooks externalHook)
        private
        returns (Fixture memory f)
    {
        AnyQuoteHookTestToken x = new AnyQuoteHookTestToken("X", 18);
        AnyQuoteHookTestToken y = new AnyQuoteHookTestToken("Y", 18);
        f.quote0 = quote0;
        f.quote = (address(x) < address(y)) == quote0 ? x : y;
        f.token = address(f.quote) == address(x) ? y : x;
        f.position = new AnyQuoteHookTestPosition(manager);
        f.route = _seedRoute(address(f.quote), hops, fee, externalHook);
        f.registration = A.PoolRegistration({
            launchId: keccak256(abi.encode("launch", ++serial)),
            revisionId: keccak256("revision"),
            familyId: keccak256("original-author"),
            configurationHash: keccak256(abi.encode(serial, quote0)),
            token: address(f.token),
            quoteAsset: address(f.quote),
            initializer: address(f.position),
            initialTick: quote0 ? int24(100_000) : int24(-100_000),
            buyCreatorFeeBps: buyBps,
            sellCreatorFeeBps: sellBps
        });
        (address[] memory wallets, uint16[] memory shares) = _recipients();
        f.poolId = hook.registerPoolWithNativeFeeRouteData(f.registration, wallets, shares, abi.encode(f.route));
        f.key = hook.poolKey(f.poolId);
        uint256 quoteBefore = f.quote.balanceOf(address(manager));
        f.token.mint(address(f.position), A.TOKEN_SUPPLY);
        f.position.initialize(f.key, address(f.token), f.registration.initialTick);
        assertEq(f.quote.balanceOf(address(manager)), quoteBefore, "new LP must require zero quote seed");
        assertEq(f.quote.balanceOf(address(f.position)), 0);
        f.quote.mint(alice, 1000 ether);
        vm.startPrank(alice);
        f.quote.approve(address(router), type(uint256).max);
        f.token.approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    function _seedRoute(address quote, uint256 hops, uint24 fee, IHooks externalHook)
        private
        returns (R.FeeHop[] memory route)
    {
        route = new R.FeeHop[](hops);
        address input = quote;
        for (uint256 i; i < hops; ++i) {
            address output = i + 1 == hops ? address(0) : address(new AnyQuoteHookTestToken("INTERMEDIATE", 18));
            route[i] = _seedHop(input, output, fee, externalHook, 0, 1_000_000 ether);
            input = output;
        }
    }

    function _seedHop(
        address input,
        address output,
        uint24 fee,
        IHooks externalHook,
        int24 outputPriceTick,
        uint128 liquidity
    ) private returns (R.FeeHop memory hop) {
        (address c0, address c1) = input < output ? (input, output) : (output, input);
        PoolKey memory key = PoolKey(Currency.wrap(c0), Currency.wrap(c1), fee, 60, externalHook);
        manager.initialize(key, TickMath.getSqrtPriceAtTick(input == c0 ? outputPriceTick : -outputPriceTick));
        if (c0 != address(0)) {
            AnyQuoteHookTestToken(c0).mint(address(this), 2_000_000 ether);
            IERC20(c0).approve(address(liquidityRouter), type(uint256).max);
        }
        AnyQuoteHookTestToken(c1).mint(address(this), 2_000_000 ether);
        IERC20(c1).approve(address(liquidityRouter), type(uint256).max);
        liquidityRouter.modifyLiquidity{ value: c0 == address(0) ? 2_000_000 ether : 0 }(
            key, ModifyLiquidityParams(-887_220, 887_220, int256(uint256(liquidity)), bytes32(0)), ""
        );
        return R.FeeHop(key, input == c0, "");
    }

    function _recipients() private view returns (address[] memory wallets, uint16[] memory shares) {
        wallets = new address[](1);
        wallets[0] = creator;
        shares = new uint16[](1);
        shares[0] = 10_000;
    }

    function _limit(bool zeroForOne) private pure returns (uint160) {
        return zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
    }

    function _salt(bytes32 initHash, uint160 flags) private view returns (bytes32) {
        for (uint256 i; i < 160_444; ++i) {
            bytes32 salt = bytes32(i);
            address predicted =
                address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initHash)))));
            if (uint160(predicted) & Hooks.ALL_HOOK_MASK == flags) return salt;
        }
        revert("hook salt not found");
    }

    function _deployHook() private returns (AnyQuoteEthSharedHookV1) {
        uint160 flags = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
        bytes32 initHash = keccak256(
            abi.encodePacked(
                type(AnyQuoteEthSharedHookV1).creationCode, abi.encode(manager, address(this), rewardAdmin)
            )
        );
        return new AnyQuoteEthSharedHookV1{ salt: _salt(initHash, flags) }(manager, address(this), rewardAdmin);
    }

    function _deployDynamicHook() private returns (AnyQuoteEthRouteDynamicHook) {
        bytes32 initHash =
            keccak256(abi.encodePacked(type(AnyQuoteEthRouteDynamicHook).creationCode, abi.encode(manager)));
        return new AnyQuoteEthRouteDynamicHook{ salt: _salt(initHash, Hooks.BEFORE_SWAP_FLAG) }(manager);
    }
}
