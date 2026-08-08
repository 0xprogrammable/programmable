# Proposal

**Project:** Egregore

**Submission stage:** Proposal
**Model id:** `egregore`

Egregore is a Uniswap v4 launch surface: a presale funds a fixed-supply token, permanently seeds one canonical ETH/token
pool, and a single custom hook then taxes swaps and short-term LP exits to run a staking reward stream, a treasury
buyback-and-burn, and a stress-mode market-support mechanism.

## Design card

| Item | Confirmed design |
| --- | --- |
| Outcome | Contributors get a proportional claim on the launched EGR token once the soft-cap-gated presale finalizes; ongoing traders pay a hook-owned tax that funds staker rewards, a burn-and-treasury reserve, and a market-support buyback; LPs who exit within 7 days of opening a position pay a 300 bps exit tax. |
| Pool | currency0 = native ETH, currency1 = EGR (fixed 100,000,000 supply). One canonical PoolKey, registered once via `configurePool()`. Static 3000 (0.30%) LP fee. Alternative pools using the same hook address receive zero tax and zero effect. |
| During a trade | Buys: flat 5% tax. Sells: continuous 10%-20% anti-dump tax as price runs above a rolling snapshot. Egregore's own tax always lands on the swap's unspecified side (H-1 audit fix), so both exact-input and exact-output settle correctly on the real PoolManager. The mandatory 10 bps Programmable fee is separate and always denominated in ETH, taken in `beforeSwap` in the two quadrants where ETH is the specified currency. |
| Value | 5% builder/dev fee (hardcoded `DEV_FEE_RECIPIENT`), 10 bps mandatory Programmable fee (hardcoded `PROGRAMMABLE_FEE_RECIPIENT`), then 50/30/20 (normal) or 20/50/30 (stress) reward/reserve/market-support split of the remainder. Reserve flush burns 20%, routes 10% to LP incentives, pays 70% to the treasury recipient. Stress-mode support release buys EGR back through the pool and burns half. |
| Creator choices | Soft cap, hard cap, presale duration, guardian/treasuryRecipient/builderManager/securityRecipient addresses — all fixed at deploy time via the `EgregorePresale` constructor. |
| Fixed platform rules | Tax rates, split percentages, the 5% builder fee, the mandatory 10 bps Programmable fee, the 7-day LP-exit window, the unstake-tax decay schedule and the reservoir release rate are all compile-time constants with no setter. |
| Authorities | guardian (pause, auto-expires 7d), treasuryRecipient (two-step transferable; stress thresholds, LP-incentive recipient, buyback slippage bound), presale (one-shot setup), securityRecipient (one-time allocation). See `submission.json.authorities`. |
| Dependencies | Uniswap v4 PoolManager (onchain, canonical per-chain address enforced); OpenZeppelin, Uniswap v4-core/v4-periphery, solmate (build-time libraries). See `submission.json.dependencies`. |
| Failure | A revert during finalize() leaves contributions intact and opens the grace-period refund path. A reverted swap/LP-removal/buyback reverts the whole call atomically; no bucket is ever partially updated. |
| Project surfaces | One onchain project boundary (`EgregorePresale`, `EgregoreBootstrapper`, `EgregoreHookDeployer`, `EgregoreHook`, `EgregoreToken`), Solidity, no app/game/service/keeper/oracle/indexer built yet. |
| Product surfaces | None planned through Programmable; Egregore launches and operates entirely through its own contracts (`integration.platformHandoff.intended = false`). |
| Not used | ERC-6909 claims, cross-chain messaging, proof systems, external oracles, keepers, permissioned assets, async swaps, custom curves — none of these apply to this design. |

## Why Uniswap v4 and architecture choice

`hook.used = true`. Egregore needs a v4 hook because the flywheel requires atomic callback execution the token or a
router alone cannot provide: `afterSwap` charges a hook-owned tax on the unspecified side of every swap (buy vs sell,
exact-in vs exact-out); `afterRemoveLiquidity` charges a separate short-term LP-exit tax via return delta; `beforeSwap`
refreshes an anti-dump price snapshot and takes the mandatory quote-side fee in the two quadrants where ETH is the
specified currency; and the hook's own `unlockCallback` runs protocol-owned buybacks through the same PoolKey. None of
this is expressible as a plain ERC20 transfer tax or an external fee switch.

Egregore integrates the mandatory Programmable fee policy into this one custom hook rather than implementing the
separate standard fee-hook profile; see `programmableFee` below. All other
protocol logic (presale, token, staking, treasury, buyback) is contract-only; there is no app, game, service, keeper,
oracle or indexer surface in this proposal.

## Lifecycle

See `submission.json.launchLifecycle` for the full per-phase actor/value-flow/custody/failure/event breakdown of token
creation, pool initialization, liquidity formation, trading, fees and claims, and dependency failure. `initialTransaction`
and `retirement` are explicitly not applicable: there is no creator initial buy, and the hook/pool/staking loop is
intended to run indefinitely with no retirement path beyond the bounded guardian pause.

## Assets, pool behavior, optional callbacks, and integration

Two assets: native ETH (quote) and EGR (launched, fixed-supply, burnable via OpenZeppelin's ERC20Burnable). Canonical
PoolKey: `(ETH, EGR, 3000, 60, EgregoreHook)`, formed once at presale finalize by `EgregoreBootstrapper` seeding a
single full-range position from the raised ETH and a fixed 49,500,000 EGR allocation. No router is bundled; any
standard v4 router works. All four swap modes are supported. A caller-supplied `sqrtPriceLimitX96` can bind and produce
a partial fill; the mandatory fee is always charged on the amount actually executed, never on the amount requested.

`hook.used = true`. Permissions: `afterInitialize`, `beforeAddLiquidity`, `afterRemoveLiquidity`,
`afterRemoveLiquidityReturnDelta`, `beforeSwap`, `beforeSwapReturnDelta`, `afterSwap`, `afterSwapReturnDelta` are
enabled; every other flag is false, giving permission mask `0x19cd`. Because Uniswap v4 encodes those permissions in
the low 14 bits of the hook's own address and CREATE2 cannot be inverted, the salt is found by search —
`EgregoreHookDeployer` runs that search itself, in its own constructor, so the launch carries no off-chain parameter
and there is nothing to mismatch. Every callback authenticates `onlyPoolManager`; `configurePool`/`activate`
authenticate `onlyPresale`. The hook is
CREATE2-deployed once by `EgregoreHookDeployer` (a small factory owned by the presale, not a general registry) and
admits exactly one PoolKey for its lifetime. Return-delta shape: a `BeforeSwapDelta` whose specified component is a
single non-negative `int128` on the quote currency and whose unspecified component is always exactly zero; a single
non-negative `int128` against the unspecified currency for `afterSwap`; a `BalanceDelta` with up to two non-negative
components for `afterRemoveLiquidity`.

Uniswap v4 suppresses a hook's own callbacks entirely when that hook calls the PoolManager, so the protocol buyback
never reaches `beforeSwap` or `afterSwap`. That path is not exempt from the mandatory fee: `_executeBuyback` charges it
internally, exactly once, on the gross ETH the buyback moves.

## Product integration plan

Not planned. `integration.platformHandoff.intended = false`; Egregore does not request a Programmable registry, UI,
API, or indexer surface in this proposal. `routingAndDiscoverability.routingMode = not-planned`.

## Fees, recipients, and settlement

**Mandatory Programmable fee** (`programmableFee`): `effective = max(selected, 10 bps)`; Egregore's selected totals
(500 bps buy, 1000-2000 bps sell) are always far above the 10 bps floor, so `effective` always equals the selected
total and the split is `10 bps Programmable + (selected - 10 bps) project`, never additive.

Basis is the canonical fixed quote asset — always ETH (`currency0`) — in all four direction/exactness quadrants, via
the quadrant-dependent path the policy's own table prescribes for a `currency0` quote asset:

| Quadrant | Quote asset is | Path |
| --- | --- | --- |
| `zeroForOne` exact input | specified | `before-swap-return-delta` |
| `zeroForOne` exact output | unspecified | `after-swap-return-delta` |
| `oneForZero` exact input | unspecified | `after-swap-return-delta` |
| `oneForZero` exact output | specified | `before-swap-return-delta` |

Where ETH is the unspecified currency, the whole charge settles in `afterSwap` and the 10 bps is carved out of it.
Where ETH is the specified currency, an `afterSwap` delta cannot reach it, so `beforeSwap` removes the quote-side fee
up front and `afterSwap` then reconciles it against the amount the swap **actually executed**: the liability accrues
exactly 10 bps of executed gross ETH, and because execution can never exceed the request, any over-reserved remainder
is routed to the project rather than to the Programmable liability. Partial fills are therefore charged on executed
volume, never on requested volume. On those two quadrants the project's own share is taken on the EGR leg at
`selected - 10 bps`, which is what keeps the total non-additive.

Uniswap v4 skips a hook's own swap callbacks, so protocol-owned buybacks cannot be charged through the callback path.
`selfCallPolicy = same-pool-swap-fee-enforced-internally`: `_executeBuyback` reserves the fee before swapping, swaps
only the remainder, and accrues exactly 10 bps of the gross ETH the buyback moved — once, backed by ETH the hook
already holds.

Immutable owner and sole claim authority: `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`. Both `claimProgrammableFees()`
and `claimProgrammableFeesTo(recipient)` are restricted to that address; no other role, administrator or arbitrary
caller can trigger, sweep, redirect or mutate the liability, and neither entry point is gated on the hook being active
or unpaused, so the owner can claim at any time. Nothing stores a mutable recipient, so an owner-selected destination
applies to that one claim only. Accrued as a `claimable-liability` keyed by `(poolId, currency, owner)`, not
auto-transferred. The mandatory fee applies to swaps on the canonical pool; the LP-exit and unstake taxes are project
charges outside the policy's swap basis, and are not diverted into the Programmable liability.

**Egregore's own tax**: builder/dev 5% (hardcoded `DEV_FEE_RECIPIENT`, `flushBuilderFees()` permissionless), then the
remainder splits 50/30/20 (normal) or 20/50/30 (stress) into a staker reward pool, a reserve, and a market-support
bucket — all internal accounting buckets inside `EgregoreHook`, not separate contracts. See `submission.json.valueFlows`
for the exact settlement path of every value-moving action (presale contribute/claim/refund, swap-tax, lp-exit-tax,
unstake-tax, reward-claim, treasury-flush, programmable-fee-claim).

## Semantic examples

- Buy with an exact input of 1 ETH producing 100 EGR gross output, normal mode. ETH is the specified currency, so
  `beforeSwap` reserves 1 * 10/10000 = 0.001 ETH and the pool swaps the remaining 0.999 ETH. `afterSwap` measures the
  executed gross quote volume as 0.999 + 0.001 = 1 ETH, so exactly 0.001 ETH is owed and the whole reservation is the
  liability with nothing left over. The project's share is taken on the EGR leg at the reduced rate:
  100 * 490/10000 = 4.9 EGR, of which builder 0.245 EGR (5%), then 4.655 EGR splits 2.3275/1.3965/0.931 EGR
  (50/30/20 reward/reserve/support). Total charge is still 5% of the trade, split 0.1% Programmable + 4.9% project,
  never additive. Verified in `test/egregore.spec.js` and against the real PoolManager in `test/egregore.v4.spec.js`.
- Same buy, but requested as an exact output while a price limit binds so only 0.4 ETH of the input executes: the
  liability accrues 0.4 * 10/10000 = 0.00004 ETH, not 0.001 ETH. The difference between what was reserved and what is
  owed is routed to the project, never stranded and never over-charged to the Programmable owner. Verified by
  `charges the quote fee on executed volume, not requested, when an exact-input buy partially fills`.
- Buy with an exact output of EGR, or sell with an exact input of EGR: ETH is the unspecified currency, so there is no
  `beforeSwap` leg at all and the entire charge settles in `afterSwap`, with 10 bps of the executed ETH carved out of
  it before the builder/reward/reserve/support split runs.
- Sell pushing price 11%+ above the rolling snapshot: tax hits the 20% surge ceiling; below that, the curve is linear
  between 10% and 20%. Verified by `ramps the sell tax continuously between base and surge`.
- LP exit within 7 days of opening: 3% tax on both withdrawn currencies. LP exit after 7 days: 0% tax. Verified by
  `collects short-term LP exit tax only for recent LP positions`.
- Stress-mode support release: releases 25% of the support bucket per day, buys EGR back through the pool bounded by
  `maxBuybackSlippageBps`, burns 50% of the result, recycles 50% into the reward pool. A too-tight slippage bound
  (0 bps) correctly reverts the whole release and leaves every bucket untouched, verified against the real PoolManager
  in `reverts a protocol buyback when the slippage bound is too tight`.

## Fact provenance

- **Evidence-backed**: every specific bps value, function name, event name, split percentage, and test name in this
  proposal is taken directly from the reviewed source (`src/*.sol`) and the passing test suite
  (`test/egregore.spec.js`, `test/egregore.v4.spec.js`, `test/hook-planner.spec.js`), not inferred.
- **Agent-derived**: the `submission.json` structured fields (permission mask, return-delta quadrant mapping, risk
  dimensions, dependency closure) were derived from that same source by an AI-assisted process across two audit passes
  plus a dedicated review for this submission.
- **Builder-stated**: the deploy-time role addresses (guardian, treasuryRecipient, builderManager, securityRecipient)
  are placeholders selected at deployment; no specific production addresses are claimed live in this proposal.

## Resolved decisions

These were open questions in the first revision of this proposal. They are now settled in source and tests.

1. **Fee basis.** Egregore adopts the canonical fixed-quote-asset (always-ETH) basis, via the
   `beforeSwapReturnDelta` permission. The permission mask is now `0x19cd`, and the salt that lands the hook on a
   matching address is searched on-chain by `EgregoreHookDeployer` rather than supplied at deployment.
2. **LP-exit tax.** The mandatory fee applies to swaps on the canonical pool only. Removing liquidity is not a swap,
   so the short-term LP-exit tax stays a project charge and is never routed into the Programmable liability.
3. **Protocol-owned liquidity.** Permanent bootstrapper custody with no removal path is the intended design; the
   position is not withdrawable by any role, which is what makes the launch liquidity non-rugpullable.
4. **Monitoring and indexing.** All protocol state is reconstructable from emitted events alone
   (`dataReconstruction` in `submission.json` describes the intended events-only indexer). No indexer, keeper or
   off-chain service is part of this submission, and none is required for the contracts to function.

This is a public, non-confidential proposal. The skill and local checker do not prove that fees are collected live.
Acceptance, independent review, product integration, deployment, runtime matching, lifecycle evidence, monitoring,
routing, listing, scheduling and availability require separate evidence records.
