# Test plan

`forge test` reports 61 tests with 0 failures on solc 0.8.26, cancun, optimizer runs 200, viaIR.

## VolMath pure library

`test/VolMath.t.sol` (24 tests). Absolute tick delta over the full int24 range; EWMA alpha bounds (zero, max, and revert), convergence, and monotonicity; fee clamps to the range [min, max]; bad-bounds and bad-k inputs revert. Fuzzing (about 10k runs): the fee stays in [min, max], the fee is monotonic non-decreasing in volatility, and the EWMA stays bounded by the min and max of its inputs.

## Mandatory Programmable fee

`test/ProgrammableFee.t.sol` (18 tests). Dynamic-fee-pool binding plus a `NotDynamicFee` revert on a static pool; the platform slice is always 10 bps; the non-additive split of the 30 bps effective rate; all four swap quadrants (quote as currency0 and currency1); executed-not-requested basis; only the canonical pool accrues; `onlyPoolManager` entry points; owner claims the platform liability and a non-owner cannot; the project claims the project liability and a non-project cannot; solvency (hook ERC-6909 balance equals platform plus project owed); events reconcile; fuzzed fee split.

## Vol-adaptive LP fee

`test/VolAdaptiveFee.t.sol` (12 tests). A calm market keeps the base fee; volatile swaps raise the fee and clamp at the max; manipulation resistance (a swap cannot lower its own fee, asserting `ewmaAfter` above `ewmaBefore` and `feeAfter` at least `feeBefore`, monotonic); the fee always stays in bounds under fuzzing; `lastTick` and `ewmaVol` update in `afterSwap` only; the mandatory fee is unaffected by the LP-fee override.

## Stateful invariants

`test/invariant/VolFeeInvariant.t.sol` (4 invariants, 7680 fuzzed calls, 0 reverts). `invariant_feeAlwaysInBounds` keeps the fee inside its immutable range under any swap sequence; `invariant_solvency` keeps the hook ERC-6909 quote balance equal to `programmableFeeOwed + projectFeeOwed`; `invariant_lastTickTracksPool` keeps the hook `lastTick` equal to the pool tick.

## Mainnet fork

`test/fork/VolFeeFork.t.sol` (3 tests, archive RPC). The real PoolManager `0x000000000004444c5dc75cB358380D2e3dE08A90` is identified by codehash; deploying the hook, opening a dynamic-fee pool, and running swaps exercises mandatory-fee accrual, solvency, and a volatility-responsive fee against real infrastructure; a head smoke check follows.

## Static analysis

Slither 0.11.6 reports 17 findings with 0 true-positive, each with a written disposition in the evidence triage notes.
