// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { AnyQuoteLedgerV1 } from "../../../src/module-engine/any-quote/AnyQuoteLedgerV1.sol";
import { AnyQuoteTypesV1 as Q } from "../../../src/module-engine/any-quote/AnyQuoteTypesV1.sol";

contract LedgerQuoteToken is ERC20 {
    address public badRecipient;
    uint8 public transferMode;
    AnyQuoteLedgerV1 public reentryLedger;
    address public reentryBeneficiary;
    bool public reentryAttempted;
    bool public reentrySucceeded;
    bytes4 public reentryError;

    error RecipientRejected();

    constructor() ERC20("Ledger quote fixture", "LQ") { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setTransferMode(address recipient, uint8 mode) external {
        badRecipient = recipient;
        transferMode = mode;
    }

    function setReentry(AnyQuoteLedgerV1 ledger, address beneficiary) external {
        reentryLedger = ledger;
        reentryBeneficiary = beneficiary;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to == badRecipient) {
            if (transferMode == 1) revert RecipientRejected();
            if (transferMode == 2) {
                super._update(from, to, value - 1);
                super._update(from, address(0), 1);
                return;
            }
            if (transferMode == 3) {
                super._update(from, to, value);
                super._update(from, address(0), 1);
                return;
            }
            if (transferMode == 4) {
                reentryAttempted = true;
                bytes memory reason;
                (reentrySucceeded, reason) = address(reentryLedger)
                    .call(abi.encodeCall(AnyQuoteLedgerV1.claimQuoteFor, (address(this), reentryBeneficiary)));
                if (reason.length >= 4) reentryError = bytes4(reason);
            }
        }
        super._update(from, to, value);
    }
}

/// @dev Exercises real Core mint/settle/burn/take. It models the first fee accrual before the router settles quote.
///      This is a ledger fixture, not a substitute for the shared hook's swap and fee-delta integration tests.
contract LedgerHookFixture is IUnlockCallback {
    using SafeERC20 for IERC20;

    IPoolManager public immutable manager;
    AnyQuoteLedgerV1 public immutable ledger;
    uint256 public managerTokensAtAccrual;
    uint256 public ledgerTokensAtAccrual;
    uint256 public ledgerClaimsAtAccrual;

    constructor(IPoolManager manager_, address host, address admin) {
        manager = manager_;
        ledger = new AnyQuoteLedgerV1(manager_, host, admin);
    }

    function register(bytes32 launchId, address asset, address[] memory wallets, uint16[] memory shares) external {
        ledger.registerLaunch(launchId, asset, wallets, shares);
    }

    function accrue(address asset, bytes32 launchId, uint256 platform, uint256 creator, uint256 backing) external {
        manager.unlock(abi.encode(false, asset, msg.sender, launchId, platform, creator, backing));
    }

    function accrueWithoutMint(bytes32 launchId, uint256 platform, uint256 creator) external {
        ledger.accrueQuote(launchId, platform, creator);
    }

    function claimDuringOtherUnlock(address asset, address beneficiary) external {
        manager.unlock(abi.encode(true, asset, beneficiary, bytes32(0), uint256(0), uint256(0), uint256(0)));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "manager only");
        (
            bool claim,
            address asset,
            address payer,
            bytes32 launchId,
            uint256 platform,
            uint256 creator,
            uint256 backing
        ) = abi.decode(data, (bool, address, address, bytes32, uint256, uint256, uint256));
        if (claim) {
            ledger.claimQuoteFor(asset, payer);
            return bytes("");
        }
        manager.mint(address(ledger), uint256(uint160(asset)), backing);
        managerTokensAtAccrual = IERC20(asset).balanceOf(address(manager));
        ledgerTokensAtAccrual = IERC20(asset).balanceOf(address(ledger));
        ledgerClaimsAtAccrual = manager.balanceOf(address(ledger), uint256(uint160(asset)));
        ledger.accrueQuote(launchId, platform, creator);
        manager.sync(Currency.wrap(asset));
        IERC20(asset).safeTransferFrom(payer, address(manager), backing);
        require(manager.settle() == backing, "exact settlement");
        return bytes("");
    }
}

contract AnyQuoteLedgerV1Test is Test {
    bytes32 private constant LAUNCH = keccak256("any quote ledger launch");
    address private constant HOST = address(0x1001);
    address private constant ADMIN = address(0x1002);
    address private constant ALICE = address(0x2001);
    address private constant BOB = address(0x2002);
    address private constant CAROL = address(0x2003);
    address private constant DAVE = address(0x2004);
    address private constant ATTACKER = address(0x9999);

    IPoolManager private manager;
    LedgerQuoteToken private token;
    LedgerHookFixture private hook;
    AnyQuoteLedgerV1 private ledger;

    function setUp() public {
        vm.chainId(4663);
        manager = new PoolManager(address(this));
        token = new LedgerQuoteToken();
        hook = new LedgerHookFixture(manager, HOST, ADMIN);
        ledger = hook.ledger();
        token.mint(address(this), type(uint128).max);
        token.approve(address(hook), type(uint256).max);
        _register(LAUNCH, address(token), 2500);
    }

    function testFirstAccrualIsBackedBeforeAnyQuoteERC20Settlement() public {
        _accrue(30, 10);
        assertEq(hook.managerTokensAtAccrual(), 0);
        assertEq(hook.ledgerTokensAtAccrual(), 0);
        assertEq(hook.ledgerClaimsAtAccrual(), 40);
        assertEq(token.balanceOf(address(ledger)), 0);
        assertEq(token.balanceOf(address(manager)), 40);
        assertEq(_claims(address(token)), 40);
        assertEq(ledger.claimableQuote(address(token), Q.PLATFORM_RECIPIENT), 30);
        assertEq(ledger.claimableQuote(address(token), ALICE), 2);
        assertEq(ledger.claimableQuote(address(token), BOB), 7);
        assertEq(ledger.quoteDust(address(token)), 1);
        assertEq(ledger.platformFeeBps(LAUNCH), 30);
        _assertConservation(address(token));
    }

    function testClaimBurnsOwnCoreClaimsAndPaysExactQuote() public {
        _accrue(30, 10);
        vm.prank(ALICE);
        assertEq(ledger.claimQuoteTo(address(token), CAROL), 2);
        assertEq(token.balanceOf(CAROL), 2);
        assertEq(token.balanceOf(address(manager)), 38);
        assertEq(_claims(address(token)), 38);
        assertEq(ledger.claimableQuote(address(token), ALICE), 0);
        assertEq(ledger.claimedBy(address(token), ALICE), 2);
        assertEq(ledger.contributionByLaunch(LAUNCH, ALICE), 2);
        _assertConservation(address(token));
    }

    function testAccumulatedClaimsAboveCoreOperationLimitRemainFullyRecoverable() public {
        uint256 maximum = ledger.MAX_CLAIM_AMOUNT();
        _accrue(maximum, 0);
        _accrue(100, 0);
        assertEq(ledger.claimableQuote(address(token), Q.PLATFORM_RECIPIENT), maximum + 100);
        assertEq(ledger.claimQuoteFor(address(token), Q.PLATFORM_RECIPIENT), maximum);
        assertEq(ledger.claimableQuote(address(token), Q.PLATFORM_RECIPIENT), 100);
        assertEq(_claims(address(token)), 100);
        assertEq(ledger.claimQuoteFor(address(token), Q.PLATFORM_RECIPIENT), 100);
        assertEq(token.balanceOf(Q.PLATFORM_RECIPIENT), maximum + 100);
        assertEq(ledger.claimedBy(address(token), Q.PLATFORM_RECIPIENT), maximum + 100);
        assertEq(ledger.claimableQuote(address(token), Q.PLATFORM_RECIPIENT), 0);
        _assertConservation(address(token));
    }

    function testZeroRoundedFeesAreAcceptedWithoutBackingOrTokenTransfer() public {
        hook.accrueWithoutMint(LAUNCH, 0, 0);
        assertEq(ledger.totalReceived(address(token)), 0);
        assertEq(ledger.totalCredited(address(token)), 0);
        _accrue(30, 10);
        hook.accrueWithoutMint(LAUNCH, 0, 0);
        assertEq(ledger.totalReceived(address(token)), 40);
        _assertConservation(address(token));
    }

    function testAnyoneCanClaimOnlyToTheCreditedBeneficiary() public {
        _accrue(30, 10);
        vm.prank(ATTACKER);
        assertEq(ledger.claimQuoteFor(address(token), BOB), 7);
        assertEq(token.balanceOf(BOB), 7);
        assertEq(token.balanceOf(ATTACKER), 0);
        vm.prank(ATTACKER);
        vm.expectRevert(AnyQuoteLedgerV1.NoClaim.selector);
        ledger.claimQuoteTo(address(token), ATTACKER);
        _assertConservation(address(token));
    }

    function testUnderbackedAccrualRevertsMintAndAccounting() public {
        vm.expectRevert(AnyQuoteLedgerV1.InsufficientBacking.selector);
        hook.accrue(address(token), LAUNCH, 30, 10, 39);
        assertEq(_claims(address(token)), 0);
        assertEq(ledger.totalReceived(address(token)), 0);
        assertEq(token.balanceOf(address(manager)), 0);
    }

    function testERC20DonationCannotReplace6909Backing() public {
        token.mint(address(ledger), 100);
        vm.expectRevert(AnyQuoteLedgerV1.InsufficientBacking.selector);
        hook.accrueWithoutMint(LAUNCH, 30, 10);
        assertEq(ledger.totalReceived(address(token)), 0);
        assertEq(token.balanceOf(address(ledger)), 100);
    }

    function testDustRemainsBackedAndCannotBeAccruedAgain() public {
        _accrue(0, 1);
        assertEq(ledger.quoteDust(address(token)), 1);
        assertEq(ledger.outstandingClaims(address(token)), 0);
        vm.expectRevert(AnyQuoteLedgerV1.InsufficientBacking.selector);
        hook.accrueWithoutMint(LAUNCH, 0, 1);
        assertEq(ledger.totalReceived(address(token)), 1);
        _assertConservation(address(token));
    }

    function testClaimFailurePreservesClaimsAndDoesNotBlockAccrualOrOtherBeneficiaries() public {
        _accrue(30, 10);
        token.setTransferMode(ALICE, 1);
        vm.expectRevert();
        ledger.claimQuoteFor(address(token), ALICE);
        assertEq(ledger.claimableQuote(address(token), ALICE), 2);
        assertEq(ledger.claimedBy(address(token), ALICE), 0);
        assertEq(ledger.totalClaimed(address(token)), 0);
        assertEq(_claims(address(token)), 40);
        _accrue(30, 10);
        assertEq(ledger.claimableQuote(address(token), ALICE), 5);
        assertEq(ledger.claimQuoteFor(address(token), BOB), 15);
        vm.prank(ALICE);
        assertEq(ledger.claimQuoteTo(address(token), CAROL), 5);
        _assertConservation(address(token));
    }

    function testRecipientUnderpaymentRevertsWholeClaim() public {
        _accrue(30, 10);
        token.setTransferMode(ALICE, 2);
        vm.expectRevert(AnyQuoteLedgerV1.InvalidTransfer.selector);
        ledger.claimQuoteFor(address(token), ALICE);
        assertEq(token.balanceOf(ALICE), 0);
        assertEq(token.balanceOf(address(manager)), 40);
        assertEq(_claims(address(token)), 40);
        assertEq(ledger.claimableQuote(address(token), ALICE), 2);
        assertEq(ledger.totalClaimed(address(token)), 0);
    }

    function testExcessManagerDebitRevertsWholeClaim() public {
        _accrue(30, 10);
        token.setTransferMode(ALICE, 3);
        vm.expectRevert(AnyQuoteLedgerV1.InvalidTransfer.selector);
        ledger.claimQuoteFor(address(token), ALICE);
        assertEq(token.balanceOf(ALICE), 0);
        assertEq(token.balanceOf(address(manager)), 40);
        assertEq(_claims(address(token)), 40);
        assertEq(ledger.claimableQuote(address(token), ALICE), 2);
        assertEq(ledger.totalClaimed(address(token)), 0);
    }

    function testTransferCallbackCannotReenterAnotherClaim() public {
        _accrue(30, 10);
        token.setTransferMode(BOB, 4);
        token.setReentry(ledger, ALICE);
        ledger.claimQuoteFor(address(token), BOB);
        assertTrue(token.reentryAttempted());
        assertFalse(token.reentrySucceeded());
        assertEq(token.reentryError(), ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        assertEq(ledger.claimableQuote(address(token), ALICE), 2);
        assertEq(token.balanceOf(BOB), 7);
        _assertConservation(address(token));
    }

    function testClaimCannotJoinAnUnrelatedUnlockAndRemainsClaimable() public {
        _accrue(30, 10);
        vm.expectRevert(IPoolManager.AlreadyUnlocked.selector);
        hook.claimDuringOtherUnlock(address(token), ALICE);
        assertEq(ledger.claimableQuote(address(token), ALICE), 2);
        assertEq(ledger.totalClaimed(address(token)), 0);
        assertEq(_claims(address(token)), 40);
        ledger.claimQuoteFor(address(token), ALICE);
        _assertConservation(address(token));
    }

    function testUnlockCallbackRequiresBothAuthenticManagerAndActiveClaim() public {
        bytes memory data = abi.encode(address(token), ALICE, uint256(1));
        vm.expectRevert(AnyQuoteLedgerV1.UnauthorizedCallback.selector);
        ledger.unlockCallback(data);
        vm.prank(address(manager));
        vm.expectRevert(AnyQuoteLedgerV1.UnauthorizedCallback.selector);
        ledger.unlockCallback(data);
    }

    function testCreatorRotationPreservesOldClaimsAndLifetimeRounding() public {
        _accrue(30, 10);
        vm.prank(ALICE);
        ledger.changeCreatorWallet(LAUNCH, 0, CAROL);
        token.setTransferMode(CAROL, 1);
        _accrue(30, 10);
        assertEq(ledger.claimableQuote(address(token), ALICE), 2);
        assertEq(ledger.claimableQuote(address(token), CAROL), 3);
        assertEq(ledger.claimableQuote(address(token), BOB), 15);
        assertEq(ledger.quoteDust(address(token)), 0);
        (address[] memory wallets, uint16[] memory shares,) = ledger.creatorRecipients(LAUNCH);
        assertEq(wallets[0], CAROL);
        assertEq(wallets[1], BOB);
        assertEq(shares[0], 2500);
        assertEq(shares[1], 7500);
        vm.prank(ALICE);
        vm.expectRevert(AnyQuoteLedgerV1.UnauthorizedWalletChange.selector);
        ledger.changeCreatorWallet(LAUNCH, 0, DAVE);
        vm.prank(ALICE);
        ledger.claimQuoteTo(address(token), DAVE);
        assertEq(token.balanceOf(DAVE), 2);
        _assertConservation(address(token));
    }

    function testPlatformRotationAffectsFutureBaseCreditsOnly() public {
        _accrue(30, 10);
        vm.prank(Q.PLATFORM_RECIPIENT);
        ledger.changePlatformWallet(CAROL);
        token.setTransferMode(CAROL, 1);
        _accrue(30, 10);
        assertEq(ledger.treasury(), CAROL);
        assertEq(ledger.claimableQuote(address(token), Q.PLATFORM_RECIPIENT), 30);
        assertEq(ledger.claimableQuote(address(token), CAROL), 30);
        assertEq(ledger.claimQuoteFor(address(token), Q.PLATFORM_RECIPIENT), 30);
        vm.prank(Q.PLATFORM_RECIPIENT);
        vm.expectRevert(AnyQuoteLedgerV1.UnauthorizedWalletChange.selector);
        ledger.changePlatformWallet(DAVE);
        vm.prank(ADMIN);
        ledger.changePlatformWallet(DAVE);
        _accrue(30, 0);
        assertEq(ledger.claimableQuote(address(token), CAROL), 30);
        assertEq(ledger.claimableQuote(address(token), DAVE), 30);
        _assertConservation(address(token));
    }

    function testCreatorAdminReplacementPreservesSharesConfigurationAndHistory() public {
        _accrue(30, 10);
        bytes32 originalConfiguration = ledger.configurationHash(LAUNCH);
        address[] memory next = _wallets(CAROL, DAVE);
        vm.prank(ADMIN);
        ledger.replaceCreatorWallets(LAUNCH, next, 0, block.timestamp + 100);
        _accrue(30, 10);
        assertEq(ledger.claimableQuote(address(token), ALICE), 2);
        assertEq(ledger.claimableQuote(address(token), BOB), 7);
        assertEq(ledger.claimableQuote(address(token), CAROL), 3);
        assertEq(ledger.claimableQuote(address(token), DAVE), 8);
        assertEq(ledger.configurationHash(LAUNCH), originalConfiguration);
        (, uint16[] memory shares, uint256 revision) = ledger.creatorRecipients(LAUNCH);
        assertEq(shares[0], 2500);
        assertEq(shares[1], 7500);
        assertEq(revision, 1);
        vm.prank(ADMIN);
        vm.expectRevert(AnyQuoteLedgerV1.UnauthorizedWalletChange.selector);
        ledger.replaceCreatorWallets(LAUNCH, next, 0, block.timestamp + 100);
        vm.prank(ADMIN);
        vm.expectRevert(AnyQuoteLedgerV1.UnauthorizedWalletChange.selector);
        ledger.replaceCreatorWallets(LAUNCH, next, 1, block.timestamp - 1);
    }

    function testAuthorityDoesNotLetTreasuryOrOneCreatorChangeOtherCreatorSlots() public {
        address[] memory next = _wallets(CAROL, DAVE);
        vm.prank(Q.PLATFORM_RECIPIENT);
        vm.expectRevert(AnyQuoteLedgerV1.UnauthorizedWalletChange.selector);
        ledger.replaceCreatorWallets(LAUNCH, next, 0, block.timestamp + 100);
        vm.prank(Q.PLATFORM_RECIPIENT);
        vm.expectRevert(AnyQuoteLedgerV1.UnauthorizedWalletChange.selector);
        ledger.changeCreatorWallet(LAUNCH, 0, CAROL);
        vm.prank(ALICE);
        vm.expectRevert(AnyQuoteLedgerV1.UnauthorizedWalletChange.selector);
        ledger.changeCreatorWallet(LAUNCH, 1, CAROL);
        vm.prank(ALICE);
        vm.expectRevert(AnyQuoteLedgerV1.UnauthorizedWalletChange.selector);
        ledger.changePlatformWallet(CAROL);
        vm.prank(ADMIN);
        ledger.changeCreatorWallet(LAUNCH, 1, CAROL);
        (address[] memory wallets,,) = ledger.creatorRecipients(LAUNCH);
        assertEq(wallets[0], ALICE);
        assertEq(wallets[1], CAROL);
    }

    function testOnlyDeployingHookCanRegisterAndAccrue() public {
        assertEq(ledger.hook(), address(hook));
        assertEq(ledger.host(), HOST);
        assertEq(address(ledger.poolManager()), address(manager));
        assertEq(ledger.rewardAdmin(), ADMIN);
        vm.prank(HOST);
        vm.expectRevert(AnyQuoteLedgerV1.UnauthorizedHook.selector);
        ledger.registerLaunch(bytes32(uint256(2)), address(token), _wallets(ALICE, BOB), _shares(2500));
        vm.prank(HOST);
        vm.expectRevert(AnyQuoteLedgerV1.UnauthorizedHook.selector);
        ledger.accrueQuote(LAUNCH, 1, 1);
        vm.prank(ADMIN);
        vm.expectRevert(AnyQuoteLedgerV1.UnauthorizedHook.selector);
        ledger.accrueQuote(LAUNCH, 1, 1);
    }

    function testRegistrationRejectsMutableOrInvalidAllocation() public {
        vm.expectRevert(AnyQuoteLedgerV1.InvalidConfiguration.selector);
        _register(LAUNCH, address(token), 5000);
        vm.expectRevert(AnyQuoteLedgerV1.InvalidConfiguration.selector);
        _register(bytes32(0), address(token), 5000);
        vm.expectRevert(AnyQuoteLedgerV1.InvalidConfiguration.selector);
        _register(bytes32(uint256(2)), address(0), 5000);
        vm.expectRevert(AnyQuoteLedgerV1.InvalidConfiguration.selector);
        _register(bytes32(uint256(2)), address(token), 0);
        uint16[] memory shares = _shares(5000);
        shares[1] = 4999;
        vm.expectRevert(AnyQuoteLedgerV1.InvalidConfiguration.selector);
        hook.register(bytes32(uint256(2)), address(token), _wallets(ALICE, BOB), shares);
        vm.expectRevert(AnyQuoteLedgerV1.InvalidConfiguration.selector);
        hook.register(bytes32(uint256(2)), address(token), _wallets(address(ledger), BOB), _shares(5000));
    }

    function testInvalidRotationsDoNotChangeBeneficiary() public {
        address[5] memory invalid = [address(0), HOST, address(hook), address(ledger), address(manager)];
        for (uint256 i; i < invalid.length; ++i) {
            vm.prank(ALICE);
            vm.expectRevert(AnyQuoteLedgerV1.InvalidConfiguration.selector);
            ledger.changeCreatorWallet(LAUNCH, 0, invalid[i]);
            vm.prank(Q.PLATFORM_RECIPIENT);
            vm.expectRevert(AnyQuoteLedgerV1.InvalidConfiguration.selector);
            ledger.changePlatformWallet(invalid[i]);
        }
        (address[] memory wallets,,) = ledger.creatorRecipients(LAUNCH);
        assertEq(wallets[0], ALICE);
        assertEq(ledger.treasury(), Q.PLATFORM_RECIPIENT);
    }

    function testSeparateQuoteAssetsCannotCrossBackLiabilities() public {
        LedgerQuoteToken other = new LedgerQuoteToken();
        bytes32 otherLaunch = keccak256("other quote");
        _register(otherLaunch, address(other), 5000);
        _accrue(30, 10);
        vm.expectRevert(AnyQuoteLedgerV1.InsufficientBacking.selector);
        hook.accrueWithoutMint(otherLaunch, 1, 0);
        other.mint(address(this), 100);
        other.approve(address(hook), 100);
        hook.accrue(address(other), otherLaunch, 30, 10, 40);
        ledger.claimQuoteFor(address(other), ALICE);
        assertEq(other.balanceOf(ALICE), 5);
        assertEq(token.balanceOf(ALICE), 0);
        assertEq(ledger.claimableQuote(address(token), ALICE), 2);
        _assertConservation(address(token));
        _assertConservation(address(other));
    }

    function testFuzzLifetimeAllocationDoesNotDependOnAccrualPartition(uint96 first, uint96 second, uint16 share)
        public
    {
        uint256 a = bound(uint256(first), 1, 1e24);
        uint256 b = bound(uint256(second), 1, 1e24);
        uint16 aliceShare = uint16(bound(uint256(share), 1, 9999));
        bytes32 split = keccak256("split accrual");
        bytes32 whole = keccak256("whole accrual");
        _register(split, address(token), aliceShare);
        _register(whole, address(token), aliceShare);
        hook.accrue(address(token), split, 13, a, a + 13);
        hook.accrue(address(token), split, 17, b, b + 17);
        hook.accrue(address(token), whole, 30, a + b, a + b + 30);
        uint256 expectedAlice = (a + b) * aliceShare / 10_000;
        uint256 expectedBob = (a + b) * (10_000 - aliceShare) / 10_000;
        assertEq(ledger.contributionByLaunch(split, ALICE), expectedAlice);
        assertEq(ledger.contributionByLaunch(whole, ALICE), expectedAlice);
        assertEq(ledger.contributionByLaunch(split, BOB), expectedBob);
        assertEq(ledger.contributionByLaunch(whole, BOB), expectedBob);
        assertEq(ledger.contributionByLaunch(split, Q.PLATFORM_RECIPIENT), 30);
        assertEq(ledger.contributionByLaunch(whole, Q.PLATFORM_RECIPIENT), 30);
        assertEq(ledger.quoteDust(address(token)), 2 * (a + b - expectedAlice - expectedBob));
        _assertConservation(address(token));
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
        hook.accrue(address(token), LAUNCH, platform, creator, platform + creator);
    }

    function _claims(address asset) private view returns (uint256) {
        return manager.balanceOf(address(ledger), uint256(uint160(asset)));
    }

    function _assertConservation(address asset) private view {
        assertEq(_claims(asset), ledger.totalReceived(asset) - ledger.totalClaimed(asset));
        assertEq(_claims(asset), ledger.outstandingClaims(asset) + ledger.quoteDust(asset));
    }
}
