type EvidenceBoundExploreExclusionV1 = Readonly<{
  identity: string;
  evidence: string;
  kind: "release-canary-token";
}>;

/**
 * Discovery exclusions are limited to identities that the repository's
 * canonical release evidence explicitly classifies as canaries. Display
 * names, symbols, creators, liquidity and market activity are deliberately
 * excluded from this policy because none of them proves launch intent.
 */
export const NON_PUBLIC_EXPLORE_IDENTITIES_V1 = Object.freeze({
  tokens: Object.freeze([
    Object.freeze({
      identity: "0xB382f738a99820276FD66EfB94b75Eca104c2B4D",
      evidence:
        "contracts/deployments/mainnet-classic-v4.json#lifecycleEvidence.canaryToken",
      kind: "release-canary-token" as const,
    }),
    Object.freeze({
      identity: "0xFA5D9694D9f8fa47b8A6c15Df4510b76cb844e2c",
      evidence:
        "contracts/deployments/mainnet-classic-v3.json#lifecycleEvidence.canaryToken",
      kind: "release-canary-token" as const,
    }),
    Object.freeze({
      identity: "0x3a778578b3a21dd842c29be3d1816b1af37d54f3",
      evidence:
        "contracts/deployments/mainnet-deep-full-range-v1.json#lifecycleEvidence.canaryToken",
      kind: "release-canary-token" as const,
    }),
    Object.freeze({
      identity: "0x3C82787014931BD11b9edb789E42F92d792Dd07f",
      evidence:
        "contracts/deployments/mainnet-stock-paired-v1.json#lifecycleEvidence.canaryToken",
      kind: "release-canary-token" as const,
    }),
    Object.freeze({
      identity: "0x369f5fa21942560c42Ba9FDb8a156F5C962BD2eC",
      evidence:
        "contracts/deployments/mainnet-stock-paired-v2.json#lifecycleEvidence.canaryToken",
      kind: "release-canary-token" as const,
    }),
    Object.freeze({
      identity: "0x2C348590Cb56Fcc5984F035D57bdb01e32c945D5",
      evidence:
        "contracts/deployments/mainnet-stock-paired-v3.json#lifecycleEvidence.canaryToken",
      kind: "release-canary-token" as const,
    }),
    Object.freeze({
      identity: "0x9DEeB39D2590b0cAD5fc473F755C5F97Dcc8f7cE",
      evidence:
        "components/launch-stamp-docs-contract.ts#PROGRAMMABLE_LAUNCH_STAMP_MANIFEST.launchStampRouter.canaryEvidence.components.token",
      kind: "release-canary-token" as const,
    }),
  ] satisfies readonly EvidenceBoundExploreExclusionV1[]),
});

const NON_PUBLIC_TOKEN_ADDRESSES = new Set(
  NON_PUBLIC_EXPLORE_IDENTITIES_V1.tokens.map(({ identity }) =>
    identity.toLowerCase()),
);
/**
 * Controls only public discovery. Direct token lookup remains available so
 * historical evidence and exact-address access are preserved.
 */
export function isPublicExploreIdentityV1(
  identity: Readonly<{ tokenAddress?: string }>,
): boolean {
  if (
    typeof identity.tokenAddress === "string" &&
    NON_PUBLIC_TOKEN_ADDRESSES.has(identity.tokenAddress.toLowerCase())
  ) {
    return false;
  }
  return true;
}
