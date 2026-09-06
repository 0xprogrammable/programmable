// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { ModuleRuntimeTypesV1 as T } from "./ModuleRuntimeTypesV1.sol";
import { IModuleProgramV1, IModuleProgramFactoryV1 } from "./IModuleProgramV1.sol";
import { ModuleNativeBudgetVaultV1 } from "./ModuleNativeBudgetVaultV1.sol";

/// @notice Candidate stateful, prefunded native runtime. The pinned engine is the trade-authentication authority.
/// @dev This is not a V4 hook/router, admission registry or launch source. The engine must call executeTrade inside
///      its actual atomic settlement. It must authenticate actor/payer/recipient and enforce all launch/fee rules.
contract ModuleNativeRuntimeV1 is ReentrancyGuardTransient {
    uint256 public constant MAX_INSTANCES = 16;
    uint256 public constant MAX_CONFIG_BYTES = 16_384;
    uint256 public constant MAX_TOTAL_CONFIG_BYTES = 32_768;
    uint256 public constant MAX_ACTION_BYTES = 16_384;
    uint32 public constant MIN_CALLBACK_GAS = 25_000;
    uint32 public constant MAX_CALLBACK_GAS = 500_000;
    uint256 public constant MAX_TOTAL_CALLBACK_GAS = 2_000_000;
    uint256 public constant FACTORY_GAS = 2_000_000;
    uint256 public constant MAX_CREDITS_PER_CALLBACK = 8;
    bytes32 public constant PROGRAM_DOMAIN = keccak256("programmable.module-mode.native-program.v1");
    bytes32 public constant LAUNCH_DOMAIN = keccak256("programmable.module-mode.native-binding.v1");

    struct Instance {
        bytes32 instanceId;
        bytes32 packageId;
        bytes32 configHash;
        address factory;
        bytes32 factoryCodeHash;
        address module;
        bytes32 moduleCodeHash;
        uint32 callbackGas;
    }

    address public immutable engine;
    bytes32 public immutable engineCodeHash;
    ModuleNativeBudgetVaultV1 public immutable vault;
    mapping(bytes32 launchKey => bool) public registered;
    mapping(bytes32 launchKey => T.LaunchBinding) private _launches;
    mapping(bytes32 launchKey => Instance[]) private _instances;
    mapping(address source => mapping(address token => bytes32 launchKey)) public launchForToken;
    mapping(address poolManager => mapping(bytes32 poolId => bytes32 launchKey)) public launchForPool;
    mapping(address module => bytes32 instanceId) public instanceOf;
    mapping(bytes32 launchKey => uint64) public lastTradeSequence;
    mapping(bytes32 launchKey => mapping(address actor => uint64)) public actionNonce;

    // Deliberately scoped callback re-entry: only the current module may credit its own bucket. All lifecycle
    // entrypoints remain nonReentrant throughout every external callback, including callbacks across launches.
    address private _activeModule;
    bytes32 private _activeInstance;
    bytes32 private _activeExecution;
    uint256 private _creditCount;

    error OnlyEngine();
    error EngineCodeChanged();
    error InvalidEngine();
    error InvalidLaunch();
    error InvalidProgram();
    error ResourceLimit();
    error CodeHashMismatch(address target);
    error ModuleCallFailed(address target);
    error InstanceAlreadyBound(address module);
    error InvalidInstanceBinding(address module);
    error InvalidTrade();
    error InvalidSequence(uint64 expected, uint64 supplied);
    error InvalidAction();
    error OnlyActiveModule();

    event LaunchBound(
        bytes32 indexed launchKey, bytes32 indexed recipeHash, bytes32 indexed programHash, T.LaunchBinding binding
    );
    event InstanceBound(
        bytes32 indexed launchKey, bytes32 indexed instanceId, address indexed module, Instance instance, bytes config
    );
    event TradeApplied(bytes32 indexed launchKey, bytes32 indexed executionId, address indexed actor, T.Trade trade);
    event ActionApplied(
        bytes32 indexed launchKey,
        bytes32 indexed instanceId,
        address indexed actor,
        bytes32 executionId,
        uint64 nonce,
        bytes32 actionId,
        bytes32 inputsHash
    );
    event BudgetCreditRequested(
        bytes32 indexed executionId, bytes32 indexed instanceId, address indexed beneficiary, uint256 amount
    );

    constructor(address engine_) {
        if (engine_.code.length == 0) revert InvalidEngine();
        engine = engine_;
        engineCodeHash = engine_.codehash;
        vault = new ModuleNativeBudgetVaultV1();
    }

    modifier onlyEngine() {
        if (msg.sender != engine) revert OnlyEngine();
        if (engine.codehash != engineCodeHash) revert EngineCodeChanged();
        _;
    }

    function programHash(T.Selection[] calldata selections) public pure returns (bytes32) {
        return keccak256(abi.encode(PROGRAM_DOMAIN, selections));
    }

    /// @notice This program binding key is distinct from the canonical launch ID recorded after initial settlement.
    function launchKeyFor(T.LaunchBinding calldata binding) public view returns (bytes32) {
        return keccak256(abi.encode(LAUNCH_DOMAIN, block.chainid, address(this), engine, binding));
    }

    /// @dev Only the admitted engine may bind factories and code. Matching hashes are integrity, not a safety review.
    function registerLaunch(T.LaunchBinding calldata binding, T.Selection[] calldata selections)
        external
        onlyEngine
        nonReentrant
        returns (bytes32 launchKey)
    {
        if (
            binding.source.code.length == 0 || binding.token.code.length == 0 || binding.poolManager.code.length == 0
                || binding.launchWallet == address(0) || binding.poolId == bytes32(0)
                || binding.recipeHash == bytes32(0)
        ) revert InvalidLaunch();
        if (binding.programHash != programHash(selections)) revert InvalidProgram();
        _validateSelections(selections);
        launchKey = launchKeyFor(binding);
        if (
            registered[launchKey] || launchForToken[binding.source][binding.token] != bytes32(0)
                || launchForPool[binding.poolManager][binding.poolId] != bytes32(0)
        ) revert InvalidLaunch();
        registered[launchKey] = true;
        launchForToken[binding.source][binding.token] = launchKey;
        launchForPool[binding.poolManager][binding.poolId] = launchKey;
        _launches[launchKey] = binding;
        for (uint256 i; i < selections.length; ++i) {
            _createInstance(launchKey, i, selections[i]);
        }
        emit LaunchBound(launchKey, binding.recipeHash, binding.programHash, binding);
    }

    function launchBinding(bytes32 launchKey) external view returns (T.LaunchBinding memory) {
        _requireLaunch(launchKey);
        return _launches[launchKey];
    }

    function instances(bytes32 launchKey) external view returns (Instance[] memory) {
        _requireLaunch(launchKey);
        return _instances[launchKey];
    }

    /// @notice Applies actual completed-trade context once, in immutable instance order, or reverts the entire call.
    /// @dev The runtime does not infer a trader from PoolManager.sender, tx.origin or unverified hookData.
    function executeTrade(bytes32 launchKey, T.Trade calldata trade)
        external
        onlyEngine
        nonReentrant
        returns (bytes32 executionId)
    {
        _requireLaunch(launchKey);
        uint64 expected = lastTradeSequence[launchKey] + 1;
        if (trade.sequence != expected) revert InvalidSequence(expected, trade.sequence);
        if (
            trade.actor == address(0) || trade.payer == address(0) || trade.recipient == address(0)
                || trade.grossNative == 0 || trade.tokenAmount == 0
                || (trade.initialBuy && (!trade.isBuy || expected != 1))
        ) revert InvalidTrade();
        lastTradeSequence[launchKey] = expected;
        executionId = keccak256(abi.encode("module-mode.trade.v1", block.chainid, address(this), launchKey, trade));
        Instance[] storage selected = _instances[launchKey];
        for (uint256 i; i < selected.length; ++i) {
            T.TradeContext memory context = T.TradeContext(launchKey, selected[i].instanceId, executionId, trade);
            _invoke(
                selected[i],
                executionId,
                abi.encodeCall(IModuleProgramV1.onTrade, (context)),
                IModuleProgramV1.onTrade.selector
            );
        }
        emit TradeApplied(launchKey, executionId, trade.actor, trade);
    }

    /// @notice A direct caller acts only as itself. The program enforces its own declared, launch-bound role policy.
    /// @dev Arbitrary input bytes confer no core authority. No wallet provider, allowance or arbitrary core call
    /// exists.
    function executeAction(
        bytes32 launchKey,
        uint256 index,
        bytes32 actionId,
        bytes calldata inputs,
        uint64 expectedNonce,
        uint256 deadline
    ) external nonReentrant returns (bytes32 executionId) {
        _requireLaunch(launchKey);
        if (
            index >= _instances[launchKey].length || actionId == bytes32(0) || inputs.length > MAX_ACTION_BYTES
                || deadline == 0 || block.timestamp > deadline || actionNonce[launchKey][msg.sender] != expectedNonce
        ) revert InvalidAction();
        actionNonce[launchKey][msg.sender] = expectedNonce + 1;
        Instance storage instance = _instances[launchKey][index];
        executionId = keccak256(
            abi.encode(
                "module-mode.action.v1",
                block.chainid,
                address(this),
                launchKey,
                instance.instanceId,
                msg.sender,
                expectedNonce,
                actionId,
                keccak256(inputs),
                deadline
            )
        );
        T.ActionContext memory context =
            T.ActionContext(launchKey, instance.instanceId, executionId, msg.sender, expectedNonce, actionId);
        _invoke(
            instance,
            executionId,
            abi.encodeCall(IModuleProgramV1.onAction, (context, inputs)),
            IModuleProgramV1.onAction.selector
        );
        emit ActionApplied(
            launchKey, instance.instanceId, msg.sender, executionId, expectedNonce, actionId, keccak256(inputs)
        );
    }

    function available(bytes32 instanceId) external view returns (uint256) {
        return vault.available(instanceId);
    }

    /// @notice The active component can only credit from its own prefunded bucket. It cannot choose another bucket.
    function credit(address beneficiary, uint256 amount) external {
        if (msg.sender != _activeModule || _activeExecution == bytes32(0)) revert OnlyActiveModule();
        if (++_creditCount > MAX_CREDITS_PER_CALLBACK) revert ResourceLimit();
        vault.credit(_activeInstance, beneficiary, amount);
        emit BudgetCreditRequested(_activeExecution, _activeInstance, beneficiary, amount);
    }

    function _validateSelections(T.Selection[] calldata selections) private view {
        if (selections.length > MAX_INSTANCES) revert ResourceLimit();
        uint256 totalBytes;
        uint256 totalGas;
        for (uint256 i; i < selections.length; ++i) {
            T.Selection calldata selected = selections[i];
            totalBytes += selected.config.length;
            totalGas += selected.callbackGas;
            if (
                selected.packageId == bytes32(0) || selected.config.length > MAX_CONFIG_BYTES
                    || totalBytes > MAX_TOTAL_CONFIG_BYTES || selected.callbackGas < MIN_CALLBACK_GAS
                    || selected.callbackGas > MAX_CALLBACK_GAS || totalGas > MAX_TOTAL_CALLBACK_GAS
                    || selected.moduleCodeHash == bytes32(0)
            ) revert ResourceLimit();
            _checkCode(selected.factory, selected.factoryCodeHash);
        }
    }

    function _createInstance(bytes32 launchKey, uint256 index, T.Selection calldata selected) private {
        bytes32 instanceId = keccak256(abi.encode(launchKey, index));
        bytes32 configHash = keccak256(selected.config);
        T.InstanceBinding memory binding =
            T.InstanceBinding(address(this), launchKey, instanceId, selected.packageId, configHash);
        // Recheck immediately before each call, rather than trusting an earlier factory in the same recipe.
        _checkCode(selected.factory, selected.factoryCodeHash);
        bytes32 returned = _callWord(
            selected.factory, abi.encodeCall(IModuleProgramFactoryV1.create, (binding, selected.config)), FACTORY_GAS
        );
        if (uint256(returned) > type(uint160).max) revert ModuleCallFailed(selected.factory);
        address module = address(uint160(uint256(returned)));
        _checkCode(module, selected.moduleCodeHash);
        if (instanceOf[module] != bytes32(0)) revert InstanceAlreadyBound(module);
        if (_readWord(module, abi.encodeCall(IModuleProgramV1.bindingHash, ())) != keccak256(abi.encode(binding))) {
            revert InvalidInstanceBinding(module);
        }
        Instance memory instance = Instance(
            instanceId,
            selected.packageId,
            configHash,
            selected.factory,
            selected.factoryCodeHash,
            module,
            selected.moduleCodeHash,
            selected.callbackGas
        );
        instanceOf[module] = instanceId;
        _instances[launchKey].push(instance);
        vault.register(instanceId);
        emit InstanceBound(launchKey, instanceId, module, instance, selected.config);
    }

    function _invoke(Instance storage instance, bytes32 executionId, bytes memory input, bytes4 expected) private {
        _checkCode(instance.module, instance.moduleCodeHash);
        _activeModule = instance.module;
        _activeInstance = instance.instanceId;
        _activeExecution = executionId;
        _creditCount = 0;
        if (_callWord(instance.module, input, instance.callbackGas) != bytes32(expected)) {
            revert ModuleCallFailed(instance.module);
        }
        delete _activeModule;
        delete _activeInstance;
        delete _activeExecution;
        delete _creditCount;
    }

    /// @dev Bounded output copying also handles return-data bombs. The runtime exposes no arbitrary-target operation.
    function _callWord(address target, bytes memory input, uint256 gasLimit) private returns (bytes32 word) {
        bool ok;
        uint256 size;
        assembly ("memory-safe") {
            let output := mload(0x40)
            mstore(output, 0)
            ok := call(gasLimit, target, 0, add(input, 0x20), mload(input), output, 0x20)
            size := returndatasize()
            word := mload(output)
        }
        if (!ok || size != 32) revert ModuleCallFailed(target);
    }

    function _readWord(address target, bytes memory input) private view returns (bytes32 word) {
        bool ok;
        uint256 size;
        assembly ("memory-safe") {
            let output := mload(0x40)
            mstore(output, 0)
            ok := staticcall(50000, target, add(input, 0x20), mload(input), output, 0x20)
            size := returndatasize()
            word := mload(output)
        }
        if (!ok || size != 32) revert ModuleCallFailed(target);
    }

    function _checkCode(address target, bytes32 codeHash) private view {
        if (target.code.length == 0 || target.codehash != codeHash) revert CodeHashMismatch(target);
    }

    function _requireLaunch(bytes32 launchKey) private view {
        if (!registered[launchKey]) revert InvalidLaunch();
    }
}
