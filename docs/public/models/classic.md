---
description: How Classic creates a fixed supply token, locked liquidity and creator rewards on Ethereum
---

# Classic

Classic is the direct public launch model. It creates the token, initializes the ETH pool, locks the complete token supply in a one sided Uniswap v4 position and completes the Initial Buy in one transaction signed by the launch wallet.

## Supply and liquidity

Every Classic token has a fixed supply of one billion tokens with 18 decimals. There is no transfer tax, blacklist, rebase, post launch minting or creator allocation. The launch wallet receives only the tokens it buys during the Initial Buy.

The position is permanently locked and has no liquidity removal path. This describes custody of the original position. It does not promise future liquidity, price stability or support from an external trading service.

## Buy and sell transaction fees

The launch wallet chooses the buy transaction fee and sell transaction fee separately from 1% through 10% in steps of one percentage point. The selected rate already includes the Programmable share of 0.1% of the gross ETH amount exchanged. A 1% buy transaction fee therefore leaves 0.9% for creator rewards and 0.1% for Programmable rather than charging a second fee.

Creator rewards accrue in ETH. They can go to the launch wallet, another wallet or a split between two and five unique wallets. Each beneficiary claims independently, and an update to a payout wallet affects future accrual without moving rewards that have already accrued.

## Initial Buy

The creator chooses an Initial Buy of at least 0.0006 ETH. Purchased tokens can remain unlocked, use a fixed lock, vest linearly or vest after a cliff. Lock and vesting periods can run from one day to 3,650 days and cannot be changed after launch.

## Current Ethereum contracts

| Contract                    | Address                                      |
| --------------------------- | -------------------------------------------- |
| Classic launcher            | `0xC3bd04aAc2fb2ba58efD7Eb673E544E0B80De770` |
| Classic hook                | `0x35Fe236EA82F7cF525c9719d7df8F49F94D720CC` |
| Reward vault factory        | `0xF28967f9DFaC3Ca21384b59D6D75C8106b3eab2a` |
| Initial Buy custody factory | `0xDe21b9c0Cc0AfDB9be20e8236113f066BB8C66f4` |
| Position recipient factory  | `0x291a9ff1059d225d02B1659430804486404dB507` |

The current product repository and its deployment records remain the source for code hashes, roles and release specific evidence. Check the connected wallet, network and complete transaction before signing.

{% content-ref url="../creators/launch.md" %}
[launch.md](../creators/launch.md)
{% endcontent-ref %}
