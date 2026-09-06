// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { CurrencySettler } from "@openzeppelin/uniswap-hooks/src/utils/CurrencySettler.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { Test } from "forge-std/Test.sol";

import {
    ClassicModuleFeeLedgerV1,
    IClassicModuleAuthorRegistry
} from "../../src/classic-modules/ClassicModuleFeeLedgerV1.sol";

/// @dev Registry authorization is tested by the registry suite; this fixture controls historical payout transitions.
contract LedgerAuthorRegistryFixture is IClassicModuleAuthorRegistry {
    mapping(bytes32 => address) public override authorWallet;

    function setWallet(bytes32 family, address wallet) external {
        authorWallet[family] = wallet;
    }
}

    /// @dev Uses real PoolManager settlement and native ERC-6909 claims, rather than a mock balance sheet.
    contract LedgerHookFixture is IUnlockCallback {
        using CurrencySettler for Currency;

        IPoolManager public immutable manager;
        ClassicModuleFeeLedgerV1 public immutable ledger;

        constructor(
            IPoolManager manager_,
            IClassicModuleAuthorRegistry registry,
            address treasury,
            address admin,
            address reserve
        ) {
            manager = manager_;
            ledger = new ClassicModuleFeeLedgerV1(manager_, registry, treasury, admin, reserve);
        }

        function registerPool(
            bytes32 pool,
            address[] memory creators,
            uint16[] memory shares,
            bytes32[] memory families
        ) external {
            ledger.registerPool(pool, creators, shares, families);
        }

        function fundAndAccrue(bytes32 pool, uint256 platformFee, uint256 creatorFee) external payable {
            require(msg.value == platformFee + creatorFee, "fixture funding mismatch");
            manager.unlock(abi.encode(pool, platformFee, creatorFee));
        }

        function accrueWithoutFunding(bytes32 pool, uint256 platformFee, uint256 creatorFee) external {
            ledger.accrue(pool, platformFee, creatorFee);
        }

        function unlockCallback(bytes calldata data) external override returns (bytes memory) {
            require(msg.sender == address(manager), "fixture caller");
            (bytes32 pool, uint256 platformFee, uint256 creatorFee) = abi.decode(data, (bytes32, uint256, uint256));
            uint256 total = platformFee + creatorFee;
            Currency native = Currency.wrap(address(0));
            native.settle(manager, address(this), total, false);
            native.take(manager, address(ledger), total, true);
            ledger.accrue(pool, platformFee, creatorFee);
            return "";
        }
    }

    contract LedgerRevertingRecipient {
        function claimTo(ClassicModuleFeeLedgerV1 ledger, address recipient) external {
            ledger.claimTo(recipient);
        }

        receive() external payable {
            revert("recipient refuses native currency");
        }
    }

    contract LedgerReentrantRecipient {
        ClassicModuleFeeLedgerV1 public immutable ledger;
        bool public attempted;
        bool public succeeded;
        bytes4 public failureSelector;

        constructor(ClassicModuleFeeLedgerV1 ledger_) {
            ledger = ledger_;
        }

        receive() external payable {
            attempted = true;
            bytes memory result;
            (succeeded, result) = address(ledger).call(abi.encodeWithSignature("claim(address)", address(this)));
            if (result.length >= 4) failureSelector = bytes4(result);
        }
    }

    contract ClassicModuleFeeLedgerV1Test is Test {
        bytes32 private constant FIRST_POOL = bytes32(uint256(101));
        bytes32 private constant SECOND_POOL = bytes32(uint256(102));
        address private constant TREASURY = address(0x1111);
        address private constant ADMIN = address(0x2222);
        address private constant RESERVE = address(0x3333);
        address private constant REPLACEMENT = address(0x4444);

        PoolManager private manager;
        LedgerAuthorRegistryFixture private registry;
        LedgerHookFixture private hook;
        ClassicModuleFeeLedgerV1 private ledger;

        function setUp() public {
            manager = new PoolManager(address(this));
            registry = new LedgerAuthorRegistryFixture();
            hook = new LedgerHookFixture(IPoolManager(address(manager)), registry, TREASURY, ADMIN, RESERVE);
            ledger = hook.ledger();
            for (uint256 index = 1; index <= 9; index++) {
                registry.setWallet(bytes32(index), _author(index));
            }
            vm.deal(address(this), 1e38);
        }

        function test_constructorBindsImmutableDependenciesAndNoModuleDestination() public view {
            assertEq(address(ledger.poolManager()), address(manager));
            assertEq(address(ledger.registry()), address(registry));
            assertEq(ledger.hook(), address(hook));
            assertEq(ledger.treasury(), TREASURY);
            assertEq(ledger.rewardAdmin(), ADMIN);
            assertEq(ledger.noModuleRecipient(), RESERVE);
        }

        function test_constructorRejectsMissingDependenciesAndZeroRecipients() public {
            vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV1.InvalidDependency.selector, address(0)));
            new ClassicModuleFeeLedgerV1(IPoolManager(address(0)), registry, TREASURY, ADMIN, RESERVE);
            vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV1.InvalidDependency.selector, address(0)));
            new ClassicModuleFeeLedgerV1(
                IPoolManager(address(manager)), IClassicModuleAuthorRegistry(address(0)), TREASURY, ADMIN, RESERVE
            );
            for (uint256 index; index < 3; index++) {
                vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV1.InvalidWallet.selector, address(0)));
                new ClassicModuleFeeLedgerV1(
                    IPoolManager(address(manager)),
                    registry,
                    index == 0 ? address(0) : TREASURY,
                    index == 1 ? address(0) : ADMIN,
                    index == 2 ? address(0) : RESERVE
                );
            }
        }

        function test_registrationSupportsTenCreatorSlotsAndArbitraryBps() public {
            address[] memory creators = _creators(10);
            uint16[] memory shares = new uint16[](10);
            for (uint256 index; index < 9; index++) {
                shares[index] = uint16(index + 1);
            }
            shares[9] = 9955;
            hook.registerPool(FIRST_POOL, creators, shares, _families(8));
            assertTrue(ledger.registered(FIRST_POOL));
            assertEq(ledger.creatorCount(FIRST_POOL), 10);
            assertEq(ledger.moduleCount(FIRST_POOL), 8);
            for (uint256 index; index < 10; index++) {
                assertEq(ledger.creatorWalletAt(FIRST_POOL, index), creators[index]);
                assertEq(ledger.creatorShareBpsAt(FIRST_POOL, index), shares[index]);
            }
            assertEq(ledger.moduleFamilyAt(FIRST_POOL, 7), bytes32(uint256(8)));
            assertEq(
                ledger.configurationHash(FIRST_POOL),
                keccak256(
                    abi.encode(
                        block.chainid, address(ledger), address(hook), FIRST_POOL, creators, shares, _families(8)
                    )
                )
            );
        }

        function test_registrationAndAccrualAreHookOnlyAndCannotReplaceConfiguration() public {
            vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV1.UnauthorizedHook.selector, address(this)));
            ledger.registerPool(FIRST_POOL, _creators(1), _shares1(), _families(2));
            _register(FIRST_POOL, 2);
            vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV1.PoolAlreadyRegistered.selector, FIRST_POOL));
            _register(FIRST_POOL, 3);
            vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV1.UnauthorizedHook.selector, address(this)));
            ledger.accrue(FIRST_POOL, 0, 0);
            vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV1.PoolNotRegistered.selector, SECOND_POOL));
            hook.accrueWithoutFunding(SECOND_POOL, 0, 0);
        }

        function test_registrationRejectsInvalidCreatorCountsWalletsAndShares() public {
            vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV1.InvalidCreatorCount.selector, 0));
            hook.registerPool(FIRST_POOL, _creators(0), new uint16[](0), _families(0));
            vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV1.InvalidCreatorCount.selector, 11));
            hook.registerPool(FIRST_POOL, _creators(11), new uint16[](11), _families(0));
            vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV1.InvalidCreatorCount.selector, 1));
            hook.registerPool(FIRST_POOL, _creators(1), new uint16[](0), _families(0));
            address[] memory creators = _creators(1);
            creators[0] = address(0);
            vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV1.InvalidWallet.selector, address(0)));
            hook.registerPool(FIRST_POOL, creators, _shares1(), _families(0));
            vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV1.InvalidCreatorShare.selector, 0, uint16(0)));
            hook.registerPool(FIRST_POOL, _creators(1), new uint16[](1), _families(0));
            uint16[] memory shares = _shares1();
            shares[0] = 9999;
            vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV1.InvalidShareTotal.selector, 9999));
            hook.registerPool(FIRST_POOL, _creators(1), shares, _families(0));
        }

        function test_registrationRejectsUnknownDuplicateUnsortedOrTooManyFamilies() public {
            vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV1.InvalidModuleCount.selector, 9));
            _register(FIRST_POOL, 9);
            bytes32[] memory families = _families(2);
            families[0] = bytes32(0);
            vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV1.InvalidModuleFamily.selector, bytes32(0)));
            hook.registerPool(FIRST_POOL, _creators(1), _shares1(), families);
            families = _families(2);
            families[1] = families[0];
            vm.expectRevert(
                abi.encodeWithSelector(
                    ClassicModuleFeeLedgerV1.ModuleFamiliesNotStrictlyOrdered.selector, families[0], families[1]
                )
            );
            hook.registerPool(FIRST_POOL, _creators(1), _shares1(), families);
            families[0] = bytes32(uint256(2));
            vm.expectRevert(
                abi.encodeWithSelector(
                    ClassicModuleFeeLedgerV1.ModuleFamiliesNotStrictlyOrdered.selector, families[0], families[1]
                )
            );
            hook.registerPool(FIRST_POOL, _creators(1), _shares1(), families);
            families = _families(1);
            families[0] = bytes32(uint256(10));
            vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV1.InvalidWallet.selector, address(0)));
            hook.registerPool(FIRST_POOL, _creators(1), _shares1(), families);
        }

        function test_equalSlotsForTwoThreeFiveAndEightFamilies() public {
            uint256[4] memory counts = [uint256(2), 3, 5, 8];
            for (uint256 testIndex; testIndex < counts.length; testIndex++) {
                uint256 count = counts[testIndex];
                bytes32 pool = bytes32(testIndex + 1);
                _register(pool, count);
                _accrue(pool, 2003, 0);
                assertEq(ledger.contributionByPool(pool, TREASURY), 1001);
                for (uint256 index = 1; index <= count; index++) {
                    assertEq(ledger.contributionByPool(pool, _author(index)), 1001 / count);
                }
                (uint256 received, uint256 credited, uint256 reserved) = ledger.poolTotals(pool);
                assertEq(received, 2003);
                assertEq(credited, 1001 + (1001 / count) * count);
                assertEq(reserved, 1 + 1001 % count);
            }
            _assertSolvent();
        }

        function test_zeroModulesPayTheExplicitReserveAndNeverDoubleTreasury() public {
            _register(FIRST_POOL, 0);
            _accrue(FIRST_POOL, 101, 0);
            assertEq(ledger.claimable(TREASURY), 50);
            assertEq(ledger.claimable(RESERVE), 50);
            assertEq(ledger.dust(), 1);
            _accrue(FIRST_POOL, 1, 0);
            assertEq(ledger.claimable(TREASURY), 51);
            assertEq(ledger.claimable(RESERVE), 51);
            assertEq(ledger.dust(), 0);
            _assertSolvent();
        }

        function test_twoDifferentFamiliesOwnedByOneWalletGetTwoSlots() public {
            registry.setWallet(bytes32(uint256(2)), _author(1));
            _register(FIRST_POOL, 3);
            _accrue(FIRST_POOL, 600, 0);
            assertEq(ledger.claimable(_author(1)), 200);
            assertEq(ledger.claimable(_author(2)), 0);
            assertEq(ledger.claimable(_author(3)), 100);
            assertEq(ledger.claimable(TREASURY), 300);
            _assertSolvent();
        }

        function test_oneWeiFragmentationMatchesOneAccrualIncludingCreatorDust() public {
            _registerThreeCreators(FIRST_POOL, 3);
            _registerThreeCreators(SECOND_POOL, 3);
            _accrue(FIRST_POOL, 401, 401);
            for (uint256 index; index < 401; index++) {
                _accrue(SECOND_POOL, 1, 1);
            }
            _assertSameContributions(FIRST_POOL, SECOND_POOL, 3);
            (,, uint256 firstDust) = ledger.poolTotals(FIRST_POOL);
            (,, uint256 secondDust) = ledger.poolTotals(SECOND_POOL);
            assertEq(firstDust, secondDust);
            _assertSolvent();
        }

        function test_allZeroAccrualIsNoOp() public {
            _register(FIRST_POOL, 8);
            _accrue(FIRST_POOL, 0, 0);
            assertEq(ledger.totalFeesReceived(), 0);
            assertEq(ledger.totalCredited(), 0);
            assertEq(ledger.dust(), 0);
            assertEq(ledger.backing(), 0);
        }

        function test_authorRotationAcrossPoolsPreservesOldUnclaimedCredits() public {
            _register(FIRST_POOL, 3);
            _register(SECOND_POOL, 3);
            _accrue(FIRST_POOL, 600, 0);
            _accrue(SECOND_POOL, 1200, 0);
            registry.setWallet(bytes32(uint256(1)), REPLACEMENT);
            _accrue(FIRST_POOL, 600, 0);
            _accrue(SECOND_POOL, 600, 0);
            assertEq(ledger.claimable(_author(1)), 300);
            assertEq(ledger.claimable(REPLACEMENT), 200);
            assertEq(ledger.contributionByPool(FIRST_POOL, _author(1)), 100);
            assertEq(ledger.contributionByPool(SECOND_POOL, _author(1)), 200);
            ledger.claim(_author(1));
            assertEq(_author(1).balance, 300);
            assertEq(ledger.claimable(REPLACEMENT), 200);
            _assertSolvent();
        }

        function test_creatorRotationPreservesSharesConfigurationAndOldClaims() public {
            _registerThreeCreators(FIRST_POOL, 2);
            bytes32 configHash = ledger.configurationHash(FIRST_POOL);
            _accrue(FIRST_POOL, 0, 10_000);
            vm.prank(_creator(0));
            ledger.changeCreatorWallet(FIRST_POOL, 0, REPLACEMENT);
            _accrue(FIRST_POOL, 0, 10_000);
            assertEq(ledger.claimable(_creator(0)), 3333);
            assertEq(ledger.claimable(REPLACEMENT), 3333);
            assertEq(ledger.creatorShareBpsAt(FIRST_POOL, 0), 3333);
            assertEq(ledger.configurationHash(FIRST_POOL), configHash);
            ledger.claim(_creator(0));
            assertEq(_creator(0).balance, 3333);
            assertEq(ledger.claimable(REPLACEMENT), 3333);
            _assertSolvent();
        }

        function test_creatorAdminAndTreasuryCanOnlyRotateFutureWallets() public {
            _register(FIRST_POOL, 0);
            _accrue(FIRST_POOL, 0, 100);
            address[] memory replacements = new address[](1);
            replacements[0] = REPLACEMENT;
            vm.prank(ADMIN);
            ledger.replaceCreatorWallets(FIRST_POOL, replacements, 0, block.timestamp + 1 hours);
            _accrue(FIRST_POOL, 0, 200);
            replacements[0] = ADMIN;
            vm.prank(TREASURY);
            ledger.replaceCreatorWallets(FIRST_POOL, replacements, 1, block.timestamp + 1 hours);
            _accrue(FIRST_POOL, 0, 300);
            assertEq(ledger.claimable(_creator(0)), 100);
            assertEq(ledger.claimable(REPLACEMENT), 200);
            assertEq(ledger.claimable(ADMIN), 300);
            assertEq(ledger.creatorShareBpsAt(FIRST_POOL, 0), 10_000);
            assertEq(ledger.creatorAdminRevision(FIRST_POOL), 2);
        }

        function test_ctoConsolidatesAllSlotsWithoutMovingOldCreditsOrAuthorFees() public {
            _registerThreeCreators(FIRST_POOL, 2);
            bytes32 original = ledger.configurationHash(FIRST_POOL);
            _accrue(FIRST_POOL, 200, 10_000);
            address[] memory wallets = new address[](3);
            for (uint256 i; i < 3; ++i) {
                wallets[i] = REPLACEMENT;
            }
            vm.prank(ADMIN);
            ledger.replaceCreatorWallets(FIRST_POOL, wallets, 0, block.timestamp + 1 hours);
            _accrue(FIRST_POOL, 200, 10_000);
            assertEq(ledger.claimable(REPLACEMENT), 10_000);
            assertEq(ledger.claimable(_creator(0)), 3333);
            assertEq(ledger.claimable(_creator(1)), 3333);
            assertEq(ledger.claimable(_creator(2)), 3334);
            assertEq(ledger.claimable(TREASURY), 200);
            assertEq(ledger.claimable(_author(1)), 100);
            assertEq(ledger.claimable(_author(2)), 100);
            assertEq(ledger.configurationHash(FIRST_POOL), original);
            (address[] memory current, uint16[] memory shares, uint256 revision) = ledger.creatorRecipients(FIRST_POOL);
            assertEq(current, wallets);
            assertEq(shares[0], 3333);
            assertEq(shares[2], 3334);
            assertEq(revision, 1);
            vm.expectRevert(
                abi.encodeWithSelector(ClassicModuleFeeLedgerV1.UnauthorizedWalletRotation.selector, _creator(0))
            );
            vm.prank(_creator(0));
            ledger.changeCreatorWallet(FIRST_POOL, 0, _creator(0));
            ledger.claim(_creator(0));
            assertEq(_creator(0).balance, 3333);
            _assertSolvent();
        }

        function test_ctoRejectsStaleAdminActionsButOwnerSelfRotationCannotVetoIt() public {
            _registerThreeCreators(FIRST_POOL, 0);
            address[] memory wallets = _creators(3);
            wallets[0] = REPLACEMENT;
            vm.prank(_creator(1));
            ledger.changeCreatorWallet(FIRST_POOL, 1, address(0x7777));
            assertEq(ledger.creatorAdminRevision(FIRST_POOL), 0);
            vm.prank(ADMIN);
            ledger.replaceCreatorWallets(FIRST_POOL, wallets, 0, block.timestamp + 1 hours);
            assertEq(ledger.creatorWalletAt(FIRST_POOL, 1), _creator(1));
            wallets[0] = address(0x8888);
            vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV1.StaleCreatorAdminRevision.selector, 0, 1));
            vm.prank(TREASURY);
            ledger.replaceCreatorWallets(FIRST_POOL, wallets, 0, block.timestamp + 1 hours);
            assertEq(ledger.creatorWalletAt(FIRST_POOL, 0), REPLACEMENT);
            vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV1.UnauthorizedWalletRotation.selector, ADMIN));
            vm.prank(ADMIN);
            ledger.changeCreatorWallet(FIRST_POOL, 0, address(0x8888));
        }

        function test_ctoRejectsExpiredUnauthorizedAndInvalidBatchesAtomically() public {
            _registerThreeCreators(FIRST_POOL, 0);
            address[] memory wallets = _creators(3);
            vm.expectRevert(
                abi.encodeWithSelector(ClassicModuleFeeLedgerV1.UnauthorizedWalletRotation.selector, _creator(0))
            );
            vm.prank(_creator(0));
            ledger.replaceCreatorWallets(FIRST_POOL, wallets, 0, block.timestamp + 1 hours);
            vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV1.CreatorAdminDeadlineExpired.selector, 0));
            vm.prank(ADMIN);
            ledger.replaceCreatorWallets(FIRST_POOL, wallets, 0, 0);
            uint256 deadline = block.timestamp;
            vm.warp(deadline + 1);
            vm.expectRevert(
                abi.encodeWithSelector(ClassicModuleFeeLedgerV1.CreatorAdminDeadlineExpired.selector, deadline)
            );
            vm.prank(ADMIN);
            ledger.replaceCreatorWallets(FIRST_POOL, wallets, 0, deadline);
            wallets[0] = REPLACEMENT;
            wallets[2] = address(0);
            vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV1.InvalidWallet.selector, address(0)));
            vm.prank(ADMIN);
            ledger.replaceCreatorWallets(FIRST_POOL, wallets, 0, block.timestamp + 1 hours);
            assertEq(ledger.creatorWalletAt(FIRST_POOL, 0), _creator(0));
            assertEq(ledger.creatorAdminRevision(FIRST_POOL), 0);
            vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV1.InvalidCreatorCount.selector, 1));
            vm.prank(ADMIN);
            ledger.replaceCreatorWallets(FIRST_POOL, new address[](1), 0, block.timestamp + 1 hours);
        }

        function test_ctoReaffirmationCancelsAnOlderPendingAdminDecision() public {
            _register(FIRST_POOL, 0);
            address[] memory current = _creators(1);
            vm.prank(ADMIN);
            ledger.replaceCreatorWallets(FIRST_POOL, current, 0, block.timestamp + 1 hours);
            assertEq(ledger.creatorAdminRevision(FIRST_POOL), 1);
            current[0] = REPLACEMENT;
            vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV1.StaleCreatorAdminRevision.selector, 0, 1));
            vm.prank(TREASURY);
            ledger.replaceCreatorWallets(FIRST_POOL, current, 0, block.timestamp + 1 hours);
            assertEq(ledger.creatorWalletAt(FIRST_POOL, 0), _creator(0));
        }

        function test_rotationRejectsOtherOwnersInvalidSlotsAndZeroWallet() public {
            _registerThreeCreators(FIRST_POOL, 0);
            vm.expectRevert(
                abi.encodeWithSelector(ClassicModuleFeeLedgerV1.UnauthorizedWalletRotation.selector, _creator(0))
            );
            vm.prank(_creator(0));
            ledger.changeCreatorWallet(FIRST_POOL, 1, REPLACEMENT);
            vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV1.InvalidCreatorIndex.selector, 3));
            ledger.changeCreatorWallet(FIRST_POOL, 3, REPLACEMENT);
            vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV1.InvalidWallet.selector, address(0)));
            vm.prank(_creator(0));
            ledger.changeCreatorWallet(FIRST_POOL, 0, address(0));
            vm.prank(_creator(0));
            ledger.changeCreatorWallet(FIRST_POOL, 0, REPLACEMENT);
            vm.expectRevert(
                abi.encodeWithSelector(ClassicModuleFeeLedgerV1.UnauthorizedWalletRotation.selector, _creator(0))
            );
            vm.prank(_creator(0));
            ledger.changeCreatorWallet(FIRST_POOL, 0, _creator(0));
        }

        function test_roundingCarryStaysGlobalAndIsCreditedWhenItBecomesAWholeUnit() public {
            _register(FIRST_POOL, 3);
            _accrue(FIRST_POOL, 5, 0);
            assertEq(ledger.claimable(_author(1)), 0);
            assertEq(ledger.dust(), 3);
            registry.setWallet(bytes32(uint256(1)), REPLACEMENT);
            _accrue(FIRST_POOL, 1, 0);
            assertEq(ledger.claimable(_author(1)), 0);
            assertEq(ledger.claimable(REPLACEMENT), 1);
            assertEq(ledger.dust(), 0);
            _assertSolvent();
        }

        function test_claimRedeemsRealPoolManagerClaimsAndCallerCannotRedirectOthers() public {
            _register(FIRST_POOL, 2);
            _accrue(FIRST_POOL, 400, 1000);
            assertEq(manager.balanceOf(address(ledger), 0), 1400);
            vm.prank(address(0x9999));
            assertEq(ledger.claim(_author(1)), 100);
            assertEq(_author(1).balance, 100);
            assertEq(manager.balanceOf(address(ledger), 0), 1300);
            assertEq(ledger.claimedBy(_author(1)), 100);
            vm.prank(_creator(0));
            assertEq(ledger.claimTo(REPLACEMENT), 1000);
            assertEq(REPLACEMENT.balance, 1000);
            assertEq(_creator(0).balance, 0);
            vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV1.NoFeesToClaim.selector, address(this)));
            ledger.claimTo(REPLACEMENT);
            _assertSolvent();
        }

        function test_revertingRecipientCannotBlockOtherClaimsAndMayChooseItsOwnDestination() public {
            LedgerRevertingRecipient recipient = new LedgerRevertingRecipient();
            registry.setWallet(bytes32(uint256(1)), address(recipient));
            _register(FIRST_POOL, 2);
            _accrue(FIRST_POOL, 400, 0);
            vm.expectRevert();
            ledger.claim(address(recipient));
            assertEq(ledger.claimable(address(recipient)), 100);
            assertEq(ledger.totalClaimed(), 0);
            ledger.claim(_author(2));
            assertEq(_author(2).balance, 100);
            recipient.claimTo(ledger, REPLACEMENT);
            assertEq(REPLACEMENT.balance, 100);
            _assertSolvent();
        }

        function test_recipientReentrancyCannotClaimAgain() public {
            LedgerReentrantRecipient recipient = new LedgerReentrantRecipient(ledger);
            registry.setWallet(bytes32(uint256(1)), address(recipient));
            _register(FIRST_POOL, 1);
            _accrue(FIRST_POOL, 100, 0);
            ledger.claim(address(recipient));
            assertTrue(recipient.attempted());
            assertFalse(recipient.succeeded());
            assertEq(recipient.failureSelector(), ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
            assertEq(address(recipient).balance, 50);
            assertEq(ledger.claimedBy(address(recipient)), 50);
            _assertSolvent();
        }

        function test_unfundedAccrualCannotBorrowBackingFromAnotherPoolOrCommittedDust() public {
            _register(FIRST_POOL, 3);
            _register(SECOND_POOL, 2);
            _accrue(FIRST_POOL, 5, 0);
            vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV1.InsufficientBacking.selector, 5, 6));
            hook.accrueWithoutFunding(SECOND_POOL, 1, 0);
            assertEq(ledger.totalFeesReceived(), 5);
            (uint256 received,,) = ledger.poolTotals(SECOND_POOL);
            assertEq(received, 0);
            _assertSolvent();
        }

        function test_unexpectedCallbacksAndDirectNativeTransfersAreRejected() public {
            vm.expectRevert(
                abi.encodeWithSelector(ClassicModuleFeeLedgerV1.UnauthorizedPoolManager.selector, address(this))
            );
            ledger.unlockCallback(abi.encode(uint256(1)));
            vm.expectRevert(ClassicModuleFeeLedgerV1.UnexpectedUnlockCallback.selector);
            vm.prank(address(manager));
            ledger.unlockCallback(abi.encode(uint256(1)));
            (bool succeeded,) = address(ledger).call{ value: 1 }("");
            assertFalse(succeeded);
        }

        function test_donationsDoNotCreateRewardsOrIncreaseFeeDust() public {
            _register(FIRST_POOL, 2);
            vm.deal(address(ledger), 17);
            assertEq(ledger.backing(), 17);
            assertEq(ledger.totalFeesReceived(), 0);
            assertEq(ledger.totalCredited(), 0);
            assertEq(ledger.dust(), 0);
            _accrue(FIRST_POOL, 400, 0);
            ledger.claim(_author(1));
            assertEq(ledger.claimedBy(_author(1)), 100);
            assertEq(ledger.backing(), ledger.outstandingClaims() + ledger.dust() + 17);
        }

        function test_invalidCurrentAuthorWalletRevertsFundingAndAccountingAtomically() public {
            _register(FIRST_POOL, 2);
            registry.setWallet(bytes32(uint256(1)), address(0));
            vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV1.InvalidWallet.selector, address(0)));
            _accrue(FIRST_POOL, 400, 0);
            assertEq(ledger.totalFeesReceived(), 0);
            assertEq(ledger.totalCredited(), 0);
            assertEq(manager.balanceOf(address(ledger), 0), 0);
            assertEq(address(manager).balance, 0);
        }

        function testFuzz_partitionIndependent(uint128 rawPlatform, uint128 rawCreator, uint8 rawModules, uint8 cut)
            public
        {
            uint256 platform = bound(uint256(rawPlatform), 0, 1e24);
            uint256 creator = bound(uint256(rawCreator), 0, 1e24);
            uint256 modules = bound(uint256(rawModules), 0, 8);
            _registerThreeCreators(FIRST_POOL, modules);
            _registerThreeCreators(SECOND_POOL, modules);
            uint256 firstPlatform = platform * cut / 255;
            uint256 firstCreator = creator * cut / 255;
            _accrue(FIRST_POOL, platform, creator);
            _accrue(SECOND_POOL, firstPlatform, firstCreator);
            _accrue(SECOND_POOL, platform - firstPlatform, creator - firstCreator);
            _assertSameContributions(FIRST_POOL, SECOND_POOL, modules);
            (,, uint256 firstDust) = ledger.poolTotals(FIRST_POOL);
            (,, uint256 secondDust) = ledger.poolTotals(SECOND_POOL);
            assertEq(firstDust, secondDust);
            assertLe(firstDust, (modules == 0 ? 1 : modules) + 2);
            _assertSolvent();
        }

        function testFuzz_claimsDoNotChangeFutureAccrual(uint96 rawPlatform, uint96 rawCreator) public {
            uint256 platform = bound(uint256(rawPlatform), 0, 1e24);
            uint256 creator = bound(uint256(rawCreator), 0, 1e24);
            _registerThreeCreators(FIRST_POOL, 3);
            _accrue(FIRST_POOL, platform, creator);
            _claimIfAny(TREASURY);
            for (uint256 index; index < 3; index++) {
                _claimIfAny(_author(index + 1));
                _claimIfAny(_creator(index));
            }
            _assertSolvent();
            _accrue(FIRST_POOL, 71, 103);
            assertEq(ledger.contributionByPool(FIRST_POOL, TREASURY), (platform + 71) / 2);
            for (uint256 index = 1; index <= 3; index++) {
                assertEq(ledger.contributionByPool(FIRST_POOL, _author(index)), ((platform + 71) / 2) / 3);
                _claimIfAny(_author(index));
            }
            for (uint256 index; index < 3; index++) {
                _claimIfAny(_creator(index));
            }
            _claimIfAny(TREASURY);
            assertEq(ledger.outstandingClaims(), 0);
            assertEq(ledger.backing(), ledger.dust());
        }

        function _register(bytes32 pool, uint256 modules) private {
            hook.registerPool(pool, _creators(1), _shares1(), _families(modules));
        }

        function _registerThreeCreators(bytes32 pool, uint256 modules) private {
            uint16[] memory shares = new uint16[](3);
            shares[0] = 3333;
            shares[1] = 3333;
            shares[2] = 3334;
            hook.registerPool(pool, _creators(3), shares, _families(modules));
        }

        function _accrue(bytes32 pool, uint256 platform, uint256 creator) private {
            hook.fundAndAccrue{ value: platform + creator }(pool, platform, creator);
        }

        function _claimIfAny(address beneficiary) private {
            if (ledger.claimable(beneficiary) != 0) ledger.claim(beneficiary);
        }

        function _assertSameContributions(bytes32 first, bytes32 second, uint256 modules) private view {
            assertEq(ledger.contributionByPool(first, TREASURY), ledger.contributionByPool(second, TREASURY));
            assertEq(ledger.contributionByPool(first, RESERVE), ledger.contributionByPool(second, RESERVE));
            for (uint256 index = 1; index <= modules; index++) {
                assertEq(
                    ledger.contributionByPool(first, _author(index)), ledger.contributionByPool(second, _author(index))
                );
            }
            for (uint256 index; index < 3; index++) {
                assertEq(
                    ledger.contributionByPool(first, _creator(index)),
                    ledger.contributionByPool(second, _creator(index))
                );
            }
        }

        function _assertSolvent() private view {
            assertEq(ledger.totalFeesReceived(), ledger.totalCredited() + ledger.dust());
            assertEq(ledger.totalCredited(), ledger.totalClaimed() + ledger.outstandingClaims());
            assertEq(ledger.backing(), ledger.outstandingClaims() + ledger.dust());
        }

        function _families(uint256 count) private pure returns (bytes32[] memory families) {
            families = new bytes32[](count);
            for (uint256 index; index < count; index++) {
                families[index] = bytes32(index + 1);
            }
        }

        function _creators(uint256 count) private pure returns (address[] memory creators) {
            creators = new address[](count);
            for (uint256 index; index < count; index++) {
                creators[index] = _creator(index);
            }
        }

        function _shares1() private pure returns (uint16[] memory shares) {
            shares = new uint16[](1);
            shares[0] = 10_000;
        }

        function _author(uint256 index) private pure returns (address) {
            return address(uint160(0xA000 + index));
        }

        function _creator(uint256 index) private pure returns (address) {
            return address(uint160(0xB000 + index));
        }
    }
