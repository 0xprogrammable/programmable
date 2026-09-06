// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ModuleRuntimeTypesV1 as T } from "../ModuleRuntimeTypesV1.sol";

library ModuleNativeEngineTypesV1 {
    struct PoolRegistration {
        address launchWallet;
        address router;
        uint16 buyCreatorFeeBps;
        uint16 sellCreatorFeeBps;
        address[] creatorWallets;
        uint16[] creatorSharesBps;
        T.Selection[] modules;
    }

    /// @dev Only the pool's pinned router may supply this context. It derives actor and payer from its own caller.
    struct RouteContext {
        address actor;
        address payer;
        address recipient;
        uint64 sequence;
        bool initialBuy;
    }
}
