---
description: Module contribution, launch APIs and indexing reference
---

# Developer reference

## Module Mode

Module Mode has a contribution API and a native launch source on Robinhood Chain. Use the [contribution guide](module-mode.md) to build and submit a reusable module, and [Module Mode indexing](module-mode-indexing.md) to identify coins regardless of their selected modules. The [agent entry](https://programmable.market/api/agent) links to current capabilities and tools.

## Custom Launches and Ethereum reads

Programmable has two separate developer surfaces. The Developer API at `https://developers.programmable.family` is read only, requires no API key and never authorizes a transaction. At `https://api.programmable.market`, authenticated public V3.3 general-hook creation and lifecycle reads accept wallet keys, partner roots and bounded partner subkeys. V2 and V1 history and schemas remain readable, while fresh POSTs return non-retryable `409 CUSTOM_LAUNCH_V2_READ_ONLY` and `409 CUSTOM_LAUNCH_V1_READ_ONLY`; only V3.3 accepts new submissions. CLI and preflight checks prepare and classify exact bytes, while the API server independently enforces objective static hard blocks and exact Router simulation. Missing behavior execution leaves routability, liquidity and fee claims unverified; an authenticated executed failure blocks wallet handoff.

Robinhood Chain Mainnet (`eip155:4663`) uses V4. Require `publicWrites: true`, `publicAuthorization: true` and
`releaseReady: true` in both the V4 and chain 4663 entries of live discovery before authenticated preflight or
submission. Stop if a gate is false or missing. Verify the exact immutable CLI release version and evidence linked by discovery; historical `4.0.0` and successor `4.1.0` are separate contracts.
The historical 4.0 request contract is published through the
[V4 OpenAPI](https://programmable.market/openapi/custom-launch-v4.json) and
[pack-config schema](https://programmable.market/schemas/custom-launch/v4/pack-config.json). When discovery selects
4.1, use its [OpenAPI](https://programmable.market/openapi/custom-launch-v4.1.json) and
[pack-config schema](https://programmable.market/schemas/custom-launch/v4.1/pack-config.json). Authenticate using only
`$PROGRAMMABLE_API_KEY`. The server selects the chain-bound policy profile; clients cannot select or bypass it.
External contract references gain trust only from protected server evidence binding their exact `eip155:4663`
address, runtime hash, source-verification evidence, declared role and checkpoint. Arbitrary or unbound references do
not gain trust. External indexing availability is not guaranteed.
The foundation source closure is pinned to
`0xe87f5edc2dc839bd87a26a80cb53f14b021e603a1753d27aae3a02862058d730`, which is source identity rather than
deployment evidence. Sourcify v2 provider-native `match` is required; exact source authority comes from the separate protected-build/finalized-bytecode binding. Robinhood Blockscout remains optional, unproven and
degraded; it cannot support an exact-source claim or block or revise finality.

CLI `3.3.9` remains the installable release for live Ethereum V3. Use one platform API key for its granted chains;
Robinhood V4 uses the exact CLI version advertised by live discovery after its public gates and immutable-release checks pass. When selected, 4.1 requires the [4.1 schemas](https://programmable.market/schemas/custom-launch/v4.1/pack-config.json), a funding plan and an atomic initial buy of at least USD 1; follow the [active agent guide](https://programmable.market/docs/developers.md). Guard V4 status reads with
`programmable-launch status REQUEST_UUID --api-version 4 --chain-id 4663 --watch --until authorized`, stop for the
controller to review, sign and broadcast the exact transaction, then poll the same command with `--until finalized`.
The CLI never signs or broadcasts. V4 resources use `received`, `validating`, `action_required`, `authorized`,
`awaiting_wallet_signature`, `wallet_action_required`, `submitted`, `sequencer_soft_confirmed`, `ethereum_posted`,
`finalized` and `failed`. `action_required` is server-authored remediation, not a wallet action. Source verification
starts after finality and remains independent from Programmable indexing, third-party indexing, trading readiness and
publication.

## Package locally and read existing launches

Start at [Programmable discovery](https://programmable.market/.well-known/programmable.json), read
`customLaunchApi.partnerCredentials`, follow `customLaunchApi.agentIntegration`, and fetch the advertised [agent remediation
catalog](https://programmable.market/policies/custom-launch-agent-remediation-v1.json). Then use the [Custom Launch API
guide](custom-launch.md) and [pack-config schema](https://programmable.market/schemas/custom-launch/v3/pack-config.json).
Install the pinned public `programmable-launch` 3.3.9 CLI to
pack, validate, submit and track V3 requests, and manage a key at [Custom Launch API
keys](https://programmable.market/developers/api-keys). Live discovery and capabilities are the production activation
authority. CLI `3.3.9` is the current installable release and defaults to the live direct-native revision 3 profile
with `profileVersion: 3.3.0`. The [source-tree V3 OpenAPI](https://programmable.market/openapi/custom-launch-v3.json)
also describes explicit preparatory profile `3.4.0` output, which live capabilities reject until backend activation.
The live profile binds canonical project name, symbol, meaningful
description, an exact non-empty source-bound image, one website, one X profile and optional additional links into the
launch hashes. Exact `3.2.0`, `3.1.0` and `3.0.0` requests remain readable and
byte-identical retryable under their original immutable policies, and revision 2 remains compatible. Profile `3.2.0`
keeps its original nullable-image metadata semantics. The [V2
contract](https://programmable.market/openapi/custom-launch-v2.json) remains available for existing V2 resources and
schemas, with fresh POST returning nonretryable `409 CUSTOM_LAUNCH_V2_READ_ONLY`. V1 fresh POST returns nonretryable
`409 CUSTOM_LAUNCH_V1_READ_ONLY`. Legacy Registry and GitHub submission intake is closed.
V2 detail reads are observation-only for `prepared` or `simulating` resources: GET cannot advance simulation or
authorization or expose a new wallet transaction. Existing authorized and submitted reconciliation and finalized reads remain.

Keep the selected credential only as `PROGRAMMABLE_API_KEY` in an encrypted secret store. Wallet keys, partner roots and bounded partner subkeys use the same canonical V3 create, preflight, list and status routes within their scopes; the Router V1 permit-reissue disposition route is wallet-key-only. A wallet key's `launchWallet` is its wallet binding. A partner credential may select the exact controller wallet, but that controller still reviews, signs and broadcasts and the partner credential receives no wallet authority. All credential kinds use the same current-profile metadata policy. A partner root alone may manage one level of subkeys, whose scopes, budgets and expiry cannot exceed the root. The root reads all launches attributed to its partner; a subkey reads only its stable lineage, and rotation preserves that lineage history. No credential can sign, broadcast or bypass launch gates. A `prepared` response contains an exact artifact but no wallet transaction; only `authorized` contains the exact Router transaction for separate controller-wallet review and signing. In EIP-3009 funding mode, `awaiting_funding_authorization` first exposes exact typed data for an explicit website wallet signature. Native-value mode instead carries the exact ETH value on the Router transaction and requires no separate funding signature. Neither signing action is automatic.

Revision 3 pins exact `solc 0.8.26+commit.8a97fa7a` Standard JSON, with a 5,242,880-byte limit per unit and in
aggregate and no more than 2,048 inline sources. Its role-aware exact-source static admission binds every finding to the
request. Exactly seven objective code-and-role rules hard-block profile 3.3.0; proxy/delegatecall, mint/tax/pause,
liquidity and return-delta surfaces remain evidence duties. A hard-block match returns `action_required`; all other
findings remain visible needs-evidence or warning conditions. No manual project allowlist exists. The API server must
enforce objective static hard blocks and exact Router simulation before wallet handoff. Local checks and preflight are
preparation, not the server decision. The exact Router simulation is not an audit or a guarantee of safety, honeypot
resistance, liquidity, tradeability or fee behavior. A 10 bps claim exists only for a fee-certified profile or adapter
and its exact stamped PoolKey; arbitrary custom hooks are not automatically fee-enforced.

## Start with discovery

The well known document and manifest are the stable entry points. The manifest is the deployment authority for Router addresses, runtime hashes, ABI hashes, event descriptors, getters, start block and finality policy.

```bash
curl -fsSL https://developers.programmable.family/.well-known/programmable.json
curl -fsSL https://developers.programmable.family/api/v2/status
curl -fsSL https://developers.programmable.family/api/v2/manifest
```

Do not copy a Router address or event topic from token metadata, an old screenshot or a third party API. Resolve it from the current manifest and verify the returned deployment record before decoding events.

## Read normalized launches

The launch feed combines current and historical Classic records with Registry-verified Custom records. Consumers should finish cursor traversal, deduplicate by launch id and preserve unknown launch shapes even when their own application cannot chart, quote or execute them.

```bash
curl -fsSL https://developers.programmable.family/api/v2/launches
curl -fsSL https://developers.programmable.family/api/v2/token-list
```

The hosted API is optional for Router verification. An integration can reproduce provenance directly from Ethereum using the manifest, ABI and canonical Router getters.

Protocol fee claim discovery is a separate execution index. The claim console
uses complete Classic Launcher and Custom Registry scans plus the fixed Stock
release set; see [Index Programmable launches](indexing.md#index-protocol-fee-claims-separately)
for the exact completeness and fail-closed rules.

{% content-ref url="custom-launch.md" %}
[custom-launch.md](custom-launch.md)
{% endcontent-ref %}

{% content-ref url="verify.md" %}
[verify.md](verify.md)
{% endcontent-ref %}

{% content-ref url="machine-readable.md" %}
[machine-readable.md](machine-readable.md)
{% endcontent-ref %}
