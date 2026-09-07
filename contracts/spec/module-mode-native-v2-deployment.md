# Native V2 deployment and evidence preparation

The native V2 generation adds the reviewed 10 bps protocol / 20 bps eligible-author policy. Native V1 remains an immutable historical release. The preparation tools select V2 artifacts through the existing source/dependency/compiler sealer and reuse appropriate deployed V1 dependencies. They do not sign, broadcast, publish source, create finality evidence, or activate a release.

## Build and historical basis

`contracts/scripts/module-mode/build.mjs` retains the V1 source list and artifact mapping as defaults. Its only extension is an explicit optional source/artifact selection. `module-native-v2/build.mjs` selects V2 Registry, Hook, Launcher, Router, RouterFactory and FeeLedger while retaining the existing RuntimeV1, token factory, position tooling and starter modules.

The existing mandatory settings are unchanged: Forge 1.7.1 (`4072e48705af9d93e3c0f6e29e93b5e9a40caed8`), solc `0.8.26+commit.8a97fa7a`, Cancun, optimizer 1000, no via-IR, no CBOR or metadata hash, exact Git source objects and clean pinned dependency checkouts. The output contains the original build commitment, full compiler metadata, source closures, standard JSON inputs and ABIs. A candidate build remains unusable as deployment authority.

`basis.mjs` reads the checked-in active V1 source and deployment parameters, checks their Git bytes and the actual V1 release digest, and records hashes of those files and the existing V1 economics definitions. The inherited addresses are:

- Deployment/review owner: `0x79879fe6f00c0986ca521ea6f5b276b5e28b1b9c`.
- Protocol recipient: `0xd88539d3c4c460136a733a3fd60cf6bf269079da`.
- Existing reward administrator: `0x79879fe6f00c0986ca521ea6f5b276b5e28b1b9c`.
- Existing minimum initial buy: `400000000000000` native wei.

These values have historical configuration provenance. The basis explicitly says `historical-config-only-quorum-refresh-required`, with `chainObservation: null`; it is not a current owner/treasury RPC assertion. `collect.mjs observe` uses the existing reviewed independent provider resolver and additionally checks the actual old registry owner, old ledger recipients and all reused code at the observer's common block. It refuses a disagreement or reorganization. Missing reviewed RPC/custody input cannot be replaced by two aliases for one provider or invented observations.

## Necessary deployment sequence

Four zero-value deterministic-proxy calls create the new generation:

| Stage | Direct creation | Children in the same successful transaction |
| --- | --- | --- |
| 0 | ModuleNativeRegistryV2 | none |
| 1 | ModuleNativeSwapRouterFactoryV2 | none |
| 2 | ModuleNativeHookV2 | ClassicModuleFeeLedgerV2 |
| 3 | ModuleNativeLaunchV2 | RuntimeV1 through the existing RuntimeFactoryV1; BudgetVaultV1 from RuntimeV1; SwapRouterV2 from RouterFactoryV2 |

The existing tokenFactory, positionPlanner, launchPolicy, positionForwarderFactory and runtimeFactory addresses are reused. Their complete materialized runtime bytecode must match the active V1 pins. Every reused first-party source file must also match the original V1 source commit, and dependency source pins must match. `reuseSourceDigest` binds this additional proof. RegistryV1, HookV1, LedgerV1, LauncherV1 and RouterV1 are never repurposed for V2.

The direct CREATE2 domain is `programmable.module-mode.deployment.v2`, with chain, explicit V2 release label and role. Hook candidates additionally hash the base salt with an index, and must match the existing hook permission mask/flags. RuntimeV1 keeps the existing `native-runtime.v1` domain; RouterV2 uses `native-router.v2`.

The pinned native V2 Hook creation code is 48,947 bytes. Its five ABI constructor arguments add 160 bytes: **49,107 bytes total, 45 bytes below EIP-3860's 49,152-byte limit**. The planner measures the full constructor payload and rejects overflow; it also checks every runtime against EIP-170. Changing source, compiler, settings or constructor types requires a fresh seal and salt search. Salt mining cannot repair oversized initcode. The four direct initcode lengths with the reviewed build are Registry 4,054; RouterFactory 9,647; Hook 49,107; Launcher 46,057.

## Local preparation

From the clean reviewed checkout, with the existing pinned toolchain and dependencies available:

```sh
MODULE_MODE_FORGE=/absolute/path/to/pinned/forge-1.7.1 node contracts/scripts/module-native-v2/prepare.mjs --output /absolute/owner-controlled/native-v2-draft
```

The directory receives `plan.json`, `build.json`, `basis.json`, `abi.json`, `release-draft.json`, eight new-contract source inputs, unsigned Blockscout/Sourcify request descriptions, and the existing simulation binary format. Outputs are exclusive writes. The release draft has `enabled: false` and `status: planned-not-deployed`. Its identity candidate has no fabricated start block or release/evidence digest. The deployment plan includes complete calldata, constructor arguments, target salts, initcode hashes and materialized runtime pins.

The existing `contracts/script/module-mode/SimulateModuleNativeDeploymentV1.s.sol` is input-driven and can execute the four V2 calls on a local fork without modification. It validates the official and all planned runtime hashes. Supply its `MODULE_MODE_SIMULATION_RPC_URL`, `MODULE_MODE_SIMULATION_BLOCK` and `MODULE_MODE_SIMULATION_INPUT` only after the appropriate read-only quorum observation. Run it locally without `--broadcast`. This preparation does not run or claim a fork simulation when those inputs are unavailable.

No new wallet/operator permission path is introduced. The existing protected journal and exact EIP-1559 request/receipt checks are reused by collection. Preparing or observing a plan is not permission to arm an owner wallet; the release owner integrates the final transaction review separately.

## Actual evidence collection

`module-native-v2/collect.mjs` supports `observe`, `record`, `deployment`, `source-requests` and `source`. It reseals and reproduces the exact plan and basis before using existing read-only RPC/journal helpers. `--source-root` can point to the original clean deployment checkout. `record` requires the actual transaction hash and its original protected armed request; it cannot create an armed request or fabricate a receipt.

V2 observation adds the exact policy getter on Hook, Ledger, Launcher and Router, sourceVersion on Launcher, registry owner, ledger recipients and runtime/router/ledger links. All additional reads share and recheck the original observer's block. Deployment evidence retains `programmable.module-mode-deployment-evidence.v1`, has four genuine creation records, and adds `sourceVersion`, `economicsPolicyId` and `nativeBindings` at the actual Launcher receipt block. `nativeBindings` contains the five reused and eight new runtime pins, inherited authority, policy getters, explicit reads and sanitized independent provider bindings. The actual Launcher receipt supplies startBlock; the shared V2 release identity implementation supplies releaseDigest. Inclusion remains separate from finality.

New source requests cover only the eight contracts actually created. LedgerV2 constructor arguments are precisely `(poolManager, registry, treasury, rewardAdmin)`; there is no fifth V1 fallback recipient. Runtime, vault, router and ledger creation hashes come from their actual parent deployment receipts, including the existing runtime factory address. Unsubmitted requests have no invented creation transaction.

Source collection uses the existing complete Sourcify source/constructor/runtime validator and optional pinned recompiler via GET requests. For the five retained contracts, `--previous-source` must provide the exact raw V1 source-verification evidence bytes matching the active V1 evidence digest. Those records retain their original creationTransactionHash and originalSourceCommit, and bind prior release/evidence digests plus `newCreationTransaction: false`. Together with the sealed byte-identical original source closure, these form 13 source records without five unnecessary redeployments. Neither preparation nor collection submits verification POST requests.

## Native V2 lifecycle boundary

`module-native-v2/lifecycle.mjs` prepares the existing backend collector input from **actual** native V2 operation references. It reuses the V1 collector-plan checks for release, plain/module order and launch/buy/sell references, adds buyExactOutput and sellExactOutput, and requires ten unique successful receipt references. It decodes the actual V2 launch expectedRecipeHash, the full `NativeEconomicsBound` policy/selection snapshot, and the four signed-amount swap quadrants against the compiled V2 ABIs. A V1 call, missing event, wrong policy, duplicate receipt or other engine source cannot become this plan.

The output schema is `programmable.module-mode-lifecycle-plan.v2`; each plain/module canary has token and five transaction hashes. It is a request to the authenticated backend `collectModuleModeLifecycleEvidenceV2` collector, which independently rereads transactions, code, immutable eligibility snapshots, fee accounting and L1/L2 finality. It is not `programmable.module-mode-lifecycle-evidence.v2` and cannot activate a release. Quote-engine/host lifecycle evidence remains separate. This package contains no generated canary or lifecycle evidence because no actual V2 transactions have occurred.

## Focused validation

The new operator tests cover four-step CREATE2 construction and inherited rights, size overflow, exact LedgerV2 ABI, reuse-source/runtime tampering, missing/forged source-creation evidence, independent RPC disagreement, changed policy/sourceVersion, reorganization, ten distinct V2 lifecycle references, missing eligibility events and wrong exact-input/output quadrant. Existing V1 operator tests remain part of the bounded regression command:

```sh
node --test contracts/scripts/module-native-v2/deployment.test.mjs contracts/scripts/module-mode/operator.test.mjs
```

Contract economics, all four real PoolManager swap quadrants, rounding/claims and historical V1 preservation are covered separately by the already-reviewed native V2 contract change; this tooling does not reinterpret those tests as deployment or finality proof.
