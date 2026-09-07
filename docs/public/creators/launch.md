---
description: Configure a Module Mode coin or submit a Custom Launch project
---

# Launch a project

## Module Mode

Open [Module Mode](https://programmable.market/launch/modules) to configure a coin, its creator fees and initial buy. Modules are optional. The builder uses the selected modules' configuration fields and checks their compatibility before wallet review. After launch, open the coin's controls from its page or your profile. Read the [Module Mode guide](../models/module-mode.md) for the full flow.

## Custom Launches

Public V3.3 general-hook creation and lifecycle reads are live on Ethereum Mainnet. V2 and V1 history and schemas remain readable, while fresh authenticated POSTs return nonretryable `409 CUSTOM_LAUNCH_V2_READ_ONLY` and `409 CUSTOM_LAUNCH_V1_READ_ONLY`. On Ethereum, only V3.3 accepts new submissions. Legacy Registry and GitHub submission intake is closed.

### Robinhood Chain

Use the [Custom Launch API guide](../developers/custom-launch.md) to select a contract layout. Separate token and hook addresses use the V4 profile in [live discovery](https://programmable.market/.well-known/programmable.json). A token and hook in one contract use [MultiRole V2](https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/guide.md). Fetch the selected profile's capabilities and supported client before building. The MultiRole economic verifier accepts the exact Native20 recipe and supported constructor configuration; different contract logic returns `evidence_required` until the required verification is available.

Create a platform API key with `custom-launch:create`, `custom-launch:read` and a chain `4663` grant. Package the source, run preflight, submit and track the returned resource. The API authorizes an exact wallet transaction after its checks pass; the controller reviews, signs and broadcasts it separately, then follows finality and source verification. A direct deployment outside the Launch Stamp Router path receives no Programmable launch stamp.

Native20 charges **20 bps (0.20%)** of gross native ETH once per successful buy or sell, rounded up to the next wei, for Programmable. Creator and pool fees are additional. The fixed platform recipient is `0xD88539d3c4C460136a733A3Fd60cf6BF269079da`; permissionless claims pay only that recipient. Gas, starting liquidity and an initial buy belong in the funding plan as separate costs. Follow the selected profile's funding rules: 4.1 requires its atomic initial buy, while MultiRole defines its own supported funding configuration. Read [fees and revenue](../economics.md) for the accounting and [Dune](https://dune.com/programmablehq/analytics) for launch and fee statistics.

External references must bind the correct chain, address, runtime hash, source evidence, role and checkpoint. Disclose mutable admin controls and liquidity custody. Track finality, exact source verification, indexing and trading readiness separately from API admission.

## Prepare the source

Keep the contracts, tests, deployment logic and material project information needed to understand the release in one reproducible source bundle. Derive the exact API request with the versioned public `programmable-launch` CLI and validate it against the published schema.

The released 3.3.9 package includes the executable `examples/direct-native-v3-no-broadcast/README.md` clean-room project. It
compiles real project-owned token, hook and initializer targets with exact
`solc 0.8.26+commit.8a97fa7a`, then runs deterministic `pack` and `validate` without submitting, signing, broadcasting
or creating a Mainnet coin.

CLI `3.3.9` is installable and defaults fresh packs to live profile `3.3.0`. Do not submit explicit profile `3.4.0`
output until the backend and `.well-known` discovery independently activate it; live capabilities reject that
preparatory profile.

The source descriptor, manifest digest, graph bundle and agent evidence must all identify the same exact launch subject. Run the checks that apply to the project and keep their underlying evidence. The API requires check IDs and evidence digests but does not publish a universal check catalog or assess the evidence.

## Choose the liquidity design explicitly

Initializing a normal Uniswap v4 pool creates the pool but does not add liquidity. A project using ordinary concentrated liquidity must fund and create its own position; trading volume cannot create that initial liquidity from nothing. Custody, withdrawal and any lock belong to the project's exact graph and must be disclosed.

A zero-classical-LP launch is possible only when the project hook and initializer implement custom accounting or hold launch inventory that can exchange against incoming assets. In that design, buys can increase the assets held by the hook over time, but the initial token inventory and accounting path still come from the project. Selecting `fundingMode: none` does not turn an empty ordinary pool into a liquid market.

## Create an API key

Connect the controller wallet at [Custom Launch API keys](https://programmable.market/developers/api-keys) and create a scoped key. Store it only as `PROGRAMMABLE_API_KEY` in an encrypted environment or secret store. Put only `$PROGRAMMABLE_API_KEY` in source, chat, prompts and agent setup.

The key is bound to its controller wallet and API scopes. It is not a wallet key and cannot sign or broadcast a transaction.

## Submit the V3 request

Run `programmable-launch pack`, `validate --remote`, `submit`, then `status --watch --until authorized`. The CLI and
preflight prepare and classify the exact request; the API server is the decision authority and exposes a wallet
handoff only after objective static hard blocks and exact Router simulation pass. Missing behavior execution leaves
related claims unverified; an authenticated executed failure blocks. Stop for the
connected controller's wallet review and signature, then resume `status --watch --until finalized`. Submit the bundle
to `POST https://api.programmable.market/v3/custom-launches` with the CLI. Authenticated CLI traffic is fixed to exact
origin `https://api.programmable.market`; there is no origin override. Preserve the exact request bytes and idempotency
key across timeout, `429` and `503` retries and honor `Retry-After`. Follow the [Custom Launch API
guide](../developers/custom-launch.md) for the exact public contract.

The default direct-native profile uses `programmable.direct-native-hook-graph-profile.v3`, `profileRevision: 3` and
`profileVersion: 3.3.0`. It requires canonical project name, symbol, a meaningful description, an exact non-empty
source-bound image, one website and one X profile; other sorted public links are optional. The CLI hashes those values and binds the metadata digest into the graph and launch intent; token `name()` and
`symbol()` are read back after deployment. Exact `3.2.0`, `3.1.0` and `3.0.0` requests remain readable and byte-identical
retryable under their original immutable policies; revision 2 also remains compatible. Profile `3.2.0` keeps its original nullable-image metadata semantics. Profile 3.3.0 runs role-aware exact-source static admission with exactly
seven objective hard-block rules. Proxy/delegatecall, mint/tax/pause controls, liquidity custody and return-delta
custom accounting require evidence instead of categorical rejection. A hard-block match moves the request to
`action_required`; other findings remain visible needs-evidence or warning conditions. There is no manual project
allowlist. A final Router simulation is mandatory before authorization.
Each enabled v4 permission must have a concrete reachable callback implementation; an interface declaration or
fallback-only route does not qualify.

These client and preflight checks do not reproduce project tests, decide authorization or verify unresolved behavior.
They are not an audit or a guarantee of safety, honeypot resistance, liquidity, tradeability or fee behavior.
Post-finality provider verification is independent from launch finality.

## Launch from the bound wallet

For an existing request, `pending_review` means admission work is still running. `action_required` means a blocking
static finding matched the role named by the revision-3 policy; it is not a wallet-signing stage. Read the exact report
and contact support with the request ID when directed. Send the request ID, status, UTC time and public error code only;
never send the API key. In EIP-3009 mode, `awaiting_funding_authorization` requires one explicit typed-data signature in
the website; native-value and no-funding modes skip that separate signature. `prepared` means only the exact artifact
exists. An `authorized` resource still requires the controller wallet to check the network, destination, calldata and
value before signing and broadcasting the Router transaction. Neither the API key nor the CLI can sign or broadcast.
A submitted transaction becomes a completed launch only after it succeeds, reaches the required finality and agrees
with the public Router record.

A 10 bps Programmable share applies only to a fee-certified profile or adapter and its exact stamped PoolKey after the server verifies per-launch fee behavior. An arbitrary Custom hook is not automatically fee-enforced and the open arbitrary-hook lane carries no Programmable fee claim. The Uniswap pool LP fee is separate. Generic fee claiming and buyback management for arbitrary hooks are not live; FADE has a specifically bound adapter only.

## Keep the record useful

After launch, share the contract address rather than only a name or ticker. Material source changes, permission changes or a new deployed version create a new launch subject. An earlier prepared bundle does not silently cover new bytes.
