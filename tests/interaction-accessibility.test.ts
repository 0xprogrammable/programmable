import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  getPriceHistoryEmptyMessage,
  shouldRenderPriceHistory,
} from "../components/token-price-chart";

const root = process.cwd();

describe("interaction accessibility", () => {
  it("makes exact chart prices available to pointer and keyboard input", () => {
    const chartCss = readFileSync(
      join(root, "components/token-price-chart.module.css"),
      "utf8",
    );
    const chartSource = readFileSync(
      join(root, "components/token-price-chart.tsx"),
      "utf8",
    );

    expect(chartCss).not.toContain("cursor: crosshair");
    expect(chartSource).toContain("onPointerMove={inspectPointer}");
    expect(chartSource).toContain("onKeyDown={inspectKeyboard}");
    expect(chartSource).toContain('role="group"');
    expect(chartSource).toContain("tabIndex={0}");
    expect(chartSource).not.toContain('role="slider"');
  });

  it("keeps primary token interactions at a reliable touch size", () => {
    const tokenSource = readFileSync(
      join(root, "components/token-detail-view.tsx"),
      "utf8",
    );
    const tokenCss = readFileSync(
      join(root, "components/token-experience.module.css"),
      "utf8",
    );
    const chartCss = readFileSync(
      join(root, "components/token-price-chart.module.css"),
      "utf8",
    );

    expect(tokenCss).toMatch(/\.back\s*\{[^}]*min-height:\s*44px;/s);
    expect(tokenCss).toMatch(/\.address\s*\{[^}]*min-height:\s*44px;/s);
    expect(tokenCss).toMatch(/\.slippageControl\s*\{[^}]*min-height:\s*44px;/s);
    expect(tokenCss).toMatch(
      /\.slippageControl input\s*\{[^}]*min-height:\s*44px;/s,
    );
    expect(chartCss).toMatch(
      /\.rangeButton\s*\{[^}]*height:\s*44px;[^}]*min-width:\s*44px;/s,
    );
    expect(tokenSource).toContain(
      "<section\n      className={styles.tradeForm}",
    );
    expect(tokenSource).toContain(
      "className={`${styles.links} ${styles.addressLinks}`}",
    );
    expect(tokenSource).toContain("aria-label={`${token.name} links`}");
    expect(tokenSource).toContain(
      "<nav className={styles.links} aria-label={`${project.name} links`}>",
    );
  });

  it("keeps Explore card and pagination actions at a reliable touch size", () => {
    const exploreCss = readFileSync(
      join(root, "components/explore-experience.module.css"),
      "utf8",
    );

    expect(exploreCss).toMatch(
      /\.runnerCopyButton\s*\{[^}]*height:\s*44px;[^}]*width:\s*44px;/s,
    );
    expect(exploreCss).toMatch(
      /\.runnerSocialLink\s*\{[^}]*height:\s*44px;[^}]*width:\s*44px;/s,
    );
    expect(exploreCss).toMatch(
      /\.runnersIntro :global\(\.token-pagination > button\)\s*\{[^}]*height:\s*44px;[^}]*width:\s*44px;/s,
    );
  });

  it("removes decorative token separators and image-edge outlines", () => {
    const tokenCss = readFileSync(
      join(root, "components/token-experience.module.css"),
      "utf8",
    );
    const exploreCss = readFileSync(
      join(root, "components/explore-experience.module.css"),
      "utf8",
    );
    const launchCss = readFileSync(
      join(root, "components/launch-experience.module.css"),
      "utf8",
    );

    expect(tokenCss).not.toContain("border-bottom:");
    expect(tokenCss).not.toContain("border-top:");
    expect(exploreCss).not.toMatch(/\.runnerArt\s*\{[^}]*outline:/s);
    expect(launchCss).not.toMatch(/\.modelArt\s*\{[^}]*outline:/s);
  });

  it("uses a pointer only for controls that can be activated", () => {
    const interfaceCss = readFileSync(join(root, "app/interface.css"), "utf8");

    expect(interfaceCss).toContain(
      ":is(a[href], button:not(:disabled), summary, select)",
    );
    expect(interfaceCss).toMatch(
      /:is\(a\[href\], button:not\(:disabled\), summary, select\)\s*\{[^}]*cursor:\s*pointer;/s,
    );
    expect(interfaceCss).toMatch(
      /:is\(button:disabled, \[aria-disabled="true"\]\)\s*\{[^}]*cursor:\s*default;/s,
    );
  });

  it("keeps the interface dark-only without exposing a theme toggle", () => {
    const source = readFileSync(
      join(root, "components/site-navigation.tsx"),
      "utf8",
    );
    const layout = readFileSync(join(root, "app/layout.tsx"), "utf8");

    expect(layout).toContain('data-theme="dark"');
    expect(layout).toContain('colorScheme: "dark"');
    expect(layout).not.toContain("themeInitializationScript");
    expect(source).not.toContain("ThemeToggle");
    expect(source).not.toContain("programmable-theme");
  });

  it("stops decorative atmosphere motion for reduced-motion users", () => {
    const source = readFileSync(
      join(root, "components/atmosphere-backdrop.tsx"),
      "utf8",
    );
    const css = readFileSync(join(root, "app/interface.css"), "utf8");

    expect(source).toContain('className="atmosphere-stars');
    expect(source).toContain("const TWINKLE_COUNT = 24");
    expect(source).toContain("const LOWER_TWINKLE_COUNT = 8");
    expect(source).toContain("const DENSE_TWINKLE_COUNT = 12");
    expect(source).toContain("const ACCENT_TWINKLE_COUNT = 4");
    expect(source).toContain("Array.from({ length: TWINKLE_COUNT }");
    expect(css).not.toMatch(
      /\.atmosphere-stars-(?:primary|secondary)\s*\{[^}]*animation:/s,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)[\s\S]*?\.atmosphere-sparkles i\s*\{[^}]*animation:\s*var\(--sparkle-animation\)/,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.atmosphere-sparkles i\s*\{[^}]*animation:\s*none;/,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.atmosphere-plant\s*\{[^}]*animation:\s*none;[^}]*transform:\s*none;[^}]*will-change:\s*auto;/,
    );
  });

  it("exposes the wallet actions as a native, labelled disclosure", () => {
    const source = readFileSync(
      join(root, "components/wallet-provider.tsx"),
      "utf8",
    );

    expect(source).toContain('href="/profile"');
    expect(source).toContain("aria-controls={wallet ? menuId : undefined}");
    expect(source).toContain('role="group"');
    expect(source).toContain('aria-label="Wallet actions"');
    expect(source).toContain("event.relatedTarget instanceof Node");
    expect(source).toContain(
      "event.currentTarget.contains(event.relatedTarget)",
    );
  });

  it("dismisses the wallet disclosure with Escape and outside pointer input", () => {
    const source = readFileSync(
      join(root, "components/wallet-provider.tsx"),
      "utf8",
    );

    expect(source).toContain(
      'document.addEventListener("pointerdown", closeOnOutsidePress)',
    );
    expect(source).toContain('if (event.key === "Escape")');
    expect(source).toContain("menuButtonRef.current?.focus()");
  });

  it("keeps the shared header disclosure focused without trapping the page", () => {
    const source = readFileSync(
      join(root, "components/site-navigation.tsx"),
      "utf8",
    );

    expect(source).toContain("onBlur={closeOnFocusLeave}");
    expect(source).toContain(
      "event.currentTarget.contains(event.relatedTarget)",
    );
    expect(source).toContain("header.contains(document.activeElement)");
    expect(source).not.toContain(
      '.querySelector<HTMLElement>("a, button:not(:disabled)")',
    );
    expect(source).toContain("menuButtonRef.current?.focus()");
    expect(source).toContain('aria-haspopup={wallet ? undefined : "dialog"}');
    expect(source).toContain("aria-expanded={wallet ? menuOpen : undefined}");
  });

  it("keeps the sticky header and its wallet disclosure above page content", () => {
    const css = readFileSync(join(root, "app/interface.css"), "utf8");

    expect(css).not.toContain(".app-frame > main,\n.site-header,\n.mobile-nav");
    expect(css).toMatch(
      /\.site-header\s*\{[^}]*position:\s*sticky;[^}]*z-index:\s*50;/s,
    );
  });

  it("keeps the shared landing navigation and supporting links accessible", () => {
    const source = readFileSync(
      join(root, "components/site-navigation.tsx"),
      "utf8",
    );
    const landing = readFileSync(
      join(root, "components/landing-page.tsx"),
      "utf8",
    );
    const css = readFileSync(
      join(root, "components/landing-page.module.css"),
      "utf8",
    );

    expect(source).not.toContain('if (pathname === "/") return null;');
    expect(source).toContain('aria-label="Programmable on X"');
    expect(source).toContain('aria-label="Programmable on GitHub"');
    expect(source).toContain('aria-label="Programmable on Discord"');
    expect(source).toContain('aria-label="Programmable on DEX Screener"');
    expect(landing).toContain('href="#explore"');
    expect(css).toMatch(/\.scrollCue\s*\{[^}]*min-height:\s*52px;/s);
  });

  it("keeps primary and secondary routes semantic in mobile navigation", () => {
    const source = readFileSync(
      join(root, "components/site-navigation.tsx"),
      "utf8",
    );
    const styleSheets = [
      readFileSync(join(root, "app/interface.css"), "utf8"),
      readFileSync(join(root, "app/globals.css"), "utf8"),
    ];
    const interfaceCss = styleSheets[0];
    const mobileMediaSegments = styleSheets.flatMap((css) => {
      const segments: string[] = [];
      const query = "@media (max-width: 800px)";
      let start = css.indexOf(query);
      while (start >= 0) {
        const next = css.indexOf("\n@media ", start + query.length);
        segments.push(css.slice(start, next >= 0 ? next : css.length));
        start = css.indexOf(query, start + query.length);
      }
      return segments;
    });

    expect(source).toContain("const mobileNavItems = [...desktopNavItems, ...menuNavItems];");
    expect(source).toContain('{ href: "/profile", label: "Profile" },');
    expect(source).not.toContain('{ href: "/migration", label: "Migrate" },');
    expect(source).not.toContain("/hookathon");
    expect(source).toContain(
      '<nav className="mobile-nav" aria-label="Menu navigation">',
    );
    expect(source).toContain('aria-current={current ? "page" : undefined}');
    expect(source).not.toContain('<Icon aria-hidden="true"');
    expect(source).toContain("<span>{item.label}</span>");
    expect(mobileMediaSegments).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /\.mobile-nav\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/,
        ),
        expect.stringMatching(
          /\.mobile-nav\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*height:\s*56px/,
        ),
        expect.stringMatching(
          /\.mobile-nav a\s*\{[^}]*min-height:\s*48px;[^}]*min-width:\s*0/,
        ),
      ]),
    );
    expect(interfaceCss).toMatch(
      /\.wordmark,\s*\.header-social-link\s*\{[^}]*height:\s*44px;[^}]*width:\s*44px;/s,
    );
    expect(interfaceCss).toMatch(
      /@media \(max-width: 800px\)[\s\S]*?\.header-actions \.wallet-button\s*\{[^}]*height:\s*44px;[^}]*min-height:\s*44px;/s,
    );
    expect(interfaceCss).toMatch(
      /@media \(max-width: 800px\)[\s\S]*?\.mobile-nav\s*\{[^}]*inset-inline-end:\s*max\(12px, env\(safe-area-inset-right\)\);[^}]*inset-inline-start:\s*max\(12px, env\(safe-area-inset-left\)\);/s,
    );
    expect(interfaceCss).toMatch(
      /@media \(max-width: 800px\)[\s\S]*?\.mobile-nav a::before\s*\{[^}]*background:\s*var\(--brand-ivory\);/s,
    );
    expect(
      interfaceCss.match(
        /text-shadow:\s*-1px -1px 0 rgba\(1, 5, 20, 0\.82\),[\s\S]*?1px 1px 0 rgba\(1, 5, 20, 0\.82\),[\s\S]*?0 2px 12px rgba\(1, 5, 20, 0\.92\);/g,
      ),
    ).toHaveLength(2);
    expect(
      interfaceCss.match(
        /box-shadow:\s*0 0 0 1px rgba\(1, 5, 20, 0\.9\),\s*0 2px 8px rgba\(1, 5, 20, 0\.72\);/g,
      ),
    ).toHaveLength(2);
    expect(interfaceCss).toMatch(
      /@media \(max-width: 370px\)[\s\S]*?\.wallet-button-compact\s*\{[^}]*max-width:\s*112px;[^}]*min-width:\s*44px;[^}]*width:\s*auto;/s,
    );
    expect(interfaceCss).not.toMatch(
      /@media \(max-width: 370px\)[\s\S]*?\.wallet-button-compact > span,[\s\S]*?display:\s*none;/s,
    );
    expect(interfaceCss).toMatch(
      /@media \(max-width: 370px\)[\s\S]*?\.mobile-nav a\s*\{[^}]*font-size:\s*11px;[^}]*letter-spacing:\s*-0\.025em;/s,
    );
  });

  it("fails the public Classic launch card closed when its verified release is unavailable", () => {
    const source = readFileSync(
      join(root, "components/launch-entry.tsx"),
      "utf8",
    );

    expect(source).toContain(
      "disabled={!classicV3LaunchAvailable || preparingModel !== null}",
    );
    expect(source).toContain(
      'model === "classic-v3" && !classicV3LaunchAvailable',
    );
    expect(source).not.toContain(
      'classicV3LaunchAvailable ? "classic-v3" : "classic"',
    );
  });

  it("does not promise unsupported Stock-Paired chart history", () => {
    expect(getPriceHistoryEmptyMessage("stock-paired", false)).toBe(
      "Historical price data is not available for Stock-Paired tokens",
    );
    expect(getPriceHistoryEmptyMessage("classic", false)).toBe("");
  });

  it("keeps the chart surface available without price history", () => {
    expect(
      shouldRenderPriceHistory({
        loading: false,
        hasChart: false,
        range: "all",
      }),
    ).toBe(true);
    expect(
      shouldRenderPriceHistory({
        loading: false,
        hasChart: false,
        range: "1h",
      }),
    ).toBe(true);
  });
});
