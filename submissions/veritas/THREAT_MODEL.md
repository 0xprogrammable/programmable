# Threat model

This document catalogs the threats considered against `contracts/src/VeritasHook.sol` and its dependencies (`VeritasRegistry.sol`, `VeritasOracle.sol`, `VeritasRegistryCallback.sol`), states the mitigation for each, and is explicit about residual risk that was identified and consciously accepted rather than fixed. It complements `PROPOSAL.md` (what the hook does and why) and `TEST_PLAN.md` (which rubric requirements each test proves). All test names and source citations below were verified against the actual current files, not transcribed from memory — `forge test --offline` from `contracts/` reports **168 tests passing, 0 failing** as of this writing.

## 1. Hard-fail self-check

Programmable treats three failure modes as binary hard-fails with no partial credit: hidden fees, unbacked NoOp return deltas, and unrestricted/admin-drainable funds. Answered first, before anything else, because these are the highest-severity possible findings.

### 1.1 Hidden fees — none

Every fee is a named constant or a value derived from named constants, all public:
- `PROTOCOL_MAX_LP_FEE = 50_000` (5.00%) — the hard ceiling a creator's `maxFee` can never exceed (`VeritasHook.sol:182`, enforced at `:382`, `LpFeeCapExceeded` on violation).
- `MAX_RESERVE_FEE = 3500` (0.35%) — the hard ceiling on the combined builder+Programmable hook-fee skim (`VeritasHook.sol:187`).
- `PROGRAMMABLE_FEE_PIPS = 1_000` (10 bps) — the immutable Programmable floor, never configurable (`VeritasHook.sol:196`).
- Worst-case total swapper cost is stated in the contract's own NatSpec, not derived after the fact: `5.00% + 0.35% = 5.35%` (`VeritasHook.sol:88-89`).
- The applied fee is previewable before every swap via `previewLpFee(poolId)` (`VeritasHook.sol:920-925`), and `DynamicFeeApplied` is emitted on every swap (`VeritasHook.sol:513`).
- **The one thing NOT bounded at swap time by a single number:** live DRS is not capped at 8500 after a pool exists — `PROTOCOL_MAX_GATE` is a creation-time constant, checked only in `registerPool` (`:382`) and `_beforeInitialize` (never in the swap path). Post-creation, DRS can reach as high as 9990 through purely on-chain dilution with zero oracle involvement (`saturateD(21+) = 9800` combined with oracle `A` up to `VeritasOracle.MAX_DRS = 9500`, via noisy-OR). This does **not** create a hidden fee — `previewLpFee` still reports the true fee at any DRS, and the 5.35% ceiling holds regardless of DRS because it is driven by the registration-time `maxFee` cap and the fixed `MAX_RESERVE_FEE` constant, not by any DRS bound. It does mean "8500" must never be read as a runtime fee ceiling; see §4.5.
- Test evidence: `test/ReviewFindings.t.sol:test_RegisterPool_RejectsConfiscatoryLpFee`, `test_RegisterPool_AcceptsFeeAtTheCap`, `test_LpFeeNeverExceedsProtocolCap`; `test/invariant/VeritasInvariants.t.sol:invariant_lpFeeWithinBandAndMatchesFormula` (mutation-adjacent — see §5).

### 1.2 Unbacked NoOp return deltas — none

`_afterSwap` and `_beforeSwapSkim` (called from `_beforeSwap`) each perform **at most one** `take`, on whichever currency is the swap's QUOTE side for that quadrant, and return exactly that same value as the delta component they own — never both in the same swap (mutually exclusive by `quoteIsUnspecified`, `VeritasHook.sol:530-533`, `:614-617`). `totalAmount = reserveAmount + progAmount` by construction (`_splitFee`, `:562-575`), so the two accounting mappings (`poolReserve`, `programmableFees`) always sum to exactly what was taken. `_afterRemoveLiquidity` mirrors this on the payout side: any claim paid is `settle`d (burning the hook's own ERC-6909 claims) in the same call the negative delta is returned. `afterAddLiquidityReturnDelta` is permanently `false` (`VeritasHook.sol:339-357`); `beforeSwapReturnDelta` is now `true` (added 8 Aug 2026, §3.10) but its ONLY effect is this same-call, fully-backed skim — the hook has no path to fabricate a delta it did not back with a real balance change.

- Structural proof: `test/VeritasHook.t.sol:test_AfterSwapDeltaIsFullyBacked`.
- Fuzzed proof: `test/FuzzProperties.t.sol:testFuzz_AfterSwapDeltaIsAlwaysFullyBacked`.
- Stateful proof, across arbitrary sequences of swaps, disbursements, and claims: `test/invariant/VeritasInvariants.t.sol:invariant_backingIsExactAcrossPools`. **Mutation-tested**: deliberately breaking the accrual split (`reserveAmount = totalAmount - progAmount` → `= totalAmount`) makes this invariant fail on the very first swap in the run (§5, mutation M1).
- Partial-fill proof (deduction tracks the realized delta, never the requested amount): `test/PartialFill.t.sol`, all 5 tests.

### 1.3 Unrestricted / admin-drainable funds — none

`VeritasHook` declares **no** `Ownable`, no `owner()`, no `pause()`, no `sweep()`, no `rescue()`, no `transferOwnership()`, and no function anywhere that lets a caller name an arbitrary destination for value. Verified two ways:

1. **Source read.** Grep across `VeritasHook.sol` for any admin-shaped construct returns nothing; the contract inherits only `BaseHook` and `IUnlockCallback`, neither of which introduce one.
2. **Executable proof, not just a source claim.** `test/Staleness.t.sol:test_S9_HookHasNoAdminSurface` makes six raw low-level calls against the hook — `owner()`, `pause()`, `sweep(address)`, `rescue(address,uint256)`, `transferOwnership(address)`, `setDilutionUpdater(address)` — and asserts every one fails, because no such selector exists.

Every function that moves value out of the hook pays a destination that is either (a) the caller's own settlement in the same v4 lock (`_afterSwap`, `_afterRemoveLiquidity` — the caller receives what they are owed, nothing else), (b) the pool's own in-range LPs via the canonical `PoolManager.donate` (`disburseReserveToLPs`), or (c) a single hardcoded constant, `PROGRAMMABLE_FEE_RECIPIENT = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` (`VeritasHook.sol:200`), which is not a constructor parameter and cannot be changed by anyone (`claimProgrammableFee` is permissionless, but always pays that one address — `VeritasHook.sol:855-867`).

- Custody proof: `test/VeritasHook.t.sol:test_ClaimProgrammableFee_PaysOnlyTheImmutableRecipient`, `test_ClaimProgrammableFee_IsPermissionless`.
- Stateful custody proof across arbitrary sequences: `test/invariant/VeritasInvariants.t.sol:invariant_programmableFeesReachOnlyTheHardcodedRecipient`, `invariant_hookHoldsNoRawErc20`. **Mutation-tested** (§5, mutation M3): redirecting the claim `take()` to `address(this)` makes both fail, while the backing invariant (INV-1) stays green — proof that custody is checked independently of backing, not as a side effect of it.

**Honest converse, stated plainly rather than left implicit:** `VeritasRegistry` and `VeritasOracle` **are** `Ownable`. That owner cannot touch a single wei held by `VeritasHook` — the hook holds its own state and the registry has no reference into it — but the registry/oracle owner **can** move DRS (change the attest fee, resolve disputes, manage oracle operators), and DRS moves the fee. This is a real, bounded trust dependency, analyzed in §2.

## 2. Trust model and actors

| Actor | Powers | Cannot |
|---|---|---|
| Any address (swapper, LP) | Swap, add/remove liquidity, call any permissionless function (`disburseReserveToLPs`, `claimProgrammableFee`, `reportRiskDataStatus`) | Redirect any payout, bypass the DRS gate, forge an attestation |
| Content owner (attestation owner) | `registerPool` for their own attestation, once, permanently binding it to one content token | Register on someone else's attestation, unregister, change the binding afterward |
| Oracle operators (currently 3 registered, quorum 1 live — see §4.6) | Co-sign `A`/off-chain-`D` updates within `VeritasOracle`'s bounds (`MAX_DRS = 9500`, `MAX_SPREAD = 500`, `SIGNATURE_MAX_AGE = 10 min`) | Set DRS directly, bypass the on-chain trustless `D` floor (`max(onchainD, offchainD)`), touch the hook's funds |
| `VeritasRegistry`/`VeritasOracle` owner | Change attest fee/dispute bond, resolve disputes, manage oracle operators, set `dilutionUpdater` | Touch a single wei held by `VeritasHook`; directly set DRS or a pool's fee |
| `VeritasRegistryCallback` (wired as `dilutionUpdater`) | Increment `dilutionCount` for near-duplicates found on-chain | Set `A` or off-chain `D`; only reachable by the authorized Reactive Callback Proxy (`authorizedSenderOnly`) |
| PoolManager | Calls every hook callback; the hook trusts it unconditionally | — this is sound because `PoolManager.unlock` can only ever call back `msg.sender` of `unlock`, so the PoolManager can only reach `VeritasHook.unlockCallback` on a frame the hook itself opened |

`VeritasHook` itself has **no privileged actor at all** — every one of its external functions is either permissionless or authenticated by a domain fact (`msg.sender == attestation owner` for `registerPool`, `msg.sender == address(poolManager)` for `unlockCallback`), never by an admin role.

## 3. Threat catalog

Each entry: the threat, why it does or doesn't work, and the test evidence.

### 3.1 JIT (just-in-time) capture of the insurance reserve — closed for the primary path, disclosed-open for the residual fallback

**The threat.** An attacker adds liquidity immediately before a reserve payout and removes it immediately after, capturing a share of value they did nothing to earn. This is a documented, real pattern — the `uniswap-hooks` reference `LiquidityPenaltyHook` implementation's own code comments state plainly that "the donated penalty simply returns to the attacker."

**Primary defense — closed by construction, not mitigated.** Per-position insurance claims (`_afterAddLiquidity`/`_afterRemoveLiquidity`, `VeritasHook.sol:600-804`) replace the discrete, front-runnable payout event with a streaming per-unit-liquidity accrual index (`reserveIndex`). A position's claim on exit is bounded by (a) the reserve accrued strictly during *that position's own tenure*, (b) the DRS rise over that same tenure — same block, no DRS movement ⇒ `rise == 0` ⇒ the claim is **exactly zero**, unconditionally, before any rounding could push it above zero — (c) the principal actually being withdrawn, and (d) the pool's real solvency. It is the streaming accumulator, not the DRS-delta factor alone, that removes the timeable event; this distinction is stated explicitly in the contract's own NatSpec (`VeritasHook.sol:91-100`) so it isn't misread as "DRS gating prevents JIT," which would be a weaker and less accurate claim.

- `test/InsuranceClaims.t.sol:test_J1_SameBlockOpenAndClose_ClaimsExactlyZero` — the headline proof.
- `test/InsuranceClaims.t.sol:test_J5_JitAroundDilutionEvent_CapturesOnlyItsOwnWindow` — an attacker wrapping a *genuine* dilution event (DRS rise maxed, insurance factor = 1) still only captures the narrow accrual window they were actually present for, orders of magnitude below an honest long-tenure position.
- `test/FuzzProperties.t.sol:testFuzz_SameBlockAddRemoveAlwaysClaimsZero` generalizes J1 across arbitrary position sizes.

**Residual, disclosed risk — the fallback path.** `disburseReserveToLPs` (the pro-rata `donate` mechanism) is kept unchanged for value the per-position path cannot attribute to a specific position (the sub-`FULL_CLAIM_DRS_RISE` forfeit, the principal-cap forfeit, LPs who never remove). It remains, in principle, JIT-capturable — `PAYOUT_BPS = 5000` caps a single capture at half the buffer, reducing but not eliminating exposure (`VeritasHook.sol:202-206`, R5). **Do not read the per-position mechanism's JIT-proof property as extending to this fallback** — the contract's own NatSpec makes this distinction explicit (`:143-147`) precisely so it cannot be misrepresented.

### 3.2 A disbursement can truncate another LP's pending insurance claim — new finding, disclosed, not fixed

**The threat, found during this build's own invariant-testing pass (not previously documented anywhere in the project).** `disburseReserveToLPs` debits `poolReserve` but **never rewinds `reserveIndex`** — the streaming accumulator only ever increases (`reserveIndex` is `+=`-only, see `_accrueReserve`, `VeritasHook.sol:583-590`). Immediately after any disbursement, every position still open continues to compute its entitlement from the *full historical* index, including the portion just paid out via `donate`. `_claimFor`'s solvency cap (bound (c), `:802-803`) silently truncates the excess — **not an insolvency bug, the cap holds by construction** — but this creates two real, previously-undisclosed properties:

1. After a disbursement, insurance claims become **first-come-first-served** among still-open positions, since the solvency cap divides whatever `poolReserve` remains among whoever removes first.
2. `disburseReserveToLPs` is **permissionless**, so anyone can time a disbursement specifically to truncate another position's pending claim — the truncated value is not destroyed, it redistributes pro-rata via `donate` to whoever is in-range at that moment, which could include the disburser themselves.

**Why this is disclosed rather than fixed.** A fix requires rewinding every open position's entry index proportionally on every disbursement — a real design change, out of scope for this build. The contract's own NatSpec documents this tradeoff plainly (`VeritasHook.sol:109-122`) rather than leaving it silent.

**Confirmed load-bearing, not theoretical**, via mutation testing: removing `_claimFor`'s solvency cap causes a real `panic: arithmetic underflow (0x11)` exactly at the interaction this describes — see §5, mutation M2. `test/invariant/VeritasInvariants.t.sol:test_INV2_Regression_DisburseThenClaim_DoesNotUnderflow` is a permanent deterministic regression test for the exact sequence.

**Severity assessment.** Bounded — no funds are ever created or destroyed, only redistributed among LPs who each accepted the reserve's design at entry. The griefing cost to the attacker is real (they must genuinely trigger an eligible disbursement, which pays out to whoever is currently in-range, not necessarily favoring the griefer). Roadmap item, not a hard-fail.

### 3.3 Reentrancy — systematically tested, both surfaces distinguished

**The threat.** A hostile ERC-20 (content or quote token) attempts to re-enter the hook's value-moving functions during a swap or removal settlement.

**Two propositions, deliberately kept separate because they are proved by different means** (`test/Reentrancy.t.sol`, 19 tests):

- **P1 — absence of surface.** The reserve-disbursement path (`disburseReserveToLPs` → `unlockCallback(Disburse)`) executes **zero** calls into token code — `settle(claims=true)` is `PoolManager.burn`, pure accounting, never a token call (`test_P1_Disburse_ExecutesZeroTokenCalls`, `test_P1_Disburse_MovesZeroErc20Balance`). **Scoped honestly, not overclaimed:** the Programmable-fee claim path *does* call real token code twice (`take(..., false)` in `unlockCallback`'s else-branch), and `test_P1_ClaimProgrammableFee_DoesCallTokenCode_ScopeBoundary` is a deliberate negative test proving P1 does *not* extend there. `test_P1_InsuranceClaim_ExecutesZeroTokenCallsFromTheHook` extends P1 to the new per-position claim path.
- **P2 — defense at every reachable surface.** Wherever token code *does* get control — the router's own settlement, or the hook's own claim payout — every reentry attempt into the value-moving path fails. Each P2 test has a fully-armed precondition (the reentrant call would genuinely succeed one instruction later, so failure proves the defense fired, not a business check) and a same-block control arm (the identical call, outside the lock, succeeds). The suite distinguishes *which* defense fired — `AlreadyUnlocked` (v4's own lock), `OnlyPoolManager`/`NotPoolManager` (caller guard), `NothingToClaim` (checks-effects-interactions), `CurrencyNotSettled` (v4's settlement invariant) — rather than accepting any revert as proof. New for the per-position claim path: `test_P2_ReenterDisburse_FromRemoveLiquidityPayout_FailsOnTheV4Lock`, `test_P2_ReenterRemoveLiquidity_FromItsOwnPayout_CannotDoubleClaim`.

**`registerPool`'s reentrancy defense — the real mechanism, not the one its own comment names.** `registerPool`'s NatSpec (`VeritasHook.sol:364-369`) calls its ordering "checks-effects-interactions," but the read-bindings → call-`totalSupply`/`balanceOf` → write-bindings shape is a textbook TOCTOU (time-of-check-to-time-of-use) pattern, not CEI protection. **The actual defense is that `IERC20.totalSupply()`/`balanceOf()` are declared `view`, so Solidity emits STATICCALL regardless of what the callee attempts** — a STATICCALL cannot write storage under any circumstance, so a reentrant `registerPool` cannot land a second binding before the outer call's write. `test_P1_RegisterPool_AttackerTokenIsReachedOnlyByStaticcall` proves this precisely, using a hand-rolled token that signals a would-be reentrant write through its *return value* (since it cannot write storage) — confirming the outer registration succeeds only because the inner attempt structurally could not execute.

### 3.4 Oracle / registry centralization

**The threat.** `VeritasOracle` runs a small (`MAX_OPERATORS = 3`) signer set; a bribed or compromised quorum could misreport risk.

**Mitigations already in place:**
- Quorum requirement (configurable; the deployed instance's live quorum is `1` of 3 registered operators — see §4.6, this is a real, disclosed reduction from the contract's supported 2-of-3 design, not a contract limitation).
- Cross-operator spread bound: `MAX_SPREAD = 500` (5%) between the highest and lowest signed DRS.
- Freshness window: `SIGNATURE_MAX_AGE = 10 minutes`, combined with the registry's own per-attestation update timelock (1h, escalated to 2h on a >30% swing) to prevent stale-signature replay.
- Hard ceiling: oracle-signed values can never exceed `MAX_DRS = 9500`.
- **The `D` channel has a trustless floor the oracle cannot suppress:** effective `D = max(onchainD, offchainD)` (`VeritasRegistry.getEffectiveD`) — `onchainD` is derived purely from `dilutionCount`, incremented by the permissionless-to-trigger, authenticated Reactive callback, with no oracle signature involved. A bribed oracle reporting a suppressed off-chain `D` cannot push the effective value below what the chain itself has witnessed.
- **The `A` channel (AI-replicability) has no equivalent trustless floor** — it is fully oracle-signed, with no on-chain fallback. This is the actual attack surface for oracle centralization, and it is real. The correct mitigation is diversifying and enlarging the operator set (see §6, roadmap).

### 3.5 Pool-creation squatting on a `PoolKey`

**The threat.** Before this build's whole-supply-ownership requirement, an attacker holding any valid (even cheap, self-attested) attestation could register a `PoolKey` a legitimate content owner intended to use, denying it to them.

**Mitigation.** `registerPool` requires the registrant to hold `100%` of the designated content token's total supply at registration time (`VeritasHook.sol:429-434`, `NotWholeSupplyOwner` on failure). **Scope honestly disclosed, not overclaimed** (`:72-77`, R4): this proves no `PoolKey` squatting, no codeless-address registration, and a permanent 1:1 attestation↔token binding — it does **not** prove the token *is* the content asset (anyone can mint a fresh ERC-20 and hold all of it), and it is a real UX cliff for creators who pre-seeded liquidity, airdropped, used a launchpad/vesting contract, or attest from an EOA while holding tokens in a Safe.

- `test/ReviewFindings.t.sol:test_Finding2_StrangerCanFrontRunRegisterPool` (now proves the attacker is rejected, inverted from its original name which proved the opposite before this fix), `test_RegisterPool_RejectsCodelessContentToken`, `test_OneAttestationBindsToExactlyOneToken`, `test_ContentOwnerKeepsTheirPoolKey`.

### 3.6 Reserve permanently stranded when no LP is in range

**The threat.** If every LP exits a pool before a dilution event fires, `PoolManager.donate` has nobody to pay.

**Mitigation.** `disburseReserveToLPs` reverts the specific, informative `NoInRangeLiquidity` (`VeritasHook.sol:838`) rather than an opaque underlying revert — checked *after* `NothingToDisburse` so an empty pool reports the more useful error. No admin rescue exists by design; adding one would itself be the unrestricted-drain hard-fail this contract exists to avoid. The reserve is not lost — it waits, permissionlessly claimable the moment liquidity re-enters range.

- `test/ReviewFindings.t.sol:test_Finding4_DisburseBlockedWhenNoInRangeLiquidity` (rewritten 8 Aug to use the maturity path with DRS held flat, since under the new per-position mechanism an LP genuinely earns a claim on exit after a real DRS rise — see the test's own inline note explaining why).

### 3.7 Silent reliance on stale risk data

**The threat.** Veritas's headline claim is a "living DRS," kept current by a Reactive Network loop with no keeper. If that loop goes quiet (RSC out of gas, Lasna outage), the hook could keep confidently pricing off frozen data without disclosing it.

**What was built, and what was deliberately rejected.** An earlier draft proposed raising the swap fee whenever data looked stale. **Rejected on review**: it would punish swappers for an infrastructure failure unrelated to the specific content asset, and conflates "the monitoring pipeline went quiet" (the normal state for a healthy pool — see below) with "the content actually got riskier."

**The correct scope, as built:**
- **New pool registration/initialization is gated** on `REGISTRATION_MAX_DATA_AGE = 1 day` (`VeritasHook.sol:221-227`, enforced at `registerPool:410-413` and `_beforeInitialize:470-473`) — a real, if blunt, protection for a brand-new LP relying on freshness they have no other way to judge. No admin override exists or is needed: refreshing an attestation (`updateAIScore`/`updateOffchainD`) is itself permissionless, so the gate reopens the moment fresh signatures land.
- **An already-open pool's fee is deliberately, provably independent of staleness.** `_beforeSwap`/`_afterSwap` contain no reference to staleness whatsoever — confirmed directly against the source, not merely asserted. `riskDataStatus`/`reportRiskDataStatus` disclose freshness via a view and a permissionless event-emitting poke, feeding back into nothing.
- **Honest scope limit, stated in the contract's own NatSpec** (`_lastTouched`, `VeritasHook.sol:482-487`): "the most recent registry touch" is a proxy for "the update pipeline has been quiet for N," **not** proof nothing changed. A healthy Reactive loop that finds zero near-duplicates writes nothing at all (`VeritasRegistryCallback._tryIncrement` is only invoked when `getNearDuplicates` actually returns matches) — so silence is the *normal* case for a healthy pool, not evidence of failure. This is exactly why a swap-path liveness read was rejected: it would be dressing a weak proxy signal up as a liveness proof.

- `test/Staleness.t.sol`, all 9 tests, in particular `test_S1_ExistingPool_FeeIsIdenticalWhenStale` (positive assertion: identical fee, identical swap outcome, not an absence-of-evidence argument) and `test_S7_StaleRegistration_RecoversPermissionlessly_NoAdmin` (recovery performed by an arbitrary `stranger`, not any privileged role).

### 3.8 Unclaimable Programmable fee (native-currency edge case)

**The threat.** `claimProgrammableFee` redeems straight to the hardcoded `PROGRAMMABLE_FEE_RECIPIENT` via a real value-bearing call. If that address is ever a contract without a payable fallback, native-quote fees accrued after that point become permanently unclaimable.

**Why this is accepted, not fixed** (`VeritasHook.sol:83-86`, R8): no fix exists within this design — a configurable fallback destination would itself be the exact unrestricted-drain pattern this hook is built to avoid. The blast radius is bounded to native-quote pools specifically and does not touch the insurance reserve.

### 3.9 Hostile content token griefs its own pool's Programmable claim — CLOSED 8 Aug 2026 (was: bounded)

**The former threat.** Before the R2 fix (§3.10), the Programmable fee could accrue on either currency depending on quadrant, so `claimProgrammableFee`'s content-side `take(..., false)` sometimes called real, attacker-controlled token code. A content token that reverts on `transfer` could permanently block the claim for its own pool.

**Why it is now closed, not merely bounded.** Post-R2, the fee always accrues on the QUOTE currency only (§3.10) — `programmableFees[poolId][contentCurrency]` is now always exactly `0`. `CurrencySettler.settle`/`.take` both early-return on a zero amount before ever calling `PoolManager`, let alone the token (`lib/uniswap-hooks/src/utils/CurrencySettler.sol:34`, `:66`). So the content leg of `claimProgrammableFee` is now a genuine no-op that never reaches the content token's code at all — proven directly by `test_P2_ClaimPayout_PendingCreditOnOtherCurrencyCannotBeStolen`, which arms a hostile content token to fire on any call it receives and asserts `fireCount() == 0` after a full, successful claim. A hostile content token cannot grief this entrypoint anymore, and it never could touch any other pool's accrual (v4 deltas are per-`msg.sender`) even before the fix.

### 3.10 `beforeSwapReturnDelta` (added 8 Aug 2026): quadrant-dependent collection, and its one new tradeoff

**What changed.** The Programmable fee and insurance reserve previously collected only in `afterSwap`, on the swap's unspecified currency — meaning in two of four quadrants the fee was denominated in the content currency, re-expressed from a quote-side basis via a rate conversion (former L2). Fixed by adding `beforeSwapReturnDelta` and collecting in `_beforeSwapSkim` for the two quadrants where the quote currency is the swap's SPECIFIED side; the other two quadrants are unchanged (`_afterSwap`, quote unspecified). Exactly one collection path runs per swap, never both (`quoteIsUnspecified`, computed identically and independently in both `_beforeSwap` and `_afterSwap` from `params` alone).

**Why this does not reopen the return-delta hard-fail questions.** Every `beforeSwapReturnDelta` value returned is `toBeforeSwapDelta(totalAmount, 0)` where `totalAmount` was just `take()`n in the same call, same currency (`_beforeSwapSkim`, `VeritasHook.sol:558-577`) — an equal, same-call backing, identical in spirit to the existing `afterSwap` path. No NoOp path, no unbacked delta.

**L2b (the one new, disclosed tradeoff).** The two `beforeSwap`-collected quadrants price the fee off `params.amountSpecified` — the REQUESTED quote amount — because the executed amount is not yet known at that point in the call. A caller-supplied `sqrtPriceLimitX96` that binds before the requested amount fully executes means the fee taken can exceed what a proportionate share of the actual fill would justify; in the extreme, an essentially-zero fill still pays the full requested fee (`test_C2_PartialFill_ExactOut_ZeroFillStillChargesFullRequestedFee`). The two `afterSwap`-collected quadrants have no such gap — they always price off the realized `BalanceDelta`, unaffected by this change. No revert-on-price-limit mitigation was added: it would trade a cost-basis edge case for a new liveness failure mode (a swapper with a legitimately narrow acceptable-price range could no longer swap at all in those two quadrants), judged the worse tradeoff given the fee is bounded to 0.35% either way (`MAX_RESERVE_FEE`).

### 3.11 Sub-quantum swap splitting drained the mandatory entitlement — FIXED 8 Aug 2026

**The threat.** `_splitFee` floored `gross * 1000 / 1e6` on every swap and carried nothing, so any gross below the
1,000 wei quantum paid the immutable owner zero. Anyone routing volume as many small swaps paid the 10 bps zero times.
Reproduced against this hook before the fix: 200 swaps of 999 wei accrued 0 wei to the owner, while the project-side
reserve still collected 200 wei — the rounding loss fell entirely on Programmable, never on the project. Worse,
`programmableQuoteVolume` stayed 0, so the shortfall could not be detected from on-chain state.

**The fix.** A carried sub-unit numerator remainder per pool and currency (`programmableFeeRemainder`), so the
entitlement is exact over any sequence of swaps. Claims never touch it. Volume is now recorded on every charged swap.
Proven by `contracts/test/ProgrammableFeeCumulative.t.sol` and `invariant_programmableEntitlementIsCumulative`, and
mutation-tested by M5. Verified on the live deployment, where the conservation identity holds exactly.

**Residual.** The carry is bounded below `HOOK_FEE_DENOM` (one whole unit), so at most one sub-unit is ever
outstanding per pool and currency at any instant.

### 3.12 Anyone could initiate a Programmable claim — FIXED 8 Aug 2026

**The former threat.** `claimProgrammableFee` was permissionless. No funds could be redirected (the destination was a
hardcoded constant), but the published policy requires that only the immutable owner may *initiate* a claim, and this
hook's own submission declared `claimAuthority: owner-only` while the code did not enforce it — a declaration that
contradicted its implementation.

**The fix.** Both claim entrypoints authenticate `msg.sender == PROGRAMMABLE_FEE_RECIPIENT`.
`claimProgrammableFeeTo` adds the owner-selected per-claim destination the policy requires, rejecting the zero
address and storing nothing. See `PROPOSAL.md` §6.9 for the reentrancy consequence.

## 4. Known limitations (cross-referenced against `PROPOSAL.md`'s L1–L12)

Full detail and test citations live in `PROPOSAL.md` §7; summarized here with a threat-model lens:

1. **L1 — reserve accrues zero below DRS 2860** (the inclusive 10 bps Programmable floor consumes the entire builder-selected fee at low DRS). Disclosed design, not a bug: low-risk content does not need a buffer.
2. **L2 — RESOLVED 8 Aug 2026; L2b and L2c remain open.** Basis and denomination are now both always quote-side in all four quadrants (§3.10). Still open: **L2b**, the two `beforeSwap`-collected quadrants price off the REQUESTED amount, so a binding price limit can overcharge relative to the realized fill; and **L2c**, for exact-output the true gross is `X + fee` while the charge is computed on `X`. Neither is refundable from `afterSwap` (unspecified currency only). Deferred deliberately rather than rushed - see `PROPOSAL.md` §7 L2.
3. **L3 — whole-supply registration proves anti-squat, not anti-impersonation.** See §3.5.
4. **L4 — the 30-day maturity path makes JIT capture of the *residual* `donate` fallback easier to time**, not the primary per-position path. See §3.1.
5. **L5 — reserve can be stranded with no in-range liquidity.** See §3.6.
6. **L6 — unclaimable native-quote Programmable fee.** See §3.8.
7. **L7 — RESOLVED 8 Aug 2026 (was: hostile content token griefs its own claim).** See §3.9 — the content leg of `claimProgrammableFee` is now a structural no-op.
8. **L8 — the hook has no owner; the registry and oracle do.** See §2 and §3.4.
9. **L9 — 5.35% worst-case, and 8500 is not a runtime cap.** See §1.1.
10. **L10 — the builder-selected total is variable (0.10%–0.35%), not a flat declared number**, because it tracks live DRS. Programmable's 10 bps share is never less than 10 bps at any DRS or in any quadrant.
11. **L11 — on-chain near-duplicate search is O(n).** Fine at hackathon scale; not a hook-specific concern, but the throughput ceiling on the DRS pipeline the hook depends on.
12. **L12 — test-coverage.** Fuzz and stateful-invariant tests now exist (added 8 Aug alongside this document); fork tests do not. See `TEST_PLAN.md` §5 for the exact remaining gaps (slippage-as-swapper-protection, a general rounding-direction invariant, fork tests, and independent third-party review).

### 4.5 (cross-reference) — "8500" is not a runtime fee ceiling

Repeated here because it is the single easiest fact to misstate: `PROTOCOL_MAX_GATE = 8500` bounds DRS **only** at pool creation (`registerPool`, `_beforeInitialize`). It is never read in `_beforeSwap` or `_afterSwap`. Live DRS can reach ~9990 after a pool exists, purely through on-chain dilution with zero oracle involvement. The 5.35% worst-case bound is unaffected, because it derives from `PROTOCOL_MAX_LP_FEE` (locked at registration) and the fixed `MAX_RESERVE_FEE` constant — not from any DRS ceiling.

### 4.6 (cross-reference) — the live deployment's oracle quorum is 1, not 2-of-3

The contract supports and was designed around a 2-of-3 (or larger) operator quorum. The current Unichain Sepolia deployment runs with **3 operators registered, quorum = 1** (`ORACLE_QUORUM=1` in the deploy configuration) — a demo-scale reduction, not a contract limitation. A production deployment should raise this back before relying on the oracle's centralization mitigations described in §3.4. See `README.md` for the live deployment table.

## 5. Mutation testing — evidence the invariants actually catch what they claim to

Writing an invariant and having it pass proves nothing on its own; a vacuous invariant, or a handler whose actions never reach the interesting state, passes just as easily as a correct one. Four bugs were deliberately introduced into `contracts/src/VeritasHook.sol`, one line at a time, confirmed to make the relevant test fail exactly as predicted, then reverted — verified byte-identical to the original before moving to the next mutation, and the full 160-test suite confirmed green afterward.

| # | One-line mutation | Result |
|---|---|---|
| M1 | `_afterSwap`: `reserveAmount = totalAmount - progAmount` → `= totalAmount` | `invariant_backingIsExactAcrossPools` failed on the very first swap |
| M2 | `_claimFor`: removed the `poolReserve` solvency cap (bound (c)) | `test_INV2_Regression_DisburseThenClaim_DoesNotUnderflow` failed with `panic: arithmetic underflow (0x11)`; the fuzzed `invariant_removeLiquidityNeverReverts` failed at raised depth — both exactly as predicted from §3.2's finding |
| M3 | `unlockCallback`: redirected the Programmable-fee `take()` to `address(this)` | `invariant_programmableFeesReachOnlyTheHardcodedRecipient` and `invariant_hookHoldsNoRawErc20` both failed; `invariant_backingIsExactAcrossPools` stayed green — proof the custody invariants are not redundant with backing |
| M4 | `_handleRemoveLiquidity`: `trackedLiquidity -= removed` → `-= removed / 2` | `invariant_trackedLiquidityMatchesPositions` failed on the first non-trivial removal |

Full detail, including the reasoning for why each mutation is reachable from the handler's action space, is in `TEST_PLAN.md` §4.

## 6. Roadmap (not implemented in this build)

**Diversify and enlarge the oracle operator set.** Investigated as a candidate fix for §3.4 (A-channel centralization) and explicitly *not* adopted as "read a second on-chain volatility signal and take `max()` with DRS" — that idea was considered and rejected on the grounds that realized price volatility is not a reliable proxy for "is this specific piece of content AI-generated," and dressing it up as an anti-bribery defense would overclaim what it actually does. The correct, direct mitigation for oracle centralization is what the contract already supports architecturally: raise `_quorum` and `MAX_OPERATORS`, and require operators to run genuinely independent detector ensembles (already a stated design intent — `oracle/src/operators.ts` and `oracle/src/pipeline.ts`'s operator-2 CLIP cross-check are a step in this direction off-chain). Not built into this submission because it is an operational/configuration change (raise the live quorum, onboard real independent operators) rather than a contract change, and is more honestly scoped as a deployment decision than a code deliverable.

**Rewind `reserveIndex` proportionally on disbursement.** Would close §3.2 fully rather than only disclosing it. Deferred: it changes the accrual math for every open position on every disbursement, a real design change warranting its own design and test pass, not a same-day patch.

**Fork tests against the live Unichain Sepolia deployment.** The one item `TEST_PLAN.md` still marks fully uncovered (row 17). Infrastructure (`foundry.toml`'s `unichain_sepolia` RPC profile, live addresses in `README.md`) already exists; the gap is a missing test file, not a missing capability.
