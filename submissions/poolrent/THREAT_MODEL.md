# Threat model

Scope: `src/PoolRentHook.sol`, `src/PoolRentLauncher.sol`, `src/PoolRentToken.sol`,
`src/libraries/PoolRentMath.sol`, at the exact commit declared in this application. Everything the
hook touches is on Ethereum mainnet; there is no offchain component to attack.

## Assets and value at risk

| Asset | Held where | Owner | Maximum at risk | Exit |
| --- | --- | --- | --- | --- |
| Auction deposits (WETH) | ERC-20 balance of the hook | the depositing account | the sum of open deposits | `withdrawDeposit`, unconditional, any time |
| Rent owed to liquidity providers (WETH) | ERC-20 balance of the hook, tracked as `pendingRent` | in-range liquidity providers | rent charged since the last donation | donated from `afterSwap`; carried, never lost, when there is no in-range liquidity |
| Accrued volume-fee liabilities (WETH) | ERC-20 balance of the hook, tracked per beneficiary in `feeOwed` | the immutable Programmable owner and past/present managers | total unclaimed liabilities | `claimFee`, self-scoped, any time |
| The initial full-range position | PoolManager, owned by `PoolRentLauncher` | nobody — the launcher exposes no decrease, collect or rescue path | the seeded liquidity | none, by construction; it is permanently locked |
| Trader funds in flight | PoolManager, transiently | the trader's router | one swap | ordinary v4 settlement |

The hook never custodies a liquidity position, never holds the launched token, and never holds
native ETH. It has no `receive`, no `fallback`, and no path that forwards value to an
attacker-supplied target.

## Trust boundaries

| Boundary | Trusted? | Why it is safe |
| --- | --- | --- |
| `PoolManager` → hook callbacks | trusted, authenticated | Every callback checks `msg.sender` against an **immutable** PoolManager address set at construction. A foreign caller reverts. |
| Router / `sender` argument | **untrusted** | The `sender` argument of `beforeSwap`/`afterSwap` is whatever contract called the PoolManager. No authorization anywhere reads it. Nothing in this system reads `tx.origin` either. |
| `hookData` | **untrusted, ignored** | Declared unused. The hook never decodes it, so arbitrary bytes cannot influence a fee, a liability or the auction. |
| The launched token | trusted by construction | Deployed by the launcher in the same transaction, immutable, fixed supply, plain ERC-20 with no callback, tax, rebase or hook. |
| WETH9 | trusted, pinned | The canonical mainnet WETH9 at a fixed address, a well-known non-reentrant, non-fee-on-transfer ERC-20. All movements use `SafeERC20`. |
| The pool manager (auction winner) | **untrusted** | A rotating, permissionless role that must pay for itself. Its only powers are setting the LP fee inside immutable bounds and claiming its own liability. |
| Liquidity providers, traders, bidders | **untrusted** | All interactions are permissionless and self-scoped. |

## Custom hook boundary

`hook.used` is true. Permission mask `0x30CC`: `beforeInitialize`, `afterInitialize`, `beforeSwap`,
`beforeSwapReturnDelta`, `afterSwap`, `afterSwapReturnDelta`. The other eight bits are off, and the
hook's constructor validates its own deployed address against the declared permissions, so a
mis-mined salt cannot produce a live pool.

**Pool admission.** Both currencies, the tick spacing, the dynamic-fee flag, the hook address and
the initial `sqrtPriceX96` are constructor immutables and therefore live inside the CREATE2
preimage. `beforeInitialize` recomputes the expected `PoolId`, compares every key member and the
start price, and rejects a second initialization outright. This closes the pool-capture class
directly: a third party cannot front-run the launch to bind this hook to a pool of their choosing,
and no later initialization can re-point the hook at a second key while balances are outstanding.

**Return deltas.** `beforeSwapReturnDelta` is the highest-review-path capability and it is used
deliberately: the quadrant-dependent executed-gross-quote basis cannot be implemented without it.
The returned specified delta is always a **positive** charge backed by a real `take` of the same
amount in the same transaction; it never fabricates output value, and it can never consume the whole
executed amount, so a no-op swap cannot be produced. Residual AMM amount is
`amountSpecified + specifiedDelta`; the caller's final delta is the PoolManager swap delta minus the
hook delta.

**Nested actions.** The hook calls the PoolManager directly for `donate`, `take`, `sync` and
`settle` — and **never** `swap`. That matters because v4 skips a hook's own callbacks when the hook
calls the PoolManager: if the hook could swap its own pool, the charge would be silently skipped.
It cannot, and a test proves there is no path from the hook to `PoolManager.swap`.

The declared `selfCallPolicy` is `same-pool-swap-fee-enforced-internally`, because the standard
requires that value from any hook that makes direct PoolManager calls. Read it as the stronger
statement it is here: the only direct calls are `donate`, `take`, `sync` and `settle`, so there is no
internal swap path to enforce a charge on in the first place.

## Value flows and accounting

```
WETH.balanceOf(hook) >= totalDeposits + pendingRent + totalFeeOwed
```

Three disjoint namespaces, never netted against each other:

1. **Deposits** — `deposits[account]`, summing to `totalDeposits`. Increased only by a transfer in,
   decreased only by a withdrawal to the depositor's chosen address or by rent charged to the manager.
2. **Rent** — `pendingRent`. Increased only from a manager's deposit — per elapsed block, plus one
   block charged on entry — or from the manager half of the charge when the auction is vacant or the
   seat has just changed hands. Decreased only by a donation to liquidity providers.
3. **Fee liabilities** — `feeOwed[beneficiary]`, summing to `totalFeeOwed`. Increased only by an
   accrual backed by an equal `take`. Decreased only by that beneficiary claiming its own balance.

Rounding is directional and declared: charges carved out of a known gross amount round **down**;
charges grossed up onto a net amount round **up**; the platform's half of each charge rounds **up**
so per-swap rounding can never leave the immutable owner short, and the manager takes the exact
remainder. `platform + manager == charge` holds to the wei for every possible charge, including odd
and dust amounts. Residual dust from directional rounding stays in the hook, is covered by the
solvency inequality above, and is disclosed rather than swept — there is no sweep function.

## Dynamic fees and recipients

The **LP fee** is dynamic and set by the current manager within `[1 bp, 200 bps]`, applied as a
per-swap `beforeSwap` override, and paid entirely to liquidity providers. It is bounded on write and
again on read, so even a corrupted state cannot present an out-of-range fee. Its input is a declared
parameter of a paid-for role, not an observation of price, liquidity or depth — there is nothing in
it for a trade to manipulate, and a trader cannot change it inside a swap.

The **hook-owned charge** is a fixed 20 bps with two recipients whose shares sum to exactly
1,000,000 ppm:

- `programmable-platform`, 500,000 ppm, bound to the exact address
  `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` as a Solidity `constant`. Not a storage slot; not
  settable; not redirectable. No builder, project, administrator, manager or arbitrary caller can
  claim it, mutate it, sweep it, net it or point it elsewhere, because no function exists that could.
- `pool-manager`, 500,000 ppm, resolved from hook state at accrual time. When the auction is vacant,
  or in the very block a manager took the seat, the share is added to `pendingRent` and donated to
  liquidity providers instead — so the charge is never unowned, never accrues to a zero address, and
  a one-block seat is never a free option on the next swap.

A liability, once accrued to an address, belongs to that address permanently. Rotating the manager
does not move a past manager's balance, and a claim by one beneficiary can never touch another's.

## Attack and failure scenarios

| # | Scenario | Outcome |
| --- | --- | --- |
| 1 | Front-run the launch and initialise the pool first, or bind the hook to a different key | Reverts. Every key member and the start price are committed in the CREATE2 preimage and checked in `beforeInitialize`. |
| 2 | Initialise a second pool with the same currencies and the same hook | Reverts — the hook admits exactly one PoolKey, once. There is no alternative pool to route around the charge. |
| 3 | Route through a custom router, or pass crafted `hookData`, to dodge the charge | No effect. Nothing reads the router identity or `hookData`; the charge is computed from the swap parameters and the executed delta. |
| 4 | Use a price limit so the swap partially fills, to be charged on more volume than executed | On the two quadrants charged in `afterSwap`, the basis is the executed delta, so this is already correct. On the two charged in `beforeSwap`, the swap reverts with `PartialFillRejected` rather than overcharging. |
| 5 | Reenter the hook from a token callback | WETH9 has no callback and the launched token has none. All transfers use `SafeERC20`, all state is written before any external call in the paths that move value, and the only external calls are to the PoolManager and to WETH. |
| 6 | Manager sets an extreme LP fee to grief traders | Bounded at 200 bps by an immutable constant, and it costs the manager rent every block to hold the role. A 100% fee is structurally impossible. An incoming manager also starts at `DEFAULT_LP_FEE` rather than inheriting the outgoing one's choice. |
| 7 | Manager refuses to pay / lets the deposit run out | Eviction is automatic, constant-time and permissionless. The charge is capped at the remaining deposit, and the pool continues at the default fee. |
| 7b | Incumbent re-bids its own rent forever to keep its protection window armed, so the seat is never contestable | The tenure only restarts on a genuine handover. An incumbent may raise its rent, but doing so does not buy it a fresh protection window. |
| 8 | Attacker snipes the manager role immediately before a large arbitrage | The incumbent is protected for `MIN_TENURE_BLOCKS`, and a challenger must beat the standing rent by at least 10%. Sniping is possible but is priced, and the sniper earns no share in its entry block. |
| 9 | Manager bids, wins, front-runs a swap, and withdraws in the same block to avoid paying | Two independent guards. Taking the seat charges one block of rent on entry, so the round trip always costs at least that. And the manager share of the charge is donated to liquidity providers, not accrued, in the block the seat changed hands — so there is nothing to collect. Rent is also accrued before every state change, including the withdrawal, and withdrawing below the floor evicts the manager in the same call. Asserted directly as a regression. |
| 10 | Drain another account's deposit or another beneficiary's liability | Impossible: both are strictly keyed by `msg.sender`, and no function accepts an arbitrary account to debit. |
| 11 | Grief the pool by forcing the donation to revert | A donation is skipped, never attempted, when there is no in-range liquidity, and rent is carried to the next opportunity. A swap never reverts because of rent distribution. |
| 12 | Many tiny swaps versus one large swap, to farm rounding | Directional rounding bounds the difference to declared dust, the platform half rounds up, and the solvency invariant holds across arbitrary generated sequences. Asserted as an explicit regression. |
| 13 | Make the hook insolvent by ordering operations adversarially | The stateful invariant suite drives mixed sequences of swaps, bids, withdrawals, fee changes, liquidity changes, claims and block rolls and asserts the solvency inequality after every one. |
| 14 | Unbounded loop / gas griefing on a critical path | Rent accrual, eviction and charge computation are all O(1) and iterate over nothing. No array grows with the number of managers, depositors or beneficiaries. |
| 15 | PoolManager or WETH9 behaves unexpectedly | Both are immutable, non-upgradeable mainnet contracts. A failing WETH transfer reverts only the call it belongs to and isolates no other beneficiary; a failing PoolManager interaction reverts the swap. Fail-closed throughout. |

## Dependency identity

| Dependency | Kind | Identity | Failure policy |
| --- | --- | --- | --- |
| Uniswap v4 `PoolManager` | onchain, runtime | `0x000000000004444c5dc75cB358380D2e3dE08A90`, chain 1, immutable in the hook | Reverts propagate; no fallback exists or is needed |
| WETH9 | onchain, runtime | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`, chain 1, immutable in the hook | `SafeERC20`; a failure reverts only its own call |
| Uniswap v4-core / v4-periphery | build-time | pinned by exact commit | Build-time only |
| OpenZeppelin Contracts / Uniswap Hooks | build-time | pinned by exact commit | Build-time only |

No oracle, keeper, relayer, bridge, price feed, signature scheme or offchain service exists in this
design, so none can fail, be censored, go stale, or be impersonated.

## Product and data boundaries

No UI, app, game, API, service, keeper or project indexer is supplied. No personal data, geolocation,
secret, signature or replay-protected message exists anywhere in the system. Every piece of state a
platform indexer needs is reconstructible from `FeeAccrued`, `FeeClaimed`, `ManagerChanged`,
`LpFeeUpdated`, `RentAccrued`, `RentDonated`, `DepositAdded`, `DepositWithdrawn` and `Launched`,
from the launch block forward, with `isSolvent()` and `totalLiabilities()` available as a direct
onchain reconciliation check.

## Authorities and recovery

| Role | Holder | Capabilities | Mutable | Delay | What users can do if it disappears |
| --- | --- | --- | --- | --- | --- |
| Programmable fee owner | `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`, a compile-time constant | claim only its own accrued liability, to a destination chosen per claim | no | none | Nothing changes for anyone else. Its liability simply stays accrued; no other balance or path is affected. |
| Pool manager | whoever currently wins the auction | set the LP fee inside immutable bounds; claim only its own accrued liability | yes, but only through the permissionless auction | none | The role goes vacant, the pool runs at the default fee, and the manager half of the charge goes to liquidity providers. Nothing stops, nothing locks. |
| Everyone else | any address | bid, deposit, withdraw own balance, trigger accrual and eviction, trade, provide liquidity | — | — | — |

There is deliberately **no** admin, owner, guardian, multisig, timelock, pause, upgrade, migration,
rescue, sweep, mint or blacklist. Recovery is not required because no privileged party can create a
stuck state: every balance is withdrawable by its owner without anyone's cooperation, and the pool
itself keeps working with no manager at all.

## Known limitations

1. `donate` reaches only in-range liquidity. A provider whose position is out of range earns no rent
   while inactive. Deliberate, tested, and stated here rather than hidden.
2. With zero in-range liquidity the donation is skipped and rent accumulates in `pendingRent` until a
   swap can distribute it. Rent is never lost, but its timing is not guaranteed.
3. Per-swap directional rounding leaves bounded dust in the hook. It is inside the solvency
   inequality and there is no function to sweep it, by choice.
4. The auction is an economic mechanism, not a guarantee. If nobody bids, the pool behaves as an
   ordinary dynamic-fee pool. If someone overbids, they subsidise the liquidity providers.
5. A manager can hold a badly-chosen LP fee for up to its minimum tenure. The bound on the damage is
   the 200 bps cap and the rent it pays for the privilege.
6. Eviction installs a challenger immediately once the outbid and tenure conditions are met; there is
   no staged handover window. Simpler to reason about and to prove, but it gives the challenger the
   whole next block.
7. Aggregators, scanners and quoting providers may not support a hook that returns deltas and a
   dynamic fee. No provider support is claimed.
8. Nothing here is deployed, independently reviewed, or audited. Local tests and fork runs are
   compatibility evidence, not a deployment receipt and not an approval.
