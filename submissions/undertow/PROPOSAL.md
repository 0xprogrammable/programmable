# Proposal

## What it is

Undertow is a Uniswap v4 launch model whose canonical pool **recaptures loss-versus-rebalancing (LVR) for its own
liquidity providers**, oracle-free and keeper-free, while enforcing the mandatory Programmable **10 bps** volume fee
non-bypassably on the same pool.

## The problem (usefulness)

LVR is the dominant, quantified cost passive AMM LPs bear: the value bled to arbitrageurs who pick off stale on-chain
quotes after the off-chain price moves. In the foundational model — Milionis, Moallemi, Roughgarden & Zhang,
*Automated Market Making and Loss-Versus-Rebalancing* (arXiv:2208.06046) — **the cumulative profit of the rebalancing
arbitrageur equals cumulative LVR**, and LVR grows with volatility × time. In plain terms: the longer a pool sits
untraded, the further the fair price drifts, and the larger the very next arbitrage. That first realigning swap is
where LPs lose the most.

Undertow prices exactly that staleness back to the arbitrageur and hands it to the LPs.

## The mechanism (genuine v4 fit)

The canonical pool is a **dynamic-fee** pool. On every swap the hook returns a per-swap LP-fee override:

```
lpFee = BASE_LP_FEE + surcharge
surcharge = min(MAX_SURCHARGE, SURCHARGE_PER_BLOCK * staleBlocks)
staleBlocks = block.number - lastMaterialBlock
```

with `BASE_LP_FEE = 3000` (0.30%), `SURCHARGE_PER_BLOCK = 500` (5 bps/stale block), `MAX_SURCHARGE = 50000` (5.00%),
so the total LP fee is hard-bounded to `[0.30%, 5.30%]` — far below the v4 core maximum.

The surcharge is delivered **as the pool's LP fee**, so the unmodified v4 fee-growth accounting distributes it to
**in-range LPs** automatically. There is no custom curve, no rebate ledger, no donation, and no keeper. The first swap
after a quiet gap — the arbitrage — pays the high fee; ordinary intra-block flow that follows the corrected price pays
only the base fee.

**Why this needs a hook, and cannot be done otherwise:** only a v4 hook can (a) return a per-swap dynamic LP fee
computed from on-chain state (`block.number` vs. the pool's last material-swap block) with no oracle and no keeper, and
(b) collect the mandatory 10 bps on the quote side via quadrant-dependent before/after return deltas atomically inside
the same swap. A router charge, a static LP fee, or a token transfer tax can do none of this.

**Oracle-free by design (security).** Staleness (elapsed blocks) is the LVR proxy — a manipulation-resistant, purely
on-chain signal. There is no external price to manipulate, no oracle to stale out, no keeper to stop. A swap cannot
lower its own surcharge (it is read from prior-block state).

## Anti-gaming

Only a swap whose **executed quote volume reaches `materialThreshold`** resets the staleness clock. A sub-threshold
"priming" swap therefore cannot disarm the surcharge for a following large arbitrage. A bounded residual remains — an
arbitrageur may split one large realigning trade so only the first *material* tranche is surcharged — and this is
disclosed in `THREAT_MODEL.md`; the first material tranche is always surcharged on its own volume.

## The mandatory Programmable fee

Rates are in hundredths-of-a-bip (`1000 = 10 bps = 0.10%`):

```
selected total hook charge = 1000   (10 bps)
effective = max(1000, 1000) = 1000
platform  = 1000   (exactly 10 bps)  -> owner-only CLAIMABLE LIABILITY
project   = effective - 1000 = 0     (Undertow takes NO project fee)
```

Worked examples: `0 selected -> 10 bps platform + 0 project`; a hypothetical `3% selected -> 0.1% platform + 2.9%
project` (never `3.1%`). Undertow's LVR surcharge is an **LP fee**, excluded from this split — it is never a hook-owned
charge and never nets against the platform liability.

The 10 bps is charged on the **executed gross quote-side volume** in all four swap quadrants via quadrant-dependent
return deltas. With native-ETH quote (`currency0`):

| quadrant | quote is | path |
| --- | --- | --- |
| zeroForOne exact-input | specified | before-swap return delta |
| zeroForOne exact-output | unspecified | after-swap return delta |
| oneForZero exact-input | unspecified | after-swap return delta |
| oneForZero exact-output | specified | before-swap return delta |

Before-quadrant basis is `|amountSpecified|` (known pre-swap); after-quadrant basis is the **executed** quote delta, so
a partial fill is never over-charged. Every returned delta is backed by ERC-6909 quote claims the hook `take`s from the
PoolManager in the **same unlock** — no unbacked delta is ever created. The liability is keyed `(poolId, currency,
owner)` with no cross-pool netting, claimable only by the immutable owner `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`,
to itself or a per-claim destination.

## Authorities

The only privileged action is claiming the accrued platform liability, callable **only** by the immutable Programmable
owner. There is no builder/project/admin authority, no owner over the LVR surcharge, no pause, no upgrade, no arbitrary
call, no sweep, and no path that can touch LP or trader funds. The hook is immutable.

## Evidence

Implemented in `src/Undertow.sol` and proven by a Foundry suite (see `TEST_PLAN.md` / `EVIDENCE.md`): 19 tests — 4-quadrant
fee correctness, the LVR schedule, anti-gaming, owner-only claim, and dynamic-fee enforcement; a 1,000-run rate fuzz; two
stateful invariants at 16,384 calls each with zero reverts (the 10 bps liability is always fully backed by held claims);
an economic proof that a staler pool pays its LPs strictly more for the same trade; and a **mainnet-fork rehearsal
against the live PoolManager `0x000000000004444c5dc75cB358380D2e3dE08A90`**.

## Provenance & verifiability

Undertow was produced through the **mandatory Programmable v4 Builder skill** — `gh skill install 0xprogrammable/programmable
programmable-v4-hook-builder`, then `doctor → scaffold → check → package`. The skill's public-intake gate returns
`intakeValidated: true`, and its deterministic `compatibility-report.json` (plus the skill-scaffolded `submission.json`)
**is** the required machine-readable documentation of fees, recipients, value flows and authorities. The full transcript
is in [`SKILL_FLOW.md`](SKILL_FLOW.md). Every test and analysis claim is reproducible: CI (`.github/workflows/ci.yml`,
badge on the README) runs the suite and Slither on every push, and the captured outputs are committed and hashed under
[`evidence/`](evidence/). The build window and authorship are visible in the repository's public commit history and CI
run timestamps.

## Status and open items

Like every submission at intake, this is **not yet** maintainer-accepted, audited, routed, deployed, or available —
those are separate downstream states the program owns, not steps a builder can self-certify, and the skill *requires*
this disclaimer on every application. What *is* complete: the skill pipeline (package `intakeValidated: true`), the fully
implemented hook, and its test/invariant/fork/CI evidence. The remaining follow-ups are the autonomous atomic launch
graph (`launch.json`) and an independent security audit.
