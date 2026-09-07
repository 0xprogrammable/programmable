---
description: Check current Programmable website, launch feed and developer service status
---

# Service status

The current public status is available from the website and the read only developer service. These endpoints separate service availability from data freshness so an HTTP 200 response is not mistaken for a current index.

| Resource            | URL                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| Product             | [programmable.market](https://programmable.market)                                                       |
| Explore             | [programmable.market/explore](https://programmable.market/explore)                                       |
| Developer status    | [developers.programmable.family/api/v2/status](https://developers.programmable.family/api/v2/status)     |
| Deployment manifest | [developers.programmable.family/api/v2/manifest](https://developers.programmable.family/api/v2/manifest) |
| Launch feed         | [developers.programmable.family/api/v2/launches](https://developers.programmable.family/api/v2/launches) |
| Product discovery   | [programmable.market/.well-known/programmable.json](https://programmable.market/.well-known/programmable.json) |

The status response reports the Ethereum head, finalized block, scan coverage, feed freshness and current Classic and Custom discovery counts. Consumers should inspect those fields rather than relying only on the top level service label.

Robinhood Chain Mainnet V4 availability is reported by the V4 and chain 4663 entries in live product discovery.
Submit only when both entries report all three create gates true: `publicWrites`, `publicAuthorization` and
`releaseReady`. If either entry is false, missing or incomplete, stop. Verify the immutable CLI release evidence
published in discovery before installation. Router provenance, finality, source verification and indexing remain
independent; external indexing may lag or be unavailable.

For a shared token/hook contract, use [MultiRole V2 capabilities](https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/capabilities) and its own request status and [finalized feed](https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/finalized). Its readiness, economic verification and wallet handoff are separate from the 4.1 profile. `evidence_required` identifies missing verification and does not authorize a wallet transaction. The [Custom Launch guide](developers/custom-launch.md) explains supported layouts and fees.

For each Robinhood launch, read its current finality and source-verification records. Treat source verification as
exact only when the aggregate and every required component carry the protected source/build/compiler/finalized-creation/
bytecode `exact_match` authority. A Sourcify match alone is a provider observation, and optional Robinhood Blockscout
does not establish or revise finality. Determine public API availability from the current live release gates and
their verified immutable CLI, release-binding and clean-room evidence. Per-launch source verification does not
establish public API activation, trading readiness or indexing.

CLI `3.3.9` is the Ethereum V3 integration. For Robinhood V4, install only the exact CLI version advertised after both public discovery
entries and the immutable GitHub Release evidence pass. Historical `4.0.0` and successor `4.1.0` retain different contracts;
when 4.1 is selected, follow its funding plan, an atomic initial buy of at least USD 1 and proof of the exact native fee kernel with 20 bps. The V4 lifecycle is `received`, `validating`, `action_required`, `authorized`,
`awaiting_wallet_signature`, `wallet_action_required`, `submitted`, `sequencer_soft_confirmed`, `ethereum_posted`,
`finalized` or `failed`; `action_required` is remediation, not a wallet action. Guard status reads with
`programmable-launch status REQUEST_UUID --api-version 4 --chain-id 4663 --watch --until finalized`. The CLI never
signs or broadcasts. V4 source verification starts after finality and does not revise it. Finality, source
verification, Programmable indexing, third-party indexing, trading readiness and publication must be checked
separately.

When price or liquidity data is unavailable or stale, the token and launch record can still be valid. Price, token valuation, liquidity and chart support should remain unavailable rather than being filled with guessed values.
