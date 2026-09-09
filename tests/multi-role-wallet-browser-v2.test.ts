import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { prepareUniversalLaunchWalletV1, type LaunchWalletProviderV1 } from "@/lib/custom-launch/wallet-handoff-plan-v1";
import { multiRoleOriginalTransactionHintV3, MULTI_ROLE_DERIVED_FINALITY_POLICY_V3 } from "@/lib/custom-launch/multi-role-finality-version-v3";
import { computePoolKeyHashV2 } from "@/lib/custom-launch/multi-role-router-codec-v2";

const capture = JSON.parse(readFileSync(new URL("./fixtures/multi-role-wallet-v2.json", import.meta.url), "utf8"));
// The captured combined component is the source of its repeated public address/runtime fields.
// Keep the original signed roots and calldata; only restore this redundant artifact metadata.
const sharedComponent = capture.artifact.predictedComponents.find((entry: { componentRoles: string[] }) => entry.componentRoles.includes("token"));
capture.artifact.market = {
  token: sharedComponent.account,
  ...capture.artifact.market,
  poolKeyHash: computePoolKeyHashV2(capture.artifact.market.poolKey),
};
capture.artifact.stampRequest = {
  launchId: capture.artifact.stampRequest.launchId,
  token: sharedComponent.account,
  tokenRuntimeCodeHash: sharedComponent.expectedRuntimeCodeHash,
  ...capture.artifact.stampRequest,
};
const golden = capture as {
  artifact: Record<string, unknown> & { artifactHash: string; chainBindings: Record<string, unknown> };
  walletTransaction: { from: Address; to: Address; transactionPreimageHash: string; calldata: Hex; valueWei: string };
  nowUnixSeconds: string; codes: Record<string, Hex> };
function fixture(profile: Record<string, unknown> = {}) {
  const context = { chainId: "4663", chainBindings: golden.artifact.chainBindings, profile };
  return { schemaVersion: "programmable.multi-role-custom-launch-resource.v2", launchId: "10000000-0000-4000-8000-000000000001",
    requestHash: `sha256:${"aa".repeat(32)}`, status: "wallet_action_required", context, commitments: {}, preparedArtifact: golden.artifact,
    artifactHash: golden.artifact.artifactHash, walletTransactionPreimageHash: golden.walletTransaction.transactionPreimageHash,
    wallet: { context, commitments: {}, walletTransaction: golden.walletTransaction } };
}
const provider: LaunchWalletProviderV1 = { async request({ method, params }) {
  if (method === "eth_chainId") return "0x1237";
  if (method === "eth_accounts") return [golden.walletTransaction.from];
  if (method === "eth_getCode") return Object.entries(golden.codes).find(([address]) => address.toLowerCase() === String(params?.[0]).toLowerCase())?.[1] ?? "0x";
  if (method === "eth_call") return "0x";
  if (method === "eth_gasPrice") return "0x2";
  if (method === "eth_estimateGas") return "0x186a0";
  throw new Error(`Unexpected method ${method}`);
} };
describe("unchanged MultiRole V2 wallet codec", () => {
  it("reviews the captured local E2E calldata without rehashing it as vNext", async () => {
    const resource = fixture();
    const review = await prepareUniversalLaunchWalletV1(provider, golden.walletTransaction.from, {
      sourceVersion: "multi_role_v2", action: "review", reviewedResource: resource, loadFreshResource: async () => resource,
      loadFreshCapabilities: async () => ({ context: resource.context, readiness: { status: "ready" } }),
    }, BigInt(golden.nowUnixSeconds));
    expect(review.transaction.data).toBe(golden.walletTransaction.calldata);
    expect(review.binding).toBe(golden.walletTransaction.transactionPreimageHash);
    expect(review.valueWei).toBe(golden.walletTransaction.valueWei);
  });
  it("rejects changed artifact roots even if the resource remains owner-readable", async () => {
    const resource = fixture();
    await expect(prepareUniversalLaunchWalletV1(provider, golden.walletTransaction.from, {
      sourceVersion: "multi_role_v2", action: "review", reviewedResource: resource,
      loadFreshResource: async () => ({ ...resource, artifactHash: `sha256:${"bb".repeat(32)}` }),
      loadFreshCapabilities: async () => ({ context: resource.context, readiness: { status: "ready" } }),
    }, BigInt(golden.nowUnixSeconds))).rejects.toThrow();
  });
  it("retains V2 wallet bytes for a V3 original context and selects its exact tracking contract", async () => {
    const resource = fixture({ derivedContractFinality: MULTI_ROLE_DERIVED_FINALITY_POLICY_V3 });
    const review = await prepareUniversalLaunchWalletV1(provider, golden.walletTransaction.from, {
      sourceVersion: "multi_role_v2", action: "review", reviewedResource: resource, loadFreshResource: async () => resource,
      loadFreshCapabilities: async () => ({ context: resource.context, readiness: { status: "ready" } }),
    }, BigInt(golden.nowUnixSeconds));
    expect(review.transaction.data).toBe(golden.walletTransaction.calldata);
    expect(review.binding).toBe(golden.walletTransaction.transactionPreimageHash);
    expect(multiRoleOriginalTransactionHintV3(resource)).toEqual({ version: "v3", schemaVersion: "programmable.multi-role-transaction-hint.v3", path: "/transaction-hints-v3" });
    expect(multiRoleOriginalTransactionHintV3(fixture())).toEqual({ version: "v2", schemaVersion: "programmable.multi-role-transaction-hint.v2", path: "/transaction-hints" });
    await expect(prepareUniversalLaunchWalletV1(provider, golden.walletTransaction.from, {
      sourceVersion: "multi_role_v2", action: "review", reviewedResource: fixture(), loadFreshResource: async () => resource,
      loadFreshCapabilities: async () => ({ context: resource.context, readiness: { status: "ready" } }),
    }, BigInt(golden.nowUnixSeconds))).rejects.toThrow();
  });
  it.each([null, {}, { ...MULTI_ROLE_DERIVED_FINALITY_POLICY_V3, maximumDerivedContracts: 17 },
    { ...MULTI_ROLE_DERIVED_FINALITY_POLICY_V3, schemaVersion: "programmable.multi-role-derived-finality-policy.v4" }])("never silently downgrades an unknown original finality policy", policy => {
    expect(() => multiRoleOriginalTransactionHintV3(fixture({ derivedContractFinality: policy }))).toThrow(/unsupported/);
  });
});
