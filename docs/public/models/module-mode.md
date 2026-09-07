---
description: Launch a coin with a bonding curve and optional, configurable modules
---

# Module Mode

Module Mode creates a coin with a bonding curve. You can launch it with the base settings or add modules that change its behavior. Modules are reusable programs with their own configuration and, when needed, controls on the website.

## Launch a coin

1. Open [Module Mode](https://programmable.market/launch/modules) and connect your wallet.
2. Enter the coin details, optional image and social links, creator fees and initial buy.
3. Open **Modules** to search for optional modules. Select the ones you want and complete their configuration.
4. Check the total fees and funding, select **Launch coin**, then confirm in your wallet.

The builder uses the active release and module catalog. It checks the selected versions, required capabilities, configuration and compatibility. The wallet review shows the network and the actual transaction cost. Gas, the initial buy and any module funding are separate amounts.

An image is optional. If you launch without choosing one, the transaction records the Programmable logo as the token image. A selected image is used instead. Add a website, X or Telegram link directly; **Add more links** opens Discord, GitHub and GitBook fields. These links are stored in the token metadata and displayed on its Explore card and coin page.

After the transaction is confirmed, use **View token** or copy the contract address. Explore and profile discovery follow the verified index.

## Configuration and compatibility

A module declares the fields it needs, their types and units, allowed values, dependencies and required permissions. The website uses those declarations to build the configuration form. A wallet address, duration or amount must have an explicit purpose and format.

Modules can have state, receive a declared operating budget and expose management actions. The host defines which actions are available and which wallet may execute them. The active release determines the supported engine, quote asset and resource limits.

Compatible modules share one launch. Combinations that conflict or exceed the host's limits are rejected before launch. A module that needs a capability outside the current host requires a reviewed extension or a new engine release before it becomes available.

## Manage a launched coin

After indexing, the coin appears in Explore and in the launching wallet's profile. Open the coin's controls to use the actions exposed by its modules. The website checks the connected wallet's role and the action inputs before preparing a transaction.

Each launch records the exact module versions and configuration it used. Publishing another module version does not replace code or settings in an existing coin. Changes to state or recipients follow the permissions of the deployed contracts.

## Fees and contributor rewards

Coin creators can set a trading fee of up to **10%** and keep that fee. Our Module Mode fee policy adds **0.10% (10 bps) for Programmable** and **0.20% (20 bps) in total for module authors**. Authors share that 0.20% when their eligible modules are used by the coin.

Existing coins keep their original fees. Check the launch screen for your coin's fee breakdown and any funds required to run its modules. [Fees and revenue](../economics.md#module-mode) explains the fee models and includes an example.

Module rewards go to the reward wallet registered with the module. Publishing a module alone does not earn fees; it needs to be used by a coin that trades.

## Build a module

You can build a module yourself or with an AI agent. Submit the source, configuration, management interface and required evidence through the API. The review checks its implementation and compatibility before a version can enter the public catalog.

Read [Build a module](https://programmable.market/docs/developers/module-mode) for the contribution workflow and [Index Module Mode launches](https://programmable.market/docs/developers/module-mode-indexing) for integration rules. The catalog is read from the service; documentation does not maintain a separate list of modules.
