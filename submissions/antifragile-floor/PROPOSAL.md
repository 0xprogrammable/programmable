# Proposal

## Elevator pitch

Antifragile Floor is a single Uniswap v4 hook bound to one canonical pool. Every swap pays a mandatory 30 bps Programmable volume fee on the executed quote-side amount; the 20 bps project slice is skimmed into a WETH reserve that funds a monotonic, ratchet-only price floor. On an exact-input sell the hook tops the seller up from that reserve toward the floor AFTER the AMM has executed the full swap — the core AMM leg is always the whole swap, and the hook adds no pricing math of its own. The 10 bps platform slice accrues as an owner-only claimable liability. There is no oracle, keeper, admin or upgrade.

## User outcome

A creator opens a WETH-paired token in one canonical v4 pool. Exact-input sellers are subsidised toward a transparent, on-chain price floor that only ratchets up, funded by the pool's own trading volume, with no admin, oracle, keeper or upgrade. The benefit is venue-independent: it helps any seller on a pool of this kind, and nothing about it depends on a particular launchpad.

## Mechanism

Source: `src/AntifragileFloorHook.sol` and `src/lib/FloorMath.sol`.

1. Mandatory Programmable fee. `effective = max(selected, 1000)`; `platform = 1000` accrues as an immutable owner-claimable liability; `project = effective minus 1000` funds the floor reserve. The fee is collected on the executed gross quote-side amount across all four swap quadrants through quadrant-dependent before-swap and after-swap return deltas, and every unit is held as the hook's own ERC-6909 quote claims.
2. Self-funded floor. The project slice accumulates into `reserveQuote`. The floor price is `reserveQuote * 1e18 / backedSupply`, where `backedSupply` is an immutable snapshot of the token supply captured once at bind time. `floorHigh` is a monotonic high-water mark of that price: it only ratchets up and no address can lower it.
3. Top-up sized on executed input. On an exact-input sell the hook pays the seller `min(max(floorHigh * executedTknIn / 1e18 - ammQuoteOut, 0), reserveQuote)` from the reserve as a negative after-swap delta, netted against the fee. It is sized on the EXECUTED token the pool actually received (read from the swap delta), never the requested amount, so a price-limited partial fill cannot be over-subsidised. When the reserve cannot reach the floor the whole reserve is paid (a partial honor), never reverting. The hook holds exactly `reserveQuote + programmableFeeOwed` in ERC-6909 quote claims at all times.
4. Precommitted binding. The hook precommits the exact launch token, start price and tick spacing at construction; `afterInitialize` binds the first quote pool once and reverts `WrongToken`, `WrongStartPrice`, `WrongTickSpacing` or `PoolAlreadyBound` otherwise, so a front-runner cannot capture the hook with a foreign pool.

## Why Uniswap v4

Only a v4 hook can collect the mandatory volume fee non-bypassably through quadrant-dependent before-swap and after-swap return deltas on the quote side of every swap, and read the executed swap BalanceDelta in after-swap to pay a reserve-funded top-up toward the monotonic floor as an after-swap return delta, atomically, from aggregate pool state with no per-user identity. A router surcharge is bypassable and a static PoolKey fee cannot subsidise a seller toward a floor.

## Not used

No oracle, keeper, admin, upgrade path, pool-liquidity custody, hookData, cross-chain messaging, or transfer tax. The hook, its floor mechanics and its fee rates are fixed at construction, and the floor can only ratchet upward.
