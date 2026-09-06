// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { ClassicModuleTypes as T } from "../../src/classic-modules/ClassicModuleTypes.sol";
import { ClassicModuleRecipeV1 as Recipe } from "../../src/classic-modules/ClassicModuleRecipeV1.sol";

contract ClassicModuleRecipeV1Test is Test {
    /// @dev Independently generated viem vector in packages/classic-modules/test/recipe-hash-vector-v1.json.
    function test_sdkWireVectorMatchesProductionHashFunctions() public pure {
        bytes32[] memory items = new bytes32[](2);
        items[0] = Recipe.snapshotHash(
            T.ModuleSnapshot(
                0xb3600c35c76782be158f8d2c4367bb64f86c181c501450c98e1301a27f1cf988,
                0x4db943621a67fa98df0f4c859e782a55a8bb58e9d890299db34d9802abf8ce21,
                address(bytes20(hex"a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2")),
                0x7385857ee013157695880179b9abfb302ee9abee89c94b68bc23d31e70802a28,
                2,
                abi.encode(uint256(1 ether), uint256(2 ether))
            )
        );
        items[1] = Recipe.snapshotHash(
            T.ModuleSnapshot(
                0xc6413dc6744db79b200698b78ccec4178a8d98b969e231788547c9f093727314,
                0xd57a0bbcf7fe6b0543604488ec8ba3bd02f046f373195790433c1f17698b938a,
                address(bytes20(hex"a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1")),
                0x1c325b876f81a240caa3edf349881ff622d045c1e9d1d73e22d8ac3a81ce7872,
                1,
                abi.encode(uint256(0), uint256(100), uint256(3600))
            )
        );
        assertEq(items[0], 0x6a94d966121065a881399dfdffb3d3d032a1b135539300c02f7ed07a2db48c49);
        assertEq(items[1], 0x47595befbeb5f31886b239a77b94dbe5b9c5c30e44308c67f160c84afa72633f);
        assertEq(
            Recipe.recipeHash(
                31_337,
                address(bytes20(hex"b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2")),
                address(bytes20(hex"b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1")),
                500,
                700,
                items
            ),
            0xa5d4695aee87647b7d17ba71d7e2718ad777ba2784c0cd5bc5cb691bc62e94c9
        );
    }
}
