---
description: The Programmable token on Robinhood Chain, its liquidity fees and burn policy
---

# V4 token

V4 is the Programmable token on Robinhood Chain. Identify it by the network and contract address rather than its name or ticker. The token has a fixed supply of one billion V4 with 18 decimals and no later mint function.

| Field | Value |
| --- | --- |
| Name and symbol | Programmable, V4 |
| Network | Robinhood Chain Mainnet, chain ID `4663` |
| Contract | [`0xC60bA256B44334A0Cd2C7242E98B88f031abB006`](https://robinhoodchain.blockscout.com/token/0xC60bA256B44334A0Cd2C7242E98B88f031abB006) |
| Initial supply | 1,000,000,000 V4 |
| Pool | [V4 / native ETH](https://dexscreener.com/robinhood/0x3df16f271060e4941c0386047def159f42e629dc0455db623c5b363eeacbcc1d) |
| Source | [V4 token repository](https://github.com/programmablehq/programmable-v4-token) |
| Analytics | [Programmable on Dune](https://dune.com/programmablehq/analytics) |

## Liquidity and fees

The canonical pool uses a 1% LP fee after its initial 30-second launch period. This is a pool fee, not a token transfer tax. It accrues to active liquidity positions according to their liquidity share.

Programmable's main liquidity position is NFT `1708785`, held by the [PositionFeesForwarder locker](https://robinhoodchain.blockscout.com/address/0x9f9424BbCCe8a865f70155fe40Fb22A103eBEc63). Its withdrawal lock is set to the maximum `uint256` block number. Fee collection leaves the position in place and forwards proceeds to its fixed recipient, `0x39544A7023081B56D7405c1af0bFaf72da7e24F6`.

When someone buys V4 with ETH, the position earns ETH fees. When someone sells V4 for ETH, it earns V4 fees. Other liquidity providers earn their own shares; the project does not receive every fee paid by every position in the pool.

## Buybacks and burns

The revenue policy allocates half of Programmable's net platform revenue to V4 purchases and burns, with daily processing. This includes the platform share from Custom Launches and Module Mode after creator and module author rewards have been separated. The other half is allocated to the treasury. [Fees and revenue](economics.md) explains the rates and version-specific accounting.

V4 collected from the project's LP fees is also allocated to daily burns. More qualifying trading volume can generate more fee revenue and V4 available to burn, depending on trade direction and the position's liquidity share. Neither volume nor a burn determines a future token price or investor return.

Burns transfer V4 to `0x000000000000000000000000000000000000dEaD`, removing it from circulation. This ERC-20 has no supply-reducing burn function, so these transfers do not lower its onchain `totalSupply`. Report the burn-address balance separately from total supply and avoid counting the same transfer twice.

Use the [Dune dashboard](https://dune.com/programmablehq/analytics) to track recorded burns and the underlying transactions. Its daily refresh reports observed execution, which is separate from a revenue allocation policy or an unclaimed fee balance.

## Token holder rights

Holding V4 does not represent equity in Programmable or a claim on protocol revenue. Buybacks and burns do not guarantee a price, liquidity, distribution to holders or return. Historical Ethereum tokens use different contract addresses and must not be combined with Robinhood V4 balances.
