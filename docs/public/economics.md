---
description: What we charge, who receives the fees and how we use our revenue
---

# Fees and revenue

Programmable earns a share of trading fees. Coin creators and module authors receive their own shares. We use half of our platform fee revenue to buy and burn V4, and keep the other half in the Programmable treasury.

Fees are shown as percentages or basis points (bps): **10 bps is 0.10%, and 20 bps is 0.20%**. Gas, liquidity deposits and the funds needed to run a module are separate costs. You can see the fee breakdown before confirming a launch.

## Robinhood Custom Launches

Programmable charges **0.20% (20 bps)** on each buy and sell. The coin creator can set a separate fee, which belongs to them. The pool also has its own trading fee.

On a trade worth **1 ETH**, the Programmable fee is **0.002 ETH**. Half of that, **0.001 ETH**, goes to V4 buybacks and burns. The other **0.001 ETH** goes to the treasury. Creator and pool fees are added separately.

If the creator sets their fee to 0%, they earn no creator fees from those trades.

## Module Mode

Coin creators choose their own trading fee, up to **10%**, and keep that fee. Our Module Mode fee policy adds **0.30% (30 bps)**, divided as follows:

| Recipient | Share of each trade |
| --- | --- |
| Programmable | 0.10% (10 bps) |
| Authors of the modules used by the coin | 0.20% (20 bps) in total |

The author share is divided between the eligible module families used by the coin. Adding more modules does not increase the total 0.20% author fee. Authors earn when their modules are used in coins that trade.

For example, under this model, a **1% creator fee** plus the **0.30% platform and author fee** gives a **1.30% combined fee**. Any separate pool fee is additional.

Existing coins keep the fees they launched with. The original Module Mode contract charges 0.20% in total: 0.10% for Programmable and 0.10% for module authors when eligible modules are used. Without eligible modules, that contract sends the full 0.20% to Programmable. Check the launch fee breakdown for the model that applies to your coin.

## How we use our revenue

We split the fees that belong to Programmable equally:

| Use | Share of Programmable revenue |
| --- | --- |
| Buy V4 and burn it | 50% |
| Programmable treasury | 50% |

Buybacks and burns are processed daily. For every **1 ETH** Programmable earns in platform fees, **0.5 ETH** goes to buying and burning V4, and **0.5 ETH** stays in the treasury. Coin creator fees and module author rewards belong to those creators and authors, so they are not included in this split.

## V4 liquidity fees and burns

Programmable also earns fees from its liquidity in the main V4/ETH pool. When someone buys V4, we receive ETH fees. When someone sells V4, we receive V4 tokens as fees. We burn the V4 tokens we collect each day.

These V4 fees are burned directly. We also buy V4 with the platform revenue described above and burn those tokens. The [V4 token page](v4-token.md) explains the token and its liquidity.

## Track the numbers

Our [Dune dashboard](https://dune.com/programmablehq/analytics) shows launches, earned fees and V4 burns. It refreshes every 24 hours.

| Custom Launch metric | What it shows |
| --- | --- |
| Custom Launches | Confirmed launches through Programmable. |
| Custom Creator Rewards | ETH earned by coin creators. |
| Custom Protocol Revenue | ETH earned by Programmable. |

Earned fees include balances that have not yet been withdrawn. Withdrawing them does not count as new revenue. Gas payments and liquidity deposits are not revenue. The [Custom Launch query](https://dune.com/queries/8631499) lists the contracts and transactions included in those totals.

## Ethereum launches

Classic on Ethereum includes Programmable's **0.10%** share within the creator's selected fee. For example, a 1% fee leaves 0.90% for the creator and 0.10% for Programmable. Ethereum Custom fees depend on the contract used; supported fee contracts charge 0.10% for Programmable in addition to project fees. Check the fee details for the coin you are launching or trading.
