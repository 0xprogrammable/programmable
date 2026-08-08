# Threat model

Adversarial threat review of `src/HarbergerHook.sol`, `src/HarbergerLauncher.sol`, `src/HarbergerToken.sol`, `src/lib/HarbergerMath.sol` and `src/lib/Shares.sol`, backed by 77 passing tests (`forge test --no-match-path "test/fork/*"`, 0 failures) including per-phase solvency fuzzing, a reentrancy exploit harness and stateful invariants. Nothing here is a substitute for independent review by the maintainers.

## Assumptions

- The quote currency is a normal ERC-20 used both as the pool's quote side and the tax-deposit asset; a malicious ERC-777-style quote is considered explicitly below and mitigated with a reentrancy guard.
- The owner is the immutable platform address `0x4957f4...6c` (programmable-volume-fee-v1); there is no setter, admin, oracle or keeper.
- The hook custodies one full-range v4 position and LPs interact only through it.

## Threat surface

- Reentrancy on the plain-ERC20 tax path. Tax money (deposits, rewards, buyout price, liquidation payouts) moves as plain ERC-20 outside `poolManager.unlock` to avoid `CurrencyNotSettled`, while `buyout`, `withdraw` and `liquidate` finalise state around those transfers. A malicious quote token could otherwise re-enter mid-payout and double-spend the reserve. The hook inherits the OpenZeppelin `ReentrancyGuard` and every value-moving entry point (`deposit`, `withdraw`, `buyout`, `liquidate`, `harvest`, `topUpTax`, `claimProgrammableFee`) is `nonReentrant`, with the buyout anti-abuse checks moved to the front (checks-effects-interactions). Proof: `test/audit/Reentrancy.t.sol` has an attacker re-enter `withdraw` during its own payout and asserts the re-entrant call is rejected and the attacker receives only its single legitimate payout.
- First-pool binding capture. The hook precommits the exact token, start price and tick spacing at construction; `afterInitialize` reverts `WrongToken`, `WrongStartPrice` or `WrongTickSpacing` for any other pool, `NotQuotePool` for a pool without the quote, and `PoolAlreadyBound` on any second initialization, so a front-runner cannot capture the hook with a foreign pool.
- Reserve and custody solvency. Under any interleaving, `IERC20(quote).balanceOf(hook) >= quoteTaxReserve` (`invariant_reserveSolvent`) and `totalLiquidity == the real v4 position liquidity` (`invariant_custodyLiquiditySynced`); rewards are always drawn from a real deposit and `accIncrement`/`pending` floor in the pool's favour, so the reserve is over- or exactly-collateralised. Tests: `test/invariant/HarbergerInvariant.t.sol` and the per-phase `testFuzz_solvency`.
- Self-price and buyout abuse. `minSelfPriceWad` floors the self-price per share on every set (deposit and buyout, `BelowMinSelfPrice`), and `buyoutCooldown` with `lastAcquiredTs` gates re-buyout churn (`BuyoutOnCooldown`); each buyout also costs the real self-price. Tests: `test/ParamsHarden.t.sol`.
- Fee bypass, cross-pool netting and non-owner claim. The mandatory fee is collected on every canonical-pool swap quadrant-correctly, keyed by `(poolId, currency)` and held as ERC-6909 claims separate from the tax reserve; alt or hookless pools and plain transfers do not accrue, and only the owner can claim, to a per-call destination. Tests: `test/Fee.t.sol`.
- Reward theft and liquidation edge cases. `rewardCheckpoint` is set at deposit and reset on buyout, so an incoming owner cannot claim rewards accrued before it held the claim; a sole LP cannot be liquidated (`NoOtherLPs`), so forfeited liquidity is never stranded ownerless. Tests: `test/Buyout.t.sol`, `test/Liquidation.t.sol`.
- Access control. All v4 callbacks and `unlockCallback` are `onlyPoolManager`, and the hook never initiates a swap on its own pool. Tests: `test/Fee.t.sol`.
