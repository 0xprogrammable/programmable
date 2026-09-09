import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Explore UI contract", () => {
  it("routes both chains to indexed launches and keeps the legacy reset explicit", () => {
    const page = readFileSync(join(root, "app/explore/[chain]/page.tsx"), "utf8");
    const entry = readFileSync(join(root, "app/explore/page.tsx"), "utf8");
    const resetView = readFileSync(
      join(root, "components/explore-index-reset-view.tsx"),
      "utf8",
    );
    const selector = readFileSync(
      join(root, "components/explore-chain-selector.tsx"),
      "utf8",
    );

    expect(entry).toContain("redirect(exploreChainPath(");
    expect(page).toContain("<RobinhoodLaunchesView chainId={chainId} />");
    expect(page).toContain("exploreChainIdFromSlug");
    expect(readFileSync(join(root, "components/robinhood-launches-view.tsx"), "utf8")).not.toContain("ExploreIndexResetView");
    expect(page).toContain("index: false");
    expect(page).not.toContain("ExploreView");
    expect(page).not.toContain("@/app/api/explore/route");
    expect(page).not.toContain("websiteExploreIndexEnabledV1");
    expect(resetView).toContain('const Heading = embedded ? "h2" : "h1"');
    expect(resetView).toContain(
      "<Heading data-explore-heading>Explore</Heading>",
    );
    expect(resetView).toContain("<ExploreChainSelector chainId={1} />");
    expect(resetView.indexOf("<ExploreChainSelector chainId={1} />")).toBeGreaterThan(
      resetView.indexOf("className={styles.disabledSearch}"),
    );
    expect(resetView.indexOf("<ExploreChainSelector chainId={1} />")).toBeLessThan(
      resetView.indexOf("<ExploreFilters disabled />"),
    );
    expect(resetView).toContain("disabled");
    expect(resetView).toContain("Launch indexing is being rebuilt");
    expect(resetView).not.toContain("fetch(");
    expect(resetView).not.toContain("router.prefetch");
    expect(selector).not.toContain("fetch(");
    expect(selector).not.toContain("/api/explore");
  });

  it("keeps public Explore limited to token discovery", () => {
    const navigation = readFileSync(
      join(root, "components/site-navigation.tsx"),
      "utf8",
    );
    const source = readFileSync(
      join(root, "components/explore-view.tsx"),
      "utf8",
    );

    expect(navigation).not.toContain("/markets");
    expect(source).not.toContain("ExploreModeSwitch");
    expect(source).toContain("<Heading data-explore-heading>Explore</Heading>");
  });

  it("shows quote-derived prediction payouts without allowing stale orders", () => {
    const source = readFileSync(
      join(root, "components/prediction-market-detail.tsx"),
      "utf8",
    );
    const normalized = source.replace(/\s+/g, " ");

    expect(source).toContain("Potential payout");
    expect(source).toContain("Potential profit");
    expect(source).toContain("Max market loss");
    expect(source).toContain("This order if");
    expect(source).toContain("based on the current quote");
    expect(source).toContain("network fee excluded");
    expect(source).toMatch(
      /shownQuote\.buyPayout\s*\?\s*"Shares received"\s*:\s*"Estimated proceeds"/s,
    );
    expect(source).toMatch(
      /shownQuote\.buyPayout\s*\?\s*"Minimum shares"\s*:\s*"Minimum proceeds"/s,
    );
    expect(normalized).toContain('role="group" aria-label="Trade direction"');
    expect(normalized).toContain('role="group" aria-label="Outcome"');
    expect(source).toContain("aria-pressed={mode === value}");
    expect(source).toContain("aria-pressed={outcome === value}");
    expect(source).toContain("const requestId = ++quoteRequestId.current");
    expect(
      source.match(/requestId !== quoteRequestId\.current/gu),
    ).toHaveLength(2);
    expect(source).toContain(
      "const requestedSelectionKey = currentQuoteSelectionKey",
    );
    expect(source).toContain("quotedSelectionKey === currentQuoteSelectionKey");
    expect(source).toContain(
      "const liveQuote = quoteSelectionIsCurrent ? storedLiveQuote : null",
    );
    expect(source).toContain(
      "const shownQuote = quoteSelectionIsCurrent ? storedShownQuote : null",
    );
    expect(source).toContain("setQuotedSelectionKey(requestedSelectionKey)");
    expect(normalized).not.toContain(
      'className={styles.orderPreview} aria-live="polite"',
    );
    expect(normalized).toContain(
      'className="sr-only" role="status" aria-live="polite"',
    );
    expect(source).toContain("<span>Rules</span>");
    expect(source).not.toContain("How this market resolves");
  });

  it("keeps sort, socials and model choices in one persistent disclosure", () => {
    const source = readFileSync(
      join(root, "components/explore-view.tsx"),
      "utf8",
    );
    const styles = readFileSync(
      join(root, "components/explore-experience.module.css"),
      "utf8",
    );

    expect(source).toContain('id="explore-model-label"');
    expect(source).not.toContain('id="explore-discovery-label"');
    expect(source).not.toContain('id="explore-valuation-label"');
    expect(source).toContain('id="explore-age-label"');
    expect(source).toContain('id="explore-socials-label"');
    expect(source).toContain('{ id: "classic", label: "Classic" }');
    expect(source).toContain('{ id: "custom-hook", label: "Custom V4 Hook" }');
    expect(source).toContain("sort,\n      page: String(currentPage)");
    expect(source).toContain(
      "valuationSort !== DEFAULT_EXPLORE_VALUATION_SORT",
    );
    expect(source).toContain("const newestLaunchOrderApplied =");
    expect(source).toContain("exploreActiveSelectionState({");
    expect(source).toContain("<span>Filters</span>");
    expect(source).toContain("activeFilterCount > 0");
    expect(source.indexOf('id="explore-model-label"')).toBeLessThan(
      source.indexOf('id="explore-age-label"'),
    );
    expect(source.indexOf('id="explore-age-label"')).toBeLessThan(
      source.indexOf('id="explore-socials-label"'),
    );
    expect(source).not.toContain("valuationSortOptions.map((option) => (");
    expect(source).toContain("ageSortOptions.map((option) => (");
    expect(source).toContain("resolveExploreSortSelectionsForChain(");
    expect(source).toContain("aria-pressed={ageSortForChain === option.id}");
    expect(source).toMatch(
      /disabled=\{viewChainId === 4663 &&\s+option\.id === "oldest"\}/u,
    );
    expect(source).toContain("valuationSort: valuationSortForChain");
    expect(source).toContain("ageSort: ageSortForChain");
    expect(source).toContain(
      'if (viewChainId === 1) {\n                                setDiscoverySort("none");',
    );
    expect(source).toContain("setAgeSort((current) =>");
    expect(source).toContain('search.set(\n        "model",');
    expect(source).toContain(
      'modelFilter === "custom-hook" ? "custom" : "classic"',
    );
    expect(source).toContain('initialModelFilter = "all"');
    expect(source).toContain("window.history.replaceState(");
    expect(source.match(/setModelFilter\(/gu)).toHaveLength(1);
    expect(source).not.toContain("setSort(option.id)");
    expect(styles).toMatch(
      /\.runnersIntro :global\(\.token-filter\)\s*\{[^}]*flex:\s*0 0 122px;[^}]*width:\s*122px;/s,
    );
    expect(styles).toMatch(
      /\.runnersIntro \.filterMenu\s*\{[^}]*left:\s*auto;[^}]*right:\s*0;[^}]*transform-origin:\s*top right;/s,
    );
    expect(
      source.indexOf(
        'if (debouncedQuery || socialFilter !== "all" || modelFilter !== "all")',
      ),
    ).toBeLessThan(
      source.indexOf(
        'if (payload?.dataQuality?.launchIdentity.status === "partial")',
      ),
    );
    expect(source).not.toMatch(
      /onClick=\{\(\) => \{[\s\S]{0,300}filterRef\.current/s,
    );
  });

  it("keeps nine desktop cards and a compact four-card mobile page", () => {
    const source = readFileSync(
      join(root, "components/explore-view.tsx"),
      "utf8",
    );
    const styles = readFileSync(
      join(root, "components/explore-experience.module.css"),
      "utf8",
    );

    expect(source).toContain("export const EXPLORE_TOKENS_PER_PAGE = 9");
    expect(source).toContain("export const EXPLORE_MOBILE_TOKENS_PER_PAGE = 4");
    expect(source).toContain("useExplorePaginationViewport()");
    expect(source).toContain("limit: String(pageSize)");
    expect(source.match(/subscribeToExploreViewport/gu)).toHaveLength(2);
    expect(source).toContain("pageSelection.pageSize === pageSize");
    expect(source).toContain("{ chainId: viewChainId, pageSize, page }");
    expect(source).not.toContain("previousPageSize");
    expect(source).toContain("displayState.payload.pageSize !== pageSize");
    expect(source).toContain("pendingMobilePagination");
    expect(source).toContain("styles.viewportPendingPagination");
    expect(styles).toMatch(
      /\.runnerGrid\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);[^}]*width:\s*100%;/s,
    );
    expect(styles).toMatch(
      /\.runnerArt\s*\{[^}]*aspect-ratio:\s*1;[^}]*width:\s*100%;/s,
    );
    expect(styles).toMatch(/\.runnerMeta\s*\{[^}]*gap:\s*4px;/s);
    expect(styles).toMatch(
      /@media \(max-width: 700px\)[\s\S]*?grid-template-areas:[\s\S]*?"search search search"[\s\S]*?"pages chain sort";/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 700px\)[\s\S]*?\.runnerGrid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 700px\)[\s\S]*?\.viewportPendingPagination\s*\{[^}]*visibility:\s*hidden;/s,
    );
    expect(styles).toMatch(
      /@media \(min-width: 701px\)[\s\S]*?\.mobileOnlyPaginationPlaceholder\s*\{[^}]*display:\s*none;/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 700px\)[\s\S]*?\.runnerContract\s*\{[^}]*display:\s*inline-flex;[^}]*order:\s*3;/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 700px\)[\s\S]*?\.runnerSocials\s*\{[^}]*order:\s*4;/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 360px\)[\s\S]*?\.runnerGrid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s,
    );
    expect(styles).toMatch(
      /\.revealedGrid \.runnerCard:nth-child\(n \+ 5\)\s*\{[^}]*display:\s*none;/s,
    );
    expect(source).not.toContain("styles.runnerIndex");
    expect(source).not.toContain("styles.sortReadout");
    expect(source).not.toContain("styles.pageKicker");
    expect(styles).not.toContain(".runnerIndex");
    expect(styles).not.toContain(".sortReadout");
    expect(styles).not.toContain("#a83f64");
    expect(styles).toMatch(
      /\.runnerHeading h3\s*\{[^}]*line-height:\s*1\.15;/s,
    );
    expect(source).toContain(
      '"(max-width: 520px) calc((100vw - 38px) / 2), (max-width: 900px) calc((100vw - 48px) / 2), (max-width: 1280px) calc((100vw - 88px) / 3), 416px"',
    );
    expect(source).toContain("preserveArtworkAspectRatio");
    expect(source).toContain("styles.runnerImagePreserved");
    expect(styles).toMatch(
      /\.runnerImagePreserved\s*\{[^}]*object-fit:\s*contain;[^}]*object-position:\s*center;/s,
    );
    expect(source).not.toContain("<small>CA</small>");
    expect(source).not.toContain("<AnimatedMarketCap");
    expect(source).not.toContain("FDV{token.valuationProvider");
    expect(source).toContain(
      "formatExploreContractAddress(token.tokenAddress)",
    );
    expect(source).toContain(
      "`/token/${token.tokenAddress}?chain=${viewChainId}`",
    );
    expect(source).toMatch(
      /className=\{styles\.runnerHitArea\}[\s\S]{0,160}prefetch=\{false\}/u,
    );
    expect(styles).toMatch(
      /@media \(max-width: 700px\)[\s\S]*?\.runnerHeading > span\s*\{[^}]*font-size:\s*12px;[\s\S]*?\.runnerData small\s*\{[^}]*font-size:\s*12px;[\s\S]*?\.runnerCategory,[\s\S]*?font-size:\s*12px;[\s\S]*?\.runnerContract code\s*\{[^}]*font-size:\s*12px;/s,
    );
    expect(source).not.toContain(
      "exploreUnavailableFdvLabel(token.marketStatus)",
    );
    expect(source).toContain("Copy ${token.name} contract address");
    expect(source).not.toContain("runnerMarketStatus");
  });

  it("uses flat Warm Ivory milk glass without decorative distortion", () => {
    const source = readFileSync(
      join(root, "components/explore-view.tsx"),
      "utf8",
    );
    const styles = readFileSync(
      join(root, "components/explore-experience.module.css"),
      "utf8",
    );

    expect(source).not.toContain("liquid-glass-distortion");
    expect(styles).toMatch(
      /\.runnerCard\s*\{[^}]*background:\s*rgba\(248, 240, 233, 0\.1\);/s,
    );
    expect(styles).toMatch(/\.runnerCard::before\s*\{[^}]*content:\s*none;/s);
    expect(styles).toMatch(
      /\.filterMenu\s*\{[^}]*background:\s*var\(--explore-glass-strong\);/s,
    );
    expect(styles).not.toContain("rgba(15, 18, 36, 0.84)");
    expect(styles).toMatch(
      /@media \(max-width: 700px\)[\s\S]*?\.runnerCard\s*\{[^}]*backdrop-filter:\s*none;[^}]*background:\s*rgba\(248, 240, 233, 0\.14\);/s,
    );
  });

  it("keeps one stable results status and closes the filter when focus leaves", () => {
    const source = readFileSync(
      join(root, "components/explore-view.tsx"),
      "utf8",
    );
    const styles = readFileSync(
      join(root, "components/explore-experience.module.css"),
      "utf8",
    );

    expect(source).toContain("const resultStatusRef");
    expect(source).toContain("ref={resultStatusRef}");
    expect(source).toContain('role="status"');
    expect(source).toContain('aria-atomic="true"');
    expect(source).toContain("onBlur={(event) => {");
    expect(source).toContain("!event.currentTarget.contains(nextTarget)");
    expect(source).toContain('event.currentTarget.removeAttribute("open")');
    expect(source).toContain(
      "resultStatusRef.current?.focus({ preventScroll: true })",
    );
    expect(source).toContain('className="sr-only"');
    expect(styles).not.toContain(".resultLabel");
    expect(source).toContain('return "Launch index rebuilding"');
    expect(source).not.toContain("Market data is temporarily unavailable");
    expect(source).not.toContain("Loading tokens");
    expect(source).not.toContain("Updating tokens");
    expect(source).not.toContain("Page {activePage} of {pageCount}");
    expect(source).not.toContain("Partial launch index");
    expect(source).not.toContain("Launch index may be out of date");
  });

  it("keeps phone controls readable while narrow mouse windows retain desktop popovers", () => {
    const styles = readFileSync(
      join(root, "components/explore-experience.module.css"),
      "utf8",
    );

    expect(styles).toMatch(
      /\.runnersIntro :global\(\.token-search input\)\s*\{[^}]*font-size:\s*16px;/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 700px\) and \(hover: none\) and \(pointer: coarse\)[\s\S]*?\.filterMenu,[\s\S]*?position:\s*absolute;[^}]*width:\s*min\(calc\(100vw - 28px\), 390px\);/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 700px\) and \(hover: hover\) and \(pointer: fine\)[\s\S]*?\.filterMenu,[\s\S]*?min-width:\s*230px;[^}]*position:\s*absolute;/s,
    );
  });
});
