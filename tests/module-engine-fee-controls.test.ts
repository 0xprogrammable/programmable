import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeFunctionData, sha256, toHex } from "viem";
import { moduleEngineAuthorWalletAbi, moduleEngineLedgerAbi } from "@/lib/module-engine/abi";
import { ModuleEngineTransactionRevertedError, noteModuleEngineSubmission, observeModuleEngineReceipt, prepareModuleEngineFeeChange, readModuleEngineFeeControls, revalidateModuleEngineTransaction, type ModuleEngineClient, type ModuleEngineFeeChangeIntent } from "@/lib/module-engine/client";
import { beginModuleModeOperation, clearModuleModeOperation, moduleModeOperationPath, parseModuleModeOperation, rememberModuleModeTransactionHash } from "@/lib/module-mode-operation-store";
import { recoverModuleEngineOperation } from "@/lib/module-mode-operation-recovery";
import { ACCOUNT, addr, hash } from "./module-engine-fixture";
import { feeFixture, feeStore, NEW_WALLET } from "./module-engine-fee-fixture";

const kinds = ["rotate-creator", "replace-creators", "rotate-author"] as const;
function request(f: ReturnType<typeof feeFixture>, kind: typeof kinds[number]) {
  const intent: ModuleEngineFeeChangeIntent = kind === "rotate-creator" ? { kind, index: 0, recipient: NEW_WALLET }
    : kind === "rotate-author" ? { kind, familyId: f.template.manifest.manifest.revision.familyId, recipient: NEW_WALLET }
      : { kind, recipients: [NEW_WALLET, addr(112)] };
  return { ...f.input, account: kind === "replace-creators" ? f.fees.administrator : ACCOUNT, intent };
}
describe("Engine recipient preparation and receipt", () => {
  it.each(kinds)("prepares %s for its real contract and uses the private lifecycle", async kind => {
    const f = feeFixture(), prepared = await prepareModuleEngineFeeChange(request(f, kind));
    expect(prepared).toMatchObject({ sourceKind: "module-engine-v1", kind, token: f.launch.token, launchId: f.launch.launchId, revisionId: f.launch.revisionId, planHash: f.launch.planHash });
    expect(prepared.transaction).toMatchObject({ value: "0x0", to: kind === "rotate-author" ? f.release.contracts.registry.address : f.release.contracts.ledger.address });
    const decoded = decodeFunctionData({ abi: kind === "rotate-author" ? moduleEngineAuthorWalletAbi : moduleEngineLedgerAbi, data: prepared.transaction.data });
    expect(decoded.functionName).toBe(kind === "rotate-author" ? "changeAuthorWallet" : kind === "rotate-creator" ? "changeCreatorWallet" : "replaceCreatorWallets");
    expect(Object.isFrozen(prepared)).toBe(true);
    await expect(revalidateModuleEngineTransaction({ ...prepared }, prepared.account)).rejects.toThrow("fresh, verified");
    await revalidateModuleEngineTransaction(prepared, prepared.account);
    await expect(revalidateModuleEngineTransaction(prepared, prepared.account)).rejects.toThrow("fresh, verified");
    const receipt = f.mined(prepared); noteModuleEngineSubmission(prepared, receipt.transactionHash);
    const result = await observeModuleEngineReceipt(prepared, receipt.transactionHash);
    expect(result).toMatchObject({ kind, finalized: false, indexed: false, feeChange: { previewChanged: false, subsequentlyChanged: false } });
    expect(result.feeChange?.changes[0]).toMatchObject({ recipient: NEW_WALLET });
    expect(f.state.claimable).toBe(9n); expect(f.state.claimed).toBe(4n);
  });
  it("keeps existing coins manageable when new launches are disabled", async () => {
    const f = feeFixture(); f.state.enabled = false;
    expect((await readModuleEngineFeeControls(f.input)).creatorSharesBps).toEqual([6000, 4000]);
    await expect(prepareModuleEngineFeeChange(request(f, "rotate-author"))).resolves.toMatchObject({ kind: "rotate-author" });
  });
  it("accepts the contracts' empty return and rejects an unexpected simulation result", async () => {
    const f = feeFixture(); f.client.call = vi.fn(async () => ({ data: undefined }));
    await expect(prepareModuleEngineFeeChange(request(f, "rotate-creator"))).resolves.toMatchObject({ kind: "rotate-creator" });
    f.client.call = vi.fn(async () => ({ data: "0x12" as const }));
    await expect(prepareModuleEngineFeeChange(request(f, "rotate-creator"))).rejects.toThrow("unexpected result");
  });
  it.each(kinds)("rejects an unauthorized wallet for %s", async kind => {
    const f = feeFixture(); await expect(prepareModuleEngineFeeChange({ ...request(f, kind), account: addr(500) })).rejects.toThrow(/authority|administrator/i);
  });
  it("does not grant author control to the reward wallet or ledger administrator", async () => {
    const f = feeFixture();
    for (const account of [f.fees.authorWallet, f.fees.administrator, f.fees.treasury]) await expect(prepareModuleEngineFeeChange({ ...request(f, "rotate-author"), account })).rejects.toThrow("Registered author authority");
  });
  it("accepts either actual admin independently and fixes shares/count", async () => {
    const f = feeFixture(); const prepared = await prepareModuleEngineFeeChange({ ...request(f, "replace-creators"), account: f.fees.treasury });
    expect(prepared).toMatchObject({ authority: "treasury", sharesBps: [6000, 4000], expectedAdminRevision: 4n });
    await expect(prepareModuleEngineFeeChange({ ...f.input, account: f.fees.treasury, intent: { kind: "replace-creators", recipients: [NEW_WALLET] } })).rejects.toThrow("fixed creator share");
  });
  it.each(["zero", "same", "index", "family", "shares", "manifest", "unknown"] as const)("rejects an invalid %s before opening a wallet", async field => {
    const f = feeFixture(); let input = request(f, "rotate-creator");
    if (field === "zero") input.intent = { kind: "rotate-creator", index: 0, recipient: addr(0) };
    if (field === "same") input.intent = { kind: "rotate-creator", index: 0, recipient: ACCOUNT };
    if (field === "index") input.intent = { kind: "rotate-creator", index: 2, recipient: NEW_WALLET };
    if (field === "family") input.intent = { kind: "rotate-author", familyId: hash(999), recipient: NEW_WALLET };
    if (field === "shares") f.fees.creatorSharesBps = [5000, 4000];
    if (field === "manifest") f.state.wrongManifest = true;
    if (field === "unknown") input = { ...input, intent: { kind: "execute" } as never };
    await expect(prepareModuleEngineFeeChange(input)).rejects.toThrow(); expect(f.client.getTransaction).not.toHaveBeenCalled();
  });
  it.each(["recipient", "admin revision", "admin role", "author wallet", "author role", "expiry", "chain"] as const)("revalidates a changed %s immediately before send", async field => {
    const f = feeFixture(), kind = field.startsWith("admin") ? "replace-creators" : field.startsWith("author") ? "rotate-author" : "rotate-creator";
    const prepared = await prepareModuleEngineFeeChange(request(f, kind));
    if (field === "recipient") f.fees.creatorWallets[0] = addr(999);
    if (field === "admin revision") f.fees.adminRevision++;
    if (field === "admin role") f.fees.administrator = addr(999);
    if (field === "author wallet") f.fees.authorWallet = addr(999);
    if (field === "author role") f.fees.author = addr(999);
    if (field === "expiry") f.state.timestamp += 901n;
    if (field === "chain") f.client.getChainId = vi.fn(async () => 1);
    await expect(revalidateModuleEngineTransaction(prepared, prepared.account)).rejects.toThrow();
  });
  it.each(["replace-creators", "rotate-author"] as const)("reports actual prior recipients if a %s preview is overtaken", async kind => {
    const f = feeFixture(), prepared = await prepareModuleEngineFeeChange(request(f, kind)); await revalidateModuleEngineTransaction(prepared, prepared.account);
    if (kind === "replace-creators") f.fees.creatorWallets[0] = addr(113); else f.fees.authorWallet = addr(113);
    const receipt = f.mined(prepared); noteModuleEngineSubmission(prepared, receipt.transactionHash);
    if (kind === "replace-creators") f.fees.creatorWallets[0] = addr(114); else f.fees.authorWallet = addr(114);
    const result = await observeModuleEngineReceipt(prepared, receipt.transactionHash);
    expect(result.feeChange).toMatchObject({ previewChanged: true, subsequentlyChanged: true, changes: [expect.objectContaining({ previousWallet: addr(113), recipient: NEW_WALLET }), ...(kind === "replace-creators" ? [expect.anything()] : [])] });
  });
});

describe("durable Engine fee operation recovery", () => {
  it.each(kinds)("recovers %s after reload using canonical transaction, events and state", async kind => {
    const f = feeFixture(), store = feeStore(), prepared = await prepareModuleEngineFeeChange(request(f, kind));
    const pending = await beginModuleModeOperation(prepared, store.runtime);
    expect(pending).toMatchObject({ version: 3, sourceKind: "module-engine-v1", kind }); expect(JSON.stringify(pending)).not.toContain(prepared.transaction.data);
    expect(moduleModeOperationPath(pending)).toContain("/manage/" + f.launch.token);
    const receipt = f.mined(prepared), saved = await rememberModuleModeTransactionHash(pending, receipt.transactionHash, store.runtime);
    const result = await recoverModuleEngineOperation({ client: f.client, release: f.release, operation: parseModuleModeOperation(JSON.stringify(saved), prepared.account), transactionHash: receipt.transactionHash });
    expect(result).toMatchObject({ kind, status: "mined", feeChange: { previewChanged: false } });
    expect(store.storage.size).toBe(1); await clearModuleModeOperation(saved, store.runtime); expect(store.storage.size).toBe(0);
  });
  it("keeps all ten recipient slots inside the bounded store", async () => {
    const f = feeFixture(), store = feeStore(); f.fees.creatorWallets = Array.from({ length: 10 }, (_, i) => addr(200 + i)); f.fees.creatorSharesBps = Array(10).fill(1000);
    const prepared = await prepareModuleEngineFeeChange({ ...f.input, account: f.fees.treasury, intent: { kind: "replace-creators", recipients: Array.from({ length: 10 }, (_, i) => addr(300 + i)) } });
    await beginModuleModeOperation(prepared, store.runtime); expect([...store.storage.values()][0].length).toBeLessThan(4096);
  });
  it("does not expire an uncertain send or permit a second transaction", async () => {
    const f = feeFixture(), store = feeStore(), prepared = await prepareModuleEngineFeeChange(request(f, "rotate-author"));
    const pending = await beginModuleModeOperation(prepared, store.runtime); store.runtime.now = () => 99_999_999_999;
    await expect(beginModuleModeOperation(prepared, store.runtime)).rejects.toThrow("previous Module Mode transaction");
    f.client.waitForTransactionReceipt = vi.fn(async () => { throw new Error("RPC unavailable"); });
    await expect(recoverModuleEngineOperation({ client: f.client, release: f.release, operation: pending, transactionHash: hash(200) })).rejects.toThrow("RPC unavailable");
    expect(store.storage.size).toBe(1);
  });
  it.each(["target", "recipient", "kind", "family", "event", "reorg", "share", "admin event"] as const)("does not clear an operation with a changed %s", async field => {
    const f = feeFixture(), store = feeStore(), kind = field === "family" ? "rotate-author" : field === "admin event" ? "replace-creators" : "rotate-creator";
    const prepared = await prepareModuleEngineFeeChange(request(f, kind)), pending = await beginModuleModeOperation(prepared, store.runtime), receipt = f.mined(prepared);
    const raw = JSON.parse(JSON.stringify(pending));
    if (field === "target") { raw.target = f.host; receipt.to = f.host; vi.mocked(f.client.getTransaction).mockResolvedValue({ ...(await f.client.getTransaction({ hash: receipt.transactionHash })), to: f.host }); }
    if (field === "recipient") raw.feeChange.recipient = addr(900);
    if (field === "kind") raw.kind = "execute";
    if (field === "family") raw.feeChange.familyId = hash(900);
    if (["target", "recipient", "kind", "family"].includes(field)) { const { id: _id, transactionHash: _hash, ...bound } = raw; void _id; void _hash; raw.id = sha256(toHex(JSON.stringify(bound))); }
    if (field === "event") receipt.logs[0].address = addr(900);
    if (field === "admin event") receipt.logs.pop();
    if (field === "share") f.fees.creatorSharesBps = [7000, 3000];
    if (field === "reorg") f.client.getBlock = vi.fn(async (input?: { blockNumber?: bigint }) => ({ number: input?.blockNumber ?? 100n, hash: hash(900), timestamp: f.state.timestamp })) as unknown as ModuleEngineClient["getBlock"];
    await expect(recoverModuleEngineOperation({ client: f.client, release: f.release, operation: raw, transactionHash: receipt.transactionHash })).rejects.toThrow();
    expect(store.storage.size).toBe(1);
  });
  it("binds a confirmed revert without treating missing events as a successful change", async () => {
    const f = feeFixture(), store = feeStore(), prepared = await prepareModuleEngineFeeChange(request(f, "rotate-author")), pending = await beginModuleModeOperation(prepared, store.runtime), receipt = f.mined(prepared);
    receipt.status = "reverted"; receipt.logs.length = 0;
    await expect(recoverModuleEngineOperation({ client: f.client, release: f.release, operation: pending, transactionHash: receipt.transactionHash })).rejects.toBeInstanceOf(ModuleEngineTransactionRevertedError);
    expect(store.storage.size).toBe(1);
  });
  it("rejects a canonical but different function even if the local hash is changed", async () => {
    const f = feeFixture(), store = feeStore(), prepared = await prepareModuleEngineFeeChange(request(f, "rotate-author")), pending = await beginModuleModeOperation(prepared, store.runtime), receipt = f.mined(prepared);
    const input = encodeFunctionData({ abi: moduleEngineLedgerAbi, functionName: "claimTo", args: [NEW_WALLET] });
    const altered = { ...pending, calldataHash: sha256(input) }, { id: _id, transactionHash: _hash, ...bound } = altered; void _id; void _hash;
    altered.id = sha256(toHex(JSON.stringify(bound)));
    vi.mocked(f.client.getTransaction).mockResolvedValue({ ...(await f.client.getTransaction({ hash: receipt.transactionHash })), input });
    await expect(recoverModuleEngineOperation({ client: f.client, release: f.release, operation: altered, transactionHash: receipt.transactionHash })).rejects.toThrow("canonical fee change data");
  });
});
