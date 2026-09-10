// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";

interface ISafeProxyFactoryV141 {
    function proxyCreationCode() external pure returns (bytes memory);
    function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce)
        external
        returns (address proxy);
}

interface IMultiSendCallOnlyV141 {
    function multiSend(bytes calldata transactions) external payable;
}

interface ISafeV141 {
    function setup(
        address[] calldata owners,
        uint256 threshold,
        address to,
        bytes calldata data,
        address fallbackHandler,
        address paymentToken,
        uint256 payment,
        address payable paymentReceiver
    ) external;
    function VERSION() external view returns (string memory);
    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
    function nonce() external view returns (uint256);
}

contract CustomRegistryV2SafeAtomicBatchMainnetForkTest is Test {
    uint256 internal constant REVIEWED_MAINNET_BLOCK = 25_747_889;
    address internal constant SINGLETON = 0x41675C099F32341bf84BFc5382aF534df5C7461a;
    address internal constant FACTORY = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67;
    address internal constant MULTISEND_CALL_ONLY = 0x9641d764fc13c8B624c04430C7356C1C7C8102e2;
    bytes32 internal constant SINGLETON_RUNTIME_HASH =
        0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4;
    bytes32 internal constant FACTORY_RUNTIME_HASH = 0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317;
    bytes32 internal constant MULTISEND_RUNTIME_HASH =
        0xecd5bd14a08c5d2122379900b2f272bdf107a7e92423c10dd5fe3254386c9939;
    bytes32 internal constant PROXY_RUNTIME_HASH = 0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c;

    address internal constant DEPLOYER = address(0xD001);
    address[4] internal owners = [address(0xA001), address(0xA002), address(0xA003), address(0xA004)];
    uint256[4] internal salts = [uint256(101), uint256(102), uint256(103), uint256(104)];

    function setUp() public {
        string memory rpcUrl = vm.envOr("ETHEREUM_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) {
            vm.skip(true, "ETHEREUM_RPC_URL is required for the mainnet fork proof");
            return;
        }
        vm.createSelectFork(vm.envOr("ETHEREUM_ARCHIVE_RPC_URL", rpcUrl), REVIEWED_MAINNET_BLOCK);
        assertEq(SINGLETON.codehash, SINGLETON_RUNTIME_HASH);
        assertEq(FACTORY.codehash, FACTORY_RUNTIME_HASH);
        assertEq(MULTISEND_CALL_ONLY.codehash, MULTISEND_RUNTIME_HASH);
    }

    function test_directEoaBatchCreatesAllFourExactSafesAtomically() public {
        (bytes memory batch, address[4] memory predicted) = _batch(type(uint256).max);
        uint256 balanceBefore = MULTISEND_CALL_ONLY.balance;
        vm.recordLogs();
        vm.prank(DEPLOYER);
        IMultiSendCallOnlyV141(MULTISEND_CALL_ONLY).multiSend(batch);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(MULTISEND_CALL_ONLY.balance, balanceBefore);
        assertEq(logs.length, 8);
        for (uint256 i; i < predicted.length; ++i) {
            assertEq(logs[i * 2].emitter, predicted[i]);
            assertEq(logs[i * 2].topics[0], keccak256("SafeSetup(address,address[],uint256,address,address)"));
            assertEq(address(uint160(uint256(logs[i * 2].topics[1]))), FACTORY);
            (address[] memory setupOwners, uint256 threshold, address initializer, address fallbackHandler) =
                abi.decode(logs[i * 2].data, (address[], uint256, address, address));
            assertEq(setupOwners.length, 1);
            assertEq(setupOwners[0], owners[i]);
            assertEq(threshold, 1);
            assertEq(initializer, address(0));
            assertEq(fallbackHandler, address(0));
            assertEq(logs[i * 2 + 1].emitter, FACTORY);
            assertEq(logs[i * 2 + 1].topics[0], keccak256("ProxyCreation(address,address)"));
            assertEq(address(uint160(uint256(logs[i * 2 + 1].topics[1]))), predicted[i]);
            assertEq(abi.decode(logs[i * 2 + 1].data, (address)), SINGLETON);
            assertEq(predicted[i].codehash, PROXY_RUNTIME_HASH);
            assertEq(ISafeV141(predicted[i]).VERSION(), "1.4.1");
            address[] memory actualOwners = ISafeV141(predicted[i]).getOwners();
            assertEq(actualOwners.length, 1);
            assertEq(actualOwners[0], owners[i]);
            assertEq(ISafeV141(predicted[i]).getThreshold(), 1);
            assertEq(ISafeV141(predicted[i]).nonce(), 0);
            assertEq(predicted[i].balance, 0);
        }
    }

    function test_currentHeadStillPinsOfficialSafeInfrastructure() public {
        vm.createSelectFork(vm.envString("ETHEREUM_RPC_URL"));
        assertEq(SINGLETON.codehash, SINGLETON_RUNTIME_HASH);
        assertEq(FACTORY.codehash, FACTORY_RUNTIME_HASH);
        assertEq(MULTISEND_CALL_ONLY.codehash, MULTISEND_RUNTIME_HASH);
    }

    function test_eachFailingInnerCallRollsBackEveryProxy() public {
        for (uint256 failingIndex; failingIndex < 4; ++failingIndex) {
            uint256 snapshot = vm.snapshotState();
            (bytes memory batch, address[4] memory predicted) = _batch(failingIndex);
            vm.expectRevert();
            vm.prank(DEPLOYER);
            IMultiSendCallOnlyV141(MULTISEND_CALL_ONLY).multiSend(batch);
            for (uint256 i; i < predicted.length; ++i) {
                assertEq(predicted[i].code.length, 0);
            }
            assertTrue(vm.revertToState(snapshot));
        }
    }

    function test_proxyPredictionsAreCallerIndependent() public {
        (bytes memory batch, address[4] memory predicted) = _batch(type(uint256).max);
        uint256 snapshot = vm.snapshotState();
        vm.prank(address(0xA11CE));
        IMultiSendCallOnlyV141(MULTISEND_CALL_ONLY).multiSend(batch);
        for (uint256 i; i < 4; ++i) {
            assertEq(predicted[i].codehash, PROXY_RUNTIME_HASH);
        }
        assertTrue(vm.revertToState(snapshot));
        vm.prank(address(0xB0B));
        IMultiSendCallOnlyV141(MULTISEND_CALL_ONLY).multiSend(batch);
        for (uint256 i; i < 4; ++i) {
            assertEq(predicted[i].codehash, PROXY_RUNTIME_HASH);
        }
    }

    function _batch(uint256 failingIndex) internal view returns (bytes memory batch, address[4] memory predicted) {
        for (uint256 i; i < 4; ++i) {
            bytes memory initializer = _initializer(owners[i]);
            predicted[i] = _predict(initializer, salts[i]);
            address singleton = i == failingIndex ? address(0) : SINGLETON;
            bytes memory call =
                abi.encodeCall(ISafeProxyFactoryV141.createProxyWithNonce, (singleton, initializer, salts[i]));
            batch = bytes.concat(batch, abi.encodePacked(uint8(0), FACTORY, uint256(0), call.length, call));
        }
    }

    function _initializer(address owner) internal pure returns (bytes memory) {
        address[] memory safeOwners = new address[](1);
        safeOwners[0] = owner;
        return abi.encodeCall(
            ISafeV141.setup, (safeOwners, 1, address(0), bytes(""), address(0), address(0), 0, payable(address(0)))
        );
    }

    function _predict(bytes memory initializer, uint256 saltNonce) internal view returns (address) {
        bytes32 salt = keccak256(abi.encodePacked(keccak256(initializer), saltNonce));
        bytes memory deploymentData =
            abi.encodePacked(ISafeProxyFactoryV141(FACTORY).proxyCreationCode(), uint256(uint160(SINGLETON)));
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), FACTORY, salt, keccak256(deploymentData)))))
        );
    }
}
