---
description: Verify and index Programmable Custom launch provenance on Robinhood Chain
---

# Index Programmable Custom on Robinhood

For Module Mode coins, use the separate [Module Mode indexing reference](module-mode-indexing.md). It verifies the native launcher and preserves selected modules as configuration. Both sources use chain and token address for coin identity.

Robinhood Custom Launches have two provenance interfaces. Separate token and hook contracts use V4 with Router V1. Shared-role projects use MultiRole V2 with Router V2. Select the source by the published route and Router protocol, then apply its own metadata and verification contract.

| Layout | Integration |
| --- | --- |
| Separate token and hook contracts | [V4 Router V1](#start-with-the-live-authorities) |
| Shared token/hook or other supported combined roles | [MultiRole V2](#multi-role-v2) |

The V1 addresses, events, schema and exact-source rules below apply to the V4 source. MultiRole uses the separate section at the end of this guide. Launch availability is read from each source's capabilities; historical finalized records retain their own bindings.

{% hint style="warning" %}
Do not publish the **Programmable Custom** label from a project name, token symbol, hook, factory, deployment
transaction, Router log or fixture alone. Require the complete feed, finality, Router and exact-source binding below.
{% endhint %}

## Start with the live authorities

| Authority                     | URL                                                                                                                                    | Use                                                                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery                     | [`.well-known/programmable.json`](https://programmable.market/.well-known/programmable.json)                                           | Resolve V4 paths, write gates, machine-contract links and the external-indexing guarantee field.                                            |
| Robinhood deployment manifest | [`GET /v4/chains/4663/capabilities`](https://api.programmable.market/v4/chains/4663/capabilities)                                      | Read `chainDeployment` and `chainDeploymentDescriptorDigest`, including contracts, runtime hashes, deployment evidence and finality policy. |
| Release readiness             | [`GET /v4/chains/4663/readiness`](https://api.programmable.market/v4/chains/4663/readiness)                                            | Verify the matching source commit, source tree, policy and deployment release identity.                                                     |
| Finalized feed                | [`GET /v4/chains/4663/finalized-custom-launches`](https://api.programmable.market/v4/chains/4663/finalized-custom-launches)            | Discover only schema-valid, terminal, Ethereum-finalized candidates.                                                                        |
| OpenAPI                       | [`custom-launch-v4.json`](https://programmable.market/openapi/custom-launch-v4.json)                                                   | Hash the exact response bytes, require equality with readiness `openApiSha256`, then generate types and validate the complete schemas.      |
| Integration fixture           | [`robinhood-terminal-indexer-v1.json`](https://programmable.market/fixtures/robinhood-terminal-indexer-v1.json)                        | Test exact constants, event topics, pagination, finality and fail-closed result states. It is not production data.                          |
| Router ABI                    | [`ProgrammableLaunchStampRouterV1.abi.json`](https://programmable.market/contracts/robinhood/ProgrammableLaunchStampRouterV1.abi.json) | Decode logs and perform the canonical registry reads.                                                                                       |
| Router explorer               | [`0x3496...C98a`](https://robinhoodchain.blockscout.com/address/0x34965F2A2ee9254522232C32F02056E92BE0C98a)                            | Inspect the address as supporting evidence. Explorer availability is not a release or source-verification authority.                        |

The top-level `manifestUrl` in discovery belongs to the Ethereum V2 developer surface. It is not the Robinhood V4
manifest. For chain 4663, use the `chainDeployment` object and its descriptor digest from the capabilities response,
then require the same binding in readiness and in each finalized item. Download the V4 OpenAPI as exact bytes, compute
`sha256:<lowercase hex>` and require equality with the top-level `openApiSha256` in the ready response before generating
types or validating a feed. A missing or mismatched digest is `UNAVAILABLE`; do not silently trust either side.

Resolve write activation independently from indexing. Report `ACTIVE` only when
`customLaunchApi.versions.v4.publicWrites`, `publicAuthorization` and `releaseReady` are all exactly `true` in live
discovery and readiness returns the matching ready release. Any explicit false gate is `INACTIVE`. A missing,
unreachable or malformed authority is `UNAVAILABLE`. A deployed Router, a reachable route or HTTP `200` does not
activate writes.

## Bind the exact identity

The expected chain and stamp identity is fixed. Fail closed if the live manifest disagrees.

| Field               | Required value                                          |
| ------------------- | ------------------------------------------------------- |
| Chain               | Robinhood Chain Mainnet                                 |
| `chainId`           | `4663`                                                  |
| `caip2`             | `eip155:4663`                                           |
| `chainDeploymentId` | `robinhood-mainnet-custom-launch-v1`                    |
| `platformId`        | `programmable`                                          |
| `category`          | `custom`                                                |
| Display label       | `Programmable Custom`                                   |
| Stamp generation    | `programmable-launch-stamp-router-v1`                   |
| Router launch kind  | `LaunchKindV1.CustomGraph = 1`                          |
| Durable key         | `(eip155:4663, onchain.router, onchain.routerLaunchId)` |

Keep the API request UUID in `launchId` separate from `onchain.routerLaunchId`. Treat `projectMetadata.token` as name
and symbol metadata only. Resolve the token address from `launchStamp(onchain.routerLaunchId)` at the verified L2
receipt block. Never merge an address with the same bytes on another chain.

### Verify the Router binding

Start provenance scans at block `50469365`. At the item's verified `onchain.l2Inclusion.blockNumber`, require these
addresses and runtime hashes to match the live deployment manifest and independent provider reads.

| Component              | Address                                                                                                                                  | Runtime Keccak-256                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Launch Stamp Router V1 | [`0x34965F2A2ee9254522232C32F02056E92BE0C98a`](https://robinhoodchain.blockscout.com/address/0x34965F2A2ee9254522232C32F02056E92BE0C98a) | `0x1dbbdaaad901ea3c6134dca0d4872a4789b3c071bf8ccfb44edd65d26d817388` |
| Graph Factory          | [`0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd`](https://robinhoodchain.blockscout.com/address/0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd) | `0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8` |
| Permit authority       | [`0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06`](https://robinhoodchain.blockscout.com/address/0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06) | `0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c` |
| PoolManager            | [`0x8366a39CC670B4001A1121B8F6A443A643e40951`](https://robinhoodchain.blockscout.com/address/0x8366a39CC670B4001A1121B8F6A443A643e40951) | `0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626` |

Hash the exact hosted ABI bytes before decoding. Their SHA-256 is
`bb4e728e9f9c850eb01f928e8a798ac206a82e241a8d93b3b3c686635c88ed86`. The profile-normalized ABI SHA-256 is
`ab25262ce1cb907eba1cb820492754c0cd5d7278eb5fd6a024ba24c767323ac0`, calculated from one `jq -cS`
serialization plus a trailing LF. These hashes cover different byte representations and are not interchangeable.

Also verify the Router's `CHAIN_ID`, Graph Factory, permit authority and PoolManager getters. Then verify
`launchIdByToken`, `launchIdByPool`, `launchIdByComponent`, `launchStamp`, `stampProof` and
`componentRuntimeCodeHash` at the same canonical L2 block. Robinhood provenance uses this Router-embedded registry.
There is no separate authoritative Custom Registry for this generation.

## Decode the Router events

Accept logs only from the exact Router at or after block `50469365`. The signatures are defined by the
[hosted ABI](https://programmable.market/contracts/robinhood/ProgrammableLaunchStampRouterV1.abi.json).

| Event and full signature                                                       | `topic0`                                                             | Indexed inputs                         | Role                |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------- | -------------------------------------- | ------------------- |
| `ProgrammableLaunchStampedV1(bytes32,address,address,address,bytes32,bytes32)` | `0x6cf479a102f1eebc9244f48f8d68f6aa52b4c5a4516318df58ba46614a5b14f2` | `launchId`, `token`, `hook`            | Discovery candidate |
| `ProgrammableLaunchRouteStampedV1(bytes32,uint8,bytes32,bytes32,bytes32)`      | `0x45e7cc355b63ca67d6278a0d8d23470ce2a0741a9c60283d7dee712df7a877a5` | `launchId`, `kind`, `routePayloadHash` | Discovery candidate |
| `ProgrammableComponentStampedV1(bytes32,address,uint8,bytes32)`                | `0x8147265e7396d6400cee8d049456a1f7438fdfbe2a7c81c976d51ba67e52ff4b` | `launchId`, `component`, `kind`        | Discovery candidate |
| `EIP712DomainChanged()`                                                        | `0x0a6387c9ea3628b88a633bb4f3b151770f70085117a15f9bf3787cda53f13d31` | None                                   | Not a launch signal |

Correlate the Component, Route and Launch events by indexed launch ID in the same successful receipt. Require the
route-event log index to precede the launch-event log index. Then replay the registry getters at that receipt block and
require launch kind `1`, the exact token, hook, PoolManager, pool ID, route launcher, component proofs, runtime hashes
and stamp commitments. Graph Factory logs are execution diagnostics and cannot replace the Router stamp.

## Traverse and validate the finalized feed

The feed is public and keyless. Authentication-protected request history is not a terminal discovery feed.

1. Resolve the selected V4 OpenAPI URL from live discovery. Hash its exact bytes and require the
   digest to equal readiness `openApiSha256`. The [V4.1 contract](https://programmable.market/openapi/custom-launch-v4.1.json) and [historical V4.0 contract](https://programmable.market/openapi/custom-launch-v4.json) have different digests. Then validate the full response against `CustomLaunchFinalizedListV4` and
   every item against `CustomLaunchFinalizedMetadataV4` in that bound schema.
2. Request `limit` from `1` to `25`. The default is `10`.
3. Process the page, then pass each non-null `nextCursor` back unchanged as `cursor`. Never decode, construct or
   normalize a cursor. Track all non-null cursors and return `INDETERMINATE` if one repeats.
4. Traversal is complete only when `nextCursor` is `null` and every page remains schema-valid with
   `quality.status: ready`.
5. Treat `sourceRowCount`, `publishedRowCount` and `quarantinedRowCount` as global dataset totals, not page lengths.
   A successful response requires source equal to published, quarantined equal to zero, and the current page length no
   greater than published. A malformed eligible candidate must fail the endpoint. Do not accept partial output or
   row-wise quarantine.
6. On an HTTP, schema or quality failure, report feed availability as `UNAVAILABLE`. Do not infer a result from cached
   metadata or the fixture.

For every item, require `platformId: programmable`, `category: custom`, `chainId: "4663"`, `caip2: "eip155:4663"`,
the expected Router and `onchain.schemaVersion: programmable.custom-launch-onchain-evidence.v3`. Deduplicate by the
durable key, not the API request UUID.

If you also index Router logs directly, retain an overlap window, compare canonical block hashes and rewind to the last
common finalized checkpoint after a reorganization. Direct Router provenance indexing is independent of write
activation, but a log alone is not eligible for the public finalized label.

## Verify finality and source

Request lifecycle states such as `sequencer_soft_confirmed` and `ethereum_posted` are not finality. A public candidate
must have `onchain.terminal: true`, `onchain.checkpointType: ethereum_finalized` and all three non-null V3 evidence
objects:

1. `onchain.l2Inclusion` identifies the successful Robinhood transaction, block hash and exact Route and Launch event
   positions. Require `onchain.transactionHash` to equal its nested transaction hash. Replay this receipt before all
   Router reads.
2. `onchain.l1Posting` identifies the distinct Ethereum batch-posting transaction and event. Require chain
   `eip155:1`, rollup `0x23A19d23e89166adedbDcB432518AB01e4272D94` and SequencerInbox
   `0xBd0D173EEb87D57A09521c24388a12789F33ba96`.
3. `onchain.l1FinalizedCheckpoint` identifies the common Ethereum checkpoint with tag `finalized`. Require its ordered
   provider readbacks to be `drpc` / `drpc.org`, then `quicknode` / `quicknode.com`, bound to the same provider
   identities in the deployment manifest. Both block number and hash pairs must match the common checkpoint.

The flat `onchain.blockNumber`, `blockHash` and `logIndex` fields are a deprecated stage projection, not a transaction
locator. At the finalized stage, the block fields project the L1 finalized checkpoint while the log index belongs to
the earlier L1 posting event. Never combine this trio with the L2 transaction hash. Historical V2 evidence is private
history and is not a public-feed candidate unless a separate canonical V3 projection is fully revalidated.

Require `sourceVerification.status: exact_match` and `exact_match` on every component, keeping each component keyed by
both `targetId` and address. The authoritative binding includes protected source closure, reproducible hosted build,
compiler and settings, finalized creation transaction, and exact creation and runtime bytecode. A provider-only
Sourcify observation is not publication authority. Robinhood Blockscout is optional and cannot satisfy or block exact
source authority or revise finality. Exact source verification is still not an audit or safety endorsement.

## Return independent result axes

Do not let one result fill in or erase another.

| Axis                | Values and rule                                                                                                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provenance          | `STAMPED` only after every Router binding, canonical read and event correlation succeeds at the verified L2 block. `NOT_STAMPED` only after a canonical identity lookup succeeds and returns zero. Otherwise `INDETERMINATE`.      |
| Feed availability   | `AVAILABLE` only for a complete schema-valid page with ready quality. Endpoint, schema or quality failure is `UNAVAILABLE`.                                                                                                        |
| Finality            | `FINALIZED` only after all required V3 L2 inclusion, L1 posting and L1 finalized-checkpoint evidence agrees. Otherwise `INDETERMINATE`.                                                                                            |
| Source verification | Publication requires aggregate and component `exact_match`. Any missing or conflicting authoritative binding is `INDETERMINATE` for publication.                                                                                   |
| Write activation    | `ACTIVE` only when all three live discovery gates are true and readiness matches. An explicit false gate is `INACTIVE`; an unreadable authority is `UNAVAILABLE`.                                                                  |
| Fee behavior        | Report `UNAVAILABLE` unless basis, currency, accounting, rounding, accrual, claim mechanics and canonical onchain enforcement are separately proven. Per-launch applicability is `UNVERIFIED` without an explicit backend binding. |
| Security            | `UNVERIFIED`. A stamp and exact source prove identity, not safety.                                                                                                                                                                 |
| Market support      | `UNVERIFIED`. A stamp does not prove price, liquidity, routability, venue support or trading compatibility.                                                                                                                        |

An independently finalized `STAMPED` launch remains indexable when writes are inactive or unavailable. Read the live feed to establish item presence.

## Fee policy is a separate fact

Do not hardcode a rate or recipient from this guide or the fixture. Resolve the current global requirement from
`customLaunchApi.versions.v4.platformFeePolicy` in live discovery and preserve its `rateBps`, `ratePpm`, `ratePercent`,
`recipient`, scope and enforcement fields together. A global API requirement does not change older launches and is not,
by itself, proof of immutable onchain enforcement, a charged fee or platform revenue. Do not copy it onto a terminal
row. Report fee behavior only when the live record explicitly proves the applicable rate, basis, currency, recipient,
accounting and claim path for that exact launch.

## Third-party indexing is not guaranteed

No third-party terminal, exchange, explorer, data provider or indexer is guaranteed to ingest, display or support a
Programmable launch. The live discovery field `customLaunchApi.versions.v4.externalIndexingGuaranteed` is the machine
authority for any advertised guarantee. If no explicit guarantee is available, report third-party indexing as
`UNVERIFIED`. Never turn Router indexability into a claim about a named third party, price coverage, liquidity or an
executable trade route.

## Integration sequence

1. Fetch discovery, capabilities and readiness. Resolve live state and require one matching chain-deployment binding.
2. Download the OpenAPI, hash its exact bytes and require equality with readiness `openApiSha256`. Fail closed on a
   missing or mismatched digest.
3. Download and hash the ABI. Verify chain, Router, dependencies, runtime hashes and immutable getters.
4. Fetch and OpenAPI-validate every finalized-feed page through a null cursor.
5. Verify each item's nested finality coordinates, receipt, Router events, registry reads and exact-source components.
6. Emit the **Programmable Custom** label only after provenance, finality and source verification pass. Preserve all
   other result axes independently.
7. Record the endpoint, UTC observation time, response status, manifest digest, Router, V3 coordinates and provider
   identities for reproducibility. Never include an API key, signed transaction or private request body.

For non-sensitive integration failures, [open a GitHub issue](https://github.com/programmablehq/PROGRAMMABLE/issues).

## MultiRole V2

Use the public [MultiRole capabilities](https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/capabilities) and [versioned guide](https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/guide.md). The Router protocol is `programmable.multi-role-launch-stamp-router.v2`. Read the complete `context`, including `chainBindings`, deployment, profile and provider bindings. Do not substitute Router V1 addresses or getters.

### Read finalized records

```sh
curl --fail --silent --show-error \
  'https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/finalized?limit=25'
```

The list schema is `programmable.multi-role-finalized-metadata-list.v2`; each record uses `programmable.multi-role-finalized-metadata.v2`. The list accepts `limit` from 1 to 25, defaults to 25 and returns an opaque `nextCursor`. Pass each non-null cursor back unchanged and finish only when it is null. Reject repeated cursors, malformed records and failed pages without advancing the durable checkpoint.

Keep `apiLaunchId` separate from `onchainLaunchId`. The first is the API UUID; the second is the lowercase bytes32 Router launch ID. Use `(caip2, chainBindings.router, onchainLaunchId)` as provenance identity and `(caip2, market.token)` as coin identity. Read a single record at `/finalized/{onchainLaunchId}` under the same base path.

### Preserve combined roles

Each physical component has `account`, `roleMask`, `runtimeCodeHash`, `scope` and `resultIndex`. Token and hook in one contract have role mask `3`; `market.token` and `market.hook` may therefore be equal. Preserve the physical component once with all its roles. Auxiliary components can have role mask `0` and must not be discarded merely because they are not the token or hook.

Verify the exact V2 Router and child runtimes, event bindings and getters required by the published context. The V1 `LaunchKindV1.CustomGraph` decoder and V1 distinct-role checks are not the V2 verifier. New compatible projects are indexed through their source contract, without a project-name or hook-address allowlist.

### Keep evidence coordinates separate

MultiRole public records require protected Ethereum finality plus the matching original request, source, image, artifact and permit window. Their `onchain.blockNumber`, `blockHash` and `transactionHash` identify L2 inclusion. `onchain.ethereumPosting` identifies the L1 posting event, and `onchain.ethereumFinalizedCheckpoint` identifies the distinct Ethereum finalized checkpoint. Unlike the V4 legacy flat projection described above, these L2 block fields are not aliases for the L1 checkpoint.

Check `onchain.checkpointType: ethereum_finalized` and preserve the evidence and provenance hashes with the original record. Historical finalized records remain readable after the admission release changes or expires. New-request readiness does not rewrite their original context.

The MultiRole projection reports external source publication and indexer publication separately. Sourcify and Blockscout may be `not_verified`, while indexer publication is `not_claimed`; do not rewrite those values as a failure of protected launch finality or as an external source-verification success. Do not apply V4's different `sourceVerification.status: exact_match` response contract to this V2 projection. A terminal must verify the V2 evidence it uses and report its own indexing and market support independently.

Fetch admitted images only from the record's digest-bound public image path and verify their content hash and type. Treat project descriptions and links as untrusted display metadata. A public record supplies identity and evidence; it does not authorize a trade or supply a universal execution adapter.
