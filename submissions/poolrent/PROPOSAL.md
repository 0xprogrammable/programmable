# Proposal

**Submission stage:** Prototype
**Model id:** `poolrent`

PoolRent auctions the right to set one canonical Uniswap v4 launch pool's LP fee on a continuous,
permissionless rent auction, and pays that rent to the pool's own liquidity providers — so the value
arbitrageurs extract from LPs is bid back to them instead of leaking into the block builder's fee
market.

## Design card

| Item | Confirmed design |
| --- | --- |
| Outcome | A creator launches one fixed-supply token against WETH in a single canonical dynamic-fee v4 pool. Anyone may post a WETH deposit and bid a per-block rent for the right to manage that pool: the winner sets the LP fee inside immutable bounds and accrues half of a fixed 20 bps volume charge, while the rent is donated to in-range liquidity providers every swap. Traders get a fee set by someone whose revenue depends on volume; LPs get paid for the flow their liquidity attracts. |
| Pool | `currency0`/`currency1` = sorted(launched token, WETH9 `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`). `fee` = `LPFeeLibrary.DYNAMIC_FEE_FLAG` (`0x800000`), `tickSpacing` = 60, `hooks` = the one mined `PoolRentHook` instance. Liquidity is formed atomically by `PoolRentLauncher` as a single full-range position the launcher then permanently owns. Alternative pools are rejected outright: `beforeInitialize` admits exactly one PoolKey, once. |
| During a trade | All four direction × exactness modes are supported. The manager's LP fee (or `DEFAULT_LP_FEE` when the auction is vacant) is returned as a `beforeSwap` override. The 20 bps hook-owned charge is taken on executed gross quote-side (WETH) volume: in `beforeSwap` on the two quadrants where WETH is the specified currency, in `afterSwap` on the two where it is unspecified. Rent owed to liquidity providers is donated in the same `afterSwap`. |
| Value | LP fee → liquidity providers, in full, always. 20 bps hook-owned charge → exactly 10 bps to the immutable Programmable owner `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` as a claimable liability, and 10 bps to the current auction manager as a separately-keyed claimable liability; with no manager — or in the very block a manager took the seat — that half is donated to liquidity providers instead. Rent → liquidity providers via `PoolManager.donate`. Auction deposits stay owned by their depositor and are withdrawable at any time. |
| Creator choices | Token name, symbol and fixed supply; tick spacing; initial `sqrtPriceX96`; the seeded liquidity and its caps. All are fixed at launch, inside the hook's CREATE2 preimage. |
| Fixed platform rules | The 20 bps total and its non-additive 10 bps platform split; the immutable platform owner; one canonical pool per hook; the LP-fee bounds `[1 bp, 200 bps]` and `DEFAULT_LP_FEE` of 30 bps; the 110% outbid threshold; the 100-block minimum tenure and deposit floor; the one block of rent paid on entry; the minimum rent. None has a setter. |
| Authorities | Programmable owner: claims only its own accrued liability, to a destination it chooses per claim. Pool manager (rotating, permissionless, whoever currently wins the auction): sets the LP fee within immutable bounds, claims only its own accrued liability. Any account: bids, withdraws its own deposit, triggers accrual. There is no admin, owner, guardian, oracle, keeper, upgrade path, pause, rescue, mint, blacklist or sweep anywhere in the system. |
| Dependencies | Uniswap v4 `PoolManager` at `0x000000000004444c5dc75cB358380D2e3dE08A90` (onchain, immutable in the hook, authenticated on every callback). WETH9 at `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` (existing ERC-20, quote asset). Build-time: pinned Uniswap v4-core/v4-periphery, OpenZeppelin Contracts and OpenZeppelin Uniswap Hooks commits. No oracle, keeper, bridge, price feed or offchain dependency exists. |
| Failure | Every callback authenticates the PoolManager and reverts otherwise. A foreign PoolKey, a second initialization, a wrong start price and a wrong permission mask all revert at launch. A partial fill on the two `beforeSwap`-charged quadrants reverts rather than charging volume the pool never executed. A donation that cannot land — no in-range liquidity — is skipped, never reverted, and the rent is carried. Manager insolvency evicts in constant time and the pool continues at `DEFAULT_LP_FEE`. There is no migration or retirement path because there is nothing to migrate: the hook is immutable and every balance is withdrawable by its owner. |
| Project surfaces | Solidity contracts only: `src/PoolRentHook.sol`, `src/PoolRentLauncher.sol`, `src/PoolRentToken.sol`, `src/libraries/PoolRentMath.sol`, plus a Foundry deployment plan in `script/Launch.s.sol`. No app, game, server, keeper, oracle or project indexer is declared or shipped. |
| Product surfaces | None supplied by this project. Discovery, quoting, trading, claiming and monitoring interfaces are platform-owned and out of scope for this submission. |
| Not used | ERC-6909 claim custody, hook-held liquidity positions, oracles, keepers, proofs, cross-chain messages, external liquidity venues, async swaps, custom curves, permissioned assets, transfer taxes, automatic liquidity, upgrades, presales, vesting, staking and rewards. Hook callbacks not enabled: `beforeAddLiquidity`, `afterAddLiquidity`, `beforeRemoveLiquidity`, `afterRemoveLiquidity`, `beforeDonate`, `afterDonate`, `afterAddLiquidityReturnDelta`, `afterRemoveLiquidityReturnDelta`. |

## Why Uniswap v4 and architecture choice

`hook.used` is **true**. The mandatory Programmable fee policy is integrated into the project's one
custom hook rather than deployed as a second standard-profile hook, because a v4 PoolKey binds
exactly one hook address and the custom behaviour and the charge must settle in the same callbacks.

The mechanism is three things that only a hook can do, atomically, on the pool itself:

1. **A per-swap LP fee chosen by the current auction winner.** `beforeSwap` returns the manager's fee
   with `LPFeeLibrary.OVERRIDE_FEE_FLAG`. Expressed as a router charge it would be bypassable —
   traders would simply route around it — and expressed as a static pool fee it could not change
   hands at all.
2. **A charge measured on executed gross quote-side volume across all four quadrants.** Only
   before/after swap return deltas can carve a charge out of what the pool *actually* executed rather
   than what the trader requested. That distinction is the whole point of the executed-basis rule: a
   price-limited swap must not be charged for volume that never happened.
3. **Paying rent to liquidity providers with `PoolManager.donate`, inside the swap.** Rent reaches
   in-range liquidity proportionally, in the same transaction, with no registry of LPs, no custody of
   positions, and no keeper to run.

None of it is expressible as an LP fee alone, a transfer tax, a router surcharge, or an offchain
service. Nothing in this design has been moved into the hook to fill a template: the contracts hold
the auction, the accounting and the settlement, and there is no app, service, keeper or indexer
because the mechanism does not need one.

## Lifecycle

| Action | Actor | Assets and state | Recipient | Observable | Failure |
| --- | --- | --- | --- | --- | --- |
| Token creation | launch wallet, via `PoolRentLauncher.deployAndLaunch` | `PoolRentToken` deployed with CREATE2, full fixed supply minted once to the launcher | launcher, then the launch wallet for the unspent remainder | `Launched` | Reverts the whole launch |
| Hook deployment | same transaction | `PoolRentHook` deployed with CREATE2 at a mined address; the constructor validates its own permission bits | — | `Launched` | A wrong salt reverts in the hook constructor |
| Pool initialization | same transaction | `PoolManager.initialize` on the canonical key; `beforeInitialize` verifies every key member and the start price; `afterInitialize` seeds `DEFAULT_LP_FEE` | — | `Initialize` | `UnexpectedPool`, `AlreadyInitialized` |
| Liquidity formation | same transaction | One full-range position added through `unlock`/`modifyLiquidity`, both currencies settled, amounts capped | launcher, permanently | `ModifyLiquidity` | `QuoteExceeded`, `TokenExceeded`, `UnexpectedDelta` |
| Initial transaction | any trader | An ordinary swap on the canonical pool | — | `Swap`, `FeeAccrued` | Ordinary v4 revert paths |
| Swaps | any trader, any router | LP fee override applied; 20 bps charge accrued; rent donated | LPs, platform, manager | `Swap`, `FeeAccrued`, `RentDonated` | `PartialFillRejected`, `UnexpectedPool` |
| Liquidity changes | any liquidity provider | Unmediated — the hook enables no liquidity callbacks and never gates or custodies a position | LP | `ModifyLiquidity` | Ordinary v4 revert paths |
| Donations | the hook only, from `afterSwap` | `pendingRent` donated to in-range liquidity, then settled from the hook's WETH | LPs | `RentDonated` | Skipped when there is no in-range liquidity; rent is carried, the swap still succeeds |
| Auction bid | any account | WETH pulled into a per-account deposit; on a handover one block of rent is paid on entry, the tenure starts, and the LP fee resets to its default | liquidity providers, for the entry rent | `DepositAdded`, `RentAccrued`, `ManagerChanged` | `RentTooLow`, `DepositTooSmall`, `TenureProtected`, `OutbidTooLow` |
| Rent accrual and eviction | anyone, lazily, or any swap | Constant-time charge from the incumbent's deposit into `pendingRent`; automatic eviction on exhaustion | LPs | `RentAccrued`, `ManagerChanged` | Cannot revert a swap; the charge is capped at the remaining deposit |
| Fee or reward claims | the immutable owner, or a manager, for its own liability only | `feeOwed` decremented, WETH transferred to a destination chosen per claim | claimant's chosen address | `FeeClaimed` | `NothingOwed`, `ZeroAddress` |
| Deposit withdrawal | any depositor, for its own balance | Deposit decremented and transferred; a manager below its floor is evicted in the same call | depositor's chosen address | `DepositWithdrawn` | `InsufficientDeposit`, `ZeroAddress` |
| Payout changes | — | Not used. Recipients are the immutable platform owner and whoever holds the rotating manager role; neither is a stored mutable recipient. | — | — | — |
| Dependency failure | — | The only runtime dependencies are the PoolManager and WETH9. A WETH transfer that fails reverts the individual call it belongs to and isolates no other beneficiary; the PoolManager is immutable and non-upgradeable. | — | — | Fail-closed |
| Retirement | — | Not used, with reason: the hook is immutable, holds no position, and every balance it holds is withdrawable by its owner at any time, so there is nothing to wind down. | — | — | — |

## Assets, pool behavior, optional callbacks, and integration

| Asset id | Role | Origin | Address | Behavior | Issuer controls | Failure effect |
| --- | --- | --- | --- | --- | --- | --- |
| `launched-token` | launched | new fixed supply | deployed at launch (CREATE2) | plain ERC-20, 18 decimals, no tax, rebase, hook or callback | none — no owner, minter, pauser or blacklist exists | n/a |
| `weth9` | quote | existing ERC-20 | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | standard WETH9, 18 decimals, returns true, no fee on transfer | none relevant | A failing transfer reverts only its own call |

Canonical PoolKey, launch path and liquidity formation are described in the lifecycle table. Router
generation is not constrained: any router may swap the pool, and no swap client is supplied with this
submission (`routingMode` is not-planned). Supported swap modes are all four. Partial fills are
permitted on the two quadrants charged in `afterSwap` and rejected on the two charged in
`beforeSwap`. Slippage, deadlines and Permit2 remain the router's concern; the hook adds no
requirement and consumes no signature. State reads use `StateLibrary` against the PoolManager only.

All 14 hook permissions:

| Permission | Value | Permission | Value |
| --- | :-: | --- | :-: |
| `beforeInitialize` | true | `afterInitialize` | true |
| `beforeAddLiquidity` | false | `afterAddLiquidity` | false |
| `beforeRemoveLiquidity` | false | `afterRemoveLiquidity` | false |
| `beforeSwap` | true | `afterSwap` | true |
| `beforeDonate` | false | `afterDonate` | false |
| `beforeSwapReturnDelta` | true | `afterSwapReturnDelta` | true |
| `afterAddLiquidityReturnDelta` | false | `afterRemoveLiquidityReturnDelta` | false |

Derived mask: **`0x30CC`**. The deployed address carries exactly these low bits, and the hook's
constructor validates that itself, so a mis-mined salt cannot produce a live pool.

Every callback checks `msg.sender == poolManager` against an immutable address. The `sender` argument
of `beforeSwap`/`afterSwap` is the router or position manager that called the PoolManager and is
never treated as the trader; no authorization anywhere in this system reads it, `tx.origin`, or any
caller identity supplied by a third party. `hookData` is declared unused and is ignored entirely, so
arbitrary bytes cannot alter accounting. Return shapes are the required `(bytes4, BeforeSwapDelta,
uint24)` and `(bytes4, int128)`. The hook makes direct PoolManager calls — `donate`, `take`, `sync`,
`settle` — but never `swap` or `modifyLiquidity`, so v4's self-call callback suppression can never
skip a charge; the `selfCallPolicy` is `same-pool-swap-fee-enforced-internally`, the value the
standard requires from any hook making direct PoolManager calls, and a test proves no path from the
hook reaches `PoolManager.swap`.

## Product integration plan

| Surface | Intended behavior | Source of truth | Inputs and outputs | Failure or unsupported state | Planned paths and tests |
| --- | --- | --- | --- | --- | --- |
| UI | Not used. No interface is supplied with this submission; presenting the model is platform-owned. | — | — | — | — |
| App or game | Not used. The model has no application layer. | — | — | — | — |
| API | Not used. No service is supplied. | — | — | — | — |
| Service, keeper, or oracle | Not used, with reason: rent accrual is lazy and computed on read, eviction is triggered by any interaction, and no price or external input is ever consumed. Nothing needs to be run for the mechanism to be correct. | — | — | — | — |
| Indexer | Not supplied by the project. The events below are sufficient for a platform indexer to reconstruct every liability and the full auction history from the launch block. | onchain events | — | Reorg handling is the indexer's concern | `test/Fee.t.sol`, `test/Auction.t.sol` |
| Quote | Not supplied. `V4Quoter` against the canonical PoolKey reflects the live LP fee and the hook's return deltas, because both are computed inside the same callbacks the quoter simulates. | PoolManager | — | — | — |
| Trade | Not supplied. Any router may trade the pool. | PoolManager | — | Partial fills reject on two quadrants | `test/Fee.t.sol` |
| Claim | `claimFee(to, amount)` on the hook, permissionless in form and self-scoped in effect: each caller can only ever move its own accrued liability. | hook state | `(to, amount)` → WETH transfer | `NothingOwed`, `ZeroAddress` | `test/Fee.t.sol` |
| Monitoring | Not supplied. `isSolvent()` and `totalLiabilities()` expose the single check a monitor would need. | hook state | — | — | `test/Invariants.t.sol` |

`integration.platformHandoff.reviewStatus` is `pending-maintainer-review`, `maintainerReviewRequired`
is true, `selfApproval` is false, and `availabilityClaimed` is false. No Hooklist, routing, discovery
or listing provider has been approached, and none is implied by this submission.

Events sufficient for reconstruction: `FeeAccrued`, `FeeClaimed`, `ManagerChanged`, `LpFeeUpdated`,
`RentAccrued`, `RentDonated`, `DepositAdded`, `DepositWithdrawn`, `Launched`.

## Fees, recipients, and settlement

**Root `programmableFee` record.** `effective = max(selected, 10 bps)`; exactly 10 bps to
Programmable; only the remainder to the project. PoolRent selects a total of **20 bps**
(`selectedHundredthsOfBip = 2000`), so `effective = 2000`, `platform = 1000`, `project = 1000`. The
worked examples the policy fixes hold in this implementation's arithmetic: a selected total of `0`
becomes `10 bps + 0`; a selected total of `3%` becomes `0.1% + 2.9%`, never `3.1%`. The 10 bps is
never added on top of a selected total.

The charge applies to **every successful swap on the canonical PoolKey**, on the **executed gross
quote-side amount after partial-fill behaviour**, measured before either portion is deducted, in all
four swap modes. Quadrant paths, with WETH as the quote asset and `currency1` in the expected
ordering (the hook derives the ordering at construction and handles both):

| Swap mode | Basis | Charged currency | Specified? | Collection path |
| --- | --- | --- | --- | --- |
| `zeroForOne-exactInput` | gross-output | WETH | unspecified | `after-swap-return-delta` |
| `zeroForOne-exactOutput` | gross-output | WETH | specified | `before-swap-return-delta` |
| `oneForZero-exactInput` | gross-input | WETH | specified | `before-swap-return-delta` |
| `oneForZero-exactOutput` | gross-input | WETH | unspecified | `after-swap-return-delta` |

`collectionPath` is `quadrant-dependent-swap-return-delta`. `selfCallPolicy` is
`same-pool-swap-fee-enforced-internally`, which is the policy the standard requires whenever a hook
makes direct PoolManager calls. This hook does make them — `donate`, `take`, `sync` and `settle`,
all inside `afterSwap` — but it never calls `swap` or `modifyLiquidity` on any path. The internal
enforcement is therefore trivially satisfied: there is no hook-initiated same-pool swap for v4's
self-call callback suppression to skip, and a test proves no path from the hook reaches
`PoolManager.swap`.

The policy is integrated into the project's **one custom hook**. There is no router charge, no LP-fee
substitute, no transfer tax, no donation path and no alternative pool that could satisfy or bypass
it — a second pool with these currencies cannot be initialised at all.

The **immutable owner and sole claim authority is `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`**,
a Solidity `constant`, claimable at any time to itself or to a destination it selects for that
individual claim. Its 10 bps accrues as a **claimable liability**, not an auto-transfer. No builder,
project, administrator, manager or stored mutable recipient can claim, mutate, sweep, rescue, net or
redirect it; the contract exposes no function that could.

Liabilities are keyed `(poolId, currency, owner)` with **no cross-pool netting** — the hook serves
exactly one pool, so cross-pool netting is structurally impossible. Value flow id
`programmable-volume-fee-accrual`; collection event `FeeAccrued(bytes32 indexed poolId, address
indexed currency, address indexed beneficiary, uint256 amount)`; claim event `FeeClaimed(bytes32
indexed poolId, address indexed currency, address indexed beneficiary, address to, uint256 amount)`.
Source path `src/PoolRentHook.sol` and `src/libraries/PoolRentMath.sol`; test paths `test/Fee.t.sol`
and `test/Invariants.t.sol`.

**The three value mechanisms are distinct and are not interchangeable:**

- **LP fee (belongs to liquidity providers).** Dynamic, `applicationMode: before-swap-override`,
  initial value 30 bps written once by `afterInitialize` through `updateDynamicLPFee`. After that
  single write there is no persistent update actor at all — nothing ever rewrites the pool's stored
  fee again — because every later change is a per-swap override: the manager's chosen value returned
  with the override flag from `beforeSwap`. That is why the stored 30 bps is exactly what applies
  whenever the auction is vacant. Bounds: minimum
  1 bp, maximum 200 bps, enforced on write and again on read. Input metric: the current auction
  manager's declared value — not a price, liquidity, depth or market-cap observation, and not
  derived from any pool state, so there is nothing about it a trade can manipulate. Observation mode
  is `not-applicable` for that reason. Update cadence: whenever the manager chooses, with no rate
  limit, bounded by the immutable range. Manipulation resistance: the value is a declared parameter
  of a role that must be paid for at auction; a trader cannot influence it within a swap, and the
  manager cannot exceed the bounds. Failure rule: an out-of-range value reverts; a vacant auction
  falls back to the stored 30 bps. Recipient: `pool-liquidity-providers`, in full, always.
- **Hook-owned charge.** 20 bps, charged in WETH on every quadrant per the table above. Recipients:
  `programmable-platform` at `sharePpm 500000` bound to the exact immutable address, and
  `pool-manager` at `sharePpm 500000`, derived from hook state at accrual time and rotating only
  through the permissionless auction. **Rounding carries the numerator, not the quotient.** Each
  entitlement is accrued directly from the executed gross against its own persisted remainder:
  `numerator = executedGross * rate + carry`, `amount = numerator / 1_000_000`, `carry = numerator -
  amount * 1_000_000`, at `rate = 1000` for the platform and `1000` for the project, **independently**
  rather than by splitting one rounded total. That distinction is what makes the entitlement exact:
  flooring the combined 20 bps once per swap destroys any entitlement worth less than a wei, so a
  thousand 499-wei swaps would pay the platform nothing while the identical 499,000 wei of aggregate
  volume owes it 499 wei — and splitting an already-floored total cannot recover what flooring
  removed. Carrying the numerator makes charging a volume as one swap and as a thousand swaps agree
  to the wei. The exact-output legs solve for the gross that leaves the trader exactly their net,
  bounded and failing closed rather than looping. A charge can never consume the whole executed
  amount; a unit withheld by that bound is returned to the carry — project side first, so the
  mandatory platform entitlement is the last thing ever reduced — rather than dropped. The remainders
  are `platformFeeCarry` and `projectFeeCarry`, both public; this hook serves one canonical pool and
  one quote currency and the platform owner is a compile-time constant, so each is inherently keyed by
  `(poolId, currency, owner)`. Claiming moves `feeOwed` and never touches either, and the project
  remainder survives a handover, an eviction and the vacant-seat path. Claims are per-beneficiary and self-scoped; there are no historic entitlement
  changes because a liability, once accrued to an address, is that address's forever. A failed
  transfer to one beneficiary reverts only that claim and blocks no other.
- **Rent.** Not a fee on trading at all: a per-block payment by the manager, out of its own deposit,
  to the liquidity providers, settled with `donate`. One block is charged on entry, so taking the
  seat is never free, and the deposit floor is verified after that payment — a new manager must be
  funded for a full minimum tenure at the moment it holds the seat, not merely at the moment it
  bid. Correspondingly, a manager accrues no share of the hook-owned charge in the block it took
  the seat; that half goes to liquidity providers instead. Without those two rules a searcher
  could take a vacant seat, collect the manager half of a swap it front-ran, and withdraw its
  whole deposit in the same block, having paid rent for no elapsed blocks.

**Custom-accounting settlement order, per swap:** accrue rent → compute the quadrant charge →
`take` the full charge in WETH from the PoolManager → credit the platform and manager liabilities →
`donate` pending rent to in-range liquidity → `sync`, transfer, `settle` the donation. Conservation:

```
WETH.balanceOf(hook) >= totalDeposits + pendingRent + totalFeeOwed
```

Three disjoint liability namespaces — auction deposits, rent owed to liquidity providers, and
claimable fee liabilities — never netted against each other. Every unit of WETH the hook holds is
attributable to exactly one of them, and each has an unconditional exit: deposits by withdrawal,
liabilities by claim, rent by donation.

Routing, quote, indexer, scanner, aggregator and listing support is **not claimed**. A hook that
returns deltas and a dynamic fee is not automatically supported by every aggregator or scanner;
local compatibility is not provider approval, and no fallback is asserted for a provider that does
not support this runtime.

## Semantic examples

All figures in WETH wei, at the declared 20 bps total with a 50/50 split.

1. **`oneForZero-exactInput`, charged in `beforeSwap`, rounds down.** Trader specifies exactly
   `1_000_000_000_000_000_000` WETH in. Charge `= floor(1e18 × 2000 / 1_000_000) = 2_000_000_000_000_000`.
   The AMM executes `998_000_000_000_000_000`. Platform `= ceil(2e15 / 2) = 1_000_000_000_000_000`;
   manager `= 1_000_000_000_000_000`. Sum equals the charge exactly.
2. **`zeroForOne-exactOutput`, charged in `beforeSwap`, grossed up.** Trader wants exactly `1e18`
   WETH out. Gross `= ceil(1e18 × 1_000_000 / 998_000) = 1_002_004_008_016_032_064`; charge
   `= 2_004_008_016_032_064`. The trader receives exactly `1e18`; the charge is `0.2000%` of the gross,
   as declared, rather than `0.2004%` of the net.
3. **`zeroForOne-exactInput`, charged in `afterSwap`, rounds down.** The AMM produces
   `997_004_991_562_331_100` WETH. Charge `= floor(997_004_991_562_331_100 × 2000 / 1_000_000)
   = 1_994_009_983_124_662`. The trader receives the remainder. The basis is what the pool executed,
   never what the trader requested.
4. **Sub-wei entitlements aggregate exactly.** An executed gross of `499` wei owes the platform
   `499 × 1000 = 499_000` numerator: `0` whole wei, carry `499_000`. After a third such swap the carry
   reaches `1_497_000`, so `1` wei is paid and `497_000` carried. Over 1,000 such swaps the platform is
   paid exactly `499` wei — the same as one swap of `499_000` wei. Flooring each swap separately pays
   `0`, which is the conformance defect this revision corrects.
5. **Rounding to zero, and what it leaves behind.** A swap whose executed quote amount is `499` wei
   pays `0` whole wei now, so no liability is booked and no accrual event is emitted, and the swap
   succeeds normally — but `499_000` of numerator is retained on each side, so the entitlement is
   deferred rather than destroyed.
6. **Value conservation over a rent cycle.** A manager deposits `10e18` and bids `1e15` per block.
   Entry charges one block immediately, so `deposits` is `10e18 - 1e15` and `pendingRent` is `1e15`.
   After 50 further blocks another `50 × 1e15 = 5e16` moves across, for `5.1e16` in total, and on
   the next swap with in-range liquidity it is donated. Before, during and after,
   `balanceOf(hook) >= totalDeposits + pendingRent + totalFeeOwed` holds to the wei.
7. **Failure case — partial fill on a `beforeSwap` quadrant.** A trader submits `oneForZero-exactInput`
   for `1e18` with a `sqrtPriceLimitX96` the pool reaches after `4e17`. The charge was already taken
   against `1e18`, so the swap reverts with `PartialFillRejected` rather than charging the trader for
   `6e17` of volume the pool never executed.
8. **The policy's fixed examples.** Selected `0` → effective `1000`, platform `1000`, project `0`.
   Selected `500` → effective `1000`, platform `1000`, project `0`. Selected `1000` → effective
   `1000`, platform `1000`, project `0`. Selected `300000` (3%) → effective `300000`, platform `1000`
   (0.1%), project `299000` (2.9%). Never `310000`.

## Fact provenance

- **Builder-stated:** the product intent, the economic argument for auctioning fee-setting rights,
  the choice of parameter values (20 bps total, the LP-fee bounds, the 110% outbid threshold, the
  100-block tenure and deposit floors), and the assessment that a rational manager bids against
  expected flow.
- **Agent-derived:** the quadrant-to-collection-path mapping from the declared quote asset, the
  permission mask `0x30CC` from the enabled callbacks, the rounding directions from the declared
  basis, and the risk-dimension floors implied by the triggered features.
- **Evidence-backed:** everything asserted about behaviour — the permission mask on the deployed
  address, the four-quadrant charge arithmetic, executed-versus-requested basis, the split and its
  rounding, claim authority, solvency, eviction, donation, and compatibility with the deployed
  mainnet PoolManager and WETH9 — is bound to the test and evidence artifacts listed in
  `TEST_PLAN.md` and `evidence/`, at the exact commit declared in this application.

## Open decisions

1. **Rent reaches only in-range liquidity.** `donate` pays active liquidity, proportionally, exactly
   as the pool pays fees. A provider whose position is out of range earns no rent while inactive.
   This is deliberate and tested, but it is a design choice a maintainer may want to revisit — the
   alternative, an internal pull ledger, would mean the hook tracking or custodying positions, which
   is a materially larger trust surface.
2. **Manager share versus platform share.** The 50/50 split of a 20 bps total is a parameter, not a
   structural requirement. The implementation computes the split from `PLATFORM_SHARE_PPM` and the
   declared total, so a maintainer-preferred total or split is a constant change plus a re-mined
   salt, not a redesign.
3. **Minimum tenure length.** 100 blocks protects a new manager from being sniped immediately before
   a large arbitrage, at the cost of letting an incumbent hold a mispriced fee for roughly twenty
   minutes. Both directions are defensible; the value is immutable once launched.
4. **No transition period on eviction.** The original auction-managed-AMM literature stages a handover
   window. PoolRent evicts and installs immediately once the outbid and tenure conditions are met,
   which is simpler to reason about and to prove, but gives a challenger the whole next block.
5. **One block of entry rent is a blunt instrument.** It makes taking the seat cost something, but
   the sharper guard is that a manager accrues no share in its entry block. A maintainer may prefer
   a longer prepaid period instead; both are constants, not structure.

This is a public, non-confidential proposal. The skill and local checker do not prove that fees are
collected live. Acceptance, independent review, product integration, deployment, runtime matching,
lifecycle evidence, monitoring, routing, listing, scheduling and availability require separate
evidence records.
