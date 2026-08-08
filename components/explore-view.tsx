"use client";

import Image from "next/image";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Search,
  SlidersHorizontal,
  X as CloseIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  formatMarketCapMetric,
  type MarketCapMetric,
} from "@/components/animated-market-cap";
import { XBrandIcon } from "@/components/brand-icons";
import { EXPLORE_PREVIEW_TOKENS } from "@/components/explore-preview-data";
import { useInterfacePreview } from "@/components/interface-preview";
import { SiteFooter } from "@/components/site-footer";
import {
  shouldRefreshLiveData,
  useLiveDataRefresh,
} from "@/components/use-live-data-refresh";
import { WebsiteLinkIcon } from "@/components/website-link-icon";
import { parseDiscoverableMarketTradeCapabilityV1 } from
  "@/lib/custom-launch/trade-capability-v1";
import {
  canOptimizeTokenImage,
  getTokenCardImageSource,
} from "@/lib/token-image";
import {
  type ExploreEntry,
  type LauncherToken,
  type TokenLink,
} from "@/lib/tokens";
import styles from "./explore-experience.module.css";

type TokenCard = {
  id: string;
  name: string;
  description?: string;
  imageUrl: string;
  links: readonly TokenLink[];
  marketCap?: MarketCapMetric;
  marketStatus?: "No market";
  usesFallbackImage: boolean;
  tokenAddress?: `0x${string}`;
  launchCategory: "Classic" | "Custom";
};

export function exploreMarketStatusLabel(
  entry: ExploreEntry,
): "No market" | undefined {
  return entry.exploreKind === "custom-project" && entry.markets.length === 0
    ? "No market"
    : undefined;
}

type TokenSort = "newest" | "oldest" | "market-cap" | "market-cap-asc";
export type ExploreSocialFilter = "all" | "yes" | "no";
export type ExploreModelFilter = "all" | "classic" | "custom-hook";

type ExplorePayload = {
  status: "ready" | "not-deployed";
  tokens: ExploreEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

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
      refreshError?: string;
    };

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
        refreshError: input.message,
      }
    : {
        phase: "error",
        contentKey: input.contentKey,
        requestKey: input.requestKey,
        message: input.message,
      };
}

type PaginationItem = number | "start-gap" | "end-gap";

export const EXPLORE_TOKENS_PER_PAGE = 9;
export const EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE = 100;
const QUERY_DEBOUNCE_MS = 200;
const EXPLORE_REQUEST_TIMEOUT_MS = 12_000;
export const EXPLORE_REFRESH_INTERVAL_MS = 30_000;
const EXPLORE_MODEL_DATASET_REFRESH_TICKS = 10;
const EXPLORE_MODEL_DATASET_CACHE_TTL_MS =
  EXPLORE_REFRESH_INTERVAL_MS * (EXPLORE_MODEL_DATASET_REFRESH_TICKS - 1);
const fallbackTokenImages = [
  "/brand/programmable-token-fallback-01-dawn.webp",
  "/brand/programmable-token-fallback-02-moon.webp",
  "/brand/programmable-token-fallback-03-sun.webp",
  "/brand/programmable-token-fallback-04-mint.webp",
  "/brand/programmable-token-fallback-05-lavender.webp",
  "/brand/programmable-token-fallback-06-dusk.webp",
] as const;
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
  { id: "custom-hook", label: "Custom" },
];
const tokenLinkOrder: Record<TokenLink["kind"], number> = {
  website: 0,
  x: 1,
  telegram: 2,
};

function launchBlockNumber(token: LauncherToken) {
  return token.launchBlockNumber && /^\d+$/.test(token.launchBlockNumber)
    ? BigInt(token.launchBlockNumber)
    : 0n;
}

function comparePreviewLaunchOrder(
  left: LauncherToken,
  right: LauncherToken,
) {
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

export function shouldRefreshExplore(input: {
  visibilityState: DocumentVisibilityState;
  lastRefreshAt: number;
  now: number;
}) {
  return shouldRefreshLiveData({
    ...input,
    intervalMs: EXPLORE_REFRESH_INTERVAL_MS,
  });
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

function safeImageUrl(value: unknown) {
  if (typeof value !== "string") return undefined;

  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.hostname
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function parseTokenLink(value: unknown): TokenLink | null {
  if (!isRecord(value)) return null;
  if (
    value.kind !== "website" &&
    value.kind !== "x" &&
    value.kind !== "telegram"
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
    typeof value.totalSwapFeeBps !== "number" ||
    !Number.isSafeInteger(value.totalSwapFeeBps) ||
    value.totalSwapFeeBps < 0 ||
    value.liquidityPath !== "meme"
  ) {
    return null;
  }

  const links = Array.isArray(value.links)
    ? value.links
        .map(parseTokenLink)
        .filter((link): link is TokenLink => link !== null)
    : [];

  return {
    ...(value as unknown as LauncherToken),
    links,
    description:
      typeof value.description === "string" ? value.description : undefined,
    imageUrl: safeImageUrl(value.imageUrl),
  };
}

function parseLaunchCategoryProvenance(
  value: unknown,
  category: "classic" | "custom",
) {
  if (!isRecord(value)
    || value.schemaVersion !== "programmable.explore-launch-category-provenance.v1"
    || value.category !== category) return null;
  if (category === "classic") {
    return value.source === "canonical-launch-read-model"
      && typeof value.recordId === "string"
      && (typeof value.modelId === "string" || value.modelId === null)
      && (typeof value.modelVersion === "string" || value.modelVersion === null)
      ? value
      : null;
  }
  const baseValid = isSha256(value.projectId)
    && isSha256(value.launchId)
    && isSha256(value.sourceRecordBindingHash)
    && isSha256(value.finalizedLaunchBindingHash);
  if (!baseValid) return null;
  if (value.source === "interface-preview") return value;
  return value.source === "registry.custom-launched"
    && isTokenAddress(value.registryAddress)
    && typeof value.registryStartBlock === "string"
    && /^[1-9][0-9]*$/u.test(value.registryStartBlock)
    && isBytes32(value.transactionHash)
    && isBytes32(value.blockHash)
    && typeof value.blockNumber === "string"
    && /^[1-9][0-9]*$/u.test(value.blockNumber)
    && Number.isSafeInteger(value.transactionIndex)
    && Number(value.transactionIndex) >= 0
    && Number.isSafeInteger(value.logIndex)
    && Number(value.logIndex) >= 0
    && isBytes32(value.configurationHash)
    ? value : null;
}

function isSha256(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function parseCustomExploreAsset(value: unknown) {
  if (!isRecord(value)
    || typeof value.assetId !== "string"
    || !isRecord(value.identity)
    || typeof value.identity.namespace !== "string"
    || typeof value.identity.value !== "string"
    || (value.decimals !== undefined && (!Number.isSafeInteger(value.decimals)
      || Number(value.decimals) < 0 || Number(value.decimals) > 255))) return null;
  return {
    assetId: value.assetId,
    identity: {
      namespace: value.identity.namespace,
      value: value.identity.value,
    },
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(typeof value.symbol === "string" ? { symbol: value.symbol } : {}),
    ...(value.decimals === undefined ? {} : { decimals: Number(value.decimals) }),
  };
}

function parseCustomExploreMarkets(value: unknown, chainId: string) {
  if (!Array.isArray(value) || value.length > 256) return null;
  type CustomMarket = Extract<ExploreEntry, { exploreKind: "custom-project" }>["markets"][number];
  const markets: CustomMarket[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)
      || typeof candidate.marketId !== "string"
      || typeof candidate.kind !== "string"
      || !["active", "paused", "closed", "verification_pending"].includes(
        String(candidate.status),
      )
      || (candidate.poolId !== undefined && !isBytes32(candidate.poolId))) return null;
    const baseAsset = parseCustomExploreAsset(candidate.baseAsset);
    const quoteAsset = parseCustomExploreAsset(candidate.quoteAsset);
    if (baseAsset === null || quoteAsset === null) return null;
    const capability = candidate.tradeCapability === undefined
      ? undefined
      : parseDiscoverableMarketTradeCapabilityV1({
          value: candidate.tradeCapability,
          chainId,
          marketId: candidate.marketId,
          baseAssetId: baseAsset.assetId,
          quoteAssetId: quoteAsset.assetId,
          ...(candidate.poolId === undefined ? {} : { poolId: candidate.poolId }),
        });
    if (candidate.tradeCapability !== undefined && capability === null) return null;
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
  if (!isRecord(value)
    || value.exploreKind !== "custom-project"
    || typeof value.id !== "string"
    || typeof value.name !== "string"
    || typeof value.launchedAt !== "string"
    || typeof value.finalizedAt !== "string"
    || typeof value.chainId !== "string"
    || typeof value.modelId !== "string"
    || !isSha256(value.customProjectId)
    || !isSha256(value.customLaunchId)
    || !isRecord(value.launchingWallet)
    || typeof value.launchingWallet.namespace !== "string"
    || typeof value.launchingWallet.value !== "string"
    || !/^eip155:[1-9][0-9]*$/u.test(value.launchingWallet.namespace)
    || !/^0x[0-9a-f]{40}$/u.test(value.launchingWallet.value)
    || !isSha256(value.postLaunchAuthorityInventoryHash)
    || !isRecord(value.postLaunchAuthorityInventory)
    || value.postLaunchAuthorityInventory.schemaVersion
      !== "programmable.post-launch-authority-inventory.v1"
    || value.postLaunchAuthorityInventory.postLaunchAuthorityInventoryHash
      !== value.postLaunchAuthorityInventoryHash
    || value.postLaunchAuthorityInventory.githubAuthority
      !== "provenance-only-never-post-launch-authority"
    || !Array.isArray(value.postLaunchAuthorityInventory.postLaunchAuthorities)
    || !Array.isArray(value.markets)
    || !Array.isArray(value.links)
    || parseLaunchCategoryProvenance(
      value.launchCategoryProvenance,
      "custom",
    ) === null
  ) return null;
  const links = value.links.map(parseTokenLink);
  if (links.some((link) => link === null)) return null;
  if (value.tokenAddress !== undefined && !isTokenAddress(value.tokenAddress)) {
    return null;
  }
  if (value.tokenDecimals !== undefined && (
    !Number.isSafeInteger(value.tokenDecimals)
    || Number(value.tokenDecimals) < 0
    || Number(value.tokenDecimals) > 255
  )) return null;
  const markets = parseCustomExploreMarkets(value.markets, value.chainId);
  if (markets === null) return null;
  return {
    exploreKind: "custom-project",
    id: value.id,
    name: value.name,
    ...(typeof value.symbol === "string" ? { symbol: value.symbol } : {}),
    ...(typeof value.description === "string"
      ? { description: value.description }
      : {}),
    ...(safeImageUrl(value.imageUrl) ? { imageUrl: value.imageUrl as string } : {}),
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
    ...(value.tokenAddress === undefined ? {} : { tokenAddress: value.tokenAddress }),
    ...(value.tokenDecimals === undefined ? {} : { tokenDecimals: value.tokenDecimals as number }),
    launchCategoryProvenance: value.launchCategoryProvenance as Extract<
      ExploreEntry,
      { exploreKind: "custom-project" }
    >["launchCategoryProvenance"],
  };
}

function parseExploreEntry(value: unknown): ExploreEntry | null {
  if (isRecord(value) && value.exploreKind === "custom-project") {
    return parseCustomExploreEntry(value);
  }
  const token = parseLauncherToken(value);
  if (!token || !isRecord(value)
    || value.exploreKind !== "token"
    || parseLaunchCategoryProvenance(
      value.launchCategoryProvenance,
      "classic",
    ) === null) return null;
  return {
    ...token,
    exploreKind: "token",
    launchCategoryProvenance: value.launchCategoryProvenance as Extract<
      ExploreEntry,
      { exploreKind: "token" }
    >["launchCategoryProvenance"],
  };
}

function positiveInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : fallback;
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

  const tokens = value.tokens.map(parseExploreEntry);
  if (tokens.some((token) => token === null)) {
    throw new Error("The token registry returned an invalid token record");
  }

  return {
    status: value.status,
    tokens: tokens as ExploreEntry[],
    page: Math.max(1, positiveInteger(value.page, 1)),
    pageSize: Math.max(
      1,
      positiveInteger(value.pageSize, EXPLORE_TOKENS_PER_PAGE),
    ),
    total: positiveInteger(value.total, tokens.length),
    totalPages: positiveInteger(value.totalPages, 0),
  };
}

function readApiError(value: unknown) {
  return isRecord(value) && typeof value.error === "string"
    ? value.error
    : "Tokens are temporarily unavailable";
}

type PendingExploreRequest = {
  controller: AbortController;
  promise: Promise<ExplorePayload>;
};

const pendingExploreRequests = new Map<string, PendingExploreRequest>();
const resolvedExplorePayloads = new Map<
  string,
  Readonly<{ payload: ExplorePayload; updatedAt: number }>
>();
const RESOLVED_EXPLORE_PAYLOAD_TTL_MS = 4_500;
const MAX_RESOLVED_EXPLORE_PAYLOADS = 24;

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
) {
  resolvedExplorePayloads.delete(contentKey);
  resolvedExplorePayloads.set(contentKey, {
    payload,
    updatedAt: Date.now(),
  });
  while (resolvedExplorePayloads.size > MAX_RESOLVED_EXPLORE_PAYLOADS) {
    const oldestKey = resolvedExplorePayloads.keys().next().value;
    if (oldestKey === undefined) return;
    resolvedExplorePayloads.delete(oldestKey);
  }
}

async function fetchExplorePayload(
  search: URLSearchParams,
  signal: AbortSignal,
) {
  const response = await fetch(`/api/explore?${search.toString()}`, {
    headers: { Accept: "application/json" },
    signal,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(readApiError(body));
  }
  return parseExplorePayload(body);
}

export function loadExplorePayload(
  contentKey: string,
  search: URLSearchParams,
) {
  const resolved = readResolvedExplorePayload(contentKey);
  if (resolved) return Promise.resolve(resolved);
  const pendingRequest = pendingExploreRequests.get(contentKey);
  if (pendingRequest) return pendingRequest.promise;

  const controller = new AbortController();
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, EXPLORE_REQUEST_TIMEOUT_MS);
  const request = (async (): Promise<ExplorePayload> => {
    try {
      const payload = await fetchExplorePayload(search, controller.signal);
      cacheResolvedExplorePayload(contentKey, payload);
      return payload;
    } catch (error) {
      if (timedOut) {
        throw new Error("Tokens took too long to respond");
      }
      throw error;
    } finally {
      globalThis.clearTimeout(timeout);
    }
  })();

  const entry = { controller, promise: request };
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

export async function loadExploreModelDataset(
  contentKey: string,
  search: URLSearchParams,
) {
  const firstPageSearch = new URLSearchParams(search);
  firstPageSearch.set("page", "1");
  firstPageSearch.set(
    "limit",
    String(EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE),
  );
  const firstPage = await loadExplorePayload(
    `${contentKey}\u0000model-page:1`,
    firstPageSearch,
  );
  if (firstPage.totalPages <= 1) {
    return firstPage;
  }

  const remainingPages = await Promise.all(
    Array.from({ length: firstPage.totalPages - 1 }, async (_, index) => {
      const page = index + 2;
      const pageSearch = new URLSearchParams(firstPageSearch);
      pageSearch.set("page", String(page));
      const payload = await loadExplorePayload(
        `${contentKey}\u0000model-page:${page}`,
        pageSearch,
      );
      if (
        payload.status !== firstPage.status ||
        payload.page !== page ||
        payload.pageSize !== firstPage.pageSize ||
        payload.total !== firstPage.total ||
        payload.totalPages !== firstPage.totalPages
      ) {
        throw new Error("Tokens changed while filters were loading");
      }
      return payload;
    }),
  );

  return {
    ...firstPage,
    tokens: [firstPage, ...remainingPages].flatMap(
      (payload) => payload.tokens,
    ),
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

export function filterTokensByLaunchModel(
  tokens: ExploreEntry[],
  modelFilter: ExploreModelFilter,
) {
  if (modelFilter === "all") return tokens;
  return tokens.filter(
    (token) => tokenLaunchModelGroup(token) === modelFilter,
  );
}

export function paginateTokensByExploreFilters(
  tokens: ExploreEntry[],
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

function getFallbackTokenImage(address: string) {
  const suffix = Number.parseInt(address.slice(-8), 16);
  const index = Number.isFinite(suffix)
    ? suffix % fallbackTokenImages.length
    : 0;
  return fallbackTokenImages[index];
}

export function getMarketCap(
  token: ExploreEntry,
): MarketCapMetric | undefined {
  if (token.exploreKind !== "token") return undefined;
  if (
    token.indexedMarketCapUsdWad &&
    /^\d+$/.test(token.indexedMarketCapUsdWad)
  ) {
    const value = Number(BigInt(token.indexedMarketCapUsdWad)) / 1e18;
    if (Number.isFinite(value) && value > 0) {
      return { kind: "usd", value };
    }
  }

  if (token.fdvUsdWad && /^\d+$/.test(token.fdvUsdWad)) {
    const value = Number(BigInt(token.fdvUsdWad)) / 1e18;
    if (Number.isFinite(value) && value > 0) {
      return { kind: "usd", value };
    }
  }

  if (
    token.marketCapQuote &&
    token.quoteAssetSymbol &&
    /^\d+(?:\.\d+)?$/.test(token.marketCapQuote)
  ) {
    const value = Number(token.marketCapQuote);
    if (Number.isFinite(value) && value >= 0) {
      return {
        kind: "quote",
        symbol: token.quoteAssetSymbol,
        value,
      };
    }
  }

  const marketCapEth = token.indexedMarketCapEth ?? token.marketCapEth;
  if (!marketCapEth) return undefined;
  const value = Number(marketCapEth);
  if (!Number.isFinite(value) || value < 0) return undefined;

  return { kind: "eth", value };
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
    return [
      1,
      "start-gap",
      pageCount - 2,
      pageCount - 1,
      pageCount,
    ];
  }

  return [
    1,
    "start-gap",
    currentPage,
    "end-gap",
    pageCount,
  ];
}

export function tokenHasSocialLinks(
  token: Readonly<{ links?: readonly TokenLink[] }>,
) {
  return Boolean(
    token.links?.some(
      (link) => link.kind === "x" || link.kind === "telegram",
    ),
  );
}

export function filterTokensBySocialPresence<
  T extends Readonly<{ links?: readonly TokenLink[] }>,
>(
  tokens: T[],
  socialFilter: ExploreSocialFilter,
) {
  if (socialFilter === "all") return tokens;
  const shouldHaveSocials = socialFilter === "yes";
  return tokens.filter(
    (token) => tokenHasSocialLinks(token) === shouldHaveSocials,
  );
}

export function getTokenCards(tokens: ExploreEntry[]): TokenCard[] {
  return tokens.map((token) => ({
    id: token.id,
    name: token.name,
    description: token.description?.trim() || undefined,
    imageUrl:
      token.imageUrl?.trim() || getFallbackTokenImage(
        token.tokenAddress ?? token.id,
      ),
    links: [...(token.links ?? [])].sort(
      (left, right) => tokenLinkOrder[left.kind] - tokenLinkOrder[right.kind],
    ),
    marketCap: getMarketCap(token),
    marketStatus: exploreMarketStatusLabel(token),
    usesFallbackImage: !token.imageUrl?.trim(),
    ...(token.tokenAddress === undefined
      ? {}
      : { tokenAddress: token.tokenAddress }),
    launchCategory:
      token.launchCategoryProvenance.category === "classic"
        ? "Classic"
        : "Custom",
  }));
}

function getTokenLinkLabel(kind: TokenLink["kind"]) {
  if (kind === "website") return "Website";
  if (kind === "telegram") return "Telegram";
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
  return <XBrandIcon />;
}

const exploreSkeletonItems = Array.from(
  { length: EXPLORE_TOKENS_PER_PAGE },
  (_, index) => index,
);

function ExploreGridSkeleton() {
  return (
    <div
      className={`${styles.runnerGrid} ${styles.skeletonGrid}`}
      aria-hidden="true"
    >
      {exploreSkeletonItems.map((index) => (
        <article
          className={`${styles.runnerCard} ${styles.skeletonCard}`}
          key={index}
        >
          <div className={`${styles.runnerArt} ${styles.skeletonArt}`} />
          <div className={styles.skeletonBody}>
            <span className={styles.skeletonTitle} />
            <span className={styles.skeletonDescription} />
            <span className={styles.skeletonMeta} />
          </div>
        </article>
      ))}
    </div>
  );
}

function resultRangeLabel(payload: ExplorePayload | null) {
  if (!payload) return "Loading launch index";
  if (payload.status === "not-deployed") return "Explore unavailable";
  if (payload.total === 0) return "0 launches";

  const start = (payload.page - 1) * payload.pageSize + 1;
  const end = Math.min(payload.total, start + payload.tokens.length - 1);
  return `${start}–${end} of ${payload.total} ${
    payload.total === 1 ? "launch" : "launches"
  }`;
}

export function ExploreView({
  initialModelFilter = "all",
}: Readonly<{
  initialModelFilter?: ExploreModelFilter;
}>) {
  const preview = useInterfacePreview();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim();
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sort, setSort] = useState<TokenSort>("market-cap");
  const [socialFilter, setSocialFilter] =
    useState<ExploreSocialFilter>("all");
  const [modelFilter, setModelFilter] =
    useState<ExploreModelFilter>(initialModelFilter);
  const [currentPage, setCurrentPage] = useState(1);
  const [retryKey, setRetryKey] = useState(0);
  const refreshKey = useLiveDataRefresh({
    enabled: !preview,
    intervalMs: EXPLORE_REFRESH_INTERVAL_MS,
  });
  const activeExploreContentKey = useRef<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resultStatusRef = useRef<HTMLParagraphElement>(null);
  const modelDatasetCache = useRef<{
    key: string;
    payload: ExplorePayload;
    updatedAt: number;
  } | null>(null);
  const filterRef = useRef<HTMLDetailsElement>(null);
  const contentKey = `${debouncedQuery}\u0000${sort}\u0000${socialFilter}\u0000${modelFilter}\u0000${currentPage}`;
  const modelDatasetKey = `${debouncedQuery}\u0000${sort}\u0000${socialFilter}`;
  const modelDatasetRefreshKey = Math.floor(
    refreshKey / EXPLORE_MODEL_DATASET_REFRESH_TICKS,
  );
  const requestKey =
    modelFilter === "all"
      ? `${contentKey}\u0000${retryKey}\u0000${refreshKey}`
      : `${contentKey}\u0000${retryKey}\u0000${modelDatasetRefreshKey}`;
  const activeRequestContentKey =
    modelFilter === "all"
      ? contentKey
      : `${modelDatasetKey}\u0000model-dataset`;
  const [state, setState] = useState<ExploreState>(() => {
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
    },
    [],
  );

  useEffect(() => {
    if (normalizedQuery === debouncedQuery) return;

    const timer = window.setTimeout(() => {
      setCurrentPage(1);
      setDebouncedQuery(normalizedQuery);
    }, QUERY_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [debouncedQuery, normalizedQuery]);

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
    if (preview) return;

    let ignore = false;
    const previousContentKey = activeExploreContentKey.current;
    if (previousContentKey && previousContentKey !== activeRequestContentKey) {
      abortExplorePayload(previousContentKey);
    }
    activeExploreContentKey.current = activeRequestContentKey;
    const search = new URLSearchParams({
      q: debouncedQuery,
      sort,
      page: String(currentPage),
      limit: String(EXPLORE_TOKENS_PER_PAGE),
    });
    if (socialFilter !== "all") {
      search.set("socials", socialFilter);
    }

    async function loadTokens() {
      try {
        let payload: ExplorePayload;
        if (modelFilter === "all") {
          payload = await loadExplorePayload(activeRequestContentKey, search);
        } else {
          const cachedDataset = modelDatasetCache.current;
          let dataset =
            cachedDataset?.key === modelDatasetKey &&
            Date.now() - cachedDataset.updatedAt <
              EXPLORE_MODEL_DATASET_CACHE_TTL_MS
              ? cachedDataset.payload
              : null;
          if (!dataset) {
            dataset = await loadExploreModelDataset(
              activeRequestContentKey,
              search,
            );
            if (ignore) return;
            modelDatasetCache.current = {
              key: modelDatasetKey,
              payload: dataset,
              updatedAt: Date.now(),
            };
          }
          payload = {
            status: dataset.status,
            ...paginateTokensByExploreFilters(
              dataset.tokens,
              "all",
              modelFilter,
              currentPage,
            ),
          };
        }
        if (ignore) return;
        if (payload.page !== currentPage) {
          setCurrentPage(payload.page);
        }
        setState({
          phase: "ready",
          payload,
          requestKey,
          contentKey,
        });
      } catch (error) {
        if (ignore) return;
        const message =
          error instanceof Error
            ? error.message
            : "Tokens are temporarily unavailable";
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
    preview,
    requestKey,
    socialFilter,
    sort,
  ]);

  const previewPayload = useMemo<ExplorePayload>(() => {
    const searchValue = debouncedQuery.toLowerCase();
    const filtered = EXPLORE_PREVIEW_TOKENS.filter((token) =>
      [token.name, token.symbol, token.tokenAddress].some((value) =>
        value.toLowerCase().includes(searchValue),
      ),
    );
    const ranked = [...filtered].sort((left, right) => {
      if (sort === "newest" || sort === "oldest") {
        const launchComparison = comparePreviewLaunchOrder(left, right);
        return sort === "newest" ? -launchComparison : launchComparison;
      }
      const leftMarketCap = BigInt(left.indexedMarketCapUsdWad ?? "0");
      const rightMarketCap = BigInt(right.indexedMarketCapUsdWad ?? "0");
      const delta =
        leftMarketCap === rightMarketCap
          ? 0
          : leftMarketCap > rightMarketCap
            ? -1
            : 1;
      return sort === "market-cap" ? delta : -delta;
    });

    const paginated = paginateTokensByExploreFilters(
      ranked,
      socialFilter,
      modelFilter,
      currentPage,
    );

    return {
      status: "ready",
      ...paginated,
    };
  }, [currentPage, debouncedQuery, modelFilter, socialFilter, sort]);

  const displayState: ExploreState = preview
    ? {
        phase: "ready",
        payload: previewPayload,
        requestKey,
        contentKey,
      }
    : state;

  const payload =
    displayState.phase === "ready" ? displayState.payload : null;
  const cards = useMemo(
    () => getTokenCards(payload?.tokens ?? []),
    [payload?.tokens],
  );
  const pageCount = Math.max(1, payload?.totalPages ?? 0);
  const activePage = Math.min(payload?.page ?? currentPage, pageCount);
  const paginationItems = getExplorePaginationItems(activePage, pageCount);
  const resultLabel =
    displayState.phase === "error" ? "" : resultRangeLabel(payload);
  const busy =
    !preview &&
    (displayState.phase === "loading" ||
      displayState.requestKey !== requestKey);
  const activeFilterCount =
    Number(socialFilter !== "all") + Number(modelFilter !== "all");
  const hasPublicTokens =
    displayState.phase !== "ready" ||
    displayState.payload.total > 0 ||
    Boolean(debouncedQuery) ||
    socialFilter !== "all" ||
    modelFilter !== "all";

  function retryTokens() {
    searchInputRef.current?.focus({ preventScroll: true });
    if (modelFilter !== "all") {
      modelDatasetCache.current = null;
    }
    setRetryKey((value) => value + 1);
  }

  const sortField =
    sort === "newest" || sort === "oldest" ? "launch-date" : "market-cap";
  const sortDirection =
    sort === "oldest" || sort === "market-cap-asc" ? "ascending" : "descending";

  function updateSort(
    field: "launch-date" | "market-cap",
    direction: "ascending" | "descending",
  ) {
    setSort(
      field === "launch-date"
        ? direction === "descending"
          ? "newest"
          : "oldest"
        : direction === "descending"
          ? "market-cap"
          : "market-cap-asc",
    );
    setCurrentPage(1);
  }

  function renderTokenState() {
    if (
      displayState.phase === "loading" ||
      (displayState.phase === "error" &&
        displayState.requestKey !== requestKey)
    ) {
      return (
        <div className={styles.loadingState}>
          <ExploreGridSkeleton />
        </div>
      );
    }

    if (displayState.phase === "error") {
      return (
        <div className={styles.messageState} role="alert">
          <p>{displayState.message}</p>
          <button
            className="text-button"
            type="button"
            onClick={retryTokens}
          >
            Try again
          </button>
        </div>
      );
    }

    if (displayState.payload.status === "not-deployed") {
      return (
        <div className={`${styles.emptyState} liquid-glass-surface`}>
          <div>
            <h2>Token index unavailable</h2>
            <p>Explore is not available in this environment.</p>
          </div>
        </div>
      );
    }

    if (cards.length === 0) {
      if (
        debouncedQuery ||
        socialFilter !== "all" ||
        modelFilter !== "all"
      ) {
        const hasActiveFilter =
          socialFilter !== "all" || modelFilter !== "all";
        const noMatchMessage = debouncedQuery
          ? hasActiveFilter
            ? "No tokens match this search and filters"
            : "No tokens match this search"
          : "No tokens match these filters";
        return (
          <div className={styles.messageState}>
            <p>{noMatchMessage}</p>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setQuery("");
                setSocialFilter("all");
                setModelFilter("all");
                setCurrentPage(1);
                searchInputRef.current?.focus();
              }}
            >
              Clear filters
            </button>
          </div>
        );
      }

      return (
        <div className={`${styles.emptyState} liquid-glass-surface`}>
          <div>
            <h2>No tokens yet</h2>
            <p>Create the first token.</p>
          </div>
          <Link className={styles.emptyAction} href="/launch">
            Create token
          </Link>
        </div>
      );
    }

    return (
      <div className={styles.runnerGrid}>
        {cards.map((token, index) => {
          const href = token.tokenAddress
            ? `/token/${token.tokenAddress}`
            : null;
          const imageSource = getTokenCardImageSource(token.imageUrl);
          const marketCapLabel = token.marketCap
            ? formatMarketCapMetric(token.marketCap)
            : null;
          const cardContent = (
            <>
              <div className={styles.runnerArt}>
                <Image
                  className={styles.runnerImage}
                  src={imageSource}
                  alt={token.usesFallbackImage ? "" : `${token.name} artwork`}
                  fill
                  loading={index < 3 ? "eager" : "lazy"}
                  priority={index < 3}
                  sizes="(max-width: 360px) 96px, (max-width: 420px) 104px, (max-width: 700px) 112px, (max-width: 768px) calc(50vw - 54px), (max-width: 900px) 330px, 313px"
                  unoptimized={!canOptimizeTokenImage(imageSource)}
                  draggable={false}
                />
              </div>

              <div className={styles.runnerBody}>
                <header className={styles.runnerHeading}>
                  <h3 title={token.name}>{token.name}</h3>
                </header>

                {token.description ? (
                  <p className={styles.runnerDescription}>
                    {token.description}
                  </p>
                ) : null}
              </div>
            </>
          );

          return (
            <article
              className={styles.runnerCard}
              key={token.id}
            >
              {href ? (
                <Link
                  className={styles.runnerHitArea}
                  href={href}
                  aria-label={`Open ${token.name}`}
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
                {marketCapLabel ? (
                  <span className={styles.runnerMarketCap}>
                    <span className="sr-only">Market cap: </span>
                    <span
                      className={styles.runnerMarketCapLabel}
                      aria-hidden="true"
                    >
                      MC
                    </span>
                    <span className={styles.runnerMarketCapValue}>
                      {marketCapLabel}
                    </span>
                  </span>
                ) : null}
                {token.marketStatus ? (
                  <span
                    className={styles.runnerMarketStatus}
                    aria-label="Market status No market"
                  >
                    {token.marketStatus}
                  </span>
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

  return (
    <>
      <div className={`${styles.page} explore-page page-width`}>
        <header className={styles.pageHeading}>
          <h1>Explore Projects</h1>
        </header>

        <section
          className={`${styles.runnersSection} token-section`}
          id="tokens"
          aria-busy={busy}
        >
          <div className={styles.runnersIntro}>
            {hasPublicTokens ? (
              <div className="token-section-heading">
                <h2 className="sr-only">Tokens</h2>
                <div className="token-toolbar">
                  <div
                    className="token-search liquid-glass-control"
                    role="search"
                  >
                    <Search aria-hidden="true" size={17} />
                    <label className="sr-only" htmlFor="explore-token-search">
                      Search tokens by name, ticker or contract address
                    </label>
                    <input
                      ref={searchInputRef}
                      id="explore-token-search"
                      type="search"
                      autoComplete="off"
                      spellCheck={false}
                      value={query}
                      placeholder="Search tokens"
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    {query ? (
                      <button
                        className={styles.searchClear}
                        type="button"
                        aria-label="Clear token search"
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
                      aria-label={
                        busy
                          ? "Filter and sort tokens, updating projects"
                          : activeFilterCount === 0
                          ? "Filter and sort tokens"
                          : `Filter and sort tokens, ${activeFilterCount} ${
                              activeFilterCount === 1 ? "filter" : "filters"
                            } active`
                      }
                    >
                      <SlidersHorizontal aria-hidden="true" size={16} />
                      <span>Filter</span>
                      {activeFilterCount > 0 ? (
                        <span
                          className={styles.activeFilterCount}
                          aria-hidden="true"
                        >
                          {activeFilterCount}
                        </span>
                      ) : null}
                      {busy ? (
                        <LoaderCircle
                          className={styles.filterSpinner}
                          aria-hidden="true"
                          size={15}
                        />
                      ) : (
                        <ChevronDown
                          className="token-filter-chevron"
                          aria-hidden="true"
                          size={15}
                        />
                      )}
                    </summary>
                    <div
                      id="explore-filter-panel"
                      className={`token-filter-menu ${styles.filterMenu} liquid-glass-surface liquid-glass-popover`}
                      role="group"
                      aria-label="Filter and sort tokens"
                    >
                      <div className={styles.filterGroup}>
                        <p
                          className={styles.filterLabel}
                          id="explore-sort-label"
                        >
                          Sort by
                        </p>
                        <div
                          className={styles.sortControls}
                          aria-labelledby="explore-sort-label"
                        >
                          <label className={styles.sortControl}>
                            <span>Field</span>
                            <select
                              value={sortField}
                              onChange={(event) =>
                                updateSort(
                                  event.target.value as
                                    | "launch-date"
                                    | "market-cap",
                                  sortDirection,
                                )
                              }
                            >
                              <option value="launch-date">Launch date</option>
                              <option value="market-cap">Market cap</option>
                            </select>
                          </label>
                          <label className={styles.sortControl}>
                            <span>Order</span>
                            <select
                              value={sortDirection}
                              onChange={(event) =>
                                updateSort(
                                  sortField,
                                  event.target.value as
                                    | "ascending"
                                    | "descending",
                                )
                              }
                            >
                              <option value="descending">
                                {sortField === "launch-date"
                                  ? "Newest first"
                                  : "Highest first"}
                              </option>
                              <option value="ascending">
                                {sortField === "launch-date"
                                  ? "Oldest first"
                                  : "Lowest first"}
                              </option>
                            </select>
                          </label>
                        </div>
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
                          Socials
                        </p>
                        {socialFilterOptions.map((option) => (
                          <button
                            key={option.id}
                            className={
                              socialFilter === option.id
                                ? "active"
                                : undefined
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

                      <div
                        className={styles.filterGroup}
                        role="group"
                        aria-labelledby="explore-model-label"
                      >
                        <p
                          className={styles.filterLabel}
                          id="explore-model-label"
                        >
                          Model
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
                              setModelFilter((current) =>
                                current === option.id ? "all" : option.id,
                              );
                              setCurrentPage(1);
                            }}
                          >
                            <span>{option.label}</span>
                            {modelFilter === option.id ? (
                              <Check aria-hidden="true" size={15} />
                            ) : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  </details>

                  {displayState.phase === "ready" &&
                  displayState.payload.status === "ready" &&
                  displayState.payload.total > 0 &&
                  pageCount > 1 ? (
                    <nav
                      className="token-pagination liquid-glass-control"
                      aria-label="Token pages"
                    >
                      <button
                        type="button"
                        aria-label="Previous token page"
                        aria-disabled={activePage === 1 || busy}
                        disabled={activePage === 1}
                        onClick={() => {
                          if (busy) return;
                          setCurrentPage((page) => Math.max(1, page - 1));
                        }}
                      >
                        <ChevronLeft aria-hidden="true" size={15} />
                      </button>

                      <div className="token-pagination-pages">
                        {paginationItems.map((item) =>
                          typeof item === "number" ? (
                            <button
                              key={item}
                              className={
                                activePage === item ? "active" : undefined
                              }
                              type="button"
                              aria-label={`Token page ${item}`}
                              aria-current={
                                activePage === item ? "page" : undefined
                              }
                              aria-disabled={busy}
                              onClick={() => {
                                if (busy) return;
                                setCurrentPage(item);
                              }}
                            >
                              {item}
                            </button>
                          ) : (
                            <span key={item} aria-hidden="true">
                              …
                            </span>
                          ),
                        )}
                      </div>

                      <button
                        type="button"
                        aria-label="Next token page"
                        aria-disabled={activePage === pageCount || busy}
                        disabled={activePage === pageCount}
                        onClick={() => {
                          if (busy) return;
                          setCurrentPage((page) =>
                            Math.min(pageCount, page + 1),
                          )
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

          {displayState.phase === "ready" &&
          displayState.refreshError ? (
            <div className="token-refresh-warning" role="status">
              <span>Prices may be out of date</span>
              <button
                type="button"
                onClick={retryTokens}
              >
                Refresh
              </button>
            </div>
          ) : null}

          {renderTokenState()}
        </section>
      </div>
      <SiteFooter />
    </>
  );
}
