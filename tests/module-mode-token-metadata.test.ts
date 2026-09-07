import { describe, expect, it } from "vitest";
import { hexToString } from "viem";
import { buildTokenLinks } from "../lib/onchain/metadata";
import { MODULE_DEFAULT_TOKEN_IMAGE, moduleTokenMetadata, validateModuleSocialLinks } from "../lib/module-mode/token-metadata";

describe("Module Mode social metadata", () => {
  it("roundtrips every supported field through the existing onchain v1 format", () => {
    const links = { website: "https://example.com", twitter: "https://x.com/example", telegram: "https://t.me/example", discord: "https://discord.gg/example", github: "https://github.com/example", gitbook: "https://docs.example.com/" };
    const metadata = moduleTokenMetadata("A token", MODULE_DEFAULT_TOKEN_IMAGE, links);
    expect(metadata.website).toBe("https://example.com/");
    expect(metadata.image).toBe(MODULE_DEFAULT_TOKEN_IMAGE);
    expect(JSON.parse(hexToString(metadata.extraData))).toEqual({ v: 1, x: links.twitter, telegram: links.telegram, discord: links.discord, github: links.github, gitbook: links.gitbook });
    expect(buildTokenLinks(metadata.website, metadata.extraData)).toEqual([
      { kind: "website", url: "https://example.com/" },
      { kind: "x", url: links.twitter },
      { kind: "telegram", url: links.telegram },
      { kind: "discord", url: links.discord },
      { kind: "github", url: links.github },
      { kind: "gitbook", url: links.gitbook },
    ]);
    expect(moduleTokenMetadata("", MODULE_DEFAULT_TOKEN_IMAGE)).toMatchObject({ website: "", extraData: "0x" });
    expect(validateModuleSocialLinks({ website: " ", twitter: "" })).toEqual({ ok: true, links: {} });
  });

  it("rejects private destinations, credentials, false platform labels and executable schemes", () => {
    for (const website of ["http://example.com", "javascript:alert(1)", "https://user:secret@example.com", "https://127.0.0.1", "https://0x7f000001", "https://2130706433", "https://[::1]", "https://service.internal", "https://service.local", "https://example.com:8443", "https://exam\nple.com", "https://example.com\\@127.0.0.1"]) {
      expect(validateModuleSocialLinks({ website }).ok, website).toBe(false);
    }
    for (const [key, url] of [["twitter", "https://x.com.evil.com/example"], ["github", "https://github.com.evil.com/example"], ["telegram", "https://example.com/telegram"], ["discord", "https://discord.com/channels/example"], ["github", "https://github.com"]]) {
      const result = validateModuleSocialLinks({ [key]: url });
      expect(result.ok, url).toBe(false);
      if (!result.ok) expect(result.issues[0].path).toBe(`/socialLinks/${key}`);
    }
  });

  it("uses UTF-8 and serialized byte limits without truncating metadata", () => {
    expect(validateModuleSocialLinks({ website: `https://example.com/${"é".repeat(600)}` }).ok).toBe(false);
    const result = validateModuleSocialLinks({
      twitter: `https://x.com/${"x".repeat(390)}`,
      telegram: `https://t.me/${"x".repeat(390)}`,
      github: `https://github.com/${"x".repeat(390)}`,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toEqual([{ path: "/socialLinks", message: "Use shorter social links. Their combined metadata exceeds 1,200 bytes." }]);
    expect(() => moduleTokenMetadata("", MODULE_DEFAULT_TOKEN_IMAGE, { github: `https://github.com/${"x".repeat(512)}` })).toThrow();
  });

  it("rejects unknown keys, nonstring values and accessors without running them", () => {
    expect(validateModuleSocialLinks({ youtube: "https://youtube.com/example" }).ok).toBe(false);
    expect(validateModuleSocialLinks({ twitter: 1 }).ok).toBe(false);
    expect(validateModuleSocialLinks(null).ok).toBe(false);
    expect(validateModuleSocialLinks([]).ok).toBe(false);
    const accessor = Object.defineProperty({}, "website", { enumerable: true, get() { throw new Error("Must not execute"); } });
    expect(validateModuleSocialLinks(accessor).ok).toBe(false);
  });
});
