# Building a Classic module with an agent

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
