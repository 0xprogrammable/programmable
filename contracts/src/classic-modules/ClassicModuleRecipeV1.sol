// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ClassicModuleTypes as T } from "./ClassicModuleTypes.sol";

/// @notice The exact wire commitment used by the hook and independent SDK/indexer implementations.
library ClassicModuleRecipeV1 {
    function snapshotHash(T.ModuleSnapshot memory snapshot) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                snapshot.versionId,
                snapshot.familyId,
                snapshot.implementation,
                snapshot.codeHash,
                snapshot.kind,
                keccak256(snapshot.config)
            )
        );
    }

    function recipeHash(
        uint256 chainId,
        address hook,
        address registry,
        uint16 buyFee,
        uint16 sellFee,
        bytes32[] memory items
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(T.RECIPE_DOMAIN, chainId, hook, registry, buyFee, sellFee, items));
    }
}
