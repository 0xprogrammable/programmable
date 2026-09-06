import "server-only";

import {
  randomBytes,
  randomUUID,
} from "node:crypto";

import { getAddress, isAddress } from "viem";

import { parseStrictJson, type JsonValue } from
  "../projection-target/canonical-json";
import {
  createPrivyWalletPrincipalAuthenticatorV1,
  WalletPrincipalAuthenticationErrorV1,
  type AuthenticatedWalletPrincipalV1,
  type WalletPrincipalAuthenticatorV1,
} from "../creator-article/wallet-principal.server";
import {
  PreservedBackendPublicErrorV1,
  readPreservedBackendPublicErrorV1,
} from "./backend-public-error-v1";
import {
  createWalletAdminBffAssertionV2,
  requireWalletAdminBffAssertionKeyV2,
} from "./wallet-admin-bff-assertion-v2";

export const CUSTOM_LAUNCH_API_SCHEMA_V1 =
  "programmable.custom-launch-api.v1" as const;

const MAXIMUM_BROWSER_BODY_BYTES = 4_096;
const MAXIMUM_BACKEND_BODY_BYTES = 65_536;
const DEFAULT_BACKEND_TIMEOUT_MS = 5_000;
const DEFAULT_EXPIRY_DAYS = 90;
const MAXIMUM_EXPIRY_DAYS = 366;
const WALLET_ADMIN_IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,128}$/u;
const CURRENT_SCOPES = Object.freeze([
  "custom-launch:create",
  "custom-launch:read",
] as const);
const MODULE_SCOPES = Object.freeze([
  "modules:submit",
  "modules:read",
] as const);
type DeveloperApiKeyScopeV1 =
  | (typeof CURRENT_SCOPES)[number]
  | (typeof MODULE_SCOPES)[number];
type DeveloperApiKeyPurposeV1 = "custom-launches" | "module-contributions";

const RESPONSE_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  Vary: "Authorization, X-Privy-Identity-Token",
});

export type DeveloperApiKeySummaryV1 = Readonly<{
  id: string;
  label: string;
  keyPrefix: string;
  scopes: readonly DeveloperApiKeyScopeV1[];
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}>;

export interface DeveloperApiKeyBridgeV1 {
  list(request: Request): Promise<Response>;
  create(request: Request): Promise<Response>;
  rotate(request: Request, credentialId: string): Promise<Response>;
  revoke(request: Request, credentialId: string): Promise<Response>;
}

export type DeveloperApiKeyMutationResultV1 =
  | Readonly<{
      apiKey: DeveloperApiKeySummaryV1;
      secretState: "delivered-once";
      apiKeySecret: string;
      rotatedCredentialId?: string;
    }>
  | Readonly<{
      apiKey: DeveloperApiKeySummaryV1;
      secretState: "already-delivered";
      rotatedCredentialId?: string;
    }>;

export type DeveloperApiKeyBackendFetchV1 = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function createDeveloperApiKeyBridgeV1(input: Readonly<{
  authenticator: WalletPrincipalAuthenticatorV1;
  backendBaseUrl: string;
  websiteToken: string;
  bffAssertionKeyV2: string;
  fetchBackend: DeveloperApiKeyBackendFetchV1;
  backendTimeoutMs?: number;
  assertionNow?: () => Date;
  assertionNonce?: () => string;
}>): DeveloperApiKeyBridgeV1 {
  const backendBaseUrl = normalizedBackendBaseUrl(input.backendBaseUrl);
  const websiteToken = boundedWebsiteToken(input.websiteToken);
  const bffAssertionKeyV2 = requireWalletAdminBffAssertionKeyV2(
    input.bffAssertionKeyV2,
    websiteToken,
  );
  const timeoutMs = input.backendTimeoutMs ?? DEFAULT_BACKEND_TIMEOUT_MS;
  const assertionNow = input.assertionNow ?? (() => new Date());
  const assertionNonce = input.assertionNonce
    ?? (() => randomBytes(16).toString("base64url"));
  if (
    typeof input.authenticator?.authenticate !== "function"
    || typeof input.fetchBackend !== "function"
    || typeof assertionNow !== "function"
    || typeof assertionNonce !== "function"
    || !Number.isInteger(timeoutMs)
    || timeoutMs < 250
    || timeoutMs > 15_000
  ) throw new TypeError("Developer API key bridge configuration is invalid");

  const callBackend = async (
    request: Request,
    principal: AuthenticatedWalletPrincipalV1,
    walletAddress: `0x${string}`,
    method: "GET" | "POST" | "DELETE",
    pathname: string,
    body?: Readonly<Record<string, JsonValue>>,
    idempotencyKey?: string,
  ) => {
    const backendUrl = new URL(pathname, backendBaseUrl);
    const bodyBytes = body === undefined
      ? Buffer.alloc(0)
      : Buffer.from(JSON.stringify(body), "utf8");
    const assertion = createWalletAdminBffAssertionV2({
      method,
      requestTarget: `${backendUrl.pathname}${backendUrl.search}`,
      privyUserId: principal.privyUserId,
      walletAddress,
      issuedAt: assertionNow().toISOString(),
      nonce: assertionNonce(),
      bodyBytes,
      assertionKey: bffAssertionKeyV2,
    });
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${websiteToken}`,
      "X-Programmable-Privy-User-Id": principal.privyUserId,
      "X-Programmable-Wallet-Address": walletAddress,
      ...assertion,
    });
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (idempotencyKey !== undefined) {
      headers.set("Idempotency-Key", idempotencyKey);
    }
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([request.signal, timeoutSignal]);
    return input.fetchBackend(backendUrl, {
      method,
      headers,
      body: body === undefined ? undefined : bodyBytes,
      cache: "no-store",
      redirect: "error",
      signal,
    });
  };

  return Object.freeze({
    async list(request: Request) {
      if (request.method !== "GET") {
        return errorResponse(405, "method_not_allowed", "GET");
      }
      try {
        requireJsonResponse(request);
        const walletInput = exactWalletQuery(request);
        const principal = await input.authenticator.authenticate(request);
        const walletAddress = requireLinkedWallet(principal, walletInput);
        const backend = await callBackend(
          request,
          principal,
          walletAddress,
          "GET",
          "/v1/wallet-admin/api-keys",
        );
        if (!backend.ok) throw await mappedBackendError(backend);
        const value = await readBoundedBackendJson(backend);
        const record = jsonRecord(value);
        requireBackendSchema(record);
        const apiKeys = parseApiKeyList(record.apiKeys);
        return jsonResponse(200, {
          schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
          apiKeys,
          ...(record.moduleContributions === undefined ? {} : {
            moduleContributions: parseModuleContributions(record.moduleContributions),
          }),
        });
      } catch (error) {
        return mappedError(error);
      }
    },

    async create(request: Request) {
      if (request.method !== "POST") {
        return errorResponse(405, "method_not_allowed", "POST");
      }
      try {
        requireJsonRequest(request);
        const body = await readBrowserJson(request);
        const parsed = parseCreateBody(body, true);
        const idempotencyKey = requireIdempotencyKey(request);
        const principal = await input.authenticator.authenticate(request);
        const walletAddress = requireLinkedWallet(principal, parsed.walletAddress);
        if (parsed.purpose === "module-contributions") {
          // A stale browser capability cannot authorize a new module key.
          const capabilities = await callBackend(
            request,
            principal,
            walletAddress,
            "GET",
            "/v1/wallet-admin/api-keys",
          );
          if (!capabilities.ok) throw await mappedBackendError(capabilities);
          const record = jsonRecord(await readBoundedBackendJson(capabilities));
          requireBackendSchema(record);
          const available = parseModuleContributions(record.moduleContributions);
          if (!available.apiKeyIssuance || !available.submissions) {
            return errorResponse(
              503,
              "MODULE_SUBMISSIONS_UNAVAILABLE",
              undefined,
              "Module contributions are not available right now. Try again later.",
            );
          }
        }
        const backend = await callBackend(
          request,
          principal,
          walletAddress,
          "POST",
          "/v1/wallet-admin/api-keys",
          Object.freeze({
            schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
            label: parsed.label,
            expiresInDays: parsed.expiresInDays,
            ...(parsed.purpose === "module-contributions"
              ? { scopes: [...MODULE_SCOPES] }
              : {}),
          }),
          idempotencyKey,
        );
        if (!backend.ok) throw await mappedBackendError(backend);
        const result = parseApiKeyMutationResult(
          await readBoundedBackendJson(backend),
          backend.status,
          undefined,
          parsed.purpose,
        );
        return jsonResponse(backend.status, {
          schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
          ...result,
        });
      } catch (error) {
        return mappedError(error);
      }
    },

    async rotate(request: Request, credentialId: string) {
      if (request.method !== "POST") {
        return errorResponse(405, "method_not_allowed", "POST");
      }
      try {
        requireJsonRequest(request);
        const normalizedCredentialId = requireBrowserCredentialId(credentialId);
        const body = await readBrowserJson(request);
        const parsed = parseCreateBody(body);
        const idempotencyKey = requireIdempotencyKey(request);
        const principal = await input.authenticator.authenticate(request);
        const walletAddress = requireLinkedWallet(principal, parsed.walletAddress);
        const backend = await callBackend(
          request,
          principal,
          walletAddress,
          "POST",
          `/v1/wallet-admin/api-keys/${
            encodeURIComponent(normalizedCredentialId)
          }/rotate`,
          Object.freeze({
            schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
            label: parsed.label,
            expiresInDays: parsed.expiresInDays,
          }),
          idempotencyKey,
        );
        if (!backend.ok) throw await mappedBackendError(backend);
        const result = parseApiKeyMutationResult(
          await readBoundedBackendJson(backend),
          backend.status,
          normalizedCredentialId,
        );
        return jsonResponse(backend.status, {
          schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
          ...result,
        });
      } catch (error) {
        return mappedError(error);
      }
    },

    async revoke(request: Request, credentialId: string) {
      if (request.method !== "DELETE") {
        return errorResponse(405, "method_not_allowed", "DELETE");
      }
      try {
        requireJsonResponse(request);
        const normalizedCredentialId = requireBrowserCredentialId(credentialId);
        const walletInput = exactWalletQuery(request);
        const principal = await input.authenticator.authenticate(request);
        const walletAddress = requireLinkedWallet(principal, walletInput);
        const backend = await callBackend(
          request,
          principal,
          walletAddress,
          "DELETE",
          `/v1/wallet-admin/api-keys/${encodeURIComponent(normalizedCredentialId)}`,
          Object.freeze({ schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1 }),
        );
        if (backend.status === 404) {
          return errorResponse(404, "api_key_not_found");
        }
        if (!backend.ok) throw await mappedBackendError(backend);
        const value = await readBoundedBackendJson(backend);
        const record = jsonRecord(value);
        requireBackendSchema(record);
        if (
          record.revoked !== true
          || record.credentialId !== normalizedCredentialId
        ) throw new BackendContractErrorV1();
        return jsonResponse(200, {
          schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
          revoked: true,
          credentialId: normalizedCredentialId,
        });
      } catch (error) {
        return mappedError(error);
      }
    },
  });
}

let productionBridge: DeveloperApiKeyBridgeV1 | null = null;

export function getProductionDeveloperApiKeyBridgeV1() {
  productionBridge ??= createDeveloperApiKeyBridgeV1({
    authenticator: createPrivyWalletPrincipalAuthenticatorV1(),
    backendBaseUrl: requiredEnvironment(
      "PROGRAMMABLE_CUSTOM_LAUNCH_API_BASE_URL",
    ),
    websiteToken: requiredEnvironment(
      "PROGRAMMABLE_CUSTOM_LAUNCH_WEBSITE_TOKEN",
    ),
    bffAssertionKeyV2: requiredRawEnvironment(
      "PROGRAMMABLE_CUSTOM_LAUNCH_BFF_ASSERTION_KEY_V2",
    ),
    fetchBackend: fetch,
  });
  return productionBridge;
}

function parseCreateBody(value: JsonValue, allowPurpose = false) {
  const record = exactBrowserRecord(value, [
    "schemaVersion",
    "walletAddress",
    "label",
    "expiresInDays",
    ...(allowPurpose ? ["purpose"] : []),
  ], ["schemaVersion", "walletAddress", "label"]);
  if (record.schemaVersion !== CUSTOM_LAUNCH_API_SCHEMA_V1) {
    throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  }
  if (typeof record.walletAddress !== "string" || record.walletAddress.length !== 42) {
    throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  }
  if (
    typeof record.label !== "string"
    || record.label.length < 1
    || record.label.length > 96
  ) throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  const walletAddress = record.walletAddress;
  const label = record.label;
  if (label !== label.trim() || /[\u0000-\u001f\u007f]/u.test(label)) {
    throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  }
  const expiresInDays = record.expiresInDays === undefined
    ? DEFAULT_EXPIRY_DAYS
    : record.expiresInDays;
  if (
    !Number.isInteger(expiresInDays)
    || (expiresInDays as number) < 1
    || (expiresInDays as number) > MAXIMUM_EXPIRY_DAYS
  ) throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  const purpose = record.purpose === undefined
    ? "custom-launches"
    : record.purpose;
  if (purpose !== "custom-launches" && purpose !== "module-contributions") {
    throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  }
  return Object.freeze({ walletAddress, label, expiresInDays, purpose });
}

function parseModuleContributions(value: JsonValue | undefined) {
  const record = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  return Object.freeze({
    apiKeyIssuance: record.apiKeyIssuance === true,
    submissions: record.submissions === true,
  });
}

function requireIdempotencyKey(request: Request) {
  const idempotencyKey = request.headers.get("idempotency-key");
  if (
    idempotencyKey === null
    || !WALLET_ADMIN_IDEMPOTENCY_KEY.test(idempotencyKey)
  ) throw new BrowserRequestErrorV1(400, "INVALID_IDEMPOTENCY_KEY");
  return idempotencyKey;
}

function exactWalletQuery(request: Request) {
  const entries = [...new URL(request.url).searchParams.entries()];
  if (
    entries.length !== 1
    || entries[0]?.[0] !== "walletAddress"
    || !entries[0][1]
  ) throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  return entries[0][1];
}

function requireLinkedWallet(
  principal: AuthenticatedWalletPrincipalV1,
  value: string,
) {
  if (!isAddress(value)) {
    throw new BrowserRequestErrorV1(400, "wallet_address_invalid");
  }
  const walletAddress = getAddress(value);
  if (!principal.wallets.some((wallet) =>
    wallet.toLowerCase() === walletAddress.toLowerCase())) {
    throw new BrowserRequestErrorV1(403, "wallet_not_linked");
  }
  return walletAddress;
}

async function readBrowserJson(request: Request): Promise<JsonValue> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_BROWSER_BODY_BYTES) {
    throw new BrowserRequestErrorV1(413, "request_too_large");
  }
  const text = await request.text();
  if (!text || Buffer.byteLength(text, "utf8") > MAXIMUM_BROWSER_BODY_BYTES) {
    throw new BrowserRequestErrorV1(413, "request_too_large");
  }
  try {
    return parseStrictJson(text, {
      maximumBytes: MAXIMUM_BROWSER_BODY_BYTES,
      maximumDepth: 8,
    });
  } catch {
    throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  }
}

async function readBoundedBackendJson(response: Response): Promise<JsonValue> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_BACKEND_BODY_BYTES) {
    throw new BackendContractErrorV1();
  }
  const text = await response.text();
  if (!text || Buffer.byteLength(text, "utf8") > MAXIMUM_BACKEND_BODY_BYTES) {
    throw new BackendContractErrorV1();
  }
  try {
    return parseStrictJson(text, {
      maximumBytes: MAXIMUM_BACKEND_BODY_BYTES,
      maximumDepth: 12,
    });
  } catch {
    throw new BackendContractErrorV1();
  }
}

function parseApiKeyList(value: JsonValue | undefined) {
  if (!Array.isArray(value) || value.length > 100) {
    throw new BackendContractErrorV1();
  }
  return Object.freeze(value.map(parseApiKeySummary));
}

function parseApiKeySummary(value: JsonValue | undefined): DeveloperApiKeySummaryV1 {
  const record = jsonRecord(value);
  const id = requireBackendCredentialId(record.id);
  const label = requiredString(record.label, 1, 96);
  const keyPrefix = requiredString(record.keyPrefix, 30, 30);
  if (!/^pm_live_[A-Za-z0-9_-]{22}$/u.test(keyPrefix)) {
    throw new BackendContractErrorV1();
  }
  const scopes = parseScopes(record.scopes);
  return Object.freeze({
    id,
    label,
    keyPrefix,
    scopes: Object.freeze(scopes),
    createdAt: requiredTimestamp(record.createdAt),
    expiresAt: optionalTimestamp(record.expiresAt),
    lastUsedAt: optionalTimestamp(record.lastUsedAt),
    revokedAt: optionalTimestamp(record.revokedAt),
  });
}

function parseScopes(value: JsonValue | undefined): readonly DeveloperApiKeyScopeV1[] {
  if (!Array.isArray(value) || value.length !== 2 || new Set(value).size !== 2) {
    throw new BackendContractErrorV1();
  }
  const pair = [CURRENT_SCOPES, MODULE_SCOPES].find((candidate) =>
    candidate.every((scope) => value.includes(scope)),
  );
  if (!pair) throw new BackendContractErrorV1();
  return Object.freeze(value as DeveloperApiKeyScopeV1[]);
}

function parseApiKeyMutationResult(
  value: JsonValue,
  status: number,
  rotatedCredentialId?: string,
  expectedPurpose?: DeveloperApiKeyPurposeV1,
): DeveloperApiKeyMutationResultV1 {
  const record = jsonRecord(value);
  requireBackendSchema(record);
  const apiKey = parseApiKeySummary(record.apiKey);
  if (expectedPurpose !== undefined) {
    const expectedScopes = expectedPurpose === "module-contributions"
      ? MODULE_SCOPES
      : CURRENT_SCOPES;
    if (!expectedScopes.every((scope) => apiKey.scopes.includes(scope))) {
      throw new BackendContractErrorV1();
    }
  }
  const secretState = record.secretState;
  const hasSecret = Object.prototype.hasOwnProperty.call(record, "apiKeySecret");
  const hasRotatedCredentialId = Object.prototype.hasOwnProperty.call(
    record,
    "rotatedCredentialId",
  );
  if (
    (secretState !== "delivered-once" && secretState !== "already-delivered")
    || (secretState === "delivered-once" && status !== 201)
    || (secretState === "already-delivered" && status !== 200)
    || (secretState === "delivered-once") !== hasSecret
    || (rotatedCredentialId !== undefined) !== hasRotatedCredentialId
  ) throw new BackendContractErrorV1();
  if (rotatedCredentialId !== undefined) {
    if (
      requireBackendCredentialId(record.rotatedCredentialId)
      !== rotatedCredentialId
      || apiKey.id === rotatedCredentialId
    ) throw new BackendContractErrorV1();
  }
  const rotation = rotatedCredentialId === undefined
    ? Object.freeze({})
    : Object.freeze({ rotatedCredentialId });
  if (secretState === "already-delivered") {
    return Object.freeze({ apiKey, secretState, ...rotation });
  }
  const apiKeySecret = requiredString(record.apiKeySecret, 74, 74);
  if (
    !/^pm_live_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{43}$/u.test(apiKeySecret)
    || !apiKeySecret.startsWith(`${apiKey.keyPrefix}_`)
  ) throw new BackendContractErrorV1();
  return Object.freeze({ apiKey, secretState, apiKeySecret, ...rotation });
}

function requireBackendSchema(record: Readonly<Record<string, JsonValue>>) {
  if (record.schemaVersion !== CUSTOM_LAUNCH_API_SCHEMA_V1) {
    throw new BackendContractErrorV1();
  }
}

function exactBrowserRecord(
  value: JsonValue,
  allowed: readonly string[],
  required: readonly string[],
) {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  }
  const record = value;
  const keys = Object.keys(record);
  if (
    keys.some((key) => !allowed.includes(key))
    || required.some((key) => !Object.prototype.hasOwnProperty.call(record, key))
  ) throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  return record;
}

function jsonRecord(value: JsonValue | undefined): Readonly<Record<string, JsonValue>> {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== "object") {
    throw new BackendContractErrorV1();
  }
  return value;
}

function requiredString(value: JsonValue | undefined, minimum: number, maximum: number) {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) {
    throw new BackendContractErrorV1();
  }
  return value;
}

function requiredTimestamp(value: JsonValue | undefined) {
  if (
    typeof value !== "string"
    || value.length < 20
    || value.length > 40
    || !Number.isFinite(Date.parse(value))
  ) throw new BackendContractErrorV1();
  return value;
}

function optionalTimestamp(value: JsonValue | undefined) {
  if (value === null) return null;
  return requiredTimestamp(value);
}

function requireBrowserCredentialId(value: JsonValue | undefined) {
  if (
    typeof value !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  ) throw new BrowserRequestErrorV1(400, "credential_id_invalid");
  return value.toLowerCase();
}

function requireBackendCredentialId(value: JsonValue | undefined) {
  if (
    typeof value !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  ) throw new BackendContractErrorV1();
  return value.toLowerCase();
}

function requireJsonRequest(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new BrowserRequestErrorV1(415, "json_body_required");
  }
  requireJsonResponse(request);
}

function requireJsonResponse(request: Request) {
  const accept = request.headers.get("accept")?.toLowerCase();
  if (accept && !accept.includes("application/json") && !accept.includes("*/*")) {
    throw new BrowserRequestErrorV1(406, "json_response_required");
  }
}

function normalizedBackendBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Custom launch API base URL is invalid");
  }
  const localHttp = url.protocol === "http:"
    && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (
    (url.protocol !== "https:" && !localHttp)
    || url.username
    || url.password
    || url.search
    || url.hash
  ) throw new TypeError("Custom launch API base URL is invalid");
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/`;
  return url;
}

function boundedWebsiteToken(value: string) {
  if (
    typeof value !== "string"
    || value.length < 43
    || value.length > 512
    || /[\s\u0000]/u.test(value)
  ) throw new TypeError("Custom launch website token is invalid");
  return value;
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is not configured`);
  return value;
}

function requiredRawEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new TypeError(`${name} is not configured`);
  return value;
}

async function mappedBackendError(response: Response) {
  if (response.status === 404) {
    return new BrowserRequestErrorV1(404, "api_key_not_found");
  }
  const preserved = await readPreservedBackendPublicErrorV1(response);
  if (preserved) return preserved;
  return new BackendContractErrorV1();
}

function mappedError(error: unknown) {
  if (error instanceof WalletPrincipalAuthenticationErrorV1) {
    return errorResponse(error.status, error.code);
  }
  if (error instanceof BrowserRequestErrorV1) {
    return errorResponse(error.status, error.code);
  }
  if (error instanceof PreservedBackendPublicErrorV1) {
    return errorResponse(
      error.status,
      error.code,
      undefined,
      error.publicMessage,
      error.requestId,
      error.retryAfter,
    );
  }
  const requestId = randomUUID();
  console.error("Developer API key request failed", {
    name: error instanceof Error ? error.name : "DeveloperApiKeyError",
    requestId,
  });
  return errorResponse(
    503,
    "api_key_service_unavailable",
    undefined,
    undefined,
    requestId,
  );
}

function jsonResponse(
  status: number,
  body: Readonly<Record<string, unknown>>,
  allow?: string,
  requestId?: string | null,
  retryAfter?: string | null,
) {
  const headers = new Headers(RESPONSE_HEADERS);
  if (allow) headers.set("Allow", allow);
  if (requestId) headers.set("X-Request-Id", requestId);
  if (retryAfter) headers.set("Retry-After", retryAfter);
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(
  status: number,
  code: string,
  allow?: string,
  publicMessage?: string,
  requestId?: string | null,
  retryAfter?: string | null,
) {
  const responseRequestId = requestId ?? randomUUID();
  return jsonResponse(status, {
    schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1,
    error: Object.freeze({
      code,
      message: publicMessage ?? (status >= 500
        ? "The API key service is temporarily unavailable."
        : "The request could not be completed."),
      requestId: responseRequestId,
    }),
  }, allow, responseRequestId, retryAfter);
}

class BrowserRequestErrorV1 extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = "BrowserRequestErrorV1";
  }
}

class BackendContractErrorV1 extends Error {
  constructor() {
    super("api_key_backend_contract_invalid");
    this.name = "BackendContractErrorV1";
  }
}
