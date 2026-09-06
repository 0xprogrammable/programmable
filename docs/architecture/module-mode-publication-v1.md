# Module Mode publication and availability v1

The public builder reads `GET /api/module-mode`. It does not enumerate private module submissions.
The canonical, protected repository explicitly authorizes publication through
`config/module-mode/catalog.json`. This file initially contains no entries. A source upload, passing
tests, a syntactically valid review hash and an onchain registry admission are different facts.

## Public response and activation

The exact shared DTO lives in `lib/module-mode/native-catalog.ts`:

```ts
{
  schemaVersion: "programmable.module-mode.availability.v1",
  release: ModuleModeRelease | null,
  catalog: ModuleModeCatalogEntry[],
  reason: string | null
}
```

`config/module-mode/robinhood.preview.json` remains the only release configuration. Its committed
disabled preview produces preview cards and `release: null`. Environment variables cannot activate
that profile. An active profile must pass `bindActiveModuleModeRelease` and the existing private
collector's `authenticateRelease`. The collector returns and authenticates the complete release,
including the three distinct activation evidence digests. A mismatch or an unavailable collector
produces a generic unavailable response with no active release or module bindings. Neither public
artifact hashes nor a cached earlier success replace that authentication.

A verified engine may expose an empty catalogue and allow a plain coin before the first reviewed
module exists. A nonempty catalogue must bind its exact `sourceReleaseDigest`. Entries have unique
public IDs and package IDs. Native clients additionally re-read registry revision/enabled status and
contract code before simulation. The availability API's expected registry pins are not a claim that
it independently repeated the client's onchain checks or a new finalized launch observation.

## Immutable publication files

The canonical publisher consciously releases the reviewed source package and exact decision at:

```text
https://programmable.market/developers/modules/<lowercase-0x-packageId>/source.json
https://programmable.market/developers/modules/<lowercase-0x-packageId>/manifest.json
https://programmable.market/developers/modules/<lowercase-0x-packageId>/review.json
```

These paths are computed from the validated package ID. No caller supplies a URL, origin, credential,
remote component or executable website code. HTTPS redirects are rejected. Packages remain private
until the authorized operator intentionally adds their immutable publication and catalogue entry.
Authors do not need a GitHub repository. Once published, these versioned artifacts must not be
overwritten with another version; a new submission/package/review is required.

`source.json` is exactly the existing SDK `ModuleSubmissionRequest`:

```ts
{
  format: "programmable.modules.submission.v0.1",
  descriptor: OpenSourcePackage,
  files: Array<{ path: string; sha256: string; encoding: "base64"; bytes: string }>,
  supersedesSubmissionId?: string
}
```

The shared `validateModuleSubmissionRequest` checks the full file set, canonical base64, every actual
source-byte SHA256, the descriptor, author/family identity and package/request identities. The
request digest remains the SDK's domain-separated SHA256, not the host's Keccak. The descriptor's
existing `programmable.classic.source-package.v0.1` format is preserved; its name is not proof of a
legacy engine. Host construction requires the public entry's source path/hash to identify an actual
component file, and its configuration, constraints and version to match this exact package.

## Host manifest identity

`createModuleModeHostManifest` and `computeModuleModeHostManifestHash` in
`lib/server/module-mode/catalog.ts` are the canonical operator helpers. The whole published
`manifest.json` envelope is:

```ts
{
  domain: "programmable.module-mode.host-manifest.v1",
  manifest: {
    sourcePackageId,
    configuration: { schema, abiMapping },
    management,
    requiresHost,
    runtimeBinding: {
      sourceReleaseDigest,
      registry: { address, runtimeCodeHash },
      engine: { id, version },
      familyId, packageId, factory, factoryCodeHash, moduleCodeHash, callbackGas
    },
    catalogDefinition
  }
}
```

`catalogDefinition` is the complete public native entry with only `status` and `nativeBinding`
removed. It therefore binds default values, input units/multipliers, constraints, source presentation,
management data and any future additional entry fields. Repeated schema/ABI/management fields must
match exactly. `catalogDefinition.requiresHost` is mandatory and equals the source descriptor's
requirements; the shared native DTO rejects requirements absent from `MODULE_NATIVE_HOST_CAPABILITIES`.
The management object passes `bindModuleManagementManifest`, whose capabilities,
reads, action encoding and roles are inert reviewed data. Reference catalogue generation may call
`referenceManagementManifest("reward" | "cap")`; runtime UI must not dispatch by those reference names.
Unsupported management capabilities also prevent publication availability.

The formula is:

```text
Registry.manifestHash = keccak256(UTF8(canonicalJson(the complete manifest.json envelope)))
```

Canonical JSON sorts object keys by JavaScript UTF-16 ordering, preserves array order, emits no
whitespace, uses JSON string/boolean/null encoding and safe integral JSON numbers. Inputs must be
bounded inert JSON; duplicate keys in published files, invalid Unicode, custom object prototypes,
accessors and non-JSON values are rejected. Wei and other large integers stay decimal strings.

The `runtimeBinding` deliberately excludes `manifestHash` and `reviewDigest`. The input to the
constructor is an immutable deployment identity plus the definition and six runtime pins. The
constructor checks `computeModuleModeReleaseDigest`, but needs no lifecycle, active status or review
dummy. This permits manifest construction before review and activation without a hash or proof cycle.
The publication verifier accepts the same immutable identity. The public API separately requires the
fully authenticated active release.

## Review identity and authority

`review.json` is the **exact append-only record read from the private review database**, not a newly
constructed substitute. The shared format is `programmable.modules.review-decision.v1`. Its subject
binds the submission UUID, API principal UUID, authenticated author and request digest. Its command
binds the expected review revision, outcome, reviewer explanation, build `artifactDigest`, this
`hostManifestHash` and acknowledged review areas. The record also contains the reviewer wallet,
policy digest and decision timestamp.

```text
nativeBinding.reviewDigest = decision.decisionDigest
decisionDigest = 0xSHA256(UTF8(canonicalJson({
  domain: "programmable.modules.review-decision.v1",
  value: <exact record with decisionDigest omitted>
})))
```

Acceptance requires nonzero artifact/host-manifest digests. Its immutable historical
`registryApproved: false` and `available: false` fields remain false after later admission; changing
them would change the decision and misrepresent what the review established. The source author,
request digest, host-manifest digest and public entry's review digest must all match.

There is no invented cryptographic reviewer signature. Reviewer authority comes from the existing
private BFF-v2 authenticated write, reviewer-wallet allowlist, self-review prohibition and append-only
storage. The authorized publication operator must read that actual record and review/publish the
matching source. A valid public JSON hash alone grants no reviewer authority. The protected repository
catalogue copies the exact decision; the public response verifies that the published record equals it.

The validator/digest source is byte-for-byte vendored at
`lib/server/module-mode/review-decision-wire-v1.ts` from backend commit `9da1149a6c3dd14cba31bf9960347d59f738f438`, path
`services/custom-launch-api-v1/src/module-review/decision-wire-v1.ts`.
Its SHA256 is `4e76fcfc334d6ab0b6ad9754ec297ce6df6fd02dacb30f47aa6acf6e6eb520be`.
This provenance belongs here, outside the unchanged source bytes. Updating that wire requires a new
explicit backend-source comparison; do not locally fork its digest or claim its predicate checks auth.

## Catalogue entry and release sequence

The exact file is:

```ts
{
  schemaVersion: "programmable.module-mode.catalog.v1",
  sourceReleaseDigest: null | Hex,
  entries: Array<{
    entry: NativeModuleModeCatalogEntry,
    requestDigest: Hex,
    review: ModuleReviewDecisionRecordV1
  }>
}
```

1. Pack real author-owned source and EVM reward wallet through the existing SDK/API submission path.
2. Reproduce the actual build, runtime pins, configuration ABI and host/management requirements.
3. Bind real deployment identity and the final package into `createModuleModeHostManifest`.
4. Perform the private review against that exact source/request, artifact and host-manifest hash.
5. Read the accepted append-only decision. Create the native entry with its exact two digests.
6. Verify all three intended publication objects with `verifyModuleModePublication`, admit the matching
   registry revision under the actual operator authority, and deliberately publish the immutable files.
7. Add the matching catalogue entry through the protected canonical repository. Activate only after
   deployment/source/lifecycle/finality requirements have independently passed. The API verifies real
   publication bytes and collector authentication before exposing an active entry.

Registry current enabled state, configuration compatibility and target code are checked again before
a wallet simulation. No catalogue entry turns an unsupported host capability into an implementation.
An API review is not an automatic registry transaction or automatic public source publication.

## Budgets, caching and test vectors

Each availability sample has an eight-second budget. The public HTTP response is `no-store`; the
server deduplicates concurrent reads and caches availability for ten seconds, unavailability for two.
Validated immutable publications may be reused for five minutes only under a key containing the
complete release activation, whole-entry digest, source request digest and exact review record.
Release authentication runs again after the ten-second availability TTL even when publication bytes
are cached. An auth failure never serves an old active result.

There are at most two concurrent package verifications (four small manifest/review requests).
Two maximum-size packages fit the aggregate byte budget, so cold verification can make progress.
Each source request retains the SDK's
24 MiB encoded/16 MiB decoded package bounds; manifest and review bounds are 2 MiB and 64 KiB.
A sample reads at most 64 MiB of remote bytes. A failed or oversized sample is unavailable, never an
empty success. Earlier immutable successes can warm subsequent bounded samples. The v1 DTO has a
1,000-entry response bound; a larger future catalogue needs versioned pagination/search rather than
unbounded JSON or concurrent network calls. These are resource budgets, not arbitrary module kinds.

`tests/module-mode-catalog.test.ts` contains fully specified synthetic fixtures, never release evidence.
Its fixed host-manifest golden vector is
`0xb50de16a7c50e3717b3468d45a53d87d07050ad2dd20e7cab1e9e06d25432fce`.
The corresponding shared review-decision vector is
`0xfc4ecf32ceaa9bb1e0bf13960b0bf26c14a0381b3483819fed297d681073cad5`.
Mutation cases cover source identity, schema/ABI, management, host requirements, release/registry/code
pins, callback budget and UI units/defaults. Additional tests cover altered source bytes, mismatched
review records, no GitHub requirement, disabled previews, plain launches, missing private auth,
immutable cache binding, auth failure after success, missing files, redirects, duplicate JSON,
oversized/invalid response bodies, timeouts and the public read-only route.
