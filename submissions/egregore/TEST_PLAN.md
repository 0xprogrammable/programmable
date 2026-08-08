# Test plan

**Project:** Egregore

This submission-scoped test plan summarizes the repository's own [`TEST_PLAN.md`](../../TEST_PLAN.md), which is the
canonical, more detailed version and is bound as evidence below.

## Universal prototype evidence

Run:

```bash
npm ci
npx hardhat test
```

Compiler: Solidity `0.8.26`, `viaIR: true`, optimizer `runs: 200`, EVM `cancun` (pinned in `hardhat.config.js`;
dependencies pinned in `package-lock.json`). Every declared onchain contract (`src/*.sol`), every authority, value
flow, configuration bound, state transition, event, failure and exit path this design actually introduces is covered
by the suite below. No app, game, service, keeper, oracle, or indexer surface exists in this proposal, so their
sections of the universal checklist are not applicable.

## Solidity contracts

**Result: 51 passing, 0 failing.**

- `test/egregore.spec.js` (34 tests) — unit/behavioral suite against `HookPoolManagerMock`: token supply, reward
  reservoir streaming and remainder carry-over, same-block exit blocking, decaying unstake-tax bands, lock-tier
  weighting and lock enforcement, buy/sell tax on all four swap quadrants (exact-in/out), continuous anti-dump curve,
  short-term LP-exit tax, unstake-tax routing, stress-mode entry and split, treasury-flush burn/LP-incentive/buyback,
  ETH-side stress buyback, builder-fee routing to the hardcoded `DEV_FEE_RECIPIENT`, the new mandatory-Programmable-fee
  carve-out and its owner-only claim/redirect authorization test, treasury handoff, guardian pause with
  auto-expiry, `emergencyUnstake` during pause, a dedicated reentrancy-guard test (`ReentrantFlushCaller`), and the
  full presale lifecycle (refunds, hard-cap excess refund, per-wallet cap, finalize-grace refunds, canonical
  PoolManager address checks, `onlyPresale` bootstrap, the documented malicious-PoolManager dev-mode risk, and two
  100-participant end-to-end lifecycle runs).
- `test/egregore.v4.spec.js` (14 tests) — **integration suite against the real, compiled `@uniswap/v4-core`
  PoolManager** (not a mock), via `src/test/V4RealImports.sol` and `PoolSwapTest`/`PoolModifyLiquidityTest`: presale
  bootstrap, buy/sell tax on exact-input and exact-output through the actual currency-delta invariant with a per-
  quadrant assertion that the mandatory fee is exactly 10 bps of the executed gross ETH, two partial-fill regressions
  driven by a binding `sqrtPriceLimitX96` read from the live pool price, short-term LP-exit tax via real
  `afterRemoveLiquidity` return delta, EGR+ETH reward streaming and claim, the stress-mode support buyback executed as
  a real pool swap with burn, a dedicated slippage-guard test (buyback reverts and leaves the reserve untouched when
  the bound is too tight), the reserve-flush buyback+burn through the real pool, a full buyback lifecycle proving the
  fee is charged internally exactly once and that every reported ETH liability is actually held, and an owner-only
  claim test that reverts four foreign callers across both entry points. This is the evidence that the hook's
  `take()`/return-delta accounting actually settles on-chain, not just against a mock.
- `test/hook-planner.spec.js` (3 tests) — predicts the nested presale/token/bootstrapper/hookDeployer CREATE
  addresses, verifies the finalize path deploys the hook at the predicted address with `validateHookAddress = true`,
  and asserts the on-chain salt search picked exactly the salt and address the off-chain mirror predicts, with the
  address carrying permission mask `0x19cd`.

Static analysis (Slither or equivalent) has not been run; `forge`/`cast`/`anvil` are not installed in this Hardhat
project, so Foundry-specific evidence (gas/size snapshots, fuzz/invariant harnesses in Foundry's own format) is not
available. This is recorded as a tooling gap, not a claim that the properties are untested — the equivalent behavior
is covered by the Hardhat/Mocha suite above, including invariant-style checks (solvency, reentrancy, slippage bound)
run against the real PoolManager.

## Custom hook (`hook.used = true`)

- Permission mask and CREATE2 salt: the deployer searches for the salt on-chain; `test/hook-planner.spec.js`
  reproduces the same search off-chain and asserts the contract's own result matches it exactly.
- PoolManager/PoolKey authentication, `onlyPoolManager`/`onlyPresale` gating: exercised implicitly by every test that
  calls hook functions from a non-authorized address and expects a revert (e.g. `rejects bootstrap calls from anyone
  but the presale`).
- Self-call handling: Uniswap v4 suppresses the hook's own callbacks, so a protocol buyback never appears as a taxed
  swap. It is not exempt from the mandatory fee — `_executeBuyback` charges it internally, proven by
  `charges the mandatory fee exactly once on a hook-initiated same-pool buyback`.
- All four swap quadrants (exact-input/output x buy/sell): covered by both `egregore.spec.js` and
  `egregore.v4.spec.js`.
- Ordered settlement, final-zero deltas: proven by the real-PoolManager suite, since a non-zero final delta would
  revert the whole swap under `PoolSwapTest`'s own delta assertions.
- No dynamic LP fee is used (static 3000 hundredths-of-bip); not applicable.
- Hook-owned charge collection path, liability keys, event, recipient shares, and duplicate/zero/failed-recipient
  behavior: see `hook.feeMechanism` in `submission.json` and the corresponding tests above (builder-fee flush,
  reward/reserve/support bucket assertions in every tax test).

## Mandatory Programmable fee

- `effective = max(selected, 10 bps)` with selected totals of 500/1000-2000 bps (always above the floor): implicitly
  proven by every tax test, since the carve-out is always `grossAmount * 10/10000`, strictly less than the collected
  tax at Egregore's rates. A dedicated below/at/above-floor sweep across selected totals of 0/5/10 bps is not present
  (Egregore's own rates never approach the floor), which is disclosed rather than fabricated.
- `3% -> 0.1% + 2.9%` non-additive worked example: verified arithmetically in PROPOSAL.md's semantic examples and
  structurally by every `programmableShareOf(...)` assertion in `test/egregore.spec.js`.
- Token-to-quote and quote-to-token, exact-input and exact-output, on the canonical PoolKey: covered by
  `egregore.v4.spec.js`'s four swap-mode tests.
- Quadrant-dependent before/after path against the canonical fixed-quote-asset (always-ETH) basis: proven by four
  real-PoolManager regressions in `test/egregore.v4.spec.js`, one per quadrant, each asserting that the accrued
  liability equals exactly 10 bps of the executed gross ETH volume, derived from measured balances rather than from
  the hook's own numbers:
  - `collects buy tax on exact-input swaps and the quote fee in ETH` (`before-swap-return-delta`),
  - `collects buy tax on exact-output swaps on the ETH input side` (`after-swap-return-delta`),
  - `collects sell tax on exact-input sells on the ETH output side` (`after-swap-return-delta`),
  - `collects sell tax on exact-output sells and the quote fee in ETH` (`before-swap-return-delta`).
- Actually-executed gross volume after partial fills: proven by two dedicated regressions that aim a binding
  `sqrtPriceLimitX96` at the live pool price so the swap cannot fill completely —
  `charges the quote fee on executed volume, not requested, when an exact-input buy partially fills` and
  `charges the quote fee on executed volume when an exact-output sell partially fills`. Both assert the fee equals
  10 bps of what executed, assert it is strictly less than 10 bps of what was requested, and account for the
  over-reserved remainder.
- Same-pool self-calls: Uniswap v4 suppresses the hook's own callbacks, so the buyback is charged internally instead.
  `charges the mandatory fee exactly once on a hook-initiated same-pool buyback` runs a full PoolManager lifecycle,
  reads the gross ETH from the `ReserveBuyback` event, asserts the liability grew by exactly 10 bps of it, and then
  asserts the hook's ETH balance still covers every liability it reports.
- LP fees, token taxes, router paths, donations and alternative pools cannot satisfy or bypass the mandatory fee: the
  LP-exit and unstake taxes are project charges on non-swap actions and are deliberately outside the policy's swap
  basis; alternative pools using the same hook address receive zero tax and zero effect.
- Owner-only claim, anytime, to itself or an owner-selected destination; builder/project/administrator/recipient
  cannot redirect: proven by `lets only the immutable Programmable owner claim, and settles the claim exactly` in
  `test/egregore.v4.spec.js`, which reverts four different foreign callers across **both** entry points, asserts the
  liability is unchanged after those attempts, then claims to an owner-selected destination and checks that the other
  liabilities are untouched and still covered. `charges the mandatory Programmable fee in ETH and lets only its owner
  claim it` in `test/egregore.spec.js` covers the same authority rules at unit level.
- Claimable-liability accrual (not auto-transfer), accrual/claim reconciliation: proven by the same tests asserting
  `programmableFeeEth` accrues on collection and zeroes exactly on claim, with the destination balance moving by
  exactly the accrued amount.
- `(poolId, currency, owner)` liability solvency, no cross-pool netting: single-pool design, not applicable beyond
  what the accounting-bucket solvency tests already cover.
- Exact source/test path binding: `programmableFee.evidence` in `submission.json` points to `src/EgregoreHook.sol` and
  both `egregore.spec.js`/`egregore.v4.spec.js`.

## No-hook proposal path

Not applicable; `hook.used = true` for this entire proposal.

## App, game, service, keeper, oracle, or indexer

None declared; not applicable.

## Product integration cases

None planned (`integration.platformHandoff.intended = false`); not applicable.

## Semantic cases

See PROPOSAL.md's "Semantic examples" section for the worked buy-tax, sell-tax-curve, LP-exit-tax and stress-buyback
numerical examples, each with a named passing test.

## Evidence status

| Command | Tool version | Result |
| --- | --- | --- |
| `npm ci` | npm (Node 20.20.0) | passed |
| `npx hardhat compile` | hardhat ^2.28.0, solc 0.8.26 | passed |
| `npx hardhat test` | hardhat ^2.28.0, mocha/chai | passed — 51/51 |
| Slither / static analysis | not installed | not-applicable-with-reason (no Foundry/Slither toolchain in this Hardhat project) |
| `forge`/`cast`/`anvil` evidence | not installed | not-applicable-with-reason (Hardhat project, not Foundry) |

Maintainer acceptance, platform review, deployment authorization, deployment execution, source verification, runtime
matching, lifecycle verification, monitoring readiness, routing/discovery, and availability are all separate gates
with separate evidence, none of which is claimed by this test plan.
