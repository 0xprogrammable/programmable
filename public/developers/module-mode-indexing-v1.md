---
description: Identify Module Mode coins independently of their selected modules
---

# Index Module Mode launches

Index the launch contract, then attach the selected module configuration to that launch. Module names, categories and frontend controls are not part of coin identity. A coin with no modules uses the same source interface as a coin with modules.

This reference covers `module-native-v1` on Robinhood Chain, `eip155:4663`. New modules within that source version use the same procedure. A new engine or source version must publish its own deployment binding and adapter before an indexer treats it as supported.

## Start with discovery

Read the public [indexer contract](https://programmable.market/api/module-mode/indexer/v1). It includes the launch ABI, event topics, required identity fields and release discovery path. It is generated from the same ABI used by the website verifier.

```bash
curl --fail --silent --show-error https://programmable.market/api/module-mode/indexer/v1
curl --fail --silent --show-error https://programmable.market/api/module-mode
```

The second response contains `release`. Require its schema `programmable.module-mode-source.v1`, `sourceVersion: "module-native-v1"`, `chainId: 4663`, `enabled: true` and `status: "active"` before accepting a new source. A missing release or unsupported version stops source activation.

Bind the launcher address and runtime hash from `release.contracts.launcher`, the PoolManager and other dependencies from `release.contracts`, and the scan origin from `release.startBlock`. Verify the release digest with the published release implementation and retain the exact profile and its `sourceCommit`. Deployment, source verification and lifecycle evidence digests identify separate artifacts. A digest alone is not the artifact or proof of its contents.

Do not substitute addresses from a token's metadata. Preserve the binding for each historical release when discovery later selects another release.

## Discover and verify a launch

1. Verify that the RPC reports chain 4663. Verify the launcher's deployed runtime against its release hash.
2. Scan `ModuleNativeLaunched` from the bound launcher, starting at `release.startBlock`. Use bounded block ranges and split a range when a provider rejects it or truncates results.
3. Fetch the successful transaction receipt. Check the emitting address, transaction hash, block number, block hash, log index and canonical ABI encoding. Reject removed logs.
4. At that same canonical block, read `launchIdentityVersion()`, `getLaunch(token)` and `getLaunchIdentity(token)` from the launcher. Require version 1 and agreement with the event on launch ID, launching wallet, token, pool, hook and recipe. Check the PoolManager against the release.
5. Read the matching `ModuleNativeProgramBound`, `ModuleNativeConfigurationBound` and `ModuleNativeTokenIdentityBound` events from the same receipt. Bind the runtime, launch key, funding, token identity and configuration commitments to the same launch ID.
6. Verify the PoolKey, token identity, runtime program, selected registry revisions, module instances and deployed code at the same block. Recompute the recipe, program, launch and instance commitments using the [reference verifier](https://github.com/programmablehq/PROGRAMMABLE/blob/production/lib/module-mode/provenance.ts) from the bound source revision.
7. Verify finality, store the accepted record and advance the source checkpoint only after the entire range is complete.

The reference verifier checks consistency of supplied evidence. The collector must first obtain and authenticate the RPC results, receipt inclusion, runtime code and rollup finality. An untrusted JSON object claiming `verified` cannot establish provenance.

## Finality and checkpoints

The source uses `robinhood-ethereum-finalized-v1`. A sequencer receipt alone is not finality under this policy. The collector establishes the transaction's L2 block, its rollup batch membership and the corresponding batch posting on Ethereum at or before the common finalized Ethereum checkpoint. The reference collector compares two independent L2 observations and two independent Ethereum providers. Its implementation is described in the [index architecture](https://github.com/programmablehq/PROGRAMMABLE/blob/production/docs/architecture/module-mode-indexing-v1.md).

Keep a checkpoint for each `(chainId, sourceAddress, sourceReleaseDigest)`. Store its block number and hash. Process logs in block, transaction and log order. Commit rows and their checkpoint atomically. A failed or incomplete range must not advance the checkpoint.

On restart, compare saved checkpoint hashes with the canonical chain. If they differ, roll back affected records and rescan from the last matching checkpoint. Retry temporary provider failures with bounded backoff. Retain previously verified rows and report their freshness; a failed read is not an empty result.

## Record identity

| Identity | Key |
| --- | --- |
| Coin | `(chainId, tokenAddress)` |
| Pool | `(chainId, poolManager, poolId)` |
| Launch | `(chainId, sourceAddress, launchId)` |
| Event | `(chainId, blockHash, transactionHash, logIndex)` |

Normalize addresses for comparisons. Preserve integer amounts and block numbers without floating point conversion. Deduplicate token, pool, launch and event identities before committing a batch.

The creator is `ModuleNativeLaunched.launchWallet`, checked against the launcher's getters. Do not infer it from `transaction.from`, the relayer, a module author, a fee recipient or `token.creator()`. Wallet relaying and later fee-recipient changes do not change launch ownership.

The website's normalized Module Mode records use these fields:

| Field | Meaning |
| --- | --- |
| `sourceKind` | `module-native-v1` |
| `sourceAddress`, `sourceReleaseDigest` | The verified launcher and its release identity |
| `launchId`, `tokenAddress`, `creator` | The canonical launch, token and launching wallet |
| `poolManager`, `poolId`, `hookAddress` | The verified pool and host hook |
| `recipeHash`, `runtime`, `launchKey` | The launch's configuration and runtime binding |
| `modulePackageIds`, `moduleFamilyIds` | Selected revision and family identifiers in their recorded order |
| `transactionHash`, `blockNumber`, `blockHash`, `logIndex` | The launch event's chain coordinates |
| `verificationDigest` | The verification artifact identity |
| `routerAddress`, `stampHash` | `null` for this native source |

Custom Launches use a separate Launch Stamp Router source. Keep both sources in the same token index using the keys above, and select the verifier by source version. Do not require a Custom stamp for a native Module Mode launch. See the [Custom terminal reference](https://programmable.market/developer-reference/robinhood-terminal-indexer) for that source's rules.

## Handle modules generically

Treat package and family IDs as opaque `bytes32` values. Preserve the exact selected revisions, configuration bytes, instance addresses and commitments. An empty selection is valid. The source version defines ordering and resource bounds.

Resolve display names, icons, configuration labels and management descriptions as optional enrichment. A valid launch does not disappear because an indexer has never seen a module before, cannot render its controls or cannot quote its market. Do not filter identity by a local list of module names, categories, fee values or available trading adapters.

Read revision evidence at the launch block. Disabling a revision for future launches must not remove existing coins. New module revisions retain their own IDs; they do not overwrite historical launch configuration. A change to the host or source interface requires a versioned adapter and an explicit release transition.

## Images and social links

Once the launch identity is verified, call `metadata()` on its canonical token address. The return values are `(string description, string website, string image, bytes extraData)`. `website` and `image` are public HTTPS URLs. A Module Mode launch without a selected image records `https://programmable.market/brand/loop/programmable-module-token-default-v1.png`; an uploaded or supplied image keeps its own URL.

`extraData` contains optional UTF-8 JSON with version `v: 1`. Its supported social fields are `x`, `telegram`, `discord`, `github` and `gitbook`. The builder's Twitter field maps to `x`. The website remains in the separate `website` value.

```json
{"v":1,"x":"https://x.com/project","telegram":"https://t.me/project","discord":"https://discord.gg/project","github":"https://github.com/project/repo","gitbook":"https://project.gitbook.io/docs"}
```

Empty `extraData` (`0x`) and absent fields are valid. Each social URL is limited to 512 UTF-8 bytes; the complete encoded JSON is limited to 1,200 bytes. Images and website URLs have a 2,048-byte limit. Decode supported versions, validate HTTPS URLs and platform hosts, and render links as data. Do not execute content from metadata. GitBook may use a custom public HTTPS domain.

For launch-time metadata proof, compute `keccak256(abi.encode(name, symbol, metadata))`, where `metadata` is the single tuple `(description, website, image, extraData)`, and compare it with `ModuleNativeConfigurationBound.metadataHash` from the verified receipt. Keep metadata validation separate from launch discovery: an unavailable image, malformed optional link or unfamiliar metadata version must not remove the coin. The source reference publishes the getter ABI and field mapping in its `tokenMetadata` object.

The website reads saved launch identities first, then attaches optional token metadata. `GET /api/explore/robinhood/presentation?token={tokenAddress}` returns `imageUrl`, `description`, labeled `links` and optional market data. The same presentation is attached to Explore list responses. This display response does not replace independent source and receipt verification.

## Website reads and archive indexing

The website exposes [Explore records](https://programmable.market/api/explore/robinhood) and a creator lookup at `https://programmable.market/api/profile/robinhood?account={launchWallet}`. Both report `status`, `updatedAt`, `items` and pagination. Explore accepts `mode=all|module|custom`, `page`, `pageSize=10|50`, `q` and `sort`. The default API page size is 50; the website requests 10 cards and keeps the main Programmable token pinned. Read `page.totalPages` and `page.hasMore` and traverse all pages. Profile pages retain a size of 50.

Explore applies website visibility, search and market filters. It is a presentation feed, not a complete archival export. For complete independent discovery, scan the bound launch contract using the procedure above. Do not use a displayed coin count as a source checkpoint.

Keep provenance, indexing freshness and market support as separate fields. A terminal can display a verified coin identity while reporting that its trading adapter or market data is unavailable.

## Integration checks

Before enabling a source, check a base coin, a configured coin, unfamiliar module IDs, disabled historical revisions, duplicate logs, an incomplete range, a changed checkpoint and a relayed launch. Invalid source, receipt, configuration or finality evidence must prevent admission. Missing optional metadata must not remove an otherwise verified record.
