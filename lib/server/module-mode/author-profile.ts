import type { ModulePublicDetails } from "@/lib/module-mode/public-details";
import { MODULE_AUTHOR_PROFILE_PAGE_SIZE, MODULE_AUTHOR_PROFILE_SCHEMA, type ModuleAuthorProfile } from "@/lib/profile/module-author-profile";
import { readPublicModuleDetails } from "./public-details";

type PublishedModules = { releaseDigest: string; items: ModulePublicDetails[] } | null;

/** Only the trusted publication reader may supply modules. The private submission queue is never read. */
export function moduleAuthorProfile(account: string, requestedPage: number, published: PublishedModules): ModuleAuthorProfile {
  if (!/^0x[\da-f]{40}$/iu.test(account) || !Number.isSafeInteger(requestedPage) || requestedPage < 1) throw new Error("Invalid module profile request.");
  const wallet = account.toLowerCase();
  // Authorship comes from accepted review.subject.author in the shared publication reader.
  // Explicit projection keeps review subjects, application IDs and payout wallets out of this response.
  const items = (published?.items ?? []).filter(item => item.author.toLowerCase() === wallet).map(item => ({
    packageId: item.packageId, familyId: item.familyId, title: item.title, description: item.description,
    version: item.version, author: wallet, category: item.category, manifestHash: item.manifestHash,
  })).sort((left, right) => left.title.localeCompare(right.title) || left.packageId.localeCompare(right.packageId));
  const totalPages = Math.max(1, Math.ceil(items.length / MODULE_AUTHOR_PROFILE_PAGE_SIZE));
  const number = Math.min(requestedPage, totalPages);
  return {
    schemaVersion: MODULE_AUTHOR_PROFILE_SCHEMA, chainId: 4663, account: wallet,
    status: published ? "ready" : "unavailable", releaseDigest: published?.releaseDigest ?? null,
    items: items.slice((number - 1) * MODULE_AUTHOR_PROFILE_PAGE_SIZE, number * MODULE_AUTHOR_PROFILE_PAGE_SIZE),
    page: { number, size: MODULE_AUTHOR_PROFILE_PAGE_SIZE, totalItems: items.length, totalPages },
  };
}

export async function readModuleAuthorProfile(account: string, page = 1): Promise<ModuleAuthorProfile> {
  return moduleAuthorProfile(account, page, await readPublicModuleDetails());
}
