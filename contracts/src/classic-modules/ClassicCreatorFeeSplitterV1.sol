// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { Hashes } from "@openzeppelin/contracts/utils/cryptography/Hashes.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/// @notice Immutable native-fee distribution to up to 1,000 ordinary wallets, outside the swap execution path.
/// @dev The constructor verifies the entire allocation, not a caller-asserted root or share total. A CTO routes
///      future ledger credits to another wallet/splitter; this splitter and all its old entitlements stay intact.
///      No owner, root replacement, fee setter, arbitrary sweep or upgrade. Forced native donations are shared.
contract ClassicCreatorFeeSplitterV1 is ReentrancyGuardTransient {
    using Address for address payable;

    uint256 public constant MAX_RECIPIENTS = 1000;
    uint256 public constant BASIS_POINTS = 10_000;
    bytes32 public constant LEAF_DOMAIN = keccak256("programmable.classic.creator-split.v1");
    bytes32 public immutable root;
    uint256 public immutable recipientCount;
    uint256 public immutable proofDepth;
    uint256 public totalReleased;
    mapping(uint256 index => uint256) public released;

    error InvalidAllocationLength(uint256 length);
    error InvalidRecipient(uint256 index);
    error RecipientsNotStrictlyOrdered(uint256 index);
    error InvalidShare(uint256 index);
    error InvalidShareTotal(uint256 total);
    error InvalidProof();
    error UnauthorizedRecipient(address caller);
    error NoFeesToClaim();

    event AllocationConfigured(bytes32 indexed root, uint256 recipientCount, bytes allocations);
    event FeesReleased(uint256 indexed index, address indexed wallet, address indexed destination, uint256 amount);

    /// @param allocations Sorted address (20 bytes) + uint16 share (2 bytes, big endian) per recipient.
    ///        The compact encoding keeps even 1,000-recipient creation below the EVM init-code size limit.
    constructor(bytes memory allocations) {
        uint256 count = allocations.length / 22;
        if (allocations.length % 22 != 0 || count == 0 || count > MAX_RECIPIENTS) {
            revert InvalidAllocationLength(allocations.length);
        }
        recipientCount = count;
        uint256 width = 1;
        uint256 depth;
        while (width < count) {
            width *= 2;
            ++depth;
        }
        proofDepth = depth;
        bytes32[] memory nodes = new bytes32[](width);
        // A sentinel word makes every unaligned 32-byte read stay inside an allocated byte array.
        bytes memory paddedAllocations = bytes.concat(allocations, bytes32(0));
        address previous;
        uint256 total;
        for (uint256 index; index < count; ++index) {
            address wallet;
            uint16 share;
            assembly ("memory-safe") {
                let word := mload(add(add(paddedAllocations, 32), mul(index, 22)))
                wallet := shr(96, word)
                share := and(shr(80, word), 0xffff)
            }
            if (wallet == address(0) || wallet == address(this)) revert InvalidRecipient(index);
            if (wallet <= previous) revert RecipientsNotStrictlyOrdered(index);
            if (share == 0 || share > BASIS_POINTS) revert InvalidShare(index);
            total += share;
            previous = wallet;
            nodes[index] = leafHash(index, wallet, share);
        }
        if (total != BASIS_POINTS) revert InvalidShareTotal(total);
        while (width > 1) {
            for (uint256 index; index < width; index += 2) {
                nodes[index / 2] = Hashes.commutativeKeccak256(nodes[index], nodes[index + 1]);
            }
            width /= 2;
        }
        root = nodes[0];
        emit AllocationConfigured(nodes[0], count, allocations);
    }

    function leafHash(uint256 index, address wallet, uint16 shareBps) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(LEAF_DOMAIN, index, wallet, shareBps))));
    }

    /// @notice Includes received donations; claiming changes balance and totalReleased equally and oppositely.
    function totalReceived() public view returns (uint256) {
        return address(this).balance + totalReleased;
    }

    function withdrawable(uint256 index, address wallet, uint16 shareBps, bytes32[] calldata proof)
        public
        view
        returns (uint256)
    {
        if (
            index >= recipientCount || proof.length != proofDepth
                || !MerkleProof.verifyCalldata(proof, root, leafHash(index, wallet, shareBps))
        ) revert InvalidProof();
        return Math.mulDiv(totalReceived(), shareBps, BASIS_POINTS) - released[index];
    }

    /// @notice Anyone may pay the canonical recipient; the caller never chooses another person's destination.
    function claim(uint256 index, address wallet, uint16 shareBps, bytes32[] calldata proof)
        external
        nonReentrant
        returns (uint256)
    {
        return _claim(index, wallet, shareBps, proof, wallet);
    }

    /// @notice Only the entitled wallet can redirect its own payment, including recovery from a reverting receiver.
    function claimTo(uint256 index, address wallet, uint16 shareBps, bytes32[] calldata proof, address destination)
        external
        nonReentrant
        returns (uint256)
    {
        if (msg.sender != wallet) revert UnauthorizedRecipient(msg.sender);
        if (destination == address(0) || destination == address(this)) revert InvalidRecipient(index);
        return _claim(index, wallet, shareBps, proof, destination);
    }

    function _claim(uint256 index, address wallet, uint16 shareBps, bytes32[] calldata proof, address destination)
        private
        returns (uint256 amount)
    {
        amount = withdrawable(index, wallet, shareBps, proof);
        if (amount == 0) revert NoFeesToClaim();
        released[index] += amount;
        totalReleased += amount;
        payable(destination).sendValue(amount);
        emit FeesReleased(index, wallet, destination, amount);
    }

    receive() external payable { }
}
