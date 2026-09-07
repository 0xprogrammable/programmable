import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeFunctionData, type Hex } from "viem";
import { beginModuleModeOperation, clearModuleModeOperation, moduleModeOperationPath, parseModuleModeOperation, rememberModuleModeTransactionHash } from "@/lib/module-mode-operation-store";
import { fetchModuleModeOperationRelease, recoverModuleModeOperation } from "@/lib/module-mode-operation-recovery";
import { ModuleNativeTransactionRevertedError, readModuleNativeLaunch, revalidateModuleNativeTransaction, type ModuleNativeClient, type ModuleNativeLaunchRecord, type PreparedModuleNativeLaunch, type PreparedModuleNativeManagement } from "@/lib/module-mode/native-client";
import { moduleNativeLaunchAbi, moduleNativeLaunchV2Abi } from "@/lib/module-mode/native-abi";
import { MODULE_MODE_AVAILABILITY_SCHEMA } from "@/lib/module-mode/native-catalog";
import { bindActiveModuleModeRelease, computeModuleModeReleaseDigest, MODULE_MODE_ECONOMICS_POLICY_V2 } from "@/lib/module-mode/release";
import { a, h, moduleEvidenceFixture } from "./fixtures/module-mode-evidence";

vi.mock("@/lib/module-mode/native-client", async original => ({ ...await original<typeof import("@/lib/module-mode/native-client")>(), readModuleNativeLaunch: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function harness(kind: "launch" | "manage" = "manage", v2 = false) {
  const candidate = v2 ? { ...moduleEvidenceFixture().release, sourceVersion: "module-native-v2", schemaVersion: "programmable.module-mode-source.v2", economicsPolicyId: MODULE_MODE_ECONOMICS_POLICY_V2 } : moduleEvidenceFixture().release;
  candidate.releaseDigest = computeModuleModeReleaseDigest(candidate);
  const release = bindActiveModuleModeRelease(candidate);
  const launch: ModuleNativeLaunchRecord = { launchId: h(10), launchWallet: a(90), token: a(21), poolId: h(22), recipeHash: h(23), launchKey: h(24),
    hook: release.contracts.hook.address, positionRecipient: a(25), positionTokenId: 1n, initialBuyNative: 1_000n, initialBuyTokens: 90_000n, runtime: release.contracts.runtime.address };
  const parameters = { name: "Recovery fixture", symbol: "REC", buyCreatorFeeBps: 0, sellCreatorFeeBps: 0, creatorSalt: h(26),
    metadata: { description: "Private draft description must never enter storage", website: "", image: "https://example.com/image.webp", extraData: "0x" as Hex },
    creatorWallets: [a(90)], creatorSharesBps: [10_000], modules: [], moduleFunding: [], initialBuyNative: 1_000n, minimumInitialTokenOut: 89_000n, deadline: 1_000_300n };
  const prepared = { kind, token: launch.token, account: a(90), releaseDigest: release.releaseDigest, blockNumber: 100n, expiresAt: 1_000_300n, gasEstimate: 100_000n,
    transaction: { chainId: 4663, from: a(90), to: kind === "launch" ? release.contracts.launcher.address : release.contracts.rewardLedger.address,
      data: kind === "launch" ? v2 ? encodeFunctionData({ abi: moduleNativeLaunchV2Abi, functionName: "launch", args: [{ ...parameters, expectedRecipeHash: launch.recipeHash }] })
        : encodeFunctionData({ abi: moduleNativeLaunchAbi, functionName: "launch", args: [parameters] }) : "0x12345678",
      value: kind === "launch" ? "0x3e8" : "0x0", action: kind, description: "Private draft description must never enter storage" },
    ...(kind === "launch" ? { draftId: h(27), predictedToken: launch.token, poolId: launch.poolId, recipeHash: launch.recipeHash, launchKey: launch.launchKey, quotedTokenOut: 90_000n, minimumTokenOut: 89_000n } : {}) } as PreparedModuleNativeManagement | PreparedModuleNativeLaunch;
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  let held = false;
  const runtime = { storage, now: () => 1_000_000_000, notify: vi.fn(), locks: { request: async <T>(_name: string, _options: unknown, run: (lock: object | null) => Promise<T>): Promise<T> => {
    if (held) return run(null);
    held = true; try { return await run({}); } finally { held = false; }
  } } };
  const receipt = { transactionHash: h(200), blockHash: h(201), blockNumber: 101n, from: a(90), to: prepared.transaction.to, status: "success" };
  const tx = { hash: h(200), chainId: 4663, from: a(90), to: prepared.transaction.to, input: prepared.transaction.data, value: BigInt(prepared.transaction.value), blockHash: h(201), blockNumber: 101n };
  const block = { number: 101n, hash: h(201) };
  const client = { getChainId: vi.fn(async () => 4663), waitForTransactionReceipt: vi.fn(async () => receipt), getTransaction: vi.fn(async () => tx), getBlock: vi.fn(async () => block) };
  vi.mocked(readModuleNativeLaunch).mockResolvedValue(launch);
  return { prepared, runtime, data, release, launch, receipt, tx, block, client, recover: async (hash = h(200)) => recoverModuleModeOperation({ client: client as unknown as ModuleNativeClient, release,
    operation: await beginModuleModeOperation(prepared, runtime), transactionHash: hash }) };
}

describe("durable Module Mode wallet operations", () => {
  it("survives reload using only the exact public identity and digests, without restoring wallet authority", async () => {
    const f = harness("launch"); const saved = await beginModuleModeOperation(f.prepared, f.runtime);
    const restored = parseModuleModeOperation([...f.data.values()][0], a(90));
    expect(restored).toEqual(saved); expect(restored).toMatchObject({ launch: { recipeHash: f.launch.recipeHash } });
    const raw = [...f.data.values()][0];
    for (const privateData of ["Private draft description", "image.webp", f.prepared.transaction.data, "expiresAt", "gasEstimate"]) expect(raw).not.toContain(privateData);
    await expect(revalidateModuleNativeTransaction(restored as unknown as PreparedModuleNativeLaunch, a(90))).rejects.toThrow("Unknown or replaced transaction preparation");
    expect(moduleModeOperationPath(restored)).toBe("/launch/modules");
  });

  it("blocks a second tab and never ages unknown broadcasts into permission to resend", async () => {
    const f = harness();
    const requests = await Promise.allSettled([beginModuleModeOperation(f.prepared, f.runtime), beginModuleModeOperation(f.prepared, f.runtime)]);
    expect(requests.map(result => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    await expect(beginModuleModeOperation(f.prepared, { ...f.runtime, now: () => 9_000_000_000 })).rejects.toThrow("previous Module Mode transaction");
    expect(f.data.size).toBe(1);
    // A different connected account has an independent namespace, never a substituted record.
    await expect(beginModuleModeOperation({ ...f.prepared, account: a(91), transaction: { ...f.prepared.transaction, from: a(91) } }, f.runtime)).resolves.toMatchObject({ account: a(91) });
  });

  it("retains the original unknown record when saving a returned hash fails", async () => {
    const f = harness(); const saved = await beginModuleModeOperation(f.prepared, f.runtime);
    const broken = { ...f.runtime, storage: { ...f.runtime.storage, setItem: () => { throw new Error("storage full"); } } };
    await expect(rememberModuleModeTransactionHash(saved, h(200), broken)).rejects.toThrow("storage full");
    expect(parseModuleModeOperation([...f.data.values()][0], a(90)).transactionHash).toBeNull();
    await expect(beginModuleModeOperation(f.prepared, f.runtime)).rejects.toThrow("previous Module Mode transaction");
  });

  it("refuses unsupported, corrupt, account-substituted or changed payload records", async () => {
    const f = harness(); const saved = await beginModuleModeOperation(f.prepared, f.runtime);
    for (const change of [{ version: 2 }, { chainId: 1 }, { target: a(100) }, { value: "2" }, { calldataHash: h(400) }, { releaseDigest: h(500) }, { extra: "secret" }]) {
      expect(() => parseModuleModeOperation(JSON.stringify({ ...saved, ...change }), a(90))).toThrow();
    }
    expect(() => parseModuleModeOperation(JSON.stringify(saved), a(91))).toThrow("different wallet");
    f.data.set([...f.data.keys()][0], "corrupt");
    await expect(beginModuleModeOperation(f.prepared, f.runtime)).rejects.toThrow("previous Module Mode transaction");
    await expect(clearModuleModeOperation(saved, f.runtime)).rejects.toThrow();
    expect([...f.data.values()]).toEqual(["corrupt"]);
  });

  it("clears only the exact resolved record and preserves a later operation", async () => {
    const f = harness(); const first = await beginModuleModeOperation(f.prepared, f.runtime);
    expect((await rememberModuleModeTransactionHash(first, h(200), f.runtime)).transactionHash).toBe(h(200));
    await clearModuleModeOperation(first, f.runtime);
    const next = await beginModuleModeOperation(f.prepared, { ...f.runtime, now: () => 1_000_000_001 });
    await clearModuleModeOperation(first, f.runtime);
    expect(parseModuleModeOperation([...f.data.values()][0], a(90)).id).toBe(next.id);
    expect(moduleModeOperationPath(next)).toBe(`/launch/modules/manage/${f.launch.token}`);
  });

  it("serializes hash updates and cleanup with begin so another tab cannot delete or overwrite a newer record", async () => {
    const f = harness(); const saved = await beginModuleModeOperation(f.prepared, f.runtime);
    let release!: () => void; let entered!: () => void; let held = false; let pause = true;
    const waiting = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
    const names: string[] = [];
    const lockedRuntime = { ...f.runtime, locks: { request: async <T>(name: string, _options: unknown, callback: (lock: object | null) => Promise<T>): Promise<T> => {
      names.push(name); if (held) return callback(null); held = true;
      try { if (pause) { pause = false; entered(); await waiting; } return await callback({}); } finally { held = false; }
    } } };
    const clearing = clearModuleModeOperation(saved, lockedRuntime); await started;
    expect(f.data.size).toBe(1);
    await expect(rememberModuleModeTransactionHash(saved, h(200), lockedRuntime)).rejects.toThrow("busy in another tab");
    await expect(clearModuleModeOperation(saved, lockedRuntime)).rejects.toThrow("busy in another tab");
    await expect(beginModuleModeOperation(f.prepared, lockedRuntime)).rejects.toThrow("previous Module Mode transaction");
    expect(new Set(names).size).toBe(1); release(); await clearing;
    const next = await beginModuleModeOperation(f.prepared, { ...lockedRuntime, now: () => 1_000_000_001 });
    await clearModuleModeOperation(saved, lockedRuntime);
    await expect(rememberModuleModeTransactionHash(saved, h(200), lockedRuntime)).rejects.toThrow("record changed");
    expect(parseModuleModeOperation([...f.data.values()][0], a(90)).id).toBe(next.id);
  });
});

describe("read-only Module Mode operation recovery", () => {
  it.each([false, true])("recovers the original launch using its exact generation (V2=%s) without claiming finality or indexing", async v2 => {
    const f = harness("launch", v2);
    await expect(f.recover()).resolves.toMatchObject({ kind: "launch", token: f.launch.token, status: "mined", finalized: false, indexed: false });
    expect(readModuleNativeLaunch).toHaveBeenLastCalledWith({ client: f.client, release: f.release, token: f.launch.token, blockNumber: 101n });
    expect(f.client.getBlock).toHaveBeenCalledTimes(2);
  });

  it("recovers management without treating a storage object as a signing preparation", async () => {
    const f = harness(); await expect(f.recover()).resolves.toMatchObject({ kind: "manage", transactionHash: h(200), token: f.launch.token });
  });

  it.each(["hash", "sender", "target", "chain", "payload", "value", "block", "earlier receipt", "receipt sender", "receipt target"])("rejects a substituted %s", async field => {
    const f = harness();
    if (field === "hash") f.tx.hash = h(900);
    if (field === "sender") f.tx.from = a(900);
    if (field === "target") f.tx.to = a(900);
    if (field === "chain") f.tx.chainId = 1;
    if (field === "payload") f.tx.input = "0xabcdef00";
    if (field === "value") f.tx.value = 1n;
    if (field === "block") f.block.hash = h(900);
    if (field === "earlier receipt") f.block.number = f.tx.blockNumber = f.receipt.blockNumber = 100n;
    if (field === "receipt sender") f.receipt.from = a(900);
    if (field === "receipt target") f.receipt.to = a(900);
    await expect(f.recover()).rejects.toThrow("does not match");
  });

  it("keeps an RPC timeout unresolved and distinguishes an exact reverted transaction", async () => {
    const unavailable = harness(); unavailable.client.waitForTransactionReceipt.mockRejectedValue(new Error("RPC timeout"));
    await expect(unavailable.recover()).rejects.toThrow("RPC timeout"); expect(unavailable.data.size).toBe(1);
    const reverted = harness(); reverted.receipt.status = "reverted";
    await expect(reverted.recover()).rejects.toBeInstanceOf(ModuleNativeTransactionRevertedError);
    // Recovery reports evidence; callers explicitly clear after observing the bound outcome.
    expect(reverted.data.size).toBe(1);
  });

  it("rejects an incompatible revision, a changed initial buy and a reorg during readback", async () => {
    const revision = harness("launch"); revision.launch.recipeHash = h(999);
    await expect(revision.recover()).rejects.toThrow("module revision");
    const buy = harness("launch"); buy.launch.initialBuyTokens = 88_000n;
    await expect(buy.recover()).rejects.toThrow("initial buy");
    const reorg = harness(); reorg.client.getBlock.mockResolvedValueOnce(reorg.block).mockResolvedValueOnce({ ...reorg.block, hash: h(999) });
    await expect(reorg.recover()).rejects.toThrow("canonical block after verification");
  });

  it("resolves only the original release through normal API authority", async () => {
    const f = harness(); const fetcher = vi.fn().mockImplementation(async () => Response.json({ schemaVersion: MODULE_MODE_AVAILABILITY_SCHEMA, release: f.release, catalog: [], reason: null }));
    vi.stubGlobal("fetch", fetcher);
    await expect(fetchModuleModeOperationRelease(f.release.releaseDigest)).resolves.toEqual(f.release);
    expect(fetcher).toHaveBeenCalledWith(`/api/module-mode?releaseDigest=${f.release.releaseDigest}`, expect.objectContaining({ credentials: "same-origin", redirect: "error", cache: "no-store" }));
    await expect(fetchModuleModeOperationRelease(h(999))).rejects.toThrow("original launch version");
    fetcher.mockResolvedValue(Response.json({ error: "unavailable" }, { status: 503 }));
    await expect(fetchModuleModeOperationRelease(f.release.releaseDigest)).rejects.toThrow("could not be verified");
  });
});
