// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IAnyQuoteEthLedgerV1 {
    function registerLaunch(
        bytes32 launchId,
        address quoteAsset,
        address[] calldata creatorWallets,
        uint16[] calldata creatorSharesBps
    ) external;
    function accrueEth(bytes32 launchId, uint256 platformEth, uint256 creatorEth) external;
    function claimableEth(address beneficiary) external view returns (uint256);
    function claimEthTo(address recipient) external returns (uint256);
    function claimEthFor(address beneficiary) external returns (uint256);
}
