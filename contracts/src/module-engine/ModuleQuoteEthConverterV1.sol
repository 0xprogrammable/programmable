// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IUniswapV3FactoryLikeV3 } from "../StockPairedEthLaunchCoordinatorV3.sol";
import { LiquidityGrowthFullRangePolicyV3 as Policy } from "../LiquidityGrowthFullRangePolicyV3.sol";
import { ModuleV3FeeOracleV1 as Oracle, IModuleV3OraclePoolV1 } from "./ModuleV3FeeOracleV1.sol";

interface IModuleQuoteEthConverterV1 {
    function weth() external view returns (IModuleWethV1);
    function quoteConversion(address quoteAsset, uint256 quoteAmount, bytes calldata route)
        external
        view
        returns (uint256 minimumEth, uint256 twapEth, bytes32 observationHash);
    function convert(address quoteAsset, uint256 quoteAmount, uint256 minimumEth, uint256 deadline, bytes calldata data)
        external
        returns (uint256 ethAmount);
}

interface IModuleWethV1 is IERC20 {
    function withdraw(uint256 amount) external;
}

/// @dev SwapRouter02 V3 exactInput has no deadline field. The converter enforces its deadline before any transfer.
interface IModuleV3SwapRouter02V1 {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function factory() external view returns (address);
    function WETH9() external view returns (address);
    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}

/// @notice Generic, atomic quote-to-ETH conversion using the SwapRouter02 V3 exactInput ABI.
/// @dev The engine binds the direct Quote/WETH route in its reviewed configuration. This converter independently
///      derives the fee-sale floor from that pool's qualified history. No owner, oracle updater or per-CA list.
contract ModuleQuoteEthConverterV1 is IModuleQuoteEthConverterV1, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;
    using Address for address payable;

    IModuleV3SwapRouter02V1 public immutable router;
    IUniswapV3FactoryLikeV3 public immutable factory;
    IModuleWethV1 public immutable override weth;
    bytes32 public immutable routerCodeHash;
    bytes32 public immutable factoryCodeHash;
    bytes32 public immutable wethCodeHash;
    uint32 public constant TWAP_WINDOW = uint32(Policy.TWAP_WINDOW);
    uint32 public constant SHORT_TWAP_WINDOW = uint32(Policy.SHORT_TWAP_WINDOW);
    uint256 public constant MIN_WETH_DEPTH = Oracle.MIN_WETH_DEPTH;
    uint256 public constant MAX_NOTIONAL_BPS = Oracle.MAX_NOTIONAL_BPS;

    error InvalidDependency();
    error InvalidRoute();
    error InvalidConversion();
    error UnauthorizedNativeSender();

    event FeeConversionObserved(
        address indexed quoteAsset,
        address indexed pool,
        bytes32 observationHash,
        uint256 quoteAmount,
        uint256 minimumEth,
        uint256 receivedEth
    );

    constructor(IModuleV3SwapRouter02V1 router_, IModuleWethV1 weth_) {
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

    function quoteConversion(address quoteAsset, uint256 quoteAmount, bytes calldata route)
        external
        view
        returns (uint256 minimumEth, uint256 twapEth, bytes32 observationHash)
    {
        _checkDependencies();
        if (quoteAmount == 0) revert InvalidConversion();
        if (quoteAsset == address(weth)) {
            if (route.length != 0) revert InvalidRoute();
            return
                (quoteAmount, quoteAmount, keccak256(abi.encode(block.chainid, address(this), quoteAsset, quoteAmount)));
        }
        Oracle.Snapshot memory s = _quote(quoteAsset, quoteAmount, route);
        return (s.minimumEth, s.twapEth, s.observationHash);
    }

    function convert(address quoteAsset, uint256 quoteAmount, uint256 minimumEth, uint256 deadline, bytes calldata data)
        external
        nonReentrant
        returns (uint256 ethAmount)
    {
        if (quoteAmount == 0 || deadline < block.timestamp) revert InvalidConversion();
        _checkDependencies();
        if (quoteAsset == address(weth)) return _unwrapQuote(quoteAmount, minimumEth, data);
        Oracle.Snapshot memory observed = _quote(quoteAsset, quoteAmount, data);
        minimumEth = Math.max(minimumEth, observed.minimumEth);
        IERC20 quote = IERC20(quoteAsset);
        uint256 beforeQuote = quote.balanceOf(address(this));
        uint256 beforeWeth = weth.balanceOf(address(this));
        uint256 beforeEth = address(this).balance;
        quote.safeTransferFrom(msg.sender, address(this), quoteAmount);
        if (quote.balanceOf(address(this)) - beforeQuote != quoteAmount) revert InvalidConversion();
        quote.forceApprove(address(router), quoteAmount);
        ethAmount = router.exactInput(
            IModuleV3SwapRouter02V1.ExactInputParams({
                path: data, recipient: address(this), amountIn: quoteAmount, amountOutMinimum: minimumEth
            })
        );
        quote.forceApprove(address(router), 0);
        if (
            ethAmount < minimumEth || weth.balanceOf(address(this)) - beforeWeth != ethAmount
                || quote.balanceOf(address(this)) != beforeQuote
        ) revert InvalidConversion();
        Oracle.afterSwap(observed);
        weth.withdraw(ethAmount);
        if (address(this).balance - beforeEth != ethAmount || weth.balanceOf(address(this)) != beforeWeth) {
            revert InvalidConversion();
        }
        payable(msg.sender).sendValue(ethAmount);
        if (address(this).balance != beforeEth) revert InvalidConversion();
        emit FeeConversionObserved(
            quoteAsset, observed.pool, observed.observationHash, quoteAmount, minimumEth, ethAmount
        );
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

    function _quote(address quoteAsset, uint256 quoteAmount, bytes calldata path)
        private
        view
        returns (Oracle.Snapshot memory)
    {
        if (path.length != 43 || quoteAsset == address(weth)) revert InvalidRoute();
        address first;
        address last;
        uint24 fee;
        assembly ("memory-safe") {
            first := shr(96, calldataload(path.offset))
            fee := shr(232, calldataload(add(path.offset, 20)))
            last := shr(96, calldataload(add(path.offset, 23)))
        }
        if (first != quoteAsset || last != address(weth)) revert InvalidRoute();
        address poolAddress = factory.getPool(first, last, fee);
        if (poolAddress.code.length == 0) revert InvalidRoute();
        IModuleV3OraclePoolV1 pool = IModuleV3OraclePoolV1(poolAddress);
        bool first0 = first < last;
        if (
            pool.factory() != address(factory) || pool.token0() != (first0 ? first : last)
                || pool.token1() != (first0 ? last : first) || pool.fee() != fee
        ) revert InvalidRoute();
        return Oracle.read(poolAddress, quoteAsset, address(weth), quoteAmount, fee);
    }

    function _checkDependencies() private view {
        if (
            address(router).codehash != routerCodeHash || address(factory).codehash != factoryCodeHash
                || address(weth).codehash != wethCodeHash
        ) revert InvalidDependency();
    }
}
