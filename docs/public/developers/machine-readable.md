---
description: Module interfaces, launch API contracts and release discovery
---

# API reference

## Module Mode

Read [agent discovery](https://programmable.market/api/agent) for the current contribution workflow and CLI manifest. The [module API guide](https://programmable.market/developers/module-mode-api-v1.md) defines submission and review. The [indexer JSON contract](https://programmable.market/api/module-mode/indexer/v1) publishes the native source ABI and identity rules; the [indexing guide](module-mode-indexing.md) explains the verification procedure. Read the current release from [Module Mode availability](https://programmable.market/api/module-mode).

## Custom Launches and Ethereum reads

The Developer API version 2 at `https://developers.programmable.family` is read only, requires no API key and publishes stable discovery, manifest, launch and compatibility responses. At `https://api.programmable.market`, V3.3 general-hook creation and lifecycle reads accept wallet keys, partner roots and bounded partner subkeys on Ethereum Mainnet. Public `GET /v3/capabilities` advertises the additive structural boundary; Bearer-authenticated `POST /v3/custom-launches/preflight` evaluates the exact create bytes without consuming launch-creation quota, allocating a nonce or persisting a launch. The authenticated preflight still consumes its ordinary route rate budget, including a partner credential's `prepareRequestsPerHour` budget. V2 and V1 history and schemas remain readable, while fresh POSTs return nonretryable `409 CUSTOM_LAUNCH_V2_READ_ONLY` and `409 CUSTOM_LAUNCH_V1_READ_ONLY`; only V3.3 accepts new submissions. Start at [`/.well-known/programmable.json`](https://programmable.market/.well-known/programmable.json), read `customLaunchApi.partnerCredentials`, follow `customLaunchApi.agentIntegration`, and fetch the [versioned agent remediation catalog](https://programmable.market/policies/custom-launch-agent-remediation-v1.json) before inspecting an existing project. Validate `programmable-launch.config.json` against the advertised [pack-config schema](https://programmable.market/schemas/custom-launch/v3/pack-config.json). Then use the [Custom Launch API guide](custom-launch.md) and [public V3 OpenAPI contract](https://programmable.market/openapi/custom-launch-v3.json) for the normative production request, lifecycle, partner-lineage history and wallet handoff contract. A partner root aggregates all partner-attributed launches; each subkey sees only its stable lineage, rotation preserves that lineage history, and the Router V1 permit-reissue disposition route is wallet-key-only. CLI and preflight checks are preparation; the API server independently enforces objective static hard blocks and exact Router simulation. Missing behavior execution leaves behavior-derived claims unverified, while an authenticated executed failure blocks wallet handoff. No API key can sign, broadcast or bypass launch gates. The [V2 OpenAPI contract](https://programmable.market/openapi/custom-launch-v2.json) and [V1 OpenAPI contract](https://programmable.market/openapi/custom-launch-v1.json) preserve historical reads and schemas plus their write fences. The [raw agent guide](https://programmable.market/developers/custom-launch-api-v1.md) is executable by agents and scripts.

The public-read OpenAPI below describes the Developer API. The standalone V3 Custom Launch API contract defines capabilities, side-effect-free preflight, authenticated public creation, reads and separate wallet handoff for project-owned tokens, hooks and exact multi-contract graphs. It keeps deployment, trading, platform-fee evidence, source verification, indexing and featured state independent and makes no universal or safety claim. A 10 bps claim applies only to a fee-certified profile or adapter and its exact stamped PoolKey; arbitrary custom hooks are not automatically fee-enforced. The V2 and V1 contracts preserve historical reads and schemas with explicit `409 CUSTOM_LAUNCH_V2_READ_ONLY` and `409 CUSTOM_LAUNCH_V1_READ_ONLY` fresh-write fences.

Robinhood Chain Mainnet uses V4 at `eip155:4663`. CLI `3.3.9` remains the live Ethereum V3 integration. Read the V4 and chain 4663 entries in [live discovery](https://programmable.market/.well-known/programmable.json); require all three public gates and verify the advertised immutable CLI release, source commit, manifest and checksum. Stop while `pending-public-discovery-promotion`, `publicWrites: false`, `publicAuthorization: false` or `releaseReady: false` is reported. A deployed runtime or source candidate is not activation evidence.

The [4.0 OpenAPI](https://programmable.market/openapi/custom-launch-v4.json), [pack config](https://programmable.market/schemas/custom-launch/v4/pack-config.json) and [source verification](https://programmable.market/schemas/custom-launch/v4/source-verification-status.json) preserve historical `4.0.0`. When discovery selects `4.1.0`, use its [OpenAPI](https://programmable.market/openapi/custom-launch-v4.1.json), [pack config](https://programmable.market/schemas/custom-launch/v4.1/pack-config.json) and [source verification](https://programmable.market/schemas/custom-launch/v4.1/source-verification-status.json).

Selected 4.1 requires a request-bound funding plan, exact launch and gas budgets, an atomic initial buy of at least USD 1 at permit authorization, positive minimum token output and a fresh server quote. Gas is additional; count the buy once. Its exact fee kernel accrues 20 bps of the gross native ETH leg once per successful swap, separately from creator and LP fees, as fixed-recipient PoolManager native claims; admission is not collected-revenue proof. Read the [current generated agent guide](https://programmable.market/docs/developers.md) for the exact funding, quote and fee boundary.

A V4 client must poll with `programmable-launch status REQUEST_UUID --api-version 4 --chain-id 4663 --watch --until authorized`, stop for separate wallet review, signature and broadcast, then poll the same command with `--until finalized`. The CLI never signs or broadcasts. The V4 states are `received`, `validating`, `action_required`, `authorized`, `awaiting_wallet_signature`, `wallet_action_required`, `submitted`, `sequencer_soft_confirmed`, `ethereum_posted`, `finalized` and `failed`. `action_required` is remediation, not a wallet action. Source verification starts after finality and stays independent from indexing, trading and publication.

## Shared token and hook on Robinhood

Use the separate [MultiRole V2 capabilities](https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/capabilities), [guide](https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/guide.md) and [client](https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/client.mjs) for one contract that implements both token and hook. Its request, funding and lifecycle contract is separate from V4 4.1. The automatic economic verifier accepts the exact Native20 recipe and supported constructor configuration; different source code or economic mechanisms return `evidence_required`. Preflight/create uses `custom-launch:create`; status/list uses `custom-launch:read`, bound to chain `4663` and the controller.

Native20 charges 20 bps (0.20%) of gross native ETH per successful buy or sell for Programmable, rounded up per trade. Creator and pool fees are additional. The [fees guide](../economics.md) defines accruals, claims and the [Dune dashboard](https://dune.com/programmablehq/analytics) metrics. Track the [MultiRole finalized feed](https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/finalized) separately from the existing V4 feed.

## Service status

{% openapi src="../.gitbook/assets/programmable-v2.yaml" path="/api/v2/status" method="get" %}
[programmable-v2.yaml](../.gitbook/assets/programmable-v2.yaml)
{% endopenapi %}

## Deployment manifest

{% openapi src="../.gitbook/assets/programmable-v2.yaml" path="/api/v2/manifest" method="get" %}
[programmable-v2.yaml](../.gitbook/assets/programmable-v2.yaml)
{% endopenapi %}

## Launches

{% openapi src="../.gitbook/assets/programmable-v2.yaml" path="/api/v2/launches" method="get" %}
[programmable-v2.yaml](../.gitbook/assets/programmable-v2.yaml)
{% endopenapi %}

## Token list

{% openapi src="../.gitbook/assets/programmable-v2.yaml" path="/api/v2/token-list" method="get" %}
[programmable-v2.yaml](../.gitbook/assets/programmable-v2.yaml)
{% endopenapi %}

The canonical OpenAPI source is maintained in the [Developers repository](https://github.com/programmablehq/Developers/blob/main/openapi/programmable-v2.yaml). This copy is included so GitBook can render the interactive reference together with the official product documentation.
