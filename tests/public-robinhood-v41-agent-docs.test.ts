import { createHash } from "node:crypto";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildProgrammableAgentSetupTextV1, programmableAgentSetupLinksV1,
  PROGRAMMABLE_AGENT_SETUP_TEXT_V1, PROGRAMMABLE_AGENT_SETUP_LINKS_V1,
} from "../lib/custom-launch/agent-setup-v1";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const ethereumHeading = "Ethereum Mainnet only (V3, chain 1)";
async function activeDocs(profileVersion: "4.0.0" | "4.1.0") {
  vi.resetModules();
  vi.doMock("../lib/custom-launch/v4-api-discovery", () => ({ V4_API_PROFILE_VERSION: profileVersion }));
  return import("../lib/developer-docs-content");
}
afterEach(() => {
  vi.doUnmock("../lib/custom-launch/v4-api-discovery");
  vi.doUnmock("../components/developer-api-keys");
  vi.doUnmock("../components/docs-shell");
  vi.resetModules();
});

describe("active Robinhood agent setup and generated documentation", () => {
  it("preserves the complete default setup and links from the reviewed 4.0 source", () => {
    expect(hash(PROGRAMMABLE_AGENT_SETUP_TEXT_V1)).toBe("1c6766ed4ea874282a27b45e0d4e597f17f84bea5cb4edad478ca2c84a273fbc");
    expect(hash(JSON.stringify(PROGRAMMABLE_AGENT_SETUP_LINKS_V1))).toBe("df1d924ec33cc27d465f804c57ef8e5a573c253604dc6b93f3542787d55ba4a7");
    expect(buildProgrammableAgentSetupTextV1("4.0.0")).toBe(PROGRAMMABLE_AGENT_SETUP_TEXT_V1);
  });

  it("selects exact 4.1 setup with funded launch, quote and fee instructions while preserving Ethereum", () => {
    const setup = buildProgrammableAgentSetupTextV1("4.1.0");
    const robinhood = setup.slice(0, setup.indexOf(ethereumHeading));
    expect(setup.slice(setup.indexOf(ethereumHeading)))
      .toBe(PROGRAMMABLE_AGENT_SETUP_TEXT_V1.slice(PROGRAMMABLE_AGENT_SETUP_TEXT_V1.indexOf(ethereumHeading)));
    expect(programmableAgentSetupLinksV1("4.1.0")).toMatchObject({
      robinhoodOpenApi: "https://programmable.market/openapi/custom-launch-v4.1.json",
      robinhoodPackConfigSchema: "https://programmable.market/schemas/custom-launch/v4.1/pack-config.json",
      robinhoodGuide: "https://programmable.market/developers/custom-launch-api-v1.md",
    });
    for (const text of ["CLI for profile 4.1.0", "required fundingPlan", "wallet-transaction-value",
      "initial buy of at least USD 1", "positive minimum token output", "gas is additional",
      "build-only plan cannot obtain a permit", "20 bps (0.20%)",
      "0xD88539d3c4C460136a733A3Fd60cf6BF269079da", "PoolManager native claims",
      "stop before authenticated preflight or submission", "never sign or broadcast"]) {
      expect(robinhood).toContain(text);
    }
    expect(robinhood).not.toContain("CLI for profile 4.0.0");
    expect(robinhood).not.toContain("advertised funding mode, none");
    expect(robinhood).not.toContain("/schemas/custom-launch/v4/pack-config.json");
  });

  it("checks architecture before building and separates public reads from credential recovery", () => {
    const setup = buildProgrammableAgentSetupTextV1("4.1.0");
    const robinhood = setup.slice(0, setup.indexOf(ethereumHeading));
    const links = programmableAgentSetupLinksV1("4.1.0");
    expect(links).toMatchObject({
      robinhoodCoverage: "https://api.programmable.market/v4/chains/4663/launch-coverage",
      robinhoodLaunchGuide: "https://api.programmable.market/v4/chains/4663/launch-guide",
      robinhoodLaunchGuideMarkdown: "https://programmable.market/developers/robinhood-launch-guide-v1.md",
    });
    for (const url of [links.robinhoodCoverage, links.robinhoodLaunchGuide, links.robinhoodLaunchGuideMarkdown]) {
      expect(url).toBeTruthy();
      expect(robinhood.indexOf(url!)).toBeGreaterThan(0);
      expect(robinhood.indexOf(url!)).toBeLessThan(robinhood.indexOf("Inspect the exact public source revision"));
    }
    for (const instruction of [
      "These reads need no API key", "do not create or rotate a key",
      "programmable.robinhood-launch-guide.v1", "another or unavailable profile is not-evaluated",
      "token/hook such as BLOB", "Unknown mechanisms are not automatically unsafe",
      "API profile 4.1.0", "CLI 4.1.1", "client's own release",
      "custom-launch:create", "custom-launch:read", "read-only key cannot preflight or create",
      "TX_SIMULATION_PENDING", "HTTP 202", "HTTP 200", "resource.launchId", "detail GET 404",
      "UNAUTHENTICATED", "INSUFFICIENT_SCOPE", "CHAIN_NOT_ALLOWED", "WALLET_BINDING_MISMATCH",
      "Do not rotate a key for missing verifier coverage",
    ]) expect(robinhood).toContain(instruction);
    expect(PROGRAMMABLE_AGENT_SETUP_LINKS_V1).not.toHaveProperty("robinhoodLaunchGuide");
    expect(setup.slice(setup.indexOf(ethereumHeading)))
      .toBe(PROGRAMMABLE_AGENT_SETUP_TEXT_V1.slice(PROGRAMMABLE_AGENT_SETUP_TEXT_V1.indexOf(ethereumHeading)));
  });

  it("preserves complete historical Markdown, llms outputs and home output byte for byte", async () => {
    const docs = await activeDocs("4.0.0");
    // Captured from source 1f488b4685e349f09d41cc45dbd5e27ce0d4a996 before this change.
    expect(hash(docs.developerDocsMarkdown)).toBe("11c46682593943bc0495bbd36b80678c8318607c8b68db20d638379067806ee5");
    expect(hash(docs.programmableLlmsIndex)).toBe("03d3816e6ac4d55164c3824cb3b389fff047e691386c4eb1e1f3c2e22b79004b");
    expect(hash(docs.programmableLlmsFullFallback)).toBe("ab3c5564c0f5c288b60cca9364a5c61f6337fe889ea57597b1d88508d61ec351");
    expect(hash(docs.programmableHomeMarkdown)).toBe("d9b088638004c6837081c0ee4301a8ef95f3de37272606ff01294a3149c30a3d");
  });

  it("publishes 4.1 funding, first-buy and fee facts in Markdown and both llms views without claiming activation", async () => {
    const docs = await activeDocs("4.1.0");
    for (const text of [docs.developerDocsMarkdown, docs.programmableLlmsIndex, docs.programmableLlmsFullFallback]) {
      for (const fact of ["fundingPlan", "USD 1", "initial-buy-quote", "60 seconds", "positive minimum token output",
        "20 bps (0.20%)", "0xD88539d3c4C460136a733A3Fd60cf6BF269079da", "PoolManager native claims",
        "gas is additional", "build-only plan cannot obtain a permit"]) expect(text).toContain(fact);
      expect(text).not.toContain("immutable 4.0.0 CLI");
      expect(text).not.toContain("Install CLI `4.0.0`");
      expect(text).toMatch(/publicAuthorization.*publicWrites|public gates/s);
    }
    expect(docs.developerDocsMarkdown).toContain("/openapi/custom-launch-v4.1.json");
    expect(docs.developerDocsMarkdown).toContain("/schemas/custom-launch/v4.1/pack-config.json");
    expect(docs.developerDocsMarkdown).toContain("Install CLI `4.1.0`");
    expect(docs.programmableLlmsIndex).toContain("CLI 3.3.9 remains the Ethereum V3 integration");
    expect(docs.programmableHomeMarkdown).toContain("/openapi/custom-launch-v4.1.json");
  });

  it("passes the active setup from the server page to the client component", async () => {
    await activeDocs("4.1.0");
    vi.doMock("../components/developer-api-keys", () => ({ DeveloperApiKeys: () => null }));
    const { default: Page } = await import("../app/developers/api-keys/page");
    const page = await Page({ searchParams: Promise.resolve({}) });
    expect(page.props.agentSetupText).toBe(buildProgrammableAgentSetupTextV1("4.1.0"));
    expect(page.props.initialSection).toBe("keys");
  });

  it("selects 4.1 install links and funding rules on the human guide while retaining the historical view", async () => {
    vi.doMock("../components/docs-shell", () => ({ DocsShell: ({ children }: { children: ReactNode }) => children }));
    await activeDocs("4.0.0");
    const oldPage = (await import("../app/docs/developers/custom-launch/page")).default;
    const oldHtml = renderToStaticMarkup(createElement(oldPage));
    expect(oldHtml).toContain("<code>4.0.0</code>");
    expect(oldHtml).toContain("use version 4.0.0 only");
    expect(oldHtml).toContain('href="/openapi/custom-launch-v4.json"');
    expect(oldHtml).not.toContain("requires a fundingPlan before a funded launch");
    const oldMachinePage = (await import("../app/docs/developers/machine-readable/page")).default;
    const oldMachineHtml = renderToStaticMarkup(createElement(oldMachinePage));
    expect(oldMachineHtml).toContain("<code>4.0.0</code>");
    expect(oldMachineHtml).toContain('href="/openapi/custom-launch-v4.json"');
    await activeDocs("4.1.0");
    const nextPage = (await import("../app/docs/developers/custom-launch/page")).default;
    const nextHtml = renderToStaticMarkup(createElement(nextPage));
    expect(nextHtml).toContain("<code>4.1.0</code>");
    expect(nextHtml).toContain("use version 4.1.0 only");
    expect(nextHtml).not.toContain("<code>4.0.0</code>");
    expect(nextHtml).toContain('href="https://programmable.market/openapi/custom-launch-v4.1.json"');
    expect(nextHtml).toContain("requires a fundingPlan before a funded launch");
    expect(nextHtml).toContain("USD 1");
    expect(nextHtml).toContain("20 bps (0.20%)");
    expect(nextHtml).toContain("CLI <code>3.3.9</code> remains");
    const nextMachinePage = (await import("../app/docs/developers/machine-readable/page")).default;
    const nextMachineHtml = renderToStaticMarkup(createElement(nextMachinePage));
    expect(nextMachineHtml).toContain("<code>4.1.0</code>");
    expect(nextMachineHtml).toContain('href="/openapi/custom-launch-v4.1.json"');
    expect(nextMachineHtml).toContain("USD 1");
    expect(nextMachineHtml).not.toContain("writes and authorization remain inactive");
  });
});
