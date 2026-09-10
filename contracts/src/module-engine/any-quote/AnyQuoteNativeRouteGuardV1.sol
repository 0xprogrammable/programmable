// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Stateless admission for the pinned Universal Router's native Any Quote launch commands.
/// @dev Holds no assets or approvals and has no administrator, callback, upgrade or execution entrypoint.
contract AnyQuoteNativeRouteGuardV1 {
    uint256 private constant MAX_OPERATIONS = 32;
    address private constant ROUTER_BALANCE = address(2);
    uint256 private constant CONTRACT_BALANCE = 1 << 255;

    error InvalidNativeRoute();

    /// @dev A bounded subset of Universal Router's AMM command language. No command may pull from the host,
    ///      install an approval, execute an arbitrary target or mask a failed subcommand.
    function routerCallData(bytes calldata data, address recipient, uint256 value, uint256 deadline)
        external
        pure
        returns (bytes memory)
    {
        (bytes memory commands, bytes[] memory inputs) = abi.decode(data, (bytes, bytes[]));
        _validate(commands, inputs, recipient, value);
        return abi.encodeWithSelector(bytes4(0x3593564c), commands, inputs, deadline);
    }

    function _validate(bytes memory commands, bytes[] memory inputs, address recipient, uint256 value) private pure {
        if (commands.length == 0 || commands.length > MAX_OPERATIONS || inputs.length != commands.length) {
            revert InvalidNativeRoute();
        }
        bool refundStarted;
        uint8 lastSwap;
        for (uint256 i; i < commands.length; ++i) {
            uint8 command = uint8(commands[i]);
            if (command == 0x0b) {
                (address to, uint256 amount) = abi.decode(inputs[i], (address, uint256));
                if (refundStarted || to != ROUTER_BALANCE || amount != (i == 0 ? value : CONTRACT_BALANCE)) {
                    revert InvalidNativeRoute();
                }
            } else if (command == 0x00) {
                (address to, uint256 amount,, bytes memory path, bool payerIsUser) =
                    abi.decode(inputs[i], (address, uint256, uint256, bytes, bool));
                if (
                    refundStarted || to != ROUTER_BALANCE || payerIsUser || amount != CONTRACT_BALANCE
                        || path.length < 43 || (path.length - 20) % 23 != 0
                ) revert InvalidNativeRoute();
                lastSwap = command;
            } else if (command == 0x08) {
                (address to, uint256 amount,, address[] memory path, bool payerIsUser) =
                    abi.decode(inputs[i], (address, uint256, uint256, address[], bool));
                if (
                    refundStarted || to != ROUTER_BALANCE || payerIsUser || amount != CONTRACT_BALANCE
                        || path.length < 2
                ) revert InvalidNativeRoute();
                lastSwap = command;
            } else if (command == 0x10) {
                if (refundStarted) revert InvalidNativeRoute();
                _validateV4Actions(inputs[i], recipient);
                lastSwap = command;
            } else if (command == 0x04) {
                (, address to,) = abi.decode(inputs[i], (address, address, uint256));
                if (to != recipient) revert InvalidNativeRoute();
                refundStarted = true;
            } else if (command == 0x0c) {
                (address to,) = abi.decode(inputs[i], (address, uint256));
                if (to == recipient) refundStarted = true;
                else if (to != ROUTER_BALANCE || refundStarted) revert InvalidNativeRoute();
            } else {
                revert InvalidNativeRoute();
            }
        }
        // The new coin is always the final V4 leg, after any external quote conversion.
        if (lastSwap != 0x10) revert InvalidNativeRoute();
    }

    function _validateV4Actions(bytes memory input, address recipient) private pure {
        (bytes memory actions, bytes[] memory parameters) = abi.decode(input, (bytes, bytes[]));
        if (actions.length == 0 || actions.length > MAX_OPERATIONS || parameters.length != actions.length) {
            revert InvalidNativeRoute();
        }
        bool swap;
        for (uint256 i; i < actions.length; ++i) {
            uint8 action = uint8(actions[i]);
            if (action == 0x06 || action == 0x07) {
                // The pinned router validates the exact-input swap tuple and settles all pool deltas.
                swap = true;
            } else if (action == 0x0b) {
                (,, bool payerIsUser) = abi.decode(parameters[i], (address, uint256, bool));
                if (payerIsUser) revert InvalidNativeRoute();
            } else if (action == 0x0e) {
                (, address to,) = abi.decode(parameters[i], (address, address, uint256));
                if (to != ROUTER_BALANCE && to != recipient) revert InvalidNativeRoute();
            } else {
                revert InvalidNativeRoute();
            }
        }
        if (!swap) revert InvalidNativeRoute();
    }
}
