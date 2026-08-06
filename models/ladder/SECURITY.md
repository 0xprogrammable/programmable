# Ladder security

## Trust assumptions

**External contracts.** The Uniswap v4 `PoolManager` at the address bound into the hook at deployment, read through
`StateLibrary.getSlot0` and settled through `unlock`. `FeeSplitVaultFactoryV1` and `FeeSplitVaultV1` from the Classic
release, used unmodified for reward-vault authentication. The launch token, called once during registration for
`creator()` inside a `try/catch`; a token that reverts or returns the zero address cannot be registered.

**Privileged actors.** None with authority over the model's behavior. Three immutable addresses can each claim only
their own accrued balance: the reward vault recorded at registration, the Programmable treasury, and the builder
beneficiary. The custody wallet's `Ownable` owner names the beneficiary of released tranches and nothing else;
`transferOwnership` and `renounceOwnership` both revert.

**Autonomous services.** None. There is no keeper, no scheduler and no off-chain component. Observation happens
inside `afterSwap` on swaps that would occur regardless.

**Off-chain dependencies.** None. The unlock rule reads only `block.number` and the pool's own tick.

## Invariants

**Accounting.** Every swap's fee splits into creator, launcher and builder components that sum to the charged total.
Both fixed shares are carved out of the declared fee and never added on top; `_apportion` clamps them against the
available total so neither can be starved by rounding. Exact-output grosses up with `mulDivRoundingUp` so the hook
cannot under-collect. `_assertFullFill` reverts any exact-input swap whose settled native amount does not match the
fee charged in `beforeSwap`.

**Authorization.** Only the recorded token creator may register a pool. Only the recorded registrar may initialize
it. Only the recorded reward vault may claim creator fees; only the treasury its share; only the builder beneficiary
its own. Release and forfeiture are permissionless to call but their destinations are immutable, so an arbitrary
caller gains nothing beyond paying gas.

**Custody.** A tranche releases at most once. The share base is fixed at the first release, so a later transfer into
the wallet cannot enlarge an earlier tranche. The final tranche pays the remaining balance rather than a computed
share, so rounding dust cannot strand tokens. Released amounts sum to at most the custodied balance.

**Configuration.** Ticks, dwell and tranche count are written once in `registerPool`. The anchor is written once in
`beforeInitialize`, which the PoolManager permits at most once per pool. Shares are immutable in the wallet, which
reads the hook's tranche count at construction and reverts on a mismatch. Neither contract can change the terms
alone.

**Failure recovery.** `LadderScheduleV1.isUnlocked` is total: it returns for every input and never reverts, so a
panic cannot strand an earned tranche. This was not true of the first implementation; see Known limitations.

## Ordering and MEV

**Price sensitivity.** A tranche's release depends on the pool's tick at the evaluated block and on the absence of a
recorded breach across the dwell window. Both are properties of trades that actually executed.

**Transaction ordering.** A proposer choosing which block a swap lands in can move an unlock by at most one block.
Against a dwell floor of 7,200 blocks this is immaterial.

**Oracle use.** None. The tick is read from the hook's own pool, not from an external feed, so there is no oracle to
manipulate and no staleness window.

**Slippage and front-running.** The hook charges a fixed directional fee and does not alter routing, so it adds no
front-running surface beyond Classic's. Observation is a storage write with no value transfer and cannot be
sandwiched for profit.

**Breach completeness.** A v4 pool's tick changes only inside a swap, and the hook runs on every swap in its pools.
There is therefore no path by which the price crosses below a tranche without a breach being recorded. This is what
lets the model work without polling.

## Known limitations

**A creator can buy their own pool up to a level and hold it.** The dwell floor makes this cost real capital held at
real risk for roughly a day, and the whole attempt is public and on-chain, but the model does not prevent it. This
is the primary residual risk. A ladder's levels should be read against the pool's liquidity.

**Thin liquidity makes levels cheap.** The model cannot enforce that a level was reached against meaningful volume.

**Ticks are ETH-denominated.** A ladder does not adjust for moves in ETH itself, so a level set in one regime may
mean something different in another.

**Tick direction is inverted relative to price.** These pools use native ETH as `currency0`, so the pool's tick
measures token per ETH and falls as the token appreciates. Unlock ticks therefore descend as the price targets rise.
An earlier revision of this model compared the tick in the wrong direction, which would have released tranches as the
token fell rather than rose. Integration tests against a live PoolManager found it before submission; the direction
is now asserted end to end in `test_breachStampsTheSuffixOnly` and `test_heldThenDumpedReleasesNothing`.

**Trivially low rungs are possible.** Nothing prevents a creator from setting levels the token has already passed
except the dwell requirement. The full ladder is disclosed at registration and is visible before anyone buys.

**Underflow found by fuzzing.** `isUnlocked` originally subtracted the dwell start from the evaluated height without
guarding the ordering. A breach block at or beyond that height reverted rather than returning false, which would
have propagated into the custody wallet's `releasable()` view and its release path.
`testFuzz_neverUnlocksBeforeDwellFromAnchor` found this; the predicate is now total.

**No audit.** Neither contract has completed an external audit or a public security contest. This file does not
claim one.
