import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256, type Hex } from "viem";
import { prepareSwap, recoverSwap, submitSwap, type SwapWalletActions } from "@/lib/swap/client";
import { beginPendingSwap, clearPendingSwap, getPendingSwap, recordPendingSwapHash } from "@/lib/swap/pending";
import type { SwapTokenDescriptor } from "@/lib/swap/types";
import { bindActiveModuleModeRelease } from "@/lib/module-mode/release";
import { a, h, moduleEvidenceFixture } from "./fixtures/module-mode-evidence";

const mocks = vi.hoisted(() => ({ nativeSwap: vi.fn(), nativeApproval: vi.fn(), nativeReceipt: vi.fn(), client: vi.fn() }));
vi.mock("@/lib/module-mode/native-client", () => ({ prepareModuleNativeSwap: mocks.nativeSwap, prepareModuleNativeApproval: mocks.nativeApproval,
  waitForModuleNativeReceipt: mocks.nativeReceipt, ModuleNativeTransactionRevertedError: class extends Error {} }));
vi.mock("@/lib/module-engine/client", () => ({ createModuleEngineClient: mocks.client, ModuleEngineTransactionRevertedError: class extends Error {} }));
vi.mock("@/lib/module-mode-operation-store", () => ({ moduleModeOperationSnapshot: () => null }));

const release = bindActiveModuleModeRelease(moduleEvidenceFixture().release);
const availability = { schemaVersion: "programmable.module-mode.availability.v1" as const, release, catalog: [], reason: null };
const descriptor: SwapTokenDescriptor = { schemaVersion: "programmable.swap-token.v1", status: "ready", chainId: 4663,
  token: { address: a(22), name: "Fixture", symbol: "FIX", decimals: 18 }, manageHref: null, route: { kind: "module-native", availability } };
const amountIn = 123_456_789_012_345_678n;
const input = { descriptor, owner: a(90), side: "sell" as const, amountIn };
function preparation() {
  return { kind: "swap", account: input.owner, token: descriptor.token.address, releaseDigest: release.releaseDigest,
    transaction: { chainId: 4663, from: input.owner, to: a(10), data: "0x12345678", value: "0x0", action: "swap", description: "Fixture" },
    blockNumber: 100n, expiresAt: BigInt(Math.floor(Date.now() / 1000)) + 300n, gasEstimate: 100_000n,
    tokenAmount: amountIn, nativeAmount: 90_000n, limit: 89_000n };
}
let storage: Map<string, string>;
let lockHeld = false;
beforeEach(() => {
  vi.clearAllMocks(); storage = new Map(); lockHeld = false;
  const target = new EventTarget();
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
    addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target), dispatchEvent: target.dispatchEvent.bind(target) });
  vi.stubGlobal("navigator", { locks: { request: async (_name: string, _options: unknown, callback: (lock: object | null) => unknown) => {
    if (lockHeld) return callback(null);
    lockHeld = true;
    try { return await callback({}); } finally { lockHeld = false; }
  } } });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(availability)));
  mocks.client.mockReturnValue({}); mocks.nativeSwap.mockResolvedValue(preparation()); mocks.nativeReceipt.mockResolvedValue({ blockNumber: 101n });
});
afterEach(() => vi.unstubAllGlobals());
function wallet() {
  return { sendModuleModeTransaction: vi.fn(async () => h(200)), sendTransaction: vi.fn(),
    sendLaunchPlanTradeWalletAction: vi.fn(), sendCustomV4SwapWalletAction: vi.fn() } as unknown as SwapWalletActions;
}
const pendingInput = () => ({ chainId: 4663 as const, owner: input.owner, token: descriptor.token.address, kind: "swap" as const,
  to: a(10), data: "0x12345678" as Hex, value: "0", preparedBlock: "100" });

describe("unified swap wallet boundary", () => {
  it("prepares exact native input and sends the same sealed adapter object", async () => {
    const actions = wallet(), prepared = preparation(); mocks.nativeSwap.mockResolvedValue(prepared);
    const review = await prepareSwap(input, actions);
    expect(mocks.nativeSwap).toHaveBeenCalledWith(expect.objectContaining({ amountSpecified: -amountIn, isBuy: false, account: input.owner, recipient: input.owner }));
    expect(review).toMatchObject({ amountIn, amountOut: 90_000n, minimumOutput: 89_000n, kind: "swap" });
    const sent = await submitSwap(review, actions);
    expect(actions.sendModuleModeTransaction).toHaveBeenCalledWith(prepared);
    expect(getPendingSwap(input.owner, 4663)).toMatchObject({ hash: sent.hash });
    expect(await sent.wait()).toMatchObject({ status: "success", hash: sent.hash });
    expect(getPendingSwap(input.owner, 4663)).toBeNull();
    await expect(submitSwap(review, actions)).rejects.toThrow("fresh swap");
  });

  it("requests only the needed approval and never invents a quote before allowance exists", async () => {
    const actions = wallet(); mocks.nativeSwap.mockResolvedValue({ kind: "approval-required", amount: amountIn });
    const prepared = { ...preparation(), kind: "approve", amount: amountIn }; mocks.nativeApproval.mockResolvedValue(prepared);
    const review = await prepareSwap(input, actions);
    expect(review).toMatchObject({ kind: "approval", approvalLabel: "Approve FIX", amountOut: null, minimumOutput: null });
    expect(mocks.nativeApproval).toHaveBeenCalledWith(expect.objectContaining({ amount: amountIn, token: descriptor.token.address }));
    expect(actions.sendModuleModeTransaction).not.toHaveBeenCalled();
  });

  it("does not accept copied display objects as transaction authority", async () => {
    const actions = wallet(), review = await prepareSwap(input, actions);
    await expect(submitSwap({ ...review }, actions)).rejects.toThrow("fresh swap");
    expect(actions.sendModuleModeTransaction).not.toHaveBeenCalled();
  });

  it.each([{ walletRequestAttempted: false }, { code: 4001 }, { walletRequestRejected: true }])("unblocks only a definite no-send outcome %j", async flags => {
    const actions = wallet(); vi.mocked(actions.sendModuleModeTransaction).mockRejectedValue(Object.assign(new Error("Not sent"), flags));
    const review = await prepareSwap(input, actions);
    await expect(submitSwap(review, actions)).rejects.toThrow("Not sent");
    expect(getPendingSwap(input.owner, 4663)).toBeNull();
  });

  it("retains unknown broadcasts across reload and blocks a new preparation", async () => {
    const actions = wallet(); vi.mocked(actions.sendModuleModeTransaction).mockRejectedValue(new Error("Wallet timeout"));
    await expect(submitSwap(await prepareSwap(input, actions), actions)).rejects.toThrow("Wallet timeout");
    const pending = getPendingSwap(input.owner, 4663);
    expect(pending).toMatchObject({ hash: null, dataHash: sha256("0x12345678") });
    expect([...storage.values()][0]).not.toContain("0x12345678");
    await expect(prepareSwap(input, actions)).rejects.toThrow("previous swap");
    expect(actions.sendModuleModeTransaction).toHaveBeenCalledTimes(1);
  });
});

describe("durable swap recovery", () => {
  it("serializes creation, hash updates and clearing across tabs", async () => {
    const results = await Promise.allSettled([beginPendingSwap(pendingInput()), beginPendingSwap(pendingInput())]);
    expect(results.map(result => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    const pending = getPendingSwap(input.owner, 4663)!;
    lockHeld = true;
    await expect(recordPendingSwapHash(pending, h(200))).rejects.toThrow("another tab");
    await expect(clearPendingSwap(pending)).rejects.toThrow("another tab");
    lockHeld = false;
    await recordPendingSwapHash(pending, h(200));
    await expect(recordPendingSwapHash(pending, h(201))).rejects.toThrow("changed");
    await clearPendingSwap(pending);
    expect(getPendingSwap(input.owner, 4663)).toBeNull();
  });

  function receiptClient(status: "success" | "reverted" = "success") {
    const receipt = { transactionHash: h(200), blockHash: h(201), blockNumber: 101n, from: input.owner, to: a(10), status };
    const tx = { hash: h(200), chainId: 4663, from: input.owner, to: a(10), input: "0x12345678", value: 0n, blockHash: h(201), blockNumber: 101n };
    const block = { number: 101n, hash: h(201) };
    const client = { getChainId: vi.fn(async () => 4663), waitForTransactionReceipt: vi.fn(async () => receipt),
      getTransaction: vi.fn(async () => tx), getBlock: vi.fn(async () => block) };
    mocks.client.mockReturnValue(client);
    return { client, receipt, tx, block };
  }

  it.each(["success", "reverted"] as const)("recovers an unknown %s only from its exact mined transaction", async status => {
    receiptClient(status); const pending = await beginPendingSwap(pendingInput());
    await expect(recoverSwap(pending, h(200))).resolves.toMatchObject({ status, hash: h(200), blockNumber: 101n, chainId: 4663 });
    expect(getPendingSwap(input.owner, 4663)).toBeNull();
  });

  it.each(["sender", "target", "data", "chain", "value", "canonical", "old receipt"])("retains recovery when %s differs", async field => {
    const f = receiptClient(), pending = await beginPendingSwap(pendingInput());
    if (field === "sender") f.tx.from = a(91);
    if (field === "target") f.tx.to = a(11);
    if (field === "data") f.tx.input = "0x87654321";
    if (field === "chain") f.tx.chainId = 1;
    if (field === "value") f.tx.value = 1n;
    if (field === "canonical") f.block.hash = h(202);
    if (field === "old receipt") { f.receipt.blockNumber = 99n; f.tx.blockNumber = 99n; }
    await expect(recoverSwap(pending, h(200))).rejects.toThrow("does not match");
    expect(getPendingSwap(input.owner, 4663)).toMatchObject({ id: pending.id, hash: null });
  });
});
