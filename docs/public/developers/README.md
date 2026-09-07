---
description: Find the launch, module contribution and indexing API for your project
---

# Developer reference

Choose the interface for the task you want to complete.

| Task | Guide |
| --- | --- |
| Launch your own token and hook | [Launch through the API](custom-launch-quickstart.md) |
| Read exact Custom Launch fields and limits | [Custom Launch API](custom-launch.md) |
| Build and submit a reusable module | [Module contribution](module-mode.md) |
| Index Module Mode coins | [Module Mode indexing](module-mode-indexing.md) |
| Index Custom Launches on Robinhood | [Robinhood terminal integration](robinhood-terminal-indexer.md) |
| Read schemas and service discovery | [API reference](machine-readable.md) |

## Custom Launch APIs

Use `https://api.programmable.market` for authenticated Custom Launch requests. Robinhood Chain uses chain ID `4663`; Ethereum Mainnet uses chain ID `1`.

On Robinhood, separate token and hook contracts use V4. A token and hook in one contract use [MultiRole V2](https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/guide.md). MultiRole recognizes the exact Native20 reference contracts and supported constructor configuration. Other source or economic behavior can require additional verification, identified by `evidence_required`.

Read [live discovery](https://programmable.market/.well-known/programmable.json) before choosing a client. For V4, require `publicWrites`, `publicAuthorization` and `releaseReady` in both the V4 and chain entries. For MultiRole, read its complete context and readiness. Download and verify the immutable client release advertised for the selected API.

Robinhood Native20 charges **20 bps (0.20%)** of gross native ETH per successful buy or sell for Programmable. Creator fees and pool fees are additional. [Fees and revenue](../economics.md) explains the calculation, recipients and daily Dune statistics.

## API keys and wallet signing

Create or reuse a suitable key in the [API-key manager](https://programmable.market/developers/api-keys). Launch creation and preflight need `custom-launch:create`; status and wallet-handoff reads need `custom-launch:read`. The key also needs the intended chain grant and controller binding.

Store the secret as `PROGRAMMABLE_API_KEY`. The key and CLI never sign or broadcast. The controller reviews and signs the exact transaction in a wallet after the API authorizes it.

Integrations using a partner root or subkey follow `customLaunchApi.partnerCredentials` in discovery. A partner root can read every launch attributed to its partner; a subkey reads its stable lineage. Rotation preserves that lineage's history and does not add scopes, chain grants or wallet authority.

## Track a V4 launch

Use the returned `resource.launchId` as `LAUNCH_ID`, not the support `requestId`:

```sh
programmable-launch status LAUNCH_ID --api-version 4 --chain-id 4663 --watch --until authorized
```

Review, sign and send the authorized wallet transaction, then use the same command with `--until finalized`. For MultiRole, use its client's status commands and the returned `statusUrl`.

V4 states are `received`, `validating`, `action_required`, `authorized`, `awaiting_wallet_signature`, `wallet_action_required`, `submitted`, `sequencer_soft_confirmed`, `ethereum_posted`, `finalized` and `failed`. `action_required` is remediation, not a wallet action. Source verification starts after finality; indexing and trading support are separate results.

## Read public deployment data

The Developer API at `https://developers.programmable.family` is read only and requires no API key. Its [manifest](https://developers.programmable.family/api/v2/manifest) describes the supported Ethereum launch sources, addresses, ABI and finality policy. Its [launch feed](https://developers.programmable.family/api/v2/launches) publishes normalized records.

Use the [indexing guide](indexing.md) to choose the canonical source for each chain and launch model. Module Mode and Custom Launches have separate source contracts. Optional charts and prices do not determine whether a verified launch exists.

## Version compatibility

API profile versions and client package versions identify different things. Read the matching pair from discovery. Historical V4 `4.0.0` requests retain their original schema; profile `4.1.0` defines its own funding and initial-buy requirements. Ethereum V3 uses its own client, including the immutable `3.3.9` release, and must not be used to submit a Robinhood request.

Ethereum V1 and V2 preserve existing reads. New submissions return `CUSTOM_LAUNCH_V1_READ_ONLY` or `CUSTOM_LAUNCH_V2_READ_ONLY`. Use the advertised Ethereum V3 contract for new requests. The [complete reference](custom-launch.md) documents the retained versions and error codes.
