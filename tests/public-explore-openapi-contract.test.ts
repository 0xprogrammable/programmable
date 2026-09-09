import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ snapshot: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (read: () => unknown) => read }));
vi.mock("@/lib/market-data/envio-classic-v3-catalog.server", () => ({ readEnvioClassicV3CatalogV1: vi.fn() }));
vi.mock("@/lib/alchemy/router-custom-public.server", () => ({ readWebsiteRouterCustomIdentitySnapshotV1: vi.fn() }));
vi.mock("@/lib/server/robinhood-index/store", () => ({ indexStore: () => ({ read: mocks.snapshot }) }));
vi.mock("@/lib/server/robinhood-presentation", () => ({
  readRobinhoodMarkets: async () => new Map(), readRobinhoodPresentations: async () => [],
}));

import { programmablePublicOpenApi } from "../lib/public-openapi";
import { readEthereumLaunches } from "../lib/server/ethereum-explore";
import { readRobinhoodLaunches } from "../lib/server/robinhood-index/read";
import { parseEthereumExploreQuery } from "../lib/ethereum-explore";
import { parseRobinhoodExploreQuery } from "../lib/robinhood-explore-filters";
import { customGraphExploreEntry } from "./launch-stamp-surface-fixture";
import { LAUNCH_PROJECTION_FEED_V1, projectionToRobinhoodLaunch } from "../lib/custom-launch/launch-projection-v1";
import { projectionFixture } from "./fixtures/universal-launch-v1";

const launchContract = JSON.parse(readFileSync(new URL("../public/openapi/custom-launch-v4.2.json", import.meta.url), "utf8"));

function validator(name: "ExploreIndexResetError" | "EthereumExplorePage" | "RobinhoodExplorePage") {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  ajv.addSchema(launchContract, "https://programmable.market/openapi/custom-launch-v4.2.json");
  return ajv.compile({
    $schema: programmablePublicOpenApi.jsonSchemaDialect,
    ...programmablePublicOpenApi.components.schemas[name],
    components: { schemas: programmablePublicOpenApi.components.schemas },
  });
}

const explorePaths = [
  "/api/explore",
  "/api/explore/token",
  "/api/explore/token/analytics",
] as const;

describe("public Explore OpenAPI contract", () => {
  it("documents the deterministic reset error for the retired JSON Explore reads", () => {
    const validate = validator("ExploreIndexResetError");

    expect(
      validate({
        error: "Token data is temporarily unavailable",
      }),
      JSON.stringify(validate.errors),
    ).toBe(true);
    expect(
      validate({
        error: "Token data is temporarily unavailable",
        status: "index_rebuilding",
      }),
      JSON.stringify(validate.errors),
    ).toBe(true);
    expect(
      validate({
        error: "Token data is temporarily unavailable",
        status: "ready",
      }),
    ).toBe(false);
    expect(
      validate({
        error: "Token data is temporarily unavailable",
        provider: "unexpected",
      }),
    ).toBe(false);

    for (const path of explorePaths) {
      const operation = programmablePublicOpenApi.paths[path].get;
      expect(Object.keys(operation.responses).sort()).toEqual(["400", "503"]);
      expect(operation.responses["503"]).toMatchObject({
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ExploreIndexResetError",
            },
          },
        },
        headers: {
          "Cache-Control": { schema: { const: "no-store" } },
          "Retry-After": { schema: { const: "3600" } },
          "X-Programmable-Indexing-Status": {
            schema: { const: "reset" },
          },
        },
      });
      expect(Object.keys(operation.responses["503"].headers).sort()).toEqual([
        "Cache-Control",
        "Retry-After",
        "X-Programmable-Indexing-Status",
      ]);
    }
  });

  it("retains the accepted query shapes without advertising a live result", () => {
    const list = programmablePublicOpenApi.paths["/api/explore"].get;
    const listParameters = new Map(
      list.parameters.map((parameter) => [parameter.name, parameter]),
    );
    expect([...listParameters.keys()]).toEqual([
      "chain",
      "page",
      "limit",
      "q",
      "model",
      "socials",
      "sort",
      "rankingCommitment",
    ]);
    expect(listParameters.get("chain")?.schema).toEqual({
      type: "integer",
      enum: [1, 4663],
      default: 1,
    });
    expect(listParameters.get("model")?.schema).toEqual({
      type: "string",
      enum: ["classic", "custom"],
    });

    const detail = programmablePublicOpenApi.paths["/api/explore/token"].get;
    expect(detail.parameters.map((parameter) => parameter.name)).toEqual([
      "chain",
      "address",
    ]);
    expect(
      detail.parameters.find((parameter) => parameter.name === "address"),
    ).toMatchObject({ required: true, in: "query" });

    const analytics =
      programmablePublicOpenApi.paths["/api/explore/token/analytics"].get;
    expect(analytics.parameters.map((parameter) => parameter.name)).toEqual([
      "chain",
      "address",
      "section",
      "limit",
    ]);
    expect(
      analytics.parameters.find((parameter) => parameter.name === "limit")
        ?.schema,
    ).toEqual({ type: "integer", const: 20, default: 20 });
  });

  it("scopes the provider-free reset boundary to legacy routes", () => {
    expect(
      programmablePublicOpenApi["x-programmable-availability"].exploreIndexing,
    ).toEqual({
      scope: "legacy-routes-only",
      paths: ["/api/explore", "/api/explore/token", "/api/explore/token/analytics", "/api/explore/token/chart"],
      status: "reset",
      publicReadStatus: 503,
      providerCalls: false,
      fallbacks: false,
      backgroundWorkers: false,
    });
    expect(
      programmablePublicOpenApi["x-programmable-boundary"].identity,
    ).toContain("No token identity is served by the legacy reset routes");
    expect(
      programmablePublicOpenApi["x-programmable-boundary"].marketData,
    ).toContain("legacy reset routes read no market, ranking, search, analytics or chart data");

    const serialized = JSON.stringify(programmablePublicOpenApi);
    expect(serialized).not.toMatch(/gmgn|dexscreener|bitquery/iu);
    expect(serialized).not.toContain("X-Programmable-Market-Provider");
    expect(serialized).not.toContain("X-Programmable-Read-Source");
    expect(programmablePublicOpenApi.components.schemas).not.toHaveProperty(
      "ExploreListResponse",
    );
    expect(programmablePublicOpenApi.components.schemas).not.toHaveProperty(
      "TokenDetailResponse",
    );
    expect(programmablePublicOpenApi.components.schemas).not.toHaveProperty(
      "TokenAnalyticsResponse",
    );
  });

  it("documents chain-specific query defaults and separates launch filters from source intake", () => {
    for (const [chain, parse] of [["ethereum", parseEthereumExploreQuery], ["robinhood", parseRobinhoodExploreQuery]] as const) {
      const operation = programmablePublicOpenApi.paths[`/api/explore/${chain}`].get;
      expect(operation.security).toEqual([]);
      expect(Object.keys(operation.responses).sort()).toEqual(["200", "400", "503"]);
      const defaults = Object.fromEntries(operation.parameters.map(parameter => [parameter.name, parameter.schema.default]));
      const parsed = parse(new URLSearchParams())!;
      expect(defaults).toEqual({ page: parsed.page, pageSize: parsed.pageSize, q: parsed.q, ...parsed.filters });
      expect(operation.parameters.find(parameter => parameter.name === "mode")?.description).toContain("do not restrict module source submissions");
    }
    expect(programmablePublicOpenApi["x-programmable-availability"].chainExplore).toMatchObject({
      ethereum: { path: "/api/explore/ethereum", statuses: ["ready", "partial", "stale", "unavailable"] },
      robinhood: { path: "/api/explore/robinhood", statuses: ["ready", "syncing", "stale", "unavailable"] },
    });
  });

  it("validates the actual Ethereum adapter output for available, partial, saved and unavailable sources", async () => {
    const validate = validator("EthereumExplorePage");
    const source = (status: "current" | "last-known-good") => async () => ({
      status, generatedAt: "2026-09-09T00:00:00.000Z", entries: [customGraphExploreEntry],
      evidence: { source: "canonical-launch-stamp-router" as const, generatedAt: "2026-09-09T00:00:00.000Z",
        asOfBlock: "25740001", asOfBlockHash: `0x${"ab".repeat(32)}`, commitment: `sha256:${"ab".repeat(32)}` },
    });
    const empty = async () => ({ status: "current" as const, generatedAt: "2026-09-09T00:00:00.000Z", entries: [] });
    const unavailable = async (): Promise<never> => { throw new Error("source unavailable"); };
    for (const [classic, custom, status] of [[empty, source("current"), "ready"], [unavailable, source("current"), "partial"],
      [empty, source("last-known-good"), "stale"], [unavailable, unavailable, "unavailable"]] as const) {
      const value = await readEthereumLaunches(1, "", { sort: "newest" }, 10, { classic, custom });
      expect(value.status).toBe(status);
      expect(validate(JSON.parse(JSON.stringify(value))), JSON.stringify(validate.errors)).toBe(true);
      expect(validate({ ...value, chainId: 4663 })).toBe(false);
      expect(validate({ ...value, status: "syncing" })).toBe(false);
    }
  });

  it("validates the actual Robinhood reader's saved-index statuses and source evidence", async () => {
    const validate = validator("RobinhoodExplorePage");
    const address = `0x${"11".repeat(20)}`, hash = `0x${"ab".repeat(32)}`;
    for (const status of ["ready", "syncing", "stale", "unavailable"] as const) {
      const updatedAt = new Date(Date.now() - (status === "stale" ? 301_000 : 0)).toISOString();
      mocks.snapshot.mockResolvedValue(status === "unavailable" ? null : { snapshot: {
        version: 1, chainId: 4663, routerAddress: address, binding: hash, startBlock: "1",
        cursor: { number: status === "syncing" ? "2" : "3", hash }, finalizedBlock: "3", updatedAt,
        items: [{ routerAddress: address, launchId: hash, tokenAddress: address, hookAddress: address,
          creator: address, poolManager: address, poolId: hash, stampHash: hash, transactionHash: hash,
          blockNumber: "1", blockHash: hash, logIndex: 0, launchedAt: updatedAt, name: "Example", symbol: "EX", decimals: 18 }],
      } });
      const value = await readRobinhoodLaunches();
      expect(value.status).toBe(status);
      expect(validate(JSON.parse(JSON.stringify(value))), JSON.stringify(validate.errors)).toBe(true);
      expect(validate({ ...value, chainId: 1 })).toBe(false);
      expect(validate({ ...value, status: "partial" })).toBe(false);
    }
  });

  it.each([
    ["custom_launch_plan_v1", null],
    ["custom_launch_plan_v1", "settlement"],
    ["multi_role_v2", "settlement"],
  ] as const)("validates saved %s projections with primary component %s", async (sourceVersion, primaryComponentId) => {
    const validate = validator("RobinhoodExplorePage");
    const projection = { ...projectionFixture(), sourceVersion, primaryComponentId };
    const row = projectionToRobinhoodLaunch(projection, projection.finalizedAt);
    const updatedAt = new Date().toISOString();
    mocks.snapshot.mockResolvedValue({ snapshot: {
      version: 1, chainId: 4663, routerAddress: row.tokenAddress, binding: row.blockHash,
      startBlock: "1", cursor: { number: row.blockNumber, hash: row.blockHash },
      finalizedBlock: row.blockNumber, updatedAt, items: [],
      launchProjections: { version: 1, sourceUrl: LAUNCH_PROJECTION_FEED_V1, updatedAt, nextCursor: null, items: [row] },
    } });
    const value = await readRobinhoodLaunches();
    expect(value.items).toEqual([row]);
    expect(value.items[0].primaryAssetAddress).toBe(primaryComponentId ? row.tokenAddress : null);
    expect(value.items[0].poolId).toBeNull();
    expect(validate(JSON.parse(JSON.stringify(value))), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...value, items: [{ ...row, launchProjection: {
      ...projection, distribution: { ...projection.distribution, uniswapLabsRouting: "guaranteed" },
    } }] })).toBe(false);
    expect(validate({ ...value, items: [{ ...row, primaryAssetAddress: "invalid" }] })).toBe(false);
    expect(validate({ ...value, sourceEvidence: { ...value.sourceEvidence, launchProjections: {
      ...value.sourceEvidence!.launchProjections, sourceUrl: "https://untrusted.invalid/feed",
    } } })).toBe(false);
  });

  it("keeps Custom Launch and API-key contracts intact", () => {
    expect(programmablePublicOpenApi.paths).toHaveProperty(
      "/v1/custom-launches",
    );
    expect(programmablePublicOpenApi.paths).toHaveProperty(
      "/v1/custom-launches/{launchId}",
    );
    expect(programmablePublicOpenApi.paths).toHaveProperty(
      "/api/custom-launch/registry/v2/readiness",
    );
    expect(programmablePublicOpenApi.components.securitySchemes).toHaveProperty(
      "CustomLaunchApiKey",
    );
  });
});
