"use client";

import Image from "next/image";
import Link from "next/link";
import {
  PrivyProvider,
  useIdentityToken,
  useLinkAccount,
  useLogin,
  usePrivy,
  useSendTransaction as usePrivySendTransaction,
  useSignMessage as usePrivySignMessage,
  useWallets,
  type PrivyClientConfig,
} from "@privy-io/react-auth";
import {
  Check,
  ChevronDown,
  Copy,
  LogOut,
  Network,
  Wallet,
  X,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { mainnet, sepolia } from "viem/chains";
import { bytesToHex, hexToBytes, type Hex } from "viem";

import { parseLocalProfile } from "@/lib/profile/local-profile";
import {
  buildEip1193TransactionRequest,
  buildPrivyTransactionRequest,
  getPreparedTransactionReview,
  parseSubmittedTransactionHash,
  parsePreparedTransactionForAccount,
  type PreparedTransaction,
} from "../lib/prepared-transaction";

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

type WalletContextValue = {
  wallet: WalletState | null;
  username: string;
  avatarDataUrl: string;
  authenticated: boolean;
  hasSession: boolean;
  connecting: boolean;
  disconnecting: boolean;
  openWallet: () => void;
  disconnect: (options?: {
    showDialogOnFailure?: boolean;
  }) => Promise<boolean>;
  getAccessToken: () => Promise<string | null>;
  getIdentityToken: () => Promise<string | null>;
  githubConnected: boolean;
  githubUserId: string;
  githubUsername: string;
  connectGithub: () => void;
  setUsername: (username: string) => void;
  signLaunchMessage: (signingMessageBase64Url: string) => Promise<string>;
  sendBrowserWalletAction: (input: Readonly<{
    chainId: string;
    from: `0x${string}`;
    to: `0x${string}`;
    data: `0x${string}`;
    value: `0x${string}`;
  }>) => Promise<Hex>;
  sendTransaction: (transaction: PreparedTransaction) => Promise<Hex>;
  readNativeBalance: () => Promise<WalletNativeBalance>;
  readTradeBalances: (token: `0x${string}`) => Promise<WalletTradeBalances>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
const profileStoragePrefix = "programmable-profile";
const profileUpdatedEvent = "programmable:profile-updated";
const usernamePattern = /^[A-Za-z0-9]{3,12}$/;
const appChain =
  process.env.NEXT_PUBLIC_PROGRAMMABLE_ONCHAIN_NETWORK === "rehearsal"
    ? sepolia
    : mainnet;
const appChainHex = `0x${appChain.id.toString(16)}`;
const appNetworkName = appChain.id === sepolia.id ? "Sepolia" : "Ethereum";

export function getWalletSessionAction(ready: boolean, authenticated: boolean) {
  if (!ready) return "wait" as const;
  if (authenticated) return "manage" as const;
  return "login" as const;
}

export function isWalletProviderSettled(
  privyReady: boolean,
  walletsReady: boolean,
  authenticated: boolean,
) {
  return privyReady && (!authenticated || walletsReady);
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
  supportedChains: [appChain],
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
) {
  if (!authenticated) return undefined;
  return selectConnectedWallet(wallets, primaryAddress);
}

export function WalletProvider({ children }: { children: ReactNode }) {
  if (!privyAppId) {
    return <UnconfiguredWalletProvider>{children}</UnconfiguredWalletProvider>;
  }

  return (
    <ConfiguredWalletProvider appId={privyAppId}>
      {children}
    </ConfiguredWalletProvider>
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

function ConfiguredWalletProvider({
  appId,
  children,
}: {
  appId: string;
  children: ReactNode;
}) {
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
      <PrivyWalletBridge>{children}</PrivyWalletBridge>
    </PrivyProvider>
  );
}

function PrivyWalletBridge({ children }: { children: ReactNode }) {
  const { authenticated, getAccessToken, logout, ready, user } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { sendTransaction: sendPrivyTransaction } = usePrivySendTransaction();
  const { signMessage: signPrivyMessage } = usePrivySignMessage();
  const { ready: walletsReady, wallets } = useWallets();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [sessionSuppressed, setSessionSuppressed] = useState(false);
  const [switchingNetwork, setSwitchingNetwork] = useState(false);
  const [error, setError] = useState("");
  const [providerTimedOut, setProviderTimedOut] = useState(false);
  const [selectedWalletAddress, setSelectedWalletAddress] = useState<string | null>(null);
  const { login } = useLogin({
    onComplete: () => {
      setSessionSuppressed(false);
      setError("");
      setDialogOpen(false);
    },
    onError: (errorCode) => {
      const message = getWalletLoginErrorMessage(errorCode);
      if (!message) return;

      setError(message);
      setDialogOpen(true);
    },
  });
  const { linkGithub, linkWallet } = useLinkAccount({
    onSuccess: () => {
      setError("");
      setDialogOpen(false);
    },
    onError: (errorCode) => {
      const message = getWalletLoginErrorMessage(errorCode);
      if (!message) return;

      setError(message);
      setDialogOpen(true);
    },
  });

  const activeAuthenticated = authenticated && !sessionSuppressed;
  const githubAccount = user?.github;
  const githubConnected = Boolean(activeAuthenticated && githubAccount?.subject);
  const githubUserId = githubConnected ? githubAccount?.subject ?? "" : "";
  const githubUsername = githubConnected ? githubAccount?.username ?? "" : "";
  const connectedWallet = useMemo(() => {
    if (!activeAuthenticated) return undefined;
    const selected = selectedWalletAddress === null
      ? undefined
      : wallets.find((candidate) =>
        isEthereumAddress(candidate.address)
        && candidate.address.toLowerCase() === selectedWalletAddress.toLowerCase());
    return selected ?? selectAuthenticatedWallet(
      activeAuthenticated,
      wallets,
      user?.wallet?.address,
    );
  }, [activeAuthenticated, selectedWalletAddress, user?.wallet?.address, wallets]);
  const walletOptions = useMemo(() => {
    const seen = new Set<string>();
    return wallets.flatMap((candidate) => {
      if (!isEthereumAddress(candidate.address)) return [];
      const normalized = candidate.address.toLowerCase();
      if (seen.has(normalized)) return [];
      seen.add(normalized);
      return [Object.freeze({
        account: candidate.address,
        chainId: normalizeChainId(candidate.chainId),
      })];
    });
  }, [wallets]);

  const wallet = useMemo<WalletState | null>(() => {
    if (!connectedWallet || !isEthereumAddress(connectedWallet.address)) {
      return null;
    }

    return {
      account: connectedWallet.address,
      chainId: normalizeChainId(connectedWallet.chainId),
    };
  }, [connectedWallet]);
  const providerSettled = isWalletProviderSettled(
    ready,
    walletsReady,
    activeAuthenticated,
  );
  const hasSession = activeAuthenticated;
  const sessionAction = getWalletSessionAction(ready, activeAuthenticated);

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
    setSessionSuppressed(false);
    setError("");
    setDialogOpen(false);

    if (!ready) {
      setError(
        "Wallet access is taking longer than expected. Reload the page and try again.",
      );
      setDialogOpen(true);
      return;
    }

    login({
      loginMethods: ["wallet", "email"],
      walletChainType: "ethereum-only",
    });
  }, [login, ready]);

  const connectGithub = useCallback(() => {
    setSessionSuppressed(false);
    setError("");
    setDialogOpen(false);

    if (!ready) {
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
  }, [activeAuthenticated, githubConnected, linkGithub, login, ready]);

  const openWallet = useCallback(() => {
    setError("");

    if (sessionAction === "wait") {
      if (providerTimedOut) {
        setError(
          "Wallet access is taking longer than expected. Reload the page and try again.",
        );
        setDialogOpen(true);
      }
      return;
    }
    if (sessionAction === "manage") {
      setDialogOpen(true);
      return;
    }

    startLogin();
  }, [providerTimedOut, sessionAction, startLogin]);

  const disconnect = useCallback(async (options?: {
    showDialogOnFailure?: boolean;
  }) => {
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
  }, [authenticated, logout, wallets]);

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

  const switchToEthereum = useCallback(async () => {
    if (!connectedWallet) return;

    setSwitchingNetwork(true);
    setError("");

    try {
      await connectedWallet.switchChain(appChain.id);
    } catch {
      setError(`Unable to switch to ${appNetworkName}. Try again.`);
    } finally {
      setSwitchingNetwork(false);
    }
  }, [connectedWallet]);

  const addWallet = useCallback(() => {
    setDialogOpen(false);
    linkWallet({
      description: "Add an Ethereum wallet to Programmable",
      walletChainType: "ethereum-only",
    });
  }, [linkWallet]);

  const sendTransaction = useCallback(
    async (transaction: PreparedTransaction) => {
      if (!connectedWallet || !wallet) {
        throw new Error("Connect an Ethereum wallet before continuing");
      }
      const prepared = parsePreparedTransactionForAccount(
        transaction,
        wallet.account,
      );
      if (prepared.chainId !== appChain.id) {
        throw new Error(
          `The prepared transaction is not for ${appNetworkName}`,
        );
      }
      const isEmbeddedWallet =
        connectedWallet.walletClientType === "privy" ||
        connectedWallet.walletClientType === "privy-v2";

      try {
        if (wallet.chainId !== appChainHex) {
          await connectedWallet.switchChain(appChain.id);
        }

        if (isEmbeddedWallet) {
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
        }

        const provider = await connectedWallet.getEthereumProvider();
        const providerChainId = await provider.request({
          method: "eth_chainId",
        });
        if (
          typeof providerChainId !== "string" ||
          normalizeChainId(providerChainId) !== appChainHex
        ) {
          throw new Error(`The wallet is not connected to ${appNetworkName}`);
        }

        const hash = await provider.request({
          method: "eth_sendTransaction",
          params: [buildEip1193TransactionRequest(prepared, wallet.account)],
        });
        return parseSubmittedTransactionHash(hash);
      } catch (caught) {
        throw new Error(getWalletTransactionErrorMessage(caught));
      }
    },
    [connectedWallet, sendPrivyTransaction, wallet],
  );

  const signLaunchMessage = useCallback(async (
    signingMessageBase64Url: string,
  ) => {
    if (!connectedWallet || !wallet) {
      throw new Error("Connect an Ethereum wallet before continuing");
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
      throw new Error("Connect an Ethereum wallet before continuing");
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
    try {
      if (wallet.chainId !== appChainHex) {
        await connectedWallet.switchChain(appChain.id);
      }
      if (isEmbeddedWallet) {
        const result = await sendPrivyTransaction({
          to: input.to,
          data: input.data,
          value: BigInt(input.value),
          chainId: appChain.id,
        }, {
          address: wallet.account,
          uiOptions: {
            description: "Submit the approved Custom launch on Ethereum",
            buttonText: "Launch token",
            successHeader: "Launch submitted",
          },
        });
        return parseSubmittedTransactionHash(result.hash);
      }
      const provider = await connectedWallet.getEthereumProvider();
      await assertExternalWalletAuthorityCurrent({
        expectedAccount: wallet.account,
        expectedChainId: appChainHex,
        networkName: appNetworkName,
        request: (method) => provider.request({ method }),
      });
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [{
          from: wallet.account,
          to: input.to,
          data: input.data,
          value: input.value,
        }],
      });
      return parseSubmittedTransactionHash(hash);
    } catch (caught) {
      throw new Error(getWalletTransactionErrorMessage(caught));
    }
  }, [connectedWallet, sendPrivyTransaction, wallet]);

  const readTradeBalances = useCallback(
    async (token: `0x${string}`) => {
      if (!connectedWallet || !wallet) {
        throw new Error("Connect an Ethereum wallet before continuing");
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
      throw new Error("Connect an Ethereum wallet before continuing");
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

  const value = useMemo<WalletContextValue>(
    () => ({
      wallet,
      username,
      avatarDataUrl,
      authenticated: activeAuthenticated,
      hasSession,
      connecting: !providerSettled && !providerTimedOut,
      disconnecting,
      openWallet,
      disconnect,
      getAccessToken,
      getIdentityToken: async () => identityToken,
      githubConnected,
      githubUserId,
      githubUsername,
      connectGithub,
      setUsername,
      signLaunchMessage,
      sendBrowserWalletAction,
      sendTransaction,
      readNativeBalance,
      readTradeBalances,
    }),
    [
      activeAuthenticated,
      avatarDataUrl,
      connectGithub,
      disconnect,
      disconnecting,
      getAccessToken,
      githubConnected,
      githubUserId,
      githubUsername,
      hasSession,
      identityToken,
      openWallet,
      providerTimedOut,
      readNativeBalance,
      readTradeBalances,
      sendBrowserWalletAction,
      sendTransaction,
      signLaunchMessage,
      providerSettled,
      setUsername,
      username,
      wallet,
    ],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      {dialogOpen ? (
        <WalletDialog
          wallet={wallet}
          authenticated={activeAuthenticated}
          hasSession={hasSession}
          copied={copied}
          disconnecting={disconnecting}
          error={error}
          switchingNetwork={switchingNetwork}
          walletOptions={walletOptions}
          onAddWallet={addWallet}
          onClose={() => setDialogOpen(false)}
          onCopyAddress={copyAddress}
          onLogout={disconnect}
          onRetryLogin={startLogin}
          onSelectWallet={(account) => {
            setSelectedWalletAddress(account);
            setError("");
            setDialogOpen(false);
          }}
          onSwitchNetwork={switchToEthereum}
        />
      ) : null}
    </WalletContext.Provider>
  );
}

function UnconfiguredWalletProvider({ children }: { children: ReactNode }) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const value = useMemo<WalletContextValue>(
    () => ({
      wallet: null,
      username: "",
      avatarDataUrl: "",
      authenticated: false,
      hasSession: false,
      connecting: false,
      disconnecting: false,
      openWallet: () => setDialogOpen(true),
      disconnect: async () => false,
      getAccessToken: async () => null,
      getIdentityToken: async () => null,
      githubConnected: false,
      githubUserId: "",
      githubUsername: "",
      connectGithub: () => setDialogOpen(true),
      setUsername: () => undefined,
      signLaunchMessage: async () => {
        throw new Error("Wallet sign-in is unavailable");
      },
      sendBrowserWalletAction: async () => {
        throw new Error("Wallet sign-in is unavailable");
      },
      sendTransaction: async () => {
        throw new Error("Wallet sign-in is unavailable");
      },
      readNativeBalance: async () => {
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
          eyebrow="Wallet"
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
  copied,
  disconnecting,
  error,
  switchingNetwork,
  walletOptions,
  onAddWallet,
  onClose,
  onCopyAddress,
  onLogout,
  onRetryLogin,
  onSelectWallet,
  onSwitchNetwork,
}: {
  wallet: WalletState | null;
  authenticated: boolean;
  hasSession: boolean;
  copied: boolean;
  disconnecting: boolean;
  error: string;
  switchingNetwork: boolean;
  walletOptions: readonly WalletState[];
  onAddWallet: () => void;
  onClose: () => void;
  onCopyAddress: () => void;
  onLogout: () => Promise<boolean>;
  onRetryLogin: () => void;
  onSelectWallet: (account: `0x${string}`) => void;
  onSwitchNetwork: () => void;
}) {
  const title = wallet
    ? "Connected account"
    : authenticated
      ? "Complete wallet setup"
      : error
        ? "Wallet connection failed"
        : "Finish wallet connection";

  return (
    <DialogFrame eyebrow="Wallet" title={title} onClose={onClose}>
      {wallet ? (
        <div className="connected-wallet">
          <div className="wallet-account-row">
            <strong>{shortenAddress(wallet.account)}</strong>
          </div>

          {walletOptions.length > 1 ? (
            <div className="wallet-switcher" aria-label="Connected wallets">
              <span>Use another wallet</span>
              <div>
                {walletOptions.map((candidate) => {
                  const active = candidate.account.toLowerCase()
                    === wallet.account.toLowerCase();
                  return (
                    <button
                      key={candidate.account.toLowerCase()}
                      className="wallet-switch-option"
                      type="button"
                      aria-pressed={active}
                      disabled={active}
                      onClick={() => onSelectWallet(candidate.account)}
                    >
                      <span>{shortenAddress(candidate.account)}</span>
                      <small>{candidate.chainId === appChainHex ? appNetworkName : candidate.chainId}</small>
                      {active ? <Check aria-hidden="true" size={15} /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {wallet.chainId !== appChainHex ? (
            <div className="wallet-network-warning">
              <p className="inline-notice warning-notice">
                Programmable uses {appNetworkName} for this release
              </p>
              <button
                className="secondary-button"
                type="button"
                disabled={switchingNetwork}
                onClick={onSwitchNetwork}
              >
                <Network aria-hidden="true" size={16} />
                {switchingNetwork ? "Switching" : `Switch to ${appNetworkName}`}
              </button>
            </div>
          ) : null}

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <span
            className="sr-only"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {copied ? "Address copied" : ""}
          </span>

          <div className="dialog-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={onAddWallet}
            >
              <Wallet aria-hidden="true" size={16} />
              Add wallet
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={onCopyAddress}
            >
              {copied ? (
                <Check aria-hidden="true" size={16} />
              ) : (
                <Copy aria-hidden="true" size={16} />
              )}
              {copied ? "Copied" : "Copy address"}
            </button>
            <button
              className="text-button danger-text"
              type="button"
              disabled={disconnecting}
              onClick={() => void onLogout()}
            >
              <LogOut aria-hidden="true" size={16} />
              {disconnecting ? "Disconnecting" : "Disconnect wallet"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="dialog-copy">
            {authenticated
              ? "Add an Ethereum wallet before launching or managing a token"
              : hasSession
                ? "The wallet connected, but sign-in was not completed"
                : "Connect an Ethereum wallet to continue"}
          </p>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <button
            className="primary-button dialog-full-button"
            type="button"
            onClick={authenticated ? onAddWallet : onRetryLogin}
          >
            <Wallet aria-hidden="true" size={16} />
            {authenticated ? "Add wallet" : "Try again"}
          </button>
          {hasSession ? (
            <button
              className="text-button dialog-logout-button danger-text"
              type="button"
              disabled={disconnecting}
              onClick={() => void onLogout()}
            >
              {disconnecting ? "Disconnecting" : "Disconnect wallet"}
            </button>
          ) : null}
        </>
      )}
    </DialogFrame>
  );
}

function DialogFrame({
  eyebrow,
  title,
  onClose,
  children,
}: {
  eyebrow: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );

      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, []);

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="wallet-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-dialog-title"
      >
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2 id="wallet-dialog-title">{title}</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="icon-button"
            type="button"
            aria-label="Close wallet dialog"
            onClick={onClose}
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>
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
    disconnecting,
    disconnect,
    openWallet,
  } = useWallet();
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuCopied, setMenuCopied] = useState(false);
  const [menuError, setMenuError] = useState("");

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
    : connecting
      ? compact
        ? "Connect"
        : "Connect wallet"
      : wallet
        ? username || shortenAddress(wallet.account)
        : authenticated
          ? "Set up wallet"
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
          ? "wallet-button wallet-button-compact liquid-glass-control"
          : "wallet-button liquid-glass-control"
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
      <span>{label}</span>
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
      {menuOpen ? (
        <div
          className="wallet-menu"
          id={menuId}
          role="group"
          aria-label="Wallet actions"
        >
          <div className="wallet-menu-account">
            <strong>{username || shortenAddress(wallet.account)}</strong>
            <span>{shortenAddress(wallet.account)}</span>
          </div>
          <Link
            href="/profile"
            onClick={() => setMenuOpen(false)}
          >
            Profile
          </Link>
          <button
            type="button"
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
      ) : null}
    </div>
  );
}
