import "server-only";

import { unstable_cache } from "next/cache";
import type { RobinhoodLaunch } from "@/lib/robinhood-launches";
import { ROBINHOOD_MARKET_MAX_AGE_MS, type RobinhoodCoinMarket, type RobinhoodCoinPresentation } from "@/lib/robinhood-presentation";
import { PROGRAMMABLE_MAIN_TOKEN_PRESENTATION } from "@/lib/programmable-main-token-presentation";
import { safePublicImageUrl } from "@/lib/safe-public-image-url";
// @ts-expect-error -- the canonical launch package is ESM JavaScript.
import { hashProjectMetadata, validateProjectMetadata } from "@/packages/launch/src/project-metadata.mjs";

const FINALIZED_FEED = "https://api.programmable.market/v4/chains/4663/finalized-custom-launches";
const DEX_PAIRS = "https://api.dexscreener.com/latest/dex/pairs/robinhood/";
const MAIN_TOKEN = "0xc60ba256b44334a0cd2c7242e98b88f031abb006";
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_METADATA_PAGES = 8;
const MAX_TOKENS = 50;
const MAX_MARKET_TOKENS = 10_000;
const ADDRESS = /^0x[\da-f]{40}$/i;
const HASH = /^0x[\da-f]{64}$/i;

type JsonObject = Record<string, unknown>;
type Metadata = Pick<RobinhoodCoinPresentation, "imageUrl" | "description" | "links">;
type MetadataBinding = Readonly<{ launch: JsonObject; metadata: Metadata }>;
type MarketToken = Pick<RobinhoodLaunch, "tokenAddress" | "poolId">;
const object = (value: unknown): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const same = (left: unknown, right: unknown) =>
  typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

async function readJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    signal, redirect: "error", cache: "no-store", headers: { accept: "application/json" },
  });
  if (!response.ok || response.redirected
    || response.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json"
    || Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES
    || !response.body) throw new Error("Presentation source unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("Presentation response too large");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function projectImageUrl(value: string): string | null {
  // These are the same public gateways used by the existing finalized feed reader.
  // The canonical metadata validator has already checked the CID or transaction ID.
  const url = new URL(value);
  if (url.protocol === "ipfs:") return `https://ipfs.io/ipfs/${url.hostname}`;
  if (url.protocol === "ar:") return `https://arweave.net/${url.hostname}`;
  return safePublicImageUrl(value) ?? null;
}

function parseMetadata(launch: unknown): MetadataBinding | null {
  if (!object(launch) || launch.schemaVersion !== "programmable.finalized-custom-launch-metadata.v4"
    || launch.apiVersion !== "v4" || launch.chainId !== "4663" || launch.caip2 !== "eip155:4663"
    || launch.platformId !== "programmable" || launch.category !== "custom"
    || launch.chainDeploymentId !== "robinhood-mainnet-custom-launch-v1"
    || !object(launch.onchain) || !object(launch.commitments)
    || !object(launch.sourceVerification) || launch.sourceVerification.status !== "exact_match"
    || !Array.isArray(launch.sourceVerification.components)
    || launch.sourceVerification.components.length === 0
    || !launch.sourceVerification.components.every((component) => object(component) && component.status === "exact_match")) return null;
  const onchain = launch.onchain;
  if (onchain.schemaVersion !== "programmable.custom-launch-onchain-evidence.v3"
    || onchain.chainId !== "4663" || onchain.caip2 !== "eip155:4663"
    || onchain.terminal !== true || onchain.checkpointType !== "ethereum_finalized"
    || !object(onchain.commitments) || !object(onchain.l2Inclusion)
    || !same(onchain.commitments.metadata, launch.commitments.metadata)) return null;
  try {
    const metadata = validateProjectMetadata(launch.projectMetadata, { requireComplete: true });
    if (hashProjectMetadata(metadata, { requireComplete: true }) !== launch.commitments.metadata) return null;
    const presentation = metadata.presentation as {
      description: string; image: { uri: string }; links: { kind: string; uri: string }[];
    };
    const labels: Record<string, string> = {
      website: "Website", x: "X", telegram: "Telegram", discord: "Discord",
      github: "GitHub", documentation: "Docs",
    };
    return { launch, metadata: {
      imageUrl: projectImageUrl(presentation.image.uri),
      description: presentation.description || null,
      links: presentation.links.flatMap(({ kind, uri }) => {
        const url = httpsUrl(uri);
        return url ? [{ label: labels[kind] ?? "Project link", url }] : [];
      }),
    } };
  } catch { return null; }
}

function metadataMatches(binding: MetadataBinding, token: RobinhoodLaunch): boolean {
  if (token.sourceKind === "module-native-v1") return false;
  const launch = binding.launch;
  const onchain = launch.onchain as JsonObject;
  const l2 = onchain.l2Inclusion as JsonObject;
  const source = launch.sourceVerification as JsonObject;
  const metadata = launch.projectMetadata as JsonObject;
  const declaredToken = metadata.token as JsonObject;
  const components = source.components as JsonObject[];
  return same(onchain.router, token.routerAddress) && same(onchain.routerLaunchId, token.launchId)
    && same(onchain.transactionHash, token.transactionHash) && same(l2.transactionHash, token.transactionHash)
    && l2.chainId === "4663" && l2.caip2 === "eip155:4663" && l2.receiptStatus === "success"
    && l2.blockNumber === token.blockNumber && same(l2.blockHash, token.blockHash)
    && l2.launchEventLogIndex === token.logIndex
    && (token.name === null || declaredToken.name === token.name)
    && (token.symbol === null || declaredToken.symbol === token.symbol)
    && components.some((component) => same(component.address, token.tokenAddress))
    && components.some((component) => same(component.address, token.hookAddress));
}

async function readMetadata(tokens: readonly RobinhoodLaunch[]): Promise<Map<string, Metadata>> {
  const result = new Map<string, Metadata>();
  const seenLaunches = new Set<string>();
  const seenCursors = new Set<string>();
  const signal = AbortSignal.timeout(6_000);
  let cursor: string | null = null;
  let datasetCount: number | null = null;
  // This is optional artwork lookup, never launch discovery. An unmatched older
  // launch keeps its card when the bounded lookup or either provider fails.
  for (let page = 0; page < MAX_METADATA_PAGES; page++) {
    const url = new URL(FINALIZED_FEED);
    url.searchParams.set("limit", "25");
    if (cursor !== null) url.searchParams.set("cursor", cursor);
    const value = await readJson(url.href, signal);
    if (!object(value) || value.schemaVersion !== "programmable.custom-launch-list.v4"
      || value.apiVersion !== "v4" || value.chainId !== "4663" || value.caip2 !== "eip155:4663"
      || !object(value.quality) || value.quality.status !== "ready"
      || !count(value.quality.publishedRowCount) || !count(value.quality.sourceRowCount)
      || value.quality.publishedRowCount !== value.quality.sourceRowCount
      || value.quality.quarantinedRowCount !== 0
      || !Array.isArray(value.launches) || value.launches.length > 25
      || value.launches.length > value.quality.publishedRowCount
      || typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt))
      || Date.now() - Date.parse(value.generatedAt) > 300_000
      || Date.parse(value.generatedAt) - Date.now() > 60_000
      || !(value.nextCursor === null || (typeof value.nextCursor === "string"
        && value.nextCursor.length > 0 && value.nextCursor.length <= 2_048))) {
      throw new Error("Invalid finalized metadata feed");
    }
    if (datasetCount !== null && datasetCount !== value.quality.publishedRowCount) {
      throw new Error("Finalized metadata changed during pagination");
    }
    datasetCount = value.quality.publishedRowCount;
    for (const item of value.launches) {
      const binding = parseMetadata(item);
      if (!binding) continue;
      const onchain = binding.launch.onchain as JsonObject;
      const key = `${String(onchain.router).toLowerCase()}:${String(onchain.routerLaunchId).toLowerCase()}`;
      if (seenLaunches.has(key)) throw new Error("Duplicate finalized metadata");
      seenLaunches.add(key);
      const token = tokens.find((candidate) => metadataMatches(binding, candidate));
      if (token) result.set(token.tokenAddress.toLowerCase(), binding.metadata);
    }
    if (value.nextCursor === null || result.size === tokens.length) return result;
    cursor = value.nextCursor as string;
    if (seenCursors.has(cursor) || value.launches.length === 0) throw new Error("Invalid finalized metadata cursor");
    seenCursors.add(cursor);
  }
  return result;
}

function numeric(value: unknown, signed = false): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && (signed || parsed >= 0) ? parsed : null;
}

async function readMarkets(tokens: readonly MarketToken[]): Promise<Map<string, RobinhoodCoinMarket>> {
  const pools = [...new Set(tokens.map((token) => token.poolId.toLowerCase()))];
  const batches = Array.from({ length: Math.ceil(pools.length / 30) }, (_, index) => pools.slice(index * 30, (index + 1) * 30));
  const pairs: { pair: unknown; observedAt: string }[] = [];
  const overall = AbortSignal.timeout(6_000);
  let nextBatch = 0;
  let failed = false;
  async function worker() {
    while (nextBatch < batches.length && !overall.aborted) {
      const batch = batches[nextBatch++];
      try {
        const payload = await readJson(`${DEX_PAIRS}${batch.join(",")}`,
          AbortSignal.any([overall, AbortSignal.timeout(4_000)]));
        if (!object(payload) || !(payload.pairs === null || Array.isArray(payload.pairs))
          || (Array.isArray(payload.pairs) && payload.pairs.length > 100)) throw new Error("Invalid market response");
        const observedAt = new Date().toISOString();
        if (Array.isArray(payload.pairs)) pairs.push(...payload.pairs.map((pair) => ({ pair, observedAt })));
      } catch { failed = true; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, batches.length) }, worker));
  // Reject an incomplete refresh so the cache retains the last complete observation.
  // The reader still expires it after three minutes; token membership is independent.
  if (failed || nextBatch < batches.length) throw new Error("Market observation unavailable");
  const byIdentity = new Map<string, { pair: JsonObject; observedAt: string } | null>();
  for (const { pair, observedAt } of pairs) {
    if (!object(pair) || pair.chainId !== "robinhood" || pair.dexId !== "uniswap"
      || !Array.isArray(pair.labels) || !pair.labels.includes("v4")
      || typeof pair.pairAddress !== "string" || !HASH.test(pair.pairAddress)
      || !object(pair.baseToken) || typeof pair.baseToken.address !== "string" || !ADDRESS.test(pair.baseToken.address)) continue;
    const key = `${pair.baseToken.address.toLowerCase()}:${pair.pairAddress.toLowerCase()}`;
    // Ambiguous duplicates never become a price for a verified launch.
    byIdentity.set(key, byIdentity.has(key) ? null : { pair, observedAt });
  }
  const markets = new Map<string, RobinhoodCoinMarket>();
  for (const token of tokens) {
    const match = byIdentity.get(`${token.tokenAddress.toLowerCase()}:${token.poolId.toLowerCase()}`);
    if (!match) continue;
    const { pair, observedAt } = match;
    markets.set(token.tokenAddress.toLowerCase(), {
      poolId: token.poolId,
      priceUsd: numeric(pair.priceUsd),
      marketCapUsd: numeric(pair.marketCap),
      liquidityUsd: object(pair.liquidity) ? numeric(pair.liquidity.usd) : null,
      volume24hUsd: object(pair.volume) ? numeric(pair.volume.h24) : null,
      change24hPercent: object(pair.priceChange) ? numeric(pair.priceChange.h24, true) : null,
      observedAt,
      sourceUrl: `https://dexscreener.com/robinhood/${token.poolId.toLowerCase()}`,
    });
  }
  return markets;
}

const cachedMetadata = unstable_cache(async (tokens: readonly RobinhoodLaunch[]) =>
  Array.from(await readMetadata(tokens)), ["robinhood-coin-metadata-v2"], { revalidate: 60 });

// A shared full-catalog observation makes sorting independent of the current page.
const cachedMarkets = unstable_cache(async (tokens: readonly MarketToken[]) =>
  Array.from(await readMarkets(tokens)), ["robinhood-coin-markets-v2"], { revalidate: 60 });

export async function readRobinhoodMarkets(tokens: readonly MarketToken[]): Promise<Map<string, RobinhoodCoinMarket>> {
  if (tokens.length === 0) return new Map();
  if (tokens.length > MAX_MARKET_TOKENS || tokens.some((token) => !ADDRESS.test(token.tokenAddress) || !HASH.test(token.poolId))) {
    throw new Error("Invalid market request");
  }
  const identities = tokens.map((token) => ({ tokenAddress: token.tokenAddress.toLowerCase(), poolId: token.poolId.toLowerCase() }))
    .toSorted((a, b) => a.tokenAddress.localeCompare(b.tokenAddress));
  const entries = await cachedMarkets(identities);
  const now = Date.now();
  return new Map(entries.filter(([, market]) => {
    const age = now - Date.parse(market.observedAt);
    return age >= 0 && age <= ROBINHOOD_MARKET_MAX_AGE_MS;
  }));
}

export async function readRobinhoodPresentations(tokens: readonly RobinhoodLaunch[], knownMarkets?: ReadonlyMap<string, RobinhoodCoinMarket>): Promise<RobinhoodCoinPresentation[]> {
  if (tokens.length === 0) return [];
  if (tokens.length > MAX_TOKENS || tokens.some((token) => !ADDRESS.test(token.tokenAddress) || !HASH.test(token.poolId))) {
    throw new Error("Invalid presentation request");
  }
  const [metadata, markets] = await Promise.allSettled([
    cachedMetadata(tokens.toSorted((a, b) => a.tokenAddress.toLowerCase().localeCompare(b.tokenAddress.toLowerCase()))).then((entries) => new Map(entries)),
    knownMarkets ? Promise.resolve(knownMarkets) : readRobinhoodMarkets(tokens),
  ]);
  return tokens.map((token): RobinhoodCoinPresentation => {
    const key = token.tokenAddress.toLowerCase();
    const presentation = metadata.status === "fulfilled" ? metadata.value.get(key) : undefined;
    return {
      tokenAddress: token.tokenAddress,
      imageUrl: presentation?.imageUrl ?? (key === MAIN_TOKEN ? PROGRAMMABLE_MAIN_TOKEN_PRESENTATION.imageUrl : null),
      description: presentation?.description ?? null,
      links: presentation?.links ?? [],
      market: markets.status === "fulfilled" ? markets.value.get(key) ?? null : null,
    };
  });
}
