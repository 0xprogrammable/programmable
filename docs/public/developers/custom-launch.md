---
description: Package, submit and track deterministic Custom launches with scoped API credentials
---

# Custom Launch API

Public V3.3 general-hook creation, list and single-resource reads accept wallet keys, partner roots and bounded partner
subkeys on Ethereum Mainnet. V2 and V1 history and schemas remain available, while fresh authenticated
`POST /v2/custom-launches` and `POST /v1/custom-launches` stay permanently read only with non-retryable
`409 CUSTOM_LAUNCH_V2_READ_ONLY` and `409 CUSTOM_LAUNCH_V1_READ_ONLY`. On Ethereum, only V3.3 accepts new submissions. Legacy
Registry and GitHub submission intake is closed.

The public Ethereum V3 CLI is `@programmable/launch` `3.3.9`. For Robinhood V4, read the live
[discovery manifest](https://programmable.market/.well-known/programmable.json). Before authenticated preflight or submission, require both
`customLaunchApi.versions.v4` and `chains[]` for `chainId: 4663` report `publicAuthorization: true`,
`publicWrites: true` and `releaseReady: true`. If either entry is false, incomplete or missing, stop before
authenticated preflight or submission. Verify the immutable official GitHub Release, exact source commit, release
manifest and tarball checksum from `customLaunchApi.versions.v4.cli.release` for the original client release. A
compatible client patch has its own immutable release evidence and binding to the selected API profile.
A repository source candidate is not an installable release.

Historical `4.0.0` resources retain their original contract. When discovery selects API profile `4.1.0`, preserve its
exact schemas and use a verified compatible client. CLI `4.1.1` adds public coverage while keeping the API profile
at `4.1.0`; verify that separate client release instead of relabeling historical assets or changing API pins.
This guide is not activation evidence for either version, and public HTTP reports need no CLI upgrade.

V2 detail reads are observation-only while an existing request is `prepared` or `simulating`: GET does not advance
simulation or authorization and cannot expose a new `walletTransaction`. Existing `authorized` and `submitted`
reconciliation and finalized reads remain available.

An external agent can package exact source and build artifacts, submit a byte-identical V3 request and track its
resource. An API key never signs or broadcasts a controller wallet transaction.

The [public V3 OpenAPI document](https://programmable.market/openapi/custom-launch-v3.json) is normative for creation
and current resources. The [V2 OpenAPI document](https://programmable.market/openapi/custom-launch-v2.json) and
[V1 OpenAPI document](https://programmable.market/openapi/custom-launch-v1.json) remain
compatibility contracts. The [raw agent guide](https://programmable.market/developers/custom-launch-api-v1.md) is
executable by a cold external agent.

## Robinhood Chain V4

Follow the [Robinhood launch workflow](https://programmable.market/developers/robinhood-launch-guide-v1.md) before
building. It connects architecture coverage, credentials, preflight, request recovery and the separate wallet step.
Read public `GET /v4/chains/4663/launch-guide` with schema `programmable.robinhood-launch-guide.v1` and
`GET /v4/chains/4663/launch-coverage`; neither needs a key, query parameters or body. A missing or unknown report is
not proof of support and never triggers an automatic fallback to another chain, profile or launch route.

Robinhood Chain Mainnet is `chainId: 4663` and `eip155:4663`. Its public self-serve availability is derived from
verified release evidence in the live discovery manifest. While `pending-public-discovery-promotion` or any of
`publicAuthorization: false`, `publicWrites: false` and `releaseReady: false` is reported, stop before submission.
When both discovery entries pass all three gates, follow the published V4 CLI release coordinates and fetch current
capabilities and readiness. The authenticated API server selects `robinhood-launch-readiness` or
`robinhood-production-launch` from the chain binding; callers cannot select a policy profile.

Create one platform API key at <https://programmable.market/developers/api-keys> and provide it through
`PROGRAMMABLE_API_KEY`. Select Ethereum V3 or Robinhood V4 using that chain's discovery contract and the grants
reported for the key. The key authorizes API requests; the user separately reviews and signs their onchain launch
transaction and pays gas.

Public guide, coverage, capabilities, readiness, initial-buy-quote and finalized-feed reads need no key.
Authenticated preflight/create requires `custom-launch:create`; list/detail requires `custom-launch:read`.
Check the key's chain `4663` grant and controller/resource lineage separately. A read-only or module-contribution
key does not grant launch-write access.

The V4 contract uses
`/v4/chains/4663/capabilities`, `/v4/chains/4663/custom-launches/preflight`,
`/v4/chains/4663/custom-launches`, `/v4/chains/4663/custom-launches/{launchId}` and
`/v4/chains/4663/finalized-custom-launches`. Read the
[historical 4.0 OpenAPI](https://programmable.market/openapi/custom-launch-v4.json),
[pack-config schema](https://programmable.market/schemas/custom-launch/v4/pack-config.json),
[source-verification schema](https://programmable.market/schemas/custom-launch/v4/source-verification-status.json) and
[admission descriptor](https://github.com/programmablehq/Launch-Policy/blob/main/policy/custom-launch-admission-v4.json)
only for that contract. When live discovery selects 4.1, follow the
[4.1 OpenAPI](https://programmable.market/openapi/custom-launch-v4.1.json),
[4.1 pack config](https://programmable.market/schemas/custom-launch/v4.1/pack-config.json),
[4.1 source verification](https://programmable.market/schemas/custom-launch/v4.1/source-verification-status.json) and
[4.1 admission descriptor](https://github.com/programmablehq/Launch-Policy/blob/main/policy/custom-launch-admission-v4.1.json).
Authentication is handed off only through `$PROGRAMMABLE_API_KEY`; it never selects a policy profile or grants wallet
authority. Historical 4.0 supports no funding and exact wallet transaction value; a funded 4.1 launch requires
positive wallet transaction value. ERC-20 funding needs separate
settlement proof before it can be advertised.

For selected 4.1, agree the funding source and pricing model before building and include a `fundingPlan` with exact
native allocations and user-confirmed `maxLaunchValueWei` and `maxGasCostWei`. Count an initial buy once inside the
wallet value; gas is additional. A build-only plan cannot obtain a permit. Every funded launch requires an atomic
initial buy of at least USD 1 at permit authorization and positive minimum token output to the launch wallet. Read
public `GET /v4/chains/4663/initial-buy-quote` first; the server obtains its own quote no older than 60 seconds, without
stale fallback. Never raise the amount or budget without user confirmation. Execution stays on Robinhood; the
Ethereum price reference does not guarantee dollar value at execution or third-party indexing.

4.1 admission requires an exact native fee kernel for the stamped PoolKey. It accrues 20 bps (0.2%) of the gross
native ETH leg once per successful buy or sell, rounded up, separately from creator and LP fees, as PoolManager
native claims for `0xD88539d3c4C460136a733A3Fd60cf6BF269079da`. Permissionless claiming pays only that fixed recipient.
Admission does not prove deployed state, completed trades or collected revenue; API keys never claim fees.

V4 metadata images are exactly PNG or single-frame GIF, as published by `metadataImage.mediaTypes` and `gifFrames`.
JPEG, WebP, and animated GIF are rejected by the V4 packer before any network request.

Project-owned token and hook targets at distinct addresses, 3–16 graph targets and all fourteen hook permission bits
are structurally representable. The active graph assigns one role to each physical target, so a combined token/hook
at the same address requires a versioned graph and Router release. Structural representation does not prove safety
or behavior. `feeBehaviorClaim` remains false, generic fee claiming and generic buyback management are not live, and
outside indexers may lag or omit Robinhood data even after a launch is finalized. Legacy Registry and GitHub intake
stay closed.

### Check architecture coverage before building

The separate [scenario and recovery guide](https://programmable.market/developers/robinhood-launch-guide-v1.md)
covers the native20 seed recipe, same-address token/hooks, no-pool and multiple-pool projects, funding policy,
arbitrary targets, stateful modules and custom settlement. Its assessments are guidance, not launch eligibility.
Unknown mechanisms are not automatically unsafe; a missing verifier and a demonstrated source defect require
different next steps.

Read `GET https://api.programmable.market/v4/chains/4663/launch-coverage` without an API key, query parameters or body.
The separate [coverage OpenAPI](https://programmable.market/openapi/launch-coverage-v1.json) and
[response schema](https://programmable.market/schemas/custom-launch/coverage/v1.json) preserve the existing 4.0 and
4.1 launch contracts. The response distinguishes:

| Field | Meaning |
| --- | --- |
| `readiness` | Whether the service is ready, independently of architecture coverage. |
| `structuralFormat` | Representable roles, pool topology, permissions and funding declarations. `tokenAndHookMayShareAddress: false` is an explicit same-address limitation. |
| `verifierCoverage` | Activated server proof adapters and their exact constraints. A candidate or missing public request surface cannot authorize a launch. |
| `findingObligations` | Required source repairs, funding/quote updates, transaction simulation or additional platform verification. Unknown codes remain unclassified. |
| `requestAuthorization` | Always `requestAuthorized: false`; no particular request has been checked or approved. |

The active format represents one native ETH/token pool. No-pool projects, multiple pool keys and same-address
token/hooks need a transport extension. Listing all permission bits or a funding model does not prove every hook,
curve, module or settlement behavior. Keep the project's intended architecture when it needs additional platform
support; wider key permissions or uploaded proof claims cannot make that support available.

```sh
curl --fail --silent --show-error https://api.programmable.market/v4/chains/4663/launch-coverage
```

CLI `4.1.1` adds `programmable-launch coverage --chain-id 4663`; verify its separate immutable release before
installing. The API profile remains `4.1.0`, and immutable CLI 4.0.0 and 4.1.0 releases keep their original commands.
Source documentation does not prove publication; the direct public GET needs no CLI upgrade.
If coverage returns 404, the deployment does not provide this report yet. A missing endpoint, timeout or unknown
report version is a coverage-discovery problem, not a reason to rotate a key or assume an architecture is supported.
When the report is available, still run the original authenticated preflight and server admission for exact launch
bytes before the separate wallet review.

A bounded V4 external-contract reference is admissible only after the protected API server verifies its exact
`eip155:4663` address, live runtime hash, source-verification evidence, declared graph role and verification
checkpoint. Naming an arbitrary, cross-chain, missing-code, stale-hash or otherwise unbound contract does not make it
a trust root and blocks admission. This validation rule is not evidence of public write activation or reference
behavior.

The reviewed foundation source closure is bound by
`0xe87f5edc2dc839bd87a26a80cb53f14b021e603a1753d27aae3a02862058d730`; this source commitment is not, by itself,
deployment or live-address evidence. The reviewed no-CBOR inputs require Sourcify v2 provider-native `match`; the
exact-source claim comes from the separate protected-source, reproducible-build, finalized-transaction and deployed-bytecode binding.
Robinhood Blockscout is optional, currently unproven and degraded. It cannot support an exact-source claim, and its
failure cannot block or revise finality.

Activated discovery binds non-null V4 `deploymentEvidence` for its deployed trust roots. Production clients must fetch the live deployment ID and descriptor digest, foundation source commitment, finality-policy digest,
finalized block, pinned finalized-evidence reference, and address, runtime-hash and start-block tuples for the Router,
GraphFactory, PermitAuthority Safe, PoolManager, PositionManager, Permit2, StateView, Universal Router and V4 Quoter.
Partial or stale evidence cannot activate or promote the lane.

### V4 lifecycle and wallet handoff

The V4 resource has a separate chain-aware lifecycle. These states do not replace the live Ethereum V3
states:

| Status | Meaning |
| --- | --- |
| `received` | The API accepted the immutable request into durable processing. No wallet action exists. |
| `validating` | The server is checking the exact request, policy, source, graph, external references and Router simulation bindings. |
| `action_required` | Fix the server-authored remediation, rebuild and submit a new immutable request. This is not a wallet action or manual approval stage. |
| `authorized` | Server admission and exact-transaction simulation passed and the exact wallet transaction is bound. It is not signed or broadcast. |
| `awaiting_wallet_signature` | The controller must review and sign the exact transaction in the separate wallet handoff. |
| `wallet_action_required` | The controller must open the current handoff, verify chain `4663`, sender, Router, value and calldata, then submit through the wallet. |
| `submitted` | The exact wallet transaction was submitted, but no Robinhood or Ethereum checkpoint is implied. |
| `sequencer_soft_confirmed` | Robinhood sequencer evidence exists. It remains reversible and is not Ethereum finality. |
| `ethereum_posted` | The Robinhood batch is posted to Ethereum, but the configured Ethereum-finality proof is not complete. |
| `finalized` | The exact launch evidence satisfies the published Robinhood-to-Ethereum finality policy. |
| `failed` | Processing is terminal. Read the bound failure and remediation before creating a new request. |

The CLI can prepare, validate, submit request bytes, poll status and display the exact transaction. It never signs or
broadcasts. Always bind V4 polling to both the API version and chain so the V3 default cannot be used by mistake:

```sh
programmable-launch status REQUEST_UUID --api-version 4 --chain-id 4663 --watch --until authorized
# Stop for separate controller-wallet review, signing and broadcast.
programmable-launch status REQUEST_UUID --api-version 4 --chain-id 4663 --watch --until finalized
```

Provider source verification starts only after `finalized` and remains an independent server-authored process.
`finalized` does not mean `exact_match`, and a provider retry or failure does not revise chain finality. Likewise,
source verification, Programmable indexing, third-party indexing, trading readiness, Explore visibility and any public
announcement are separate outcomes. Deployed V4 routes, schemas and source files do not prove public write activation
or any of those independent outcomes.

## Existing-project integration

An API key authorizes only its scoped API operations; it does not contain integration instructions or wallet authority.
A cold agent must start at
[`/.well-known/programmable.json`](https://programmable.market/.well-known/programmable.json), read
`customLaunchApi.partnerCredentials` to distinguish partner roots and bounded subkeys from wallet keys, select
`customLaunchApi.agentIntegration`, then fetch the advertised
[`programmable.custom-launch-agent-remediation-catalog.v1`](https://programmable.market/policies/custom-launch-agent-remediation-v1.json),
this guide, the V3 OpenAPI contract and the pinned CLI release. That public chain is the integration contract for every
project. There is no project-specific allowlist or private approval path.

For an existing project, the agent must inspect the exact repository rather than guess a profile:

1. Pin the public source repository and exact immutable Git object containing every submitted source byte.
2. Compile every direct graph target with `solc 0.8.26+commit.8a97fa7a`; preserve exact Standard JSON, artifacts,
   libraries, constructor values and runtime immutables.
3. Identify the distinct token, hook and initializer targets, map all address dependencies, declare the exact hook
   permission mask, and select the real pool, funding, liquidity, fee, custody and withdrawal behavior.
4. Create `programmable-launch.config.json` with `schemaVersion: programmable.launch-pack-config.v3` and validate it
   against the [machine-readable pack-config schema](https://programmable.market/schemas/custom-launch/v3/pack-config.json).
   Require the public token name and symbol, a meaningful description, non-empty local image, one website and one X
   profile. Other public links are optional. Use exact source, build,
   ABI and owner-supplied presentation values only; the CLI owns every digest, locator, CREATE2 prediction and request byte.
5. Follow machine-readable local diagnostics. After submission, follow the single-resource remediation payload and
   exact static report. `action_required` means change the reported source or config, rebuild, repack and submit a new
   immutable request. It is not a request for manual approval and cannot be bypassed by retrying unchanged bytes.

Before submission, fetch unauthenticated `GET https://api.programmable.market/v3/capabilities`, then run
`programmable-launch validate launch.json --config programmable-launch.config.json --remote`. Remote validation first
repeats the exact local validation and byte reproduction, then sends those same request bytes to authenticated
`POST /v3/custom-launches/preflight` with a create-scoped wallet key, partner root or bounded partner subkey. Preflight
consumes no launch-creation quota or durable launch reservation, allocates no nonce and persists no launch. The
authenticated request still consumes its ordinary route rate budget, including a partner credential's
`prepareRequestsPerHour` budget. It never signs or broadcasts. A successful response is
`programmable.custom-launch-preflight.v1` and carries the exact `requestHash`, `profileRevision`, `serverTime`,
`disposition`, `launchEligibility`, `evidenceTier`, `riskClassification`, platform-owned `behaviorEvidence`, all six
   `productTruthAxes`, hard-block, needs-evidence and warning code arrays, the bounded `staticBaseline`, typed
   `remediations`, and the five fixed side-effect fields. Local validation and preflight prepare and classify exact
   bytes; neither is the launch decision. A `not_executed` or `needs_evidence` result is outstanding, not verified, and
   cannot support a positive behavior, fee, liquidity or routability claim. Unknown additive fields may be preserved;
   they never relax a required false or true invariant. After durable submission, the API server independently enforces
   the objective static hard blocks and exact Router simulation before exposing a wallet handoff. An authenticated
   executed behavior failure blocks the handoff; absent execution leaves the related claims unverified.

For USDC EIP-3009 funding, the CLI is the derivation authority. Project code must accept and forward the exact
`from`, predicted-initializer `to`, `value`, validity window and nonce. It must not substitute an application-specific
funding domain or nonce. The published domains are
`programmable.direct-native-hook-graph.funding-intent.v1` and
`programmable.direct-native-hook-graph.funding-nonce.v1`. Current authorization patch V2 binds four distinct zero ABI
leaves: `bytes32 nonce`, `bytes32 r`, `bytes32 s` and `uint8 v`. Configure only
`nonceArgumentPath`, `rArgumentPath`, `sArgumentPath` and `vArgumentPath`; each has 1–16 zero-based indices from 0
through 255. The first index selects a top-level initializer input and later indices may descend static tuple components
or fixed arrays. Dynamic parents are not supported. The CLI derives the exact calldata offsets from the compiled ABI and proves
canonical decode and re-encode; applicants do not submit offsets. The backend later inserts only the derived nonce and
verified signature. The create request still contains no wallet signature.

When exact source, ABI and compiler artifacts do not contain enough AST or IR evidence to prove the initializer's nonce
dataflow offline, tooling may report the nonblocking warnings `FUNDING_NONCE_DERIVATION_CONFLICT_SUSPECTED` or
`FUNDING_NONCE_CONFORMANCE_UNPROVEN`. Inspect and fix a real conflict before submitting. The mandatory exact Router
simulation is the final execution-compatibility detector for the prepared transaction; neither a warning nor a
successful simulation is a safety, admission, liquidity, fee-behavior or economic-solvency claim.

The catalog also makes the liquidity boundary explicit. Pool initialization does not add liquidity, volume cannot
create initial liquidity from nothing, and V3 does not inject the Classic liquidity engine. Select and fully bind one
of `external-concentrated-liquidity`, `launch-seeded-concentrated-liquidity` or
`hook-inventory-custom-accounting` according to the project's actual implementation.

## V3 general hook profile

The versioned [`programmable.direct-native-hook-graph.v1` OpenAPI](https://programmable.market/openapi/custom-launch-v3.json)
defines the live create, list and single-resource shapes. The default profile uses
`schemaVersion: programmable.direct-native-hook-graph-profile.v3`, `profileRevision: 3` and
`profileVersion: 3.3.0`; its selection binding uses
`programmable.direct-native-hook-graph-profile-selection-binding.v3`. CLI `3.3.9` defaults to this live `3.3.0`
profile. Explicit profile `3.4.0` output is preparatory and is rejected by live capabilities until backend and
`.well-known` activation are independently verified.
Exact `3.2.0` requests retain their original nullable-image rules, and metadata-absent `3.1.0` and `3.0.0` requests remain readable and
byte-identical retryable under their original immutable policy; revision 2 also remains a compatible profile contract
for existing clients and resources. Discovery reports `productionLaunchAuthorized: true`. Do not fall back
to a different create version.

The Router primitive supports 2–16 targets; live profile `3.3.0` requires 3–16 direct CREATE2 graph targets because its
token, hook and initializer roles are distinct. The primary token and hook are project-owned exact artifacts, as are all
other direct targets. Native and ERC-20 quote currencies are structurally supported. All fourteen Uniswap v4 permission
bits are structurally supported across masks `0` through `16383`; return-delta permissions require their matching action
permissions, every enabled callback must have concrete reachable code, and the compiled declaration must match the
hook-address low bits. Structural support is not a universal behavior or safety promise. The request binds exact source, compiler,
creation bytecode, runtime, pool key, predicted initializer, expected pool ID and a
`programmable.eip3009-authorization-patch.v2` descriptor. The patch names the initializer target, unsigned calldata
hash, calldata length, authorization encoding and numeric ABI paths for the zero `nonce`, `r`, `s` and `v` leaves. The
CLI derives their offsets from the exact compiled ABI; the backend patches only those proven leaves. Existing exact V1
requests retain their original descriptor semantics. The initializer has per-launch exact source, build, runtime,
final-calldata and simulation evidence. There is no separate global initializer trust root.

Pending profile `3.4.0` raises the fresh-graph minimum to four, inclusive of the frozen
`programmable:settlement-fee-vault:v1` module. The applicant cannot choose another platform fee target. Its release
binding is `sha256:39ccdfdf8cd61620bf5c62bf07fb8428adbd66d2608b1cf3ad583343116d7ed9`; source SHA-256 is
`sha256:0a01ee8c22d103343d14b1d3890902e3edeecef25ea84a0f03f23a3fe8f1042b`; creation/runtime Keccak-256 are
`0xdbc32e835739b50f33a101a8927008fc46af4c11604f7a5da006e5c56288b21e` and
`0x92620fe3f83839334c9a264bea5bfcc819868ca5607cbd2260e5a9664dbd7554`. It uses solc 0.8.26, EVM Paris,
optimizer 1000, `viaIR: false`, metadata hash `none`, and no CBOR. Its constructor binds the GraphFactory;
`bindRoute(address)` locates one distinct project-owned route target, and exactly one constructor or initializer locator
on that route points back to the vault. The route may be the hook or a custom AMM. Matching
`settlementFeeVault()` and the complete fee path remain server-evidence requirements; locators alone do not prove them.

When activated, a fresh profile `3.4.0` request reaches wallet handoff only after the API server verifies an immutable 10 bps
Programmable fee path for its exact stamped PoolKey. A declaration, local check, caller attestation or conditional fee
result is insufficient. Exact `3.3.0` and earlier resources keep their immutable historical evidence state. Static pool fees and the `0x800000`
dynamic-fee sentinel are structurally supported but do not create a Programmable fee claim.

Funding may be absent, carried as exact native Router-transaction value, or use an unsigned nine-field
`programmable.funding-authorization-descriptor.v1` for USDC EIP-3009
`receiveWithAuthorization`. Its separate `fundingIntentHash` is derived before a signature from the fixed route, launch
intent with four zero authorization leaves, wallet, predicted initializer, amount and validity window. The funding nonce
is then derived from that intent. It does not hash the final graph containing the patched nonce or signature. It also
excludes the signature itself, `initializerCalldataHash` and `permitDigest`. The create request contains the derived
funding descriptor and authorization patch, but no signature, `v`, `r` or `s` value.

For EIP-3009 funding, one single-resource flow keeps the two wallet actions separate:

1. The API-key request reaches `awaiting_funding_authorization` and returns the exact `ReceiveWithAuthorization`
   typed data and digest.
2. The website checks the connected wallet, chain, USDC domain, `to`, value, nonce and
   `validAfter < now < validBefore`, then requests `eth_signTypedData_v4` only after an explicit user action. The
   65-byte lower-case `r || s || v` signature is posted once to the resource-specific wallet-admin URL. The CLI does
   not accept or submit this wallet signature.
3. The backend verifies and inserts the signature only at the bound zero ABI words, derives the final graph commitment,
   permit, artifact and Router transaction, and requires the exact simulation postconditions. Behavior execution is
   additional server evidence; absence leaves its claims unverified and an authenticated executed failure blocks.
4. The website revalidates the exact Router transaction and asks for a second explicit wallet send. Nothing
   auto-signs or auto-broadcasts.

The public API key remains available only through `PROGRAMMABLE_API_KEY` or the supported operating-system secret
store. There is no key argument or prompt. V3 includes no ERC-20 approval, Permit2 approval, signer or
platform-approval shortcut.

## Liquidity is a project design

Calling `PoolManager.initialize` creates a Uniswap v4 pool and its starting price; it does not add liquidity. A project
using ordinary concentrated liquidity must fund and create its own position. Trading volume cannot create that initial
liquidity from nothing. The exact position owner, withdrawal path and any lock or burn must be part of the project
design and disclosed; the general profile does not silently lock a project-owned position.

The current CLI binds one explicit model into the request hash: `external-concentrated-liquidity` remains
`liquidity_required`; `launch-seeded-concentrated-liquidity` binds the exact seed target and remains
`assessment_required`; `hook-inventory-custom-accounting` binds the exact hook inventory path and remains
`assessment_required`. A project can request the required checks but cannot declare its own pass.

A launch can start with zero classical LP only when its project-owned hook and initializer implement custom accounting
or hold launch inventory that can exchange against incoming assets. Buys can then increase assets held by that hook,
but the token inventory, accounting and redemption or sell path still come from the project graph. `fundingMode: none`
only means the Router transfers no launch funding; it does not make an empty ordinary pool liquid.

Current profile `3.3.0` checks exact source/build bindings and hook permission consistency, then applies role-aware static admission.
Every enabled Uniswap v4 permission must resolve to a concrete reachable callback implementation; an interface
declaration or fallback-only route does not qualify.
Every finding remains bound and visible. Exactly seven objective code-and-role rules hard-block deployment: runtime
`CALLCODE`, runtime or source `SELFDESTRUCT`, definitively missing or invalid callback authentication, a literal wrong
PoolManager, and a missing enabled callback implementation. Proxy or delegatecall use, mint/tax/pause/transfer
controls, liquidity custody or locking, external dependencies and return-delta custom accounting are evidence duties,
not categorical deployment blocks. A hard-block match returns `action_required`; other findings populate
`needsEvidenceFindingCodes` or warnings. There is no manual project allowlist. A final Router simulation is mandatory,
and the API server independently requires it to pass before wallet handoff. Once activated, fresh profile `3.4.0` additionally requires
server-owned verified behavior evidence and verified exact 10 bps fee-path evidence. Missing, not-configured or
unavailable execution remains retryable and cannot authorize; executed failure or a mutable fee path blocks terminally.

When no hard-blocking pair matches, the server-authored `platformAdmission` status binds the report SHA-256,
needs-evidence and warning codes with disposition `no_blocking_static_finding`, while requiring Router simulation and explicitly setting
`safetyClaim: false` and `feeBehaviorClaim: false`. A blocking match instead exposes the exact static report through
`action_required`.

Static admission and simulation do not prove that arbitrary custom token or hook logic is free of honeypot behavior,
privileged controls or economic risk. They are not an audit or a guarantee of safety, liquidity, tradeability or fee
behavior. Projects must disclose transfer restrictions, pause or upgrade controls, liquidity custody, withdrawal rules
and buy/sell behavior, and users must review them.

## Platform fee policy

The general V3 profile is public on Ethereum Mainnet only (`chainId: "1"`) and has
`productionLaunchAuthorized: true`.

Once activated, a fresh profile `3.4.0` launch reaches wallet handoff only after server-authored per-launch evidence verifies an
immutable Programmable share of `1,000` hundredths of a bip, equal to `0.10% = 10 bps`, for its exact stamped PoolKey.
The evidence binds accounting, currency, rounding and claim destination. Revision-3 local validation, static admission,
Router simulation, configuration and caller attestations do not independently create `feeBehaviorClaim: true`.
For that certified lane, the bound Programmable recipient is `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`.

Where a selected lane uses applicant buy or sell rates, each rate is capped at `100,000` hundredths of a bip:
`1,000 bps = 10%`. The API server enforces this cap for both `additive-platform-share` and
`inclusive-selected-total`. The separate platform value remains `1,000` hundredths of a bip, equal to `10 bps`; the
additive and inclusive accounting meanings are unchanged.

The pool's LP fee is separate from this platform charge and must be disclosed separately. Generic fee claiming and
buyback management for arbitrary hooks are not live. The reserved `fees:claim` and `buybacks:manage` scopes remain
disabled.

## Product-truth axes stay separate

Capabilities publishes six independent `productTruthAxes`: `deployment`, `trading`, `platform_fee_evidence`,
`source_verification`, `indexing` and `featured`. Evidence on one axis never proves another. In particular:

- preflight `launchEligibility.deployable` means the exact request clears the bounded deployment-mechanics preflight;
  it does not mean a transaction was signed, broadcast or finalized;
- `routable` is a current evidence classification, not proof of live trading, liquidity, price quality or economic
  safety;
- request-bound platform-fee declarations and static admission do not replace separate platform-fee behavior evidence;
- only server-authored `sourceVerification.status: exact_match` for every required component means source verified;
- Router finality does not itself prove an indexing refresh, and indexing does not prove trading or source verification;
- `featured` is a separate placement decision and must never be inferred from deployment, routing or indexing.

The four preflight dispositions are `supported`, `supported_with_warnings`, `needs_evidence` and `unsupported`. They
classify the exact submitted bytes at the stated evidence tier. None is an audit, universal compatibility statement or
safety guarantee.

Every durable resource also has additive `lifecycleQueue` readback. It reports bounded worker scheduling, attempts and
poll guidance only. Queue completion is not launch finality, and a queue retry does not change the durable launch
status. The single-resource GET remains the canonical polling path.

## Cold-agent quickstart

Install the pinned public GitHub Release asset. Do not substitute an unverified npm-registry package with the same name.

```bash
programmable_cli_dir="$(mktemp -d)"
curl --fail --location --output "$programmable_cli_dir/programmable-launch-3.3.9.tgz" \
  https://github.com/programmablehq/PROGRAMMABLE/releases/download/programmable-launch-v3.3.9/programmable-launch-3.3.9.tgz
curl --fail --location --output "$programmable_cli_dir/programmable-launch-3.3.9.tgz.sha256" \
  https://github.com/programmablehq/PROGRAMMABLE/releases/download/programmable-launch-v3.3.9/programmable-launch-3.3.9.tgz.sha256
(cd "$programmable_cli_dir" && shasum -a 256 -c programmable-launch-3.3.9.tgz.sha256)
npm install --global "$programmable_cli_dir/programmable-launch-3.3.9.tgz"
programmable-launch --version
```

Continue only after the checksum command reports `OK` and the version command prints `3.3.9`. Omit `profileVersion`
for the live `3.3.0` default. Explicit `3.4.0` output remains preparatory and is rejected until backend activation.

The release includes `examples/direct-native-v3-no-broadcast/README.md`, real Solidity sources, exact Standard JSON and
matching solc artifacts. Its generated evidence is limited to `pre-submit`. The deterministic permission salt grind
remains usable locally, and the example never submits, polls, signs or broadcasts.

Build the project from one pinned source revision and preserve:

- exact UTF-8 Solidity Standard JSON input with inline `sources[*].content`, never source URLs;
- the matching compiler artifacts with ABI, creation bytecode, deployed bytecode and compiler metadata;
- project-specific check evidence;
- exact constructor values, initializer values, salts and declared hook permissions.

Create the closed `programmable.launch-pack-config.v3` file described in the installed package README. Set
`source.publicOrigin.url` to the public HTTPS source repository and `source.publicOrigin.revision` to the exact
lowercase 40-character Git commit containing the submitted source bytes (`PROGRAMMABLE_SOURCE_REVISION` in the packaged sample),
then run:

```bash
programmable-launch pack \
  --config programmable-launch.config.json \
  --output launch.json
programmable-launch validate launch.json \
  --config programmable-launch.config.json \
  --remote
programmable-launch submit ./launch.json \
  --config programmable-launch.config.json
programmable-launch status REQUEST_UUID --watch --until authorized
```

The agent state machine is `pack -> validate --remote -> submit -> server decision -> status --watch --until
authorized -> wallet -> status --watch --until finalized`. `wallet` means stop for the connected controller to review and sign; it is not a
fifth CLI command. Authenticated CLI traffic is fixed to exact origin `https://api.programmable.market`; there is no
origin override. Remote validation and later submission use the same exact request bytes. Preflight has no
Idempotency-Key because it creates no durable resource; `submit` keeps its existing durable idempotency and retry
rules.

The API server exposes either handoff only after objective static hard blocks and exact Router simulation pass. Missing
behavior execution leaves the related claims unverified; an authenticated executed failure blocks. With `--until authorized`, the status command stops at either the EIP-3009 funding handoff or the Router handoff. In
EIP-3009 mode, first complete the exact funding signature in the website, then run the same status command again. At
`authorized`, stop again so the connected controller can review and sign the exact Router transaction separately. When
present, use only the resource's HTTPS `walletHandoffUrl` before its `expiresAt`; refetch the single-resource status after
expiry rather than signing stale material.
After the wallet broadcasts, continue with `--until finalized`; terminal failures always stop polling.

For a wallet flow, manage a wallet-bound key at [API keys](https://programmable.market/developers/api-keys). A partner
flow uses its issued root or bounded subkey. Store the selected credential in an encrypted secret or environment
variable named `PROGRAMMABLE_API_KEY`. Put only the literal placeholder
`$PROGRAMMABLE_API_KEY` in chat, prompts, agent setup and documentation. The CLI also supports the operating system
secret store. It has no `--api-key` flag and does not persist the key.

After the controller wallet broadcasts the reviewed transaction, resume only status polling:

```bash
programmable-launch status REQUEST_UUID --watch --until finalized
```

`finalized`, `failed` and `cancelled` always stop polling.

## What `pack` derives

`pack` consumes exact files and structured ABI values. It does not accept hand-written source, graph, verification or
runtime hashes. Do not enter derived hashes by hand or copy test-only hashes. It derives:

- `launch.json` and a deterministic pack receipt;
- a UTF-8 path-byte-sorted source manifest and exact file or symlink content commitments;
- `SourceDescriptor`, source bundle digest and canonical content SHA-256;
- ABI-encoded constructor arguments and initializer calldata;
- target-address locators, graph topological order, effective salts and CREATE2 predictions;
- normalized `CustomGraphBundleV1` and its canonical hash;
- check evidence digests and the agent attestation subject;
- exact Standard JSON bytes, solc build, settings, optimizer, EVM target, libraries, contract identity and resolved
  constructor arguments in `verificationBundle`;
- the domain-separated verification bundle hash and exact request-byte SHA-256.

For a hook, `applicantSalt` can use `deterministic-hook-permission-grind-v1`. After the source bundle, wallet, nonce,
init code and declared permissions are fixed, `pack` tries salts in unsigned integer order and chooses the first
predicted address whose low 14 bits match those permissions. A bounded miss fails with `HOOK_SALT_GRIND_EXHAUSTED`.

The source-content digest hashes RFC 8785/JCS bytes for
`{schemaVersion:"programmable.source-bundle-content.v1",entries:[manifest fields plus contentBase64]}`. Entries are
unique and sorted by UTF-8 path bytes. `contentBase64` is canonical base64 of exact file bytes or exact UTF-8 symlink
target bytes.

The full expected runtime code hash is derived only when deployed bytecode has no unresolved link or immutable
references. Otherwise `pack` fails closed with `RUNTIME_MATERIALIZATION_REQUIRED`. It never trusts a user-entered
runtime hash or metadata-stripped compiler template.

`validate` recalculates the manifest, source, graph, evidence and verification commitments. With `--config`, it also
requires `launch.json` to be byte-identical to a fresh pack of the same source and build inputs.

## Public V3 request contract

`POST /v3/custom-launches` accepts the exact current V3.3 general-profile request. V2 and V1 reads and schemas remain
available for compatibility, while their fresh POSTs return non-retryable `409 CUSTOM_LAUNCH_V2_READ_ONLY` and
`409 CUSTOM_LAUNCH_V1_READ_ONLY`. The V3 fields are:

| Field | Requirement |
| --- | --- |
| `schemaVersion` | `programmable.custom-launch-create-request.v3` |
| `launchWallet` | The wallet key's bound address, or the exact controller selected by a partner credential; this controller later reviews, signs and broadcasts |
| `chainId` | String `1` |
| `nonce` | A nonzero lowercase `bytes32` |
| `sourceDescriptor` | One `DeterministicSourceBundleV2` descriptor |
| `sourceBundleManifest` | One complete, non-empty, UTF-8 path-sorted manifest |
| `graphBundle` | One executable `CustomGraphBundleV1` |
| `projectMetadata` | Canonical token declaration and presentation, required by live `3.3.0` and pending `3.4.0` |
| `projectMetadataHash` | Domain-framed SHA-256 bound into the graph hash and launch identity |
| `behaviorScenarioInputs` | Declarative ordered server-runner inputs, required by profile `3.4.0`; no assertions or verdicts |
| `behaviorScenarioInputsHash` | CLI-derived domain-framed SHA-256 bound into `launchIntentHash` |
| `agentAttestation` | One self-attestation for the exact graph subject |
| `permitWindow` | The exact bounded Router permit window |
| `launchProfile` | The complete general V3 production profile |
| `launchProfileSelection` | Exact target role and deployment bindings |
| `launchProfileHash` | CLI derived canonical profile digest |
| `launchIntentHash` | CLI derived exact request intent digest |
| `verificationBundle` | Exact source, compiler, runtime and constructor bindings |

The pack config asks explicitly for `token.name`, `token.symbol`, `presentation.description`,
`presentation.image`, and `presentation.links`. Name and symbol are owner-supplied canonical public text bounded to 64
and 16 UTF-8 bytes. Live `3.3.0` and pending `3.4.0` require a useful description (20–4,096 UTF-8 bytes and at least eight Unicode
letters or numbers), exact non-empty local PNG/JPEG/WebP/GIF bytes, one public HTTPS website and one canonical
`https://x.com/<handle>` profile. Other links are optional. The packer includes image
bytes in the source manifest, sorts links and derives `projectMetadata`, `projectMetadataHash` and the metadata-bound
`graphBundleHash`. It statically compares an unambiguous constructor or initializer name/symbol argument when one
exists, without forcing arbitrary tokens into a specific constructor. Discovery advertises
`requiredForProfileVersions = ["3.2.0","3.3.0","3.4.0"]`, `strictMetadataProfileVersions = ["3.3.0","3.4.0"]`, and
`legacyMetadataProfileVersions = ["3.2.0"]`, so exact `3.2.0`, `3.3.0` and pending `3.4.0` all carry metadata while
only exact `3.3.0` and pending `3.4.0` use the strict current policy and only exact `3.2.0` preserves its older
nullable-image semantics. Finalized launches expose the declaration plus server-authored onchain name/symbol readback through the
public finalized-metadata endpoint.

Profile `3.4.0` also requires `behaviorScenarioInputs` with 1–128 ordered declarative steps. Each step binds a unique
ID, fixed phase and actor, an exact prepared target, the canonical PoolManager binding or the fixed `v4-actions-v1`
harness, canonical `valueWei`, and bounded lowercase calldata and hook data. Aggregate calldata plus hook data is at
most 1 MiB. Scripts, URLs, assertions, expected results, statuses and runner parameters are rejected. The CLI derives
`behaviorScenarioInputsHash` with domain `programmable.custom-launch-behavior-scenario-inputs.v1` and includes it in
`launchIntentHash`; the API server resolves targets against the prepared artifact and remains the sole execution,
assertion and vector-verdict authority.

`GET /v3/finalized-custom-launches` returns the page array as top-level `launches` and always includes top-level
`quality`. Quality is `complete` or `partial` and carries `sourceRowCount`, `publishedRowCount`,
`quarantinedRowCount`, and row-indexed `FINALIZED_ROW_QUARANTINED` diagnostics. Consumers must not mistake a partial
page for a complete inventory. Each launch item also carries required `launchProfileVersion` (`2.0.0`, `3.0.0`,
`3.1.0`, `3.2.0`, `3.3.0`, or `3.4.0`) so profile-conditional metadata can be interpreted without inference.

The finalized feed remains additive across finalized compatible profile versions. `projectMetadata` and
`projectMetadataHash` remain conditional to `launchProfileVersion`: exact `3.2.0`, `3.3.0` and pending `3.4.0`
carry metadata, while legacy `2.0.0`, `3.0.0` and `3.1.0` remain additive compatibility records under their original
semantics. An item may include
server-authored `tradeAdapterDescriptor` only after exact route, PoolKey, asset, runtime and adapter review. The field
is never accepted in pack, preflight or create requests and is separate from the 10 bps behavior gate. If it is absent,
invalid or disabled, the launch remains indexed and machine-readable but consumers must show launch data only and must
not infer onsite trading from submitted metadata.

Use a stable content URI and enable browser-readable CORS for HTTPS image bytes. Wallet review verifies raw bytes
against the bound SHA-256, length, media type and dimensions before rendering; IPFS and Arweave use fixed public
gateways. If the bytes cannot be read or do not match, the review uses the digest and a placeholder. It never uploads
or substitutes content, mutates the launch, or signs automatically.

Wallet and partner root/subkeys use the same `PROGRAMMABLE_API_KEY`, CLI, and V3 create, preflight, list and status
routes within their scopes. A wallet key must use its bound wallet as `launchWallet`. A partner credential selects the
exact controller in the request but gains no signing authority; that controller still reviews, signs and broadcasts.
Partner credentials follow the same current-profile metadata requirements as wallet keys. Partner attribution is
snapshotted by the server from the authenticated credential and cannot be supplied in the create body. It is a
“Launched via” provenance label only, not verification, safety, endorsement, or an economic category.

Private launch history follows immutable partner lineage. A partner root sees every launch attributed to that partner,
including launches made by its current and rotated subkeys. A subkey sees only its own lineage and cannot read root or
sibling launches. Rotation revokes the old credential and gives its replacement the same lineage, so the replacement
retains that lineage's history. A newly issued distinct subkey starts a separate isolated lineage. Finalized public
metadata remains available through the separate public discovery surfaces.

The Router V1 permit-reissue disposition route is wallet-key-only and has no successful response. Partner credentials
recover directly by repacking and submitting a new request. Expired permits require a fresh nonce and Idempotency-Key,
and predicted addresses may change.

### Manage partner subkeys

A partner root with `partner-subkeys:manage` may create bounded child credentials through the public API. Every list,
issue, rotate and revoke call consumes the root's `subkeyAdminRequestsPerHour` budget. The root uses
the same encrypted `PROGRAMMABLE_API_KEY` environment variable as the launch CLI. A child may hold only
`custom-launch:create` and/or `custom-launch:read`; its budgets and expiry cannot exceed the authenticated root. Wallet
keys and child subkeys cannot manage other credentials. Partner creation, root issuance, suspension, and other admin
routes are private platform operations and are not part of the public OpenAPI.

List child metadata without exposing any secret:

```sh
curl --fail-with-body \
  --header "Authorization: Bearer $PROGRAMMABLE_API_KEY" \
  https://api.programmable.market/v1/partner/subkeys
```

Create `partner-subkey.json` with the exact closed body, then preserve the same file and
`$PROGRAMMABLE_IDEMPOTENCY_KEY` for an ambiguous retry:

```json
{
  "schemaVersion": "programmable.partner-subkey-request.v1",
  "displayName": "Production launches",
  "scopes": ["custom-launch:create", "custom-launch:read"],
  "budgets": {
    "prepareRequestsPerHour": 100,
    "readRequestsPerMinute": 300
  },
  "expiresAt": "2026-12-31T23:59:59.000Z"
}
```

```sh
curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer $PROGRAMMABLE_API_KEY" \
  --header "Content-Type: application/json" \
  --header "Idempotency-Key: $PROGRAMMABLE_IDEMPOTENCY_KEY" \
  --data-binary @partner-subkey.json \
  https://api.programmable.market/v1/partner/subkeys
```

The first committed issue or rotation returns `201`, `secretState: delivered-once`, and the one-time `apiKey`. Move it
directly into the child's encrypted `PROGRAMMABLE_API_KEY`; do not put it in chat, source, logs, screenshots, or a URL.
An exact replay returns `200`, `secretState: already-delivered`, and `apiKey: null`. Rotation uses
`POST /v1/partner/subkeys/{subkeyId}/rotate` with the same body and idempotency contract. Revocation uses
`DELETE /v1/partner/subkeys/{subkeyId}` and returns `revoked` or `already_revoked`. On `429`, honor `Retry-After` and
retry only the same operation. Rotation preserves the subkey's stable private launch lineage for the replacement while
the revoked predecessor can no longer authenticate. A separately issued subkey starts a new isolated lineage. Error
bodies contain a support `requestId`; a bounded `500` never contains a secret.

`verificationBundle` is required in V3. Its compilation units
are uniquely UTF-8 sorted by `compilationUnitId`; its components are uniquely UTF-8 sorted by `targetId` and exactly
cover every graph target. For the default revision-3 profile, every unit uses exact
`solc 0.8.26+commit.8a97fa7a`. The API validates exact Standard JSON bytes and SHA-256, source and contract identity,
and resolved constructor arguments against the prepared init code. URL-only source inputs fail. Decoded Standard JSON
is limited to 5,242,880 bytes per compilation unit and across all units in one request, with at most 2,048 inline
sources. Revision-2 requests retain their compatibility contract.

The graph accepts 3 to 16 acyclic direct targets, exactly one token and one hook. Complete graph input is limited to 524,288
bytes. Per-target init code is limited to 49,152 bytes and initializer calldata to 131,072 bytes. Use OpenAPI for every
nested field, enum and bound.

`agentAttestation` contains 1 to 64 unique `{ checkId, evidenceSha256 }` entries for checks the agent actually ran.
Programmable does not publish a universal check-ID catalog, fetch or assess that evidence, or adopt it as an audit,
approval or safety claim.

## Submit safely

For V4, use the [route and error recovery guide](https://programmable.market/developers/robinhood-launch-guide-v1.md#recover-by-error-code).
Create returns `202` for a new durable request or `200` for an exact idempotent replay. Detail `404 NOT_FOUND` means
check the returned `launchId`, chain and credential lineage; a public guide/coverage `404` means the deployment
does not provide that report. None of these statuses authorizes a wallet action. When preflight reports
`launchEligibility.deployable: true` with `TX_SIMULATION_PENDING`, submit the exact bytes to run the remaining server
simulation. A favorable checkpoint is not execution of the launch, swaps or fees.

`submit` proves that `launch.json` is byte identical to a fresh pack and writes its mode `0600` journal before network
access. Raw HTTP clients send `Authorization: Bearer $PROGRAMMABLE_API_KEY` only to
`https://api.programmable.market`. Retry timeout, `429` and `503` responses only with the exact persisted bytes and
idempotency key. Honor `Retry-After`.

New requests share a durable global admission cap of 120 created requests per hour and 500 per day. Exact
idempotent replay is checked first and consumes no additional capacity.

The response `requestHash` is the server's canonical idempotency digest. It is distinct from the CLI receipt's local
SHA-256 of exact `launch.json` bytes.

## Lifecycle and wallet boundary

Use `GET /v3/custom-launches/{launchId}` as the precise polling route. The path receives the API request
UUID returned as both `launchId` and `requestId`; `onchainLaunchId` is a different Router `bytes32` value. The bounded
history list can opportunistically reconcile pending rows, but returns `output: null`. It does not replace the
single-resource route. The single-resource response is the resource-level source of the exact prepared output and
failure state.

| Status | Meaning |
| --- | --- |
| `received` | The request is durably accepted. |
| `validating` | Request and graph validation are running. |
| `pending_review` | Server-side admission and the per-launch evidence decision are still running. There is no wallet transaction to sign. |
| `action_required` | One of the current profile's exact hard-blocking code-and-role rules matched. Read the exact bound report and contact support with the request ID when directed; this is not a wallet-signing stage. |
| `awaiting_funding_authorization` | EIP-3009 mode only, after the server evidence gate: review and sign the exact typed data in the connected controller wallet. |
| `funding_authorization_verified` | The separate funding signature was verified and final calldata construction can continue. |
| `simulating` | The final graph and exact Router transaction are being simulated. |
| `prepared` | The exact artifact exists. There is no wallet transaction to sign yet. |
| `authorized` | The server verified the evidence required by the selected lane, and the permit and exact wallet transaction exist. Review and sign in the controller wallet. |
| `submitted` | Canonical Router evidence matches below 64 confirmations. |
| `finalized` | The matching canonical evidence reached at least 64 confirmations. |
| `failed` or `cancelled` | The request is terminal. |

During `simulating`, a signed permit may exist only inside a worker-private simulation envelope. Public output remains
null in `simulating` and `failed`; the evidence gate controls permit and wallet-transaction exposure, not internal
permit signing needed for simulation.

Before signing, the wallet surface checks `chainId: "1"`, the connected controller as `from`, the exact production
Router as `to`, exact value and the response-contract selector and calldata. It never auto-signs or auto-broadcasts.

## Exact-source status

After a bundled request becomes finalized, provider verification is queued independently for every exclusive
component. Explorer failure never blocks or revises launch finality. `sourceVerification.status` is server-authored and
uses `queued`, `retrying`, `exact_match` or `needs_attention`. Only literal `exact_match` for every component means
Source verified. Components are uniquely sorted by UTF-8 `targetId`; non-exact rows expose no provider or evidence
digest, while exact rows keep the Sourcify v2 `match/match/match` observation explicitly non-authoritative as
`PARTIAL_NO_CBOR_EXACT_BYTES` with `releaseAuthority: false`. They separately require
`exactSourceAuthority: protected-hosted-build-finalized-transaction-bytecode` and the
`programmable.robinhood-custom-launch.exact-byte-source-build-transaction-binding.v1` composite digest covering
the protected source tree and closure, hosted build artifact, Standard JSON input, compiler binary and settings,
finalized creation transaction, and exact creation/runtime bytecode. A provider observation alone never satisfies
`exact_match`. `nextAttemptAt` exists only for queued or retrying rows. Otherwise aggregate state is fail closed: any
`needs_attention` wins, then any `retrying`, then
`queued`; aggregate `updatedAt` is the latest component timestamp. The authenticated V4 resource may omit
or null this field before finality; the V4 finalized-feed contract requires it. Clients must never infer, promote
or submit that state. Legacy requests and requests without a bundle remain compatible and unverified.

A finalized Router launch remains eligible for Explore and the connected wallet's Profile after discovery refreshes.
Router provenance is not approval, audit coverage, active liquidity, tradability or a safety claim.

## Errors and support

The service readiness endpoint is [api.programmable.market/readyz](https://api.programmable.market/readyz). Readiness
does not grant wallet signing authority. For `action_required`, preserve the resource `requestId` and exact static
report. For HTTP errors, preserve `error.requestId`. For support, send only that request ID, HTTP status, UTC time and
public error code. Never send the API key.

| HTTP | Action |
| --- | --- |
| `400` | Fix malformed JSON, fields, query values or Idempotency-Key. |
| `401` | Use an active key from the encrypted secret store. |
| `403` | Use the required scope and exact bound wallet. |
| `404` | Verify the request UUID and key without inferring another wallet's ownership. |
| `409` | Preserve the original idempotency binding. Fix a byte conflict locally before sending a new request. |
| `413` | Reduce the request to at most 8,388,608 bytes. |
| `415` | Send `Content-Type: application/json`. |
| `422` | Fix the reported source, graph, attestation, verification or permit binding. |
| `429` | Honor `Retry-After`. |
| `500` | Keep the response `error.requestId`; do not expose the key. Retry only when the operation is safe and the original bytes remain bound. |
| `503` | Honor `Retry-After` and retry only the byte identical journaled request. |

## Current boundary

Generic fee claiming and buyback management for arbitrary hooks are not live. FADE uses a specifically bound adapter;
an arbitrary Custom hook is not automatically claimable. That adapter does not create a generic capability. The
reserved `fees:claim` and `buybacks:manage` scopes remain disabled and
promise no future behavior. Public Hookbuilder and reusable-template intake are not part of this API.
