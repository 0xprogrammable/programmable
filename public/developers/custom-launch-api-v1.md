# Programmable Custom Launch API

## Shared token and hook: MultiRole V2

On Robinhood chain 4663, a token and hook that share one physical contract use the separate MultiRole V2 lane.
The existing 4.1 profile, CLI and distinct-role graph remain their own contract. Do not split the project or
substitute profile fields to force it through that older graph.

Read public [MultiRole V2 capabilities](https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/capabilities)
without a key and check current readiness and context before packing. If unavailable, stop before authenticated
submission. Follow the [MultiRole V2 guide](https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/guide.md)
and [Node 24 client](https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/client.mjs) for the exact
packer and `preflight -> create -> status` flow. Preserve exact request bytes and the same idempotency key on retries.
Preflight/create requires `custom-launch:create`; status/list requires `custom-launch:read`, with the key's chain
4663 grant and controller binding. The controller separately reviews, signs and broadcasts the wallet transaction.

The automatic economic verifier accepts the exact Native20 recipe and supported constructor configuration.
Different source code or unknown economics return `evidence_required`; follow the missing verification requirements.
This is not a generic audit of arbitrary hook code. An unavailable capability response stops authenticated submission.
The 4.1 funding and CLI instructions below apply to that existing profile; MultiRole uses its own guide above.

## Fees and analytics

Robinhood Native20 Custom Launches charge **20 bps (0.20%)** for Programmable per successful buy or sell, separately from creator and pool fees. The [fees guide](https://programmable.market/docs/economics) defines the calculation and claim path. The [Dune dashboard](https://dune.com/programmablehq/analytics) reports finalized Custom Launch stamps, creator rewards in ETH and protocol revenue in ETH. Fee totals include unclaimed accruals from supported native fee events; gas, liquidity, withdrawals and historical fee models without those events are excluded. The dashboard refreshes every 24 hours.

## Start with the launch details

The shared intake is published at `customLaunchApi.intake` in [live discovery](https://programmable.market/.well-known/programmable.json). Complete it before following either chain-specific guide.

1. Confirm the project's intended chain: Ethereum Mainnet (1) or Robinhood Chain Mainnet (4663). Reuse an explicit earlier answer; ask if the choice is missing, ambiguous or contradictory. Uniswap V4 identifies a protocol, not a chain. Never infer the chain from the API key, connected wallet or project defaults, and never fall back to another chain when a gate fails.

2. Before building or packing, collect the token name, ticker/symbol, useful public bio/description, actual image file and its public URI, website and X profile. Reuse answers and assets already supplied by the user; ask only for missing or conflicting values. Ask whether Telegram, Discord, documentation, GitHub or other links are available; these additional links are optional. Never invent metadata, image bytes or public URLs. Use the selected chain's image rules.

3. Before submission, show the complete summary: chain, launch wallet, token name, ticker, bio, image preview and public URI, website, X and every additional link. Resolve contradictions with the user. The website shows the same bound metadata read-only before wallet authorization. To change metadata, repack and revalidate a new request. API access does not authorize the agent to sign or broadcast; the controller reviews and signs the exact wallet action separately.

Do not begin chain-specific implementation until the chain is explicit. Do not build, pack or submit while required intake values are missing or contradictory. Existing explicit user answers remain valid; do not ask for them again.

For the image, supply the actual local bytes and their matching public HTTPS, IPFS or Arweave URI. Ethereum V3 accepts PNG, JPEG, WebP or GIF; Robinhood V4 accepts PNG or single-frame GIF. A filename or invented image URL is not a supplied image.

## Robinhood: choose the funding plan before building

The Robinhood-only intake is published at `customLaunchApi.intake.chainSpecific.robinhood`. Ethereum instructions are unchanged.

Robinhood only (chain 4663): before funding-dependent implementation, ask whether buyers will build the capital, the creator will provide starting liquidity, or the project uses a hybrid or custom source. Reuse an explicit earlier answer. These are conversation choices, not API enum values or a project allowlist. A bonding curve describes pricing; it does not by itself prove funding or repayment reserves.

Collect the initial token inventory, real and virtual reserves, any liquidity assets and amounts, funding wallet, initial buy and minimum token output, available capital and gas budgets, gas payer, and intended launch state. Clarify who funds each step and when trading can actually begin. Zero initial ETH principal is not a free deployment. An initialized empty pool is not a funded or tradable curve; virtual reserves are not spendable ETH. Do not invent a sponsor or promise buyer demand.

Before building, show the preliminary capital requirement separately from estimated deployment and transaction gas, with assumptions and unknowns. Check available balances on Robinhood Chain when the funding wallet is known. Do not count assets on another chain as available Robinhood funding. If the budget is insufficient or uncertain, resolve the funding plan with the user; continue building before funding only when the user explicitly accepts that launch is still unfunded. Never silently change the chain, launch model or budget.

For Robinhood profile 4.1, when selected by live discovery and capabilities, every funded launch requires an atomic initial buy worth at least USD 1 at the server reference rate. Before building, read GET /v4/chains/4663/initial-buy-quote without an API key and show its minimum native ETH amount plus separate gas. Have the user confirm the exact buy amount and positive minimum token output; do not raise the amount or budget automatically. The buy must pay real tokens to the launch controller in the same transaction; failure rolls back the launch. Budget the initial buy once within total transaction value. The server obtains its own fresh quote at admission and may require a newly confirmed package if the amount falls below the current minimum. A first buy does not guarantee third-party indexing. Historical 4.0 requests keep their original contract; never invent 4.1 fields for them.

Read the selected Robinhood platformFeePolicy and enforcement status from discovery and capabilities. Native20 charges 20 bps (0.20%) of the gross native ETH amount once per successful buy or sell, rounded up to the next wei. The full 20 bps belongs to Programmable; creator and pool LP fees are additional. For example, a 1 ETH gross trade credits 0.002 ETH to Programmable. The fixed platform recipient is 0xD88539d3c4C460136a733A3Fd60cf6BF269079da. Fees accrue as PoolManager native claims; anyone can trigger a claim, but payment goes only to the configured recipient. Historical contracts retain their fee models. Show gas, liquidity and initial buy separately; do not count claims as new revenue. API keys cannot claim fees, and accrual does not prove a revenue-processing or bridging transaction.

Before submission, summarize the funding source, pricing and reserve model, exact initial assets and amounts, initial buy and minimum token output, intended launch state, platform recipient and all fees alongside the project metadata. Map the plan to the selected V4 schema's actual funding and liquidityModel fields. Do not add invented fields to a frozen request. Verify that the packed graph and total wallet transaction value match the agreed plan; an initial buy already included in that value is not an extra cost. Resolve mismatches by changing and revalidating the request with the user.

Before the Robinhood wallet action, review the bound transaction value separately from a fresh gas estimate and the current native balance. Mark unavailable estimates as unknown, never zero; resolve an unaffordable or unknown funding requirement before sending. The website's bound summary and transaction review do not prove economic safety or future liquidity. Signing and sending remain the controller's separate wallet actions.

## API versions and release gates

V3.3 is public and live: general custom-hook launch creation, list and single-resource reads are available at
`https://api.programmable.market` for wallet keys, partner roots and bounded partner subkeys. V2 and V1 history remain
available for existing requests, and their schemas remain published. Fresh authenticated `POST /v2/custom-launches`
and `POST /v1/custom-launches` are permanently read only with non-retryable `409 CUSTOM_LAUNCH_V2_READ_ONLY` and
`409 CUSTOM_LAUNCH_V1_READ_ONLY`. On Ethereum, only V3.3 accepts new submissions. Legacy Registry and GitHub submission intake is
closed.

The public Ethereum V3 CLI is `@programmable/launch` `3.3.9`. For Robinhood V4, read the live
[discovery manifest](https://programmable.market/.well-known/programmable.json). Before authenticated preflight or submission, require both
`customLaunchApi.versions.v4` and `chains[]` for `chainId: 4663` report `publicAuthorization: true`,
`publicWrites: true` and `releaseReady: true`. If either entry is false, incomplete or missing, stop before
authenticated preflight or submission. Verify the immutable official GitHub Release, exact source commit, release
manifest and tarball checksum from `customLaunchApi.versions.v4.cli.release` for the API's original client release.
A separately published compatible client patch requires its own verified immutable release and binding to that API
profile. A repository source candidate is not an installable release.

Match the advertised profile and immutable CLI release: historical `4.0.0` and successor `4.1.0` have different
funding and admission contracts. This guide does not activate either version. Preserve historical request bytes;
never add successor fields to an old launch or assume a source candidate is the currently accepted version.

API profile `4.1.0` and CLI `4.1.1` are different identities: the latter adds the public coverage command while
retaining the former's launch contract. Verify each selected client's own release evidence; keep the historical
4.0.0/4.1.0 assets and API profile pins unchanged. The public HTTP reports need no CLI upgrade.

V2 detail reads are observation-only while an existing request is `prepared` or `simulating`: GET does not advance
simulation or authorization and cannot expose a new `walletTransaction`. Existing `authorized` and `submitted`
reconciliation and finalized reads remain available.

Normative public V3 OpenAPI: <https://programmable.market/openapi/custom-launch-v3.json>

V2 compatibility OpenAPI: <https://programmable.market/openapi/custom-launch-v2.json>

V1 compatibility OpenAPI: <https://programmable.market/openapi/custom-launch-v1.json>

Human guide: <https://programmable.market/docs/developers/custom-launch>

Readiness: <https://api.programmable.market/readyz>

## Robinhood Chain V4

Start with the [Robinhood launch workflow](https://programmable.market/developers/robinhood-launch-guide-v1.md)
before building. Read public `GET /v4/chains/4663/launch-guide` and `GET /v4/chains/4663/launch-coverage` without a key,
query parameters or body. Their separate guidance and coverage contracts do not modify the frozen launch schemas.
The guide uses `programmable.robinhood-launch-guide.v1`; its workflow stages, scenario assessments and error
recovery explain what to do next. A `404` means that deployment does not provide the report; do not rotate a key,
infer support or automatically fall back to another launch route.

Robinhood Chain Mainnet is `chainId: 4663` and `eip155:4663`. Its public self-serve availability is derived from
verified release evidence in the live discovery manifest. While `pending-public-discovery-promotion` or any of
`publicAuthorization: false`, `publicWrites: false` and `releaseReady: false` is reported, stop before submission.
When both discovery entries pass all three gates, follow the published V4 CLI release coordinates and fetch current
capabilities and readiness. The authenticated API server selects `robinhood-launch-readiness` or
`robinhood-production-launch` from the chain binding; callers cannot select a policy profile.

Create one platform API key at <https://programmable.market/developers/api-keys> and provide it through
`PROGRAMMABLE_API_KEY`. Follow the user's explicit Ethereum or Robinhood choice, then verify that chain's discovery
contract and the grants reported for the key. A grant does not select the chain. The key authorizes API requests; the user separately reviews and signs their onchain launch
transaction and pays gas.

Public guide, coverage, capabilities, readiness, initial-buy-quote and finalized-feed reads need no API key.
Authenticated preflight/create needs `custom-launch:create`; list/detail reads need `custom-launch:read`. The
credential also needs a chain `4663` grant and access to the intended controller/resource lineage. Read-only and
module-contribution keys do not acquire launch-write permission from this guide.

V4 contract pointers:

- `GET /v4/chains/4663/capabilities`
- Separate public coverage read: `GET /v4/chains/4663/launch-coverage` (no API key, query parameters or body)
- `POST /v4/chains/4663/custom-launches/preflight`
- `POST /v4/chains/4663/custom-launches`
- `GET /v4/chains/4663/custom-launches/{launchId}`
- `GET /v4/chains/4663/finalized-custom-launches`
- Historical 4.0 OpenAPI: <https://programmable.market/openapi/custom-launch-v4.json>
- Historical 4.0 pack config: <https://programmable.market/schemas/custom-launch/v4/pack-config.json>
- Historical 4.0 source verification: <https://programmable.market/schemas/custom-launch/v4/source-verification-status.json>
- Historical 4.0 policy: <https://github.com/programmablehq/Launch-Policy/blob/main/policy/custom-launch-admission-v4.json>
- When discovery selects 4.1, use its [OpenAPI](https://programmable.market/openapi/custom-launch-v4.1.json),
  [pack config](https://programmable.market/schemas/custom-launch/v4.1/pack-config.json),
  [source verification](https://programmable.market/schemas/custom-launch/v4.1/source-verification-status.json)
  and [admission descriptor](https://github.com/programmablehq/Launch-Policy/blob/main/policy/custom-launch-admission-v4.1.json).

Use only `Authorization: Bearer $PROGRAMMABLE_API_KEY`. No API key argument, request body field or alternate secret
name is part of this contract. The key cannot sign or broadcast and cannot bypass server validation. Historical 4.0 supports
no funding and exact wallet transaction value. A funded 4.1 launch requires positive wallet transaction value and
the funding plan below; ERC-20 settlement still needs separate proof. Project-owned token
and hook targets, 3–16 graph targets and all fourteen hook permissions are structural support, not behavior or safety
claims. `feeBehaviorClaim` is false; generic fee claiming and generic buyback management are not live. External
indexers may lag or omit chain data, so finalized Router evidence and Programmable indexing state remain distinct.
Legacy Registry and GitHub intake are closed.

Before choosing an architecture, read the separate
[launch coverage report](https://api.programmable.market/v4/chains/4663/launch-coverage),
[coverage OpenAPI](https://programmable.market/openapi/launch-coverage-v1.json) and
[response schema](https://programmable.market/schemas/custom-launch/coverage/v1.json). `readiness.status: ready`
describes the service. Check `structuralFormat` and `verifierCoverage` separately: the current format uses one role
per physical target, explicitly reports `tokenAndHookMayShareAddress: false`, and represents one native ETH/token
pool. For a same-address token/hook, check the separate [MultiRole V2 lane](#shared-token-and-hook-multirole-v2)
and its current capabilities. No-pool designs and multiple pool keys still need their own compatible transport
and evidence. Preserve the intended project architecture; do not split a token/hook just to satisfy the older format.

The report always has `requestAuthorization.requestAuthorized: false`. Listed hook permissions and funding models
are declarations, not execution evidence. `proof-available` applies only to the named server adapter and its exact
constraints; candidates and `publicRequestSurface: none-versioned-transport-required` do not create a public route.
Use `findingObligations` to distinguish source repair, funding, quote refresh, simulation and missing platform
verification. Keep unknown codes unclassified. Wider API-key scopes or caller-supplied JSON proofs cannot clear a
finding. A missing coverage endpoint, timeout or unknown report version does not mean the key is invalid or the
architecture is supported. Retry the public read later without rotating credentials. Still use the original
preflight, server admission and separate wallet handoff for the exact launch request.

CLI `4.1.1` adds `programmable-launch coverage --chain-id 4663`; verify its separate immutable release before
installing. The API profile remains `4.1.0`. Existing 4.0.0 and 4.1.0 release assets keep their original commands.
Source documentation does not prove publication. The direct public GET needs no CLI upgrade and does not modify
any existing launch contract.

V4 metadata images are exactly PNG or single-frame GIF, as published by `metadataImage.mediaTypes` and `gifFrames`.
JPEG, WebP, and animated GIF are rejected by the V4 packer before any network request.

The [zero-funding Robinhood example](https://github.com/programmablehq/PROGRAMMABLE/tree/production/packages/launch/examples/robinhood-v4-no-broadcast) documents historical `4.0.0` only. It is not a valid fresh 4.1 launch recipe. For selected 4.1, use the [native-20-bps example](https://github.com/programmablehq/PROGRAMMABLE/tree/production/packages/launch/examples/robinhood-v4-native20), pin the protected source revision and verify the advertised immutable CLI before building.

The historical example keeps its PoolManager immutable and rejects callbacks from other callers. Its permit includes a finalized Robinhood checkpoint while preserving the one-hour maximum lifetime; finalized blocks can trail the API clock by many minutes. An initialized empty pool does not prove liquidity or tradability.

When discovery selects **4.1**, agree the funding source and pricing model before building. Include the required
`fundingPlan`, separate initial liquidity, initial buy, reserves and other native allocations, and bind their sum to
the exact wallet transaction value. Confirm `maxLaunchValueWei` and `maxGasCostWei`; gas is additional. A build-only
plan cannot obtain a launch permit, and buyer-funded or virtual-reserve declarations do not create spendable funds.

Every funded 4.1 launch requires an atomic initial buy of at least **USD 1 at permit authorization**. Read public
`GET /v4/chains/4663/initial-buy-quote` before building, confirm the native amount and positive minimum token output
to the launch wallet, and budget the buy once inside transaction value. The server obtains its own quote no older
than 60 seconds, without stale fallback; it cannot raise the user's amount or budget automatically. The reference
feed is on Ethereum, execution stays on Robinhood, and dollar value at wallet execution or external indexing is not guaranteed.

4.1 admission requires the exact native fee kernel for the stamped PoolKey. It accrues **20 bps (0.2%)** of the gross
native ETH leg once per successful buy or sell, rounded up, separately from creator and LP fees. PoolManager native
claims belong to `0xD88539d3c4C460136a733A3Fd60cf6BF269079da`; permissionless claiming pays only that fixed recipient.
Admission does not prove deployed vault state, a completed trade or collected revenue. API keys do not sign or claim fees.

A bounded external-contract reference is allowed only when the protected API server verifies its exact
`eip155:4663` address, live runtime hash, source-verification evidence, declared graph role and checkpoint. Arbitrary
or unbound references gain no trust and block admission. These checks are not public-activation or behavior evidence.

Foundation source commitment:
`0xe87f5edc2dc839bd87a26a80cb53f14b021e603a1753d27aae3a02862058d730`. By itself it binds reviewed source, not a
deployed address. Sourcify v2 provider-native `match` is required; exact source authority is the separate protected-build/finalized-bytecode binding. Robinhood Blockscout is optional, unproven and degraded; it cannot
support an exact-source claim or block or revise finality.

Activated discovery carries non-null V4 `deploymentEvidence` for its deployed roots. Production clients must
fetch and match the exact deployment ID and descriptor digest, foundation source commitment, finality-policy digest,
finalized block, pinned finalized-evidence reference, and address/runtime-hash/start-block tuples for the Programmable
Router, GraphFactory, PermitAuthority Safe and relevant Uniswap roots. Partial or stale evidence cannot activate or
promote the lane.

### V4 lifecycle and wallet handoff

The V4 resource uses these exact statuses:

| Status | Meaning |
| --- | --- |
| `received` | The immutable request is durably accepted. No wallet action exists. |
| `validating` | Server validation, admission, reference checks and exact Router simulation bindings are running. |
| `action_required` | Fix the server-authored remediation, rebuild and submit a new immutable request. This is not a wallet action or manual approval stage. |
| `authorized` | The server gates passed and the exact wallet transaction is bound. It is not signed or broadcast. |
| `awaiting_wallet_signature` | The controller must review and sign the exact transaction through the separate wallet handoff. |
| `wallet_action_required` | The controller must verify chain `4663`, sender, Router, value and calldata, then submit through the wallet. |
| `submitted` | The exact wallet transaction was submitted; no chain checkpoint is implied. |
| `sequencer_soft_confirmed` | Robinhood sequencer evidence exists but remains reversible. |
| `ethereum_posted` | The Robinhood batch is posted to Ethereum but has not satisfied the finality policy. |
| `finalized` | The exact launch evidence satisfies the published Robinhood-to-Ethereum finality policy. |
| `failed` | Processing is terminal. Read the bound failure and remediation before creating a new request. |

The CLI only prepares, validates, submits request bytes, polls status and displays the exact transaction. It never
signs or broadcasts. Set `LAUNCH_ID` to the returned `launchId`, not `requestId`. Guard V4 polling with the explicit API version and chain:

```sh
programmable-launch status LAUNCH_ID --api-version 4 --chain-id 4663 --watch --until authorized
# Stop for separate controller-wallet review, signing and broadcast.
programmable-launch status LAUNCH_ID --api-version 4 --chain-id 4663 --watch --until finalized
```

Provider source verification starts after `finalized` and remains independent. Finality does not imply
`sourceVerification.status: exact_match`; verification retries or failures do not revise finality. Programmable
indexing, third-party indexing, trading readiness, publication and public announcements are separate outcomes. The
deployed V4 routes and source candidate prove neither public write activation nor any of those independent outcomes.

The live unauthenticated `GET /v3/finalized-custom-launches` response uses top-level `launches` and required top-level
`quality`. Quality contains `status` (`complete` or `partial`), `sourceRowCount`, `publishedRowCount`,
`quarantinedRowCount`, and row-indexed `FINALIZED_ROW_QUARANTINED` diagnostics. A partial page is not a complete
inventory. Each launch item also carries required `launchProfileVersion` (`2.0.0`, `3.0.0`, `3.1.0`, `3.2.0`,
`3.3.0`, or `3.4.0`) so clients can interpret profile-conditional metadata without inference.

## Existing-project integration

The API key is scoped API authorization, not an instruction bundle or wallet authority. Start every cold-agent run at
<https://programmable.market/.well-known/programmable.json>. Read `customLaunchApi.partnerCredentials` to distinguish
partner roots and bounded subkeys from wallet keys. Then read `customLaunchApi.agentIntegration` and fetch the advertised
machine-readable remediation catalog:
<https://programmable.market/policies/custom-launch-agent-remediation-v1.json>. The catalog, this guide, V3 OpenAPI and
the pinned CLI release are the complete public integration path. There is no project allowlist or private approval
step.

Fetch public `GET https://api.programmable.market/v3/capabilities`, then use the exact state machine
`pack -> validate --remote -> submit -> status --watch --until authorized -> wallet -> status --watch --until
finalized`. `validate --remote` first repeats local byte-identical
validation and then posts those same bytes to Bearer-authenticated `POST /v3/custom-launches/preflight`. The preflight
uses scope `custom-launch:create`, consumes no launch-creation quota, allocates no nonce, persists no launch, requires a
later wallet signature and never broadcasts. `quotaConsumed: false` does not mean the HTTP call is unmetered: its
ordinary authenticated route rate budget still applies, and partner preflight counts against `prepareRequestsPerHour`. `wallet` is a
separate connected-controller action, not a CLI command.
Authenticated CLI traffic is fixed to exact origin `https://api.programmable.market`; there is no origin override.
Local CLI results and preflight prepare and classify the exact request; neither is the launch decision. After durable
submission, the API server independently enforces the objective static hard blocks and exact Router simulation before
it exposes a wallet handoff. Missing or unavailable behavior execution leaves behavior, fee, liquidity and routability
claims unverified; an authenticated executed failure blocks the handoff. A client, model or caller attestation cannot
declare evidence verified or bypass a server gate.

For an existing repository, pin the exact public source object, compile every direct graph target with
`solc 0.8.26+commit.8a97fa7a`, map the distinct token, hook and initializer roles plus all address dependencies, declare
the exact permission mask, and choose the real funding, liquidity, fee, custody and withdrawal behavior. Create
`programmable-launch.config.json` with `schemaVersion: programmable.launch-pack-config.v3` and validate it against
<https://programmable.market/schemas/custom-launch/v3/pack-config.json>. The CLI derives every digest, locator, CREATE2
address and request byte; never copy or hand-write them.

USDC EIP-3009 projects must accept and forward the CLI-derived descriptor exactly. The funding domains are
`programmable.direct-native-hook-graph.funding-intent.v1` and
`programmable.direct-native-hook-graph.funding-nonce.v1`; project code must not replace them with an application-specific
domain or nonce. Current authorization patch V2 binds four distinct zero ABI leaves: `bytes32 nonce`, `bytes32 r`,
`bytes32 s` and `uint8 v`. Configure 1–16 zero-based ABI argument indices from 0 through 255 for each leaf. Paths can
descend static tuple components and fixed arrays but not dynamic parents. The CLI derives exact offsets from the compiled ABI and
proves canonical decode and re-encode; applicants never submit offsets. The backend later inserts only the derived
nonce and verified signature.

Tooling may report `FUNDING_NONCE_DERIVATION_CONFLICT_SUSPECTED` or
`FUNDING_NONCE_CONFORMANCE_UNPROVEN` when source, ABI and compiler artifacts cannot prove complete nonce dataflow
offline. These are nonblocking warnings, not conformance or safety claims. Inspect a real conflict before submitting.
The mandatory exact Router simulation is one server-side execution-compatibility check for the prepared transaction; a
successful simulation is not by itself the server decision or a safety, admission, liquidity, fee-behavior or
economic-solvency claim.

Pool initialization does not add liquidity, volume cannot create initial liquidity from nothing, and V3 does not
inject Classic liquidity. Bind the implementation's actual `external-concentrated-liquidity`,
`launch-seeded-concentrated-liquidity` or `hook-inventory-custom-accounting` model. After submission,
`action_required` means fix the exact bound target/source finding, rebuild, repack and submit a new immutable request.
Retrying unchanged bytes or asking for a manual allowlist cannot bypass it.

## V3 general hook boundary

The `programmable.direct-native-hook-graph.v1` document is the V3 production request, resource and wallet-handoff
contract. The default profile uses `schemaVersion: programmable.direct-native-hook-graph-profile.v3`,
`profileRevision: 3` and `profileVersion: 3.3.0`; its selection binding uses
`programmable.direct-native-hook-graph-profile-selection-binding.v3`. Exact `3.2.0` requests retain their original metadata rules; metadata-absent `3.1.0` and `3.0.0` requests remain readable and
byte-identical retryable under their original immutable policy; revision 2 also remains a compatible profile contract
for existing clients and resources. The Router primitive supports 2-16 targets; the direct
native profile requires 3-16 because token, hook and initializer roles are distinct. It accepts a project-owned token,
a project-owned hook, native or ERC-20 quote currency, all fourteen Uniswap v4 permission bits across masks `0` through
`16383`, and an exact multi-contract graph. It does not substitute a Programmable-owned hook. Every enabled v4
permission must resolve to a concrete reachable callback implementation;
an interface declaration or fallback-only route does not qualify.

CLI `3.3.9` is the current installable release and defaults fresh packs to live profile `3.3.0`. Explicit profile
`3.4.0` output remains preparatory and is rejected by live capabilities until backend and `.well-known` activation.
Pending `3.4.0` requires 4-16 targets inclusive of the exact
`programmable:settlement-fee-vault:v1`; applicants cannot select another platform fee target. Its release binding is
`sha256:39ccdfdf8cd61620bf5c62bf07fb8428adbd66d2608b1cf3ad583343116d7ed9`, source SHA-256 is
`sha256:0a01ee8c22d103343d14b1d3890902e3edeecef25ea84a0f03f23a3fe8f1042b`, and creation/runtime Keccak-256 are
`0xdbc32e835739b50f33a101a8927008fc46af4c11604f7a5da006e5c56288b21e` and
`0x92620fe3f83839334c9a264bea5bfcc819868ca5607cbd2260e5a9664dbd7554`. The vault uses solc 0.8.26, EVM Paris,
optimizer 1000 and no CBOR; its constructor binds the GraphFactory and `bindRoute(address)` locates one distinct route.
Exactly one constructor or initializer locator on that project-owned route points back to the vault. The route may be
the hook or a custom AMM, while `settlementFeeVault()` and full fee-path behavior remain server-evidence requirements.

The open arbitrary-custom-hook lane does not carry a Programmable fee claim. A 10 bps share applies only when the
request selects a fee-certified profile or adapter and the API server verifies its per-launch behavior for the exact
stamped PoolKey. Revision 3 does not turn a declaration, local check, static report or Router simulation into a fee
certification. Source, compiler settings, constructor arguments, final calldata and server evidence remain bound per
launch.
The pool may use a static fee or the Uniswap v4 dynamic-fee sentinel. Funding may be absent, carried as the exact
native value of the separately reviewed Router transaction, or use an unsigned USDC EIP-3009 descriptor. Any later
funding signature and the Router transaction remain separate explicit wallet actions and are never produced or sent
by the API key.

## Platform fee policy

The general V3 production profile is available on Ethereum Mainnet only (`chainId: "1"`) and has
`productionLaunchAuthorized: true`.

A Programmable share of `1,000` hundredths of a bip, equal to `0.10% = 10 bps`, is claimed only for a fee-certified profile or adapter and its
exact stamped PoolKey. That lane binds the accounting mode, fee currency, rounding and claim destination and requires
server-authored per-launch fee-path evidence before the platform makes that claim. Arbitrary custom hooks are not automatically
fee-enforced, and the open arbitrary-hook lane carries no Programmable fee claim. Revision-3 local validation, static
admission and Router simulation do not independently create `feeBehaviorClaim: true`.
For that certified lane, the bound Programmable recipient is `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`.

Where a selected lane uses applicant buy or sell rates, each rate is capped at `100,000` hundredths of a bip:
`1,000 bps = 10%`. The API server enforces the cap in both `additive-platform-share` and
`inclusive-selected-total` modes. The separate platform value is `1,000` hundredths of a bip, equal to `10 bps`; the
additive and inclusive accounting meanings do not change.

The pool's LP fee is separate from this platform charge and must be disclosed separately. Generic fee claiming and
buyback management for arbitrary hooks are not live. The reserved `fees:claim` and `buybacks:manage` scopes remain
disabled.

## Liquidity and safety boundary

Normal Uniswap v4 pool initialization sets the starting price but adds no liquidity. A project using ordinary
concentrated liquidity must fund and create its own position; trading volume cannot create the initial liquidity from
nothing. Position custody, withdrawal and any lock or burn are project behavior and must be disclosed.

New CLI requests bind `external-concentrated-liquidity`, `launch-seeded-concentrated-liquidity`, or
`hook-inventory-custom-accounting` into the exact request hash. The external model remains `liquidity_required`; the
seeded and hook-inventory models remain `assessment_required` until the platform has separate exact evidence. A
request cannot self-declare that assessment as passed.

Zero classical LP works only when the project hook and initializer implement custom accounting or hold launch
inventory that can exchange against incoming assets. Buys may then grow assets held by the hook, but the initial token
inventory and the buy, sell, redemption and withdrawal paths still come from the exact project graph. Funding mode
`none` does not make an empty ordinary pool liquid.

Current profile `3.3.0` checks exact source/build bindings, hook permissions and address bits, then applies a role-aware static
baseline. Exactly seven objective code-and-role rules hard-block deployment: runtime `CALLCODE`, runtime or source
`SELFDESTRUCT`, a definitively missing or invalid callback authentication guard, a literal noncanonical PoolManager,
or a missing enabled callback implementation. Proxy or delegatecall use, mint/tax/pause/transfer controls, liquidity
custody or locking, external dependencies and return-delta custom accounting remain bound evidence duties rather than
categorical deployment blocks. A hard-block match returns `action_required`; other findings populate
`needsEvidenceFindingCodes` or warnings. There is no manual project allowlist. A final Router simulation is mandatory,
and the API server independently requires it to pass before wallet handoff. Behavior execution is additional evidence:
absence leaves behavior-derived claims unverified, while an authenticated executed failure blocks the handoff.

When no blocking pair matches, the server-authored `platformAdmission` status binds the report SHA-256 and warning
codes with disposition `no_blocking_static_finding`, while requiring Router simulation and explicitly setting
`safetyClaim: false` and `feeBehaviorClaim: false`. A blocking match instead exposes the exact static report through
`action_required`.

Static admission and simulation do not prove that arbitrary custom code has no honeypot behavior, privileged controls
or economic risk. They are not an audit or a guarantee of safety, liquidity, tradeability or fee behavior. A project
must disclose transfer restrictions, pause or upgrade controls, liquidity custody, withdrawal behavior and buy/sell
conditions.

Capabilities keeps six product-truth axes independent: `deployment`, `trading`, `platform_fee_evidence`,
`source_verification`, `indexing` and `featured`. Preflight `launchEligibility.deployable`, `routable` and `featured`
are bounded classifications at the returned `evidenceTier`; they do not prove a deployment occurred, live trading or
liquidity exists, platform-fee behavior was proven, source verification reached `exact_match`, indexing refreshed, or
feature placement happened. The response disposition is `supported`, `supported_with_warnings`, `needs_evidence` or
`unsupported` and includes typed finding-code arrays, `riskClassification`, `behaviorEvidence`, `productTruthAxes`,
`staticBaseline` and `remediations`. A `not_executed` or `needs_evidence` result remains outstanding; it is neither a
failure nor a caller-declared pass and cannot support a positive behavior, fee, liquidity or routability claim. None is
an audit, universal compatibility statement or safety guarantee.

## Install the public CLI

Install only the immutable GitHub Release asset:

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

Continue only after the checksum command reports `OK` and the version command prints `3.3.9`. The package name is
`@programmable/launch`; the binary is `programmable-launch`. Omit `profileVersion` for live `3.3.0`; explicit `3.4.0`
output is rejected until backend activation. Do not substitute an unverified npm registry package.

The CLI has exactly four commands:

```sh
programmable-launch pack --config programmable-launch.config.json --output launch.json
programmable-launch validate launch.json --config programmable-launch.config.json --remote
programmable-launch submit launch.json --config programmable-launch.config.json
programmable-launch status REQUEST_UUID --watch --until authorized
```

`pack` derives the sorted manifest, source descriptor, ABI encoded arguments, graph, target locators, CREATE2
predictions, evidence digests, canonical hashes and exact source verification bundle from exact source, Standard JSON,
compiler artifacts and evidence files. It accepts no hand written derived hashes. `validate` recomputes those
commitments and, with `--config`, requires byte identical reproduction of `launch.json`.

Current profile `3.3.0` requires `projectMetadata`: owner-supplied token name and symbol, a useful 20–4,096 UTF-8 byte
description with at least eight Unicode letters or numbers, non-empty local PNG/JPEG/WebP/GIF bytes, exactly one public
HTTPS website and exactly one canonical `https://x.com/<handle>` profile. Other link kinds remain optional. The CLI
binds the exact image digest, byte length, media type, dimensions, and source-manifest file; it never invents or uploads
metadata. Discovery advertises `requiredForProfileVersions = ["3.2.0","3.3.0","3.4.0"]`,
`strictMetadataProfileVersions = ["3.3.0","3.4.0"]`, and `legacyMetadataProfileVersions = ["3.2.0"]`, so exact
`3.2.0`, `3.3.0` and pending `3.4.0` all carry metadata while only exact `3.3.0` and pending `3.4.0` use the strict
current policy and only exact `3.2.0` preserves its older nullable-image semantics.

Use a stable content URI and make HTTPS image bytes browser-readable with CORS. Wallet review fetches the raw bytes
and checks the bound SHA-256, length, type and dimensions before rendering; IPFS and Arweave use fixed public gateways.
An unavailable or mismatched remote image remains a digest plus placeholder. The platform does not upload or replace
the image, mutate the launch, or sign automatically.

Partner root keys and subkeys use the same `PROGRAMMABLE_API_KEY` and canonical V3 create, preflight, list and status
flow as wallet keys. The current Router V1 permit-reissue disposition route is wallet-key-only. The server
derives immutable `partnerAttribution`; callers cannot set it, and it is provenance only, not a safety or verification
claim. A wallet key requires `launchWallet` to equal its bound wallet. A partner credential instead selects the exact
controller in the immutable request but never acquires that wallet's authority. The selected controller remains the
signer and broadcaster, and the same complete name, symbol, description, image, website and X metadata policy applies.
For an expired partner launch, recover directly by repacking a new request with a fresh nonce and Idempotency-Key, with
full gates rerun.

### Public partner subkeys

A partner root with `partner-subkeys:manage` may list, issue, rotate, and revoke bounded child credentials at the four
public `/v1/partner/subkeys` operations in the V3 OpenAPI. The root credential is read only from
`PROGRAMMABLE_API_KEY`. Children
may hold `custom-launch:create` and/or `custom-launch:read`, never `partner-subkeys:manage`, and cannot exceed the root's
budgets or expiry. Every subkey-admin operation, including list, consumes the root's
`subkeyAdminRequestsPerHour` budget. Private partner and root administration routes are not public.

Launch reads follow immutable partner lineage. A partner root reads every launch attributed to its partner, including
launches created by current and rotated subkeys. Each subkey sees only its own lineage, including launches for the
different controller wallets it selected, and cannot read root or sibling launches. Rotation atomically revokes the old
credential and gives its replacement the same lineage, so its private launch history remains readable. A separately
issued subkey starts a new isolated lineage. Finalized public metadata remains a separate unauthenticated feed.

```sh
curl --fail-with-body \
  --header "Authorization: Bearer $PROGRAMMABLE_API_KEY" \
  https://api.programmable.market/v1/partner/subkeys

curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer $PROGRAMMABLE_API_KEY" \
  --header "Content-Type: application/json" \
  --header "Idempotency-Key: $PROGRAMMABLE_IDEMPOTENCY_KEY" \
  --data-binary @partner-subkey.json \
  https://api.programmable.market/v1/partner/subkeys
```

The closed `programmable.partner-subkey-request.v1` body contains `displayName`, one or both child launch scopes,
`prepareRequestsPerHour`, `readRequestsPerMinute`, and a millisecond UTC `expiresAt`. The first committed issue or
rotation returns `201` with `secretState: delivered-once` and the one-time `apiKey`; an exact replay returns `200` with
`secretState: already-delivered` and `apiKey: null`. Keep the exact body and Idempotency-Key for retry. Rotation is
`POST /v1/partner/subkeys/{subkeyId}/rotate`; revocation is `DELETE /v1/partner/subkeys/{subkeyId}`. The replacement
credential retains access to its stable lineage history; export anything needed before permanent revocation. Honor
`Retry-After` on `429`. Every error includes a correlation `requestId`, and a bounded `500` never includes secrets.

When the selected token ABI and exact constructor or initializer values expose one unambiguous name or symbol string,
the declaration must match. Arbitrary tokens are not forced into one constructor shape: non-extractable declarations
are request-and-launch-ID bound and require post-deployment `name()` / `symbol()` readback where supported. The wallet
reviews the same canonical `programmable.project-metadata.v1` and `projectMetadataHash`; neither the client nor the
API can substitute display metadata after packaging.

The release includes `examples/direct-native-v3-no-broadcast/README.md`. It compiles real project-owned token, hook and
initializer targets, then stops after deterministic `pack` and `validate`. It never submits, polls, signs,
broadcasts or creates a Mainnet coin.

## Secret and wallet boundary

Create or revoke a key at <https://programmable.market/developers/api-keys>. Store it only in an encrypted secret or
environment variable named `PROGRAMMABLE_API_KEY`, or in the supported operating system secret store. Put only
`$PROGRAMMABLE_API_KEY` in chat, prompts and agent setup. The CLI has no API key argument, never prints the key and
never stores it in its journal.

Wallet keys are bound to their controller wallet and API scopes. Partner credentials are bound to their own isolated
launch principal; they select an exact controller in each request but cannot sign for it. The API and CLI never sign or broadcast. The API server
exposes a wallet handoff only after its objective static hard blocks and exact Router simulation pass. Missing behavior
execution keeps the related claims unverified; an authenticated executed failure blocks the handoff. Client output
cannot bypass either mandatory server gate. At `authorized`, the API returns the exact prepared wallet
transaction. Stop the agent flow so the connected controller can independently review the chain, sender, Router,
value, selector and calldata before signing.

## Public V3 request

`POST /v3/custom-launches` accepts the exact `programmable.custom-launch-create-request.v3` body. The CLI derives and
validates every required field, including the exact source descriptor and manifest, graph bundle, general profile and
selection, canonical profile and intent hashes, agent attestation and `verificationBundle` exact source material. Use
the normative V3 OpenAPI for every nested field, enum and size bound.

The complete request is limited to 8,388,608 bytes. For the default revision-3 profile, every compilation unit uses
exact `solc 0.8.26+commit.8a97fa7a`. Decoded Standard JSON is limited to 5,242,880 bytes per compilation unit and
across all units in one request, with at most 2,048 inline sources. Compiler version, settings, libraries, constructor
arguments, runtime materialization and every exclusive graph component are bound to the launch intent. Revision-2
requests retain their compatibility contract.

## Idempotent submission

`submit` freshly repacks the config and proves that `launch.json` is byte identical before network access. It then
writes a mode `0600` journal that permanently binds the idempotency key, API origin and exact request bytes. Reusing
the key with different bytes fails locally.

Timeouts, ambiguous transport results, `429` and `503` retry only those persisted bytes. Honor `Retry-After`. Never
rotate the nonce, idempotency key or request bytes to work around an ambiguous result. The API can return `202` for a
new durable request or `200` for an exact replay.

New requests share a durable global admission cap of 120 created requests per hour and 500 per day. An exact
idempotent replay is resolved before admission and consumes no additional capacity.

## Status and wallet handoff

V3 is the CLI default. Read one resource with:

```sh
programmable-launch status REQUEST_UUID --watch --until authorized
```

The list route may make a bounded best-effort reconciliation pass over pending rows, but it returns `output: null`.
The single resource GET is the precise status and full output path. Its additive `lifecycleQueue` reports only bounded
worker scheduling and retry state; queue completion is not launch finality, and queue retry never changes the launch
status.

```text
received -> validating
validating -> pending_review <-> action_required
pending_review -> server evidence gate
server evidence gate -> awaiting_funding_authorization -> funding_authorization_verified (EIP-3009 only)
server evidence gate or funding_authorization_verified -> prepared -> simulating -> authorized -> submitted -> finalized
```

`failed` and `cancelled` are terminal alternatives. `pending_review` has no wallet action. `action_required` means a
current exact hard-blocking finding code matched its target role. Inspect the exact bound report and contact support
with the request ID when directed; it is not a wallet-signing stage. Send only the request ID, status, UTC time and
public error code. Never send the API key. Nonblocking findings remain bound and visible as warnings. With
`--until authorized`, the CLI also stops at
`awaiting_funding_authorization`, but the server exposes that handoff only after the evidence gate required by the
selected lane has passed. Complete the exact typed-data signature in the website, then run status again.
`prepared` has no wallet transaction. During `simulating`, a signed permit may exist only inside a worker-private
simulation envelope; public output remains null in `simulating` and `failed`, so the evidence gate controls permit and
wallet-transaction exposure rather than internal simulation signing. `authorized` contains the exact Router transaction for separate controller
wallet review, signing and broadcast. When present, follow only the HTTPS `walletHandoffUrl` before its `expiresAt`;
refetch status after expiry. The API and CLI never sign or broadcast. After the wallet broadcasts, run:

```sh
programmable-launch status REQUEST_UUID --watch --until finalized
```

## Exact source verification and discovery

Finality is independent from explorer availability. After a bundled request is finalized, the server enqueues
idempotent verification work for each exclusive component. Optional `sourceVerification` is server authored and uses
`queued`, `retrying`, `exact_match` or `needs_attention`. Only literal `exact_match` for every component means Source
verified. Components are uniquely sorted by UTF-8 `targetId`; non-exact rows expose no provider or evidence digest,
while exact rows keep the Sourcify v2 `match/match/match` observation explicitly non-authoritative as
`PARTIAL_NO_CBOR_EXACT_BYTES` with `releaseAuthority: false`. They separately require
`exactSourceAuthority: protected-hosted-build-finalized-transaction-bytecode` and the
`programmable.robinhood-custom-launch.exact-byte-source-build-transaction-binding.v1` composite digest covering
the protected source tree and closure, hosted build artifact, Standard JSON input, compiler binary and settings,
finalized creation transaction, and exact creation/runtime bytecode. A provider observation alone never satisfies
`exact_match`. `nextAttemptAt` exists only for queued or retrying rows. Otherwise aggregate state is fail closed: any
`needs_attention` wins, then any `retrying`, then
`queued`; aggregate `updatedAt` is the latest component timestamp. The authenticated resource may omit or
null this field before finality; the V4 finalized-feed contract requires it. A client must never submit or infer
this state. Legacy or unbundled requests remain compatible and unverified.

Finalized Router identities remain eligible for Explore and Profile after discovery refreshes even when optional
market enrichment or an explorer is unavailable. Provenance is not an audit, liquidity guarantee or endorsement.

## Errors and support

Use the [Robinhood error recovery table](https://programmable.market/developers/robinhood-launch-guide-v1.md#recover-by-error-code)
and the current machine guide's `errorRecovery` entries for V4. `UNAUTHENTICATED` means verify the configured key;
`INSUFFICIENT_SCOPE` means check the operation scope; `CHAIN_NOT_ALLOWED` means check the selected credential's chain
grant. These differ from a source defect or missing platform verifier. Unknown findings stay unclassified.

V4 create returns `202` for a new durable request and `200` for an exact idempotent replay. Neither is authorization.
For detail `404 NOT_FOUND`, check `launchId`, chain and credential lineage; do not create a replacement just to poll.
A public guide/coverage `404` means deployment availability, not an invalid key. Preflight `200` can still report
`needs_evidence` or `unsupported`. When `launchEligibility.deployable` is true, `TX_SIMULATION_PENDING` instructs
submission of the exact validated request for the remaining server simulation; it does not request a source rewrite.

Preserve the exact journal, bytes and idempotency key for `429`, explicitly retryable V4 `503`, and ambiguous
transport results. Honor `Retry-After` and keep attempts bounded. For nonretryable errors, correct the named input,
scope or grant before another attempt. Reconcile an existing request before intentionally creating a different one.
A `500` response keeps the correlation request ID but does not authorize changing request bytes. For support, send
only `error.requestId`, HTTP status, UTC time and the public error code. Never send the API key.

Generic fee claiming and buyback management for arbitrary hooks are not live. FADE uses a specifically bound adapter.
The reserved `fees:claim` and `buybacks:manage` scopes are disabled and promise no future behavior. Public Hookbuilder
and reusable template intake are not part of the Custom Launch API.
