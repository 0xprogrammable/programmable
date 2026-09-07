# Engine source contributor starter

`QuoteBoundSettlementV1` is a complete Solidity source contribution for the existing Module Engine Host ABI. A payer funds a request in the launch's quote asset. The launch creator can attest fulfillment and pay its fixed beneficiary before expiry. At expiry the original payer can refund an unresolved request. The contributor source author and reward wallet are separate from the launch creator, payer and beneficiary.

The new entrypoint in `src/QuoteBoundSettlementV1.sol` binds the encoded quote address to `Context.quoteAsset` and enforces a 60-second minimum and 30-day maximum request window in its constructor. It inherits the unchanged canonical settlement implementation, including real per-request state, exact transfers and terminal statuses. Creator attestation is an explicit trust assumption; an evidence hash is not an oracle or proof that an external service was delivered. The primary coin remains locked in this nontrade engine. This example performs no swaps and charges no invented trade fees.

This is source for an unreviewed contribution. Compilation, source intake, protected worker execution, reviewer acceptance, registry admission, deployed code verification and public availability are separate steps. No author wallet, reward wallet, reviewed revision, deployment or API approval is assigned by this download.

## Copy, compile and prepare

Copy this directory, or extract its versioned source download, into your own directory. It contains every Solidity dependency with its original MIT license; no package installation script or remote Solidity import is needed. `SOURCE-PINS.json` records each unchanged upstream file's exact revision and SHA-256. The included host specification explains the complete ABI. A Git commit pin identifies source bytes; it does not itself prove that the commit is publicly reachable.

Use Node 24.14 or newer in the Node 24 line and Foundry with Solc 0.8.26 available. The compiler profile is Cancun, optimizer 1000, via-IR, metadata bytecode hash `none`, with the compiler CBOR trailer retained. This matches the engine worker's settings. The local starter tests use a test contract as host and standard test tokens; they are not execution of the protected Docker worker or a deployed production host.

```bash
cd /absolute/path/to/my-engine
forge test --offline -vv
node tools/check-build.mjs
```

`--offline` requires Solc 0.8.26 to have been installed already. A copied directory needs neither a Git checkout nor `node_modules` for these commands. The six Solidity tests cover two quote addresses, constructor overrides, host-only calls, beneficiary/amount/creator checks, refund at the exact expiry, isolated liabilities and transfer rollback. `check-build.mjs` compares the actual compiler input source hashes and bytecode against `build-reference.json`, using Foundry's `cast` for Keccak.

After editing the contribution, inspect its code and tests, update its name/version in `module.template.json`, regenerate the local reference with `node tools/check-build.mjs --write-build-reference`, then regenerate the descriptor. New or removed source files must be reflected in `package-files.json`. Preserve the licenses and provenance of unchanged dependencies; do not keep an upstream pin for edited bytes.

Set these local variables yourself. `AUTHOR_WALLET` must be the wallet authenticated by your Module contributions API key. `AUTHOR_REWARD_WALLET` is your intended author reward recipient; it is not a settlement beneficiary or proof of reward eligibility. `FAMILY_SALT` is a fresh nonzero lowercase bytes32 for a new family. Preserve that salt when producing another revision of the same family.

```bash
node tools/prepare.mjs \
  --author "$AUTHOR_WALLET" \
  --reward-wallet "$AUTHOR_REWARD_WALLET" \
  --family-salt "$FAMILY_SALT"
```

Missing, zero or known fixture identities are rejected. `--fixture` is available only for explicit local tests and is visibly marked `fixtureOnly:true`; it claims no ownership and must not be submitted as your contribution. The preparer is the unchanged Native starter preparer. It hashes 1–128 explicit ordinary files, refuses traversal and symlinks, and enforces 4 MiB per file / 16 MiB total. `module.json` and generated requests are excluded from their own source inventory.

## Existing source API and CLI

Use the verified standalone CLI `1.0.0-development.4`. Its immutable distribution path is `/developers/module-mode-cli/v1.0.0-development.4/` on the product origin. Verify the downloaded executable against its `manifest.json` and `SHA256SUMS`; use the existing checkout's `packages/classic-modules/bin/programmable-classic-modules.mjs` when working locally with SDK dependencies. Public distribution availability must be checked independently of these source instructions.

`MODULE_CLI` is the absolute path of that verified executable, and `MODULE_API_ORIGIN` is the API deployment you selected. Check live intake and review capabilities separately:

```bash
node "$MODULE_CLI" module-capabilities --api-origin "$MODULE_API_ORIGIN"
node "$MODULE_CLI" review-capabilities --api-origin "$MODULE_API_ORIGIN"

node "$MODULE_CLI" prepare-module-submission \
  --root /absolute/path/to/my-engine --package module.json --out submission.json
```

Preparation is offline and validates the exact existing `programmable.modules.submission.v0.1` transport. The component uses `runtime:"programmable.module-engine-solidity@1"`, `sourcePath:"src/QuoteBoundSettlementV1.sol"` and `entrypoint:"QuoteBoundSettlementV1"`. The descriptor is the existing `programmable.classic.source-package.v0.1`, with source hashes, explicit author/reward wallets, schema and management reads. No separate engine intake or package format is introduced.

When the chosen deployment accepts source contributions, authenticate through `PROGRAMMABLE_MODULES_API_KEY` with `modules:submit` and `modules:read`. Supply secrets through the protected environment, outside source files and command arguments. Submit the prepared bytes with the existing command:

```bash
node "$MODULE_CLI" submit-module \
  --root /absolute/path/to/my-engine --request submission.json \
  --api-origin "$MODULE_API_ORIGIN" \
  --idempotency-key my-engine-0.1.0-intake-001

node "$MODULE_CLI" status-module --api-origin "$MODULE_API_ORIGIN" --id "$SUBMISSION_ID"
node "$MODULE_CLI" review-status-module --api-origin "$MODULE_API_ORIGIN" --id "$SUBMISSION_ID"
```

The commands use `POST /v1/modules/submissions` and the existing owner-only status endpoints. Keep the returned submission ID, package ID, family ID and request digest. An intake receipt means an immutable unreviewed draft was stored. The operator must assign an executable build plan before the protected worker can run; the contributor cannot self-approve one. Follow `review.nextAction`. A later source edit needs a new version/request and the existing `--supersedes` flow.

## Configuration and the actual host ABI

The configuration bytes are exactly **96-byte `abi.encode(address quoteAsset,uint256 minimumWindow,uint256 maximumWindow)`**, in the order in `configuration-abi.json`. OpenConfig's generic record encoding sorts keys; it is not this constructor adapter. `tools/config-codec.mjs` uses the shared SDK's `compileOpenConfig` before applying this explicit three-field order. The backend uses the same `configurationAbi` fields in its existing `programmable.engine-abi@1` profile. Fixed values are schema data, not a second policy language.

The host constructs `constructor(Context context, bytes configuration)` itself. Context is `(host,launchId,token,creator,quoteAsset,feeCollector)`, with the host as `feeCollector`. The engine exposes `contextHash()`, `initialize(bytes)` and payable `execute(Operation)` through the unchanged interface. `initialize` accepts zero bytes for this example. All writes go through the admitted host's `execute(launchId,operation)`, after checking the actual host and engine binding. The descriptor's `management.actions` is empty because generic UI execution support must not be inferred from uploaded instructions.

`Operation` is `(operationId,actor,recipient,inputAsset,inputAmount,outputAsset,minimumOutput,deadline,nonce,data)`. The real host authenticates the actor, consumes the per-launch actor nonce, transfers exact input, checks the output floor and enforces operation permissions. Amounts are raw ERC20 units. Use the stored request, engine getters and fresh host nonce for every action:

| Operation ID | Funds and authority | Exact `data` |
| --- | --- | --- |
| `keccak256("settlement.request.v1")` | Payer; positive quote input; no output | `abi.encode(address beneficiary,uint256 refundAfter,bytes32 obligationHash)` |
| `keccak256("settlement.fulfill.v1")` | Launch creator before expiry; no input; quote output to the stored beneficiary, minimum exactly the stored amount | `abi.encode(bytes32 requestId,bytes32 evidenceHash)` |
| `keccak256("settlement.refund.v1")` | Original payer at/after expiry; no input; quote output to that payer, minimum exactly the stored amount | `abi.encode(bytes32 requestId)` |

`requestIdFor(payer,requestOperationNonce)` binds chain, host, launch, engine, payer and the nonce of the original request. Never infer it from a label or another launch. `requests(id)` returns payer, beneficiary, amount, refundAfter, obligationHash and status: 0 missing, 1 pending, 2 fulfilled, 3 refunded. Fulfillment and refund are terminal. The creator cannot redirect the payment, alter the amount or extend the deadline. A real transaction still requires the relevant connected wallet and the deployed host's verified admission.

See [general and fixed quote templates](QUOTE-ENGINES.md) and [the exact operator review profile](REVIEW.md). Both are source guidance, not API or registry approval.

## Repository checks and a materialized operator plan

The following additional tools run from this starter inside the product checkout with its existing SDK dependencies. They import the existing SDK and Viem; the copied standalone workflow above does not depend on them.

```bash
node tools/prepare.mjs --fixture
node tools/check-sdk.mjs
node --test tools/package.test.mjs
```

`check-sdk.mjs` produces ignored local fixture requests and a concrete operator-proposed plan, and binds every constructor and request ID to the actual source/compiler bytes. It reports local evidence only. After a real API intake, an operator can materialize the same plan using the actual immutable request and returned ID:

```bash
node tools/materialize-plan.mjs \
  --request /absolute/path/to/submission.json \
  --submission-id "$SUBMISSION_ID" \
  --out /absolute/path/to/review-plan.json
```

This writes the existing `programmable.modules.engine-build-plan.v1` JSON; it makes no network request and never assigns a review job. The service must validate it against the stored source, select its protected compiler/profile, run the actual vectors and obtain an independent reviewer decision. After changing source logic, update the explicit vectors and assertions with the operator rather than treating this example plan as a general engine tester.
