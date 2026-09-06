// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IClassicModuleV1 } from "../IClassicModuleV1.sol";
import { ClassicModuleTypes as T } from "../ClassicModuleTypes.sol";

/// @notice Linearly reduces disclosed creator fees to immutable targets; the 20 bps protocol fee is unaffected.
contract FallingCreatorFeeV1 is IClassicModuleV1 {
    function moduleKind() external pure returns (uint8) {
        return T.FEE_POLICY;
    }

    function validateConfig(bytes calldata config, uint16 baseBuyFeeBps, uint16 baseSellFeeBps)
        external
        pure
        returns (bool)
    {
        if (config.length != 96) return false;
        (uint256 buyEnd, uint256 sellEnd, uint256 duration) = abi.decode(config, (uint256, uint256, uint256));
        return duration >= 60 && duration <= 30 days && buyEnd <= baseBuyFeeBps && sellEnd <= baseSellFeeBps
            && (buyEnd < baseBuyFeeBps || sellEnd < baseSellFeeBps);
    }

    function evaluate(T.Context calldata context, bytes calldata config)
        external
        pure
        returns (T.Effect memory effect)
    {
        (uint256 buyEnd, uint256 sellEnd, uint256 duration) = abi.decode(config, (uint256, uint256, uint256));
        uint256 elapsed = context.elapsed > duration ? duration : context.elapsed;
        effect.buyCreatorFeeBps = uint16(buyEnd + (context.baseBuyFeeBps - buyEnd) * (duration - elapsed) / duration);
        effect.sellCreatorFeeBps =
            uint16(sellEnd + (context.baseSellFeeBps - sellEnd) * (duration - elapsed) / duration);
    }
}
