---
description: Index Programmable launches with finality, cursor completeness and explicit data quality
---

# Index Programmable launches

## Choose the launch source

| Source | Integration |
| --- | --- |
| Module Mode on Robinhood | [Native Module Mode indexing](module-mode-indexing.md) and [JSON contract](https://programmable.market/api/module-mode/indexer/v1) |
| Custom Launches on Robinhood | [Custom terminal integration](robinhood-terminal-indexer.md) |
| Ethereum launch records | The v2 feed and Router procedure below |

Module Mode coins use the native launcher's events and getters. Custom Router stamps are not required for that source. Store the chain and token address as coin identity, then select the correct source verifier. New module IDs do not require a separate parser; preserve them as configuration.

## Ethereum launch records

An Ethereum indexer can use the normalized v2 feed or reproduce Router records directly. Robinhood Chain V4 uses the
separate chain-bound feed described below. In every case, finality, cursor traversal and unknown data need explicit
handling.

The normalized launch feed returns versioned records for Classic and Registry-verified Custom launches. Consumers should follow every cursor until completion, remove duplicate launch ids and retain records when optional price, chart or liquidity data is unavailable. A missing chart or quote is not permission to discard a valid launch record.

Direct Router indexing starts at the manifest's current start block. Process the published events in canonical order, retain block and log identity, and roll back records affected by a reorganization before finality. Cross check token or pool lookups at one canonical block before exposing the public label.

Price and liquidity data should carry its own source, timestamp, status and quality. When a current value cannot be established, expose that state directly rather than converting the last launch transaction into a current valuation.

The Ethereum public status endpoint reports feed freshness, chain head, scan coverage and current counts. Production consumers should alert on lag and incomplete traversal instead of treating service availability as freshness.

## Integrate Robinhood V4

Robinhood Chain Mainnet uses `chainId: 4663` and `eip155:4663`. Download the exact bytes of the
[V4 OpenAPI contract](https://programmable.market/openapi/custom-launch-v4.json), compute their SHA-256 digest and
require equality with the top-level `openApiSha256` in a ready chain response before generating types or validating
data. A missing or mismatched digest must fail closed. Then validate the fixture and map the published ABI topics.
Resolve current activation from
[Programmable discovery](https://programmable.market/.well-known/programmable.json),
`GET /v4/chains/4663/capabilities` and `GET /v4/chains/4663/readiness`; those are separate live authorities. Treat
creation as active only when discovery reports `publicWrites: true`, `publicAuthorization: true` and
`releaseReady: true`, and readiness reports the matching ready release. A deployed route or HTTP `200` alone does not
activate writes. The fixture's empty response is a schema-valid parser vector, not a production observation. Always
fetch the live feed.

For provenance discovery, read the public, keyless
`GET /v4/chains/4663/finalized-custom-launches` feed. Validate every response and item against both chain identifiers,
then apply these rules:

- Publish only items with server-authored `platformId: programmable`, `category: custom`,
  `onchain.schemaVersion: programmable.custom-launch-onchain-evidence.v3`, `onchain.terminal: true` and
  `onchain.checkpointType: ethereum_finalized`. Require non-null `onchain.l2Inclusion`, `onchain.l1Posting` and
  `onchain.l1FinalizedCheckpoint`; a sequencer soft confirmation or Ethereum posting is not finality. Independently
  verify that platform/category is backed by Router launch kind 1 rather than project metadata.
- Store `projectMetadata.token` as name/symbol metadata, not an address. Replay `onchain.l2Inclusion.transactionHash`
  on chain 4663, match its L2 block number/hash and Router launch/route event indexes, then resolve
  `launchStamp(onchain.routerLaunchId)` at `onchain.l2Inclusion.blockNumber`. If this coordinate is unavailable or
  disagrees, provenance is `INDETERMINATE`. Require the top-level `onchain.transactionHash` to equal this L2
  transaction hash. Cross-check the token target ID and source-verification component separately; never identify a
  token by name or symbol alone.
- Treat `onchain.l1Posting` as the Ethereum batch-posting event and `onchain.l1FinalizedCheckpoint` as the distinct
  common finalized checkpoint. Require chain `eip155:1`, rollup
  `0x23A19d23e89166adedbDcB432518AB01e4272D94`, SequencerInbox
  `0xBd0D173EEb87D57A09521c24388a12789F33ba96`, and the posting batch and event coordinate. Require the checkpoint's
  two ordered provider readbacks to be `drpc` / `drpc.org`, then
  `quicknode` / `quicknode.com`, matching the ordered identities in
  `chainDeployment.deploymentEvidence.ethereumFinalityEvidence`; both readbacks must agree with the common checkpoint.
  The deprecated flat `onchain.blockNumber`, `blockHash` and `logIndex` trio is only a stage projection, not a
  transaction locator. At the finalized stage its block fields alias the finalized checkpoint while its log index
  belongs to the earlier posting event; never combine it with the top-level L2 transaction hash. Historical V2
  evidence remains private authenticated history and is never a public-feed candidate. Only a separate, fully
  revalidated canonical V3-finalized projection may qualify on its own evidence.
- Require `sourceVerification.status: exact_match` and every component status to be `exact_match` with its complete
  authoritative binding. Keep each component keyed by both `targetId` and address. A provider-only Sourcify
  observation is not publication authority. Queued, retrying and needs-attention states remain visible only on the
  authenticated private resource and are never public-feed candidates.
- Only canonical eligible V3-finalized rows with that authoritative exact-source verification are public candidates;
  V2 evidence remains private history. The quality counters are global totals for that finalized dataset, not counts
  for the current page. Every successful response is `ready`, with `sourceRowCount` equal to `publishedRowCount` and
  `quarantinedRowCount` equal to zero. The current page's `launches.length` may be smaller than published but never
  larger. A malformed eligible V3 candidate fails the entire endpoint request; consumers must not accept a row-wise
  quarantine or partial result.

Do not infer a public item from the empty fixture. An item exists only when the live feed returns it with the complete
Router, finality and protected exact-source composite described here. A Sourcify observation with
`releaseAuthority: false` is not publication authority; optional Robinhood Blockscout cannot satisfy or block that
authority and cannot revise finality. The machine-contract hashes are already refreshed. Release readiness instead
depends on six independent evidence gates: chain deployment, profile, release manifest, source closure, finality and
backend release evidence. Resolve their current result from the live readiness authority rather than copied status
text.

The request accepts an optional `limit` from 1 to 25 and defaults to 10. The response returns an opaque `nextCursor`;
pass each non-null value back unchanged as `cursor` and never decode or construct one. Declare traversal complete only
after `nextCursor` is null and quality remains `ready`.

Direct Robinhood Router provenance indexing is independent of write activation. Start only from the exact published
Router address, runtime hash, ABI and event bindings, start block and finality policy, after provider readback agrees
with that binding. Do not backfill from an unverified address embedded in a schema or from one deployment transaction.
Advance the public checkpoint only through the published Robinhood-to-Ethereum finality proof.
Enable a terminal's Robinhood launch label only after those Router roots verify at the V3 `l2Inclusion` receipt block,
a finalized item is present in the feed and the complete traversal reports `quality.status: ready`.

Direct Router indexability alone proves neither trading compatibility nor current price, liquidity, fee behavior,
source verification or safety. A successfully OpenAPI-validated public-finalized item separately requires aggregate
and component-level authoritative source verification at `exact_match`; that still is not a safety endorsement. The
optional post-finality Universal Router trading-descriptor path is deliberately disabled, and V4 finalized items
publish no such descriptor. A V4 Quoter call does not prove that an arbitrary hook can execute through Universal
Router. Unless a later public schema and capabilities contract enables a server-authored descriptor backed by an exact
Universal Router execution proof, terminals should display launch identity only and must not infer a route from a
Router address, PoolKey or project metadata.

## Index protocol fee claims separately

The public launch feed is not itself the protocol fee claim queue. The claim
inventory follows the exact execution contracts:

- Classic V2 and V3 coin rows come from complete canonical Launcher event
  scans. Fee execution remains one aggregate claim per verified version hook;
  the legacy V1 aggregate hook remains a separate row.
- A Router-stamped Classic launch is covered automatically only when its exact
  hook matches a known verified aggregate hook. An unknown Classic hook remains
  visible and blocks the combined claim.
- The complete Registry history remains available for audit, but Custom
  Registry V1 is retired as a live discovery or claim source.
- Router-stamped Custom launches come from a consensus-finalized Router event
  replay. The claim console requires the Wallet RPC and two independent public
  RPCs to report `finalized` views no more than 32 blocks apart. It uses the
  oldest view as the safe boundary, requires all three RPCs to return its exact
  block hash, then requires the exact same complete raw log tuples through that
  checkpoint. It then verifies every launch record, token or pool lookup,
  component proof, runtime and displayed claim balance at that same checkpoint.
- A Custom claim is executable only through an exact reviewed profile bound to
  its launch ID, token, fee source and runtime. The current profiles cover
  FADE's native accumulator, SHARD's direct launcher-fee claim, PCAN's
  dual-currency PoolManager redemption and PCR2's two-currency fee Vault.
  PCR2's native and token balances are independent claim calls, and only
  positive balances enter the batch. Future Router-stamped Custom launches are
  discovered and remain visible, but a new or unknown claim ABI blocks the
  combined claim until an exact profile is reviewed. The console does not
  provide universal arbitrary Custom support and never guesses calldata from
  selectors or bytecode shape.
- Stock claims use the published fixed release asset set. New Stock assets are
  not inferred or silently added.
- Custom V2 remains unavailable until an exact deployed and finalized release
  binding exists. Unknown, mismatched or unverified bindings block the combined
  claim. Quarantined sources remain visible and non-executable.

The live console publishes this boundary at
[`claimhazard.vercel.app/claim-discovery.json`](https://claimhazard.vercel.app/claim-discovery.json).
It rescans before every claim and includes only positive verified entries in one
wallet-declared atomic batch from the fixed reward wallet. Its immediate latest
simulation can include fees accrued after the displayed finalized balance. The
current safe limit is 64 calls; overflow blocks execution instead of silently
omitting a claim. Before opening the wallet, the console persists an app-defined
batch ID under an origin-wide tab lock. A confirmed batch remains locked across
reloads until its exact transaction and block receipts agree across all three
RPCs and the Router checkpoint has finalized them. Off-chain failures and full
reverts may unlock automatically; partial or ambiguous outcomes remain locked
for manual reconciliation. If the page closes during wallet submission, the
saved call set can only be resumed with the same app-defined ID; it is never
rebuilt as a second batch.
