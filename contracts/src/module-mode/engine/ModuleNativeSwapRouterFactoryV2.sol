// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { ModuleNativeHookV2 } from "./ModuleNativeHookV2.sol";
import { ModuleNativeSwapRouterV2 } from "./ModuleNativeSwapRouterV2.sol";

/// @notice Fixed router construction, separated to keep launcher initcode below EIP-3860.
/// @dev The launch source binds this factory's reviewed deployed code hash in its constructor/release manifest.
contract ModuleNativeSwapRouterFactoryV2 {
    bytes32 public constant SALT_DOMAIN = keccak256("programmable.module-mode.native-router.v2");
    mapping(address source => ModuleNativeSwapRouterV2) public routerOf;
    error RouterAlreadyCreated();

    function create(IPoolManager manager, ModuleNativeHookV2 hook) external returns (ModuleNativeSwapRouterV2 router) {
        if (address(routerOf[msg.sender]) != address(0)) revert RouterAlreadyCreated();
        router =
            new ModuleNativeSwapRouterV2{ salt: deploymentSalt(msg.sender, manager, hook) }(manager, hook, msg.sender);
        routerOf[msg.sender] = router;
    }

    function predict(address source, IPoolManager manager, ModuleNativeHookV2 hook) external view returns (address) {
        return Create2.computeAddress(
            deploymentSalt(source, manager, hook),
            keccak256(abi.encodePacked(type(ModuleNativeSwapRouterV2).creationCode, abi.encode(manager, hook, source)))
        );
    }

    function deploymentSalt(address source, IPoolManager manager, ModuleNativeHookV2 hook)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(SALT_DOMAIN, source, manager, hook));
    }
}
