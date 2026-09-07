import { AGENT_KEY_SCHEMA, AGENT_SCOPES } from "../lib/agent-connection";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createDeveloperApiKeyBridgeV1,
  CUSTOM_LAUNCH_API_SCHEMA_V1,
  CUSTOM_LAUNCH_API_SCHEMA_V2,
  API_KEY_CAPABILITIES_SCHEMA_V2,
} from "../lib/server/custom-launch/api-key-bridge-v1";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const SOURCE_ID = "018f3e2a-7b4c-7d5e-8f90-123456789abc";
const REPLACEMENT_ID = "028f3e2a-7b4c-7d5e-8f90-123456789abc";
const PREFIX = `pm_live_${"A".repeat(22)}`;
const SECRET = `${PREFIX}_${"B".repeat(43)}`;
const IDEMPOTENCY_OPERATION_ID = "api-key-v2-attempt-20260906";
const READ = ["custom-launch:read"];
const BOTH = ["custom-launch:create", "custom-launch:read"];

function summary(scopes: readonly string[] = READ) {
  return {
    id: REPLACEMENT_ID, label: "History reader", keyPrefix: PREFIX, scopes,
    createdAt: "2026-09-06T00:00:00.000Z", expiresAt: "2026-12-05T00:00:00.000Z",
    lastUsedAt: null, revokedAt: null,
  };
}

function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json", ...headers },
  });
}

function body(scopes: unknown = READ) {
  return {
    schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V2,
    walletAddress: WALLET, label: "History reader", scopes,
  };
}

function rotationBody() {
  return {
    schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V2,
    walletAddress: WALLET, label: "History reader",
  };
}

function post(value: unknown, key: string = IDEMPOTENCY_OPERATION_ID) {
  return new Request("https://programmable.market/api/developer/api-keys/v2", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: typeof value === "string" ? value : JSON.stringify(value),
  });
}

function mutation(scopes: readonly string[] = READ, extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V2,
    apiKey: summary(scopes), secretState: "delivered-once", apiKeySecret: SECRET, ...extra,
  };
}

describe("versioned API key bridge", () => {
  const authenticate = vi.fn();
  const fetchBackend = vi.fn();
  const bridge = () => createDeveloperApiKeyBridgeV1({
    authenticator: { authenticate }, fetchBackend,
    backendBaseUrl: "https://custom-launch-api.example/",
    websiteToken: "w".repeat(43), bffAssertionKeyV2: "b".repeat(43),
    assertionNow: () => new Date("2026-09-06T00:00:00.000Z"),
    assertionNonce: () => "AAAAAAAAAAAAAAAAAAAAAA",
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    authenticate.mockResolvedValue({
      privyUserId: "did:privy:local-fixture", privySessionId: "fixture", wallets: [WALLET],
    });
  });

  it("issues a combined key through the new closed, signed contract", async () => {
    fetchBackend.mockResolvedValueOnce(json({ ...mutation(AGENT_SCOPES), schemaVersion: AGENT_KEY_SCHEMA }, 201));
    const response = await bridge().createAgent(post({ schemaVersion: AGENT_KEY_SCHEMA, walletAddress: WALLET, label: "My agent" }));
    expect(response.status).toBe(201);
    expect((await response.json()).apiKey.scopes).toEqual(AGENT_SCOPES);
    const [url, init] = fetchBackend.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/v1/wallet-admin/agent-keys");
    expect(JSON.parse(String(init.body))).toEqual({ schemaVersion: AGENT_KEY_SCHEMA, label: "My agent", expiresInDays: 90 });
    expect(new Headers(init.headers).get("idempotency-key")).toBe(IDEMPOTENCY_OPERATION_ID);
    expect(new Headers(init.headers).get("x-programmable-bff-assertion-version")).toBe("2");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each([{ scopes: AGENT_SCOPES }, { purpose: "all" }, { schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1 }, { walletAddress: "0x2222222222222222222222222222222222222222" }])("rejects injected agent rights, schema or unlinked wallets: %j", async (extra) => {
    const response = await bridge().createAgent(post({ schemaVersion: AGENT_KEY_SCHEMA, walletAddress: WALLET, label: "My agent", ...extra }));
    expect([400, 403]).toContain(response.status);
    expect(fetchBackend).not.toHaveBeenCalled();
  });

  it.each([READ, BOTH, [...AGENT_SCOPES, "admin:write"], [...AGENT_SCOPES, "modules:read"]])("does not reveal a combined secret with mismatched scopes: %j", async (...scopes) => {
    fetchBackend.mockResolvedValueOnce(json({ ...mutation(scopes), schemaVersion: AGENT_KEY_SCHEMA }, 201));
    const response = await bridge().createAgent(post({ schemaVersion: AGENT_KEY_SCHEMA, walletAddress: WALLET, label: "My agent" }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(SECRET);
  });

  it("preserves combined rotation and completed retries without secret recovery", async () => {
    fetchBackend.mockResolvedValueOnce(json({ schemaVersion: AGENT_KEY_SCHEMA, apiKey: summary(AGENT_SCOPES), secretState: "already-delivered", rotatedCredentialId: SOURCE_ID }));
    const response = await bridge().rotateAgent(post({ schemaVersion: AGENT_KEY_SCHEMA, walletAddress: WALLET, label: "My agent" }), SOURCE_ID);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).not.toHaveProperty("apiKeySecret");
    expect(result.apiKey.scopes).toEqual(AGENT_SCOPES);
    expect(String(fetchBackend.mock.calls[0][0])).toContain(`/agent-keys/${SOURCE_ID}/rotate`);
  });

  const v2List = (extra: Record<string, unknown> = {}) => ({
    schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V2,
    apiKeys: [{ ...summary(), controllerWallet: WALLET,
      chainRestriction: { allowedChainIds: ["1", "4663"], mode: "persisted", effectiveEligibility: "evaluated-per-request" }, ...extra }],
  });
  const listRequest = () => new Request(`https://programmable.market/api/developer/api-keys/v2?walletAddress=${WALLET}`);

  it.each([null, ["4663", "1"], ["9".repeat(78)]].map(ids => ({ ids })))("preserves raw chain restriction order/null without claiming effective grants: $ids", async ({ ids }) => {
    const value = v2List({ chainRestriction: { allowedChainIds: ids, mode: ids === null ? "legacy-policy-dependent" : "persisted", effectiveEligibility: "evaluated-per-request" } });
    fetchBackend.mockResolvedValueOnce(json(value));
    const response = await bridge().listV2(listRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(value);
    const [url, init] = fetchBackend.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/v2/wallet-admin/api-keys");
    expect(init.method).toBe("GET");
    expect(new Headers(init.headers).get("x-programmable-wallet-address")).toBe(WALLET);
    expect(new Headers(init.headers).get("x-programmable-bff-assertion-version")).toBe("2");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    {}, { allowedChainIds: null, mode: "persisted", effectiveEligibility: "evaluated-per-request" },
    ...[[], ["0"], ["01"], ["1", "1"], [1], ["1.0"], ["9".repeat(79)], Array.from({length:65},(_,i)=>String(i+1))].map(allowedChainIds => ({ allowedChainIds, mode: "persisted", effectiveEligibility: "evaluated-per-request" })),
    { allowedChainIds: ["1"], mode: "legacy-policy-dependent", effectiveEligibility: "evaluated-per-request" },
    { allowedChainIds: ["1"], mode: "persisted", effectiveEligibility: "allowed" },
  ])("rejects malformed or overclaiming V2 chain metadata: %j", async (chainRestriction) => {
    fetchBackend.mockResolvedValueOnce(json(v2List({ chainRestriction })));
    expect((await bridge().listV2(listRequest())).status).toBe(503);
  });

  it("rejects another controller, duplicate keys and unlinked V2 list requests", async () => {
    for (const value of [v2List({ controllerWallet: "0x2222222222222222222222222222222222222222" }),
      { ...v2List(), apiKeys: [...v2List().apiKeys, ...v2List().apiKeys] },
      { ...v2List(), schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1 }]) {
      fetchBackend.mockResolvedValueOnce(json(value));
      expect((await bridge().listV2(listRequest())).status).toBe(503);
    }
    authenticate.mockResolvedValueOnce({ privyUserId: "fixture", privySessionId: "fixture", wallets: [] });
    expect((await bridge().listV2(listRequest())).status).toBe(403);
    expect(fetchBackend).toHaveBeenCalledTimes(3);
  });

  it("projects optional module flags and strips key secrets/internal chain fields", async () => {
    const value = v2List({ scopes: ["custom-launch:read", "future:read"], apiKeySecret: "must-not-cross" });
    fetchBackend.mockResolvedValueOnce(json({ ...value, moduleContributions: { apiKeyIssuance: true, submissions: true, secret: "omit" } }));
    const response = await bridge().listV2(listRequest());
    const output = await response.json();
    expect(output.moduleContributions).toEqual({ apiKeyIssuance: true, submissions: true });
    expect(output.apiKeys[0].scopes).toEqual(["custom-launch:read", "future:read"]);
    expect(JSON.stringify(output)).not.toContain("must-not-cross");
  });

  it.each([true, false])("authenticates and projects exact capability flags (%s)", async (ready) => {
    fetchBackend.mockResolvedValueOnce(json({
      schemaVersion: API_KEY_CAPABILITIES_SCHEMA_V2,
      restrictedIssuance: ready, preservingRotation: ready, preservingModuleRotation: !ready, unifiedKeys: false, internalDetails: "omit",
    }));
    const response = await bridge().capabilitiesV2(new Request(
      `https://programmable.market/api/developer/api-keys/v2/capabilities?walletAddress=${WALLET}`,
    ));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      schemaVersion: API_KEY_CAPABILITIES_SCHEMA_V2,
      restrictedIssuance: ready, preservingRotation: ready, preservingModuleRotation: !ready, unifiedKeys: false,
    });
    const [url, init] = fetchBackend.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/v2/wallet-admin/api-keys/capabilities");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    const headers = new Headers(init.headers);
    expect(headers.get("x-programmable-privy-user-id")).toBe("did:privy:local-fixture");
    expect(headers.get("x-programmable-wallet-address")).toBe(WALLET);
    expect(headers.get("x-programmable-bff-assertion-version")).toBe("2");
  });

  it("maps old two-flag capabilities to unavailable Module rotation without changing Custom flags", async () => {
    fetchBackend.mockResolvedValueOnce(json({ schemaVersion: API_KEY_CAPABILITIES_SCHEMA_V2,
      restrictedIssuance: true, preservingRotation: true }));
    const response = await bridge().capabilitiesV2(new Request(
      `https://programmable.market/api/developer/api-keys/v2/capabilities?walletAddress=${WALLET}`,
    ));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ schemaVersion: API_KEY_CAPABILITIES_SCHEMA_V2,
      restrictedIssuance: true, preservingRotation: true, preservingModuleRotation: false, unifiedKeys: false });
  });

  it.each([
    {},
    { schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1, restrictedIssuance: true, preservingRotation: true },
    { schemaVersion: API_KEY_CAPABILITIES_SCHEMA_V2, restrictedIssuance: "true", preservingRotation: true },
    { schemaVersion: API_KEY_CAPABILITIES_SCHEMA_V2, restrictedIssuance: true },
    ...[null, "true", 1, {}, []].map(preservingModuleRotation => ({
      schemaVersion: API_KEY_CAPABILITIES_SCHEMA_V2, restrictedIssuance: true, preservingRotation: true, preservingModuleRotation,
    })),
  ])("rejects malformed capability metadata: %j", async (value) => {
    fetchBackend.mockResolvedValueOnce(json(value));
    const response = await bridge().capabilitiesV2(new Request(
      `https://programmable.market/api/developer/api-keys/v2/capabilities?walletAddress=${WALLET}`,
    ));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("api_key_service_unavailable");
  });

  it.each([READ, BOTH].map(scopes => ({ scopes })))("issues exactly requested V2 scopes $scopes with signed bytes", async ({ scopes }) => {
    fetchBackend.mockResolvedValueOnce(json(mutation(scopes), 201));
    const response = await bridge().createV2(post(body(scopes)));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(mutation(scopes));
    const [url, init] = fetchBackend.mock.calls[0] as [URL, RequestInit];
    const expectedBody = JSON.stringify({
      schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V2,
      label: "History reader", expiresInDays: 90, scopes,
    });
    expect(url.pathname).toBe("/v2/wallet-admin/api-keys");
    expect(String(init.body)).toBe(expectedBody);
    const headers = new Headers(init.headers);
    expect(headers.get("idempotency-key")).toBe(IDEMPOTENCY_OPERATION_ID);
    expect(headers.get("x-programmable-bff-assertion-body-sha256")).toBe(
      `sha256:${createHash("sha256").update(expectedBody).digest("hex")}`,
    );
    expect(String(init.body)).not.toContain(WALLET);
    expect(fetchBackend).toHaveBeenCalledTimes(1);
  });

  it.each([
    [], ["custom-launch:create"], ["fees:read"], ["custom-launch:read", "fees:read"],
    ["custom-launch:read", "custom-launch:read"], ["custom-launch:*"], null,
  ].map(scopes => ({ scopes })))("rejects unsupported issuance scopes before authenticating: $scopes", async ({ scopes }) => {
    const response = await bridge().createV2(post(body(scopes)));
    expect(response.status).toBe(400);
    expect(authenticate).not.toHaveBeenCalled();
    expect(fetchBackend).not.toHaveBeenCalled();
  });

  it("requires explicit scopes and exact V2 fields without accepting V1 payloads", async () => {
    for (const value of [rotationBody(), { ...body(), schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1 },
      { ...body(), allowedChainIds: ["4663"] }]) {
      expect((await bridge().createV2(post(value))).status).toBe(400);
    }
    expect((await bridge().createV2(post(
      `{"schemaVersion":"${CUSTOM_LAUNCH_API_SCHEMA_V2}","walletAddress":"${WALLET}","label":"History reader","scopes":["custom-launch:read"],"scopes":["custom-launch:create","custom-launch:read"]}`,
    ))).status).toBe(400);
    expect((await bridge().createV2(post(body(), "short"))).status).toBe(400);
    expect(fetchBackend).not.toHaveBeenCalled();
  });

  it.each(["capabilities", "issue", "rotate"])("rejects unlinked-wallet %s calls", async (operation) => {
    authenticate.mockResolvedValueOnce({ privyUserId: "fixture", privySessionId: "fixture", wallets: [] });
    const response = operation === "capabilities"
      ? await bridge().capabilitiesV2(new Request(`https://programmable.market/api/developer/api-keys/v2/capabilities?walletAddress=${WALLET}`))
      : operation === "issue" ? await bridge().createV2(post(body()))
        : await bridge().rotateV2(post(rotationBody()), SOURCE_ID);
    expect(response.status).toBe(403);
    expect(fetchBackend).not.toHaveBeenCalled();
  });

  it("returns V2 exact issue replay without re-delivering a secret", async () => {
    const value = { schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V2, apiKey: summary(), secretState: "already-delivered" };
    fetchBackend.mockResolvedValueOnce(json(value));
    const response = await bridge().createV2(post(body()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(value);
  });

  it.each([
    mutation(BOTH),
    mutation(READ, { schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1 }),
    mutation(READ, { secretState: "already-delivered" }),
  ])("does not expose unverified issue results: %j", async (value) => {
    fetchBackend.mockResolvedValueOnce(json(value, 201));
    const response = await bridge().createV2(post(body()));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(SECRET);
  });

  it("rotates via V2 with source-authoritative scopes and no browser scope field", async () => {
    const value = mutation(READ, { rotatedCredentialId: SOURCE_ID });
    fetchBackend.mockResolvedValueOnce(json(value, 201));
    const response = await bridge().rotateV2(post(rotationBody()), SOURCE_ID);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(value);
    const [url, init] = fetchBackend.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe(`/v2/wallet-admin/api-keys/${SOURCE_ID}/rotate`);
    expect(JSON.parse(String(init.body))).toEqual({
      schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V2, label: "History reader", expiresInDays: 90,
    });
    expect(new Headers(init.headers).get("idempotency-key")).toBe(IDEMPOTENCY_OPERATION_ID);
    expect(fetchBackend).toHaveBeenCalledTimes(1);
  });

  it("rejects browser-selected rotation scopes and a replacement reusing the source ID", async () => {
    expect((await bridge().rotateV2(post(body()), SOURCE_ID)).status).toBe(400);
    expect(fetchBackend).not.toHaveBeenCalled();
    fetchBackend.mockResolvedValueOnce(json(mutation(READ, {
      rotatedCredentialId: SOURCE_ID, apiKey: { ...summary(), id: SOURCE_ID },
    }), 201));
    expect((await bridge().rotateV2(post(rotationBody()), SOURCE_ID)).status).toBe(503);
  });

  it.each([
    [503, "API_KEY_CAPABILITY_UNAVAILABLE"],
    [409, "API_KEY_ROTATION_RESTRICTION"],
  ] as const)("preserves %i %s without mutation fallback", async (status, code) => {
    fetchBackend.mockResolvedValueOnce(json({
      schemaVersion: "programmable.api-error.v1",
      error: { code, message: "The request could not be completed.", requestId: SOURCE_ID, internalDetails: "omit" },
    }, status, status === 503 ? { "retry-after": "17" } : {}));
    const response = await bridge().rotateV2(post(rotationBody()), SOURCE_ID);
    expect(response.status).toBe(status);
    expect((await response.json()).error).toEqual({
      code, message: "The request could not be completed.", requestId: SOURCE_ID,
    });
    expect(response.headers.get("retry-after")).toBe(status === 503 ? "17" : null);
    expect(fetchBackend).toHaveBeenCalledTimes(1);
    expect((fetchBackend.mock.calls[0][0] as URL).pathname).toContain("/v2/");
  });
});
