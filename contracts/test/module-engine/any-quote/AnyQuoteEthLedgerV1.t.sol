// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { TransientStateLibrary } from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { AnyQuoteEthLedgerV1 } from "../../../src/module-engine/any-quote/AnyQuoteEthLedgerV1.sol";
import { AnyQuoteTypesV1 as Q } from "../../../src/module-engine/any-quote/AnyQuoteTypesV1.sol";

contract EthLedgerQuoteToken is ERC20 {
    constructor() ERC20("ETH ledger quote fixture", "ELQ") { }
}

/// @dev Uses real Core mint, native settle, burn and take. Fee conversion itself belongs to hook integration tests.
contract EthLedgerHookFixture is IUnlockCallback {
    IPoolManager public immutable manager;
    AnyQuoteEthLedgerV1 public immutable ledger;
    uint256 public managerEthAtAccrual;
    uint256 public ledgerEthAtAccrual;
    uint256 public ledgerClaimsAtAccrual;

    constructor(IPoolManager manager_, address host, address admin) {
        manager = manager_;
        ledger = new AnyQuoteEthLedgerV1(manager_, host, admin);
    }

    function register(bytes32 launchId, address asset, address[] memory wallets, uint16[] memory shares) external {
        ledger.registerLaunch(launchId, asset, wallets, shares);
    }

    function accrue(bytes32 launchId, uint256 platform, uint256 creator, uint256 backing) external payable {
        require(msg.value == backing, "exact funding");
        manager.unlock(abi.encode(uint8(0), launchId, platform, creator, backing, address(0)));
    }

    function accrueWithoutMint(bytes32 launchId, uint256 platform, uint256 creator) external {
        ledger.accrueEth(launchId, platform, creator);
    }

    function accrueWithoutSettlement(bytes32 launchId, uint256 platform, uint256 creator) external {
        manager.unlock(abi.encode(uint8(1), launchId, platform, creator, platform + creator, address(0)));
    }

    function accrueWithQuoteClaims(bytes32 launchId, address asset, uint256 platform, uint256 creator) external {
        manager.unlock(abi.encode(uint8(2), launchId, platform, creator, platform + creator, asset));
    }

    function claimDuringOtherUnlock(address beneficiary) external {
        manager.unlock(abi.encode(uint8(3), bytes32(0), uint256(0), uint256(0), uint256(0), beneficiary));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "manager only");
        (uint8 mode, bytes32 launchId, uint256 platform, uint256 creator, uint256 backing, address account) =
            abi.decode(data, (uint8, bytes32, uint256, uint256, uint256, address));
        if (mode == 3) {
            ledger.claimEthFor(account);
            return bytes("");
        }
        manager.mint(address(ledger), mode == 2 ? uint256(uint160(account)) : 0, backing);
        managerEthAtAccrual = address(manager).balance;
        ledgerEthAtAccrual = address(ledger).balance;
        ledgerClaimsAtAccrual = manager.balanceOf(address(ledger), 0);
        ledger.accrueEth(launchId, platform, creator);
        if (mode == 0) {
            manager.sync(Currency.wrap(address(0)));
            require(manager.settle{ value: backing }() == backing, "exact settlement");
        }
        return bytes("");
    }
}

contract EthLedgerRecipient {
    AnyQuoteEthLedgerV1 public immutable ledger;
    IPoolManager public immutable manager;
    address public immutable target;
    uint8 public mode;
    uint256 public received;
    bool public reentryAttempted;
    bool public reentrySucceeded;
    bytes4 public reentryError;

    error RecipientRejected();

    constructor(AnyQuoteEthLedgerV1 ledger_, IPoolManager manager_, address target_) {
        ledger = ledger_;
        manager = manager_;
        target = target_;
    }

    function setMode(uint8 mode_) external {
        mode = mode_;
    }

    function redirectClaim(address recipient) external returns (uint256) {
        return ledger.claimEthTo(recipient);
    }

    receive() external payable {
        if (mode == 1) revert RecipientRejected();
        received += msg.value;
        if (mode == 2) {
            (bool success,) = target.call{ value: msg.value }("");
            require(success, "forward failed");
        } else if (mode == 3) {
            reentryAttempted = true;
            bytes memory reason;
            (reentrySucceeded, reason) = address(ledger).call(abi.encodeCall(ledger.claimEthFor, (target)));
            if (reason.length >= 4) reentryError = bytes4(reason);
        } else if (mode == 4 || mode == 5) {
            // A recipient can use the received ETH inside Core's existing unlock, changing manager ETH balance.
            manager.sync(Currency.wrap(address(0)));
            manager.settle{ value: msg.value }();
            manager.mint(mode == 4 ? address(this) : address(ledger), 0, msg.value);
        }
    }
}

contract AnyQuoteEthLedgerV1Test is Test {
    using TransientStateLibrary for IPoolManager;

    bytes32 private constant LAUNCH = keccak256("any quote ETH ledger launch");
    address private constant HOST = address(0x1001);
    address private constant ADMIN = address(0x1002);
    address private constant ALICE = address(0x2001);
    address private constant BOB = address(0x2002);
    address private constant CAROL = address(0x2003);
    address private constant DAVE = address(0x2004);
    address private constant ATTACKER = address(0x9999);

    IPoolManager private manager;
    EthLedgerQuoteToken private token;
    EthLedgerHookFixture private hook;
    AnyQuoteEthLedgerV1 private ledger;

    function setUp() public {
        vm.chainId(4663);
        vm.deal(address(this), type(uint128).max);
        manager = new PoolManager(address(this));
        token = new EthLedgerQuoteToken();
        hook = new EthLedgerHookFixture(manager, HOST, ADMIN);
        ledger = hook.ledger();
        _register(LAUNCH, address(token), 2500);
    }

    function testFirstAccrualHasNativeCoreBackingBeforeRouterSettlement() public {
        _accrue(30, 10);
        assertEq(hook.managerEthAtAccrual(), 0);
        assertEq(hook.ledgerEthAtAccrual(), 0);
        assertEq(hook.ledgerClaimsAtAccrual(), 40);
        assertEq(address(ledger).balance, 0);
        assertEq(address(manager).balance, 40);
        assertEq(ledger.claimableEth(Q.PLATFORM_RECIPIENT), 30);
        assertEq(ledger.claimableEth(ALICE), 2);
        assertEq(ledger.claimableEth(BOB), 7);
        assertEq(ledger.ethDust(), 1);
        assertEq(ledger.platformFeeBps(LAUNCH), 30);
        assertEq(ledger.quoteAsset(LAUNCH), address(token));
        assertEq(ledger.ECONOMICS_POLICY_ID(), keccak256("programmable.any-quote.base-30.creator-0-1000.native-eth.v1"));
        _assertConservation();
    }

    function testClaimBurnsOwnCoreClaimsAndPaysNativeEth() public {
        _accrue(30, 10);
        vm.prank(ALICE);
        assertEq(ledger.claimEthTo(CAROL), 2);
        assertEq(CAROL.balance, 2);
        assertEq(address(manager).balance, 38);
        assertEq(_claims(), 38);
        assertEq(ledger.claimableEth(ALICE), 0);
        assertEq(ledger.claimedBy(ALICE), 2);
        assertEq(ledger.contributionByLaunch(LAUNCH, ALICE), 2);
        assertEq(token.balanceOf(CAROL), 0);
        assertEq(manager.currencyDelta(address(ledger), Currency.wrap(address(0))), 0);
        assertFalse(manager.isUnlocked());
        _assertConservation();
    }

    function testAccumulatedClaimsAboveCoreOperationLimitRemainRecoverable() public {
        uint256 maximum = ledger.MAX_CLAIM_AMOUNT();
        _accrue(maximum, 0);
        _accrue(100, 0);
        assertEq(ledger.claimableEth(Q.PLATFORM_RECIPIENT), maximum + 100);
        assertEq(ledger.claimEthFor(Q.PLATFORM_RECIPIENT), maximum);
        assertEq(ledger.claimableEth(Q.PLATFORM_RECIPIENT), 100);
        assertEq(_claims(), 100);
        assertEq(ledger.claimEthFor(Q.PLATFORM_RECIPIENT), 100);
        assertEq(Q.PLATFORM_RECIPIENT.balance, maximum + 100);
        assertEq(ledger.claimedBy(Q.PLATFORM_RECIPIENT), maximum + 100);
        assertEq(ledger.claimableEth(Q.PLATFORM_RECIPIENT), 0);
        _assertConservation();
    }

    function testZeroAccrualNeedsNoTransferOrAdditionalBacking() public {
        hook.accrueWithoutMint(LAUNCH, 0, 0);
        assertEq(ledger.totalReceived(), 0);
        assertEq(ledger.totalCredited(), 0);
        _accrue(30, 10);
        hook.accrueWithoutMint(LAUNCH, 0, 0);
        assertEq(ledger.totalReceived(), 40);
        _assertConservation();
    }

    function testAnyoneCanClaimOnlyToCreditedBeneficiary() public {
        _accrue(30, 10);
        vm.prank(ATTACKER);
        assertEq(ledger.claimEthFor(BOB), 7);
        assertEq(BOB.balance, 7);
        assertEq(ATTACKER.balance, 0);
        vm.prank(ATTACKER);
        vm.expectRevert(AnyQuoteEthLedgerV1.NoClaim.selector);
        ledger.claimEthTo(ATTACKER);
        _assertConservation();
    }

    function testUnderbackedAccrualRevertsMintAndAccounting() public {
        vm.expectRevert(AnyQuoteEthLedgerV1.InsufficientBacking.selector);
        hook.accrue{ value: 39 }(LAUNCH, 30, 10, 39);
        assertEq(_claims(), 0);
        assertEq(ledger.totalReceived(), 0);
        assertEq(address(manager).balance, 0);
    }

    function testUnsettledNativeMintCannotCommitAccrual() public {
        vm.expectRevert(IPoolManager.CurrencyNotSettled.selector);
        hook.accrueWithoutSettlement(LAUNCH, 30, 10);
        assertEq(_claims(), 0);
        assertEq(ledger.totalReceived(), 0);
        assertEq(ledger.claimableEth(Q.PLATFORM_RECIPIENT), 0);
        assertEq(address(manager).balance, 0);
    }

    function testQuoteTokenClaimsCannotBackNativeEthAccrual() public {
        vm.expectRevert(AnyQuoteEthLedgerV1.InsufficientBacking.selector);
        hook.accrueWithQuoteClaims(LAUNCH, address(token), 30, 10);
        assertEq(manager.balanceOf(address(ledger), uint256(uint160(address(token)))), 0);
        assertEq(_claims(), 0);
        assertEq(ledger.totalReceived(), 0);
    }

    function testForcedEthCannotReplaceCoreNativeClaims() public {
        vm.deal(address(ledger), 100);
        vm.expectRevert(AnyQuoteEthLedgerV1.InsufficientBacking.selector);
        hook.accrueWithoutMint(LAUNCH, 30, 10);
        assertEq(ledger.totalReceived(), 0);
        assertEq(address(ledger).balance, 100);
    }

    function testDustRemainsBackedAndCannotBeAccruedAgain() public {
        _accrue(0, 1);
        assertEq(ledger.ethDust(), 1);
        assertEq(ledger.outstandingClaims(), 0);
        vm.expectRevert(AnyQuoteEthLedgerV1.InsufficientBacking.selector);
        hook.accrueWithoutMint(LAUNCH, 0, 1);
        assertEq(ledger.totalReceived(), 1);
        _assertConservation();
    }

    function testRevertingRecipientKeepsEntitlementAndCannotBlockOtherFees() public {
        EthLedgerRecipient recipient = new EthLedgerRecipient(ledger, manager, CAROL);
        recipient.setMode(1);
        vm.prank(ALICE);
        ledger.changeCreatorWallet(LAUNCH, 0, address(recipient));
        _accrue(30, 10);
        vm.expectRevert();
        ledger.claimEthFor(address(recipient));
        assertEq(ledger.claimableEth(address(recipient)), 2);
        assertEq(ledger.claimedBy(address(recipient)), 0);
        assertEq(ledger.totalClaimed(), 0);
        assertEq(_claims(), 40);
        _accrue(30, 10);
        assertEq(ledger.claimableEth(address(recipient)), 5);
        assertEq(ledger.claimEthFor(BOB), 15);
        assertEq(recipient.redirectClaim(CAROL), 5);
        assertEq(CAROL.balance, 5);
        _assertConservation();
    }

    function testRecipientCanForwardEthDuringClaim() public {
        EthLedgerRecipient recipient = new EthLedgerRecipient(ledger, manager, CAROL);
        recipient.setMode(2);
        _accrue(30, 10);
        vm.prank(ALICE);
        assertEq(ledger.claimEthTo(address(recipient)), 2);
        assertEq(recipient.received(), 2);
        assertEq(address(recipient).balance, 0);
        assertEq(CAROL.balance, 2);
        _assertConservation();
    }

    function testRecipientCanResettleReceivedEthWithoutChangingManagerBalance() public {
        EthLedgerRecipient recipient = new EthLedgerRecipient(ledger, manager, CAROL);
        recipient.setMode(4);
        _accrue(30, 10);
        vm.prank(ALICE);
        assertEq(ledger.claimEthTo(address(recipient)), 2);
        assertEq(recipient.received(), 2);
        assertEq(address(recipient).balance, 0);
        assertEq(address(manager).balance, 40);
        assertEq(manager.balanceOf(address(recipient), 0), 2);
        assertEq(_claims(), 38);
        _assertConservation();
    }

    function testRecipientCoreDonationDoesNotRestoreItsSpentEntitlement() public {
        EthLedgerRecipient recipient = new EthLedgerRecipient(ledger, manager, CAROL);
        recipient.setMode(5);
        _accrue(30, 10);
        vm.prank(ALICE);
        assertEq(ledger.claimEthTo(address(recipient)), 2);
        assertEq(recipient.received(), 2);
        assertEq(_claims(), 40);
        assertEq(ledger.claimableEth(ALICE), 0);
        assertEq(ledger.claimedBy(ALICE), 2);
        assertEq(ledger.outstandingClaims() + ledger.ethDust(), 38);
        vm.prank(ALICE);
        vm.expectRevert(AnyQuoteEthLedgerV1.NoClaim.selector);
        ledger.claimEthTo(ALICE);
    }

    function testNativeRecipientCannotReenterAnotherClaim() public {
        EthLedgerRecipient recipient = new EthLedgerRecipient(ledger, manager, BOB);
        recipient.setMode(3);
        _accrue(30, 10);
        vm.prank(ALICE);
        ledger.claimEthTo(address(recipient));
        assertTrue(recipient.reentryAttempted());
        assertFalse(recipient.reentrySucceeded());
        assertEq(recipient.reentryError(), ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        assertEq(ledger.claimableEth(BOB), 7);
        assertEq(address(recipient).balance, 2);
        _assertConservation();
    }

    function testClaimCannotJoinUnrelatedUnlockAndRemainsClaimable() public {
        _accrue(30, 10);
        vm.expectRevert(IPoolManager.AlreadyUnlocked.selector);
        hook.claimDuringOtherUnlock(ALICE);
        assertEq(ledger.claimableEth(ALICE), 2);
        assertEq(ledger.totalClaimed(), 0);
        assertEq(_claims(), 40);
        ledger.claimEthFor(ALICE);
        _assertConservation();
    }

    function testCallbackRequiresAuthenticManagerAndActiveClaim() public {
        bytes memory data = abi.encode(ALICE, uint256(1));
        vm.expectRevert(AnyQuoteEthLedgerV1.UnauthorizedCallback.selector);
        ledger.unlockCallback(data);
        vm.prank(address(manager));
        vm.expectRevert(AnyQuoteEthLedgerV1.UnauthorizedCallback.selector);
        ledger.unlockCallback(data);
    }

    function testCreatorRotationPreservesPastClaimsAndLifetimeRounding() public {
        _accrue(30, 10);
        vm.prank(ALICE);
        ledger.changeCreatorWallet(LAUNCH, 0, CAROL);
        _accrue(30, 10);
        assertEq(ledger.claimableEth(ALICE), 2);
        assertEq(ledger.claimableEth(CAROL), 3);
        assertEq(ledger.claimableEth(BOB), 15);
        assertEq(ledger.ethDust(), 0);
        (address[] memory wallets, uint16[] memory shares,) = ledger.creatorRecipients(LAUNCH);
        assertEq(wallets[0], CAROL);
        assertEq(wallets[1], BOB);
        assertEq(shares[0], 2500);
        assertEq(shares[1], 7500);
        vm.prank(ALICE);
        vm.expectRevert(AnyQuoteEthLedgerV1.UnauthorizedWalletChange.selector);
        ledger.changeCreatorWallet(LAUNCH, 0, DAVE);
        vm.prank(ALICE);
        ledger.claimEthTo(DAVE);
        assertEq(DAVE.balance, 2);
        _assertConservation();
    }

    function testPlatformRotationChangesOnlyFutureCredits() public {
        _accrue(30, 10);
        vm.prank(Q.PLATFORM_RECIPIENT);
        ledger.changePlatformWallet(CAROL);
        _accrue(30, 10);
        assertEq(ledger.treasury(), CAROL);
        assertEq(ledger.claimableEth(Q.PLATFORM_RECIPIENT), 30);
        assertEq(ledger.claimableEth(CAROL), 30);
        assertEq(ledger.claimEthFor(Q.PLATFORM_RECIPIENT), 30);
        vm.prank(Q.PLATFORM_RECIPIENT);
        vm.expectRevert(AnyQuoteEthLedgerV1.UnauthorizedWalletChange.selector);
        ledger.changePlatformWallet(DAVE);
        vm.prank(ADMIN);
        ledger.changePlatformWallet(DAVE);
        _accrue(30, 0);
        assertEq(ledger.claimableEth(CAROL), 30);
        assertEq(ledger.claimableEth(DAVE), 30);
        assertEq(ledger.platformFeeBps(LAUNCH), 30);
        _assertConservation();
    }

    function testAdminReplacementPreservesSharesConfigurationAndHistory() public {
        _accrue(30, 10);
        bytes32 originalConfiguration = ledger.configurationHash(LAUNCH);
        address[] memory next = _wallets(CAROL, DAVE);
        vm.prank(ADMIN);
        ledger.replaceCreatorWallets(LAUNCH, next, 0, block.timestamp + 100);
        _accrue(30, 10);
        assertEq(ledger.claimableEth(ALICE), 2);
        assertEq(ledger.claimableEth(BOB), 7);
        assertEq(ledger.claimableEth(CAROL), 3);
        assertEq(ledger.claimableEth(DAVE), 8);
        assertEq(ledger.configurationHash(LAUNCH), originalConfiguration);
        (, uint16[] memory shares, uint256 revision) = ledger.creatorRecipients(LAUNCH);
        assertEq(shares[0], 2500);
        assertEq(shares[1], 7500);
        assertEq(revision, 1);
        vm.prank(ADMIN);
        vm.expectRevert(AnyQuoteEthLedgerV1.UnauthorizedWalletChange.selector);
        ledger.replaceCreatorWallets(LAUNCH, next, 0, block.timestamp + 100);
        vm.prank(ADMIN);
        vm.expectRevert(AnyQuoteEthLedgerV1.UnauthorizedWalletChange.selector);
        ledger.replaceCreatorWallets(LAUNCH, next, 1, block.timestamp - 1);
        _assertConservation();
    }

    function testTreasuryAndCreatorCannotChangeUnownedCreatorSlots() public {
        address[] memory next = _wallets(CAROL, DAVE);
        vm.prank(Q.PLATFORM_RECIPIENT);
        vm.expectRevert(AnyQuoteEthLedgerV1.UnauthorizedWalletChange.selector);
        ledger.replaceCreatorWallets(LAUNCH, next, 0, block.timestamp + 100);
        vm.prank(Q.PLATFORM_RECIPIENT);
        vm.expectRevert(AnyQuoteEthLedgerV1.UnauthorizedWalletChange.selector);
        ledger.changeCreatorWallet(LAUNCH, 0, CAROL);
        vm.prank(ALICE);
        vm.expectRevert(AnyQuoteEthLedgerV1.UnauthorizedWalletChange.selector);
        ledger.changeCreatorWallet(LAUNCH, 1, CAROL);
        vm.prank(ALICE);
        vm.expectRevert(AnyQuoteEthLedgerV1.UnauthorizedWalletChange.selector);
        ledger.changePlatformWallet(CAROL);
        vm.prank(ADMIN);
        ledger.changeCreatorWallet(LAUNCH, 1, CAROL);
        (address[] memory wallets,,) = ledger.creatorRecipients(LAUNCH);
        assertEq(wallets[0], ALICE);
        assertEq(wallets[1], CAROL);
    }

    function testOnlyImmutableDeployingHookCanRegisterAndAccrue() public {
        assertEq(ledger.hook(), address(hook));
        assertEq(ledger.host(), HOST);
        assertEq(address(ledger.poolManager()), address(manager));
        assertEq(ledger.rewardAdmin(), ADMIN);
        vm.prank(HOST);
        vm.expectRevert(AnyQuoteEthLedgerV1.UnauthorizedHook.selector);
        ledger.registerLaunch(bytes32(uint256(2)), address(token), _wallets(ALICE, BOB), _shares(2500));
        vm.prank(HOST);
        vm.expectRevert(AnyQuoteEthLedgerV1.UnauthorizedHook.selector);
        ledger.accrueEth(LAUNCH, 1, 1);
        vm.prank(ADMIN);
        vm.expectRevert(AnyQuoteEthLedgerV1.UnauthorizedHook.selector);
        ledger.accrueEth(LAUNCH, 1, 1);
    }

    function testRegistrationRejectsInvalidAllocationsAndDuplicateLaunches() public {
        vm.expectRevert(AnyQuoteEthLedgerV1.InvalidConfiguration.selector);
        _register(LAUNCH, address(token), 5000);
        vm.expectRevert(AnyQuoteEthLedgerV1.InvalidConfiguration.selector);
        _register(bytes32(0), address(token), 5000);
        vm.expectRevert(AnyQuoteEthLedgerV1.InvalidConfiguration.selector);
        _register(bytes32(uint256(2)), address(0), 5000);
        vm.expectRevert(AnyQuoteEthLedgerV1.InvalidConfiguration.selector);
        _register(bytes32(uint256(2)), address(token), 0);
        uint16[] memory shares = _shares(2500);
        shares[1] = 7000;
        vm.expectRevert(AnyQuoteEthLedgerV1.InvalidConfiguration.selector);
        hook.register(bytes32(uint256(2)), address(token), _wallets(ALICE, BOB), shares);
    }

    function testReservedAddressesCannotReceiveFutureCreditsOrClaims() public {
        _accrue(30, 10);
        address[5] memory reserved = [address(0), address(ledger), address(hook), address(manager), HOST];
        for (uint256 i; i < reserved.length; ++i) {
            vm.prank(ALICE);
            vm.expectRevert(AnyQuoteEthLedgerV1.InvalidConfiguration.selector);
            ledger.changeCreatorWallet(LAUNCH, 0, reserved[i]);
            vm.prank(ADMIN);
            vm.expectRevert(AnyQuoteEthLedgerV1.InvalidConfiguration.selector);
            ledger.changePlatformWallet(reserved[i]);
            vm.prank(ALICE);
            vm.expectRevert(AnyQuoteEthLedgerV1.InvalidConfiguration.selector);
            ledger.claimEthTo(reserved[i]);
        }
        assertEq(ledger.claimableEth(ALICE), 2);
        _assertConservation();
    }

    function testDifferentQuoteLaunchesShareOnlyNativeBackingAndKeepAttribution() public {
        EthLedgerQuoteToken other = new EthLedgerQuoteToken();
        bytes32 otherLaunch = keccak256("other quote launch");
        _register(otherLaunch, address(other), 5000);
        _accrue(30, 10);
        hook.accrue{ value: 50 }(otherLaunch, 30, 20, 50);
        assertEq(ledger.quoteAsset(otherLaunch), address(other));
        assertEq(ledger.contributionByLaunch(LAUNCH, ALICE), 2);
        assertEq(ledger.contributionByLaunch(otherLaunch, ALICE), 10);
        assertEq(ledger.claimableEth(ALICE), 12);
        assertEq(ledger.claimEthFor(ALICE), 12);
        assertEq(ALICE.balance, 12);
        assertEq(token.balanceOf(ALICE), 0);
        assertEq(other.balanceOf(ALICE), 0);
        assertEq(ledger.totalReceived(), 90);
        _assertConservation();
    }

    function testFuzzLifetimeAllocationIsIndependentOfAccrualPartition(uint96 first, uint96 second, uint16 share)
        public
    {
        uint256 a = bound(uint256(first), 1, 1e24);
        uint256 b = bound(uint256(second), 1, 1e24);
        uint16 aliceShare = uint16(bound(uint256(share), 1, 9999));
        bytes32 split = keccak256("split native accrual");
        bytes32 whole = keccak256("whole native accrual");
        _register(split, address(token), aliceShare);
        _register(whole, address(token), aliceShare);
        hook.accrue{ value: a + 13 }(split, 13, a, a + 13);
        hook.accrue{ value: b + 17 }(split, 17, b, b + 17);
        hook.accrue{ value: a + b + 30 }(whole, 30, a + b, a + b + 30);
        uint256 expectedAlice = (a + b) * aliceShare / 10_000;
        uint256 expectedBob = (a + b) * (10_000 - aliceShare) / 10_000;
        assertEq(ledger.contributionByLaunch(split, ALICE), expectedAlice);
        assertEq(ledger.contributionByLaunch(whole, ALICE), expectedAlice);
        assertEq(ledger.contributionByLaunch(split, BOB), expectedBob);
        assertEq(ledger.contributionByLaunch(whole, BOB), expectedBob);
        assertEq(ledger.contributionByLaunch(split, Q.PLATFORM_RECIPIENT), 30);
        assertEq(ledger.contributionByLaunch(whole, Q.PLATFORM_RECIPIENT), 30);
        assertEq(ledger.ethDust(), 2 * (a + b - expectedAlice - expectedBob));
        _assertConservation();
    }

    function _register(bytes32 launchId, address asset, uint16 aliceShare) private {
        hook.register(launchId, asset, _wallets(ALICE, BOB), _shares(aliceShare));
    }

    function _wallets(address first, address second) private pure returns (address[] memory wallets) {
        wallets = new address[](2);
        wallets[0] = first;
        wallets[1] = second;
    }

    function _shares(uint16 first) private pure returns (uint16[] memory shares) {
        shares = new uint16[](2);
        shares[0] = first;
        shares[1] = 10_000 - first;
    }

    function _accrue(uint256 platform, uint256 creator) private {
        hook.accrue{ value: platform + creator }(LAUNCH, platform, creator, platform + creator);
    }

    function _claims() private view returns (uint256) {
        return manager.balanceOf(address(ledger), 0);
    }

    function _assertConservation() private view {
        assertEq(_claims(), ledger.totalReceived() - ledger.totalClaimed());
        assertEq(_claims(), ledger.outstandingClaims() + ledger.ethDust());
    }
}
