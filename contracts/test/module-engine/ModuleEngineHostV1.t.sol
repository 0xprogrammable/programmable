// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { ClassicModuleLaunchPolicyV1 } from "../../src/classic-modules/ClassicModuleLaunchPolicyV1.sol";
import { ModuleNativeRegistryV1 } from "../../src/module-mode/engine/ModuleNativeRegistryV1.sol";
import { ModuleEngineHostV1, IModuleEngineReviewAuthorityV1 } from "../../src/module-engine/ModuleEngineHostV1.sol";
import { ModuleEngineBaseV1 } from "../../src/module-engine/ModuleEngineBaseV1.sol";
import { ModuleEngineCallsV1 } from "../../src/module-engine/ModuleEngineCallsV1.sol";
import { ModuleQuoteEscrowEngineV1 } from "../../src/module-engine/ModuleQuoteEscrowEngineV1.sol";
import { IModuleEngineV1 } from "../../src/module-engine/IModuleEngineV1.sol";
import { ModuleEngineTypesV1 as T } from "../../src/module-engine/ModuleEngineTypesV1.sol";

contract EngineQuoteToken is ERC20 {
    uint8 internal _decimals;
    bool public tax;
    bool public senderTax;
    address public callback;
    bytes public callbackData;
    bool public callbackSucceeded;

    constructor(uint8 decimals_) ERC20("Generic quote", "QUOTE") {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address receiver, uint256 amount) external {
        _mint(receiver, amount);
    }

    function setTax(bool enabled) external {
        tax = enabled;
    }

    function setSenderTax(bool enabled) external {
        senderTax = enabled;
    }

    function setCallback(address target, bytes calldata data) external {
        callback = target;
        callbackData = data;
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (callback != address(0)) (callbackSucceeded,) = callback.call(callbackData);
        return super.transferFrom(from, to, value);
    }

    function _update(address from, address to, uint256 value) internal override {
        uint256 fee = tax && from != address(0) && to != address(0) ? value / 100 : 0;
        super._update(from, to, value - fee);
        if (fee != 0) super._update(from, address(0), fee);
        if (senderTax && from != address(0) && to != address(0)) super._update(from, address(0), value / 100);
    }
}

contract ImmutableContextEngine is ModuleEngineBaseV1 {
    address public immutable boundQuote;

    constructor(T.Context memory c, bytes memory) ModuleEngineBaseV1(c) {
        boundQuote = c.quoteAsset;
    }

    function _initialize(bytes calldata) internal view override returns (bytes32) {
        return bytes32(uint256(uint160(boundQuote)));
    }

    function _execute(T.Operation calldata) internal pure override returns (bytes memory) {
        return "";
    }
}

contract IncorrectContextEngine is IModuleEngineV1 {
    constructor(T.Context memory, bytes memory) { }

    function contextHash() external pure returns (bytes32) {
        return 0;
    }

    function initialize(bytes calldata) external pure returns (bytes32) {
        return 0;
    }

    function execute(T.Operation calldata) external payable returns (bytes memory) {
        return "";
    }
}

contract OversizedResultEngine is ModuleEngineBaseV1 {
    constructor(T.Context memory context_, bytes memory) ModuleEngineBaseV1(context_) { }

    function _initialize(bytes calldata) internal pure override returns (bytes32) {
        return bytes32("bounded result");
    }

    function _execute(T.Operation calldata operation) internal pure override returns (bytes memory output) {
        output = new bytes(32_768);
        if (operation.data.length != 0) {
            assembly ("memory-safe") { revert(add(output, 32), mload(output)) }
        }
    }
}

contract EngineLauncherWallet {
    function launch(ModuleEngineHostV1 host, ModuleEngineHostV1.LaunchParameters calldata parameters)
        external
        returns (ModuleEngineHostV1.Launch memory)
    {
        return host.launch(parameters);
    }
}

abstract contract EngineHostTestBase is Test {
    ModuleEngineHostV1 internal host;
    ModuleNativeRegistryV1 internal registry;
    IPoolManager internal manager;
    EngineQuoteToken internal quote;
    bytes32 internal family;
    address internal constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal treasury = address(0x1111);
    address internal authorWallet = address(0x2222);
    address internal alice = address(0x3333);

    function _setUpHost() internal {
        vm.deal(address(this), 100 ether);
        deployCodeTo("PoolManager.sol:PoolManager", abi.encode(address(this)), POOL_MANAGER);
        manager = IPoolManager(POOL_MANAGER);
        registry = new ModuleNativeRegistryV1(address(this));
        family = registry.registerFamily(bytes32("independent contributor"), authorWallet);
        UERC20Factory tokenFactory = new UERC20Factory();
        ClassicModuleLaunchPolicyV1 policy = new ClassicModuleLaunchPolicyV1();
        host = ModuleEngineHostV1(
            deployCode(
                "ModuleEngineHostV1.sol:ModuleEngineHostV1",
                abi.encode(
                    tokenFactory,
                    policy,
                    IModuleEngineReviewAuthorityV1(address(registry)),
                    manager,
                    treasury,
                    address(this)
                )
            )
        );
        quote = new EngineQuoteToken(18);
        quote.mint(address(this), 1000 ether);
        quote.mint(alice, 1000 ether);
        quote.approve(address(host), type(uint256).max);
        vm.prank(alice);
        quote.approve(address(host), type(uint256).max);
    }

    function _params(bytes32 revision, address quoteAsset, uint256 salt)
        internal
        view
        returns (ModuleEngineHostV1.LaunchParameters memory p)
    {
        p.name = "Contributor coin";
        p.symbol = "CODE";
        p.revisionId = revision;
        p.quoteAsset = quoteAsset;
        p.creatorSalt = bytes32(salt);
        p.creatorWallets = new address[](1);
        p.creatorWallets[0] = address(this);
        p.creatorSharesBps = new uint16[](1);
        p.creatorSharesBps[0] = 10_000;
    }

    function _revision(bytes memory creation, bytes memory runtime, bytes32 initialId, uint8 rights)
        internal
        view
        returns (T.Revision memory revision)
    {
        return T.Revision(
            family,
            keccak256(creation),
            keccak256(runtime),
            bytes32("review manifest"),
            address(0),
            0,
            initialId,
            10_000_000,
            rights,
            0,
            true
        );
    }

    struct ImmutableLocation {
        uint256 length;
        uint256 start;
    }

    function _immutableOffsets(string memory artifact, uint32 constructorOffset)
        internal
        view
        returns (uint32[] memory runtimeOffsets, uint32[] memory constructorOffsets)
    {
        string memory json = vm.readFile(string.concat("out/", artifact, ".json"));
        string memory root = ".deployedBytecode.immutableReferences";
        string[] memory keys = vm.parseJsonKeys(json, root);
        assertEq(keys.length, 1, "reference must have one known immutable binding");
        ImmutableLocation[] memory locations =
            abi.decode(vm.parseJson(json, string.concat(root, ".", keys[0])), (ImmutableLocation[]));
        runtimeOffsets = new uint32[](locations.length);
        constructorOffsets = new uint32[](locations.length);
        for (uint256 i; i < locations.length; ++i) {
            assertEq(locations[i].length, 32);
            runtimeOffsets[i] = uint32(locations[i].start);
            constructorOffsets[i] = constructorOffset;
        }
    }

    function _op(bytes32 id, address actor, address asset, uint256 input, address out, uint256 minimum, uint256 nonce)
        internal
        view
        returns (T.Operation memory)
    {
        return T.Operation(id, actor, actor, asset, input, out, minimum, block.timestamp + 1 days, nonce, "");
    }
}

contract ModuleEngineHostV1Test is EngineHostTestBase {
    bytes32 internal constant REVISION = keccak256("escrow revision");
    bytes32 internal constant DEPOSIT = keccak256("escrow.deposit.v1");
    bytes32 internal constant WITHDRAW = keccak256("escrow.withdraw.v1");

    function setUp() public {
        _setUpHost();
        _registerEscrow(REVISION, address(0), bytes32(0));
    }

    function _registerEscrow(bytes32 id, address fixedQuote, bytes32 fixedConfiguration) private {
        T.Revision memory revision = _revision(
            type(ModuleQuoteEscrowEngineV1).creationCode,
            type(ModuleQuoteEscrowEngineV1).runtimeCode,
            bytes32(0),
            T.ROLE_QUOTE
        );
        revision.fixedQuoteAsset = fixedQuote;
        revision.fixedConfigurationHash = fixedConfiguration;
        T.Permission[] memory permissions = new T.Permission[](2);
        permissions[0] = T.Permission(DEPOSIT, T.ROLE_QUOTE, T.ROLE_NONE, T.AUTH_PUBLIC);
        permissions[1] = T.Permission(WITHDRAW, T.ROLE_NONE, T.ROLE_QUOTE, T.AUTH_PUBLIC);
        host.approveRevision(id, revision, new uint32[](0), new uint32[](0), permissions, new bytes32[](0));
    }

    function _escrowParams(bytes32 revision, address asset, uint256 salt)
        private
        view
        returns (ModuleEngineHostV1.LaunchParameters memory p)
    {
        p = _params(revision, asset, salt);
        p.configuration = abi.encode(address(0), uint256(0));
        p.creationCode = type(ModuleQuoteEscrowEngineV1).creationCode;
        p.runtimeTemplate = type(ModuleQuoteEscrowEngineV1).runtimeCode;
    }

    function test_actorScopedNonTradeDepositWithdrawAndReplayProtection() public {
        ModuleEngineHostV1.Launch memory launched = host.launch(_escrowParams(REVISION, address(quote), 1));
        ModuleQuoteEscrowEngineV1 escrow = ModuleQuoteEscrowEngineV1(launched.engine);
        T.Operation memory deposit = _op(DEPOSIT, address(this), address(quote), 10 ether, address(0), 0, 0);
        host.execute(launched.launchId, deposit);
        assertEq(escrow.credit(address(this)), 10 ether);
        assertEq(escrow.totalLiability(), 10 ether);
        assertEq(quote.balanceOf(address(host)), 0);
        assertEq(quote.allowance(address(host), launched.engine), 0);
        vm.expectRevert(ModuleEngineHostV1.StaleNonce.selector);
        host.execute(launched.launchId, deposit);
        T.Operation memory withdrawal = _op(WITHDRAW, address(this), address(0), 0, address(quote), 10 ether, 1);
        withdrawal.data = abi.encode(10 ether);
        host.execute(launched.launchId, withdrawal);
        assertEq(escrow.totalLiability(), 0);
        assertEq(quote.balanceOf(address(this)), 1000 ether);
        assertEq(host.ledger().totalFeesReceived(), 0, "escrow is not a swap fee basis");
        assertEq(IERC20(launched.token).totalSupply(), 1_000_000_000 ether);
    }

    function test_smartWalletLaunchEmitsCanonicalParametersForIndependentReconstruction() public {
        EngineLauncherWallet wallet = new EngineLauncherWallet();
        ModuleEngineHostV1.LaunchParameters memory p = _escrowParams(REVISION, address(quote), 31);
        p.initialOperation.data = hex"1234";
        p.metadata.description = "Receipt reconstruction";
        p.metadata.extraData = hex"12345678";
        vm.recordLogs();
        ModuleEngineHostV1.Launch memory launched = wallet.launch(host, p);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 matches;
        for (uint256 i; i < logs.length; ++i) {
            if (
                logs[i].emitter == address(host)
                    && logs[i].topics[0] == keccak256("EngineLaunchParametersBound(bytes32,bytes)")
            ) {
                ++matches;
                assertEq(logs[i].topics.length, 2);
                assertEq(logs[i].topics[1], launched.launchId);
                bytes memory encoded = abi.decode(logs[i].data, (bytes));
                assertEq(encoded, abi.encode(p));
                ModuleEngineHostV1.LaunchParameters memory decoded =
                    abi.decode(encoded, (ModuleEngineHostV1.LaunchParameters));
                assertEq(
                    keccak256(abi.encode(block.chainid, address(host), address(wallet), decoded)), launched.planHash
                );
                assertLe(encoded.length, host.MAX_LAUNCH_PARAMETERS_BYTES());
            }
        }
        assertEq(matches, 1);
        assertEq(launched.creator, address(wallet));
        assertEq(host.getLaunch(launched.launchId).planHash, launched.planHash);
    }

    function test_unusedInitialDataCannotExceedEventBudgetAndCanonicalMaximumIsBounded() public {
        ModuleEngineHostV1.LaunchParameters memory p = _escrowParams(REVISION, address(quote), 32);
        p.initialOperation.data = new bytes(host.MAX_CONFIGURATION_BYTES() + 1);
        vm.expectRevert(ModuleEngineHostV1.InvalidCodeBinding.selector);
        host.launch(p);

        // Saturate every independently bounded ABI tail and the combined EIP-3860 init payload.
        p.name = string(new bytes(48));
        p.symbol = string(new bytes(12));
        p.configuration = new bytes(16_384);
        p.creationCode = new bytes(49_152 - 256 - 16_384);
        p.runtimeTemplate = new bytes(24_576);
        p.launchData = new bytes(16_384);
        p.initialOperation.data = new bytes(16_384);
        p.metadata.description = string(new bytes(280));
        p.metadata.website = string(new bytes(2048));
        p.metadata.image = string(new bytes(2048));
        p.metadata.extraData = new bytes(1200);
        p.creatorWallets = new address[](10);
        p.creatorSharesBps = new uint16[](10);
        assertEq(abi.encode(p).length, host.MAX_LAUNCH_PARAMETERS_BYTES());
        assertEq(abi.encode(abi.encode(p)).length, host.MAX_LAUNCH_PARAMETERS_BYTES() + 64);
    }

    function test_lateSixDecimalAddressUsesSameRevisionAndDoesNotChangeOldQuote() public {
        ModuleEngineHostV1.Launch memory first = host.launch(_escrowParams(REVISION, address(quote), 1));
        EngineQuoteToken six = new EngineQuoteToken(6);
        six.mint(address(this), 100_000_000);
        six.approve(address(host), 7_000_000);
        ModuleEngineHostV1.Launch memory second = host.launch(_escrowParams(REVISION, address(six), 2));
        host.execute(second.launchId, _op(DEPOSIT, address(this), address(six), 7_000_000, address(0), 0, 0));
        assertEq(ModuleQuoteEscrowEngineV1(second.engine).credit(address(this)), 7_000_000);
        assertEq(host.getLaunch(first.launchId).quoteAsset, address(quote));
        assertEq(quote.balanceOf(first.engine), 0);
        assertEq(first.revisionId, second.revisionId);
        assertTrue(first.engine != second.engine);
    }

    function test_fixedQuoteAndConfigurationOverridesRejectInExecution() public {
        bytes32 fixedRevision = keccak256("fixed same contribution profile");
        bytes memory fixedConfig = abi.encode(address(quote), uint256(50));
        _registerEscrow(fixedRevision, address(quote), keccak256(fixedConfig));
        ModuleEngineHostV1.LaunchParameters memory p = _escrowParams(fixedRevision, address(quote), 1);
        p.configuration = fixedConfig;
        host.launch(p);
        p.creatorSalt = bytes32(uint256(2));
        p.quoteAsset = address(new EngineQuoteToken(6));
        vm.expectRevert(ModuleEngineHostV1.FixedValueOverride.selector);
        host.launch(p);
        p.quoteAsset = address(quote);
        p.configuration = abi.encode(address(quote), uint256(51));
        vm.expectRevert(ModuleEngineHostV1.FixedValueOverride.selector);
        host.launch(p);
    }

    function test_oldLaunchRemainsUsableAfterRevisionDisabled() public {
        ModuleEngineHostV1.Launch memory launched = host.launch(_escrowParams(REVISION, address(quote), 1));
        host.setRevisionEnabled(REVISION, false);
        host.execute(launched.launchId, _op(DEPOSIT, address(this), address(quote), 1 ether, address(0), 0, 0));
        ModuleEngineHostV1.LaunchParameters memory p = _escrowParams(REVISION, address(quote), 2);
        vm.expectRevert(ModuleEngineHostV1.UnavailableRevision.selector);
        host.launch(p);
    }

    function test_actorSpoofDirectInvocationAndCrossLaunchWithdrawalReject() public {
        ModuleEngineHostV1.Launch memory first = host.launch(_escrowParams(REVISION, address(quote), 1));
        ModuleEngineHostV1.Launch memory second = host.launch(_escrowParams(REVISION, address(quote), 2));
        T.Operation memory deposit = _op(DEPOSIT, address(this), address(quote), 2 ether, address(0), 0, 0);
        vm.expectRevert(ModuleEngineBaseV1.UnauthorizedHost.selector);
        IModuleEngineV1(first.engine).execute(deposit);
        vm.expectRevert(ModuleEngineBaseV1.UnauthorizedHost.selector);
        IModuleEngineV1(first.engine).initialize("");
        deposit.actor = alice;
        vm.expectRevert(ModuleEngineHostV1.UnauthorizedOperation.selector);
        host.execute(first.launchId, deposit);
        deposit.actor = address(this);
        host.execute(first.launchId, deposit);
        T.Operation memory withdraw = _op(WITHDRAW, address(this), address(0), 0, address(quote), 2 ether, 0);
        withdraw.data = abi.encode(2 ether);
        vm.expectRevert(ModuleQuoteEscrowEngineV1.InvalidEscrowOperation.selector);
        host.execute(second.launchId, withdraw);
        assertEq(quote.balanceOf(first.engine), 2 ether);
        assertEq(host.nonces(second.launchId, address(this)), 0);
    }

    function test_taxAndReentrancyCannotCreateUnfundedCredit() public {
        ModuleEngineHostV1.Launch memory launched = host.launch(_escrowParams(REVISION, address(quote), 1));
        T.Operation memory deposit = _op(DEPOSIT, address(this), address(quote), 10 ether, address(0), 0, 0);
        quote.setTax(true);
        vm.expectRevert(ModuleEngineHostV1.InvalidFunding.selector);
        host.execute(launched.launchId, deposit);
        assertEq(host.nonces(launched.launchId, address(this)), 0);
        assertEq(ModuleQuoteEscrowEngineV1(launched.engine).totalLiability(), 0);
        quote.setTax(false);
        quote.setSenderTax(true);
        vm.expectRevert(ModuleEngineHostV1.InvalidFunding.selector);
        host.execute(launched.launchId, deposit);
        quote.setSenderTax(false);
        quote.setCallback(address(host), abi.encodeCall(host.execute, (launched.launchId, deposit)));
        host.execute(launched.launchId, deposit);
        assertFalse(quote.callbackSucceeded());
        assertEq(ModuleQuoteEscrowEngineV1(launched.engine).totalLiability(), 10 ether);
    }

    function test_zeroMinimumCannotBypassDeclaredOutputAssetRights() public {
        ModuleEngineHostV1.Launch memory launched = host.launch(_escrowParams(REVISION, address(quote), 1));
        T.Operation memory deposit = _op(DEPOSIT, address(this), address(quote), 1 ether, launched.token, 0, 0);
        vm.expectRevert(ModuleEngineHostV1.UnauthorizedOperation.selector);
        host.execute(launched.launchId, deposit);
        assertEq(quote.balanceOf(launched.engine), 0);
        assertEq(host.nonces(launched.launchId, address(this)), 0);
    }

    function test_expiredOperationAndRuntimeDriftPreserveBalanceAndNonce() public {
        ModuleEngineHostV1.Launch memory launched = host.launch(_escrowParams(REVISION, address(quote), 1));
        T.Operation memory deposit = _op(DEPOSIT, address(this), address(quote), 10 ether, address(0), 0, 0);
        deposit.deadline = block.timestamp - 1;
        vm.expectRevert(ModuleEngineHostV1.DeadlineExpired.selector);
        host.execute(launched.launchId, deposit);
        deposit.deadline = block.timestamp + 1;
        vm.etch(launched.engine, hex"00");
        vm.expectRevert(ModuleEngineHostV1.InvalidCodeBinding.selector);
        host.execute(launched.launchId, deposit);
        assertEq(host.nonces(launched.launchId, address(this)), 0);
        assertEq(quote.balanceOf(address(this)), 1000 ether);
    }

    function test_mismatchedCreationRuntimeAndContextRejectAtomically() public {
        ModuleEngineHostV1.LaunchParameters memory p = _escrowParams(REVISION, address(quote), 1);
        p.creationCode[0] = bytes1(uint8(p.creationCode[0]) ^ 1);
        vm.expectRevert(ModuleEngineHostV1.InvalidCodeBinding.selector);
        host.launch(p);
        p = _escrowParams(REVISION, address(quote), 1);
        p.runtimeTemplate[0] = bytes1(uint8(p.runtimeTemplate[0]) ^ 1);
        vm.expectRevert(ModuleEngineHostV1.InvalidCodeBinding.selector);
        host.launch(p);
        bytes32 badRevision = keccak256("bad context");
        T.Permission[] memory permissions = new T.Permission[](1);
        permissions[0] = T.Permission(DEPOSIT, 0, 0, 0);
        host.approveRevision(
            badRevision,
            _revision(type(IncorrectContextEngine).creationCode, type(IncorrectContextEngine).runtimeCode, 0, 0),
            new uint32[](0),
            new uint32[](0),
            permissions,
            new bytes32[](0)
        );
        p = _params(badRevision, address(quote), 1);
        p.creationCode = type(IncorrectContextEngine).creationCode;
        p.runtimeTemplate = type(IncorrectContextEngine).runtimeCode;
        vm.expectRevert(ModuleEngineHostV1.InvalidConstructorBinding.selector);
        host.launch(p);
    }

    function test_exactCompilerImmutablePatchBindsLateQuoteWithoutNewApproval() public {
        bytes32 immutableRevision = keccak256("constructor bound");
        bytes memory creation = vm.getCode("ModuleEngineHostV1.t.sol:ImmutableContextEngine");
        bytes memory runtime = vm.getDeployedCode("ModuleEngineHostV1.t.sol:ImmutableContextEngine");
        (uint32[] memory offsets, uint32[] memory bindings) =
            _immutableOffsets("ModuleEngineHostV1.t.sol/ImmutableContextEngine", 128);
        T.Permission[] memory permissions = new T.Permission[](1);
        permissions[0] = T.Permission(DEPOSIT, 0, 0, 0);
        host.approveRevision(
            immutableRevision, _revision(creation, runtime, 0, 0), offsets, bindings, permissions, new bytes32[](0)
        );
        ModuleEngineHostV1.LaunchParameters memory p = _params(immutableRevision, address(quote), 1);
        p.creationCode = creation;
        p.runtimeTemplate = runtime;
        ModuleEngineHostV1.Launch memory first = host.launch(p);
        EngineQuoteToken late = new EngineQuoteToken(6);
        p.quoteAsset = address(late);
        p.creatorSalt = bytes32(uint256(2));
        ModuleEngineHostV1.Launch memory second = host.launch(p);
        assertEq(ImmutableContextEngine(first.engine).boundQuote(), address(quote));
        assertEq(ImmutableContextEngine(second.engine).boundQuote(), address(late));
        assertTrue(first.engineCodeHash != second.engineCodeHash);
        assertEq(first.engineCodeHash, first.engine.codehash);
        assertEq(second.engineCodeHash, second.engine.codehash);
    }

    function test_noNewCoinRightsOrReviewerRightsOrUnbackedFeeDeposit() public {
        T.Revision memory revision = _revision(
            type(ModuleQuoteEscrowEngineV1).creationCode, type(ModuleQuoteEscrowEngineV1).runtimeCode, 0, T.ROLE_QUOTE
        );
        T.Permission[] memory permissions = new T.Permission[](1);
        permissions[0] = T.Permission(DEPOSIT, T.ROLE_QUOTE, 0, 0);
        vm.prank(alice);
        vm.expectRevert(ModuleEngineHostV1.UnauthorizedReviewer.selector);
        host.approveRevision(bytes32("new"), revision, new uint32[](0), new uint32[](0), permissions, new bytes32[](0));
        revision.coinRights = 1;
        vm.expectRevert(ModuleEngineHostV1.InvalidRevision.selector);
        host.approveRevision(bytes32("new"), revision, new uint32[](0), new uint32[](0), permissions, new bytes32[](0));
        vm.expectRevert(ModuleEngineHostV1.UnauthorizedFeeDeposit.selector);
        host.depositFees{ value: 1 }(1, 0);
        assertEq(host.ledger().totalFeesReceived(), 0);
    }

    function test_oversizedSuccessAndRevertPayloadAreRejectedWithoutNonceConsumption() public {
        bytes32 bombRevision = keccak256("bounded output test");
        T.Permission[] memory permissions = new T.Permission[](1);
        permissions[0] = T.Permission(DEPOSIT, 0, 0, 0);
        host.approveRevision(
            bombRevision,
            _revision(type(OversizedResultEngine).creationCode, type(OversizedResultEngine).runtimeCode, 0, 0),
            new uint32[](0),
            new uint32[](0),
            permissions,
            new bytes32[](0)
        );
        ModuleEngineHostV1.LaunchParameters memory p = _params(bombRevision, address(quote), 1);
        p.creationCode = type(OversizedResultEngine).creationCode;
        p.runtimeTemplate = type(OversizedResultEngine).runtimeCode;
        ModuleEngineHostV1.Launch memory launched = host.launch(p);
        T.Operation memory operation = _op(DEPOSIT, address(this), address(0), 0, address(0), 0, 0);
        vm.expectRevert(
            abi.encodeWithSelector(
                ModuleEngineCallsV1.EngineReturnLimit.selector, launched.engine, uint256(32_832), uint256(16_448)
            )
        );
        host.execute(launched.launchId, operation);
        operation.data = hex"01";
        vm.expectRevert(
            abi.encodeWithSelector(
                ModuleEngineCallsV1.EngineReturnLimit.selector, launched.engine, uint256(32_768), uint256(4096)
            )
        );
        host.execute(launched.launchId, operation);
        assertEq(host.nonces(launched.launchId, address(this)), 0);
        assertEq(host.ledger().totalFeesReceived(), 0);
    }

    receive() external payable { }
}
