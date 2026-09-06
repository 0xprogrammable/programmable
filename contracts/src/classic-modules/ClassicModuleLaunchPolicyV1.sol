// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";

/// @title ClassicModuleLaunchPolicyV1
/// @notice Bounded, immutable metadata, creator-allocation and base-fee policy for Classic module launches.
/// @dev Creator fees are additional to the mandatory platform/author fee and may be zero. Creator shares stay fixed.
contract ClassicModuleLaunchPolicyV1 {
    uint256 public constant MAX_TOKEN_NAME_BYTES = 48;
    uint256 public constant MAX_TOKEN_SYMBOL_BYTES = 12;
    uint256 public constant MAX_TOKEN_DESCRIPTION_BYTES = 280;
    uint256 public constant MAX_METADATA_URL_BYTES = 2048;
    uint256 public constant MAX_SOCIAL_EXTRA_DATA_BYTES = 1200;
    uint256 public constant MAX_REWARD_BENEFICIARIES = 10;
    uint16 public constant REWARD_SHARE_BASIS_POINTS = 10_000;

    uint16 public constant MAX_CREATOR_FEE_BPS = 1000;
    uint16 public constant CREATOR_FEE_STEP_BPS = 100;

    error InvalidCreatorFee(uint16 feeBps);
    error DuplicateRewardBeneficiary(address beneficiary);
    error EmptyName();
    error EmptySymbol();
    error InvalidBeneficiaryCount(uint256 count);
    error InvalidRewardBeneficiary(address beneficiary);
    error InvalidRewardShare(address beneficiary, uint16 shareBps);
    error InvalidRewardShareTotal(uint256 totalShareBps);
    error MetadataExtraDataTooLong(uint256 actualBytes, uint256 maximumBytes);
    error MetadataImageTooLong(uint256 actualBytes, uint256 maximumBytes);
    error MetadataWebsiteTooLong(uint256 actualBytes, uint256 maximumBytes);
    error TokenDescriptionTooLong(uint256 actualBytes, uint256 maximumBytes);
    error TokenNameTooLong(uint256 actualBytes, uint256 maximumBytes);
    error TokenSymbolTooLong(uint256 actualBytes, uint256 maximumBytes);

    function validate(
        string calldata name,
        string calldata symbol,
        UERC20Metadata calldata metadata,
        address[] calldata beneficiaries,
        uint16[] calldata sharesBps,
        uint16 buyCreatorFeeBps,
        uint16 sellCreatorFeeBps
    ) external pure {
        _validateCreatorFee(buyCreatorFeeBps);
        _validateCreatorFee(sellCreatorFeeBps);
        _validateMetadata(name, symbol, metadata);
        _validateRewardConfiguration(beneficiaries, sharesBps);
    }

    function _validateCreatorFee(uint16 feeBps) private pure {
        if (feeBps > MAX_CREATOR_FEE_BPS || feeBps % CREATOR_FEE_STEP_BPS != 0) {
            revert InvalidCreatorFee(feeBps);
        }
    }

    function _validateMetadata(string calldata name, string calldata symbol, UERC20Metadata calldata metadata)
        private
        pure
    {
        uint256 nameBytes = bytes(name).length;
        uint256 symbolBytes = bytes(symbol).length;
        uint256 descriptionBytes = bytes(metadata.description).length;
        uint256 websiteBytes = bytes(metadata.website).length;
        uint256 imageBytes = bytes(metadata.image).length;
        uint256 extraDataBytes = metadata.extraData.length;

        if (nameBytes == 0) revert EmptyName();
        if (symbolBytes == 0) revert EmptySymbol();
        if (nameBytes > MAX_TOKEN_NAME_BYTES) revert TokenNameTooLong(nameBytes, MAX_TOKEN_NAME_BYTES);
        if (symbolBytes > MAX_TOKEN_SYMBOL_BYTES) {
            revert TokenSymbolTooLong(symbolBytes, MAX_TOKEN_SYMBOL_BYTES);
        }
        if (descriptionBytes > MAX_TOKEN_DESCRIPTION_BYTES) {
            revert TokenDescriptionTooLong(descriptionBytes, MAX_TOKEN_DESCRIPTION_BYTES);
        }
        if (websiteBytes > MAX_METADATA_URL_BYTES) {
            revert MetadataWebsiteTooLong(websiteBytes, MAX_METADATA_URL_BYTES);
        }
        if (imageBytes > MAX_METADATA_URL_BYTES) {
            revert MetadataImageTooLong(imageBytes, MAX_METADATA_URL_BYTES);
        }
        if (extraDataBytes > MAX_SOCIAL_EXTRA_DATA_BYTES) {
            revert MetadataExtraDataTooLong(extraDataBytes, MAX_SOCIAL_EXTRA_DATA_BYTES);
        }
    }

    function _validateRewardConfiguration(address[] calldata beneficiaries, uint16[] calldata sharesBps) private pure {
        uint256 count = beneficiaries.length;
        if (count == 0 || count > MAX_REWARD_BENEFICIARIES || sharesBps.length != count) {
            revert InvalidBeneficiaryCount(count);
        }
        uint256 totalShareBps = 0;
        for (uint256 index; index < count; index++) {
            address beneficiary = beneficiaries[index];
            uint16 shareBps = sharesBps[index];
            if (beneficiary == address(0)) revert InvalidRewardBeneficiary(beneficiary);
            if (shareBps == 0) revert InvalidRewardShare(beneficiary, shareBps);
            for (uint256 prior; prior < index; prior++) {
                if (beneficiaries[prior] == beneficiary) {
                    revert DuplicateRewardBeneficiary(beneficiary);
                }
            }
            totalShareBps += shareBps;
        }
        if (totalShareBps != REWARD_SHARE_BASIS_POINTS) {
            revert InvalidRewardShareTotal(totalShareBps);
        }
    }
}
