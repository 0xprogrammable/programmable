"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  Check,
  Copy,
  ExternalLink,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatUnits,
  getAddress,
  isAddress,
} from "viem";

import type { PreparedTokenTrade } from "@/components/token-trade";
import {
  TokenPriceChart,
  type TokenChartVolume,
} from "@/components/token-price-chart";
import { TokenDetailShell } from "@/components/token-detail-shell";
import { TokenGmgnAnalytics } from "@/components/token-gmgn-analytics";
import { PartnerLaunchAttribution } from
  "@/components/partner-launch-attribution";
import { CreatorArticle } from "@/components/creator-article";
import { CreatorArticleEditAction } from
  "@/components/creator-article-edit-action";
import {
  DiscordBrandIcon,
  GitHubBrandIcon,
} from "@/components/brand-icons";
import {
  getExplorePreviewCreatorArticle,
  getExplorePreviewCustomProject,
  getExplorePreviewToken,
} from "@/components/explore-preview-data";
import { useInterfacePreview } from "@/components/interface-preview";
import { useLiveDataRefresh } from "@/components/use-live-data-refresh";
import { WebsiteLinkIcon } from "@/components/website-link-icon";
import { useWallet } from "@/components/wallet-provider";
import { parseDiscoverableMarketTradeCapabilityV1 } from
  "@/lib/custom-launch/trade-capability-v1";
import {
  exploreValuation,
  isExploreValuation,
  type ExploreValuation,
} from "@/lib/explore-financial-data";
import {
  isTokenMarketDataV1,
  type TokenMarketDataV1,
} from "@/lib/market-data/market-data-v1";
import {
  isGmgnMarketSnapshotForExploreEntryV1,
  isGmgnMarketSnapshotV1,
  type GmgnMarketSnapshotV1,
} from "@/lib/market-data/gmgn-market-data-v1";
import {
  applyTokenImageFallback,
  canOptimizeTokenImage,
  getTokenCardImageSource,
} from "@/lib/token-image";
import { safePublicImageUrl } from "@/lib/safe-public-image-url";
import {
  isLaunchStampProvenanceV1,
  isPlatformFeePolicyReadbackV2,
  type CanonicalTokenExploreEntry,
  type CustomProjectExploreEntry,
  type LauncherToken,
  type TokenLink,
  type TokenLinkKind,
} from "@/lib/tokens";
import {
  parseCreatorArticleV1,
  type CreatorArticleV1,
} from "@/lib/creator-article/contract-v1";
import { PROGRAMMABLE_MAIN_TOKEN_ADDRESS } from
  "@/lib/creator-article/programmable-example-v1";
import { PROGRAMMABLE_MAIN_TOKEN_PRESENTATION } from
  "@/lib/programmable-main-token-presentation";
import type { ViewChainId } from "@/lib/view-chain";
import type { PostLaunchAuthorityInventoryV1 } from "@/lib/custom-launch/contract-v2";
import { parseLaunchPartnerAttributionV1 } from
  "@/lib/launch-partner-attribution";
import {
  parsePlatformFeeCertificationV1,
  platformFeeCertificationForTokenV1,
  type PlatformFeeCertificationV1,
} from "@/lib/platform-fee-certification";
import styles from "./token-experience.module.css";

type DetailToken = CanonicalTokenExploreEntry & Readonly<{
  valuation: ExploreValuation;
  marketData?: TokenMarketDataV1;
  gmgnMarketData?: GmgnMarketSnapshotV1;
}>;

type DetailCustomProject = CustomProjectExploreEntry & Readonly<{
  valuation?: ExploreValuation;
  marketData?: TokenMarketDataV1;
  gmgnMarketData?: GmgnMarketSnapshotV1;
}>;

type RouterTradeProject = Pick<
  CustomProjectExploreEntry,
  "customProjectId" | "markets"
>;

type SourceVerificationDisplay = Readonly<{
  schemaVersion: "programmable.source-verification-display.v1";
  status: "verified" | "in-progress" | "not-verified";
  label: "Source verified" | "Verification in progress" | "Source not verified";
  updatedAt: string | null;
}>;

type DetailPayload = {
  status: "ready" | "not-deployed";
  token: DetailToken | null;
  customProject: DetailCustomProject | null;
  routerTradeProject: RouterTradeProject | null;
  platformFeeCertification: PlatformFeeCertificationV1 | null;
  sourceVerification: SourceVerificationDisplay | null;
  creatorArticle: CreatorArticleV1 | null;
  snapshot: { chainId: number } | null;
};

export type DetailState =
  | { phase: "loading"; requestKey: string }
  | { phase: "not-found"; requestKey: string }
  | { phase: "not-deployed"; requestKey: string }
  | { phase: "error"; message: string; requestKey: string }
  | {
      phase: "ready";
      token: DetailToken;
      routerTradeProject: RouterTradeProject | null;
      platformFeeCertification: PlatformFeeCertificationV1 | null;
      sourceVerification: SourceVerificationDisplay | null;
      creatorArticle: CreatorArticleV1 | null;
      chainId: number;
      requestKey: string;
    }
  | {
      phase: "custom-ready";
      project: DetailCustomProject;
      creatorArticle: CreatorArticleV1 | null;
      chainId: number;
      requestKey: string;
    };

export type TokenMetric = {
  label: string;
  value: string;
};

export const TOKEN_DETAIL_REQUEST_TIMEOUT_MS = 10_000;

function chartTotalSupply(input: {
  totalSupply?: string;
  totalSupplyRaw?: string;
  tokenDecimals?: number;
  marketData?: TokenMarketDataV1;
}) {
  if (input.totalSupply?.trim()) return input.totalSupply;
  const rawSupply = parseUnsignedDecimal(input.totalSupplyRaw);
  if (
    rawSupply !== null &&
    rawSupply !== "0" &&
    Number.isSafeInteger(input.tokenDecimals) &&
    Number(input.tokenDecimals) >= 0 &&
    Number(input.tokenDecimals) <= 255
  ) {
    return formatUnits(BigInt(rawSupply), Number(input.tokenDecimals));
  }
  const primaryPool = input.marketData?.pools.find(
    (pool) => pool.identity.poolId === input.marketData?.primaryPoolId,
  );
  return primaryPool?.valuation.status === "available"
    ? primaryPool.valuation.totalSupply
    : undefined;
}

function chartCurrentMarketCapUsd(input: {
  valuation?: ExploreValuation;
  fdvUsdWad?: string;
}) {
  const valueWad = input.valuation?.status === "available" &&
      input.valuation.currency === "usd"
    ? input.valuation.valueWad
    : input.fdvUsdWad;
  return valueWad && /^\d+$/u.test(valueWad)
    ? formatUnits(BigInt(valueWad), 18)
    : undefined;
}

const CHART_VOLUME_LABELS = {
  "1h": "Volume 1H",
  "1d": "Volume 1D",
  "1w": "Volume 1W",
} as const;

const fallbackTokenImages = [
  "/brand/programmable-token-card-fallback-night-garden-01.webp",
  "/brand/programmable-token-card-fallback-night-garden-02.webp",
  "/brand/programmable-token-card-fallback-night-garden-03.webp",
  "/brand/programmable-token-card-fallback-night-garden-04.webp",
  "/brand/programmable-token-card-fallback-night-garden-05.webp",
  "/brand/programmable-token-card-fallback-night-garden-06.webp",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTokenAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isBytes32(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseUnsignedDecimal(value: unknown, maximum = (1n << 256n) - 1n) {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d*)$/.test(value) ||
    value.length > 78
  ) {
    return null;
  }
  try {
    return BigInt(value) <= maximum ? value : null;
  } catch {
    return null;
  }
}

function parseUniswapV4Pool(
  value: unknown,
): LauncherToken["uniswapV4Pool"] | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "source",
      "indexedBlockNumber",
      "indexedBlockHash",
      "volumeUsdWad",
      "tvlUsdWad",
      "transactionCount",
      "liquidity",
      "sqrtPriceX96",
      "tick",
      "feeTierPips",
    ]) ||
    value.source !== "official-uniswap-v4-subgraph" ||
    !isBytes32(value.indexedBlockHash)
  ) {
    return null;
  }

  const indexedBlockNumber = parseUnsignedDecimal(value.indexedBlockNumber);
  const volumeUsdWad = parseUnsignedDecimal(value.volumeUsdWad);
  const tvlUsdWad = parseUnsignedDecimal(value.tvlUsdWad);
  const transactionCount = parseUnsignedDecimal(value.transactionCount);
  const liquidity = parseUnsignedDecimal(value.liquidity, (1n << 128n) - 1n);
  const sqrtPriceX96 = parseUnsignedDecimal(
    value.sqrtPriceX96,
    (1n << 160n) - 1n,
  );
  const feeTierPips = parseUnsignedDecimal(value.feeTierPips, (1n << 24n) - 1n);
  const tick =
    value.tick === undefined
      ? undefined
      : Number.isSafeInteger(value.tick) &&
          Number(value.tick) >= -887_272 &&
          Number(value.tick) <= 887_272
        ? Number(value.tick)
        : null;
  if (
    indexedBlockNumber === null ||
    volumeUsdWad === null ||
    tvlUsdWad === null ||
    transactionCount === null ||
    liquidity === null ||
    sqrtPriceX96 === null ||
    feeTierPips === null ||
    tick === null
  ) {
    return null;
  }

  return {
    source: value.source,
    indexedBlockNumber,
    indexedBlockHash: value.indexedBlockHash,
    volumeUsdWad,
    tvlUsdWad,
    transactionCount,
    liquidity,
    sqrtPriceX96,
    ...(tick === undefined ? {} : { tick }),
    feeTierPips,
  };
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

function parseCustomAuthorityInventory(
  value: unknown,
  expectedWallet: Readonly<{ namespace: string; value: string }>,
  expectedHash: string,
): PostLaunchAuthorityInventoryV1 | null {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      "schemaVersion", "launchingWallet", "addressBindings",
      "declaredIdentityBindings", "postLaunchAuthorities", "confirmation",
      "postLaunchActionPolicy", "githubAuthority",
      "postLaunchAuthorityInventoryHash",
    ])
    || value.schemaVersion !== "programmable.post-launch-authority-inventory.v1"
    || value.postLaunchActionPolicy !== "declared-onchain-authority-only"
    || value.githubAuthority !== "provenance-only-never-post-launch-authority"
    || value.postLaunchAuthorityInventoryHash !== expectedHash
    || !Array.isArray(value.addressBindings)
    || !Array.isArray(value.declaredIdentityBindings)
    || !Array.isArray(value.postLaunchAuthorities)
    || !isRecord(value.launchingWallet)
    || value.launchingWallet.namespace !== expectedWallet.namespace
    || value.launchingWallet.value !== expectedWallet.value
    || !isRecord(value.confirmation)
    || value.confirmation.mode !== "artifact-bound-launching-wallet-intent"
    || value.confirmation.userVisibleDisclosureRequired !== true
    || !isRecord(value.confirmation.confirmingIdentity)
    || value.confirmation.confirmingIdentity.namespace !== expectedWallet.namespace
    || value.confirmation.confirmingIdentity.value !== expectedWallet.value
  ) return null;
  let previousAuthorityId = "";
  for (const candidate of value.postLaunchAuthorities) {
    if (!isRecord(candidate)
      || !hasOnlyKeys(candidate, [
        "authorityId", "role", "authorityKind", "identity", "source",
        "postLaunchActions", "feeRole", "disclosure", "authorization",
      ])
      || typeof candidate.authorityId !== "string"
      || candidate.authorityId <= previousAuthorityId
      || typeof candidate.role !== "string"
      || !["eoa", "multisig", "contract"].includes(String(candidate.authorityKind))
      || !["none", "creator", "project"].includes(String(candidate.feeRole))
      || candidate.authorization !== "declared-onchain-authority-only"
      || !isRecord(candidate.identity)
      || typeof candidate.identity.namespace !== "string"
      || typeof candidate.identity.value !== "string"
      || !/^eip155:[1-9][0-9]*$/u.test(candidate.identity.namespace)
      || !/^0x[0-9a-f]{40}$/u.test(candidate.identity.value)
      || !isRecord(candidate.source)
      || !["launching-wallet", "declared-identity", "launch-produced-contract", "reviewed-external-contract"].includes(String(candidate.source.kind))
      || !Array.isArray(candidate.postLaunchActions)
      || candidate.postLaunchActions.some((action) => typeof action !== "string")
      || !isRecord(candidate.disclosure)
      || typeof candidate.disclosure.label !== "string"
      || typeof candidate.disclosure.description !== "string"
    ) return null;
    previousAuthorityId = candidate.authorityId;
  }
  return value as unknown as PostLaunchAuthorityInventoryV1;
}

function parseLauncherToken(value: unknown): DetailToken | null {
  if (!isRecord(value)) return null;
  if (
    value.exploreKind !== "token" ||
    !isRecord(value.launchCategoryProvenance) ||
    value.launchCategoryProvenance.schemaVersion !==
      "programmable.explore-launch-category-provenance.v1" ||
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
  const provenance = value.launchCategoryProvenance;
  const platformFeePolicy = value.platformFeePolicy === undefined
    ? undefined
    : isPlatformFeePolicyReadbackV2(value.platformFeePolicy, {
        tokenAddress: value.tokenAddress,
        hookAddress: value.hookAddress,
        poolId: value.poolId,
      })
      ? value.platformFeePolicy
      : null;
  if (
    platformFeePolicy === null
    || (platformFeePolicy && (!stamp || stamp.kind !== "custom-graph"))
  ) return null;
  if (stamp) {
    const unknownStampedFees = value.totalSwapFeeBps === null;
    if (
      value.launchModel !==
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
          value.transferTaxBps !== undefined)) ||
      provenance.category !==
        (stamp.kind === "custom-graph" ? "custom" : "classic") ||
      provenance.source !== "canonical-launch-stamp-router" ||
      !isBytes32(provenance.launchId) ||
      !isBytes32(provenance.stampHash) ||
      !isTokenAddress(provenance.routerAddress) ||
      !isBytes32(provenance.transactionHash) ||
      !isBytes32(provenance.blockHash) ||
      provenance.launchId.toLowerCase() !== stamp.launchId.toLowerCase() ||
      provenance.stampHash.toLowerCase() !== stamp.stampHash.toLowerCase() ||
      provenance.routerAddress.toLowerCase() !==
        stamp.routerAddress.toLowerCase() ||
      provenance.transactionHash.toLowerCase() !==
        stamp.transactionHash.toLowerCase() ||
      provenance.blockHash.toLowerCase() !== stamp.blockHash.toLowerCase() ||
      provenance.blockNumber !== stamp.blockNumber ||
      provenance.transactionIndex !== stamp.transactionIndex ||
      provenance.logIndex !== stamp.launchLogIndex
    ) return null;
  } else if (
    value.launchModel === "custom-graph" ||
    value.totalSwapFeeBps === null ||
    value.liquidityPath !== "meme" ||
    provenance.category !== "classic" ||
    provenance.source !== "canonical-launch-read-model"
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
  if (value.partnerAttribution !== undefined && partnerAttribution === null) {
    return null;
  }
  const uniswapV4Pool =
    value.uniswapV4Pool === undefined
      ? undefined
      : parseUniswapV4Pool(value.uniswapV4Pool);
  if (value.uniswapV4Pool !== undefined && uniswapV4Pool === null) {
    return null;
  }

  const token: CanonicalTokenExploreEntry = {
    ...(value as unknown as CanonicalTokenExploreEntry),
    links,
    description:
      typeof value.description === "string" ? value.description : undefined,
    imageUrl: safePublicImageUrl(value.imageUrl),
    uniswapV4Pool: uniswapV4Pool ?? undefined,
    ...(platformFeePolicy ? { platformFeePolicy } : {}),
    ...(partnerAttribution ? { partnerAttribution } : {}),
  };
  const valuation = value.valuation === undefined
    ? exploreValuation(token)
    : isExploreValuation(value.valuation)
      ? value.valuation
      : null;
  const marketData = value.marketData === undefined
    ? undefined
    : isTokenMarketDataV1(value.marketData)
      ? value.marketData
      : null;
  const gmgnMarketData = value.gmgnMarketData === undefined
    ? undefined
    : isGmgnMarketSnapshotForExploreEntryV1(value.gmgnMarketData, token)
      ? value.gmgnMarketData
      : null;
  return valuation === null || marketData === null || gmgnMarketData === null
    ? null
    : {
        ...token,
        valuation,
        ...(marketData === undefined ? {} : { marketData }),
        ...(gmgnMarketData === undefined ? {} : { gmgnMarketData }),
      };
}

function parseSourceVerificationDisplay(
  value: unknown,
): SourceVerificationDisplay | null {
  if (value === null || value === undefined) return null;
  if (
    !isRecord(value)
    || value.schemaVersion !== "programmable.source-verification-display.v1"
    || !["verified", "in-progress", "not-verified"].includes(
      String(value.status),
    )
    || (value.updatedAt !== null && (
      typeof value.updatedAt !== "string"
      || !Number.isFinite(Date.parse(value.updatedAt))
    ))
  ) return null;
  const expectedLabel = value.status === "verified"
    ? "Source verified"
    : value.status === "in-progress"
      ? "Verification in progress"
      : "Source not verified";
  if (value.label !== expectedLabel) return null;
  return {
    schemaVersion: "programmable.source-verification-display.v1",
    status: value.status as SourceVerificationDisplay["status"],
    label: expectedLabel,
    updatedAt: value.updatedAt as string | null,
  };
}

function parseCustomProject(value: unknown): DetailCustomProject | null {
  if (!isRecord(value)
    || value.exploreKind !== "custom-project"
    || typeof value.id !== "string"
    || typeof value.name !== "string"
    || typeof value.launchedAt !== "string"
    || typeof value.finalizedAt !== "string"
    || typeof value.chainId !== "string"
    || typeof value.modelId !== "string"
    || typeof value.customProjectId !== "string"
    || !/^sha256:[0-9a-f]{64}$/u.test(value.customProjectId)
    || typeof value.customLaunchId !== "string"
    || !/^sha256:[0-9a-f]{64}$/u.test(value.customLaunchId)
    || !isRecord(value.launchingWallet)
    || typeof value.launchingWallet.namespace !== "string"
    || !/^eip155:[1-9][0-9]*$/u.test(value.launchingWallet.namespace)
    || typeof value.launchingWallet.value !== "string"
    || !/^0x[0-9a-f]{40}$/u.test(value.launchingWallet.value)
    || typeof value.postLaunchAuthorityInventoryHash !== "string"
    || !/^sha256:[0-9a-f]{64}$/u.test(value.postLaunchAuthorityInventoryHash)
    || !isTokenAddress(value.tokenAddress)
    || !Array.isArray(value.markets)
    || !Array.isArray(value.links)
    || !isRecord(value.launchCategoryProvenance)
    || value.launchCategoryProvenance.schemaVersion
      !== "programmable.explore-launch-category-provenance.v1"
    || value.launchCategoryProvenance.category !== "custom"
    || (value.launchCategoryProvenance.source !== "registry.custom-launched"
      && value.launchCategoryProvenance.source !== "interface-preview")
    || value.launchCategoryProvenance.projectId !== value.customProjectId
    || value.launchCategoryProvenance.launchId !== value.customLaunchId
    || typeof value.launchCategoryProvenance.sourceRecordBindingHash !== "string"
    || !/^sha256:[0-9a-f]{64}$/u.test(
      value.launchCategoryProvenance.sourceRecordBindingHash,
    )
    || typeof value.launchCategoryProvenance.finalizedLaunchBindingHash !== "string"
    || !/^sha256:[0-9a-f]{64}$/u.test(
      value.launchCategoryProvenance.finalizedLaunchBindingHash,
    )
  ) return null;
  if (value.launchCategoryProvenance.source === "registry.custom-launched"
    && (!isTokenAddress(value.launchCategoryProvenance.registryAddress)
      || typeof value.launchCategoryProvenance.registryStartBlock !== "string"
      || !/^[1-9][0-9]*$/u.test(value.launchCategoryProvenance.registryStartBlock)
      || !isBytes32(value.launchCategoryProvenance.transactionHash)
      || !isBytes32(value.launchCategoryProvenance.blockHash)
      || typeof value.launchCategoryProvenance.blockNumber !== "string"
      || !/^[1-9][0-9]*$/u.test(value.launchCategoryProvenance.blockNumber)
      || !Number.isSafeInteger(value.launchCategoryProvenance.transactionIndex)
      || Number(value.launchCategoryProvenance.transactionIndex) < 0
      || !Number.isSafeInteger(value.launchCategoryProvenance.logIndex)
      || Number(value.launchCategoryProvenance.logIndex) < 0
      || !isBytes32(value.launchCategoryProvenance.configurationHash))) return null;
  const links = value.links.map(parseTokenLink);
  if (links.some((link) => link === null)) return null;
  const launchingWallet = {
    namespace: value.launchingWallet.namespace as string,
    value: value.launchingWallet.value as string,
  };
  const postLaunchAuthorityInventory = parseCustomAuthorityInventory(
    value.postLaunchAuthorityInventory,
    launchingWallet,
    value.postLaunchAuthorityInventoryHash,
  );
  if (postLaunchAuthorityInventory === null) return null;
  type CustomMarket = CustomProjectExploreEntry["markets"][number];
  const markets: CustomMarket[] = [];
  for (const candidate of value.markets) {
    if (!isRecord(candidate)
      || typeof candidate.marketId !== "string"
      || typeof candidate.kind !== "string"
      || !["active", "paused", "closed", "verification_pending"].includes(
        String(candidate.status),
      )
      || (candidate.poolId !== undefined && !isBytes32(candidate.poolId))) return null;
    const asset = (assetValue: unknown) => {
      if (!isRecord(assetValue)
        || typeof assetValue.assetId !== "string"
        || !isRecord(assetValue.identity)
        || typeof assetValue.identity.namespace !== "string"
        || typeof assetValue.identity.value !== "string"
        || (assetValue.decimals !== undefined
          && (!Number.isSafeInteger(assetValue.decimals)
            || Number(assetValue.decimals) < 0
            || Number(assetValue.decimals) > 255))) return null;
      return {
        assetId: assetValue.assetId,
        identity: {
          namespace: assetValue.identity.namespace,
          value: assetValue.identity.value,
        },
        ...(typeof assetValue.name === "string" ? { name: assetValue.name } : {}),
        ...(typeof assetValue.symbol === "string" ? { symbol: assetValue.symbol } : {}),
        ...(assetValue.decimals === undefined
          ? {} : { decimals: Number(assetValue.decimals) }),
      };
    };
    const baseAsset = asset(candidate.baseAsset);
    const quoteAsset = asset(candidate.quoteAsset);
    if (baseAsset === null || quoteAsset === null) return null;
    const capability = candidate.tradeCapability === undefined
      ? undefined
      : parseDiscoverableMarketTradeCapabilityV1({
          value: candidate.tradeCapability,
          chainId: value.chainId,
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
  const valuation = value.valuation === undefined
    ? undefined
    : isExploreValuation(value.valuation)
      ? value.valuation
      : null;
  const marketData = value.marketData === undefined
    ? undefined
    : isTokenMarketDataV1(value.marketData)
      ? value.marketData
      : null;
  const gmgnMarketData = value.gmgnMarketData === undefined
    ? undefined
    : isGmgnMarketSnapshotV1(value.gmgnMarketData)
      ? value.gmgnMarketData
      : null;
  if (valuation === null || marketData === null || gmgnMarketData === null) {
    return null;
  }
  const totalSupplyRaw = value.totalSupplyRaw === undefined
    ? undefined
    : parseUnsignedDecimal(value.totalSupplyRaw);
  if (totalSupplyRaw === null || totalSupplyRaw === "0") return null;
  const project: DetailCustomProject = {
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
    customProjectId: value.customProjectId as `sha256:${string}`,
    customLaunchId: value.customLaunchId as `sha256:${string}`,
    launchingWallet,
    postLaunchAuthorityInventory,
    postLaunchAuthorityInventoryHash:
      value.postLaunchAuthorityInventoryHash as `sha256:${string}`,
    markets,
    tokenAddress: value.tokenAddress,
    ...(typeof value.tokenDecimals === "number"
      && Number.isSafeInteger(value.tokenDecimals)
      && value.tokenDecimals >= 0
      && value.tokenDecimals <= 255
      ? { tokenDecimals: value.tokenDecimals }
      : {}),
    ...(totalSupplyRaw === undefined ? {} : { totalSupplyRaw }),
    launchCategoryProvenance: value.launchCategoryProvenance as CustomProjectExploreEntry["launchCategoryProvenance"],
    ...(valuation === undefined ? {} : { valuation }),
    ...(marketData === undefined ? {} : { marketData }),
  };
  if (
    gmgnMarketData !== undefined &&
    !isGmgnMarketSnapshotForExploreEntryV1(gmgnMarketData, project)
  ) return null;
  return gmgnMarketData === undefined
    ? project
    : { ...project, gmgnMarketData };
}

function parseRouterTradeProject(
  value: unknown,
  token: DetailToken,
): RouterTradeProject | null {
  if (
    !isRecord(value) ||
    typeof value.customProjectId !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(value.customProjectId) ||
    !Array.isArray(value.markets) ||
    token.launchStampProvenance?.kind !== "custom-graph"
  ) {
    return null;
  }

  type CustomMarket = CustomProjectExploreEntry["markets"][number];
  const markets: CustomMarket[] = [];
  for (const candidate of value.markets) {
    if (
      !isRecord(candidate) ||
      typeof candidate.marketId !== "string" ||
      typeof candidate.kind !== "string" ||
      !["active", "paused", "closed", "verification_pending"].includes(
        String(candidate.status),
      ) ||
      (candidate.poolId !== undefined && !isBytes32(candidate.poolId))
    ) {
      return null;
    }
    const asset = (assetValue: unknown) => {
      if (
        !isRecord(assetValue) ||
        typeof assetValue.assetId !== "string" ||
        !isRecord(assetValue.identity) ||
        typeof assetValue.identity.namespace !== "string" ||
        typeof assetValue.identity.value !== "string" ||
        (assetValue.decimals !== undefined &&
          (!Number.isSafeInteger(assetValue.decimals) ||
            Number(assetValue.decimals) < 0 ||
            Number(assetValue.decimals) > 255))
      ) {
        return null;
      }
      return {
        assetId: assetValue.assetId,
        identity: {
          namespace: assetValue.identity.namespace,
          value: assetValue.identity.value,
        },
        ...(typeof assetValue.name === "string"
          ? { name: assetValue.name }
          : {}),
        ...(typeof assetValue.symbol === "string"
          ? { symbol: assetValue.symbol }
          : {}),
        ...(assetValue.decimals === undefined
          ? {}
          : { decimals: Number(assetValue.decimals) }),
      };
    };
    const baseAsset = asset(candidate.baseAsset);
    const quoteAsset = asset(candidate.quoteAsset);
    if (baseAsset === null || quoteAsset === null) return null;
    const capability = parseDiscoverableMarketTradeCapabilityV1({
      value: candidate.tradeCapability,
      chainId: String(token.launchStampProvenance.chainId),
      marketId: candidate.marketId,
      baseAssetId: baseAsset.assetId,
      quoteAssetId: quoteAsset.assetId,
      ...(candidate.poolId === undefined ? {} : { poolId: candidate.poolId }),
    });
    if (capability === null) return null;
    const baseCurrency = capability.poolKey.currency0AssetId
        === baseAsset.assetId
      ? capability.poolKey.currency0
      : capability.poolKey.currency1;
    const quoteCurrency = capability.poolKey.currency0AssetId
        === quoteAsset.assetId
      ? capability.poolKey.currency0
      : capability.poolKey.currency1;
    const namespace = `eip155:${token.launchStampProvenance.chainId}`;
    if (
      baseAsset.identity.namespace !== namespace
      || quoteAsset.identity.namespace !== namespace
      || !isAddress(baseAsset.identity.value)
      || !isAddress(quoteAsset.identity.value)
      || baseCurrency.value.toLowerCase()
        !== baseAsset.identity.value.toLowerCase()
      || quoteCurrency.value.toLowerCase()
        !== quoteAsset.identity.value.toLowerCase()
    ) return null;
    markets.push({
      marketId: candidate.marketId,
      kind: candidate.kind,
      status: candidate.status as CustomMarket["status"],
      ...(candidate.poolId === undefined ? {} : { poolId: candidate.poolId }),
      baseAsset,
      quoteAsset,
      tradeCapability: capability,
    });
  }

  const exactMarket = markets.find(
    (market) =>
      market.status === "active" &&
      market.poolId?.toLowerCase() === token.poolId.toLowerCase() &&
      market.baseAsset.identity.value.toLowerCase() ===
        token.tokenAddress.toLowerCase(),
  );
  if (!exactMarket) return null;

  return Object.freeze({
    customProjectId: value.customProjectId as `sha256:${string}`,
    markets: Object.freeze(markets),
  });
}

export function parseDetailPayload(value: unknown): DetailPayload {
  if (!isRecord(value)) {
    throw new Error("The token registry returned an invalid response");
  }
  if (value.status !== "ready" && value.status !== "not-deployed") {
    throw new Error("The token registry returned an unknown status");
  }

  const token = value.token === null ? null : parseLauncherToken(value.token);
  if (value.token !== null && token === null) {
    throw new Error("The token registry returned an invalid token record");
  }
  const customProject = value.customProject === null
    || value.customProject === undefined
    ? null
    : parseCustomProject(value.customProject);
  if (value.customProject !== null
    && value.customProject !== undefined
    && customProject === null) {
    throw new Error("The token registry returned an invalid custom project");
  }
  if (token !== null && customProject !== null) {
    throw new Error("The token registry returned conflicting launch categories");
  }
  const routerTradeProject =
    value.routerTradeProject === null ||
    value.routerTradeProject === undefined ||
    token === null
      ? null
      : parseRouterTradeProject(value.routerTradeProject, token);
  if (
    value.routerTradeProject !== null &&
    value.routerTradeProject !== undefined &&
    routerTradeProject === null
  ) {
    throw new Error("The token registry returned an invalid Router trade route");
  }
  const platformFeeCertification =
    value.platformFeeCertification === null ||
      value.platformFeeCertification === undefined
      ? null
      : parsePlatformFeeCertificationV1(value.platformFeeCertification);
  if (
    value.platformFeeCertification !== null &&
    value.platformFeeCertification !== undefined &&
    platformFeeCertification === null
  ) {
    throw new Error("The token registry returned invalid fee certification");
  }
  const expectedPlatformFeeCertification = token
    ? platformFeeCertificationForTokenV1(token)
    : null;
  if (
    platformFeeCertification !== null &&
    (expectedPlatformFeeCertification === null ||
      platformFeeCertification.status !==
        expectedPlatformFeeCertification.status ||
      platformFeeCertification.programmableFeeBps !==
        expectedPlatformFeeCertification.programmableFeeBps)
  ) {
    throw new Error("The token registry returned conflicting fee certification");
  }
  const sourceVerification = parseSourceVerificationDisplay(
    value.sourceVerification,
  );
  if (
    value.sourceVerification !== null
    && value.sourceVerification !== undefined
    && sourceVerification === null
  ) {
    throw new Error("The token registry returned invalid source verification");
  }
  let creatorArticle: CreatorArticleV1 | null = null;
  if (value.creatorArticle !== null && value.creatorArticle !== undefined) {
    try {
      creatorArticle = parseCreatorArticleV1(value.creatorArticle);
    } catch {
      creatorArticle = null;
    }
  }

  let snapshot: DetailPayload["snapshot"] = null;
  if (value.snapshot !== null) {
    if (
      !isRecord(value.snapshot) ||
      !Number.isSafeInteger(value.snapshot.chainId) ||
      Number(value.snapshot.chainId) <= 0
    ) {
      throw new Error("The token registry returned an invalid snapshot");
    }
    snapshot = { chainId: Number(value.snapshot.chainId) };
  }
  if (
    token?.launchStampProvenance &&
    snapshot &&
    token.launchStampProvenance.chainId !== snapshot.chainId
  ) {
    throw new Error("The launch stamp does not match the snapshot network");
  }

  return {
    status: value.status,
    token,
    customProject,
    routerTradeProject,
    platformFeeCertification,
    sourceVerification,
    creatorArticle,
    snapshot,
  };
}

function readApiError(value: unknown) {
  return isRecord(value) && typeof value.error === "string"
    ? value.error
    : "Token data is temporarily unavailable";
}

export type TokenDetailInitialResponse = Readonly<{
  status: number;
  body: unknown;
}>;

function detailStateFromResponse(
  response: TokenDetailInitialResponse,
  tokenAddress: `0x${string}`,
  requestKey: string,
): DetailState {
  if (response.status === 404) {
    return { phase: "not-found", requestKey };
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(readApiError(response.body));
  }

  const payload = parseDetailPayload(response.body);
  if (payload.status === "not-deployed") {
    return { phase: "not-deployed", requestKey };
  }
  if (!payload.token && !payload.customProject) {
    return { phase: "not-found", requestKey };
  }
  if (payload.customProject) {
    if (
      payload.customProject.tokenAddress?.toLowerCase() !==
        tokenAddress.toLowerCase()
    ) {
      throw new Error("The token registry returned the wrong custom project");
    }
    const customChainId = Number(payload.customProject.chainId);
    if (!Number.isSafeInteger(customChainId) || customChainId <= 0) {
      throw new Error("The custom project returned an invalid network");
    }
    return {
      phase: "custom-ready",
      project: payload.customProject,
      creatorArticle: payload.creatorArticle,
      chainId: customChainId,
      requestKey,
    };
  }
  if (
    payload.token &&
    payload.token.tokenAddress.toLowerCase() !== tokenAddress.toLowerCase()
  ) {
    throw new Error("The token registry returned the wrong token");
  }
  if (!payload.snapshot) {
    throw new Error("The token registry returned no finalized snapshot");
  }

    return {
      phase: "ready",
      token: payload.token!,
      routerTradeProject: payload.routerTradeProject,
      platformFeeCertification: payload.platformFeeCertification,
      sourceVerification: payload.sourceVerification,
      creatorArticle: payload.creatorArticle,
    chainId: payload.snapshot.chainId,
    requestKey,
  };
}

export function createTokenDetailInitialState(
  response: TokenDetailInitialResponse | undefined,
  tokenAddress: `0x${string}` | null,
  requestKey: string,
): DetailState | null {
  if (!response || !tokenAddress) return null;
  try {
    return detailStateFromResponse(response, tokenAddress, requestKey);
  } catch (error) {
    return {
      phase: "error",
      message:
        error instanceof Error
          ? error.message
          : "Token data is temporarily unavailable",
      requestKey,
    };
  }
}

function getFallbackTokenImage(address: string) {
  const suffix = Number.parseInt(address.slice(-8), 16);
  const index = Number.isFinite(suffix)
    ? suffix % fallbackTokenImages.length
    : 0;
  return fallbackTokenImages[index];
}

function formatEth(value: string | undefined, mode: "amount" | "price") {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  if (parsed === 0) return "0 ETH";

  const minimumScientific = mode === "price" ? 0.00000001 : 0.0001;
  const formatted =
    parsed < minimumScientific
      ? parsed.toExponential(3)
      : new Intl.NumberFormat("en-US", {
          notation: parsed >= 1_000 ? "compact" : "standard",
          maximumFractionDigits: mode === "price" ? 8 : 5,
          maximumSignificantDigits: mode === "price" ? 6 : 7,
        }).format(parsed);
  return `${formatted} ETH`;
}

function formatUsd(valueWad: string | undefined, mode: "amount" | "price") {
  if (!valueWad || !/^\d+$/.test(valueWad)) return null;
  const value = Number(formatUnits(BigInt(valueWad), 18));
  if (!Number.isFinite(value) || value < 0) return null;
  if (value === 0) return "$0";
  if (mode === "price" && value < 0.01) {
    return `$${new Intl.NumberFormat("en-US", {
      maximumSignificantDigits: 6,
    }).format(value)}`;
  }

  if (value >= 1_000) {
    return formatCompactUsd(value, 2);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "standard",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCompactUsd(value: number, maximumFractionDigits: number) {
  const units = [
    { threshold: 1_000_000_000_000, suffix: "T" },
    { threshold: 1_000_000_000, suffix: "B" },
    { threshold: 1_000_000, suffix: "M" },
    { threshold: 1_000, suffix: "K" },
  ] as const;
  const unit = units.find(({ threshold }) => value >= threshold);
  if (!unit) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(value);
  }
  const compact = new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(value / unit.threshold);
  return `$${compact}${unit.suffix}`;
}

function formatUsdAmount(value: number | null) {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  if (value >= 1_000) return formatCompactUsd(value, 1);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "standard",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatQuoteAmount(
  value: string | undefined,
  symbol: string | undefined,
) {
  if (!value || !symbol || !/^\d+(?:\.\d+)?$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return `${new Intl.NumberFormat("en-US", {
    notation: parsed >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: parsed >= 100 ? 1 : 5,
    maximumSignificantDigits: 7,
  }).format(parsed)} ${symbol}`;
}

function formatUsdWadAmount(valueWad: string | undefined) {
  const parsed = parseUnsignedDecimal(valueWad);
  if (parsed === null) return null;
  const value = Number(formatUnits(BigInt(parsed), 18));
  return formatUsdAmount(value);
}

export function formatStockPairedGrossVolume(token: LauncherToken) {
  if (token.launchModel !== "stock-paired") return null;

  const quoteUnitVolume = formatQuoteAmount(
    token.grossVolumeQuote,
    token.quoteAssetSymbol,
  );
  if (
    !token.grossVolumeQuoteRaw ||
    !/^\d+$/.test(token.grossVolumeQuoteRaw) ||
    !token.tokenPriceQuoteWad ||
    !/^[1-9]\d*$/.test(token.tokenPriceQuoteWad) ||
    !token.tokenPriceUsdWad ||
    !/^[1-9]\d*$/.test(token.tokenPriceUsdWad)
  ) {
    return quoteUnitVolume;
  }

  const grossVolumeQuoteRaw = BigInt(token.grossVolumeQuoteRaw);
  const volumeUsdWad =
    (grossVolumeQuoteRaw * BigInt(token.tokenPriceUsdWad)) /
    BigInt(token.tokenPriceQuoteWad);
  if (grossVolumeQuoteRaw > 0n && volumeUsdWad === 0n) {
    return quoteUnitVolume;
  }

  return formatUsdWadAmount(volumeUsdWad.toString()) ?? quoteUnitVolume;
}

function formatSwapFee(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return null;
  }
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value / 100)}%`;
}

export function buildChartVolumeMetric(
  volume: TokenChartVolume | null,
): TokenMetric | undefined {
  if (!volume || volume.range === "all") return undefined;

  return {
    label: CHART_VOLUME_LABELS[volume.range],
    value: volume.pending
      ? "Loading…"
      : (formatUsdWadAmount(volume.volumeUsdWad) ??
        formatEth(volume.volumeEth, "amount") ??
        "Not available yet"),
  };
}

export function getValuationMetricLabel(
  valuation: ExploreValuation | undefined,
): string {
  void valuation;
  return "Market cap";
}

export function marketDataProviderLabel(input: Readonly<{
  valuation?: ExploreValuation;
  gmgnMarketData?: GmgnMarketSnapshotV1;
  chartVolume?: TokenChartVolume | null;
}>): string | null {
  const valuationSource = input.valuation?.status === "available"
    ? input.valuation.source
    : undefined;
  const chartVolumeMetric = buildChartVolumeMetric(input.chartVolume ?? null);
  const usesDisplayedChartVolume = chartVolumeMetric !== undefined &&
    chartVolumeMetric.value !== "Loading…" &&
    chartVolumeMetric.value !== "Not available yet";
  const usesGmgn = valuationSource === "gmgn" ||
    (input.chartVolume?.source === "gmgn" && usesDisplayedChartVolume);
  const usesDexscreener = valuationSource === "dexscreener";
  const usesBitquery = input.chartVolume?.source === "bitquery" &&
    usesDisplayedChartVolume;
  const providers = [
    ...(usesGmgn ? ["GMGN"] : []),
    ...(usesDexscreener ? ["Dexscreener"] : []),
    ...(usesBitquery ? ["Bitquery"] : []),
  ];
  return providers.length > 0 ? providers.join(" + ") : null;
}

function gmgnSnapshotForValuation(
  valuation: ExploreValuation | undefined,
  snapshot: GmgnMarketSnapshotV1 | undefined,
): GmgnMarketSnapshotV1 | undefined {
  if (snapshot === undefined) return undefined;
  return valuation?.status === "available" &&
      valuation.metric === "fdv" &&
      valuation.currency === "usd" &&
      valuation.source === "gmgn" &&
      valuation.asOfTime === snapshot.fetchedAt &&
      valuation.valueWad === snapshot.fdvUsdWad
    ? snapshot
    : undefined;
}

export function buildTokenDetailMetrics(
  token: LauncherToken & Readonly<{
    valuation?: ExploreValuation;
    marketData?: TokenMarketDataV1;
    gmgnMarketData?: GmgnMarketSnapshotV1;
  }>,
  fdvOverride?: string | null,
  volumeOverride?: TokenMetric,
  chartVolume?: TokenChartVolume | null,
): TokenMetric[] {
  const primaryMarket = token.marketData?.pools.find(
    (pool) => pool.identity.poolId === token.marketData?.primaryPoolId,
  );
  const explicitValuation = (token as { valuation?: unknown }).valuation;
  const valuation = isExploreValuation(explicitValuation)
    ? explicitValuation
    : exploreValuation(token);
  const qualifiedGmgnSnapshot = gmgnSnapshotForValuation(
    valuation,
    token.gmgnMarketData,
  );
  const marketVolumeUsd = formatUsdWadAmount(
    qualifiedGmgnSnapshot?.volume24hUsdWad ?? primaryMarket?.volume24hUsdWad,
  );
  const marketLiquidityUsd = formatUsdWadAmount(
    qualifiedGmgnSnapshot?.liquidityUsdWad ??
      (primaryMarket?.liquidity?.freshness === "current"
        ? primaryMarket.liquidity.valueUsdWad
        : undefined),
  );
  const safeFdvOverride = valuation.status === "available" &&
      valuation.metric === "fdv" &&
      fdvOverride?.trim() &&
      !/^(?:Unavailable|Not available yet|—)$/u.test(fdvOverride.trim())
    ? fdvOverride
    : null;
  const formattedFdv = valuation.status === "available"
    ? safeFdvOverride ?? (
        valuation.currency === "usd"
          ? formatUsd(valuation.valueWad, "amount")
          : valuation.currency === "eth"
            ? formatEth(formatUnits(BigInt(valuation.valueWad), 18), "amount")
            : formatQuoteAmount(
                formatUnits(BigInt(valuation.valueWad), 18),
                valuation.quoteSymbol,
              )
      )
    : null;
  const marketProvider = marketDataProviderLabel({
    valuation,
    ...(token.gmgnMarketData === undefined
      ? {}
      : { gmgnMarketData: token.gmgnMarketData }),
    ...(volumeOverride && chartVolume ? { chartVolume } : {}),
  });
  const values: Array<TokenMetric | null> = [
    {
      label: getValuationMetricLabel(valuation),
      value: formattedFdv ?? "Not available yet",
    },
    {
      label: "Category",
      value:
        token.launchStampProvenance?.kind === "custom-graph"
          ? "Custom V4 Hook"
          : "Classic",
    },
    marketProvider
      ? {
          label: "Provider",
          value: marketProvider,
        }
      : null,
    token.launchStampProvenance !== undefined && token.currentTick !== undefined
      ? {
          label: "Market",
          value:
            token.activeLiquidity !== undefined &&
            /^(?:0|[1-9]\d*)$/u.test(token.activeLiquidity) &&
            BigInt(token.activeLiquidity) > 0n
              ? "Live liquidity"
              : "Initialized",
        }
      : null,
    volumeOverride ?? (marketVolumeUsd !== null
      ? {
          label: "24h volume",
          value: marketVolumeUsd,
        }
      : null),
    marketLiquidityUsd !== null
      ? {
          label: "Liquidity",
          value: marketLiquidityUsd,
        }
      : null,
    token.buyHookFeeBps !== undefined &&
    token.sellHookFeeBps !== undefined &&
    token.buyHookFeeBps !== token.sellHookFeeBps
      ? {
          label: "Buy fee",
          value: formatSwapFee(token.buyHookFeeBps) ?? "",
        }
      : formatSwapFee(token.totalSwapFeeBps)
        ? {
            label:
              token.deepReleaseVersion === "deep-full-range-v3"
                ? "Deep fee"
                : "Swap fee",
            value: formatSwapFee(token.totalSwapFeeBps) ?? "",
          }
        : null,
    token.buyHookFeeBps !== undefined &&
    token.sellHookFeeBps !== undefined &&
    token.buyHookFeeBps !== token.sellHookFeeBps
      ? {
          label: "Sell fee",
          value: formatSwapFee(token.sellHookFeeBps) ?? "",
        }
      : null,
  ];

  return values.filter(
    (metric): metric is TokenMetric =>
      metric !== null &&
      (metric.value.length > 0 || metric.label === "Market cap"),
  );
}

export function platformFeePolicyDisclosure(
  token: LauncherToken,
  certification?: PlatformFeeCertificationV1 | null,
) {
  return (
    certification ?? platformFeeCertificationForTokenV1(token)
  )?.label ?? null;
}

export function canUseClassicTokenTrade(token: LauncherToken) {
  return (
    token.launchStampProvenance === undefined &&
    token.launchModel !== "custom-graph" &&
    token.liquidityPath === "meme" &&
    typeof token.totalSwapFeeBps === "number"
  );
}

export function formatPreparedMinimum(
  prepared: PreparedTokenTrade,
  symbol: string,
  tokenDecimals: number,
) {
  try {
    const decimals = prepared.side === "buy" ? tokenDecimals : 18;
    const unit = prepared.side === "buy" ? symbol : "ETH";
    const value = formatUnits(
      BigInt(prepared.quote.amountOutMinimum),
      decimals,
    );
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return `${new Intl.NumberFormat("en-US", {
      maximumSignificantDigits: 7,
    }).format(number)} ${unit}`;
  } catch {
    return null;
  }
}

type VisibleTokenLinkKind = TokenLinkKind | "github" | "discord";
type VisibleTokenLink = Readonly<{
  kind: VisibleTokenLinkKind;
  url: string;
}>;

function getLinkLabel(kind: VisibleTokenLinkKind) {
  if (kind === "website") return "Website";
  if (kind === "telegram") return "Telegram";
  if (kind === "github") return "GitHub";
  if (kind === "discord") return "Discord";
  if (kind === "gitbook") return "GitBook";
  return "X";
}

function getNetworkLabel(chainId: number) {
  if (chainId === 1) return "Ethereum";
  if (chainId === 11_155_111) return "Sepolia";
  return `Chain ${chainId}`;
}

function XBrandIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.451-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z"
      />
    </svg>
  );
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

function TokenLinkIcon({ kind }: { kind: VisibleTokenLinkKind }) {
  if (kind === "website") {
    return <WebsiteLinkIcon className={styles.websiteIcon} />;
  }
  if (kind === "telegram") return <TelegramBrandIcon />;
  if (kind === "github") return <GitHubBrandIcon />;
  if (kind === "discord") return <DiscordBrandIcon />;
  if (kind === "gitbook") return <BookOpen aria-hidden="true" size={18} />;
  return <XBrandIcon />;
}

function MetricGrid({ metrics }: { metrics: TokenMetric[] }) {
  if (metrics.length === 0) return null;

  return (
    <dl
      className={styles.metrics}
      data-count={metrics.length}
      aria-label="Market summary"
    >
      {metrics.map((metric) => (
        <div className={styles.metric} key={metric.label}>
          <dt>{metric.label}</dt>
          <dd>{metric.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function TokenIdentityActions({ address, creator, chainId, copied, onCopy }: {
  address?: string;
  creator?: string;
  chainId: number;
  copied: boolean;
  onCopy: () => void;
}) {
  const explorer = chainId === 1 ? "https://etherscan.io" : chainId === 11_155_111 ? "https://sepolia.etherscan.io" : null;
  return <div className={styles.tokenHeaderActions}>
    {address ? <button className={styles.tokenHeaderButton} type="button" onClick={onCopy} title={address}>
      {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{copied ? "Copied" : "Copy address"}
    </button> : null}
    {creator && isAddress(creator) ? <Link className={styles.tokenHeaderButton} href={`/profile?account=${creator}&chain=${chainId}`} title={`Dev wallet: ${creator}`}>Dev wallet</Link> : null}
    {address && explorer ? <a className={styles.tokenHeaderButton} href={`${explorer}/token/${address}`} target="_blank" rel="noreferrer">Explorer <ExternalLink size={16} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a> : null}
    <span className="sr-only" role="status">{copied ? "Token address copied" : ""}</span>
  </div>;
}

function DeepLiquiditySummary({ token }: { token: LauncherToken }) {
  const target = BigInt(token.growthTargetNativeWei ?? "0");
  const added = BigInt(token.totalNativeAddedToLiquidityWei ?? "0");
  const boundedAdded = added < target ? added : target;
  const targetReached = token.growthTargetReached === true;
  const progressBps = targetReached
    ? 10_000
    : target === 0n
      ? 0
      : Number((boundedAdded * 10_000n) / target);
  const deferredRewards = BigInt(token.deferredRewardFeesWei ?? "0");

  return (
    <section className={styles.deepSummary} aria-label="Deep liquidity">
      <div className={styles.deepSummaryHeading}>
        <div>
          <span>Deep liquidity</span>
          <strong>{formatEth(formatUnits(added, 18), "amount")} added</strong>
        </div>
        <span>
          {targetReached
            ? "Target reached"
            : `${(progressBps / 100).toFixed(2)}%`}
        </span>
      </div>
      <div
        className={styles.deepProgress}
        role="progressbar"
        aria-label="Liquidity growth progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progressBps / 100}
      >
        <span style={{ width: `${progressBps / 100}%` }} />
      </div>
      <p>
        Creator fees deepen the original permanently locked pool before creator
        rewards begin. The 150M reserve stays locked, and unused reserve is not
        active liquidity. Automation is permissionless and not guaranteed.
        {deferredRewards > 0n
          ? ` ${formatEth(formatUnits(deferredRewards, 18), "amount")} in creator rewards is deferred until the liquidity target is reached.`
          : ""}
      </p>
    </section>
  );
}

function TokenDetailContent({
  token,
  chainId,
  preview,
  creatorArticle = null,
  platformFeeCertification = null,
  sourceVerification = null,
}: {
  token: LauncherToken;
  chainId: number;
  preview: boolean;
  creatorArticle?: CreatorArticleV1 | null;
  routerTradeProject?: RouterTradeProject | null;
  platformFeeCertification?: PlatformFeeCertificationV1 | null;
  sourceVerification?: SourceVerificationDisplay | null;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [chartVolume, setChartVolume] = useState<TokenChartVolume | null>(null);
  const [publishedCreatorArticle, setPublishedCreatorArticle] =
    useState<CreatorArticleV1 | null>(null);
  const copyResetTimer = useRef<number | null>(null);
  const imageUrl =
    token.imageUrl?.trim() || getFallbackTokenImage(token.tokenAddress);
  const imageSource = getTokenCardImageSource(imageUrl);
  const projectLinks = useMemo<readonly VisibleTokenLink[]>(() => {
    const links: VisibleTokenLink[] = [...(token.links ?? [])];
    if (
      token.tokenAddress.toLowerCase()
        === PROGRAMMABLE_MAIN_TOKEN_ADDRESS.toLowerCase()
    ) {
      for (const link of PROGRAMMABLE_MAIN_TOKEN_PRESENTATION.supplementalLinks) {
        if (!links.some((candidate) => candidate.kind === link.kind)) {
          links.push(link);
        }
      }
    }
    return links;
  }, [token.links, token.tokenAddress]);
  const isRouterStamped = token.launchStampProvenance !== undefined;
  const creatorAddress = isRouterStamped
    ? token.launchStampProvenance?.launchWallet
    : token.creatorAddress;
  const classicTradeLaunchModel = token.launchModel === "custom-graph"
    ? undefined
    : token.launchModel;
  const visibleCreatorArticle = publishedCreatorArticle
      && (!creatorArticle || publishedCreatorArticle.revision >= creatorArticle.revision)
    ? publishedCreatorArticle
    : creatorArticle;
  const creatorProject = useMemo(() => {
    if (
      preview
      || chainId !== 1
      || !creatorAddress
      || !isAddress(creatorAddress)
    ) return null;
    return Object.freeze({
      chainId: 1 as const,
      tokenAddress: getAddress(token.tokenAddress),
      name: token.name,
      symbol: token.symbol || null,
      imageUrl: token.imageUrl?.trim() || null,
      source: token.tokenAddress.toLowerCase()
          === PROGRAMMABLE_MAIN_TOKEN_ADDRESS.toLowerCase()
        ? "official-main-token" as const
        : isRouterStamped
          ? "canonical-launch-stamp-router" as const
          : "envio-classic-v3" as const,
      article: visibleCreatorArticle
        ? Object.freeze({
            revision: visibleCreatorArticle.revision,
            title: visibleCreatorArticle.title,
            updatedAt: visibleCreatorArticle.updatedAt,
          })
        : null,
    });
  }, [
    chainId,
    preview,
    creatorAddress,
    token.imageUrl,
    token.name,
    token.symbol,
    token.tokenAddress,
    isRouterStamped,
    visibleCreatorArticle,
  ]);

  useEffect(
    () => () => {
      if (copyResetTimer.current !== null) {
        window.clearTimeout(copyResetTimer.current);
      }
    },
    [],
  );

  const metrics = useMemo(() => {
    return buildTokenDetailMetrics(
      token,
      null,
      buildChartVolumeMetric(chartVolume),
      chartVolume,
    );
  }, [chartVolume, token]);
  const platformFeeDisclosure = platformFeePolicyDisclosure(
    token,
    platformFeeCertification,
  );

  async function copyAddress() {
    if (copyResetTimer.current !== null) {
      window.clearTimeout(copyResetTimer.current);
    }
    setCopyError("");
    try {
      await navigator.clipboard.writeText(token.tokenAddress);
      setCopied(true);
      copyResetTimer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
      setCopyError("Could not copy address");
      copyResetTimer.current = window.setTimeout(() => setCopyError(""), 2400);
    }
  }

  return (
    <div className={`${styles.page} page-width`}>
      <div className={styles.navigationRow}>
        <Link className={styles.back} href="/explore">
          <ArrowLeft aria-hidden="true" size={16} />
          Explore
        </Link>
      </div>

      <div className={`${styles.layout} ${styles.classicLayout} ${styles.readOnlyLayout}`}>
        <section className={styles.overview}>
          <div className={styles.identity}>
            <div className={styles.image}>
              <Image
                src={imageSource}
                alt={
                  token.imageUrl?.trim() ? `${token.name} artwork` : ""
                }
                fill
                priority
                sizes="(max-width: 720px) 88px, 132px"
                unoptimized={!canOptimizeTokenImage(imageSource)}
                onError={(event) => {
                  applyTokenImageFallback(
                    event.currentTarget,
                    getFallbackTokenImage(token.tokenAddress),
                  );
                }}
              />
            </div>

            <div className={styles.identityCopy}>
              <div className={styles.tokenSymbolRow}>
                <span className={styles.symbol}>${token.symbol}</span>
              </div>
              <h1
                className={styles.name}
                data-single-line={
                  token.name.trim().length <= 22 ? "true" : undefined
                }
                title={token.name}
              >
                {token.name}
              </h1>
              {token.partnerAttribution ? (
                <PartnerLaunchAttribution
                  attribution={token.partnerAttribution}
                  compact
                />
              ) : null}
              <div className={styles.addressActions}>
                <code className={styles.tokenAddressText} title={token.tokenAddress}>{token.tokenAddress}</code>
                {projectLinks.length > 0 ? (
                  <nav
                    className={`${styles.links} ${styles.addressLinks}`}
                    aria-label={`${token.name} links`}
                  >
                    {projectLinks.map((link) => {
                      const label = getLinkLabel(link.kind);
                      return (
                        <a
                          className={`${styles.socialLink} ${
                            link.kind === "website" ? styles.websiteLink : ""
                          }`}
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`${token.name} on ${label}`}
                          title={label}
                          key={`${link.kind}:${link.url}`}
                        >
                          <TokenLinkIcon kind={link.kind} />
                        </a>
                      );
                    })}
                  </nav>
                ) : null}
              </div>

              {sourceVerification ? (
                <p
                  className={styles.sourceVerification}
                  data-status={sourceVerification.status}
                  title={sourceVerification.updatedAt
                    ? `Checked ${sourceVerification.updatedAt}`
                    : undefined}
                >
                  {sourceVerification.label}
                </p>
              ) : null}

              {platformFeeDisclosure ? (
                <p
                  className={styles.sourceVerification}
                  data-status={
                    platformFeeCertification?.status === "certified" ||
                      token.platformFeePolicy?.status === "onchain-confirmed"
                      ? "verified"
                      : undefined
                  }
                >
                  {platformFeeDisclosure}
                </p>
              ) : null}

              {token.description?.trim() ? (
                <p className={styles.description}>{token.description.trim()}</p>
              ) : null}
            </div>
            <TokenIdentityActions address={token.tokenAddress} creator={creatorAddress} chainId={chainId} copied={copied} onCopy={() => void copyAddress()} />
          </div>

          <div className={styles.marketChart}>
            {chainId === 1 ? (
              <TokenPriceChart
                tokenAddress={token.tokenAddress}
                tokenName={token.name}
                launchModel={classicTradeLaunchModel}
                totalSupply={chartTotalSupply(token)}
                currentMarketCapUsd={chartCurrentMarketCapUsd(token)}
                preview={preview}
                onVolumeChange={setChartVolume}
              />
            ) : null}
            <MetricGrid metrics={metrics} />
          </div>
        </section>



        {token.launchModel === "deep" &&
        token.growthTargetNativeWei &&
        token.totalNativeAddedToLiquidityWei &&
        token.tokenReserveRaw ? (
          <DeepLiquiditySummary token={token} />
        ) : null}

      </div>
      {chainId === 1 && !preview ? (
        <TokenGmgnAnalytics
          tokenAddress={token.tokenAddress}
          tokenName={token.name}
        />
      ) : null}
      <CreatorArticle
        article={visibleCreatorArticle}
        editAction={creatorProject && creatorAddress ? (
          <CreatorArticleEditAction
            project={creatorProject}
            creatorAddress={getAddress(creatorAddress)}
            onPublished={setPublishedCreatorArticle}
          />
        ) : null}
      />
      {copyError ? (
        <div className="toast-region" aria-live="assertive" aria-atomic="true">
          <p className="toast" role="alert">
            {copyError}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function customMarketStatus(project: CustomProjectExploreEntry): string {
  if (project.markets.length === 0) return "No market listed";
  const statuses = [...new Set(project.markets.map(({ status }) => status))];
  if (statuses.length > 1) return `${project.markets.length} markets`;
  const status = statuses[0]!;
  return status === "verification_pending"
    ? "Verification in progress"
    : status === "active"
      ? "Active"
      : status === "paused"
        ? "Paused"
        : "Closed";
}

type CustomMarket = CustomProjectExploreEntry["markets"][number];
type CustomMarketAsset = CustomMarket["baseAsset"];

function preferredCustomMarketAssetLabel(
  asset: CustomMarketAsset,
): string | null {
  return asset.symbol?.trim() || asset.name?.trim() || null;
}

function normalizedCustomMarketAssetLabel(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function customMarketAssetLabel(
  asset: CustomMarketAsset,
  markets: readonly CustomMarket[],
): string {
  const preferredLabel = preferredCustomMarketAssetLabel(asset);
  if (!preferredLabel) return asset.assetId.trim();
  const normalizedLabel = normalizedCustomMarketAssetLabel(preferredLabel);
  const ambiguous = markets.some((market) =>
    [market.baseAsset, market.quoteAsset].some((candidate) => {
      const candidateLabel = preferredCustomMarketAssetLabel(candidate);
      return candidate.assetId !== asset.assetId
        && candidateLabel !== null
        && normalizedCustomMarketAssetLabel(candidateLabel) === normalizedLabel;
    })
  );
  return ambiguous
    ? `${preferredLabel} (${asset.assetId.trim()})`
    : preferredLabel;
}

export function customMarketPairLabel(
  market: CustomMarket,
  markets: readonly CustomMarket[] = [market],
): string {
  const base = customMarketAssetLabel(market.baseAsset, markets);
  const quote = customMarketAssetLabel(market.quoteAsset, markets);
  return `${base} / ${quote}`;
}

function conciseCustomMarketId(value: string): string {
  const normalized = value.trim();
  if (normalized.length <= 28) return normalized;
  return `${normalized.slice(0, 12)}…${normalized.slice(-8)}`;
}

export function customMarketIdentityLabel(market: CustomMarket): string {
  const marketId = market.marketId.trim();
  const poolId = market.poolId?.trim();
  const identity = marketId
    ? `Market ${conciseCustomMarketId(marketId)}`
    : poolId
      ? `Pool ${conciseCustomMarketId(poolId)}`
      : `${market.baseAsset.assetId.trim()} / ${market.quoteAsset.assetId.trim()}`;
  return `${market.kind.trim() || "Custom market"} · ${identity}`;
}

function customMarketIdentityDescription(market: CustomMarket): string {
  return `${market.kind}; market ID ${market.marketId}${
    market.poolId ? `; pool ID ${market.poolId}` : ""
  }`;
}

function customMarketMetrics(project: DetailCustomProject): TokenMetric[] {
  const primary = project.marketData?.pools.find(
    (pool) => pool.identity.poolId === project.marketData?.primaryPoolId,
  );
  const valuation = project.valuation;
  const qualifiedGmgnSnapshot = gmgnSnapshotForValuation(
    valuation,
    project.gmgnMarketData,
  );
  const valuationValue = valuation?.status === "available"
    ? valuation.currency === "usd"
      ? formatUsd(valuation.valueWad, "amount")
      : valuation.currency === "eth"
        ? formatEth(formatUnits(BigInt(valuation.valueWad), 18), "amount")
        : formatQuoteAmount(
            formatUnits(BigInt(valuation.valueWad), 18),
            valuation.quoteSymbol,
          )
    : null;
  const marketStatus = project.marketData?.status === "waiting-for-first-trade"
    ? "Waiting for first trade"
    : project.marketData?.status === "stale"
      ? "Last verified"
      : project.marketData?.status === "current"
        ? "Current"
        : project.marketData?.status === "partial"
          ? "Limited"
          : "";
  const marketProvider = marketDataProviderLabel(project);
  return [
    {
      label: getValuationMetricLabel(valuation),
      value: valuationValue ?? "",
    },
    ...(marketProvider
      ? [{ label: "Provider", value: marketProvider }]
      : []),
    { label: "Market data", value: marketStatus },
    ...((qualifiedGmgnSnapshot?.volume24hUsdWad ?? primary?.volume24hUsdWad)
      ? [{
          label: "24h volume",
          value: formatUsdWadAmount(
            qualifiedGmgnSnapshot?.volume24hUsdWad ??
              primary?.volume24hUsdWad,
          ) ?? "",
        }]
      : []),
    ...((qualifiedGmgnSnapshot?.liquidityUsdWad ||
      primary?.liquidity?.freshness === "current")
      ? [{
          label: "Liquidity",
          value: formatUsdWadAmount(
            qualifiedGmgnSnapshot?.liquidityUsdWad ??
              primary?.liquidity?.valueUsdWad,
          ) ?? "",
        }]
      : []),
  ];
}

function CustomProjectDetailContent({
  project,
  chainId,
  preview = false,
  creatorArticle = null,
}: {
  project: DetailCustomProject;
  chainId: number;
  preview?: boolean;
  creatorArticle?: CreatorArticleV1 | null;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [publishedCreatorArticle, setPublishedCreatorArticle] =
    useState<CreatorArticleV1 | null>(null);
  const copyResetTimer = useRef<number | null>(null);
  const imageUrl = project.imageUrl?.trim()
    || getFallbackTokenImage(project.tokenAddress ?? project.customProjectId);
  const imageSource = getTokenCardImageSource(imageUrl);
  const authorities = project.postLaunchAuthorityInventory.postLaunchAuthorities;
  const metrics = customMarketMetrics(project);
  const visibleCreatorArticle = publishedCreatorArticle
      && (!creatorArticle || publishedCreatorArticle.revision >= creatorArticle.revision)
    ? publishedCreatorArticle
    : creatorArticle;
  const creatorProject = useMemo(() => {
    if (
      chainId !== 1
      || !project.tokenAddress
      || project.chainId !== "1"
      || project.launchingWallet.namespace !== "eip155:1"
      || !isAddress(project.launchingWallet.value)
    ) return null;
    return Object.freeze({
      chainId: 1 as const,
      tokenAddress: getAddress(project.tokenAddress),
      name: project.name,
      symbol: project.symbol?.trim() || null,
      imageUrl: project.imageUrl?.trim() || null,
      source: "registry.custom-launched" as const,
      article: visibleCreatorArticle
        ? Object.freeze({
            revision: visibleCreatorArticle.revision,
            title: visibleCreatorArticle.title,
            updatedAt: visibleCreatorArticle.updatedAt,
          })
        : null,
    });
  }, [chainId, project, visibleCreatorArticle]);

  useEffect(() => () => {
    if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
  }, []);

  async function copyAddress() {
    if (project.tokenAddress === undefined) return;
    if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
    setCopyError("");
    try {
      await navigator.clipboard.writeText(project.tokenAddress);
      setCopied(true);
      copyResetTimer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
      setCopyError("Could not copy address");
      copyResetTimer.current = window.setTimeout(() => setCopyError(""), 2400);
    }
  }

  return (
    <div className={`${styles.page} page-width`}>
      <div className={styles.navigationRow}>
        <Link className={styles.back} href="/explore">
          <ArrowLeft aria-hidden="true" size={16} />
          Explore
        </Link>
      </div>

      <div className={`${styles.layout} ${styles.readOnlyLayout}`}>
        <section className={styles.identity}>
          <div className={styles.image}>
            <Image
              src={imageSource}
              alt={project.imageUrl?.trim() ? `${project.name} artwork` : ""}
              fill
              priority
              sizes="(max-width: 720px) 88px, 132px"
              unoptimized={!canOptimizeTokenImage(imageSource)}
              onError={(event) => {
                applyTokenImageFallback(
                  event.currentTarget,
                  getFallbackTokenImage(
                    project.tokenAddress ?? project.customProjectId,
                  ),
                );
              }}
            />
          </div>
          <div className={styles.identityCopy}>
            <div className={styles.tokenSymbolRow}>
              {project.symbol ? <span className={styles.symbol}>${project.symbol}</span> : null}
              <span className={styles.categoryBadge}>Custom V4 Hook</span>
            </div>
            <h1 className={styles.name}>{project.name}</h1>
            {project.links.length > 0 ? (
              <nav className={styles.links} aria-label={`${project.name} links`}>
                {project.links.map((link) => (
                  <a
                    className={`${styles.socialLink} ${link.kind === "website" ? styles.websiteLink : ""}`}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${project.name} on ${getLinkLabel(link.kind)}`}
                    title={getLinkLabel(link.kind)}
                    key={`${link.kind}:${link.url}`}
                  >
                    <TokenLinkIcon kind={link.kind} />
                  </a>
                ))}
              </nav>
            ) : null}
            {project.tokenAddress ? (
              <div className={styles.addressActions}>
                <code className={styles.tokenAddressText} title={project.tokenAddress}>{project.tokenAddress}</code>
              </div>
            ) : null}
            {project.description?.trim() ? (
              <p className={styles.description}>{project.description.trim()}</p>
            ) : null}
          </div>
          <TokenIdentityActions address={project.tokenAddress} creator={project.launchingWallet.namespace === `eip155:${chainId}` ? project.launchingWallet.value : undefined} chainId={chainId} copied={copied} onCopy={() => void copyAddress()} />
        </section>

        {project.tokenAddress ? (
          <section
            className={styles.marketChart}
            aria-label={`${project.name} market data`}
          >
            <TokenPriceChart
              tokenAddress={project.tokenAddress}
              tokenName={project.name}
              totalSupply={chartTotalSupply(project)}
              currentMarketCapUsd={chartCurrentMarketCapUsd(project)}
            />
            <MetricGrid metrics={metrics} />
          </section>
        ) : null}

        <section className={styles.customMarketPanel} aria-labelledby="custom-market-heading">
          <div className={styles.customPanelHeading}>
            <div>
              <span>Market details</span>
              <h2 id="custom-market-heading">{customMarketStatus(project)}</h2>
            </div>
            <span className={styles.categoryBadge}>Custom V4 Hook</span>
          </div>
          <dl className={styles.customFacts}>
            <div><dt>Type</dt><dd>Custom V4 Hook</dd></div>
            <div><dt>Launch model</dt><dd>{project.modelId}</dd></div>
            <div><dt>Chain</dt><dd>{getNetworkLabel(chainId)}</dd></div>
            <div><dt>Markets</dt><dd>{project.markets.length}</dd></div>
            {project.markets.map((market) => (
              <div
                className={styles.customWideFact}
                data-market-id={market.marketId}
                data-market-kind={market.kind}
                data-pool-id={market.poolId}
                key={market.marketId}
              >
                <dt>{customMarketPairLabel(market, project.markets)}</dt>
                <dd>
                  {market.status === "verification_pending"
                    ? "Verification in progress"
                    : market.status.charAt(0).toUpperCase() + market.status.slice(1)}
                  <br />
                  <code
                    aria-label={customMarketIdentityDescription(market)}
                    title={customMarketIdentityDescription(market)}
                  >
                    {customMarketIdentityLabel(market)}
                  </code>
                </dd>
              </div>
            ))}
          </dl>
        </section>



        <section className={styles.customAuthorityPanel} aria-labelledby="custom-authorities-heading">
          <div className={styles.customPanelHeading}>
            <div>
              <span>Canonical inventory</span>
              <h2 id="custom-authorities-heading">Post-launch authorities</h2>
            </div>
          </div>
          {authorities.length === 0 ? (
            <p className={styles.customMuted}>No post-launch authority is declared.</p>
          ) : (
            <ul className={styles.authorityList}>
              {authorities.map((authority) => (
                <li key={authority.authorityId}>
                  <div>
                    <strong>{authority.disclosure.label}</strong>
                    <span>{authority.role} · {authority.authorityKind}</span>
                  </div>
                  <p>{authority.disclosure.description}</p>
                  <code>{authority.identity.value}</code>
                  <span>
                    {authority.postLaunchActions.length > 0
                      ? authority.postLaunchActions.join(" · ")
                      : `${authority.feeRole} fee role`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>


      </div>
      {chainId === 1 && !preview && project.tokenAddress ? (
        <TokenGmgnAnalytics
          tokenAddress={project.tokenAddress}
          tokenName={project.name}
        />
      ) : null}
      <CreatorArticle
        article={visibleCreatorArticle}
        editAction={creatorProject && isAddress(project.launchingWallet.value) ? (
          <CreatorArticleEditAction
            project={creatorProject}
            creatorAddress={getAddress(project.launchingWallet.value)}
            onPublished={setPublishedCreatorArticle}
          />
        ) : null}
      />
      {copyError ? (
        <div className="toast-region" aria-live="assertive" aria-atomic="true">
          <p className="toast" role="alert">{copyError}</p>
        </div>
      ) : null}
    </div>
  );
}

export function TokenDetailView({
  address,
  chainId = 1,
  initialResponse,
}: {
  address: string;
  chainId?: ViewChainId;
  initialResponse?: TokenDetailInitialResponse;
}) {
  const { wallet: activeWallet } = useWallet();
  const preview = useInterfacePreview();
  const normalizedAddress = isAddress(address) ? getAddress(address) : null;
  const previewToken =
    preview && chainId === 1 && normalizedAddress
      ? getExplorePreviewToken(normalizedAddress)
      : undefined;
  const previewCustomProject =
    preview && chainId === 1 && normalizedAddress
      ? getExplorePreviewCustomProject(normalizedAddress)
      : undefined;
  const [retryKey, setRetryKey] = useState(0);
  const refreshKey = useLiveDataRefresh({
    enabled: normalizedAddress !== null && !preview,
    intervalMs: 60_000,
  });
  const requestKey =
    `${chainId}:${normalizedAddress ?? "invalid"}\u0000${retryKey}`;
  const [initialState] = useState(() =>
    createTokenDetailInitialState(initialResponse, normalizedAddress, requestKey)
  );
  const [state, setState] = useState<DetailState>(
    () => initialState ?? { phase: "loading", requestKey },
  );

  useEffect(() => {
    if (!normalizedAddress || preview) return;
    if (initialState !== null && refreshKey === 0 && retryKey === 0) return;

    const tokenAddress = normalizedAddress;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TOKEN_DETAIL_REQUEST_TIMEOUT_MS);

    async function loadToken() {
      try {
        const search = new URLSearchParams({
          address: tokenAddress,
          chain: String(chainId),
        });
        const response = await fetch(
          `/api/explore/token?${search.toString()}`,
          {
            signal: controller.signal,
            headers: { Accept: "application/json" },
          },
        );
        const body: unknown = await response.json().catch(() => null);

        setState(detailStateFromResponse(
          { status: response.status, body },
          tokenAddress,
          requestKey,
        ));
      } catch (error) {
        if (controller.signal.aborted && !timedOut) return;
        const message =
          timedOut
            ? "Token details took too long to load"
            : error instanceof Error
            ? error.message
            : "Token data is temporarily unavailable";
        setState((current) =>
          (current.phase === "ready" || current.phase === "custom-ready")
            && current.requestKey === requestKey
            ? current
            : { phase: "error", requestKey, message },
        );
      } finally {
        window.clearTimeout(timeout);
      }
    }

    void loadToken();
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [
    initialState,
    chainId,
    normalizedAddress,
    preview,
    refreshKey,
    requestKey,
    retryKey,
  ]);

  if (!normalizedAddress) {
    return (
      <TokenDetailMessage
        message="This is not a valid Ethereum token address"
      />
    );
  }

  if (previewToken) {
    return (
      <TokenDetailContent
        key={`${chainId}:${previewToken.tokenAddress}:preview:${
          activeWallet?.account.toLowerCase() ?? "disconnected"
        }`}
        token={previewToken}
        chainId={chainId}
        preview
        creatorArticle={getExplorePreviewCreatorArticle(normalizedAddress)}
      />
    );
  }

  if (previewCustomProject) {
    return (
      <CustomProjectDetailContent
        project={previewCustomProject}
        chainId={chainId}
        preview
      />
    );
  }

  if (preview) {
    return (
      <TokenDetailMessage message="This token is not in the preview index" />
    );
  }

  const activeState: DetailState =
    state.requestKey === requestKey ? state : { phase: "loading", requestKey };

  if (activeState.phase === "ready") {
    return (
      <TokenDetailContent
        key={`${activeState.chainId}:${activeState.token.tokenAddress}:${
          activeWallet?.account.toLowerCase() ?? "disconnected"
        }`}
        token={activeState.token}
        chainId={activeState.chainId}
        preview={false}
        routerTradeProject={activeState.routerTradeProject}
        platformFeeCertification={activeState.platformFeeCertification}
        sourceVerification={activeState.sourceVerification}
        creatorArticle={activeState.creatorArticle}
      />
    );
  }

  if (activeState.phase === "custom-ready") {
    return (
      <CustomProjectDetailContent
        project={activeState.project}
        chainId={activeState.chainId}
        preview={false}
        creatorArticle={activeState.creatorArticle}
      />
    );
  }

  if (activeState.phase === "loading") {
    return <TokenDetailShell />;
  }

  const message =
    activeState.phase === "not-found"
      ? "This token is not in the Programmable index yet"
      : activeState.phase === "not-deployed"
        ? chainId === 4663
          ? "Robinhood Chain token discovery is not active in Explore yet"
          : "No finalized token data is available"
        : activeState.message;

  return (
    <div className={`${styles.page} page-width`}>
      <Link className={styles.back} href="/explore">
        <ArrowLeft aria-hidden="true" size={16} />
        Explore
      </Link>
      <div
        className={styles.emptyState}
        role={activeState.phase === "error" ? "alert" : "status"}
      >
        <p>{message}</p>
        {activeState.phase === "error" ? (
          <button
            className={styles.retry}
            type="button"
            onClick={() => setRetryKey((value) => value + 1)}
          >
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

function TokenDetailMessage({ message }: { message: string }) {
  return (
    <div className={`${styles.page} page-width`}>
      <Link className={styles.back} href="/explore">
        <ArrowLeft aria-hidden="true" size={16} />
        Explore
      </Link>
      <div className={styles.emptyState} role="status">
        <p>{message}</p>
      </div>
    </div>
  );
}
