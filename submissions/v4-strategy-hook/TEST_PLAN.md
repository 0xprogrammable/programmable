# Test plan

## Implemented prototype evidence

- Constructor configuration, independent buy/sell rates and exact hook permission mask
- CREATE2 factory address reproduction
- Inclusive 10 bps floor and 1% V4STR 10/90 project split
- Buy exact input, buy exact output, sell exact input and sell exact output
- Platform, creator and strategy liability partition and PoolManager-claim backing
- Creator-only and Programmable-owner-only claims
- PoolManager-only callback authentication
- Oracle-not-ready and maximum-gap reset
- Atomic target-pool spot manipulation rejection without liability loss
- Cooldown rejection without liability loss
- Permissionless exact-input strategy execution and exact dead-address balance increase
- No stranded purchased target output
- Exact callback selectors and decoded return shapes
- Reentrant Programmable payout recipient rejection
- Target and canonical PoolId separation
- 10,000-run fee-conservation fuzz test
- Three 1,000-run, depth-128 mixed buy/sell invariants with 384,000 handler calls and zero reverts
- Deterministic keeper threshold, cooldown, observation and idempotency policy tests
- Event reconstruction, duplicate/overdraw rejection, reorg rollback, solvency and freshness tests
- Pinned-mainnet full lifecycle suite and separate current-head PoolManager runtime check
- Slither findings with explicit dispositions and compiler-known-bug review
- Runtime and initcode size reporting

## Remaining before candidate approval

- Maximum fee/share and overflow-adjacent rounding boundary expansion
- Mismatched PoolKey, wrong initializer, initialization replay and target/canonical collision
- Specified-native partial-fill rejection in both affected quadrants
- Stale, reset, negative-tick and ring-wrap oracle cases
- Sustained manipulation, maximum deviation and price-impact boundaries
- Target pool revert, target hook reentrancy, false/no/malformed-return token, fee-on-transfer and rebasing token
- Forced ETH/token donation and aggregate claim solvency
- Gas ceilings for every callback, claims, oracle write and maximum strategy execution
- Independent return-delta/accounting, oracle-economic, dependency and security review
- Maintainer integration review and independent routing-provider approval

## Fork suites completed

The final prototype ran two Ethereum mainnet-fork suites without touching the live V4STR pool or using its deployer key:

1. The complete 16-entry lifecycle/adversarial suite at block `25,664,100` against official PoolManager
   `0x000000000004444c5dc75cB358380D2e3dE08A90` and its expected runtime hash.
2. A current-head smoke check of the same official PoolManager runtime.

All 17 entries passed. These are simulations and compatibility evidence, not deployment receipts or an audit.

## Commands

```bash
./scripts/bootstrap-deps.sh
forge fmt --check
forge lint --severity high
forge build --sizes
forge test --offline --no-match-path test/V4StrategyHookFork.t.sol -vv
FOUNDRY_PROFILE=ci forge test --offline --match-contract V4StrategyHookTest --match-test feeConservation -vv
FOUNDRY_PROFILE=ci forge test --offline --match-contract '^V4StrategyHookInvariantTest$' --match-test '^invariant_' -vv
MAINNET_RPC_URL=YOUR_ETHEREUM_RPC_URL forge test --match-path test/V4StrategyHookFork.t.sol --force -vv
npm --prefix keeper run check
npm --prefix keeper test
npm --prefix indexer test
slither . --exclude-dependencies --filter-paths 'lib|test'
```
