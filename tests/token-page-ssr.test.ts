import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { tokenDetailPageChainId } from "../lib/token-page-chain";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("token detail index reset", () => {
  it("defaults only an omitted chain and rejects invalid or repeated values", () => {
    expect(tokenDetailPageChainId(undefined)).toBe(1);
    expect(tokenDetailPageChainId("1")).toBe(1);
    expect(tokenDetailPageChainId("4663")).toBe(4663);
    expect(tokenDetailPageChainId("10")).toBeNull();
    expect(tokenDetailPageChainId(["1", "4663"])).toBeNull();
  });

  it("reads verified details for each explicit chain while keeping live market data separate", () => {
    const page = read("app/token/[address]/page.tsx");
    const resetView = read("components/token-index-reset-view.tsx");

    expect(page).toContain("genericTokenDetailMetadata(address, true");
    expect(page).toContain("<EthereumTokenView");
    expect(read("lib/server/token-page.ts")).toContain("readEthereumToken(address)");
    expect(page).toContain("=== 4663");
    expect(page).toContain("resolveTokenPage(address, resolvedSearchParams.chain)");
    expect(read("lib/server/token-page.ts")).toContain("readRobinhoodToken(address)");
    expect(page).toContain("<RobinhoodTokenView");
    expect(page).toContain("notFound()");
    expect(page).not.toContain("@/app/api/explore/token/route");
    expect(page).not.toContain("TokenDetailView");
    expect(page).not.toContain("TokenDetailShell");
    expect(page).not.toContain("readInitialTokenDetail");
    expect(page).not.toContain("NextRequest");
    expect(page).not.toContain("Suspense");
    expect(page).toContain("isAddress(address)");
    expect(resetView).toContain("Token indexing is being rebuilt");
    expect(resetView).toContain("market data are unavailable");
    expect(resetView).not.toContain("fetch(");
  });
});
