// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { AnyQuoteTypesV1 as A } from "./AnyQuoteTypesV1.sol";

interface IAnyQuoteSharedHookV1 {
    function host() external view returns (address);
    function ledger() external view returns (address);
    function registerPool(A.PoolRegistration calldata registration, address[] calldata creatorWallets, uint16[] calldata creatorSharesBps)
        external returns (bytes32 poolId);
    function poolKey(bytes32 poolId) external view returns (PoolKey memory);
    function poolConfig(bytes32 poolId) external view returns (A.PoolRegistration memory);
    function previewGrossFees(bytes32 poolId, bool buy, uint256 grossQuote)
        external view returns (uint256 platformQuote, uint256 creatorQuote, uint16 nextPlatformRemainder, uint16 nextCreatorRemainder);
    function previewNetFees(bytes32 poolId, bool buy, uint256 netQuote)
        external view returns (uint256 grossQuote, uint256 platformQuote, uint256 creatorQuote, uint16 nextPlatformRemainder, uint16 nextCreatorRemainder);
}
