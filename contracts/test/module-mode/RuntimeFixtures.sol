// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ModuleRuntimeTypesV1 as T } from "../../src/module-mode/ModuleRuntimeTypesV1.sol";
import { ModuleNativeRuntimeV1 } from "../../src/module-mode/ModuleNativeRuntimeV1.sol";
import { ModuleNativeBudgetVaultV1 } from "../../src/module-mode/ModuleNativeBudgetVaultV1.sol";
import { ModuleProgramBaseV1 } from "../../src/module-mode/ModuleProgramBaseV1.sol";
import { IModuleProgramV1, IModuleNativeBudgetRuntimeV1 } from "../../src/module-mode/IModuleProgramV1.sol";

/// @dev Unit-test engine only: no swap, token settlement, fee, launch-provenance or V4 routing proof.
contract RuntimeEngineHarness {
    ModuleNativeRuntimeV1 public runtime;
    address private _testOwner;
    uint256 public appliedCalls;

    constructor() {
        _testOwner = msg.sender;
    }

    function bind(ModuleNativeRuntimeV1 runtime_) external {
        require(msg.sender == _testOwner && address(runtime) == address(0));
        runtime = runtime_;
    }

    function register(T.LaunchBinding calldata binding, T.Selection[] calldata selected) external returns (bytes32) {
        require(msg.sender == _testOwner);
        return runtime.registerLaunch(binding, selected);
    }

    /// @dev Deliberately explicit trusted-engine-input tests. The owner is the test contract, not a real trader.
    function applyTrade(bytes32 key, T.Trade calldata trade) external returns (bytes32) {
        require(msg.sender == _testOwner);
        ++appliedCalls;
        return runtime.executeTrade(key, trade);
    }

    /// @dev An ordinary caller cannot supply a different actor. Gross amounts here still are test inputs, not fills.
    function callerTrade(bytes32 key, uint256 grossNative) external returns (bytes32) {
        T.Trade memory trade = T.Trade(
            runtime.lastTradeSequence(key) + 1,
            msg.sender,
            msg.sender,
            msg.sender,
            grossNative,
            1 ether,
            true,
            true,
            false
        );
        ++appliedCalls;
        return runtime.executeTrade(key, trade);
    }
}

contract RuntimeIdentityFixture { }

/// @dev Modes are adversarial test behaviors only; the protected runtime contains no corresponding discriminator.
contract RuntimeProbeProgram is ModuleProgramBaseV1 {
    uint8 public mode;
    bytes32 public attackLaunchKey;
    uint256 public calls;
    bool public forbiddenCallRejected;
    address public lastActionActor;

    constructor(T.InstanceBinding memory binding, bytes memory config) ModuleProgramBaseV1(binding) {
        mode = abi.decode(config, (uint8));
        if (config.length == 64) (, attackLaunchKey) = abi.decode(config, (uint8, bytes32));
    }

    function onTrade(T.TradeContext calldata context) external returns (bytes4) {
        _authenticate(context.launchKey, context.instanceId);
        ++calls;
        ModuleNativeRuntimeV1 host = ModuleNativeRuntimeV1(_runtime());
        if (mode == 1) host.credit(context.trade.actor, 1);
        if (mode == 2) {
            (bool ok,) = address(host)
                .call(
                    abi.encodeCall(
                        host.executeAction,
                        (
                            context.launchKey,
                            0,
                            bytes32("credit"),
                            abi.encode(uint256(1)),
                            uint64(0),
                            block.timestamp + 1
                        )
                    )
                );
            forbiddenCallRejected = !ok;
            require(!ok);
            host.credit(context.trade.actor, 1);
        }
        if (mode == 3) {
            (bool ok,) = address(host.vault())
                .call(abi.encodeCall(host.vault().credit, (context.instanceId, context.trade.actor, 1)));
            forbiddenCallRejected = !ok;
            require(!ok);
            host.credit(context.trade.actor, 1);
        }
        if (mode == 4) {
            assembly ("memory-safe") { return(0, 4096) }
        }
        if (mode == 5) {
            while (true) { }
        }
        if (mode == 6) host.credit(context.trade.actor, host.available(context.instanceId) + 1);
        if (mode == 7) {
            for (uint256 i; i < 9; ++i) {
                host.credit(context.trade.actor, 1);
            }
        }
        if (mode == 8) return bytes4(0);
        if (mode == 9) RuntimeEngineHarness(host.engine()).callerTrade(context.launchKey, 1);
        if (mode == 10) RuntimeEngineHarness(host.engine()).callerTrade(attackLaunchKey, 1);
        return IModuleProgramV1.onTrade.selector;
    }

    function onAction(T.ActionContext calldata context, bytes calldata inputs) external returns (bytes4) {
        _authenticate(context.launchKey, context.instanceId);
        require(context.actionId == bytes32("credit") && inputs.length == 32);
        lastActionActor = context.actor;
        IModuleNativeBudgetRuntimeV1(_runtime()).credit(context.actor, abi.decode(inputs, (uint256)));
        return IModuleProgramV1.onAction.selector;
    }
}

contract RuntimeProbeFactory {
    function create(T.InstanceBinding calldata binding, bytes calldata config) external returns (address) {
        require(msg.sender == binding.runtime);
        return address(new RuntimeProbeProgram(binding, config));
    }

    function moduleCodeHash() external pure returns (bytes32) {
        return keccak256(type(RuntimeProbeProgram).runtimeCode);
    }
}

contract WrongBindingFactory {
    function create(T.InstanceBinding memory binding, bytes calldata config) external returns (address) {
        binding.configHash = bytes32(uint256(123));
        return address(new RuntimeProbeProgram(binding, config));
    }
}

contract RevertingBudgetRecipient {
    function claimTo(ModuleNativeBudgetVaultV1 vault, bytes32 instanceId, address recipient) external {
        vault.claimTo(instanceId, recipient);
    }

    receive() external payable {
        revert("receiver rejects payment");
    }
}

contract ReentrantBudgetRecipient {
    ModuleNativeBudgetVaultV1 private _vault;
    bytes32 private _instanceId;
    bool public blocked;

    function setup(ModuleNativeBudgetVaultV1 vault, bytes32 instanceId) external {
        _vault = vault;
        _instanceId = instanceId;
    }

    receive() external payable {
        (bool ok,) = address(_vault).call(abi.encodeCall(_vault.claim, (_instanceId, address(this))));
        blocked = !ok;
    }
}

contract ForcedRuntimeDonation {
    constructor(address payable target) payable {
        selfdestruct(target);
    }
}
