# Proposal

## Elevator pitch

Harberger AMM is a single Uniswap v4 hook bound to one canonical pool where the liquidity is always for sale. LPs add liquidity only through the hook, which custodies one full-range position and mints self-priced share claims. Each claim pre-pays a continuous Harberger holding tax that is rebated to all LPs, and anyone but the owner can buy a claim out at its self-price. A claim whose tax deposit is exhausted is recycled to the remaining LPs. Every swap pays a mandatory 10 bps Programmable volume fee to an immutable owner. There is no oracle, keeper, admin or upgrade.

## User outcome

A creator opens a quote-paired token in one canonical v4 pool. LPs self-price their custodied share claims and pre-pay a continuous tax that rebates to all LPs; anyone can take over an under-priced claim at its self-price, and a delinquent claim is redistributed to the remaining LPs. The behaviour is venue-independent: it governs any pool of this kind, and nothing about it depends on a particular front end.

## Mechanism

Source: `src/HarbergerHook.sol`, `src/lib/HarbergerMath.sol` and `src/lib/Shares.sol`.

1. Custody. The hook owns ONE full-range v4 position. `beforeAddLiquidity` and `beforeRemoveLiquidity` revert any add or remove not driven by the hook, so every deposit flows through `deposit(...)`, which mints pro-rata `Shares` claims (first deposit 1:1) and pulls both pool currencies plus a pre-paid quote-side tax deposit.
2. Harberger tax. Each claim carries a `selfPrice` and a `taxDeposit`. `_settleTax` draws `taxOwed(selfPrice, taxRatePerYear, elapsed)` from the deposit into a MasterChef-style `accRewardPerShare` accumulator that rebates it to all LPs (harvest with `harvest`, top up with `topUpTax`). The reserve relation `IERC20(quote).balanceOf(hook) >= quoteTaxReserve` always holds.
3. Buyout. `buyout(id, newSelfPrice, newTaxDeposit)` lets anyone but the owner pay the claim's `selfPrice` in quote to the seller, settle the seller's tax, pay their pending reward plus unused deposit, and take over the claim with a fresh self-price and deposit; shares and liquidity are unchanged.
4. Liquidation. When a claim's deposit is exhausted (`isLiquidatable`), `liquidate(id)` is permissionless: it burns the delinquent claim's shares so its liquidity redistributes pro-rata to the remaining LPs through the shares denominator, with no swap and no `unlock`; the forfeiter keeps its earned reward and a sole LP cannot be liquidated (`NoOtherLPs`).
5. Mandatory Programmable fee. `beforeSwap` and `afterSwap` collect the `programmable-volume-fee-v1` charge quadrant-dependently on the executed gross quote-side amount; `effective = max(feeTotalBps*100, 1000)`. The whole charge — 10 bps at this configuration, so the project remainder is zero — accrues to `programmableFeeOwed` as ERC-6909 quote claims, claimable only by the immutable owner `0x4957f4...6c` through `claimProgrammableFee`. Fee claims are held separately from the plain-ERC20 tax reserve, so fees never disturb the tax accounting.
6. Precommitted binding. The hook precommits the exact launch token, start price and tick spacing at construction; `afterInitialize` binds the first quote pool once and reverts `WrongToken`, `WrongStartPrice`, `WrongTickSpacing`, `NotQuotePool` or `PoolAlreadyBound` otherwise, so a front-runner cannot capture the hook with a foreign pool. Anti-abuse parameters `minSelfPriceWad` and `buyoutCooldown` (both default zero) floor the self-price per share and throttle re-buyout churn.

## Why Uniswap v4

Only a v4 hook can custody one position while minting self-priced share claims, enforce a continuous tax, a permissionless buyout and permissionless liquidation atomically from aggregate pool state, and collect the mandatory volume fee non-bypassably through quadrant-dependent before-swap and after-swap return deltas on the quote side of every swap. A router surcharge is bypassable and a static PoolKey fee cannot rebate a holding tax to LPs.

## Not used

No oracle, keeper, admin, upgrade path, hookData, cross-chain messaging or transfer tax. The tax rate, fee rate, owner and anti-abuse parameters are fixed at construction; the hook custodies exactly one full-range position.
