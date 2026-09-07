<p align="center">
  <a href="https://programmable.market" aria-label="Open Programmable">
    <picture>
      <source
        media="(prefers-reduced-motion: reduce)"
        srcset="./assets/readme/programmable-repository-night-garden-v3.png"
      />
      <img
        src="./assets/readme/programmable-repository-night-garden-v4.gif"
        alt="Programmable's white loop mark above a colorful night garden while small round stars twinkle in a black sky"
        width="100%"
      />
    </picture>
  </a>
</p>

<h1 align="center">Programmable</h1>

<p align="center">
  The public application, contracts, indexing and documentation for Programmable.
</p>

<p align="center">
  <a href="https://programmable.market"><strong>Open Programmable</strong></a>
  &nbsp;·&nbsp;
  <a href="https://programmable.market/explore">Explore</a>
  &nbsp;·&nbsp;
  <a href="https://programmable.market/launch">Create</a>
  &nbsp;·&nbsp;
  <a href="https://programmable.market/docs">Docs</a>
  &nbsp;·&nbsp;
  <a href="https://programmable.market/docs/developers">Developers</a>
</p>

## What this repository owns

Programmable is a launch platform for Uniswap v4 products. This repository contains the Next.js application, the
contract workspace, the public read model and the evidence that binds what the product shows to deployed code.

Module Mode creates a coin with a bonding curve and optional, configurable modules. Contributors submit reusable
programs through the API with their source, configuration, management interface, author wallet and reward wallet.
Custom Launches create complete projects with their own contracts and execution logic.

Start with the [agent guide](https://programmable.market/agents.md) and
[discovery](https://programmable.market/api/agent) for current API contracts, capability checks and CLI releases.
Each release defines its network, supported interfaces, funding and wallet transaction requirements.

## Launch models

| Model                  | What it creates                                                       | Access                                                    |
| ---------------------- | --------------------------------------------------------------------- | --------------------------------------------------------- |
| **Module Mode**        | A coin with a bonding curve and optional, configurable modules       | [Module Mode builder](https://programmable.market/launch/modules) |
| **Classic (Ethereum)** | A fixed supply token with configurable buy and sell transaction fees  | Open through [Create](https://programmable.market/launch) |
| **Custom**             | A token or application with its own deterministic hook graph          | [Custom Launch quickstart](https://programmable.market/docs/developers/custom-launch-quickstart) |

A hook is a smart contract attached to a Uniswap v4 pool. The pool calls it at defined points in a transaction, which
lets the product apply behavior at the pool level. A hook can change fees, accounting, access or other pool behavior,
but the word hook does not establish safety, compatibility or launch approval.

[Compare the launch models](https://programmable.market/docs/tokens)

## Custom Launch integration

Follow the [API quickstart](./docs/public/developers/custom-launch-quickstart.md) to choose a request format,
configure fees and funding, create an API key and track the launch through wallet signing and finality.

| Network and contract layout | Integration |
| --------------------------- | ----------- |
| Robinhood Chain, separate token and hook contracts | V4 profile and CLI from [live discovery](https://programmable.market/.well-known/programmable.json) |
| Robinhood Chain, one contract implementing both token and hook | [MultiRole V2 guide](https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/guide.md) |
| Ethereum Mainnet | [V3 reference](https://programmable.market/developer-reference/custom-launch#quickstart) |

Use `custom-launch:create` for preflight and creation, and `custom-launch:read` for status. Bind the key to the
intended chain and controller. The API prepares the transaction; the controller wallet signs and broadcasts it.

Robinhood Native20 charges **20 bps (0.20%)** of gross native ETH once per successful buy or sell. The full
platform fee belongs to Programmable. Creator and pool fees are additional. A creator rate of zero produces
zero creator rewards while the platform fee still accrues. Read the [fee accounting guide](./docs/public/economics.md)
for rounding, accruals, claims and analytics coverage.

The MultiRole automatic economic verifier accepts the exact Native20 source recipe and supported constructor
configuration. Other source code or economic mechanisms return `evidence_required` with the missing verification
requirements. An API key does not grant arbitrary code a launch permit.

<p align="center">
  <img
    src="./assets/readme/programmable-repository-system-v4.jpg"
    alt="A river connects distinct flowering regions inside Programmable's night garden"
    width="100%"
  />
</p>

## How public state is built

1. A launch request is validated under the selected version of its launch model.
2. The active release authenticates and submits the required transaction under its published signer and funding
   policy.
3. The required network confirms the transaction and the launch reaches the required finality.
4. The product read layer publishes the canonical token and pool identity.
5. Optional price, chart and liquidity data are attached only when their providers return current evidence.

Canonical launch identity remains visible when optional market data is unavailable. The application does not invent
valuation, liquidity, provenance or provider support from a token name, ticker or image.

## Module development and indexing

- [Module Mode](./docs/public/models/module-mode.md): configuration, launch and management.
- [Contribution guide](./docs/public/developers/module-mode.md): package requirements, API submission and review.
- [Contributor reference](./docs/architecture/module-mode-contributor-starter.md): source layout, host interfaces and build checks.
- [Indexer guide](./docs/public/developers/module-mode-indexing.md): source discovery, ABI, identity, finality and checkpoints.
- [Indexer contract](https://programmable.market/api/module-mode/indexer/v1): machine-readable ABI and integration fields.

Indexers recognize the launch source version and store module selections as configuration. Adding a module within
that version does not require an indexer to recognize its name. Historical module revisions remain attached to their
original coins. New engine versions require their published source adapter.

## Repository map

| Path                                                            | Responsibility                                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [`app/`](./app), [`components/`](./components)                  | Product routes, API handlers and shared interface components                      |
| [`lib/`](./lib), [`indexer/`](./indexer)                        | Product logic, onchain readers, indexing and external integrations                |
| [`contracts/`](./contracts)                                     | Foundry contracts, tests, deployment scripts, specifications and release evidence |
| [`config/`](./config), [`scripts/`](./scripts), [`ops/`](./ops) | Shared configuration, verification and production operations                      |
| [`tests/`](./tests), [`docs/`](./docs)                          | Application tests and maintained product, security and operations documentation   |
| [`public/`](./public), [`assets/`](./assets)                    | Runtime brand files, social previews and repository presentation assets           |

Read the complete [project structure](./docs/PROJECT-STRUCTURE.md).

## Run locally

Use Node.js `24.14.0`, then install the locked dependency tree and start the application:

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. Supply your own Privy, RPC and storage configuration in `.env.local`. Never commit RPC
credentials, storage tokens, signing material or other secrets.

## Verify a change

Run the complete repository gate:

```bash
npm run verify
```

For a contract-focused change, also run:

```bash
npm run contracts:verify
```

These commands prove only the local revision that was checked. They do not prove deployment, production activation,
provider availability or onchain lifecycle completion.

The reviewed 96-hour Ethereum-to-Robinhood main-token migration and its optional gas sponsor are currently
release-dark. Their checked-in activation manifest remains disabled and contains no live window or opening block.
Operator preparation is defined by the
[gas sponsor runbook](./docs/operations/MAIN-TOKEN-MIGRATION-GAS-SPONSOR-V1.md) and the separate
[readiness checklist](./docs/operations/MAIN-TOKEN-MIGRATION-GAS-SPONSOR-READINESS-V1.md); neither document authorizes
publication, wallet spending or production activation.

## Public interfaces

| Surface                      | Canonical location                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| Product                      | [programmable.market](https://programmable.market)                                                       |
| Explore                      | [programmable.market/explore](https://programmable.market/explore)                                       |
| Documentation                | [programmable.market/docs](https://programmable.market/docs)                                             |
| Custom Launch API keys       | [programmable.market/developers/api-keys](https://programmable.market/developers/api-keys)               |
| Wallet-owned V1 launch reads | [api.programmable.market/v1/custom-launches](https://api.programmable.market/v1/custom-launches)          |
| Custom Launch API readiness  | [api.programmable.market/readyz](https://api.programmable.market/readyz)                                  |
| Custom Launch CLI 3.3.9      | [public V3 GitHub Release asset](https://github.com/programmablehq/PROGRAMMABLE/releases/download/programmable-launch-v3.3.9/programmable-launch-3.3.9.tgz) |
| Custom Launch CLI 1.0.1      | [V1 compatibility asset](https://github.com/programmablehq/PROGRAMMABLE/releases/download/programmable-launch-v1.0.1/programmable-launch-1.0.1.tgz) |
| Custom Launch V1 OpenAPI     | [live reads and write fence](https://programmable.market/openapi/custom-launch-v1.json)                    |
| Custom Launch V2 OpenAPI     | [V2 reads, schemas and write fence](https://programmable.market/openapi/custom-launch-v2.json)             |
| Custom Launch quickstart     | [Choose an API and complete a launch](https://programmable.market/docs/developers/custom-launch-quickstart) |
| Custom Launch discovery      | [Profiles, capabilities and verified client releases](https://programmable.market/.well-known/programmable.json) |
| Custom Launch V3 OpenAPI     | [Ethereum V3 schemas; select the profile from capabilities](https://programmable.market/openapi/custom-launch-v3.json) |
| Custom Launch V4.1 OpenAPI   | [Robinhood V4.1 request contract](https://programmable.market/openapi/custom-launch-v4.1.json) |
| Custom Launch V4.1 schema    | [Robinhood V4.1 pack configuration](https://programmable.market/schemas/custom-launch/v4.1/pack-config.json) |
| Custom Launch V4.0 OpenAPI   | [Historical Robinhood V4.0 contract](https://programmable.market/openapi/custom-launch-v4.json) |
| MultiRole V2 capabilities    | [Shared token and hook contract support](https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/capabilities) |
| Robinhood terminal integration | [chain-bound Router, finalized feed and fail-closed fixture](https://programmable.market/developer-reference/robinhood-terminal-indexer) |
| Read-only developer reference | [programmable.market/docs/developers](https://programmable.market/docs/developers)                       |
| Read-only service status     | [developers.programmable.family/api/v2/status](https://developers.programmable.family/api/v2/status)     |
| Deployment manifest          | [developers.programmable.family/api/v2/manifest](https://developers.programmable.family/api/v2/manifest) |

Ethereum contract addresses and integration data should come from the versioned manifest rather than screenshots,
token names or third-party metadata.

Ethereum V2 and V1 preserve historical reads. Fresh POSTs return nonretryable
`409 CUSTOM_LAUNCH_V2_READ_ONLY` and `409 CUSTOM_LAUNCH_V1_READ_ONLY`; use the advertised V3 profile for new
Ethereum submissions. Robinhood uses the separate V4 or MultiRole contract selected above.

Native20 rounds the platform fee up to the next wei and accrues it as PoolManager native claims. Anyone can trigger
a claim, but payment goes only to the fixed recipient `0xD88539d3c4C460136a733A3Fd60cf6BF269079da`.
Gas and liquidity deposits are separate. A claim withdraws an existing accrual and does not create new revenue.
Historical launches keep their own fee model, including the separate Ethereum V3 fee-certified 10 bps policy.

The API checks the behavior, fee and liquidity evidence required by the selected profile before wallet handoff.
Admission does not replace an external audit or establish liquidity, trading readiness or source verification.
Legacy Registry and GitHub submission intake is closed.

## Related repositories

| Repository                                                                                 | Responsibility                                                              |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| [`Launch-Policy`](https://github.com/programmablehq/Launch-Policy)                         | Versioned Custom launch requirements, policies and schemas                  |
| [`Developers`](https://github.com/programmablehq/Developers)                               | Read-only discovery manifests, API contracts and verification rules         |

## Release and security boundaries

`production` is the canonical full-product branch and the only source for website releases. `main` preserves public
contract and release-evidence history. Feature branches merge through reviewed pull requests.

Source verification, passing tests, a Registry record, a prepared action or a visible token page are not an external
audit, a safety guarantee, proof of liquidity or wallet authorization. Deployment, activation, finality and public
availability require separate evidence.

The smart contracts in this repository have not undergone an external audit or public security contest.

<p align="center">
  <a href="https://programmable.market">Website</a>
  &nbsp;·&nbsp;
  <a href="https://programmable.market/explore">Explore</a>
  &nbsp;·&nbsp;
  <a href="https://programmable.market/launch">Create</a>
  &nbsp;·&nbsp;
  <a href="https://programmable.market/docs">Docs</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/programmablehq">GitHub</a>
  &nbsp;·&nbsp;
  <a href="https://x.com/ProgrammableHQ">X</a>
</p>
