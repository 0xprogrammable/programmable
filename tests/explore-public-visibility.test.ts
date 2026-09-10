import { describe, expect, it } from "vitest";

import classicV3Release from
  "../contracts/deployments/mainnet-classic-v3.json";
import classicV4Release from
  "../contracts/deployments/mainnet-classic-v4.json";
import deepV1Release from
  "../contracts/deployments/mainnet-deep-full-range-v1.json";
import stockPairedV1Release from
  "../contracts/deployments/mainnet-stock-paired-v1.json";
import stockPairedV2Release from
  "../contracts/deployments/mainnet-stock-paired-v2.json";
import stockPairedV3Release from
  "../contracts/deployments/mainnet-stock-paired-v3.json";
import { PROGRAMMABLE_LAUNCH_STAMP_MANIFEST } from
  "../components/launch-stamp-docs-contract";
import {
  isPublicExploreIdentityV1,
  NON_PUBLIC_EXPLORE_IDENTITIES_V1,
} from "../lib/explore-public-visibility";

function sorted(values: readonly string[]) {
  return [...values].map((value) => value.toLowerCase()).sort();
}

describe("public Explore visibility", () => {
  it("binds every excluded token to canonical repository canary evidence", () => {
    const evidencedCanaryTokens = [
      classicV3Release.lifecycleEvidence.canaryToken,
      classicV4Release.lifecycleEvidence.canaryToken,
      deepV1Release.lifecycleEvidence.canaryToken,
      stockPairedV1Release.lifecycleEvidence.canaryToken,
      stockPairedV2Release.lifecycleEvidence.canaryToken,
      stockPairedV3Release.lifecycleEvidence.canaryToken,
      PROGRAMMABLE_LAUNCH_STAMP_MANIFEST.launchStampRouter.canaryEvidence
        .components.token,
    ];

    expect(sorted(NON_PUBLIC_EXPLORE_IDENTITIES_V1.tokens.map(
      ({ identity }) => identity,
    ))).toEqual(sorted(evidencedCanaryTokens));
    expect(NON_PUBLIC_EXPLORE_IDENTITIES_V1.tokens.every(
      ({ kind, evidence }) => kind === "release-canary-token" && evidence.length > 0,
    )).toBe(true);
  });

  it("excludes only exact identities and ignores names, creators, and metadata", () => {
    const canary = classicV3Release.lifecycleEvidence.canaryToken;
    expect(isPublicExploreIdentityV1({ tokenAddress: canary })).toBe(false);
    expect(isPublicExploreIdentityV1({ tokenAddress: canary.toLowerCase() })).toBe(
      false,
    );
    expect(isPublicExploreIdentityV1({
      tokenAddress: "0x1111111111111111111111111111111111111111",
    })).toBe(true);
    expect(isPublicExploreIdentityV1({})).toBe(true);
  });

});
