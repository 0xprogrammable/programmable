// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ClassicModuleTypes as T } from "./ClassicModuleTypes.sol";

/// @notice Modules are reviewed, immutable, stateless effect providers. No custody or delegatecall is granted.
interface IClassicModuleV1 {
    function moduleKind() external pure returns (uint8);
    function validateConfig(bytes calldata config, uint16 baseBuyFeeBps, uint16 baseSellFeeBps)
        external
        view
        returns (bool);
    function evaluate(T.Context calldata context, bytes calldata config) external view returns (T.Effect memory);
}
