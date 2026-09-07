# Building a Module Mode contribution with an agent

Start with the [current contribution guide](https://programmable.market/developer-reference/module-mode), [API reference](https://programmable.market/developers/module-mode-api-v1.md) and [agent discovery](https://programmable.market/api/agent). Native programs and executable Engine contributions share the same source API. Use standalone CLI `1.0.0-development.5` with the existing SDK development.4 source/API format, verify its published manifest hash, and keep credentials in `PROGRAMMABLE_MODULES_API_KEY`.

Choose the actual host interface before writing the source. The [Native starter](examples/native-program/README.md) targets the Native callback runtime. The [Engine starter](examples/engine-program/README.md) implements creator-attested, funded quote settlement with expiry refunds through `constructor(Context,bytes)`, `initialize` and `execute`. Its [versioned download manifest](https://programmable.market/developers/module-mode-starters/engine-program/v0.1.0-development.1/manifest.json) pins a complete source archive. Read its trust model and use the contributor's own wallets. Names in `requiresHost`, an intake receipt and a local passing test confer no review or deployment authority.

Use `binding: {mode: "input", default?: value}` for an editable launch field and `binding: {mode: "fixed", value}` for a fixed field. Fixed quote addresses also need constructor and host-revision enforcement. General quote trading keeps its infrastructure configuration fixed and requires a qualified direct Quote/WETH conversion pool; do not infer support for an asset from its ticker or address alone.

Native V2 and the Engine V1 quote profile charge 10 bps without eligible families, or 30 bps with them (10 for Programmable, 20 shared among distinct eligible families), plus creator fees. Native V1 retains its original 20-bps economics and claims. Non-trading escrow and settlement do not invent trade fees. The source guide's version and the active release determine which rules apply.

Use `prepare-module-submission`, `submit-module`, `status-module` and `review-status-module` for the source workflow. The operator selects the executable review plan, and independent reviewer, registry, deployed-source and catalog checks follow. The historical Classic V1 interface below remains a separate, narrower contract; its limits must not be imposed on a different profile.

## Historical Classic Modules V1 interface

Use this guide with the versioned interface and README in this package. It is a contributor specification, not a grant of deployment, signing or catalog-review authority.

## Starting prompt

> Build a Programmable Classic Modules V1 module with this behavior: [describe the precise rule]. Use the existing IClassicModuleV1 interface and its typed context/effect. The author account is [address], the initial reward wallet is [address], the family salt is [bytes32], and the target chain is [chain ID]. Start with a creator fee policy (kind 1) or a native quote limit per swap (kind 2). If the requested behavior requires another capability, explain the unsupported effect before choosing an existing kind. Produce source, tests, a complete compiler input artifact, bounded configuration schema and a requested-review manifest. Validate the package locally and show any missing deployment/source proof honestly.

## Required implementation rules

- Read the actual interface and the requested behavior before coding. Reuse one existing effect kind. Do not put arbitrary external hook execution inside `evaluate`.
- Configuration is fixed at launch. At most eight static ABI values fit the 256-byte V1 limit. Define parameter ranges and failure behavior before implementing them.
- A fee policy changes only creator fees and leaves both limit fields zero. The fixed 10 bps Treasury plus 10 bps author pool remains enforced by the engine.
- A limit module leaves both creator fee fields zero. Limits apply per swap, and zero means unbounded for that direction. Explain what repeated swaps or multiple wallets can do.
- All module calls are read-only and limited to 100,000 gas. Avoid storage writes, custody, approvals, `delegatecall`, mutable dependencies, proxies or privileged shortcuts.
- Implement precise `validateConfig` checks, including length, values, the base fee context and actual useful behavior. Do not rely solely on JSON validation; raw onchain config is authoritative.
- Test meaningful boundaries, wrong configurations, elapsed time where relevant, both trade directions, worst-case gas and combinations. Use integer units and avoid floating-point calculations for onchain quantities.
- Produce literal complete source inputs with exact compiler settings and pinned dependencies. Do not execute contributed source or package scripts inside an intake/web process.
- Keep `reviewStatus` equal to `requested`. A successful local test or queue acceptance cannot become an onchain approval or a trusted production catalog.

## Required handoff

Provide the changed module source, the behavior and its limitations in plain language, tests and their results, ordered ABI configuration fields and schema, a source artifact SHA-256, the exact source commit, family/version IDs and author/reward wallet. Record the actual deployment address/runtime hash only when verified; do not fabricate those values to complete a manifest. Offline fixtures remain clearly labeled fixtures.

Then use `validate-module`, `pack` and the operator's authorized local contribution path. A new source revision needs new artifact and manifest commitments. If the old version was already approved, increment the version. The operator decides technical acceptance, and the independent registry/release process controls public availability.
