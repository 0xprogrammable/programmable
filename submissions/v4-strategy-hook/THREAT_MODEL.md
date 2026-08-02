# Threat model

## Protected properties

- Only PoolManager enters callbacks and unlock callback.
- Only the exact canonical PoolKey accrues liabilities.
- Every successful canonical swap charges the inclusive Programmable policy in native ETH.
- Platform, creator and strategy liabilities sum exactly to total native liabilities and remain backed by hook-owned
  PoolManager claims.
- No party can claim, redirect or spend another party's liability.
- Strategy execution cannot change target, input liability, output recipient, oracle bounds or route.
- Purchased output is burned exactly and no purchased target balance remains.
- Failed execution restores every state write and remains retryable.

## Trust and authority

| Actor | Capability | Explicit limit |
| --- | --- | --- |
| Creator | Initialize canonical pool; claim creator liability | Exact PoolKey, once; payout only to immutable creator |
| Programmable owner | Claim platform liability to per-call destination | Cannot claim creator or strategy value; cannot change stored config |
| Any address | Deploy, record observations, execute strategy | No caller-controlled amount, target, recipient, `minOut` or price limit |
| PoolManager | Invoke callbacks and hold claims | Exact immutable dependency; failure reverts actions |
| Optional keeper | Call the same two permissionless methods | No role, allowance, custody or protocol key |

There is no hook owner, upgrade admin, pause guardian, rescue role, sweep, delegatecall or arbitrary-call path.

## Primary threats

### Fee bypass or wrong quadrant

Alternative pools do not inherit canonical behavior. On the canonical PoolKey, quadrant-dependent before/after deltas
charge native ETH whether it is specified or unspecified. Specified-native partial fills revert because a before-delta
cannot safely refund after execution. Tests exercise all four successful modes and exact liability backing.

### PoolManager delta or ERC-6909 insolvency

Each fee mints the exact native claim credited to liabilities. Claims and strategy execution decrement effects before
unlock and burn only hook-owned claims. Any unlock failure reverts. Mixed-swap invariants compare total liabilities to
PoolManager claim balance after every sequence.

### Oracle manipulation

An attacker may manipulate target-pool spot price or strategically time observations. The contract requires a complete
sampled window, bounded observation gaps, maximum spot/TWAP deviation, TWAP-derived minimum output, and a separate
spot-based price-impact limit. Same-transaction spot manipulation cannot rewrite historical cumulative time. Residual
risk depends on target liquidity, observation cadence and strategy value; independent economic review is mandatory.

### MEV and sandwiching

Execution is public and predictable. A searcher can reorder around it, but output must satisfy internal TWAP/slippage
and impact bounds. The caller cannot weaken those values. Execution may revert under adverse conditions and retry later.
Private relay use is an optional operator decision, not a security dependency.

### Malicious or non-standard target token

False/no-return transfers use SafeERC20. Fee-on-transfer, rebasing, blacklist, callback or malformed balance behavior is
not supported. Exact hook and dead-address balance deltas must match the purchased amount or the whole strategy reverts.
Target-token selection therefore requires contract-behavior review.

### Keeper compromise or downtime

The keeper key holds gas only and has no role. Compromise can waste its gas or front-run a public call but cannot redirect
value. Downtime can make observations stale and delay execution; any other address can restore observations and execute.

### Forced ETH or token donation

Raw balances are never used as liability truth. Direct target-token donations create no liability and cannot be swept;
they remain stranded. Native ETH reception is accepted only from PoolManager.

### Reentrancy and external failure

Claims and execution use transient reentrancy protection and checks-effects-interactions. The target pool's own hook may
execute during the cross-pool swap; any unexpected callback or failure reverts the full unlock. The strategy cannot call
its canonical pool, and the target hook cannot equal this hook.

## Remaining review requirements

- Independent high-risk return-delta and ERC-6909 accounting review
- Oracle and MEV economic analysis under realistic target liquidity
- Adversarial target-token and target-hook tests
- Pinned Ethereum fork lifecycle plus current-head smoke test
- Static analysis with model-owned finding dispositions
- Deployment, runtime, source, lifecycle and monitoring evidence after separately authorized execution
