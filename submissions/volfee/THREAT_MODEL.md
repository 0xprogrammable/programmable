# Threat model

Adversarial threat review of `src/VolFeeHook.sol` and `src/lib/VolMath.sol`, backed by 61 passing tests (24 VolMath, 18 mandatory-fee, 12 vol-adaptive, 4 stateful invariants, 3 mainnet-fork) and a Slither pass with 0 true-positive findings. Nothing here is a substitute for independent review by the maintainers.

## Threat surface

- Fee manipulation (dynamic LP fee). The fee for swap N is read in `beforeSwap` from the volatility state accumulated by prior swaps; the state is updated only in `afterSwap`. A trader cannot lower their own fee with their own trade. Test: `test/VolAdaptiveFee.t.sol::test_manipulation_ownSwapCannotLowerOwnFee`, asserting `ewmaAfter` above `ewmaBefore` and `feeAfter` at least `feeBefore`, monotonic.
- Fee bounds. `VolMath.feeFromVol` is pure with overflow guards that clamp to `MAX_LP_FEE`, so the fee can never leave `[MIN_LP_FEE, MAX_LP_FEE]` for any `ewmaVol`. Tests: `VolMath.t.sol` fuzzing, `VolAdaptiveFee.t.sol::test_fee_always_in_bounds`, and `invariant_feeAlwaysInBounds` (7680 fuzzed calls, 0 reverts).
- Volatility suppression. Wash-trading tiny swaps to keep `ewmaVol` low pays the mandatory volume fee on every swap and yields no private advantage, because a lower fee is a public good shared by all traders, and the floor `MIN_LP_FEE` bounds the downside. Treated as a residual and accepted.
- Solvency. The hook holds exactly `programmableFeeOwed + projectFeeOwed` in ERC-6909 quote claims, with no reserve and no subsidy. `invariant_solvency` asserts `manager.balanceOf(hook, quote)` equals the owed total across every fuzzed swap sequence.
- Reentrancy. All swap-path work runs inside the PoolManager unlock, with no external call to attacker code. Claims are zero-before-pay (checks-effects-interactions), and a nested `unlock` reverts, so a malicious claim destination cannot double-claim. No `ReentrancyGuard` is required because every value-moving step runs inside the PoolManager unlock with CEI-ordered claims.
- Fee bypass. The mandatory fee is collected in all four quadrants on the executed basis, and the dynamic LP-fee override does not change the mandatory-fee accrual. Test: `test_mandatory_fee_still_works`.
- Pool binding. `afterInitialize` binds the first quote-pool once (`PoolAlreadyBound` on any second init), requires a dynamic-fee pool (`NotDynamicFee`), and sets the base fee and volatility state. Alternative pools never inherit VolFee behavior.

## Static analysis

Slither reports 17 findings with 0 true-positive: 3 `unused-return` (intentional, since `poolManager.unlock()` returns empty bytes and `getSlot0` is partially destructured), 5 `reentrancy-benign` or `reentrancy-events` (the calls are to the trusted PoolManager inside its lock and claims are CEI-ordered), and 9 `naming-convention` (SCREAMING_CASE immutables and underscore-prefixed params, an intentional style).

## Real-infrastructure evidence

`test/fork/VolFeeFork.t.sol` brings up the hook against the real mainnet PoolManager `0x000000000004444c5dc75cB358380D2e3dE08A90` (identity by codehash), opens a dynamic-fee pool, and checks mandatory-fee accrual, solvency, and that the previewed LP fee rises after volatile swaps while staying within bounds.
