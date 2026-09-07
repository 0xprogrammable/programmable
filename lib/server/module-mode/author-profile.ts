import { isModulePublicDetails, type PublicModuleDetails } from "@/lib/module-mode/public-details";
import { moduleHash } from "@/lib/module-mode/release";
import { MODULE_AUTHOR_PROFILE_MAX_RELEASES, MODULE_AUTHOR_PROFILE_PAGE_SIZE, MODULE_AUTHOR_PROFILE_SCHEMA, type ModuleAuthorProfile, type ModuleAuthorProfileItem } from "@/lib/profile/module-author-profile";
import { configuredModuleModeReleaseDigests } from "./catalog";
import { readPublicModuleDetails } from "./public-details";

function validateRequest(account: string, page: number) {
  if (!/^0x[\da-f]{40}$/iu.test(account) || !Number.isSafeInteger(page) || page < 1) throw new Error("Invalid module profile request.");
}

/** Only the trusted publication reader may supply modules. The private submission queue is never read. */
export function moduleAuthorProfile(account: string, requestedPage: number, published: PublicModuleDetails | readonly PublicModuleDetails[] | null,
  unavailableReleaseDigests: readonly string[] = []): ModuleAuthorProfile {
  validateRequest(account, requestedPage);
  const wallet = account.toLowerCase();
  const sources = published === null ? [] : Array.isArray(published) ? published : [published as PublicModuleDetails];
  const releaseDigests = [...new Set(sources.map(source => source.releaseDigest.toLowerCase()))];
  const unavailable = [...new Set(unavailableReleaseDigests.map(digest => digest.toLowerCase()))].sort();
  if (releaseDigests.length + unavailable.length > MODULE_AUTHOR_PROFILE_MAX_RELEASES || unavailable.some(digest => releaseDigests.includes(digest))) throw new Error("Invalid module profile release coverage.");
  const revisions = new Map<string, ModuleAuthorProfileItem>();
  // Authorship comes from accepted review.subject.author. Project only public fields and exact source bindings.
  for (const source of sources) for (const item of source.items) {
    if (item.author.toLowerCase() !== wallet) continue;
    const key = `${item.packageId.toLowerCase()}:${item.manifestHash.toLowerCase()}`;
    const existing = revisions.get(key);
    if (existing) {
      if (!existing.sourceReleaseDigests.includes(source.releaseDigest.toLowerCase())) revisions.set(key, { ...existing,
        sourceReleaseDigests: [...existing.sourceReleaseDigests, source.releaseDigest.toLowerCase()].sort() });
      continue;
    }
    revisions.set(key, { packageId: item.packageId, familyId: item.familyId, title: item.title, description: item.description,
      version: item.version, author: wallet, category: item.category, manifestHash: item.manifestHash, sourceReleaseDigests: [source.releaseDigest.toLowerCase()] });
  }
  const items = [...revisions.values()].sort((left, right) => left.title.localeCompare(right.title, "en")
    || left.packageId.toLowerCase().localeCompare(right.packageId.toLowerCase()) || left.manifestHash.toLowerCase().localeCompare(right.manifestHash.toLowerCase()));
  const totalPages = Math.max(1, Math.ceil(items.length / MODULE_AUTHOR_PROFILE_PAGE_SIZE));
  const number = Math.min(requestedPage, totalPages);
  return { schemaVersion: MODULE_AUTHOR_PROFILE_SCHEMA, chainId: 4663, account: wallet,
    status: releaseDigests.length === 0 ? "unavailable" : unavailable.length ? "partial" : "ready",
    releaseDigest: releaseDigests[0] ?? null, releaseDigests, unavailableReleaseDigests: unavailable,
    items: items.slice((number - 1) * MODULE_AUTHOR_PROFILE_PAGE_SIZE, number * MODULE_AUTHOR_PROFILE_PAGE_SIZE),
    page: { number, size: MODULE_AUTHOR_PROFILE_PAGE_SIZE, totalItems: items.length, totalPages } };
}

export async function readModuleAuthorProfile(account: string, page = 1): Promise<ModuleAuthorProfile> {
  validateRequest(account, page);
  const digests = [...new Set(configuredModuleModeReleaseDigests().map(digest => moduleHash(digest, "moduleProfile.releaseDigest")))];
  if (digests.length > MODULE_AUTHOR_PROFILE_MAX_RELEASES) throw new Error("Too many module profile releases.");
  // Fanout is capped by the authority registry (current + at most 32 historical releases).
  // Each reused reader already coalesces calls and enforces its own 8-second I/O budget.
  const results = await Promise.allSettled(digests.map(digest => readPublicModuleDetails(digest)));
  const sources: PublicModuleDetails[] = []; const unavailable: string[] = [];
  for (const [index, result] of results.entries()) {
    const source = result.status === "fulfilled" ? result.value : null;
    if (source && typeof source.releaseDigest === "string" && source.releaseDigest.toLowerCase() === digests[index]
      && Array.isArray(source.items) && source.items.length <= 1000 && source.items.every(isModulePublicDetails)) sources.push(source);
    else unavailable.push(digests[index]);
  }
  return moduleAuthorProfile(account, page, sources, unavailable);
}
