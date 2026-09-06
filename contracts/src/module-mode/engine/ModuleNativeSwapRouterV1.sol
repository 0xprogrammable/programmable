// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { CurrencySettler } from "@openzeppelin/uniswap-hooks/src/utils/CurrencySettler.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { ModuleNativeHookV1 } from "./ModuleNativeHookV1.sol";
import { ModuleNativeEngineTypesV1 as E } from "./ModuleNativeEngineTypesV1.sol";

/// @notice Immutable authenticated route for one launch source. No arbitrary payer, Permit2 action or hookData input.
/// @dev Explicit token approvals are used for sells. Native proceeds and unused exact-output funding return after
///      PoolManager unlock completes. No external recipient is called in the hook/runtime callback itself.
contract ModuleNativeSwapRouterV1 is IUnlockCallback, ReentrancyGuardTransient {
    using Address for address payable;
    using CurrencySettler for Currency;
    using SafeCast for *;

    IPoolManager public immutable poolManager;
    ModuleNativeHookV1 public immutable hook;
    address public immutable source;
    bytes32 private _callbackHash;
    bool private _inCallback;

    struct Request {
        address token;
        bool isBuy;
        int256 amountSpecified;
        uint256 limit;
        address recipient;
        uint256 deadline;
        address actor;
        bool initial;
    }

    struct Callback {
        PoolKey key;
        SwapParams params;
        E.RouteContext route;
        uint256 limit;
    }

    error InvalidRequest();
    error UnauthorizedSource();
    error InvalidCallback();
    error InvalidSettlement();
    error SlippageExceeded(uint256 actual, uint256 limit);
    error UnauthorizedNativeSender();

    event NativeTradeCompleted(
        bytes32 indexed poolId,
        address indexed actor,
        address indexed recipient,
        bool isBuy,
        int256 amountSpecified,
        uint256 nativeAmount,
        uint256 tokenAmount
    );

    constructor(IPoolManager poolManager_, ModuleNativeHookV1 hook_, address source_) {
        if (
            address(poolManager_).code.length == 0 || address(hook_).code.length == 0 || source_ == address(0)
                || address(hook_.poolManager()) != address(poolManager_)
        ) revert InvalidRequest();
        poolManager = poolManager_;
        hook = hook_;
        source = source_;
    }

    /// @param amountSpecified Negative for exact input, positive for exact output, in the requested side's units.
    /// @param limit Minimum output for exact input; maximum input for exact output. Both must be nonzero.
    function swap(address token, bool isBuy, int256 amountSpecified, uint256 limit, address recipient, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 nativeAmount, uint256 tokenAmount)
    {
        return _execute(Request(token, isBuy, amountSpecified, limit, recipient, deadline, msg.sender, false));
    }

    function initialBuy(address token, address launchWallet, uint256 minimumTokenOut, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 tokenAmount)
    {
        if (msg.sender != source) revert UnauthorizedSource();
        (, tokenAmount) = _execute(
            Request(token, true, -msg.value.toInt256(), minimumTokenOut, launchWallet, deadline, launchWallet, true)
        );
    }

    function _execute(Request memory request) private returns (uint256 nativeAmount, uint256 tokenAmount) {
        if (
            request.recipient == address(0) || request.recipient == address(this)
                || request.recipient == address(poolManager) || request.actor == address(0)
                || request.amountSpecified == 0 || request.limit == 0 || request.deadline == 0
                || block.timestamp > request.deadline
        ) revert InvalidRequest();
        uint256 specified = _absolute(request.amountSpecified);
        uint256 funding = request.isBuy ? (request.amountSpecified < 0 ? specified : request.limit) : 0;
        if (msg.value != funding) revert InvalidRequest();
        uint256 residual = address(this).balance - msg.value;
        PoolKey memory key = PoolKey(Currency.wrap(address(0)), Currency.wrap(request.token), 0, 200, hook);
        bytes32 poolId = PoolId.unwrap(key.toId());
        if (hook.routerOf(poolId) != address(this)) revert InvalidRequest();
        uint64 sequence = hook.runtime().lastTradeSequence(hook.launchKeyOf(poolId)) + 1;
        if (request.initial != (sequence == 1)) revert InvalidRequest();
        Callback memory callback = Callback(
            key,
            SwapParams(
                request.isBuy,
                request.amountSpecified,
                request.isBuy ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            ),
            E.RouteContext(request.actor, request.actor, request.recipient, sequence, request.initial),
            request.limit
        );
        bytes memory data = abi.encode(callback);
        _callbackHash = keccak256(data);
        (nativeAmount, tokenAmount) = abi.decode(poolManager.unlock(data), (uint256, uint256));
        if (_callbackHash != bytes32(0) || _inCallback) revert InvalidCallback();
        if (request.isBuy) {
            if (nativeAmount > funding) revert InvalidSettlement();
            uint256 refund = funding - nativeAmount;
            if (refund != 0) payable(msg.sender).sendValue(refund);
        } else {
            payable(request.recipient).sendValue(nativeAmount);
        }
        if (address(this).balance != residual) revert InvalidSettlement();
        emit NativeTradeCompleted(
            poolId, request.actor, request.recipient, request.isBuy, request.amountSpecified, nativeAmount, tokenAmount
        );
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (
            msg.sender != address(poolManager) || _callbackHash == bytes32(0) || keccak256(data) != _callbackHash
                || _inCallback
        ) revert InvalidCallback();
        delete _callbackHash;
        _inCallback = true;
        Callback memory callback = abi.decode(data, (Callback));
        BalanceDelta delta = poolManager.swap(callback.key, callback.params, abi.encode(callback.route));
        bool isBuy = callback.params.zeroForOne;
        if (
            (isBuy && (delta.amount0() >= 0 || delta.amount1() <= 0))
                || (!isBuy && (delta.amount0() <= 0 || delta.amount1() >= 0))
        ) revert InvalidSettlement();
        uint256 nativeAmount = _absolute(delta.amount0());
        uint256 tokenAmount = _absolute(delta.amount1());
        uint256 input = isBuy ? nativeAmount : tokenAmount;
        uint256 output = isBuy ? tokenAmount : nativeAmount;
        if (callback.params.amountSpecified < 0) {
            if (input != _absolute(callback.params.amountSpecified)) revert InvalidSettlement();
            if (output < callback.limit) revert SlippageExceeded(output, callback.limit);
        } else {
            if (output != uint256(callback.params.amountSpecified)) revert InvalidSettlement();
            if (input > callback.limit) revert SlippageExceeded(input, callback.limit);
        }
        if (isBuy) {
            callback.key.currency0.settle(poolManager, address(this), nativeAmount, false);
            callback.key.currency1.take(poolManager, callback.route.recipient, tokenAmount, false);
        } else {
            callback.key.currency1.settle(poolManager, callback.route.payer, tokenAmount, false);
            callback.key.currency0.take(poolManager, address(this), nativeAmount, false);
        }
        _inCallback = false;
        return abi.encode(nativeAmount, tokenAmount);
    }

    function _absolute(int256 value) private pure returns (uint256) {
        return value >= 0 ? uint256(value) : uint256(-(value + 1)) + 1;
    }

    receive() external payable {
        if (msg.sender != address(poolManager) || !_inCallback) revert UnauthorizedNativeSender();
    }
}
