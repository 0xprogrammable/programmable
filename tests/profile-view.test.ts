import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";

import {
  actionCanCheckStatus,
  actionLabel,
  actionPending,
  actionSettling,
  buildProfilePortfolio,
  clearConfirmedProfileActionStates,
  getProfileSessionView,
  getProfileWorkspacePhase,
  getProfileRewardDataQuality,
  getStockPairedClaimPaths,
  groupPendingProfileTransactionStates,
  groupProfileRewards,
  parsePendingProfileTransactions,
  paginateProfileClaimableEntries,
  profileClaimableWei,
  profileClaimActionCount,
  profileClaimSubmissionAllowed,
  profileActionStateUsesNeutralStatus,
  profileCreatorClaimErrorMessage,
  profileEntryHasClaimableReward,
  profileHasRewardSurface,
  profileNativeClaimMeetsVisibilityThreshold,
  publicProfileAccountFromQuery,
  readProfileForEditor,
  prioritizedProfileActionState,
  profileRouterLaunchEntries,
  profileRewardsForAccount,
  profileRewardActionErrorMessage,
  profileTokenMarketCapLabel,
  profileTransactionPollAttempts,
  reflectedConfirmedProfileTransactions,
  resolveCreatorProfileReadFailure,
  resolveProfileNotFoundTransaction,
  preserveInterruptedTransactionStates,
  removePendingProfileTransactionRecord,
  resolveStockPairedReceiptGate,
  sortProfileTokensByMarketCap,
  sortProfileClaimableEntries,
  shouldShowStockPairedEthClaimPath,
  stockPairedCheckpointAfterReceipt,
  upsertPendingProfileTransactionRecords,
  waitForTransaction,
  walletActionWasCancelled,
  withoutClosedDeepProfileData,
  type PendingProfileTransactionRecord,
  type StockPairedPendingStage,
} from "../components/profile-view";
import type { ClassicV3Reward } from "../lib/profile/classic-v3-rewards";
import { CreatorClaimClientError } from "../lib/profile/creator-claim";
import type { DeepV3CreatorToken } from "../lib/profile/deep-v3-profile";
import {
  ProfileResponseError,
  type ProfileClaim,
  type ProfileOnchainData,
  type ProfileToken,
} from "../lib/profile/onchain-profile";

const firstAddress = getAddress(
  "0x1111111111111111111111111111111111111111",
);
const secondAddress = getAddress(
  "0x2222222222222222222222222222222222222222",
);
const thirdAddress = getAddress(
  "0x3333333333333333333333333333333333333333",
);
const profileExperienceCss = readFileSync(
  new URL("../components/profile-experience.module.css", import.meta.url),
  "utf8",
);
const profileProjectsCss = readFileSync(
  new URL("../components/profile-projects.module.css", import.meta.url),
  "utf8",
);
const profileViewSource = readFileSync(
  new URL("../components/profile-view.tsx", import.meta.url),
  "utf8",
);
const profileSkeletonSource = readFileSync(
  new URL("../components/profile-skeleton.tsx", import.meta.url),
  "utf8",
);

function profileCssDeclarationsFor(selectorFragment: string) {
  return [...profileExperienceCss.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
    .filter(([, selectors]) => selectors.split(",").some(
      (selector) => selector.trim() === selectorFragment,
    ))
    .map(([, , declarations]) => declarations)
    .join("\n");
}

describe("profile editor composition", () => {
  it("hydrates editor drafts from the latest wallet-local profile", () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({
        version: 2,
        username: "Programmable",
        avatarDataUrl: "",
        xUrl: "ProgrammableHQ",
        websiteUrl: "programmable.market",
        githubUrl: "programmablehq",
      })),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    };

    expect(readProfileForEditor(
      storage,
      firstAddress,
      { username: "", avatarDataUrl: "" },
    )).toMatchObject({
      username: "Programmable",
      xUrl: "ProgrammableHQ",
      websiteUrl: "programmable.market",
      githubUrl: "programmablehq",
    });
    expect(profileViewSource).toMatch(
      /function beginEditingProfile\(\)\s*\{\s*populateProfileDrafts\(latestProfileForEditor\(\)\);/u,
    );
  });

  it("keeps banner actions on the trailing edge away from the avatar", () => {
    expect(profileExperienceCss).toMatch(
      /\.bannerActions\s*\{[^}]*flex-direction:\s*row-reverse;[^}]*right:\s*14px;/s,
    );
    expect(profileExperienceCss).not.toMatch(
      /\.bannerActions\s*\{[^}]*left:\s*14px;/s,
    );
    expect(profileExperienceCss).toMatch(
      /@media \(max-width:\s*620px\)[\s\S]*?\.bannerActions\s*\{[^}]*align-items:\s*flex-end;[^}]*right:\s*10px;/,
    );
  });

  it("wraps the hero name instead of clipping it behind Edit profile", () => {
    const nameRule = profileExperienceCss.match(
      /\.nameRow h1\s*\{([^}]*)\}/su,
    )?.[1] ?? "";
    expect(nameRule).toMatch(/max-width:\s*100%;/u);
    expect(nameRule).toMatch(/overflow-wrap:\s*anywhere;/u);
    expect(nameRule).toMatch(/white-space:\s*normal;/u);
    expect(nameRule).not.toMatch(/overflow:\s*hidden;/u);
    expect(nameRule).not.toMatch(/text-overflow:\s*ellipsis;/u);

    const finalMobileRules = profileExperienceCss.slice(
      profileExperienceCss.lastIndexOf("@media (max-width: 620px)"),
    );
    expect(finalMobileRules).toMatch(
      /\.nameRow\s*\{[^}]*flex-direction:\s*column;/su,
    );
    expect(finalMobileRules).toMatch(
      /\.nameRow h1\s*\{[^}]*font-size:\s*clamp\(24px,\s*8\.2vw,\s*32px\);/su,
    );
    expect(profileExperienceCss).toMatch(
      /\.editButton\s*\{\s*font-size:\s*14px;\s*min-height:\s*44px;\s*\}/su,
    );
  });

  it("raises only compact claim actions and supporting descriptions", () => {
    for (const [selector, fontSize] of [
      [".claimRefresh", 13],
      [".claimRow .claimButton", 13],
      [".actionState", 12],
      [".rowError", 12],
      [".claimEmpty p", 13],
      [".claimDialogHeader p", 13],
      [".claimDialogAction p", 13],
      [".claimDialogAction .claimButton", 13],
      [".claimDialogAction .secondaryAction", 13],
    ] as const) {
      expect(profileCssDeclarationsFor(selector)).toMatch(
        new RegExp(`font-size:\\s*${fontSize}px;`, "u"),
      );
    }

    expect(profileCssDeclarationsFor(".claimCopy small")).toMatch(
      /font-size:\s*10px;/u,
    );
    expect(profileCssDeclarationsFor(".claimAmount small")).toMatch(
      /font-size:\s*11px;/u,
    );
  });
});

const tokens: ProfileToken[] = [
  {
    address: firstAddress,
    name: "First",
    symbol: "FIRST",
    launchedAt: "Jul 27, 2026",
    href: `/token/${firstAddress}`,
  },
  {
    address: secondAddress,
    name: "Second",
    symbol: "SECOND",
    launchedAt: "Jul 27, 2026",
    href: `/token/${secondAddress}`,
  },
];

const claim = {
  id: `0x${"11".repeat(32)}`,
  poolId: `0x${"22".repeat(32)}`,
  tokenAddress: secondAddress,
  hookAddress: getAddress(
    "0x3333333333333333333333333333333333333333",
  ),
  tokenName: "Second",
  tokenSymbol: "SECOND",
  claimableWei: "1000000000000000",
  claimableEth: "0.001",
  href: `/token/${secondAddress}`,
} satisfies ProfileClaim;

describe("profile action error copy", () => {
  it("keeps actionable claim blocks and hides internal response states", () => {
    expect(
      profileCreatorClaimErrorMessage(
        new CreatorClaimClientError(
          "nothing-to-claim",
          "There are no creator fees to claim for this pool",
        ),
      ),
    ).toBe("There are no creator fees to claim for this pool");
    expect(
      profileCreatorClaimErrorMessage(
        new CreatorClaimClientError(
          "invalid-response",
          "Creator claim preparation was not ready",
        ),
      ),
    ).toBe(
      "The claim status could not be confirmed. Check your wallet activity before trying again.",
    );
    expect(
      profileCreatorClaimErrorMessage(
        new Error("Transaction cancelled in wallet"),
      ),
    ).toBe("Transaction cancelled. Rewards remain available.");
    expect(
      profileCreatorClaimErrorMessage(new Error("private provider detail")),
    ).toBe(
      "The claim status could not be confirmed. Check your wallet activity before trying again.",
    );
  });

  it("does not expose dormant reward parser details", () => {
    expect(
      profileRewardActionErrorMessage(
        new Error("Deep reward action is not ready"),
      ),
    ).toBe("Unable to claim. Try again.");
    expect(
      profileRewardActionErrorMessage(
        new Error(
          "The reward action could not be simulated from current onchain state",
        ),
      ),
    ).toBe(
      "The reward action could not be simulated from current onchain state",
    );
  });

  it("recognizes nested wallet rejection without leaving a claim error", () => {
    expect(walletActionWasCancelled({
      cause: { code: 4001, message: "User rejected the request" },
    })).toBe(true);
    expect(
      profileRewardActionErrorMessage({
        cause: { code: 4001, message: "User rejected the request" },
      }),
    ).toBe("Transaction cancelled. Rewards remain available.");
  });
});

const classicAllocation = {
  allocationIndex: 0,
  beneficiary: firstAddress,
  payoutAddress: firstAddress,
  shareBps: 10_000,
};

const classicReward = {
  releaseVersion: "classic-v3",
  tokenAddress: secondAddress,
  tokenName: "Second",
  tokenSymbol: "SECOND",
  poolId: `0x${"44".repeat(32)}`,
  vaultAddress: getAddress(
    "0x4444444444444444444444444444444444444444",
  ),
  beneficiary: firstAddress,
  payoutAddress: firstAddress,
  shareBps: 10_000,
  claimableWei: "2000000000000000",
  claimableEth: "0.002",
  claimedWei: "0",
  claimedEth: "0",
  buySwapFeeBps: 100,
  sellSwapFeeBps: 200,
  platformFeeBps: 10,
  ownedAllocations: [classicAllocation],
  beneficiaries: [classicAllocation],
  launchTransactionHash: `0x${"55".repeat(32)}`,
} satisfies ClassicV3Reward;
const secondClassicReward = {
  ...classicReward,
  poolId: `0x${"66".repeat(32)}`,
  vaultAddress: thirdAddress,
  claimableWei: "4000000000000000",
  claimableEth: "0.004",
  launchTransactionHash: `0x${"77".repeat(32)}`,
} satisfies ClassicV3Reward;
const deepV3Token = {
  deepReleaseVersion: "deep-full-range-v3",
  launchModel: "deep",
  tokenAddress: thirdAddress,
  tokenName: "Deep Three",
  tokenSymbol: "D3",
  imageUrl: "https://programmable.family/deep-three.png",
  creator: firstAddress,
  hookAddress: getAddress(
    "0x4444444444444444444444444444444444444444",
  ),
  vaultAddress: getAddress(
    "0x5555555555555555555555555555555555555555",
  ),
  poolId: `0x${"88".repeat(32)}`,
  launchTransactionHash: `0x${"99".repeat(32)}`,
  launchedAt: "2026-07-29T12:00:00.000Z",
  marketCapNativeWad: "500",
  pendingGrowthNativeWei: "10",
  accruedGrowthFeesWei: "20",
  totalGrowthEthReceivedWei: "100",
  totalNativeSwappedWei: "40",
  totalNativeAddedWei: "50",
  totalTokenAddedRaw: "70",
  lockedLiquidity: "30",
  trustedNativeDepthWei: "1000",
  rollingExposureWei: "40",
  compoundCount: "1",
  lastCompoundTimestamp: "1800000000",
  automationAction: 0,
  nextEligibleTimestamp: "1800000300",
  rollingCapacityWei: "250",
  blockedReason: "0x00000000",
} satisfies DeepV3CreatorToken;

describe("profile workspace loading state", () => {
  it("keeps the profile in a stable loading shell while the wallet session hydrates", () => {
    expect(getProfileSessionView(true)).toBe("loading");
    expect(getProfileSessionView(true, firstAddress)).toBe("loading");
    expect(getProfileSessionView(false)).toBe("connect");
    expect(getProfileSessionView(false, firstAddress)).toBe("profile");
  });

  it("opens a query-address profile as public unless it is the connected wallet", () => {
    expect(publicProfileAccountFromQuery([firstAddress])).toBe(
      firstAddress.toLowerCase(),
    );
    expect(publicProfileAccountFromQuery([firstAddress], firstAddress)).toBeNull();
    expect(publicProfileAccountFromQuery([firstAddress], secondAddress)).toBe(
      firstAddress.toLowerCase(),
    );
    expect(publicProfileAccountFromQuery([])).toBeNull();
    expect(publicProfileAccountFromQuery([firstAddress, secondAddress])).toBeNull();
    expect(publicProfileAccountFromQuery(["not-an-address"])).toBeNull();
  });

  it("keeps the public profile surface read-only", () => {
    expect(profileViewSource).toContain("<PublicCreatorProfile");
    expect(profileViewSource).toContain("You’re viewing another wallet’s profile.");
    expect(profileViewSource).toContain('href="/profile">My profile</Link>');
    expect(profileViewSource).toContain(
      "<ProfileRouterLaunches entries={entries}",
    );
    expect(profileViewSource).not.toContain(
      "<PublicCreatorProfile account={account}",
    );
  });

  it("keeps a stable loading state until every pending source settles", () => {
    expect(
      getProfileWorkspacePhase(
        ["error", "loading", "not-deployed"],
        true,
      ),
    ).toBe("loading");
    expect(
      getProfileWorkspacePhase(
        ["error", "not-deployed", "unavailable"],
        false,
      ),
    ).toBe("loading");
  });

  it("reveals rewards only after every active source has settled", () => {
    expect(
      getProfileWorkspacePhase(["error", "ready", "loading"], false),
    ).toBe("loading");
    expect(
      getProfileWorkspacePhase(
        ["error", "ready", "not-deployed"],
        false,
      ),
    ).toBe("ready");
    expect(
      getProfileWorkspacePhase(
        ["error", "not-deployed", "unavailable"],
        true,
      ),
    ).toBe("error");
    expect(profileViewSource).toMatch(
      /if \(integrityConflict\) return "error";[\s\S]*?status === "loading"[\s\S]*?status === "ready"/,
    );
  });

  it("keeps temporary reward outages distinct from accounting conflicts", () => {
    expect(
      getProfileWorkspacePhase(["ready", "error", "not-deployed"], true),
    ).toBe("ready");
    expect(
      getProfileWorkspacePhase(
        ["ready", "error", "not-deployed"],
        true,
        true,
      ),
    ).toBe("error");
    expect(
      getProfileRewardDataQuality(
        ["ready", "error", "not-deployed"],
        "unavailable",
      ),
    ).toBe("partial");
    expect(
      getProfileRewardDataQuality(
        ["ready", "ready", "not-deployed"],
        "stale",
      ),
    ).toBe("stale");
    expect(profileViewSource).not.toContain(
      "Classic rewards could not be loaded",
    );
    expect(profileViewSource).toContain(
      "Current claim totals could not be verified",
    );
    expect(profileViewSource).toContain(
      "PROFILE_LIVE_REFRESH_INTERVAL_MS = 30_000",
    );
  });

  it("allows new claims only from current verified reward data", () => {
    expect(profileClaimSubmissionAllowed("current")).toBe(true);
    expect(profileClaimSubmissionAllowed("stale")).toBe(false);
    expect(profileClaimSubmissionAllowed("partial")).toBe(false);
    expect(profileViewSource).toContain(
      "profileClaimSubmissionAllowed(\n    rewardDataQuality,",
    );
    expect(profileViewSource).toContain(
      "const claimableEntries = claimSubmissionAllowed",
    );
    expect(profileViewSource).toContain(
      "nativeEarned={claimSubmissionAllowed ? nativeEarned : null}",
    );
  });

  it("keeps verified native ETH totals when only Stock-Paired rewards fail", () => {
    expect(profileViewSource).toContain(
      'const nativeRewardSourceStatuses = [\n    data.status,\n    classicV3Rewards.status,\n    deepRewards.status,\n  ] as const;',
    );
    expect(profileViewSource).toContain(
      "getProfileRewardDataQuality(\n    nativeRewardSourceStatuses,",
    );
  });

  it("uses LKG only for typed temporary creator reads and marks it stale", () => {
    const current = {
      account: firstAddress,
      status: "ready",
      tokens,
      positions: [],
      claims: [claim],
      activity: [],
    } satisfies ProfileOnchainData;

    const stale = resolveCreatorProfileReadFailure(
      current,
      firstAddress,
      new ProfileResponseError(
        "Onchain creator data is temporarily unavailable",
        "temporary",
      ),
    );
    expect(stale).toMatchObject({
      status: "ready",
      sourceQuality: "stale",
      claims: [claim],
    });
    expect(
      getProfileRewardDataQuality(
        ["ready", "ready"],
        "current",
        stale.sourceQuality,
      ),
    ).toBe("stale");

    const blocked = resolveCreatorProfileReadFailure(
      current,
      firstAddress,
      new ProfileResponseError(
        "Current creator reward data could not be verified",
        "integrity",
      ),
    );
    expect(blocked).toMatchObject({
      status: "error",
      errorKind: "integrity",
      tokens: [],
      claims: [],
    });
  });

  it("keeps paginated desktop claim rows top-aligned without an internal scrollbar", () => {
    expect(profileExperienceCss).toMatch(
      /@media \(min-width: 821px\) and \(min-height: 700px\)[\s\S]*?\.claimList\s*\{[\s\S]*?align-content: start;[\s\S]*?overflow: visible;/,
    );
    expect(profileExperienceCss).toMatch(
      /@media \(max-width: 820px\)[\s\S]*?\.profileWorkspace/,
    );
  });

  it("holds cold profile geometry until wallet and local profile hydration settle", () => {
    expect(profileViewSource).toContain(
      "Boolean(requestedProfileAccount) || hasSession || Boolean(account)",
    );
    expect(profileViewSource).toMatch(
      /showDashboard \? \([\s\S]*?<ProfileLoadingSkeleton label="Loading profile" showHero \/>[\s\S]*?\) : \([\s\S]*?className=\{`\$\{styles\.connectCard\}/,
    );
    expect(profileSkeletonSource).toContain(
      "showHero ? styles.profileSkeletonPage : styles.profileSkeletonInline",
    );
    expect(profileViewSource).toContain(
      'if (phase === "loading")',
    );
    expect(profileViewSource).toContain(
      'if (!clientHydrated || sessionView === "loading")',
    );
    expect(profileViewSource).not.toContain(
      'if (profileWorkspacePhase === "loading")',
    );
    expect(profileViewSource).not.toContain("styles.sessionLoadingWorkspace");
    expect(profileViewSource).not.toContain("styles.loadingPanelTitle");
    expect(profileExperienceCss).toMatch(
      /\.profileSkeletonPage\s*\{[^}]*min-height:\s*calc\(100svh - 88px\);/s,
    );
    expect(profileExperienceCss).toMatch(
      /\.profileSkeletonBanner\s*\{[^}]*height:\s*156px;/s,
    );
    expect(profileExperienceCss).toMatch(
      /@media \(max-width:\s*620px\)[\s\S]*?\.profileSkeletonBanner\s*\{[^}]*height:\s*108px;/s,
    );
    expect(profileViewSource).toContain("<ProfileProjectsLoadingState />");
    expect(profileSkeletonSource).toContain(
      "Array.from({ length: 4 }, (_, item)",
    );
    expect(profileSkeletonSource).toMatch(
      /className=\{styles\.profileSkeletonClaims\}[\s\S]*?className=\{styles\.profileSkeletonSectionHeader\}[\s\S]*?className=\{styles\.profileSkeletonRows\}[\s\S]*?Array\.from\(\{ length: 4 \}/,
    );
    expect(profileViewSource).not.toContain("profileSkeletonPrediction");
    expect(profileExperienceCss).toMatch(
      /:global\(html\[data-theme="dark"\]\) \.page\s*\{[^}]*--profile-panel:\s*var\(--webde-surface\);/s,
    );
    expect(profileExperienceCss).toMatch(
      /\.profileSkeletonHero\s*\{[^}]*min-height:\s*282px;/s,
    );
    expect(profileExperienceCss).toMatch(
      /\.profileSkeletonWorkspace\s*\{[^}]*min-height:\s*360px;/s,
    );
    expect(profileExperienceCss).toMatch(
      /\.profileSkeletonInline\s*\{[^}]*min-height:\s*360px;/s,
    );
    expect(profileExperienceCss).toMatch(
      /\.profileSkeletonClaims\s*\{[^}]*align-content:\s*start;[^}]*gap:\s*12px;/s,
    );
    expect(profileExperienceCss).toMatch(
      /\.profileSkeletonHero\s*\{[^}]*min-height:\s*350px;/s,
    );
    for (const selector of [".profileSkeletonSummary", ".feePanel"]) {
      expect(profileCssDeclarationsFor(selector)).toContain(
        "min-height: var(--profile-fees-min-height)",
      );
    }
    for (const selector of [".profileSkeletonClaims", ".claimablePanel"]) {
      expect(profileCssDeclarationsFor(selector)).toContain(
        "min-height: var(--profile-claims-min-height)",
      );
    }
    expect(profileExperienceCss).not.toContain(
      '.claimablePanel[data-visible-count=',
    );
    expect(profileExperienceCss).not.toContain("profile-content-reveal");
    expect(profileExperienceCss).toContain(
      "animation: profile-skeleton-pulse 1.35s ease-in-out infinite alternate",
    );
    expect(profileProjectsCss).toContain(
      "animation: profile-project-skeleton 1.35s ease-in-out infinite alternate",
    );
    expect(profileExperienceCss).toContain("background: var(--skeleton-base)");
    expect(profileProjectsCss).toContain("background: var(--skeleton-base)");
    expect(profileExperienceCss).toContain(
      "to { background-color: var(--skeleton-highlight); }",
    );
    expect(profileProjectsCss).toContain(
      "to { background-color: var(--skeleton-highlight); }",
    );
    expect(profileExperienceCss).not.toContain("from { opacity: 0.48; }");
    expect(profileProjectsCss).not.toContain("from { opacity: 0.48; }");
  });

  it("keeps warm reward refreshes visible, announced and motion-safe", () => {
    expect(profileViewSource).toContain("requestProfileRefresh(true)");
    expect(profileViewSource).toContain(
      'completeProfileRefreshSource(profileRefresh, "creator")',
    );
    expect(profileViewSource).toContain(
      '{refreshing ? "Refreshing" : "Refresh"}',
    );
    expect(profileViewSource).toContain("aria-busy={refreshing || undefined}");
    expect(profileViewSource).toContain("disabled={refreshing}");
    expect(profileViewSource).toContain(
      'data-visible-count={claimPageData.items.length}',
    );
    expect(profileViewSource).toContain(
      "if (profileActionStateUsesNeutralStatus(state))",
    );
    expect(profileViewSource).toContain(
      '{refreshing ? "Refreshing rewards" : ""}',
    );
    expect(profileExperienceCss).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)[\s\S]*?\.claimRefreshActive svg\s*\{[^}]*animation:\s*profile-refresh-spin/s,
    );
    expect(profileExperienceCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.claimRefresh[\s\S]*?transition:\s*none;/s,
    );
  });
});

describe("fee earnings summary", () => {
  it("shows lifetime earned, available and claimed totals without a claim-history chart", () => {
    expect(profileViewSource).toContain(">Fees earned</h2>");
    expect(profileViewSource).not.toContain(">Lifetime fees for this wallet</p>");
    expect(profileViewSource).toContain(">Total earned</span>");
    expect(profileViewSource).toContain("Available <b>");
    expect(profileViewSource).toContain("Claimed <b>");
    expect(profileViewSource).not.toContain('role="slider"');
    expect(profileViewSource).not.toContain("No confirmed claim history");
  });

  it("keeps the claim dialog focused on the selected token and actions", () => {
    expect(profileViewSource).not.toContain(">Claimable rewards<");
    expect(profileViewSource).not.toContain(
      "Choose the reward you want to claim.",
    );
    expect(profileViewSource).not.toContain(">Ready<");
    expect(profileViewSource).not.toContain("No rewards ready");
    expect(profileViewSource).toContain("Claimable: ");
  });
});

describe("profile claim receipt paths", () => {
  const stockReward = {
    payoutAddress: firstAddress,
    estimatedEth: "0.012",
    estimatedUsd: "41.25",
  };

  it("offers the verified quote-asset claim and conversion path only to its payout wallet", () => {
    expect(getStockPairedClaimPaths(stockReward, firstAddress)).toEqual([
      "quote-asset",
      "quote-asset-to-eth",
    ]);
    expect(getStockPairedClaimPaths(stockReward, secondAddress)).toEqual([
      "quote-asset",
    ]);
  });

  it("does not present ETH as a separate reward without a conversion estimate", () => {
    expect(
      getStockPairedClaimPaths(
        {
          ...stockReward,
          estimatedEth: undefined,
          estimatedUsd: undefined,
        },
        firstAddress,
      ),
    ).toEqual(["quote-asset"]);
  });

  it("keeps a persisted ETH conversion recovery visible after claimable reaches zero", () => {
    const rewardWithoutEstimate = {
      ...stockReward,
      estimatedEth: undefined,
      estimatedUsd: undefined,
    };

    expect(
      shouldShowStockPairedEthClaimPath(
        rewardWithoutEstimate,
        firstAddress,
        {
          claimTransactionHash: `0x${"ab".repeat(32)}` as const,
          amountIn: "1000",
        },
      ),
    ).toBe(true);
    expect(
      shouldShowStockPairedEthClaimPath(
        rewardWithoutEstimate,
        firstAddress,
      ),
    ).toBe(false);
  });
});

describe("profile reward grouping", () => {
  it("removes closed Deep data from the public profile surface", () => {
    const deepToken: ProfileToken = {
      address: thirdAddress,
      name: "Historical Deep",
      symbol: "DEEP",
      launchedAt: "Jul 29, 2026",
      href: `/token/${thirdAddress}`,
      launchModel: "deep",
    };
    const filtered = withoutClosedDeepProfileData({
      status: "ready",
      account: firstAddress,
      chainId: 1,
      tokens: [...tokens, deepToken],
      positions: [
        {
          id: `0x${"31".repeat(32)}`,
          tokenAddress: thirdAddress,
          tokenName: deepToken.name,
          tokenSymbol: deepToken.symbol,
          positionRecipient: firstAddress,
          positionTokenId: "7",
          lockStatus: "permanently-locked",
          href: deepToken.href,
        },
      ],
      claims: [
        {
          ...claim,
          id: `0x${"41".repeat(32)}`,
          tokenAddress: thirdAddress,
          tokenName: deepToken.name,
          tokenSymbol: deepToken.symbol,
          href: deepToken.href,
        },
      ],
      activity: [
        {
          id: "deep-activity",
          label: "Deep launch",
          detail: "Historical launch",
          occurredAt: "Jul 29, 2026",
          href: deepToken.href,
        },
      ],
    });

    expect(filtered.tokens).toEqual(tokens);
    expect(filtered.positions).toEqual([]);
    expect(filtered.claims).toEqual([]);
    expect(filtered.activity).toEqual([]);
  });

  it("keeps deployed-token order and attaches each reward to its token", () => {
    const grouped = groupProfileRewards(tokens, [claim]);

    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toEqual({ token: tokens[0], claim: undefined });
    expect(grouped[1]).toEqual({ token: tokens[1], claim });
  });

  it("orders creator tokens by highest market cap without mutating the source", () => {
    const ranked = tokens.map((token, index) => ({
      ...token,
      fdvUsdWad: index === 0 ? "100" : "300",
    }));

    expect(
      sortProfileTokensByMarketCap(ranked).map((token) => token.symbol),
    ).toEqual(["SECOND", "FIRST"]);
    expect(ranked.map((token) => token.symbol)).toEqual(["FIRST", "SECOND"]);
  });

  it("uses the address as a stable tie-breaker for identical profiles", () => {
    const tied = [
      {
        ...tokens[1],
        name: "Same",
        fdvUsdWad: "100",
      },
      {
        ...tokens[0],
        name: "Same",
        fdvUsdWad: "100",
      },
    ];

    expect(
      sortProfileTokensByMarketCap(tied).map((token) => token.address),
    ).toEqual([firstAddress, secondAddress]);
  });

  it("sorts with one validated market-cap unit and leaves incomparable tokens last", () => {
    const usdLow = {
      ...tokens[0],
      name: "USD Low",
      symbol: "USD_LOW",
      fdvUsdWad: "10",
      marketCapEthWei: "999999",
    };
    const usdHigh = {
      ...tokens[1],
      name: "USD High",
      symbol: "USD_HIGH",
      fdvUsdWad: "20",
      marketCapEthWei: "1",
    };
    const ethOnly = {
      ...tokens[0],
      address: thirdAddress,
      href: `/token/${thirdAddress}`,
      name: "ETH Only",
      symbol: "ETH_ONLY",
      fdvUsdWad: undefined,
      marketCapEthWei: "1000000",
    };
    const malformedUsd = {
      ...tokens[1],
      name: "Malformed USD",
      symbol: "MALFORMED_USD",
      fdvUsdWad: "not-a-wad",
      marketCapEthWei: "2000000",
    };

    expect(
      sortProfileTokensByMarketCap([
        ethOnly,
        usdLow,
        malformedUsd,
        usdHigh,
      ]).map((token) => token.symbol),
    ).toEqual(["USD_HIGH", "USD_LOW", "ETH_ONLY", "MALFORMED_USD"]);

    expect(
      buildProfilePortfolio(
        [ethOnly, usdLow, usdHigh],
        [],
        [],
      ).map((entry) => entry.token.symbol),
    ).toEqual(["USD_HIGH", "USD_LOW", "ETH_ONLY"]);
  });

  it("uses ETH market caps when no token has a validated USD valuation", () => {
    const ethLow = {
      ...tokens[0],
      symbol: "ETH_LOW",
      fdvUsdWad: "not-a-wad",
      marketCapEthWei: "10",
    };
    const ethHigh = {
      ...tokens[1],
      symbol: "ETH_HIGH",
      fdvUsdWad: undefined,
      marketCapEthWei: "20",
    };

    expect(
      sortProfileTokensByMarketCap([ethLow, ethHigh]).map(
        (token) => token.symbol,
      ),
    ).toEqual(["ETH_HIGH", "ETH_LOW"]);
  });

  it("formats a compact USD market cap for claim reward rows", () => {
    expect(profileTokenMarketCapLabel({
      ...tokens[0],
      fdvUsdWad: "502400000000000000000000",
    })).toBe("$502K");
    expect(profileTokenMarketCapLabel(tokens[0])).toBeNull();
  });

  it("renders one portfolio entry when current and split rewards share a token", () => {
    const portfolio = buildProfilePortfolio(
      tokens,
      [claim],
      [classicReward],
    );

    expect(portfolio).toHaveLength(2);
    const second = portfolio.find(
      (entry) => entry.token.address === secondAddress,
    );
    expect(second).toMatchObject({
      token: tokens[1],
      claim,
      classicRewards: [classicReward],
      launchedByWallet: true,
    });
    expect(profileClaimableWei(portfolio)).toBe(
      3_000_000_000_000_000n,
    );
    expect(profileClaimActionCount(portfolio, firstAddress)).toBe(2);
  });

  it("keeps reward-only tokens visible when the launch feed is unavailable", () => {
    const portfolio = buildProfilePortfolio([], [], [classicReward]);

    expect(portfolio).toHaveLength(1);
    expect(portfolio[0]).toMatchObject({
      token: {
        address: secondAddress,
        name: "Second",
        symbol: "SECOND",
      },
      launchedByWallet: false,
      classicRewards: [classicReward],
    });
  });

  it("groups every beneficiary vault for the same token without losing rewards", () => {
    const portfolio = buildProfilePortfolio(
      tokens,
      [claim],
      [classicReward, secondClassicReward, secondClassicReward],
    );
    const second = portfolio.find(
      (entry) => entry.token.address === secondAddress,
    );

    expect(second?.classicRewards).toEqual([
      classicReward,
      secondClassicReward,
    ]);
    expect(profileClaimableWei(portfolio)).toBe(
      7_000_000_000_000_000n,
    );
  });

  it("sorts six claimable entries before splitting them into four-row pages", () => {
    const claimableAmounts = [1n, 9n, 3n, 7n, 5n, 2n];
    const claimTokens = claimableAmounts.map((_, index) => {
      const address = getAddress(
        `0x${(index + 10).toString(16).padStart(40, "0")}`,
      );
      return {
        address,
        name: `Claim ${index + 1}`,
        symbol: `C${index + 1}`,
        launchedAt: "Aug 4, 2026",
        href: `/token/${address}`,
      } satisfies ProfileToken;
    });
    const claims = claimTokens.map((token, index) => ({
      ...claim,
      id: `0x${(index + 1).toString(16).padStart(64, "0")}`,
      poolId: `0x${(index + 11).toString(16).padStart(64, "0")}`,
      tokenAddress: token.address,
      tokenName: token.name,
      tokenSymbol: token.symbol,
      claimableWei: claimableAmounts[index].toString(),
      claimableEth: claimableAmounts[index].toString(),
      href: token.href,
    })) satisfies ProfileClaim[];
    const portfolio = buildProfilePortfolio(claimTokens, claims, []);
    const ranked = sortProfileClaimableEntries(portfolio, firstAddress);
    const firstPage = paginateProfileClaimableEntries(ranked, 1);
    const secondPage = paginateProfileClaimableEntries(ranked, 2);

    expect(ranked.map((entry) => entry.token.symbol)).toEqual([
      "C2",
      "C4",
      "C5",
      "C3",
      "C6",
      "C1",
    ]);
    expect(firstPage).toMatchObject({ currentPage: 1, totalPages: 2 });
    expect(firstPage.items.map((entry) => entry.token.symbol)).toEqual([
      "C2",
      "C4",
      "C5",
      "C3",
    ]);
    expect(secondPage).toMatchObject({ currentPage: 2, totalPages: 2 });
    expect(secondPage.items.map((entry) => entry.token.symbol)).toEqual([
      "C6",
      "C1",
    ]);
    expect(claimTokens.map((token) => token.symbol)).toEqual([
      "C1",
      "C2",
      "C3",
      "C4",
      "C5",
      "C6",
    ]);
  });

  it("scopes claimable split rewards and actions to the connected beneficiary", () => {
    const otherBeneficiaryReward = {
      ...secondClassicReward,
      beneficiary: secondAddress,
      payoutAddress: secondAddress,
      ownedAllocations: [
        {
          ...classicAllocation,
          beneficiary: secondAddress,
          payoutAddress: secondAddress,
        },
      ],
      beneficiaries: [
        {
          ...classicAllocation,
          beneficiary: secondAddress,
          payoutAddress: secondAddress,
        },
      ],
    } satisfies ClassicV3Reward;
    const portfolio = buildProfilePortfolio(
      [],
      [],
      [classicReward, otherBeneficiaryReward],
    );

    expect(profileClaimableWei(portfolio, firstAddress)).toBe(
      2_000_000_000_000_000n,
    );
    expect(profileClaimableWei(portfolio, secondAddress)).toBe(
      4_000_000_000_000_000n,
    );
    expect(profileClaimActionCount(portfolio, firstAddress)).toBe(1);
    expect(profileClaimActionCount(portfolio, secondAddress)).toBe(1);
    expect(
      profileEntryHasClaimableReward(portfolio[0]!, firstAddress),
    ).toBe(true);
    expect(
      profileEntryHasClaimableReward(portfolio[0]!, thirdAddress),
    ).toBe(false);
    expect(
      profileRewardsForAccount(
        [classicReward, otherBeneficiaryReward],
        firstAddress,
      ),
    ).toEqual([classicReward]);
  });

  it("shows Deep V3 creator tokens without inventing rewards or claims", () => {
    const portfolio = buildProfilePortfolio(
      [],
      [],
      [],
      [],
      [deepV3Token],
    );

    expect(portfolio).toHaveLength(1);
    expect(portfolio[0]).toMatchObject({
      token: {
        address: thirdAddress,
        name: "Deep Three",
        symbol: "D3",
        launchModel: "deep",
      },
      deepV3Token,
      launchedByWallet: true,
      classicRewards: [],
      deepRewards: [],
    });
    expect(portfolio[0].claim).toBeUndefined();
    expect(profileClaimableWei(portfolio, firstAddress)).toBe(0n);
    expect(profileHasRewardSurface(portfolio)).toBe(false);
  });

  it("shows a stamped CustomGraph token without inventing a reward surface", () => {
    const customGraphToken = {
      ...tokens[0],
      name: "Stamped graph",
      symbol: "GRAPH",
      launchModel: "custom-graph",
      launchProvenance: "canonical-router",
    } satisfies ProfileToken;
    const portfolio = buildProfilePortfolio(
      [customGraphToken],
      [],
      [],
    );

    expect(portfolio).toEqual([
      expect.objectContaining({
        token: customGraphToken,
        launchedByWallet: true,
        claim: undefined,
        classicRewards: [],
        deepRewards: [],
        stockPairedRewards: [],
      }),
    ]);
    expect(profileClaimableWei(portfolio, firstAddress)).toBe(0n);
    expect(profileHasRewardSurface(portfolio)).toBe(false);
  });

  it("lists a connected launchWallet Router token independently of rewards", () => {
    const routerCustom = {
      ...tokens[0],
      name: "Custom Graph",
      symbol: "GRAPH",
      launchModel: "custom-graph",
      launchProvenance: "canonical-router",
    } satisfies ProfileToken;
    const legacy = {
      ...tokens[1],
      launchModel: "classic",
    } satisfies ProfileToken;
    const portfolio = buildProfilePortfolio(
      [routerCustom, legacy],
      [],
      [],
    );

    expect(profileRouterLaunchEntries(portfolio)).toEqual([
      expect.objectContaining({
        token: routerCustom,
        launchedByWallet: true,
        claim: undefined,
        classicRewards: [],
        deepRewards: [],
        stockPairedRewards: [],
      }),
    ]);
    expect(profileHasRewardSurface(profileRouterLaunchEntries(portfolio)))
      .toBe(false);
    expect(profileViewSource).not.toContain("Tokens launched from this wallet.");
    expect(profileViewSource).not.toContain("Router record");
    expect(profileViewSource).toContain('className={styles.claimablePanel}');
    expect(profileExperienceCss).not.toContain(".claimablePanelEmpty");

    expect(profileViewSource).not.toContain(
      "<ProfileRouterLaunches entries={routerLaunchEntries}",
    );
    expect(profileViewSource).toContain(
      'token.launchProvenance === "canonical-router"',
    );
  });

  it("hides native dust below 0.0001 ETH at the presentation boundary", () => {
    expect(profileNativeClaimMeetsVisibilityThreshold(99_999_999_999_999n))
      .toBe(false);
    expect(profileNativeClaimMeetsVisibilityThreshold(100_000_000_000_000n))
      .toBe(true);
  });
});

describe("profile transaction status", () => {
  const transactionHash = `0x${"ab".repeat(32)}` as const;
  const secondTransactionHash = `0x${"cd".repeat(32)}` as const;

  it("keeps an unresolved receipt check distinct from a retryable error", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ status: "pending" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const wait = vi.fn(async () => undefined);

    await expect(
      waitForTransaction(transactionHash, 1, {
        maxAttempts: 2,
        fetcher,
        wait,
      }),
    ).resolves.toBe("pending");

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(transactionHash);
    expect(
      actionCanCheckStatus({
        account: firstAddress,
        status: "pending",
        message: "Still pending on Ethereum",
        transactionHash,
      }),
    ).toBe(true);
    expect(
      actionLabel({
        account: firstAddress,
        status: "pending",
        message: "Still pending on Ethereum",
        transactionHash,
      }),
    ).toBe("Check status");
    expect(
      actionPending({
        account: firstAddress,
        status: "pending",
        message: "Still pending on Ethereum",
        transactionHash,
      }),
    ).toBe(false);
    expect(
      actionSettling({
        account: firstAddress,
        status: "pending",
        message: "Still pending on Ethereum",
        transactionHash,
      }),
    ).toBe(false);
  });

  it("preserves a not-found hash as a checkable non-busy state", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ status: "not-found" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(waitForTransaction(transactionHash, 1, {
      maxAttempts: 1,
      fetcher,
    })).resolves.toBe("not-found");
    const state = {
      account: firstAddress,
      status: "not-found" as const,
      message: "Transaction not found",
      transactionHash,
    };
    expect(actionCanCheckStatus(state)).toBe(true);
    expect(actionLabel(state)).toBe("Check status");
    expect(actionPending(state)).toBe(false);
    expect(actionSettling(state)).toBe(false);
    expect(profileViewSource).toContain(
      "group.actions.some((action) => actionPending(action.state))",
    );
    expect(profileViewSource).toContain(
      "disabled={rowActionPending || claimGroups.length === 0}",
    );
    expect(profileViewSource.match(/actionSettling\(/gu)).toHaveLength(1);
  });

  it("prioritizes the active claim phase over stale checkable states", () => {
    const stalePending = {
      account: firstAddress,
      status: "pending" as const,
      message: "Still pending on Ethereum",
      transactionHash,
    };
    const activeWallet = {
      account: firstAddress,
      status: "wallet" as const,
      message: "Confirm in wallet",
    };

    expect(
      prioritizedProfileActionState([stalePending, activeWallet]),
    ).toEqual(activeWallet);
    expect(
      actionLabel(
        prioritizedProfileActionState([stalePending, activeWallet]),
      ),
    ).toBe("Confirm in wallet");
    expect(profileViewSource).toContain(
      "<ProfileActionState state={rowActionState} />",
    );
  });

  it("releases a repeatedly missing hash so the next claim can retry", () => {
    expect(resolveProfileNotFoundTransaction(false)).toEqual({
      release: false,
      status: "not-found",
      message:
        "Still waiting for the transaction. Check your wallet activity, then select Check status.",
    });
    expect(resolveProfileNotFoundTransaction(true)).toEqual({
      release: true,
      status: "error",
      message: "No transaction was found. You can submit the claim again.",
      recoverable: true,
    });
    expect(profileViewSource).toMatch(
      /if \(resolution\.release\) \{\s*forgetPendingProfileTransaction\(pendingTransaction\);/s,
    );
  });

  it("announces released missing transactions neutrally without hiding true errors", () => {
    expect(
      profileActionStateUsesNeutralStatus({
        account: firstAddress,
        status: "error",
        message: "No transaction was found. You can submit the claim again.",
        transactionHash,
        recoverable: true,
      }),
    ).toBe(true);
    expect(
      profileActionStateUsesNeutralStatus({
        account: firstAddress,
        status: "error",
        message: "No transaction was found. You can submit the claim again.",
        transactionHash,
      }),
    ).toBe(false);
    expect(
      profileActionStateUsesNeutralStatus({
        account: firstAddress,
        status: "error",
        message: "The reward transaction reverted onchain",
        transactionHash,
      }),
    ).toBe(false);
    expect(profileViewSource).toContain(
      "if (profileActionStateUsesNeutralStatus(state))",
    );
    expect(profileViewSource).toContain(
      "const resolution = resolveProfileNotFoundTransaction(true);",
    );
  });

  it("keeps the first not-found result for aged restored Classic transactions", () => {
    const resumeLoop = profileViewSource.indexOf("for (const record of pending)");
    const resumeCall = profileViewSource.indexOf(
      "void settleSubmittedTransaction({",
      resumeLoop,
    );
    const resumeCallEnd = profileViewSource.indexOf("}).finally", resumeCall);
    expect(resumeLoop).toBeGreaterThan(-1);
    expect(resumeCall).toBeGreaterThan(resumeLoop);
    expect(resumeCallEnd).toBeGreaterThan(resumeCall);
    const autoResumeSource = profileViewSource.slice(resumeCall, resumeCallEnd);
    expect(autoResumeSource).toContain(
      "manualCheck: Date.now() - record.submittedAt >= 60_000",
    );
    expect(autoResumeSource).not.toContain("retryNotFound");

    const classicActionStart = profileViewSource.indexOf(
      "const submitCreatorClaim",
    );
    const classicV3ActionStart = profileViewSource.indexOf(
      "const submitClassicV3Action",
    );
    const deepActionStart = profileViewSource.indexOf("const submitDeepAction");
    expect(
      profileViewSource.slice(classicActionStart, classicV3ActionStart),
    ).toContain('retryNotFound: existingState.status === "not-found"');
    expect(
      profileViewSource.slice(classicV3ActionStart, deepActionStart),
    ).toContain('retryNotFound: existingState.status === "not-found"');

    for (const [index, source] of (["classic", "classic-v3"] as const).entries()) {
      const stateKey = `${secondAddress.toLowerCase()}:${source}:claim`;
      const record = {
        version: 1,
        account: firstAddress.toLowerCase(),
        chainId: 1,
        source,
        stateKey,
        action: "claim",
        transactionHash: index === 0 ? transactionHash : secondTransactionHash,
        submittedAt: Date.now() - 5 * 60_000,
      } satisfies PendingProfileTransactionRecord;
      const restored = groupPendingProfileTransactionStates([record]);
      expect(restored[source][stateKey]).toMatchObject({
        status: "pending",
        transactionHash: record.transactionHash,
      });

      const firstObservation = resolveProfileNotFoundTransaction(false);
      const afterFirstObservation = firstObservation.release
        ? removePendingProfileTransactionRecord([record], record)
        : [record];
      expect(firstObservation.status).toBe("not-found");
      expect(afterFirstObservation).toEqual([record]);

      const explicitRecheck = resolveProfileNotFoundTransaction(true);
      const afterExplicitRecheck = explicitRecheck.release
        ? removePendingProfileTransactionRecord(afterFirstObservation, record)
        : afterFirstObservation;
      expect(explicitRecheck.status).toBe("error");
      expect(afterExplicitRecheck).toEqual([]);
    }
  });

  it.each(["classic", "classic-v3"] as const)(
    "clears a persisted %s transaction when a not-found recheck confirms",
    (source) => {
      const record = {
        version: 1,
        account: firstAddress.toLowerCase(),
        chainId: 1,
        source,
        stateKey: `${secondAddress.toLowerCase()}:${source}:claim`,
        action: "claim",
        transactionHash,
        submittedAt: Date.now() - 5 * 60_000,
      } satisfies PendingProfileTransactionRecord;
      const notFound = resolveProfileNotFoundTransaction(false);
      const afterNotFound = notFound.release
        ? removePendingProfileTransactionRecord([record], record)
        : [record];
      expect(afterNotFound).toEqual([record]);

      const afterConfirmed = removePendingProfileTransactionRecord(
        afterNotFound,
        record,
      );
      expect(afterConfirmed).toEqual([]);
      expect(profileViewSource).toMatch(
        /if \(receiptStatus === "not-found"\)[\s\S]*?return;\s*\}\s*if \(receiptStatus === "reverted"\)[\s\S]*?return;\s*\}\s*forgetPendingProfileTransaction\(pendingTransaction\);\s*confirmedProfileTransactionsRef/u,
      );
    },
  );

  it("uses one receipt request for a manual status check", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ status: "pending" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const wait = vi.fn(async () => undefined);

    expect(profileTransactionPollAttempts(true)).toBe(1);
    expect(profileTransactionPollAttempts(false)).toBe(40);
    await expect(
      waitForTransaction(transactionHash, 1, {
        maxAttempts: profileTransactionPollAttempts(true),
        fetcher,
        wait,
      }),
    ).resolves.toBe("pending");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("uses the Stock-Paired receipt policy only when explicitly requested", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ status: "pending" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      waitForTransaction(transactionHash, 1, {
        maxAttempts: 1,
        fetcher,
        policy: "stock-paired",
      }),
    ).resolves.toBe("pending");

    expect(String(fetcher.mock.calls[0]?.[0])).toContain(
      "policy=stock-paired",
    );
  });

  it.each<StockPairedPendingStage>([
    "claim",
    "token-to-permit2",
    "permit2-to-router",
    "swap",
  ])("never advances a pending Stock-Paired %s receipt", (pendingStage) => {
    expect(
      resolveStockPairedReceiptGate(pendingStage, "pending"),
    ).toMatchObject({ outcome: "hold" });
    expect(
      resolveStockPairedReceiptGate(pendingStage, "unavailable"),
    ).toMatchObject({ outcome: "hold" });
    expect(
      resolveStockPairedReceiptGate(pendingStage, "reverted"),
    ).toMatchObject({ outcome: "reverted" });
    expect(
      resolveStockPairedReceiptGate(pendingStage, "confirmed"),
    ).toEqual({ outcome: "advance" });
  });

  it("aborts receipt polling before another account can inherit it", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ status: "pending" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    controller.abort();

    await expect(
      waitForTransaction(transactionHash, 1, {
        maxAttempts: 2,
        fetcher,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("interrupts the polling delay and retains the submitted hash", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | null = null;
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      requestSignal = init?.signal ?? null;
      expect(requestSignal).not.toBe(controller.signal);
      expect(requestSignal?.aborted).toBe(false);
      return new Response(JSON.stringify({ status: "pending" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await expect(
      waitForTransaction(transactionHash, 1, {
        maxAttempts: 2,
        fetcher,
        signal: controller.signal,
        wait: async () => {
          controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledTimes(1);

    const interrupted = preserveInterruptedTransactionStates({
      claim: {
        account: firstAddress,
        status: "confirming" as const,
        message: "Confirming on Ethereum",
        transactionHash,
      },
    });
    expect(interrupted.claim).toMatchObject({
      status: "pending",
      transactionHash,
    });
    expect(actionCanCheckStatus(interrupted.claim)).toBe(true);
  });

  it("polls the same hash until it becomes confirmed", async () => {
    const statuses = ["pending", "confirmed"] as const;
    let requestIndex = 0;
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          status: statuses[requestIndex++],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(
      waitForTransaction(transactionHash, 1, {
        maxAttempts: 2,
        fetcher,
        wait: async () => undefined,
      }),
    ).resolves.toBe("confirmed");

    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [request] of fetcher.mock.calls) {
      expect(String(request)).toContain(transactionHash);
    }
  });

  it("reports a reverted receipt as a retryable terminal result", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ status: "reverted" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      waitForTransaction(transactionHash, 1, {
        maxAttempts: 1,
        fetcher,
        wait: async () => undefined,
      }),
    ).resolves.toBe("reverted");

    expect(
      actionLabel({
        account: firstAddress,
        status: "error",
        message: "The reward transaction reverted onchain",
        transactionHash,
      }),
    ).toBe("Try again");
  });

  it("clears only the confirmed action whose exact hash was refreshed", () => {
    const firstKey = `${secondAddress.toLowerCase()}:claim`;
    const secondKey = `${thirdAddress.toLowerCase()}:claim`;
    const states = {
      [firstKey]: {
        account: firstAddress,
        status: "confirmed" as const,
        message: "Claim confirmed",
        transactionHash,
      },
      [secondKey]: {
        account: firstAddress,
        status: "pending" as const,
        message: "Still pending on Ethereum",
        transactionHash: secondTransactionHash,
      },
    };

    const cleared = clearConfirmedProfileActionStates(
      states,
      new Map([[firstKey, transactionHash]]),
    );
    expect(cleared[firstKey]).toBeUndefined();
    expect(cleared[secondKey]).toEqual(states[secondKey]);

    const hashMismatch = clearConfirmedProfileActionStates(
      states,
      new Map([[firstKey, secondTransactionHash]]),
    );
    expect(hashMismatch).toBe(states);
  });

  it("keeps a confirmed action suppressed until a refreshed snapshot reports zero", () => {
    const firstKey = `${secondAddress.toLowerCase()}:claim`;
    const secondKey = `${thirdAddress.toLowerCase()}:claim`;
    const reflected = reflectedConfirmedProfileTransactions(
      new Map([
        [firstKey, transactionHash],
        [secondKey, secondTransactionHash],
      ]),
      (stateKey) => (stateKey === firstKey ? 0n : 10n),
    );

    expect([...reflected]).toEqual([[firstKey, transactionHash]]);
  });

  it("restores only validated pending transactions for the connected account", () => {
    const stateKey = `${secondAddress.toLowerCase()}:claim`;
    const updateStateKey = `${secondAddress.toLowerCase()}:update-payout`;
    const record = {
      version: 1,
      account: firstAddress.toLowerCase(),
      chainId: 1,
      source: "classic-v3",
      stateKey,
      action: "claim",
      transactionHash,
      submittedAt: 1_800_000_000_000,
    } satisfies PendingProfileTransactionRecord;
    const updateRecord = {
      ...record,
      stateKey: updateStateKey,
      action: "update-payout",
      transactionHash: secondTransactionHash,
    } satisfies PendingProfileTransactionRecord;
    const serialized = JSON.stringify({
      version: 1,
      transactions: [
        record,
        updateRecord,
        { ...record, account: secondAddress.toLowerCase() },
        { ...record, transactionHash: "0x1234" },
        { ...record, stateKey: `${secondAddress.toLowerCase()}:update-payout` },
        { ...record, chainId: 10 },
      ],
    });

    expect(parsePendingProfileTransactions(serialized, firstAddress)).toEqual([
      record,
      updateRecord,
    ]);
    expect(parsePendingProfileTransactions(serialized, secondAddress)).toEqual([
      { ...record, account: secondAddress.toLowerCase() },
    ]);
    expect(parsePendingProfileTransactions("{", firstAddress)).toEqual([]);

    const restored = groupPendingProfileTransactionStates([record, updateRecord]);
    expect(restored["classic-v3"][stateKey]).toMatchObject({
      account: firstAddress.toLowerCase(),
      status: "pending",
      transactionHash,
    });
    expect(restored["classic-v3"][updateStateKey]).toMatchObject({
      account: firstAddress.toLowerCase(),
      status: "pending",
      transactionHash: secondTransactionHash,
    });
    expect(restored.classic).toEqual({});
    expect(restored.deep).toEqual({});
    expect(restored["stock-paired"]).toEqual({});
  });

  it("upserts and removes one persisted source action without touching siblings", () => {
    const firstKey = `${secondAddress.toLowerCase()}:claim`;
    const secondKey = `${thirdAddress.toLowerCase()}:claim`;
    const firstRecord = {
      version: 1,
      account: firstAddress.toLowerCase(),
      chainId: 1,
      source: "deep",
      stateKey: firstKey,
      action: "claim",
      transactionHash,
      submittedAt: 1_800_000_000_000,
    } satisfies PendingProfileTransactionRecord;
    const siblingRecord = {
      ...firstRecord,
      stateKey: secondKey,
      transactionHash: secondTransactionHash,
    } satisfies PendingProfileTransactionRecord;
    const replacement = {
      ...firstRecord,
      transactionHash: secondTransactionHash,
      submittedAt: firstRecord.submittedAt + 1_000,
    } satisfies PendingProfileTransactionRecord;

    const upserted = upsertPendingProfileTransactionRecords(
      [firstRecord, siblingRecord],
      replacement,
    );
    expect(upserted).toEqual([siblingRecord, replacement]);

    expect(
      removePendingProfileTransactionRecord(upserted, {
        source: replacement.source,
        stateKey: replacement.stateKey,
        transactionHash: replacement.transactionHash,
      }),
    ).toEqual([siblingRecord]);
    expect(
      removePendingProfileTransactionRecord(upserted, {
        source: replacement.source,
        stateKey: replacement.stateKey,
        transactionHash,
      }),
    ).toEqual(upserted);
  });

  it.each<StockPairedPendingStage>([
    "claim",
    "token-to-permit2",
    "permit2-to-router",
    "swap",
  ])("round-trips the exact pending Claim-as-ETH %s stage", (pendingStage) => {
    const stateKey = `${secondAddress.toLowerCase()}:claim-as-eth`;
    const record = {
      version: 1,
      account: firstAddress.toLowerCase(),
      chainId: 1,
      source: "stock-paired",
      stateKey,
      action: "claim-as-eth",
      transactionHash,
      submittedAt: 1_800_000_000_000,
      pendingStage,
      claimTransactionHash: secondTransactionHash,
      amountIn: "1000",
    } satisfies PendingProfileTransactionRecord;

    expect(
      parsePendingProfileTransactions(
        JSON.stringify({ version: 1, transactions: [record] }),
        firstAddress,
      ),
    ).toEqual([record]);
    expect(
      groupPendingProfileTransactionStates([record])["stock-paired"][
        stateKey
      ],
    ).toMatchObject({
      status: "pending",
      transactionHash,
      pendingStage,
      claimTransactionHash: secondTransactionHash,
      amountIn: "1000",
    });

    const malformed = {
      ...record,
      claimTransactionHash: "0x1234",
    };
    expect(
      parsePendingProfileTransactions(
        JSON.stringify({ version: 1, transactions: [malformed] }),
        firstAddress,
      ),
    ).toEqual([]);
  });

  it.each<StockPairedPendingStage>([
    "claim",
    "token-to-permit2",
    "permit2-to-router",
    "swap",
  ])("keeps the %s checkpoint until a replacement is durable", (pendingStage) => {
    const record = {
      version: 1,
      account: firstAddress.toLowerCase(),
      chainId: 1,
      source: "stock-paired",
      stateKey: `${secondAddress.toLowerCase()}:claim-as-eth`,
      action: "claim-as-eth",
      transactionHash,
      submittedAt: 1_800_000_000_000,
      pendingStage,
      claimTransactionHash: secondTransactionHash,
      amountIn: "1000",
    } satisfies PendingProfileTransactionRecord;

    expect(stockPairedCheckpointAfterReceipt(record, "advance")).toEqual(
      pendingStage === "swap" ? null : record,
    );
    expect(stockPairedCheckpointAfterReceipt(record, "reverted")).toEqual(
      pendingStage === "claim"
        ? null
        : {
            ...record,
            transactionHash: secondTransactionHash,
            pendingStage: "claim",
          },
    );
  });
});
