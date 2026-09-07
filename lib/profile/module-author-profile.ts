import { isModulePublicDetails, type ModulePublicDetails } from "@/lib/module-mode/public-details";

export const MODULE_AUTHOR_PROFILE_SCHEMA = "programmable.module-mode.author-profile.v1" as const;
export const MODULE_AUTHOR_PROFILE_PAGE_SIZE = 12;
export const MODULE_AUTHOR_PROFILE_MAX_RELEASES = 33;
export type ModuleAuthorProfileItem = ModulePublicDetails & Readonly<{ sourceReleaseDigests: readonly string[] }>;
export type ModuleAuthorProfile = Readonly<{
  schemaVersion: typeof MODULE_AUTHOR_PROFILE_SCHEMA;
  chainId: 4663;
  account: string;
  status: "ready" | "partial" | "unavailable";
  /** Compatibility alias for the first healthy release; item sourceReleaseDigests bind each revision. */
  releaseDigest: string | null;
  releaseDigests: readonly string[];
  unavailableReleaseDigests: readonly string[];
  items: readonly ModuleAuthorProfileItem[];
  page: Readonly<{ number: number; size: 12; totalItems: number; totalPages: number }>;
}>;

const ADDRESS = /^0x[\da-f]{40}$/iu;
const HASH = /^0x(?!0{64}$)[\da-f]{64}$/iu;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const digests = (value: unknown): value is string[] => Array.isArray(value) && value.length <= MODULE_AUTHOR_PROFILE_MAX_RELEASES
  && value.every(digest => typeof digest === "string" && HASH.test(digest) && digest === digest.toLowerCase()) && new Set(value).size === value.length;

/** Response-shape guard only. Publication and authorship authority are checked by the server reader. */
export function readModuleAuthorProfileResponse(value: unknown, account: string): ModuleAuthorProfile {
  if (!object(value) || value.schemaVersion !== MODULE_AUTHOR_PROFILE_SCHEMA || value.chainId !== 4663
    || !ADDRESS.test(account) || value.account !== account.toLowerCase()
    || !["ready", "partial", "unavailable"].includes(String(value.status))
    || !digests(value.releaseDigests) || !digests(value.unavailableReleaseDigests)
    || value.releaseDigests.length + value.unavailableReleaseDigests.length > MODULE_AUTHOR_PROFILE_MAX_RELEASES
    || value.unavailableReleaseDigests.some(digest => (value.releaseDigests as string[]).includes(digest))
    || value.releaseDigest !== (value.releaseDigests[0] ?? null)
    || !Array.isArray(value.items) || value.items.length > MODULE_AUTHOR_PROFILE_PAGE_SIZE || !object(value.page)) throw new Error("Invalid module profile.");
  const revisions = new Set<string>();
  for (const item of value.items) {
    if (!isModulePublicDetails(item) || item.author !== account.toLowerCase() || !object(item)
      || !digests(item.sourceReleaseDigests) || item.sourceReleaseDigests.length === 0
      || item.sourceReleaseDigests.some(digest => !(value.releaseDigests as string[]).includes(digest))) throw new Error("Invalid authored module.");
    const key = `${item.packageId.toLowerCase()}:${item.manifestHash.toLowerCase()}`;
    if (revisions.has(key)) throw new Error("Duplicate authored module revision.");
    revisions.add(key);
  }
  const page = value.page;
  if (!Number.isSafeInteger(page.number) || Number(page.number) < 1 || page.size !== MODULE_AUTHOR_PROFILE_PAGE_SIZE
    || !Number.isSafeInteger(page.totalItems) || Number(page.totalItems) < 0 || Number(page.totalItems) > MODULE_AUTHOR_PROFILE_MAX_RELEASES * 1000
    || page.totalPages !== Math.max(1, Math.ceil(Number(page.totalItems) / MODULE_AUTHOR_PROFILE_PAGE_SIZE))
    || Number(page.number) > Number(page.totalPages)
    || value.items.length !== Math.min(MODULE_AUTHOR_PROFILE_PAGE_SIZE, Math.max(0, Number(page.totalItems) - (Number(page.number) - 1) * MODULE_AUTHOR_PROFILE_PAGE_SIZE))) throw new Error("Invalid module profile page.");
  if (value.status === "unavailable" ? value.releaseDigests.length !== 0 || value.items.length !== 0 || page.totalItems !== 0
    : value.releaseDigests.length === 0 || (value.status === "partial") !== (value.unavailableReleaseDigests.length > 0)) throw new Error("Invalid module profile availability.");
  return value as ModuleAuthorProfile;
}
