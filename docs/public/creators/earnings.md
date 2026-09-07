---
description: How creator fees accrue, how they differ from platform fees, and where to read earnings
---

# Creator earnings

Creator earnings come from the fee configuration and activity of a deployed project. Choose the creator recipient and buy and sell rates before launching.

## Robinhood Custom Launches

Native20 charges **20 bps (0.20%)** of gross native ETH per successful buy or sell for Programmable. The full 20 bps belongs to the platform. A project's creator fees are additional and accrue separately to its configured recipient. The Uniswap pool fee is also separate.

If the creator buy and sell rates are both 0%, the creator receives no fee from those trades, while Programmable still receives its 20 bps. This is why a Custom Creator Rewards counter can be zero alongside positive Custom Protocol Revenue.

Fees count as earned when the contract credits them. Claiming transfers an accrued balance to its configured recipient; it does not create another fee. An API key does not sign or broadcast a claim transaction.

The [Dune dashboard](https://dune.com/programmablehq/analytics) shows daily totals from supported `NativeFeesAccrued` events on stamped Robinhood pools. Unclaimed balances are included. LP fees, gas, liquidity deposits and historical fee models without those events are excluded.

## Module Mode

Module Mode accounts for coin creator fees and module author rewards through its own contracts. Read the [Module Mode guide](../models/module-mode.md) for the configured recipients and management interface. Its Dune counters are separate from Custom Launch totals.

## Classic on Ethereum

Classic creator rewards come from the selected buy and sell transaction fees. Programmable's 0.1% share is included in that selected rate. For example, a 1% buy transaction fee assigns 0.9% to creator rewards and 0.1% to Programmable.

Rewards accrue in ETH according to the recipient configuration. A creator can use the launch wallet, another wallet or a split between two and five unique wallets. Each beneficiary claims its allocation. Updating recipients does not move balances already accrued to earlier recipients.

Read [fees and revenue](../economics.md) for the rates and accounting of each launch model. Earnings depend on qualifying transactions, not API preparation or publication of a token page.
