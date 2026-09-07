// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { PositionManager } from "@uniswap/v4-periphery/src/PositionManager.sol";
import { StockPairedPositionPlannerV3 } from "../../src/StockPairedPositionPlannerV3.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../../src/LockedPositionFeeForwarderFactoryV1.sol";
import { ModuleEngineHostV1 } from "../../src/module-engine/ModuleEngineHostV1.sol";
import { ModuleQuoteEngineV1 } from "../../src/module-engine/ModuleQuoteEngineV1.sol";
import {
    ModuleQuoteEthConverterV1,
    IModuleWethV1,
    IModuleV3SwapRouter02V1
} from "../../src/module-engine/ModuleQuoteEthConverterV1.sol";
import { ModuleV3FeeOracleV1 as Oracle } from "../../src/module-engine/ModuleV3FeeOracleV1.sol";
import { ModuleEngineTypesV1 as T } from "../../src/module-engine/ModuleEngineTypesV1.sol";
import { IUniswapV3FactoryLikeV3, IUniswapV3SwapRouterLikeV3 } from "../../src/StockPairedEthLaunchCoordinatorV3.sol";
import { EngineHostTestBase, EngineQuoteToken } from "./ModuleEngineHostV1.t.sol";

contract EngineWeth is ERC20, IModuleWethV1 {
    constructor() ERC20("Wrapped ETH", "WETH") { }

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool sent,) = msg.sender.call{ value: amount }("");
        require(sent);
    }
}

/// @dev Deliberately mutable adversarial oracle fixture. Real V3 observations are tested separately.
contract EngineV3Pool {
    address public factory;
    address public token0;
    address public token1;
    uint24 public fee = 500;
    uint128 public liquidity = 1e28;
    uint128 public historicalLiquidity = 1e28;
    uint256 public ethPerQuote;
    int24 public spotTick;
    int24 public longTick;
    int24 public shortTick;
    uint32 public history = 3600;
    uint32 public latestObservation;

    constructor(address factory_, address quote_, address weth_, uint256 ethPerQuote_) {
        factory = factory_;
        token0 = quote_ < weth_ ? quote_ : weth_;
        token1 = quote_ < weth_ ? weth_ : quote_;
        ethPerQuote = ethPerQuote_;
        uint256 unit = 10 ** IERC20Metadata(quote_).decimals();
        uint256 ratio = quote_ < weth_
            ? FullMath.mulDiv(ethPerQuote_, 1 << 128, unit)
            : FullMath.mulDiv(unit, 1 << 128, ethPerQuote_);
        spotTick = TickMath.getTickAtSqrtPrice(uint160(Math.sqrt(ratio) << 32));
        longTick = spotTick;
        shortTick = spotTick;
        latestObservation = uint32(block.timestamp);
    }

    function setOracle(uint32 history_, uint32 latest_, int24 spot_, int24 short_, uint128 historical_) external {
        history = history_;
        latestObservation = latest_;
        spotTick = spot_;
        shortTick = short_;
        historicalLiquidity = historical_;
    }

    function moveSpot(int24 delta) external {
        spotTick += delta;
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (TickMath.getSqrtPriceAtTick(spotTick), spotTick, 1, 2, 192, 0, true);
    }

    function observations(uint256) external view returns (uint32, int56, uint160, bool) {
        return (latestObservation, 0, 0, true);
    }

    function observe(uint32[] calldata windows)
        external
        view
        returns (int56[] memory ticks, uint160[] memory cumulatives)
    {
        require(windows.length == 3 && windows[0] <= history, "OLD");
        ticks = new int56[](3);
        ticks[0] = -int56(longTick) * int56(uint56(windows[0]));
        ticks[1] = -int56(shortTick) * int56(uint56(windows[1]));
        cumulatives = new uint160[](3);
        cumulatives[1] = uint160((uint256(windows[0] - windows[1]) << 128) / historicalLiquidity);
        cumulatives[2] = uint160((uint256(windows[0]) << 128) / historicalLiquidity);
    }
}

contract EngineV3Factory is IUniswapV3FactoryLikeV3 {
    mapping(bytes32 => address) private pools;

    function setPool(address a, address b, uint24 fee, address pool) external {
        pools[_key(a, b, fee)] = pool;
    }

    function getPool(address a, address b, uint24 fee) external view returns (address) {
        return pools[_key(a, b, fee)];
    }

    function _key(address a, address b, uint24 fee) private pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b, fee)) : keccak256(abi.encode(b, a, fee));
    }
}

/// @dev Funded deterministic route fixture, not provider/liquidity evidence: 1 whole quote -> 1 ETH.
contract EngineV3Router is IModuleV3SwapRouter02V1 {
    address public immutable factory;
    address public immutable WETH9;
    bool public underpay;
    bool public tinyOutput;
    int24 public postTickDelta;

    constructor(address factory_, address weth_) {
        factory = factory_;
        WETH9 = weth_;
    }

    function setUnderpay(bool enabled) external {
        underpay = enabled;
    }

    function setAttack(bool tiny, int24 impact) external {
        tinyOutput = tiny;
        postTickDelta = impact;
    }

    function exactInput(ExactInputParams calldata p) external payable returns (uint256 amount) {
        require(msg.value == 0);
        address input;
        bytes calldata path = p.path;
        assembly ("memory-safe") { input := shr(96, calldataload(path.offset)) }
        EngineV3Pool pool = EngineV3Pool(IUniswapV3FactoryLikeV3(factory).getPool(input, WETH9, 500));
        IERC20(input).transferFrom(msg.sender, address(this), p.amountIn);
        amount = tinyOutput ? 1 : p.amountIn * pool.ethPerQuote() / (10 ** IERC20Metadata(input).decimals());
        if (!tinyOutput) require(amount >= p.amountOutMinimum);
        if (postTickDelta != 0) pool.moveSpot(postTickDelta);
        IERC20(WETH9).transfer(p.recipient, underpay ? amount - 1 : amount);
    }
}

abstract contract ModuleQuoteEngineTestBase is EngineHostTestBase {
    using StateLibrary for IPoolManager;
    bytes32 internal constant REVISION = keccak256("external generic quote engine revision");
    bytes32 internal constant BUY = keccak256("spot.buy.exact-input.v1");
    bytes32 internal constant SELL = keccak256("spot.sell.exact-input.v1");
    address internal constant POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    PositionManager internal positionManager;
    StockPairedPositionPlannerV3 internal planner;
    LockedPositionFeeForwarderFactoryV1 internal forwarderFactory;
    ModuleQuoteEthConverterV1 internal converter;
    EngineWeth internal weth;
    EngineV3Router internal v3Router;
    EngineV3Factory internal v3Factory;
    bytes internal configuration;
    bytes internal creation;
    bytes internal runtime;

    function setUp() public virtual {
        _setUpHost();
        deployCodeTo(
            "PositionManager.sol:PositionManager",
            abi.encode(manager, address(0), uint256(0), address(0), address(0)),
            POSITION_MANAGER
        );
        positionManager = PositionManager(payable(POSITION_MANAGER));
        planner = new StockPairedPositionPlannerV3();
        forwarderFactory = new LockedPositionFeeForwarderFactoryV1(positionManager);
        weth = new EngineWeth();
        vm.deal(address(this), 100_000 ether);
        weth.deposit{ value: 50_000 ether }();
        v3Factory = new EngineV3Factory();
        v3Router = new EngineV3Router(address(v3Factory), address(weth));
        weth.transfer(address(v3Router), 10_000 ether);
        converter = new ModuleQuoteEthConverterV1(v3Router, weth);
        _routePool(address(quote), 1 ether);
        configuration = abi.encode(
            ModuleQuoteEngineV1.Configuration(
                address(manager),
                address(positionManager),
                address(planner),
                address(forwarderFactory),
                address(converter),
                address(converter).codehash,
                1e10,
                address(0),
                abi.encodePacked(uint24(500), address(weth))
            )
        );
        creation = vm.getCode("ModuleQuoteEngineV1.sol:ModuleQuoteEngineV1");
        runtime = vm.getDeployedCode("ModuleQuoteEngineV1.sol:ModuleQuoteEngineV1");
        _register(REVISION, address(0), true);
    }

    function _register(bytes32 id, address fixedQuote, bool paidFamily) internal {
        T.Revision memory revision = _revision(creation, runtime, BUY, T.ROLE_PRIMARY | T.ROLE_QUOTE);
        revision.fixedQuoteAsset = fixedQuote;
        // The published package freezes infrastructure, price convention and converter, while Context.quoteAsset stays
        // free.
        revision.fixedConfigurationHash = keccak256(configuration);
        revision.executionGas = 3_000_000;
        T.Permission[] memory permissions = new T.Permission[](2);
        permissions[0] = T.Permission(BUY, T.ROLE_QUOTE, T.ROLE_PRIMARY, T.AUTH_PUBLIC);
        permissions[1] = T.Permission(SELL, T.ROLE_PRIMARY, T.ROLE_QUOTE, T.AUTH_PUBLIC);
        (uint32[] memory offsets, uint32[] memory bindings) =
            _immutableOffsets("ModuleQuoteEngineV1.sol/ModuleQuoteEngineV1", 288);
        bytes32[] memory families = new bytes32[](paidFamily ? 1 : 0);
        if (paidFamily) families[0] = family;
        host.approveRevision(id, revision, offsets, bindings, permissions, families);
    }

    function _routePool(address asset, uint256 ethPerWholeQuote) internal returns (EngineV3Pool pool) {
        pool = new EngineV3Pool(address(v3Factory), asset, address(weth), ethPerWholeQuote);
        weth.transfer(address(pool), 5000 ether);
        v3Factory.setPool(asset, address(weth), 500, address(pool));
    }

    function _launchParams(bytes32 revisionId, address asset, uint256 salt, uint16 creatorFee)
        internal
        view
        returns (ModuleEngineHostV1.LaunchParameters memory p)
    {
        p = _params(revisionId, asset, salt);
        p.configuration = configuration;
        p.creationCode = creation;
        p.runtimeTemplate = runtime;
        p.buyCreatorFeeBps = creatorFee;
        p.sellCreatorFeeBps = creatorFee;
        (address token,) = host.predictTokenAddress(p.name, p.symbol, address(this), p.creatorSalt);
        uint256 amount = 10 ** IERC20Metadata(asset).decimals();
        p.initialOperation = _op(BUY, address(this), asset, amount, token, 1, 0);
        p.initialOperation.data =
            abi.encode(ModuleQuoteEngineV1.TradeLimits(1, 0, abi.encodePacked(asset, uint24(500), address(weth))));
        p.engineSalt = _mineSalt(p, token);
    }

    function _mineSalt(ModuleEngineHostV1.LaunchParameters memory p, address token) internal view returns (bytes32) {
        bytes32 launchId =
            keccak256(abi.encode(block.chainid, address(host), token, p.revisionId, keccak256(p.configuration)));
        T.Context memory context = T.Context(address(host), launchId, token, address(this), p.quoteAsset, address(host));
        bytes32 initHash = keccak256(abi.encodePacked(p.creationCode, abi.encode(context, p.configuration)));
        uint160 required = uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG);
        for (uint256 i; i < 500_000; ++i) {
            uint256 memoryCursor;
            assembly ("memory-safe") { memoryCursor := mload(0x40) }
            bytes32 salt = keccak256(abi.encode(address(this), bytes32(i), launchId));
            address predicted =
                address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(host), salt, initHash)))));
            // Test-only salt search: no temporary allocation escapes this iteration.
            assembly ("memory-safe") { mstore(0x40, memoryCursor) }
            if ((uint160(predicted) & Hooks.ALL_HOOK_MASK) == required) return bytes32(i);
        }
        revert("hook salt unavailable");
    }

    function _trade(ModuleEngineHostV1.Launch memory launched, bool buy, uint256 input, uint256 nonce)
        internal
        view
        returns (T.Operation memory op)
    {
        op = _op(
            buy ? BUY : SELL,
            address(this),
            buy ? launched.quoteAsset : launched.token,
            input,
            buy ? launched.token : launched.quoteAsset,
            1,
            nonce
        );
        op.data = abi.encode(
            ModuleQuoteEngineV1.TradeLimits(1, 0, abi.encodePacked(launched.quoteAsset, uint24(500), address(weth)))
        );
    }

    receive() external payable { }
}

contract ModuleQuoteEngineV1Test is ModuleQuoteEngineTestBase {
    using StateLibrary for IPoolManager;

    function test_atomicInitialBuySellAndActuallyBackedEthClaims() public {
        ModuleEngineHostV1.Launch memory launched = host.launch(_launchParams(REVISION, address(quote), 1, 100));
        ModuleQuoteEngineV1 engine = ModuleQuoteEngineV1(payable(launched.engine));
        uint256 tokens = IERC20(launched.token).balanceOf(address(this));
        assertGt(tokens, 0);
        assertEq(quote.balanceOf(launched.engine), 0);
        assertEq(quote.allowance(launched.engine, address(converter)), 0);
        assertEq(quote.allowance(address(converter), address(v3Router)), 0);
        assertEq(host.ledger().totalFeesReceived(), 0.013 ether);
        assertEq(host.ledger().claimable(treasury), 0.001 ether);
        assertEq(host.ledger().claimable(authorWallet), 0.002 ether);
        assertEq(host.ledger().claimable(address(this)), 0.01 ether);
        assertEq(address(host.ledger()).balance, host.ledger().totalFeesReceived());
        assertEq(positionManager.ownerOf(engine.positionTokenId()), engine.positionRecipient());
        assertGt(positionManager.getPositionLiquidity(engine.positionTokenId()), 0);
        assertEq(IERC20(launched.token).totalSupply(), 1_000_000_000 ether);
        IERC20(launched.token).approve(address(host), tokens);
        uint256 quoteBefore = quote.balanceOf(address(this));
        host.execute(launched.launchId, _trade(launched, false, tokens / 2, 1));
        assertGt(quote.balanceOf(address(this)), quoteBefore);
        assertEq(quote.balanceOf(launched.engine), 0);
        assertEq(IERC20(launched.token).balanceOf(launched.engine), 0);
        assertGt(host.ledger().totalFeesReceived(), 0.013 ether);
        uint256 beforeTreasury = treasury.balance;
        host.ledger().claim(treasury);
        assertGt(treasury.balance, beforeTreasury);
        assertEq(host.ledger().claimable(treasury), 0);
    }

    function test_sameRevisionLateSixDecimalsAndBothAddressSorts() public {
        ModuleEngineHostV1.Launch memory first = host.launch(_launchParams(REVISION, address(quote), 2, 0));
        bool quoteFirst = first.quoteAsset < first.token;
        // The second address is created after review, with no new revision, family or allowlist entry.
        address lateAddress = quoteFirst ? address(type(uint160).max - 1) : address(0x1001);
        deployCodeTo("ModuleEngineHostV1.t.sol:EngineQuoteToken", abi.encode(uint8(6)), lateAddress);
        EngineQuoteToken late = EngineQuoteToken(lateAddress);
        late.mint(address(this), 100_000_000);
        late.approve(address(host), type(uint256).max);
        _routePool(lateAddress, 0.001 ether);
        ModuleEngineHostV1.Launch memory second = host.launch(_launchParams(REVISION, lateAddress, 3, 0));
        ModuleQuoteEngineV1 firstEngine = ModuleQuoteEngineV1(payable(first.engine));
        ModuleQuoteEngineV1 secondEngine = ModuleQuoteEngineV1(payable(second.engine));
        assertTrue((second.quoteAsset < second.token) != quoteFirst);
        assertEq(firstEngine.quoteDecimals(), 18);
        assertEq(secondEngine.quoteDecimals(), 6);
        assertTrue(firstEngine.initialAbsoluteTick() != secondEngine.initialAbsoluteTick());
        assertApproxEqRel(_startPriceX18(firstEngine), 1e10, 0.021 ether);
        assertApproxEqRel(_startPriceX18(secondEngine), 1e10, 0.021 ether);
        assertEq(first.revisionId, second.revisionId);
        assertEq(host.getLaunch(first.launchId).quoteAsset, address(quote));
        assertEq(host.ledger().totalFeesReceived(), 0.003_003 ether);
        uint256 tokens = IERC20(second.token).balanceOf(address(this));
        IERC20(second.token).approve(address(host), tokens);
        host.execute(second.launchId, _trade(second, false, tokens / 2, 1));
        assertEq(late.balanceOf(second.engine), 0);
        assertEq(quote.balanceOf(first.engine), 0);
    }

    function test_plainGenerationUsesTenBpsWithoutInventedAuthorFamily() public {
        bytes32 plainRevision = keccak256("plain host fee profile");
        _register(plainRevision, address(0), false);
        host.launch(_launchParams(plainRevision, address(quote), 1, 0));
        assertEq(host.ledger().totalFeesReceived(), 0.001 ether);
        assertEq(host.ledger().claimable(treasury), 0.001 ether);
        assertEq(host.ledger().claimable(authorWallet), 0);
    }

    function _startPriceX18(ModuleQuoteEngineV1 engine) private view returns (uint256) {
        uint256 sqrt = TickMath.getSqrtPriceAtTick(engine.initialAbsoluteTick());
        uint256 ratioX96 = FullMath.mulDiv(sqrt, sqrt, 1 << 96);
        return FullMath.mulDiv(1e36, 1 << 96, ratioX96 * (10 ** engine.quoteDecimals()));
    }

    function test_failedConversionRollsBackEntireLaunchAndInitialBuy() public {
        ModuleEngineHostV1.LaunchParameters memory p = _launchParams(REVISION, address(quote), 1, 1000);
        (address token,) = host.predictTokenAddress(p.name, p.symbol, address(this), p.creatorSalt);
        v3Router.setUnderpay(true);
        vm.expectRevert(ModuleQuoteEthConverterV1.InvalidConversion.selector);
        host.launch(p);
        assertEq(token.code.length, 0);
        assertEq(host.launchIdOf(token), 0);
        assertEq(quote.balanceOf(address(this)), 1000 ether);
        assertEq(host.ledger().totalFeesReceived(), 0);
    }

    function test_missingFeeRouteCannotCreateQuoteClaimsOrMovePoolState() public {
        ModuleEngineHostV1.Launch memory launched = host.launch(_launchParams(REVISION, address(quote), 1, 0));
        ModuleQuoteEngineV1 engine = ModuleQuoteEngineV1(payable(launched.engine));
        (uint160 beforePrice,,,) = manager.getSlot0(PoolId.wrap(engine.poolId()));
        uint256 fees = host.ledger().totalFeesReceived();
        uint256 quoteBefore = quote.balanceOf(address(this));
        T.Operation memory buy = _trade(launched, true, 1 ether, 1);
        buy.data = abi.encode(ModuleQuoteEngineV1.TradeLimits(1, 0, hex"1234"));
        vm.expectRevert(ModuleQuoteEngineV1.InvalidConversion.selector);
        host.execute(launched.launchId, buy);
        (uint160 afterPrice,,,) = manager.getSlot0(PoolId.wrap(engine.poolId()));
        assertEq(beforePrice, afterPrice);
        assertEq(host.nonces(launched.launchId, address(this)), 1);
        assertEq(host.ledger().totalFeesReceived(), fees);
        assertEq(quote.balanceOf(address(this)), quoteBefore);
    }

    function test_otherRouterCannotBypassFees() public {
        ModuleEngineHostV1.Launch memory launched = host.launch(_launchParams(REVISION, address(quote), 1, 0));
        ModuleQuoteEngineV1 engine = ModuleQuoteEngineV1(payable(launched.engine));
        PoolSwapTest router = new PoolSwapTest(manager);
        quote.approve(address(router), 1 ether);
        bool quote0 = launched.quoteAsset < launched.token;
        PoolKey memory key = engine.poolKey();
        vm.expectRevert();
        router.swap(
            key,
            SwapParams(quote0, -int256(1 ether), quote0 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
        assertEq(host.ledger().totalFeesReceived(), 0.003 ether);
    }

    function test_fixedQuoteOverrideAndDependencyOverrideRejectedByHost() public {
        bytes32 fixedRevision = keccak256("fixed generic quote template");
        _register(fixedRevision, address(quote), true);
        ModuleEngineHostV1.LaunchParameters memory p = _launchParams(fixedRevision, address(quote), 1, 0);
        host.launch(p);
        p.creatorSalt = bytes32(uint256(2));
        p.quoteAsset = address(new EngineQuoteToken(18));
        vm.expectRevert(ModuleEngineHostV1.FixedValueOverride.selector);
        host.launch(p);
        p.quoteAsset = address(quote);
        p.configuration[0] = bytes1(uint8(p.configuration[0]) ^ 1);
        vm.expectRevert(ModuleEngineHostV1.FixedValueOverride.selector);
        host.launch(p);
    }

    function test_converterDirectWethUnwrapUsesActualFunding() public {
        weth.approve(address(converter), 1 ether);
        uint256 beforeBalance = address(this).balance;
        uint256 received = converter.convert(address(weth), 1 ether, 1 ether, block.timestamp, "");
        assertEq(received, 1 ether);
        assertEq(address(this).balance - beforeBalance, 1 ether);
        assertEq(weth.balanceOf(address(converter)), 0);
    }

    function test_router02SelectorAndConverterDeadlineAreEnforcedBeforeFundsMove() public {
        assertEq(IModuleV3SwapRouter02V1.exactInput.selector, bytes4(0xb858183f));
        bytes memory route = abi.encodePacked(address(quote), uint24(500), address(weth));
        (bool legacyAccepted,) = address(v3Router)
            .call(
                abi.encodeCall(
                    IUniswapV3SwapRouterLikeV3.exactInput,
                    (IUniswapV3SwapRouterLikeV3.ExactInputParams(route, address(this), block.timestamp, 1, 1))
                )
            );
        assertFalse(legacyAccepted);
        quote.approve(address(converter), 0.003 ether);
        uint256 quoteBefore = quote.balanceOf(address(this));
        uint256 routerBefore = quote.balanceOf(address(v3Router));
        vm.expectRevert(ModuleQuoteEthConverterV1.InvalidConversion.selector);
        converter.convert(address(quote), 0.003 ether, 1, block.timestamp - 1, route);
        assertEq(quote.balanceOf(address(this)), quoteBefore);
        assertEq(quote.balanceOf(address(v3Router)), routerBefore);
        assertEq(quote.balanceOf(address(converter)), 0);
        assertEq(quote.allowance(address(converter), address(v3Router)), 0);
        assertEq(quote.allowance(address(this), address(converter)), 0.003 ether);

        uint256 ethBefore = address(this).balance;
        uint256 received = converter.convert(address(quote), 0.003 ether, 1, block.timestamp, route);
        assertEq(received, 0.003 ether);
        assertEq(address(this).balance - ethBefore, received);
        assertEq(quote.balanceOf(address(this)), quoteBefore - 0.003 ether);
        assertEq(quote.allowance(address(converter), address(v3Router)), 0);
    }

    function test_predeployedCanonicalPositionLockDoesNotGriefLaunch() public {
        ModuleEngineHostV1.LaunchParameters memory p = _launchParams(REVISION, address(quote), 1, 0);
        (address token,) = host.predictTokenAddress(p.name, p.symbol, address(this), p.creatorSalt);
        bytes32 launchId =
            keccak256(abi.encode(block.chainid, address(host), token, p.revisionId, keccak256(configuration)));
        address predeployed = address(forwarderFactory.deploy(launchId, address(this)));
        ModuleEngineHostV1.Launch memory launched = host.launch(p);
        ModuleQuoteEngineV1 engine = ModuleQuoteEngineV1(payable(launched.engine));
        assertEq(engine.positionRecipient(), predeployed);
        assertEq(positionManager.ownerOf(engine.positionTokenId()), predeployed);
    }

    function test_insufficientEthLiquidityAndSlippageRollBackState() public {
        ModuleEngineHostV1.Launch memory launched = host.launch(_launchParams(REVISION, address(quote), 1, 1000));
        uint256 quoteBefore = quote.balanceOf(address(this));
        uint256 feesBefore = host.ledger().totalFeesReceived();
        T.Operation memory buy = _trade(launched, true, 1 ether, 1);
        buy.minimumOutput = type(uint128).max;
        vm.expectRevert(ModuleQuoteEngineV1.InvalidSettlement.selector);
        host.execute(launched.launchId, buy);
        assertEq(quote.balanceOf(address(this)), quoteBefore);
        assertEq(host.ledger().totalFeesReceived(), feesBefore);
        buy.minimumOutput = 1;
        uint256 routerBalance = weth.balanceOf(address(v3Router));
        vm.prank(address(v3Router));
        weth.transfer(address(this), routerBalance);
        vm.expectRevert();
        host.execute(launched.launchId, buy);
        assertEq(host.nonces(launched.launchId, address(this)), 1);
        assertEq(quote.balanceOf(address(this)), quoteBefore);
        assertEq(host.ledger().totalFeesReceived(), feesBefore);
        assertEq(quote.balanceOf(launched.engine), 0);
    }

    function test_splitFeesAcrossActorsMatchCombinedForZeroOneAndTwoDecimals() public {
        for (uint8 decimals; decimals <= 2; ++decimals) {
            EngineQuoteToken asset = new EngineQuoteToken(decimals);
            asset.mint(address(this), 10_000);
            asset.mint(alice, 10_000);
            asset.approve(address(host), type(uint256).max);
            vm.prank(alice);
            asset.approve(address(host), type(uint256).max);
            _routePool(address(asset), 1 ether);
            ModuleEngineHostV1.Launch memory split =
                host.launch(_launchParams(REVISION, address(asset), 10 + decimals, 0));
            ModuleEngineHostV1.Launch memory combined =
                host.launch(_launchParams(REVISION, address(asset), 20 + decimals, 0));
            uint256 beforeFees = host.ledger().totalFeesReceived();
            for (uint256 i; i < 10; ++i) {
                address actor = i % 2 == 0 ? address(this) : alice;
                T.Operation memory op = _trade(split, true, 100, host.nonces(split.launchId, actor));
                op.actor = actor;
                op.recipient = actor;
                vm.prank(actor);
                host.execute(split.launchId, op);
            }
            uint256 splitFees = host.ledger().totalFeesReceived() - beforeFees;
            beforeFees = host.ledger().totalFeesReceived();
            host.execute(combined.launchId, _trade(combined, true, 1000, 1));
            assertEq(splitFees, host.ledger().totalFeesReceived() - beforeFees);
            assertEq(splitFees, 3 ether / (10 ** decimals));
            (uint16 splitCarry, uint16 creatorCarry) =
                ModuleQuoteEngineV1(payable(split.engine)).quoteFeeRemainders(true);
            (uint16 combinedCarry,) = ModuleQuoteEngineV1(payable(combined.engine)).quoteFeeRemainders(true);
            assertEq(splitCarry, combinedCarry);
            assertEq(creatorCarry, 0);
            (uint16 untouchedSellCarry,) = ModuleQuoteEngineV1(payable(split.engine)).quoteFeeRemainders(false);
            assertEq(untouchedSellCarry, 0);
        }
    }

    function test_coincidentCarriesCannotChargeTwoRawFeesFromOneRawInput() public {
        ModuleEngineHostV1.LaunchParameters memory p = _launchParams(REVISION, address(quote), 30, 1000);
        p.initialOperation.inputAmount = 9999;
        ModuleEngineHostV1.Launch memory launched = host.launch(p);
        ModuleQuoteEngineV1 engine = ModuleQuoteEngineV1(payable(launched.engine));
        (uint16 platformCarry, uint16 creatorCarry) = engine.quoteFeeRemainders(true);
        assertEq(platformCarry, 9970);
        assertEq(creatorCarry, 9000);
        uint256 before = quote.balanceOf(address(this));
        uint256 fees = host.ledger().totalFeesReceived();
        T.Operation memory tiny = _trade(launched, true, 1, 1);
        vm.expectRevert(ModuleQuoteEngineV1.InvalidSettlement.selector);
        host.execute(launched.launchId, tiny);
        assertEq(quote.balanceOf(address(this)), before);
        assertEq(host.ledger().totalFeesReceived(), fees);
        assertEq(host.nonces(launched.launchId, address(this)), 1);
        (uint16 platformAfter, uint16 creatorAfter) = engine.quoteFeeRemainders(true);
        assertEq(platformAfter, platformCarry);
        assertEq(creatorAfter, creatorCarry);
        tiny.inputAmount = 10;
        host.execute(launched.launchId, tiny);
        assertEq(host.ledger().totalFeesReceived(), fees + 2);
    }

    function test_tinyEthPlatformFractionsAccumulateWithoutChangingQuoteShares() public {
        _routePool(address(quote), 0.019_418 ether);
        ModuleEngineHostV1.LaunchParameters memory p = _launchParams(REVISION, address(quote), 31, 1000);
        p.initialOperation.inputAmount = 1000;
        ModuleEngineHostV1.Launch memory launched = host.launch(p);
        for (uint256 i = 1; i < 18; ++i) {
            host.execute(launched.launchId, _trade(launched, true, 1000, i));
        }
        assertEq(host.ledger().totalFeesReceived(), 36);
        assertEq(host.ledger().claimable(address(this)), 35, "one platform wei survives repeated 3:100 allocations");
        assertGt(ModuleQuoteEngineV1(payable(launched.engine)).platformEthRemainderX128(true), 0);
        assertEq(ModuleQuoteEngineV1(payable(launched.engine)).platformEthRemainderX128(false), 0);
        assertEq(address(host.ledger()).balance, 36);
        assertEq(launched.engine.balance, 0);
        for (uint256 i = 18; i < 37; ++i) {
            host.execute(launched.launchId, _trade(launched, true, i % 2 == 0 ? 1010 : 1000, i));
        }
        assertEq(host.ledger().totalFeesReceived(), 74);
        assertEq(host.ledger().claimable(address(this)), 72, "carry follows changing 3:100 and 3:101 quote proportions");
        assertEq(address(host.ledger()).balance, 74);
        uint128 carry = ModuleQuoteEngineV1(payable(launched.engine)).platformEthRemainderX128(true);
        T.Operation memory failing = _trade(launched, true, 1010, 37);
        failing.minimumOutput = type(uint128).max;
        vm.expectRevert(ModuleQuoteEngineV1.InvalidSettlement.selector);
        host.execute(launched.launchId, failing);
        assertEq(ModuleQuoteEngineV1(payable(launched.engine)).platformEthRemainderX128(true), carry);
        assertEq(host.ledger().totalFeesReceived(), 74);
        assertEq(host.nonces(launched.launchId, address(this)), 37);
    }

    function test_sellCarriesUseActualGrossOutputAndCannotConsumeBuyCarries() public {
        ModuleEngineHostV1.Launch memory launched = host.launch(_launchParams(REVISION, address(quote), 40, 1000));
        host.execute(launched.launchId, _trade(launched, true, 9999, 1));
        ModuleQuoteEngineV1 engine = ModuleQuoteEngineV1(payable(launched.engine));
        (uint16 buyPlatform, uint16 buyCreator) = engine.quoteFeeRemainders(true);
        IERC20 token = IERC20(launched.token);
        uint256 tokens = token.balanceOf(address(this));
        token.transfer(alice, tokens / 2);
        token.approve(address(host), type(uint256).max);
        vm.prank(alice);
        token.approve(address(host), type(uint256).max);
        uint256 feesBefore = host.ledger().totalFeesReceived();
        uint256 grossOutput = _sellAcrossActors(launched, tokens / 16);
        assertEq(
            host.ledger().totalFeesReceived() - feesBefore, grossOutput * 30 / 10_000 + grossOutput * 1000 / 10_000
        );
        (uint16 sellPlatform, uint16 sellCreator) = engine.quoteFeeRemainders(false);
        assertEq(sellPlatform, mulmod(grossOutput, 30, 10_000));
        assertEq(sellCreator, mulmod(grossOutput, 1000, 10_000));
        (uint16 afterBuyPlatform, uint16 afterBuyCreator) = engine.quoteFeeRemainders(true);
        assertEq(afterBuyPlatform, buyPlatform);
        assertEq(afterBuyCreator, buyCreator);
    }

    function _sellAcrossActors(ModuleEngineHostV1.Launch memory launched, uint256 chunk)
        private
        returns (uint256 grossOutput)
    {
        for (uint256 i; i < 7; ++i) {
            address actor = i % 2 == 0 ? address(this) : alice;
            T.Operation memory op = _trade(launched, false, chunk, host.nonces(launched.launchId, actor));
            op.actor = actor;
            op.recipient = actor;
            vm.prank(actor);
            bytes memory result = host.execute(launched.launchId, op);
            (, uint256 gross,,,) = abi.decode(result, (uint256, uint256, uint256, uint256, uint256));
            grossOutput += gross;
        }
    }

    function test_userCannotReplacePinnedRouteOrLowerTheIndependentEthFloor() public {
        ModuleEngineHostV1.Launch memory launched = host.launch(_launchParams(REVISION, address(quote), 32, 0));
        T.Operation memory op = _trade(launched, true, 1 ether, 1);
        op.data = abi.encode(
            ModuleQuoteEngineV1.TradeLimits(
                1, 0, abi.encodePacked(address(quote), uint24(500), address(0x1234), uint24(500), address(weth))
            )
        );
        uint256 balance = quote.balanceOf(address(this));
        uint256 fees = host.ledger().totalFeesReceived();
        vm.expectRevert(ModuleQuoteEngineV1.InvalidConversion.selector);
        host.execute(launched.launchId, op);
        op = _trade(launched, true, 1 ether, 1);
        v3Router.setAttack(true, 0);
        vm.expectRevert(ModuleQuoteEthConverterV1.InvalidConversion.selector);
        host.execute(launched.launchId, op);
        assertEq(quote.balanceOf(address(this)), balance);
        assertEq(host.ledger().totalFeesReceived(), fees);
        assertEq(host.nonces(launched.launchId, address(this)), 1);
        (uint16 carry,) = ModuleQuoteEngineV1(payable(launched.engine)).quoteFeeRemainders(true);
        assertEq(carry, 0);
    }

    function test_oracleRejectsYoungStaleThinDivergentAndExcessiveImpactPools() public {
        ModuleEngineHostV1.Launch memory launched = host.launch(_launchParams(REVISION, address(quote), 33, 0));
        EngineV3Pool pool = EngineV3Pool(v3Factory.getPool(address(quote), address(weth), 500));
        int24 tick = pool.longTick();
        T.Operation memory op = _trade(launched, true, 1 ether, 1);
        pool.setOracle(100, uint32(block.timestamp), tick, tick, 1e28);
        vm.expectRevert(bytes("OLD"));
        host.execute(launched.launchId, op);
        vm.warp(block.timestamp + 301);
        pool.setOracle(3600, uint32(block.timestamp - 301), tick, tick, 1e28);
        vm.expectRevert(Oracle.StaleObservation.selector);
        host.execute(launched.launchId, op);
        pool.setOracle(3600, uint32(block.timestamp), tick, tick, 1);
        vm.expectRevert(Oracle.InsufficientLiquidity.selector);
        host.execute(launched.launchId, op);
        pool.setOracle(3600, uint32(block.timestamp), tick + 101, tick, 1e28);
        vm.expectRevert(Oracle.OracleDeviation.selector);
        host.execute(launched.launchId, op);
        pool.setOracle(3600, uint32(block.timestamp), tick, tick + 51, 1e28);
        vm.expectRevert(Oracle.OracleDeviation.selector);
        host.execute(launched.launchId, op);
        pool.setOracle(3600, uint32(block.timestamp), tick, tick, 1e28);
        v3Router.setAttack(false, 26);
        vm.expectRevert(Oracle.ExcessiveImpact.selector);
        host.execute(launched.launchId, op);
        assertEq(pool.spotTick(), tick, "failed swap restores pool state");
        assertEq(host.nonces(launched.launchId, address(this)), 1);
        v3Router.setAttack(false, 0);
        uint256 poolBalance = weth.balanceOf(address(pool));
        vm.prank(address(pool));
        weth.transfer(address(this), poolBalance - 10 ether);
        op.inputAmount = 5 ether;
        vm.expectRevert(Oracle.ExcessiveNotional.selector);
        host.execute(launched.launchId, op);
    }

    function test_unfixedQuoteSafetyConfigurationCannotInitialize() public {
        bytes32 unfixed = keccak256("unfixed unsafe quote configuration");
        T.Revision memory revision = _revision(creation, runtime, BUY, T.ROLE_PRIMARY | T.ROLE_QUOTE);
        T.Permission[] memory permissions = new T.Permission[](1);
        permissions[0] = T.Permission(BUY, T.ROLE_QUOTE, T.ROLE_PRIMARY, T.AUTH_PUBLIC);
        (uint32[] memory offsets, uint32[] memory bindings) =
            _immutableOffsets("ModuleQuoteEngineV1.sol/ModuleQuoteEngineV1", 288);
        host.approveRevision(unfixed, revision, offsets, bindings, permissions, new bytes32[](0));
        ModuleEngineHostV1.LaunchParameters memory p = _launchParams(unfixed, address(quote), 34, 0);
        vm.expectRevert(ModuleQuoteEngineV1.InvalidConfiguration.selector);
        host.launch(p);
    }

    function testFuzz_roundTripRetainsOnlyFundedEthAndNoEngineReserves(uint64 rawInput, uint8 percentage) public {
        uint256 input = bound(uint256(rawInput), 1, 5 ether);
        uint16 creatorFee = uint16(bound(uint256(percentage), 0, 10)) * 100;
        ModuleEngineHostV1.Launch memory launched = host.launch(_launchParams(REVISION, address(quote), 1, creatorFee));
        host.execute(launched.launchId, _trade(launched, true, input, 1));
        uint256 tokens = IERC20(launched.token).balanceOf(address(this));
        IERC20(launched.token).approve(address(host), tokens);
        host.execute(launched.launchId, _trade(launched, false, tokens / 2, 2));
        assertEq(address(host.ledger()).balance, host.ledger().totalFeesReceived());
        assertLe(host.ledger().totalCredited(), host.ledger().totalFeesReceived());
        assertEq(quote.balanceOf(launched.engine), 0);
        assertEq(IERC20(launched.token).balanceOf(launched.engine), 0);
        assertEq(launched.engine.balance, 0);
        assertEq(quote.balanceOf(address(converter)), 0);
        assertEq(weth.balanceOf(address(converter)), 0);
        assertEq(address(converter).balance, 0);
        assertEq(quote.allowance(launched.engine, address(converter)), 0);
        assertEq(quote.allowance(address(converter), address(v3Router)), 0);
    }
}
