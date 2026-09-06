import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  DeveloperApiKeysView,
  ApiKeyPurposeChoice,
  PROGRAMMABLE_MODULE_AGENT_SETUP_TEXT_V1,
  applyApiKeyMutationResult,
  apiKeyPurpose,
  apiKeyPurposeLabel,
  apiKeyLifetimeDays,
  mergeApiKeySummaries,
  moduleContributionKeysAvailable,
  parseApiKeyMutationResult,
  prepareApiKeyMutationAttempt,
  shouldRetainApiKeyMutationAttempt,
  type ApiKeySummary,
} from "../components/developer-api-keys";
import {
  launchPollingRetryAfterMs,
  fetchVerifiedProjectImageV1,
  launchResourceIdentity,
  mergeLaunchResources,
  parseCustomLaunchProjectMetadataV1,
  parseHistoryPage,
  projectImageFetchUrlV1,
  selectMonotonicLaunchResource,
  walletProjectMetadataBindingV1,
  walletProjectMetadataRequirementsV1,
  walletProjectMetadataSummaryV1,
  walletProjectRequestBindingV1,
  type CustomLaunchProjectMetadataV1,
  type LaunchResource,
  type LaunchStatus,
} from "../components/developer-launch-history";

import {
  PROGRAMMABLE_AGENT_SETUP_LINKS_V1,
  PROGRAMMABLE_AGENT_SETUP_TEXT_V1,
} from "../lib/custom-launch/agent-setup-v1";
import {
  buildCustomLaunchAgentFixV1,
  customLaunchTruthRowsV1,
  parseCustomLaunchRemediationV1,
  parseCustomLaunchWalletHandoffV1,
  parseSourceVerificationStatusV1,
} from "../lib/custom-launch/developer-launch-truth-v1";
import { canonicalBrowserSha256V2, fileSha256V2 } from
  "../lib/custom-launch/browser-authority-v2";

const apiKeysSource = readFileSync(
  new URL("../components/developer-api-keys.tsx", import.meta.url),
  "utf8",
);
const apiKeysStyles = readFileSync(
  new URL("../components/developer-api-keys.module.css", import.meta.url),
  "utf8",
);
const historySource = readFileSync(
  new URL("../components/developer-launch-history.tsx", import.meta.url),
  "utf8",
);
const historyStyles = readFileSync(
  new URL("../components/developer-launch-history.module.css", import.meta.url),
  "utf8",
);
const walletProviderSource = readFileSync(
  new URL("../components/wallet-provider.tsx", import.meta.url),
  "utf8",
);
const walletHandoffV4Source = readFileSync(
  new URL("../lib/custom-launch/wallet-handoff-v4.ts", import.meta.url),
  "utf8",
);

const PROJECT_METADATA = Object.freeze({
  schemaVersion: "programmable.project-metadata.v1",
  token: Object.freeze({ name: "Example Hook", symbol: "HOOK" }),
  presentation: Object.freeze({
    schemaVersion: "programmable.launch-presentation-draft.v1",
    description: "A project-owned Uniswap v4 hook.",
    image: Object.freeze({
      uri: "https://assets.example.com/hook.png",
      contentSha256: `sha256:${"44".repeat(32)}`,
      mediaType: "image/png",
      byteLength: 4_096,
      width: 512,
      height: 512,
    }),
    links: Object.freeze([
      Object.freeze({ kind: "documentation", uri: "https://docs.example.com/" }),
      Object.freeze({ kind: "website", uri: "https://example.com/" }),
      Object.freeze({ kind: "x", uri: "https://x.com/example" }),
    ]),
  }),
  tokenMetadataBinding: Object.freeze({
    schemaVersion: "programmable.project-token-metadata-binding.v1",
    tokenTargetId: "token",
    declarationBinding: "request-and-launch-id",
    standardReadModel: Object.freeze({ name: true, symbol: true }),
    name: Object.freeze({
      staticSource: "constructor-argument",
      argumentIndex: 0,
      argumentName: "name_",
    }),
    symbol: Object.freeze({
      staticSource: "constructor-argument",
      argumentIndex: 1,
      argumentName: "symbol_",
    }),
    postDeploymentReadback: "required",
  }),
}) satisfies CustomLaunchProjectMetadataV1;

const PROJECT_METADATA_HASH = canonicalBrowserSha256V2(
  "programmable.project-metadata.v1",
  PROJECT_METADATA,
);
const UNBOUND_GRAPH_BUNDLE_HASH = `sha256:${"77".repeat(32)}` as const;
const GRAPH_BUNDLE_HASH = canonicalBrowserSha256V2(
  "programmable.custom-graph-project-metadata.v1",
  {
    graphBundleHash: UNBOUND_GRAPH_BUNDLE_HASH,
    projectMetadataHash: PROJECT_METADATA_HASH,
  },
);

function apiKey(
  id: string,
  overrides: Partial<ApiKeySummary> = {},
): ApiKeySummary {
  return {
    id,
    label: id,
    keyPrefix: `pm_${id}`,
    scopes: ["custom-launch:create", "custom-launch:read"],
    createdAt: "2026-08-25T10:00:00.000Z",
    expiresAt: "2026-11-23T10:00:00.000Z",
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function launch(
  requestId: string,
  status: LaunchStatus,
  updatedAt: string,
): LaunchResource {
  return {
    schemaVersion: "programmable.custom-launch.v1",
    launchId: requestId,
    requestId,
    onchainLaunchId: null,
    routeId: "custom-launch:create:v1",
    ownerWallet: "0x0000000000000000000000000000000000000001",
    status,
    requestHash: `sha256:${"00".repeat(32)}`,
    launchProfileVersion: null,
    launchProfileHash: null,
    launchIntentHash: null,
    projectMetadata: null,
    projectMetadataHash: null,
    fundingIntentHash: null,
    liquidityIntent: null,
    sourceVerification: null,
    walletHandoffUrl: null,
    expiresAt: null,
    secondsRemaining: null,
    createdAt: "2026-08-25T10:00:00.000Z",
    updatedAt,
    output: null,
    failure: null,
    rawResourceV4: null,
  };
}

function v3Launch(
  status: LaunchStatus,
  sequence: number,
): LaunchResource {
  return {
    ...launch(
      "request-v3",
      status,
      new Date(Date.UTC(2026, 7, 25, 10, 0, sequence)).toISOString(),
    ),
    schemaVersion: "programmable.custom-launch.v3",
    routeId: "custom-launch:create:v3",
    launchProfileVersion: "3.2.0",
    launchProfileHash: `sha256:${"11".repeat(32)}`,
    launchIntentHash: `sha256:${"22".repeat(32)}`,
    projectMetadata: PROJECT_METADATA,
    projectMetadataHash: PROJECT_METADATA_HASH,
    fundingIntentHash: `0x${"33".repeat(32)}`,
    liquidityIntent: {
      model: "external-concentrated-liquidity",
      declaredLaunchState: "liquidity_required",
      binding: "explicit-request-hash",
    },
  };
}

describe("developer API key interface", () => {
  it("models one-time and replayed mutations without leaking a replay secret", () => {
    const oldCredentialId = "018f3e2a-7b4c-7d5e-8f90-123456789abc";
    const replacement = apiKey("028f3e2a-7b4c-7d5e-8f90-123456789abc", {
      keyPrefix: `pm_live_${"A".repeat(22)}`,
    });
    const secret = `${replacement.keyPrefix}_${"B".repeat(43)}`;
    const delivered = parseApiKeyMutationResult({
      schemaVersion: "programmable.custom-launch-api.v1",
      apiKey: replacement,
      secretState: "delivered-once",
      apiKeySecret: secret,
      rotatedCredentialId: oldCredentialId,
    }, 201, oldCredentialId);
    const replayed = parseApiKeyMutationResult({
      schemaVersion: "programmable.custom-launch-api.v1",
      apiKey: replacement,
      secretState: "already-delivered",
      rotatedCredentialId: oldCredentialId,
    }, 200, oldCredentialId);

    expect(delivered).toEqual({
      apiKey: replacement,
      secretState: "delivered-once",
      apiKeySecret: secret,
      rotatedCredentialId: oldCredentialId,
    });
    expect(replayed).toEqual({
      apiKey: replacement,
      secretState: "already-delivered",
      rotatedCredentialId: oldCredentialId,
    });
    expect(parseApiKeyMutationResult({
      schemaVersion: "programmable.custom-launch-api.v1",
      apiKey: replacement,
      secretState: "already-delivered",
      apiKeySecret: secret,
      rotatedCredentialId: oldCredentialId,
    }, 200, oldCredentialId)).toBeNull();
    expect(parseApiKeyMutationResult({
      schemaVersion: "programmable.custom-launch-api.v1",
      apiKey: apiKey(oldCredentialId),
      secretState: "already-delivered",
      rotatedCredentialId: oldCredentialId,
    }, 200, oldCredentialId)).toBeNull();
    expect(applyApiKeyMutationResult(
      [apiKey(oldCredentialId)],
      replayed!,
      "2026-08-27T10:00:00.000Z",
    )).toEqual([
      replacement,
      expect.objectContaining({
        id: oldCredentialId,
        revokedAt: "2026-08-27T10:00:00.000Z",
      }),
    ]);

    const input = { kind: "issue" as const, credentialId: null, body: "{}" };
    const attempt = prepareApiKeyMutationAttempt(
      null,
      input,
      () => "018f3e2a-7b4c-7d5e-8f90-123456789abc",
    );
    expect(prepareApiKeyMutationAttempt(
      attempt,
      input,
      () => "unused-idempotency-key",
    )).toBe(attempt);
    expect(() => prepareApiKeyMutationAttempt(
      attempt,
      { ...input, body: '{"label":"different"}' },
      () => "unused-idempotency-key",
    )).toThrow("An API key mutation retry is already pending");
    expect(shouldRetainApiKeyMutationAttempt(503, null)).toBe(true);
    expect(shouldRetainApiKeyMutationAttempt(400, null)).toBe(false);
    expect(apiKeyLifetimeDays(apiKey("lifetime", {
      createdAt: "2026-08-27T10:00:00.500Z",
      expiresAt: "2026-09-26T10:00:00.000Z",
    }))).toBe(30);
  });

  it("keeps the first view compact and focused on key management", () => {
    expect(apiKeysSource).toContain("<h1>API keys</h1>");
    expect(apiKeysSource).toContain('aria-label="Developer access view"');
    expect(apiKeysSource).toContain('aria-pressed={activeSection === "keys"}');
    expect(apiKeysSource).toContain('aria-pressed={activeSection === "history"}');
    expect(apiKeysSource).toContain('activeSection === "keys" ?');
    expect(apiKeysSource).not.toContain("Before anything reaches your wallet");
    expect(apiKeysSource).toContain('href="/launch"');
    expect(apiKeysSource).toContain("<span>Back</span>");
    expect(apiKeysSource).not.toContain("Back to profile");
    expect(apiKeysSource).toContain("const API_KEY_PAGE_SIZE = 3");
    expect(apiKeysSource).toContain("visibleApiKeys.map");
    expect(apiKeysSource).toContain('aria-label="API key pages"');
    expect(apiKeysSource).not.toContain("Fee claims and automated buybacks");
    expect(apiKeysSource).not.toContain("Key owner");
    expect(apiKeysSource).not.toContain("activeCount");

    expect(apiKeysStyles).toMatch(
      /\.workspace\s*\{[^}]*align-items:\s*start;/su,
    );
    expect(apiKeysStyles).toMatch(
      /\.workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/su,
    );
    expect(apiKeysStyles).toMatch(
      /\.listToolbar\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*flex-end;/su,
    );
    expect(apiKeysStyles).toContain("--api-key-row-min-height");
    expect(apiKeysStyles).not.toContain("grid-template-rows: repeat(");
    expect(apiKeysSource.indexOf('aria-labelledby="api-keys-title"')).toBeLessThan(
      apiKeysSource.indexOf('aria-labelledby="agent-setup-title"'),
    );
    expect(apiKeysSource.indexOf('aria-label="API key pages"')).toBeLessThan(
      apiKeysSource.indexOf('className={styles.keyList}'),
    );
    expect(apiKeysStyles).not.toContain("height: clamp(");
    expect(apiKeysStyles).not.toMatch(
      /\.keyList\s*\{[^}]*overflow-y:\s*auto;/su,
    );
    expect(apiKeysStyles).toContain("--api-panel: var(--webde-surface)");
    expect(apiKeysStyles).toContain("--api-line: var(--webde-line)");
    expect(apiKeysStyles).not.toContain("liquid-glass");
  });

  it("uses a styled expiry listbox with complete keyboard and form behavior", () => {
    const expirySelectSource = apiKeysSource.slice(
      apiKeysSource.indexOf("function ExpirySelect"),
      apiKeysSource.indexOf("export function DeveloperApiKeys"),
    );

    expect(apiKeysSource).toContain('aria-haspopup="listbox"');
    expect(apiKeysSource).toContain('role="listbox"');
    expect(apiKeysSource).toContain('role="option"');
    expect(apiKeysSource).toContain('name="expiresInDays"');
    expect(apiKeysSource).toContain('type="hidden"');
    expect(apiKeysSource).toContain('event.key === "ArrowDown"');
    expect(apiKeysSource).toContain('event.key === "ArrowUp"');
    expect(apiKeysSource).toContain('event.key === "Home"');
    expect(apiKeysSource).toContain('event.key === "End"');
    expect(apiKeysSource).toContain('event.key === "Escape"');
    expect(expirySelectSource).toContain("onBlurCapture={(event) => {");
    expect(expirySelectSource).toContain(
      "event.currentTarget.contains(event.relatedTarget)",
    );
    expect(expirySelectSource).not.toContain('event.key === "Tab"');
    expect(apiKeysStyles).toContain(".expiryTrigger");
    expect(apiKeysStyles).toContain(".expiryMenu");
    expect(apiKeysStyles).not.toContain("appearance: auto");
  });

  it.each([
    { state: "returning wallet before any key mutation", authReady: true,
      account: "0x0000000000000000000000000000000000000001" as const },
    { state: "disconnected wallet", authReady: true, account: null },
    { state: "loading wallet session", authReady: false, account: null },
  ])("offers setup without exposing a key for $state", ({ authReady, account }) => {
    const getToken = vi.fn(async () => null);
    const walletAction = vi.fn(async (): Promise<`0x${string}`> => {
      throw new Error("Setup must not request a wallet action");
    });
    const html = renderToStaticMarkup(createElement(DeveloperApiKeysView, {
      account,
      authReady,
      connecting: false,
      getAccessToken: getToken,
      getIdentityToken: getToken,
      initialSection: "keys",
      openWallet: vi.fn(),
      sendCustomLaunchWalletAction: walletAction,
      sendCustomLaunchWalletActionV4: walletAction,
      signCustomLaunchFundingAuthorization: walletAction,
    }));

    const setupButton = html.match(/<button\b[^>]*>Copy agent setup<\/button>/u)?.[0];
    expect(setupButton).toBeDefined();
    expect(setupButton).not.toContain("disabled");
    expect(html).toContain('aria-labelledby="agent-setup-title"');
    expect(html).toMatch(/<details[^>]*aria-labelledby="agent-setup-title"[^>]*>/u);
    expect(html).not.toMatch(/<details[^>]*\bopen[^>]*aria-labelledby="agent-setup-title"/u);
    expect(html).toContain("new or existing key");
    expect(html).not.toContain(">Copy key</button>");
    expect(html).not.toContain("api-key-mutation-result-title");
    expect(html).not.toMatch(/pm_live_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{43}/u);
    expect(getToken).not.toHaveBeenCalled();
    expect(walletAction).not.toHaveBeenCalled();
  });

  it("keeps copying setup independent of the one-time key secret", () => {
    const copyKeyStart = apiKeysSource.indexOf("const copyApiKey = async");
    const copySetupStart = apiKeysSource.indexOf("const copyAgentSetup = async");
    const dismissStart = apiKeysSource.indexOf("const dismissApiKeyResult =");
    expect(copyKeyStart).toBeGreaterThan(-1);
    expect(copySetupStart).toBeGreaterThan(copyKeyStart);
    expect(dismissStart).toBeGreaterThan(copySetupStart);

    const copyKey = apiKeysSource.slice(copyKeyStart, copySetupStart);
    const copySetup = apiKeysSource.slice(copySetupStart, dismissStart);
    expect(copyKey).toContain('secretState !== "delivered-once"');
    expect(copySetup).toContain('purpose === "module-contributions"');
    expect(copySetup).toContain("? moduleAgentSetupText");
    expect(copySetup).toContain(": agentSetupText");
    expect(copySetup).not.toContain("mutationResult");
    expect(copySetup).not.toContain("apiKeySecret");
  });

  it("recognizes only the two complete purpose pairs", () => {
    expect(apiKeyPurpose(["custom-launch:create", "custom-launch:read"]))
      .toBe("custom-launches");
    expect(apiKeyPurpose(["modules:read", "modules:submit"]))
      .toBe("module-contributions");
    expect(apiKeyPurposeLabel(["modules:submit", "modules:read"]))
      .toBe("Module contributions");
    for (const scopes of [
      [], ["modules:submit"], ["modules:submit", "modules:submit"],
      ["modules:read", "custom-launch:create"],
      ["modules:submit", "modules:read", "modules:approve"],
    ]) {
      expect(apiKeyPurpose(scopes)).toBeNull();
      expect(apiKeyPurposeLabel(scopes)).toBe("Unrecognized purpose");
      expect(parseApiKeyMutationResult({
        schemaVersion: "programmable.custom-launch-api.v1",
        apiKey: apiKey("invalid", { scopes }),
        secretState: "already-delivered",
      }, 200)).toBeNull();
    }
  });

  it("verifies the requested purpose before accepting an issue or rotation result", () => {
    const moduleKey = apiKey("replacement", { scopes: ["modules:submit", "modules:read"] });
    const result = {
      schemaVersion: "programmable.custom-launch-api.v1",
      apiKey: moduleKey,
      secretState: "already-delivered",
    };
    expect(parseApiKeyMutationResult(result, 200, undefined, "module-contributions"))
      .toMatchObject({ apiKey: moduleKey });
    expect(parseApiKeyMutationResult(result, 200, undefined, "custom-launches")).toBeNull();
    const rotated = { ...result, rotatedCredentialId: "old" };
    expect(parseApiKeyMutationResult(rotated, 200, "old", "module-contributions"))
      .toMatchObject({ apiKey: moduleKey });
    expect(parseApiKeyMutationResult(rotated, 200, "old", "custom-launches")).toBeNull();
  });

  it("requires explicit issuance and submission availability without guessing from existing keys", () => {
    const base = { schemaVersion: "programmable.custom-launch-api.v1", apiKeys: [] };
    expect(moduleContributionKeysAvailable({
      ...base, moduleContributions: { apiKeyIssuance: true, submissions: true },
    })).toBe(true);
    for (const moduleContributions of [
      undefined, null, {},
      { apiKeyIssuance: false, submissions: true },
      { apiKeyIssuance: true, submissions: false },
      { apiKeyIssuance: "true", submissions: true },
    ]) {
      expect(moduleContributionKeysAvailable({ ...base, moduleContributions })).toBe(false);
    }
    expect(moduleContributionKeysAvailable({
      ...base, apiKeys: [apiKey("module", { scopes: ["modules:submit", "modules:read"] })],
    })).toBe(false);
    expect(moduleContributionKeysAvailable({
      moduleContributions: { apiKeyIssuance: true, submissions: true },
    })).toBe(false);
  });

  it("renders a native purpose choice with the module option pending until available", () => {
    const onChange = vi.fn();
    const pending = renderToStaticMarkup(createElement(ApiKeyPurposeChoice, {
      value: "custom-launches", onChange, moduleContributionsAvailable: false,
      checking: false, disabled: false,
    }));
    expect(pending).toContain("<legend>Purpose</legend>");
    expect(pending).toMatch(/<input[^>]*type="radio"[^>]*checked=""[^>]*value="custom-launches"/u);
    expect(pending).toMatch(/<input[^>]*type="radio"[^>]*disabled=""[^>]*value="module-contributions"/u);
    expect(pending).toContain('aria-describedby="module-key-availability"');
    expect(pending).toContain("Module contributions are not available right now.");
    expect(pending).toContain("Pending");
    const available = renderToStaticMarkup(createElement(ApiKeyPurposeChoice, {
      value: "module-contributions", onChange, moduleContributionsAvailable: true,
      checking: false, disabled: false,
    }));
    expect(available).not.toContain('disabled=""');
    expect(available).toMatch(/<input[^>]*checked=""[^>]*value="module-contributions"/u);
    expect(available).toContain("Submit module packages and read their review status.");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("gives module agents a source-intake setup without launch instructions or secrets", () => {
    expect(PROGRAMMABLE_MODULE_AGENT_SETUP_TEXT_V1).toContain("$PROGRAMMABLE_MODULES_API_KEY");
    expect(PROGRAMMABLE_MODULE_AGENT_SETUP_TEXT_V1).toContain("modules:submit and modules:read");
    expect(PROGRAMMABLE_MODULE_AGENT_SETUP_TEXT_V1).toContain("GET https://api.programmable.market/v1/modules/capabilities");
    expect(PROGRAMMABLE_MODULE_AGENT_SETUP_TEXT_V1).toContain("POST /v1/modules/submissions");
    expect(PROGRAMMABLE_MODULE_AGENT_SETUP_TEXT_V1).toContain("GET /v1/modules/submissions/:id");
    expect(PROGRAMMABLE_MODULE_AGENT_SETUP_TEXT_V1).toContain("draft_received");
    expect(PROGRAMMABLE_MODULE_AGENT_SETUP_TEXT_V1).toContain("not an approval");
    expect(PROGRAMMABLE_MODULE_AGENT_SETUP_TEXT_V1).not.toContain("custom-launch:create");
    expect(PROGRAMMABLE_MODULE_AGENT_SETUP_TEXT_V1).not.toMatch(/pm_live_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{43}/u);
    expect(apiKeysSource).toContain("setPurpose(originalPurpose)");
  });

  it("preserves wallet authority and one-time secret handling", () => {
    expect(apiKeysSource).toContain(
      "API keys cannot sign or broadcast wallet transactions.",
    );
    expect(apiKeysSource).toContain("Save this key now");
    expect(apiKeysSource).toContain("It will not be shown again.");
    expect(apiKeysSource).toContain("data-confirm-revoke");
    expect(apiKeysSource).toContain('event.key === "Escape"');
    expect(apiKeysSource).toContain("revealRef.current?.focus()");
    expect(apiKeysSource).toContain("confirmRevokeRef.current?.focus()");
    expect(apiKeysSource).toContain("Copy agent setup");
    expect(apiKeysSource).toContain("PROGRAMMABLE_AGENT_SETUP_TEXT_V1");
    expect(apiKeysSource).toContain(
      "the <code>$PROGRAMMABLE_API_KEY</code> placeholder, never your secret.",
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain("$PROGRAMMABLE_API_KEY");
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(
      PROGRAMMABLE_AGENT_SETUP_LINKS_V1.cli,
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(
      PROGRAMMABLE_AGENT_SETUP_LINKS_V1.discovery,
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(
      PROGRAMMABLE_AGENT_SETUP_LINKS_V1.capabilities,
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(
      PROGRAMMABLE_AGENT_SETUP_LINKS_V1.preflight,
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(
      PROGRAMMABLE_AGENT_SETUP_LINKS_V1.remediation,
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(
      PROGRAMMABLE_AGENT_SETUP_LINKS_V1.packConfigSchema,
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(
      PROGRAMMABLE_AGENT_SETUP_LINKS_V1.guide,
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(
      PROGRAMMABLE_AGENT_SETUP_LINKS_V1.openApi,
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(
      PROGRAMMABLE_AGENT_SETUP_LINKS_V1.openApiV2Compatibility,
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(
      PROGRAMMABLE_AGENT_SETUP_LINKS_V1.openApiV1Compatibility,
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(
      "pack -> validate --remote -> submit -> server decision -> status --watch --until authorized -> wallet -> status --watch --until finalized",
    );
    expect(PROGRAMMABLE_AGENT_SETUP_LINKS_V1.cli).toContain(
      "programmable-launch-v3.3.9",
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(
      "Before pack, collect the required project name and symbol",
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(
      "non-empty local PNG, JPEG, WebP or GIF plus its canonical public HTTPS, IPFS or Arweave URI",
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(
      "website shows the same metadata read-only",
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(
      "There is no project allowlist or private approval path.",
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain("action_required");
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain("quotaConsumed");
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain("nonceAllocated");
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(
      "launchEligibility.deployable",
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain("needs_evidence");
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain("walletHandoffUrl");
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(
      "awaiting_funding_authorization",
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(
      "review and send the exact Router transaction",
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).not.toContain("integration-pending");
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).not.toContain("pm_live_");
  });

  it("routes copied setup by the intended chain and gates V4 before authenticated requests", () => {
    const setup = PROGRAMMABLE_AGENT_SETUP_TEXT_V1;
    const robinhoodStart = setup.indexOf("Robinhood Chain Mainnet only (V4, chain 4663)");
    const ethereumStart = setup.indexOf("Ethereum Mainnet only (V3, chain 1)");
    const robinhood = setup.slice(robinhoodStart, ethereumStart);
    const ethereum = setup.slice(ethereumStart);

    expect(robinhoodStart).toBeGreaterThan(0);
    expect(ethereumStart).toBeGreaterThan(robinhoodStart);
    expect(setup.slice(0, robinhoodStart)).toContain("project's intended chain");
    expect(setup.slice(0, robinhoodStart)).toContain("never fall back to another chain");
    expect(robinhood).toContain("customLaunchApi.versions.v4");
    expect(robinhood).toContain("publicAuthorization, publicWrites and releaseReady to be true in both");
    expect(robinhood).toContain("immutable published release");
    expect(robinhood).toContain("matching tarball checksum");
    expect(robinhood).toContain("stop before authenticated preflight or submission");
    expect(robinhood).toContain("before reading the API key");
    expect(robinhood.indexOf("stop before authenticated preflight or submission"))
      .toBeLessThan(robinhood.indexOf("programmable-launch pack"));
    for (const url of [
      PROGRAMMABLE_AGENT_SETUP_LINKS_V1.robinhoodCapabilities,
      PROGRAMMABLE_AGENT_SETUP_LINKS_V1.robinhoodReadiness,
      PROGRAMMABLE_AGENT_SETUP_LINKS_V1.robinhoodPreflight,
      PROGRAMMABLE_AGENT_SETUP_LINKS_V1.robinhoodPackConfigSchema,
      PROGRAMMABLE_AGENT_SETUP_LINKS_V1.robinhoodGuide,
      PROGRAMMABLE_AGENT_SETUP_LINKS_V1.robinhoodOpenApi,
    ]) expect(robinhood).toContain(url);
    expect(robinhood).toContain("programmable.launch-pack-config.v4");
    expect(robinhood).toContain("PNG or single-frame GIF");
    expect(robinhood).toContain("--api-version 4 --chain-id 4663 --watch --until authorized");
    expect(robinhood).toContain("--api-version 4 --chain-id 4663 --watch --until finalized");
    expect(robinhood).toContain("wallet_action_required");
    expect(robinhood).toContain("never sign or broadcast");
    expect(robinhood).not.toContain("/v3/");
    expect(robinhood).not.toContain(PROGRAMMABLE_AGENT_SETUP_LINKS_V1.cli);
    expect(ethereum).toContain(PROGRAMMABLE_AGENT_SETUP_LINKS_V1.cli);
    expect(ethereum).toContain("programmable.launch-pack-config.v3");
    expect(setup).not.toContain("Use only the current V3.3 profile for a new submission");
  });

  it("offers named loading, failure, empty and recovery states", () => {
    expect(apiKeysSource).toContain("Loading wallet session");
    expect(apiKeysSource).toContain("Wallet access is unavailable");
    expect(apiKeysSource).toContain("Reload page");
    expect(apiKeysSource).toContain("Loading API keys");
    expect(apiKeysSource).toContain("Unable to load keys");
    expect(apiKeysSource).toContain("No keys yet");
    expect(apiKeysSource).toContain("Try again");
    expect(apiKeysSource).toContain("API keys refreshed.");
    expect(apiKeysSource).toContain("Refresh keys");
    expect(apiKeysSource).toContain("data-spinning=");
    expect(apiKeysSource).toContain("8_000");
    expect(apiKeysStyles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(apiKeysStyles).toContain("min-height: 44px");
  });

  it("keeps mutation results when a stale key list arrives", () => {
    const revoked = apiKey("revoked", {
      lastUsedAt: "2026-08-25T10:02:00.000Z",
      revokedAt: "2026-08-25T10:03:00.000Z",
    });
    const created = apiKey("created");
    const staleRevoked = apiKey("revoked", {
      lastUsedAt: "2026-08-25T10:04:00.000Z",
    });
    const serverOnly = apiKey("server-only");

    const merged = mergeApiKeySummaries(
      [created, revoked],
      [staleRevoked, serverOnly],
    );

    expect(merged.map((candidate) => candidate.id)).toEqual([
      "revoked",
      "server-only",
      "created",
    ]);
    expect(merged[0]?.revokedAt).toBe(revoked.revokedAt);
    expect(merged[0]?.lastUsedAt).toBe(staleRevoked.lastUsedAt);
    expect(apiKeysSource).toContain(
      "const readGeneration = ++apiKeyReadGenerationRef.current;",
    );
    expect(apiKeysSource.match(
      /readGeneration !== apiKeyReadGenerationRef\.current/gu,
    )).toHaveLength(2);
    expect(apiKeysSource.match(
      /refreshApiKeysAfterMutation\(account\);/gu,
    )).toHaveLength(3);
    expect(apiKeysSource).toContain(
      'loadApiKeys(walletAddress, undefined, "mutation")',
    );
  });
});

describe("developer launch history interface", () => {
  it("accepts compact authorized V2 list rows and defers output to detail", () => {
    const resource = {
      schemaVersion: "programmable.custom-launch.v2",
      launchId: "50000000-0000-4000-8000-000000000005",
      requestId: "50000000-0000-4000-8000-000000000005",
      onchainLaunchId: null,
      routeId: "custom-launch:create:v2",
      ownerWallet: "0x0000000000000000000000000000000000000001",
      status: "authorized",
      requestHash: `sha256:${"11".repeat(32)}`,
      launchProfileHash: `sha256:${"22".repeat(32)}`,
      launchIntentHash: `sha256:${"33".repeat(32)}`,
      createdAt: "2026-08-25T10:00:00.000Z",
      updatedAt: "2026-08-25T10:01:00.000Z",
      output: null,
      failure: null,
    } as const;
    expect(parseHistoryPage({
      schemaVersion: "programmable.custom-launch-history.v1",
      launches: [resource],
      nextCursor: null,
    }, resource.ownerWallet)).toEqual({
      launches: [{
        ...resource,
        launchProfileVersion: null,
        projectMetadata: null,
        projectMetadataHash: null,
        fundingIntentHash: null,
        liquidityIntent: null,
        sourceVerification: null,
        walletHandoffUrl: null,
        expiresAt: null,
        secondsRemaining: null,
        rawResourceV4: null,
      }],
      nextCursor: null,
    });
    expect(historySource).toContain(
      "const current = await readLaunchResource(launch);",
    );
  });

  it("stays behind the compact view switch and keeps the signing boundary clear", () => {
    expect(historySource).toContain("Launch history");
    expect(historySource).toContain(
      "A launch is onchain only after the\n        wallet sends its Router transaction.",
    );
    expect(historySource).toContain("Check onchain status");
    expect(historySource).toContain("Review and send launch transaction");
    expect(historySource).toContain("sendCustomLaunchWalletAction(action)");
    expect(historySource).toContain("startStatusPolling(current)");
    expect(historySource).toContain('launch.routeId === "custom-launch:create:v2"');
    expect(historySource).toContain("prepareCustomLaunchWalletActionV2(");
    expect(historySource).toContain("&version=${version}");
    expect(historySource).toContain("Wallet action required");
    expect(historySource).toContain(
      "Review the exact Ethereum Mainnet transaction, then ask your wallet to send it.",
    );
    expect(historySource).not.toContain("Your agent&apos;s first accepted request");
    expect(historyStyles).not.toContain("height: clamp(");
    expect(historyStyles).toContain("background: var(--webde-surface)");
    expect(historyStyles).toContain("background: var(--webde-surface-raised)");
    expect(historyStyles).not.toContain("liquid-glass");
    expect(historyStyles).not.toMatch(
      /\.launchList\s*\{[^}]*overflow-y:\s*auto;/su,
    );
  });

  it("announces loading and refreshed status without changing wallet authority", () => {
    expect(historySource).toContain("Loading launch history");
    expect(historySource).toContain("Launch status updated.");
    expect(historySource).toContain("Launch history refreshed.");
    expect(historySource).toContain("Refresh history");
    expect(historySource).toContain('aria-live="polite"');
    expect(historySource).toContain("state === \"loading\" || loadingMore || refreshing");
    expect(historySource).toContain("Prepared transaction");
    expect(historySource).toContain("Programmable fee");
    expect(historySource).toContain(
      "No automatic Programmable fee claim",
    );
    expect(historySource).toContain(
      "10 bps · exact fee-path verification required",
    );
    expect(historySource).toContain("Admission checks running");
    expect(historySource).toContain("Changes required");
    expect(historySource).toContain("Fix source or configuration");
    expect(historySource).toContain(
      "Fix the reported source or configuration finding",
    );
    expect(historySource).toContain('launch.routeId === "custom-launch:create:v3"');
    expect(historySource).toContain('? "v3"');
    expect(historySource).toContain('? "v2"');
    expect(historySource).toContain(
      "encodeURIComponent(resourceIdentity)",
    );
    expect(historySource).toContain("PROGRAMMABLE_AGENT_SETUP_LINKS_V1.remediation");
    expect(historySource).toContain("Read the remediation catalog");
    expect(historySource).toContain("View exact fixes");
    expect(historySource).toContain("Copy fix for agent");
    expect(historySource).toContain(
      "Rebuild and submit a new immutable request. Do not sign this one.",
    );
    expect(historySource).toContain("manual or project allowlist");
    expect(historySource).toContain("This result is not an audit or");
    expect(historySource).toContain("safety verdict");
    expect(historySource).not.toContain("Review required");
    expect(historySource).not.toContain("Platform review required");
    expect(historySource).not.toContain("needs platform review");
    expect(historySource).toContain(
      'reviewLaunch.failure\n                  && reviewLaunch.status !== "action_required"',
    );
    expect(historySource).toContain(
      "When an API error includes a request ID and retrying does not",
    );
    expect(historySource).toContain("contact support with that ID");
    expect(historySource).toContain("Never send your API key.");
    expect(historySource.indexOf("Open Programmable support")).toBeLessThan(
      historySource.indexOf('state === "ready" && launches.length === 0'),
    );
    expect(historySource.indexOf("Read the remediation catalog")).toBeGreaterThan(
      historySource.indexOf('launch.status === "action_required"'),
    );
  });

  it("releases a stalled history refresh with a clear retry state", () => {
    expect(historySource).toContain("launchHistoryRefreshTimeoutMs = 12_000");
    expect(historySource).toContain(
      "controller.abort(launchHistoryRefreshTimeoutReason)",
    );
    expect(historySource).toContain(
      "Launch history refresh took too long. Try again.",
    );
    expect(historySource).toContain(
      "Launch history refresh timed out.",
    );
    expect(historySource).toContain("setRefreshing(false)");
  });

  it("retries both bounded single-resource pollers after safe 503 responses", () => {
    expect(launchPollingRetryAfterMs(429, 3_000)).toBe(3_000);
    expect(launchPollingRetryAfterMs(503, 7_000)).toBe(7_000);
    expect(launchPollingRetryAfterMs(503, null)).toBeNull();
    expect(launchPollingRetryAfterMs(500, 7_000)).toBeNull();

    const postWalletStart = historySource.indexOf(
      "const startStatusPolling = useCallback",
    );
    const preparationStart = historySource.indexOf(
      "const startV3PreparationPolling = useCallback",
      postWalletStart,
    );
    const preparationEnd = historySource.indexOf(
      "const submitFundingAuthorization = async",
      preparationStart,
    );
    expect(postWalletStart).toBeGreaterThan(-1);
    expect(preparationStart).toBeGreaterThan(postWalletStart);
    expect(preparationEnd).toBeGreaterThan(preparationStart);

    for (const poller of [
      historySource.slice(postWalletStart, preparationStart),
      historySource.slice(preparationStart, preparationEnd),
    ]) {
      expect(poller).toContain("launchPollingRetryAfterMs(");
      expect(poller).toContain("waitMs = retryAfterMs;");
      expect(poller).toContain("continue;");
      expect(poller).toContain("while (!controller.signal.aborted)");
      expect(poller).toContain("if (terminalStatus(updated.status))");
    }
  });

  it("shows bounded Retry-After guidance for both retryable error statuses", () => {
    expect(apiKeysSource).toContain(
      "(response.status === 429 || response.status === 503)",
    );
    expect(historySource).toContain(
      "(response.status === 429 || response.status === 503)",
    );
  });

  it("keeps stored launch failures out of assertive live regions", () => {
    const storedFailureStart = historySource.indexOf("{reviewLaunch.failure");
    const storedFailureEnd = historySource.indexOf(
      '{reviewLaunch.status === "action_required"',
      storedFailureStart,
    );
    expect(storedFailureStart).toBeGreaterThan(-1);
    expect(storedFailureEnd).toBeGreaterThan(storedFailureStart);

    const storedFailure = historySource.slice(
      storedFailureStart,
      storedFailureEnd,
    );
    expect(storedFailure).toContain("<p className={styles.failure}>");
    expect(storedFailure).not.toContain('role="alert"');
    expect(historySource).toContain(
      '<p className={styles.inlineError} role="alert">',
    );
  });

  it("keeps the complete EIP-3009 preparation lifecycle monotonic", () => {
    const statuses: LaunchStatus[] = [
      "received",
      "validating",
      "awaiting_funding_authorization",
      "funding_authorization_verified",
      "pending_review",
      "prepared",
      "simulating",
      "authorized",
      "submitted",
      "finalized",
    ];
    const lifecycle = statuses.map((status, sequence) =>
      v3Launch(status, sequence));
    let current = lifecycle[0]!;
    for (const incoming of lifecycle.slice(1)) {
      current = selectMonotonicLaunchResource(current, incoming);
      expect(current).toBe(incoming);
    }

    const pendingReview = v3Launch("pending_review", 4);
    const actionRequired = v3Launch("action_required", 5);
    const olderPendingReview = v3Launch("pending_review", 4);
    const preparedAfterReview = v3Launch("prepared", 6);
    expect(selectMonotonicLaunchResource(
      pendingReview,
      actionRequired,
    )).toBe(actionRequired);
    expect(selectMonotonicLaunchResource(
      actionRequired,
      olderPendingReview,
    )).toBe(actionRequired);
    expect(selectMonotonicLaunchResource(
      actionRequired,
      preparedAfterReview,
    )).toBe(preparedAfterReview);

    const preparationStart = historySource.indexOf(
      "const startV3PreparationPolling = useCallback",
    );
    const preparationEnd = historySource.indexOf(
      "const submitFundingAuthorization = async",
      preparationStart,
    );
    const preparationPoller = historySource.slice(
      preparationStart,
      preparationEnd,
    );
    expect(preparationPoller).toContain('updated.status === "action_required"');
    expect(preparationPoller).toContain(
      "Source or configuration changes are required before Router simulation. No wallet action is needed.",
    );
    expect(preparationPoller).toContain('"pending_review"');
    expect(preparationPoller).toContain('"prepared"');
    expect(preparationPoller.indexOf('updated.status === "action_required"'))
      .toBeLessThan(preparationPoller.indexOf("unexpected preparation status"));
  });

  it("hydrates compact V3 rows and rechecks the reviewed bytes before either wallet action", () => {
    expect(historySource).toContain(
      "const reviewLaunch = reviewResourceForLaunch(",
    );
    expect(historySource).toContain("Load funding review");
    expect(historySource).toContain("Load Router review");
    expect(historySource).toContain("Review and sign USDC authorization");
    expect(historySource).toContain("Review and send launch transaction");
    expect(historySource).not.toContain("Send reviewed Router transaction");
    expect(historySource).toContain(
      "onClick={() => void loadWalletReview(launch)}",
    );
    expect(historySource).toContain("reviewLaunch.output !== null");

    const hydrationStart = historySource.indexOf(
      "const loadWalletReview = async",
    );
    const hydrationEnd = historySource.indexOf(
      "const startV3PreparationPolling",
      hydrationStart,
    );
    const hydrationBoundary = historySource.slice(hydrationStart, hydrationEnd);
    const validatedHydrationWrite = hydrationBoundary.lastIndexOf(
      "setHydratedReviews((reviews) => Object.freeze({",
    );
    expect(validatedHydrationWrite).toBeGreaterThan(
      hydrationBoundary.indexOf("fundingAuthorizationReview(current)"),
    );
    expect(validatedHydrationWrite).toBeGreaterThan(
      hydrationBoundary.indexOf("routerTransactionReview(current)"),
    );
    expect(historySource).toContain(
      '? routerReview?.walletAction ?? null\n              : walletTransaction(reviewLaunch)',
    );

    const fundingStart = historySource.indexOf(
      "const submitFundingAuthorization = async",
    );
    const fundingEnd = historySource.indexOf(
      "const submitWalletTransaction = async",
      fundingStart,
    );
    const fundingBoundary = historySource.slice(fundingStart, fundingEnd);
    expect(fundingBoundary.indexOf("sameFundingAuthorization(")).toBeGreaterThan(-1);
    expect(fundingBoundary.indexOf("sameProjectRequestBindingV1(")).toBeGreaterThan(-1);
    expect(fundingBoundary.indexOf("signCustomLaunchFundingAuthorization(")).toBeGreaterThan(
      fundingBoundary.indexOf("sameFundingAuthorization("),
    );
    expect(fundingBoundary.indexOf("signCustomLaunchFundingAuthorization(")).toBeGreaterThan(
      fundingBoundary.indexOf("sameProjectRequestBindingV1("),
    );

    const routerStart = fundingEnd;
    const routerEnd = historySource.indexOf("return (", routerStart);
    const routerBoundary = historySource.slice(routerStart, routerEnd);
    expect(routerBoundary.indexOf("sameRouterReview(")).toBeGreaterThan(-1);
    expect(routerBoundary.indexOf("sameProjectRequestBindingV1(")).toBeGreaterThan(-1);
    expect(routerBoundary.indexOf("sendCustomLaunchWalletAction(action)")).toBeGreaterThan(
      routerBoundary.indexOf("sameRouterReview("),
    );
    expect(routerBoundary.indexOf("sendCustomLaunchWalletAction(action)")).toBeGreaterThan(
      routerBoundary.indexOf("sameProjectRequestBindingV1("),
    );
  });

  it("renders and freezes the canonical project identity before either wallet step", () => {
    expect(parseCustomLaunchProjectMetadataV1(PROJECT_METADATA)).toEqual(
      PROJECT_METADATA,
    );
    expect(parseCustomLaunchProjectMetadataV1({
      ...PROJECT_METADATA,
      presentation: {
        ...PROJECT_METADATA.presentation,
        description: "First line\nSecond line",
      },
    })).not.toBeNull();
    expect(parseCustomLaunchProjectMetadataV1({
      ...PROJECT_METADATA,
      token: { ...PROJECT_METADATA.token, symbol: "BAD SYMBOL" },
    })).toBeNull();
    expect(parseCustomLaunchProjectMetadataV1({
      ...PROJECT_METADATA,
      tokenMetadataBinding: {
        ...PROJECT_METADATA.tokenMetadataBinding,
        name: {
          ...PROJECT_METADATA.tokenMetadataBinding.name,
          argumentName: "é".repeat(128),
        },
      },
    })).not.toBeNull();
    expect(parseCustomLaunchProjectMetadataV1({
      ...PROJECT_METADATA,
      tokenMetadataBinding: {
        ...PROJECT_METADATA.tokenMetadataBinding,
        name: {
          ...PROJECT_METADATA.tokenMetadataBinding.name,
          argumentName: "é".repeat(129),
        },
      },
    })).toBeNull();
    expect(parseCustomLaunchProjectMetadataV1({
      ...PROJECT_METADATA,
      tokenMetadataBinding: {
        ...PROJECT_METADATA.tokenMetadataBinding,
        name: {
          ...PROJECT_METADATA.tokenMetadataBinding.name,
          argumentName: "bad\ud800name",
        },
      },
    })).toBeNull();
    expect(parseCustomLaunchProjectMetadataV1({
      ...PROJECT_METADATA,
      tokenMetadataBinding: {
        ...PROJECT_METADATA.tokenMetadataBinding,
        name: {
          ...PROJECT_METADATA.tokenMetadataBinding.name,
          argumentName: "bad\nname",
        },
      },
    })).toBeNull();
    expect(parseCustomLaunchProjectMetadataV1({
      ...PROJECT_METADATA,
      presentation: {
        ...PROJECT_METADATA.presentation,
        description: "First line\tSecond line",
      },
    })).toBeNull();
    expect(parseCustomLaunchProjectMetadataV1({
      ...PROJECT_METADATA,
      presentation: {
        ...PROJECT_METADATA.presentation,
        description: "First line\u0085Second line",
      },
    })).toBeNull();
    expect(parseCustomLaunchProjectMetadataV1({
      ...PROJECT_METADATA,
      tokenMetadataBinding: {
        ...PROJECT_METADATA.tokenMetadataBinding,
        name: {
          ...PROJECT_METADATA.tokenMetadataBinding.name,
          argumentName: "bad\u0085name",
        },
      },
    })).toBeNull();
    expect(parseCustomLaunchProjectMetadataV1({
      ...PROJECT_METADATA,
      presentation: {
        ...PROJECT_METADATA.presentation,
        description: "First line\r\nSecond line",
      },
    })).toBeNull();
    expect(parseCustomLaunchProjectMetadataV1({
      ...PROJECT_METADATA,
      presentation: {
        ...PROJECT_METADATA.presentation,
        description: "bad\ud800text",
      },
    })).toBeNull();
    for (const uri of [
      "https://local/",
      "https://local./",
      "https://project.local/",
      "https://localhost./",
      "https://project.localhost./",
      "https://bad_host.example/",
    ]) {
      expect(parseCustomLaunchProjectMetadataV1({
        ...PROJECT_METADATA,
        presentation: {
          ...PROJECT_METADATA.presentation,
          links: [{ kind: "website", uri }],
        },
      })).toBeNull();
    }
    expect(parseCustomLaunchProjectMetadataV1({
      ...PROJECT_METADATA,
      presentation: {
        ...PROJECT_METADATA.presentation,
        links: [{ kind: "website", uri: "https://fc.example.com/" }],
      },
    })).not.toBeNull();
    expect(parseCustomLaunchProjectMetadataV1({
      ...PROJECT_METADATA,
      presentation: {
        ...PROJECT_METADATA.presentation,
        links: [...PROJECT_METADATA.presentation.links].reverse(),
      },
    })).toBeNull();
    expect(parseCustomLaunchProjectMetadataV1({
      ...PROJECT_METADATA,
      token: { ...PROJECT_METADATA.token, unexpected: true },
    })).toBeNull();
    expect(parseCustomLaunchProjectMetadataV1({
      ...PROJECT_METADATA,
      presentation: {
        ...PROJECT_METADATA.presentation,
        image: {
          ...PROJECT_METADATA.presentation.image!,
          uri: "ipfs://QmYwAPJzv5CZsnAzt8auVZRnGiRA7MCLGTMonGSQH9sV5v",
        },
      },
    })).not.toBeNull();
    expect(parseCustomLaunchProjectMetadataV1({
      ...PROJECT_METADATA,
      presentation: {
        ...PROJECT_METADATA.presentation,
        image: {
          ...PROJECT_METADATA.presentation.image!,
          uri: "ipfs://QmYwAPJzv5CZsnAzt8auVZRnGiRA7MCLGTMonGSQH9sV5v/image.png",
        },
      },
    })).toBeNull();

    const rawApiKey = `pm_live_${"a".repeat(22)}_${"b".repeat(43)}`;
    for (const metadata of [
      {
        ...PROJECT_METADATA,
        presentation: {
          ...PROJECT_METADATA.presentation,
          description: `keep ${rawApiKey} secret`,
        },
      },
      {
        ...PROJECT_METADATA,
        presentation: {
          ...PROJECT_METADATA.presentation,
          description: "programmable_api_key=do-not-cross-this-boundary",
        },
      },
      {
        ...PROJECT_METADATA,
        tokenMetadataBinding: {
          ...PROJECT_METADATA.tokenMetadataBinding,
          name: {
            ...PROJECT_METADATA.tokenMetadataBinding.name,
            argumentName: encodeURIComponent(rawApiKey),
          },
        },
      },
      {
        ...PROJECT_METADATA,
        tokenMetadataBinding: {
          ...PROJECT_METADATA.tokenMetadataBinding,
          tokenTargetId: rawApiKey,
        },
      },
      {
        ...PROJECT_METADATA,
        presentation: {
          ...PROJECT_METADATA.presentation,
          links: [{
            kind: "website",
            uri: `https://example.com/${encodeURIComponent(rawApiKey)}`,
          }],
        },
      },
      {
        ...PROJECT_METADATA,
        presentation: {
          ...PROJECT_METADATA.presentation,
          links: [{
            kind: "website",
            uri: "https://example.com/%C2%85hidden",
          }],
        },
      },
      {
        ...PROJECT_METADATA,
        presentation: {
          ...PROJECT_METADATA.presentation,
          links: [{
            kind: "website",
            uri: "https://example.com/%20hidden",
          }],
        },
      },
      {
        ...PROJECT_METADATA,
        presentation: {
          ...PROJECT_METADATA.presentation,
          links: [{
            kind: "website",
            uri: "https://example.com/\ud800hidden",
          }],
        },
      },
    ]) {
      expect(parseCustomLaunchProjectMetadataV1(metadata)).toBeNull();
    }

    const launch = {
      ...v3Launch("authorized", 7),
      output: {
        artifact: {
          unboundGraphBundleHash: UNBOUND_GRAPH_BUNDLE_HASH,
          graphBundleHash: GRAPH_BUNDLE_HASH,
          projectMetadata: JSON.parse(JSON.stringify(PROJECT_METADATA)),
          projectMetadataHash: PROJECT_METADATA_HASH,
        },
      },
    } satisfies LaunchResource;
    expect(walletProjectMetadataBindingV1(launch)).toEqual({
      mode: "bound-metadata",
      requestHash: launch.requestHash,
      launchIntentHash: launch.launchIntentHash,
      projectMetadata: PROJECT_METADATA,
      projectMetadataHash: PROJECT_METADATA_HASH,
    });
    expect(walletProjectMetadataBindingV1({
      ...launch,
      launchProfileVersion: "3.3.0",
    })).toEqual({
      mode: "bound-metadata",
      requestHash: launch.requestHash,
      launchIntentHash: launch.launchIntentHash,
      projectMetadata: PROJECT_METADATA,
      projectMetadataHash: PROJECT_METADATA_HASH,
    });
    expect(walletProjectMetadataRequirementsV1(PROJECT_METADATA)).toEqual({
      name: true,
      symbol: true,
      description: true,
      image: true,
      website: true,
      x: true,
      complete: true,
    });
    const missingX = {
      ...PROJECT_METADATA,
      presentation: {
        ...PROJECT_METADATA.presentation,
        links: PROJECT_METADATA.presentation.links.filter((link) => link.kind !== "x"),
      },
    } satisfies CustomLaunchProjectMetadataV1;
    const missingXHash = canonicalBrowserSha256V2(
      "programmable.project-metadata.v1",
      missingX,
    );
    expect(walletProjectMetadataRequirementsV1(missingX)).toMatchObject({
      x: false,
      complete: false,
    });
    expect(walletProjectMetadataBindingV1({
      ...launch,
      status: "prepared",
      projectMetadata: missingX,
      projectMetadataHash: missingXHash,
      output: null,
    })).toEqual(expect.objectContaining({
      mode: "bound-metadata",
      projectMetadataHash: missingXHash,
    }));
    expect(walletProjectMetadataBindingV1({
      ...launch,
      launchProfileVersion: "3.3.0",
      status: "prepared",
      projectMetadata: missingX,
      projectMetadataHash: missingXHash,
      output: null,
    })).toBeNull();
    expect(walletProjectMetadataSummaryV1({
      ...launch,
      output: null,
    })).toEqual({
      mode: "bound-metadata",
      requestHash: launch.requestHash,
      launchIntentHash: launch.launchIntentHash,
      projectMetadata: PROJECT_METADATA,
      projectMetadataHash: PROJECT_METADATA_HASH,
    });
    expect(walletProjectMetadataBindingV1({
      ...launch,
      output: {
        artifact: {
          unboundGraphBundleHash: UNBOUND_GRAPH_BUNDLE_HASH,
          graphBundleHash: `sha256:${"99".repeat(32)}`,
          projectMetadata: JSON.parse(JSON.stringify(PROJECT_METADATA)),
          projectMetadataHash: PROJECT_METADATA_HASH,
        },
      },
    })).toBeNull();
    expect(walletProjectMetadataBindingV1({
      ...launch,
      output: {
        artifact: {
          unboundGraphBundleHash: UNBOUND_GRAPH_BUNDLE_HASH,
          graphBundleHash: GRAPH_BUNDLE_HASH,
          projectMetadata: JSON.parse(JSON.stringify(PROJECT_METADATA)),
          projectMetadataHash: `sha256:${"66".repeat(32)}`,
        },
      },
    })).toBeNull();
    expect(walletProjectMetadataBindingV1({
      ...launch,
      projectMetadataHash: null,
    })).toBeNull();

    const legacy = {
      ...v3Launch("authorized", 7),
      launchProfileVersion: "3.0.0" as const,
      projectMetadata: null,
      projectMetadataHash: null,
      output: { artifact: { route: { routePayload: "0x" } } },
    } satisfies LaunchResource;
    expect(walletProjectMetadataBindingV1(legacy)).toBeNull();
    expect(walletProjectRequestBindingV1(legacy)).toEqual({
      mode: "legacy-exact-retry",
      launchProfileVersion: "3.0.0",
      requestHash: legacy.requestHash,
      launchIntentHash: legacy.launchIntentHash,
    });
    for (const launchProfileVersion of ["2.0.0", "3.1.0"] as const) {
      expect(walletProjectRequestBindingV1({
        ...legacy,
        launchProfileVersion,
      })).toEqual({
        mode: "legacy-exact-retry",
        launchProfileVersion,
        requestHash: legacy.requestHash,
        launchIntentHash: legacy.launchIntentHash,
      });
    }
    expect(walletProjectRequestBindingV1({
      ...legacy,
      output: {
        artifact: {
          route: { routePayload: "0x" },
          projectMetadata: null,
        },
      },
    })).toBeNull();
    expect(walletProjectRequestBindingV1({
      ...launch,
      output: {
        artifact: {
          unboundGraphBundleHash: `sha256:${"77".repeat(32)}`,
          projectMetadata: JSON.parse(JSON.stringify(PROJECT_METADATA)),
        },
      },
    })).toBeNull();
    expect(walletProjectRequestBindingV1({
      ...launch,
      projectMetadata: null,
      projectMetadataHash: null,
    })).toBeNull();

    expect(historySource).toContain("Included in this launch");
    expect(historySource).toContain('referrerPolicy="no-referrer"');
    expect(historySource).toContain('credentials: "omit"');
    expect(historySource).toContain('redirect: "error"');
    expect(historySource).toContain("fileSha256V2(bytes)");
    expect(historySource).toContain("URL.createObjectURL(blob)");
    expect(historySource).toContain("The bound GIF bytes and dimensions are verified");
    expect(historySource).not.toContain("src={presentation.image.uri}");
    expect(projectImageFetchUrlV1("https://assets.example.com/hook.png"))
      .toBe("https://assets.example.com/hook.png");
    expect(projectImageFetchUrlV1(
      "ipfs://QmYwAPJzv5CZsnAzt8auVZRnGiRA7MCLGTMonGSQH9sV5v",
    )).toBe(
      "https://ipfs.io/ipfs/QmYwAPJzv5CZsnAzt8auVZRnGiRA7MCLGTMonGSQH9sV5v",
    );
    expect(projectImageFetchUrlV1(
      "ar://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    )).toBe(
      "https://arweave.net/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(historySource).toContain("Bound project metadata unavailable");
    expect(historySource).toContain("Legacy launch identity");
    expect(historySource).toContain(
      "Declared identity is bound now. Onchain ERC-20 name and symbol",
    );
    expect(historySource).toContain(
      "Changing any\n          bound field requires a newly packed request.",
    );
    expect(historySource).not.toContain("Edit project metadata");
    expect(historyStyles).toContain(".projectReview");
    expect(historyStyles).toContain(".metadataUnavailable");
    expect(historyStyles).toMatch(
      /\.projectIdentity strong\s*\{[^}]*white-space:\s*nowrap;/su,
    );
    expect(historySource).toContain("launchErrors[key]");
    expect(historyStyles).toMatch(
      /\.projectLinks a\s*\{[^}]*min-height:\s*44px;/su,
    );
    expect(historyStyles).toContain("@media (max-width: 600px)");
  });

  it("renders project artwork only after exact response bytes verify", async () => {
    const bytes = Uint8Array.from([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00,
    ]);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(bytes, {
        status: 200,
        headers: {
          "content-length": String(bytes.byteLength),
          "content-type": "image/gif",
        },
      }),
    );
    try {
      const verified = await fetchVerifiedProjectImageV1({
        uri: "https://assets.example.com/hook.gif",
        contentSha256: fileSha256V2(bytes),
        mediaType: "image/gif",
        byteLength: bytes.byteLength,
        width: 1,
        height: 1,
      }, new AbortController().signal);
      expect(verified.mediaType).toBe("image/gif");
      expect(verified.blob.size).toBe(bytes.byteLength);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://assets.example.com/hook.gif",
        expect.objectContaining({
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer",
        }),
      );
      await expect(fetchVerifiedProjectImageV1({
        uri: "https://assets.example.com/hook.gif",
        contentSha256: `sha256:${"00".repeat(32)}`,
        mediaType: "image/gif",
        byteLength: bytes.byteLength,
        width: 1,
        height: 1,
      }, new AbortController().signal)).rejects.toThrow(
        "Project image bytes changed",
      );
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("accepts only an exact same-origin launch handoff", () => {
    const launchId = "60000000-0000-4000-8000-000000000006";
    const valid = {
      walletHandoffUrl: `/developers/api-keys?launchId=${launchId}`,
      expiresAt: "2026-08-25T10:10:00.000Z",
      secondsRemaining: 600,
    };
    expect(parseCustomLaunchWalletHandoffV1(valid, launchId)).toEqual(valid);
    expect(parseCustomLaunchWalletHandoffV1({
      ...valid,
      walletHandoffUrl: `https://evil.example/developers/api-keys?launchId=${launchId}`,
    }, launchId)).toBeNull();
    expect(parseCustomLaunchWalletHandoffV1({
      ...valid,
      walletHandoffUrl: `/developers/api-keys?launchId=${launchId}&next=https://evil.example`,
    }, launchId)).toBeNull();
    expect(parseCustomLaunchWalletHandoffV1({
      ...valid,
      secondsRemaining: -1,
    }, launchId)).toBeNull();
    expect(historySource).toContain("Wallet handoff expired");
    expect(historySource).toContain("An expired handoff never opens a stale");
    expect(historySource).toContain("|| handoffExpired");
  });

  it("renders six independent proof states without promoting finality", () => {
    const sourceVerification = parseSourceVerificationStatusV1({
      schemaVersion: "programmable.source-verification-status.v1",
      status: "queued",
      components: [{
        targetId: "token",
        address: "0x1111111111111111111111111111111111111111",
        status: "queued",
        provider: null,
      }],
      updatedAt: "2026-08-25T10:10:00.000Z",
    });
    expect(sourceVerification).not.toBeNull();
    const rows = customLaunchTruthRowsV1({
      status: "finalized",
      sourceVerification,
      liquidityIntent: {
        model: "external-concentrated-liquidity",
        declaredLaunchState: "liquidity_required",
        binding: "explicit-request-hash",
      },
    });
    expect(rows.map((row) => row.id)).toEqual([
      "finality",
      "source",
      "liquidity",
      "lp-custody",
      "trading",
      "authority",
    ]);
    expect(rows[0]?.value).toBe("Finalized · 64+ confirmations");
    expect(rows[1]?.value).toBe("Queued after finality");
    expect(rows[2]?.value).toBe("Liquidity still required");
    expect(rows[3]?.value).toBe("Not verified by this record");
    expect(rows[4]?.value).toBe("Not established by finality");
    expect(historySource).toContain("What this record proves");
  });

  it("copies typed remediation without copying credentials", () => {
    const remediation = parseCustomLaunchRemediationV1({
      schemaVersion: "programmable.custom-launch-remediation.v1",
      remediationId: "PLATFORM_ADMISSION_FINDING",
      code: "SOURCE_MUTABLE_TRANSFER_RESTRICTION",
      stage: "admission",
      targetId: "token",
      targetRole: "token",
      sourcePath: "src/Token.sol",
      expected: "No mutable transfer restriction",
      observed: "Owner can change transfer state",
      requiredChange: "Remove the mutable restriction and rebuild the bundle.",
      catalogUrl: "https://programmable.market/policies/custom-launch-agent-remediation-v1.json",
      guideUrl: "https://programmable.market/docs/developers/custom-launch#existing-project-integration",
      retryable: false,
      requiresNewRequest: true,
      resumeAt: "pack",
    });
    expect(remediation).not.toBeNull();
    const copied = buildCustomLaunchAgentFixV1({
      requestId: "60000000-0000-4000-8000-000000000006",
      routeId: "custom-launch:create:v3",
      remediations: [remediation!],
    });
    expect(copied).toContain("Required change: Remove the mutable restriction");
    expect(copied).toContain("do not sign or retry this immutable request");
    expect(copied).not.toContain("pm_live_");
    expect(copied).not.toContain("0xprivate");
  });

  it("opens an exact launch deep link and focuses its current record", () => {
    expect(apiKeysSource).toContain('searchParams.get("launchId")');
    expect(apiKeysSource).toContain('searchParams.get("chainId")');
    expect(apiKeysSource).toContain(
      'setInitialLaunchChainId(chainId === "4663" ? "4663" : null)',
    );
    expect(apiKeysSource).toContain(
      "initialLaunchChainId={initialLaunchChainId}",
    );
    expect(apiKeysSource).toContain('setActiveSection("history")');
    expect(historySource).toContain(
      'const version = initialLaunchChainId === "4663" ? "v4" : "v3"',
    );
    expect(historySource).toContain(
      "readLaunchById(initialLaunchId, version, controller.signal)",
    );
    expect(historySource).toContain("Loading the exact wallet handoff.");
    expect(historySource).toContain(
      "focusLaunchCard(launchResourceIdentity(launch))",
    );
    expect(historySource).toContain("tabIndex={-1}");
  });

  it("keeps distinct V4 request and launch IDs on one launch-addressed card", () => {
    const account = "0x0000000000000000000000000000000000000001";
    const launchId = "90000000-0000-4000-8000-000000000009";
    const requestId = "a0000000-0000-4000-8000-00000000000a";
    const summary = {
      schemaVersion: "programmable.custom-launch-summary.v4",
      apiVersion: "v4",
      launchId,
      requestId: launchId,
      routeId: "custom-launch:create:v4",
      chainId: "4663",
      caip2: "eip155:4663",
      chainDeploymentId: "robinhood-mainnet-custom-launch-v1",
      chainDeploymentDescriptorDigest: `0x${"aa".repeat(32)}`,
      controller: { namespace: "eip155:4663", address: account },
      status: "wallet_action_required",
      walletHandoffUrl: null,
      expiresAt: null,
      createdAt: "2026-09-02T22:00:00.000Z",
      updatedAt: "2026-09-02T22:00:01.000Z",
    };
    const resource = {
      schemaVersion: "programmable.custom-launch.v4",
      apiVersion: "v4",
      launchId,
      requestId,
      routeId: "custom-launch:create:v4",
      chainId: "4663",
      caip2: "eip155:4663",
      controller: { namespace: "eip155:4663", address: account },
      status: "wallet_action_required",
      requestHash: `sha256:${"11".repeat(32)}`,
      profile: { profileDigest: `sha256:${"22".repeat(32)}` },
      commitments: { launchIntent: `sha256:${"33".repeat(32)}` },
      metadataCommitment: `sha256:${"44".repeat(32)}`,
      projectMetadata: PROJECT_METADATA,
      walletTransaction: {},
      preparedArtifact: {},
      sourceVerification: null,
      onchain: null,
      failure: null,
      createdAt: "2026-09-02T22:00:00.000Z",
      updatedAt: "2026-09-02T22:00:02.000Z",
    };
    const summaryPage = parseHistoryPage({
      schemaVersion: "programmable.custom-launch-history.v1",
      launches: [summary],
      nextCursor: null,
    }, account);
    const resourcePage = parseHistoryPage({
      schemaVersion: "programmable.custom-launch-history.v1",
      launches: [resource],
      nextCursor: null,
    }, account);

    expect(summaryPage).not.toBeNull();
    expect(resourcePage).not.toBeNull();
    expect(resourcePage!.launches[0]).toMatchObject({ launchId, requestId });
    expect(launchResourceIdentity(resourcePage!.launches[0]!)).toBe(launchId);
    expect(launchResourceIdentity(launch("legacy-request", "authorized",
      "2026-09-02T22:00:00.000Z"))).toBe("legacy-request");
    const merged = mergeLaunchResources(
      summaryPage!.launches,
      resourcePage!.launches,
      false,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ launchId, requestId });
    expect(merged[0]?.rawResourceV4).not.toBeNull();

    const readStart = historySource.indexOf(
      "const readLaunchResource = useCallback",
    );
    const readEnd = historySource.indexOf(
      "const readV4Capabilities = useCallback",
      readStart,
    );
    const readBoundary = historySource.slice(readStart, readEnd);
    expect(readBoundary).toContain(
      "const resourceIdentity = launchResourceIdentity(launch)",
    );
    expect(readBoundary).toContain("encodeURIComponent(resourceIdentity)");
    expect(readBoundary).toContain(
      "launchResourceIdentity(updated) !== resourceIdentity",
    );
  });

  it("keeps the V4 handoff owner-controlled and sends only its hash as a discovery hint", () => {
    expect(walletHandoffV4Source).toContain(
      'typeof accounts[0] !== "string"',
    );
    expect(walletHandoffV4Source).toContain("!isAddress(accounts[0])");
    expect(walletHandoffV4Source).toContain(
      "getAddress(accounts[0]) !== expectedAccount",
    );
    expect(walletHandoffV4Source).not.toContain(
      "canonicalAddress(accounts[0]) !== expectedAccount",
    );

    const walletStart = walletProviderSource.indexOf(
      "const sendCustomLaunchWalletActionV4 = useCallback",
    );
    const walletEnd = walletProviderSource.indexOf(
      "const signCustomLaunchFundingAuthorization = useCallback",
      walletStart,
    );
    const walletBoundary = walletProviderSource.slice(walletStart, walletEnd);
    expect(walletStart).toBeGreaterThan(-1);
    expect(walletEnd).toBeGreaterThan(walletStart);
    expect(walletBoundary).toContain(
      "deriveCustomLaunchWalletExpectedV4(input.reviewedResource)",
    );
    expect(walletBoundary).toContain("prepareCustomLaunchWalletReviewV4({");
    expect(walletBoundary).toContain("revalidateCustomLaunchWalletRequestV4({");
    expect(walletBoundary).toContain('method: "eth_sendTransaction"');
    expect(walletBoundary.indexOf('method: "eth_sendTransaction"')).toBeGreaterThan(
      walletBoundary.indexOf("revalidateCustomLaunchWalletRequestV4({"),
    );
    expect(walletBoundary).toContain("from: transaction.from");
    expect(walletBoundary).toContain("to: transaction.to");
    expect(walletBoundary).toContain("data: transaction.data");
    expect(walletBoundary).toContain("value: transaction.value");
    expect(walletBoundary).not.toContain("eth_signTransaction");
    expect(walletBoundary).not.toContain("eth_sendRawTransaction");
    expect(walletBoundary).not.toContain("wallet_sendCalls");
    expect(walletBoundary).not.toContain("signedTransaction");

    const submitStart = historySource.indexOf(
      "const submitV4SubmissionHint = useCallback",
    );
    const submitEnd = historySource.indexOf(
      "const updateLaunch = useCallback",
      submitStart,
    );
    const hintBoundary = historySource.slice(submitStart, submitEnd);
    expect(submitStart).toBeGreaterThan(-1);
    expect(submitEnd).toBeGreaterThan(submitStart);
    expect(hintBoundary).toContain(
      'schemaVersion: "programmable.custom-launch-submission-hint.v1"',
    );
    expect(hintBoundary).toContain("transactionHash,");
    expect(hintBoundary).not.toContain("apiKey");
    expect(hintBoundary).not.toContain("rawTransaction");
    expect(hintBoundary).not.toContain("signedTransaction");
    expect(hintBoundary).not.toContain("evidence:");
    expect(hintBoundary).toContain("body.authoritative !== false");
    expect(hintBoundary).toContain("encodeURIComponent(launch.launchId)");
    expect(hintBoundary).toContain("body.launchId !== launch.launchId");
    expect(hintBoundary).toContain(
      "custom-launches/${launch.launchId}",
    );
    expect(hintBoundary).not.toContain("launch.requestId");

    const sendStart = historySource.indexOf(
      "const submitWalletTransaction = async",
    );
    const sendEnd = historySource.indexOf("return (", sendStart);
    const sendBoundary = historySource.slice(sendStart, sendEnd);
    expect(sendBoundary).toContain(
      'launch.routeId === "custom-launch:create:v4"',
    );
    expect(sendBoundary).toContain("sendCustomLaunchWalletActionV4({");
    expect(sendBoundary).toContain("loadFreshCapabilities: readV4Capabilities");
    expect(sendBoundary).toContain(
      "await submitV4SubmissionHint(launch, transactionHash)",
    );
    expect(sendBoundary.indexOf("await submitV4SubmissionHint(launch, transactionHash)"))
      .toBeGreaterThan(sendBoundary.indexOf("sendCustomLaunchWalletActionV4({"));
  });

  it("never lets a stale list regress a single-resource launch status", () => {
    const submitted = launch(
      "request-a",
      "submitted",
      "2026-08-25T10:03:00.000Z",
    );
    const staleAuthorized = launch(
      "request-a",
      "authorized",
      "2026-08-25T10:04:00.000Z",
    );
    const finalized = launch(
      "request-b",
      "finalized",
      "2026-08-25T10:05:00.000Z",
    );
    const olderSubmitted = launch(
      "request-b",
      "submitted",
      "2026-08-25T10:04:00.000Z",
    );

    expect(selectMonotonicLaunchResource(
      submitted,
      staleAuthorized,
    )).toBe(submitted);
    expect(selectMonotonicLaunchResource(
      staleAuthorized,
      submitted,
    )).toBe(submitted);
    expect(selectMonotonicLaunchResource(
      finalized,
      olderSubmitted,
    )).toBe(finalized);

    const merged = mergeLaunchResources(
      [submitted, finalized],
      [staleAuthorized],
      true,
    );
    expect(merged).toEqual([submitted, finalized]);
  });

  it("advances V2 through simulation without colliding with a V1 UUID", () => {
    const v1 = launch(
      "shared-request",
      "prepared",
      "2026-08-25T10:01:00.000Z",
    );
    const simulating = {
      ...v1,
      schemaVersion: "programmable.custom-launch.v2" as const,
      routeId: "custom-launch:create:v2" as const,
      status: "simulating" as const,
      launchProfileHash: `sha256:${"11".repeat(32)}` as const,
      launchIntentHash: `sha256:${"22".repeat(32)}` as const,
    };
    const authorized = {
      ...simulating,
      status: "authorized" as const,
      updatedAt: "2026-08-25T10:02:00.000Z",
    };

    expect(selectMonotonicLaunchResource(simulating, authorized))
      .toBe(authorized);
    expect(mergeLaunchResources([v1], [simulating], false))
      .toEqual([v1, simulating]);
  });

  it("rechecks the Custom launch action at the final wallet boundary", () => {
    const start = walletProviderSource.indexOf(
      "const sendCustomLaunchWalletAction = useCallback",
    );
    const end = walletProviderSource.indexOf(
      "const readTradeBalances = useCallback",
      start,
    );
    const boundary = walletProviderSource.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(boundary.indexOf("assertCustomLaunchWalletActionV1(")).toBeGreaterThan(-1);
    expect(boundary.indexOf("sendBrowserWalletAction(checked)")).toBeGreaterThan(
      boundary.indexOf("assertCustomLaunchWalletActionV1("),
    );
  });
});
