"use client";

import type { LaunchPlanTradeWalletInputV1, LaunchPlanTradeWalletReviewV1 } from "@/lib/custom-launch/routed-trade-wallet-v1";
import type { LaunchClaimWalletInputV1, LaunchClaimWalletReviewV1 } from "@/lib/custom-launch/claim-handoff-v1";
import type { UniversalLaunchWalletInputV1, UniversalLaunchWalletReviewV1 } from "@/lib/custom-launch/wallet-handoff-plan-v1";
import Image from "next/image";
import Link from "next/link";
import { AdminDashboardLink } from "@/components/admin-dashboard-link";
import { usePathname } from "next/navigation";
import type { PrivyClientConfig } from "@privy-io/react-auth";
import {
  Check,
  ChevronDown,
  Copy,
  LogOut,
  Wallet,
  X,
} from "lucide-react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { mainnet, sepolia } from "viem/chains";
import { bytesToHex, hexToBytes, type Address, type Hex } from "viem";

import {
  applicantRefreshUserIsRateLimitedV1,
  createApplicantRefreshUserGateV1,
  isApplicantRefreshUserUnavailableErrorV1,
  type ApplicantRefreshUserGateV1,
} from "@/lib/custom-launch/applicant-refresh-user-gate-v1";
import {
  requestGitHubLaunchAppAuthorizationV1,
} from "@/lib/custom-launch/github-app-authorization-v1";
import {
  assertCustomLaunchWalletActionV1,
  type CustomLaunchWalletActionV1,
} from "@/lib/custom-launch/wallet-handoff-v1";
import {
  assertCustomLaunchFundingAuthorizationV3,
  customLaunchFundingReviewFingerprintV3,
  serializeCustomLaunchFundingTypedDataV3,
  verifyCustomLaunchFundingSignatureV3,
  type CustomLaunchFundingAuthorizationV3,
} from "@/lib/custom-launch/wallet-handoff-v3";
import {
  deriveCustomLaunchWalletExpectedV4,
  prepareCustomLaunchWalletReviewV4,
  revalidateCustomLaunchWalletRequestV4,
} from "@/lib/custom-launch/wallet-handoff-v4";
import {
  estimateRobinhoodLaunchCostV1,
  parseRobinhoodFundingReviewV1,
  robinhoodCostMatchesReviewV1,
  robinhoodCostRequiresReviewV1,
  type RobinhoodLaunchCostV1,
} from "@/lib/custom-launch/robinhood-funding-review-v1";
import { parseLocalProfile } from "@/lib/profile/local-profile";
import { robinhoodChain } from "@/lib/chains";
import {
  assertMainTokenMigrationTransaction,
  type MainTokenMigrationPermitSignature,
} from "@/lib/main-token-migration";
import { signMainTokenMigrationPermitWithWallet } from "@/lib/main-token-migration-wallet";
import { MigrationPermitWalletError } from "@/lib/main-token-migration-wallet-error";
import {
  buildPredictionPermitTypedData,
  buildUsdgPermitTypedData,
  parsePredictionPermitSignature,
  serializePredictionPermitTypedData,
  serializeUsdgPermitTypedData,
  type PredictionPermitSignature,
} from "@/lib/prediction-market";
import {
  submitPredictionV2Eip1193TransactionV2,
  submitPredictionV2PrivyTransactionV2,
  type ParsedPredictionV2PreparedTransactionV2,
  type PredictionV2Eip1193ProviderV2,
} from "@/lib/prediction-v2/client-api-v2";
import {
  getPredictionV2PreparedTransactionReviewV2,
} from "@/lib/prediction-v2/prepared-transaction-v2";
import type { PreparedModuleModeTransaction } from "@/components/module-mode-wallet-state";
import {
  buildEip1193TransactionRequest,
  buildPrivyTransactionRequest,
  getPreparedTransactionReview,
  parseSubmittedTransactionHash,
  parsePreparedTransactionForAccount,
  type PreparedTransaction,
} from "../lib/prepared-transaction";
import {
  acquireBrowserWalletLoginLease,
  createWalletLoginAttemptGate,
  WALLET_LOGIN_OTHER_TAB_MESSAGE,
  WalletLoginPendingError,
  type BrowserWalletLoginLease,
} from "../lib/wallet-login-lock";
import { errorIsExplicitWalletRejection, runWithBrowserWalletRequestLock, WalletRequestNotSubmittedError } from "../lib/wallet-request-lock";
import type {
  PrivyPolicyOwnerOperation,
  PrivyPolicyOwnerReview,
  PrivyPolicyOwnerSession,
} from "@/lib/privy-policy-owner/handoff";
import {
  loginConnectedEthereumWalletWithSiwe,
  selectInjectedEthereumProvider,
} from "../lib/wallet-siwe-login";
import styles from "./wallet-dialog.module.css";

type WalletState = {
  account: `0x${string}`;
  chainId: string;
};

type ColorTheme = "light" | "dark";
const themeChangeEvent = "programmable:theme-changed";

export type WalletTradeBalances = {
  nativeBalanceWei: bigint;
  tokenBalanceRaw: bigint;
  gasPriceWei: bigint;
};

export type WalletNativeBalance = {
  nativeBalanceWei: bigint;
  gasPriceWei: bigint;
};

export type WalletApplicantIdentityRequirementV1 = Readonly<{
  githubUserId: string;
  githubLogin: string;
  launchWallet: `0x${string}`;
}>;

export type WalletApplicantSessionV1 = Readonly<{
  accessToken: string;
  identityToken: string;
  privyUserId: string;
  githubUserId: string;
  githubLogin: string;
  launchWallet: `0x${string}`;
}>;

export type CustomLaunchWalletActionResultV4 = `0x${string}` | RobinhoodLaunchCostV1;

export type CustomLaunchWalletActionInputV4 = Readonly<{
  action: "estimate" | "send";
  reviewedCost?: RobinhoodLaunchCostV1;
  reviewedResource: unknown;
  loadFreshCapabilities: () => Promise<unknown>;
  loadFreshResource: () => Promise<unknown>;
}>;

type WalletContextValue = {
  wallet: WalletState | null;
  walletLinked: boolean;
  username: string;
  avatarDataUrl: string;
  authReady: boolean;
  sessionReady: boolean;
  authenticated: boolean;
  hasSession: boolean;
  connecting: boolean;
  openingWallet: boolean;
  disconnecting: boolean;
  switchingNetwork: boolean;
  preloadWallet: () => void;
  openWallet: () => void;
  openWalletWithError: (message: string) => void;
  switchNetwork: (expectedChainId?: string) => Promise<boolean>;
  disconnect: (options?: {
    showDialogOnFailure?: boolean;
  }) => Promise<boolean>;
  getAccessToken: () => Promise<string | null>;
  getIdentityToken: () => Promise<string | null>;
  refreshApplicantSession: (
    requirement?: WalletApplicantIdentityRequirementV1,
  ) => Promise<WalletApplicantSessionV1 | null>;
  githubConnected: boolean;
  githubUserId: string;
  githubUsername: string;
  connectGithub: () => void;
  authorizeGithubLaunchApp: () => Promise<void>;
  reauthorizeGithub: () => Promise<void>;
  setUsername: (username: string) => void;
  signLaunchMessage: (signingMessageBase64Url: string) => Promise<string>;
  reviewPrivyPolicyOwnerRequest: (input: Readonly<{
    text: string;
    operation: PrivyPolicyOwnerOperation;
  }>) => Promise<PrivyPolicyOwnerReview>;
  signPrivyPolicyOwnerRequest: (input: Readonly<{
    text: string;
    operation: PrivyPolicyOwnerOperation;
    reviewedRequestArtifactSha256: string;
  }>) => Promise<string>;
  signPredictionPermit: (input: Readonly<{
    deadline: bigint;
    factoryAddress: Address;
    nonce: bigint;
  }>) => Promise<PredictionPermitSignature>;
  signPredictionTokenPermit: (input: Readonly<{
    deadline: bigint;
    nonce: bigint;
    spender: Address;
    tokenAddress: Address;
    tokenName: string;
    value: bigint;
  }>) => Promise<PredictionPermitSignature>;
  signMainTokenMigrationPermit: (input: Readonly<{
    deadline: bigint;
    nonce: bigint;
    spender: Address;
    value: bigint;
  }>) => Promise<MainTokenMigrationPermitSignature>;
  sendBrowserWalletAction: (input: Readonly<{
    chainId: string;
    from: `0x${string}`;
    to: `0x${string}`;
    data: `0x${string}`;
    value: `0x${string}`;
  }>) => Promise<Hex>;
  sendCustomLaunchWalletAction: (
    input: CustomLaunchWalletActionV1,
  ) => Promise<Hex>;
  sendLaunchPlanTradeWalletAction: (input: LaunchPlanTradeWalletInputV1) => Promise<LaunchPlanTradeWalletReviewV1 | Hex>;
  sendLaunchClaimWalletAction: (input: LaunchClaimWalletInputV1) => Promise<LaunchClaimWalletReviewV1 | Hex>;
  sendUniversalLaunchWalletAction: (input: UniversalLaunchWalletInputV1) => Promise<UniversalLaunchWalletReviewV1 | Hex>;
  sendCustomLaunchWalletActionV4: (
    input: CustomLaunchWalletActionInputV4,
  ) => Promise<CustomLaunchWalletActionResultV4>;
  signCustomLaunchFundingAuthorization: (
    input: CustomLaunchFundingAuthorizationV3,
  ) => Promise<Hex>;
  sendTransaction: (transaction: PreparedTransaction) => Promise<Hex>;
  sendPredictionV2Transaction: (
    transaction: ParsedPredictionV2PreparedTransactionV2,
  ) => Promise<Hex>;
  sendModuleModeTransaction: (transaction: PreparedModuleModeTransaction) => Promise<Hex>;
  readNativeBalance: () => Promise<WalletNativeBalance>;
  readConnectedAccountCode: () => Promise<Hex>;
  readTradeBalances: (token: `0x${string}`) => Promise<WalletTradeBalances>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

type WalletProviderRuntime = typeof import("./wallet-provider-runtime");

let walletProviderRuntimePromise: Promise<WalletProviderRuntime> | null = null;

function loadWalletProviderRuntime() {
  walletProviderRuntimePromise ??= import("./wallet-provider-runtime").catch(
    (error: unknown) => {
      walletProviderRuntimePromise = null;
      throw error;
    },
  );
  return walletProviderRuntimePromise;
}

export function shouldEagerLoadWalletRuntime(pathname: string) {
  return [
    "/launch",
    "/late-migration",
    "/migration",
    "/profile",
    "/token",
    "/developers/api-keys",
    "/admin/partners",
    "/admin/modules",
    "/ops/privy-policy-owner",
  ].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function shouldBackgroundLoadWalletRuntime(
  pathname: string,
  hasPersistedSessionHint: boolean,
) {
  return hasPersistedSessionHint && !shouldEagerLoadWalletRuntime(pathname);
}

if (
  typeof window !== "undefined"
  && shouldEagerLoadWalletRuntime(window.location.pathname)
) {
  void loadWalletProviderRuntime().catch(() => undefined);
}

const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
const walletSessionHintStorageKey = "programmable:wallet-session:v1";
const profileStoragePrefix = "programmable-profile";
const profileUpdatedEvent = "programmable:profile-updated";
const usernamePattern = /^[A-Za-z0-9]{3,12}$/;
const githubUserIdPattern = /^[1-9][0-9]{0,39}$/;
const appChain =
  process.env.NEXT_PUBLIC_PROGRAMMABLE_ONCHAIN_NETWORK === "rehearsal"
    ? sepolia
    : mainnet;
const appChainHex = `0x${appChain.id.toString(16)}`;
const appNetworkName = appChain.id === sepolia.id ? "Sepolia" : "Ethereum";
const robinhoodChainHex = `0x${robinhoodChain.id.toString(16)}`;

export function isPersistedWalletSessionHint(value: string | null) {
  return value === "authenticated";
}

function readPersistedWalletSessionHint() {
  try {
    return isPersistedWalletSessionHint(
      window.localStorage.getItem(walletSessionHintStorageKey),
    );
  } catch {
    return false;
  }
}

function persistWalletSessionHint(authenticated: boolean) {
  try {
    if (authenticated) {
      window.localStorage.setItem(
        walletSessionHintStorageKey,
        "authenticated",
      );
    } else {
      window.localStorage.removeItem(walletSessionHintStorageKey);
    }
  } catch {
    // The hint is an optimization only. Privy remains authoritative.
  }
}

function scheduleWalletRuntimeIdlePreload(preload: () => void) {
  if (typeof window.requestIdleCallback === "function") {
    const idleId = window.requestIdleCallback(preload, { timeout: 2_000 });
    return () => window.cancelIdleCallback(idleId);
  }

  const timeoutId = window.setTimeout(preload, 1_200);
  return () => window.clearTimeout(timeoutId);
}

function getWalletNetwork(expectedChainId?: string) {
  if (!expectedChainId || expectedChainId === String(appChain.id)) {
    return {
      chain: appChain,
      chainHex: appChainHex,
      name: appNetworkName,
    };
  }
  if (expectedChainId === String(robinhoodChain.id)) {
    return {
      chain: robinhoodChain,
      chainHex: robinhoodChainHex,
      name: robinhoodChain.name,
    };
  }
  return null;
}

function getWalletNetworkLabel(chainId: string) {
  if (chainId === appChainHex) return appNetworkName;
  if (chainId === robinhoodChainHex) return "Robinhood";
  const chainNumber = Number(chainId);
  return Number.isSafeInteger(chainNumber) && chainNumber > 0
    ? `Network ${chainNumber}`
    : "Unknown network";
}

export function getWalletSessionAction(ready: boolean, authenticated: boolean) {
  if (!ready) return "wait" as const;
  if (authenticated) return "manage" as const;
  return "login" as const;
}

export function getWalletOpenAction(
  sessionAction: ReturnType<typeof getWalletSessionAction>,
  hasWallet: boolean,
  hasLinkedWallet = false,
) {
  if (sessionAction !== "manage") return sessionAction;
  if (hasWallet) return "manage" as const;
  return hasLinkedWallet ? "reconnect" as const : "link" as const;
}

export function isWalletProviderSettled(
  privyReady: boolean,
  walletsReady: boolean,
  authenticated: boolean,
) {
  return privyReady && (!authenticated || walletsReady);
}

export async function resolveWalletIdentityToken(input: Readonly<{
  authenticated: boolean;
  cachedIdentityToken: string | null;
  loadIdentityToken: () => Promise<string | null>;
}>): Promise<string | null> {
  if (!input.authenticated) return null;
  if (input.cachedIdentityToken !== null) return input.cachedIdentityToken;

  try {
    return await input.loadIdentityToken();
  } catch {
    return null;
  }
}

type RefreshableApplicantUserV1 = Readonly<{
  id: string;
  github?: Readonly<{
    subject: string;
    username: string | null;
  }>;
  linkedAccounts: readonly Readonly<{
    type: string;
    subject?: string;
    username?: string | null;
    address?: string;
    chainType?: string;
  }>[];
}>;

type ApplicantAuthoritySnapshotV1 = Readonly<{
  privyUserId: string | null;
  githubUserId: string | null;
  githubLogin: string | null;
  walletAddress: string | null;
  linkedAccountsFingerprint: string | null;
}>;

function applicantLinkedAccountsFingerprintV1(
  linkedAccounts: unknown,
): string | null {
  if (!Array.isArray(linkedAccounts)) return null;

  const records = linkedAccounts.map((account) => {
    if (account === null || typeof account !== "object") {
      return ["invalid", null, null, null, null] as const;
    }
    const record = account as Readonly<Record<string, unknown>>;
    const normalized = (field: string, lowerCase = false): string | null => {
      const value = record[field];
      if (typeof value !== "string") return null;
      return lowerCase ? value.toLowerCase() : value;
    };
    return [
      normalized("type"),
      normalized("subject"),
      normalized("username", true),
      normalized("address", true),
      normalized("chainType", true),
    ] as const;
  });
  records.sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return JSON.stringify(records);
}

function applicantAuthorityCacheKeyV1(
  authority: ApplicantAuthoritySnapshotV1,
): string {
  return JSON.stringify([
    authority.privyUserId,
    authority.githubUserId,
    authority.githubLogin?.toLowerCase() ?? null,
    authority.walletAddress?.toLowerCase() ?? null,
    authority.linkedAccountsFingerprint,
  ]);
}

export async function refreshWalletApplicantSessionV1(input: Readonly<{
  authenticated: boolean;
  readCurrentAuthority: () => ApplicantAuthoritySnapshotV1;
  refreshUser: () => Promise<RefreshableApplicantUserV1 | null | undefined>;
  getAccessToken: () => Promise<string | null>;
  getIdentityToken: () => Promise<string | null>;
  requirement?: WalletApplicantIdentityRequirementV1;
}>): Promise<WalletApplicantSessionV1 | null> {
  if (!input.authenticated) return null;
  if (
    input.requirement !== undefined
    && !githubUserIdPattern.test(input.requirement.githubUserId)
  ) return null;
  const initial = input.readCurrentAuthority();
  if (
    typeof initial.privyUserId !== "string"
    || initial.privyUserId.length === 0
    || typeof initial.githubUserId !== "string"
    || !githubUserIdPattern.test(initial.githubUserId)
    || typeof initial.githubLogin !== "string"
    || initial.githubLogin.length === 0
    || typeof initial.walletAddress !== "string"
    || !isEthereumAddress(initial.walletAddress)
  ) return null;

  try {
    const refreshedUser = await input.refreshUser();
    if (
      refreshedUser === null
      || typeof refreshedUser !== "object"
      || refreshedUser.id !== initial.privyUserId
      || !Array.isArray(refreshedUser.linkedAccounts)
    ) return null;
    if (!authoritySnapshotMatches(initial, input.readCurrentAuthority())) {
      return null;
    }

    const github = refreshedUser.github;
    const githubAccounts = refreshedUser.linkedAccounts.filter(
      (account) => account.type === "github_oauth",
    );
    if (
      !github
      || typeof github.subject !== "string"
      || !githubUserIdPattern.test(github.subject)
      || typeof github.username !== "string"
      || github.username.length === 0
      || github.subject !== initial.githubUserId
      || github.username.toLowerCase() !== initial.githubLogin.toLowerCase()
      || githubAccounts.length !== 1
      || !githubAccounts.some((account) =>
        account.subject === github.subject
        && account.username?.toLowerCase() === github.username!.toLowerCase()
      )
    ) return null;

    const launchWallet = initial.walletAddress.toLowerCase() as `0x${string}`;
    if (refreshedUser.linkedAccounts.filter((account) =>
      account.type === "wallet"
      && account.chainType === "ethereum"
      && typeof account.address === "string"
      && account.address.toLowerCase() === launchWallet
    ).length !== 1) return null;
    if (
      input.requirement
      && (
        github.subject !== input.requirement.githubUserId
        || github.username.toLowerCase()
          !== input.requirement.githubLogin.toLowerCase()
        || launchWallet !== input.requirement.launchWallet.toLowerCase()
      )
    ) return null;

    const accessToken = await input.getAccessToken();
    const identityToken = await input.getIdentityToken();
    if (
      typeof accessToken !== "string"
      || accessToken.length === 0
      || typeof identityToken !== "string"
      || identityToken.length === 0
      || !authoritySnapshotMatches(initial, input.readCurrentAuthority())
    ) return null;
    return Object.freeze({
      accessToken,
      identityToken,
      privyUserId: refreshedUser.id,
      githubUserId: github.subject,
      githubLogin: github.username,
      launchWallet,
    });
  } catch (error) {
    if (isApplicantRefreshUserUnavailableErrorV1(error)) throw error;
    return null;
  }
}

function authoritySnapshotMatches(
  expected: ApplicantAuthoritySnapshotV1,
  current: ApplicantAuthoritySnapshotV1,
): boolean {
  return current.privyUserId === expected.privyUserId
    && current.githubUserId === expected.githubUserId
    && current.githubLogin?.toLowerCase() === expected.githubLogin?.toLowerCase()
    && current.walletAddress?.toLowerCase()
      === expected.walletAddress?.toLowerCase()
    && current.linkedAccountsFingerprint === expected.linkedAccountsFingerprint;
}

export function getWalletProfileStorageKey(account: string) {
  return `${profileStoragePrefix}:${account.toLowerCase()}`;
}

export function readUsernameFromProfileValue(value: string | null) {
  if (!value) return "";

  try {
    const profile = JSON.parse(value) as unknown;
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      return "";
    }

    const username = (profile as { username?: unknown }).username;
    return typeof username === "string" && usernamePattern.test(username)
      ? username
      : "";
  } catch {
    return "";
  }
}

export function getWalletLoginErrorMessage(errorCode: string) {
  if (errorCode === "exited_auth_flow" || errorCode === "exited_link_flow") {
    return "";
  }
  if (errorCode === "linked_to_another_user") {
    return "This wallet belongs to another account. Sign out, then sign in with that wallet.";
  }

  return "Unable to connect wallet. Try again.";
}

export function getWalletTransactionErrorMessage(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : "";

  if (code === 4001 || /user rejected|user denied/i.test(message)) {
    return "Transaction cancelled in wallet";
  }
  if (
    code === 4900 ||
    code === 4901 ||
    /disconnected|lost connection|background|postmessage failed/i.test(message)
  ) {
    return "Wallet connection was interrupted. Reload the page and try again";
  }

  return message || "The wallet could not open the transaction";
}

export function getWalletDisconnectOutcome(succeeded: boolean) {
  return succeeded
    ? {
        dialogOpen: false,
        error: "",
        sessionSuppressed: true,
      }
    : {
        dialogOpen: true,
        error: "Unable to disconnect wallet. Try again.",
        sessionSuppressed: false,
      };
}

export async function executeWalletDisconnect(input: {
  authenticated: boolean;
  logout: () => Promise<unknown>;
  disconnectProviderWallets: () => Promise<boolean>;
  markAppDisconnected: () => void;
}) {
  if (input.authenticated) {
    try {
      await input.logout();
    } catch {
      return false;
    }

    try {
      await input.disconnectProviderWallets();
    } catch {
      // Privy logout is the authoritative session boundary. Provider cleanup is
      // best effort, but it must settle before a new login can begin.
    }
    input.markAppDisconnected();
    return true;
  }

  try {
    const providersDisconnected = await input.disconnectProviderWallets();
    if (!providersDisconnected) return false;
    input.markAppDisconnected();
    return true;
  } catch {
    return false;
  }
}

function readProfileValue(account?: string) {
  if (!account || typeof window === "undefined") return "";

  try {
    return (
      window.localStorage.getItem(getWalletProfileStorageKey(account)) ?? ""
    );
  } catch {
    return "";
  }
}

function subscribeToProfiles(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith(`${profileStoragePrefix}:`)) listener();
  };
  const onProfileUpdated = () => listener();

  window.addEventListener("storage", onStorage);
  window.addEventListener(profileUpdatedEvent, onProfileUpdated);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(profileUpdatedEvent, onProfileUpdated);
  };
}

function readStoredProfile(account: string) {
  try {
    const value = window.localStorage.getItem(
      getWalletProfileStorageKey(account),
    );
    if (!value) return {};

    const profile = JSON.parse(value) as unknown;
    return profile && typeof profile === "object" && !Array.isArray(profile)
      ? (profile as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function emitProfileChange(account: string) {
  window.dispatchEvent(
    new CustomEvent(profileUpdatedEvent, {
      detail: { account: account.toLowerCase() },
    }),
  );
}

function getEmptyProfileValue() {
  return "";
}

const privyConfig = {
  loginMethods: ["wallet", "email", "github"],
  appearance: {
    theme: "light",
    accentColor: "#465a6f",
    logo: "/brand/loop/programmable-loop-mark-warm-ivory-v1-1536.png",
    landingHeader: "Connect to Programmable",
    loginMessage: "Use a wallet or email to continue",
    showWalletLoginFirst: true,
    walletChainType: "ethereum-only",
    walletList: [
      "metamask",
      "phantom",
      "coinbase_wallet",
      "rainbow",
      "uniswap",
      "detected_ethereum_wallets",
      "wallet_connect",
    ],
  },
  embeddedWallets: {
    ethereum: {
      createOnLogin: "users-without-wallets",
    },
  },
  supportedChains: [appChain, robinhoodChain],
  defaultChain: appChain,
} satisfies PrivyClientConfig;

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function normalizeChainId(chainId: string) {
  if (chainId.startsWith("eip155:")) {
    const decimalId = Number(chainId.slice("eip155:".length));
    return Number.isSafeInteger(decimalId)
      ? `0x${decimalId.toString(16)}`
      : chainId;
  }

  return chainId.toLowerCase();
}

function isEthereumAddress(address: string): address is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export async function assertExternalWalletAuthorityCurrent(input: Readonly<{
  expectedAccount: `0x${string}`;
  expectedChainId: string;
  networkName: string;
  request: (method: "eth_chainId" | "eth_accounts") => Promise<unknown>;
}>): Promise<void> {
  const providerChainId = await input.request("eth_chainId");
  if (
    typeof providerChainId !== "string"
    || normalizeChainId(providerChainId) !== normalizeChainId(input.expectedChainId)
  ) {
    throw new Error(`The wallet is not connected to ${input.networkName}`);
  }

  const providerAccounts = await input.request("eth_accounts");
  const activeAccount = Array.isArray(providerAccounts)
    ? providerAccounts[0]
    : undefined;
  if (
    typeof activeAccount !== "string"
    || !isEthereumAddress(activeAccount)
    || activeAccount.toLowerCase() !== input.expectedAccount.toLowerCase()
  ) {
    throw new Error("The active wallet account changed. Review the launch and try again");
  }
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("The launch authorization message is invalid");
  }
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = window.atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function parseRpcQuantity(value: unknown, label: string) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`The wallet returned an invalid ${label}`);
  }

  return BigInt(value);
}

type WalletCandidate = {
  address: string;
  connectedAt: number;
  linked: boolean;
  walletClientType: string;
};

export function selectConnectedWallet<T extends WalletCandidate>(
  wallets: readonly T[],
  primaryAddress?: string,
) {
  const validWallets = [...wallets]
    .filter((candidate) => isEthereumAddress(candidate.address))
    .sort((left, right) => right.connectedAt - left.connectedAt);
  const externalWallets = validWallets.filter(
    (candidate) =>
      candidate.walletClientType !== "privy" &&
      candidate.walletClientType !== "privy-v2",
  );
  const normalizedPrimaryAddress = primaryAddress?.toLowerCase();

  return (
    externalWallets.find((candidate) => candidate.linked) ??
    externalWallets[0] ??
    validWallets.find(
      (candidate) =>
        normalizedPrimaryAddress &&
        candidate.address.toLowerCase() === normalizedPrimaryAddress,
    ) ??
    validWallets.find((candidate) => candidate.linked) ??
    validWallets[0]
  );
}

export function selectAuthenticatedWallet<T extends WalletCandidate>(
  authenticated: boolean,
  wallets: readonly T[],
  primaryAddress?: string,
  ownedAddresses?: ReadonlySet<string>,
) {
  if (!authenticated) return undefined;
  if (!ownedAddresses) return selectLinkedWallet(wallets, primaryAddress);

  // Privy 3.35.2 derives candidate.linked using case-sensitive address equality.
  // The authenticated user's linkedAccounts is the ownership authority; a
  // connected capability with the same normalized address remains usable.
  const ownedWallets = wallets.filter((candidate) =>
    isEthereumAddress(candidate.address)
    && ownedAddresses.has(candidate.address.toLowerCase()))
    .sort((left, right) => left.address.toLowerCase().localeCompare(right.address.toLowerCase()));
  return ownedWallets.find((candidate) => candidate.address.toLowerCase() === primaryAddress?.toLowerCase())
    ?? ownedWallets[0];
}

export function selectLinkedWallet<T extends WalletCandidate>(
  wallets: readonly T[],
  primaryAddress?: string,
) {
  const linkedWallets = [...wallets]
    .filter((candidate) => candidate.linked && isEthereumAddress(candidate.address))
    .sort((left, right) => left.address.toLowerCase().localeCompare(right.address.toLowerCase()));
  const normalizedPrimaryAddress = primaryAddress?.toLowerCase();

  return linkedWallets.find((candidate) =>
    normalizedPrimaryAddress !== undefined
    && candidate.address.toLowerCase() === normalizedPrimaryAddress)
    ?? linkedWallets[0];
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const eager = shouldEagerLoadWalletRuntime(pathname);
  const [activationRequested, setActivationRequested] = useState(false);
  const [pendingAction, setPendingAction] = useState<"wallet" | "github" | null>(
    null,
  );
  const [runtime, setRuntime] = useState<WalletProviderRuntime | null>(null);
  const [configuredValue, setConfiguredValue] = useState<WalletContextValue | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const active = eager || activationRequested;
  const activateWalletRuntime = useCallback(
    (action: "wallet" | "github") => {
      setPendingAction(action);
      setActivationRequested(true);
      if (loadFailed) {
        setLoadFailed(false);
        setLoadAttempt((current) => current + 1);
      }
    },
    [loadFailed],
  );
  const preloadWalletRuntime = useCallback(() => {
    if (runtime) return;
    void loadWalletProviderRuntime().then(
      (loadedRuntime) => setRuntime(loadedRuntime),
      () => setLoadFailed(true),
    );
  }, [runtime]);
  const consumePendingAction = useCallback(() => {
    setPendingAction(null);
  }, []);
  const acceptConfiguredValue = useCallback(
    (value: WalletContextValue) => {
      setConfiguredValue(value);
    },
    [],
  );

  useEffect(() => {
    if (!privyAppId || !active || runtime) return;

    let cancelled = false;
    void loadWalletProviderRuntime().then(
      (loadedRuntime) => {
        if (!cancelled) setRuntime(loadedRuntime);
      },
      () => {
        if (!cancelled) setLoadFailed(true);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [active, loadAttempt, runtime]);

  useEffect(() => {
    if (
      !privyAppId ||
      runtime ||
      !shouldBackgroundLoadWalletRuntime(
        pathname,
        readPersistedWalletSessionHint(),
      )
    ) return;
    let cancelled = false;
    const preload = () => {
      if (cancelled) return;
      void loadWalletProviderRuntime().then(
        (loadedRuntime) => {
          if (!cancelled) setRuntime(loadedRuntime);
        },
        () => {
          if (!cancelled) setLoadFailed(true);
        },
      );
    };
    const cancelPreload = scheduleWalletRuntimeIdlePreload(preload);
    return () => {
      cancelled = true;
      cancelPreload();
    };
  }, [pathname, runtime]);

  if (!privyAppId) {
    return <UnconfiguredWalletProvider>{children}</UnconfiguredWalletProvider>;
  }

  return (
    <DeferredWalletProvider
      active={active}
      openingWallet={pendingAction !== null}
      configuredValue={configuredValue}
      loadFailed={loadFailed}
      onActivate={activateWalletRuntime}
      onPreload={preloadWalletRuntime}
    >
      {children}
      {runtime ? (
        <ConfiguredWalletProvider
          appId={privyAppId}
          autoAction={pendingAction}
          onAutoActionConsumed={consumePendingAction}
          onValueChange={acceptConfiguredValue}
          runtime={runtime}
        />
      ) : null}
    </DeferredWalletProvider>
  );
}

function DeferredWalletProvider({
  active,
  openingWallet,
  children,
  configuredValue,
  loadFailed,
  onActivate,
  onPreload,
}: Readonly<{
  active: boolean;
  openingWallet: boolean;
  children: ReactNode;
  configuredValue: WalletContextValue | null;
  loadFailed: boolean;
  onActivate: (action: "wallet" | "github") => void;
  onPreload: () => void;
}>) {
  const value = useMemo<WalletContextValue>(
    () => ({
      wallet: null,
      walletLinked: false,
      username: "",
      avatarDataUrl: "",
      authReady: false,
      sessionReady: false,
      authenticated: false,
      hasSession: false,
      connecting: active && !loadFailed,
      openingWallet: openingWallet && !loadFailed,
      disconnecting: false,
      switchingNetwork: false,
      preloadWallet: onPreload,
      openWallet: () => onActivate("wallet"),
      openWalletWithError: () => onActivate("wallet"),
      switchNetwork: async () => false,
      disconnect: async () => false,
      getAccessToken: async () => null,
      getIdentityToken: async () => null,
      refreshApplicantSession: async () => null,
      githubConnected: false,
      githubUserId: "",
      githubUsername: "",
      connectGithub: () => onActivate("github"),
      authorizeGithubLaunchApp: async () => {
        throw new Error("GitHub sign-in is still loading");
      },
      reauthorizeGithub: async () => {
        throw new Error("GitHub sign-in is still loading");
      },
      setUsername: () => undefined,
      signLaunchMessage: async () => {
        throw new Error("Wallet sign-in is still loading");
      },
      reviewPrivyPolicyOwnerRequest: async () => {
        throw new Error("OWNER_HANDOFF_SESSION_CHANGED");
      },
      signPrivyPolicyOwnerRequest: async () => {
        throw new Error("OWNER_HANDOFF_SESSION_CHANGED");
      },
      signPredictionPermit: async () => {
        throw new Error("Wallet sign-in is still loading");
      },
      signPredictionTokenPermit: async () => {
        throw new Error("Wallet sign-in is still loading");
      },
      signMainTokenMigrationPermit: async () => {
        throw new Error("Wallet sign-in is still loading");
      },
      sendBrowserWalletAction: async () => {
        throw new Error("Wallet sign-in is still loading");
      },
      sendCustomLaunchWalletAction: async () => {
        throw new Error("Wallet sign-in is still loading");
      },
      sendLaunchPlanTradeWalletAction: async () => { throw new Error("Connect your trading wallet before continuing"); },
      sendLaunchClaimWalletAction: async () => { throw new Error("Connect your controller wallet before continuing"); },
      sendUniversalLaunchWalletAction: async () => { throw new Error("Connect your controller wallet before continuing"); },
      sendCustomLaunchWalletActionV4: async () => {
        throw new Error("Wallet sign-in is still loading");
      },
      signCustomLaunchFundingAuthorization: async () => {
        throw new Error("Wallet sign-in is still loading");
      },
      sendTransaction: async () => {
        throw new Error("Wallet sign-in is still loading");
      },
      sendPredictionV2Transaction: async () => {
        throw new Error("Wallet sign-in is still loading");
      },
      sendModuleModeTransaction: async () => {
        throw new Error("Wallet sign-in is still loading");
      },
      readNativeBalance: async () => {
        throw new Error("Wallet sign-in is still loading");
      },
      readConnectedAccountCode: async () => {
        throw new Error("Wallet sign-in is still loading");
      },
      readTradeBalances: async () => {
        throw new Error("Wallet sign-in is still loading");
      },
    }),
    [active, loadFailed, onActivate, onPreload, openingWallet],
  );

  return (
    <WalletContext.Provider value={configuredValue ?? value}>
      {children}
    </WalletContext.Provider>
  );
}

function subscribeToTheme(callback: () => void) {
  window.addEventListener(themeChangeEvent, callback);
  return () => window.removeEventListener(themeChangeEvent, callback);
}

function getThemeSnapshot(): ColorTheme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function getServerThemeSnapshot(): ColorTheme {
  return "light";
}

// Adopting the bridge value rerenders WalletProvider. Keep that parent update
// from feeding back through Privy's hook callbacks and emitting it again.
const ConfiguredWalletProvider = memo(function ConfiguredWalletProvider({
  appId,
  autoAction,
  onAutoActionConsumed,
  onValueChange,
  runtime,
}: {
  appId: string;
  autoAction: "wallet" | "github" | null;
  onAutoActionConsumed: () => void;
  onValueChange: (value: WalletContextValue) => void;
  runtime: WalletProviderRuntime;
}) {
  const { PrivyProvider } = runtime;
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );

  const themedPrivyConfig = useMemo<PrivyClientConfig>(
    () => ({
      ...privyConfig,
      appearance: {
        ...privyConfig.appearance,
        theme,
      },
    }),
    [theme],
  );

  return (
    <PrivyProvider
      appId={appId}
      config={themedPrivyConfig}
    >
      <PrivyWalletBridge
        autoAction={autoAction}
        onAutoActionConsumed={onAutoActionConsumed}
        onValueChange={onValueChange}
        runtime={runtime}
      />
    </PrivyProvider>
  );
});

function PrivyWalletBridge({
  autoAction,
  onAutoActionConsumed,
  onValueChange,
  runtime,
}: Readonly<{
  autoAction: "wallet" | "github" | null;
  onAutoActionConsumed: () => void;
  onValueChange: (value: WalletContextValue) => void;
  runtime: WalletProviderRuntime;
}>) {
  const {
    getIdentityToken: getPrivyIdentityToken,
    useAuthorizationSignature,
    useConnectWallet,
    useIdentityToken,
    useLinkAccount,
    useLogin,
    useLoginWithSiwe,
    useModalStatus,
    useOAuthTokens,
    usePrivy,
    useSendTransaction: usePrivySendTransaction,
    useSignMessage: usePrivySignMessage,
    useUser,
    useWallets,
  } = runtime;
  const { authenticated, getAccessToken, logout, ready, user } = usePrivy();
  const { isOpen: privyModalOpen } = useModalStatus();
  const { refreshUser } = useUser();
  const [applicantRefreshUserGate] = useState<ApplicantRefreshUserGateV1<
    RefreshableApplicantUserV1 | null | undefined
  >>(() => createApplicantRefreshUserGateV1<
    RefreshableApplicantUserV1 | null | undefined
  >({
    source: () =>
      refreshUser() as Promise<RefreshableApplicantUserV1>,
    isRateLimited: applicantRefreshUserIsRateLimitedV1,
  }));
  useEffect(() => {
    applicantRefreshUserGate.setSource(
      () => refreshUser() as Promise<RefreshableApplicantUserV1>,
    );
  }, [applicantRefreshUserGate, refreshUser]);
  const { reauthorize } = useOAuthTokens();
  const { identityToken } = useIdentityToken();
  // Keep the latest hook value available to stable Applicant callbacks. The
  // callback must not depend on the token itself: Privy updates this value
  // after `refreshUser()`, and changing the callback identity would restart
  // the discovery effect while its first request is still settling.
  const applicantIdentityTokenRef = useRef<string | null>(identityToken);
  useEffect(() => {
    applicantIdentityTokenRef.current = identityToken;
  }, [identityToken]);
  const { sendTransaction: sendPrivyTransaction } = usePrivySendTransaction();
  const { signMessage: signPrivyMessage } = usePrivySignMessage();
  const { generateAuthorizationSignature } = useAuthorizationSignature();
  const { ready: walletsReady, wallets } = useWallets();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [loginPending, setLoginPending] = useState(false);
  const [walletLoginStatus, setWalletLoginStatus] = useState("");
  const [sessionSuppressed, setSessionSuppressed] = useState(false);
  const [switchingNetwork, setSwitchingNetwork] = useState(false);
  const networkSwitchPendingRef = useRef(false);
  const [error, setError] = useState("");
  const [providerTimedOut, setProviderTimedOut] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState<{
    userId: string;
    address: string;
  } | null>(null);
  const sdkSessionRef = useRef({ ready, authenticated, userId: user?.id ?? null, sessionSuppressed, disconnecting });
  useLayoutEffect(() => {
    sdkSessionRef.current = { ready, authenticated, userId: user?.id ?? null, sessionSuppressed, disconnecting };
  }, [authenticated, disconnecting, ready, sessionSuppressed, user?.id]);
  const walletLoginIntentRef = useRef<"login" | "connect" | "link" | null>(null);
  const walletLoginAttemptGateRef = useRef(createWalletLoginAttemptGate());
  const walletLoginLeaseRef = useRef<BrowserWalletLoginLease | null>(null);
  const settleWalletLoginAttempt = useCallback(() => {
    walletLoginIntentRef.current = null;
    walletLoginAttemptGateRef.current.settle();
    walletLoginLeaseRef.current?.release();
    walletLoginLeaseRef.current = null;
    setLoginPending(false);
  }, []);
  const { login } = useLogin({
    onComplete: ({ user: signedInUser, loginAccount }) => {
      settleWalletLoginAttempt();
      if (loginAccount?.type === "wallet" && isEthereumAddress(loginAccount.address)) {
        setSelectedWallet({ userId: signedInUser.id, address: loginAccount.address });
      }
      applicantRefreshUserGate.invalidate();
      setSessionSuppressed(false);
      setError("");
      setWalletLoginStatus("");
      setDialogOpen(false);
    },
    onError: (errorCode) => {
      settleWalletLoginAttempt();
      const message = getWalletLoginErrorMessage(errorCode);
      if (!message) return;

      setError(message);
      setWalletLoginStatus("");
      setDialogOpen(true);
    },
  });
  const { generateSiweMessage, loginWithSiwe } = useLoginWithSiwe();
  const { connectWallet } = useConnectWallet({
    onSuccess: ({ wallet: reconnectedWallet }) => {
      settleWalletLoginAttempt();
      const owned = user?.linkedAccounts.some((account) =>
        account.type === "wallet"
        && account.chainType === "ethereum"
        && account.address.toLowerCase() === reconnectedWallet.address.toLowerCase());
      if (!owned || !user) {
        setError("Connect a wallet linked to this account, or sign out to use another account.");
        setDialogOpen(true);
        return;
      }
      setSelectedWallet({ userId: user.id, address: reconnectedWallet.address });
      setError("");
      setDialogOpen(false);
    },
    onError: (errorCode) => {
      settleWalletLoginAttempt();
      const message = getWalletLoginErrorMessage(errorCode);
      if (!message) return;
      setError(message);
      setDialogOpen(true);
    },
  });
  const { linkGithub, linkWallet } = useLinkAccount({
    onSuccess: ({ user: linkedUser, linkedAccount }) => {
      settleWalletLoginAttempt();
      applicantRefreshUserGate.invalidate();
      if (linkedAccount.type === "wallet" && isEthereumAddress(linkedAccount.address)) {
        setSelectedWallet({ userId: linkedUser.id, address: linkedAccount.address });
      }
      setError("");
      setDialogOpen(false);
    },
    onError: (errorCode) => {
      settleWalletLoginAttempt();
      const message = getWalletLoginErrorMessage(errorCode);
      if (!message) return;

      setError(message);
      setDialogOpen(true);
    },
  });

  const activeAuthenticated = authenticated && !sessionSuppressed;
  // Logout may resolve before Privy's hooks publish the cleared user. Keep
  // login blocked until that readback, then allow a future restored session.
  if (sessionSuppressed && ready && !authenticated && !user && !disconnecting) {
    setSessionSuppressed(false);
  }
  useEffect(() => {
    if (walletLoginIntentRef.current !== "login" || !loginPending
      || !ready || !activeAuthenticated || !user || privyModalOpen) return;
    // Privy can restore an existing session without emitting this attempt's
    // completion callback. Authentication settles login, never a connect/link.
    settleWalletLoginAttempt();
    setError("");
    setWalletLoginStatus("");
    setDialogOpen(false);
  }, [activeAuthenticated, loginPending, privyModalOpen, ready, settleWalletLoginAttempt, user]);
  const ownerUserId = user?.id ?? null;
  const ownerSessionRef = useRef<PrivyPolicyOwnerSession>({
    ready: false,
    authenticated: false,
    userId: null,
  });
  const ownerSigningRef = useRef(false);
  useLayoutEffect(() => {
    ownerSessionRef.current = {
      ready,
      authenticated: activeAuthenticated,
      userId: ownerUserId,
    };
    return () => {
      ownerSessionRef.current = { ready: false, authenticated: false, userId: null };
    };
  }, [activeAuthenticated, ready, ownerUserId]);
  const reviewPrivyPolicyOwnerRequest = useCallback(async (input: Readonly<{
    text: string;
    operation: PrivyPolicyOwnerOperation;
  }>) => {
    const session = ownerSessionRef.current;
    if (!ready || !activeAuthenticated || !ownerUserId
      || !session.ready || !session.authenticated || !session.userId
      || session.userId !== ownerUserId) {
      throw new Error("OWNER_HANDOFF_SESSION_CHANGED");
    }
    const { reviewPrivyPolicyOwnerRequest: review } = await import(
      "@/lib/privy-policy-owner/handoff"
    );
    const result = await review({ ...input, userId: session.userId, nowMilliseconds: Date.now() });
    const current = ownerSessionRef.current;
    if (!current.ready || !current.authenticated || current.userId !== session.userId) {
      throw new Error("OWNER_HANDOFF_SESSION_CHANGED");
    }
    if (Date.now() >= Date.parse(result.artifact.expiresAt)) {
      throw new Error("OWNER_HANDOFF_REQUEST_EXPIRED_OR_CLOCK_INVALID");
    }
    return result;
  }, [activeAuthenticated, ready, ownerUserId]);
  const signPrivyPolicyOwnerRequest = useCallback(async (input: Readonly<{
    text: string;
    operation: PrivyPolicyOwnerOperation;
    reviewedRequestArtifactSha256: string;
  }>) => {
    if (ownerSigningRef.current) throw new Error("OWNER_HANDOFF_SIGNING_IN_PROGRESS");
    ownerSigningRef.current = true;
    try {
      const { signReviewedPrivyPolicyOwnerRequest } = await import(
        "@/lib/privy-policy-owner/handoff"
      );
      return await signReviewedPrivyPolicyOwnerRequest({
        ...input,
        readSession: () => ownerSessionRef.current,
        signAuthorization: generateAuthorizationSignature,
      });
    } finally {
      ownerSigningRef.current = false;
    }
  }, [generateAuthorizationSignature]);
  useEffect(() => {
    if (!ready) return;
    persistWalletSessionHint(activeAuthenticated);
  }, [activeAuthenticated, ready]);
  const githubAccount = user?.github;
  const githubConnected = Boolean(activeAuthenticated && githubAccount?.subject);
  const githubUserId = githubConnected ? githubAccount?.subject ?? "" : "";
  const githubUsername = githubConnected ? githubAccount?.username ?? "" : "";
  const ownedWalletAddresses = useMemo(() => new Set(
    user?.linkedAccounts.flatMap((account) => account.type === "wallet"
      && account.chainType === "ethereum" && isEthereumAddress(account.address)
      ? [account.address.toLowerCase()] : []) ?? [],
  ), [user?.linkedAccounts]);
  const connectedWallet = useMemo(() => {
    if (!activeAuthenticated) return undefined;
    const selected = selectedWallet?.userId !== user?.id
      ? undefined
      : wallets.find((candidate) =>
        isEthereumAddress(candidate.address)
        && ownedWalletAddresses.has(candidate.address.toLowerCase())
        && candidate.address.toLowerCase() === selectedWallet?.address.toLowerCase());
    return selected ?? selectAuthenticatedWallet(activeAuthenticated, wallets, user?.wallet?.address, ownedWalletAddresses);
  }, [
    activeAuthenticated,
    ownedWalletAddresses,
    selectedWallet,
    user?.id,
    user?.wallet?.address,
    wallets,
  ]);
  const walletOptions = useMemo(() => {
    const seen = new Set<string>();
    return wallets.flatMap((candidate) => {
      if (
        !isEthereumAddress(candidate.address)
        || !ownedWalletAddresses.has(candidate.address.toLowerCase())
      ) return [];
      const normalized = candidate.address.toLowerCase();
      if (seen.has(normalized)) return [];
      seen.add(normalized);
      return [Object.freeze({
        account: candidate.address,
        chainId: normalizeChainId(candidate.chainId),
      })];
    });
  }, [ownedWalletAddresses, wallets]);

  const connectedWalletAddress = connectedWallet?.address;
  const connectedWalletChainId = connectedWallet?.chainId;
  const wallet = useMemo<WalletState | null>(() => {
    if (
      !connectedWalletAddress
      || typeof connectedWalletChainId !== "string"
      || !isEthereumAddress(connectedWalletAddress)
    ) {
      return null;
    }

    return {
      account: connectedWalletAddress,
      chainId: normalizeChainId(connectedWalletChainId),
    };
  }, [connectedWalletAddress, connectedWalletChainId]);
  const walletLinked = Boolean(connectedWallet && ownedWalletAddresses.has(connectedWallet.address.toLowerCase()));
  const walletSessionGenerationRef = useRef(0);
  const walletRequestSessionRef = useRef({
    authenticated: activeAuthenticated && ready && walletsReady && !disconnecting,
    privyUserId: user?.id ?? null,
    account: wallet?.account ?? null,
    walletCapability: connectedWallet ?? null,
  });
  useLayoutEffect(() => {
    const previous = walletRequestSessionRef.current;
    const current = {
      authenticated: activeAuthenticated && ready && walletsReady && !disconnecting,
      privyUserId: user?.id ?? null,
      account: wallet?.account ?? null,
      walletCapability: connectedWallet ?? null,
    };
    if (previous.authenticated !== current.authenticated
      || previous.privyUserId !== current.privyUserId
      || previous.account?.toLowerCase() !== current.account?.toLowerCase()
      || previous.walletCapability?.getEthereumProvider !== current.walletCapability?.getEthereumProvider
      || previous.walletCapability?.switchChain !== current.walletCapability?.switchChain) {
      walletSessionGenerationRef.current += 1;
    }
    walletRequestSessionRef.current = current;
  }, [activeAuthenticated, connectedWallet, disconnecting, ready, user?.id, wallet?.account, walletsReady]);
  useLayoutEffect(() => () => {
    walletSessionGenerationRef.current += 1;
    walletRequestSessionRef.current = {
      authenticated: false,
      privyUserId: null,
      account: null,
      walletCapability: null,
    };
  }, []);
  const providerSettled = isWalletProviderSettled(
    ready && !sessionSuppressed && authenticated === Boolean(user),
    walletsReady,
    activeAuthenticated,
  );
  if (providerSettled && providerTimedOut) setProviderTimedOut(false);
  const hasSession = activeAuthenticated;
  const hasLinkedWallet = activeAuthenticated && Boolean(user?.linkedAccounts.some((account) =>
    account.type === "wallet" && account.chainType === "ethereum" && isEthereumAddress(account.address)));
  const sessionAction = getWalletSessionAction(providerSettled, activeAuthenticated);
  const getCurrentIdentityToken = useCallback(
    () => resolveWalletIdentityToken({
      authenticated: activeAuthenticated,
      cachedIdentityToken: identityToken,
      loadIdentityToken: getPrivyIdentityToken,
    }),
    [activeAuthenticated, getPrivyIdentityToken, identityToken],
  );
  const applicantLinkedAccountsFingerprint = useMemo(
    () => applicantLinkedAccountsFingerprintV1(user?.linkedAccounts),
    [user?.linkedAccounts],
  );
  const initialApplicantAuthority: ApplicantAuthoritySnapshotV1 = {
    privyUserId: user?.id ?? null,
    githubUserId: user?.github?.subject ?? null,
    githubLogin: user?.github?.username ?? null,
    walletAddress: wallet?.account ?? null,
    linkedAccountsFingerprint: applicantLinkedAccountsFingerprint,
  };
  const applicantAuthorityRef = useRef<ApplicantAuthoritySnapshotV1>(
    initialApplicantAuthority,
  );
  const applicantAuthorityKeyRef = useRef(
    applicantAuthorityCacheKeyV1(initialApplicantAuthority),
  );
  useEffect(() => {
    const nextAuthority: ApplicantAuthoritySnapshotV1 = {
      privyUserId: user?.id ?? null,
      githubUserId: user?.github?.subject ?? null,
      githubLogin: user?.github?.username ?? null,
      walletAddress: wallet?.account ?? null,
      linkedAccountsFingerprint: applicantLinkedAccountsFingerprint,
    };
    const nextAuthorityKey = applicantAuthorityCacheKeyV1(nextAuthority);
    if (applicantAuthorityKeyRef.current !== nextAuthorityKey) {
      applicantRefreshUserGate.invalidate();
    }
    applicantAuthorityRef.current = nextAuthority;
    applicantAuthorityKeyRef.current = nextAuthorityKey;
  }, [
    applicantLinkedAccountsFingerprint,
    applicantRefreshUserGate,
    user?.github?.subject,
    user?.github?.username,
    user?.id,
    wallet?.account,
  ]);
  const refreshApplicantSession = useCallback(
    (requirement?: WalletApplicantIdentityRequirementV1) => {
      const authorityKey = applicantAuthorityCacheKeyV1(
        applicantAuthorityRef.current,
      );
      return refreshWalletApplicantSessionV1({
        authenticated: activeAuthenticated && ready,
        readCurrentAuthority: () => applicantAuthorityRef.current,
        refreshUser: () => applicantRefreshUserGate.refresh(authorityKey),
        getAccessToken,
        // `refreshUser()` already performs Privy's `/users/me` read and updates
        // its identity-token store. Calling the exported global
        // `getIdentityToken()` here would perform a second `/users/me` read and
        // deterministically hit Privy's one-request rate bucket. Applicant
        // sessions therefore consume only the hook-cached token; if hydration
        // has not exposed it yet, the session fails closed and the next retry
        // can use the updated hook value.
        getIdentityToken: async () => applicantIdentityTokenRef.current,
        requirement,
      });
    },
    [
      activeAuthenticated,
      applicantRefreshUserGate,
      getAccessToken,
      ready,
    ],
  );
  const reauthorizeGithub = useCallback(async () => {
    if (!ready || !activeAuthenticated || !githubConnected) {
      throw new Error("Sign in with your approved GitHub account");
    }
    // No OAuth grant callback is registered: the Website never receives,
    // stores or logs the provider access token during reauthorization.
    applicantRefreshUserGate.invalidate();
    await reauthorize({ provider: "github" });
    applicantRefreshUserGate.invalidate();
  }, [
    activeAuthenticated,
    applicantRefreshUserGate,
    githubConnected,
    ready,
    reauthorize,
  ]);
  const authorizeGithubLaunchApp = useCallback(async () => {
    const session = await refreshApplicantSession();
    if (session === null) {
      throw new Error("Sign in with your approved GitHub account");
    }
    const authorization = await requestGitHubLaunchAppAuthorizationV1({ session });
    window.location.assign(authorization.toString());
  }, [refreshApplicantSession]);

  const profileValue = useSyncExternalStore(
    subscribeToProfiles,
    () => readProfileValue(wallet?.account),
    getEmptyProfileValue,
  );
  const localProfile = useMemo(
    () => parseLocalProfile(profileValue),
    [profileValue],
  );
  const username = localProfile.username;
  const avatarDataUrl = localProfile.avatarDataUrl;

  useEffect(() => {
    if (providerSettled) return;

    const timeout = window.setTimeout(() => {
      setProviderTimedOut(true);
    }, 8_000);

    return () => window.clearTimeout(timeout);
  }, [providerSettled]);

  const setUsername = useCallback(
    (nextUsername: string) => {
      if (
        !wallet ||
        (nextUsername !== "" && !usernamePattern.test(nextUsername))
      ) {
        return;
      }

      try {
        const storageKey = getWalletProfileStorageKey(wallet.account);
        const profile = readStoredProfile(wallet.account);
        if (nextUsername) {
          profile.username = nextUsername;
        } else {
          delete profile.username;
        }

        if (Object.keys(profile).length > 0) {
          window.localStorage.setItem(storageKey, JSON.stringify(profile));
        } else {
          window.localStorage.removeItem(storageKey);
        }
        emitProfileChange(wallet.account);
      } catch {
        return;
      }
    },
    [wallet],
  );

  const startLogin = useCallback(() => {
    const session = sdkSessionRef.current;
    if (session.authenticated || session.userId || session.sessionSuppressed || session.disconnecting) {
      setDialogOpen(true);
      return;
    }
    if (privyModalOpen) return;
    if (!walletLoginAttemptGateRef.current.tryStart()) return;

    walletLoginIntentRef.current = "login";
    setLoginPending(true);
    setError("");
    setWalletLoginStatus("");
    setDialogOpen(false);

    if (!ready) {
      settleWalletLoginAttempt();
      setError(
        "Wallet access is taking longer than expected. Reload the page and try again.",
      );
      setDialogOpen(true);
      return;
    }

    void acquireBrowserWalletLoginLease()
      .then(async (lease) => {
        if (!walletLoginAttemptGateRef.current.isPending()) {
          lease.release();
          return;
        }
        walletLoginLeaseRef.current = lease;
        const currentSession = sdkSessionRef.current;
        if (!currentSession.ready || currentSession.authenticated || currentSession.userId
          || currentSession.sessionSuppressed || currentSession.disconnecting) {
          settleWalletLoginAttempt();
          setDialogOpen(false);
          return;
        }

        try {
          if (window.location.pathname === "/ops/classic-v4-canary") {
            const provider = selectInjectedEthereumProvider(
              (window as typeof window & { ethereum?: unknown }).ethereum,
            );
            if (
              provider
              && await loginConnectedEthereumWalletWithSiwe({
                provider,
                generateSiweMessage,
                loginWithSiwe,
              })
            ) {
              settleWalletLoginAttempt();
              applicantRefreshUserGate.invalidate();
              setSessionSuppressed(false);
              setError("");
              setWalletLoginStatus("");
              setDialogOpen(false);
              return;
            }
          }

          login({
            loginMethods: ["wallet", "email"],
            walletChainType: "ethereum-only",
          });
        } catch {
          settleWalletLoginAttempt();
          setError("Unable to connect wallet. Try again.");
          setWalletLoginStatus("");
          setDialogOpen(true);
        }
      })
      .catch((loginError: unknown) => {
        settleWalletLoginAttempt();
        if (loginError instanceof WalletLoginPendingError) {
          setError("");
          setWalletLoginStatus(WALLET_LOGIN_OTHER_TAB_MESSAGE);
        } else {
          setError("Unable to connect wallet. Try again.");
          setWalletLoginStatus("");
        }
        setDialogOpen(true);
      });
  }, [
    applicantRefreshUserGate,
    generateSiweMessage,
    login,
    loginWithSiwe,
    privyModalOpen,
    ready,
    settleWalletLoginAttempt,
  ]);

  useEffect(() => () => {
    walletLoginAttemptGateRef.current.settle();
    walletLoginLeaseRef.current?.release();
    walletLoginLeaseRef.current = null;
  }, []);

  const connectGithub = useCallback(() => {
    if (sdkSessionRef.current.sessionSuppressed || sdkSessionRef.current.disconnecting) return;
    setError("");
    setDialogOpen(false);

    if (!ready || authenticated !== Boolean(user)) {
      setError(
        "GitHub sign-in is taking longer than expected. Reload the page and try again.",
      );
      setDialogOpen(true);
      return;
    }
    if (activeAuthenticated) {
      if (!githubConnected) linkGithub();
      return;
    }
    login({
      loginMethods: ["github"],
      walletChainType: "ethereum-only",
    });
  }, [activeAuthenticated, authenticated, githubConnected, linkGithub, login, ready, user]);

  const connectAccountWallet = useCallback((link: boolean) => {
    if (!providerSettled || !activeAuthenticated || privyModalOpen) return;
    if (!walletLoginAttemptGateRef.current.tryStart()) return;
    walletLoginIntentRef.current = link ? "link" : "connect";
    setLoginPending(true);
    setError("");
    setWalletLoginStatus("");
    setDialogOpen(false);
    void acquireBrowserWalletLoginLease().then((lease) => {
      if (!walletLoginAttemptGateRef.current.isPending()) {
        lease.release();
        return;
      }
      walletLoginLeaseRef.current = lease;
      if (!ownerSessionRef.current.authenticated || ownerSessionRef.current.userId !== user?.id) {
        settleWalletLoginAttempt();
        return;
      }
      try {
        const options = { description: "Connect your wallet", walletChainType: "ethereum-only" as const };
        if (link) linkWallet(options);
        else connectWallet(options);
      } catch {
        settleWalletLoginAttempt();
        setError("Unable to connect wallet. Try again.");
        setDialogOpen(true);
      }
    }).catch((connectionError: unknown) => {
      settleWalletLoginAttempt();
      setError(connectionError instanceof WalletLoginPendingError
        ? WALLET_LOGIN_OTHER_TAB_MESSAGE
        : "Unable to connect wallet. Try again.");
      setDialogOpen(true);
    });
  }, [activeAuthenticated, connectWallet, linkWallet, privyModalOpen, providerSettled, settleWalletLoginAttempt, user?.id]);
  const addWallet = useCallback(() => connectAccountWallet(true), [connectAccountWallet]);
  const reconnectWallet = useCallback(() => connectAccountWallet(false), [connectAccountWallet]);

  const openWallet = useCallback(() => {
    setError("");

    const action = getWalletOpenAction(sessionAction, wallet !== null, hasLinkedWallet);

    if (action === "wait") {
      if (providerTimedOut) {
        setError(
          "Wallet access is taking longer than expected. Reload the page and try again.",
        );
        setDialogOpen(true);
      }
      return;
    }
    if (action === "manage") {
      setDialogOpen(true);
      return;
    }

    if (action === "link") {
      addWallet();
      return;
    }
    if (action === "reconnect") {
      reconnectWallet();
      return;
    }

    startLogin();
  }, [addWallet, hasLinkedWallet, providerTimedOut, reconnectWallet, sessionAction, startLogin, wallet]);

  const openWalletWithError = useCallback((message: string) => {
    setError(message);
    setDialogOpen(true);
  }, []);

  useEffect(() => {
    if (autoAction === null || sessionAction === "wait") return;

    const timeout = window.setTimeout(() => {
      if (autoAction === "github") {
        connectGithub();
      } else {
        openWallet();
      }
      onAutoActionConsumed();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [
    autoAction,
    connectGithub,
    onAutoActionConsumed,
    openWallet,
    sessionAction,
  ]);

  const disconnect = useCallback(async (options?: {
    showDialogOnFailure?: boolean;
  }) => {
    walletSessionGenerationRef.current += 1;
    walletRequestSessionRef.current.authenticated = false;
    applicantRefreshUserGate.invalidate();
    settleWalletLoginAttempt();
    setDisconnecting(true);
    setError("");
    const markDisconnectFailed = () => {
      const outcome = getWalletDisconnectOutcome(false);
      setSessionSuppressed(outcome.sessionSuppressed);
      setDialogOpen(
        options?.showDialogOnFailure === false ? false : outcome.dialogOpen,
      );
      setError(outcome.error);
      return false;
    };

    try {
      const succeeded = await executeWalletDisconnect({
        authenticated,
        logout,
        disconnectProviderWallets: async () => {
          const results = await Promise.allSettled(
            wallets.map((candidate) =>
              Promise.resolve().then(() => candidate.disconnect()),
            ),
          );
          return results.every((result) => result.status === "fulfilled");
        },
        markAppDisconnected: () => {
          setSelectedWallet(null);
          const outcome = getWalletDisconnectOutcome(true);
          setSessionSuppressed(outcome.sessionSuppressed);
          setDialogOpen(outcome.dialogOpen);
          setError(outcome.error);
        },
      });
      if (succeeded) return true;
      return markDisconnectFailed();
    } catch {
      return markDisconnectFailed();
    } finally {
      setDisconnecting(false);
    }
  }, [applicantRefreshUserGate, authenticated, logout, settleWalletLoginAttempt, wallets]);

  const copyAddress = useCallback(async () => {
    if (!wallet) return;
    setError("");

    try {
      await navigator.clipboard.writeText(wallet.account);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("The address could not be copied");
    }
  }, [wallet]);

  const switchWalletNetwork = useCallback(async (expectedChainId?: string) => {
    if (!connectedWallet || !wallet || !ownerUserId || networkSwitchPendingRef.current) return false;
    const expectedAccount = wallet.account.toLowerCase();
    const expectedUser = ownerUserId;
    const expectedGeneration = walletSessionGenerationRef.current;
    const isCurrentSession = () => {
      const current = walletRequestSessionRef.current;
      return walletSessionGenerationRef.current === expectedGeneration
        && current.authenticated
        && current.privyUserId === expectedUser
        && current.account?.toLowerCase() === expectedAccount
        // Privy replaces the public wallet wrapper when its chain changes.
        // Connection methods remain stable until the underlying wallet changes.
        && current.walletCapability?.getEthereumProvider === connectedWallet.getEthereumProvider
        && current.walletCapability?.switchChain === connectedWallet.switchChain;
    };
    if (!isCurrentSession()) return false;
    const target = getWalletNetwork(expectedChainId);
    if (!target) {
      setError("The approved launch network is not available in this environment.");
      return false;
    }

    networkSwitchPendingRef.current = true;
    setSwitchingNetwork(true);
    setError("");

    try {
      await connectedWallet.switchChain(target.chain.id);
      if (!isCurrentSession()) return false;
      const provider = await connectedWallet.getEthereumProvider();
      if (!isCurrentSession()) return false;
      const connectedChainId = await provider.request({ method: "eth_chainId" });
      if (!isCurrentSession()) return false;
      if (
        typeof connectedChainId !== "string"
        || normalizeChainId(connectedChainId) !== target.chainHex
      ) {
        setError(`Unable to verify ${target.name}. Try again.`);
        return false;
      }
      if (connectedWallet.walletClientType !== "privy" && connectedWallet.walletClientType !== "privy-v2") {
        const accounts = await provider.request({ method: "eth_accounts" });
        if (!isCurrentSession()) return false;
        if (!Array.isArray(accounts) || typeof accounts[0] !== "string"
          || accounts[0].toLowerCase() !== expectedAccount) {
          setError("The active wallet changed. Reconnect and try again.");
          return false;
        }
      }
      return true;
    } catch (cause) {
      if (isCurrentSession()) {
        const rejected = typeof cause === "object" && cause !== null
          && "code" in cause && cause.code === 4001;
        setError(rejected ? "Network change cancelled." : `Unable to switch to ${target.name}. Try again.`);
      }
      return false;
    } finally {
      networkSwitchPendingRef.current = false;
      setSwitchingNetwork(false);
    }
  }, [connectedWallet, ownerUserId, wallet]);

  const sendTransaction = useCallback(
    async (transaction: PreparedTransaction) => {
      if (!connectedWallet || !wallet) {
        throw new Error("Connect your wallet before continuing");
      }
      const prepared = parsePreparedTransactionForAccount(
        transaction,
        wallet.account,
      );
      if (prepared.kind === "main-token-migration") {
        assertMainTokenMigrationTransaction(prepared, wallet.account);
      }
      const target =
        prepared.kind === "prediction-market-launch" ||
        prepared.kind === "prediction-market-action"
        ? getWalletNetwork(String(robinhoodChain.id))
        : getWalletNetwork(String(appChain.id));
      if (!target || prepared.chainId !== target.chain.id) {
        throw new Error(
          `The prepared transaction is not for ${target?.name ?? "an approved network"}`,
        );
      }
      const isEmbeddedWallet =
        connectedWallet.walletClientType === "privy" ||
        connectedWallet.walletClientType === "privy-v2";
      const sessionSubject = user?.id ?? null;
      const expectedAccount = wallet.account.toLowerCase();
      if (sessionSubject === null) {
        throw new Error("Your wallet session expired. Reconnect and try again");
      }
      const assertCurrentSession = () => {
        const current = walletRequestSessionRef.current;
        if (
          !current.authenticated ||
          current.privyUserId !== sessionSubject ||
          current.account?.toLowerCase() !== expectedAccount
        ) {
          throw new Error("The wallet session changed. Reconnect and try again");
        }
      };

      try {
        if (wallet.chainId !== target.chainHex) {
          await connectedWallet.switchChain(target.chain.id);
          assertCurrentSession();
        }

        const sendLocked = (execute: () => Promise<Hex>) =>
          runWithBrowserWalletRequestLock({
            sessionSubject,
            account: wallet.account,
            chainId: String(prepared.chainId),
            requestSubject: JSON.stringify([
              "prepared-transaction-v1",
              prepared,
              expectedAccount,
            ]),
            assertCurrentSession,
            execute,
          });
        if (isEmbeddedWallet) {
          return await sendLocked(async () => {
            const review = getPreparedTransactionReview(prepared.kind);
            const result = await sendPrivyTransaction(
              buildPrivyTransactionRequest(prepared),
              {
                address: wallet.account,
                uiOptions: {
                  description: review.description,
                  buttonText: review.buttonText,
                  successHeader: review.successHeader,
                },
              },
            );
            return parseSubmittedTransactionHash(result.hash);
          });
        }

        const provider = await connectedWallet.getEthereumProvider();
        const providerChainId = await provider.request({
          method: "eth_chainId",
        });
        if (
          typeof providerChainId !== "string" ||
          normalizeChainId(providerChainId) !== target.chainHex
        ) {
          throw new Error(`The wallet is not connected to ${target.name}`);
        }
        assertCurrentSession();
        return await sendLocked(async () => {
          const hash = await provider.request({
            method: "eth_sendTransaction",
            params: [buildEip1193TransactionRequest(prepared, wallet.account)],
          });
          return parseSubmittedTransactionHash(hash);
        });
      } catch (caught) {
        throw new Error(getWalletTransactionErrorMessage(caught));
      }
    },
    [connectedWallet, sendPrivyTransaction, user?.id, wallet],
  );

  const sendPredictionV2Transaction = useCallback(
    async (prepared: ParsedPredictionV2PreparedTransactionV2) => {
      if (!connectedWallet || !wallet) {
        throw new Error("Connect your wallet before continuing");
      }
      const sessionSubject = user?.id ?? null;
      if (sessionSubject === null) {
        throw new Error("Your wallet session expired. Reconnect and try again");
      }
      const boundWallet = connectedWallet;
      const expectedAccount = wallet.account.toLowerCase();
      const isEmbeddedWallet =
        boundWallet.walletClientType === "privy" ||
        boundWallet.walletClientType === "privy-v2";
      const assertCurrentSession = () => {
        const current = walletRequestSessionRef.current;
        if (
          !current.authenticated ||
          current.privyUserId !== sessionSubject ||
          current.account?.toLowerCase() !== expectedAccount
        ) {
          throw new Error("The wallet session changed. Reconnect and try again");
        }
        if (current.walletCapability !== boundWallet) {
          throw new Error("The selected wallet changed. Review and try again");
        }
      };

      try {
        return await runWithBrowserWalletRequestLock({
          sessionSubject,
          account: wallet.account,
          chainId: String(robinhoodChain.id),
          requestSubject: "prediction-v2-branded-wallet-submit",
          assertCurrentSession,
          execute: async () => {
            assertCurrentSession();
            const provider = await boundWallet.getEthereumProvider();
            assertCurrentSession();
            const checkedProvider: PredictionV2Eip1193ProviderV2 = {
              request: async (request) => {
                assertCurrentSession();
                const result = await provider.request({
                  method: request.method,
                  ...(request.params === undefined
                    ? {}
                    : { params: Array.from(request.params) }),
                });
                assertCurrentSession();
                return result;
              },
            };

            if (isEmbeddedWallet) {
              const review = getPredictionV2PreparedTransactionReviewV2(
                prepared.action,
              );
              return submitPredictionV2PrivyTransactionV2({
                prepared,
                connected: async () => {
                  assertCurrentSession();
                  await assertExternalWalletAuthorityCurrent({
                    expectedAccount: wallet.account,
                    expectedChainId: robinhoodChainHex,
                    networkName: robinhoodChain.name,
                    request: (method) => checkedProvider.request({ method }),
                  });
                  assertCurrentSession();
                  return {
                    account: wallet.account,
                    chainId: robinhoodChain.id,
                    wallet: boundWallet,
                  };
                },
                send: async (submission) => {
                  assertCurrentSession();
                  if (submission.wallet !== boundWallet) {
                    throw new Error(
                      "The selected wallet changed. Review and try again",
                    );
                  }
                  const result = await sendPrivyTransaction(
                    submission.transaction,
                    {
                      address: submission.account,
                      uiOptions: {
                        description: review.description,
                        buttonText: review.buttonText,
                        successHeader: review.successHeader,
                      },
                    },
                  );
                  assertCurrentSession();
                  return result.hash;
                },
              });
            }

            return submitPredictionV2Eip1193TransactionV2({
              prepared,
              provider: checkedProvider,
            });
          },
        });
      } catch (caught) {
        throw new Error(getWalletTransactionErrorMessage(caught));
      }
    },
    [connectedWallet, sendPrivyTransaction, user?.id, wallet],
  );

  const sendModuleModeTransaction = useCallback(
    async (prepared: PreparedModuleModeTransaction): Promise<Hex> => {
      if (!connectedWallet || !wallet) throw Object.assign(new Error("Connect your wallet before continuing"), {
        walletRequestAttempted: false, walletRequestRejected: false,
      });
      const sessionSubject = user?.id ?? null;
      if (sessionSubject === null) throw Object.assign(new Error("Your wallet session expired. Reconnect and try again"), {
        walletRequestAttempted: false, walletRequestRejected: false,
      });
      const boundWallet = connectedWallet;
      const account = wallet.account;
      let walletRequestAttempted = false;
      let enginePreparationPending = false;
      const isEmbeddedWallet = boundWallet.walletClientType === "privy" || boundWallet.walletClientType === "privy-v2";
      const assertCurrentSession = () => {
        const current = walletRequestSessionRef.current;
        if (!current.authenticated || current.privyUserId !== sessionSubject
          || current.account?.toLowerCase() !== account.toLowerCase()
          || current.walletCapability !== boundWallet) {
          throw new Error("The selected wallet changed. Review the transaction again");
        }
      };
      try {
        return await runWithBrowserWalletRequestLock({
          sessionSubject, account, chainId: String(robinhoodChain.id),
          requestSubject: "module-mode-wallet-submit-v1", assertCurrentSession,
          execute: async () => {
            try {
              assertCurrentSession();
              const provider = await boundWallet.getEthereumProvider();
              const assertAuthority = async () => {
                assertCurrentSession();
                await assertExternalWalletAuthorityCurrent({
                  expectedAccount: account, expectedChainId: robinhoodChainHex,
                  networkName: robinhoodChain.name,
                  request: async (method) => {
                    assertCurrentSession();
                    const result = await provider.request({ method });
                    assertCurrentSession();
                    return result;
                  },
                });
                assertCurrentSession();
              };
              await assertAuthority();
              const { revalidateModuleModeTransaction } = await import("@/components/module-mode-wallet-state");
              const transaction = await revalidateModuleModeTransaction(prepared, account);
              enginePreparationPending = "sourceKind" in prepared && prepared.sourceKind === "module-engine-v1";
              if (transaction.chainId !== robinhoodChain.id || transaction.from.toLowerCase() !== account.toLowerCase()) {
                throw new Error("The Module Mode transaction is bound to a different wallet or network");
              }
              await assertAuthority();
              // Revalidation holds the reviewed target, calldata, value and expiry. No raw request is accepted here.
              const submittedHash = async (hash: Hex) => {
                if ("sourceKind" in prepared && prepared.sourceKind === "module-engine-v1") {
                  try {
                    const { noteModuleEngineSubmission } = await import("@/lib/module-engine/client");
                    noteModuleEngineSubmission(prepared, hash);
                  } catch { /* Keep the known hash available for durable read-only recovery. */ }
                }
                return hash;
              };
              if (isEmbeddedWallet) {
                walletRequestAttempted = true;
                const result = await sendPrivyTransaction({
                  to: transaction.to, data: transaction.data, value: BigInt(transaction.value),
                  chainId: robinhoodChain.id,
                  ...(transaction.gas === undefined ? {} : { gas: BigInt(transaction.gas) }),
                }, {
                  address: account,
                  uiOptions: { description: transaction.description, buttonText: "Confirm transaction", successHeader: "Transaction submitted" },
                });
                return submittedHash(parseSubmittedTransactionHash(result.hash));
              }
              walletRequestAttempted = true;
              const hash = await provider.request({
                method: "eth_sendTransaction",
                params: [{ from: account, to: transaction.to, data: transaction.data, value: transaction.value,
                  ...(transaction.gas === undefined ? {} : { gas: transaction.gas }) }],
              });
              return submittedHash(parseSubmittedTransactionHash(hash));
            } catch (caught) {
              if (!walletRequestAttempted) throw new WalletRequestNotSubmittedError(getWalletTransactionErrorMessage(caught));
              throw caught;
            }
          },
        });
      } catch (caught) {
        const rejected = walletRequestAttempted && errorIsExplicitWalletRejection(caught);
        if (enginePreparationPending && (!walletRequestAttempted || rejected) && "sourceKind" in prepared && prepared.sourceKind === "module-engine-v1") {
          try {
            const { releaseModuleEnginePreparation } = await import("@/lib/module-engine/client");
            releaseModuleEnginePreparation(prepared);
          } catch { /* A failed private cleanup cannot change a definite no-send outcome. */ }
        }
        throw Object.assign(new Error(getWalletTransactionErrorMessage(caught)), {
          walletRequestAttempted, walletRequestRejected: rejected,
          ...(rejected ? { code: 4001 } : {}),
        });
      }
    },
    [connectedWallet, sendPrivyTransaction, user?.id, wallet],
  );

  const signPredictionPermit = useCallback(async (input: Readonly<{
    deadline: bigint;
    factoryAddress: Address;
    nonce: bigint;
  }>) => {
    if (!connectedWallet || !wallet) {
      throw new Error("Connect an EVM wallet before continuing");
    }
    const sessionSubject = user?.id ?? null;
    if (sessionSubject === null) {
      throw new Error("Your wallet session expired. Reconnect and try again");
    }
    const expectedAccount = wallet.account.toLowerCase();
    const assertCurrentSession = () => {
      const current = walletRequestSessionRef.current;
      if (
        !current.authenticated ||
        current.privyUserId !== sessionSubject ||
        current.account?.toLowerCase() !== expectedAccount
      ) {
        throw new Error("The wallet session changed. Reconnect and try again");
      }
    };
    const typedData = buildUsdgPermitTypedData({
      deadline: input.deadline,
      factoryAddress: input.factoryAddress,
      nonce: input.nonce,
      owner: wallet.account,
    });

    try {
      if (wallet.chainId !== robinhoodChainHex) {
        await connectedWallet.switchChain(robinhoodChain.id);
        assertCurrentSession();
      }
      const provider = await connectedWallet.getEthereumProvider();
      await assertExternalWalletAuthorityCurrent({
        expectedAccount: wallet.account,
        expectedChainId: robinhoodChainHex,
        networkName: robinhoodChain.name,
        request: (method) => provider.request({ method }),
      });
      const signature = await runWithBrowserWalletRequestLock({
        sessionSubject,
        account: wallet.account,
        chainId: String(robinhoodChain.id),
        requestSubject: JSON.stringify([
          "prediction-usdg-permit-v1",
          input.factoryAddress.toLowerCase(),
          input.nonce.toString(),
          input.deadline.toString(),
        ]),
        assertCurrentSession,
        execute: () => provider.request({
          method: "eth_signTypedData_v4",
          params: [wallet.account, serializeUsdgPermitTypedData(typedData)],
        }),
      });
      if (
        typeof signature !== "string" ||
        !/^0x[0-9a-fA-F]{130}$/.test(signature)
      ) {
        throw new Error("The wallet returned an invalid permit signature");
      }
      return parsePredictionPermitSignature(signature as Hex, input.deadline);
    } catch (caught) {
      throw new Error(getWalletTransactionErrorMessage(caught));
    }
  }, [connectedWallet, user?.id, wallet]);

  const signPredictionTokenPermit = useCallback(async (input: Readonly<{
    deadline: bigint;
    nonce: bigint;
    spender: Address;
    tokenAddress: Address;
    tokenName: string;
    value: bigint;
  }>) => {
    if (!connectedWallet || !wallet) {
      throw new Error("Connect an EVM wallet before continuing");
    }
    const sessionSubject = user?.id ?? null;
    if (sessionSubject === null) {
      throw new Error("Your wallet session expired. Reconnect and try again");
    }
    const expectedAccount = wallet.account.toLowerCase();
    const assertCurrentSession = () => {
      const current = walletRequestSessionRef.current;
      if (
        !current.authenticated ||
        current.privyUserId !== sessionSubject ||
        current.account?.toLowerCase() !== expectedAccount
      ) {
        throw new Error("The wallet session changed. Reconnect and try again");
      }
    };
    const typedData = buildPredictionPermitTypedData({
      ...input,
      owner: wallet.account,
    });

    try {
      if (wallet.chainId !== robinhoodChainHex) {
        await connectedWallet.switchChain(robinhoodChain.id);
        assertCurrentSession();
      }
      const provider = await connectedWallet.getEthereumProvider();
      await assertExternalWalletAuthorityCurrent({
        expectedAccount: wallet.account,
        expectedChainId: robinhoodChainHex,
        networkName: robinhoodChain.name,
        request: (method) => provider.request({ method }),
      });
      const signature = await runWithBrowserWalletRequestLock({
        sessionSubject,
        account: wallet.account,
        chainId: String(robinhoodChain.id),
        requestSubject: JSON.stringify([
          "prediction-token-permit-v1",
          input.tokenAddress.toLowerCase(),
          input.spender.toLowerCase(),
          input.value.toString(),
          input.nonce.toString(),
          input.deadline.toString(),
        ]),
        assertCurrentSession,
        execute: () => provider.request({
          method: "eth_signTypedData_v4",
          params: [
            wallet.account,
            serializePredictionPermitTypedData(typedData),
          ],
        }),
      });
      if (
        typeof signature !== "string" ||
        !/^0x[0-9a-fA-F]{130}$/.test(signature)
      ) {
        throw new Error("The wallet returned an invalid permit signature");
      }
      return parsePredictionPermitSignature(signature as Hex, input.deadline);
    } catch (caught) {
      throw new Error(getWalletTransactionErrorMessage(caught));
    }
  }, [connectedWallet, user?.id, wallet]);

  const signMainTokenMigrationPermit = useCallback(async (input: Readonly<{
    deadline: bigint;
    nonce: bigint;
    spender: Address;
    value: bigint;
  }>) => {
    if (!connectedWallet || !wallet) {
      throw new MigrationPermitWalletError("connection", "session");
    }
    const sessionSubject = user?.id ?? null;
    if (sessionSubject === null) {
      throw new MigrationPermitWalletError("session_changed", "session");
    }
    const expectedAccount = wallet.account.toLowerCase();
    const assertCurrentSession = () => {
      const current = walletRequestSessionRef.current;
      if (!current.authenticated || current.privyUserId !== sessionSubject ||
        current.account?.toLowerCase() !== expectedAccount) {
        throw new MigrationPermitWalletError("session_changed", "session");
      }
    };
    return signMainTokenMigrationPermitWithWallet({
      account: wallet.account,
      sessionSubject,
      wallet: connectedWallet,
      assertCurrentSession,
      permit: input,
    });
  }, [connectedWallet, user?.id, wallet]);

  const signLaunchMessage = useCallback(async (
    signingMessageBase64Url: string,
  ) => {
    if (!connectedWallet || !wallet) {
      throw new Error("Connect your wallet before continuing");
    }
    const messageBytes = decodeBase64Url(signingMessageBase64Url);
    let message: string;
    try {
      message = new TextDecoder("utf-8", { fatal: true }).decode(messageBytes);
    } catch {
      throw new Error("The launch authorization message is invalid");
    }
    const isEmbeddedWallet =
      connectedWallet.walletClientType === "privy" ||
      connectedWallet.walletClientType === "privy-v2";
    let signature: unknown;
    try {
      if (wallet.chainId !== appChainHex) {
        await connectedWallet.switchChain(appChain.id);
      }
      if (isEmbeddedWallet) {
        signature = (await signPrivyMessage(
          { message },
          {
            address: wallet.account,
            uiOptions: {
              title: "Approve launch",
              description: "Prove this wallet belongs to you. This does not send a transaction.",
              buttonText: "Sign approval",
            },
          },
        )).signature;
      } else {
        const provider = await connectedWallet.getEthereumProvider();
        await assertExternalWalletAuthorityCurrent({
          expectedAccount: wallet.account,
          expectedChainId: appChainHex,
          networkName: appNetworkName,
          request: (method) => provider.request({ method }),
        });
        signature = await provider.request({
          method: "personal_sign",
          params: [bytesToHex(messageBytes), wallet.account],
        });
      }
    } catch (caught) {
      throw new Error(getWalletTransactionErrorMessage(caught));
    }
    if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) {
      throw new Error("The wallet returned an invalid signature");
    }
    return encodeBase64Url(hexToBytes(signature as Hex));
  }, [connectedWallet, signPrivyMessage, wallet]);

  const sendBrowserWalletAction = useCallback(async (input: Readonly<{
    chainId: string;
    from: `0x${string}`;
    to: `0x${string}`;
    data: `0x${string}`;
    value: `0x${string}`;
  }>) => {
    if (!connectedWallet || !wallet) {
      throw new Error("Connect your wallet before continuing");
    }
    if (
      input.chainId !== String(appChain.id)
      || input.from.toLowerCase() !== wallet.account.toLowerCase()
      || !isEthereumAddress(input.to)
      || !/^0x(?:[0-9a-fA-F]{2})*$/.test(input.data)
      || !/^0x[0-9a-fA-F]+$/.test(input.value)
    ) {
      throw new Error(`The prepared launch is not valid for ${appNetworkName}`);
    }
    const isEmbeddedWallet =
      connectedWallet.walletClientType === "privy" ||
      connectedWallet.walletClientType === "privy-v2";
    const sessionSubject = user?.id ?? null;
    const expectedAccount = wallet.account.toLowerCase();
    if (sessionSubject === null) {
      throw new Error("Your wallet session expired. Reconnect and try again");
    }
    const assertCurrentSession = () => {
      const current = walletRequestSessionRef.current;
      if (
        !current.authenticated ||
        current.privyUserId !== sessionSubject ||
        current.account?.toLowerCase() !== expectedAccount
      ) {
        throw new Error("The wallet session changed. Reconnect and try again");
      }
    };
    try {
      if (wallet.chainId !== appChainHex) {
        await connectedWallet.switchChain(appChain.id);
        assertCurrentSession();
      }
      const sendLocked = (execute: () => Promise<Hex>) =>
        runWithBrowserWalletRequestLock({
          sessionSubject,
          account: wallet.account,
          chainId: input.chainId,
          requestSubject: JSON.stringify(["browser-wallet-action-v1", input]),
          assertCurrentSession,
          execute,
        });
      if (isEmbeddedWallet) {
        return await sendLocked(async () => {
          const result = await sendPrivyTransaction(
            {
              to: input.to,
              data: input.data,
              value: BigInt(input.value),
              chainId: appChain.id,
            },
            {
              address: wallet.account,
              uiOptions: {
                description: "Submit the approved Custom launch on Ethereum",
                buttonText: "Launch token",
                successHeader: "Launch submitted",
              },
            },
          );
          return parseSubmittedTransactionHash(result.hash);
        });
      }
      const provider = await connectedWallet.getEthereumProvider();
      await assertExternalWalletAuthorityCurrent({
        expectedAccount: wallet.account,
        expectedChainId: appChainHex,
        networkName: appNetworkName,
        request: (method) => provider.request({ method }),
      });
      assertCurrentSession();
      return await sendLocked(async () => {
        const hash = await provider.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: wallet.account,
              to: input.to,
              data: input.data,
              value: input.value,
            },
          ],
        });
        return parseSubmittedTransactionHash(hash);
      });
    } catch (caught) {
      throw new Error(getWalletTransactionErrorMessage(caught));
    }
  }, [connectedWallet, sendPrivyTransaction, user?.id, wallet]);

  const sendCustomLaunchWalletAction = useCallback(async (
    input: CustomLaunchWalletActionV1,
  ) => {
    if (!wallet) {
      throw new Error("Connect your wallet before continuing");
    }
    const checked = assertCustomLaunchWalletActionV1(input, wallet.account);
    return sendBrowserWalletAction(checked);
  }, [sendBrowserWalletAction, wallet]);

  const sendLaunchPlanTradeWalletAction = useCallback(async (input: LaunchPlanTradeWalletInputV1) => {
    if (!connectedWallet || !wallet || !user?.id) throw new Error("Connect your trading wallet before continuing");
    const account = wallet.account; const sessionSubject = user.id;
    const assertCurrentSession = () => {
      const current = walletRequestSessionRef.current;
      if (!current.authenticated || current.privyUserId !== sessionSubject || current.account?.toLowerCase() !== account.toLowerCase()) throw new Error("The wallet session changed");
    };
    if (wallet.chainId !== robinhoodChainHex) { await connectedWallet.switchChain(robinhoodChain.id); assertCurrentSession(); }
    const provider = await connectedWallet.getEthereumProvider();
    const { prepareLaunchPlanTradeWalletV1 } = await import("@/lib/custom-launch/routed-trade-wallet-v1");
    const review = await prepareLaunchPlanTradeWalletV1(provider, account, input); assertCurrentSession();
    if (input.action === "review") return review;
    if (!input.reviewed || input.reviewed.binding !== review.binding || BigInt(review.maxGasCostWei) > BigInt(input.reviewed.maxGasCostWei)) throw new Error("The exact trade or gas cost changed. Review it again.");
    return runWithBrowserWalletRequestLock({ sessionSubject, account, chainId: "4663",
      requestSubject: JSON.stringify(["launch-plan-trade-wallet-v1", review.binding]), assertCurrentSession,
      execute: async () => {
        const fresh = await prepareLaunchPlanTradeWalletV1(provider, account, input); assertCurrentSession();
        if (fresh.binding !== review.binding || BigInt(fresh.maxGasCostWei) > BigInt(review.maxGasCostWei)) throw new Error("The exact trade changed. Refresh the review.");
        return parseSubmittedTransactionHash(await provider.request({ method: "eth_sendTransaction", params: [fresh.transaction] }));
      } });
  }, [connectedWallet, user, wallet]);

  const sendLaunchClaimWalletAction = useCallback(async (input: LaunchClaimWalletInputV1) => {
    if (!connectedWallet || !wallet || !user?.id) throw new Error("Connect the claim controller wallet before continuing");
    const controller = wallet.account; const sessionSubject = user.id;
    const assertCurrentSession = () => {
      const current = walletRequestSessionRef.current;
      if (!current.authenticated || current.privyUserId !== sessionSubject || current.account?.toLowerCase() !== controller.toLowerCase()) throw new Error("The wallet session changed");
    };
    if (wallet.chainId !== robinhoodChainHex) { await connectedWallet.switchChain(robinhoodChain.id); assertCurrentSession(); }
    const provider = await connectedWallet.getEthereumProvider();
    const { prepareLaunchClaimWalletV1 } = await import("@/lib/custom-launch/claim-handoff-v1");
    const review = await prepareLaunchClaimWalletV1(provider, controller, input);
    assertCurrentSession();
    if (input.action === "review") return review;
    if (!input.reviewed || review.binding !== input.reviewed.binding || BigInt(review.maxGasCostWei) > BigInt(input.reviewed.maxGasCostWei)) throw new Error("The claim or gas estimate changed. Review it again.");
    return runWithBrowserWalletRequestLock({ sessionSubject, account: controller, chainId: "4663",
      requestSubject: JSON.stringify(["launch-claim-wallet-v1", review.binding]), assertCurrentSession,
      execute: async () => {
        const fresh = await prepareLaunchClaimWalletV1(provider, controller, input); assertCurrentSession();
        if (fresh.binding !== review.binding || BigInt(fresh.maxGasCostWei) > BigInt(review.maxGasCostWei)) throw new Error("The claim changed. Refresh the exact wallet review.");
        return parseSubmittedTransactionHash(await provider.request({ method: "eth_sendTransaction", params: [fresh.transaction] }));
      } });
  }, [connectedWallet, user, wallet]);

  const sendUniversalLaunchWalletAction = useCallback(async (input: UniversalLaunchWalletInputV1) => {
    if (!connectedWallet || !wallet || !user?.id) throw new Error("Connect your controller wallet before continuing");
    const sessionSubject = user.id;
    const controller = wallet.account;
    const assertCurrentSession = () => {
      const current = walletRequestSessionRef.current;
      if (!current.authenticated || current.privyUserId !== sessionSubject || current.account?.toLowerCase() !== controller.toLowerCase()) {
        throw new Error("The wallet session changed. Refresh the wallet review.");
      }
    };
    if (wallet.chainId !== robinhoodChainHex) {
      await connectedWallet.switchChain(robinhoodChain.id);
      assertCurrentSession();
    }
    const provider = await connectedWallet.getEthereumProvider();
    const { prepareUniversalLaunchWalletV1 } = await import("@/lib/custom-launch/wallet-handoff-plan-v1");
    const review = await prepareUniversalLaunchWalletV1(provider, controller, input);
    assertCurrentSession();
    if (input.action === "review") return review;
    if (!input.reviewed || input.reviewed.binding !== review.binding
      || JSON.stringify(input.reviewed.transaction) !== JSON.stringify(review.transaction)
      || BigInt(review.maxGasCostWei) > BigInt(input.reviewed.maxGasCostWei)) {
      throw new Error("The transaction or gas estimate changed. Review the current cost before sending.");
    }
    return runWithBrowserWalletRequestLock({ sessionSubject, account: controller, chainId: "4663",
      requestSubject: JSON.stringify(["custom-launch-plan-wallet-v1", review.binding]), assertCurrentSession,
      execute: async () => {
        const fresh = await prepareUniversalLaunchWalletV1(provider, controller, input);
        assertCurrentSession();
        if (fresh.binding !== review.binding || JSON.stringify(fresh.transaction) !== JSON.stringify(review.transaction)
          || BigInt(fresh.maxGasCostWei) > BigInt(review.maxGasCostWei)) throw new Error("The wallet review changed. Refresh before sending.");
        return parseSubmittedTransactionHash(await provider.request({ method: "eth_sendTransaction", params: [fresh.transaction] }));
      },
    });
  }, [connectedWallet, user, wallet]);

  const sendCustomLaunchWalletActionV4 = useCallback(async (
    input: CustomLaunchWalletActionInputV4,
  ) => {
    if (!connectedWallet || !wallet) {
      throw new Error("Connect your wallet before continuing");
    }
    const sessionSubject = user?.id ?? null;
    if (sessionSubject === null) {
      throw new Error("Your wallet session expired. Reconnect and try again");
    }
    const expectedAccount = wallet.account.toLowerCase();
    const assertCurrentSession = () => {
      const current = walletRequestSessionRef.current;
      if (!current.authenticated
        || current.privyUserId !== sessionSubject
        || current.account?.toLowerCase() !== expectedAccount) {
        throw new Error("The wallet session changed. Reconnect and try again");
      }
    };
    try {
      const expected = deriveCustomLaunchWalletExpectedV4(input.reviewedResource);
      const funding = parseRobinhoodFundingReviewV1(input.reviewedResource);
      if (!funding) throw new Error("Load the exact Robinhood funding details before continuing.");
      if (wallet.chainId !== robinhoodChainHex) {
        await connectedWallet.switchChain(robinhoodChain.id);
        assertCurrentSession();
      }
      const provider = await connectedWallet.getEthereumProvider();
      const review = await prepareCustomLaunchWalletReviewV4({
        provider,
        loadFreshCapabilities: input.loadFreshCapabilities,
        loadFreshResource: async () => {
          const fresh = await input.loadFreshResource();
          const currentFunding = parseRobinhoodFundingReviewV1(fresh);
          if (!currentFunding || currentFunding.binding !== funding.binding) {
            throw new Error("The Robinhood funding details changed. Load the exact review again.");
          }
          return fresh;
        },
        expected,
      });
      assertCurrentSession();
      if (input.action === "estimate") {
        const cost = await estimateRobinhoodLaunchCostV1({ provider, review, funding });
        assertCurrentSession();
        return cost;
      }
      if (input.action !== "send" || !input.reviewedCost || !robinhoodCostMatchesReviewV1(input.reviewedCost, funding)) {
        throw new Error("Estimate and review the current Robinhood launch cost before sending.");
      }
      const reviewedCost = input.reviewedCost;
      return await runWithBrowserWalletRequestLock({
        sessionSubject,
        account: wallet.account,
        chainId: String(robinhoodChain.id),
        requestSubject: JSON.stringify([
          "custom-launch-wallet-action-v4",
          review.transactionPreimageHash,
        ]),
        assertCurrentSession,
        execute: async () => {
          const freshCost = await estimateRobinhoodLaunchCostV1({ provider, review, funding });
          assertCurrentSession();
          if (robinhoodCostRequiresReviewV1(reviewedCost, freshCost, funding)) {
            return freshCost;
          }
          const transaction = await revalidateCustomLaunchWalletRequestV4({
            provider, review, candidate: review.walletRequest,
          });
          assertCurrentSession();
          const hash = await provider.request({
            method: "eth_sendTransaction",
            params: [{
              from: transaction.from,
              to: transaction.to,
              data: transaction.data,
              value: transaction.value,
            }],
          });
          return parseSubmittedTransactionHash(hash);
        },
      });
    } catch (caught) {
      throw new Error(getWalletTransactionErrorMessage(caught));
    }
  }, [connectedWallet, user?.id, wallet]);

  const signCustomLaunchFundingAuthorization = useCallback(async (
    input: CustomLaunchFundingAuthorizationV3,
  ) => {
    if (!connectedWallet || !wallet) {
      throw new Error("Connect your wallet before continuing");
    }
    const sessionSubject = user?.id ?? null;
    if (sessionSubject === null) {
      throw new Error("Your wallet session expired. Reconnect and try again");
    }
    const expectedAccount = wallet.account.toLowerCase();
    const assertCurrentSession = () => {
      const current = walletRequestSessionRef.current;
      if (
        !current.authenticated
        || current.privyUserId !== sessionSubject
        || current.account?.toLowerCase() !== expectedAccount
      ) {
        throw new Error("The wallet session changed. Reconnect and try again");
      }
    };
    let checked = assertCustomLaunchFundingAuthorizationV3(
      input,
      wallet.account,
    );
    const mainnetChainHex = `0x${mainnet.id.toString(16)}`;
    try {
      if (normalizeChainId(wallet.chainId) !== mainnetChainHex) {
        await connectedWallet.switchChain(mainnet.id);
        assertCurrentSession();
      }
      const provider = await connectedWallet.getEthereumProvider();
      await assertExternalWalletAuthorityCurrent({
        expectedAccount: wallet.account,
        expectedChainId: mainnetChainHex,
        networkName: mainnet.name,
        request: (method) => provider.request({ method }),
      });
      assertCurrentSession();
      checked = assertCustomLaunchFundingAuthorizationV3(
        checked,
        wallet.account,
      );
      const signature = await runWithBrowserWalletRequestLock({
        sessionSubject,
        account: wallet.account,
        chainId: "1",
        requestSubject: JSON.stringify([
          "custom-launch-eip3009-funding-v1",
          customLaunchFundingReviewFingerprintV3(checked),
        ]),
        assertCurrentSession,
        execute: () => provider.request({
          method: "eth_signTypedData_v4",
          params: [
            wallet.account,
            serializeCustomLaunchFundingTypedDataV3(checked),
          ],
        }),
      });
      assertCurrentSession();
      return await verifyCustomLaunchFundingSignatureV3(checked, signature);
    } catch (caught) {
      throw new Error(getWalletTransactionErrorMessage(caught));
    }
  }, [connectedWallet, user?.id, wallet]);

  const readTradeBalances = useCallback(
    async (token: `0x${string}`) => {
      if (!connectedWallet || !wallet) {
        throw new Error("Connect your wallet before continuing");
      }
      if (!isEthereumAddress(token)) {
        throw new Error("The token address is invalid");
      }

      const provider = await connectedWallet.getEthereumProvider();
      const providerChainId = await provider.request({
        method: "eth_chainId",
      });
      if (
        typeof providerChainId !== "string" ||
        normalizeChainId(providerChainId) !== appChainHex
      ) {
        throw new Error(`Switch your wallet to ${appNetworkName}`);
      }

      const balanceOfData =
        `0x70a08231${wallet.account.slice(2).padStart(64, "0")}` as Hex;
      const [nativeBalance, tokenBalance, gasPrice] = await Promise.all([
        provider.request({
          method: "eth_getBalance",
          params: [wallet.account, "latest"],
        }),
        provider.request({
          method: "eth_call",
          params: [
            {
              to: token,
              data: balanceOfData,
            },
            "latest",
          ],
        }),
        provider.request({
          method: "eth_gasPrice",
        }),
      ]);

      return {
        nativeBalanceWei: parseRpcQuantity(nativeBalance, "ETH balance"),
        tokenBalanceRaw: parseRpcQuantity(tokenBalance, "token balance"),
        gasPriceWei: parseRpcQuantity(gasPrice, "gas price"),
      };
    },
    [connectedWallet, wallet],
  );

  const readNativeBalance = useCallback(async () => {
    if (!connectedWallet || !wallet) {
      throw new Error("Connect your wallet before continuing");
    }

    const provider = await connectedWallet.getEthereumProvider();
    const providerChainId = await provider.request({
      method: "eth_chainId",
    });
    if (
      typeof providerChainId !== "string" ||
      normalizeChainId(providerChainId) !== appChainHex
    ) {
      throw new Error(`Switch your wallet to ${appNetworkName}`);
    }

    const [nativeBalance, gasPrice] = await Promise.all([
      provider.request({
        method: "eth_getBalance",
        params: [wallet.account, "latest"],
      }),
      provider.request({
        method: "eth_gasPrice",
      }),
    ]);

    return {
      nativeBalanceWei: parseRpcQuantity(nativeBalance, "ETH balance"),
      gasPriceWei: parseRpcQuantity(gasPrice, "gas price"),
    };
  }, [connectedWallet, wallet]);

  const readConnectedAccountCode = useCallback(async () => {
    if (!connectedWallet || !wallet) {
      throw new Error("Connect your wallet before continuing");
    }

    const provider = await connectedWallet.getEthereumProvider();
    const providerChainId = await provider.request({
      method: "eth_chainId",
    });
    if (
      typeof providerChainId !== "string" ||
      normalizeChainId(providerChainId) !== appChainHex
    ) {
      throw new Error(`Switch your wallet to ${appNetworkName}`);
    }

    const code = await provider.request({
      method: "eth_getCode",
      params: [wallet.account, "latest"],
    });
    if (
      typeof code !== "string" ||
      !/^0x(?:[0-9a-fA-F]{2})*$/u.test(code)
    ) {
      throw new Error("The wallet account type could not be verified");
    }
    return code.toLowerCase() as Hex;
  }, [connectedWallet, wallet]);

  const value = useMemo<WalletContextValue>(
    () => ({
      wallet,
      walletLinked,
      username,
      avatarDataUrl,
      authReady: ready,
      sessionReady: providerSettled,
      authenticated: activeAuthenticated,
      hasSession,
      connecting:
        loginPending || (!providerSettled && !providerTimedOut),
      openingWallet: loginPending || autoAction !== null,
      disconnecting,
      switchingNetwork,
      preloadWallet: () => undefined,
      openWallet,
      openWalletWithError,
      switchNetwork: switchWalletNetwork,
      disconnect,
      getAccessToken,
      getIdentityToken: getCurrentIdentityToken,
      refreshApplicantSession,
      githubConnected,
      githubUserId,
      githubUsername,
      connectGithub,
      authorizeGithubLaunchApp,
      reauthorizeGithub,
      setUsername,
      signLaunchMessage,
      reviewPrivyPolicyOwnerRequest,
      signPrivyPolicyOwnerRequest,
      signPredictionPermit,
      signPredictionTokenPermit,
      signMainTokenMigrationPermit,
      sendBrowserWalletAction,
      sendCustomLaunchWalletAction,
      sendCustomLaunchWalletActionV4,
      sendUniversalLaunchWalletAction,
      sendLaunchPlanTradeWalletAction,
      sendLaunchClaimWalletAction,
      signCustomLaunchFundingAuthorization,
      sendTransaction,
      sendPredictionV2Transaction,
      sendModuleModeTransaction,
      readNativeBalance,
      readConnectedAccountCode,
      readTradeBalances,
    }),
    [
      activeAuthenticated,
      autoAction,
      avatarDataUrl,
      authorizeGithubLaunchApp,
      connectGithub,
      disconnect,
      disconnecting,
      getAccessToken,
      getCurrentIdentityToken,
      githubConnected,
      githubUserId,
      githubUsername,
      hasSession,
      loginPending,
      openWallet,
      openWalletWithError,
      providerTimedOut,
      readConnectedAccountCode,
      readNativeBalance,
      readTradeBalances,
      ready,
      refreshApplicantSession,
      reauthorizeGithub,
      sendBrowserWalletAction,
      sendCustomLaunchWalletAction,
      sendCustomLaunchWalletActionV4,
      sendUniversalLaunchWalletAction,
      sendLaunchPlanTradeWalletAction,
      sendLaunchClaimWalletAction,
      signCustomLaunchFundingAuthorization,
      sendPredictionV2Transaction,
      sendModuleModeTransaction,
      sendTransaction,
      signLaunchMessage,
      reviewPrivyPolicyOwnerRequest,
      signPrivyPolicyOwnerRequest,
      signPredictionPermit,
      signPredictionTokenPermit,
      signMainTokenMigrationPermit,
      switchingNetwork,
      switchWalletNetwork,
      providerSettled,
      setUsername,
      username,
      wallet,
      walletLinked,
    ],
  );

  useEffect(() => {
    onValueChange(value);
  }, [onValueChange, value]);

  return (
    <>
      <span
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {walletLoginStatus}
      </span>
      {dialogOpen && !privyModalOpen ? (
        <WalletDialog
          wallet={wallet}
          authenticated={activeAuthenticated}
          hasSession={hasSession}
          hasLinkedWallet={hasLinkedWallet}
          sessionReady={providerSettled}
          copied={copied}
          disconnecting={disconnecting}
          error={error}
          status={walletLoginStatus}
          walletOptions={walletOptions}
          onAddWallet={addWallet}
          onReconnectWallet={reconnectWallet}
          onClose={() => setDialogOpen(false)}
          onCopyAddress={copyAddress}
          onLogout={disconnect}
          onRetryLogin={openWallet}
          onSelectWallet={(account) => {
            if (!user) return;
            setSelectedWallet({ userId: user.id, address: account });
            setError("");
            setDialogOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function UnconfiguredWalletProvider({ children }: { children: ReactNode }) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const value = useMemo<WalletContextValue>(
    () => ({
      wallet: null,
      walletLinked: false,
      username: "",
      avatarDataUrl: "",
      authReady: false,
      sessionReady: false,
      authenticated: false,
      hasSession: false,
      connecting: false,
      openingWallet: false,
      disconnecting: false,
      switchingNetwork: false,
      preloadWallet: () => undefined,
      openWallet: () => setDialogOpen(true),
      openWalletWithError: () => setDialogOpen(true),
      switchNetwork: async () => false,
      disconnect: async () => false,
      getAccessToken: async () => null,
      getIdentityToken: async () => null,
      refreshApplicantSession: async () => null,
      githubConnected: false,
      githubUserId: "",
      githubUsername: "",
      connectGithub: () => setDialogOpen(true),
      authorizeGithubLaunchApp: async () => {
        throw new Error("GitHub sign-in is unavailable");
      },
      reauthorizeGithub: async () => {
        throw new Error("GitHub sign-in is unavailable");
      },
      setUsername: () => undefined,
      signLaunchMessage: async () => {
        throw new Error("Wallet sign-in is unavailable");
      },
      reviewPrivyPolicyOwnerRequest: async () => {
        throw new Error("OWNER_HANDOFF_SESSION_CHANGED");
      },
      signPrivyPolicyOwnerRequest: async () => {
        throw new Error("OWNER_HANDOFF_SESSION_CHANGED");
      },
      signPredictionPermit: async () => {
        throw new Error("Wallet sign-in is unavailable");
      },
      signPredictionTokenPermit: async () => {
        throw new Error("Wallet sign-in is unavailable");
      },
      signMainTokenMigrationPermit: async () => {
        throw new Error("Wallet sign-in is unavailable");
      },
      sendBrowserWalletAction: async () => {
        throw new Error("Wallet sign-in is unavailable");
      },
      sendCustomLaunchWalletAction: async () => {
        throw new Error("Wallet sign-in is unavailable");
      },
      sendLaunchPlanTradeWalletAction: async () => { throw new Error("Connect your trading wallet before continuing"); },
      sendLaunchClaimWalletAction: async () => { throw new Error("Connect your controller wallet before continuing"); },
      sendUniversalLaunchWalletAction: async () => { throw new Error("Connect your controller wallet before continuing"); },
      sendCustomLaunchWalletActionV4: async () => {
        throw new Error("Wallet sign-in is unavailable");
      },
      signCustomLaunchFundingAuthorization: async () => {
        throw new Error("Wallet sign-in is unavailable");
      },
      sendTransaction: async () => {
        throw new Error("Wallet sign-in is unavailable");
      },
      sendPredictionV2Transaction: async () => {
        throw new Error("Wallet sign-in is unavailable");
      },
      sendModuleModeTransaction: async () => {
        throw new Error("Wallet sign-in is unavailable");
      },
      readNativeBalance: async () => {
        throw new Error("Wallet sign-in is unavailable");
      },
      readConnectedAccountCode: async () => {
        throw new Error("Wallet sign-in is unavailable");
      },
      readTradeBalances: async () => {
        throw new Error("Wallet sign-in is unavailable");
      },
    }),
    [],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      {dialogOpen ? (
        <DialogFrame
          title="Wallet sign-in is unavailable"
          onClose={() => setDialogOpen(false)}
        >
          <p className="dialog-copy">
            Programmable uses Privy for wallet access. Please try again shortly
          </p>
          <button
            className="primary-button dialog-full-button"
            type="button"
            onClick={() => setDialogOpen(false)}
          >
            Close
          </button>
        </DialogFrame>
      ) : null}
    </WalletContext.Provider>
  );
}

function WalletDialog({
  wallet,
  authenticated,
  hasSession,
  hasLinkedWallet,
  sessionReady,
  copied,
  disconnecting,
  error,
  status,
  walletOptions,
  onAddWallet,
  onReconnectWallet,
  onClose,
  onCopyAddress,
  onLogout,
  onRetryLogin,
  onSelectWallet,
}: {
  wallet: WalletState | null;
  authenticated: boolean;
  hasSession: boolean;
  hasLinkedWallet: boolean;
  sessionReady: boolean;
  copied: boolean;
  disconnecting: boolean;
  error: string;
  status: string;
  walletOptions: readonly WalletState[];
  onAddWallet: () => void;
  onReconnectWallet: () => void;
  onClose: () => void;
  onCopyAddress: () => void;
  onLogout: () => Promise<boolean>;
  onRetryLogin: () => void;
  onSelectWallet: (account: `0x${string}`) => void;
}) {
  const title = !sessionReady ? "Wallet session" : wallet ? "Wallet" : "Connect wallet";
  const connect = authenticated
    ? hasLinkedWallet ? onReconnectWallet : onAddWallet
    : onRetryLogin;

  return (
    <DialogFrame title={title} onClose={onClose}>
      <div className={styles.content}>
        {wallet ? (
          <>
            <div className={styles.account}>
              <div>
                <span className={styles.label}>Active wallet</span>
                <strong><span>{wallet.account.slice(0, 22)}</span><span>{wallet.account.slice(22)}</span></strong>
              </div>
              <button
                className={styles.iconButton}
                type="button"
                aria-label={copied ? "Address copied" : "Copy address"}
                onClick={onCopyAddress}
              >
                {copied ? <Check aria-hidden="true" size={18} /> : <Copy aria-hidden="true" size={18} />}
              </button>
            </div>
            <dl className={styles.network}>
              <dt>Wallet network</dt>
              <dd>{getWalletNetworkLabel(wallet.chainId)}</dd>
            </dl>
            {walletOptions.length > 1 ? (
              <div className={styles.wallets} role="group" aria-label="Connected wallets">
                <span className={styles.label}>Use another wallet</span>
                {walletOptions.map((candidate) => {
                  const active = candidate.account.toLowerCase() === wallet.account.toLowerCase();
                  return (
                    <button
                      key={candidate.account.toLowerCase()}
                      className={styles.walletOption}
                      type="button"
                      aria-pressed={active}
                      disabled={active || disconnecting}
                      onClick={() => onSelectWallet(candidate.account)}
                    >
                      <span>{shortenAddress(candidate.account)}</span>
                      {active ? <Check aria-hidden="true" size={16} /> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </>
        ) : !error ? (
          <p className={styles.copy}>
            {!sessionReady
              ? "Your wallet session is still updating. Reload the page to continue."
              : authenticated && hasLinkedWallet
                ? "Connect a wallet linked to your account."
                : authenticated
                  ? "Connect a wallet to your account."
                  : "Choose a wallet to sign in with Privy."}
          </p>
        ) : null}
        {status ? <p className={styles.copy}>{status}</p> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {copied ? "Address copied" : ""}
        </span>
        <div className={styles.actions}>
          <button
            className={styles.primaryButton}
            type="button"
            disabled={disconnecting}
            onClick={!sessionReady
              ? () => window.location.reload()
              : wallet ? error ? onReconnectWallet : onAddWallet : connect}
          >
            {!sessionReady ? "Reload page" : wallet ? error ? "Reconnect wallet" : "Add wallet" : "Connect wallet"}
          </button>
          {hasSession ? (
            <button
              className={styles.signOut}
              type="button"
              disabled={disconnecting}
              onClick={() => void onLogout()}
            >
              <LogOut aria-hidden="true" size={16} />
              {disconnecting ? "Signing out" : "Sign out"}
            </button>
          ) : null}
        </div>
      </div>
    </DialogFrame>
  );
}

function DialogFrame({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    closeButtonRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={`wallet-dialog ${styles.dialog}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = event.currentTarget.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex="0"]',
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right
          || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}
    >
      <div className={styles.heading}>
        <h2 id={titleId}>{title}</h2>
        <button
          ref={closeButtonRef}
          className={styles.iconButton}
          type="button"
          aria-label="Close wallet dialog"
          onClick={onClose}
        >
          <X aria-hidden="true" size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used inside WalletProvider");
  }
  return context;
}

export function WalletButton({ compact = false }: { compact?: boolean }) {
  const {
    wallet,
    username,
    avatarDataUrl,
    authenticated,
    hasSession,
    connecting,
    openingWallet,
    disconnecting,
    disconnect,
    openWallet,
    preloadWallet,
  } = useWallet();
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuCopied, setMenuCopied] = useState(false);
  const [menuError, setMenuError] = useState("");
  const hydrationPending = connecting && !openingWallet;

  useEffect(() => {
    if (!menuOpen) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target)
      ) {
        setMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const label = disconnecting
    ? "Disconnecting"
    : openingWallet
      ? "Opening wallet"
      : hydrationPending
        ? "Loading wallet"
        : wallet
          ? username || shortenAddress(wallet.account)
          : authenticated
            ? "Connect wallet"
            : hasSession
              ? "Reconnect"
              : compact
                ? "Connect"
                : "Connect wallet";

  const button = (
    <button
      ref={menuButtonRef}
      className={
        compact
          ? `wallet-button wallet-button-compact liquid-glass-control${
              hydrationPending ? " wallet-button-hydrating" : ""
            }`
          : `wallet-button liquid-glass-control${
              hydrationPending ? " wallet-button-hydrating" : ""
            }`
      }
      type="button"
      disabled={connecting || disconnecting}
      aria-haspopup={wallet ? undefined : "dialog"}
      aria-expanded={wallet ? menuOpen : undefined}
      aria-controls={wallet ? menuId : undefined}
      aria-label={
        wallet
          ? `Manage wallet ${username || shortenAddress(wallet.account)}`
          : label
      }
      onFocus={preloadWallet}
      onPointerEnter={preloadWallet}
      onClick={() => {
        if (wallet) {
          setMenuError("");
          setMenuOpen((current) => !current);
        } else {
          openWallet();
        }
      }}
    >
      {avatarDataUrl ? (
        <Image
          className="wallet-button-avatar"
          src={avatarDataUrl}
          alt=""
          width={24}
          height={24}
          unoptimized
        />
      ) : (
        <Wallet aria-hidden="true" size={16} />
      )}
      <span aria-hidden={hydrationPending ? "true" : undefined}>
        {hydrationPending ? null : label}
      </span>
      {wallet ? (
        <ChevronDown
          className="wallet-button-chevron"
          aria-hidden="true"
          size={14}
        />
      ) : null}
    </button>
  );

  if (!wallet) return button;

  return (
    <div
      className="wallet-menu-root"
      ref={menuRef}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        ) {
          return;
        }
        window.requestAnimationFrame(() => {
          if (!menuRef.current?.contains(document.activeElement)) {
            setMenuOpen(false);
          }
        });
      }}
    >
      {button}
      <div
        className={`wallet-menu ${
          menuOpen ? "wallet-menu-open" : "wallet-menu-closed"
        }`}
        id={menuId}
        role="group"
        aria-label="Wallet actions"
        aria-hidden={!menuOpen}
      >
        <div className="wallet-menu-account">
          <strong>{username || shortenAddress(wallet.account)}</strong>
          <span>{shortenAddress(wallet.account)}</span>
        </div>
        <Link
          href="/profile"
          prefetch={false}
          tabIndex={menuOpen ? undefined : -1}
          onClick={() => setMenuOpen(false)}
        >
          Profile
        </Link>
        <Link
          href="/developers/api-keys"
          prefetch={false}
          tabIndex={menuOpen ? undefined : -1}
          onClick={() => setMenuOpen(false)}
        >
          API keys
        </Link>
        <AdminDashboardLink account={wallet.account} authenticated={authenticated}
          menuOpen={menuOpen} onNavigate={() => setMenuOpen(false)} />
        <button
          type="button"
          tabIndex={menuOpen ? undefined : -1}
          onClick={async () => {
            setMenuError("");
            try {
              await navigator.clipboard.writeText(wallet.account);
              setMenuCopied(true);
              window.setTimeout(() => setMenuCopied(false), 1500);
            } catch {
              setMenuError("Could not copy address");
            }
          }}
        >
          {menuCopied ? "Address copied" : "Copy address"}
        </button>
        <button
          className="wallet-menu-disconnect"
          type="button"
          disabled={disconnecting}
          tabIndex={menuOpen ? undefined : -1}
          onClick={() => {
            setMenuError("");
            void disconnect({ showDialogOnFailure: false }).then(
              (succeeded) => {
                if (succeeded) {
                  setMenuOpen(false);
                  return;
                }
                setMenuError("Unable to disconnect wallet. Try again.");
                setMenuOpen(true);
              },
            );
          }}
        >
          {disconnecting ? "Disconnecting" : "Disconnect"}
        </button>
        <p
          className={menuError ? undefined : "sr-only"}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {menuCopied ? "Address copied" : menuError}
        </p>
      </div>
    </div>
  );
}
