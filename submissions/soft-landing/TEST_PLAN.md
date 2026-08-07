# Test plan

## Commands

```bash
npm ci --ignore-scripts --no-audit --no-fund
forge fmt --check
forge build --sizes
forge test -vvv
forge lint src test --severity high --severity med --severity low
forge test --gas-report
node simulations/launch-traces.mjs
```

The pinned profile is Solidity 0.8.26, Cancun, optimizer 200, via-IR, metadata hash disabled, and FFI disabled. A reported pass applies only to the exact commit and tool versions recorded in evidence.

## Unit properties

`test/unit/FlowFeeMath.t.sol` covers every worked controller example, base/max saturation, exact-target stability, minimum one-pip movement, monotonicity with flow, parameter bounds, and equivalence between constant-time skipped-block decay and explicit iteration. Fuzz target: at least 512 runs per fuzz test.

## Stateful properties

`test/invariant/ControllerInvariant.t.sol` drives randomized block gaps and flow through a handler. Required invariants:

- buy and sell fees always remain within `[base, max]`;
- constant-time decay equals explicit per-empty-block history;
- no handler reverts or discarded calls;
- at least 128 runs and 48 calls per run for each invariant.

## Real PoolManager integration

`test/integration/SoftLandingHook.t.sol` uses a local real v4 `PoolManager`, factory-deployed mined hook address, real pool initialization, liquidity, swaps, settlement, ERC-6909 claims, and native/ERC-20 quotes.

Required cases:

- exact permission booleans and address mask `0x20cc`;
- atomic CREATE2 deployment; identity binding for both currencies, dynamic-fee flag, tick spacing, hook address,
  PoolManager, quote asset, controller parameters, and initial sqrt price;
- expected-address mismatch before deployment, canonical PoolKey reconstruction from immutables, explicit stored base,
  committed-price enforcement, and callback authentication;
- wrong PoolManager, wrong PoolKey, wrong initialization price, repeat registration, and external initialization rejection;
- first successful swap starts the window; a reverted swap leaves it unstarted;
- buy/sell direction is derived from quote position for both currency orderings;
- same-block directional fee stability and next-block-only feedback;
- independent buy and sell state, long skipped-block gaps, cap/base saturation, and irreversible expiry;
- expired swaps continue at base and continue mandatory fee accounting without flow writes;
- native quote and ERC-20 quote-as-currency1 across buy/sell × exact-input/exact-output;
- specified-quote before-swap collection and post-swap full-fill verification;
- unspecified-quote after-swap collection from actual `BalanceDelta`;
- specified-quote partial fill atomic rollback;
- positive gross below 1,000 units rejection, exact-output gross-up, lifetime cumulative remainder, and split-swap resistance;
- liability/claim-balance conservation before and after accrual and claim;
- owner-only anytime claim to per-claim nonzero destination; unauthorized, zero-recipient, empty, project, admin, rescue, sweep, and mutation paths absent or reverting;
- same-pool hook-initiated swap surface absent;
- event values reconcile gross flow, fee, remainder, roll, expiry, and claim state.

Fuzz target: at least 512 cases for gross-fee accounting and 512 for exact-output rounding.

## Executable launch integration

`test/integration/SoftLandingLaunch.t.sol` uses the real local v4 PoolManager and must cover:

- exact fixed-supply CREATE2 token address, immutable metadata, creator, and 1-billion-token supply;
- exact hook CREATE2 address, permission mask `0x20cc`, canonical PoolKey, PoolId, and nonzero configuration hash;
- one-sided position at ticks `[-887220, 204180]`, liquidity `36856093846670599562186`, launcher ownership,
  active pool liquidity, and no launcher removal/transfer/approval/rescue surface;
- exact 0.001 ETH initial buy, minimum output, price limit, combined PoolManager settlement, paid recipient output,
  supply conservation, and 25,789 wei-token inaccessible rounding dust;
- directly executable post-launch native buy and approved token sell;
- impossible position bounds reverting token, hook, pool, and launch record;
- impossible initial-buy settlement bound reverting every child and state write;
- direct unlock callback rejection and wrong active-callback hash rejection from the PoolManager address.

## Adversarial simulations

`simulations/launch-traces.mjs` records calm launch, one-block buy burst, sustained buy pressure, sustained sell pressure, alternating pressure, panic exit, paid griefing, LP-owned wash-flow sensitivity, long inactivity, and expiry. Each trace checks fee bounds, one-block lag, directional isolation, skipped-block decay, and permanent return to base.

## Value-conservation cases

- Gross 100,000 quote units at 10 bps accrues 100 units and leaves 99,900 for the residual economic leg where quote is specified.
- Two accepted gross amounts of 1,500 accumulate to a 3-unit liability through the lifetime remainder.
- A full claim burns exactly the PoolManager claims it redeems and reduces liability and `totalQuoteFeesAccrued` by the same amount.
- Any settlement or partial-fill mismatch reverts all fee, flow, start, and remainder writes.

## Planned external evidence

- Slither with explicit disposition of every finding.
- Compiler known-bug review for 0.8.26 and the exact settings.
- Platform-owned mainnet-fork tests at a pinned block against the observed PoolManager runtime; not run or passed by
  the applicant.
- Platform-owned production Universal Router/V4Planner/Permit2/V4Quoter/StateView parity, including native refunds,
  approvals, slippage, deadlines, final deltas, and receipts; not run or passed by the applicant.
- Platform-owned attributable independent return-delta/accounting review and independent economic manipulation
  review; explicitly not passed by applicant evidence.
- Deterministic deployment rehearsal with salt, initcode hash, constructor values, expected address, runtime hash, and source verification.
- Product-owned indexer, monitoring, routing, and lifecycle tests after acceptance.

These planned checks remain open; local tests do not prove deployment, source match, routing approval, or availability.
