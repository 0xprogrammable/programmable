import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const docsCss = read("components/docs-experience.module.css");
const docsShell = read("components/docs-shell.tsx");
const docsNavigation = read("components/docs-navigation.tsx");
const developerOverview = read("app/docs/developers/page.tsx");
const verifyPage = read("app/docs/developers/verify/page.tsx");
const indexingPage = read("app/docs/developers/indexing/page.tsx");
const machineReadablePage = read(
  "app/docs/developers/machine-readable/page.tsx",
);
const interfaceCss = read("app/interface.css");

describe("Docs reference layout stability", () => {
  it("keeps a sticky 252px tree beside a 680px article and 220px page outline", () => {
    expect(docsCss).toMatch(
      /\.page\s*\{[^}]*--docs-content-width:\s*680px;[^}]*--docs-main-width:\s*948px;[^}]*--docs-rail-width:\s*252px;[^}]*--docs-toc-width:\s*220px;/s,
    );
    expect(docsCss).toMatch(
      /\.page\s*\{[^}]*grid-template-columns:[^}]*var\(--docs-rail-width\)[^}]*minmax\(0,\s*var\(--docs-main-width\)\);/s,
    );
    expect(docsCss).toMatch(
      /\.layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*var\(--docs-content-width\)\)\s*var\(\s*--docs-toc-width\s*\);/s,
    );
    expect(docsCss).toMatch(
      /\.sidebar\s*\{[^}]*grid-column:\s*1;[^}]*inline-size:\s*var\(--docs-rail-width\);[^}]*position:\s*sticky;[^}]*top:\s*calc\(var\(--header-height\) \+ 20px\);/s,
    );
    expect(docsCss).toMatch(
      /\.mainColumn\s*\{[^}]*grid-column:\s*2;[^}]*min-width:\s*0;/s,
    );
    expect(docsCss).toMatch(
      /\.pageNavigation\s*\{[^}]*position:\s*sticky;[^}]*top:\s*calc\(var\(--header-height\) \+ 28px\);/s,
    );
  });

  it("uses restrained documentation typography instead of display-scale headings", () => {
    expect(docsCss).toMatch(
      /\.page\s*\{[^}]*font-family:\s*var\(--font-instrument\), Arial, sans-serif;/s,
    );
    expect(docsCss).toMatch(
      /\.hero h1\s*\{[^}]*font-size:\s*clamp\(30px,\s*2\.4vw,\s*34px\);[^}]*line-height:\s*1\.24;/s,
    );
    expect(docsCss).toMatch(
      /\.content h2\s*\{[^}]*font-size:\s*26px;[^}]*line-height:\s*1\.28;/s,
    );
    expect(docsCss).toMatch(
      /\.content p\s*\{[^}]*font-size:\s*16px;[^}]*line-height:\s*1\.65;/s,
    );
    expect(docsCss).toMatch(
      /\.navGroup a\s*\{[^}]*font-size:\s*14px;[^}]*min-height:\s*36px;/s,
    );
  });

  it("keeps focus visible when navigation moves into an article section", () => {
    expect(docsCss).toMatch(
      /\.content h2\[tabindex="-1"\]:focus-visible,[\s\S]*?outline:\s*2px solid var\(--focus\);/,
    );
    expect(docsCss).toMatch(
      /:global\(\.route-transition-docs\)[\s\S]*?h1\[tabindex="-1"\]:focus-visible[\s\S]*?\{[^}]*outline:\s*2px solid var\(--focus\);/s,
    );
    expect(docsCss).not.toContain(
      '.content h2[tabindex="-1"]:focus,\n.content h3[tabindex="-1"]:focus {\n  outline: none;',
    );
  });

  it("keeps desktop search in the rail and supplies a separate mobile search", () => {
    expect(docsShell).toContain("data-docs-tools");
    expect(docsShell).toContain("styles.sidebarSearch");
    expect(docsShell).toContain(
      'mobileSearch={<DocsSearch id="docs-search-mobile" />}',
    );
    expect(docsCss).toMatch(
      /\.sidebarSearch,\s*\.sidebarSearch \.search\s*\{[^}]*width:\s*100%;/s,
    );
    expect(docsCss).toMatch(
      /@media \(max-width:\s*1023px\)[\s\S]*?\.sidebarBrand,\s*\.sidebarSearch\s*\{[^}]*display:\s*none;/s,
    );
    expect(docsNavigation).toContain("[data-docs-mobile-tools]");
  });

  it("keeps mobile navigation in the content flow and opens its tree in a bottom sheet", () => {
    expect(docsCss).toMatch(
      /@media \(max-width:\s*1279px\)[\s\S]*?\.pageNavigation\s*\{[^}]*order:\s*-1;[^}]*position:\s*static;/s,
    );
    expect(docsCss).toMatch(
      /@media \(min-width:\s*1024px\) and \(max-width:\s*1279px\)[\s\S]*?\.atmosphere-plant-left\),[\s\S]*?\.atmosphere-plant-right\)\s*\{[^}]*transform:\s*none;/s,
    );
    expect(docsCss).toMatch(
      /@media \(max-width:\s*1023px\)[\s\S]*?\.sidebar\s*\{[^}]*inline-size:\s*auto;[^}]*inset-inline:\s*auto;[^}]*margin-block-end:\s*52px;[^}]*position:\s*sticky;[^}]*top:\s*calc\(var\(--header-height\) \+ 6px\);/s,
    );
    expect(docsCss).toMatch(
      /@media \(max-width:\s*1023px\)[\s\S]*?\.desktopNav\s*\{[^}]*display:\s*none;[\s\S]*?\.mobileNavDialog\[open\]\s*\{[^}]*display:\s*grid;/s,
    );
    expect(docsCss).toMatch(
      /\.mobileNavPanel\s*\{[^}]*border-radius:\s*18px 18px 0 0;[^}]*max-height:\s*min\(86svh, 760px\);/s,
    );
    expect(docsCss).toMatch(
      /@media \(max-width:\s*700px\)[\s\S]*?\.sidebar\s*\{[^}]*margin-block-end:\s*40px;/s,
    );
    expect(docsNavigation).toContain("dialog.showModal()");
    expect(docsNavigation).toContain(
      "if (event.target === event.currentTarget)",
    );
  });

  it("does not animate the whole Docs shell during route changes", () => {
    expect(interfaceCss).toMatch(
      /\.route-transition-docs\s*\{\s*animation:\s*none;\s*\}/s,
    );
    expect(docsShell).toContain("data-docs-sidebar");
    expect(docsShell).toContain("data-docs-content");
    expect(docsShell.indexOf("data-docs-sidebar")).toBeLessThan(
      docsShell.indexOf("data-docs-tools"),
    );
    expect(docsShell.indexOf("data-docs-tools")).toBeLessThan(
      docsShell.indexOf("data-docs-hero"),
    );
  });

  it("keeps overview, verification, indexing and machine docs in one shell", () => {
    for (const [source, sections, path, title] of [
      [
        developerOverview,
        "developerSections",
        "/docs/developers",
        "Integrate Programmable launches",
      ],
      [
        verifyPage,
        "verifySections",
        "/docs/developers/verify",
        "Verify a token or pool",
      ],
      [
        indexingPage,
        "indexingSections",
        "/docs/developers/indexing",
        "Index new launches",
      ],
      [
        machineReadablePage,
        "machineSections",
        "/docs/developers/machine-readable",
        "Machine-readable docs",
      ],
    ] as const) {
      expect(source).toContain(`sections={${sections}}`);
      expect(source).toContain(`currentPath="${path}"`);
      expect(source).toContain(`title="${title}"`);
      expect(source).not.toContain("DeveloperDocsWorkbench");
    }

    expect(docsShell).toContain("<DocsNavigation");
    expect(docsShell).toContain("<DocsPageNavigation");
    expect(docsShell).toContain('aria-label="Breadcrumb"');
    expect(docsNavigation).toContain("renderGlobalNavigation");
    expect(docsNavigation).toContain("renderMobileNavigation");
  });
});
