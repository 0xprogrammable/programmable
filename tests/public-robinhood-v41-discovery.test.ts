import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { robinhoodV4PublicContractDiscovery, robinhoodV4PublicPolicyDescription } from "../lib/custom-launch/v4-public-contract-discovery";

const discovery = {
  status: "source-candidate", activationStage: "pending", activationScope: "public-self-serve", publication: "pending",
  cliReleased: false, cliInstallable: false, cliRelease: null, releaseReady: false, publicAuthorization: false,
  publicWrites: false, activationBlockers: ["test-activation-blocker"],
};
async function document(profileVersion: "4.0.0" | "4.1.0", ready = false) {
  vi.resetModules();
  vi.doMock("../lib/custom-launch/v4-api-discovery", () => ({ V4_API_PROFILE_VERSION: profileVersion,
    V4_API_DISCOVERY: { ...discovery, ...(ready ? { status: "live", cliReleased: true, cliInstallable: true,
      cliRelease: "4.1.0", releaseReady: true, publicAuthorization: true, publicWrites: true, activationBlockers: [] } : {}) } }));
  return (await import("../lib/public-openapi")).programmablePublicOpenApi;
}
afterEach(() => { vi.doUnmock("../lib/custom-launch/v4-api-discovery"); vi.resetModules(); });

describe("profile selected public Robinhood API contract", () => {
  it("leaves the historical contract untouched and never selects an unknown successor", () => {
    expect(robinhoodV4PublicContractDiscovery("4.0.0")).toEqual({});
    expect(robinhoodV4PublicContractDiscovery("4.2.0")).toEqual({});
    const legacy = "Existing Ethereum and Robinhood 4.0 wording.";
    expect(robinhoodV4PublicPolicyDescription("4.0.0", legacy)).toBe(legacy);
  });

  it("preserves the historical launch profile in the complete website OpenAPI 1.11 snapshot", async () => {
    const actual = await document("4.0.0");
    // Website 1.11 adds chain Explore discovery; historical launch rules and these pending inputs are unchanged.
    // The original 1.10 snapshot remains retained in public-openapi-v40-before-discovery.sha256.
    const expectedDigest = readFileSync(new URL("./fixtures/public-openapi-v40-website-v111.sha256", import.meta.url), "utf8").trim();
    expect(createHash("sha256").update(JSON.stringify(actual)).digest("hex")).toBe(expectedDigest);
  });

  it("shows successor rules without promoting pending release or wallet authority", async () => {
    const doc = await document("4.1.0");
    const v4 = doc["x-programmable-availability"].v4;
    expect(v4).toMatchObject({ profileVersion: "4.1.0", cliVersion: "4.1.0", publicWrites: false,
      publicAuthorization: false, releaseReady: false, released: false, installable: false, releaseBlockers: ["test-activation-blocker"],
      openApiUrl: "https://programmable.market/openapi/custom-launch-v4.1.json",
      packConfigSchemaUrl: "https://programmable.market/schemas/custom-launch/v4.1/pack-config.json",
      sourceVerificationSchemaUrl: "https://programmable.market/schemas/custom-launch/v4.1/source-verification-status.json",
      fundingPlan: { required: true, gasAdditionalToLaunchValue: true, buildOnlyCreatesPermits: false },
      initialBuy: { minimumUsd: "1", assessmentTime: "permit-authorization", executionChainId: 4663, referenceChainId: 1,
        quotePath: "/v4/chains/4663/initial-buy-quote", quoteAuthentication: "none", staleFallback: false,
        walletExecutionUsdValueGuaranteed: false, firstTradeIndexingGuaranteed: false },
      platformFeePolicy: { rateBps: 20, basis: "gross-native-leg-once-per-successful-swap", feeCurrency: "native-ETH",
        accrual: "pool-manager-native-claims", claimMechanism: "permissionless-fixed-recipient", rounding: "ceil-per-trade",
        canonicalOnchainEnforcementProven: false, guaranteedRevenue: false, universalFeeBehaviorClaim: false },
      genericFeeClaiming: "not-live", externalIndexingGuaranteed: false, cliWalletAuthority: false });
    expect(doc.info.description).toContain("exact server-verified native fee kernel");
    expect(doc.info.description).not.toContain("missing onchain fee enforcement is not itself a write blocker");
    expect(doc["x-programmable-boundary"].actions).not.toContain("missing onchain fee enforcement is not itself a write blocker");
    expect(doc["x-programmable-api-scopes"]["custom-launch:create"].description).not.toContain("non-fee release predicates");
    expect(doc["x-programmable-api-scopes"]["fees:claim"].state).toBe("reserved-disabled");
  });

  it("preserves Ethereum, paths, schemas and other discovery while activation retains sole authority", async () => {
    const old = await document("4.0.0");
    const next = await document("4.1.0", true);
    const { v4: oldV4, ...oldOther } = old["x-programmable-availability"];
    const { v4: nextV4, ...nextOther } = next["x-programmable-availability"];
    expect(nextOther).toEqual(oldOther);
    expect(next.paths).toEqual(old.paths);
    expect(next.components).toEqual(old.components);
    expect(next["x-programmable-wallet-authorization-gate"]).toEqual(old["x-programmable-wallet-authorization-gate"]);
    expect(nextV4.publicWrites).toBe(true);
    expect(nextV4.releaseReady).toBe(true);
    expect(oldV4.publicWrites).toBe(false);
    for (const field of ["publicWrites", "publicAuthorization", "releaseReady", "released", "installable", "releaseBlockers"]) {
      expect(robinhoodV4PublicContractDiscovery("4.1.0")).not.toHaveProperty(field);
    }
  });
});
