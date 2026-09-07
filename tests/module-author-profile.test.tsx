import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ModulePublicDetails } from "@/lib/module-mode/public-details";
import { moduleAuthorProfile, readModuleAuthorProfile } from "@/lib/server/module-mode/author-profile";
import { readModuleAuthorProfileResponse } from "@/lib/profile/module-author-profile";
import { ProfileModuleCards, ProfileModules } from "@/components/profile-modules";
import { GET } from "@/app/api/profile/modules/route";

const mocks = vi.hoisted(() => ({ published: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/module-mode/public-details", () => ({ readPublicModuleDetails: mocks.published }));

const account = `0x${"a".repeat(40)}`;
const other = `0x${"b".repeat(40)}`;
const hash = (value: number) => `0x${value.toString(16).padStart(64, "0")}`;
const item = (id = 1, author = account): ModulePublicDetails => ({
  packageId: hash(id), familyId: hash(id + 100), title: `Module ${String(id).padStart(2, "0")}`,
  description: "Reviewed module description.", version: "1.0.0", author, category: "trading/opening-rules", manifestHash: hash(id + 200),
});
const published = (items = [item()]) => ({ releaseDigest: hash(999), items });

beforeEach(() => { vi.clearAllMocks(); mocks.published.mockResolvedValue(published()); });

describe("public modules authored by a wallet", () => {
  it("uses the publication reader's author and never treats a payout recipient as the author", async () => {
    const payoutOnly = { ...item(2, other), rewardWallet: account };
    const own = { ...item(), subject: { principalId: "private-principal", submissionId: "private-application" }, rewardWallet: other };
    const result = moduleAuthorProfile(account.toUpperCase().replace("0X", "0x"), 1, published([payoutOnly, own]));
    expect(result.items).toEqual([item()]);
    expect(result.page.totalItems).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(/principalId|submissionId|rewardWallet|private-principal/);
    expect(await readModuleAuthorProfile(account)).toEqual(moduleAuthorProfile(account, 1, published()));
    expect(mocks.published).toHaveBeenCalledExactlyOnceWith();
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
    expect(await failure.json()).toEqual({ error: "modules_unavailable" });
    const write = await GET(new Request(`https://programmable.market/api/profile/modules?account=${account}`, { method: "POST" }));
    expect(write.status).toBe(405);
  });
});

describe("profile module presentation", () => {
  it("provides native named module buttons and readable descriptions without rendering HTML from metadata", () => {
    const html = renderToStaticMarkup(<ProfileModuleCards items={[{ ...item(), title: "A <script> module" }]} onSelect={() => {}} />);
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="View module A &lt;script&gt; module"');
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
