import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createDeveloperApiKeyBridgeV1,
  CUSTOM_LAUNCH_API_SCHEMA_V1,
} from "../lib/server/custom-launch/api-key-bridge-v1";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const OTHER_WALLET = "0x2222222222222222222222222222222222222222" as const;
const CREDENTIAL_ID = "018f3e2a-7b4c-7d5e-8f90-123456789abc";
const KEY_ID = "A".repeat(22);
const API_KEY_SECRET = ["pm", "live", KEY_ID, "B".repeat(43)].join("_");
const WEBSITE_TOKEN = "w".repeat(43);
const BFF_ASSERTION_KEY = "b".repeat(43);
const ASSERTION_ISSUED_AT = "2026-08-27T08:00:00.000Z";
const ASSERTION_NONCE = "AAAAAAAAAAAAAAAAAAAAAA";
const IDEMPOTENCY_ID = "018f3e2a-7b4c-7d5e-8f90-123456789abc";
const MODULE_SCOPES = ["modules:submit", "modules:read"];
const MODULE_AVAILABLE = { apiKeyIssuance: true, submissions: true };
const REQUEST_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

async function correlatedError(response: Response) {
  const requestId = response.headers.get("x-request-id");
  expect(requestId).toMatch(REQUEST_ID);
  const body = await response.json();
  expect(body.error.requestId).toBe(requestId);
  return { body, requestId };
}

function summary(extra: Readonly<Record<string, unknown>> = {}) {
  return {
    id: CREDENTIAL_ID,
    label: "Launch agent",
    keyPrefix: `pm_live_${KEY_ID}`,
    scopes: ["custom-launch:create", "custom-launch:read"],
    createdAt: "2026-08-24T12:00:00.000Z",
    expiresAt: "2026-11-22T12:00:00.000Z",
    lastUsedAt: null,
    revokedAt: null,
    ...extra,
  };
}

function backendJson(body: Readonly<Record<string, unknown>>, status = 200) {
  return new Response(JSON.stringify({
    schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
    ...body,
  }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createRequest(extra: Readonly<Record<string, unknown>> = {}) {
  return new Request("https://programmable.market/api/developer/api-keys", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": IDEMPOTENCY_ID,
      authorization: "Bearer browser-privy-token",
    },
    body: JSON.stringify({
      schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
      walletAddress: WALLET,
      label: "Contribution agent",
      ...extra,
    }),
  });
}

describe("developer API key same-origin bridge", () => {
  const authenticate = vi.fn();
  const fetchBackend = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    authenticate.mockResolvedValue({
      privyUserId: "did:privy:test-user",
      privySessionId: "session-1",
      wallets: [WALLET],
    });
  });

  function bridge() {
    return createDeveloperApiKeyBridgeV1({
      authenticator: { authenticate },
      backendBaseUrl: "https://custom-launch-api.example/",
      websiteToken: WEBSITE_TOKEN,
      bffAssertionKeyV2: BFF_ASSERTION_KEY,
      fetchBackend,
      backendTimeoutMs: 1_000,
      assertionNow: () => new Date(ASSERTION_ISSUED_AT),
      assertionNonce: () => ASSERTION_NONCE,
    });
  }

  it("lists only canonical metadata and sends the verified identity server-to-server", async () => {
    fetchBackend.mockResolvedValueOnce(backendJson({
      apiKeys: [summary({ apiKeySecret: "must-not-cross-the-bff" })],
      internalDebug: "must-not-cross-the-bff",
    }));

    const response = await bridge().list(new Request(
      `https://programmable.market/api/developer/api-keys?walletAddress=${WALLET}`,
      {
        headers: {
          accept: "application/json",
          authorization: "Bearer browser-privy-token",
          "x-privy-identity-token": "identity-token",
        },
      },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const body = await response.json();
    expect(body).toEqual({
      schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
      apiKeys: [summary()],
    });
    const [url, init] = fetchBackend.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      "https://custom-launch-api.example/v1/wallet-admin/api-keys",
    );
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${WEBSITE_TOKEN}`);
    expect(headers.get("x-programmable-privy-user-id")).toBe(
      "did:privy:test-user",
    );
    expect(headers.get("x-programmable-wallet-address")).toBe(WALLET);
    expect(headers.get("x-privy-identity-token")).toBeNull();
    expect(headers.get("x-programmable-bff-assertion-version")).toBe("2");
    expect(headers.get("x-programmable-bff-assertion-issued-at")).toBe(
      ASSERTION_ISSUED_AT,
    );
    expect(headers.get("x-programmable-bff-assertion-nonce")).toBe(
      ASSERTION_NONCE,
    );
    expect(headers.get("x-programmable-bff-assertion-body-sha256")).toBe(
      `sha256:${"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}`,
    );
    expect(headers.get("x-programmable-bff-assertion-signature")).toBe(
      "hmac-sha256:169f5d4dddda9a5d0d3dff95b324ff39a04ffa632c447501704f4d4e1db77736",
    );
    expect(init.body).toBeUndefined();
  });

  it("creates an exact two-scope key and exposes its raw value once", async () => {
    fetchBackend.mockResolvedValueOnce(backendJson({
      apiKey: summary(),
      secretState: "delivered-once",
      apiKeySecret: API_KEY_SECRET,
    }, 201));
    const request = new Request(
      "https://programmable.market/api/developer/api-keys",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "idempotency-key": IDEMPOTENCY_ID,
          authorization: "Bearer browser-privy-token",
        },
        body: JSON.stringify({
          schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
          walletAddress: WALLET,
          label: "Launch agent",
        }),
      },
    );

    const response = await bridge().create(request);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
      apiKey: summary(),
      secretState: "delivered-once",
      apiKeySecret: API_KEY_SECRET,
    });
    const [, init] = fetchBackend.mock.calls[0] as [URL, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("idempotency-key")).toBe(IDEMPOTENCY_ID);
    expect(JSON.parse(String(init.body))).toEqual({
      schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
      label: "Launch agent",
      expiresInDays: 90,
    });
    expect(String(init.body)).not.toContain(WALLET);
    expect(String(init.body)).not.toContain("browser-privy-token");
    expect(headers.get("x-programmable-bff-assertion-body-sha256")).toBe(
      "sha256:2262e615379988c79eb8d90f4593d5aa708c6ded57505dfd7d37e6202a252695",
    );
    expect(headers.get("x-programmable-bff-assertion-signature")).toBe(
      "hmac-sha256:c966ed9d880c5e2c19fae08b7c4d0130f37a6c880b236a177160a5fdc4559e06",
    );
  });

  it("lists launch and module keys without granting module availability from their presence", async () => {
    fetchBackend.mockResolvedValueOnce(backendJson({
      apiKeys: [summary(), summary({
        id: "028f3e2a-7b4c-7d5e-8f90-123456789abc",
        scopes: MODULE_SCOPES,
      })],
    }));
    const response = await bridge().list(new Request(
      `https://programmable.market/api/developer/api-keys?walletAddress=${WALLET}`,
    ));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.apiKeys.map((key: { scopes: string[] }) => key.scopes))
      .toEqual([["custom-launch:create", "custom-launch:read"], MODULE_SCOPES]);
    expect(body).not.toHaveProperty("moduleContributions");
  });

  it("projects only explicit module capability booleans", async () => {
    fetchBackend.mockResolvedValueOnce(backendJson({
      apiKeys: [],
      moduleContributions: {
        apiKeyIssuance: true,
        submissions: "true",
        internalSecret: "must-not-cross-the-bff",
      },
    }));
    const response = await bridge().list(new Request(
      `https://programmable.market/api/developer/api-keys?walletAddress=${WALLET}`,
    ));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
      apiKeys: [],
      moduleContributions: { apiKeyIssuance: true, submissions: false },
    });
  });

  it("checks current module availability and sends only the module scope pair", async () => {
    fetchBackend.mockResolvedValueOnce(backendJson({
      apiKeys: [], moduleContributions: MODULE_AVAILABLE,
    })).mockResolvedValueOnce(backendJson({
      apiKey: summary({ scopes: MODULE_SCOPES }),
      secretState: "delivered-once",
      apiKeySecret: API_KEY_SECRET,
    }, 201));
    const response = await bridge().create(createRequest({ purpose: "module-contributions" }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.apiKey.scopes).toEqual(MODULE_SCOPES);
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(fetchBackend).toHaveBeenCalledTimes(2);
    const [capabilityUrl, capabilityInit] = fetchBackend.mock.calls[0] as [URL, RequestInit];
    expect(capabilityUrl.pathname).toBe("/v1/wallet-admin/api-keys");
    expect(capabilityInit.method).toBe("GET");
    expect(capabilityInit.body).toBeUndefined();
    const [, issueInit] = fetchBackend.mock.calls[1] as [URL, RequestInit];
    expect(issueInit.method).toBe("POST");
    expect(JSON.parse(String(issueInit.body))).toEqual({
      schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
      label: "Contribution agent",
      expiresInDays: 90,
      scopes: MODULE_SCOPES,
    });
    expect(new Headers(issueInit.headers).get("idempotency-key")).toBe(IDEMPOTENCY_ID);
    expect(new Headers(issueInit.headers).get("x-programmable-wallet-address")).toBe(WALLET);
  });

  it.each([
    undefined,
    null,
    {},
    { apiKeyIssuance: false, submissions: true },
    { apiKeyIssuance: true, submissions: false },
    { apiKeyIssuance: "true", submissions: true },
  ])("never issues a module key without both live capabilities (%j)", async (moduleContributions) => {
    fetchBackend.mockResolvedValueOnce(backendJson({ apiKeys: [], moduleContributions }));
    const response = await bridge().create(createRequest({ purpose: "module-contributions" }));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("MODULE_SUBMISSIONS_UNAVAILABLE");
    expect(fetchBackend).toHaveBeenCalledTimes(1);
    expect(fetchBackend.mock.calls[0]?.[1].method).toBe("GET");
  });

  it("keeps an explicit launch purpose on the existing backend request contract", async () => {
    fetchBackend.mockResolvedValueOnce(backendJson({
      apiKey: summary(), secretState: "already-delivered",
    }));
    const response = await bridge().create(createRequest({ purpose: "custom-launches" }));
    expect(response.status).toBe(200);
    expect(fetchBackend).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchBackend.mock.calls[0]?.[1].body))).toEqual({
      schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
      label: "Contribution agent",
      expiresInDays: 90,
    });
  });

  it.each([
    [],
    ["modules:submit"],
    ["modules:submit", "modules:submit"],
    ["modules:submit", "custom-launch:read"],
    ["modules:submit", "modules:read", "custom-launch:create"],
    ["modules:submit", "modules:approve"],
  ].map((scopes) => ({ scopes })))("rejects malformed, mixed or broader scope sets ($scopes)", async ({ scopes }) => {
    fetchBackend.mockResolvedValueOnce(backendJson({ apiKeys: [summary({ scopes })] }));
    const response = await bridge().list(new Request(
      `https://programmable.market/api/developer/api-keys?walletAddress=${WALLET}`,
    ));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("api_key_service_unavailable");
  });

  it.each(["custom-launches", "module-contributions"])(
    "does not reveal a key issued for a different purpose than %s",
    async (purpose) => {
      if (purpose === "module-contributions") {
        fetchBackend.mockResolvedValueOnce(backendJson({
          apiKeys: [], moduleContributions: MODULE_AVAILABLE,
        }));
      }
      fetchBackend.mockResolvedValueOnce(backendJson({
        apiKey: summary({ scopes: purpose === "custom-launches"
          ? MODULE_SCOPES : ["custom-launch:create", "custom-launch:read"] }),
        secretState: "delivered-once",
        apiKeySecret: API_KEY_SECRET,
      }, 201));
      const response = await bridge().create(createRequest({ purpose }));
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(API_KEY_SECRET);
    },
  );

  it("does not query capabilities for a module key owned by an unlinked wallet", async () => {
    const response = await bridge().create(createRequest({
      purpose: "module-contributions", walletAddress: OTHER_WALLET,
    }));
    expect(response.status).toBe(403);
    expect(fetchBackend).not.toHaveBeenCalled();
  });

  it("rejects purpose overrides on rotation and arbitrary browser scope grants", async () => {
    for (const extra of [
      { purpose: "admin" },
      { purpose: null },
      { scopes: MODULE_SCOPES },
      { purpose: "module-contributions", scopes: MODULE_SCOPES },
    ]) {
      expect((await bridge().create(createRequest(extra))).status).toBe(400);
    }
    for (const extra of [
      { purpose: "module-contributions" },
      { purpose: "custom-launches" },
      { scopes: MODULE_SCOPES },
    ]) {
      expect((await bridge().rotate(createRequest(extra), CREDENTIAL_ID)).status).toBe(400);
    }
    expect(authenticate).not.toHaveBeenCalled();
    expect(fetchBackend).not.toHaveBeenCalled();
  });

  it("passes through a module rotation without sending any scope or purpose change", async () => {
    fetchBackend.mockResolvedValueOnce(backendJson({
      apiKey: summary({ id: "028f3e2a-7b4c-7d5e-8f90-123456789abc", scopes: MODULE_SCOPES }),
      secretState: "already-delivered",
      rotatedCredentialId: CREDENTIAL_ID,
    }));
    const response = await bridge().rotate(createRequest(), CREDENTIAL_ID);
    expect(response.status).toBe(200);
    expect((await response.json()).apiKey.scopes).toEqual(MODULE_SCOPES);
    const [, init] = fetchBackend.mock.calls[0] as [URL, RequestInit];
    expect(JSON.parse(String(init.body))).not.toHaveProperty("scopes");
    expect(JSON.parse(String(init.body))).not.toHaveProperty("purpose");
  });

  it("accepts an idempotent issue replay without inventing or leaking a secret", async () => {
    fetchBackend.mockResolvedValueOnce(backendJson({
      apiKey: summary(),
      secretState: "already-delivered",
    }, 200));
    const response = await bridge().create(new Request(
      "https://programmable.market/api/developer/api-keys",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": IDEMPOTENCY_ID,
        },
        body: JSON.stringify({
          schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
          walletAddress: WALLET,
          label: "Launch agent",
          expiresInDays: 90,
        }),
      },
    ));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
      apiKey: summary(),
      secretState: "already-delivered",
    });
    expect(body).not.toHaveProperty("apiKeySecret");
  });

  it("rotates with exact bytes and projects the replacement secret only once", async () => {
    const replacement = summary({
      id: "028f3e2a-7b4c-7d5e-8f90-123456789abc",
    });
    fetchBackend.mockResolvedValueOnce(backendJson({
      apiKey: replacement,
      secretState: "delivered-once",
      apiKeySecret: API_KEY_SECRET,
      rotatedCredentialId: CREDENTIAL_ID,
    }, 201));
    const response = await bridge().rotate(new Request(
      `https://programmable.market/api/developer/api-keys/${CREDENTIAL_ID}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": IDEMPOTENCY_ID,
        },
        body: JSON.stringify({
          schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
          walletAddress: WALLET,
          label: "Launch agent",
          expiresInDays: 90,
        }),
      },
    ), CREDENTIAL_ID);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
      apiKey: replacement,
      secretState: "delivered-once",
      apiKeySecret: API_KEY_SECRET,
      rotatedCredentialId: CREDENTIAL_ID,
    });
    const [url, init] = fetchBackend.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe(
      `/v1/wallet-admin/api-keys/${CREDENTIAL_ID}/rotate`,
    );
    expect(Buffer.isBuffer(init.body)).toBe(true);
    expect(String(init.body)).toBe(JSON.stringify({
      schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
      label: "Launch agent",
      expiresInDays: 90,
    }));
    expect(new Headers(init.headers).get("idempotency-key")).toBe(
      IDEMPOTENCY_ID,
    );
  });

  it("rejects a rotate response that reuses the revoked credential id", async () => {
    fetchBackend.mockResolvedValueOnce(backendJson({
      apiKey: summary(),
      secretState: "delivered-once",
      apiKeySecret: API_KEY_SECRET,
      rotatedCredentialId: CREDENTIAL_ID,
    }, 201));
    const response = await bridge().rotate(new Request(
      `https://programmable.market/api/developer/api-keys/${CREDENTIAL_ID}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": IDEMPOTENCY_ID,
        },
        body: JSON.stringify({
          schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
          walletAddress: WALLET,
          label: "Launch agent",
          expiresInDays: 90,
        }),
      },
    ), CREDENTIAL_ID);

    expect(response.status).toBe(503);
    expect((await correlatedError(response)).body.error.code).toBe(
      "api_key_service_unavailable",
    );
  });

  it("fails closed when replay state and secret delivery contradict", async () => {
    fetchBackend.mockResolvedValueOnce(backendJson({
      apiKey: summary(),
      secretState: "already-delivered",
      apiKeySecret: API_KEY_SECRET,
    }, 200));
    const response = await bridge().create(new Request(
      "https://programmable.market/api/developer/api-keys",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": IDEMPOTENCY_ID,
        },
        body: JSON.stringify({
          schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
          walletAddress: WALLET,
          label: "Launch agent",
        }),
      },
    ));

    expect(response.status).toBe(503);
    expect((await correlatedError(response)).body.error.code).toBe(
      "api_key_service_unavailable",
    );
  });

  it("requires a bounded idempotency key before authenticating issue or rotate", async () => {
    const body = JSON.stringify({
      schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
      walletAddress: WALLET,
      label: "Launch agent",
    });
    const issue = await bridge().create(new Request(
      "https://programmable.market/api/developer/api-keys",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      },
    ));
    const rotate = await bridge().rotate(new Request(
      `https://programmable.market/api/developer/api-keys/${CREDENTIAL_ID}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "too-short",
        },
        body,
      },
    ), CREDENTIAL_ID);

    expect(issue.status).toBe(400);
    expect((await issue.json()).error.code).toBe("INVALID_IDEMPOTENCY_KEY");
    expect(rotate.status).toBe(400);
    expect((await rotate.json()).error.code).toBe("INVALID_IDEMPOTENCY_KEY");
    expect(authenticate).not.toHaveBeenCalled();
    expect(fetchBackend).not.toHaveBeenCalled();
  });

  it("rejects a wallet outside the current Privy linked-wallet set", async () => {
    const response = await bridge().create(new Request(
      "https://programmable.market/api/developer/api-keys",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": IDEMPOTENCY_ID,
          authorization: "Bearer browser-privy-token",
        },
        body: JSON.stringify({
          schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
          walletAddress: OTHER_WALLET,
          label: "Wrong wallet",
          expiresInDays: 30,
        }),
      },
    ));

    expect(response.status).toBe(403);
    expect(fetchBackend).not.toHaveBeenCalled();
  });

  it("fails closed on unknown fields, duplicate fields and non-expiring keys", async () => {
    const bodies = [
      JSON.stringify({
        schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
        walletAddress: WALLET,
        label: "Key",
        scopes: ["fees:claim"],
      }),
      `{"schemaVersion":"${CUSTOM_LAUNCH_API_SCHEMA_V1}","walletAddress":"${WALLET}","label":"one","label":"two"}`,
      JSON.stringify({
        schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
        walletAddress: WALLET,
        label: "Key",
        expiresInDays: null,
      }),
    ];
    for (const body of bodies) {
      const response = await bridge().create(new Request(
        "https://programmable.market/api/developer/api-keys",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        },
      ));
      expect(response.status).toBe(400);
    }
    expect(fetchBackend).not.toHaveBeenCalled();
  });

  it("assigns a fresh correlation ID to every locally generated error", async () => {
    const methodError = await bridge().list(new Request(
      `https://programmable.market/api/developer/api-keys?walletAddress=${WALLET}`,
      { method: "POST" },
    ));
    const requestError = await bridge().list(new Request(
      "https://programmable.market/api/developer/api-keys",
    ));

    expect(methodError.status).toBe(405);
    expect(methodError.headers.get("allow")).toBe("GET");
    expect(requestError.status).toBe(400);
    const methodCorrelation = await correlatedError(methodError);
    const requestCorrelation = await correlatedError(requestError);
    expect(methodCorrelation.requestId).not.toBe(requestCorrelation.requestId);
    expect(fetchBackend).not.toHaveBeenCalled();
  });

  it("revokes by credential id without exposing the internal service response", async () => {
    fetchBackend.mockResolvedValueOnce(backendJson({
      revoked: true,
      credentialId: CREDENTIAL_ID,
      internalReceipt: "hidden",
    }));
    const response = await bridge().revoke(new Request(
      `https://programmable.market/api/developer/api-keys/${CREDENTIAL_ID}?walletAddress=${WALLET}`,
      {
        method: "DELETE",
        headers: {
          accept: "application/json",
          authorization: "Bearer browser-privy-token",
        },
      },
    ), CREDENTIAL_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
      revoked: true,
      credentialId: CREDENTIAL_ID,
    });
    const [, init] = fetchBackend.mock.calls[0] as [URL, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
    });
  });

  it.each([
    [400, "REQUEST_SCHEMA_INVALID", null],
    [409, "WALLET_BINDING_CONFLICT", null],
    [429, "API_CREDENTIAL_QUOTA_EXCEEDED", "37"],
  ] as const)(
    "preserves bounded backend HTTP %i errors and correlation metadata",
    async (status, code, retryAfter) => {
      const requestId = "018f3e2a-7b4c-7d5e-8f90-123456789abc";
      fetchBackend.mockResolvedValueOnce(new Response(JSON.stringify({
        schemaVersion: "programmable.api-error.v1",
        error: {
          code,
          message: "The request could not be completed.",
          requestId,
        },
      }), {
        status,
        headers: {
          "content-type": "application/json",
          ...(retryAfter ? { "retry-after": retryAfter } : {}),
        },
      }));

      const response = await bridge().list(new Request(
        `https://programmable.market/api/developer/api-keys?walletAddress=${WALLET}`,
      ));

      expect(response.status).toBe(status);
      expect(response.headers.get("x-request-id")).toBe(requestId);
      expect(response.headers.get("retry-after")).toBe(retryAfter);
      expect(await response.json()).toEqual({
        schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
        error: {
          code,
          message: "The request could not be completed.",
          requestId,
        },
      });
    },
  );

  it("maps malformed or unavailable backend responses to one generic 503", async () => {
    fetchBackend.mockResolvedValueOnce(backendJson({ apiKeys: [{ secret: "leak" }] }));
    const malformed = await bridge().list(new Request(
      `https://programmable.market/api/developer/api-keys?walletAddress=${WALLET}`,
    ));
    expect(malformed.status).toBe(503);
    const malformedCorrelation = await correlatedError(malformed);
    expect(malformedCorrelation.body.error.code).toBe(
      "api_key_service_unavailable",
    );
    expect(console.error).toHaveBeenNthCalledWith(
      1,
      "Developer API key request failed",
      {
        name: "BackendContractErrorV1",
        requestId: malformedCorrelation.requestId,
      },
    );

    fetchBackend.mockRejectedValueOnce(new Error("private backend detail"));
    const unavailable = await bridge().list(new Request(
      `https://programmable.market/api/developer/api-keys?walletAddress=${WALLET}`,
    ));
    expect(unavailable.status).toBe(503);
    const unavailableCorrelation = await correlatedError(unavailable);
    expect(unavailableCorrelation.body.error.code).toBe(
      "api_key_service_unavailable",
    );
    expect(console.error).toHaveBeenNthCalledWith(
      2,
      "Developer API key request failed",
      {
        name: "Error",
        requestId: unavailableCorrelation.requestId,
      },
    );
  });
});
