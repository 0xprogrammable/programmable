---
description: Launch coins, contribute modules and integrate Programmable records
cover: .gitbook/assets/programmable-warm-night-v3.gif
coverY: 0
---

# Programmable

Programmable provides tools to launch coins and applications built with Uniswap v4.

**Module Mode** creates a coin with a bonding curve and optional, configurable modules. **Custom Launches** create a project with its own contracts, hook and execution logic. Each launch path has a versioned interface and deployment record.

## Start here

| Task | Reference |
| --- | --- |
| Launch a coin with optional modules | [Module Mode](models/module-mode.md) |
| Build and submit a reusable module | [Build a module](developers/module-mode.md) |
| Build a complete custom project | [Custom Launch API](developers/custom-launch.md) |
| Integrate Module Mode coins | [Module Mode indexing](developers/module-mode-indexing.md) |
| Integrate Custom Launches on Robinhood | [Custom terminal integration](developers/robinhood-terminal-indexer.md) |
| Read historical Ethereum launch models | [Classic](models/classic.md) |

## Launch and manage

Open [Create](https://programmable.market/launch) to choose a launch path. Review the configuration, fees, initial buy, funding and transaction before confirming with your wallet. After verification and indexing, the coin appears in [Explore](https://programmable.market/explore/robinhood) and the launching wallet's profile. A coin's controls expose the management actions supported by its deployed contracts.

## Developers and agents

Start with the [agent guide](https://programmable.market/agents.md) and [machine-readable discovery](https://programmable.market/api/agent). They link to the current API contracts, capability checks, CLI releases and website actions. Read current deployment addresses and supported versions from discovery rather than copying them from an example.

Module contributions are submitted through the API with an author wallet, reward wallet, exact source package and configuration. The review and publication process is described in the contribution guide. The catalog is maintained by the service and does not require a separate list in these docs.

## Indexing

A coin is identified by its chain and token address. Its launch source provides the evidence that it belongs to Programmable. Module Mode and Custom Launches have different source interfaces and share a common token and pool identity model. Indexing a coin and supporting its trading behavior are separate integration tasks.

Read [Index launches](developers/indexing.md) to select the source and follow its verification, finality and checkpoint rules.

## Official sources

- [Website](https://programmable.market)
- [API](https://api.programmable.market)
- [Public repository](https://github.com/programmablehq/PROGRAMMABLE)
- [Developer reference](developers/README.md)
