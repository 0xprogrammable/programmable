import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  docsCategories,
  docsNavigation as docsNavigationTree,
} from "../components/docs-data";
import sitemap from "../app/sitemap";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const docsIndex = read("app/docs/page.tsx");
const tokensPage = read("app/docs/tokens/page.tsx");
const economicsPage = read("app/docs/economics/page.tsx");
const v4TokenPage = read("app/docs/v4-token/page.tsx");
const trustPage = read("app/docs/trust/page.tsx");
const statusPage = read("app/docs/status/page.tsx");
const creatorsPage = read("app/docs/creators/page.tsx");
const creatorLaunchPage = read("app/docs/creators/launch/page.tsx");
const creatorTemplatesPage = read("app/docs/creators/templates/page.tsx");
const creatorEarningsPage = read("app/docs/creators/earnings/page.tsx");
const creatorProgramsPage = read("app/docs/creators/programs/page.tsx");
const infrastructurePage = read("app/docs/infrastructure/page.tsx");
const developerOverview = read("app/docs/developers/page.tsx");
const customLaunchPage = read("app/docs/developers/custom-launch/page.tsx");
const verifyPage = read("app/docs/developers/verify/page.tsx");
const indexingPage = read("app/docs/developers/indexing/page.tsx");
const machineReadablePage = read(
  "app/docs/developers/machine-readable/page.tsx",
);
const docsShell = read("components/docs-shell.tsx");
const docsNavigation = read("components/docs-navigation.tsx");
const docsSearch = read("components/docs-search.tsx");
const docsCss = read("components/docs-experience.module.css");

describe("Docs information architecture", () => {
  it("uses one canonical project overview instead of redirecting to a specialist guide", () => {
    expect(docsIndex).toContain('alternates: { canonical: "/docs" }');
    expect(docsIndex).toContain('title="Programmable"');
    expect(docsIndex).not.toContain("redirect(");
    expect(sitemap().map((entry) => entry.url)).toContain(
      "https://programmable.market/docs",
    );
  });

  it("keeps one global hierarchy for Programmable, creators and developers", () => {
    expect(docsCategories.map(({ href, label }) => ({ href, label }))).toEqual([
      { href: "/docs", label: "Programmable" },
      { href: "/docs/creators", label: "Creators" },
      { href: "/docs/developers", label: "Developers" },
    ]);

    expect(
      docsNavigationTree.map((group) => ({
        label: group.label,
        routes: group.items.map((item) => ({
          depth: item.depth ?? 0,
          href: item.href,
          label: item.label,
        })),
      })),
    ).toEqual([
      {
        label: "Programmable",
        routes: [
          { depth: 0, href: "/docs", label: "Overview" },
          { depth: 0, href: "/docs/tokens", label: "Launch models" },
          { depth: 1, href: "/docs/models/classic", label: "Classic" },
          { depth: 1, href: "/docs/models/custom", label: "Custom hooks" },
          {
            depth: 1,
            href: "/docs/models/stock-paired",
            label: "Stock-Paired",
          },
          { depth: 0, href: "/docs/economics", label: "Economics" },
          { depth: 0, href: "/docs/v4-token", label: "V4 token" },
          { depth: 0, href: "/docs/infrastructure", label: "How it works" },
          {
            depth: 1,
            href: "/docs/launch-stamps",
            label: "Launch Stamp Router",
          },
          { depth: 0, href: "/docs/trust", label: "Trust" },
          { depth: 0, href: "/docs/status", label: "Service health" },
        ],
      },
      {
        label: "Creators",
        routes: [
          { depth: 0, href: "/docs/creators", label: "Overview" },
          {
            depth: 1,
            href: "/docs/creators/launch",
            label: "Launch a project",
          },
          {
            depth: 1,
            href: "/docs/creators/templates",
            label: "Public template policy",
          },
          {
            depth: 1,
            href: "/docs/creators/earnings",
            label: "Earnings",
          },
          {
            depth: 1,
            href: "/docs/creators/programs",
            label: "Programs",
          },
        ],
      },
      {
        label: "Developers",
        routes: [
          { depth: 0, href: "/docs/developers", label: "Overview" },
          {
            depth: 1,
            href: "/docs/developers/custom-launch",
            label: "Custom Launch API",
          },
          {
            depth: 1,
            href: "/docs/developers/module-mode",
            label: "Build a module",
          },
          {
            depth: 1,
            href: "/developer-reference/robinhood-terminal-indexer",
            label: "Robinhood terminal integration",
          },
          {
            depth: 1,
            href: "/docs/developers/verify",
            label: "Verify a token or pool",
          },
          {
            depth: 1,
            href: "/docs/developers/indexing",
            label: "Index new launches",
          },
          {
            depth: 1,
            href: "/docs/developers/machine-readable",
            label: "Machine-readable docs",
          },
        ],
      },
    ]);
  });

  it("publishes every human documentation route in the sitemap", () => {
    expect(sitemap().map((entry) => entry.url)).toEqual(
      expect.arrayContaining(
        [
          "/docs",
          "/docs/economics",
          "/docs/v4-token",
          "/docs/trust",
          "/docs/status",
          "/docs/tokens",
          "/docs/infrastructure",
          "/docs/creators",
          "/docs/creators/launch",
          "/docs/creators/templates",
          "/docs/creators/earnings",
          "/docs/creators/programs",
          "/docs/developers",
          "/docs/developers/custom-launch",
          "/docs/developers/verify",
          "/docs/developers/indexing",
          "/docs/developers/machine-readable",
          "/docs/launch-stamps",
          "/docs/models/classic",
          "/docs/models/custom",
          "/docs/models/stock-paired",
        ].map((route) => `https://programmable.market${route}`),
      ),
    );
  });

  it("keeps the developer tasks in the same shell and breadcrumb hierarchy", () => {
    for (const [source, path, title] of [
      [
        developerOverview,
        "/docs/developers",
        "Integrate Programmable launches",
      ],
      [verifyPage, "/docs/developers/verify", "Verify a token or pool"],
      [indexingPage, "/docs/developers/indexing", "Index new launches"],
      [
        customLaunchPage,
        "/docs/developers/custom-launch",
        "Custom Launch API",
      ],
      [
        machineReadablePage,
        "/docs/developers/machine-readable",
        "Machine-readable docs",
      ],
    ] as const) {
      expect(source).toContain(`currentPath="${path}"`);
      expect(source).toContain(`title="${title}"`);
      expect(source).toContain("<DocsShell");
    }
    for (const source of [
      customLaunchPage,
      verifyPage,
      indexingPage,
      machineReadablePage,
    ]) {
      expect(source).toContain('parentHref="/docs/developers"');
      expect(source).toContain('parentLabel="Developers"');
    }
  });

  it("keeps service health separate from launch provenance", () => {
    expect(docsShell).not.toContain('status === "available"');
    expect(docsShell).not.toContain('aria-disabled="true"');
    expect(tokensPage).not.toContain(
      "Lifecycle and availability are different",
    );
    expect(statusPage).toContain("Service health");
    expect(statusPage).toContain("Health checks describe");
    expect(statusPage).not.toContain("Current status unavailable");
    expect(statusPage).toContain('export const dynamic = "force-dynamic"');
  });

  it("publishes a complete creator path with explicit entrypoint roles", () => {
    for (const [source, path, title] of [
      [creatorsPage, "/docs/creators", "Create with Programmable"],
      [creatorLaunchPage, "/docs/creators/launch", "Launch a project"],
      [creatorTemplatesPage, "/docs/creators/templates", "Public templates"],
      [creatorEarningsPage, "/docs/creators/earnings", "Creator earnings"],
      [creatorProgramsPage, "/docs/creators/programs", "Creator programs"],
    ] as const) {
      expect(source).toContain('currentPath="' + path + '"');
      expect(source).toContain('title="' + title + '"');
      expect(source).toContain("<DocsShell");
    }

    expect(creatorsPage).not.toContain("Hookbuilder-Skill");
    expect(creatorsPage).toContain("Custom Launch API");
    expect(creatorsPage).toContain("Public templates are planned");
    expect(creatorTemplatesPage).toContain("Public template intake is closed");
    expect(creatorTemplatesPage).not.toMatch(/submit[- a]+template/i);
    expect(creatorLaunchPage).toContain("The API does not control your wallet");
    expect(creatorLaunchPage).toContain("Manage Custom launch API keys");
    expect(creatorLaunchPage).toContain("CUSTOM_LAUNCH_V1_READ_ONLY");
    expect(creatorLaunchPage).toContain("CUSTOM_LAUNCH_V2_READ_ONLY");
    expect(creatorLaunchPage).toContain("only the API server");
    expect(creatorLaunchPage).toContain(
      "does not reproduce project-specific tests",
    );
    expect(creatorLaunchPage).not.toContain(
      "Open public wallet self-service is not active",
    );
  });

  it("keeps every normal public Custom launch surface API-first", () => {
    const publicLaunchSurfaces = [
      "README.md",
      "components/create-guide.tsx",
      "docs/public/README.md",
      "docs/public/creators/README.md",
      "docs/public/creators/launch.md",
      "docs/public/creators/templates.md",
      "docs/public/economics.md",
      "docs/public/infrastructure.md",
      "docs/public/models/custom.md",
      "docs/public/developers/custom-launch.md",
      "docs/public/tokens.md",
      "docs/public/trust.md",
      "docs/public/reference/official-links.md",
      "app/docs/page.tsx",
      "app/docs/creators/page.tsx",
      "app/docs/creators/launch/page.tsx",
      "app/docs/creators/templates/page.tsx",
      "app/docs/developers/custom-launch/page.tsx",
      "app/docs/launch-stamps/page.tsx",
      "app/docs/models/[model]/page.tsx",
      "app/docs/trust/page.tsx",
    ];

    for (const path of publicLaunchSurfaces) {
      const source = read(path);
      expect(source, path).not.toMatch(
        /Hookbuilder-Skill|submit[- a]+launch|submit[- a]+template|public source review|review application|accepted revision|accepted release|individually reviewed/i,
      );
    }

    expect(read("docs/public/creators/launch.md")).toContain(
      "https://api.programmable.market/v3/custom-launches",
    );
    expect(read("docs/public/developers/README.md")).toContain(
      "The Developer API at `https://developers.programmable.family` is read only",
    );
  });

  it("keeps one public revenue allocation policy explicit", () => {
    expect(economicsPage).not.toContain("49.50% of processed");
    expect(economicsPage).toMatch(
      /80% of attributable net\s+protocol\s+revenue/,
    );
    expect(economicsPage).not.toContain("This policy remains planned");
    expect(v4TokenPage).not.toContain("This policy is planned, not live");
    expect(v4TokenPage).toContain("published protocol allocation");
    expect(v4TokenPage).toContain("No burn in the published revenue policy");
    expect(trustPage).toMatch(
      /have not\s+undergone an external audit or public security contest/,
    );
  });

  it("keeps the verification scope precise", () => {
    expect(infrastructurePage).toContain(
      "Router verification applies only to stamped launches",
    );
    expect(infrastructurePage).toContain("first block to scan for this Router");
    expect(infrastructurePage).toMatch(
      /direct factory call\s+remains outside the Router record even when it occurs at or after that\s+block/,
    );
    expect(infrastructurePage).toContain("It is not a safety guarantee.");
  });

  it("uses the full global tree in a dismissible mobile dialog", () => {
    expect(docsNavigation).toContain("renderGlobalNavigation");
    expect(docsNavigation).toContain("renderMobileNavigation");
    expect(docsNavigation).toContain("{renderMobileNavigation()}");
    expect(docsNavigation).toContain("dialog.showModal()");
    expect(docsNavigation).toContain('id="docs-mobile-navigation"');
    expect(docsNavigation).toContain('aria-haspopup="dialog"');
    expect(docsNavigation).toContain(
      'aria-label="Close documentation navigation"',
    );
  });

  it("lets keyboard users bypass and dismiss the documentation controls", () => {
    expect(docsShell).toContain('href="#docs-content"');
    expect(docsShell).toContain('id="docs-content"');
    expect(docsShell).toContain("tabIndex={-1}");
    expect(docsCss).toMatch(
      /\.skipDocsNavigation:focus-visible\s*\{[^}]*transform:\s*translateY\(0\);/s,
    );
    expect(docsSearch).toMatch(
      /<form[\s\S]*?onKeyDown=\{handleKeyDown\}[\s\S]*?onSubmit=\{submit\}/,
    );
    expect(docsSearch).toContain(
      "if (!(event.target instanceof HTMLInputElement)) return;",
    );
    expect(docsNavigation).toContain("mobileMenuButtonRef.current?.focus()");
  });

  it("uses native row and column headers in the indexing reference table", () => {
    expect(indexingPage).toContain('<th scope="col">Event</th>');
    expect(indexingPage).toContain('<th scope="col">Full signature</th>');
    expect(indexingPage).toContain('<th scope="col">topic0</th>');
    expect(indexingPage).toContain('<th scope="row">{event.name}</th>');
    expect(indexingPage).not.toContain('role="rowheader"');
  });
});
