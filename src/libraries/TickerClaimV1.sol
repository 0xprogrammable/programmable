// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";

/// @notice The lifecycle of one ticker claim.
/// @dev A claim is provisional when first taken and becomes permanent only once the pool proves real trading.
///      Provisional claims lapse if they are never confirmed, so a ticker cannot be held by registering and walking
///      away.
enum ClaimState {
    Unclaimed,
    Provisional,
    Confirmed,
    Lapsed
}

/// @notice One ticker's claim record.
/// @param poolId The pool holding the claim.
/// @param claimBlock The block the claim was taken.
/// @param confirmed Whether the claim has been earned and is now permanent.
struct TickerClaim {
    bytes32 poolId;
    uint64 claimBlock;
    bool confirmed;
}

/// @title TickerClaimV1
/// @notice Pure rules for claiming, confirming and lapsing a token symbol.
/// @dev Isolated from the hook so the claim lifecycle can be reviewed and fuzzed without a pool. Every function here
///      is `pure`.
///
///      The model this encodes: being first to register is not the same as being first to matter. A registration
///      takes a provisional claim. The claim becomes permanent only once the pool has accrued at least
///      `confirmationFeeWei` in creator fees, which cannot happen without genuine trading volume. A provisional
///      claim that is never confirmed lapses after `graceBlocks`, freeing the ticker.
///
///      This is what stops the obvious attack. If claiming were free, the first minute of the model's life would be
///      a race to register every desirable ticker, and "first mover" would mean "fastest script" rather than "first
///      token anyone actually traded".
library TickerClaimV1 {
    /// @notice Creator fees a pool must accrue before its claim becomes permanent.
    /// @dev At a 1.00% swap fee this is roughly 10 ETH of volume. High enough that farming tickers is uneconomic,
    ///      low enough that any launch with genuine interest clears it early.
    uint256 internal constant CONFIRMATION_FEE_WEI = 0.1 ether;

    /// @notice Blocks a provisional claim survives without confirmation. Roughly seven days.
    uint64 internal constant GRACE_BLOCKS = 50_400;

    /// @notice Portion of a derivative pool's creator share routed to the original, in basis points of that share.
    /// @dev Taken only from the creator's own share. The launcher and builder allocations are never reduced, so a
    ///      derivative token trades on exactly the same terms as any other; its creator simply does not keep all of
    ///      the reward.
    uint16 internal constant TRIBUTE_SHARE_BPS = 2000;

    uint16 internal constant BASIS_POINTS = 10_000;

    error SymbolEmpty();
    error SymbolTooLong(uint256 length);

    /// @notice Returns the canonical hash of a token symbol.
    /// @dev ASCII lowercase is folded to uppercase so that `pepe`, `Pepe` and `PEPE` are one ticker. Bytes outside
    ///      the ASCII range are hashed as-is: this function does not attempt Unicode normalization, and a symbol
    ///      using lookalike characters from another script is a different ticker. That is a limitation, not an
    ///      oversight, and it is documented in the model's security notes.
    function normalize(string memory symbol) internal pure returns (bytes32) {
        bytes memory raw = bytes(symbol);
        uint256 length = raw.length;
        if (length == 0) revert SymbolEmpty();
        if (length > 32) revert SymbolTooLong(length);

        bytes memory folded = new bytes(length);
        for (uint256 i = 0; i < length; ++i) {
            bytes1 char = raw[i];
            // 'a' through 'z'
            if (char >= 0x61 && char <= 0x7A) {
                folded[i] = bytes1(uint8(char) - 32);
            } else {
                folded[i] = char;
            }
        }
        return keccak256(folded);
    }

    /// @notice Returns the state of `claim` as of `blockNumber`.
    /// @dev A claim with no pool has never been taken. A confirmed claim is permanent and never lapses. A
    ///      provisional claim lapses once the grace window has fully elapsed.
    function stateOf(TickerClaim memory claim, uint64 graceBlocks, uint256 blockNumber)
        internal
        pure
        returns (ClaimState)
    {
        if (claim.poolId == bytes32(0)) return ClaimState.Unclaimed;
        if (claim.confirmed) return ClaimState.Confirmed;
        if (blockNumber >= uint256(claim.claimBlock) + graceBlocks) return ClaimState.Lapsed;
        return ClaimState.Provisional;
    }

    /// @notice Returns whether a new pool may take the ticker for itself.
    /// @dev Only an unclaimed or lapsed ticker is available. A pool registering against a live claim is a derivative
    ///      and pays tribute instead; it is not rejected, because the model does not censor launches.
    function isAvailable(TickerClaim memory claim, uint64 graceBlocks, uint256 blockNumber)
        internal
        pure
        returns (bool)
    {
        ClaimState state = stateOf(claim, graceBlocks, blockNumber);
        return state == ClaimState.Unclaimed || state == ClaimState.Lapsed;
    }

    /// @notice Returns whether accrued creator fees are enough to make a claim permanent.
    function isEarned(uint256 creatorFeesAccrued, uint256 confirmationFeeWei) internal pure returns (bool) {
        return creatorFeesAccrued >= confirmationFeeWei;
    }

    /// @notice Splits a derivative pool's creator fee into the portion it keeps and the tribute owed to the original.
    /// @dev Rounding favours the derivative's own creator, so tribute can never exceed the fee it is drawn from.
    ///      Only the creator share is touched; the launcher and builder amounts are computed elsewhere and are not
    ///      arguments here, which makes it structurally impossible for this function to reduce them.
    ///
    ///      Uses `FullMath.mulDiv` for its 512-bit intermediate, matching every other fee calculation in the
    ///      repository. A plain multiplication overflows on fee amounts far above anything reachable with real ETH,
    ///      but the arithmetic here should not be the one place in the codebase that can revert on a large input.
    function splitTribute(uint256 creatorFee, uint16 tributeShareBps)
        internal
        pure
        returns (uint256 retained, uint256 tribute)
    {
        if (creatorFee == 0 || tributeShareBps == 0) return (creatorFee, 0);
        tribute = FullMath.mulDiv(creatorFee, tributeShareBps, BASIS_POINTS);
        retained = creatorFee - tribute;
    }
}
