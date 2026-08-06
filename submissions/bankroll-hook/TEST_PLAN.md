# Test plan

## Completed local checks

The current Foundry suite covers:

- payout, exposure, utilisation and redemption arithmetic
- cumulative 10 bps gross and fee-on-top identities, including 1,000 successful 999-wei swaps, plus exact-output gross-up arithmetic with 512-run fuzz tests
- versioned hook-data round trips and malformed input
- the exact six permissions and `0x30cc` mined address mask
- canonical PoolManager initialization and Funding to Active transition
- ordinary swaps in both directions and both exactness modes
- wagered exact-input swaps in both directions
- successful randomness request, fulfilment, pull, settlement and finalisation
- unrequested randomness timeout and WETH refund
- exact fee amounts and events in all four quadrants, claim-remainder preservation, owner-only claim to a selected destination and recipient-failure rollback
- callback rejection for a wrong PoolManager, wrong router, alternate pool and malformed hook data
- wager rejection for replay, stale blocks, exact output, stake bounds, volume limits and bankroll capacity
- atomic deadline, native-value, price-limit, specified-partial-fill, minimum-output, recipient-transfer and volume-cap failures
- both randomness timeout paths, fulfilled-request non-expiry and terminal-state finality
- repeated ticket settlement, ticket claim and Programmable fee claim rejection
- 6 stateful invariants at 128 runs and depth 48
- deterministic fixed-token, hook and router launch through a real PoolManager and PositionManager
- permanent position ownership and fee collection, fixed supply, empty launcher custody, zero/minimum initial buys and initial-buy fee accrual
- EIP-170 runtime-size checks and lint
- exact hook and router creation/runtime hash binding, modified-init-code rejection and launch provenance
- hostile and non-conforming token factories, invalid mined hooks, repeated salts and token collisions, and complete rollback of token, hook, router, locker, pool, position and launch records
- VRF exact payment and quote, maximum fee, duplicate request IDs, unknown IDs, wrapper-only fulfilment, duplicate fulfilment and consumer-only one-shot consumption
- launch artifact binding to the 5,000-run via-IR compiler profile, exact launch signature and selector, compiled constructor ABIs, source hashes, five dependency addresses, four release targets, four internal child deployments and every graph edge

Run:

```sh
npm run build
forge test -vv
forge lint
npm run launch:check
```

## Completed regression matrix

Focused regressions now cover insufficient Funding cancellation, zero-ticket close and finalisation, the 64-ticket boundary, four bounded settlement batches, donation, cross-pool fee-remainder isolation, specified-quote partial-fill rollback, price-limit boundaries, selected refund/output recipients, failed native and token transfers, and both randomness timeout boundaries.

The VRF adapter rejects wrapper request-ID reuse before it can overwrite a request key, rejects unknown and duplicate fulfilment, authenticates the wrapper callback, limits consumption to the immutable hook and deletes consumed requests. Hook-level tests bind exact payment to the quoted fee and enforce the caller's maximum.

## Stateful invariants

The current handler covers Funding deposits and withdrawals, activation or cancellation, wagered buys and sells, close, randomness, settlement, claims, Programmable fee claims, finalisation and redemption. It checks after every action:

```text
WETH balance ≥ bankroll assets + open stake liability + player claim liability
reserved exposure ≤ bankroll assets
reserved exposure ≤ floor(80% × bankroll assets)
```

The suite also checks bankroll-share conservation, terminal-state finality and one payment per ticket. Each property runs 128 sequences at depth 48.
The fee-liability property also checks that the hook's native PoolManager balance equals its recorded Programmable fee liability.

## Launch regressions

The integration matrix proves fixed supply, predicted token, hook and router bindings, the canonical PoolId, launch hash, permanent position custody and fee collection, token custody reconciliation, and zero, minimum-protected and reverting creator buys. Hostile factories that return the wrong address or no token, invalid mined hooks, wrong init code, repeated launch parameters and token collisions all revert. The failed-launch helper checks that no token, hook, router or locker code, pool slot, position increment or launch record survives.

The data-only launch checker separately proves that `submissions/bankroll-hook/launch.json` matches the compiled top-level and child constructors, exact launch calldata, address placeholders, source hashes, compiler settings and deployment DAG.

## External evidence

`test/fork/BankrollEthereum.fork.t.sol` runs at Ethereum block 25,690,000. It checks the exact PoolManager, PositionManager, UERC20Factory, WETH and Chainlink wrapper runtimes and interfaces, then completes the full token, pool, reviewed hook/router and permanently locked position lifecycle against those contracts. Run it with `MAINNET_RPC_URL=ARCHIVE_RPC_URL npm run test:fork`; the normal `npm test` command excludes fork tests explicitly so CI cannot silently depend on an RPC.

The fork and `submissions/bankroll-hook/dependency-evidence.json` are builder-declared compatibility evidence. Complete independent review, source/deployment verification and production monitoring separately. A passing historical fork does not prove audit, deployment, routing approval or product availability.
