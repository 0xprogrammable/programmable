import { V4_API_DISCOVERY, V4_API_PROFILE_VERSION } from "../lib/custom-launch/v4-api-discovery";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1 } from "../lib/custom-launch/registry-public-manifest-v1";
import { developerDocsMarkdown } from "../lib/developer-docs-content";
import { programmablePublicOpenApi } from "../lib/public-openapi";
import {
  createProgrammableWellKnownHandlerV1,
  programmableWellKnownDocumentV1,
} from "../lib/server/custom-launch/well-known-v1";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("Robinhood Chain V4 public self-serve release discovery", () => {
  it("publishes one evidence-bound chain-specific V4 contract", () => {
    const document = programmableWellKnownDocumentV1(
      PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1,
    );
    const v4 = document.customLaunchApi.versions.v4;

    // The exact historical snapshot remains covered here; the successor's complete
    // pending/ready projection is independently checked in public-robinhood-v41-well-known.
    if (V4_API_PROFILE_VERSION === "4.0.0") expect(v4).toEqual({
      status: V4_API_DISCOVERY.status,
      runtimeStatus: "routes-deployed",
      activationStage: V4_API_DISCOVERY.activationStage,
      activationScope: V4_API_DISCOVERY.activationScope,
      publication: V4_API_DISCOVERY.publication,
      targetLaunchPath: "public-self-serve",
      publicAuthorization: V4_API_DISCOVERY.publicAuthorization,
      publicWrites: V4_API_DISCOVERY.publicWrites,
      releaseReady: V4_API_DISCOVERY.releaseReady,
      apiVersion: "4",
      profileVersion: "4.0.0",
      chainId: 4663,
      caip2: "eip155:4663",
      network: "Robinhood Chain Mainnet",
      capabilitiesPath: "/v4/chains/4663/capabilities",
      readinessPath: "/v4/chains/4663/readiness",
      preflightPath: "/v4/chains/4663/custom-launches/preflight",
      createPath: "/v4/chains/4663/custom-launches",
      statusPath: "/v4/chains/4663/custom-launches/{launchId}",
      finalizedMetadataPath: "/v4/chains/4663/finalized-custom-launches",
      openApiUrl: "https://programmable.market/openapi/custom-launch-v4.json",
      packConfigSchemaUrl:
        "https://programmable.market/schemas/custom-launch/v4/pack-config.json",
      sourceVerificationSchemaUrl:
        "https://programmable.market/schemas/custom-launch/v4/source-verification-status.json",
      guideUrl:
        "https://programmable.market/developers/custom-launch-api-v1.md",
      terminalIndexerGuideUrl:
        "https://programmable.market/developer-reference/robinhood-terminal-indexer",
      terminalIndexerFixtureUrl:
        "https://programmable.market/fixtures/robinhood-terminal-indexer-v1.json",
      launchStampRouterAbiUrl:
        "https://programmable.market/contracts/robinhood/ProgrammableLaunchStampRouterV1.abi.json",
      launchStampRouterAbiSha256:
        "sha256:bb4e728e9f9c850eb01f928e8a798ac206a82e241a8d93b3b3c686635c88ed86",
      launchStampRouterProfileNormalizedAbiSha256:
        "sha256:ab25262ce1cb907eba1cb820492754c0cd5d7278eb5fd6a024ba24c767323ac0",
      launchStampRouterProfileNormalizedAbiHashing: "jq -cS plus trailing LF",
      admissionDescriptorUrl:
        "https://github.com/programmablehq/Launch-Policy/blob/main/policy/custom-launch-admission-v4.json",
      sourceRepository: "https://github.com/programmablehq/PROGRAMMABLE",
      launchPolicyRepository: "https://github.com/programmablehq/Launch-Policy",
      cli: {
        sourceCandidateVersion: "4.0.0",
        sourceCandidate: !V4_API_DISCOVERY.cliReleased,
        released: V4_API_DISCOVERY.cliReleased,
        installable: V4_API_DISCOVERY.cliInstallable,
        release: V4_API_DISCOVERY.cliRelease,
        liveEthereumVersion: "3.3.9",
        signsWalletTransactions: false,
        broadcastsWalletTransactions: false,
      },
      lifecycle: {
        statuses: [
          "received",
          "validating",
          "action_required",
          "authorized",
          "awaiting_wallet_signature",
          "wallet_action_required",
          "submitted",
          "sequencer_soft_confirmed",
          "ethereum_posted",
          "finalized",
          "failed",
        ],
        actionRequiredMeaning:
          "server-authored-remediation-not-wallet-action",
        walletStageStatusCommand:
          "programmable-launch status LAUNCH_ID --api-version 4 --chain-id 4663 --watch --until authorized",
        finalityStatusCommand:
          "programmable-launch status LAUNCH_ID --api-version 4 --chain-id 4663 --watch --until finalized",
        sourceVerificationStartsAfter: "finalized",
        sourceVerificationIndependentFromFinality: true,
        indexingTradingAndPublicationIndependent: true,
      },
      foundationSourceCommitment:
        "0xe87f5edc2dc839bd87a26a80cb53f14b021e603a1753d27aae3a02862058d730",
      sourceVerification: {
        requiredProvider: "sourcify-v2",
        requiredMatch: "exact",
        blockscoutAvailability: "optional-unproven-degraded",
        blockscoutExactSourceClaimAllowed: false,
        blockscoutFinalityBlocker: false,
        finalityIndependent: true,
      },
      deploymentEvidence: {
        status: V4_API_DISCOVERY.releaseReady ? "verified-release" : "generator-promotion-pending",
        liveAuthorityPath: "/v4/chains/4663/readiness",
        chainDeploymentDescriptorDigest: V4_API_DISCOVERY.chainDeploymentDescriptorDigest,
        chainDeploymentId: V4_API_DISCOVERY.deployment?.chainDeploymentId ?? null,
        finalityPolicyDigest: V4_API_DISCOVERY.deployment?.finality.policyDigest ?? null,
        finalizedBlock: V4_API_DISCOVERY.deployment?.deploymentEvidence.blockNumber ?? null,
        finalizedEvidenceRef: V4_API_DISCOVERY.deployment?.deploymentEvidence.evidenceDigest ?? null,
        foundationSourceCommitment: V4_API_DISCOVERY.deployment?.foundationSourceCommitment ?? null,
        roots: {
          graphFactory: V4_API_DISCOVERY.deployment?.contracts.graphFactory.address ?? null,
          permit2: V4_API_DISCOVERY.deployment?.contracts.permit2.address ?? null,
          permitAuthoritySafe: V4_API_DISCOVERY.deployment?.contracts.permitAuthority.address ?? null,
          poolManager: V4_API_DISCOVERY.deployment?.contracts.poolManager.address ?? null,
          positionManager: V4_API_DISCOVERY.deployment?.contracts.positionManager.address ?? null,
          programmableLaunchStampRouter: V4_API_DISCOVERY.deployment?.contracts.programmableLaunchStampRouter.address ?? null,
          stateView: V4_API_DISCOVERY.deployment?.contracts.stateView.address ?? null,
          universalRouter: V4_API_DISCOVERY.deployment?.contracts.universalRouter.address ?? null,
          v4Quoter: V4_API_DISCOVERY.deployment?.contracts.v4Quoter.address ?? null,
        },
      },
      authentication: "bearer-api-key",
      apiKeyEnvironmentVariable: "PROGRAMMABLE_API_KEY",
      apiKeyPlaceholder: "$PROGRAMMABLE_API_KEY",
      walletAuthorization: "separate-review-and-sign",
      profileSelection: "api-server-chain-binding",
      clientSelectableProfile: false,
      readinessProfile: "robinhood-launch-readiness",
      productionProfile: "robinhood-production-launch",
      decisionAuthority: "api-server",
      localOrModelApprovalAccepted: false,
      projectOwnedToken: true,
      projectOwnedHook: true,
      minimumTargets: 3,
      maximumTargets: 16,
      hookPermissionMaskRange: { minimum: 0, maximum: 16_383 },
      allFourteenHookPermissionsStructurallySupported: true,
      advertisedFundingModes: ["none", "wallet-transaction-value"],
      erc20FundingStatus: "not-advertised-until-separate-proof",
      safetyClaim: false,
      feeBehaviorClaim: false,
      universalFeeBehaviorClaim: false,
      platformFeePolicyStatus: "required-default-configuration",
      platformFeePolicy: {
        required: true,
        status: "required-default-configuration",
        appliesTo: "new-robinhood-v4-api-custom-launches-only",
        changesExistingLaunches: false,
        changesEthereumLaunches: false,
        rateBps: 20,
        ratePpm: 2_000,
        ratePercent: "0.20%",
        recipient: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da",
        basis: null,
        feeCurrency: null,
        accountingMode: null,
        rounding: null,
        accrual: null,
        claimMechanism: null,
        enforcement: "not-guaranteed-onchain",
        canonicalOnchainEnforcementProven: false,
        guaranteedRevenue: false,
        feeBehaviorClaim: false,
        universalFeeBehaviorClaim: false,
      },
      genericFeeClaiming: "not-live",
      genericBuybackManagement: "not-live",
      externalIndexingGuaranteed: false,
      legacyIntake: { registry: "closed", github: "closed" },
      activationBlockers: V4_API_DISCOVERY.activationBlockers,
    });
    expect(document.chains).toContainEqual({
      chainId: 4663,
      caip2: "eip155:4663",
      name: "Robinhood Chain Mainnet",
      explorerUrl: "https://robinhoodchain.blockscout.com",
      status: V4_API_DISCOVERY.status,
      customLaunchApiVersion: "4",
      runtimeStatus: "routes-deployed",
      activationStage: V4_API_DISCOVERY.activationStage,
      activationScope: V4_API_DISCOVERY.activationScope,
      publication: V4_API_DISCOVERY.publication,
      targetLaunchPath: "public-self-serve",
      publicAuthorization: V4_API_DISCOVERY.publicAuthorization,
      publicWrites: V4_API_DISCOVERY.publicWrites,
      releaseReady: V4_API_DISCOVERY.releaseReady,
      externalIndexingGuaranteed: false,
    });
    const { foundationSourceCommitment, ...withoutSourceCommitment } = v4;
    expect(foundationSourceCommitment).toBe(
      "0xe87f5edc2dc839bd87a26a80cb53f14b021e603a1753d27aae3a02862058d730",
    );
    expect(v4.profileVersion).toBe(V4_API_PROFILE_VERSION);
    if (!V4_API_DISCOVERY.releaseReady && V4_API_PROFILE_VERSION === "4.0.0") {
      expect(JSON.stringify(withoutSourceCommitment).match(/0x[0-9a-f]{40}/giu))
        .toEqual(["0xD88539d3c4C460136a733A3Fd60cf6BF269079da"]);
    } else if (V4_API_DISCOVERY.releaseReady) {
      expect(v4.deploymentEvidence.roots.programmableLaunchStampRouter)
        .toBe(V4_API_DISCOVERY.deployment?.contracts.programmableLaunchStampRouter.address);
    }
  });

  it("serializes the same release projection through public well-known discovery", async () => {
    const response = createProgrammableWellKnownHandlerV1({})(
      new Request("https://programmable.market/.well-known/programmable.json"),
    );
    const document = await response.json();

    expect(response.status).toBe(200);
    expect(document.customLaunchApi.versions.v4).toMatchObject({
      status: V4_API_DISCOVERY.status,
      runtimeStatus: "routes-deployed",
      activationStage: V4_API_DISCOVERY.activationStage,
      activationScope: V4_API_DISCOVERY.activationScope,
      publication: V4_API_DISCOVERY.publication,
      targetLaunchPath: "public-self-serve",
      publicAuthorization: V4_API_DISCOVERY.publicAuthorization,
      publicWrites: V4_API_DISCOVERY.publicWrites,
      releaseReady: V4_API_DISCOVERY.releaseReady,
      apiVersion: "4",
      profileVersion: V4_API_PROFILE_VERSION,
      clientSelectableProfile: false,
      apiKeyPlaceholder: "$PROGRAMMABLE_API_KEY",
      feeBehaviorClaim: false,
      universalFeeBehaviorClaim: false,
      platformFeePolicyStatus: V4_API_PROFILE_VERSION === "4.1.0" ? "required-exact-native-fee-kernel" : "required-default-configuration",
      platformFeePolicy: {
        required: true,
        rateBps: 20,
        ratePpm: 2_000,
        recipient: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da",
        enforcement: V4_API_PROFILE_VERSION === "4.1.0" ? "exact-kernel-proof-required-before-wallet-handoff" : "not-guaranteed-onchain",
        canonicalOnchainEnforcementProven: false,
        guaranteedRevenue: false,
        feeBehaviorClaim: false,
        universalFeeBehaviorClaim: false,
      },
      externalIndexingGuaranteed: false,
      cli: {
        sourceCandidateVersion: V4_API_PROFILE_VERSION,
        released: V4_API_DISCOVERY.cliReleased,
        installable: V4_API_DISCOVERY.cliInstallable,
        release: V4_API_DISCOVERY.cliRelease,
        liveEthereumVersion: "3.3.9",
        signsWalletTransactions: false,
        broadcastsWalletTransactions: false,
      },
      lifecycle: {
        actionRequiredMeaning:
          "server-authored-remediation-not-wallet-action",
        sourceVerificationStartsAfter: "finalized",
        sourceVerificationIndependentFromFinality: true,
        indexingTradingAndPublicationIndependent: true,
      },
      foundationSourceCommitment:
        "0xe87f5edc2dc839bd87a26a80cb53f14b021e603a1753d27aae3a02862058d730",
      sourceVerification: {
        requiredProvider: "sourcify-v2",
        requiredMatch: "exact",
        blockscoutAvailability: "optional-unproven-degraded",
        blockscoutExactSourceClaimAllowed: false,
        blockscoutFinalityBlocker: false,
        finalityIndependent: true,
      },
      deploymentEvidence: {
        chainDeploymentDescriptorDigest: V4_API_DISCOVERY.chainDeploymentDescriptorDigest,
        chainDeploymentId: V4_API_DISCOVERY.deployment?.chainDeploymentId ?? null,
        finalityPolicyDigest: V4_API_DISCOVERY.deployment?.finality.policyDigest ?? null,
        finalizedBlock: V4_API_DISCOVERY.deployment?.deploymentEvidence.blockNumber ?? null,
        finalizedEvidenceRef: V4_API_DISCOVERY.deployment?.deploymentEvidence.evidenceDigest ?? null,
        foundationSourceCommitment: V4_API_DISCOVERY.deployment?.foundationSourceCommitment ?? null,
      },
    });
  });

  it("keeps public guides aligned with the conditional public-release boundary", () => {
    const developerGuide = read("docs/public/developers/custom-launch.md");
    const rawGuide = read("public/developers/custom-launch-api-v1.md");
    const websiteGuide = read("app/docs/developers/custom-launch/page.tsx");
    const machineReadablePage = read(
      "app/docs/developers/machine-readable/page.tsx",
    );
    const publicDocs = [
      read("README.md"),
      read("docs/public/README.md"),
      read("docs/public/creators/launch.md"),
      read("docs/public/developers/README.md"),
      developerGuide,
      read("docs/public/reference/official-links.md"),
      read("docs/public/status.md"),
      rawGuide,
      read("packages/launch/README.md"),
      websiteGuide,
      machineReadablePage,
      developerDocsMarkdown,
    ].join("\n");

    expect(publicDocs).toMatch(/Robinhood Chain V4/iu);
    expect(publicDocs).toMatch(/public self-serve/iu);
    expect(publicDocs).toMatch(/pending-public-discovery-promotion/iu);
    expect(publicDocs).toContain("$PROGRAMMABLE_API_KEY");
    expect(publicDocs).toMatch(/external index/iu);
    expect(publicDocs).toMatch(/generic fee claiming/iu);
    expect(publicDocs).toMatch(/generic buyback management/iu);
    expect(publicDocs).toContain("eip155:4663");
    expect(publicDocs).toMatch(/external.contract reference/iu);
    expect(publicDocs).toMatch(/runtime hash/iu);
    expect(publicDocs).toMatch(/source-verification evidence|source evidence/iu);
    expect(publicDocs).toMatch(/declared graph role|graph role/iu);
    expect(publicDocs).toMatch(/checkpoint/iu);
    expect(publicDocs).toMatch(/arbitrary\s+or\s+unbound/iu);
    expect(publicDocs).toMatch(/gain no trust|do not gain trust|does not make it a trust root/iu);
    expect(publicDocs).toContain(
      "0xe87f5edc2dc839bd87a26a80cb53f14b021e603a1753d27aae3a02862058d730",
    );
    expect(publicDocs).toMatch(/Sourcify v2 provider-native `match`/iu);
    expect(publicDocs).toMatch(/protected-build\/finalized-bytecode binding/iu);
    expect(publicDocs).toMatch(/Blockscout/iu);
    expect(publicDocs).toMatch(/Blockscout[\s\S]{0,180}optional|optional[\s\S]{0,100}Blockscout/iu);
    expect(publicDocs).toMatch(/do not establish the protected exact-source claim|cannot support an exact-source claim/iu);
    expect(publicDocs).toMatch(/block or revise finality|not a finality blocker/iu);
    expect(developerGuide).toContain("/v4/chains/4663/capabilities");
    expect(rawGuide).toContain("/v4/chains/4663/custom-launches/{launchId}");
    expect(publicDocs).toContain(
      "https://programmable.market/openapi/custom-launch-v4.json",
    );
    expect(publicDocs).toContain(
      "https://programmable.market/schemas/custom-launch/v4/pack-config.json",
    );
    expect(publicDocs).toContain(
      "https://github.com/programmablehq/PROGRAMMABLE",
    );
    expect(publicDocs).toContain("source candidate");
    expect(publicDocs).toContain("4.0.0");
    expect(publicDocs).toContain("releaseReady: false");
    expect(publicDocs).toContain(
      "programmable-launch status LAUNCH_ID --api-version 4 --chain-id 4663",
    );
    for (const status of [
      "received",
      "validating",
      "action_required",
      "authorized",
      "awaiting_wallet_signature",
      "wallet_action_required",
      "submitted",
      "sequencer_soft_confirmed",
      "ethereum_posted",
      "finalized",
      "failed",
    ]) {
      expect(publicDocs).toContain(status);
    }
    expect(publicDocs).toMatch(/action_required[\s\S]{0,260}(?:not a wallet|remediation)/iu);
    expect(publicDocs).toMatch(/source verification[\s\S]{0,180}(?:after finality|starts after|starts only after)/iu);
    expect(publicDocs).toMatch(/(?:never signs or broadcasts|never sign or broadcast)/iu);
    expect(publicDocs).not.toContain(
      "https://github.com/0xprogrammable/PROGRAMMABLE/releases",
    );

    expect(programmablePublicOpenApi["x-programmable-availability"].v4)
      .toMatchObject({
        status: V4_API_DISCOVERY.status,
        runtimeStatus: "routes-deployed",
        activationStage: V4_API_DISCOVERY.activationStage,
      activationScope: V4_API_DISCOVERY.activationScope,
      publication: V4_API_DISCOVERY.publication,
        targetLaunchPath: "public-self-serve",
        profileVersion: V4_API_PROFILE_VERSION,
        released: V4_API_DISCOVERY.cliReleased,
        installable: V4_API_DISCOVERY.cliInstallable,
        release: V4_API_DISCOVERY.cliRelease,
        releaseReady: V4_API_DISCOVERY.releaseReady,
        publicAuthorization: V4_API_DISCOVERY.publicAuthorization,
        publicWrites: V4_API_DISCOVERY.publicWrites,
        chainId: 4663,
        caip2: "eip155:4663",
        cliWalletAuthority: false,
        sourceVerificationStartsAfter: "finalized",
        sourceVerificationIndependentFromFinality: true,
        indexingTradingAndPublicationIndependent: true,
      });
  });
});
