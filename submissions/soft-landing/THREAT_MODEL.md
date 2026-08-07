# Threat model

Status: contributor prototype; not audited, accepted, deployed, routed, or live.

## Assets and invariants

The canonical pool contains a permanent launcher-owned initial position plus any later ordinary v4 liquidity and LP fee
value. The launcher retains 25,789 wei-token of unreachable deterministic rounding dust under the specified launch.
The hook holds quote-denominated PoolManager ERC-6909 claims backing one liability keyed by `(canonical PoolId, quote
currency, immutable Programmable owner)`. Neither contract has a token treasury claimant, project fee, admin key,
oracle key, keeper funds, signature authority, personal data, or offchain secret.

Required conservation is:

`hook quote claim balance = totalQuoteFeesAccrued = claimable liability`.

The LP-fee override never enters hook custody. Accrual mints exactly the hook claim represented by the positive return delta. Claim first zeroes/decrements the liability in the same transaction, then burns the exact claim and takes underlying quote to the owner's selected destination; any failure reverts all steps. The lifetime fee remainder survives claims.

## Trust boundaries and authority

- `PoolManager`: immutable callback and unlock authority; any other caller is rejected by `BaseHook` or explicit checks.
- `SoftLandingLaunch`: permissionless atomic coordinator and permanent position owner. It accepts only the exact active
  callback-byte hash from its immutable PoolManager and exposes no position removal, transfer, approval, arbitrary
  call, rescue, sweep, upgrade, or LP-fee claim path.
- `SoftLandingHookFactory`: permissionless one-shot CREATE2 deployer and registrar. Every PoolKey member and the initial
  sqrt price are committed into constructor initcode; an expected-address mismatch fails before deployment. It has no
  authority after atomic initialization.
- Canonical PoolKey: the only admitted pool; other keys revert and cannot share liabilities.
- Programmable owner `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`: immutable sole claim caller and beneficiary; it may choose a nonzero destination per claim.
- Routers/quoters: untrusted callers that must enforce their own slippage, deadlines, native refunds, and final-delta checks. `hookData` is unused.
- Package dependencies and Ethereum PoolManager runtime: exact source/runtime identities are evidence inputs, not upgrade or availability guarantees.

There is no creator, builder, project, administrator, pause, upgrade, rescue, sweep, mutable recipient, oracle, keeper, app server, API, or indexer authority.

## Launch value flow and rollback

The fixed token mints its full supply to the launcher. A one-sided position at the exact initialized tick commits
`999999999999999999999974211` units. The same PoolManager unlock executes the caller's exact 0.001 ETH initial buy,
then settles only the combined native debt and net token debt. The launch wallet receives only bought output; it does
not receive the unsold supply. Conservation is checked across PoolManager, buyer, and launcher dust, while the
launcher's native balance must return to its prelaunch forced-balance baseline.

Threats include substituted callback data, wrong sign/order, incomplete settlement, initial-buy partial fill or price
limit, token-transfer failure, excessive output consuming the position budget, and creator capture of uncommitted
supply. Exact callback-hash binding, one-sided tick checks, amount bounds, exact native-input equality, minimum token
output, post-balances, zero-delta unlock enforcement, and transaction-wide reverts cover these paths locally.

## Hook boundary

Permissions are `beforeInitialize`, `beforeSwap`, `afterSwap`, `beforeSwapReturnDelta`, and `afterSwapReturnDelta`; the other nine permissions are false. The derived address mask is `0x20cc`.

- `beforeInitialize` accepts only PoolManager calling during the hook's self-initiated initialization of the
  constructor-bound key at the constructor-bound initial sqrt price. It returns the exact selector and no delta.
- `beforeSwap` authenticates the canonical key, advances the controller at most once for a new block, returns the directional fee override, and collects only specified-quote quadrants. It returns the exact selector, `BeforeSwapDelta`, and override flag.
- `afterSwap` authenticates the key, verifies specified-quote full execution, collects unspecified-quote quadrants from executed deltas, records executed gross directional flow, and returns the exact selector plus hook delta.

No external function initiates a same-pool swap, so callback-skipping self-swaps are forbidden by absence of a call surface. `hookData` is ignored and carries no identity. Reentrancy guards cover registration and claims; callback settlement occurs only inside PoolManager's lock and must return balanced deltas.

## Controller manipulation

An attacker may execute real volume to raise the following block's fee in one direction. The attack costs LP fees, the mandatory hook charge, AMM price impact, and capital, but it can still be rational if the attacker owns liquidity or captures external MEV. Controls are independent direction state, immutable target/rise/decay, capped counted excess, a hard 300 bps maximum, and transparent events. This is mitigation, not manipulation resistance.

Same-block stability removes ordering-based differences in the adaptive fee, but creates a one-block blind spot. A packed first-block bundle pays the immutable initial fee. Private ordering, bundles, wash trading, price manipulation, and all one-block MEV remain possible. LP-owned wash activity deserves independent economic review because some LP fee cost may return to the attacker.

Sell-side adaptation can raise exit cost during panic. There is no sell block, wallet discrimination, or liquidity-removal gate, and the cap is immutable, but parameter selection and disclosures require human review.

Long block gaps cannot cause an unbounded loop: empty-block decay is one saturating multiplication. Overflow-sensitive ratios use full-precision arithmetic and checked casts. Expiry is irreversible and permanently fixes both fees at base.

## Return-delta and fee threats

The critical accounting surface is quadrant-dependent:

- specified quote: fee is collected before core execution, then actual execution is checked after; unsupported partial fill reverts everything;
- unspecified quote: executed `BalanceDelta` supplies the basis and collection happens after;
- exact-output specified quote: bounded gross-up ensures requested net quote remains after the fee;
- dust below the 1,000-unit gross quantum reverts rather than silently undercharge.

Threats include sign confusion, currency-order confusion, a positive delta consuming the entire AMM leg, rounding fragmentation, liability drift, claim-balance insolvency, cross-pool netting, duplicate accrual, malformed callback return data, hostile recipients, and callback reentrancy. Controls include quote-derived direction, all-four-quadrant tests in both currency orderings, a nonzero residual requirement, lifetime cumulative remainder, one-pool namespace, exact claim reconciliation, nonzero claim destination, immutable caller, and atomic reverts.

The project-selected fee is zero. Policy examples remain `0 -> 10 bps Programmable + 0 project` and `3% -> 0.1% Programmable + 2.9% project`, never additive 3.1%. Alternative pools, router tolls, LP fees, and token taxes do not satisfy the mandatory policy.

## Dependency and asset failures

The intended quote is native ETH for the application profile, while integration tests also cover an ordinary ERC-20 quote as currency1. Fee-on-transfer, rebasing, callback-capable, blacklistable, pausable, upgradeable, or very low-decimal quote assets are unsupported without separate tests. A broken/mismatched PoolManager runtime, router generation, compiler package, or source revision is a deployment blocker, not a fallback condition.

The observed Ethereum PoolManager runtime hash and official record are evidence only. They do not prove the future deployed hook's source, constructor configuration, or integration.

## Product and operational threats

No product UI, API, indexer, or monitoring service exists in this repository. A future integration must protect against wrong PoolKey/model version, stale quotes, reorged events, missed backfill, claim-preview mismatch, native refund loss, route drift, misleading transaction states, and provider outage. It must reconcile discovery data against confirmed chain state. Contributor evidence cannot complete those product-owned gates.

## Recovery and limits

There is deliberately no mutable recovery authority. Bad immutable parameters or a flawed deployment require
abandoning that pool and launching a new one; the existing pool cannot be upgraded or paused. The initial
launcher-owned position has no removal path; only later independent LP positions retain ordinary core removal
semantics. Accrued Programmable rights remain historically claimable only by the fixed owner.

Independent architecture, security, accounting, economic, fork/router, deployment, source-verification, monitoring, routing, and product reviews remain required. Local closure and tests do not establish safety or availability.
