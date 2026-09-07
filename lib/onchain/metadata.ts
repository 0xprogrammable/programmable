import { hexToBytes, type Hex } from "viem";

import {
  MAX_METADATA_URL_BYTES,
  MAX_SOCIAL_EXTRA_DATA_BYTES,
  MAX_SOCIAL_URL_BYTES,
  utf8ByteLength,
} from "../metadata-policy";
import type { TokenLink } from "../tokens";

export type SocialMetadataV1 = {
  v: 1;
  x?: string;
  telegram?: string;
  discord?: string;
  github?: string;
  gitbook?: string;
};
export type SocialMetadataKind = Exclude<keyof SocialMetadataV1, "v">;
const socialKinds: readonly SocialMetadataKind[] = ["x", "telegram", "discord", "github", "gitbook"];

function parseHttpsUrl(
  value: unknown,
  maximumBytes = MAX_METADATA_URL_BYTES,
) {
  if (
    typeof value !== "string" ||
    utf8ByteLength(value) > maximumBytes ||
    /[\s\\\u0000-\u001f\u007f]/u.test(value)
  ) {
    return null;
  }

  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname.includes(".") ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      utf8ByteLength(parsed.href) > maximumBytes
    ) {
      return null;
    }
    // These URLs are rendered as links. Never resolve or fetch a contributor's social URL.
    const hostname = parsed.hostname.toLowerCase();
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*$/u.test(hostname)
      || /(?:^|\.)(?:localhost|local|internal|invalid|test)$/u.test(hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function sanitizeWebsiteUrl(value: unknown) {
  return parseHttpsUrl(value)?.toString() ?? null;
}

export function sanitizeImageUrl(value: unknown) {
  return parseHttpsUrl(value)?.toString() ?? null;
}

export function sanitizeSocialUrl(kind: SocialMetadataKind, value: unknown): string | null {
  const parsed = parseHttpsUrl(value, MAX_SOCIAL_URL_BYTES);
  if (!parsed) return null;

  const hostname = parsed.hostname.toLowerCase();
  const host = hostname.replace(/^www\./u, "");
  const allowed = kind === "x" ? ["x.com", "twitter.com"].includes(host)
    : kind === "telegram" ? ["t.me", "telegram.me"].includes(host)
      : kind === "discord" ? host === "discord.gg" || (["discord.com", "discordapp.com"].includes(host) && parsed.pathname.startsWith("/invite/"))
        : kind === "github" ? host === "github.com"
          // GitBook supports project-owned domains as well as gitbook.io sites.
          : kind === "gitbook";
  if (!allowed || (kind !== "gitbook" && parsed.pathname === "/") || parsed.pathname === "/invite/") return null;

  return parsed.toString();
}

export function decodeSocialMetadata(extraData: Hex): SocialMetadataV1 | null {
  if (extraData === "0x") return null;

  let bytes: Uint8Array;
  try {
    bytes = hexToBytes(extraData);
  } catch {
    return null;
  }
  if (bytes.byteLength > MAX_SOCIAL_EXTRA_DATA_BYTES) return null;

  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const candidate: unknown = JSON.parse(decoded);
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate) ||
      (candidate as { v?: unknown }).v !== 1
    ) {
      return null;
    }

    const value = candidate as Record<string, unknown>;
    if (socialKinds.some(kind => value[kind] !== undefined && typeof value[kind] !== "string")) {
      return null;
    }
    return { v: 1, ...Object.fromEntries(socialKinds.filter(kind => typeof value[kind] === "string").map(kind => [kind, value[kind]])) };
  } catch {
    return null;
  }
}

export function buildTokenLinks(website: unknown, extraData: Hex) {
  const links: TokenLink[] = [];
  const safeWebsite = sanitizeWebsiteUrl(website);
  if (safeWebsite) links.push({ kind: "website", url: safeWebsite });

  const social = decodeSocialMetadata(extraData);
  if (social) {
    for (const kind of socialKinds) {
      const url = sanitizeSocialUrl(kind, social[kind]);
      if (url) links.push({ kind, url });
    }
  }
  return links;
}
