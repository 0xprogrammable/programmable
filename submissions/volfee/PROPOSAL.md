# Proposal

## Elevator pitch

VolFee is a single Uniswap v4 hook bound to one canonical dynamic-fee pool. The LP fee reprices every swap from the pool's own realized volatility — an EWMA of the per-swap tick delta, measured on-chain with no external price source, no keeper, and no governance. LPs earn the most exactly when adverse selection is worst; traders pay the least in calm markets. The same hook accrues the mandatory Programmable volume fee non-bypassably on every swap of that pool.

## User outcome

A creator opens a WETH-paired token in one canonical v4 pool. The LP fee auto-calibrates to volatility, so passive LPs are compensated for toxic flow with no oracle and no admin. The benefit is venue-independent: it helps any LP on a pool of this kind, and nothing about it depends on a particular launchpad.

## Mechanism

Source: `src/VolFeeHook.sol` and `src/lib/VolMath.sol`.

1. Dynamic LP fee to LPs. `afterInitialize` sets an immutable base fee via `updateDynamicLPFee`. Each `beforeSwap` returns `VolMath.feeFromVol(ewmaVol, base, k, minLpFee, maxLpFee)` ORed with `OVERRIDE_FEE_FLAG`. Each `afterSwap` updates `ewmaVol` and `lastTick` from the executed post-swap tick. The curve is `lpFee = clamp(base + k times ewmaVol, min, max)`: monotonic non-decreasing in volatility and hard-bounded.
2. Manipulation resistance. The fee for swap N is read from state accumulated strictly before N, because the EWMA is updated only in `afterSwap`. A swap therefore cannot lower its own fee. This is a bounded property, not immunity to all manipulation: an adversary can still shift the shared fee for other traders, but every such action pays the mandatory volume fee, moves the price against the actor, and stays inside the immutable bounds.
3. Mandatory Programmable fee. `effective = max(selected, 1000)`; `platform = 1000` accrues as an immutable owner-claimable liability; `project = effective minus 1000` accrues as an immutable project-claimable liability. Both are held as ERC-6909 quote claims, and the hook balance reconciles to `platform + project` owed. There is no reserve and no subsidy.

## Why Uniswap v4

Only a v4 hook can return a per-swap LP-fee override computed from the pool's own state, and collect the mandatory volume fee through quadrant-dependent before-swap and after-swap return deltas, both atomically from aggregate pool state. A router surcharge is bypassable and a static PoolKey fee cannot reprice itself per swap.

## Not used

No oracle, keeper, admin, upgrade path, reserve, pool-liquidity custody, hookData, cross-chain messaging, or transfer tax. The hook, its volatility parameters, and its fee rates are fixed at construction.
