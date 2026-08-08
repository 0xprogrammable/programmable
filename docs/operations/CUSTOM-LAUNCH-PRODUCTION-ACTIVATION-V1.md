# Custom Launch production activation V1

> **Current status: local candidate; production change freeze active.** Do not push, deploy,
> promote, rewrite history, change branch protection, change production configuration, or enable
> Custom Launch until Command Center explicitly clears the freeze. This document is a procedure,
> not an activation authorization.

## Scope

This runbook activates and, when necessary, disables the public Custom Launch experience on
`programmable.market`. V1 supports Ethereum Mainnet only: every readiness result, launch
descriptor, wallet action, permit, finality record, Registry record, and Website projection must
bind `chainId="1"`. Any other chain is out of scope and must fail closed.

This runbook does not approve submissions. It assumes the approval service has already created a
current signed entitlement for an exact repository revision and GitHub principal.

Each release selects exactly one review authority mode: `manual_review` or `autonomous_ai`. The
Website, deployment probe, release record, and approval-service `/readyz` response must all bind the
same configured value. A GitHub approval, PR label, chat message, or direct database edit is never
enough. Changing modes is a separate approval-service and Website configuration release; it does not
weaken the GitHub identity binding, exact-revision entitlement, or launch flow.

## Evidence words

Use these words literally in release records:

| Word | Required evidence |
| --- | --- |
| `local` | The exact source passed checks on a workstation or CI runner. Nothing is reachable in production. |
| `deployed` | An exact immutable Website and service release is running with production dependencies, but Custom Launch remains publicly disabled. |
| `live` | The exact production release is enabled, the unauthenticated and authenticated probes pass against the production domain, and the bounded Ethereum Mainnet canary has finalized and projected successfully. |

A passing build is not a deployment. A deployment URL or HTTP `200` is not a live launch path. A
signed approval is not a launch, and a submitted transaction is not finality or publication.

## Release roles and stop authority

- **Command Center** lifts or reinstates the production freeze and records the decision.
- **Website release operator** deploys the exact reviewed Website commit and changes only reviewed
  production configuration.
- **Approval-service operator** deploys the exact reviewed service artifact and operates its signed
  control axes. Direct database updates are forbidden.
- **Canary owner** controls the approved GitHub identity and Ethereum wallet used for the bounded
  canary.
- Any operator may stop the release. No individual health check may waive a failed gate.

## Required release record

Before any production action, create one immutable release record containing:

- Command Center's explicit freeze-clearance reference;
- Website commit SHA, approval-service artifact digest, workflow run, and reviewed diff;
- immutable candidate deployment URLs and the production alias observed before activation;
- Website projection ordered migration inventory and exact digests for
  `0001_projection_records_v1.sql`, `0002_custom_launch_wallet_profile_v2.sql`, and
  `0003_registry_custom_public_read_v1.sql`, database identity,
  runtime-role attestation, backup id, and restore-drill evidence;
- approval-service release identity, database migration inventory, signer identity and epoch,
  control-axis generations, and `/readyz` evidence;
- Privy application identity and confirmation that GitHub OAuth and identity tokens are enabled;
- Ethereum chain profile and two independent finalized RPC-provider bindings;
- Registry and Website projection target bindings;
- the redacted outputs of every probe and the bounded canary's public transaction and projection
  identities;
- the exact previous production deployment and configuration snapshot used for rollback.

Never place access tokens, identity tokens, private keys, database URLs, provider credentials, or
secret values in the release record.

## Gate 0 — production freeze

Stop immediately unless Command Center has explicitly cleared the current freeze for this exact
release. Clearance must identify the Website commit and approval-service release. It must not be
inferred from a user message asking for speed, a green test, an earlier deployment, or a general
permission to publish.

Until clearance, the only permitted work is local inspection, implementation, testing, and release
preparation. In particular:

- do not push any branch or tag;
- do not trigger or approve `.github/workflows/deploy-production.yml`;
- do not change production environment variables or secrets;
- do not promote a Vercel deployment or move the production alias;
- do not enable any approval-service control axis;
- do not rewrite Git history or change branch protection.

## Gate 1 — exact local candidate

Start from a clean checkout of the exact reviewed candidate. Unrelated or untracked files block the
release; do not hide, clean, reset, or broad-stage them to obtain a clean result.

```bash
git status --short
git rev-parse HEAD
npm ci
npm run lint
npm run typecheck
npm run test
npm run build
```

Require all commands to pass with no skipped production-required check. Record the SHA and complete
outputs. Also require the approval-service release gates, exact Linux artifact check, database
migration inventory, contract tests, security checks, and continuous local authority-chain test
defined by its own activation runbook. A Website pass cannot substitute for a service, contract,
database, signer, RPC, Registry, or finality pass.

The release candidate must contain the production probe exposed as:

```bash
PROGRAMMABLE_RELEASE_EXPECTED_COMMIT_SHA=<exact-40-character-commit> \
PROGRAMMABLE_RELEASE_EXPECTED_DEPLOYMENT_HOST=<immutable-vercel-host> \
PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH=sha256:<exact-reviewed-package-hash> \
PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_REVIEW_AUTHORITY_MODE=<manual_review-or-autonomous_ai> \
PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_EXPECTED_CONFIGURATION_HASH=sha256:<exact-session-authority-configuration-hash> \
npm run probe:custom-launch -- --base-url=https://<immutable-deployment-host>
```

Do not continue if the command is absent from the exact candidate or its tests do not pass.

The protected GitHub `production` environment must also contain
`CUSTOM_LAUNCH_PRODUCTION_MODE` with exactly one durable value: `disabled` or `enabled`. Missing,
blank, differently cased, or any other value fails the workflow before deployment. This is the
continuing production policy for every later push, not a one-run checkbox. After activation it must
remain `enabled` unless Command Center explicitly authorizes the emergency-disable procedure.

## Gate 2 — production dependencies

Provision and validate every dependency while the public switch remains absent or exactly `false`.

### Website configuration

Configure the following through the production secret/configuration provider. Record names and
versioned secret references, never values:

- `PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED=false`;
- `PROGRAMMABLE_APPROVAL_SERVICE_V2_ORIGIN`, as one exact HTTPS origin with no path, query,
  fragment, credentials, or redirect;
- `PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH`, as the exact SHA-256 package
  artifact identity of the reviewed approval-service release;
- `PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_REVIEW_AUTHORITY_MODE`, set to exactly `manual_review`
  or `autonomous_ai`; the Website must reject an unlabelled backend or any runtime mismatch;
- `PROGRAMMABLE_LAUNCH_PERMIT_SIGNERS_V2_JSON`, containing only reviewed Ed25519 public keys and
  their exact key id, positive signer epoch, component binding hash, raw-key encoding, and SPKI
  SHA-256;
- `NEXT_PUBLIC_PRIVY_APP_ID` and `PRIVY_APP_SECRET` for the same production Privy application;
- `PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_AUDIENCE`;
- `PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_KEY_ID` and
  `PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_KEY_EPOCH`;
- `PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_PRIVATE_KEY_PEM` and its independently reviewed
  `PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_PUBLIC_KEY_SPKI_SHA256` binding;
- `PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_WORKLOAD_ISSUER`,
  `PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_WORKLOAD_SUBJECT`, and
  `PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_WORKLOAD_KEY_ID`;
- `PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_WORKLOAD_PUBLIC_KEY_PEM` and its independently reviewed
  `PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_WORKLOAD_PUBLIC_KEY_SPKI_SHA256` binding;
- protected GitHub environment variable
  `PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_CONFIGURATION_EVIDENCE_SHA256`, set to the independently
  materialized non-secret configuration-evidence digest bound by the release record;
- `PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_URL`;
- `PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_ROLE`;
- `PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_CA_PEM`;
- `PROGRAMMABLE_WEBSITE_PROJECTION_AUDIENCE`;
- `PROGRAMMABLE_WEBSITE_ENTITLEMENT_TARGET_BINDING_HASH`;
- `PROGRAMMABLE_WEBSITE_CUSTOM_LAUNCH_TARGET_BINDING_HASH`;
- `PROGRAMMABLE_PROJECTION_WORKLOAD_ISSUER`;
- `PROGRAMMABLE_PROJECTION_WORKLOAD_SUBJECT`;
- `PROGRAMMABLE_PROJECTION_WORKLOAD_KEY_ID`;
- `PROGRAMMABLE_PROJECTION_WORKLOAD_PUBLIC_KEY_PEM`.

Apply the Website projection migrations and least-privilege grants described in
`docs/operations/WEBSITE-PROJECTION-TARGET-V1.md` in this exact order:

1. `0001_projection_records_v1.sql`;
2. `0002_custom_launch_wallet_profile_v2.sql`;
3. `0003_registry_custom_public_read_v1.sql`.

Retain both exact digests and prove the resulting hosted catalog and grants, including the wallet-identity,
post-launch-authority, inventory, and index changes from `0002`. Require forced RLS, the exact runtime role, TLS
verification, append-only write behavior, backup, and a successful isolated restore. Never grant the Website role
approval-service authority.

### Approval service and external authorities

Before Website deployment, require the approval-service operator to prove:

1. the exact service artifact is deployed with all production control axes paused;
2. `/readyz` returns the exact V2 ready envelope from the configured HTTPS origin without a
   redirect, including `data.release.packageArtifactHash` equal to the reviewed package and
   `data.reviewAuthorityMode` exactly equal to the configured release mode;
3. hosted database migrations, least-privilege roles, backup, and restore drill pass;
4. GitHub App, remote signer/executor, Registry and Website projection targets, and monitoring use
   reviewed production identities; in manual-first mode autonomous AI is explicitly disabled and
   no AI-provider secret is configured, while an autonomous-mode release must separately attest its
   reviewed AI provider;
5. two independent read-only Ethereum RPC trust domains agree on chain id, finalized head, and
   block hash;
6. the enabled launcher/finality adapters accept Ethereum `chainId="1"` only;
7. the fixed platform-fee and recipient commitments match the reviewed release; and
8. every control-axis change will use the protected signed operator path. Direct database edits
   remain forbidden.

Do not activate Website traffic while any dependency is simulated, local-only, skipped, paused in
an incompatible state, or represented by an `.invalid` endpoint.

## Stage 1 — dark production deployment

After freeze clearance and all preceding gates, deploy through the reviewed production workflow in
`.github/workflows/deploy-production.yml`. The workflow must check out the exact recorded commit;
do not run an unrecorded laptop deployment or promote a different build. The workflow creates and
verifies a production-targeted immutable candidate with `--skip-domain`, records its exact commit,
deployment id, and immutable Vercel host, then stops without moving the production alias. Its
`verified_sha` output binds the checkout only; it is not a promotion authorization. Promotion is a
separate Command Center decision after the exact staged handoff and every mode-required evidence
artifact have been reverified against the same deployment id, URL, commit, record, and clearance.

Keep `PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED=false`. Verify both the immutable deployment URL and
`https://programmable.market`:

```bash
curl --fail --silent --show-error \
  --header 'Accept: application/json' \
  https://<immutable-deployment-host>/api/custom-launch/readiness

curl --fail --silent --show-error \
  --header 'Accept: application/json' \
  https://programmable.market/api/custom-launch/readiness
```

Both responses must be uncached JSON and contain the following fields, plus five `ready` component
results and the exact release commit and immutable deployment host:

```json
{
  "schemaVersion": "programmable.custom-launch-deployment-readiness.v1",
  "status": "disabled",
  "chainId": "1",
  "approvalServiceRelease": {
    "packageArtifactHash": "sha256:<exact-reviewed-package-hash>",
    "reviewAuthorityMode": "<manual_review-or-autonomous_ai>"
  }
}
```

The response also includes `checkedAt`. No readiness response may contain secret or internal
credential material. Confirm in a browser that Classic is unchanged, Custom Hook is visibly
`Coming soon`, Custom profile data is absent, and direct Custom API calls fail closed. At this point
the release is **deployed**, not live.

Dark deployment is valid only while the protected production mode and Website public switch are
both exactly `disabled`/`false`. Even then, the readiness route must reach and attest the configured
Website projection database and approval-service `/readyz`, and validate the production Privy and
permit-signer configuration. A bare off switch with missing dependencies is `503`, not a successful
dark release.

## Stage 2 — service canary while Website remains disabled

Use the approval service's protected operator procedure to enable only the release's bounded canary
cohort and required control axes, in its normative order. Record every signed command, prior and new
generation, actor, reason, and expiry. Keep the public Website switch off.

Run the service's staging/production canaries for exact-source approval, current entitlement, wallet
binding, permit reservation, lost-response recovery, Ethereum finality, Registry projection, and
Website projection. Require exactly-once durable counts. A pending provider or ambiguous response
must recover the same reservation; it must never create a second permit, transaction, or launch.

Stop on any disagreement, skip, manual trust bypass, unbounded cohort, or state that cannot be
reconciled without editing the database.

## Stage 3 — enable the Website

After Command Center approves public activation, change the protected production policy and Website
switch together:

```text
CUSTOM_LAUNCH_PRODUCTION_MODE=enabled
PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED=true
```

Build and deploy a new immutable production artifact through the reviewed workflow. Record the new
deployment id, URL, commit, build identity, and configuration version. Do not promote it if its
immutable URL fails the enabled probe:

```bash
PROGRAMMABLE_RELEASE_EXPECTED_COMMIT_SHA=<exact-40-character-commit> \
PROGRAMMABLE_RELEASE_EXPECTED_DEPLOYMENT_HOST=<immutable-vercel-host> \
PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH=sha256:<exact-reviewed-package-hash> \
PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_REVIEW_AUTHORITY_MODE=<manual_review-or-autonomous_ai> \
PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_EXPECTED_CONFIGURATION_HASH=sha256:<exact-session-authority-configuration-hash> \
npm run probe:custom-launch -- \
  --base-url=https://<immutable-deployment-host> \
  --require-enabled
```

The probe must exit successfully and prove at least:

- readiness returns `status="ready"` and `chainId="1"`;
- the Website projection database passes its live role/RLS/TLS attestation;
- the configured approval service returns its exact ready envelope;
- the public signer keyring is valid and non-empty;
- the returned trusted-time path is same-origin and bound to the current signer's exact key id,
  epoch, component binding hash, and SPKI hash;
- disabled, malformed, redirected, wrong-chain, cached, or unavailable dependencies fail closed.

Only then allow the production alias to serve that exact deployment. Run the same command again
against the production domain:

```bash
PROGRAMMABLE_RELEASE_EXPECTED_COMMIT_SHA=<exact-40-character-commit> \
PROGRAMMABLE_RELEASE_EXPECTED_DEPLOYMENT_HOST=<immutable-vercel-host> \
PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH=sha256:<exact-reviewed-package-hash> \
PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_REVIEW_AUTHORITY_MODE=<manual_review-or-autonomous_ai> \
PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_EXPECTED_CONFIGURATION_HASH=sha256:<exact-session-authority-configuration-hash> \
npm run probe:custom-launch -- \
  --base-url=https://programmable.market \
  --require-enabled
```

## Stage 4 — authenticated production canary

Use a dedicated production canary account whose Privy identity has exactly one linked GitHub OAuth
account. Obtain fresh, short-lived credentials through the normal production login. Inject them
from the approved secret runner as environment variables; never paste them into source, shell
history, logs, tickets, or the release record:

- `PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_ACCESS_TOKEN`;
- `PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_IDENTITY_TOKEN`;
- `PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_EXPECTED_GITHUB_USER_ID`;
- `PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_OWN_APPLICATION_HANDLE`;
- `PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_FOREIGN_APPLICATION_HANDLE`.

Run:

```bash
PROGRAMMABLE_RELEASE_EXPECTED_COMMIT_SHA=<exact-40-character-commit> \
PROGRAMMABLE_RELEASE_EXPECTED_DEPLOYMENT_HOST=<immutable-vercel-host> \
PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH=sha256:<exact-reviewed-package-hash> \
PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_REVIEW_AUTHORITY_MODE=<manual_review-or-autonomous_ai> \
PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_EXPECTED_CONFIGURATION_HASH=sha256:<exact-session-authority-configuration-hash> \
npm run probe:custom-launch -- \
  --base-url=https://programmable.market \
  --require-enabled \
  --authenticated-canary
```

Require a successful exit and redacted output proving that the two Privy tokens bind the same live
session and application, the current numeric GitHub principal exactly equals the protected expected
id, and the known owned exact commit is `ready_for_registration` with non-null receipt and
entitlement bindings. The canary may use the canonical untagged Manual Review intake or another
explicitly validated launchable intake; it must reject a `registry-v3` catalog-only record.
The probe must also read a current `active` eligibility with `launchAllowed=true`, require its receipt
to match both the application's opaque handle and public id, and load a current descriptor for the same application with a valid
default browser-wallet route. Direct access to a known real foreign application must return the
same 404 boundary as an unavailable record; the own and foreign handles must differ. Expired,
wrong-app, mismatched-session, missing-GitHub, multiple-GitHub, forged credentials, a missing or
non-launch-ready owned application, inactive eligibility, a substituted descriptor, or a readable
foreign application fail the release.

In `enabled` staging mode the workflow requires all five protected canary values above and runs this
authenticated canary against the immutable candidate before recording the staged handoff. Missing
credentials are a release failure, not a skipped check. The workflow does not promote the candidate
and does not automate the post-promotion check. After a separately authorized promotion, the
operator must rerun the same authenticated command against the production domain and attach its
redacted evidence to the exact release record.

This authenticated probe is not an onchain launch and does not by itself make the product live.
Destroy or expire the canary credentials after the check.

## Stage 5 — bounded Ethereum Mainnet launch canary

Use one public, approved, minimal-value canary revision and its dedicated wallet. Before wallet
confirmation, independently compare the displayed launch facts with the signed service artifacts:

- chain is Ethereum Mainnet and every representation is `chainId="1"`;
- repository, pull request, exact commit, GitHub principal, application, grant, artifact, route,
  economics, fee recipient, signer identity, and expiry all match;
- the wallet action's sender, target, calldata, native value, and chain are service-built and
  byte-bound to the verified permit;
- no mutable metadata field can change code, authority, fee, route, or value.

Submit exactly once. If the wallet, browser, service, or RPC loses the response, resume the same
execution reservation and recover by readback. Never send a second transaction to make the status
look successful.

Do not declare success until two independent Ethereum RPC trust domains agree on the finalized
transaction and launch facts, the Registry write and exact readback succeed, and the Website shows
the matching project under the canary GitHub identity. A no-pool project must explicitly show no
market; it must not appear as a trading pair. A pool launch must show only the authenticated PoolKey
and market facts. Where the route has a qualifying market path, verify the exact provider, model,
template, semantic version, market path, total, split, charge mode, and recipient accounting from
authenticated onchain evidence. Standard Custom is 10 bps Programmable added on top. AEON is 20
bps total, split 15 bps AEON and 5 bps Programmable with no additional 10 bps. A route without a
qualifying market path must prove zero fee legs.

Record public hashes and identifiers, redacted service receipts, finality height/hash, Registry
readback hash, Website projection hash, and screenshots. Do not record secrets.

After a defined healthy observation window with no error-rate, queue, signer, RPC disagreement,
finality, projection, or duplicate-execution alarm, Command Center may record the release as
**live**. Expand beyond the canary cohort only through the approval service's protected signed
control procedure.

## Continuous validation

While Custom Launch is live:

- run the enabled unauthenticated probe from an external monitor;
- run the authenticated read canary on a short schedule with fresh credentials;
- alert on readiness `503`, wrong chain, stale or removed signer, approval-service outage, database
  attestation failure, signer/executor ambiguity, RPC disagreement, queue age, finality delay,
  Registry/Website projection failure, or duplicate reservation/transaction evidence;
- keep the previous deployment and configuration snapshot immediately recoverable;
- rotate signer and workload authorities before their reviewed expiry; and
- never treat a third-party terminal listing as launch finality or Website readiness.

## Emergency disable

Use this path for suspected signer, executor, GitHub, Privy, database, RPC, Registry, fee, finality,
source-binding, or duplicate-launch compromise, or whenever launch safety cannot be established.

1. Set the protected `CUSTOM_LAUNCH_PRODUCTION_MODE=disabled`, reapply
   `PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED=false`, and deploy that configuration through the
   fastest reviewed production path. Do not rewrite Git history.
2. Confirm `GET /api/custom-launch/readiness` returns `status="disabled"` and `chainId="1"` on both
   the immutable deployment and production domain.
3. Confirm Custom Hook shows `Coming soon`, Custom profile reads are absent, trusted time is
   unavailable, and every Custom mutation fails closed. Confirm Classic remains available if the
   incident does not affect Classic.
4. Through the approval service's protected signed operator path, pause new intake or analysis only
   if affected, and always pause decision, permit, consumption, Registry, or Website projection
   axes whose integrity is in doubt. Never pause or mutate state with ad-hoc SQL.
5. Remove a suspected permit signer from the Website public-key ring and revoke/rotate the matching
   service authority. A Website key removal blocks stale browser tabs but is not a substitute for
   service-side revocation.
6. Revoke affected Privy, GitHub App, database, RPC, provider, projection, signer, or executor
   credentials at their authority. Do not reuse a suspected key.
7. Preserve logs, exact release/configuration identities, signed operator events, database state,
   RPC evidence, and public transaction hashes. Do not delete or rewrite durable launch records.
8. Reconcile every in-flight reservation and transaction. An already broadcast Ethereum
   transaction cannot be undone; continue safe read-only finality tracking and label its exact state
   without rebroadcasting.

Public disable is successful only when the disabled readiness state and fail-closed browser/API
behavior are independently observed. It does not prove that service axes or leaked credentials are
contained; complete every applicable step above.

## Code or deployment rollback

Use rollback for a verified Website regression after public disable. Prefer promoting the exact
previous known-good immutable deployment recorded before activation. Do not use `git reset --hard`,
force-push, delete migrations, or rewrite production history.

1. Disable Custom Launch first and verify the disabled state.
2. Compare the candidate and previous deployment identities, commits, configuration versions, and
   database compatibility.
3. Promote or redeploy only the exact recorded previous artifact through the reviewed production
   workflow.
4. Keep append-only database migrations and durable launch records. Apply a new forward migration
   for a schema correction; never down-migrate production evidence.
5. Verify the production alias, homepage, Classic path, Custom disabled state, and all unaffected
   read paths.
6. Reconcile in-flight Custom reservations, transactions, finality, Registry writes, and Website
   projections against the durable service state.
7. Record the rollback deployment id, previous and new aliases, reason, operator, timestamps, probe
   outputs, and unresolved launch ids.

Reactivation requires a new reviewed release record and every gate in this runbook. Restoring the
flag without repeating the enabled, authenticated, and bounded onchain canaries is forbidden.

## Final release checklist

- [ ] Command Center cleared the freeze for the exact release.
- [ ] Exact local Website, service, contract, database, and security gates passed.
- [ ] Previous production deployment and configuration are recorded for rollback.
- [ ] Production dependencies use reviewed identities and no `.invalid`, local, or simulated path.
- [ ] Dark deployment returned `disabled` and preserved Classic.
- [ ] Approval-service canary and protected control-axis sequence passed.
- [ ] Enabled probe passed on the immutable deployment and production domain.
- [ ] Authenticated principal-isolation canary passed with fresh redacted credentials.
- [ ] One bounded `chainId="1"` launch finalized exactly once.
- [ ] Registry and Website exact readbacks matched the finalized launch.
- [ ] No-pool or pool market presentation matched authenticated facts.
- [ ] Monitoring, emergency disable, key revocation, recovery, and rollback drills passed.
- [ ] Command Center recorded the observation window and declared the exact release live.
