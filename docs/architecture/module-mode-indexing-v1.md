# Module Mode: native launch provenance and the shared Robinhood index

Module Mode uses the actual `ModuleNativeLaunchV1` generation. Its source is not an Ethereum Classic contract or a Custom Launch Stamp Router. The native engine source was aligned with commit `2d914a8cfb763e8aac02ad848aaac401f7201503`. Any subsequent contract change requires the ABI, hash vectors, runtime pins and release evidence to be checked again.

The checked-in [Robinhood profile](../../config/module-mode/robinhood.preview.json) is disabled and has no deployment addresses. It cannot start a collector or make a coin public. Source implementation, local tests, deployed contracts, source verification, lifecycle verification, finality and public availability are separate facts.

## One saved list, distinct sources

The existing website list is stored in the same private Blob at `website-index/robinhood/launches-v1.json` through [`store.ts`](../../lib/server/robinhood-index/store.ts). Module Mode adds an optional `moduleMode` slice to the existing snapshot. The Custom slice retains its original Router address, binding, records and cursor; no Custom row is reclassified.

The Module slice has its own native launcher address, immutable release digest, deployment start block, finalized boundary, cursor, bounded checkpoints and normalized rows. [`sync.ts`](../../lib/server/robinhood-index/sync.ts) uses the same range algorithm for both slices. A Module pass writes a merged snapshot with the original ETag. A concurrent writer therefore causes a compare-and-swap failure instead of overwriting another source's progress. Custom passes preserve the Module slice.

Only fully verified ranges advance the relevant cursor. A failed launch rejects its entire range. The synchronizer replays up to 64 blocks, checks the boundary before and after collection, re-reads its finalized boundary before saving, and rewinds the affected slice to a common verified checkpoint on a hash mismatch. The other source's rows remain intact. Existing rows are not erased because a provider returns an incomplete overlap. Source-address, release-digest or start-block changes require an explicit index migration; they are not automatic upgrades of past launches.

The existing canonical Custom envelope must first exist before a Module slice can be attached. The Module updater never invents a Router binding to initialize storage. This reuses the deployed website index and its existing cron authorization/storage credentials.

[`read.ts`](../../lib/server/robinhood-index/read.ts) and [`model.ts`](../../lib/server/robinhood-index/model.ts) merge accepted rows for Explore, token lookup and profiles. Page requests continue reading saved data only. Profiles match the native launch event's `launchWallet`, never the module author, current fee recipient, transaction relayer, bundler or `token.creator()` (which is the factory launcher). A stale source preserves accepted rows and marks the combined list stale. The displayed timestamp is the older source observation. An invalid or duplicate cross-source token/pool fails snapshot validation.

Public Module rows use `sourceKind: "module-native-v1"`, `sourceAddress`, `sourceReleaseDigest`, `recipeHash`, `runtime`, `launchKey`, module package/family IDs and a verification artifact digest. Their `routerAddress` and `stampHash` are explicitly null. The existing Custom metadata overlay refuses Module rows. These rows are never shown as Custom-stamped launches.

## Native identity and program binding

[`provenance.ts`](../../lib/module-mode/provenance.ts) exports the actual ABI and accepts only `programmable.module-mode-evidence.v1`. It checks:

- One successful, block-bound `ModuleNativeLaunched` event and exactly matching `getLaunch(token)` record.
- `launchIdentityVersion() == 1` and the common identity getter's exact `(launchId, launchWallet, token, poolManager, poolId, hook, recipeHash)` fields.
- A distinct `ModuleNativeProgramBound` event linking the same launch to its runtime, launch key and initial program funding.
- A distinct `ModuleNativeConfigurationBound` event with the metadata, creator-configuration and economics commitments used by the immutable launcher.
- A distinct `ModuleNativeTokenIdentityBound` event with the creator salt and graffiti. This removes a debug-trace dependency for smart-wallet launches; no `tx.from` or outer-calldata assumption is needed.
- Every event's exact address, topics, data length, canonical ABI roundtrip, receipt locator and `removed: false` flag.
- The native PoolKey, recomputed PoolId, initialized price and the pinned PoolManager.
- UERC20 name, symbol, 18 decimals, fixed one-billion-token supply, launcher creator, native-token graffiti domain, CREATE2 salt/address and factory prediction. Per-token observed runtime is recorded; constructor immutables mean its hash is not a universal release pin.
- The real native recipe domain, base Creator fees, strictly ordered distinct functional families and complete runtime `Selection` values. There is no legacy effect-kind enum in this generation.
- Runtime program hash and launch key, package/factory/program hashes, exact configuration bytes, per-instance ID and binding hash, immutable family author and reviewed revision manifest.
- The initial funding vector's sum and hash. Program funding is not taken from the Creator fee or the author share.
- The complete set of block-bound runtime bytes for all infrastructure pins, selected factories/programs and the created token.

This engine currently admits at most eight distinct selected module families, with the runtime's configuration and callback-gas budgets enforced. This is a bound on execution inside one trade, not a bound on the contribution catalogue. New engines and other quote assets require their own explicit release adapter; the native adapter does not silently reinterpret a stock pair as ETH.

A revision becoming unavailable for future launches does not erase a historically successful launch. Current author reward-wallet rotation is deliberately separate from immutable family identity. The normalizer does not execute modules, repeat their audit or advertise source verification of every per-token immutable byte. It also does not independently reconstruct the full metadata/economics preimages or re-run LP-lock/lifecycle verification: their onchain commitments come from the authenticated released launcher, and release/source/lifecycle evidence remains separately required.

## Release identity without a proof cycle

[`release.ts`](../../lib/module-mode/release.ts) requires an explicit active, enabled release. The dependency map pins addresses and runtime hashes for:

`launcher`, `hook`, `runtime`, `registry`, `poolManager`, `tokenFactory`, `swapRouter`, `positionManager`, `positionPlanner`, `launchPolicy`, `positionForwarderFactory`, `rewardLedger`, `runtimeFactory`, `budgetVault`, `swapRouterFactory`.

The last factory is required by the native launcher's deployable initcode architecture. No address may be zero, duplicated or missing. Source commit, deployment start block, immutable minimum native initial buy and stable UERC20 creation-code hash are also required.

The exported `computeModuleModeReleaseDigest` computes:

```text
keccak256(UTF8(canonicalJson({
  domain: "programmable.module-mode-release-identity.v1",
  profile: {
    schemaVersion, sourceVersion, chainId, sourceCommit, startBlock,
    minimumInitialBuyNative, tokenCreationCodeHash, finalityPolicy, contracts
  }
})))
```

Canonical JSON sorts object keys, uses exact decimal strings and normalized lowercase addresses/hashes. `bindActiveModuleModeRelease` recomputes this digest. `enabled`, `status`, `releaseDigest` itself and the separate `deploymentEvidenceDigest`, `sourceVerificationDigest`, `lifecycleEvidenceDigest` are outside the immutable identity. A lifecycle proof may therefore bind the release without creating a hash cycle. All three evidence digests remain required and must be independently authenticated by the release authority/collector. A locally consistent profile is not authorization.

The synthetic fixture's golden release digest is `0xd545a5ca686c4e1f381acdc9af54dc71655a8391e24a8a80fabaf01e6ecbc1cb`. It is a test vector, not a deployed release. The contribution API's SHA-256 `requestDigest` remains a separate name/domain and is never substituted for this Keccak release identity.

## Private finalized collector

[`module-source.ts`](../../lib/server/robinhood-index/module-source.ts) defines `ModuleModeFinalizedCollector`. A real server implementation must authenticate the approved release and verify the actual chain data. It must establish complete bounded log discovery, successful receipts, canonical block-bound contract reads, and two independent L2 observations. Rollup finality requires actual NodeInterface batch membership, the corresponding batch posting at the pinned Ethereum SequencerInbox, and a common checkpoint accepted by two independent Ethereum providers. Merely seeing the L2 `finalized` tag is insufficient.

The provenance normalizer checks the internal consistency of those authenticated coordinates, including posting before Ethereum finality, matching block/transaction locators, two distinct provider identities and trust domains for each chain, and the proof artifact digest. It does not authenticate provider labels or the digest by itself. A fabricated but internally consistent JSON object is still fabricated. There is no public endpoint that inserts submitted `verified: true` evidence into the website.

The website uses these private backend operations:

| Operation | POST path | Body beyond `sourceReleaseDigest` |
| --- | --- | --- |
| Authenticate exact active release | `/internal/module-mode-index/v1/release` | None |
| Read verified finalized boundary | `/internal/module-mode-index/v1/boundary` | None |
| Read agreed canonical block | `/internal/module-mode-index/v1/block` | `blockNumber`, canonical decimal string |
| Collect and verify a complete range | `/internal/module-mode-index/v1/range` | `fromBlock`, `toBlock`, canonical decimal strings |

Requests reuse `PROGRAMMABLE_CUSTOM_LAUNCH_API_BASE_URL` and the server-held `PROGRAMMABLE_CUSTOM_LAUNCH_WEBSITE_TOKEN`. Contributor API keys do not grant collector authority. The origin is an HTTPS root URL from trusted server configuration, redirects are errors, and neither a caller-supplied RPC URL nor a free-form release profile is sent to the backend.

Responses use `{schemaVersion: "programmable.module-mode-index.v1", result}`. The release operation must return the complete expected active profile, including separate activation evidence digests. Range results bind the requested release and exact bounds, report actual complete discovery, and contain the full authenticated evidence per launch. The adapter validates those bytes and compares the launch blocks with the collector's canonical block read before returning normalized rows.

Transport uses strict JSON with duplicate-key rejection, bounded response bytes, bounded timeouts and generic errors that do not expose service credentials. The shared cron permits 180 seconds; Module requests share an absolute 165-second job deadline, with at most 90 seconds for an individual range and 15 seconds for other operations. The host must support that execution budget before activation; a timeout cannot bypass a final canonical check. Only an exact HTTP 413 `MODULE_INDEX_RANGE_TOO_WIDE` from a range operation asks the existing synchronizer to split. Pending finality, provider disagreement, 503, missing runtime evidence or a changed release remain failures. They never become an empty successful range.

The backend contract caps one response at 32 launches, 10,000 blocks and 16 MiB. The website snapshot retains its existing 16 MiB/10,000-row resource bound. Those limits do not imply that a million catalogue entries fit one onchain execution or one Blob; a measured storage migration will be needed before those saved-index limits are approached. No records are silently truncated.

## Local checks and activation evidence

The targeted tests cover native identity/reconstruction, every release-identity field, smart-wallet token-salt evidence, altered program/funding/runtime bytes, disabled preview, provider inconsistency, mixed-source profiles, cross-source duplicates, range rejection, reorg isolation, failed-provider retention, shared CAS conflicts and private transport/auth boundaries. Fixtures are synthetic and perform no broadcasts.

A live release still requires actual deployable reviewed contracts and exact runtime/source pins, funded deployment transactions, authenticated source and lifecycle artifacts, deployment/configuration of the real private collector, one genuinely finalized Module Mode launch, a successful durable checkpoint write, and the same coin visible from the public Profile and Explore endpoints. A successful website build or HTTP adapter test proves none of those external facts by itself.
