import { createContext, useContext, useState, type ReactNode } from "react";
import type { Address, Hex } from "viem";
import { revalidateModuleNativeTransaction, waitForModuleNativeReceipt, type PreparedModuleNativeManagement } from "../../../lib/module-mode/native-client";
import { MODULE_MODE_AVAILABILITY_SCHEMA } from "../../../lib/module-mode/native-catalog";
import { nativeAuthorFixture } from "../../module-native-author-fixture";
import { a } from "../../fixtures/module-mode-evidence";
import { beginModuleModeOperation, clearModuleModeOperation, parseModuleModeOperation, rememberModuleModeTransactionHash } from "../../../lib/module-mode-operation-store";
export * from "../../../lib/module-mode/native-client";

const params = new URLSearchParams(location.search), f = nativeAuthorFixture(params.get("version") === "2");
const actor = params.get("role") === "recipient" ? f.state.wallet : params.get("role") === "outsider" ? a(900) : f.actor;
f.state.getterMissing = params.has("missing");
export const token = f.token;
export const createModuleNativeClient = () => f.client;
let receiptGate: Promise<void> | null = null, releaseReceipt: (() => void) | null = null;
let firstReceiptHeld = false, lastSubmission: { prepared: PreparedModuleNativeManagement; transactionHash: Hex } | null = null;
const receiptRequests: Hex[] = [], otherAccount = a(701), otherHash = ("0x" + "b".repeat(64)) as Hex;
const originalReceipt = f.client.waitForTransactionReceipt.bind(f.client);
f.client.waitForTransactionReceipt = async parameters => {
  receiptRequests.push(parameters.hash);
  const result = await originalReceipt(parameters);
  if (receiptGate && !firstReceiptHeld) { firstReceiptHeld = true; await receiptGate; }
  return result;
};
declare global { interface Window { __nativeAuthorRace: { actor: Address; otherAccount: Address; otherHash: Hex; receiptRequests: Hex[] } } }
window.__nativeAuthorRace = { actor, otherAccount, otherHash, receiptRequests };
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  if (url.pathname !== "/api/module-mode") return originalFetch(input, init);
  if (url.searchParams.has("releaseDigest") && url.searchParams.get("releaseDigest") !== f.release.releaseDigest) throw new Error("Unexpected source version");
  return Response.json({ schemaVersion: MODULE_MODE_AVAILABILITY_SCHEMA, release: f.release, catalog: f.catalog, reason: null });
};
function fixtureWallet(account: Address, mode: string, count: () => void) {
  return { wallet: { account, chainId: "4663" }, authenticated: true, sessionReady: true, openWallet: () => undefined, switchNetwork: async () => undefined,
    sendModuleModeTransaction: async (prepared: PreparedModuleNativeManagement) => {
      await revalidateModuleNativeTransaction(prepared, account);
      if (mode === "reject") throw Object.assign(new Error("Local wallet rejected the request."), { code: 4001 });
      count();
      if (mode === "uncertain") throw new Error("Local wallet response was lost after signing. Check its confirmation.");
      if (mode === "deferred") { firstReceiptHeld = false; receiptGate = new Promise(resolve => { releaseReceipt = resolve; }); }
      const { transactionHash } = f.mined(prepared); lastSubmission = { prepared, transactionHash }; return transactionHash;
    } };
}
const context = createContext<ReturnType<typeof fixtureWallet> | null>(null);
export function useWallet() { const value = useContext(context); if (!value) throw new Error("Missing local wallet fixture"); return value; }
export function FixtureWallet({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState(actor);
  const [mode, setMode] = useState("confirm"), [count, setCount] = useState(Number(localStorage.getItem("fixture:author-sends") ?? 0));
  const wallet = fixtureWallet(account, mode, () => { const next = Number(localStorage.getItem("fixture:author-sends") ?? 0) + 1; localStorage.setItem("fixture:author-sends", String(next)); setCount(next); });
  const switchToSavedWallet = async (sameAccount = false) => {
    const nextAccount = sameAccount ? account : otherAccount;
    if (sameAccount) {
      if (!lastSubmission) throw new Error("Missing held submission");
      await waitForModuleNativeReceipt({ client: f.client, ...lastSubmission });
      const current = parseModuleModeOperation(localStorage.getItem("programmable:module-operation:v1:4663:" + account)!, account);
      await clearModuleModeOperation(current);
    }
    const prepared = await f.prepare({ kind: "claim-fees", recipient: nextAccount }, nextAccount);
    const saved = await beginModuleModeOperation(prepared);
    await rememberModuleModeTransactionHash(saved, otherHash);
    setAccount(nextAccount);
  };
  return <context.Provider value={wallet}><aside className="fixture-banner"><strong>LOCAL AUTHOR WALLET TEST</strong><p>Real Native coin controls, private validation and recovery storage with synthetic RPC responses. No live wallet or publication.</p><label>Test wallet response <select value={mode} onChange={event => setMode(event.target.value)}><option value="confirm">Simulate mined</option><option value="reject">Reject request</option><option value="uncertain">Uncertain request</option><option value="deferred">Hold receipt</option></select></label><output aria-label="Test wallet calls">Wallet calls: {count}</output>
    {params.has("race") ? <><button type="button" onClick={() => { void switchToSavedWallet(); }}>Connect wallet B with saved claim</button><button type="button" onClick={() => { void switchToSavedWallet(true); }}>Confirm elsewhere and save next claim</button><button type="button" onClick={() => { releaseReceipt?.(); receiptGate = null; }}>Release wallet A receipt</button></> : null}
  </aside>{children}</context.Provider>;
}
