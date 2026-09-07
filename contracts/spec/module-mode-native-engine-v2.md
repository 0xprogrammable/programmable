# Module Mode native V2 economics

This additive source generation, `module-native-v2`, implements the confirmed Plan 53 native spot fee policy. Local checks are not deployment, independent review, source verification or public availability evidence. Existing V1 source and historical fee/claim rules are unchanged.

## Reuse and source version

V2 retains the native V1 PoolManager callbacks, swap settlement, token creation, permanent LP locking, runtime/funding path, creator shares, wallet rotation, CTO authorization and backed pull claims. RuntimeV1, RuntimeFactoryV1, EngineTypesV1, the program ABI, position planner, launch policy and position forwarder are unchanged dependencies. RegistryV2 extends RegistryV1 by inheritance.

The old hook and ledger use private, non-virtual fee implementations and constructor-bound dependencies. Small versioned source forks of the hook, ledger, launcher, router and router factory preserve old source identity while binding the new economics. Plain and module launches use the same V2 engine and launcher.

## Immutable launch economics

`ECONOMICS_POLICY_ID = keccak256("programmable.module-mode.native-economics.v2")` is exposed by hook, ledger, launcher and router.

| Eligible selected families | Platform | Protocol | Shared authors |
| --- | ---: | ---: | ---: |
| None | 10 bps | 10 bps | 0 |
| One or more | 30 bps | 10 bps | 20 bps total |

Creator fees remain additional, separately selected for buys and sells in 100-bps steps from 0 through 1000 bps. The initial purchase is a fee-bearing buy. No flat creation charge is added.

RegistryV2 inherits existing family/revision/review/availability/wallet APIs and adds `setFamilyFeeEligibility(bytes32 familyId, bool eligible, bytes32 reviewDigest)` and the getter `familyFeeEligibility(bytes32) -> (bool, bytes32)`. The setter is owner-only, requires an existing family and nonzero digest, and emits `FamilyFeeEligibilityReviewed`. Default eligibility is false. Review must establish a distinct functional family; a new version, instance, import or team member is not another family.

HookV2 validates every explicitly selected revision. It snapshots, deduplicates and sorts eligible family IDs for the ledger, preserving selected instance execution order. The limits are 16 instances and 8 eligible families, also subject to RuntimeV1's unchanged total callback/configuration limits. The native base engine has no selected-family slot. Unselected families, including imports, earn no slot. Multiple revisions/instances of the same family get one slot. Distinct reviewed families may share a payout wallet.

`previewRecipe` binds the V2 recipe domain, chain, hook, registry, policy ID, each selection's family eligibility/review digest, creator rates, eligible families and complete selections. LaunchParameters appends a required `expectedRecipeHash`; launch recomputes it before token creation and verifies it again during registration. Any changed review digest or eligibility invalidates a stale launch request. Existing pools retain stored fee rates and families after catalog changes. Author and creator/CTO wallet changes preserve old whole-unit claims; future whole-unit credits go to the then-current wallet. Fractional carry follows the wallet active when it becomes whole, as in V1.

## Native basis and integer accounting

Let `p` be the stored 10/30 platform rate, `c` the direction's creator rate and `B = 10000`.

| Route | Native amount |
| --- | --- |
| Buy exact input | Specified input is gross `G`; pool receives `G - F`. |
| Buy exact output | Actual pool input is net `N`; payer supplies gross `G`. |
| Sell exact input | Actual pool output is gross `G`; recipient receives `G - F`. |
| Sell exact output | Specified recipient output is net `N`; pool supplies gross `G`. |

The existing gross rule is `F = floor(G * (c + p) / B)`. The existing exact-output gross-up rule is `G = ceil(N * B / (B - c - p))`, `F = G - N`. If creator fees are nonzero, platform gets `floor(G * p / B)` and creator gets the remaining `F - platform`; otherwise all `F` is platform fee. This accounts explicitly for the combined-fee/exact-output one-unit rounding remainder. PoolManager protocol/LP charges remain separate and visible through `feeComponents`.

The ledger splits actual platform receipts cumulatively. With lifetime platform receipts `P`, creator receipts `C` and `n` eligible families:

- `n = 0`: treasury receives exactly `P`; no author/fallback allocation.
- `n > 0`: treasury receives `floor(P / 3)`; each family receives `floor(floor(2 * P / 3) / n)`.
- Creator slot `i` receives `floor(C * shareBps[i] / B)`.

Each accrual credits the difference from prior lifetime entitlement. Unallocated units remain explicit backed dust; no first-family bonus, sweep or wallet-rotation redistribution exists. Two-thirds multiplication uses FullMath. The author pool is charged once, irrespective of instance/family count. Claims can redeem native PoolManager claims or use actual received ETH without changing entitlements.

## Integration ABI

| Surface | V2 |
| --- | --- |
| Registry constructor | `ModuleNativeRegistryV2(address reviewAuthority)` plus eligibility APIs above. |
| Hook constructor | `(IPoolManager, ModuleNativeRegistryV2, ModuleNativeRuntimeFactoryV1, address treasury, address rewardAdmin)`. No no-module recipient. V2 registry and runtime factory bytecodes are checked. |
| Recipe preview | Existing `previewRecipe(uint16 buyFee,uint16 sellFee,Selection[] modules) -> (bytes32 recipeHash,bytes32[] families)` shape, with V2 hash and eligible/deduplicated-family semantics. |
| Pool registration | Existing EngineTypesV1.PoolRegistration input shape. `poolConfig(poolId)` appends `uint16 platformFeeBps` after `launchKey`. |
| Quotes | `quoteGrossFees(bytes32 poolId,bool isBuy,uint256 amount)` and `quoteExactOutputFees(bytes32 poolId,bool isBuy,uint256 amount)` return `(uint256 creator,uint256 platform)` and read stored rates. |
| Fee components | Existing `feeComponents(poolId,isBuy)` shape; platformBps is the stored 10/30. `PROTOCOL_FEE_BPS()` now means 10, not total platform fees. |
| Launcher constructor | Existing parameters with V2 hook/router-factory types substituted. |
| LaunchParameters | Existing fields plus `bytes32 expectedRecipeHash` appended after `deadline`; nonzero and current. |
| Identity | `sourceVersion()` returns `module-native-v2`; common `launchIdentityVersion()` remains 1. getLaunchIdentity and LaunchRecord field shapes are unchanged; source/domains/recipe/economics bind generation. |
| Router/factory | Existing swap and initial-buy signatures. Constructor verifies V2 policy ID; factory uses the V2 salt domain. |
| Ledger constructor | `ClassicModuleFeeLedgerV2(IPoolManager,IClassicModuleAuthorRegistry,address treasury,address rewardAdmin)`. Deployer is immutable hook. No noModuleRecipient getter/destination. |
| Ledger registration | Existing `registerPool(poolId,creatorWallets,sharesBps,eligibleFamilies)`, immutable engine only; configurationHash adds policy ID. |
| Ledger receipts | Existing `accrue(poolId,platformFee,creatorFee)` after native PoolManager claim minting; new payable engine-only `accrueNative(poolId,platformFee,creatorFee)` requires exact msg.value equal to fee sum. |
| Ledger reads/claims | Existing accounting, attribution, recipients, claims, rotations and CTO shapes; adds `platformFeeBps(poolId)` and policy ID. |

`accrueNative` supports an admitted engine's actual ETH, including atomic conversion proceeds. It accepts no quote-token IOU or conversion promise. The calling engine must validate its own operation basis, conversion bounds and eligible families. NativeHookV2 uses the existing claim-mint path. Unfunded accrual cannot borrow another pool's reserved backing or dust.

`NativeEconomicsBound(poolId,economicsPolicyId,protocolFeeBps,authorPoolFeeBps,eligibleFamilies,selectionEligible,selectionReviewDigests)` records the snapshot, including per-selection bool/digest arrays in execution order. `eligibilitySnapshot(poolId)` returns those same stored arrays. Recipe hashing, storage and the event all use one memory snapshot read before any factory callback; no post-callback Registry read can change it. This allows historical recipe reconstruction even if eligibility changes inside the launch transaction or later in the same block. Existing launch, fee, reward-credit and claim event shapes remain. `ModuleNativeConfigurationBound` includes policy ID and the ledger configuration hash in its economics commitment. Indexers must bind actual source generation and credited amounts, never recalculate old revenue using a new global rate.

## Local verification and integration boundary

Unchanged Solidity 0.8.26/Cancun/optimizer1000 settings, existing dependency tree:

- V1 engine: 26 passed, including 1000 fuzzed roundtrips.
- V2 engine: 38 passed, including 0/1/2 families × 0/1/10% creator × all four swap quadrants, stale eligibility commitments, duplicate-family instances, real settlement, wallet/CTO history, spoofed routes, reentrancy, slippage rollback and 1000 fuzzed roundtrips.
- V2 ledger: 12 passed, including 0/1/2/3/5/8 families, one-wei carry, rotations/claims, native receipt validation, mixed native/PoolManager backing, unfunded/reentrant/failed claims, both ledger generations on one real PoolManager and 1000 fuzzed partitions interleaved with claims.

Commands use `bash contracts/test/module-mode/run-tests.sh` with `--match-contract 'ModuleNativeEngineV[12]Test' -vv`, then `--match-contract 'ModuleNative(EngineV2|FeeLedgerV2)Test' -vv` after the ledger additions and stronger exact-output/slippage assertions. The subsequent snapshot-only regression also passes and changes eligibility inside a reviewed factory callback, then reconstructs the recipe from the emitted/stored pre-callback snapshot. No old source/test, compiler or dependency files changed.

Final size check with these fixed settings:

| Contract | Init code including ABI constructor arguments | Runtime |
| --- | ---: | ---: |
| LedgerV2 | 13398 | 12710 |
| RegistryV2 | 4054 | 3775 |
| HookV2 | 49107 | 15968 |
| LauncherV2 | 46057 | 20239 |
| RouterV2 | 8452 | 7647 |
| RouterFactoryV2 | 9647 | 9619 |

All are within EIP-3860's 49152-byte and EIP-170's 24576-byte limits. Hook initcode has only 45 bytes of headroom; subsequent functionality or compiler changes require a fresh deployment-size check. Thirty-five existing source/test files under module-mode and classic-modules compare byte-identical against base commit `e62ddf963fc06a555c9177f9a4f402adc6e47b6f`.

This native spot lane does not implement the separate generic engine/adapter operation accounting or mixed-field fixed-template constraints. Fixed opaque configuration must be enforced by an independently reviewed factory; an SDK schema alone grants no contract authority. Independent money-code review, full release gates, exact deployment/ABI bindings, generation-aware discovery/clients/indexers, wallet execution and public lifecycle evidence remain the integration owner's work. No remote write or transaction was performed here.
