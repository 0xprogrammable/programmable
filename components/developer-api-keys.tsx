"use client";

import { Disclosure } from "@/components/disclosure";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  ChevronDown,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from "lucide-react";

import styles from "@/components/developer-api-keys.module.css";
import { AGENT_KEY_SCHEMA, AGENT_SCOPES, buildAgentConnection, buildAgentInstructions } from "@/lib/agent-connection";
import { DeveloperUniversalLaunchHistory } from "@/components/developer-universal-launch-history";
import type { LaunchContractSetupV1 } from "@/lib/server/custom-launch/launch-contract-setup-v1";
import type { UniversalLaunchWalletInputV1, UniversalLaunchWalletReviewV1 } from "@/lib/custom-launch/wallet-handoff-plan-v1";
import { DeveloperLaunchHistory } from "@/components/developer-launch-history";
import { ModuleBuilderPrompt } from "@/components/module-contribution-entry";
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
import { PROGRAMMABLE_AGENT_SETUP_LINKS_V1 } from
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
  unifiedKeys?: boolean;
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
  version: "v1" | "v2" | "agent";
  idempotencyKey: string;
  body: string;
  expectedScopes: readonly string[];
}>;

type ApiKeyMutationState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "issue" }>
  | Readonly<{ kind: "rotate"; credentialId: string }>;

type ListState = "idle" | "loading" | "ready" | "error";
type ActiveSection = "keys" | "launch" | "history";
const subscribeToHydration = () => () => {};
const readHydrated = () => true;
const readServerHydrated = () => false;
type ApiKeyLoadMode = "initial" | "refresh" | "mutation";
type DeveloperApiKeysProps = Readonly<{
  moduleBuilder?: boolean;
  initialSection?: ActiveSection;
  agentSetupText?: string;
  launchContractSetup?: LaunchContractSetupV1;
  moduleAgentSetupText?: string;
}>;
type DeveloperApiKeysViewProps = Readonly<{
  moduleBuilder?: boolean;
  account: `0x${string}` | null;
  authReady: boolean;
  connecting: boolean;
  getAccessToken: () => Promise<string | null>;
  getIdentityToken: () => Promise<string | null>;
  initialSection: ActiveSection;
  agentSetupText?: string;
  launchContractSetup?: LaunchContractSetupV1;
  moduleAgentSetupText?: string;
  openWallet: () => void;
  sendCustomLaunchWalletAction: (
    input: CustomLaunchWalletActionV1,
  ) => Promise<`0x${string}`>;
  sendUniversalLaunchWalletAction?: (input: UniversalLaunchWalletInputV1) => Promise<UniversalLaunchWalletReviewV1 | `0x${string}`>;
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
export type ApiKeyPurpose = "all" | "custom-launches" | "module-contributions";
const schemaVersion = "programmable.custom-launch-api.v1";
const launchRequestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const apiKeySecretPattern =
  /^pm_live_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{43}$/u;
const idempotencyKeyPattern = /^[A-Za-z0-9._:-]{16,128}$/u;
const API_KEY_PAGE_SIZE = 3;
export const PROGRAMMABLE_READ_ONLY_AGENT_SETUP_TEXT = [
  "Use this Programmable API key only to read launch history and status. It cannot prepare or submit launches, sign transactions or move funds.",
  "Read the key from $PROGRAMMABLE_API_KEY in the environment or secret store. Never paste, print or copy the secret into chat, source code, logs or command history.",
  `Read the current API discovery at ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.discovery} and OpenAPI at ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.openApi}. Use only documented read operations supported by the service.`,
  "Launch history can include requests from other API keys and linked wallets in the same account. The key is not isolated to one project or controller wallet’s history.",
  "Respect the key’s saved chain restriction. Current chain access is checked for each request; do not infer access from a scope name or from an absent chain list.",
].join("\n\n");
export const PROGRAMMABLE_MODULE_AGENT_SETUP_TEXT_V1 = buildAgentInstructions({
  intent: "Build and submit a reusable Module Mode source package for the user's idea",
});

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
    || (value.unifiedKeys !== undefined && typeof value.unifiedKeys !== "boolean")
  ) return null;
  return {
    restrictedIssuance: value.restrictedIssuance,
    preservingRotation: value.preservingRotation,
    preservingModuleRotation: value.preservingModuleRotation === true,
    unifiedKeys: value.unifiedKeys === true,
  };
}

export function apiKeyIssueVersion(access: ApiKeyAccess, capabilities: ApiKeyCapabilities | null) {
  if (capabilities?.restrictedIssuance && capabilities.preservingRotation) return "v2";
  return access === "prepare-and-read" ? "v1" : null;
}

export function apiKeyRotationVersion(scopes: readonly string[], capabilities: ApiKeyCapabilities | null): "v1" | "v2" | "agent" | null {
  if (apiKeyPurpose(scopes) === "all") return capabilities?.unifiedKeys ? "agent" : null;
  if (apiKeyPurpose(scopes) === "module-contributions") {
    return capabilities?.preservingModuleRotation ? "v1" : null;
  }
  if (!hasStandardScopes(scopes) && !hasReadOnlyScopes(scopes)) return null;
  if (capabilities?.preservingRotation) return "v2";
  return null;
}

export function apiKeyMutationPath(attempt: Pick<ApiKeyMutationAttempt, "version" | "kind" | "credentialId">) {
  const base = attempt.version === "agent" ? "/api/developer/agent-keys" : attempt.version === "v2" ? "/api/developer/api-keys/v2" : "/api/developer/api-keys";
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
  if (Array.isArray(scopes) && scopes.length === 4 && new Set(scopes).size === 4
    && AGENT_SCOPES.every((scope) => scopes.includes(scope))) return "all";
  if (!Array.isArray(scopes) || scopes.length !== 2 || new Set(scopes).size !== 2) {
    return null;
  }
  if (fixedScopes.every((scope) => scopes.includes(scope))) return "custom-launches";
  if (moduleScopes.every((scope) => scopes.includes(scope))) return "module-contributions";
  return null;
}

export function apiKeyPurposeLabel(scopes: unknown): string {
  const purpose = apiKeyPurpose(scopes);
  if (purpose === "all") return "Launches + modules";
  if (purpose === "custom-launches") return "Custom launches";
  if (purpose === "module-contributions") return "Modules";
  if (Array.isArray(scopes) && scopes.length === 1
    && fixedScopes.includes(scopes[0])) return scopes[0] === "custom-launch:read" ? "Launches · read only" : "Custom launches";
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
  expected?: Readonly<{ version: "v1" | "v2" | "agent"; scopes: readonly string[] }>,
): ApiKeyMutationResult | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== (expected?.version === "agent" ? AGENT_KEY_SCHEMA : expected?.version === "v2" ? schemaVersionV2 : schemaVersion)
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
    || (!expected && apiKeyPurpose(apiKey.scopes) === "all")
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

export function parseApiKeyMutationResultForAttempt(
  value: unknown,
  status: number,
  attempt: ApiKeyMutationAttempt,
) {
  return parseApiKeyMutationResult(
    value,
    status,
    attempt.kind === "rotate" ? attempt.credentialId! : undefined,
    apiKeyPurpose(attempt.expectedScopes) ?? undefined,
    { version: attempt.version, scopes: attempt.expectedScopes },
  );
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
    <Disclosure className={styles.scopeLedger}>
      <summary><span>Permissions</span><strong>{summary}</strong></summary>
      <ul>{scopes.map((scope) => (
        <li key={scope}>
          <code>{scope}</code>
          <p>{descriptions[scope] ?? "Not recognized by this manager."}</p>
        </li>
      ))}</ul>
    </Disclosure>
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
    <Disclosure className={styles.scopeLedger}>
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
    </Disclosure>
  );
}

export function ApiKeyAccessChoice({ value, onChange, available, disabled }: Readonly<{
  value: ApiKeyAccess; onChange: (value: ApiKeyAccess) => void; available: boolean; disabled: boolean;
}>) {
  return <label className={styles.accessField}><span>Launch access</span>
    <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as ApiKeyAccess)}>
      <option value="prepare-and-read">Create and read</option>
      <option value="read-only" disabled={!available}>Read only{!available ? " · unavailable" : ""}</option>
    </select>
  </label>;
}

export function ApiKeyPurposeChoice({ value, onChange, moduleContributionsAvailable, unifiedAvailable = false, checking, disabled }: Readonly<{
  value: ApiKeyPurpose; onChange: (value: ApiKeyPurpose) => void;
  moduleContributionsAvailable: boolean; unifiedAvailable?: boolean; checking: boolean; disabled: boolean;
}>) {
  return <label className={styles.accessField}><span>Access</span>
    <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as ApiKeyPurpose)}>
      <option value="all" disabled={!unifiedAvailable}>Launches + modules{!unifiedAvailable ? checking ? " · checking" : " · unavailable" : ""}</option>
      <option value="custom-launches">Custom launches</option>
      <option value="module-contributions" disabled={!moduleContributionsAvailable}>Modules{!moduleContributionsAvailable ? " · unavailable" : ""}</option>
    </select>
  </label>;
}

export function prepareApiKeyMutationAttempt(
  current: ApiKeyMutationAttempt | null,
  input: Readonly<{
    kind: "issue" | "rotate";
    credentialId: string | null;
    version: "v1" | "v2" | "agent";
    body: string;
    expectedScopes: readonly string[];
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
  return Object.freeze({ ...input, expectedScopes: Object.freeze([...input.expectedScopes]), idempotencyKey });
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
  moduleBuilder = false,
  initialSection = "keys",
  agentSetupText,
  launchContractSetup,
  moduleAgentSetupText,
}: DeveloperApiKeysProps) {
  const {
    sessionReady: authReady,
    connecting,
    getAccessToken,
    getIdentityToken,
    openWallet,
    sendCustomLaunchWalletAction,
    sendCustomLaunchWalletActionV4,
    sendUniversalLaunchWalletAction,
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
      moduleBuilder={moduleBuilder}
      agentSetupText={agentSetupText}
      launchContractSetup={launchContractSetup}
      moduleAgentSetupText={moduleAgentSetupText}
      openWallet={openWallet}
      sendCustomLaunchWalletAction={sendCustomLaunchWalletAction}
      sendCustomLaunchWalletActionV4={sendCustomLaunchWalletActionV4}
      sendUniversalLaunchWalletAction={sendUniversalLaunchWalletAction}
      signCustomLaunchFundingAuthorization={
        signCustomLaunchFundingAuthorization
      }
    />
  );
}

export function DeveloperApiKeysView({
  moduleBuilder = false,
  account,
  authReady,
  connecting,
  getAccessToken,
  getIdentityToken,
  initialSection,
  launchContractSetup,
  openWallet,
  sendCustomLaunchWalletAction,
  sendCustomLaunchWalletActionV4,
  sendUniversalLaunchWalletAction,
  signCustomLaunchFundingAuthorization,
}: DeveloperApiKeysViewProps) {
  const hydrated = useSyncExternalStore(subscribeToHydration, readHydrated, readServerHydrated);
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[]>([]);
  const [listState, setListState] = useState<ListState>(() =>
    account ? "loading" : "idle",
  );
  const [listError, setListError] = useState("");
  const [label, setLabel] = useState("");
  const [purpose, setPurpose] = useState<ApiKeyPurpose>("all");
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
  const [connectionCopyState, setConnectionCopyState] = useState<"idle" | "copied" | "error">("idle");
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
    moduleBuilder ? "keys" : initialSection,
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
  const selectedScopes = purpose === "all" ? AGENT_SCOPES : purpose === "module-contributions" ? moduleScopes
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
  const moduleKey = moduleBuilder ? apiKeys.find((key) => keyStatus(key) === "Active" && moduleScopes.every((scope) => key.scopes.includes(scope))) : undefined;
  const KeyWorkspace = moduleKey ? Disclosure : "div";

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
      || pendingMutationAttempt?.kind === "rotate"
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
      : purpose === "all" ? capabilities?.unifiedKeys ? "agent" : null
        : purpose === "module-contributions" ? "v1" : apiKeyIssueVersion(access, capabilities);
    if (!version) {
      setCreateError("This access is unavailable. Refresh your keys and try again.");
      return;
    }
    const body = JSON.stringify({
      expiresInDays,
      label: cleanLabel,
      schemaVersion: version === "agent" ? AGENT_KEY_SCHEMA : version === "v2" ? schemaVersionV2 : schemaVersion,
      walletAddress: account,
      ...(version === "v2" ? { scopes: selectedScopes } : {}),
      ...(purpose === "module-contributions" ? { purpose } : {}),
    });
    let attempt: ApiKeyMutationAttempt;
    try {
      attempt = prepareApiKeyMutationAttempt(
        pendingMutationAttempt,
        { kind: "issue", credentialId: null, version, body, expectedScopes: selectedScopes },
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
      const parsed = parseApiKeyMutationResultForAttempt(responseBody, response.status, attempt);
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

  const copyConnection = async () => {
    if (mutationResult?.result.secretState !== "delivered-once") return;
    try {
      await copyToClipboard(buildAgentConnection(mutationResult.result.apiKeySecret, {
        scopes: mutationResult.result.apiKey.scopes, wallet: account ?? undefined,
        ...(launchContractSetup ? { launchContract: launchContractSetup } : {}),
      }));
      setConnectionCopyState("copied");
      setStatusMessage("Connection copied with the API key and agent instructions.");
    } catch {
      setConnectionCopyState("error");
      setStatusMessage("Connection could not be copied. Copy the key and instructions separately.");
    }
  };

  const copyAgentSetup = async (scopes?: readonly string[]) => {
    try {
      await copyToClipboard([buildAgentInstructions({ scopes, wallet: account ?? undefined }), launchContractSetup?.text].filter(Boolean).join("\n\n"));
      setSetupCopyState("copied");
      setStatusMessage("Agent instructions copied. These instructions contain no API key.");
    } catch {
      setSetupCopyState("error");
      setStatusMessage("Instructions could not be copied.");
    }
  };

  const dismissApiKeyResult = (focusReplacement = false) => {
    const result = mutationResult;
    setMutationResult(null);
    setConnectionCopyState("idle");
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
    if (section === "history") url.searchParams.set("view", "history");
    else url.searchParams.delete("view");
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
    const version = pendingMutationAttempt?.kind === "rotate" && pendingMutationAttempt.credentialId === apiKey.id
      ? pendingMutationAttempt.version : apiKeyRotationVersion(apiKey.scopes, capabilities);
    if (!version) {
      setRotateError("Rotation is unavailable until this key’s restrictions can be preserved.");
      return;
    }
    const body = JSON.stringify({
      expiresInDays: apiKeyLifetimeDays(apiKey),
      label: apiKey.label,
      schemaVersion: version === "agent" ? AGENT_KEY_SCHEMA : version === "v2" ? schemaVersionV2 : schemaVersion,
      walletAddress: account,
    });
    let attempt: ApiKeyMutationAttempt;
    try {
      attempt = prepareApiKeyMutationAttempt(
        pendingMutationAttempt,
        { kind: "rotate", credentialId: apiKey.id, version, body, expectedScopes: apiKey.scopes },
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
      const parsed = parseApiKeyMutationResultForAttempt(responseBody, response.status, attempt);
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
      setPurpose(apiKeyPurpose(parsed.apiKey.scopes) ?? "custom-launches");
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

      <nav className={styles.topNavigation} aria-label="Builder navigation">
        <Link className={styles.backLink} href="/launch">
          <ArrowLeft aria-hidden="true" size={16} strokeWidth={1.9} />
          <span>Back</span>
        </Link>
        <Link className={styles.textLink} href="/profile?section=submissions#profile-modules-title">Submissions <ArrowRight size={16} aria-hidden="true" /></Link>
      </nav>

      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <h1>{activeSection === "keys" ? moduleBuilder ? "Build a module" : "API keys" : activeSection === "launch" ? "Launch a hook" : "Your launches"}</h1>
          <p className={styles.intro}>
            {activeSection === "keys"
              ? moduleBuilder ? "Set up your API key, then copy your module prompt." : "Connect your AI builder."
              : activeSection === "launch"
                ? "Upload the launch file from your builder."
                : "Track progress and complete your wallet steps."}
          </p>
        </div>
      </header>

      {!moduleBuilder ? <nav
        className={styles.sectionSwitch}
        aria-label="Developer access view"
      >
        <button
          aria-pressed={activeSection === "keys"}
          disabled={!hydrated}
          type="button"
          onClick={() => showSection("keys")}
        >
          API keys
        </button>
        <button
          aria-pressed={activeSection === "launch"}
          disabled={!hydrated}
          type="button"
          onClick={() => showSection("launch")}
        >
          Launch
        </button>
        <button
          aria-pressed={activeSection === "history"}
          disabled={!hydrated}
          type="button"
          onClick={() => showSection("history")}
        >
          History
        </button>
      </nav> : null}

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
            <p>
              {activeSection === "keys"
                ? "Create and manage keys for this account."
                : activeSection === "launch"
                  ? "Continue your hook launch with this wallet."
                  : "See launches linked to this wallet."}
            </p>
          </div>
          <button
            className={styles.primaryButton}
            disabled={connecting}
            aria-busy={connecting}
            type="button"
            onClick={openWallet}
          >
            <span>Connect wallet</span>
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
                    {moduleBuilder ? "Save this key in your AI builder’s secure setup, then copy the prompt below. The key is shown once." : "Copy the connection for your agent. It includes this secret key and the full guide. Save it privately; the key is shown once."}
                    {mutationResult.operation === "rotate" ? " The previous key is revoked." : ""}
                  </p>
                  <div className={styles.secretRow}>
                    <code>{mutationResult.result.apiKeySecret}</code>
                    <div className={styles.secretActions}>
                      {!moduleBuilder ? <button className={styles.primaryButton} type="button" onClick={() => void copyConnection()}>
                        {connectionCopyState === "copied" ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                        Copy connection
                      </button> : null}
                      <button
                        className={styles.secondaryButton}
                        type="button"
                        onClick={() => void copyApiKey()}
                      >
                        {keyCopyState === "copied" ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                        Copy key
                      </button>
                    </div>
                  </div>
                  {connectionCopyState === "error" ? <p className={styles.inlineError} role="alert">Connection could not be copied. Copy the key and instructions separately.</p> : null}
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

          {activeSection === "keys" && moduleKey && account ? <ModuleBuilderPrompt scopes={moduleKey.scopes} wallet={account} /> : null}

          {activeSection === "keys" ? (
            <KeyWorkspace className={styles.workspace}>
              {moduleKey ? <summary className={styles.keySettingsSummary}>Manage API keys <ChevronDown size={16} aria-hidden="true" /></summary> : null}
              <section
                className={`${styles.panel} ${styles.createPanel}`}
                aria-labelledby="create-key-title"
                aria-busy={mutationState.kind === "issue"}
              >
                <div className={styles.panelHeading}>
                  <h2 id="create-key-title">New key</h2>
                </div>

                <form className={styles.createForm} onSubmit={createApiKey}>
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
                          placeholder="My builder"
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

                    <div className={styles.optionsField}>
                      <span>Access and expiry</span>
                      <Disclosure className={styles.connectionOptions}>
                        <summary aria-label={`Access and expiry: ${apiKeyPurposeLabel(selectedScopes)}, ${expiresInDays} days`}>
                          <span>{apiKeyPurposeLabel(selectedScopes)}</span>
                          <small>{expiresInDays} days</small>
                          <ChevronDown size={16} aria-hidden="true" />
                        </summary>
                      <div className={styles.connectionOptionsBody}>
                        <ApiKeyPurposeChoice
                          value={purpose}
                          onChange={(value) => {
                            setPurpose(value);
                            setCreateError("");
                            setSetupCopyState("idle");
                          }}
                          moduleContributionsAvailable={moduleContributionsAvailable}
                          unifiedAvailable={capabilities?.unifiedKeys === true}
                          checking={listState === "loading"}
                          disabled={mutationState.kind !== "idle"
                            || mutationResult?.result.secretState === "delivered-once" || pendingMutationAttempt !== null}
                        />
                        {purpose === "custom-launches" ? (
                          <ApiKeyAccessChoice value={access} onChange={setAccess} available={canIssueReadOnly}
                            disabled={mutationState.kind !== "idle" || pendingMutationAttempt !== null
                              || mutationResult?.result.secretState === "delivered-once"} />
                        ) : null}
                        <ExpirySelect
                          value={expiresInDays}
                          disabled={pendingMutationAttempt !== null}
                          onChange={setExpiresInDays}
                        />
                      </div>
                      </Disclosure>
                    </div>

                    <button
                      ref={createButtonRef}
                      className={styles.primaryButton}
                      disabled={
                        mutationState.kind !== "idle"
                        || pendingMutationAttempt?.kind === "rotate"
                        || mutationResult?.result.secretState === "delivered-once"
                        || (purpose === "all" && !capabilities?.unifiedKeys && pendingMutationAttempt?.kind !== "issue")
                        || (purpose === "module-contributions" && !moduleContributionsAvailable && pendingMutationAttempt?.kind !== "issue")
                        || (purpose === "custom-launches" && access === "read-only" && !canIssueReadOnly && !pendingMutationAttempt)
                      }
                      type="submit"
                      aria-busy={mutationState.kind === "issue"}
                    >
                      <span>{mutationResult?.result.secretState === "delivered-once"
                        ? "Save current key first"
                        : pendingMutationAttempt?.kind === "issue" && mutationState.kind !== "issue" ? "Retry create key" : "Create key"}</span>
                      <span className={styles.buttonIcon} aria-hidden="true">
                        {mutationState.kind === "issue" ? <RefreshCw size={16} className={styles.refreshIcon} data-spinning="true" /> : <ArrowRight size={16} />}
                      </span>
                    </button>
                  </div>

                  {listState !== "loading" && pendingMutationAttempt?.kind !== "issue" && (
                    (purpose === "all" && !capabilities?.unifiedKeys)
                    || (purpose === "module-contributions" && !moduleContributionsAvailable)
                    || (purpose === "custom-launches" && access === "read-only" && !canIssueReadOnly)
                  ) ? (
                    <p className={styles.securityNote}>This access is unavailable. Open access and expiry to choose another option, or refresh your keys.</p>
                  ) : null}

                  {pendingMutationAttempt?.kind === "issue" ? (
                    <p className={styles.securityNote}>Retry uses the same name, access and expiry. Refreshing will not create another key.</p>
                  ) : null}

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
                      Refresh keys
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
                            <span className={styles.keyPurpose}>{apiKeyPurposeLabel(apiKey.scopes)}</span>
                            {status === "Active" && !rotationSupported ? (
                              <p className={styles.securityNote}>Rotation is unavailable until this key&apos;s restrictions can be preserved.</p>
                            ) : null}
                          </div>

                          <Disclosure className={styles.keyDetails}>
                            <summary>Details <ChevronDown size={14} aria-hidden="true" /></summary>
                            <div className={styles.keyDetailBody}>
                              <code>{displayPrefix(apiKey.keyPrefix)}</code>
                          <dl className={styles.keyMetadata}>
                            <div>
                              <dt>Access</dt>
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
                              <ApiKeyPermissions scopes={apiKey.scopes} />
                              <ApiKeyChainPolicy apiKey={apiKey} />
                            </div>
                          </Disclosure>

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
                                  aria-busy={rotating}
                                  type="button"
                                  data-confirm-rotate
                                  onClick={() => void rotateApiKey(apiKey)}
                                >
                                  Rotate key
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
                                  aria-busy={revoking}
                                  type="button"
                                  data-confirm-revoke
                                  onClick={() => void revokeApiKey(apiKey)}
                                >
                                  Revoke key
                                </button>
                              </div>
                            </div>
                          ) : status === "Active" ? (
                            <div className={styles.keyActions}>
                              <button className={`${styles.secondaryButton} ${styles.iconButton}`} type="button" aria-label={`Copy instructions for ${apiKey.label}`} title="Copy instructions" onClick={() => void copyAgentSetup(apiKey.scopes)}><Copy size={16} aria-hidden="true" /></button>
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
            </KeyWorkspace>
          ) : activeSection === "launch" ? (
            <DeveloperRobinhoodLaunch
              onOpenLaunch={openRobinhoodLaunchHistory}
            />
          ) : (
            <>
            {account && sendUniversalLaunchWalletAction ? <DeveloperUniversalLaunchHistory key={account.toLowerCase()} account={account} initialLaunchId={initialLaunchId}
              getAccessToken={getAccessToken} getIdentityToken={getIdentityToken} sendWallet={sendUniversalLaunchWalletAction} /> : null}
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
            </>
          )}
        </>
      )}

      {launchContractSetup ? <details className={styles.connectionOptions} data-manifest-digest={launchContractSetup.manifestDigest}>
        <summary>Custom Launch Plan instructions</summary>
        <div className={styles.connectionOptionsBody}><p>Manifest <code style={{ overflowWrap: "anywhere" }}>{launchContractSetup.manifestDigest}</code></p>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxWidth: "100%" }}>{launchContractSetup.text}</pre></div>
      </details> : null}
      <nav className={styles.resourceLinks} aria-label="Developer resources">
        {!moduleBuilder ? <button className={styles.guideAction} type="button" onClick={() => void copyAgentSetup()}>
          {setupCopyState === "copied" ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          Copy instructions
        </button> : null}
        {!moduleBuilder ? <Link href="/developers/modules">Build a module <ArrowRight size={16} aria-hidden="true" /></Link> : null}
        <a href="/agents.md" target="_blank" rel="noreferrer">Agent guide <ExternalLink size={14} aria-hidden="true" /></a>
      </nav>
      {setupCopyState === "error" ? <p className={styles.inlineError} role="alert">Copy failed. Open the agent guide to read the instructions.</p> : null}

    </div>
  );
}
