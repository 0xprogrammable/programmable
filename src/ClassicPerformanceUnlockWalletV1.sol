// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { EthLadderFeeHookV1 } from "./EthLadderFeeHookV1.sol";
import { LadderScheduleV1 } from "./libraries/LadderScheduleV1.sol";

/// @title ClassicPerformanceUnlockWalletV1
/// @notice Holds one launch's Initial Buy tokens and releases them in tranches as the pool proves price levels.
/// @dev A performance counterpart to `ClassicInitialBuyVestingWalletV1`. That wallet releases against a clock; this
///      one releases against the pool's own recorded price history. It is the custody half of the Ladder model; the
///      observation half lives in `EthLadderFeeHookV1`.
///
///      The wallet holds no authority over the ladder. It reads `isTrancheUnlocked` from the hook, which reports a
///      fact about tick history and cannot be influenced by the beneficiary, the wallet or this contract. Shares are
///      recorded here and ticks are recorded in the hook, so neither contract can unilaterally change the terms.
///
///      Every tranche's share is measured against the balance custodied at first release, so a token sent to this
///      wallet after releases have begun cannot retroactively enlarge an earlier tranche.
contract ClassicPerformanceUnlockWalletV1 is Ownable, ReentrancyGuardTransient {
    using SafeCast for uint256;
    using SafeERC20 for IERC20;

    /// @notice The token held in custody.
    IERC20 public immutable initialBuyToken;

    /// @notice The hook that observes the pool this ladder is measured against.
    EthLadderFeeHookV1 public immutable ladderHook;

    /// @notice The pool whose price history governs this ladder.
    bytes32 public immutable poolId;

    /// @notice The launch timestamp, used only to compute forfeiture.
    uint64 public immutable launchTimestamp;

    /// @notice The timestamp after which unreleased tranches are permanently forfeited. Zero disables forfeiture.
    uint64 public immutable forfeitTimestamp;

    /// @notice The address unreleased tokens are burned to when a ladder expires.
    address public constant FORFEIT_RECIPIENT = 0x000000000000000000000000000000000000dEaD;

    /// @notice Commitment to every term of this ladder, including the chain and this wallet's own address.
    bytes32 public immutable configurationHash;

    uint8 public immutable trancheCount;

    uint16 private immutable _shares0;
    uint16 private immutable _shares1;
    uint16 private immutable _shares2;
    uint16 private immutable _shares3;
    uint16 private immutable _shares4;

    /// @notice The balance custodied at the time of the first release, fixing the base for every share calculation.
    uint256 public custodiedAmount;

    /// @notice Total basis points released so far.
    uint16 public releasedSharesBps;

    /// @notice Whether tranche `index` has been released.
    mapping(uint8 index => bool released) public trancheReleased;

    /// @notice Whether the remaining tranches have been forfeited.
    bool public forfeited;

    error AlreadyForfeited();
    error ExpiryDaysOutOfRange(uint16 expiryDays);
    error ForfeitureDisabled();
    error ForfeitureNotReached(uint64 forfeitTimestamp, uint256 timestamp);
    error ImmutableBeneficiary();
    error InvalidInitialBuyToken(address token);
    error InvalidLadderHook(address hook);
    error LadderExpired(uint64 forfeitTimestamp, uint256 timestamp);
    error NothingToRelease();
    error PoolMismatch(bytes32 expected, bytes32 actual);
    error ShareCountMismatch(uint256 shareCount, uint8 trancheCount);
    error TrancheShareBelowMinimum(uint8 index, uint16 sharesBps);
    error SharesMustTotalOneHundredPercent(uint16 totalSharesBps);
    error TrancheAlreadyReleased(uint8 index);
    error TrancheIndexOutOfRange(uint8 index, uint8 trancheCount);
    error TrancheNotUnlocked(uint8 index);
    error ZeroAddress();

    event TrancheReleased(uint8 indexed index, address indexed beneficiary, uint16 sharesBps, uint256 amount);
    event LadderForfeited(address indexed caller, uint16 unreleasedSharesBps, uint256 amount);

    /// @param initialBuyToken_ The launch token held in custody.
    /// @param beneficiary_ The immutable owner entitled to released tranches.
    /// @param ladderHook_ The hook observing the pool.
    /// @param poolId_ The pool whose history governs releases.
    /// @param launchTimestamp_ The launch timestamp.
    /// @param sharesBps_ Per-tranche shares in basis points, in the hook's tranche order, totalling 10,000.
    /// @param expiryDays_ Days after launch at which unreleased tranches may be forfeited. Zero disables it.
    constructor(
        IERC20 initialBuyToken_,
        address beneficiary_,
        EthLadderFeeHookV1 ladderHook_,
        bytes32 poolId_,
        uint64 launchTimestamp_,
        uint16[] memory sharesBps_,
        uint16 expiryDays_
    ) Ownable(beneficiary_) {
        address tokenAddress = address(initialBuyToken_);
        if (tokenAddress == address(0) || tokenAddress.code.length == 0) {
            revert InvalidInitialBuyToken(tokenAddress);
        }
        if (address(ladderHook_) == address(0) || address(ladderHook_).code.length == 0) {
            revert InvalidLadderHook(address(ladderHook_));
        }

        // The hook is the source of truth for how many tranches this ladder has. Reading it here means the wallet
        // cannot be constructed with a share list that does not match the ticks the pool is actually measured against.
        (int24[] memory unlockTicks,,) = ladderHook_.ladderDisclosure(poolId_);
        uint8 count = uint8(unlockTicks.length);
        if (sharesBps_.length != count) revert ShareCountMismatch(sharesBps_.length, count);

        // Each tranche must clear the same per-tranche floor the hook enforces at registration. The wallet is a
        // separate deployment from the hook and receives its own share list as constructor arguments, so this check
        // cannot be inherited — it has to be repeated here or a wallet could be constructed with a dust tranche the
        // model's documentation says is impossible.
        uint256 totalSharesBps;
        for (uint8 i = 0; i < count; ++i) {
            uint16 shareBps = sharesBps_[i];
            if (shareBps < LadderScheduleV1.MIN_TRANCHE_SHARES_BPS) {
                revert TrancheShareBelowMinimum(i, shareBps);
            }
            totalSharesBps += shareBps;
        }
        if (totalSharesBps != LadderScheduleV1.TOTAL_SHARES_BPS) {
            revert SharesMustTotalOneHundredPercent(totalSharesBps.toUint16());
        }
        // Same reasoning for expiry: 0 disables forfeiture entirely, and any other value must fall inside the
        // documented range. The hook has no expiry concept to inherit this from — expiry is wallet-only.
        if (
            expiryDays_ != 0
                && (expiryDays_ < LadderScheduleV1.MIN_EXPIRY_DAYS || expiryDays_ > LadderScheduleV1.MAX_EXPIRY_DAYS)
        ) {
            revert ExpiryDaysOutOfRange(expiryDays_);
        }

        initialBuyToken = initialBuyToken_;
        ladderHook = ladderHook_;
        poolId = poolId_;
        launchTimestamp = launchTimestamp_;
        trancheCount = count;

        _shares0 = count > 0 ? sharesBps_[0] : 0;
        _shares1 = count > 1 ? sharesBps_[1] : 0;
        _shares2 = count > 2 ? sharesBps_[2] : 0;
        _shares3 = count > 3 ? sharesBps_[3] : 0;
        _shares4 = count > 4 ? sharesBps_[4] : 0;

        forfeitTimestamp = expiryDays_ == 0
            ? 0
            : (uint256(launchTimestamp_) + uint256(expiryDays_) * 1 days).toUint64();

        configurationHash = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                tokenAddress,
                beneficiary_,
                address(ladderHook_),
                poolId_,
                launchTimestamp_,
                unlockTicks,
                sharesBps_,
                expiryDays_
            )
        );
    }

    /// @notice Returns the basis-point share of tranche `index`.
    function sharesBpsOf(uint8 index) public view returns (uint16) {
        if (index >= trancheCount) revert TrancheIndexOutOfRange(index, trancheCount);
        if (index == 0) return _shares0;
        if (index == 1) return _shares1;
        if (index == 2) return _shares2;
        if (index == 3) return _shares3;
        return _shares4;
    }

    /// @notice Returns whether tranche `index` can be released right now.
    function releasable(uint8 index) external view returns (bool) {
        if (index >= trancheCount) revert TrancheIndexOutOfRange(index, trancheCount);
        if (forfeited || trancheReleased[index]) return false;
        if (forfeitTimestamp != 0 && block.timestamp >= forfeitTimestamp) return false;
        return ladderHook.isTrancheUnlocked(poolId, index);
    }

    /// @notice Releases tranche `index` to the beneficiary if the pool has satisfied its dwell requirement.
    /// @dev Permissionless by design. Anyone may trigger a release, but the tokens can only ever go to the immutable
    ///      beneficiary, so a third party can pay the gas without gaining anything.
    function release(uint8 index) external nonReentrant returns (uint256 amount) {
        if (index >= trancheCount) revert TrancheIndexOutOfRange(index, trancheCount);
        if (forfeited) revert AlreadyForfeited();
        if (trancheReleased[index]) revert TrancheAlreadyReleased(index);
        if (forfeitTimestamp != 0 && block.timestamp >= forfeitTimestamp) {
            revert LadderExpired(forfeitTimestamp, block.timestamp);
        }
        if (!ladderHook.isTrancheUnlocked(poolId, index)) revert TrancheNotUnlocked(index);

        uint256 base = _fixCustodiedAmount();
        uint16 sharesBps = sharesBpsOf(index);

        trancheReleased[index] = true;
        releasedSharesBps += sharesBps;

        amount = releasedSharesBps == LadderScheduleV1.TOTAL_SHARES_BPS
            ? initialBuyToken.balanceOf(address(this))
            : LadderScheduleV1.releasableAmount(base, sharesBps);
        if (amount == 0) revert NothingToRelease();

        address beneficiary = owner();
        initialBuyToken.safeTransfer(beneficiary, amount);

        emit TrancheReleased(index, beneficiary, sharesBps, amount);
    }

    /// @notice Permanently burns every unreleased tranche once the ladder has expired.
    /// @dev Permissionless. A creator whose token never reached its levels cannot quietly hold the allocation
    ///      forever; anyone can retire it, and it can only go to the burn address.
    function forfeit() external nonReentrant returns (uint256 amount) {
        if (forfeitTimestamp == 0) revert ForfeitureDisabled();
        if (forfeited) revert AlreadyForfeited();
        if (block.timestamp < forfeitTimestamp) revert ForfeitureNotReached(forfeitTimestamp, block.timestamp);

        forfeited = true;
        amount = initialBuyToken.balanceOf(address(this));
        if (amount == 0) revert NothingToRelease();

        uint16 unreleasedSharesBps = LadderScheduleV1.TOTAL_SHARES_BPS - releasedSharesBps;
        initialBuyToken.safeTransfer(FORFEIT_RECIPIENT, amount);

        emit LadderForfeited(msg.sender, unreleasedSharesBps, amount);
    }

    /// @dev Fixes the share base at the first release so later transfers into this wallet cannot enlarge a tranche
    ///      that was sized against a smaller balance.
    function _fixCustodiedAmount() private returns (uint256 base) {
        base = custodiedAmount;
        if (base == 0) {
            base = initialBuyToken.balanceOf(address(this));
            custodiedAmount = base;
        }
    }

    function transferOwnership(address) public pure override {
        revert ImmutableBeneficiary();
    }

    function renounceOwnership() public pure override {
        revert ImmutableBeneficiary();
    }
}
