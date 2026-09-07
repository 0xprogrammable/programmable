import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeFunctionData, erc20Abi, getAddress, keccak256, type Hex } from "viem";
import { moduleEngineHostAbi, moduleEnginePlanParameters } from "@/lib/module-engine/abi";
import { bindActiveModuleEngineRelease, computeModuleEngineReleaseDigest, ENGINE_ZERO_ADDRESS, ENGINE_ZERO_HASH, MODULE_ENGINE_AVAILABILITY_SCHEMA, MODULE_ENGINE_PROFILE, MODULE_ENGINE_RELEASE_SCHEMA, type ModuleEngineRelease } from "@/lib/module-engine/catalog";
import { ENGINE_OPERATIONS, ModuleEngineTransactionRevertedError, readModuleEngineLaunch, verifyModuleEngineApprovalReceipt, verifyModuleEngineClaimReceipt, verifyModuleEngineLaunchReceipt, verifyModuleEngineOperationReceipt, type ModuleEngineClient, type ModuleEngineLaunchRecord, type ModuleEngineReceiptResult, type PreparedModuleEngineTransaction } from "@/lib/module-engine/client";
import { beginModuleModeOperation } from "@/lib/module-mode-operation-store";
import { fetchModuleEngineOperationRelease, recoverModuleEngineOperation, recoverModuleModeOperation } from "@/lib/module-mode-operation-recovery";
import { bindActiveModuleModeRelease, MODULE_MODE_ECONOMICS_POLICY_V2, MODULE_MODE_FINALITY_POLICY } from "@/lib/module-mode/release";
import { MODULE_MODE_AVAILABILITY_SCHEMA } from "@/lib/module-mode/native-catalog";
import { managementCoreAbi } from "@/lib/module-mode/management";
import { a, h, moduleEvidenceFixture } from "./fixtures/module-mode-evidence";

vi.mock("@/lib/module-engine/client", async original => ({ ...await original<typeof import("@/lib/module-engine/client")>(), readModuleEngineLaunch: vi.fn(), verifyModuleEngineApprovalReceipt: vi.fn(), verifyModuleEngineClaimReceipt: vi.fn(), verifyModuleEngineLaunchReceipt: vi.fn(), verifyModuleEngineOperationReceipt: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
beforeEach(() => { for (const method of [readModuleEngineLaunch, verifyModuleEngineApprovalReceipt, verifyModuleEngineClaimReceipt, verifyModuleEngineLaunchReceipt, verifyModuleEngineOperationReceipt]) vi.mocked(method).mockReset(); });

function engineRelease() {
  const release: ModuleEngineRelease = { schemaVersion: MODULE_ENGINE_RELEASE_SCHEMA, sourceVersion: "module-engine-v1", engineProfile: MODULE_ENGINE_PROFILE, chainId: 4663,
    sourceCommit: "ab".repeat(20), startBlock: "1", tokenCreationCodeHash: h(1), tokenRuntimeCodeHash: h(2), economicsPolicyId: MODULE_MODE_ECONOMICS_POLICY_V2,
    finalityPolicy: MODULE_MODE_FINALITY_POLICY, releaseDigest: h(3), enabled: true, status: "active", deploymentEvidenceDigest: h(4), sourceVerificationDigest: h(5), lifecycleEvidenceDigest: h(6),
    contracts: { host: { address: a(70), runtimeCodeHash: h(70) }, registry: { address: a(71), runtimeCodeHash: h(71) }, tokenFactory: { address: a(72), runtimeCodeHash: h(72) },
      launchPolicy: { address: a(73), runtimeCodeHash: h(73) }, ledger: { address: a(74), runtimeCodeHash: h(74) }, poolManager: { address: a(75), runtimeCodeHash: h(75) } } };
  release.releaseDigest = computeModuleEngineReleaseDigest(release); return bindActiveModuleEngineRelease(release);
}

function harness(kind: "launch" | "execute" | "approve" | "claim" = "execute", operationId: Hex = ENGINE_OPERATIONS.deposit) {
  const release = engineRelease(), account = a(90), token = a(21), host = release.contracts.host.address;
  const operation = { operationId, actor: account, recipient: a(91), inputAsset: a(92), inputAmount: 100n, outputAsset: a(92), minimumOutput: 90n, deadline: 1_000_300n, nonce: 3n, data: "0xdeadbeef" as Hex };
  const parameters = { name: "Engine recovery", symbol: "REC", creatorSalt: h(26), revisionId: h(11), quoteAsset: a(92), configuration: "0x12" as Hex,
    creationCode: "0x6000" as Hex, runtimeTemplate: "0x6001" as Hex, engineSalt: h(27), launchData: "0x1234" as Hex,
    metadata: { description: "Private launch description", website: "", image: "https://example.com/image.webp", extraData: "0x" as Hex }, creatorWallets: [account], creatorSharesBps: [10_000], buyCreatorFeeBps: 0, sellCreatorFeeBps: 0,
    initialOperation: { operationId: ENGINE_ZERO_HASH, actor: ENGINE_ZERO_ADDRESS, recipient: ENGINE_ZERO_ADDRESS, inputAsset: ENGINE_ZERO_ADDRESS, inputAmount: 0n, outputAsset: ENGINE_ZERO_ADDRESS, minimumOutput: 0n, deadline: 0n, nonce: 0n, data: "0x" as Hex } };
  const launch: ModuleEngineLaunchRecord = { launchId: h(10), revisionId: h(11), planHash: keccak256(encodeAbiParameters(moduleEnginePlanParameters, [4663n, host, account, parameters])),
    creator: account, token, quoteAsset: a(92), engine: a(93), engineCodeHash: h(94), constructorHash: h(95), initCodeHash: h(96), configurationHash: h(97), resourcesHash: h(98), buyCreatorFeeBps: 0, sellCreatorFeeBps: 0 };
  const data = kind === "launch" ? encodeFunctionData({ abi: moduleEngineHostAbi, functionName: "launch", args: [parameters] })
    : kind === "execute" ? encodeFunctionData({ abi: moduleEngineHostAbi, functionName: "execute", args: [launch.launchId, operation] })
      : kind === "approve" ? encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [host, 100n] })
        : encodeFunctionData({ abi: managementCoreAbi, functionName: "claimTo", args: [a(91)] });
  const prepared = { sourceKind: "module-engine-v1", kind, account, releaseDigest: release.releaseDigest, blockNumber: 100n, expiresAt: 1_000_300n, gasEstimate: 100_000n,
    transaction: { chainId: 4663, from: account, to: kind === "approve" ? token : kind === "claim" ? release.contracts.ledger.address : host, data, value: "0x0", action: kind === "execute" || kind === "claim" ? "manage" : kind, description: "Private description" },
    token, predictedToken: token, launchId: launch.launchId, revisionId: launch.revisionId, planHash: launch.planHash, operation, spender: host, amount: 100n,
    recipient: a(91), minimumAmount: 100n, claimedBefore: 200n } as PreparedModuleEngineTransaction;
  const storage = new Map<string, string>(); const runtime = { now: () => 1_000_000_000, notify: vi.fn(), storage: { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } }, locks: { request: async <T>(_name: string, _options: unknown, callback: (lock: object | null) => Promise<T>) => callback({}) } };
  const receipt = { transactionHash: h(200), blockHash: h(201), blockNumber: 101n, from: account, to: prepared.transaction.to, status: "success" };
  const tx = { hash: h(200), chainId: 4663, from: account, to: prepared.transaction.to, input: data, value: 0n, blockHash: h(201), blockNumber: 101n };
  const block = { number: 101n, hash: h(201) };
  const client = { getChainId: vi.fn(async () => 4663), waitForTransactionReceipt: vi.fn(async () => receipt), getTransaction: vi.fn(async () => tx), getBlock: vi.fn(async () => block) };
  const result: ModuleEngineReceiptResult = { sourceKind: "module-engine-v1", status: "mined", finalized: false, indexed: false, kind, token, transactionHash: h(200), blockNumber: 101n, blockHash: h(201), ...(kind === "approve" ? {} : { launch }), ...(kind === "execute" ? { outputAmount: 100n } : {}) };
  vi.mocked(readModuleEngineLaunch).mockResolvedValue(launch); vi.mocked(verifyModuleEngineLaunchReceipt).mockResolvedValue(result); vi.mocked(verifyModuleEngineOperationReceipt).mockResolvedValue(result); vi.mocked(verifyModuleEngineApprovalReceipt).mockResolvedValue(result);
  vi.mocked(verifyModuleEngineClaimReceipt).mockResolvedValue(result);
  return { release, prepared, launch, operation, parameters, client, receipt, tx, block, storage, runtime,
    recover: async () => recoverModuleEngineOperation({ client: client as unknown as ModuleEngineClient, operation: await beginModuleModeOperation(prepared, runtime), release, transactionHash: h(200) }) };
}

describe("exact engine recovery", () => {
  it.each(["launch", "execute", "approve", "claim"] as const)("recovers %s using its concrete client receipt verifier and never claims finality", async kind => {
    const f = harness(kind); await expect(f.recover()).resolves.toMatchObject({ sourceKind: "module-engine-v1", status: "mined", kind, finalized: false, indexed: false });
    expect(f.storage.size).toBe(1); expect(f.client.getBlock).toHaveBeenCalledTimes(2);
    if (kind === "launch") expect(verifyModuleEngineLaunchReceipt).toHaveBeenCalledWith({ client: f.client, release: f.release, expected: f.launch, receipt: f.receipt });
    if (kind === "execute") expect(verifyModuleEngineOperationReceipt).toHaveBeenCalledWith({ client: f.client, release: f.release, launch: f.launch,
      operation: { ...f.operation, actor: getAddress(f.operation.actor), recipient: getAddress(f.operation.recipient), inputAsset: getAddress(f.operation.inputAsset), outputAsset: getAddress(f.operation.outputAsset) }, receipt: f.receipt });
    if (kind === "approve") { expect(readModuleEngineLaunch).not.toHaveBeenCalled(); expect(verifyModuleEngineApprovalReceipt).toHaveBeenCalledWith({ client: f.client, release: f.release, account: a(90), token: a(21), amount: 100n, receipt: f.receipt }); }
    if (kind === "claim") expect(verifyModuleEngineClaimReceipt).toHaveBeenCalledWith({ client: f.client, release: f.release, launch: f.launch, account: a(90), recipient: a(91), minimumAmount: 100n, claimedBefore: 200n, receipt: f.receipt });
  });

  it.each(["deposit", "withdraw", "request", "fulfill", "refund"] as const)("keeps %s bound to its real operation ID and consumed nonce", async action => {
    const f = harness("execute", ENGINE_OPERATIONS[action]); await f.recover();
    expect(verifyModuleEngineOperationReceipt).toHaveBeenCalledWith(expect.objectContaining({ operation: expect.objectContaining({ operationId: ENGINE_OPERATIONS[action], nonce: 3n, data: "0xdeadbeef" }) }));
    expect([...f.storage.values()][0]).not.toContain("0xdeadbeef");
  });

  it.each(["hash", "sender", "receipt sender", "target", "receipt target", "chain", "payload", "value", "block", "earlier receipt"])("rejects a substituted engine %s", async field => {
    const f = harness();
    if (field === "hash") f.tx.hash = h(999); if (field === "sender") f.tx.from = a(999); if (field === "receipt sender") f.receipt.from = a(999);
    if (field === "target") f.tx.to = a(999); if (field === "receipt target") f.receipt.to = a(999); if (field === "chain") f.tx.chainId = 1;
    if (field === "payload") f.tx.input = "0x12345678"; if (field === "value") f.tx.value = 1n; if (field === "block") f.block.hash = h(999);
    if (field === "earlier receipt") f.tx.blockNumber = f.receipt.blockNumber = f.block.number = 100n;
    await expect(f.recover()).rejects.toThrow("does not match"); expect(verifyModuleEngineOperationReceipt).not.toHaveBeenCalled(); expect(f.storage.size).toBe(1);
  });

  it.each(["launchId", "revisionId", "planHash"] as const)("rejects a readback with a different %s", async field => {
    const f = harness(); f.launch[field] = h(999); await expect(f.recover()).rejects.toThrow("launch identity and revision");
  });

  it("rejects a changed operation nonce, approval spender, claim recipient or protocol target before receipt verification", async () => {
    const execution = harness(); execution.operation.nonce = 4n; await expect(execution.recover()).rejects.toThrow("identity and nonce");
    const approval = harness("approve"); Object.assign(approval.prepared, { spender: a(99) }); await expect(approval.recover()).rejects.toThrow("bounded engine spender");
    const claim = harness("claim"); Object.assign(claim.prepared, { recipient: a(99) }); await expect(claim.recover()).rejects.toThrow("claim recipient");
    const target = harness(); Object.assign(target.prepared.transaction, { to: a(99) }); target.tx.to = target.receipt.to = a(99);
    await expect(target.recover()).rejects.toThrow("engine release contract");
    expect(verifyModuleEngineClaimReceipt).not.toHaveBeenCalled(); expect(verifyModuleEngineOperationReceipt).not.toHaveBeenCalled();
  });

  it("rejects cross-protocol recovery and an unavailable historical authority without falling back", async () => {
    const f = harness(); const saved = await beginModuleModeOperation(f.prepared, f.runtime);
    await expect(recoverModuleModeOperation({ client: f.client as unknown as ModuleEngineClient, operation: saved, release: bindActiveModuleModeRelease(moduleEvidenceFixture().release), transactionHash: h(200) })).rejects.toThrow("native source");
    const otherRelease = engineRelease(); otherRelease.sourceCommit = "ac".repeat(20); otherRelease.releaseDigest = computeModuleEngineReleaseDigest(otherRelease);
    await expect(recoverModuleEngineOperation({ client: f.client as unknown as ModuleEngineClient, operation: saved, release: otherRelease, transactionHash: h(200) })).rejects.toThrow("release version");
    expect(f.client.waitForTransactionReceipt).not.toHaveBeenCalled();
  });

  it("distinguishes exact reversions from unavailable or reorganized receipt evidence", async () => {
    const reverted = harness(); reverted.receipt.status = "reverted"; await expect(reverted.recover()).rejects.toBeInstanceOf(ModuleEngineTransactionRevertedError); expect(reverted.storage.size).toBe(1);
    const timeout = harness(); timeout.client.waitForTransactionReceipt.mockRejectedValue(new Error("RPC unavailable")); await expect(timeout.recover()).rejects.toThrow("RPC unavailable"); expect(timeout.storage.size).toBe(1);
    const reorg = harness(); reorg.client.getBlock.mockResolvedValueOnce(reorg.block).mockResolvedValueOnce({ ...reorg.block, hash: h(999) }); await expect(reorg.recover()).rejects.toThrow("canonical block after verification");
  });

  it("does not turn failed engine event or bounded allowance verification into a confirmation", async () => {
    const execution = harness(); vi.mocked(verifyModuleEngineOperationReceipt).mockRejectedValue(new Error("Operation nonce was not consumed")); await expect(execution.recover()).rejects.toThrow("nonce was not consumed");
    const approval = harness("approve"); vi.mocked(verifyModuleEngineApprovalReceipt).mockRejectedValue(new Error("Exact bounded approval is not visible")); await expect(approval.recover()).rejects.toThrow("bounded approval");
    expect(approval.storage.size).toBe(1);
  });

  it("resolves only the exact engine authority response and rejects a native response", async () => {
    const release = engineRelease(); const fetcher = vi.fn().mockImplementation(async () => Response.json({ schemaVersion: MODULE_ENGINE_AVAILABILITY_SCHEMA, release, templates: [], reason: null })); vi.stubGlobal("fetch", fetcher);
    await expect(fetchModuleEngineOperationRelease(release.releaseDigest)).resolves.toEqual(release);
    expect(fetcher).toHaveBeenCalledWith(`/api/module-mode?sourceKind=module-engine-v1&releaseDigest=${release.releaseDigest}`, expect.objectContaining({ cache: "no-store", credentials: "same-origin", redirect: "error" }));
    await expect(fetchModuleEngineOperationRelease(h(999))).rejects.toThrow("original engine version");
    fetcher.mockResolvedValue(Response.json({ schemaVersion: MODULE_MODE_AVAILABILITY_SCHEMA, release: bindActiveModuleModeRelease(moduleEvidenceFixture().release), catalog: [], reason: null }));
    await expect(fetchModuleEngineOperationRelease(release.releaseDigest)).rejects.toThrow();
    fetcher.mockResolvedValue(Response.json({ error: "unavailable" }, { status: 503 })); await expect(fetchModuleEngineOperationRelease(release.releaseDigest)).rejects.toThrow("could not be verified");
  });
});
