# Ladder

Initial Buy custody that releases on what the market did, not on what the calendar says.

## Start with the model

Ladder launches a fixed-supply ERC-20 into a native ETH Uniswap v4 pool exactly as Classic does, with the same fees,
the same permanently locked launch position and the same creator rewards. It differs in one respect: how the
creator's Initial Buy is held.

Classic offers four custody modes, and every one of them is a clock — unlocked, a fixed lock, linear vesting, or a
cliff followed by linear vesting. Ladder adds a fifth in which release is conditional on price.

A creator declares up to five tranches at launch. Each names a price level and a share of the allocation. A tranche
releases only once the pool has held at or above that level for a required number of consecutive blocks, and only
while it is still above it.

If the token never reaches a level, that tranche never releases. If the ladder expires, anyone can burn what remains.

| Term | Meaning |
| --- | --- |
| Unlock tick | The price level a tranche requires, as a Uniswap v4 tick. These pools pair the token against native ETH as `currency0`, so the tick **falls** as the token's ETH price rises: a higher target is a lower tick |
| Share | The portion of the Initial Buy that tranche releases |
| Dwell | Consecutive blocks the level must hold before the tranche releases |
| Expiry | Days after launch at which unreleased tranches may be permanently burned |

## How the pool proves it

There is no oracle, no keeper and no polling.

A Uniswap v4 pool's tick changes only when a swap executes, and the hook runs on every swap in its pools. The hook
records, for each tranche, the most recent block at which the pool was seen *below* that tranche's level. The absence
of a recorded breach across a window is therefore proof that no breach occurred in that window.

Unlock ticks descend as the price targets rise, so the set of breached tranches is always a suffix of the ladder:
below one target means below every target above it. A pool clearing every rung writes nothing at all.

## What the model guarantees

**Nothing releases early.** A tranche requires a full dwell window measured from the later of launch and its last
breach. A token that opens above a level still holds it for the whole window.

**A fall resets the clock.** Any swap leaving the pool below a level stamps that block as a breach for that tranche
and every tranche above it.

**Holding then dumping releases nothing.** The current price is checked at release, not only the history.

**The terms cannot be edited.** Levels and dwell are recorded in the hook at registration; shares are recorded in the
wallet at construction. Neither contract has an owner, a setter or an upgrade path, and neither can change the terms
alone.

**The beneficiary cannot be changed.** Ownership transfer and renunciation both revert.

**Unreleased tranches can be retired by anyone** once the ladder expires, and only to the burn address.

## Bounds

| Parameter | Bound |
| --- | --- |
| Tranches | 1 to 5, descending, aligned to the pool's tick spacing |
| Share per tranche | At least 5%, totalling exactly 100% |
| Dwell | 7,200 to 216,000 blocks, about one day to one month |
| Expiry | Disabled, or 30 to 3,650 days |
| Swap fee | Classic's bounds: 1.00% to 10.00% in whole-percent steps, per direction |

The dwell floor exists so that no tranche can be cleared by a single-block price spike.

## Worked example

A three-rung ladder at roughly 2x, 5x and 10x the opening price, one day of dwell, expiring after 180 days:

| Tranche | Requires | Releases |
| --- | --- | --- |
| 1 | ~2x held for 7,200 blocks | 30% |
| 2 | ~5x held for 7,200 blocks | 30% |
| 3 | ~10x held for 7,200 blocks | 40% |

If the token never holds 2x for a day, the creator receives nothing, and the whole allocation is burnable by anyone
after 180 days.

## Fees and rewards

Fees are Classic's, accounted in native ETH, taken from the swap and never added on top. On a 1.00% pool:

| Recipient | Share of swap volume |
| --- | ---: |
| Token creator | 0.80% |
| Hook builder | 0.10% |
| Programmable | 0.10% |

Creator rewards accrue to the same `FeeSplitVaultV1` used by Classic, unmodified, and remain claimable only by that
vault. The builder share is part of the published total under the
[Hook Builder Program](../../BUILDER_PROGRAM.md), and only the builder beneficiary can claim it or move its payout
address.

## Relationship to Classic

`totalSwapFeeBpsFor`, `feeDisclosure`, `quoteGrossFees` and `quoteExactOutputFees` keep their Classic shapes, so an
interface built against Classic reads a Ladder pool with only the added builder field to account for. The new views
are `ladderDisclosure`, `trancheBreachBlock` and `isTrancheUnlocked`.

## What Ladder does not do

- It does not change any fee, in either direction, at any time.
- It does not vest, lock or restrict any holder's tokens other than the creator's Initial Buy.
- It does not guarantee the creator receives anything. That is the point.

## Risks

Ladder inherits every risk documented for Classic. A fixed supply and locked launch liquidity do not guarantee
demand, price stability or deep liquidity, and tokens can be volatile, illiquid or lose all value.

Beyond those, the model's own limits are stated in [SECURITY.md](SECURITY.md). The most important: **a creator with
enough capital can buy their own pool up to a level and hold it through the dwell window.** The dwell floor makes
this expensive and entirely public, but it is not prevented. Read a ladder's levels against the pool's liquidity
before treating them as meaningful.

Release status: `design`. No Ladder contract is deployed, and the model is not available for launch.
