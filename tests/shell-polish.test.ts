import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("public shell polish", () => {
  it("keeps the 404 page concise and preserves both recovery actions", () => {
    const source = read("app/not-found.tsx");

    expect(source).toContain("This page isn’t available.");
    expect(source).not.toContain("404 · Page not found");
    expect(source).toContain("Explore tokens");
    expect(source).toContain("Open docs");
  });

  it("uses one aligned footer link set without duplicate social icons", () => {
    const source = read("components/site-footer.tsx");

    expect(source).toContain("<span>Programmable</span>");
    expect(source).toContain("© 2026 Programmable");
    expect(source).toContain('label: "GitHub"');
    expect(source).toContain('href: "https://github.com/programmablehq"');
    expect(source).not.toContain('href: "https://github.com/0xprogrammable"');
    expect(source).toContain('label: "Discord"');
    expect(source).toContain('label: "X"');
    expect(source).toContain('href: "https://x.com/ProgrammableHQ"');
    expect(source).toContain('label: "DEX Screener"');
    expect(source).toContain('label: "Dune analytics"');
    expect(source).not.toContain("XBrandIcon");
    expect(source).not.toContain("GitHubBrandIcon");
  });

  it("links the public shell and structured identity to the canonical public accounts", () => {
    const navigation = read("components/site-navigation.tsx");
    const structuredData = read("lib/site-structured-data.ts");
    const rootLayout = read("app/layout.tsx");
    const homePage = read("app/page.tsx");
    const officialLinks = read("docs/public/reference/official-links.md");
    const readme = read("README.md");

    expect(navigation).toContain('href="https://github.com/programmablehq"');
    expect(navigation).toContain('href="https://x.com/ProgrammableHQ"');
    expect(navigation).not.toContain('href="https://github.com/0xprogrammable"');
    expect(structuredData).toContain('"https://github.com/programmablehq"');
    expect(structuredData).toContain('"https://x.com/ProgrammableHQ"');
    expect(structuredData).not.toContain('"https://github.com/0xprogrammable"');
    expect(rootLayout).toContain('creator: "@ProgrammableHQ"');
    expect(homePage).toContain('creator: "@ProgrammableHQ"');
    expect(officialLinks).toContain(
      "https://x.com/ProgrammableHQ",
    );
    expect(readme).toContain("https://x.com/ProgrammableHQ");
  });

  it("keeps the retired X identity out of current public sources", () => {
    const retiredXProfile = ["https://x.com/", "0x", "programmable"].join("");
    const retiredCreator = ["@", "0x", "programmable"].join("");
    const currentPublicSources = [
      "README.md",
      "app/layout.tsx",
      "app/page.tsx",
      "components/explore-preview-data.ts",
      "components/prediction-market-v2-local-preview.tsx",
      "components/site-footer.tsx",
      "components/site-navigation.tsx",
      "config/creator-article-programmable-example.v1.json",
      "docs/public/reference/official-links.md",
      "lib/site-structured-data.ts",
      "lib/token-detail-metadata.ts",
    ].map((path) => read(path).toLowerCase());

    for (const source of currentPublicSources) {
      expect(source).not.toContain(retiredXProfile);
      expect(source).not.toContain(retiredCreator);
    }
  });

  it("keeps route changes steady and announces the new heading", () => {
    const source = read("components/route-transition.tsx");
    const interfaceStyles = read("app/interface.css");

    expect(source).not.toContain("content.animate(");
    expect(source).not.toContain("key={pathname}");
    expect(source).toContain('heading.dataset.routeAnnouncementFocus = "true"');
    expect(interfaceStyles).toMatch(
      /\.route-transition h1\[tabindex="-1"\]:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--brand-ivory\);/s,
    );
  });

  it("renders one shared footer after every route and keeps it below the fold", () => {
    const shell = read("components/app-shell.tsx");
    const explore = read("components/explore-view.tsx");
    const docsLayout = read("app/docs/layout.tsx");
    const finalStyles = read("app/webde-final-ui.css");

    expect(shell).toContain("<RouteTransition>{children}</RouteTransition>");
    expect(shell).toContain("<SiteFooter />");
    expect(shell.indexOf("<SiteFooter />")).toBeGreaterThan(
      shell.indexOf("<RouteTransition>{children}</RouteTransition>"),
    );
    expect(explore).not.toContain("<SiteFooter />");
    expect(docsLayout).not.toContain("<SiteFooter />");
    expect(finalStyles).toMatch(
      /\.route-transition\s*\{[^}]*min-height:\s*calc\(100svh - var\(--header-height\)\);/s,
    );
  });

  it("locks the public shell to the night atmosphere without a theme control", () => {
    const layout = read("app/layout.tsx");
    const navigation = read("components/site-navigation.tsx");

    expect(layout).toContain('colorScheme: "dark"');
    expect(layout).toContain('data-theme="dark"');
    expect(navigation).not.toContain("ThemeToggle");
    expect(navigation).not.toContain("activeThemeViewTransition");
  });

  it("avoids unbounded transitions in the owned style sheets", () => {
    const css = [
      read("app/globals.css"),
      read("app/not-found.module.css"),
      read("components/site-footer.module.css"),
    ].join("\n");

    expect(css).not.toMatch(/transition(?:-property)?:\s*all\b/);
  });
});
