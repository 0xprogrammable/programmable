import { createRoot } from "react-dom/client";
import { ModuleCoinConsole } from "@/components/module-coin-console";
import { FixtureWallet, token } from "./module-native-author-wallet-adapter";
import "../../browser-fixtures/module-engine-ui.css";
createRoot(document.getElementById("root")!).render(<FixtureWallet><main><ModuleCoinConsole token={token} /></main></FixtureWallet>);
