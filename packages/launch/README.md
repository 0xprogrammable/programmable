# Programmable Launch CLI

`@programmable/launch` is the source package for the Programmable Custom Launch packager and API client. It has
five source commands: `coverage`, `pack`, `validate`, `submit`, and `status`. It never signs or broadcasts a wallet transaction.
Release and installability are version-specific.

CLI `4.1.1` adds `coverage` while the active API profile remains `4.1.0`. Verify the separately published immutable
client release before installing it. The immutable `4.0.0` and `4.1.0` assets retain their original four commands.

## Install the current public Ethereum V3 release

The commands below intentionally install the published CLI `3.3.9` for Ethereum. For Robinhood V4, follow the
separate public-release checks below; this Ethereum installer does not establish V4 availability.

```sh
programmable_cli_dir="$(mktemp -d)"
curl --fail --location --output "$programmable_cli_dir/programmable-launch-3.3.9.tgz" \
  https://github.com/programmablehq/PROGRAMMABLE/releases/download/programmable-launch-v3.3.9/programmable-launch-3.3.9.tgz
curl --fail --location --output "$programmable_cli_dir/programmable-launch-3.3.9.tgz.sha256" \
  https://github.com/programmablehq/PROGRAMMABLE/releases/download/programmable-launch-v3.3.9/programmable-launch-3.3.9.tgz.sha256
(cd "$programmable_cli_dir" && shasum -a 256 -c programmable-launch-3.3.9.tgz.sha256)
npm install --global "$programmable_cli_dir/programmable-launch-3.3.9.tgz"
programmable-launch --version
```

The checksum command must report `OK`, and the version command must print `3.3.9`. Install this verified GitHub
Release asset rather than an unverified npm-registry package with the same name.

CLI `3.3.9` defaults fresh packs to the live profile `3.3.0`. It can materialize profile `3.4.0` only when that version
is selected explicitly; live remote validation rejects the preparatory profile until capabilities activate it.

The release includes `npm-shrinkwrap.json` so the runtime dependency closure is integrity-pinned. Release operators
generate the CycloneDX inventory with `npm run sbom`; that inventory and the tarball checksum are evidence for exact
published bytes, not a substitute for verifying the downloaded asset.

The public CLI source and package are licensed under the included MIT license.

The immutable V1 package remains available only for compatibility preparation and reads. New V1 and V2 submissions
are read-only fenced with non-retryable `CUSTOM_LAUNCH_V1_READ_ONLY` and `CUSTOM_LAUNCH_V2_READ_ONLY`. Existing V1
and V2 resources remain readable through their original status routes:

```sh
npm install --global \
  https://github.com/programmablehq/PROGRAMMABLE/releases/download/programmable-launch-v1.0.1/programmable-launch-1.0.1.tgz
programmable-launch --version
```

The V3 general hook profile is the public production profile. Package installation is not wallet authority: the API prepares
the exact Router transaction, then the connected controller reviews and signs it separately. The human guide is
<https://programmable.market/docs/developers/custom-launch>.

## Robinhood Chain V4 release checks

Robinhood V4 releases target Robinhood Chain Mainnet (`chainId: 4663`, `eip155:4663`). A version number, a
checkout or local `npm pack` output does not prove publication or public activation. Fetch
[live discovery](https://programmable.market/.well-known/programmable.json) and read `customLaunchApi.versions.v4`
and the matching `chains` entry before installing a V4 release or making an authenticated request.

**Blocked:** If either discovery entry has `publicAuthorization: false`, `publicWrites: false` or
`releaseReady: false`, or any required field or release evidence is missing, stop before authenticated preflight
or submission. `pending-public-discovery-promotion` and deployed Router/backend routes do not authorize public
use. Without a verified published release, treat the package as an unpublished pre-release source candidate;
local preparation is not a public release or permission to submit.

**Activated:** Only when both discovery entries have `publicAuthorization: true`, `publicWrites: true` and
`releaseReady: true`, verify the published immutable GitHub Release `programmable-launch-v4.0.0` when discovery
selects `4.0.0`, or `programmable-launch-v4.1.0` when it selects `4.1.0`, in
`programmablehq/PROGRAMMABLE`. Stop if discovery selects any other version. Require the release manifest and tarball checksum to match the advertised version,
exact source commit and downloaded tarball bytes. Install only that verified tarball and
require `programmable-launch --version` to match that release's version. The separate CLI `4.1.1` patch below can use
the same activated API profile `4.1.0`; verify its own immutable release identity. If any check fails, stop; a published artifact alone is
not public activation. This conditional procedure does not assert today's release state.

Before authenticated preflight or submission, also fetch the public
[V4 capabilities](https://api.programmable.market/v4/chains/4663/capabilities) and
[V4 readiness](https://api.programmable.market/v4/chains/4663/readiness). Require ready status, chain `4663`
and the exact advertised profile version, revision, digest, deployment and finality bindings. Follow the
[raw V4 guide](https://programmable.market/developers/custom-launch-api-v1.md) and the V4 schemas below.

V4 requires an explicit API version and chain. The CLI default remains Ethereum V3, preserving V1, V2 and V3
behavior. The V4 CLI can prepare and validate exact bytes, submit only after the public-release checks and server
authorization pass, poll the chain-scoped resource and display the exact wallet transaction. It never signs or
broadcasts:

```sh
programmable-launch status REQUEST_UUID --api-version 4 --chain-id 4663 --watch --until authorized
# Stop for separate controller-wallet review, signing and broadcast.
programmable-launch status REQUEST_UUID --api-version 4 --chain-id 4663 --watch --until finalized
```

The V4 lifecycle is `received`, `validating`, `action_required`, `authorized`, `awaiting_wallet_signature`,
`wallet_action_required`, `submitted`, `sequencer_soft_confirmed`, `ethereum_posted`, `finalized` or `failed`.
`action_required` means fix the server-authored remediation, rebuild and submit a new immutable request; it is not a
wallet action or manual approval stage. `authorized`, `awaiting_wallet_signature` and `wallet_action_required` are
wallet-handoff states, not proof of a signature or broadcast. `sequencer_soft_confirmed` is reversible;
`ethereum_posted` is not yet final; only `finalized` satisfies the configured Robinhood-to-Ethereum finality policy.

Source verification begins after finality and remains independent. `finalized` does not imply an exact source match,
and provider failure does not revise finality. Indexing, trading readiness, Explore visibility, third-party listing and
publication also remain separate states. The [V4 OpenAPI](https://programmable.market/openapi/custom-launch-v4.json),
[pack-config schema](https://programmable.market/schemas/custom-launch/v4/pack-config.json) and
[source-verification schema](https://programmable.market/schemas/custom-launch/v4/source-verification-status.json)
are integration pointers, not deployment or public-availability evidence.

Those links preserve the historical `4.0.0` contract. If live discovery selects `4.1.0`, use its
[OpenAPI](https://programmable.market/openapi/custom-launch-v4.1.json),
[pack config](https://programmable.market/schemas/custom-launch/v4.1/pack-config.json) and
[source-verification schema](https://programmable.market/schemas/custom-launch/v4.1/source-verification-status.json)
and the advertised 4.1 immutable release. Never add 4.1 fields to old request bytes.

Selected 4.1 requires a funding plan before building, exact native allocations, and user-confirmed launch and gas
budgets. A funded launch uses wallet transaction value and an atomic initial buy of at least USD 1 at permit
authorization, with positive minimum token output to the launch wallet. Read public
`GET /v4/chains/4663/initial-buy-quote`; the server independently requires a quote no older than 60 seconds and has no
stale fallback. Count the buy once within transaction value, with gas additional. A build-only plan cannot obtain a
permit. Do not increase the amount or budget without user approval; wallet-time dollar value and indexing are not guaranteed.

4.1 admission requires the exact native fee kernel for the stamped PoolKey: 20 bps (0.2%) of the gross native ETH
leg once per successful buy or sell, rounded up, separately from creator and LP fees. Fees accrue as PoolManager
native claims for `0xD88539d3c4C460136a733A3Fd60cf6BF269079da`, with permissionless claims paid only to that recipient.
Source admission is not proof of deployed state, trades or collected revenue; the CLI and API key do not claim fees.

## Install the additive CLI 4.1.1 release

This conditional procedure does not assert that the release is published. Check the immutable release and download
its four assets into an empty directory. If it is absent or any verification fails, stop; do not fall back to an
unverified npm-registry package or an older release with a different identity.

```sh
coverage_cli_dir="$(mktemp -d)"
gh release verify programmable-launch-v4.1.1 --repo programmablehq/PROGRAMMABLE
gh release download programmable-launch-v4.1.1 --repo programmablehq/PROGRAMMABLE --dir "$coverage_cli_dir"
for coverage_asset in "$coverage_cli_dir"/*; do
  gh release verify-asset programmable-launch-v4.1.1 "$coverage_asset" --repo programmablehq/PROGRAMMABLE
done
(cd "$coverage_cli_dir" && shasum -a 256 -c programmable-launch-4.1.1.tgz.sha256)
```

Require exactly the tarball, its adjacent checksum, CycloneDX inventory and release manifest for `4.1.1`. Check the
manifest's version, tag, protected production commit/tree, exact Node/npm toolchain and every asset digest. Its
`machineContractBinding` must reference `docs/operations/releases/custom-launch-v4.1.1/cli-release-binding.json`
with the matching digest at that exact source commit. That client record binds the separate coverage schemas and
references the unchanged API `4.1.0` release record by digest. The [release runbook](../../docs/operations/releases/custom-launch-v4.1.1/README.md)
describes the full source and production-evidence verification. Only after those checks pass:

```sh
npm install --global "$coverage_cli_dir/programmable-launch-4.1.1.tgz"
programmable-launch --version
```

The version must print `4.1.1`. Installation does not activate a write profile; authenticated V4 operations still
require the public-release, capabilities, preflight and wallet gates above. The public coverage read requires no key.

## Read Robinhood architecture coverage

Before building, read the separate public report. It requires no API key or query parameters:

```sh
curl --fail --silent --show-error https://api.programmable.market/v4/chains/4663/launch-coverage
```

With the separately verified CLI `4.1.1` release:

```sh
programmable-launch coverage --chain-id 4663
```

`readiness.status: ready` describes service readiness. Check `structuralFormat` and `verifierCoverage` separately:
the current graph has one role per physical target and `tokenAndHookMayShareAddress: false`. It represents one
native ETH/token pool; no-pool and multiple-pool projects require a transport extension. A declared funding model or
hook permission does not prove its execution. `proof-available` names activated server verification for the listed
constraints; a `candidate` adapter or `publicRequestSurface: none-versioned-transport-required` is not a launch route.

The report always has `requestAuthorization.requestAuthorized: false`. Use `findingObligations` to distinguish source
repair, quote refresh, funding, simulation and missing platform verifier coverage. Unknown finding codes remain
unclassified. Wider API-key permissions and caller-supplied JSON proofs cannot clear admission findings. Preserve
the intended architecture when it needs a platform extension; do not split a token/hook simply to silence a client check.

See the [coverage OpenAPI](https://programmable.market/openapi/launch-coverage-v1.json) and
[response schema](https://programmable.market/schemas/custom-launch/coverage/v1.json). If the server returns 404,
coverage discovery has not been deployed there. A timeout, unavailable report or unknown schema does not imply an
invalid API key or supported architecture. Retry the public read later. Existing clients and launch requests retain
their original contracts; this read never calls preflight, reads credentials, creates a launch, signs or broadcasts.

## V3 general hook profile

The released package `3.3.9` uses live/default general profile
`programmable.direct-native-hook-graph.v1` version `3.3.0`. The same package contains explicit preparatory support for
profile `3.4.0`; it is not accepted or authorized merely because those materials exist. Exact nullable-image `3.2.0`
requests retain their original immutable semantics, while metadata-absent `3.1.0`, `3.0.0`, and `2.0.0`
requests remain reproducible for validation and retry compatibility. The [V3 OpenAPI](https://programmable.market/openapi/custom-launch-v3.json)
is the normative request and lifecycle contract. Existing V2 and V1 resources remain readable, but their create
routes are closed. The CLI rejects legacy submit attempts locally before reading request bytes, credentials, state,
or network.

The Router primitive supports 2–16 targets. Live profile `3.3.0` retains its three-target minimum. Pending profile
`3.4.0` requires 4–16 direct CREATE2 targets inclusive of the exact canonical settlement-fee vault; token, hook and
initializer roles remain distinct and project-owned. All valid
Uniswap v4 permission masks are supported when the source declaration, compiled permissions and hook-address low bits
match. Every enabled permission must have a concrete reachable callback implementation; an interface declaration or
fallback-only route does not qualify. The 10 bps Programmable share may be additive or included in the selected total; pack derives the effective
and project values. Static pool fees and the `0x800000` dynamic-fee sentinel are supported.

Funding can be absent, carried as exact native value on the separately reviewed Router transaction, or use an unsigned
USDC EIP-3009 descriptor with an exact v2 nonce+r+s+v ABI-path patch. The connected wallet separately signs EIP-3009 data when that
mode is selected. When pending profile `3.4.0` is activated, the website may present the Router transaction only after exact source,
compiler and graph binding, objective static hard blocks, the platform admission receipt, exact Router simulation,
verified behavior evidence and verified exact 10 bps fee-path evidence all pass. Missing, not-configured or unavailable
execution remains retryable and cannot authorize; an authenticated executed failure or mutable fee path blocks the
handoff terminally. Legacy resources retain their stored evidence state. The CLI never accepts an API
key argument, decides authorization, signs, requests approval, or broadcasts either wallet action.

Revision 3 preparation binds exact source, compiler output, the complete graph and a role-aware static report. Local
validation, remote preflight, model output, and client-side findings are preparation only. The API server is the
authorization decision point and derives required evidence from the selected launch lane. No stage is a universal
audit or guarantee of safety, honeypot absence, liquidity, tradeability, or fee behavior.

## Platform fee policy

The live general V3 profile is public on Ethereum Mainnet only (`chainId: "1"`). Pending `3.4.0` remains
preparatory even though the immutable profile payload contains `productionLaunchAuthorized: true`; discovery and the
backend are the activation authorities.

Pending profile `3.4.0` always binds the frozen `programmable:settlement-fee-vault:v1`; the applicant cannot select a
different fee target. Its source SHA-256 is
`sha256:0a01ee8c22d103343d14b1d3890902e3edeecef25ea84a0f03f23a3fe8f1042b` and release binding is
`sha256:39ccdfdf8cd61620bf5c62bf07fb8428adbd66d2608b1cf3ad583343116d7ed9`. It is built with solc 0.8.26 for Paris,
optimizer 1000, `viaIR: false`, metadata hash `none`, and no CBOR. Creation/runtime Keccak-256 are respectively
`0xdbc32e835739b50f33a101a8927008fc46af4c11604f7a5da006e5c56288b21e` and
`0x92620fe3f83839334c9a264bea5bfcc819868ca5607cbd2260e5a9664dbd7554`.

The vault constructor binds the GraphFactory and `bindRoute(address)` locates exactly one distinct project-owned route
target. That route may be the hook or a custom AMM, but it must contain the single reciprocal constructor or initializer
locator back to the vault and expose matching `settlementFeeVault()` behavior. Locators establish graph identity, not
fee-path execution: server static and runtime evidence remains authoritative. Project token, hook and every unrelated
multi-contract target remain applicant-owned and arbitrary within the general admission contract. The exact claim
recipient remains `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` and the share remains 0.10% (10 bps), subject to per-launch server evidence.

The pool's LP fee is separate from this platform charge and must be disclosed separately. Generic fee claiming and
buyback management for arbitrary hooks are not live. The reserved `fees:claim` and `buybacks:manage` scopes remain
disabled.

Normal Uniswap v4 initialization sets a starting price but does not add liquidity. A project using ordinary
concentrated liquidity must fund and create its own position; volume cannot create initial liquidity from nothing.
Zero classical LP works only when the project hook and initializer implement custom accounting or hold inventory that
can exchange against incoming assets. Funding mode `none` does not make an empty ordinary pool liquid.

## Cold-agent flow

1. Produce exact Solidity Standard JSON input and compiler artifacts from one pinned build. Standard JSON sources must
   contain exact `content`; URL-only sources are rejected. Exact decoded Standard JSON is limited to 5,242,880 bytes
   per compilation unit and across all units in one request, with at most 2,048 sources per unit. Revision 3 requires
   exact solc `0.8.26+commit.8a97fa7a`.
2. Create `programmable-launch.config.json` using shipped schema
   `schemas/programmable-launch-pack-config-v3.json` and the closed config contract below. Its byte-identical public URL
   is <https://programmable.market/schemas/custom-launch/v3/pack-config.json>. Use exact file paths, constructor values,
   initializer values, salts, public source revision, and evidence files. Do not enter derived hashes.
3. Run the offline commands first:

```sh
programmable-launch pack --config programmable-launch.config.json --output launch.json
programmable-launch validate launch.json --config programmable-launch.config.json
```

Before `submit`, run the same validation with `--remote`:

```sh
programmable-launch validate launch.json \
  --config programmable-launch.config.json \
  --remote
```

Remote validation first reads public, unauthenticated `GET /v3/capabilities`, including the advertised profile,
supported shapes and limits, finding classes, scopes, fee-claim boundary, and website wallet-handoff base. It then
sends the byte-identical V3 request to authenticated `POST /v3/custom-launches/preflight`. The API key still comes
only from `PROGRAMMABLE_API_KEY` or the supported OS secret store and must include `custom-launch:create`; the CLI has
no key-valued flag. Authenticated traffic is fixed to the exact origin `https://api.programmable.market`; the release
CLI has no API-origin override. Both remote preflight and V3 submit require the exact public capability contract before
the CLI loads the key. Tests replace the transport implementation without redirecting a production key.

Preflight is a support and evidence classification, not a launch or authorization. A conforming
`programmable.custom-launch-preflight.v1` response binds `requestHash` to the server's domain-separated canonical
JCS digest of the parsed V3 request, while the CLI separately retains the raw launch-file SHA-256 for byte-race and
retry-journal integrity. The response also binds profile revision and server time and reports
one of `supported`, `supported_with_warnings`, `needs_evidence`, or `unsupported`. It exposes separate
`launchEligibility.deployable`, `routable`, and `featured` decisions, the evidence tier, finding-code arrays, static
baseline and typed remediation. The CLI rejects a response unless it explicitly confirms `quotaConsumed: false`,
`nonceAllocated: false`, `persisted: false`, `walletSignatureRequiredLater: true`, and
`walletBroadcastByService: false`. Unknown additive capability and preflight fields remain present in CLI JSON.
`quotaConsumed: false` means the preflight creates no durable launch and consumes no launch-creation quota; it does not
mean the authenticated HTTP request is unmetered. Normal route limits still apply, and a partner preflight consumes its
`prepareRequestsPerHour` budget.
Neither a favorable preflight disposition nor local checks can approve wallet handoff. The server later enforces the
objective static hard blocks and exact Router simulation. Behavior-derived positive claims require separate exact server evidence.

Use `examples/direct-native-v3-no-broadcast/README.md` shipped with the release for a no-broadcast cold-room
rehearsal. It invokes real solc, uses exact sources and artifacts, and stops after byte-reproducible `pack` and
`validate`.

Save the API key only as the encrypted environment secret `PROGRAMMABLE_API_KEY` or in the supported OS
secret store. Put the literal text `$PROGRAMMABLE_API_KEY` in agent setup or chat, never the key. On macOS, the fallback
secret-store lookup is the Keychain service `api.programmable.market`, account `PROGRAMMABLE_API_KEY`.

V3 `submit` routes only to `/v3/custom-launches`. V1 and V2 submit are rejected locally and their server create routes
are non-retryable write fences. The CLI never falls back to an older create route. Preserve the exact request bytes and
idempotency key across timeout, `429`, or `503` retries and honor `Retry-After`. At `authorized`, stop the agent flow:
the controller reviews the exact `walletTransaction` and signs it in a separate wallet flow. After a human broadcast,
use `status REQUEST_UUID --watch --until finalized`. V3 is the default status route; use `--api-version 1` or
`--api-version 2` only when reading a legacy request. `finalized`, `failed`, and `cancelled` always stop polling.

When the API returns them, `submit` and `status` promote `actionRequired`, the safe `walletHandoffUrl`, `expiresAt`,
and `secondsRemaining` alongside the complete resource. These handoff fields may appear only after the server has
verified every evidence axis required for the selected launch lane. Open the handoff in the separate website wallet flow. These
fields do not give the CLI signer or broadcaster authority, and an expired handoff must not be reused.

```sh
programmable-launch submit launch.json --config programmable-launch.config.json
programmable-launch status REQUEST_UUID --watch --until authorized
```

For `eip-3009-receive-with-authorization`, the first status command can stop at
`awaiting_funding_authorization`. The controller signs that exact funding authorization in the website wallet flow,
never in the CLI, then runs the same status command again. At `authorized`, the controller separately reviews and
broadcasts the exact Router transaction from the website. The agent can then track finality:

```sh
programmable-launch status REQUEST_UUID --watch --until finalized
```

The included rehearsal proves only offline pack and validation. It does not submit, poll, sign, or broadcast.

## Pack config V3

The top-level fields are:

- `schemaVersion`: `programmable.launch-pack-config.v3`
- `launchWallet`, `chainId: "1"`, and a nonzero lowercase bytes32 `nonce`
- `source`: relative `root`, non-empty exact `paths`, decimal `sourceLineageNonce`, and `publicOrigin` containing a
  public HTTPS `url` plus the exact lowercase 40-character Git commit containing the submitted source bytes
- `compilationUnits`: unique `{ compilationUnitId, standardJson }` entries
- `targets`: 4–16 pending profile `3.4.0` definitions inclusive of the canonical vault; exact `3.3.0` retries retain 3–16
- `pool`: exact token/hook target IDs, fee, tick spacing, and `quoteCurrency` address; use
  `0x0000000000000000000000000000000000000000` for native ETH or the exact ERC-20 address for a token quote
- `projectMetadata`: the required public token declaration and presentation input described below
- `permitWindow`: exact `validAfter` and `deadline`, no more than one hour apart
- `launchProfile`: target roles, liquidity model, funding mode, fee accounting and claim binding
- `agentAttestation`: stable agent ID, explicit millisecond UTC `checkedAt`, and checks that point to exact evidence files

Pending profile `3.4.0` requires this exact public metadata input. Ask the project owner for these values; do not invent
them and do not hand-write either derived hash:

```json
{
  "schemaVersion": "programmable.project-metadata-input.v1",
  "token": {
    "name": "Example Hook",
    "symbol": "HOOK"
  },
  "presentation": {
    "description": "Example Hook adds project-defined swap behavior for its token.",
    "image": {
      "sourcePath": "assets/token.png",
      "uri": "https://example.org/token.png"
    },
    "links": [
      { "kind": "website", "uri": "https://example.org/" },
      { "kind": "x", "uri": "https://x.com/example" }
    ]
  }
}
```

Profile `3.4.0` also requires `behaviorScenarioInputs`. These are declarative, hash-bound runner inputs, not client
assertions or an approval. Supply 1–128 ordered steps with unique `stepId`, a fixed phase and actor, an exact prepared
target, `poolManager` chain binding or `v4-actions-v1` harness, canonical `valueWei`, and bounded lowercase calldata
and hook data. The CLI derives `behaviorScenarioInputsHash`, binds it into `launchIntentHash`, and rejects scripts,
URLs, expected results, statuses, runner parameters and unknown target IDs. The network-disabled fork runner and all
vector verdicts remain server-owned. A minimal shape is:

```json
{
  "schemaVersion": "programmable.custom-launch-behavior-scenario-inputs.v1",
  "steps": [{
    "stepId": "swap-buy-small",
    "phase": "swap",
    "actor": "secondary-user",
    "target": { "kind": "runner-harness", "harness": "v4-actions-v1" },
    "valueWei": "0",
    "calldata": "0x",
    "hookData": "0x"
  }]
}
```

The project must provide enough exact scenario inputs for its required vectors. Passing local validation does not mean
the server-run vectors passed and does not create a fee, routability, liquidity or safety claim.

`token.name` is 1–64 UTF-8 bytes and `token.symbol` is 1–16 UTF-8 bytes. Both are NFC, already trimmed public
text; the symbol contains no whitespace. `presentation.description` must contain 20–4,096 UTF-8 bytes and at least
eight Unicode letters or numbers. `presentation.image` must name a non-empty local PNG, JPEG, WebP, or GIF of at most
20 MiB and 8192 pixels per dimension plus its canonical public URI. The packer derives and binds the exact SHA-256,
byte length, media type, dimensions, and source-manifest file entry; it never invents or uploads an image. `links`
must contain exactly one credential-free public HTTPS `website` and exactly one canonical X profile matching
`https://x.com/<handle>`. Up to 30 `documentation`, `telegram`, `discord`, `github`, or `other` HTTPS links are optional.

Use a stable content URI. For an HTTPS image, enable browser-readable CORS so the wallet review can fetch the raw
bytes and verify SHA-256, byte length, media type and dimensions before rendering. IPFS and Arweave use the website's
fixed public gateways for the same check. If remote bytes are unavailable or differ, the review shows the bound digest
and a placeholder; it does not replace metadata, upload content, sign or broadcast automatically.

The request contains the normalized `programmable.project-metadata.v1`, its domain-framed
`projectMetadataHash`, and a `programmable.project-token-metadata-binding.v1`. When exactly one selected token
constructor or initializer string argument clearly represents `name` or `symbol`, `pack` requires an exact match.
Constant, inherited, proxy, initializer-based and other arbitrary token designs are not rejected when a value cannot
be extracted deterministically: the declaration is still bound to the request and onchain launch ID, and the API
requires post-deployment `name()` / `symbol()` readback where supported. A mismatch or unavailable readback is public
truth; it never silently rewrites the owner's declaration. Discovery advertises
`requiredForProfileVersions = ["3.2.0","3.3.0","3.4.0"]`, `strictMetadataProfileVersions = ["3.3.0","3.4.0"]`, and
`legacyMetadataProfileVersions = ["3.2.0"]`, so exact `3.2.0`, `3.3.0` and pending `3.4.0` all carry metadata while
only exact `3.3.0` and pending `3.4.0` use the strict current policy and only exact `3.2.0` preserves its older
nullable-image semantics.

`projectMetadataHash` is SHA-256 of UTF-8 `programmable.project-metadata.v1`, one NUL byte, and JCS metadata bytes.
The launch identity uses a metadata-bound `graphBundleHash`: SHA-256 of UTF-8
`programmable.custom-graph-project-metadata.v1`, one NUL byte, and JCS
`{graphBundleHash:<unbound graph SHA-256>,projectMetadataHash}`. The receipt exposes both hashes so the website wallet
review and finalized public read model can verify the same identity. Finalized feed items also carry
`launchProfileVersion` (`2.0.0` through `3.4.0`) so a client can interpret profile-conditional metadata without
guessing. Exact legacy `3.2.0` retries preserve their original metadata rules. Exact `3.1.0`, `3.0.0`, and `2.0.0`
retries omit metadata rather than inventing it.

Each target has exactly `targetId`, `compilationUnitId`, `artifact`, `applicantSalt`, `constructorArguments`,
`initializer`, `deploymentValueWei`, `initializerValueWei`, `componentKind`, `declaredHookPermissions`, and
`runtimeImmutables`.
Constructor arguments are JSON ABI values. Use `{ "target": "another-target-id" }` in an ABI `address` slot; `pack`
encodes a zero placeholder and derives the locator and resolved CREATE2 address. `initializer` is either `null` or
`{ "function": "functionName", "arguments": [...] }`.

`runtimeImmutables` is always an array. Use `[]` when the compiler artifact has no immutable references. Otherwise it
must cover every compiler immutable ID exactly once with its ABI type and either a literal or a target reference, for
example `{ "immutableId": "0", "abiType": "address", "target": "token" }`. `pack` materializes the exact deployed
runtime from those compiler ranges and values before deriving its hash; missing, duplicate, or extra bindings stop
packaging.

The V3 `launchProfile` uses schema
`programmable.direct-native-hook-graph-profile-selection.v3`, profile
`programmable.direct-native-hook-graph.v1`, and revision `3`. It names `tokenTargetId`, `hookTargetId`,
`initializerTargetId`, and `platformFeeBindingTargetId`; selects funding mode `none`,
`wallet-transaction-value`, or `eip-3009-receive-with-authorization`; selects `additive-platform-share` or
`inclusive-selected-total`; binds either `executed-gross-declared-quote` with `declared-quote-currency` or
`settled-input-before-platform-fee` with `input-currency`; selects
`immutable-payout-recipient` or `claim-authority-selected-recipient`; and supplies both applicant-selected fee values.
Those applicant-selected fee values are decimal hundredths of a bip from `0` through `100000` for both accounting
modes. The server enforces the same 1,000 bps / 10% applicant cap. The separate `1000` platform units are added in
additive mode or included in the selected total in inclusive mode. `payoutRecipient` is present only for the immutable mode and
must equal `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`. The EIP-3009 mode additionally requires the exact
`fundingAuthorization` and unsigned `fundingSignaturePatch` top-level objects; the other funding modes forbid them.
For new requests the patch input contains exactly `targetId`, `nonceArgumentPath`, `rArgumentPath`, `sArgumentPath`,
and `vArgumentPath`. Each path is a non-empty array of zero-based ABI indices: its first index selects a top-level
initializer input and later indices descend only static tuples or fixed-size static arrays. The four distinct zero
leaves must resolve to `bytes32`, `bytes32`, `bytes32`, and `uint8`. The CLI derives and proves them from the compiled
ABI and emits `programmable.eip3009-authorization-patch.v2`; applicant byte offsets are absent from the profile 3.4
schema. Legacy r/s/v-only v1 descriptors remain readable for exact retries and emit
`FUNDING_SIGNATURE_PATCH_V1_LEGACY`, but new integrations must use v2.
`none` requires zero native deployment and initializer value, `wallet-transaction-value` requires a nonzero exact
Router transaction value, and EIP-3009 funding requires zero native deployment and initializer value.

The request also binds one honest liquidity model. `external-concentrated-liquidity` declares
`liquidity_required`: the graph may deploy and initialize the pool identity, but it is not presented as tradeable until
someone adds normal v4 liquidity. `launch-seeded-concentrated-liquidity` binds the exact graph target that seeds the
position and declares the required seed, custody/withdrawal, and buy/sell assessment vectors.
`hook-inventory-custom-accounting` binds the hook inventory path and requires a swap return-delta permission plus
buy, sell, delta-solvency, and backing/withdrawal assessment vectors. A request may only declare those vectors as
`required` with `requestClaimsExecution: false`; it never declares the vectors executed or passed, and neither
packaging nor Router simulation is presented as that evidence. Omitting this field in an
older config is normalized by the CLI to the explicit external-liquidity model, so the emitted request remains fully
hash-bound and never implies that trading volume can create liquidity from nothing.

`applicantSalt` is either a fixed lowercase bytes32 or, for the hook only, a closed deterministic grind request:

```json
{
  "mode": "deterministic-hook-permission-grind-v1",
  "start": "0",
  "maxAttempts": "262144"
}
```

The packer fixes the source bundle, wallet, nonce, target init code and declared permissions first. It then tries salts
in unsigned integer order and selects the first CREATE2 hook address whose low 14 bits equal those permissions. A failed
bounded search stops with `HOOK_SALT_GRIND_EXHAUSTED`; it never substitutes different permissions.

`pack` derives bytecode and the exact solc build from the artifact, exact Standard JSON bytes and SHA-256, sorted source
manifest, source descriptor, graph bundle, address locators, CREATE2 predictions, agent evidence hashes, verification
bundle, graph hash, verification hash, and exact request-byte hash. It rejects unresolved libraries. It derives the
full expected runtime hash from the compiler runtime template and the required `runtimeImmutables`; it never accepts a
hand-written runtime hash.

## Machine-readable remediation

Local integration failures expose `programmable.launch-cli-diagnostic.v1` on the thrown error and as canonical JSON
after `Programmable CLI diagnostic:` on stderr. The object includes a stable code, stage, expected and observed values,
typed `requiredChange` and `resumeAt` instructions, and public documentation/catalog URLs. Catalog fragments are
resolvable JSON Pointers such as `#/remediations/0`, rather than non-resolving code-shaped anchors. Stable local repair
codes include `PACK_CONFIG_V3_MISSING`,
`PACK_CONFIG_V3_INVALID`, `FUNDING_AUTHORIZATION_PATCH_PATH_INVALID`, and the legacy migration code
`FUNDING_SIGNATURE_PATCH_NOT_TOP_LEVEL`. Raw source-string indicators never become hard safety findings; a legacy
descriptor may instead return nonblocking `FUNDING_NONCE_DERIVATION_CONFLICT_SUSPECTED` or
`FUNDING_NONCE_CONFORMANCE_UNPROVEN`. Exact Router simulation is one required input, not authorization by itself.

V3 deterministic packaging permits project-owned proxy or delegating hook runtimes. Exact source, compiler, config,
runtime, graph, and request binding proves reproducibility, not safety approval. Role-aware platform admission,
server-executed behavior, fee, liquidity and routability evidence, wallet authorization, deployment, and availability
remain separate gates; admission does not certify fee behavior.

The deterministic source-content digest is SHA-256 of RFC 8785/JCS bytes for
`{schemaVersion:"programmable.source-bundle-content.v1",entries:[manifest fields plus contentBase64]}`. Entries are
unique and sorted by UTF-8 path bytes; `contentBase64` encodes exact file bytes or exact UTF-8 symlink-target bytes.

The closed API request body is limited to 8,388,608 bytes. The decoded Standard JSON limit leaves room for canonical
base64 and the rest of the request envelope; `pack` and `validate` enforce both limits before network access.

For Robinhood V4, `metadataImage.mediaTypes` is exactly `image/png` and `image/gif`, and GIF input must contain one
frame. JPEG, WebP, and animated GIF remain valid in the applicable immutable V3 profiles but are not V4-admitted.
The V4 packer binds the exact image bytes and rejects unsupported or multi-frame input before network access.

## Retry and local state

`submit` requires the pack config and first proves that `launch.json` is byte-identical to a fresh pack of the exact
source and build artifacts. It then stores the idempotency key, API origin, request SHA-256, and the exact request bytes
before the first network call. State defaults to the OS application state directory and can be redirected with
`PROGRAMMABLE_LAUNCH_STATE_DIR`. Reusing a key with different bytes fails locally. Timeouts, transport ambiguity,
`503`, and `429` retry only the persisted bytes with the same key. `Retry-After` supports both seconds and HTTP dates.

The API key is never written to the journal or output. For support, send only the response `requestId`, HTTP status,
UTC time, and the public error code. Never send the API key.

Wallet keys, partner root keys, and bounded partner subkeys all use the same `PROGRAMMABLE_API_KEY`, CLI commands, and
V3 create, preflight, list and status endpoints. Launch operations use `custom-launch:create` and reads use
`custom-launch:read`; only a root partner key may hold `partner-subkeys:manage`. A wallet key requires `launchWallet`
to match its wallet binding. A partner credential selects the exact controller in the immutable request but gains no
wallet authority; that controller still owns the launch and separately signs and broadcasts. The current Router V1
permit-reissue disposition endpoint is the wallet-key-only exception.
When a partner credential is used, the server may return immutable `partnerAttribution`; callers cannot supply or
override it. “Launched via” is provenance only, never verification, a safety mark, endorsement, or an economic category.

Partner history follows immutable lineage. On both list and single-resource status reads, a partner root reads every launch
attributed to its partner, including current and rotated child launches. A child can read only its own lineage, never
root or sibling launches. Rotating a subkey revokes the old credential and gives the replacement the same lineage,
preserving that lineage's private launch history while the revoked predecessor can no longer authenticate; a separately
issued child starts a new isolated lineage. Every subkey-admin route consumes the root's
`subkeyAdminRequestsPerHour` budget.

For a failed, unconsumed wallet-key `PERMIT_EXPIRED` launch, the Router V1 permit-reissue endpoint returns a typed `409`;
this release defines no `2xx` reissue response and reserves no replacement nonce or permit. Partner credentials are not
authenticated on that endpoint. In either case, repack and submit a new launch request with a fresh nonce and new
Idempotency-Key. All fee and security gates run again and predicted addresses may change.

API errors retain the server's structured `error.details` on `ProgrammableApiError.details.serverDetails` for
programmatic diagnosis and expose validated `programmable.custom-launch-remediation.v1` objects separately. CLI
stderr renders only bounded typed fields; arbitrary request, source, authorization, and signature echoes are not
printed.

## Scope boundary

This package prepares, submits, and tracks Custom launches. It contains no approval, platform signer, wallet signing,
wallet broadcast, fee-claim, buyback-management, or public Hookbuilder logic. Generic fee claims and buyback management
for arbitrary hooks are not active. FADE uses a specifically bound adapter, not a generic capability. The reserved
`fees:claim` and `buybacks:manage` scopes grant no operation.
