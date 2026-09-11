// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { TransientStateLibrary } from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { AnyQuoteTypesV1 as Q } from "./AnyQuoteTypesV1.sol";
import { IAnyQuoteEthLedgerV1 } from "./IAnyQuoteEthLedgerV1.sol";

/// @notice ETH rewards backed by the ledger's native PoolManager ERC6909 claims, including rounding dust.
/// @dev Only the immutable hook registers launches and accrues already converted ETH. Accrual makes no
///      recipient calls. Address changes redirect future credits; historical credits and shares stay fixed.
contract AnyQuoteEthLedgerV1 is IAnyQuoteEthLedgerV1, IUnlockCallback, ReentrancyGuardTransient {
    using TransientStateLibrary for IPoolManager;

    bytes32 public constant ECONOMICS_POLICY_ID =
        keccak256("programmable.any-quote.base-30.creator-0-1000.native-eth.v1");
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
    mapping(address beneficiary => uint256) public override claimableEth;
    mapping(address beneficiary => uint256) public claimedBy;
    mapping(bytes32 launchId => mapping(address beneficiary => uint256)) public contributionByLaunch;
    uint256 public totalReceived;
    uint256 public totalCredited;
    uint256 public totalClaimed;
    bytes32 private _claimContext;

    error UnauthorizedHook();
    error UnauthorizedCallback();
    error InvalidConfiguration();
    error UnauthorizedWalletChange();
    error InvalidTransfer();
    error InsufficientBacking();
    error NoClaim();

    event EthLaunchRegistered(
        bytes32 indexed launchId,
        address indexed quoteAsset,
        bytes32 configurationHash,
        address[] creatorWallets,
        uint16[] creatorSharesBps
    );
    event EthFeesAccrued(
        bytes32 indexed launchId,
        address indexed quoteAsset,
        uint256 platformEth,
        uint256 creatorEth,
        uint256 creditedEth
    );
    event EthRewardCredited(
        bytes32 indexed launchId, address indexed quoteAsset, address indexed beneficiary, uint256 amount
    );
    event EthFeesClaimed(address indexed beneficiary, address indexed recipient, uint256 amount);
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
        emit EthLaunchRegistered(launchId, asset, bound, wallets, shares);
    }

    /// @dev The hook mints native Core claims before accrual. Core enforces settlement at unlock completion.
    ///      A direct ETH transfer to this ledger cannot provide backing or create a reward entitlement.
    function accrueEth(bytes32 launchId, uint256 platformEth, uint256 creatorEth)
        external
        override
        onlyHook
        nonReentrant
    {
        address asset = _asset(launchId);
        totalReceived += platformEth + creatorEth;
        _assertBacking();
        Accounting storage a = accounting[launchId];
        uint256 previousCreator = a.creatorReceived;
        uint256 previousCredited = a.credited;
        a.platformReceived += platformEth;
        a.creatorReceived += creatorEth;
        _credit(launchId, treasury, platformEth);
        for (uint256 i; i < _creatorWallets[launchId].length; ++i) {
            uint256 share = _creatorShares[launchId][i];
            _credit(
                launchId,
                _creatorWallets[launchId][i],
                FullMath.mulDiv(a.creatorReceived, share, BPS) - FullMath.mulDiv(previousCreator, share, BPS)
            );
        }
        emit EthFeesAccrued(launchId, asset, platformEth, creatorEth, a.credited - previousCredited);
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
    function claimEthTo(address recipient) external override nonReentrant returns (uint256) {
        return _claim(msg.sender, recipient);
    }

    /// @notice Anyone may pay a beneficiary to itself, subject to the same per-operation Core limit.
    function claimEthFor(address beneficiary) external override nonReentrant returns (uint256) {
        return _claim(beneficiary, beneficiary);
    }

    /// @dev Only this ledger's active claim callback may burn its own native ERC6909 claims.
    ///      Core's native take reverts if payment fails. A recipient may forward ETH in its callback, so
    ///      recipient and manager balances are not used to infer whether the payment succeeded.
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (
            msg.sender != address(poolManager) || !_reentrancyGuardEntered() || _claimContext == bytes32(0)
                || keccak256(data) != _claimContext
        ) revert UnauthorizedCallback();
        _claimContext = bytes32(0);
        (address recipient, uint256 amount) = abi.decode(data, (address, uint256));
        Currency native = Currency.wrap(address(0));
        uint256 beforeClaims = poolManager.balanceOf(address(this), 0);
        if (poolManager.currencyDelta(address(this), native) != 0) revert InvalidTransfer();
        poolManager.burn(address(this), 0, amount);
        uint256 afterBurn = poolManager.balanceOf(address(this), 0);
        if (
            afterBurn > beforeClaims || beforeClaims - afterBurn != amount
                || poolManager.currencyDelta(address(this), native) != int256(amount)
        ) revert InvalidTransfer();
        poolManager.take(native, recipient, amount);
        if (poolManager.currencyDelta(address(this), native) != 0) revert InvalidTransfer();
        return bytes("");
    }

    function ethDust() external view returns (uint256) {
        return totalReceived - totalCredited;
    }

    function outstandingClaims() external view returns (uint256) {
        return totalCredited - totalClaimed;
    }

    function _credit(bytes32 launchId, address beneficiary, uint256 amount) private {
        if (amount == 0) return;
        accounting[launchId].credited += amount;
        totalCredited += amount;
        claimableEth[beneficiary] += amount;
        contributionByLaunch[launchId][beneficiary] += amount;
        emit EthRewardCredited(launchId, quoteAsset[launchId], beneficiary, amount);
    }

    function _claim(address beneficiary, address recipient) private returns (uint256 amount) {
        _validateWallet(recipient);
        amount = claimableEth[beneficiary];
        if (amount == 0) revert NoClaim();
        if (amount > MAX_CLAIM_AMOUNT) amount = MAX_CLAIM_AMOUNT;
        _assertBacking();
        claimableEth[beneficiary] -= amount;
        totalClaimed += amount;
        claimedBy[beneficiary] += amount;
        bytes memory data = abi.encode(recipient, amount);
        _claimContext = keccak256(data);
        poolManager.unlock(data);
        if (_claimContext != bytes32(0)) revert UnauthorizedCallback();
        _assertBacking();
        emit EthFeesClaimed(beneficiary, recipient, amount);
    }

    function _asset(bytes32 launchId) private view returns (address asset) {
        asset = quoteAsset[launchId];
        if (asset == address(0)) revert InvalidConfiguration();
    }

    function _assertBacking() private view {
        if (poolManager.balanceOf(address(this), 0) < totalReceived - totalClaimed) revert InsufficientBacking();
    }

    function _validateWallet(address wallet) private view {
        if (
            wallet == address(0) || wallet == address(this) || wallet == host || wallet == hook
                || wallet == address(poolManager)
        ) revert InvalidConfiguration();
    }
}
