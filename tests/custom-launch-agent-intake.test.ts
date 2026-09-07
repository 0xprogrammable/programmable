import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  PROGRAMMABLE_AGENT_INTAKE_TEXT_V1,
  PROGRAMMABLE_AGENT_INTAKE_V1,
  PROGRAMMABLE_AGENT_SETUP_TEXT_V1,
  PROGRAMMABLE_ROBINHOOD_FUNDING_INTAKE_V1,
  PROGRAMMABLE_ROBINHOOD_FUNDING_INTAKE_TEXT_V1,
  buildProgrammableAgentSetupTextV1,
  programmableAgentIntakeV1,
  programmableRobinhoodFundingIntakeTextV1,
} from "../lib/custom-launch/agent-setup-v1";
import { PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1 } from "../lib/custom-launch/registry-public-manifest-v1";
import { V4_API_PROFILE_VERSION } from "../lib/custom-launch/v4-api-discovery";
import { programmableWellKnownDocumentV1 } from "../lib/server/custom-launch/well-known-v1";

const rawGuide = readFileSync(
  new URL("../public/developers/custom-launch-api-v1.md", import.meta.url),
  "utf8",
);
const document = programmableWellKnownDocumentV1(
  PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1,
);

describe("chain-first Custom Launch intake", () => {
  it("keeps historical funding guidance scoped to Robinhood and consistent across discovery and setup", () => {
    const funding = programmableAgentIntakeV1().chainSpecific.robinhood;
    expect(funding).toBe(PROGRAMMABLE_ROBINHOOD_FUNDING_INTAKE_V1);
    expect(funding.chainId).toBe(4663);
    expect(funding.choicesAreRequestEnumValues).toBe(false);
    expect(funding.pricingModelIsFundingSource).toBe(false);
    expect(funding.costReview.unknownCostIsZero).toBe(false);
    expect(funding.costReview.avoidDoubleCountingInitialBuy).toBe(true);
    expect(funding.platformFee.configurationIsCollectionProof).toBe(false);
    expect(funding.platformFee.treasuryIsUserSelectable).toBe(false);
    const robinhoodStart = PROGRAMMABLE_AGENT_SETUP_TEXT_V1.indexOf("Robinhood Chain Mainnet only (V4, chain 4663)");
    const ethereumStart = PROGRAMMABLE_AGENT_SETUP_TEXT_V1.indexOf("Ethereum Mainnet only (V3, chain 1)");
    const fundingStart = PROGRAMMABLE_AGENT_SETUP_TEXT_V1.indexOf(PROGRAMMABLE_ROBINHOOD_FUNDING_INTAKE_TEXT_V1);
    expect(fundingStart).toBeGreaterThan(robinhoodStart);
    expect(fundingStart).toBeLessThan(ethereumStart);
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1.slice(ethereumStart)).not.toContain(PROGRAMMABLE_ROBINHOOD_FUNDING_INTAKE_TEXT_V1);
  });

  it("uses current Native20 funding guidance consistently in the active profile and public guide", () => {
    const funding = programmableAgentIntakeV1("4.1.0").chainSpecific.robinhood;
    const setup = buildProgrammableAgentSetupTextV1("4.1.0");
    const fundingText = programmableRobinhoodFundingIntakeTextV1("4.1.0");
    expect(fundingText).toContain("Native20 charges 20 bps (0.20%)");
    expect(PROGRAMMABLE_ROBINHOOD_FUNDING_INTAKE_TEXT_V1).not.toContain("Native20 charges");
    expect(setup.indexOf(fundingText)).toBeGreaterThan(setup.indexOf("Robinhood Chain Mainnet only"));
    expect(setup.indexOf(fundingText)).toBeLessThan(setup.indexOf("Ethereum Mainnet only"));
    for (const instruction of funding.instructions) {
      expect(rawGuide).toContain(instruction);
      expect(setup).toContain(instruction);
    }
  });

  it("publishes the same preparation guidance before technical setup on every entry point", () => {
    expect(document.customLaunchApi.intake).toEqual(programmableAgentIntakeV1(V4_API_PROFILE_VERSION));
    expect(programmableAgentIntakeV1()).toBe(PROGRAMMABLE_AGENT_INTAKE_V1);
    expect(document.customLaunchApi.intake.scope).toBe("agent-preparation-not-server-authorization");
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1.indexOf(PROGRAMMABLE_AGENT_INTAKE_TEXT_V1))
      .toBeGreaterThan(0);
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1.indexOf(PROGRAMMABLE_AGENT_INTAKE_TEXT_V1))
      .toBeLessThan(PROGRAMMABLE_AGENT_SETUP_TEXT_V1.indexOf("Use the preconfigured"));
    const guideIntake = rawGuide.slice(0, rawGuide.indexOf("## API versions and release gates"));
    for (const instruction of document.customLaunchApi.intake.instructions) {
      expect(PROGRAMMABLE_AGENT_INTAKE_TEXT_V1).toContain(instruction);
      expect(guideIntake).toContain(instruction);
    }
    expect(guideIntake).toContain("customLaunchApi.intake");
  });

  it("requires an explicit supported chain and preserves prior user answers", () => {
    const selection = document.customLaunchApi.intake.chainSelection;
    expect(selection.authority).toBe("explicit-user-choice");
    expect(selection.missingOrAmbiguous).toBe("ask-user-before-proceeding");
    expect(selection.reuseExplicitPriorAnswer).toBe(true);
    expect(selection.requiredBefore).toEqual([
      "chain-specific-implementation", "build", "pack", "submit",
    ]);
    expect(selection.choices).toEqual([
      { chainId: 1, caip2: "eip155:1", name: "Ethereum Mainnet", apiVersion: "3" },
      { chainId: 4663, caip2: "eip155:4663", name: "Robinhood Chain Mainnet", apiVersion: "4" },
    ]);
    for (const choice of selection.choices) {
      expect(document.chains).toContainEqual(expect.objectContaining({
        chainId: choice.chainId, caip2: choice.caip2, name: choice.name,
      }));
    }
    expect(PROGRAMMABLE_AGENT_INTAKE_TEXT_V1).toContain("ask if the choice is missing, ambiguous or contradictory");
    expect(PROGRAMMABLE_AGENT_INTAKE_TEXT_V1).toContain("Existing explicit user answers remain valid; do not ask for them again");
  });

  it.each([
    ["a shared API key", "api-key"],
    ["the connected wallet network", "connected-wallet"],
    ["a project configuration default", "project-defaults"],
    ["a request for Uniswap V4", "uniswap-v4"],
  ] as const)("does not accept %s as the user's chain choice", (_scenario, source) => {
    expect(document.customLaunchApi.intake.chainSelection.neverInferFrom).toContain(source);
    expect(PROGRAMMABLE_AGENT_INTAKE_TEXT_V1).toContain("Uniswap V4 identifies a protocol, not a chain");
    expect(PROGRAMMABLE_AGENT_INTAKE_TEXT_V1).toContain("Do not begin chain-specific implementation until the chain is explicit");
  });

  it("requires actual metadata before building and asks about optional channels without inventing them", () => {
    const metadata = document.customLaunchApi.intake.metadata;
    expect(metadata.requiredBefore).toEqual(["build", "pack", "submit"]);
    expect(metadata.required).toEqual([
      "token.name", "token.symbol", "presentation.description",
      "presentation.image.sourcePath", "presentation.image.uri",
      "presentation.links.website", "presentation.links.x",
    ]);
    expect(metadata.askIfAvailable).toEqual(["telegram", "discord", "documentation", "github", "other"]);
    expect(metadata.additionalLinksRequired).toBe(false);
    expect(metadata.actualImageBytesRequired).toBe(true);
    expect(metadata.inventedValuesAllowed).toBe(false);
    expect(metadata.reuseExplicitPriorAnswers).toBe(true);
    expect(metadata.imagePolicy).toBe("selected-chain-pack-config-schema");
    expect(PROGRAMMABLE_AGENT_INTAKE_TEXT_V1).toContain("Do not build, pack or submit while required intake values are missing or contradictory");
    expect(rawGuide).toContain("Ethereum V3 accepts PNG, JPEG, WebP or GIF; Robinhood V4 accepts PNG or single-frame GIF");
  });

  it("keeps summary review distinct from immutable metadata and wallet authority", () => {
    expect(document.customLaunchApi.intake.review).toEqual({
      beforeSubmit: "show-complete-user-summary-and-resolve-contradictions",
      website: "same-bound-read-only-metadata",
      changedMetadata: "repack-and-revalidate-a-new-request",
      walletAuthority: "separate-controller-review-and-sign",
    });
    expect(PROGRAMMABLE_AGENT_INTAKE_TEXT_V1).toContain("chain, launch wallet, token name, ticker, bio, image preview and public URI, website, X and every additional link");
    expect(PROGRAMMABLE_AGENT_INTAKE_TEXT_V1).toContain("the controller reviews and signs the exact wallet action separately");
    expect(document.customLaunchApi.versions.v4.decisionAuthority).toBe("api-server");
    expect(document.customLaunchApi.versions.v4.localOrModelApprovalAccepted).toBe(false);
  });

  it("uses the V4 launchId for polling while retaining V3 request commands", () => {
    const lifecycle = document.customLaunchApi.versions.v4.lifecycle;
    for (const command of [lifecycle.walletStageStatusCommand, lifecycle.finalityStatusCommand]) {
      expect(command).toContain("status LAUNCH_ID --api-version 4 --chain-id 4663");
      expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(command);
      expect(rawGuide).toContain(command);
    }
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain("Use the returned launchId as LAUNCH_ID, not requestId");
    expect(rawGuide).toContain("Set `LAUNCH_ID` to the returned `launchId`, not `requestId`");
    for (const text of [PROGRAMMABLE_AGENT_SETUP_TEXT_V1, rawGuide]) {
      expect(text).not.toContain("status REQUEST_UUID --api-version 4");
      expect(text).toContain("status REQUEST_UUID --watch --until authorized");
    }
  });
});
