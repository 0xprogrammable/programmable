![Programmable](public/brand/programmable-cover.png)

# Programmable

Programmable is a platform for launching coins and applications on Uniswap v4. Creators configure coins with reusable modules or submit projects with their own contracts through the Custom Launch API. This repository contains the application, EVM contracts, public indexing model and product documentation.

[Open the platform](https://programmable.market) · [Read the docs](https://programmable.market/docs) · [Explore coins](https://programmable.market/explore/robinhood)

## Launch paths

| Path | Purpose | Guide |
| --- | --- | --- |
| Module Mode | Launch a coin with a bonding curve, creator fees and optional configurable modules | [Module Mode](docs/public/models/module-mode.md) |
| Custom Launch | Deploy a token, hook or application with its own source and contract structure | [API quickstart](docs/public/developers/custom-launch-quickstart.md) |
| Classic on Ethereum | Launch a fixed supply token with selected buy and sell transaction fees | [Classic](docs/public/models/classic.md) |

On Robinhood Chain (`4663`), separate token and hook contracts use the V4 API. A single contract implementing both token and hook roles uses MultiRole V2. Ethereum Mainnet uses its own V3 integration. Each path publishes the supported profile, client, funding requirements and evidence contract through [live discovery](https://programmable.market/.well-known/programmable.json).

## Custom Launch integration

Start with the [quickstart](https://programmable.market/docs/developers/custom-launch-quickstart), choose the network and contract layout, then use the client advertised by discovery to package, validate, submit and track the exact project. Create a wallet-bound key in the [API-key manager](https://programmable.market/developers/api-keys). Keep `PROGRAMMABLE_API_KEY` in a secret store or environment variable.

API credentials grant scoped preparation and read access. The controller wallet reviews and signs the authorized transaction separately. Finality, source verification, indexing and trading support each have their own evidence. An unchanged retry preserves the original request bytes and idempotency key.

Robinhood Native20 charges **20 bps (0.20%)** of gross native ETH per successful buy or sell for Programmable. Creator fees and pool fees are additional. A zero creator fee earns zero creator rewards. Module Mode and Ethereum deployments retain their own fee contracts; [Fees and revenue](docs/public/economics.md) covers rates, recipients, version differences and the 50% buyback-and-burn allocation policy.

## Modules and indexing

Module authors submit versioned source, configuration, management actions and required evidence through the contribution API. Accepted revisions can enter the catalog. Coins preserve the exact module revisions they selected; a new catalog revision does not alter an existing deployment.

- [Build a module](docs/public/developers/module-mode.md) explains contribution, review and publication.
- [Index Module Mode](docs/public/developers/module-mode-indexing.md) defines native launcher events, getters and canonical coin identity.
- [Index Custom Launches](docs/public/developers/robinhood-terminal-indexer.md) covers V4 Router V1 and MultiRole Router V2.
- [Choose an indexing source](docs/public/developers/indexing.md) explains common persistence, finality and metadata rules.

Index by source version, chain and token address. Module names, token symbols and optional market data must not determine whether a verified launch exists. Supporting a launch's trading behavior is a separate integration task.

## Repository structure

| Path | Contents |
| --- | --- |
| [app/](app), [components/](components) | Product routes, API handlers and interface components |
| [lib/](lib), [indexer/](indexer) | Application logic, onchain readers and indexing |
| [contracts/](contracts) | Contracts, Foundry tests, deployment scripts and release evidence |
| [config/](config), [scripts/](scripts), [ops/](ops) | Shared configuration, verification and operations |
| [docs/public/](docs/public) | GitBook source and public developer guides |
| [tests/](tests) | Application and interface checks |

Read [Project structure](docs/PROJECT-STRUCTURE.md) for the full map. The `production` branch owns the full product and website releases. The `main` branch retains the public contracts and release-evidence view.

## Run locally

Use Node.js `24.14.0` and the locked dependency tree:

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. Supply your own provider configuration in `.env.local` and keep credentials out of Git. Run the repository checks for a change:

```sh
npm run verify
```

For contract changes, also run `npm run contracts:verify`. Local checks, a production deployment and an onchain release are separate results. Read [AGENTS.md](AGENTS.md) and the relevant contribution and release instructions before changing a subsystem.

## Related repositories

| Repository | Purpose |
| --- | --- |
| [Developers](https://github.com/programmablehq/Developers) | Read-only API contracts, deployment manifests and integration examples |
| [Launch Policy](https://github.com/programmablehq/Launch-Policy) | Versioned launch requirements, schemas and policy checks |
| [V4 token](https://github.com/programmablehq/programmable-v4-token) | Main token, launch hook, initializer and distribution records |
| [Programmable Protocol](https://github.com/programmablehq/PROGRAMMABLE-PROTOCOL) | Runtime-neutral protocol specification and conformance artifacts |

## Community and security

Join [Discord](https://discord.com/invite/programmable), follow [X](https://x.com/ProgrammableHQ), and inspect launch, fee and burn statistics on [Dune](https://dune.com/programmablehq/analytics). The [official links](docs/public/reference/official-links.md) page collects the supported entry points.

Use this repository's private security reporting channel for vulnerabilities. Tests, source verification and launch provenance are not an external audit or a guarantee of token safety.
