import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { toEventSelector, type AbiEvent } from "viem";
import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";

const fixturePath = resolve(
  process.cwd(),
  "public/fixtures/robinhood-terminal-indexer-v1.json",
);
const abiPath = resolve(
  process.cwd(),
  "public/contracts/robinhood/ProgrammableLaunchStampRouterV1.abi.json",
);
const pageSource = readFileSync(
  resolve(
    process.cwd(),
    "app/docs/developers/robinhood-terminal-indexer/page.tsx",
  ),
  "utf8",
);
const aliasSource = readFileSync(
  resolve(
    process.cwd(),
    "app/developer-reference/robinhood-terminal-indexer/page.tsx",
  ),
  "utf8",
);
const gitBookSource = readFileSync(
  resolve(
    process.cwd(),
    "docs/public/developers/robinhood-terminal-indexer.md",
  ),
  "utf8",
);
const gitBookSummary = readFileSync(
  resolve(process.cwd(), "docs/public/SUMMARY.md"),
  "utf8",
);
const sitemapSource = readFileSync(
  resolve(process.cwd(), "app/sitemap.ts"),
  "utf8",
);
const vercelConfig = JSON.parse(
  readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"),
) as {
  redirects: Array<{
    source: string;
    destination: string;
    permanent: boolean;
  }>;
  rewrites: Array<{ source: string; destination: string }>;
};

type TerminalFixture = {
  integrationBoundary: {
    target: string;
    stateAuthority: string;
    fixtureCarriesProductionState: boolean;
    activationAuthority: string;
    runtimeAuthority: string;
    publicItemAuthority: string;
    liveCreateGate: { paths: string[]; expected: boolean[] };
    feeBehaviorClaim: boolean;
    releaseBlockersAuthority: string;
    releaseBlockersPath: string;
    publicItemPresenceSource: string;
  };
  chain: { chainId: string; caip2: string; provenanceStartBlock: string };
  classification: {
    platformId: string;
    category: string;
    label: string;
    routerLaunchKind: number;
  };
  contracts: {
    launchStampRouter: {
      address: string;
      runtimeCodeHash: string;
      downloadAbiSha256: string;
      profileNormalizedAbiSha256: string;
    };
  };
  events: Array<{
    name: string;
    topic0: `0x${string}`;
    indexedInputs: string[];
  }>;
  feed: {
    requiredTerminalEvidence: Record<string, unknown>;
    openApiValidation: {
      url: string;
      digestAuthorityUrl: string;
      digestAuthorityPath: string;
      digestAlgorithm: string;
      responseSchema: string;
      itemSchema: string;
      rule: string;
    };
    minimumIdentityEvidence: {
      minimumPaths: string[];
      constantAssertions: Record<string, unknown>;
      sourceVerificationRule: string;
    };
    coordinateSemantics: {
      canonicalCoordinates: Record<string, string>;
      l1FinalizedProviderReadbackOrder: Array<{
        providerId: string;
        trustDomain: string;
      }>;
      l1ProviderBindingRule: string;
      legacyStageProjectionFields: string[];
      legacyStageProjectionDeprecated: boolean;
      l2TransactionAliasRule: string;
      l2EventOrderRule: string;
      directRouterVerificationRule: string;
      historicalV2Rule: string;
    };
    exampleResponse: {
      chainId: string;
      caip2: string;
      quality: {
        sourceRowCount: number;
        publishedRowCount: number;
        quarantinedRowCount: number;
      };
      launches: unknown[];
    };
    exampleResponsePurpose: string;
    qualitySemantics: Record<string, string>;
  };
  feePolicy: {
    authority: { url: string; path: string };
    currentValueSource: string;
    fixtureCarriesCurrentValues: boolean;
    requiredFields: string[];
    feeBehaviorClaim: boolean;
    universalFeeBehaviorClaim: boolean;
    genericClaimingLive: boolean;
    chargedFeeResult: string;
    perLaunchApplicabilityWithoutExplicitBackendBinding: string;
  };
  resultAxes: {
    provenance: Record<string, string>;
    feedAvailability: Record<string, string>;
    finality: Record<string, string>;
    writeActivation: Record<string, string>;
    feeBehavior: Record<string, string>;
  };
  independenceRule: string;
};

const fixture = JSON.parse(
  readFileSync(fixturePath, "utf8"),
) as TerminalFixture;
const abiBytes = readFileSync(abiPath);
const abi = JSON.parse(abiBytes.toString("utf8")) as Array<
  AbiEvent | Record<string, unknown>
>;

function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJsonKeys(child)]),
    );
  }
  return value;
}

describe("Robinhood terminal and indexer documentation", () => {
  it("keeps public docs in GitBook and preserves the technical compatibility guide", async () => {
    const rewrites = await nextConfig.rewrites?.();

    expect(vercelConfig.rewrites).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: expect.stringMatching(/^\/docs/) }),
      ]),
    );
    expect(rewrites).toEqual({
      beforeFiles: [
        {
          source: "/docs",
          destination: "https://proxy.gitbook.site/sites/site_V93gQ",
        },
        {
          source: "/docs/:match*",
          destination: "https://proxy.gitbook.site/sites/site_V93gQ/:match*",
        },
      ],
    });
    expect(vercelConfig.redirects).not.toContainEqual({
      source: "/docs/developers/robinhood-terminal-indexer",
      destination: "/developer-reference/robinhood-terminal-indexer",
      permanent: false,
    });
    expect(aliasSource).toContain(
      'from "@/app/docs/developers/robinhood-terminal-indexer/page"',
    );
    expect(pageSource).toContain(
      'canonical: "/developer-reference/robinhood-terminal-indexer"',
    );
    expect(sitemapSource).toContain(
      '"/developer-reference/robinhood-terminal-indexer"',
    );
    expect(gitBookSummary).toContain(
      "(developers/robinhood-terminal-indexer.md)",
    );
    for (const sentinel of [
      "eip155:4663",
      "0x34965F2A2ee9254522232C32F02056E92BE0C98a",
      "platformId: programmable",
      "category: custom",
      "finalized-custom-launches",
      "robinhood-terminal-indexer-v1.json",
      "ProgrammableLaunchStampRouterV1.abi.json",
      "Third-party indexing is not guaranteed",
    ]) {
      expect(gitBookSource).toContain(sentinel);
    }
  });

  it("pins the chain and Router while resolving mutable state live", () => {
    expect(fixture.integrationBoundary).toMatchObject({
      target: "public-self-serve",
      stateAuthority: "live-only",
      fixtureCarriesProductionState: false,
      activationAuthority:
        "https://programmable.market/.well-known/programmable.json",
      runtimeAuthority:
        "https://api.programmable.market/v4/chains/4663/readiness",
      publicItemAuthority:
        "https://api.programmable.market/v4/chains/4663/finalized-custom-launches",
      feeBehaviorClaim: false,
      releaseBlockersAuthority:
        "https://api.programmable.market/v4/chains/4663/capabilities",
      releaseBlockersPath: "readiness.reasonCodes",
      publicItemPresenceSource: "live finalized feed only",
      liveCreateGate: {
        paths: [
          "customLaunchApi.versions.v4.publicWrites",
          "customLaunchApi.versions.v4.publicAuthorization",
          "customLaunchApi.versions.v4.releaseReady",
        ],
        expected: [true, true, true],
      },
    });
    expect(fixture.chain).toEqual({
      chainId: "4663",
      caip2: "eip155:4663",
      name: "Robinhood Chain Mainnet",
      provenanceStartBlock: "50469365",
    });
    expect(fixture.classification).toMatchObject({
      platformId: "programmable",
      category: "custom",
      label: "Programmable Custom",
      routerLaunchKind: 1,
    });
    expect(fixture.contracts.launchStampRouter).toMatchObject({
      address: "0x34965F2A2ee9254522232C32F02056E92BE0C98a",
      runtimeCodeHash:
        "0x1dbbdaaad901ea3c6134dca0d4872a4789b3c071bf8ccfb44edd65d26d817388",
    });
    expect(fixture.feePolicy).toMatchObject({
      authority: {
        url: "https://programmable.market/.well-known/programmable.json",
        path: "customLaunchApi.versions.v4.platformFeePolicy",
      },
      currentValueSource: "live-discovery-only",
      fixtureCarriesCurrentValues: false,
      directRouterOrOutsideApiBindingClaim: false,
      perLaunchApplicabilityWithoutExplicitBackendBinding: "UNVERIFIED",
      feeBehaviorClaim: false,
      universalFeeBehaviorClaim: false,
      genericClaimingLive: false,
      chargedFeeResult: "UNAVAILABLE",
    });
    expect(fixture.feePolicy.requiredFields).toEqual(
      expect.arrayContaining([
        "rateBps",
        "ratePercent",
        "recipient",
        "enforcement",
      ]),
    );
  });

  it("hashes the exact downloadable ABI bytes and derives every event topic", () => {
    const digest = createHash("sha256").update(abiBytes).digest("hex");
    expect(`sha256:${digest}`).toBe(
      fixture.contracts.launchStampRouter.downloadAbiSha256,
    );
    const profileNormalizedBytes = Buffer.from(
      `${JSON.stringify(sortJsonKeys(abi))}\n`,
    );
    const profileNormalizedDigest = createHash("sha256")
      .update(profileNormalizedBytes)
      .digest("hex");
    expect(`sha256:${profileNormalizedDigest}`).toBe(
      fixture.contracts.launchStampRouter.profileNormalizedAbiSha256,
    );

    const abiEvents = abi.filter(
      (entry): entry is AbiEvent => entry.type === "event",
    );
    expect(abiEvents).toHaveLength(fixture.events.length);

    for (const expected of fixture.events) {
      const event = abiEvents.find((entry) => entry.name === expected.name);
      expect(event, expected.name).toBeDefined();
      expect(toEventSelector(event!)).toBe(expected.topic0);
      expect(
        event!.inputs
          .filter((input) => input.indexed)
          .map((input) => input.name),
      ).toEqual(expected.indexedInputs);
    }
  });

  it("keeps the parser vector empty and requires replayable V3 Ethereum finality", () => {
    expect(fixture.feed.exampleResponse).toMatchObject({
      chainId: "4663",
      caip2: "eip155:4663",
      quality: {
        sourceRowCount: 0,
        publishedRowCount: 0,
        quarantinedRowCount: 0,
      },
      launches: [],
    });
    expect(fixture.feed.exampleResponsePurpose).toMatch(
      /not a captured production/u,
    );
    expect(fixture.feed.requiredTerminalEvidence).toEqual({
      platformId: "programmable",
      category: "custom",
      "onchain.schemaVersion": "programmable.custom-launch-onchain-evidence.v3",
      "onchain.terminal": true,
      "onchain.checkpointType": "ethereum_finalized",
      "onchain.l2Inclusion": "required-object",
      "onchain.l2Inclusion.schemaVersion":
        "programmable.custom-launch-l2-inclusion.v1",
      "onchain.l2Inclusion.chainId": "4663",
      "onchain.l2Inclusion.caip2": "eip155:4663",
      "onchain.l2Inclusion.receiptStatus": "success",
      "onchain.l1Posting": "required-object",
      "onchain.l1Posting.schemaVersion":
        "programmable.custom-launch-l1-posting.v1",
      "onchain.l1Posting.chainId": "1",
      "onchain.l1Posting.caip2": "eip155:1",
      "onchain.l1Posting.rollup": "0x23A19d23e89166adedbDcB432518AB01e4272D94",
      "onchain.l1Posting.sequencerInbox":
        "0xBd0D173EEb87D57A09521c24388a12789F33ba96",
      "onchain.l1FinalizedCheckpoint": "required-object",
      "onchain.l1FinalizedCheckpoint.schemaVersion":
        "programmable.custom-launch-l1-finalized-checkpoint.v1",
      "onchain.l1FinalizedCheckpoint.chainId": "1",
      "onchain.l1FinalizedCheckpoint.caip2": "eip155:1",
      "onchain.l1FinalizedCheckpoint.consensusCheckpointTag": "finalized",
      "sourceVerification.status": "exact_match",
      "sourceVerification.components[*].status": "exact_match",
    });
    expect(fixture.feed.openApiValidation).toMatchObject({
      url: "https://programmable.market/openapi/custom-launch-v4.json",
      digestAuthorityUrl:
        "https://api.programmable.market/v4/chains/4663/readiness",
      digestAuthorityPath: "openApiSha256",
      digestAlgorithm: "sha256-exact-response-bytes",
      responseSchema: "#/components/schemas/CustomLaunchFinalizedListV4",
      itemSchema: "#/components/schemas/CustomLaunchFinalizedMetadataV4",
    });
    expect(fixture.feed.openApiValidation.rule).toMatch(
      /exact hosted OpenAPI response bytes.*readiness\.openApiSha256.*fail closed.*complete response.*launches\[\] item/u,
    );
    expect(fixture.feed.minimumIdentityEvidence.constantAssertions).toEqual({
      platformId: "programmable",
      category: "custom",
      chainId: "4663",
      caip2: "eip155:4663",
      "onchain.schemaVersion": "programmable.custom-launch-onchain-evidence.v3",
      "onchain.terminal": true,
      "onchain.checkpointType": "ethereum_finalized",
      "onchain.router": "0x34965F2A2ee9254522232C32F02056E92BE0C98a",
      "onchain.l1Posting.rollup": "0x23A19d23e89166adedbDcB432518AB01e4272D94",
      "onchain.l1Posting.sequencerInbox":
        "0xBd0D173EEb87D57A09521c24388a12789F33ba96",
      "onchain.l1FinalizedCheckpoint.consensusCheckpointTag": "finalized",
      "sourceVerification.status": "exact_match",
    });
    expect(fixture.feed.minimumIdentityEvidence.minimumPaths).toContain(
      "onchain.routerLaunchId",
    );
    expect(fixture.feed.minimumIdentityEvidence.minimumPaths).toContain(
      "onchain.l2Inclusion.launchEventLogIndex",
    );
    expect(fixture.feed.minimumIdentityEvidence.minimumPaths).toContain(
      "onchain.l1Posting.logIndex",
    );
    expect(fixture.feed.minimumIdentityEvidence.minimumPaths).toContain(
      "onchain.l1Posting.batchNumber",
    );
    expect(fixture.feed.minimumIdentityEvidence.minimumPaths).toContain(
      "onchain.l1FinalizedCheckpoint.providerReadbacks",
    );
    expect(fixture.feed.minimumIdentityEvidence.minimumPaths).toContain(
      "sourceVerification.components",
    );
    expect(fixture.feed.minimumIdentityEvidence.sourceVerificationRule).toMatch(
      /every component status.*exact_match.*provider-only Sourcify.*not publication authority/u,
    );
    expect(fixture.feed.minimumIdentityEvidence.minimumPaths).not.toContain(
      "onchain.logIndex",
    );
    expect(fixture.feed.minimumIdentityEvidence.minimumPaths).not.toContain(
      "status",
    );
    expect(fixture.feed.coordinateSemantics).toMatchObject({
      canonicalCoordinates: {
        l2ReceiptAndRouterEvents: "onchain.l2Inclusion",
        l1BatchPostingEvent: "onchain.l1Posting",
        l1CommonFinalizedCheckpoint: "onchain.l1FinalizedCheckpoint",
      },
      legacyStageProjectionFields: [
        "onchain.blockNumber",
        "onchain.blockHash",
        "onchain.logIndex",
      ],
      legacyStageProjectionDeprecated: true,
    });
    expect(
      fixture.feed.coordinateSemantics.l1FinalizedProviderReadbackOrder,
    ).toEqual([
      { providerId: "drpc", trustDomain: "drpc.org" },
      { providerId: "quicknode", trustDomain: "quicknode.com" },
    ]);
    expect(fixture.feed.coordinateSemantics.l1ProviderBindingRule).toMatch(
      /exact order.*ethereumFinalityEvidence/u,
    );
    expect(
      fixture.feed.coordinateSemantics.directRouterVerificationRule,
    ).toMatch(/Replay onchain\.l2Inclusion\.transactionHash/u);
    expect(fixture.feed.coordinateSemantics.l2EventOrderRule).toMatch(
      /routeEventLogIndex must be less than.*launchEventLogIndex/u,
    );
    expect(fixture.feed.coordinateSemantics.l2TransactionAliasRule).toMatch(
      /transactionHash to equal onchain\.l2Inclusion\.transactionHash/u,
    );
    expect(fixture.feed.coordinateSemantics.historicalV2Rule).toMatch(
      /private authenticated history and is never a public-feed candidate/u,
    );
    expect(fixture.feed.qualitySemantics.scope).toMatch(
      /Global totals.*not counts for the current page/u,
    );
    expect(fixture.feed.qualitySemantics.candidateRule).toMatch(
      /V3-finalized rows with complete authoritative exact-source verification.*remain private history/u,
    );
    expect(fixture.feed.qualitySemantics.sourceRowCount).toMatch(
      /equals publishedRowCount/u,
    );
    expect(fixture.feed.qualitySemantics.publishedRowCount).toMatch(
      /launches\.length.*must never exceed/u,
    );
    expect(fixture.feed.qualitySemantics.quarantinedRowCount).toMatch(
      /Always zero.*fails the entire endpoint request/u,
    );
    expect(fixture.feed.qualitySemantics.statusRule).toMatch(
      /successful response has status ready.*quarantinedRowCount equal to zero/u,
    );
    expect(pageSource).toContain("verifyCompleteRouterBinding");
    expect(pageSource).toContain("readiness.openApiSha256 !== openApiSha256");
    expect(pageSource).toContain("await robinhoodClient.getChainId() !== 4663");
    expect(pageSource).toContain("ETHEREUM_DRPC_RPC_URL");
    expect(pageSource).toContain("ETHEREUM_QUICKNODE_RPC_URL");
    expect(pageSource).toContain(
      'l1Rollup: "0x23A19d23e89166adedbDcB432518AB01e4272D94"',
    );
    expect(pageSource).toContain(
      'l1SequencerInbox: "0xBd0D173EEb87D57A09521c24388a12789F33ba96"',
    );
    expect(pageSource).toContain("Source-verification authority");
    expect(pageSource).toContain("Public activation authority");
    expect(pageSource).toContain("chainId !== 1");
    expect(pageSource).toContain('page.quality.status !== "ready"');
    expect(pageSource).toContain("sourceRowCount !== publishedRowCount");
    expect(pageSource).toContain("quarantinedRowCount !== 0");
    expect(pageSource).toContain("page.launches.length > publishedRowCount");
    expect(pageSource).toContain(
      'throw new Error("INDETERMINATE: repeated pagination cursor")',
    );
    expect(pageSource).toContain(
      "Never replace that function with a kind-only launchStamp read.",
    );
    expect(pageSource).toContain(
      'launch.onchain.schemaVersion !==\n        "programmable.custom-launch-onchain-evidence.v3"',
    );
    expect(pageSource).toContain(
      "deprecated flat blockNumber/blockHash/logIndex are a stage projection",
    );
    expect(pageSource).toContain('launch.platformId !== "programmable"');
    expect(pageSource).toContain('launch.category !== "custom"');
    expect(pageSource).toContain(
      'launch.sourceVerification.status !== "exact_match"',
    );
    expect(pageSource).toContain('feePolicyApplicability: "UNVERIFIED"');
    expect(pageSource).not.toContain(
      "0xD88539d3c4C460136a733A3Fd60cf6BF269079da",
    );
    expect(pageSource).not.toContain("platformFeePolicy: {");
    expect(pageSource).not.toMatch(
      /const stamp = await publicClient\.readContract/u,
    );
  });

  it("keeps provenance independent from feed, activation and fee availability", () => {
    expect(Object.keys(fixture.resultAxes.provenance)).toEqual([
      "STAMPED",
      "NOT_STAMPED",
      "INDETERMINATE",
    ]);
    expect(fixture.resultAxes.feedAvailability).toHaveProperty("UNAVAILABLE");
    expect(fixture.resultAxes.finality).toHaveProperty("FINALIZED");
    expect(fixture.resultAxes.writeActivation).toHaveProperty("UNAVAILABLE");
    expect(fixture.resultAxes.feeBehavior).toEqual({
      UNAVAILABLE:
        "Required policy configuration is known, but actual basis, charged amount, accounting, accrual, claim mechanics, onchain enforcement and revenue are not proven.",
    });
    expect(fixture.independenceRule).toMatch(
      /independently of publicWrites and fee behavior/u,
    );
  });
});
