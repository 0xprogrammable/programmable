# Test plan

This plan applies to the isolated prototype. A passed local test does not prove deployment, audit, routing approval or Programmable acceptance.

## Build and dependency evidence

- Pin Solidity 0.8.26, Cancun EVM settings, Foundry, v4 core, v4 periphery and OpenZeppelin hook dependencies.
- Record the compiler-resolved source closure, lock revisions, build information and review-target hash.
- Run formatting, build, full tests, Slither, runtime size and initcode size checks.
- Run a pinned-fork test against exact deployment records and a separate current-head smoke test.

## `DiscoveryBox`

- Constructor mints exactly `100e18` and exposes immutable 40-box target and 30-day duration.
- `open(1)` burns exactly `1e18`, increments `openedBoxes` once and starts expiry at `block.timestamp + 30 days`.
- Opening an active membership extends from the current expiry. Opening an expired membership extends from the current block time.
- Opening multiple boxes applies the same result as repeated single openings, subject to timestamp equality.
- The API accepts only whole-box counts. Zero and excessive counts, or opening from a fractional balance below one whole box, revert without changing supply, balance, expiry or count.
- No caller can mint, pause, freeze, confiscate, upgrade or use a separate generic burn path.
- Stateful invariant: `totalSupply + openedBoxes * 1e18 == 100e18`.
- Stateful invariant: `openedBoxes` never decreases and never exceeds 100.

## Generic openable assets

- Prove `IOpenableAsset` exposes only the opening count, maturity target and opening entry points needed by the market boundary.
- Prove every `OpenableERC20` outcome preserves `totalSupply + openedCount * 1e18 == initialSupply`.
- Prove malformed or unsupported application data reverts the burn, counter and outcome together.
- Prove the hook can bind a different conforming application without changing its permission or accounting code.
- Test ticket creation, gifting, gate authorization, consumption and failed application data.
- Test deterministic collectible styles, ERC-1155 balances, failed application data and receiver re-entry.
- Do not present deterministic styles as random or economically equal unless a separate product review supports that claim.

## Hook identity and initialization

- Derive all 14 permission flags and mask `0x10cc` from the deployed hook address.
- Reject every callback caller except the exact PoolManager.
- Reject every PoolKey except the one registered native ETH/`BOX` dynamic-fee key with tick spacing 60.
- Accept registration and initialization once. Reject repeats and configuration drift.
- `afterInitialize` sets the stored LP fee to 3,000 hundredths of a basis point.
- Check every enabled callback selector and return length.
- Prove disabled callbacks cannot be reached through the hook address.
- Through the bound launch factories, prove valid HookMiner deployment, exact constructor locators, atomic token/hook deployment, registration, initialization and one-sided liquidity; an invalid salt must roll back every child.
- Prove the BOX salt is caller-bound, direct BOX/hook child deployment is restricted to the launch registrar and copied launch calldata cannot occupy the intended addresses or steal the LP-fee entitlement.
- Prove only the immutable per-pool launch recipient can collect accrued initial-position LP fees, a chosen destination receives the exact amount and position liquidity cannot decrease.

## Directional LP fee

For buys, test a constant 3,000 hundredths of a basis point at opened counts 0, 1, 20, 39, 40 and 100.

Stateful invariant runs exercise exact-input and exact-output buys and sells, whole-box openings and partial fee claims in arbitrary sequences. They must preserve fee solvency, keep the shared rounding remainder below 1,000,000, prove `cumulative gross volume * 1000 = cumulative accrued fee * 1,000,000 + remainder` and conserve the openable asset supply after every sequence.

For sells, test:

| Opened | Expected fee |
| ---: | ---: |
| 0 | 10,000 |
| 1 | 9,825 |
| 20 | 6,500 |
| 39 | 3,175 |
| 40 | 3,000 |
| 100 | 3,000 |

- Fuzz the count from 0 to 100 and prove the sell fee is monotonic, bounded and equal to `10000 - floor(min(opened,40) * 7000 / 40)`.
- Prove direction uses the `BOX` side of the registered PoolKey, not an assumed address ordering.
- Revert on a failed or malformed `openedBoxes` read and on any calculated out-of-range value.
- Prove donations, liquidity changes, swaps and alternative pools cannot change the counter or inherit the fee.

## Programmable fee: all 4 quadrants

Use native ETH as `currency0`. Zero execution is fee-free. Every positive executed gross native amount below 1,000 units must revert before any accounting write; 1,000 is the first admissible positive gross amount. Test zero, 1, 999, 1,000, 999,000, 1,000,000, `type(int128).max` boundaries and randomized amounts.

1. Zero for one, exact input: `F=floor(G*1000/1_000_000)`, AMM input `G-F`, final caller input `G`.
2. Zero for one, exact output: for core ETH input `X`, `F=floor(X*1000/999_000)`, final gross input `X+F`, and `F=floor((X+F)*1000/1_000_000)`.
3. One for zero, exact input: for gross ETH output `G`, `F=floor(G*1000/1_000_000)`, final caller output `G-F`.
4. One for zero, exact output: for requested net ETH output `N`, `F=floor(N*1000/999_000)`, core output `N+F`, final caller output `N`, and `F=floor((N+F)*1000/1_000_000)`.

The displayed formulas are the zero-carry identities. The implementation stores the platform residual numerator below 1,000,000 for the canonical pool lifetime. Gross paths add `G*1000` and divide by 1,000,000; fee-on-top paths add `N*1000` and divide by 999,000 so the resulting fee also contributes to gross volume. The zero-rate project stream is inert. Test split admissible swaps and an alternating-mode sequence, then assert the exact cumulative gross-volume identity. Claims must not reset the remainder.

For all four direction and exactness quadrants, construct a positive executed gross quote below 1,000 and require the exact wrapped `GrossQuoteBelowMinimum(grossQuote)` hook error. Each rejection must leave liability, remainder, backing and pool execution state unchanged. Then prove a gross quote of exactly 1,000 succeeds. Fuzz the complete 1 through 999 range and assert atomic rollback.

For every case, prove:

- the accumulated fee is the integral floor of 10 basis points of executed gross ETH volume, with fractional remainder carried across swaps
- claims do not reset the lifetime remainder and cannot change the fee earned by later swaps
- the project share is zero and the Programmable share is the complete hook fee
- the hook mints exactly `F` ERC-6909 native-currency claims to itself
- hook PoolManager delta is zero before unlock ends
- new hook claim backing, liability and emitted fee are equal
- the final caller delta is the core delta minus the hook delta
- no fee is charged on reverted or zero-execution swaps

The invariant handler must issue both exact-input and exact-output swaps in both directions. Record useful calls and reverts for each handler selector so exact-output stateful coverage cannot be inferred from unit tests alone.

Specified-ETH paths must revert partial fills. Unspecified-ETH paths must charge the actual core result and exclude unfilled amounts. Test price-limit boundaries that force both behaviours.

Fuzz both gross-up identities across the complete safe int128 domain using a 512-bit multiplication reference. Differential-test Solidity results against a simple big-integer model.

## Fee policy and bypasses

- Prove selected totals of 0, below 10 basis points and exactly 10 basis points resolve to 10 basis points for Programmable and zero for the project.
- Prove 3% resolves to 0.1% for Programmable and 2.9% for the project, never 3.1% total.
- Reject wrong PoolId, wrong quote asset, wrong direction, sign crossing and return-delta overflow.
- Prove routers, LP fees, token transfers, donations and alternative pools neither satisfy nor bypass the canonical fee.
- Prove the hook cannot initiate a same-pool swap. Exercise direct PoolManager and router re-entry attempts.
- Test nested claim-mint ordering and atomic rollback after mint, ledger update and event emission failures.

## Claims and solvency

- Only `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` can claim.
- The owner can claim to itself or a destination selected for that call.
- Test partial claim, full claim, repeated claim, zero claim, excessive claim and a destination that rejects ETH.
- Failed claims do not reduce liability.
- Builder, project, registrar and arbitrary callers cannot claim, redirect, rescue, sweep or mutate the owner.
- No liability from another PoolId, currency or beneficiary can be netted or claimed.
- Stateful invariant: hook ERC-6909 native-claim balance is at least aggregate liability.
- Stateful invariant: accruals minus successful claims equals current liability.
- An excess ERC-6909 claim balance can create surplus but not liability or a builder withdrawal right.
- Claim redemption enters one authenticated PoolManager unlock, burns exactly the hook-owned claim, takes equal ETH to the destination and ends with zero hook delta.
- Prove the first buy succeeds when PoolManager starts with zero native ETH because accrual mints a claim instead of transferring pre-settlement ETH.

## Router, quote and app (planned integration, not supplied here)

- After selecting an exact reviewed production router generation, encode all 4 modes through its explicit v4 swap and settlement actions.
- Validate the final caller delta after every hook and route leg.
- Test BOX Permit2 allowance, native `msg.value`, unused ETH refund, deadline expiry and minimum output or maximum input failure.
- Quote and execute from the same PoolKey, block state, exactness, direction and empty `hookData`; compare final amounts and both fee classes.
- Reject stale opened-box state, changed pool state and unsupported multihop routes until separate parity tests exist.
- Test wrong chain, disconnected wallet, rejected signature, reverted transaction, pending replacement and confirmed receipt UI states.
- Prove a real wallet-gated endpoint denies access on an expired membership or failed chain read.

## Events and reconstruction

- Replay from the launch block using `(block number, transaction index, log index)` order.
- Simulate a reorg and roll back to the last common finalized block before replay.
- Backfill in bounded ranges and resume from a finalized checkpoint.
- Reconcile event-derived `openedBoxes` and owner liability with direct reads at the same block.
- Reconcile the hook ERC-6909 native-claim balance against liability and exclude pool liquidity from hook reserves.
- Mark data stale after 120 seconds and withhold transactional controls on mismatch.

## Evidence states

Each command and case must be recorded as `planned`, `passed`, `failed`, `blocked` or `not-applicable-with-reason`. Record exact versions, revision, command, test count, fork block, gas, size, invariant calls and artifact hashes.

Current state:

- deterministic Builder preflight: passed
- 20,000-path reduced-form economic model: passed
- Solidity format, build, unit, fuzz, five stateful invariants and static analysis: passed locally
- pinned Ethereum mainnet fork at block 23,000,000 and current-head smoke: passed locally against PoolManager `0x000000000004444c5dc75cB358380D2e3dE08A90` with runtime hash `0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293`
- local web model tests and production build: passed; production router, quote parity, indexer and wallet-gated membership tests: planned
- independent accounting and security review: required before candidate status
