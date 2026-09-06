# Native program contributor starter

Build a real per-launch module and submit its source through the Module API. This reference gives every Nth eligible buy a fixed, pre-funded ETH reward. After a fixed end time, one configured wallet can reclaim only the unused budget. It includes the program, factory, exact source dependencies, configuration schema, management specification and executable tests.

**This is an unreviewed source reference. It is not a deployed module, an approved catalogue entry or a tradable launch engine.** The factory can be considered for admission only after independent review, exact build/deployment checks and host compatibility review. The host capability names in this package are requirements, not evidence that a public host currently supports them.

## Start locally

You can copy this directory anywhere. Your module does not need its own Git repository. Solidity source dependencies are included as exact, unchanged files with hashes and origin revisions in `SOURCE-PINS.json`; the packer never fetches dependencies. The program uses `ModuleProgramBaseV1`, `IModuleProgramV1` and `ModuleRuntimeTypesV1`. The bundled runtime, vault and four OpenZeppelin files exist so the local tests can execute the actual runtime, not a fake budget provider.

The local tools require Node 24.14.x, Foundry and the Solidity 0.8.26 compiler. If the compiler is already installed, this command needs no network or dependency installation:

```sh
forge test --offline
```

Run it from this directory. From the full Programmable repository, the equivalent is:

```sh
bash contracts/test/module-mode/starter/run-tests.sh -vv
```

The ten tests include 1,000 fuzz cases. They exercise actual factory creation, bound callbacks, immutable configuration, buyer identity, exhausted budgets, failing ETH receivers, pull claims, action roles/deadlines/nonces, old-config rejection and isolated refunds. The fixture engine supplies test trade amounts. These tests do not prove PoolManager settlement, Robinhood deployment, Creator fees, indexing or launch identity.

## Make it yours

1. Copy the directory. Edit the program and factory under `src/module-mode/modules/`, the schema, `module.template.json`, `runtime-binding.json`, `ui/management.json`, and tests to match the actual idea. Keep host interfaces compatible with the selected host. Add each new source file to `package-files.json`.
2. Explain every effect, mutable state, dependency, spend path, role and failure mode in `REVIEW.md`. Keep the source closure complete. New functionality can request new capabilities, but unsupported capabilities remain unavailable until the host implements and reviews them.
3. Set your author and contributor reward wallets and choose a fresh bytes32 family salt. These are ordinary EVM wallets. Author identity and family ownership are authenticated by the contribution API; writing an address into a descriptor does not prove ownership.
4. Rebuild and review your compiler outputs, tests and source pins. Regenerate the descriptor after **every** source or documentation change. The API pack must contain exactly the declared files and matching hashes.

The checked-in `module.json` uses visibly repetitive fixture addresses `0x111…111` and `0x222…222`; `configuration.fixture.json` uses `0x333…333`. They are syntactically valid test values, **not wallets whose ownership is claimed here**, and must never be submitted or used for a real launch. The fixture family salt and dates are also examples. The preparation helper refuses fixture identities unless explicitly run with `--fixture`.

From your copied module directory, replace the symbolic values below with your actual wallets and a fresh 32-byte hexadecimal salt:

```sh
node tools/prepare.mjs --root . \
  --author YOUR_AUTHOR_WALLET \
  --reward-wallet YOUR_CONTRIBUTOR_REWARD_WALLET \
  --family-salt YOUR_FRESH_BYTES32
```

This creates `module.json` using only explicitly listed local files. It contains no API key and does not execute candidate source, install packages, call the network, submit, sign or deploy. It enforces the 128-file, 4-MiB-per-file and 16-MiB-total source limits. The API SDK performs the complete descriptor and transport validation afterwards. Use `--fixture` only to reproduce this repository's fixture descriptor.

## Pack and submit through the API

Use the pinned standalone Module Mode CLI from the official developer distribution and verify its manifest before running it. The versioned distribution path is `/developers/module-mode-cli/v1.0.0-development.1/programmable-module-mode-1.0.0-development.1.mjs`, with `manifest.json` beside it. The main API instructions are `packages/classic-modules/MODULE-API.md` in the full repository and `/developers/module-mode-api-v1.md` in the public documentation. Commands below assume the verified CLI is saved as `programmable-module-mode.mjs` beside your working directory.

```sh
node ./programmable-module-mode.mjs prepare-module-submission \
  --root ./my-module --package module.json --out artifacts/submission.json
```

`prepare-module-submission` invokes the source-package loader and transport validation. The wire body is `programmable.modules.submission.v0.1`: `descriptor` plus the exact declared `files`, each with a SHA-256 and base64 bytes. Git URL/revision provenance is optional. The HTTP body limit is 24 MiB, while the decoded source limit remains 16 MiB.

Before sending, check `GET https://api.programmable.market/v1/modules/capabilities`. An unavailable or disabled contribution API is a stop condition; source readiness cannot override it. A successful submission means intake, not approval or launch availability.

The transport endpoint is `POST https://api.programmable.market/v1/modules/submissions`. Use the **API key bound to the descriptor's author wallet**. Supply it through the process secret environment variable `PROGRAMMABLE_MODULES_API_KEY`; never put a key into this package, a checked-in command, a log or the request JSON. After inspecting the generated request and current API capabilities, the contribution command is:

```sh
node ./programmable-module-mode.mjs submit-module \
  --root ./my-module --request artifacts/submission.json \
  --api-origin https://api.programmable.market \
  --idempotency-key YOUR_UNIQUE_16_TO_128_CHARACTER_KEY
```

This last command sends an external submission. It is shown for the contributor; it has **not** been executed for this reference. Preserve the returned submission identity and follow the API's review status. Revised source requires a new digest and explicit revision relationship; never overwrite evidence for an older reviewed package.

## Configuration and management contract

The six configuration fields encode to exactly 192 bytes, in this order:

```solidity
abi.encode(
    uint32 everyN,
    uint128 minimumGrossNative,
    uint128 rewardNative,
    uint64 endsAt,
    bool includeInitialBuy,
    address refundWallet
)
```

All amounts use integer wei. `everyN`, the minimum and reward must be positive. `endsAt` must be in the future when the instance is constructed; `refundWallet` must be nonzero. The old 160-byte form is rejected. The generic OpenConfig compiler orders record fields lexically, so its `encoded` field is **not** this factory configuration. `runtime-binding.json` declares the exact mapping and `tools/config-codec.mjs` tests it against the schema. A host must explicitly review/support the adapter before constructing a launch. A schema declaration alone does not install a codec or renderer.

At or after `endsAt`, the fixed `refundWallet` may send a zero-value transaction to the verified host runtime:

```solidity
runtime.executeAction(
    launchKey,
    instanceIndex,
    keccak256("programmable.module-mode.reward.reclaim-unused.v1"),
    hex"", // exactly zero bytes; not the OpenConfig empty-record sentinel
    currentActorNonce,
    transactionDeadline
);
```

The host derives the launch/instance/runtime from verified onchain bindings, reads the current nonce for the connected wallet, checks the chain time and displays the decoded effect. The module checks the actual actor, not a wallet supplied in input data. Reclaiming creates a backed pull claim; it does not send ETH during the callback. Common vault actions handle funding, fixed-beneficiary claims and a beneficiary redirecting its own claim. See `ui/management.json` for labels, input controls, role states, empty/error/pending states and all required reads.

`refundWallet` belongs to this launch's reward budget. `rewardWallet` in `module.json` belongs to the contributor's separately accounted author rewards. They are distinct roles. This module has no authority over platform fees, Creator fees, CTO recipients, token supply or pool liquidity. It does not change the host's 20-bps fee policy.

## Verify the SDK path in the full repository

With the repository's pinned Node dependencies installed, from the repository root:

```sh
node --test packages/classic-modules/examples/native-program/tools/package.test.mjs
node packages/classic-modules/examples/native-program/tools/check-sdk.mjs
```

These checks actually call `validateOpenPackage`, `loadOpenSourcePackage`, `moduleSubmissionFromPack` and `validateModuleSubmissionRequest`, reject altered source bytes, compare the exact config/action ABI and verify local compiler output against `build-reference.json`. They write only ignored fixture artifacts. They do not authenticate an author, prove a repository revision, deploy a factory, audit the program or approve the package.

`tools/check-sdk.mjs` and `tools/config-codec.mjs` are development references that import the monorepo SDK; use the verified standalone CLI for a copied package. The Solidity suite and `tools/prepare.mjs` are self-contained. A reviewer can reproduce the same checks in a sandbox without trusting package-provided JavaScript.

MIT source licenses are declared in the Solidity files; the unchanged OpenZeppelin license is included under `dependencies/openzeppelin-contracts/LICENSE`.
