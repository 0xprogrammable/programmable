# Build and submit a Module Mode contribution

Start with the [contribution guide](https://programmable.market/developer-reference/module-mode), [API reference](https://programmable.market/developers/module-mode-api-v1.md) and [agent discovery](https://programmable.market/api/agent). Use the current CLI manifest from `workflows.moduleContribution` and verify the download hash before running it. CLI `1.0.0-development.7` supports the authenticated `module-context` command. Keep the API key in the agent's private `PROGRAMMABLE_API_KEY` environment variable; `PROGRAMMABLE_MODULES_API_KEY` remains a compatible alias.

## Starting prompt

> Build and submit a reusable Programmable module for this idea: [idea]. The API key is already configured privately as PROGRAMMABLE_API_KEY. Read https://programmable.market/api/agent and its module contribution guide, verify the current CLI, then run module-context before building. Use identity.author and identity.defaultRewardWallet unless I explicitly request a different payout address. Generate and save a family salt once, and choose a suitable name and initial version. Ask together only for missing product decisions, exact assets or external dependencies that you cannot establish from the idea and trusted discovery. Use the open source-package format with the actual runtime, capabilities, complete source, configuration, management actions and meaningful checks. Do not force the idea into an existing example or report an unknown runtime as an intake rejection. Record any missing review or host coverage. Prepare and save the exact request, submit it with a stable idempotency key, verify the receipt, then read the separate review status. Return the submission ID, package identity, current state and next action. Preserve the same request and idempotency key after an ambiguous upload. Do not approve, deploy, sign transactions or move funds.

## Before writing source

Run `module-context --api-origin https://api.programmable.market` with the verified CLI. It supplies the authenticated identity, missing scopes, required submission inputs, request limits and current review coverage. A key with `modules:read` can read the context; submission also requires `modules:submit`. Require `authorization.canSubmit` and `intake.available` before uploading. Resolve missing scope or product inputs first. Do not ask the user to repeat an address supplied by authenticated context.

The user supplies the idea. The agent can choose routine package details, generate a stable lowercase bytes32 `familySalt` and default `rewardWallet` to `identity.defaultRewardWallet`. Keep that salt across revisions. An explicitly requested different reward wallet is a separate upfront input. A stock ticker alone is insufficient to bind a quote asset: establish its exact chain, token address, units and required market dependencies before implementing a fixed asset.

Runtime, interface and host-capability names are versioned namespaces. The source intake has no business-category allowlist. Existing build profiles describe the review worker's executable coverage. If the idea needs another runtime or capability, declare the actual requirement and include its source and documentation in the same submission. The platform must establish the missing review or host integration before approval and publication.

## Build the package

Use an existing starter only when its interface fits the idea. The [Native starter](examples/native-program/README.md) targets Native callbacks. The [Engine starter](examples/engine-program/README.md) demonstrates creator-attested, funded quote settlement with expiry refunds through `constructor(Context,bytes)`, `initialize` and `execute`. Its [download manifest](https://programmable.market/developers/module-mode-starters/engine-program/v0.1.0-development.1/manifest.json) pins the source archive. Replace fixture identities with the values established before the build. A starter is an unreviewed reference.

Package complete source and dependencies, exact build settings, configuration units and bounds, funds and permissions, management reads/actions and behavior-specific evidence. Reuse applicable checks. Contributor code runs in an isolated build environment; intake only validates and stores bytes.

Use `binding: {mode: "input", default?: value}` for an editable launch field and `binding: {mode: "fixed", value}` for a fixed field. Constructors and the admitted host must enforce fixed values against raw calls. Document the actual ABI order rather than assuming the generic record encoder matches it. Required host names, fixture results and metadata do not grant executable authority.

Read the selected profile's economics and [current contribution guide](https://programmable.market/developer-reference/module-mode#contributor-rewards). Fee rules and earned claims follow their original release. A non-trading settlement does not acquire a swap-fee basis merely by being a module.

## Submit and hand off

Use `prepare-module-submission` to save the exact request, then `submit-module` with a stable idempotency key. Preserve the request bytes, `packageId`, `familyId`, `requestDigest` and returned `submissionId`. The CLI validates the receipt against the submitted source and identity.

Read the saved receipt with `status-module` and current progress with `review-status-module`. The receipt remains `draft_received` and `unreviewed`; the review resource reports the current state and `nextAction`. A missing review plan is platform work, unless the reviewer identifies a concrete source change. Do not create a new submission while the original is queued or waiting for a plan.

For requested changes, update the version and source hashes and prepare a linked revision with `--supersedes`. Return the source package, relevant check results, receipt and next required action. Technical acceptance, Registry admission, deployed-code verification and public availability are separate outcomes.

## Historical Classic V1

The [Classic V1 reference](README.md#historical-classic-modules-v1) describes its read-only typed effects, static configuration, gas limit and local queue. Those interface restrictions apply to that runtime. Use the current source API above for new Native, Engine or other declared source architectures.
