import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  PREDICTION_ASSET_LOGO_KNOWN_ASSET_AUTHORIZATION_REQUIRED_FOR_ACTIVATION_V2,
  PREDICTION_ASSET_LOGO_RUNTIME_CONTROL_SCOPE_V2,
  PREDICTION_ASSET_LOGO_SHARED_LIMITS_REQUIRED_FOR_ACTIVATION_V2,
  createPredictionAssetLogoHandlerV2,
} from
  "../app/api/prediction/asset-logo/[asset]/handler";
import { GET } from "../app/api/prediction/asset-logo/[asset]/route";
import {
  predictionAssetCardImageV2,
  predictionAssetFallbackImageV2,
  predictionDexscreenerLogoAssetIdV2,
} from "../lib/prediction-v2/asset-logo-v2";

const ASSET = "ab".repeat(32);
const OTHER_ASSET = "cd".repeat(32);
const CAPABILITY = `v2.preview-1.1800000600.${"a".repeat(43)}`;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("Prediction V2 asset logos", () => {
  it("keeps runtime controls explicit without claiming activation safety", () => {
    expect(PREDICTION_ASSET_LOGO_RUNTIME_CONTROL_SCOPE_V2)
      .toBe("single-runtime-only");
    expect(PREDICTION_ASSET_LOGO_SHARED_LIMITS_REQUIRED_FOR_ACTIVATION_V2)
      .toBe(true);
    expect(
      PREDICTION_ASSET_LOGO_KNOWN_ASSET_AUTHORIZATION_REQUIRED_FOR_ACTIVATION_V2,
    ).toBe(true);
  });

  it("keeps the public image route dark while Prediction V2 is disabled", async () => {
    const response = await GET(
      new Request(`https://programmable.market/api/prediction/asset-logo/${ASSET}`),
      { params: Promise.resolve({ asset: ASSET }) },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("uses only the server-derived projection to build an internal route", () => {
    const providerUrl =
      `https://cdn.dexscreener.com/cms/images/${ASSET}` +
      "?width=800&height=800&quality=95&format=auto";
    expect(predictionDexscreenerLogoAssetIdV2(providerUrl)).toBe(ASSET);
    expect(predictionAssetCardImageV2({
      chainId: "base",
      address: `0x${"12".repeat(20)}`,
      logoUrl: "https://attacker.example/ignored.png",
      logoProxy: { assetId: ASSET, capability: CAPABILITY },
    })).toEqual({
      source: `/api/prediction/asset-logo/${ASSET}?capability=${CAPABILITY}`,
      usesProviderLogo: true,
    });
    expect(predictionAssetCardImageV2({
      chainId: "base",
      address: `0x${"12".repeat(20)}`,
      logoUrl: providerUrl,
    }).usesProviderLogo).toBe(false);
    expect(predictionAssetCardImageV2({
      chainId: "base",
      address: `0x${"12".repeat(20)}`,
      logoUrl: providerUrl,
      logoProxy: { assetId: OTHER_ASSET.toUpperCase(), capability: CAPABILITY },
    }).usesProviderLogo).toBe(false);
    expect(predictionAssetCardImageV2({
      chainId: "base",
      address: `0x${"12".repeat(20)}`,
      logoProxy: {
        assetId: ASSET,
        capability: `v1.preview-1.${"a".repeat(43)}`,
      },
    }).usesProviderLogo).toBe(false);
    expect(predictionDexscreenerLogoAssetIdV2(
      `https://cdn.dexscreener.com.example.com/cms/images/${ASSET}`,
    )).toBeNull();
    expect(predictionDexscreenerLogoAssetIdV2(
      `https://example.com/cms/images/${ASSET}`,
    )).toBeNull();
    expect(predictionDexscreenerLogoAssetIdV2(
      `https://cdn.dexscreener.com/cms/images/${ASSET}/other`,
    )).toBeNull();
  });

  it("uses a stable chain-and-address fallback for every namespace", () => {
    const first = predictionAssetFallbackImageV2(
      "solana",
      "4wBqpZM9xaSheZzJSMawUKKwhdpChKbZ5eu5ky4Vigw",
    );
    expect(first).toBe(predictionAssetFallbackImageV2(
      "solana",
      "4wBqpZM9xaSheZzJSMawUKKwhdpChKbZ5eu5ky4Vigw",
    ));
    expect(first).toMatch(/^\/brand\/programmable-token-fallback-/u);
    expect(predictionAssetCardImageV2({
      chainId: "solana",
      address: "4wBqpZM9xaSheZzJSMawUKKwhdpChKbZ5eu5ky4Vigw",
      logoUrl: "https://arbitrary.example/token.png",
    }).usesProviderLogo).toBe(false);
  });

  it("fetches one fixed upstream path and returns stripped 1000px WebP", async () => {
    const source = await sharp({
      create: {
        width: 320,
        height: 180,
        channels: 3,
        background: { r: 230, g: 120, b: 90 },
      },
    }).jpeg().toBuffer();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(source, {
      status: 200,
      headers: {
        "content-length": String(source.byteLength),
        "content-type": "image/jpeg",
      },
    }));
    const response = await createPredictionAssetLogoHandlerV2({
      fetchImpl,
      timeoutMs: 1_000,
    })(ASSET);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    await expect(sharp(await response.arrayBuffer()).metadata()).resolves
      .toMatchObject({ format: "webp", width: 1_000, height: 1_000 });
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://cdn.dexscreener.com/cms/images/${ASSET}` +
        "?width=1000&height=1000&quality=95&format=auto",
      expect.objectContaining({ redirect: "error", credentials: "omit" }),
    );
  });

  it("fails closed for invalid ids, redirects, oversized and non-image data", async () => {
    const handler = createPredictionAssetLogoHandlerV2({
      fetchImpl: vi.fn<typeof fetch>(async () => new Response("not an image", {
        status: 200,
        headers: { "content-type": "text/plain" },
      })),
    });
    await expect(handler("../token")).resolves.toMatchObject({ status: 400 });
    await expect(handler(ASSET)).resolves.toMatchObject({ status: 502 });

    const oversized = createPredictionAssetLogoHandlerV2({
      fetchImpl: vi.fn<typeof fetch>(async () => new Response("x", {
        status: 200,
        headers: {
          "content-length": "4000001",
          "content-type": "image/png",
        },
      })),
    });
    await expect(oversized(ASSET)).resolves.toMatchObject({ status: 502 });
  });

  it("bounds active provider and transform work without queueing", async () => {
    const firstFetch = deferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      if (fetchImpl.mock.calls.length === 1) return firstFetch.promise;
      return new Response("not an image", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    });
    const handler = createPredictionAssetLogoHandlerV2({
      fetchImpl,
      maximumConcurrentTransforms: 1,
    });

    const first = handler(ASSET);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    const saturated = await handler(OTHER_ASSET);
    expect(saturated.status).toBe(503);
    expect(saturated.headers.get("retry-after")).toBe("1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    firstFetch.resolve(new Response("not an image", {
      status: 200,
      headers: { "content-type": "text/plain" },
    }));
    await expect(first).resolves.toMatchObject({ status: 502 });
    await expect(handler(OTHER_ASSET)).resolves.toMatchObject({ status: 502 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("short-caches provider and transform failures, then retries after expiry", async () => {
    let now = 10_000;
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(
      "not an image",
      { status: 200, headers: { "content-type": "text/plain" } },
    ));
    const handler = createPredictionAssetLogoHandlerV2({
      fetchImpl,
      negativeCacheTtlMs: 50,
      nowMs: () => now,
    });

    await expect(handler(ASSET)).resolves.toMatchObject({ status: 502 });
    await expect(handler(ASSET)).resolves.toMatchObject({ status: 502 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 51;
    await expect(handler(ASSET)).resolves.toMatchObject({ status: 502 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("bounds negative-cache entries and never caches caller abort or capacity", async () => {
    const now = 20_000;
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(
      "not an image",
      { status: 200, headers: { "content-type": "text/plain" } },
    ));
    const handler = createPredictionAssetLogoHandlerV2({
      fetchImpl,
      maximumNegativeCacheEntries: 1,
      negativeCacheTtlMs: 100,
      nowMs: () => now,
    });
    const aborted = new AbortController();
    aborted.abort();

    await expect(handler(ASSET, aborted.signal)).resolves
      .toMatchObject({ status: 502 });
    expect(fetchImpl).not.toHaveBeenCalled();
    await handler(ASSET);
    await handler(OTHER_ASSET);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // The second failure evicts the first entry, so the first asset is fetched
    // again even though its original TTL has not expired.
    await handler(ASSET);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it.each([0, 17, 1.5])(
    "rejects invalid logo transform concurrency %s",
    (maximumConcurrentTransforms) => {
      expect(() => createPredictionAssetLogoHandlerV2({
        maximumConcurrentTransforms,
      })).toThrow(/maximumConcurrentTransforms/u);
    },
  );
});
