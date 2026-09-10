// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IAnyQuoteLedgerV1 {
    function registerLaunch(bytes32 launchId, address quoteAsset, address[] calldata creatorWallets, uint16[] calldata creatorSharesBps) external;
    function accrueQuote(bytes32 launchId, uint256 platformQuote, uint256 creatorQuote) external;
    function claimableQuote(address asset, address beneficiary) external view returns (uint256);
    function claimQuoteTo(address asset, address recipient) external returns (uint256);
    function claimQuoteFor(address asset, address beneficiary) external returns (uint256);
}
