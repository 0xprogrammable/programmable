# Programmable workspace rules

## Canonical repository

- The public product repository is `https://github.com/programmablehq/PROGRAMMABLE`.
- `production` is the canonical full-product branch and the only branch used for website production releases.
- `main` remains the public contracts and release-evidence branch. Never deploy the website from `main`.
- Confirm the destination remote before every push. Do not assume that a remote named `origin` is canonical.
- Preserve unrelated local changes. Never clean, reset, or overwrite a dirty worktree to simplify a task.

## Parallel work

- Every parallel workstream uses its own Git worktree and `codex/` branch.
- Assign explicit path ownership before implementation. Two active workstreams must not edit the same files.
- Feature worktrees may produce local or preview builds. They must not deploy production.
- Only the integration owner may combine workstreams, run the complete release gate, and publish after explicit authorization.
- Product branches target `production`. Contract-only evidence may target `main` only when the task explicitly says so.
- Handoffs must include the branch, commit, changed paths, checks run, and remaining release blockers.

## Path ownership

- Web product: `app/`, `components/`, browser-facing files in `lib/`, and referenced assets in `public/`.
- Contracts: `contracts/src/`, `contracts/test/`, `contracts/script/`, `contracts/spec/`, and `contracts/security/`.
- Operations: `ops/` and narrowly assigned operational scripts.
- Shared integration: `config/`, shared onchain readers in `lib/onchain/`, release manifests, and deployment bindings. These require an integration-owner review.
- Documentation and brand assets: `docs/`, `README.md`, `public/brand/`, and `public/og/`.

## Release discipline

- `tested`, `deployed`, `source verified`, `lifecycle verified`, and `available` are separate states.
- Do not describe a model as live from a build, simulation, fork test, source match, or UI implementation alone.
- Production activation requires exact deployment evidence, runtime checks, provider-backed lifecycle verification, monitoring, and a clean integration build.
- Production deploys must use a clean integration worktree at the exact reviewed `production` commit.
- Never expose secrets, private keys, personal identities, or local environment files in commits, logs, screenshots, or public artifacts.

See [docs/PROJECT-STRUCTURE.md](docs/PROJECT-STRUCTURE.md) for the directory map.

## Public documentation

- Use factual, direct language. No marketing claims, em dashes, filler or rhetorical contrasts.
- Explain Module Mode through its interfaces and workflow. Do not maintain lists or counts of available modules in general documentation; read the active catalog instead.
- Keep variable release data in versioned discovery and evidence. State actual capabilities and limits without promising support for an unknown future engine.
- Index by launch source and canonical token identity. Module names, categories and optional market metadata must not determine whether a verified launch exists.
- Keep GitBook, native guides and agent discovery linked. See [docs/PUBLIC-DOCS-STYLE.md](docs/PUBLIC-DOCS-STYLE.md).
