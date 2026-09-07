// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { IUniswapV3FactoryLikeV3 } from "../../src/StockPairedEthLaunchCoordinatorV3.sol";
import { ModuleEngineHostV1 } from "../../src/module-engine/ModuleEngineHostV1.sol";
import { ModuleQuoteEngineV1 } from "../../src/module-engine/ModuleQuoteEngineV1.sol";
import {
    ModuleQuoteEthConverterV1,
    IModuleV3SwapRouter02V1
} from "../../src/module-engine/ModuleQuoteEthConverterV1.sol";
import { ModuleV3FeeOracleV1 as Oracle, IModuleV3OraclePoolV1 } from "../../src/module-engine/ModuleV3FeeOracleV1.sol";
import { ModuleQuoteEngineTestBase, EngineV3Factory, EngineV3Router } from "./ModuleQuoteEngineV1.t.sol";
import { EngineQuoteToken } from "./ModuleEngineHostV1.t.sol";
import { UniswapV3FactoryFixtureV1 } from "./UniswapV3FactoryFixtureV1.sol";

interface IRealV3Factory is IUniswapV3FactoryLikeV3 {
    function createPool(address a, address b, uint24 fee) external returns (address);
}

interface IRealV3Pool is IModuleV3OraclePoolV1 {
    function initialize(uint160 sqrtPriceX96) external;
    function increaseObservationCardinalityNext(uint16 amount) external;
    function mint(address recipient, int24 lower, int24 upper, uint128 liquidity, bytes calldata data)
        external
        returns (uint256, uint256);
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 limit, bytes calldata data)
        external
        returns (int256, int256);
}

/// @dev Narrow funded swap caller; price, observations, liquidity and transfer callbacks execute in original V3 code.
contract RealV3RouteCaller is IModuleV3SwapRouter02V1 {
    address public immutable factory;
    address public immutable WETH9;
    address private payer;
    address private activePool;

    constructor(address factory_, address weth_) {
        factory = factory_;
        WETH9 = weth_;
    }

    function exactInput(ExactInputParams calldata p) external payable returns (uint256 amountOut) {
        require(msg.value == 0 && payer == address(0) && p.path.length == 43);
        address input;
        address output;
        uint24 fee;
        bytes calldata path = p.path;
        assembly ("memory-safe") {
            input := shr(96, calldataload(path.offset))
            fee := shr(232, calldataload(add(path.offset, 20)))
            output := shr(96, calldataload(add(path.offset, 23)))
        }
        activePool = IRealV3Factory(factory).getPool(input, output, fee);
        payer = msg.sender;
        bool zeroForOne = input < output;
        (int256 amount0, int256 amount1) = IRealV3Pool(activePool)
            .swap(
                p.recipient,
                zeroForOne,
                int256(p.amountIn),
                zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1,
                ""
            );
        require(uint256(zeroForOne ? amount0 : amount1) == p.amountIn);
        amountOut = uint256(-(zeroForOne ? amount1 : amount0));
        require(amountOut >= p.amountOutMinimum);
        payer = address(0);
        activePool = address(0);
    }

    function uniswapV3SwapCallback(int256 amount0, int256 amount1, bytes calldata) external {
        require(msg.sender == activePool && payer != address(0));
        IRealV3Pool pool = IRealV3Pool(msg.sender);
        if (amount0 > 0) require(IERC20(pool.token0()).transferFrom(payer, msg.sender, uint256(amount0)));
        if (amount1 > 0) require(IERC20(pool.token1()).transferFrom(payer, msg.sender, uint256(amount1)));
    }
}

contract ModuleQuoteRealV3Test is ModuleQuoteEngineTestBase {
    bytes32 private constant REAL_REVISION = keccak256("same source real V3 history profile");
    IRealV3Factory private realFactory;
    RealV3RouteCaller private routeCaller;
    address private mintingPool;

    function setUp() public override {
        super.setUp();
        vm.warp(1_800_000_000);
        realFactory = IRealV3Factory(UniswapV3FactoryFixtureV1.deploy());
        routeCaller = new RealV3RouteCaller(address(realFactory), address(weth));
        v3Factory = EngineV3Factory(address(realFactory));
        v3Router = EngineV3Router(address(routeCaller));
        converter = new ModuleQuoteEthConverterV1(routeCaller, weth);
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
        _register(REAL_REVISION, address(0), true);
    }

    function _pool(address asset, uint256 weiPerWholeQuote) private returns (IRealV3Pool pool) {
        pool = IRealV3Pool(realFactory.createPool(asset, address(weth), 500));
        uint256 unit = 10 ** IERC20Metadata(asset).decimals();
        bool quote0 = asset < address(weth);
        uint256 ratio = quote0
            ? FullMath.mulDiv(weiPerWholeQuote, 1 << 128, unit)
            : FullMath.mulDiv(unit, 1 << 128, weiPerWholeQuote);
        uint160 sqrt = uint160(Math.sqrt(ratio) << 32);
        pool.initialize(sqrt);
        pool.increaseObservationCardinalityNext(192);
        uint128 liquidity =
            uint128(quote0 ? FullMath.mulDiv(1000 ether, 1 << 96, sqrt) : FullMath.mulDiv(1000 ether, sqrt, 1 << 96));
        EngineQuoteToken(asset).mint(address(this), 1e30);
        mintingPool = address(pool);
        pool.mint(address(this), -887_270, 887_270, liquidity, "");
        mintingPool = address(0);
        IERC20(asset).approve(address(routeCaller), type(uint256).max);
        IERC20(asset).approve(address(host), type(uint256).max);
    }

    function uniswapV3MintCallback(uint256 amount0, uint256 amount1, bytes calldata) external {
        require(msg.sender == mintingPool);
        IRealV3Pool pool = IRealV3Pool(msg.sender);
        if (amount0 != 0) require(IERC20(pool.token0()).transfer(msg.sender, amount0));
        if (amount1 != 0) require(IERC20(pool.token1()).transfer(msg.sender, amount1));
    }

    function _swap(address asset, uint256 amount) private returns (uint256) {
        return routeCaller.exactInput(
            IModuleV3SwapRouter02V1.ExactInputParams({
                path: abi.encodePacked(asset, uint24(500), address(weth)),
                recipient: address(this),
                amountIn: amount,
                amountOutMinimum: 1
            })
        );
    }

    function test_realPoolHistorySupportsLaterDifferentlyValuedCAWithSameRevisionAndConfig() public {
        _pool(address(quote), 1 ether);
        vm.warp(block.timestamp + 1800);
        _swap(address(quote), 0.1 ether);
        ModuleEngineHostV1.Launch memory first = host.launch(_launchParams(REAL_REVISION, address(quote), 41, 0));
        uint256 firstFees = host.ledger().totalFeesReceived();
        // This CA and its 1000x lower quote value are selected after publication and after the first launch.
        EngineQuoteToken late = new EngineQuoteToken(6);
        _pool(address(late), 0.001 ether);
        vm.warp(block.timestamp + 1800);
        _swap(address(late), 100_000_000);
        ModuleEngineHostV1.Launch memory second = host.launch(_launchParams(REAL_REVISION, address(late), 42, 0));
        uint256 secondFees = host.ledger().totalFeesReceived() - firstFees;
        assertGt(secondFees, 0);
        assertApproxEqRel(firstFees, secondFees * 1000, 0.002 ether);
        assertEq(first.revisionId, second.revisionId);
        assertEq(first.configurationHash, second.configurationHash);
        assertEq(host.fixedConfigurationHash(second.launchId), first.configurationHash);
        assertEq(address(host.ledger()).balance, firstFees + secondFees);
        assertEq(quote.balanceOf(first.engine), 0);
        assertEq(late.balanceOf(second.engine), 0);
    }

    function test_realPoolRequiresWrittenFreshnessAndActualFullHistory() public {
        _pool(address(quote), 1 ether);
        bytes memory path = abi.encodePacked(address(quote), uint24(500), address(weth));
        vm.warp(block.timestamp + 60);
        _swap(address(quote), 0.1 ether);
        vm.expectRevert(bytes("OLD"));
        converter.quoteConversion(address(quote), 0.003 ether, path);
        vm.warp(block.timestamp + 1800);
        _swap(address(quote), 0.1 ether);
        (uint256 floor, uint256 twap,) = converter.quoteConversion(address(quote), 0.003 ether, path);
        assertGt(floor, 0.0029 ether);
        assertGt(twap, floor);
        vm.warp(block.timestamp + 301);
        vm.expectRevert(Oracle.StaleObservation.selector);
        converter.quoteConversion(address(quote), 0.003 ether, path);
    }

    function test_realPoolManipulationAfterPreviewCannotWeakenExecutionFloor() public {
        _pool(address(quote), 1 ether);
        bytes memory path = abi.encodePacked(address(quote), uint24(500), address(weth));
        vm.warp(block.timestamp + 1800);
        _swap(address(quote), 0.1 ether);
        converter.quoteConversion(address(quote), 0.003 ether, path);
        _swap(address(quote), 50 ether);
        quote.approve(address(converter), 1 ether);
        vm.expectRevert(Oracle.OracleDeviation.selector);
        converter.convert(address(quote), 0.003 ether, 1, block.timestamp, path);
        assertEq(quote.balanceOf(address(converter)), 0);
        assertEq(address(converter).balance, 0);
    }
}
