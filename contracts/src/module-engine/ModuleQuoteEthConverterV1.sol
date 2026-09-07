// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IUniswapV3FactoryLikeV3, IUniswapV3SwapRouterLikeV3 } from "../StockPairedEthLaunchCoordinatorV3.sol";

interface IModuleQuoteEthConverterV1 {
    function convert(address quoteAsset, uint256 quoteAmount, uint256 minimumEth, uint256 deadline, bytes calldata data)
        external
        returns (uint256 ethAmount);
}

interface IModuleWethV1 is IERC20 {
    function withdraw(uint256 amount) external;
}

/// @notice Generic, atomic quote-to-ETH conversion using the existing V3 SwapRouter ABI.
/// @dev A route is an operation input, not an asset/ticker allowlist. It must begin at quoteAsset and end at WETH.
///      No owner, route setter, subsidies, retained user reserves or persistent allowances.
contract ModuleQuoteEthConverterV1 is IModuleQuoteEthConverterV1, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;
    using Address for address payable;

    IUniswapV3SwapRouterLikeV3 public immutable router;
    IUniswapV3FactoryLikeV3 public immutable factory;
    IModuleWethV1 public immutable weth;
    bytes32 public immutable routerCodeHash;
    bytes32 public immutable factoryCodeHash;
    bytes32 public immutable wethCodeHash;

    error InvalidDependency();
    error InvalidRoute();
    error InvalidConversion();
    error UnauthorizedNativeSender();

    constructor(IUniswapV3SwapRouterLikeV3 router_, IModuleWethV1 weth_) {
        if (address(router_).code.length == 0 || address(weth_).code.length == 0 || router_.WETH9() != address(weth_)) {
            revert InvalidDependency();
        }
        address factory_ = router_.factory();
        if (factory_.code.length == 0) revert InvalidDependency();
        router = router_;
        factory = IUniswapV3FactoryLikeV3(factory_);
        weth = weth_;
        routerCodeHash = address(router_).codehash;
        factoryCodeHash = factory_.codehash;
        wethCodeHash = address(weth_).codehash;
    }

    receive() external payable {
        if (msg.sender != address(weth)) revert UnauthorizedNativeSender();
    }

    function convert(address quoteAsset, uint256 quoteAmount, uint256 minimumEth, uint256 deadline, bytes calldata data)
        external
        nonReentrant
        returns (uint256 ethAmount)
    {
        if (
            quoteAmount == 0 || minimumEth == 0 || deadline < block.timestamp
                || address(router).codehash != routerCodeHash || address(factory).codehash != factoryCodeHash
                || address(weth).codehash != wethCodeHash
        ) revert InvalidConversion();
        if (quoteAsset == address(weth)) return _unwrapQuote(quoteAmount, minimumEth, data);
        _validateRoute(quoteAsset, data);
        IERC20 quote = IERC20(quoteAsset);
        uint256 beforeQuote = quote.balanceOf(address(this));
        uint256 beforeWeth = weth.balanceOf(address(this));
        uint256 beforeEth = address(this).balance;
        quote.safeTransferFrom(msg.sender, address(this), quoteAmount);
        if (quote.balanceOf(address(this)) - beforeQuote != quoteAmount) revert InvalidConversion();
        quote.forceApprove(address(router), quoteAmount);
        ethAmount = router.exactInput(
            IUniswapV3SwapRouterLikeV3.ExactInputParams({
                path: data,
                recipient: address(this),
                deadline: deadline,
                amountIn: quoteAmount,
                amountOutMinimum: minimumEth
            })
        );
        quote.forceApprove(address(router), 0);
        if (
            ethAmount < minimumEth || weth.balanceOf(address(this)) - beforeWeth != ethAmount
                || quote.balanceOf(address(this)) != beforeQuote
        ) revert InvalidConversion();
        weth.withdraw(ethAmount);
        if (address(this).balance - beforeEth != ethAmount || weth.balanceOf(address(this)) != beforeWeth) {
            revert InvalidConversion();
        }
        payable(msg.sender).sendValue(ethAmount);
        if (address(this).balance != beforeEth) revert InvalidConversion();
    }

    function _unwrapQuote(uint256 quoteAmount, uint256 minimumEth, bytes calldata data) private returns (uint256) {
        if (data.length != 0 || quoteAmount < minimumEth) revert InvalidRoute();
        uint256 beforeWeth = weth.balanceOf(address(this));
        uint256 beforeEth = address(this).balance;
        IERC20(address(weth)).safeTransferFrom(msg.sender, address(this), quoteAmount);
        if (weth.balanceOf(address(this)) - beforeWeth != quoteAmount) revert InvalidConversion();
        weth.withdraw(quoteAmount);
        if (address(this).balance - beforeEth != quoteAmount || weth.balanceOf(address(this)) != beforeWeth) {
            revert InvalidConversion();
        }
        payable(msg.sender).sendValue(quoteAmount);
        if (address(this).balance != beforeEth) revert InvalidConversion();
        return quoteAmount;
    }

    function _validateRoute(address quoteAsset, bytes calldata path) private view {
        if (path.length < 43 || path.length > 112 || (path.length - 20) % 23 != 0 || quoteAsset == address(weth)) {
            revert InvalidRoute();
        }
        address first;
        address last;
        assembly ("memory-safe") {
            first := shr(96, calldataload(path.offset))
            last := shr(96, calldataload(add(path.offset, sub(path.length, 20))))
        }
        if (first != quoteAsset || last != address(weth)) revert InvalidRoute();
        for (uint256 offset; offset + 43 <= path.length; offset += 23) {
            address tokenIn;
            address tokenOut;
            uint24 fee;
            assembly ("memory-safe") {
                tokenIn := shr(96, calldataload(add(path.offset, offset)))
                fee := shr(232, calldataload(add(add(path.offset, offset), 20)))
                tokenOut := shr(96, calldataload(add(add(path.offset, offset), 23)))
            }
            if (tokenIn == tokenOut || factory.getPool(tokenIn, tokenOut, fee).code.length == 0) revert InvalidRoute();
        }
    }
}
