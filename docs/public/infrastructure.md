---
description: From launch configuration to wallet execution, verification and public discovery
---

# How Programmable works

A launch moves through configuration, transaction preparation, wallet execution and public verification. Programmable records these steps separately so a prepared request, a confirmed transaction and an indexed coin have clear meanings.

## Module Mode

The builder reads the active engine and module catalog, validates the selected configuration and prepares the launch transaction. The native launcher creates the coin and records its identity, engine, creator and module configuration. The coin's runtime applies its bonding curve and selected module behavior.

An indexer verifies the canonical launcher events and getters against the published engine release. It does not require a Custom Launch stamp for a Module Mode coin. The [Module Mode indexing guide](developers/module-mode-indexing.md) defines this source contract.

## Custom Launch

The client packages one exact source and deployment plan. The chain-specific API checks the package, permissions, economics and execution evidence required by its profile. A returned wallet handoff binds the transaction to the intended controller, chain and launch. The API key cannot sign for that wallet.

The controller reviews and signs the authorized transaction. The appropriate Launch Stamp Router records the deployed project and its components. Source verification, transaction finality and public indexing each have their own result. The [API quickstart](developers/custom-launch-quickstart.md) explains the sequence and how to recover from a rejected or incomplete request.

## Classic on Ethereum

Classic creates a fixed supply token, initializes its ETH pool, locks the initial liquidity position and completes the initial buy through the selected launcher. The deployed version determines its creator fees, rewards and custody. Read the [Classic reference](models/classic.md) for the exact model.

## Public discovery

The website publishes verified launch identities and adds market data when available. A coin is identified by its chain and token address. Its source record explains which launcher or Router created it and which version-specific verifier applies.

Price, liquidity, chart data and trading support are separate from launch identity. A missing chart does not remove a valid launch. A launch stamp does not prove that another trading application supports the hook. [Index launches](developers/indexing.md) describes the common ingestion rules and links to each source.
