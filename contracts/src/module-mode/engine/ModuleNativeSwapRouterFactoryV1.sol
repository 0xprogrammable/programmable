// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { ModuleNativeHookV1 } from "./ModuleNativeHookV1.sol";
import { ModuleNativeSwapRouterV1 } from "./ModuleNativeSwapRouterV1.sol";

/// @notice Fixed router construction, separated to keep launcher initcode below EIP-3860.
/// @dev The launch source binds this factory's reviewed deployed code hash in its constructor/release manifest.
contract ModuleNativeSwapRouterFactoryV1 {
    bytes32 public constant SALT_DOMAIN = keccak256("programmable.module-mode.native-router.v1");
    mapping(address source => ModuleNativeSwapRouterV1) public routerOf;
    error RouterAlreadyCreated();

    function create(IPoolManager manager, ModuleNativeHookV1 hook) external returns (ModuleNativeSwapRouterV1 router) {
        if (address(routerOf[msg.sender]) != address(0)) revert RouterAlreadyCreated();
        router =
            new ModuleNativeSwapRouterV1{ salt: deploymentSalt(msg.sender, manager, hook) }(manager, hook, msg.sender);
        routerOf[msg.sender] = router;
    }

    function predict(address source, IPoolManager manager, ModuleNativeHookV1 hook) external view returns (address) {
        return Create2.computeAddress(
            deploymentSalt(source, manager, hook),
            keccak256(abi.encodePacked(type(ModuleNativeSwapRouterV1).creationCode, abi.encode(manager, hook, source)))
        );
    }

    function deploymentSalt(address source, IPoolManager manager, ModuleNativeHookV1 hook)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(SALT_DOMAIN, source, manager, hook));
    }
}
