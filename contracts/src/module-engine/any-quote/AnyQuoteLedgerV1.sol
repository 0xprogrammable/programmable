// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { AnyQuoteTypesV1 as Q } from "./AnyQuoteTypesV1.sol";
import { IAnyQuoteLedgerV1 } from "./IAnyQuoteLedgerV1.sol";

/// @notice Quote rewards backed by the ledger's PoolManager ERC6909 claims, including unallocated rounding dust.
/// @dev Only the immutable hook registers launches and accrues fees. Accrual makes no ERC20 or recipient calls.
///      Recipients can redirect future credits; historical credits, shares and rates cannot be changed.
contract AnyQuoteLedgerV1 is IAnyQuoteLedgerV1, IUnlockCallback, ReentrancyGuardTransient {
    bytes32 public constant ECONOMICS_POLICY_ID = Q.ECONOMICS_POLICY_ID;
    uint256 public constant MAX_CLAIM_AMOUNT = uint256(uint128(type(int128).max));
    uint256 private constant BPS = 10_000;

    struct Accounting {
        uint256 platformReceived;
        uint256 creatorReceived;
        uint256 credited;
    }

    IPoolManager public immutable poolManager;
    address public immutable host;
    address public immutable hook;
    address public immutable rewardAdmin;
    address public treasury;
    mapping(bytes32 launchId => address) public quoteAsset;
    mapping(bytes32 launchId => bytes32) public configurationHash;
    mapping(bytes32 launchId => Accounting) public accounting;
    mapping(bytes32 launchId => address[]) private _creatorWallets;
    mapping(bytes32 launchId => uint16[]) private _creatorShares;
    mapping(bytes32 launchId => uint256) public creatorAdminRevision;
    mapping(address asset => mapping(address beneficiary => uint256)) public override claimableQuote;
    mapping(address asset => mapping(address beneficiary => uint256)) public claimedBy;
    mapping(bytes32 launchId => mapping(address beneficiary => uint256)) public contributionByLaunch;
    mapping(address asset => uint256) public totalReceived;
    mapping(address asset => uint256) public totalCredited;
    mapping(address asset => uint256) public totalClaimed;
    bytes32 private _claimContext;

    error UnauthorizedHook();
    error UnauthorizedCallback();
    error InvalidConfiguration();
    error UnauthorizedWalletChange();
    error InvalidTransfer();
    error InsufficientBacking();
    error NoClaim();

    event QuoteLaunchRegistered(
        bytes32 indexed launchId,
        address indexed asset,
        bytes32 configurationHash,
        address[] creatorWallets,
        uint16[] creatorSharesBps
    );
    event QuoteFeesAccrued(
        bytes32 indexed launchId, address indexed asset, uint256 platform, uint256 creator, uint256 credited
    );
    event QuoteRewardCredited(
        bytes32 indexed launchId, address indexed asset, address indexed beneficiary, uint256 amount
    );
    event QuoteFeesClaimed(
        address indexed asset, address indexed beneficiary, address indexed recipient, uint256 amount
    );
    event CreatorWalletChanged(
        bytes32 indexed launchId,
        uint256 indexed index,
        address previous,
        address current,
        uint256 effectiveCreatorReceived
    );
    event CreatorRecipientsReplaced(
        bytes32 indexed launchId,
        address indexed administrator,
        uint256 indexed revision,
        address[] wallets,
        uint256 effectiveCreatorReceived
    );
    event PlatformWalletChanged(address indexed previous, address indexed current, address indexed administrator);

    constructor(IPoolManager manager, address host_, address rewardAdmin_) {
        if (address(manager).code.length == 0 || host_ == address(0)) revert InvalidConfiguration();
        poolManager = manager;
        host = host_;
        hook = msg.sender;
        _validateWallet(rewardAdmin_);
        rewardAdmin = rewardAdmin_;
        treasury = Q.PLATFORM_RECIPIENT;
        _validateWallet(treasury);
    }

    modifier onlyHook() {
        if (msg.sender != hook) revert UnauthorizedHook();
        _;
    }

    function registerLaunch(bytes32 launchId, address asset, address[] calldata wallets, uint16[] calldata shares)
        external
        override
        onlyHook
        nonReentrant
    {
        if (
            launchId == 0 || quoteAsset[launchId] != address(0) || asset.code.length == 0 || wallets.length == 0
                || wallets.length > 10 || wallets.length != shares.length
        ) revert InvalidConfiguration();
        uint256 sum;
        for (uint256 i; i < wallets.length; ++i) {
            _validateWallet(wallets[i]);
            if (shares[i] == 0) revert InvalidConfiguration();
            sum += shares[i];
        }
        if (sum != BPS) revert InvalidConfiguration();
        quoteAsset[launchId] = asset;
        _creatorWallets[launchId] = wallets;
        _creatorShares[launchId] = shares;
        bytes32 bound = keccak256(
            abi.encode(
                ECONOMICS_POLICY_ID,
                block.chainid,
                address(this),
                address(poolManager),
                hook,
                host,
                launchId,
                asset,
                wallets,
                shares
            )
        );
        configurationHash[launchId] = bound;
        emit QuoteLaunchRegistered(launchId, asset, bound, wallets, shares);
    }

    /// @dev The hook mints the exact Core fee claims before accrual. Core enforces settlement at unlock completion.
    function accrueQuote(bytes32 launchId, uint256 platform, uint256 creator) external override onlyHook nonReentrant {
        address asset = _asset(launchId);
        totalReceived[asset] += platform + creator;
        _assertBacking(asset);
        Accounting storage a = accounting[launchId];
        uint256 previousCreator = a.creatorReceived;
        uint256 previousCredited = a.credited;
        a.platformReceived += platform;
        a.creatorReceived += creator;
        _credit(launchId, treasury, platform);
        for (uint256 i; i < _creatorWallets[launchId].length; ++i) {
            uint256 share = _creatorShares[launchId][i];
            _credit(
                launchId,
                _creatorWallets[launchId][i],
                FullMath.mulDiv(a.creatorReceived, share, BPS) - FullMath.mulDiv(previousCreator, share, BPS)
            );
        }
        emit QuoteFeesAccrued(launchId, asset, platform, creator, a.credited - previousCredited);
    }

    function platformFeeBps(bytes32 launchId) external view returns (uint16) {
        _asset(launchId);
        return Q.PLATFORM_BPS;
    }

    function creatorRecipients(bytes32 launchId) external view returns (address[] memory, uint16[] memory, uint256) {
        _asset(launchId);
        return (_creatorWallets[launchId], _creatorShares[launchId], creatorAdminRevision[launchId]);
    }

    function changeCreatorWallet(bytes32 launchId, uint256 index, address next) external nonReentrant {
        _asset(launchId);
        if (
            index >= _creatorWallets[launchId].length
                || (msg.sender != _creatorWallets[launchId][index] && msg.sender != rewardAdmin)
        ) revert UnauthorizedWalletChange();
        _validateWallet(next);
        address previous = _creatorWallets[launchId][index];
        if (next == previous) revert InvalidConfiguration();
        _creatorWallets[launchId][index] = next;
        emit CreatorWalletChanged(launchId, index, previous, next, accounting[launchId].creatorReceived);
    }

    /// @notice The reward administrator may replace future recipients, preserving the original shares and credits.
    function replaceCreatorWallets(
        bytes32 launchId,
        address[] calldata next,
        uint256 expectedRevision,
        uint256 deadline
    ) external nonReentrant {
        _asset(launchId);
        if (
            msg.sender != rewardAdmin || deadline == 0 || deadline < block.timestamp
                || expectedRevision != creatorAdminRevision[launchId] || next.length != _creatorWallets[launchId].length
        ) revert UnauthorizedWalletChange();
        for (uint256 i; i < next.length; ++i) {
            _validateWallet(next[i]);
        }
        creatorAdminRevision[launchId] = expectedRevision + 1;
        uint256 earned = accounting[launchId].creatorReceived;
        for (uint256 i; i < next.length; ++i) {
            address previous = _creatorWallets[launchId][i];
            if (previous == next[i]) continue;
            _creatorWallets[launchId][i] = next[i];
            emit CreatorWalletChanged(launchId, i, previous, next[i], earned);
        }
        emit CreatorRecipientsReplaced(launchId, msg.sender, expectedRevision + 1, next, earned);
    }

    function changePlatformWallet(address next) external nonReentrant {
        address previous = treasury;
        if (msg.sender != previous && msg.sender != rewardAdmin) revert UnauthorizedWalletChange();
        _validateWallet(next);
        if (next == previous) revert InvalidConfiguration();
        treasury = next;
        emit PlatformWalletChanged(previous, next, msg.sender);
    }

    /// @notice Pays up to Core's per-operation int128 limit; any remaining entitlement stays claimable.
    function claimQuoteTo(address asset, address recipient) external override nonReentrant returns (uint256) {
        return _claim(asset, msg.sender, recipient);
    }

    /// @notice Anyone may pay a beneficiary to itself, subject to the same per-operation Core limit.
    function claimQuoteFor(address asset, address beneficiary) external override nonReentrant returns (uint256) {
        return _claim(asset, beneficiary, beneficiary);
    }

    /// @dev Only the callback of this ledger's active claim may burn its own ERC6909 balance.
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (
            msg.sender != address(poolManager) || !_reentrancyGuardEntered() || _claimContext == bytes32(0)
                || keccak256(data) != _claimContext
        ) revert UnauthorizedCallback();
        _claimContext = bytes32(0);
        (address asset, address recipient, uint256 amount) = abi.decode(data, (address, address, uint256));
        IERC20 token = IERC20(asset);
        uint256 id = uint256(uint160(asset));
        uint256 beforeClaims = poolManager.balanceOf(address(this), id);
        uint256 beforeManager = token.balanceOf(address(poolManager));
        uint256 beforeRecipient = token.balanceOf(recipient);
        poolManager.burn(address(this), id, amount);
        poolManager.take(Currency.wrap(asset), recipient, amount);
        uint256 afterClaims = poolManager.balanceOf(address(this), id);
        uint256 afterManager = token.balanceOf(address(poolManager));
        uint256 afterRecipient = token.balanceOf(recipient);
        if (
            afterClaims > beforeClaims || beforeClaims - afterClaims != amount || afterManager > beforeManager
                || beforeManager - afterManager != amount || afterRecipient < beforeRecipient
                || afterRecipient - beforeRecipient != amount
        ) revert InvalidTransfer();
        return bytes("");
    }

    function quoteDust(address asset) external view returns (uint256) {
        return totalReceived[asset] - totalCredited[asset];
    }

    function outstandingClaims(address asset) external view returns (uint256) {
        return totalCredited[asset] - totalClaimed[asset];
    }

    function _credit(bytes32 launchId, address beneficiary, uint256 amount) private {
        if (amount == 0) return;
        address asset = quoteAsset[launchId];
        accounting[launchId].credited += amount;
        totalCredited[asset] += amount;
        claimableQuote[asset][beneficiary] += amount;
        contributionByLaunch[launchId][beneficiary] += amount;
        emit QuoteRewardCredited(launchId, asset, beneficiary, amount);
    }

    function _claim(address asset, address beneficiary, address recipient) private returns (uint256 amount) {
        _validateWallet(recipient);
        amount = claimableQuote[asset][beneficiary];
        if (amount == 0) revert NoClaim();
        if (amount > MAX_CLAIM_AMOUNT) amount = MAX_CLAIM_AMOUNT;
        _assertBacking(asset);
        claimableQuote[asset][beneficiary] -= amount;
        totalClaimed[asset] += amount;
        claimedBy[asset][beneficiary] += amount;
        bytes memory data = abi.encode(asset, recipient, amount);
        _claimContext = keccak256(data);
        poolManager.unlock(data);
        if (_claimContext != bytes32(0)) revert UnauthorizedCallback();
        _assertBacking(asset);
        emit QuoteFeesClaimed(asset, beneficiary, recipient, amount);
    }

    function _asset(bytes32 launchId) private view returns (address asset) {
        asset = quoteAsset[launchId];
        if (asset == address(0)) revert InvalidConfiguration();
    }

    function _assertBacking(address asset) private view {
        if (poolManager.balanceOf(address(this), uint256(uint160(asset))) < totalReceived[asset] - totalClaimed[asset])
        {
            revert InsufficientBacking();
        }
    }

    function _validateWallet(address wallet) private view {
        if (
            wallet == address(0) || wallet == address(this) || wallet == host || wallet == hook
                || wallet == address(poolManager)
        ) revert InvalidConfiguration();
    }
}
