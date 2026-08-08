# Threat model

## Trust boundaries

- **PoolManager** (`0x000000000004444c5dc75cB358380D2e3dE08A90`) is the only trusted dependency. Every hook callback is
  `onlyPoolManager`. The hook reads only its own storage and `block.number`; there is no oracle, keeper, external
  protocol, or off-chain input.
- **The immutable Programmable owner** (`0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`) is the sole claimant of the
  platform liability. No other authority exists.

## Assets at risk

- The accrued **10 bps platform liability**, held as ERC-6909 quote claims. Bounded and owner-only.
- LP and trader principal is **never** custodied by the hook.

## Threats and mitigations

| # | Threat | Mitigation |
| --- | --- | --- |
| 1 | Trader lowers their own LVR surcharge | Surcharge is read from **prior-block** state in `beforeSwap`; a swap cannot influence its own surcharge. |
| 2 | Dust "priming" swap disarms the surcharge before a large arbitrage | Only a swap with executed quote volume ≥ `materialThreshold` resets the staleness clock; sub-threshold swaps do not. Tested (`test_dustPriming_doesNotResetClock`). |
| 3 | Split-trade evasion | Residual, disclosed: an arbitrageur may split one large realign so only the first *material* tranche is surcharged. That tranche is still surcharged on its own volume, and each split pays gas. Bounded, not a fund-loss vector. |
| 4 | Unbacked return delta (the #1 hard-fail) | Every returned delta is backed by ERC-6909 claims `take`n from the PoolManager in the **same unlock**. Solvency invariant proves `manager.balanceOf(hook, quote) == programmableFeeOwed` across 16,384 calls, 0 reverts. |
| 5 | Fee bypass via router / alternative pool / LP-fee / transfer-tax | The 10 bps is enforced inside the hook on the canonical PoolKey, on the executed gross quote-side amount, in all four quadrants. It is not a router charge and cannot be routed around on the canonical pool. |
| 6 | Owner drain / confiscation | There is **no** sweep, rescue, pause, upgrade, or arbitrary-call path. The owner can move only the accrued platform liability, only to itself or a per-claim destination. `claimProgrammableFee` is `onlyOwner` and rejects the zero address. |
| 7 | Fee overflow / unbounded LP fee | The LP fee is hard-bounded to `[3000, 53000]` hundredths-of-a-bip, far below the core 100% maximum. `MAX_SURCHARGE` saturation is tested. |
| 8 | Re-binding / wrong pool | `afterInitialize` binds one-shot and reverts on a non-dynamic-fee pool (`NotDynamicFee`), a pool without the quote asset (`NotQuotePool`), or a re-bind (`AlreadyBound`). |
| 9 | Partial-fill over-charge | After-quadrant fee basis is the **executed** quote delta, never the requested amount. |
| 10 | Reentrancy / self-call | The hook never initiates a same-pool swap (`selfCallPolicy: same-pool-swap-forbidden`); it only `take`s/`transfer`s for fee custody. All callbacks are `onlyPoolManager`. |
| 11 | Insecure randomness / on-chain secrecy | None used. Staleness is `block.number` arithmetic; there is no randomness and no on-chain secret assumption. |

## Residual risk

- Split-trade partial evasion (#3) — disclosed, bounded.
- Independent security audit is not yet performed.
- Live routing / collection depend on platform integration and are not claimed by this submission.
