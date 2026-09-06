// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ModuleRuntimeTypesV1 as T } from "../src/module-mode/ModuleRuntimeTypesV1.sol";
import { ModuleNativeRuntimeV1 } from "../src/module-mode/ModuleNativeRuntimeV1.sol";
import { ModuleNativeBudgetVaultV1 } from "../src/module-mode/ModuleNativeBudgetVaultV1.sol";
import { EveryNthBuyRewardV1, EveryNthBuyRewardFactoryV1 } from "../src/module-mode/modules/EveryNthBuyRewardV1.sol";

// Minimal local Foundry interface. No dependency installation, FFI or signing cheatcodes.
interface StarterVm {
    function warp(uint256 timestamp) external;
    function deal(address account, uint256 amount) external;
    function prank(address sender) external;
    function expectRevert() external;
}

contract StarterIdentity { }

/// @dev Runtime callback fixture only. Amounts are test inputs; this is NOT a PoolManager or tradable launch engine.
contract StarterEngine {
    address private immutable _owner = msg.sender;
    ModuleNativeRuntimeV1 public runtime;

    function bind(ModuleNativeRuntimeV1 runtime_) external {
        require(msg.sender == _owner && address(runtime) == address(0), "binding");
        runtime = runtime_;
    }

    function register(T.LaunchBinding calldata binding, T.Selection[] calldata selections) external returns (bytes32) {
        require(msg.sender == _owner, "owner");
        return runtime.registerLaunch(binding, selections);
    }

    function buy(bytes32 key, uint256 gross, bool initialBuy) external {
        T.Trade memory trade = T.Trade(
            runtime.lastTradeSequence(key) + 1,
            msg.sender,
            msg.sender,
            msg.sender,
            gross,
            1 ether,
            true,
            true,
            initialBuy
        );
        runtime.executeTrade(key, trade);
    }
}

contract RejectingWinner {
    function buy(StarterEngine engine, bytes32 key) external {
        engine.buy(key, 0.01 ether, false);
    }

    function redirectOwnClaim(ModuleNativeBudgetVaultV1 vault, bytes32 id, address recipient) external {
        vault.claimTo(id, recipient);
    }

    receive() external payable {
        revert("no direct payment");
    }
}

contract EveryNthBuyRewardStarterTest {
    StarterVm private constant vm = StarterVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant BUYER = address(0xB0B);
    address private constant REFUND_WALLET = address(0xA11CE);
    bytes32 private constant RECLAIM = keccak256("programmable.module-mode.reward.reclaim-unused.v1");
    uint128 private constant REWARD = 0.001 ether;
    uint64 private constant END = 2_000_000;

    StarterEngine private engine;
    StarterIdentity private manager;
    ModuleNativeRuntimeV1 private runtime;
    ModuleNativeBudgetVaultV1 private vault;
    EveryNthBuyRewardFactoryV1 private factory;
    uint256 private _registrations;

    function setUp() public {
        vm.warp(1_000_000);
        vm.deal(address(this), 100 ether);
        engine = new StarterEngine();
        manager = new StarterIdentity();
        runtime = new ModuleNativeRuntimeV1(address(engine));
        engine.bind(runtime);
        vault = runtime.vault();
        factory = new EveryNthBuyRewardFactoryV1();
    }

    function _configuration(uint32 everyN, bool includeInitial) private pure returns (bytes memory) {
        return abi.encode(everyN, uint128(0.01 ether), REWARD, END, includeInitial, REFUND_WALLET);
    }

    function _selection(bytes memory config) private view returns (T.Selection[] memory selections) {
        selections = new T.Selection[](1);
        selections[0] = T.Selection(
            keccak256("starter.fixture.package-id"),
            address(factory),
            address(factory).codehash,
            factory.moduleCodeHash(),
            300_000,
            config
        );
    }

    function _binding(T.Selection[] memory selections) private returns (T.LaunchBinding memory) {
        uint256 salt = ++_registrations;
        return T.LaunchBinding(
            address(engine),
            REFUND_WALLET,
            address(new StarterIdentity()),
            address(manager),
            keccak256(abi.encode("pool", salt)),
            keccak256(abi.encode("recipe", salt)),
            runtime.programHash(selections)
        );
    }

    function _register(uint32 n, bool initial)
        private
        returns (bytes32 key, bytes32 instanceId, EveryNthBuyRewardV1 program)
    {
        T.Selection[] memory selections = _selection(_configuration(n, initial));
        key = engine.register(_binding(selections), selections);
        ModuleNativeRuntimeV1.Instance memory instance = runtime.instances(key)[0];
        return (key, instance.instanceId, EveryNthBuyRewardV1(instance.module));
    }

    function _buy(bytes32 key, address actor, uint256 gross, bool initial) private {
        vm.prank(actor);
        engine.buy(key, gross, initial);
    }

    function _backed() private view {
        require(vault.totalFunded() == vault.totalAvailable() + vault.totalOutstandingClaims() + vault.totalClaimed());
        require(address(vault).balance >= vault.totalAvailable() + vault.totalOutstandingClaims());
    }

    function test_realRuntimeCreatesBoundInstanceAndPinsCodeAcrossConfigurations() public {
        (bytes32 key, bytes32 id, EveryNthBuyRewardV1 program) = _register(3, false);
        (bytes32 otherKey,, EveryNthBuyRewardV1 other) = _register(5, true);
        require(key != otherKey && address(program) != address(other));
        require(address(program).codehash == factory.moduleCodeHash());
        require(address(program).codehash == address(other).codehash);
        T.InstanceBinding memory binding = program.instanceBinding();
        require(binding.runtime == address(runtime) && binding.launchKey == key && binding.instanceId == id);
        require(binding.configHash == keccak256(_configuration(3, false)));
        require(program.refundWallet() == REFUND_WALLET && program.everyN() == 3 && !program.includeInitialBuy());
        require(other.everyN() == 5 && other.includeInitialBuy());
    }

    function test_authenticatedBuyerEarnsOnlyOnQualifyingBuysAndPullsNativeClaim() public {
        (bytes32 key, bytes32 id, EveryNthBuyRewardV1 program) = _register(2, false);
        vault.fund{ value: 0.005 ether }(id);
        _buy(key, REFUND_WALLET, 1 ether, true);
        _buy(key, BUYER, 1, false);
        _buy(key, REFUND_WALLET, 0.01 ether, false);
        _buy(key, BUYER, 0.01 ether, false);
        require(program.qualifiedBuys() == 2 && program.rewardedBuys() == 1);
        require(vault.claimable(id, BUYER) == REWARD && vault.claimable(id, REFUND_WALLET) == 0);
        require(BUYER.balance == 0);
        vault.claim(id, BUYER);
        require(BUYER.balance == REWARD && vault.claimable(id, BUYER) == 0);
        require(vault.claimed(id, BUYER) == REWARD);
        _backed();
    }

    function test_callbackCannotBeInvokedDirectlyOrWithAnotherInstanceBinding() public {
        (bytes32 key, bytes32 id, EveryNthBuyRewardV1 program) = _register(1, true);
        vault.fund{ value: REWARD }(id);
        T.TradeContext memory context = T.TradeContext(
            key, id, bytes32(uint256(1)), T.Trade(1, BUYER, BUYER, BUYER, 1 ether, 1 ether, true, true, false)
        );
        vm.expectRevert();
        program.onTrade(context);
        context.instanceId = bytes32(uint256(999));
        vm.prank(address(runtime));
        vm.expectRevert();
        program.onTrade(context);
        vm.expectRevert();
        runtime.executeTrade(key, context.trade);
        require(program.qualifiedBuys() == 0 && vault.available(id) == REWARD);
        _backed();
    }

    function test_rewardReceiverFailureCannotBlockCallbackAndOnlyWinnerCanRedirectClaim() public {
        (bytes32 key, bytes32 id,) = _register(1, true);
        RejectingWinner winner = new RejectingWinner();
        vault.fund{ value: REWARD }(id);
        winner.buy(engine, key);
        require(vault.claimable(id, address(winner)) == REWARD);
        vm.expectRevert();
        vault.claim(id, address(winner));
        require(vault.claimable(id, address(winner)) == REWARD);
        vm.prank(BUYER);
        vm.expectRevert();
        vault.claimTo(id, BUYER);
        winner.redirectOwnClaim(vault, id, BUYER);
        require(BUYER.balance == REWARD && vault.claimable(id, address(winner)) == 0);
        _backed();
    }

    function test_refundRequiresExactRoleTimeAndNonceAndLeavesWinnerClaimsUntouched() public {
        (bytes32 key, bytes32 id, EveryNthBuyRewardV1 program) = _register(1, true);
        vault.fund{ value: 0.005 ether }(id);
        _buy(key, BUYER, 0.01 ether, false);
        vm.prank(REFUND_WALLET);
        vm.expectRevert();
        runtime.executeAction(key, 0, RECLAIM, "", 0, END);
        vm.warp(END);
        vm.prank(BUYER);
        vm.expectRevert();
        runtime.executeAction(key, 0, RECLAIM, "", 0, END);
        vm.prank(REFUND_WALLET);
        runtime.executeAction(key, 0, RECLAIM, "", 0, END);
        require(runtime.actionNonce(key, REFUND_WALLET) == 1 && runtime.actionNonce(key, BUYER) == 0);
        require(vault.claimable(id, REFUND_WALLET) == 0.004 ether && vault.claimable(id, BUYER) == REWARD);
        require(vault.available(id) == 0 && program.totalReclaimed() == 0.004 ether);
        vm.prank(REFUND_WALLET);
        vm.expectRevert();
        runtime.executeAction(key, 0, RECLAIM, "", 0, END);
        vault.claim(id, REFUND_WALLET);
        vault.claim(id, BUYER);
        require(REFUND_WALLET.balance == 0.004 ether && BUYER.balance == REWARD);
        _backed();
    }

    function test_expiredTransactionWrongActionAndExtraInputsDoNotConsumeNonce() public {
        (bytes32 key, bytes32 id,) = _register(1, true);
        vault.fund{ value: REWARD }(id);
        vm.warp(END);
        vm.prank(REFUND_WALLET);
        vm.expectRevert();
        runtime.executeAction(key, 0, RECLAIM, "", 0, END - 1);
        vm.prank(REFUND_WALLET);
        vm.expectRevert();
        runtime.executeAction(key, 0, bytes32("wrong"), "", 0, END);
        vm.prank(REFUND_WALLET);
        vm.expectRevert();
        runtime.executeAction(key, 0, RECLAIM, hex"00", 0, END);
        require(runtime.actionNonce(key, REFUND_WALLET) == 0 && vault.available(id) == REWARD);
        _backed();
    }

    function test_refundAndNewFundingCannotTouchAnotherLaunchBudget() public {
        (bytes32 key, bytes32 id, EveryNthBuyRewardV1 program) = _register(1, true);
        (, bytes32 otherId,) = _register(1, true);
        vault.fund{ value: 0.01 ether }(otherId);
        vm.warp(END);
        vm.prank(REFUND_WALLET);
        runtime.executeAction(key, 0, RECLAIM, "", 0, END);
        require(runtime.actionNonce(key, REFUND_WALLET) == 1 && program.totalReclaimed() == 0);
        vault.fund{ value: REWARD }(id);
        vm.prank(REFUND_WALLET);
        runtime.executeAction(key, 0, RECLAIM, "", 1, END);
        require(vault.claimable(id, REFUND_WALLET) == REWARD && vault.available(otherId) == 0.01 ether);
        require(runtime.actionNonce(key, REFUND_WALLET) == 2);
        _backed();
    }

    function test_depletedBudgetCreatesNoDebtAndExpiryStopsCounting() public {
        (bytes32 key, bytes32 id, EveryNthBuyRewardV1 program) = _register(1, true);
        _buy(key, BUYER, 0.01 ether, false);
        require(program.qualifiedBuys() == 1 && program.rewardedBuys() == 0 && vault.claimable(id, BUYER) == 0);
        vault.fund{ value: REWARD }(id);
        _buy(key, REFUND_WALLET, 0.01 ether, false);
        require(vault.claimable(id, BUYER) == 0 && vault.claimable(id, REFUND_WALLET) == REWARD);
        vm.warp(END);
        _buy(key, BUYER, 0.01 ether, false);
        require(program.qualifiedBuys() == 2);
        _backed();
    }

    function test_oldConfigAndZeroRefundWalletCannotInstantiate() public {
        T.Selection[] memory selections = _selection(abi.encode(uint32(1), uint128(1), REWARD, END, true));
        T.LaunchBinding memory binding = _binding(selections);
        vm.expectRevert();
        engine.register(binding, selections);
        selections = _selection(abi.encode(uint32(1), uint128(1), REWARD, END, true, address(0)));
        binding = _binding(selections);
        vm.expectRevert();
        engine.register(binding, selections);
        require(vault.totalFunded() == 0);
    }

    function testFuzz_rewardAndRefundExactlyPartitionPrefunding(uint96 rawFunding, uint8 rawBuys, uint8 rawEvery)
        public
    {
        uint256 funding = uint256(rawFunding) % 1 ether + 1;
        uint256 buys = uint256(rawBuys) % 64;
        uint32 n = uint32(rawEvery) % 16 + 1;
        (bytes32 key, bytes32 id,) = _register(n, true);
        vault.fund{ value: funding }(id);
        for (uint256 i; i < buys; ++i) {
            _buy(key, BUYER, 0.01 ether, false);
        }
        uint256 winners = buys / n;
        uint256 affordable = funding / REWARD;
        if (winners > affordable) winners = affordable;
        uint256 earned = winners * REWARD;
        require(vault.claimable(id, BUYER) == earned && vault.available(id) == funding - earned);
        vm.warp(END);
        vm.prank(REFUND_WALLET);
        runtime.executeAction(key, 0, RECLAIM, "", 0, END);
        require(vault.claimable(id, BUYER) == earned && vault.claimable(id, REFUND_WALLET) == funding - earned);
        require(vault.available(id) == 0);
        _backed();
    }
}
