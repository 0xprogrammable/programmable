// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IUniswapV3SwapRouterLikeV3 } from "../../src/StockPairedEthLaunchCoordinatorV3.sol";
import {
    ModuleQuoteEthConverterV1,
    IModuleV3SwapRouter02V1,
    IModuleWethV1
} from "../../src/module-engine/ModuleQuoteEthConverterV1.sol";

/// @dev Opt-in, fixed-block local fork only. The fixture funds its own USDG balance with deal; no broadcast.
contract ModuleQuoteRouter02RobinhoodForkTest is Test {
    uint256 private constant SNAPSHOT_BLOCK = 56_934_125;
    address private constant ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address private constant FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address private constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address private constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    ModuleQuoteEthConverterV1 private converter;

    receive() external payable { }

    function setUp() public {
        string memory rpc = vm.envOr("MODULE_ROUTER02_ROBINHOOD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);
        assertEq(block.chainid, 4663);
        // Orbit's NUMBER opcode exposes the parent L1 height; the fork is selected by the L2 RPC height above.
        assertEq(block.number, 25_926_312);
        assertEq(block.timestamp, 1_788_794_192);
        assertEq(ROUTER.codehash, bytes32(0x6f36c378e272c6324c48f045182bcb54bd8ad654cf9ebd42e8893d52c4cb25dc));
        assertEq(FACTORY.codehash, bytes32(0xec72b1abd1f2faee020cfea9c646bd8994f9fb389054f6e574f103a895091739));
        assertEq(WETH.codehash, bytes32(0x5706be52f64875fee65a2cec0d80e47a23d8793cbe85d214b48445e2d05f5353));
        IModuleV3SwapRouter02V1 router = IModuleV3SwapRouter02V1(ROUTER);
        assertEq(router.factory(), FACTORY);
        assertEq(router.WETH9(), WETH);
        converter = new ModuleQuoteEthConverterV1(router, IModuleWethV1(WETH));
        assertEq(
            address(converter).codehash, bytes32(0xf6ad258e17a89c3159bd8baad134486f11d6bbbcd99a19c5a7267582f38d56ed)
        );
    }

    function test_forkOriginalRouter02ConvertsFundedUsdGToActualEth() public {
        uint256 amount = 1_000_000; // One USDG at the observed six-decimal token contract.
        bytes memory route = abi.encodePacked(USDG, uint24(500), WETH);
        (uint256 floor, uint256 twap,) = converter.quoteConversion(USDG, amount, route);
        assertGt(floor, 0);
        assertGt(twap, floor);
        deal(USDG, address(this), amount);
        IERC20(USDG).approve(address(converter), amount);
        uint256 beforeEth = address(this).balance;
        uint256 received = converter.convert(USDG, amount, floor, block.timestamp, route);
        assertGe(received, floor);
        assertEq(address(this).balance - beforeEth, received);
        assertEq(IERC20(USDG).balanceOf(address(this)), 0);
        assertEq(IERC20(USDG).balanceOf(address(converter)), 0);
        assertEq(IERC20(WETH).balanceOf(address(converter)), 0);
        assertEq(address(converter).balance, 0);
        assertEq(IERC20(USDG).allowance(address(this), address(converter)), 0);
        assertEq(IERC20(USDG).allowance(address(converter), ROUTER), 0);
        emit log_named_uint("qualified minimum ETH", floor);
        emit log_named_uint("actual funded ETH received", received);
    }

    function test_forkOriginalRouter02RejectsTheFormerDeadlineTuple() public {
        assertEq(IModuleV3SwapRouter02V1.exactInput.selector, bytes4(0xb858183f));
        assertEq(IUniswapV3SwapRouterLikeV3.exactInput.selector, bytes4(0xc04b8d59));
        bytes memory data = abi.encodeCall(
            IUniswapV3SwapRouterLikeV3.exactInput,
            (IUniswapV3SwapRouterLikeV3.ExactInputParams(
                    abi.encodePacked(USDG, uint24(500), WETH), address(this), block.timestamp, 1_000_000, 1
                ))
        );
        (bool accepted, bytes memory result) = ROUTER.call(data);
        assertFalse(accepted);
        assertEq(result.length, 0);
    }

    function test_forkExpiredConversionPreservesApprovedFunds() public {
        deal(USDG, address(this), 1_000_000);
        IERC20(USDG).approve(address(converter), 1_000_000);
        vm.expectRevert(ModuleQuoteEthConverterV1.InvalidConversion.selector);
        converter.convert(USDG, 1_000_000, 1, block.timestamp - 1, abi.encodePacked(USDG, uint24(500), WETH));
        assertEq(IERC20(USDG).balanceOf(address(this)), 1_000_000);
        assertEq(IERC20(USDG).allowance(address(this), address(converter)), 1_000_000);
        assertEq(IERC20(USDG).allowance(address(converter), ROUTER), 0);
        assertEq(IERC20(USDG).balanceOf(address(converter)), 0);
        assertEq(address(converter).balance, 0);
    }
}
