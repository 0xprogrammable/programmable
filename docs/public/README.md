---
description: Coin launches, reusable modules and custom applications on Uniswap v4
cover: .gitbook/assets/programmable-warm-night-v3.gif
coverY: 0
---

# Programmable

Programmable is a platform for launching coins and applications on Uniswap v4. Creators configure a coin with reusable modules or build a project with its own contracts. The platform prepares the launch, records its onchain origin and publishes the information that wallets, explorers and trading applications need to identify it.

The purpose is to make token behavior part of the product. A coin can have rules for fees, access, accounting or other activity through the contracts connected to its market. Those rules belong to the deployed code and continue to apply when someone uses another compatible interface.

## Choose a launch path

| Launch path | Use it for |
| --- | --- |
| [Module Mode](models/module-mode.md) | A coin with a bonding curve, creator fees and optional modules selected in the builder. |
| [Custom Launch](models/custom.md) | A token, hook or application with its own source code and deployment structure, submitted through the API. |
| [Classic on Ethereum](models/classic.md) | The fixed supply Ethereum model with configurable buy and sell fees. |

Open [Create](https://programmable.market/launch) to start a launch, or [Explore](https://programmable.market/explore/robinhood) to view indexed coins. The [launch guide](creators/launch.md) explains configuration, funding and wallet confirmation.

## Creators, module authors and the protocol

Coin creators choose the settings and creator fees supported by their launch path. Module authors publish reusable behavior that other creators can select and earn rewards when their eligible modules are used. Custom developers control their project's code within the selected API's contract and evidence requirements.

Programmable receives the platform share of trading fees. Its revenue policy allocates half of net protocol revenue to V4 buybacks and burns. [Fees and revenue](economics.md) explains each fee model and the distinction between protocol revenue, creator rewards and module author rewards. The [V4 token page](v4-token.md) covers the main token, its liquidity fees and burn accounting.

## Build and integrate

Start with [Developers](developers/README.md) for the Custom Launch API, module contribution workflow and indexing guides. Each interface publishes its supported versions, deployment data and machine-readable contract. An API key grants access to launch preparation; the controller wallet signs the transaction.

Integrators identify a coin by its chain and contract address, then verify the relevant launch source. Module Mode and Custom Launches use different source interfaces. [Index launches](developers/indexing.md) explains how to ingest both without maintaining a list of coin names or module names.

## Community and public records

Follow [Programmable on X](https://x.com/ProgrammableHQ), join [Discord](https://discord.com/invite/programmable), read the source on [GitHub](https://github.com/programmablehq), and track launches, earned fees and burns on [Dune](https://dune.com/programmablehq/analytics). The [official links](reference/official-links.md) page collects the product and developer entry points.
