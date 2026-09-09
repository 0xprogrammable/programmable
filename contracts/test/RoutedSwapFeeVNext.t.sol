// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolModifyLiquidityTest } from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import { TestERC20 } from "@uniswap/v4-core/src/test/TestERC20.sol";
import { V4Router } from "@uniswap/v4-periphery/src/V4Router.sol";
import { IV4Router } from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import { Actions } from "@uniswap/v4-periphery/src/libraries/Actions.sol";

/// @dev Test entrypoint only. All swap, settlement, TAKE_PORTION, TAKE_ALL and
/// atomic revert behavior are the existing upstream V4Router/PoolManager code.
contract RoutedFeeVNextHarness is V4Router {
    address private caller;
    constructor(IPoolManager manager) V4Router(manager) { }

    function execute(bytes calldata unlockData) external payable {
        require(caller == address(0));
        caller = msg.sender;
        _executeActions(unlockData);
        caller = address(0);
        if (address(this).balance != 0) {
            (bool sent,) = msg.sender.call{ value: address(this).balance }("");
            require(sent);
        }
    }

    function msgSender() public view override returns (address) {
        return caller;
    }

    function _pay(Currency currency, address payer, uint256 amount) internal override {
        require(TestERC20(Currency.unwrap(currency)).transferFrom(payer, address(poolManager), amount));
    }
    receive() external payable { }
}

contract RoutedSwapFeeVNextTest is Test {
    address constant TOKEN = 0x2222222222222222222222222222222222222222;
    address constant RECIPIENT = 0xD88539d3c4C460136a733A3Fd60cf6BF269079da;
    address constant TRADER = 0x1111111111111111111111111111111111111111;
    PoolManager private manager;
    RoutedFeeVNextHarness private router;
    PoolKey private key;

    function setUp() public {
        manager = new PoolManager(address(this));
        router = new RoutedFeeVNextHarness(manager);
        TestERC20 implementation = new TestERC20(0);
        vm.etch(TOKEN, address(implementation).code);
        TestERC20(TOKEN).mint(address(this), 1e30);
        TestERC20(TOKEN).mint(TRADER, 1e24);
        vm.deal(address(this), 100 ether);
        vm.deal(TRADER, 100 ether);
        vm.deal(RECIPIENT, 0);
        key = PoolKey(Currency.wrap(address(0)), Currency.wrap(TOKEN), 3000, 60, IHooks(address(0)));
        manager.initialize(key, 79_228_162_514_264_337_593_543_950_336);
        PoolModifyLiquidityTest liquidity = new PoolModifyLiquidityTest(manager);
        TestERC20(TOKEN).approve(address(liquidity), type(uint256).max);
        liquidity.modifyLiquidity{ value: 10 ether }(key, ModifyLiquidityParams(-600, 600, 100 ether, bytes32(0)), "");
        vm.prank(TRADER);
        TestERC20(TOKEN).approve(address(router), type(uint256).max);
    }

    function testSdkNativeInputPaysActualTokenFeeAndNetOutputAtomically() public {
        string memory vector = vm.readFile("spec/routed-trade-fee-vnext-vector.json");
        bytes memory encoded = vm.parseJsonBytes(vector, ".buy.unlockData");
        uint256 beforeTrader = TestERC20(TOKEN).balanceOf(TRADER);
        vm.prank(TRADER);
        router.execute{ value: 100_000 }(encoded);
        uint256 fee = TestERC20(TOKEN).balanceOf(RECIPIENT);
        uint256 net = TestERC20(TOKEN).balanceOf(TRADER) - beforeTrader;
        assertGt(fee, 0);
        assertEq(fee, (net + fee) * 20 / 10_000);
        assertGe(net, 49_651);
        assertEq(address(router).balance, 0);
        assertEq(TestERC20(TOKEN).balanceOf(address(router)), 0);
    }

    function testSdkTokenInputPaysActualNativeFeeAndNetOutputAtomically() public {
        string memory vector = vm.readFile("spec/routed-trade-fee-vnext-vector.json");
        uint256 beforeTrader = TRADER.balance;
        vm.prank(TRADER);
        router.execute(vm.parseJsonBytes(vector, ".sell.unlockData"));
        uint256 fee = RECIPIENT.balance;
        uint256 net = TRADER.balance - beforeTrader;
        assertGt(fee, 0);
        assertEq(fee, (net + fee) * 20 / 10_000);
        assertGe(net, 49_651);
        assertEq(address(router).balance, 0);
    }

    function testMinimumAfterFeeFailureRollsBackSwapAndFeeTransfer() public {
        uint256 oldManager = TestERC20(TOKEN).balanceOf(address(manager));
        uint256 oldTrader = TestERC20(TOKEN).balanceOf(TRADER);
        vm.prank(TRADER);
        vm.expectRevert();
        router.execute{ value: 100_000 }(_actions(true, 100_000, type(uint128).max));
        assertEq(TestERC20(TOKEN).balanceOf(RECIPIENT), 0);
        assertEq(TestERC20(TOKEN).balanceOf(address(manager)), oldManager);
        assertEq(TestERC20(TOKEN).balanceOf(TRADER), oldTrader);
    }

    function testFuzzOnlyOutputCreditIsChargedOnce(uint64 rawAmount, bool zeroForOne) public {
        uint128 amountIn = uint128(bound(rawAmount, 1000, 1e14));
        uint256 beforeTrader = zeroForOne ? TestERC20(TOKEN).balanceOf(TRADER) : TRADER.balance;
        vm.prank(TRADER);
        router.execute{ value: zeroForOne ? amountIn : 0 }(_actions(zeroForOne, amountIn, 1));
        uint256 fee = zeroForOne ? TestERC20(TOKEN).balanceOf(RECIPIENT) : RECIPIENT.balance;
        uint256 net = (zeroForOne ? TestERC20(TOKEN).balanceOf(TRADER) : TRADER.balance) - beforeTrader;
        assertEq(fee, (net + fee) * 20 / 10_000);
    }

    function _actions(bool direction, uint128 amountIn, uint128 minimum) private view returns (bytes memory) {
        bytes[] memory params = new bytes[](4);
        params[0] = abi.encode(IV4Router.ExactInputSingleParams(key, direction, amountIn, 1, ""));
        params[1] = abi.encode(direction ? key.currency0 : key.currency1, amountIn);
        params[2] = abi.encode(direction ? key.currency1 : key.currency0, RECIPIENT, uint256(20));
        params[3] = abi.encode(direction ? key.currency1 : key.currency0, minimum);
        return abi.encode(
            abi.encodePacked(
                uint8(Actions.SWAP_EXACT_IN_SINGLE),
                uint8(Actions.SETTLE_ALL),
                uint8(Actions.TAKE_PORTION),
                uint8(Actions.TAKE_ALL)
            ),
            params
        );
    }
    receive() external payable { }
}
