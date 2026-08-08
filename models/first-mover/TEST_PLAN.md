# First Mover test plan

## Unit behavior

- Symbol normalization folds ASCII case, leaves non-letter bytes alone, and rejects an empty or overlong symbol.
  Complete: `test_foldsAsciiCase`, `test_leavesNonLetterBytesAlone`, `test_rejectsEmptySymbol`,
  `test_rejectsOverlongSymbol`, `testFuzz_normalizationIsIdempotent`.
- Non-ASCII lookalikes register as distinct tickers. Asserted as a documented limitation rather than a protection,
  so that any future change to normalization has to update the test consciously:
  `test_nonAsciiLookalikesAreDistinctTickers`.
- Claim lifecycle resolves correctly at every boundary: unclaimed with no pool, provisional inside the grace window,
  lapsed exactly at the boundary, confirmed forever. Complete: `test_unclaimedWhenNoPool`,
  `test_provisionalInsideTheGraceWindow`, `test_lapsesExactlyAtTheGraceBoundary`,
  `testFuzz_confirmedClaimNeverLapses`.
- Tribute splits exactly and rounds toward the derivative. Complete:
  `test_tributeIsTwentyPercentOfTheCreatorShare`, `test_zeroShareLeavesTheFeeIntact`,
  `testFuzz_roundingFavoursTheDerivative`.
- `registerPool` rejects a non-creator registrar. Complete: `test_rejectsNonCreatorRegistrar`.
  Outstanding: a token whose `symbol()` reverts.

## Integration lifecycle

- First registration takes a provisional claim and is not yet original. Complete:
  `test_firstRegistrationTakesAProvisionalClaim`.
- A claim confirms once the pool accrues the threshold. Complete: `test_claimIsEarnedByTradingNotByRegistering`.
- A confirmed claim never lapses. Complete: `test_confirmedClaimNeverLapses`.
- An unearned claim lapses and the ticker becomes takeable. Complete:
  `test_unearnedClaimLapsesAndFreesTheTicker`.
- A copy is recorded as a derivative rather than rejected, with case folding applied. Complete:
  `test_copyIsRecordedAsDerivativeNotRejected`.
- Unrelated symbols do not collide. Complete: `test_differentSymbolsDoNotCollide`.
- Tribute routes to the original's accrued balance and the derivative keeps the remainder. Complete:
  `test_tributeRoutesToTheOriginalsVault`.
- The launcher share, builder share and total charged are identical on a derivative. Complete:
  `test_tributeIsInvisibleToTheTrader`.
- No tribute while the original is provisional, and none after it lapses. Complete:
  `test_noTributeWhileTheOriginalIsOnlyProvisional`, `test_tributeStopsIfTheOriginalsClaimLapses`.
- A derivative cannot confirm the ticker however much it trades. Complete: `test_derivativeCannotTakeTheTicker`.
- Hook callbacks reject callers other than the PoolManager, and only the builder beneficiary can claim the builder
  share. Complete: `test_onlyPoolManagerCanCallHookCallbacks`, `test_onlyBuilderCanClaimTheBuilderShare`.
- Outstanding: exact-output and sell-direction fee assertions; a chain of three or more copies of one ticker.

## Properties

Stateful invariants over arbitrary swap sequences and block progression across four pools — two competing for one
ticker, one holding a second, one that never trades — in `test/invariant/FirstMoverInvariant.t.sol`. Complete,
16,384 calls per invariant:

- `invariant_claimTokensMatchAccounting` — the hook's claim-token balance always equals what it has accrued. This is
  the solvency property: if tribute ever created or destroyed a wei, it would break.
- `invariant_accrualsSumToTheTotal` — every wei belongs to exactly one pool, the launcher or the builder.
- `invariant_launcherAndBuilderSharesRemainEqual` — both fixed shares are 10 bps and accrue identically regardless
  of how much volume ran through derivative pools, which proves tribute never reaches them.
- `invariant_derivativeNeverHoldsTheTicker`
- `invariant_confirmedClaimIsNeverReassigned`
- `invariant_confirmationImpliesEarned` — a confirmed claim was always paid for in volume.
- `invariant_untradedPoolNeverConfirms`

Fuzzed properties, complete: normalization idempotence over arbitrary byte strings; the tribute split conserving its
input across the full `uint256` range; tribute never exceeding the fee; both lifecycle predicates total; availability
being the exact complement of liveness.

## Release evidence

- The suite runs against the revisions installed by `scripts/bootstrap-deps.sh`. Pinning them is a release gate.
- A mainnet-fork lifecycle is a release gate and is not yet included.
- Runtime hashes and source verification are recorded after deployment. Not applicable at `design` status.

## Defects found by this suite

One, before submission:

1. `splitTribute` computed tribute with a plain multiplication, which overflows on fee amounts near the `uint256`
   maximum. Unreachable with real ETH, but it made the one fee calculation in this model the only one in the
   repository that could revert on a large input. It now uses `FullMath.mulDiv` like every other fee path. Found by
   `testFuzz_splitNeverReverts`, which now asserts conservation across the entire range rather than merely that the
   call returns.
