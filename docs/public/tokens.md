---
description: Compare Programmable launch models and understand how their token, market and fee paths differ
---

# Launch models

Choose Module Mode for a coin with configurable modules, or Custom Launches for a complete project with its own contracts. The release determines the network and supported market. Classic documents the Ethereum launch model.

| Model              | What it creates                                                            | Market                                        | Access                                |
| ------------------ | -------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------- |
| Module Mode | A coin with a bonding curve and configurable modules | Determined by the active engine | [Module Mode](https://programmable.market/launch/modules) |
| Classic            | Fixed supply tokens with configurable buy and sell transaction fees        | ETH on Uniswap v4                             | Open through Create                   |
| Custom             | Tokens or applications that need their own deterministic hook graph         | The pool and route in the authorized transaction | Wallet-bound Custom Launch API       |

## Module Mode

Module Mode provides the base coin, launch identity and runtime. Optional modules declare their configuration and required capabilities. The builder checks compatibility and presents the selected configuration before the wallet transaction.

Read [Module Mode](models/module-mode.md) for the launch and management flow, or [Build a module](developers/module-mode.md) to contribute a program.

## What is a hook

A hook is a smart contract attached to a Uniswap v4 pool. The pool calls it at defined points in a transaction, such as before or after a swap. This lets a product apply behavior at the pool level instead of relying only on a website or a separate trading interface.

The hook's permissions define when it can run, while its code defines what it actually does. A hook can change fees, accounting, access or other pool behavior, but the word hook does not by itself establish safety, compatibility or launch approval.

## Classic

Classic creates a fixed supply of one billion tokens and initializes its ETH pool in one transaction signed by the creator. The full supply enters a permanently locked one sided Uniswap v4 position. Before signing, the creator chooses the buy transaction fee, sell transaction fee, reward destination and Initial Buy custody.

{% content-ref url="models/classic.md" %}
[classic.md](models/classic.md)
{% endcontent-ref %}

## Custom

Custom releases are for products whose behavior cannot be represented by the Classic settings. A hook is code that can change how a Uniswap v4 pool behaves during a transaction. Each Custom request identifies the exact source bundle, graph, permissions, transaction fees, dependencies, transaction construction and controller wallet. Preparation uses a wallet key, partner root or bounded partner subkey; [wallet keys are managed here](https://programmable.market/developers/api-keys). Signing remains with the controller wallet rather than the API credential or a project name.

{% content-ref url="models/custom.md" %}
[custom.md](models/custom.md)
{% endcontent-ref %}
