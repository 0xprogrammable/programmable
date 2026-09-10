import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import * as walletProvider from "../components/wallet-provider";
import { ApplicantRefreshUserUnavailableErrorV1 } from
  "../lib/custom-launch/applicant-refresh-user-gate-v1";

type WalletProviderContract = {
  shouldEagerLoadWalletRuntime: (pathname: string) => boolean;
  shouldBackgroundLoadWalletRuntime: (
    pathname: string,
    hasPersistedSessionHint: boolean,
  ) => boolean;
  isPersistedWalletSessionHint: (value: string | null) => boolean;
  assertExternalWalletAuthorityCurrent: (input: Readonly<{
    expectedAccount: `0x${string}`;
    expectedChainId: string;
    networkName: string;
    request: (method: "eth_chainId" | "eth_accounts") => Promise<unknown>;
  }>) => Promise<void>;
  getWalletSessionAction: (
    ready: boolean,
    authenticated: boolean,
  ) => "wait" | "login" | "manage";
  getWalletOpenAction: (
    sessionAction: "wait" | "login" | "manage",
    hasWallet: boolean,
  ) => "wait" | "login" | "link" | "manage";
  isWalletProviderSettled: (
    privyReady: boolean,
    walletsReady: boolean,
    authenticated: boolean,
  ) => boolean;
  resolveWalletIdentityToken: (input: Readonly<{
    authenticated: boolean;
    cachedIdentityToken: string | null;
    loadIdentityToken: () => Promise<string | null>;
  }>) => Promise<string | null>;
  selectAuthenticatedWallet: <T extends {
    address: string;
    connectedAt: number;
    linked: boolean;
    walletClientType: string;
  }>(
    authenticated: boolean,
    wallets: readonly T[],
    primaryAddress?: string,
  ) => T | undefined;
  selectLinkedWallet: <T extends {
    address: string;
    connectedAt: number;
    linked: boolean;
    walletClientType: string;
  }>(
    wallets: readonly T[],
    primaryAddress?: string,
  ) => T | undefined;
  getWalletProfileStorageKey: (account: string) => string;
  readUsernameFromProfileValue: (value: string | null) => string;
  getWalletLoginErrorMessage: (errorCode: string) => string;
  getWalletTransactionErrorMessage: (error: unknown) => string;
  getWalletDisconnectOutcome: (succeeded: boolean) => {
    dialogOpen: boolean;
    error: string;
    sessionSuppressed: boolean;
  };
  executeWalletDisconnect: (input: {
    authenticated: boolean;
    logout: () => Promise<unknown>;
    disconnectProviderWallets: () => Promise<boolean>;
    markAppDisconnected: () => void;
  }) => Promise<boolean>;
  selectConnectedWallet: <T extends {
    address: string;
    connectedAt: number;
    linked: boolean;
    walletClientType: string;
  }>(
    wallets: readonly T[],
    primaryAddress?: string,
  ) => T | undefined;
};

const subject = walletProvider as unknown as WalletProviderContract;

const APPLICANT_PRIVY_USER_ID = "did:privy:approved";
const APPLICANT_GITHUB_USER_ID = "100000001";
const APPLICANT_GITHUB_LOGIN = "applicant-alpha";
const APPLICANT_WALLET = `0x${"a".repeat(40)}` as const;
const OTHER_WALLET = `0x${"b".repeat(40)}` as const;
const applicantRequirement = Object.freeze({
  githubUserId: APPLICANT_GITHUB_USER_ID,
  githubLogin: APPLICANT_GITHUB_LOGIN,
  launchWallet: APPLICANT_WALLET,
});

type ApplicantLinkedAccountFixture = {
  type: string;
  subject?: string;
  username?: string | null;
  address?: string;
  chainType?: string;
};

function applicantAuthority(overrides?: Partial<{
  privyUserId: string | null;
  githubUserId: string | null;
  githubLogin: string | null;
  walletAddress: string | null;
  linkedAccountsFingerprint: string | null;
}>) {
  return {
    privyUserId: APPLICANT_PRIVY_USER_ID,
    githubUserId: APPLICANT_GITHUB_USER_ID,
    githubLogin: APPLICANT_GITHUB_LOGIN,
    walletAddress: APPLICANT_WALLET,
    linkedAccountsFingerprint: "linked-accounts:v1",
    ...overrides,
  };
}

function applicantUser(overrides?: Partial<{
  id: string;
  githubUserId: string;
  githubLogin: string;
  wallet: `0x${string}`;
}>) {
  const id = overrides?.id ?? APPLICANT_PRIVY_USER_ID;
  const githubUserId = overrides?.githubUserId ?? APPLICANT_GITHUB_USER_ID;
  const githubLogin = overrides?.githubLogin ?? APPLICANT_GITHUB_LOGIN;
  const wallet = overrides?.wallet ?? APPLICANT_WALLET;
  const linkedAccounts: ApplicantLinkedAccountFixture[] = [
    {
      type: "github_oauth",
      subject: githubUserId,
      username: githubLogin,
    },
    {
      type: "wallet",
      chainType: "ethereum",
      address: wallet,
    },
  ];
  return {
    id,
    github: {
      subject: githubUserId,
      username: githubLogin,
    },
    linkedAccounts,
  };
}

describe("wallet recovery state", () => {
  it("hydrates wallet-critical routes eagerly", () => {
    for (const pathname of [
      "/launch",
      "/launch/review",
      "/migration",
      "/profile",
      "/profile/settings",
      "/token/0x7987f03462200b3d8a072e02c89a8a41dcb124ee",
      "/admin/partners",
      "/admin/modules",
    ]) {
      expect(subject.shouldEagerLoadWalletRuntime(pathname)).toBe(true);
      expect(subject.shouldBackgroundLoadWalletRuntime(pathname, true)).toBe(false);
    }
  });

  it("idle-loads browse-only routes only for a confirmed persisted session", () => {
    for (const pathname of ["/", "/explore", "/docs", "/docs/creators"]) {
      expect(subject.shouldEagerLoadWalletRuntime(pathname)).toBe(false);
      expect(subject.shouldBackgroundLoadWalletRuntime(pathname, false)).toBe(false);
      expect(subject.shouldBackgroundLoadWalletRuntime(pathname, true)).toBe(true);
    }
    expect(subject.isPersistedWalletSessionHint("authenticated")).toBe(true);
    expect(subject.isPersistedWalletSessionHint("true")).toBe(false);
    expect(subject.isPersistedWalletSessionHint(null)).toBe(false);
  });

  it("keeps Privy behind an explicit dynamic runtime boundary", () => {
    const provider = readFileSync(
      join(process.cwd(), "components/wallet-provider.tsx"),
      "utf8",
    );
    const runtime = readFileSync(
      join(process.cwd(), "components/wallet-provider-runtime.ts"),
      "utf8",
    );
    const navigation = readFileSync(
      join(process.cwd(), "components/site-navigation.tsx"),
      "utf8",
    );

    expect(provider).toContain('import("./wallet-provider-runtime")');
    expect(provider).toContain("onPointerEnter={preloadWallet}");
    expect(provider).toContain("onFocus={preloadWallet}");
    expect(provider).toContain("scheduleWalletRuntimeIdlePreload(preload)");
    expect(provider).toContain("window.requestIdleCallback(preload");
    expect(provider).toContain("configuredValue={configuredValue}");
    expect(provider).not.toContain("linkedWalletOnly");
    expect(provider).toContain("onValueChange={acceptConfiguredValue}");
    expect(provider).toContain(
      "const ConfiguredWalletProvider = memo(function ConfiguredWalletProvider",
    );
    expect(provider).not.toContain("if (!runtime) {");
    expect(provider).toMatch(/openingWallet\s*\?\s*"Opening wallet"/u);
    expect(provider).toMatch(/hydrationPending\s*\?\s*"Loading wallet"/u);
    expect(provider).toContain("wallet-button-hydrating");
    expect(navigation).toMatch(
      /className=\{styles\.headerWalletButton\}[\s\S]{0,600}onFocus=\{preloadWallet\}[\s\S]{0,120}onPointerEnter=\{preloadWallet\}/u,
    );
    expect(provider).not.toMatch(
      /import\s*\{[\s\S]*?PrivyProvider[\s\S]*?\}\s*from\s*["']@privy-io\/react-auth["']/u,
    );
    expect(runtime).toContain('from "@privy-io/react-auth"');
  });

  it("refreshes an authenticated Privy identity token when hook hydration is still null", async () => {
    const loadIdentityToken = vi.fn(async () => "fresh-identity-token");

    await expect(subject.resolveWalletIdentityToken({
      authenticated: true,
      cachedIdentityToken: null,
      loadIdentityToken,
    })).resolves.toBe("fresh-identity-token");
    expect(loadIdentityToken).toHaveBeenCalledTimes(1);
  });

  it("does not retrieve an identity token for an unauthenticated session", async () => {
    const loadIdentityToken = vi.fn(async () => "unexpected-token");

    await expect(subject.resolveWalletIdentityToken({
      authenticated: false,
      cachedIdentityToken: null,
      loadIdentityToken,
    })).resolves.toBeNull();
    expect(loadIdentityToken).not.toHaveBeenCalled();
  });

  it("keeps identity-token retrieval failures fail closed", async () => {
    await expect(subject.resolveWalletIdentityToken({
      authenticated: true,
      cachedIdentityToken: null,
      loadIdentityToken: async () => null,
    })).resolves.toBeNull();
    await expect(subject.resolveWalletIdentityToken({
      authenticated: true,
      cachedIdentityToken: null,
      loadIdentityToken: async () => {
        throw new Error("Privy unavailable");
      },
    })).resolves.toBeNull();
  });

  it("uses the Privy hook token without reading browser storage or refreshing", async () => {
    const loadIdentityToken = vi.fn(async () => "unexpected-token");

    await expect(subject.resolveWalletIdentityToken({
      authenticated: true,
      cachedIdentityToken: "hook-identity-token",
      loadIdentityToken,
    })).resolves.toBe("hook-identity-token");
    expect(loadIdentityToken).not.toHaveBeenCalled();
  });

  it("pins Privy 3.35.2 refreshUser to updateUserAndIdToken before Applicant tokens", () => {
    const packageRoot = join(
      process.cwd(),
      "node_modules/@privy-io/react-auth",
    );
    const packageJson = JSON.parse(readFileSync(
      join(packageRoot, "package.json"),
      "utf8",
    )) as { version?: unknown };
    const dts = readFileSync(join(packageRoot, "dist/dts/index.d.ts"), "utf8");
    const cjsIndex = readFileSync(join(packageRoot, "dist/cjs/index.js"), "utf8");
    const implementationFile = cjsIndex.match(/require\("\.\/(index-[^"]+\.js)"\)/u)?.[1];
    expect(packageJson.version).toBe("3.35.2");
    expect(dts).toContain("refreshUser: () => Promise<User>");
    expect(implementationFile).toBeTypeOf("string");
    const implementation = readFileSync(
      join(packageRoot, "dist/cjs", implementationFile!),
      "utf8",
    );
    expect(implementation).toContain("updateUserAndIdToken");
    const provider = readFileSync(
      join(process.cwd(), "components/wallet-provider.tsx"),
      "utf8",
    );
    expect(provider).toContain("const { refreshUser } = useUser();");
    expect(provider).toContain(
      "getIdentityToken: async () => applicantIdentityTokenRef.current",
    );
    expect(provider).toContain(
      "changing the callback identity would restart\n  // the discovery effect",
    );
    expect(provider).toContain("perform a second `/users/me` read");
    expect(provider).not.toContain(
      "getIdentityToken: getPrivyIdentityToken,\n        requirement,",
    );
    expect(provider).toContain("const { reauthorize } = useOAuthTokens();");
    expect(provider).toContain('await reauthorize({ provider: "github" });');
    expect(provider).not.toContain("onOAuthTokenGrant");
  });

  it("does not refresh or acquire tokens before authentication is current", async () => {
    const refreshUser = vi.fn(async () => applicantUser());
    const getAccessToken = vi.fn(async () => "unexpected-access");
    const getIdentityToken = vi.fn(async () => "unexpected-identity");
    await expect(walletProvider.refreshWalletApplicantSessionV1({
      authenticated: false,
      readCurrentAuthority: applicantAuthority,
      refreshUser,
      getAccessToken,
      getIdentityToken,
      requirement: applicantRequirement,
    })).resolves.toBeNull();
    expect(refreshUser).not.toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(getIdentityToken).not.toHaveBeenCalled();
  });

  it("rejects malformed numeric GitHub subjects before refresh or token I/O", async () => {
    for (const input of [
      { readCurrentAuthority: () => applicantAuthority({ githubUserId: "github-user" }) },
      {
        readCurrentAuthority: applicantAuthority,
        requirement: { ...applicantRequirement, githubUserId: "0" },
      },
    ]) {
      const refreshUser = vi.fn(async () => applicantUser());
      const getAccessToken = vi.fn(async () => "unexpected-access");
      const getIdentityToken = vi.fn(async () => "unexpected-identity");
      await expect(walletProvider.refreshWalletApplicantSessionV1({
        authenticated: true,
        readCurrentAuthority: input.readCurrentAuthority,
        refreshUser,
        getAccessToken,
        getIdentityToken,
        requirement: "requirement" in input
          ? input.requirement
          : applicantRequirement,
      })).resolves.toBeNull();
      expect(refreshUser).not.toHaveBeenCalled();
      expect(getAccessToken).not.toHaveBeenCalled();
      expect(getIdentityToken).not.toHaveBeenCalled();
    }
  });

  it("refreshes user before tokens and binds the exact GitHub identity and linked wallet", async () => {
    const events: string[] = [];
    const authority = applicantAuthority();
    const session = await walletProvider.refreshWalletApplicantSessionV1({
      authenticated: true,
      readCurrentAuthority: () => authority,
      refreshUser: async () => {
        events.push("refresh-user");
        return applicantUser();
      },
      getAccessToken: async () => {
        events.push("access-token");
        return "access-token";
      },
      getIdentityToken: async () => {
        events.push("identity-token");
        return "identity-token";
      },
      requirement: applicantRequirement,
    });

    expect(events).toEqual([
      "refresh-user",
      "access-token",
      "identity-token",
    ]);
    expect(session).toEqual({
      accessToken: "access-token",
      identityToken: "identity-token",
      privyUserId: APPLICANT_PRIVY_USER_ID,
      githubUserId: APPLICANT_GITHUB_USER_ID,
      githubLogin: APPLICANT_GITHUB_LOGIN,
      launchWallet: APPLICANT_WALLET,
    });
  });

  it("rejects missing refresh results and refresh failures before token acquisition", async () => {
    for (const refreshUser of [
      async () => undefined,
      async () => null,
      async () => { throw new Error("refresh failed"); },
    ]) {
      const getAccessToken = vi.fn(async () => "unexpected-access");
      const getIdentityToken = vi.fn(async () => "unexpected-identity");
      await expect(walletProvider.refreshWalletApplicantSessionV1({
        authenticated: true,
        readCurrentAuthority: applicantAuthority,
        refreshUser,
        getAccessToken,
        getIdentityToken,
        requirement: applicantRequirement,
      })).resolves.toBeNull();
      expect(getAccessToken).not.toHaveBeenCalled();
      expect(getIdentityToken).not.toHaveBeenCalled();
    }
  });

  it("preserves provider rate limits as retryable capacity state", async () => {
    const getAccessToken = vi.fn(async () => "unexpected-access");
    const getIdentityToken = vi.fn(async () => "unexpected-identity");

    await expect(walletProvider.refreshWalletApplicantSessionV1({
      authenticated: true,
      readCurrentAuthority: applicantAuthority,
      refreshUser: async () => {
        throw new ApplicantRefreshUserUnavailableErrorV1();
      },
      getAccessToken,
      getIdentityToken,
      requirement: applicantRequirement,
    })).rejects.toBeInstanceOf(ApplicantRefreshUserUnavailableErrorV1);
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(getIdentityToken).not.toHaveBeenCalled();
  });

  it("rejects wrong or missing identity and wallet data before token acquisition", async () => {
    const candidates = [
      { id: APPLICANT_PRIVY_USER_ID, linkedAccounts: [] },
      applicantUser({ id: "did:privy:other" }),
      applicantUser({ githubUserId: "1" }),
      applicantUser({ githubLogin: "other-user" }),
      applicantUser({ wallet: OTHER_WALLET }),
    ];
    for (const refreshedUser of candidates) {
      const getAccessToken = vi.fn(async () => "unexpected-access");
      const getIdentityToken = vi.fn(async () => "unexpected-identity");
      await expect(walletProvider.refreshWalletApplicantSessionV1({
        authenticated: true,
        readCurrentAuthority: applicantAuthority,
        refreshUser: async () => refreshedUser,
        getAccessToken,
        getIdentityToken,
        requirement: applicantRequirement,
      })).resolves.toBeNull();
      expect(getAccessToken).not.toHaveBeenCalled();
      expect(getIdentityToken).not.toHaveBeenCalled();
    }
  });

  it("rejects a same-DID GitHub switch even without an exact lane requirement", async () => {
    const getAccessToken = vi.fn(async () => "unexpected-access");
    const getIdentityToken = vi.fn(async () => "unexpected-identity");
    await expect(walletProvider.refreshWalletApplicantSessionV1({
      authenticated: true,
      readCurrentAuthority: applicantAuthority,
      refreshUser: async () => applicantUser({
        githubUserId: "999",
        githubLogin: "other-user",
      }),
      getAccessToken,
      getIdentityToken,
    })).resolves.toBeNull();
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(getIdentityToken).not.toHaveBeenCalled();
  });

  it("rejects ambiguous GitHub linkage and account reload drift before any request", async () => {
    const ambiguous = applicantUser();
    ambiguous.linkedAccounts.push({
      type: "github_oauth",
      subject: "999",
      username: "other-user",
    });
    const getAccessToken = vi.fn(async () => "unexpected-access");
    const getIdentityToken = vi.fn(async () => "unexpected-identity");
    await expect(walletProvider.refreshWalletApplicantSessionV1({
      authenticated: true,
      readCurrentAuthority: applicantAuthority,
      refreshUser: async () => ambiguous,
      getAccessToken,
      getIdentityToken,
      requirement: applicantRequirement,
    })).resolves.toBeNull();
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(getIdentityToken).not.toHaveBeenCalled();

    let readCount = 0;
    await expect(walletProvider.refreshWalletApplicantSessionV1({
      authenticated: true,
      readCurrentAuthority: () => {
        readCount += 1;
        return readCount === 1
          ? applicantAuthority()
          : applicantAuthority({ walletAddress: OTHER_WALLET });
      },
      refreshUser: async () => applicantUser(),
      getAccessToken,
      getIdentityToken,
      requirement: applicantRequirement,
    })).resolves.toBeNull();
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(getIdentityToken).not.toHaveBeenCalled();

    readCount = 0;
    await expect(walletProvider.refreshWalletApplicantSessionV1({
      authenticated: true,
      readCurrentAuthority: () => {
        readCount += 1;
        return readCount === 1
          ? applicantAuthority()
          : applicantAuthority({
            linkedAccountsFingerprint: "linked-accounts:v2",
          });
      },
      refreshUser: async () => applicantUser(),
      getAccessToken,
      getIdentityToken,
      requirement: applicantRequirement,
    })).resolves.toBeNull();
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(getIdentityToken).not.toHaveBeenCalled();
  });

  it("acquires each token once after refresh and rejects either null without retry", async () => {
    for (const tokens of [
      { access: null, identity: "identity-token" },
      { access: "access-token", identity: null },
    ] as const) {
      const getAccessToken = vi.fn(async () => tokens.access);
      const getIdentityToken = vi.fn(async () => tokens.identity);
      await expect(walletProvider.refreshWalletApplicantSessionV1({
        authenticated: true,
        readCurrentAuthority: applicantAuthority,
        refreshUser: async () => applicantUser(),
        getAccessToken,
        getIdentityToken,
        requirement: applicantRequirement,
      })).resolves.toBeNull();
      expect(getAccessToken).toHaveBeenCalledTimes(1);
      expect(getIdentityToken).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects account drift detected only after token acquisition", async () => {
    let readCount = 0;
    const getAccessToken = vi.fn(async () => "access-token");
    const getIdentityToken = vi.fn(async () => "identity-token");
    await expect(walletProvider.refreshWalletApplicantSessionV1({
      authenticated: true,
      readCurrentAuthority: () => {
        readCount += 1;
        return readCount < 3
          ? applicantAuthority()
          : applicantAuthority({ githubLogin: "other-user" });
      },
      refreshUser: async () => applicantUser(),
      getAccessToken,
      getIdentityToken,
      requirement: applicantRequirement,
    })).resolves.toBeNull();
    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(getIdentityToken).toHaveBeenCalledTimes(1);
  });

  it.each([4663, "4663", "0x1237", "0x01237", "eip155:4663"])("accepts Robinhood provider chain ID %s before a wallet action", async (chainId) => {
    const request = vi.fn(async (method: "eth_chainId" | "eth_accounts") =>
      method === "eth_chainId" ? chainId : [`0x${"a".repeat(40)}`]);
    await expect(subject.assertExternalWalletAuthorityCurrent({
      expectedAccount: `0x${"a".repeat(40)}`,
      expectedChainId: "0x1237",
      networkName: "Robinhood Chain",
      request,
    })).resolves.toBeUndefined();
    expect(request.mock.calls.map(([method]) => method)).toEqual(["eth_chainId", "eth_accounts"]);
  });

  it("fails closed when an external provider mutates chain before a wallet action", async () => {
    const request = vi.fn(async (method: "eth_chainId" | "eth_accounts") =>
      method === "eth_chainId"
        ? "0xaa36a7"
        : [`0x${"a".repeat(40)}`]
    );

    await expect(subject.assertExternalWalletAuthorityCurrent({
      expectedAccount: `0x${"a".repeat(40)}`,
      expectedChainId: "0x1",
      networkName: "Ethereum",
      request,
    })).rejects.toThrow("not connected to Ethereum");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("eth_chainId");
  });

  it("fails closed when an external provider mutates account before a wallet action", async () => {
    const request = vi.fn(async (method: "eth_chainId" | "eth_accounts") =>
      method === "eth_chainId"
        ? "0x1"
        : [`0x${"b".repeat(40)}`]
    );

    await expect(subject.assertExternalWalletAuthorityCurrent({
      expectedAccount: `0x${"a".repeat(40)}`,
      expectedChainId: "0x1",
      networkName: "Ethereum",
      request,
    })).rejects.toThrow("active wallet account changed");
    expect(request.mock.calls.map(([method]) => method)).toEqual([
      "eth_chainId",
      "eth_accounts",
    ]);
  });

  it("does not treat a detected browser wallet as an authenticated app session", () => {
    expect(subject.getWalletSessionAction).toBeTypeOf("function");
    expect(subject.getWalletSessionAction(true, false)).toBe("login");
  });

  it("opens login only when Privy is ready and no recoverable session exists", () => {
    expect(subject.getWalletSessionAction).toBeTypeOf("function");
    expect(subject.getWalletSessionAction(false, false)).toBe("wait");
    expect(subject.getWalletSessionAction(true, false)).toBe("login");
    expect(subject.getWalletSessionAction(true, true)).toBe("manage");
  });

  it("opens Privy directly when an authenticated session still needs a wallet", () => {
    expect(subject.getWalletOpenAction).toBeTypeOf("function");
    expect(subject.getWalletOpenAction("wait", false)).toBe("wait");
    expect(subject.getWalletOpenAction("login", false)).toBe("login");
    expect(subject.getWalletOpenAction("manage", false)).toBe("link");
    expect(subject.getWalletOpenAction("manage", true)).toBe("manage");
  });

  it("does not block login while the unauthenticated wallet list is still loading", () => {
    expect(subject.isWalletProviderSettled).toBeTypeOf("function");
    expect(subject.isWalletProviderSettled(true, false, false)).toBe(true);
    expect(subject.getWalletSessionAction(true, false)).toBe("login");
    expect(subject.isWalletProviderSettled(true, false, true)).toBe(false);
  });

  it("uses the lowercase wallet-scoped profile key", () => {
    expect(subject.getWalletProfileStorageKey).toBeTypeOf("function");
    expect(
      subject.getWalletProfileStorageKey(
        "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
      ),
    ).toBe(
      "programmable-profile:0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    );
  });

  it("accepts only a valid username from the stored profile", () => {
    expect(subject.readUsernameFromProfileValue).toBeTypeOf("function");
    expect(
      subject.readUsernameFromProfileValue(
        JSON.stringify({ username: "Bloom36", bio: "preserved" }),
      ),
    ).toBe("Bloom36");
    expect(
      subject.readUsernameFromProfileValue(
        JSON.stringify({ username: "not valid" }),
      ),
    ).toBe("");
    expect(subject.readUsernameFromProfileValue("{broken")).toBe("");
  });

  it("turns Privy failures into a clean retry message without treating cancellation as an error", () => {
    expect(subject.getWalletLoginErrorMessage).toBeTypeOf("function");
    expect(
      subject.getWalletLoginErrorMessage("generic_connect_wallet_error"),
    ).toBe("Unable to connect wallet. Try again.");
    expect(subject.getWalletLoginErrorMessage("exited_auth_flow")).toBe("");
    expect(subject.getWalletLoginErrorMessage("exited_link_flow")).toBe("");
  });

  it("turns wallet provider failures into useful launch errors", () => {
    expect(subject.getWalletTransactionErrorMessage).toBeTypeOf("function");
    expect(
      subject.getWalletTransactionErrorMessage({
        code: 4900,
        message: "MetaMask is disconnected",
      }),
    ).toBe(
      "Wallet connection was interrupted. Reload the page and try again",
    );
    expect(
      subject.getWalletTransactionErrorMessage({
        code: 4001,
        message: "User rejected the request",
      }),
    ).toBe("Transaction cancelled in wallet");
    expect(
      subject.getWalletTransactionErrorMessage(
        new Error("Wallet request failed"),
      ),
    ).toBe("Wallet request failed");
  });

  it("keeps the visible wallet session and dialog open when disconnect fails", () => {
    expect(subject.getWalletDisconnectOutcome(false)).toEqual({
      dialogOpen: true,
      error: "Unable to disconnect wallet. Try again.",
      sessionSuppressed: false,
    });
    expect(subject.getWalletDisconnectOutcome(true)).toEqual({
      dialogOpen: false,
      error: "",
      sessionSuppressed: true,
    });
  });

  it("does not disconnect provider wallets when authenticated logout fails", async () => {
    const events: string[] = [];
    const succeeded = await subject.executeWalletDisconnect({
      authenticated: true,
      logout: async () => {
        events.push("logout");
        throw new Error("logout failed");
      },
      disconnectProviderWallets: async () => {
        events.push("provider cleanup");
        return true;
      },
      markAppDisconnected: () => {
        events.push("mark disconnected");
      },
    });

    expect(succeeded).toBe(false);
    expect(events).toEqual(["logout"]);
  });

  it("keeps reconnect blocked until authenticated provider cleanup settles", async () => {
    const events: string[] = [];
    let finishCleanup: ((value: boolean) => void) | undefined;
    const cleanup = new Promise<boolean>((resolve) => {
      finishCleanup = resolve;
    });

    let disconnectSettled = false;
    const disconnect = subject.executeWalletDisconnect({
      authenticated: true,
      logout: async () => {
        events.push("logout");
      },
      disconnectProviderWallets: () => {
        events.push("provider cleanup");
        return cleanup;
      },
      markAppDisconnected: () => {
        events.push("mark disconnected");
      },
    });
    void disconnect.finally(() => {
      disconnectSettled = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(disconnectSettled).toBe(false);
    expect(events).toEqual(["logout", "provider cleanup"]);

    finishCleanup?.(true);
    const succeeded = await disconnect;
    expect(succeeded).toBe(true);
    expect(disconnectSettled).toBe(true);
    expect(events).toEqual([
      "logout",
      "provider cleanup",
      "mark disconnected",
    ]);
  });

  it("completes authenticated logout when best-effort provider cleanup fails", async () => {
    const events: string[] = [];
    const succeeded = await subject.executeWalletDisconnect({
      authenticated: true,
      logout: async () => {
        events.push("logout");
      },
      disconnectProviderWallets: async () => {
        events.push("provider cleanup");
        throw new Error("provider cleanup failed");
      },
      markAppDisconnected: () => {
        events.push("mark disconnected");
      },
    });

    expect(succeeded).toBe(true);
    expect(events).toEqual([
      "logout",
      "provider cleanup",
      "mark disconnected",
    ]);
  });

  it("uses provider cleanup as the deterministic boundary without an authenticated session", async () => {
    const failedEvents: string[] = [];
    const failed = await subject.executeWalletDisconnect({
      authenticated: false,
      logout: async () => {
        failedEvents.push("logout");
      },
      disconnectProviderWallets: async () => {
        failedEvents.push("provider cleanup");
        return false;
      },
      markAppDisconnected: () => {
        failedEvents.push("mark disconnected");
      },
    });

    expect(failed).toBe(false);
    expect(failedEvents).toEqual(["provider cleanup"]);

    const succeededEvents: string[] = [];
    const succeeded = await subject.executeWalletDisconnect({
      authenticated: false,
      logout: async () => {
        succeededEvents.push("logout");
      },
      disconnectProviderWallets: async () => {
        succeededEvents.push("provider cleanup");
        return true;
      },
      markAppDisconnected: () => {
        succeededEvents.push("mark disconnected");
      },
    });

    expect(succeeded).toBe(true);
    expect(succeededEvents).toEqual([
      "provider cleanup",
      "mark disconnected",
    ]);
  });

  it("exposes only an authenticated linked wallet, never another detected external account", () => {
    const externalWallet = {
      address: "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
      connectedAt: 20,
      linked: false,
      walletClientType: "metamask",
    };
    const embeddedWallet = {
      address: "0xaA5A000000000000000000000000000000005787",
      connectedAt: 10,
      linked: true,
      walletClientType: "privy",
    };

    expect(subject.selectAuthenticatedWallet).toBeTypeOf("function");
    expect(
      subject.selectAuthenticatedWallet(
        false,
        [embeddedWallet, externalWallet],
        embeddedWallet.address,
      ),
    ).toBeUndefined();
    expect(
      subject.selectAuthenticatedWallet(
        true,
        [embeddedWallet, externalWallet],
        embeddedWallet.address,
      ),
    ).toBe(embeddedWallet);
  });

  it("uses the most recently connected external wallet when more than one is available", () => {
    const older = {
      address: "0x1111111111111111111111111111111111111111",
      connectedAt: 10,
      linked: true,
      walletClientType: "metamask",
    };
    const newer = {
      address: "0x2222222222222222222222222222222222222222",
      connectedAt: 20,
      linked: true,
      walletClientType: "phantom",
    };

    expect(subject.selectConnectedWallet([older, newer])).toBe(newer);
  });

  it("uses only a linked wallet on privileged routes and prefers the exact primary", () => {
    const unlinkedExternal = {
      address: "0x1111111111111111111111111111111111111111",
      connectedAt: 30,
      linked: false,
      walletClientType: "metamask",
    };
    const linkedExternal = {
      address: "0x2222222222222222222222222222222222222222",
      connectedAt: 20,
      linked: true,
      walletClientType: "phantom",
    };
    const linkedPrimary = {
      address: "0x3333333333333333333333333333333333333333",
      connectedAt: 10,
      linked: true,
      walletClientType: "privy",
    };

    expect(subject.selectLinkedWallet(
      [unlinkedExternal, linkedExternal, linkedPrimary],
      linkedPrimary.address,
    )).toBe(linkedPrimary);
    expect(subject.selectLinkedWallet(
      [unlinkedExternal, linkedExternal],
      unlinkedExternal.address,
    )).toBe(linkedExternal);
    expect(subject.selectLinkedWallet([unlinkedExternal])).toBeUndefined();
  });

  it("keeps a primary linked wallet on every page and rejects stale wallets from another session", () => {
    const primary = { address: APPLICANT_WALLET, connectedAt: 1, linked: true, walletClientType: "privy" };
    const stale = { address: OTHER_WALLET, connectedAt: 100, linked: true, walletClientType: "metamask" };
    expect(walletProvider.selectAuthenticatedWallet(true, [stale, primary], primary.address,
      new Set([primary.address]))).toBe(primary);
    expect(walletProvider.selectAuthenticatedWallet(true, [stale], primary.address,
      new Set([primary.address]))).toBeUndefined();
  });

  it("uses authenticated ownership when a connected SDK wallet has a stale linked flag", () => {
    const owned = { address: APPLICANT_WALLET, connectedAt: 1, linked: false, walletClientType: "metamask" };
    const foreign = { address: OTHER_WALLET, connectedAt: 100, linked: true, walletClientType: "metamask" };
    const ownership = new Set([APPLICANT_WALLET.toLowerCase()]);
    expect(walletProvider.selectAuthenticatedWallet(true, [foreign, owned], APPLICANT_WALLET.toUpperCase(), ownership)).toBe(owned);
    expect(walletProvider.selectAuthenticatedWallet(true, [foreign], APPLICANT_WALLET, ownership)).toBeUndefined();
    expect(walletProvider.selectAuthenticatedWallet(false, [owned], APPLICANT_WALLET, ownership)).toBeUndefined();
    expect(walletProvider.selectAuthenticatedWallet(true, [owned], APPLICANT_WALLET)).toBeUndefined();
  });

  it("waits for wallet hydration and reconnects an existing account instead of linking it twice", () => {
    const pending = subject.getWalletSessionAction(subject.isWalletProviderSettled(true, false, true), true);
    expect(walletProvider.getWalletOpenAction(pending, false, true)).toBe("wait");
    expect(walletProvider.getWalletOpenAction("manage", false, true)).toBe("reconnect");
    expect(subject.getWalletLoginErrorMessage("linked_to_another_user"))
      .toBe("This wallet is linked to another account. Switch accounts to use it.");
  });
});
