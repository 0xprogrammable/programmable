# Test plan

The exact evidence target is review-envelope revision `6ff54ae2d8202d889176bb60ec44e99f602fa68d`, executable baseline `67512e3b7ea1cff4e214d31c209816278b374c5d`, review-target hash `sha256:f9f42aa1275d4e69b9ef769cdea7aa536b2cc7cb933789dd659e9ac4c420b93e`, and review-build-manifest digest `sha256:87baf34d59bb40afea1b6cd390928414bdd656d4ae309abc744db5f865b8845c`.

## Completed local evidence

- Run `forge fmt --check`, `forge build`, `forge test -vv`, and `forge build --sizes --skip test --skip script` with Solidity 0.8.26, Cancun, optimizer 200, and via-IR.
- Require all 65 unit, integration, fuzz, and invariant tests to pass with no failures or skips. Require all four stateful invariant handlers to complete 64 runs and 2,048 calls per property with zero handler reverts.
- Cover payer/caller equality before either transfer, unauthorized allowance-spend rejection, PoolManager callback authentication, exact `0x20cc` hook permissions, invalid permission-salt rollback, exact PoolKey registration, router-before-hook order, one-shot replay rejection, two-sided PoolManager settlement, and permanent launcher ownership of the initial position.
- Cover the 10-bps Programmable floor, fixed claim authority, independent cumulative rounding, all four swap quadrants, exact-input and ordinary exact-output behavior, partial-fill rejection, quote-delta conservation, ERC-6909 claim solvency, and claim redirection failures.
- Cover verified buy custody and basis, partial/full sells, profit/loss/maturity penalties, seller self-exclusion, activation, withdrawal, rebate/reward claims, replay/deadline failures, donation isolation, and public solvency equations.
- Execute the complete declared launcher, router, factory, hook, pool initialization, authenticated funding, real PoolManager settlement, permanent liquidity lock, runtime hashes, permission mask, market-derived initial price, and liquidity amounts at pinned Ethereum block `25693788` without broadcasting a transaction.
- Run the React demo’s four unit tests and Vite production build. The recorded large-chunk warning is a demo optimization item, not a contract gate.
- Validate the exact `launch.json` against the `programmable:production` autonomous launch contract and rebuild the deterministic source/dependency closure.

## Public review witness and remaining platform gates

- Public Actions run `31230698407` rebuilt the exact review commit and lock/config closure, reproduced the deployable artifacts, and reran Foundry, fork, size, invariant, and Slither commands in an isolated runner.
- `CODEX_SECURITY_REVIEW.md` reviews v4 delta signs, exact-output inversion, cumulative rounding, custody, solvency, intent authentication, reentrancy, unsupported tokens, economic behavior, and the deliberate absence of recovery powers. Maintainers must verify its attribution, hash bindings, and dispositions; it is not a third-party human audit.
- Execute the real-token initializer only after approval, funding authorization, fresh dependency-code checks, fresh price review, and final signed deployment verification.
- Build and test provider-owned quoting, SDK actions, event indexing/reorg recovery, reconciliation, monitoring, registry, routing, and incident-response surfaces separately.

No local test proves deployment, acceptance, provider support, routing, or availability.
