import { V4_API_DISCOVERY, V4_API_PROFILE_VERSION } from "../lib/custom-launch/v4-api-discovery";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { docsNavigation, docsSearchItems } from "../components/docs-data";
import sitemap from "../app/sitemap";
import { developerDocsMarkdown } from "../lib/developer-docs-content";
import { programmablePublicOpenApi } from "../lib/public-openapi";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const gitBookGuide = read("docs/public/developers/custom-launch.md");
const websiteGuide = read("app/docs/developers/custom-launch/page.tsx");
const summary = read("docs/public/SUMMARY.md");
const createGuide = read("components/create-guide.tsx");
const rawGuide = read("public/developers/custom-launch-api-v1.md");
const cliGuide = read("packages/launch/README.md");
const officialLinks = read("docs/public/reference/official-links.md");
const v3OpenApi = JSON.parse(read("public/openapi/custom-launch-v3.json"));
const v4OpenApi = JSON.parse(read("public/openapi/custom-launch-v4.json"));
const machineReadableGuide = read(
  "app/docs/developers/machine-readable/page.tsx",
);

describe("Custom Launch API documentation", () => {
  it("publishes one canonical human guide in both documentation systems", () => {
    expect(summary).toContain(
      "[Custom Launch API](developers/custom-launch.md)",
    );
    expect(websiteGuide).toContain(
      'alternates: { canonical: "/developer-reference/custom-launch" }',
    );
    expect(websiteGuide).toContain(
      'currentPath="/docs/developers/custom-launch"',
    );
    expect(
      docsNavigation
        .find(({ label }) => label === "Developers")
        ?.items.some(({ href }) => href === "/docs/developers/custom-launch"),
    ).toBe(true);
    expect(
      docsSearchItems.some(
        ({ href }) => href === "/docs/developers/custom-launch",
      ),
    ).toBe(true);
    expect(sitemap().map(({ url }) => url)).toContain(
      "https://programmable.market/docs/developers/custom-launch",
    );
    expect(
      docsSearchItems.find(({ title }) => title === "Creator overview")
        ?.description,
    ).not.toContain("publish reusable hook logic");
  });

  it("keeps V3 preparation and every wallet handoff explicit", () => {
    for (const source of [gitBookGuide, websiteGuide, developerDocsMarkdown]) {
      expect(source).toContain("prepared");
      expect(source).toContain("authorized");
      expect(source).toMatch(/prepared[\s\S]{0,240}(?:no wallet transaction|walletTransaction[^\n]{0,80}(?:null|both null))/i);
      expect(source).toMatch(/authorized[\s\S]{0,240}(?:walletTransaction|wallet transaction)/i);
    }
    expect(createGuide).toContain(
      "pack -> validate --remote -> submit -> server decision -> status --watch --until authorized -> wallet -> status --watch --until finalized",
    );
    expect(createGuide).toContain("/openapi/custom-launch-v3.json");
    expect(createGuide).toContain("awaiting_funding_authorization");
    expect(createGuide).toContain("EIP-3009 funding signature");
    expect(createGuide).toContain("fresh, separate review");
    expect(createGuide).not.toContain("integration-pending");
    expect(createGuide).toContain("Never sign or broadcast automatically");
    for (const source of [gitBookGuide, websiteGuide, rawGuide, developerDocsMarkdown]) {
      expect(source).toMatch(/action_required[\s\S]{0,300}not a wallet/i);
      expect(source).not.toMatch(/platform review (?:supplies|provides)/i);
    }
  });

  it("requires verified discovery before Robinhood V4 public activation", () => {
    const v4Sources = [
      gitBookGuide,
      websiteGuide,
      rawGuide,
      cliGuide,
      developerDocsMarkdown,
      machineReadableGuide,
      read("docs/public/developers/machine-readable.md"),
      read("docs/public/developers/README.md"),
      read("docs/public/status.md"),
    ];

    for (const source of v4Sources) {
      expect(source).toContain(source === developerDocsMarkdown ? V4_API_PROFILE_VERSION : "4.0.0");
      expect(source).toMatch(
        /(?:source|release)[\s-]candidate|immutable.*release/iu,
      );
      expect(source).toContain("3.3.9");
      expect(source).toContain("publicWrites");
      expect(source).toContain("releaseReady");
      expect(source).toContain("--api-version 4");
      expect(source).toContain("--chain-id 4663");
      expect(source).toMatch(/action_required[\s\S]{0,360}(?:not a wallet|remediation)/iu);
      expect(source).toMatch(/never\s+sign(?:s)?\s+or\s+broadcasts?/iu);
      expect(source).toMatch(/source verification[\s\S]{0,260}(?:after finality|after `finalized`|starts after|starts only after)/iu);
    }

    const statuses = [
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
    ];
    for (const status of statuses) {
      for (const source of v4Sources) expect(source).toContain(status);
    }
    expect(v4OpenApi.components.schemas.CustomLaunchResourceV4.properties.status.enum)
      .toEqual(statuses);
    expect(programmablePublicOpenApi["x-programmable-availability"].v4)
      .toMatchObject({
        status: V4_API_DISCOVERY.status,
        runtimeStatus: "routes-deployed",
        activationStage: V4_API_DISCOVERY.activationStage,
        targetLaunchPath: "public-self-serve",
        profileVersion: V4_API_PROFILE_VERSION,
        released: V4_API_DISCOVERY.cliReleased,
        installable: V4_API_DISCOVERY.cliInstallable,
        releaseReady: V4_API_DISCOVERY.releaseReady,
        publicAuthorization: V4_API_DISCOVERY.publicAuthorization,
        publicWrites: V4_API_DISCOVERY.publicWrites,
      });
    expect(officialLinks).toContain(
      "https://github.com/programmablehq/PROGRAMMABLE/tree/53926119030772040eca34b4796a36353c9da2d2/packages/launch",
    );
    expect(officialLinks).not.toContain(
      "https://github.com/programmablehq/PROGRAMMABLE/tree/7fd1a327577517d628cd529ec84862f1ae43eb08/packages/launch",
    );
    expect(cliGuide).toContain(
      "## Install the current public Ethereum V3 release",
    );
    expect(cliGuide).toContain(
      "**Blocked:**",
    );
    expect(cliGuide).toContain("**Activated:**");
    expect(cliGuide).not.toContain(
      "releases/download/programmable-launch-v4.0.0",
    );
    expect(cliGuide).not.toContain("github.com/0xprogrammable");
  });

  it("documents the real packager and schema boundary without invented checks", () => {
    for (const source of [gitBookGuide, websiteGuide]) {
      expect(source).toContain("/openapi/custom-launch-v1.json");
      expect(source).toContain("/openapi/custom-launch-v2.json");
      expect(source).toContain("does not publish a universal check-ID catalog");
      expect(source).toContain("programmable-launch");
      expect(source).toMatch(/do not (?:copy test-only hashes|enter\s+derived hashes by hand)/i);
    }
    expect(createGuide).toContain("/openapi/custom-launch-v3.json");
    expect(createGuide).not.toMatch(/Hookbuilder-Skill|Hook Builder packages/);
  });

  it("keeps the raw guide and OpenAPI URLs compatible", () => {
    for (const source of [gitBookGuide, websiteGuide, developerDocsMarkdown]) {
      expect(source).toContain("/openapi/custom-launch-v1.json");
      expect(source).toContain("/openapi/custom-launch-v2.json");
      expect(source).toContain("/developers/custom-launch-api-v1.md");
    }
  });

  it("states authentication, retry, discovery, claim and error boundaries", () => {
    for (const source of [gitBookGuide, websiteGuide]) {
      expect(source).toContain("Authorization: Bearer");
      expect(source).toContain("Idempotency-Key");
      expect(source).toContain("Retry-After");
      expect(source).toContain("Explore");
      expect(source).toContain("Profile");
      expect(source).toContain("not automatically claimable");
      expect(source).toContain("error.requestId");
      expect(source).toContain("resource-level");
    }
  });

  it("publishes the exact-source and no-broadcast cold-agent path", () => {
    for (const source of [gitBookGuide, rawGuide, developerDocsMarkdown]) {
      expect(source).toContain("verificationBundle");
      expect(source).toContain("exact_match");
      expect(source).toContain("PROGRAMMABLE_API_KEY");
      expect(source).toMatch(/(?:without (?:signing|a wallet signature).{0,40}(?:or|and) broadcast(?:ing)?|never[^\n]{0,80}sign[^\n]{0,40}broadcast)/i);
    }
    expect(gitBookGuide).toContain("programmable-launch-3.3.9.tgz");
    expect(rawGuide).toContain("programmable-launch-3.3.9.tgz");
    expect(developerDocsMarkdown).toContain("programmable-launch-3.3.9.tgz");
    expect(gitBookGuide).toContain("examples/direct-native-v3-no-broadcast/README.md");
    expect(gitBookGuide).toContain("deterministic-hook-permission-grind-v1");
    expect(gitBookGuide).toContain("programmable-launch submit ./launch.json");
  });

  it("keeps the website agent prompt on the current public CLI release", () => {
    expect(createGuide).toContain("public CLI 3.3.9 state machine");
    expect(createGuide).not.toContain("public CLI 3.1.0 flow");
  });

  it("publishes capabilities, side-effect-free preflight and separate truth axes", () => {
    for (const source of [gitBookGuide, websiteGuide, rawGuide, developerDocsMarkdown]) {
      expect(source).toContain("/v3/capabilities");
      expect(source).toContain("/v3/custom-launches/preflight");
      expect(source).toContain("validate --remote");
      expect(source).toContain("walletHandoffUrl");
      expect(source).toContain("expiresAt");
      expect(source).toContain("platform_fee_evidence");
      expect(source).toContain("behaviorEvidence");
      expect(source).toContain("lifecycleQueue");
      expect(source).toMatch(
        /no (?:launch[- ]creation )?quota|quotaConsumed: false/i,
      );
      expect(source).toMatch(/rate budget/i);
      expect(source).toMatch(/(?:allocates\s+no nonce|nonceAllocated: false)/i);
      expect(source).toMatch(/(?:persists no launch|persisted: false)/i);
    }
    expect(v3OpenApi.paths["/v3/capabilities"].get.security).toEqual([]);
    expect(v3OpenApi.paths["/v3/custom-launches/preflight"].post.security)
      .toEqual([{ CustomLaunchApiKey: [] }]);
    expect(v3OpenApi.components.schemas.CustomLaunchPreflightV1.required)
      .toEqual(expect.arrayContaining([
        "riskClassification",
        "behaviorEvidence",
        "productTruthAxes",
      ]));
  });

  it("publishes public V3.3 while retaining the exact V1 and V2 write fences", () => {
    for (const source of [
      gitBookGuide,
      websiteGuide,
      rawGuide,
      developerDocsMarkdown,
    ]) {
      expect(source).toContain("CUSTOM_LAUNCH_V1_READ_ONLY");
      expect(source).toContain("CUSTOM_LAUNCH_V2_READ_ONLY");
      expect(source).toMatch(/V1[\s\S]{0,200}(?:read-only|read only|write fence)/i);
      expect(source).toMatch(/V2[\s\S]{0,200}(?:read-only|read only|write fence)/i);
      expect(source).toMatch(/Public V3/i);
    }
    expect(createGuide).toMatch(/submit only (?:the|those) byte-identical/i);
    for (const source of [gitBookGuide, websiteGuide, rawGuide, developerDocsMarkdown]) {
      expect(source).toContain("Retry-After");
      expect(source).toMatch(/V3[^\n]{0,120}(?:public|live)/i);
      expect(source).toContain("/openapi/custom-launch-v3.json");
    }

    const combinedPost =
      programmablePublicOpenApi.paths["/v1/custom-launches"].post;
    expect(combinedPost).toMatchObject({
      deprecated: true,
      summary: "V1 launch creation is read-only",
    });
    expect(Object.keys(combinedPost.responses)).toEqual(["401", "403", "409"]);
    expect(programmablePublicOpenApi["x-programmable-availability"])
      .toMatchObject({
        v1Reads: "live",
        v1Create: {
          status: "read-only",
          httpStatus: 409,
          errorCode: "CUSTOM_LAUNCH_V1_READ_ONLY",
          retryable: false,
        },
        v2: {
          reads: "live",
          create: "read-only",
          createHttpStatus: 409,
          createErrorCode: "CUSTOM_LAUNCH_V2_READ_ONLY",
          retryable: false,
          preparedAndSimulatingReads: "observation-only",
          readMayAuthorize: false,
        },
        v3: {
          status: "live",
          profileId: "programmable.direct-native-hook-graph.v1",
          profileRevision: 3,
          profileVersion: "3.3.0",
          productionLaunchAuthorized: true,
          createHttpStatus: 202,
          replayHttpStatus: 200,
        },
        legacyIntake: { registry: "closed", github: "closed" },
      });
  });

  it("discloses the exact public V3 fee without conflating LP fees or future operations", () => {
    for (const source of [gitBookGuide, websiteGuide, rawGuide, cliGuide]) {
      expect(source).toContain("Ethereum Mainnet");
      expect(source).toContain("productionLaunchAuthorized: true");
      expect(source).toMatch(/1,000/);
      expect(source).toMatch(/0\.10%[^\n]{0,20}10 bps/i);
      expect(source).toContain("0x4957f49620AFf3Adbbe8195a4f633E49cc93376c");
      expect(source).toContain("shasum -a 256 -c");
      expect(source).toMatch(/platform admission|admission receipt|static admission/i);
      expect(source).toMatch(/concrete reachable\s+callback implementation/i);
      expect(source).toMatch(/not (?:an )?audit|does not audit|universal\s+audit/i);
      expect(source).toMatch(/fee\s+behavior|fee-behavior/i);
      expect(source).toContain("LP fee is separate");
      expect(source).toMatch(/Generic fee claiming and\s+buyback/);
      expect(source).toMatch(/V3/i);
    }
    for (const source of [gitBookGuide, rawGuide, cliGuide]) {
      expect(source).toContain("programmable-launch-3.3.9.tgz.sha256");
    }
    expect(websiteGuide).toContain("programmable-launch-3.3.9.tgz.sha256");

    expect(v3OpenApi["x-programmable-profile"]).toMatchObject({
      profileId: "programmable.direct-native-hook-graph.v1",
      profileRevision: 3,
      profileVersion: "3.3.0",
      productionLaunchAuthorized: true,
      projectOwnedToken: true,
      projectOwnedHook: true,
    });
    expect(v3OpenApi["x-programmable-fee-accounting"]).toEqual({
      accountingModes: [
        "additive-platform-share",
        "inclusive-selected-total",
      ],
      rateDenominator: "1000000",
      programmableFeeHundredthsOfBip: "1000",
      applicantSelectedMaximumHundredthsOfBip: "100000",
      maximumAdditiveEffectiveTotalHundredthsOfBip: "101000",
      lpPoolFeeMaximumUnchanged: true,
      invariants: {
        "additive-platform-share":
          "effectiveTotal=selected+1000; projectShare=selected",
        "inclusive-selected-total":
          "effectiveTotal=max(selected,1000); projectShare=effectiveTotal-1000",
      },
      derivedResultsAreRecomputedByServer: true,
      feeBehaviorClaim: false,
      tenBpsClaimRequiresExactPerLaunchVerifiedFeePathEvidence: true,
      claimScope: "exact-launch-and-stamped-poolkey-only",
    });
  });

  it("states the normal LP and zero-classical-LP boundary without inventing liquidity", () => {
    for (const source of [
      gitBookGuide,
      websiteGuide,
      rawGuide,
      cliGuide,
      developerDocsMarkdown,
    ]) {
      expect(source).toMatch(/(?:normal )?(?:Uniswap v4 )?(?:pool )?initializ/i);
      expect(source).toMatch(/volume cannot create (?:(?:that|the) )?initial\s+liquidity\s+from\s+nothing/i);
      expect(source).toMatch(/zero classical LP/i);
      expect(source).toMatch(/custom accounting|hold launch inventory|hold inventory/i);
    }
  });

  it("describes request-driven reconciliation consistently", () => {
    for (const source of [rawGuide, machineReadableGuide]) {
      expect(source).toContain("bounded best-effort");
      expect(source).not.toContain("only the exact single-launch GET reconciles");
      expect(source).not.toContain("list reads do not perform per-launch chain reads");
    }
    expect(programmablePublicOpenApi["x-programmable-boundary"].actions).toContain(
      "pending history rows",
    );
  });
});
