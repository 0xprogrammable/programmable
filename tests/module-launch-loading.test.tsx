import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ModuleModeLaunchHost } from "@/components/module-mode-launch-host";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/wallet-provider", () => ({ useWallet: () => ({ authenticated: false, sessionReady: true, authReady: true }) }));
vi.mock("@/components/view-chain", () => ({ useRouteViewChain: () => ({ hydrated: true }) }));

it("renders editable coin fields while launch availability is still unresolved", () => {
  const pending = new Promise<never>(() => {});
  const html = renderToStaticMarkup(<ModuleModeLaunchHost availabilityRequest={pending} />);
  expect(html).toContain("Create a coin");
  expect(html).toContain("Coin name");
  expect(html).toContain("<input");
  expect(html).not.toContain("Loading coin setup");
  expect(html).not.toContain("Every Nth buy reward");
  expect(html).not.toContain("Opening buy cap");
});
