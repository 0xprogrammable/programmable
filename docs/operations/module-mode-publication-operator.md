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

For publication and Native/Engine lifecycle operations, `--max-gas` is the fixed
gas allowance displayed and sent to the wallet. Preparation, arm and retry each
require `ceil(max(provider estimates) * 1.05) + 25000` to fit within that allowance,
and the balance must cover the exact ETH value plus `maxGas * maxFeePerGas`.
Changing the allowance or fee fields requires a new preparation and owner review;
an unresolved request can only be retried with its original wallet fields. The
displayed maximum gas cost is a cap, not the transaction's actual cost.

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

## Private Engine publication and lifecycle

The same personal operator also accepts the closed
`programmable.module-engine-publication-owner-plan.v1` and
`programmable.module-engine-lifecycle-owner-plan.v1` profiles. These are private
wallet plans for an actual collected Engine release identity. They do not create
an active release or an available template. The ordinary website client still
requires its authenticated active release and catalog.

Keep the two source identities separate: `identity.sourceCommit` identifies the
already deployed contracts; the outer `sourceCommit` and `sourceTree` identify the
clean production operator checkout and its successful hosted verification. A
later operator fix does not relabel previously deployed contracts. The existing
`assertSourceAuthority`, provider custody transport, explicit gas/value ceilings,
pre-send journal, same-request retry, receipt and MetaMask confirmation are shared
with Native operations.

The accepted reviewer session belongs to `reviewAuthority`, taken from the exact
accepted decision. The wallet that pays and sends is `owner`. Publication requires
that wallet to be the **current Registry owner**, read from both providers. A
launch or execute wallet is an **operation actor** and need not own the Registry
or be the reviewer. Creator-only operations additionally require the actual
Host launch creator. EOA transaction nonce and Host per-launch/per-actor nonce
are separate checks.

### Accepted Engine bundle and owner admission

Use the existing protected build and accepted decision. Fetch their canonical
bundle through the original fixed-origin authenticated reader; this command only
reads the accepted submission and writes a new private file:

```sh
node contracts/scripts/module-engine/publication-plan.mjs bundle \
  --identity "$ENGINE_COLLECTED_IDENTITY" \
  --definition "$ENGINE_PUBLICATION_DEFINITION" \
  --submission "$ENGINE_ACCEPTED_SUBMISSION_ID" \
  --session-file "$MODULE_REVIEW_SESSION" \
  --output "$ENGINE_ACCEPTED_BUNDLE"
```

`--definition` is the existing Engine publication definition from
`ops/module-mode-publication`: `{ profile, catalogDefinition, revision }`. The
output has exactly `{ source, manifest, review, artifact, buildPlan }`. Local
copies are consistency inputs; they never replace the current authenticated
Accepted revision or protected worker proof. The live server re-fetches that
proof before starting, preparing, and arming each request. Revocation, a changed
review/build/manifest, an unauthenticated cloned object, or a different reviewer
session blocks the handoff.

```sh
node contracts/scripts/module-engine/publication-plan.mjs prepare \
  --identity "$ENGINE_COLLECTED_IDENTITY" \
  --bundle "$ENGINE_ACCEPTED_BUNDLE" \
  --owner "$ENGINE_CURRENT_REGISTRY_OWNER" \
  --family-state absent \
  --output "$ENGINE_PUBLICATION_OWNER_PLAN"
```

`absent` produces `registerReviewedFamily` then Host `approveRevision`. Use
`existing` only to reuse an already registered family with the exact accepted
author and reward wallet; it produces only the Host admission. The two providers
verify the chosen state. The revision must be absent, and its creation/runtime
hashes, immutable maps, operation permissions, money/coin rights, fixed quote CA,
fixed configuration, required initial operation and fee-family list come from the
same accepted manifest and original publication ABI. No factory is deployed and
no existing revision is overwritten or re-enabled.

For each step use the **existing** commands above, substituting this plan:

```sh
node contracts/scripts/module-mode/publication-operator.mjs observe \
  --plan "$ENGINE_PUBLICATION_OWNER_PLAN" --step "$ENGINE_STEP"

node contracts/scripts/module-mode/publication-operator.mjs serve \
  --plan "$ENGINE_PUBLICATION_OWNER_PLAN" --step "$ENGINE_STEP" --port 8787 \
  --session-file "$MODULE_REVIEW_SESSION" --journal "$MODULE_PUBLICATION_JOURNAL" \
  --reviewed-plan-digest "$ENGINE_REVIEWED_PLAN_DIGEST" \
  --verify-run-id "$MODULE_VERIFY_RUN_ID" --verify-run-attempt "$MODULE_VERIFY_RUN_ATTEMPT" \
  --max-gas "$OWNER_MAX_GAS" --max-fee-per-gas-wei "$OWNER_MAX_FEE_WEI" \
  --priority-fee-per-gas-wei "$OWNER_PRIORITY_FEE_WEI" --max-value-wei 0
```

The UI shows the decoded target/function/arguments, value, chain and source before
MetaMask. The owner confirms each exact request personally. `record` and `receipt`
use the same original journal commands; a received wallet hash is never treated
as verified inclusion. Export afterward through the original
`ops/module-mode-publication/operator.mjs export`, supplying its actual
`{family: hash|null, revision: hash}`. Export still does not activate a catalog.

### Host launch and exact funding

Prepare a launch action JSON with these exact keys (all addresses, salts, integer
amounts, configuration and deadline are real reviewed inputs):

```ts
{
  kind: "launch",
  name: string, symbol: string, description: string,
  imageUri: string, socialLinks: ModuleSocialLinks,
  quote: { address: Address, runtimeCodeHash: Hex, decimals: number },
  configuration: OpenConfigValue,
  creatorSalt: Hex, engineSalt: Hex, launchData: Hex,
  creatorWallets: Address[], creatorSharesBps: number[],
  buyCreatorFeeBps: number, sellCreatorFeeBps: number,
  initialOperation: EngineIntent | null,
  deadline: string,
  funding: { mode: "none" | "existing" | "approve" | "reset-approve", expectedAllowance: string }
}
```

An `EngineIntent` has exactly `{ operationId, recipient, inputAsset, inputAmount,
outputAsset, minimumOutput, data }`. Assets are the symbolic roles `"primary"`,
`"quote"`, or `"native"`; the planner substitutes the predicted/actual primary
token, exact quote CA, or zero address. Decimal amount strings are raw token/wei
units. `data` is the accepted engine operation's ABI-encoded payload, displayed in
the reviewed Host operation. The existing pure intent helpers in
`lib/module-engine/client.ts` define deposit, withdrawal, quote trade, settlement
request, fulfill and refund data. Their operation IDs must be admitted by the
actual Host revision; a display label supplies no permission.

```sh
node contracts/scripts/module-engine/lifecycle-operator-plan.mjs \
  --identity "$ENGINE_COLLECTED_IDENTITY" --bundle "$ENGINE_ACCEPTED_BUNDLE" \
  --owner "$ENGINE_OPERATION_ACTOR" --action "$ENGINE_LAUNCH_ACTION" \
  --output "$ENGINE_LAUNCH_OWNER_PLAN"
```

The common pure planner compiles the SDK schema bindings and constraints, enforces
fixed quote/configuration, derives factory token CREATE2, constructor/runtime
patches, engine CREATE2 and full Host plan hash, and encodes the actual Host ABI.
A quote engine uses its required hook-address flags. The quote runtime and decimals
are independently read before every handoff. The Engine Host V1's immutable
`eligibleFamilies` list governs its Ledger V2 10/30 bps policy; its reused Registry
V1 has no Native V2 `familyFeeEligibility` getter.

Use `none` when there is no positive ERC20 input. `existing` requires allowance
**exactly equal** to the operation input. `approve` requires a zero prior allowance
and adds one exact approval. `reset-approve` requires the explicit positive prior
allowance and adds a zero reset followed by that exact approval. The allowance is
always for the fixed Host and next reviewed input asset/amount; an unlimited,
unrelated, or stand-alone approval is rejected. The initial operation executes
atomically inside Host `launch`, with actor nonce zero. ETH value equals only its
native input; ERC20 funding sends zero ETH. Each preceding approval has its own
wallet confirmation and canonical journal receipt before launch can proceed.

Use the same `observe`/`serve`/`record`/`receipt` commands with this plan and its
returned step indexes, owner-reviewed fee ceilings and exact `--max-value-wei`.
The deadline must remain 120–3600 seconds from the common provider block. The
Host enforces a deadline for an actual operation; an empty-initial-operation launch
and ERC20 approvals have only the pre-handoff expiry check, not an onchain expiry. Expired
plans must be prepared and reviewed again; an unresolved armed request must first
be reconciled, never bypassed by silently replacing its plan or nonce.

### Existing coin operations and D10 references

An execute action has exactly:

```ts
{
  kind: "execute",
  launch: { plan: OriginalEngineLaunchOwnerPlan, entry: OriginalJournalEntry, evidence: OriginalReceiptEvidence },
  intent: EngineIntent,
  nonce: string, deadline: string,
  funding: { mode: "none" | "existing" | "approve" | "reset-approve", expectedAllowance: string }
}
```

Use the **launch step** from the original plan, including the initial operation
if it had one. `journalEntry(journalDirectory, launchPlan.planDigest, launchStep)`
from the unchanged `module-mode/journal.mjs` returns its original armed request
and recorded transaction hash. Its `.receipt.json` supplies `evidence`. These
three existing JSON values can be embedded locally into the action file without
changing any journal file. The planner re-derives the original plan and binds
its exact request; the observer independently re-reads both providers' actual
transaction, canonical receipt, Engine events and getters. A Native receipt or
an invented launch reference cannot supply membership.

Run the same `lifecycle-operator-plan.mjs` command with this action and its actual
actor. The required Host actor nonce is a raw decimal string in the reviewed
action. It is re-read independently of the EOA nonce before every send. Input
balance, exact allowance, permission roles even for zero amounts, creator-only
rights, engine runtime, source release and launch plan all remain bound. A
revision disabled for new launches retains its existing operation rights.

The receipt verifies `EngineLaunchBound`, `EngineLaunchParametersBound` and
`EngineOperationExecuted`, with exact canonical event encoding and original
transaction fields. Output must meet the signed minimum. The canonical Host event attests the actual
execute result hash; opaque result bytes may change with market or engine state,
so the simulated result is not mislabeled as an execution limit. The pinned engine
enforces its reviewed quote route and ETH fee floors as part of each call. Resource IDs may advance between simulation
and inclusion; the actual resources hash is tied to the successful Host event and
getter, while creation/configuration/plan bytes remain exact. Successful ERC20
inputs must consume the exact allowance. Evidence is explicitly
`sourceKind:"module-engine-v1"`, `included-code-verified-unfinalized`; Native event
identity, Ethereum finality, public indexing and activation are not inferred.

Feed actual `canary.launchId`, launch transaction and manifest hash, plus each
actual operation's transaction/operationId/actor/nonce, into the already existing
`contracts/scripts/module-engine/lifecycle-plan.mjs` reference format for its
collector. A plan, local simulation, wallet hash or this operator receipt does
not replace that final lifecycle collection or the separate D10 release gates.
