import { describe, expect, it } from "vitest";
import { stringToHex } from "viem";

import {
  buildTokenLinks,
  decodeSocialMetadata,
  sanitizeImageUrl,
  sanitizeWebsiteUrl,
  sanitizeSocialUrl,
} from "../lib/onchain/metadata";
import {
  MAX_METADATA_URL_BYTES,
  MAX_SOCIAL_URL_BYTES,
} from "../lib/metadata-policy";

describe("UERC20 metadata extraData", () => {
  it("decodes only the versioned social schema", () => {
    const extraData = stringToHex(
      JSON.stringify({
        v: 1,
        x: "https://x.com/programmable",
        telegram: "https://t.me/programmable",
      }),
    );

    expect(decodeSocialMetadata(extraData)).toEqual({
      v: 1,
      x: "https://x.com/programmable",
      telegram: "https://t.me/programmable",
    });
  });

  it("ignores malformed, unsupported, or oversized bytes", () => {
    expect(decodeSocialMetadata(stringToHex('{"v":2}'))).toBeNull();
    expect(decodeSocialMetadata("0xff")).toBeNull();
    expect(
      decodeSocialMetadata(stringToHex("x".repeat(1_201))),
    ).toBeNull();
  });

  it("only emits correctly labelled HTTPS project links", () => {
    const links = buildTokenLinks(
      "https://programmable.family",
      stringToHex(
        JSON.stringify({
          v: 1,
          x: "https://example.com/not-x",
          telegram: "https://t.me/programmable",
        }),
      ),
    );

    expect(links).toEqual([
      { kind: "website", url: "https://programmable.family/" },
      { kind: "telegram", url: "https://t.me/programmable" },
    ]);
  });

  it("applies the same UTF-8 byte limits as launch acceptance", () => {
    const oversizedWebsite =
      "https://example.com/" +
      "🌷".repeat(Math.ceil(MAX_METADATA_URL_BYTES / 4));
    expect(sanitizeWebsiteUrl(oversizedWebsite)).toBeNull();
    expect(sanitizeImageUrl(oversizedWebsite)).toBeNull();

    const oversizedX =
      "https://x.com/" + "é".repeat(MAX_SOCIAL_URL_BYTES / 2);
    expect(
      buildTokenLinks(
        "",
        stringToHex(JSON.stringify({ v: 1, x: oversizedX })),
      ),
    ).toEqual([]);
  });

  it("reads additional social fields while preserving older v1 envelopes", () => {
    const extraData = stringToHex(JSON.stringify({ v: 1, x: "https://x.com/example", discord: "https://discord.gg/example", github: "https://github.com/example", gitbook: "https://example.gitbook.io/" }));
    expect(buildTokenLinks("", extraData)).toEqual([
      { kind: "x", url: "https://x.com/example" },
      { kind: "discord", url: "https://discord.gg/example" },
      { kind: "github", url: "https://github.com/example" },
      { kind: "gitbook", url: "https://example.gitbook.io/" },
    ]);
    expect(buildTokenLinks("", stringToHex(JSON.stringify({ v: 1, discord: "https://discord.gg.evil.com/example", github: "https://github.com.evil.com/example" })))).toEqual([]);
    expect(sanitizeSocialUrl("gitbook", "https://docs.example.com/")).toBe("https://docs.example.com/");
    expect(sanitizeSocialUrl("discord", "https://discord.com/invite/example")).toBe("https://discord.com/invite/example");
  });
});
