import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import { getAddress, isAddress } from "viem";
import { isWebsiteAdminWallet } from "@/lib/admin-access";

import {
  PARTNER_ADMIN_LIST_LIMITS_V1,
  PARTNER_ADMIN_SCHEMA_V1,
  PARTNER_BUDGET_LIMITS_V1,
  PARTNER_ROOT_KEY_SCOPES_V1,
  parsePartnerRootKeySummaryV1,
  parsePartnerSummaryV1,
  type PartnerBudgetsV1,
  type PartnerRootKeySummaryV1,
  type PartnerSummaryV1,
} from "../../partner-admin-contract";
import {
  parseLaunchPartnerNameV1,
  parseLaunchPartnerWebsiteV1,
} from "../../launch-partner-attribution";
import {
  createPrivyWalletPrincipalAuthenticatorV1,
  WalletPrincipalAuthenticationErrorV1,
  type AuthenticatedWalletPrincipalV1,
  type WalletPrincipalAuthenticatorV1,
} from "../creator-article/wallet-principal.server";
import { parseStrictJson, type JsonValue } from
  "../projection-target/canonical-json";
import {
  PreservedBackendPublicErrorV1,
  readPreservedBackendPublicErrorV1,
} from "./backend-public-error-v1";
import {
  createWalletAdminBffAssertionV2,
  requireWalletAdminBffAssertionKeyV2,
} from "./wallet-admin-bff-assertion-v2";

const PARTNER_LIST_SCHEMA = "programmable.partner-list.v1";
const PARTNER_CREATE_REQUEST_SCHEMA = "programmable.partner-create-request.v1";
const PARTNER_CREATE_RESULT_SCHEMA = "programmable.partner-create-result.v1";
const PARTNER_STATUS_REQUEST_SCHEMA = "programmable.partner-status-request.v1";
const PARTNER_RESOURCE_SCHEMA = "programmable.partner.v1";
const ROOT_REQUEST_SCHEMA = "programmable.partner-root-key-request.v1";
const ROOT_RESULT_SCHEMA = "programmable.partner-root-credential-result.v1";
const ROOT_LIST_SCHEMA = "programmable.partner-root-credential-list.v1";
const ROOT_REVOCATION_SCHEMA = "programmable.partner-root-revocation.v1";
const MAXIMUM_BROWSER_BODY_BYTES = 16_384;
const MAXIMUM_BACKEND_BODY_BYTES = 1_048_576;
const MAXIMUM_PARTNERS = PARTNER_ADMIN_LIST_LIMITS_V1.maximumPartners;
const MAXIMUM_ROOT_KEYS =
  PARTNER_ADMIN_LIST_LIMITS_V1.maximumRootKeysPerPartner;
const DEFAULT_TIMEOUT_MS = 7_500;
const MAXIMUM_EXPIRY_DAYS = 366;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,128}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;

const RESPONSE_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  Vary: "Authorization, X-Privy-Identity-Token",
});

export interface PartnerAdminBridgeV1 {
  list(request: Request): Promise<Response>;
  create(request: Request): Promise<Response>;
  revokePartner(request: Request, partnerId: string): Promise<Response>;
  setStatus(request: Request, partnerId: string): Promise<Response>;
  issueRootKey(request: Request, partnerId: string): Promise<Response>;
  rotateRootKey(
    request: Request,
    partnerId: string,
    rootKeyId: string,
  ): Promise<Response>;
  revokeRootKey(
    request: Request,
    partnerId: string,
    rootKeyId: string,
  ): Promise<Response>;
}

export type PartnerAdminBackendFetchV1 = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function createPartnerAdminBridgeV1(input: Readonly<{
  authenticator: WalletPrincipalAuthenticatorV1;
  backendBaseUrl: string;
  websiteToken: string;
  bffAssertionKeyV2: string;
  fetchBackend: PartnerAdminBackendFetchV1;
  backendTimeoutMs?: number;
  now?: () => Date;
  assertionNonce?: () => string;
}>): PartnerAdminBridgeV1 {
  const backendBaseUrl = normalizedBackendBaseUrl(input.backendBaseUrl);
  const websiteToken = boundedSecret(input.websiteToken, "website token");
  const bffAssertionKeyV2 = requireWalletAdminBffAssertionKeyV2(
    input.bffAssertionKeyV2,
    websiteToken,
  );
  const timeoutMs = input.backendTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = input.now ?? (() => new Date());
  const assertionNonce = input.assertionNonce
    ?? (() => randomBytes(16).toString("base64url"));
  if (
    typeof input.authenticator?.authenticate !== "function"
    || typeof input.fetchBackend !== "function"
    || typeof now !== "function"
    || typeof assertionNonce !== "function"
    || !Number.isInteger(timeoutMs)
    || timeoutMs < 250
    || timeoutMs > 15_000
  ) throw new TypeError("Partner admin bridge configuration is invalid");

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
    const issuedAt = now().toISOString();
    const assertion = createWalletAdminBffAssertionV2({
      method,
      requestTarget: `${backendUrl.pathname}${backendUrl.search}`,
      privyUserId: principal.privyUserId,
      walletAddress,
      issuedAt,
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
    return input.fetchBackend(backendUrl, {
      method,
      headers,
      body: body === undefined ? undefined : bodyBytes,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([
        request.signal,
        AbortSignal.timeout(timeoutMs),
      ]),
    });
  };

  const rootKeysForPartner = async (
    request: Request,
    principal: AuthenticatedWalletPrincipalV1,
    walletAddress: `0x${string}`,
    partnerId: string,
  ) => {
    const backend = await callBackend(
      request,
      principal,
      walletAddress,
      "GET",
      `/v1/admin/partners/${encodeURIComponent(partnerId)}/root-keys`,
    );
    if (!backend.ok) throw await mappedBackendError(backend);
    if (backend.status !== 200) throw new BackendContractErrorV1();
    const record = jsonRecord(await readBoundedBackendJson(backend));
    requireSchema(record, ROOT_LIST_SCHEMA);
    if (!Array.isArray(record.credentials) || record.credentials.length > MAXIMUM_ROOT_KEYS) {
      throw new BackendContractErrorV1();
    }
    return Object.freeze(record.credentials.map((credential) =>
      parseBackendRootKey(credential, partnerId)));
  };

  return Object.freeze({
    async list(request: Request) {
      if (request.method !== "GET") return errorResponse(405, "method_not_allowed", "GET");
      try {
        requireJsonResponse(request);
        const query = partnerListQuery(request);
        const principal = await input.authenticator.authenticate(request);
        const walletAddress = requireLinkedWallet(
          principal,
          query.walletAddress,
        );
        const backend = await callBackend(
          request,
          principal,
          walletAddress,
          "GET",
          "/v1/admin/partners",
        );
        if (!backend.ok) throw await mappedBackendError(backend);
        if (backend.status !== 200) throw new BackendContractErrorV1();
        const record = jsonRecord(await readBoundedBackendJson(backend));
        requireSchema(record, PARTNER_LIST_SCHEMA);
        if (!Array.isArray(record.partners) || record.partners.length > MAXIMUM_PARTNERS) {
          throw new BackendContractErrorV1();
        }
        const metadata = record.partners.map(parseBackendPartnerMetadata);
        const totalPartners = metadata.length;
        const totalPages = Math.ceil(totalPartners / query.pageSize);
        const page = totalPages === 0
          ? 1
          : Math.min(query.page, totalPages);
        const pageStart = (page - 1) * query.pageSize;
        const pageMetadata = metadata.slice(
          pageStart,
          pageStart + query.pageSize,
        );
        const roots = await Promise.all(pageMetadata.map((partner) =>
          rootKeysForPartner(request, principal, walletAddress, partner.id)));
        const partners = pageMetadata.map((partner, index) =>
          requireNormalizedPartner({ ...partner, rootKeys: roots[index] ?? [] }));
        return jsonResponse(200, {
          schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
          partners,
          pagination: Object.freeze({
            page,
            pageSize: query.pageSize,
            totalPartners,
            totalPages,
          }),
        });
      } catch (error) {
        return mappedError(error);
      }
    },

    async create(request: Request) {
      if (request.method !== "POST") return errorResponse(405, "method_not_allowed", "POST");
      try {
        requireJsonRequest(request);
        const parsed = parseCreateBody(await readBrowserJson(request));
        const idempotencyKey = requireIdempotencyKey(request);
        const principal = await input.authenticator.authenticate(request);
        const walletAddress = requireLinkedWallet(principal, parsed.walletAddress);
        const backend = await callBackend(
          request,
          principal,
          walletAddress,
          "POST",
          "/v1/admin/partners",
          Object.freeze({
            schemaVersion: PARTNER_CREATE_REQUEST_SCHEMA,
            slug: parsed.slug,
            name: parsed.displayName,
            website: parsed.publicUrl,
            rootKey: Object.freeze({
              displayName: parsed.rootKeyLabel,
              scopes: [...PARTNER_ROOT_KEY_SCOPES_V1],
              budgets: parsed.budgets,
              expiresAt: expiryFromDays(now(), parsed.expiresInDays),
            }),
          }),
          idempotencyKey,
        );
        if (!backend.ok) throw await mappedBackendError(backend);
        const record = jsonRecord(await readBoundedBackendJson(backend));
        requireSchema(record, PARTNER_CREATE_RESULT_SCHEMA);
        const rootMutation = parseBackendRootMutation(
          record.rootCredential,
          backend.status,
        );
        const partnerMetadata = parseBackendPartnerMetadata(record.partner);
        if (
          rootMutation.rootKey.partnerId !== partnerMetadata.id
          || rootMutation.rootKey.rotatedFromRootKeyId !== null
          || partnerMetadata.status !== "active"
        ) {
          throw new BackendContractErrorV1();
        }
        const partner = requireNormalizedPartner({
          ...partnerMetadata,
          rootKeys: [rootMutation.rootKey],
        });
        return jsonResponse(backend.status, {
          schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
          partner,
          ...rootMutation,
        });
      } catch (error) {
        return mappedError(error);
      }
    },

    async revokePartner(request: Request, partnerId: string) {
      if (request.method !== "DELETE") {
        return errorResponse(405, "method_not_allowed", "DELETE");
      }
      try {
        requireJsonResponse(request);
        const normalizedPartnerId = requireBrowserUuid(
          partnerId,
          "partner_id_invalid",
        );
        const walletInput = exactWalletQuery(request);
        const principal = await input.authenticator.authenticate(request);
        const walletAddress = requireLinkedWallet(principal, walletInput);
        const backend = await callBackend(
          request,
          principal,
          walletAddress,
          "DELETE",
          `/v1/admin/partners/${encodeURIComponent(normalizedPartnerId)}`,
        );
        if (!backend.ok) throw await mappedBackendError(backend);
        if (backend.status !== 200) throw new BackendContractErrorV1();
        const record = jsonRecord(await readBoundedBackendJson(backend));
        requireSchema(record, PARTNER_RESOURCE_SCHEMA);
        const metadata = parseBackendPartnerMetadata(record);
        if (
          metadata.id !== normalizedPartnerId
          || metadata.status !== "revoked"
        ) throw new BackendContractErrorV1();
        const rootKeys = await rootKeysForPartner(
          request,
          principal,
          walletAddress,
          normalizedPartnerId,
        );
        return jsonResponse(backend.status, {
          schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
          partner: requireNormalizedPartner({ ...metadata, rootKeys }),
        });
      } catch (error) {
        return mappedError(error);
      }
    },

    async setStatus(request: Request, partnerId: string) {
      if (request.method !== "POST") return errorResponse(405, "method_not_allowed", "POST");
      try {
        requireJsonRequest(request);
        const normalizedPartnerId = requireBrowserUuid(partnerId, "partner_id_invalid");
        const parsed = parseStatusBody(await readBrowserJson(request));
        const idempotencyKey = requireIdempotencyKey(request);
        const principal = await input.authenticator.authenticate(request);
        const walletAddress = requireLinkedWallet(principal, parsed.walletAddress);
        const backend = await callBackend(
          request,
          principal,
          walletAddress,
          "POST",
          `/v1/admin/partners/${encodeURIComponent(normalizedPartnerId)}/status`,
          Object.freeze({
            schemaVersion: PARTNER_STATUS_REQUEST_SCHEMA,
            status: parsed.status,
          }),
          idempotencyKey,
        );
        if (!backend.ok) throw await mappedBackendError(backend);
        if (backend.status !== 200) throw new BackendContractErrorV1();
        const record = jsonRecord(await readBoundedBackendJson(backend));
        requireSchema(record, PARTNER_RESOURCE_SCHEMA);
        const metadata = parseBackendPartnerMetadata(record.partner);
        if (
          metadata.id !== normalizedPartnerId
          || metadata.status !== parsed.status
        ) throw new BackendContractErrorV1();
        const rootKeys = await rootKeysForPartner(
          request,
          principal,
          walletAddress,
          normalizedPartnerId,
        );
        return jsonResponse(backend.status, {
          schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
          partner: requireNormalizedPartner({ ...metadata, rootKeys }),
        });
      } catch (error) {
        return mappedError(error);
      }
    },

    async issueRootKey(request: Request, partnerId: string) {
      return rootMutationRequest({ request, partnerId, operation: "issue" });
    },

    async rotateRootKey(request: Request, partnerId: string, rootKeyId: string) {
      return rootMutationRequest({ request, partnerId, rootKeyId, operation: "rotate" });
    },

    async revokeRootKey(request: Request, partnerId: string, rootKeyId: string) {
      if (request.method !== "DELETE") return errorResponse(405, "method_not_allowed", "DELETE");
      try {
        requireJsonResponse(request);
        const normalizedPartnerId = requireBrowserUuid(partnerId, "partner_id_invalid");
        const normalizedRootKeyId = requireBrowserUuid(rootKeyId, "root_key_id_invalid");
        const walletInput = exactWalletQuery(request);
        const principal = await input.authenticator.authenticate(request);
        const walletAddress = requireLinkedWallet(principal, walletInput);
        const backend = await callBackend(
          request,
          principal,
          walletAddress,
          "DELETE",
          `/v1/admin/partners/${encodeURIComponent(normalizedPartnerId)}/root-keys/${
            encodeURIComponent(normalizedRootKeyId)
          }`,
        );
        if (!backend.ok) throw await mappedBackendError(backend);
        if (backend.status !== 200) throw new BackendContractErrorV1();
        const record = jsonRecord(await readBoundedBackendJson(backend));
        requireSchema(record, ROOT_REVOCATION_SCHEMA);
        if (
          (record.disposition !== "revoked"
            && record.disposition !== "already_revoked")
          || requireBackendUuid(record.partnerId) !== normalizedPartnerId
          || requireBackendUuid(record.rootKeyId) !== normalizedRootKeyId
        ) {
          throw new BackendContractErrorV1();
        }
        return jsonResponse(backend.status, {
          schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
          rootKeyId: normalizedRootKeyId,
          disposition: record.disposition,
        });
      } catch (error) {
        return mappedError(error);
      }
    },
  });

  async function rootMutationRequest(inputValue: Readonly<{
    request: Request;
    partnerId: string;
    rootKeyId?: string;
    operation: "issue" | "rotate";
  }>) {
    const { request } = inputValue;
    if (request.method !== "POST") return errorResponse(405, "method_not_allowed", "POST");
    try {
      requireJsonRequest(request);
      const normalizedPartnerId = requireBrowserUuid(
        inputValue.partnerId,
        "partner_id_invalid",
      );
      const normalizedRootKeyId = inputValue.rootKeyId === undefined
        ? undefined
        : requireBrowserUuid(inputValue.rootKeyId, "root_key_id_invalid");
      const parsed = parseRootRequestBody(await readBrowserJson(request));
      const idempotencyKey = requireIdempotencyKey(request);
      const principal = await input.authenticator.authenticate(request);
      const walletAddress = requireLinkedWallet(principal, parsed.walletAddress);
      const suffix = normalizedRootKeyId === undefined
        ? ""
        : `/${encodeURIComponent(normalizedRootKeyId)}/rotate`;
      const backend = await callBackend(
        request,
        principal,
        walletAddress,
        "POST",
        `/v1/admin/partners/${encodeURIComponent(normalizedPartnerId)}/root-keys${suffix}`,
        Object.freeze({
          schemaVersion: ROOT_REQUEST_SCHEMA,
          displayName: parsed.label,
          scopes: [...PARTNER_ROOT_KEY_SCOPES_V1],
          budgets: parsed.budgets,
          expiresAt: expiryFromDays(now(), parsed.expiresInDays),
        }),
        idempotencyKey,
      );
      if (!backend.ok) throw await mappedBackendError(backend);
      const record = jsonRecord(await readBoundedBackendJson(backend));
      requireSchema(record, ROOT_RESULT_SCHEMA);
      const mutation = parseBackendRootMutation(record, backend.status);
      if (
        mutation.rootKey.partnerId !== normalizedPartnerId
        || (normalizedRootKeyId === undefined
          ? mutation.rootKey.rotatedFromRootKeyId !== null
          : mutation.rootKey.rotatedFromRootKeyId !== normalizedRootKeyId
            || mutation.rootKey.id === normalizedRootKeyId)
      ) throw new BackendContractErrorV1();
      return jsonResponse(backend.status, {
        schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
        ...mutation,
        ...(normalizedRootKeyId === undefined
          ? {}
          : { rotatedRootKeyId: normalizedRootKeyId }),
      });
    } catch (error) {
      return mappedError(error);
    }
  }
}

let productionBridge: PartnerAdminBridgeV1 | null = null;

export function getProductionPartnerAdminBridgeV1() {
  productionBridge ??= createPartnerAdminBridgeV1({
    authenticator: createPrivyWalletPrincipalAuthenticatorV1(),
    backendBaseUrl: requiredEnvironment("PROGRAMMABLE_CUSTOM_LAUNCH_API_BASE_URL"),
    websiteToken: requiredEnvironment("PROGRAMMABLE_CUSTOM_LAUNCH_WEBSITE_TOKEN"),
    bffAssertionKeyV2: requiredRawEnvironment(
      "PROGRAMMABLE_CUSTOM_LAUNCH_BFF_ASSERTION_KEY_V2",
    ),
    fetchBackend: fetch,
  });
  return productionBridge;
}

function parseCreateBody(value: JsonValue) {
  const record = exactBrowserRecord(value, [
    "schemaVersion",
    "walletAddress",
    "slug",
    "displayName",
    "publicUrl",
    "rootKeyLabel",
    "budgets",
    "expiresInDays",
  ]);
  requireBrowserSchema(record);
  if (typeof record.slug !== "string" || !SLUG.test(record.slug)) {
    throw new BrowserRequestErrorV1(400, "partner_slug_invalid");
  }
  return Object.freeze({
    walletAddress: requiredBrowserWallet(record.walletAddress),
    slug: record.slug,
    displayName: requiredLaunchPartnerName(record.displayName),
    publicUrl: requiredLaunchPartnerWebsite(record.publicUrl),
    rootKeyLabel: boundedBrowserText(record.rootKeyLabel, 1, 96),
    budgets: parseBrowserBudgets(record.budgets),
    expiresInDays: parseExpiryDays(record.expiresInDays),
  });
}

function parseStatusBody(value: JsonValue) {
  const record = exactBrowserRecord(value, [
    "schemaVersion",
    "walletAddress",
    "status",
  ]);
  requireBrowserSchema(record);
  if (record.status !== "active" && record.status !== "suspended") {
    throw new BrowserRequestErrorV1(400, "partner_status_invalid");
  }
  return Object.freeze({
    walletAddress: requiredBrowserWallet(record.walletAddress),
    status: record.status,
  });
}

function parseRootRequestBody(value: JsonValue) {
  const record = exactBrowserRecord(value, [
    "schemaVersion",
    "walletAddress",
    "label",
    "budgets",
    "expiresInDays",
  ]);
  requireBrowserSchema(record);
  return Object.freeze({
    walletAddress: requiredBrowserWallet(record.walletAddress),
    label: boundedBrowserText(record.label, 1, 96),
    budgets: parseBrowserBudgets(record.budgets),
    expiresInDays: parseExpiryDays(record.expiresInDays),
  });
}

function parseBrowserBudgets(value: JsonValue | undefined): PartnerBudgetsV1 {
  const record = exactBrowserRecord(value, [
    "prepareRequestsPerHour",
    "readRequestsPerMinute",
    "subkeyAdminRequestsPerHour",
  ]);
  const result = {
    prepareRequestsPerHour: record.prepareRequestsPerHour,
    readRequestsPerMinute: record.readRequestsPerMinute,
    subkeyAdminRequestsPerHour: record.subkeyAdminRequestsPerHour,
  };
  if (
    !Number.isSafeInteger(result.prepareRequestsPerHour)
    || Number(result.prepareRequestsPerHour) < 1
    || Number(result.prepareRequestsPerHour)
      > PARTNER_BUDGET_LIMITS_V1.prepareRequestsPerHour
    || !Number.isSafeInteger(result.readRequestsPerMinute)
    || Number(result.readRequestsPerMinute) < 1
    || Number(result.readRequestsPerMinute)
      > PARTNER_BUDGET_LIMITS_V1.readRequestsPerMinute
    || !Number.isSafeInteger(result.subkeyAdminRequestsPerHour)
    || Number(result.subkeyAdminRequestsPerHour) < 1
    || Number(result.subkeyAdminRequestsPerHour)
      > PARTNER_BUDGET_LIMITS_V1.subkeyAdminRequestsPerHour
  ) throw new BrowserRequestErrorV1(400, "partner_budgets_invalid");
  return Object.freeze({
    prepareRequestsPerHour: Number(result.prepareRequestsPerHour),
    readRequestsPerMinute: Number(result.readRequestsPerMinute),
    subkeyAdminRequestsPerHour: Number(result.subkeyAdminRequestsPerHour),
  });
}

function parseBackendPartnerMetadata(value: JsonValue | undefined) {
  const record = jsonRecord(value);
  const partnerId = requireBackendUuid(record.partnerId);
  return Object.freeze({
    id: partnerId,
    slug: requiredBackendString(record.slug, 1, 64),
    displayName: requiredBackendString(record.name, 1, 96),
    publicUrl: optionalBackendHttpsUrl(record.website),
    status: backendStatus(record.status),
    createdAt: requiredBackendTimestamp(record.createdAt),
    updatedAt: requiredBackendTimestamp(record.updatedAt),
    suspendedAt: optionalBackendTimestamp(record.suspendedAt),
    revokedAt: optionalBackendTimestamp(record.revokedAt),
  });
}

function parseBackendRootKey(
  value: JsonValue | undefined,
  expectedPartnerId?: string,
): PartnerRootKeySummaryV1 {
  const record = jsonRecord(value);
  const partnerId = requireBackendUuid(record.partnerId);
  const rootKeyId = requireBackendUuid(record.rootKeyId);
  const keyId = requiredBackendString(record.keyId, 22, 22);
  const normalized = parsePartnerRootKeySummaryV1({
    id: rootKeyId,
    partnerId,
    keyId,
    label: requiredBackendString(record.displayName, 1, 96),
    keyPrefix: `pm_partner_root_${keyId}`,
    scopes: record.scopes,
    budgets: record.budgets,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    lastUsedAt: record.lastUsedAt,
    revokedAt: record.revokedAt,
    rotatedFromRootKeyId: record.rotatedFromRootKeyId,
  });
  if (!normalized || (expectedPartnerId && normalized.partnerId !== expectedPartnerId)) {
    throw new BackendContractErrorV1();
  }
  return normalized;
}

function parseBackendRootMutation(
  value: JsonValue | undefined,
  status: number,
) {
  const record = jsonRecord(value);
  if (record.disposition !== "created" && record.disposition !== "replayed") {
    throw new BackendContractErrorV1();
  }
  const rootKey = parseBackendRootKey(record.credential);
  const secretState = record.secretState;
  const apiKey = record.apiKey;
  if (
    (secretState !== "delivered-once" && secretState !== "already-delivered")
    || (secretState === "delivered-once") !== (typeof apiKey === "string")
    || (secretState === "already-delivered" && apiKey !== null)
    || (record.disposition === "created") !== (secretState === "delivered-once")
    || (secretState === "delivered-once" && status !== 201)
    || (secretState === "already-delivered" && status !== 200)
  ) throw new BackendContractErrorV1();
  if (typeof apiKey === "string" && (
    !/^pm_partner_root_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{43}$/u.test(apiKey)
    || !apiKey.startsWith(`${rootKey.keyPrefix}_`)
  )) throw new BackendContractErrorV1();
  return Object.freeze({
    rootKey,
    secretState,
    ...(typeof apiKey === "string" ? { rootKeySecret: apiKey } : {}),
  });
}

function requireNormalizedPartner(value: unknown): PartnerSummaryV1 {
  const partner = parsePartnerSummaryV1(value);
  if (!partner) throw new BackendContractErrorV1();
  return partner;
}

function expiryFromDays(value: Date, days: number) {
  if (!Number.isFinite(value.getTime())) throw new TypeError("Partner admin clock is invalid");
  return new Date(value.getTime() + days * 86_400_000).toISOString();
}

function parseExpiryDays(value: JsonValue | undefined) {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > MAXIMUM_EXPIRY_DAYS) {
    throw new BrowserRequestErrorV1(400, "root_key_expiry_invalid");
  }
  return Number(value);
}

function requireBrowserSchema(record: Readonly<Record<string, JsonValue>>) {
  if (record.schemaVersion !== PARTNER_ADMIN_SCHEMA_V1) {
    throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  }
}

function exactBrowserRecord(value: JsonValue | undefined, keys: readonly string[]) {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== "object") {
    throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  }
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  }
  return value;
}

function boundedBrowserText(value: JsonValue | undefined, minimum: number, maximum: number) {
  if (
    typeof value !== "string"
    || value.length < minimum
    || value.length > maximum
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  return value;
}

function requiredLaunchPartnerName(value: JsonValue | undefined) {
  const parsed = parseLaunchPartnerNameV1(value);
  if (parsed === null) {
    throw new BrowserRequestErrorV1(400, "partner_name_invalid");
  }
  return parsed;
}

function requiredLaunchPartnerWebsite(value: JsonValue | undefined) {
  const parsed = parseLaunchPartnerWebsiteV1(value);
  if (parsed === null) {
    throw new BrowserRequestErrorV1(400, "partner_website_invalid");
  }
  return parsed;
}

function requiredBrowserWallet(value: JsonValue | undefined) {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new BrowserRequestErrorV1(400, "wallet_address_invalid");
  }
  return getAddress(value);
}

function exactWalletQuery(request: Request) {
  const entries = [...new URL(request.url).searchParams.entries()];
  if (entries.length !== 1 || entries[0]?.[0] !== "walletAddress" || !entries[0][1]) {
    throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  }
  return entries[0][1];
}

function partnerListQuery(request: Request) {
  const entries = [...new URL(request.url).searchParams.entries()];
  const allowed = new Set(["walletAddress", "page", "pageSize"]);
  if (
    entries.length < 1
    || entries.length > allowed.size
    || entries.some(([key]) => !allowed.has(key))
    || new Set(entries.map(([key]) => key)).size !== entries.length
  ) throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  const values = new Map(entries);
  const walletAddress = values.get("walletAddress");
  if (!walletAddress) {
    throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  }
  const page = boundedPositiveQueryInteger(
    values.get("page"),
    1,
    PARTNER_ADMIN_LIST_LIMITS_V1.maximumPartners,
  );
  const pageSize = boundedPositiveQueryInteger(
    values.get("pageSize"),
    PARTNER_ADMIN_LIST_LIMITS_V1.defaultPageSize,
    PARTNER_ADMIN_LIST_LIMITS_V1.maximumPageSize,
  );
  return Object.freeze({ walletAddress, page, pageSize });
}

function boundedPositiveQueryInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
) {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d{0,3}$/u.test(value)) {
    throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  }
  return parsed;
}

function requireLinkedWallet(principal: AuthenticatedWalletPrincipalV1, value: string) {
  if (!isAddress(value)) throw new BrowserRequestErrorV1(400, "wallet_address_invalid");
  const walletAddress = getAddress(value);
  if (!principal.wallets.some((wallet) =>
    wallet.toLowerCase() === walletAddress.toLowerCase())) {
    throw new BrowserRequestErrorV1(403, "wallet_not_linked");
  }
  if (!isWebsiteAdminWallet(walletAddress)) {
    throw new BrowserRequestErrorV1(403, "admin_wallet_required");
  }
  return walletAddress;
}

function requireIdempotencyKey(request: Request) {
  const value = request.headers.get("idempotency-key");
  if (!value || !IDEMPOTENCY_KEY.test(value)) {
    throw new BrowserRequestErrorV1(400, "INVALID_IDEMPOTENCY_KEY");
  }
  return value;
}

function requireBrowserUuid(value: string, code: string) {
  if (!UUID.test(value)) throw new BrowserRequestErrorV1(400, code);
  return value.toLowerCase();
}

async function readBrowserJson(request: Request): Promise<JsonValue> {
  const text = await boundedText(request, MAXIMUM_BROWSER_BODY_BYTES, () =>
    new BrowserRequestErrorV1(413, "request_too_large"));
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
  const text = await boundedText(response, MAXIMUM_BACKEND_BODY_BYTES, () =>
    new BackendContractErrorV1());
  try {
    return parseStrictJson(text, {
      maximumBytes: MAXIMUM_BACKEND_BODY_BYTES,
      maximumDepth: 14,
    });
  } catch {
    throw new BackendContractErrorV1();
  }
}

async function boundedText(
  input: Request | Response,
  maximumBytes: number,
  error: () => Error,
) {
  const declared = Number(input.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maximumBytes) {
    await input.body?.cancel().catch(() => undefined);
    throw error();
  }
  if (input.body === null) throw error();
  const reader = input.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw error();
      }
      chunks.push(Buffer.from(chunk.value));
    }
  } finally {
    reader.releaseLock();
  }
  if (totalBytes === 0) throw error();
  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

function jsonRecord(value: JsonValue | undefined): Readonly<Record<string, JsonValue>> {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== "object") {
    throw new BackendContractErrorV1();
  }
  return value;
}

function requireSchema(record: Readonly<Record<string, JsonValue>>, schema: string) {
  if (record.schemaVersion !== schema) throw new BackendContractErrorV1();
}

function requireBackendUuid(value: JsonValue | undefined) {
  if (typeof value !== "string" || !UUID.test(value)) throw new BackendContractErrorV1();
  return value.toLowerCase();
}

function requiredBackendString(value: JsonValue | undefined, minimum: number, maximum: number) {
  if (
    typeof value !== "string"
    || value.length < minimum
    || value.length > maximum
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) throw new BackendContractErrorV1();
  return value;
}

function requiredBackendTimestamp(value: JsonValue | undefined) {
  if (typeof value !== "string" || value.length < 20 || value.length > 40 || !Number.isFinite(Date.parse(value))) {
    throw new BackendContractErrorV1();
  }
  return value;
}

function optionalBackendTimestamp(value: JsonValue | undefined) {
  return value === null ? null : requiredBackendTimestamp(value);
}

function optionalBackendHttpsUrl(value: JsonValue | undefined) {
  return value === null ? null : requiredHttpsBackendUrl(value);
}

function requiredHttpsBackendUrl(value: JsonValue | undefined) {
  if (typeof value !== "string" || value.length > 2_048) throw new BackendContractErrorV1();
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || !url.hostname
      || url.hash
      || url.href !== value
    ) throw new Error("invalid");
    return value;
  } catch {
    throw new BackendContractErrorV1();
  }
}

function backendStatus(value: JsonValue | undefined) {
  if (value !== "active" && value !== "suspended" && value !== "revoked") {
    throw new BackendContractErrorV1();
  }
  return value;
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

function boundedSecret(value: string, label: string) {
  if (
    typeof value !== "string"
    || value.length < 43
    || value.length > 512
    || /[\s\u0000]/u.test(value)
  ) throw new TypeError(`Partner admin ${label} is invalid`);
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
  const preserved = await readPreservedBackendPublicErrorV1(response);
  return preserved ?? new BackendContractErrorV1();
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
  console.error("Partner admin request failed", {
    name: error instanceof Error ? error.name : "PartnerAdminError",
    requestId,
  });
  return errorResponse(
    503,
    "partner_admin_service_unavailable",
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
    schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
    error: Object.freeze({
      code,
      message: publicMessage ?? (status >= 500
        ? "Partner access is temporarily unavailable."
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
    super("partner_admin_backend_contract_invalid");
    this.name = "BackendContractErrorV1";
  }
}
