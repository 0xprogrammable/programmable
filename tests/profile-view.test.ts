import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";

import {
  actionCanCheckStatus,
  actionLabel,
  actionPending,
  buildFeeEarningsChart,
  buildProfilePortfolio,
  clearConfirmedProfileActionStates,
  getProfileSessionView,
  getProfileWorkspacePhase,
  getStockPairedClaimPaths,
  groupPendingProfileTransactionStates,
  groupProfileRewards,
  parsePendingProfileTransactions,
  parseClaimedFeeWei,
  paginateProfileClaimableEntries,
  PROFILE_LIVE_REFRESH_INTERVAL_MS,
  profileClaimableWei,
  profileClaimActionCount,
  profileEntryHasClaimableReward,
  profileHasRewardSurface,
  profileRewardsForAccount,
  profileTransactionPollAttempts,
  reflectedConfirmedProfileTransactions,
  preserveInterruptedTransactionStates,
  removePendingProfileTransactionRecord,
  resolveStockPairedReceiptGate,
  sortProfileTokensByMarketCap,
  sortProfileClaimableEntries,
  shouldShowStockPairedEthClaimPath,
  stockPairedCheckpointAfterReceipt,
  upsertPendingProfileTransactionRecords,
  waitForTransaction,
  withoutClosedDeepProfileData,
  type PendingProfileTransactionRecord,
  type StockPairedPendingStage,
} from "../components/profile-view";
import type { ClassicV3Reward } from "../lib/profile/classic-v3-rewards";
import type { DeepV3CreatorToken } from "../lib/profile/deep-v3-profile";
import type {
  ProfileClaim,
  ProfileToken,
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
const profileViewSource = readFileSync(
  new URL("../components/profile-view.tsx", import.meta.url),
  "utf8",
);

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

const classicAllocation = {
  allocationIndex: 0,
  beneficiary: firstAddress,
  payoutAddress: firstAddress,
  shareBps: 10_000,
};

const classicReward = {
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
  it("does not hammer reward providers with five-second profile polling", () => {
    expect(PROFILE_LIVE_REFRESH_INTERVAL_MS).toBe(60_000);
  });

  it("keeps the profile in a stable loading shell while the wallet session hydrates", () => {
    expect(getProfileSessionView(true)).toBe("loading");
    expect(getProfileSessionView(true, firstAddress)).toBe("loading");
    expect(getProfileSessionView(false)).toBe("connect");
    expect(getProfileSessionView(false, firstAddress)).toBe("profile");
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

  it("reveals one complete workspace after optional reward sources finish", () => {
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
      /if \(statuses\.some\(\(status\) => status === "loading"\)\)[\s\S]*?return "loading";[\s\S]*?status === "ready"/,
    );
  });

  it("keeps claim rows in page flow and adapts the narrow claim panel", () => {
    expect(profileExperienceCss).not.toMatch(
      /\.profileWorkspace\s*\{[\s\S]*?height: clamp\(/,
    );
    expect(profileExperienceCss).not.toMatch(
      /\.claimList\s*\{[^}]*overflow-y: auto;/,
    );
    expect(profileExperienceCss).toContain("@container (max-width: 420px)");
    expect(profileExperienceCss).toMatch(
      /@media \(max-width: 820px\)[\s\S]*?\.profileWorkspace/,
    );
  });
});

describe("fee earnings chart", () => {
  it("builds a cumulative chart from confirmed claims without inferred accrual", () => {
    const activity = [
      {
        id: "claim:new",
        label: "Creator fees claimed",
        detail: "0.3 ETH from NEW",
        occurredAt: "Today",
        occurredAtIso: "2026-08-04T11:30:00.000Z",
        href: "/token/new",
      },
      {
        id: "claim:old",
        label: "Creator fees claimed",
        detail: "0.2 ETH from OLD",
        occurredAt: "Yesterday",
        occurredAtIso: "2026-08-03T11:30:00.000Z",
        href: "/token/old",
      },
    ];

    expect(parseClaimedFeeWei("0.25 ETH from TEST")).toBe(
      250_000_000_000_000_000n,
    );
    const chart = buildFeeEarningsChart(
      activity,
      500_000_000_000_000_000n,
      100_000_000_000_000_000n,
    );

    expect(chart?.points.map((point) => point.valueWei)).toEqual([
      0n,
      200_000_000_000_000_000n,
      500_000_000_000_000_000n,
      500_000_000_000_000_000n,
    ]);
    expect(chart?.totalWei).toBe(500_000_000_000_000_000n);
  });

  it("uses exact 1H, 1D, 1W and all-time earnings windows", () => {
    const nowMs = Date.parse("2026-08-04T12:00:00.000Z");
    const activity = [
      {
        id: "claim:hour",
        label: "Creator fees claimed",
        detail: "0.1 ETH from NOW",
        occurredAt: "Today",
        occurredAtIso: "2026-08-04T11:30:00.000Z",
        href: "/token/now",
      },
      {
        id: "claim:day",
        label: "Creator fees claimed",
        detail: "0.2 ETH from DAY",
        occurredAt: "Today",
        occurredAtIso: "2026-08-04T06:00:00.000Z",
        href: "/token/day",
      },
      {
        id: "claim:week",
        label: "Creator fees claimed",
        detail: "0.3 ETH from WEEK",
        occurredAt: "This week",
        occurredAtIso: "2026-08-01T12:00:00.000Z",
        href: "/token/week",
      },
      {
        id: "claim:all",
        label: "Creator fees claimed",
        detail: "0.4 ETH from OLD",
        occurredAt: "Last week",
        occurredAtIso: "2026-07-24T12:00:00.000Z",
        href: "/token/old",
      },
    ];

    const hourly = buildFeeEarningsChart(
      activity,
      1_000_000_000_000_000_000n,
      50_000_000_000_000_000n,
      { nowMs, range: "1h" },
    );
    const daily = buildFeeEarningsChart(
      activity,
      1_000_000_000_000_000_000n,
      50_000_000_000_000_000n,
      { nowMs, range: "1d" },
    );
    const weekly = buildFeeEarningsChart(
      activity,
      1_000_000_000_000_000_000n,
      50_000_000_000_000_000n,
      { nowMs, range: "1w" },
    );
    const allTime = buildFeeEarningsChart(
      activity,
      1_000_000_000_000_000_000n,
      50_000_000_000_000_000n,
      { nowMs, range: "all" },
    );

    expect(hourly?.totalWei).toBe(100_000_000_000_000_000n);
    expect(daily?.totalWei).toBe(300_000_000_000_000_000n);
    expect(weekly?.totalWei).toBe(600_000_000_000_000_000n);
    expect(allTime?.totalWei).toBe(1_000_000_000_000_000_000n);
    expect(profileViewSource).toContain('role="slider"');
    expect(profileViewSource).not.toContain("styles.claimHistory");
  });

  it("keeps the claim dialog focused on the selected token and actions", () => {
    expect(profileViewSource).not.toContain(">Claimable rewards<");
    expect(profileViewSource).not.toContain(
      "Choose the reward you want to claim.",
    );
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

  it("keeps six claimable entries in a stable order before pagination", () => {
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
      "C1",
      "C2",
      "C3",
      "C4",
      "C5",
      "C6",
    ]);
    expect(firstPage).toMatchObject({ currentPage: 1, totalPages: 2 });
    expect(firstPage.items.map((entry) => entry.token.symbol)).toEqual([
      "C1",
      "C2",
      "C3",
      "C4",
      "C5",
    ]);
    expect(secondPage).toMatchObject({ currentPage: 2, totalPages: 2 });
    expect(secondPage.items.map((entry) => entry.token.symbol)).toEqual([
      "C6",
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
  });

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
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.signal).toBe(controller.signal);
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
    const serialized = JSON.stringify({
      version: 1,
      transactions: [
        record,
        { ...record, account: secondAddress.toLowerCase() },
        { ...record, transactionHash: "0x1234" },
        { ...record, stateKey: `${secondAddress.toLowerCase()}:update-payout` },
        { ...record, chainId: 10 },
      ],
    });

    expect(parsePendingProfileTransactions(serialized, firstAddress)).toEqual([
      record,
    ]);
    expect(parsePendingProfileTransactions(serialized, secondAddress)).toEqual([
      { ...record, account: secondAddress.toLowerCase() },
    ]);
    expect(parsePendingProfileTransactions("{", firstAddress)).toEqual([]);

    const restored = groupPendingProfileTransactionStates([record]);
    expect(restored["classic-v3"][stateKey]).toMatchObject({
      account: firstAddress.toLowerCase(),
      status: "pending",
      transactionHash,
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
