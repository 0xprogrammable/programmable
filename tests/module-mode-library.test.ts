import { describe, expect, it } from "vitest";
import { PREVIEW_MODULE_CATALOG } from "../lib/module-mode/builder";
import { MODULE_LIBRARY_PAGE_SIZE, isModuleDiscovery, moduleCategory, searchModuleLibrary } from "../lib/module-mode/library";
import { AGENT_KEY_SCHEMA, AGENT_SCOPES, buildAgentConnection, buildAgentInstructions, PROGRAMMABLE_AGENT_ENTRY } from "../lib/agent-connection";
import { apiKeyRotationVersion, apiKeyMutationPath, parseApiKeyMutationResult } from "../components/developer-api-keys";

describe("module discovery and agent connections", () => {
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
