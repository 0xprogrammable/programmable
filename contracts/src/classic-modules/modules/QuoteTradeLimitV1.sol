// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IClassicModuleV1 } from "../IClassicModuleV1.sol";
import { ClassicModuleTypes as T } from "../ClassicModuleTypes.sol";

/// @notice Caps native quote per swap. It is not an anti-Sybil or guaranteed anti-sniping mechanism.
contract QuoteTradeLimitV1 is IClassicModuleV1 {
    function moduleKind() external pure returns (uint8) {
        return T.TRADE_LIMIT;
    }

    function validateConfig(bytes calldata config, uint16, uint16) external pure returns (bool) {
        if (config.length != 64) return false;
        (uint256 buyLimit, uint256 sellLimit) = abi.decode(config, (uint256, uint256));
        return (buyLimit != 0 || sellLimit != 0) && buyLimit <= uint256(uint128(type(int128).max))
            && sellLimit <= uint256(uint128(type(int128).max));
    }

    function evaluate(T.Context calldata, bytes calldata config) external pure returns (T.Effect memory effect) {
        (effect.buyQuoteLimit, effect.sellQuoteLimit) = abi.decode(config, (uint256, uint256));
    }
}
