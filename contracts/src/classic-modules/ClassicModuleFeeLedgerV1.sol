// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { CurrencySettler } from "@openzeppelin/uniswap-hooks/src/utils/CurrencySettler.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";

interface IClassicModuleAuthorRegistry {
    function authorWallet(bytes32 familyId) external view returns (address);
}

/// @title ClassicModuleFeeLedgerV1
/// @notice Accounts for native Classic fees already collected by its immutable deploying hook.
/// @dev The hook mints native PoolManager claims to this ledger before accruing fees. Each pool's platform bucket
///      gives floor(lifetime platform fees / 2) to each of treasury and authors. Every selected family has the same
///      floor(lifetime author bucket / family count) entitlement. Creator slots independently round down their
///      immutable share of lifetime creator fees. Unallocated units remain explicit, fully backed dust; no recipient
///      receives a remainder bonus. Wallets own only units credited while they are the active payout address.
///      Fractional units are not claimable: a carried unit is credited to the wallet active when it becomes whole.
///      There is no arbitrary sweep, share replacement, fee setter, pause, or upgrade path.
contract ClassicModuleFeeLedgerV1 is IUnlockCallback, ReentrancyGuardTransient {
    using Address for address payable;
    using CurrencySettler for Currency;

    uint256 public constant BASIS_POINTS = 10_000;
    uint256 public constant MAX_CREATORS = 10;
    uint256 public constant MAX_MODULE_FAMILIES = 8;
    Currency private constant NATIVE = Currency.wrap(address(0));

    struct PoolAccounting {
        uint256 platformReceived;
        uint256 creatorReceived;
        uint256 treasuryCredited;
        uint256 authorsCredited;
        uint256 creatorsCredited;
    }

    IPoolManager public immutable poolManager;
    IClassicModuleAuthorRegistry public immutable registry;
    address public immutable hook;
    address public immutable treasury;
    address public immutable rewardAdmin;
    address public immutable noModuleRecipient;

    mapping(bytes32 poolId => bool) public registered;
    mapping(bytes32 poolId => bytes32) public configurationHash;
    mapping(bytes32 poolId => PoolAccounting) public poolAccounting;
    mapping(bytes32 poolId => address[]) private _creatorWallets;
    mapping(bytes32 poolId => uint16[]) private _creatorSharesBps;
    mapping(bytes32 poolId => bytes32[]) private _moduleFamilies;
    /// @notice Counts only administrative recipient changes. Creator self-rotation cannot veto a CTO.
    mapping(bytes32 poolId => uint256) public creatorAdminRevision;

    mapping(address beneficiary => uint256) public claimable;
    mapping(address beneficiary => uint256) public claimedBy;
    /// @notice Lifetime credited contribution of one pool to a current or historical beneficiary.
    mapping(bytes32 poolId => mapping(address beneficiary => uint256)) public contributionByPool;

    uint256 public totalFeesReceived;
    uint256 public totalCredited;
    uint256 public totalClaimed;
    uint256 private _pendingRedemption;

    error InvalidDependency(address dependency);
    error InvalidWallet(address wallet);
    error UnauthorizedHook(address caller);
    error PoolAlreadyRegistered(bytes32 poolId);
    error PoolNotRegistered(bytes32 poolId);
    error InvalidCreatorCount(uint256 count);
    error InvalidCreatorShare(uint256 index, uint16 shareBps);
    error InvalidShareTotal(uint256 total);
    error InvalidModuleCount(uint256 count);
    error InvalidModuleFamily(bytes32 familyId);
    error ModuleFamiliesNotStrictlyOrdered(bytes32 previous, bytes32 current);
    error InvalidCreatorIndex(uint256 index);
    error UnauthorizedWalletRotation(address caller);
    error PayoutWalletUnchanged(address wallet);
    error StaleCreatorAdminRevision(uint256 expected, uint256 actual);
    error CreatorAdminDeadlineExpired(uint256 deadline);
    error InsufficientBacking(uint256 available, uint256 required);
    error NoFeesToClaim(address beneficiary);
    error UnauthorizedPoolManager(address caller);
    error UnexpectedUnlockCallback();
    error UnexpectedUnlockResult();
    error UnauthorizedNativeSender(address caller);

    event PoolRegistered(
        bytes32 indexed poolId,
        bytes32 indexed configurationHash,
        address[] creatorWallets,
        uint16[] creatorSharesBps,
        bytes32[] moduleFamilies
    );
    event FeesAccrued(
        bytes32 indexed poolId, uint256 platformFee, uint256 creatorFee, uint256 credited, uint256 poolDust
    );
    event RewardCredited(bytes32 indexed poolId, address indexed beneficiary, uint256 amount);
    event CreatorWalletChanged(
        bytes32 indexed poolId,
        uint256 indexed index,
        address indexed previousWallet,
        address newWallet,
        uint256 effectiveCreatorFeesReceived
    );
    event FeesClaimed(address indexed beneficiary, address indexed recipient, address indexed caller, uint256 amount);
    event CreatorRecipientsReplaced(
        bytes32 indexed poolId,
        address indexed administrator,
        uint256 indexed adminRevision,
        address[] wallets,
        uint256 effectiveCreatorFeesReceived
    );

    constructor(
        IPoolManager poolManager_,
        IClassicModuleAuthorRegistry registry_,
        address treasury_,
        address rewardAdmin_,
        address noModuleRecipient_
    ) {
        if (address(poolManager_).code.length == 0) revert InvalidDependency(address(poolManager_));
        if (address(registry_).code.length == 0) revert InvalidDependency(address(registry_));
        _validateWallet(treasury_);
        _validateWallet(rewardAdmin_);
        _validateWallet(noModuleRecipient_);
        poolManager = poolManager_;
        registry = registry_;
        hook = msg.sender;
        treasury = treasury_;
        rewardAdmin = rewardAdmin_;
        noModuleRecipient = noModuleRecipient_;
    }

    modifier onlyHook() {
        if (msg.sender != hook) revert UnauthorizedHook(msg.sender);
        _;
    }

    /// @notice Binds immutable creator shares and distinct, canonically ordered module families to a pool.
    /// @dev Exact module revisions and their acceptance are validated by the hook before this registration.
    function registerPool(
        bytes32 poolId,
        address[] calldata creatorWallets,
        uint16[] calldata sharesBps,
        bytes32[] calldata moduleFamilies
    ) external onlyHook nonReentrant {
        if (registered[poolId]) revert PoolAlreadyRegistered(poolId);
        uint256 creators = creatorWallets.length;
        if (creators == 0 || creators > MAX_CREATORS || creators != sharesBps.length) {
            revert InvalidCreatorCount(creators);
        }
        uint256 shareTotal;
        for (uint256 index; index < creators; index++) {
            _validateWallet(creatorWallets[index]);
            if (sharesBps[index] == 0) revert InvalidCreatorShare(index, 0);
            shareTotal += sharesBps[index];
        }
        if (shareTotal != BASIS_POINTS) revert InvalidShareTotal(shareTotal);

        uint256 modules = moduleFamilies.length;
        if (modules > MAX_MODULE_FAMILIES) revert InvalidModuleCount(modules);
        for (uint256 index; index < modules; index++) {
            bytes32 family = moduleFamilies[index];
            if (family == bytes32(0)) revert InvalidModuleFamily(family);
            if (index != 0 && uint256(moduleFamilies[index - 1]) >= uint256(family)) {
                revert ModuleFamiliesNotStrictlyOrdered(moduleFamilies[index - 1], family);
            }
            _validateWallet(registry.authorWallet(family));
        }

        registered[poolId] = true;
        _creatorWallets[poolId] = creatorWallets;
        _creatorSharesBps[poolId] = sharesBps;
        _moduleFamilies[poolId] = moduleFamilies;
        bytes32 configHash = keccak256(
            abi.encode(block.chainid, address(this), hook, poolId, creatorWallets, sharesBps, moduleFamilies)
        );
        configurationHash[poolId] = configHash;
        emit PoolRegistered(poolId, configHash, creatorWallets, sharesBps, moduleFamilies);
    }

    /// @notice Credits only the difference between successive lifetime entitlements, at actual fee accrual time.
    /// @dev Called after native ERC-6909 claims have been minted to this ledger, in the same atomic swap execution.
    function accrue(bytes32 poolId, uint256 platformFee, uint256 creatorFee) external onlyHook nonReentrant {
        _requireRegistered(poolId);
        uint256 received = platformFee + creatorFee;
        if (received == 0) return;
        totalFeesReceived += received;
        _assertBacking();

        PoolAccounting storage accounting = poolAccounting[poolId];
        uint256 previousPlatform = accounting.platformReceived;
        uint256 previousCreator = accounting.creatorReceived;
        accounting.platformReceived = previousPlatform + platformFee;
        accounting.creatorReceived = previousCreator + creatorFee;
        uint256 creditedBefore = totalCredited;

        if (platformFee != 0) _allocatePlatform(poolId, previousPlatform, accounting);
        if (creatorFee != 0) _allocateCreators(poolId, previousCreator, accounting);

        emit FeesAccrued(poolId, platformFee, creatorFee, totalCredited - creditedBefore, _poolDust(accounting));
    }

    /// @notice The current beneficiary rotates its own slot; administrators use the revision-bound batch API.
    function changeCreatorWallet(bytes32 poolId, uint256 index, address newWallet) external nonReentrant {
        _requireRegistered(poolId);
        if (index >= _creatorWallets[poolId].length) revert InvalidCreatorIndex(index);
        address previousWallet = _creatorWallets[poolId][index];
        if (msg.sender != previousWallet) {
            revert UnauthorizedWalletRotation(msg.sender);
        }
        _validateWallet(newWallet);
        if (newWallet == previousWallet) revert PayoutWalletUnchanged(newWallet);
        _creatorWallets[poolId][index] = newWallet;
        emit CreatorWalletChanged(poolId, index, previousWallet, newWallet, poolAccounting[poolId].creatorReceived);
    }

    /// @notice An administrator replaces or reaffirms all future Creator recipients atomically, including a CTO.
    /// @dev Repeated destinations consolidate existing slots without changing their immutable weights.
    ///      Creator self-rotations do not increment the administrative revision: the outgoing team has no veto.
    ///      Old credited fees and all platform/module-author entitlements remain untouched.
    ///      Reaffirming the current wallets also advances the revision, cancelling older pending admin decisions.
    function replaceCreatorWallets(
        bytes32 poolId,
        address[] calldata newWallets,
        uint256 expectedAdminRevision,
        uint256 deadline
    ) external nonReentrant {
        if (msg.sender != rewardAdmin && msg.sender != treasury) {
            revert UnauthorizedWalletRotation(msg.sender);
        }
        _requireRegistered(poolId);
        if (deadline == 0 || block.timestamp > deadline) revert CreatorAdminDeadlineExpired(deadline);
        uint256 currentRevision = creatorAdminRevision[poolId];
        if (expectedAdminRevision != currentRevision) {
            revert StaleCreatorAdminRevision(expectedAdminRevision, currentRevision);
        }
        uint256 count = _creatorWallets[poolId].length;
        if (newWallets.length != count) revert InvalidCreatorCount(newWallets.length);
        for (uint256 index; index < count; ++index) {
            _validateWallet(newWallets[index]);
        }
        creatorAdminRevision[poolId] = currentRevision + 1;
        uint256 earned = poolAccounting[poolId].creatorReceived;
        for (uint256 index; index < count; ++index) {
            address previous = _creatorWallets[poolId][index];
            if (newWallets[index] == previous) continue;
            _creatorWallets[poolId][index] = newWallets[index];
            emit CreatorWalletChanged(poolId, index, previous, newWallets[index], earned);
        }
        emit CreatorRecipientsReplaced(poolId, msg.sender, currentRevision + 1, newWallets, earned);
    }

    /// @notice Current dashboard state; configurationHash separately preserves the original launch allocation.
    function creatorRecipients(bytes32 poolId)
        external
        view
        returns (address[] memory wallets, uint16[] memory sharesBps, uint256 adminRevision)
    {
        _requireRegistered(poolId);
        return (_creatorWallets[poolId], _creatorSharesBps[poolId], creatorAdminRevision[poolId]);
    }

    function claim() external nonReentrant returns (uint256 amount) {
        return _claim(msg.sender, msg.sender);
    }

    /// @notice Anyone can pay an existing beneficiary, but cannot redirect that beneficiary's claim.
    function claim(address beneficiary) external nonReentrant returns (uint256 amount) {
        return _claim(beneficiary, beneficiary);
    }

    /// @notice Only the beneficiary itself can select a different destination for its own credited balance.
    function claimTo(address recipient) external nonReentrant returns (uint256 amount) {
        _validateWallet(recipient);
        return _claim(msg.sender, recipient);
    }

    function creatorCount(bytes32 poolId) external view returns (uint256) {
        return _creatorWallets[poolId].length;
    }

    function creatorWalletAt(bytes32 poolId, uint256 index) external view returns (address) {
        return _creatorWallets[poolId][index];
    }

    function creatorShareBpsAt(bytes32 poolId, uint256 index) external view returns (uint16) {
        return _creatorSharesBps[poolId][index];
    }

    function moduleCount(bytes32 poolId) external view returns (uint256) {
        return _moduleFamilies[poolId].length;
    }

    function moduleFamilyAt(bytes32 poolId, uint256 index) external view returns (bytes32) {
        return _moduleFamilies[poolId][index];
    }

    function poolTotals(bytes32 poolId) external view returns (uint256 received, uint256 allocated, uint256 reserved) {
        PoolAccounting storage accounting = poolAccounting[poolId];
        received = accounting.platformReceived + accounting.creatorReceived;
        allocated = accounting.treasuryCredited + accounting.authorsCredited + accounting.creatorsCredited;
        reserved = received - allocated;
    }

    /// @notice Fee units not yet assigned to any wallet. Donations do not increase this value or any entitlement.
    function dust() public view returns (uint256) {
        return totalFeesReceived - totalCredited;
    }

    function outstandingClaims() public view returns (uint256) {
        return totalCredited - totalClaimed;
    }

    /// @notice Native currency and redeemable native PoolManager claims; includes unallocated donations.
    function backing() public view returns (uint256) {
        return address(this).balance + poolManager.balanceOf(address(this), 0);
    }

    /// @dev An authenticated callback can only complete the precise redemption initiated by this ledger's claim.
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert UnauthorizedPoolManager(msg.sender);
        uint256 amount = abi.decode(data, (uint256));
        if (amount == 0 || amount != _pendingRedemption) revert UnexpectedUnlockCallback();
        _pendingRedemption = 0;
        NATIVE.settle(poolManager, address(this), amount, true);
        NATIVE.take(poolManager, address(this), amount, false);
        return "";
    }

    receive() external payable {
        if (msg.sender != address(poolManager)) revert UnauthorizedNativeSender(msg.sender);
    }

    function _allocatePlatform(bytes32 poolId, uint256 previousPlatform, PoolAccounting storage accounting) private {
        uint256 previousHalf = previousPlatform / 2;
        uint256 nextHalf = accounting.platformReceived / 2;
        uint256 treasuryDelta = nextHalf - previousHalf;
        accounting.treasuryCredited += treasuryDelta;
        _credit(poolId, treasury, treasuryDelta);

        uint256 count = _moduleFamilies[poolId].length;
        if (count == 0) {
            accounting.authorsCredited += treasuryDelta;
            _credit(poolId, noModuleRecipient, treasuryDelta);
            return;
        }
        uint256 familyDelta = nextHalf / count - previousHalf / count;
        if (familyDelta == 0) return;
        accounting.authorsCredited += familyDelta * count;
        for (uint256 index; index < count; index++) {
            address beneficiary = registry.authorWallet(_moduleFamilies[poolId][index]);
            _validateWallet(beneficiary);
            _credit(poolId, beneficiary, familyDelta);
        }
    }

    function _allocateCreators(bytes32 poolId, uint256 previousCreator, PoolAccounting storage accounting) private {
        uint256 count = _creatorWallets[poolId].length;
        for (uint256 index; index < count; index++) {
            uint256 share = _creatorSharesBps[poolId][index];
            uint256 delta = FullMath.mulDiv(accounting.creatorReceived, share, BASIS_POINTS)
                - FullMath.mulDiv(previousCreator, share, BASIS_POINTS);
            accounting.creatorsCredited += delta;
            _credit(poolId, _creatorWallets[poolId][index], delta);
        }
    }

    function _credit(bytes32 poolId, address beneficiary, uint256 amount) private {
        if (amount == 0) return;
        claimable[beneficiary] += amount;
        contributionByPool[poolId][beneficiary] += amount;
        totalCredited += amount;
        emit RewardCredited(poolId, beneficiary, amount);
    }

    function _claim(address beneficiary, address recipient) private returns (uint256 amount) {
        amount = claimable[beneficiary];
        if (amount == 0) revert NoFeesToClaim(beneficiary);
        _assertBacking();
        claimable[beneficiary] = 0;
        claimedBy[beneficiary] += amount;
        totalClaimed += amount;

        uint256 availableClaims = poolManager.balanceOf(address(this), 0);
        uint256 redeem = amount < availableClaims ? amount : availableClaims;
        if (redeem != 0) {
            _pendingRedemption = redeem;
            bytes memory result = poolManager.unlock(abi.encode(redeem));
            if (result.length != 0 || _pendingRedemption != 0) revert UnexpectedUnlockResult();
        }
        payable(recipient).sendValue(amount);
        _assertBacking();
        emit FeesClaimed(beneficiary, recipient, msg.sender, amount);
    }

    function _poolDust(PoolAccounting storage accounting) private view returns (uint256) {
        return accounting.platformReceived + accounting.creatorReceived - accounting.treasuryCredited
            - accounting.authorsCredited - accounting.creatorsCredited;
    }

    function _assertBacking() private view {
        uint256 available = backing();
        uint256 required = totalFeesReceived - totalClaimed;
        if (available < required) revert InsufficientBacking(available, required);
    }

    function _requireRegistered(bytes32 poolId) private view {
        if (!registered[poolId]) revert PoolNotRegistered(poolId);
    }

    function _validateWallet(address wallet) private pure {
        if (wallet == address(0)) revert InvalidWallet(wallet);
    }
}
