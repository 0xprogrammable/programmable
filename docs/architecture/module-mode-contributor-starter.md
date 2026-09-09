# Module Mode contributor references

Start with the [current contribution guide](../public/developers/module-mode.md), [agent prompt](../../packages/classic-modules/AGENT_GUIDE.md) and [API reference](../../packages/classic-modules/MODULE-API.md). Before copying source, run the current CLI's `module-context` command to obtain `identity.author`, `identity.defaultRewardWallet`, prerequisites and review coverage. Generate and save the family salt once. Only an explicitly different payout wallet or missing behavior, asset or dependency decision needs user input.

The source-intake descriptor accepts open versioned runtime and host-capability names. A starter supplies a concrete interface and behavior to reuse where suitable; it does not define the set of eligible ideas. New requirements travel in the same source submission and need an operator-selected review plan before approval and publication.

## Native reference

The concrete source package is [`packages/classic-modules/examples/native-program`](../../packages/classic-modules/examples/native-program/README.md). It demonstrates `EveryNthBuyRewardV1` with a functional factory, six immutable configuration fields and a managed unused-budget refund after expiry. It is an unreviewed reference, not a catalogue activation.

The portable package includes the exact runtime interfaces/base/types, actual runtime and vault for offline tests, unchanged pinned OpenZeppelin source dependencies, a Foundry profile, ten Solidity tests including 1,000 fuzz cases, and no dependency installation script. A copied module does not need a Git repository. All uploaded files have exact SHA-256 declarations and are limited to 128 files, 4 MiB each and 16 MiB total.

Contributor starting points:

- [README and copy/prepare/API steps](../../packages/classic-modules/examples/native-program/README.md)
- [Copyable AI contributor prompt](../../packages/classic-modules/examples/native-program/AI-PROMPT.md)
- [Actual program and factory](../../packages/classic-modules/examples/native-program/src/module-mode/modules/EveryNthBuyRewardV1.sol)
- [Configuration schema](../../packages/classic-modules/examples/native-program/config.schema.json) and [exact ABI/host binding](../../packages/classic-modules/examples/native-program/runtime-binding.json)
- [Required website reads, roles, actions and states](../../packages/classic-modules/examples/native-program/ui/management.json)
- [Review requirements and actual permitted envelope](../../packages/classic-modules/examples/native-program/REVIEW.md)
- [API source descriptor](../../packages/classic-modules/examples/native-program/module.json), [safe local hash preparation](../../packages/classic-modules/examples/native-program/tools/prepare.mjs), and [SDK verification](../../packages/classic-modules/examples/native-program/tools/check-sdk.mjs)

Use `bash contracts/test/module-mode/starter/run-tests.sh -vv` for the portable Solidity suite. With the repository's pinned Node dependencies installed, run `node --test packages/classic-modules/examples/native-program/tools/package.test.mjs` and `node packages/classic-modules/examples/native-program/tools/check-sdk.mjs`. The SDK path actually validates the descriptor, loads and hashes every source file, produces an API request with `moduleSubmissionFromPack`, validates transport bytes and compares exact compiler outputs to the local build reference. The checks do not send requests.

The factory config is **192-byte `abi.encode(uint32,uint128,uint128,uint64,bool,address)`**, ordered as `everyN, minimumGrossNative, rewardNative, endsAt, includeInitialBuy, refundWallet`. The generic OpenConfig record encoder sorts fields lexically and is not a substitute for this mapping. The refund action has exactly zero input bytes; OpenConfig's empty-record sentinel is likewise not its input. Both differences are exercised in SDK tests and explicitly declared for host integration.

Admission must cover the full constructor-valid configuration envelope or implement stronger onchain validation. Metadata and UI ranges alone cannot constrain accepted config bytes. A new package cannot cause a host to import arbitrary JavaScript, trust declared component addresses, activate unknown capabilities or grant fee/liquidity rights.

API intake uses `POST /v1/modules/submissions`, gated by current `/v1/modules/capabilities`, and an API key bound to `descriptor.author`. Replace fixture author/reward addresses with the authenticated context values before preparing a real submission. Resolve any separate refund beneficiary from the intended behavior before building; do not silently reuse a fixture address. The CLI pin and public transport instructions are maintained by the integration owner in `packages/classic-modules/MODULE-API.md`. Intake, review, factory admission, onchain source verification, website support and real launch availability remain separate evidence states.

Contributor progress now has a separate API contract: `GET /v1/modules/review-capabilities` and the owner-only `GET /v1/modules/submissions/:id/review`. The current immutable CLI includes `review-capabilities` and `review-status-module`; its strict client binds each progress response to the saved intake identity and exposes the workflow's `nextAction`. Follow the current manifest in agent discovery for its version and hash. The starter's source package and older intake CLI reference remain an exact reproducible source fixture. Follow the current public API guide for review progress; neither changing the CLI version nor reading an accepted review changes the starter package's own version, source hash or admission status.

For a complete contribution through the additive Engine Host ABI, use the [Engine source starter](../../packages/classic-modules/examples/engine-program/README.md). It includes a real quote-bound request/fulfill/refund engine, complete pinned Solidity dependencies, free/fixed quote schema examples, compiler checks and a materialized operator plan through the same source API. The [versioned source download manifest](../../public/developers/module-mode-starters/engine-program/v0.1.0-development.1/manifest.json) records its exact source and archive hashes; populate its wallet declarations from authenticated context and retain the generated family salt. The reference claims no review, registry or public deployment approval.
