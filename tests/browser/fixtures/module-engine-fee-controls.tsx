import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ModuleEngineConsole } from "@/components/module-engine-console";
import { beginModuleModeOperation, clearModuleModeOperation, moduleModeOperationSnapshot, rememberModuleModeTransactionHash } from "@/lib/module-mode-operation-store";
import { isModuleEngineFeeTransaction, noteModuleEngineSubmission, observeModuleEngineReceipt, releaseModuleEnginePreparation, revalidateModuleEngineTransaction, type PreparedModuleEngineTransaction } from "@/lib/module-engine/client";
import { ACCOUNT } from "../../module-engine-fixture";
import { feeFixture } from "../../module-engine-fee-fixture";
import "../../browser-fixtures/module-engine-ui.css";

const f = feeFixture(), scenario = new URLSearchParams(location.search).get("role") ?? "self";
const actor = scenario === "admin" ? f.fees.administrator : scenario === "treasury" ? f.fees.treasury : scenario === "reward-wallet" ? f.fees.authorWallet : ACCOUNT;
Object.assign(window, { feeFixture: { state: f.fees, actor, submissions: [] as string[] } });
function App() {
  const [blocked, setBlocked] = useState(Boolean(moduleModeOperationSnapshot(actor))), [mode, setMode] = useState("confirm");
  const [count, setCount] = useState(0);
  const wallet = { account: actor, chainId: "4663", authenticated: true, sessionReady: true };
  async function onSubmit(prepared: PreparedModuleEngineTransaction) {
    if (!isModuleEngineFeeTransaction(prepared)) throw new Error("This local adapter exercises recipient changes only.");
    const pending = await beginModuleModeOperation(prepared); setBlocked(true);
    try { await revalidateModuleEngineTransaction(prepared, actor); }
    catch (error) { await clearModuleModeOperation(pending); setBlocked(false); throw error; }
    if (mode === "reject") { releaseModuleEnginePreparation(prepared); await clearModuleModeOperation(pending); setBlocked(false); throw new Error("Local test wallet rejected the request."); }
    setCount(value => value + 1);
    if (mode === "uncertain") throw new Error("The local wallet response is uncertain. Check the existing operation before trying another transaction.");
    const receipt = f.mined(prepared); noteModuleEngineSubmission(prepared, receipt.transactionHash);
    const saved = await rememberModuleModeTransactionHash(pending, receipt.transactionHash), result = await observeModuleEngineReceipt(prepared, receipt.transactionHash);
    await clearModuleModeOperation(saved); setBlocked(false); return result;
  }
  return <><aside className="fixture-banner"><strong>LOCAL RECIPIENT CONTROLS TEST</strong><p>Real product components with seeded contract responses and a simulated wallet. No live transaction or publication.</p>
    <label>Test wallet response <select value={mode} onChange={event => setMode(event.target.value)}><option value="confirm">Simulate mined</option><option value="reject">Reject request</option><option value="uncertain">Uncertain request</option></select></label><output aria-label="Test wallet calls">Wallet calls: {count}</output>
  </aside><main><ModuleEngineConsole release={f.release} template={f.template} token={f.launch.token} client={f.client} wallet={wallet} onConnect={() => undefined} onSwitch={() => undefined} onSubmit={onSubmit} blocked={blocked} blockedReason="An existing recipient change needs confirmation. Check its transaction before sending another." statusContent={blocked ? <p role="status">The saved wallet operation is still pending.</p> : null} /></main></>;
}
createRoot(document.getElementById("root")!).render(<App />);
