import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PARTNER_ADMIN_SCHEMA_V1 } from "../lib/partner-admin-contract";
import { WEBSITE_ADMIN_WALLET } from "../lib/admin-access";
import {
  createPartnerAdminBridgeV1,
} from "../lib/server/custom-launch/partner-admin-bridge-v1";
import {
  WalletPrincipalAuthenticationErrorV1,
} from "../lib/server/creator-article/wallet-principal.server";

const WALLET = WEBSITE_ADMIN_WALLET;
const OTHER_WALLET = "0x2222222222222222222222222222222222222222" as const;
const PARTNER_ID = "018f3e2a-7b4c-7d5e-8f90-123456789abc";
const OTHER_PARTNER_ID = "038f3e2a-7b4c-7d5e-8f90-123456789abc";
const ROOT_KEY_ID = "028f3e2a-7b4c-7d5e-8f90-123456789abc";
const ROTATED_ROOT_KEY_ID = "048f3e2a-7b4c-7d5e-8f90-123456789abc";
const KEY_ID = "A".repeat(22);
const ROTATED_KEY_ID = "C".repeat(22);
const ROOT_SECRET = `pm_partner_root_${KEY_ID}_${"B".repeat(43)}`;
const ROTATED_ROOT_SECRET =
  `pm_partner_root_${ROTATED_KEY_ID}_${"D".repeat(43)}`;
const WEBSITE_TOKEN = "w".repeat(43);
const ASSERTION_KEY = "b".repeat(43);
const ASSERTION_ISSUED_AT = "2026-08-27T08:00:00.000Z";
const ASSERTION_NONCE = "AAAAAAAAAAAAAAAAAAAAAA";
const IDEMPOTENCY_VALUE = "018f3e2a-7b4c-7d5e-8f90-123456789abc";
const REQUEST_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ASSERTION_DOMAIN =
  "programmable.custom-launch-api.wallet-bff-assertion.v2";

const BUDGETS = Object.freeze({
  prepareRequestsPerHour: 100,
  readRequestsPerMinute: 60,
  subkeyAdminRequestsPerHour: 20,
});
const SCOPES = Object.freeze([
  "custom-launch:create",
  "custom-launch:read",
  "partner-subkeys:manage",
]);

function backendPartner(
  extra: Readonly<Record<string, unknown>> = {},
) {
  return {
    partnerId: PARTNER_ID,
    slug: "partner-studio",
    name: "Partner Studio",
    website: "https://partner.example/",
    status: "active",
    createdAt: ASSERTION_ISSUED_AT,
    updatedAt: ASSERTION_ISSUED_AT,
    suspendedAt: null,
    revokedAt: null,
    ...extra,
  };
}

function backendRoot(
  extra: Readonly<Record<string, unknown>> = {},
) {
  return {
    rootKeyId: ROOT_KEY_ID,
    partnerId: PARTNER_ID,
    keyId: KEY_ID,
    displayName: "Primary root key",
    scopes: SCOPES,
    budgets: BUDGETS,
    createdAt: ASSERTION_ISSUED_AT,
    expiresAt: "2027-08-28T08:00:00.000Z",
    lastUsedAt: null,
    revokedAt: null,
    rotatedFromRootKeyId: null,
    ...extra,
  };
}

function browserPartner(rootKeys = [browserRoot()]) {
  return {
    id: PARTNER_ID,
    slug: "partner-studio",
    displayName: "Partner Studio",
    publicUrl: "https://partner.example/",
    status: "active",
    createdAt: ASSERTION_ISSUED_AT,
    updatedAt: ASSERTION_ISSUED_AT,
    suspendedAt: null,
    revokedAt: null,
    rootKeys,
  };
}

function browserRoot(extra: Readonly<Record<string, unknown>> = {}) {
  return {
    id: ROOT_KEY_ID,
    partnerId: PARTNER_ID,
    keyId: KEY_ID,
    label: "Primary root key",
    keyPrefix: `pm_partner_root_${KEY_ID}`,
    scopes: SCOPES,
    budgets: BUDGETS,
    createdAt: ASSERTION_ISSUED_AT,
    expiresAt: "2027-08-28T08:00:00.000Z",
    lastUsedAt: null,
    revokedAt: null,
    rotatedFromRootKeyId: null,
    ...extra,
  };
}

function backendJson(
  schemaVersion: string,
  body: Readonly<Record<string, unknown>>,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
) {
  return new Response(JSON.stringify({ schemaVersion, ...body }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function browserHeaders(json = false) {
  return {
    accept: "application/json",
    authorization: "Bearer browser-privy-token",
    "x-privy-identity-token": "browser-identity-token",
    ...(json ? { "content-type": "application/json" } : {}),
  };
}

function createBrowserBody() {
  return {
    schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
    walletAddress: WALLET,
    slug: "partner-studio",
    displayName: "Partner Studio",
    publicUrl: "https://partner.example/",
    rootKeyLabel: "Primary root key",
    budgets: BUDGETS,
    expiresInDays: 366,
  };
}

function rootBrowserBody(label = "Primary root key") {
  return {
    schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
    walletAddress: WALLET,
    label,
    budgets: BUDGETS,
    expiresInDays: 366,
  };
}

function expectedAssertion(
  method: "GET" | "POST" | "DELETE",
  requestTarget: string,
  body: string | undefined,
) {
  const bodyBytes = Buffer.from(body ?? "", "utf8");
  const bodySha256 = `sha256:${createHash("sha256").update(bodyBytes).digest("hex")}`;
  const fields = [
    method,
    requestTarget,
    "did:privy:test-user",
    WALLET.toLowerCase(),
    ASSERTION_ISSUED_AT,
    ASSERTION_NONCE,
    bodySha256,
  ];
  const signed = Buffer.concat([
    Buffer.from(ASSERTION_DOMAIN, "utf8"),
    Buffer.from([0]),
    Buffer.from(fields.join("\u0000"), "utf8"),
  ]);
  return {
    bodySha256,
    signature: `hmac-sha256:${createHmac("sha256", ASSERTION_KEY)
      .update(signed)
      .digest("hex")}`,
  };
}

function expectSignedBackendCall(
  call: unknown[],
  input: Readonly<{
    method: "GET" | "POST" | "DELETE";
    requestTarget: string;
    body?: Readonly<Record<string, unknown>>;
    idempotencyKey?: string;
  }>,
) {
  const [url, init] = call as [URL, RequestInit];
  expect(url.toString()).toBe(
    `https://custom-launch-api.example${input.requestTarget}`,
  );
  expect(init.method).toBe(input.method);
  const body = input.body === undefined
    ? undefined
    : JSON.stringify(input.body);
  expect(init.body === undefined ? undefined : String(init.body)).toBe(body);
  const expected = expectedAssertion(input.method, input.requestTarget, body);
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
    expected.bodySha256,
  );
  expect(headers.get("x-programmable-bff-assertion-signature")).toBe(
    expected.signature,
  );
  expect(headers.get("idempotency-key")).toBe(input.idempotencyKey ?? null);
  expect(body ?? "").not.toContain("browser-privy-token");
  expect(body ?? "").not.toContain("browser-identity-token");
}

async function correlatedError(response: Response) {
  const requestId = response.headers.get("x-request-id");
  expect(requestId).toMatch(REQUEST_ID);
  const body = await response.json();
  expect(body.error.requestId).toBe(requestId);
  return body;
}

describe("partner admin same-origin bridge", () => {
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
    return createPartnerAdminBridgeV1({
      authenticator: { authenticate },
      backendBaseUrl: "https://custom-launch-api.example/",
      websiteToken: WEBSITE_TOKEN,
      bffAssertionKeyV2: ASSERTION_KEY,
      fetchBackend,
      backendTimeoutMs: 1_000,
      now: () => new Date(ASSERTION_ISSUED_AT),
      assertionNonce: () => ASSERTION_NONCE,
    });
  }

  it("rejects unauthenticated and unlinked wallets before backend access", async () => {
    authenticate.mockRejectedValueOnce(
      new WalletPrincipalAuthenticationErrorV1(401, "session_required"),
    );
    const unauthenticated = await bridge().list(new Request(
      `https://programmable.market/api/admin/partners?walletAddress=${WALLET}`,
      { headers: browserHeaders() },
    ));
    expect(unauthenticated.status).toBe(401);
    expect((await unauthenticated.json()).error.code).toBe("session_required");

    authenticate.mockResolvedValueOnce({
      privyUserId: "did:privy:test-user",
      privySessionId: "session-1",
      wallets: [OTHER_WALLET],
    });
    const unlinked = await bridge().list(new Request(
      `https://programmable.market/api/admin/partners?walletAddress=${WALLET}`,
      { headers: browserHeaders() },
    ));
    expect(unlinked.status).toBe(403);
    expect((await unlinked.json()).error.code).toBe("wallet_not_linked");

    authenticate.mockResolvedValueOnce({
      privyUserId: "did:privy:test-user",
      privySessionId: "session-1",
      wallets: [OTHER_WALLET],
    });
    const unlinkedMutation = await bridge().create(new Request(
      "https://programmable.market/api/admin/partners",
      {
        method: "POST",
        headers: { ...browserHeaders(true), "idempotency-key": IDEMPOTENCY_VALUE },
        body: JSON.stringify(createBrowserBody()),
      },
    ));
    expect(unlinkedMutation.status).toBe(403);
    expect((await unlinkedMutation.json()).error.code).toBe("wallet_not_linked");
    expect(fetchBackend).not.toHaveBeenCalled();
  });

  it.each(["read", "write"])("rejects another linked wallet on admin %s before any backend access", async operation => {
    authenticate.mockResolvedValueOnce({
      privyUserId: "did:privy:test-user",
      privySessionId: "session-1",
      wallets: [WALLET, OTHER_WALLET],
    });
    const result = operation === "read"
      ? await bridge().list(new Request(
        `https://programmable.market/api/admin/partners?walletAddress=${OTHER_WALLET}`,
        { headers: browserHeaders() },
      ))
      : await bridge().create(new Request("https://programmable.market/api/admin/partners", {
        method: "POST",
        headers: { ...browserHeaders(true), "idempotency-key": IDEMPOTENCY_VALUE },
        body: JSON.stringify({ ...createBrowserBody(), walletAddress: OTHER_WALLET }),
      }));
    expect(result.status).toBe(403);
    expect((await result.json()).error.code).toBe("admin_wallet_required");
    expect(fetchBackend).not.toHaveBeenCalled();
  });

  it("lists partners plus persistent root metadata through exact signed calls", async () => {
    fetchBackend
      .mockResolvedValueOnce(backendJson(
        "programmable.partner-list.v1",
        {
          partners: [backendPartner({ internalAdminNote: "must-not-cross" })],
          internalCursor: "must-not-cross",
        },
      ))
      .mockResolvedValueOnce(backendJson(
        "programmable.partner-root-credential-list.v1",
        {
          credentials: [backendRoot({ apiKey: ROOT_SECRET })],
          internalReceipt: "must-not-cross",
        },
      ));

    const response = await bridge().list(new Request(
      `https://programmable.market/api/admin/partners?walletAddress=${WALLET}`,
      { headers: browserHeaders() },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({
      schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
      partners: [browserPartner()],
      pagination: {
        page: 1,
        pageSize: 12,
        totalPartners: 1,
        totalPages: 1,
      },
    });
    expect(JSON.stringify(body)).not.toContain(ROOT_SECRET);
    expect(JSON.stringify(body)).not.toContain("must-not-cross");
    expectSignedBackendCall(fetchBackend.mock.calls[0], {
      method: "GET",
      requestTarget: "/v1/admin/partners",
    });
    expectSignedBackendCall(fetchBackend.mock.calls[1], {
      method: "GET",
      requestTarget: `/v1/admin/partners/${PARTNER_ID}/root-keys`,
    });
  });

  it("binds create body and assertion and exposes a committed secret only once", async () => {
    fetchBackend
      .mockResolvedValueOnce(backendJson(
        "programmable.partner-create-result.v1",
        {
          partner: backendPartner(),
          rootCredential: {
            disposition: "created",
            credential: backendRoot(),
            apiKey: ROOT_SECRET,
            secretState: "delivered-once",
          },
        },
        201,
      ))
      .mockResolvedValueOnce(backendJson(
        "programmable.partner-create-result.v1",
        {
          partner: backendPartner(),
          rootCredential: {
            disposition: "replayed",
            credential: backendRoot(),
            apiKey: null,
            secretState: "already-delivered",
          },
        },
      ));
    const createRequest = () => new Request(
      "https://programmable.market/api/admin/partners",
      {
        method: "POST",
        headers: { ...browserHeaders(true), "idempotency-key": IDEMPOTENCY_VALUE },
        body: JSON.stringify(createBrowserBody()),
      },
    );
    const instance = bridge();

    const created = await instance.create(createRequest());
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({
      schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
      partner: browserPartner(),
      rootKey: browserRoot(),
      secretState: "delivered-once",
      rootKeySecret: ROOT_SECRET,
    });

    const replayed = await instance.create(createRequest());
    expect(replayed.status).toBe(200);
    const replayedBody = await replayed.json();
    expect(replayedBody).toEqual({
      schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
      partner: browserPartner(),
      rootKey: browserRoot(),
      secretState: "already-delivered",
    });
    expect(Object.hasOwn(replayedBody, "rootKeySecret")).toBe(false);
    expect(JSON.stringify(replayedBody)).not.toContain(ROOT_SECRET);

    const backendBody = {
      schemaVersion: "programmable.partner-create-request.v1",
      slug: "partner-studio",
      name: "Partner Studio",
      website: "https://partner.example/",
      rootKey: {
        displayName: "Primary root key",
        scopes: SCOPES,
        budgets: BUDGETS,
        expiresAt: "2027-08-28T08:00:00.000Z",
      },
    };
    expectSignedBackendCall(fetchBackend.mock.calls[0], {
      method: "POST",
      requestTarget: "/v1/admin/partners",
      body: backendBody,
      idempotencyKey: IDEMPOTENCY_VALUE,
    });
    expectSignedBackendCall(fetchBackend.mock.calls[1], {
      method: "POST",
      requestTarget: "/v1/admin/partners",
      body: backendBody,
      idempotencyKey: IDEMPOTENCY_VALUE,
    });
  });

  it("binds status updates and their root-list refresh to one wallet and partner", async () => {
    const suspendedAt = "2026-08-27T08:05:00.000Z";
    fetchBackend
      .mockResolvedValueOnce(backendJson(
        "programmable.partner.v1",
        {
          partner: backendPartner({
            status: "suspended",
            suspendedAt,
            updatedAt: suspendedAt,
          }),
        },
      ))
      .mockResolvedValueOnce(backendJson(
        "programmable.partner-root-credential-list.v1",
        { credentials: [backendRoot()] },
      ));
    const requestBody = {
      schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
      walletAddress: WALLET,
      status: "suspended",
    };
    const response = await bridge().setStatus(new Request(
      `https://programmable.market/api/admin/partners/${PARTNER_ID}/status`,
      {
        method: "POST",
        headers: { ...browserHeaders(true), "idempotency-key": IDEMPOTENCY_VALUE },
        body: JSON.stringify(requestBody),
      },
    ), PARTNER_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
      partner: {
        ...browserPartner(),
        status: "suspended",
        suspendedAt,
        updatedAt: suspendedAt,
      },
    });
    expectSignedBackendCall(fetchBackend.mock.calls[0], {
      method: "POST",
      requestTarget: `/v1/admin/partners/${PARTNER_ID}/status`,
      body: {
        schemaVersion: "programmable.partner-status-request.v1",
        status: "suspended",
      },
      idempotencyKey: IDEMPOTENCY_VALUE,
    });
    expectSignedBackendCall(fetchBackend.mock.calls[1], {
      method: "GET",
      requestTarget: `/v1/admin/partners/${PARTNER_ID}/root-keys`,
    });
  });

  it("permanently revokes the exact partner and returns its revoked roots", async () => {
    const revokedAt = "2026-08-27T08:07:00.000Z";
    fetchBackend
      .mockResolvedValueOnce(backendJson(
        "programmable.partner.v1",
        backendPartner({
          status: "revoked",
          updatedAt: revokedAt,
          revokedAt,
        }),
      ))
      .mockResolvedValueOnce(backendJson(
        "programmable.partner-root-credential-list.v1",
        { credentials: [backendRoot({ revokedAt })] },
      ));

    const response = await bridge().revokePartner(new Request(
      `https://programmable.market/api/admin/partners/${PARTNER_ID}?walletAddress=${WALLET}`,
      { method: "DELETE", headers: browserHeaders() },
    ), PARTNER_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
      partner: {
        ...browserPartner([browserRoot({ revokedAt })]),
        status: "revoked",
        updatedAt: revokedAt,
        revokedAt,
      },
    });
    expectSignedBackendCall(fetchBackend.mock.calls[0], {
      method: "DELETE",
      requestTarget: `/v1/admin/partners/${PARTNER_ID}`,
    });
    expectSignedBackendCall(fetchBackend.mock.calls[1], {
      method: "GET",
      requestTarget: `/v1/admin/partners/${PARTNER_ID}/root-keys`,
    });
  });

  it("pages the bounded 500-partner contract before loading root lists", async () => {
    const partnerCount = 25;
    fetchBackend.mockResolvedValueOnce(backendJson(
      "programmable.partner-list.v1",
      { partners: Array.from({ length: partnerCount }, () => backendPartner()) },
    ));
    for (let index = 0; index < 12; index += 1) {
      fetchBackend.mockResolvedValueOnce(backendJson(
        "programmable.partner-root-credential-list.v1",
        { credentials: Array.from({ length: 500 }, () => backendRoot()) },
      ));
    }

    const response = await bridge().list(new Request(
      `https://programmable.market/api/admin/partners?walletAddress=${WALLET}&page=2&pageSize=12`,
      { headers: browserHeaders() },
    ));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pagination).toEqual({
      page: 2,
      pageSize: 12,
      totalPartners: 25,
      totalPages: 3,
    });
    expect(body.partners).toHaveLength(12);
    expect(body.partners[0].rootKeys).toHaveLength(500);
    expect(fetchBackend).toHaveBeenCalledTimes(13);
  });

  it("issues one root secret and keeps idempotent replay secretless", async () => {
    fetchBackend
      .mockResolvedValueOnce(backendJson(
        "programmable.partner-root-credential-result.v1",
        {
          disposition: "created",
          credential: backendRoot(),
          apiKey: ROOT_SECRET,
          secretState: "delivered-once",
        },
        201,
      ))
      .mockResolvedValueOnce(backendJson(
        "programmable.partner-root-credential-result.v1",
        {
          disposition: "replayed",
          credential: backendRoot(),
          apiKey: null,
          secretState: "already-delivered",
        },
      ));
    const issueRequest = () => new Request(
      `https://programmable.market/api/admin/partners/${PARTNER_ID}/root-keys`,
      {
        method: "POST",
        headers: { ...browserHeaders(true), "idempotency-key": IDEMPOTENCY_VALUE },
        body: JSON.stringify(rootBrowserBody()),
      },
    );
    const instance = bridge();
    const issued = await instance.issueRootKey(issueRequest(), PARTNER_ID);
    const replayed = await instance.issueRootKey(issueRequest(), PARTNER_ID);

    expect(issued.status).toBe(201);
    expect(await issued.json()).toEqual({
      schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
      rootKey: browserRoot(),
      secretState: "delivered-once",
      rootKeySecret: ROOT_SECRET,
    });
    expect(replayed.status).toBe(200);
    const replayedBody = await replayed.json();
    expect(replayedBody).toEqual({
      schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
      rootKey: browserRoot(),
      secretState: "already-delivered",
    });
    expect(JSON.stringify(replayedBody)).not.toContain(ROOT_SECRET);

    const backendBody = {
      schemaVersion: "programmable.partner-root-key-request.v1",
      displayName: "Primary root key",
      scopes: SCOPES,
      budgets: BUDGETS,
      expiresAt: "2027-08-28T08:00:00.000Z",
    };
    for (const call of fetchBackend.mock.calls) {
      expectSignedBackendCall(call, {
        method: "POST",
        requestTarget: `/v1/admin/partners/${PARTNER_ID}/root-keys`,
        body: backendBody,
        idempotencyKey: IDEMPOTENCY_VALUE,
      });
    }
  });

  it("binds rotate and revoke to the exact partner and root resources", async () => {
    const rotatedBackendRoot = backendRoot({
      rootKeyId: ROTATED_ROOT_KEY_ID,
      keyId: ROTATED_KEY_ID,
      displayName: "Rotated root key",
      rotatedFromRootKeyId: ROOT_KEY_ID,
    });
    const rotatedBrowserRoot = browserRoot({
      id: ROTATED_ROOT_KEY_ID,
      keyId: ROTATED_KEY_ID,
      label: "Rotated root key",
      keyPrefix: `pm_partner_root_${ROTATED_KEY_ID}`,
      rotatedFromRootKeyId: ROOT_KEY_ID,
    });
    fetchBackend
      .mockResolvedValueOnce(backendJson(
        "programmable.partner-root-credential-result.v1",
        {
          disposition: "created",
          credential: rotatedBackendRoot,
          apiKey: ROTATED_ROOT_SECRET,
          secretState: "delivered-once",
        },
        201,
      ))
      .mockResolvedValueOnce(backendJson(
        "programmable.partner-root-revocation.v1",
        {
          disposition: "revoked",
          partnerId: PARTNER_ID,
          rootKeyId: ROTATED_ROOT_KEY_ID,
          internalReceipt: "hidden",
        },
      ));
    const instance = bridge();
    const rotateBody = rootBrowserBody("Rotated root key");
    const rotated = await instance.rotateRootKey(new Request(
      `https://programmable.market/api/admin/partners/${PARTNER_ID}/root-keys/${
        ROOT_KEY_ID
      }/rotate`,
      {
        method: "POST",
        headers: { ...browserHeaders(true), "idempotency-key": IDEMPOTENCY_VALUE },
        body: JSON.stringify(rotateBody),
      },
    ), PARTNER_ID, ROOT_KEY_ID);
    expect(rotated.status).toBe(201);
    expect(await rotated.json()).toEqual({
      schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
      rootKey: rotatedBrowserRoot,
      secretState: "delivered-once",
      rootKeySecret: ROTATED_ROOT_SECRET,
      rotatedRootKeyId: ROOT_KEY_ID,
    });
    const rotateBackendBody = {
      schemaVersion: "programmable.partner-root-key-request.v1",
      displayName: "Rotated root key",
      scopes: SCOPES,
      budgets: BUDGETS,
      expiresAt: "2027-08-28T08:00:00.000Z",
    };
    expectSignedBackendCall(fetchBackend.mock.calls[0], {
      method: "POST",
      requestTarget: `/v1/admin/partners/${PARTNER_ID}/root-keys/${
        ROOT_KEY_ID
      }/rotate`,
      body: rotateBackendBody,
      idempotencyKey: IDEMPOTENCY_VALUE,
    });

    const revoked = await instance.revokeRootKey(new Request(
      `https://programmable.market/api/admin/partners/${PARTNER_ID}/root-keys/${
        ROTATED_ROOT_KEY_ID
      }?walletAddress=${WALLET}`,
      { method: "DELETE", headers: browserHeaders() },
    ), PARTNER_ID, ROTATED_ROOT_KEY_ID);
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toEqual({
      schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
      rootKeyId: ROTATED_ROOT_KEY_ID,
      disposition: "revoked",
    });
    expectSignedBackendCall(fetchBackend.mock.calls[1], {
      method: "DELETE",
      requestTarget: `/v1/admin/partners/${PARTNER_ID}/root-keys/${
        ROTATED_ROOT_KEY_ID
      }`,
    });
  });

  it("fails closed when a rotate result is bound to another resource", async () => {
    fetchBackend.mockResolvedValueOnce(backendJson(
      "programmable.partner-root-credential-result.v1",
      {
        disposition: "created",
        credential: backendRoot({
          rootKeyId: ROTATED_ROOT_KEY_ID,
          keyId: ROTATED_KEY_ID,
          partnerId: OTHER_PARTNER_ID,
          rotatedFromRootKeyId: ROOT_KEY_ID,
        }),
        apiKey: ROTATED_ROOT_SECRET,
        secretState: "delivered-once",
      },
      201,
    ));
    const response = await bridge().rotateRootKey(new Request(
      "https://programmable.market/api/admin/partners/rotate",
      {
        method: "POST",
        headers: { ...browserHeaders(true), "idempotency-key": IDEMPOTENCY_VALUE },
        body: JSON.stringify(rootBrowserBody("Rotated root key")),
      },
    ), PARTNER_ID, ROOT_KEY_ID);
    expect(response.status).toBe(503);
    expect((await correlatedError(response)).error.code).toBe(
      "partner_admin_service_unavailable",
    );
  });

  it("fails closed on rotate predecessor reuse and issue predecessor drift", async () => {
    const rotateCases = [
      backendRoot({
        rootKeyId: ROTATED_ROOT_KEY_ID,
        keyId: ROTATED_KEY_ID,
        rotatedFromRootKeyId: ROTATED_ROOT_KEY_ID,
      }),
      backendRoot({
        rootKeyId: ROOT_KEY_ID,
        keyId: KEY_ID,
        rotatedFromRootKeyId: ROOT_KEY_ID,
      }),
    ];
    for (const credential of rotateCases) {
      const secret = credential.keyId === KEY_ID
        ? ROOT_SECRET
        : ROTATED_ROOT_SECRET;
      fetchBackend.mockResolvedValueOnce(backendJson(
        "programmable.partner-root-credential-result.v1",
        {
          disposition: "created",
          credential,
          apiKey: secret,
          secretState: "delivered-once",
        },
        201,
      ));
      const response = await bridge().rotateRootKey(new Request(
        "https://programmable.market/api/admin/partners/rotate",
        {
          method: "POST",
          headers: { ...browserHeaders(true), "idempotency-key": IDEMPOTENCY_VALUE },
          body: JSON.stringify(rootBrowserBody("Rotated root key")),
        },
      ), PARTNER_ID, ROOT_KEY_ID);
      expect(response.status).toBe(503);
      expect((await correlatedError(response)).error.code).toBe(
        "partner_admin_service_unavailable",
      );
    }

    fetchBackend.mockResolvedValueOnce(backendJson(
      "programmable.partner-root-credential-result.v1",
      {
        disposition: "created",
        credential: backendRoot({ rotatedFromRootKeyId: ROOT_KEY_ID }),
        apiKey: ROOT_SECRET,
        secretState: "delivered-once",
      },
      201,
    ));
    const issued = await bridge().issueRootKey(new Request(
      "https://programmable.market/api/admin/partners/root-keys",
      {
        method: "POST",
        headers: { ...browserHeaders(true), "idempotency-key": IDEMPOTENCY_VALUE },
        body: JSON.stringify(rootBrowserBody()),
      },
    ), PARTNER_ID);
    expect(issued.status).toBe(503);
    expect((await correlatedError(issued)).error.code).toBe(
      "partner_admin_service_unavailable",
    );
  });

  it("binds credential disposition to HTTP status and create lineage", async () => {
    const cases = [
      {
        status: 200,
        disposition: "created",
        secretState: "delivered-once",
        apiKey: ROOT_SECRET,
        rotatedFromRootKeyId: null,
      },
      {
        status: 201,
        disposition: "replayed",
        secretState: "already-delivered",
        apiKey: null,
        rotatedFromRootKeyId: null,
      },
      {
        status: 201,
        disposition: "created",
        secretState: "delivered-once",
        apiKey: ROOT_SECRET,
        rotatedFromRootKeyId: ROOT_KEY_ID,
      },
    ] as const;
    for (const entry of cases) {
      fetchBackend.mockResolvedValueOnce(backendJson(
        "programmable.partner-create-result.v1",
        {
          partner: backendPartner(),
          rootCredential: {
            disposition: entry.disposition,
            credential: backendRoot({
              rotatedFromRootKeyId: entry.rotatedFromRootKeyId,
            }),
            apiKey: entry.apiKey,
            secretState: entry.secretState,
          },
        },
        entry.status,
      ));
      const response = await bridge().create(new Request(
        "https://programmable.market/api/admin/partners",
        {
          method: "POST",
          headers: { ...browserHeaders(true), "idempotency-key": IDEMPOTENCY_VALUE },
          body: JSON.stringify(createBrowserBody()),
        },
      ));
      expect(response.status).toBe(503);
      expect((await correlatedError(response)).error.code).toBe(
        "partner_admin_service_unavailable",
      );
    }
  });

  it("fails closed when status or revocation responses name another resource", async () => {
    fetchBackend.mockResolvedValueOnce(backendJson(
      "programmable.partner.v1",
      { partner: backendPartner() },
    ));
    const statusResponse = await bridge().setStatus(new Request(
      `https://programmable.market/api/admin/partners/${PARTNER_ID}/status`,
      {
        method: "POST",
        headers: { ...browserHeaders(true), "idempotency-key": IDEMPOTENCY_VALUE },
        body: JSON.stringify({
          schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
          walletAddress: WALLET,
          status: "suspended",
        }),
      },
    ), PARTNER_ID);
    expect(statusResponse.status).toBe(503);
    expect((await correlatedError(statusResponse)).error.code).toBe(
      "partner_admin_service_unavailable",
    );

    fetchBackend.mockResolvedValueOnce(backendJson(
      "programmable.partner.v1",
      backendPartner({
        partnerId: OTHER_PARTNER_ID,
        status: "revoked",
        revokedAt: ASSERTION_ISSUED_AT,
      }),
    ));
    const partnerRevocation = await bridge().revokePartner(new Request(
      `https://programmable.market/api/admin/partners/${PARTNER_ID}?walletAddress=${WALLET}`,
      { method: "DELETE", headers: browserHeaders() },
    ), PARTNER_ID);
    expect(partnerRevocation.status).toBe(503);
    expect((await correlatedError(partnerRevocation)).error.code).toBe(
      "partner_admin_service_unavailable",
    );

    const mismatches = [
      { partnerId: OTHER_PARTNER_ID, rootKeyId: ROOT_KEY_ID },
      { partnerId: PARTNER_ID, rootKeyId: ROTATED_ROOT_KEY_ID },
      { partnerId: PARTNER_ID },
    ];
    for (const mismatch of mismatches) {
      fetchBackend.mockResolvedValueOnce(backendJson(
        "programmable.partner-root-revocation.v1",
        { disposition: "already_revoked", ...mismatch },
      ));
      const revoked = await bridge().revokeRootKey(new Request(
        `https://programmable.market/api/admin/partners/${PARTNER_ID}/root-keys/${
          ROOT_KEY_ID
        }?walletAddress=${WALLET}`,
        { method: "DELETE", headers: browserHeaders() },
      ), PARTNER_ID, ROOT_KEY_ID);
      expect(revoked.status).toBe(503);
      expect((await correlatedError(revoked)).error.code).toBe(
        "partner_admin_service_unavailable",
      );
    }
  });

  it.each([
    ["secret query key", { publicUrl: "https://partner.example/?api_key=secret" }],
    ["nested secret query key", { publicUrl: "https://partner.example/?%2561pi_key=secret" }],
    ["encoded C1 control", { publicUrl: "https://partner.example/%C2%85" }],
    ["encoded zero-width text", { publicUrl: "https://partner.example/%E2%80%8B" }],
    ["bidirectional partner name", { displayName: "Partner\u202eStudio" }],
    ["create budget ceiling", {
      budgets: { ...BUDGETS, prepareRequestsPerHour: 10_001 },
    }],
    ["read budget ceiling", {
      budgets: { ...BUDGETS, readRequestsPerMinute: 10_001 },
    }],
    ["subkey budget ceiling", {
      budgets: { ...BUDGETS, subkeyAdminRequestsPerHour: 1_001 },
    }],
  ] as const)("rejects unsafe attribution or %s before authentication", async (_label, change) => {
    const response = await bridge().create(new Request(
      "https://programmable.market/api/admin/partners",
      {
        method: "POST",
        headers: { ...browserHeaders(true), "idempotency-key": IDEMPOTENCY_VALUE },
        body: JSON.stringify({ ...createBrowserBody(), ...change }),
      },
    ));
    expect(response.status).toBe(400);
    expect(authenticate).not.toHaveBeenCalled();
    expect(fetchBackend).not.toHaveBeenCalled();
  });

  it.each([
    [400, "REQUEST_SCHEMA_INVALID", null],
    [403, "PARTNER_ADMIN_FORBIDDEN", null],
    [409, "PARTNER_SLUG_CONFLICT", null],
    [429, "PARTNER_ADMIN_RATE_LIMITED", "37"],
  ] as const)(
    "preserves bounded backend HTTP %i errors and correlation metadata",
    async (status, code, retryAfter) => {
      const requestId = "request-partner-admin-1";
      fetchBackend.mockResolvedValueOnce(backendJson(
        "programmable.api-error.v1",
        {
          error: {
            code,
            message: "The partner request could not be completed.",
            requestId,
          },
        },
        status,
        retryAfter ? { "retry-after": retryAfter } : {},
      ));
      const response = await bridge().list(new Request(
        `https://programmable.market/api/admin/partners?walletAddress=${WALLET}`,
        { headers: browserHeaders() },
      ));
      expect(response.status).toBe(status);
      expect(response.headers.get("x-request-id")).toBe(requestId);
      expect(response.headers.get("retry-after")).toBe(retryAfter);
      expect(await response.json()).toEqual({
        schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
        error: {
          code,
          message: "The partner request could not be completed.",
          requestId,
        },
      });
      expect(fetchBackend).toHaveBeenCalledTimes(1);
    },
  );

  it("maps malformed partner or root lists and oversized bodies to generic 503", async () => {
    fetchBackend.mockResolvedValueOnce(backendJson(
      "programmable.partner-list.v1",
      { partners: "not-an-array", privateDetail: ROOT_SECRET },
    ));
    const malformedPartners = await bridge().list(new Request(
      `https://programmable.market/api/admin/partners?walletAddress=${WALLET}`,
      { headers: browserHeaders() },
    ));
    expect(malformedPartners.status).toBe(503);
    expect((await correlatedError(malformedPartners)).error.code).toBe(
      "partner_admin_service_unavailable",
    );

    fetchBackend
      .mockResolvedValueOnce(backendJson(
        "programmable.partner-list.v1",
        { partners: [backendPartner()] },
      ))
      .mockResolvedValueOnce(backendJson(
        "programmable.partner-root-credential-list.v0",
        { credentials: [backendRoot()] },
      ));
    const malformedRoots = await bridge().list(new Request(
      `https://programmable.market/api/admin/partners?walletAddress=${WALLET}`,
      { headers: browserHeaders() },
    ));
    expect(malformedRoots.status).toBe(503);
    expect((await correlatedError(malformedRoots)).error.code).toBe(
      "partner_admin_service_unavailable",
    );

    fetchBackend
      .mockResolvedValueOnce(backendJson(
        "programmable.partner-list.v1",
        { partners: [backendPartner()] },
      ))
      .mockResolvedValueOnce(backendJson(
        "programmable.partner-root-credential-list.v1",
        { credentials: [backendRoot({ partnerId: OTHER_PARTNER_ID })] },
      ));
    const crossPartnerRoot = await bridge().list(new Request(
      `https://programmable.market/api/admin/partners?walletAddress=${WALLET}`,
      { headers: browserHeaders() },
    ));
    expect(crossPartnerRoot.status).toBe(503);
    expect((await correlatedError(crossPartnerRoot)).error.code).toBe(
      "partner_admin_service_unavailable",
    );

    fetchBackend.mockResolvedValueOnce(new Response("{}", {
      headers: {
        "content-length": "1048577",
        "content-type": "application/json",
      },
    }));
    const oversized = await bridge().list(new Request(
      `https://programmable.market/api/admin/partners?walletAddress=${WALLET}`,
      { headers: browserHeaders() },
    ));
    expect(oversized.status).toBe(503);
    const oversizedBody = await correlatedError(oversized);
    expect(oversizedBody.error.code).toBe("partner_admin_service_unavailable");
    expect(JSON.stringify(oversizedBody)).not.toContain(ROOT_SECRET);

    let streamCancelled = false;
    fetchBackend.mockResolvedValueOnce(new Response(new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(140_000).fill(0x20));
      },
      cancel() {
        streamCancelled = true;
      },
    }), { headers: { "content-type": "application/json" } }));
    const chunkedOversized = await bridge().list(new Request(
      `https://programmable.market/api/admin/partners?walletAddress=${WALLET}`,
      { headers: browserHeaders() },
    ));
    expect(chunkedOversized.status).toBe(503);
    expect((await correlatedError(chunkedOversized)).error.code).toBe(
      "partner_admin_service_unavailable",
    );
    expect(streamCancelled).toBe(true);

    let errorStreamCancelled = false;
    fetchBackend.mockResolvedValueOnce(new Response(new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(9_000).fill(0x20));
      },
      cancel() {
        errorStreamCancelled = true;
      },
    }), {
      status: 429,
      headers: { "content-type": "application/json" },
    }));
    const oversizedError = await bridge().list(new Request(
      `https://programmable.market/api/admin/partners?walletAddress=${WALLET}`,
      { headers: browserHeaders() },
    ));
    expect(oversizedError.status).toBe(503);
    expect((await correlatedError(oversizedError)).error.code).toBe(
      "partner_admin_service_unavailable",
    );
    expect(errorStreamCancelled).toBe(true);
  });

  it("wires every admin route to its exact bridge operation", () => {
    const route = (path: string) => readFileSync(
      new URL(`../${path}`, import.meta.url),
      "utf8",
    );
    const root = route("app/api/admin/partners/route.ts");
    expect(root).toContain(".list(request)");
    expect(root).toContain(".create(request)");
    expect(route("app/api/admin/partners/[partnerId]/status/route.ts"))
      .toContain(".setStatus(request, partnerId)");
    expect(route("app/api/admin/partners/[partnerId]/route.ts"))
      .toContain(".revokePartner(request, partnerId)");
    expect(route("app/api/admin/partners/[partnerId]/root-keys/route.ts"))
      .toContain(".issueRootKey(request, partnerId)");
    expect(route(
      "app/api/admin/partners/[partnerId]/root-keys/[rootKeyId]/rotate/route.ts",
    )).toContain(".rotateRootKey(");
    expect(route(
      "app/api/admin/partners/[partnerId]/root-keys/[rootKeyId]/route.ts",
    )).toContain(".revokeRootKey(");
  });
});
