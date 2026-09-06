# Classic Modules V1: contributing and review contract

Status: local implementation. `packages/classic-modules` provides module validation, recipe hashing, source packaging and a local review queue. No public API, npm release, registry deployment or website availability is implied.

## Product contract

A contributor builds a reusable module, binds an author and reward wallet, submits an immutable revision and receives a review decision. A reviewed version can later be approved in `ClassicModuleRegistryV1` and included in the operator's trusted catalog. Launching an already approved combination does not require a new per-token review. The optional AI chat uses the same recipe validator and cannot approve modules or override conflicts.

The catalog may grow to thousands of options. One launch uses at most eight different families. It selects no more than one creator fee policy (`kind = 1`) and may combine quote trade limits (`kind = 2`). New effect kinds need an explicitly versioned engine. The standard does not claim to compose arbitrary Uniswap hooks safely.

## Contributor handoff

Each review request provides:

1. Stable author-derived family ID, positive version, exact version ID, author account and initial reward wallet.
2. Complete literal Solidity compiler input, full immutable repository commit, Solidity 0.8.26 compiler/settings, source artifact SHA-256 and pinned dependencies.
3. Exact chain/implementation address and runtime Keccak-256. Creation bytecode, source hashes and proxy addresses do not substitute for the runtime binding.
4. Clear economic behavior, bounds, meaningful failure cases and gas assumptions. A quote cap is per swap; multiple swaps can exceed it in aggregate.
5. Strict configuration schema, schema commitment, ordered static ABI fields and matching displayed/raw configuration test cases.
6. Unit, adversarial and combination tests, including the applicable arithmetic, gas, returndata, quote/execute and boundary conditions.

The CLI checks the machine format and artifact hashes. It never compiles, downloads, runs, deploys or approves the submitted code. See the package README for concrete commands and a reference Foundry project layout.

## Local workflow that exists now

From `packages/classic-modules`, run `validate-module`, optionally `pack`, then `submit-local --manifest <path> --queue <path>`. Paths are bounded, local and relative to an operator-selected root. Submission is idempotent by immutable manifest digest. Source bytes and the committed schema must match before a request can enter the queue.

Operators use `list-local` and `status-local` to inspect requests. `review-local` appends `changes_requested`, `rejected` or `accepted` with a reviewer address, note, sequence and exact package digest. The contributor manifest always remains `requested`. Reviewer identity is a local filesystem-operator assertion, not wallet-authenticated evidence. Queue access must therefore stay under operator control.

Every changed pending artifact receives a new manifest digest and submission. Once an onchain version is approved, its implementation, runtime hash, kind and manifest digest cannot be overwritten; the contributor must increment the version for a new implementation. Old review history remains available for inspection.

An accepted local review does not create a trusted-catalog entry and does not approve a contract onchain. The local queue intentionally has no automatic bridge from `accepted` to executable authority.

## Review and publication are separate authorities

| Stage | Required evidence | Authority |
| --- | --- | --- |
| Local format/package | Exact manifest, schema and source-artifact hashes | Pure SDK and bounded local CLI |
| Author/family | Wallet ownership and author-derived family binding | Authenticated author; registry `registerFamily` |
| Isolated technical review | Reproducible build, source/runtime equivalence, behavior and combination tests | Review operators |
| Local decision | Append-only review record tied to package digest | Local filesystem operator |
| Registry approval | Exact deployed version/runtime and approved manifest digest | Registry review authority |
| Trusted catalog | Canonical chain/registry/deployment binding plus enabled version | Release/indexer process |
| Public launch | Exact validated recipe, currently approved codehash, release readiness and wallet transaction | Creator wallet |

A request that claims its own `approved` state is invalid. The recipe validator requires a separately supplied trusted catalog; server handlers must obtain that catalog from their own verified source and must ignore/reject client-supplied catalog authority. A mere HTTP success, local acceptance, ABI match or codehash match is insufficient proof of security or public readiness.

## Contract-level review requirements

Modules expose `moduleKind`, `validateConfig` and `evaluate` through `IClassicModuleV1`. Calls are bounded `staticcall`s. V1 limits each module call to 100,000 gas and configuration to 256 bytes. Check the entire configuration, reject unsupported encodings, and return only fields belonging to the declared effect kind. The kernel independently enforces returned effects.

Review must confirm immutable behavior: no proxy or upgrade authority, mutable foreign dependency, hidden privileged condition, custody requirement, token allowance or `delegatecall`. A `view` signature does not establish these facts. Confirm that the runtime matches its complete compiled artifact, including immutables and metadata settings.

Fee policies can affect only disclosed creator fees, never the fixed 20 bps protocol split. Trade-limit modules are per-swap constraints, not an anti-Sybil mechanism. Zero limit means unbounded for that direction, and an expiring policy may deliberately return zero in the future. The reference quote-limit configuration itself requires at least one positive cap.

Review the meaningful combinations, not merely each module independently. Two fee policies conflict. One family cannot appear twice, including two versions of the same family. Test multiple limit modules, exact input/output, both trade directions, initial buy, fee boundaries, revert behavior, returndata and gas limits. Verify that a recipe snapshot and its royalties cannot change when the catalog is later updated or disabled for new launches.

## Canonical recipe and config

The recipe binds the chain, hook, registry, base creator fees, sorted families, exact version/implementation/runtime hash and raw config. All clients use the shared SDK encoding. Displayed JSON parameters must encode to those exact bytes, and the reviewed config schema digest must match.

The standard permits closed flat schemas with bounded integer/string/boolean values and static ABI fields only. It rejects arbitrary regex, references, custom validators and nested dynamic data. This makes catalog parameters machine-readable without executing contributor code. Contract `validateConfig` remains authoritative for effects beyond the two reference profiles.

The complete ABI expression and the fixed Solidity/JavaScript vector are documented in `packages/classic-modules/README.md` and `packages/classic-modules/test/recipe-hash-vector-v1.json`. Canonical JSON hashes metadata; ABI hashes launch execution. They are different commitments and are never interchangeable.

## Equal author royalties

20 bps means 0.20% of the defined swap quote amount: 10 bps Programmable and 10 bps authors. Creator fees are additional, including when the creator selects zero. The author amount is divided equally among selected families, not authors or source-file count. The same author with two selected families receives two equal slots. Review must reject artificial duplicate/fractional modules intended only to multiply slots. A dependency is not automatically another paid module.

The hook fee disclosure is not a complete route cost. The pool LP fee is zero, but the external Uniswap PoolManager protocol controller can change a directional protocol fee independently. Read the hook's `feeComponents` or canonical pool state when quoting. Unknown protocol fees remain unknown; the SDK never replaces them with zero or adds unlike fee bases into a misleading total. The actual swap quote and protected output/deadline govern the combined impact.

A family's immutable owner controls future payout-wallet rotation. Rotation does not change family ownership, weights, existing launch recipes or previously accrued claims. The submitted wallet is only the initial/review snapshot. UIs read the current registry wallet when showing a future recipient. Integer remainders and zero-module routing remain explicit contract/deployment rules; the SDK does not redirect them silently.

## Public API contract reserved for a later release

The implemented local commands are the current contribution path. A future public adapter can expose `POST /classic/modules/submissions`, `GET /classic/modules/submissions/:id` and authenticated review operations, backed by the same validators. These routes are a proposed interface and are not registered or live.

Before activating such a service, provide durable transactional storage, author wallet challenge/response, reviewer authorization, origin/auth/rate limits, size and quota limits, idempotency tied to author and digest, bounded artifact storage, tamper-evident review history and isolated build workers. Do not read arbitrary server filesystem paths, fetch arbitrary contributor URLs or execute source in the web process. Extract artifact references only after bounded manifest validation and execute no package lifecycle scripts. Keep catalog publication and registry transactions behind the independent release authority.

The first useful service is a review queue and status API. Public discovery, UI filtering and the optional chat can follow without changing the recipe or royalty rules.
