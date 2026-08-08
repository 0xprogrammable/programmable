# Threat model

**Project:** Egregore

This submission-scoped threat model summarizes the repository's own [`THREAT_MODEL.md`](../../THREAT_MODEL.md);
that file is the canonical, more detailed version and is bound as evidence below.

## Assets and value at risk

- Presale ETH contributions (pre-finalize), held by `EgregorePresale`.
- Protocol-owned liquidity minted to the canonical pool at bootstrap, held by `EgregoreBootstrapper` with no removal
  path in this proposal.
- Staked EGR principal held by `EgregoreHook`.
- Accrued protocol buckets in the hook: `builderEgr/Eth`, `programmableFeeEgr/Eth`, `pendingRewardEgr/Eth`,
  `reserveEgr/Eth`, `marketSupportEgr/Eth`, `lpIncentiveEgr/Eth`. EGR is burnable (OpenZeppelin ERC20Burnable); no
  balance is a signature, proof, or ERC-6909 claim.

## Trust boundaries

- **PoolManager** — the canonical, immutable per-chain Uniswap v4 deployment. Every hook callback authenticates
  `onlyPoolManager`; on a production deploy (`validateHookAddress = true`) `EgregorePresale` also enforces the exact
  canonical address per chain, so a non-canonical PoolManager cannot be silently substituted outside dev-only chains
  (31337/1337/Sepolia).
- **The presale contract** — the sole caller authorized to call `configurePool()`/`activate()` on the hook and
  `bootstrap()` on the bootstrapper (each one-shot).
- **guardian / treasuryRecipient / builderManager (deploy-time) / securityRecipient / PROGRAMMABLE_FEE_RECIPIENT** —
  see Authorities below.
- No router, factory, launcher, app, game, service, database, oracle, keeper, signer, issuer, indexer, API, quote
  provider, or monitoring operator is part of this project.

## Custom hook boundary (`hook.used = true`)

Permission mask: `afterInitialize`, `beforeAddLiquidity`, `afterRemoveLiquidity`,
`afterRemoveLiquidityReturnDelta`, `beforeSwap`, `beforeSwapReturnDelta`, `afterSwap`, `afterSwapReturnDelta` — every
other flag is false, giving mask `0x19cd`. Deployment: CREATE2 from `EgregoreHookDeployer`, which searches for the salt
itself inside its own constructor until the address carries those flag bits. No salt is supplied from outside, so the
launch takes no off-chain parameter and cannot be deployed against a mismatched one. `scripts/lib/hook-planner.js`
keeps the same search off-chain purely as an independent mirror, and a test asserts the contract picked exactly the
salt and address predicted for it.

Per enabled callback: PoolManager authentication is `onlyPoolManager` throughout; the intended PoolKey is the single
one stored by `configurePool()`; callback `sender` meaning is used exactly once, to suppress all tax/snapshot effects
when `sender == address(this)` (the hook's own buyback swap — this also matches v4-core's own behavior of skipping a
hook's callback for its own PoolManager call); no `hookData` is used or validated; return shapes are documented in
`submission.json.hook.postReturnDeltaAccounting`; nested-action suppression is the same self-call check; revert effect
is "never revert the user's swap or liquidity action for tax reasons" (a paused/inactive hook or non-matching pool
returns a zero delta instead of reverting).

## Value flows and accounting

See `submission.json.valueFlows` for the full settlement description of every value-moving action. Summary:
Egregore's own tax (afterSwap) is taken via `poolManager.take()` and settled by the hook's own returned `int128`
against the unspecified currency (H-1 audit fix — the project tax never lands on the specified side, so the take()
always settles instead of leaving a dangling delta); the LP-exit tax (afterRemoveLiquidity) works the same way
per-currency. The mandatory Programmable fee is separate: in the two quadrants where ETH is the specified currency it
is taken in `beforeSwap` via a `BeforeSwapDelta` whose specified component is backed by a `take()` for exactly the
amount returned, and reconciled in `afterSwap` against the executed amount, so it likewise never leaves a dangling
delta.
No ERC-6909 claims are used. `customAccounting.conservationEquation`: the hook's own token/ETH balance always equals
the sum of every accounting bucket plus staked principal, minus `totalEgrBurned` for EGR.

## Dynamic fees and recipients

Egregore's own tax is **static** in rate structure (fixed formulas, no admin-adjustable rate), but its rate is not a
single constant: buys are flat 500 bps; sells follow a continuous 1000-2000 bps curve driven by a rolling price
snapshot (anti-dump, not price-manipulable by splitting a dump into smaller swaps, since the curve is continuous and
keyed to a 5-minute-refreshed snapshot, not the immediately preceding swap). The mandatory Programmable fee
(10 bps, `programmableFee`) is modeled fully in `submission.json` and uses the canonical fixed-quote-asset basis —
always ETH, measured on executed volume — via the quadrant-dependent before/after path; see PROPOSAL.md's fee section.

Recipient shares (`hook.feeMechanism.recipients`) sum to 1,000,000 ppm: builder/dev 50,000 ppm to the immutable
`DEV_FEE_RECIPIENT`; the remaining 950,000 ppm splits into three internal buckets (staker reward 475,000 ppm, reserve
285,000 ppm, market support 190,000 ppm in normal mode; reweighted to 20/50/30 of the remainder in stress mode without
changing recipient identities). None of the three internal buckets has a mutable external address at the fee-mechanism
level; downstream, `reserve` is later paid out via `flushTreasury` to the mutable, two-step-transferable
`treasuryRecipient` role.

## Attack and failure scenarios

- **Unauthorized callback**: blocked by `onlyPoolManager`/`onlyPresale` on every entry point.
- **Reentrancy**: every function that performs an external ETH/token transfer is `nonReentrant`, on top of
  checks-effects-interactions (bucket zeroed before the transfer). PoolManager callbacks are excluded from the guard
  specifically so the protocol's own buyback `unlock`/`swap`/`settle`/`take` sequence does not deadlock against an
  outer `nonReentrant` lock.
- **Sandwich MEV on protocol buybacks**: every buyback (`flushTreasury`'s ETH-side reserve buyback,
  `releaseMarketSupport`'s stress-mode buyback) is bounded by `maxBuybackSlippageBps` against the pool's pre-swap
  price and reverts `SlippageExceeded` if it would fill worse than that bound, leaving every bucket untouched.
- **Same-block stake-then-exit**: `SameBlockExit` blocks unstake/claim in the same block as the triggering stake.
- **Locked-stake griefing**: `emergencyUnstake` always lets a staker exit principal while the guardian pause is
  active, regardless of an active lock tier, so a pause cannot trap funds.
- **Malicious/non-canonical PoolManager**: only reachable in dev mode (`validateHookAddress = false`, gated to
  chainid 31337/1337/11155111); `test/egregore.spec.js`'s `lets a malicious pool manager drain bootstrap ETH and EGR`
  test documents this as an explicit, disclosed dev-mode-only risk, not a production one.
- **Insolvency / bucket underflow**: every bucket increment is backed 1:1 by a real inflow (`poolManager.take()` or a
  direct donation transfer); no code path credits a bucket without a matching balance increase.

## Dependency identity

See `submission.json.dependencies`: one onchain dependency (the canonical Uniswap v4 PoolManager, address pinned per
chain) and four offchain/build-time library dependencies (OpenZeppelin Contracts, Uniswap v4-core, Uniswap
v4-periphery, solmate — the last only transitively, via v4-core's `ProtocolFees`, and only reachable in the
`test/egregore.v4.spec.js` build that compiles the real PoolManager, never in Egregore's own deployed contracts).

## Product and data boundaries

No UI, app, game, API, service, keeper, oracle, indexer, quote, trade, claim, or monitoring surface is built or
planned in this proposal (`integration.platformHandoff.intended = false`). `submission.json.integration.dataReconstruction`
describes the *intended* design for a future events-only indexer (cursor, reorg/backfill/reconciliation policy, and
reserve-reconstruction solvency equation) should one be built later; none of it is implemented today.

## Authorities and recovery

| Role | Controller | Mutable | Delay | User-exit impact |
| --- | --- | --- | --- | --- |
| guardian | constructor address | no (role itself immutable) | none | Pauses user actions/tax capture for up to 7 days (auto-expires); `emergencyUnstake` always remains available. |
| treasuryRecipient | two-step transfer | yes | none beyond the two-step accept | Only changes fee-split percentages / unlocks `releaseMarketSupport`; never moves staked principal or blocks unstaking. |
| builderManager (deploy-time) | n/a — `DEV_FEE_RECIPIENT` is a compile-time constant | no | n/a | None. |
| PROGRAMMABLE_FEE_RECIPIENT | itself only, via `claimProgrammableFees` or `claimProgrammableFeesTo`; every other caller reverts | no (address itself immutable) | none | None. |
| presale | immutable, set once at hook construction | no | none | None; one-shot setup inside the same `finalize()` transaction. |
| securityRecipient | constructor address | no | none | None; one-time allocation. |

## Known limitations

- No independent third-party audit. The project has been reviewed and iteratively hardened across two AI-assisted
  audit passes plus a dedicated review for this submission; local tests do not constitute an audit.
- Enabling `beforeSwapReturnDelta` is inherently the highest-risk hook permission, because a specified-side delta can
  in principle consume the whole swap amount. Egregore declares `zeroAmmLeg: forbidden` and
  `specifiedDeltaCanConsumeEntireAmount: false`, and the returned component is bounded to 10 bps of the specified
  amount, but this is exactly the surface an independent specialist review should target.
- No indexer, monitoring, or incident-response tooling is built; `operations.monitoring`/`incidentResponse` in
  `submission.json` describe only what the guardian pause and emitted events already provide, not a running system.
- This proposal targets Ethereum Mainnet only; `productionPoolManagerForChain` only recognizes Mainnet and Sepolia.
- Acceptance, independent review, product integration, deployment, runtime matching, lifecycle evidence, monitoring,
  routing, discovery and availability are all separate, later trust decisions not established by this document.
