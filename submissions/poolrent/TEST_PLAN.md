# Test plan

Planned checks and actual results are kept separate. Nothing below is marked passed unless the
command in the Evidence column was executed at the declared commit and its output recorded in
`evidence/test-evidence.json`. Skipped, flaky, reverted and unavailable checks are recorded as
blockers, not footnotes.

Toolchain: `forge` 1.7.1, `solc` 0.8.26 (EVM Cancun, optimizer on at 1000 runs, `viaIR` off,
`bytecode_hash` none, `cbor_metadata` off, `ffi` off), `slither` 0.11.6, Node.js 24.13.0.
Fuzz profile is 1000 runs. The invariant profile is 256 runs, depth 64.

## Universal prototype evidence

| Check | Plan | Command | Result |
| --- | --- | --- | --- |
| Format | Every source and test file matches the pinned formatter | `forge fmt --check` | see `evidence/test-evidence.json` |
| Compile | Clean build under the exact pinned settings | `forge build` | pass |
| Lint | No high- or medium-severity findings in project sources | `forge lint --severity high --severity med` | see disposition table below |
| Size | Runtime and initcode within the EIP-170 limit, with headroom stated | `forge build --sizes` | pass |
| Static analysis | No high-severity finding; every other finding carries a technical disposition | `slither . --config-file slither.config.json` | 0 High, 10 Medium, 3 Low, 2 Informational |
| Unit / integration / fuzz / invariant | Full suite green at the declared commit | `forge test` | see counts below |
| Pinned fork | Reproducible run against an exact mainnet block | `forge test --match-contract ForkPinnedTest` | pass |
| Current-head fork | Compatibility with today's deployed contracts | `forge test --match-contract ForkHeadTest` | pass |

## Solidity contracts

Sources under test: `src/PoolRentHook.sol`, `src/PoolRentLauncher.sol`, `src/PoolRentToken.sol`,
`src/libraries/PoolRentMath.sol`.

| Layer | Tests | What it covers | File |
| --- | --: | --- | --- |
| Launch and admission | 9 | Permission mask on the deployed address, canonical pool identity, dynamic-fee flag, seeded liquidity and default fee, single-use launcher, launcher holds no balance afterwards, rejection of a foreign currency / a foreign tick spacing / a static-fee key / a second initialization | `test/Launch.t.sol` |
| Lifecycle smoke | 8 | All four quadrants end to end, rent reaching liquidity providers, manager setting the fee, eviction on exhaustion, and that taking the seat is never free | `test/Smoke.t.sol` |
| Fee policy | 69 | See the mandatory-fee section below | `test/Fee.t.sol` |
| Rent auction and authority | 47 | See the auction section below | `test/Auction.t.sol` |
| Fuzz | 25 | Fee arithmetic across the full input range, swap magnitudes, bid parameters, block deltas, arbitrary `hookData` and price limits, each at 1000 runs | `test/Fuzz.t.sol` |
| Stateful invariants | 11 invariants + 9 regressions | Solvency, conservation, liability sums, fee bounds, LP-fee bounds, exit liveness, manager consistency, no stuck value | `test/Invariants.t.sol`, `test/handlers/PoolRentHandler.sol` |
| Adversarial and failure | 28 | Misbehaving quote tokens (returns false, reverts, returns nothing, no code), a reentrant token driven against every value-moving path, foreign-PoolManager callback rejection on all four callbacks, nested-action settlement and depth, per-entry-point authentication, and a full reconstruction of hook state from emitted events alone | `test/Adversarial.t.sol` |
| Mainnet fork | 2 | The whole lifecycle against the real PoolManager and WETH9, pinned and at head | `test/Fork.t.sol` |

## Custom hook

| Property | How it is proven |
| --- | --- |
| Permission mask `0x30CC` on the deployed address | Asserted directly on `uint160(address(hook)) & 0x3FFF` after a real launch; the hook constructor also validates it, so a mis-mined salt reverts the launch |
| CREATE2 reproducibility | The launch predicts the token and hook addresses before deploying and asserts the deployed addresses match |
| PoolManager authentication | Every callback is `onlyPoolManager` against an immutable address; a direct call from a foreign address reverts |
| Callback selector and return-data length | Exercised implicitly by every swap: v4 rejects a wrong selector or a 96-byte mismatch, so the passing four-quadrant suite is the proof |
| Parent ↔ return-delta permission pairing | Both return-delta bits are declared with their parent callbacks; the mask assertion covers it |
| Canonical-pool binding | A foreign PoolKey, a second initialization, and a wrong start price all revert |
| Self-call suppression cannot skip the charge | The hook has no path to `PoolManager.swap`; a raw router calling the PoolManager directly is charged identically |
| `hookData` is untrusted and ignored | Arbitrary bytes are compared against a state snapshot and produce bit-identical accounting |
| No unbounded loop on a critical path | Rent accrual, eviction and charge computation are O(1) and iterate over nothing |

## Mandatory Programmable fee

Every item the policy requires, with the file that proves it. All in `test/Fee.t.sol` unless noted.

| # | Requirement | Proof |
| --- | --- | --- |
| 1 | Selected totals of zero, below 10 bps, exactly 10 bps and above 10 bps | Pure assertions on `effective = max(selected, 1000)`, plus the deployed constants resolving to platform 1000 / project 1000 |
| 2 | The non-additive `3% → 0.1% + 2.9%` example | Asserted, including an explicit assertion that the result is not `310000` |
| 3 | All four direction × exactness modes on the canonical PoolKey | One test per quadrant, each asserting the charge lands in the quote currency only and that the launched token balance of the hook stays zero |
| 4 | Executed gross quote volume after partial fills is the basis | Price-limited swaps: the two `afterSwap` quadrants charge strictly less than a requested-volume charge would; the two `beforeSwap` quadrants revert `PartialFillRejected` |
| 5 | LP fees, token taxes, router paths, donations and alternative pools cannot satisfy or bypass it | A hand-written router calling the PoolManager directly pays the identical charge; a second pool on the same currencies cannot be initialised; a hookless pool on the same pair accrues nothing to the hook |
| 6 | Quadrant paths match the declared quote asset; same-pool self-calls forbidden | The quadrant tests assert which callback the charge appears in; no path from the hook reaches `PoolManager.swap` |
| 7 | Only the immutable owner may claim, including an owner-selected destination per claim | Claims to two different destinations in one session; five other accounts each revert |
| 8 | Builder, project, administrator, recipient and arbitrary callers cannot claim or mutate the owner | Ten plausible setter signatures × three callers all revert; every real mutator leaves the owner and the liability untouched |
| 9 | No stored mutable recipient or rescue path can redirect the liability | Sixty-four leading storage slots overwritten with an attacker address; `PROGRAMMABLE_OWNER()` is unchanged |
| 10 | Liabilities are solvent, pool-, currency- and owner-scoped, never cross-pool netted | `totalFeeOwed` equals the sum of per-account entries across a manager handover; the hook serves exactly one pool by construction |
| 11 | Collection and claim events reconcile with balances and liabilities under the declared rounding | Events summed per beneficiary equal the `feeOwed` growth; `FeeClaimed` matched against the transfer |

Rounding cases proven explicitly: a charge of three wei splits as platform two / manager one; a large
charge splits as `ceil(total/2)` / `floor(total/2)`; a swap whose executed quote amount is 499 wei
accrues nothing and emits nothing; a fuzz asserts `platform + manager == charge` for every input and
that a charge is always strictly less than the amount it is taken from.

## Carried-remainder conformance

The mandatory charge is accrued on a carried **numerator**, not a per-swap floored quotient, and the
platform and project entitlements are accrued independently rather than by splitting one rounded
total. These tests exist because flooring the combined rate once per swap destroys any entitlement
worth less than a wei — a thousand 499-wei swaps would pay the platform nothing while the identical
aggregate volume owes it 499 wei, and splitting an already-floored total cannot recover it.

| Area | Cases |
| --- | --- |
| Sub-wei aggregation, all four quadrants | 1,000 swaps of 499 wei gross pay the platform exactly 499 wei, with `feeFromGross(499, PLATFORM_RATE) == 0` asserted first as the premise; the same per quadrant with the gross measured from the pool's own `Swap` event |
| Split versus whole, all four quadrants | 25 slices against one swap of the same volume: the entitlement numerator is conserved on both branches, and where the quote side is the specified currency the payout, gross and remainder match to the wei; where per-swap AMM rounding moves the executed gross, the entitlement is asserted to follow it exactly rather than being papered over |
| Claims | A claim clears `feeOwed` and leaves both remainders standing; a 200-swap run claimed halfway through totals the same as an uninterrupted one |
| Partial-fill rollback | On both `beforeSwap` quadrants, a remainder is built up, a partial fill is attempted and reverts, and both remainders and both liabilities are byte-identical to before |
| Manager turnover | A half-wei project remainder built under one manager matures into the next manager's first payout rather than being forfeited; the same across an eviction; the platform side is bit-identical with and without a manager over a 40-swap run |
| Vacant-seat routing | With no manager, `pendingRent × DENOMINATOR + projectFeeCarry == volume × PROJECT_RATE`; a full empty → seated → empty cycle conserves both numerators across three changes of destination |
| Clamp | When the "a charge may never consume the whole executed amount" bound withholds units, they are returned to the remainders — asserted landing on exactly `DENOMINATOR` — and paid out by the next swap, with the numerator conserved throughout |
| Fuzz | `sum(amounts) × DENOMINATOR + finalCarry == sum(gross × rate)` over random sequences including sub-wei grosses; splitting a volume into k random pieces yields exactly the same entitlement and residual remainder; `_grossForNet` round-trips so the trader receives their exact net |
| Invariants | `credited × DENOMINATOR + carry == Σ(gross × rate)` per side over every charged swap; the realised charge satisfies `charged × DENOMINATOR + platformCarry + projectCarry == gross × TOTAL_FEE`; every non-swap action asserts both remainders are untouched, which covers claims, handovers, evictions and the vacant path in one check |

## Rent auction and authority

All in `test/Auction.t.sol`. Boundaries are tested on both sides, not just inside the valid range.

| Area | Cases |
| --- | --- |
| First bid | At and below `MIN_RENT_PER_BLOCK`; a deposit at and one wei below the `MIN_DEPOSIT_BLOCKS` floor |
| Tenure | A challenger at `start + 99` (rejected) and at `start + 100` (accepted) |
| Outbid | 109% rejected, exactly 110% accepted, above accepted; rounding checked at the minimum rent and at an indivisible rent |
| Incumbent | May raise its own rent, may not lower it; a deposit top-up neither reprices the seat nor extends protection |
| Accrual | Exactly `rentPerBlock × blocks`; idempotent within one block; runs inside a swap; charges nothing with no manager |
| Eviction | Lands on the exhausting block; the charge is capped at the remaining deposit; the seat resets and the auction reopens; a swap never reverts because of it |
| Deposits | Any account withdraws its own balance to a chosen destination at any time; over-withdrawal and the zero address revert; an evicted manager still withdraws in full; a manager withdrawing below its floor self-evicts in the same call |
| LP fee | Only the current manager may set it; a non-manager, an evicted manager, the launcher and the platform owner all revert; `MIN - 1` and `MAX + 1` revert while `MIN` and `MAX` succeed; the chosen fee visibly changes the realised trade price |
| Rent to LPs | A real position collects exactly its proportional share of the donated rent, asserted to the wei |
| No in-range liquidity | The donation is skipped, the swap still succeeds, and the rent is carried to the next swap that can distribute it |
| Authority | No address can pause the pool, block another account's withdrawal, seize a deposit, move the manager seat outside the auction, or reach another account's liability |

## App or game, service, keeper, oracle, indexer

Not declared and not shipped. There is no application, server, keeper, oracle or project indexer in
this submission, so no test exists for one. Rent accrual is lazy and computed on read, and eviction
is triggered by any interaction, so no offchain process needs to run for the mechanism to be correct.

## Product integration cases

No swap client, quoting service, UI or indexer is supplied (`routingMode` is not-planned), so router
generation, Permit2, quote-to-execution parity and app integration paths are explicitly not tested
here — they belong to a later, maintainer-owned integration review. What the project does prove is
that the pool behaves correctly for *any* router: the raw-router test calls `PoolManager.swap`
directly with no periphery at all and is charged identically.

## Semantic cases

Each worked example in `PROPOSAL.md` has a corresponding assertion: the four quadrant arithmetic
examples, the odd-split example, the round-to-zero example, the rent-cycle conservation example, and
the partial-fill failure case. The numbers in the proposal are the numbers the tests assert.

## Static-analysis dispositions

| Finding | Severity | Location | Disposition |
| --- | --- | --- | --- |
| `incorrect-equality` — `block.number == last` | Medium | `PoolRentHook._accrueRent` | Correct by construction: this is the early-return that makes accrual idempotent within a block. Block numbers are exact integers, not balances. Proven by `test_accrual_isIdempotentWithinOneBlock`. |
| `incorrect-equality` — `owed == 0` | Medium | `PoolRentHook._accrueRent` | A zero charge must not emit an event or touch state. Exact comparison is the intent. Proven by `test_accrual_withoutAManagerChargesNothing`. |
| `divide-before-multiply` | Medium | (resolved) | Replaced with `TickMath.minUsableTick` / `maxUsableTick`, which is the canonical helper for tick alignment. |
| `unused-return` on `settle()` | Medium | (resolved) | The settled amount is now compared against the amount owed and reverts on a mismatch. |
| `unused-return` on `donate` / `initialize` / `modifyLiquidity` | Medium | `PoolRentHook`, `PoolRentLauncher` | The returned deltas are validated by what follows: the donation is settled and the settlement amount is checked; the launch validates the liquidity delta against its declared caps and reverts on any unexpected sign. |
| `arbitrary-send-erc20` | High | (resolved) | The pull now uses `msg.sender`, which the function's first check pins to the immutable launch wallet. |
| `missing-zero-check` on `_launchWallet` | Low | (resolved) | The constructor rejects the zero address. |
| `reentrancy-benign` / `reentrancy-events` | Low | `PoolRentHook._afterSwap`, `_donateRent` | The only external callee is the immutable PoolManager, reached from inside its own callback while its lock is held, and WETH9, which has no callback. No untrusted contract can reenter. Covered by the stateful invariant suite, which asserts solvency after every generated sequence. |
| `uninitialized-local` | Medium | (resolved) | Both locals are now explicitly initialised to zero. |
| inline assembly | — | (removed) | The hook originally carried the `beforeSwap` charge into `afterSwap` through two `TSTORE`/`TLOAD` helpers. Solidity 0.8.26 has no language-level transient binding, and inline assembly forces an isolated maintainer review before intake, so they were replaced with two plain private storage slots that are written and cleared inside a single swap. All 181 tests pass unchanged. |
| `unsafe-typecast` (forge lint) | Medium | `PoolRentHook._afterSwap`, `PoolRentMath.toInt128` | Twelve narrowing casts, all guarded by the branch they sit in or by an explicit bound. Each `int128 -> uint256` cast runs inside a `quoteDelta > 0` / `quoteDelta < 0` branch, so the sign is known; `PoolRentMath.toInt128` compares against `type(int128).max` and reverts before casting. The fuzz suite drives these paths across the full magnitude range at 1000 runs per property. |
| `reentrancy-no-eth` | Medium | `PoolRentHook._afterSwap` | The only external callees are the immutable PoolManager, reached from inside its own callback while its lock is held, and the quote ERC-20. `test/Adversarial.t.sol` drives a reentrant quote token against every value-moving path and asserts the final state matches a non-reentrant sequence exactly. |
| low-level `call` in tests | — | `test/Adversarial.t.sol`, `test/Auction.t.sol`, `test/Fee.t.sol` | Test-only, and the only way to make the assertion at all. Proving that an *absent* function is unreachable cannot be written as a typed call — it would not compile — and proving that a rejected call returned a particular error requires reading the returned selector rather than letting the revert propagate. Every such call is a negative-authorization probe against the hook, carries a one-line reason at the call site, and asserts a revert. No contract under `src/` contains a low-level call. |
| `divide-before-multiply` | Medium | `PoolRentMath.accrue` | Deliberate and exact: `nextCarry = numerator - (amount * DENOMINATOR)` recovers the remainder from the quotient, which is the whole point of carrying the numerator. No precision is lost — the fuzz suite asserts `amount * DENOMINATOR + nextCarry == gross * rate + carry` for arbitrary inputs. |
| `unused-return` on `accrue` previews | Medium | `PoolRentHook._previewCharge`, `_grossForNet` | The preview paths need the payable amount but must not commit a remainder; discarding `nextCarry` is what makes them side-effect free. `_commitCharge` is the only writer, and the invariant suite asserts no non-swap action moves either remainder. |
| `cyclomatic-complexity` | Informational | `PoolRentHook._afterSwap` | The quadrant table is inherently four-way. Splitting it would hide which branch charges which currency, which is the one thing a reviewer most needs to see. |

## Evidence status

Counts, exact commands, tool versions, fuzz runs, invariant runs/depth/calls/reverts, fork block,
gas figures and contract sizes are recorded in `evidence/test-evidence.json` at the declared commit.
Nothing in this plan is marked passed on the strength of a previous revision's run.

Not covered, deliberately, and not claimed: independent security review, economic review, deployment,
source verification, runtime matching, monitoring, routing or provider support. Local tests and fork
runs are compatibility evidence. They are not a deployment receipt, an audit, or an approval.
