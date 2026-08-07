# Test plan

## Executed contract suites

| Area | Required evidence |
| --- | --- |
| Atomic launch | Direct mined-hook target, factory initializer binding, exact dependency code hashes, OPEN and vault child creation, full PoolKey registration, pool initialization, exact USDC pull, full-range mint, permanent NFT custody, refund, zero residual balances, and cleared approvals. |
| Rollback | Wrong dependency runtime and unauthorized launcher each revert before retaining wallet funds or deployed launcher children. |
| Trade encoder | Exact-input and exact-output single-hop calldata in both OPEN/USDC directions; Universal Router command, V4Planner actions, full PoolKey, amount bound, recipient, deadline, `minHopPriceX36`, and hook data decoding. |
| LP curve | Exact 0/25/50/75/100% checkpoints, closed/no-capacity behavior, extreme-value bounds, and fuzzed monotonicity. |
| Fee policy | Selected zero/below/at floor/3%, all four quadrants, exact-output gross-up, partial-fill rollback, dust, fragmentation, claims, and zero execution. |
| Hook safety | PoolManager authentication, exact PoolKey, exact five permission bits, one-shot registration/update, alternate-pool rejection, ignored hook data, claim backing, and owner isolation. |
| Vault | Binding, authority, duration/band/capacity, ceiling funding, receipts, finalize/expire, replay, claims/cancels, and residual withdrawal. |
| Hostile tokens | Fee-on-transfer, false return, pause, blacklist, and reentrant transfer behavior. |
| Stateful invariants | Configuration immutability, bounded fee/epoch state, hook solvency, vault quote/OPEN solvency, and useful handler calls. |

## Revision-bound commands

Run these from a clean checkout of the exact proposed revision using Solidity 0.8.26, Cancun, optimizer 200, via IR, FFI disabled, `bytecode_hash = none`, and CBOR metadata disabled:

```text
npm ci --ignore-scripts --no-audit --no-fund
forge fmt --check
forge build --sizes
npm run create2:fixture
forge test -vv
forge test --match-contract OpenHoursAtomicLauncherTest -vv
forge test --match-contract OpenHoursTradePlannerTest -vv
forge test --match-contract OpenHoursInvariantTest -vvv
forge snapshot --check
forge lint
```

The evidence package must retain raw stdout/stderr, exit status, tool versions, command line, exact git revision and dirty-state declaration. Summary JSON alone is insufficient.

## Static analysis disposition

Run Slither against the exact compiler configuration in an isolated environment. If Slither cannot lower the via-IR build, retain the raw failure and an attributable finding-by-finding disposition identifying the affected source and function, impact, compensating test or manual review, and whether the item remains open. Tooling failure is never reported as a pass.

## Production gates still outside local tests

Before launch, maintainers must independently rebuild, re-run the manifest validator, verify every dependency runtime through independent RPCs, simulate the complete adapter transaction against the predicted addresses, execute a Mainnet-fork buy and sell through the exact bound V4Quoter/Universal Router/Permit2 path, and confirm no residual approvals or balances.

A real-value NAV lane additionally requires producer authentication, HSM/KMS policy evidence, ledger-source reconciliation, stale-data rejection, relay allowlisting, key-rotation/incident drills, and successful finalize/expiry recovery exercises. No epoch should be opened merely because pool launch succeeds.
