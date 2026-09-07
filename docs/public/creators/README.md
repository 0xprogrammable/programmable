---
description: Launch a coin, build a custom project or contribute a reusable module
---

# Create

Start with the launch path that matches your project. Module Mode lets you configure a coin in the website. Custom Launch uses your own source package and an API key. Both lead to a transaction that the launching wallet reviews and signs.

## Configure a coin

Open the [Module Mode builder](https://programmable.market/launch/modules), enter the coin details, choose creator fees and add any compatible modules. The builder explains each module's inputs and shows the total fees and required funding before launch. After indexing, open the coin from Explore or your profile to use its supported management actions.

## Launch custom contracts

Use the [Custom Launch quickstart](../developers/custom-launch-quickstart.md) to choose the correct network and contract layout. Package and validate the exact source, submit it with a wallet-bound API key, then follow the returned status and wallet handoff. Keep the same request identity when retrying unchanged bytes.

## Contribute reusable behavior

Module authors submit a versioned implementation, configuration interface, management actions and evidence. Accepted versions can enter the catalog for other creators to select. Rewards depend on qualifying use and the fee contract attached to each launch. Read [Build a module](../developers/module-mode.md) for the contribution workflow and [Creator earnings](earnings.md) for reward accounting.

The [launch guide](launch.md) explains the complete launch flow. The [Classic reference](../models/classic.md) covers the Ethereum model.
