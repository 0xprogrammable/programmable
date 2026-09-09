import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import sharp from "sharp";

import {
  assertPredictionV2VerifiedEnabledPublicReleaseV2,
  getPredictionV2PublicReleaseV2,
} from "@/lib/prediction-v2/public-release-v2.server";
import {
  PREDICTION_ASSET_LOGO_CAPABILITY_MAXIMUM_LENGTH_CLIENT_V2,
  predictionAssetLogoCapabilityExpiresAtUnixSecondsV2,
} from "@/lib/prediction-v2/asset-logo-v2";
import {
  assertPredictionV2ProviderRouteReadinessV2,
  getPredictionV2ProviderRouteReadinessV2,
} from
  "@/lib/market-data/prediction-v2-provider-route-readiness.server";
import { verifyTokenImageWebpV1 } from
  "@/lib/server/token-image-webp-v1";

const DEXSCREENER_IMAGE_ORIGIN = "https://cdn.dexscreener.com";
const ASSET_ID_PATTERN = /^[0-9a-f]{64}$/u;
const MAXIMUM_SOURCE_BYTES = 4_000_000;
const MAXIMUM_SOURCE_PIXELS = 16_000_000;
const FETCH_TIMEOUT_MS = 5_000;
const CAPABILITY_QUERY_PARAMETER = "capability";
export const PREDICTION_ASSET_LOGO_MAXIMUM_CONCURRENT_TRANSFORMS_V2 = 2;
export const PREDICTION_ASSET_LOGO_NEGATIVE_CACHE_TTL_MS_V2 = 5_000;
export const PREDICTION_ASSET_LOGO_MAXIMUM_NEGATIVE_CACHE_ENTRIES_V2 = 256;
export const PREDICTION_ASSET_LOGO_RUNTIME_CONTROL_SCOPE_V2 =
  "single-runtime-only" as const;
export const PREDICTION_ASSET_LOGO_SHARED_LIMITS_REQUIRED_FOR_ACTIVATION_V2 =
  true as const;
export const PREDICTION_ASSET_LOGO_KNOWN_ASSET_AUTHORIZATION_REQUIRED_FOR_ACTIVATION_V2 =
  true as const;
const ACCEPTED_SOURCE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type PredictionAssetLogoRouteDependenciesV2 = Readonly<{
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  nowMs?: () => number;
  maximumConcurrentTransforms?: number;
  negativeCacheTtlMs?: number;
  maximumNegativeCacheEntries?: number;
}>;

function errorResponse(status: number, retryAfterSeconds?: number) {
  return NextResponse.json(
    { error: "Asset image is unavailable" },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...(retryAfterSeconds === undefined
          ? {}
          : { "Retry-After": String(retryAfterSeconds) }),
      },
    },
  );
}

export function createPredictionAssetLogoHandlerV2(
  dependencies: PredictionAssetLogoRouteDependenciesV2 = {},
) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const nowMs = dependencies.nowMs ?? Date.now;
  const timeoutMs = boundedInteger(
    dependencies.timeoutMs,
    FETCH_TIMEOUT_MS,
    1,
    30_000,
    "timeoutMs",
  );
  const maximumConcurrentTransforms = boundedInteger(
    dependencies.maximumConcurrentTransforms,
    PREDICTION_ASSET_LOGO_MAXIMUM_CONCURRENT_TRANSFORMS_V2,
    1,
    16,
    "maximumConcurrentTransforms",
  );
  const negativeCacheTtlMs = boundedInteger(
    dependencies.negativeCacheTtlMs,
    PREDICTION_ASSET_LOGO_NEGATIVE_CACHE_TTL_MS_V2,
    1,
    60_000,
    "negativeCacheTtlMs",
  );
  const maximumNegativeCacheEntries = boundedInteger(
    dependencies.maximumNegativeCacheEntries,
    PREDICTION_ASSET_LOGO_MAXIMUM_NEGATIVE_CACHE_ENTRIES_V2,
    1,
    2_048,
    "maximumNegativeCacheEntries",
  );
  const negativeCache = new Map<string, number>();
  let activeTransforms = 0;

  return async function predictionAssetLogo(
    asset: string,
    requestSignal?: AbortSignal,
  ): Promise<Response> {
    if (!ASSET_ID_PATTERN.test(asset)) return errorResponse(400);
    if (requestSignal?.aborted) return errorResponse(502);
    if (hasFreshNegativeEntry(negativeCache, asset, checkedNow(nowMs))) {
      return errorResponse(502);
    }
    // This zero-queue bulkhead bounds one Node runtime only. It deliberately
    // does not claim edge, distributed or per-client abuse protection.
    if (activeTransforms >= maximumConcurrentTransforms) {
      return errorResponse(503, 1);
    }
    activeTransforms += 1;

    const source = `${DEXSCREENER_IMAGE_ORIGIN}/cms/images/${asset}` +
      "?width=1000&height=1000&quality=95&format=auto";
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = requestSignal
      ? AbortSignal.any([requestSignal, timeout])
      : timeout;

    const unavailable = () => {
      if (!requestSignal?.aborted) {
        const failureAtMs = checkedNow(nowMs);
        writeBoundedNegativeCache(
          negativeCache,
          asset,
          failureAtMs + negativeCacheTtlMs,
          maximumNegativeCacheEntries,
          failureAtMs,
        );
      }
      return errorResponse(502);
    };

    try {
      if (hasFreshNegativeEntry(negativeCache, asset, checkedNow(nowMs))) {
        return errorResponse(502);
      }
      // The asset identifier cannot select a host or path prefix. Redirects
      // remain disabled so this can never become an arbitrary URL proxy.
      const upstream = await fetchImpl(source, {
        cache: "force-cache",
        credentials: "omit",
        headers: { Accept: "image/webp,image/png,image/jpeg" },
        method: "GET",
        redirect: "error",
        signal,
      });
      const contentType = upstream.headers.get("content-type")
        ?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
      if (
        !upstream.ok ||
        upstream.redirected ||
        !ACCEPTED_SOURCE_TYPES.has(contentType)
      ) {
        await cancelResponseBody(upstream);
        return unavailable();
      }

      const bytes = await readBoundedImageBody(upstream);
      const image = sharp(bytes, {
        animated: false,
        failOn: "error",
        limitInputPixels: MAXIMUM_SOURCE_PIXELS,
        sequentialRead: true,
      });
      const metadata = await image.metadata();
      if (
        !metadata.width ||
        !metadata.height ||
        metadata.width * metadata.height > MAXIMUM_SOURCE_PIXELS ||
        (metadata.pages ?? 1) !== 1 ||
        !["jpeg", "png", "webp"].includes(metadata.format ?? "")
      ) return unavailable();

      const normalized = await image
        .rotate()
        .resize(1_000, 1_000, { fit: "cover", position: "centre" })
        .webp({ effort: 4, quality: 84 })
        .toBuffer();
      const verified = await verifyTokenImageWebpV1(normalized);
      if (signal.aborted) return unavailable();
      const digest = createHash("sha256").update(verified.bytes).digest("hex");

      return new Response(Uint8Array.from(verified.bytes).buffer, {
        status: 200,
        headers: {
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Length": String(verified.bytes.byteLength),
          "Content-Security-Policy": "default-src 'none'; sandbox",
          "Content-Type": "image/webp",
          ETag: `\"sha256-${digest}\"`,
          "X-Content-Type-Options": "nosniff",
          "X-Programmable-Image-Source": "dexscreener",
        },
      });
    } catch {
      return unavailable();
    } finally {
      activeTransforms -= 1;
    }
  };
}

function hasFreshNegativeEntry(
  cache: Map<string, number>,
  asset: string,
  nowMs: number,
) {
  const expiresAtMs = cache.get(asset);
  if (expiresAtMs === undefined) return false;
  if (expiresAtMs <= nowMs) {
    cache.delete(asset);
    return false;
  }
  return true;
}

function writeBoundedNegativeCache(
  cache: Map<string, number>,
  asset: string,
  expiresAtMs: number,
  maximumEntries: number,
  nowMs: number,
) {
  for (const [candidate, expiry] of cache) {
    if (expiry <= nowMs) cache.delete(candidate);
  }
  cache.delete(asset);
  while (cache.size >= maximumEntries) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  cache.set(asset, expiresAtMs);
}

function checkedNow(nowMs: () => number) {
  const value = nowMs();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("nowMs must return a non-negative safe integer");
  }
  return value;
}

function boundedInteger(
  candidate: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
) {
  const value = candidate ?? fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

async function readBoundedImageBody(response: Response) {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(declared) ||
      BigInt(declared) > BigInt(MAXIMUM_SOURCE_BYTES))
  ) {
    await cancelResponseBody(response);
    throw new TypeError("asset image is too large");
  }
  if (!response.body) throw new TypeError("asset image is empty");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAXIMUM_SOURCE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new TypeError("asset image is too large");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new TypeError("asset image is empty");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function cancelResponseBody(response: Response) {
  await response.body?.cancel().catch(() => undefined);
}

let handler: ReturnType<typeof createPredictionAssetLogoHandlerV2> | undefined;

function routeHandler() {
  handler ??= createPredictionAssetLogoHandlerV2();
  return handler;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ asset: string }> },
) {
  // Keep a disabled release entirely dark. Do not inspect route parameters,
  // query capabilities, secrets or provider state before this check passes.
  try {
    const release = getPredictionV2PublicReleaseV2();
    if (release.status !== "enabled") return errorResponse(404);
    assertPredictionV2VerifiedEnabledPublicReleaseV2(release);
    const readiness = getPredictionV2ProviderRouteReadinessV2();
    assertPredictionV2ProviderRouteReadinessV2(readiness);
    if (!readiness.productionReady) return errorResponse(404);
  } catch {
    return errorResponse(404);
  }
  const { asset } = await context.params;
  if (!ASSET_ID_PATTERN.test(asset)) return errorResponse(400);

  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url);
  } catch {
    return errorResponse(404);
  }
  const search = requestUrl.searchParams;
  if (
    [...search.keys()].some((key) => key !== CAPABILITY_QUERY_PARAMETER) ||
    search.getAll(CAPABILITY_QUERY_PARAMETER).length !== 1
  ) {
    return errorResponse(404);
  }
  const capability = search.get(CAPABILITY_QUERY_PARAMETER) ?? "";
  if (
    capability.length === 0 ||
    capability.length >
      PREDICTION_ASSET_LOGO_CAPABILITY_MAXIMUM_LENGTH_CLIENT_V2
  ) {
    return errorResponse(404);
  }
  const canonicalPath = `/api/prediction/asset-logo/${asset}`;
  const canonicalSearch = `?${CAPABILITY_QUERY_PARAMETER}=${capability}`;
  if (
    requestUrl.pathname !== canonicalPath ||
    requestUrl.search !== canonicalSearch ||
    requestUrl.hash !== ""
  ) {
    return errorResponse(404);
  }
  const expiresAt = predictionAssetLogoCapabilityExpiresAtUnixSecondsV2(
    capability,
  );
  if (expiresAt === null) return errorResponse(404);

  // Load and read the server-only HMAC key only after the release and bounded
  // request-shape gates. A capability authorizes exactly this canonical asset.
  let authorized = false;
  try {
    const { verifyConfiguredPredictionAssetLogoCapabilityV2 } = await import(
      "@/lib/market-data/prediction-asset-logo-capability-v2.server"
    );
    authorized = verifyConfiguredPredictionAssetLogoCapabilityV2(
      asset,
      capability,
    );
  } catch {
    return errorResponse(404);
  }
  if (!authorized) {
    return errorResponse(404);
  }
  const response = await routeHandler()(asset, request.signal);
  if (!response.ok) return response;

  const remainingSeconds = Math.max(
    0,
    expiresAt - Math.floor(Date.now() / 1_000),
  );
  const headers = new Headers(response.headers);
  // A cache must never keep serving a transient authorization beyond its
  // explicit expiry. The provider asset itself remains immutable by asset id.
  headers.set(
    "Cache-Control",
    remainingSeconds === 0
      ? "private, max-age=0, no-store"
      : `public, max-age=${remainingSeconds}, s-maxage=${remainingSeconds}`,
  );
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
