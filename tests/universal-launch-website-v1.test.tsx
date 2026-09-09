import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { decodeFunctionData, encodeFunctionData, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { parseLaunchProjectionV1, projectionToRobinhoodLaunch, LAUNCH_PROJECTION_FEED_V1 } from "@/lib/custom-launch/launch-projection-v1";
import { parseSnapshot, launchList, type RobinhoodSnapshot } from "@/lib/server/robinhood-index/model";
import { syncLaunchProjectionIndex } from "@/lib/server/robinhood-index/launch-projection-source";
import { prepareUniversalLaunchWalletV1, readLaunchPlanResourceV1, type LaunchWalletProviderV1 } from "@/lib/custom-launch/wallet-handoff-plan-v1";
import { prepareLaunchClaimWalletV1, type LaunchClaimReadV1 } from "@/lib/custom-launch/claim-handoff-v1";
import { readLaunchContractSetupV1 } from "@/lib/server/custom-launch/launch-contract-setup-v1";
import { canonicalBrowserSha256V2 as digest } from "@/lib/custom-launch/browser-authority-v2";
import { LaunchProjectionDetails } from "@/components/launch-projection-details";
import { CUSTOM_LAUNCH_PLAN_STAMP_ABI_V1, customLaunchPlanStampComponentsHashV1, customLaunchPlanStampMarketsHashV1,
  customLaunchPlanStampPermitDigestV1, customLaunchPlanStampHashV1, type CustomLaunchPlanStampPermitV1,
  type CustomLaunchPlanStampComponentV1, type CustomLaunchPlanStampMarketV1 } from "@/lib/custom-launch/stamp-plan-codec-v1";
import { controller, component, stamp, hash, runtime, runtimeHash, now, nowIso, projectionFixture, recordFixture, bindStep } from "./fixtures/universal-launch-v1";
import { authorizeRecordFixture, capabilitiesFixture, stampRecordFixture } from "./fixtures/launch-plan-admission-v1";

function provider(overrides: Record<string, unknown> = {}): LaunchWalletProviderV1 {
  return { request: vi.fn(async ({ method, params }) => {
    if (Object.hasOwn(overrides, method)) return overrides[method];
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_accounts") return [controller];
    if (method === "eth_getCode") return String(params?.[0]).toLowerCase() === controller ? "0x" : runtime;
    if (method === "eth_getTransactionCount") return "0x7";
    if (method === "eth_gasPrice") return "0x2";
    if (method === "eth_estimateGas") return "0xc350";
    if (method === "eth_call") return `0x${"0".repeat(63)}1`;
    throw new Error(`Unexpected provider read ${method}`);
  }) };
}
const snapshot = (): RobinhoodSnapshot => ({ version: 1, chainId: 4663, routerAddress: stamp, binding: hash,
  startBlock: "1", cursor: { number: "42", hash }, checkpoints: [{ number: "42", hash }], finalizedBlock: "42", updatedAt: nowIso, items: [] });
const claim = (): LaunchClaimReadV1 => ({ launchId: "external-accrual", name: null, status: "ready", claimableRaw: "1", blockNumber: "42",
  descriptor: { claimId: "fees", chainId: "4663", asset: component, accrualContract: stamp, requiredController: controller, beneficiary: controller,
    immutableRecipient: controller, runtimeCodeHash: runtimeHash, read: { data: "0xabcdef01", resultType: "uint256" },
    claim: { data: "0xabcdef02", value: "0" }, proof: { kind: "chain_read", ref: "fixture:bound", details: { fixture: true } } } });


describe("additive universal launch projection", () => {
  it("retains no-market, neutral metadata and independent provider states", () => {
    const value = projectionFixture();
    const row = projectionToRobinhoodLaunch(parseLaunchProjectionV1(value));
    expect(row).toMatchObject({ tokenAddress: component, primaryAssetAddress: null, poolId: null, name: null, symbol: null, creator: controller });
    const html = renderToStaticMarkup(<LaunchProjectionDetails projection={value} />);
    expect(html).toContain("No market is declared");
    expect(html).toContain("Uniswap Labs routing");
    expect(html).toContain("No additional assurance claims");
    expect(html).not.toMatch(/safe|tax.free|immutable fee/i);
  });
  it("accepts bound external accrual and same-address token-hook components without catalog rules", () => {
    const base = projectionFixture();
    expect(parseLaunchProjectionV1({ ...base, claimDescriptors: [claim().descriptor] }).claimDescriptors).toHaveLength(1);
    const sharedComponentAddress = "0xD9320Af2762e711918358422594684756AD760CC";
    const multiRole = parseLaunchProjectionV1({ ...base, sourceVersion: "multi_role_v2", manifestDigest: null, planHash: null,
      primaryComponentId: "shared", components: [{ ...base.components[0], componentId: "shared", expectedAddress: sharedComponentAddress }] });
    expect(projectionToRobinhoodLaunch(multiRole).tokenAddress).toBe(sharedComponentAddress);
    expect(() => parseLaunchProjectionV1({ ...base, claimDescriptors: [{ ...claim().descriptor, chainId: "1" }] })).toThrow(/chain/);
  });
  it("stores feed rows in the existing snapshot while preserving previous lane bytes", async () => {
    let saved = snapshot(); const original = JSON.stringify(saved); const verified = vi.fn().mockResolvedValue({ launchedAt: nowIso });
    const store = { read: async () => ({ snapshot: saved, etag: "v1" }), write: vi.fn(async (next: RobinhoodSnapshot, etag: string | null) => { expect(etag).toBe("v1"); saved = next; }) };
    await syncLaunchProjectionIndex({ page: async () => ({ launches: [projectionFixture()], nextCursor: null }), verify: verified }, store, () => Number(now) * 1000);
    expect(verified).toHaveBeenCalledOnce();
    expect(saved.launchProjections?.sourceUrl).toBe(LAUNCH_PROJECTION_FEED_V1);
    const { launchProjections: _lane, ...legacy } = saved;
    expect(_lane).toBeDefined();
    expect(JSON.stringify(legacy)).toBe(original);
    expect(launchList(parseSnapshot(saved), 1, "", Number(now) * 1000).items).toHaveLength(1);
    const before = JSON.stringify(saved);
    await expect(syncLaunchProjectionIndex({ page: async () => ({ launches: [{ ...projectionFixture(), sourceVerification: "partial" }], nextCursor: null }),
      verify: async () => { throw new Error("provider unavailable"); } }, store)).rejects.toThrow(/provider/);
    expect(JSON.stringify(saved)).toBe(before);
  });
});

describe("exact wallet transaction review", () => {
  const input = () => { const record = authorizeRecordFixture(recordFixture()); return { sourceVersion: "custom_launch_plan_v1" as const, reviewedResource: record, stepId: "configure", action: "review" as const,
    loadFreshResource: async () => record, loadFreshCapabilities: async () => capabilitiesFixture(record) }; };
  it("reviews unfamiliar exact calls and preserves the effects and maximum cost", async () => {
    const review = await prepareUniversalLaunchWalletV1(provider(), controller, input(), now);
    expect(review.transaction).toMatchObject({ from: controller, to: component, chainId: "0x1237", data: "0x12345678", value: "0x0", nonce: "0x7" });
    expect(review.maxGasCostWei).toBe("200000"); expect(review.postconditions).toHaveLength(1);
  });
  it.each([ ["eth_chainId", "0x1"], ["eth_accounts", [component]], ["eth_getCode", "0x6002"], ["eth_getTransactionCount", "0x8"], ["eth_estimateGas", "0xfffff"] ])("rejects changed provider binding %s", async (method, value) => {
    await expect(prepareUniversalLaunchWalletV1(provider({ [String(method)]: value }), controller, input(), now)).rejects.toThrow();
  });
  it("rejects a changed exact call even when the step digest is recomputed", async () => {
    const request = input(); const original = recordFixture();
    const changed = { ...original, steps: [bindStep({ ...original.steps[0], transaction: { ...original.steps[0].transaction, value: "1" } })] };
    await expect(prepareUniversalLaunchWalletV1(provider(), controller, { ...request, loadFreshResource: async () => changed }, now)).rejects.toThrow();
    expect(() => readLaunchPlanResourceV1({ ...original, plan: { ...original.plan, controller: { address: component, kind: "eoa" } } })).toThrow();
  });
  it("refuses a selector-only stamp without source-bound preparation", async () => {
    const base = recordFixture(); const step = bindStep({ ...base.steps[0], stepId: "stamp", actionIds: ["platform:stampPlanV1"],
      transaction: { ...base.steps[0].transaction, to: stamp, data: "0xbda52856" }, postconditions: [] });
    const record = authorizeRecordFixture({ ...base, steps: [step] });
    await expect(prepareUniversalLaunchWalletV1(provider(), controller, { ...input(), reviewedResource: record, stepId: "stamp", loadFreshResource: async () => record,
      loadFreshCapabilities: async () => capabilitiesFixture(record) }, now)).rejects.toThrow();
  });
  it("binds a complete stamp to every plan and controller-prefix root", async () => {
    const record = stampRecordFixture();
    const request = { sourceVersion: "custom_launch_plan_v1" as const, reviewedResource: record, stepId: "stamp", action: "review" as const,
      loadFreshResource: async () => record, loadFreshCapabilities: async () => capabilitiesFixture(record) };
    expect((await prepareUniversalLaunchWalletV1(provider(), controller, request, now)).decodedOperation).toMatchObject({ functionName: "stampPlanV1" });
    const last = record.steps[1];
    const decoded = decodeFunctionData({ abi: CUSTOM_LAUNCH_PLAN_STAMP_ABI_V1, data: last.transaction.data });
    const data = encodeFunctionData({ abi: CUSTOM_LAUNCH_PLAN_STAMP_ABI_V1, functionName: "stampPlanV1",
      args: [{ ...decoded.args[0], effectsHash: hash }, decoded.args[1], decoded.args[2], decoded.args[3]] });
    const changed = authorizeRecordFixture({ ...record, steps: [record.steps[0], bindStep({ ...last, transaction: { ...last.transaction, data } })] });
    await expect(prepareUniversalLaunchWalletV1(provider(), controller, { ...request, reviewedResource: changed, loadFreshResource: async () => changed }, now)).rejects.toThrow(/stamp/);
    await expect(prepareUniversalLaunchWalletV1(provider(), controller, { ...request, loadFreshResource: async () => ({ ...record, admissionEvidence: { forged: true } }) }, now)).rejects.toThrow();
  });
  it("reproduces the Solidity stamp wire vector exactly", () => {
    const vector = JSON.parse(readFileSync(new URL("./fixtures/launch-plan-stamp-v1-vector.json", import.meta.url), "utf8")) as {
      permit: CustomLaunchPlanStampPermitV1; components: CustomLaunchPlanStampComponentV1[]; markets: CustomLaunchPlanStampMarketV1[]; permitDigest: Hex; stampHash: Hex; unsignedCalldata: Hex };
    expect(customLaunchPlanStampComponentsHashV1(vector.components)).toBe(vector.permit.componentsHash);
    expect(customLaunchPlanStampMarketsHashV1(vector.markets)).toBe(vector.permit.marketsHash);
    expect(customLaunchPlanStampPermitDigestV1(vector.permit)).toBe(vector.permitDigest);
    expect(customLaunchPlanStampHashV1(vector.permitDigest)).toBe(vector.stampHash);
    const decoded = decodeFunctionData({ abi: CUSTOM_LAUNCH_PLAN_STAMP_ABI_V1, data: vector.unsignedCalldata });
    expect(encodeFunctionData({ abi: CUSTOM_LAUNCH_PLAN_STAMP_ABI_V1, functionName: "stampPlanV1", args: decoded.args })).toBe(vector.unsignedCalldata);
  });
});

describe("generic claim and manifest bindings", () => {
  it("uses only the exact zero-value claim descriptor, current runtime and required controller", async () => {
    const original = claim(); const input = { action: "review" as const, claim: original, loadFreshClaim: async () => original };
    expect((await prepareLaunchClaimWalletV1(provider(), controller, input)).transaction).toMatchObject({ to: stamp, value: "0x0", data: "0xabcdef02" });
    await expect(prepareLaunchClaimWalletV1(provider(), component, input)).rejects.toThrow(/controller/);
    await expect(prepareLaunchClaimWalletV1(provider(), controller, { ...input, loadFreshClaim: async () => ({ ...original,
      descriptor: { ...original.descriptor, beneficiary: component } }) })).rejects.toThrow(/changed/);
    await expect(prepareLaunchClaimWalletV1(provider({ eth_getCode: "0x6002" }), controller, input)).rejects.toThrow(/executable/);
  });
  it("only displays setup carrying the same computed manifest digest", async () => {
    const manifest = { schemaVersion: "programmable.custom-launch-contract.v1", fixture: true };
    const manifestDigest = digest("programmable.custom-launch-contract.v1", manifest);
    const setup = { schemaVersion: "programmable.custom-launch-agent-setup.v1", requestSchemaVersion: "programmable.custom-launch-plan.v1", manifestDigest,
      text: `Manifest digest: ${manifestDigest}`, guideUrl: "/v4/chains/4663/custom-launch-contract/guide.md" };
    const fetcher = vi.fn(async (url: string | URL | Request) => Response.json(String(url).endsWith("manifest.json") ? { ...manifest, manifestDigest } : setup));
    expect((await readLaunchContractSetupV1(fetcher)).text).toBe(setup.text);
    setup.text = "stale setup";
    await expect(readLaunchContractSetupV1(fetcher)).rejects.toThrow(/digests/);
  });
});
