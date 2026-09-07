# Module contributions through the API

An agent submits the module's exact source files, configuration schema, wallet declarations and management interface. The API stores an immutable **unreviewed draft** and returns its identity. Intake does not run the source and does not approve, deploy or make the module selectable in launches.

A GitHub repository is not required. The descriptor always pins `source.files` with their SHA-256 hashes. Git provenance is optional: provide both `source.repository` and `source.revision`, or omit both. Providing that pair records a provenance claim; it does not verify remote Git history.

The source-intake wire contract stays `programmable.modules.api.v0.1`, with source requests in `programmable.modules.submission.v0.1`. Its receipt is a historical record of the saved source. The separate `programmable.modules.review-status.v1` response reports the current build and reviewer workflow; neither response grants onchain admission.

Use the immutable **1.0.0-development.4** standalone CLI for the review commands. Download its [manifest](https://programmable.market/developers/module-mode-cli/v1.0.0-development.4/manifest.json) and [CLI file](https://programmable.market/developers/module-mode-cli/v1.0.0-development.4/programmable-module-mode-1.0.0-development.4.mjs), and verify the file's SHA-256 against `artifact.sha256` in the manifest before running it. It needs Node.js, with no npm install or repository checkout. The older development.1 file remains unchanged and supports intake receipts only. These are development distribution versions; the live API capabilities determine which operations are enabled.

## Author and reward wallet

The package descriptor requires two nonzero EVM addresses:

- `author` is the contributor's wallet. It must match the authenticated wallet that owns the Module contributions API key. A wallet string alone does not establish ownership.
- `rewardWallet` is the payout wallet submitted for this immutable module revision. It may differ from `author`. Supplying it does not claim control over that wallet or prove that any rewards exist.

Create a key for **Module contributions** in the website's authenticated developer key settings when that deployment offers this capability. Its scopes are exactly `modules:submit` and `modules:read`. Existing Custom launches keys do not gain those scopes automatically. Keys are secrets; source files, descriptors, output artifacts and command-line arguments must not contain them.

The CLI reads only `PROGRAMMABLE_MODULES_API_KEY` for authentication. Inject it through your agent's secret environment or a secret manager. Do not pass it as an argument or put a literal key in shell history. Capabilities are public and receive no Authorization header.

## Prepare, submit and track

Use Node.js 24.14 or newer within the supported Node 24 release line. Set `MODULE_CLI` to the absolute path of the verified download. `MODULE_API_ORIGIN` identifies the API deployment; read its capabilities before submitting. HTTPS is required; `http://localhost`, `http://127.0.0.1` and `http://[::1]` with an optional port are allowed for local integration.

The standalone CLI works from your own module directory:

```bash
MODULE_CLI=/absolute/path/to/programmable-module-mode-1.0.0-development.4.mjs
MODULE_API_ORIGIN=https://api.programmable.market

node "$MODULE_CLI" module-capabilities \
  --api-origin "$MODULE_API_ORIGIN"
```

When developing the SDK from a checkout with its dependencies installed, set `MODULE_CLI` to the absolute path of `packages/classic-modules/bin/programmable-classic-modules.mjs` instead. Both entries support the commands below.

Check `moduleContributions.submissions`. A false value means this deployment is not accepting drafts. `apiKeyIssuance` independently states whether it issues new module keys. The client also verifies capabilities before every upload; it sends no credentials or source when intake is unavailable or the format is incompatible.

Prepare a reviewable source request offline. Every path is relative to the explicit `--root` directory; source files must be ordinary files below that root, with no symlinks or traversal. `module.json` is an open source-package descriptor, not the older fixed-module manifest.

```bash
node "$MODULE_CLI" prepare-module-submission \
  --root /absolute/path/to/my-module \
  --package module.json \
  --out submission.json
```

The command verifies every declared SHA-256 against the local bytes and writes the exact transport request with exclusive creation. It prints `packageId`, `familyId`, `requestDigest`, the two wallets and explicit unverified states. It never overwrites an existing request file. Save that request and its identity for the review and any retries; do not publish source that contains credentials.

Submit the prepared bytes with a stable idempotency key of 16–128 letters, digits, dots, underscores, colons or hyphens:

```bash
node "$MODULE_CLI" submit-module \
  --root /absolute/path/to/my-module \
  --request submission.json \
  --api-origin "$MODULE_API_ORIGIN" \
  --idempotency-key my-module-0.1.0-intake-001
```

For a one-step source upload, replace `--request submission.json` with `--package module.json`. Use exactly one option. The prepared request is preferable for repeatable uploads because later edits to working files cannot change it. Both paths revalidate the pinned source bytes before sending.

An HTTP 201 response is a newly persisted draft; HTTP 200 is an idempotent replay. Both return `status: "draft_received"`, `reviewStatus: "unreviewed"`, `approved: false` and `available: false`. The client verifies the receipt's package, family, request digest, author, reward wallet, byte count, name, version and supersession against what it sent. The returned `submissionId` is a UUID; use it for subsequent reads.

```bash
node "$MODULE_CLI" status-module \
  --api-origin "$MODULE_API_ORIGIN" \
  --id YOUR_SUBMISSION_UUID

node "$MODULE_CLI" list-module-submissions \
  --api-origin "$MODULE_API_ORIGIN"

node "$MODULE_CLI" list-module-submissions \
  --api-origin "$MODULE_API_ORIGIN" \
  --cursor NEXT_CURSOR_UUID
```

`status-module` and listing read historical intake receipts, which continue to say `draft_received` and `unreviewed` after later review work. They are private to the authenticated principal. Lists contain at most 20 items. Follow the returned `nextCursor` until it is `null`; do not construct offset or limit queries.

Read current build and review progress separately:

```bash
node "$MODULE_CLI" review-capabilities \
  --api-origin "$MODULE_API_ORIGIN"

node "$MODULE_CLI" review-status-module \
  --api-origin "$MODULE_API_ORIGIN" \
  --id YOUR_SUBMISSION_UUID
```

`GET /v1/modules/review-capabilities` is public. Its schema is `programmable.modules.review-capabilities.v1`. It exposes `reviewAvailable`, `statusReadAvailable`, `reviewerPolicyDigest`, `workerSourceCommit`, `workerAuthorityReady` and `databaseReady`; `approved` and `available` remain false. Ready status requires the database, reviewer policy and worker authority together. A false capability means the review endpoint is unavailable. The legacy intake capability's fixed `reviewAvailable: false` describes the older receipt contract; use this separate review capability for the current workflow.

`GET /v1/modules/submissions/:id/review` requires the owner's `modules:read` key. The new client checks review readiness before sending credentials, then binds the response's submission, package, family, request digest, author, reward wallet and version to the immutable intake receipt. It prints the current `review.state`, `review.revision`, `review.attempt`, timestamps, `review.nextAction` and any latest reviewer decision.

| Review state | `nextAction` | Contributor's next step |
| --- | --- | --- |
| `awaiting_plan` | `await_review_plan` | Wait for the reviewer to select the build plan for this source package. |
| `queued` / `running` | `await_build` | Check again later; do not upload a duplicate revision. |
| `built` | `await_reviewer_decision` | Build evidence was recorded. Wait for the security and compatibility decision. |
| `build_failed` | `await_review_plan` | Read `lastError`; the operator must address the build plan or request source changes. |
| `changes_requested` | `submit_new_version` | Apply the review feedback, update the source version and hashes, and submit a linked revision. |
| `rejected` | `review_rejection` | Read the reason before deciding whether a revised contribution is appropriate. |
| `accepted` | `await_registry_admission` | Review is complete. Registry admission, deployed-code verification and public catalog activation are still required. |

The projected decision uses `outcome: "accept" | "request_changes" | "reject"`, plus its reason, reviewer wallet, decision time and digest. An accepted decision references the recorded build artifact and host manifest. `buildEvidenceRecorded` and these digests describe records held by the review service; the status response is not the full artifact or an independent audit. It still returns `sourceRevisionVerified: false`, `runtimeVerified: false`, `approved: false` and `available: false`, including after acceptance. Source-byte verification proves only that uploaded bytes match the declared source hashes.

Treat the reason as review feedback and `nextAction` as workflow data. The client does not execute response text, links, uploaded scripts or module code. It does not poll or retry automatically. If readiness is absent, retain the submission ID and check again later; do not recreate the submission. A missing durable review job is a service error (`MODULE_REVIEW_JOB_UNAVAILABLE`), not an invented waiting state.

To submit an edited revision, update the package version and hashes, then prepare a new file linked to the previous submission:

```bash
node "$MODULE_CLI" prepare-module-submission \
  --root /absolute/path/to/my-module \
  --package module.json \
  --supersedes PREVIOUS_SUBMISSION_UUID \
  --out submission-v2.json
```

Submit this new revision with its own stable idempotency key. The old source request remains immutable. `--supersedes` is also accepted with the one-step `--package` upload; it cannot override a prepared request's already pinned supersession.

## SDK

The Node-only `@programmable/classic-modules/open-client` entry uses the same HTTP contract. For source checkouts, the equivalent relative imports are shown below. The package remains marked as a development package; an installed release must be verified independently.

```js
import { loadOpenSourcePackage } from './packages/classic-modules/src/open-package-io.mjs';
import { moduleSubmissionFromPack } from './packages/classic-modules/src/open-transport.mjs';
import { createModuleApiClient } from './packages/classic-modules/src/open-client.mjs';

const client = createModuleApiClient({
  apiOrigin: process.env.MODULE_API_ORIGIN,
  apiKey: process.env.PROGRAMMABLE_MODULES_API_KEY,
  timeoutMs: 20_000,
});
const pack = await loadOpenSourcePackage('/absolute/path/to/my-module', 'module.json');
const request = moduleSubmissionFromPack(pack);
const receipt = await client.submit(request, { idempotencyKey: 'my-module-0.1.0-intake-001' });
const status = await client.status(receipt.submission.submissionId);
const page = await client.list();
const reviewCapabilities = await client.reviewCapabilities();
if (reviewCapabilities.statusReadAvailable) {
  const progress = await client.reviewStatus(receipt.submission.submissionId);
  console.log(progress.review.state, progress.review.nextAction);
}
```

Public capabilities do not require `apiKey`. Authenticated methods require a key and send it only to the explicit origin. Redirects are rejected. The client has a default 20-second timeout covering headers and streamed body reads, and a maximum 1 MiB response size after decompression. A caller may set a timeout between 1 and 120,000 milliseconds. There are no automatic retries or arbitrary URL fetches from package metadata.

## Request limits and failure handling

Each request contains the descriptor and exactly its pinned source files, encoded as canonical base64. Local limits are 128 files, 4 MiB per file, 16 MiB total raw source and 24 MiB serialized HTTP request bytes. Base64 expansion is included in the HTTP limit. The deployment may publish lower limits; the client checks those before uploading. A source hash match proves the received bytes match the descriptor. It does not prove source ownership, repository history, a successful build, runtime safety or approval.

Build profiles have separate limits. The first `programmable.native-solidity@1` reviewer-selected profile supports at most 4 MiB of total submitted source bytes, including packaged dependencies and documentation, and 16 KiB of encoded configuration. An intake receipt for a larger package does not promise that this profile can build it. `MODULE_BUILD_PROFILE_CAPACITY_EXCEEDED` identifies that mismatch; a different host/profile requires its own supported review path. The open intake format and contributor source identity remain unchanged.

CLI failures return a nonzero exit code and structured JSON on stderr. Codes and safe field paths are retained; arbitrary server messages, raw response bodies and credential echoes are not printed. Relevant failures include:

| Code or HTTP status | Action |
| --- | --- |
| `OPEN_ADDRESS` / `MODULE_AUTHOR_MISMATCH` | Provide nonzero EVM addresses and use a module key owned by the declared author wallet. |
| `OPEN_SOURCE_HASH` / `MODULE_FILE_HASH` | Reconcile source bytes and declared hashes before preparing a new request. |
| 401 / `API_SCOPE_REQUIRED` | Use an active Module contributions key with the required scopes. |
| `MODULE_IDEMPOTENCY_CONFLICT` | The same key was used with different source bytes or declarations. Do not overwrite or replace the original attempt. |
| `MODULE_PACKAGE_CONFLICT` / `MODULE_VERSION_ALREADY_SUBMITTED` | Read the existing revision or intentionally create a new version and revision link. |
| `MODULE_REVISION_LINEAGE_INVALID` | The supplied predecessor is not a valid revision for this author and package family. |
| 429 | Observe `retryAfterSeconds` when returned; reduce request frequency or resolve the indicated quota. |
| `MODULE_SUBMISSIONS_UNAVAILABLE` | This deployment currently does not accept uploads. |
| `MODULE_REVIEW_UNAVAILABLE` | The review service is not ready. Keep the original receipt and check the separate review capabilities later. |
| `MODULE_REVIEW_JOB_UNAVAILABLE` | The expected durable review job is missing; retain the source identity and report the service failure. |
| `MODULE_REVIEW_RESPONSE` | The review response is inconsistent, unsupported or does not match the saved source receipt. Do not treat it as a valid review result. |
| `MODULE_API_NETWORK` / `MODULE_API_TIMEOUT` | Connectivity, redirect or timeout failure. A POST may already have reached the server. |
| `MODULE_API_RECEIPT_MISMATCH` / `MODULE_API_RESPONSE` | Do not treat the response as a valid receipt. Preserve the request and investigate the deployment. |

When `submissionMayExist: true` is returned, retain the original idempotency key and immutable request. Retry that exact pair after resolving the failure, or inspect the principal's submissions. Do not generate a new key automatically: a lost response does not prove that the server failed to persist the draft.

## Verification scope

The local HTTP tests cover credential boundaries, redirect refusal, real POST/GET requests, canonical source identity, idempotency, lost-response recovery, receipt substitution, author/reward wallet requirements, response limits, timeouts and cursor pagination. Review tests cover all eight workflow states, source binding, readiness before authentication, next steps and rejection of unsupported approval claims. The standalone distribution tests run the copied file without npm or node_modules through source upload and an accepted review projection. These synthetic checks do not constitute a deployment, independent review, contract audit or proof that the public API is enabled.

```bash
node --test packages/classic-modules/test/open-client.test.mjs \
  packages/classic-modules/test/module-api-cli.test.mjs \
  packages/classic-modules/test/open-review.test.mjs
```
