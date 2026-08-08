# Test plan

## Reproduction target

Run all commands against source commit `a9bc79e377da73e336157df6e3ab1ca842092ec2` and tree `dd434971d1d5246ce1907891c34ef27b059a9ce2`. Dependency revisions, compiler settings, bytecode metrics, command output, and evidence hashes are committed in that tree.

## Unit and integration coverage

The checked-in Forge transcript records 42 passing tests with zero failures and zero skips. Coverage includes all four ordinary fee quadrants, authenticated challenge settlement, post-expiry finalization before swap processing, soft and hard deadline behavior, same-block refunds, pull-based claims, pool-key isolation, partial-fill rejection, double-claim rejection, atomic launcher rollback, rejection of alternate valid launch prices and WETH budgets, and full manual-signing digest sensitivity to both salts, sender, target, chain, and value.

Reproduce with:

```text
forge test -vvv
forge test --gas-report
forge build --sizes
```

The fee assertions calculate the Programmable liability as exactly 10 basis points of cumulative actual gross WETH quote volume. Game-fee assertions use 100 basis points of the same settlement base. Exact-output cases derive the settled quote side from the PoolManager callback deltas rather than requested amounts.

## Fuzz and invariant coverage

The evidence uses 1,000 fuzz runs per fuzz test. Stateful invariants use 256 runs, depth 64, and 49,152 calls. Reproduce and inspect:

- Solvency: explicit unpaid liabilities never exceed accounted WETH custody.
- Pot conservation: pending, active, finalized, rollover, refund, and claimed transitions conserve allocated game fees and crown contributions.
- Crown-time conservation: each finalized time-pool share is derived from accumulated crown-seconds without iterable payout storage.
- Deadline monotonicity: soft deadlines do not move backward and never exceed the fixed hard deadline.
- Expired-round non-resurrection: processing finalizes an expired round before a later challenge can start the next round.
- Authentication: arbitrary callback senders and forged payer, player, or beneficiary data cannot enter challenge mode.

## Fork rehearsal

The fork transcript contains two independent, mandatory runs: a candidate lifecycle pinned at Ethereum block `25700561` and a current-head smoke at block `25707960`. Each binds the exact PoolManager, PositionManager, StateView, V4Quoter, and WETH runtime hashes; launches and permanently locks liquidity; exercises return-delta fee accrual, deadline and partial-fill rollback, and champion/crown-time/Programmable claim redemption; reconciles ERC-6909 backing to liabilities; and asserts the PoolManager nonzero-delta count plus actor/router/hook currency deltas are zero. Neither path contains a skip.

## Static and size checks

Reproduce:

```text
forge lint src --severity high med
slither . --json evidence/reports/slither.json
forge build --sizes
```

The checked-in Slither 0.11.6 output contains seven triaged findings: expected external-call reentrancy surfaces around the atomic launch flow, timestamp use required by round rules, a false constable suggestion, and an intermediate-representation limitation in a transient-storage dependency. The disposition file maps each result to its design rationale and tests.

Runtime bytecode in the evidence is 17,200 bytes for the hook, 5,133 for the router, 14,909 for the launcher, 1,920 for the token, and 519 for the vault. The measured atomic deployment-and-launch call uses 6,626,325 gas in the gas-report harness.

## Admission checks

Validate the closed package as exactly seven files. Resolve every evidence URL at the full source commit, compare every declared SHA-256 digest, compile the canonical launch specification with the active production compiler contract, then verify the root and child address derivations after selecting the launch-session wallet.

The remaining assessment gates are reproduction of the declared wallet/calldata preflight and manual inspection of `beforeSwapReturnDelta` settlement signs. No deployment or approval is asserted by these test results.
