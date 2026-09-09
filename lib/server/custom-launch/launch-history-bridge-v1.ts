import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";

import { getAddress, isAddress } from "viem";

import {
  parseCustomLaunchRemediationV1,
  parseCustomLaunchWalletHandoffV1,
  parseSourceVerificationStatusV1,
  type CustomLaunchLiquidityIntentV3,
  type CustomLaunchRemediationV1,
  type SourceVerificationStatusV1,
} from "../../custom-launch/developer-launch-truth-v1";
import { canonicalizeJson, parseStrictJson, type JsonValue } from
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

export const CUSTOM_LAUNCH_LIST_SCHEMA_V1 =
  "programmable.custom-launch-list.v1" as const;
export const CUSTOM_LAUNCH_LIST_SCHEMA_V2 =
  "programmable.custom-launch-list.v2" as const;
export const CUSTOM_LAUNCH_LIST_SCHEMA_V3 =
  "programmable.custom-launch-list.v3" as const;
export const CUSTOM_LAUNCH_LIST_SCHEMA_V4 =
  "programmable.custom-launch-list.v4" as const;
export const CUSTOM_LAUNCH_HISTORY_SCHEMA_V1 =
  "programmable.custom-launch-history.v1" as const;
export const CUSTOM_LAUNCH_SUMMARY_SCHEMA_V4 =
  "programmable.custom-launch-summary.v4" as const;
export const CUSTOM_LAUNCH_SUBMISSION_HINT_SCHEMA_V1 =
  "programmable.custom-launch-submission-hint.v1" as const;

// Wallet-admin lists are deliberately compact (`output: null`). A single
// authorized resource carries the exact graph transaction and can exceed
// 128 KiB because initcode is bound in both the artifact and calldata.
const MAXIMUM_BACKEND_LIST_BODY_BYTES = 262_144;
const MAXIMUM_BACKEND_RESOURCE_BODY_BYTES = 8_388_608;
const MAXIMUM_BACKEND_V4_BODY_BYTES = 16_777_216;
// Complete protected vNext resources are bounded to 64 MiB; reserve one MiB
// for the signed history/page envelope without truncating source or evidence.
const MAXIMUM_BACKEND_PLAN_BODY_BYTES = 65 * 1024 * 1024;
const MAXIMUM_BROWSER_FUNDING_BODY_BYTES = 1_024;
const DEFAULT_BACKEND_TIMEOUT_MS = 5_000;
const DEFAULT_PAGE_SIZE = 5;
const MAXIMUM_PAGE_SIZE = 10;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const REQUEST_HASH = /^sha256:[0-9a-f]{64}$/u;
const PROJECT_METADATA_HASH_DOMAIN = "programmable.project-metadata.v1";
const PROJECT_GRAPH_METADATA_HASH_DOMAIN =
  "programmable.custom-graph-project-metadata.v1";
const PROJECT_TARGET_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/u;
const IPFS_CID = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|[bB][a-zA-Z2-7]{31,127})$/u;
const ARWEAVE_TRANSACTION_ID = /^[A-Za-z0-9_-]{43}$/u;
const UNSAFE_PROJECT_TEXT =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const SENSITIVE_QUERY_KEY =
  /(?:^|[_-])(?:api[_-]?key|token|secret|password|passwd|signature|sig|credential|authorization|auth)(?:$|[_-])/iu;
const SECRET_PATTERNS = Object.freeze([
  /(?:^|[^A-Za-z0-9_-])pm_live_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{43}(?=$|[^A-Za-z0-9_-])/u,
  /(?:^|[^A-Za-z0-9_])PROGRAMMABLE_API_KEY\s*[:=]\s*["']?[^\s"'&?#]{8,}/iu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/iu,
  /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/u,
  /\b(?:sk|rk|pk)-(?:live|test)?[_-]?[A-Za-z0-9_-]{20,}\b/iu,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
  /\b(?:api[_-]?key|access[_-]?token|authorization|password|passwd|secret|private[_-]?key)\b\s*[:=]\s*["']?[^\s"']{8,}/iu,
] as const);
const STATUSES_V1 = new Set([
  "received",
  "validating",
  "prepared",
  "authorized",
  "submitted",
  "finalized",
  "failed",
  "cancelled",
]);
const STATUSES_V2 = new Set([...STATUSES_V1, "simulating"]);
const STATUSES_V3 = new Set([
  ...STATUSES_V2,
  "pending_review",
  "action_required",
  "awaiting_funding_authorization",
  "funding_authorization_verified",
]);
const FUNDING_SIGNATURE_SCHEMA_V1 =
  "programmable.custom-launch-funding-authorization-signature.v1" as const;
const LOWER_BYTES32 = /^0x[0-9a-f]{64}$/u;
const LOWER_SIGNATURE = /^0x[0-9a-f]{130}$/u;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,128}$/u;
const RESPONSE_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  Vary: "Authorization, X-Privy-Identity-Token",
});

export type DeveloperCustomLaunchV1 = Readonly<{
  schemaVersion: "programmable.custom-launch.v1";
  launchId: string;
  requestId: string;
  onchainLaunchId: `0x${string}` | null;
  routeId: "custom-launch:create:v1";
  ownerWallet: `0x${string}`;
  status: string;
  requestHash: string;
  createdAt: string;
  updatedAt: string;
  output: Readonly<Record<string, JsonValue>> | null;
  failure: DeveloperCustomLaunchFailureV1 | null;
  sourceVerification?: SourceVerificationStatusV1;
}>;

type DeveloperCustomLaunchFailureV1 = Readonly<{
  code: string;
  message: string;
  retryable: boolean;
  remediations?: readonly CustomLaunchRemediationV1[];
}>;

export type DeveloperCustomLaunchV2 = Readonly<{
  schemaVersion: "programmable.custom-launch.v2";
  launchId: string;
  requestId: string;
  onchainLaunchId: `0x${string}` | null;
  routeId: "custom-launch:create:v2";
  ownerWallet: `0x${string}`;
  status: string;
  requestHash: string;
  launchProfileHash: `sha256:${string}`;
  launchIntentHash: `sha256:${string}`;
  createdAt: string;
  updatedAt: string;
  output: Readonly<Record<string, JsonValue>> | null;
  failure: DeveloperCustomLaunchV1["failure"];
  sourceVerification?: SourceVerificationStatusV1;
}>;

export type DeveloperCustomLaunchV3 = Readonly<{
  schemaVersion: "programmable.custom-launch.v3";
  launchId: string;
  requestId: string;
  onchainLaunchId: `0x${string}` | null;
  routeId: "custom-launch:create:v3";
  ownerWallet: `0x${string}`;
  status: string;
  requestHash: string;
  launchProfileVersion:
    | "2.0.0"
    | "3.0.0"
    | "3.1.0"
    | "3.2.0"
    | "3.3.0"
    | "3.4.0";
  launchProfileHash: `sha256:${string}`;
  launchIntentHash: `sha256:${string}`;
  projectMetadata: DeveloperCustomLaunchProjectMetadataV1 | null;
  projectMetadataHash: `sha256:${string}` | null;
  fundingIntentHash: `0x${string}` | null;
  liquidityIntent: CustomLaunchLiquidityIntentV3;
  walletHandoffUrl?: string | null;
  expiresAt?: string | null;
  secondsRemaining?: number | null;
  createdAt: string;
  updatedAt: string;
  output: Readonly<Record<string, JsonValue>> | null;
  failure: DeveloperCustomLaunchV1["failure"];
  sourceVerification?: SourceVerificationStatusV1;
}>;

export type DeveloperCustomLaunchV4 = Readonly<{
  schemaVersion: "programmable.custom-launch.v4";
  apiVersion: "v4";
  launchId: string;
  requestId: string;
  routeId: "custom-launch:create:v4";
  chainId: "4663";
  caip2: "eip155:4663";
  controller: Readonly<{ namespace: "eip155:4663"; address: `0x${string}` }>;
  status: string;
  requestHash: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: JsonValue;
}>;

export type DeveloperCustomLaunchSummaryV4 = Readonly<{
  schemaVersion: typeof CUSTOM_LAUNCH_SUMMARY_SCHEMA_V4;
  apiVersion: "v4";
  launchId: string;
  requestId: string;
  routeId: "custom-launch:create:v4";
  chainId: "4663";
  caip2: "eip155:4663";
  chainDeploymentId: "robinhood-mainnet-custom-launch-v1";
  chainDeploymentDescriptorDigest: `0x${string}`;
  controller: Readonly<{ namespace: "eip155:4663"; address: `0x${string}` }>;
  status: string;
  walletHandoffUrl: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type DeveloperCustomLaunchProjectMetadataV1 = Readonly<{
  schemaVersion: "programmable.project-metadata.v1";
  token: Readonly<{ name: string; symbol: string }>;
  presentation: Readonly<{
    schemaVersion: "programmable.launch-presentation-draft.v1";
    description: string;
    image: Readonly<{
      uri: string;
      contentSha256: `sha256:${string}`;
      mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
      byteLength: number;
      width: number;
      height: number;
    }> | null;
    links: readonly Readonly<{
      kind: "website" | "documentation" | "x" | "telegram" | "discord" | "github" | "other";
      uri: string;
    }>[];
  }>;
  tokenMetadataBinding: Readonly<{
    schemaVersion: "programmable.project-token-metadata-binding.v1";
    tokenTargetId: string;
    declarationBinding: "request-and-launch-id";
    standardReadModel: Readonly<{ name: boolean; symbol: boolean }>;
    name: DeveloperProjectTokenMetadataFieldBindingV1;
    symbol: DeveloperProjectTokenMetadataFieldBindingV1;
    postDeploymentReadback: "required";
  }>;
}>;

type DeveloperProjectTokenMetadataFieldBindingV1 = Readonly<{
  staticSource:
    | "constructor-argument"
    | "initializer-argument"
    | "not-deterministically-extractable";
  argumentIndex: number | null;
  argumentName: string | null;
}>;

type DeveloperCustomLaunch = DeveloperCustomLaunchV1
  | DeveloperCustomLaunchV2
  | DeveloperCustomLaunchV3
  | DeveloperCustomLaunchV4
  | DeveloperCustomLaunchSummaryV4;
type BackendHistoryVersion = "v1" | "v2" | "v3" | "v4";

export interface DeveloperLaunchHistoryBridgeV1 {
  universal(request: Request, launchId?: string, stepId?: string, transactionHint?: "v2" | "v3"): Promise<Response>;
  list(request: Request): Promise<Response>;
  get(request: Request, launchId: string): Promise<Response>;
  submitFundingAuthorization(
    request: Request,
    launchId: string,
  ): Promise<Response>;
  submitV4SubmissionHint(
    request: Request,
    launchId: string,
  ): Promise<Response>;
  getV4Capabilities(request: Request): Promise<Response>;
}

export type DeveloperLaunchHistoryBackendFetchV1 = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function createDeveloperLaunchHistoryBridgeV1(input: Readonly<{
  authenticator: WalletPrincipalAuthenticatorV1;
  backendBaseUrl: string;
  websiteToken: string;
  bffAssertionKeyV2: string;
  fetchBackend: DeveloperLaunchHistoryBackendFetchV1;
  backendTimeoutMs?: number;
  assertionNow?: () => Date;
  assertionNonce?: () => string;
}>): DeveloperLaunchHistoryBridgeV1 {
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
  ) throw new TypeError("Developer launch history bridge configuration is invalid");

  const walletAdminHeaders = (
    principal: AuthenticatedWalletPrincipalV1,
    walletAddress: `0x${string}`,
    method: "GET" | "POST",
    backendUrl: URL,
    bodyBytes: Buffer,
    idempotencyKey?: string,
  ) => {
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
    return new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${websiteToken}`,
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      "X-Programmable-Privy-User-Id": principal.privyUserId,
      "X-Programmable-Wallet-Address": walletAddress,
      ...assertion,
    });
  };

  return Object.freeze({
    async universal(request: Request, launchId?: string, stepId?: string, transactionHint?: "v2" | "v3") {
      try {
        requireJsonResponse(request);
        if (transactionHint !== undefined && transactionHint !== "v2" && transactionHint !== "v3") throw new BrowserRequestErrorV1(400, "request_schema_invalid");
        const write = Boolean(stepId || transactionHint);
        if (request.method !== (write ? "POST" : "GET")) return errorResponse(405, "method_not_allowed", write ? "POST" : "GET");
        const search = new URL(request.url).searchParams;
        if ([...search.keys()].some(key => !["walletAddress", "source", "cursor"].includes(key) || search.getAll(key).length !== 1)) throw new BrowserRequestErrorV1(400, "request_schema_invalid");
        const source = search.get("source");
        if (source !== "custom_launch_plan_v1" && source !== "multi_role_v2") throw new BrowserRequestErrorV1(400, "request_schema_invalid");
        if (launchId && !UUID.test(launchId) || stepId && !/^[A-Za-z0-9._:-]{1,128}$/.test(stepId)) throw new BrowserRequestErrorV1(404, "launch_not_found");
        if (stepId && source !== "custom_launch_plan_v1" || transactionHint && (source !== "multi_role_v2" || !launchId || stepId) || launchId && search.has("cursor")) throw new BrowserRequestErrorV1(400, "request_schema_invalid");
        const principal = await input.authenticator.authenticate(request);
        const controller = requireLinkedWallet(principal, search.get("walletAddress") ?? "");
        const lane = source === "custom_launch_plan_v1" ? "custom-launch-plans" : "custom-launches-multi-role";
        const hintPath = transactionHint === "v3" ? "/transaction-hints-v3" : "/transaction-hints";
        const suffix = launchId ? `/${encodeURIComponent(launchId)}${stepId ? `/steps/${encodeURIComponent(stepId)}/proofs` : transactionHint ? hintPath : ""}` : "";
        const url = new URL(`/v4/chains/4663/wallet-admin/${lane}${suffix}`, backendBaseUrl);
        if (!launchId) {
          // Plans contain the exact source bundle and owner evidence. Page one complete resource at a time.
          url.searchParams.set("limit", source === "custom_launch_plan_v1" ? "1" : "5");
          const cursor = search.get("cursor");
          if (cursor) {
            if (cursor.length > 4096 || /[\u0000-\u001f]/.test(cursor)) throw new BrowserRequestErrorV1(400, "pagination_invalid");
            url.searchParams.set("cursor", cursor);
          }
        }
        let body = Buffer.alloc(0);
        if (write) {
          requireJsonRequest(request);
          const value = jsonRecord(await readBoundedBrowserJson(request));
          if (Object.keys(value).length !== 2 || value.schemaVersion !== (transactionHint ? `programmable.multi-role-transaction-hint.${transactionHint}` : "programmable.custom-launch-plan-step-proof.v1")
            || typeof value.transactionHash !== "string" || !LOWER_BYTES32.test(value.transactionHash)) throw new BrowserRequestErrorV1(400, "request_schema_invalid");
          body = Buffer.from(JSON.stringify(value));
        }
        const method = write ? "POST" as const : "GET" as const;
        const backend = await input.fetchBackend(url, { method,
          headers: walletAdminHeaders(principal, controller, method, url, body),
          ...(write ? { body } : {}), cache: "no-store", redirect: "error",
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]) });
        if (!backend.ok) return mappedBackendError(backend).then(mappedError);
        const resource = jsonRecord(await readBoundedBackendJson(backend, source === "custom_launch_plan_v1" ? MAXIMUM_BACKEND_PLAN_BODY_BYTES : MAXIMUM_BACKEND_V4_BODY_BYTES));
        if (write) return jsonResponse(backend.status, resource);
        const resources = launchId ? [resource] : source === "custom_launch_plan_v1" ? resource.plans : resource.launches;
        if (!Array.isArray(resources) || resources.length > (launchId ? 1 : 5)) throw new BackendContractErrorV1();
        const entries = resources.map(candidate => {
          const item = jsonRecord(candidate);
          const id = source === "custom_launch_plan_v1" ? item.planId : item.launchId;
          if (typeof id !== "string" || !UUID.test(id) || launchId && id !== launchId
            || item.schemaVersion !== (source === "custom_launch_plan_v1" ? "programmable.custom-launch-plan-resource.v1" : "programmable.multi-role-custom-launch-resource.v2")) throw new BackendContractErrorV1();
          if (source === "custom_launch_plan_v1") {
            const plan = jsonRecord(item.plan);
            const owner = jsonRecord(plan.controller);
            if (plan.chainId !== "4663" || typeof owner.address !== "string" || owner.address.toLowerCase() !== controller.toLowerCase()) throw new BackendContractErrorV1();
          } else {
            const context = jsonRecord(item.context);
            if (context.chainId !== "4663") throw new BackendContractErrorV1();
          }
          // The signed wallet-admin route authenticated the original controller even before preparation.
          return { sourceVersion: source, controller, resource: item };
        });
        if (!launchId && !(resource.nextCursor === null || typeof resource.nextCursor === "string" && resource.nextCursor.length <= 4096)) throw new BackendContractErrorV1();
        return jsonResponse(200, { schemaVersion: "programmable.website-launch-history.v1", launches: entries,
          nextCursor: launchId ? null : resource.nextCursor });
      } catch (error) { return mappedError(error); }
    },
    async list(request: Request) {
      if (request.method !== "GET") {
        return errorResponse(405, "method_not_allowed", "GET");
      }
      try {
        requireJsonResponse(request);
        const query = exactHistoryQuery(request);
        const principal = await input.authenticator.authenticate(request);
        const walletAddress = requireLinkedWallet(principal, query.walletAddress);
        const expectedWallet = walletAddress.toLowerCase();
        const readVersion = async (version: BackendHistoryVersion) => {
          const cursorState = query.cursor?.[version];
          if (cursorState?.done) {
            return Object.freeze({
              version,
              launches: Object.freeze([] as DeveloperCustomLaunch[]),
              nextCursor: null,
              done: true,
            });
          }
          const backendUrl = new URL(
            version === "v4"
              ? "/v4/chains/4663/wallet-admin/custom-launches"
              : `/${version}/wallet-admin/custom-launches`,
            backendBaseUrl,
          );
          backendUrl.searchParams.set("limit", String(query.limit));
          if (cursorState?.cursor) {
            backendUrl.searchParams.set("cursor", cursorState.cursor);
          }
          const backend = await input.fetchBackend(backendUrl, {
            method: "GET",
            headers: walletAdminHeaders(
              principal,
              walletAddress,
              "GET",
              backendUrl,
              Buffer.alloc(0),
            ),
            cache: "no-store",
            redirect: "error",
            signal: AbortSignal.any([
              request.signal,
              AbortSignal.timeout(timeoutMs),
            ]),
          });
          // During route-isolated rollouts, a missing additive list is an
          // empty lane. Earlier history must remain available independently.
          if (version !== "v1" && backend.status === 404) {
            return Object.freeze({
              version,
              launches: Object.freeze([] as DeveloperCustomLaunch[]),
              nextCursor: null,
              done: true,
            });
          }
          if (version === "v3" && backend.status === 503) {
            const pending = await readPreservedBackendPublicErrorV1(
              backend.clone(),
            );
            if (
              pending?.code === "CUSTOM_LAUNCH_V3_INTEGRATION_PENDING"
              && pending.retryAfter === "30"
            ) {
              return Object.freeze({
                version,
                launches: Object.freeze([] as DeveloperCustomLaunch[]),
                nextCursor: null,
                done: true,
              });
            }
          }
          if (!backend.ok) throw await mappedBackendError(backend);
          const record = jsonRecord(await readBoundedBackendJson(
            backend,
            version === "v4"
              ? MAXIMUM_BACKEND_V4_BODY_BYTES
              : MAXIMUM_BACKEND_LIST_BODY_BYTES,
          ));
          const expectedSchema = version === "v1"
            ? CUSTOM_LAUNCH_LIST_SCHEMA_V1
            : version === "v2"
              ? CUSTOM_LAUNCH_LIST_SCHEMA_V2
              : version === "v3"
                ? CUSTOM_LAUNCH_LIST_SCHEMA_V3
                : CUSTOM_LAUNCH_LIST_SCHEMA_V4;
          if (version === "v4") {
            exactProjectKeys(record, [
              "schemaVersion", "apiVersion", "chainId", "chainDeploymentId",
              "launches", "nextCursor",
            ]);
          }
          if (
            record.schemaVersion !== expectedSchema ||
            (version === "v4" && (
              record.apiVersion !== "v4"
              || record.chainId !== "4663"
              || record.chainDeploymentId !== "robinhood-mainnet-custom-launch-v1"
            )) ||
            !Array.isArray(record.launches) ||
            record.launches.length > query.limit
          ) throw new BackendContractErrorV1();
          const launches = Object.freeze(record.launches.map((launch) =>
            version === "v4"
              ? parseLaunchSummaryV4(launch, expectedWallet)
              : parseLaunch(launch, expectedWallet, version, {
                  requireAuthorizedArtifactBinding: false,
                })
          ));
          const nextCursor = record.nextCursor === null
            ? null
            : canonicalCursor(record.nextCursor, "backend");
          return Object.freeze({
            version,
            launches,
            nextCursor,
            done: nextCursor === null,
          });
        };
        const [v1, v2, v3, v4] = await Promise.all([
          readVersion("v1"),
          readVersion("v2"),
          readVersion("v3"),
          readVersion("v4"),
        ]);
        const launches = Object.freeze([
          ...v1.launches,
          ...v2.launches,
          ...v3.launches,
          ...v4.launches,
        ]
          .sort(compareLaunchHistoryEntries));
        const nextCursor = v1.done && v2.done && v3.done && v4.done
          ? null
          : encodeCombinedHistoryCursor({ v1, v2, v3, v4 });
        return jsonResponse(200, {
          schemaVersion: CUSTOM_LAUNCH_HISTORY_SCHEMA_V1,
          launches,
          nextCursor,
        });
      } catch (error) {
        return mappedError(error);
      }
    },

    async get(request: Request, launchId: string) {
      if (request.method !== "GET") {
        return errorResponse(405, "method_not_allowed", "GET");
      }
      try {
        requireJsonResponse(request);
        if (!UUID.test(launchId)) {
          throw new BrowserRequestErrorV1(404, "launch_not_found");
        }
        const walletInput = exactWalletQuery(request);
        const principal = await input.authenticator.authenticate(request);
        const walletAddress = requireLinkedWallet(
          principal,
          walletInput.walletAddress,
        );
        const readVersion = async (version: BackendHistoryVersion) => {
          const backendUrl = new URL(
            version === "v4"
              ? `/v4/chains/4663/wallet-admin/custom-launches/${
                  encodeURIComponent(launchId.toLowerCase())
                }`
              : `/${version}/wallet-admin/custom-launches/${
                  encodeURIComponent(launchId.toLowerCase())
                }`,
            backendBaseUrl,
          );
          const backend = await input.fetchBackend(backendUrl, {
            method: "GET",
            headers: walletAdminHeaders(
              principal,
              walletAddress,
              "GET",
              backendUrl,
              Buffer.alloc(0),
            ),
            cache: "no-store",
            redirect: "error",
            signal: AbortSignal.any([
              request.signal,
              AbortSignal.timeout(timeoutMs),
            ]),
          });
          if (backend.status === 404) return null;
          if (!backend.ok) throw await mappedBackendError(backend);
          const resource = await readBoundedBackendJson(
            backend,
            version === "v4"
              ? MAXIMUM_BACKEND_V4_BODY_BYTES
              : MAXIMUM_BACKEND_RESOURCE_BODY_BYTES,
          );
          return version === "v4"
            ? parseLaunchV4(resource, walletAddress.toLowerCase())
            : parseLaunch(
                resource,
                walletAddress.toLowerCase(),
                version,
                { requireAuthorizedArtifactBinding: true },
              );
        };
        let launch: DeveloperCustomLaunch | null = null;
        if (walletInput.version) {
          launch = await readVersion(walletInput.version);
        } else {
          launch = await readVersion("v1")
            ?? await readVersion("v2")
            ?? await readVersion("v3")
            ?? await readVersion("v4");
        }
        if (!launch) throw new BrowserRequestErrorV1(404, "launch_not_found");
        const resourceId = launch.routeId === "custom-launch:create:v4"
          ? launch.launchId
          : launch.requestId;
        if (resourceId !== launchId.toLowerCase()) {
          throw new BackendContractErrorV1();
        }
        return jsonResponse(200, { ...launch });
      } catch (error) {
        return mappedError(error);
      }
    },

    async submitFundingAuthorization(request: Request, launchId: string) {
      if (request.method !== "POST") {
        return errorResponse(405, "method_not_allowed", "POST");
      }
      try {
        requireJsonRequest(request);
        if (!UUID.test(launchId)) {
          throw new BrowserRequestErrorV1(404, "launch_not_found");
        }
        const walletInput = exactWalletQuery(request);
        if (walletInput.version !== "v3") {
          throw new BrowserRequestErrorV1(400, "request_schema_invalid");
        }
        const body = parseFundingSignatureSubmission(
          await readBoundedBrowserJson(request),
        );
        const idempotencyKey = request.headers.get("idempotency-key");
        if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
          throw new BrowserRequestErrorV1(400, "idempotency_key_invalid");
        }
        const principal = await input.authenticator.authenticate(request);
        const walletAddress = requireLinkedWallet(
          principal,
          walletInput.walletAddress,
        );
        const backendUrl = new URL(
          `/v3/wallet-admin/custom-launches/${
            encodeURIComponent(launchId.toLowerCase())
          }/funding-authorization`,
          backendBaseUrl,
        );
        const bodyBytes = Buffer.from(JSON.stringify(body), "utf8");
        const backend = await input.fetchBackend(backendUrl, {
          method: "POST",
          headers: walletAdminHeaders(
            principal,
            walletAddress,
            "POST",
            backendUrl,
            bodyBytes,
            idempotencyKey,
          ),
          body: bodyBytes,
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.any([
            request.signal,
            AbortSignal.timeout(timeoutMs),
          ]),
        });
        if (!backend.ok) throw await mappedBackendError(backend);
        if (backend.status !== 200 && backend.status !== 202) {
          throw new BackendContractErrorV1();
        }
        const launch = parseLaunch(
          await readBoundedBackendJson(
            backend,
            MAXIMUM_BACKEND_RESOURCE_BODY_BYTES,
          ),
          walletAddress.toLowerCase(),
          "v3",
          { requireAuthorizedArtifactBinding: true },
        );
        if (launch.requestId !== launchId.toLowerCase()) {
          throw new BackendContractErrorV1();
        }
        return jsonResponse(backend.status, { ...launch });
      } catch (error) {
        return mappedError(error);
      }
    },

    async submitV4SubmissionHint(request: Request, launchId: string) {
      if (request.method !== "POST") {
        return errorResponse(405, "method_not_allowed", "POST");
      }
      try {
        requireJsonRequest(request);
        if (!UUID.test(launchId)) {
          throw new BrowserRequestErrorV1(404, "launch_not_found");
        }
        const walletInput = exactWalletQuery(request);
        if (walletInput.version !== "v4") {
          throw new BrowserRequestErrorV1(400, "request_schema_invalid");
        }
        const body = parseV4SubmissionHint(await readBoundedBrowserJson(request));
        const principal = await input.authenticator.authenticate(request);
        const walletAddress = requireLinkedWallet(
          principal,
          walletInput.walletAddress,
        );
        const backendUrl = new URL(
          `/v4/chains/4663/wallet-admin/custom-launches/${
            encodeURIComponent(launchId.toLowerCase())
          }/submission-hint`,
          backendBaseUrl,
        );
        const bodyBytes = Buffer.from(JSON.stringify(body), "utf8");
        const backend = await input.fetchBackend(backendUrl, {
          method: "POST",
          headers: walletAdminHeaders(
            principal,
            walletAddress,
            "POST",
            backendUrl,
            bodyBytes,
          ),
          body: bodyBytes,
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.any([
            request.signal,
            AbortSignal.timeout(timeoutMs),
          ]),
        });
        if (!backend.ok) throw await mappedBackendError(backend);
        if (backend.status !== 202) throw new BackendContractErrorV1();
        const response = parseV4SubmissionHintResponse(
          await readBoundedBackendJson(backend, 4_096),
          launchId.toLowerCase(),
          body.transactionHash,
        );
        return jsonResponse(202, response);
      } catch (error) {
        return mappedError(error);
      }
    },

    async getV4Capabilities(request: Request) {
      if (request.method !== "GET") {
        return errorResponse(405, "method_not_allowed", "GET");
      }
      try {
        requireJsonResponse(request);
        const backendUrl = new URL(
          "/v4/chains/4663/capabilities",
          backendBaseUrl,
        );
        const backend = await input.fetchBackend(backendUrl, {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.any([
            request.signal,
            AbortSignal.timeout(timeoutMs),
          ]),
        });
        if (!backend.ok) throw await mappedBackendError(backend);
        const capabilities = jsonRecord(await readBoundedBackendJson(
          backend,
          2_097_152,
        ));
        if (capabilities.schemaVersion
            !== "programmable.custom-launch-capabilities.v2"
          || capabilities.apiVersion !== "v4"
          || jsonRecord(capabilities.chain).id !== "4663"
          || jsonRecord(capabilities.chain).caip2 !== "eip155:4663") {
          throw new BackendContractErrorV1();
        }
        return jsonResponse(200, capabilities);
      } catch (error) {
        return mappedError(error);
      }
    },
  });
}

let productionBridge: DeveloperLaunchHistoryBridgeV1 | null = null;

export function getProductionDeveloperLaunchHistoryBridgeV1() {
  productionBridge ??= createDeveloperLaunchHistoryBridgeV1({
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

function exactHistoryQuery(request: Request) {
  const search = new URL(request.url).searchParams;
  for (const key of search.keys()) {
    if (key !== "walletAddress" && key !== "limit" && key !== "cursor") {
      throw new BrowserRequestErrorV1(400, "request_schema_invalid");
    }
    if (search.getAll(key).length !== 1) {
      throw new BrowserRequestErrorV1(400, "request_schema_invalid");
    }
  }
  const walletAddress = search.get("walletAddress");
  if (walletAddress === null) {
    throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  }
  const limitValue = search.get("limit");
  const limit = limitValue === null
    ? DEFAULT_PAGE_SIZE
    : parsePageSize(limitValue);
  const cursorValue = search.get("cursor");
  return Object.freeze({
    walletAddress,
    limit,
    cursor: cursorValue === null
      ? null
      : parseCombinedHistoryCursor(cursorValue),
  });
}

function exactWalletQuery(request: Request) {
  const search = new URL(request.url).searchParams;
  for (const key of search.keys()) {
    if (key !== "walletAddress" && key !== "version") {
      throw new BrowserRequestErrorV1(400, "request_schema_invalid");
    }
    if (search.getAll(key).length !== 1) {
      throw new BrowserRequestErrorV1(400, "request_schema_invalid");
    }
  }
  const walletAddress = search.get("walletAddress");
  const versionValue = search.get("version");
  if (
    !walletAddress ||
    (versionValue !== null
      && versionValue !== "v1"
      && versionValue !== "v2"
      && versionValue !== "v3"
      && versionValue !== "v4")
  ) throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  return Object.freeze({
    walletAddress,
    version: versionValue as BackendHistoryVersion | null,
  });
}

function parsePageSize(value: string) {
  if (!/^[1-9][0-9]?$/u.test(value)) {
    throw new BrowserRequestErrorV1(400, "pagination_invalid");
  }
  const parsed = Number(value);
  if (parsed > MAXIMUM_PAGE_SIZE) {
    throw new BrowserRequestErrorV1(400, "pagination_invalid");
  }
  return parsed;
}

type CombinedHistoryCursorLane = Readonly<{
  cursor: string | null;
  done: boolean;
}>;

type CombinedHistoryCursor = Readonly<{
  v1: CombinedHistoryCursorLane;
  v2: CombinedHistoryCursorLane;
  v3: CombinedHistoryCursorLane;
  v4: CombinedHistoryCursorLane;
}>;

function parseCombinedHistoryCursor(value: string): CombinedHistoryCursor {
  const invalid = () => {
    throw new BrowserRequestErrorV1(400, "pagination_invalid");
  };
  if (
    value.length < 16 ||
    value.length > 2_048 ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) return invalid();
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) return invalid();
    const decoded = parseStrictJson(bytes.toString("utf8"), {
      maximumBytes: 2_048,
      maximumDepth: 4,
    });
    if (decoded === null || Array.isArray(decoded) || typeof decoded !== "object") {
      return invalid();
    }
    // One-release compatibility for a browser that still holds the old V1
    // backend cursor. V2 starts at its first bounded page and dedupes by route.
    if ("createdAt" in decoded || "launchId" in decoded) {
      const legacy = canonicalCursor(value, "browser");
      return Object.freeze({
        v1: Object.freeze({ cursor: legacy, done: false }),
        v2: Object.freeze({ cursor: null, done: false }),
        v3: Object.freeze({ cursor: null, done: false }),
        v4: Object.freeze({ cursor: null, done: false }),
      });
    }
    const decodedKeys = Object.keys(decoded);
    const twoLaneCursor = decodedKeys.length === 2
      && "v1" in decoded
      && "v2" in decoded;
    const threeLaneCursor = decodedKeys.length === 3
      && "v1" in decoded
      && "v2" in decoded
      && "v3" in decoded;
    const fourLaneCursor = decodedKeys.length === 4
      && "v1" in decoded
      && "v2" in decoded
      && "v3" in decoded
      && "v4" in decoded;
    if (!twoLaneCursor && !threeLaneCursor && !fourLaneCursor) return invalid();
    const lane = (candidate: JsonValue | undefined) => {
      if (
        candidate === null ||
        candidate === undefined ||
        Array.isArray(candidate) ||
        typeof candidate !== "object" ||
        Object.keys(candidate).length !== 2 ||
        typeof candidate.done !== "boolean" ||
        (candidate.cursor !== null && typeof candidate.cursor !== "string") ||
        (candidate.done && candidate.cursor !== null) ||
        (!candidate.done && candidate.cursor === null)
      ) return invalid();
      return Object.freeze({
        cursor: candidate.cursor === null
          ? null
          : canonicalCursor(candidate.cursor, "browser"),
        done: candidate.done,
      });
    };
    const result = Object.freeze({
      v1: lane(decoded.v1),
      v2: lane(decoded.v2),
      v3: threeLaneCursor
        || fourLaneCursor
        ? lane(decoded.v3)
        : Object.freeze({ cursor: null, done: false }),
      v4: fourLaneCursor
        ? lane(decoded.v4)
        : Object.freeze({ cursor: null, done: false }),
    });
    if (result.v1.done && result.v2.done && result.v3.done && result.v4.done) {
      return invalid();
    }
    const canonicalValue = twoLaneCursor
      ? Object.freeze({ v1: result.v1, v2: result.v2 })
      : threeLaneCursor
        ? Object.freeze({ v1: result.v1, v2: result.v2, v3: result.v3 })
        : result;
    const canonical = Buffer.from(JSON.stringify(canonicalValue), "utf8")
      .toString("base64url");
    if (canonical !== value) return invalid();
    return result;
  } catch (error) {
    if (error instanceof BrowserRequestErrorV1) throw error;
    return invalid();
  }
}

function encodeCombinedHistoryCursor(input: Readonly<{
  v1: Readonly<{ done: boolean; nextCursor: string | null }>;
  v2: Readonly<{ done: boolean; nextCursor: string | null }>;
  v3: Readonly<{ done: boolean; nextCursor: string | null }>;
  v4: Readonly<{ done: boolean; nextCursor: string | null }>;
}>) {
  const lane = (value: Readonly<{ done: boolean; nextCursor: string | null }>) =>
    Object.freeze({
      cursor: value.done
        ? null
        : canonicalCursor(value.nextCursor ?? undefined, "backend"),
      done: value.done,
    });
  return Buffer.from(JSON.stringify(Object.freeze({
    v1: lane(input.v1),
    v2: lane(input.v2),
    v3: lane(input.v3),
    v4: lane(input.v4),
  })), "utf8").toString("base64url");
}

function compareLaunchHistoryEntries(
  left: DeveloperCustomLaunch,
  right: DeveloperCustomLaunch,
) {
  const timeOrder = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  if (timeOrder !== 0) return timeOrder;
  const idOrder = left.requestId.localeCompare(right.requestId);
  if (idOrder !== 0) return idOrder;
  return left.routeId.localeCompare(right.routeId);
}

function canonicalCursor(value: JsonValue | undefined, source: "browser" | "backend") {
  const invalid = () => {
    if (source === "browser") {
      throw new BrowserRequestErrorV1(400, "pagination_invalid");
    }
    throw new BackendContractErrorV1();
  };
  if (
    typeof value !== "string"
    || value.length < 16
    || value.length > 512
    || !/^[A-Za-z0-9_-]+$/u.test(value)
  ) return invalid();
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) return invalid();
    const decoded = parseStrictJson(bytes.toString("utf8"), {
      maximumBytes: 512,
      maximumDepth: 2,
    });
    if (decoded === null || Array.isArray(decoded) || typeof decoded !== "object") {
      return invalid();
    }
    const record = decoded;
    if (
      Object.keys(record).length !== 2
      || typeof record.createdAt !== "string"
      || !CANONICAL_TIMESTAMP.test(record.createdAt)
      || !Number.isFinite(Date.parse(record.createdAt))
      || new Date(record.createdAt).toISOString() !== record.createdAt
      || typeof record.launchId !== "string"
      || !UUID.test(record.launchId)
    ) return invalid();
    const canonical = Buffer.from(JSON.stringify({
      createdAt: record.createdAt,
      launchId: record.launchId.toLowerCase(),
    }), "utf8").toString("base64url");
    if (canonical !== value) return invalid();
    return value;
  } catch (error) {
    if (
      error instanceof BrowserRequestErrorV1
      || error instanceof BackendContractErrorV1
    ) throw error;
    return invalid();
  }
}

function exactProjectKeys(
  value: Readonly<Record<string, JsonValue>>,
  expected: readonly string[],
) {
  const keys = Object.keys(value);
  if (
    keys.length !== expected.length
    || !keys.every((key) => expected.includes(key))
  ) throw new BackendContractErrorV1();
}

function hasLoneUtf16Surrogate(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function canonicalProjectText(
  value: JsonValue | undefined,
  minimumCodePoints: number,
  maximumCodePoints: number,
  maximumBytes: number,
  options: Readonly<{
    allowLineFeed?: boolean;
    forbidWhitespace?: boolean;
  }> = {},
) {
  const unsafeText = options.allowLineFeed
    ? /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u
    : UNSAFE_PROJECT_TEXT;
  if (
    typeof value !== "string"
    || hasLoneUtf16Surrogate(value)
    || value !== value.normalize("NFC")
    || value !== value.trim()
    || [...value].length < minimumCodePoints
    || [...value].length > maximumCodePoints
    || Buffer.byteLength(value, "utf8") > maximumBytes
    || unsafeText.test(value)
    || containsProjectSecret(value)
    || (options.forbidWhitespace && /\s/u.test(value))
  ) throw new BackendContractErrorV1();
  return value;
}

function fullyDecodeProjectUri(value: string): string {
  let current = value;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const next = decodeURIComponent(current);
      if (next === current) return current;
      current = next;
    } catch {
      return current;
    }
  }
  return current;
}

function containsProjectSecret(value: string) {
  const decoded = fullyDecodeProjectUri(value);
  return SECRET_PATTERNS.some((pattern) => pattern.test(decoded));
}

function parsedProjectUrl(value: JsonValue | undefined) {
  if (
    typeof value !== "string"
    || value === ""
    || value.trim() !== value
    || Buffer.byteLength(value, "utf8") > 2_048
    || /[\u0000-\u0020\u007f-\u009f]/u.test(value)
    || /[\u0000-\u0020\u007f-\u009f]/u.test(fullyDecodeProjectUri(value))
    || containsProjectSecret(value)
  ) throw new BackendContractErrorV1();
  try {
    const url = new URL(value);
    if (url.href !== value) throw new BackendContractErrorV1();
    return url;
  } catch (error) {
    if (error instanceof BackendContractErrorV1) throw error;
    throw new BackendContractErrorV1();
  }
}

function canonicalProjectHttpsUri(value: JsonValue | undefined) {
  const url = parsedProjectUrl(value);
  if (
    url.protocol !== "https:"
    || url.username !== ""
    || url.password !== ""
    || url.hostname === ""
    || url.hostname === "localhost"
    || url.hostname === "localhost."
    || url.hostname === "local"
    || url.hostname === "local."
    || url.hostname.endsWith(".localhost")
    || url.hostname.endsWith(".localhost.")
    || url.hostname.endsWith(".local")
    || url.hostname.endsWith(".local.")
    || url.hostname.includes(":")
    || isIP(url.hostname) !== 0
    || !/^[a-z0-9.-]+$/u.test(url.hostname)
    || url.hash !== ""
  ) throw new BackendContractErrorV1();
  for (const [key, entry] of url.searchParams) {
    if (
      SENSITIVE_QUERY_KEY.test(key)
      || containsProjectSecret(entry)
    ) throw new BackendContractErrorV1();
  }
  return url.href;
}

function canonicalProjectImageUri(value: JsonValue | undefined) {
  const url = parsedProjectUrl(value);
  if (url.protocol === "https:") {
    if (url.search !== "") throw new BackendContractErrorV1();
    return canonicalProjectHttpsUri(value);
  }
  if (
    url.username !== ""
    || url.password !== ""
    || url.port !== ""
    || url.pathname !== ""
    || url.search !== ""
    || url.hash !== ""
  ) throw new BackendContractErrorV1();
  if (
    (url.protocol === "ipfs:" && IPFS_CID.test(url.hostname))
    || (url.protocol === "ar:" && ARWEAVE_TRANSACTION_ID.test(url.hostname))
  ) return url.href;
  throw new BackendContractErrorV1();
}

function parseProjectTokenMetadataFieldBinding(
  value: JsonValue | undefined,
): DeveloperProjectTokenMetadataFieldBindingV1 {
  const record = jsonRecord(value);
  exactProjectKeys(record, ["staticSource", "argumentIndex", "argumentName"]);
  if (
    record.staticSource !== "constructor-argument"
    && record.staticSource !== "initializer-argument"
    && record.staticSource !== "not-deterministically-extractable"
  ) throw new BackendContractErrorV1();
  const deterministic = record.staticSource !== "not-deterministically-extractable";
  if (
    deterministic !== (
      typeof record.argumentIndex === "number"
      && Number.isSafeInteger(record.argumentIndex)
      && record.argumentIndex >= 0
    )
    || (!deterministic && record.argumentName !== null)
    || (record.argumentName !== null && (
      typeof record.argumentName !== "string"
      || record.argumentName === ""
      || record.argumentName !== record.argumentName.normalize("NFC")
      || record.argumentName !== record.argumentName.trim()
      || hasLoneUtf16Surrogate(record.argumentName)
      || containsProjectSecret(record.argumentName)
      || Buffer.byteLength(record.argumentName, "utf8") > 256
      || UNSAFE_PROJECT_TEXT.test(record.argumentName)
    ))
  ) throw new BackendContractErrorV1();
  return Object.freeze({
    staticSource: record.staticSource,
    argumentIndex: record.argumentIndex as number | null,
    argumentName: record.argumentName as string | null,
  });
}

function parseProjectMetadataV1(
  value: JsonValue | undefined,
): DeveloperCustomLaunchProjectMetadataV1 {
  const metadata = jsonRecord(value);
  exactProjectKeys(metadata, [
    "schemaVersion",
    "token",
    "presentation",
    "tokenMetadataBinding",
  ]);
  if (metadata.schemaVersion !== "programmable.project-metadata.v1") {
    throw new BackendContractErrorV1();
  }
  const token = jsonRecord(metadata.token);
  exactProjectKeys(token, ["name", "symbol"]);
  const name = canonicalProjectText(token.name, 1, 64, 64);
  const symbol = canonicalProjectText(token.symbol, 1, 16, 16, {
    forbidWhitespace: true,
  });

  const presentation = jsonRecord(metadata.presentation);
  exactProjectKeys(presentation, ["schemaVersion", "description", "image", "links"]);
  if (presentation.schemaVersion !== "programmable.launch-presentation-draft.v1") {
    throw new BackendContractErrorV1();
  }
  const description = canonicalProjectText(
    presentation.description,
    0,
    4_096,
    4_096,
    { allowLineFeed: true },
  );
  if (containsProjectSecret(description)) throw new BackendContractErrorV1();
  let image: DeveloperCustomLaunchProjectMetadataV1["presentation"]["image"] = null;
  if (presentation.image !== null) {
    const candidate = jsonRecord(presentation.image);
    exactProjectKeys(candidate, [
      "uri",
      "contentSha256",
      "mediaType",
      "byteLength",
      "width",
      "height",
    ]);
    if (
      typeof candidate.contentSha256 !== "string"
      || !REQUEST_HASH.test(candidate.contentSha256)
      || (
        candidate.mediaType !== "image/png"
        && candidate.mediaType !== "image/jpeg"
        && candidate.mediaType !== "image/webp"
        && candidate.mediaType !== "image/gif"
      )
      || typeof candidate.byteLength !== "number"
      || !Number.isSafeInteger(candidate.byteLength)
      || candidate.byteLength < 1
      || candidate.byteLength > 20 * 1_024 * 1_024
      || typeof candidate.width !== "number"
      || !Number.isSafeInteger(candidate.width)
      || candidate.width < 1
      || candidate.width > 8_192
      || typeof candidate.height !== "number"
      || !Number.isSafeInteger(candidate.height)
      || candidate.height < 1
      || candidate.height > 8_192
    ) throw new BackendContractErrorV1();
    image = Object.freeze({
      uri: canonicalProjectImageUri(candidate.uri),
      contentSha256: candidate.contentSha256 as `sha256:${string}`,
      mediaType: candidate.mediaType,
      byteLength: candidate.byteLength,
      width: candidate.width,
      height: candidate.height,
    });
  }
  if (!Array.isArray(presentation.links) || presentation.links.length > 32) {
    throw new BackendContractErrorV1();
  }
  const links: DeveloperCustomLaunchProjectMetadataV1["presentation"]["links"][number][] = [];
  let previousSortKey: Buffer | null = null;
  for (const candidateValue of presentation.links) {
    const candidate = jsonRecord(candidateValue);
    exactProjectKeys(candidate, ["kind", "uri"]);
    if (
      candidate.kind !== "website"
      && candidate.kind !== "documentation"
      && candidate.kind !== "x"
      && candidate.kind !== "telegram"
      && candidate.kind !== "discord"
      && candidate.kind !== "github"
      && candidate.kind !== "other"
    ) throw new BackendContractErrorV1();
    const uri = canonicalProjectHttpsUri(candidate.uri);
    const sortKey = Buffer.from(`${candidate.kind}\u0000${uri}`, "utf8");
    if (previousSortKey !== null && Buffer.compare(previousSortKey, sortKey) >= 0) {
      throw new BackendContractErrorV1();
    }
    previousSortKey = sortKey;
    links.push(Object.freeze({ kind: candidate.kind, uri }));
  }

  const binding = jsonRecord(metadata.tokenMetadataBinding);
  exactProjectKeys(binding, [
    "schemaVersion",
    "tokenTargetId",
    "declarationBinding",
    "standardReadModel",
    "name",
    "symbol",
    "postDeploymentReadback",
  ]);
  const standardReadModel = jsonRecord(binding.standardReadModel);
  exactProjectKeys(standardReadModel, ["name", "symbol"]);
  if (
    binding.schemaVersion !== "programmable.project-token-metadata-binding.v1"
    || typeof binding.tokenTargetId !== "string"
    || !PROJECT_TARGET_ID.test(binding.tokenTargetId)
    || containsProjectSecret(binding.tokenTargetId)
    || binding.declarationBinding !== "request-and-launch-id"
    || typeof standardReadModel.name !== "boolean"
    || typeof standardReadModel.symbol !== "boolean"
    || binding.postDeploymentReadback !== "required"
  ) throw new BackendContractErrorV1();

  return Object.freeze({
    schemaVersion: "programmable.project-metadata.v1",
    token: Object.freeze({ name, symbol }),
    presentation: Object.freeze({
      schemaVersion: "programmable.launch-presentation-draft.v1",
      description,
      image,
      links: Object.freeze(links),
    }),
    tokenMetadataBinding: Object.freeze({
      schemaVersion: "programmable.project-token-metadata-binding.v1",
      tokenTargetId: binding.tokenTargetId,
      declarationBinding: "request-and-launch-id",
      standardReadModel: Object.freeze({
        name: standardReadModel.name,
        symbol: standardReadModel.symbol,
      }),
      name: parseProjectTokenMetadataFieldBinding(binding.name),
      symbol: parseProjectTokenMetadataFieldBinding(binding.symbol),
      postDeploymentReadback: "required",
    }),
  });
}

function projectMetadataHashV1(
  metadata: DeveloperCustomLaunchProjectMetadataV1,
): `sha256:${string}` {
  return canonicalDomainHashV1(PROJECT_METADATA_HASH_DOMAIN, metadata);
}

function projectGraphBundleHashV1(
  unboundGraphBundleHash: `sha256:${string}`,
  projectMetadataHash: `sha256:${string}`,
): `sha256:${string}` {
  return canonicalDomainHashV1(PROJECT_GRAPH_METADATA_HASH_DOMAIN, {
    graphBundleHash: unboundGraphBundleHash,
    projectMetadataHash,
  });
}

function canonicalDomainHashV1(
  domain: string,
  value: unknown,
): `sha256:${string}` {
  const hash = createHash("sha256");
  hash.update(domain, "utf8");
  hash.update(Buffer.from([0]));
  hash.update(canonicalizeJson(value), "utf8");
  return `sha256:${hash.digest("hex")}`;
}

function parseV3ProjectMetadataPair(
  record: Readonly<Record<string, JsonValue>>,
  output: Readonly<Record<string, JsonValue>> | null,
  launchProfileVersion:
    | "2.0.0"
    | "3.0.0"
    | "3.1.0"
    | "3.2.0"
    | "3.3.0"
    | "3.4.0",
  requireAuthorizedArtifactBinding: boolean,
) {
  if (
    !Object.hasOwn(record, "projectMetadata")
    || !Object.hasOwn(record, "projectMetadataHash")
    || (record.projectMetadata === null) !== (record.projectMetadataHash === null)
  ) throw new BackendContractErrorV1();
  const artifactValue = output?.artifact;
  const artifact = artifactValue === undefined
    ? null
    : jsonRecord(artifactValue);
  const artifactMetadataKeys = [
    "unboundGraphBundleHash",
    "projectMetadata",
    "projectMetadataHash",
  ] as const;
  const artifactMetadataKeyCount = artifact === null
    ? 0
    : artifactMetadataKeys.filter((key) => Object.hasOwn(artifact, key)).length;

  if (
    launchProfileVersion !== "3.2.0"
    && launchProfileVersion !== "3.3.0"
    && launchProfileVersion !== "3.4.0"
  ) {
    if (
      record.projectMetadata !== null
      || record.projectMetadataHash !== null
      || artifactMetadataKeyCount !== 0
    ) throw new BackendContractErrorV1();
    return Object.freeze({ projectMetadata: null, projectMetadataHash: null });
  }
  if (record.projectMetadata === null) throw new BackendContractErrorV1();
  const projectMetadata = parseProjectMetadataV1(record.projectMetadata);
  if (
    typeof record.projectMetadataHash !== "string"
    || !REQUEST_HASH.test(record.projectMetadataHash)
    || record.projectMetadataHash !== projectMetadataHashV1(projectMetadata)
  ) throw new BackendContractErrorV1();
  const projectMetadataHash = record.projectMetadataHash as `sha256:${string}`;

  if (
    artifactMetadataKeyCount !== 0
    && artifactMetadataKeyCount !== artifactMetadataKeys.length
  ) throw new BackendContractErrorV1();
  if (artifact !== null && artifactMetadataKeyCount === 0) {
    throw new BackendContractErrorV1();
  }
  if (artifactMetadataKeyCount === artifactMetadataKeys.length) {
    if (artifact === null) throw new BackendContractErrorV1();
    const artifactMetadata = parseProjectMetadataV1(artifact.projectMetadata);
    if (
      typeof artifact.unboundGraphBundleHash !== "string"
        || !REQUEST_HASH.test(artifact.unboundGraphBundleHash)
        || typeof artifact.graphBundleHash !== "string"
        || !REQUEST_HASH.test(artifact.graphBundleHash)
        || artifact.projectMetadataHash !== projectMetadataHash
        || projectMetadataHashV1(artifactMetadata) !== projectMetadataHash
        || artifact.graphBundleHash !== projectGraphBundleHashV1(
          artifact.unboundGraphBundleHash as `sha256:${string}`,
          projectMetadataHash,
        )
        || canonicalizeJson(artifactMetadata) !== canonicalizeJson(projectMetadata)
    ) throw new BackendContractErrorV1();
  }
  if (
    requireAuthorizedArtifactBinding
    && record.status === "authorized"
    && artifactMetadataKeyCount !== 3
  ) {
    throw new BackendContractErrorV1();
  }
  return Object.freeze({ projectMetadata, projectMetadataHash });
}

const STATUSES_V4 = new Set([
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
]);

function parseLaunchSummaryV4(
  value: JsonValue,
  expectedWallet: string,
): DeveloperCustomLaunchSummaryV4 {
  const record = jsonRecord(value);
  exactProjectKeys(record, [
    "launchId", "chainId", "caip2", "chainDeploymentId",
    "chainDeploymentDescriptorDigest", "controller", "status",
    "walletHandoffUrl", "expiresAt", "createdAt", "updatedAt",
  ]);
  const controller = jsonRecord(record.controller);
  exactProjectKeys(controller, ["namespace", "address"]);
  if (typeof record.launchId !== "string"
    || !UUID.test(record.launchId)
    || record.chainId !== "4663"
    || record.caip2 !== "eip155:4663"
    || record.chainDeploymentId !== "robinhood-mainnet-custom-launch-v1"
    || typeof record.chainDeploymentDescriptorDigest !== "string"
    || !LOWER_BYTES32.test(record.chainDeploymentDescriptorDigest)
    || controller.namespace !== "eip155:4663"
    || typeof controller.address !== "string"
    || !isAddress(controller.address)
    || controller.address.toLowerCase() !== expectedWallet
    || typeof record.status !== "string"
    || !STATUSES_V4.has(record.status)
    || requiredTimestamp(record.createdAt) !== record.createdAt
    || requiredTimestamp(record.updatedAt) !== record.updatedAt
    || (record.walletHandoffUrl === null) !== (record.expiresAt === null)) {
    throw new BackendContractErrorV1();
  }
  const launchId = record.launchId.toLowerCase();
  const walletHandoffUrl = record.walletHandoffUrl === null
    ? null
    : exactV4WalletHandoffUrl(record.walletHandoffUrl, launchId);
  const expiresAt = record.expiresAt === null
    ? null
    : requiredTimestamp(record.expiresAt);
  return Object.freeze({
    schemaVersion: CUSTOM_LAUNCH_SUMMARY_SCHEMA_V4,
    apiVersion: "v4" as const,
    launchId,
    requestId: launchId,
    routeId: "custom-launch:create:v4" as const,
    chainId: "4663" as const,
    caip2: "eip155:4663" as const,
    chainDeploymentId: "robinhood-mainnet-custom-launch-v1" as const,
    chainDeploymentDescriptorDigest:
      record.chainDeploymentDescriptorDigest as `0x${string}`,
    controller: Object.freeze({
      namespace: "eip155:4663" as const,
      address: getAddress(controller.address) as `0x${string}`,
    }),
    status: record.status,
    walletHandoffUrl,
    expiresAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

function exactV4WalletHandoffUrl(value: JsonValue | undefined, launchId: string) {
  const expected = `https://programmable.market/developers/api-keys?launchId=${
    encodeURIComponent(launchId)
  }&chainId=4663`;
  if (value !== expected) throw new BackendContractErrorV1();
  return expected;
}

function parseLaunchV4(
  value: JsonValue,
  expectedWallet: string,
): DeveloperCustomLaunchV4 {
  const record = jsonRecord(value);
  const optionalKeys = [
    "actionRequired",
    "walletHandoffUrl",
    "expiresAt",
    "secondsRemaining",
    "partnerAttribution",
    "sourceVerification",
  ].filter((key) => Object.hasOwn(record, key));
  exactProjectKeys(record, [
    "schemaVersion", "apiVersion", "launchId", "requestId", "routeId",
    "chainId", "caip2", "chainDeploymentId", "chainDeploymentDescriptorDigest",
    "chainDeployment", "profile", "controller", "status", "requestHash",
    "rawRequestSha256", "sourceBuildCommitment", "graphCommitment",
    "metadataCommitment", "walletTransactionPreimageHash", "commitments",
    "projectMetadata", "funding", "liquidityModel", "walletTransaction",
    "preparedArtifact", "admissionReceipt", "simulationReceipt",
    "externalContractEvidenceReceipt", ...optionalKeys, "onchain", "failure",
    "createdAt", "updatedAt",
  ]);
  const controller = jsonRecord(record.controller);
  exactProjectKeys(controller, ["namespace", "address"]);
  if (record.schemaVersion !== "programmable.custom-launch.v4"
    || record.apiVersion !== "v4"
    || typeof record.launchId !== "string"
    || !UUID.test(record.launchId)
    || typeof record.requestId !== "string"
    || !UUID.test(record.requestId)
    || record.routeId !== "custom-launch:create:v4"
    || record.chainId !== "4663"
    || record.caip2 !== "eip155:4663"
    || record.chainDeploymentId !== "robinhood-mainnet-custom-launch-v1"
    || typeof record.chainDeploymentDescriptorDigest !== "string"
    || !LOWER_BYTES32.test(record.chainDeploymentDescriptorDigest)
    || controller.namespace !== "eip155:4663"
    || typeof controller.address !== "string"
    || !isAddress(controller.address)
    || controller.address.toLowerCase() !== expectedWallet
    || typeof record.status !== "string"
    || !STATUSES_V4.has(record.status)
    || typeof record.requestHash !== "string"
    || !REQUEST_HASH.test(record.requestHash)
    || typeof record.rawRequestSha256 !== "string"
    || !REQUEST_HASH.test(record.rawRequestSha256)
    || typeof record.sourceBuildCommitment !== "string"
    || !REQUEST_HASH.test(record.sourceBuildCommitment)
    || typeof record.graphCommitment !== "string"
    || !REQUEST_HASH.test(record.graphCommitment)
    || typeof record.metadataCommitment !== "string"
    || !REQUEST_HASH.test(record.metadataCommitment)
    || (record.walletTransactionPreimageHash !== null
      && (typeof record.walletTransactionPreimageHash !== "string"
        || !REQUEST_HASH.test(record.walletTransactionPreimageHash)))
    || parseProjectMetadataV1(record.projectMetadata) === null
    || requiredTimestamp(record.createdAt) !== record.createdAt
    || requiredTimestamp(record.updatedAt) !== record.updatedAt
    || (Object.hasOwn(record, "sourceVerification")
      && record.sourceVerification !== null)) {
    throw new BackendContractErrorV1();
  }
  const unevaluated = record.status === "received" || record.status === "validating";
  const receiptValues = [
    record.admissionReceipt,
    record.simulationReceipt,
    record.externalContractEvidenceReceipt,
  ];
  if (receiptValues.some((receipt) => (receipt === null) !== unevaluated)
    || receiptValues.some((receipt) => receipt !== null && (
      Array.isArray(receipt) || typeof receipt !== "object"
    ))) throw new BackendContractErrorV1();
  const walletPrepared = new Set([
    "wallet_action_required", "awaiting_wallet_signature", "authorized",
    "submitted", "sequencer_soft_confirmed", "ethereum_posted", "finalized",
  ]).has(record.status);
  if ((record.walletTransaction === null) !== !walletPrepared
    || (record.preparedArtifact === null) !== !walletPrepared
    || (record.walletTransaction !== null && (
      Array.isArray(record.walletTransaction) || typeof record.walletTransaction !== "object"
    ))
    || (record.preparedArtifact !== null && (
      Array.isArray(record.preparedArtifact) || typeof record.preparedArtifact !== "object"
    ))) throw new BackendContractErrorV1();
  return Object.freeze(record) as unknown as DeveloperCustomLaunchV4;
}

function parseLaunch(
  value: JsonValue,
  expectedWallet: string,
  version: BackendHistoryVersion,
  options: Readonly<{ requireAuthorizedArtifactBinding: boolean }>,
): DeveloperCustomLaunch {
  const record = jsonRecord(value);
  const expectedSchema = version === "v1"
    ? "programmable.custom-launch.v1"
    : version === "v2"
      ? "programmable.custom-launch.v2"
      : "programmable.custom-launch.v3";
  const expectedRoute = version === "v1"
    ? "custom-launch:create:v1"
    : version === "v2"
      ? "custom-launch:create:v2"
      : "custom-launch:create:v3";
  const statuses = version === "v1"
    ? STATUSES_V1
    : version === "v2"
      ? STATUSES_V2
      : STATUSES_V3;
  if (
    record.schemaVersion !== expectedSchema
    || typeof record.launchId !== "string"
    || !UUID.test(record.launchId)
    || typeof record.requestId !== "string"
    || !UUID.test(record.requestId)
    || record.requestId.toLowerCase() !== record.launchId.toLowerCase()
    || (record.onchainLaunchId !== null && (
      typeof record.onchainLaunchId !== "string"
      || !/^0x[0-9a-f]{64}$/u.test(record.onchainLaunchId)
    ))
    || record.routeId !== expectedRoute
    || typeof record.ownerWallet !== "string"
    || !isAddress(record.ownerWallet)
    || record.ownerWallet.toLowerCase() !== expectedWallet
    || typeof record.status !== "string"
    || !statuses.has(record.status)
    || typeof record.requestHash !== "string"
    || !REQUEST_HASH.test(record.requestHash)
    || (version !== "v1" && (
      typeof record.launchProfileHash !== "string"
      || !REQUEST_HASH.test(record.launchProfileHash)
      || typeof record.launchIntentHash !== "string"
      || !REQUEST_HASH.test(record.launchIntentHash)
    ))
    || (version === "v3" && record.fundingIntentHash !== null && (
      typeof record.fundingIntentHash !== "string"
      || !LOWER_BYTES32.test(record.fundingIntentHash)
    ))
  ) throw new BackendContractErrorV1();
  const output = record.output === null
    ? null
    : jsonRecord(record.output);
  const launchProfileVersion = version === "v3"
    && (
      record.launchProfileVersion === "2.0.0"
      || record.launchProfileVersion === "3.0.0"
      || record.launchProfileVersion === "3.1.0"
      || record.launchProfileVersion === "3.2.0"
      || record.launchProfileVersion === "3.3.0"
      || record.launchProfileVersion === "3.4.0"
    )
    ? record.launchProfileVersion
    : null;
  if (version === "v3" && launchProfileVersion === null) {
    throw new BackendContractErrorV1();
  }
  const projectMetadataPair = version === "v3"
    ? parseV3ProjectMetadataPair(
        record,
        output,
        launchProfileVersion!,
        options.requireAuthorizedArtifactBinding,
      )
    : null;
  const fundingIntentHash = version === "v3"
    ? validatedV3FundingIntentHash(record, output)
    : null;
  const failure = record.failure === null
    ? null
    : parseFailure(record.failure, version);
  const sourceVerification = record.sourceVerification === undefined
    || record.sourceVerification === null
    ? null
    : parseSourceVerificationStatusV1(record.sourceVerification);
  if (
    record.sourceVerification !== undefined
    && record.sourceVerification !== null
    && sourceVerification === null
  ) throw new BackendContractErrorV1();
  if (sourceVerification && record.status !== "finalized") {
    throw new BackendContractErrorV1();
  }
  const base = {
    launchId: record.launchId.toLowerCase(),
    requestId: record.requestId.toLowerCase(),
    onchainLaunchId: record.onchainLaunchId as `0x${string}` | null,
    ownerWallet: record.ownerWallet.toLowerCase() as `0x${string}`,
    status: record.status,
    requestHash: record.requestHash,
    createdAt: requiredTimestamp(record.createdAt),
    updatedAt: requiredTimestamp(record.updatedAt),
    output,
    failure,
    ...(sourceVerification ? { sourceVerification } : {}),
  };
  if (version === "v1") {
    return Object.freeze({
      ...base,
      schemaVersion: "programmable.custom-launch.v1" as const,
      routeId: "custom-launch:create:v1" as const,
    });
  }
  const profileBase = {
    ...base,
    launchProfileHash: record.launchProfileHash as `sha256:${string}`,
    launchIntentHash: record.launchIntentHash as `sha256:${string}`,
  };
  return version === "v2"
    ? Object.freeze({
        ...profileBase,
        schemaVersion: "programmable.custom-launch.v2" as const,
        routeId: "custom-launch:create:v2" as const,
      })
    : Object.freeze({
        ...profileBase,
        schemaVersion: "programmable.custom-launch.v3" as const,
        routeId: "custom-launch:create:v3" as const,
        launchProfileVersion: launchProfileVersion!,
        fundingIntentHash,
        liquidityIntent: parseV3LiquidityIntent(record.liquidityIntent),
        ...projectMetadataPair!,
        ...parseOptionalWalletHandoff(record),
      });
}

function parseV3LiquidityIntent(
  value: JsonValue | undefined,
): CustomLaunchLiquidityIntentV3 {
  const record = jsonRecord(value);
  const keys = Object.keys(record);
  if (
    keys.length !== 3
    || !keys.every((key) => [
      "model",
      "declaredLaunchState",
      "binding",
    ].includes(key))
    || (record.binding !== "explicit-request-hash"
      && record.binding !== "legacy-v3-default")
  ) throw new BackendContractErrorV1();

  if (record.model === "external-concentrated-liquidity") {
    if (record.declaredLaunchState !== "liquidity_required") {
      throw new BackendContractErrorV1();
    }
    return Object.freeze({
      model: record.model,
      declaredLaunchState: record.declaredLaunchState,
      binding: record.binding,
    });
  }
  if (
    (record.model !== "launch-seeded-concentrated-liquidity"
      && record.model !== "hook-inventory-custom-accounting")
    || record.declaredLaunchState !== "assessment_required"
  ) throw new BackendContractErrorV1();
  return Object.freeze({
    model: record.model,
    declaredLaunchState: record.declaredLaunchState,
    binding: record.binding,
  });
}

function validatedV3FundingIntentHash(
  record: Readonly<Record<string, JsonValue>>,
  output: Readonly<Record<string, JsonValue>> | null,
): `0x${string}` | null {
  const fundingIntentHash = record.fundingIntentHash as `0x${string}` | null;
  const statusRequiresFundingIntent = record.status === "awaiting_funding_authorization"
    || record.status === "funding_authorization_verified";
  if (statusRequiresFundingIntent && fundingIntentHash === null) {
    throw new BackendContractErrorV1();
  }
  if (output === null) return fundingIntentHash;

  const fundingMode = output.fundingMode;
  if (fundingMode !== undefined) {
    if (
      fundingMode !== "none"
      && fundingMode !== "wallet-transaction-value"
      && fundingMode !== "eip-3009-receive-with-authorization"
    ) throw new BackendContractErrorV1();
    if (
      (fundingMode === "eip-3009-receive-with-authorization")
        !== (fundingIntentHash !== null)
    ) throw new BackendContractErrorV1();
  }

  const actionRequired = output.actionRequired;
  if (
    actionRequired !== null
    && actionRequired !== undefined
    && !Array.isArray(actionRequired)
    && typeof actionRequired === "object"
    && actionRequired.method === "eip-3009-receive-with-authorization"
    && (
      fundingIntentHash === null
      || actionRequired.fundingIntentHash !== fundingIntentHash
    )
  ) throw new BackendContractErrorV1();
  return fundingIntentHash;
}

function parseOptionalWalletHandoff(
  record: Readonly<Record<string, JsonValue>>,
) {
  const hasHandoff = [
    "walletHandoffUrl",
    "expiresAt",
    "secondsRemaining",
  ].some((key) => Object.hasOwn(record, key));
  if (!hasHandoff) return Object.freeze({});
  const parsed = parseCustomLaunchWalletHandoffV1(record, String(record.requestId));
  if (!parsed) throw new BackendContractErrorV1();
  if (
    parsed.walletHandoffUrl
    && record.status !== "awaiting_funding_authorization"
    && record.status !== "authorized"
  ) throw new BackendContractErrorV1();
  return parsed;
}

function parseFailure(value: JsonValue, version: BackendHistoryVersion) {
  const record = jsonRecord(value);
  if (
    typeof record.code !== "string"
    || record.code.length < 1
    || record.code.length > 128
    || typeof record.message !== "string"
    || record.message.length < 1
    || record.message.length > 512
    || typeof record.retryable !== "boolean"
  ) throw new BackendContractErrorV1();
  const remediations: CustomLaunchRemediationV1[] = [];
  if (version === "v3") {
    if (!Array.isArray(record.remediations) || record.remediations.length > 32) {
      throw new BackendContractErrorV1();
    }
    for (const candidate of record.remediations) {
      const remediation = parseCustomLaunchRemediationV1(candidate);
      if (!remediation) throw new BackendContractErrorV1();
      remediations.push(remediation);
    }
  }
  return Object.freeze({
    code: record.code,
    message: record.message,
    retryable: record.retryable,
    ...(version === "v3" ? { remediations: Object.freeze(remediations) } : {}),
  });
}

function parseV4SubmissionHint(value: JsonValue) {
  const record = jsonRecord(value);
  exactProjectKeys(record, ["schemaVersion", "transactionHash"]);
  if (record.schemaVersion !== CUSTOM_LAUNCH_SUBMISSION_HINT_SCHEMA_V1
    || typeof record.transactionHash !== "string"
    || !LOWER_BYTES32.test(record.transactionHash)) {
    throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  }
  return Object.freeze({
    schemaVersion: CUSTOM_LAUNCH_SUBMISSION_HINT_SCHEMA_V1,
    transactionHash: record.transactionHash as `0x${string}`,
  });
}

function parseV4SubmissionHintResponse(
  value: JsonValue,
  launchId: string,
  transactionHash: `0x${string}`,
) {
  const record = jsonRecord(value);
  exactProjectKeys(record, [
    "schemaVersion", "apiVersion", "launchId", "chainId", "chainDeploymentId",
    "transactionHash", "accepted", "authoritative", "acceptedAt", "statusPath",
  ]);
  const expectedStatusPath = `/v4/chains/4663/wallet-admin/custom-launches/${
    encodeURIComponent(launchId)
  }`;
  if (record.schemaVersion !== CUSTOM_LAUNCH_SUBMISSION_HINT_SCHEMA_V1
    || record.apiVersion !== "v4"
    || record.launchId !== launchId
    || record.chainId !== "4663"
    || record.chainDeploymentId !== "robinhood-mainnet-custom-launch-v1"
    || record.transactionHash !== transactionHash
    || record.accepted !== true
    || record.authoritative !== false
    || requiredTimestamp(record.acceptedAt) !== record.acceptedAt
    || record.statusPath !== expectedStatusPath) {
    throw new BackendContractErrorV1();
  }
  return Object.freeze({
    schemaVersion: CUSTOM_LAUNCH_SUBMISSION_HINT_SCHEMA_V1,
    apiVersion: "v4" as const,
    launchId,
    chainId: "4663" as const,
    chainDeploymentId: "robinhood-mainnet-custom-launch-v1" as const,
    transactionHash,
    accepted: true as const,
    authoritative: false as const,
    acceptedAt: record.acceptedAt,
    statusPath: expectedStatusPath,
  });
}

function parseFundingSignatureSubmission(value: JsonValue) {
  const record = jsonRecord(value);
  const keys = Object.keys(record);
  if (
    keys.length !== 4
    || !keys.every((key) => [
      "schemaVersion",
      "fundingIntentHash",
      "typedDataDigest",
      "signature",
    ].includes(key))
    || record.schemaVersion !== FUNDING_SIGNATURE_SCHEMA_V1
    || typeof record.fundingIntentHash !== "string"
    || !LOWER_BYTES32.test(record.fundingIntentHash)
    || typeof record.typedDataDigest !== "string"
    || !LOWER_BYTES32.test(record.typedDataDigest)
    || typeof record.signature !== "string"
    || !LOWER_SIGNATURE.test(record.signature)
  ) throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  return Object.freeze({
    schemaVersion: FUNDING_SIGNATURE_SCHEMA_V1,
    fundingIntentHash: record.fundingIntentHash,
    typedDataDigest: record.typedDataDigest,
    signature: record.signature,
  });
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

async function readBoundedBackendJson(
  response: Response,
  maximumBytes: number,
): Promise<JsonValue> {
  const contentLength = response.headers.get("content-length");
  const declaredLength = contentLength === null ? null : Number(contentLength);
  if (
    declaredLength !== null && (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > maximumBytes
    )
  ) throw new BackendContractErrorV1();
  if (!response.body) throw new BackendContractErrorV1();
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new BackendContractErrorV1();
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof BackendContractErrorV1) throw error;
    throw new BackendContractErrorV1();
  }
  if (!text) throw new BackendContractErrorV1();
  try {
    return parseStrictJson(text, {
      maximumBytes,
      maximumDepth: 16,
    });
  } catch {
    throw new BackendContractErrorV1();
  }
}

async function readBoundedBrowserJson(request: Request): Promise<JsonValue> {
  const contentLength = request.headers.get("content-length");
  const declaredLength = contentLength === null ? null : Number(contentLength);
  if (
    declaredLength !== null
    && (!Number.isSafeInteger(declaredLength)
      || declaredLength < 1
      || declaredLength > MAXIMUM_BROWSER_FUNDING_BODY_BYTES)
  ) throw new BrowserRequestErrorV1(413, "request_too_large");
  const text = await request.text();
  if (
    !text
    || Buffer.byteLength(text, "utf8") > MAXIMUM_BROWSER_FUNDING_BODY_BYTES
  ) throw new BrowserRequestErrorV1(413, "request_too_large");
  try {
    return parseStrictJson(text, {
      maximumBytes: MAXIMUM_BROWSER_FUNDING_BODY_BYTES,
      maximumDepth: 4,
    });
  } catch {
    throw new BrowserRequestErrorV1(400, "request_schema_invalid");
  }
}

function jsonRecord(value: JsonValue | undefined): Readonly<Record<string, JsonValue>> {
  if (
    value === null
    || value === undefined
    || Array.isArray(value)
    || typeof value !== "object"
  ) throw new BackendContractErrorV1();
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

function requireJsonResponse(request: Request) {
  const accept = request.headers.get("accept")?.toLowerCase();
  if (accept && !accept.includes("application/json") && !accept.includes("*/*")) {
    throw new BrowserRequestErrorV1(406, "json_response_required");
  }
}

function requireJsonRequest(request: Request) {
  requireJsonResponse(request);
  const contentType = request.headers.get("content-type")?.toLowerCase();
  if (!contentType || !contentType.startsWith("application/json")) {
    throw new BrowserRequestErrorV1(415, "json_request_required");
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
  console.error("Developer launch history request failed", {
    name: error instanceof Error ? error.name : "DeveloperLaunchHistoryError",
    requestId,
  });
  return errorResponse(
    503,
    "launch_history_unavailable",
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
    schemaVersion: CUSTOM_LAUNCH_HISTORY_SCHEMA_V1,
    error: Object.freeze({
      code,
      message: publicMessage ?? (status >= 500
        ? "Launch history is temporarily unavailable."
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
    super("launch_history_backend_contract_invalid");
    this.name = "BackendContractErrorV1";
  }
}
