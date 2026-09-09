import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { activeExploreFilterCount, DEFAULT_EXPLORE_FILTERS, sameRobinhoodExploreRequest } from "@/lib/robinhood-explore-filters";

vi.mock("@/components/view-chain", () => ({ useViewChain: () => ({ hydrated: true, viewChainId: 4663, setViewChainId: vi.fn() }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/explore/robinhood", useRouter: () => ({ push: vi.fn() }) }));
import { RobinhoodLaunchesView } from "@/components/robinhood-launches-view";

describe("Explore request identity", () => {
  const request = { page: 2, q: "coin", sort: "newest" as const, mode: "module" as const };

  it("accepts only the currently selected page, search, order and launch type", () => {
    expect(sameRobinhoodExploreRequest({ ...request }, request)).toBe(true);
    for (const previous of [null, undefined, { ...request, page: 1 }, { ...request, q: "other" },
      { ...request, sort: "oldest" as const }, { ...request, mode: "custom" as const }]) {
      expect(sameRobinhoodExploreRequest(previous, request)).toBe(false);
    }
  });

  it("treats older unfiltered navigation state as All and includes launch type in filter count", () => {
    expect(sameRobinhoodExploreRequest({ ...request, mode: undefined }, { ...request, mode: "all" })).toBe(true);
    expect(activeExploreFilterCount(DEFAULT_EXPLORE_FILTERS)).toBe(0);
    expect(activeExploreFilterCount({ sort: "highest", mode: "module" })).toBe(1);
    expect(activeExploreFilterCount({ sort: "newest", mode: "custom" })).toBe(2);
  });
});

describe("Explore toolbar and loading structure", () => {
  it("loads the explicit Ethereum chain with an enabled search and its own list", () => {
    const html = renderToStaticMarkup(<RobinhoodLaunchesView chainId={1} />);
    expect(html).toContain("Search Ethereum launches by name, symbol or address");
    expect(html).toContain('aria-label="Ethereum launches"');
    expect(html).not.toContain("indexing is being rebuilt");
    expect(html).not.toContain('aria-label="Robinhood launches"');
  });
  it("keeps accessible arrows beside the chain and Filters controls without a separate page or mode row", () => {
    const html = renderToStaticMarkup(<RobinhoodLaunchesView chainId={4663} />);
    expect(html).toContain('placeholder="Search"');
    expect(html).toContain('aria-label="Previous page"');
    expect(html).toContain('aria-label="Next page"');
    expect(html).toContain('aria-label="Launch pages"');
    expect(html.indexOf('aria-label="Filters"')).toBeLessThan(html.indexOf('aria-label="Previous page"'));
    expect(html).not.toContain('aria-label="Launch type"');
    expect(html).not.toContain("Page 1 of");
    expect(html).not.toContain(">Previous<");
    expect(html).not.toContain(">Next<");
    expect(html.match(/<li /g)).toHaveLength(10);
    expect(html).toContain('aria-label="Robinhood launches" aria-busy="true"');
  });
});
