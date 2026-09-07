// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
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
import { ModuleQuoteEthConverterV1, IModuleWethV1 } from "../../src/module-engine/ModuleQuoteEthConverterV1.sol";
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

contract EngineV3Pool { }

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
contract EngineV3Router is IUniswapV3SwapRouterLikeV3 {
    address public immutable factory;
    address public immutable WETH9;
    bool public underpay;

    constructor(address factory_, address weth_) {
        factory = factory_;
        WETH9 = weth_;
    }

    function setUnderpay(bool enabled) external {
        underpay = enabled;
    }

    function exactInput(ExactInputParams calldata p) external payable returns (uint256 amount) {
        require(msg.value == 0 && p.deadline >= block.timestamp);
        address input;
        bytes calldata path = p.path;
        assembly ("memory-safe") { input := shr(96, calldataload(path.offset)) }
        IERC20(input).transferFrom(msg.sender, address(this), p.amountIn);
        amount = p.amountIn * 1 ether / (10 ** IERC20Metadata(input).decimals());
        require(amount >= p.amountOutMinimum);
        IERC20(WETH9).transfer(p.recipient, underpay ? amount - 1 : amount);
    }
}

contract ModuleQuoteEngineV1Test is EngineHostTestBase {
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

    function setUp() public {
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
        weth.deposit{ value: 50 ether }();
        v3Factory = new EngineV3Factory();
        v3Router = new EngineV3Router(address(v3Factory), address(weth));
        weth.transfer(address(v3Router), 40 ether);
        converter = new ModuleQuoteEthConverterV1(v3Router, weth);
        v3Factory.setPool(address(quote), address(weth), 500, address(new EngineV3Pool()));
        configuration = abi.encode(
            ModuleQuoteEngineV1.Configuration(
                address(manager),
                address(positionManager),
                address(planner),
                address(forwarderFactory),
                address(converter),
                address(converter).codehash,
                1e10,
                address(0)
            )
        );
        creation = vm.getCode("ModuleQuoteEngineV1.sol:ModuleQuoteEngineV1");
        runtime = vm.getDeployedCode("ModuleQuoteEngineV1.sol:ModuleQuoteEngineV1");
        _register(REVISION, address(0), true);
    }

    function _register(bytes32 id, address fixedQuote, bool paidFamily) private {
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
            _immutableOffsets("ModuleQuoteEngineV1.sol/ModuleQuoteEngineV1", 256);
        bytes32[] memory families = new bytes32[](paidFamily ? 1 : 0);
        if (paidFamily) families[0] = family;
        host.approveRevision(id, revision, offsets, bindings, permissions, families);
    }

    function _launchParams(bytes32 revisionId, address asset, uint256 salt, uint16 creatorFee)
        private
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

    function _mineSalt(ModuleEngineHostV1.LaunchParameters memory p, address token) private view returns (bytes32) {
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
        private
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
        v3Factory.setPool(lateAddress, address(weth), 500, address(new EngineV3Pool()));
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
        assertEq(host.ledger().totalFeesReceived(), 0.006 ether);
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
        vm.expectRevert(ModuleQuoteEthConverterV1.InvalidRoute.selector);
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

    function testFuzz_roundTripRetainsOnlyFundedEthAndNoEngineReserves(uint64 rawInput, uint8 percentage) public {
        uint256 input = bound(uint256(rawInput), 1e12, 5 ether);
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

    receive() external payable { }
}
