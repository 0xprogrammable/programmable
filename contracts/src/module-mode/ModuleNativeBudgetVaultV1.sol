// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/// @notice Prefunded native budgets and backed pull claims, isolated from LP, Creator and author fee accounting.
/// @dev Funding is an irrevocable contribution to the named program. Forced transfers grant nobody spending rights.
contract ModuleNativeBudgetVaultV1 is ReentrancyGuardTransient {
    using Address for address payable;

    address public immutable runtime;
    mapping(bytes32 instanceId => bool) public registered;
    mapping(bytes32 instanceId => uint256) public available;
    mapping(bytes32 instanceId => mapping(address beneficiary => uint256)) public claimable;
    mapping(bytes32 instanceId => mapping(address beneficiary => uint256)) public claimed;
    uint256 public totalFunded;
    uint256 public totalAvailable;
    uint256 public totalOutstandingClaims;
    uint256 public totalClaimed;

    error OnlyRuntime();
    error InvalidInstance();
    error InvalidAmount();
    error InvalidBeneficiary();
    error InsufficientBudget(uint256 availableAmount, uint256 requested);

    event Funded(bytes32 indexed instanceId, address indexed funder, uint256 amount);
    event Credited(bytes32 indexed instanceId, address indexed beneficiary, uint256 amount);
    event Claimed(bytes32 indexed instanceId, address indexed beneficiary, address indexed recipient, uint256 amount);

    constructor() {
        runtime = msg.sender;
    }

    modifier onlyRuntime() {
        if (msg.sender != runtime) revert OnlyRuntime();
        _;
    }

    function register(bytes32 instanceId) external onlyRuntime {
        if (instanceId == bytes32(0) || registered[instanceId]) revert InvalidInstance();
        registered[instanceId] = true;
    }

    function fund(bytes32 instanceId) external payable nonReentrant {
        if (!registered[instanceId]) revert InvalidInstance();
        if (msg.value == 0) revert InvalidAmount();
        available[instanceId] += msg.value;
        totalFunded += msg.value;
        totalAvailable += msg.value;
        emit Funded(instanceId, msg.sender, msg.value);
    }

    /// @dev No recipient call occurs during a trade or action. This moves backing, rather than creating a promise.
    function credit(bytes32 instanceId, address beneficiary, uint256 amount) external onlyRuntime nonReentrant {
        if (!registered[instanceId]) revert InvalidInstance();
        if (beneficiary == address(0) || beneficiary == address(this)) revert InvalidBeneficiary();
        if (amount == 0) revert InvalidAmount();
        uint256 balance = available[instanceId];
        if (amount > balance) revert InsufficientBudget(balance, amount);
        available[instanceId] = balance - amount;
        totalAvailable -= amount;
        claimable[instanceId][beneficiary] += amount;
        totalOutstandingClaims += amount;
        emit Credited(instanceId, beneficiary, amount);
    }

    /// @notice Anyone can pay the existing beneficiary; the caller cannot substitute a recipient.
    function claim(bytes32 instanceId, address beneficiary) external nonReentrant returns (uint256) {
        return _claim(instanceId, beneficiary, beneficiary);
    }

    /// @notice Only the credited beneficiary can redirect its own claim.
    function claimTo(bytes32 instanceId, address recipient) external nonReentrant returns (uint256) {
        return _claim(instanceId, msg.sender, recipient);
    }

    function _claim(bytes32 instanceId, address beneficiary, address recipient) private returns (uint256 amount) {
        if (recipient == address(0) || recipient == address(this)) revert InvalidBeneficiary();
        amount = claimable[instanceId][beneficiary];
        if (amount == 0) revert InvalidAmount();
        claimable[instanceId][beneficiary] = 0;
        claimed[instanceId][beneficiary] += amount;
        totalOutstandingClaims -= amount;
        totalClaimed += amount;
        payable(recipient).sendValue(amount);
        emit Claimed(instanceId, beneficiary, recipient, amount);
    }
}
