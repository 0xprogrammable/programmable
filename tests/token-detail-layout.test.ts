import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const detailSource = readFileSync(
  join(root, "components/token-detail-view.tsx"),
  "utf8",
);
const detailStyles = readFileSync(
  join(root, "components/token-experience.module.css"),
  "utf8",
);
const chartSource = readFileSync(
  join(root, "components/token-price-chart.tsx"),
  "utf8",
);

describe("token detail layout", () => {
  it("keeps loading shape-stable and avoids an unverified onchain price label", () => {
    expect(detailSource).toContain(
      'import { TokenDetailShell } from "@/components/token-detail-shell";',
    );
    expect(detailSource).toContain("return <TokenDetailShell />;");
    expect(detailSource).not.toContain("Loading\n        </div>");
    expect(chartSource).not.toContain(': "Onchain"');
  });

  it("keeps detail charts lazy while exposing provider-specific history scope", () => {
    const viewSource = detailSource.slice(
      detailSource.indexOf("export function TokenDetailView"),
    );

    expect(viewSource).not.toContain("preloadTokenChart");
    expect(chartSource).toContain(
      "const historyEnabled = shouldEnablePriceHistory(launchModel);",
    );
    expect(chartSource).toContain(
      '"Token-level history · Pool attribution unavailable"',
    );
    expect(chartSource).toContain('"Exact-pool history"');
  });

  it("keeps the inspected date in the header without a floating tooltip", () => {
    const activeValueIdIndex = chartSource.indexOf("id={activeValueId}");
    const liveRegion = chartSource.slice(
      chartSource.lastIndexOf("<span", activeValueIdIndex),
      chartSource.indexOf("</span>", activeValueIdIndex) + "</span>".length,
    );

    expect(chartSource).toContain(
      "`${formatChartValue(activePoint.value, chart.unit, chartMetric)}, ${chartPointContext(activePoint)}`",
    );
    expect(chartSource).toContain('className={styles.context} aria-hidden="true"');
    expect(chartSource).toContain("singleObservation");
    expect(chartSource).toContain("1 verified observation");
    expect(chartSource).not.toContain("className={styles.tooltip}");
    expect(activeValueIdIndex).toBeGreaterThan(-1);
    expect(liveRegion).toContain('className="sr-only"');
    expect(liveRegion).toContain('role="status"');
    expect(liveRegion).toContain('aria-live="polite"');
    expect(liveRegion).toContain('aria-atomic="true"');
    expect(liveRegion).toContain("chartPointContext(activePoint)");
    expect(chartSource).not.toContain("data-horizontal-edge");
    expect(chartSource).not.toContain("data-vertical=");
  });

  it("keeps chart loading stable, labelled and separate from empty history", () => {
    expect(chartSource).toContain("aria-busy={loading}");
    expect(chartSource).toContain('role="status"');
    expect(chartSource).toContain("{chartStatus}");
    expect(chartSource).toContain('"Market cap history"');
    expect(chartSource).toContain('point.valueSemantics === "period-median"');
    expect(chartSource).toContain('hour12: true');
    expect(chartSource).not.toContain('timeZoneName: "short"');
    expect(chartSource).not.toContain('} to ${formatter.format');
    expect(chartSource).not.toContain("inspect exact prices");
    expect(chartSource).not.toContain("payload.points.length < 2");
    expect(chartSource).toContain("tabIndex={0}");
    expect(chartSource).toMatch(
      /\{loading \? \([\s\S]*?styles\.waitingPlot[\s\S]*?\) : singleObservation && chart \? \([\s\S]*?\) : chart \? \(/,
    );
    expect(chartSource).toContain("{emptyMessage ? <p>{emptyMessage}</p> : null}");
  });

  it("keeps the market workspace compact after removing auxiliary detail panels", () => {
    expect(detailStyles).toMatch(
      /grid-template-areas:\s*"identity identity"\s*"chart trade"\s*"deep deep"\s*"community community";/s,
    );
    expect(detailSource).toMatch(
      /<div className=\{styles\.marketChart\}>[\s\S]*?<TokenPriceChart[\s\S]*?<MetricGrid metrics=\{metrics\} \/>[\s\S]*?<\/div>/s,
    );
    expect(detailSource).toMatch(
      /\{chainId === 1 \? \([\s\S]*?<TokenPriceChart[\s\S]*?\) : null\}/s,
    );
    expect(detailSource).not.toContain("<VerifiedLaunchRecord");
    expect(detailSource).not.toContain("<TokenCommunityChat");
    expect(detailStyles).toMatch(
      /\.classicLayout\s*\{[^}]*"identity identity"[^}]*"chart trade"[^}]*"deep deep"/s,
    );
    expect(detailStyles).toMatch(
      /\.identity\s*\{[^}]*grid-template-columns:\s*132px minmax\(0, 1fr\);/s,
    );
    expect(detailStyles).toContain(
      "grid-template-columns: minmax(0, 1.9fr) minmax(260px, 0.82fr);",
    );
  });

  it("shows market information without mounting token-page trading controls", () => {
    expect(detailSource).not.toMatch(/<TokenTrade|<PreparedTradeReview|<CustomMarketTrade|styles\.tradeShell/);
    expect(detailSource).not.toContain('fetch("/api/trade/prepare"');
    expect(detailSource).not.toMatch(/Launching wallet|Launch transaction/);
    expect(detailSource).toContain("Dev wallet");
    expect(detailSource).toContain("TokenIdentityActions");
    expect(detailSource).toContain("styles.readOnlyLayout");
    expect(detailStyles).toMatch(/\.layout\.readOnlyLayout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
    const shell = readFileSync(join(root, "components/token-detail-shell.tsx"), "utf8");
    expect(shell).not.toContain("<aside");
    expect(shell).not.toContain("market-access");
  });

  it("keeps the market chart ahead of liquidity details at every width", () => {
    const contentSource = detailSource.slice(
      detailSource.indexOf("function TokenDetailContent"),
      detailSource.indexOf("function customMarketStatus"),
    );
    const domMarkers = ["className={styles.identity}", "className={styles.marketChart}", "<DeepLiquiditySummary token={token} />"];
    expect(domMarkers.every(marker => contentSource.includes(marker))).toBe(true);
    expect(contentSource.indexOf(domMarkers[0])).toBeLessThan(contentSource.indexOf(domMarkers[1]));
    expect(contentSource.indexOf(domMarkers[1])).toBeLessThan(contentSource.indexOf(domMarkers[2]));
    expect(detailStyles).toMatch(/\.layout\.readOnlyLayout\.classicLayout\s*\{[^}]*grid-template-areas:\s*"identity" "chart" "deep"/s);
  });

  it("stacks detail metrics at the narrowest supported width", () => {
    expect(detailStyles).toMatch(
      /@media \(max-width: 360px\)[\s\S]*?\.metrics,[\s\S]*?\.metrics\[data-count="3"\]\s*\{[^}]*grid-template-columns:\s*1fr;/s,
    );
    expect(detailStyles).toMatch(
      /@media \(max-width: 360px\)[\s\S]*?\.metrics\[data-count="3"\] \.metric:last-child\s*\{[^}]*grid-column:\s*auto;/s,
    );
  });

  it("keeps only useful identity metadata", () => {
    expect(detailSource).not.toMatch(/<h2>\s*Token details\s*<\/h2>/i);
    expect(detailSource).not.toMatch(/<dt>\s*Network\s*<\/dt>/i);
    expect(detailSource).not.toContain("EthereumMark");
    expect(detailSource).not.toContain('className={styles.networkMark}');
    expect(detailSource).not.toContain('aria-label="Token metadata"');
    expect(detailSource).not.toMatch(/<dt>\s*Published\s*<\/dt>/i);
    expect(detailSource).not.toMatch(/<dt>\s*Quote asset\s*<\/dt>/i);
    expect(detailSource).not.toMatch(/<h2>\s*Team\s*<\/h2>/i);
    expect(detailSource).not.toMatch(/<h2>\s*Trade \$/i);
  });

  it("keeps Custom market rows machine-identifiable while abbreviating long IDs", () => {
    expect(detailSource).toContain("data-market-id={market.marketId}");
    expect(detailSource).toContain("data-market-kind={market.kind}");
    expect(detailSource).toContain("data-pool-id={market.poolId}");
    expect(detailSource).toContain("customMarketIdentityDescription(market)");
    expect(detailSource).toContain("customMarketIdentityLabel(market)");
  });

  it("shows token-level GMGN analytics for live Ethereum Custom details only", () => {
    const customContent = detailSource.slice(
      detailSource.indexOf("function CustomProjectDetailContent"),
      detailSource.indexOf("export function TokenDetailView"),
    );
    expect(customContent).toMatch(
      /chainId === 1 && !preview && project\.tokenAddress[\s\S]*?<TokenGmgnAnalytics[\s\S]*?tokenAddress=\{project\.tokenAddress\}[\s\S]*?tokenName=\{project\.name\}/su,
    );
    expect(detailSource).toMatch(
      /previewCustomProject[\s\S]*?<CustomProjectDetailContent[\s\S]*?preview/su,
    );
    expect(detailSource).toContain("totalSupplyRaw?: string;");
    expect(detailSource).toContain("return formatUnits(BigInt(rawSupply)");
    expect(customContent).toContain("Custom V4 Hook");
  });

  it("keeps canonical detail valuation independent from chart history", () => {
    expect(detailSource).toContain('return "Market cap";');
    expect(detailSource).not.toContain("fdvEthWei={");
    expect(detailSource).not.toContain("fdvUsdWad={");
    expect(chartSource).not.toContain("payload.marketCap");
    expect(chartSource).not.toContain("payload.fdvUsdWad ?? fdvUsdWad");
    expect(chartSource).toContain("marketCapUsd?: string");
    expect(detailSource).not.toContain("chartFdv");
    expect(detailSource).not.toContain("setChartFdv");
    expect(detailSource).not.toContain("onFdvChange");
    expect(chartSource).not.toContain("onFdvChange");
    expect(chartSource).not.toContain("getChartFdvAtPoint");
    expect(chartSource).not.toContain("function withoutChartFdv");
    expect(chartSource).not.toContain("fdvUsdWad?: string");
    expect(chartSource).not.toContain("valuationMetric?:");
    expect(chartSource).toContain('"fdvUsdWad" in value');
    expect(chartSource).toContain(
      'value.valuation.reason !== "source-unavailable"',
    );
  });

  it("omits empty team-profile filler copy", () => {
    expect(detailSource).not.toContain("No team profile provided.");
    expect(detailSource).not.toContain("No team information provided.");
    expect(detailSource).not.toContain("previewProject?.communityMembers");
    expect(detailSource).not.toContain("Private notes");
  });
});
