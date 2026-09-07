# Engine core deployment and evidence

Status: local preparation tooling. Independent money/static review, exact source sealing, real deployment,
source verification, provider-backed lifecycle, template availability and public activation are separate gates.
The integration owner waits for the EngineHost review fixes before preparing a final clean release package.

## Existing path and authority

The Engine core uses the existing deterministic deployer, source/dependency/compiler sealer, protected journal,
exact EIP-1559 receipt observer, independent-provider resolver, source readback validator and fork-simulation input.
There is no second wallet service, permission path, CI pipeline, account or default funding recipient.

`contracts/scripts/module-mode/build.mjs` retains its existing Native V1 defaults. The Engine wrapper selects only
HostV1, LedgerV2, the existing RegistryV1, TokenFactory, primary token and LaunchPolicy artifacts, with the same
pinned Forge 1.7.1, solc 0.8.26, Cancun, optimizer 1000, no via-IR/CBOR/metadata hash, and Git/dependency checks.
The optional `roles`/`domain` arguments to the existing `bindReusedSourceClosure` helper retain the exact Native V2
defaults and output digest. Engine reuse chooses its three actual retained contracts and the separate
`programmable.module-engine.reused-source.v1` domain.

The historical authority basis is reused as-is from `module-native-v2/basis.mjs`: it binds the actual active V1
release digest, checked-in V1 deployment parameters, economics definitions and their Git bytes. Its schema label
does not change that provenance into a V2 registry or a fresh onchain observation. It explicitly remains
`historical-config-only-quorum-refresh-required` with `chainObservation: null` until a real observation exists.

The retained native registry at `0x0082094ebeb3817cd78b2bc3725ca23b5720d884` supplies the existing `owner()` and
family-author authority used by HostV1. The owner in the existing release parameters is
`0x79879fe6f00c0986ca521ea6f5b276b5e28b1b9c`; the existing treasury is
`0xd88539d3c4c460136a733a3fd60cf6bf269079da`, and the reward administrator is the existing owner address.
Fresh two-provider observations must verify those actual registry/ledger getters; local configuration is not a
claim that mutable chain authority has stayed unchanged. No registry duplication or new review administrator is needed.

## One necessary core deployment

The sole direct CREATE2 transaction has value zero and constructs:

```text
ModuleEngineHostV1(
  existingTokenFactory,
  existingLaunchPolicy,
  existingRegistry,
  officialPoolManager,
  existingTreasury,
  existingRewardAdmin
)
```

The Host creates its own `ClassicModuleFeeLedgerV2` at CREATE nonce 1 in that same transaction. Ledger constructor
arguments remain `(poolManager, registry, treasury, rewardAdmin)`; its `hook()` getter is the new Host. The host
holds no new administrative treasury or creator-claim rights. The reviewed Engine profile uses the existing
10/0 or 10/20 platform policy, with additional creator fees.

The salt is `keccak256(abi.encode("programmable.module-engine.deployment.v1", chainId, releaseLabel, "host"))`.
The Host is not itself a V4 hook, so its deployment requires no hook-bit salt search. A separately admitted quote
engine can have its own per-launch hook salt and dependency bindings. The complete Host constructor initcode
must fit EIP-3860 and both new runtimes must fit EIP-170; each preparation calculates and enforces those limits.

The release has exactly the canonical six roles from `lib/module-engine/catalog.ts`:

| Role | Origin |
| --- | --- |
| host | one new deterministic-proxy deployment |
| ledger | new Host-created LedgerV2 child |
| registry | retained active Native V1 registry |
| tokenFactory | retained active token factory |
| launchPolicy | retained active launch policy |
| poolManager | existing official chain-4663 PoolManager |

Every retained compiled runtime must equal the active V1 pin. Its original first-party sources and dependency
pins must also be byte-identical to the old published source commit. The primary-token creation hash must match
that existing generation. The existing Native authentication path verifies Factory, exact CREATE2/predict getter,
token metadata, creator/graffiti and nonempty actual runtime. UERC20 has launch-dependent immutable fields; its
observed runtime hash belongs to the individual launch, not to a global release constant.

Core preparation has no WETH, V3 router/factory, converter, quote CA or liquidity assumptions. Such parameters
belong to a specific reviewed engine/template configuration. A Host deployment cannot prove a quote route,
market, oracle, escrow behavior or settlement behavior available.

## Canonical wire

The wrapper imports, bundles and locks the canonical TypeScript validators using the same esbuild/cache mechanism
as the native tooling. It does not duplicate the Engine identity digest formula. The exact release wire is:

- schema `programmable.module-engine.release.v1`;
- sourceVersion `module-engine-v1`, profile `programmable.module-engine-solidity@1`;
- onchain Host `SOURCE_VERSION()` equal to `keccak256("programmable.module-engine.evm.v1")`, namely
  `0xecf1e58249f04f198dab08b47edee44ea94d23d3af0001647498466fc780e9ef`;
- the six role pins, source commit, token creation hash, existing economics policy and finality policy;
- actual startBlock from the Host receipt, then `computeModuleEngineReleaseDigest` from the canonical catalog.

Plan schema/digest domain is `programmable.module-engine-deployment-plan.v1`. The inactive draft schema is
`programmable.module-engine-release-draft.v1`, with `enabled: false` and `status: planned-not-deployed`. Its
identity candidate has no invented startBlock, releaseDigest or evidence digest.

## Preparation and read-only collection

After the independent fixes are integrated, run from the clean reviewed checkout:

```sh
MODULE_MODE_FORGE=/absolute/path/to/pinned/forge-1.7.1 node contracts/scripts/module-engine/prepare.mjs --output /absolute/owner-controlled/engine-draft
```

The exclusive-write output contains full build and source commitments, the one complete decoded/calldata plan,
counterfactual Host/Ledger addresses, ABIs, historical basis, inactive draft, two full standard source inputs and
unsubmitted Sourcify/Blockscout requests. No receipt, provider observation, signer approval or live flag is generated.

The existing input-driven `contracts/script/module-mode/SimulateModuleNativeDeploymentV1.s.sol` accepts the emitted
`simulation-input.bin` without modification. It executes the single deployment on a local fork and checks all
expected runtime hashes. Supply its RPC, block and input parameters only from the appropriate bound observation;
do not use `--broadcast`. Its Native V1 filename does not alter the generic binary payload or prove a native lifecycle.

`module-engine/collect.mjs` supports `observe`, `record`, `deployment`, `source-requests` and `source`. It reseals,
reproduces the plan and rechecks its exact historical basis before reading. The existing journal requires an
actual owner-reviewed armed request and exact transaction hash; this CLI cannot arm a wallet or submit a transaction.
`--source-root` reads the original clean deployment checkout when the collector has advanced.

The Engine observer adds immutable/source checks at the same common or receipt block: all three retained contracts,
official PoolManager, old recipient ledger, current registry owner, Host source ID and TokenFactory/LaunchPolicy/
Registry/Ledger links, plus Ledger policy, 10/20 constants, PoolManager, Registry, Host and recipients. It closes
the snapshot by rechecking the block. Two aliases for the same provider are not an independent quorum.

## Evidence collected after actual transactions

Deployment schema is `programmable.module-engine-deployment-evidence.v1`, with the exact common receipt record
for `role: host` and `contracts: { host, ledger }`. It retains sourceCommit, planDigest, buildDigest, releaseDigest,
sourceVersion, sourceId, economicsPolicyId, inclusion status and `finality: not-asserted`. Its `engineBindings` at
the real Host receipt block contains:

```text
schemaVersion: programmable.module-engine-deployment-bindings.v1
chainId, blockNumber (decimal), blockHash, sourceId, economicsPolicyId,
previousReleaseDigest, reusedContracts { tokenFactory, launchPolicy, registry },
deployedContracts { host, ledger }, reads, treasury, rewardAdmin, registryOwner, providers
```

Source schema is `programmable.module-engine-source-verification-evidence.v1`. Its five records comprise two new
fully verified Sourcify source/constructor/runtime records and three actual retained V1 source records. The exact
raw prior file must match the active V1 sourceVerificationDigest. Retained creationTransactionHash values remain
unchanged and carry originalSourceCommit and prior release/evidence digests with `newCreationTransaction: false`.
The actual Host transaction proves the new Ledger's lineage; a Native Hook receipt cannot impersonate it.

Source collection uses the existing complete source/immutable comparison and optional pinned recompiler via GET
only. Preparation supplies unsigned POST descriptions but does not publish them. Inclusion, source verification
and actual finality remain separate from any public activation decision.

## Separate Engine lifecycle

`module-engine/lifecycle-plan.mjs` validates and writes only the authenticated Engine collector's input:

```text
schemaVersion: programmable.module-engine-lifecycle-plan.v1
release: canonical ModuleEngineReleaseIdentity
canaries: [
  { launchId, launchTransactionHash, manifestHash,
    operations: [{ transactionHash, operationId, actor, nonce (decimal) }] }
]
```

There are 1..16 canaries and 1..16 actual operation references each. Duplicate launch/transaction/actor-nonce
references and supplied receipt/fee evidence are rejected. This local syntax/identity check does not authenticate
the chain references. The independent backend rereads `EngineLaunchBound`, `EngineLaunchParametersBound`,
operation events, immutable host/revision/engine getters, code and ledger state, with dual RPC and Ethereum finality.
It produces `programmable.module-engine-lifecycle-evidence.v1`; no Native event or proof is substituted.

Source activation proves the actual generic Host. A separate template-availability matrix must establish each
quote, escrow or settlement template's semantics and actual external dependencies. Missing WETH/router/liquidity
or route data remains an explicit unavailable template dependency rather than an invented core deployment parameter.

## Focused checks

The scoped tests cover single-stage/child construction, six-pin wire, source-ID separation, inherited registry and
recipients, exact token generation, full initcode bounds, missing/wrong-generation source receipts, historical
source-byte commitments, native-policy/Host-link RPC checks, reorganization and reference-only Engine lifecycle.

```sh
node --test contracts/scripts/module-engine/deployment.test.mjs
```

The shared reuse helper's default output was separately compared byte-for-byte with the previously sealed Native
V2 build proof. Contract money/static review and host/quote regressions are owned by the independent contract
workstream and are not reclassified as deployment, source publication or finality by these tools.
