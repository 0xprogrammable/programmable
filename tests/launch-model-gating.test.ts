import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { POST } from "../app/api/launch/preflight/route";
import {
  DeepFeeStep,
  DeepPresetStep,
  normalizeDeepDraft,
  stockQuoteOptionTabIndex,
} from "../components/launch-builder";
import { LaunchModelPicker } from "../components/launch-entry";
import appDeployments from "../contracts/config/app-deployments.v1.json";
import {
  createClassicV3Draft,
  createDeepDraft,
  createStockPairedDraft,
} from "../lib/launch";
import {
  isFutureLaunchModelManifestEligible,
  resolveImplementedLaunchModel,
  resolveReservedLaunchModel,
  type LaunchModelReleaseManifest,
} from "../lib/launch-model-gating";
import {
  getConfiguredClassicV3Release,
  isClassicV3ReleaseVerified,
} from "../lib/classic-v3-release";
import { STOCK_PAIRED_ETH_QUOTE_ASSETS } from "../lib/stock-paired";

const account = "0x1111111111111111111111111111111111111111";
const launcher = "0x2222222222222222222222222222222222222222";
const automation =
  "0x3333333333333333333333333333333333333333";
const keeperExecutor =
  "0x4444444444444444444444444444444444444444";
const runtimeCodeHash = `0x${"11".repeat(32)}`;

function eligibleDeepManifest(): LaunchModelReleaseManifest {
  return {
    chainId: 1,
    status: "ready",
    launchModelReleases: {
      deep: {
        schemaVersion: 2,
        model: "deep",
        internalContractRelease: "liquidity-growth-full-range-v2",
        releaseVersion: "deep-full-range-v2",
        releaseCommit: "1".repeat(40),
        sourceCommitment: runtimeCodeHash,
        releaseManifest:
          "contracts/deployments/mainnet-deep-full-range-v2.json",
        status: "deployment-source-and-lifecycle-verified",
        releaseEligible: true,
        sourceVerificationStatus: "verified",
        deploymentVerificationStatus: "verified",
        launcher,
        hookFactory: launcher,
        feeHook: launcher,
        feeSplitVaultFactory: launcher,
        rangeSourceFactory: launcher,
        growthVaultFactory: launcher,
        growthVaultImplementation: launcher,
        automation,
        positionPlanner: launcher,
        positionForwarderFactory: launcher,
        startBlock: 1,
        deploymentBlock: 1,
        deploymentTransaction: runtimeCodeHash,
        lifecycleEvidenceHash: runtimeCodeHash,
        lifecycleStatus: "verified-current-release",
        lifecycleIndependentRpcCount: 2,
        lifecycleLaunchTransaction: `0x${"22".repeat(32)}`,
        lifecycleOracleTransaction: `0x${"33".repeat(32)}`,
        lifecycleFeeProcessCompoundTransaction: `0x${"44".repeat(32)}`,
        keeperReleaseVersion: "deep-keeper-v2",
        keeperCompatibilityStatus: "verified-deep-v2",
        keeperExecutor,
        keeperExecutorRuntimeCodeHash: runtimeCodeHash,
        keeperExecutorSourceCommitment: runtimeCodeHash,
        keeperExecutorDeploymentTransaction: `0x${"55".repeat(32)}`,
        keeperExecutorDeploymentBlock: 2,
        keeperExecutorSourceVerificationStatus:
          "etherscan-and-sourcify-exact-match",
        fixedPolicy: {
          tokenSupplyWei:
            "1000000000000000000000000000",
          tokenReserveTargetWei:
            "150000000000000000000000000",
          growthTargetNativeWei: "50000000000000000",
          totalSwapFeeBps: 100,
          creatorFeeBps: 90,
          programmableFeeBps: 10,
          minimumInitialBuyWei: "600000000000000",
          initialTick: 204200,
          tickSpacing: 200,
          lpFeePips: 0,
          twapWindowSeconds: 1800,
          oracleRangeHalfWidthTicks: 20000,
          maximumSpotTwapDeviationTicks: 600,
          maximumAbsoluteTickDelta: 400,
          compoundCooldownSeconds: 300,
          rollingExposureWindowSeconds: 1800,
          rollingExposureRecordCapacity: 8,
          minimumKeeperProcessNativeWei: "2000000000000000",
          oracleObservationCardinalityTarget: 192,
        },
        runtimeCodeHashes: {
          launcher: runtimeCodeHash,
          hookFactory: runtimeCodeHash,
          feeHook: runtimeCodeHash,
          feeSplitVaultFactory: runtimeCodeHash,
          rangeSourceFactory: runtimeCodeHash,
          growthVaultFactory: runtimeCodeHash,
          growthVaultImplementation: runtimeCodeHash,
          automation: runtimeCodeHash,
          positionPlanner: runtimeCodeHash,
          positionForwarderFactory: runtimeCodeHash,
        },
      },
    },
  };
}

function reviewedDeepBinding(manifest = eligibleDeepManifest()) {
  const release = manifest.launchModelReleases?.deep;
  if (!release) throw new Error("Deep fixture missing");
  return {
    schemaVersion: 1,
    status: "reviewed",
    manifestPath:
      "contracts/deployments/mainnet-deep-full-range-v2.json",
    model: "deep",
    releaseVersion: "deep-full-range-v2",
    internalContractRelease: "liquidity-growth-full-range-v2",
    sourceCommitment: release.sourceCommitment,
    automationAddress: release.automation,
    automationRuntimeCodeHash: release.runtimeCodeHashes?.automation,
    automationFqcn:
      "src/LiquidityGrowthFullRangeAutomationV2.sol:LiquidityGrowthFullRangeAutomationV2",
    coordinatorAddress: release.keeperExecutor,
    coordinatorRuntimeCodeHash:
      release.keeperExecutorRuntimeCodeHash,
    coordinatorSourceCommitment:
      release.keeperExecutorSourceCommitment,
    coordinatorFqcn:
      "src/DeepKeeperExecutorV1.sol:DeepKeeperExecutorV1",
  };
}

describe("unreleased launch model gating", () => {
  const removedPartnerMarkers = [
    `data-launch-model-option="${String.fromCharCode(97, 101, 111, 110)}"`,
    `data-launch-model-option="${String.fromCharCode(98, 97, 115, 101, 100, 98, 105, 100)}"`,
    String.fromCharCode(97, 101, 111, 110, 102, 114, 97, 109, 101, 119, 111, 114, 107),
    ["based", "bidx"].join(""),
    `${String.fromCharCode(97, 101, 111, 110)}-framework-v1.webp`,
    `${String.fromCharCode(98, 97, 115, 101, 100, 98, 105, 100)}-v2.png`,
  ];

  it("keeps one Stock-Paired quote option in the tab order", () => {
    expect(
      Array.from({ length: 6 }, (_, index) =>
        stockQuoteOptionTabIndex(index, 2),
      ),
    ).toEqual([-1, -1, 0, -1, -1, -1]);
  });

  it("offers Classic and Custom on Ethereum without bypassing launch authority", () => {
    const html = renderToStaticMarkup(
      createElement(LaunchModelPicker, {
        chainId: 1,
        onChoose: () => undefined,
      }),
    );

    expect(html.match(/data-launch-model-option=/g)).toHaveLength(2);
    expect(html).toContain('<h1 class="sr-only">Launch</h1>');
    expect(html).toContain('<legend class="sr-only">Launch chain</legend>');
    expect(html).toContain('aria-label="Ethereum"');
    expect(html).toContain('aria-label="Robinhood"');
    expect(html).not.toContain("Choose a chain");
    expect(html).toMatch(/name="launch-chain"[^>]*checked=""[^>]*value="1"/);
    expect(html).not.toContain('data-launch-model-option="prediction"');
    expect(html).toContain('data-launch-model-option="classic"');
    const classicCard = html.match(
      /<button[^>]*data-launch-model-option="classic"[^>]*>/,
    )?.[0];
    expect(classicCard).toContain("data-launch-model-launchable=");
    expect(html).toContain(
      'id="launch-model-classic-title">Classic</strong>',
    );
    expect(html).not.toContain("Ethereum only");
    expect(html).not.toContain('id="launch-model-classic-status"');
    expect(html).toContain(
      'aria-describedby="launch-model-classic-description"',
    );
    expect(html).toContain('data-launch-model-option="custom"');
    const customCard = html.match(
      /<a[^>]*data-launch-model-option="custom"[^>]*>/,
    )?.[0];
    expect(customCard).toContain('data-launch-model-available="true"');
    expect(customCard).toContain('data-launch-model-entry="api-key-launch"');
    expect(customCard).toContain('data-launch-model-launchable="false"');
    expect(customCard).toContain(
      'href="/developers/api-keys"',
    );
    expect(customCard).not.toContain("disabled");
    expect(html).toContain(
      'id="launch-model-custom-title">Custom V4 Hook</strong>',
    );
    expect(html).toContain("Launch a Classic Coin");
    expect(html).toContain(
      "Build your own Uniswap v4 hook and submit it with an API key. Your wallet reviews and signs the launch.",
    );
    expect(html).toContain("Open Custom V4 Hook");
    expect(html).not.toContain("approved GitHub revision");
    expect(html.indexOf('data-launch-model-option="classic"')).toBeLessThan(
      html.indexOf('data-launch-model-option="custom"'),
    );
    for (const marker of removedPartnerMarkers) {
      expect(html).not.toContain(marker);
    }
    // Next/Image may emit the source as an encoded optimizer URL. Assert the
    // asset identity without coupling this contract to that transport detail.
    expect(html.match(/programmable-floral-hooks-v1\.webp/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain("In development");
    expect(html).not.toContain("launch-model-classic-details");
    expect(html).not.toContain('data-launch-model-option="stock-paired"');
    expect(html).not.toContain("<strong>Stock-Paired</strong>");
    expect(html).not.toContain('data-launch-model-option="deep"');
    expect(html).not.toContain("<strong>Deep</strong>");
    expect(html).not.toMatch(/adaptive/i);
    expect(html).not.toContain("LiquidityGrowth");
    expect(html).not.toContain("Liquidity Growth");
  });

  it("offers Module Mode preview and the Custom API entry on Robinhood", () => {
    const html = renderToStaticMarkup(
      createElement(LaunchModelPicker, {
        chainId: 4663,
        onChoose: () => undefined,
      }),
    );
    expect(html.match(/data-launch-model-option=/g)).toHaveLength(2);
    const modulesCard = html.match(/<a[^>]*data-launch-model-option="modules"[^>]*>/u)?.[0];
    expect(modulesCard).toContain('href="/launch/modules"');
    expect(modulesCard).toContain('data-launch-model-launchable="false"');
    expect(html).toContain('id="launch-model-modules-status">Preview</small>');
    expect(html).not.toContain('data-launch-model-option="classic"');
    expect(html).toMatch(/name="launch-chain"[^>]*checked=""[^>]*value="4663"/);
    expect(html).not.toContain('data-launch-model-option="prediction"');
    expect(html).toContain('data-launch-model-option="custom"');
    expect(html).toContain('id="launch-model-custom-title"');
    expect(html).toContain('data-launch-model-available="true"');
    expect(html).toContain('data-launch-model-entry="api-key-launch"');
    expect(html).toContain('data-launch-model-launchable="false"');
    expect(html).not.toContain("Preflight required");
    expect(html).toContain(
      'href="/developers/api-keys"',
    );
    expect(html).toContain("Open Custom V4 Hook");
    expect(html).not.toContain("approved GitHub revision");
    expect(html).not.toContain("Build or resume");
  });

  it("keeps the Deep preset concise while retaining its material limits", () => {
    const html = renderToStaticMarkup(createElement(DeepPresetStep));

    expect(html).toContain("<h2");
    expect(html).toContain("How Deep works");
    expect(html).toContain(
      "The growth fee buys the token and adds both assets",
    );
    expect(html).toContain("<summary>Execution details</summary>");
    expect(html).toContain("1.00%");
    expect(html).toContain("0.90%");
    expect(html).toContain("0.10%");
    expect(html).toContain("Any Uniswap protocol fee");
    expect(html).toContain("has not received an independent external audit");
  });

  it("keeps the Deep launch controls limited to the initial buy", () => {
    const html = renderToStaticMarkup(
      createElement(DeepFeeStep, {
        draft: createDeepDraft(),
        setDraft: () => undefined,
        onEdit: () => undefined,
      }),
    );

    expect(html).toContain("Initial buy");
    expect(html).toContain("ETH added when the token launches");
    expect(html).not.toContain(">Max<");
    expect(html).not.toContain("Deep fee");
    expect(html).not.toContain("Pool growth");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("Another wallet");
    expect(html).not.toContain("Split rewards");
    expect(html).not.toContain("Add recipient");
  });

  it("removes stale Classic V3 fee and reward choices from Deep drafts", () => {
    expect(
      normalizeDeepDraft({
        ...createDeepDraft(),
        buySwapFeePercent: "7",
        sellSwapFeePercent: "10",
        rewardDestinationMode: "external",
        rewardExternalAddress:
          "0x2222222222222222222222222222222222222222",
        rewardSplits: [
          {
            beneficiary:
              "0x3333333333333333333333333333333333333333",
            sharePercent: "100",
          },
        ],
      }),
    ).toMatchObject({
      launchModel: "deep",
      totalSwapFeePercent: "1",
      buySwapFeePercent: "1",
      sellSwapFeePercent: "1",
      rewardDestinationMode: "launcher",
      rewardExternalAddress: "",
      rewardSplits: [],
    });
  });

  it("does not resolve reserved or unknown identifiers as implemented models", () => {
    expect(resolveImplementedLaunchModel("classic")).toBe("classic");
    expect(resolveImplementedLaunchModel("classic-v3")).toBe("classic-v3");
    expect(resolveImplementedLaunchModel("adaptive")).toBeNull();
    expect(resolveImplementedLaunchModel("deep")).toBeNull();
    expect(resolveImplementedLaunchModel("liquidity-growth")).toBeNull();
    expect(resolveImplementedLaunchModel("unknown")).toBeNull();
    expect(resolveReservedLaunchModel("deep")).toBeNull();
    expect(resolveReservedLaunchModel("liquidity-growth")).toBe("deep");
  });

  it("requires an exact verified release record before Deep can be eligible", () => {
    expect(
      isFutureLaunchModelManifestEligible("deep", appDeployments.production, 1),
    ).toBe(false);

    const manifest = eligibleDeepManifest();
    const binding = reviewedDeepBinding(manifest);
    expect(isFutureLaunchModelManifestEligible("deep", manifest, 1)).toBe(
      false,
    );
    expect(
      isFutureLaunchModelManifestEligible("deep", manifest, 1, binding),
    ).toBe(true);
    expect(
      isFutureLaunchModelManifestEligible(
        "liquidity-growth",
        manifest,
        1,
        binding,
      ),
    ).toBe(true);
    expect(
      isFutureLaunchModelManifestEligible(
        "deep",
        {
          ...manifest,
          launchModelReleases: {
            deep: {
              ...manifest.launchModelReleases?.deep,
              deploymentVerificationStatus: "pending",
            },
          },
        },
        1,
        binding,
      ),
    ).toBe(false);
    expect(
      isFutureLaunchModelManifestEligible(
        "deep",
        manifest,
        11_155_111,
        binding,
      ),
    ).toBe(false);

    const historicalV1 = eligibleDeepManifest();
    Object.assign(historicalV1.launchModelReleases?.deep ?? {}, {
      schemaVersion: 1,
      internalContractRelease: "liquidity-growth-full-range-v1",
      releaseVersion: "deep-full-range-v1",
      releaseManifest:
        "contracts/deployments/mainnet-deep-full-range-v1.json",
    });
    expect(
      isFutureLaunchModelManifestEligible(
        "deep",
        historicalV1,
        1,
        binding,
      ),
    ).toBe(false);
  });

  it.each([
    ["sourceCommitment", "0x1234"],
    ["lifecycleStatus", "launch-and-oracle-verified"],
    ["lifecycleIndependentRpcCount", 1],
    ["lifecycleOracleTransaction", null],
    ["lifecycleFeeProcessCompoundTransaction", `0x${"33".repeat(32)}`],
    ["keeperExecutorDeploymentTransaction", null],
    ["keeperExecutorDeploymentBlock", 0],
    ["keeperExecutorSourceVerificationStatus", "pending"],
    ["keeperReleaseVersion", "deep-keeper-v1"],
    ["keeperCompatibilityStatus", "unverified"],
  ])("rejects an otherwise eligible mirror with invalid %s", (field, value) => {
    const manifest = eligibleDeepManifest();
    const binding = reviewedDeepBinding(manifest);
    if (!manifest.launchModelReleases?.deep) {
      throw new Error("Deep fixture missing");
    }
    Object.assign(manifest.launchModelReleases.deep, { [field]: value });
    expect(
      isFutureLaunchModelManifestEligible("deep", manifest, 1, binding),
    ).toBe(false);
  });

  it("rejects any drift from the exact V2 fixed policy", () => {
    const manifest = eligibleDeepManifest();
    const binding = reviewedDeepBinding(manifest);
    if (!manifest.launchModelReleases?.deep?.fixedPolicy) {
      throw new Error("Deep V2 policy fixture missing");
    }
    manifest.launchModelReleases.deep.fixedPolicy.compoundCooldownSeconds =
      1_800;
    expect(
      isFutureLaunchModelManifestEligible("deep", manifest, 1, binding),
    ).toBe(false);
  });

  it.each(["deep", "liquidity-growth"])(
    "rejects %s before preflight can prepare a transaction",
    async (launchModel) => {
      const request = new NextRequest("http://localhost/api/launch/preflight", {
        method: "POST",
        body: JSON.stringify({
          account,
          walletChainId: "0x1",
          draft: { launchModel },
        }),
      });

      const result = await POST(request);
      expect(result.status).toBe(410);
      await expect(result.json()).resolves.toEqual({
        code: "deep_launches_closed",
        error: "New Deep launches are not available",
      });
    },
  );

  it("keeps Classic preflight bound to the verified Mainnet release", async () => {
    const release = getConfiguredClassicV3Release("production");
    expect(
      isClassicV3ReleaseVerified(
        appDeployments.production,
        release.releaseManifest,
        1,
      ),
    ).toBe(true);

    const request = new NextRequest("http://localhost/api/launch/preflight", {
      method: "POST",
      body: JSON.stringify({
        account,
        walletChainId: "0xaa36a7",
        draft: {
          ...createClassicV3Draft(),
          tokenName: "Verified Classic",
          tokenSymbol: "VC",
          tokenDescription: "Release-gate test",
          launchSalt: `0x${"22".repeat(32)}`,
        },
      }),
    });

    const result = await POST(request);
    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toMatchObject({
      status: "blocked",
      mode: "classic-v3",
      title: "Switch the wallet to Ethereum",
      checks: [
        { id: "token", status: "pass" },
        { id: "wallet", status: "blocked" },
      ],
    });
  });

  it("rejects new Stock-Paired launches with a stable retired-model response", async () => {
    const request = new NextRequest("http://localhost/api/launch/preflight", {
      method: "POST",
      body: JSON.stringify({
        account,
        walletChainId: "0xaa36a7",
        draft: {
          ...createStockPairedDraft(),
          tokenName: "Public Stock Pair",
          tokenSymbol: "PSP",
          tokenDescription: "Checked-in release gate test",
          stockQuoteAsset: STOCK_PAIRED_ETH_QUOTE_ASSETS[0].address,
          launchSalt: `0x${"44".repeat(32)}`,
        },
      }),
    });

    const result = await POST(request);
    expect(result.status).toBe(410);
    await expect(result.json()).resolves.toEqual({
      code: "stock_paired_launches_closed",
      error: "New Stock-Paired launches are no longer available",
    });
  });
});
