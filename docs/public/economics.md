---
description: Trading fees, creator and module rewards, revenue allocation and accounting
---

# Fees and revenue

Trading fees are percentages of the amount exchanged. One basis point, written as bps, is 0.01%; 20 bps is 0.20%. Network gas, initial purchases, liquidity deposits and module operating budgets are separate costs. The launch review shows the selected fees and required funding before wallet confirmation.

## Robinhood Custom Launches

Native20 charges **20 bps (0.20%)** of gross native ETH once per successful buy or sell, rounded up to the next wei. The full 20 bps belongs to Programmable. A project's creator fee and its Uniswap pool fee are additional, so 0.20% is not an all-in maximum. A trade with 1 ETH of gross native value accrues 0.002 ETH for Programmable before any separate creator fee.

The fee kernel credits PoolManager native claims to the fixed platform recipient `0xD88539d3c4C460136a733A3Fd60cf6BF269079da`. Anyone can trigger a claim, but payment goes only to that recipient. Creator rewards accrue separately to the configured creator recipient. A creator fee of zero produces no creator rewards, even when platform revenue accrues.

This model covers the supported Native20 paths for separate contracts and a shared token/hook contract. An API profile's fee requirement does not retroactively change another deployment's fee contract.

## Module Mode

Coin creators choose the supported creator fee, up to **10%**. That fee belongs to the coin creator. Platform and module author charges are additional, and any declared module operating budget is separate from trading fees.

The Module Mode allocation policy is **10 bps (0.10%) for Programmable and 20 bps (0.20%) in total for the authors of eligible modules used by the coin**. For a launch using modules, this is 30 bps (0.30%) in addition to the coin creator's fee. The author allocation is shared among the eligible module families; it is not 20 bps per module. A module earns through qualifying use, not merely by being submitted or listed.

### Contract versions

Fee rates are bound to the deployed engine. The `module-native-v1` engine charges 20 bps in total: with eligible module families, 10 bps goes to Programmable and 10 bps is shared equally among those families. Without eligible families, the full 20 bps goes to the protocol recipient. Its creator fee supports 0% through 10% in one-percentage-point steps.

The 10/20 allocation policy requires a different engine release; it does not alter `module-native-v1` or the fees of its existing coins. Check the [active engine](https://programmable.market/api/module-mode), the launch review and the deployed fee contract for the rate that a particular coin charges. Module author rewards, coin creator rewards and Programmable revenue must remain separate balances.

## Protocol revenue allocation

Programmable's revenue policy allocates **50% of net protocol revenue to V4 buybacks and burns** and **50% to the treasury**, with daily processing. Net protocol revenue is the share belonging to Programmable after creator, module author and other third-party liabilities have been separated.

For Native20 Custom Launches, half of the 20 bps platform share is equivalent to 10 bps of the qualifying trading amount. Under the Module Mode 10 bps platform allocation, half is equivalent to 5 bps. Module author and coin creator rewards are not part of this allocation.

The allocation policy describes how revenue is assigned. Finalized claim, purchase and burn transactions establish what has actually been processed. A daily accounting schedule does not imply that every accrued amount has already been claimed or that a transaction occurs at an exact clock time. Earlier deployments and revenue processors retain their own contract rules.

## V4 liquidity fees and burns

Programmable's main V4/ETH pool has a separate LP fee. The project's liquidity position earns its proportional share in the input asset: ETH on buys and V4 on sells. The policy assigns collected V4 fees to daily burns. These token fees are separate from the ETH protocol revenue used to buy V4.

Read [V4 token](v4-token.md) for the contract identity, liquidity custody and the meaning of a burn for this token.

## Analytics

The [Dune dashboard](https://dune.com/programmablehq/analytics) reports burns, Module Mode activity and Custom Launch activity. Custom Launch statistics distinguish the following:

| Metric | Accounting |
| --- | --- |
| Custom Launches | Finalized stamps from the canonical Custom V1 and V2 Routers, including reference launches. |
| Custom Creator Rewards | ETH accrued to creators by `NativeFeesAccrued` for a stamped hook and its exact pool. |
| Custom Protocol Revenue | ETH accrued to Programmable by those events, including unclaimed balances. |

Revenue is counted when earned. Claiming it later does not create new revenue. Gas, liquidity deposits, donations and LP fees are excluded from Custom protocol revenue. Historical fee models without the supported event are outside those ETH totals. The dashboard refreshes every 24 hours; the [Custom query](https://dune.com/queries/8631499) includes its finalized checkpoint and accounting rules.

## Ethereum fee models

Ethereum Classic includes a 10 bps (0.10%) Programmable share in the creator-selected buy or sell fee. Ethereum Custom uses the fee policy attached to its exact profile and market path; fee-certified paths assign 10 bps separately from project hook fees. These historical and chain-specific contracts do not inherit Robinhood Native20 or Module Mode rates. Ordinary token transfers do not become pool swaps merely because a token has a trading fee.
