// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {
    IProgrammableCreate2GraphDeployerV1 as IGraph
} from "../../src/interfaces/IProgrammableCreate2GraphDeployerV1.sol";
import {
    ProgrammableMultiRoleLaunchStampRouterV2 as Router
} from "../../src/router_v2/ProgrammableMultiRoleLaunchStampRouterV2.sol";
import {
    ProgrammableMultiRoleLaunchStampRouterV2DataPolicyV1 as DataRouter
} from "../../src/router_v2/ProgrammableMultiRoleLaunchStampRouterV2DataPolicyV1.sol";
import { ProgrammableCreate2GraphDeployerV1 as Graph } from "./fixtures/ProgrammableCreate2GraphDeployerV1.sol";
import {
    ProgrammableMultiRoleLaunchStampRouterV2Test,
    RouterV2TestAuthority,
    RouterV2OpcodeScanHarness
} from "./ProgrammableMultiRoleLaunchStampRouterV2.t.sol";

contract RouterV2DataPolicyScanHarness is DataRouter {
    constructor(address authority, IGraph graph, IPoolManager manager) DataRouter(authority, graph, manager) { }

    function validateRuntimeOpcodes(uint256 targetIndex, bytes memory runtimeCode) external pure {
        _validateRuntimeOpcodes(targetIndex, runtimeCode);
    }
}

/// @dev Runs all inherited V2 graph, permit, rollback, replay, and provenance checks against the successor.
contract ProgrammableMultiRoleDataPolicyV1GraphTest is ProgrammableMultiRoleLaunchStampRouterV2Test {
    function _newRouter(address authority, IGraph graph, IPoolManager manager) internal override returns (Router) {
        return new DataRouter(authority, graph, manager);
    }
}

contract ProgrammableMultiRoleDataPolicyV1Test is Test {
    bytes32 private constant TRANSFER_TOPIC = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef;
    RouterV2DataPolicyScanHarness private scanner;
    RouterV2OpcodeScanHarness private legacy;

    function setUp() public {
        address authority = address(new RouterV2TestAuthority());
        IGraph graph = IGraph(address(new Graph()));
        IPoolManager manager = IPoolManager(address(new PoolManager(address(this))));
        scanner = new RouterV2DataPolicyScanHarness(authority, graph, manager);
        legacy = new RouterV2OpcodeScanHarness(authority, graph, manager);
    }

    function test_policyIdentityAndLegacySemanticsStayDistinct() public {
        assertEq(scanner.runtimeInstructionPolicy(), keccak256("programmable.runtime-instructions.reachable.v1"));
        scanner.validateRuntimeOpcodes(0, hex"00f2");
        vm.expectRevert(abi.encodeWithSelector(Router.ForbiddenRuntimeOpcode.selector, 0, 1, uint8(0xf2)));
        legacy.validateRuntimeOpcodes(0, hex"00f2");
        (bool ok,) = address(legacy).staticcall(abi.encodeWithSelector(DataRouter.runtimeInstructionPolicy.selector));
        assertFalse(ok, "legacy does not advertise the successor policy");
    }

    function test_sharedBackendVectors() public view {
        string memory vectors = vm.readFile("spec/runtime-instruction-policy/reachable-v1-vectors.json");
        assertEq(vm.parseJsonString(vectors, ".policy"), "programmable.runtime-instructions.reachable.v1");
        uint256 count = vm.parseJsonUint(vectors, ".vectorCount");
        assertEq(count, 28);
        for (uint256 index; index < count; ++index) {
            string memory path = string.concat(".vectors[", vm.toString(index), "]");
            string memory id = vm.parseJsonString(vectors, string.concat(path, ".id"));
            bytes memory runtimeCode = vm.parseJsonBytes(vectors, string.concat(path, ".runtime"));
            (bool ok, bytes memory result) =
                address(scanner).staticcall(abi.encodeCall(scanner.validateRuntimeOpcodes, (index, runtimeCode)));
            assertEq(ok, vm.parseJsonBool(vectors, string.concat(path, ".accepted")), id);
            if (!ok) {
                if (runtimeCode.length != 0 && runtimeCode[0] == 0xef) {
                    assertEq(vm.parseJsonString(vectors, string.concat(path, ".error")), "unsupported_runtime_mode");
                    assertEq(result, abi.encodeWithSelector(DataRouter.UnsupportedRuntimeMode.selector, index), id);
                    continue;
                }
                assertEq(
                    result,
                    abi.encodeWithSelector(
                        Router.ForbiddenRuntimeOpcode.selector,
                        index,
                        vm.parseJsonUint(vectors, string.concat(path, ".pc")),
                        uint8(vm.parseJsonUint(vectors, string.concat(path, ".opcode")))
                    ),
                    id
                );
            }
        }
    }

    function test_compilerTransferDataCanBeReadWithoutExecutingIt() public {
        bytes memory runtimeCode = _compilerTransferData();
        scanner.validateRuntimeOpcodes(0, runtimeCode);
        vm.etch(address(0xBEEF), runtimeCode);
        (bool ok, bytes memory result) = address(0xBEEF).staticcall("");
        assertTrue(ok);
        assertEq(abi.decode(result, (bytes32)), TRANSFER_TOPIC);
        vm.expectRevert(abi.encodeWithSelector(Router.ForbiddenRuntimeOpcode.selector, 0, 12, uint8(0xf2)));
        legacy.validateRuntimeOpcodes(0, runtimeCode);
    }

    function test_callcodeCanExecuteAfterInvalidAndMustRemainRejected() public {
        bytes memory runtimeCode = hex"600456fe5b5f5f5f5f5f6112345af250602a5f5260205ff3";
        vm.etch(address(0xBEEF), runtimeCode);
        (bool ok, bytes memory result) = address(0xBEEF).call("");
        assertTrue(ok);
        assertEq(abi.decode(result, (uint256)), 42);
        vm.expectRevert(abi.encodeWithSelector(Router.ForbiddenRuntimeOpcode.selector, 9, 14, uint8(0xf2)));
        scanner.validateRuntimeOpcodes(9, runtimeCode);
    }

    function test_calldataSelectedDynamicJumpAfterReturnRemainsRejected() public {
        // The caller chooses PC 5. The RETURN at PC 3 is bypassed by JUMP at PC 2.
        bytes memory runtimeCode = hex"5f3556f3005b5f5f5f5f5f6112345af250602a5f5260205ff3";
        vm.etch(address(0xBEEF), runtimeCode);
        (bool ok, bytes memory result) = address(0xBEEF).call(abi.encode(uint256(5)));
        assertTrue(ok);
        assertEq(abi.decode(result, (uint256)), 42);
        vm.expectRevert(abi.encodeWithSelector(Router.ForbiddenRuntimeOpcode.selector, 0, 15, uint8(0xf2)));
        scanner.validateRuntimeOpcodes(0, runtimeCode);
    }

    function test_jumpIntoDeadPushDataStillFailsEvmValidation() public {
        bytes memory runtimeCode = hex"60055600605bf4";
        scanner.validateRuntimeOpcodes(0, runtimeCode);
        vm.etch(address(0xBEEF), runtimeCode);
        (bool ok,) = address(0xBEEF).call{ gas: 100_000 }("");
        assertFalse(ok, "PC 5 is PUSH data, not a valid destination");
    }

    function test_everyHaltResumesAtEveryValidJumpdest() public {
        bytes memory terminals = hex"0056f3fdfe";
        bytes memory forbidden = hex"f2f4ff";
        for (uint256 terminal; terminal < terminals.length; ++terminal) {
            for (uint256 opcode; opcode < forbidden.length; ++opcode) {
                bytes memory runtimeCode =
                    abi.encodePacked(terminals[terminal], forbidden[opcode], hex"5b", forbidden[opcode]);
                vm.expectRevert(
                    abi.encodeWithSelector(
                        Router.ForbiddenRuntimeOpcode.selector, terminal, 3, uint8(forbidden[opcode])
                    )
                );
                scanner.validateRuntimeOpcodes(terminal, runtimeCode);
            }
        }
    }

    function test_everyPushWidthPreservesDeadDataAndFollowingJumpdest() public {
        for (uint256 width = 1; width <= 32; ++width) {
            bytes memory data = new bytes(width);
            for (uint256 index; index < width; ++index) {
                data[index] = index % 2 == 0 ? bytes1(0x5b) : bytes1(0xf4);
            }
            bytes memory dead = abi.encodePacked(hex"00", bytes1(uint8(0x5f + width)), data, hex"f2f4ff");
            scanner.validateRuntimeOpcodes(0, dead);
            vm.expectRevert(
                abi.encodeWithSelector(Router.ForbiddenRuntimeOpcode.selector, width, dead.length + 1, uint8(0xf2))
            );
            scanner.validateRuntimeOpcodes(width, abi.encodePacked(dead, hex"5bf2"));
        }
    }

    function test_everyLivePushWidthCannotHideTheFollowingForbiddenInstruction() public {
        for (uint256 width = 1; width <= 32; ++width) {
            bytes memory data = new bytes(width);
            for (uint256 index; index < width; ++index) {
                data[index] = index % 2 == 0 ? bytes1(0x00) : bytes1(0xfe);
            }
            bytes memory runtimeCode = abi.encodePacked(bytes1(uint8(0x5f + width)), data, hex"f4");
            vm.expectRevert(abi.encodeWithSelector(Router.ForbiddenRuntimeOpcode.selector, 0, width + 1, uint8(0xf4)));
            scanner.validateRuntimeOpcodes(0, runtimeCode);
        }
    }

    function test_metadataIsNotSpecialAndJumpdestWithinItRemainsAnEntry() public {
        // CBOR-like length/data suffixes confer no authority to hide executable bytes.
        scanner.validateRuntimeOpcodes(0, hex"fea1646970667344f2f4ff00000b");
        vm.expectRevert(abi.encodeWithSelector(Router.ForbiddenRuntimeOpcode.selector, 0, 3, uint8(0xf4)));
        scanner.validateRuntimeOpcodes(0, hex"fea15bf40003");
        vm.expectRevert(abi.encodeWithSelector(Router.ForbiddenRuntimeOpcode.selector, 0, 1, uint8(0xf2)));
        scanner.validateRuntimeOpcodes(0, abi.encodePacked(TRANSFER_TOPIC));
    }

    function test_runtimeAtExactEip170LimitPreservesLastJumpdest() public {
        bytes memory runtimeCode = new bytes(24_576);
        runtimeCode[0] = 0x00;
        for (uint256 index = 1; index < runtimeCode.length; ++index) {
            runtimeCode[index] = 0xf2;
        }
        scanner.validateRuntimeOpcodes(15, runtimeCode);
        // Deploy exactly the EIP-170 limit with CREATE, not an oversized vm.etch-only fixture.
        bytes memory initCode = abi.encodePacked(hex"61600080600a3d393df3", runtimeCode);
        address deployed;
        assembly ("memory-safe") {
            deployed := create(0, add(initCode, 0x20), mload(initCode))
        }
        assertNotEq(deployed, address(0));
        assertEq(deployed.code.length, 24_576);
        assertEq(deployed.codehash, keccak256(runtimeCode));
        runtimeCode[24_574] = 0x5b;
        vm.expectRevert(abi.encodeWithSelector(Router.ForbiddenRuntimeOpcode.selector, 15, 24_575, uint8(0xf2)));
        scanner.validateRuntimeOpcodes(15, runtimeCode);
    }

    function testFuzz_noForbiddenInstructionOnAnyEntryPath(bytes memory runtimeCode) public view {
        // Independent two-pass oracle: first enumerate all valid entries, then walk each entry's
        // sequential path separately. It intentionally never uses the production active-region flag.
        vm.assume(runtimeCode.length <= 512);
        if (runtimeCode.length != 0 && runtimeCode[0] == 0xef) {
            (bool accepted, bytes memory rejection) =
                address(scanner).staticcall(abi.encodeCall(scanner.validateRuntimeOpcodes, (11, runtimeCode)));
            assertFalse(accepted);
            assertEq(rejection, abi.encodeWithSelector(DataRouter.UnsupportedRuntimeMode.selector, 11));
            return;
        }
        uint256 firstForbidden = type(uint256).max;
        for (uint256 entry; entry < runtimeCode.length;) {
            if (entry == 0 || runtimeCode[entry] == 0x5b) {
                uint256 pc = entry;
                while (pc < runtimeCode.length) {
                    uint8 opcode = uint8(runtimeCode[pc]);
                    if (opcode == 0xf2 || opcode == 0xf4 || opcode == 0xff) {
                        if (pc < firstForbidden) firstForbidden = pc;
                        break;
                    }
                    if (opcode == 0x00 || opcode == 0x56 || opcode == 0xf3 || opcode == 0xfd || opcode == 0xfe) break;
                    pc += opcode >= 0x60 && opcode <= 0x7f ? uint256(opcode) - 0x5e : 1;
                }
            }
            uint8 entryOpcode = uint8(runtimeCode[entry]);
            entry += entryOpcode >= 0x60 && entryOpcode <= 0x7f ? uint256(entryOpcode) - 0x5e : 1;
        }
        (bool ok, bytes memory result) =
            address(scanner).staticcall(abi.encodeCall(scanner.validateRuntimeOpcodes, (11, runtimeCode)));
        assertEq(ok, firstForbidden == type(uint256).max);
        if (!ok) {
            assertEq(
                result,
                abi.encodeWithSelector(
                    Router.ForbiddenRuntimeOpcode.selector, 11, firstForbidden, uint8(runtimeCode[firstForbidden])
                )
            );
        }
    }

    function _compilerTransferData() private pure returns (bytes memory) {
        return hex"6020600b5f3960205ff3feddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    }
}
