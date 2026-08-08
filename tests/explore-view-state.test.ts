import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE,
  EXPLORE_TOKENS_PER_PAGE,
  EXPLORE_REFRESH_INTERVAL_MS,
  filterTokensByLaunchModel,
  filterTokensBySocialPresence,
  getTokenCards,
  getExplorePaginationItems,
  getMarketCap,
  loadExploreModelDataset,
  loadExplorePayload,
  paginateTokensByExploreFilters,
  paginateTokensBySocialPresence,
  preserveExplorePayloadOnRefreshFailure,
  shouldRefreshExplore,
  tokenHasSocialLinks,
  tokenLaunchModelGroup,
} from "../components/explore-view";
import type { ExploreEntry, LauncherToken } from "../lib/tokens";

const classicProvenance = {
  schemaVersion: "programmable.explore-launch-category-provenance.v1",
  category: "classic",
  source: "canonical-launch-read-model",
  recordId: "fixture",
  modelId: null,
  modelVersion: null,
} as const;

const customProvenance = {
  schemaVersion: "programmable.explore-launch-category-provenance.v1",
  category: "custom",
  source: "interface-preview",
  projectId: `sha256:${"1".repeat(64)}`,
  launchId: `sha256:${"2".repeat(64)}`,
  sourceRecordBindingHash: `sha256:${"3".repeat(64)}`,
  finalizedLaunchBindingHash: `sha256:${"4".repeat(64)}`,
} as const;

function classicEntry(token: LauncherToken): ExploreEntry {
  return {
    ...token,
    exploreKind: "token",
    launchCategoryProvenance: {
      ...classicProvenance,
      recordId: token.id,
      modelId: token.launchModel ?? null,
      modelVersion: token.launchModelVersion ?? token.deepReleaseVersion ?? null,
    },
  };
}

function customEntry(index: number): ExploreEntry {
  const hash = `sha256:${index.toString(16).padStart(64, "0")}` as const;
  const wallet = {
    namespace: "eip155:1",
    value: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  } as const;
  return {
    exploreKind: "custom-project",
    id: `custom:${index}`,
    name: `Custom ${index}`,
    symbol: `C${index}`,
    links: [],
    launchedAt: "2026-08-03T00:00:00.000Z",
    finalizedAt: "2026-08-03T00:01:00.000Z",
    chainId: "1",
    modelId: "custom-contract-graph-v2",
    customProjectId: hash,
    customLaunchId: hash,
    launchingWallet: wallet,
    postLaunchAuthorityInventoryHash: hash,
    markets: [],
    postLaunchAuthorityInventory: {
      schemaVersion: "programmable.post-launch-authority-inventory.v1",
      launchingWallet: wallet,
      addressBindings: [],
      declaredIdentityBindings: [],
      postLaunchAuthorities: [],
      confirmation: {
        mode: "artifact-bound-launching-wallet-intent",
        confirmingIdentity: wallet,
        userVisibleDisclosureRequired: true,
      },
      postLaunchActionPolicy: "declared-onchain-authority-only",
      githubAuthority: "provenance-only-never-post-launch-authority",
      postLaunchAuthorityInventoryHash: hash,
    },
    launchCategoryProvenance: {
      ...customProvenance,
      projectId: hash,
      launchId: hash,
    },
  };
}

const payload = {
  status: "ready" as const,
  tokens: [],
  page: 1,
  pageSize: 9,
  total: 1,
  totalPages: 1,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Explore refresh state", () => {
  it("uses a balanced nine-card page and compact desktop pagination", () => {
    expect(EXPLORE_TOKENS_PER_PAGE).toBe(9);
    expect(getExplorePaginationItems(1, 10)).toEqual([
      1,
      2,
      3,
      "end-gap",
      10,
    ]);
    expect(getExplorePaginationItems(5, 10)).toEqual([
      1,
      "start-gap",
      5,
      "end-gap",
      10,
    ]);
    expect(getExplorePaginationItems(10, 10)).toEqual([
      1,
      "start-gap",
      8,
      9,
      10,
    ]);
  });

  it("treats only X and Telegram as social links", () => {
    const websiteOnly = { links: [{ kind: "website", url: "https://example.com" }] } satisfies Pick<
      LauncherToken,
      "links"
    >;
    const withX = { links: [{ kind: "x", url: "https://x.com/example" }] } satisfies Pick<
      LauncherToken,
      "links"
    >;

    expect(tokenHasSocialLinks(websiteOnly)).toBe(false);
    expect(tokenHasSocialLinks(withX)).toBe(true);
  });

  it("filters the loaded token page without fabricating social data", () => {
    const baseToken = {
      id: "1:test",
      name: "Test",
      symbol: "TEST",
      tokenAddress: "0x1111111111111111111111111111111111111111",
      hookAddress: "0x2222222222222222222222222222222222222222",
      poolId: `0x${"33".repeat(32)}`,
      launchedAt: "2026-07-29T00:00:00.000Z",
      totalSwapFeeBps: 100,
      liquidityPath: "meme",
    } satisfies LauncherToken;
    const withSocials = {
      ...baseToken,
      id: "1:social",
      links: [{ kind: "telegram" as const, url: "https://t.me/example" }],
    };

    expect(
      filterTokensBySocialPresence(
        [classicEntry(baseToken), classicEntry(withSocials)],
        "yes",
      ).map(
        (token) => token.id,
      ),
    ).toEqual(["1:social"]);
    expect(
      filterTokensBySocialPresence(
        [classicEntry(baseToken), classicEntry(withSocials)],
        "no",
      ).map(
        (token) => token.id,
      ),
    ).toEqual(["1:test"]);
  });

  it("filters the complete result set before creating nine-token pages", () => {
    const tokens = Array.from({ length: 22 }, (_, index) => classicEntry({
      id: `1:${index}`,
      name: `Token ${index}`,
      symbol: `T${index}`,
      tokenAddress: `0x${(index + 1).toString(16).padStart(40, "0")}`,
      hookAddress: "0x2222222222222222222222222222222222222222",
      poolId: `0x${(index + 1).toString(16).padStart(64, "0")}`,
      launchedAt: "2026-07-29T00:00:00.000Z",
      totalSwapFeeBps: 100,
      liquidityPath: "meme" as const,
      ...(index % 2 === 0
        ? {
            links: [
              { kind: "x" as const, url: `https://x.com/token${index}` },
            ],
          }
        : {}),
    } satisfies LauncherToken));

    expect(paginateTokensBySocialPresence(tokens, "yes", 1)).toMatchObject({
      page: 1,
      pageSize: 9,
      total: 11,
      totalPages: 2,
      tokens: expect.arrayContaining([
        expect.objectContaining({ id: "1:0" }),
        expect.objectContaining({ id: "1:16" }),
      ]),
    });
    expect(
      paginateTokensBySocialPresence(tokens, "yes", 2).tokens.map(
        (token) => token.id,
      ),
    ).toEqual(["1:18", "1:20"]);
    expect(paginateTokensBySocialPresence(tokens, "no", 1)).toMatchObject({
      total: 11,
      totalPages: 2,
      tokens: expect.arrayContaining([
        expect.objectContaining({ id: "1:1" }),
        expect.objectContaining({ id: "1:17" }),
      ]),
    });
  });

  it("groups only canonical provenance and never infers type from a model or address", () => {
    expect(tokenLaunchModelGroup({ launchCategoryProvenance: classicProvenance }))
      .toBe("classic");
    expect(tokenLaunchModelGroup({ launchCategoryProvenance: customProvenance }))
      .toBe("custom-hook");
    expect(tokenLaunchModelGroup({
      launchCategoryProvenance: {
        ...classicProvenance,
        modelId: "deep",
        recordId: "custom-looking-symbol-and-address",
      },
    })).toBe("classic");
  });

  it("labels a project-only Custom launch as No market without inventing a token", () => {
    const project = customEntry(1);
    expect(getTokenCards([project])).toEqual([
      expect.objectContaining({
        id: project.id,
        launchCategory: "Custom",
        marketStatus: "No market",
      }),
    ]);
    expect(getTokenCards([project])[0]).not.toHaveProperty("tokenAddress");
  });

  it("combines model and social filters before nine-token pagination", () => {
    const tokens = Array.from({ length: 25 }, (_, index) => index < 20
      ? classicEntry({
      id: `1:model-${index}`,
      name: `Model ${index}`,
      symbol: `M${index}`,
      tokenAddress: `0x${(index + 1).toString(16).padStart(40, "0")}`,
      hookAddress: "0x2222222222222222222222222222222222222222",
      poolId: `0x${(index + 1).toString(16).padStart(64, "0")}`,
      launchedAt: "2026-08-03T00:00:00.000Z",
      totalSwapFeeBps: 100,
      liquidityPath: "meme" as const,
      launchModel: "classic",
      links: [{ kind: "x" as const, url: `https://x.com/model${index}` }],
    } satisfies LauncherToken)
      : customEntry(index));

    expect(filterTokensByLaunchModel(tokens, "classic")).toHaveLength(20);
    expect(filterTokensByLaunchModel(tokens, "custom-hook")).toHaveLength(5);
    expect(
      paginateTokensByExploreFilters(tokens, "yes", "classic", 1),
    ).toMatchObject({ page: 1, pageSize: 9, total: 20, totalPages: 3 });
    expect(
      paginateTokensByExploreFilters(tokens, "yes", "classic", 2).tokens,
    ).toHaveLength(9);
    expect(
      paginateTokensByExploreFilters(tokens, "yes", "classic", 3).tokens,
    ).toHaveLength(2);
    expect(
      paginateTokensByExploreFilters(tokens, "yes", "custom-hook", 1),
    ).toMatchObject({ total: 0, totalPages: 0, tokens: [] });
  });

  it("loads every server page before model filtering and preserves server order", async () => {
    const tokens = Array.from({ length: 230 }, (_, index) => index < 145
      ? classicEntry({
      id: `1:server-model-${index}`,
      name: `Server model ${index}`,
      symbol: `SM${index}`,
      tokenAddress: `0x${(index + 1).toString(16).padStart(40, "0")}`,
      hookAddress: "0x2222222222222222222222222222222222222222",
      poolId: `0x${(index + 1).toString(16).padStart(64, "0")}`,
      launchedAt: "2026-08-03T00:00:00.000Z",
      totalSwapFeeBps: 100,
      liquidityPath: "meme" as const,
      launchModel: index < 145 ? ("classic" as const) : ("deep" as const),
      links: [
        { kind: "x" as const, url: `https://x.com/server-model-${index}` },
      ],
    } satisfies LauncherToken)
      : customEntry(index));
    const totalPages = Math.ceil(
      tokens.length / EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE,
    );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = new URL(String(input), "https://example.test");
        const page = Number(url.searchParams.get("page"));
        const pageSize = Number(url.searchParams.get("limit"));
        const offset = (page - 1) * pageSize;

        expect(pageSize).toBe(EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE);
        expect(url.searchParams.get("q")).toBe("server");
        expect(url.searchParams.get("sort")).toBe("newest");
        expect(url.searchParams.get("socials")).toBe("yes");

        return new Response(
          JSON.stringify({
            status: "ready",
            tokens: tokens.slice(offset, offset + pageSize),
            page,
            pageSize,
            total: tokens.length,
            totalPages,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      });

    const dataset = await loadExploreModelDataset(
      "complete-model-dataset",
      new URLSearchParams({
        q: "server",
        sort: "newest",
        socials: "yes",
        page: "12",
        limit: "9",
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(dataset.tokens.map((token) => token.id)).toEqual(
      tokens.map((token) => token.id),
    );
    expect(
      paginateTokensByExploreFilters(
        dataset.tokens,
        "all",
        "classic",
        12,
      ),
    ).toMatchObject({
      page: 12,
      pageSize: 9,
      total: 145,
      totalPages: 17,
      tokens: tokens
        .slice(99, 108)
        .map((token) => expect.objectContaining({ id: token.id })),
    });
  });

  it("refreshes only visible Explore content after the freshness interval", () => {
    expect(EXPLORE_REFRESH_INTERVAL_MS).toBe(30_000);
    expect(
      shouldRefreshExplore({
        visibilityState: "hidden",
        lastRefreshAt: 0,
        now: 60_000,
      }),
    ).toBe(false);
    expect(
      shouldRefreshExplore({
        visibilityState: "visible",
        lastRefreshAt: 5_000,
        now: 34_999,
      }),
    ).toBe(false);
    expect(
      shouldRefreshExplore({
        visibilityState: "visible",
        lastRefreshAt: 5_000,
        now: 35_000,
      }),
    ).toBe(true);
  });

  it("prefers a compatible indexed market cap over the older canonical snapshot", () => {
    const token = {
      id: "1:test",
      name: "Test",
      symbol: "TEST",
      tokenAddress: "0x1111111111111111111111111111111111111111",
      hookAddress: "0x2222222222222222222222222222222222222222",
      poolId: `0x${"33".repeat(32)}`,
      launchedAt: "2026-07-29T00:00:00.000Z",
      fdvUsdWad: "100000000000000000000",
      indexedMarketCapUsdWad: "125000000000000000000",
      totalSwapFeeBps: 100,
      liquidityPath: "meme",
    } satisfies LauncherToken;

    expect(getMarketCap(classicEntry(token))).toEqual({ kind: "usd", value: 125 });
  });

  it("keeps the last valid page when a background refresh fails", () => {
    expect(
      preserveExplorePayloadOnRefreshFailure(
        {
          phase: "ready",
          payload,
          contentKey: "same-content",
          requestKey: "previous-request",
        },
        {
          contentKey: "same-content",
          requestKey: "refresh-request",
          message: "RPC unavailable",
        },
      ),
    ).toEqual({
      phase: "ready",
      payload,
      contentKey: "same-content",
      requestKey: "refresh-request",
      refreshError: "RPC unavailable",
    });
  });

  it("does not show stale cards for a different query or page", () => {
    expect(
      preserveExplorePayloadOnRefreshFailure(
        {
          phase: "ready",
          payload,
          contentKey: "old-query",
          requestKey: "old-request",
        },
        {
          contentKey: "new-query",
          requestKey: "new-request",
          message: "RPC unavailable",
        },
      ),
    ).toEqual({
      phase: "error",
      contentKey: "new-query",
      requestKey: "new-request",
      message: "RPC unavailable",
    });
  });

  it("shares one in-flight request for repeated refreshes of the same content", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const search = new URLSearchParams({
      q: "",
      sort: "market-cap",
      page: "1",
      limit: "9",
    });

    const first = loadExplorePayload("same-content-dedupe", search);
    const second = loadExplorePayload("same-content-dedupe", search);

    expect(second).toBe(first);
    await expect(first).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops a stalled Explore request after twelve seconds", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    const request = loadExplorePayload(
      "stalled-content-timeout",
      new URLSearchParams({
        q: "",
        sort: "market-cap",
        page: "1",
        limit: "9",
      }),
    );
    const rejection = expect(request).rejects.toThrow(
      "Tokens took too long to respond",
    );

    await vi.advanceTimersByTimeAsync(12_000);
    await rejection;
  });
});
