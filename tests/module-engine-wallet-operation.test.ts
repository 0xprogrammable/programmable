import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreparedModuleEngineOperation, PreparedModuleEngineTransaction } from "@/lib/module-engine/client";
import type { PreparedModuleNativeManagement } from "@/lib/module-mode/native-client";
import { revalidateModuleEngineTransaction } from "@/lib/module-engine/client";
import { revalidateModuleNativeTransaction } from "@/lib/module-mode/native-client";
import { beginModuleModeOperation, clearModuleModeOperation, moduleModeOperationPath, parseModuleModeOperation } from "@/lib/module-mode-operation-store";
import { revalidateModuleModeTransaction, submitModuleModeOperation, type PreparedModuleModeTransaction } from "@/components/module-mode-wallet-state";
import { a, h } from "./fixtures/module-mode-evidence";

vi.mock("@/lib/module-engine/client", async original => ({ ...await original<typeof import("@/lib/module-engine/client")>(), revalidateModuleEngineTransaction: vi.fn() }));
vi.mock("@/lib/module-mode/native-client", async original => ({ ...await original<typeof import("@/lib/module-mode/native-client")>(), revalidateModuleNativeTransaction: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
beforeEach(() => { vi.mocked(revalidateModuleEngineTransaction).mockReset(); vi.mocked(revalidateModuleNativeTransaction).mockReset(); });

function fixture(kind: "launch" | "execute" | "approve" | "claim" = "launch") {
  const common = { sourceKind: "module-engine-v1", kind, account: a(90), releaseDigest: h(30), blockNumber: 100n, expiresAt: 1_000_300n,
    launchId: h(10), revisionId: h(11), planHash: h(12), gasEstimate: 100_000n,
    transaction: { chainId: 4663, from: a(90), to: a(80), data: "0x1234567890", value: "0x0", action: kind === "launch" ? "launch" : "manage", description: "Private operation description" } };
  const prepared = (kind === "launch" ? { ...common, predictedToken: a(21) } : kind === "execute" ? { ...common, token: a(21), operation: { operationId: h(41), nonce: 3n,
    actor: a(90), recipient: a(91), inputAsset: a(92), inputAmount: 100n, outputAsset: a(92), minimumOutput: 90n, deadline: 1_000_300n, data: "0xdeadbeef" } }
    : kind === "approve" ? { ...common, token: a(21), spender: a(80), amount: 100n }
      : { ...common, token: a(21), recipient: a(91), minimumAmount: 100n, claimedBefore: 200n }) as PreparedModuleEngineTransaction;
  const native = { kind: "manage", account: a(90), releaseDigest: h(50), blockNumber: 100n, expiresAt: 1_000_300n, token: a(22), gasEstimate: 100_000n,
    transaction: { chainId: 4663, from: a(90), to: a(81), data: "0x12345678", value: "0x0", action: "manage", description: "Native claim" } } as PreparedModuleNativeManagement;
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const held = new Set<string>();
  const runtime = { storage, now: () => 1_000_000_000, notify: vi.fn(), locks: { request: async <T>(name: string, _options: unknown, run: (lock: object | null) => Promise<T>) => {
    if (held.has(name)) return run(null); held.add(name); try { return await run({}); } finally { held.delete(name); }
  } } };
  const installBrowser = () => { vi.stubGlobal("window", Object.assign(new EventTarget(), { localStorage: storage })); vi.stubGlobal("navigator", { locks: runtime.locks }); };
  return { prepared, native, data, storage, runtime, installBrowser };
}

describe("shared durable native and engine wallet operations", () => {
  it.each(["approve", "claim"] as const)("preserves the bounded %s identity without converting it to native management", async kind => {
    const f = fixture(kind); const saved = await beginModuleModeOperation(f.prepared, f.runtime);
    const restored = parseModuleModeOperation([...f.data.values()][0], a(90)); expect(restored).toEqual(saved);
    expect(restored).toMatchObject({ sourceKind: "module-engine-v1", kind, approval: kind === "approve" ? { spender: a(80), amount: "100" } : null,
      claim: kind === "claim" ? { recipient: a(91), minimumAmount: "100", claimedBefore: "200" } : null,
      launch: kind === "approve" ? null : { launchId: h(10), revisionId: h(11), planHash: h(12) } });
    await expect(beginModuleModeOperation(f.native, f.runtime)).rejects.toThrow("previous Module Mode transaction");
  });

  it.each(["launch", "execute"] as const)("retains the exact %s engine identity after reload without private operation data", async kind => {
    const f = fixture(kind); const saved = await beginModuleModeOperation(f.prepared, f.runtime);
    const raw = [...f.data.values()][0]; const restored = parseModuleModeOperation(raw, a(90));
    expect(restored).toEqual(saved);
    expect(restored).toMatchObject({ version: 2, sourceKind: "module-engine-v1", kind, launch: { launchId: h(10), revisionId: h(11), planHash: h(12) },
      execution: kind === "execute" ? { operationId: h(41), nonce: "3" } : null });
    for (const privateValue of ["Private operation", "0xdeadbeef", f.prepared.transaction.data, "recipient", "inputAmount", "expiresAt", "gasEstimate", "recipeHash", "poolId"]) expect(raw).not.toContain(privateValue);
    expect(moduleModeOperationPath(restored)).toBe(`${kind === "launch" ? "/launch/modules" : `/launch/modules/manage/${a(21)}`}?sourceKind=module-engine-v1&releaseDigest=${h(30)}`);
  });

  it("shares one account lock and persistent unknown record across both protocols", async () => {
    const f = fixture(); const results = await Promise.allSettled([beginModuleModeOperation(f.prepared, f.runtime), beginModuleModeOperation(f.native, f.runtime)]);
    expect(results.map(result => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(f.data.size).toBe(1);
    await expect(beginModuleModeOperation(f.native, { ...f.runtime, now: () => 9_999_999_999_999 })).rejects.toThrow("previous Module Mode transaction");
    const record = parseModuleModeOperation([...f.data.values()][0], a(90)); await clearModuleModeOperation(record, f.runtime);
    const native = await beginModuleModeOperation(f.native, f.runtime);
    expect(native.version).toBe(1); expect(native).not.toHaveProperty("sourceKind");
    await expect(beginModuleModeOperation(f.prepared, f.runtime)).rejects.toThrow("previous Module Mode transaction");
  });

  it("rejects substituted source, launch, revision, plan, operation, nonce and wallet bindings", async () => {
    const f = fixture("execute"); const saved = await beginModuleModeOperation(f.prepared, f.runtime);
    for (const change of [{ sourceKind: "module-native-v2" }, { version: 1 }, { kind: "manage" }, { chainId: 1 }, { account: a(91) }, { target: a(82) },
      { launch: { ...saved.launch, launchId: h(51) } }, { launch: { ...saved.launch, revisionId: h(51) } }, { launch: { ...saved.launch, planHash: h(51) } },
      { execution: { operationId: h(51), nonce: "3" } }, { execution: { operationId: h(41), nonce: "4" } }, { privateData: "not allowed" }]) {
      expect(() => parseModuleModeOperation(JSON.stringify({ ...saved, ...change }), a(90))).toThrow();
    }
    await expect(beginModuleModeOperation({ ...f.prepared, sourceKind: "other-source" } as unknown as PreparedModuleEngineOperation, f.runtime)).rejects.toThrow("source is unsupported");
  });
});

describe("shared engine submission boundary", () => {
  it("persists before invoking the existing provider and preserves the returned hash", async () => {
    const f = fixture(); f.installBrowser();
    const send = vi.fn(async () => { expect(f.data.size).toBe(1); expect(parseModuleModeOperation([...f.data.values()][0], a(90)).transactionHash).toBeNull(); return h(200); });
    const result = await submitModuleModeOperation(f.prepared, send);
    expect(result.transactionHash).toBe(h(200)); expect(result.operation.transactionHash).toBe(h(200)); expect(send).toHaveBeenCalledWith(f.prepared);
    await expect(submitModuleModeOperation(f.native, send)).rejects.toThrow("previous Module Mode transaction"); expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps ambiguous broadcasts across reload and retains a hash when its storage write fails", async () => {
    const f = fixture(); f.installBrowser(); const timeout = Object.assign(new Error("Lost wallet response"), { walletRequestAttempted: true });
    await expect(submitModuleModeOperation(f.prepared, async () => { throw timeout; })).rejects.toBe(timeout);
    expect(parseModuleModeOperation([...f.data.values()][0], a(90))).toMatchObject({ sourceKind: "module-engine-v1", transactionHash: null });
    await expect(submitModuleModeOperation(f.native, vi.fn())).rejects.toThrow("previous Module Mode transaction");
    const next = fixture(); next.installBrowser();
    const result = await submitModuleModeOperation(next.prepared, async () => { next.storage.setItem = () => { throw new Error("Full storage"); }; return h(201); });
    expect(result.transactionHash).toBe(h(201)); expect(result.operation.transactionHash).toBeNull(); expect(next.data.size).toBe(1);
  });

  it.each([{ walletRequestAttempted: false }, { walletRequestAttempted: true, walletRequestRejected: true, code: 4001 }])("clears only a definite rejected or unattempted request: %j", async classification => {
    const f = fixture(); f.installBrowser();
    await expect(submitModuleModeOperation(f.prepared, async () => { throw Object.assign(new Error("Not sent"), classification); })).rejects.toThrow("Not sent");
    expect(f.data.size).toBe(0);
    await expect(submitModuleModeOperation(f.native, async () => h(200))).resolves.toHaveProperty("transactionHash", h(200));
  });

  it("does not invoke a wallet without storage and never clears a newer operation after a stale rejection", async () => {
    const f = fixture(); f.installBrowser(); f.storage.setItem = () => { throw new Error("Storage unavailable"); };
    const send = vi.fn(); await expect(submitModuleModeOperation(f.prepared, send)).rejects.toThrow("Storage unavailable"); expect(send).not.toHaveBeenCalled();
    const next = fixture(); next.installBrowser();
    await expect(submitModuleModeOperation(next.prepared, async () => {
      const old = parseModuleModeOperation([...next.data.values()][0], a(90)); await clearModuleModeOperation(old, next.runtime);
      await beginModuleModeOperation(next.native, next.runtime);
      throw Object.assign(new Error("Rejected old request"), { code: 4001 });
    })).rejects.toThrow("Rejected old request");
    expect(parseModuleModeOperation([...next.data.values()][0], a(90)).version).toBe(1);
  });

  it("dispatches exact source generations to their own private preparation validators", async () => {
    const f = fixture(); vi.mocked(revalidateModuleNativeTransaction).mockResolvedValue(f.native.transaction); vi.mocked(revalidateModuleEngineTransaction).mockResolvedValue(f.prepared.transaction);
    await expect(revalidateModuleModeTransaction(f.prepared, a(90))).resolves.toBe(f.prepared.transaction);
    expect(revalidateModuleEngineTransaction).toHaveBeenCalledWith(f.prepared, a(90)); expect(revalidateModuleNativeTransaction).not.toHaveBeenCalled();
    await expect(revalidateModuleModeTransaction(f.native, a(90))).resolves.toBe(f.native.transaction); expect(revalidateModuleNativeTransaction).toHaveBeenCalledWith(f.native, a(90));
    for (const invalid of [null, { ...f.prepared, sourceKind: "module-native-v2" }, { ...f.native, sourceKind: undefined }]) await expect(revalidateModuleModeTransaction(invalid as unknown as PreparedModuleModeTransaction, a(90))).rejects.toThrow();
    expect(revalidateModuleEngineTransaction).toHaveBeenCalledTimes(1); expect(revalidateModuleNativeTransaction).toHaveBeenCalledTimes(1);
  });
});
