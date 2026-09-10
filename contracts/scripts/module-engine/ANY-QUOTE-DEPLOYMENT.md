# Any Quote manual deployment and publication

This extends the existing Module Mode owner operator. It prepares exact transactions and collects receipts; it never signs or broadcasts them. Infrastructure deployment, independent review, Registry admission, finality, catalog activation and the ordinary public user lifecycle remain separate requirements.

Use the reviewed, clean `production` source for real wallet handoffs. The existing `authority.mjs` requires its exact commit/tree and the hosted Verify run/attempt. Keep the original private append-only wallet journal outside the repository. The same two reviewed independent Robinhood RPC providers, EIP-1559 fee ceilings, fresh simulations, and explicit same-nonce recovery remain in force.

## Exact source and transaction order

The source profile is `module-engine-any-quote-v1`, engine profile `robinhood-any-quote.shared-hook.v1`, and Host source ID `keccak256("programmable.module-engine.any-quote.v1")`. The configuration schema is `programmable.any-quote.configuration.v1`; economics is `programmable.any-quote.base-30.creator-0-1000.v1`.

`any-quote-build.mjs` uses the existing source/dependency sealer: Solc 0.8.26, optimizer 1,000, Cancun, `viaIR=false`, no CBOR metadata. Do not alter these settings or increase EVM size limits. The final core Host creation code is 48,913 bytes and its seven static constructor arguments add 224 bytes: 49,137 total, only 15 bytes below EIP-3860. Any source change requires a fresh size and runtime binding.

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

`--candidate` is available for local inspection and explicitly removes wallet authority. Files are written once with owner-only permissions. The package contains exact constructor arguments, mined salt, predicted addresses, materialized runtimes, the nine-pin identity candidate, source verification requests, and LP engine review bindings. It contains no final deployment block, release digest, accepted review, or invented receipt.

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

The corrected submission revision must preserve author `0x2bb333d48dfaf1596d9036671d2e43168994249e` and family `0x6e348066f0f7596b0efa2013f5b96b0846390a32cf8b86706b2b06c8eaf935cc`, tracing the original submission `87ff3c7c-1e6a-4196-9ac4-279daa63c72a`. Its accepted manifest must bind the final infrastructure, LP engine artifact, dynamic configuration schema, immutable creator fees, and whole 30 bps quote-asset entitlement to `0xD88539d3c4C460136a733A3Fd60cf6BF269079da`. Preserve the original family reward-wallet provenance; that field does not split this profile's base fee.

Use existing `publication-plan.mjs bundle` with `--identity`, `--definition`, `--submission`, `--session-file`, and `--output` to read the genuine current independent acceptance. Then use `prepare` with `--identity`, `--bundle`, `--owner`, `--family-state absent|existing`, and `--output`. The existing `publication-operator.mjs` rechecks authenticated review and onchain state before each user signature. Family registration, when required, precedes Host `approveRevision`. No Registry ownership transfer or delegation is involved.

The integration owner installs the verified source identity, accepted revision, deployment/source/lifecycle evidence and finality through the existing release/catalog/indexer controls. The public website is released only from the exact reviewed `production` source. Launch, ETH buy, ETH sell and quote reward claims use the ordinary website/API wallet path, rather than adding a second Any Quote lifecycle operator.

Run the existing `module-mode/verify-launch-source.mjs` for source readback of actual indexed launches. Its Any Quote branch verifies the immutable LP engine and shared-hook pool resource commitment directly; no NFT forwarder or per-engine hook is assumed. Complete the public canary with the Robinhood Programmable quote asset `0xC60bA256B44334A0Cd2C7242E98B88f031abB006`, a second representative creator/quote pair, public indexing/rewards and independent external-service evidence. A deployment package, simulation, approved revision or catalog entry alone is not that result.
