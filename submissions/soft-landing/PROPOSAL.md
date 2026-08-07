# Proposal

**Stage:** prototype  
**Application id:** `soft-landing`  
**One-line outcome:** a temporary Uniswap v4 launch controller gives every swap in one direction and block the same LP fee, then adjusts only the following block from completed directional quote flow.

## Semantic consistency

This proposal, `submission.json`, `MECHANISM.md`, `SECURITY.md`, and the tests describe the same mechanism: one immutable custom hook, one canonical dynamic-fee PoolKey, independent buy/sell controllers, executed gross quote as the signal, a one-block lag, constant-time decay, irreversible expiry, and Programmable fee policy `programmable-volume-fee-v1@1.1.0`. The project selects no project hook fee. LP fees go to LPs; the mandatory 10 bps quote-volume liability belongs only to the immutable Programmable owner.

## Why Uniswap v4

`hook.used` is true. v4 is necessary because the mechanism must atomically choose a directional LP-fee override before each swap, observe the executed result after it, and collect the mandatory quote-volume fee with return deltas. A router-only design could be bypassed and could not guarantee one canonical-pool accounting path. The policy is integrated into the single custom hook rather than a second hook.

The source is `src/SoftLandingHook.sol`, controller math is `src/lib/FlowFeeMath.sol`, atomic CREATE2 deployment is `src/SoftLandingHookFactory.sol`, and the autonomous launch plan is `spec/soft-landing.json`. The repository also contains a local, non-transactional mechanism demo; there is no production app, API, service, keeper, oracle, or project indexer.

## Design card

| Item | Confirmed design |
| --- | --- |
| Outcome | Sustained directional launch congestion raises only the next block's LP fee; calm flow decays it toward base. |
| Pool | One atomically registered dynamic-fee PoolKey; alternative pools are outside policy coverage. |
| During a trade | `beforeSwap` returns a block-stable directional override; `afterSwap` records executed gross quote for the next block. |
| Value | LP fees remain in the pool for LPs. The hook holds quote-denominated PoolManager claims backing the 10 bps Programmable liability. Project fee is zero. |
| Creator choices | Base, initial buy/sell, maximum, rise, decay, target quote flow, excess cap, warmup length, currencies, tick spacing, and initial price, all fixed at deployment. |
| Fixed rules | Maximum LP fee 300 bps; 10 bps Programmable minimum; fixed owner; one pool; no mutable parameter, pause, upgrade, rescue, or redirect. |
| Authorities | PoolManager alone calls callbacks. The factory only deploys/registers. The launcher permanently owns the initial position without an exit. The immutable Programmable owner alone claims its separate liability. |
| Dependencies | Ethereum Uniswap v4 PoolManager plus pinned OpenZeppelin and Uniswap source packages. No oracle or offchain liveness dependency. |
| Failure | Wrong caller/pool, dust, arithmetic, unsupported partial fill, or settlement mismatch reverts atomically. Expiry fixes both fees at base forever. |
| Surfaces | Solidity contracts, Foundry tests, deterministic JavaScript simulation, and evidence documents only. |
| Not used | Transfer tax, creator claim, project hook charge, hook liquidity callbacks, donation callbacks, wallet scoring, oracle, keeper, app, API, or mutable administration. |

## Lifecycle

1. The graph deploys the permissionless factory, then the immutable PoolManager/factory-bound launcher.
2. The launch compiler derives the fixed-supply token CREATE2 identity, mines the exact hook salt/address for mask `0x20cc`, derives the complete dynamic-fee PoolKey and PoolId, and binds all identities into one deadline-limited request.
3. The launcher mints the fixed 1-billion-token supply to itself, calls the factory to deploy and initialize the exact hook/pool, then opens one PoolManager unlock.
4. That unlock adds liquidity `36856093846670599562186` over `[-887220, 204180]`, committing `999999999999999999999974211` token units to the direct position permanently owned by the launcher. No removal, transfer, approval, rescue, sweep, arbitrary call, upgrade, or LP-fee claim path exists.
5. The same unlock executes the exact 0.001 ETH initial buy, settles the combined native/token deltas, and transfers only the bought output to the launch wallet. Exactly 25,789 wei-token of rounding dust remains unreachable. Any failure rolls back token, hook, pool, position, and buy.
6. The initial buy starts the warmup. Every later swap in the same direction and block gets the same LP fee.
7. On the first swap of a later block, the hook applies the completed block once and decays any skipped empty blocks in constant time. The current swap cannot affect its own fee.
8. Every successful swap accrues 10 bps of executed gross quote, using a persistent lifetime remainder, as an ERC-6909-backed liability.
9. The fixed Programmable owner may claim anytime to a nonzero destination supplied for that claim. Claims do not reset the rounding remainder.
10. At the exclusive end block, both directional fees become base permanently and flow writes stop. Swaps and the mandatory 10 bps accounting continue.

The initial launcher-owned position is intentionally permanent. Later independent LP positions use ordinary v4 exit
semantics. Donations, payout mutation, migration, and administrative retirement introduce no custom hook action.

## Controller examples

With base 30 bps, initial 100 bps, maximum 300 bps, target 10 ETH/block, rise 50 bps at 2x target, and decay 25 bps at zero:

- 10 ETH completed flow leaves the next fee at 100 bps.
- 20 ETH raises it to 150 bps.
- 25 ETH raises it to 175 bps.
- 2 ETH lowers it to 80 bps.
- Zero flow lowers it to 75 bps.
- Three empty blocks from 175 bps decay directly to 100 bps.
- Counted excess and the final fee clamp at immutable caps.

Buys and sells maintain separate flow and fee state. Flow from block N affects N+1, never N.

## Fees, rounding, and four quadrants

The policy split is non-additive:

- `0 selected -> 10 bps Programmable + 0 project`.
- `3% selected -> 0.1% Programmable + 2.9% project`, never 3.1%.

This project selects zero, so its effective hook-owned charge is exactly 10 bps to Programmable and zero to the project. The basis is executed gross quote-side volume:

| Mode | Quote position | Collection |
| --- | --- | --- |
| buy exact input | specified input | collect before swap; verify full specified-quote execution after swap |
| buy exact output | unspecified input | derive executed gross quote input from `BalanceDelta` and collect after swap |
| sell exact input | unspecified output | derive executed gross quote output from `BalanceDelta` and collect after swap |
| sell exact output | specified output | bounded gross-up before swap; verify specified quote after swap |

For gross quote 100,000 smallest units, 10 bps accrues 100 units. For two accepted swaps of 1,500 units, cumulative accounting is `floor(3,000 * 1,000 / 1,000,000) = 3`, rather than losing both fractional contributions. Positive gross quote below 1,000 units reverts. Specified-quote partial fills revert, rolling back controller and liability writes. At all times:

`PoolManager quote claim balance = totalQuoteFeesAccrued = liability(poolId, quote, Programmable owner)`.

Only `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` may claim. There is no builder, creator, project, admin, rescue, sweep, stored recipient, owner mutation, or cross-pool netting path.

## Product integration boundary

| Surface | Plan and source of truth | Failure boundary |
| --- | --- | --- |
| UI / app / API | A local mechanism demo is included; any transaction-capable Programmable integration must be separately accepted and version-bound. | No availability claim. |
| Service / keeper / oracle | Not used; controller advances lazily from block number and onchain flow. | RPC failure affects callers, not controller correctness. |
| Indexer | Proposed future product integration using hook events plus confirmed chain reads. | Reorg/backfill/freshness review remains open. |
| Quote | Proposed v4 Quoter integration against the exact PoolKey and block tag; empty `hookData`. | Quote/execution drift and unsupported partial fills must be surfaced. |
| Trade | Proposed v4 router actions with ordinary slippage, deadline, Permit2/native refund handling. | Router compatibility and receipt parity remain open gates. |
| Claim | Direct owner-only contract call; a future UI may preview the exact onchain liability. | Zero/bad recipient and unauthorized caller revert. |
| Monitoring | Proposed event/state checks for fee bounds, expiry, liabilities, claim backing, and runtime identity. | No production operator or runbook exists yet. |

Hooklist, routing, discovery, deployment, and Programmable product availability are separate external decisions. This prototype claims none of them.

## Comparison

Unlike a volatility fee, Soft Landing does not depend on price movement or an oracle-like volatility estimate. Unlike a per-transaction toll, it does not give different same-block traders different adaptive rates. It prices sustained directional throughput with a transparent one-block lag. That stability is also its main limitation: a packed first-block bundle sees only the immutable initial fee.

## Status and limits

Local implementation and closure are complete, but novel-controller architecture review, return-delta specialist review, independent security/economic review, fork/router parity, deployment/source verification, product integration, routing, and availability remain outside contributor authority. The hook is not audited or deployed.
