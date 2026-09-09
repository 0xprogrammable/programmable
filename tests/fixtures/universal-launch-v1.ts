import { keccak256, type Address, type Hex } from "viem";
import type { CustomLaunchPlanV1, LaunchPlanRecordV1, LaunchProjectionV1, LaunchWalletStepV1 } from "@/lib/custom-launch/launch-plan-v1";
import { canonicalBrowserSha256V2 as digest } from "@/lib/custom-launch/browser-authority-v2";

export const controller = `0x${"11".repeat(20)}` as Address;
export const component = `0x${"22".repeat(20)}` as Address;
export const stamp = `0x${"33".repeat(20)}` as Address;
export const hash = `0x${"aa".repeat(32)}` as Hex;
export const runtime = "0x6001600055" as Hex;
export const runtimeHash = keccak256(runtime);
export const now = 1788951600n;
export const nowIso = new Date(Number(now) * 1000).toISOString();
export function planFixture(): CustomLaunchPlanV1 {
  return { schemaVersion: "programmable.custom-launch-plan.v1", chainId: "4663", controller: { address: controller, kind: "eoa" },
    manifestDigest: digest("programmable.custom-launch-contract.v1", { fixture: true }), executor: "controller_multi_step_v1",
    verificationBundle: { schemaVersion: "programmable.exact-source-verification-bundle.v2", compilationUnits: [], components: [] },
    components: [{ componentId: "settlement", artifactId: "new-contract", expectedAddress: component, runtimeCodeHash: runtimeHash, tags: ["unfamiliar-mechanism"] }],
    actions: [{ actionId: "configure", dependsOn: [], kind: "call", authority: { kind: "controller" }, preconditions: [], postconditions: ["configured"],
      execution: { target: { componentId: "settlement" }, data: "0x12345678", value: "0", gasLimit: "100000" } }],
    markets: [], hookBindings: [], dependencies: [],
    expectedEffects: [{ effectId: "configured", kind: "storage", criticality: "critical", target: { componentId: "settlement" }, slot: hash, expected: hash }],
    budgets: { validAfter: (now - 60n).toString(), deadline: (now + 600n).toString(), maxTotalValue: "0", maxTotalGas: "300000" },
    feeObligations: [{ obligationId: "no-swap", mode: "not_applicable", policyVersion: "programmable.custom-launch-fee.v1", rateBps: 0,
      scope: "no_qualifying_swap_flow", recipient: null, marketIds: [] }], claimDescriptors: [], distributionPreferences: [] };
}
export function bindStep(value: Omit<LaunchWalletStepV1, "transactionDigest">): LaunchWalletStepV1 {
  const { stepId, actionIds, controller, transaction, preconditions, postconditions } = value;
  return { ...value, transactionDigest: digest("programmable.custom-launch-plan-transaction.v1", { stepId, actionIds, controller, transaction, preconditions, postconditions }) };
}
export function recordFixture(): LaunchPlanRecordV1 {
  const plan = planFixture(); const planHash = digest("programmable.custom-launch-plan.v1", plan);
  return { schemaVersion: "programmable.custom-launch-plan-resource.v1", planId: "10000000-0000-4000-8000-000000000001", requestId: "test-request", principalId: "test-principal",
    plan, planHash, rawRequestSha256: planHash, manifestDigest: plan.manifestDigest, status: "wallet_action_ready", preflight: null,
    admission: { schemaVersion: "programmable.custom-launch-plan-admission.v1", planHash, rawRequestSha256: planHash, manifestDigest: plan.manifestDigest,
      principalId: "test-principal", controller, chainId: "4663", evidenceDigest: digest("programmable.custom-launch-plan-evidence.v1", { fixture: true }), issuerVersion: "fixture", issuerKeyId: "fixture",
      issuedAt: nowIso, expiresAt: new Date(Number(now + 600n) * 1000).toISOString(), assuranceClaims: [], receiptHash: planHash, signature: "fixture" },
    admissionEvidence: { fixture: true },
    steps: [bindStep({ stepId: "configure", actionIds: ["configure"], status: "wallet_action_ready", controller: plan.controller,
      transaction: { chainId: "4663", from: controller, to: component, data: "0x12345678", value: "0", gasLimit: "100000", nonce: "7", deadline: plan.budgets.deadline },
      preconditions: [], postconditions: ["configured"], transactionHash: null })],
    distribution: { programmableRouting: "untested", uniswapApi: "not_requested", uniswapLabsRouting: "unknown", hooklist: "not_requested" },
    createdAt: nowIso, updatedAt: nowIso, resumeUrl: "/developers/api-keys?view=history" };
}
export function projectionFixture(): LaunchProjectionV1 {
  const resource = recordFixture();
  return { schemaVersion: "programmable.launch-projection.v1", sourceVersion: "custom_launch_plan_v1", launchId: resource.planId, chainId: "4663",
    controller, createdAt: nowIso, finalizedAt: nowIso, manifestDigest: resource.manifestDigest, planHash: resource.planHash,
    components: resource.plan.components, markets: [], primaryComponentId: null, primaryMarketId: null, publication: null,
    assuranceClaims: [], claimDescriptors: [], distribution: resource.distribution, sourceVerification: "verified",
    finality: { status: "final", transactionHashes: [hash], blockNumber: "42", blockHash: hash, witness: { kind: "chain_read", ref: "fixture:final", details: { fixture: true } } } };
}
