# Native Module Mode deployment

The base engine has nine owner-confirmed CREATE2 transactions on Robinhood Chain
4663. The operator prepares exact transaction data, checks the reviewed source and
two independent providers, and records the wallet handoff before returning it to
the browser. It does not hold a private key or send RPC transactions.

Community modules and both starter modules use the same API review and publication
pipeline. Their factories and registry admissions are outside this base deployment.
There is no separate bootstrap approval or synthetic review digest.

## Bound configuration

`ops/module-mode-deployment/release-parameters.v1.json` contains the intended gas
payer, registry review authority, native initial-buy minimum and deployment label.
The current choice is:

| Role | Binding |
| --- | --- |
| Gas payer and registry review authority | `0x79879fe6f00c0986ca521ea6f5b276b5e28b1b9c` |
| Treasury and no-module fee recipient | `0xd88539d3c4c460136a733a3fd60cf6bf269079da` |
| Creator-fee recipient administrator | `0x79879fe6f00c0986ca521ea6f5b276b5e28b1b9c` |
| Minimum initial purchase | `400000000000000` wei, or `0.0004 ETH` gross |
| Platform fee | 20 bps on top of the selected creator fee |
| With selected module families | 10 bps treasury; 10 bps shared equally among distinct families |
| Without modules | All 20 bps treasury |

The minimum purchase includes trade fees. Separately funded module budgets and
network gas are additional. It is not a dollar oracle or a fixed USD-price promise.
These addresses are planned roles; the parameter file proves neither wallet
control nor funds. The dated public observation is preparation evidence only.

The operator uses the official deterministic deployer
`0x4e59b44847b379578588920ca78fbf26c0b4956c`, with runtime hash
`0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989`.
`core.mjs` also pins PoolManager, PositionManager, and the exact official Uniswap
deployment-source revision. Every requested transaction sends **0 ETH** to the
deterministic deployer and pays network gas separately.

## Build and inspect without a wallet

Use the repository's locked Node 24/npm dependencies and the existing contracts
bootstrap. The sealer requires Foundry 1.7.1, commit
`4072e48705af9d93e3c0f6e29e93b5e9a40caed8`, and Solidity 0.8.26. It rejects inherited
compiler overrides, dirty dependency checkouts, unpinned sources, changed compiler
settings, and bytecode that does not match the Git source object. It compiles
offline using the existing optimizer, EVM and no-CBOR settings.

From the repository root:

```sh
MODULE_MODE_FORGE=/absolute/path/to/pinned/forge \
  node contracts/scripts/module-mode/prepare.mjs \
  --candidate --output contracts/out/module-mode-deployment/candidate

node contracts/scripts/module-mode/operator.mjs \
  --ui-check \
  --plan contracts/out/module-mode-deployment/candidate/plan.json \
  --step 8 --port 8787
```

Candidate files have `sourceClean:false` and cannot authorize the live operator.
The UI-check server disables wallet access, provider access and journal writes.
The page displays the actual prepared constructor, target, transaction recipient,
fee roles and source hashes. No preview data is installed as a release.

The output directory is append-only: choose a fresh directory for a new build.
It contains `plan.json`, `build.json`, ABI data, standard Solidity JSON inputs,
unsubmitted source-verification request templates, and the exact encoded fork
simulation input. The candidate plan is not a transaction receipt.

For a local fork, provide a recent block supported by the selected read-only RPC:

```sh
cd contracts
MODULE_MODE_SIMULATION_RPC_URL="$MODULE_REVIEWED_SIMULATION_RPC" \
MODULE_MODE_SIMULATION_BLOCK="$MODULE_REVIEWED_SIMULATION_BLOCK" \
MODULE_MODE_SIMULATION_INPUT=out/module-mode-deployment/candidate/simulation-input.bin \
  /absolute/path/to/pinned/forge script \
  script/module-mode/SimulateModuleNativeDeploymentV1.s.sol:SimulateModuleNativeDeploymentV1 -vv
```

This script has no broadcast path. It executes the exact nine prepared calls in
the local fork and compares all expected runtime bytes, including constructors'
children. Its per-call gas figures are **not** final transaction gas estimates.
Historical-state RPC errors require a supported snapshot or archive provider;
they are not successful simulation evidence.

## Prepare the production wallet handoff

Only the integration owner releases from a clean, reviewed `production` checkout
of `programmablehq/PROGRAMMABLE`. Prepare again **without** `--candidate` after the
commit is final. The operator requires that exact commit and tree, matching local
`origin/production`, the exact workflow file, and a successful authenticated hosted
production Verify run/attempt under the existing six-hour freshness policy.
Its source proof uses the existing GitHub CLI transport; it never prints a token.

The two private providers use the existing reviewed custody/commitment mechanism
and `ROBINHOOD_MAINNET_RPC_URL_PRIMARY` and
`ROBINHOOD_MAINNET_RPC_URL_SECONDARY`. Do not put credential-bearing RPC URLs in
command arguments, source files, public evidence, logs or screenshots. A single
public endpoint cannot satisfy this quorum.

Before each wallet step, a read-only observation can provide the current gas
estimate, nonce, balance, code and provider bindings:

```sh
MODULE_MODE_FORGE=/absolute/path/to/pinned/forge \
  node contracts/scripts/module-mode/collect.mjs observe \
  --plan "$MODULE_DEPLOY_PLAN" --step 0
```

Create a real owner-owned directory with mode `0700` outside the checkout and
temporary directories. Keep that same durable journal for the whole plan. The
operator requires explicit reviewed limits for gas, max fee per gas and priority
fee, all in integer gas/wei units. It refuses an unfunded request or an estimate
above the ceiling. It never raises the limits automatically.

```sh
MODULE_MODE_FORGE=/absolute/path/to/pinned/forge \
  node contracts/scripts/module-mode/operator.mjs \
  --plan "$MODULE_DEPLOY_PLAN" --step 0 \
  --journal "$MODULE_DEPLOY_JOURNAL" \
  --reviewed-plan-digest "$MODULE_REVIEWED_PLAN_DIGEST" \
  --verify-run-id "$MODULE_VERIFY_RUN_ID" \
  --verify-run-attempt "$MODULE_VERIFY_RUN_ATTEMPT" \
  --max-gas "$MODULE_REVIEWED_MAX_GAS" \
  --max-fee-per-gas-wei "$MODULE_REVIEWED_MAX_FEE_WEI" \
  --priority-fee-per-gas-wei "$MODULE_REVIEWED_PRIORITY_WEI"
```

Open the loopback page in a browser with the owner's MetaMask. The owner connects
the exact EOA on chain 4663, simulates the step, reviews the decoded addresses and
constructor values plus maximum gas cost, and confirms the exact request in their
wallet. The server rechecks source authority, provider agreement, code, nonce,
balance, expiry and gas immediately before the durable handoff. The current
operator supports this EOA route; it does not silently treat a smart account as
an EOA.

| Step | Deployment | Children verified in the same receipt |
| --- | --- | --- |
| 0 | `tokenFactory` | — |
| 1 | `positionPlanner` | — |
| 2 | `launchPolicy` | — |
| 3 | `positionForwarderFactory` | — |
| 4 | `registry` | — |
| 5 | `runtimeFactory` | — |
| 6 | `swapRouterFactory` | — |
| 7 | `hook` | `rewardLedger` |
| 8 | `launcher` | `runtime`, `budgetVault`, `swapRouter` |

There are 13 deployed core contracts. The immutable release contract map includes
those 13 plus the existing PoolManager and PositionManager. The deployment proxy
is an additional verified precondition, not a product contract pin. Follow this
order and collect the successful receipt before continuing. The next step verifies
the earlier code and review authority again.

## Reconcile a wallet outcome

Every handoff has one exclusive durable request record before the browser can
receive the transaction. A crash, timeout, wallet change or unknown outcome cannot
automatically create another request. Reopen the same step with the same journal,
inspect wallet activity and record the actual hash:

```sh
MODULE_MODE_FORGE=/absolute/path/to/pinned/forge \
  node contracts/scripts/module-mode/collect.mjs record \
  --plan "$MODULE_DEPLOY_PLAN" --journal "$MODULE_DEPLOY_JOURNAL" \
  --step 0 --transaction-hash "$MODULE_ACTUAL_TX_HASH"
```

The browser has the same record-and-check controls. A supplied hash alone proves
nothing: both providers must agree on the original sender, recipient, calldata,
zero value, chain, type, nonce, gas and fee caps; successful canonical inclusion;
and all expected child code at that receipt's block. Pending receipts remain
pending. Changed payloads, replaced blocks and reverted transactions fail closed.
A rejection without a hash requires operator reconciliation before another
handoff. Never clear the journal to hide an unknown outcome. A recorded hash,
confirmed revert, consumed nonce or pending transaction must be reconciled;
the retry path below does not replace those transactions.

### Retry the identical wallet request

When the owner explicitly requests another attempt and no transaction hash is
recorded, restart the same step with the same plan, journal and fee ceilings,
adding both of these arguments:

```sh
--retry-attempt 1 \
--reviewed-request-digest "$MODULE_ORIGINAL_REQUEST_DIGEST"
```

Read the original request digest from the protected journal and review its
payload. The operator independently recomputes that digest. It rechecks source
authority, both providers, target vacancy, latest and pending nonce, gas and
funding. Every wallet field must match the original request, including the nonce,
gas limit and both fee caps. An estimate may decrease; the reviewed gas limit
still stays unchanged. A changed or pending nonce blocks the retry. The request
gets a fresh five-minute review window, followed by another check before handoff.

The UI exposes **Prepare exact retry** only for that explicitly selected attempt.
Before returning its payload, the server exclusively appends
`<plan-digest>-<step>.retry-1.request.json`. It never replaces the original request,
transaction or receipt. Reopening an already handed-off attempt cannot send it
again. A further attempt requires another explicit owner request, reconciliation
and an unused attempt number. The original and retry use the same EOA nonce, so a
late original submission cannot become a second transaction at a new nonce.
Record the actual transaction hash against the original journal entry and verify
its receipt as usual. The owner still confirms in MetaMask.

### Continue after an operator-only source update

If the recovery tool itself needed a source fix, first merge and verify the new
production source normally. Generate a fresh clean-source plan from that reviewed
checkout using the **unchanged** release parameters. Run the new operator with
the original `--plan`, original `--reviewed-plan-digest` and original journal,
and add:

```sh
--continuation-plan "$MODULE_CURRENT_OPERATOR_PLAN" \
--reviewed-continuation-plan-digest "$MODULE_CURRENT_OPERATOR_PLAN_DIGEST"
```

Use the successful hosted Verify run and attempt for the **current operator
source**. The operator freshly rebuilds and seals that source, validates both plan
digests, and requires the original source to be a Git ancestor. Apart from source
and build provenance, the plans must be identical: all deployment calldata,
constructor values, runtime bytes, addresses, roles, official pins and economics.
Any contract or deployment change blocks continuation. The page identifies the
original contract source and current operator source separately.

This keeps the original contract plan and all actual receipts intact. Continue
subsequent steps with the same pair of plans, omitting retry arguments for steps
that were never handed off. Collect deployment and source-publication evidence
from a clean checkout of the **original contract source**, using the original
plan and journal. A continuation does not rewrite the immutable release identity
to claim that earlier transactions deployed a newer source revision.

## Collect deployment and published source

After all nine real receipts, collect deployment evidence and derive the release
identity's start block from the actual launcher receipt:

```sh
MODULE_MODE_FORGE=/absolute/path/to/pinned/forge \
  node contracts/scripts/module-mode/collect.mjs deployment \
  --plan "$MODULE_DEPLOY_PLAN" --journal "$MODULE_DEPLOY_JOURNAL" \
  --output "$MODULE_RELEASE_EVIDENCE_DIR"
```

The resulting `deployment.json` has schema
`programmable.module-mode-deployment-evidence.v1`, status
`included-code-verified`, and `finality:not-asserted`. Its nine records are
`included-code-verified-unfinalized`. `identity.json` uses the shared
`computeModuleModeReleaseDigest`; it does not introduce a second identity formula.

Generate source-publication request bodies bound to those actual deployment
transactions, including the correct internal deployer for each child:

```sh
MODULE_MODE_FORGE=/absolute/path/to/pinned/forge \
  node contracts/scripts/module-mode/collect.mjs source-requests \
  --plan "$MODULE_DEPLOY_PLAN" \
  --identity "$MODULE_RELEASE_EVIDENCE_DIR/identity.json" \
  --deployment "$MODULE_RELEASE_EVIDENCE_DIR/deployment.json" \
  --output "$MODULE_SOURCE_REQUEST_DIR"
```

The integration owner publishes the generated bodies using the explicit recorded
Sourcify V2 endpoints and verifies their outcome. Generation itself sends nothing.
The request files state the provider's source-publication licence. The source
readback supports the documented Sourcify V2 API and separately checks chain-4663
support before reading all 13 contract records:

```sh
MODULE_MODE_FORGE=/absolute/path/to/pinned/forge \
  node contracts/scripts/module-mode/collect.mjs source \
  --plan "$MODULE_DEPLOY_PLAN" \
  --identity "$MODULE_RELEASE_EVIDENCE_DIR/identity.json" \
  --deployment "$MODULE_RELEASE_EVIDENCE_DIR/deployment.json" \
  --provider sourcify-v2 --output "$MODULE_RELEASE_EVIDENCE_DIR"
```

These contracts omit CBOR metadata. Sourcify therefore reports `match`; the
evidence preserves `NO_CBOR_PROVIDER_MATCH` and never calls it `exact_match`.
Independently, the verifier compares the complete creation and runtime bytecode,
constructor arguments, compiled immutable ranges and values, source closure,
compiler settings, ABI, metadata and actual creation transaction. Only constructor
arguments and compiled immutables may explain byte transformations. Partial source
flags or metadata-ignore transforms cannot substitute for this comparison.

An explicit `--provider blockscout` path is also available. It requires full
verification, complete creation/runtime bytes and source closure from that API;
an HTTP success or `is_verified` flag alone is insufficient.

## Lifecycle and activation handoff

The deployment operator does not invent lifecycle evidence. The backend's native
canary/finality collector must authenticate real plain-token and module-token
launch, buy and sell transactions and prove the canonical Robinhood checkpoint's
Ethereum finality. In `services/custom-launch-api-v1`, after its locked dependency
install and `npm run build`, collect using the existing private two-L2/two-L1
provider configuration:

```sh
node ops/module-mode-lifecycle-v1.mjs collect \
  --identity-file "$MODULE_RELEASE_EVIDENCE_DIR/identity.json" \
  --deployment-file "$MODULE_RELEASE_EVIDENCE_DIR/deployment.json" \
  --source-file "$MODULE_RELEASE_EVIDENCE_DIR/source-verification.json" \
  --plan-file "$MODULE_ACTUAL_CANARY_PLAN" \
  --output-file "$MODULE_RELEASE_EVIDENCE_DIR/lifecycle.json"
```

The canary plan names the actual plain-token and module-token launch/buy/sell
transaction hashes. The collector has no RPC-URL flags or signing path. Its
separate `validate` command accepts the same identity/deployment/source files plus
`--lifecycle-file`; offline validation does not become fresh provider observation.

Install the three verified files under
`services/custom-launch-api-v1/release/module-mode-native-v1/`:

- `deployment.json`
- `source-verification.json`
- `lifecycle.json`

Every file contains `chainId:4663` and the same immutable `releaseDigest`.
`deploymentEvidenceDigest`, `sourceVerificationDigest` and
`lifecycleEvidenceDigest` are **keccak256 of the exact UTF-8 file bytes**, including
the final newline. There is no second canonicalization. The immutable release
digest excludes those evidence digests to avoid a circular hash. The guarded
backend installation and website availability/catalog proof remain separate
release steps; these tools never write `active:true`.

## Checks

```sh
node --test contracts/scripts/module-mode/operator.test.mjs \
  contracts/scripts/module-mode/source-readback.test.mjs

cd contracts
/absolute/path/to/pinned/forge fmt --check \
  script/module-mode/SimulateModuleNativeDeploymentV1.s.sol
```

The operator tests cover payload and immutable binding, fee ceilings, provider
disagreement, changed wallet fields, canonical receipt/child-code verification,
pending and reverted transactions, exclusive journal recovery, strict JSON and
same-origin protection, disabled UI-check writes, exact evidence-file hashes and
complete source readback. The actual local fork and browser checks are additional
evidence. None of these checks alone proves a public deployment or live launch.
