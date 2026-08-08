# Proposal

All source citations in this document are `path:line` references verified against the live repository. All test names are verified to exist via `grep -rn "function test_NAME" contracts/test/` at the time of writing. Where a claim is a corrected figure (see §4.3), the correction is stated explicitly rather than silently.

## 1. Summary

Veritas turns a content asset's provenance into a live, on-chain risk score — the Dilution Risk Score (DRS, `0..10000`) — and uses a single Uniswap v4 hook, `VeritasHook`, to price that risk directly into the pool: it can refuse to let a diluted asset's pool exist at all, it charges a DRS-calibrated dynamic LP fee with zero staleness, and it skims a self-funding LP insurance reserve from realized swap volume. A companion 10 bps Programmable Pools fee is collected alongside the reserve from the same single `take`. DRS is derived live from two independent channels — an on-chain trustless duplicate-density floor and an oracle-signed off-chain signal — combined by `max()` and noisy-OR, and kept current with no keeper via a Reactive Network subscription (`contracts/src/reactive/DilutionMonitorRSC.sol`, `contracts/src/VeritasRegistryCallback.sol`).

## 2. What the hook actually does

`VeritasHook` (`contracts/src/VeritasHook.sol`) implements six callbacks against `PoolManager`. `_beforeInitialize` (`:456-480`) vetoes pool creation whenever the pool's live DRS exceeds the gate threshold its content owner committed to at registration, whenever no Veritas configuration exists for that `PoolKey` at all, or whenever the attestation's risk data has gone stale past `REGISTRATION_MAX_DATA_AGE` (§6.6). `_beforeSwap` (`:499-515`) reads live DRS and returns `lpFee | LPFeeLibrary.OVERRIDE_FEE_FLAG` (`:514`), overriding the pool's dynamic LP fee on every swap — provably independent of the staleness gate, since staleness is never read here. `_afterSwap` (`:526-573`) reads the swap's own realized `BalanceDelta`, performs exactly one `take` against the unspecified currency (`:564`), and returns exactly one `int128` equal to that same take (`:572`) — split between the Programmable fee and the insurance reserve in two accounting mappings, never two takes. `_afterAddLiquidity`/`_afterRemoveLiquidity` (`:600-804`, added 8 Aug alongside the staleness gate) track each LP position's own insurance tenure and pay a JIT-proof per-position claim on exit (§6.6). `disburseReserveToLPs` is the permissionless exit for reserve value the per-position mechanism cannot attribute to a specific position; it routes value only to the pool's own in-range LPs via `poolManager.donate`. `claimProgrammableFee`/`claimProgrammableFeeTo` are OWNER-ONLY (`NotProgrammableFeeOwner` for any other caller), matching the published policy that only the immutable owner may initiate a claim, with an owner-selected per-claim destination that is never stored.

## 3. Why this must be a hook

Three claims, strongest first. Two of them are things a non-hook contract cannot do at all. The third is not — it is a claim about *quality*, and it is marked as such rather than inflated.

### 3.1 Tier 1 — Refusing to let a pool exist

`_beforeInitialize` (`contracts/src/VeritasHook.sol:328-347`) reverts when the content asset's Dilution Risk Score exceeds the threshold its creator committed to at registration (`PoolGated`, `contracts/src/VeritasHook.sol:343`). The pool is not created. There is no pool to trade against, no LP position to open, no price to quote.

This cannot be built anywhere else in Uniswap v4. `PoolManager.initialize` is `external`, has no access-control modifier, and takes an arbitrary `PoolKey` from any caller (`contracts/lib/uniswap-hooks/lib/v4-core/src/PoolManager.sol:117`). The only thing it does before writing pool state is `key.hooks.beforeInitialize(key, sqrtPriceX96)` (`contracts/lib/uniswap-hooks/lib/v4-core/src/PoolManager.sol:130`). A `beforeInitialize` hook is the *sole* revertable choke point on pool creation in the entire protocol. A registry contract, a factory, a governance module, a permissioned router — none of them can stop `PoolManager.initialize` from succeeding, because none of them are called.

So the question "can a pool for this asset exist at all?" has exactly one on-chain answer surface in v4, and it is a hook callback. Veritas uses it, and uses it in the direction that is hard rather than easy: it says *no*, permanently, to pools it will not underwrite. `contracts/test/Integration.t.sol:test_Demo_ThreeContentTiers` is the proof — three content assets, three DRS tiers, and the third one's pool does not come into existence.

Two details make this a real gate rather than a decoration. First, the check runs **twice**: once at `registerPool` (`contracts/src/VeritasHook.sol:287-288`), and again at the exact moment of initialization (`contracts/src/VeritasHook.sol:342-343`), because DRS is live and may have moved in between. `contracts/test/VeritasHook.t.sol:test_BeforeInitialize_ReverifiesGateAtInit` registers a pool at low DRS and then fails its initialization once DRS has risen past the gate. Second, a pool with no Veritas configuration at all cannot be initialized through this hook either (`NotConfigured`, `contracts/src/VeritasHook.sol:337`) — the address's permission bits are CREATE2-mined (`contracts/script/Deploy.s.sol:54-60`), so no one can attach this hook to a `PoolKey` it has not vetted.

### 3.2 Tier 2 — Taking a cut of a swap that has not finished yet

`_afterSwap` (`contracts/src/VeritasHook.sol:380-430`) reads the in-flight swap's own `BalanceDelta` (parameter at `contracts/src/VeritasHook.sol:384`) — the realized, executed amounts, after price impact, after the LP fee, after any partial fill — and returns an `int128` that v4 folds into the swapper's outstanding delta before the transaction's settlement invariant is checked (`contracts/lib/uniswap-hooks/lib/v4-core/src/libraries/Hooks.sol:295-303`).

This is also not reproducible outside a hook, and for a more fundamental reason than Tier 1: **the object it operates on does not exist anywhere else.** The `BalanceDelta` handed to `afterSwap` is a transient value inside `PoolManager.swap`. By the time any external contract could observe the swap — one `unlock` frame later, one block later — the delta has been settled and destroyed. You cannot skim a swap that already closed. You can only tax the *next* one, or ask people to pay voluntarily, or wrap the router and hope nobody routes around you.

Everything the reserve does depends on this. The skim is `MAX_RESERVE_FEE` (`contracts/src/VeritasHook.sol:123`) scaled by live DRS (`contracts/src/VeritasHook.sol:409-411`), applied to *this* swap's realized unspecified-side volume, so a partial fill contributes exactly its realized share and not a wei more — `contracts/test/PartialFill.t.sol:test_C2_SameRequest_FullVsPartial_DeductionScalesWithRealized` runs the same request against a full-fill pool and a partial-fill pool and shows the absolute deduction differs while the *rate* stays consistent. And because the hook takes and returns one number, in one currency, in one place (`contracts/src/VeritasHook.sol:418,429`), the returned delta is backed by construction rather than by promise: `contracts/test/VeritasHook.t.sol:test_AfterSwapDeltaIsFullyBacked` asserts the hook's ERC-6909 claim balance equals the sum of its two accounting mappings, exactly, with no slack.

The same is true of the Programmable protocol fee (`contracts/src/VeritasHook.sol:398-407`). It is assessed on the executed gross quote-side volume of the swap that is happening right now. "The swap that is happening right now" is a thing only a hook can see.

### 3.3 Tier 3 — Reading DRS inside `beforeSwap`, and why that is a quality argument, not an impossibility one

This is not framed as impossible without `beforeSwap`, because it is not, and overstating it would make the other two claims cheaper.

Here is the honest position. `PoolManager.updateDynamicLPFee` requires `msg.sender == address(key.hooks)` (`contracts/lib/uniswap-hooks/lib/v4-core/src/PoolManager.sol:339-342`), so setting a v4 dynamic fee at all does require *being* the hook. But `IPoolManager` states explicitly that *"the only functions callable without an unlocking are `initialize` and `updateDynamicLPFee`"* (`contracts/lib/uniswap-hooks/lib/v4-core/src/interfaces/IPoolManager.sol:111`) — so a hook is free to expose a permissionless `pokeFee()` that any keeper can call between swaps, and never read DRS in `beforeSwap` at all. That is a real, working design. It is simply a worse one, and the reason is a staleness window with an attacker-chosen open time.

Under a keeper design, the pool's fee is whatever DRS was when the keeper last poked. Veritas's DRS is not a slow-moving parameter: a single near-duplicate attestation increments `dilutionCount` (`contracts/src/VeritasRegistry.sol:155-164`), and `saturateD(1) = 4000` (`contracts/src/VeritasRegistry.sol:271-280`), which through noisy-OR (`contracts/src/VeritasRegistry.sol:251-259`) can move DRS by thousands of basis points in one transaction. `contracts/test/ReactiveIntegration.t.sol:test_OnChainDilution_RaisesHookFee` shows the LP fee moving materially off nothing but on-chain dilution.

Now put an attacker in that loop. They flood the registry with near-duplicates of a content asset, spiking its DRS. The pool's *correct* fee is now much higher. The pool's *posted* fee is still the old one until a keeper notices and pays gas to poke it. During that window the LPs are underwriting a materially riskier asset at the cheap rate — and the attacker knows precisely when the window opens, because they opened it. They caused the spike, so they get to swap first. Every failure mode compounds: keeper offline, keeper censored, keeper gas-priced out, keeper front-run, poke transaction landing one block late. The exploit is *timing*, and a keeper design hands the attacker the clock.

Reading DRS inside `_beforeSwap` (`contracts/src/VeritasHook.sol:364`) makes that window exactly zero blocks. The fee that applies to a swap is computed from the DRS that exists at the instant of that swap, in the same call frame, before any liquidity is touched. There is no poke to front-run, no keeper to bribe or DoS, no gas subsidy to fund forever, and no liveness assumption anywhere in the design. The attacker who spikes DRS to attack the pool is the first person to pay the higher fee.

That is a quality argument, presented as one. The hook is not the only way to move a v4 dynamic fee. It is the only way to move it with no window.

### 3.4 What is not hook-exclusive, stated plainly

For completeness, so the three claims above can be trusted: the attestation registry, the noisy-OR scoring, the oracle quorum, the Reactive dilution loop, and the insurance-reserve *accounting* are all ordinary contract logic that could live anywhere (`contracts/src/VeritasRegistry.sol`, `contracts/src/VeritasOracle.sol`). The hook-exclusive parts are precisely three: vetoing pool creation, reading the in-flight swap delta, and collapsing the fee-staleness window to zero. Everything else in Veritas exists to make those three worth doing.

## 4. The Dilution Risk Score (DRS)

### 4.1 Noisy-OR combination

```solidity
uint256 drs = DRS_SCALE - ((DRS_SCALE - d) * (DRS_SCALE - a)) / DRS_SCALE;
```

`contracts/src/VeritasRegistry.sol:251-259` (`getCurrentDRS`). `DRS_SCALE = 10000` (`contracts/src/VeritasRegistry.sol:21`). DRS is derived live on every call — never stored.

### 4.2 The two D channels and why `max()`

```solidity
uint256 onchain = saturateD(rec.dilutionCount); // trustless floor (pHash)
uint256 offchain = rec.offchainD;                // robust off-chain signal (DINOv2 + web)
return onchain >= offchain ? onchain : offchain;
```

`contracts/src/VeritasRegistry.sol:262-268` (`getEffectiveD`). `onchainD` is a trustless floor maintained purely by on-chain near-duplicate counting via the Reactive callback (`contracts/src/VeritasRegistryCallback.sol`); `offchainD` is an oracle-signed semantic signal. `max()` is chosen deliberately: a bribed or lazy oracle cannot suppress D below what the on-chain floor already proves, and pHash's blindness to semantic (non-pixel) duplication is covered by the off-chain channel. Neither source can hide risk unilaterally.

On-chain saturation curve (`contracts/src/VeritasRegistry.sol:271-280`, `saturateD`):

| `dilutionCount` | D value |
|---|---|
| 0 | 0 |
| 1 | 4000 |
| 2 | 6000 |
| 3 | 7500 |
| 4–5 | 8500 |
| 6–10 | 9000 |
| 11–20 | 9500 |
| 21+ | 9800 |

### 4.3 Bounds actually reachable at runtime

**Correction to state explicitly: `PROTOCOL_MAX_GATE = 8500` (`contracts/src/VeritasHook.sol:115`) is a pool-creation constant only.** It is read in exactly two places — `registerPool` (`contracts/src/VeritasHook.sol:260,288`) and `_beforeInitialize` (`contracts/src/VeritasHook.sol:343`) — and nowhere in the swap path (`_beforeSwap`, `contracts/src/VeritasHook.sol:353-369`; `_afterSwap`, `contracts/src/VeritasHook.sol:380-430`). It bounds what DRS a pool may be *created* at. It does **not** bound what DRS a pool may *reach* after it exists.

Live, post-creation DRS can reach up to **9990**: `saturateD(21+) = 9800` is reachable purely on-chain, with no oracle at all (`contracts/src/VeritasRegistry.sol:279`); the oracle-signed `A` channel is separately hard-capped at `MAX_DRS = 9500` (`contracts/src/VeritasOracle.sol:33`). Through noisy-OR: `10000 - (200 * 500) / 10000 = 9990`. Neither number is a swapper-facing cap — see §6.4's worst-case-cost derivation, which does not depend on DRS at all.

## 5. The Reactive Network loop (no keeper, no cron, no bot)

`VeritasRegistry.attest` emits `NewAttestation` last (`contracts/src/VeritasRegistry.sol:111-113`) specifically so `DilutionMonitorRSC`, running on Reactive Lasna, can subscribe to it. On a new attestation, the RSC emits a callback instruction to `VeritasRegistryCallback` on Unichain Sepolia, which is wired as the registry's sole `dilutionUpdater` (`contracts/src/VeritasRegistry.sol:32,67-70`). The callback runs `getNearDuplicates` (`contracts/src/VeritasRegistry.sol:283-305`) and calls `incrementDilutionCount` (`contracts/src/VeritasRegistry.sol:155-164`) for every near-duplicate found. No keeper, cron job, or off-chain bot is in this loop — it is Proxy → RSC → callback → registry, entirely event-driven. `contracts/test/ReactiveIntegration.t.sol:test_RSC_React_EmitsCallback`, `test_Callback_DilutesNearDuplicatesOnChain`, and `test_Callback_OnlyAuthorizedProxy` cover this path; `test_OnChainDilution_RaisesHookFee` shows the resulting DRS movement reaching the hook's fee on the very next swap, with the zero-staleness property from §3.3.

## 6. Value flow and fees

### 6.1 Dynamic LP fee (to LPs, via PoolManager)

```solidity
fee = baseFee + (maxFee - baseFee) * DRS / DRS_SCALE
```

`contracts/src/VeritasHook.sol:371-374` (`_lpFee`). Monotonic in DRS, capped at `maxFee` since `DRS <= DRS_SCALE`. This fee accrues entirely inside `PoolManager`'s normal LP-fee accounting — the hook never touches it directly; it only overrides the rate via `LPFeeLibrary.OVERRIDE_FEE_FLAG` (`contracts/src/VeritasHook.sol:368`).

### 6.2 One take per swap, split two ways, collected on whichever side is the quote currency

Updated 8 Aug 2026 (R2 fix, see §6.3): the hook now collects on the QUOTE currency in every quadrant — `_beforeSwap` when quote is the swap's *specified* side (`contracts/src/VeritasHook.sol:536-556`), `_afterSwap` when quote is *unspecified* (`contracts/src/VeritasHook.sol:606-620`) — exactly one `take` per swap either way, never both. Both paths split the taken amount between two accounting mappings — `programmableFees` and `poolReserve` — via the same shared helper, `_splitFee` (`contracts/src/VeritasHook.sol:562-575`). The split is **inclusive**: `effectiveTotal = max(builderSelectedTotal, PROGRAMMABLE_FEE_PIPS)`, where `builderSelectedTotal = MAX_RESERVE_FEE * DRS / DRS_SCALE`. Programmable always receives exactly its 10 bps; the reserve receives the remainder, which is zero whenever the builder-selected total does not exceed the floor (see §6.4/L1 in §7).

### 6.3 The Programmable 10 bps: basis, denomination, claim authority

`PROGRAMMABLE_FEE_PIPS = 1_000` (10 bps, hundredths of a bip) is immutable — not a constructor parameter, not settable by anyone. Its **basis and denomination are both always the QUOTE currency**, in all four swap quadrants (R2, fixed 8 Aug 2026 by adding `beforeSwapReturnDelta`; the hook's CREATE2-mined address changed accordingly — see §11 for the current address). Before the fix, `afterSwap` alone could only ever move the swap's unspecified currency (`contracts/lib/uniswap-hooks/lib/v4-core/src/libraries/Hooks.sol:295-303`), so two of four quadrants had to re-express the fee in the content currency via a rate conversion; that entire code path is now removed, not merely disclosed-around. **R2b (the one real tradeoff the fix introduces):** the two quadrants now collected in `beforeSwap` price the fee off `params.amountSpecified` — the REQUESTED quote amount — because the executed amount is not yet known at that point in the call. A binding `sqrtPriceLimitX96` causing a genuine partial fill in those two quadrants means the fee is computed on more than what actually executes; the two `afterSwap`-collected quadrants have no such gap, since they always price off the realized `BalanceDelta`. See the worked example in §6.4 and `contracts/test/PartialFill.t.sol:test_C2_PartialFill_ExactOut_BeforeSwapUsesRequestedGross`/`test_C2_PartialFill_ExactOut_ZeroFillStillChargesFullRequestedFee` for the proof. Claim authority is a single hardcoded constant, `PROGRAMMABLE_FEE_RECIPIENT` — `claimProgrammableFee` is permissionless but always pays that address, never `msg.sender`.

### 6.4 Worked example, all four quadrants

Illustrative realized amounts below are hypothetical, chosen to exercise the arithmetic cleanly — they are not taken from a specific pool state or test trace. The pool's content token is `currency0`, quote is `currency1` (`contentIsCurrency0 = true`); DRS = 6000, so `builderPips = 3500 * 6000 / 10000 = 2100` (0.21%).

**Quadrant A — `zeroForOne=true`, exact-input.** Swapper sends 1,000,000 units of content (`currency0`, specified); realized quote-out (`currency1`, unspecified) = 495,000. Quote is unspecified here, so `_afterSwap` collects, priced off the realized amount: `progAmount = 495,000 * 1000 / 1,000,000 = 495`. `totalAmount = 495,000 * 2100 / 1,000,000 = 1039`. `reserveAmount = 1039 - 495 = 544`. The hook takes 1039 units of `currency1`; swapper nets 493,961 quote.

**Quadrant B — `zeroForOne=true`, exact-output.** Swapper wants exactly 500,000 units of quote out (`currency1`, specified) — quote is the *specified* side, so `_beforeSwap` collects, priced directly off the requested amount, no conversion and no dependency on execution: `progAmount = 500,000 * 1000 / 1,000,000 = 500`. `totalAmount = 500,000 * 2100 / 1,000,000 = 1050`. `reserveAmount = 1050 - 500 = 550`. The hook takes 1050 units of `currency1` (quote) via a `beforeSwapReturnDelta`, layered into the AMM's own work; the swapper's final realized output is still exactly the requested 500,000 (v4 guarantees the specified amount exactly), absent a binding price limit (R2b).

**Quadrant C — `zeroForOne=false`, exact-input.** Swapper sends 500,000 units of quote in (`currency1`, specified) — quote is specified again, `_beforeSwap` collects: `progAmount = 500,000 * 1000 / 1,000,000 = 500`. `totalAmount = 500,000 * 2100 / 1,000,000 = 1050`. `reserveAmount = 550`. The hook takes 1050 units of `currency1` (quote).

**Quadrant D — `zeroForOne=false`, exact-output.** Swapper wants exactly 1,000,000 units of content out (`currency0`, specified); realized quote-in (`currency1`, unspecified) = 510,000. Quote is unspecified, `_afterSwap` collects off the realized amount: `progAmount = 510,000 * 1000 / 1,000,000 = 510`. `totalAmount = 510,000 * 2100 / 1,000,000 = 1071`. `reserveAmount = 561`. The hook takes 1071 units of `currency1` (quote).

Basis AND denomination are now exact and consistent in all four quadrants — always quote-side, always the quote currency, no rate conversion anywhere. `contracts/test/VeritasHook.t.sol:test_ProgrammableFee_AllFourQuadrants` covers all four; `contracts/test/PartialFill.t.sol` covers realized-vs-requested basis under a genuine partial fill in both collection paths.

### 6.5 Declared authorities (there are none in the hook)

`VeritasHook` declares no `Ownable`, no `owner`, no `pause`, no `sweep`, no `rescue`, and no `setX` of any kind — confirmed by reading the full contract (`contracts/src/VeritasHook.sol:94-556`; the contract inherits only `BaseHook, IUnlockCallback`, no access-control base). The only two things that ever move value out of the hook are a hardcoded address constant, `PROGRAMMABLE_FEE_RECIPIENT` (`contracts/src/VeritasHook.sol:136`), or the pool's own in-range LPs via `poolManager.donate` (`contracts/src/VeritasHook.sol:507`).

The honest converse: `VeritasRegistry` and `VeritasOracle` **do** have `Ownable` (`contracts/src/VeritasRegistry.sol:18`; `VeritasOracle` similarly). The registry owner can call `setAttestFee` (`contracts/src/VeritasRegistry.sol:219-222`), `setDisputeBond` (`contracts/src/VeritasRegistry.sol:224-227`), `setDilutionUpdater` (`contracts/src/VeritasRegistry.sol:214-217`), `resolveDispute` (`contracts/src/VeritasRegistry.sol:187-208`), and `withdrawTreasury` (`contracts/src/VeritasRegistry.sol:229-235`); the oracle owner manages operator membership and quorum. That owner cannot touch a single wei of pool funds — but it can move DRS (by changing which address may increment dilution, or by resolving a dispute that unfreezes a record), and DRS moves the fee. This is disclosed here because it is a Tier-1 threat-model input, not a footnote: mitigations are a 2-of-3 (configurable) signature quorum with a 5% max cross-operator spread and a 10-minute freshness window (`contracts/src/VeritasOracle.sol:33-43`), 1h/2h update timelocks scaled to the size of the change (`contracts/src/VeritasRegistry.sol:22-24`), a hard `MAX_DRS = 9500` cap on any oracle-signed value (`contracts/src/VeritasOracle.sol:33`), and the `max()` construction in §4.2 so a bribed oracle cannot suppress observable on-chain duplication. Full threat analysis, including the live deployment's current quorum, is in `THREAT_MODEL.md` §3.4 and §4.6.

### 6.6 Per-position insurance claims — JIT-proof by construction

Added 8 Aug 2026 alongside two new hook permissions (`afterAddLiquidity`, `afterRemoveLiquidity`, `afterRemoveLiquidityReturnDelta`), which changed the CREATE2-mined hook address; a second, separate redeploy the same day added `beforeSwapReturnDelta` to fix L2/R2 (§6.3, §7) and changed it again (`contracts/src/VeritasHook.sol:339-357`; see §11 for the current address and permission-bit derivation).

**The problem this replaces.** The original insurance-reserve exit was `disburseReserveToLPs`'s pro-rata `donate` — a discrete, front-runnable event. An attacker could add liquidity immediately before an eligible payout and remove it immediately after, capturing value they did nothing to earn. This is a documented, real pattern, noted directly in the `uniswap-hooks` reference `LiquidityPenaltyHook` implementation's own code comments: "the donated penalty simply returns to the attacker."

**The fix.** `_afterAddLiquidity` snapshots each position's entry into a streaming, monotonic per-unit-liquidity accrual index (`reserveIndex`, `contracts/src/VeritasHook.sol:256-257`) plus the live DRS at that moment. `_afterRemoveLiquidity` computes the position's claim from four independent bounds, all `min()`, never a `require` — this function has a hard rule that it must never revert (`:673`, since a revert here would permanently brick a withdrawal):

```
E_x   = L_removed * (reserveIndex_x_now - index_x_at_entry) / 2^128     (a) this position's own tenure accrual
rise  = clamp(DRS_now - DRS_at_entry, 0, FULL_CLAIM_DRS_RISE)
claim = E_x * rise / FULL_CLAIM_DRS_RISE                                (b) DRS rise over that same tenure
claim = min(claim, principal_withdrawn_this_call)                       (c) the position's own principal
claim = min(claim, poolReserve[poolId][currency])                       (d) the pool's actual solvency
```

Same block, no DRS movement ⇒ `rise == 0` ⇒ the claim is **exactly zero**, unconditionally, before any rounding could push it above zero. **It is the streaming accumulator — not the DRS-delta factor alone — that closes the JIT hole**: the accumulator removes the discrete, timeable payout event; the DRS factor supplies insurance semantics and the exact-zero property. The contract's own NatSpec is explicit that these are two different mechanisms, not one (`:91-100`), so the claim isn't read as weaker than it is ("DRS gating prevents JIT") or stronger than it is.

- `contracts/test/InsuranceClaims.t.sol:test_J1_SameBlockOpenAndClose_ClaimsExactlyZero` — the headline proof.
- `test_J5_JitAroundDilutionEvent_CapturesOnlyItsOwnWindow` — an attacker who wraps a *genuine* dilution event (rise maxed, factor = 1) still only captures the narrow window they were actually present for, orders of magnitude below an honest long-tenure position.
- `contracts/test/FuzzProperties.t.sol:testFuzz_SameBlockAddRemoveAlwaysClaimsZero` generalizes the first proof across arbitrary sizes.
- `contracts/test/invariant/VeritasInvariants.t.sol:invariant_removeLiquidityNeverReverts` — the hard "never reverts" rule, checked across arbitrary sequences, **mutation-tested**: deliberately removing bound (d) causes a real `panic: arithmetic underflow` exactly where a newly-disclosed interaction predicts it would (see next paragraph and `THREAT_MODEL.md` §3.2, §5).

**Disclosed, not fixed: `disburseReserveToLPs` does not rewind `reserveIndex`.** Found during this build's own invariant-testing pass. A disbursement debits `poolReserve` but the accumulator only ever increases, so open positions' entitlement still reflects value already paid out; the excess is silently truncated by bound (d). Not an insolvency bug — the cap holds by construction, confirmed by mutation testing — but it means claims are first-come-first-served after a disbursement, and the disbursement itself is permissionless, so it can be timed to truncate a specific position's pending claim. Full analysis: `THREAT_MODEL.md` §3.2.

**Residual, unchanged fallback.** `disburseReserveToLPs`/`claimProgrammableFee` are untouched — they remain the exit for value the per-position path cannot attribute to a specific position (a sub-threshold DRS rise, the principal-cap forfeit, LPs who never remove). This fallback remains, in principle, JIT-capturable, capped at 50% per payout (`PAYOUT_BPS`, R5 in the contract header) — reduced, not eliminated. The per-position mechanism's JIT-proof property does not extend to it.

### 6.7 Pool-registration staleness gate

Also added 8 Aug. Veritas's headline claim is a "living DRS" kept current by a Reactive Network loop with no keeper. An earlier draft of this feature proposed raising the swap fee whenever data looked stale — **rejected on review**, because it would punish swappers for an infrastructure failure unrelated to the specific content asset, and because a quiet update pipeline is the *normal* state for a healthy pool (a healthy Reactive loop that finds zero near-duplicates writes nothing at all — `VeritasRegistryCallback._tryIncrement` only fires on an actual match), not evidence of failure.

What was built instead: `registerPool` and `_beforeInitialize` reject a new pool if the attestation's most recent registry touch is older than `REGISTRATION_MAX_DATA_AGE = 1 day` (`contracts/src/VeritasHook.sol:410-413,470-473`) — real protection for a brand-new LP relying on freshness they have no other way to judge, with no admin override (refreshing an attestation is itself permissionless). An already-open pool's fee is **provably independent of staleness**: `_beforeSwap`/`_afterSwap` contain no reference to it at all, at zero extra swap gas. `riskDataStatus`/`reportRiskDataStatus` (`:979-996`) disclose freshness via a view and a permissionless event-emitting poke, feeding back into nothing.

- `contracts/test/Staleness.t.sol`, all 9 tests, notably `test_S1_ExistingPool_FeeIsIdenticalWhenStale` (a positive assertion, not an absence-of-evidence argument) and `test_S7_StaleRegistration_RecoversPermissionlessly_NoAdmin` (recovery performed by an arbitrary `stranger`).

Full threat analysis: `THREAT_MODEL.md` §3.7.

### 6.8 Cumulative Programmable entitlement (carried remainder)

Added 8 Aug 2026. `_splitFee` previously computed `FullMath.mulDiv(gross, 1000, 1_000_000)` and floored on every
swap, carrying nothing. Any gross below 1,000 wei therefore paid the immutable owner exactly zero. Measured on that
revision: 200 swaps of 999 wei accrued **0 wei** to the owner while the project-side reserve still collected 200 wei,
and `programmableQuoteVolume` recorded 0 — so the shortfall was invisible to any on-chain reconciler.

The fix carries the sub-unit **numerator**, not the quotient, keyed per pool and currency
(`programmableFeeRemainder`, `contracts/src/VeritasHook.sol`). The hook serves many pools, so a single scalar would
let one pool's volume pay another pool's entitlement; the mapping prevents that. `mulmod` recovers the fraction
without overflow across the whole `uint256` range:

```
progAmount   = mulDiv(gross, 1000, 1e6)
combined     = mulmod(gross, 1000, 1e6) + carriedRemainder
progAmount  += combined / 1e6
nextRemainder = combined % 1e6
```

The identity this preserves, asserted live: `programmableFees * HOOK_FEE_DENOM + programmableFeeRemainder ==
programmableQuoteVolume * PROGRAMMABLE_FEE_PIPS`. Claims move `programmableFees` and never touch the remainder, so a
claim cannot reset the carry. Volume is now recorded on every charged swap, including ones whose own 10 bps rounds to
zero, keeping the audit trail reconcilable.

Evidence: `contracts/test/ProgrammableFeeCumulative.t.sol` (5 tests: the exact 200x999 wei scenario, split-vs-unsplit
equivalence, claim-does-not-reset-carry, per-pool isolation, and a fuzzed conservation property) plus the stateful
`invariant_programmableEntitlementIsCumulative`. Mutation M5 (freeze the carry) makes all six fail; see `TEST_PLAN.md`
§4. Confirmed on the live deployment: `programmableQuoteVolume = 996649006689767`, `programmableFees = 996649006689`,
`programmableFeeRemainder = 767000`, which satisfies the identity exactly.

### 6.9 Owner-only Programmable claim

Added 8 Aug 2026. `claimProgrammableFee` was previously permissionless on the reasoning that the destination was
hardcoded and therefore unredirectable. That reasoning covers *where funds land*, not *who may initiate a claim*,
which the fee policy states as a separate requirement (`claimAuthority: owner-only`, a schema `const`). Both claim
entrypoints now authenticate `msg.sender == PROGRAMMABLE_FEE_RECIPIENT`.

`claimProgrammableFeeTo(key, destination)` implements `claimDestinationPolicy:
owner-or-owner-selected-per-claim`: the owner may route one exact claim elsewhere, the zero address is rejected, and
the destination is never written to storage, so `storedMutableRecipient: false` still holds.

A side effect worth stating: reentrancy into the claim path is now stopped one layer *earlier* than before. Inside a
hostile token callback `msg.sender` is the token, never the owner, so `NotProgrammableFeeOwner` fires before v4's lock
is consulted. The lock remains behind it — the `test_P2_ReenterDisburse_*` tests still exercise it on a
non-owner-gated entrypoint.

## 7. Known limitations

**L1 — Below DRS 2860 the insurance reserve accrues exactly zero.** The 10 bps Programmable floor is *inclusive*, not additive: `builderPips = 3500 * DRS / 10000` (`contracts/src/VeritasHook.sol:409-411`) must exceed 1000 for the reserve to receive anything. `3500 * 2859 / 10000 = 1000` (integer division truncates `1000.65`), tied with the floor — zero reserve. `3500 * 2860 / 10000 = 1001`, first strictly above the floor. So DRS 0–2859 inclusive give exactly zero reserve accrual; DRS 2860 is the first DRS value with strictly positive accrual. Proven by `contracts/test/VeritasHook.t.sol:test_Reserve_ZeroDRS_NoAccrual`, `contracts/test/VeritasHook.t.sol:test_ProgrammableFee_FloorAppliesAtZeroDRS`, and `contracts/test/Integration.t.sol:test_FullFlow_AttestCreatePoolSwap`. Disclosed design, not a bug: low-risk content does not need an insurance buffer, but this does mean the reserve is a high-DRS-only feature.

**L2 — RESOLVED 8 Aug 2026 (was: fee denomination could flip to the content currency in 2 of 4 quadrants).** Fixed by adding `beforeSwapReturnDelta` and collecting in `beforeSwap` for the two quadrants where the quote currency is the swap's specified side (§6.2-6.4); basis and denomination are now both always the quote currency, with no rate conversion. Two narrower issues remain open under this heading, both disclosed rather than worked around. **L2b — requested vs executed basis:** the two `beforeSwap`-collected quadrants price off `params.amountSpecified`, so a binding `sqrtPriceLimitX96` can make the charge exceed a proportionate share of the realized fill. **L2c — exact-output gross-up:** for an exact-output swap wanting `X` out, the pool releases `X + fee` and the swapper receives `X`, so the true gross quote-side amount is `X + fee` while the charge is computed on `X`; the basis is the net rather than the gross. Neither is refundable from `afterSwap`, which may only move the UNSPECIFIED currency, so a correct fix needs a gross-for-net inverse plus a revert-on-mismatch guard in the swap path. Deferred deliberately: that is a change to swap execution itself, and shipping it hurriedly risks a worse defect than the one it repairs.

**L3 — Whole-supply registration proves less than it looks like it proves.** `registerPool` requires `balanceOf(msg.sender) == totalSupply()` on the content token (`contracts/src/VeritasHook.sol:301-307`). What it buys: no `PoolKey` squatting (`contracts/test/ReviewFindings.t.sol:test_Finding2_StrangerCanFrontRunRegisterPool`), codeless addresses rejected (`contracts/test/ReviewFindings.t.sol:test_RegisterPool_RejectsCodelessContentToken`), permanent 1:1 attestation<->token binding (`contracts/test/ReviewFindings.t.sol:test_OneAttestationBindsToExactlyOneToken`). What it does NOT buy: any evidence the token *is* the content — anyone can mint a fresh ERC-20 and hold 100% of it. Also a hard UX cliff for creators who pre-seeded liquidity, airdropped, used a launchpad/vesting, or hold in a Safe (`contracts/src/VeritasHook.sol:71-76`). The binding is irreversible with no unwind path (`contracts/src/VeritasHook.sol:78-80`) — adding one would need an admin.

**L4 — The 30-day maturity path makes JIT capture of a disbursement easier to time.** `disburseReserveToLPs` has two doors (`contracts/src/VeritasHook.sol:450-477`): DRS-claim (unpredictable) and maturity (a calendar event anyone can front-run with JIT liquidity, since `donate` pays pro rata to whoever is in range). `PAYOUT_BPS = 5000` (`contracts/src/VeritasHook.sol:145`) caps a single capture at half the buffer and rolls the rest forward — bounds the damage, does not prevent it. `contracts/test/ReviewFindings.t.sol:test_Reserve_MaturityPathOpensAfterEpoch` shows the door opening to an arbitrary caller. Consciously deferred tradeoff (`contracts/src/VeritasHook.sol:138-142`): without the maturity door, a reserve on a pool whose DRS never rises has no exit at all.

**L5 — The reserve can be permanently stranded when no LP is in range.** `disburseReserveToLPs` reverts `NoInRangeLiquidity` if pool liquidity is zero (`contracts/src/VeritasHook.sol:468`), proven by `contracts/test/ReviewFindings.t.sol:test_Finding4_DisburseBlockedWhenNoInRangeLiquidity`. No admin rescue exists by design — adding one would be the unrestricted-drain hard fail this design exists to avoid.

**L6 — A Programmable fee accrued in native currency could become permanently unclaimable.** `claimProgrammableFee` redeems straight to the hardcoded `PROGRAMMABLE_FEE_RECIPIENT` (`contracts/src/VeritasHook.sol:516-517`). If that address is ever a contract without a payable fallback, native-quote fees become unclaimable after that point (`contracts/src/VeritasHook.sol:82-85`). No fix exists inside this design — a configurable fallback destination would itself be a redirectable value sink.

**L7 — A hostile content token can grief its own pool's Programmable claim.** The claim path calls real token code twice via `settle`/`take` in `unlockCallback` (`contracts/src/VeritasHook.sol:510-518`), unlike disbursement, which calls no token code. A content token that reverts on transfer permanently blocks its own pool's `claimProgrammableFee`. Self-inflicted and pool-local. Proven by `contracts/test/Reentrancy.t.sol:test_P2_ClaimPayout_PendingCreditOnOtherCurrencyCannotBeStolen` and `contracts/test/Reentrancy.t.sol:test_P1_ClaimProgrammableFee_DoesCallTokenCode_ScopeBoundary`.

**L8 — The hook has no owner; the registry and oracle do.** `VeritasHook` contains no owner/admin/pause/sweep/rescue/setter of any kind. `VeritasRegistry` and `VeritasOracle` **are** `Ownable` — that owner can change fees/bonds, resolve disputes, withdraw treasury, set the dilution updater, manage oracle operators. It cannot touch a single wei held by the hook, but it CAN move DRS, and DRS moves the fee. Mitigations: 2-of-3 signature quorum with a 5% cross-operator spread bound and a 10-minute freshness window (`contracts/src/VeritasOracle.sol:33-43`), 1h/2h update timelocks (`contracts/src/VeritasRegistry.sol:22-24`), a hard `MAX_DRS = 9500` cap on oracle-signed values (`contracts/src/VeritasOracle.sol:33`), and `max()` over an independent trustless on-chain D channel so a bribed oracle can't suppress observable duplication.

**L9 — Worst-case swapper cost is 5.35%, and 8500 is NOT a runtime cap.** `PROTOCOL_MAX_LP_FEE` (5.00%, locked at registration — `contracts/src/VeritasHook.sol:118`) plus `MAX_RESERVE_FEE` (0.35%, a fixed constant inclusive of the 10 bps floor — `contracts/src/VeritasHook.sol:123`) bounds total hook-imposed cost at 5.35% (`contracts/src/VeritasHook.sol:87-88,116-118`). **`PROTOCOL_MAX_GATE = 8500` only bounds DRS at pool CREATION** — checked in `registerPool` and `_beforeInitialize` only, never in the swap path. Live DRS can reach 9990 after creation (§4.3). The 5.35% bound holds regardless of DRS because it's driven by the registration-time fee cap and a fixed constant, not by any DRS ceiling — proven by `contracts/test/ReviewFindings.t.sol:test_RegisterPool_RejectsConfiscatoryLpFee`, `test_RegisterPool_AcceptsFeeAtTheCap`, `test_LpFeeNeverExceedsProtocolCap`. Readers should not treat "8500" as bounding a swapper's fee at any point after pool creation.

**L10 — The builder-selected total is variable, not a single declared number.** Programmable's model expects one flat builder-selected total. Veritas's varies per swap between exactly 0.10% (floor, DRS ≤ 2859) and 0.35% (ceiling, DRS → 10000). Declare 0.35% as the builder-selected total; disclose that it collapses to the 10 bps floor on low-DRS pools. Programmable's 10 bps share is never less than 10 bps in any quadrant or at any DRS.

**L11 — On-chain near-duplicate search is O(n).** `getNearDuplicates` scans the full fingerprint array (`contracts/src/VeritasRegistry.sol:283-305`). Fine at hackathon scale; needs pHash-prefix bucketing before mainnet. Not a hook concern directly, but it's the throughput ceiling on the DRS pipeline the hook depends on.

**L12 — Test-coverage gaps, named.** Fuzz tests and a mutation-tested stateful invariant suite were added 8 Aug 2026 (`contracts/test/FuzzProperties.t.sol`, `contracts/test/invariant/`); fork tests still do not exist (verified: zero matches for `vm.createSelectFork`/`vm.createFork`). The in-repo audit report (`contracts/audit/report.html`) is self-authored, not third-party, and its main body (§1-3) describes the contract as of 2026-06-06 — it carries revision notes correcting the test count, most recently to 160; §1-3 have not been re-verified against the current `VeritasHook.sol` either way. See `TEST_PLAN.md` §5 for exact rubric clauses left unproven.

**L13 — A disbursement can truncate another position's pending insurance claim (found 8 Aug, via this build's own invariant-testing pass).** `disburseReserveToLPs` debits `poolReserve` but never rewinds `reserveIndex` (§6.6), so immediately after any disbursement every open position's index-based entitlement still reflects value already paid out; the excess is silently truncated by the per-position claim's solvency bound. Not an insolvency bug — confirmed by mutation testing that the bound holds — but claims become first-come-first-served after a disbursement, and since `disburseReserveToLPs` is permissionless, anyone can time one to truncate a specific position's pending claim. Fixing this would mean rewinding every open position's entry index proportionally on every disbursement — a real design change, out of scope here. Full analysis: `THREAT_MODEL.md` §3.2.

**Roadmap (not built into this submission).** Diversifying and enlarging the oracle operator set is the direct fix for L8's centralization risk. An alternative — reading a second on-chain volatility signal and taking `max()` with DRS — was investigated and explicitly rejected: realized price volatility is not a reliable proxy for "is this specific content AI-generated," and presenting it as an anti-bribery defense would overclaim what it does. The live deployment's oracle quorum is currently 1-of-3 (a demo-scale configuration, not a contract limitation — see `THREAT_MODEL.md` §4.6); raising it is an operational decision, not a code change, so it is scoped as a roadmap item rather than a same-day deliverable. Full detail: `THREAT_MODEL.md` §6.

## 8. Security posture

### 8.1 What has no owner (enumerated)

`VeritasHook` (`contracts/src/VeritasHook.sol`): no `Ownable`, no `owner`, no `pause`, no `sweep`, no `rescue`, no `setX`. Every state-mutating external function is either permissionless (`registerPool` gated only by content-token supply ownership and attestation ownership, not a protocol admin; `disburseReserveToLPs`; `claimProgrammableFee`) or restricted only to `address(poolManager)` (`unlockCallback`, `contracts/src/VeritasHook.sol:500-501`). See §6.5 for the full authority map and the honest disclosure of `VeritasRegistry`/`VeritasOracle` ownership.

### 8.2 Reentrancy evidence — 19 tests by name

All 19 verified present in `contracts/test/Reentrancy.t.sol`.

**P0 — harness validity (1).**
- `test_P0_CallbackSiteIsInsideTheV4Lock`

**P1 — absence of surface (5).** Scoped narrowly: the disbursement and per-position-claim payout paths only.
- `test_P1_Disburse_ExecutesZeroTokenCalls`
- `test_P1_Disburse_MovesZeroErc20Balance`
- `test_P1_ClaimProgrammableFee_DoesCallTokenCode_ScopeBoundary` (the negative test fencing P1's scope — proves the claim path is NOT covered by P1)
- `test_P1_RegisterPool_AttackerTokenIsReachedOnlyByStaticcall`
- `test_P1_InsuranceClaim_ExecutesZeroTokenCallsFromTheHook` (added 8 Aug, extends P1 to the per-position claim path, §6.6)

**P2 — defence at every reachable surface (13).** Each has a fully-armed precondition and a same-block control arm.
- `test_P2_ReenterDisburse_FromQuoteTake_FailsOnTheV4Lock`
- `test_P2_ReenterDisburse_FromContentSettle_FailsOnTheV4Lock`
- `test_P2_NestedSwapThroughRouter_FailsOnTheV4Lock`
- `test_P2_DirectSwapOnPoolManager_LeavesUnsettledDelta_RevertsWholeTx`
- `test_P2_DirectUnlockCallback_WhileUnlocked_RejectedByCallerGuard`
- `test_P2_ReenterClaim_FromSwapSettlement_FailsOnTheV4Lock`
- `test_P2_ReenterClaim_FromItsOwnPayout_StoppedByChecksEffectsInteractions`
- `test_P2_ReenterDisburse_FromClaimPayout_FailsOnTheV4Lock`
- `test_P2_ClaimPayout_PendingCreditOnOtherCurrencyCannotBeStolen`
- `test_P2_DirectHookEntrypoints_RejectNonPoolManagerCallers`
- `test_P2_DirectAfterSwap_FromTokenCallback_WhileUnlocked_Rejected`
- `test_P2_ReenterDisburse_FromRemoveLiquidityPayout_FailsOnTheV4Lock` (added 8 Aug, for the per-position claim path, §6.6)
- `test_P2_ReenterRemoveLiquidity_FromItsOwnPayout_CannotDoubleClaim` (added 8 Aug)

Three notes on this suite:

1. It distinguishes which defence fired in each case — `AlreadyUnlocked` (v4 lock), `OnlyPoolManager`/`NotPoolManager` (caller guard), `NothingToClaim` (checks-effects-interactions), `CurrencyNotSettled` (v4's settlement invariant) — rather than lumping every revert together.
2. Both currencies in each hostile fixture are hostile, because the hook hands control to them at points with different outstanding-delta state.
3. `test_P2_DirectAfterSwap_FromTokenCallback_WhileUnlocked_Rejected` forges a large fabricated `BalanceDelta` while the manager is genuinely unlocked, and shows the hook's 6909 balance still equals exactly its two mappings.

### 8.3 Hard-fail self-check vs. the two Programmable rubrics

No NoOp path exists: the hook never returns a delta it did not `take` (`contracts/src/VeritasHook.sol:418,429` — one `take`, same value returned). `beforeSwapReturnDelta` is permanently `false` (`contracts/src/VeritasHook.sol:228`). The returned `int128` is the same value passed to the single `take`, in the same currency (`contracts/src/VeritasHook.sol:418-429`).

## 9. Test coverage

See `TEST_PLAN.md` at the repo root for the full requirement-to-test mapping (168 tests across 14 suites, `forge test --offline` from `contracts/`). Fuzz tests and a mutation-tested stateful-invariant suite exist (`contracts/test/FuzzProperties.t.sol`, `contracts/test/invariant/`); fork tests do not. See `TEST_PLAN.md` §5 for exactly which rubric clauses that leaves unproven.

## 10. Dependencies, licence, third-party notices

Solidity: `^0.8.26`, Foundry, Cancun EVM, optimizer enabled at 800 runs (`contracts/foundry.toml:1-8`). On-chain dependencies: Uniswap `v4-core`/`v4-periphery` and OpenZeppelin `uniswap-hooks` (remapped in `contracts/remappings.txt`), OpenZeppelin `Ownable`/`ReentrancyGuard`/`EIP712`/`ECDSA`, and Reactive Network's `reactive-lib` for `AbstractReactive`/`AbstractCallback`. Full dependency inventory with individual license terms is tracked in `THIRD_PARTY_NOTICES.md` at the repo root. This project is distributed under the MIT License (see `LICENSE` at the repo root).

## 11. Deployment addresses and how to verify the permission bits

Live Unichain Sepolia (chainId 1301) addresses are listed in `README.md` at the repo root; the hook was redeployed a second time on 8 Aug 2026 (current hook: `0xc9f9E2b8ad61a49C83833dbBA0c7bEa86eE4A5Cd`, bound to the SAME, unchanged `VeritasRegistry`/`VeritasOracle` from the earlier same-day redeploy) after adding `beforeSwapReturnDelta` to fix L2/R2 (§6.3, §7). The hook address's low bits encode its permission flags via CREATE2 mining: `contracts/script/DeployHookOnly.s.sol` mines the address against exactly `BEFORE_INITIALIZE_FLAG | AFTER_ADD_LIQUIDITY_FLAG | AFTER_REMOVE_LIQUIDITY_FLAG | BEFORE_SWAP_FLAG | AFTER_SWAP_FLAG | BEFORE_SWAP_RETURNS_DELTA_FLAG | AFTER_SWAP_RETURNS_DELTA_FLAG | AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG` — required address suffix `addr & 0x3FFF == 0x25CD`, confirmed against the live address. To independently verify a deployed hook's permission bits match `getHookPermissions()` (`contracts/src/VeritasHook.sol:339-357`), decode the deployed address's flag bits per `contracts/lib/uniswap-hooks/lib/v4-core/src/libraries/Hooks.sol` and compare against that function's return value — a mismatch would mean either the wrong bytecode was deployed or the address was not mined correctly, and `PoolManager.initialize` would reject it outright (`Hooks.HookAddressNotValid`). `contracts/verify.sh` submits the deployed source to Uniscan for verification (oracle, registry, hook). The Reactive side (`DilutionMonitorRSC` on Lasna) has not yet been redeployed against the current registry as of this writing — see `README.md` and `THREAT_MODEL.md` for current status; the on-chain dilution mechanism itself is fully proven in the Foundry suite regardless (`contracts/test/ReactiveIntegration.t.sol`).
