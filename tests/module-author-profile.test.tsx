import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ModulePublicDetails } from "@/lib/module-mode/public-details";
import { moduleAuthorProfile, readModuleAuthorProfile } from "@/lib/server/module-mode/author-profile";
import { readModuleAuthorProfileResponse } from "@/lib/profile/module-author-profile";
import { ProfileModuleCards, ProfileModules } from "@/components/profile-modules";
import { GET } from "@/app/api/profile/modules/route";

const mocks = vi.hoisted(() => ({ published: vi.fn(), releaseDigests: vi.fn(), enginePublished: vi.fn(), engineDigests: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/module-mode/public-details", () => ({ readPublicModuleDetails: mocks.published }));
vi.mock("@/lib/server/module-mode/catalog", () => ({ configuredModuleModeReleaseDigests: mocks.releaseDigests }));
vi.mock("@/lib/server/module-engine/catalog", () => ({ configuredModuleEngineReleaseDigests: mocks.engineDigests }));
vi.mock("@/lib/server/module-engine/public-details", () => ({ readPublicModuleEngineDetails: mocks.enginePublished }));

const account = `0x${"a".repeat(40)}`;
const other = `0x${"b".repeat(40)}`;
const hash = (value: number) => `0x${value.toString(16).padStart(64, "0")}`;
const item = (id = 1, author = account): ModulePublicDetails => ({
  packageId: hash(id), familyId: hash(id + 100), title: `Module ${String(id).padStart(2, "0")}`,
  description: "Reviewed module description.", version: "1.0.0", author, category: "trading/opening-rules", manifestHash: hash(id + 200),
});
const published = (items = [item()]) => ({ releaseDigest: hash(999), items });

beforeEach(() => { vi.clearAllMocks(); mocks.published.mockResolvedValue(published()); mocks.releaseDigests.mockReturnValue([hash(999)]); mocks.engineDigests.mockReturnValue([]); });

describe("public modules authored by a wallet", () => {
  it("uses the publication reader's author and never treats a payout recipient as the author", async () => {
    const payoutOnly = { ...item(2, other), rewardWallet: account };
    const own = { ...item(), subject: { principalId: "private-principal", submissionId: "private-application" }, rewardWallet: other };
    const result = moduleAuthorProfile(account.toUpperCase().replace("0X", "0x"), 1, published([payoutOnly, own]));
    expect(result.items).toEqual([{ ...item(), sourceReleaseDigests: [hash(999)] }]);
    expect(result.page.totalItems).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(/principalId|submissionId|rewardWallet|private-principal/);
    expect(await readModuleAuthorProfile(account)).toEqual(moduleAuthorProfile(account, 1, published()));
    expect(mocks.published).toHaveBeenCalledExactlyOnceWith(hash(999));
  });

  it("paginates all matching published modules and clamps pages after the final page", () => {
    const modules = Array.from({ length: 25 }, (_, index) => item(index + 1));
    const source = published([...modules, item(99, other)]);
    const first = moduleAuthorProfile(account, 1, source);
    const second = moduleAuthorProfile(account, 2, source);
    const last = moduleAuthorProfile(account, 999, source);
    expect(first.page).toEqual({ number: 1, size: 12, totalItems: 25, totalPages: 3 });
    expect(second.items).toHaveLength(12);
    expect(last.page.number).toBe(3);
    expect(last.items).toHaveLength(1);
    expect(new Set([...first.items, ...second.items, ...last.items].map(module => module.packageId)).size).toBe(25);
    expect(readModuleAuthorProfileResponse(second, account)).toEqual(second);
    expect(readModuleAuthorProfileResponse(last, account)).toEqual(last);
  });

  it("distinguishes no authored publications from an unavailable publication source", () => {
    const empty = moduleAuthorProfile(account, 1, published([item(1, other)]));
    const unavailable = moduleAuthorProfile(account, 1, null);
    expect(empty).toMatchObject({ status: "ready", releaseDigest: hash(999), items: [] });
    expect(unavailable).toMatchObject({ status: "unavailable", releaseDigest: null, items: [] });
    expect(readModuleAuthorProfileResponse(empty, account)).toEqual(empty);
    expect(readModuleAuthorProfileResponse(unavailable, account)).toEqual(unavailable);
  });

  it("rejects cross-account, cross-chain, duplicate and inconsistent profile responses", () => {
    const response = moduleAuthorProfile(account, 1, published());
    for (const value of [
      { ...response, account: other }, { ...response, chainId: 1 },
      { ...response, items: [item(1, other)] }, { ...response, items: [item(), item()] },
      { ...response, releaseDigest: null }, { ...response, status: "pending" },
      { ...response, page: { ...response.page, totalItems: 1000 } },
      { ...response, items: [{ ...item(), packageId: "not-a-package" }] },
    ]) expect(() => readModuleAuthorProfileResponse(value, account)).toThrow();
  });
});

describe("public profile module endpoint", () => {
  it("serves a creator-scoped public page with no cache of private submissions", async () => {
    const response = await GET(new Request(`https://programmable.market/api/profile/modules?account=${account}&page=2`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(moduleAuthorProfile(account, 2, published()));
  });

  it.each(["", "account=invalid", `account=${account}&page=0`, `account=${account}&page=1e2`, `account=${account}&page=1&page=2`, `account=${account}&account=${other}`, `account=${account}&status=pending`, `account=${account}&rewardWallet=${other}`])("rejects unsupported or ambiguous profile query %s", async query => {
    expect((await GET(new Request(`https://programmable.market/api/profile/modules?${query}`))).status).toBe(400);
    expect(mocks.published).not.toHaveBeenCalled();
  });

  it("fails closed without exposing upstream errors or returning a false empty success", async () => {
    mocks.published.mockResolvedValueOnce(null);
    const unavailable = await GET(new Request(`https://programmable.market/api/profile/modules?account=${account}`));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({ status: "unavailable" });
    mocks.published.mockRejectedValueOnce(new Error("private-principal internal failure"));
    const failure = await GET(new Request(`https://programmable.market/api/profile/modules?account=${account}`));
    expect(failure.status).toBe(503);
    const body = await failure.json();
    expect(body).toMatchObject({ status: "unavailable", items: [], unavailableReleaseDigests: [hash(999)] });
    expect(JSON.stringify(body)).not.toContain("private-principal");
    const write = await GET(new Request(`https://programmable.market/api/profile/modules?account=${account}`, { method: "POST" }));
    expect(write.status).toBe(405);
  });
});

describe("profile module presentation", () => {
  it("provides native named module buttons and readable descriptions without rendering HTML from metadata", () => {
    const html = renderToStaticMarkup(<ProfileModuleCards items={[{ ...item(), title: "A <script> module" }]} onSelect={() => {}} />);
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="View module A &lt;script&gt; module, version 1.0.0"');
    expect(html).toContain("Reviewed module description.");
    expect(html).toContain("Trading");
    expect(html).not.toContain("<script>");
  });

  it("starts with a named loading section instead of claiming a wallet has no modules", () => {
    const html = renderToStaticMarkup(<ProfileModules account={account} />);
    expect(html).toContain('id="profile-modules-title"');
    expect(html).toContain("Loading modules");
    expect(html).toContain('aria-label="Refresh modules"');
    expect(html).not.toContain("No published modules yet.");
  });
});

describe("supported historical contributor publications", () => {
  it("reads Engine histories with explicit source bindings and preserves actual operations", async () => {
    const engine = { ...item(7), sourceKind: "module-engine-v1" as const, engine: { interface: "escrow-v1" as const,
      operations: [{ operationId: hash(8) as `0x${string}`, authorization: 0 as const, inputRoles: 2, outputRoles: 0 }] } };
    mocks.engineDigests.mockReturnValue([hash(997), hash(996)]);
    mocks.enginePublished.mockImplementation(async digest => digest === hash(997) ? { sourceKind: "module-engine-v1", releaseDigest: digest, items: [engine] } : null);
    const profile = await readModuleAuthorProfile(account);
    expect(mocks.enginePublished.mock.calls).toEqual([[hash(997)], [hash(996)]]);
    expect(profile).toMatchObject({ status: "partial", unavailableReleaseDigests: [hash(996)], page: { totalItems: 2 } });
    expect(profile.items.find(value => value.sourceKind === "module-engine-v1")).toEqual({ ...engine, sourceReleaseDigests: [hash(997)] });
    expect(readModuleAuthorProfileResponse(profile, account)).toEqual(profile);
    mocks.enginePublished.mockResolvedValue({ releaseDigest: hash(997), items: [item(7)] });
    expect((await readModuleAuthorProfile(account)).items).toHaveLength(1);
  });

  it("reads every configured release exactly and preserves healthy historical modules when the current read fails", async () => {
    mocks.releaseDigests.mockReturnValue([hash(999), hash(998), hash(998)]);
    mocks.published.mockImplementation(async digest => digest === hash(999) ? null : { releaseDigest: digest, items: [item(3)] });
    const profile = await readModuleAuthorProfile(account);
    expect(mocks.published.mock.calls).toEqual([[hash(999)], [hash(998)]]);
    expect(profile).toMatchObject({ status: "partial", releaseDigest: hash(998), releaseDigests: [hash(998)], unavailableReleaseDigests: [hash(999)],
      items: [{ ...item(3), sourceReleaseDigests: [hash(998)] }] });
    expect(readModuleAuthorProfileResponse(profile, account)).toEqual(profile);
  });

  it("returns readable HTTP 200 partial data without leaking a failed release's private error", async () => {
    mocks.releaseDigests.mockReturnValue([hash(999), hash(998), hash(997)]);
    mocks.published.mockImplementation(async digest => {
      if (digest === hash(998)) throw new Error("private submission principal rewardWallet");
      if (digest === hash(997)) return null;
      return published();
    });
    const response = await GET(new Request(`https://programmable.market/api/profile/modules?account=${account}`));
    expect(response.status).toBe(200);
    const profile = await response.json();
    expect(profile).toMatchObject({ status: "partial", unavailableReleaseDigests: [hash(997), hash(998)], page: { totalItems: 1 } });
    expect(JSON.stringify(profile)).not.toMatch(/submission|principal|rewardWallet/);
    expect(readModuleAuthorProfileResponse(profile, account)).toEqual(profile);
  });

  it("deduplicates only identical package and manifest bindings and keeps other versions independently addressable", () => {
    const original = item(); const nextVersion = { ...original, version: "2.0.0", manifestHash: hash(500) };
    const profile = moduleAuthorProfile(account, 1, [published([original]), { releaseDigest: hash(998), items: [original, nextVersion] }]);
    expect(profile.page.totalItems).toBe(2);
    expect(profile.items).toEqual([{ ...original, sourceReleaseDigests: [hash(998), hash(999)] }, { ...nextVersion, sourceReleaseDigests: [hash(998)] }]);
    expect(readModuleAuthorProfileResponse(profile, account)).toEqual(profile);
    const html = renderToStaticMarkup(<ProfileModuleCards items={profile.items} onSelect={() => {}} />);
    expect(html).toContain('aria-label="View module Module 01, version 1.0.0"');
    expect(html).toContain('aria-label="View module Module 01, version 2.0.0"');
  });

  it("sorts and paginates the complete revision set independently of configured release order", () => {
    const left = { releaseDigest: hash(999), items: Array.from({ length: 14 }, (_, index) => item(index * 2 + 1)) };
    const right = { releaseDigest: hash(998), items: Array.from({ length: 14 }, (_, index) => item(index * 2 + 2)).reverse() };
    const first = moduleAuthorProfile(account, 1, [left, right]);
    const second = moduleAuthorProfile(account, 2, [right, left]);
    const last = moduleAuthorProfile(account, 999, [left, right]);
    expect(first.items).toEqual(moduleAuthorProfile(account, 1, [right, left]).items);
    expect(second.items).toEqual(moduleAuthorProfile(account, 2, [left, right]).items);
    expect(last.page).toEqual({ number: 3, size: 12, totalItems: 28, totalPages: 3 });
    expect(new Set([...first.items, ...second.items, ...last.items].map(value => value.packageId)).size).toBe(28);
  });

  it("never substitutes a newer release response for a requested historical digest", async () => {
    mocks.releaseDigests.mockReturnValue([hash(999), hash(998)]);
    mocks.published.mockResolvedValue(published());
    expect(await readModuleAuthorProfile(account)).toMatchObject({ status: "partial", releaseDigests: [hash(999)], unavailableReleaseDigests: [hash(998)], page: { totalItems: 1 } });
  });

  it("marks an empty healthy subset as partial, never as proof that the author has no publications", async () => {
    mocks.releaseDigests.mockReturnValue([hash(999), hash(998)]);
    mocks.published.mockImplementation(async digest => digest === hash(999) ? published([item(1, other)]) : null);
    const profile = await readModuleAuthorProfile(account);
    expect(profile).toMatchObject({ status: "partial", items: [], page: { totalItems: 0 } });
    expect(readModuleAuthorProfileResponse(profile, account)).toEqual(profile);
  });

  it("caps the configured fanout without reading unbounded releases", async () => {
    mocks.releaseDigests.mockReturnValue(Array.from({ length: 34 }, (_, index) => hash(index + 1)));
    await expect(readModuleAuthorProfile(account)).rejects.toThrow("Too many");
    expect(mocks.published).not.toHaveBeenCalled();
  });

  it("rejects false complete status, unbound revision sources and repeated manifest bindings", () => {
    const profile = moduleAuthorProfile(account, 1, [published()], [hash(998)]);
    for (const invalid of [
      { ...profile, status: "ready" }, { ...profile, unavailableReleaseDigests: [] },
      { ...profile, releaseDigests: [hash(999), hash(998)] }, { ...profile, releaseDigest: hash(998) },
      { ...profile, items: [{ ...profile.items[0], sourceReleaseDigests: [hash(998)] }] },
      { ...profile, items: [{ ...profile.items[0], sourceReleaseDigests: [] }] },
      { ...profile, items: [...profile.items, ...profile.items], page: { number: 1, size: 12, totalItems: 2, totalPages: 1 } },
    ]) expect(() => readModuleAuthorProfileResponse(invalid, account)).toThrow();
  });
});
