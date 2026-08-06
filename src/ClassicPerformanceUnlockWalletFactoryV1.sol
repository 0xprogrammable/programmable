// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { ClassicPerformanceUnlockWalletV1 } from "./ClassicPerformanceUnlockWalletV1.sol";
import { EthLadderFeeHookV1 } from "./EthLadderFeeHookV1.sol";

/// @title ClassicPerformanceUnlockWalletFactoryV1
/// @notice Deterministically deploys authenticated, non-transferable Ladder custody wallets.
/// @dev Mirrors `ClassicInitialBuyVestingWalletFactoryV1`'s shape: `deploy`, the front-running-resistant
///      `deployOrGet`, and the `predict`/`initCode`/`initCodeHash` triple every factory in this repository exposes.
///      Every one of Classic's four Initial Buy custody modes is deployed through a dedicated factory rather than
///      constructed directly; this gives Ladder's fifth mode the same primitive.
contract ClassicPerformanceUnlockWalletFactoryV1 {
    mapping(address wallet => bytes32 configurationHash) public configurationHashOf;

    error DeploymentAddressMismatch(address actual, address predicted);
    error UnrecognizedFactoryDeployment(address deployment);
    error WalletAlreadyDeployed(address wallet);

    event ClassicPerformanceUnlockWalletDeployed(
        address indexed wallet,
        address indexed token,
        address indexed beneficiary,
        bytes32 salt,
        bytes32 configurationHash
    );

    function deploy(
        bytes32 salt,
        IERC20 initialBuyToken,
        address beneficiary,
        EthLadderFeeHookV1 ladderHook,
        bytes32 poolId,
        uint64 launchTimestamp,
        uint16[] memory sharesBps,
        uint16 expiryDays
    ) external returns (ClassicPerformanceUnlockWalletV1 wallet) {
        bytes memory code = initCode(
            initialBuyToken, beneficiary, ladderHook, poolId, launchTimestamp, sharesBps, expiryDays
        );
        address predicted = Create2.computeAddress(salt, keccak256(code));
        if (predicted.code.length != 0) revert WalletAlreadyDeployed(predicted);

        address deployed = Create2.deploy(0, salt, code);
        if (deployed != predicted) revert DeploymentAddressMismatch(deployed, predicted);
        wallet = ClassicPerformanceUnlockWalletV1(payable(deployed));

        _recordAndEmit(salt, deployed, address(initialBuyToken), beneficiary);
    }

    /// @notice Deploys the configured custody or returns the same authenticated counterfactual wallet if it exists.
    /// @dev This makes a launch resistant to third parties predeploying its publicly predictable CREATE2 custody.
    function deployOrGet(
        bytes32 salt,
        IERC20 initialBuyToken,
        address beneficiary,
        EthLadderFeeHookV1 ladderHook,
        bytes32 poolId,
        uint64 launchTimestamp,
        uint16[] memory sharesBps,
        uint16 expiryDays
    ) external returns (ClassicPerformanceUnlockWalletV1 wallet) {
        address predicted = Create2.computeAddress(
            salt, initCodeHash(initialBuyToken, beneficiary, ladderHook, poolId, launchTimestamp, sharesBps, expiryDays)
        );
        if (predicted.code.length == 0) {
            bytes memory code =
                initCode(initialBuyToken, beneficiary, ladderHook, poolId, launchTimestamp, sharesBps, expiryDays);
            address deployed = Create2.deploy(0, salt, code);
            if (deployed != predicted) revert DeploymentAddressMismatch(deployed, predicted);
            _recordAndEmit(salt, deployed, address(initialBuyToken), beneficiary);
            return ClassicPerformanceUnlockWalletV1(payable(deployed));
        }

        if (configurationHashOf[predicted] == bytes32(0)) revert UnrecognizedFactoryDeployment(predicted);
        wallet = ClassicPerformanceUnlockWalletV1(payable(predicted));
    }

    /// @dev Split out of `deploy` and `deployOrGet` for the same reason as every other factory in this repository:
    ///      composing this inline, on top of seven constructor arguments including a dynamic array, exceeds the
    ///      EVM's stack depth under the non-IR pipeline.
    ///
    ///      Reads `configurationHash` back from the wallet itself rather than recomputing it, the same pattern
    ///      `FeeSplitVaultFactoryV1` uses. The wallet is the source of truth for what it committed to at
    ///      construction; an independent computation here could drift from that if the two were ever edited
    ///      separately.
    function _recordAndEmit(bytes32 salt, address deployed, address token, address beneficiary) private {
        bytes32 configurationHash = ClassicPerformanceUnlockWalletV1(payable(deployed)).configurationHash();
        configurationHashOf[deployed] = configurationHash;
        emit ClassicPerformanceUnlockWalletDeployed(deployed, token, beneficiary, salt, configurationHash);
    }

    function predict(
        bytes32 salt,
        IERC20 initialBuyToken,
        address beneficiary,
        EthLadderFeeHookV1 ladderHook,
        bytes32 poolId,
        uint64 launchTimestamp,
        uint16[] memory sharesBps,
        uint16 expiryDays
    ) external view returns (address) {
        return Create2.computeAddress(
            salt, initCodeHash(initialBuyToken, beneficiary, ladderHook, poolId, launchTimestamp, sharesBps, expiryDays)
        );
    }

    function initCode(
        IERC20 initialBuyToken,
        address beneficiary,
        EthLadderFeeHookV1 ladderHook,
        bytes32 poolId,
        uint64 launchTimestamp,
        uint16[] memory sharesBps,
        uint16 expiryDays
    ) public pure returns (bytes memory) {
        // slither-disable-next-line too-many-digits
        return abi.encodePacked(
            type(ClassicPerformanceUnlockWalletV1).creationCode,
            abi.encode(initialBuyToken, beneficiary, ladderHook, poolId, launchTimestamp, sharesBps, expiryDays)
        );
    }

    function initCodeHash(
        IERC20 initialBuyToken,
        address beneficiary,
        EthLadderFeeHookV1 ladderHook,
        bytes32 poolId,
        uint64 launchTimestamp,
        uint16[] memory sharesBps,
        uint16 expiryDays
    ) public pure returns (bytes32) {
        return keccak256(
            initCode(initialBuyToken, beneficiary, ladderHook, poolId, launchTimestamp, sharesBps, expiryDays)
        );
    }
}
