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

The launch review shows creator fees, protocol fees and any module charges separately. The native ETH engine uses an additive 0.20% protocol fee. With eligible module families, half of that protocol fee is shared equally among those families. Without eligible families, the protocol receives the full fee. Creator fees and module operating budgets are separate.

Contributor rewards come from qualifying fees after a module is admitted and used. A submission or review acceptance alone does not create a payout. The author and reward wallet are recorded with the module revision.

## Build a module

You can build a module yourself or with an AI agent. Submit the source, configuration, management interface and required evidence through the API. The review checks its implementation and compatibility before a version can enter the public catalog.

Read [Build a module](https://programmable.market/developer-reference/module-mode) for the contribution workflow and [Index Module Mode launches](https://programmable.market/developer-reference/module-mode-indexing) for integration rules. The catalog is read from the service; documentation does not maintain a separate list of modules.
