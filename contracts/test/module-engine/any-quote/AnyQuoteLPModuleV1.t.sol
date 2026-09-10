// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams, ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { AnyQuoteLPModuleV1 } from "../../../src/module-engine/any-quote/AnyQuoteLPModuleV1.sol";
import { AnyQuoteSharedHookV1 } from "../../../src/module-engine/any-quote/AnyQuoteSharedHookV1.sol";
import { IAnyQuoteLedgerV1 } from "../../../src/module-engine/any-quote/IAnyQuoteLedgerV1.sol";
import { AnyQuoteTypesV1 as A } from "../../../src/module-engine/any-quote/AnyQuoteTypesV1.sol";
import { ModuleEngineTypesV1 as T } from "../../../src/module-engine/ModuleEngineTypesV1.sol";
import { ModuleEngineBaseV1 } from "../../../src/module-engine/ModuleEngineBaseV1.sol";

/// @dev ERC20-only adversarial fixture. PoolManager, shared hook and engine use real deployed bytecode.
contract AnyQuoteLPTokenFixture is ERC20 {
    uint8 private _decimals;
    bool private _tax;

    constructor() ERC20("Local engine fixture", "FIX") { }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function setDecimals(uint8 value) external {
        _decimals = value;
    }

    function setTax(bool value) external {
        _tax = value;
    }

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }

    function _update(address from, address to, uint256 amount) internal override {
        uint256 tax = _tax && from != address(0) && to != address(0) ? amount / 100 : 0;
        super._update(from, to, amount - tax);
        if (tax != 0) super._update(from, address(0), tax);
    }
}

/// @dev Minimal lifecycle fixture, not the production host or a review-admission implementation.
contract AnyQuoteLPHostFixture {
    using SafeERC20 for IERC20;
    AnyQuoteSharedHookV1 public sharedHook;

    function deployHook(bytes memory creation, bytes32 salt) external returns (AnyQuoteSharedHookV1 hook) {
        require(address(sharedHook) == address(0));
        address deployed;
        assembly ("memory-safe") { deployed := create2(0, add(creation, 32), mload(creation), salt) }
        require(deployed != address(0), "hook CREATE2");
        sharedHook = AnyQuoteSharedHookV1(deployed);
        return sharedHook;
    }

    function deployEngine(T.Context memory context, bytes memory configuration) external returns (AnyQuoteLPModuleV1) {
        return new AnyQuoteLPModuleV1(context, configuration);
    }

    function register(A.PoolRegistration memory registration) external {
        address[] memory wallets = new address[](1);
        uint16[] memory shares = new uint16[](1);
        wallets[0] = address(0xA11CE);
        shares[0] = 10_000;
        sharedHook.registerPool(registration, wallets, shares);
    }

    function initialize(AnyQuoteLPModuleV1 engine, bytes memory launchData) external returns (bytes32) {
        IERC20(engine.context().token).safeTransfer(address(engine), A.TOKEN_SUPPLY);
        return engine.initialize(launchData);
    }

    function initializeAgain(AnyQuoteLPModuleV1 engine) external {
        engine.initialize("");
    }

    function execute(AnyQuoteLPModuleV1 engine, T.Operation calldata operation) external returns (bytes memory) {
        IERC20(operation.inputAsset).safeTransferFrom(msg.sender, address(engine), operation.inputAmount);
        return engine.execute(operation);
    }

    function executeUnfunded(AnyQuoteLPModuleV1 engine, T.Operation calldata operation)
        external
        returns (bytes memory)
    {
        return engine.execute(operation);
    }
}

/// @dev An independent, unprivileged V4 router. No special hook data or approved sender is supplied.
contract AnyQuoteLPExternalRouter is IUnlockCallback {
    using SafeERC20 for IERC20;
    IPoolManager public immutable manager;
    address private _payer;

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    function swap(PoolKey memory key, SwapParams memory params, address recipient)
        external
        returns (BalanceDelta delta)
    {
        require(_payer == address(0));
        _payer = msg.sender;
        delta = abi.decode(
            manager.unlock(abi.encode(uint8(0), key, params, recipient, int24(0), int24(0), bytes32(0))), (BalanceDelta)
        );
        _payer = address(0);
    }

    function stealPosition(PoolKey memory key, int24 lower, int24 upper, bytes32 salt) external {
        manager.unlock(abi.encode(uint8(1), key, SwapParams(false, 0, 0), msg.sender, lower, upper, salt));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager));
        (
            uint8 kind,
            PoolKey memory key,
            SwapParams memory params,
            address recipient,
            int24 lower,
            int24 upper,
            bytes32 salt
        ) = abi.decode(data, (uint8, PoolKey, SwapParams, address, int24, int24, bytes32));
        if (kind == 1) {
            manager.modifyLiquidity(key, ModifyLiquidityParams(lower, upper, -1, salt), "");
            return "";
        }
        BalanceDelta delta = manager.swap(key, params, "");
        _settle(key.currency0, delta.amount0(), recipient);
        _settle(key.currency1, delta.amount1(), recipient);
        return abi.encode(delta);
    }

    function _settle(Currency currency, int128 delta, address recipient) private {
        if (delta > 0) manager.take(currency, recipient, uint256(int256(delta)));
        if (delta < 0) {
            uint256 amount = uint256(-int256(delta));
            manager.sync(currency);
            IERC20(Currency.unwrap(currency)).safeTransferFrom(_payer, address(manager), amount);
            require(manager.settle() == amount, "exact settlement");
        }
    }
}

contract AnyQuoteLPModuleV1Test is Test {
    using StateLibrary for IPoolManager;

    address private constant ALICE = address(0xA11CE);
    address private constant ADMIN = address(0xAD111);
    uint256 private constant SUPPLY = 1_000_000_000 ether;
    bytes32 private constant LAUNCH = keccak256("real V4 any quote launch");
    bytes32 private constant FAMILY = keccak256("reviewed original author family");
    bytes32 private constant REVISION = keccak256("shared hook revision");

    IPoolManager private manager;
    AnyQuoteSharedHookV1 private hook;
    IAnyQuoteLedgerV1 private ledger;
    AnyQuoteLPHostFixture private host;
    AnyQuoteLPExternalRouter private router;
    AnyQuoteLPTokenFixture private token;
    AnyQuoteLPTokenFixture private quote;
    AnyQuoteLPModuleV1 private engine;
    uint256 private _marketNonce;

    function setUp() public {
        vm.chainId(4663);
        vm.warp(1_800_000_000);
        manager = IPoolManager(deployCode("PoolManager.sol:PoolManager", abi.encode(address(this))));
        host = new AnyQuoteLPHostFixture();
        router = new AnyQuoteLPExternalRouter(manager);
        bytes memory creation =
            bytes.concat(type(AnyQuoteSharedHookV1).creationCode, abi.encode(manager, address(host), ADMIN));
        bytes32 initHash = keccak256(creation);
        uint160 flags = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
        bytes32 salt;
        for (uint256 i;; ++i) {
            salt = bytes32(i);
            address predicted =
                address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(host), salt, initHash)))));
            if (uint160(predicted) & Hooks.ALL_HOOK_MASK == flags) break;
        }
        hook = host.deployHook(creation, salt);
        ledger = IAnyQuoteLedgerV1(hook.ledger());
        _market(true, 18, 120_000);
    }

    function _tokens(bool quote0, uint8 decimals_) private {
        ++_marketNonce;
        AnyQuoteLPTokenFixture implementation = new AnyQuoteLPTokenFixture();
        address primary = address(uint160(0x500000 + _marketNonce));
        address quoted = address(uint160((quote0 ? 0x100000 : 0x900000) + _marketNonce));
        vm.etch(primary, address(implementation).code);
        vm.etch(quoted, address(implementation).code);
        token = AnyQuoteLPTokenFixture(primary);
        quote = AnyQuoteLPTokenFixture(quoted);
        token.setDecimals(18);
        quote.setDecimals(decimals_);
        token.mint(address(host), SUPPLY);
        quote.mint(ALICE, 1e50);
        vm.startPrank(ALICE);
        quote.approve(address(host), type(uint256).max);
        token.approve(address(host), type(uint256).max);
        quote.approve(address(router), type(uint256).max);
        token.approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    function _context() private view returns (T.Context memory) {
        return T.Context(
            address(host),
            keccak256(abi.encode(LAUNCH, _marketNonce)),
            address(token),
            ALICE,
            address(quote),
            address(ledger)
        );
    }

    function _config(int24 tick) private view returns (A.Configuration memory) {
        return A.Configuration(
            A.SCHEMA_ID,
            address(manager),
            address(manager).codehash,
            address(hook),
            address(quote),
            tick,
            uint64(block.timestamp + 180),
            keccak256("bound offchain price evidence")
        );
    }

    function _registration(T.Context memory c, AnyQuoteLPModuleV1 target, bytes memory configuration, int24 tick)
        private
        pure
        returns (A.PoolRegistration memory)
    {
        return A.PoolRegistration(
            c.launchId,
            REVISION,
            FAMILY,
            keccak256(configuration),
            c.token,
            c.quoteAsset,
            address(target),
            tick,
            100,
            200
        );
    }

    function _market(bool quote0, uint8 decimals_, int24 tick) private {
        _tokens(quote0, decimals_);
        T.Context memory c = _context();
        bytes memory config = abi.encode(_config(tick));
        engine = host.deployEngine(c, config);
        host.register(_registration(c, engine, config, tick));
        host.initialize(engine, "");
    }

    function _operation(bool buy, uint256 input, uint256 minimum) private view returns (T.Operation memory) {
        return T.Operation(
            buy ? engine.BUY() : engine.SELL(),
            ALICE,
            ALICE,
            buy ? address(quote) : address(token),
            input,
            buy ? address(token) : address(quote),
            minimum,
            block.timestamp + 180,
            0,
            abi.encode(uint160(0))
        );
    }

    function _trade(bool buy, uint256 input) private returns (uint256) {
        T.Operation memory op = _operation(buy, input, 1);
        vm.prank(ALICE);
        return abi.decode(host.execute(engine, op), (uint256));
    }

    function _externalSwap(bool buy, bool exactInput, uint256 amount) private returns (BalanceDelta) {
        bool zeroForOne = buy == (address(quote) < address(token));
        SwapParams memory params = SwapParams(
            zeroForOne,
            exactInput ? -int256(amount) : int256(amount),
            zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        );
        PoolKey memory key = engine.poolKey();
        vm.prank(ALICE);
        return router.swap(key, params, ALICE);
    }

    function _assertInventory() private view {
        assertEq(token.balanceOf(address(host)), 0, "host retains no primary inventory");
        assertEq(token.balanceOf(address(engine)), engine.lockedTokenDust(), "only permanent dust remains");
        assertEq(quote.balanceOf(address(engine)), 0, "no intermediate quote retained");
        assertEq(quote.balanceOf(address(host)), 0, "host retains no quote");
        assertEq(token.allowance(address(engine), address(host)), 0);
        assertEq(quote.allowance(address(engine), address(host)), 0);
    }

    function _roundTrip(uint256 amount) private {
        assertEq(quote.balanceOf(address(manager)), 0, "no quote reserves before first buy");
        uint256 before = quote.balanceOf(ALICE);
        uint256 out = _trade(true, amount);
        assertGt(out, 0);
        assertEq(token.balanceOf(ALICE), out);
        assertEq(before - quote.balanceOf(ALICE), amount);
        assertEq(ledger.claimableQuote(address(quote), A.PLATFORM_RECIPIENT), amount * 30 / 10_000);
        assertEq(ledger.claimableQuote(address(quote), ALICE), amount * 100 / 10_000);
        uint256 sold = _trade(false, out / 2);
        assertGt(sold, 0);
        _assertInventory();
    }

    function test_realV4_quote0_firstBuyWithNoQuoteReserveAndRoundTrip() public {
        _roundTrip(1 ether);
    }

    function test_realV4_quote1_firstBuyWithNoQuoteReserveAndRoundTrip() public {
        _market(false, 18, -120_000);
        _roundTrip(1 ether);
    }

    function testFuzz_realV4RoundTripPreservesLockedInventory(uint256 amount) public {
        _roundTrip(bound(amount, 10_000, 10_000 ether));
    }

    function testFuzz_initialSignedTickPreservesWholeSupply(int24 ticks, bool quote0, uint8 decimals_) public {
        int24 tick = int24(bound(int256(ticks), -1500, 1500)) * 200;
        _market(quote0, uint8(bound(uint256(decimals_), 0, 36)), tick);
        assertEq(token.balanceOf(address(manager)) + token.balanceOf(address(engine)), SUPPLY);
        assertEq(quote.balanceOf(address(manager)), 0);
        assertGt(engine.lockedLiquidity(), 0);
        assertLt(engine.tickLower(), engine.tickUpper());
        _assertInventory();
    }

    function test_realV4_cheapQuoteSupportsOppositeSignedTicks() public {
        // A quote worth $1e-8 implies about 500 whole quote tokens per primary at a $5,000 initial FDV.
        // With equal decimals that raw ratio needs a negative tick when the quote sorts first.
        _market(true, 18, -62_200);
        _roundTrip(1000 ether);
        _market(false, 18, 62_200);
        _roundTrip(1000 ether);
    }

    function test_realV4_decimals0_6_24_36UseRawRatioTicks() public {
        _market(true, 0, 120_000);
        _roundTrip(1e18);
        _market(false, 6, -120_000);
        _roundTrip(1e18);
        _market(true, 24, 0);
        _roundTrip(1e24);
        _market(false, 36, 0);
        _roundTrip(1e24);
    }

    function test_realV4_externalRouterPaysSameFeesAndEngineIsNotHook() public {
        assertEq(address(engine.poolKey().hooks), address(hook));
        assertTrue(address(engine) != address(hook));
        _externalSwap(true, true, 1 ether);
        assertEq(ledger.claimableQuote(address(quote), A.PLATFORM_RECIPIENT), 0.003 ether);
        assertEq(ledger.claimableQuote(address(quote), ALICE), 0.01 ether);
        uint256 out = token.balanceOf(ALICE);
        assertGt(out, 0);
        _externalSwap(false, true, out / 2);
        assertGt(ledger.claimableQuote(address(quote), A.PLATFORM_RECIPIENT), 0.003 ether);
        _assertInventory();
    }

    function test_realV4_externalExactOutputAlsoPaysHookFees() public {
        _externalSwap(true, false, 1000 ether);
        assertEq(token.balanceOf(ALICE), 1000 ether);
        uint256 platformBuy = ledger.claimableQuote(address(quote), A.PLATFORM_RECIPIENT);
        assertGt(platformBuy, 0);
        uint256 quoteBefore = quote.balanceOf(ALICE);
        _externalSwap(false, false, 1e12);
        assertEq(quote.balanceOf(ALICE) - quoteBefore, 1e12);
        assertGt(ledger.claimableQuote(address(quote), A.PLATFORM_RECIPIENT), platformBuy);
    }

    function test_realV4_coreProtocolFeeDoesNotDisableTrading() public {
        manager.setProtocolFeeController(address(this));
        manager.setProtocolFee(engine.poolKey(), uint24(100));
        _roundTrip(1 ether);
    }

    function test_configurationExpirationDoesNotExpireLivePool() public {
        vm.warp(block.timestamp + 1 days);
        _roundTrip(1 ether);
    }

    function test_liquidityAndRoundingDustRemainLocked() public {
        (uint128 beforeLiquidity,,) = manager.getPositionInfo(
            PoolId.wrap(engine.poolId()),
            address(engine),
            engine.tickLower(),
            engine.tickUpper(),
            engine.POSITION_SALT()
        );
        assertEq(beforeLiquidity, engine.lockedLiquidity());
        _trade(true, 1 ether);
        PoolKey memory key = engine.poolKey();
        int24 lower = engine.tickLower();
        int24 upper = engine.tickUpper();
        bytes32 salt = engine.POSITION_SALT();
        vm.expectRevert();
        router.stealPosition(key, lower, upper, salt);
        (uint128 afterLiquidity,,) = manager.getPositionInfo(
            PoolId.wrap(engine.poolId()),
            address(engine),
            engine.tickLower(),
            engine.tickUpper(),
            engine.POSITION_SALT()
        );
        assertEq(afterLiquidity, beforeLiquidity);
        _assertInventory();
    }

    function test_hostCannotSellLockedDustWithoutNewInput() public {
        _market(true, 18, 600_000);
        uint256 dust = engine.lockedTokenDust();
        assertGt(dust, 0);
        T.Operation memory op = _operation(false, dust, 1);
        vm.expectRevert(AnyQuoteLPModuleV1.InvalidSettlement.selector);
        host.executeUnfunded(engine, op);
        assertEq(token.balanceOf(address(engine)), dust);
    }

    function test_outputMinimumRevertsPoolAndFeeAccounting() public {
        uint256 quoteBefore = quote.balanceOf(ALICE);
        (uint160 priceBefore,,,) = manager.getSlot0(PoolId.wrap(engine.poolId()));
        T.Operation memory op = _operation(true, 1 ether, SUPPLY);
        vm.prank(ALICE);
        vm.expectRevert(AnyQuoteLPModuleV1.InvalidSettlement.selector);
        host.execute(engine, op);
        (uint160 priceAfter,,,) = manager.getSlot0(PoolId.wrap(engine.poolId()));
        assertEq(priceAfter, priceBefore);
        assertEq(quote.balanceOf(ALICE), quoteBefore);
        assertEq(ledger.claimableQuote(address(quote), A.PLATFORM_RECIPIENT), 0);
        _assertInventory();
    }

    function test_taxedQuoteCannotLeavePoolWithUnsettledDebt() public {
        quote.setTax(true);
        T.Operation memory op = _operation(true, 1 ether, 1);
        vm.prank(ALICE);
        vm.expectRevert(AnyQuoteLPModuleV1.InvalidSettlement.selector);
        host.execute(engine, op);
        assertEq(ledger.claimableQuote(address(quote), A.PLATFORM_RECIPIENT), 0);
        assertEq(quote.balanceOf(address(manager)), 0);
    }

    function test_lifecycleAndCallbackAuthorization() public {
        vm.expectRevert(ModuleEngineBaseV1.UnauthorizedHost.selector);
        engine.initialize("");
        vm.expectRevert(ModuleEngineBaseV1.AlreadyInitialized.selector);
        host.initializeAgain(engine);
        vm.expectRevert(AnyQuoteLPModuleV1.UnauthorizedCallback.selector);
        engine.unlockCallback("");
        T.Operation memory op = _operation(true, 1, 1);
        vm.expectRevert(ModuleEngineBaseV1.UnauthorizedHost.selector);
        engine.execute(op);
    }

    function test_configurationRejectsWrongSchemaExpiryDecimalsAndTicks() public {
        _tokens(true, 18);
        T.Context memory c = _context();
        A.Configuration memory config = _config(0);
        config.schemaId = bytes32(uint256(1));
        vm.expectRevert(AnyQuoteLPModuleV1.InvalidConfiguration.selector);
        host.deployEngine(c, abi.encode(config));
        config = _config(0);
        config.validUntil = uint64(block.timestamp - 1);
        vm.expectRevert(AnyQuoteLPModuleV1.DeadlineExpired.selector);
        host.deployEngine(c, abi.encode(config));
        config = _config(1);
        vm.expectRevert(AnyQuoteLPModuleV1.InvalidConfiguration.selector);
        host.deployEngine(c, abi.encode(config));
        config = _config(TickMath.maxUsableTick(200));
        vm.expectRevert(AnyQuoteLPModuleV1.InvalidConfiguration.selector);
        host.deployEngine(c, abi.encode(config));
        quote.setDecimals(37);
        config = _config(0);
        vm.expectRevert(AnyQuoteLPModuleV1.InvalidConfiguration.selector);
        host.deployEngine(c, abi.encode(config));
    }

    function test_registrationMustMatchExactEngineAndConfiguration() public {
        _tokens(false, 18);
        T.Context memory c = _context();
        bytes memory config = abi.encode(_config(-120_000));
        AnyQuoteLPModuleV1 candidate = host.deployEngine(c, config);
        A.PoolRegistration memory registration = _registration(c, candidate, config, -120_000);
        registration.configurationHash = keccak256("different config");
        host.register(registration);
        vm.expectRevert(AnyQuoteLPModuleV1.InvalidPool.selector);
        host.initialize(candidate, "");
        assertEq(token.balanceOf(address(host)), SUPPLY, "failed initialization restores host inventory");
        assertFalse(candidate.initialized());
    }
}
