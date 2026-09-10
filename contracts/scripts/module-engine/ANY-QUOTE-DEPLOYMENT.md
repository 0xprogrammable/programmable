# Any Quote manual deployment and publication

This extends the existing Module Mode owner operator. It prepares exact transactions and collects receipts; it never signs or broadcasts them. Infrastructure deployment, independent review, Registry admission, finality, catalog activation and the ordinary public user lifecycle remain separate requirements.

Use the reviewed, clean `production` source for real wallet handoffs. The existing `authority.mjs` requires its exact commit/tree and the hosted Verify run/attempt. Keep the original private append-only wallet journal outside the repository. The same two reviewed independent Robinhood RPC providers, EIP-1559 fee ceilings, fresh simulations, and explicit same-nonce recovery remain in force.

## Exact source and transaction order

The source profile is `module-engine-any-quote-v1`, engine profile `robinhood-any-quote.shared-hook.v1`, and Host source ID `keccak256("programmable.module-engine.any-quote.v1")`. The configuration schema is `programmable.any-quote.configuration.v1`; economics is `programmable.any-quote.base-30.creator-0-1000.v1`.

`any-quote-build.mjs` uses the existing source/dependency sealer: Solc 0.8.26, optimizer 1,000, Cancun, `viaIR=false`, no CBOR metadata. Do not alter these settings or increase EVM size limits. The seven static Host constructor arguments add 224 bytes to the exact creation artifact. Read the complete initcode size from the sealed final plan; this source has very little EIP-3860 margin. Any source change requires a fresh size and runtime binding.

| Step | Transaction | Bound result |
| --- | --- | --- |
| 0 | Owner nonce N calls the retained CREATE2 deployer with the stateless guard initcode | `AnyQuoteNativeRouteGuardV1`; no constructor arguments |
| 1 | Owner nonce N+1 creates the Host directly, with no `to` address | Host creates the mined CREATE2 shared hook; that hook creates its Ledger at child nonce 1 |

The Host address must be predicted from the owner's actual next nonce before mining the shared-hook salt. The Host constructor is `(tokenFactory, launchPolicy, registry, poolManager, rewardAdmin, hookSalt, nativeRouteGuard)`. The hook constructor is `(poolManager, host, rewardAdmin)` and the Ledger uses the same three arguments. The guard runtime hash must match the literal Host pin `0x704f8f3c1903e1f15dd041b2dd29673a8c98bee9c87f645da90978c2315cf4ee` under the exact compiler settings.

Both steps have zero transaction value; gas is separate. Do not use the deployment wallet for another transaction between the two steps. If its nonce changes, stop and reconcile the existing journal and chain state before preparing another plan. An already deployed address requires its original receipt. Do not retry a deployment just because its outcome is unknown.

The identity contains nine pins: Host, Registry, token factory, launch policy, Ledger, PoolManager, shared hook, Universal Router and native route guard. The LP engine is deployed per coin through the accepted revision; there is no global LP-engine deployment or per-coin hook mining.

## Prepare the unsigned package

Read the live owner nonce from both providers, with no pending transaction. Create a private parameters JSON file with exactly `owner`, `ownerNonce` (decimal string), `reviewAuthority` and `releaseLabel` (including `any-quote`). Owner and review authority must match the retained basis. No default nonce or alternate executor is supplied.

```sh
node contracts/scripts/module-engine/any-quote-prepare.mjs \
  --parameters /absolute/private/parameters.json \
  --output /absolute/private/any-quote-deployment
```

`--candidate` is available for local inspection and explicitly removes wallet authority. Files are written once with owner-only permissions. The package contains exact constructor arguments, mined salt, predicted addresses, materialized runtimes, the nine-pin identity candidate, source verification requests, and infrastructure review bindings. The LP engine must use the actual independently reviewed artifact from the existing engine compiler profile (which remains separate from the foundation compiler); do not substitute the foundation's `viaIR=false` bytecode for that reviewed artifact. The package contains no final deployment block, release digest, accepted review, or invented receipt.

Use the existing operator for each step, starting with `--step 0`, then `--step 1` after the first receipt is verified:

```sh
node contracts/scripts/module-mode/operator.mjs \
  --plan /absolute/private/any-quote-deployment/plan.json \
  --step 0 --journal /absolute/private/owner-journal \
  --reviewed-plan-digest REVIEWED_PLAN_DIGEST \
  --verify-run-id VERIFY_RUN_ID --verify-run-attempt VERIFY_RUN_ATTEMPT \
  --max-gas REVIEWED_GAS --max-fee-per-gas-wei REVIEWED_MAX_FEE \
  --priority-fee-per-gas-wei REVIEWED_PRIORITY_FEE
```

All uppercase values must be replaced by actual bound evidence or reviewed gas ceilings. The user connects the expected wallet and confirms the prepared request in MetaMask. The server writes the request to its existing journal before returning it to the wallet. `--ui-check` renders details with wallet/RPC access disabled. The Any Quote display shows the full fixed 30 bps quote-asset recipient and separate creator fees; legacy module displays retain their existing economics.

## Collect and verify the actual infrastructure

`any-quote-collect.mjs observe --plan FILE --step 0|1` is read-only. `record` requires the existing armed journal and an actual transaction hash. After both receipts:

```sh
node contracts/scripts/module-engine/any-quote-collect.mjs deployment \
  --plan /absolute/private/any-quote-deployment/plan.json \
  --journal /absolute/private/owner-journal --output /absolute/private/any-quote-evidence
```

The collection binds the Host CREATE address and nonce, the guard CREATE2 preimage, every runtime, Host/hook/Ledger relationships, Registry owner, the economic/profile getters, and both canonical receipt blocks. Its start block is the actual Host receipt block. The result is `included-code-verified`, with finality explicitly unasserted.

Prepare creation-bound source requests with `any-quote-collect.mjs source-requests --plan FILE --identity FILE --deployment FILE --output DIRECTORY`. Submit those exact requests through the existing source-publication workflow. Collect source readback with `source` and the same parameters plus `--previous-source FILE`, containing the exact historical V1 source-evidence bytes. Four new contracts are checked against their complete source, compiler metadata, constructor and runtime; three retained contracts keep their original source creation provenance. The existing source comparator's `recompiledRuntimeCodeHash` is the pre-immutable template hash, while `runtimeCodeHash` is the full deployed runtime hash.

## Review, admission and ordinary public use

The new platform submission uses `0xD88539d3c4C460136a733A3Fd60cf6BF269079da` as its author, reward wallet and recipient of the entire fixed 30 bps quote-asset fee. With the retained family salt `0x26106d3b3ae444a8974ec9900aa35321d616d0dd8bd4850fc3855ae6cc539069`, its new family is `0x91ec5e77c54fc78d8cd1240c9caf3252a8ee656b9ad9e6b3f454399985d0760b`. Use the existing regular submission path without a `supersedesSubmissionId` field; the authenticated module context must identify this exact author before submission. Review, registration plans and the eventual catalog must bind the same author and reward wallet. The accepted manifest also binds the final infrastructure, LP engine artifact, dynamic configuration schema and immutable creator fees.

The historical submission `87ff3c7c-1e6a-4196-9ac4-279daa63c72a`, author/reward wallet `0x2bb333d48dfaf1596d9036671d2e43168994249e` and family `0x6e348066f0f7596b0efa2013f5b96b0846390a32cf8b86706b2b06c8eaf935cc` remain unchanged as provenance. They are not the new publication's author binding or superseded revision. This author change grants no Registry ownership or review authority and does not alter other creators' fee allocations.

Use existing `publication-plan.mjs bundle` with `--identity`, `--definition`, `--submission`, `--session-file`, and `--output` to read the genuine current independent acceptance. Then use `prepare` with `--identity`, `--bundle`, `--owner`, `--family-state absent|existing`, and `--output`. The existing `publication-operator.mjs` rechecks authenticated review and onchain state before each user signature. Family registration, when required, precedes Host `approveRevision`. No Registry ownership transfer or delegation is involved.

The integration owner installs the verified source identity, accepted revision, deployment/source/lifecycle evidence and finality through the existing release/catalog/indexer controls. The public website is released only from the exact reviewed `production` source. Public website/API wrappers retain their active-release requirement. Before activation, the existing publication operator supports the bounded canary sequence below using the same canonical source-level preparation and receipt helpers.

## Pre-activation canary in the existing operator

Use `contracts/scripts/module-engine/lifecycle-operator-plan.mjs` with the actual identity, authenticated accepted bundle, actor, action, and `--preactivation FILE`. The packet has schema `programmable.module-engine-any-quote-preactivation-packet.v1` and exactly these fields:

- `deploymentPlan` and `build`: the original clean-source deployment plan and sealed build, including complete standard inputs.
- `deploymentEntries`: the two original armed journal entries, each with its actual transaction hash.
- `deploymentEvidenceRaw`, `sourceVerificationEvidenceRaw`, `previousSourceVerificationEvidenceRaw`: the exact UTF-8 contents of the corresponding evidence files, retaining original whitespace and final newlines.
- `admission`: `{plan, entry, evidence}` from the existing publication operator's actual `engine-revision` receipt.

The packet is immutable input, not an activation record. An identity alone, candidate build, absent admission or a persisted “verified” flag cannot authorize preparation. On startup, the server rechecks compiled source bytes against their Git objects and pinned compiler settings, both deployment receipts, complete source readback, and actual admission. Only that process keeps an in-memory cache. Restarting or changing the packet repeats the validation. Every prepare and arm also rechecks authenticated current acceptance, the exact production source and hosted Verify run, all nine runtime/source pins, revision/family state, canonical deployment/admission anchors, owner nonce agreement and simulation.

The existing authorized operator runtime must provide its two reviewed production RPC URL aliases and reviewed endpoint commitments through its established private environment. The scripts neither retrieve nor export secret values. A CI preparation artifact does not replace those per-request reads. Use the existing private reviewer session file; the independently accepted reviewer and transaction actor remain separate identities.

```sh
node contracts/scripts/module-engine/lifecycle-operator-plan.mjs \
  --identity /absolute/private/identity.json --bundle /absolute/private/accepted-bundle.json \
  --owner ACTUAL_ACTOR --action /absolute/private/action.json \
  --preactivation /absolute/private/preactivation.json --output /absolute/private/lifecycle-plan.json

node contracts/scripts/module-mode/publication-operator.mjs \
  --plan /absolute/private/lifecycle-plan.json --step 0 \
  --journal /absolute/private/lifecycle-journal --session-file /absolute/private/reviewer-session.json \
  --reviewed-plan-digest REVIEWED_PLAN_DIGEST --verify-run-id VERIFY_RUN_ID --verify-run-attempt VERIFY_RUN_ATTEMPT \
  --max-gas REVIEWED_GAS --max-fee-per-gas-wei REVIEWED_MAX_FEE \
  --priority-fee-per-gas-wei REVIEWED_PRIORITY_FEE --max-value-wei REVIEWED_ETH_CEILING
```

Actions are closed and bind exact input amounts rather than unlimited approvals:

| Action | Required action fields | Wallet result |
| --- | --- | --- |
| Bootstrap launch | `{kind:"launch",input}`; input is the full canonical launch intent plus description, imageUri and socialLinks, with `initialBuyWei:"0"` | Host launch using fresh price/readiness and mandatory actual-settlement simulation |
| ETH buy | `{kind:"buy",token,recipient,inputAmount,slippageBps}` | Exact ETH input through the pinned Universal Router |
| ETH sell | Buy fields with `kind:"sell"`, plus `funding` | Required finite approvals first, then a separately prepared fresh ETH sell |
| Quote claim | `{kind:"claim",token,recipient}` | The signing beneficiary claims its positive accrued quote-asset balance |

Sell `funding` contains decimal strings `erc20Allowance`, `permit2Amount`, `permit2Expiration`, `permit2Nonce`, and `permit2Mode:"existing"|"approve"`. These are observed allowances for actor→Permit2 and Permit2→Universal Router. Insufficient ERC20 allowance adds one exact finite token approval. Explicit Permit2 approval adds only the exact sell amount, with a canonical expiry no more than 300 seconds from its checkpoint. Existing allowances must actually cover the next route. Each predecessor needs its canonical receipt in the same journal before the next step. Approvals do not carry an executable sell forward: the sell receives a fresh quote after the actual approvals.

The reviewed plan binds source/review/proofs, actor, recipient, launch metadata and creator configuration, exact action/input, and slippage. Prepare materializes a fresh canonical route/checkpoint/transaction. Its entire serialized envelope is covered by the request digest and durable journal. Any Quote requests expire no later than the canonical quote/preview deadline and 45 seconds after preparation. Arm reconstructs the original block's preparation and resimulates those same bytes; it never obtains another quote or extends the expiry. An expired unarmed request requires new preparation and owner review. An armed request keeps the existing unknown-outcome reconciliation rules, including after expiry; it cannot be silently replaced or resent. Legacy request/deadline windows are unchanged.

Settlement probes use the existing read-only `debug_traceCall` transport with a canonical block-hash reference, `callTracer`, a ten-second timeout and no state/block overrides or custom tracer code. Unsupported providers fail closed. Signing remains exclusively in the user's wallet.

After actual inclusion, source-level receipt helpers verify launch accounting, `QuotePoolSwap`, exact allowance changes, or `QuoteFeesClaimed` and quote settlement as applicable. The existing lifecycle-reference writer accepts `quote-pool-swap` references with `transactionHash`, `logIndex`, `poolId`, `buy`; and `quote-claim` references with `transactionHash`, `logIndex`, `asset`, `beneficiary`, `recipient`. The log index identifies the real shared-hook or Ledger event. The backend separately fetches and verifies those records and finality.

Run the existing `module-mode/verify-launch-source.mjs` for source readback of actual indexed launches. Its Any Quote branch verifies the immutable LP engine and shared-hook pool resource commitment directly; no NFT forwarder or per-engine hook is assumed. Complete the public canary with the Robinhood Programmable quote asset `0xC60bA256B44334A0Cd2C7242E98B88f031abB006`, a second representative creator/quote pair, public indexing/rewards and independent external-service evidence. A deployment package, simulation, approved revision or catalog entry alone is not that result.
