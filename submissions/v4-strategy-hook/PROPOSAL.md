# Proposal

**Submission stage:** Prototype
**Model id:** `v4-strategy-hook`

V4 Strategy Hook lets a Programmable creator configure one canonical ETH launch pool whose quote-side fees are split
between the required Programmable allocation, an immutable creator claim, and a permissionless buyback-and-burn strategy.

## Design card

| Item | Confirmed design |
| --- | --- |
| Outcome | Launch-time-configurable fee capture funds transparent creator claims plus recurring buyback/burn of one target token. |
| Pool | One hook instance is bound to one native-ETH/launched-token PoolKey; the strategy uses a different native-ETH/target-token PoolKey. |
| During a trade | All four direction/exactness modes pay one inclusive quote-side hook fee; specified-native partial fills revert and unspecified-native fees use actual execution. |
| Value | 10 bps belongs to Programmable; creator and strategy split only the project remainder; strategy output always goes to the dead address. |
| Creator choices | Token, creator, buy/sell totals, project split, both pool shapes, threshold, cooldown, TWAP cadence/window, slippage, deviation and impact bounds. |
| Fixed platform rules | Inclusive 10 bps Programmable allocation, its immutable owner, one canonical pool, no same-pool strategy swap, and exact liability isolation. |
| Authorities | Creator initializes once and claims only creator fees; Programmable owner claims only platform fees; every address may observe and execute strategy. |
| Dependencies | Pinned v4-core, v4-periphery, OpenZeppelin Uniswap Hooks, OpenZeppelin Contracts, Forge Standard Library and Solmate. |
| Failure | Invalid callbacks and all strategy failures revert atomically; stale oracle history blocks execution but leaves the strategy liability retryable. |
| Project surfaces | Hook, CREATE2 factory, local tests, optional unprivileged Viem keeper, event-based monitoring specification. |
| Product surfaces | Programmable integration is intended but unrequested; no current routing, listing, deployment or availability claim. |
| Not used | Upgrade, pause, rescue, sweep, arbitrary call, signatures, permissioned assets, cross-chain messages, custom curve, async swap, external vault custody. |

## Why v4

The product requires one atomic hook to enforce quote-side fees in every swap quadrant, retain backed PoolManager claims,
and later consume the strategy liability through a separate v4 pool. A router, token transfer tax or LP fee cannot
enforce the same canonical-pool accounting. The custom hook integrates the mandatory Programmable fee rather than
stacking a second hook.

## Lifecycle

1. A standard fixed-supply token is created through an independently reviewed Programmable launch flow.
2. The target pool must already exist and be initialized. A creator selects immutable configuration and a CREATE2 salt.
3. The permissionless factory deploys the one-pool hook; its address encodes permission mask `0x20cc`.
4. Only the immutable creator may initialize the exact canonical PoolKey.
5. Standard v4 liquidity management forms liquidity; this hook has no liquidity callbacks or position custody.
6. Canonical-pool swaps accrue three native-claim liabilities and emit `NativeFeesAccrued`.
7. Creator and Programmable claim their own liabilities independently.
8. Anyone records target-pool samples. Once threshold, cooldown and oracle checks pass, anyone calls
   `executeStrategy`; the hook buys exact-input target tokens and burns the exact output.
9. Dependency or target-token failure reverts atomically. No administrator can divert, sweep or rescue value.
10. Retirement has no special contract action: stop creating new pools, preserve claims, and publish the affected
    PoolKey. Immutable deployed instances cannot migrate themselves.

Donations and liquidity changes use ordinary PoolManager behavior and do not alter hook accounting. `hookData` is ignored.

## Fee example

For 1 ETH gross quote volume, a selected total of 1% and a 10% strategy share of the project remainder:

```text
0.0100 ETH total
0.0010 ETH Programmable
0.0009 ETH strategy
0.0081 ETH creator
```

Selected `0` becomes the 10 bps floor: 0.001 ETH Programmable and zero project fee. Selected `3%` remains 3%:
0.1% Programmable plus 2.9% project, never 3.1%.

Exact-output native fees first round gross native up, then partition the exact total. The creator receives project
rounding remainder so liabilities always conserve the charged amount.

## Integration plan

| Surface | State |
| --- | --- |
| UI | Proposed only: show immutable config, liability balances, oracle readiness, execution simulation and disclosures. |
| API/indexer | Proposed events-plus-confirmed-reads reconstruction with 12-block finality and reorg rollback. |
| Quote/trade | Standard v4 route is expected to encode empty hookData; return-delta routing still needs provider review. |
| Claim | Direct contract calls for immutable creator and Programmable owner; no third-party claim service. |
| Keeper | Optional gas-only process; dry-run by default, permissionless fallback always available. |
| Monitoring | Reconcile the three liability views with native ERC-6909 claims and alert on stale observations or failed execution. |

No public application source is included in this prototype. Programmable maintainers own any future registry, UI, API,
indexer and routing integration.

## Fact provenance

- **Builder-stated:** desired V4STR 10/90 strategy/creator project split; target V4 token; existing offchain automation;
  intent to submit to the Hookathon.
- **Agent-derived:** permission mask, fee equations, claim partitioning, TWAP and settlement architecture.
- **Evidence-backed:** 35 local test entries, 10,000 fee-conservation fuzz cases, 384,000 stateful invariant handler
  calls, 17 pinned/current-head Ethereum fork entries, exact runtime/initcode sizes, keeper and indexer tests, npm audit,
  compiler/source closure, and dispositioned Slither output.

## Semantic consistency statement

The design card, fee examples, value flows, permission mask, Solidity implementation, threat model and implemented test
names describe the same one-pool immutable architecture. The deterministic `PROTOTYPE_READY` result establishes only
structural readiness; the high-risk return-delta, oracle and external-liquidity meanings still require independent human
review and the remaining adversarial work listed in `TEST_PLAN.md`.

## Open decisions and gates

The architecture is frozen for the local prototype. Release remains blocked on independent return-delta/accounting,
oracle-economic and security review; deployed-hook runtime/configuration verification; routing-provider review;
production monitoring; and explicit deployment authority. No independent audit has been completed.
