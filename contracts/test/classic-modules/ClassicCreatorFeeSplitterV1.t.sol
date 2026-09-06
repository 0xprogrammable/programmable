// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { Hashes } from "@openzeppelin/contracts/utils/cryptography/Hashes.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { ClassicCreatorFeeSplitterV1 as Splitter } from "../../src/classic-modules/ClassicCreatorFeeSplitterV1.sol";
import {
    ClassicCreatorFeeSplitterFactoryV1 as Factory
} from "../../src/classic-modules/ClassicCreatorFeeSplitterFactoryV1.sol";
import { ClassicModuleFeeLedgerV1 as Ledger } from "../../src/classic-modules/ClassicModuleFeeLedgerV1.sol";
import { LedgerHookFixture, LedgerAuthorRegistryFixture } from "./ClassicModuleFeeLedgerV1.t.sol";

contract CreatorSplitReceiver {
    bool public reject;
    bool public attempted;
    bool public reentered;
    Splitter private target;

    function configure(Splitter splitter, bool reject_) external {
        target = splitter;
        reject = reject_;
    }

    function redirect(address destination) external {
        target.claimTo(0, address(this), 10_000, new bytes32[](0), destination);
    }

    receive() external payable {
        if (reject) revert("reject");
        attempted = true;
        (reentered,) =
            address(target).call(abi.encodeCall(Splitter.claim, (0, address(this), uint16(10_000), new bytes32[](0))));
    }
}

contract ClassicCreatorFeeSplitterV1Test is Test {
    bytes32 private constant DOMAIN = keccak256("programmable.classic.creator-split.v1");

    function setUp() public {
        vm.deal(address(this), 1e30);
    }

    function test_crossStackVectorBindsCompactDataAndDoubleHashedLeaves() public {
        address[] memory wallets = new address[](3);
        wallets[0] = 0x1111111111111111111111111111111111111111;
        wallets[1] = 0x2222222222222222222222222222222222222222;
        wallets[2] = 0x3333333333333333333333333333333333333333;
        uint16[] memory shares = new uint16[](3);
        shares[0] = 2000;
        shares[1] = 3000;
        shares[2] = 5000;
        Splitter splitter = new Splitter(_packed(wallets, shares));
        assertEq(splitter.LEAF_DOMAIN(), 0x78a6648c5ce29a0ef83e9d6be26c4fed3f70e5f86e3881a2968c9913a1e6232d);
        assertEq(splitter.root(), 0xa029c704c340ede99fcfb05f026675438f4546abed551eb9e0feea8f5c1ff122);
        assertEq(splitter.proofDepth(), 2);
        bytes32[] memory proof = new bytes32[](2);
        proof[1] = 0x86ffbcb2711adf0911286ee54edd1fb6cb7d752911e286b4d8a7fba239f6aa9c;
        _fund(splitter, 10_000);
        assertEq(splitter.claim(2, wallets[2], shares[2], proof), 5000);
        assertEq(wallets[2].balance, 5000);
    }

    function test_oneThousandRecipientsAllClaimAndDeploymentFitsRealEvmLimits() public {
        (address[] memory wallets, uint16[] memory shares) = _equal(1000);
        bytes memory allocations = _packed(wallets, shares);
        uint256 initSize = type(Splitter).creationCode.length + abi.encode(allocations).length;
        assertLt(initSize, 49_152);
        Factory factory = new Factory();
        // Foundry dynamically links test-level `new` through a cheatcode. Measure the real factory CREATE2 path.
        uint256 beforeGas = gasleft();
        Splitter splitter = factory.deploy(bytes32(uint256(1000)), allocations);
        uint256 creationGas = beforeGas - gasleft();
        assertLt(address(splitter).code.length, 24_576);
        assertLt(creationGas, 5_000_000);
        assertGt(creationGas, 1_000_000);
        emit log_named_uint("1000 recipient deployment gas (factory CREATE2 execution)", creationGas);
        emit log_named_uint("1000 recipient init code bytes", initSize);
        assertEq(splitter.recipientCount(), 1000);
        assertEq(splitter.proofDepth(), 10);
        bytes32[] memory tree = _tree(wallets, shares);
        assertEq(splitter.root(), tree[1]);
        _fund(splitter, 1_000_000);
        for (uint256 i; i < 1000; ++i) {
            assertEq(splitter.claim(i, wallets[i], shares[i], _proof(tree, i)), 1000);
            assertEq(wallets[i].balance, 1000);
        }
        assertEq(splitter.totalReleased(), 1_000_000);
        assertEq(address(splitter).balance, 0);
        assertEq(splitter.totalReceived(), 1_000_000);
    }

    function test_rejectsMalformedUnsortedDuplicateZeroOrOversubscribedAllocations() public {
        vm.expectRevert(abi.encodeWithSelector(Splitter.InvalidAllocationLength.selector, 0));
        new Splitter("");
        vm.expectRevert(abi.encodeWithSelector(Splitter.InvalidAllocationLength.selector, 21));
        new Splitter(new bytes(21));
        vm.expectRevert(abi.encodeWithSelector(Splitter.InvalidAllocationLength.selector, 22_022));
        new Splitter(new bytes(22_022));
        (address[] memory wallets, uint16[] memory shares) = _equal(2);
        wallets[0] = address(0);
        bytes memory invalid = _packed(wallets, shares);
        vm.expectRevert(abi.encodeWithSelector(Splitter.InvalidRecipient.selector, 0));
        new Splitter(invalid);
        wallets[0] = wallets[1];
        invalid = _packed(wallets, shares);
        vm.expectRevert(abi.encodeWithSelector(Splitter.RecipientsNotStrictlyOrdered.selector, 1));
        new Splitter(invalid);
        wallets[0] = address(uint160(wallets[1]) + 1);
        invalid = _packed(wallets, shares);
        vm.expectRevert(abi.encodeWithSelector(Splitter.RecipientsNotStrictlyOrdered.selector, 1));
        new Splitter(invalid);
        wallets[0] = address(1);
        shares[0] = 0;
        invalid = _packed(wallets, shares);
        vm.expectRevert(abi.encodeWithSelector(Splitter.InvalidShare.selector, 0));
        new Splitter(invalid);
        shares[0] = 5001;
        invalid = _packed(wallets, shares);
        vm.expectRevert(abi.encodeWithSelector(Splitter.InvalidShareTotal.selector, 10_001));
        new Splitter(invalid);
    }

    function test_proofCannotAlterWalletIndexShareDepthOrRedirectAnothersFees() public {
        (address[] memory wallets, uint16[] memory shares) = _equal(2);
        Splitter splitter = new Splitter(_packed(wallets, shares));
        bytes32[] memory proof = _proof(_tree(wallets, shares), 0);
        _fund(splitter, 100);
        vm.expectRevert(Splitter.InvalidProof.selector);
        splitter.claim(1, wallets[0], shares[0], proof);
        vm.expectRevert(Splitter.InvalidProof.selector);
        splitter.claim(0, wallets[1], shares[0], proof);
        vm.expectRevert(Splitter.InvalidProof.selector);
        splitter.claim(0, wallets[0], 5001, proof);
        vm.expectRevert(Splitter.InvalidProof.selector);
        splitter.claim(0, wallets[0], shares[0], new bytes32[](0));
        vm.expectRevert(abi.encodeWithSelector(Splitter.UnauthorizedRecipient.selector, address(this)));
        splitter.claimTo(0, wallets[0], shares[0], proof, address(this));
        assertEq(splitter.totalReleased(), 0);
        assertEq(address(splitter).balance, 100);
        splitter.claim(0, wallets[0], shares[0], proof);
        vm.expectRevert(Splitter.NoFeesToClaim.selector);
        splitter.claim(0, wallets[0], shares[0], proof);
    }

    function test_revertingReceiverCanRedirectItsOwnClaimAndCannotReenter() public {
        CreatorSplitReceiver receiver = new CreatorSplitReceiver();
        Splitter splitter = new Splitter(abi.encodePacked(address(receiver), uint16(10_000)));
        receiver.configure(splitter, true);
        _fund(splitter, 100);
        vm.expectRevert();
        splitter.claim(0, address(receiver), 10_000, new bytes32[](0));
        assertEq(splitter.totalReleased(), 0);
        assertEq(splitter.released(0), 0);
        receiver.redirect(address(0x9999));
        assertEq(address(0x9999).balance, 100);
        receiver.configure(splitter, false);
        _fund(splitter, 200);
        splitter.claim(0, address(receiver), 10_000, new bytes32[](0));
        assertTrue(receiver.attempted());
        assertFalse(receiver.reentered());
        assertEq(splitter.totalReleased(), 300);
    }

    function test_factoryBindsCallerSaltAndAllocationAndRejectsSelfRecipient() public {
        Factory factory = new Factory();
        (address[] memory wallets, uint16[] memory shares) = _equal(2);
        bytes memory allocations = _packed(wallets, shares);
        address predicted = factory.predict(address(this), bytes32(uint256(1)), allocations);
        assertNotEq(predicted, factory.predict(address(0x8888), bytes32(uint256(1)), allocations));
        Splitter splitter = factory.deploy(bytes32(uint256(1)), allocations);
        assertEq(address(splitter), predicted);
        vm.expectRevert();
        factory.deploy{ gas: 5_000_000 }(bytes32(uint256(1)), allocations);
        address selfRecipient = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        vm.expectRevert(abi.encodeWithSelector(Splitter.InvalidRecipient.selector, 0));
        new Splitter(abi.encodePacked(selfRecipient, uint16(10_000)));
    }

    function test_ctoSwitchPreservesUnclaimedOldSplitterAndPaysNewNormalWallet() public {
        PoolManager manager = new PoolManager(address(this));
        LedgerAuthorRegistryFixture registry = new LedgerAuthorRegistryFixture();
        address admin = address(0xAD00);
        LedgerHookFixture hook =
            new LedgerHookFixture(IPoolManager(address(manager)), registry, address(0xBEEF), admin, address(0xCAFE));
        Ledger ledger = hook.ledger();
        (address[] memory wallets, uint16[] memory shares) = _equal(1000);
        Splitter splitter = new Splitter(_packed(wallets, shares));
        address[] memory slots = new address[](1);
        slots[0] = address(splitter);
        uint16[] memory slotShares = new uint16[](1);
        slotShares[0] = 10_000;
        bytes32 pool = bytes32(uint256(11));
        hook.registerPool(pool, slots, slotShares, new bytes32[](0));
        hook.fundAndAccrue{ value: 1_000_000 }(pool, 0, 1_000_000);
        uint256 accrualGas = vm.lastCallGas().gasTotalUsed;
        assertLt(accrualGas, 400_000);
        emit log_named_uint("1000 recipient accrual gas (real PoolManager funding)", accrualGas);
        assertEq(address(splitter).balance, 0);
        assertEq(ledger.claimable(address(splitter)), 1_000_000);
        slots[0] = address(0xC700);
        vm.prank(admin);
        ledger.replaceCreatorWallets(pool, slots, 0, block.timestamp + 1 hours);
        hook.fundAndAccrue{ value: 2000 }(pool, 0, 2000);
        assertEq(ledger.claimable(address(splitter)), 1_000_000);
        assertEq(ledger.claimable(slots[0]), 2000);
        ledger.claim(address(splitter));
        assertEq(address(splitter).balance, 1_000_000);
        bytes32[] memory proof = _proof(_tree(wallets, shares), 999);
        assertEq(splitter.claim(999, wallets[999], shares[999], proof), 1000);
        ledger.claim(slots[0]);
        assertEq(slots[0].balance, 2000);
        assertEq(ledger.outstandingClaims(), 0);
    }

    function testFuzz_partitionAndClaimOrderPreserveCumulativeEntitlements(uint96 rawA, uint96 rawB, uint16 rawShare)
        public
    {
        uint256 a = bound(uint256(rawA), 10_000, 1e24);
        uint256 b = bound(uint256(rawB), 10_000, 1e24);
        (address[] memory wallets, uint16[] memory shares) = _equal(2);
        shares[0] = uint16(bound(uint256(rawShare), 1, 9999));
        shares[1] = 10_000 - shares[0];
        Splitter splitter = new Splitter(_packed(wallets, shares));
        bytes32[] memory tree = _tree(wallets, shares);
        _fund(splitter, a);
        splitter.claim(0, wallets[0], shares[0], _proof(tree, 0));
        // Model even a forced native donation: it belongs proportionally to the same immutable recipients.
        vm.deal(address(splitter), address(splitter).balance + b);
        splitter.claim(1, wallets[1], shares[1], _proof(tree, 1));
        splitter.claim(0, wallets[0], shares[0], _proof(tree, 0));
        uint256 first = Math.mulDiv(a + b, shares[0], 10_000);
        uint256 second = Math.mulDiv(a + b, shares[1], 10_000);
        assertEq(splitter.released(0), first);
        assertEq(splitter.released(1), second);
        assertEq(splitter.totalReleased(), first + second);
        assertEq(splitter.totalReceived(), a + b);
        assertLt(address(splitter).balance, 2);
    }

    function _fund(Splitter splitter, uint256 amount) private {
        (bool ok,) = address(splitter).call{ value: amount }("");
        assertTrue(ok);
    }

    function _equal(uint256 count) private pure returns (address[] memory wallets, uint16[] memory shares) {
        wallets = new address[](count);
        shares = new uint16[](count);
        for (uint256 i; i < count; ++i) {
            wallets[i] = address(uint160(0x100000 + i));
            shares[i] = uint16(10_000 / count);
        }
    }

    function _packed(address[] memory wallets, uint16[] memory shares) private pure returns (bytes memory data) {
        uint256 length = wallets.length * 22;
        data = new bytes(length + 32);
        for (uint256 i; i < wallets.length; ++i) {
            address wallet = wallets[i];
            uint16 share = shares[i];
            assembly ("memory-safe") {
                mstore(add(add(data, 32), mul(i, 22)), or(shl(96, wallet), shl(80, share)))
            }
        }
        assembly ("memory-safe") { mstore(data, length) }
    }

    function _tree(address[] memory wallets, uint16[] memory shares) private pure returns (bytes32[] memory nodes) {
        uint256 width = 1;
        while (width < wallets.length) width *= 2;
        nodes = new bytes32[](width * 2);
        for (uint256 i; i < wallets.length; ++i) {
            nodes[width + i] = keccak256(bytes.concat(keccak256(abi.encode(DOMAIN, i, wallets[i], shares[i]))));
        }
        for (uint256 i = width - 1; i != 0; --i) {
            nodes[i] = Hashes.commutativeKeccak256(nodes[i * 2], nodes[i * 2 + 1]);
        }
    }

    function _proof(bytes32[] memory nodes, uint256 index) private pure returns (bytes32[] memory proof) {
        uint256 width = nodes.length / 2;
        uint256 depth;
        for (uint256 i = width; i > 1; i /= 2) {
            ++depth;
        }
        proof = new bytes32[](depth);
        uint256 cursor = width + index;
        for (uint256 i; cursor > 1; ++i) {
            proof[i] = nodes[cursor ^ 1];
            cursor /= 2;
        }
    }
}
