// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ModuleQuoteSettlementEngineV1 } from "./module-engine/ModuleQuoteSettlementEngineV1.sol";
import { ModuleEngineTypesV1 as T } from "./module-engine/ModuleEngineTypesV1.sol";

/// @notice A contributor entrypoint using the canonical request/fulfill/refund implementation.
/// @dev The quote address is a launch input or a schema-bound template value. The reviewed host must also
///      bind fixed templates through Revision.fixedQuoteAsset. The constructor independently checks that
///      encoded quote selection matches the host context and that the fixed windows cannot be bypassed.
contract QuoteBoundSettlementV1 is ModuleQuoteSettlementEngineV1 {
    error InvalidConfigurationBytes();
    error QuoteContextMismatch();
    error FixedWindowOverride();

    constructor(T.Context memory context_, bytes memory configuration)
        ModuleQuoteSettlementEngineV1(context_, _windows(context_.quoteAsset, configuration))
    { }

    function _windows(address contextQuote, bytes memory configuration) private pure returns (bytes memory) {
        if (configuration.length != 96) revert InvalidConfigurationBytes();
        (address quoteAsset, uint256 minimumWindow_, uint256 maximumWindow_) =
            abi.decode(configuration, (address, uint256, uint256));
        if (quoteAsset != contextQuote) revert QuoteContextMismatch();
        if (minimumWindow_ != 60 || maximumWindow_ != 30 days) revert FixedWindowOverride();
        return abi.encode(minimumWindow_, maximumWindow_);
    }
}
