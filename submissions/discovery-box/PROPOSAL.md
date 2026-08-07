# Proposal

Submission stage: proposal
Model id: `discovery-box`

Discovery Box is a market mechanism for openable assets. The canonical prototype lets a holder trade an unopened membership bundle or burn one whole `BOX` to activate 30 days of access. Each opening advances an irreversible maturity count that lowers the canonical pool's sell LP fee.

## Design card

| Item | Confirmed design |
| --- | --- |
| Outcome | Buy, hold, sell or open a fixed membership bundle. Opening is irreversible and every box has the same utility. |
| Supply | 100 whole `BOX`, 18 decimals, fixed at creation. |
| Pool | One canonical native ETH/`BOX` dynamic-fee PoolKey with tick spacing 60. Alternative pools do not inherit this model. |
| Maturity | 40 opened boxes. The target and fee curve are immutable. |
| LP fees | Buys use 0.30%. Sells fall linearly from 1.00% to 0.30% by 40 openings. LP fees belong to liquidity providers. |
| Programmable fee | Exactly 0.10% of executed gross ETH-side volume on every canonical-pool swap. The project takes no hook-owned fee. |
| Hook custody | PoolManager ERC-6909 native-currency claims held only to back the immutable Programmable owner's accrued liability. No LP position or user `BOX` custody. |
| Authorities | One-shot canonical pool registrar and immutable Programmable fee owner. No mutable admin, pause, upgrade, rescue or sweep. |
| Product surface | A local demo shows the canonical pool, buy, open, membership expiry, current fee and owner claim. |
| Not used | Oracle, keeper, proof, cross-chain message, permissioned asset, async swap, custom AMM curve or model-specific hookData. |

## Why Uniswap v4

`hook.used` is `true`. One custom hook integrates 2 atomic swap behaviours:

- a directional LP-fee override based on the immutable `openedBoxes` counter
- Programmable's required gross ETH-volume fee in all 4 swap modes

This is a genuine v4 dependency. A token transfer tax or app surcharge cannot apply an LP-fee override inside PoolManager and would be bypassable through another router.

Opening remains in the selected `IOpenableAsset`. It does not happen in a swap callback. The hook reads only the irreversible opening count and pins the maturity target during construction.

`DiscoveryBox` is the canonical membership asset. Ticket and deterministic collectible contracts are bounded reference applications. They prove that a different opening outcome does not require different swap accounting. They are not extra launch assets or pools.

The website is a demonstration and read layer. It is not an authority over membership or fee state.

## Lifecycle

1. `DiscoveryLaunchFactory` hashes the caller and caller-selected seed into a caller-bound BOX salt, then calls the bound `DiscoveryBoxFactory` to CREATE2-deploy 100 `BOX` with no later mint authority. The BOX factory accepts this child deployment only from that launch factory.
2. It calls `DiscoveryHookFactory` with a HookMiner salt, the pinned PoolManager, the new asset, itself as registrar and the fixed Programmable owner. The hook factory accepts deployment only from that registrar and rejects an address whose permission bits are not `0x10cc`.
3. The launch factory registers the exact native ETH/`BOX` dynamic-fee PoolKey and initializes it. `afterInitialize` confirms the registered PoolId and initial price, then sets the stored starting LP fee to 0.30%.
4. During one authenticated PoolManager unlock, the launch factory forms the maximum representable one-sided position over ticks -600 to 0. The raw position remains permanently owned by the factory, which exposes no principal-removal path. The caller-bound launch stores that caller once as the pool's LP-fee recipient and may collect accrued fees without changing liquidity; any base-unit BOX rounding remainder goes to that caller. Copying the public launch calldata derives a different BOX address for a different caller and cannot steal this entitlement. The prototype does not require an Initial Buy.
5. The contracts support all four swap quadrants through compatible v4 routers. This repository supplies no production router, quote path or trade UI; those remain separate integration work. The hook authenticates PoolManager and the exact PoolId.
6. A holder calls `open(n)` with whole boxes. The canonical membership asset burns `n * 1e18`, increases `openedCount` by `n` and sets expiry to `max(currentExpiry, block.timestamp) + n * 30 days`.
7. The immutable Programmable owner may claim no more than its accrued native ETH liability to itself or a destination selected for that claim.

Any failed onchain step reverts atomically. There is no retirement or migration authority. Direct `BOX` transfers and third-party liquidity exits do not depend on the website.

## Hook boundary

The permission mask is `0x10cc`.

| Permission | Used |
| --- | --- |
| `afterInitialize` | yes |
| `beforeSwap` | yes |
| `afterSwap` | yes |
| `beforeSwapReturnDelta` | yes |
| `afterSwapReturnDelta` | yes |
| All other permission bits | no |

Every callback requires the pinned PoolManager as `msg.sender` and the one registered PoolId. The hook does not use callback `sender` as user identity and does not use `hookData`.

`beforeSwap` reads `openedBoxes`, calculates the directional LP fee and returns the dynamic-fee override flag. A failed or malformed token read reverts. Swap callbacks may mint only the exact ERC-6909 claim needed to back the fee. Same-pool hook-initiated swaps are forbidden.

## Fee rules

The selected total hook-owned fee is 10 basis points. The general rule is:

```text
effective = max(selected total, 10 bps)
Programmable = 10 bps
project = effective - 10 bps
```

This project selects 10 basis points, so Programmable receives 10 basis points and the project receives zero. A future 3% selection would split into 0.1% for Programmable and 2.9% for the project, not 3.1% total.

Native ETH is `currency0` and the quote asset. The collection path is:

| Swap mode | ETH position | Callback |
| --- | --- | --- |
| zero for one, exact input | specified gross input | before swap |
| zero for one, exact output | executed unspecified input | after swap |
| one for zero, exact input | executed unspecified gross output | after swap |
| one for zero, exact output | specified gross output | before swap |

For a successful exact-input buy with gross ETH input `G`, the hook fee is `floor(G * 1000 / 1,000,000)`. The AMM receives `G - fee`; the returned hook delta makes the caller's final ETH input remain `G`.

For an exact-output buy where the AMM needs ETH input `X`, the hook uses `fee = floor(X * 1000 / 999,000)`. Gross caller input is `X + fee`, and the fee is exactly 10 basis points of that gross amount rounded down.

For an exact-input sale with gross AMM ETH output `G`, the fee is `floor(G * 1000 / 1,000,000)`. The caller receives `G - fee`.

For an exact-output sale requesting net ETH output `N`, the hook uses `fee = floor(N * 1000 / 999,000)`. The AMM outputs `N + fee`; the caller receives exactly `N`.

The formulas above show the zero-carry case. The hook stores the platform residual of `cumulative gross ETH volume * 1000` on the same 1,000,000-unit scale as the fee for the canonical pool lifetime. Gross modes divide by 1,000,000; fee-on-top modes divide the net-plus-prior numerator by 999,000, which preserves the same gross-volume identity across alternating modes. Claims do not reset the remainder. The project rate is exactly zero, so its independent fee stream is inert.

Zero execution is fee-free. Every positive executed gross ETH amount below 1,000 wei reverts before any claim mint, liability write or remainder write, in all four swap quadrants. Exactly 1,000 wei is admissible. This fixed fail-closed minimum makes fragmentation behavior independent of prior swaps and claim timing.

Specified-ETH paths reject a partial core fill because the pre-swap fee must not be based on an unexecuted request. Unspecified-ETH paths calculate the fee from the actual core result.

The hook calls `PoolManager.mint` for the native-currency claim, increases the exact `(poolId, native ETH, owner)` liability and returns the equal positive hook delta. Minting the claim creates a hook debt without transferring ETH before the router settles. The returned delta cancels that debt by unlock completion.

For a claim, the hook starts a separate PoolManager unlock. Its authenticated callback burns the hook-owned ERC-6909 claim and takes the equal underlying ETH to the owner's chosen destination. Burn and take cancel each other before that unlock ends. The invariants are:

```text
final caller delta = core swap delta - hook delta
hook ERC-6909 native-claim balance >= aggregate recorded ETH liability
new liability = claim minted = positive hook delta
claim amount = claim burned = underlying ETH taken
```

There is no cross-pool netting, claim transfer, stored mutable recipient, builder withdrawal, project withdrawal or rescue path.

## Numerical examples

These examples isolate the hook-owned fee from AMM price movement and the LP fee.

| Mode | Core or requested ETH | Fee | Final result |
| --- | ---: | ---: | --- |
| Buy, exact input | gross caller input 1,000,000 wei | 1,000 wei | AMM receives 999,000; caller pays 1,000,000 |
| Buy, exact output | AMM input 999,000 wei | 1,000 wei | caller pays gross 1,000,000 |
| Sell, exact input | AMM gross output 1,000,000 wei | 1,000 wei | caller receives 999,000 |
| Sell, exact output | caller requests net 999,000 wei | 1,000 wei | AMM outputs 1,000,000; caller receives 999,000 |

At 0 openings, the sell LP fee is 1.00%. Each opening reduces it by 1.75 basis points. At 20 openings it is 0.65%. At 40 or more it is 0.30%. The buy LP fee remains 0.30%.

## Product integration plan

| Surface | Plan | Failure state |
| --- | --- | --- |
| UI | Implemented local simulation plus optional direct mainnet reads of `openedCount` and the sell fee, and an `open(1)` wallet action | Label simulation and withhold the onchain action on missing addresses, wrong chain or failed reads |
| App | Planned real wallet-gated membership check; not implemented in this repository | Deny premium access when a confirmed membership read fails |
| Quote | Planned stateful quote using the same PoolKey and hook logic; not implemented | Withhold when state changes or parity is unavailable |
| Trade | Planned reviewed v4 router path with final-delta slippage and a bounded deadline; not implemented | Revert and show the transaction error |
| Indexer | Planned confirmed-log reconstruction and direct-read reconciliation; not implemented | Mark data unavailable on stale or inconsistent state |
| Claim | Onchain owner-only native ETH claim is implemented; no claim UI is supplied | Failed transfer leaves liability unchanged |
| Monitoring | Planned reconciliation of opening count, hook ERC-6909 claim balance and liability; not implemented | Withhold transactional integration and publish the affected PoolId and block |

No keeper, oracle or service job is required. No third-party router, Hooklist, indexer, scanner or interface support is claimed. Maintainer review remains required; this proposal cannot approve itself.

## Fact provenance

- Builder-stated: a $10 discovery product should unlock a higher-value fixed membership bundle.
- Agent-derived: 100 boxes, a 40-box maturity target, 0.30% buy LP fee and 1.00% to 0.30% sell LP fee.
- Local evidence: a fixed-seed 20,000-path reduced-form model reaches 40 openings in 72.9% of balanced paths.
- Local evidence: the Foundry suite passes across token behaviour, all 4 swap modes, strict minimum-gross enforcement, fee claims, partial fills, caller-bound atomic launch, non-vacuous exact-output invariants and the first buy from a BOX-only pool.
- Local evidence: pinned-block and current-head Ethereum mainnet fork smoke tests pass against the expected PoolManager address and runtime hash.
- Not yet evidenced: deployment, live fee collection, production routing support, indexer/reorg/backfill integration and product availability.

## Open decisions

There are no architecture-changing decisions left for the isolated prototype. Release factory addresses, mined salts, runtime hashes, deployment records and production app commitments remain release inputs. The initial 1:1 price and -600 to 0 initial tick range are fixed in the reviewed source. Changing those values, the 40-box target or a fee path requires a new preflight revision.
