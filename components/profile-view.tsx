"use client";

import Image from "next/image";
import Link from "next/link";
import { formatUnits, parseUnits, type Hex } from "viem";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { useWallet } from "@/components/wallet-provider";
import { useLiveDataRefresh } from "@/components/use-live-data-refresh";
import { isConfiguredClassicV3ReleaseReady } from "@/lib/classic-v3-release";
import { prepareAvatarImage } from "@/lib/profile/avatar";
import {
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
import { prepareCreatorClaim } from "@/lib/profile/creator-claim";
import {
  canOptimizeTokenImage,
  getTokenCardImageSource,
} from "@/lib/token-image";
import {
  getProfileStorageKey,
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
  UNAVAILABLE_PROFILE_DATA,
  type ProfileClaim,
  type ProfileActivity,
  type ProfileOnchainData,
  type ProfileToken,
} from "@/lib/profile/onchain-profile";
import styles from "./profile-experience.module.css";

const fallbackTokenImages = [
  "/brand/programmable-token-fallback-01-dawn.webp",
  "/brand/programmable-token-fallback-02-moon.webp",
  "/brand/programmable-token-fallback-03-sun.webp",
  "/brand/programmable-token-fallback-04-mint.webp",
  "/brand/programmable-token-fallback-05-lavender.webp",
  "/brand/programmable-token-fallback-06-dusk.webp",
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
const CREATOR_PROFILE_CACHE_TTL_MS = 30_000;
const MAX_CREATOR_PROFILE_CACHE_ENTRIES = 8;
export const PROFILE_LIVE_REFRESH_INTERVAL_MS = 60_000;

function readCachedCreatorProfile(account: string) {
  const key = account.toLowerCase();
  const cached = creatorProfileCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.updatedAt >= CREATOR_PROFILE_CACHE_TTL_MS) {
    creatorProfileCache.delete(key);
    return null;
  }
  return cached.data;
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

type ProfileClaimActionState = {
  account: string;
  status:
    | "preparing"
    | "wallet"
    | "confirming"
    | "pending"
    | "confirmed"
    | "error";
  message: string;
  transactionHash?: Hex;
};

type ClassicV3ActionState = {
  account: string;
  status:
    | "preparing"
    | "wallet"
    | "confirming"
    | "pending"
    | "confirmed"
    | "error";
  message: string;
  transactionHash?: Hex;
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
  receiptStatus: "pending" | "confirmed" | "reverted" | "unavailable",
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
      message: "Status unavailable. Check the same transaction again",
    };
  }
  return {
    outcome: "hold",
    message:
      pendingStage === "claim"
        ? "Claim submitted. Check its status before converting"
        : pendingStage === "swap"
          ? "Conversion submitted. Check its status before showing it as complete"
          : "Approval submitted. Check its status before continuing",
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
): ProfileWorkspacePhase {
  if (statuses.some((status) => status === "loading")) {
    return "loading";
  }
  if (statuses.some((status) => status === "ready")) return "ready";
  if (!terminalErrorReady) return "loading";
  return "error";
}

const pendingProfileTransactionStoragePrefix =
  "programmable:profile-pending-transactions:v1:";
const maximumPersistedProfileTransactions = 32;
const terminalProfileErrorDelayMs = 900;
const ethereumAddressPattern = /^0x[0-9a-f]{40}$/;
const ethereumBytes32Pattern = /^0x[0-9a-f]{64}$/;

function shortenAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
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
  fetcher?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
  signal?: AbortSignal;
  policy?: "stock-paired";
};

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

export async function waitForTransaction(
  transactionHash: Hex,
  chainId: number,
  options: WaitForTransactionOptions = {},
): Promise<"pending" | "confirmed" | "reverted"> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 40));
  const intervalMs = options.intervalMs ?? 1_500;
  const fetcher = options.fetcher ?? fetch;
  const wait =
    options.wait ??
    ((milliseconds: number) =>
      waitForTransactionInterval(milliseconds, options.signal));

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    throwIfTransactionPollAborted(options.signal);
    const response = await fetcher(
      `/api/transaction-status?hash=${encodeURIComponent(
        transactionHash,
      )}&chainId=${chainId}${
        options.policy ? `&policy=${options.policy}` : ""
      }`,
      {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: options.signal,
      },
    );
    throwIfTransactionPollAborted(options.signal);
    const body = (await response.json()) as {
      status?: "pending" | "confirmed" | "reverted";
    };
    throwIfTransactionPollAborted(options.signal);
    if (!response.ok) {
      throw new Error("The transaction status could not be checked");
    }
    if (body.status === "confirmed" || body.status === "reverted") {
      return body.status;
    }
    if (attempt < maxAttempts - 1) {
      await wait(intervalMs);
      throwIfTransactionPollAborted(options.signal);
    }
  }
  return "pending";
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
      message: "Status check paused. Check the same transaction again",
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
    message: "Transaction submitted. Check its current status",
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

export function ProfileView({ onchainData }: ProfileViewProps = {}) {
  const { wallet, openWallet, sendTransaction, connecting } = useWallet();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const account = wallet?.account;
  const activeAccountRef = useRef(account);
  const transactionPollControllersRef = useRef<Set<AbortController>>(
    new Set(),
  );
  const stockPairedActionLocksRef = useRef<Set<string>>(new Set());
  const hydratedPendingAccountRef = useRef<string | undefined>(undefined);
  const confirmedProfileTransactionsRef = useRef<
    Record<PendingProfileTransactionSource, Map<string, Hex>>
  >({
    classic: new Map(),
    "classic-v3": new Map(),
    deep: new Map(),
    "stock-paired": new Map(),
  });
  const savedProfile = useWalletLocalProfile(account);
  const [editingAccount, setEditingAccount] = useState("");
  const [usernameDraft, setUsernameDraft] = useState("");
  const [avatarDraft, setAvatarDraft] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [avatarError, setAvatarError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [preparingImage, setPreparingImage] = useState(false);
  const [remoteOnchainData, setRemoteOnchainData] =
    useState<ProfileOnchainData>(UNAVAILABLE_PROFILE_DATA);
  const [profileRefresh, setProfileRefresh] = useState(0);
  const liveProfileRefresh = useLiveDataRefresh({
    enabled: Boolean(account),
    intervalMs: PROFILE_LIVE_REFRESH_INTERVAL_MS,
  });
  const [terminalErrorReadyKey, setTerminalErrorReadyKey] = useState("");
  const [classicV3Rewards, setClassicV3Rewards] =
    useState<ClassicV3ProfileRewards>(EMPTY_CLASSIC_V3_PROFILE);
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

  useEffect(() => {
    const previousAccount = activeAccountRef.current?.toLowerCase();
    activeAccountRef.current = account;
    const normalizedAccount = account?.toLowerCase();

    if (previousAccount !== normalizedAccount) {
      abortTransactionPolls();
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

  useEffect(
    () => () => {
      abortTransactionPolls();
    },
    [abortTransactionPolls],
  );

  useEffect(() => {
    if (!profileLoadKey) return;
    const timeout = window.setTimeout(() => {
      setTerminalErrorReadyKey(profileLoadKey);
    }, terminalProfileErrorDelayMs);
    return () => window.clearTimeout(timeout);
  }, [profileLoadKey]);

  useEffect(() => {
    if (onchainData) return;
    if (!account) return;

    const controller = new AbortController();
    const confirmedTransactions = new Map(
      confirmedProfileTransactionsRef.current.classic,
    );

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
        setRemoteOnchainData((current) =>
          isProfileDataForAccount(current, account) &&
          current.status === "ready"
            ? current
            : errorProfileData(
                account,
                caught instanceof Error
                  ? caught.message
                  : "Onchain profile data could not be loaded",
              ),
        );
      });

    return () => controller.abort();
  }, [account, liveProfileRefresh, onchainData, profileRefresh]);

  useEffect(() => {
    if (!account || !classicV3ReleaseAvailable) return;
    const controller = new AbortController();
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
        }
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setClassicV3Rewards((current) =>
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
                    : "Classic rewards could not be loaded",
              },
        );
      });
    return () => controller.abort();
  }, [account, liveProfileRefresh, profileRefresh]);

  useEffect(() => {
    if (!account || !deepReleaseAvailable) return;
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
      });
    return () => controller.abort();
  }, [account, liveProfileRefresh, profileRefresh]);

  useEffect(() => {
    if (!account || !deepV3ReleaseAvailable) return;
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
      });
    return () => controller.abort();
  }, [account, liveProfileRefresh, profileRefresh]);

  useEffect(() => {
    if (!account || !stockPairedReleaseAvailable) return;
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
      });
    return () => controller.abort();
  }, [account, liveProfileRefresh, profileRefresh]);

  function beginEditingProfile() {
    setUsernameDraft(savedProfile.username);
    setAvatarDraft(savedProfile.avatarDataUrl);
    setUsernameError("");
    setAvatarError("");
    setSaveError("");
    setEditingAccount(account?.toLowerCase() ?? "");
  }

  function cancelEditingProfile() {
    setUsernameDraft(savedProfile.username);
    setAvatarDraft(savedProfile.avatarDataUrl);
    setUsernameError("");
    setAvatarError("");
    setSaveError("");
    setEditingAccount("");
  }

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account || preparingImage) return;

    const nextUsername = normalizeProfileUsername(usernameDraft);
    const nextUsernameError = getProfileUsernameError(nextUsername);

    if (nextUsernameError) {
      setUsernameError(nextUsernameError);
      return;
    }

    const nextProfile = {
      username: nextUsername,
      avatarDataUrl: avatarDraft,
    };

    try {
      writeLocalProfile(window.localStorage, account, nextProfile);
      const persistedProfile = readLocalProfile(window.localStorage, account);
      if (
        persistedProfile.username !== nextProfile.username ||
        persistedProfile.avatarDataUrl !== nextProfile.avatarDataUrl
      ) {
        throw new Error("Profile storage did not retain the saved values");
      }
    } catch {
      setSaveError("This browser could not save the profile");
      return;
    }

    setUsernameDraft(nextUsername);
    setUsernameError("");
    setAvatarError("");
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

    setPreparingImage(true);
    setAvatarError("");
    setSaveError("");

    try {
      setAvatarDraft(await prepareAvatarImage(file));
    } catch (caught) {
      setAvatarError(
        caught instanceof Error
          ? caught.message
          : "The image could not be prepared",
      );
    } finally {
      setPreparingImage(false);
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
  const scopedClassicV3Rewards = useMemo<ClassicV3ProfileRewards>(() => {
    if (!account || !classicV3ReleaseAvailable) {
      return EMPTY_CLASSIC_V3_PROFILE;
    }
    return classicV3Rewards.account?.toLowerCase() === account.toLowerCase()
      ? classicV3Rewards
      : { status: "loading", account, rewards: [] };
  }, [account, classicV3Rewards]);
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
        submittedAt: Date.now(),
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
        message: manualCheck
          ? "Checking transaction status"
          : "Confirming on Ethereum",
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
            message: "Still pending on Ethereum. Check the status again",
            transactionHash,
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
        setProfileRefresh((current) => current + 1);
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
          message: "Status unavailable. Check the transaction again",
          transactionHash,
        });
      } finally {
        transactionPollControllersRef.current.delete(controller);
      }
    },
    [],
  );
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
          existingState.status === "pending" &&
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
        setClaimState({
          status: "error",
          message:
            caught instanceof Error
              ? caught.message
              : "The creator claim could not be submitted",
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
          : `${reward.vaultAddress.toLowerCase()}:update-payout:${allocationIndex}`;
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
          existingState.status === "pending" &&
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
        setActionState({
          status: "error",
          message:
            caught instanceof Error
              ? caught.message
              : "The reward action could not be submitted",
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
          existingState.status === "pending" &&
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
        setActionState({
          status: "error",
          message:
            caught instanceof Error
              ? caught.message
              : "The reward action could not be submitted",
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
            scopedExistingState?.status === "pending" &&
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
        }: {
          transactionHash: Hex;
          pendingStage: StockPairedPendingStage;
          manualCheck: boolean;
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
          let receiptStatus: "pending" | "confirmed" | "reverted";
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
          scopedExistingState?.status === "pending" &&
          transactionHash &&
          resumedStage
        ) {
          const status = await settleConversionStage({
            transactionHash,
            pendingStage: resumedStage,
            manualCheck: true,
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
            setProfileRefresh((current) => current + 1);
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
            setProfileRefresh((current) => current + 1);
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
          setProfileRefresh((current) => current + 1);
        }
      } finally {
        stockPairedActionLocksRef.current.delete(lockKey);
      }
    },
    [
      account,
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
  const avatarFallback = account
    ? (savedProfile.username || account.slice(2, 4)).slice(0, 2).toUpperCase()
    : "P";

  function retryProfileData() {
    if (!account) return;
    if (!onchainData && scopedOnchainData.status === "error") {
      setRemoteOnchainData(loadingProfileData(account));
    }
    if (
      classicV3ReleaseAvailable &&
      scopedClassicV3Rewards.status === "error"
    ) {
      setClassicV3Rewards({ status: "loading", account, rewards: [] });
    }
    if (deepReleaseAvailable && scopedDeepRewards.status === "error") {
      setDeepRewards({ status: "loading", account, rewards: [] });
    }
    if (deepV3ReleaseAvailable && scopedDeepV3Profile.status === "error") {
      setDeepV3Profile({ status: "loading", account, tokens: [] });
    }
    if (
      stockPairedReleaseAvailable &&
      scopedStockPairedRewards.status === "error"
    ) {
      setStockPairedRewards({ status: "loading", account, rewards: [] });
    }
    setProfileRefresh((current) => current + 1);
  }

  const sessionView = getProfileSessionView(connecting, account);

  if (sessionView === "loading") {
    return <ProfileSessionLoadingState />;
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
          <p>
            Connect to review verified fee earnings and claim rewards.
          </p>
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
          <p className={styles.address}>{shortenAddress(account)}</p>

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
              </div>
              <p
                id="profile-username-help"
                className={`${styles.formHelp} ${
                  usernameError || avatarError || saveError
                    ? styles.formError
                    : ""
                }`}
                role={
                  usernameError || avatarError || saveError
                    ? "alert"
                    : undefined
                }
              >
                {usernameError ||
                  avatarError ||
                  saveError ||
                  "3–12 letters or numbers · square JPG, PNG or WebP · saved in this browser for this wallet"}
              </p>
            </form>
          ) : null}
        </div>
      </section>

      <ProfileAccountWorkspace
        key={account.toLowerCase()}
        connected={Boolean(account)}
        data={scopedOnchainData}
        account={account}
        claimActionStates={claimActionStates}
        classicV3Rewards={scopedClassicV3Rewards}
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
        terminalErrorReady={terminalErrorReady}
      />

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

export const profileClaimPageSize = 5;

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
          href: `/token/${reward.tokenAddress}`,
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
          href: `/token/${reward.tokenAddress}`,
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
          href: `/token/${reward.tokenAddress}`,
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

function profileStockRewardConfirmed(
  reward: StockPairedReward,
  account: string | undefined,
  actionStates: ProfileActionStateCollections,
) {
  const vault = reward.vaultAddress.toLowerCase();
  return (
    confirmedForAccount(actionStates.stockPaired[`${vault}:claim`], account) ||
    confirmedForAccount(
      actionStates.stockPaired[`${vault}:claim-as-eth`],
      account,
    )
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
  void account;
  void actionStates;
  return [...entries].sort((first, second) => {
    const firstLaunchTime = Date.parse(first.token.launchedAt);
    const secondLaunchTime = Date.parse(second.token.launchedAt);
    const firstHasLaunchTime = Number.isFinite(firstLaunchTime);
    const secondHasLaunchTime = Number.isFinite(secondLaunchTime);
    if (firstHasLaunchTime && secondHasLaunchTime) {
      if (firstLaunchTime !== secondLaunchTime) {
        return firstLaunchTime < secondLaunchTime ? 1 : -1;
      }
    } else if (firstHasLaunchTime !== secondHasLaunchTime) {
      return firstHasLaunchTime ? -1 : 1;
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
    profileEntryActionableNativeWei(entry, account, actionStates) > 0n ||
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

function ProfileSessionLoadingState() {
  return (
    <div className={`${styles.page} page-width`}>
      <section
        className={styles.sessionLoading}
        aria-busy="true"
        aria-label="Restoring wallet profile"
      >
        <span className={styles.visuallyHidden} role="status">
          Restoring wallet profile
        </span>
        <div className={styles.sessionLoadingHero} aria-hidden="true">
          <span className={styles.sessionLoadingAvatar} />
          <span className={styles.sessionLoadingIdentity}>
            <span />
            <span />
          </span>
        </div>
        <div
          className={`${styles.sessionLoadingWorkspace} liquid-glass-surface`}
          aria-hidden="true"
        >
          <span />
          <span />
        </div>
      </section>
    </div>
  );
}

function ProfileLoadingState() {
  return (
    <section
      className={styles.profileLoading}
      aria-busy="true"
      aria-label="Loading profile"
    >
      <span className={styles.visuallyHidden} role="status">
        Loading profile
      </span>
      <div
        className={`${styles.profileWorkspace} liquid-glass-surface`}
        aria-hidden="true"
      >
        <div className={styles.loadingPanel}>
          <span className={styles.loadingPanelTitle} />
          <span className={styles.loadingPanelTotal} />
          <span className={styles.loadingPanelChart} />
        </div>
        <div className={styles.loadingPanel}>
          <span className={styles.loadingPanelTitle} />
          <div className={styles.loadingClaimRows}>
            {Array.from({ length: profileClaimPageSize }, (_, index) => (
              <span key={index} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ProfileAccountWorkspace({
  connected,
  data,
  account,
  claimActionStates,
  classicV3Rewards,
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
  terminalErrorReady,
}: {
  connected: boolean;
  data: ProfileOnchainData;
  account?: string;
  claimActionStates: Record<string, ProfileClaimActionState>;
  classicV3Rewards: ClassicV3ProfileRewards;
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
  terminalErrorReady: boolean;
}) {
  const currentReady = data.status === "ready";
  const classicReady = classicV3Rewards.status === "ready";
  const deepReady = deepRewards.status === "ready";
  const deepV3Ready = deepV3Profile.status === "ready";
  const stockPairedReady = stockPairedRewards.status === "ready";
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
  const claimableEntries = sortProfileClaimableEntries(
    entries.filter((entry) =>
      profileEntryHasActionableReward(entry, account, actionStates),
    ),
    account,
    actionStates,
  );
  const claimableEntryKey = claimableEntries
    .map((entry) => entry.token.address)
    .join("|");
  const [claimPagination, setClaimPagination] = useState(() => ({
    key: claimableEntryKey,
    page: 1,
  }));
  const claimPage =
    claimPagination.key === claimableEntryKey ? claimPagination.page : 1;
  const setClaimPage = (page: number) => {
    setClaimPagination({ key: claimableEntryKey, page });
  };
  const claimPageData = paginateProfileClaimableEntries(
    claimableEntries,
    claimPage,
  );

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

  const loading =
    data.status === "loading" ||
    classicV3Rewards.status === "loading" ||
    deepRewards.status === "loading" ||
    deepV3Profile.status === "loading" ||
    stockPairedRewards.status === "loading";
  const phase = getProfileWorkspacePhase(
    [
      data.status,
      classicV3Rewards.status,
      deepRewards.status,
      deepV3Profile.status,
      stockPairedRewards.status,
    ],
    terminalErrorReady,
  );

  if (phase === "loading") {
    return <ProfileLoadingState />;
  }

  if (phase === "error") {
    return (
      <section className={styles.accountState} aria-live="polite">
        <h2>Profile data unavailable</h2>
        <p>
          {data.status === "error" && data.errorMessage
              ? data.errorMessage
              : classicV3Rewards.status === "error" &&
                  classicV3Rewards.errorMessage
                ? classicV3Rewards.errorMessage
                : deepRewards.status === "error" &&
                    deepRewards.errorMessage
                  ? deepRewards.errorMessage
                  : deepV3Profile.status === "error" &&
                      deepV3Profile.errorMessage
                    ? deepV3Profile.errorMessage
                  : stockPairedRewards.status === "error" &&
                      stockPairedRewards.errorMessage
                    ? stockPairedRewards.errorMessage
                    : "Check your connection and try again."}
        </p>
        <button
          className={styles.retryButton}
          type="button"
          onClick={onRetry}
        >
          Try again
        </button>
      </section>
    );
  }

  const nativeClaimable = entries.reduce(
    (total, entry) =>
      total +
      profileEntryActionableNativeWei(entry, account, actionStates),
    0n,
  );
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
  const stockRewardCount = entries.reduce(
    (total, entry) =>
      total +
      profileRewardsForAccount(entry.stockPairedRewards, account).filter(
        (reward) =>
          BigInt(reward.claimableRaw) > 0n &&
          !profileStockRewardConfirmed(reward, account, actionStates),
      ).length,
    0,
  );
  const chainId = currentReady
    ? data.chainId
    : classicReady
      ? classicV3Rewards.chainId
      : deepReady
        ? deepRewards.chainId
        : deepV3Ready
          ? deepV3Profile.chainId
          : stockPairedReady
            ? stockPairedRewards.chainId
            : undefined;
  const sourceWarning =
    data.status === "error"
      ? "Some token rewards are temporarily unavailable. Other verified balances remain visible."
      : classicV3Rewards.status === "error"
        ? "Classic rewards are temporarily unavailable. Other verified balances remain visible."
        : deepRewards.status === "error"
          ? "Some rewards are temporarily unavailable. Other verified balances remain visible."
          : deepV3Profile.status === "error"
            ? "Some liquidity data is temporarily unavailable. Other verified balances remain visible."
          : stockPairedRewards.status === "error"
            ? "Some quote rewards are temporarily unavailable. Other verified balances remain visible."
        : "";

  return (
    <section
      className={styles.portfolio}
      aria-label="Profile overview"
      aria-busy={loading || undefined}
    >
      {sourceWarning ? (
        <div className={styles.sourceWarning} role="status">
          <span>{sourceWarning}</span>
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}

      <div
        className={`${styles.profileWorkspace} liquid-glass-surface`}
      >
        <FeeEarningsPanel
          nativeClaimable={nativeClaimable}
          nativeClaimed={nativeClaimed}
          stockRewardCount={stockRewardCount}
          activity={currentReady ? data.activity : []}
          sourcesLoading={loading}
        />

        <section
          className={styles.claimablePanel}
          aria-labelledby="profile-claimable-title"
        >
          <header className={styles.panelHeader}>
            <h2 id="profile-claimable-title">Claimable</h2>
            {loading ? (
              <span className={styles.visuallyHidden} role="status">
                Refreshing reward sources
              </span>
            ) : null}
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
                  <span aria-hidden="true">←</span>
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
                  <span aria-hidden="true">→</span>
                </button>
              </nav>
            ) : null}
          </header>

          {claimableEntries.length ? (
            <div className={styles.claimList}>
              {claimPageData.items.map((entry) => (
                <ProfileClaimRow
                  key={entry.token.address}
                  entry={entry}
                  account={account}
                  chainId={chainId}
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
              <strong>No rewards ready</strong>
              <p>Claimable rewards will appear here.</p>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function FeeEarningsPanel({
  nativeClaimable,
  nativeClaimed,
  stockRewardCount,
  activity,
  sourcesLoading,
}: {
  nativeClaimable: bigint;
  nativeClaimed: bigint;
  stockRewardCount: number;
  activity: readonly ProfileActivity[];
  sourcesLoading: boolean;
}) {
  const [chartNowMs, setChartNowMs] = useState<number | null>(null);
  const initialChartReferenceMs = useMemo(
    () =>
      timestampedFeeClaims(activity).reduce(
        (latest, claim) => Math.max(latest, claim.timestampMs),
        0,
      ),
    [activity],
  );
  const chartReferenceMs = chartNowMs ?? initialChartReferenceMs;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setChartNowMs(Date.now());
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activity]);

  const chart = useMemo(
    () =>
      buildFeeEarningsChart(activity, nativeClaimed, 0n, {
        nowMs: chartReferenceMs,
        range: "all",
      }),
    [activity, chartReferenceMs, nativeClaimed],
  );
  const [activePointIndex, setActivePointIndex] = useState(-1);
  const activePointIndexRef = useRef(-1);
  const gradientId = useId().replaceAll(":", "");
  const chartHelpId = `${gradientId}-help`;
  const resolvedActivePointIndex = chart
    ? activePointIndex >= 0 && activePointIndex < chart.points.length
      ? activePointIndex
      : chart.points.length - 1
    : -1;
  const activePoint = chart
    ? chart.points[resolvedActivePointIndex]
    : undefined;
  const verifiedTotal = nativeClaimed + nativeClaimable;
  const displayedHistoryMoment =
    chart && activePoint
      ? formatFeeChartMoment(activePoint.timestampMs, chart.nowMs)
      : "Now";
  const claimedShare =
    verifiedTotal > 0n
      ? Number((nativeClaimed * 10_000n) / verifiedTotal) / 100
      : 0;

  function resetActivePoint() {
    if (activePointIndexRef.current === -1) return;
    activePointIndexRef.current = -1;
    setActivePointIndex(-1);
  }

  function selectPointFromPointer(event: PointerEvent<HTMLDivElement>) {
    if (!chart) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const pointerX = Math.min(
      620,
      Math.max(0, ((event.clientX - bounds.left) / bounds.width) * 620),
    );
    const nearestIndex = chart.points.reduce(
      (nearest, point, index) =>
        Math.abs(point.x - pointerX) <
        Math.abs(chart.points[nearest].x - pointerX)
          ? index
          : nearest,
      0,
    );
    if (activePointIndexRef.current === nearestIndex) return;
    activePointIndexRef.current = nearestIndex;
    setActivePointIndex(nearestIndex);
  }

  function handleChartKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!chart) return;
    let nextIndex = resolvedActivePointIndex;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      nextIndex = Math.max(0, resolvedActivePointIndex - 1);
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      nextIndex = Math.min(
        chart.points.length - 1,
        resolvedActivePointIndex + 1,
      );
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = chart.points.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    activePointIndexRef.current = nextIndex;
    setActivePointIndex(nextIndex);
  }

  return (
    <section
      className={styles.feePanel}
      aria-labelledby="fee-earnings-title"
    >
      <header className={styles.feePanelHeader}>
        <div>
          <h2 id="fee-earnings-title">Verified ETH fees</h2>
          <p>
            {sourcesLoading
              ? "Refreshing reward sources"
              : "Claimed and currently claimable onchain"}
          </p>
        </div>
      </header>

      <div className={styles.feeSummary}>
        <span className={styles.feeSummaryLabel}>
          {sourcesLoading
            ? "Verified from available sources"
            : "All-time verified total"}
        </span>
        <strong>{formatWei(verifiedTotal)}</strong>
        <div
          className={styles.feeComposition}
          role="img"
          aria-label={`${formatWei(nativeClaimed)} claimed and ${formatWei(nativeClaimable)} claimable now`}
        >
          <span
            className={styles.feeCompositionClaimed}
            style={{ width: `${claimedShare}%` }}
          />
          <span
            className={styles.feeCompositionClaimable}
            style={{ width: `${100 - claimedShare}%` }}
          />
        </div>
        <div className={styles.feeBreakdown}>
          <span>
            <b>{formatWei(nativeClaimable)}</b> claimable now
          </span>
          <span>
            <b>{formatWei(nativeClaimed)}</b> claimed
          </span>
          {stockRewardCount > 0 ? (
            <span>
              <b>{stockRewardCount}</b> quote {stockRewardCount === 1 ? "reward" : "rewards"}
            </span>
          ) : null}
        </div>
      </div>

      <figure
        className={styles.feeChart}
        aria-label="Confirmed claim history"
      >
        <figcaption className={styles.chartHeading}>
          <span>Confirmed claim history</span>
          {chart && activePoint ? (
            <strong>
              {formatWei(activePoint.valueWei)} · {displayedHistoryMoment}
            </strong>
          ) : null}
        </figcaption>
        <div className={styles.chartGrid} aria-hidden="true" />
        {chart && activePoint ? (
          <>
            <p className={styles.visuallyHidden} id={chartHelpId}>
              Use the arrow keys to inspect each confirmed earnings point.
            </p>
            <div
              aria-label="Confirmed claim history"
              aria-describedby={chartHelpId}
              aria-orientation="horizontal"
              aria-valuemax={chart.points.length - 1}
              aria-valuemin={0}
              aria-valuenow={resolvedActivePointIndex}
              aria-valuetext={`${formatWei(activePoint.valueWei)} at ${formatFeeChartMoment(activePoint.timestampMs, chart.nowMs)}`}
              className={styles.feeChartInteraction}
              onBlur={resetActivePoint}
              onKeyDown={handleChartKeyDown}
              onPointerDown={(event) => event.currentTarget.focus()}
              onPointerLeave={resetActivePoint}
              onPointerMove={selectPointFromPointer}
              role="slider"
              tabIndex={0}
            >
              <svg
                aria-hidden="true"
                className={styles.feePlot}
                viewBox="0 0 620 150"
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor="var(--brand-ivory)"
                      stopOpacity="0.24"
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--brand-ivory)"
                      stopOpacity="0"
                    />
                  </linearGradient>
                </defs>
                <path
                  className={styles.feeArea}
                  d={chart.areaPath}
                  fill={`url(#${gradientId})`}
                />
                <path className={styles.feeLine} d={chart.linePath} />
                <line
                  className={styles.feeCursor}
                  x1={activePoint.x}
                  x2={activePoint.x}
                  y1="10"
                  y2="140"
                />
                <circle
                  className={styles.feeActivePoint}
                  cx={activePoint.x}
                  cy={activePoint.y}
                  r="4.5"
                />
              </svg>
            </div>
            <div className={styles.chartScale} aria-hidden="true">
              <span>
                {formatFeeChartMoment(chart.rangeStartMs, chart.nowMs)}
              </span>
              <span>Now</span>
            </div>
          </>
        ) : (
          <div className={styles.chartEmpty}>
            <strong>No confirmed claim history yet</strong>
            <p>
              Confirmed claims with exact timestamps will build this chart.
            </p>
          </div>
        )}
      </figure>
    </section>
  );
}

type FeeEarningsChartPoint = {
  x: number;
  y: number;
  timestampMs: number;
  valueWei: bigint;
};

export type FeeEarningsRange = "1h" | "1d" | "1w" | "all";

const feeEarningsRanges: ReadonlyArray<{
  description: string;
  label: string;
  value: FeeEarningsRange;
}> = [
  { description: "the last hour", label: "1H", value: "1h" },
  { description: "the last day", label: "1D", value: "1d" },
  { description: "the last week", label: "1W", value: "1w" },
  { description: "all time", label: "ALL", value: "all" },
];

const feeEarningsRangeMs: Record<Exclude<FeeEarningsRange, "all">, number> = {
  "1h": 60 * 60 * 1_000,
  "1d": 24 * 60 * 60 * 1_000,
  "1w": 7 * 24 * 60 * 60 * 1_000,
};

function formatFeeChartMoment(timestampMs: number, nowMs: number) {
  if (Math.abs(nowMs - timestampMs) < 1_000) return "Now";
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(timestampMs);
}

export function parseClaimedFeeWei(detail: string) {
  const match = detail.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s+ETH\b/iu);
  if (!match) return null;
  try {
    return parseUnits(match[1], 18);
  } catch {
    return null;
  }
}

function timestampedFeeClaims(activity: readonly ProfileActivity[]) {
  return activity.flatMap((item) => {
    if (!/fees claimed/iu.test(item.label) || !item.occurredAtIso) {
      return [];
    }
    const valueWei = parseClaimedFeeWei(item.detail);
    const timestampMs = Date.parse(item.occurredAtIso);
    if (valueWei === null || !Number.isFinite(timestampMs)) return [];
    return [{ timestampMs, valueWei }];
  });
}

export function getAvailableFeeEarningsRanges(
  activity: readonly ProfileActivity[],
  nowMs = Date.now(),
) {
  const claims = timestampedFeeClaims(activity).filter(
    (claim) => claim.timestampMs <= nowMs,
  );

  return feeEarningsRanges.flatMap((range) => {
    if (range.value === "all") return [range.value];
    const rangeStartMs = nowMs - feeEarningsRangeMs[range.value];
    return claims.some((claim) => claim.timestampMs >= rangeStartMs)
      ? [range.value]
      : [];
  });
}

export function buildFeeEarningsChart(
  activity: readonly ProfileActivity[],
  nativeClaimed: bigint,
  _nativeClaimable: bigint,
  options: Readonly<{
    nowMs?: number;
    range?: FeeEarningsRange;
  }> = {},
) {
  const nowMs = options.nowMs ?? Date.now();
  const range = options.range ?? "all";
  const claims = timestampedFeeClaims(activity)
    .filter((claim) => claim.timestampMs <= nowMs)
    .sort((first, second) => first.timestampMs - second.timestampMs);
  if (claims.length === 0) return null;
  const historyTotal = claims.reduce(
    (total, claim) => total + claim.valueWei,
    0n,
  );
  const rangeStartMs =
    range === "all"
      ? (claims[0]?.timestampMs ?? nowMs - 24 * 60 * 60 * 1_000)
      : nowMs - feeEarningsRangeMs[range];
  const visibleClaims =
    range === "all"
      ? claims
      : claims.filter(
          (claim) =>
            claim.timestampMs >= rangeStartMs &&
            claim.timestampMs <= nowMs,
        );
  const startingTotal =
    range === "all" && nativeClaimed > historyTotal
      ? nativeClaimed - historyTotal
      : 0n;
  const values = [{ timestampMs: rangeStartMs, valueWei: startingTotal }];
  let cumulative = startingTotal;
  for (const claim of visibleClaims) {
    cumulative += claim.valueWei;
    values.push({ timestampMs: claim.timestampMs, valueWei: cumulative });
  }

  const totalWei = cumulative;
  values.push({ timestampMs: nowMs, valueWei: totalWei });
  if (totalWei <= 0n || values.length < 2) return null;

  const width = 620;
  const height = 150;
  const left = 8;
  const right = width - 8;
  const top = 12;
  const bottom = height - 10;
  const maximum = values.reduce(
    (current, value) => (value.valueWei > current ? value.valueWei : current),
    1n,
  );
  const timeSpanMs = Math.max(1, nowMs - rangeStartMs);
  const points: FeeEarningsChartPoint[] = values.map(
    ({ timestampMs, valueWei }) => ({
      timestampMs,
      valueWei,
      x:
        left +
        ((Math.min(nowMs, Math.max(rangeStartMs, timestampMs)) - rangeStartMs) /
          timeSpanMs) *
          (right - left),
      y:
        bottom -
        Number((valueWei * 1_000_000n) / maximum) /
          1_000_000 *
          (bottom - top),
    }),
  );
  const linePath = points
    .map((point, index) =>
      index === 0
        ? `M${point.x.toFixed(2)},${point.y.toFixed(2)}`
        : `H${point.x.toFixed(2)} V${point.y.toFixed(2)}`,
    )
    .join(" ");

  return {
    areaPath: `${linePath} L${right},${height} L${left},${height} Z`,
    linePath,
    nowMs,
    points,
    rangeStartMs,
    totalWei,
  };
}

function transactionHref(chainId: number | undefined, hash: Hex) {
  return `${
    chainId === 11_155_111
      ? "https://sepolia.etherscan.io"
      : "https://etherscan.io"
  }/tx/${hash}`;
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
  return state?.status === "pending" && Boolean(state.transactionHash);
}

export function actionLabel(
  state: ProfileClaimActionState | ClassicV3ActionState | undefined,
) {
  if (state?.status === "preparing") return "Preparing";
  if (state?.status === "wallet") return "Confirm in wallet";
  if (state?.status === "confirming") return "Confirming";
  if (actionCanCheckStatus(state)) return "Check status";
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
  fallback: string,
) {
  const stateLabel = actionLabel(state);
  return stateLabel === "Claim" ? fallback : stateLabel;
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
            <h3 id={titleId}>Claim Rewards</h3>
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
            <span aria-hidden="true">×</span>
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
                      aria-label={`${action.label} from ${group.source} for ${tokenName} (${tokenSymbol})`}
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
  chainId,
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
  chainId?: number;
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
  const hasClaimableReward =
    totalClaimable > 0n || stockPairedClaimable > 0n;
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
          label: claimDialogActionLabel(
            activeClaimState,
            "Receive in Ethereum",
          ),
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
          label: claimDialogActionLabel(state, "Receive in Ethereum"),
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
          label: claimDialogActionLabel(state, "Receive in Ethereum"),
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
        label: claimDialogActionLabel(
          stockClaimState,
          "Receive in Stocks",
        ),
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
        label: claimDialogActionLabel(ethState, "Receive in Ethereum"),
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
          </span>
        </Link>

        <div className={styles.claimAmount}>
          <span>{hasClaimableReward ? "Ready" : "Status"}</span>
          <strong>
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
          className={styles.claimButton}
          type="button"
          aria-haspopup="dialog"
          aria-controls={dialogId}
          aria-expanded={claimDialogOpen}
          aria-busy={rowActionPending || undefined}
          aria-label={`Claim rewards for ${token.name} (${token.symbol})`}
          disabled={rowActionPending || claimGroups.length === 0}
          onClick={() => setClaimDialogOpen(true)}
        >
          Claim Rewards
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

      <ProfileActionState
        state={activeClaimState}
        chainId={chainId}
      />
      {classicClaims.map(({ reward, state }) => (
        <ProfileActionState
          key={`${reward.vaultAddress}:state`}
          state={state}
          chainId={chainId}
        />
      ))}
      {deepClaims.map(({ reward, state }) => (
        <ProfileActionState
          key={`${reward.vaultAddress}:deep-state`}
          state={state}
          chainId={chainId}
        />
      ))}
      {stockPairedClaims.map(({ reward, claimState, ethState }) => {
        const visibleState =
          [claimState, ethState].find((state) => actionPending(state)) ??
          [claimState, ethState].find(
            (state) => state?.status === "confirmed",
          ) ??
          claimState ??
          ethState;
        return (
          <ProfileActionState
            key={`${reward.vaultAddress}:stock-paired-state`}
            state={visibleState}
            chainId={chainId}
          />
        );
      })}
    </article>
  );
}

function ProfileActionState({
  state,
  chainId,
}: {
  state?: ProfileClaimActionState | ClassicV3ActionState;
  chainId?: number;
}) {
  if (!state) return null;
  return (
    <p
      className={
        state.status === "error" ? styles.rowError : styles.actionState
      }
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.message}
      {state.transactionHash ? (
        <a
          href={transactionHref(chainId, state.transactionHash)}
          target="_blank"
          rel="noreferrer"
        >
          View transaction
        </a>
      ) : null}
    </p>
  );
}
