# Publish a reviewed Module Mode package

This operator is the common path for starter and community modules on the native Robinhood engine.
It accepts a package identity and reviewed artifacts; there is no dispatch by module name. Contributors
submit through the public module API with their authenticated EVM author and reward wallets. They do
not need a GitHub repository or a pull request. Publication is a separate operator responsibility.

The three commands are `manifest`, `prepare` and `export`. They never sign, send a transaction,
publish a website or change the catalogue. `export` writes a reviewable local publication only after
real Registry, contract-code, transaction and receipt checks pass on both reviewed RPC providers.
The separate `correct-source` command records a bounded administrator correction as a new submission.
It preserves the original source and attribution and starts a new review; it does not approve or publish.

## Correct a submitted source package

An authenticated administrator can apply a prepared small source correction without using the
contributor's API key. Use the existing session-file workflow below. This command accepts source-byte
edits, not a replacement author, reward wallet, family or review result. It only supports an original
author submission; an existing platform correction cannot be corrected again through this version.

```sh
node ops/module-mode-publication/operator.mjs correct-source \
  --submission 00000000-0000-4000-8000-000000000001 \
  --correction-file /private/operator/correction.json \
  --session-file /private/operator/session.json \
  --output /private/operator/correction-run
```

The correction file contains exactly:

```json
{
  "schemaVersion": "programmable.modules.source-correction.v1",
  "expectedReviewRevision": 0,
  "requestDigest": "0x…",
  "version": "0.1.1-pm.1",
  "reason": "Explain the concrete defect and the bounded correction.",
  "idempotencyKey": "unique-correction-key-0001",
  "files": [
    {
      "path": "src/Example.sol",
      "expectedSha256": "original lowercase SHA-256 without 0x",
      "sha256": "corrected lowercase SHA-256 without 0x",
      "edits": [
        { "offset": 0, "deleteBytes": 0, "insertBase64": "Ly8gRXhhbXBsZQo=" }
      ]
    }
  ]
}
```

All identifiers, hashes, offsets and source in that example are placeholders. Prepare the command
against the live parent request and its current review revision. Offsets count bytes in each original
file. Edits must be sorted and must not overlap. A new file uses `expectedSha256: null` and one
insertion at offset zero. Existing files are never deleted. The complete command is limited to
262,144 bytes, 16 changed files, 64 edits per file, 256 edits in total and 128 KiB of inserted bytes.
The reason is trimmed text of 10 to 4,096 UTF-8 bytes; the idempotency key is 16 to 128 characters
from `A-Za-z0-9._:-`. The platform version ends in `-pm.` followed by a positive integer.

The backend reconstructs immutable source, changes only the descriptor version and source-file
hashes, removes the old Git revision claim, and sets `supersedesSubmissionId` to the original submission.
It records the actual authenticated editor, reason, parent identity, policy and correction digest
separately. The author's principal, author wallet, reward wallet, family and all other descriptor
fields remain unchanged. The parent must be unapproved, have no active build and belong to an author
other than the correcting administrator. The new submission starts at `awaiting_plan`; previous build or approval
results are not inherited. Admin detail exposes the verified `sourceCorrection` record.

Before POST, the operator writes a private command and intent journal. It sends the command once,
then verifies the stored receipt and newly fetched source, including every unchanged file and the
original attribution. If a response is lost, it queries the receipt with the same idempotency key.
Run the identical command with the same output directory to reconcile an interrupted run. An existing
journal permits reads only; it never automatically sends another POST. Keep the original key and
command while the outcome is unresolved. A missing `correction.complete.json` means verification is
incomplete. A successful correction still needs a protected build, review, Registry admission and
catalog publication through the normal process.

## Inputs and authority

- `--identity`: the actual immutable Module Mode release identity, including its canonical digest and
  fifteen contract pins. Obtain it from the base deployment operator; do not fill it with preview IDs.
- `--definition`: the complete native catalogue definition without `status` or `nativeBinding`.
  It includes source path/hash, schema, defaults, input units, program ABI, management manifest,
  requirements, constraints and engine profile. These are covered by the host-manifest hash.
  `programAbi` must exactly equal the tested plan and build artifact. Both declare
  `configurationCodec: "programmable.native-abi@1"`; no alphabetically ordered generic encoding
  is silently substituted for the program's reviewed argument order.
- `--fee-eligibility`: required only for a `module-native-v2` identity. Supply a JSON file containing
  exactly `{ "eligible": true, "reviewDigest": "0x…" }`, using the actual family review digest.
  The reviewer chooses this tuple before manifest acceptance. The complete manifest hash covers it;
  `prepare` and `export` require the same accepted value. The operator creates no eligibility or digest
  default. NativeV1 and Engine publication reject this option.
- `--submission`: the UUID returned by module submission.
- `--session-file`: an existing administrator's Privy session in a local owner-only regular file:
  `{ "walletAddress": "0x…", "accessToken": "…", "identityToken": "…" }`.
  `identityToken` is optional. Never put session tokens in commands, source control or messages.
  A contributor API key cannot approve or publish a module.
- `--output`: a new directory under an existing private `0700` parent outside the repository.
  The operator never overwrites an earlier result.

Use the normal wallet login at `https://programmable.market/admin/modules`. With the authenticated
admin wallet connected, select **Download publication session**. The explicit action downloads
`module-publication-session.json` in the format above using the current wallet session. A session
change during token retrieval cancels the download. This file contains login tokens; keep it outside
the repository, do not share it, and delete it when finished. Browsers cannot set the operator's
required owner-only filesystem permissions. Move the download into your existing private operator
directory and run `chmod 600 /private/operator/module-publication-session.json` before passing that
path to `--session-file`. Use your actual local path. If the session expires, reconnect normally and
download a fresh file. The download grants no additional role, accepts no review, and signs no transaction.

The fixed-origin website BFF `/api/admin/modules/<id>` and `/source` authenticate the current session,
bind its linked wallet and use the existing signed BFF-v2 request to the private review API. The backend
enforces its reviewer allowlist. Source and accepted decisions come from this live read on every run.
A caller-provided local `review.json`, a hash, a source upload or a passing compilation does not grant
reviewer authority. The operator checks a completed protected worker attempt, exact source/request,
package/family/reward identity, the native compiler pins, complete source input, ABI/code hashes and
the current review revision. It repeats the detail read to reject a concurrent review transition.

Worker provenance follows the existing append-only backend events. `claimed` contains the worker
identity; `completed` contains the artifact digest and has no worker identity. Completion is stored
only after the backend matches the live lease, attempt, request, plan and worker-identity hash under a
row lock. The reader requires one claim and one successful completion for the **current job attempt**,
matching its request, plan and artifact. It verifies the claim's worker digest using the backend domain
`programmable.modules.worker-identity.v1` and retains the protected-workflow pin. It rejects competing,
duplicated, expired, failed or mismatched current-attempt records, inconsistent event times, and rows
that violate the API's `attempt DESC,event` order. Older attempts may belong to other plans or workers;
they never substitute for the current pair. The closing authenticated read must return the same event
history as well as the same job and decisions.

These event and digest semantics are defined in backend commit
`55cd1e5f99503d3f2e79182eff143201db6ae34e`,
`services/custom-launch-api-v1/src/module-review/postgres-v1.ts` (`claim`, `complete`, `attempts`).
The reader does not reconstruct a lease or accept local event JSON as worker or reviewer authority.

Compiler constants in `review.ts` match backend `src/module-review/native-build-v1.ts`,
`src/verification/types-v4.ts` and `src/verification/protected-hosted-build-producer-v4.ts` from backend
commit `caff9019`. This is the native profile, not permission to introduce another compiler or mutable
dependency. Its exact build artifact remains an authenticated private-review output.

## 1. Construct the manifest for review

After the protected build reaches `built`, run:

```sh
node ops/module-mode-publication/operator.mjs manifest \
  --identity /private/operator/release-identity.json \
  --definition /private/operator/module-definition.json \
  --submission 00000000-0000-4000-8000-000000000001 \
  --session-file /private/operator/session.json \
  --output /private/operator/manifest-run
```

The paths and UUID above are placeholders. `manifest.json` is the exact input for the website review
console. The factory address is derived with CREATE2 from the canonical deployer, reviewed factory
creation bytes, package ID and release digest. There is no constructor-argument guess or factory-name
allowlist. The protected native profile supports factories with no constructor parameters. A different
runtime profile requires its own versioned build/host adapter.

The reviewer checks the entire configuration range, external dependencies, callback behavior, budgets,
management roles and composition. The review command must accept this exact artifact and manifest.
The operator neither generates that decision nor signs on behalf of the reviewer.

## 2. Prepare the onchain operations

Run the same arguments with `prepare` and a new output directory. This requires the current state
`accepted`, the last append-only decision, and `expectedReviewRevision + 1 == reviewRevision`.
The operator reads all base code pins and the Registry owner through the existing reviewed provider
commitment mechanism. Use the same protected RPC environment/custody records as the base deployment
operator; it never prints endpoints or credentials.

`unsigned-plan.json` contains decoded operations and exact targets, values and calldata:

1. Deploy the package factory through the canonical CREATE2 deployer, if its address is vacant.
2. Bind the API-authenticated author and reward wallet using `registerReviewedFamily`, if the family
   is absent. For an existing family, verify its author and current reward wallet; do not overwrite it.
3. Admit the immutable package revision with its factory/code/manifest/callback pins.

NativeV2 inserts `setFamilyFeeEligibility(familyId, eligible, reviewDigest)` between family registration
and revision admission when the reviewed digest is nonzero. The call uses the existing Registry owner,
zero ETH value and exactly the eligibility covered by the accepted manifest. It cannot choose fee rates.
The explicit `false`/zero-digest tuple retains the untouched RegistryV2 default without a setter call;
the contract rejects zero digests in that setter. An explicit `false` with a nonzero review digest is
recorded as reviewed ineligibility. Reuse an existing exact family review instead of overwriting it.
The owner-plan command in `contracts/scripts/module-mode/publication-plan.mjs` derives the same tuple
from the accepted manifest, checks the default before a new eligibility write, and checks the exact
getter before and after revision admission.

These are unsigned operation templates, not armed wallet requests. Simulate each operation immediately
before signing, check the connected wallet and chain, and inspect the actual gas quote. Do not replay a
transaction whose submission outcome is unknown. An existing revision is never overwritten or
automatically re-enabled. Factory deployment may be reused only with its actual matching transaction
and receipt. Registry mutations require the actual current Registry owner.

## 3. Verify and export

Create a private transaction file with the actual hashes:

```json
{ "factory": "0x…", "family": "0x…", "revision": "0x…" }
```

Use `family: null` only when the family already existed with the exact author and current reward wallet.
For NativeV2, the transaction file also requires `feeEligibility`: the actual setter transaction hash,
or `null` for an existing exact review or the untouched false/zero default. Export always checks the
current `familyFeeEligibility` getter on both providers. A supplied setter hash must match the exact
owner, calldata, canonical successful receipt and `FamilyFeeEligibilityReviewed` event. A changed
eligibility or review digest stops export. NativeV1 retains its original three transaction fields.
Run the same command with `export`, a new output directory, and
`--transactions /private/operator/transactions.json`.

Two independent, commitment-bound providers must agree on chain 4663, a recent common block, every
base runtime pin, canonical CREATE2 code, current Registry authority, factory code, author/reward
wallet, enabled immutable revision, exact operation calldata, successful receipts, canonical block
membership and the `RevisionApproved` event. The reader checks the snapshot again for a reorganization.
The accepted review is fetched again after the onchain checks. Changed records stop the export.

Successful output contains:

- `public/developers/modules/<packageId>/{source,manifest,review}.json`, with original source bytes and
  the exact historical accepted decision; its historical `available: false` flags remain unchanged.
- `catalog-fragment.json`, to merge deliberately into the protected canonical catalogue without
  dropping other entries.
- `publication-evidence.json`, the actual canonical inclusion/code/Registry readback.
- `export.complete.json`, written last. Without it the run is incomplete.

This readback proves canonical L2 inclusion; it does not substitute for the separate Robinhood-to-
Ethereum finality proof, base deployment/source/lifecycle gates or publication approval. The output
explicitly records these limits. The integration owner checks those release requirements, reviews the
source-publication decision, copies the immutable files and catalogue entry into a protected
`production` pull request, passes CI, deploys, and checks the public `/api/module-mode` response.
No command copies files into the live catalogue or enables a preview release automatically.

## Validation

```sh
npx vitest run tests/module-mode-publication.test.ts
npx eslint ops/module-mode-publication tests/module-mode-publication.test.ts
npx tsc --noEmit
```

The tests use explicitly synthetic source, review and RPC fixtures. They are never deployment or
approval evidence. The CLI bundles repository-owned TypeScript with the package-lock-pinned esbuild;
submitted Solidity is treated only as data and is never executed by this publication process.

## Executable Engine profile

The same `manifest`, `prepare`, and `export` commands also handle an authenticated
`programmable.modules.engine-build.v1` result. NativeV1 publication keeps its existing
wire, compiler profile, command arguments, session handling and registry calls.
There is no additional intake, publisher identity, or source-selected host command.

For an Engine submission, `--identity` contains the installed
`programmable.module-engine.release.v1` identity from `lib/module-engine/catalog.ts`.
`--definition` contains exactly:

```json
{
  "profile": "programmable.module-engine-solidity@1",
  "catalogDefinition": { "...": "ModuleEngineCatalogDefinition" },
  "revision": { "...": "ModuleEngineRevisionDefinition" }
}
```

The versioned types define the complete fields. The revision binds the source package
and family, fixed quote/configuration restrictions, initial operation, execution gas,
money/coin rights, operation permissions and sorted fee families. Code, compiler,
source closure and immutable runtime-to-constructor mappings come from the protected
build. They are never accepted as a separate operator override. Fixed configuration
and quote restrictions must select a successful reviewed instance with the same
`fixedConfigurationHash(launchId)` behavior: fixed revisions require a case with
`fixedConfiguration: true` and the exact configuration hash; general revisions require
a case with that flag absent or false. Initial operations must succeed in a matching
case. Named tuple configuration uses the shared Engine encoder; Native ABI bytes are
unchanged. Quote presentation
requires a fixed reviewed configuration for its external dependencies.

`manifest` prepares the exact Engine Host manifest for independent review. The existing
private review BFF accepts this profile only against an installed `engineReleaseIdentity`;
an identity supplied inside the manifest does not grant authority. Source author and
reviewer remain distinct. No publisher command records acceptance.

After the current independent acceptance, `prepare` returns exact zero-value calls for
`registry.registerReviewedFamily(...)` and `host.approveRevision(...)`. The latter carries
the revision, complete immutable offsets, constructor word offsets, operation permissions
and fee families. The registry owner's address is read from two independent reviewed RPC
providers; host, ledger and registry relationships and all release code pins must match.
The family call is needed only when the family is absent. Existing author and current
reward wallet must match. An immutable revision must never be overwritten or automatically
re-enabled. Each applicable call still needs simulation immediately before owner signing.

Engine `--transactions` for `export` has exactly `family` (hash or null) and `revision`
(hash). There is no Engine factory deployment transaction: the Host deploys each Engine
instance during its own launch using its exact constructor and runtime patches. Export
checks the included owner transaction and exact `EngineRevisionApproved` event, current
revision, all permissions, both offset arrays and fee families on both providers. It also
re-reads the authenticated review to reject concurrent changes.

`catalog-preparation.json` and the export receipt keep `available: false`. The local
source/manifest/review files become inputs to protected publication review. Canonical
inclusion does not prove Robinhood's Ethereum finality, install the source, publish a
website or make an Engine template available. Those remain separate release proofs.

Each Engine command also writes private `review-build.json` containing exactly
`{subject,plan,artifact}` from the same authenticated snapshot. Protected catalogue
ingestion uses this file to reconstruct the complete compiler/test receipt against
the source request. It is never copied into `public/developers/modules`, and the
public availability response must not return it. The manifest's compact source
subset alone cannot reconstruct the full build artifact digest.
