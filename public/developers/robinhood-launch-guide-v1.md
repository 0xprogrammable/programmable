# Robinhood launch workflow

Check architecture coverage before building a launch for Robinhood Chain Mainnet (`4663`, `eip155:4663`). This guide
connects the public reports, API credentials, preflight, immutable request and wallet handoff. It does not activate
a deployment or authorize a request.

## 1. Check the public reports before building

Confirm the intended chain and reuse the launch details and funding choices already supplied. Then read:

```sh
curl --fail --silent --show-error https://api.programmable.market/v4/chains/4663/launch-coverage
curl --fail --silent --show-error https://api.programmable.market/v4/chains/4663/launch-guide
```

Both routes are public: send no API key, query parameters or body. They use the separate schemas
`programmable.robinhood-launch-coverage.v1` and `programmable.robinhood-launch-guide.v1`. The guide reports the
current `profile`, `readiness`, `workflow`, `scenarios` and `errorRecovery`. Scenario entries identify their
`assessment`, `blockerLayer`, reason and next step; `authority.requestAuthorized` and each scenario's
`requestAuthorized` remain false. The
[coverage OpenAPI](https://programmable.market/openapi/launch-coverage-v1.json) and
[coverage response schema](https://programmable.market/schemas/custom-launch/coverage/v1.json) describe the
architecture report independently of the frozen launch request contracts.
The separate [launch-guide OpenAPI](https://programmable.market/openapi/launch-guide-v1.json) and
[launch-guide response schema](https://programmable.market/schemas/custom-launch/guide/v1.json) describe the workflow
report without adding fields to the historical capabilities or preflight contracts.

An HTTP `200` report is information, not approval. Service readiness, representable architecture, activated verifier
coverage and exact-request admission are separate. Coverage always reports `requestAuthorization.requestAuthorized: false`.
If either report returns `404`, that deployment does not provide it. An unavailable report, timeout or unknown schema
does not prove architecture support or an invalid key. Retry the public read later and report the missing contract;
never rotate a key or automatically switch chain, profile, request format or launch route to get past the failure.

## 2. Match the intended scenario

Read the current report's exact constraints and scenario blocker codes before selecting a recipe. This table
describes the existing 4.1 request format; only the server's response establishes which verifier is activated.
The guide's `scenarioProfileVersion` is `4.1.0`. For another or unavailable profile, scenario assessments are
`not-evaluated` and the blocker layer is `unclassified`; do not apply this table as approval for that profile.
The other assessments are `requires-exact-preflight`, `platform-change-required` and `server-evidence-required`.

| Intended design | Existing format and verification boundary | Next step |
| --- | --- | --- |
| `reviewed-native20-seed`: exact seed recipe | One native ETH/token pool, reviewed kernel/token/initializer, no optional module, LP fee 0, tick spacing 60 and the fixed initial price. Positive token-side liquidity and an atomic initial buy require exact server proof. | Use the [native20 example](https://github.com/programmablehq/PROGRAMMABLE/tree/production/packages/launch/examples/robinhood-v4-native20) only if those constraints preserve the intended design and `seedV1` is `proof-available`. Pin the reviewed source and still run preflight. |
| `combined-token-hook`: same-address token and hook, including a BLOB-style design | `tokenAndHookMayShareAddress: false`: the current graph gives one role to each physical target. | A versioned graph and Router release is required. Keep the intended architecture; splitting contracts changes the design and is not an automatic repair. |
| `hook-owned-pol-no-initial-buy`: token-side hook-owned liquidity without a native purchase | A funded 4.1 launch requires an atomic native initial buy and a fresh server USD reference. `funding: none` does not meet that policy. | Preserve the intended no-buy design when it needs a policy/verifier extension. Do not insert a purchase or increase a budget without the controller's intent. |
| `no-pool`: application or settlement without a pool | The current transport requires one official PoolKey. | A separate versioned transport and verified settlement path are required; do not add a placeholder pool. |
| `multiple-pools`: multiple official pool keys | Extra graph targets do not create additional official PoolKeys. | A versioned transport with per-pool fee and provenance bindings is required. |
| `non-native-pair`: ERC-20 quote currency | The current official pool pairs native ETH with the designated token. | A compatible pool/settlement contract and exact fee evidence are required; preserve the intended quote asset. |
| `custom-token-or-initializer`: arbitrary token or initializer | A graph may be representable while its fee, initial-buy or behavior proof is missing. | Inspect `findingObligations` and exact source findings. Repair actual defects; otherwise a platform verifier extension is needed. |
| `stateful-module`: module with mutable application state | A staticcall-only candidate cannot prove stateful execution or activate its public transport. | Additional server verification and a compatible public route are required. Keep state transitions explicit and findings unresolved. |
| `return-delta-settlement`: custom deltas or inventory settlement | Declaring callback permissions does not verify cashflows, solvency or native fee coverage. | Additional server verification is required for the exact paths and bounds. Caller-uploaded proof claims do not clear findings. |
| `static-module`: codehash-bound stateless module | A candidate proof can exist while `publicRequestSurface` is `none-versioned-transport-required` and `publiclyLaunchable` is false. | Wait for compatible public transport and activated verification. A compiled candidate or module API key is not a launch route. |
| `custom-curve-or-auction`: declared pricing model | Pricing and capital-source labels do not prove execution, reserves, solvency or launch eligibility. | Keep the intended pricing, custody and fee rules; match the actual mechanism to activated verification. |
| `unclassified-mechanism`: previously unknown hook or application | An arbitrary unchanged hook or missing catalog label is neither approval nor an unsafe finding. | Inspect exact source/configuration and use preflight where representable. Report missing analysis for platform coverage without inventing a verdict. |

Historical 4.0 requests retain their original `funding: none` semantics; never select that old profile to avoid the
current 4.1 minimum buy. A buyer-funded, hybrid or custom-capital declaration does not create available ETH. A
build-only plan permits preparation within its accepted scope but cannot obtain a launch permit. Confirm funding
and budgets before generating a fund-and-launch request.

The mechanism being unknown does not make it unsafe. Missing platform coverage and a demonstrated source defect are
different outcomes. Do not redesign a project merely to silence a finding, widen key scopes, or request a manual
allowlist. No scenario row, declaration or public report clears server findings or authorizes a permit.

## 3. Select the client and API credentials

Read [live discovery](https://programmable.market/.well-known/programmable.json). Before authenticated preflight or
create, require `publicAuthorization`, `publicWrites` and `releaseReady` to be true in both
`customLaunchApi.versions.v4` and the matching chain entry. Match current capabilities/readiness to chain `4663`,
the complete profile tuple, deployment descriptor, trust roots and finality policy.

| Version | Meaning |
| --- | --- |
| API profile `4.1.0` | The exact server-selected funding, admission and request contract. A client patch does not change this tuple. |
| CLI `4.1.0` | The historical immutable client selected by the API release record. Its assets retain their original commands. |
| CLI `4.1.1` | A separate compatible client patch adding `coverage --chain-id 4663`. Verify its own immutable release, source, manifest, checksum and client binding to API profile 4.1.0. |

A source candidate or version string is not publication evidence. Use a client only after its actual release has been
verified; a missing release is not a reason to use an unverified package. The direct public reads above work without
a CLI upgrade. Existing release tags, tarballs and API profile pins remain unchanged.

Use an existing suitable key from the [API-key manager](https://programmable.market/developers/api-keys). Store it in
`PROGRAMMABLE_API_KEY` or the CLI's supported OS secret store. A key's operation scopes, chain grant and controller
binding are independent checks. A read-only key cannot preflight/create, and module-contribution scopes do not grant
launch access. Creating another key is unnecessary for a public report.

All paths below use `https://api.programmable.market` and chain `4663`:

| Route | Authentication and scope | Successful outcome |
| --- | --- | --- |
| `GET /v4/chains/4663/launch-coverage`, `/launch-guide`, `/capabilities`, `/readiness`, `/initial-buy-quote` | Public; no key. Each short path uses the same `/v4/chains/4663` prefix. | `200` report; inspect its state and exact contract. |
| `GET /v4/chains/4663/finalized-custom-launches` | Public; no key. | Published finalized records; check completeness and publication evidence separately. |
| `POST /v4/chains/4663/custom-launches/preflight` | Bearer key with `custom-launch:create` and the chain grant. | `200` classification, including an unsupported or needs-evidence outcome. No launch is persisted. |
| `POST /v4/chains/4663/custom-launches` | Bearer key with `custom-launch:create`, the chain grant and `Idempotency-Key`. | `202` for a new durable request; `200` for an exact idempotent replay. Neither is wallet authorization. |
| `GET /v4/chains/4663/custom-launches` and `/{launchId}` | Bearer key with `custom-launch:read`, the chain grant and access to that resource's credential lineage. | `200` list/resource. Detail `404` is handled below. |

Send `Authorization: Bearer $PROGRAMMABLE_API_KEY` only to the canonical API origin. A wallet key's binding must
match `launchWallet`. Partner credentials follow their own controller and lineage rules; they never sign for that
controller. An API grant does not select a chain or create wallet authority. Public guidance has no credential
introspection or key-testing side effect.

## 4. Build, preflight and submit exact bytes

For profile 4.1, agree the funding source, actual mechanism, initial assets, atomic first buy and positive minimum
token output. Read the public initial-buy quote before building. The server independently requires a fresh reference
at authorization; never raise the buy or budget automatically. Count the buy once inside transaction value and show
gas separately. Preserve the exact source/compiler/metadata bindings and the accepted `maxLaunchValueWei` and
`maxGasCostWei`.

With a verified compatible client and the selected recipe's complete config/artifacts:

```sh
programmable-launch pack --config programmable-launch.config.json --output launch.json
programmable-launch validate launch.json --config programmable-launch.config.json --remote
```

Use `--output`, not the unsupported `--out` spelling in the historical bundled example. Inspect
`launchEligibility.deployable`, the disposition and all finding/remediation arrays. HTTP `200` alone is insufficient.
A build-only plan, `needs_evidence` or `unsupported` is not ready for launch submission.

If `deployable` is true with `TX_SIMULATION_PENDING`, the next step is create. That warning explains that preflight
checked a chain checkpoint, not execution of the launch, swaps or fees. Create runs the mandatory exact-transaction
simulation and remaining server admission before a wallet action can be exposed:

```sh
programmable-launch submit launch.json --config programmable-launch.config.json
```

Keep the exact bytes, journal and idempotency key for an ambiguous result or eligible retry. An intentional source,
metadata, funding or permit-window correction creates a different immutable request; repack and revalidate it after
resolving the existing request's state. Never hide a changed request behind its old idempotency key.

## 5. Follow the request, wallet and finality

Set `LAUNCH_ID` to the returned `launchId` (`resource.launchId` in CLI JSON), not the support `requestId` or the
Router's onchain bytes32 ID:

```sh
programmable-launch status LAUNCH_ID --api-version 4 --chain-id 4663 --watch --until authorized
```

For `action_required`, follow the exact remediation and create a corrected, newly validated request; polling cannot
repair source or add a missing verifier. At `authorized`, `awaiting_wallet_signature` or `wallet_action_required`,
open only the server-provided wallet handoff. The controller checks metadata, chain `4663`, sender, Router, value,
calldata and expiry, then separately signs and sends. The CLI and API key never sign or broadcast.

After that wallet transaction has been sent:

```sh
programmable-launch status LAUNCH_ID --api-version 4 --chain-id 4663 --watch --until finalized
```

`submitted` is not finality; `sequencer_soft_confirmed` is reversible; `ethereum_posted` still awaits the configured
Ethereum finality proof. Only `finalized` satisfies that policy. Source verification, Programmable publication and
indexing, tradability and third-party listings remain separate. A `failed` resource requires its bound failure and
recovery instructions, not another wallet attempt using an expired transaction.

## Recover by error code

Use the current machine guide's route-specific recovery together with the authoritative response. These are common
cases, not permission to ignore an unknown code:

| Response or finding | Recovery |
| --- | --- |
| `401 UNAUTHENTICATED` | Check that the environment/secret store has the intended valid, unrevoked key. Do not paste it into support or try another origin. |
| `403 INSUFFICIENT_SCOPE` | Check the operation: create/preflight needs `custom-launch:create`; reads need `custom-launch:read`. Use a key with that purpose. |
| `403 CHAIN_NOT_ALLOWED` | Check the selected credential's chain 4663 grant in the key manager. Do not switch chains or repeatedly rotate keys. Report a missing expected grant with the public error and support ID. |
| `WALLET_BINDING_MISMATCH` | Reconcile the intended controller with the key's wallet binding. Do not silently replace the user's launch wallet. |
| `404` from public guide/coverage | Discovery is unavailable on that deployment. Retry the public read later; no new key is needed and no alternative launch route is inferred. |
| `404 NOT_FOUND` from detail GET | Check the returned `launchId`, explicit chain/API version and credential lineage. A support `requestId` is not the V4 resource ID. Do not create a second launch to repair polling. |
| `429 RATE_LIMITED`, explicitly retryable `503`, or ambiguous transport | Honor `Retry-After` where present and retry the same operation with its exact request bytes and idempotency key. A V4 `503` without explicit retryability does not justify automatic create retries. |
| `409 IDEMPOTENCY_CONFLICT` | Recover the request and journal already bound to that idempotency key. Reconcile their state; a deliberate new request needs its own idempotency key and validated bytes. Keep the API credential unless an authentication problem requires changing it. |
| `CUSTOM_LAUNCH_V4_PERMIT_WINDOW_INVALID` or `PERMIT_EXPIRED` | Inspect the authoritative existing request and transaction state first. Refresh the permitted time/checkpoint inputs in a newly packed request when recovery requires it; do not reuse an expired wallet handoff or infer a V4 reissue endpoint. |
| `ROBINHOOD_INITIAL_BUY_USD_QUOTE_RETRY_REQUIRED` | Read the current quote and follow the retryable server instruction while other inputs remain valid. The server must obtain its own fresh quote. |
| `ROBINHOOD_INITIAL_BUY_BELOW_ONE_USD_REFERENCE` | Confirm the revised buy within the controller's budget, then update the initializer value, funding allocation and total together, repack and preflight. |
| Source/callback finding or missing verifier evidence | Follow the exact target/source repair, or report the missing platform adapter. Preserve unresolved findings. Wider scopes, test claims and caller proofs cannot clear admission. |
| Unknown code, invalid response or `500` | Preserve the request/journal and inspect the exact response contract. Keep unknown findings unclassified. Send only the public code, HTTP status, UTC time and support `error.requestId`; never send credentials. |

The frozen [4.1 OpenAPI](https://programmable.market/openapi/custom-launch-v4.1.json) retains its historical bytes.
The separate workflow report documents route outcomes such as create `200` replay and detail `404`; it does not
change request schemas, launch authorization or the original response-body contracts.
