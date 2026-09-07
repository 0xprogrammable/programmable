---
description: The Programmable token, its trading fees and how buybacks and burns work
---

# V4 token

V4 is Programmable's token on Robinhood Chain. It has a fixed supply of one billion tokens, and no more can be minted. Use the contract address below to identify the token.

| Detail | Value |
| --- | --- |
| Name and symbol | Programmable, V4 |
| Network | Robinhood Chain Mainnet, chain ID `4663` |
| Contract | [`0xC60bA256B44334A0Cd2C7242E98B88f031abB006`](https://robinhoodchain.blockscout.com/token/0xC60bA256B44334A0Cd2C7242E98B88f031abB006) |
| Initial supply | 1,000,000,000 V4 |
| Pool | [V4 / ETH](https://dexscreener.com/robinhood/0x3df16f271060e4941c0386047def159f42e629dc0455db623c5b363eeacbcc1d) |
| Source code | [V4 token repository](https://github.com/programmablehq/programmable-v4-token) |
| Burns and activity | [Programmable on Dune](https://dune.com/programmablehq/analytics) |

## Liquidity and fees

The V4/ETH pool charges a **1% trading fee**. Liquidity providers share these fees according to the liquidity they provide. Sending V4 between wallets does not incur this pool fee.

Programmable's liquidity is held in a [locked position](https://robinhoodchain.blockscout.com/address/0x9f9424BbCCe8a865f70155fe40Fb22A103eBEc63), identified by NFT `1708785`. We can collect the fees it earns while the liquidity stays locked.

When someone buys V4 with ETH, our position earns ETH fees. When someone sells V4, it earns V4 tokens as fees. Other liquidity providers receive their own shares.

## Buybacks and burns

We use **50% of Programmable's platform fee revenue to buy V4 and burn it each day**. The other **50% stays in the treasury**. This includes our fees from Custom Launches and Module Mode. Creator fees and module author rewards belong to their recipients and are not used for these buybacks.

We also burn the V4 tokens collected from our liquidity fees each day. More trading in the main pool can generate more tokens to burn. [Fees and revenue](economics.md) explains how much each launch model charges and who receives it.

Burning sends V4 to the address `0x000000000000000000000000000000000000dEaD`, removing those tokens from circulation. The token's reported total supply stays at one billion; burned tokens are counted separately.

You can track burns and the transactions behind them on our [Dune dashboard](https://dune.com/programmablehq/analytics), which refreshes every 24 hours.

## Holding V4

V4 does not give holders company ownership or a right to receive platform revenue. Buybacks and burns do not guarantee a higher price or a return. The Robinhood V4 token is separate from Programmable's earlier Ethereum tokens.
