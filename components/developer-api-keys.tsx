"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from "lucide-react";

import styles from "@/components/developer-api-keys.module.css";
import { DeveloperLaunchHistory } from "@/components/developer-launch-history";
import {
  DeveloperRobinhoodLaunch,
  RobinhoodFeePolicyDisclosure,
} from
  "@/components/developer-robinhood-launch";
import {
  useWallet,
  type CustomLaunchWalletActionInputV4,
  type CustomLaunchWalletActionResultV4,
} from "@/components/wallet-provider";
import { PROGRAMMABLE_AGENT_SETUP_LINKS_V1, PROGRAMMABLE_AGENT_SETUP_TEXT_V1 } from
  "@/lib/custom-launch/agent-setup-v1";
import type { CustomLaunchWalletActionV1 } from
  "@/lib/custom-launch/wallet-handoff-v1";
import type { CustomLaunchFundingAuthorizationV3 } from
  "@/lib/custom-launch/wallet-handoff-v3";

export type ApiKeySummary = Readonly<{
  id: string;
  label: string;
  keyPrefix: string;
  scopes: readonly string[];
  controllerWallet?: string;
  chainRestriction?: ApiKeyChainRestriction;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}>;

export type ApiKeyChainRestriction = Readonly<{
  allowedChainIds: readonly string[] | null;
  mode: "persisted" | "legacy-policy-dependent";
  effectiveEligibility: "evaluated-per-request";
}>;
export type ApiKeyCapabilities = Readonly<{
  restrictedIssuance: boolean;
  preservingRotation: boolean;
  /** Independently attests preserving V1 Module rotation; fresh admission remains server-side. */
  preservingModuleRotation: boolean;
}>;
type ApiKeyAccess = "prepare-and-read" | "read-only";

export type ApiKeyMutationResult =
  | Readonly<{
      apiKey: ApiKeySummary;
      secretState: "delivered-once";
      apiKeySecret: string;
      rotatedCredentialId?: string;
    }>
  | Readonly<{
      apiKey: ApiKeySummary;
      secretState: "already-delivered";
      rotatedCredentialId?: string;
    }>;

type VisibleApiKeyMutationResult = Readonly<{
  operation: "issue" | "rotate";
  result: ApiKeyMutationResult;
}>;

export type ApiKeyMutationAttempt = Readonly<{
  kind: "issue" | "rotate";
  credentialId: string | null;
  version: "v1" | "v2";
  idempotencyKey: string;
  body: string;
}>;

type ApiKeyMutationState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "issue" }>
  | Readonly<{ kind: "rotate"; credentialId: string }>;

type ListState = "idle" | "loading" | "ready" | "error";
type ActiveSection = "keys" | "launch" | "history";
type ApiKeyLoadMode = "initial" | "refresh" | "mutation";
type DeveloperApiKeysProps = Readonly<{
  initialSection?: ActiveSection;
  agentSetupText?: string;
  moduleAgentSetupText?: string;
}>;
type DeveloperApiKeysViewProps = Readonly<{
  account: `0x${string}` | null;
  authReady: boolean;
  connecting: boolean;
  getAccessToken: () => Promise<string | null>;
  getIdentityToken: () => Promise<string | null>;
  initialSection: ActiveSection;
  agentSetupText?: string;
  moduleAgentSetupText?: string;
  openWallet: () => void;
  sendCustomLaunchWalletAction: (
    input: CustomLaunchWalletActionV1,
  ) => Promise<`0x${string}`>;
  sendCustomLaunchWalletActionV4: (
    input: CustomLaunchWalletActionInputV4,
  ) => Promise<CustomLaunchWalletActionResultV4>;
  signCustomLaunchFundingAuthorization: (
    input: CustomLaunchFundingAuthorizationV3,
  ) => Promise<`0x${string}`>;
}>;

const expiryOptions = [
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 180, label: "180 days" },
  { value: 366, label: "366 days" },
] as const;
type ExpiryDays = (typeof expiryOptions)[number]["value"];

const fixedScopes = ["custom-launch:create", "custom-launch:read"] as const;
const readOnlyScopes = ["custom-launch:read"] as const;
const schemaVersionV2 = "programmable.custom-launch-api.v2";
const moduleScopes = ["modules:submit", "modules:read"] as const;
export type ApiKeyPurpose = "custom-launches" | "module-contributions";
const schemaVersion = "programmable.custom-launch-api.v1";
const launchRequestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const apiKeySecretPattern =
  /^pm_live_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{43}$/u;
const idempotencyKeyPattern = /^[A-Za-z0-9._:-]{16,128}$/u;
const API_KEY_PAGE_SIZE = 3;
const moduleApiOrigin = new URL(PROGRAMMABLE_AGENT_SETUP_LINKS_V1.capabilities).origin;
export const PROGRAMMABLE_READ_ONLY_AGENT_SETUP_TEXT = [
  "Use this Programmable API key only to read launch history and status. It cannot prepare or submit launches, sign transactions or move funds.",
  "Read the key from $PROGRAMMABLE_API_KEY in the environment or secret store. Never paste, print or copy the secret into chat, source code, logs or command history.",
  `Read the current API discovery at ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.discovery} and OpenAPI at ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.openApi}. Use only documented read operations supported by the service.`,
  "Launch history can include requests from other API keys and linked wallets in the same account. The key is not isolated to one project or controller wallet’s history.",
  "Respect the key’s saved chain restriction. Current chain access is checked for each request; do not infer access from a scope name or from an absent chain list.",
].join("\n\n");
export const PROGRAMMABLE_MODULE_AGENT_SETUP_TEXT_V1 = [
  "Prepare a Programmable Module Mode contribution as a source package.",
  "Use a separate API key with exactly modules:submit and modules:read. Read it from $PROGRAMMABLE_MODULES_API_KEY in the environment or secret store; never paste, print or copy the secret into chat, source code, logs or command history.",
  `Use the existing Programmable API origin ${moduleApiOrigin}. First read GET ${moduleApiOrigin}/v1/modules/capabilities. Continue only when that live response explicitly allows submissions; an absent route or unavailable capability is not permission to submit.`,
  "Use the package schema and limits reported by those capabilities. Build and test your own module locally, then prepare its source package, configuration, declared permissions and documentation. Include the nonzero EVM author wallet bound to your API key and your chosen nonzero EVM reward wallet. Upload all pinned source files; a GitHub repository or pull request is not required. The intake accepts source without executing it. Do not invent missing package fields.",
  "When available, submit the source package through POST /v1/modules/submissions and read its status through GET /v1/modules/submissions/:id using the returned submission ID and the same API origin. Follow the endpoint's current authentication and idempotency contract.",
  "A draft_received result only records receipt. It is not an approval, audit, deployment, catalog listing or permission to bind the module to a live launch. Keep review and runtime integration as separate steps.",
  "A module contribution key cannot create launches, approve modules, sign or broadcast wallet transactions. Do not call Custom launch routes with it.",
].join("\n\n");

function hasStandardScopes(scopes: readonly string[]) {
  return scopes.length === fixedScopes.length
    && fixedScopes.every((scope) => scopes.includes(scope));
}

function hasReadOnlyScopes(scopes: readonly string[]) {
  return scopes.length === 1 && scopes[0] === "custom-launch:read";
}

export function parseApiKeyCapabilities(value: unknown): ApiKeyCapabilities | null {
  if (
    !isRecord(value)
    || value.schemaVersion !== "programmable.api-key-capabilities.v2"
    || typeof value.restrictedIssuance !== "boolean"
    || typeof value.preservingRotation !== "boolean"
    || (value.preservingModuleRotation !== undefined
      && typeof value.preservingModuleRotation !== "boolean")
  ) return null;
  return {
    restrictedIssuance: value.restrictedIssuance,
    preservingRotation: value.preservingRotation,
    preservingModuleRotation: value.preservingModuleRotation === true,
  };
}

export function apiKeyIssueVersion(access: ApiKeyAccess, capabilities: ApiKeyCapabilities | null) {
  if (capabilities?.restrictedIssuance && capabilities.preservingRotation) return "v2";
  return access === "prepare-and-read" ? "v1" : null;
}

export function apiKeyRotationVersion(scopes: readonly string[], capabilities: ApiKeyCapabilities | null): "v1" | "v2" | null {
  if (apiKeyPurpose(scopes) === "module-contributions") {
    return capabilities?.preservingModuleRotation ? "v1" : null;
  }
  if (!hasStandardScopes(scopes) && !hasReadOnlyScopes(scopes)) return null;
  if (capabilities?.preservingRotation) return "v2";
  return null;
}

export function apiKeyMutationPath(attempt: Pick<ApiKeyMutationAttempt, "version" | "kind" | "credentialId">) {
  const base = attempt.version === "v2" ? "/api/developer/api-keys/v2" : "/api/developer/api-keys";
  return attempt.kind === "issue"
    ? base
    : `${base}/${encodeURIComponent(attempt.credentialId!)}/rotate`;
}

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

export function apiKeyPurpose(scopes: unknown): ApiKeyPurpose | null {
  if (!Array.isArray(scopes) || scopes.length !== 2 || new Set(scopes).size !== 2) {
    return null;
  }
  if (fixedScopes.every((scope) => scopes.includes(scope))) return "custom-launches";
  if (moduleScopes.every((scope) => scopes.includes(scope))) return "module-contributions";
  return null;
}

export function apiKeyPurposeLabel(scopes: unknown): string {
  const purpose = apiKeyPurpose(scopes);
  if (purpose === "custom-launches") return "Custom launches";
  if (purpose === "module-contributions") return "Module contributions";
  if (Array.isArray(scopes) && scopes.length === 1
    && fixedScopes.includes(scopes[0])) return "Custom launches";
  return "Other permissions";
}

export function moduleContributionKeysAvailable(value: unknown): boolean {
  if (!isRecord(value) || (value.schemaVersion !== schemaVersion && value.schemaVersion !== schemaVersionV2)) return false;
  const capability = value.moduleContributions;
  return isRecord(capability)
    && capability.apiKeyIssuance === true
    && capability.submissions === true;
}

function validMetadataScopes(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 16
    && new Set(value).size === value.length
    && value.every((scope) => typeof scope === "string"
      && /^[a-z][a-z0-9-]{1,63}:[a-z][a-z0-9-]{1,63}$/u.test(scope));
}

function parseApiKeySummary(value: unknown): ApiKeySummary | null {
  if (!isRecord(value)) return null;

  const lastUsedAt = nullableString(value.lastUsedAt);
  const revokedAt = nullableString(value.revokedAt);
  const expiresAt = nullableString(value.expiresAt);
  if (
    typeof value.id !== "string" ||
    typeof value.label !== "string" ||
    typeof value.keyPrefix !== "string" ||
    !validMetadataScopes(value.scopes) ||
    typeof value.createdAt !== "string" ||
    expiresAt === undefined ||
    lastUsedAt === undefined ||
    revokedAt === undefined
  ) {
    return null;
  }

  return {
    id: value.id,
    label: value.label,
    keyPrefix: value.keyPrefix,
    scopes: value.scopes,
    createdAt: value.createdAt,
    expiresAt,
    lastUsedAt,
    revokedAt,
  };
}

export function parseApiKeyList(value: unknown, expectedWallet?: string): ApiKeySummary[] | null {
  if (
    !isRecord(value) ||
    (value.schemaVersion !== schemaVersion && value.schemaVersion !== schemaVersionV2) ||
    !Array.isArray(value.apiKeys) || value.apiKeys.length > 100
  ) {
    return null;
  }
  const apiKeys: ApiKeySummary[] = [];
  for (const candidate of value.apiKeys) {
    const parsed = parseApiKeySummary(candidate);
    if (!parsed || apiKeys.some((key) => key.id === parsed.id)) return null;
    if (value.schemaVersion === schemaVersionV2) {
      if (!isRecord(candidate) || typeof candidate.controllerWallet !== "string"
        || !/^0x[0-9a-fA-F]{40}$/u.test(candidate.controllerWallet)
        || (expectedWallet && candidate.controllerWallet.toLowerCase() !== expectedWallet.toLowerCase())) return null;
      const chainRestriction = parseApiKeyChainRestriction(candidate.chainRestriction);
      if (!chainRestriction) return null;
      apiKeys.push({ ...parsed, controllerWallet: candidate.controllerWallet, chainRestriction });
    } else apiKeys.push(parsed);
  }
  return apiKeys;
}

export function parseApiKeyMutationResult(
  value: unknown,
  status: number,
  expectedRotatedCredentialId?: string,
  expectedPurpose?: ApiKeyPurpose,
  expected?: Readonly<{ version: "v1" | "v2"; scopes: readonly string[] }>,
): ApiKeyMutationResult | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== (expected?.version === "v2" ? schemaVersionV2 : schemaVersion)
  ) {
    return null;
  }
  const apiKey = parseApiKeySummary(value.apiKey);
  const secretState = value.secretState;
  const hasSecret = Object.prototype.hasOwnProperty.call(value, "apiKeySecret");
  const hasRotatedCredentialId = Object.prototype.hasOwnProperty.call(
    value,
    "rotatedCredentialId",
  );
  if (
    !apiKey
    || (expected ? apiKey.scopes.length !== expected.scopes.length
      || !expected.scopes.every((scope) => apiKey.scopes.includes(scope))
      : apiKeyPurpose(apiKey.scopes) === null)
    || (expectedPurpose !== undefined && apiKeyPurpose(apiKey.scopes) !== expectedPurpose)
    || (secretState !== "delivered-once" && secretState !== "already-delivered")
    || (secretState === "delivered-once" && status !== 201)
    || (secretState === "already-delivered" && status !== 200)
    || (secretState === "delivered-once") !== hasSecret
    || (expectedRotatedCredentialId !== undefined) !== hasRotatedCredentialId
    || (expectedRotatedCredentialId !== undefined
      && (value.rotatedCredentialId !== expectedRotatedCredentialId
        || apiKey?.id === expectedRotatedCredentialId))
  ) return null;
  const rotation = expectedRotatedCredentialId === undefined
    ? {}
    : { rotatedCredentialId: expectedRotatedCredentialId };
  if (secretState === "already-delivered") {
    return { apiKey, secretState, ...rotation };
  }
  if (
    typeof value.apiKeySecret !== "string"
    || !apiKeySecretPattern.test(value.apiKeySecret)
    || !value.apiKeySecret.startsWith(`${apiKey.keyPrefix}_`)
  ) return null;
  return {
    apiKey,
    secretState,
    apiKeySecret: value.apiKeySecret,
    ...rotation,
  };
}

export function ApiKeyPermissions({ scopes }: Readonly<{ scopes: readonly string[] }>) {
  const purpose = apiKeyPurpose(scopes);
  const summary = purpose === "custom-launches" ? "Launch + read"
    : purpose === "module-contributions" ? "Submit + read"
      : scopes.length === 1 && scopes[0] === "custom-launch:read" ? "Read only"
        : scopes.length === 1 && scopes[0] === "custom-launch:create" ? "Launch only"
          : `${scopes.length} ${scopes.length === 1 ? "scope" : "scopes"}`;
  const descriptions: Readonly<Record<string, string>> = {
    "custom-launch:create": "Prepare launch requests. Your controller wallet must sign each transaction.",
    "custom-launch:read": "Read launch history across API keys and linked wallets in your account.",
    "modules:submit": "Submit module source packages for review. This does not approve or deploy a module.",
    "modules:read": "Read module submission status.",
  };
  return (
    <details className={styles.scopeLedger}>
      <summary><span>Permissions</span><strong>{summary}</strong></summary>
      <ul>{scopes.map((scope) => (
        <li key={scope}>
          <code>{scope}</code>
          <p>{descriptions[scope] ?? "Not recognized by this manager."}</p>
        </li>
      ))}</ul>
    </details>
  );
}

export function parseApiKeyChainRestriction(value: unknown): ApiKeyChainRestriction | null {
  if (!isRecord(value) || value.effectiveEligibility !== "evaluated-per-request") return null;
  const ids = value.allowedChainIds;
  if (ids === null) return value.mode === "legacy-policy-dependent"
    ? { allowedChainIds: null, mode: "legacy-policy-dependent", effectiveEligibility: "evaluated-per-request" } : null;
  if (value.mode !== "persisted" || !Array.isArray(ids) || ids.length < 1 || ids.length > 64
    || new Set(ids).size !== ids.length
    || ids.some((id) => typeof id !== "string" || !/^[1-9][0-9]{0,77}$/u.test(id))) return null;
  return { allowedChainIds: [...ids], mode: "persisted", effectiveEligibility: "evaluated-per-request" };
}

export function ApiKeyChainPolicy({ apiKey }: Readonly<{ apiKey: ApiKeySummary }>) {
  const restriction = apiKey.chainRestriction;
  return (
    <details className={styles.scopeLedger}>
      <summary><span>Chain restriction</span><strong>{!restriction ? "Not available"
        : restriction.allowedChainIds === null ? "Legacy policy"
          : restriction.allowedChainIds.map((id) => id === "1" ? "Ethereum (1)"
            : id === "4663" ? "Robinhood (4663)" : `Chain ${id}`).join(", ")}</strong></summary>
      <p className={styles.securityNote}>
        {!restriction ? "This service has not returned the key’s saved chain restriction. Refresh to check again."
          : restriction.allowedChainIds === null ? "This legacy key has no stored chain list. Access depends on the current policy and is checked for each request."
            : "This is the key’s saved chain restriction. Current access is checked for each request."}
      </p>
      {apiKey.controllerWallet ? <p className={styles.securityNote}>Controller wallet: <code>{apiKey.controllerWallet}</code></p> : null}
    </details>
  );
}

export function ApiKeyAccessChoice({ value, onChange, available, disabled }: Readonly<{
  value: ApiKeyAccess; onChange: (value: ApiKeyAccess) => void; available: boolean; disabled: boolean;
}>) {
  return (
    <fieldset className={styles.purposeField} disabled={disabled}>
      <legend>Access</legend>
      <div className={styles.purposeOptions}>
        <label><input type="radio" name="access" value="prepare-and-read" checked={value === "prepare-and-read"}
          onChange={() => onChange("prepare-and-read")} /><span>Launch + read</span></label>
        <label><input type="radio" name="access" value="read-only" checked={value === "read-only"}
          disabled={!available} aria-describedby="read-only-availability"
          onChange={() => onChange("read-only")} /><span>Read only</span></label>
      </div>
      <p id="read-only-availability" className={styles.purposeHint}>
        {!available ? "Read-only keys are temporarily unavailable. Refresh to check again."
          : value === "read-only" ? "Read account-wide launch history. Cannot prepare launches."
            : "Prepare launches and read account-wide history. Your wallet signs transactions."}
      </p>
    </fieldset>
  );
}

export function ApiKeyPurposeChoice({
  value,
  onChange,
  moduleContributionsAvailable,
  checking,
  disabled,
}: Readonly<{
  value: ApiKeyPurpose;
  onChange: (value: ApiKeyPurpose) => void;
  moduleContributionsAvailable: boolean;
  checking: boolean;
  disabled: boolean;
}>) {
  return (
    <fieldset className={styles.purposeField} disabled={disabled}>
      <legend>Purpose</legend>
      <div className={styles.purposeOptions}>
        <label>
          <input
            type="radio"
            name="purpose"
            value="custom-launches"
            checked={value === "custom-launches"}
            onChange={() => onChange("custom-launches")}
          />
          <span>Custom launches</span>
        </label>
        <label>
          <input
            type="radio"
            name="purpose"
            value="module-contributions"
            checked={value === "module-contributions"}
            disabled={!moduleContributionsAvailable}
            aria-describedby="module-key-availability"
            onChange={() => onChange("module-contributions")}
          />
          <span>Module contributions</span>
          {!moduleContributionsAvailable ? <small>Pending</small> : null}
        </label>
      </div>
      <p id="module-key-availability" className={styles.purposeHint} role="status">
        {checking
          ? "Checking module availability."
          : !moduleContributionsAvailable
            ? "Module contributions are not available right now."
            : value === "module-contributions"
              ? "Submit module packages and read their review status."
              : "Prepare launches and read their status."}
      </p>
    </fieldset>
  );
}

export function prepareApiKeyMutationAttempt(
  current: ApiKeyMutationAttempt | null,
  input: Readonly<{
    kind: "issue" | "rotate";
    credentialId: string | null;
    version: "v1" | "v2";
    body: string;
  }>,
  createIdempotencyKey: () => string,
) {
  if (
    current?.kind === input.kind
    && current.credentialId === input.credentialId
    && current.version === input.version
    && current.body === input.body
  ) return current;
  if (current) {
    throw new TypeError("An API key mutation retry is already pending");
  }
  const idempotencyKey = createIdempotencyKey();
  if (!idempotencyKeyPattern.test(idempotencyKey)) {
    throw new TypeError("API key mutation idempotency key is invalid");
  }
  return Object.freeze({ ...input, idempotencyKey });
}

export function apiKeyLifetimeDays(apiKey: ApiKeySummary) {
  if (!apiKey.expiresAt) return 90;
  const durationDays = (
    Date.parse(apiKey.expiresAt) - Date.parse(apiKey.createdAt)
  ) / 86_400_000;
  const roundedDurationDays = Math.round(durationDays);
  return Number.isFinite(durationDays)
    && roundedDurationDays >= 1
    && roundedDurationDays <= 366
    ? roundedDurationDays
    : 90;
}

export function applyApiKeyMutationResult(
  current: readonly ApiKeySummary[],
  result: ApiKeyMutationResult,
  revokedAt: string,
) {
  const rotatedCredentialId = result.rotatedCredentialId;
  const updated = current.map((candidate) =>
    candidate.id === rotatedCredentialId
      ? { ...candidate, revokedAt: latestNullableTimestamp(
          candidate.revokedAt,
          revokedAt,
        ) }
      : candidate
  );
  return [
    result.apiKey,
    ...updated.filter((candidate) => candidate.id !== result.apiKey.id),
  ];
}

function latestNullableTimestamp(
  current: string | null,
  incoming: string | null,
) {
  if (!current) return incoming;
  if (!incoming) return current;
  const currentTime = Date.parse(current);
  const incomingTime = Date.parse(incoming);
  if (!Number.isFinite(currentTime)) return incoming;
  if (!Number.isFinite(incomingTime)) return current;
  return incomingTime > currentTime ? incoming : current;
}

export function mergeApiKeySummaries(
  current: readonly ApiKeySummary[],
  incoming: readonly ApiKeySummary[],
) {
  const currentById = new Map(
    current.map((apiKey) => [apiKey.id, apiKey] as const),
  );
  const incomingIds = new Set(incoming.map((apiKey) => apiKey.id));
  return [
    ...incoming.map((apiKey) => {
      const existing = currentById.get(apiKey.id);
      if (!existing) return apiKey;
      return {
        ...apiKey,
        lastUsedAt: latestNullableTimestamp(
          existing.lastUsedAt,
          apiKey.lastUsedAt,
        ),
        revokedAt: latestNullableTimestamp(
          existing.revokedAt,
          apiKey.revokedAt,
        ),
      };
    }),
    ...current.filter((apiKey) => !incomingIds.has(apiKey.id)),
  ];
}

function readApiError(response: Response, value: unknown, fallback: string) {
  if (!isRecord(value) || !isRecord(value.error)) return fallback;
  const recovery = value.error.code === "API_KEY_ROTATION_RESTRICTION"
    ? "The replacement could not keep this key’s current restrictions. The original key is still active."
    : value.error.code === "API_KEY_CAPABILITY_UNAVAILABLE"
      ? "This key operation is temporarily unavailable. Refresh, then retry the same request."
      : null;
  const message = recovery ?? (typeof value.error.message === "string" && value.error.message.trim()
    ? value.error.message
    : fallback);
  const requestId = typeof value.error.requestId === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,127}$/u.test(value.error.requestId)
    ? value.error.requestId
    : null;
  const retryAfter = response.headers.get("retry-after");
  const retryCopy = (response.status === 429 || response.status === 503)
    && retryAfter !== null
    && /^[1-9][0-9]{0,4}$/u.test(retryAfter)
    ? ` Try again in ${retryAfter} seconds.`
    : "";
  const requestCopy = requestId ? ` Request ID: ${requestId}.` : "";
  return `${message}${retryCopy}${requestCopy}`;
}

export function shouldRetainApiKeyMutationAttempt(
  status: number,
  value: unknown,
) {
  const code = isRecord(value) && isRecord(value.error)
    && typeof value.error.code === "string"
    ? value.error.code
    : null;
  return status === 408
    || status === 429
    || status >= 500
    || code === "BFF_ASSERTION_REPLAYED";
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function formatDate(value: string | null, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : dateFormatter.format(date);
}

function keyStatus(key: ApiKeySummary) {
  if (key.revokedAt) return "Revoked";
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()) {
    return "Expired";
  }
  return "Active";
}

function displayPrefix(prefix: string) {
  return prefix.endsWith("…") || prefix.endsWith("...") ? prefix : `${prefix}…`;
}

async function copyToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Clipboard access is unavailable");
}

function KeyListSkeleton() {
  return (
    <>
      <span className={styles.visuallyHidden} role="status">
        Loading API keys
      </span>
      <div className={styles.skeletonList} aria-hidden="true">
        {Array.from({ length: API_KEY_PAGE_SIZE }, (_, index) => (
          <div className={styles.skeletonRow} key={index}>
            <span className={styles.skeletonTitle} />
            <span className={styles.skeletonLine} />
            <span className={styles.skeletonLineShort} />
          </div>
        ))}
      </div>
    </>
  );
}

function ExpirySelect({
  onChange,
  value,
  disabled = false,
}: Readonly<{
  onChange: (value: ExpiryDays) => void;
  value: ExpiryDays;
  disabled?: boolean;
}>) {
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(
    0,
    expiryOptions.findIndex((option) => option.value === value),
  );
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = expiryOptions[selectedIndex];

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (
        event.target instanceof Node
        && !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener(
      "pointerdown",
      closeOnOutsidePress,
    );
  }, [open]);

  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.focus();
  }, [activeIndex, open]);

  const openListbox = (index = selectedIndex) => {
    setActiveIndex(index);
    setOpen(true);
  };

  const closeListbox = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  };

  const selectOption = (index: number) => {
    const option = expiryOptions[index];
    if (!option) return;
    onChange(option.value);
    closeListbox();
  };

  const handleOptionKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index + 1) % expiryOptions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index - 1 + expiryOptions.length) % expiryOptions.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(expiryOptions.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeListbox();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectOption(index);
    }
  };

  return (
    <div className={styles.field}>
      <span id="api-key-expiry-label">Expires after</span>
      <input name="expiresInDays" type="hidden" value={value} />
      <div
        className={styles.expirySelect}
        ref={rootRef}
        onBlurCapture={(event) => {
          if (
            event.relatedTarget instanceof Node
            && event.currentTarget.contains(event.relatedTarget)
          ) return;
          setOpen(false);
        }}
      >
        <button
          ref={triggerRef}
          disabled={disabled}
          className={styles.expiryTrigger}
          type="button"
          aria-controls="api-key-expiry-listbox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-labelledby="api-key-expiry-label api-key-expiry-value"
          onClick={() => {
            if (open) closeListbox(false);
            else openListbox();
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              openListbox(selectedIndex);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              openListbox(expiryOptions.length - 1);
            } else if (event.key === "Escape" && open) {
              event.preventDefault();
              closeListbox();
            }
          }}
        >
          <span id="api-key-expiry-value">{selected.label}</span>
          <ChevronDown aria-hidden="true" size={17} strokeWidth={1.8} />
        </button>
        {open ? (
          <div
            id="api-key-expiry-listbox"
            className={styles.expiryMenu}
            role="listbox"
            aria-labelledby="api-key-expiry-label"
          >
            {expiryOptions.map((option, index) => {
              const selectedOption = option.value === value;
              return (
                <button
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  className={styles.expiryOption}
                  type="button"
                  role="option"
                  aria-selected={selectedOption}
                  data-active={activeIndex === index ? "true" : "false"}
                  tabIndex={activeIndex === index ? 0 : -1}
                  key={option.value}
                  onClick={() => selectOption(index)}
                  onKeyDown={(event) => handleOptionKeyDown(event, index)}
                >
                  <span>{option.label}</span>
                  {selectedOption ? (
                    <Check aria-hidden="true" size={15} strokeWidth={2.1} />
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function DeveloperApiKeys({
  initialSection = "keys",
  agentSetupText = PROGRAMMABLE_AGENT_SETUP_TEXT_V1,
  moduleAgentSetupText = PROGRAMMABLE_MODULE_AGENT_SETUP_TEXT_V1,
}: DeveloperApiKeysProps) {
  const {
    sessionReady: authReady,
    connecting,
    getAccessToken,
    getIdentityToken,
    openWallet,
    sendCustomLaunchWalletAction,
    sendCustomLaunchWalletActionV4,
    signCustomLaunchFundingAuthorization,
    wallet,
  } = useWallet();
  const account = wallet?.account ?? null;
  const viewKey = authReady ? (account ?? "disconnected") : "loading";

  return (
    <DeveloperApiKeysView
      key={viewKey}
      account={account}
      authReady={authReady}
      connecting={connecting}
      getAccessToken={getAccessToken}
      getIdentityToken={getIdentityToken}
      initialSection={initialSection}
      agentSetupText={agentSetupText}
      moduleAgentSetupText={moduleAgentSetupText}
      openWallet={openWallet}
      sendCustomLaunchWalletAction={sendCustomLaunchWalletAction}
      sendCustomLaunchWalletActionV4={sendCustomLaunchWalletActionV4}
      signCustomLaunchFundingAuthorization={
        signCustomLaunchFundingAuthorization
      }
    />
  );
}

export function DeveloperApiKeysView({
  account,
  authReady,
  connecting,
  getAccessToken,
  getIdentityToken,
  initialSection,
  agentSetupText = PROGRAMMABLE_AGENT_SETUP_TEXT_V1,
  moduleAgentSetupText = PROGRAMMABLE_MODULE_AGENT_SETUP_TEXT_V1,
  openWallet,
  sendCustomLaunchWalletAction,
  sendCustomLaunchWalletActionV4,
  signCustomLaunchFundingAuthorization,
}: DeveloperApiKeysViewProps) {
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[]>([]);
  const [listState, setListState] = useState<ListState>(() =>
    account ? "loading" : "idle",
  );
  const [listError, setListError] = useState("");
  const [label, setLabel] = useState("");
  const [purpose, setPurpose] = useState<ApiKeyPurpose>("custom-launches");
  const [access, setAccess] = useState<ApiKeyAccess>("prepare-and-read");
  const [capabilities, setCapabilities] = useState<ApiKeyCapabilities | null>(null);
  const [moduleContributionsAvailable, setModuleContributionsAvailable] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState<ExpiryDays>(90);
  const [labelError, setLabelError] = useState("");
  const [mutationState, setMutationState] = useState<ApiKeyMutationState>({
    kind: "idle",
  });
  const [createError, setCreateError] = useState("");
  const [mutationResult, setMutationResult] =
    useState<VisibleApiKeyMutationResult | null>(null);
  const [keyCopyState, setKeyCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [setupCopyState, setSetupCopyState] = useState<
    "idle" | "copied" | "error"
  >(
    "idle",
  );
  const [confirmingRevokeId, setConfirmingRevokeId] = useState<string | null>(
    null,
  );
  const [confirmingRotateId, setConfirmingRotateId] = useState<string | null>(
    null,
  );
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState("");
  const [rotateError, setRotateError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [activeSection, setActiveSection] = useState<ActiveSection>(
    initialSection,
  );
  const [initialLaunchId, setInitialLaunchId] = useState<string | null>(null);
  const [initialLaunchChainId, setInitialLaunchChainId] = useState<"4663" | null>(null);
  const [refreshingKeys, setRefreshingKeys] = useState(false);
  const [keyPage, setKeyPage] = useState(1);
  const [walletSessionTimedOut, setWalletSessionTimedOut] = useState(false);
  const labelRef = useRef<HTMLInputElement>(null);
  const revealRef = useRef<HTMLDivElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const returnKeyActionFocusRef = useRef<Readonly<{ credentialId: string; action: "rotate" | "revoke" }> | null>(null);
  const confirmRevokeRef = useRef<HTMLButtonElement>(null);
  const confirmRotateRef = useRef<HTMLButtonElement>(null);
  const mutationInFlightRef = useRef(false);
  const [pendingMutationAttempt, setPendingMutationAttempt] = useState<ApiKeyMutationAttempt | null>(null);
  const capabilityReadGenerationRef = useRef(0);
  const canIssueReadOnly = Boolean(capabilities?.restrictedIssuance && capabilities.preservingRotation);
  const selectedScopes = purpose === "module-contributions" ? moduleScopes
    : access === "read-only" ? readOnlyScopes : fixedScopes;
  const keyItemRefs = useRef(new Map<string, HTMLLIElement>());
  const apiKeyReadGenerationRef = useRef(0);
  const keyPageCount = Math.max(
    1,
    Math.ceil(apiKeys.length / API_KEY_PAGE_SIZE),
  );
  const activeKeyPage = Math.min(keyPage, keyPageCount);
  const visibleApiKeys = apiKeys.slice(
    (activeKeyPage - 1) * API_KEY_PAGE_SIZE,
    activeKeyPage * API_KEY_PAGE_SIZE,
  );

  const getAuthHeaders = useCallback(
    async (json = false) => {
      // Privy may refresh the identity session while resolving this token.
      // Read the access token afterwards so both headers describe one session.
      const identityToken = await getIdentityToken().catch(() => null);
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error(
          "Your wallet session expired. Reconnect your wallet and try again.",
        );
      }

      const headers = new Headers({
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      });
      if (identityToken) {
        headers.set("X-Privy-Identity-Token", identityToken);
      }
      if (json) headers.set("Content-Type", "application/json");
      return headers;
    },
    [getAccessToken, getIdentityToken],
  );

  const loadApiKeys = useCallback(
    async (
      walletAddress: string,
      signal?: AbortSignal,
      mode: ApiKeyLoadMode = "initial",
    ) => {
      const readGeneration = ++apiKeyReadGenerationRef.current;
      const refreshRequest = mode !== "initial";
      try {
        const headers = await getAuthHeaders();
        const query = `?walletAddress=${encodeURIComponent(walletAddress)}`;
        let response = await fetch(`/api/developer/api-keys/v2${query}`, {
          cache: "no-store", headers, signal,
        }).catch(() => null);
        let body = response?.ok ? await readJson(response) : null;
        let parsed = response?.ok ? parseApiKeyList(body, walletAddress) : null;
        // Read-only compatibility fallback. Mutation routes never fall back.
        if (!parsed) {
          response = await fetch(`/api/developer/api-keys${query}`, { cache: "no-store", headers, signal });
          body = await readJson(response);
          parsed = response.ok ? parseApiKeyList(body) : null;
        }
        if (!parsed) throw new Error(response?.ok
          ? "Programmable could not verify the API key list. Refresh and try again."
          : response ? readApiError(response, body, "Unable to load API keys.") : "Unable to load API keys.");
        if (readGeneration !== apiKeyReadGenerationRef.current) return;
        setApiKeys((current) => mergeApiKeySummaries(current, parsed));
        setModuleContributionsAvailable(moduleContributionKeysAvailable(body));
        setListState("ready");
        if (mode === "refresh") setStatusMessage("API keys refreshed.");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        if (readGeneration !== apiKeyReadGenerationRef.current) return;
        setModuleContributionsAvailable(false);
        setListError(
          error instanceof Error ? error.message : "Unable to load API keys.",
        );
        if (!refreshRequest) setListState("error");
      } finally {
        if (
          refreshRequest
          && readGeneration === apiKeyReadGenerationRef.current
        ) {
          setRefreshingKeys(false);
        }
      }
    },
    [getAuthHeaders],
  );

  const loadCapabilities = useCallback(async (walletAddress: string, signal?: AbortSignal) => {
    const generation = ++capabilityReadGenerationRef.current;
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `/api/developer/api-keys/v2/capabilities?walletAddress=${encodeURIComponent(walletAddress)}`,
        { cache: "no-store", headers, signal },
      );
      const parsed = response.ok ? parseApiKeyCapabilities(await readJson(response)) : null;
      if (generation === capabilityReadGenerationRef.current && !signal?.aborted) {
        setCapabilities(parsed);
      }
    } catch {
      if (generation === capabilityReadGenerationRef.current && !signal?.aborted) {
        setCapabilities(null);
      }
    }
  }, [getAuthHeaders]);

  const refreshApiKeys = () => {
    if (!account || listState === "loading" || refreshingKeys) return;
    setRefreshingKeys(true);
    setListError("");
    setStatusMessage("Refreshing API keys.");
    void loadApiKeys(account, undefined, "refresh");
    void loadCapabilities(account);
  };

  const refreshApiKeysAfterMutation = (walletAddress: string) => {
    apiKeyReadGenerationRef.current += 1;
    setRefreshingKeys(true);
    setListError("");
    void loadApiKeys(walletAddress, undefined, "mutation");
  };

  useEffect(() => {
    if (!authReady || !account) return;

    const controller = new AbortController();
    const initialRead = window.setTimeout(() => {
      void loadApiKeys(account, controller.signal);
      void loadCapabilities(account, controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(initialRead);
      controller.abort();
    };
  }, [account, authReady, loadApiKeys, loadCapabilities]);

  useEffect(() => {
    if (mutationResult) revealRef.current?.focus();
  }, [mutationResult]);

  useEffect(() => {
    if (confirmingRevokeId) confirmRevokeRef.current?.focus();
  }, [confirmingRevokeId]);

  useEffect(() => {
    if (confirmingRotateId) confirmRotateRef.current?.focus();
  }, [confirmingRotateId]);

  useEffect(() => {
    if (confirmingRevokeId || confirmingRotateId) return;
    const target = returnKeyActionFocusRef.current;
    returnKeyActionFocusRef.current = null;
    if (!target) return;
    // The confirmation unmounts its trigger. Find the replacement after React
    // commits it, falling back to the key row if the action is no longer offered.
    const row = keyItemRefs.current.get(target.credentialId);
    const button = row?.querySelector<HTMLButtonElement>(
      `[data-key-action="${target.action}"]`,
    );
    (button ?? row)?.focus();
  }, [confirmingRevokeId, confirmingRotateId]);

  useEffect(() => {
    if (authReady) return;
    const timeoutId = window.setTimeout(() => {
      setWalletSessionTimedOut(true);
    }, 8_000);
    return () => window.clearTimeout(timeoutId);
  }, [authReady]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (
      url.searchParams.get("start") === "custom"
      && url.searchParams.get("chainId") === "4663"
    ) {
      const update = window.setTimeout(() => {
        setActiveSection("launch");
        setStatusMessage("Opening Robinhood Custom launch.");
      }, 0);
      return () => window.clearTimeout(update);
    }
    const candidate = url.searchParams.get("launchId");
    if (!candidate || !launchRequestIdPattern.test(candidate)) return;
    const chainId = url.searchParams.get("chainId");
    const update = window.setTimeout(() => {
      setInitialLaunchId(candidate);
      setInitialLaunchChainId(chainId === "4663" ? "4663" : null);
      setActiveSection("history");
      setStatusMessage("Opening the requested launch handoff.");
    }, 0);
    return () => window.clearTimeout(update);
  }, []);

  const createApiKey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !account
      || mutationState.kind !== "idle"
      || mutationInFlightRef.current
    ) return;
    if (mutationResult?.result.secretState === "delivered-once") {
      setStatusMessage("Save the visible API key before creating another.");
      revealRef.current?.focus();
      return;
    }
    if (purpose === "module-contributions" && !moduleContributionsAvailable
      && pendingMutationAttempt?.kind !== "issue") {
      setCreateError("Module contributions are not available right now. Refresh your keys to check again.");
      return;
    }

    const cleanLabel = label.trim();
    if (!cleanLabel) {
      setLabelError("Enter a name for this key.");
      labelRef.current?.focus();
      return;
    }
    if (cleanLabel.length > 64) {
      setLabelError("Use 64 characters or fewer.");
      labelRef.current?.focus();
      return;
    }

    setLabelError("");
    setCreateError("");
    setKeyCopyState("idle");
    setSetupCopyState("idle");
    const version = pendingMutationAttempt?.kind === "issue" ? pendingMutationAttempt.version
      : purpose === "module-contributions" ? "v1" : apiKeyIssueVersion(access, capabilities);
    if (!version) {
      setCreateError("Read-only keys are temporarily unavailable. Refresh your keys and try again.");
      return;
    }
    const body = JSON.stringify({
      expiresInDays,
      label: cleanLabel,
      schemaVersion: version === "v2" ? schemaVersionV2 : schemaVersion,
      walletAddress: account,
      ...(version === "v2" ? { scopes: selectedScopes } : {}),
      ...(purpose === "module-contributions" ? { purpose } : {}),
    });
    let attempt: ApiKeyMutationAttempt;
    try {
      attempt = prepareApiKeyMutationAttempt(
        pendingMutationAttempt,
        { kind: "issue", credentialId: null, version, body },
        () => crypto.randomUUID(),
      );
    } catch {
      setCreateError(
        "Retry the previous API key request before starting another.",
      );
      return;
    }
    setPendingMutationAttempt(attempt);
    mutationInFlightRef.current = true;
    setMutationState({ kind: "issue" });
    try {
      const headers = await getAuthHeaders(true);
      headers.set("Idempotency-Key", attempt.idempotencyKey);
      const response = await fetch(apiKeyMutationPath(attempt), {
        body: attempt.body,
        headers,
        method: "POST",
      });
      const responseBody = await readJson(response);
      if (!response.ok) {
        if (!shouldRetainApiKeyMutationAttempt(response.status, responseBody)) {
          setPendingMutationAttempt(null);
        }
        throw new Error(readApiError(
          response,
          responseBody,
          "Unable to create the API key.",
        ));
      }
      const parsed = parseApiKeyMutationResult(responseBody, response.status, undefined,
        purpose === "module-contributions" ? purpose : undefined,
        { version: attempt.version, scopes: selectedScopes });
      if (!parsed) {
        throw new Error(
          "The key may have been created, but the response could not be verified. Refresh your keys before trying again.",
        );
      }

      setPendingMutationAttempt(null);
      setApiKeys((current) => applyApiKeyMutationResult(
        current,
        parsed,
        new Date().toISOString(),
      ));
      setListState("ready");
      setMutationResult({ operation: "issue", result: parsed });
      setKeyPage(1);
      setLabel("");
      setStatusMessage(parsed.secretState === "delivered-once"
        ? `${parsed.apiKey.label} was created. Save the secret now because it will not be shown again.`
        : `${parsed.apiKey.label} was already created. Its one-time secret cannot be shown again.`);
      refreshApiKeysAfterMutation(account);
    } catch (error) {
      setCreateError(
        error instanceof Error
          ? error.message
          : "Unable to create the API key.",
      );
    } finally {
      mutationInFlightRef.current = false;
      setMutationState({ kind: "idle" });
    }
  };

  const copyApiKey = async () => {
    if (mutationResult?.result.secretState !== "delivered-once") return;
    try {
      await copyToClipboard(mutationResult.result.apiKeySecret);
      setKeyCopyState("copied");
      setStatusMessage("API key copied.");
    } catch {
      setKeyCopyState("error");
      setStatusMessage("Copy failed. Select the key and copy it manually.");
    }
  };

  const copyAgentSetup = async () => {
    try {
      await copyToClipboard(purpose === "module-contributions"
        ? moduleAgentSetupText
        : access === "read-only" ? PROGRAMMABLE_READ_ONLY_AGENT_SETUP_TEXT : agentSetupText);
      setSetupCopyState("copied");
      setStatusMessage("Agent setup copied without the API key.");
    } catch {
      setSetupCopyState("error");
      setStatusMessage("Agent setup could not be copied.");
    }
  };

  const dismissApiKeyResult = (focusReplacement = false) => {
    const result = mutationResult;
    setMutationResult(null);
    setKeyCopyState("idle");
    setSetupCopyState("idle");
    setStatusMessage(result?.result.secretState === "delivered-once"
      ? "Key hidden."
      : "Secret recovery notice closed.");
    window.setTimeout(() => {
      if (result && (focusReplacement || result.operation === "rotate")) {
        keyItemRefs.current.get(result.result.apiKey.id)?.focus();
      } else {
        createButtonRef.current?.focus();
      }
    }, 0);
  };

  const showSection = (section: ActiveSection) => {
    setActiveSection(section);
    const url = new URL(window.location.href);
    if (section === "launch") {
      url.searchParams.set("start", "custom");
      url.searchParams.set("chainId", "4663");
      url.searchParams.delete("launchId");
      setInitialLaunchId(null);
      setInitialLaunchChainId(null);
    } else {
      url.searchParams.delete("start");
      if (section === "keys") {
        url.searchParams.delete("launchId");
        url.searchParams.delete("chainId");
        setInitialLaunchId(null);
        setInitialLaunchChainId(null);
      } else if (!url.searchParams.has("launchId")) {
        url.searchParams.delete("chainId");
      }
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    setStatusMessage(
      section === "keys"
        ? "Showing API keys."
        : section === "launch"
          ? "Showing Robinhood Custom launch."
          : "Showing launch history.",
    );
  };

  const openRobinhoodLaunchHistory = (launchId: string) => {
    setInitialLaunchId(launchId);
    setInitialLaunchChainId("4663");
    setActiveSection("history");
    const url = new URL(window.location.href);
    url.searchParams.delete("start");
    url.searchParams.set("launchId", launchId);
    url.searchParams.set("chainId", "4663");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    setStatusMessage("Opening the new Robinhood launch in history.");
  };

  const beginRevoke = (apiKeyId: string) => {
    if (mutationState.kind !== "idle" || mutationInFlightRef.current) return;
    returnKeyActionFocusRef.current = null;
    setConfirmingRotateId(null);
    setRotateError("");
    setRevokeError("");
    setConfirmingRevokeId(apiKeyId);
  };

  const cancelRevoke = () => {
    if (confirmingRevokeId) returnKeyActionFocusRef.current = { credentialId: confirmingRevokeId, action: "revoke" };
    setConfirmingRevokeId(null);
    setRevokeError("");
  };

  const beginRotate = (apiKeyId: string) => {
    if (mutationState.kind !== "idle" || mutationInFlightRef.current) return;
    if (mutationResult?.result.secretState === "delivered-once") {
      setStatusMessage("Save the visible API key before rotating another.");
      revealRef.current?.focus();
      return;
    }
    returnKeyActionFocusRef.current = null;
    setConfirmingRevokeId(null);
    setRevokeError("");
    setRotateError("");
    setConfirmingRotateId(apiKeyId);
  };

  const cancelRotate = () => {
    if (confirmingRotateId) returnKeyActionFocusRef.current = { credentialId: confirmingRotateId, action: "rotate" };
    setConfirmingRotateId(null);
    setRotateError("");
  };

  const rotateApiKey = async (apiKey: ApiKeySummary) => {
    if (
      !account
      || mutationState.kind !== "idle"
      || mutationInFlightRef.current
      || revokingId !== null
    ) return;
    const originalPurpose = apiKeyPurpose(apiKey.scopes) ?? "custom-launches";
    const version = pendingMutationAttempt?.kind === "rotate" && pendingMutationAttempt.credentialId === apiKey.id
      ? pendingMutationAttempt.version : apiKeyRotationVersion(apiKey.scopes, capabilities);
    if (!version) {
      setRotateError("Rotation is unavailable until this key’s restrictions can be preserved.");
      return;
    }
    const body = JSON.stringify({
      expiresInDays: apiKeyLifetimeDays(apiKey),
      label: apiKey.label,
      schemaVersion: version === "v2" ? schemaVersionV2 : schemaVersion,
      walletAddress: account,
    });
    let attempt: ApiKeyMutationAttempt;
    try {
      attempt = prepareApiKeyMutationAttempt(
        pendingMutationAttempt,
        { kind: "rotate", credentialId: apiKey.id, version, body },
        () => crypto.randomUUID(),
      );
    } catch {
      setRotateError(
        "Retry the previous API key request before starting another.",
      );
      return;
    }
    setPendingMutationAttempt(attempt);
    mutationInFlightRef.current = true;
    setRotateError("");
    setMutationState({ kind: "rotate", credentialId: apiKey.id });
    try {
      const headers = await getAuthHeaders(true);
      headers.set("Idempotency-Key", attempt.idempotencyKey);
      const response = await fetch(
        apiKeyMutationPath(attempt),
        { body: attempt.body, headers, method: "POST" },
      );
      const responseBody = await readJson(response);
      if (!response.ok) {
        if (!shouldRetainApiKeyMutationAttempt(response.status, responseBody)) {
          setPendingMutationAttempt(null);
        }
        throw new Error(readApiError(
          response,
          responseBody,
          "Unable to rotate the API key.",
        ));
      }
      const parsed = parseApiKeyMutationResult(
        responseBody,
        response.status,
        apiKey.id,
        undefined,
        { version: attempt.version, scopes: apiKey.scopes },
      );
      if (!parsed) {
        throw new Error(
          "The key may have been rotated, but the response could not be verified. Refresh your keys before trying again.",
        );
      }

      setPendingMutationAttempt(null);
      setApiKeys((current) => applyApiKeyMutationResult(
        current,
        parsed,
        new Date().toISOString(),
      ));
      setListState("ready");
      setMutationResult({ operation: "rotate", result: parsed });
      setPurpose(originalPurpose);
      setAccess(hasReadOnlyScopes(parsed.apiKey.scopes) ? "read-only" : "prepare-and-read");
      setKeyPage(1);
      setConfirmingRotateId(null);
      setStatusMessage(parsed.secretState === "delivered-once"
        ? `${apiKey.label} was rotated. Save the replacement secret now because it will not be shown again.`
        : `${apiKey.label} was already rotated. The replacement secret cannot be shown again.`);
      refreshApiKeysAfterMutation(account);
    } catch (error) {
      setRotateError(
        error instanceof Error
          ? error.message
          : "Unable to rotate the API key.",
      );
    } finally {
      mutationInFlightRef.current = false;
      setMutationState({ kind: "idle" });
    }
  };

  const revokeApiKey = async (apiKey: ApiKeySummary) => {
    if (
      !account
      || revokingId
      || mutationState.kind !== "idle"
      || mutationInFlightRef.current
    ) return;
    setRevokeError("");
    setRevokingId(apiKey.id);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `/api/developer/api-keys/${encodeURIComponent(apiKey.id)}?walletAddress=${encodeURIComponent(account)}`,
        { headers, method: "DELETE" },
      );
      const body = await readJson(response);
      if (!response.ok) {
        throw new Error(readApiError(
          response,
          body,
          "Unable to revoke the API key.",
        ));
      }
      if (
        !isRecord(body) ||
        body.schemaVersion !== schemaVersion ||
        body.revoked !== true ||
        body.credentialId !== apiKey.id
      ) {
        throw new Error(
          "The key may have been revoked, but the response could not be verified. Refresh your keys before trying again.",
        );
      }

      setApiKeys((current) =>
        current.map((candidate) =>
          candidate.id === apiKey.id
            ? { ...candidate, revokedAt: new Date().toISOString() }
            : candidate,
        ),
      );
      returnKeyActionFocusRef.current = { credentialId: apiKey.id, action: "revoke" };
      setConfirmingRevokeId(null);
      setStatusMessage(`${apiKey.label} was revoked.`);
      refreshApiKeysAfterMutation(account);
      } catch (error) {
      setRevokeError(
        error instanceof Error
          ? error.message
          : "Unable to revoke the API key.",
      );
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className={`${styles.page} page-width`}>
      <p
        className={styles.visuallyHidden}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {statusMessage}
      </p>

      <Link className={styles.backLink} href="/launch">
        <ArrowLeft aria-hidden="true" size={16} strokeWidth={1.9} />
        <span>Back</span>
      </Link>

      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <h1>API keys</h1>
          <p className={styles.intro}>
            Manage access for launch agents and module contributors.
          </p>
        </div>
      </header>

      {activeSection === "launch" ? (
        <RobinhoodFeePolicyDisclosure />
      ) : null}

      {!authReady ? (
        walletSessionTimedOut ? (
          <section className={styles.walletGate} role="alert">
            <div className={styles.walletGateCopy}>
              <h2>Wallet access is unavailable</h2>
              <p>Reload the page or try again shortly.</p>
            </div>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => window.location.reload()}
            >
              Reload page
            </button>
          </section>
        ) : (
          <section className={styles.walletGate} aria-busy="true">
            <div className={styles.walletGateCopy} aria-hidden="true">
              <span className={styles.walletGateTitle} />
              <span className={styles.walletGateLine} />
            </div>
            <span className={styles.visuallyHidden} role="status">
              Loading wallet session
            </span>
          </section>
        )
      ) : !account ? (
        <section className={styles.walletGate} aria-labelledby="connect-title">
          <div className={styles.walletGateCopy}>
            <h2 id="connect-title">Connect your wallet</h2>
            <p>Connect to view and manage your API keys.</p>
          </div>
          <button
            className={styles.primaryButton}
            disabled={connecting}
            type="button"
            onClick={openWallet}
          >
            {connecting ? "Opening wallet" : "Connect wallet"}
          </button>
        </section>
      ) : (
        <>
          {mutationResult ? (
            <div
              ref={revealRef}
              className={styles.keyReveal}
              role="region"
              tabIndex={-1}
              aria-labelledby="api-key-mutation-result-title"
            >
              <div className={styles.revealHeading}>
                <div>
                  <p className={styles.kicker}>
                    {mutationResult.operation === "rotate"
                      ? "Rotated"
                      : "Created"}
                  </p>
                  <h2 id="api-key-mutation-result-title">
                    {mutationResult.result.secretState === "delivered-once"
                      ? mutationResult.operation === "rotate"
                        ? "Save the new key now"
                        : "Save this key now"
                      : "Secret no longer available"}
                  </h2>
                </div>
                <span className={styles.oneTimeBadge}>
                  {mutationResult.result.secretState === "delivered-once"
                    ? "Shown once"
                    : "Already delivered"}
                </span>
              </div>
              <p className={styles.securityNote}>
                Purpose: {apiKeyPurposeLabel(mutationResult.result.apiKey.scopes)}
              </p>
              {mutationResult.result.secretState === "delivered-once" ? (
                <>
                  <p className={styles.revealWarning}>
                    {mutationResult.operation === "rotate"
                      ? "The previous key is revoked. Copy this replacement secret now; it will not be shown again."
                      : "Copy this secret now. It will not be shown again."}{" "}
                    Store it in encrypted secrets or the environment, never in
                    chat, a prompt, source code, or command history.
                  </p>
                  <div className={styles.secretRow}>
                    <code>{mutationResult.result.apiKeySecret}</code>
                    <div className={styles.secretActions}>
                      <button
                        className={styles.secondaryButton}
                        type="button"
                        onClick={() => void copyApiKey()}
                      >
                        {keyCopyState === "copied" ? "Copied" : "Copy key"}
                      </button>
                    </div>
                  </div>
                  {keyCopyState === "error" ? (
                    <p className={styles.inlineError} role="alert">
                      Copy failed. Select the key and copy it manually.
                    </p>
                  ) : null}
                  <button
                    className={styles.dismissButton}
                    type="button"
                    onClick={() => dismissApiKeyResult()}
                  >
                    I saved this key
                  </button>
                </>
              ) : (
                <>
                  <p className={styles.revealWarning}>
                    This operation completed earlier. The service cannot return
                    its one-time secret again. Find the replacement below and
                    refresh to check rotation availability if you did not save the secret.
                  </p>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    onClick={() => dismissApiKeyResult(true)}
                  >
                    Find key to rotate
                  </button>
                </>
              )}
            </div>
          ) : null}

          <nav
            className={styles.sectionSwitch}
            aria-label="Developer access view"
          >
            <button
              aria-pressed={activeSection === "keys"}
              type="button"
              onClick={() => showSection("keys")}
            >
              API keys
            </button>
            <button
              aria-pressed={activeSection === "launch"}
              type="button"
              onClick={() => showSection("launch")}
            >
              Launch
            </button>
            <button
              aria-pressed={activeSection === "history"}
              type="button"
              onClick={() => showSection("history")}
            >
              Launch history
            </button>
          </nav>

          {activeSection === "keys" ? (
            <div className={styles.workspace}>
              <section
                className={`${styles.panel} ${styles.createPanel}`}
                aria-labelledby="create-key-title"
                aria-busy={mutationState.kind === "issue"}
              >
                <div className={styles.panelHeading}>
                  <h2 id="create-key-title">Create key</h2>
                </div>

                <form className={styles.createForm} onSubmit={createApiKey}>
                  <ApiKeyPurposeChoice
                    value={purpose}
                    onChange={(value) => {
                      setPurpose(value);
                      setCreateError("");
                      setSetupCopyState("idle");
                    }}
                    moduleContributionsAvailable={moduleContributionsAvailable}
                    checking={listState === "loading"}
                    disabled={mutationState.kind !== "idle"
                      || mutationResult?.result.secretState === "delivered-once" || pendingMutationAttempt !== null}
                  />
                  {purpose === "custom-launches" ? (
                    <ApiKeyAccessChoice value={access} onChange={setAccess} available={canIssueReadOnly}
                      disabled={mutationState.kind !== "idle" || pendingMutationAttempt !== null
                        || mutationResult?.result.secretState === "delivered-once"} />
                  ) : null}
                  <div className={styles.formFields}>
                    <div>
                      <label className={styles.field} htmlFor="api-key-label">
                        <span>Name</span>
                        <input
                          ref={labelRef}
                          id="api-key-label"
                          aria-describedby={
                            labelError ? "api-key-label-error" : undefined
                          }
                          aria-invalid={Boolean(labelError)}
                          autoComplete="off"
                          maxLength={64}
                          name="label"
                          placeholder={purpose === "module-contributions" ? "Module agent" : "Launch agent"}
                          spellCheck={false}
                          type="text"
                          value={label}
                          readOnly={pendingMutationAttempt !== null}
                          onChange={(event) => {
                            setLabel(event.target.value);
                            if (labelError) setLabelError("");
                          }}
                        />
                      </label>
                      {labelError ? (
                        <p
                          className={styles.inlineError}
                          id="api-key-label-error"
                        >
                          {labelError}
                        </p>
                      ) : null}
                    </div>

                    <ExpirySelect
                      value={expiresInDays}
                      disabled={pendingMutationAttempt !== null}
                      onChange={setExpiresInDays}
                    />

                    <button
                      ref={createButtonRef}
                      className={styles.primaryButton}
                      disabled={
                        mutationState.kind !== "idle"
                        || mutationResult?.result.secretState === "delivered-once"
                        || (purpose === "module-contributions" && !moduleContributionsAvailable && pendingMutationAttempt?.kind !== "issue")
                        || (purpose === "custom-launches" && access === "read-only" && !canIssueReadOnly && !pendingMutationAttempt)
                      }
                      type="submit"
                    >
                      {mutationState.kind === "issue"
                        ? "Creating key"
                        : mutationResult?.result.secretState === "delivered-once"
                          ? "Save current key first"
                          : pendingMutationAttempt?.kind === "issue" ? "Retry create key" : "Create key"}
                    </button>
                  </div>

                  {pendingMutationAttempt?.kind === "issue" ? (
                    <p className={styles.securityNote}>Retry uses the same name, access and expiry. Refreshing will not create another key.</p>
                  ) : null}
                  <ApiKeyPermissions scopes={selectedScopes} />

                  <p className={styles.securityNote}>
                    API keys cannot sign or broadcast wallet transactions.
                  </p>

                  {createError ? (
                    <p className={styles.inlineError} role="alert">
                      {createError}
                    </p>
                  ) : null}
                </form>
              </section>

              <section
                className={`${styles.panel} ${styles.listPanel}`}
                aria-labelledby="api-keys-title"
                aria-busy={
                  listState === "loading"
                  || refreshingKeys
                  || mutationState.kind === "rotate"
                }
              >
                <div className={styles.panelHeading}>
                  <h2 id="api-keys-title">Your keys</h2>
                  <div className={styles.listToolbar}>
                    {keyPageCount > 1 ? (
                      <nav
                        className={styles.keyPagination}
                        aria-label="API key pages"
                      >
                        <button
                          type="button"
                          aria-label="Previous API key page"
                          disabled={
                            activeKeyPage === 1
                            || listState === "loading"
                            || refreshingKeys
                          }
                          onClick={() => {
                            const nextPage = Math.max(1, activeKeyPage - 1);
                            setKeyPage(nextPage);
                            setStatusMessage(
                              `Showing API key page ${nextPage}.`,
                            );
                          }}
                        >
                          <ChevronLeft aria-hidden="true" size={17} />
                        </button>
                        <span>
                          {activeKeyPage} / {keyPageCount}
                        </span>
                        <button
                          type="button"
                          aria-label="Next API key page"
                          disabled={
                            activeKeyPage === keyPageCount
                            || listState === "loading"
                            || refreshingKeys
                          }
                          onClick={() => {
                            const nextPage = Math.min(
                              keyPageCount,
                              activeKeyPage + 1,
                            );
                            setKeyPage(nextPage);
                            setStatusMessage(
                              `Showing API key page ${nextPage}.`,
                            );
                          }}
                        >
                          <ChevronRight aria-hidden="true" size={17} />
                        </button>
                      </nav>
                    ) : null}
                    <button
                      className={styles.textButton}
                      disabled={listState === "loading" || refreshingKeys}
                      type="button"
                      onClick={refreshApiKeys}
                    >
                      <RefreshCw
                        aria-hidden="true"
                        className={styles.refreshIcon}
                        data-spinning={
                          listState === "loading" || refreshingKeys
                            ? "true"
                            : "false"
                        }
                        size={16}
                        strokeWidth={1.9}
                      />
                      {listState === "loading" || refreshingKeys
                        ? "Refreshing"
                        : "Refresh keys"}
                    </button>
                  </div>
                </div>

                {listState === "loading" ? <KeyListSkeleton /> : null}

                {listState === "error" ? (
                  <div className={styles.statePanel} role="alert">
                    <h3>Unable to load keys</h3>
                    <p>{listError}</p>
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      onClick={refreshApiKeys}
                    >
                      Try again
                    </button>
                  </div>
                ) : null}

                {listState === "ready" && apiKeys.length === 0 ? (
                  <div className={styles.statePanel}>
                    <h3>No keys yet</h3>
                    <p>Keys you create will appear here.</p>
                  </div>
                ) : null}

                {listState === "ready" && apiKeys.length > 0 ? (
                  <>
                    <ul
                      className={styles.keyList}
                      data-paginated={keyPageCount > 1 ? "true" : undefined}
                    >
                    {visibleApiKeys.map((apiKey) => {
                      const status = keyStatus(apiKey);
                      const confirmingRevoke = confirmingRevokeId === apiKey.id;
                      const confirmingRotate = confirmingRotateId === apiKey.id;
                      const revoking = revokingId === apiKey.id;
                      const rotating = mutationState.kind === "rotate"
                        && mutationState.credentialId === apiKey.id;
                      const rotationSupported = apiKeyRotationVersion(apiKey.scopes, capabilities) !== null
                        || (pendingMutationAttempt?.kind === "rotate" && pendingMutationAttempt.credentialId === apiKey.id);
                      const mutationBusy = revokingId !== null
                        || mutationState.kind !== "idle";
                      return (
                        <li
                          ref={(element) => {
                            if (element) {
                              keyItemRefs.current.set(apiKey.id, element);
                            } else {
                              keyItemRefs.current.delete(apiKey.id);
                            }
                          }}
                          className={styles.keyItem}
                          key={apiKey.id}
                          tabIndex={-1}
                          aria-busy={rotating || revoking}
                        >
                          <div className={styles.keyIdentity}>
                            <div>
                              <h3 title={apiKey.label}>{apiKey.label}</h3>
                              <span
                                className={styles.keyStatus}
                                data-status={status.toLowerCase()}
                              >
                                {status}
                              </span>
                            </div>
                            <code>{displayPrefix(apiKey.keyPrefix)}</code>
                            <ApiKeyPermissions scopes={apiKey.scopes} />
                            <ApiKeyChainPolicy apiKey={apiKey} />
                            {status === "Active" && !rotationSupported ? (
                              <p className={styles.securityNote}>Rotation is unavailable until this key&apos;s restrictions can be preserved.</p>
                            ) : null}
                          </div>

                          <dl className={styles.keyMetadata}>
                            <div>
                              <dt>Purpose</dt>
                              <dd>{apiKeyPurposeLabel(apiKey.scopes)}</dd>
                            </div>
                            <div>
                              <dt>Expires</dt>
                              <dd>
                                {formatDate(apiKey.expiresAt, "Unavailable")}
                              </dd>
                            </div>
                            <div>
                              <dt>Last used</dt>
                              <dd>{formatDate(apiKey.lastUsedAt, "Never")}</dd>
                            </div>
                            {apiKey.revokedAt ? (
                              <div>
                                <dt>Revoked</dt>
                                <dd>
                                  {formatDate(apiKey.revokedAt, "Unavailable")}
                                </dd>
                              </div>
                            ) : null}
                          </dl>

                          {confirmingRotate ? (
                            <div
                              className={styles.mutationConfirmation}
                              role="group"
                              aria-label={`Rotate ${apiKey.label}`}
                              onKeyDown={(event) => {
                                if (event.key === "Escape" && !rotating) {
                                  event.preventDefault();
                                  cancelRotate();
                                }
                              }}
                            >
                              <p>
                                The current key will stop working immediately.
                                The replacement keeps this name, permissions, saved chain restriction and original{" "}
                                {apiKeyLifetimeDays(apiKey)}-day lifetime. Update
                                every agent that uses it.
                              </p>
                              {rotateError ? (
                                <p className={styles.inlineError} role="alert">
                                  {rotateError}
                                </p>
                              ) : null}
                              <div>
                                <button
                                  ref={confirmRotateRef}
                                  className={styles.secondaryButton}
                                  disabled={rotating}
                                  type="button"
                                  onClick={cancelRotate}
                                >
                                  Cancel
                                </button>
                                <button
                                  className={styles.dangerButton}
                                  disabled={rotating}
                                  type="button"
                                  data-confirm-rotate
                                  onClick={() => void rotateApiKey(apiKey)}
                                >
                                  {rotating ? "Rotating key" : "Rotate key"}
                                </button>
                              </div>
                            </div>
                          ) : confirmingRevoke ? (
                            <div
                              className={styles.mutationConfirmation}
                              role="group"
                              aria-label={`Revoke ${apiKey.label}`}
                              onKeyDown={(event) => {
                                if (event.key === "Escape" && !revoking) {
                                  event.preventDefault();
                                  cancelRevoke();
                                }
                              }}
                            >
                              <p>
                                Revoke this key? Requests using it will stop
                                immediately.
                              </p>
                              {revokeError ? (
                                <p className={styles.inlineError} role="alert">
                                  {revokeError}
                                </p>
                              ) : null}
                              <div>
                                <button
                                  className={styles.secondaryButton}
                                  disabled={revoking}
                                  type="button"
                                  onClick={cancelRevoke}
                                >
                                  Cancel
                                </button>
                                <button
                                  ref={confirmRevokeRef}
                                  className={styles.dangerButton}
                                  disabled={revoking}
                                  type="button"
                                  data-confirm-revoke
                                  onClick={() => void revokeApiKey(apiKey)}
                                >
                                  {revoking ? "Revoking key" : "Revoke key"}
                                </button>
                              </div>
                            </div>
                          ) : status === "Active" ? (
                            <div className={styles.keyActions}>
                              <button
                                className={styles.secondaryButton}
                                disabled={mutationBusy || !rotationSupported}
                                type="button"
                                data-key-action="rotate"
                                onClick={() => beginRotate(apiKey.id)}
                              >
                                Rotate key
                              </button>
                              <button
                                className={styles.revokeButton}
                                disabled={mutationBusy}
                                type="button"
                                data-key-action="revoke"
                                onClick={() => beginRevoke(apiKey.id)}
                              >
                                Revoke key
                              </button>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                    </ul>
                  </>
                ) : null}
                {listState === "ready" && listError ? (
                  <p className={styles.inlineError} role="alert">
                    {listError}
                  </p>
                ) : null}
              </section>
            </div>
          ) : activeSection === "launch" ? (
            <DeveloperRobinhoodLaunch
              onOpenLaunch={openRobinhoodLaunchHistory}
            />
          ) : (
            <DeveloperLaunchHistory
              account={account}
              initialLaunchId={initialLaunchId}
              initialLaunchChainId={initialLaunchChainId}
              getAccessToken={getAccessToken}
              getIdentityToken={getIdentityToken}
              sendCustomLaunchWalletAction={sendCustomLaunchWalletAction}
              sendCustomLaunchWalletActionV4={sendCustomLaunchWalletActionV4}
              signCustomLaunchFundingAuthorization={
                signCustomLaunchFundingAuthorization
              }
            />
          )}
        </>
      )}

      {activeSection === "keys" ? (
        <details
          className={styles.agentSetup}
          aria-labelledby="agent-setup-title"
        >
          <summary>
            <span id="agent-setup-title">Set up your agent</span>
            <ChevronDown aria-hidden="true" size={18} strokeWidth={1.8} />
          </summary>
          <div className={styles.agentSetupBody}>
            <div className={styles.agentSetupCopy}>
              <p>
                {purpose === "module-contributions"
                  ? "Use these instructions with a module contribution key. Your agent submits the source package; receipt does not mean approval."
                  : access === "read-only"
                     ? "Use these instructions with a read-only key to read account-wide launch history and status."
                     : "Use these instructions with a new or existing key. Your agent prepares the launch; you review and approve it in your wallet."}
              </p>
              <p className={styles.setupNote}>
                The instructions use
                the <code>$PROGRAMMABLE_API_KEY</code> placeholder, never your secret.
              </p>
            </div>
            <div className={styles.agentSetupActions}>
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() => void copyAgentSetup()}
              >
                {setupCopyState === "copied"
                  ? "Setup copied"
                  : "Copy agent setup"}
              </button>
              {setupCopyState === "error" ? (
                <p className={styles.inlineError} role="alert">
                  Agent setup could not be copied. Try again.
                </p>
              ) : null}
            </div>
          </div>
        </details>
      ) : null}
    </div>
  );
}
