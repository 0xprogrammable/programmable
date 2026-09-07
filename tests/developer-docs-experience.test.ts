import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PROGRAMMABLE_LAUNCH_STAMP_RESOURCES } from "../components/launch-stamp-docs-contract";
import {
  developerDocsMarkdown,
  programmableLlmsFullFallback,
  programmableLlmsIndex,
} from "../lib/developer-docs-content";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const developerPage = read("app/docs/developers/page.tsx");
const customLaunchPage = read("app/docs/developers/custom-launch/page.tsx");
const verifyPage = read("app/docs/developers/verify/page.tsx");
const indexingPage = read("app/docs/developers/indexing/page.tsx");
const machineReadablePage = read(
  "app/docs/developers/machine-readable/page.tsx",
);
const docsIndex = read("app/docs/page.tsx");
const siteNavigation = read("components/site-navigation.tsx");
const docsSearch = read("components/docs-search.tsx");
const docsData = read("components/docs-data.ts");
const developerDocsCss = read("components/developer-docs.module.css");
const markdownRoute = read("app/docs/developers.md/route.ts");
const llmsRoute = read("app/llms.txt/route.ts");
const llmsFullRoute = read("app/llms-full.txt/route.ts");

describe("Developer documentation experience", () => {
  it("uses a real Docs overview and keeps the developer overview canonical", () => {
    expect(docsIndex).toContain('currentPath="/docs"');
    expect(docsIndex).toContain('title="Programmable"');
    expect(docsIndex).not.toContain("redirect(");
    expect(siteNavigation).toContain('href: "/docs"');
    expect(developerPage).toContain('title="Integrate Programmable launches"');
    expect(developerPage).toContain(
      'alternates: { canonical: "/docs/developers" }',
    );
    expect(developerPage).toMatch(
      /startBlock<\/code> is\s+the first block to scan/,
    );
    expect(developerPage).toMatch(
      /direct factory call remains outside this verification path even when\s+it occurs later/,
    );
  });

  it("publishes focused Custom launch, verification, indexing and machine-readable routes", () => {
    expect(docsSearch).toContain("key={`${item.href}:${item.title}`}");
    for (const [source, path, canonical] of [
      [
        customLaunchPage,
        "/docs/developers/custom-launch",
        'alternates: { canonical: "/developer-reference/custom-launch" }',
      ],
      [
        verifyPage,
        "/docs/developers/verify",
        'alternates: { canonical: "/docs/developers/verify" }',
      ],
      [
        indexingPage,
        "/docs/developers/indexing",
        'alternates: { canonical: "/docs/developers/indexing" }',
      ],
      [
        machineReadablePage,
        "/docs/developers/machine-readable",
        'alternates: { canonical: "/docs/developers/machine-readable" }',
      ],
    ] as const) {
      expect(source).toContain(`currentPath="${path}"`);
      expect(source).toContain(canonical);
      expect(docsData).toContain(`href: "${path}"`);
    }

    for (const id of [
      "paths",
      "trust-root",
      "boundary",
      "resources",
      "checklist",
      "agents",
    ]) {
      expect(developerPage).toContain(`id="${id}"`);
    }
    expect(developerPage).not.toContain("DeveloperDocsWorkbench");
  });

  it("puts the deployment manifest, frozen ABI and GitHub reference first", () => {
    expect(developerPage).toContain(
      "PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.manifestUrl",
    );
    expect(developerPage).toContain(
      "PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.abiUrl",
    );
    expect(developerPage).toContain(
      "PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.referenceUrl",
    );
    expect(developerDocsMarkdown).toContain(
      `Deployment manifest: ${PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.manifestUrl}`,
    );
    expect(developerDocsMarkdown).toContain(
      `Frozen Router ABI: ${PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.abiUrl}`,
    );
  });

  it("documents point verification without requiring an indexer or server", () => {
    expect(verifyPage).toContain("Resolve the launch ID");
    expect(verifyPage).toContain("reads.primaryReads[0].signature");
    expect(verifyPage).toContain("reads.primaryReads[1].signature");
    expect(verifyPage).toContain("reads.componentReads[0].signature");
    expect(developerDocsMarkdown).toContain("launchIdByToken(address)");
    expect(developerDocsMarkdown).toContain("launchIdByPool(address,bytes32)");
    expect(developerDocsMarkdown).toContain("stampProof(address)");
    expect(verifyPage).toMatch(
      /The shared Classic hook is not a launch identifier\./,
    );
    expect(indexingPage).toContain(
      "Point verification needs an Ethereum provider, the manifest and the",
    );
    expect(developerDocsMarkdown).toContain(
      "point verification requires only an Ethereum provider.",
    );
  });

  it("documents the complete protocol fee claim inventory separately", () => {
    expect(indexingPage).toContain('id="claims"');
    expect(indexingPage).toContain("complete canonical Launcher");
    expect(indexingPage).toContain("complete Registry history");
    expect(indexingPage).toContain("fixed release asset set");
    expect(indexingPage).toContain(
      "https://claimhazard.vercel.app/claim-discovery.json",
    );
    expect(developerDocsMarkdown).toContain("## Protocol fee claim discovery");
    expect(programmableLlmsIndex).toContain(
      "Protocol fee claim discovery is a separate index",
    );
  });

  it("keeps the complete stamped verification gate explicit", () => {
    for (const field of [
      "poolId",
      "poolKeyHash",
      "componentSetHash",
      "routePayloadHash",
      "routeLauncherRuntimeCodeHash",
      "expectedResultHash",
      "permitDigest",
      "stampHash",
    ]) {
      expect(verifyPage).toContain(`<code>${field}</code>`);
    }
    expect(verifyPage).toContain(
      "record.poolManager == {bindings.poolManager}",
    );
    expect(verifyPage).toContain("LaunchKindV1.CustomGraph");
    expect(verifyPage).toContain("there is no Classic");
    expect(verifyPage).toContain("closing block-hash check");
    expect(verifyPage).toContain("sole payable");
    expect(verifyPage).toContain("reads.market.signature");
    expect(verifyPage).toContain("reads.market.selector");
    expect(verifyPage).toContain("reads.componentReads[2].signature");
    expect(verifyPage).toContain("nonzero recorded runtime hash");
    expect(verifyPage).toMatch(
      /Use HTTPS for every remote Ethereum RPC\. Allow plaintext HTTP only\s+for loopback development endpoints\./,
    );
    expect(verifyPage).toContain("every published getter selector");
    expect(verifyPage).toMatch(
      /full signature,[\s\S]*?<code>topic0<\/code>\s+and indexed input names and order/,
    );
    expect(verifyPage).toMatch(
      /descriptor disagrees, return <code>INDETERMINATE<\/code>/,
    );
    expect(verifyPage).toMatch(
      /Require <code>status: live<\/code>, or <code>retired<\/code> only for\s+a historical read inside the published block range/,
    );
    expect(verifyPage).toMatch(/complete\s+activation data/);
    expect(verifyPage).toContain("deployment evidence");
    expect(verifyPage).toMatch(/finalized\s+canary evidence/);
    expect(verifyPage).toContain("getter descriptors");
    expect(verifyPage).toMatch(/event\s+descriptors/);
    expect(verifyPage).toMatch(
      /call <code>CHAIN_ID\(\)<\/code> and all\s+six immutable binding getters/,
    );
    expect(verifyPage).toMatch(
      /call <code>eth_getCode<\/code> for the permit\s+authority, Graph Factory and PoolManager/,
    );
    expect(verifyPage).toContain("exact manifest runtime hash");
    expect(verifyPage).toMatch(/Report a mismatch as\s+code drift/);
    expect(verifyPage).toMatch(
      /does not change the historical Router-provenance\s+result/,
    );
  });

  it("keeps Router-only Classic and Custom scope explicit", () => {
    expect(developerPage).toContain('kind.name === "CustomGraph"');
    expect(developerPage).toContain('kind.name === "Classic"');
    expect(developerPage).toContain("customKind?.publicLabel");
    expect(developerPage).toContain("classicKind?.publicLabel");
    expect(verifyPage).toContain("LaunchKindV1.{kind.name}");
    expect(developerPage).toMatch(
      /This path covers only launches executed and stamped through this\s+Router/,
    );
    for (const surface of [developerPage, verifyPage, indexingPage]) {
      expect(surface).not.toContain("MemeTokenLaunchedV2");
      expect(surface).not.toContain(
        "0xC3bd04aAc2fb2ba58efD7Eb673E544E0B80De770",
      );
      expect(surface).not.toContain("CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH");
    }
  });

  it("keeps provenance separate from safety and terminal support", () => {
    expect(developerDocsMarkdown).toContain(
      "It does not establish safety, tradability, current liquidity or pool state",
    );
    expect(developerDocsMarkdown).toContain(
      "each consumer must implement the published verification procedure",
    );
    expect(developerDocsMarkdown).toMatch(
      /Public V3\.3 creation and lifecycle reads use a scoped wallet key, partner root or bounded partner subkey/,
    );
    expect(developerDocsMarkdown).toContain(
      "https://api.programmable.market/v3/custom-launches",
    );
    expect(developerDocsMarkdown).toContain(
      "Router verification and the Developer API are read-only",
    );
    expect(developerDocsMarkdown).toContain(
      "It does not automatically list or label a launch in GMGN, Axiom, FOMO",
    );
    expect(developerDocsMarkdown).not.toContain("unruggable");
  });

  it("keeps the Markdown and agent routes local, static and product-first", () => {
    for (const route of [markdownRoute, llmsRoute, llmsFullRoute]) {
      expect(route).toContain('dynamic = "force-static"');
      expect(route).not.toContain("resolveCustomRegistryPublicManifestV1");
    }
    expect(markdownRoute).toContain("buildDeveloperDocsMarkdown()");
    expect(llmsRoute).toContain("buildProgrammableLlmsIndex()");
    expect(llmsFullRoute).toContain("buildProgrammableLlmsFullFallback()");
    expect(llmsFullRoute).not.toContain("fetch(");
    expect(programmableLlmsIndex).toMatch(/^# Programmable\n/u);
    expect(programmableLlmsIndex).toContain("## When to use Programmable");
    expect(programmableLlmsIndex).toContain("Canonical read-only provenance");
    expect(programmableLlmsIndex).not.toMatch(
      /^# Programmable Launch Stamp Router$/mu,
    );
    expect(programmableLlmsFullFallback).toContain("## Finalized PCAN vector");
    expect(machineReadablePage).toContain('<a href="/docs/developers.md">');
    expect(machineReadablePage).toContain('<a href="/llms.txt">');
    expect(machineReadablePage).toContain('<a href="/llms-full.txt">');
    expect(machineReadablePage).toContain('<a href="/openapi.json">');
  });

  it("wraps long values and makes the indexing table horizontally reachable", () => {
    expect(developerDocsCss).toContain(".breakableValue");
    expect(developerDocsCss).toContain(".technicalData dd");
    expect(developerDocsCss).toMatch(
      /\.eventTable code\s*\{[^}]*white-space:\s*normal;[^}]*word-break:\s*break-word;/s,
    );
    expect(developerDocsCss).toMatch(
      /\.tableScroll\s*\{[^}]*overflow-x:\s*auto;[^}]*overscroll-behavior-inline:\s*contain;/s,
    );
    expect(developerDocsCss).toMatch(
      /@media \(max-width: 700px\)[\s\S]*?\.dataList > div,\s*\.resultList > div,\s*\.codeList li\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s,
    );
    expect(developerDocsCss).not.toMatch(
      /font-size:\s*(?:10(?:\.5)?|11(?:\.5)?|12(?:\.5)?)px/,
    );
    expect(developerDocsCss).not.toContain("transition: all");
  });
});
