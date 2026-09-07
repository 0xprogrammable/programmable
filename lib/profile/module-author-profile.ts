import { isModulePublicDetails, type ModulePublicDetails } from "@/lib/module-mode/public-details";

export const MODULE_AUTHOR_PROFILE_SCHEMA = "programmable.module-mode.author-profile.v1" as const;
export const MODULE_AUTHOR_PROFILE_PAGE_SIZE = 12;
export type ModuleAuthorProfile = Readonly<{
  schemaVersion: typeof MODULE_AUTHOR_PROFILE_SCHEMA;
  chainId: 4663;
  account: string;
  status: "ready" | "unavailable";
  releaseDigest: string | null;
  items: readonly ModulePublicDetails[];
  page: Readonly<{ number: number; size: 12; totalItems: number; totalPages: number }>;
}>;

const ADDRESS = /^0x[\da-f]{40}$/iu;
const HASH = /^0x(?!0{64}$)[\da-f]{64}$/iu;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Response-shape guard only. Publication and authorship authority are checked by the server reader. */
export function readModuleAuthorProfileResponse(value: unknown, account: string): ModuleAuthorProfile {
  if (!object(value) || value.schemaVersion !== MODULE_AUTHOR_PROFILE_SCHEMA || value.chainId !== 4663
    || !ADDRESS.test(account) || value.account !== account.toLowerCase()
    || !["ready", "unavailable"].includes(String(value.status))
    || !(value.releaseDigest === null || typeof value.releaseDigest === "string" && HASH.test(value.releaseDigest))
    || !Array.isArray(value.items) || value.items.length > MODULE_AUTHOR_PROFILE_PAGE_SIZE || !object(value.page)) throw new Error("Invalid module profile.");
  const packages = new Set<string>();
  for (const item of value.items) {
    if (!isModulePublicDetails(item) || item.author !== account.toLowerCase()
      || packages.has(item.packageId.toLowerCase())) throw new Error("Invalid authored module.");
    packages.add(item.packageId.toLowerCase());
  }
  const page = value.page;
  if (!Number.isSafeInteger(page.number) || Number(page.number) < 1 || page.size !== MODULE_AUTHOR_PROFILE_PAGE_SIZE
    || !Number.isSafeInteger(page.totalItems) || Number(page.totalItems) < 0 || Number(page.totalItems) > 1000
    || page.totalPages !== Math.max(1, Math.ceil(Number(page.totalItems) / MODULE_AUTHOR_PROFILE_PAGE_SIZE))
    || Number(page.number) > Number(page.totalPages)
    || value.items.length !== Math.min(MODULE_AUTHOR_PROFILE_PAGE_SIZE, Math.max(0, Number(page.totalItems) - (Number(page.number) - 1) * MODULE_AUTHOR_PROFILE_PAGE_SIZE))) throw new Error("Invalid module profile page.");
  if (value.status === "unavailable" ? value.releaseDigest !== null || value.items.length !== 0 || page.totalItems !== 0
    : value.releaseDigest === null) throw new Error("Invalid module profile availability.");
  return value as ModuleAuthorProfile;
}
