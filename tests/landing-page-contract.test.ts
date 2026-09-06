import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("landing page contract", () => {
  it("keeps the landing page at home and sends the header Explore link to the selected chain directory", () => {
    const homePage = read("app/page.tsx");
    const explorePage = read("app/explore/page.tsx");
    const chainPage = read("app/explore/[chain]/page.tsx");
    const navigation = read("components/site-navigation.tsx");

    expect(homePage).toContain("import { LandingPage }");
    expect(homePage).toContain("return <LandingPage />");
    expect(explorePage).toContain("redirect(exploreChainPath(");
    expect(explorePage).toContain('canonical: "/explore"');
    expect(chainPage).toContain("import { RobinhoodLaunchesView }");
    expect(chainPage).toContain("<RobinhoodLaunchesView chainId={chainId} />");
    expect(chainPage).toContain("canonical: exploreChainPath(chainId)");
    expect(navigation).toContain('{ href: "/explore", label: "Explore" }');
    expect(navigation).toContain('href="/"');
    expect(homePage).toContain('"Build and launch custom Uniswap v4 hooks.');
    expect(homePage).toContain("description: pageDescription");
    expect(homePage).toContain("openGraph:");
    expect(homePage).toContain("twitter:");
  });

  it("uses one black star field across routes and one exact floral landing foreground", () => {
    const landing = read("components/landing-page.tsx");
    const backdrop = read("components/atmosphere-backdrop.tsx");
    const finalStyles = read("app/webde-final-ui.css");
    const layout = read("app/layout.tsx");
    const manifest = read("public/site.webmanifest");

    expect(backdrop).not.toContain('"use client"');
    expect(backdrop).not.toContain("<video");
    expect(backdrop).toContain("const TWINKLE_COUNT = 24");
    expect(backdrop).toContain("const LOWER_TWINKLE_COUNT = 8");
    expect(backdrop).toContain("const DENSE_TWINKLE_COUNT = 12");
    expect(backdrop).toContain("const ACCENT_TWINKLE_COUNT = 4");
    expect(backdrop).not.toContain("atmosphere-botanicals");
    expect(backdrop).toContain('aria-hidden="true"');
    expect(finalStyles).toMatch(
      /\.atmosphere-backdrop\s*\{[^}]*background:\s*var\(--webde-canvas\);/s,
    );
    expect(finalStyles).toMatch(
      /\.atmosphere-ground-glow,[\s\S]*?\.atmosphere-botanicals,[\s\S]*?\.atmosphere-veil\s*\{[^}]*display:\s*none;/s,
    );
    expect(layout).toContain('themeColor: "#000000"');
    expect(manifest).toContain('"background_color": "#000000"');
    expect(manifest).toContain('"theme_color": "#000000"');

    expect(landing).toContain(
      'src="/brand/atmosphere/programmable-floral-foreground-v1.avif"',
    );
    expect(landing).toContain("const HERO_TWINKLE_COUNT = 120");
    expect(landing).toContain("const duration = 2.8");
    expect(landing).toContain('<h1 id="landing-title">Programmable</h1>');
    expect(landing).toContain("Build and launch custom Uniswap v4 hooks");
    expect(landing).toContain('id="intro"');
    expect(landing).toContain('href="#explore"');
    expect(landing).toContain('id="explore"');
    expect(landing).toContain("<LandingExploreGate />");
    expect(landing).not.toContain("liquid-glass-distortion");

    for (const asset of [
      "programmable-floral-foreground-v1.avif",
      "programmable-floral-hooks-v1.avif",
    ]) {
      const assetPath = join(root, "public/brand/atmosphere", asset);
      expect(existsSync(assetPath)).toBe(true);
      expect(statSync(assetPath).size).toBeLessThan(2 * 1024 * 1024);
    }

    for (const [asset, maximumBytes] of [
      ["programmable-floral-foreground-v1.avif", 1_000_000],
      ["programmable-floral-foreground-tablet-v1.avif", 550_000],
      ["programmable-floral-foreground-mobile-v1.avif", 400_000],
    ] as const) {
      expect(
        statSync(join(root, "public/brand/atmosphere", asset)).size,
      ).toBeLessThan(maximumBytes);
    }
  });

  it("renders the Robinhood list without loading the old Explore bundle", () => {
    const landing = read("components/landing-page.tsx");
    const gate = read("components/landing-explore-gate.tsx");
    const resetView = read("components/explore-index-reset-view.tsx");
    const styles = read("components/landing-page.module.css");

    expect(landing).not.toContain('from "@/components/explore-view"');
    expect(landing).toContain('from "@/components/landing-explore-gate"');
    expect(gate).toContain("<RobinhoodLaunchesView embedded />");
    expect(gate).not.toContain('import("@/components/explore-view")');
    expect(gate).not.toContain("IntersectionObserver");
    expect(gate).not.toContain("Try again");
    expect(resetView).toContain(
      "<Heading data-explore-heading>Explore</Heading>",
    );
    expect(resetView).toContain("No token data is loaded");
    expect(styles).toMatch(
      /\.exploreGate\s*\{[^}]*min-height:\s*calc\(100svh - var\(--header-height\)\);/s,
    );
  });

  it("keeps each landing chapter full-screen, readable and motion safe", () => {
    const landing = read("components/landing-page.tsx");
    const styles = read("components/landing-page.module.css");

    expect(styles).toMatch(
      /\.hero\s*\{[^}]*min-height:\s*calc\(100svh - 88px\);/s,
    );
    expect(styles).toMatch(/\.hero\s*\{[^}]*z-index:\s*1;/s);
    expect(styles).toMatch(/\.scrollCue\s*\{[^}]*min-height:\s*52px;/s);
    expect(styles).toMatch(
      /\.hero h1\s*\{[^}]*font-size:\s*clamp\(64px, 7\.2vw, 104px\);/s,
    );
    expect(styles).toContain("object-position: center bottom;");
    expect(styles).not.toContain("mask-image:");
    expect(styles).not.toContain("translateY(27vh)");
    expect(styles).not.toContain("translateY(31vh)");
    expect(landing).toContain("new IntersectionObserver(");
    expect(landing).toContain('rootMargin: "0px 0px 48% 0px"');
    expect(landing).toContain("useLayoutEffect(() =>");
    expect(landing).toContain('if (window.location.hash === "")');
    expect(landing).toContain(
      'window.scrollTo({ behavior: "auto", left: 0, top: 0 })',
    );
    expect(landing).toContain('window.location.hash !== "#explore"');
    expect(landing).toContain(
      'document.querySelector<HTMLElement>(".header-inner")',
    );
    expect(landing).toContain(
      'chapter?.querySelector<HTMLElement>("[data-explore-heading]")',
    );
    expect(landing).toContain('chapter.dataset.visible = "true"');
    expect(landing).toContain('window.scrollTo({ behavior: "auto"');
    expect(landing).toContain("data-reveal-section");
    expect(landing).not.toContain('addEventListener("wheel"');
    expect(landing).not.toContain('addEventListener("scroll"');
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.scrollCue span:last-child\s*\{[^}]*animation:\s*none;/,
    );
  });

  it("restores native document scrolling instead of trapping the landing route", () => {
    const styles = read("components/landing-page.module.css");
    const globalStyles = read("app/globals.css");
    const interfaceStyles = read("app/interface.css");

    expect(styles).toMatch(
      /:global\(body \.app-frame\):has\(\.page\)\s*\{[^}]*height:\s*auto;[^}]*overflow-x:\s*clip;[^}]*overflow-y:\s*visible;/s,
    );
    expect(styles).toMatch(
      /:global\(body \.app-frame\):has\(\.page\) > :global\(main\)\s*\{[^}]*height:\s*auto;[^}]*overflow-x:\s*clip;[^}]*overflow-y:\s*visible;/s,
    );
    expect(styles).toMatch(
      /:global\(body \.app-frame\):has\(\.page\) :global\(\.route-transition\)\s*\{[^}]*height:\s*auto;[^}]*overflow-x:\s*clip;[^}]*overflow-y:\s*visible;/s,
    );
    expect(globalStyles).toMatch(/html\s*\{[^}]*overflow-x:\s*clip;/s);
    expect(globalStyles).toMatch(/body\s*\{[^}]*overflow-x:\s*clip;/s);
    expect(globalStyles).toMatch(/\.app-frame\s*\{[^}]*overflow-x:\s*clip;/s);
    expect(interfaceStyles).not.toMatch(
      /\.app-frame:has\(\.landing-page-root\)[^{]*\{[^}]*overflow:\s*hidden;/s,
    );
    expect(interfaceStyles).not.toMatch(
      /\.app-frame:has\(\.landing-page-root\) > main\s*\{[^}]*overflow:\s*hidden;/s,
    );
    expect(interfaceStyles).not.toMatch(
      /\.app-frame:has\(\.landing-page-root\) \.route-transition\s*\{[^}]*overflow:\s*hidden;/s,
    );
  });

  it("keeps the star shimmer small and active while reduced motion disables it", () => {
    const backdrop = read("components/atmosphere-backdrop.tsx");
    const interfaceStyles = read("app/interface.css");
    const finalStyles = read("app/webde-final-ui.css");

    expect(backdrop).toContain("const TWINKLE_COUNT = 24");
    expect(backdrop).toContain("const LOWER_TWINKLE_COUNT = 8");
    expect(backdrop).toContain("const DENSE_TWINKLE_COUNT = 12");
    expect(backdrop).toContain("const ACCENT_TWINKLE_COUNT = 4");
    expect(backdrop).toContain("Array.from({ length: TWINKLE_COUNT }");
    expect(backdrop).toContain("Array.from({ length: LOWER_TWINKLE_COUNT }");
    expect(backdrop).toContain("const duration = 4.6");
    expect(backdrop).toContain("const size = 0.64 + sizeStep + emphasis");
    expect(interfaceStyles).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)[\s\S]*?\.atmosphere-sparkles i\s*\{[^}]*animation:\s*var\(--sparkle-animation\)/,
    );
    expect(interfaceStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.atmosphere-sparkles i\s*\{[^}]*animation:\s*none;/,
    );
    expect(finalStyles).toMatch(
      /\.atmosphere-sparkles i\s*\{[^}]*box-shadow:\s*0 0 2\.5px/s,
    );
    expect(finalStyles).not.toContain("cross");
  });

  it("uses normal client navigation for the home logo", () => {
    const navigation = read("components/site-navigation.tsx");

    expect(navigation).toContain('aria-label="Programmable home"');
    expect(navigation).toContain('href="/"');
    expect(navigation).not.toContain("function restartHome(");
    expect(navigation).not.toContain('window.location.assign("/")');
  });

  it("opens Explore as its own route from the shared topbar", () => {
    const navigation = read("components/site-navigation.tsx");

    expect(navigation).toContain('{ href: "/explore", label: "Explore" }');
    expect(navigation).not.toContain("prepareLandingExploreNavigation(");
    expect(navigation).not.toContain(
      'window.history.pushState(null, "", "/#explore")',
    );
  });

  it("uses fluid shared gutters instead of a desktop to mobile width jump", () => {
    const finalStyles = read("app/webde-final-ui.css");

    expect(finalStyles).toContain("calc(100% - clamp(2rem, 5vw, 5rem))");
  });
});
