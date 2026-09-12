import { describe, expect, it } from "vitest";
import { PREVIEW_MODULE_CATALOG } from "../lib/module-mode/builder";
import { MODULE_LIBRARY_PAGE_SIZE, isModuleDiscovery, moduleAuthorLabel, moduleCategory, moduleDiscovery, searchModuleLibrary, type ModuleLibraryEntry } from "../lib/module-mode/library";
import { AGENT_KEY_SCHEMA, AGENT_SCOPES, buildAgentConnection, buildAgentInstructions, PROGRAMMABLE_AGENT_ENTRY } from "../lib/agent-connection";
import { apiKeyRotationVersion, apiKeyMutationPath, parseApiKeyMutationResult } from "../components/developer-api-keys";

describe("module discovery and agent connections", () => {
  it("discovers presentation entries without source bindings and preserves their caller data", () => {
    const entry = {
      id: "any-quote", title: "Any Quote", summary: "Choose a quote token", status: "available" as const,
      discovery: { category: "pairs/quote-assets", tags: ["PGRAM"], author: "0xd88539d3c4c460136a733a3fd60cf6bf269079da" as const },
      templateId: "caller-owned-template",
    };
    const matches = searchModuleLibrary([entry], "PGRAM D885", "pairs");
    expect(matches).toEqual([entry]);
    expect(matches[0]).toBe(entry);
    expect(matches[0].templateId).toBe("caller-owned-template");
    expect(moduleAuthorLabel(entry)).toBe("0xd885…79da");
    const undiscovered: ModuleLibraryEntry = { id: "minimal", title: "Minimal", summary: "No discovery metadata", status: "preview" };
    expect(moduleDiscovery(undiscovered)).toEqual({ category: "experiments" });
    expect(moduleAuthorLabel(undiscovered)).toBeNull();
  });

  it("finds category, tag and author across a thousand entries without changing their identities", () => {
    const catalog = Array.from({ length: 1000 }, (_, i) => ({ ...PREVIEW_MODULE_CATALOG[0], id: `fixture-${i}`, title: `Module ${i}`, discovery: { category: i === 999 ? "pairs/stocks" : "rewards/buyers", tags: i === 999 ? ["TSLA", "Tokenized stock"] : ["ETH"], author: "0x1111111111111111111111111111111111111111" as const } }));
    expect(searchModuleLibrary(catalog, "tsla stock", "pairs")).toEqual([catalog[999]]);
    expect(searchModuleLibrary(catalog, "0x1111111111111111111111111111111111111111", "rewards")).toHaveLength(999);
    expect(searchModuleLibrary(catalog, "tsla", "rewards")).toHaveLength(0);
    expect(MODULE_LIBRARY_PAGE_SIZE).toBeLessThanOrEqual(24);
    expect(moduleCategory({ ...catalog[0], discovery: { category: "future-category" } }).id).toBe("experiments");
    for (const value of [{ category: "rewards", author: "0x"+"0".repeat(40) }, { category: "../bad" }, { category: "fees", permissions: ["admin"] }]) expect(isModuleDiscovery(value)).toBe(false);
  });
  it("copies a self-describing connection only from a valid one-time secret", () => {
    const secret = ["pm", "live", "A".repeat(22), "B".repeat(43)].join("_");
    const connection = JSON.parse(buildAgentConnection(secret, { scopes: AGENT_SCOPES }));
    expect(connection.credential.value).toBe(secret);
    expect(connection.credential.scopes).toEqual(AGENT_SCOPES);
    expect(connection.guideUrl).toBe(PROGRAMMABLE_AGENT_ENTRY.guideUrl);
    expect(connection.discoveryUrl).toBe(PROGRAMMABLE_AGENT_ENTRY.discoveryUrl);
    expect(buildAgentInstructions({ scopes: ["modules:read"] })).toContain("issued with: modules:read.");
    expect(JSON.stringify(PROGRAMMABLE_AGENT_ENTRY)).not.toContain(secret);
    expect(() => buildAgentConnection("bad", { scopes: AGENT_SCOPES })).toThrow();
  });
  it("uses combined rotation only with its live capability and keeps legacy readers closed", () => {
    const capabilities = { restrictedIssuance: true, preservingRotation: true, preservingModuleRotation: true };
    expect(apiKeyRotationVersion(AGENT_SCOPES, capabilities)).toBeNull();
    expect(apiKeyRotationVersion(AGENT_SCOPES, { ...capabilities, unifiedKeys: true })).toBe("agent");
    expect(apiKeyMutationPath({ version: "agent", kind: "issue", credentialId: null })).toBe("/api/developer/agent-keys");
    expect(parseApiKeyMutationResult({ schemaVersion: AGENT_KEY_SCHEMA }, 201)).toBeNull();
  });
});
