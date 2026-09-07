import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionData, sha256, toHex, type Hex } from "viem";
import { managementCoreAbi, readModuleNativeAuthorWallets } from "@/lib/module-mode/management";
import { ModuleNativeTransactionRevertedError, revalidateModuleNativeTransaction, waitForModuleNativeReceipt, type PreparedModuleNativeManagement } from "@/lib/module-mode/native-client";
import { beginModuleModeOperation, clearModuleModeOperation, parseModuleModeOperation, rememberModuleModeTransactionHash, type ModuleModeOperation } from "@/lib/module-mode-operation-store";
import { recoverModuleModeOperation } from "@/lib/module-mode-operation-recovery";
import { nativeAuthorFixture } from "./module-native-author-fixture";
import { a, h } from "./fixtures/module-mode-evidence";

function store() {
  const items = new Map<string, string>();
  const runtime = { storage: { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); }, removeItem: (key: string) => { items.delete(key); } },
    locks: { request: async <T>(_name: string, _options: object, callback: (lock: object) => Promise<T>) => callback({}) }, now: () => 1000, notify: () => undefined };
  return { runtime, items };
}
function hinted(operation: ModuleModeOperation, changes: Record<string, unknown>) {
  const { id: _, transactionHash, ...body } = { ...operation, ...changes }; void _;
  return parseModuleModeOperation(JSON.stringify({ ...body, id: sha256(toHex(JSON.stringify(body))), transactionHash }), operation.account);
}

describe("native registered-author wallet control", () => {
  for (const v2 of [false, true]) it(`keeps exact native ${v2 ? "V2" : "V1"} source, author and family bindings through preparation, wallet and receipt`, async () => {
    const f = nativeAuthorFixture(v2), prepared = await f.prepare();
    expect(prepared.kind).toBe("manage"); expect(prepared.transaction.to).toBe(f.release.contracts.registry.address); expect(prepared.transaction.value).toBe("0x0");
    const decoded = decodeFunctionData({ abi: managementCoreAbi, data: prepared.transaction.data });
    expect(decoded.functionName).toBe("changeAuthorWallet"); expect(JSON.stringify(decoded.args).toLowerCase()).toBe(JSON.stringify([f.catalog[0].nativeBinding.familyId, f.recipient]));
    expect(prepared.authorWalletChange).toMatchObject({ author: f.actor, previousWallet: f.state.wallet, launchId: f.launch.launchId, poolId: f.launch.poolId, recipeHash: f.launch.recipeHash, launchKey: f.launch.launchKey, packageId: f.instances[0].packageId });
    expect(Object.isFrozen(prepared.authorWalletChange)).toBe(true);
    await expect(revalidateModuleNativeTransaction(prepared, f.actor)).resolves.toMatchObject({ to: f.release.contracts.registry.address });
    await expect(revalidateModuleNativeTransaction(prepared, f.actor)).rejects.toThrow("already been used");
    const { transactionHash } = f.mined(prepared);
    expect(await waitForModuleNativeReceipt({ client: f.client, prepared, transactionHash })).toMatchObject({ kind: "manage", finalized: false, indexed: false, authorWalletChange: { author: f.actor, recipient: f.recipient, previewChanged: false, subsequentlyChanged: false } });
  });
  it("refuses a reward recipient or treasury pretending to be the immutable author", async () => {
    const f = nativeAuthorFixture();
    await expect(f.prepare(undefined, f.state.wallet)).rejects.toThrow("registered family author");
    await expect(f.prepare(undefined, a(901))).rejects.toThrow("registered family author");
    expect(f.simulated).toHaveLength(0);
  });
  it("rejects zero, unchanged and unbound recipients/packages before simulation", async () => {
    const f = nativeAuthorFixture();
    for (const recipient of [a(0), f.state.wallet]) await expect(f.prepare({ kind: "rotate-author", packageId: f.instances[0].packageId, recipient })).rejects.toThrow();
    await expect(f.prepare({ kind: "rotate-author", packageId: h(999), recipient: f.recipient })).rejects.toThrow("not uniquely bound");
    expect(f.simulated).toHaveLength(0);
  });
  it("rejects an ambiguous repeated package before signing, matching receipt recovery's exact binding", async () => {
    const f = nativeAuthorFixture(); f.instances.push({ ...f.instances[0] });
    await expect(f.prepare()).rejects.toThrow("not uniquely bound"); expect(f.simulated).toHaveLength(0);
  });
  for (const flag of ["codeMismatch", "instanceMismatch", "manifestMismatch", "familyMismatch", "getterMissing", "simulationFails"] as const) it(`fails closed on ${flag}`, async () => {
    const f = nativeAuthorFixture(); f.state[flag] = true;
    await expect(f.prepare()).rejects.toThrow();
  });
  it("keeps a disabled new-launch revision's actual author control and fee claims", async () => {
    const f = nativeAuthorFixture(); f.state.enabled = false;
    await expect(f.prepare()).resolves.toMatchObject({ kind: "manage" });
    expect((await f.snapshot()).fees.claimable).toBeGreaterThan(0n);
  });
  it("shows healthy author rows when another getter is missing and never guesses from a reward wallet", async () => {
    const f = nativeAuthorFixture(); f.state.missingSecond = true;
    const result = await readModuleNativeAuthorWallets(f);
    expect(result.authors).toHaveLength(1); expect(result.unavailable).toBe(1);
    expect(result.authors[0]).toMatchObject({ author: f.actor, previousWallet: f.state.wallet });
    f.state.getterMissing = true;
    expect((await readModuleNativeAuthorWallets(f)).authors).toHaveLength(0);
    expect((await f.snapshot()).fees.claimable).toBeGreaterThan(0n);
  });
  it("does not authorize a row from local catalogue metadata when its actual family differs", async () => {
    const f = nativeAuthorFixture(); f.state.familyMismatch = true;
    expect(await readModuleNativeAuthorWallets(f)).toMatchObject({ authors: [], unavailable: 2 });
  });
  it("rejects cloned preparations, an account switch, expired preview and changed recipient before wallet use", async () => {
    const f = nativeAuthorFixture(), prepared = await f.prepare();
    await expect(revalidateModuleNativeTransaction({ ...prepared }, f.actor)).rejects.toThrow("Unknown");
    await expect(revalidateModuleNativeTransaction(prepared, a(888))).rejects.toThrow("Connected account");
    f.state.wallet = a(777);
    await expect(revalidateModuleNativeTransaction(prepared, f.actor)).rejects.toThrow("effects changed");
    const current = await f.prepare(undefined, f.actor, f.state.timestamp + 30n); f.state.timestamp += 31n;
    await expect(revalidateModuleNativeTransaction(current, f.actor)).rejects.toThrow("expired");
  });
  it("reports a different permitted previous wallet and later same-block rotation without retrying", async () => {
    const f = nativeAuthorFixture(), prepared = await f.prepare();
    const mined = f.mined(prepared, "success", a(555)); f.state.wallet = a(556);
    const result = await waitForModuleNativeReceipt({ client: f.client, prepared, transactionHash: mined.transactionHash });
    expect(result.authorWalletChange).toMatchObject({ previousWallet: a(555), recipient: f.recipient, previewChanged: true, subsequentlyChanged: true });
    expect(f.simulated).toHaveLength(1);
  });
});

describe("durable native author wallet reconciliation", () => {
  it("stores only public exact bindings, survives a reload, keeps one account lock and clears only after readback", async () => {
    const f = nativeAuthorFixture(), s = store(), prepared = await f.prepare();
    const operation = await beginModuleModeOperation(prepared, s.runtime);
    expect(operation).toMatchObject({ version: 4, kind: "manage", launch: null, transactionHash: null });
    expect(operation).not.toHaveProperty("sourceKind"); expect(JSON.stringify(operation)).not.toContain(prepared.transaction.data);
    await expect(beginModuleModeOperation(prepared, s.runtime)).rejects.toThrow("previous Module Mode transaction");
    const { transactionHash } = f.mined(prepared);
    const saved = await rememberModuleModeTransactionHash(operation, transactionHash, s.runtime);
    const reloaded = parseModuleModeOperation([...s.items.values()][0], f.actor);
    expect(reloaded).toEqual(saved);
    const result = await recoverModuleModeOperation({ client: f.client, release: f.release, operation: reloaded, transactionHash });
    expect(result.authorWalletChange?.recipient).toBe(f.recipient);
    await clearModuleModeOperation(reloaded, s.runtime); expect(s.items.size).toBe(0);
  });
  it("still reads original v1 management records and refuses to use their generic target list for a Registry call", async () => {
    const f = nativeAuthorFixture(), s = store(), prepared = await f.prepare();
    const { authorWalletChange: _, ...legacy } = prepared; void _;
    const operation = await beginModuleModeOperation(legacy as PreparedModuleNativeManagement, s.runtime);
    expect(operation.version).toBe(1); expect(parseModuleModeOperation([...s.items.values()][0], f.actor)).toEqual(operation);
    const { transactionHash } = f.mined(prepared);
    await expect(recoverModuleModeOperation({ client: f.client, release: f.release, operation, transactionHash })).rejects.toThrow("release contract");
  });
  it("rejects a recomputed storage hint with different family or launch identity after actual onchain readback", async () => {
    for (const key of ["launchId", "poolId", "recipeHash", "launchKey", "packageId"] as const) {
      const f = nativeAuthorFixture(), prepared = await f.prepare(), operation = await beginModuleModeOperation(prepared, store().runtime);
      const changed = hinted(operation, { authorWalletChange: { ...prepared.authorWalletChange, [key]: h(999) } });
      const { transactionHash } = f.mined(prepared);
      await expect(recoverModuleModeOperation({ client: f.client, release: f.release, operation: changed, transactionHash })).rejects.toThrow();
    }
  });
  it("rejects tampered bytes, another network, recipient, signer, contract or release", async () => {
    for (const field of ["input", "chainId", "from", "to", "value"] as const) {
      const f = nativeAuthorFixture(), prepared = await f.prepare(), operation = await beginModuleModeOperation(prepared, store().runtime);
      const mined = f.mined(prepared);
      Object.assign(mined.tx, { [field]: field === "input" ? "0x12345678" : field === "chainId" ? 1 : field === "value" ? 1n : a(999) });
      await expect(recoverModuleModeOperation({ client: f.client, release: f.release, operation, transactionHash: mined.transactionHash })).rejects.toThrow();
    }
    const f = nativeAuthorFixture(), prepared = await f.prepare(), operation = await beginModuleModeOperation(prepared, store().runtime), mined = f.mined(prepared);
    await expect(recoverModuleModeOperation({ client: f.client, release: f.release, operation: hinted(operation, { releaseDigest: h(999) }), transactionHash: mined.transactionHash })).rejects.toThrow("release version");
  });
  it("never expands author recovery to another Registry function, even with a self-consistent hint", async () => {
    const f = nativeAuthorFixture(), prepared = await f.prepare(), operation = await beginModuleModeOperation(prepared, store().runtime), mined = f.mined(prepared);
    for (const input of [encodeFunctionData({ abi: managementCoreAbi, functionName: "claimTo", args: [f.recipient] }), `${prepared.transaction.data}00` as Hex]) {
      mined.tx.input = input;
      await expect(recoverModuleModeOperation({ client: f.client, release: f.release, operation: hinted(operation, { calldataHash: sha256(input) }), transactionHash: mined.transactionHash })).rejects.toThrow();
    }
  });
  for (const field of ["missing", "duplicate", "address", "family", "recipient", "block", "removed", "data"] as const) it(`rejects ${field} author receipt evidence`, async () => {
    const f = nativeAuthorFixture(), prepared = await f.prepare(), operation = await beginModuleModeOperation(prepared, store().runtime), mined = f.mined(prepared);
    const event = mined.receipt.logs[0];
    if (field === "missing") mined.receipt.logs = [];
    if (field === "duplicate") mined.receipt.logs.push({ ...event });
    if (field === "address") event.address = a(999);
    if (field === "family") event.topics[1] = h(999);
    if (field === "recipient") event.topics[3] = h(555);
    if (field === "block") event.blockHash = h(555);
    if (field === "removed") event.removed = true;
    if (field === "data") event.data = "0x00";
    await expect(recoverModuleModeOperation({ client: f.client, release: f.release, operation, transactionHash: mined.transactionHash })).rejects.toThrow();
  });
  it("recognizes only an exactly bound revert and keeps forged data locked", async () => {
    const f = nativeAuthorFixture(), s = store(), prepared = await f.prepare(), operation = await beginModuleModeOperation(prepared, s.runtime), mined = f.mined(prepared, "reverted");
    await expect(recoverModuleModeOperation({ client: f.client, release: f.release, operation, transactionHash: mined.transactionHash })).rejects.toBeInstanceOf(ModuleNativeTransactionRevertedError);
    mined.tx.input = "0x12345678";
    await expect(recoverModuleModeOperation({ client: f.client, release: f.release, operation, transactionHash: mined.transactionHash })).rejects.not.toBeInstanceOf(ModuleNativeTransactionRevertedError);
    expect(s.items.size).toBe(1);
  });
});
