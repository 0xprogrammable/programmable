# Custom Hook launch experience V1

Status: local implementation contract; not deployed

This document is the product and integration contract for the Custom Hook path under
`Create a token`. It keeps the visible experience simple while preserving the signed
approval, wallet, execution, finality, fee, registry, and website boundaries behind it.

## Product brief

- Audience: an idea owner who may use any coding agent, and an experienced builder who may
  submit manually.
- Primary job: submit a custom launch once, understand its exact status, and launch the exact
  approved version without learning the internal approval system.
- Primary action: resume the one next action available for the selected submission.
- Trust requirement: never call a chat opinion, mutable branch, PR label, or application status
  an approval. Only a current signed launch entitlement for an exact commit enables launch.
- Visual thesis: a calm launch dossier that progressively reveals complexity because a custom
  launch is a reviewed project, not another preset token form.
- Emotional target: capable and unblocked, never overwhelmed or falsely reassured.
- Existing design language: preserve the current Programmable typography, spacing, palette,
  controls, and launch-card material. Do not introduce a second dashboard aesthetic.
- Signature interaction: one continuous project timeline changes from submission to review to
  launch to finalized project without moving the user into an admin product.
- Explicit avoid list: fake countdowns, invented review times, vague red errors, raw security
  jargon, card grids for every state, unverified safety claims, and browser-exposed service keys.

## Entry under Create a token

The first choice is intentionally only:

1. **Classic** — use the current reviewed preset flow.
2. **Custom Hook** — build or submit an open-source custom launch and resume its review or launch.

Custom Hook is never disabled merely because the visitor is signed out. Selecting it opens the
Custom Hook entry, where the visitor can choose how to build and where an existing applicant can
sign in.

### Custom Hook entry copy

Heading: `Build a custom launch`

Body: `Describe what you want to build to an agent, or submit the reviewed files yourself. Your
exact GitHub version must be approved before it can launch.`

Primary action: `Build with an agent`

Secondary action: `Read submission requirements`

Existing applicant action: `Check submission status`

The agent action exposes a copyable, versioned instruction that points to the official builder
skill and submission repository. The manual action opens the same requirements and public source
contract. Both paths converge on one GitHub submission format; neither receives greater approval
authority.

## GitHub identity and project list

`Check submission status` authenticates with GitHub through the existing website identity
provider. Authorization uses the immutable numeric GitHub user id. A username or repository name
is display data only.

After authentication, the page is headed `Custom launches` and shows every submission owned by
that GitHub identity. It is not an admin dashboard. Each row contains:

- project name and repository;
- pull request number;
- shortened exact commit id;
- current status and last verified time;
- one next action;
- no launch control unless a current signed entitlement exists.

If no submission exists:

- title: `No custom submissions yet`
- body: `Build with an agent or submit the required files on GitHub.`
- actions: `Build with an agent` and `Read submission requirements`

## User-visible states

The website derives these states from authenticated records. It never infers them from PR labels
or client input.

| State | User-facing title | Meaning | Primary action |
| --- | --- | --- | --- |
| `received` | `Submission received` | Exact GitHub version is queued durably. | `View on GitHub` |
| `in_review` | `Review in progress` | Deterministic and semantic checks are running. | `View review` |
| `changes_required` | `Changes needed` | The exact version cannot launch yet and has actionable corrections. | `Open requested changes` |
| `platform_pending` | `Verification still running` | A platform, tool, provider, or evidence dependency is unavailable. This is not applicant rejection and does not imply that autonomous review is enabled. | `View on GitHub` |
| `ready_for_registration` | `Ready to launch` | A current signed entitlement exists for the exact commit and GitHub identity; fresh eligibility and descriptor checks still run before setup. | `Set up launch` |
| `approved` | `Approval recorded` | The exact version is approved, but its current launch authority is not available yet. | `View on GitHub` |
| `superseded` | `New version submitted` | A newer exact commit replaced this version. | `View current version` |
| `expired` | `Approval expired` | The signed entitlement passed its exclusive expiry. | `Verify current version` |
| `revoked` | `Approval revoked` | Source, policy, or authority changed after approval. | `View reason` |
| `launching` | `Launch submitted` | The exact signed transaction is awaiting finality or safe recovery. | `View launch status` |
| `launched` | `Launch complete` | Finality, fee facts, registry publication, and website projection are durable. | `View project` |

### Corrections

The website shows at most three concise actionable corrections and links to the complete signed
GitHub review. It does not truncate the underlying correction set or reinterpret it. Copy:

- `Update the requested files on GitHub. The new commit will be checked as a new version.`
- button: `Open requested changes`

Do not promise a review duration. Show the observed time and whether the user or platform owns the
next action.

## Approved launch setup

`Set up launch` opens the approved project. It does not start a generic token template. The exact
approved launch specification decides which fields exist and their permitted bounds.

### Step 1: Token identity

- token or project image;
- token name;
- ticker;
- short description;
- website and social links;
- long-form project documentation.

Names, ticker, links, image, and documentation are metadata. They cannot change contract bytecode,
routes, permissions, fee obligations, approved dependencies, or deployment topology.

### Step 2: Approved launch parameters

Render only applicant-selectable fields declared by the approved launch specification. Examples
may include supply, launch fee, pool configuration, curve parameters, initial liquidity, recipient
choices, game parameters, NFT settings, or no-pool configuration. The UI must support novel field
sets rather than impose a five-template allowlist.

Every value is checked against its approved type and bounds on both the website and launch service.
Changing a code-bound or non-selectable value requires a new GitHub commit and review.

### Step 3: Review

Show a plain-language summary of:

- chain and launch route;
- token, hook, vault, adapter, or companion contracts that will be created;
- pool configuration, including an explicit `No pool at launch` state;
- the exact provider, model, template, semantic version, and market path from the approved fee
  policy;
- Standard Custom at 10 bps Programmable added on top, AEON at 20 bps total split 15 bps AEON and
  5 bps Programmable with no additional 10 bps, or 0 bps when no qualifying market path exists;
- every fee recipient from the approved plan, including the fixed Programmable recipient;
- launch wallet and any other recipient;
- external dependencies and material permissions;
- source commit and review receipt;
- estimated wallet actions and any required native value.

Primary action: `Confirm with wallet`

### Step 4: Wallet and execution

The website reads the service-owned launch descriptor, creates one challenge, binds the approved
preparation, verifies the connected wallet, and obtains one signed permit. The service then returns
one exact `eth_sendTransaction` action whose sender, target, calldata, value, and chain are fixed by
the reviewed artifact and route. The owner's EOA submits that action through the connected wallet;
the browser reports only the resulting transaction hash. It never receives a service signing key,
database credential, raw service authority, or permission to supply different transaction fields.

Visible progress uses exact states:

1. `Confirm in your wallet`
2. `Submitting launch`
3. `Waiting for confirmation`
4. `Publishing project`
5. `Launch complete`

An indeterminate wallet, report, or provider response is not retried as a second launch. The website
resumes the same execution reservation and displays its durable state. Contract wallets require a
separately approved smart-account route; this V2 browser action is explicitly `eoa-direct`.

Immediately before broadcast, the browser decodes the canonical permit artifact, rejects unknown
outer or envelope fields, recomputes every payload/envelope/artifact digest, and verifies the raw
Ed25519 signature against the exact `keyId` + `signerEpoch` + `signerComponentBindingHash` entry in
the server-configured `PROGRAMMABLE_LAUNCH_PERMIT_SIGNERS_V2_JSON` keyring. The keyring contains
only pinned public keys, never private signing material. Rotation adds the new signer identity while
retaining an old entry only for the lifetime of permits it legitimately signed. An empty, malformed,
duplicate, or SPKI-mismatched keyring keeps Custom launch unavailable.

The browser then requests `GET /api/custom-launch/trusted-time` with `no-store` immediately before
the wallet action. The request carries the verified signer's key id, epoch, component binding hash,
and SPKI hash as public query values. The route returns time only if that exact signer pin is still
present in the current server keyring. Removing a signer therefore revokes it even in a browser tab
opened before rotation; a retained overlap signer remains valid until its permits expire. The permit
and execution preparation must both retain at least five seconds of validity against that
same-origin server time, and a future-issued permit is rejected. A missing, redirected, cached,
malformed, stale-signer, or unavailable time response fails closed before wallet broadcast.

## After launch

Only finalized launches enter the public registry and website. The new launch is then:

- visible under the creator profile;
- visible in Programmable's newest-launch feed;
- tagged `Classic` or `Custom` from canonical registry data;
- discoverable through the developer integration feed;
- linked to its chain, contracts, transaction, exact source, and review evidence.

A custom launch without a liquidity pool is still a valid new launch, but must not be represented
as a trading pair. Third-party terminals decide how quickly they ingest the registry feed; the UI
must not promise instant listing on a named third-party product.

## Project page and long-form docs

Each custom project page has two deliberately separate bodies of information.

### Verified launch facts

Generated from finalized, authenticated evidence and not editable as marketing content:

- chain and finalized launch time;
- token and component contract addresses;
- pool or explicit no-pool status;
- fee composition and recipients;
- creator wallet and configured recipients;
- permissions, upgradeability, and material external dependencies;
- exact source commit and review receipt;
- launch transaction and registry identity.

### Project docs

The creator may publish a substantial long-form explanation with:

- overview and purpose;
- how the mechanism works;
- tokenomics;
- game, NFT, oracle, bridge, or application behavior;
- roadmap and integrations;
- media, links, and diagrams;
- risks and assumptions.

Project docs use a safe Markdown subset. Raw HTML, scripts, iframes, wallet prompts, embedded forms,
and executable content are forbidden. Images are served through the existing safe media path. Links
are visibly external and cannot inherit application credentials. The page records the docs revision
and update time. Updating docs never changes verified launch facts or contract approval.

The visual hierarchy puts the concise token summary and primary action first, followed by verified
facts, then the creator's long-form narrative. On mobile, these sections remain in the same reading
order and do not collapse verified facts behind hover-only controls.

## Manual-review bridge during the first release

A separate reviewer may inspect, test, and improve existing GitHub submissions in parallel. Its
approval is recorded first; only the service may produce `ready_for_registration` after it has
created and bound the exact current launch grant.

Official registration must still:

1. pin the exact repository, pull request, and immutable commit;
2. run the existing deterministic and semantic verifier on that exact version;
3. persist the complete decision and corrections;
4. sign the decision receipt and launch grant;
5. project the entitlement to the authenticated numeric GitHub identity.

This permits a manual trigger without creating a manual trust bypass. Later, the autonomous GitHub
worker invokes the same path automatically.

## Required website and service contract

The visible flow requires server-side website adapters for:

- authenticated entitlement list;
- exact application status and corrections;
- challenge creation;
- preparation binding;
- wallet authentication;
- launch authorization;
- idempotent execution and durable status recovery;
- finalized project/profile read.

The browser may carry the user's GitHub/identity token, wallet proof, public signed artifacts, and
idempotency key. It may not carry provider, signer, database, GitHub App, or projection credentials.

## Acceptance gates

Before calling this experience complete:

1. Test every state above with seeded non-production data.
2. Prove a user cannot see or launch another GitHub identity's project.
3. Prove a PR label, mutable branch, stale entitlement, or chat opinion cannot enable launch.
4. Prove a changed metadata field cannot alter the approved execution artifact.
5. Prove an approved selectable parameter cannot escape its signed bound.
6. Prove exact execution retry does not deploy twice.
7. Prove finalized launch publishes once to registry, newest launches, and creator profile.
8. Prove no-pool launches are not mislabeled as pairs.
9. Sanitize and render the long-form docs adversarially.
10. Inspect desktop 1440x900, mobile 390x844, narrow 320px, keyboard path, 200% zoom,
    console, failed requests, loading, empty, error, and recovery states.
11. Run full typecheck, lint, tests, production build, and the launch service end-to-end gate.
12. Prove forged, foreign-key, stale, future-issued, partial-envelope, and signer-rotation cases fail
    closed before the wallet action, while a permit from every intentionally retained signer passes.

No production activation is permitted until the existing Command Center freeze is explicitly
cleared and the release is bound to the exact reviewed commits.
