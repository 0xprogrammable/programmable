// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IAnyQuoteSharedHookV1 } from "./IAnyQuoteSharedHookV1.sol";
import { AnyQuoteTypesV1 as A } from "./AnyQuoteTypesV1.sol";
import { AnyQuoteNativeFeeRouteV1 as R } from "./AnyQuoteNativeFeeRouteV1.sol";

interface IAnyQuoteEthSharedHookV1 is IAnyQuoteSharedHookV1 {
    function registerPoolWithNativeFeeRoute(
        A.PoolRegistration calldata registration,
        address[] calldata creatorWallets,
        uint16[] calldata creatorSharesBps,
        R.FeeHop[] calldata hops
    ) external returns (bytes32 poolId);
    function nativeFeeRouteHash(bytes32 poolId) external view returns (bytes32);
    function nativeFeeRoute(bytes32 poolId) external view returns (R.FeeHop[] memory);
}
