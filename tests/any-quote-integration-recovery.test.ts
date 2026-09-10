import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFunctionData, erc20Abi, toHex } from "viem";
import { moduleEngineAnyQuoteLedgerAbi, moduleEnginePermit2Abi } from "@/lib/module-engine/abi";
import { bindActiveModuleEngineRelease, computeModuleEngineReleaseDigest, type ModuleEngineRelease } from "@/lib/module-engine/catalog";
import { MODULE_ENGINE_ANY_QUOTE_SOURCE_VERSION, MODULE_ENGINE_ANY_QUOTE_PROFILE, MODULE_ENGINE_ANY_QUOTE_ECONOMICS_POLICY_ID } from "@/lib/module-engine/profile";
import { ModuleEngineTransactionRevertedError, readModuleEngineLaunch, revalidateModuleEngineTransaction, verifyModuleEngineApprovalReceipt, verifyModuleEngineClaimReceipt, verifyModuleEngineFeeChangeReceipt, verifyModuleEngineAnyQuoteSwapReceipt, type ModuleEngineClient, type ModuleEngineReceiptResult, type PreparedModuleEngineTransaction } from "@/lib/module-engine/client";
import { ANY_QUOTE_INFRASTRUCTURE, ANY_QUOTE_NATIVE, ANY_QUOTE_WETH, type AnyQuoteExternalRouteV1 } from "@/lib/module-engine/any-quote/types";
import { anyQuotePoolFor } from "@/lib/module-engine/any-quote/integration";
import { anyQuotePoolIdV1, buildAnyQuoteSwapV1 } from "@/lib/module-engine/any-quote/route";
import { beginModuleModeOperation, parseModuleModeOperation } from "@/lib/module-mode-operation-store";
import { recoverModuleEngineOperation } from "@/lib/module-mode-operation-recovery";
import { ACCOUNT, CODE_HASH, QUOTE, TOKEN, addr, fixture, hash } from "./module-engine-fixture";

vi.mock("@/lib/module-engine/client", async original => ({ ...await original<typeof import("@/lib/module-engine/client")>(),
  readModuleEngineLaunch: vi.fn(), verifyModuleEngineApprovalReceipt: vi.fn(), verifyModuleEngineClaimReceipt: vi.fn(), verifyModuleEngineFeeChangeReceipt: vi.fn(), verifyModuleEngineAnyQuoteSwapReceipt: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

function harness(kind: "erc20" | "permit2" | "claim" | "rotate-platform" | "swap" = "permit2") {
  const f = fixture();
  const candidate: ModuleEngineRelease = { ...f.release, sourceVersion: MODULE_ENGINE_ANY_QUOTE_SOURCE_VERSION, engineProfile: MODULE_ENGINE_ANY_QUOTE_PROFILE, economicsPolicyId: MODULE_ENGINE_ANY_QUOTE_ECONOMICS_POLICY_ID,
    contracts: { ...f.release.contracts, poolManager: { address: ANY_QUOTE_INFRASTRUCTURE.poolManager, runtimeCodeHash: ANY_QUOTE_INFRASTRUCTURE.poolManagerCodeHash },
      sharedHook: { address: addr(901), runtimeCodeHash: CODE_HASH }, universalRouter: { address: ANY_QUOTE_INFRASTRUCTURE.universalRouter, runtimeCodeHash: ANY_QUOTE_INFRASTRUCTURE.universalRouterCodeHash }, nativeRouteGuard: { address: addr(903), runtimeCodeHash: CODE_HASH } } };
  candidate.releaseDigest = computeModuleEngineReleaseDigest(candidate);
  const release = bindActiveModuleEngineRelease(candidate), recipient = addr(92), deadline = 1_000_120n;
  const externalKey = { currency0: ANY_QUOTE_NATIVE, currency1: QUOTE, fee: 3000, tickSpacing: 60, hooks: ANY_QUOTE_NATIVE };
  const externalRoute: AnyQuoteExternalRouteV1 = { provider: "uniswap-trading-api", chainId: 4663, tokenIn: ANY_QUOTE_WETH, tokenOut: QUOTE,
    amountIn: "1000", amountOut: "2000", validUntil: deadline.toString(), checkpoint: { number: "100", hash: hash(100), timestamp: "1000000" }, evidenceHash: hash(99),
    hops: [{ protocol: "V4", tokenIn: ANY_QUOTE_NATIVE, tokenOut: QUOTE, poolId: anyQuotePoolIdV1(externalKey), key: externalKey, hookData: "0x" }] };
  const pool = anyQuotePoolFor(TOKEN, QUOTE, addr(901));
  const compiled = kind === "swap" ? buildAnyQuoteSwapV1({ pool, owner: ACCOUNT, recipient, side: "buy", amountIn: 1000n, minimumAmountOut: 900n, deadline, now: 1_000_000n, externalRoute }) : null;
  const data = kind === "swap" ? compiled!.transaction.data : kind === "claim" ? encodeFunctionData({ abi: moduleEngineAnyQuoteLedgerAbi, functionName: "claimQuoteTo", args: [QUOTE, recipient] })
    : kind === "rotate-platform" ? encodeFunctionData({ abi: moduleEngineAnyQuoteLedgerAbi, functionName: "changePlatformWallet", args: [recipient] })
      : kind === "permit2" ? encodeFunctionData({ abi: moduleEnginePermit2Abi, functionName: "approve", args: [TOKEN, ANY_QUOTE_INFRASTRUCTURE.universalRouter, 1000n, Number(deadline)] })
        : encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ANY_QUOTE_INFRASTRUCTURE.permit2, 1000n] });
  const target = kind === "swap" ? ANY_QUOTE_INFRASTRUCTURE.universalRouter : kind === "permit2" ? ANY_QUOTE_INFRASTRUCTURE.permit2 : kind === "erc20" ? TOKEN : release.contracts.ledger.address;
  const prepared = { sourceKind: "module-engine-v1", kind: kind === "permit2" || kind === "erc20" ? "approve" : kind, account: ACCOUNT, releaseDigest: release.releaseDigest, blockNumber: 100n, expiresAt: deadline, gasEstimate: 100_000n,
    transaction: { chainId: 4663, from: ACCOUNT, to: target, data, value: toHex(kind === "swap" ? 1000n : 0n), action: "manage", description: "Private review data" },
    token: TOKEN, launchId: f.launch.launchId, revisionId: f.launch.revisionId, planHash: f.launch.planHash,
    spender: ANY_QUOTE_INFRASTRUCTURE.permit2, amount: 1000n, allowanceKind: kind === "erc20" ? "erc20" : "permit2", ...(kind === "permit2" ? { permit2Spender: ANY_QUOTE_INFRASTRUCTURE.universalRouter, expiration: deadline } : {}),
    previousWallet: ACCOUNT, authority: "treasury", recipient, minimumAmount: 9n, claimedBefore: 4n,
    buy: true, quoteAsset: QUOTE, quoteDecimals: 6, inputAmount: 1000n, outputAmount: 1000n, minimumOutput: 900n, externalRoute } as PreparedModuleEngineTransaction;
  const storage = new Map<string, string>(), runtime = { now: () => 1_000_000_000, notify: vi.fn(), storage: { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } }, locks: { request: async <T>(_name: string, _options: unknown, callback: (lock: object) => Promise<T>) => callback({}) } };
  const receipt = { transactionHash: hash(200), blockHash: hash(201), blockNumber: 101n, from: ACCOUNT, to: target, status: "success" }, block = { number: 101n, hash: hash(201) };
  const tx = { hash: hash(200), chainId: 4663, from: ACCOUNT, to: target, input: data, value: BigInt(prepared.transaction.value), blockHash: hash(201), blockNumber: 101n };
  const client = { getChainId: vi.fn(async () => 4663), waitForTransactionReceipt: vi.fn(async () => receipt), getTransaction: vi.fn(async () => tx), getBlock: vi.fn(async () => block) };
  const result: ModuleEngineReceiptResult = { sourceKind: "module-engine-v1", status: "mined", finalized: false, indexed: false, kind: prepared.kind, token: TOKEN, transactionHash: hash(200), blockHash: hash(201), blockNumber: 101n };
  vi.mocked(readModuleEngineLaunch).mockResolvedValue(f.launch);
  for (const verifier of [verifyModuleEngineApprovalReceipt, verifyModuleEngineClaimReceipt, verifyModuleEngineFeeChangeReceipt, verifyModuleEngineAnyQuoteSwapReceipt]) vi.mocked(verifier).mockResolvedValue(result);
  const save = () => beginModuleModeOperation(prepared, runtime);
  return { ...f, release, recipient, prepared, storage, runtime, tx, receipt, client, block, compiled, save,
    recover: async () => recoverModuleEngineOperation({ client: client as unknown as ModuleEngineClient, release, operation: await save(), transactionHash: hash(200) }) };
}

describe("Any Quote exact transaction recovery", () => {
  it.each(["erc20", "permit2"] as const)("recovers only the finite %s allowance for the pinned router", async kind => {
    const f = harness(kind);
    await expect(f.recover()).resolves.toMatchObject({ kind: "approve", status: "mined", finalized: false, indexed: false });
    const saved = parseModuleModeOperation([...f.storage.values()][0], ACCOUNT);
    expect(saved).toMatchObject({ version: 5, sourceKind: "module-engine-v1", approval: { allowanceKind: kind, amount: "1000", spender: ANY_QUOTE_INFRASTRUCTURE.permit2.toLowerCase() } });
    expect(verifyModuleEngineApprovalReceipt).toHaveBeenCalledWith(expect.objectContaining({ allowanceKind: kind, amount: 1000n,
      ...(kind === "permit2" ? { expiration: 1_000_120n, permit2Spender: ANY_QUOTE_INFRASTRUCTURE.universalRouter } : {}) }));
    expect([...f.storage.values()][0]).not.toContain(f.prepared.transaction.data);
    expect([...f.storage.values()][0]).not.toContain("Private review data");
    await expect(revalidateModuleEngineTransaction(saved as unknown as PreparedModuleEngineTransaction, ACCOUNT)).rejects.toThrow("fresh, verified");
  });
  it.each(["amount", "spender", "permit2Spender", "expiration"] as const)("rejects a saved Permit2 %s that does not encode the confirmed transaction", async field => {
    const f = harness(); Object.assign(f.prepared, { [field]: field === "amount" || field === "expiration" ? 1001n : addr(999) });
    await expect(f.recover()).rejects.toThrow("does not match"); expect(verifyModuleEngineApprovalReceipt).not.toHaveBeenCalled();
  });
  it("rejects foreign targets even when the stored and transaction targets agree", async () => {
    const f = harness(); Object.assign(f.prepared.transaction, { to: addr(888) }); f.tx.to = f.receipt.to = addr(888);
    await expect(f.recover()).rejects.toThrow("engine release contract");
  });
  it("retains finite-allowance evidence through a receipt timeout and distinguishes a confirmed revert", async () => {
    const unavailable = harness(); unavailable.client.waitForTransactionReceipt.mockRejectedValue(new Error("provider unavailable"));
    await expect(unavailable.recover()).rejects.toThrow("provider unavailable"); expect(unavailable.storage.size).toBe(1);
    const reverted = harness(); reverted.receipt.status = "reverted";
    await expect(reverted.recover()).rejects.toBeInstanceOf(ModuleEngineTransactionRevertedError); expect(reverted.storage.size).toBe(1);
  });
  it("recovers quote claims only for the bound launch quote asset and recipient", async () => {
    const f = harness("claim"); await expect(f.recover()).resolves.toMatchObject({ kind: "claim" });
    expect(verifyModuleEngineClaimReceipt).toHaveBeenCalledWith(expect.objectContaining({ launch: f.launch, recipient: f.recipient, minimumAmount: 9n, claimedBefore: 4n }));
    const changed = harness("claim"); changed.launch.quoteAsset = addr(999); await expect(changed.recover()).rejects.toThrow("quote claim asset");
  });
  it("retains platform rotation authority in recovery and does not reinterpret it as author fees", async () => {
    const f = harness("rotate-platform"); await expect(f.recover()).resolves.toMatchObject({ kind: "rotate-platform" });
    expect(parseModuleModeOperation([...f.storage.values()][0], ACCOUNT)).toMatchObject({ version: 3, feeChange: { kind: "rotate-platform", previousWallet: ACCOUNT, recipient: f.recipient, authority: "treasury" } });
    expect(verifyModuleEngineFeeChangeReceipt).toHaveBeenCalledWith(expect.objectContaining({ change: { kind: "rotate-platform", previousWallet: ACCOUNT, recipient: f.recipient, authority: "treasury" } }));
  });
  it("persists complete route intent without making storage a transaction preparation", async () => {
    const f = harness("swap"), saved = await f.save();
    expect(saved).toMatchObject({ version: 5, kind: "swap", value: "1000", launch: { launchId: f.launch.launchId }, swap: { quoteAsset: QUOTE, recipient: f.recipient, minimumOutput: "900", deadline: "1000120" } });
    expect(parseModuleModeOperation([...f.storage.values()][0], ACCOUNT)).toEqual(saved);
    expect(() => parseModuleModeOperation(JSON.stringify({ ...saved, value: "999" }), ACCOUNT)).toThrow();
    expect(() => parseModuleModeOperation(JSON.stringify(saved), addr(999))).toThrow("different wallet");
    expect(() => parseModuleModeOperation(" ".repeat(32_769), ACCOUNT)).toThrow("cannot be read");
    await expect(revalidateModuleEngineTransaction(saved as unknown as PreparedModuleEngineTransaction, ACCOUNT)).rejects.toThrow("fresh, verified");
  });
  it("admits recovery only when the compiler proves V4 unlock deltas", async () => {
    const f = harness("swap");
    if (String(f.compiled!.balanceAccounting.mode) === "unlock-deltas") {
      await expect(f.recover()).resolves.toMatchObject({ kind: "swap" });
      expect(verifyModuleEngineAnyQuoteSwapReceipt).toHaveBeenCalledWith(expect.objectContaining({ minimumOutput: 900n, quote: expect.objectContaining({ buy: true, recipient: f.recipient }) }));
    } else {
      await expect(f.recover()).rejects.toThrow("canonical complete ETH route");
      expect(verifyModuleEngineAnyQuoteSwapReceipt).not.toHaveBeenCalled();
    }
  });
});
