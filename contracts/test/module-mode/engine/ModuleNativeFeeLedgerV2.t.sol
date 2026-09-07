// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { CurrencySettler } from "@openzeppelin/uniswap-hooks/src/utils/CurrencySettler.sol";
import {
    ClassicModuleFeeLedgerV1,
    IClassicModuleAuthorRegistry
} from "../../../src/classic-modules/ClassicModuleFeeLedgerV1.sol";
import { ClassicModuleFeeLedgerV2 } from "../../../src/classic-modules/ClassicModuleFeeLedgerV2.sol";

contract NativeLedgerRegistryFixtureV2 is IClassicModuleAuthorRegistry {
    mapping(bytes32 => address) public override authorWallet;

    function setWallet(bytes32 family, address wallet) external {
        authorWallet[family] = wallet;
    }
}

/// @dev Same real PoolManager backs both generations. Its unlock must settle every minted native claim.
contract NativeLedgerFixtureV2 is IUnlockCallback {
    using CurrencySettler for Currency;
    IPoolManager public immutable manager;
    ClassicModuleFeeLedgerV2 public immutable ledger;
    ClassicModuleFeeLedgerV1 public immutable legacy;

    constructor(
        IPoolManager manager_,
        IClassicModuleAuthorRegistry registry,
        address treasury,
        address admin,
        address reserve
    ) {
        manager = manager_;
        ledger = new ClassicModuleFeeLedgerV2(manager_, registry, treasury, admin);
        legacy = new ClassicModuleFeeLedgerV1(manager_, registry, treasury, admin, reserve);
    }

    function register(
        bool old,
        bytes32 pool,
        address[] memory creators,
        uint16[] memory shares,
        bytes32[] memory families
    ) external {
        if (old) legacy.registerPool(pool, creators, shares, families);
        else ledger.registerPool(pool, creators, shares, families);
    }

    function accrue(bool old, bytes32 pool, uint256 platform, uint256 creator) external payable {
        require(msg.value == platform + creator);
        manager.unlock(abi.encode(old, pool, platform, creator));
    }

    function accrueNative(bytes32 pool, uint256 platform, uint256 creator) external payable {
        ledger.accrueNative{ value: msg.value }(pool, platform, creator);
    }

    function unfunded(bytes32 pool, uint256 platform, uint256 creator) external {
        ledger.accrue(pool, platform, creator);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager));
        (bool old, bytes32 pool, uint256 platform, uint256 creator) =
            abi.decode(data, (bool, bytes32, uint256, uint256));
        Currency native = Currency.wrap(address(0));
        native.settle(manager, address(this), platform + creator, false);
        native.take(manager, old ? address(legacy) : address(ledger), platform + creator, true);
        if (old) legacy.accrue(pool, platform, creator);
        else ledger.accrue(pool, platform, creator);
        return "";
    }
}

contract NativeLedgerReentryV2 {
    ClassicModuleFeeLedgerV2 private immutable _ledger;
    bool public reentered;

    constructor(ClassicModuleFeeLedgerV2 ledger) {
        _ledger = ledger;
    }

    receive() external payable {
        (reentered,) = address(_ledger).call(abi.encodeWithSignature("claim(address)", address(this)));
    }
}

contract NativeLedgerRejectV2 {
    function claimTo(ClassicModuleFeeLedgerV2 ledger, address recipient) external {
        ledger.claimTo(recipient);
    }

    receive() external payable {
        revert("refuses");
    }
}

contract ModuleNativeFeeLedgerV2Test is Test {
    bytes32 private constant POOL = bytes32(uint256(1));
    bytes32 private constant SECOND = bytes32(uint256(2));
    address private constant TREASURY = address(0x1111);
    address private constant ADMIN = address(0x2222);
    address private constant RESERVE = address(0x3333);
    address private constant NEXT = address(0x4444);
    NativeLedgerRegistryFixtureV2 private registry;
    NativeLedgerFixtureV2 private fixture;
    ClassicModuleFeeLedgerV2 private ledger;
    PoolManager private manager;

    function setUp() public {
        manager = new PoolManager(address(this));
        registry = new NativeLedgerRegistryFixtureV2();
        fixture = new NativeLedgerFixtureV2(manager, registry, TREASURY, ADMIN, RESERVE);
        ledger = fixture.ledger();
        for (uint256 i = 1; i <= 8; ++i) {
            registry.setWallet(bytes32(i), _author(i));
        }
        vm.deal(address(this), 1e38);
    }

    function test_zeroFamiliesAllocatesEveryPlatformUnitToProtocol() public {
        _register(POOL, 0);
        _accrue(POOL, 101, 0);
        assertEq(ledger.claimable(TREASURY), 101);
        assertEq(ledger.claimable(RESERVE), 0);
        assertEq(ledger.dust(), 0);
        assertEq(ledger.platformFeeBps(POOL), 10);
        _solvent();
    }

    function test_oneTwoThreeFiveEightFamiliesShareOneAuthorPool() public {
        uint256[5] memory counts = [uint256(1), 2, 3, 5, 8];
        for (uint256 i; i < counts.length; ++i) {
            bytes32 pool = bytes32(i + 1);
            uint256 count = counts[i];
            _register(pool, count);
            _accrue(pool, 3005, 0);
            assertEq(ledger.contributionByPool(pool, TREASURY), 1001);
            uint256 authors = 2003 / count;
            for (uint256 j = 1; j <= count; ++j) {
                assertEq(ledger.contributionByPool(pool, _author(j)), authors);
            }
            (uint256 received, uint256 allocated, uint256 dust) = ledger.poolTotals(pool);
            assertEq(received, 3005);
            assertEq(allocated, 1001 + authors * count);
            assertEq(dust, 1 + 2003 % count);
            assertEq(ledger.platformFeeBps(pool), 30);
        }
        _solvent();
    }

    function test_oneWeiAccrualsMatchLumpSumAcrossPlatformAndCreatorDust() public {
        _register(POOL, 3);
        _register(SECOND, 3);
        _accrue(POOL, 401, 401);
        for (uint256 i; i < 401; ++i) {
            _accrue(SECOND, 1, 1);
        }
        _same(POOL, SECOND, 3);
        _solvent();
    }

    function test_zeroOneTwoWeiRoundingCarriesWithoutProtocolOrAuthorBonus() public {
        _register(POOL, 1);
        _accrue(POOL, 1, 0);
        assertEq(ledger.claimable(TREASURY), 0);
        assertEq(ledger.claimable(_author(1)), 0);
        assertEq(ledger.dust(), 1);
        _accrue(POOL, 1, 0);
        assertEq(ledger.claimable(_author(1)), 1);
        assertEq(ledger.dust(), 1);
        _accrue(POOL, 1, 0);
        assertEq(ledger.claimable(TREASURY), 1);
        assertEq(ledger.claimable(_author(1)), 2);
        assertEq(ledger.dust(), 0);
        _solvent();
    }

    function test_oldAndNewGenerationsKeepSeparateRatesClaimsAndDust() public {
        (address[] memory creators, uint16[] memory shares) = _creators();
        fixture.register(true, POOL, creators, shares, _families(1));
        fixture.register(true, SECOND, creators, shares, _families(0));
        _register(POOL, 1);
        _register(SECOND, 0);
        fixture.accrue{ value: 200 }(true, POOL, 200, 0);
        fixture.accrue{ value: 200 }(true, SECOND, 200, 0);
        _accrue(POOL, 300, 0);
        _accrue(SECOND, 100, 0);
        ClassicModuleFeeLedgerV1 old = fixture.legacy();
        assertEq(old.claimable(_author(1)), 100);
        assertEq(old.claimable(RESERVE), 100);
        assertEq(old.claimable(TREASURY), 200);
        assertEq(ledger.claimable(_author(1)), 200);
        assertEq(ledger.claimable(RESERVE), 0);
        assertEq(ledger.claimable(TREASURY), 200);
        old.claim(_author(1));
        assertEq(ledger.claimable(_author(1)), 200);
        ledger.claim(_author(1));
        assertEq(_author(1).balance, 300);
        assertEq(old.totalClaimed(), 100);
        assertEq(ledger.totalClaimed(), 200);
        _solvent();
    }

    function test_nativeReceiptsAndPoolManagerClaimsHaveIdenticalAllocationAndMixedClaims() public {
        _register(POOL, 2);
        _register(SECOND, 2);
        _accrue(POOL, 301, 10_003);
        fixture.accrueNative{ value: 10_304 }(SECOND, 301, 10_003);
        _same(POOL, SECOND, 2);
        assertEq(manager.balanceOf(address(ledger), 0), 10_304);
        assertEq(address(ledger).balance, 10_304);
        for (uint256 i; i < 3; ++i) {
            ledger.claim(_creator(i));
        }
        ledger.claim(TREASURY);
        ledger.claim(_author(1));
        ledger.claim(_author(2));
        assertEq(ledger.outstandingClaims(), 0);
        assertEq(ledger.backing(), ledger.dust());
        _solvent();
    }

    function test_nativeAccrualRejectsForgedValueAndCallerAndUnregisteredPoolAtomically() public {
        _register(POOL, 1);
        vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV2.InvalidNativeAccrual.selector, 1, 2));
        fixture.accrueNative{ value: 1 }(POOL, 2, 0);
        vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV2.UnauthorizedHook.selector, address(this)));
        ledger.accrueNative{ value: 1 }(POOL, 1, 0);
        vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV2.PoolNotRegistered.selector, SECOND));
        fixture.accrueNative{ value: 1 }(SECOND, 1, 0);
        assertEq(ledger.totalFeesReceived(), 0);
        assertEq(ledger.backing(), 0);
    }

    function test_unfundedAccrualCannotSpendAnotherPoolsClaimsOrDust() public {
        _register(POOL, 3);
        _register(SECOND, 2);
        _accrue(POOL, 4, 0);
        vm.expectRevert(abi.encodeWithSelector(ClassicModuleFeeLedgerV2.InsufficientBacking.selector, 4, 5));
        fixture.unfunded(SECOND, 1, 0);
        assertEq(ledger.totalFeesReceived(), 4);
        (uint256 received,,) = ledger.poolTotals(SECOND);
        assertEq(received, 0);
        _solvent();
    }

    function test_authorRotationPreservesOldClaimsAndPaysOnlyNewWholeCredits() public {
        _register(POOL, 3);
        _accrue(POOL, 9, 0);
        assertEq(ledger.claimable(_author(1)), 2);
        _accrue(POOL, 4, 0);
        registry.setWallet(bytes32(uint256(1)), NEXT);
        _accrue(POOL, 1, 0);
        assertEq(ledger.claimable(_author(1)), 2);
        assertEq(ledger.claimable(NEXT), 1);
        ledger.claim(_author(1));
        assertEq(_author(1).balance, 2);
        assertEq(ledger.claimable(NEXT), 1);
        _solvent();
    }

    function test_claimRecipientCannotReenterOrRedirectAnotherWallet() public {
        NativeLedgerReentryV2 recipient = new NativeLedgerReentryV2(ledger);
        registry.setWallet(bytes32(uint256(1)), address(recipient));
        _register(POOL, 1);
        _accrue(POOL, 300, 0);
        vm.prank(address(0x9999));
        ledger.claim(address(recipient));
        assertEq(address(recipient).balance, 200);
        assertFalse(recipient.reentered());
        assertEq(ledger.claimedBy(address(recipient)), 200);
        _solvent();
    }

    function test_failedRecipientDoesNotBlockOthersOrDestroyEarnedClaim() public {
        NativeLedgerRejectV2 recipient = new NativeLedgerRejectV2();
        registry.setWallet(bytes32(uint256(1)), address(recipient));
        _register(POOL, 2);
        _accrue(POOL, 300, 0);
        vm.expectRevert();
        ledger.claim(address(recipient));
        assertEq(ledger.claimable(address(recipient)), 100);
        ledger.claim(_author(2));
        assertEq(_author(2).balance, 100);
        recipient.claimTo(ledger, NEXT);
        assertEq(NEXT.balance, 100);
        _solvent();
    }

    function testFuzz_partitionAndClaimsDoNotChangeEntitlements(
        uint128 rawPlatform,
        uint128 rawCreator,
        uint8 rawCount,
        uint8 cut
    ) public {
        uint256 platform = bound(uint256(rawPlatform), 0, 1e24);
        uint256 creator = bound(uint256(rawCreator), 0, 1e24);
        uint256 count = rawCount % 9;
        _register(POOL, count);
        _register(SECOND, count);
        _accrue(POOL, platform, creator);
        uint256 firstPlatform = platform * cut / 255;
        uint256 firstCreator = creator * cut / 255;
        _accrue(SECOND, firstPlatform, firstCreator);
        _claimAll(count);
        fixture.accrueNative{ value: platform + creator - firstPlatform - firstCreator }(
            SECOND, platform - firstPlatform, creator - firstCreator
        );
        _same(POOL, SECOND, count);
        (,, uint256 reserved) = ledger.poolTotals(POOL);
        assertLe(reserved, (count == 0 ? 0 : count) + 2);
        _claimAll(count);
        assertEq(ledger.outstandingClaims(), 0);
        assertEq(ledger.backing(), ledger.dust());
        _solvent();
    }

    function _register(bytes32 pool, uint256 count) private {
        (address[] memory creators, uint16[] memory shares) = _creators();
        fixture.register(false, pool, creators, shares, _families(count));
    }

    function _accrue(bytes32 pool, uint256 platform, uint256 creator) private {
        fixture.accrue{ value: platform + creator }(false, pool, platform, creator);
    }

    function _creators() private pure returns (address[] memory wallets, uint16[] memory shares) {
        wallets = new address[](3);
        shares = new uint16[](3);
        for (uint256 i; i < 3; ++i) {
            wallets[i] = _creator(i);
            shares[i] = i == 2 ? 3334 : 3333;
        }
    }

    function _families(uint256 count) private pure returns (bytes32[] memory families) {
        families = new bytes32[](count);
        for (uint256 i; i < count; ++i) {
            families[i] = bytes32(i + 1);
        }
    }

    function _creator(uint256 i) private pure returns (address) {
        return address(uint160(0x5000 + i));
    }

    function _author(uint256 i) private pure returns (address) {
        return address(uint160(0x6000 + i));
    }

    function _same(bytes32 first, bytes32 second, uint256 count) private view {
        assertEq(ledger.contributionByPool(first, TREASURY), ledger.contributionByPool(second, TREASURY));
        for (uint256 i = 1; i <= count; ++i) {
            assertEq(ledger.contributionByPool(first, _author(i)), ledger.contributionByPool(second, _author(i)));
        }
        for (uint256 i; i < 3; ++i) {
            assertEq(ledger.contributionByPool(first, _creator(i)), ledger.contributionByPool(second, _creator(i)));
        }
        (,, uint256 firstDust) = ledger.poolTotals(first);
        (,, uint256 secondDust) = ledger.poolTotals(second);
        assertEq(firstDust, secondDust);
    }

    function _claimAll(uint256 count) private {
        if (ledger.claimable(TREASURY) != 0) ledger.claim(TREASURY);
        for (uint256 i = 1; i <= count; ++i) {
            if (ledger.claimable(_author(i)) != 0) ledger.claim(_author(i));
        }
        for (uint256 i; i < 3; ++i) {
            if (ledger.claimable(_creator(i)) != 0) ledger.claim(_creator(i));
        }
    }

    function _solvent() private view {
        assertEq(ledger.totalFeesReceived(), ledger.totalClaimed() + ledger.outstandingClaims() + ledger.dust());
        assertEq(ledger.backing(), ledger.outstandingClaims() + ledger.dust());
    }
}
