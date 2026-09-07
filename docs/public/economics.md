---
description: Transaction fees, creator rewards and Programmable revenue
---

# Fees and revenue

Costs and fee paths depend on the transaction that actually executes. A launch model alone does not determine them. Each release must state the complete rate, how it is divided and which transactions pay it.

| Path               | Share                                                    | How it works                                                     |
| ------------------ | -------------------------------------------------------- | ---------------------------------------------------------------- |
| Classic            | 0.1% of the gross ETH amount exchanged                   | Included in the selected buy or sell transaction fee             |
| Ethereum Custom (fee-certified) | 10 bps (0.10%) on the certified market path | Additional to project hook fees |
| Robinhood Custom (Native20) | 20 bps (0.20%) of the gross native ETH amount per successful buy or sell | The full 20 bps belongs to Programmable; creator and pool fees are additional |
| Public template    | Intended 0.1% share inside a 0.2% total transaction fee  | Not active while public template intake remains closed           |

In these docs, transaction fee means the percentage charged when a token is bought or sold. It is separate from network gas and from the Uniswap pool fee. The active contract and release determine the exact rate and recipient.

## Classic rewards

Classic creators select buy and sell transaction fees from 1% through 10%. Programmable receives 0.1% of the gross ETH amount exchanged. That share is already included in the selected rate, while the remainder accrues as creator rewards. An ordinary wallet transfer does not pay this transaction fee.

## Custom releases

On Robinhood Chain, the Native20 fee kernel charges **20 bps (0.20%)** of the gross native ETH amount once per successful buy or sell, rounded up to the next wei. This is the Programmable fee. A project's creator fee and the Uniswap pool fee are separate, so 20 bps is not an all-in maximum. For example, a 1 ETH gross trade credits 0.002 ETH to Programmable before any separate creator fee.

The kernel credits PoolManager native claims for the fixed platform recipient `0xD88539d3c4C460136a733A3Fd60cf6BF269079da`. Anyone can trigger a claim, but the payment goes only to that recipient. Creator balances accrue separately. This applies to the Native20 paths for separate contracts and a shared token/hook; historical deployments retain their own fee contracts.

Ethereum Custom uses its own fee policy: a fee-certified profile or adapter assigns 10 bps (0.10%) on its exact stamped market path to Programmable. The open arbitrary-hook path has no automatic platform-fee claim. Follow the selected chain's [Custom Launch API guide](developers/custom-launch.md) and public capabilities for its supported contract.

## Custom Launch statistics

The [Dune dashboard](https://dune.com/programmablehq/analytics) separates three Robinhood metrics:

| Metric | Definition |
| --- | --- |
| Custom Launches | Finalized launch stamps from the canonical V1 and V2 Custom Launch routers, including reference launches. |
| Custom Creator Rewards | ETH credited to creators by `NativeFeesAccrued` events for a stamped hook and its exact pool. |
| Custom Protocol Revenue | ETH credited to Programmable by those events, including unclaimed balances. |

Fees are counted when earned. A later claim does not create new revenue. Gas, liquidity deposits, donations and pool LP fees are excluded. Historical fee models without the supported event are outside the ETH totals. The query combines Dune history with a recent finalized RPC overlap and deduplicates events. The dashboard refreshes daily; each query result includes its finalized checkpoint. [Query and accounting rules](https://dune.com/queries/8631499).

## Protocol revenue

The public allocation policy assigns 80% of attributable net Programmable protocol revenue to V4 purchases and 20% to the treasury. Attributable net revenue means the amount that belongs to Programmable after creator and partner liabilities are separated.

{% hint style="warning" %}
The policy and an executed revenue cycle are different facts. The current V2 processor documented in the product source uses a 49.5% V4 purchase share, a 50% treasury share and a 0.5% keeper share until an exact activation record binds the 80/20 processor. These docs do not present the newer split as executed before that evidence exists.
{% endhint %}

Revenue processing applies only to supported sources and can wait for finality, provider agreement, minimum balances and safety checks. A policy does not promise a transaction at the same clock time every day, token value or holder yield.
