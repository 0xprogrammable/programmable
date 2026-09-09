import { describe, expect, it, vi } from "vitest";
import { prepareUniversalLaunchWalletV1, type LaunchWalletProviderV1, type UniversalLaunchWalletInputV1 } from "@/lib/custom-launch/wallet-handoff-plan-v1";
import { verifyLaunchPlanReleaseAuthorityV1, type LaunchPlanPublicReleaseV1 } from "@/lib/custom-launch/launch-plan-release-authority-v1";
import { canonicalBrowserSha256V2 as digest } from "@/lib/custom-launch/browser-authority-v2";
import type { LaunchPlanRecordV1 } from "@/lib/custom-launch/launch-plan-v1";
import { admissionIssuerFixture, authorizeRecordFixture, capabilitiesFixture, releaseFixture, stampRecordFixture } from "./fixtures/launch-plan-admission-v1";
import { bindStep, component, controller, now, recordFixture, runtime, runtimeHash, stamp } from "./fixtures/universal-launch-v1";

const milliseconds = Number(now) * 1000;
const changedDigest = `sha256:${"bb".repeat(32)}`;
function provider(): LaunchWalletProviderV1 {
  return { request: vi.fn(async ({ method, params }) => {
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_accounts") return [controller];
    if (method === "eth_getCode") return params?.[0] === controller ? "0x" : runtime;
    if (method === "eth_getTransactionCount") return "0x7";
    if (method === "eth_gasPrice") return "0x2";
    if (method === "eth_estimateGas") return "0xc350";
    if (method === "eth_call") return "0x";
    throw new Error(`Unexpected wallet read ${method}`);
  }) };
}
function input(record: LaunchPlanRecordV1, capabilities: unknown = capabilitiesFixture(record)): UniversalLaunchWalletInputV1 {
  return { sourceVersion: "custom_launch_plan_v1", action: "review", reviewedResource: record, stepId: record.steps.at(-1)!.stepId,
    loadFreshResource: async () => record, loadFreshCapabilities: async () => capabilities };
}
function historicalCapabilities(record: LaunchPlanRecordV1) {
  const original = releaseFixture(record);
  const current: LaunchPlanPublicReleaseV1 = { ...original, releaseId: changedDigest, manifestDigest: changedDigest, issuerVersion: "b".repeat(40),
    binding: { ...original.binding, manifestDigest: changedDigest, policyBindingHash: changedDigest, address: component },
    execution: { stamp: { address: component, runtimeCodeHash: runtimeHash, selector: "0xbda52856" } }, receiptIssuer: admissionIssuerFixture("new-issuer").public };
  return capabilitiesFixture(record, [current, original], current);
}

describe("original release authority for launch wallet handoff", () => {
  it("uses the actual production nesting and verifies the signed admission before wallet reads", async () => {
    const record = stampRecordFixture(); const capabilities = capabilitiesFixture(record); const rpc = provider();
    expect(capabilities).not.toHaveProperty("execution");
    expect(capabilities.availability.bindings.execution.stamp.address).toBe(stamp);
    const result = await prepareUniversalLaunchWalletV1(rpc, controller, input(record, capabilities), now);
    expect(result.transaction.to).toBe(stamp);
    expect(result.admissionAuthority).toEqual({ releaseId: releaseFixture(record).releaseId, receiptHash: record.admission!.receiptHash,
      policyBindingHash: releaseFixture(record).binding.policyBindingHash });
    expect(result.decodedOperation).toMatchObject({ functionName: "stampPlanV1" });
  });
  it("preserves a valid original stamp when the current manifest, key and stamp change and current writes are disabled", async () => {
    const record = stampRecordFixture(); const capabilities = historicalCapabilities(record);
    expect(capabilities.manifestDigest).not.toBe(record.manifestDigest);
    expect(capabilities.availability.operations.create.state).toBe("disabled");
    const result = await prepareUniversalLaunchWalletV1(provider(), controller, input(record, capabilities), now);
    expect(result.transaction.to).toBe(stamp);
    expect(result.transaction.data).toBe(record.steps.at(-1)!.transaction.data);
    expect(result.admissionAuthority?.releaseId).toBe(releaseFixture(record).releaseId);
  });
  it("also binds nonterminal historical steps without requiring today's create mode", async () => {
    const record = authorizeRecordFixture(recordFixture());
    const result = await prepareUniversalLaunchWalletV1(provider(), controller, input(record, historicalCapabilities(record)), now);
    expect(result.transaction.data).toBe(record.steps[0].transaction.data);
    expect(result.admissionAuthority?.receiptHash).toBe(record.admission!.receiptHash);
  });
  it("retains historical handoff when only historical bindings are configured", async () => {
    const record = stampRecordFixture(); const capabilities = capabilitiesFixture(record);
    const onlyHistorical = { ...capabilities, manifestDigest: changedDigest, availability: { ...capabilities.availability,
      manifestDigest: changedDigest, bindings: { ...capabilities.availability.bindings, execution: { stamp: null }, receiptIssuer: null } } };
    expect((await prepareUniversalLaunchWalletV1(provider(), controller, input(record, onlyHistorical), now)).transaction.to).toBe(stamp);
  });
  it("checks the original permit authority's current runtime before handoff", async () => {
    const record = stampRecordFixture(); const authority = releaseFixture(record).binding.permitAuthority;
    const changed: LaunchWalletProviderV1 = { async request(call) {
      return call.method === "eth_getCode" && call.params?.[0] === authority ? "0x6002" : provider().request(call);
    } };
    await expect(prepareUniversalLaunchWalletV1(changed, controller, input(record, historicalCapabilities(record)), now)).rejects.toThrow(/target runtime changed/);
  });
  it.each(["manifest", "key ID", "issuer version", "policy"])("rejects a historical inventory with the wrong %s", async field => {
    const record = stampRecordFixture(); const capabilities = historicalCapabilities(record); const original = capabilities.availability.bindings.releases[1];
    const wrong: LaunchPlanPublicReleaseV1 = field === "manifest" ? { ...original, manifestDigest: changedDigest, binding: { ...original.binding, manifestDigest: changedDigest } }
      : field === "key ID" ? { ...original, receiptIssuer: { ...original.receiptIssuer, keyId: "other-key" } }
      : field === "issuer version" ? { ...original, issuerVersion: "c".repeat(40) }
      : { ...original, binding: { ...original.binding, policyBindingHash: changedDigest } };
    capabilities.availability.bindings.releases[1] = wrong;
    const rpc = provider();
    await expect(prepareUniversalLaunchWalletV1(rpc, controller, input(record, capabilities), now)).rejects.toThrow(/original release/);
    expect(rpc.request).not.toHaveBeenCalled();
  });
  it("never falls back to current authority when the historical entry is missing or ambiguous", async () => {
    const record = stampRecordFixture(); const capabilities = historicalCapabilities(record);
    const original = capabilities.availability.bindings.releases.pop()!;
    await expect(verifyLaunchPlanReleaseAuthorityV1(record, capabilities, milliseconds)).rejects.toThrow(/original release/);
    capabilities.availability.bindings.releases.push(original, { ...original, releaseId: changedDigest });
    await expect(verifyLaunchPlanReleaseAuthorityV1(record, capabilities, milliseconds)).rejects.toThrow(/original release/);
  });
  it("checks actual Ed25519 bytes even when a replacement key reuses the same key ID", async () => {
    const record = stampRecordFixture(); const capabilities = capabilitiesFixture(record);
    capabilities.availability.bindings.releases[0] = { ...releaseFixture(record), receiptIssuer: admissionIssuerFixture(record.admission!.issuerKeyId).public };
    const rpc = provider();
    await expect(prepareUniversalLaunchWalletV1(rpc, controller, input(record, capabilities), now)).rejects.toThrow(/signature/);
    expect(rpc.request).not.toHaveBeenCalled();
  });
  it("rejects an issuer SPKI whose public digest no longer matches", async () => {
    const record = stampRecordFixture(); const entry = releaseFixture(record);
    await expect(verifyLaunchPlanReleaseAuthorityV1(record, capabilitiesFixture(record, [{ ...entry,
      receiptIssuer: { ...entry.receiptIssuer, publicKeyDigest: changedDigest } }]), milliseconds)).rejects.toThrow(/original release/);
  });
  it.each(["principalId", "rawRequestSha256", "controller", "chainId"] as const)("checks the signed original %s against the owner resource", async field => {
    const base = stampRecordFixture();
    const record = authorizeRecordFixture(base, { [field]: field === "controller" ? component : field === "rawRequestSha256" ? changedDigest : "other" });
    await expect(verifyLaunchPlanReleaseAuthorityV1(record, capabilitiesFixture(record), milliseconds)).rejects.toThrow(/original release/);
  });
  it.each([
    { issuedAt: new Date(milliseconds - 300_000).toISOString(), expiresAt: new Date(milliseconds).toISOString() },
    { issuedAt: new Date(milliseconds + 1).toISOString(), expiresAt: new Date(milliseconds + 300_000).toISOString() },
    { issuedAt: new Date(milliseconds).toISOString(), expiresAt: new Date(milliseconds + 300_001).toISOString() },
  ])("never revives an expired or invalid receipt for a historical release", async window => {
    const record = authorizeRecordFixture(stampRecordFixture(), window);
    await expect(prepareUniversalLaunchWalletV1(provider(), controller, input(record, historicalCapabilities(record)), now)).rejects.toThrow(/time window/);
  });
  it("uses millisecond receipt boundaries without truncating the issue time", async () => {
    const record = authorizeRecordFixture(recordFixture(), { issuedAt: new Date(milliseconds + 250).toISOString(), expiresAt: new Date(milliseconds + 300_000).toISOString() });
    vi.spyOn(Date, "now").mockReturnValue(milliseconds + 500);
    try { expect((await prepareUniversalLaunchWalletV1(provider(), controller, input(record))).transaction.to).toBe(component); }
    finally { vi.restoreAllMocks(); }
  });
  it("checks admission expiry after refresh and again after current RPC verification", async () => {
    const record = authorizeRecordFixture(recordFixture(), { expiresAt: new Date(milliseconds + 1000).toISOString() });
    const clock = vi.spyOn(Date, "now").mockReturnValue(milliseconds);
    try {
      const request = input(record);
      const loadFreshResource = async () => { clock.mockReturnValue(milliseconds + 1000); return record; };
      const rpc = provider();
      await expect(prepareUniversalLaunchWalletV1(rpc, controller, { ...request, loadFreshResource })).rejects.toThrow(/time window/);
      expect(rpc.request).not.toHaveBeenCalled();
      clock.mockReturnValue(milliseconds);
      const lateRpc: LaunchWalletProviderV1 = { async request(call) {
        const result = await provider().request(call);
        if (call.method === "eth_gasPrice") clock.mockReturnValue(milliseconds + 1000);
        return result;
      } };
      await expect(prepareUniversalLaunchWalletV1(lateRpc, controller, request)).rejects.toThrow(/expired while/);
    } finally { vi.restoreAllMocks(); }
  });
  it("rejects rewritten evidence even after its digest and receipt hash are recomputed", async () => {
    const record = stampRecordFixture();
    const admissionEvidence = { ...record.admissionEvidence, compilationDigest: changedDigest };
    const { receiptHash: _receiptHash, signature, ...body } = record.admission!;
    expect(_receiptHash).toMatch(/^sha256:/);
    const changedBody = { ...body, evidenceDigest: digest("programmable.custom-launch-plan-evidence.v1", admissionEvidence) };
    const changed = { ...record, admissionEvidence, admission: { ...changedBody, signature, receiptHash: digest("programmable.custom-launch-plan-admission.v1", changedBody) } };
    const rpc = provider();
    await expect(prepareUniversalLaunchWalletV1(rpc, controller, input(changed), now)).rejects.toThrow(/signature/);
    expect(rpc.request).not.toHaveBeenCalled();
  });
  it("requires every exact ordered transaction digest to remain in the signed evidence", async () => {
    const record = authorizeRecordFixture(recordFixture());
    const changed = { ...record, steps: [bindStep({ ...record.steps[0], transaction: { ...record.steps[0].transaction, nonce: "8" } })] };
    await expect(verifyLaunchPlanReleaseAuthorityV1(changed, capabilitiesFixture(record), milliseconds)).rejects.toThrow(/original release/);
  });
  it.each(["chainId", "permitAuthority", "permitAuthorityRuntimeCodeHash", "policyBindingHash", "manifestDigest"])("requires the complete original preparation binding including %s", async field => {
    const base = stampRecordFixture(); const original = base.walletAuthorization!;
    const preparation = original.stampPreparation;
    const binding = preparation.binding as NonNullable<LaunchPlanRecordV1["admissionEvidence"]>;
    const walletAuthorization = { ...original, stampPreparation: { ...preparation, binding: { ...binding,
      [field]: field === "chainId" ? "1" : field === "permitAuthority" ? component : field === "permitAuthorityRuntimeCodeHash" ? `0x${"bb".repeat(32)}` : changedDigest } } };
    const record = authorizeRecordFixture({ ...base, walletAuthorization, admissionEvidence: { ...base.admissionEvidence, walletAuthorization } });
    await expect(prepareUniversalLaunchWalletV1(provider(), controller, input(record), now)).rejects.toThrow(/stamp/);
  });
  it("rechecks receipt authority on send and refuses a changed release or renewed receipt until reviewed again", async () => {
    const record = stampRecordFixture(); const request = input(record, historicalCapabilities(record));
    const reviewed = await prepareUniversalLaunchWalletV1(provider(), controller, request, now);
    expect((await prepareUniversalLaunchWalletV1(provider(), controller, { ...request, action: "send", reviewed }, now)).admissionAuthority).toEqual(reviewed.admissionAuthority);
    const renewed = authorizeRecordFixture(record, { issuedAt: new Date(milliseconds - 1).toISOString(), expiresAt: new Date(milliseconds + 299_999).toISOString() });
    const rpc = provider();
    await expect(prepareUniversalLaunchWalletV1(rpc, controller, { ...input(renewed), action: "send", reviewed }, now)).rejects.toThrow(/admission authority changed/);
    expect(rpc.request).not.toHaveBeenCalled();
    await expect(prepareUniversalLaunchWalletV1(provider(), controller, { ...request, action: "send" }, now)).rejects.toThrow(/admission authority changed/);
  });
});
