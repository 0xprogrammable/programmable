# Module contributions through the API

Use an API key and an idea to build and submit a reusable module. Start with authenticated context to establish the author, default reward wallet, required inputs and current limits before writing source. The API stores the complete source package as an immutable **unreviewed draft** and returns its identity.

Source intake has no business-category allowlist. Components, interfaces and host requirements use open, versioned namespaces. A new hook, custom engine or supporting service can declare its actual architecture in the same package. The descriptor, source-byte and authentication rules still apply. An unknown runtime or host requirement needs a review plan and any missing platform integration before it can be approved or published. Intake does not execute the source.

A GitHub repository is not required. The descriptor always pins `source.files` with their SHA-256 hashes. Git provenance is optional: provide both `source.repository` and `source.revision`, or omit both. Providing that pair records a provenance claim; it does not verify remote Git history.

The source-intake wire contract stays `programmable.modules.api.v0.1`, with source requests in `programmable.modules.submission.v0.1`. Its receipt is a historical record of the saved source. The separate `programmable.modules.review-status.v1` response reports the current build and reviewer workflow; neither response grants onchain admission.

Use the immutable **1.0.0-development.7** standalone CLI for authenticated context, submission and review. Download its [manifest](https://programmable.market/developers/module-mode-cli/v1.0.0-development.7/manifest.json) and [CLI file](https://programmable.market/developers/module-mode-cli/v1.0.0-development.7/programmable-module-mode-1.0.0-development.7.mjs), and verify the file's SHA-256 against `artifact.sha256` in the manifest before running it. It needs Node.js, with no npm install or repository checkout. The older development.1 file remains unchanged and supports intake receipts only. These are development distribution versions; the live API capabilities determine which operations are enabled.

## Check submission access first

Upload eligibility comes from two fields: `moduleContributions.submissions` in public `GET /v1/modules/capabilities`, and `authorization.canSubmit` in authenticated `GET /v1/modules/context`. Both must be `true`. The context also reports the deployment's intake readiness as `intake.available`.

```javascript
const canUpload =
  capabilities.moduleContributions.submissions === true &&
  context.authorization.canSubmit === true;
```

**The root `reviewAvailable`, `approved` and `available` fields in `/v1/modules/capabilities` are legacy compatibility fields. Their `false` values do not block source intake or mean that the account needs approval.** Do not use them as upload gates. `moduleContributions.apiKeyIssuance` controls new key issuance separately; an existing key uses its actual permissions.

| What you need to know | Read |
| --- | --- |
| Whether this deployment accepts source drafts | `/v1/modules/capabilities` → `moduleContributions.submissions` |
| Whether this key may submit | `/v1/modules/context` → `authorization.canSubmit` |
| Whether review and status reads are ready | `/v1/modules/review-capabilities` → `reviewAvailable` and `statusReadAvailable`, or `/v1/modules/context` → `review.available` and `review.statusReadAvailable` |
| What is happening to a saved submission | `/v1/modules/submissions/:id/review` → `review.state` and `review.nextAction` |

Review readiness is separate from upload eligibility. When intake and key authorization permit an upload, an unavailable review service or missing review adapter does not prevent submitting the source. Keep the resulting submission ID and report the pending platform review work.

The intake receipt records the original upload. `status-module` and `list-module-submissions` keep returning that historical receipt, including `draft_received`, `unreviewed`, `approved: false` and `available: false`, after review progresses. Read `review-status-module` for the current decision and next action. Neither the capability flags nor a historical receipt is an account approval status.

## Before writing source

Create a key with **Launches + modules** access on [API keys](https://programmable.market/developers/api-keys?purpose=modules), or use an existing key with `modules:submit` and `modules:read`. Configure it privately as `PROGRAMMABLE_API_KEY` in the agent's secret environment. The CLI also accepts `PROGRAMMABLE_MODULES_API_KEY`; if both are set, they must contain the same key. Do not put credentials in a prompt, source files, generated artifacts, command-line arguments or shell history.

Use Node.js 24.14 or newer within the supported Node 24 release line. Set `MODULE_CLI` to the absolute path of the verified standalone download and run context before the build:

```bash
MODULE_CLI=/absolute/path/to/programmable-module-mode-1.0.0-development.7.mjs
MODULE_API_ORIGIN=https://api.programmable.market

node "$MODULE_CLI" module-context \
  --api-origin "$MODULE_API_ORIGIN"
```

This reads `GET /v1/modules/context` using the key's `modules:read` scope. The response schema is `programmable.modules.context.v1`. It reports:

| Field | Use |
| --- | --- |
| `identity.author` | Authenticated wallet to put in `descriptor.author`. Do not ask the user to provide it again. |
| `identity.defaultRewardWallet` | Default for `descriptor.rewardWallet`; it is the same wallet as the author. Use another nonzero EVM address only when explicitly requested. |
| `authorization.scopes`, `missingScopes`, `canSubmit`, `canRead` | Resolve missing key permissions before the relevant request. Context is still useful when a read-only key cannot submit. |
| `intake.available`, `limits`, `submissionFormat`, `descriptorFormat` | Check the live intake contract and byte/resource limits before creating the package. |
| `intake.openRuntimeIdentifiers`, `openHostRequirements`, `categoryRequired`, `repositoryRequired` | Runtime and capability names are open. A business category and Git repository are not required. |
| `inputs.requiredUserInput`, `optionalUserInput`, `agentPreparedFields` | Establish what comes from the user and what the agent prepares. The idea is required; a different reward wallet is optional. |
| `review.profiles`, `limits`, `available`, `statusReadAvailable` | Inspect the deployed worker's current executable review coverage independently of intake eligibility. |
| `review.unknownRequirements`, `planRequired`, `approval`, `publicationSeparate` | Unknown requirements wait for a review plan. Review is manual; publication follows separately. |

The descriptor still requires explicit `author` and `rewardWallet` fields. Copy the context values into the package before hashing it; the server does not rewrite a submitted descriptor. `author` must match the key's wallet. A supplied reward wallet declares a payout destination, not ownership proof or existing rewards.

Apply the [submission access check](#check-submission-access-first) before upload: public `moduleContributions.submissions` and keyed `authorization.canSubmit`. If discovery reads disagree about intake readiness, refresh them before uploading. A missing review adapter or unavailable review service is a separate platform task. Preserve the submitted identity while the platform establishes its review path.

### Inputs to resolve upfront

| Input | Who provides it |
| --- | --- |
| Intended behavior | The user supplies the idea, including any requested special rights, conditions or outcomes. |
| Author and default reward wallet | Read authenticated context. Ask only if the user wants a different payout destination. |
| Name, initial version and family salt | The agent chooses routine package details and generates a lowercase bytes32 salt once. Preserve the salt across revisions. |
| Chain, exact assets and external dependencies | Derive from the request and trusted discovery. Resolve ambiguous token identities, units, oracle/service assumptions or controller roles before implementing them. |
| Funding and exit behavior | Specify who funds what, who can act, limits, refunds and failure cases. Ask together for missing decisions that affect correctness. |
| Source, configuration, management and evidence | The agent builds and packages these from the settled requirements, reusing suitable code and meaningful checks. |

A ticker alone does not identify a tokenized stock or prove that a market route exists. Resolve the exact chain and address when the idea fixes an asset. For a reusable asset input, describe the permitted asset behavior and how each launch supplies and validates it. Never fill missing real-world addresses or services with fixture values.

## Source request format

`module.json` uses `format: "programmable.classic.source-package.v0.1"`. The historical word `classic` in that identifier does not restrict contributions to Classic V1 effects. Required descriptor fields are:

| Fields | Required content |
| --- | --- |
| `format`, `name`, `version`, `author`, `rewardWallet`, `familySalt` | Exact format, package identity, semantic version, authenticated author, payout address and stable lowercase bytes32 salt. |
| `source.files`, `documentation` | Every source/dependency/documentation file with its relative path and lowercase SHA-256; `documentation` names one of these pinned files. |
| `components` | At least one component with `id`, actual versioned `runtime`, pinned `sourcePath` and `entrypoint`. |
| `configuration` | Supported typed schema with units, bounds, input/default/fixed bindings and documented ABI encoding. |
| `ports`, `constraints` | Typed input/output interfaces and configuration constraints. Use `ports: {inputs: {}, outputs: {}}` and `constraints: []` when unused. |
| `management` | Summary, reads and actions. Each action declares its component, entrypoint, role and input schema. |
| `requiresHost` | Exact versioned host capabilities needed by the source; an empty list is valid when none are required. |

Runtime, port interface, host and optional `extensions` keys use names such as `your-org.your-runtime@1`. These identifiers declare interfaces; they do not activate them. Use `extensions` for inert metadata under a versioned namespace and pinned documentation for additional requirements. Arbitrary top-level descriptor fields are rejected. See the [open package reference](https://github.com/programmablehq/PROGRAMMABLE/blob/production/packages/classic-modules/OPEN-PACKAGES.md) for the configuration codec and exact constraints.

The HTTP body is `{format, descriptor, files}` with `format: "programmable.modules.submission.v0.1"`. Each uploaded file is `{path, sha256, encoding: "base64", bytes}` and must match the descriptor's file inventory exactly. A revised request may also include `supersedesSubmissionId`. Use the CLI to prepare and validate these exact bytes.

## Prepare, submit and track

`MODULE_API_ORIGIN` identifies the explicit API deployment. Read its public capabilities before submitting. HTTPS is required; `http://localhost`, `http://127.0.0.1` and `http://[::1]` with an optional port are allowed for local integration.

The standalone CLI works from your own module directory:

```bash
node "$MODULE_CLI" module-capabilities \
  --api-origin "$MODULE_API_ORIGIN"
```

When developing the SDK from a checkout with its dependencies installed, set `MODULE_CLI` to the absolute path of `packages/classic-modules/bin/programmable-classic-modules.mjs` instead. Both entries support the commands below.

Check `moduleContributions.submissions` together with `authorization.canSubmit` from authenticated context. A false intake value means this deployment is not accepting drafts; missing authorization means this key cannot upload. `moduleContributions.apiKeyIssuance` independently states whether it issues new module keys. The root legacy flags and separate review readiness do not gate this upload. The client also verifies capabilities before every upload; it sends no credentials or source when intake is unavailable or the format is incompatible.

Prepare a reviewable source request offline. Every path is relative to the explicit `--root` directory; source files must be ordinary files below that root, with no symlinks or traversal. Paths may contain common application names such as `[slug]`, `(group)`, `@scope` and `+page.svelte`. Each path is at most 240 ASCII characters; segments allow letters, digits, `.`, `_`, `@`, `+`, `(`, `)`, `[`, `]` and `-`. Empty segments, `.` or `..` segments, backslashes and control characters are rejected. `module.json` is an open source-package descriptor, not the older fixed-module manifest.

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

`GET /v1/modules/review-capabilities` is public. Its schema is `programmable.modules.review-capabilities.v1`. It exposes `reviewAvailable`, `statusReadAvailable`, `reviewerPolicyDigest`, `workerSourceCommit`, `workerAuthorityReady` and `databaseReady`; `approved` and `available` remain false. Ready status requires the database, reviewer policy and worker authority together. These flags describe the review operations only. Read `reviewAvailable` for review availability and `statusReadAvailable` for status reads; neither is an intake gate. The legacy root `reviewAvailable: false` in `/v1/modules/capabilities` remains a compatibility field. Use this separate review capability for the current workflow.

`GET /v1/modules/submissions/:id/review` requires the owner's `modules:read` key. The new client checks review readiness before sending credentials, then binds the response's submission, package, family, request digest, author, reward wallet and version to the immutable intake receipt. It prints the current `review.state`, `review.revision`, `review.attempt`, timestamps, `review.nextAction` and any latest reviewer decision.

| Review state | `nextAction` | Contributor's next step |
| --- | --- | --- |
| `awaiting_plan` | `await_review_plan` | The platform selects the build plan and establishes missing review coverage. Keep the receipt; no duplicate upload is needed. |
| `queued` / `running` | `await_build` | Check again later; do not upload a duplicate revision. |
| `built` | `await_reviewer_decision` | Build evidence was recorded. Wait for the security and compatibility decision. |
| `build_failed` | `await_review_plan` | Read `lastError`; the operator must address the build plan or request source changes. |
| `changes_requested` | `submit_new_version` | Apply the review feedback, update the source version and hashes, and submit a linked revision. |
| `rejected` | `review_rejection` | Read the reason before deciding whether a revised contribution is appropriate. |
| `accepted` | `await_registry_admission` | Download the [accepted build export](#export-an-accepted-build-over-http). Registry admission, deployed-code verification and public catalog activation are still required. |

The projected decision uses `outcome: "accept" | "request_changes" | "reject"`, plus its reason, reviewer wallet, decision time and digest. An accepted decision references the recorded build artifact and host manifest. `buildEvidenceRecorded` and these digests describe records held by the review service; the status response is not the full artifact or an independent audit. It still returns `sourceRevisionVerified: false`, `runtimeVerified: false`, `approved: false` and `available: false`, including after acceptance. Source-byte verification proves only that uploaded bytes match the declared source hashes.

Treat the reason as review feedback and `nextAction` as workflow data. The client does not execute response text, links, uploaded scripts or module code. It does not poll or retry automatically. If readiness is absent, retain the submission ID and check again later; do not recreate the submission. A missing durable review job is a service error (`MODULE_REVIEW_JOB_UNAVAILABLE`), not an invented waiting state.

You can also follow the review in [Profile → Modules → Submissions](https://programmable.market/profile?section=submissions). Sign in with the author wallet associated with the API key. A separate reward wallet does not grant access to these private submissions. The profile shows five submissions per page with their current review status and latest reviewer feedback. **Copy for agent** includes the submission identity and instructions to read the latest authenticated review before making changes; it does not include your API key. Approved reviews remain in submission history. **Published** lists verified publications after Registry admission and catalog activation.

To submit an edited revision, update the package version and hashes, then prepare a new file linked to the previous submission:

```bash
node "$MODULE_CLI" prepare-module-submission \
  --root /absolute/path/to/my-module \
  --package module.json \
  --supersedes PREVIOUS_SUBMISSION_UUID \
  --out submission-v2.json
```

Submit this new revision with its own stable idempotency key. The old source request remains immutable. `--supersedes` is also accepted with the one-step `--package` upload; it cannot override a prepared request's already pinned supersession.

## Export an accepted build over HTTP

After `review.state` becomes `accepted`, use `GET /v1/modules/submissions/:id/review-export` to download the exact accepted build plan, artifact and reviewer decision. Use a normal key with `modules:read`, owned by the same principal and author wallet as the submission. A key for another linked wallet of that principal cannot export this build.

Read `GET /v1/modules/review-capabilities` first and require `statusReadAvailable: true`. Then use the submission UUID from the original intake receipt. The request accepts no query string or body. Populate the Authorization header from `PROGRAMMABLE_API_KEY` in your HTTP client's secret environment:

```http
GET /v1/modules/submissions/{submissionId}/review-export HTTP/1.1
Host: api.programmable.market
Authorization: Bearer <module-api-key>
```

The successful response uses `schemaVersion: "programmable.modules.review-export.v1"` and contains:

| Field | Meaning |
| --- | --- |
| `submissionId`, `packageId`, `familyId`, `requestDigest`, `author`, `rewardWallet`, `version` | Identity fields that must match the saved intake receipt. |
| `reviewRevision` | The current accepted revision, equal to `review.command.expectedReviewRevision + 1`. |
| `buildAttempt` | The completed worker attempt bound to the same request, plan and artifact. |
| `reviewedBuild` | The existing `{subject, plan, artifact}` objects, retaining their Native or Engine schemas. |
| `review` | The complete accepted `programmable.modules.review-decision.v1` record, bound to that subject and artifact. |
| `registryApproved`, `available` | Always `false` for this export. Read the active public catalog for actual availability. |

The server revalidates the stored source, plan, artifact, completed attempt and accepted decision before returning them. It does not compile or execute source during the read. The response omits the source upload, worker identity, lease tokens and internal attempt log. Retain the original source request alongside the export.

The complete response is limited to **3 MiB** and uses `Cache-Control: no-store` with `Vary: Authorization`. Use an HTTP client that rejects redirects, bounds the decoded response to 3 MiB, validates the response schema and binds every identity field to the original receipt. The existing standalone CLI has no review-export command; its generic response limit remains **1 MiB**.

| Status / code | Next action |
| --- | --- |
| 401 / `AUTHENTICATION_REQUIRED` | Use an active, unexpired key for the author wallet. |
| 403 / `INSUFFICIENT_SCOPE` | Use a key with `modules:read`. |
| 404 / `MODULE_SUBMISSION_NOT_FOUND` | Check the saved submission ID and author wallet. An older API deployment may also return 404 for an unsupported export route, even when review-status reads are ready. |
| 409 / `MODULE_REVIEW_EXPORT_NOT_ACCEPTED` | Read the existing review-status resource and follow its `nextAction`. |
| 503 / `MODULE_REVIEW_EXPORT_BINDING_INVALID` | Preserve the source receipt and report the inconsistent source, build or decision binding. No partial export is returned. |
| 503 / `MODULE_REVIEW_EXPORT_UNAVAILABLE` or `MODULE_REVIEW_UNAVAILABLE` | Keep the receipt and check service readiness later; do not create a duplicate submission. |

An accepted export gives the contributor a copy of the recorded build and decision. Publication still uses the existing authorized operator's fresh protected reads, exact host-manifest binding, Registry admission, deployed-code verification and public catalog activation. Supplying export JSON grants no reviewer or Registry authority. Launches, management actions and claims continue through their existing wallet-authorized paths.

## SDK

The Node-only `@programmable/classic-modules/open-client` entry uses the same HTTP contract. For source checkouts, the equivalent relative imports are shown below. The package remains marked as a development package; an installed release must be verified independently.

```js
import { loadOpenSourcePackage } from './packages/classic-modules/src/open-package-io.mjs';
import { moduleSubmissionFromPack } from './packages/classic-modules/src/open-transport.mjs';
import { createModuleApiClient } from './packages/classic-modules/src/open-client.mjs';

const client = createModuleApiClient({
  apiOrigin: process.env.MODULE_API_ORIGIN,
  apiKey: process.env.PROGRAMMABLE_API_KEY,
  timeoutMs: 20_000,
});
const context = await client.context();
if (!context.authorization.canSubmit || !context.intake.available) {
  throw new Error('Resolve the context prerequisites before submitting.');
}
// Build module.json with context.identity.author and its defaultRewardWallet,
// unless the contributor explicitly supplied another reward wallet.
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

## Native and Engine source profiles

The current worker includes Native and Engine review profiles. Read `review.profiles` and `review.limits` in context for the deployed coverage. These profiles do not restrict the source-intake runtime namespace. A Native component uses `runtime: "programmable.module-native-runtime@1"`; an Engine component uses `runtime: "programmable.module-engine-solidity@1"` with its real Solidity `sourcePath` and `entrypoint`. Listing a capability in `requiresHost` does not implement it. No second Engine intake or signing endpoint is introduced.

The operator chooses `programmable.native-solidity@1` or `programmable.module-engine-solidity@1` in the existing review plan. Engine builds bind the complete compiler input, creation code, canonical `constructor(Context,bytes)` arguments, runtime template and compiler-derived immutable patches, then execute the declared operations in the isolated test harness. Contributor plans and local results cannot assign a protected review job or approve a revision.

The [Engine starter manifest](https://programmable.market/developers/module-mode-starters/engine-program/v0.1.0-development.1/manifest.json) identifies the [source archive](https://programmable.market/developers/module-mode-starters/engine-program/v0.1.0-development.1/engine-program-0.1.0-development.1.tar.gz). Verify its hash before extracting it. Follow its `README.md`, use the context-derived author/default reward wallet and your saved family salt, run the local build, then use `prepare-module-submission` and `submit-module` below. The starter implements funded, creator-attested settlement with expiry refunds. It has no deployed host, approved revision or public availability claim.

SDK development.4 configuration fields can declare `binding: {mode: "input", default?: value}` or `binding: {mode: "fixed", value}`. Fixed values may be omitted or repeated exactly; an override fails with `OPEN_CONFIG_FIXED_OVERRIDE`. A general quote address is a launch input in one reusable package. A fixed quote also requires the reviewed host revision and constructor to enforce that address against direct onchain calls. General quote trading still requires a nonzero fixed infrastructure configuration hash. See [Build a module](https://programmable.market/developer-reference/module-mode) for profile limits, fee versions and website-independent recovery.

### Packaged Engine dependencies

Keep dependency bytes in the submitted source inventory and include their hashes. For scoped Solidity imports, Engine review supports these fixed aliases from SDK-safe file paths to compiler source names:

| Submitted path prefix | Solidity import prefix |
| --- | --- |
| `dependencies/scoped/openzeppelin/contracts/` | `@openzeppelin/contracts/` |
| `dependencies/scoped/openzeppelin/uniswap-hooks/` | `@openzeppelin/uniswap-hooks/` |
| `dependencies/scoped/uniswap/blocknumberish/` | `@uniswap/blocknumberish/` |
| `dependencies/scoped/uniswap/liquidity-launcher/` | `@uniswap/liquidity-launcher/` |
| `dependencies/scoped/uniswap/uerc20-factory/` | `@uniswap/uerc20-factory/` |
| `dependencies/scoped/uniswap/v4-core/` | `@uniswap/v4-core/` |
| `dependencies/scoped/uniswap/v4-periphery/` | `@uniswap/v4-periphery/` |
| `dependencies/scoped/solady/src/` | `@solady/src/` |

For example, package `dependencies/scoped/uniswap/v4-core/src/interfaces/IPoolManager.sol` for an unchanged import of `@uniswap/v4-core/src/interfaces/IPoolManager.sol`. The worker preserves file contents and rejects duplicate compiler source names with `MODULE_BUILD_SOURCE_ALIAS_COLLISION`. It does not fetch imports or accept contributor-selected remappings. These aliases apply only to Engine compilation; the Native profile keeps its existing source rules.

### Quote review environment

The operator can select `testEnvironment` in the existing Engine build plan with `profile: "programmable.engine-quote-v4-v3@1"` and the exact `sourceDigest` supplied by the deployed worker's reviewed service profile. This selects a fixed isolated V4/V3 environment, including archived dependency artifacts and service-owned test assets. The digest binds its recipe, Solidity fixture and dependency archive. A plan cannot supply a different genesis, deployment script, compiler command or external endpoint.

Plans without this field retain the existing Engine environment. The selected profile and digest remain bound through the saved plan, worker job and build artifact. Tests of fixed templates must still use the exact configuration admitted for publication. Successful fixture execution does not establish live token eligibility, production market liquidity or public launch availability.

## Request limits and failure handling

Each request contains the descriptor and exactly its pinned source files, encoded as canonical base64. Local limits are 128 files, 4 MiB per file, 16 MiB total raw source and 24 MiB serialized HTTP request bytes. Base64 expansion is included in the HTTP limit. The deployment may publish lower limits; the client checks those before uploading. A source hash match proves the received bytes match the descriptor. It does not prove source ownership, repository history, a successful build, runtime safety or approval.

Build profiles have separate limits. The reviewer-selected `programmable.native-solidity@1` and `programmable.module-engine-solidity@1` profiles each support at most 4 MiB of total submitted source bytes, including packaged dependencies and documentation, and 16 KiB of encoded configuration. Engine initialization and operation data each have a 16 KiB ceiling; the reviewed execution budget is at most 3,000,000 gas. An intake receipt for a larger package does not promise that a profile can build it. `MODULE_BUILD_PROFILE_CAPACITY_EXCEEDED` identifies a source-size mismatch; a different host/profile requires its own supported review path. The open intake format and contributor source identity remain unchanged.

CLI failures return a nonzero exit code and structured JSON on stderr. Codes and safe field paths are retained; arbitrary server messages, raw response bodies and credential echoes are not printed. Relevant failures include:

| Code or HTTP status | Action |
| --- | --- |
| `MODULE_API_KEY_CONFLICT` | The credential environment variables differ. Configure one key or make both values identical. |
| `MODULE_CONTEXT_RESPONSE` | The context response is inconsistent or unsupported. Do not use its identity or infer permission to submit. |
| `OPEN_ADDRESS` / `MODULE_AUTHOR_MISMATCH` | Re-read authenticated context and bind its author to the descriptor. Use a nonzero reward wallet. |
| `OPEN_SOURCE_HASH` / `MODULE_FILE_HASH` | Reconcile source bytes and declared hashes before preparing a new request. |
| 401 / `API_SCOPE_REQUIRED` | Use an active key with the required scopes; inspect `authorization.missingScopes` in context when available. |
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
