"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Search,
  X as CloseIcon,
} from "lucide-react";
import {
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { MarketCapMetric } from "@/components/animated-market-cap";
import { DiscordBrandIcon, GitHubBrandIcon, XBrandIcon } from "@/components/brand-icons";
import { ExploreChainSelector } from "@/components/explore-chain-selector";
import { EXPLORE_PREVIEW_TOKENS } from "@/components/explore-preview-data";
import {
  isInterfacePreviewHost,
  useInterfacePreview,
} from "@/components/interface-preview";
import { WebsiteLinkIcon } from "@/components/website-link-icon";
import {
  useViewChain,
  type ViewChainId,
} from "@/components/view-chain";
import { PartnerLaunchAttribution } from
  "@/components/partner-launch-attribution";
import { parseDiscoverableMarketTradeCapabilityV1 } from "@/lib/custom-launch/trade-capability-v1";
import {
  buildExploreDataQuality,
  exploreValuation,
  isExploreDataQuality,
  isExploreValuation,
  isExploreValuationQualifiedV1,
  type ExploreDataQuality,
  type ExploreValuation,
  type ValuedExploreEntry,
} from "@/lib/explore-financial-data";
import { resolveExploreChainId } from "@/lib/explore-chain";
import {
  CLASSIC_V4_PUBLIC_RELEASE_BINDING,
  isClassicV4AnchoredPublicReleaseBinding,
} from "@/lib/classic-v4-public-release";
import {
  isTokenMarketDataV1,
  marketDataStatusLabel,
} from "@/lib/market-data/market-data-v1";
import { isGmgnMarketSnapshotForExploreEntryV1 } from
  "@/lib/market-data/gmgn-market-data-v1";
import {
  applyTokenImageFallback,
  canOptimizeTokenImage,
  getTokenCardImageSource,
} from "@/lib/token-image";
import { safePublicImageUrl } from "@/lib/safe-public-image-url";
import { parseLaunchPartnerAttributionV1, type LaunchPartnerAttributionV1 } from
  "@/lib/launch-partner-attribution";
import {
  isLaunchStampProvenanceV1,
  type ExploreEntry,
  type ExploreLaunchCategoryProvenance,
  type LauncherToken,
  type TokenLink,
} from "@/lib/tokens";
import styles from "./explore-experience.module.css";

type ExploreMarketStatus =
  | "No market"
  | "Waiting for first trade"
  | "Last verified"
  | "Provider recent"
  | "Limited market data"
  | "Unavailable";

type TokenCard = {
  id: string;
  name: string;
  symbol: string;
  description?: string;
  imageUrl: string;
  links: readonly TokenLink[];
  valuation?: MarketCapMetric;
  valuationMetric?: "Fully diluted valuation";
  valuationProvider?: "GMGN" | "Dexscreener";
  marketStatus?: ExploreMarketStatus;
  usesFallbackImage: boolean;
  tokenAddress?: `0x${string}`;
  launchCategory: "Classic" | "Custom V4 Hook";
  partnerAttribution?: LaunchPartnerAttributionV1;
};

const EXPLORE_CARD_IMAGE_SIZES =
  "(max-width: 520px) calc((100vw - 38px) / 2), (max-width: 900px) calc((100vw - 48px) / 2), (max-width: 1280px) calc((100vw - 88px) / 3), 416px";
const SHARD_ORIGINAL_ARTWORK_SOURCE =
  "/brand/projects/shard-token-v1.png";

export function exploreMarketStatusLabel(
  entry: ExploreEntry | ValuedExploreEntry,
): ExploreMarketStatus | undefined {
  const marketData = (entry as Partial<ValuedExploreEntry>).marketData;
  if (marketData && isTokenMarketDataV1(marketData)) {
    return marketDataStatusLabel(marketData);
  }
  if (entry.exploreKind === "custom-project" && entry.markets.length === 0) {
    return "No market";
  }
  const explicit = (entry as Partial<ValuedExploreEntry>).valuation;
  const valuation = isExploreValuation(explicit)
    ? explicit
    : exploreValuation(entry);
  if (valuation.status === "unavailable") return "Unavailable";
  if (valuation.freshness === "provider-recent") return "Provider recent";
  if (valuation.freshness === "stale") return "Last verified";
  if (valuation.freshness === "unknown") return "Unavailable";
  return undefined;
}

export function exploreUnavailableFdvLabel(
  status: ExploreMarketStatus | undefined,
) {
  if (status === "Waiting for first trade") return status;
  if (status === "No market") return "No market yet";
  return "";
}

type TokenSort =
  | "newest"
  | "oldest"
  | "trending"
  | "market-cap"
  | "market-cap-asc";
export type ExploreValuationSort = "none" | "highest" | "lowest";
export type ExploreAgeSort = "none" | "newest" | "oldest";
export type ExploreDiscoverySort = "none" | "trending";
export type ExploreSocialFilter = "all" | "yes" | "no";
export type ExploreModelFilter = "all" | "classic" | "custom-hook";

export function resolveExploreSortSelectionsForChain(
  viewChainId: ViewChainId,
  valuationSort: ExploreValuationSort,
  ageSort: ExploreAgeSort,
  discoverySort: ExploreDiscoverySort,
) {
  if (viewChainId !== 4663) {
    return { valuationSort, ageSort, discoverySort } as const;
  }

  return {
    valuationSort: "none",
    ageSort: ageSort === "oldest" ? "none" : ageSort,
    discoverySort: "none",
  } as const;
}

type DexscreenerExploreMarketRead = Readonly<{
  provider: "dexscreener";
  status: "complete" | "partial" | "unavailable";
  currency: "USD";
  requestedCount: number;
  observedCount: number;
  qualifiedCount: number;
  unavailableCount: number;
  oldestFetchedAt: string | null;
  newestFetchedAt: string | null;
}>;

type GmgnExploreMarketRead = Readonly<{
  provider: "gmgn";
  fallbackProvider: "dexscreener";
  status: "complete" | "partial" | "unavailable";
  currency: "USD";
  requestedCount: number;
  observedCount: number;
  qualifiedCount: number;
  unavailableCount: number;
  gmgnObservedCount: number;
  gmgnQualifiedCount: number;
  fallbackRequestedCount: number;
  fallbackObservedCount: number;
  fallbackQualifiedCount: number;
  oldestFetchedAt: string | null;
  newestFetchedAt: string | null;
}>;

type LegacyBitqueryExploreMarketRead = Readonly<{
  provider: "bitquery";
  status: "unavailable";
  phase: "market-core" | "market-liquidity" | "market-price";
}> & (
  | Readonly<{ category: "transport"; reason?: never; httpStatus?: never }>
  | Readonly<{ category: "response"; reason: "http-status"; httpStatus: 402 }>
);

type ExploreMarketRead =
  | DexscreenerExploreMarketRead
  | GmgnExploreMarketRead
  | LegacyBitqueryExploreMarketRead;

type LegacyExploreRanking = Readonly<{
  status: "complete" | "partial" | "unavailable";
  requested: "fdv";
  applied: "fdv" | "qualified-fdv-then-launch-order" | "launch-order";
  qualifiedCount?: number;
  totalCount?: number;
}>;

type ExploreMarketCapRanking = Readonly<{
  schemaVersion: "programmable.explore-market-cap-ranking.v1";
  requested: "market-cap";
  direction: "asc" | "desc";
  primaryProvider: "gmgn";
  source:
    | "gmgn"
    | "gmgn+dexscreener"
    | "dexscreener"
    | "canonical-launch-order";
  fallbackProvider: "dexscreener";
  rankingCommitment: `sha256:${string}`;
  status: "complete" | "partial" | "unavailable";
  gmgnStatus: "complete" | "partial" | "unavailable";
  applied:
    | "gmgn-market-cap"
    | "gmgn-market-cap-then-gmgn-token-info-fdv"
    | "gmgn-market-cap-then-gmgn-token-info-fdv-then-launch-order"
    | "gmgn-market-cap-then-gmgn-token-info-fdv-then-dexscreener-fdv"
    | "gmgn-market-cap-then-gmgn-token-info-fdv-then-dexscreener-fdv-then-launch-order"
    | "gmgn-market-cap-then-dexscreener-fdv"
    | "gmgn-market-cap-then-dexscreener-fdv-then-launch-order"
    | "gmgn-market-cap-then-launch-order"
    | "gmgn-token-info-fdv"
    | "gmgn-token-info-fdv-then-launch-order"
    | "gmgn-token-info-fdv-then-dexscreener-fdv"
    | "gmgn-token-info-fdv-then-dexscreener-fdv-then-launch-order"
    | "fdv"
    | "qualified-fdv-then-launch-order"
    | "launch-order";
  metricOrder:
    "gmgn-market-cap>gmgn-token-info-fdv>dexscreener-fdv>canonical-launch-order";
  rankInterval: "1h";
  rankLimit: 100;
  observedTokenCount: number;
  matchedTokenCount: number;
  matchedUniqueTokenCount: number;
  canonicalEntryCount: number;
  canonicalTokenCount: number;
  unobservedCanonicalEntryCount: number;
  canonicalAddressCoverageBps: number;
  foreignTokenCount: number;
  discardedProviderItemCount: number;
  gmgnHydrationLimit: 100;
  gmgnHydrationEligibleCount: number;
  gmgnHydrationRequestedCount: number;
  gmgnHydrationObservedCount: number;
  gmgnHydrationQualifiedCount: number;
  gmgnHydrationDeferredCount: number;
  fallbackRequestedCount: number;
  fallbackQualifiedCount: number;
  canonicalTailCount: number;
  qualifiedCount: number;
  totalCount: number;
  asOfTime: string | null;
}>;

type ExploreRanking = LegacyExploreRanking | ExploreMarketCapRanking;

type ExploreDiscoveryRanking = Readonly<{
  schemaVersion: "programmable.explore-discovery-ranking.v1";
  provider: "gmgn";
  requested: "trending";
  rankingCommitment: `sha256:${string}`;
  status: "complete" | "partial" | "unavailable";
  applied: "gmgn-ranked-with-launch-order-fallback" | "launch-order";
  rankInterval: "1h";
  hotSearchInterval: "24h";
  snapshotCount: number;
  observedTokenCount: number;
  matchedTokenCount: number;
  matchedUniqueTokenCount: number;
  canonicalEntryCount: number;
  canonicalTokenCount: number;
  unobservedCanonicalEntryCount: number;
  canonicalAddressCoverageBps: number;
  foreignTokenCount: number;
  discardedProviderItemCount: number;
  asOfTime: string | null;
}>;

type ExploreSearchRanking = Readonly<{
  schemaVersion: "programmable.explore-search-ranking.v1";
  provider: "gmgn";
  requested: "search";
  orderBy: "weight";
  rankingCommitment: `sha256:${string}`;
  status: "complete" | "partial" | "unavailable";
  applied:
    | "gmgn-canonical-search-with-local-match-fallback"
    | "local-match-order";
  observedTokenCount: number;
  matchedTokenCount: number;
  matchedUniqueTokenCount: number;
  canonicalMatchCount: number;
  canonicalMatchTokenCount: number;
  unobservedCanonicalMatchCount: number;
  providerOnlyCanonicalTokenCount: number;
  foreignTokenCount: number;
  discardedProviderItemCount: number;
  duplicateProviderItemCount: number;
  canonicalAddressCoverageBps: number;
  asOfTime: string | null;
}>;

type ExploreCatalogBoundary = Readonly<{
  source:
    | "envio-classic-v3"
    | "durable-blob"
    | "robinhood-finalized-custom-launch-feed-v4";
  launchSource:
    | "durable-blob"
    | "durable-blob+registry.custom-launched"
    | "durable-blob+canonical-launch-stamp-router"
    | "durable-blob+registry.custom-launched+canonical-launch-stamp-router"
    | "registry.custom-launched"
    | "canonical-launch-stamp-router"
    | "registry.custom-launched+canonical-launch-stamp-router"
    | "envio-classic-v3"
    | "envio-classic-v3+registry.custom-launched"
    | "envio-classic-v3+canonical-launch-stamp-router"
    | "envio-classic-v3+registry.custom-launched+canonical-launch-stamp-router"
    | "robinhood-finalized-custom-launch-feed-v4+canonical-launch-stamp-router";
  status: "current" | "last-known-good";
  lastIndexedAt: string;
  asOfBlock: string;
  asOfBlockHash: `0x${string}`;
  identityCount: number;
  identityCommitment: `sha256:${string}`;
  completeness: Readonly<{
    classic: "current" | "last-known-good" | "unavailable";
    stock: "current" | "last-known-good" | "unavailable" | "excluded";
    custom: "current" | "last-known-good" | "unavailable";
    registryCustom?: "current" | "unavailable";
    routerCustom?: "current" | "last-known-good" | "unavailable";
  }>;
  scope?: Readonly<{
    included: readonly (
      | "classic-v3"
      | "classic-v4"
      | "official-main-token"
      | "registry.custom-launched"
      | "canonical-launch-stamp-router"
    )[];
    excluded: readonly [
      "classic-v1",
      "classic-v2",
      "stock-paired-v1",
      "stock-paired-v2",
      "stock-paired-v3",
    ];
    publicCategories: readonly ["classic", "custom"];
  }>;
  evidence?: Readonly<{
    kind: "envio-indexer-state";
    deployment: string;
    sourceCommit: string;
    progressBlock: string;
    progressOccurrenceId: string;
    commitment: `sha256:${string}`;
  }> | Readonly<{
    kind: "durable-envelope";
    commitment: `0x${string}`;
  }>;
  routerStamp?: Readonly<{
    source: "canonical-launch-stamp-router";
    status: "current" | "last-known-good" | "unavailable";
    finalityConfirmations: 64;
    verifiedIdentityCount: number;
    projectedIdentityCount: number;
    generatedAt?: string;
    asOfBlock?: string;
    asOfBlockHash?: `0x${string}`;
    identityCommitment?: `sha256:${string}`;
  }>;
}>;

type ExplorePayload = {
  status: "ready" | "not-deployed";
  tokens: ValuedExploreEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  dataQuality?: ExploreDataQuality;
  marketRead?: ExploreMarketRead;
  ranking?: ExploreRanking;
  discovery?: ExploreDiscoveryRanking;
  search?: ExploreSearchRanking;
  catalog?: ExploreCatalogBoundary;
};

export function exploreAppliedSortLabel(
  sort: TokenSort,
  ranking: ExploreRanking | undefined,
) {
  if (
    (sort === "market-cap" || sort === "market-cap-asc") &&
    ranking?.status === "unavailable"
  ) return "Launch order";
  if (
    (sort === "market-cap" || sort === "market-cap-asc") &&
    ranking?.status === "partial"
  ) return "Available valuation";
  if (sort === "newest") return "Newest";
  if (sort === "oldest") return "Oldest";
  if (sort === "trending") return "Trending";
  if (sort === "market-cap") return "Highest valuation";
  return "Lowest valuation";
}

export function resolveExploreServerSort(
  valuationSort: ExploreValuationSort,
  ageSort: ExploreAgeSort,
  discoverySort: ExploreDiscoverySort = "none",
): TokenSort {
  if (discoverySort === "trending") return "trending";
  if (valuationSort === "highest") return "market-cap";
  if (valuationSort === "lowest") return "market-cap-asc";
  if (ageSort === "oldest") return "oldest";
  return "newest";
}

export function requiresCompleteExploreDataset(
  valuationSort: ExploreValuationSort,
  ageSort: ExploreAgeSort,
  discoverySort: ExploreDiscoverySort = "none",
) {
  return discoverySort === "none" &&
    valuationSort !== "none" && ageSort === "oldest";
}

type ExploreState =
  | { phase: "loading" }
  | {
      phase: "error";
      message: string;
      requestKey: string;
      contentKey: string;
    }
  | {
      phase: "ready";
      payload: ExplorePayload;
      requestKey: string;
      contentKey: string;
    };

export type ExploreInitialResponse = Readonly<{
  ok: boolean;
  body: unknown;
}>;

export function preserveExplorePayloadOnRefreshFailure(
  current: ExploreState,
  input: {
    contentKey: string;
    requestKey: string;
    message: string;
  },
): ExploreState {
  return current.phase === "ready" && current.contentKey === input.contentKey
    ? {
        ...current,
        requestKey: input.requestKey,
      }
    : {
        phase: "error",
        contentKey: input.contentKey,
        requestKey: input.requestKey,
        message: input.message,
      };
}

function preserveKnownMarketObservation(
  previous: ValuedExploreEntry,
  incoming: ValuedExploreEntry,
): ValuedExploreEntry {
  const acceptIncoming =
    incoming.valuation.status === "available" ||
      previous.valuation.status !== "available";
  if (!acceptIncoming) return previous;

  const {
    marketData: _previousMarketData,
    gmgnMarketData: _previousGmgnMarketData,
    liquidityEvidence: _previousLiquidityEvidence,
    fdvUsdWad: _previousFdvUsdWad,
    ...identity
  } = previous as ValuedExploreEntry & Readonly<{ fdvUsdWad?: string }>;
  const incomingCompatibility = incoming as ValuedExploreEntry &
    Readonly<{ fdvUsdWad?: string }>;
  void _previousMarketData;
  void _previousGmgnMarketData;
  void _previousLiquidityEvidence;
  void _previousFdvUsdWad;
  return {
    ...identity,
    valuation: incoming.valuation,
    ...(incoming.marketData === undefined
      ? {}
      : { marketData: incoming.marketData }),
    ...(incoming.gmgnMarketData === undefined
      ? {}
      : { gmgnMarketData: incoming.gmgnMarketData }),
    ...(incoming.liquidityEvidence === undefined
      ? {}
      : { liquidityEvidence: incoming.liquidityEvidence }),
    ...(incomingCompatibility.fdvUsdWad === undefined
      ? {}
      : { fdvUsdWad: incomingCompatibility.fdvUsdWad }),
  } as ValuedExploreEntry;
}

export function stabilizeExploreRevalidationPayload(
  previous: ExplorePayload,
  incoming: ExplorePayload,
  options: Readonly<{
    incomingIsCompleteLocalSelection?: boolean;
  }> = {},
): ExplorePayload {
  if (options.incomingIsCompleteLocalSelection) return incoming;

  if (
    previous.status !== "ready" ||
    incoming.status !== "ready" ||
    previous.page !== incoming.page ||
    previous.pageSize !== incoming.pageSize ||
    previous.catalog?.identityCommitment !==
      incoming.catalog?.identityCommitment
  ) {
    return incoming;
  }

  // The caller reaches this function only for the same content key, which
  // binds query, sort, filters, page and page size. Provider-ranked responses
  // therefore have to move membership, order, pagination and their proof
  // together; mixing an incoming commitment with previous tokens would make
  // the client state internally inconsistent.
  const providerOrdered = incoming.discovery !== undefined ||
    incoming.search !== undefined ||
    incoming.ranking?.requested === "market-cap";
  if (providerOrdered) {
    const previousById = new Map(
      previous.tokens.map((token) => [token.id, token] as const),
    );
    return {
      ...incoming,
      tokens: incoming.tokens.map((token) => {
        const known = previousById.get(token.id);
        return known ? preserveKnownMarketObservation(known, token) : token;
      }),
    };
  }

  const incomingById = new Map(
    incoming.tokens.map((token) => [token.id, token] as const),
  );
  const stableTokens = previous.tokens.map((token) => {
    const next = incomingById.get(token.id);
    return next ? preserveKnownMarketObservation(token, next) : token;
  });

  return {
    ...previous,
    tokens: stableTokens,
    dataQuality: incoming.dataQuality ?? previous.dataQuality,
    marketRead: incoming.marketRead ?? previous.marketRead,
    ranking: incoming.ranking ?? previous.ranking,
    discovery: incoming.discovery ?? previous.discovery,
    search: incoming.search ?? previous.search,
  };
}

type PaginationItem = number | "start-gap" | "end-gap";

export const EXPLORE_TOKENS_PER_PAGE = 9;
export const EXPLORE_MOBILE_TOKENS_PER_PAGE = 4;
export const EXPLORE_MOBILE_BREAKPOINT_PX = 700;
export const EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE = 100;
export const EXPLORE_REVALIDATION_INTERVAL_MS = 45_000;
const EXPLORE_REVALIDATION_MIN_INTERVAL_MS = 1_000;
const EXPLORE_REVALIDATION_MAX_INTERVAL_MS = 60_000;

type ExploreTimestampedCacheEntry = Readonly<{
  key: string;
  updatedAt: number;
}>;

export function isExploreModelDatasetCacheFresh(
  cached: ExploreTimestampedCacheEntry | null,
  key: string,
  now = Date.now(),
) {
  return (
    cached?.key === key &&
    Number.isFinite(cached.updatedAt) &&
    Number.isFinite(now) &&
    Math.max(0, now - cached.updatedAt) < EXPLORE_REVALIDATION_INTERVAL_MS
  );
}

export function exploreRevalidationCacheTimestamp(input: Readonly<{
  activeKey: string;
  fallback: number;
  resolvedUpdatedAt: number | null;
  modelDataset: ExploreTimestampedCacheEntry | null;
}>) {
  const timestamps = [
    input.resolvedUpdatedAt,
    input.modelDataset?.key === input.activeKey
      ? input.modelDataset.updatedAt
      : null,
  ].filter((value): value is number => value !== null && Number.isFinite(value));
  return timestamps.length > 0 ? Math.min(...timestamps) : input.fallback;
}

type ExploreRevalidationScheduler = Readonly<{
  sync: () => void;
  dispose: () => void;
}>;

export function shouldRevalidateExplore(input: Readonly<{
  visibilityState: DocumentVisibilityState;
  online: boolean;
  lastRevalidationAt: number;
  now: number;
  intervalMs?: number;
}>) {
  const intervalMs = input.intervalMs ?? EXPLORE_REVALIDATION_INTERVAL_MS;
  return (
    input.visibilityState === "visible" &&
    input.online &&
    Number.isSafeInteger(intervalMs) &&
    intervalMs >= EXPLORE_REVALIDATION_MIN_INTERVAL_MS &&
    intervalMs <= EXPLORE_REVALIDATION_MAX_INTERVAL_MS &&
    Number.isFinite(input.lastRevalidationAt) &&
    Number.isFinite(input.now) &&
    input.now - input.lastRevalidationAt >= intervalMs
  );
}

export function createExploreRevalidationScheduler(input: Readonly<{
  visibilityState: () => DocumentVisibilityState;
  online: () => boolean;
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => number;
  clearTimeout: (timer: number) => void;
  onRevalidate: () => void;
  intervalMs?: number;
  lastRevalidationAt?: number;
}>): ExploreRevalidationScheduler {
  const intervalMs = input.intervalMs ?? EXPLORE_REVALIDATION_INTERVAL_MS;
  if (
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < EXPLORE_REVALIDATION_MIN_INTERVAL_MS ||
    intervalMs > EXPLORE_REVALIDATION_MAX_INTERVAL_MS
  ) {
    throw new Error("Explore revalidation requires a bounded interval");
  }

  let disposed = false;
  let timer: number | null = null;
  const initializedAt = input.now();
  let lastRevalidationAt = input.lastRevalidationAt ?? initializedAt;
  if (!Number.isFinite(lastRevalidationAt)) {
    lastRevalidationAt = initializedAt;
  }

  function clearTimer() {
    if (timer === null) return;
    input.clearTimeout(timer);
    timer = null;
  }

  function sync() {
    clearTimer();
    if (
      disposed ||
      input.visibilityState() !== "visible" ||
      !input.online()
    ) return;

    const now = input.now();
    const elapsed = Number.isFinite(now) && Number.isFinite(lastRevalidationAt)
      ? Math.max(0, now - lastRevalidationAt)
      : 0;
    const delayMs = Math.max(0, intervalMs - elapsed);
    timer = input.setTimeout(() => {
      timer = null;
      if (disposed) return;

      const revalidationAt = input.now();
      if (!shouldRevalidateExplore({
        visibilityState: input.visibilityState(),
        online: input.online(),
        lastRevalidationAt,
        now: revalidationAt,
        intervalMs,
      })) {
        sync();
        return;
      }

      lastRevalidationAt = revalidationAt;
      input.onRevalidate();
      sync();
    }, delayMs);
  }

  sync();
  return {
    sync,
    dispose() {
      disposed = true;
      clearTimer();
    },
  };
}

const EXPLORE_MOBILE_MEDIA_QUERY = `(max-width: ${EXPLORE_MOBILE_BREAKPOINT_PX}px)`;

export function exploreTokensPerPageForViewport(width: number) {
  return width <= EXPLORE_MOBILE_BREAKPOINT_PX
    ? EXPLORE_MOBILE_TOKENS_PER_PAGE
    : EXPLORE_TOKENS_PER_PAGE;
}

export function explorePageSizeMatchesViewport(
  pageSize: number,
  viewportWidth: number,
) {
  return pageSize === exploreTokensPerPageForViewport(viewportWidth);
}

function subscribeToExploreViewport(onChange: () => void) {
  const query = window.matchMedia(EXPLORE_MOBILE_MEDIA_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

type ExploreViewportSnapshot = "pending" | "mobile" | "desktop";

function exploreViewportSnapshot(): ExploreViewportSnapshot {
  return window.matchMedia(EXPLORE_MOBILE_MEDIA_QUERY).matches
    ? "mobile"
    : "desktop";
}

function exploreViewportServerSnapshot(): ExploreViewportSnapshot {
  return "pending";
}

function useExplorePaginationViewport() {
  const viewport = useSyncExternalStore(
    subscribeToExploreViewport,
    exploreViewportSnapshot,
    exploreViewportServerSnapshot,
  );
  return {
    ready: viewport !== "pending",
    pageSize: viewport === "mobile"
      ? EXPLORE_MOBILE_TOKENS_PER_PAGE
      : EXPLORE_TOKENS_PER_PAGE,
  } as const;
}
const QUERY_DEBOUNCE_MS = 200;
const EXPLORE_REQUEST_TIMEOUT_MS = 12_000;
const DEFAULT_EXPLORE_VALUATION_SORT: ExploreValuationSort = "none";
const fallbackTokenImages = [
  "/brand/programmable-token-card-fallback-night-garden-01.webp",
  "/brand/programmable-token-card-fallback-night-garden-02.webp",
  "/brand/programmable-token-card-fallback-night-garden-03.webp",
  "/brand/programmable-token-card-fallback-night-garden-04.webp",
  "/brand/programmable-token-card-fallback-night-garden-05.webp",
  "/brand/programmable-token-card-fallback-night-garden-06.webp",
] as const;
const ageSortOptions: {
  id: Exclude<ExploreAgeSort, "none">;
  label: string;
}[] = [
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
];
const socialFilterOptions: {
  id: Exclude<ExploreSocialFilter, "all">;
  label: string;
}[] = [
  { id: "yes", label: "Yes" },
  { id: "no", label: "No" },
];
const modelFilterOptions: {
  id: Exclude<ExploreModelFilter, "all">;
  label: string;
}[] = [
  { id: "classic", label: "Classic" },
  { id: "custom-hook", label: "Custom V4 Hook" },
];

export function exploreActiveSelectionState({
  valuationSort,
  ageSort,
  discoverySort = "none",
  socialFilter,
  modelFilter,
}: Readonly<{
  valuationSort: ExploreValuationSort;
  ageSort: ExploreAgeSort;
  discoverySort?: ExploreDiscoverySort;
  socialFilter: ExploreSocialFilter;
  modelFilter: ExploreModelFilter;
}>) {
  const defaultSortingApplied =
    valuationSort === DEFAULT_EXPLORE_VALUATION_SORT && ageSort === "none";
  const newestLaunchOrderApplied =
    !defaultSortingApplied &&
    valuationSort === "none" &&
    ageSort === "none";
  const labels = [
    modelFilter === "classic"
      ? "Classic"
      : modelFilter === "custom-hook"
        ? "Custom V4 Hook"
        : null,
    discoverySort === "trending" ? "Trending" : null,
    valuationSort !== "none" &&
    valuationSort !== DEFAULT_EXPLORE_VALUATION_SORT
      ? valuationSort === "highest"
        ? "Highest market cap"
        : "Lowest market cap"
      : newestLaunchOrderApplied
        ? "Newest launch order"
        : null,
    ageSort === "newest" ? "Newest" : ageSort === "oldest" ? "Oldest" : null,
    socialFilter === "yes"
      ? "With social links"
      : socialFilter === "no"
        ? "Without social links"
        : null,
  ].filter((label): label is string => label !== null);

  return {
    count: labels.length,
    summary: labels.length === 0
      ? "Default sorting applied"
      : `${labels.join(", ")} selected`,
  } as const;
}
const tokenLinkOrder: Record<TokenLink["kind"], number> = {
  website: 0,
  x: 1,
  telegram: 2,
  discord: 3,
  github: 4,
  gitbook: 5,
};

function launchBlockNumber(token: LauncherToken) {
  return token.launchBlockNumber && /^\d+$/.test(token.launchBlockNumber)
    ? BigInt(token.launchBlockNumber)
    : 0n;
}

function comparePreviewLaunchOrder(left: LauncherToken, right: LauncherToken) {
  const leftBlock = launchBlockNumber(left);
  const rightBlock = launchBlockNumber(right);
  if (leftBlock !== rightBlock) return leftBlock < rightBlock ? -1 : 1;

  const leftTransaction = left.launchTransactionIndex ?? 0;
  const rightTransaction = right.launchTransactionIndex ?? 0;
  if (leftTransaction !== rightTransaction) {
    return leftTransaction - rightTransaction;
  }

  const leftLog = left.launchLogIndex ?? 0;
  const rightLog = right.launchLogIndex ?? 0;
  if (leftLog !== rightLog) return leftLog - rightLog;

  if (leftBlock === 0n) {
    const leftTime = Date.parse(left.launchedAt);
    const rightTime = Date.parse(right.launchedAt);
    if (
      Number.isFinite(leftTime) &&
      Number.isFinite(rightTime) &&
      leftTime !== rightTime
    ) {
      return leftTime - rightTime;
    }
  }

  return left.tokenAddress.localeCompare(right.tokenAddress);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTokenAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isBytes32(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function parseTokenLink(value: unknown): TokenLink | null {
  if (!isRecord(value)) return null;
  if (
    value.kind !== "website" &&
    value.kind !== "x" &&
    value.kind !== "telegram" &&
    value.kind !== "discord" &&
    value.kind !== "github" &&
    value.kind !== "gitbook"
  ) {
    return null;
  }
  if (typeof value.url !== "string") return null;

  try {
    const url = new URL(value.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !url.hostname
    ) {
      return null;
    }
  } catch {
    return null;
  }

  return { kind: value.kind, url: value.url };
}

function parseLauncherToken(value: unknown): LauncherToken | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.symbol !== "string" ||
    !isTokenAddress(value.tokenAddress) ||
    !isTokenAddress(value.hookAddress) ||
    !isBytes32(value.poolId) ||
    typeof value.launchedAt !== "string" ||
    (value.totalSwapFeeBps !== null &&
      (typeof value.totalSwapFeeBps !== "number" ||
        !Number.isSafeInteger(value.totalSwapFeeBps) ||
        value.totalSwapFeeBps < 0)) ||
    (value.liquidityPath !== "meme" &&
      value.liquidityPath !== "programmable-v4")
  ) {
    return null;
  }

  const stamp = value.launchStampProvenance;
  if (
    stamp !== undefined &&
    (!isTokenAddress(value.creatorAddress) ||
      !isBytes32(value.launchTransactionHash) ||
      typeof value.launchBlockNumber !== "string" ||
      !/^[1-9][0-9]*$/u.test(value.launchBlockNumber) ||
      !Number.isSafeInteger(value.launchTransactionIndex) ||
      Number(value.launchTransactionIndex) < 0 ||
      !Number.isSafeInteger(value.launchLogIndex) ||
      Number(value.launchLogIndex) < 0 ||
      !isLaunchStampProvenanceV1(stamp, {
        tokenAddress: value.tokenAddress,
        hookAddress: value.hookAddress,
        poolId: value.poolId,
        launchWallet: value.creatorAddress,
        transactionHash: value.launchTransactionHash,
        blockNumber: value.launchBlockNumber,
        transactionIndex: Number(value.launchTransactionIndex),
        launchLogIndex: Number(value.launchLogIndex),
      }))
  ) {
    return null;
  }
  const stamped = stamp !== undefined;
  const unknownStampedFees = stamped && value.totalSwapFeeBps === null;
  if (
    stamped
      ? value.launchModel !==
          (stamp.kind === "custom-graph" ? "custom-graph" : "classic") ||
        value.launchModelVersion !== "programmable-launch-stamp-router-v1" ||
        value.liquidityPath !== "programmable-v4" ||
        !unknownStampedFees ||
        (unknownStampedFees &&
          (value.buyHookFeeBps !== undefined ||
            value.sellHookFeeBps !== undefined ||
            value.creatorFeeBps !== undefined ||
            value.buyCreatorFeeBps !== undefined ||
            value.sellCreatorFeeBps !== undefined ||
            value.growthFeeBps !== undefined ||
            value.programmableFeeBps !== undefined ||
            value.launcherFeeBps !== undefined ||
            value.transferTaxBps !== undefined))
      : value.launchModel === "custom-graph" ||
        value.totalSwapFeeBps === null ||
        value.liquidityPath !== "meme"
  ) {
    return null;
  }

  const links = Array.isArray(value.links)
    ? value.links
        .map(parseTokenLink)
        .filter((link): link is TokenLink => link !== null)
    : [];
  const partnerAttribution = value.partnerAttribution === undefined
    ? undefined
    : parseLaunchPartnerAttributionV1(value.partnerAttribution);
  if (value.partnerAttribution !== undefined && !partnerAttribution) return null;

  return {
    ...(value as unknown as LauncherToken),
    links,
    description:
      typeof value.description === "string" ? value.description : undefined,
    imageUrl: safePublicImageUrl(value.imageUrl),
    ...(partnerAttribution ? { partnerAttribution } : {}),
  };
}

function parseLaunchCategoryProvenance(
  value: unknown,
  category: "classic" | "custom",
): ExploreLaunchCategoryProvenance | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !==
      "programmable.explore-launch-category-provenance.v1" ||
    value.category !== category
  )
    return null;
  if (value.source === "canonical-launch-stamp-router") {
    return isBytes32(value.launchId) &&
      isBytes32(value.stampHash) &&
      isTokenAddress(value.routerAddress) &&
      isBytes32(value.transactionHash) &&
      isBytes32(value.blockHash) &&
      typeof value.blockNumber === "string" &&
      /^[1-9][0-9]*$/u.test(value.blockNumber) &&
      Number.isSafeInteger(value.transactionIndex) &&
      Number(value.transactionIndex) >= 0 &&
      Number.isSafeInteger(value.logIndex) &&
      Number(value.logIndex) >= 0
      ? (value as unknown as ExploreLaunchCategoryProvenance)
      : null;
  }
  if (category === "classic") {
    return value.source === "canonical-launch-read-model" &&
      typeof value.recordId === "string" &&
      (typeof value.modelId === "string" || value.modelId === null) &&
      (typeof value.modelVersion === "string" || value.modelVersion === null)
      ? (value as unknown as ExploreLaunchCategoryProvenance)
      : null;
  }
  const baseValid =
    isSha256(value.projectId) &&
    isSha256(value.launchId) &&
    isSha256(value.sourceRecordBindingHash) &&
    isSha256(value.finalizedLaunchBindingHash);
  if (!baseValid) return null;
  if (value.source === "interface-preview") {
    return value as unknown as ExploreLaunchCategoryProvenance;
  }
  return value.source === "registry.custom-launched" &&
    isTokenAddress(value.registryAddress) &&
    typeof value.registryStartBlock === "string" &&
    /^[1-9][0-9]*$/u.test(value.registryStartBlock) &&
    isBytes32(value.transactionHash) &&
    isBytes32(value.blockHash) &&
    typeof value.blockNumber === "string" &&
    /^[1-9][0-9]*$/u.test(value.blockNumber) &&
    Number.isSafeInteger(value.transactionIndex) &&
    Number(value.transactionIndex) >= 0 &&
    Number.isSafeInteger(value.logIndex) &&
    Number(value.logIndex) >= 0 &&
    isBytes32(value.configurationHash)
    ? (value as unknown as ExploreLaunchCategoryProvenance)
    : null;
}

function isSha256(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function parseCustomExploreAsset(value: unknown) {
  if (
    !isRecord(value) ||
    typeof value.assetId !== "string" ||
    !isRecord(value.identity) ||
    typeof value.identity.namespace !== "string" ||
    typeof value.identity.value !== "string" ||
    (value.decimals !== undefined &&
      (!Number.isSafeInteger(value.decimals) ||
        Number(value.decimals) < 0 ||
        Number(value.decimals) > 255))
  )
    return null;
  return {
    assetId: value.assetId,
    identity: {
      namespace: value.identity.namespace,
      value: value.identity.value,
    },
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(typeof value.symbol === "string" ? { symbol: value.symbol } : {}),
    ...(value.decimals === undefined
      ? {}
      : { decimals: Number(value.decimals) }),
  };
}

function parseCustomExploreMarkets(value: unknown, chainId: string) {
  if (!Array.isArray(value) || value.length > 256) return null;
  type CustomMarket = Extract<
    ExploreEntry,
    { exploreKind: "custom-project" }
  >["markets"][number];
  const markets: CustomMarket[] = [];
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      typeof candidate.marketId !== "string" ||
      typeof candidate.kind !== "string" ||
      !["active", "paused", "closed", "verification_pending"].includes(
        String(candidate.status),
      ) ||
      (candidate.poolId !== undefined && !isBytes32(candidate.poolId))
    )
      return null;
    const baseAsset = parseCustomExploreAsset(candidate.baseAsset);
    const quoteAsset = parseCustomExploreAsset(candidate.quoteAsset);
    if (baseAsset === null || quoteAsset === null) return null;
    const capability =
      candidate.tradeCapability === undefined
        ? undefined
        : parseDiscoverableMarketTradeCapabilityV1({
            value: candidate.tradeCapability,
            chainId,
            marketId: candidate.marketId,
            baseAssetId: baseAsset.assetId,
            quoteAssetId: quoteAsset.assetId,
            ...(candidate.poolId === undefined
              ? {}
              : { poolId: candidate.poolId }),
          });
    if (candidate.tradeCapability !== undefined && capability === null)
      return null;
    markets.push({
      marketId: candidate.marketId,
      kind: candidate.kind,
      status: candidate.status as CustomMarket["status"],
      ...(candidate.poolId === undefined ? {} : { poolId: candidate.poolId }),
      baseAsset,
      quoteAsset,
      ...(capability === undefined
        ? {}
        : { tradeCapability: capability as CustomMarket["tradeCapability"] }),
    });
  }
  return markets;
}

function parseCustomExploreEntry(value: unknown): ExploreEntry | null {
  const categoryProvenance = isRecord(value)
    ? parseLaunchCategoryProvenance(value.launchCategoryProvenance, "custom")
    : null;
  if (
    !isRecord(value) ||
    value.exploreKind !== "custom-project" ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.launchedAt !== "string" ||
    typeof value.finalizedAt !== "string" ||
    typeof value.chainId !== "string" ||
    typeof value.modelId !== "string" ||
    !isSha256(value.customProjectId) ||
    !isSha256(value.customLaunchId) ||
    !isRecord(value.launchingWallet) ||
    typeof value.launchingWallet.namespace !== "string" ||
    typeof value.launchingWallet.value !== "string" ||
    !/^eip155:[1-9][0-9]*$/u.test(value.launchingWallet.namespace) ||
    !/^0x[0-9a-f]{40}$/u.test(value.launchingWallet.value) ||
    !isSha256(value.postLaunchAuthorityInventoryHash) ||
    !isRecord(value.postLaunchAuthorityInventory) ||
    value.postLaunchAuthorityInventory.schemaVersion !==
      "programmable.post-launch-authority-inventory.v1" ||
    value.postLaunchAuthorityInventory.postLaunchAuthorityInventoryHash !==
      value.postLaunchAuthorityInventoryHash ||
    value.postLaunchAuthorityInventory.githubAuthority !==
      "provenance-only-never-post-launch-authority" ||
    !Array.isArray(value.postLaunchAuthorityInventory.postLaunchAuthorities) ||
    !Array.isArray(value.markets) ||
    !Array.isArray(value.links) ||
    categoryProvenance === null ||
    categoryProvenance.source === "canonical-launch-stamp-router"
  )
    return null;
  const links = value.links.map(parseTokenLink);
  if (links.some((link) => link === null)) return null;
  if (value.tokenAddress !== undefined && !isTokenAddress(value.tokenAddress)) {
    return null;
  }
  if (
    value.tokenDecimals !== undefined &&
    (!Number.isSafeInteger(value.tokenDecimals) ||
      Number(value.tokenDecimals) < 0 ||
      Number(value.tokenDecimals) > 255)
  )
    return null;
  const markets = parseCustomExploreMarkets(value.markets, value.chainId);
  if (markets === null) return null;
  const partnerAttribution = value.partnerAttribution === undefined
    ? undefined
    : parseLaunchPartnerAttributionV1(value.partnerAttribution);
  if (value.partnerAttribution !== undefined && !partnerAttribution) return null;
  return {
    exploreKind: "custom-project",
    id: value.id,
    name: value.name,
    ...(typeof value.symbol === "string" ? { symbol: value.symbol } : {}),
    ...(typeof value.description === "string"
      ? { description: value.description }
      : {}),
    ...(safePublicImageUrl(value.imageUrl)
      ? { imageUrl: value.imageUrl as string }
      : {}),
    links: links as TokenLink[],
    launchedAt: value.launchedAt,
    finalizedAt: value.finalizedAt,
    chainId: value.chainId,
    modelId: value.modelId,
    customProjectId: value.customProjectId,
    customLaunchId: value.customLaunchId,
    launchingWallet: value.launchingWallet as Extract<
      ExploreEntry,
      { exploreKind: "custom-project" }
    >["launchingWallet"],
    postLaunchAuthorityInventory: value.postLaunchAuthorityInventory as Extract<
      ExploreEntry,
      { exploreKind: "custom-project" }
    >["postLaunchAuthorityInventory"],
    postLaunchAuthorityInventoryHash: value.postLaunchAuthorityInventoryHash,
    markets,
    ...(value.tokenAddress === undefined
      ? {}
      : { tokenAddress: value.tokenAddress }),
    ...(value.tokenDecimals === undefined
      ? {}
      : { tokenDecimals: value.tokenDecimals as number }),
    launchCategoryProvenance: value.launchCategoryProvenance as Extract<
      ExploreEntry,
      { exploreKind: "custom-project" }
    >["launchCategoryProvenance"],
    ...(partnerAttribution ? { partnerAttribution } : {}),
  };
}

function parseExploreEntry(value: unknown): ValuedExploreEntry | null {
  const attachValuation = <T extends ExploreEntry>(entry: T) => {
    const valuation =
      isRecord(value) && value.valuation === undefined
        ? exploreValuation(entry)
        : isRecord(value) && isExploreValuation(value.valuation)
          ? value.valuation
          : null;
    const marketData =
      isRecord(value) && value.marketData !== undefined
        ? isTokenMarketDataV1(value.marketData)
          ? value.marketData
          : null
        : undefined;
    const gmgnMarketData =
      isRecord(value) && value.gmgnMarketData !== undefined
        ? isGmgnMarketSnapshotForExploreEntryV1(value.gmgnMarketData, entry)
          ? value.gmgnMarketData
          : null
        : undefined;
    return valuation === null || marketData === null || gmgnMarketData === null
      ? null
      : {
          ...entry,
          valuation,
          ...(marketData === undefined ? {} : { marketData }),
          ...(gmgnMarketData === undefined ? {} : { gmgnMarketData }),
        };
  };
  if (isRecord(value) && value.exploreKind === "custom-project") {
    const entry = parseCustomExploreEntry(value);
    return entry ? attachValuation(entry) : null;
  }
  const token = parseLauncherToken(value);
  const expectedCategory =
    token?.launchStampProvenance?.kind === "custom-graph"
      ? "custom"
      : "classic";
  const categoryProvenance = isRecord(value)
    ? parseLaunchCategoryProvenance(
        value.launchCategoryProvenance,
        expectedCategory,
      )
    : null;
  if (
    !token ||
    !isRecord(value) ||
    value.exploreKind !== "token" ||
    categoryProvenance === null
  )
    return null;
  const stamp = token.launchStampProvenance;
  if (stamp) {
    if (
      categoryProvenance.source !== "canonical-launch-stamp-router" ||
      categoryProvenance.launchId.toLowerCase() !==
        stamp.launchId.toLowerCase() ||
      categoryProvenance.stampHash.toLowerCase() !==
        stamp.stampHash.toLowerCase() ||
      categoryProvenance.routerAddress.toLowerCase() !==
        stamp.routerAddress.toLowerCase() ||
      categoryProvenance.transactionHash.toLowerCase() !==
        stamp.transactionHash.toLowerCase() ||
      categoryProvenance.blockHash.toLowerCase() !==
        stamp.blockHash.toLowerCase() ||
      categoryProvenance.blockNumber !== stamp.blockNumber ||
      categoryProvenance.transactionIndex !== stamp.transactionIndex ||
      categoryProvenance.logIndex !== stamp.launchLogIndex
    ) {
      return null;
    }
  } else if (categoryProvenance.source === "canonical-launch-stamp-router") {
    return null;
  }
  return attachValuation({
    ...token,
    exploreKind: "token",
    launchCategoryProvenance: value.launchCategoryProvenance as Extract<
      ExploreEntry,
      { exploreKind: "token" }
    >["launchCategoryProvenance"],
  });
}

function positiveInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : fallback;
}

function parseExploreMarketRead(value: unknown): ExploreMarketRead | null {
  if (
    isRecord(value) &&
    value.provider === "bitquery" &&
    value.status === "unavailable" &&
    ["market-core", "market-liquidity", "market-price"].includes(
      String(value.phase),
    )
  ) {
    if (
      value.category === "transport" &&
      value.reason === undefined &&
      value.httpStatus === undefined
    ) return value as LegacyBitqueryExploreMarketRead;
    if (
      value.category === "response" &&
      value.reason === "http-status" &&
      value.httpStatus === 402
    ) return value as LegacyBitqueryExploreMarketRead;
    return null;
  }
  if (
    !isRecord(value) ||
    (value.provider !== "dexscreener" && value.provider !== "gmgn") ||
    !["complete", "partial", "unavailable"].includes(String(value.status)) ||
    value.currency !== "USD" ||
    !["requestedCount", "observedCount", "qualifiedCount", "unavailableCount"]
      .every((field) => Number.isSafeInteger(value[field]) && Number(value[field]) >= 0) ||
    Number(value.qualifiedCount) > Number(value.observedCount) ||
    Number(value.observedCount) > Number(value.requestedCount) ||
    Number(value.unavailableCount) !==
      Number(value.requestedCount) - Number(value.qualifiedCount) ||
    (value.oldestFetchedAt !== null &&
      (typeof value.oldestFetchedAt !== "string" ||
        !Number.isFinite(Date.parse(value.oldestFetchedAt)))) ||
    (value.newestFetchedAt !== null &&
      (typeof value.newestFetchedAt !== "string" ||
        !Number.isFinite(Date.parse(value.newestFetchedAt))))
  ) return null;
  if (value.provider === "gmgn") {
    if (
      value.fallbackProvider !== "dexscreener" ||
      ![
        "gmgnObservedCount",
        "gmgnQualifiedCount",
        "fallbackRequestedCount",
        "fallbackObservedCount",
        "fallbackQualifiedCount",
      ].every((field) =>
        Number.isSafeInteger(value[field]) && Number(value[field]) >= 0
      ) ||
      Number(value.gmgnQualifiedCount) > Number(value.gmgnObservedCount) ||
      Number(value.gmgnObservedCount) > Number(value.requestedCount) ||
      Number(value.fallbackQualifiedCount) >
        Number(value.fallbackObservedCount) ||
      Number(value.fallbackObservedCount) >
        Number(value.fallbackRequestedCount) ||
      Number(value.fallbackRequestedCount) > Number(value.requestedCount) ||
      Number(value.observedCount) < Number(value.gmgnObservedCount) ||
      Number(value.observedCount) < Number(value.fallbackObservedCount) ||
      Number(value.observedCount) >
        Number(value.gmgnObservedCount) + Number(value.fallbackObservedCount) ||
      Number(value.qualifiedCount) !==
        Number(value.gmgnQualifiedCount) + Number(value.fallbackQualifiedCount)
    ) return null;
  }
  const observed = Number(value.observedCount);
  // Transport completion and pair coverage are independent. A complete
  // Dexscreener read can honestly observe only a small subset of the known
  // tokens when the remaining token requests returned no exact pair.
  if (value.status === "unavailable" && observed !== 0) return null;
  return value as ExploreMarketRead;
}

export function parseExploreRanking(
  value: unknown,
  total: unknown,
): ExploreRanking | null {
  if (
    isRecord(value) &&
    value.schemaVersion === "programmable.explore-market-cap-ranking.v1"
  ) return parseExploreMarketCapRanking(value, total);
  if (
    isRecord(value) &&
    value.status === "unavailable" &&
    value.requested === "fdv" &&
    value.applied === "launch-order" &&
    value.qualifiedCount === undefined &&
    value.totalCount === undefined
  ) return value as ExploreRanking;
  if (
    !isRecord(value) ||
    !["complete", "partial", "unavailable"].includes(String(value.status)) ||
    value.requested !== "fdv" ||
    !["fdv", "qualified-fdv-then-launch-order", "launch-order"].includes(
      String(value.applied),
    ) ||
    !Number.isSafeInteger(value.qualifiedCount) ||
    Number(value.qualifiedCount) < 0 ||
    !Number.isSafeInteger(value.totalCount) ||
    Number(value.totalCount) < 0 ||
    value.totalCount !== total ||
    Number(value.qualifiedCount) > Number(value.totalCount)
  ) return null;
  const qualified = Number(value.qualifiedCount);
  const count = Number(value.totalCount);
  if (
    (value.status === "complete" &&
      (qualified !== count || value.applied !== "fdv")) ||
    (value.status === "partial" &&
      (qualified === 0 || qualified >= count ||
        value.applied !== "qualified-fdv-then-launch-order")) ||
    (value.status === "unavailable" &&
      (qualified !== 0 || value.applied !== "launch-order"))
  ) return null;
  return value as ExploreRanking;
}

function parseExploreMarketCapRanking(
  value: Record<string, unknown>,
  total: unknown,
): ExploreMarketCapRanking | null {
  const integerFields = [
    "observedTokenCount",
    "matchedTokenCount",
    "matchedUniqueTokenCount",
    "canonicalEntryCount",
    "canonicalTokenCount",
    "unobservedCanonicalEntryCount",
    "canonicalAddressCoverageBps",
    "foreignTokenCount",
    "discardedProviderItemCount",
    "gmgnHydrationLimit",
    "gmgnHydrationEligibleCount",
    "gmgnHydrationRequestedCount",
    "gmgnHydrationObservedCount",
    "gmgnHydrationQualifiedCount",
    "gmgnHydrationDeferredCount",
    "fallbackRequestedCount",
    "fallbackQualifiedCount",
    "canonicalTailCount",
    "qualifiedCount",
    "totalCount",
  ] as const;
  if (
    value.requested !== "market-cap" ||
    (value.direction !== "asc" && value.direction !== "desc") ||
    value.primaryProvider !== "gmgn" ||
    ![
      "gmgn",
      "gmgn+dexscreener",
      "dexscreener",
      "canonical-launch-order",
    ].includes(String(value.source)) ||
    value.fallbackProvider !== "dexscreener" ||
    typeof value.rankingCommitment !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(value.rankingCommitment) ||
    !["complete", "partial", "unavailable"].includes(String(value.status)) ||
    !["complete", "partial", "unavailable"].includes(String(value.gmgnStatus)) ||
    value.metricOrder !==
      "gmgn-market-cap>gmgn-token-info-fdv>dexscreener-fdv>canonical-launch-order" ||
    value.rankInterval !== "1h" ||
    value.rankLimit !== 100 ||
    value.gmgnHydrationLimit !== 100 ||
    !Number.isSafeInteger(total) ||
    !integerFields.every((field) =>
      Number.isSafeInteger(value[field]) && Number(value[field]) >= 0
    ) ||
    value.totalCount !== total ||
    value.canonicalEntryCount !== total ||
    Number(value.canonicalTokenCount) > Number(value.canonicalEntryCount) ||
    Number(value.matchedTokenCount) > Number(value.canonicalEntryCount) ||
    Number(value.matchedUniqueTokenCount) > Number(value.matchedTokenCount) ||
    Number(value.matchedUniqueTokenCount) > Number(value.canonicalTokenCount) ||
    Number(value.observedTokenCount) > Number(value.rankLimit) ||
    Number(value.observedTokenCount) !==
      Number(value.matchedUniqueTokenCount) + Number(value.foreignTokenCount) ||
    Number(value.unobservedCanonicalEntryCount) !==
      Number(value.canonicalEntryCount) - Number(value.matchedTokenCount) ||
    Number(value.gmgnHydrationEligibleCount) >
      Number(value.unobservedCanonicalEntryCount) ||
    Number(value.gmgnHydrationRequestedCount) !==
      Math.min(
        Number(value.gmgnHydrationEligibleCount),
        Number(value.gmgnHydrationLimit),
      ) ||
    Number(value.gmgnHydrationObservedCount) >
      Number(value.gmgnHydrationRequestedCount) ||
    Number(value.gmgnHydrationQualifiedCount) >
      Number(value.gmgnHydrationObservedCount) ||
    Number(value.gmgnHydrationDeferredCount) !==
      Number(value.gmgnHydrationEligibleCount) -
        Number(value.gmgnHydrationRequestedCount) ||
    Number(value.fallbackRequestedCount) !==
      Number(value.unobservedCanonicalEntryCount) -
        Number(value.gmgnHydrationQualifiedCount) ||
    Number(value.fallbackQualifiedCount) > Number(value.fallbackRequestedCount) ||
    Number(value.qualifiedCount) !==
      Number(value.matchedTokenCount) +
        Number(value.gmgnHydrationQualifiedCount) +
        Number(value.fallbackQualifiedCount) ||
    Number(value.canonicalTailCount) !==
      Number(value.totalCount) - Number(value.qualifiedCount) ||
    Number(value.canonicalAddressCoverageBps) > 10_000 ||
    Number(value.canonicalAddressCoverageBps) !==
      (Number(value.canonicalTokenCount) === 0
        ? 0
        : Math.floor(
            Number(value.matchedUniqueTokenCount) * 10_000 /
              Number(value.canonicalTokenCount),
          )) ||
    (value.asOfTime !== null && !exactIsoTimestamp(value.asOfTime)) ||
    (Number(value.observedTokenCount) === 0 &&
      Number(value.qualifiedCount) === 0 && value.asOfTime !== null) ||
    ((Number(value.observedTokenCount) > 0 ||
      Number(value.qualifiedCount) > 0) && value.asOfTime === null)
  ) return null;
  const count = Number(value.totalCount);
  const qualified = Number(value.qualifiedCount);
  const matched = Number(value.matchedTokenCount);
  const hydrated = Number(value.gmgnHydrationQualifiedCount);
  const fallbackQualified = Number(value.fallbackQualifiedCount);
  const expectedStatus = qualified === 0 || count === 0
    ? "unavailable"
    : qualified === count
      ? "complete"
      : "partial";
  const gmgnQualified = matched + hydrated;
  const expectedGmgnStatus = gmgnQualified === 0 || count === 0
    ? "unavailable"
    : gmgnQualified === count
      ? "complete"
      : "partial";
  const expectedSource = gmgnQualified > 0
    ? fallbackQualified > 0
      ? "gmgn+dexscreener"
      : "gmgn"
    : fallbackQualified > 0
      ? "dexscreener"
      : "canonical-launch-order";
  const hasRank = matched > 0;
  const hasHydration = hydrated > 0;
  const hasFallback = fallbackQualified > 0;
  const hasTail = Number(value.canonicalTailCount) > 0;
  let expectedApplied: ExploreMarketCapRanking["applied"] = "launch-order";
  if (count > 0 && hasRank && hasHydration && hasFallback) {
    expectedApplied = hasTail
      ? "gmgn-market-cap-then-gmgn-token-info-fdv-then-dexscreener-fdv-then-launch-order"
      : "gmgn-market-cap-then-gmgn-token-info-fdv-then-dexscreener-fdv";
  } else if (count > 0 && hasRank && hasHydration) {
    expectedApplied = hasTail
      ? "gmgn-market-cap-then-gmgn-token-info-fdv-then-launch-order"
      : "gmgn-market-cap-then-gmgn-token-info-fdv";
  } else if (count > 0 && hasRank && hasFallback) {
    expectedApplied = hasTail
      ? "gmgn-market-cap-then-dexscreener-fdv-then-launch-order"
      : "gmgn-market-cap-then-dexscreener-fdv";
  } else if (count > 0 && hasRank) {
    expectedApplied = matched === count
      ? "gmgn-market-cap"
      : "gmgn-market-cap-then-launch-order";
  } else if (count > 0 && hasHydration && hasFallback) {
    expectedApplied = hasTail
      ? "gmgn-token-info-fdv-then-dexscreener-fdv-then-launch-order"
      : "gmgn-token-info-fdv-then-dexscreener-fdv";
  } else if (count > 0 && hasHydration) {
    expectedApplied = hasTail
      ? "gmgn-token-info-fdv-then-launch-order"
      : "gmgn-token-info-fdv";
  } else if (count > 0 && hasFallback) {
    expectedApplied = hasTail ? "qualified-fdv-then-launch-order" : "fdv";
  }
  if (
    value.status !== expectedStatus ||
    value.gmgnStatus !== expectedGmgnStatus ||
    value.source !== expectedSource ||
    value.applied !== expectedApplied
  ) return null;
  return value as unknown as ExploreMarketCapRanking;
}

const EXPLORE_SEARCH_RANKING_FIELDS = [
  "schemaVersion",
  "provider",
  "requested",
  "orderBy",
  "rankingCommitment",
  "status",
  "applied",
  "observedTokenCount",
  "matchedTokenCount",
  "matchedUniqueTokenCount",
  "canonicalMatchCount",
  "canonicalMatchTokenCount",
  "unobservedCanonicalMatchCount",
  "providerOnlyCanonicalTokenCount",
  "foreignTokenCount",
  "discardedProviderItemCount",
  "duplicateProviderItemCount",
  "canonicalAddressCoverageBps",
  "asOfTime",
] as const;

export function parseExploreSearchRanking(
  value: unknown,
  total: unknown,
): ExploreSearchRanking | null {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== EXPLORE_SEARCH_RANKING_FIELDS.length ||
    !EXPLORE_SEARCH_RANKING_FIELDS.every((field) => Object.hasOwn(value, field)) ||
    value.schemaVersion !== "programmable.explore-search-ranking.v1" ||
    value.provider !== "gmgn" ||
    value.requested !== "search" ||
    value.orderBy !== "weight" ||
    typeof value.rankingCommitment !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(value.rankingCommitment) ||
    !["complete", "partial", "unavailable"].includes(String(value.status)) ||
    ![
      "gmgn-canonical-search-with-local-match-fallback",
      "local-match-order",
    ].includes(String(value.applied)) ||
    !Number.isSafeInteger(total) ||
    Number(total) < 0 ||
    ![
      "observedTokenCount",
      "matchedTokenCount",
      "matchedUniqueTokenCount",
      "canonicalMatchCount",
      "canonicalMatchTokenCount",
      "unobservedCanonicalMatchCount",
      "providerOnlyCanonicalTokenCount",
      "foreignTokenCount",
      "discardedProviderItemCount",
      "duplicateProviderItemCount",
      "canonicalAddressCoverageBps",
    ].every((field) =>
      Number.isSafeInteger(value[field]) && Number(value[field]) >= 0
    ) ||
    Number(value.observedTokenCount) > 1_000 ||
    Number(value.foreignTokenCount) > 1_000 ||
    Number(value.discardedProviderItemCount) > 1_000 ||
    Number(value.duplicateProviderItemCount) > 1_000 ||
    value.canonicalMatchCount !== total ||
    Number(value.canonicalMatchTokenCount) > Number(value.canonicalMatchCount) ||
    Number(value.matchedTokenCount) > Number(value.canonicalMatchCount) ||
    Number(value.matchedUniqueTokenCount) > Number(value.matchedTokenCount) ||
    Number(value.matchedUniqueTokenCount) > Number(value.canonicalMatchTokenCount) ||
    Number(value.unobservedCanonicalMatchCount) !==
      Number(value.canonicalMatchCount) - Number(value.matchedTokenCount) ||
    Number(value.providerOnlyCanonicalTokenCount) >
      Number(value.matchedUniqueTokenCount) ||
    Number(value.observedTokenCount) !==
      Number(value.matchedUniqueTokenCount) + Number(value.foreignTokenCount) ||
    Number(value.canonicalAddressCoverageBps) > 10_000 ||
    Number(value.canonicalAddressCoverageBps) !==
      (Number(value.canonicalMatchTokenCount) === 0
        ? 0
        : Math.floor(
            Number(value.matchedUniqueTokenCount) * 10_000 /
              Number(value.canonicalMatchTokenCount),
          )) ||
    (value.asOfTime !== null && !exactIsoTimestamp(value.asOfTime))
  ) return null;

  const matched = Number(value.matchedTokenCount);
  const count = Number(value.canonicalMatchCount);
  const expectedApplied = matched > 0
    ? "gmgn-canonical-search-with-local-match-fallback"
    : "local-match-order";
  if (
    value.applied !== expectedApplied ||
    (value.status === "complete" && matched !== count) ||
    (value.status === "partial" && matched >= count) ||
    (value.status === "unavailable" &&
      (matched !== 0 ||
        Number(value.observedTokenCount) !== 0 ||
        Number(value.matchedUniqueTokenCount) !== 0 ||
        Number(value.providerOnlyCanonicalTokenCount) !== 0 ||
        Number(value.foreignTokenCount) !== 0 ||
        Number(value.discardedProviderItemCount) !== 0 ||
        Number(value.duplicateProviderItemCount) !== 0)) ||
    (value.status === "unavailable"
      ? value.asOfTime !== null
      : value.asOfTime === null)
  ) return null;
  return value as unknown as ExploreSearchRanking;
}

export function parseExploreDiscoveryRanking(
  value: unknown,
  total: unknown,
): ExploreDiscoveryRanking | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== "programmable.explore-discovery-ranking.v1" ||
    value.provider !== "gmgn" ||
    value.requested !== "trending" ||
    typeof value.rankingCommitment !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(value.rankingCommitment) ||
    !["complete", "partial", "unavailable"].includes(String(value.status)) ||
    ![
      "gmgn-ranked-with-launch-order-fallback",
      "launch-order",
    ].includes(String(value.applied)) ||
    value.rankInterval !== "1h" ||
    value.hotSearchInterval !== "24h" ||
    !Number.isSafeInteger(total) ||
    ![
      "snapshotCount",
      "observedTokenCount",
      "matchedTokenCount",
      "matchedUniqueTokenCount",
      "canonicalEntryCount",
      "canonicalTokenCount",
      "unobservedCanonicalEntryCount",
      "canonicalAddressCoverageBps",
      "foreignTokenCount",
      "discardedProviderItemCount",
    ].every((field) =>
      Number.isSafeInteger(value[field]) && Number(value[field]) >= 0
    ) ||
    value.canonicalEntryCount !== total ||
    Number(value.matchedTokenCount) > Number(value.canonicalEntryCount) ||
    Number(value.matchedUniqueTokenCount) > Number(value.matchedTokenCount) ||
    Number(value.matchedUniqueTokenCount) > Number(value.canonicalTokenCount) ||
    Number(value.observedTokenCount) !==
      Number(value.matchedUniqueTokenCount) + Number(value.foreignTokenCount) ||
    Number(value.unobservedCanonicalEntryCount) !==
      Number(value.canonicalEntryCount) - Number(value.matchedTokenCount) ||
    Number(value.canonicalAddressCoverageBps) > 10_000 ||
    Number(value.canonicalAddressCoverageBps) !==
      (Number(value.canonicalTokenCount) === 0
        ? 0
        : Math.floor(
            Number(value.matchedUniqueTokenCount) * 10_000 /
              Number(value.canonicalTokenCount),
          )) ||
    (value.asOfTime !== null && !exactIsoTimestamp(value.asOfTime))
  ) return null;
  const matched = Number(value.matchedTokenCount);
  const count = Number(value.canonicalEntryCount);
  if (
    (value.status === "complete" &&
      (count === 0 || matched !== count ||
        value.applied !== "gmgn-ranked-with-launch-order-fallback")) ||
    (value.status === "partial" &&
      (matched === 0 || matched >= count ||
        value.applied !== "gmgn-ranked-with-launch-order-fallback")) ||
    (value.status === "unavailable" &&
      (matched !== 0 || Number(value.matchedUniqueTokenCount) !== 0 ||
        value.applied !== "launch-order"))
  ) return null;
  return value as ExploreDiscoveryRanking;
}

function exactIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(Date.parse(value)).toISOString() === value;
}

function exactStringArray(value: unknown, expected: readonly string[]) {
  return Array.isArray(value) && value.length === expected.length &&
    value.every((item, index) => item === expected[index]);
}

function parseExploreCatalog(value: unknown): ExploreCatalogBoundary | null {
  if (!isRecord(value) || !isRecord(value.completeness)) return null;
  const evidence = value.evidence === undefined
    ? null
    : isRecord(value.evidence)
      ? value.evidence
      : null;
  const scope = value.scope === undefined
    ? null
    : isRecord(value.scope)
      ? value.scope
      : null;
  if (
    (value.evidence !== undefined && evidence === null) ||
    (value.scope !== undefined && scope === null)
  ) return null;
  const envioEvidence = evidence?.kind === "envio-indexer-state"
    ? evidence
    : null;
  const durableEvidence = evidence?.kind === "durable-envelope"
    ? evidence
    : null;
  if (evidence !== null && envioEvidence === null && durableEvidence === null) {
    return null;
  }
  if (value.source === "robinhood-finalized-custom-launch-feed-v4") {
    const routerStamp = value.routerStamp;
    return value.launchSource ===
        "robinhood-finalized-custom-launch-feed-v4+canonical-launch-stamp-router" &&
      value.status === "current" &&
      exactIsoTimestamp(value.lastIndexedAt) &&
      typeof value.asOfBlock === "string" &&
      /^[1-9][0-9]*$/u.test(value.asOfBlock) &&
      typeof value.asOfBlockHash === "string" &&
      /^0x[0-9a-f]{64}$/u.test(value.asOfBlockHash) &&
      Number.isSafeInteger(value.identityCount) &&
      Number(value.identityCount) > 0 &&
      typeof value.identityCommitment === "string" &&
      /^sha256:[0-9a-f]{64}$/u.test(value.identityCommitment) &&
      value.completeness.classic === "unavailable" &&
      value.completeness.stock === "excluded" &&
      value.completeness.custom === "current" &&
      value.completeness.registryCustom === "unavailable" &&
      value.completeness.routerCustom === "current" &&
      evidence === null && scope !== null &&
      exactStringArray(scope.included, ["canonical-launch-stamp-router"]) &&
      exactStringArray(scope.excluded, [
        "classic-v1", "classic-v2", "stock-paired-v1", "stock-paired-v2",
        "stock-paired-v3",
      ]) &&
      exactStringArray(scope.publicCategories, ["classic", "custom"]) &&
      isRecord(routerStamp) &&
      routerStamp.source === "canonical-launch-stamp-router" &&
      routerStamp.status === "current" &&
      routerStamp.finalityConfirmations === 64 &&
      routerStamp.verifiedIdentityCount === value.identityCount &&
      routerStamp.projectedIdentityCount === value.identityCount &&
      routerStamp.generatedAt === value.lastIndexedAt &&
      routerStamp.asOfBlock === value.asOfBlock &&
      routerStamp.asOfBlockHash === value.asOfBlockHash &&
      routerStamp.identityCommitment === value.identityCommitment
      ? value as ExploreCatalogBoundary
      : null;
  }
  const durableSource = value.source === "durable-blob";
  const envioSource = value.source === "envio-classic-v3";
  if (!durableSource && !envioSource) return null;
  const hasSplitCustomStatus =
    value.completeness.registryCustom !== undefined ||
    value.completeness.routerCustom !== undefined;
  if (
    hasSplitCustomStatus &&
    (![
      "current",
      "unavailable",
    ].includes(String(value.completeness.registryCustom)) ||
      ![
      "current",
      "last-known-good",
      "unavailable",
    ].includes(String(value.completeness.routerCustom)))
  ) return null;
  const registryCustomStatus = hasSplitCustomStatus
    ? value.completeness.registryCustom
    : value.completeness.custom;
  const routerCustomStatus = hasSplitCustomStatus
    ? value.completeness.routerCustom
    : "unavailable";
  const routerAvailable = routerCustomStatus !== "unavailable";
  const classicV4IsBound = isClassicV4AnchoredPublicReleaseBinding(
    CLASSIC_V4_PUBLIC_RELEASE_BINDING,
  );
  const expectedLaunchSource = [
    ...(durableSource
      ? ["durable-blob"]
      : envioEvidence
        ? ["envio-classic-v3"]
        : []),
    ...(registryCustomStatus === "current"
      ? ["registry.custom-launched"]
      : []),
    ...(routerAvailable ? ["canonical-launch-stamp-router"] : []),
  ].join("+");
  const expectedIncluded = envioEvidence
    ? [
        "classic-v3",
        ...(classicV4IsBound ? ["classic-v4"] : []),
        "official-main-token",
        "registry.custom-launched",
        ...(routerAvailable ? ["canonical-launch-stamp-router"] : []),
      ]
    : [
        ...(registryCustomStatus === "current"
          ? ["registry.custom-launched"]
          : []),
        ...(routerAvailable ? ["canonical-launch-stamp-router"] : []),
      ];
  const routerStamp = value.routerStamp;
  if (
    hasSplitCustomStatus &&
    (!isRecord(routerStamp) ||
      routerStamp.source !== "canonical-launch-stamp-router" ||
      routerStamp.status !== routerCustomStatus ||
      routerStamp.finalityConfirmations !== 64 ||
      !Number.isSafeInteger(routerStamp.verifiedIdentityCount) ||
      Number(routerStamp.verifiedIdentityCount) < 0 ||
      !Number.isSafeInteger(routerStamp.projectedIdentityCount) ||
      Number(routerStamp.projectedIdentityCount) < 0 ||
      Number(routerStamp.projectedIdentityCount) >
        Number(routerStamp.verifiedIdentityCount) ||
      ([
        routerStamp.generatedAt,
        routerStamp.asOfBlock,
        routerStamp.asOfBlockHash,
        routerStamp.identityCommitment,
      ].some((candidate) => candidate !== undefined) &&
        (!exactIsoTimestamp(routerStamp.generatedAt) ||
          typeof routerStamp.asOfBlock !== "string" ||
          !/^[1-9][0-9]*$/u.test(routerStamp.asOfBlock) ||
          typeof routerStamp.asOfBlockHash !== "string" ||
          !/^0x[0-9a-f]{64}$/u.test(routerStamp.asOfBlockHash) ||
          typeof routerStamp.identityCommitment !== "string" ||
          !/^sha256:[0-9a-f]{64}$/u.test(routerStamp.identityCommitment))))
  ) return null;
  if (!hasSplitCustomStatus && routerStamp !== undefined) return null;
  if (
    value.launchSource !== expectedLaunchSource ||
    !["current", "last-known-good"].includes(String(value.status)) ||
    !exactIsoTimestamp(value.lastIndexedAt) ||
    typeof value.asOfBlock !== "string" ||
    !/^[1-9][0-9]*$/u.test(value.asOfBlock) ||
    typeof value.asOfBlockHash !== "string" ||
    !/^0x[0-9a-f]{64}$/u.test(value.asOfBlockHash) ||
    !Number.isSafeInteger(value.identityCount) ||
    Number(value.identityCount) < 0 ||
    typeof value.identityCommitment !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(value.identityCommitment) ||
    !["current", "last-known-good", "unavailable"].includes(
      String(value.completeness.classic),
    ) ||
    (durableSource
      ? !["current", "last-known-good", "unavailable"].includes(
          String(value.completeness.stock),
        )
      : value.completeness.stock !== "excluded") ||
    !["current", "last-known-good", "unavailable"].includes(
      String(value.completeness.custom),
    ) ||
    (hasSplitCustomStatus &&
      value.completeness.custom !==
        (registryCustomStatus === "current" && routerCustomStatus === "current"
          ? "current"
          : registryCustomStatus === "current" &&
              routerCustomStatus === "last-known-good"
            ? "last-known-good"
          : "unavailable")) ||
    (durableSource
      ? scope !== null
      : scope === null ||
        !exactStringArray(scope.included, expectedIncluded) ||
        !exactStringArray(scope.excluded, [
          "classic-v1",
          "classic-v2",
          "stock-paired-v1",
          "stock-paired-v2",
          "stock-paired-v3",
        ]) ||
        !exactStringArray(scope.publicCategories, ["classic", "custom"])) ||
    (durableSource && (
      envioEvidence !== null ||
      durableEvidence === null ||
      typeof durableEvidence.commitment !== "string" ||
      !/^0x[0-9a-f]{64}$/u.test(durableEvidence.commitment)
    )) ||
    (envioSource && durableEvidence !== null) ||
    (envioSource && envioEvidence === null && (
      value.status !== "last-known-good" ||
      value.completeness.classic !== "unavailable"
    )) ||
    (envioSource && envioEvidence !== null && (
      envioEvidence.kind !== "envio-indexer-state" ||
      typeof envioEvidence.deployment !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,127}$/u.test(envioEvidence.deployment) ||
      typeof envioEvidence.sourceCommit !== "string" ||
      !/^[0-9a-f]{40}$/u.test(envioEvidence.sourceCommit) ||
      typeof envioEvidence.progressBlock !== "string" ||
      !/^[1-9][0-9]*$/u.test(envioEvidence.progressBlock) ||
      BigInt(envioEvidence.progressBlock) > BigInt(value.asOfBlock) ||
      typeof envioEvidence.progressOccurrenceId !== "string" ||
      !/^1:0x[0-9a-f]{64}:0x[0-9a-f]{64}:[0-9]+$/u.test(
        envioEvidence.progressOccurrenceId,
      ) ||
      typeof envioEvidence.commitment !== "string" ||
      !/^sha256:[0-9a-f]{64}$/u.test(envioEvidence.commitment)
    )) ||
    (isRecord(routerStamp) &&
      typeof routerStamp.asOfBlock === "string" &&
      BigInt(routerStamp.asOfBlock) > BigInt(value.asOfBlock))
  ) return null;
  return value as ExploreCatalogBoundary;
}

function exploreCatalogBoundaryKey(value: ExploreCatalogBoundary) {
  const routerStampBoundary = value.routerStamp === undefined
    ? null
    : {
        source: value.routerStamp.source,
        status: value.routerStamp.status,
        finalityConfirmations: value.routerStamp.finalityConfirmations,
      };
  const envioEvidence = value.evidence?.kind === "envio-indexer-state"
    ? value.evidence
    : null;
  const durableEvidence = value.evidence?.kind === "durable-envelope"
    ? value.evidence
    : null;
  return JSON.stringify({
    source: value.source,
    launchSource: value.launchSource,
    status: value.status,
    identityCount: value.identityCount,
    identityCommitment: value.identityCommitment,
    completeness: value.completeness,
    scope: value.scope,
    routerStamp: routerStampBoundary,
    deployment: envioEvidence?.deployment ?? null,
    sourceCommit: envioEvidence?.sourceCommit ?? null,
    durableCommitment: durableEvidence?.commitment ?? null,
  });
}

function exploreProviderOrderCommitmentKey(value: ExplorePayload) {
  return JSON.stringify({
    ranking: value.ranking === undefined
      ? null
      : value.ranking.requested === "market-cap"
        ? {
            schemaVersion: value.ranking.schemaVersion,
            requested: value.ranking.requested,
            direction: value.ranking.direction,
            rankingCommitment: value.ranking.rankingCommitment,
          }
        : {
            requested: value.ranking.requested,
            status: value.ranking.status,
            applied: value.ranking.applied,
            qualifiedCount: value.ranking.qualifiedCount ?? null,
            totalCount: value.ranking.totalCount ?? null,
          },
    discovery: value.discovery === undefined
      ? null
      : {
          schemaVersion: value.discovery.schemaVersion,
          rankingCommitment: value.discovery.rankingCommitment,
        },
    search: value.search === undefined
      ? null
      : {
          schemaVersion: value.search.schemaVersion,
          rankingCommitment: value.search.rankingCommitment,
        },
  });
}

function exploreMarketCapRankingCommitment(value: ExplorePayload) {
  return value.ranking?.requested === "market-cap"
    ? value.ranking.rankingCommitment
    : undefined;
}

function readResolvedExploreMarketCapRankingCommitment(
  search: URLSearchParams,
) {
  const collectionIdentity = canonicalExploreCollectionIdentity(search);
  let commitment: `sha256:${string}` | undefined;
  for (const [key, cached] of resolvedExplorePayloads) {
    if (Date.now() - cached.updatedAt >= RESOLVED_EXPLORE_PAYLOAD_TTL_MS) {
      resolvedExplorePayloads.delete(key);
      continue;
    }
    if (
      cached.collectionIdentity === collectionIdentity &&
      cached.payload.page === 1
    ) {
      commitment = exploreMarketCapRankingCommitment(cached.payload) ??
        commitment;
    }
  }
  return commitment;
}

function expireResolvedExploreCollectionPayloads(search: URLSearchParams) {
  const collectionIdentity = canonicalExploreCollectionIdentity(search);
  for (const [key, cached] of resolvedExplorePayloads) {
    if (cached.collectionIdentity === collectionIdentity) {
      resolvedExplorePayloads.delete(key);
    }
  }
}

function parseExplorePayload(value: unknown): ExplorePayload {
  if (!isRecord(value)) {
    throw new Error("The token registry returned an invalid response");
  }
  if (value.status !== "ready" && value.status !== "not-deployed") {
    throw new Error("The token registry returned an unknown status");
  }
  if (!Array.isArray(value.tokens)) {
    throw new Error("The token registry returned invalid token data");
  }
  if (value.status === "not-deployed") {
    if (
      value.tokens.length !== 0 ||
      value.page !== 1 ||
      typeof value.pageSize !== "number" ||
      !Number.isSafeInteger(value.pageSize) ||
      value.pageSize < 1 ||
      value.total !== 0 ||
      value.totalPages !== 0
    ) {
      throw new Error("The token registry returned invalid deployment data");
    }
    return {
      status: "not-deployed",
      tokens: [],
      page: 1,
      pageSize: value.pageSize,
      total: 0,
      totalPages: 0,
    };
  }
  if (
    value.dataQuality !== undefined &&
    !isExploreDataQuality(value.dataQuality)
  ) {
    throw new Error("The token registry returned invalid data quality");
  }
  const marketRead = parseExploreMarketRead(value.marketRead);
  if (value.marketRead !== undefined && marketRead === null) {
    throw new Error("The token registry returned invalid market read data");
  }
  const ranking = parseExploreRanking(value.ranking, value.total);
  if (
    value.ranking !== undefined &&
    (ranking === null || marketRead === null)
  ) {
    throw new Error("The token registry returned invalid ranking data");
  }
  const discovery = parseExploreDiscoveryRanking(value.discovery, value.total);
  if (
    value.discovery !== undefined &&
    (discovery === null || marketRead === null)
  ) {
    throw new Error("The token registry returned invalid discovery data");
  }
  const search = parseExploreSearchRanking(value.search, value.total);
  if (
    value.search !== undefined &&
    (search === null || marketRead === null)
  ) {
    throw new Error("The token registry returned invalid search data");
  }
  const catalog = parseExploreCatalog(value.catalog);
  if (catalog === null) {
    throw new Error("The token registry returned invalid catalog data");
  }

  const tokens = value.tokens.map(parseExploreEntry);
  if (tokens.some((token) => token === null)) {
    throw new Error("The token registry returned an invalid token record");
  }

  if (
    typeof value.page !== "number" ||
    !Number.isSafeInteger(value.page) ||
    value.page < 1 ||
    typeof value.pageSize !== "number" ||
    !Number.isSafeInteger(value.pageSize) ||
    value.pageSize < 1 ||
    typeof value.total !== "number" ||
    !Number.isSafeInteger(value.total) ||
    value.total < 0 ||
    typeof value.totalPages !== "number" ||
    !Number.isSafeInteger(value.totalPages) ||
    value.totalPages < 0 ||
    value.totalPages !== Math.ceil(value.total / value.pageSize) ||
    (value.totalPages === 0 ? value.page !== 1 : value.page > value.totalPages)
  ) {
    throw new Error("The token registry returned invalid pagination data");
  }
  const availableValuations = tokens.filter(
    (token) => token?.valuation.status === "available",
  ).length;
  if (marketRead !== null && value.dataQuality === undefined) {
    throw new Error("The token registry returned inconsistent market read data");
  }
  if (
    value.dataQuality !== undefined &&
    (value.dataQuality.generatedAt !== catalog.lastIndexedAt ||
      value.dataQuality.launchIdentity.asOfBlock !== catalog.asOfBlock ||
      value.dataQuality.launchIdentity.custom !== catalog.completeness.custom)
  ) {
    throw new Error("The token registry returned inconsistent catalog data");
  }
  if (
    marketRead?.status === "unavailable" && availableValuations !== 0
  ) {
    throw new Error("The token registry returned inconsistent market read data");
  }

  return {
    status: value.status,
    tokens: tokens as ValuedExploreEntry[],
    page: Math.max(1, positiveInteger(value.page, 1)),
    pageSize: Math.max(
      1,
      positiveInteger(value.pageSize, EXPLORE_TOKENS_PER_PAGE),
    ),
    total: positiveInteger(value.total, tokens.length),
    totalPages: positiveInteger(value.totalPages, 0),
    ...(value.dataQuality === undefined
      ? {}
      : { dataQuality: value.dataQuality }),
    ...(marketRead === null ? {} : { marketRead }),
    ...(ranking === null ? {} : { ranking }),
    ...(discovery === null ? {} : { discovery }),
    ...(search === null ? {} : { search }),
    catalog,
  };
}

function readApiError(value: unknown) {
  return isRecord(value) && typeof value.error === "string"
    ? value.error
    : "Tokens are temporarily unavailable";
}

export function createExploreInitialState(
  response: ExploreInitialResponse | undefined,
  input: Readonly<{
    requestKey: string;
    contentKey: string;
    pageSize: number;
  }>,
): ExploreState | null {
  if (response === undefined) return null;
  if (!response.ok) {
    return {
      phase: "error",
      message: readApiError(response.body),
      requestKey: input.requestKey,
      contentKey: input.contentKey,
    };
  }

  try {
    const payload = parseExplorePayload(response.body);
    if (
      payload.page !== 1 ||
      payload.pageSize !== EXPLORE_TOKENS_PER_PAGE
    ) {
      throw new Error("The token registry returned an unexpected first page");
    }
    if (
      input.pageSize !== EXPLORE_TOKENS_PER_PAGE &&
      input.pageSize !== EXPLORE_MOBILE_TOKENS_PER_PAGE
    ) {
      throw new Error("The token registry returned an unexpected page size");
    }
    const requestedTokenCount = Math.min(input.pageSize, payload.tokens.length);
    const initialPayload = input.pageSize === payload.pageSize
      ? payload
      : {
          ...payload,
          tokens: payload.tokens.slice(0, requestedTokenCount),
          pageSize: input.pageSize,
          totalPages: Math.ceil(payload.total / input.pageSize),
        };
    return {
      phase: "ready",
      payload: initialPayload,
      requestKey: input.requestKey,
      contentKey: input.contentKey,
    };
  } catch (error) {
    return {
      phase: "error",
      message:
        error instanceof Error
          ? error.message
          : "The token registry returned an invalid response",
      requestKey: input.requestKey,
      contentKey: input.contentKey,
    };
  }
}

export function handledInitialExploreRequestKey(
  state: ExploreState | null,
  requestKey: string,
): string | null {
  return state === null ? null : requestKey;
}

export function createResponsiveExploreInitialState(
  response: ExploreInitialResponse | undefined,
  input: Readonly<{
    reuseAvailable: boolean;
    isInitialRequest: boolean;
    requestKey: string;
    contentKey: string;
    pageSize: number;
  }>,
): ExploreState | null {
  if (!input.reuseAvailable || !input.isInitialRequest) return null;
  const initialState = createExploreInitialState(response, input);
  return initialState?.phase === "ready" ? initialState : null;
}

type PendingExploreRequest = {
  controller: AbortController;
  promise: Promise<ExplorePayload>;
  requestIdentity: string;
};

const pendingExploreRequests = new Map<string, PendingExploreRequest>();
const resolvedExplorePayloads = new Map<
  string,
  Readonly<{
    payload: ExplorePayload;
    updatedAt: number;
    collectionIdentity: string;
  }>
>();
const RESOLVED_EXPLORE_PAYLOAD_TTL_MS = 30_000;
const MAX_RESOLVED_EXPLORE_PAYLOADS = 24;

type ExploreRequestContract = Readonly<{
  page: number;
  pageSize: number;
}>;

function canonicalExploreSearchIdentity(search: URLSearchParams) {
  const canonical = new URLSearchParams(search);
  canonical.sort();
  return canonical.toString();
}

function canonicalExploreCollectionIdentity(search: URLSearchParams) {
  const canonical = new URLSearchParams(search);
  canonical.delete("page");
  canonical.delete("rankingCommitment");
  canonical.sort();
  return canonical.toString();
}

function exactPositiveSearchInteger(
  value: string | null,
  fallback: number,
  label: string,
) {
  const normalized = value ?? String(fallback);
  if (!/^[1-9][0-9]*$/u.test(normalized)) {
    throw new Error(`The token registry request has an invalid ${label}`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`The token registry request has an invalid ${label}`);
  }
  return parsed;
}

function exploreRequestContract(
  search: URLSearchParams,
): ExploreRequestContract {
  const page = exactPositiveSearchInteger(search.get("page"), 1, "page");
  const pageSize = Math.min(
    exactPositiveSearchInteger(
      search.get("limit"),
      EXPLORE_TOKENS_PER_PAGE,
      "page size",
    ),
    EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE,
  );
  return { page, pageSize };
}

function assertExploreResponseContract(
  payload: ExplorePayload,
  contract: ExploreRequestContract,
) {
  if (
    payload.page !== contract.page ||
    payload.pageSize !== contract.pageSize
  ) {
    throw new Error("The token registry returned an inconsistent page");
  }
}

function assertUniqueExploreDatasetEntries(
  entries: readonly ValuedExploreEntry[],
) {
  const ids = new Set<string>();
  const tokenAddresses = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) {
      throw new Error("The token registry repeated an entry while filters were loading");
    }
    ids.add(entry.id);
    if (entry.exploreKind !== "token") continue;
    const tokenAddress = entry.tokenAddress.toLowerCase();
    if (tokenAddresses.has(tokenAddress)) {
      throw new Error("The token registry repeated a token while filters were loading");
    }
    tokenAddresses.add(tokenAddress);
  }
}

function shouldRetryMissingBitqueryFdv(
  search: URLSearchParams,
  payload: ExplorePayload,
) {
  const sort = search.get("sort");
  if (sort !== "market-cap" && sort !== "market-cap-asc") return false;
  if (payload.marketRead !== undefined) return false;
  return !payload.tokens.some((token) => {
    const valuation = token.valuation;
    return valuation.status === "available" &&
      valuation.metric === "fdv" &&
      valuation.supplyBasis === "total" &&
      valuation.currency === "usd" &&
      valuation.freshness === "current" &&
      valuation.source === "bitquery" &&
      BigInt(valuation.valueWad) > 0n;
  });
}

function readResolvedExplorePayload(contentKey: string) {
  const cached = resolvedExplorePayloads.get(contentKey);
  if (!cached) return null;
  if (Date.now() - cached.updatedAt >= RESOLVED_EXPLORE_PAYLOAD_TTL_MS) {
    resolvedExplorePayloads.delete(contentKey);
    return null;
  }
  resolvedExplorePayloads.delete(contentKey);
  resolvedExplorePayloads.set(contentKey, cached);
  return cached.payload;
}

function cacheResolvedExplorePayload(
  contentKey: string,
  payload: ExplorePayload,
  search: URLSearchParams,
) {
  resolvedExplorePayloads.delete(contentKey);
  if (payload.marketRead?.status === "unavailable") return;
  resolvedExplorePayloads.set(contentKey, {
    payload,
    updatedAt: Date.now(),
    collectionIdentity: canonicalExploreCollectionIdentity(search),
  });
  while (resolvedExplorePayloads.size > MAX_RESOLVED_EXPLORE_PAYLOADS) {
    const oldestKey = resolvedExplorePayloads.keys().next().value;
    if (oldestKey === undefined) return;
    resolvedExplorePayloads.delete(oldestKey);
  }
}

export function expireResolvedExplorePayloadCache(contentKey: string) {
  const modelPagePrefix = `${contentKey}\u0000model-page:`;
  const collectionIdentities = new Set<string>();
  for (const [key, cached] of resolvedExplorePayloads) {
    if (key === contentKey || key.startsWith(modelPagePrefix)) {
      collectionIdentities.add(cached.collectionIdentity);
    }
  }
  for (const [key, cached] of resolvedExplorePayloads) {
    if (
      key === contentKey ||
      key.startsWith(modelPagePrefix) ||
      collectionIdentities.has(cached.collectionIdentity)
    ) resolvedExplorePayloads.delete(key);
  }
}

export function resolvedExplorePayloadUpdatedAt(
  contentKey: string,
  now = Date.now(),
) {
  const modelPagePrefix = `${contentKey}\u0000model-page:`;
  let oldestUpdatedAt: number | null = null;
  for (const [key, cached] of resolvedExplorePayloads) {
    if (key !== contentKey && !key.startsWith(modelPagePrefix)) continue;
    if (now - cached.updatedAt >= RESOLVED_EXPLORE_PAYLOAD_TTL_MS) {
      resolvedExplorePayloads.delete(key);
      continue;
    }
    oldestUpdatedAt = oldestUpdatedAt === null
      ? cached.updatedAt
      : Math.min(oldestUpdatedAt, cached.updatedAt);
  }
  return oldestUpdatedAt;
}

async function fetchExplorePayload(
  search: URLSearchParams,
  signal: AbortSignal,
  contract: ExploreRequestContract,
) {
  const requestUrl = `/api/explore?${search.toString()}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    signal.throwIfAborted();
    const attemptController = new AbortController();
    let timedOut = false;
    const abortAttempt = () => attemptController.abort(signal.reason);
    signal.addEventListener("abort", abortAttempt, { once: true });
    const timeout = globalThis.setTimeout(() => {
      timedOut = true;
      attemptController.abort();
    }, EXPLORE_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(requestUrl, {
        headers: { Accept: "application/json" },
        signal: attemptController.signal,
      });
      signal.throwIfAborted();
      if (timedOut) throw new Error("Tokens took too long to respond");
      if (response.status === 503 && attempt === 0) {
        continue;
      }
      const body: unknown = await response.json().catch(() => null);
      signal.throwIfAborted();
      if (timedOut) throw new Error("Tokens took too long to respond");
      if (response.status === 409) {
        throw new ExploreRankingRestartError(readApiError(body));
      }
      if (response.status !== 200) {
        throw new Error(readApiError(body));
      }
      const payload = parseExplorePayload(body);
      assertExploreResponseContract(payload, contract);
      const marketReadStatus = response.headers.get(
        "X-Programmable-Market-Read-Status",
      );
      const expectedLegacyStatus =
        payload.marketRead?.provider === "bitquery"
          ? payload.marketRead.category === "transport"
            ? "transport-unavailable"
            : "response-unavailable"
          : null;
      if (
        (payload.marketRead?.provider === "dexscreener" ||
          payload.marketRead?.provider === "gmgn") &&
        marketReadStatus !== payload.marketRead.status
      ) {
        throw new Error("The token registry returned inconsistent market read data");
      }
      if (
        expectedLegacyStatus !== null &&
        marketReadStatus !== expectedLegacyStatus
      ) {
        throw new Error("The token registry returned inconsistent market read data");
      }
      if (
        marketReadStatus !== null &&
        ![
          "complete",
          "partial",
          "unavailable",
          "current",
          "transport-unavailable",
          "response-unavailable",
        ].includes(marketReadStatus)
      ) {
        throw new Error("The token registry returned inconsistent market read data");
      }
      if (
        attempt === 0 &&
        shouldRetryMissingBitqueryFdv(search, payload)
      ) continue;
      return payload;
    } catch (error) {
      signal.throwIfAborted();
      if (timedOut) throw new Error("Tokens took too long to respond");
      throw error;
    } finally {
      globalThis.clearTimeout(timeout);
      signal.removeEventListener("abort", abortAttempt);
    }
  }
  throw new Error("Tokens are temporarily unavailable");
}

class ExploreRankingRestartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExploreRankingRestartError";
  }
}

export function loadExplorePayload(
  contentKey: string,
  search: URLSearchParams,
) {
  let contract: ExploreRequestContract;
  try {
    contract = exploreRequestContract(search);
  } catch (error) {
    return Promise.reject(error);
  }
  const resolved = readResolvedExplorePayload(contentKey);
  if (resolved) {
    try {
      assertExploreResponseContract(resolved, contract);
      return Promise.resolve(resolved);
    } catch {
      resolvedExplorePayloads.delete(contentKey);
    }
  }
  const requestIdentity = canonicalExploreSearchIdentity(search);
  const pendingRequest = pendingExploreRequests.get(contentKey);
  if (pendingRequest?.requestIdentity === requestIdentity) {
    return pendingRequest.promise;
  }
  if (pendingRequest) {
    pendingExploreRequests.delete(contentKey);
    pendingRequest.controller.abort();
  }

  const controller = new AbortController();
  const request = (async (): Promise<ExplorePayload> => {
    const payload = await fetchExplorePayload(
      search,
      controller.signal,
      contract,
    );
    controller.signal.throwIfAborted();
    cacheResolvedExplorePayload(contentKey, payload, search);
    return payload;
  })();

  const entry = { controller, promise: request, requestIdentity };
  pendingExploreRequests.set(contentKey, entry);
  const clearPendingRequest = () => {
    if (pendingExploreRequests.get(contentKey) === entry) {
      pendingExploreRequests.delete(contentKey);
    }
  };
  void request.then(clearPendingRequest, clearPendingRequest);

  return request;
}

function abortExplorePayload(contentKey: string) {
  const modelPagePrefix = `${contentKey}\u0000model-page:`;
  for (const [key, pendingRequest] of pendingExploreRequests) {
    if (key !== contentKey && !key.startsWith(modelPagePrefix)) continue;
    pendingExploreRequests.delete(key);
    pendingRequest.controller.abort();
  }
}

export async function loadExplorePage(
  contentKey: string,
  search: URLSearchParams,
) {
  const requestedSearch = new URLSearchParams(search);
  const contract = exploreRequestContract(requestedSearch);
  const sort = requestedSearch.get("sort");
  const requiresRankingPin = contract.page > 1 &&
    (sort === "market-cap" || sort === "market-cap-asc");
  if (!requiresRankingPin || requestedSearch.has("rankingCommitment")) {
    return loadExplorePayload(contentKey, requestedSearch);
  }

  const firstPageContentKey = `${contentKey}\u0000market-cap-ranking-page:1`;
  const loadPinnedPage = async () => {
    const firstPageSearch = new URLSearchParams(requestedSearch);
    firstPageSearch.set("page", "1");
    firstPageSearch.delete("rankingCommitment");
    const cachedRankingCommitment =
      readResolvedExploreMarketCapRankingCommitment(firstPageSearch);
    const firstPage = cachedRankingCommitment === undefined
      ? await loadExplorePayload(firstPageContentKey, firstPageSearch)
      : null;
    const rankingCommitment = cachedRankingCommitment ??
      (firstPage === null
        ? undefined
        : exploreMarketCapRankingCommitment(firstPage));
    if (rankingCommitment === undefined) {
      throw new Error("Tokens changed while filters were loading");
    }
    const pinnedSearch = new URLSearchParams(requestedSearch);
    pinnedSearch.set("rankingCommitment", rankingCommitment);
    return loadExplorePayload(contentKey, pinnedSearch);
  };

  try {
    return await loadPinnedPage();
  } catch (error) {
    if (!(error instanceof ExploreRankingRestartError)) throw error;
    abortExplorePayload(contentKey);
    expireResolvedExplorePayloadCache(contentKey);
    abortExplorePayload(firstPageContentKey);
    expireResolvedExplorePayloadCache(firstPageContentKey);
    expireResolvedExploreCollectionPayloads(requestedSearch);
    return loadPinnedPage();
  }
}

async function loadExploreModelDatasetAttempt(
  contentKey: string,
  search: URLSearchParams,
) {
  const firstPageSearch = new URLSearchParams(search);
  firstPageSearch.set("page", "1");
  firstPageSearch.set("limit", String(EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE));
  const firstPage = await loadExplorePayload(
    `${contentKey}\u0000model-page:1`,
    firstPageSearch,
  );
  if (firstPage.catalog === undefined) {
    throw new Error("Tokens changed while filters were loading");
  }
  const firstPageCatalog = firstPage.catalog;
  const firstPageProviderOrderCommitment =
    exploreProviderOrderCommitmentKey(firstPage);
  const marketCapSort = firstPageSearch.get("sort") === "market-cap" ||
    firstPageSearch.get("sort") === "market-cap-asc";
  const rankingCommitment = marketCapSort
    ? exploreMarketCapRankingCommitment(firstPage)
    : undefined;
  if (marketCapSort && rankingCommitment === undefined) {
    throw new Error("Tokens changed while filters were loading");
  }
  if (firstPage.totalPages <= 1) {
    if (firstPage.page !== 1 || firstPage.tokens.length !== firstPage.total) {
      throw new Error("Tokens changed while filters were loading");
    }
    assertUniqueExploreDatasetEntries(firstPage.tokens);
    return firstPage;
  }

  const remainingPages = await Promise.all(
    Array.from({ length: firstPage.totalPages - 1 }, async (_, index) => {
      const page = index + 2;
      const pageSearch = new URLSearchParams(firstPageSearch);
      pageSearch.set("page", String(page));
      if (rankingCommitment !== undefined) {
        pageSearch.set("rankingCommitment", rankingCommitment);
      }
      const payload = await loadExplorePayload(
        `${contentKey}\u0000model-page:${page}`,
        pageSearch,
      );
      if (
        payload.status !== firstPage.status ||
        payload.page !== page ||
        payload.pageSize !== firstPage.pageSize ||
        payload.total !== firstPage.total ||
        payload.totalPages !== firstPage.totalPages ||
        payload.catalog === undefined ||
        exploreCatalogBoundaryKey(payload.catalog) !==
          exploreCatalogBoundaryKey(firstPageCatalog) ||
        exploreProviderOrderCommitmentKey(payload) !==
          firstPageProviderOrderCommitment
      ) {
        throw new Error("Tokens changed while filters were loading");
      }
      return payload;
    }),
  );

  const pages = [firstPage, ...remainingPages];
  let tokens = pages.flatMap(
    (payload) => payload.tokens,
  );
  if (tokens.length !== firstPage.total) {
    throw new Error("Tokens changed while filters were loading");
  }
  assertUniqueExploreDatasetEntries(tokens);
  const degradedPages = pages.filter(
    (payload) => payload.marketRead?.status === "unavailable",
  );
  if (degradedPages.length > 0 && degradedPages.length !== pages.length) {
    throw new Error("Tokens changed while filters were loading");
  }
  const degradedPage = degradedPages[0];
  if (degradedPage !== undefined) {
    const markerIsConsistent = degradedPages.every((payload) =>
      payload.marketRead?.provider === degradedPage.marketRead?.provider &&
      payload.marketRead?.status === degradedPage.marketRead?.status &&
      (payload.marketRead?.provider !== "dexscreener" ||
        degradedPage.marketRead?.provider !== "dexscreener" ||
        payload.marketRead.currency === degradedPage.marketRead.currency) &&
      (payload.marketRead?.provider !== "gmgn" ||
        degradedPage.marketRead?.provider !== "gmgn" ||
        (payload.marketRead.currency === degradedPage.marketRead.currency &&
          payload.marketRead.fallbackProvider ===
            degradedPage.marketRead.fallbackProvider)) &&
      (payload.marketRead?.provider !== "bitquery" ||
        degradedPage.marketRead?.provider !== "bitquery" ||
        (payload.marketRead.category === degradedPage.marketRead.category &&
          payload.marketRead.phase === degradedPage.marketRead.phase &&
          payload.marketRead.reason === degradedPage.marketRead.reason &&
          payload.marketRead.httpStatus === degradedPage.marketRead.httpStatus)) &&
      payload.ranking?.status === degradedPage.ranking?.status &&
      payload.ranking?.requested === degradedPage.ranking?.requested &&
      payload.ranking?.applied === degradedPage.ranking?.applied
    );
    if (!markerIsConsistent) {
      throw new Error("Tokens changed while filters were loading");
    }
    const sourceQuality = degradedPage.dataQuality;
    if (sourceQuality === undefined) {
      throw new Error("Tokens changed while filters were loading");
    }
    tokens = tokens.map((entry): ValuedExploreEntry => {
      if (entry.exploreKind === "custom-project") {
        const {
          marketData: _marketData,
          gmgnMarketData: _gmgnMarketData,
          liquidityEvidence: _liquidityEvidence,
          fdvUsdWad: _fdvUsdWad,
          ...identity
        } = entry as typeof entry & Readonly<{ fdvUsdWad?: string }>;
        void _marketData;
        void _gmgnMarketData;
        void _liquidityEvidence;
        void _fdvUsdWad;
        return {
          ...identity,
          valuation: {
            status: "unavailable",
            reason: entry.markets.length === 0
              ? "no-market"
              : "source-unavailable",
          },
        };
      }
      const {
        marketData: _marketData,
        gmgnMarketData: _gmgnMarketData,
        liquidityEvidence: _liquidityEvidence,
        fdvUsdWad: _fdvUsdWad,
        ...identity
      } = entry;
      void _marketData;
      void _gmgnMarketData;
      void _liquidityEvidence;
      void _fdvUsdWad;
      return {
        ...identity,
        valuation: { status: "unavailable", reason: "source-unavailable" },
      };
    });
    const marketSort = firstPageSearch.get("sort") === "market-cap" ||
      firstPageSearch.get("sort") === "market-cap-asc";
    if (marketSort && degradedPage.ranking === undefined) {
      throw new Error("Tokens changed while filters were loading");
    }
    return {
      ...firstPage,
      tokens,
      dataQuality: buildExploreDataQuality({
        entries: tokens,
        generatedAt: sourceQuality.generatedAt,
        canonicalStatus: sourceQuality.launchIdentity.canonical,
        customStatus: sourceQuality.launchIdentity.custom,
        identityAsOfBlock: sourceQuality.launchIdentity.asOfBlock,
        referenceBlock: sourceQuality.launchIdentity.referenceBlock,
        identityAgeMs: sourceQuality.launchIdentity.ageMs,
      }),
      marketRead: degradedPage.marketRead,
      ...(degradedPage.ranking === undefined
        ? {}
        : { ranking: degradedPage.ranking }),
    };
  }
  return {
    ...firstPage,
    tokens,
  };
}

function invalidateExploreModelDatasetPages(contentKey: string) {
  abortExplorePayload(contentKey);
  expireResolvedExplorePayloadCache(contentKey);
}

export async function loadExploreModelDataset(
  contentKey: string,
  search: URLSearchParams,
) {
  try {
    return await loadExploreModelDatasetAttempt(contentKey, search);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      (error.message !== "Tokens changed while filters were loading" &&
        !(error instanceof ExploreRankingRestartError))
    ) {
      throw error;
    }
    invalidateExploreModelDatasetPages(contentKey);
    return loadExploreModelDatasetAttempt(contentKey, search);
  }
}

export function paginateExploreModelDataset(
  dataset: ExplorePayload,
  modelFilter: ExploreModelFilter,
  requestedPage: number,
  pageSize = EXPLORE_TOKENS_PER_PAGE,
  valuationSort: ExploreValuationSort = "none",
  ageSort: ExploreAgeSort = "none",
  socialFilter: ExploreSocialFilter = "all",
): ExplorePayload {
  const selectedTokens = sortExploreEntriesBySelections(
    filterTokensByLaunchModel(
      filterTokensBySocialPresence(dataset.tokens, socialFilter),
      modelFilter,
    ),
    valuationSort,
    ageSort,
  );
  const totalPages = Math.ceil(selectedTokens.length / pageSize);
  const pageNumber = totalPages === 0
    ? 1
    : Math.min(requestedPage, totalPages);
  const offset = (pageNumber - 1) * pageSize;
  const page = {
    tokens: selectedTokens.slice(offset, offset + pageSize),
    page: pageNumber,
    pageSize,
    total: selectedTokens.length,
    totalPages,
  };
  const providerOrderProofMatchesLocalSelection =
    dataset.tokens.length === dataset.total &&
    selectedTokens.length === dataset.tokens.length &&
    selectedTokens.every((token, index) => token.id === dataset.tokens[index]?.id);
  return {
    status: dataset.status,
    ...page,
    ...(dataset.dataQuality === undefined
      ? {}
      : {
          dataQuality: buildExploreDataQuality({
            entries: page.tokens,
            generatedAt: dataset.dataQuality.generatedAt,
            canonicalStatus: dataset.dataQuality.launchIdentity.canonical,
            customStatus: dataset.dataQuality.launchIdentity.custom,
            identityAsOfBlock: dataset.dataQuality.launchIdentity.asOfBlock,
            referenceBlock: dataset.dataQuality.launchIdentity.referenceBlock,
            identityAgeMs: dataset.dataQuality.launchIdentity.ageMs,
          }),
        }),
    ...(dataset.marketRead === undefined
      ? {}
      : { marketRead: dataset.marketRead }),
    ...(dataset.catalog === undefined ? {} : { catalog: dataset.catalog }),
    ...(!providerOrderProofMatchesLocalSelection || dataset.ranking === undefined
      ? {}
      : { ranking: dataset.ranking }),
    ...(!providerOrderProofMatchesLocalSelection || dataset.discovery === undefined
      ? {}
      : { discovery: dataset.discovery }),
    ...(!providerOrderProofMatchesLocalSelection || dataset.search === undefined
      ? {}
      : { search: dataset.search }),
  };
}

export function paginateTokensBySocialPresence<
  T extends Readonly<{ links?: readonly TokenLink[] }>,
>(
  tokens: T[],
  socialFilter: ExploreSocialFilter,
  requestedPage: number,
  pageSize = EXPLORE_TOKENS_PER_PAGE,
) {
  const filtered = filterTokensBySocialPresence(tokens, socialFilter);
  const totalPages = Math.ceil(filtered.length / pageSize);
  const page = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;

  return {
    tokens: filtered.slice(offset, offset + pageSize),
    page,
    pageSize,
    total: filtered.length,
    totalPages,
  };
}

export function tokenLaunchModelGroup(
  token: Pick<ExploreEntry, "launchCategoryProvenance">,
): Exclude<ExploreModelFilter, "all"> | null {
  return token.launchCategoryProvenance.category === "classic"
    ? "classic"
    : token.launchCategoryProvenance.category === "custom"
      ? "custom-hook"
      : null;
}

export function filterTokensByLaunchModel<T extends ExploreEntry>(
  tokens: T[],
  modelFilter: ExploreModelFilter,
) {
  if (modelFilter === "all") return tokens;
  return tokens.filter((token) => tokenLaunchModelGroup(token) === modelFilter);
}

export function paginateTokensByExploreFilters<T extends ExploreEntry>(
  tokens: T[],
  socialFilter: ExploreSocialFilter,
  modelFilter: ExploreModelFilter,
  requestedPage: number,
  pageSize = EXPLORE_TOKENS_PER_PAGE,
) {
  const filtered = filterTokensByLaunchModel(
    filterTokensBySocialPresence(tokens, socialFilter),
    modelFilter,
  );
  const totalPages = Math.ceil(filtered.length / pageSize);
  const page = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;

  return {
    tokens: filtered.slice(offset, offset + pageSize),
    page,
    pageSize,
    total: filtered.length,
    totalPages,
  };
}

function compareExploreEntryAge(left: ExploreEntry, right: ExploreEntry) {
  const leftTime = Date.parse(left.launchedAt);
  const rightTime = Date.parse(right.launchedAt);
  if (
    Number.isFinite(leftTime) &&
    Number.isFinite(rightTime) &&
    leftTime !== rightTime
  ) {
    return leftTime - rightTime;
  }
  if (left.exploreKind === "token" && right.exploreKind === "token") {
    return comparePreviewLaunchOrder(left, right);
  }
  return left.id.localeCompare(right.id);
}

function compareExploreEntryValuation(
  left: ExploreEntry | ValuedExploreEntry,
  right: ExploreEntry | ValuedExploreEntry,
  direction: Exclude<ExploreValuationSort, "none">,
) {
  const leftValuation = valuationForEntry(left);
  const rightValuation = valuationForEntry(right);
  const leftQualified = isExploreValuationQualifiedV1(leftValuation);
  const rightQualified = isExploreValuationQualifiedV1(rightValuation);
  if (leftQualified !== rightQualified) return leftQualified ? -1 : 1;
  if (!leftQualified || !rightQualified) return 0;
  if (leftValuation.currency !== rightValuation.currency) return 0;

  const leftValue = BigInt(leftValuation.valueWad);
  const rightValue = BigInt(rightValuation.valueWad);
  if (leftValue === rightValue) return 0;
  const ascending = leftValue < rightValue ? -1 : 1;
  return direction === "lowest" ? ascending : -ascending;
}

function compareExploreEntryIdentity(left: ExploreEntry, right: ExploreEntry) {
  const leftIdentity =
    left.tokenAddress?.toLowerCase() ?? left.id.toLowerCase();
  const rightIdentity =
    right.tokenAddress?.toLowerCase() ?? right.id.toLowerCase();
  const identityComparison = leftIdentity.localeCompare(rightIdentity);
  return identityComparison !== 0
    ? identityComparison
    : left.id.localeCompare(right.id);
}

export function sortExploreEntriesBySelections<T extends ExploreEntry>(
  tokens: T[],
  valuationSort: ExploreValuationSort,
  ageSort: ExploreAgeSort,
) {
  if (valuationSort === "none" && ageSort === "none") return tokens;
  return [...tokens].sort((left, right) => {
    if (valuationSort !== "none") {
      const valuationComparison = compareExploreEntryValuation(
        left,
        right,
        valuationSort,
      );
      if (valuationComparison !== 0) return valuationComparison;
    }
    if (ageSort !== "none") {
      const ageComparison = compareExploreEntryAge(left, right);
      if (ageComparison !== 0) {
        return ageSort === "newest" ? -ageComparison : ageComparison;
      }
    }
    return compareExploreEntryIdentity(left, right);
  });
}

export function paginateTokensByExploreSelections<T extends ExploreEntry>(
  tokens: T[],
  socialFilter: ExploreSocialFilter,
  modelFilter: ExploreModelFilter,
  valuationSort: ExploreValuationSort,
  ageSort: ExploreAgeSort,
  requestedPage: number,
  pageSize = EXPLORE_TOKENS_PER_PAGE,
) {
  const filtered = filterTokensByLaunchModel(
    filterTokensBySocialPresence(tokens, socialFilter),
    modelFilter,
  );
  const ranked = sortExploreEntriesBySelections(
    filtered,
    valuationSort,
    ageSort,
  );
  const totalPages = Math.ceil(ranked.length / pageSize);
  const page = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;

  return {
    tokens: ranked.slice(offset, offset + pageSize),
    page,
    pageSize,
    total: ranked.length,
    totalPages,
  };
}

function getFallbackTokenImage(address: string) {
  const suffix = Number.parseInt(address.slice(-8), 16);
  const index = Number.isFinite(suffix)
    ? suffix % fallbackTokenImages.length
    : 0;
  return fallbackTokenImages[index];
}

function valuationForEntry(
  entry: ExploreEntry | ValuedExploreEntry,
): ExploreValuation {
  const explicit = (entry as Partial<ValuedExploreEntry>).valuation;
  return isExploreValuation(explicit) ? explicit : exploreValuation(entry);
}

export function getExploreValuationMetric(
  token: ExploreEntry | ValuedExploreEntry,
): MarketCapMetric | undefined {
  const valuation = valuationForEntry(token);
  if (!isExploreValuationQualifiedV1(valuation)) return undefined;
  const value = Number(BigInt(valuation.valueWad)) / 1e18;
  if (!Number.isFinite(value) || value <= 0) return undefined;
  if (valuation.currency === "usd") return { kind: "usd", value };
  if (valuation.currency === "eth") return { kind: "eth", value };
  return { kind: "quote", symbol: valuation.quoteSymbol ?? "", value };
}

export function getExplorePaginationItems(
  currentPage: number,
  pageCount: number,
): PaginationItem[] {
  if (pageCount <= 4) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  if (currentPage <= 3) {
    return [1, 2, 3, "end-gap", pageCount];
  }

  if (currentPage >= pageCount - 2) {
    return [1, "start-gap", pageCount - 2, pageCount - 1, pageCount];
  }

  return [1, "start-gap", currentPage, "end-gap", pageCount];
}

export function tokenHasSocialLinks(
  token: Readonly<{ links?: readonly TokenLink[] }>,
) {
  return Boolean(
    token.links?.some((link) => link.kind === "x" || link.kind === "telegram"),
  );
}

export function filterTokensBySocialPresence<
  T extends Readonly<{ links?: readonly TokenLink[] }>,
>(tokens: T[], socialFilter: ExploreSocialFilter) {
  if (socialFilter === "all") return tokens;
  const shouldHaveSocials = socialFilter === "yes";
  return tokens.filter(
    (token) => tokenHasSocialLinks(token) === shouldHaveSocials,
  );
}

export function exploreTokenCardDescription(token: ExploreEntry) {
  const description = token.description?.trim();
  if (description) return description;

  return token.exploreKind === "token" &&
    isLaunchStampProvenanceV1(token.launchStampProvenance)
    ? "Canonical Router stamp. v4 pool initialized."
    : undefined;
}

export function formatExploreContractAddress(address: `0x${string}`) {
  return `${address.slice(0, 6)}…${address.slice(-3)}`;
}

export function getTokenCards(
  tokens: Array<ExploreEntry | ValuedExploreEntry>,
): TokenCard[] {
  return tokens.map((token) => {
    const valuation = valuationForEntry(token);
    return {
      id: token.id,
      name: token.name,
      symbol: token.symbol?.trim() ?? "",
      description: exploreTokenCardDescription(token),
      imageUrl:
        token.imageUrl?.trim() ||
        getFallbackTokenImage(token.tokenAddress ?? token.id),
      links: [...(token.links ?? [])].sort(
        (left, right) => tokenLinkOrder[left.kind] - tokenLinkOrder[right.kind],
      ),
      valuation: getExploreValuationMetric(token),
      ...(valuation.status === "available"
        ? {
            valuationMetric: "Fully diluted valuation" as const,
            ...(valuation.source === "gmgn"
              ? { valuationProvider: "GMGN" as const }
              : valuation.source === "dexscreener"
                ? { valuationProvider: "Dexscreener" as const }
                : {}),
          }
        : {}),
      marketStatus: exploreMarketStatusLabel(token),
      usesFallbackImage: !token.imageUrl?.trim(),
      ...(token.tokenAddress === undefined
        ? {}
        : { tokenAddress: token.tokenAddress }),
      launchCategory:
        token.launchCategoryProvenance.category === "classic"
          ? "Classic"
          : "Custom V4 Hook",
      ...(token.partnerAttribution
        ? { partnerAttribution: token.partnerAttribution }
        : {}),
    };
  });
}

function getTokenLinkLabel(kind: TokenLink["kind"]) {
  if (kind === "website") return "Website";
  if (kind === "telegram") return "Telegram";
  if (kind === "discord") return "Discord";
  if (kind === "github") return "GitHub";
  if (kind === "gitbook") return "GitBook";
  return "X";
}

function TelegramBrandIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M22.8 3.2 19.5 20.1c-.25 1.2-.91 1.5-1.85.94l-5.03-3.71-2.43 2.34c-.27.27-.5.5-1.02.5l.36-5.13 9.34-8.44c.41-.36-.09-.56-.63-.2L6.7 13.67l-4.98-1.56c-1.08-.34-1.1-1.08.23-1.6L21.36 3c.9-.33 1.69.2 1.44 1.2Z"
      />
    </svg>
  );
}

function TokenLinkIcon({ kind }: { kind: TokenLink["kind"] }) {
  if (kind === "website") return <WebsiteLinkIcon />;
  if (kind === "telegram") return <TelegramBrandIcon />;
  if (kind === "discord") return <DiscordBrandIcon />;
  if (kind === "github") return <GitHubBrandIcon />;
  if (kind === "gitbook") return <BookOpen aria-hidden="true" size={18} />;
  return <XBrandIcon />;
}

function ExploreCardSkeleton() {
  return (
    <article className={`${styles.runnerCard} ${styles.skeletonCard}`}>
      <div className={styles.runnerHitArea}>
        <div
          className={`${styles.runnerArt} ${styles.skeletonArt}`}
          data-skeleton="true"
        />
        <div className={styles.runnerBody}>
          <div className={styles.runnerHeading}>
            <span
              className={`${styles.skeletonLine} ${styles.skeletonTitle}`}
              data-skeleton="true"
            />
            <span
              className={`${styles.skeletonLine} ${styles.skeletonSymbol}`}
              data-skeleton="true"
            />
          </div>
        </div>
      </div>
      <div className={styles.runnerMeta}>
        <span
          className={`${styles.skeletonLine} ${styles.skeletonCategory}`}
          data-skeleton="true"
        />
        <span
          className={`${styles.skeletonLine} ${styles.skeletonContract}`}
          data-skeleton="true"
        />
        <span
          className={`${styles.skeletonLine} ${styles.skeletonPartner}`}
          data-skeleton="true"
        />
      </div>
    </article>
  );
}

function ExploreGridSkeleton({ count }: Readonly<{ count: number }>) {
  return (
    <div
      className={`${styles.runnerGrid} ${styles.skeletonGrid}`}
      aria-hidden="true"
    >
      {Array.from({ length: count }, (_, index) => (
        <ExploreCardSkeleton key={index} />
      ))}
    </div>
  );
}

function resultRangeLabel(payload: ExplorePayload | null) {
  if (!payload) return "Loading launch index";
  if (payload.status === "not-deployed") return "Launch index rebuilding";
  if (payload.total === 0) return "0 launches";

  const start = (payload.page - 1) * payload.pageSize + 1;
  const end = Math.min(payload.total, start + payload.tokens.length - 1);
  return `${start}–${end} of ${payload.total} ${
    payload.total === 1 ? "launch" : "launches"
  }`;
}

export function ExploreView({
  initialResponse,
  initialResponseChainId,
  initialModelFilter = "all",
  indexRebuilding = false,
  loadingOnly = false,
  embedded = false,
}: Readonly<{
  initialResponse?: ExploreInitialResponse;
  initialResponseChainId?: ViewChainId;
  initialModelFilter?: ExploreModelFilter;
  indexRebuilding?: boolean;
  loadingOnly?: boolean;
  embedded?: boolean;
}> = {}) {
  const router = useRouter();
  const preview = useInterfacePreview();
  const {
    hydrated: viewChainReady,
    viewChainId: resolvedViewChainId,
    setViewChainId,
  } = useViewChain();
  const hydratedViewChainId =
    !viewChainReady && initialResponseChainId !== undefined
      ? initialResponseChainId
      : resolvedViewChainId;
  const viewChainId = resolveExploreChainId(hydratedViewChainId);
  useEffect(() => {
    if (resolvedViewChainId === viewChainId) return;
    const frame = window.requestAnimationFrame(() => {
      setViewChainId(viewChainId);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [resolvedViewChainId, setViewChainId, viewChainId, viewChainReady]);
  const activeInitialResponse =
    initialResponseChainId === undefined ||
      initialResponseChainId === viewChainId
      ? initialResponse
      : undefined;
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim();
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [valuationSort, setValuationSort] = useState<ExploreValuationSort>(
    DEFAULT_EXPLORE_VALUATION_SORT,
  );
  const [ageSort, setAgeSort] = useState<ExploreAgeSort>("none");
  const [discoverySort, setDiscoverySort] = useState<ExploreDiscoverySort>(
    "none",
  );
  const [socialFilter, setSocialFilter] = useState<ExploreSocialFilter>("all");
  const [modelFilter, setModelFilter] = useState<ExploreModelFilter>(
    initialModelFilter,
  );
  const { pageSize, ready: exploreViewportReady } =
    useExplorePaginationViewport();
  const [pageSelection, setPageSelection] = useState({
    chainId: viewChainId,
    pageSize,
    page: 1,
  });
  const currentPage =
    pageSelection.chainId === viewChainId &&
      pageSelection.pageSize === pageSize
      ? pageSelection.page
      : 1;
  const setCurrentPage = useCallback(
    (nextPage: SetStateAction<number>) => {
      setPageSelection((current) => {
        const activePage =
          current.chainId === viewChainId && current.pageSize === pageSize
            ? current.page
            : 1;
        const page = typeof nextPage === "function"
          ? nextPage(activePage)
          : nextPage;
        return current.chainId === viewChainId &&
            current.pageSize === pageSize &&
            current.page === page
          ? current
          : { chainId: viewChainId, pageSize, page };
      });
    },
    [pageSize, viewChainId],
  );
  const [retryKey, setRetryKey] = useState(0);
  const [revalidationKey, setRevalidationKey] = useState(0);
  const [copyFeedback, setCopyFeedback] = useState("");
  const [copiedTokenId, setCopiedTokenId] = useState<string | null>(null);
  const activeExploreContentKey = useRef<string | null>(null);
  const backgroundRevalidationTarget = useRef<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resultStatusRef = useRef<HTMLParagraphElement>(null);
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const modelDatasetCache = useRef<{
    key: string;
    payload: ExplorePayload;
    updatedAt: number;
  } | null>(null);
  const filterRef = useRef<HTMLDetailsElement>(null);
  const {
    valuationSort: valuationSortForChain,
    ageSort: ageSortForChain,
    discoverySort: discoverySortForChain,
  } = resolveExploreSortSelectionsForChain(
    viewChainId,
    valuationSort,
    ageSort,
    discoverySort,
  );
  const sort = resolveExploreServerSort(
    valuationSortForChain,
    ageSortForChain,
    discoverySortForChain,
  );
  const requiresCompleteDataset = requiresCompleteExploreDataset(
    valuationSortForChain,
    ageSortForChain,
    discoverySortForChain,
  );
  const chainContentKey = `${viewChainId}`;
  const contentKey = `${chainContentKey}\u0000${debouncedQuery}\u0000${valuationSortForChain}\u0000${ageSortForChain}\u0000${discoverySortForChain}\u0000${socialFilter}\u0000${modelFilter}\u0000${currentPage}\u0000${pageSize}`;
  const requestKey = `${contentKey}\u0000${retryKey}`;
  const modelDatasetKey = `${chainContentKey}\u0000${debouncedQuery}\u0000${valuationSortForChain}\u0000${ageSortForChain}\u0000${discoverySortForChain}\u0000${socialFilter}\u0000${modelFilter}\u0000${retryKey}`;
  const activeRequestContentKey =
    requiresCompleteDataset ? modelDatasetKey : contentKey;
  const [initialState] = useState(() =>
    createExploreInitialState(activeInitialResponse, {
      requestKey,
      contentKey,
      pageSize,
    }),
  );
  const initialResponseReuseAvailable = useRef(
    initialState !== null,
  );
  const handledRequestKey = useRef<string | null>(
    handledInitialExploreRequestKey(initialState, requestKey),
  );
  const [state, setState] = useState<ExploreState>(() => {
    if (initialState !== null) return initialState;
    const cached = readResolvedExplorePayload(activeRequestContentKey);
    return cached
      ? {
          phase: "ready",
          payload: cached,
          requestKey,
          contentKey,
        }
      : { phase: "loading" };
  });
  useEffect(
    () => () => {
      if (activeExploreContentKey.current) {
        abortExplorePayload(activeExploreContentKey.current);
      }
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
    },
    [],
  );

  async function copyContractAddress(token: TokenCard) {
    if (!token.tokenAddress) return;

    try {
      await navigator.clipboard.writeText(token.tokenAddress);
      setCopyFeedback(`${token.name} contract address copied`);
      setCopiedTokenId(token.id);
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
      copyFeedbackTimerRef.current = window.setTimeout(() => {
        setCopyFeedback("");
        setCopiedTokenId(null);
        copyFeedbackTimerRef.current = null;
      }, 1800);
    } catch {
      setCopyFeedback("Contract address could not be copied");
      setCopiedTokenId(null);
    }
  }

  useEffect(() => {
    if (normalizedQuery === debouncedQuery) return;

    const timer = window.setTimeout(() => {
      setCurrentPage(1);
      setDebouncedQuery(normalizedQuery);
    }, QUERY_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [debouncedQuery, normalizedQuery, setCurrentPage]);

  useEffect(() => {
    function closeFilter(event: PointerEvent | KeyboardEvent) {
      const filter = filterRef.current;
      if (!filter?.open) return;
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        filter.removeAttribute("open");
        filter.querySelector("summary")?.focus();
        return;
      }
      if (
        event instanceof PointerEvent &&
        event.target instanceof Node &&
        !filter.contains(event.target)
      ) {
        filter.removeAttribute("open");
      }
    }

    document.addEventListener("pointerdown", closeFilter);
    document.addEventListener("keydown", closeFilter);
    return () => {
      document.removeEventListener("pointerdown", closeFilter);
      document.removeEventListener("keydown", closeFilter);
    };
  }, []);

  useEffect(() => {
    if (
      indexRebuilding ||
      preview ||
      loadingOnly ||
      isInterfacePreviewHost(window.location.hostname)
    ) return;

    const schedulerStartedAt = Date.now();
    const scheduler = createExploreRevalidationScheduler({
      visibilityState: () => document.visibilityState,
      online: () => navigator.onLine,
      now: () => Date.now(),
      setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimeout: (timer) => window.clearTimeout(timer),
      onRevalidate: () => {
        if (!explorePageSizeMatchesViewport(pageSize, window.innerWidth)) return;
        backgroundRevalidationTarget.current = activeRequestContentKey;
        modelDatasetCache.current = null;
        expireResolvedExplorePayloadCache(activeRequestContentKey);
        setRevalidationKey((value) => value + 1);
      },
      lastRevalidationAt: exploreRevalidationCacheTimestamp({
        activeKey: activeRequestContentKey,
        fallback: schedulerStartedAt,
        resolvedUpdatedAt: resolvedExplorePayloadUpdatedAt(
          activeRequestContentKey,
          schedulerStartedAt,
        ),
        modelDataset: modelDatasetCache.current,
      }),
    });
    const syncScheduler = () => scheduler.sync();

    document.addEventListener("visibilitychange", syncScheduler);
    window.addEventListener("focus", syncScheduler);
    window.addEventListener("online", syncScheduler);
    window.addEventListener("offline", syncScheduler);
    return () => {
      scheduler.dispose();
      document.removeEventListener("visibilitychange", syncScheduler);
      window.removeEventListener("focus", syncScheduler);
      window.removeEventListener("online", syncScheduler);
      window.removeEventListener("offline", syncScheduler);
    };
  }, [activeRequestContentKey, indexRebuilding, loadingOnly, pageSize, preview]);

  useEffect(() => {
    if (
      indexRebuilding ||
      preview ||
      loadingOnly ||
      (typeof window !== "undefined" &&
        isInterfacePreviewHost(window.location.hostname))
    ) {
      return;
    }

    if (
      typeof window !== "undefined" &&
      !explorePageSizeMatchesViewport(pageSize, window.innerWidth)
    ) {
      return;
    }

    const search = new URLSearchParams({
      chain: String(viewChainId),
      q: debouncedQuery,
      sort,
      page: String(currentPage),
      limit: String(pageSize),
    });
    if (socialFilter !== "all") {
      search.set("socials", socialFilter);
    }
    if (modelFilter !== "all") {
      search.set(
        "model",
        modelFilter === "custom-hook" ? "custom" : "classic",
      );
    }

    const initialValuationSort = DEFAULT_EXPLORE_VALUATION_SORT;
    const isInitialRequest =
      debouncedQuery === "" &&
      valuationSortForChain === initialValuationSort &&
      ageSortForChain === "none" &&
      discoverySortForChain === "none" &&
      socialFilter === "all" &&
      modelFilter === initialModelFilter &&
      currentPage === 1 &&
      retryKey === 0 &&
      revalidationKey === 0;
    const responsiveInitialState = createResponsiveExploreInitialState(
      activeInitialResponse,
      {
        reuseAvailable: initialResponseReuseAvailable.current,
        isInitialRequest,
        requestKey,
        contentKey,
        pageSize,
      },
    );
    if (responsiveInitialState !== null) {
      activeExploreContentKey.current = activeRequestContentKey;
      if (responsiveInitialState.phase === "ready") {
        cacheResolvedExplorePayload(
          activeRequestContentKey,
          responsiveInitialState.payload,
          search,
        );
      }
      if (handledRequestKey.current !== requestKey) {
        handledRequestKey.current = requestKey;
        setState(responsiveInitialState);
      }
      return;
    }

    initialResponseReuseAvailable.current = false;

    let ignore = false;
    const isBackgroundRevalidation =
      backgroundRevalidationTarget.current === activeRequestContentKey;
    if (isBackgroundRevalidation) {
      backgroundRevalidationTarget.current = null;
    }
    const previousContentKey = activeExploreContentKey.current;
    if (previousContentKey && previousContentKey !== activeRequestContentKey) {
      abortExplorePayload(previousContentKey);
    }
    activeExploreContentKey.current = activeRequestContentKey;
    async function loadTokens() {
      try {
        let payload: ExplorePayload;
        if (!requiresCompleteDataset) {
          payload = await loadExplorePage(
            activeRequestContentKey,
            search,
          );
        } else {
          const cachedDataset = modelDatasetCache.current;
          const cacheIsFresh = isExploreModelDatasetCacheFresh(
            cachedDataset,
            modelDatasetKey,
          );
          if (cachedDataset?.key === modelDatasetKey && !cacheIsFresh) {
            modelDatasetCache.current = null;
          }
          let dataset = cacheIsFresh ? cachedDataset?.payload ?? null : null;
          if (!dataset) {
            dataset = await loadExploreModelDataset(
              activeRequestContentKey,
              search,
            );
            if (ignore) return;
            modelDatasetCache.current =
              dataset.marketRead?.status === "unavailable"
                ? null
                : {
                    key: modelDatasetKey,
                    payload: dataset,
                    updatedAt: Date.now(),
                  };
          }
          payload = paginateExploreModelDataset(
            dataset,
            modelFilter,
            currentPage,
            pageSize,
            valuationSortForChain,
            ageSortForChain,
            socialFilter,
          );
        }
        if (ignore) return;
        if (payload.page !== currentPage) {
          setCurrentPage(payload.page);
        }
        handledRequestKey.current = requestKey;
        setState((current) => ({
          phase: "ready",
          payload:
            isBackgroundRevalidation &&
              current.phase === "ready" &&
              current.contentKey === contentKey
              ? stabilizeExploreRevalidationPayload(current.payload, payload, {
                  incomingIsCompleteLocalSelection: requiresCompleteDataset,
                })
              : payload,
          requestKey,
          contentKey,
        }));
      } catch (error) {
        if (ignore) return;
        const message =
          error instanceof Error
            ? error.message
            : "Launches are temporarily unavailable";
        setState((current) =>
          preserveExplorePayloadOnRefreshFailure(current, {
            contentKey,
            requestKey,
            message,
          }),
        );
      }
    }

    void loadTokens();
    return () => {
      ignore = true;
    };
  }, [
    contentKey,
    currentPage,
    debouncedQuery,
    activeRequestContentKey,
    modelDatasetKey,
    modelFilter,
    pageSize,
    activeInitialResponse,
    initialModelFilter,
    initialState,
    indexRebuilding,
    loadingOnly,
    preview,
    revalidationKey,
    requestKey,
    retryKey,
    requiresCompleteDataset,
    socialFilter,
    sort,
    setCurrentPage,
    valuationSortForChain,
    viewChainId,
    ageSortForChain,
    discoverySortForChain,
  ]);

  const previewPayload = useMemo<ExplorePayload>(() => {
    const searchValue = debouncedQuery.toLowerCase();
    const filtered = EXPLORE_PREVIEW_TOKENS.filter((token) =>
      [token.name, token.symbol, token.tokenAddress].some((value) =>
        value.toLowerCase().includes(searchValue),
      ),
    );
    const paginated = paginateTokensByExploreSelections(
      filtered.map((entry) => ({
        ...entry,
        valuation: exploreValuation(entry, {
          referenceBlock: entry.indexedValuationBlockNumber ?? null,
        }),
      })),
      socialFilter,
      modelFilter,
      valuationSortForChain,
      ageSortForChain,
      currentPage,
      pageSize,
    );

    return {
      status: "ready",
      ...paginated,
    };
  }, [
    ageSortForChain,
    currentPage,
    debouncedQuery,
    modelFilter,
    pageSize,
    socialFilter,
    valuationSortForChain,
  ]);

  const activeChainState: ExploreState =
    state.phase === "loading" ||
      state.contentKey.startsWith(`${chainContentKey}\u0000`)
      ? state
      : { phase: "loading" };
  const displayState: ExploreState = indexRebuilding
    ? {
        phase: "ready",
        payload: {
          status: "not-deployed",
          tokens: [],
          page: 1,
          pageSize,
          total: 0,
          totalPages: 0,
        },
        requestKey,
        contentKey,
      }
    : preview
      ? {
        phase: "ready",
        payload: previewPayload,
        requestKey,
        contentKey,
      }
      : activeChainState;

  const payload = displayState.phase === "ready" ? displayState.payload : null;
  const cards = useMemo(
    () => getTokenCards(payload?.tokens ?? []),
    [payload?.tokens],
  );
  const pageCount = Math.max(1, payload?.totalPages ?? 0);
  const activePage = Math.min(payload?.page ?? currentPage, pageCount);
  const paginationGeometryPending =
    !exploreViewportReady ||
    (displayState.phase === "ready" &&
      displayState.payload.status === "ready" &&
      displayState.payload.pageSize !== pageSize);
  const pendingMobilePagination =
    paginationGeometryPending &&
    displayState.phase === "ready" &&
    displayState.payload.status === "ready" &&
    displayState.payload.total > EXPLORE_MOBILE_TOKENS_PER_PAGE;
  const showPagination =
    displayState.phase === "ready" &&
    displayState.payload.status === "ready" &&
    displayState.payload.total > 0 &&
    (pageCount > 1 || pendingMobilePagination);
  const mobileOnlyPaginationPlaceholder =
    pendingMobilePagination && pageCount === 1;
  const resultLabel =
    displayState.phase === "error" ? "" : resultRangeLabel(payload);
  const busy =
    !preview && !indexRebuilding &&
    (displayState.phase === "loading" ||
      displayState.requestKey !== requestKey);
  const {
    count: activeFilterCount,
    summary: activeSelectionSummary,
  } = exploreActiveSelectionState({
    valuationSort: valuationSortForChain,
    ageSort: ageSortForChain,
    discoverySort: discoverySortForChain,
    socialFilter,
    modelFilter,
  });
  const hasPublicTokens =
    displayState.phase !== "ready" ||
    displayState.payload.total > 0 ||
    Boolean(debouncedQuery) ||
    socialFilter !== "all" ||
    modelFilter !== "all";

  function retryTokens() {
    resultStatusRef.current?.focus({ preventScroll: true });
    modelDatasetCache.current = null;
    expireResolvedExplorePayloadCache(activeRequestContentKey);
    setRetryKey((value) => value + 1);
  }

  function updateModelFilter(next: ExploreModelFilter) {
    setModelFilter(next);
    setCurrentPage(1);
    const url = new URL(window.location.href);
    if (next === "all") {
      url.searchParams.delete("model");
    } else {
      url.searchParams.set(
        "model",
        next === "custom-hook" ? "custom" : "classic",
      );
    }
    window.history.replaceState(window.history.state, "", url);
  }

  function renderTokenState() {
    if (displayState.phase === "loading") {
      return (
        <div className={styles.loadingState} aria-busy="true">
          <p className={styles.loadingStatus} role="status" aria-live="polite">
            Loading launches
          </p>
          <ExploreGridSkeleton count={pageSize} />
        </div>
      );
    }

    if (displayState.phase === "error") {
      return (
        <div className={styles.messageState} role="alert">
          <div className={styles.messageCopy}>
            <h2>Couldn’t load launches</h2>
            <p>{displayState.message}</p>
          </div>
          <button className="text-button" type="button" onClick={retryTokens}>
            Try again
          </button>
        </div>
      );
    }

    if (displayState.payload.status === "not-deployed") {
      return (
        <div className={`${styles.emptyState} liquid-glass-surface`}>
          <div>
            <h2>
              {viewChainId === 4663
                ? "Robinhood Explore is not active yet"
                : "Launch indexing is being rebuilt"}
            </h2>
            <p>
              {viewChainId === 4663
                ? "The Robinhood Explore and indexing lane is not available yet."
                : "Programmable launches will return here after the new index is ready."}
            </p>
          </div>
        </div>
      );
    }

    if (cards.length === 0) {
      if (debouncedQuery || socialFilter !== "all" || modelFilter !== "all") {
        const hasActiveFilter = socialFilter !== "all" || modelFilter !== "all";
        const noMatchMessage = debouncedQuery
          ? hasActiveFilter
            ? "No launches match your search and filters."
            : "No launches match your search."
          : "No launches match these filters.";
        return (
          <div className={styles.messageState}>
            <div className={styles.messageCopy}>
              <h2>No matching launches</h2>
              <p>{noMatchMessage}</p>
            </div>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setQuery("");
                setSocialFilter("all");
                updateModelFilter("all");
                setValuationSort(DEFAULT_EXPLORE_VALUATION_SORT);
                setAgeSort("none");
                setDiscoverySort("none");
                searchInputRef.current?.focus();
              }}
            >
              Clear filters
            </button>
          </div>
        );
      }
      if (payload?.dataQuality?.launchIdentity.status === "partial") {
        return (
          <div className={`${styles.emptyState} liquid-glass-surface`}>
            <div>
              <h2>Launches are catching up</h2>
              <p>
                Some launches are temporarily unavailable. Try again in a
                moment.
              </p>
            </div>
            <button
              className={styles.emptyAction}
              type="button"
              onClick={retryTokens}
            >
              Refresh
            </button>
          </div>
        );
      }

      return (
        <div className={`${styles.emptyState} liquid-glass-surface`}>
          <div>
            <h2>No launches yet</h2>
            <p>Start the first launch and it will appear here.</p>
          </div>
          <Link className={styles.emptyAction} href="/launch">
            Start a launch
          </Link>
        </div>
      );
    }

    return (
      <div
        className={`${styles.runnerGrid} ${styles.revealedGrid}`}
      >
        {cards.map((token, index) => {
          const href = token.tokenAddress
            ? `/token/${token.tokenAddress}?chain=${viewChainId}`
            : null;
          const imageSource = getTokenCardImageSource(token.imageUrl);
          const preserveArtworkAspectRatio =
            imageSource === SHARD_ORIGINAL_ARTWORK_SOURCE;
          const eagerImage = !embedded && index < Math.min(pageSize, 4);
          const cardContent = (
            <>
              <div
                className={`${styles.runnerArt} ${
                  preserveArtworkAspectRatio ? styles.runnerArtPreserved : ""
                }`}
              >
                <Image
                  className={`${styles.runnerImage} ${
                    preserveArtworkAspectRatio
                      ? styles.runnerImagePreserved
                      : ""
                  }`}
                  src={imageSource}
                  alt={token.usesFallbackImage ? "" : `${token.name} artwork`}
                  fill
                  loading={eagerImage ? "eager" : "lazy"}
                  priority={eagerImage}
                  sizes={EXPLORE_CARD_IMAGE_SIZES}
                  unoptimized={
                    preserveArtworkAspectRatio ||
                    !canOptimizeTokenImage(imageSource)
                  }
                  referrerPolicy="no-referrer"
                  draggable={false}
                  onError={(event) => {
                    applyTokenImageFallback(
                      event.currentTarget,
                      getFallbackTokenImage(token.tokenAddress ?? token.id),
                    );
                  }}
                />
              </div>

              <div className={styles.runnerBody}>
                <header className={styles.runnerHeading}>
                  <h3 title={token.name}>{token.name}</h3>
                  {token.symbol ? <span>${token.symbol}</span> : null}
                </header>
              </div>
            </>
          );

          return (
            <article className={styles.runnerCard} key={token.id}>
              {href ? (
                <Link
                  className={styles.runnerHitArea}
                  href={href}
                  prefetch={false}
                  aria-label={`Open ${token.name}`}
                  onPointerEnter={() => router.prefetch(href)}
                  onFocus={() => router.prefetch(href)}
                >
                  {cardContent}
                </Link>
              ) : (
                <div className={styles.runnerHitArea}>{cardContent}</div>
              )}

              <div className={styles.runnerMeta}>
                <span className={styles.runnerCategory}>
                  <span className="sr-only">Launch type: </span>
                  {token.launchCategory}
                </span>
                {token.partnerAttribution ? (
                  <PartnerLaunchAttribution
                    attribution={token.partnerAttribution}
                    className={styles.runnerPartnerAttribution}
                    compact
                  />
                ) : null}
                {token.tokenAddress ? (
                  <div className={styles.runnerContract}>
                    <code title={token.tokenAddress}>
                      {formatExploreContractAddress(token.tokenAddress)}
                    </code>
                    <button
                      className={styles.runnerCopyButton}
                      type="button"
                      aria-label={
                        copiedTokenId === token.id
                          ? `${token.name} contract address copied`
                          : `Copy ${token.name} contract address`
                      }
                      title={
                        copiedTokenId === token.id
                          ? "Copied"
                          : "Copy contract address"
                      }
                      data-state={
                        copiedTokenId === token.id ? "copied" : undefined
                      }
                      onClick={() => void copyContractAddress(token)}
                    >
                      {copiedTokenId === token.id ? (
                        <Check aria-hidden="true" size={15} strokeWidth={2} />
                      ) : (
                        <Copy aria-hidden="true" size={14} strokeWidth={1.8} />
                      )}
                    </button>
                  </div>
                ) : null}
                {token.links.length > 0 ? (
                  <div
                    className={styles.runnerSocials}
                    role="group"
                    aria-label={`${token.name} links`}
                  >
                    {token.links.map((link) => {
                      const label = getTokenLinkLabel(link.kind);
                      return (
                        <a
                          className={styles.runnerSocialLink}
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`${token.name} ${label}`}
                          title={label}
                          key={`${link.kind}:${link.url}`}
                        >
                          <TokenLinkIcon kind={link.kind} />
                        </a>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    );
  }

  const Heading = embedded ? "h2" : "h1";
  const ResultsHeading = embedded ? "h3" : "h2";

  return (
    <div className={`${styles.page} explore-page page-width`}>
        <header className={styles.pageHeading}>
          <div className={styles.titleRow}>
            <Heading data-explore-heading>Explore</Heading>
          </div>
        </header>

        <section
          className={`${styles.runnersSection} token-section`}
          id="tokens"
          aria-busy={busy}
        >
          <div className={styles.runnersIntro}>
            {hasPublicTokens || !embedded ? (
              <div className="token-section-heading">
                <ResultsHeading className="sr-only">Launches</ResultsHeading>
                <div
                  className="token-toolbar"
                  inert={loadingOnly ? true : undefined}
                >
                  <div
                    className="token-search liquid-glass-control"
                    role="search"
                  >
                    <Search aria-hidden="true" size={17} />
                    <label className="sr-only" htmlFor="explore-token-search">
                      Search launches by name, ticker or contract address
                    </label>
                    <input
                      ref={searchInputRef}
                      id="explore-token-search"
                      type="search"
                      autoComplete="off"
                      spellCheck={false}
                      value={query}
                      placeholder="Name, ticker or address"
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    {query ? (
                      <button
                        className={styles.searchClear}
                        type="button"
                        aria-label="Clear launch search"
                        onClick={() => {
                          setQuery("");
                          setCurrentPage(1);
                          searchInputRef.current?.focus();
                        }}
                      >
                        <CloseIcon aria-hidden="true" size={15} />
                      </button>
                    ) : null}
                  </div>

                  {!embedded ? (
                    <div className={styles.chainControl}>
                      <ExploreChainSelector />
                    </div>
                  ) : null}

                  <details
                    className="token-filter"
                    ref={filterRef}
                    onBlur={(event) => {
                      const nextTarget = event.relatedTarget;
                      if (
                        !(nextTarget instanceof Node) ||
                        !event.currentTarget.contains(nextTarget)
                      ) {
                        event.currentTarget.removeAttribute("open");
                      }
                    }}
                  >
                    <summary
                      className="liquid-glass-control"
                      aria-controls="explore-filter-panel"
                      aria-label={`Filters. ${activeSelectionSummary}. ${activeFilterCount} ${
                        activeFilterCount === 1 ? "selection" : "selections"
                      } active.`}
                    >
                      <span>Filters</span>
                      {activeFilterCount > 0 ? (
                        <span
                          className={styles.activeFilterCount}
                          aria-hidden="true"
                        >
                          {activeFilterCount}
                        </span>
                      ) : null}
                      <ChevronDown
                        className="token-filter-chevron"
                        aria-hidden="true"
                        size={15}
                      />
                    </summary>
                    <div
                      id="explore-filter-panel"
                      className={`token-filter-menu ${styles.filterMenu} liquid-glass-surface liquid-glass-popover`}
                      role="group"
                      aria-label="Filter and sort launches"
                    >
                      <div
                        className={styles.filterGroup}
                        role="group"
                        aria-labelledby="explore-model-label"
                      >
                        <p className={styles.filterLabel} id="explore-model-label">
                          Launch type
                        </p>
                        {modelFilterOptions.map((option) => (
                          <button
                            key={option.id}
                            className={
                              modelFilter === option.id ? "active" : undefined
                            }
                            type="button"
                            aria-pressed={modelFilter === option.id}
                            onClick={() => {
                              updateModelFilter(
                                modelFilter === option.id ? "all" : option.id,
                              );
                            }}
                          >
                            <span>{option.label}</span>
                            {modelFilter === option.id ? (
                              <Check aria-hidden="true" size={15} />
                            ) : null}
                          </button>
                        ))}
                      </div>

                      <div
                        className={styles.filterGroup}
                        role="group"
                        aria-labelledby="explore-age-label"
                      >
                        <p className={styles.filterLabel} id="explore-age-label">
                          Age
                        </p>
                        {ageSortOptions.map((option) => (
                          <button
                            key={option.id}
                            className={
                              ageSortForChain === option.id
                                ? "active"
                                : undefined
                            }
                            type="button"
                            aria-label={viewChainId === 4663 &&
                                option.id === "oldest"
                              ? "Oldest is available on Ethereum only"
                              : option.label}
                            aria-pressed={ageSortForChain === option.id}
                            disabled={viewChainId === 4663 &&
                              option.id === "oldest"}
                            onClick={() => {
                              setAgeSort((current) =>
                                current === option.id ? "none" : option.id,
                              );
                              if (viewChainId === 1) {
                                setDiscoverySort("none");
                              }
                              setCurrentPage(1);
                            }}
                          >
                            <span>{option.label}</span>
                            {ageSortForChain === option.id ? (
                              <Check aria-hidden="true" size={15} />
                            ) : null}
                          </button>
                        ))}
                      </div>

                      <div
                        className={styles.filterGroup}
                        role="group"
                        aria-labelledby="explore-socials-label"
                      >
                        <p
                          className={styles.filterLabel}
                          id="explore-socials-label"
                        >
                          Social links
                        </p>
                        {socialFilterOptions.map((option) => (
                          <button
                            key={option.id}
                            className={
                              socialFilter === option.id ? "active" : undefined
                            }
                            type="button"
                            aria-pressed={socialFilter === option.id}
                            onClick={() => {
                              setSocialFilter((current) =>
                                current === option.id ? "all" : option.id,
                              );
                              setCurrentPage(1);
                            }}
                          >
                            <span>{option.label}</span>
                            {socialFilter === option.id ? (
                              <Check aria-hidden="true" size={15} />
                            ) : null}
                          </button>
                        ))}
                      </div>

                    </div>
                  </details>

                  {showPagination ? (
                    <nav
                      className={`token-pagination liquid-glass-control ${
                        paginationGeometryPending
                          ? styles.viewportPendingPagination
                          : ""
                      } ${
                        mobileOnlyPaginationPlaceholder
                          ? styles.mobileOnlyPaginationPlaceholder
                          : ""
                      }`}
                      aria-label="Launch pages"
                      aria-busy={paginationGeometryPending || undefined}
                    >
                      <button
                        type="button"
                        aria-label="Previous launch page"
                        aria-disabled={
                          activePage === 1 || busy || paginationGeometryPending
                        }
                        disabled={
                          activePage === 1 || busy || paginationGeometryPending
                        }
                        onClick={() => {
                          if (busy) return;
                          setCurrentPage((page) => Math.max(1, page - 1));
                        }}
                      >
                        <ChevronLeft aria-hidden="true" size={15} />
                      </button>

                      <span className="token-pagination-pages" aria-live="polite">
                        {activePage} / {pageCount}
                      </span>

                      <button
                        type="button"
                        aria-label="Next launch page"
                        aria-disabled={
                          activePage === pageCount ||
                          busy ||
                          paginationGeometryPending
                        }
                        disabled={
                          activePage === pageCount ||
                          busy ||
                          paginationGeometryPending
                        }
                        onClick={() => {
                          if (busy) return;
                          setCurrentPage((page) =>
                            Math.min(pageCount, page + 1),
                          );
                        }}
                      >
                        <ChevronRight aria-hidden="true" size={15} />
                      </button>
                    </nav>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <p
            ref={resultStatusRef}
            className="sr-only"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            tabIndex={-1}
          >
            {resultLabel}
          </p>

          <p className="sr-only" role="status" aria-live="polite">
            {copyFeedback}
          </p>

          {renderTokenState()}
        </section>
    </div>
  );
}
