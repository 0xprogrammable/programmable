// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";

import { EthLadderFeeHookV1 } from "./EthLadderFeeHookV1.sol";
import { FeeSplitVaultFactoryV1 } from "./FeeSplitVaultFactoryV1.sol";

/// @title EthLadderFeeHookFactoryV1
/// @notice Deterministically deploys the Ladder fee hook at a valid v4 hook address.
/// @dev Mirrors `EthCreatorFeeHookFactoryV3` exactly, with Ladder's four constructor arguments in place of Classic's
///      three. The required flags differ from Classic only in that Ladder needs no additional permission beyond the
///      same five bits — the ladder itself is observation inside the existing `afterSwap` callback, not a new hook
///      point — so `REQUIRED_HOOK_FLAGS` is identical between the two factories by design, not by coincidence.
contract EthLadderFeeHookFactoryV1 {
    uint160 public constant ALL_HOOK_MASK = uint160((1 << 14) - 1);
    uint160 public constant REQUIRED_HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    mapping(address hook => bytes32 configurationHash) public configurationHashOf;

    error DeploymentAddressMismatch(address actual, address predicted);
    error HookAlreadyDeployed(address hook);
    error InvalidHookAddress(address hook, uint160 actualFlags, uint160 requiredFlags);

    event EthLadderFeeHookDeployed(
        address indexed hook,
        address indexed poolManager,
        address indexed launcherFeeRecipient,
        address builderFeeRecipient,
        address feeSplitVaultFactory,
        bytes32 salt,
        bytes32 configurationHash
    );

    function deploy(
        bytes32 salt,
        IPoolManager poolManager,
        address launcherFeeRecipient,
        address builderFeeRecipient,
        FeeSplitVaultFactoryV1 feeSplitVaultFactory
    ) external returns (EthLadderFeeHookV1 hook) {
        bytes memory code =
            initCode(poolManager, launcherFeeRecipient, builderFeeRecipient, feeSplitVaultFactory);
        address predicted = Create2.computeAddress(salt, keccak256(code));
        if ((uint160(predicted) & ALL_HOOK_MASK) != REQUIRED_HOOK_FLAGS) {
            revert InvalidHookAddress(predicted, uint160(predicted) & ALL_HOOK_MASK, REQUIRED_HOOK_FLAGS);
        }
        if (predicted.code.length != 0) revert HookAlreadyDeployed(predicted);

        address deployed = Create2.deploy(0, salt, code);
        if (deployed != predicted) revert DeploymentAddressMismatch(deployed, predicted);
        hook = EthLadderFeeHookV1(deployed);

        _recordAndEmit(salt, deployed, poolManager, launcherFeeRecipient, builderFeeRecipient, feeSplitVaultFactory);
    }

    /// @dev Split out of `deploy` because computing the configuration hash and emitting the full event inline, on
    ///      top of the deployment locals already live in that function, exceeded the EVM's stack depth under the
    ///      non-IR pipeline this repository builds with. Ladder carries one more constructor argument than Classic's
    ///      factory (the builder fee recipient), which was enough to tip an already-tight function over the limit.
    function _recordAndEmit(
        bytes32 salt,
        address deployed,
        IPoolManager poolManager,
        address launcherFeeRecipient,
        address builderFeeRecipient,
        FeeSplitVaultFactoryV1 feeSplitVaultFactory
    ) private {
        bytes32 configurationHash = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                deployed,
                address(poolManager),
                launcherFeeRecipient,
                builderFeeRecipient,
                address(feeSplitVaultFactory)
            )
        );
        configurationHashOf[deployed] = configurationHash;
        emit EthLadderFeeHookDeployed(
            deployed,
            address(poolManager),
            launcherFeeRecipient,
            builderFeeRecipient,
            address(feeSplitVaultFactory),
            salt,
            configurationHash
        );
    }

    function predict(
        bytes32 salt,
        IPoolManager poolManager,
        address launcherFeeRecipient,
        address builderFeeRecipient,
        FeeSplitVaultFactoryV1 feeSplitVaultFactory
    ) external view returns (address) {
        return Create2.computeAddress(
            salt, initCodeHash(poolManager, launcherFeeRecipient, builderFeeRecipient, feeSplitVaultFactory)
        );
    }

    function initCode(
        IPoolManager poolManager,
        address launcherFeeRecipient,
        address builderFeeRecipient,
        FeeSplitVaultFactoryV1 feeSplitVaultFactory
    ) public pure returns (bytes memory) {
        // slither-disable-next-line too-many-digits
        return abi.encodePacked(
            type(EthLadderFeeHookV1).creationCode,
            abi.encode(poolManager, launcherFeeRecipient, builderFeeRecipient, feeSplitVaultFactory)
        );
    }

    function initCodeHash(
        IPoolManager poolManager,
        address launcherFeeRecipient,
        address builderFeeRecipient,
        FeeSplitVaultFactoryV1 feeSplitVaultFactory
    ) public pure returns (bytes32) {
        return keccak256(initCode(poolManager, launcherFeeRecipient, builderFeeRecipient, feeSplitVaultFactory));
    }

    function isFactoryHook(address hook) external view returns (bool) {
        return configurationHashOf[hook] != bytes32(0);
    }
}
