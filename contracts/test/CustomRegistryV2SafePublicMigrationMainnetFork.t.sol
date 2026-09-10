// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

interface ISafeProxyFactoryMigrationV141 {
    function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce)
        external
        returns (address proxy);
}

interface ISafeMigrationV141 {
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

    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes calldata signatures
    ) external payable returns (bool success);

    function addOwnerWithThreshold(address owner, uint256 threshold) external;
    function swapOwner(address prevOwner, address oldOwner, address newOwner) external;
    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
    function getModulesPaginated(address start, uint256 pageSize)
        external
        view
        returns (address[] memory array, address next);
    function getStorageAt(uint256 offset, uint256 length) external view returns (bytes memory);
    function nonce() external view returns (uint256);
}

interface IMultiSendCallOnlyMigrationV141 {
    function multiSend(bytes calldata transactions) external payable;
}

contract CustomRegistryV2SafePublicMigrationMainnetForkTest is Test {
    uint256 internal constant REVIEWED_MAINNET_BLOCK = 25_747_889;
    address internal constant SINGLETON = 0x41675C099F32341bf84BFc5382aF534df5C7461a;
    address internal constant FACTORY = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67;
    address internal constant MULTISEND_CALL_ONLY = 0x9641d764fc13c8B624c04430C7356C1C7C8102e2;
    address internal constant SENTINEL_MODULE = address(0x1);
    uint256 internal constant FALLBACK_HANDLER_SLOT =
        0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5;
    uint256 internal constant GUARD_SLOT = 0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8;

    address internal constant LEGACY = address(0xA001);
    address internal constant H1 = address(0xB001);
    address internal constant H2 = address(0xB002);
    address internal constant H3 = address(0xB003);
    address internal safe;

    function setUp() public {
        string memory rpcUrl = vm.envOr("ETHEREUM_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) {
            vm.skip(true, "ETHEREUM_RPC_URL is required for the mainnet fork proof");
            return;
        }
        vm.createSelectFork(vm.envOr("ETHEREUM_ARCHIVE_RPC_URL", rpcUrl), REVIEWED_MAINNET_BLOCK);
        safe = _deployLegacySafe(98_765_432_101);
    }

    function _deployLegacySafe(uint256 saltNonce) internal returns (address proxy) {
        address[] memory owners = new address[](1);
        owners[0] = LEGACY;
        bytes memory initializer = abi.encodeCall(
            ISafeMigrationV141.setup, (owners, 1, address(0), bytes(""), address(0), address(0), 0, payable(address(0)))
        );
        proxy = ISafeProxyFactoryMigrationV141(FACTORY).createProxyWithNonce(SINGLETON, initializer, saltNonce);
    }

    function test_exactLegacyMigrationEndsAtHardwareTwoOfThree() public {
        vm.prank(LEGACY);
        assertTrue(_execute(_migrationData(H3)));

        address[] memory owners = ISafeMigrationV141(safe).getOwners();
        assertEq(owners.length, 3);
        assertEq(owners[0], H2);
        assertEq(owners[1], H1);
        assertEq(owners[2], H3);
        assertEq(ISafeMigrationV141(safe).getThreshold(), 2);
        assertEq(ISafeMigrationV141(safe).nonce(), 1);
        (address[] memory modules, address next) = ISafeMigrationV141(safe).getModulesPaginated(SENTINEL_MODULE, 10);
        assertEq(modules.length, 0);
        assertEq(next, SENTINEL_MODULE);
        assertEq(ISafeMigrationV141(safe).getStorageAt(FALLBACK_HANDLER_SLOT, 1), new bytes(32));
        assertEq(ISafeMigrationV141(safe).getStorageAt(GUARD_SLOT, 1), new bytes(32));
    }

    function test_failedInnerOwnerChangeRollsBackTheWholeMigration() public {
        vm.prank(LEGACY);
        vm.expectRevert();
        ISafeMigrationV141(safe)
            .execTransaction(
                MULTISEND_CALL_ONLY,
                0,
                _migrationData(H1),
                1,
                0,
                0,
                0,
                address(0),
                payable(address(0)),
                _prevalidatedSignature(LEGACY)
            );
        address[] memory owners = ISafeMigrationV141(safe).getOwners();
        assertEq(owners.length, 1);
        assertEq(owners[0], LEGACY);
        assertEq(ISafeMigrationV141(safe).getThreshold(), 1);
        assertEq(ISafeMigrationV141(safe).nonce(), 0);
    }

    function test_currentHeadStillPinsMigrationDependencies() public {
        vm.createSelectFork(vm.envString("ETHEREUM_RPC_URL"));
        assertEq(SINGLETON.codehash, 0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4);
        assertEq(FACTORY.codehash, 0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317);
        assertEq(MULTISEND_CALL_ONLY.codehash, 0xecd5bd14a08c5d2122379900b2f272bdf107a7e92423c10dd5fe3254386c9939);

        safe = _deployLegacySafe(98_765_432_102);
        vm.prank(LEGACY);
        assertTrue(_execute(_migrationData(H3)));
        address[] memory owners = ISafeMigrationV141(safe).getOwners();
        assertEq(owners.length, 3);
        assertEq(owners[0], H2);
        assertEq(owners[1], H1);
        assertEq(owners[2], H3);
        assertEq(ISafeMigrationV141(safe).getThreshold(), 2);
        assertEq(ISafeMigrationV141(safe).nonce(), 1);
    }

    function _execute(bytes memory data) internal returns (bool) {
        return ISafeMigrationV141(safe)
            .execTransaction(
                MULTISEND_CALL_ONLY,
                0,
                data,
                1,
                0,
                0,
                0,
                address(0),
                payable(address(0)),
                _prevalidatedSignature(LEGACY)
            );
    }

    function _migrationData(address replacement) internal view returns (bytes memory) {
        bytes memory calls;
        calls = bytes.concat(calls, _packedCall(abi.encodeCall(ISafeMigrationV141.addOwnerWithThreshold, (H1, 1))));
        calls = bytes.concat(calls, _packedCall(abi.encodeCall(ISafeMigrationV141.addOwnerWithThreshold, (H2, 2))));
        calls =
            bytes.concat(calls, _packedCall(abi.encodeCall(ISafeMigrationV141.swapOwner, (H1, LEGACY, replacement))));
        return abi.encodeCall(IMultiSendCallOnlyMigrationV141.multiSend, (calls));
    }

    function _packedCall(bytes memory data) internal view returns (bytes memory) {
        return abi.encodePacked(uint8(0), safe, uint256(0), data.length, data);
    }

    function _prevalidatedSignature(address owner) internal pure returns (bytes memory) {
        return abi.encodePacked(bytes32(uint256(uint160(owner))), bytes32(0), uint8(1));
    }
}
