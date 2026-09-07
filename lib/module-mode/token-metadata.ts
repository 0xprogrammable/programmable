import { stringToHex, type Hex } from "viem";
import { MAX_METADATA_URL_BYTES, MAX_SOCIAL_EXTRA_DATA_BYTES, MAX_SOCIAL_URL_BYTES, utf8ByteLength } from "@/lib/metadata-policy";
import { sanitizeSocialUrl, sanitizeWebsiteUrl, type SocialMetadataKind } from "@/lib/onchain/metadata";

export const MODULE_DEFAULT_TOKEN_IMAGE = "https://programmable.market/brand/loop/programmable-module-token-default-v1.png";
export const MODULE_SOCIAL_KEYS = ["website", "twitter", "telegram", "discord", "github", "gitbook"] as const;
export type ModuleSocialKind = typeof MODULE_SOCIAL_KEYS[number];
export type ModuleSocialLinks = Partial<Record<ModuleSocialKind, string>>;
export type ModuleSocialIssue = { path: string; message: string };

const labels: Record<ModuleSocialKind, string> = { website: "Website", twitter: "X", telegram: "Telegram", discord: "Discord", github: "GitHub", gitbook: "GitBook" };

function socialExtraData(links: ModuleSocialLinks): Hex {
  const social = Object.fromEntries(MODULE_SOCIAL_KEYS.filter(key => key !== "website" && links[key])
    .map(key => [key === "twitter" ? "x" : key, links[key]]));
  if (Object.keys(social).length === 0) return "0x";
  const json = JSON.stringify({ v: 1, ...social });
  if (utf8ByteLength(json) > MAX_SOCIAL_EXTRA_DATA_BYTES) throw new Error("Use shorter social links. Their combined metadata exceeds 1,200 bytes.");
  return stringToHex(json);
}

/** Local validation only. Social URLs are never fetched or treated as launch provenance. */
export function validateModuleSocialLinks(raw: unknown): { ok: true; links: ModuleSocialLinks } | { ok: false; issues: ModuleSocialIssue[] } {
  if (raw === undefined) return { ok: true, links: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) {
    return { ok: false, issues: [{ path: "/socialLinks", message: "Check the social links." }] };
  }
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(raw).length !== Object.keys(descriptors).length || Object.entries(descriptors).some(([key, descriptor]) => !MODULE_SOCIAL_KEYS.includes(key as ModuleSocialKind) || !descriptor.enumerable || !("value" in descriptor))) {
    return { ok: false, issues: [{ path: "/socialLinks", message: "Choose a supported social link type." }] };
  }
  const links: ModuleSocialLinks = {};
  const issues: ModuleSocialIssue[] = [];
  for (const key of MODULE_SOCIAL_KEYS) {
    if (!(key in descriptors)) continue;
    const value: unknown = descriptors[key]!.value;
    if (typeof value !== "string") {
      issues.push({ path: `/socialLinks/${key}`, message: `Enter a valid ${labels[key]} URL.` });
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed) continue;
    const maximum = key === "website" ? MAX_METADATA_URL_BYTES : MAX_SOCIAL_URL_BYTES;
    const safe = key === "website" ? sanitizeWebsiteUrl(trimmed) : sanitizeSocialUrl((key === "twitter" ? "x" : key) as SocialMetadataKind, trimmed);
    if (utf8ByteLength(trimmed) > maximum || !safe) {
      issues.push({ path: `/socialLinks/${key}`, message: key === "website" || key === "gitbook"
        ? `Enter a public HTTPS ${labels[key]} URL.`
        : `Enter an HTTPS link to ${labels[key]}.` });
    } else links[key] = safe;
  }
  try { socialExtraData(links); }
  catch (error) { issues.push({ path: "/socialLinks", message: (error as Error).message }); }
  return issues.length ? { ok: false, issues } : { ok: true, links };
}

export function normalizeModuleSocialLinks(raw: unknown): ModuleSocialLinks {
  const checked = validateModuleSocialLinks(raw);
  if (!checked.ok) throw new Error(checked.issues[0]!.message);
  return checked.links;
}

/** Website occupies its UERC20 field; remaining links use the compatible v1 JSON extraData envelope. */
export function moduleTokenMetadata(description: string, image: string, rawLinks?: ModuleSocialLinks) {
  const links = normalizeModuleSocialLinks(rawLinks);
  return { description, website: links.website ?? "", image, extraData: socialExtraData(links) };
}
