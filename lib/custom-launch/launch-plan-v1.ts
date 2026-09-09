// Public transport types mirror the canonical backend Custom Launch Plan V1 contract.
// Source: services/custom-launch-api-v1/src/domain/types-custom-launch-plan-v1.ts.
// Historical V2 resources keep their own domain and are never rehashed as this plan.
import type { Address, Hex } from "viem";
type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
type JsonObject = { readonly [key: string]: JsonValue };
type Sha256Digest = `sha256:${string}`;
type ExactSourceVerificationBundleV2 = JsonObject;

/** Additive wire domains. MultiRole V2 is never parsed or rehashed as this version. */
export const CUSTOM_LAUNCH_PLAN_VERSION_V1 = "programmable.custom-launch-plan.v1" as const;
export const CUSTOM_LAUNCH_PLAN_ROUTE_V1 = "custom-launch-plan:create:v1" as const;
export const CUSTOM_LAUNCH_PLAN_RECEIPT_VERSION_V1 = "programmable.custom-launch-plan-admission.v1" as const;
export const LAUNCH_PROJECTION_VERSION_V1 = "programmable.launch-projection.v1" as const;

export type LaunchAddressRefV1 = Readonly<{ address: Address }> | Readonly<{ componentId: string }>;
export type LaunchExecutorV1 = "atomic_graph_v2" | "controller_multi_step_v1" | "observe_and_stamp_v1";
export type LaunchControllerV1 = Readonly<{
  address: Address;
  kind: "eoa" | "erc1271" | "smart_account";
  /** Current contract-wallet runtime and authority snapshot, when applicable. */
  runtimeCodeHash?: Hex;
  authoritySnapshot?: JsonObject;
}>;

export interface LaunchComponentV1 {
  readonly componentId: string;
  /** Refers to verificationBundle.components[].targetId, never an admission category. */
  readonly artifactId: string;
  readonly expectedAddress: Address;
  readonly runtimeCodeHash: Hex;
  readonly tags?: readonly string[];
}

export interface LaunchCallV1 {
  readonly target: LaunchAddressRefV1;
  readonly data: Hex;
  readonly value: string;
  readonly gasLimit: string;
}

export type LaunchActionAuthorityV1 =
  | Readonly<{ kind: "controller" }>
  | Readonly<{ kind: "platform"; binding: "launch_stamp"; operation: "stampPlanV1" }>;

interface LaunchActionBaseV1 {
  readonly actionId: string;
  readonly dependsOn: readonly string[];
  readonly authority: LaunchActionAuthorityV1;
  readonly preconditions: readonly string[];
  readonly postconditions: readonly string[];
}

/** Execution bytes are exact controller calls; the compiler validates their stated effects. */
export type LaunchActionV1 = LaunchActionBaseV1 & (
  | Readonly<{ kind: "deployCreate2"; componentId: string; factory: LaunchAddressRefV1;
      salt: Hex; initCode: Hex; execution: LaunchCallV1 }>
  | Readonly<{ kind: "deployCreate"; componentId: string; parent: LaunchAddressRefV1;
      nonce: string; execution: LaunchCallV1 }>
  | Readonly<{ kind: "useExisting"; componentId: string }>
  | Readonly<{ kind: "call"; execution: LaunchCallV1 }>
  | Readonly<{ kind: "initializePool"; marketId: string; sqrtPriceX96: string; execution: LaunchCallV1 }>
  | Readonly<{ kind: "provideLiquidity"; marketId: string; execution: LaunchCallV1 }>
  | Readonly<{ kind: "verifyEffect"; effectId: string }>
);

export interface LaunchMarketV1 {
  readonly marketId: string;
  readonly kind: "uniswap_v4";
  readonly poolManager: Address;
  readonly currency0: LaunchAddressRefV1;
  readonly currency1: LaunchAddressRefV1;
  readonly fee: number;
  readonly tickSpacing: number;
  readonly hooks: LaunchAddressRefV1;
}

export interface LaunchHookBindingV1 {
  readonly componentId: string;
  readonly poolManager: Address;
  readonly permissions: number;
  readonly callbackAbi: readonly JsonObject[];
  readonly hookDataSchema?: JsonObject;
}

export interface LaunchDependencyV1 {
  readonly dependencyId: string;
  readonly chainId: string;
  readonly address: Address;
  readonly runtimeCodeHash: Hex;
  readonly authoritySnapshot?: JsonObject;
}

export type LaunchEffectV1 = Readonly<{ effectId: string; criticality: "critical" | "optional" | "observed" }> & (
  | Readonly<{ kind: "runtime"; target: LaunchAddressRefV1; runtimeCodeHash: Hex }>
  | Readonly<{ kind: "callResult"; target: LaunchAddressRefV1; data: Hex; expected: Hex }>
  | Readonly<{ kind: "storage"; target: LaunchAddressRefV1; slot: Hex; expected: Hex }>
  | Readonly<{ kind: "balance"; target: LaunchAddressRefV1; asset: Address; minimum: string; maximum: string }>
  | Readonly<{ kind: "child"; componentId: string; derivation:
      Readonly<{ kind: "create"; parent: LaunchAddressRefV1; nonce: string }>
      | Readonly<{ kind: "create2"; parent: LaunchAddressRefV1; salt: Hex; initCodeHash: Hex }>;
      runtimeCodeHash: Hex }>
);

export interface LaunchFeeObligationV1 {
  readonly obligationId: string;
  readonly mode: "pool_enforced" | "programmable_routed" | "not_applicable";
  readonly policyVersion: "programmable.custom-launch-fee.v1";
  readonly rateBps: 20 | 0;
  readonly scope: "proven_pool_paths" | "programmable_built_or_routed_qualifying_swaps" | "no_qualifying_swap_flow";
  readonly recipient: Address | null;
  readonly marketIds: readonly string[];
  /** A declaration is not a proof: the independent verifier must reproduce this witness. */
  readonly enforcementWitness?: LaunchWitnessV1;
}

export interface LaunchWitnessV1 {
  readonly kind: "request" | "source" | "compiler" | "runtime" | "runtime_trace" | "chain_read" | "policy" | "provider";
  readonly ref: string;
  readonly details: JsonObject;
}

export interface LaunchClaimV1 {
  readonly claimType: string;
  readonly subject: string;
  readonly observedValue: JsonValue;
  readonly status: "verified" | "unresolved" | "disclosed";
  readonly witness: LaunchWitnessV1;
  readonly assessor: string;
  readonly assessorVersion: string;
  readonly validAt: string;
  readonly blockNumber: string | null;
}

export interface LaunchClaimDescriptorV1 {
  readonly claimId: string;
  readonly chainId: string;
  readonly asset: Address;
  readonly accrualContract: Address;
  readonly read: Readonly<{ data: Hex; resultType: "uint256" }>;
  readonly claim: Readonly<{ data: Hex; value: "0" }>;
  readonly requiredController: Address;
  readonly beneficiary: Address;
  readonly immutableRecipient: Address | null;
  readonly runtimeCodeHash: Hex;
  readonly proof: LaunchWitnessV1;
}

export interface CustomLaunchPlanV1 {
  readonly schemaVersion: typeof CUSTOM_LAUNCH_PLAN_VERSION_V1;
  readonly manifestDigest: Sha256Digest;
  readonly chainId: string;
  readonly controller: LaunchControllerV1;
  readonly executor: LaunchExecutorV1;
  readonly verificationBundle: ExactSourceVerificationBundleV2;
  readonly components: readonly LaunchComponentV1[];
  readonly actions: readonly LaunchActionV1[];
  readonly markets: readonly LaunchMarketV1[];
  readonly hookBindings: readonly LaunchHookBindingV1[];
  readonly dependencies: readonly LaunchDependencyV1[];
  readonly expectedEffects: readonly LaunchEffectV1[];
  readonly budgets: Readonly<{ maxTotalValue: string; maxTotalGas: string; validAfter: string; deadline: string }>;
  readonly feeObligations: readonly LaunchFeeObligationV1[];
  readonly claimDescriptors: readonly LaunchClaimDescriptorV1[];
  readonly distributionPreferences: readonly Readonly<{
    provider: "hooklist" | "uniswap_api" | "uniswap_labs";
    optedIn: boolean;
  }>[];
  readonly publication?: Readonly<{
    visibility: "listed" | "unlisted";
    name?: string;
    symbol?: string;
    description?: string;
    imageUrl?: string;
    primaryComponentId?: string;
    primaryMarketId?: string;
    links?: readonly string[];
  }>;
}

export type LaunchRetryModeV1 = "same_request" | "repack_new_idempotency" | "poll" | "change_contract" | "operator_retry";
export interface LaunchFindingV1 {
  readonly code: string;
  readonly stage: string;
  readonly blockingAxis: "launchEligibility" | "assurance" | "distribution" | "lifecycle" | null;
  readonly invariant: string;
  readonly jsonPointer: string;
  readonly actual: JsonValue;
  readonly constraint: JsonObject;
  readonly witness: LaunchWitnessV1;
  readonly repair: Readonly<{ action: "replace_value" | "repack" | "change_contract" | "inspect" | "retry" | "none";
    value?: JsonValue; patch?: readonly JsonObject[] }>;
  readonly retry: Readonly<{ mode: LaunchRetryModeV1; sameBytesAllowed: boolean }>;
  readonly resumeUrl: string;
  readonly documentationUrl: string;
}

export interface LaunchPreflightV1 {
  readonly schemaVersion: "programmable.custom-launch-plan-preflight.v1";
  readonly requestId: string;
  readonly planHash: Sha256Digest;
  readonly manifestDigest: Sha256Digest;
  readonly launchEligibility: Readonly<{ status: "ready" | "action_required" | "analysis_pending";
    hardBlockers: readonly LaunchFindingV1[] }>;
  readonly findings: readonly LaunchFindingV1[];
  readonly assurance: Readonly<{ level: "provenance_only" | "provenance_verified" | "properties_verified";
    claims: readonly LaunchClaimV1[] }>;
}

export interface LaunchAdmissionReceiptV1 {
  readonly schemaVersion: typeof CUSTOM_LAUNCH_PLAN_RECEIPT_VERSION_V1;
  readonly planHash: Sha256Digest;
  readonly rawRequestSha256: Sha256Digest;
  readonly manifestDigest: Sha256Digest;
  readonly principalId: string;
  readonly controller: Address;
  readonly chainId: string;
  readonly evidenceDigest: Sha256Digest;
  readonly issuerVersion: string;
  readonly issuerKeyId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly assuranceClaims: readonly LaunchClaimV1[];
  readonly receiptHash: Sha256Digest;
  readonly signature: string;
}

export interface LaunchWalletStepV1 {
  readonly stepId: string;
  readonly actionIds: readonly string[];
  readonly status: "pending" | "wallet_action_ready" | "broadcast" | "mined" | "final" | "failed";
  readonly controller: LaunchControllerV1;
  readonly transaction: Readonly<{ chainId: string; from: Address; to: Address | null; data: Hex;
    value: string; gasLimit: string; nonce: string; deadline: string }>;
  readonly transactionDigest: Sha256Digest;
  readonly preconditions: readonly string[];
  readonly postconditions: readonly string[];
  readonly transactionHash: Hex | null;
}

export type LaunchLifecycleV1 = "accepted" | "preflight_complete" | "launch_ready" | "action_required"
  | "analysis_pending" | "reserved" | "wallet_action_ready" | "broadcast" | "mined" | "final"
  | "source_verified" | "indexed" | "publicly_visible" | "expired";

export interface LaunchDistributionV1 {
  readonly programmableRouting: "untested" | "compatible" | "adapter_required" | "incompatible";
  readonly uniswapApi: "not_requested" | "pending" | "available" | "unavailable";
  readonly uniswapLabsRouting: "unknown" | "automatic" | "review_required" | "allowed" | "unavailable";
  readonly hooklist: "not_requested" | "queued" | "submitted" | "merged" | "rejected";
}

export interface LaunchPlanRecordV1 {
  readonly schemaVersion: "programmable.custom-launch-plan-resource.v1";
  readonly planId: string;
  readonly requestId: string;
  readonly principalId: string;
  readonly planHash: Sha256Digest;
  readonly rawRequestSha256: Sha256Digest;
  readonly manifestDigest: Sha256Digest;
  readonly plan: CustomLaunchPlanV1;
  readonly status: LaunchLifecycleV1;
  readonly preflight: LaunchPreflightV1 | null;
  readonly admission: LaunchAdmissionReceiptV1 | null;
  readonly admissionEvidence?: JsonObject;
  readonly walletAuthorization?: Readonly<{ stampPreparation: JsonObject; controllerPrefix: JsonObject }>;
  readonly steps: readonly LaunchWalletStepV1[];
  readonly distribution: LaunchDistributionV1;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly resumeUrl: string;
}

export interface LaunchProjectionV1 {
  readonly schemaVersion: typeof LAUNCH_PROJECTION_VERSION_V1;
  readonly sourceVersion: "router_v1" | "multi_role_v2" | "custom_launch_plan_v1";
  readonly launchId: string;
  readonly chainId: string;
  readonly controller: Address;
  readonly createdAt: string;
  readonly finalizedAt: string | null;
  readonly manifestDigest: Sha256Digest | null;
  readonly planHash: Sha256Digest | null;
  readonly components: readonly LaunchComponentV1[];
  readonly markets: readonly LaunchMarketV1[];
  readonly primaryComponentId: string | null;
  readonly primaryMarketId: string | null;
  readonly publication: CustomLaunchPlanV1["publication"] | null;
  readonly assuranceClaims: readonly LaunchClaimV1[];
  readonly claimDescriptors: readonly LaunchClaimDescriptorV1[];
  readonly distribution: LaunchDistributionV1;
  readonly sourceVerification: "pending" | "verified" | "partial" | "failed";
  readonly finality: Readonly<{ status: "pending" | "final"; transactionHashes: readonly Hex[];
    blockNumber: string | null; blockHash: Hex | null; witness: LaunchWitnessV1 | null }>;
}
