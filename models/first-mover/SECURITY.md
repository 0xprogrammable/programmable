# First Mover security

## Trust assumptions

**External contracts.** The Uniswap v4 `PoolManager` bound at deployment. `FeeSplitVaultFactoryV1` and
`FeeSplitVaultV1` from the Classic release, unmodified. The launch token, called during registration for `creator()`
and `symbol()`, both inside `try/catch`; a token that reverts on either cannot be registered.

**Privileged actors.** None with authority over the registry. Three immutable addresses claim only their own accrued
balance: the pool's reward vault, the Programmable treasury and the builder beneficiary. No party can grant, revoke,
transfer or override a ticker claim, including Programmable.

**Autonomous services.** None. Claims confirm and lapse as a function of accrued fees and block height, evaluated
when read.

## Invariants

**A claim cannot be granted, only earned.** `_maybeConfirm` sets `confirmed` only when the claiming pool's lifetime
creator fees cross the threshold. There is no external setter.

**A derivative can never take the ticker it copies.** `_maybeConfirm` returns immediately for a derivative pool,
regardless of its volume.

**Tribute never exceeds the fee it is drawn from.** `splitTribute` computes tribute as a fraction of the creator fee
and returns the remainder, so the two always sum to the input.

**Tribute never touches the launcher or builder shares.** Those amounts are computed before tribute is considered
and are not arguments to `splitTribute`, which makes reducing them structurally impossible rather than merely
unintended.

**The total charged on a swap is independent of derivative status.** Tribute redistributes the creator share after
the fee is taken. A trader is charged identically on a derivative and a non-derivative pool at the same fee.

**Lifetime fees are monotonic.** Confirmation is measured against `lifetimeCreatorFees`, which is never reset.
Claiming accrued fees cannot undo progress toward a claim.

**Tribute is evaluated at accrual, not recorded at registration.** A derivative registered against a provisional
claim pays nothing until that claim confirms, and stops if it lapses.

## Ordering and MEV

**Registration ordering matters and is contestable.** Two launches of the same ticker in the same block are settled
by transaction order, and a proposer can influence that. The consequence is bounded: the loser becomes a derivative
of a claim that is still provisional and owes nothing unless the winner earns it.

**Confirmation can be front-run.** A party who sees a launch intending to claim a ticker can launch first and
generate the confirmation volume themselves. See Known limitations.

**No oracle.** Nothing in this model reads an external price or feed.

## Known limitations

**Ticker front-running.** The primary residual risk. An actor with capital can register a desirable symbol and trade
against themselves to cross the confirmation threshold before the project that intended to use it launches. The
threshold costs real money at real risk, and the claim block and volume are public, but the model does not prevent
it. A confirmed claim asserts "this pool traded this ticker first", not "this team owns this brand".

**ASCII case folding only.** Symbols using non-ASCII lookalikes register as distinct tickers. Full homoglyph defence
belongs in an indexer, not a contract.

**Scope is the catalog.** The registry settles ownership among pools launched through this model. It has no reach
over tokens deployed elsewhere.

**Storage growth.** One claim record per distinct symbol ever registered, never pruned. Bounded by launches, and
lapsed claims are overwritten rather than accumulating.

**Overflow found by fuzzing.** `splitTribute` originally computed tribute with a plain multiplication, which
overflows on fee amounts near the `uint256` maximum. No real fee reaches that magnitude, but it made this the only
fee calculation in the repository that could revert on a large input. It now uses `FullMath.mulDiv`, consistent with
every other fee path. Found by `testFuzz_splitNeverReverts`.

**No audit.** This model has not completed an external audit or a public security contest.
