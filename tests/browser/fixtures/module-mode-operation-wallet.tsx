import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { encodeFunctionData, type Hex } from "viem";
import { beginModuleModeOperation, rememberModuleModeTransactionHash } from "../../../lib/module-mode-operation-store";
import { bindActiveModuleModeRelease } from "../../../lib/module-mode/release";
import { moduleNativeLaunchAbi } from "../../../lib/module-mode/native-abi";
import { MODULE_MODE_AVAILABILITY_SCHEMA } from "../../../lib/module-mode/native-catalog";
import { moduleEvidenceFixture, a, h } from "../../fixtures/module-mode-evidence";
import { runWithBrowserWalletRequestLock } from "../../../lib/wallet-request-lock";
import type { PreparedModuleNativeLaunch, PreparedModuleNativeManagement } from "../../../lib/module-mode/native-client";
import type { PreparedModuleEngineOperation } from "../../../lib/module-engine/client";
import type { ModuleManagementSnapshot } from "../../../lib/module-mode/management";
export { ModuleNativeTransactionRevertedError } from "../../../lib/module-mode/native-client";
export { managementActionProblem, managementCoreAbi, moduleManagementChainMatches } from "../../../lib/module-mode/management";
export async function readModuleNativeAuthorWallets() { throw new Error("Author getters are not installed in this recovery-only fixture."); }
export async function verifyModuleNativeAuthorWalletReceipt() { throw new Error("Author receipts require the dedicated real-client fixture."); }

// Test-only adapters. The server substitutes these imports; no product route imports this file.
export const release = bindActiveModuleModeRelease(moduleEvidenceFixture().release);
export const account = a(90); export const token = a(21); export const transactionHash = h(200);
const launch = { launchId: h(10), launchWallet: account, token, poolId: h(22), recipeHash: h(23), launchKey: h(24), hook: release.contracts.hook.address,
  positionRecipient: a(25), positionTokenId: 1n, initialBuyNative: 1_000n, initialBuyTokens: 90_000n, runtime: release.contracts.runtime.address };
function preparation(kind: "launch" | "manage") {
  const data = kind === "launch" ? encodeFunctionData({ abi: moduleNativeLaunchAbi, functionName: "launch", args: [{ name: "Recovery fixture", symbol: "REC", buyCreatorFeeBps: 0,
    sellCreatorFeeBps: 0, creatorSalt: h(26), metadata: { description: "", website: "", image: "https://example.com/image.webp", extraData: "0x" }, creatorWallets: [account],
    creatorSharesBps: [10_000], modules: [], moduleFunding: [], initialBuyNative: 1_000n, minimumInitialTokenOut: 89_000n, deadline: BigInt(Math.floor(Date.now() / 1000)) + 300n }] }) : "0x12345678";
  return { kind, account, token, releaseDigest: release.releaseDigest, blockNumber: 100n, expiresAt: BigInt(Math.floor(Date.now() / 1000)) + 300n, gasEstimate: 100_000n,
    transaction: { chainId: 4663, from: account, to: kind === "launch" ? release.contracts.launcher.address : release.contracts.rewardLedger.address, data, value: kind === "launch" ? "0x3e8" : "0x0", action: kind, description: "Claim your existing fee balance to the reviewed wallet." },
    ...(kind === "launch" ? { draftId: h(27), predictedToken: token, poolId: launch.poolId, recipeHash: launch.recipeHash, launchKey: launch.launchKey, quotedTokenOut: 90_000n, minimumTokenOut: 89_000n } : {}) } as PreparedModuleNativeLaunch | PreparedModuleNativeManagement;
}
const prepared = { manage: preparation("manage"), launch: preparation("launch") };
const control = { ready: false, reject: false, sendCount: () => Number(localStorage.getItem("fixture:sends") || 0), reads: 0, versionReads: [] as string[],
  seedEngine: async () => {
    const engine = { ...prepared.manage, sourceKind: "module-engine-v1", kind: "execute", launchId: h(40), revisionId: h(41), planHash: h(42),
      operation: { operationId: h(43), nonce: 2n } } as unknown as PreparedModuleEngineOperation;
    await beginModuleModeOperation(engine);
  },
  seed: async (kind: "manage" | "launch", withHash = false) => {
    const operation = await beginModuleModeOperation(prepared[kind]);
    localStorage.setItem("fixture:calldata", prepared[kind].transaction.data);
    if (withHash) await rememberModuleModeTransactionHash(operation, transactionHash);
  } };
declare global { interface Window { __moduleOperationFixture: typeof control } }
window.__moduleOperationFixture = control;
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(String(input), window.location.origin);
  if (!url.pathname.startsWith("/api/")) return originalFetch(input, init);
  if (url.pathname !== "/api/module-mode") throw new Error("Unexpected fixture API request");
  control.versionReads.push(url.searchParams.get("releaseDigest") ?? "current");
  return Response.json({ schemaVersion: MODULE_MODE_AVAILABILITY_SCHEMA, release, catalog: [], reason: null });
};
export const createModuleNativeClient = () => ({
  getChainId: async () => 4663,
  getBlock: async ({ blockNumber }: { blockNumber?: bigint }) => ({ number: blockNumber ?? 100n, hash: h(201), timestamp: BigInt(Math.floor(Date.now() / 1000)) }),
  waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => {
    control.reads++;
    if (!control.ready) throw new Error("Confirmation has not arrived yet.");
    const record = Object.keys(localStorage).find(key => key.startsWith("programmable:module-operation:"));
    const operation = record ? JSON.parse(localStorage.getItem(record)!) : null;
    return { transactionHash: hash, blockNumber: 101n, blockHash: h(201), from: account, to: operation.target, status: "success" };
  },
  getTransaction: async ({ hash }: { hash: Hex }) => {
    const record = Object.keys(localStorage).find(key => key.startsWith("programmable:module-operation:"));
    const operation = record ? JSON.parse(localStorage.getItem(record)!) : null;
    return { hash, chainId: 4663, from: hash === transactionHash ? account : a(91), to: operation.target, input: localStorage.getItem("fixture:calldata"), value: BigInt(operation.value), blockNumber: 101n, blockHash: h(201) };
  },
});
export const readModuleNativeLaunch = async () => launch;
export const prepareModuleNativeLaunch = async () => prepared.launch;
export const prepareModuleNativeManagementTransaction = async () => prepared.manage;
export const waitForModuleNativeReceipt = async () => { throw new Error("Confirmation has not arrived yet."); };
export const readModuleManagementSnapshot = async (): Promise<ModuleManagementSnapshot> => ({ release, blockNumber: 100n, blockHash: h(201), timestamp: 1_000_000n, actor: account, name: "Recovery fixture", symbol: "REC", launch, instances: [],
  fees: { claimable: 100_000_000_000_000n, claimed: 0n, contributedByCoin: 100_000_000_000_000n, treasury: a(91), administrator: a(92), wallets: [account], sharesBps: [10_000], adminRevision: 1n } });
const Context = createContext({ wallet: { account, chainId: "0x1237" }, openWallet: () => {} });
export function FixtureWallet({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState({ account, chainId: "0x1237" });
  useEffect(() => { window.__moduleOperationFixture = control; }, []);
  return <Context.Provider value={{ wallet, openWallet: () => setWallet({ account, chainId: "0x1237" }) }}>{children}</Context.Provider>;
}
export const useViewChain = () => ({ hydrated: true, viewChainId: 4663, setViewChainId: () => {} });
export const useRouteViewChain = useViewChain;
export function useWallet() {
  const value = useContext(Context);
  return { ...value, authenticated: true, sessionReady: true, authReady: true, connecting: false, openingWallet: false, switchingNetwork: false, disconnecting: false,
    getAccessToken: async () => "fixture-token", switchNetwork: async () => true,
    sendModuleModeTransaction: async (operation: PreparedModuleNativeLaunch | PreparedModuleNativeManagement) => runWithBrowserWalletRequestLock({ sessionSubject: "fixture-session", account, chainId: "4663", requestSubject: "module-operation-fixture", assertCurrentSession: () => {}, execute: async () => {
      localStorage.setItem("fixture:calldata", operation.transaction.data);
      localStorage.setItem("fixture:sends", String(control.sendCount() + 1));
      if (control.reject) throw Object.assign(new Error("Wallet request cancelled."), { code: 4001, walletRequestRejected: true });
      throw Object.assign(new Error("The wallet connection closed before its response arrived."), { walletRequestAttempted: true });
    } }),
  };
}
