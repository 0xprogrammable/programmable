/** Test-only adapters for rendered host orchestration. No wallet, chain or public availability proof. */
import React, { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Address, Hex } from "viem";
import { fixture, ACCOUNT, TOKEN, addr, hash } from "../../module-engine-fixture";
import { beginModuleModeOperation, moduleModeOperationSnapshot, type ModuleModeOperation } from "@/lib/module-mode-operation-store";
import type { ModuleEngineBuilderProps } from "@/components/module-engine-builder";
import type { ModuleEngineReceiptResult, PreparedModuleEngineLaunch } from "@/lib/module-engine/client";
export { ModuleEngineTransactionRevertedError } from "@/lib/module-engine/client";
const f = fixture();
const walletContext = createContext<{ account: Address; setAccount: (account: Address) => void }>({ account: ACCOUNT, setAccount: () => {} });
const sent: Address[] = [], recovered: { account: string; id: string; hash: Hex }[] = [];
let deferReceipt = false, finishReceipt: (() => void) | undefined;
export function prepared(account = ACCOUNT, sequence = 1): PreparedModuleEngineLaunch {
  return { sourceKind: "module-engine-v1", kind: "launch", account, releaseDigest: f.release.releaseDigest, blockNumber: 100n,
    transaction: { chainId: 4663, from: account, to: f.host, data: hash(sequence), value: "0x0", action: "launch", description: "TEST ONLY" },
    expiresAt: BigInt(Math.floor(Date.now() / 1000)) + 300n, gasEstimate: 100_000n, predictedToken: sequence === 1 ? TOKEN : addr(sequence + 100),
    launchId: hash(sequence + 10), revisionId: f.template.manifest.manifest.revision.packageId, planHash: hash(sequence + 30),
    configurationHash: hash(31), engineCodeHash: hash(32), engine: addr(93), quoteAsset: addr(91), quoteDecimals: 6,
    initialOperation: { operationId: hash(0), actor: addr(0), recipient: addr(0), inputAsset: addr(0), inputAmount: 0n, outputAsset: addr(0), minimumOutput: 0n, deadline: 0n, nonce: 0n, data: "0x" },
    platformFeeBps: 10, buyCreatorFeeBps: 0, sellCreatorFeeBps: 0 };
}
function result(transactionHash: Hex, token: Address): ModuleEngineReceiptResult { return { sourceKind: "module-engine-v1", kind: "launch", status: "mined", finalized: false, indexed: false, transactionHash, token, blockNumber: 101n, blockHash: hash(200) }; }
export const createModuleEngineClient = () => f.client;
export const readModuleEngineLaunch = async () => f.launch;
export const observeModuleEngineReceipt = async (value: PreparedModuleEngineLaunch, transactionHash: Hex) => {
  if (deferReceipt) await new Promise<void>(resolve => { finishReceipt = resolve; });
  return result(transactionHash, value.predictedToken);
};
export const fetchModuleEngineOperationRelease = async () => f.release;
export const recoverModuleEngineOperation = async ({ operation, transactionHash }: { operation: ModuleModeOperation; transactionHash: Hex }) => {
  recovered.push({ account: operation.account, id: operation.id, hash: transactionHash });
  if (transactionHash !== hash(800)) throw new Error("Test receipt does not match the selected saved transaction.");
  return result(transactionHash, operation.token);
};
export const fetchModuleModeOperationRelease = async () => { throw new Error("Native recovery is outside this host fixture."); };
export const recoverModuleModeOperation = fetchModuleModeOperationRelease;
export function useWallet() {
  const context = useContext(walletContext);
  return { wallet: { account: context.account, chainId: "4663" }, authenticated: true, sessionReady: true, authReady: true, connecting: false, openingWallet: false, switchingNetwork: false, disconnecting: false,
    openWallet: () => {}, switchNetwork: async () => true, getAccessToken: async () => "fixture-only",
    sendModuleModeTransaction: async (value: PreparedModuleEngineLaunch) => {
      if (!moduleModeOperationSnapshot(value.account)) throw new Error("The host did not persist before handing off to the wallet.");
      sent.push(value.account); return hash(700);
    } };
}
export function ModuleEngineBuilder(props: ModuleEngineBuilderProps) {
  return <section><h1>Host orchestration test adapter</h1>{props.statusContent}<button disabled={props.blocked} onClick={() => void props.onSubmit(prepared(props.wallet.account as Address)).catch(() => {})}>Submit test launch</button></section>;
}
export const ModuleEngineConsole = ModuleEngineBuilder;
export function FixtureWallet({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState(() => (localStorage.getItem("fixture:wallet") || ACCOUNT) as Address);
  const choose = useCallback((account: Address) => { localStorage.setItem("fixture:wallet", account); setAccount(account); }, []);
  useEffect(() => { Object.assign(window, { engineHostTest: { accountA: ACCOUNT, accountB: addr(92), sent, recovered,
    defer: () => { deferReceipt = true; }, finish: () => finishReceipt?.(),
    seed: async (other: boolean) => { const target = other ? addr(92) : ACCOUNT; const record = await beginModuleModeOperation(prepared(target, 2)); choose(target); return record.id; },
  } }); }, [choose]);
  return <walletContext.Provider value={{ account, setAccount: choose }}><p>LOCAL HOST TEST · simulated wallet, receipt and child action adapters</p>{children}</walletContext.Provider>;
}
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => String(input).startsWith("/api/module-mode?") ? Response.json(f.availability) : realFetch(input, init);
