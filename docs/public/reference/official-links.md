---
description: Official Programmable product, source, community and analytics links
---

# Official links

| Resource                | Link                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Website                 | [programmable.market](https://programmable.market)                                                                 |
| Create                  | [programmable.market/launch](https://programmable.market/launch)                                                   |
| Explore                 | [programmable.market/explore](https://programmable.market/explore)                                                 |
| GitHub                  | [github.com/programmablehq](https://github.com/programmablehq)                                                     |
| Custom Launch API keys  | [programmable.market/developers/api-keys](https://programmable.market/developers/api-keys)                         |
| Custom Launch API guide | [programmable.market/developers/custom-launch-api-v1.md](https://programmable.market/developers/custom-launch-api-v1.md) |
| Custom Launch V1 OpenAPI | [live reads and write fence](https://programmable.market/openapi/custom-launch-v1.json)                    |
| Custom Launch V2 OpenAPI | [V2 reads, schemas and write fence](https://programmable.market/openapi/custom-launch-v2.json)                     |
| Custom Launch V3 OpenAPI | [Ethereum V3 schemas; select the profile from capabilities](https://programmable.market/openapi/custom-launch-v3.json) |
| Custom Launch quickstart | [Choose an API and complete a launch](../developers/custom-launch-quickstart.md) |
| Custom Launch discovery | [Profiles, capabilities and client releases](https://programmable.market/.well-known/programmable.json) |
| Custom Launch V4.1 OpenAPI | [Robinhood V4.1 request contract](https://programmable.market/openapi/custom-launch-v4.1.json) |
| Custom Launch V4.1 schema | [Robinhood V4.1 pack config](https://programmable.market/schemas/custom-launch/v4.1/pack-config.json) |
| MultiRole V2 guide | [Shared token and hook contracts](https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/guide.md) |
| Custom Launch V4.0 OpenAPI | [Historical Robinhood V4.0 contract](https://programmable.market/openapi/custom-launch-v4.json) |
| Custom Launch V4 schema | [Historical Robinhood V4.0 pack config](https://programmable.market/schemas/custom-launch/v4/pack-config.json) |
| Custom Launch V4 source status | [Historical V4.0 source-verification schema](https://programmable.market/schemas/custom-launch/v4/source-verification-status.json) |
| Custom Launch CLI 4.0.0 | [Historical Robinhood V4 source; use live discovery for the current installable release](https://github.com/programmablehq/PROGRAMMABLE/tree/53926119030772040eca34b4796a36353c9da2d2/packages/launch) |
| Custom Launch API      | [api.programmable.market](https://api.programmable.market)                                                         |
| Custom API readiness    | [api.programmable.market/readyz](https://api.programmable.market/readyz)                                           |
| Custom Launch CLI 3.3.9 | [public V3 GitHub Release asset](https://github.com/programmablehq/PROGRAMMABLE/releases/download/programmable-launch-v3.3.9/programmable-launch-3.3.9.tgz) |
| Custom Launch CLI 1.0.1 | [V1 compatibility asset](https://github.com/programmablehq/PROGRAMMABLE/releases/download/programmable-launch-v1.0.1/programmable-launch-1.0.1.tgz) |
| Launch policy           | [github.com/programmablehq/Launch-Policy](https://github.com/programmablehq/Launch-Policy)                         |
| Read-only developer API | [developers.programmable.family](https://developers.programmable.family)                                           |
| X                       | [x.com/ProgrammableHQ](https://x.com/ProgrammableHQ)                                                               |
| Discord                 | [discord.com/invite/programmable](https://discord.com/invite/programmable)                                         |
| Dune                    | [Programmable analytics](https://dune.com/programmablehq/analytics)                               |
| V4 token                | [Dexscreener](https://dexscreener.com/robinhood/0x3df16f271060e4941c0386047def159f42e629dc0455db623c5b363eeacbcc1d) |

Use `api.programmable.market` for authenticated launch requests. Choose the network and contract layout in the
[quickstart](../developers/custom-launch-quickstart.md), then read the matching live capabilities. Wallet keys,
partner roots and bounded partner subkeys grant API access within their declared scopes and chain restrictions.
The controller wallet signs the transaction separately.

For Robinhood V4, require `publicWrites: true`, `publicAuthorization: true` and `releaseReady: true` in both the V4
and chain 4663 discovery entries. The immutable client release, source commit, manifest and tarball checksum come
from `customLaunchApi.versions.v4.cli.release`. MultiRole uses its own capabilities, readiness, context and client.
API-key handoff uses only `$PROGRAMMABLE_API_KEY`.

CLI `3.3.9` serves Ethereum V3. Select the profile advertised by live capabilities; a schema for another profile
is a reference contract, not permission to submit it. Ethereum V2 and V1 retain history and schemas, while fresh
creation returns `409 CUSTOM_LAUNCH_V2_READ_ONLY` or `409 CUSTOM_LAUNCH_V1_READ_ONLY`.
Legacy Registry and GitHub submission intake is closed.

Robinhood Native20 charges 20 bps (0.20%) for Programmable, separately from creator and pool fees. The
[fees guide](../economics.md) explains the calculation and how the Dune figures count accruals and claims.
Historical launches retain their own fee models.

Use the read-only developer service and versioned deployment manifest to verify Ethereum deployment data.
Use canonical chain records to verify launch identity. Source verification, finality, indexing and trading
readiness each have their own status.
