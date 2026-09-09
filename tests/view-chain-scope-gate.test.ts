import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isRobinhoodUnavailableRoute } from "../components/view-chain-unavailable";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("Robinhood view-chain scope gate", () => {
  it("gates only Ethereum-bound product data routes", () => {
    expect(isRobinhoodUnavailableRoute("/profile")).toBe(false);
    expect(isRobinhoodUnavailableRoute("/profile/settings")).toBe(false);
    expect(read("app/profile/layout.tsx")).not.toContain("ResolvedViewChainLayout");
    expect(isRobinhoodUnavailableRoute("/launch")).toBe(false);
    expect(isRobinhoodUnavailableRoute("/launch/history")).toBe(false);
    expect(isRobinhoodUnavailableRoute("/token/0x1234")).toBe(false);

    expect(isRobinhoodUnavailableRoute("/explore")).toBe(false);
    expect(isRobinhoodUnavailableRoute("/docs")).toBe(false);
    expect(isRobinhoodUnavailableRoute("/developers")).toBe(false);
    expect(isRobinhoodUnavailableRoute("/")).toBe(false);
    expect(isRobinhoodUnavailableRoute("/tokens")).toBe(false);
  });

  it("switches only the view preference and leaves wallet state untouched", () => {
    const component = read("components/view-chain-unavailable.tsx");
    const boundary = read("components/view-chain-route-boundary.tsx");
    const resolvedLayout = read("components/resolved-view-chain-layout.tsx");
    const transition = read("components/route-transition.tsx");
    const navigation = read("components/site-navigation.tsx");
    const selector = read("components/explore-chain-selector.tsx");
    const tokenPage = read("app/token/[address]/page.tsx");
    const styles = read("components/view-chain-unavailable.module.css");

    expect(boundary).toContain("resolvedViewChainId === 4663");
    expect(boundary).toContain("<ViewChainUnavailable />");
    expect(boundary).toContain("<ViewChainPending />");
    expect(boundary).toContain("initialViewChainId === null");
    expect(resolvedLayout).toContain("VIEW_CHAIN_COOKIE_NAME");
    expect(transition).not.toContain("<ViewChainPending />");
    expect(transition).not.toContain("<ViewChainUnavailable />");
    expect(transition).toContain("routeUsesChainBoundary");
    expect(navigation).not.toContain("HeaderChainToggle");
    expect(tokenPage).toContain("<EthereumTokenView address={address}");
    expect(tokenPage).toContain("<TokenRouteChainSync");
    expect(transition).toContain(
      "const resolvedInitialChain = !previousHydrated.current && hydrated",
    );
    expect(transition).toContain("previousFocusContext.current = focusContext");
    expect(component).toContain("setViewChainId(1)");
    expect(component).toContain("Ethereum remains live");
    expect(component).toContain("Your connected wallet stays connected");
    expect(component).not.toMatch(
      /useWallet|switchChain|switchNetwork|disconnect/,
    );
    expect(selector).toContain("setViewChainId(option.viewChainId)");
    expect(selector).not.toMatch(
      /useWallet|switchChain|switchNetwork|disconnect/,
    );
    expect(styles).toMatch(/\.action\s*\{[^}]*min-height:\s*44px;/s);
    expect(styles).toMatch(/\.action:focus-visible\s*\{/);
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
