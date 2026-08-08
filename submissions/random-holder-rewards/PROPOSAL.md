# Proposal

Random Holder Rewards

## Outcome

Launch one fixed-supply token and one canonical native-ETH Uniswap v4 pool. At creation, the creator chooses immutable buy tax, sell tax, and winner count inside reviewed bounds. The recommended defaults are 1%, 2%, and 10. Each tax includes the mandatory 0.1% Programmable volume fee; the remainder accrues into a holder reward pot. Once at least 30 minutes have passed and the pot contains at least 0.1 ETH, any address may request verifiable randomness. A valid response assigns the snapshotted pot equally to the configured number of unique eligible holders as independent pull-claim liabilities.

Ordinary ERC-20 transfers carry no tax. Alternative pools do not inherit this behavior.

## Immutable configuration

- Ethereum mainnet; native ETH is `currency0` and the launched token is `currency1`.
- Static 0.30% LP fee and tick spacing 60. The LP fee belongs to liquidity providers.
- One hook instance for one canonical PoolKey; permission mask `0x00cc`.
- Fixed one-billion-token supply with 18 decimals and no later mint, burn authority, pause, freeze, blacklist, confiscation, tax, rescue, proxy, or upgrade.
- Mandatory fee: 10 bps on gross executed ETH quote volume for every swap.
- Creator-selected total buy tax: 0.1% to 3%, default 1%. The reward component is the selected total minus 0.1%.
- Creator-selected total sell tax: at least the selected buy tax and at most 5%, default 2%. The reward component is the selected total minus 0.1%.
- Creator-selected winners: 3 to 15, default 10. The bounded candidate-attempt budget is derived as `32 + 4 × winners`.
- These values are constructor-bound and cannot change after launch.
- Round interval: 1,800 seconds. Reward threshold: 0.1 ETH.
- Eligibility: the address appeared in the token's append-only holder index before the snapshot, held at least 0.1% of total supply at the snapshot block, and is not zero, the hook, the token, PoolManager, or a burn address.
- Chainlink VRF v2.5 coordinator, subscription, key hash, confirmation count, and callback gas limit are constructor-bound. Block data is never fallback randomness.

## Four swap quadrants

With native ETH as `currency0`, buys are `zeroForOne` and sells are `oneForZero`.

| Mode | ETH role | Collection | Aggregate rate |
| --- | --- | --- | ---: |
| Buy exact input | specified gross input | before swap | configured buy rate, 0.1–3% |
| Buy exact output | executed unspecified input | after swap, grossed up | configured buy rate, 0.1–3% |
| Sell exact input | executed unspecified output | after swap | configured sell rate, buy rate–5% |
| Sell exact output | specified net output | before swap, grossed up | configured sell rate, buy rate–5% |

Each positive return delta is matched by `PoolManager.take` of exactly the same ETH amount before the callback returns. The hook records liabilities equal to the amount taken. A fee may not consume the complete specified amount, and every amount must fit `int128`.

## Worked examples

### Buy exact input

A trader specifies 1 ETH gross input.

- Platform: `ceil(1 ETH × 0.1%) = 0.001 ETH`.
- Reward pot: `ceil(1 ETH × 1.0%) - platform = 0.009 ETH`.
- AMM input: `1 - 0.01 = 0.99 ETH`.
- Conservation: `0.99 AMM + 0.001 platform + 0.009 reward = 1 ETH`.

### Buy exact output

Suppose the AMM requires 0.99 ETH for the requested token output. Gross quote is `ceil(0.99 / 0.99) = 1 ETH`.

- Platform: 0.001 ETH.
- Reward pot: 0.009 ETH.
- Trader input: 1 ETH.
- Conservation: `0.99 AMM + 0.001 platform + 0.009 reward = 1 ETH`.

### Sell exact input

Suppose the executed AMM output is 1 ETH.

- Platform: `ceil(1 ETH × 0.1%) = 0.001 ETH`.
- Reward pot: `ceil(1 ETH × 2.0%) - platform = 0.019 ETH`.
- Trader output: 0.98 ETH.
- Conservation: `0.98 trader + 0.001 platform + 0.019 reward = 1 ETH`.

### Sell exact output

A trader requests 0.98 ETH net output. Gross quote is `ceil(0.98 / 0.98) = 1 ETH`.

- Platform: 0.001 ETH.
- Reward pot: 0.019 ETH.
- Trader output: 0.98 ETH.
- Conservation: `0.98 trader + 0.001 platform + 0.019 reward = 1 ETH`.

### Reward round at the recommended default

For a 0.100000000000000009 ETH pot, each winner receives `floor(pot / 10) = 0.010000000000000000 ETH`. Nine wei remain in the reward pot. Allocation changes liability ownership but transfers no ETH:

`pot before = winner liabilities added + pot remainder`.

If the coordinator call fails, the callback is unauthorized, or fewer than the configured number of eligible unique addresses are found inside the derived attempt budget, no winner liability is created and the complete pot remains available for a later round. Anyone may expire a still-pending request after two hours; its later callback is rejected, the pot stays intact, and a fresh request may be submitted.

## Game-theory rationale

For `H` symmetric eligible addresses, `W` winners, and pot `P`, an address is selected with probability approximately `W/H` and receives `P/W`, so its expected value remains approximately `P/H`. Winner count therefore changes variance rather than creating free expected return: fewer winners create lottery-like jackpots; more winners create smaller, steadier payouts.

The sell-tax wedge does not create free value either. Rational buyers price expected future selling friction into the amount they will pay. Very high sell tax can reduce buying, liquidity, and taxable volume enough to shrink the reward pot. The 1% buy, 2% sell, 10-winner default is a transparent focal strategy, not a claim of a unique Nash equilibrium. The UI reports friction and variance instead of labelling any configuration safe or optimal.

Uniform address selection still creates a wallet-splitting incentive. The 0.1%-supply eligibility floor makes splitting costly but does not make it identity-proof or Sybil-proof. This remains a disclosed limitation and an independent economic-review item.

## Holder selection and known limits

The token appends each first-time recipient to a stable index and checkpoints balances by block. A round fixes `snapshotBlock = block.number - 1` and the current index prefix before requesting randomness. Candidate index `i` is derived from `keccak256(randomWord, roundId, attempt) % snapshotHolderCount`. The draw skips duplicates and ineligible balances.

Eligibility is address-based, not identity-based. A minimum balance raises the cost of splitting holdings but cannot provide person-level Sybil resistance. An append-only index can accumulate former holders, so a sparse eligible set can cause bounded draws to fail. Fulfillment checks at most `32 + 4 × configured winners` candidates. Failure preserves funds and is visible; no administrator may replace winners.

## Claims and solvency

The immutable Programmable owner `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` alone claims platform liability and chooses a destination for each claim. Each winner alone claims its own liability. The contract decrements liability before sending ETH; a failed destination reverts that claim.

At all times:

`hook ETH balance >= platform liability + reward pot + total winner liability`.

Forced ETH is surplus and creates no entitlement. There is no sweep or rescue path.

## Failure and retirement

Swap-accounting failures revert the complete swap. VRF failure delays only new allocation; swaps, LP exits, platform claims, and existing winner claims remain available. A two-hour permissionless expiry prevents one lost VRF response from locking all later rounds. Liquidity providers may exit through standard v4 paths because the hook enables no liquidity callback. The immutable hook has no administrative retirement action.

## Product boundaries

This repository supplies contracts, tests, and a static token-create configuration UI. The UI validates and exports immutable constructor settings but has no wallet, transaction, deployment, router, quote, API, or indexer path. A future product must disclose the canonical PoolKey, both fee classes, eligibility and Sybil limitations, round status, VRF health, claim state, stale data, and unsupported routing. No deployment, Hooklist, routing, audit, approval, or availability is claimed.
