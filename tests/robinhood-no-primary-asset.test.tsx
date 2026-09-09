import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RobinhoodTokenView } from "@/components/robinhood-token-view";
import { projectionToRobinhoodLaunch } from "@/lib/custom-launch/launch-projection-v1";
import { component, hash, nowIso, projectionFixture } from "./fixtures/universal-launch-v1";

vi.mock("@/components/use-robinhood-presentation", () => ({ useRobinhoodPresentation: () => ({ loading: false, items: [{
  tokenAddress: `0x${"22".repeat(20)}`, imageUrl: null, description: null, links: [],
  market: { poolId: `0x${"aa".repeat(32)}`, priceUsd: 2, marketCapUsd: 100, liquidityUsd: 30, volume24hUsd: 10, change24hPercent: 5 },
}] }) }));
vi.mock("@/components/launch-projection-trade", () => ({ LaunchProjectionTrade: () => null }));

describe("launch pages without a primary asset", () => {
  it("keeps the verified identity and provenance without implying token metrics or a price chart", () => {
    const projection = projectionFixture();
    const token = projectionToRobinhoodLaunch(projection, nowIso);
    const html = renderToStaticMarkup(<RobinhoodTokenView address={component} token={token} status="ready" />);
    expect(token.primaryAssetAddress).toBeNull();
    expect(html).toContain('aria-label="Unnamed contract launch"');
    expect(html).toContain("No primary asset is declared for this launch.");
    expect(html).toContain("Components, markets and assurance");
    expect(html).toContain("No market is declared in this launch.");
    expect(html).toContain(`/address/${component}`);
    expect(html).toContain("Dev wallet");
    expect(html).not.toMatch(/Ticker unavailable|<dt>Price<|Market cap|Liquidity|24h volume|24h change|price chart|for this coin/);
  });

  it("describes a syncing assetless record as a launch", () => {
    const token = projectionToRobinhoodLaunch(projectionFixture(), nowIso);
    const html = renderToStaticMarkup(<RobinhoodTokenView address={component} token={token} status="syncing" />);
    expect(html).toContain("This launch comes from the verified launch index.");
    expect(html).not.toContain("This coin");
  });

  it("preserves ticker, market metrics and the no-market notice when a primary asset is declared", () => {
    const base = projectionFixture();
    const projection = { ...base, primaryComponentId: base.components[0].componentId };
    const token = projectionToRobinhoodLaunch(projection, nowIso);
    const html = renderToStaticMarkup(<RobinhoodTokenView address={component} token={token} status="ready" />);
    expect(token.primaryAssetAddress).toBe(component);
    expect(html).toContain('aria-label="Unnamed contract market"');
    expect(html).toContain("Ticker unavailable");
    expect(html).toContain("<dt>Price</dt>");
    expect(html).toContain("Market cap");
    expect(html).toContain("No trading market is verified for this coin.");
    expect(html).not.toContain("No primary asset is declared");
  });

  it("preserves the existing chart for a legacy token with no generic projection", () => {
    const token = { ...projectionToRobinhoodLaunch(projectionFixture(), nowIso), launchProjection: undefined, name: "Existing token", symbol: "EXIST", poolId: hash };
    const html = renderToStaticMarkup(<RobinhoodTokenView address={component} token={token} status="ready" />);
    expect(html).toContain("EXIST");
    expect(html).toContain("Market cap");
    expect(html).toContain("Existing token price chart on DEX Screener");
    expect(html).not.toContain("No primary asset is declared");
  });
});
