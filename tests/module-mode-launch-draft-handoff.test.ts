import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleModeLaunchDraftHandoff } from "@/lib/module-mode/launch-draft-handoff";

function draft(): ModuleModeLaunchDraftHandoff {
  return { name: "My coin", symbol: "COIN", description: "A saved draft", socialLinks: { website: "https://example.com" },
    tokenImage: { kind: "none" }, imageResource: null, initialBuyEth: "0.0075", buyFeePercent: "1", sellFeePercent: "2" };
}

beforeEach(() => { vi.stubGlobal("window", {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("one-shot launch draft handoff", () => {
  it("preserves shared fields and independent native settings without retaining mutable source state", async () => {
    const { saveModuleModeLaunchDraftHandoff, consumeModuleModeLaunchDraftHandoff } = await import("@/lib/module-mode/launch-draft-handoff");
    const source = draft();
    source.nativeState = { ...source, selectedModules: ["opening-buy-cap"], moduleValues: { "opening-buy-cap": { limit: "1" } }, moduleFundingEth: {} };
    const expected = structuredClone(source);
    saveModuleModeLaunchDraftHandoff("any-quote", source);
    source.name = "Changed"; source.socialLinks!.website = "https://changed.example";
    source.nativeState.selectedModules.length = 0; source.nativeState.moduleValues["opening-buy-cap"] = {};
    const received = consumeModuleModeLaunchDraftHandoff("any-quote");
    expect(received).toEqual(expected);
    expect(received).not.toHaveProperty("selectedModules");
    expect(consumeModuleModeLaunchDraftHandoff("any-quote")).toBeNull();
  });

  it("only consumes the intended destination and replaces an earlier pending transition", async () => {
    const { saveModuleModeLaunchDraftHandoff, consumeModuleModeLaunchDraftHandoff } = await import("@/lib/module-mode/launch-draft-handoff");
    saveModuleModeLaunchDraftHandoff("any-quote", draft());
    expect(consumeModuleModeLaunchDraftHandoff("native")).toBeNull();
    const latest = { ...draft(), name: "Latest draft" };
    saveModuleModeLaunchDraftHandoff("native", latest);
    expect(consumeModuleModeLaunchDraftHandoff("any-quote")).toBeNull();
    expect(consumeModuleModeLaunchDraftHandoff("native")).toEqual(latest);
    expect(consumeModuleModeLaunchDraftHandoff("native")).toBeNull();
  });

  it("recreates a usable local image URL after the source builder revokes its URL", async () => {
    const { saveModuleModeLaunchDraftHandoff, consumeModuleModeLaunchDraftHandoff } = await import("@/lib/module-mode/launch-draft-handoff");
    const blob = new Blob(["local image bytes"], { type: "image/webp" }), sourceUrl = URL.createObjectURL(blob);
    const source: ModuleModeLaunchDraftHandoff = { ...draft(), tokenImage: { kind: "local", sha256: `0x${"ab".repeat(32)}`, mimeType: "image/webp", bytes: blob.size }, imageResource: { blob, objectUrl: sourceUrl } };
    saveModuleModeLaunchDraftHandoff("any-quote", source);
    URL.revokeObjectURL(sourceUrl);
    const received = consumeModuleModeLaunchDraftHandoff("any-quote")!;
    try {
      expect(received.imageResource?.objectUrl).not.toBe(sourceUrl);
      expect(received.imageResource?.blob).toBe(blob);
      await expect(fetch(sourceUrl)).rejects.toThrow();
      expect(await (await fetch(received.imageResource!.objectUrl)).text()).toBe("local image bytes");
      expect(consumeModuleModeLaunchDraftHandoff("any-quote")).toBeNull();
    } finally { URL.revokeObjectURL(received.imageResource!.objectUrl); }
  });

  it("keeps a public image URI without transferring an obsolete local image resource", async () => {
    const { saveModuleModeLaunchDraftHandoff, consumeModuleModeLaunchDraftHandoff } = await import("@/lib/module-mode/launch-draft-handoff");
    const source: ModuleModeLaunchDraftHandoff = { ...draft(), tokenImage: { kind: "uri", uri: "https://example.com/coin.webp", contentVerified: false }, imageResource: { blob: new Blob(["old"]), objectUrl: "blob:old" } };
    saveModuleModeLaunchDraftHandoff("native", source);
    expect(consumeModuleModeLaunchDraftHandoff("native")).toEqual({ ...source, imageResource: null });
  });

  it("does not save or consume a browser draft during server rendering", async () => {
    const { saveModuleModeLaunchDraftHandoff, consumeModuleModeLaunchDraftHandoff } = await import("@/lib/module-mode/launch-draft-handoff");
    vi.stubGlobal("window", undefined);
    saveModuleModeLaunchDraftHandoff("native", draft());
    expect(consumeModuleModeLaunchDraftHandoff("native")).toBeNull();
    vi.stubGlobal("window", {});
    expect(consumeModuleModeLaunchDraftHandoff("native")).toBeNull();
    saveModuleModeLaunchDraftHandoff("any-quote", draft());
    vi.stubGlobal("window", undefined);
    expect(consumeModuleModeLaunchDraftHandoff("any-quote")).toBeNull();
    vi.stubGlobal("window", {});
    expect(consumeModuleModeLaunchDraftHandoff("any-quote")).toEqual(draft());
  });
});
