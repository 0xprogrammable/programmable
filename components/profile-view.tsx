"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, RefreshCw, X } from "lucide-react";
import { formatUnits, type Hex } from "viem";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type FormEvent,
  type PointerEvent,
} from "react";

import { useWallet } from "@/components/wallet-provider";
import type { ViewChainId } from "@/lib/view-chain";
import { ProfileChainSelector } from "@/components/profile-chain-selector";
import { ProfileLoadingSkeleton } from "@/components/profile-skeleton";
export { ProfileLoadingSkeleton } from "@/components/profile-skeleton";
import { RobinhoodProfileLaunches } from "@/components/robinhood-profile-launches";
import { ProfileModules } from "@/components/profile-modules";
import {
  ProfileProjects,
  ProfileProjectsLoadingState,
  rewardReceiverActionKeyV1,
  type CreatorProjectMarketCapV1,
  type CreatorProjectSummaryV1,
} from "@/components/profile-projects";
import { useLiveDataRefresh } from "@/components/use-live-data-refresh";
import { formatMarketCapMetric } from "@/components/animated-market-cap";
import { isConfiguredClassicV3ReleaseReady } from "@/lib/classic-v3-release";
import {
  prepareAvatarImage,
  prepareProfileBannerImage,
} from "@/lib/profile/avatar";
import { GitHubBrandIcon, XBrandIcon } from "@/components/brand-icons";
import { WebsiteLinkIcon } from "@/components/website-link-icon";
import { PartnerLaunchAttribution } from
  "@/components/partner-launch-attribution";
import {
  ClassicV3ProfileReadError,
  EMPTY_CLASSIC_V3_PROFILE,
  fetchClassicV3ProfileRewards,
  prepareClassicV3RewardAction,
  type ClassicV3ProfileRewards,
  type ClassicV3Reward,
} from "@/lib/profile/classic-v3-rewards";
import {
  deepV3CreatorTokenToProfileToken,
  EMPTY_DEEP_V3_CREATOR_PROFILE,
  fetchDeepV3CreatorProfile,
  type DeepV3CreatorProfile,
  type DeepV3CreatorToken,
} from "@/lib/profile/deep-v3-profile";
import {
  EMPTY_DEEP_PROFILE,
  fetchDeepProfileRewards,
  prepareDeepRewardAction,
  type DeepProfileRewards,
  type DeepReward,
} from "@/lib/profile/deep-rewards";
import {
  EMPTY_STOCK_PAIRED_PROFILE,
  fetchStockPairedProfileRewards,
  isConfiguredStockPairedRewardsReady,
  prepareStockPairedRewardAction,
  prepareStockPairedRewardConversion,
  StockPairedClaimPendingError,
  type StockPairedProfileRewards,
  type StockPairedReward,
} from "@/lib/profile/stock-paired-rewards";
import {
  CreatorClaimClientError,
  prepareCreatorClaim,
} from "@/lib/profile/creator-claim";
import {
  canOptimizeTokenImage,
  getTokenCardImageSource,
} from "@/lib/token-image";
import { PROGRAMMABLE_MAIN_TOKEN_ADDRESS } from
  "@/lib/creator-article/programmable-example-v1";
import {
  getProfileStorageKey,
  profileDraftBelongsToAccount,
  getProfileUsernameError,
  normalizeProfileUsername,
  parseLocalProfile,
  PROFILE_UPDATED_EVENT,
  readLocalProfile,
  writeLocalProfile,
} from "@/lib/profile/local-profile";
import {
  errorProfileData,
  fetchCreatorProfile,
  isProfileDataForAccount,
  loadingProfileData,
  ProfileResponseError,
  UNAVAILABLE_PROFILE_DATA,
  type ProfileClaim,
  type ProfileOnchainData,
  type ProfileToken,
} from "@/lib/profile/onchain-profile";
import styles from "./profile-experience.module.css";

const fallbackTokenImages = [
  "/brand/programmable-token-card-fallback-night-garden-01.webp",
  "/brand/programmable-token-card-fallback-night-garden-02.webp",
  "/brand/programmable-token-card-fallback-night-garden-03.webp",
  "/brand/programmable-token-card-fallback-night-garden-04.webp",
  "/brand/programmable-token-card-fallback-night-garden-05.webp",
  "/brand/programmable-token-card-fallback-night-garden-06.webp",
] as const;

const profileEnvironment =
  process.env.NEXT_PUBLIC_PROGRAMMABLE_ONCHAIN_NETWORK === "rehearsal"
    ? "rehearsal"
    : "production";
const classicV3ReleaseAvailable =
  isConfiguredClassicV3ReleaseReady(profileEnvironment);
const deepReleaseAvailable = false;
const deepV3ReleaseAvailable = false;
const stockPairedReleaseAvailable =
  isConfiguredStockPairedRewardsReady();
const creatorProfileCache = new Map<
  string,
  Readonly<{ data: ProfileOnchainData; updatedAt: number }>
>();
const CREATOR_PROFILE_CACHE_TTL_MS = 5 * 60_000;
const MAX_CREATOR_PROFILE_CACHE_ENTRIES = 8;
const PROFILE_LIVE_REFRESH_INTERVAL_MS = 30_000;
const PROFILE_MANUAL_REFRESH_TIMEOUT_MS = 15_000;
export const MINIMUM_VISIBLE_NATIVE_CLAIM_WEI = 100_000_000_000_000n;
type ReadyClassicV3Profile = Extract<
  ClassicV3ProfileRewards,
  { status: "ready" }
>;
const classicV3ProfileCache = new Map<
  string,
  Readonly<{ data: ReadyClassicV3Profile; verifiedAt: number }>
>();
const CLASSIC_V3_PROFILE_CACHE_TTL_MS = 5 * 60_000;
const MAX_CLASSIC_V3_PROFILE_CACHE_ENTRIES = 8;

type ClassicV3ProfileSourceQuality =
  | "idle"
  | "current"
  | "stale"
  | "unavailable"
  | "integrity";

type ClassicV3ProfileSourceState = Readonly<{
  account?: string;
  quality: ClassicV3ProfileSourceQuality;
  verifiedAt?: number;
}>;

type ProfileRefreshSource =
  | "creator"
  | "classic-v3"
  | "deep"
  | "deep-v3"
  | "stock-paired";

type ActiveProfileRefresh = {
  account: string;
  id: number;
  pending: Set<ProfileRefreshSource>;
};

export type ProfileRewardDataQuality = "current" | "stale" | "partial";

function readCachedCreatorProfile(account: string) {
  const key = account.toLowerCase();
  const cached = creatorProfileCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.updatedAt >= CREATOR_PROFILE_CACHE_TTL_MS) {
    creatorProfileCache.delete(key);
    return null;
  }
  return { ...cached.data, sourceQuality: "stale" as const };
}

function cacheCreatorProfile(data: ProfileOnchainData) {
  if (!data.account || data.status !== "ready") return;
  const key = data.account.toLowerCase();
  creatorProfileCache.delete(key);
  creatorProfileCache.set(key, { data, updatedAt: Date.now() });
  while (creatorProfileCache.size > MAX_CREATOR_PROFILE_CACHE_ENTRIES) {
    const oldestKey = creatorProfileCache.keys().next().value;
    if (oldestKey === undefined) return;
    creatorProfileCache.delete(oldestKey);
  }
}

function readCachedClassicV3Profile(account: string) {
  const key = account.toLowerCase();
  const cached = classicV3ProfileCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.verifiedAt >= CLASSIC_V3_PROFILE_CACHE_TTL_MS) {
    classicV3ProfileCache.delete(key);
    return null;
  }
  return cached;
}

function cacheClassicV3Profile(data: ClassicV3ProfileRewards) {
  if (data.status !== "ready") return null;
  const key = data.account.toLowerCase();
  const verifiedAt = Date.now();
  classicV3ProfileCache.delete(key);
  classicV3ProfileCache.set(key, { data, verifiedAt });
  while (classicV3ProfileCache.size > MAX_CLASSIC_V3_PROFILE_CACHE_ENTRIES) {
    const oldestKey = classicV3ProfileCache.keys().next().value;
    if (oldestKey === undefined) break;
    classicV3ProfileCache.delete(oldestKey);
  }
  return verifiedAt;
}

type ProfileClaimActionState = {
  account: string;
  status:
    | "preparing"
    | "wallet"
    | "confirming"
    | "pending"
    | "not-found"
    | "confirmed"
    | "error";
  message: string;
  transactionHash?: Hex;
  recoverable?: true;
};

type ClassicV3ActionState = {
  account: string;
  status:
    | "preparing"
    | "wallet"
    | "confirming"
    | "pending"
    | "not-found"
    | "confirmed"
    | "error";
  message: string;
  transactionHash?: Hex;
  recoverable?: true;
};

type DeepActionState = ClassicV3ActionState;
export type StockPairedPendingStage =
  | "claim"
  | "token-to-permit2"
  | "permit2-to-router"
  | "swap";

type StockPairedReceiptGate =
  | { outcome: "advance" }
  | { outcome: "hold"; message: string }
  | { outcome: "reverted"; message: string };

export function resolveStockPairedReceiptGate(
  pendingStage: StockPairedPendingStage,
  receiptStatus:
    | "pending"
    | "not-found"
    | "confirmed"
    | "reverted"
    | "unavailable",
): StockPairedReceiptGate {
  if (receiptStatus === "confirmed") {
    return { outcome: "advance" };
  }
  if (receiptStatus === "reverted") {
    return {
      outcome: "reverted",
      message:
        pendingStage === "claim"
          ? "The reward transaction reverted onchain"
          : pendingStage === "swap"
            ? "The ETH conversion reverted onchain"
            : "The conversion approval reverted onchain",
    };
  }
  if (receiptStatus === "unavailable") {
    return {
      outcome: "hold",
      message: "Status unavailable. Select Check status to try again.",
    };
  }
  if (receiptStatus === "not-found") {
    return {
      outcome: "hold",
      message:
        "Still waiting for the transaction. Check your wallet activity, then select Check status.",
    };
  }
  return {
    outcome: "hold",
    message: "Waiting for confirmation. Select Check status to check again.",
  };
}

type StockPairedActionState = ClassicV3ActionState & {
  pendingStage?: StockPairedPendingStage;
  claimTransactionHash?: Hex;
  amountIn?: string;
};

export type PendingProfileTransactionSource =
  | "classic"
  | "classic-v3"
  | "deep"
  | "stock-paired";

export type PendingProfileTransactionRecord = {
  version: 1;
  account: string;
  chainId: 1 | 11_155_111;
  source: PendingProfileTransactionSource;
  stateKey: string;
  action: "claim" | "claim-as-eth" | "update-payout";
  transactionHash: Hex;
  submittedAt: number;
  pendingStage?: StockPairedPendingStage;
  claimTransactionHash?: Hex;
  amountIn?: string;
};

export function stockPairedCheckpointAfterReceipt(
  record: PendingProfileTransactionRecord,
  outcome: "advance" | "reverted",
): PendingProfileTransactionRecord | null {
  if (
    record.source !== "stock-paired" ||
    record.action !== "claim-as-eth" ||
    !record.pendingStage ||
    !record.claimTransactionHash ||
    !record.amountIn
  ) {
    return null;
  }
  if (outcome === "advance") {
    return record.pendingStage === "swap" ? null : record;
  }
  if (record.pendingStage === "claim") return null;
  return {
    ...record,
    transactionHash: record.claimTransactionHash,
    pendingStage: "claim",
  };
}

export type ProfileViewProps = {
  onchainData?: ProfileOnchainData;
  viewChainId?: ViewChainId;
  onChangeChain?: (chain: ViewChainId) => void;
};

type ProfileWorkspaceSourceStatus =
  | ProfileOnchainData["status"]
  | ClassicV3ProfileRewards["status"]
  | DeepProfileRewards["status"]
  | DeepV3CreatorProfile["status"]
  | StockPairedProfileRewards["status"];

export type ProfileWorkspacePhase = "loading" | "ready" | "error";
export type ProfileSessionView = "loading" | "connect" | "profile";

export function getProfileSessionView(
  connecting: boolean,
  account?: string,
): ProfileSessionView {
  if (connecting) return "loading";
  return account ? "profile" : "connect";
}

export function getProfileWorkspacePhase(
  statuses: readonly ProfileWorkspaceSourceStatus[],
  terminalErrorReady: boolean,
  integrityConflict = false,
): ProfileWorkspacePhase {
  if (integrityConflict) return "error";
  if (statuses.some((status) => status === "loading")) {
    return "loading";
  }
  if (statuses.some((status) => status === "ready")) return "ready";
  if (!terminalErrorReady) return "loading";
  return "error";
}

export function getProfileRewardDataQuality(
  statuses: readonly ProfileWorkspaceSourceStatus[],
  classicQuality: ClassicV3ProfileSourceQuality,
  creatorQuality: "current" | "stale" = "current",
): ProfileRewardDataQuality {
  if (classicQuality === "stale" || creatorQuality === "stale") {
    return "stale";
  }
  if (
    classicQuality === "unavailable" ||
    statuses.some((status) => status === "error")
  ) {
    return "partial";
  }
  return "current";
}

export function profileClaimSubmissionAllowed(
  quality: ProfileRewardDataQuality,
) {
  return quality === "current";
}

export function resolveCreatorProfileReadFailure(
  current: ProfileOnchainData,
  account: string,
  caught: unknown,
): ProfileOnchainData {
  const kind =
    caught instanceof ProfileResponseError ? caught.kind : "integrity";
  if (
    kind === "temporary" &&
    isProfileDataForAccount(current, account) &&
    current.status === "ready"
  ) {
    return { ...current, sourceQuality: "stale" };
  }
  return errorProfileData(
    account,
    kind === "temporary"
      ? "Onchain creator data is temporarily unavailable"
      : "Current creator reward data could not be verified",
    kind,
  );
}

const walletChangedBeforeSubmission =
  "The connected wallet changed before submission";
const insufficientNetworkFee =
  "This wallet needs more ETH to cover the network fee";
const transactionCancelledInWallet = "Transaction cancelled in wallet";
const creatorClaimNotSubmitted =
  "The claim status could not be confirmed. Check your wallet activity before trying again.";

export function walletActionWasCancelled(error: unknown) {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== "object") break;
    const record = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (record.code === 4001 || record.code === "ACTION_REJECTED") return true;
    if (
      typeof record.message === "string" &&
      /(?:user|request|transaction).*(?:cancelled|canceled|denied|rejected)|(?:cancelled|canceled) in wallet/iu.test(
        record.message,
      )
    ) {
      return true;
    }
    current = record.cause;
  }
  return false;
}

export function profileCreatorClaimErrorMessage(error: unknown) {
  if (walletActionWasCancelled(error)) {
    return "Transaction cancelled. Rewards remain available.";
  }
  if (
    error instanceof CreatorClaimClientError &&
    error.code !== "invalid-response" &&
    error.code !== "response-mismatch"
  ) {
    return error.message;
  }
  if (
    error instanceof Error &&
    (error.message === walletChangedBeforeSubmission ||
      error.message === insufficientNetworkFee ||
      error.message === transactionCancelledInWallet)
  ) {
    return error.message === transactionCancelledInWallet
      ? "Transaction cancelled. Your rewards are still available to claim."
      : error.message;
  }
  return creatorClaimNotSubmitted;
}

export function profileRewardActionErrorMessage(
  error: unknown,
  action: "claim" | "update-payout" = "claim",
) {
  if (walletActionWasCancelled(error)) {
    return "Transaction cancelled. Rewards remain available.";
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (
      message === walletChangedBeforeSubmission ||
      message === insufficientNetworkFee ||
      /^(?:Connect an Ethereum wallet|Your wallet session expired|The wallet session changed|Wallet connection was interrupted|The wallet could not open|This wallet needs more ETH|There are no rewards to claim|The reward action could not be simulated)/u.test(
        message,
      )
    ) {
      return message;
    }
  }
  return action === "update-payout"
    ? "Unable to change the reward receiver. Try again."
    : "Unable to claim. Try again.";
}

const pendingProfileTransactionStoragePrefix =
  "programmable:profile-pending-transactions:v1:";
const maximumPersistedProfileTransactions = 32;
const terminalProfileErrorDelayMs = 2_500;
const ethereumAddressPattern = /^0x[0-9a-f]{40}$/;
const ethereumBytes32Pattern = /^0x[0-9a-f]{64}$/;

function shortenAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

type ProfileLinkKind = "x" | "website" | "github";

function resolveProfileLink(value: string, kind: ProfileLinkKind) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withoutAt = trimmed.replace(/^@/, "");
  const candidate = /^https?:\/\//iu.test(trimmed)
    ? trimmed
    : kind === "x"
      ? `https://x.com/${withoutAt}`
      : kind === "github"
        ? `https://github.com/${withoutAt}`
        : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password ||
      !url.hostname
    ) {
      return null;
    }
    const label =
      kind === "website"
        ? url.hostname.replace(/^www\./iu, "")
        : url.pathname.split("/").filter(Boolean)[0] ?? url.hostname;
    return { href: url.toString(), label };
  } catch {
    return null;
  }
}

function getFallbackTokenImage(address: string) {
  const suffix = Number.parseInt(address.slice(-8), 16);
  const index = Number.isFinite(suffix)
    ? suffix % fallbackTokenImages.length
    : 0;
  return fallbackTokenImages[index];
}

function formatEth(value?: string) {
  if (!value?.trim()) return "—";
  const normalized = value.trim().replace(/\s*ETH$/i, "");
  const [whole = "0", fraction = ""] = normalized.split(".");
  const compactFraction = fraction.replace(/0+$/, "").slice(0, 6);
  return `${whole}${compactFraction ? `.${compactFraction}` : ""} ETH`;
}

function formatWei(value: bigint) {
  return formatEth(formatUnits(value, 18));
}

function metricNumber(value: string | undefined) {
  if (!value || !/^(?:0|[1-9][0-9]*)$/u.test(value)) return null;
  const parsed = Number(formatUnits(BigInt(value), 18));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function profileTokenMarketCapLabel(token: ProfileToken) {
  const usd = metricNumber(token.fdvUsdWad);
  if (usd !== null) return formatMarketCapMetric({ kind: "usd", value: usd });
  const quote = metricNumber(token.marketCapQuoteWad);
  if (quote !== null && token.quoteAssetSymbol?.trim()) {
    return formatMarketCapMetric({
      kind: "quote",
      symbol: token.quoteAssetSymbol.trim(),
      value: quote,
    });
  }
  const eth = metricNumber(token.marketCapEthWei);
  return eth === null
    ? null
    : formatMarketCapMetric({ kind: "eth", value: eth });
}

function formatStockRewardEstimate(
  reward: Pick<
    StockPairedReward,
    "estimatedEth" | "estimatedUsd"
  >,
) {
  if (!reward.estimatedEth || !reward.estimatedUsd) return "";
  const usd = Number(reward.estimatedUsd);
  if (!Number.isFinite(usd) || usd <= 0) return "";
  const formattedUsd = new Intl.NumberFormat("en-US", {
    notation: usd >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: usd < 1 ? 3 : 2,
  }).format(usd);
  return `≈ $${formattedUsd} · ${formatEth(reward.estimatedEth)}`;
}

export type StockPairedClaimPath =
  | "quote-asset"
  | "quote-asset-to-eth";

export function getStockPairedClaimPaths(
  reward: Pick<
    StockPairedReward,
    "estimatedEth" | "estimatedUsd" | "payoutAddress"
  >,
  account?: string,
): readonly StockPairedClaimPath[] {
  const canConvertToEth =
    Boolean(account) &&
    reward.payoutAddress.toLowerCase() === account?.toLowerCase() &&
    Boolean(formatStockRewardEstimate(reward));

  return canConvertToEth
    ? ["quote-asset", "quote-asset-to-eth"]
    : ["quote-asset"];
}

export function shouldShowStockPairedEthClaimPath(
  reward: Pick<
    StockPairedReward,
    "estimatedEth" | "estimatedUsd" | "payoutAddress"
  >,
  account?: string,
  recovery?: Pick<
    StockPairedActionState,
    "claimTransactionHash" | "amountIn"
  >,
) {
  return (
    getStockPairedClaimPaths(reward, account).includes(
      "quote-asset-to-eth",
    ) || Boolean(recovery?.claimTransactionHash && recovery.amountIn)
  );
}

type WaitForTransactionOptions = {
  maxAttempts?: number;
  intervalMs?: number;
  requestTimeoutMs?: number;
  overallTimeoutMs?: number;
  fetcher?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
  signal?: AbortSignal;
  policy?: "stock-paired";
};

const PROFILE_TRANSACTION_REQUEST_TIMEOUT_MS = 15_000;
const PROFILE_TRANSACTION_OVERALL_TIMEOUT_MS = 75_000;

class ProfileTransactionPollTimeoutError extends Error {
  constructor() {
    super("Transaction status check timed out");
    this.name = "ProfileTransactionPollTimeoutError";
  }
}

function throwIfTransactionPollAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Transaction polling aborted", "AbortError");
}

function waitForTransactionInterval(
  milliseconds: number,
  signal?: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    try {
      throwIfTransactionPollAborted(signal);
    } catch (caught) {
      reject(caught);
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new DOMException("Transaction polling aborted", "AbortError"),
      );
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function runBoundedTransactionPollStep<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<T> {
  throwIfTransactionPollAborted(parentSignal);
  const controller = new AbortController();
  const timeoutError = new ProfileTransactionPollTimeoutError();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rejectForParentAbort: ((reason?: unknown) => void) | undefined;
  const parentAbort = new Promise<never>((_, reject) => {
    rejectForParentAbort = reject;
  });
  const abortFromParent = () => {
    const reason = parentSignal?.reason instanceof Error
      ? parentSignal.reason
      : new DOMException("Transaction polling aborted", "AbortError");
    controller.abort(reason);
    rejectForParentAbort?.(reason);
  };
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, Math.max(1, timeoutMs));
  });

  try {
    return await Promise.race([
      operation(controller.signal),
      deadline,
      parentAbort,
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

export async function waitForTransaction(
  transactionHash: Hex,
  chainId: number,
  options: WaitForTransactionOptions = {},
): Promise<"pending" | "not-found" | "confirmed" | "reverted"> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 40));
  const intervalMs = options.intervalMs ?? 1_500;
  const requestTimeoutMs = Math.max(
    1,
    Math.floor(
      options.requestTimeoutMs ?? PROFILE_TRANSACTION_REQUEST_TIMEOUT_MS,
    ),
  );
  const overallTimeoutMs = Math.max(
    1,
    Math.floor(
      options.overallTimeoutMs ?? PROFILE_TRANSACTION_OVERALL_TIMEOUT_MS,
    ),
  );
  const deadlineAt = Date.now() + overallTimeoutMs;
  const fetcher = options.fetcher ?? fetch;
  const wait =
    options.wait ??
    ((milliseconds: number) =>
      waitForTransactionInterval(milliseconds, options.signal));

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    throwIfTransactionPollAborted(options.signal);
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) return "pending";
    let response: Response;
    let body: {
      status?: "pending" | "not-found" | "confirmed" | "reverted";
    };
    try {
      ({ response, body } = await runBoundedTransactionPollStep(
        async (signal) => {
          const nextResponse = await fetcher(
            `/api/transaction-status?hash=${encodeURIComponent(
              transactionHash,
            )}&chainId=${chainId}${
              options.policy ? `&policy=${options.policy}` : ""
            }`,
            {
              method: "GET",
              cache: "no-store",
              headers: { Accept: "application/json" },
              signal,
            },
          );
          const nextBody = (await nextResponse.json()) as {
            status?: "pending" | "not-found" | "confirmed" | "reverted";
          };
          return { response: nextResponse, body: nextBody };
        },
        Math.min(requestTimeoutMs, remainingMs),
        options.signal,
      ));
    } catch (caught) {
      if (caught instanceof ProfileTransactionPollTimeoutError) return "pending";
      throw caught;
    }
    throwIfTransactionPollAborted(options.signal);
    if (!response.ok) {
      throw new Error("The transaction status could not be checked");
    }
    if (
      body.status !== "pending" &&
      body.status !== "not-found" &&
      body.status !== "confirmed" &&
      body.status !== "reverted"
    ) {
      throw new Error("The transaction status response was invalid");
    }
    if (body.status === "confirmed" || body.status === "reverted") {
      return body.status;
    }
    if (attempt === maxAttempts - 1) return body.status;
    if (attempt < maxAttempts - 1) {
      const remainingAfterRequestMs = deadlineAt - Date.now();
      if (remainingAfterRequestMs <= 0) return "pending";
      try {
        await runBoundedTransactionPollStep(
          () => wait(Math.min(intervalMs, remainingAfterRequestMs)),
          remainingAfterRequestMs,
          options.signal,
        );
      } catch (caught) {
        if (caught instanceof ProfileTransactionPollTimeoutError) {
          return "pending";
        }
        throw caught;
      }
      throwIfTransactionPollAborted(options.signal);
    }
  }
  return "pending";
}

export function resolveProfileNotFoundTransaction(retryAllowed: boolean) {
  return retryAllowed
    ? Object.freeze({
        release: true,
        status: "error" as const,
        message: "No transaction was found. You can submit the claim again.",
        recoverable: true as const,
      })
    : Object.freeze({
        release: false,
        status: "not-found" as const,
        message:
          "Still waiting for the transaction. Check your wallet activity, then select Check status.",
      });
}

type RecoverableTransactionActionState = {
  status: string;
  message: string;
  transactionHash?: Hex;
};

export function preserveInterruptedTransactionStates<
  T extends RecoverableTransactionActionState,
>(states: Record<string, T>): Record<string, T> {
  let changed = false;
  const next = { ...states };

  for (const [key, state] of Object.entries(states)) {
    if (state.status !== "confirming" || !state.transactionHash) continue;
    next[key] = {
      ...state,
      status: "pending",
      message: "Waiting for confirmation. Select Check status to check again.",
    };
    changed = true;
  }

  return changed ? next : states;
}

export function profileTransactionPollAttempts(manualCheck: boolean) {
  return manualCheck ? 1 : 40;
}

function normalizeEthereumAddress(value: string) {
  const normalized = value.trim().toLowerCase();
  return ethereumAddressPattern.test(normalized) ? normalized : null;
}

export function publicProfileAccountFromQuery(
  queryAccounts: readonly string[],
  connectedAccount?: string,
) {
  if (queryAccounts.length !== 1) return null;
  const requestedAccount = normalizeEthereumAddress(queryAccounts[0] ?? "");
  if (!requestedAccount) return null;
  return requestedAccount === connectedAccount?.toLowerCase()
    ? null
    : requestedAccount;
}

function isPendingProfileTransactionRecord(
  value: unknown,
  expectedAccount: string,
): value is PendingProfileTransactionRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const record = value as Partial<PendingProfileTransactionRecord>;
  const account =
    typeof record.account === "string"
      ? normalizeEthereumAddress(record.account)
      : null;
  const transactionHash =
    typeof record.transactionHash === "string"
      ? record.transactionHash.toLowerCase()
      : "";
  const stateKey =
    typeof record.stateKey === "string" ? record.stateKey.toLowerCase() : "";
  const validSource =
    record.source === "classic" ||
    record.source === "classic-v3" ||
    record.source === "deep" ||
    record.source === "stock-paired";
  const validAction =
    record.action === "claim" ||
    record.action === "claim-as-eth" ||
    record.action === "update-payout";
  const validNetwork = record.chainId === 1 || record.chainId === 11_155_111;
  const validSubmittedAt =
    typeof record.submittedAt === "number" &&
    Number.isSafeInteger(record.submittedAt) &&
    record.submittedAt > 0;

  if (
    record.version !== 1 ||
    account !== expectedAccount ||
    !ethereumBytes32Pattern.test(transactionHash) ||
    !validSource ||
    !validAction ||
    !validNetwork ||
    !validSubmittedAt
  ) {
    return false;
  }

  if (record.source === "classic") {
    return (
      record.action === "claim" &&
      record.pendingStage === undefined &&
      record.claimTransactionHash === undefined &&
      record.amountIn === undefined &&
      ethereumBytes32Pattern.test(stateKey)
    );
  }

  const [vaultAddress, stateAction, extra] = stateKey.split(":");
  const validStateKey =
    extra === undefined &&
    ethereumAddressPattern.test(vaultAddress ?? "") &&
    stateAction === record.action;
  if (!validStateKey) return false;

  if (record.source !== "stock-paired") {
    return (
      record.action !== "claim-as-eth" &&
      record.pendingStage === undefined &&
      record.claimTransactionHash === undefined &&
      record.amountIn === undefined
    );
  }

  if (record.action !== "claim-as-eth") {
    return (
      record.pendingStage === undefined &&
      record.claimTransactionHash === undefined &&
      record.amountIn === undefined
    );
  }

  const validPendingStage =
    record.pendingStage === "claim" ||
    record.pendingStage === "token-to-permit2" ||
    record.pendingStage === "permit2-to-router" ||
    record.pendingStage === "swap";
  const claimTransactionHash =
    typeof record.claimTransactionHash === "string"
      ? record.claimTransactionHash.toLowerCase()
      : "";
  return (
    validPendingStage &&
    ethereumBytes32Pattern.test(claimTransactionHash) &&
    typeof record.amountIn === "string" &&
    /^[1-9]\d{0,77}$/.test(record.amountIn)
  );
}

export function parsePendingProfileTransactions(
  serialized: string | null | undefined,
  account: string,
): PendingProfileTransactionRecord[] {
  const normalizedAccount = normalizeEthereumAddress(account);
  if (!normalizedAccount || !serialized) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];

  const envelope = parsed as { version?: unknown; transactions?: unknown };
  if (envelope.version !== 1 || !Array.isArray(envelope.transactions)) return [];

  const uniqueRecords = new Map<string, PendingProfileTransactionRecord>();
  for (const value of envelope.transactions.slice(
    -maximumPersistedProfileTransactions,
  )) {
    if (!isPendingProfileTransactionRecord(value, normalizedAccount)) continue;
    const record = value as PendingProfileTransactionRecord;
    const normalizedRecord: PendingProfileTransactionRecord = {
      ...record,
      account: normalizedAccount,
      stateKey: record.stateKey.toLowerCase(),
      transactionHash: record.transactionHash.toLowerCase() as Hex,
      ...(record.claimTransactionHash
        ? {
            claimTransactionHash:
              record.claimTransactionHash.toLowerCase() as Hex,
          }
        : {}),
    };
    uniqueRecords.set(
      `${normalizedRecord.source}:${normalizedRecord.stateKey}`,
      normalizedRecord,
    );
  }
  return [...uniqueRecords.values()];
}

export function upsertPendingProfileTransactionRecords(
  records: readonly PendingProfileTransactionRecord[],
  record: PendingProfileTransactionRecord,
): PendingProfileTransactionRecord[] {
  const normalized = parsePendingProfileTransactions(
    JSON.stringify({ version: 1, transactions: [record] }),
    record.account,
  )[0];
  if (!normalized) return [...records];

  const matchingRecord = records.find(
    (candidate) =>
      candidate.source === normalized.source &&
      candidate.stateKey === normalized.stateKey &&
      candidate.transactionHash.toLowerCase() ===
        normalized.transactionHash.toLowerCase(),
  );
  const nextRecord = matchingRecord
    ? { ...normalized, submittedAt: matchingRecord.submittedAt }
    : normalized;

  return [
    ...records.filter(
      (candidate) =>
        candidate.source !== nextRecord.source ||
        candidate.stateKey !== nextRecord.stateKey,
    ),
    nextRecord,
  ].slice(-maximumPersistedProfileTransactions);
}

export function removePendingProfileTransactionRecord(
  records: readonly PendingProfileTransactionRecord[],
  target: Pick<
    PendingProfileTransactionRecord,
    "source" | "stateKey" | "transactionHash"
  >,
): PendingProfileTransactionRecord[] {
  return records.filter(
    (record) =>
      record.source !== target.source ||
      record.stateKey !== target.stateKey.toLowerCase() ||
      record.transactionHash.toLowerCase() !==
        target.transactionHash.toLowerCase(),
  );
}

export function clearConfirmedProfileActionStates<
  T extends RecoverableTransactionActionState,
>(
  states: Record<string, T>,
  confirmed: ReadonlyMap<string, Hex>,
): Record<string, T> {
  let changed = false;
  const next = { ...states };

  for (const [stateKey, transactionHash] of confirmed) {
    const state = states[stateKey];
    if (
      state?.status !== "confirmed" ||
      state.transactionHash?.toLowerCase() !== transactionHash.toLowerCase()
    ) {
      continue;
    }
    delete next[stateKey];
    changed = true;
  }

  return changed ? next : states;
}

export function reflectedConfirmedProfileTransactions(
  confirmed: ReadonlyMap<string, Hex>,
  claimableForStateKey: (stateKey: string) => bigint | undefined,
) {
  return new Map(
    [...confirmed].filter(([stateKey]) =>
      claimableForStateKey(stateKey) === 0n,
    ),
  );
}

function pendingProfileTransactionStorageKey(account: string) {
  const normalizedAccount = normalizeEthereumAddress(account);
  return normalizedAccount
    ? `${pendingProfileTransactionStoragePrefix}${normalizedAccount}`
    : null;
}

function readPendingProfileTransactions(
  storage: Storage,
  account: string,
): PendingProfileTransactionRecord[] {
  const storageKey = pendingProfileTransactionStorageKey(account);
  if (!storageKey) return [];
  return parsePendingProfileTransactions(storage.getItem(storageKey), account);
}

function writePendingProfileTransactions(
  storage: Storage,
  account: string,
  records: readonly PendingProfileTransactionRecord[],
) {
  const storageKey = pendingProfileTransactionStorageKey(account);
  if (!storageKey) return;
  if (records.length === 0) {
    storage.removeItem(storageKey);
    return;
  }
  storage.setItem(
    storageKey,
    JSON.stringify({ version: 1, transactions: records }),
  );
}

function persistPendingProfileTransaction(
  record: PendingProfileTransactionRecord,
) {
  if (typeof window === "undefined") return;
  try {
    const records = readPendingProfileTransactions(
      window.localStorage,
      record.account,
    );
    writePendingProfileTransactions(
      window.localStorage,
      record.account,
      upsertPendingProfileTransactionRecords(records, record),
    );
  } catch {
    // A blocked storage layer must not interrupt an already-submitted transaction.
  }
}

function forgetPendingProfileTransaction(
  target: Pick<
    PendingProfileTransactionRecord,
    "account" | "source" | "stateKey" | "transactionHash"
  >,
) {
  if (typeof window === "undefined") return;
  try {
    const records = readPendingProfileTransactions(
      window.localStorage,
      target.account,
    );
    writePendingProfileTransactions(
      window.localStorage,
      target.account,
      removePendingProfileTransactionRecord(records, target),
    );
  } catch {
    // The confirmed receipt remains authoritative if browser storage is blocked.
  }
}

function restoredPendingProfileActionState(
  record: PendingProfileTransactionRecord,
): StockPairedActionState {
  return {
    account: record.account,
    status: "pending",
    message: "Waiting for confirmation. Select Check status to check again.",
    transactionHash: record.transactionHash,
    ...(record.source === "stock-paired" && record.pendingStage
      ? {
          pendingStage: record.pendingStage,
          claimTransactionHash: record.claimTransactionHash,
          amountIn: record.amountIn,
        }
      : {}),
  };
}

export function groupPendingProfileTransactionStates(
  records: readonly PendingProfileTransactionRecord[],
) {
  const grouped: Record<
    PendingProfileTransactionSource,
    Record<string, ProfileClaimActionState>
  > = {
    classic: {},
    "classic-v3": {},
    deep: {},
    "stock-paired": {},
  };
  for (const record of records) {
    grouped[record.source][record.stateKey] =
      restoredPendingProfileActionState(record);
  }
  return grouped;
}

function consumeConfirmedProfileTransactions(
  active: Map<string, Hex>,
  consumed: ReadonlyMap<string, Hex>,
) {
  for (const [stateKey, transactionHash] of consumed) {
    if (
      active.get(stateKey)?.toLowerCase() === transactionHash.toLowerCase()
    ) {
      active.delete(stateKey);
    }
  }
}

function useWalletLocalProfile(address?: string) {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!address) return () => undefined;

      const storageKey = getProfileStorageKey(address);
      const handleStorage = (event: StorageEvent) => {
        if (event.key === storageKey) listener();
      };
      const handleProfileUpdated = (event: Event) => {
        const detail = (
          event as CustomEvent<{
            address?: string;
          }>
        ).detail;

        if (detail?.address?.toLowerCase() === address.toLowerCase()) {
          listener();
        }
      };

      window.addEventListener("storage", handleStorage);
      window.addEventListener(PROFILE_UPDATED_EVENT, handleProfileUpdated);

      return () => {
        window.removeEventListener("storage", handleStorage);
        window.removeEventListener(PROFILE_UPDATED_EVENT, handleProfileUpdated);
      };
    },
    [address],
  );
  const getSnapshot = useCallback(() => {
    if (!address || typeof window === "undefined") return "";

    try {
      return window.localStorage.getItem(getProfileStorageKey(address)) ?? "";
    } catch {
      return "";
    }
  }, [address]);
  const storedProfile = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getEmptyProfileSnapshot,
  );

  return useMemo(() => parseLocalProfile(storedProfile), [storedProfile]);
}

function getEmptyProfileSnapshot() {
  return "";
}

function subscribeToClientHydration() {
  return () => undefined;
}

function getClientHydrationSnapshot() {
  return true;
}

function getServerHydrationSnapshot() {
  return false;
}

export function readProfileForEditor(
  storage: Parameters<typeof readLocalProfile>[0],
  address: string | undefined,
  fallback: ReturnType<typeof readLocalProfile>,
) {
  if (!address) return fallback;

  try {
    return readLocalProfile(storage, address);
  } catch {
    return fallback;
  }
}

export function withoutClosedDeepProfileData(
  data: ProfileOnchainData,
): ProfileOnchainData {
  const closedTokenAddresses = new Set(
    data.tokens
      .filter((token) => token.launchModel === "deep")
      .map((token) => token.address.toLowerCase()),
  );
  if (closedTokenAddresses.size === 0) return data;

  const referencesClosedToken = (value: string) => {
    const normalized = value.toLowerCase();
    return [...closedTokenAddresses].some((address) =>
      normalized.includes(address),
    );
  };

  return {
    ...data,
    tokens: data.tokens.filter((token) => token.launchModel !== "deep"),
    positions: data.positions.filter(
      (position) =>
        !closedTokenAddresses.has(position.tokenAddress.toLowerCase()),
    ),
    claims: data.claims.filter(
      (claim) => !closedTokenAddresses.has(claim.tokenAddress.toLowerCase()),
    ),
    activity: data.activity.filter(
      (activity) =>
        !referencesClosedToken(activity.href) &&
        !/\bdeep\b/iu.test(`${activity.label} ${activity.detail}`),
    ),
  };
}

type BannerPositionAxis = "horizontal" | "vertical";

export function formatBannerPositionValue(
  axis: BannerPositionAxis,
  value: number,
) {
  const roundedValue = Math.max(0, Math.min(100, Math.round(value)));
  if (axis === "horizontal") {
    if (roundedValue === 0) return "aligned to the left edge";
    if (roundedValue === 50) return "centered horizontally";
    if (roundedValue === 100) return "aligned to the right edge";
    return `${roundedValue}% from the left`;
  }
  if (roundedValue === 0) return "aligned to the top edge";
  if (roundedValue === 50) return "centered vertically";
  if (roundedValue === 100) return "aligned to the bottom edge";
  return `${roundedValue}% from the top`;
}

export function formatBannerPositionStatus(position: {
  x: number;
  y: number;
}) {
  return `Banner position: ${formatBannerPositionValue(
    "horizontal",
    position.x,
  )}, ${formatBannerPositionValue("vertical", position.y)}.`;
}

export function ProfileView({ onchainData, viewChainId = 4663, onChangeChain }: ProfileViewProps = {}) {
  const ethereumView = viewChainId === 1;
  const {
    wallet,
    openWallet,
    sendTransaction,
    connecting,
    hasSession,
  } = useWallet();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const profileImageRequestRef = useRef(0);
  const bannerDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const account = wallet?.account;
  const activeAccountRef = useRef(account);
  const transactionPollControllersRef = useRef<Set<AbortController>>(
    new Set(),
  );
  const autoResumingProfileTransactionsRef = useRef<Set<string>>(new Set());
  const autoReconciledProfileTransactionsRef = useRef<Set<string>>(new Set());
  const stockPairedActionLocksRef = useRef<Set<string>>(new Set());
  const hydratedPendingAccountRef = useRef<string | undefined>(undefined);
  const profileRefreshSequenceRef = useRef(0);
  const activeProfileRefreshRef = useRef<ActiveProfileRefresh | null>(null);
  const confirmedProfileTransactionsRef = useRef<
    Record<PendingProfileTransactionSource, Map<string, Hex>>
  >({
    classic: new Map(),
    "classic-v3": new Map(),
    deep: new Map(),
    "stock-paired": new Map(),
  });
  const savedProfile = useWalletLocalProfile(account);
  const clientHydrated = useSyncExternalStore(
    subscribeToClientHydration,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot,
  );
  const [editingAccount, setEditingAccount] = useState("");
  const [usernameDraft, setUsernameDraft] = useState("");
  const [avatarDraft, setAvatarDraft] = useState("");
  const [bannerDraft, setBannerDraft] = useState("");
  const [bannerPositionDraft, setBannerPositionDraft] = useState({
    x: 50,
    y: 50,
  });
  const [bioDraft, setBioDraft] = useState("");
  const [xUrlDraft, setXUrlDraft] = useState("");
  const [websiteUrlDraft, setWebsiteUrlDraft] = useState("");
  const [githubUrlDraft, setGithubUrlDraft] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [avatarError, setAvatarError] = useState("");
  const [bannerError, setBannerError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [preparingImage, setPreparingImage] = useState(false);
  const [remoteOnchainData, setRemoteOnchainData] =
    useState<ProfileOnchainData>(UNAVAILABLE_PROFILE_DATA);
  const [profileRefresh, setProfileRefresh] = useState(0);
  const [profileRefreshState, setProfileRefreshState] = useState({
    account: "",
    active: false,
    id: 0,
  });
  const [profileRefreshAnnouncement, setProfileRefreshAnnouncement] = useState({
    account: "",
    message: "",
  });
  const liveProfileRefresh = useLiveDataRefresh({
    enabled: Boolean(account) && ethereumView,
    intervalMs: PROFILE_LIVE_REFRESH_INTERVAL_MS,
  });
  const [terminalErrorReadyKey, setTerminalErrorReadyKey] = useState("");
  const [classicV3Rewards, setClassicV3Rewards] =
    useState<ClassicV3ProfileRewards>(EMPTY_CLASSIC_V3_PROFILE);
  const [classicV3SourceState, setClassicV3SourceState] =
    useState<ClassicV3ProfileSourceState>({ quality: "idle" });
  const [deepRewards, setDeepRewards] =
    useState<DeepProfileRewards>(EMPTY_DEEP_PROFILE);
  const [deepV3Profile, setDeepV3Profile] =
    useState<DeepV3CreatorProfile>(EMPTY_DEEP_V3_CREATOR_PROFILE);
  const [stockPairedRewards, setStockPairedRewards] =
    useState<StockPairedProfileRewards>(EMPTY_STOCK_PAIRED_PROFILE);
  const [claimActionStates, setClaimActionStates] = useState<
    Record<string, ProfileClaimActionState>
  >({});
  const [classicV3ActionStates, setClassicV3ActionStates] = useState<
    Record<string, ClassicV3ActionState>
  >({});
  const [deepActionStates, setDeepActionStates] = useState<
    Record<string, DeepActionState>
  >({});
  const [stockPairedActionStates, setStockPairedActionStates] = useState<
    Record<string, StockPairedActionState>
  >({});
  const editingProfile =
    Boolean(account) && editingAccount === account?.toLowerCase();
  const profileRefreshing =
    Boolean(account) &&
    profileRefreshState.active &&
    profileRefreshState.account === account?.toLowerCase();
  const profileRefreshStatusMessage =
    account &&
    profileRefreshAnnouncement.account === account.toLowerCase()
      ? profileRefreshAnnouncement.message
      : "";
  const profileLoadKey = account
    ? `${account.toLowerCase()}:${profileRefresh}`
    : "";
  const terminalErrorReady =
    Boolean(profileLoadKey) && terminalErrorReadyKey === profileLoadKey;
  const abortTransactionPolls = useCallback(() => {
    for (const controller of transactionPollControllersRef.current) {
      controller.abort();
    }
    transactionPollControllersRef.current.clear();
  }, []);
  const completeProfileRefreshSource = useCallback(
    (refreshId: number, source: ProfileRefreshSource) => {
      const active = activeProfileRefreshRef.current;
      if (!active || active.id !== refreshId) return;
      active.pending.delete(source);
      if (active.pending.size > 0) return;
      activeProfileRefreshRef.current = null;
      setProfileRefreshState((current) =>
        current.id === refreshId ? { ...current, active: false } : current
      );
      setProfileRefreshAnnouncement({
        account: active.account,
        message: "Rewards check complete.",
      });
    },
    [],
  );
  const requestProfileRefresh = useCallback(
    (manual = false) => {
      const refreshId = ++profileRefreshSequenceRef.current;
      if (manual && account) {
        const pending = new Set<ProfileRefreshSource>();
        if (!onchainData) pending.add("creator");
        if (classicV3ReleaseAvailable) pending.add("classic-v3");
        if (deepReleaseAvailable) pending.add("deep");
        if (deepV3ReleaseAvailable) pending.add("deep-v3");
        if (stockPairedReleaseAvailable) pending.add("stock-paired");
        activeProfileRefreshRef.current = pending.size
          ? {
              account: account.toLowerCase(),
              id: refreshId,
              pending,
            }
          : null;
        setProfileRefreshState({
          account: account.toLowerCase(),
          active: pending.size > 0,
          id: refreshId,
        });
        setProfileRefreshAnnouncement({
          account: account.toLowerCase(),
          message: pending.size
            ? "Refreshing rewards."
            : "Rewards are already current.",
        });
      } else if (!manual && account) {
        const active = activeProfileRefreshRef.current;
        if (active?.account === account.toLowerCase()) {
          activeProfileRefreshRef.current = { ...active, id: refreshId };
          setProfileRefreshState((current) =>
            current.active ? { ...current, id: refreshId } : current
          );
        }
      }
      setProfileRefresh(refreshId);
    },
    [account, onchainData],
  );

  useEffect(() => {
    const previousAccount = activeAccountRef.current?.toLowerCase();
    activeAccountRef.current = account;
    const normalizedAccount = account?.toLowerCase();

    if (previousAccount !== normalizedAccount) {
      abortTransactionPolls();
      autoResumingProfileTransactionsRef.current.clear();
      autoReconciledProfileTransactionsRef.current.clear();
      hydratedPendingAccountRef.current = undefined;
      for (const targets of Object.values(
        confirmedProfileTransactionsRef.current,
      )) {
        targets.clear();
      }
    }
    if (hydratedPendingAccountRef.current === normalizedAccount) return;

    let cancelled = false;
    if (!account || !normalizedAccount) {
      queueMicrotask(() => {
        if (cancelled) return;
        setClaimActionStates({});
        setClassicV3ActionStates({});
        setDeepActionStates({});
        setStockPairedActionStates({});
      });
      return () => {
        cancelled = true;
      };
    }

    let persisted: PendingProfileTransactionRecord[] = [];
    try {
      persisted = readPendingProfileTransactions(window.localStorage, account);
    } catch {
      persisted = [];
    }
    const restored = groupPendingProfileTransactionStates(persisted);
    hydratedPendingAccountRef.current = normalizedAccount;
    queueMicrotask(() => {
      if (cancelled) return;
      setClaimActionStates(restored.classic);
      setClassicV3ActionStates(restored["classic-v3"]);
      setDeepActionStates(restored.deep);
      setStockPairedActionStates(restored["stock-paired"]);
    });
    return () => {
      cancelled = true;
    };
  }, [abortTransactionPolls, account]);

  // A view change must not interrupt receipt tracking for an already submitted transaction.
  useEffect(
    () => () => {
      abortTransactionPolls();
    },
    [abortTransactionPolls],
  );

  useEffect(() => {
    if (!profileRefreshState.active) return;
    const refreshId = profileRefreshState.id;
    const timeout = window.setTimeout(() => {
      const active = activeProfileRefreshRef.current;
      if (!active || active.id !== refreshId) return;
      activeProfileRefreshRef.current = null;
      setProfileRefreshState((current) =>
        current.id === refreshId ? { ...current, active: false } : current
      );
      setProfileRefreshAnnouncement({
        account: active.account,
        message: "Rewards refresh took too long. Try again.",
      });
    }, PROFILE_MANUAL_REFRESH_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [profileRefreshState.active, profileRefreshState.id]);

  useEffect(() => {
    if (!profileLoadKey) return;
    const timeout = window.setTimeout(() => {
      setTerminalErrorReadyKey(profileLoadKey);
    }, terminalProfileErrorDelayMs);
    return () => window.clearTimeout(timeout);
  }, [profileLoadKey]);

  useEffect(() => {
    if (onchainData) return;
    if (!account || !ethereumView) return;

    const controller = new AbortController();
    const confirmedTransactions = new Map(
      confirmedProfileTransactionsRef.current.classic,
    );
    const cached = readCachedCreatorProfile(account);
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setRemoteOnchainData((current) =>
          isProfileDataForAccount(current, account) &&
            current.status === "ready"
            ? current
            : (cached ?? loadingProfileData(account))
        );
      }
    });

    void fetchCreatorProfile(account, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          cacheCreatorProfile(data);
          const reflectedTransactions =
            reflectedConfirmedProfileTransactions(
              confirmedTransactions,
              (stateKey) => {
                const claim = data.claims.find(
                  (entry) => entry.poolId.toLowerCase() === stateKey,
                );
                return claim ? BigInt(claim.claimableWei) : 0n;
              },
            );
          setRemoteOnchainData(data);
          setClaimActionStates((current) =>
            clearConfirmedProfileActionStates(current, reflectedTransactions),
          );
          consumeConfirmedProfileTransactions(
            confirmedProfileTransactionsRef.current.classic,
            reflectedTransactions,
          );
        }
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        const cached = readCachedCreatorProfile(account);
        setRemoteOnchainData((current) =>
          resolveCreatorProfileReadFailure(
            cached ??
              (current.status === "ready"
                ? UNAVAILABLE_PROFILE_DATA
                : current),
            account,
            caught,
          ),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          completeProfileRefreshSource(profileRefresh, "creator");
        }
      });

    return () => controller.abort();
  }, [
    account,
    completeProfileRefreshSource,
    liveProfileRefresh,
    onchainData,
    profileRefresh,
    ethereumView,
  ]);

  useEffect(() => {
    if (!account || !ethereumView || !classicV3ReleaseAvailable) return;
    const controller = new AbortController();
    let cancelled = false;
    const cachedProfile = readCachedClassicV3Profile(account);
    if (cachedProfile) {
      queueMicrotask(() => {
        if (cancelled || controller.signal.aborted) return;
        setClassicV3Rewards((current) =>
          current.status === "ready" &&
            current.account?.toLowerCase() === account.toLowerCase()
            ? current
            : cachedProfile.data
        );
        setClassicV3SourceState((current) =>
          current.account?.toLowerCase() === account.toLowerCase() &&
            current.quality === "current"
            ? current
            : {
                account,
                quality: "stale",
                verifiedAt: cachedProfile.verifiedAt,
              }
        );
      });
    }
    const confirmedTransactions = new Map(
      confirmedProfileTransactionsRef.current["classic-v3"],
    );
    void fetchClassicV3ProfileRewards(account, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          const reflectedTransactions =
            reflectedConfirmedProfileTransactions(
              confirmedTransactions,
              (stateKey) => {
                if (stateKey.includes(":update-payout")) return 0n;
                const vaultAddress = stateKey.split(":")[0];
                const reward = data.rewards.find(
                  (entry) =>
                    entry.vaultAddress.toLowerCase() === vaultAddress,
                );
                return reward ? BigInt(reward.claimableWei) : 0n;
              },
            );
          setClassicV3Rewards(data);
          setClassicV3ActionStates((current) =>
            clearConfirmedProfileActionStates(current, reflectedTransactions),
          );
          consumeConfirmedProfileTransactions(
            confirmedProfileTransactionsRef.current["classic-v3"],
            reflectedTransactions,
          );
          const verifiedAt = cacheClassicV3Profile(data);
          setClassicV3SourceState({
            account,
            quality: "current",
            ...(verifiedAt ? { verifiedAt } : {}),
          });
        }
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        const failureKind =
          caught instanceof ClassicV3ProfileReadError
            ? caught.kind
            : "integrity";
        const cached = readCachedClassicV3Profile(account);
        if (failureKind === "temporary" && cached) {
          setClassicV3Rewards(cached.data);
          setClassicV3SourceState({
            account,
            quality: "stale",
            verifiedAt: cached.verifiedAt,
          });
          return;
        }
        setClassicV3Rewards({
          status: "error",
          account,
          rewards: [],
          errorMessage:
            failureKind === "integrity"
              ? "Classic reward data could not be verified"
              : "Classic rewards are temporarily unavailable",
        });
        setClassicV3SourceState({
          account,
          quality:
            failureKind === "integrity" ? "integrity" : "unavailable",
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          completeProfileRefreshSource(profileRefresh, "classic-v3");
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    account,
    completeProfileRefreshSource,
    liveProfileRefresh,
    profileRefresh,
    ethereumView,
  ]);

  useEffect(() => {
    if (!account || !ethereumView || !deepReleaseAvailable) return;
    const controller = new AbortController();
    const confirmedTransactions = new Map(
      confirmedProfileTransactionsRef.current.deep,
    );
    void fetchDeepProfileRewards(account, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          const reflectedTransactions =
            reflectedConfirmedProfileTransactions(
              confirmedTransactions,
              (stateKey) => {
                if (stateKey.endsWith(":update-payout")) return 0n;
                const vaultAddress = stateKey.split(":")[0];
                const reward = data.rewards.find(
                  (entry) =>
                    entry.vaultAddress.toLowerCase() === vaultAddress,
                );
                return reward ? BigInt(reward.claimableWei) : 0n;
              },
            );
          setDeepRewards(data);
          setDeepActionStates((current) =>
            clearConfirmedProfileActionStates(current, reflectedTransactions),
          );
          consumeConfirmedProfileTransactions(
            confirmedProfileTransactionsRef.current.deep,
            reflectedTransactions,
          );
        }
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setDeepRewards((current) =>
          current.status === "ready" &&
          current.account.toLowerCase() === account.toLowerCase()
            ? current
            : {
                status: "error",
                account,
                rewards: [],
                errorMessage:
                  caught instanceof Error
                    ? caught.message
                    : "Deep rewards could not be loaded",
              },
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          completeProfileRefreshSource(profileRefresh, "deep");
        }
      });
    return () => controller.abort();
  }, [
    account,
    completeProfileRefreshSource,
    liveProfileRefresh,
    profileRefresh,
    ethereumView,
  ]);

  useEffect(() => {
    if (!account || !ethereumView || !deepV3ReleaseAvailable) return;
    const controller = new AbortController();
    void fetchDeepV3CreatorProfile(account, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setDeepV3Profile(data);
        }
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setDeepV3Profile({
          status: "error",
          account,
          chainId: 1,
          tokens: [],
          errorMessage:
            caught instanceof Error
              ? caught.message
              : "Deep liquidity state could not be loaded",
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          completeProfileRefreshSource(profileRefresh, "deep-v3");
        }
      });
    return () => controller.abort();
  }, [
    account,
    completeProfileRefreshSource,
    liveProfileRefresh,
    profileRefresh,
    ethereumView,
  ]);

  useEffect(() => {
    if (!account || !ethereumView || !stockPairedReleaseAvailable) return;
    const controller = new AbortController();
    const confirmedTransactions = new Map(
      confirmedProfileTransactionsRef.current["stock-paired"],
    );
    void fetchStockPairedProfileRewards(account, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          const reflectedTransactions =
            reflectedConfirmedProfileTransactions(
              confirmedTransactions,
              (stateKey) => {
                if (stateKey.endsWith(":update-payout")) return 0n;
                const vaultAddress = stateKey.split(":")[0];
                const reward = data.rewards.find(
                  (entry) =>
                    entry.vaultAddress.toLowerCase() === vaultAddress,
                );
                return reward ? BigInt(reward.claimableRaw) : 0n;
              },
            );
          setStockPairedRewards(data);
          setStockPairedActionStates((current) =>
            clearConfirmedProfileActionStates(current, reflectedTransactions),
          );
          consumeConfirmedProfileTransactions(
            confirmedProfileTransactionsRef.current["stock-paired"],
            reflectedTransactions,
          );
        }
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setStockPairedRewards((current) =>
          current.status === "ready" &&
          current.account.toLowerCase() === account.toLowerCase()
            ? current
            : {
                status: "error",
                account,
                chainId: 1,
                rewards: [],
                errorMessage:
                  caught instanceof Error
                    ? caught.message
                    : "Stock-Paired rewards could not be loaded",
              },
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          completeProfileRefreshSource(profileRefresh, "stock-paired");
        }
      });
    return () => controller.abort();
  }, [
    account,
    completeProfileRefreshSource,
    liveProfileRefresh,
    profileRefresh,
    ethereumView,
  ]);

  function populateProfileDrafts(profile: typeof savedProfile) {
    setUsernameDraft(profile.username);
    setAvatarDraft(profile.avatarDataUrl);
    setBannerDraft(profile.bannerDataUrl ?? "");
    setBannerPositionDraft({
      x: profile.bannerPositionX ?? 50,
      y: profile.bannerPositionY ?? 50,
    });
    setBioDraft(profile.bio ?? "");
    setXUrlDraft(profile.xUrl ?? "");
    setWebsiteUrlDraft(profile.websiteUrl ?? "");
    setGithubUrlDraft(profile.githubUrl ?? "");
  }

  function latestProfileForEditor() {
    if (!account || typeof window === "undefined") return savedProfile;
    return readProfileForEditor(window.localStorage, account, savedProfile);
  }

  function beginEditingProfile() {
    populateProfileDrafts(latestProfileForEditor());
    profileImageRequestRef.current += 1;
    setPreparingImage(false);
    setUsernameError("");
    setAvatarError("");
    setBannerError("");
    setSaveError("");
    setEditingAccount(account?.toLowerCase() ?? "");
  }

  function cancelEditingProfile() {
    populateProfileDrafts(latestProfileForEditor());
    profileImageRequestRef.current += 1;
    setPreparingImage(false);
    setUsernameError("");
    setAvatarError("");
    setBannerError("");
    setSaveError("");
    setEditingAccount("");
  }

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account || preparingImage || !profileDraftBelongsToAccount(editingAccount, account)) return;

    const nextUsername = normalizeProfileUsername(usernameDraft);
    const nextUsernameError = getProfileUsernameError(nextUsername);

    if (nextUsernameError) {
      setUsernameError(nextUsernameError);
      return;
    }

    const nextProfile = {
      username: nextUsername,
      avatarDataUrl: avatarDraft,
      bannerDataUrl: bannerDraft,
      bannerPositionX: bannerPositionDraft.x,
      bannerPositionY: bannerPositionDraft.y,
      bio: bioDraft.trim().slice(0, 240),
      xUrl: xUrlDraft.trim(),
      websiteUrl: websiteUrlDraft.trim(),
      githubUrl: githubUrlDraft.trim(),
    };

    try {
      writeLocalProfile(window.localStorage, account, nextProfile);
    } catch {
      setSaveError("The profile could not be saved");
      return;
    }

    setUsernameDraft(nextUsername);
    setUsernameError("");
    setAvatarError("");
    setBannerError("");
    setSaveError("");
    setEditingAccount("");
    window.dispatchEvent(
      new CustomEvent(PROFILE_UPDATED_EVENT, {
        detail: {
          address: account.toLowerCase(),
          profile: nextProfile,
        },
      }),
    );
  }

  async function selectAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const editingWallet = editingAccount;
    const requestId = ++profileImageRequestRef.current;
    const currentRequest = () => requestId === profileImageRequestRef.current
      && profileDraftBelongsToAccount(editingWallet, activeAccountRef.current ?? "");

    setPreparingImage(true);
    setAvatarError("");
    setSaveError("");

    try {
      const image = await prepareAvatarImage(file);
      if (currentRequest()) setAvatarDraft(image);
    } catch (caught) {
      if (currentRequest()) setAvatarError(
        caught instanceof Error
          ? caught.message
          : "The image could not be prepared",
      );
    } finally {
      if (requestId === profileImageRequestRef.current) setPreparingImage(false);
    }
  }

  async function prepareBanner(file: File | undefined) {
    if (!file) return;
    const editingWallet = editingAccount;
    const requestId = ++profileImageRequestRef.current;
    const currentRequest = () => requestId === profileImageRequestRef.current
      && profileDraftBelongsToAccount(editingWallet, activeAccountRef.current ?? "");
    setPreparingImage(true);
    setBannerError("");
    setSaveError("");
    try {
      const image = await prepareProfileBannerImage(file);
      if (!currentRequest()) return;
      setBannerDraft(image);
      setBannerPositionDraft({ x: 50, y: 50 });
    } catch (caught) {
      if (currentRequest()) setBannerError(
        caught instanceof Error
          ? caught.message
          : "The banner could not be prepared",
      );
    } finally {
      if (requestId === profileImageRequestRef.current) setPreparingImage(false);
    }
  }

  async function selectBanner(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    await prepareBanner(file);
  }

  function startBannerDrag(event: PointerEvent<HTMLDivElement>) {
    if (!editingProfile || !bannerDraft) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    bannerDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: bannerPositionDraft.x,
      startY: bannerPositionDraft.y,
    };
  }

  function moveBannerDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = bannerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    setBannerPositionDraft({
      x: Math.max(
        0,
        Math.min(
          100,
          drag.startX -
            ((event.clientX - drag.startClientX) / bounds.width) * 100,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          100,
          drag.startY -
            ((event.clientY - drag.startClientY) / bounds.height) * 100,
        ),
      ),
    });
  }

  function stopBannerDrag(event: PointerEvent<HTMLDivElement>) {
    if (bannerDragRef.current?.pointerId !== event.pointerId) return;
    bannerDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  const cachedOnchainData =
    !onchainData && account ? readCachedCreatorProfile(account) : null;
  const remoteOrCachedOnchainData =
    account && isProfileDataForAccount(remoteOnchainData, account)
      ? remoteOnchainData
      : (cachedOnchainData ?? remoteOnchainData);
  const requestedOnchainData = withoutClosedDeepProfileData(
    onchainData ?? remoteOrCachedOnchainData,
  );
  const scopedOnchainData = account
    ? isProfileDataForAccount(requestedOnchainData, account)
      ? requestedOnchainData
      : loadingProfileData(account)
    : UNAVAILABLE_PROFILE_DATA;
  const creatorProjectMarketCaps = useMemo<readonly CreatorProjectMarketCapV1[]>(
    () => scopedOnchainData.tokens.map((token) => ({
      tokenAddress: token.address,
      usdWad: token.fdvUsdWad ?? null,
      ethWei: token.marketCapEthWei ?? null,
      label: profileTokenMarketCapLabel(token),
    })),
    [scopedOnchainData.tokens],
  );
  const creatorWalletProjects = useMemo<readonly CreatorProjectSummaryV1[]>(
    () => scopedOnchainData.tokens.map((token) => ({
      chainId: 1 as const,
      tokenAddress: token.address,
      name: token.name,
      symbol: token.symbol || null,
      imageUrl: token.imageUrl ?? null,
      ...(token.partnerAttribution
        ? { partnerAttribution: token.partnerAttribution }
        : {}),
      source: token.address.toLowerCase() === PROGRAMMABLE_MAIN_TOKEN_ADDRESS
        ? "official-main-token" as const
        : token.launchProvenance === "canonical-router"
          ? "canonical-launch-stamp-router" as const
          : "envio-classic-v3" as const,
      article: null,
    })),
    [scopedOnchainData.tokens],
  );
  const scopedClassicV3Rewards = useMemo<ClassicV3ProfileRewards>(() => {
    if (!account || !classicV3ReleaseAvailable) {
      return EMPTY_CLASSIC_V3_PROFILE;
    }
    return classicV3Rewards.account?.toLowerCase() === account.toLowerCase()
      ? classicV3Rewards
      : { status: "loading", account, rewards: [] };
  }, [account, classicV3Rewards]);
  const scopedClassicV3SourceState = useMemo<ClassicV3ProfileSourceState>(
    () => {
      if (!account || !classicV3ReleaseAvailable) return { quality: "idle" };
      return classicV3SourceState.account?.toLowerCase() ===
        account.toLowerCase()
        ? classicV3SourceState
        : { account, quality: "idle" };
    }, [account, classicV3SourceState],
  );
  const scopedDeepRewards = useMemo<DeepProfileRewards>(() => {
    if (!account || !deepReleaseAvailable) return EMPTY_DEEP_PROFILE;
    return deepRewards.account?.toLowerCase() === account.toLowerCase()
      ? deepRewards
      : { status: "loading", account, rewards: [] };
  }, [account, deepRewards]);
  const scopedDeepV3Profile = useMemo<DeepV3CreatorProfile>(() => {
    if (!account || !deepV3ReleaseAvailable) {
      return EMPTY_DEEP_V3_CREATOR_PROFILE;
    }
    return deepV3Profile.account?.toLowerCase() === account.toLowerCase()
      ? deepV3Profile
      : { status: "loading", account, tokens: [] };
  }, [account, deepV3Profile]);
  const scopedStockPairedRewards = useMemo<StockPairedProfileRewards>(() => {
    if (!account || !stockPairedReleaseAvailable) {
      return EMPTY_STOCK_PAIRED_PROFILE;
    }
    return stockPairedRewards.account?.toLowerCase() === account.toLowerCase()
      ? stockPairedRewards
      : { status: "loading", account, rewards: [] };
  }, [account, stockPairedRewards]);
  const settleSubmittedTransaction = useCallback(
    async ({
      transactionHash,
      chainId,
      actionAccount,
      source,
      stateKey,
      action,
      confirmedMessage,
      revertedMessage,
      setActionState,
      manualCheck = false,
      retryNotFound = false,
      submittedAt,
      policy,
    }: {
      transactionHash: Hex;
      chainId: 1 | 11_155_111;
      actionAccount: string;
      source: PendingProfileTransactionSource;
      stateKey: string;
      action: "claim" | "update-payout";
      confirmedMessage: string;
      revertedMessage: string;
      setActionState: (
        state: Omit<ProfileClaimActionState, "account">,
      ) => void;
      manualCheck?: boolean;
      retryNotFound?: boolean;
      submittedAt?: number;
      policy?: "stock-paired";
    }) => {
      const pendingTransaction: PendingProfileTransactionRecord = {
        version: 1,
        account: actionAccount.toLowerCase(),
        chainId,
        source,
        stateKey,
        action,
        transactionHash,
        submittedAt: submittedAt ?? Date.now(),
      };
      persistPendingProfileTransaction(pendingTransaction);
      if (
        activeAccountRef.current?.toLowerCase() !==
        actionAccount.toLowerCase()
      ) {
        return;
      }

      const controller = new AbortController();
      transactionPollControllersRef.current.add(controller);
      setActionState({
        status: "confirming",
        message: "Confirming on Ethereum",
        transactionHash,
      });

      try {
        const receiptStatus = await waitForTransaction(
          transactionHash,
          chainId,
          {
            maxAttempts: profileTransactionPollAttempts(manualCheck),
            signal: controller.signal,
            policy,
          },
        );
        if (controller.signal.aborted) return;
        if (
          activeAccountRef.current?.toLowerCase() !==
          actionAccount.toLowerCase()
        ) {
          return;
        }
        if (receiptStatus === "pending") {
          setActionState({
            status: "pending",
            message:
              "Waiting for confirmation. Select Check status to check again.",
            transactionHash,
          });
          return;
        }
        if (receiptStatus === "not-found") {
          const resolution = resolveProfileNotFoundTransaction(retryNotFound);
          if (resolution.release) {
            forgetPendingProfileTransaction(pendingTransaction);
          }
          setActionState({
            status: resolution.status,
            message: resolution.message,
            transactionHash,
            ...(resolution.release ? { recoverable: true as const } : {}),
          });
          return;
        }
        if (receiptStatus === "reverted") {
          forgetPendingProfileTransaction(pendingTransaction);
          setActionState({
            status: "error",
            message: revertedMessage,
            transactionHash,
          });
          return;
        }
        forgetPendingProfileTransaction(pendingTransaction);
        confirmedProfileTransactionsRef.current[source].set(
          stateKey,
          transactionHash,
        );
        setActionState({
          status: "confirmed",
          message: confirmedMessage,
          transactionHash,
        });
        requestProfileRefresh();
      } catch {
        if (controller.signal.aborted) return;
        if (
          activeAccountRef.current?.toLowerCase() !==
          actionAccount.toLowerCase()
        ) {
          return;
        }
        setActionState({
          status: "pending",
          message:
            "Status unavailable. Select Check status to try again.",
          transactionHash,
        });
      } finally {
        transactionPollControllersRef.current.delete(controller);
      }
    },
    [requestProfileRefresh],
  );

  useEffect(() => {
    if (!account || !ethereumView) return;
    let pending: PendingProfileTransactionRecord[] = [];
    try {
      pending = readPendingProfileTransactions(window.localStorage, account);
    } catch {
      return;
    }
    for (const record of pending) {
      if (
        (record.source !== "classic" && record.source !== "classic-v3") ||
        (record.action !== "claim" && record.action !== "update-payout")
      ) {
        continue;
      }
      const resumeKey = [
        record.source,
        record.stateKey,
        record.transactionHash,
      ].join(":");
      if (
        autoResumingProfileTransactionsRef.current.has(resumeKey) ||
        autoReconciledProfileTransactionsRef.current.has(resumeKey)
      ) {
        continue;
      }
      autoReconciledProfileTransactionsRef.current.add(resumeKey);
      autoResumingProfileTransactionsRef.current.add(resumeKey);
      const setActionState = (
        state: Omit<ProfileClaimActionState, "account">,
      ) => {
        const update = (
          current: Record<string, ProfileClaimActionState>,
        ) => ({
          ...current,
          [record.stateKey]: { account: record.account, ...state },
        });
        if (record.source === "classic") {
          setClaimActionStates(update);
        } else {
          setClassicV3ActionStates(update);
        }
      };
      void settleSubmittedTransaction({
        transactionHash: record.transactionHash,
        chainId: record.chainId,
        actionAccount: record.account,
        source: record.source,
        stateKey: record.stateKey,
        action: record.action,
        confirmedMessage:
          record.action === "claim"
            ? "Claim confirmed"
            : "Payout address updated",
        revertedMessage:
          record.action === "claim"
            ? "Claim reverted"
            : "Payout update reverted",
        setActionState,
        submittedAt: record.submittedAt,
        manualCheck: Date.now() - record.submittedAt >= 60_000,
      }).finally(() => {
        autoResumingProfileTransactionsRef.current.delete(resumeKey);
      });
    }
  }, [
    account,
    liveProfileRefresh,
    profileRefresh,
    ethereumView,
    settleSubmittedTransaction,
  ]);

  const submitCreatorClaim = useCallback(
    async (claim: ProfileClaim) => {
      const claimAccount = account;
      const chainId = scopedOnchainData.chainId;
      if (!claimAccount || scopedOnchainData.status !== "ready" || !chainId) {
        return;
      }

      const stateKey = claim.poolId.toLowerCase();
      const setClaimState = (
        state: Omit<ProfileClaimActionState, "account">,
      ) => {
        setClaimActionStates((current) => ({
          ...current,
          [stateKey]: { account: claimAccount, ...state },
        }));
      };

      if (chainId !== 1 && chainId !== 11_155_111) {
        setClaimState({
          status: "error",
          message: "Creator claims are not supported on this network",
        });
        return;
      }

      const existingState = claimActionStates[stateKey];
      if (
        existingState?.account.toLowerCase() === claimAccount.toLowerCase()
      ) {
        if (
          (existingState.status === "pending" ||
            existingState.status === "not-found") &&
          existingState.transactionHash
        ) {
          await settleSubmittedTransaction({
            transactionHash: existingState.transactionHash,
            chainId,
            actionAccount: claimAccount,
            source: "classic",
            stateKey,
            action: "claim",
            confirmedMessage: "Claim confirmed",
            revertedMessage: "The claim reverted onchain",
            setActionState: setClaimState,
            manualCheck: true,
            retryNotFound: existingState.status === "not-found",
          });
          return;
        }
        if (actionPending(existingState)) return;
      }

      setClaimState({
        status: "preparing",
        message: "Checking the current onchain balance",
      });

      try {
        const prepared = await prepareCreatorClaim({
          account: claimAccount,
          poolId: claim.poolId,
          tokenAddress: claim.tokenAddress,
          hookAddress: claim.hookAddress,
          chainId,
        });
        if (
          activeAccountRef.current?.toLowerCase() !== claimAccount.toLowerCase()
        ) {
          throw new Error("The connected wallet changed before submission");
        }
        if (!prepared.gas.balanceSufficient) {
          throw new Error(
            "This wallet needs more ETH to cover the network fee",
          );
        }

        setClaimState({
          status: "wallet",
          message: "Review the transaction in your wallet",
        });
        const transactionHash = await sendTransaction(prepared.transaction);
        persistPendingProfileTransaction({
          version: 1,
          account: claimAccount.toLowerCase(),
          chainId,
          source: "classic",
          stateKey,
          action: "claim",
          transactionHash,
          submittedAt: Date.now(),
        });

        if (
          activeAccountRef.current?.toLowerCase() === claimAccount.toLowerCase()
        ) {
          await settleSubmittedTransaction({
            transactionHash,
            chainId,
            actionAccount: claimAccount,
            source: "classic",
            stateKey,
            action: "claim",
            confirmedMessage: "Claim confirmed",
            revertedMessage: "The claim reverted onchain",
            setActionState: setClaimState,
          });
        }
      } catch (caught) {
        if (
          activeAccountRef.current?.toLowerCase() !== claimAccount.toLowerCase()
        ) {
          return;
        }
        if (walletActionWasCancelled(caught)) {
          setClaimActionStates((current) => {
            const next = { ...current };
            delete next[stateKey];
            return next;
          });
          return;
        }
        setClaimState({
          status: "error",
          message: profileCreatorClaimErrorMessage(caught),
        });
      }
    },
    [
      account,
      claimActionStates,
      scopedOnchainData.chainId,
      scopedOnchainData.status,
      sendTransaction,
      settleSubmittedTransaction,
    ],
  );
  const submitClassicV3Action = useCallback(
    async (
      reward: ClassicV3Reward,
      action: "claim" | "update-payout",
      newPayoutAddress?: string,
      allocationIndex?: number,
    ) => {
      const actionAccount = account;
      if (
        !classicV3ReleaseAvailable ||
        !actionAccount ||
        scopedClassicV3Rewards.status !== "ready" ||
        reward.beneficiary.toLowerCase() !== actionAccount.toLowerCase()
      ) {
        return;
      }
      const stateKey =
        action === "claim"
          ? `${reward.vaultAddress.toLowerCase()}:claim`
          : rewardReceiverActionKeyV1(reward.vaultAddress);
      const setActionState = (
        state: Omit<ClassicV3ActionState, "account">,
      ) => {
        setClassicV3ActionStates((current) => ({
          ...current,
          [stateKey]: { account: actionAccount, ...state },
        }));
      };
      const existingState = classicV3ActionStates[stateKey];
      if (
        existingState?.account.toLowerCase() === actionAccount.toLowerCase()
      ) {
        if (
          (existingState.status === "pending" ||
            existingState.status === "not-found") &&
          existingState.transactionHash
        ) {
          await settleSubmittedTransaction({
            transactionHash: existingState.transactionHash,
            chainId: scopedClassicV3Rewards.chainId,
            actionAccount,
            source: "classic-v3",
            stateKey,
            action,
            confirmedMessage:
              action === "claim"
                ? "Claim confirmed"
                : "Payout address updated",
            revertedMessage: "The reward transaction reverted onchain",
            setActionState,
            manualCheck: true,
            retryNotFound: existingState.status === "not-found",
          });
          return;
        }
        if (actionPending(existingState)) return;
      }
      setActionState({
        status: "preparing",
        message: "Checking the current onchain state",
      });
      try {
        const prepared = await prepareClassicV3RewardAction({
          action,
          account: actionAccount,
          vaultAddress: reward.vaultAddress,
          releaseVersion: reward.releaseVersion ?? "classic-v3",
          newPayoutAddress,
          allocationIndex,
          chainId: scopedClassicV3Rewards.chainId,
        });
        if (
          activeAccountRef.current?.toLowerCase() !==
          actionAccount.toLowerCase()
        ) {
          throw new Error("The connected wallet changed before submission");
        }
        setActionState({
          status: "wallet",
          message: "Review the transaction in your wallet",
        });
        const transactionHash = await sendTransaction(prepared.transaction);
        persistPendingProfileTransaction({
          version: 1,
          account: actionAccount.toLowerCase(),
          chainId: scopedClassicV3Rewards.chainId,
          source: "classic-v3",
          stateKey,
          action,
          transactionHash,
          submittedAt: Date.now(),
        });
        if (
          activeAccountRef.current?.toLowerCase() ===
          actionAccount.toLowerCase()
        ) {
          await settleSubmittedTransaction({
            transactionHash,
            chainId: scopedClassicV3Rewards.chainId,
            actionAccount,
            source: "classic-v3",
            stateKey,
            action,
            confirmedMessage:
              action === "claim"
                ? "Claim confirmed"
                : "Payout address updated",
            revertedMessage: "The reward transaction reverted onchain",
            setActionState,
          });
        }
      } catch (caught) {
        if (
          activeAccountRef.current?.toLowerCase() !==
          actionAccount.toLowerCase()
        ) {
          return;
        }
        if (walletActionWasCancelled(caught)) {
          setClassicV3ActionStates((current) => {
            const next = { ...current };
            delete next[stateKey];
            return next;
          });
          return;
        }
        setActionState({
          status: "error",
          message: profileRewardActionErrorMessage(caught, action),
        });
      }
    },
    [
      account,
      classicV3ActionStates,
      scopedClassicV3Rewards,
      sendTransaction,
      settleSubmittedTransaction,
    ],
  );
  const submitDeepAction = useCallback(
    async (
      reward: DeepReward,
      action: "claim" | "update-payout",
      newPayoutAddress?: string,
    ) => {
      const actionAccount = account;
      if (
        !deepReleaseAvailable ||
        !actionAccount ||
        scopedDeepRewards.status !== "ready" ||
        reward.beneficiary.toLowerCase() !== actionAccount.toLowerCase()
      ) {
        return;
      }
      const stateKey = `${reward.vaultAddress.toLowerCase()}:${action}`;
      const setActionState = (
        state: Omit<DeepActionState, "account">,
      ) => {
        setDeepActionStates((current) => ({
          ...current,
          [stateKey]: { account: actionAccount, ...state },
        }));
      };
      const existingState = deepActionStates[stateKey];
      if (
        existingState?.account.toLowerCase() === actionAccount.toLowerCase()
      ) {
        if (
          (existingState.status === "pending" ||
            existingState.status === "not-found") &&
          existingState.transactionHash
        ) {
          await settleSubmittedTransaction({
            transactionHash: existingState.transactionHash,
            chainId: scopedDeepRewards.chainId,
            actionAccount,
            source: "deep",
            stateKey,
            action,
            confirmedMessage:
              action === "claim"
                ? "Claim confirmed"
                : "Payout address updated",
            revertedMessage: "The reward transaction reverted onchain",
            setActionState,
            manualCheck: true,
            retryNotFound: existingState.status === "not-found",
          });
          return;
        }
        if (actionPending(existingState)) return;
      }
      setActionState({
        status: "preparing",
        message: "Checking the current onchain state",
      });
      try {
        const prepared = await prepareDeepRewardAction({
          action,
          deepReleaseVersion: reward.deepReleaseVersion,
          account: actionAccount,
          vaultAddress: reward.vaultAddress,
          newPayoutAddress,
          chainId: scopedDeepRewards.chainId,
        });
        if (
          activeAccountRef.current?.toLowerCase() !==
          actionAccount.toLowerCase()
        ) {
          throw new Error("The connected wallet changed before submission");
        }
        setActionState({
          status: "wallet",
          message: "Review the transaction in your wallet",
        });
        const transactionHash = await sendTransaction(prepared.transaction);
        persistPendingProfileTransaction({
          version: 1,
          account: actionAccount.toLowerCase(),
          chainId: scopedDeepRewards.chainId,
          source: "deep",
          stateKey,
          action,
          transactionHash,
          submittedAt: Date.now(),
        });
        if (
          activeAccountRef.current?.toLowerCase() ===
          actionAccount.toLowerCase()
        ) {
          await settleSubmittedTransaction({
            transactionHash,
            chainId: scopedDeepRewards.chainId,
            actionAccount,
            source: "deep",
            stateKey,
            action,
            confirmedMessage:
              action === "claim"
                ? "Claim confirmed"
                : "Payout address updated",
            revertedMessage: "The reward transaction reverted onchain",
            setActionState,
          });
        }
      } catch (caught) {
        if (
          activeAccountRef.current?.toLowerCase() !==
          actionAccount.toLowerCase()
        ) {
          return;
        }
        if (walletActionWasCancelled(caught)) {
          setDeepActionStates((current) => {
            const next = { ...current };
            delete next[stateKey];
            return next;
          });
          return;
        }
        setActionState({
          status: "error",
          message: profileRewardActionErrorMessage(caught),
        });
      }
    },
    [
      account,
      deepActionStates,
      scopedDeepRewards,
      sendTransaction,
      settleSubmittedTransaction,
    ],
  );
  const submitStockPairedAction = useCallback(
    async (
      reward: StockPairedReward,
      action: "claim" | "claim-as-eth" | "update-payout",
      newPayoutAddress?: string,
    ) => {
      const actionAccount = account;
      if (
        !stockPairedReleaseAvailable ||
        !actionAccount ||
        scopedStockPairedRewards.status !== "ready" ||
        reward.beneficiary.toLowerCase() !== actionAccount.toLowerCase()
      ) {
        return;
      }
      const stateKey = `${reward.vaultAddress.toLowerCase()}:${action}`;
      const lockKey = `${actionAccount.toLowerCase()}:${reward.vaultAddress.toLowerCase()}`;
      if (stockPairedActionLocksRef.current.has(lockKey)) return;
      stockPairedActionLocksRef.current.add(lockKey);
      const setActionState = (
        state: Omit<StockPairedActionState, "account">,
      ) => {
        setStockPairedActionStates((current) => ({
          ...current,
          [stateKey]: { account: actionAccount, ...state },
        }));
      };
      let stockClaimConfirmed = false;
      let recoveryClaimTransactionHash: Hex | undefined;
      let recoveryAmountIn: string | undefined;
      try {
        const existingState = stockPairedActionStates[stateKey];
        const scopedExistingState =
          existingState?.account.toLowerCase() === actionAccount.toLowerCase()
            ? existingState
            : undefined;

        if (action !== "claim-as-eth") {
          if (
            (scopedExistingState?.status === "pending" ||
              scopedExistingState?.status === "not-found") &&
            scopedExistingState.transactionHash
          ) {
            await settleSubmittedTransaction({
              transactionHash: scopedExistingState.transactionHash,
              chainId: scopedStockPairedRewards.chainId,
              actionAccount,
              source: "stock-paired",
              stateKey,
              action,
              confirmedMessage:
                action === "claim"
                  ? "Claim confirmed"
                  : "Payout address updated",
              revertedMessage: "The reward transaction reverted onchain",
              setActionState,
              manualCheck: true,
              retryNotFound: scopedExistingState.status === "not-found",
              policy: action === "claim" ? "stock-paired" : undefined,
            });
            return;
          }
          if (actionPending(scopedExistingState)) return;

          setActionState({
            status: "preparing",
            message: "Checking the current onchain state",
          });
          const prepared = await prepareStockPairedRewardAction({
            action,
            account: actionAccount,
            vaultAddress: reward.vaultAddress,
            newPayoutAddress,
            chainId: scopedStockPairedRewards.chainId,
          });
          if (
            activeAccountRef.current?.toLowerCase() !==
            actionAccount.toLowerCase()
          ) {
            throw new Error("The connected wallet changed before submission");
          }
          setActionState({
            status: "wallet",
            message: "Review the transaction in your wallet",
          });
          const transactionHash = await sendTransaction(prepared.transaction);
          persistPendingProfileTransaction({
            version: 1,
            account: actionAccount.toLowerCase(),
            chainId: scopedStockPairedRewards.chainId,
            source: "stock-paired",
            stateKey,
            action,
            transactionHash,
            submittedAt: Date.now(),
          });
          await settleSubmittedTransaction({
            transactionHash,
            chainId: scopedStockPairedRewards.chainId,
            actionAccount,
            source: "stock-paired",
            stateKey,
            action,
            confirmedMessage:
              action === "claim"
                ? "Claim confirmed"
                : "Payout address updated",
            revertedMessage: "The reward transaction reverted onchain",
            setActionState,
            policy: action === "claim" ? "stock-paired" : undefined,
          });
          return;
        }

        if (
          reward.payoutAddress.toLowerCase() !== actionAccount.toLowerCase()
        ) {
          throw new Error(
            "Claim as ETH requires this wallet as the payout address",
          );
        }
        if (actionPending(scopedExistingState)) return;

        const rewardAmount =
          scopedExistingState?.amountIn ?? reward.claimableRaw;
        let claimTransactionHash =
          scopedExistingState?.claimTransactionHash;
        stockClaimConfirmed = Boolean(
          scopedExistingState?.status === "error" && claimTransactionHash,
        );
        recoveryClaimTransactionHash = claimTransactionHash;
        recoveryAmountIn = rewardAmount;

        const settleConversionStage = async ({
          transactionHash,
          pendingStage,
          manualCheck,
          retryNotFound = false,
        }: {
          transactionHash: Hex;
          pendingStage: StockPairedPendingStage;
          manualCheck: boolean;
          retryNotFound?: boolean;
        }) => {
          const authoritativeClaimHash =
            claimTransactionHash ?? transactionHash;
          claimTransactionHash = authoritativeClaimHash;
          recoveryClaimTransactionHash = authoritativeClaimHash;
          const pendingTransaction: PendingProfileTransactionRecord = {
            version: 1,
            account: actionAccount.toLowerCase(),
            chainId: scopedStockPairedRewards.chainId,
            source: "stock-paired",
            stateKey,
            action: "claim-as-eth",
            transactionHash,
            submittedAt: Date.now(),
            pendingStage,
            claimTransactionHash: authoritativeClaimHash,
            amountIn: rewardAmount,
          };
          persistPendingProfileTransaction(pendingTransaction);
          setActionState({
            status: "confirming",
            message:
              pendingStage === "claim"
                ? `Claiming ${reward.quoteAssetSymbol}`
                : pendingStage === "swap"
                  ? "Converting to ETH"
                  : "Confirming approval",
            transactionHash,
            pendingStage,
            claimTransactionHash: authoritativeClaimHash,
            amountIn: rewardAmount,
          });
          let receiptStatus:
            | "pending"
            | "not-found"
            | "confirmed"
            | "reverted";
          try {
            receiptStatus = await waitForTransaction(
              transactionHash,
              scopedStockPairedRewards.chainId,
              {
                maxAttempts: profileTransactionPollAttempts(manualCheck),
                policy: "stock-paired",
              },
            );
          } catch {
            const gate = resolveStockPairedReceiptGate(
              pendingStage,
              "unavailable",
            );
            if (gate.outcome !== "hold") return "pending" as const;
            setActionState({
              status: "pending",
              message: gate.message,
              transactionHash,
              pendingStage,
              claimTransactionHash: authoritativeClaimHash,
              amountIn: rewardAmount,
            });
            return "pending" as const;
          }
          if (
            activeAccountRef.current?.toLowerCase() !==
            actionAccount.toLowerCase()
          ) {
            return "pending" as const;
          }
          const gate = resolveStockPairedReceiptGate(
            pendingStage,
            receiptStatus,
          );
          if (gate.outcome === "hold") {
            if (receiptStatus === "not-found" && retryNotFound) {
              const resolution = resolveProfileNotFoundTransaction(true);
              const checkpoint = stockPairedCheckpointAfterReceipt(
                pendingTransaction,
                "reverted",
              );
              if (checkpoint) {
                persistPendingProfileTransaction(checkpoint);
              } else {
                forgetPendingProfileTransaction(pendingTransaction);
              }
              setActionState({
                status: resolution.status,
                message: resolution.message,
                transactionHash,
                recoverable: true,
                ...(pendingStage === "claim"
                  ? {}
                  : {
                      claimTransactionHash: authoritativeClaimHash,
                      amountIn: rewardAmount,
                    }),
              });
              return "reverted" as const;
            }
            setActionState({
              status:
                receiptStatus === "not-found" ? "not-found" : "pending",
              message: gate.message,
              transactionHash,
              pendingStage,
              claimTransactionHash: authoritativeClaimHash,
              amountIn: rewardAmount,
            });
            return "pending" as const;
          }
          if (gate.outcome === "reverted") {
            const checkpoint = stockPairedCheckpointAfterReceipt(
              pendingTransaction,
              gate.outcome,
            );
            if (checkpoint) {
              persistPendingProfileTransaction(checkpoint);
            } else {
              forgetPendingProfileTransaction(pendingTransaction);
            }
            setActionState({
              status: "error",
              message: gate.message,
              transactionHash,
              ...(pendingStage === "claim"
                ? {}
                : {
                    claimTransactionHash: authoritativeClaimHash,
                    amountIn: rewardAmount,
                  }),
            });
            return "reverted" as const;
          }
          if (
            !stockPairedCheckpointAfterReceipt(
              pendingTransaction,
              gate.outcome,
            )
          ) {
            forgetPendingProfileTransaction(pendingTransaction);
          }
          return "confirmed" as const;
        };

        const resumedStage = scopedExistingState?.pendingStage;
        let transactionHash = scopedExistingState?.transactionHash;
        if (
          (scopedExistingState?.status === "pending" ||
            scopedExistingState?.status === "not-found") &&
          transactionHash &&
          resumedStage
        ) {
          const status = await settleConversionStage({
            transactionHash,
            pendingStage: resumedStage,
            manualCheck: true,
            retryNotFound: scopedExistingState.status === "not-found",
          });
          if (status !== "confirmed") return;
          if (resumedStage === "swap") {
            confirmedProfileTransactionsRef.current["stock-paired"].set(
              stateKey,
              transactionHash,
            );
            setActionState({
              status: "confirmed",
              message: "Claimed as ETH",
              transactionHash,
            });
            requestProfileRefresh();
            return;
          }
          stockClaimConfirmed = true;
        } else if (!stockClaimConfirmed) {
          setActionState({
            status: "preparing",
            message: "Checking the current onchain state",
          });
          const prepared = await prepareStockPairedRewardAction({
            action: "claim",
            account: actionAccount,
            vaultAddress: reward.vaultAddress,
            chainId: scopedStockPairedRewards.chainId,
          });
          if (
            activeAccountRef.current?.toLowerCase() !==
            actionAccount.toLowerCase()
          ) {
            throw new Error("The connected wallet changed before submission");
          }
          setActionState({
            status: "wallet",
            message: `Confirm the ${reward.quoteAssetSymbol} claim in your wallet`,
          });
          transactionHash = await sendTransaction(prepared.transaction);
          claimTransactionHash = transactionHash;
          const status = await settleConversionStage({
            transactionHash,
            pendingStage: "claim",
            manualCheck: false,
          });
          if (status !== "confirmed") return;
          stockClaimConfirmed = true;
        }

        if (!claimTransactionHash) {
          throw new Error("The confirmed claim transaction is unavailable");
        }

        for (let step = 0; step < 3; step += 1) {
          setActionState({
            status: "preparing",
            message: "Preparing the ETH conversion",
            claimTransactionHash,
            amountIn: rewardAmount,
          });
          let conversion:
            | Awaited<ReturnType<typeof prepareStockPairedRewardConversion>>
            | undefined;
          for (let attempt = 0; attempt < 6; attempt += 1) {
            try {
              const deadline = (
                BigInt(Math.floor(Date.now() / 1_000)) + 1_200n
              ).toString();
              conversion = await prepareStockPairedRewardConversion({
                account: actionAccount,
                reward,
                claimTransactionHash,
                amountIn: rewardAmount,
                deadline,
                chainId: scopedStockPairedRewards.chainId,
              });
              break;
            } catch (conversionError) {
              if (
                !(conversionError instanceof StockPairedClaimPendingError) ||
                attempt === 5
              ) {
                throw conversionError;
              }
              await new Promise((resolve) =>
                window.setTimeout(resolve, 1_000),
              );
            }
          }
          if (!conversion) {
            throw new Error("The ETH conversion could not be prepared");
          }
          if (
            activeAccountRef.current?.toLowerCase() !==
            actionAccount.toLowerCase()
          ) {
            throw new Error("The connected wallet changed during conversion");
          }
          const transactionKind = conversion.transaction.kind;
          setActionState({
            status: "wallet",
            message:
              transactionKind === "token-to-permit2"
                ? `Approve ${reward.quoteAssetSymbol} for conversion`
                : transactionKind === "permit2-to-router"
                  ? "Approve the Uniswap route"
                  : "Confirm the ETH conversion",
            claimTransactionHash,
            amountIn: rewardAmount,
          });
          transactionHash = await sendTransaction(conversion.transaction);
          const status = await settleConversionStage({
            transactionHash,
            pendingStage: transactionKind,
            manualCheck: false,
          });
          if (status !== "confirmed") return;
          if (transactionKind === "swap") {
            confirmedProfileTransactionsRef.current["stock-paired"].set(
              stateKey,
              transactionHash,
            );
            setActionState({
              status: "confirmed",
              message: "Claimed as ETH",
              transactionHash,
            });
            requestProfileRefresh();
            return;
          }
        }
        throw new Error(
          "The conversion needs more approval steps than expected",
        );
      } catch (caught) {
        if (
          activeAccountRef.current?.toLowerCase() !==
          actionAccount.toLowerCase()
        ) {
          return;
        }
        setActionState({
          status: "error",
          message: stockClaimConfirmed
            ? "The stock is safely in your wallet. The ETH conversion was not completed."
            : caught instanceof Error
              ? caught.message
              : "The reward action could not be submitted",
          ...(stockClaimConfirmed && recoveryClaimTransactionHash
            ? {
                claimTransactionHash: recoveryClaimTransactionHash,
                amountIn: recoveryAmountIn,
              }
            : {}),
        });
        if (stockClaimConfirmed) {
          requestProfileRefresh();
        }
      } finally {
        stockPairedActionLocksRef.current.delete(lockKey);
      }
    },
    [
      account,
      requestProfileRefresh,
      scopedStockPairedRewards,
      sendTransaction,
      settleSubmittedTransaction,
      stockPairedActionStates,
    ],
  );
  const displayName = account
    ? savedProfile.username || "Profile"
    : "Profile";
  const avatarImage = editingProfile ? avatarDraft : savedProfile.avatarDataUrl;
  const bannerImage = editingProfile
    ? bannerDraft
    : (savedProfile.bannerDataUrl ?? "");
  const bannerPosition = editingProfile
    ? bannerPositionDraft
    : {
        x: savedProfile.bannerPositionX ?? 50,
        y: savedProfile.bannerPositionY ?? 50,
      };
  const visibleProfileLinks = [
    {
      kind: "x" as const,
      value: savedProfile.xUrl ?? "",
      icon: <XBrandIcon aria-hidden="true" />,
    },
    {
      kind: "website" as const,
      value: savedProfile.websiteUrl ?? "",
      icon: <WebsiteLinkIcon />,
    },
    {
      kind: "github" as const,
      value: savedProfile.githubUrl ?? "",
      icon: <GitHubBrandIcon aria-hidden="true" />,
    },
  ].flatMap((link) => {
    const resolved = resolveProfileLink(link.value, link.kind);
    return resolved ? [{ ...link, ...resolved }] : [];
  });
  const avatarFallback = account
    ? (savedProfile.username || account.slice(2, 4)).slice(0, 2).toUpperCase()
    : "P";

  function retryProfileData() {
    if (!account) return;
    requestProfileRefresh(true);
  }

  const sessionView = getProfileSessionView(connecting, account);
  const profileAccountQuery = searchParams?.getAll("account") ?? [];
  const requestedProfileAccount = publicProfileAccountFromQuery(
    profileAccountQuery,
  );
  const publicProfileAccount = publicProfileAccountFromQuery(
    profileAccountQuery,
    account,
  );

  if (!clientHydrated || sessionView === "loading") {
    return (
      <ProfileSessionLoadingState
        showDashboard={
          Boolean(requestedProfileAccount) || hasSession || Boolean(account)
        }
      />
    );
  }

  if (publicProfileAccount) {
    return (
      <PublicCreatorProfile
        account={publicProfileAccount}
        connectedAccount={account}
        onConnect={openWallet}
        viewChainId={viewChainId}
        onChangeChain={onChangeChain}
      />
    );
  }

  if (sessionView === "connect" || !account) {
    return (
      <div className={`${styles.page} page-width`}>
        <section
          className={`${styles.connectCard} liquid-glass-surface`}
        >
          <Image
            className={styles.connectMark}
            src="/brand/loop/programmable-loop-mark-warm-ivory-v1-1536.png"
            alt=""
            width={512}
            height={512}
            sizes="(max-width: 700px) 72px, 188px"
            priority
          />
          <h1>Profile</h1>
          <p>Connect to manage your profile, launches and rewards.</p>
          <button
            className={styles.connectButton}
            type="button"
            onClick={openWallet}
          >
            Connect wallet
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className={`${styles.page} page-width`}>
      <section
        className={`${styles.hero} ${
          editingProfile ? styles.heroEditing : ""
        }`}
      >
        <div
          className={`${styles.profileBanner} ${
            editingProfile ? styles.profileBannerEditing : ""
          } ${
            editingProfile && bannerDraft
              ? styles.profileBannerPositionable
              : ""
          }`}
          onPointerDown={startBannerDrag}
          onPointerMove={moveBannerDrag}
          onPointerUp={stopBannerDrag}
          onPointerCancel={stopBannerDrag}
          onDragOver={(event) => {
            if (!editingProfile) return;
            event.preventDefault();
          }}
          onDrop={(event) => {
            if (!editingProfile) return;
            event.preventDefault();
            void prepareBanner(event.dataTransfer.files[0]);
          }}
        >
          {bannerImage ? (
            <Image
              src={bannerImage}
              alt=""
              fill
              sizes="(max-width: 820px) calc(100vw - 32px), 1160px"
              style={{
                objectFit: "cover",
                objectPosition: `${bannerPosition.x}% ${bannerPosition.y}%`,
              }}
              unoptimized
            />
          ) : null}
          {editingProfile ? (
            <div className={styles.bannerActions}>
              <input
                ref={bannerInputRef}
                hidden
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={selectBanner}
              />
              <button
                className={styles.imageAction}
                type="button"
                disabled={preparingImage}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => bannerInputRef.current?.click()}
              >
                {preparingImage ? "Preparing…" : "Choose banner"}
              </button>
              {bannerDraft ? (
                <span>Drag to position · keyboard controls below</span>
              ) : (
                <span>Choose or drop an image · 3000 × 1000 recommended</span>
              )}
            </div>
          ) : null}
        </div>

        <div className={styles.avatar}>
          {avatarImage ? (
            <Image
              src={avatarImage}
              alt={`${displayName} profile image`}
              fill
              sizes="96px"
              unoptimized
            />
          ) : (
            <span aria-hidden="true">{avatarFallback}</span>
          )}
        </div>

        <div className={styles.heroCopy}>
          <div className={styles.nameRow}>
            <h1>{displayName}</h1>
            {!editingProfile ? (
              <button
                className={styles.editButton}
                type="button"
                onClick={beginEditingProfile}
              >
                Edit profile
              </button>
            ) : null}
          </div>
          <p className={styles.address} aria-label={`Profile wallet ${account}`}>
            {account}
          </p>
          {!editingProfile && savedProfile.bio ? (
            <p className={styles.profileBio}>{savedProfile.bio}</p>
          ) : null}
          {!editingProfile && visibleProfileLinks.length ? (
            <div className={styles.profileLinks} aria-label="Profile links">
              {visibleProfileLinks.map((link) => (
                <a
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  key={link.kind}
                >
                  {link.icon}
                  <span>{link.label}</span>
                </a>
              ))}
            </div>
          ) : null}

          {editingProfile ? (
            <form className={styles.editForm} onSubmit={saveProfile}>
              <div className={styles.editGrid}>
                <div className={styles.imageControl}>
                  <span className={styles.fieldLabel}>Profile image</span>
                  <input
                    ref={fileInputRef}
                    hidden
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={selectAvatar}
                  />
                  <div className={styles.imageActions}>
                    <button
                      className={styles.imageAction}
                      type="button"
                      disabled={preparingImage}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {preparingImage ? "Preparing…" : "Choose image"}
                    </button>
                    {avatarDraft ? (
                      <button
                        className={styles.imageAction}
                        type="button"
                        disabled={preparingImage}
                        onClick={() => {
                          setAvatarDraft("");
                          setAvatarError("");
                          setSaveError("");
                        }}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className={styles.usernameControl}>
                  <label
                    className={styles.fieldLabel}
                    htmlFor="profile-username"
                  >
                    Username
                  </label>
                  <div className={styles.usernameRow}>
                    <input
                      id="profile-username"
                      value={usernameDraft}
                      autoComplete="nickname"
                      maxLength={12}
                      pattern="[A-Za-z0-9]{3,12}"
                      aria-invalid={Boolean(usernameError)}
                      aria-describedby="profile-username-help"
                      onChange={(event) => {
                        setUsernameDraft(event.target.value);
                        setUsernameError("");
                        setSaveError("");
                      }}
                      autoFocus
                    />
                    <button
                      className={`${styles.editAction} ${styles.saveAction}`}
                      type="submit"
                      disabled={preparingImage}
                      aria-busy={preparingImage || undefined}
                    >
                      Save
                    </button>
                    <button
                      className={styles.editAction}
                      type="button"
                      disabled={preparingImage}
                      onClick={cancelEditingProfile}
                    >
                      Cancel
                    </button>
                  </div>
                </div>

                {bannerDraft ? (
                  <fieldset className={styles.bannerPositionControl}>
                    <legend className={styles.fieldLabel}>
                      Banner position
                    </legend>
                    <div className={styles.bannerPositionFields}>
                      <label>
                        <span>Horizontal position</span>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={Math.round(bannerPositionDraft.x)}
                          aria-valuetext={formatBannerPositionValue(
                            "horizontal",
                            bannerPositionDraft.x,
                          )}
                          aria-describedby="profile-banner-position-status"
                          onChange={(event) => {
                            const x = Number(event.currentTarget.value);
                            setBannerPositionDraft((current) => ({
                              ...current,
                              x,
                            }));
                            setSaveError("");
                          }}
                        />
                      </label>
                      <label>
                        <span>Vertical position</span>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={Math.round(bannerPositionDraft.y)}
                          aria-valuetext={formatBannerPositionValue(
                            "vertical",
                            bannerPositionDraft.y,
                          )}
                          aria-describedby="profile-banner-position-status"
                          onChange={(event) => {
                            const y = Number(event.currentTarget.value);
                            setBannerPositionDraft((current) => ({
                              ...current,
                              y,
                            }));
                            setSaveError("");
                          }}
                        />
                      </label>
                      <output
                        id="profile-banner-position-status"
                        className={styles.bannerPositionStatus}
                        role="status"
                      >
                        {formatBannerPositionStatus(bannerPositionDraft)}
                      </output>
                    </div>
                  </fieldset>
                ) : null}

                <div className={styles.bioControl}>
                  <label className={styles.fieldLabel} htmlFor="profile-bio">
                    Bio
                  </label>
                  <textarea
                    id="profile-bio"
                    value={bioDraft}
                    maxLength={240}
                    rows={3}
                    placeholder="A short introduction"
                    onChange={(event) => {
                      setBioDraft(event.target.value);
                      setSaveError("");
                    }}
                  />
                </div>

                <div className={styles.profileLinkFields}>
                  <label>
                    <span className={styles.fieldLabel}>X</span>
                    <input
                      value={xUrlDraft}
                      inputMode="url"
                      placeholder="username or x.com/username"
                      onChange={(event) => setXUrlDraft(event.target.value)}
                    />
                  </label>
                  <label>
                    <span className={styles.fieldLabel}>Website</span>
                    <input
                      value={websiteUrlDraft}
                      inputMode="url"
                      placeholder="domain.com"
                      onChange={(event) =>
                        setWebsiteUrlDraft(event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span className={styles.fieldLabel}>GitHub</span>
                    <input
                      value={githubUrlDraft}
                      inputMode="url"
                      placeholder="username or github.com/username"
                      onChange={(event) =>
                        setGithubUrlDraft(event.target.value)
                      }
                    />
                  </label>
                </div>
              </div>
              <p
                id="profile-username-help"
                className={`${styles.formHelp} ${
                  usernameError || avatarError || bannerError || saveError
                    ? styles.formError
                    : ""
                }`}
                role={
                  usernameError || avatarError || bannerError || saveError
                    ? "alert"
                    : undefined
                }
              >
                {usernameError ||
                  avatarError ||
                  bannerError ||
                  saveError ||
                  "Username: 3–12 letters or numbers. Profile image: 1000 × 1000 px recommended."}
              </p>
            </form>
          ) : null}
        </div>
      </section>

      <ProfileChainSelector value={viewChainId} onChange={onChangeChain} />

      {ethereumView ? <><ProfileProjects
        key={account?.toLowerCase() ?? "disconnected"}
        classicRewards={
          scopedClassicV3Rewards.status === "ready"
            ? scopedClassicV3Rewards.rewards
            : []
        }
        marketCaps={creatorProjectMarketCaps}
        walletProjects={creatorWalletProjects}
        rewardReceiverActionStates={classicV3ActionStates}
        onChangeRewardReceiver={(reward, newReceiver, allocationIndex) =>
          void submitClassicV3Action(
            reward,
            "update-payout",
            newReceiver,
            allocationIndex,
          )}
        onRefresh={retryProfileData}
        refreshing={profileRefreshing}
      />
      <ProfileAccountWorkspace
        key={account.toLowerCase()}
        connected={Boolean(account)}
        data={scopedOnchainData}
        account={account}
        claimActionStates={claimActionStates}
        classicV3Rewards={scopedClassicV3Rewards}
        classicV3SourceState={scopedClassicV3SourceState}
        classicV3ActionStates={classicV3ActionStates}
        deepRewards={scopedDeepRewards}
        deepActionStates={deepActionStates}
        deepV3Profile={scopedDeepV3Profile}
        stockPairedRewards={scopedStockPairedRewards}
        stockPairedActionStates={stockPairedActionStates}
        onClaim={submitCreatorClaim}
        onClassicV3Action={submitClassicV3Action}
        onDeepAction={submitDeepAction}
        onStockPairedAction={submitStockPairedAction}
        onConnect={openWallet}
        onRetry={retryProfileData}
        refreshing={profileRefreshing}
        refreshStatusMessage={profileRefreshStatusMessage}
        terminalErrorReady={terminalErrorReady}
      />
      </> : <>
        <RobinhoodProfileLaunches key={account.toLowerCase()} account={account} />
        <ProfileModules key={`modules:${account.toLowerCase()}:${searchParams?.get("section") ?? "published"}`} account={account} ownProfile initialSection={searchParams?.get("section") === "submissions" ? "submissions" : "published"} />
        <RobinhoodProfileRewards />
      </>}
    </div>
  );
}

export type ProfileTokenReward = {
  token: ProfileToken;
  claim?: ProfileClaim;
};

export type ProfilePortfolioEntry = ProfileTokenReward & {
  classicRewards: readonly ClassicV3Reward[];
  deepRewards: readonly DeepReward[];
  stockPairedRewards: readonly StockPairedReward[];
  deepV3Token?: DeepV3CreatorToken;
  launchedByWallet: boolean;
};

type ProfileActionStateCollections = {
  claim: Record<string, ProfileClaimActionState>;
  classicV3: Record<string, ClassicV3ActionState>;
  deep: Record<string, DeepActionState>;
  stockPaired: Record<string, StockPairedActionState>;
};

export const profileClaimPageSize = 4;

export function groupProfileRewards(
  tokens: readonly ProfileToken[],
  claims: readonly ProfileClaim[],
): ProfileTokenReward[] {
  const claimByToken = new Map(
    claims.map((claim) => [claim.tokenAddress.toLowerCase(), claim]),
  );

  return tokens.map((token) => ({
    token,
    claim: claimByToken.get(token.address.toLowerCase()),
  }));
}

export function sortProfileTokensByMarketCap(tokens: readonly ProfileToken[]) {
  const marketCapSource = profileMarketCapSource(tokens);

  return [...tokens].sort((first, second) =>
    compareProfileTokensByMarketCap(first, second, marketCapSource),
  );
}

function unsignedProfileMarketCap(value: string | undefined) {
  return value && /^(0|[1-9]\d*)$/.test(value) && value.length <= 78
    ? BigInt(value)
    : null;
}

function profileMarketCapSource(tokens: readonly ProfileToken[]) {
  return tokens.some(
    (token) => unsignedProfileMarketCap(token.fdvUsdWad) !== null,
  )
    ? ("usd" as const)
    : ("eth" as const);
}

function profileMarketCap(
  token: ProfileToken,
  source: "usd" | "eth",
) {
  return unsignedProfileMarketCap(
    source === "usd" ? token.fdvUsdWad : token.marketCapEthWei,
  );
}

function compareProfileTokensByMarketCap(
  first: ProfileToken,
  second: ProfileToken,
  source: "usd" | "eth",
) {
  const firstCap = profileMarketCap(first, source);
  const secondCap = profileMarketCap(second, source);

  if (firstCap !== null && secondCap !== null && firstCap !== secondCap) {
    return firstCap > secondCap ? -1 : 1;
  }
  if (firstCap !== null && secondCap === null) return -1;
  if (firstCap === null && secondCap !== null) return 1;

  const nameOrder = first.name.localeCompare(second.name);
  if (nameOrder !== 0) return nameOrder;
  return first.address
    .toLowerCase()
    .localeCompare(second.address.toLowerCase());
}

export function buildProfilePortfolio(
  tokens: readonly ProfileToken[],
  claims: readonly ProfileClaim[],
  classicRewards: readonly ClassicV3Reward[],
  deepRewards: readonly DeepReward[] = [],
  deepV3Tokens: readonly DeepV3CreatorToken[] = [],
  stockPairedRewards: readonly StockPairedReward[] = [],
) {
  const entries = new Map<string, ProfilePortfolioEntry>();

  for (const { token, claim } of groupProfileRewards(tokens, claims)) {
    entries.set(token.address.toLowerCase(), {
      token,
      claim,
      classicRewards: [],
      deepRewards: [],
      stockPairedRewards: [],
      deepV3Token: undefined,
      launchedByWallet: true,
    });
  }

  for (const claim of claims) {
    const key = claim.tokenAddress.toLowerCase();
    if (entries.has(key)) continue;
    entries.set(key, {
      token: {
        address: claim.tokenAddress,
        name: claim.tokenName,
        symbol: claim.tokenSymbol,
        launchedAt: "",
        href: claim.href,
        launchModel: "classic",
      },
      claim,
      classicRewards: [],
      deepRewards: [],
      stockPairedRewards: [],
      deepV3Token: undefined,
      launchedByWallet: false,
    });
  }

  for (const reward of classicRewards) {
    const key = reward.tokenAddress.toLowerCase();
    const current = entries.get(key);
    const currentRewards = current?.classicRewards ?? [];
    if (
      currentRewards.some(
        (item) =>
          item.vaultAddress.toLowerCase() ===
          reward.vaultAddress.toLowerCase(),
      )
    ) {
      continue;
    }
    entries.set(key, {
      token:
        current?.token ??
        ({
          address: reward.tokenAddress,
          name: reward.tokenName,
          symbol: reward.tokenSymbol,
          launchedAt: "",
          href: `/token/${reward.tokenAddress}?chain=1`,
          launchModel: "classic",
        } satisfies ProfileToken),
      claim: current?.claim,
      classicRewards: [...currentRewards, reward],
      deepRewards: current?.deepRewards ?? [],
      stockPairedRewards: current?.stockPairedRewards ?? [],
      deepV3Token: current?.deepV3Token,
      launchedByWallet: current?.launchedByWallet ?? false,
    });
  }

  for (const reward of deepRewards) {
    const key = reward.tokenAddress.toLowerCase();
    const current = entries.get(key);
    const currentRewards = current?.deepRewards ?? [];
    if (
      currentRewards.some(
        (item) =>
          item.vaultAddress.toLowerCase() ===
          reward.vaultAddress.toLowerCase(),
      )
    ) {
      continue;
    }
    entries.set(key, {
      token:
        current?.token ??
        ({
          address: reward.tokenAddress,
          name: reward.tokenName,
          symbol: reward.tokenSymbol,
          launchedAt: "",
          href: `/token/${reward.tokenAddress}?chain=1`,
          ...(reward.imageUrl ? { imageUrl: reward.imageUrl } : {}),
          launchModel: "deep",
        } satisfies ProfileToken),
      claim: current?.claim,
      classicRewards: current?.classicRewards ?? [],
      deepRewards: [...currentRewards, reward],
      stockPairedRewards: current?.stockPairedRewards ?? [],
      deepV3Token: current?.deepV3Token,
      launchedByWallet: current?.launchedByWallet ?? false,
    });
  }

  for (const reward of stockPairedRewards) {
    const key = reward.tokenAddress.toLowerCase();
    const current = entries.get(key);
    const currentRewards = current?.stockPairedRewards ?? [];
    if (
      currentRewards.some(
        (item) =>
          item.vaultAddress.toLowerCase() ===
          reward.vaultAddress.toLowerCase(),
      )
    ) {
      continue;
    }
    entries.set(key, {
      token:
        current?.token ??
        ({
          address: reward.tokenAddress,
          name: reward.tokenName,
          symbol: reward.tokenSymbol,
          launchedAt: "",
          href: `/token/${reward.tokenAddress}?chain=1`,
          ...(reward.imageUrl ? { imageUrl: reward.imageUrl } : {}),
          launchModel: "stock-paired",
        } satisfies ProfileToken),
      claim: current?.claim,
      classicRewards: current?.classicRewards ?? [],
      deepRewards: current?.deepRewards ?? [],
      stockPairedRewards: [...currentRewards, reward],
      deepV3Token: current?.deepV3Token,
      launchedByWallet: current?.launchedByWallet ?? false,
    });
  }

  for (const deepV3Token of deepV3Tokens) {
    const key = deepV3Token.tokenAddress.toLowerCase();
    const current = entries.get(key);
    if (
      current?.deepV3Token &&
      current.deepV3Token.vaultAddress.toLowerCase() !==
        deepV3Token.vaultAddress.toLowerCase()
    ) {
      throw new Error("Deep V3 token has conflicting liquidity state");
    }
    entries.set(key, {
      token: deepV3CreatorTokenToProfileToken(deepV3Token),
      claim: current?.claim,
      classicRewards: current?.classicRewards ?? [],
      deepRewards: current?.deepRewards ?? [],
      stockPairedRewards: current?.stockPairedRewards ?? [],
      deepV3Token,
      launchedByWallet: true,
    });
  }

  const portfolio = [...entries.values()];
  const marketCapSource = profileMarketCapSource(
    portfolio.map((entry) => entry.token),
  );
  return portfolio.sort((first, second) =>
    compareProfileTokensByMarketCap(
      first.token,
      second.token,
      marketCapSource,
    ),
  );
}

export function profileRouterLaunchEntries(
  entries: readonly ProfilePortfolioEntry[],
) {
  return entries.filter(
    (entry) =>
      entry.launchedByWallet &&
      entry.token.launchProvenance === "canonical-router",
  );
}

export function profileClaimableWei(
  entries: readonly ProfilePortfolioEntry[],
  account?: string,
) {
  return entries.reduce(
    (total, entry) => total + profileEntryClaimableWei(entry, account),
    0n,
  );
}

export function profileClaimActionCount(
  entries: readonly ProfilePortfolioEntry[],
  account?: string,
) {
  return entries.reduce((total, entry) => {
    const currentClaim =
      BigInt(entry.claim?.claimableWei ?? "0") > 0n ? 1 : 0;
    const classicClaims = profileRewardsForAccount(
      entry.classicRewards,
      account,
    ).filter((reward) => BigInt(reward.claimableWei) > 0n).length;
    const deepClaims = profileRewardsForAccount(
      entry.deepRewards,
      account,
    ).filter((reward) => BigInt(reward.claimableWei) > 0n).length;
    const stockPairedClaims = profileRewardsForAccount(
      entry.stockPairedRewards,
      account,
    ).filter((reward) => BigInt(reward.claimableRaw) > 0n).length;

    return (
      total +
      currentClaim +
      classicClaims +
      deepClaims +
      stockPairedClaims
    );
  }, 0);
}

function profileEntryClaimableWei(
  entry: ProfilePortfolioEntry,
  account?: string,
) {
  const normalizedAccount = account?.toLowerCase();

  return (
    BigInt(entry.claim?.claimableWei ?? "0") +
    entry.classicRewards.reduce(
      (total, reward) =>
        total +
        (!normalizedAccount ||
        reward.beneficiary.toLowerCase() === normalizedAccount
          ? BigInt(reward.claimableWei)
          : 0n),
      0n,
    ) +
    entry.deepRewards.reduce(
      (total, reward) =>
        total +
        (!normalizedAccount ||
        reward.beneficiary.toLowerCase() === normalizedAccount
          ? BigInt(reward.claimableWei)
          : 0n),
      0n,
    )
  );
}

function confirmedForAccount(
  state: ProfileClaimActionState | ClassicV3ActionState | undefined,
  account?: string,
) {
  return (
    state?.status === "confirmed" &&
    (!account || state.account.toLowerCase() === account.toLowerCase())
  );
}

function profileEntryOptimisticallyClaimedWei(
  entry: ProfilePortfolioEntry,
  account: string | undefined,
  actionStates: ProfileActionStateCollections,
) {
  const normalizedAccount = account?.toLowerCase();
  const ownsReward = (beneficiary: string) =>
    !normalizedAccount || beneficiary.toLowerCase() === normalizedAccount;
  let total = 0n;

  if (
    entry.claim &&
    confirmedForAccount(
      actionStates.claim[entry.claim.poolId.toLowerCase()],
      account,
    )
  ) {
    total += BigInt(entry.claim.claimableWei);
  }

  for (const reward of entry.classicRewards) {
    if (
      ownsReward(reward.beneficiary) &&
      confirmedForAccount(
        actionStates.classicV3[
          `${reward.vaultAddress.toLowerCase()}:claim`
        ],
        account,
      )
    ) {
      total += BigInt(reward.claimableWei);
    }
  }

  for (const reward of entry.deepRewards) {
    if (
      ownsReward(reward.beneficiary) &&
      confirmedForAccount(
        actionStates.deep[`${reward.vaultAddress.toLowerCase()}:claim`],
        account,
      )
    ) {
      total += BigInt(reward.claimableWei);
    }
  }

  return total;
}

function profileEntryActionableNativeWei(
  entry: ProfilePortfolioEntry,
  account: string | undefined,
  actionStates?: ProfileActionStateCollections,
) {
  const normalizedAccount = account?.toLowerCase();
  const ownsReward = (beneficiary: string) =>
    !normalizedAccount || beneficiary.toLowerCase() === normalizedAccount;
  let total = 0n;

  if (
    entry.claim &&
    !confirmedForAccount(
      actionStates?.claim[entry.claim.poolId.toLowerCase()],
      account,
    )
  ) {
    total += BigInt(entry.claim.claimableWei);
  }

  for (const reward of entry.classicRewards) {
    if (
      ownsReward(reward.beneficiary) &&
      !confirmedForAccount(
        actionStates?.classicV3[
          `${reward.vaultAddress.toLowerCase()}:claim`
        ],
        account,
      )
    ) {
      total += BigInt(reward.claimableWei);
    }
  }

  for (const reward of entry.deepRewards) {
    if (
      ownsReward(reward.beneficiary) &&
      !confirmedForAccount(
        actionStates?.deep[`${reward.vaultAddress.toLowerCase()}:claim`],
        account,
      )
    ) {
      total += BigInt(reward.claimableWei);
    }
  }

  return total;
}

function profileEntryActionableStockAmounts(
  entry: ProfilePortfolioEntry,
  account: string | undefined,
  actionStates?: ProfileActionStateCollections,
) {
  const normalizedAccount = account?.toLowerCase();
  let raw = 0n;
  let estimatedEthWei = 0n;

  for (const reward of entry.stockPairedRewards) {
    if (
      normalizedAccount &&
      reward.beneficiary.toLowerCase() !== normalizedAccount
    ) {
      continue;
    }
    const vault = reward.vaultAddress.toLowerCase();
    if (
      confirmedForAccount(actionStates?.stockPaired[`${vault}:claim`], account) ||
      confirmedForAccount(
        actionStates?.stockPaired[`${vault}:claim-as-eth`],
        account,
      )
    ) {
      continue;
    }

    raw += BigInt(reward.claimableRaw);
    if (reward.estimatedEthRaw && /^(0|[1-9]\d*)$/.test(reward.estimatedEthRaw)) {
      estimatedEthWei += BigInt(reward.estimatedEthRaw);
    }
  }

  return { raw, estimatedEthWei };
}

export function sortProfileClaimableEntries(
  entries: readonly ProfilePortfolioEntry[],
  account?: string,
  actionStates?: ProfileActionStateCollections,
) {
  return [...entries].sort((first, second) => {
    const firstStock = profileEntryActionableStockAmounts(
      first,
      account,
      actionStates,
    );
    const secondStock = profileEntryActionableStockAmounts(
      second,
      account,
      actionStates,
    );
    const firstEstimatedEth =
      profileEntryActionableNativeWei(first, account, actionStates) +
      firstStock.estimatedEthWei;
    const secondEstimatedEth =
      profileEntryActionableNativeWei(second, account, actionStates) +
      secondStock.estimatedEthWei;

    if (firstEstimatedEth !== secondEstimatedEth) {
      return firstEstimatedEth > secondEstimatedEth ? -1 : 1;
    }
    if (firstStock.raw !== secondStock.raw) {
      return firstStock.raw > secondStock.raw ? -1 : 1;
    }
    return first.token.address.localeCompare(second.token.address);
  });
}

export function paginateProfileClaimableEntries<T>(
  entries: readonly T[],
  requestedPage: number,
  pageSize = profileClaimPageSize,
) {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const totalPages = Math.max(1, Math.ceil(entries.length / safePageSize));
  const currentPage = Math.min(
    totalPages,
    Math.max(1, Math.floor(requestedPage) || 1),
  );
  const start = (currentPage - 1) * safePageSize;
  return {
    currentPage,
    totalPages,
    items: entries.slice(start, start + safePageSize),
  };
}

function profileEntryStockClaimableRaw(
  entry: ProfilePortfolioEntry,
  account?: string,
) {
  const rewards = account
    ? profileRewardsForAccount(entry.stockPairedRewards, account)
    : entry.stockPairedRewards;
  return rewards.reduce(
    (total, reward) => total + BigInt(reward.claimableRaw),
    0n,
  );
}

export function profileEntryHasClaimableReward(
  entry: ProfilePortfolioEntry,
  account?: string,
) {
  return (
    profileEntryClaimableWei(entry, account) > 0n ||
    profileEntryStockClaimableRaw(entry, account) > 0n
  );
}

function profileEntryHasVisibleClaimState(
  entry: ProfilePortfolioEntry,
  account: string | undefined,
  claimActionStates: Record<string, ProfileClaimActionState>,
  classicV3ActionStates: Record<string, ClassicV3ActionState>,
  deepActionStates: Record<string, DeepActionState>,
  stockPairedActionStates: Record<string, StockPairedActionState>,
) {
  const normalizedAccount = account?.toLowerCase();
  if (!normalizedAccount) return false;
  const belongsToAccount = (
    state: ProfileClaimActionState | ClassicV3ActionState | undefined,
  ) =>
    state?.account.toLowerCase() === normalizedAccount &&
    state.status !== "confirmed";

  if (
    entry.claim &&
    belongsToAccount(
      claimActionStates[entry.claim.poolId.toLowerCase()],
    )
  ) {
    return true;
  }

  if (
    profileRewardsForAccount(entry.classicRewards, account).some((reward) =>
      belongsToAccount(
        classicV3ActionStates[
          `${reward.vaultAddress.toLowerCase()}:claim`
        ],
      ),
    )
  ) {
    return true;
  }

  if (
    profileRewardsForAccount(entry.deepRewards, account).some((reward) =>
      belongsToAccount(
        deepActionStates[`${reward.vaultAddress.toLowerCase()}:claim`],
      ),
    )
  ) {
    return true;
  }

  return profileRewardsForAccount(
    entry.stockPairedRewards,
    account,
  ).some(
    (reward) =>
      belongsToAccount(
        stockPairedActionStates[
          `${reward.vaultAddress.toLowerCase()}:claim`
        ],
      ) ||
      belongsToAccount(
        stockPairedActionStates[
          `${reward.vaultAddress.toLowerCase()}:claim-as-eth`
        ],
      ),
  );
}

function profileEntryHasActionableReward(
  entry: ProfilePortfolioEntry,
  account: string | undefined,
  actionStates: ProfileActionStateCollections,
) {
  const stock = profileEntryActionableStockAmounts(
    entry,
    account,
    actionStates,
  );
  return (
    profileNativeClaimMeetsVisibilityThreshold(
      profileEntryActionableNativeWei(entry, account, actionStates),
    ) ||
    stock.raw > 0n ||
    profileEntryHasVisibleClaimState(
      entry,
      account,
      actionStates.claim,
      actionStates.classicV3,
      actionStates.deep,
      actionStates.stockPaired,
    )
  );
}

export function profileNativeClaimMeetsVisibilityThreshold(valueWei: bigint) {
  return valueWei >= MINIMUM_VISIBLE_NATIVE_CLAIM_WEI;
}

export function profileHasRewardSurface(
  entries: readonly ProfilePortfolioEntry[],
) {
  return entries.some(
    (entry) =>
      Boolean(entry.claim) ||
      entry.classicRewards.length > 0 ||
      entry.deepRewards.length > 0 ||
      entry.stockPairedRewards.length > 0,
  );
}

export function profileRewardsForAccount<
  Reward extends { beneficiary: string },
>(
  rewards: readonly Reward[],
  account?: string,
) {
  if (!account) return [];
  const normalizedAccount = account.toLowerCase();
  return rewards.filter(
    (reward) =>
      reward.beneficiary.toLowerCase() === normalizedAccount,
  );
}

export function ProfileSessionLoadingState({
  showDashboard = false,
}: Readonly<{ showDashboard?: boolean }> = {}) {
  return (
    <div className={`${styles.page} page-width`}>
      {showDashboard ? (
        <ProfileLoadingSkeleton label="Loading profile" showHero />
      ) : (
        <section
          className={`${styles.connectCard} liquid-glass-surface`}
          aria-busy="true"
          aria-label="Loading profile"
        >
          <Image
            className={styles.connectMark}
            src="/brand/loop/programmable-loop-mark-warm-ivory-v1-1536.png"
            alt=""
            width={512}
            height={512}
            sizes="(max-width: 700px) 72px, 188px"
            priority
          />
          <h1>Profile</h1>
          <p role="status">Loading profile…</p>
          <button className={styles.connectButton} type="button" disabled>
            Loading
          </button>
        </section>
      )}
    </div>
  );
}

function ProfileLoadingState() {
  return <ProfileLoadingSkeleton label="Loading profile" />;
}

export function ProfileRouterLaunches({
  entries,
  refreshing = false,
}: {
  entries: readonly ProfilePortfolioEntry[];
  refreshing?: boolean;
}) {
  if (!entries.length) return null;

  return (
    <section
      className={styles.launchesPanel}
      aria-labelledby="profile-launches-title"
      aria-busy={refreshing || undefined}
    >
      <header className={styles.launchesHeader}>
        <h2 id="profile-launches-title">Launches</h2>
        <span className={styles.visuallyHidden} role="status">{refreshing ? "Refreshing launches" : ""}</span>
      </header>

      <div className={styles.launchList}>
        {entries.map(({ token }) => {
          const tokenImage =
            token.imageUrl?.trim() || getFallbackTokenImage(token.address);
          const tokenImageSource = getTokenCardImageSource(tokenImage);
          const category =
            token.launchModel === "custom-graph" ? "Custom" : "Classic";

          return (
            <article className={styles.launchListItem} key={token.address}>
              <Link className={styles.launchRow} href={token.href}>
                <span className={styles.launchMark} aria-hidden="true">
                  <Image
                    src={tokenImageSource}
                    alt=""
                    fill
                    sizes="44px"
                    unoptimized={!canOptimizeTokenImage(tokenImageSource)}
                  />
                </span>
                <span className={styles.launchIdentity}>
                  <strong>{token.name}</strong>
                  <small>${token.symbol}</small>
                </span>
                <span className={styles.launchStatus}>
                  <strong>{category}</strong>
                </span>
              </Link>
              {token.partnerAttribution ? (
                <PartnerLaunchAttribution
                  attribution={token.partnerAttribution}
                  className={styles.launchPartnerAttribution}
                  compact
                />
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function beginPublicProfileRefresh(data: ProfileOnchainData, account: string): ProfileOnchainData {
  return data.status === "ready" && data.chainId === 1 && isProfileDataForAccount(data, account)
    ? data
    : loadingProfileData(account);
}

export function PublicCreatorProfile({
  account,
  connectedAccount,
  onConnect,
  viewChainId,
  onChangeChain,
}: {
  account: string;
  connectedAccount?: string;
  onConnect: () => void;
  viewChainId: ViewChainId;
  onChangeChain?: (chain: ViewChainId) => void;
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [data, setData] = useState<ProfileOnchainData>(() =>
    loadingProfileData(account)
  );
  const [refreshingAccount, setRefreshingAccount] = useState<string | null>(null);

  useEffect(() => {
    if (viewChainId !== 1) return;
    let disposed = false;
    let timedOut = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 10_000);
    queueMicrotask(() => {
      if (disposed) return;
      setRefreshingAccount(account.toLowerCase());
      setData((current) => beginPublicProfileRefresh(current, account));
    });
    void fetchCreatorProfile(account, controller.signal).then(
      (profile) => {
        if (!controller.signal.aborted) setData(profile);
      },
      (caught) => {
        if (disposed) return;
        setData((current) => resolveCreatorProfileReadFailure(
          beginPublicProfileRefresh(current, account), account,
          timedOut ? new ProfileResponseError("Launches took too long to load", "temporary") : caught,
        ));
      },
    ).finally(() => {
      window.clearTimeout(timeout);
      if (!disposed) setRefreshingAccount(null);
    });
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [account, refreshKey, viewChainId]);

  const scopedData = data.status === "ready" ? beginPublicProfileRefresh(data, account)
    : isProfileDataForAccount(data, account) ? data : loadingProfileData(account);
  const refreshing = refreshingAccount === account.toLowerCase();
  const entries = scopedData.status === "ready"
    ? profileRouterLaunchEntries(
        buildProfilePortfolio(scopedData.tokens, [], []),
      )
    : [];

  return (
    <div className={`${styles.page} page-width`}>
      <section className={`${styles.hero} ${styles.publicHero}`} aria-labelledby="public-profile-title">
        <div className={styles.avatar} aria-hidden="true">
          <span>{account.slice(2, 4).toUpperCase()}</span>
        </div>
        <div className={styles.heroCopy}>
          <div className={`${styles.nameRow} ${styles.publicProfileNameRow}`}>
            <h1 id="public-profile-title">Creator profile</h1>
            {connectedAccount ? <Link className={styles.editButton} href="/profile">My profile</Link> : <button
              className={styles.editButton}
              type="button"
              onClick={onConnect}
            >
              Connect wallet
            </button>}
          </div>
          <p className={styles.address} aria-label={`Profile wallet ${account}`}>{account}</p>
          <p className={styles.publicProfileNote}>
            {connectedAccount ? "You’re viewing another wallet’s profile." : "Connect this wallet to manage its profile."}
          </p>
        </div>
      </section>

      <ProfileChainSelector value={viewChainId} onChange={onChangeChain} />
      {viewChainId === 4663 ? <><RobinhoodProfileLaunches key={account.toLowerCase()} account={account} /><ProfileModules key={`modules:${account.toLowerCase()}`} account={account} /></> : scopedData.status === "loading" ? (
        <ProfileProjectsLoadingState />
      ) : scopedData.status === "error" ? (
        <section
          className={`${styles.launchesPanel} ${styles.publicProfileState}`}
          aria-live="polite"
        >
          <h2>Launches unavailable</h2>
          <p>Unable to load this public profile. Try again.</p>
          <button
            className={styles.retryButton}
            type="button"
            onClick={() => setRefreshKey((current) => current + 1)}
          >
            Try again
          </button>
        </section>
      ) : entries.length ? (
        <>
          <ProfileRouterLaunches entries={entries} refreshing={refreshing} />
          {scopedData.sourceQuality === "stale" && !refreshing ? <p className={styles.publicRefreshNote} role="status">
            Couldn’t refresh launches.
            <button className={styles.retryButton} type="button" onClick={() => setRefreshKey((current) => current + 1)}>Try again</button>
          </p> : null}
        </>
      ) : (
        <section
          className={`${styles.launchesPanel} ${styles.publicProfileState}`}
        >
          <h2>No finalized launches yet</h2>
          <p>Finalized Router launches will appear here.</p>
        </section>
      )}
    </div>
  );
}

export function RobinhoodProfileRewards() {
  return <section className={styles.portfolio} aria-label="Profile overview">
    <div className={`${styles.profileWorkspace} liquid-glass-surface`}>
      <FeeEarningsPanel nativeEarned={null} nativeClaimable={null} nativeClaimed={null} />
      <section className={styles.claimablePanel} aria-labelledby="profile-claimable-title">
        <header className={styles.panelHeader}>
          <h2 id="profile-claimable-title">Claim rewards</h2>
        </header>
        <div className={styles.claimEmpty}>
          <strong>Rewards depend on the hook</strong>
          <p>Custom hooks manage their own fees and claims.</p>
        </div>
      </section>
    </div>
  </section>;
}

export function ProfileAccountWorkspace({
  connected,
  data,
  account,
  claimActionStates,
  classicV3Rewards,
  classicV3SourceState,
  classicV3ActionStates,
  deepRewards,
  deepActionStates,
  deepV3Profile,
  stockPairedRewards,
  stockPairedActionStates,
  onClaim,
  onClassicV3Action,
  onDeepAction,
  onStockPairedAction,
  onConnect,
  onRetry,
  refreshing,
  refreshStatusMessage,
  terminalErrorReady,
}: {
  connected: boolean;
  data: ProfileOnchainData;
  account?: string;
  claimActionStates: Record<string, ProfileClaimActionState>;
  classicV3Rewards: ClassicV3ProfileRewards;
  classicV3SourceState: ClassicV3ProfileSourceState;
  classicV3ActionStates: Record<string, ClassicV3ActionState>;
  deepRewards: DeepProfileRewards;
  deepActionStates: Record<string, DeepActionState>;
  deepV3Profile: DeepV3CreatorProfile;
  stockPairedRewards: StockPairedProfileRewards;
  stockPairedActionStates: Record<string, StockPairedActionState>;
  onClaim: (claim: ProfileClaim) => void;
  onClassicV3Action: (
    reward: ClassicV3Reward,
    action: "claim" | "update-payout",
    newPayoutAddress?: string,
    allocationIndex?: number,
  ) => void;
  onDeepAction: (
    reward: DeepReward,
    action: "claim" | "update-payout",
    newPayoutAddress?: string,
  ) => void;
  onStockPairedAction: (
    reward: StockPairedReward,
    action: "claim" | "claim-as-eth" | "update-payout",
    newPayoutAddress?: string,
  ) => void;
  onConnect: () => void;
  onRetry: () => void;
  refreshing: boolean;
  refreshStatusMessage: string;
  terminalErrorReady: boolean;
}) {
  const [claimPage, setClaimPage] = useState(1);

  if (!connected) {
    return (
      <section className={styles.accountState}>
        <h2>Connect your wallet</h2>
        <p>Connect to see your launches and claimable rewards.</p>
        <button
          className={styles.connectButton}
          type="button"
          onClick={onConnect}
        >
          Connect wallet
        </button>
      </section>
    );
  }

  const currentReady = data.status === "ready";
  const classicReady = classicV3Rewards.status === "ready";
  const deepReady = deepRewards.status === "ready";
  const deepV3Ready = deepV3Profile.status === "ready";
  const stockPairedReady = stockPairedRewards.status === "ready";
  const loading =
    data.status === "loading" ||
    classicV3Rewards.status === "loading" ||
    deepRewards.status === "loading" ||
    deepV3Profile.status === "loading" ||
    stockPairedRewards.status === "loading";
  const integrityConflict =
    (data.status === "error" && data.errorKind === "integrity") ||
    classicV3SourceState.quality === "integrity";
  const phase = getProfileWorkspacePhase(
    [
      data.status,
      classicV3Rewards.status,
      deepRewards.status,
      deepV3Profile.status,
      stockPairedRewards.status,
    ],
    terminalErrorReady,
    integrityConflict,
  );

  if (phase === "loading") {
    return <ProfileLoadingState />;
  }

  if (phase === "error") {
    return (
      <section className={styles.accountState} aria-live="polite">
        <h2>
          {integrityConflict
            ? "Rewards need verification"
            : "Profile data unavailable"}
        </h2>
        <p>
          {integrityConflict
            ? "Current claim totals could not be verified. Try again before claiming."
            : "Unable to verify current rewards. Check your connection and try again."}
        </p>
        <button
          className={styles.retryButton}
          type="button"
          aria-busy={refreshing || undefined}
          onClick={onRetry}
        >
          {refreshing ? "Refreshing…" : "Try again"}
        </button>
      </section>
    );
  }

  const entries = buildProfilePortfolio(
    currentReady ? data.tokens : [],
    currentReady ? data.claims : [],
    classicReady ? classicV3Rewards.rewards : [],
    deepReady ? deepRewards.rewards : [],
    deepV3Ready ? deepV3Profile.tokens : [],
    stockPairedReady ? stockPairedRewards.rewards : [],
  );
  const actionStates: ProfileActionStateCollections = {
    claim: claimActionStates,
    classicV3: classicV3ActionStates,
    deep: deepActionStates,
    stockPaired: stockPairedActionStates,
  };
  const recordedNativeClaimed =
    (currentReady && data.claimedWei ? BigInt(data.claimedWei) : 0n) +
    (classicReady
      ? classicV3Rewards.rewards.reduce(
          (total, reward) => total + BigInt(reward.claimedWei),
          0n,
        )
      : 0n) +
    (deepReady
      ? deepRewards.rewards.reduce(
          (total, reward) => total + BigInt(reward.claimedWei),
          0n,
        )
      : 0n);
  const nativeClaimed =
    recordedNativeClaimed +
    entries.reduce(
      (total, entry) =>
        total +
        profileEntryOptimisticallyClaimedWei(entry, account, actionStates),
      0n,
    );
  const nativeClaimable = entries.reduce(
    (total, entry) =>
      total +
      profileEntryActionableNativeWei(entry, account, actionStates),
    0n,
  );
  const nativeEarned = nativeClaimed + nativeClaimable;
  const nativeRewardSourceStatuses = [
    data.status,
    classicV3Rewards.status,
    deepRewards.status,
  ] as const;
  const rewardDataQuality = getProfileRewardDataQuality(
    nativeRewardSourceStatuses,
    classicV3SourceState.quality,
    data.sourceQuality ?? "current",
  );
  const claimSubmissionAllowed = profileClaimSubmissionAllowed(
    rewardDataQuality,
  );
  const claimableEntries = claimSubmissionAllowed
    ? sortProfileClaimableEntries(
        entries.filter((entry) =>
          profileEntryHasActionableReward(entry, account, actionStates),
        ),
        account,
        actionStates,
      )
    : [];
  const claimPageData = paginateProfileClaimableEntries(
    claimableEntries,
    claimPage,
  );
  const emptyState =
    rewardDataQuality === "current"
      ? {
          title: "No rewards to claim",
          description:
            "Rewards appear once a launch has at least 0.0001 ETH available.",
        }
      : rewardDataQuality === "stale"
        ? {
            title: "No rewards in the last verified check",
            description: "Refresh to check current rewards.",
          }
        : {
            title: "Current rewards are unavailable",
            description: "Refresh to check your claimable amount.",
          };

  return (
    <section
      className={styles.portfolio}
      aria-label="Profile overview"
      aria-busy={loading || refreshing || undefined}
    >
      <div
        className={`${styles.profileWorkspace} liquid-glass-surface`}
      >
        <FeeEarningsPanel
          nativeEarned={claimSubmissionAllowed ? nativeEarned : null}
          nativeClaimable={claimSubmissionAllowed ? nativeClaimable : null}
          nativeClaimed={claimSubmissionAllowed ? nativeClaimed : null}
        />

        <section
          className={styles.claimablePanel}
          aria-labelledby="profile-claimable-title"
          data-visible-count={claimPageData.items.length}
        >
          <header className={styles.panelHeader}>
            <h2 id="profile-claimable-title">Claim rewards</h2>
            <span
              className={styles.visuallyHidden}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {refreshing ? "Refreshing rewards" : ""}
            </span>
            <span
              className={styles.visuallyHidden}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {refreshing ? "" : refreshStatusMessage}
            </span>
            <div className={styles.claimPanelActions}>
              <button
                className={`${styles.claimRefresh} ${
                  refreshing ? styles.claimRefreshActive : ""
                }`}
                type="button"
                aria-label={
                  refreshing
                    ? "Refreshing claimable rewards"
                    : "Refresh claimable rewards"
                }
                aria-busy={refreshing || undefined}
                disabled={refreshing}
                onClick={onRetry}
              >
                <RefreshCw aria-hidden="true" size={15} strokeWidth={1.8} />
                <span>{refreshing ? "Refreshing" : "Refresh"}</span>
              </button>
              {claimPageData.totalPages > 1 ? (
                <nav
                  className={styles.claimPagination}
                  aria-label="Claimable rewards pages"
                >
                  <button
                    type="button"
                    aria-label="Previous claimable rewards page"
                    disabled={claimPageData.currentPage === 1}
                    onClick={() =>
                      setClaimPage(Math.max(1, claimPageData.currentPage - 1))
                    }
                  >
                    <ChevronLeft aria-hidden="true" size={17} strokeWidth={1.8} />
                  </button>
                  <span aria-live="polite" aria-atomic="true">
                    {claimPageData.currentPage} / {claimPageData.totalPages}
                  </span>
                  <button
                    type="button"
                    aria-label="Next claimable rewards page"
                    disabled={
                      claimPageData.currentPage === claimPageData.totalPages
                    }
                    onClick={() =>
                      setClaimPage(
                        Math.min(
                          claimPageData.totalPages,
                          claimPageData.currentPage + 1,
                        ),
                      )
                    }
                  >
                    <ChevronRight aria-hidden="true" size={17} strokeWidth={1.8} />
                  </button>
                </nav>
              ) : null}
            </div>
          </header>

          {claimableEntries.length ? (
            <div className={styles.claimList}>
              {claimPageData.items.map((entry) => (
                <ProfileClaimRow
                  key={entry.token.address}
                  entry={entry}
                  account={account}
                  claimActionStates={claimActionStates}
                  classicV3ActionStates={classicV3ActionStates}
                  deepActionStates={deepActionStates}
                  stockPairedActionStates={stockPairedActionStates}
                  onClaim={onClaim}
                  onClassicV3Action={onClassicV3Action}
                  onDeepAction={onDeepAction}
                  onStockPairedAction={onStockPairedAction}
                />
              ))}
            </div>
          ) : (
            <div className={styles.claimEmpty}>
              <strong>{emptyState.title}</strong>
              <p>{emptyState.description}</p>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function FeeEarningsPanel({
  nativeEarned,
  nativeClaimable,
  nativeClaimed,
}: {
  nativeEarned: bigint | null;
  nativeClaimable: bigint | null;
  nativeClaimed: bigint | null;
}) {
  const composition =
    nativeEarned !== null && nativeEarned > 0n &&
      nativeClaimable !== null && nativeClaimed !== null
      ? {
          available:
            Number((nativeClaimable * 10_000n) / nativeEarned) / 100,
          claimed: Number((nativeClaimed * 10_000n) / nativeEarned) / 100,
        }
      : null;

  return (
    <section
      className={styles.feePanel}
      aria-labelledby="fee-earnings-title"
    >
      <header className={styles.feePanelHeader}>
        <h2 id="fee-earnings-title">Fees earned</h2>
      </header>

      <div className={styles.feeSummary}>
        <span className={styles.feeSummaryLabel}>Total earned</span>
        <strong>{nativeEarned === null ? <span aria-label="Not available">—</span> : formatWei(nativeEarned)}</strong>
        <div className={styles.feeBreakdown}>
          <span>
            Available <b>{nativeClaimable === null ? "—" : formatWei(nativeClaimable)}</b>
          </span>
          <span>
            Claimed <b>{nativeClaimed === null ? "—" : formatWei(nativeClaimed)}</b>
          </span>
        </div>
        {composition ? (
          <div
            className={styles.feeComposition}
            role="img"
            aria-label={`${composition.available.toFixed(2)}% available and ${composition.claimed.toFixed(2)}% claimed`}
          >
            <span
              className={styles.feeCompositionClaimable}
              style={{ width: `${composition.available}%` }}
            />
            <span
              className={styles.feeCompositionClaimed}
              style={{ width: `${composition.claimed}%` }}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function actionPending(
  state: ProfileClaimActionState | ClassicV3ActionState | undefined,
) {
  return (
    state?.status === "preparing" ||
    state?.status === "wallet" ||
    state?.status === "confirming"
  );
}

export function actionCanCheckStatus(
  state: ProfileClaimActionState | ClassicV3ActionState | undefined,
) {
  return (
    (state?.status === "pending" || state?.status === "not-found") &&
    Boolean(state.transactionHash)
  );
}

export function actionSettling(
  state: ProfileClaimActionState | ClassicV3ActionState | undefined,
) {
  return actionPending(state);
}

export function profileActionStateUsesNeutralStatus(
  state: ProfileClaimActionState | ClassicV3ActionState | undefined,
) {
  return Boolean(
    state && (state.status !== "error" || state.recoverable === true),
  );
}

export function prioritizedProfileActionState(
  states: readonly (
    | ProfileClaimActionState
    | ClassicV3ActionState
    | undefined
  )[],
) {
  return (
    states.find((state) => actionPending(state)) ??
    states.find((state) => state?.status === "error") ??
    states.find((state) => actionCanCheckStatus(state)) ??
    states.find((state) => state?.status === "confirmed")
  );
}

export function actionLabel(
  state: ProfileClaimActionState | ClassicV3ActionState | undefined,
) {
  if (state?.status === "preparing") return "Preparing";
  if (state?.status === "wallet") return "Confirm in wallet";
  if (state?.status === "confirming") return "Confirming";
  if (state?.status === "pending") return "Check status";
  if (state?.status === "not-found") return "Check status";
  if (state?.status === "confirmed") return "Confirmed";
  if (state?.status === "error") return "Try again";
  return "Claim";
}

type ProfileClaimDialogAction = {
  id: string;
  label: string;
  description: string;
  state?: ProfileClaimActionState | ClassicV3ActionState;
  disabled: boolean;
  emphasis: "primary" | "secondary";
  onSelect: () => void;
};

type ProfileClaimDialogGroup = {
  id: string;
  source: string;
  amount: string;
  actions: readonly ProfileClaimDialogAction[];
};

function claimDialogActionLabel(
  state: ProfileClaimActionState | ClassicV3ActionState | undefined,
) {
  const stateLabel = actionLabel(state);
  return stateLabel === "Claim" ? "Claim" : stateLabel;
}

function ProfileClaimDialog({
  open,
  dialogId,
  tokenName,
  tokenSymbol,
  groups,
  onClose,
}: {
  open: boolean;
  dialogId: string;
  tokenName: string;
  tokenSymbol: string;
  groups: readonly ProfileClaimDialogGroup[];
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = `${dialogId}-title`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
      closeButtonRef.current?.focus();
      return;
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      id={dialogId}
      className={styles.claimDialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onClick={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div
        className={`${styles.claimDialogSurface} liquid-glass-surface`}
      >
        <header className={styles.claimDialogHeader}>
          <div>
            <span>Choose how to receive</span>
            <h3 id={titleId}>Claim rewards</h3>
            <p>
              {tokenName} <small>${tokenSymbol}</small>
            </p>
          </div>
          <button
            ref={closeButtonRef}
            className={styles.claimDialogClose}
            type="button"
            aria-label="Close claim rewards"
            onClick={onClose}
          >
            <X aria-hidden="true" size={18} strokeWidth={1.8} />
          </button>
        </header>

        <div className={styles.claimDialogGroups}>
          {groups.map((group) => (
            <section className={styles.claimDialogGroup} key={group.id}>
              <header>
                <span>{group.source}</span>
                <strong>{group.amount}</strong>
              </header>
              <div className={styles.claimDialogActions}>
                {group.actions.map((action) => (
                  <div className={styles.claimDialogAction} key={action.id}>
                    <p>{action.state?.message || action.description}</p>
                    <button
                      className={
                        action.emphasis === "primary"
                          ? styles.claimButton
                          : styles.secondaryAction
                      }
                      type="button"
                      aria-label={`${action.label}: ${action.description} from ${group.source} for ${tokenName} (${tokenSymbol})`}
                      aria-busy={actionPending(action.state) || undefined}
                      disabled={action.disabled}
                      onClick={() => {
                        onClose();
                        action.onSelect();
                      }}
                    >
                      {action.label}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </dialog>
  );
}

function ProfileClaimRow({
  entry,
  account,
  claimActionStates,
  classicV3ActionStates,
  deepActionStates,
  stockPairedActionStates,
  onClaim,
  onClassicV3Action,
  onDeepAction,
  onStockPairedAction,
}: {
  entry: ProfilePortfolioEntry;
  account?: string;
  claimActionStates: Record<string, ProfileClaimActionState>;
  classicV3ActionStates: Record<string, ClassicV3ActionState>;
  deepActionStates: Record<string, DeepActionState>;
  stockPairedActionStates: Record<string, StockPairedActionState>;
  onClaim: (claim: ProfileClaim) => void;
  onClassicV3Action: (
    reward: ClassicV3Reward,
    action: "claim" | "update-payout",
    newPayoutAddress?: string,
    allocationIndex?: number,
  ) => void;
  onDeepAction: (
    reward: DeepReward,
    action: "claim" | "update-payout",
    newPayoutAddress?: string,
  ) => void;
  onStockPairedAction: (
    reward: StockPairedReward,
    action: "claim" | "claim-as-eth" | "update-payout",
    newPayoutAddress?: string,
  ) => void;
}) {
  const {
    token,
    claim,
    classicRewards,
    deepRewards,
    stockPairedRewards,
  } = entry;
  const [claimDialogOpen, setClaimDialogOpen] = useState(false);
  const claimTriggerRef = useRef<HTMLButtonElement>(null);
  const dialogId = `profile-claim-${token.address.slice(2).toLowerCase()}`;
  const closeClaimDialog = useCallback(() => {
    setClaimDialogOpen(false);
    window.requestAnimationFrame(() => claimTriggerRef.current?.focus());
  }, []);
  const claimState = claim
    ? claimActionStates[claim.poolId.toLowerCase()]
    : undefined;
  const scopedClaimState =
    claimState?.account.toLowerCase() === account?.toLowerCase()
      ? claimState
      : undefined;
  const activeClaimState =
    scopedClaimState?.status === "confirmed" ? undefined : scopedClaimState;
  const ownedClassicRewards = profileRewardsForAccount(
    classicRewards,
    account,
  );
  const classicClaims = ownedClassicRewards.map((reward) => {
    const state =
      classicV3ActionStates[
        `${reward.vaultAddress.toLowerCase()}:claim`
      ];
    const scopedState =
      state?.account.toLowerCase() === account?.toLowerCase()
        ? state
        : undefined;
    const confirmed = scopedState?.status === "confirmed";
    return {
      reward,
      claimable: confirmed ? 0n : BigInt(reward.claimableWei),
      state: confirmed ? undefined : scopedState,
    };
  });
  const ownedDeepRewards = profileRewardsForAccount(deepRewards, account);
  const deepClaims = ownedDeepRewards.map((reward) => {
    const state =
      deepActionStates[
        `${reward.vaultAddress.toLowerCase()}:claim`
      ];
    const scopedState =
      state?.account.toLowerCase() === account?.toLowerCase()
        ? state
        : undefined;
    const confirmed = scopedState?.status === "confirmed";
    return {
      reward,
      claimable: confirmed ? 0n : BigInt(reward.claimableWei),
      state: confirmed ? undefined : scopedState,
    };
  });
  const ownedStockPairedRewards = profileRewardsForAccount(
    stockPairedRewards,
    account,
  );
  const stockPairedClaims = ownedStockPairedRewards.map((reward) => {
    const claimState =
      stockPairedActionStates[
        `${reward.vaultAddress.toLowerCase()}:claim`
      ];
    const ethState =
      stockPairedActionStates[
        `${reward.vaultAddress.toLowerCase()}:claim-as-eth`
      ];
    const scopedClaimState =
      claimState?.account.toLowerCase() === account?.toLowerCase()
        ? claimState
        : undefined;
    const scopedEthState =
      ethState?.account.toLowerCase() === account?.toLowerCase()
        ? ethState
        : undefined;
    const confirmed =
      scopedClaimState?.status === "confirmed" ||
      scopedEthState?.status === "confirmed";
    return {
      reward,
      claimable: confirmed ? 0n : BigInt(reward.claimableRaw),
      claimState: confirmed ? undefined : scopedClaimState,
      ethState: confirmed ? undefined : scopedEthState,
    };
  });
  const currentClaimable =
    scopedClaimState?.status === "confirmed"
      ? 0n
      : BigInt(claim?.claimableWei ?? "0");
  const classicClaimable = classicClaims.reduce(
    (total, item) => total + item.claimable,
    0n,
  );
  const deepClaimable = deepClaims.reduce(
    (total, item) => total + item.claimable,
    0n,
  );
  const totalClaimable =
    currentClaimable + classicClaimable + deepClaimable;
  const stockPairedClaimable = stockPairedClaims.reduce(
    (total, item) => total + item.claimable,
    0n,
  );
  const stockQuoteSymbol =
    ownedStockPairedRewards[0]?.quoteAssetSymbol;
  const tokenImage =
    token.imageUrl?.trim() || getFallbackTokenImage(token.address);
  const tokenImageSource = getTokenCardImageSource(tokenImage);
  const marketCapLabel = profileTokenMarketCapLabel(token);
  const currentClaimAvailable =
    Boolean(claim) && (currentClaimable > 0n || Boolean(activeClaimState));
  const formattedStockReward =
    stockPairedClaimable > 0n && stockQuoteSymbol
      ? `${new Intl.NumberFormat("en-US", {
          maximumSignificantDigits: 5,
        }).format(Number(formatUnits(stockPairedClaimable, 18)))} ${
          stockQuoteSymbol
        }`
      : "";
  const recipient = account ? shortenAddress(account) : "connected wallet";
  const claimGroups: ProfileClaimDialogGroup[] = [];

  if (claim && currentClaimAvailable) {
    claimGroups.push({
      id: `position:${claim.poolId.toLowerCase()}`,
      source: "Position fees",
      amount: formatWei(currentClaimable),
      actions: [
        {
          id: "claim-position",
          label: claimDialogActionLabel(activeClaimState),
          description: `Receive ETH at ${recipient}`,
          state: activeClaimState,
          disabled:
            actionPending(activeClaimState) ||
            (currentClaimable === 0n &&
              !actionCanCheckStatus(activeClaimState)),
          emphasis: "primary",
          onSelect: () => onClaim(claim),
        },
      ],
    });
  }

  for (const { reward, claimable, state } of classicClaims) {
    if (claimable === 0n && !state) continue;
    claimGroups.push({
      id: `classic:${reward.vaultAddress.toLowerCase()}`,
      source: `Classic fees · ${shortenAddress(reward.vaultAddress)}`,
      amount: formatWei(claimable),
      actions: [
        {
          id: "claim-classic",
          label: claimDialogActionLabel(state),
          description: `Receive ETH at ${recipient}`,
          state,
          disabled:
            actionPending(state) ||
            (claimable === 0n && !actionCanCheckStatus(state)),
          emphasis: "primary",
          onSelect: () => onClassicV3Action(reward, "claim"),
        },
      ],
    });
  }

  for (const { reward, claimable, state } of deepClaims) {
    if (claimable === 0n && !state) continue;
    claimGroups.push({
      id: `deep:${reward.vaultAddress.toLowerCase()}`,
      source: `Deep fees · ${shortenAddress(reward.vaultAddress)}`,
      amount: formatWei(claimable),
      actions: [
        {
          id: "claim-deep",
          label: claimDialogActionLabel(state),
          description: `Receive ETH at ${shortenAddress(reward.payoutAddress)}`,
          state,
          disabled:
            actionPending(state) ||
            (claimable === 0n && !actionCanCheckStatus(state)),
          emphasis: "primary",
          onSelect: () => onDeepAction(reward, "claim"),
        },
      ],
    });
  }

  for (const {
    reward,
    claimable,
    claimState: stockClaimState,
    ethState,
  } of stockPairedClaims) {
    if (claimable === 0n && !stockClaimState && !ethState) continue;
    const paths = getStockPairedClaimPaths(reward, account);
    const ethRecoveryAvailable = Boolean(
      ethState?.claimTransactionHash && ethState.amountIn,
    );
    const showEthPath = shouldShowStockPairedEthClaimPath(
      reward,
      account,
      ethState,
    );
    const estimate = formatStockRewardEstimate(reward);
    const quoteActionActive =
      stockClaimState && stockClaimState.status !== "error";
    const ethActionActive = ethState && ethState.status !== "error";
    const actions: ProfileClaimDialogAction[] = [
      {
        id: "claim-quote-asset",
        label: claimDialogActionLabel(stockClaimState),
        description: `Receive ${reward.quoteAssetSymbol} at ${shortenAddress(reward.payoutAddress)}`,
        state: stockClaimState,
        disabled:
          actionPending(stockClaimState) ||
          Boolean(ethActionActive) ||
          (claimable === 0n &&
            !actionCanCheckStatus(stockClaimState)),
        emphasis: paths.length === 1 ? "primary" : "secondary",
        onSelect: () => onStockPairedAction(reward, "claim"),
      },
    ];

    if (showEthPath) {
      actions.push({
        id: "claim-and-convert-to-eth",
        label: claimDialogActionLabel(ethState),
        description: `Claim ${reward.quoteAssetSymbol}, then swap on Uniswap${estimate ? ` · ${estimate}` : ""}`,
        state: ethState,
        disabled:
          actionPending(ethState) ||
          Boolean(quoteActionActive) ||
          (claimable === 0n &&
            !actionCanCheckStatus(ethState) &&
            !ethRecoveryAvailable),
        emphasis: "primary",
        onSelect: () => onStockPairedAction(reward, "claim-as-eth"),
      });
    }

    claimGroups.push({
      id: `stock:${reward.vaultAddress.toLowerCase()}`,
      source: "Stock-Paired fees",
      amount: `${reward.claimable} ${reward.quoteAssetSymbol}`,
      actions,
    });
  }

  const rowActionPending = claimGroups.some((group) =>
    group.actions.some((action) => actionPending(action.state)),
  );
  const rowActionStates = claimGroups
    .flatMap((group) => group.actions)
    .map((action) => action.state);
  const rowActionState = prioritizedProfileActionState(rowActionStates);
  const rowActionLabel = rowActionState
    ? actionLabel(rowActionState)
    : "Claim rewards";

  return (
    <article className={styles.claimRow}>
      <div className={styles.claimRowHeader}>
        <Link className={styles.claimIdentity} href={token.href}>
          <span className={styles.claimArt}>
            <Image
              src={tokenImageSource}
              alt=""
              fill
              sizes="48px"
              unoptimized={!canOptimizeTokenImage(tokenImageSource)}
            />
          </span>
          <span className={styles.claimCopy}>
            <strong>{token.name}</strong>
            <span>${token.symbol}</span>
            {marketCapLabel ? (
              <small>Market cap {marketCapLabel}</small>
            ) : null}
          </span>
        </Link>

        <div className={styles.claimAmount}>
          <strong>
            <span className={styles.visuallyHidden}>Claimable: </span>
            {totalClaimable > 0n
              ? formatWei(totalClaimable)
              : formattedStockReward || formatWei(0n)}
          </strong>
          {totalClaimable > 0n && formattedStockReward ? (
            <small>+ {formattedStockReward}</small>
          ) : null}
        </div>
      </div>

      <div className={styles.actions}>
        <button
          ref={claimTriggerRef}
          className={`${styles.claimButton} ${
            rowActionPending ? styles.claimRefreshActive : ""
          }`}
          type="button"
          aria-haspopup="dialog"
          aria-controls={dialogId}
          aria-expanded={claimDialogOpen}
          aria-busy={rowActionPending || undefined}
          aria-label={`${rowActionLabel} for ${token.name} (${token.symbol})`}
          disabled={rowActionPending || claimGroups.length === 0}
          style={rowActionPending ? { gap: 6 } : undefined}
          onClick={() => setClaimDialogOpen(true)}
        >
          {rowActionPending ? (
            <RefreshCw aria-hidden="true" size={14} strokeWidth={1.8} />
          ) : null}
          <span>{rowActionLabel}</span>
        </button>
      </div>

      <ProfileClaimDialog
        open={claimDialogOpen}
        dialogId={dialogId}
        tokenName={token.name}
        tokenSymbol={token.symbol}
        groups={claimGroups}
        onClose={closeClaimDialog}
      />

      <ProfileActionState state={rowActionState} />
    </article>
  );
}

function ProfileActionState({
  state,
}: {
  state?: ProfileClaimActionState | ClassicV3ActionState;
}) {
  let neutralStatus = false;
  if (profileActionStateUsesNeutralStatus(state)) {
    neutralStatus = true;
  }
  const visibleError = Boolean(
    state?.status === "error" &&
    !neutralStatus,
  );
  return (
    <>
      <span
        className={styles.visuallyHidden}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {visibleError ? "" : state?.message ?? ""}
      </span>
      {visibleError ? (
        <p className={styles.rowError} role="alert">
          {state?.message}
        </p>
      ) : null}
    </>
  );
}
