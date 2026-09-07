---
description: Choose between a configured coin and a project with its own contracts
---

# Launch models

Programmable offers Module Mode and Custom Launches on Robinhood Chain. Module Mode uses a shared launch engine with configurable modules. Custom Launches accept a project's own source and contract structure. Classic is the fixed supply Ethereum launch model.

| Model | Configuration | Market and execution | Starting point |
| --- | --- | --- | --- |
| Module Mode | Coin details, creator fees and optional reusable modules | Native ETH bonding curve under the selected engine | [Module builder](https://programmable.market/launch/modules) |
| Custom Launch | Your token, hook, dependencies and deployment plan | The market and settlement path supported by the chosen API profile | [API quickstart](developers/custom-launch-quickstart.md) |
| Classic on Ethereum | Fixed supply token with selected buy and sell fees | An ETH pool on Uniswap v4 | [Classic reference](models/classic.md) |

## Module Mode

Module Mode supplies the base coin, bonding curve and launch identity. You choose its settings and any compatible modules. The builder reads the current catalog, validates the configuration and shows the costs before wallet confirmation. Each coin records the module versions it uses; a later catalog update does not silently replace them.

Read [Module Mode](models/module-mode.md) for launching and managing a coin. Developers can use [Build a module](developers/module-mode.md) to contribute reusable behavior.

## Custom Launch

Custom Launch is for projects that need their own contract logic or deployment structure. On Robinhood, separate token and hook contracts use the V4 API. A single contract that acts as both token and hook uses MultiRole V2. Ethereum uses its own V3 integration. The API checks the exact package and returns the transaction for the controller wallet to review.

Supported layouts do not imply support for every possible contract. The selected profile defines the required permissions, fee behavior, source evidence and funding. The [Custom Launch guide](models/custom.md) explains these boundaries, and the [quickstart](developers/custom-launch-quickstart.md) leads through a request.

## How hooks work

A Uniswap v4 hook is a contract that the PoolManager calls at declared points in a pool operation, such as before or after a swap. Its permissions select those callback points; its code defines what happens there. Hooks can implement fee logic, accounting or access rules. Their behavior and trading compatibility depend on the actual contracts and the route that executes them.

## Fees

The launch review separates creator fees, platform fees, module rewards, liquidity funding and network gas. Read [Fees and revenue](economics.md) for the rates and recipients attached to each launch version.
