import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfileChainSelector } from "@/components/profile-chain-selector";
import { readRobinhoodProfileResponse } from "@/lib/profile/robinhood-profile";

const mocks = vi.hoisted(() => ({ profile: vi.fn(), presentation: vi.fn() }));
vi.mock("@/lib/server/robinhood-index/read", () => ({ readRobinhoodProfileLaunches: mocks.profile }));
vi.mock("@/lib/server/robinhood-presentation", () => ({ readRobinhoodPresentations: mocks.presentation }));
import { GET } from "@/app/api/explore/robinhood/presentation/route";

const account = `0x${"a".repeat(40)}`;
const other = `0x${"b".repeat(40)}`;
const row = { launchId: `0x${"1".repeat(64)}`, tokenAddress: `0x${"c".repeat(40)}`, creator: account, name: "Example", symbol: "EX", launchedAt: "2026-09-05T00:00:00.000Z" };
const response = () => ({ chainId: 4663, account, status: "ready", updatedAt: row.launchedAt, items: [row], page: { number: 1, size: 5, totalItems: 1, totalPages: 1, hasMore: false } });

beforeEach(() => vi.clearAllMocks());

describe("Robinhood profile account and chain boundaries", () => {
  it("accepts launches only for the requested account and chain", () => {
    expect(readRobinhoodProfileResponse(response(), account).items).toHaveLength(1);
    expect(() => readRobinhoodProfileResponse(response(), other)).toThrow();
    expect(() => readRobinhoodProfileResponse({ ...response(), chainId: 1 }, account)).toThrow();
    expect(() => readRobinhoodProfileResponse({ ...response(), items: [{ ...row, creator: other }] }, account)).toThrow();
    expect(() => readRobinhoodProfileResponse({ ...response(), items: [row, row] }, account)).toThrow();
  });

  it("rejects inconsistent totals, page bounds and truncated pages", () => {
    for (const page of [
      { ...response().page, size: 50 },
      { ...response().page, number: 2 },
      { ...response().page, totalItems: 6, totalPages: 2, hasMore: true },
      { ...response().page, totalPages: 2 },
      { ...response().page, hasMore: true },
    ]) expect(() => readRobinhoodProfileResponse({ ...response(), page }, account)).toThrow("Invalid profile page");
    expect(readRobinhoodProfileResponse({ ...response(), page: {
      number: 2, size: 5, totalItems: 6, totalPages: 2, hasMore: false,
    } }, account).page.number).toBe(2);
  });

  it.each([1, 4663] as const)("keeps both chain controls accessible with %s selected", (value) => {
    const html = renderToStaticMarkup(<ProfileChainSelector value={value} onChange={() => {}} />);
    expect(html).toContain("Profile chain");
    expect(html).toContain('aria-label="Ethereum"');
    expect(html).toContain('aria-label="Robinhood"');
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toContain(`checked="" value="${value}"`);
  });

  it("enriches only the creator-scoped page in one batch", async () => {
    mocks.profile.mockResolvedValue(response());
    mocks.presentation.mockResolvedValue([{ tokenAddress: row.tokenAddress }]);
    const result = await GET(new Request(`https://website.invalid/api/explore/robinhood/presentation?account=${account}&page=2`));
    expect(result.status).toBe(200);
    expect(mocks.profile).toHaveBeenCalledWith(account, 2, 50);
    expect(mocks.presentation).toHaveBeenCalledExactlyOnceWith([row]);
    expect(await result.json()).toEqual({ items: [{ tokenAddress: row.tokenAddress }] });
  });

  it.each([`account=${account}&account=${other}`, `account=${account}&token=${row.tokenAddress}`, `account=${account}&q=V4`, `account=${account}&page=0`, "account=invalid",
    ...["", "0", "1", "10", "51", "05", "5.0", "-5", "5e0", "invalid"].map(size => `account=${account}&pageSize=${size}`),
    `account=${account}&pageSize=5&pageSize=5`, `account=${account}&pageSize=5&pageSize=50`,
  ])("rejects an ambiguous presentation request: %s", async (query) => {
    expect((await GET(new Request(`https://website.invalid/api/explore/robinhood/presentation?${query}`))).status).toBe(400);
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.presentation).not.toHaveBeenCalled();
  });
});
