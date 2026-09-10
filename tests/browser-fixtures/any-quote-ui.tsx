/** Local component proof, no RPC, live publication or real wallet. */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ModuleEngineBuilder } from "@/components/module-engine-builder";
import type { ModuleModeWalletSnapshot } from "@/components/module-mode-wallet-state";
import type { ModuleEngineReceiptResult, PreparedModuleEngineTransaction } from "@/lib/module-engine/client";
import { anyQuoteUiFixture } from "../module-engine-any-quote-ui-fixture";
import { ACCOUNT, hash } from "../module-engine-fixture";
import { uiEvents } from "./any-quote-ui-adapter";
import "./module-engine-ui.css";

const fixture = anyQuoteUiFixture();
Object.assign(window, { anyQuoteUiTest: uiEvents });
function App() {
  const [wallet, setWallet] = useState<ModuleModeWalletSnapshot>({ authenticated: false, sessionReady: true });
  return <><aside className="fixture-banner"><strong>LOCAL ANY QUOTE UI TEST</strong><p>Seeded catalog, price, routes and wallet results. No real publication or transaction.</p></aside><main>
    <ModuleEngineBuilder {...fixture} wallet={wallet} onUploadImage={async () => "https://fixture.invalid/image.png"}
      onConnect={() => setWallet({ account: ACCOUNT, chainId: "1", authenticated: true, sessionReady: true })}
      onSwitch={() => setWallet({ account: ACCOUNT, chainId: "4663", authenticated: true, sessionReady: true })}
      onSubmit={async (prepared: PreparedModuleEngineTransaction): Promise<ModuleEngineReceiptResult> => { uiEvents.submissions.push(prepared.kind); return { sourceKind: "module-engine-v1", kind: prepared.kind, status: "mined", finalized: false, indexed: false, transactionHash: hash(400), blockNumber: 100n, blockHash: hash(100) }; }} />
  </main></>;
}
createRoot(document.getElementById("root")!).render(<App />);
