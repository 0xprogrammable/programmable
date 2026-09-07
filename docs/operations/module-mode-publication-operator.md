# Module publication and native lifecycle wallet operator

This local owner operator completes the wallet handoff missing from the existing
`ops/module-mode-publication` preparation/export tools. It creates no private key,
sends no RPC transaction, and changes no public activation flag. The owner reviews
and confirms each exact EIP-1559 request in MetaMask on Robinhood Chain 4663.

The original nine-call base deployment plan and its journal remain untouched.
Publication plans use `programmable.module-mode-publication-owner-plan.v1`;
canary operation plans use `programmable.module-mode-lifecycle-operator-plan.v1`.
Neither is a public release or a finalized lifecycle proof.

## Inputs and review authority

Use the actual immutable `identity.json` from the base deployment collector. Each
entry in the `--modules` JSON array contains these exact local consistency inputs:

```ts
{
  source: ModuleSubmissionRequest,
  manifest: ModuleModeHostManifest,
  review: ModuleReviewDecisionRecordV1,
  artifact: ReviewBuildArtifact,
  factorySalt: Hex
}
```

Obtain `factorySalt` and the manifest from the existing canonical
`createHostPreparation` or `ops/module-mode-publication/operator.mjs manifest`.
That implementation binds the domain, chain, release and package. Do not use the
raw package ID as its salt. The source is the immutable submitted package; review
is the exact accepted append-only database record; artifact is the completed
protected native worker artifact. No synthetic approval or digest is accepted as
runtime authority.

Plan construction validates these files and derives the exact bytecode and
registry calldata. Before starting the live server and before every prepare and
wallet handoff, the operator additionally:

- Checks the exact clean protected `production` source, tree, reviewed plan digest
  and fresh successful hosted Verify run through the existing authority helper.
- Uses `readOperatorSession` and `createAuthenticatedReviewReader` from the
  existing publication toolkit to re-read the fixed-origin private BFF.
- Requires the current accepted revision, protected worker/compiler/input checks,
  exact source/artifact/decision, and the canonical host manifest and factory salt.
- Verifies the actual Registry owner and immutable contract runtime hashes using
  the same two independent reviewed providers as the base deployment operator.

The `--session-file` is the existing private owner-only administrator session
format documented in `ops/module-mode-publication/README.md`. Tokens and provider
URLs never belong in arguments, plans, messages, public artifacts or source code.
A contributor API key is not reviewer authority. Plain canary operations require
no module-review session because no module is selected.

## Publish the reviewed modules

From a clean, reviewed production checkout, prepare a new exclusive output file:

```sh
node contracts/scripts/module-mode/publication-plan.mjs \
  --identity "$MODULE_RELEASE_IDENTITY" \
  --modules "$MODULE_ACCEPTED_BUNDLE" \
  --owner "$MODULE_REGISTRY_OWNER" \
  --output "$MODULE_PUBLICATION_PLAN"
```

Use `--candidate` only for local inspection; its `sourceClean:false` disables live
wallet requests. Manifest construction before acceptance remains available through
the existing canonical `manifest` command. The wallet plan itself requires the
real accepted decision.

For each selected Native V1 module, the plan has three sequential operations:

1. Deploy its no-argument factory with the canonical salt and exact protected
   worker creation bytes. Both providers must report vacant code and zero nonce.
2. Register the new contributor family with the API-authenticated author, fixed
   family salt, reward wallet and immutable source request digest.
3. Admit the package revision with its exact factory/code/manifest/callback pins.

Native V2 publication requires an explicit `--fee-eligibility` JSON tuple chosen
before acceptance. The accepted manifest binds `eligible` and `reviewDigest`.
A nonzero digest produces the existing owner-only `setFamilyFeeEligibility` call
before revision admission; false/zero keeps the untouched default. Publication
checks the exact `familyFeeEligibility` getter, and a supplied setter transaction
must match owner, calldata, canonical receipt and event. Native V1 keeps its
original inputs and calls.

This first-family operator deliberately refuses to overwrite or transfer an
existing family, revision or deployment. Existing-family revision workflows and
already-deployed factory readback use the existing publication toolkit; do not
clear this journal or skip an unknown transaction to force progress.

Observe the real quote without producing a wallet request:

```sh
node contracts/scripts/module-mode/publication-operator.mjs observe \
  --plan "$MODULE_PUBLICATION_PLAN" --step 0
```

Then start a single owner-confirmed step with explicit integer gas, fee and ETH
value limits. For publication steps, `--max-value-wei 0` is mandatory in practice
because every prepared call sends zero ETH; gas is separate.

```sh
node contracts/scripts/module-mode/publication-operator.mjs serve \
  --plan "$MODULE_PUBLICATION_PLAN" --step 0 --port 8787 \
  --session-file "$MODULE_REVIEW_SESSION" \
  --journal "$MODULE_PUBLICATION_JOURNAL" \
  --reviewed-plan-digest "$MODULE_REVIEWED_PUBLICATION_PLAN_DIGEST" \
  --verify-run-id "$MODULE_VERIFY_RUN_ID" \
  --verify-run-attempt "$MODULE_VERIFY_RUN_ATTEMPT" \
  --max-gas "$MODULE_REVIEWED_MAX_GAS" \
  --max-fee-per-gas-wei "$MODULE_REVIEWED_MAX_FEE_WEI" \
  --priority-fee-per-gas-wei "$MODULE_REVIEWED_PRIORITY_WEI" \
  --max-value-wei 0
```

The journal is the same durable owner-owned `0700` directory standard as the
base operator, outside repositories and temporary directories. Each handoff is
written exclusively and synced before returning any wallet payload. The page
shows the sender, transaction recipient, resulting contract/token, function,
arguments, exact ETH value, maximum gas cost and source commitments. It disables
wallet actions in `--ui-check` mode and rejects cross-origin requests.

Record and verify each actual receipt before the next step. The server verifies
all preceding recorded operations, exact transaction payload/nonce/gas fields,
canonical inclusion, deployed runtime and registry post-state. Record/check are
also available after a restart:

```sh
node contracts/scripts/module-mode/publication-operator.mjs record \
  --plan "$MODULE_PUBLICATION_PLAN" --step 0 \
  --journal "$MODULE_PUBLICATION_JOURNAL" \
  --transaction-hash "$MODULE_ACTUAL_TRANSACTION_HASH"
```

An explicitly requested unknown-outcome retry requires both `--retry-attempt N`
and `--reviewed-request-digest` of the original durable request. It permits only
the identical wallet payload and same nonce, preserves the original gas fields,
rechecks vacancy/state/funding and appends a separate retry record. A hash,
consumed/pending nonce or changed request blocks this path. Never raise fee or
value limits automatically. A source/plan change needs a new protected review;
this operator does not reinterpret an old plan as newly deployed source.

After the real factory/family/revision receipts, use the existing authenticated
publication `export` command. It independently reads and checks actual onchain
state before producing source/manifest/review and the public catalogue entry.
This wallet operator does not publish those artifacts or enable launches.

## Plain and module canaries

`lifecycle-plan.mjs` accepts `--identity`, `--modules`, `--owner`, `--action` and
`--output`, with optional `--candidate`. Each plan contains one operation. A plain
canary uses an empty module array and 0% creator fee. The module canary uses the
actual accepted modules and a positive whole-percent creator fee, for example
100 bps, so the backend can prove both creator and contributor accrual. The
platform fee is 20 bps for Native V1. Native V2 binds its separate economics
policy: 10 bps protocol plus a 20 bps author pool only when the launch contains
an eligible family. Its plain canary therefore has 10 bps and its module canary
has 30 bps in total platform fees; creator fees remain separate.

V2 obtains each selection's `feeEligibility` from its accepted, hash-bound host
manifest. The caller cannot supply an alternative eligibility field in the
action. Before launch, both providers must return that exact family eligibility
and the hook's matching `previewRecipe`. The V2 recipe includes the economics
policy and the hash of every selected family, eligibility flag and review digest.
Eligible families are sorted and deduplicated; repeated selections of one family
do not multiply its author allocation. V2 permits up to 16 distinct packages and
eight eligible families. V1 retains its eight distinct-family bound.

The V2 launch calldata includes the derived `expectedRecipeHash`. A changed
eligibility review blocks preparation or the final arm refresh instead of
silently changing the wallet payload. After inclusion, the operator checks the
exact `NativeEconomicsBound` event and the hook's saved per-selection snapshot,
pool fee and ledger fee. Later operations use that saved launch snapshot, so a
later registry eligibility decision is not substituted into an existing pool.

A launch action has this shape; all amounts are decimal base-unit strings and the
addresses, salt, names, expiry and configuration must be deliberately selected:

```ts
{
  kind: "launch", canaryKind: "plain" | "modules",
  name: string, symbol: string, creatorSalt: Hex,
  metadata: { description: string, website: string, image: string, extraData: Hex },
  creatorWallets: Address[], creatorSharesBps: number[], creatorFeeBps: number,
  moduleConfigurations: Array<{ packageId: Hex, config: Hex, funding: string }>,
  initialBuyNative: string, minimumTokenOut: string, deadline: string
}
```

The configuration bytes come from the reviewed source ABI mapping. The plan sorts
selections by functional family and keeps budgets matched to their packages. A
management manifest with `budget.fundable:false` forces zero funding. Use the
controlled refund wallet in reward configuration and a fresh end time. The exact
ETH value is `initialBuyNative + sum(moduleFunding)`; no LP token or alternate
asset is substituted for the native fee currency.

Use a candidate plan and `observe` for a first read-only quote. Its
`simulatedResult.initialBuyTokens` is a quote, not a receipt. Before creating the
clean wallet plan, choose a nonzero minimum from that quote using the desired
slippage bound; for example `quoted * 9900 / 10000` for 1%. The live operator
re-simulates the exact final calldata and does not silently lower that minimum.
It checks token prediction, owner, hook, runtime, pool identity and purchase
amounts. The deadline must remain between two minutes and one hour from the
observed block when preparing or arming a canary.

After a real launch receipt, obtain the token's actual runtime code hash from
both providers. A separate buy or sell action is:

```ts
{
  kind: "buy" | "sell", canaryKind: "plain" | "modules",
  token: Address, tokenCodeHash: Hex,
  amount: string, minimumOut: string, deadline: string,
  launch: { plan: originalLaunchPlan, evidence: verifiedLaunchReceipt }
}
```

Amounts are exact input: negative `amountSpecified` is encoded by the planner.
Buys send exactly the gross native input; sells send zero ETH. The minimum output
must be positive, and the recipient is always the reviewed owner. Both providers
must confirm that the token belongs to that owner's native launcher record. The
receipt must contain the matching native trade event and amounts.

Native V2 also supports the two exact-output canary operations:

```ts
{
  kind: "buyExactOutput" | "sellExactOutput", canaryKind: "plain" | "modules",
  token: Address, tokenCodeHash: Hex,
  amount: string, maximumInput: string, deadline: string,
  launch: { plan: originalLaunchPlan, evidence: verifiedLaunchReceipt }
}
```

Here `amount` is the positive exact requested output, in token units for a buy or
wei for a sell. `maximumInput` is the positive input ceiling in the other asset.
Both values must be below the released native engine's signed amount bound.
An exact-output buy sends exactly `maximumInput` wei. The runtime-pinned router
atomically refunds `maximumInput - nativeAmount` to the caller and preserves its
pre-existing balance. An exact-output sell sends no ETH and requires a separate
token approval covering the chosen maximum input. Unspent approved tokens remain
with the owner; they are not an ETH refund.

Simulation and receipt checks require the exact output and an actual positive
input no larger than the ceiling. V2 evidence reports `refundNative` calculated
from the exact input ceiling and verified router result/event. This calculation
uses the pinned router's successful atomic settlement semantics; it is not an
independent wallet-balance-difference observation. The operator never raises a
ceiling or changes an expired deadline. V1 operation plans retain their original
exact-input behavior.

Embed the original complete launch plan and its actual verified receipt output as
JSON objects in `launch`; filenames or locally invented receipt claims are not
accepted. Every subsequent operation re-reads that transaction and its canonical
receipt from both providers, then binds the exact module configurations, recipe,
program, creator fees and recipients. Keep creator recipients at revision zero
until both canaries have completed their sell. CTO demonstrations follow those
trades; the lifecycle collector reads fee state at the historical sell block.

Before selling, create a separate exact approval, never an unlimited allowance:

```ts
{
  kind: "approve", canaryKind: "plain" | "modules",
  token: Address, tokenCodeHash: Hex, amount: string,
  launch: { plan: originalLaunchPlan, evidence: verifiedLaunchReceipt }
}
```

The spender is always the immutable released native router. The post-receipt
allowance must equal the requested amount. Use an actual owner token balance and
a deliberate sell amount; no arbitrary token or spender is accepted.

Use the same `publication-operator.mjs` serve/observe/record/receipt commands for
these one-step lifecycle plans, setting `--max-value-wei` explicitly to cover the
reviewed purchase and budgets. Keep each original plan and receipt. All recorded
outcomes are still `included-code-verified-unfinalized`.

`createLifecycleCollectorPlan(identity, canaries)` exports the backend's existing
`programmable.module-mode-lifecycle-plan.v1` shape from the two sets of actual
launch/buy/sell plans and operator receipt records. Approval receipts are excluded.
It binds distinct tokens and six distinct transaction hashes to the same release.
The backend native lifecycle collector must then independently re-observe these
receipts, module instances, fee accounting and Ethereum-finalized checkpoints.
Only its separate validated artifact can satisfy the lifecycle activation gate.

For Native V2, keep five operation records per canary: `launch`, `buy`, `sell`,
`buyExactOutput`, and `sellExactOutput`. Preserve original creator recipients
until this complete proof is collected. The existing V2 reference converter
requires all ten actual transactions and the V2 economics event:

```sh
node contracts/scripts/module-native-v2/lifecycle.mjs \
  --identity "$MODULE_RELEASE_IDENTITY" \
  --canaries "$MODULE_ACTUAL_V2_CANARIES" \
  --output "$MODULE_LIFECYCLE_PLAN" \
  --source-root "$MODULE_CLEAN_CONTRACT_SOURCE_ROOT"
```

The operation plan's `sourceCommit` names the current reviewed operator source.
Its `identity.sourceCommit` continues to name the actually deployed contracts.
The unchanged wallet source-authority helper requires the operation plan to match
the clean current production commit and its fresh hosted Verify evidence. The
wallet builder has no source-root override. The later V2 lifecycle converter's
existing `--source-root` selects the clean contract source for its mandatory
identity/build comparison. It produces transaction references only; the original
backend collector still independently verifies receipts, fees and Ethereum
finality before activation.

## Existing management flow

Use `components/module-coin-console.tsx` and the canonical
`lib/module-mode/management.ts` intents after the appropriate release/catalogue is
available: `claim`, `program`, `claim-fees` and `replace-creators` (see its exact
intent definition). They prepare via `prepareModuleNativeManagementTransaction`,
with ordinary owner wallet confirmation. The UI supports the reward claim,
reviewed refund action, fee claim and controlled future creator-recipient change.
Do not change creator recipients before the lifecycle collector has captured the
canary's original recipient revision. The collector deliberately expects revision
zero and unchanged author wallets during that proof.

## Focused checks

```sh
node --test contracts/scripts/module-mode/publication-operator.test.mjs \
  contracts/scripts/module-mode/lifecycle-plan.test.mjs
```

`tests/module-mode-publication-owner-operator.test.ts` runs these regressions in
the hosted interface test gate. Tests use synthetic parser/RPC records and never
serve as source, review, deployment or lifecycle evidence. Rendered desktop/mobile
wallet-page QA remains an integration-owner check with `--ui-check`, followed by
actual simulation and owner-confirmed receipts during release.
