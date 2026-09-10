// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AnyQuoteTypesV1 as A} from "./AnyQuoteTypesV1.sol";

/// @notice Quote-denominated fees with independent, persistent rounding carry.
library AnyQuoteFeeMathV1 {
    uint256 internal constant BASIS = 10_000;
    uint256 internal constant MAX_AMOUNT = uint256(uint128(type(int128).max));

    struct Carry {
        uint16 platform;
        uint16 creator;
    }

    struct Result {
        uint256 platform;
        uint256 creator;
        Carry next;
    }

    error InvalidFeeParameters();
    error InvalidFeeAmount();
    error NoPositiveNetAmount();

    /// @dev May return fees >= gross for dust with accumulated carry. The caller must reject nonpositive net.
    function quoteGross(uint256 gross, uint16 creatorBps, Carry memory carry)
        internal
        pure
        returns (Result memory result)
    {
        _validate(creatorBps, carry);
        if (gross == 0 || gross > MAX_AMOUNT) revert InvalidFeeAmount();
        // int128 amount bounds make both products and remainder additions safe in uint256.
        uint256 platformNumerator = gross * A.PLATFORM_BPS + carry.platform;
        uint256 creatorNumerator = gross * creatorBps + carry.creator;
        result.platform = platformNumerator / BASIS;
        result.creator = creatorNumerator / BASIS;
        result.next = Carry(uint16(platformNumerator % BASIS), uint16(creatorNumerator % BASIS));
    }

    /// @notice Smallest representable gross whose net is exactly the requested positive amount.
    /// @dev Two fee floors can jump together, so net(gross) is not monotone. A binary search is invalid.
    function quoteNet(uint256 net, uint16 creatorBps, Carry memory carry)
        internal
        pure
        returns (uint256 gross, Result memory result)
    {
        _validate(creatorBps, carry);
        if (net == 0 || net > MAX_AMOUNT) revert InvalidFeeAmount();
        uint256 denominator = BASIS - A.PLATFORM_BPS - creatorBps;
        uint256 upper = (BASIS * net + carry.platform + carry.creator) / denominator;
        // The two final remainders sum to at most 19,998. denominator >= 8,970.
        // Every exact solution is in [upper-3, upper]. Check in ascending order for the smallest one.
        uint256 lower = upper > 3 ? upper - 3 : 0;
        if (lower < net) lower = net;
        if (upper > MAX_AMOUNT) upper = MAX_AMOUNT;
        for (gross = lower; gross <= upper; ++gross) {
            result = quoteGross(gross, creatorBps, carry);
            uint256 total = result.platform + result.creator;
            if (total < gross && gross - total == net) return (gross, result);
        }
        revert NoPositiveNetAmount();
    }

    function _validate(uint16 creatorBps, Carry memory carry) private pure {
        if (creatorBps > A.MAX_CREATOR_BPS || carry.platform >= BASIS || carry.creator >= BASIS) {
            revert InvalidFeeParameters();
        }
    }
}
