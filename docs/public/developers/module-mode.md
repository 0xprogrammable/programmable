---
description: Build, configure and submit a reusable Module Mode program through the API
---

# Build a module

A Module Mode contribution is a reusable program with a versioned source package. Its configuration, required capabilities, funding and management actions are part of the package. The same package can be used by multiple coins with different configuration values.

Native programs and Engine contributions use the same source API and immutable submission format. The operator selects the executable build profile for the submitted source. A `requiresHost` name alone does not implement a capability.

## Connect an agent

1. Connect the author's EVM wallet on [API keys](https://programmable.market/developers/api-keys). Create a key with **Launches + modules** access or use an existing key with `modules:submit` and `modules:read`.
2. Select **Copy connection**. Give the connection to your agent through its private credential setup.
3. Read the [agent guide](https://programmable.market/agents.md) and [agent discovery](https://programmable.market/api/agent). Follow `workflows.moduleContribution` for the API guide, current CLI manifest and capability endpoints.
4. Verify the CLI download against the hash in its manifest. Keep the key in `PROGRAMMABLE_API_KEY`; the module CLI reads the same secret through `PROGRAMMABLE_MODULES_API_KEY`.

An API key authorizes the scopes assigned to it. It does not sign wallet transactions or approve a module. Documentation and capability reads are public.

The current standalone CLI is **1.0.0-development.6**. It retains the SDK development.4 source/API and configuration formats. The [Engine starter manifest](https://programmable.market/developers/module-mode-starters/engine-program/v0.1.0-development.1/manifest.json) identifies the versioned source archive and its hash. Download and verify that archive, then follow its `README.md` to compile, provide your own author/reward wallets and prepare the existing source request. The example implements creator-attested quote settlement. It contains no approved revision or deployed host address.

## Select a build profile

`programmable.native-solidity@1` builds a Native program and factory for the existing callback interface. `programmable.module-engine-solidity@1` builds executable Solidity against `constructor(Context,bytes)`, `contextHash()`, `initialize(bytes)` and `execute(Operation)`. The Engine host binds creation code, canonical constructor arguments, actual runtime and compiler-derived immutable locations for each instance. Both profiles require an operator-authorized plan, isolated compiler/test execution and an independent review decision.

The Engine interface supports different operation models. These source references describe behavior and review requirements; they are not a list of available templates:

- **Quote trading:** exact-input buys and sells with a user output minimum. Quote-denominated fees convert to ETH through the reviewed direct Quote/WETH V3 route; WETH unwraps directly. The pool must satisfy the pinned fee tier, real price history, freshness, depth and price-movement checks. A valid contract address alone is insufficient. The user can tighten the conversion minimum but cannot replace the route or weaken its floor.
- **Escrow:** an exact quote deposit creates a liability for the payer; withdrawal follows the recorded unlock rule. The primary coin remains locked and this profile offers no swap market.
- **Creator-attested settlement:** a payer funds an immutable beneficiary, amount, obligation hash and refund deadline. The launch creator can fulfill before expiry; the payer can refund an unresolved request at or after expiry. Creator attestation is the trust model. An evidence hash does not verify external delivery. The downloadable starter fixes request windows between 60 seconds and 30 days and offers no swaps.

The [Engine host specification](https://github.com/programmablehq/PROGRAMMABLE/blob/production/contracts/spec/module-engine-host-v1.md) defines exact operation permissions, gas/data bounds, token behavior and quote-market requirements. Transfer-tax or transfer-blocked assets can prevent progress. A new custody rule, price model or external dependency needs executable source and its own evidence.

## General and fixed configuration

SDK development.4 supports `binding: {mode: "input", default?: value}` and `binding: {mode: "fixed", value}` on configuration fields. Input values remain editable within their schema. A fixed field may be omitted or repeated exactly; a different value fails SDK/API compilation with `OPEN_CONFIG_FIXED_OVERRIDE`.

A quote address input belongs to one reusable template, not a ticker-specific source package. A fixed quote template also binds the exact address in the host revision's `fixedQuoteAsset`; its constructor must reject conflicting raw configuration. Hiding a field in the website does not enforce the onchain rule.

General quote trading leaves `fixedQuoteAsset` zero but still binds the reviewed infrastructure with a nonzero `fixedConfigurationHash`. The same configuration derives the direct conversion pool from the chosen quote address and fixed fee tier. General settlement can leave both revision fields zero when its constructor enforces the complete accepted configuration. Use the profile's exact ABI mapping, including tuples, rather than assuming generic record encoding matches Solidity.

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

Configuration fields and management actions must be described in the supported manifests. The website renders the supported configuration fields and the quote, escrow and settlement controls for their reviewed interfaces. Other admitted Engine operations use **Advanced actions**, with the exact reviewed operation ID, allowed asset roles, amounts, recipient and action data. Required custom initial actions use the same controls during launch. The website simulates the complete host transaction and revalidates permissions before the wallet request; it does not infer a payload ABI or explain opaque action data from its operation ID. Contributors must document that data format.

Custom Engine launches also expose **Advanced launch inputs** for exact creator and engine salts and initialization bytes. These values use the existing compiler and full launch simulation. An entered custom engine salt is preserved; blank salts use fresh random values. The standard quote interface retains its existing address mining. A successful local preparation does not establish public availability or live lifecycle evidence.

Arbitrary frontend code from a submission is not executed by the website. If the module requires a new control type, runtime capability or market engine, include that requirement in the submission for review.

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
| Export an accepted build | `GET /v1/modules/submissions/:id/review-export` |

Prepare and test the package locally, save the exact request and submit it with a stable idempotency key. Keep the returned submission ID. If the connection fails, retry those same bytes with the same key. Changed source requires a new revision.

The intake receipt records that the package was received. Read the separate review resource for current progress and `nextAction`. Review acceptance is followed by registry admission, deployed-code verification and catalog activation. Availability is determined by the active release and catalog.

After acceptance, the author's `modules:read` key can download the exact plan, artifact and decision through the [HTTP build export](https://programmable.market/developers/module-mode-api-v1.md#export-an-accepted-build-over-http). The response is bounded to 3 MiB. The existing CLI has no export command and keeps its 1 MiB response limit. The export grants no publication authority: the existing authorized operator still performs the protected publication steps, and launch or management transactions require their existing wallet authority.

## Existing coins and indexing

A coin records the module revisions and configuration selected at launch. Later catalog changes do not alter that record. Management actions may change only the state permitted by the deployed contracts.

Indexer integration depends on the launch source version, not module names or categories. A new module using an existing source version keeps the same launch event and identity format. Read [Index Module Mode launches](https://programmable.market/docs/developers/module-mode-indexing) before adding an engine or changing an identity interface.

## Contributor rewards

Fee rules follow the launch source version. Native V2 and the Engine V1 quote trading profile charge 10 bps without eligible families, or 30 bps with them: 10 bps for Programmable and 20 bps shared equally among distinct admitted families. Creator fees are additional. Engine quote fees are charged on gross quote input for a buy and gross quote output for a sell; author claims cover the ETH actually received after conversion. Non-trading operations have no swap-fee basis.

Native V1 retains its original 20-bps rule: 10/10 with eligible families, or the full 20 bps to Programmable without them. Its old ledger and earned claims remain authoritative. Helpers, engine dependencies, imports and repeated instances do not add eligible families. Eligibility is explicitly bound during admission.

Module funding, creator fees and earned author claims remain separate. Changing future creator recipients does not move already earned claims, the module author's reward wallet or a fixed refund beneficiary.

## Recover transactions and claims

Keep the chain, account, token address, exact release identity and transaction hash. After a timeout, check the wallet's submitted transaction and canonical receipt before starting another action. The existing [operation recovery client](https://github.com/programmablehq/PROGRAMMABLE/blob/production/lib/module-mode-operation-recovery.ts) reconciles Native and Engine transactions against their original release, calldata, value and receipt. A saved browser record cannot authorize a new send; a mined receipt is still separate from finalized indexing.

For website-independent reads and wallet preparation, use the [Native management client](https://github.com/programmablehq/PROGRAMMABLE/blob/production/lib/module-mode/management.ts) or [Engine client](https://github.com/programmablehq/PROGRAMMABLE/blob/production/lib/module-engine/client.ts) from the verified source revision, with the original release evidence and your own RPC. Verify the deployed target and current wallet role before signing. The source-contribution CLI does not send launches, swaps or claims.

Accrued fee claims remain in the original release's ledger. Read `claimable(account)` there and use its verified `claimTo(recipient)` interface from the entitled wallet, with zero native value plus network gas. Engine integrations can use `prepareModuleEngineClaim`; Native integrations use the existing `claim-fees` management intent. The recipient does not choose whose credit is claimed. Module budget rewards and escrow refunds use their separate instance/host actions. A website outage or later release does not transfer these rights to another ledger or administrator.

The [contributor reference](https://github.com/programmablehq/PROGRAMMABLE/blob/production/docs/architecture/module-mode-contributor-starter.md) contains the package layout, build procedure and host interface requirements.
