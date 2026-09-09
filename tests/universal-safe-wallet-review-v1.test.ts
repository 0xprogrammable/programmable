import { decodeFunctionData, encodeFunctionResult, hashTypedData, parseAbi, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import { prepareUniversalLaunchWalletV1, type LaunchWalletProviderV1 } from "@/lib/custom-launch/wallet-handoff-plan-v1";
import { authorizeRecordFixture, capabilitiesFixture } from "./fixtures/launch-plan-admission-v1";
import type { LaunchPlanRecordV1 } from "@/lib/custom-launch/launch-plan-v1";
import { canonicalBrowserSha256V2 as digest } from "@/lib/custom-launch/browser-authority-v2";
import { bindStep, controller, hash, now, recordFixture, runtime, runtimeHash, stamp } from "./fixtures/universal-launch-v1";
const ZERO = "0x0000000000000000000000000000000000000000";
const owner = "0x4444444444444444444444444444444444444444";
const abi = parseAbi(["function masterCopy() view returns (address)", "function VERSION() view returns (string)", "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)", "function nonce() view returns (uint256)", "function getModulesPaginated(address start,uint256 pageSize) view returns(address[] array,address next)"]);
const types = { SafeTx: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" },
  { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" }, { name: "gasPrice", type: "uint256" }, { name: "gasToken", type: "address" },
  { name: "refundReceiver", type: "address" }, { name: "nonce", type: "uint256" }] } as const;
function fixture(): LaunchPlanRecordV1 {
  const base = recordFixture(); const plan = { ...base.plan, controller: { address: controller, kind: "erc1271" as const, runtimeCodeHash: runtimeHash } };
  const planHash = digest("programmable.custom-launch-plan.v1", plan);
  const step = bindStep({ ...base.steps[0], controller: plan.controller });
  const snapshot = { schemaVersion: "programmable.safe-launch-authority.v1", sourceCommitment: planHash, version: "1.4.1", singleton: { address: stamp, runtimeCodeHash: runtimeHash },
    owners: [{ address: owner, runtimeCodeHash: null }], threshold: "1", modules: [], guard: { address: ZERO, runtimeCodeHash: null }, fallbackHandler: { address: ZERO, runtimeCodeHash: null } };
  const typedData = { domain: { chainId: 4663, verifyingContract: controller }, types, primaryType: "SafeTx" as const,
    message: { to: step.transaction.to!, value: "0", data: step.transaction.data, operation: 0, safeTxGas: "0", baseGas: "0", gasPrice: "0", gasToken: ZERO as Hex, refundReceiver: ZERO as Hex, nonce: "7" } };
  const typedDataDigest = hashTypedData({ ...typedData, message: { ...typedData.message, value: 0n, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, nonce: 7n } });
  const walletAuthorization = { schemaVersion: "programmable.safe-launch-authorization.v1", kind: "safe_eip712", status: "owner_signature_required", controller,
    controllerRuntimeCodeHash: runtimeHash, controllerNonce: "7", transactionDigest: step.transactionDigest, authoritySnapshot: snapshot,
    authoritySnapshotDigest: digest("programmable.safe-launch-authority.v1", snapshot), typedData, typedDataDigest, requiredOwners: [owner], threshold: "1",
    execution: { to: controller, value: "0", function: "execTransaction", gasLimit: "100000" }, actualSignaturesVerified: false };
  const admissionEvidence = { simulation: { steps: [{ stepId: step.stepId, transactionDigest: step.transactionDigest,
    witness: { kind: "runtime_trace", ref: "fixture:safe", details: { walletAuthorization } } }] } };
  return authorizeRecordFixture({ ...base, plan, planHash, steps: [step], admissionEvidence } as unknown as LaunchPlanRecordV1);
}
function provider(changedThreshold = false, ownerConnection = false): LaunchWalletProviderV1 {
  return { request: vi.fn(async ({ method, params }) => {
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_accounts") return [ownerConnection ? owner : controller];
    if (method === "eth_getCode") return params?.[0] === owner || params?.[0] === ZERO ? "0x" : runtime;
    if (method === "eth_getStorageAt") return params?.[1] === `0x${"00".repeat(32)}` ? `0x${stamp.slice(2).padStart(64, "0")}` : `0x${"00".repeat(32)}`;
    if (method === "eth_gasPrice") return "0x2";
    if (method === "eth_estimateGas") return "0xc350";
    if (method === "eth_call") {
      const data = (params?.[0] as { data: Hex }).data;
      if (data === "0x12345678") return "0x";
      const { functionName } = decodeFunctionData({ abi, data });
      if (functionName === "getOwners") return encodeFunctionResult({ abi, functionName, result: [owner] });
      if (functionName === "getThreshold") return encodeFunctionResult({ abi, functionName, result: changedThreshold ? 2n : 1n });
      if (functionName === "nonce") return encodeFunctionResult({ abi, functionName, result: 7n });
      if (functionName === "masterCopy") return encodeFunctionResult({ abi, functionName, result: stamp });
      if (functionName === "VERSION") return encodeFunctionResult({ abi, functionName, result: "1.4.1" });
      return encodeFunctionResult({ abi, functionName, result: [[], "0x0000000000000000000000000000000000000001"] });
    }
    throw new Error(`Unexpected Safe request ${method}`);
  }) };
}
describe("source-bound Safe controller wallet", () => {
  const input = () => { const record = fixture(); return { sourceVersion: "custom_launch_plan_v1" as const, reviewedResource: record, stepId: "configure", action: "review" as const,
    loadFreshResource: async () => record, loadFreshCapabilities: async () => capabilitiesFixture(record) }; };
  it("reviews actual connected Safe authority and preserves its logical call without an EOA nonce", async () => {
    const rpc = provider(); const review = await prepareUniversalLaunchWalletV1(rpc, controller, input(), now);
    expect(review.transaction.nonce).toBeUndefined();
    expect(review.controllerAuthorization).toMatchObject({ controllerNonce: "7", actualSignaturesVerified: false, threshold: "1" });
    expect(rpc.request).not.toHaveBeenCalledWith(expect.objectContaining({ method: "eth_getTransactionCount" }));
  });
  it("rejects stale quorum and owner EOA impersonation", async () => {
    await expect(prepareUniversalLaunchWalletV1(provider(true), controller, input(), now)).rejects.toThrow(/Safe authority/);
    await expect(prepareUniversalLaunchWalletV1(provider(false, true), controller, input(), now)).rejects.toThrow(/exact controller/);
  });
  it("rejects changes to the signed admission source evidence", async () => {
    const request = input(); const record = fixture();
    await expect(prepareUniversalLaunchWalletV1(provider(), controller, { ...request,
      loadFreshResource: async () => ({ ...record, admissionEvidence: { replaced: hash } }) }, now)).rejects.toThrow();
  });
});
