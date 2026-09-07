---
description: APIs for custom launches, reusable modules and launch discovery
---

# Developers

Use the Custom Launch API to deploy your own token and hook project, the module contribution API to publish reusable behavior, or the public indexing interfaces to integrate launched coins into another product.

| Task | Guide |
| --- | --- |
| Launch through the API | [Custom Launch quickstart](custom-launch-quickstart.md) |
| Read exact fields, versions and error codes | [Custom Launch API reference](custom-launch.md) |
| Build and submit a reusable module | [Module contribution](module-mode.md) |
| Index coins in a terminal, explorer or wallet | [Choose an indexing source](indexing.md) |
| Find schemas, ABIs and client releases | [Machine-readable reference](machine-readable.md) |

## Choose the network and contract layout

Robinhood Chain uses chain ID `4663`. Separate token and hook contracts use V4; a single contract implementing both roles uses MultiRole V2. Ethereum Mainnet uses chain ID `1` and its own V3 integration. Each API defines the accepted package, fee behavior, evidence and wallet handoff.

Resolve the supported profile and immutable client release from [live discovery](https://programmable.market/.well-known/programmable.json). For V4, match the version and chain readiness fields. For MultiRole, read its complete context and economic requirements. The quickstart provides the commands for both layouts.

## API keys and wallet signing

Create a key in the [API-key manager](https://programmable.market/developers/api-keys). Creation and preflight require `custom-launch:create`; status and wallet-handoff reads require `custom-launch:read`. The key also needs the intended chain grant and controller binding. Keep the secret in `PROGRAMMABLE_API_KEY` and out of source control, logs and chat messages.

The API key and CLI never sign or broadcast. The controller reviews and signs the authorized transaction in its wallet. Partner roots and subkeys follow the scope, chain and lineage rules in `customLaunchApi.partnerCredentials`; rotating a key does not add wallet authority.

## Fees and indexing

Robinhood Native20 charges **20 bps (0.20%)** of gross native ETH per successful buy or sell for Programmable. Creator fees and pool fees are additional. [Fees and revenue](../economics.md) explains each model and how rewards and revenue are counted.

Public indexing reads require no launch API key. Module Mode, Custom V4, MultiRole V2 and Ethereum records use their own source verifiers. Use the chain and token address as coin identity, retain valid launches when optional metadata is missing, and keep provenance separate from trading support.
