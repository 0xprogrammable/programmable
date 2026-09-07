---
description: Build, configure and submit a reusable Module Mode program through the API
---

# Build a module

A Module Mode contribution is a reusable program with a versioned source package. Its configuration, required capabilities, funding and management actions are part of the package. The same package can be used by multiple coins with different configuration values.

## Connect an agent

1. Connect the author's EVM wallet on [API keys](https://programmable.market/developers/api-keys). Create a key with **Launches + modules** access or use an existing key with `modules:submit` and `modules:read`.
2. Select **Copy connection**. Give the connection to your agent through its private credential setup.
3. Read the [agent guide](https://programmable.market/agents.md) and [agent discovery](https://programmable.market/api/agent). Follow `workflows.moduleContribution` for the API guide, current CLI manifest and capability endpoints.
4. Verify the CLI download against the hash in its manifest. Keep the key in `PROGRAMMABLE_API_KEY`; the module CLI reads the same secret through `PROGRAMMABLE_MODULES_API_KEY`.

An API key authorizes the scopes assigned to it. It does not sign wallet transactions or approve a module. Documentation and capability reads are public.

## Package requirements

| Part | Include |
| --- | --- |
| Identity | A name, version, stable family identifier, author wallet and reward wallet |
| Source | The complete source files, their hashes, dependencies and reproducible build settings |
| Configuration | Field types, units, defaults, limits and exact encoding |
| Compatibility | Required host capabilities, dependencies, conflicts and resource limits |
| Funding | Assets, amounts, custody, spending rules, failure behavior and refunds |
| Management | Read methods, transaction actions, input schemas and the wallet roles allowed to use them |
| Evidence | Tests, build artifacts and the security and compatibility evidence required by the selected profile |

Both wallets must be nonzero EVM addresses. The author must match the wallet that owns the API key. The reward wallet may be different. A family identifies one contribution across its revisions; helper contracts and repeated instances do not create additional reward shares.

Configuration fields and management actions must be described in the supported manifests. The host validates those declarations and renders the corresponding controls. Arbitrary frontend code from a submission is not executed by the website. If the module requires a new control type, runtime capability or market engine, include that requirement in the submission for review.

## Submit and follow the review

Use the [API and CLI reference](https://programmable.market/developers/module-mode-api-v1.md) for the exact request format and commands.

| Operation | Endpoint at `https://api.programmable.market` |
| --- | --- |
| Read intake capabilities | `GET /v1/modules/capabilities` |
| Submit a package | `POST /v1/modules/submissions` |
| List your submissions | `GET /v1/modules/submissions` |
| Read one submission | `GET /v1/modules/submissions/:id` |
| Read review capabilities | `GET /v1/modules/review-capabilities` |
| Read build and review progress | `GET /v1/modules/submissions/:id/review` |

Prepare and test the package locally, save the exact request and submit it with a stable idempotency key. Keep the returned submission ID. If the connection fails, retry those same bytes with the same key. Changed source requires a new revision.

The intake receipt records that the package was received. Read the separate review resource for current progress and `nextAction`. Review acceptance is followed by registry admission, deployed-code verification and catalog activation. Availability is determined by the active release and catalog.

## Existing coins and indexing

A coin records the module revisions and configuration selected at launch. Later catalog changes do not alter that record. Management actions may change only the state permitted by the deployed contracts.

Indexer integration depends on the launch source version, not module names or categories. A new module using an existing source version keeps the same launch event and identity format. Read [Index Module Mode launches](https://programmable.market/docs/developers/module-mode-indexing) before adding an engine or changing an identity interface.

## Contributor rewards

For the native ETH engine, the protocol fee is 0.20% in addition to the selected creator fee. Half is shared equally among the distinct eligible module families used by a coin; without eligible families, the protocol receives the full fee. Eligibility and attribution are bound during admission. Rewards arise from actual qualifying fees. Module operating budgets, creator fees and earned claims have separate accounting.

The [contributor reference](https://github.com/programmablehq/PROGRAMMABLE/blob/production/docs/architecture/module-mode-contributor-starter.md) contains the package layout, build procedure and host interface requirements.
