# Test plan

Toolchain: Foundry (forge 1.7.1), Solidity 0.8.26, EVM Cancun, optimizer 1000 runs, `via_ir = false`, no CBOR metadata —
matching the Programmable-tested dependency baseline. Run with `forge test`; the fork suite needs `MAINNET_RPC_URL`.

## Actual results (this revision)

**23 tests pass, 0 failed, 0 skipped**, across 5 suites.

### Named safety cases — `test/UndertowSafety.t.sol` (4 pass)
- `test_reentrancy_callbacksRejectNonPoolManager` — every hook callback is gated to the immutable
  PoolManager; a non-manager caller (an attacker mid-reentry) reverts. The hook calls no untrusted code
  (the LVR rebate is a native LP fee, not a pot pay-out), so no reentrant path exists.
- `test_zeroLiquidity_noPhantomFeeNoCorruption` — with no in-range liquidity an executed-basis swap accrues
  no phantom fee, the hook holds nothing (solvent), and its binding/clock state is uncorrupted.
- `test_selfArbDrain_hookNeverDrainable` — 24 adversarial swaps: the accrued liability is always exactly
  backed by held claims and only ever grows; the attacker can never drain it or claim it.
- `test_noDoubleFee_chargedExactlyOnce` — the 10 bps is charged exactly once per swap (one quadrant, never
  both), equal to a single `ceil(0.10%)` of quote volume.

### Unit + fuzz — `test/LvrRecaptureHook.t.sol` (15 pass)
- `test_revertsOnStaticFee` — non-dynamic-fee pool is rejected at initialize.
- `test_bindsCanonicalPool` — one-shot bind; quote currency recorded.
- Mandatory 10 bps in **all four quadrants**: `test_platformFee_zeroForOne_exactIn`, `_zeroForOne_exactOut`,
  `_oneForZero_exactIn`, `_oneForZero_exactOut`. Each asserts the accrued liability **and** solvency
  (`manager.balanceOf(hook, quote) == owed`).
- `testFuzz_platformFee_exactRate` — 1,000 runs: liability is exactly `ceil(quoteIn * 1000 / 1e6)`.
- LVR schedule: `test_surcharge_scalesWithStaleBlocks`, `test_surcharge_capped`, `test_surcharge_zeroSameBlock`.
- Anti-gaming: `test_dustPriming_doesNotResetClock`, `test_materialSwap_resetsClock`.
- Claim authority: `test_claim_onlyOwner`, `test_claim_transfersClaimsToDestination`, `test_claim_rejectsZeroDestination`.

### Stateful invariants — `test/LvrInvariant.t.sol` (2 pass)
Handler drives random swaps (both directions, exact-in/out, random block gaps), catching expected price-limit reverts so
`fail_on_revert = true` stays meaningful. **256 runs × 64 depth = 16,384 calls each, 0 reverts.**
- `invariant_platformLiabilityFullyBacked` — SOLVENCY: the accrued liability is always exactly backed by ERC-6909
  claims the hook holds.
- `invariant_clockNeverInFuture` — the staleness clock never exceeds the current block.

### Economic proof — `test/LvrEconomics.t.sol` (1 pass)
- `test_stalerPool_paysLpsMore` — for the same trade size, a pool stale by 40 blocks produces strictly greater
  currency0 fee growth for in-range LPs than a fresh pool. The LVR recapture is real.

### Mainnet fork — `test/LvrFork.t.sol` (1 pass)
- `test_fork_platformFeeAndSolvency` — against the **real** deployed PoolManager
  `0x000000000004444c5dc75cB358380D2e3dE08A90` (Ethereum mainnet, block ≈ 25.7M): initialize + bind + add liquidity +
  swap; the 10 bps accrues exactly and solvency holds on the live core.

## Coverage of the universal hard tests

Zero/one/boundary/max fee values; both token orderings and both swap directions; exact-input and exact-output;
unauthorized caller on claim; partial-fill fee basis; re-initialization rejected; invariant call/revert counts recorded;
mainnet-fork rehearsal.

## Planned / not yet done
- Independent security audit.
- The autonomous atomic launch graph (`launch.json`) and its deployAndLaunch rollback tests.
- A pinned-archive-block fork run (the current fork rehearsal uses a public full node at recent head).
