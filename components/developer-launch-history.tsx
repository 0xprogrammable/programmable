"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Check, RefreshCw } from "lucide-react";
import NextImage from "next/image";

import styles from "@/components/developer-launch-history.module.css";
import type { CustomLaunchWalletActionInputV4, CustomLaunchWalletActionResultV4 } from
  "@/components/wallet-provider";
import { canonicalBrowserSha256V2, fileSha256V2 } from
  "@/lib/custom-launch/browser-authority-v2";
import {
  prepareCustomLaunchWalletActionV1,
  type CustomLaunchWalletActionV1,
} from "@/lib/custom-launch/wallet-handoff-v1";
import { prepareCustomLaunchWalletActionV2 } from
  "@/lib/custom-launch/wallet-handoff-v2";
import {
  createCustomLaunchFundingSubmissionV3,
  prepareCustomLaunchFundingAuthorizationV3,
  prepareCustomLaunchRouterReviewV3,
  type CustomLaunchFundingAuthorizationSubmissionV3,
  type CustomLaunchFundingAuthorizationV3,
  type CustomLaunchRouterReviewV3,
} from "@/lib/custom-launch/wallet-handoff-v3";
import {
  formatRobinhoodWeiV1,
  parseRobinhoodFundingReviewV1,
  robinhoodCostMatchesReviewV1,
  robinhoodGasBudgetExceededV1,
  robinhoodFundingPlanLabelsV1,
  type RobinhoodLaunchCostV1,
} from "@/lib/custom-launch/robinhood-funding-review-v1";
import { parseRobinhoodInitialBuyReviewV1 } from "@/lib/custom-launch/robinhood-initial-buy-review-v1";
import { parseRobinhoodFeeReviewV1 } from "@/lib/custom-launch/robinhood-fee-review-v1";
import { PROGRAMMABLE_AGENT_SETUP_LINKS_V1 } from
  "@/lib/custom-launch/agent-setup-v1";
import {
  buildCustomLaunchAgentFixV1,
  customLaunchRemediationsV1,
  customLaunchTruthRowsV1,
  customLaunchWalletHandoffExpiredV1,
  customLaunchWarningFindingCodesV1,
  parseCustomLaunchLiquidityIntentV3,
  parseCustomLaunchWalletHandoffV1,
  parseSourceVerificationStatusV1,
  type CustomLaunchLiquidityIntentV3,
  type CustomLaunchRemediationV1,
  type SourceVerificationStatusV1,
} from "@/lib/custom-launch/developer-launch-truth-v1";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type ProjectMetadataLinkKind =
  | "website"
  | "documentation"
  | "x"
  | "telegram"
  | "discord"
  | "github"
  | "other";

type ProjectMetadataImageMediaType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif";

type ProjectMetadataStaticSource =
  | "constructor-argument"
  | "initializer-argument"
  | "not-deterministically-extractable";

type ProjectTokenMetadataFieldBindingV1 = Readonly<{
  staticSource: ProjectMetadataStaticSource;
  argumentIndex: number | null;
  argumentName: string | null;
}>;

export type CustomLaunchProjectMetadataV1 = Readonly<{
  schemaVersion: "programmable.project-metadata.v1";
  token: Readonly<{
    name: string;
    symbol: string;
  }>;
  presentation: Readonly<{
    schemaVersion: "programmable.launch-presentation-draft.v1";
    description: string;
    image: Readonly<{
      uri: string;
      contentSha256: `sha256:${string}`;
      mediaType: ProjectMetadataImageMediaType;
      byteLength: number;
      width: number;
      height: number;
    }> | null;
    links: readonly Readonly<{
      kind: ProjectMetadataLinkKind;
      uri: string;
    }>[];
  }>;
  tokenMetadataBinding: Readonly<{
    schemaVersion: "programmable.project-token-metadata-binding.v1";
    tokenTargetId: string;
    declarationBinding: "request-and-launch-id";
    standardReadModel: Readonly<{
      name: boolean;
      symbol: boolean;
    }>;
    name: ProjectTokenMetadataFieldBindingV1;
    symbol: ProjectTokenMetadataFieldBindingV1;
    postDeploymentReadback: "required";
  }>;
}>;

export type LaunchStatus =
  | "received"
  | "validating"
  | "pending_review"
  | "action_required"
  | "prepared"
  | "awaiting_funding_authorization"
  | "funding_authorization_verified"
  | "simulating"
  | "authorized"
  | "awaiting_wallet_signature"
  | "wallet_action_required"
  | "submitted"
  | "sequencer_soft_confirmed"
  | "ethereum_posted"
  | "finalized"
  | "failed"
  | "cancelled";

export type LaunchResource = Readonly<{
  schemaVersion:
    | "programmable.custom-launch.v1"
    | "programmable.custom-launch.v2"
    | "programmable.custom-launch.v3"
    | "programmable.custom-launch.v4";
  launchId: string;
  requestId: string;
  onchainLaunchId: `0x${string}` | null;
  routeId:
    | "custom-launch:create:v1"
    | "custom-launch:create:v2"
    | "custom-launch:create:v3"
    | "custom-launch:create:v4";
  ownerWallet: `0x${string}`;
  status: LaunchStatus;
  requestHash: `sha256:${string}` | null;
  launchProfileVersion:
    | "2.0.0"
    | "3.0.0"
    | "3.1.0"
    | "3.2.0"
    | "3.3.0"
    | "3.4.0"
    | null;
  launchProfileHash: `sha256:${string}` | null;
  launchIntentHash: `sha256:${string}` | null;
  projectMetadata: CustomLaunchProjectMetadataV1 | null;
  projectMetadataHash: `sha256:${string}` | null;
  fundingIntentHash: `0x${string}` | null;
  liquidityIntent: CustomLaunchLiquidityIntentV3 | null;
  sourceVerification: SourceVerificationStatusV1 | null;
  walletHandoffUrl: string | null;
  expiresAt: string | null;
  secondsRemaining: number | null;
  createdAt: string;
  updatedAt: string;
  output: Record<string, JsonValue> | null;
  rawResourceV4: Record<string, JsonValue> | null;
  failure: Readonly<{
    code: string;
    message: string;
    retryable: boolean;
    remediations: readonly CustomLaunchRemediationV1[];
  }> | null;
}>;

type HistoryPage = Readonly<{
  launches: LaunchResource[];
  nextCursor: string | null;
}>;

type DeveloperLaunchHistoryProps = Readonly<{
  account: `0x${string}`;
  initialLaunchId: string | null;
  initialLaunchChainId: "4663" | null;
  getAccessToken: () => Promise<string | null>;
  getIdentityToken: () => Promise<string | null>;
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

const listSchemaVersions = new Set([
  "programmable.custom-launch-history.v1",
  "programmable.custom-launch-list.v1",
  "programmable.custom-launch-list.v2",
  "programmable.custom-launch-list.v3",
  "programmable.custom-launch-list.v4",
]);
const pageSize = 5;
const statuses = new Set<LaunchStatus>([
  "received",
  "validating",
  "pending_review",
  "action_required",
  "prepared",
  "awaiting_funding_authorization",
  "funding_authorization_verified",
  "simulating",
  "authorized",
  "awaiting_wallet_signature",
  "wallet_action_required",
  "submitted",
  "sequencer_soft_confirmed",
  "ethereum_posted",
  "finalized",
  "failed",
  "cancelled",
]);
const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});
const submittedPollIntervalMs = 12_000;
const authorizedPollIntervalMs = 4_000;
const launchHistoryRefreshTimeoutMs = 12_000;
const launchHistoryRefreshTimeoutReason = "launch-history-refresh-timeout";
const transactionHashPattern = /^0x[0-9a-fA-F]{64}$/u;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;
const requestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const launchStatusRank: Readonly<Record<LaunchStatus, number>> = Object.freeze({
  received: 0,
  validating: 1,
  awaiting_funding_authorization: 2,
  funding_authorization_verified: 3,
  pending_review: 4,
  action_required: 4,
  prepared: 5,
  simulating: 6,
  authorized: 7,
  awaiting_wallet_signature: 7,
  wallet_action_required: 7,
  submitted: 8,
  sequencer_soft_confirmed: 8,
  ethereum_posted: 8,
  failed: 9,
  cancelled: 9,
  finalized: 10,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
) {
  const keys = Object.keys(value);
  return keys.length === expected.length
    && keys.every((key) => expected.includes(key));
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

const projectMetadataSecretPatterns = Object.freeze([
  /(?:^|[^A-Za-z0-9_-])pm_live_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{43}(?=$|[^A-Za-z0-9_-])/u,
  /(?:^|[^A-Za-z0-9_])PROGRAMMABLE_API_KEY\s*[:=]\s*["']?[^\s"'&?#]{8,}/iu,
] as const);

function fullyDecodeProjectMetadataText(value: string) {
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

function containsProjectMetadataSecret(value: string) {
  const decoded = fullyDecodeProjectMetadataText(value);
  return projectMetadataSecretPatterns.some((pattern) => pattern.test(decoded));
}

function canonicalText(
  value: unknown,
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
    : /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
  return typeof value === "string"
    && !hasLoneUtf16Surrogate(value)
    && !containsProjectMetadataSecret(value)
    && value === value.normalize("NFC")
    && value === value.trim()
    && [...value].length >= minimumCodePoints
    && [...value].length <= maximumCodePoints
    && new TextEncoder().encode(value).byteLength <= maximumBytes
    && !unsafeText.test(value)
    && (!options.forbidWhitespace || !/\s/u.test(value));
}

function publicCanonicalHttpsUrl(
  value: unknown,
  options: Readonly<{ allowQuery: boolean }>,
) {
  if (typeof value !== "string" || value.length < 1 || value.length > 2_048) {
    return null;
  }
  if (
    containsProjectMetadataSecret(value)
    || hasLoneUtf16Surrogate(value)
    || hasLoneUtf16Surrogate(fullyDecodeProjectMetadataText(value))
    || /[\u0000-\u0020\u007f-\u009f]/u.test(value)
    || /[\u0000-\u0020\u007f-\u009f]/u.test(
      fullyDecodeProjectMetadataText(value),
    )
  ) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(hostname);
    const privateHostname = hostname === "localhost"
      || hostname === "localhost."
      || hostname === "local"
      || hostname === "local."
      || hostname.endsWith(".localhost")
      || hostname.endsWith(".localhost.")
      || hostname.endsWith(".local")
      || hostname.endsWith(".local.");
    const credentialQuery = [...url.searchParams.keys()].some((key) =>
      /(?:api[_-]?key|auth|credential|password|secret|signature|token)/iu.test(key));
    if (
      url.protocol !== "https:"
      || url.username !== ""
      || url.password !== ""
      || url.hostname === ""
      || url.hash !== ""
      || (!options.allowQuery && url.search !== "")
      || credentialQuery
      || ipv4 !== null
      || hostname.includes(":")
      || !/^[a-z0-9.-]+$/u.test(hostname)
      || privateHostname
      || url.href !== value
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}

function canonicalProjectImageUri(value: unknown) {
  if (typeof value !== "string" || value.length < 1 || value.length > 2_048) {
    return null;
  }
  if (
    hasLoneUtf16Surrogate(value)
    || hasLoneUtf16Surrogate(fullyDecodeProjectMetadataText(value))
    || /[\u0000-\u0020\u007f-\u009f]/u.test(value)
    || /[\u0000-\u0020\u007f-\u009f]/u.test(
      fullyDecodeProjectMetadataText(value),
    )
  ) return null;
  const https = publicCanonicalHttpsUrl(value, { allowQuery: false });
  if (https !== null) return https;
  try {
    const url = new URL(value);
    if (
      url.username !== ""
      || url.password !== ""
      || url.port !== ""
      || url.pathname !== ""
      || url.search !== ""
      || url.hash !== ""
      || url.href !== value
    ) return null;
    if (
      url.protocol === "ipfs:"
      && /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|[bB][a-zA-Z2-7]{31,127})$/u
        .test(url.hostname)
    ) return value;
    if (
      url.protocol === "ar:"
      && /^[A-Za-z0-9_-]{43}$/u.test(url.hostname)
    ) return value;
    return null;
  } catch {
    return null;
  }
}

function parseProjectMetadataFieldBindingV1(
  value: unknown,
): ProjectTokenMetadataFieldBindingV1 | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["staticSource", "argumentIndex", "argumentName"])
    || (
      value.staticSource !== "constructor-argument"
      && value.staticSource !== "initializer-argument"
      && value.staticSource !== "not-deterministically-extractable"
    )
    || (value.argumentName !== null && (
      typeof value.argumentName !== "string"
      || value.argumentName === ""
      || new TextEncoder().encode(value.argumentName).byteLength > 256
      || value.argumentName !== value.argumentName.normalize("NFC")
      || value.argumentName !== value.argumentName.trim()
      || hasLoneUtf16Surrogate(value.argumentName)
      || containsProjectMetadataSecret(value.argumentName)
      || /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u
        .test(value.argumentName)
    ))
  ) return null;
  const deterministic = value.staticSource !== "not-deterministically-extractable";
  if (
    deterministic !== (
      typeof value.argumentIndex === "number"
      && Number.isSafeInteger(value.argumentIndex)
      && value.argumentIndex >= 0
    )
    || (!deterministic && value.argumentName !== null)
  ) return null;
  return Object.freeze({
    staticSource: value.staticSource,
    argumentIndex: value.argumentIndex as number | null,
    argumentName: value.argumentName as string | null,
  });
}

export function parseCustomLaunchProjectMetadataV1(
  value: unknown,
): CustomLaunchProjectMetadataV1 | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "schemaVersion",
      "token",
      "presentation",
      "tokenMetadataBinding",
    ])
    || value.schemaVersion !== "programmable.project-metadata.v1"
    || !isRecord(value.token)
    || !hasExactKeys(value.token, ["name", "symbol"])
    || !canonicalText(value.token.name, 1, 64, 64)
    || !canonicalText(value.token.symbol, 1, 16, 16, {
      forbidWhitespace: true,
    })
    || !isRecord(value.presentation)
    || !hasExactKeys(value.presentation, [
      "schemaVersion",
      "description",
      "image",
      "links",
    ])
    || value.presentation.schemaVersion
      !== "programmable.launch-presentation-draft.v1"
    || !canonicalText(value.presentation.description, 0, 4_096, 4_096, {
      allowLineFeed: true,
    })
    || !Array.isArray(value.presentation.links)
    || value.presentation.links.length > 32
    || !isRecord(value.tokenMetadataBinding)
    || !hasExactKeys(value.tokenMetadataBinding, [
      "schemaVersion",
      "tokenTargetId",
      "declarationBinding",
      "standardReadModel",
      "name",
      "symbol",
      "postDeploymentReadback",
    ])
    || value.tokenMetadataBinding.schemaVersion
      !== "programmable.project-token-metadata-binding.v1"
    || typeof value.tokenMetadataBinding.tokenTargetId !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/u
      .test(value.tokenMetadataBinding.tokenTargetId)
    || containsProjectMetadataSecret(value.tokenMetadataBinding.tokenTargetId)
    || value.tokenMetadataBinding.declarationBinding !== "request-and-launch-id"
    || !isRecord(value.tokenMetadataBinding.standardReadModel)
    || !hasExactKeys(value.tokenMetadataBinding.standardReadModel, ["name", "symbol"])
    || typeof value.tokenMetadataBinding.standardReadModel.name !== "boolean"
    || typeof value.tokenMetadataBinding.standardReadModel.symbol !== "boolean"
    || value.tokenMetadataBinding.postDeploymentReadback !== "required"
  ) return null;

  const fieldName = parseProjectMetadataFieldBindingV1(
    value.tokenMetadataBinding.name,
  );
  const fieldSymbol = parseProjectMetadataFieldBindingV1(
    value.tokenMetadataBinding.symbol,
  );
  if (!fieldName || !fieldSymbol) return null;

  let image: CustomLaunchProjectMetadataV1["presentation"]["image"] = null;
  if (value.presentation.image !== null) {
    if (
      !isRecord(value.presentation.image)
      || !hasExactKeys(value.presentation.image, [
        "uri",
        "contentSha256",
        "mediaType",
        "byteLength",
        "width",
        "height",
      ])
      || canonicalProjectImageUri(value.presentation.image.uri) === null
      || typeof value.presentation.image.contentSha256 !== "string"
      || !sha256Pattern.test(value.presentation.image.contentSha256)
      || ![
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
      ].includes(String(value.presentation.image.mediaType))
      || typeof value.presentation.image.byteLength !== "number"
      || !Number.isSafeInteger(value.presentation.image.byteLength)
      || value.presentation.image.byteLength < 1
      || value.presentation.image.byteLength > 20 * 1_024 * 1_024
      || typeof value.presentation.image.width !== "number"
      || !Number.isSafeInteger(value.presentation.image.width)
      || value.presentation.image.width < 1
      || value.presentation.image.width > 8_192
      || typeof value.presentation.image.height !== "number"
      || !Number.isSafeInteger(value.presentation.image.height)
      || value.presentation.image.height < 1
      || value.presentation.image.height > 8_192
    ) return null;
    image = Object.freeze({
      uri: value.presentation.image.uri as string,
      contentSha256: value.presentation.image.contentSha256 as `sha256:${string}`,
      mediaType: value.presentation.image.mediaType as ProjectMetadataImageMediaType,
      byteLength: value.presentation.image.byteLength,
      width: value.presentation.image.width,
      height: value.presentation.image.height,
    });
  }

  const links: Array<Readonly<{ kind: ProjectMetadataLinkKind; uri: string }>> = [];
  let priorSortKey: string | null = null;
  for (const candidate of value.presentation.links) {
    if (
      !isRecord(candidate)
      || !hasExactKeys(candidate, ["kind", "uri"])
      || ![
        "website",
        "documentation",
        "x",
        "telegram",
        "discord",
        "github",
        "other",
      ].includes(String(candidate.kind))
    ) return null;
    const uri = publicCanonicalHttpsUrl(candidate.uri, { allowQuery: true });
    if (uri === null) return null;
    const sortKey = `${String(candidate.kind)}\u0000${uri}`;
    if (priorSortKey !== null && sortKey <= priorSortKey) return null;
    priorSortKey = sortKey;
    links.push(Object.freeze({
      kind: candidate.kind as ProjectMetadataLinkKind,
      uri,
    }));
  }

  return Object.freeze({
    schemaVersion: "programmable.project-metadata.v1",
    token: Object.freeze({
      name: value.token.name as string,
      symbol: value.token.symbol as string,
    }),
    presentation: Object.freeze({
      schemaVersion: "programmable.launch-presentation-draft.v1",
      description: value.presentation.description as string,
      image,
      links: Object.freeze(links),
    }),
    tokenMetadataBinding: Object.freeze({
      schemaVersion: "programmable.project-token-metadata-binding.v1",
      tokenTargetId: value.tokenMetadataBinding.tokenTargetId,
      declarationBinding: "request-and-launch-id",
      standardReadModel: Object.freeze({
        name: value.tokenMetadataBinding.standardReadModel.name,
        symbol: value.tokenMetadataBinding.standardReadModel.symbol,
      }),
      name: fieldName,
      symbol: fieldSymbol,
      postDeploymentReadback: "required",
    }),
  });
}

function parseV4LaunchSummary(
  value: Readonly<Record<string, unknown>>,
  account: string,
): LaunchResource | null {
  if (value.schemaVersion !== "programmable.custom-launch-summary.v4"
    || value.apiVersion !== "v4"
    || value.routeId !== "custom-launch:create:v4"
    || value.chainId !== "4663"
    || value.caip2 !== "eip155:4663"
    || value.chainDeploymentId !== "robinhood-mainnet-custom-launch-v1"
    || typeof value.chainDeploymentDescriptorDigest !== "string"
    || !/^0x[0-9a-f]{64}$/u.test(value.chainDeploymentDescriptorDigest)
    || typeof value.launchId !== "string"
    || !requestIdPattern.test(value.launchId)
    || value.requestId !== value.launchId
    || !isRecord(value.controller)
    || value.controller.namespace !== "eip155:4663"
    || typeof value.controller.address !== "string"
    || value.controller.address.toLowerCase() !== account.toLowerCase()
    || typeof value.status !== "string"
    || !statuses.has(value.status as LaunchStatus)
    || (value.walletHandoffUrl !== null && typeof value.walletHandoffUrl !== "string")
    || (value.expiresAt !== null && typeof value.expiresAt !== "string")
    || typeof value.createdAt !== "string"
    || typeof value.updatedAt !== "string") return null;
  return {
    schemaVersion: "programmable.custom-launch.v4",
    launchId: value.launchId,
    requestId: value.launchId,
    onchainLaunchId: null,
    routeId: "custom-launch:create:v4",
    ownerWallet: value.controller.address as `0x${string}`,
    status: value.status as LaunchStatus,
    requestHash: null,
    launchProfileVersion: null,
    launchProfileHash: null,
    launchIntentHash: null,
    projectMetadata: null,
    projectMetadataHash: null,
    fundingIntentHash: null,
    liquidityIntent: null,
    sourceVerification: null,
    walletHandoffUrl: value.walletHandoffUrl as string | null,
    expiresAt: value.expiresAt as string | null,
    secondsRemaining: null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    output: null,
    rawResourceV4: null,
    failure: null,
  };
}

function parseV4Launch(
  value: Readonly<Record<string, unknown>>,
  account: string,
): LaunchResource | null {
  if (value.schemaVersion !== "programmable.custom-launch.v4"
    || value.apiVersion !== "v4"
    || value.routeId !== "custom-launch:create:v4"
    || value.chainId !== "4663"
    || value.caip2 !== "eip155:4663"
    || typeof value.launchId !== "string"
    || !requestIdPattern.test(value.launchId)
    || typeof value.requestId !== "string"
    || !requestIdPattern.test(value.requestId)
    || !isRecord(value.controller)
    || value.controller.namespace !== "eip155:4663"
    || typeof value.controller.address !== "string"
    || value.controller.address.toLowerCase() !== account.toLowerCase()
    || typeof value.status !== "string"
    || !statuses.has(value.status as LaunchStatus)
    || typeof value.requestHash !== "string"
    || !sha256Pattern.test(value.requestHash)
    || typeof value.createdAt !== "string"
    || typeof value.updatedAt !== "string"
    || !isRecord(value.profile)
    || typeof value.profile.profileDigest !== "string"
    || !sha256Pattern.test(value.profile.profileDigest)
    || !isRecord(value.commitments)
    || typeof value.commitments.launchIntent !== "string"
    || !sha256Pattern.test(value.commitments.launchIntent)
    || typeof value.metadataCommitment !== "string"
    || !sha256Pattern.test(value.metadataCommitment)) return null;
  const projectMetadata = parseCustomLaunchProjectMetadataV1(value.projectMetadata);
  if (!projectMetadata) return null;
  let failure: LaunchResource["failure"] = null;
  if (value.failure !== null) {
    if (!isRecord(value.failure)
      || typeof value.failure.code !== "string"
      || typeof value.failure.message !== "string"
      || typeof value.failure.retryable !== "boolean") return null;
    failure = {
      code: value.failure.code,
      message: value.failure.message,
      retryable: value.failure.retryable,
      remediations: [],
    };
  }
  const onchain = isRecord(value.onchain) ? value.onchain : null;
  const onchainLaunchId = onchain
    && typeof onchain.routerLaunchId === "string"
    && /^0x[0-9a-f]{64}$/u.test(onchain.routerLaunchId)
    ? onchain.routerLaunchId as `0x${string}`
    : null;
  const walletHandoffUrl = typeof value.walletHandoffUrl === "string"
    ? value.walletHandoffUrl
    : isRecord(value.actionRequired)
      && typeof value.actionRequired.walletHandoffUrl === "string"
      ? value.actionRequired.walletHandoffUrl
      : null;
  const expiresAt = typeof value.expiresAt === "string"
    ? value.expiresAt
    : isRecord(value.actionRequired) && typeof value.actionRequired.expiresAt === "string"
      ? value.actionRequired.expiresAt
      : null;
  const secondsRemaining = typeof value.secondsRemaining === "number"
    && Number.isSafeInteger(value.secondsRemaining)
    && value.secondsRemaining >= 0
    ? value.secondsRemaining
    : null;
  const output = value.walletTransaction === null && value.preparedArtifact === null
    ? null
    : {
        walletTransaction: value.walletTransaction as JsonValue,
        artifact: value.preparedArtifact as JsonValue,
      };
  return {
    schemaVersion: "programmable.custom-launch.v4",
    launchId: value.launchId,
    requestId: value.requestId,
    onchainLaunchId,
    routeId: "custom-launch:create:v4",
    ownerWallet: value.controller.address as `0x${string}`,
    status: value.status as LaunchStatus,
    requestHash: value.requestHash as `sha256:${string}`,
    launchProfileVersion: null,
    launchProfileHash: value.profile.profileDigest as `sha256:${string}`,
    launchIntentHash: value.commitments.launchIntent as `sha256:${string}`,
    projectMetadata,
    projectMetadataHash: value.metadataCommitment as `sha256:${string}`,
    fundingIntentHash: null,
    liquidityIntent: null,
    sourceVerification: null,
    walletHandoffUrl,
    expiresAt,
    secondsRemaining,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    output,
    rawResourceV4: value as Record<string, JsonValue>,
    failure,
  };
}

function parseLaunch(value: unknown, account: string): LaunchResource | null {
  if (isRecord(value)
    && value.schemaVersion === "programmable.custom-launch-summary.v4") {
    return parseV4LaunchSummary(value, account);
  }
  if (isRecord(value)
    && value.schemaVersion === "programmable.custom-launch.v4"
    && value.routeId === "custom-launch:create:v4") {
    return parseV4Launch(value, account);
  }
  const v1 = isRecord(value)
    && value.schemaVersion === "programmable.custom-launch.v1"
    && value.routeId === "custom-launch:create:v1";
  const v2 = isRecord(value)
    && value.schemaVersion === "programmable.custom-launch.v2"
    && value.routeId === "custom-launch:create:v2";
  const v3 = isRecord(value)
    && value.schemaVersion === "programmable.custom-launch.v3"
    && value.routeId === "custom-launch:create:v3";
  if (
    !isRecord(value)
    || (!v1 && !v2 && !v3)
    || typeof value.launchId !== "string"
    || !requestIdPattern.test(value.launchId)
    || typeof value.requestId !== "string"
    || !requestIdPattern.test(value.requestId)
    || value.requestId !== value.launchId
    || (value.onchainLaunchId !== null
      && typeof value.onchainLaunchId !== "string")
    || typeof value.ownerWallet !== "string"
    || value.ownerWallet.toLowerCase() !== account.toLowerCase()
    || typeof value.status !== "string"
    || !statuses.has(value.status as LaunchStatus)
    || typeof value.requestHash !== "string"
    || !sha256Pattern.test(value.requestHash)
    || (v1 && [
      "simulating",
      "awaiting_funding_authorization",
      "funding_authorization_verified",
    ].includes(value.status))
    || (v2 && [
      "awaiting_funding_authorization",
      "funding_authorization_verified",
    ].includes(value.status))
    || typeof value.createdAt !== "string"
    || typeof value.updatedAt !== "string"
    || (value.output !== null && !isRecord(value.output))
  ) return null;
  const launchProfileHash = (v2 || v3)
    && typeof value.launchProfileHash === "string"
    && sha256Pattern.test(value.launchProfileHash)
    ? value.launchProfileHash as `sha256:${string}`
    : null;
  const launchIntentHash = (v2 || v3)
    && typeof value.launchIntentHash === "string"
    && sha256Pattern.test(value.launchIntentHash)
    ? value.launchIntentHash as `sha256:${string}`
    : null;
  if ((v2 || v3) && (!launchProfileHash || !launchIntentHash)) return null;
  const launchProfileVersion = v3
    && (value.launchProfileVersion === "2.0.0"
      || value.launchProfileVersion === "3.0.0"
      || value.launchProfileVersion === "3.1.0"
      || value.launchProfileVersion === "3.2.0"
      || value.launchProfileVersion === "3.3.0"
      || value.launchProfileVersion === "3.4.0")
    ? value.launchProfileVersion
    : null;
  if (v3 && launchProfileVersion === null) return null;
  const projectMetadata = v3 && value.projectMetadata !== null
    ? parseCustomLaunchProjectMetadataV1(value.projectMetadata)
    : null;
  const projectMetadataHash = v3
    && typeof value.projectMetadataHash === "string"
    && sha256Pattern.test(value.projectMetadataHash)
    ? value.projectMetadataHash as `sha256:${string}`
    : null;
  if (
    v3
    && (
      !Object.hasOwn(value, "projectMetadata")
      || !Object.hasOwn(value, "projectMetadataHash")
      || (value.projectMetadata === null) !== (value.projectMetadataHash === null)
      || (value.projectMetadata !== null && !projectMetadata)
      || (value.projectMetadataHash !== null && !projectMetadataHash)
      || ((launchProfileVersion === "2.0.0"
        || launchProfileVersion === "3.0.0"
        || launchProfileVersion === "3.1.0") && (
        projectMetadata !== null || projectMetadataHash !== null
      ))
      || ((launchProfileVersion === "3.2.0"
        || launchProfileVersion === "3.3.0"
        || launchProfileVersion === "3.4.0") && (
        projectMetadata === null || projectMetadataHash === null
      ))
    )
  ) return null;
  if (
    (launchProfileVersion === "3.2.0"
      || launchProfileVersion === "3.3.0"
      || launchProfileVersion === "3.4.0")
    && projectMetadata
    && projectMetadataHash
    && browserProjectMetadataHashV1(projectMetadata) !== projectMetadataHash
  ) return null;
  const fundingIntentHash = v3
    && typeof value.fundingIntentHash === "string"
    && /^0x[0-9a-f]{64}$/u.test(value.fundingIntentHash)
    ? value.fundingIntentHash as `0x${string}`
    : null;
  const liquidityIntent = v3
    ? parseCustomLaunchLiquidityIntentV3(value.liquidityIntent)
    : null;
  if (v3 && !liquidityIntent) return null;
  const sourceVerification = parseSourceVerificationStatusV1(
    value.sourceVerification,
  );
  if (
    value.sourceVerification !== undefined
    && value.sourceVerification !== null
    && !sourceVerification
  ) return null;
  if (sourceVerification && value.status !== "finalized") return null;
  const walletHandoff = v3
    ? parseCustomLaunchWalletHandoffV1(value, value.launchId)
    : { walletHandoffUrl: null, expiresAt: null, secondsRemaining: null };
  if (v3 && !walletHandoff) return null;
  if (
    walletHandoff?.walletHandoffUrl
    && !["awaiting_funding_authorization", "authorized"]
      .includes(value.status as string)
  ) return null;
  let failure: LaunchResource["failure"] = null;
  if (value.failure !== null) {
    if (
      !isRecord(value.failure)
      || typeof value.failure.code !== "string"
      || typeof value.failure.message !== "string"
      || typeof value.failure.retryable !== "boolean"
    ) return null;
    failure = {
      code: value.failure.code,
      message: value.failure.message,
      retryable: value.failure.retryable,
      remediations: customLaunchRemediationsV1(null, value.failure),
    };
  }
  return {
    schemaVersion: value.schemaVersion as LaunchResource["schemaVersion"],
    launchId: value.launchId,
    requestId: value.requestId,
    onchainLaunchId: value.onchainLaunchId as `0x${string}` | null,
    routeId: value.routeId as LaunchResource["routeId"],
    ownerWallet: value.ownerWallet as `0x${string}`,
    status: value.status as LaunchStatus,
    requestHash: value.requestHash as `sha256:${string}`,
    launchProfileVersion,
    launchProfileHash,
    launchIntentHash,
    projectMetadata,
    projectMetadataHash,
    fundingIntentHash,
    liquidityIntent,
    sourceVerification,
    walletHandoffUrl: walletHandoff?.walletHandoffUrl ?? null,
    expiresAt: walletHandoff?.expiresAt ?? null,
    secondsRemaining: walletHandoff?.secondsRemaining ?? null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    output: value.output as Record<string, JsonValue> | null,
    rawResourceV4: null,
    failure,
  };
}

export function parseHistoryPage(
  value: unknown,
  account: string,
): HistoryPage | null {
  if (
    !isRecord(value)
    || typeof value.schemaVersion !== "string"
    || !listSchemaVersions.has(value.schemaVersion)
    || !Array.isArray(value.launches)
    || value.launches.length > pageSize * 4
    || (value.nextCursor !== null && typeof value.nextCursor !== "string")
  ) return null;
  const launches: LaunchResource[] = [];
  for (const candidate of value.launches) {
    const parsed = parseLaunch(candidate, account);
    if (!parsed) return null;
    launches.push(parsed);
  }
  return {
    launches,
    nextCursor: value.nextCursor as string | null,
  };
}

class LaunchHistoryRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs: number | null,
  ) {
    super(message);
    this.name = "LaunchHistoryRequestError";
  }
}

export function launchPollingRetryAfterMs(
  status: number,
  retryAfterMs: number | null,
) {
  return (status === 429 || status === 503) && retryAfterMs !== null
    ? retryAfterMs
    : null;
}

function readApiError(
  response: Response,
  value: unknown,
  fallback = "Unable to load launch history.",
) {
  const retryAfter = response.headers.get("retry-after");
  const retryAfterSeconds = retryAfter && /^[1-9][0-9]{0,4}$/u.test(retryAfter)
    ? Number(retryAfter)
    : null;
  if (!isRecord(value) || !isRecord(value.error)) {
    return new LaunchHistoryRequestError(
      fallback,
      response.status,
      retryAfterSeconds === null ? null : retryAfterSeconds * 1_000,
    );
  }
  const message = typeof value.error.message === "string" && value.error.message.trim()
    ? value.error.message
    : fallback;
  const requestId = typeof value.error.requestId === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,127}$/u.test(value.error.requestId)
    ? value.error.requestId
    : null;
  const retryCopy = (response.status === 429 || response.status === 503)
    && retryAfterSeconds !== null
    ? ` Try again in ${retryAfterSeconds} seconds.`
    : "";
  const requestCopy = requestId ? ` Request ID: ${requestId}.` : "";
  return new LaunchHistoryRequestError(
    `${message}${retryCopy}${requestCopy}`,
    response.status,
    retryAfterSeconds === null ? null : retryAfterSeconds * 1_000,
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : dateFormatter.format(date);
}

function shortId(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function statusCopy(status: LaunchStatus) {
  switch (status) {
    case "received": return "Received";
    case "validating": return "Validating";
    case "pending_review": return "Admission checks running";
    case "action_required": return "Changes required";
    case "prepared": return "Prepared";
    case "awaiting_funding_authorization": return "Funding signature required";
    case "funding_authorization_verified": return "Funding verified";
    case "simulating": return "Simulating";
    case "authorized": return "Wallet action required";
    case "awaiting_wallet_signature": return "Wallet action required";
    case "wallet_action_required": return "Wallet action required";
    case "submitted": return "Confirming onchain";
    case "sequencer_soft_confirmed": return "Sequencer confirmed";
    case "ethereum_posted": return "Posted to Ethereum";
    case "finalized": return "Finalized";
    case "failed": return "Failed";
    case "cancelled": return "Cancelled";
  }
}

function statusDescription(status: LaunchStatus) {
  switch (status) {
    case "received": return "The API accepted this request.";
    case "validating": return "The API is validating the request.";
    case "pending_review": return "Exact-source checks and the bounded static baseline are still running.";
    case "action_required": return "Fix the reported source or configuration finding, then rebuild and submit a new immutable request.";
    case "prepared": return "The launch transaction has been prepared.";
    case "awaiting_funding_authorization": return "Review and sign the exact USDC funding authorization. This does not send a transaction.";
    case "funding_authorization_verified": return "The funding signature passed verification. The Router transaction is being prepared.";
    case "simulating": return "The exact wallet transaction is being simulated.";
    case "authorized": return "Review the exact Ethereum Mainnet transaction, then ask your wallet to send it.";
    case "awaiting_wallet_signature": return "Review the exact Robinhood Chain Router transaction, then choose whether to send it from your wallet.";
    case "wallet_action_required": return "Review the exact Robinhood Chain Router transaction, then choose whether to send it from your wallet.";
    case "submitted": return "The wallet transaction is being tracked onchain.";
    case "sequencer_soft_confirmed": return "Robinhood Chain reported a soft confirmation. Ethereum posting and finality are still pending.";
    case "ethereum_posted": return "The transaction was posted to Ethereum. Finality is still pending.";
    case "finalized": return "The Router launch reached 64+ confirmations. Source, liquidity, custody and trading remain separate states.";
    case "failed": return "This request did not complete.";
    case "cancelled": return "This request was cancelled.";
  }
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

function walletTransaction(launch: LaunchResource) {
  const candidate = launch.output?.walletTransaction;
  return isRecord(candidate) ? candidate : null;
}

function fundingAuthorizationReview(launch: LaunchResource) {
  if (
    launch.routeId !== "custom-launch:create:v3"
    || launch.status !== "awaiting_funding_authorization"
    || !launch.fundingIntentHash
  ) return null;
  try {
    return prepareCustomLaunchFundingAuthorizationV3(
      launch.output,
      launch.ownerWallet,
      launch.launchId,
      launch.fundingIntentHash,
    );
  } catch {
    return null;
  }
}

function routerTransactionReview(launch: LaunchResource) {
  if (
    launch.routeId !== "custom-launch:create:v3"
    || launch.status !== "authorized"
  ) return null;
  try {
    return prepareCustomLaunchRouterReviewV3(
      launch.output,
      launch.ownerWallet,
    );
  } catch {
    return null;
  }
}

export function walletPlatformFeeDisclosureV3(
  launchProfileVersion: LaunchResource["launchProfileVersion"],
) {
  if (launchProfileVersion === "3.3.0") {
    return "No automatic Programmable fee claim";
  }
  if (launchProfileVersion === "3.4.0") {
    return "10 bps · exact fee-path verification required";
  }
  return "Defined by the bound launch profile";
}

function sameFundingAuthorization(
  left: CustomLaunchFundingAuthorizationV3,
  right: CustomLaunchFundingAuthorizationV3,
) {
  return left.fundingIntentHash === right.fundingIntentHash
    && left.typedDataDigest === right.typedDataDigest
    && left.chainId === right.chainId
    && left.launchId === right.launchId
    && left.submissionPath === right.submissionPath
    && left.token === right.token
    && left.from === right.from
    && left.to === right.to
    && left.value === right.value
    && left.validAfter === right.validAfter
    && left.validBefore === right.validBefore
    && left.nonce === right.nonce
    && JSON.stringify(left.typedData) === JSON.stringify(right.typedData);
}

function sameRouterReview(
  left: CustomLaunchRouterReviewV3,
  right: CustomLaunchRouterReviewV3,
) {
  return left.transactionPreimageHash === right.transactionPreimageHash
    && left.graphCommitment === right.graphCommitment
    && left.artifactHash === right.artifactHash
    && left.permitDigest === right.permitDigest
    && left.initializerCalldataHash === right.initializerCalldataHash
    && left.selector === right.selector
    && left.calldataLengthBytes === right.calldataLengthBytes
    && JSON.stringify(left.walletAction) === JSON.stringify(right.walletAction);
}

type WalletProjectMetadataBindingV1 = Readonly<{
  mode: "bound-metadata";
  requestHash: `sha256:${string}`;
  launchIntentHash: `sha256:${string}`;
  projectMetadata: CustomLaunchProjectMetadataV1;
  projectMetadataHash: `sha256:${string}`;
}>;

type WalletLegacyProjectBindingV1 = Readonly<{
  mode: "legacy-exact-retry";
  launchProfileVersion: "2.0.0" | "3.0.0" | "3.1.0";
  requestHash: `sha256:${string}`;
  launchIntentHash: `sha256:${string}`;
}>;

type WalletProjectRequestBindingV1 = WalletProjectMetadataBindingV1
  | WalletLegacyProjectBindingV1;

export type WalletProjectMetadataRequirementsV1 = Readonly<{
  name: boolean;
  symbol: boolean;
  description: boolean;
  image: boolean;
  website: boolean;
  x: boolean;
  complete: boolean;
}>;

const artifactProjectMetadataKeys = Object.freeze([
  "unboundGraphBundleHash",
  "projectMetadata",
  "projectMetadataHash",
] as const);

const projectMetadataHashDomain = "programmable.project-metadata.v1";
const projectGraphMetadataHashDomain =
  "programmable.custom-graph-project-metadata.v1";

function browserProjectMetadataHashV1(
  projectMetadata: CustomLaunchProjectMetadataV1,
) {
  try {
    return canonicalBrowserSha256V2(
      projectMetadataHashDomain,
      projectMetadata,
    );
  } catch {
    return null;
  }
}

function browserProjectGraphBundleHashV1(
  unboundGraphBundleHash: `sha256:${string}`,
  projectMetadataHash: `sha256:${string}`,
) {
  try {
    return canonicalBrowserSha256V2(
      projectGraphMetadataHashDomain,
      { graphBundleHash: unboundGraphBundleHash, projectMetadataHash },
    );
  } catch {
    return null;
  }
}

function artifactProjectMetadataKeyCount(
  artifact: Readonly<Record<string, unknown>>,
) {
  return artifactProjectMetadataKeys.filter((key) =>
    Object.hasOwn(artifact, key)).length;
}

/**
 * Current-profile launches must carry the public identity people will see on
 * Programmable and downstream indexers before either wallet boundary opens.
 * This is intentionally derived from the immutable metadata object, never
 * from a mutable form or caller-provided display fallback.
 */
export function walletProjectMetadataRequirementsV1(
  projectMetadata: CustomLaunchProjectMetadataV1,
): WalletProjectMetadataRequirementsV1 {
  const requirements = {
    name: projectMetadata.token.name.trim().length > 0,
    symbol: projectMetadata.token.symbol.trim().length > 0,
    description: projectMetadata.presentation.description.trim().length > 0,
    image: projectMetadata.presentation.image !== null,
    website: projectMetadata.presentation.links.some(
      (link) => link.kind === "website",
    ),
    x: projectMetadata.presentation.links.some((link) => link.kind === "x"),
  };
  return Object.freeze({
    ...requirements,
    complete: Object.values(requirements).every(Boolean),
  });
}

function requiresCurrentProjectMetadata(launch: LaunchResource) {
  return launch.routeId === "custom-launch:create:v4"
    || launch.launchProfileVersion === "3.3.0"
    || launch.launchProfileVersion === "3.4.0";
}

export function walletProjectMetadataReadyForReviewV1(launch: LaunchResource) {
  const summary = walletProjectMetadataSummaryV1(launch);
  return summary !== null
    && (!requiresCurrentProjectMetadata(launch)
      || walletProjectMetadataRequirementsV1(summary.projectMetadata).complete);
}

export function walletProjectMetadataSummaryV1(
  launch: LaunchResource,
): WalletProjectMetadataBindingV1 | null {
  if (
    (launch.routeId !== "custom-launch:create:v4" && (
      launch.routeId !== "custom-launch:create:v3"
      || (launch.launchProfileVersion !== "3.2.0"
        && launch.launchProfileVersion !== "3.3.0"
        && launch.launchProfileVersion !== "3.4.0")
    ))
    || !launch.launchIntentHash
    || !launch.requestHash
    || !launch.projectMetadata
    || !launch.projectMetadataHash
    || browserProjectMetadataHashV1(launch.projectMetadata)
      !== launch.projectMetadataHash
  ) return null;
  return Object.freeze({
    mode: "bound-metadata",
    requestHash: launch.requestHash,
    launchIntentHash: launch.launchIntentHash,
    projectMetadata: launch.projectMetadata,
    projectMetadataHash: launch.projectMetadataHash,
  });
}

export function walletProjectMetadataBindingV1(
  launch: LaunchResource,
): WalletProjectMetadataBindingV1 | null {
  const summary = walletProjectMetadataSummaryV1(launch);
  if (
    !summary
    || ((launch.launchProfileVersion === "3.3.0"
      || launch.launchProfileVersion === "3.4.0")
      && !walletProjectMetadataRequirementsV1(summary.projectMetadata).complete)
  ) return null;
  const artifact = launch.output?.artifact;
  if (artifact !== undefined) {
    if (!isRecord(artifact)) return null;
    const embeddedKeyCount = artifactProjectMetadataKeyCount(artifact);
    if (embeddedKeyCount !== artifactProjectMetadataKeys.length) return null;
    if (embeddedKeyCount === artifactProjectMetadataKeys.length) {
      const embeddedMetadata = parseCustomLaunchProjectMetadataV1(
        artifact.projectMetadata,
      );
      if (
        !embeddedMetadata
        || typeof artifact.unboundGraphBundleHash !== "string"
        || !sha256Pattern.test(artifact.unboundGraphBundleHash)
        || typeof artifact.graphBundleHash !== "string"
        || !sha256Pattern.test(artifact.graphBundleHash)
        || artifact.projectMetadataHash !== summary.projectMetadataHash
        || browserProjectMetadataHashV1(embeddedMetadata)
          !== summary.projectMetadataHash
        || browserProjectGraphBundleHashV1(
          artifact.unboundGraphBundleHash as `sha256:${string}`,
          summary.projectMetadataHash,
        ) !== artifact.graphBundleHash
        || JSON.stringify(embeddedMetadata)
          !== JSON.stringify(summary.projectMetadata)
      ) return null;
    }
  } else if (launch.status === "authorized") {
    return null;
  }
  return summary;
}

function walletLegacyProjectBindingV1(
  launch: LaunchResource,
): WalletLegacyProjectBindingV1 | null {
  if (
    launch.routeId !== "custom-launch:create:v3"
    || (
      launch.launchProfileVersion !== "2.0.0"
      && launch.launchProfileVersion !== "3.0.0"
      && launch.launchProfileVersion !== "3.1.0"
    )
    || !launch.launchIntentHash
    || !launch.requestHash
    || launch.projectMetadata !== null
    || launch.projectMetadataHash !== null
  ) return null;
  const artifact = launch.output?.artifact;
  if (artifact !== undefined) {
    if (
      !isRecord(artifact)
      || artifactProjectMetadataKeyCount(artifact) !== 0
    ) return null;
  }
  return Object.freeze({
    mode: "legacy-exact-retry",
    launchProfileVersion: launch.launchProfileVersion,
    requestHash: launch.requestHash,
    launchIntentHash: launch.launchIntentHash,
  });
}

export function walletProjectRequestBindingV1(
  launch: LaunchResource,
): WalletProjectRequestBindingV1 | null {
  return walletProjectMetadataBindingV1(launch)
    ?? walletLegacyProjectBindingV1(launch);
}

function sameProjectRequestBindingV1(
  left: WalletProjectRequestBindingV1,
  right: WalletProjectRequestBindingV1,
) {
  if (left.mode !== right.mode) return false;
  if (
    left.mode === "legacy-exact-retry"
    && right.mode === "legacy-exact-retry"
  ) {
    return left.launchProfileVersion === right.launchProfileVersion
      && left.requestHash === right.requestHash
      && left.launchIntentHash === right.launchIntentHash;
  }
  if (left.mode !== "bound-metadata" || right.mode !== "bound-metadata") {
    return false;
  }
  return left.requestHash === right.requestHash
    && left.launchIntentHash === right.launchIntentHash
    && left.projectMetadataHash === right.projectMetadataHash
    && JSON.stringify(left.projectMetadata) === JSON.stringify(right.projectMetadata);
}

function reviewResourceForLaunch(
  launch: LaunchResource,
  hydrated: LaunchResource | undefined,
) {
  return hydrated
    && launchResourceKey(hydrated) === launchResourceKey(launch)
    && hydrated.status === launch.status
    && hydrated.updatedAt === launch.updatedAt
    ? hydrated
    : launch;
}

function formatUsdcAmount(value: string) {
  const raw = BigInt(value).toString().padStart(7, "0");
  const whole = raw.slice(0, -6);
  const fraction = raw.slice(-6).replace(/0+$/u, "");
  return `${whole}${fraction ? `.${fraction}` : ""} USDC`;
}

function fundingValidityCopy(value: string) {
  const milliseconds = Number(BigInt(value) * 1_000n);
  return Number.isSafeInteger(milliseconds)
    ? formatDate(new Date(milliseconds).toISOString())
    : "Invalid";
}

function fundingMode(launch: LaunchResource) {
  const mode = launch.output?.fundingMode;
  return mode === "none"
    || mode === "wallet-transaction-value"
    || mode === "eip-3009-receive-with-authorization"
    ? mode
    : null;
}

function handoffExpiryCopy(launch: LaunchResource) {
  if (!launch.expiresAt) return null;
  if (launch.secondsRemaining === 0) return "Expired";
  const absolute = formatDate(launch.expiresAt);
  if (launch.secondsRemaining === null) return absolute;
  const minutes = Math.max(1, Math.ceil(launch.secondsRemaining / 60));
  return `${absolute} · about ${minutes} minute${minutes === 1 ? "" : "s"} remaining`;
}

function sameWalletHandoff(
  left: Pick<LaunchResource, "walletHandoffUrl" | "expiresAt">,
  right: Pick<LaunchResource, "walletHandoffUrl" | "expiresAt">,
) {
  return left.walletHandoffUrl === right.walletHandoffUrl
    && left.expiresAt === right.expiresAt;
}

function onchainTransactionHash(launch: LaunchResource) {
  const v4Onchain = launch.rawResourceV4?.onchain;
  const onchain = isRecord(v4Onchain) ? v4Onchain : launch.output?.onchain;
  if (!isRecord(onchain) || typeof onchain.transactionHash !== "string") {
    return null;
  }
  return transactionHashPattern.test(onchain.transactionHash)
    ? onchain.transactionHash as `0x${string}`
    : null;
}

function terminalStatus(status: LaunchStatus) {
  return status === "finalized" || status === "failed" || status === "cancelled";
}

export function launchResourceIdentity(
  launch: Pick<LaunchResource, "routeId" | "launchId" | "requestId">,
) {
  return launch.routeId === "custom-launch:create:v4"
    ? launch.launchId
    : launch.requestId;
}

function launchResourceKey(
  launch: Pick<LaunchResource, "routeId" | "launchId" | "requestId">,
) {
  return `${launch.routeId}:${launchResourceIdentity(launch)}`;
}

function updatedAtTime(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function selectMonotonicLaunchResource(
  current: LaunchResource,
  incoming: LaunchResource,
) {
  if (launchResourceKey(current) !== launchResourceKey(incoming)) {
    return incoming;
  }
  if (terminalStatus(current.status) && current.status !== incoming.status) {
    return current;
  }

  const currentRank = launchStatusRank[current.status];
  const incomingRank = launchStatusRank[incoming.status];
  if (incomingRank < currentRank) return current;
  if (incomingRank > currentRank) return incoming;
  return updatedAtTime(incoming.updatedAt) > updatedAtTime(current.updatedAt)
    ? incoming
    : current;
}

export function mergeLaunchResources(
  current: readonly LaunchResource[],
  incoming: readonly LaunchResource[],
  incomingOrderFirst: boolean,
) {
  const currentByRequestId = new Map(
    current.map((launch) => [launchResourceKey(launch), launch] as const),
  );
  const incomingByRequestId = new Map(
    incoming.map((launch) => [launchResourceKey(launch), launch] as const),
  );

  if (incomingOrderFirst) {
    return [
      ...incoming.map((launch) => {
        const existing = currentByRequestId.get(launchResourceKey(launch));
        return existing
          ? selectMonotonicLaunchResource(existing, launch)
          : launch;
      }),
      ...current.filter((launch) =>
        !incomingByRequestId.has(launchResourceKey(launch))),
    ];
  }

  return [
    ...current.map((launch) => {
      const updated = incomingByRequestId.get(launchResourceKey(launch));
      return updated
        ? selectMonotonicLaunchResource(launch, updated)
        : launch;
    }),
    ...incoming.filter((launch) =>
      !currentByRequestId.has(launchResourceKey(launch))),
  ];
}

function pollDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve(true);
    }, milliseconds);
    const abort = () => {
      window.clearTimeout(timeout);
      resolve(false);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function HistorySkeleton() {
  return (
    <>
      <span className={styles.visuallyHidden} role="status">
        Loading launch history
      </span>
      <div className={styles.skeletonList} aria-hidden="true">
        <span className={styles.skeletonRow} />
      </div>
    </>
  );
}

type ProjectMetadataImageV1 = NonNullable<
  CustomLaunchProjectMetadataV1["presentation"]["image"]
>;

type VerifiedProjectImageStateV1 = Readonly<{
  state: "none" | "verifying" | "verified" | "verified-gif" | "unavailable";
  objectUrl: string | null;
  imageKey: string | null;
}>;

const projectImageVerificationTimeoutMs = 8_000;
const projectImageMaximumBytes = 20 * 1_024 * 1_024;

export function projectImageFetchUrlV1(uri: string) {
  const url = new URL(uri);
  if (url.protocol === "https:") return url.href;
  if (url.protocol === "ipfs:") {
    return `https://ipfs.io/ipfs/${url.hostname}`;
  }
  if (url.protocol === "ar:") {
    return `https://arweave.net/${url.hostname}`;
  }
  throw new TypeError("Unsupported project image URI");
}

async function verifiedProjectImageDimensionsV1(
  blob: Blob,
  bytes: Uint8Array,
  mediaType: ProjectMetadataImageMediaType,
  signal: AbortSignal,
) {
  if (mediaType === "image/gif") {
    const signature = String.fromCharCode(...bytes.subarray(0, 6));
    if (
      bytes.byteLength < 10
      || (signature !== "GIF87a" && signature !== "GIF89a")
    ) throw new TypeError("Invalid GIF bytes");
    return Object.freeze({
      width: bytes[6]! | (bytes[7]! << 8),
      height: bytes[8]! | (bytes[9]! << 8),
    });
  }
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    try {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      return Object.freeze({ width: bitmap.width, height: bitmap.height });
    } finally {
      bitmap.close();
    }
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    const dimensions = await new Promise<Readonly<{ width: number; height: number }>>(
      (resolve, reject) => {
        const image = new window.Image();
        const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
        signal.addEventListener("abort", onAbort, { once: true });
        image.onload = () => {
          signal.removeEventListener("abort", onAbort);
          resolve(Object.freeze({
            width: image.naturalWidth,
            height: image.naturalHeight,
          }));
        };
        image.onerror = () => {
          signal.removeEventListener("abort", onAbort);
          reject(new TypeError("Project image could not be decoded"));
        };
        image.referrerPolicy = "no-referrer";
        image.src = objectUrl;
      },
    );
    return dimensions;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function fetchVerifiedProjectImageV1(
  image: ProjectMetadataImageV1,
  signal: AbortSignal,
) {
  const response = await fetch(projectImageFetchUrlV1(image.uri), {
    cache: "no-store",
    credentials: "omit",
    headers: { Accept: image.mediaType },
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal,
  });
  if (!response.ok || response.redirected || response.body === null) {
    throw new TypeError("Project image response is unavailable");
  }
  if (response.headers.get("content-type") !== image.mediaType) {
    throw new TypeError("Project image media type changed");
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (
      !Number.isSafeInteger(parsedLength)
      || parsedLength < 0
      || parsedLength > projectImageMaximumBytes
    ) throw new TypeError("Project image response is too large");
  }
  const bytes = new Uint8Array(image.byteLength);
  const reader = response.body.getReader();
  let offset = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (
        offset + chunk.value.byteLength > image.byteLength
        || offset + chunk.value.byteLength > projectImageMaximumBytes
      ) throw new TypeError("Project image byte length changed");
      bytes.set(chunk.value, offset);
      offset += chunk.value.byteLength;
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  if (offset !== image.byteLength || fileSha256V2(bytes) !== image.contentSha256) {
    throw new TypeError("Project image bytes changed");
  }
  const blob = new Blob([bytes], { type: image.mediaType });
  const dimensions = await verifiedProjectImageDimensionsV1(
    blob,
    bytes,
    image.mediaType,
    signal,
  );
  if (dimensions.width !== image.width || dimensions.height !== image.height) {
    throw new TypeError("Project image dimensions changed");
  }
  return Object.freeze({ blob, mediaType: image.mediaType });
}

function useVerifiedProjectImageV1(image: ProjectMetadataImageV1 | null) {
  const imageKey = image
    ? `${image.uri}\u0000${image.contentSha256}`
    : null;
  const [preview, setPreview] = useState<VerifiedProjectImageStateV1>(() =>
    Object.freeze({ state: "none", objectUrl: null, imageKey: null }));
  useEffect(() => {
    if (!image || !imageKey) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    let active = true;
    const timeout = window.setTimeout(
      () => controller.abort(),
      projectImageVerificationTimeoutMs,
    );
    void fetchVerifiedProjectImageV1(image, controller.signal)
      .then(({ blob, mediaType }) => {
        if (!active) return;
        if (mediaType === "image/gif") {
          setPreview(Object.freeze({
            state: "verified-gif",
            objectUrl: null,
            imageKey,
          }));
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setPreview(Object.freeze({ state: "verified", objectUrl, imageKey }));
      })
      .catch(() => {
        if (active) setPreview(Object.freeze({
          state: "unavailable",
          objectUrl: null,
          imageKey,
        }));
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [image, imageKey]);
  if (!imageKey) {
    return Object.freeze({ state: "none", objectUrl: null, imageKey: null });
  }
  return preview.imageKey === imageKey
    ? preview
    : Object.freeze({ state: "verifying", objectUrl: null, imageKey });
}

const projectMetadataLinkLabels: Readonly<Record<ProjectMetadataLinkKind, string>> =
  Object.freeze({
    website: "Website",
    documentation: "Docs",
    x: "X",
    telegram: "Telegram",
    discord: "Discord",
    github: "GitHub",
    other: "Project link",
  });

function projectMetadataLinkDisplayLabels(
  links: CustomLaunchProjectMetadataV1["presentation"]["links"],
) {
  const bases = links.map((link) => {
    return `${projectMetadataLinkLabels[link.kind]} · ${link.uri}`;
  });
  const totals = new Map<string, number>();
  for (const base of bases) totals.set(base, (totals.get(base) ?? 0) + 1);
  const seen = new Map<string, number>();
  return bases.map((base) => {
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return (totals.get(base) ?? 0) > 1 ? `${base} ${count}` : base;
  });
}

export function DeveloperLaunchMetadataPreview({
  launch,
}: Readonly<{ launch: LaunchResource }>) {
  const binding = walletProjectMetadataSummaryV1(launch);
  if (binding) return <ProjectMetadataReview launch={launch} binding={binding} />;
  const legacy = walletLegacyProjectBindingV1(launch);
  if (legacy) {
    return (
      <div className={styles.metadataUnavailable} role="status">
        <strong>Legacy launch identity</strong>
        <p>
          This immutable {legacy.launchProfileVersion}
          {" request predates bound project metadata. Exact retries remain available, but no project name, symbol, image or links can be reviewed for this record."}
        </p>
      </div>
    );
  }
  if (launch.routeId !== "custom-launch:create:v3"
    && launch.routeId !== "custom-launch:create:v4") return null;
  return (
    <div className={styles.metadataUnavailable} role="status">
      <strong>Bound project metadata unavailable</strong>
      <p>
        {launch.requestHash === null
          ? "Load the exact wallet review to see the launch details supplied by your agent."
          : "Ask your agent to provide the missing or corrected launch details, then repack and submit a new request. This record remains visible; its bound details cannot be edited here."}
      </p>
    </div>
  );
}

export function DeveloperRobinhoodFeePreview({ resource }: Readonly<{ resource: unknown }>) {
  const fee = parseRobinhoodFeeReviewV1(resource);
  if (!fee) return <div className={styles.metadataUnavailable} role="status">
    <strong>Bound fee verification unavailable</strong>
    <p>Load the exact launch review. The server must bind the platform, creator and LP fee settings before a wallet transaction can open.</p>
  </div>;
  return <section className={styles.routerReview} aria-label="Robinhood launch fees">
    <div className={styles.stepHeading}><strong>Robinhood launch fees</strong></div>
    <dl className={styles.reviewGrid}>
      <div><dt>Programmable fee</dt><dd>0.2% on each successful buy and sell</dd></div>
      <div><dt>Creator buy fee</dt><dd>{fee.creatorBuyFeeBps / 100}%</dd></div>
      <div><dt>Creator sell fee</dt><dd>{fee.creatorSellFeeBps / 100}%</dd></div>
      <div><dt>{fee.lpFeeMode === "dynamic" ? "Maximum module LP fee" : "Pool LP fee"}</dt>
        <dd>{(fee.lpFeeMode === "dynamic" ? fee.maxModuleLpFeePips : fee.lpFeePips) / 10000}% {fee.lpFeeMode === "dynamic" ? "cap" : "fixed"}</dd></div>
      <div><dt>Platform treasury</dt><dd><code>{fee.platformRecipient}</code></dd></div>
      <div><dt>Creator fee recipient</dt><dd><code>{fee.creatorFeeRecipient}</code></dd></div>
      <div><dt>Fee vault</dt><dd><code>{fee.vaultAddress}</code></dd></div>
    </dl>
    <details className={styles.detailDisclosure}>
      <summary>Fee calculation and verification</summary>
    <p>The platform fee is separate from creator and LP fees. It uses the gross native ETH side of each swap once, rounded up to whole wei.</p>
    <p>After launch, platform fees accrue as native ETH claims. Anyone can trigger collection to the fixed treasury. They are not transferred to the treasury immediately on each trade.</p>
    <p>These fee settings are bound to the server verified code. The child vault runtime still requires verification after deployment; this is not a safety audit.</p>
    </details>
  </section>;
}

export function DeveloperRobinhoodInitialBuyPreview({ resource }: Readonly<{ resource: unknown }>) {
  const buy = parseRobinhoodInitialBuyReviewV1(resource);
  if (!buy) return <div className={styles.metadataUnavailable} role="status">
    <strong>Bound initial buy verification unavailable</strong>
    <p>The server must verify the initial buy and its $1 ETH reference before this launch can open a wallet transaction.</p>
  </div>;
  const rate = BigInt(buy.quoteAnswer);
  const usdRate = `${rate / 100000000n}.${(rate % 100000000n).toString().padStart(8, "0")}`;
  return <section className={styles.routerReview} aria-label="Robinhood initial buy">
    <div className={styles.stepHeading}><strong>Robinhood initial buy</strong></div>
    <dl className={styles.reviewGrid}>
      <div><dt>Initial buy, including swap fees</dt><dd>{formatRobinhoodWeiV1(buy.initialBuyWei)}</dd></div>
      <div><dt>$1 minimum at authorization</dt><dd>{formatRobinhoodWeiV1(buy.minimumInitialBuyWei)}</dd></div>
      <div><dt>ETH / USD reference</dt><dd>${usdRate} per ETH</dd></div>
      <div><dt>Reference observed</dt><dd><time dateTime={buy.referenceObservedAt}>{buy.referenceObservedAt}</time></dd></div>
      <div><dt>Buyer and token recipient</dt><dd><code>{buy.buyer}</code></dd></div>
      <div><dt>Minimum token output</dt><dd>{buy.minimumTokensOut} raw token units</dd></div>
    </dl>
    <details className={styles.detailDisclosure}>
      <summary>Initial buy conditions</summary>
    <p>The launch includes this buy in the same transaction. It must spend the full initial buy amount and return at least the minimum token output, or the transaction reverts.</p>
    <p>The $1 minimum uses a verified Ethereum ETH / USD reference at permit authorization. The launch runs on Robinhood; the reference does not guarantee a future dollar value. The initial buy is already included in the launch transaction value. Gas is additional.</p>
    </details>
  </section>;
}

export function DeveloperRobinhoodFundingPreview({ resource, cost, now }: Readonly<{
  resource: unknown;
  cost?: RobinhoodLaunchCostV1;
  now?: number;
}>) {
  const funding = parseRobinhoodFundingReviewV1(resource);
  if (!funding) return (
    <div className={styles.metadataUnavailable} role="status">
      <strong>Robinhood funding details unavailable</strong>
      <p>Load the exact launch review. Missing or inconsistent funding details must be corrected by your agent before sending.</p>
    </div>
  );
  const currentCost = robinhoodCostMatchesReviewV1(cost, funding, now ?? Number.NaN) ? cost : undefined;
  const plan = funding.fundingPlan;
  const planLabels = plan ? robinhoodFundingPlanLabelsV1(plan) : null;
  return (
    <section className={styles.routerReview} aria-label="Robinhood launch funding">
      <div className={styles.stepHeading}><strong>Robinhood launch funding</strong></div>
      <dl className={styles.reviewGrid}>
        <div><dt>Launch transaction value</dt><dd>{formatRobinhoodWeiV1(funding.valueWei)}</dd></div>
        <div><dt>Estimated network cost</dt><dd>{currentCost
          ? formatRobinhoodWeiV1(currentCost.estimatedNetworkFeeWei) : "Estimate required"}</dd></div>
        <div><dt>Value plus current estimate</dt><dd>{currentCost
          ? formatRobinhoodWeiV1(currentCost.estimatedTotalWei) : "Not estimated"}</dd></div>
        <div><dt>Available ETH on Robinhood</dt><dd>{currentCost
          ? formatRobinhoodWeiV1(currentCost.balanceWei) : "Balance check required"}</dd></div>
      </dl>
      {plan ? <dl className={styles.reviewGrid}>
        <div><dt>Maximum launch value</dt><dd>{formatRobinhoodWeiV1(plan.maxLaunchValueWei)}</dd></div>
        <div><dt>Gas budget</dt><dd>{formatRobinhoodWeiV1(plan.maxGasCostWei)}</dd></div>
        <div><dt>Launch mode</dt><dd>{plan.launchMode === "build-only" ? "Build only" : "Fund and launch"}</dd></div>
      </dl> : null}
      <details className={styles.detailDisclosure}>
        <summary>Funding plan details</summary>
        <dl className={styles.reviewGrid}>
        {plan && planLabels ? <>
          <div><dt>Declared capital source</dt><dd>{planLabels.capitalSource}</dd></div>
          <div><dt>Declared pricing model</dt><dd>{planLabels.pricingModel}</dd></div>
          <div><dt>Initial liquidity allocation</dt><dd>{formatRobinhoodWeiV1(plan.nativeAllocations.initialLiquidityWei)}</dd></div>
          <div><dt>Initial buy allocation</dt><dd>{formatRobinhoodWeiV1(plan.nativeAllocations.initialBuyWei)}</dd></div>
          <div><dt>Native reserve allocation</dt><dd>{formatRobinhoodWeiV1(plan.nativeAllocations.reserveWei)}</dd></div>
          <div><dt>Other launch value</dt><dd>{formatRobinhoodWeiV1(plan.nativeAllocations.otherLaunchValueWei)}</dd></div>
        </> : null}
        <div><dt>Declared liquidity model</dt><dd>{funding.modelLabel}</dd></div>
        <div><dt>Declared starting state</dt><dd>{funding.stateLabel}</dd></div>
        </dl>
      <p>
        Transaction value already includes any native deposit or first buy in this launch.
        Gas is additional, even when transaction value is zero. The declared model does
        not prove that an empty pool can trade or that buyer funding is available.
      </p>
      {plan ? (
        <p>The financing plan and budgets are bound to this request. Allocation labels do not prove reserves, inventory or solvency. Changing a budget requires your agent to repack the launch.</p>
      ) : <p>Capital source and gas budget must be agreed with your agent. This request version records the declared model and exact transaction value; it does not record a separate financing plan.</p>}
      </details>
      {plan?.launchMode === "build-only" ? <p className={styles.failure} role="alert">This plan is build only. Confirm a funded launch plan with your agent and repack before sending.</p> : null}
      {currentCost ? (
        <>
          <p>Estimated at <time dateTime={currentCost.observedAt}>{currentCost.observedAt.slice(11, 19)} UTC</time>. Network costs can change. The wallet shows the final fee before you approve.</p>
          {robinhoodGasBudgetExceededV1(currentCost, funding) ? <p className={styles.failure} role="alert">The current network estimate exceeds your bound gas budget. Wait for costs to fall, or confirm a new budget with your agent and repack. No transaction can be requested with this estimate.</p> : null}
          {currentCost.shortfallWei !== "0" ? (
            <p className={styles.failure} role="alert">You need approximately {formatRobinhoodWeiV1(currentCost.shortfallWei)} more on Robinhood Chain for this transaction and its current network estimate. Update the funding, then estimate again.</p>
          ) : !robinhoodGasBudgetExceededV1(currentCost, funding) && plan?.launchMode !== "build-only"
            ? <p>Review these costs, then choose Send transaction. Costs and balance are checked again before the wallet opens.</p> : null}
        </>
      ) : <p>Estimate the exact transaction before sending. Estimates do not request a signature or send a transaction.</p>}
    </section>
  );
}

function ProjectMetadataReview({
  launch,
  binding,
}: Readonly<{
  launch: LaunchResource;
  binding: WalletProjectMetadataBindingV1;
}>) {
  const { projectMetadata, projectMetadataHash } = binding;
  const { token, presentation } = projectMetadata;
  const initials = [...token.symbol].slice(0, 2).join("").toUpperCase();
  const imagePreview = useVerifiedProjectImageV1(presentation.image);
  const linkLabels = projectMetadataLinkDisplayLabels(presentation.links);
  const requirements = walletProjectMetadataRequirementsV1(projectMetadata);
  const completeForProfile = !requiresCurrentProjectMetadata(launch)
    || requirements.complete;
  const website = presentation.links.find((link) => link.kind === "website");
  const xLink = presentation.links.find((link) => link.kind === "x");
  const chain = launch.routeId === "custom-launch:create:v4"
    ? { name: "Robinhood Chain", id: "4663" }
    : { name: "Ethereum Mainnet", id: "1" };
  const resourceIdentity = launchResourceIdentity(launch);
  return (
    <section
      className={styles.projectReview}
      aria-labelledby={`project-metadata-${resourceIdentity}`}
    >
      <div className={styles.projectReviewHeading}>
        <div className={styles.projectArtwork}>
          {imagePreview.state === "verified" && imagePreview.objectUrl ? (
            <NextImage
              alt={`${token.name} artwork`}
              height={72}
              referrerPolicy="no-referrer"
              src={imagePreview.objectUrl}
              unoptimized
              width={72}
            />
          ) : (
            <span aria-hidden="true">{initials}</span>
          )}
        </div>
        <div className={styles.projectIdentity}>
          <span>Included in this launch</span>
          <h4 id={`project-metadata-${resourceIdentity}`}>{token.name}</h4>
          <strong>${token.symbol}</strong>
        </div>
      </div>
      <p className={styles.projectNetwork}>{chain.name} · {chain.id}</p>
      {presentation.description ? (
        <div className={styles.projectDescription}>
          <strong>Bio</strong>
          <p>{presentation.description}</p>
        </div>
      ) : requiresCurrentProjectMetadata(launch) ? (
        <p className={styles.projectMissing} role="alert">
          Ask your agent to add a bio, then repack and submit a new request.
        </p>
      ) : null}
      {presentation.image && imagePreview.state !== "verified" ? (
        <p className={styles.projectAssetNote} role="status">
          {imagePreview.state === "verifying"
            ? "Verifying the bound image bytes before preview."
            : imagePreview.state === "verified-gif"
              ? "The bound GIF bytes and dimensions are verified. Animated previews are not shown in wallet review."
              : "Image preview unavailable. Wallet review continues with the bound image reference."}
        </p>
      ) : null}
      {presentation.links.length > 0 ? (
        <nav className={styles.projectLinks} aria-label={`${token.name} links`}>
          {presentation.links.map((link, index) => (
            <a
              href={link.uri}
              key={`${link.kind}:${link.uri}`}
              rel="noreferrer"
              target="_blank"
            >
              {linkLabels[index]}
              <span className={styles.visuallyHidden}>, opens in a new tab</span>
            </a>
          ))}
        </nav>
      ) : null}
      <details className={styles.detailDisclosure} open={!completeForProfile}>
        <summary>Launch details</summary>
      <div className={styles.projectRequirementHeading}>
        <h5>
          {requiresCurrentProjectMetadata(launch)
            ? "Required launch details"
            : "Bound legacy launch details"}
        </h5>
        <span data-complete={completeForProfile ? "true" : "false"}>
          {completeForProfile ? "Bound" : "Action required"}
        </span>
      </div>
      <dl className={styles.projectRequirements}>
        <div className={styles.projectChain}>
          <dt>Chain</dt>
          <dd>{chain.name} · {chain.id}</dd>
        </div>
        <div data-complete={requirements.name ? "true" : "false"}>
          <dt>Name</dt>
          <dd>{requirements.name ? token.name : "Missing"}</dd>
        </div>
        <div data-complete={requirements.symbol ? "true" : "false"}>
          <dt>Ticker</dt>
          <dd>{requirements.symbol ? `$${token.symbol}` : "Missing"}</dd>
        </div>
        <div data-complete={requirements.description ? "true" : "false"}>
          <dt>Bio</dt>
          <dd>{requirements.description ? "Included below" : "Missing"}</dd>
        </div>
        <div data-complete={requirements.image ? "true" : "false"}>
          <dt>Profile image</dt>
          <dd>{requirements.image ? "Digest bound" : "Missing"}</dd>
        </div>
        <div data-complete={requirements.website ? "true" : "false"}>
          <dt>Website</dt>
          <dd>
            {website ? (
              <a href={website.uri} rel="noreferrer" target="_blank">
                {website.uri}
                <span className={styles.visuallyHidden}>, opens in a new tab</span>
              </a>
            ) : "Missing"}
          </dd>
        </div>
        <div data-complete={requirements.x ? "true" : "false"}>
          <dt>X</dt>
          <dd>
            {xLink ? (
              <a href={xLink.uri} rel="noreferrer" target="_blank">
                {xLink.uri}
                <span className={styles.visuallyHidden}>, opens in a new tab</span>
              </a>
            ) : "Missing"}
          </dd>
        </div>
      </dl>
      </details>
      <details className={styles.detailDisclosure}>
        <summary>Verification details</summary>
        {!presentation.links.some((link) => link.kind === "telegram")
          || !presentation.links.some((link) => link.kind === "discord") ? (
          <p>
            {!presentation.links.some((link) => link.kind === "telegram")
              ? "Telegram: not supplied. " : ""}
            {!presentation.links.some((link) => link.kind === "discord")
              ? "Discord: not supplied." : ""}
          </p>
        ) : null}
        {presentation.image ? (
          <dl className={styles.projectBinding}>
            <div><dt>Image reference</dt><dd><code>{presentation.image.uri}</code></dd></div>
            <div><dt>Image digest</dt><dd><code>{presentation.image.contentSha256}</code></dd></div>
          </dl>
        ) : null}
      <dl className={styles.projectBinding}>
        <div>
          <dt>Metadata digest</dt>
          <dd><code>{projectMetadataHash}</code></dd>
        </div>
        <div>
          <dt>Identity check</dt>
          <dd>
            Declared identity is bound now. Onchain ERC-20 name and symbol
            readback is required after deployment.
          </dd>
        </div>
      </dl>
      {completeForProfile ? (
        <p className={styles.projectBoundary}>
          Review this immutable summary before either wallet step. Changing any
          bound field requires a newly packed request. Ask your agent to make
          changes; this preview is read only.
        </p>
      ) : (
        <p className={styles.projectBoundary}>
          Ask your agent to collect the missing launch details, then repack and
          submit a new request before opening your wallet. This preview is read only.
        </p>
      )}
      </details>
    </section>
  );
}

function LaunchTruthLedger({ launch }: Readonly<{ launch: LaunchResource }>) {
  const rows = customLaunchTruthRowsV1({
    status: launch.status,
    sourceVerification: launch.sourceVerification,
    liquidityIntent: launch.liquidityIntent,
  });
  const resourceIdentity = launchResourceIdentity(launch);
  return (
    <section className={styles.truthLedger} aria-labelledby={`truth-${resourceIdentity}`}>
      <div className={styles.truthHeading}>
        <h4 id={`truth-${resourceIdentity}`}>What this record proves</h4>
        <span>Independent states</span>
      </div>
      <dl className={styles.truthGrid}>
        {rows.map((row) => (
          <div key={row.id} data-tone={row.tone}>
            <dt>{row.label}</dt>
            <dd>
              <strong>{row.value}</strong>
              <span>{row.detail}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function AdmissionWarnings({ codes }: Readonly<{ codes: readonly string[] }>) {
  if (codes.length === 0) return null;
  return (
    <div className={styles.warningLedger}>
      <strong>Admission passed with visible warnings</strong>
      <p>
        These findings did not block this request. They are not a safety,
        fee-behavior, liquidity or trading guarantee.
      </p>
      <ul>
        {codes.map((code) => <li key={code}><code>{code}</code></li>)}
      </ul>
    </div>
  );
}

function RemediationDetails({
  copyState,
  onCopy,
  remediations,
}: Readonly<{
  copyState: "copied" | "error" | undefined;
  onCopy: () => void;
  remediations: readonly CustomLaunchRemediationV1[];
}>) {
  if (remediations.length === 0) return null;
  return (
    <div className={styles.remediationDetails}>
      <div className={styles.remediationHeading}>
        <div>
          <strong>Exact changes</strong>
          <span>{remediations.length} machine-readable {remediations.length === 1 ? "fix" : "fixes"}</span>
        </div>
        <button className={styles.copyFixButton} type="button" onClick={onCopy}>
          <Check aria-hidden="true" size={16} className={styles.copyIcon} data-copied={copyState === "copied"} />
          Copy fix for agent
        </button>
      </div>
      <span className={styles.visuallyHidden} role="status">{copyState === "copied" ? "Fix copied" : ""}</span>
      {copyState === "error" ? (
        <p className={styles.failure} role="alert">
          Fix instructions could not be copied. Try again.
        </p>
      ) : null}
      <ol className={styles.remediationList}>
        {remediations.map((remediation) => (
          <li key={[
            remediation.remediationId,
            remediation.code,
            remediation.targetId,
            remediation.sourcePath,
          ].join(":")}>
            <div className={styles.remediationCode}>
              <code>{remediation.code}</code>
              <span>{remediation.stage}</span>
            </div>
            <dl>
              <div>
                <dt>Target</dt>
                <dd>{remediation.targetId ?? "Not specified"}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{remediation.targetRole ?? "Not specified"}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd><code>{remediation.sourcePath ?? "Not specified"}</code></dd>
              </div>
              <div>
                <dt>Resume at</dt>
                <dd><code>{remediation.resumeAt}</code></dd>
              </div>
            </dl>
            <div className={styles.remediationChange}>
              <p><span>Expected</span>{remediation.expected}</p>
              <p><span>Observed</span>{remediation.observed}</p>
              <p><span>Required change</span>{remediation.requiredChange}</p>
            </div>
            <p className={styles.requestBoundary}>
              {remediation.requiresNewRequest
                ? "Rebuild and submit a new immutable request. Do not sign this one."
                : "Apply the change, then resume at the listed stage."}
            </p>
          </li>
        ))}
      </ol>
      <p className={styles.copySafety}>
        The copied fix contains only request and remediation data. It never
        includes an API key, wallet signature or private key.
      </p>
    </div>
  );
}

export function DeveloperLaunchHistory({
  account,
  initialLaunchId,
  initialLaunchChainId,
  getAccessToken,
  getIdentityToken,
  sendCustomLaunchWalletAction,
  sendCustomLaunchWalletActionV4,
  signCustomLaunchFundingAuthorization,
}: DeveloperLaunchHistoryProps) {
  const [launches, setLaunches] = useState<LaunchResource[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [hydratingId, setHydratingId] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [fundingId, setFundingId] = useState<string | null>(null);
  const [robinhoodCosts, setRobinhoodCosts] = useState<Readonly<Record<string, RobinhoodLaunchCostV1>>>({});
  const [fundingRetryDelayMs, setFundingRetryDelayMs] = useState<number | null>(
    null,
  );
  const [currentTimeMs, setCurrentTimeMs] = useState<number | null>(null);
  const [pendingFundingIds, setPendingFundingIds] = useState<
    Readonly<Record<string, true>>
  >({});
  const [pollingIds, setPollingIds] = useState<
    Readonly<Record<string, true>>
  >({});
  const [submittedHashes, setSubmittedHashes] = useState<
    Readonly<Record<string, `0x${string}`>>
  >({});
  const [hydratedReviews, setHydratedReviews] = useState<
    Readonly<Record<string, LaunchResource>>
  >({});
  const [highlightedLaunchId, setHighlightedLaunchId] = useState<string | null>(
    null,
  );
  const [fixCopyState, setFixCopyState] = useState<
    Readonly<Record<string, "copied" | "error">>
  >({});
  const [launchErrors, setLaunchErrors] = useState<
    Readonly<Record<string, string>>
  >({});
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const requestSequenceRef = useRef(0);
  const refreshControllerRef = useRef<AbortController | null>(null);
  const loadMoreInFlightRef = useRef(false);
  const checkInFlightRef = useRef(false);
  const hydrateInFlightRef = useRef(false);
  const sendInFlightRef = useRef(false);
  const fundingInFlightRef = useRef(false);
  const deepLinkHandledRef = useRef<string | null>(null);
  const exactHandoffLoadedRef = useRef<string | null>(null);
  const pendingFundingRef = useRef(new Map<string, Readonly<{
    authorization: CustomLaunchFundingAuthorizationV3;
    body: CustomLaunchFundingAuthorizationSubmissionV3;
    idempotencyKey: string;
  }>>());
  const pollControllersRef = useRef(new Map<string, AbortController>());

  const clearLaunchError = useCallback((key: string) => {
    setLaunchErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return Object.freeze(next);
    });
  }, []);

  const reportLaunchError = useCallback((
    key: string,
    cause: unknown,
    fallback: string,
  ) => {
    const message = cause instanceof Error ? cause.message : fallback;
    setLaunchErrors((current) => current[key] === message
      ? current
      : Object.freeze({ ...current, [key]: message }));
  }, []);

  const rememberPendingFunding = useCallback((
    key: string,
    pending: Readonly<{
      authorization: CustomLaunchFundingAuthorizationV3;
      body: CustomLaunchFundingAuthorizationSubmissionV3;
      idempotencyKey: string;
    }>,
  ) => {
    pendingFundingRef.current.set(key, pending);
    setPendingFundingIds((current) => current[key]
      ? current
      : Object.freeze({ ...current, [key]: true }));
  }, []);

  const forgetPendingFunding = useCallback((key: string) => {
    if (!pendingFundingRef.current.delete(key)) return;
    setPendingFundingIds((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return Object.freeze(next);
    });
  }, []);

  const getAuthHeaders = useCallback(async () => {
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
    if (identityToken) headers.set("X-Privy-Identity-Token", identityToken);
    return headers;
  }, [getAccessToken, getIdentityToken]);

  const load = useCallback(async (
    cursor: string | null,
    signal?: AbortSignal,
    refreshRequest = false,
  ) => {
    if (cursor !== null && loadMoreInFlightRef.current) return;
    if (cursor !== null) {
      loadMoreInFlightRef.current = true;
      setLoadingMore(true);
    }
    const requestSequence = ++requestSequenceRef.current;
    setError("");
    try {
      const query = new URLSearchParams({
        walletAddress: account,
        limit: String(pageSize),
      });
      if (cursor !== null) query.set("cursor", cursor);
      const response = await fetch(
        `/api/developer/custom-launches?${query.toString()}`,
        {
          cache: "no-store",
          headers: await getAuthHeaders(),
          signal,
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) throw readApiError(response, body);
      const page = parseHistoryPage(body, account);
      if (!page) throw new Error("The API returned an invalid launch history.");
      if (requestSequence !== requestSequenceRef.current) return;
      setLaunches((current) => mergeLaunchResources(
        current,
        page.launches,
        cursor === null,
      ));
      setNextCursor(page.nextCursor);
      setState("ready");
      if (refreshRequest) setStatusMessage("Launch history refreshed.");
    } catch (cause) {
      const refreshTimedOut =
        signal?.aborted
        && signal.reason === launchHistoryRefreshTimeoutReason;
      if (
        cause instanceof DOMException
        && cause.name === "AbortError"
        && !refreshTimedOut
      ) return;
      if (requestSequence !== requestSequenceRef.current) return;
      setError(
        refreshTimedOut
          ? "Launch history refresh took too long. Try again."
          : cause instanceof Error
            ? cause.message
            : "Unable to load launch history.",
      );
      if (refreshTimedOut) {
        setStatusMessage("Launch history refresh timed out.");
      }
      if (
        cursor === null
        && !refreshRequest
        && !exactHandoffLoadedRef.current?.startsWith(`${account}:`)
      ) setState("error");
    } finally {
      if (cursor !== null) loadMoreInFlightRef.current = false;
      if (requestSequence === requestSequenceRef.current) setLoadingMore(false);
      if (refreshRequest) setRefreshing(false);
    }
  }, [account, getAuthHeaders]);

  const readLaunchResource = useCallback(async (
    launch: Pick<LaunchResource, "launchId" | "requestId" | "routeId">,
    signal?: AbortSignal,
  ) => {
    const version = launch.routeId === "custom-launch:create:v4"
      ? "v4"
      : launch.routeId === "custom-launch:create:v3"
      ? "v3"
      : launch.routeId === "custom-launch:create:v2"
        ? "v2"
        : "v1";
    const resourceIdentity = launchResourceIdentity(launch);
    const response = await fetch(
      `/api/developer/custom-launches/${encodeURIComponent(resourceIdentity)}?walletAddress=${encodeURIComponent(account)}&version=${version}`,
      {
        cache: "no-store",
        headers: await getAuthHeaders(),
        signal,
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw readApiError(
        response,
        body,
        "Unable to check launch status.",
      );
    }
    const updated = parseLaunch(body, account);
    if (
      !updated ||
      launchResourceIdentity(updated) !== resourceIdentity ||
      updated.routeId !== launch.routeId
    ) {
      throw new Error("The API returned an invalid launch status.");
    }
    return updated;
  }, [account, getAuthHeaders]);

  const readV4Capabilities = useCallback(async () => {
    const response = await fetch(
      "/api/developer/custom-launches/v4-capabilities",
      {
        cache: "no-store",
        headers: await getAuthHeaders(),
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw readApiError(
        response,
        body,
        "Unable to refresh Robinhood Chain launch capabilities.",
      );
    }
    return body;
  }, [getAuthHeaders]);

  const submitV4SubmissionHint = useCallback(async (
    launch: LaunchResource,
    transactionHash: `0x${string}`,
  ) => {
    const headers = await getAuthHeaders();
    headers.set("Content-Type", "application/json");
    const response = await fetch(
      `/api/developer/custom-launches/${
        encodeURIComponent(launch.launchId)
      }/submission-hint?walletAddress=${
        encodeURIComponent(account)
      }&version=v4`,
      {
        method: "POST",
        cache: "no-store",
        headers,
        body: JSON.stringify({
          schemaVersion: "programmable.custom-launch-submission-hint.v1",
          transactionHash,
        }),
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw readApiError(
        response,
        body,
        "The transaction hash could not be registered for independent discovery.",
      );
    }
    if (response.status !== 202
      || !isRecord(body)
      || body.schemaVersion !== "programmable.custom-launch-submission-hint.v1"
      || body.apiVersion !== "v4"
      || body.launchId !== launch.launchId
      || body.chainId !== "4663"
      || body.chainDeploymentId !== "robinhood-mainnet-custom-launch-v1"
      || body.transactionHash !== transactionHash
      || body.accepted !== true
      || body.authoritative !== false
      || typeof body.acceptedAt !== "string"
      || body.statusPath
        !== `/v4/chains/4663/wallet-admin/custom-launches/${launch.launchId}`) {
      throw new Error("The API returned an invalid transaction discovery receipt.");
    }
    return body;
  }, [account, getAuthHeaders]);

  const updateLaunch = useCallback((updated: LaunchResource) => {
    setLaunches((current) => mergeLaunchResources(current, [updated], false));
  }, []);

  const readLaunchById = useCallback(async (
    launchId: string,
    version: "v3" | "v4",
    signal?: AbortSignal,
  ) => {
    const response = await fetch(
      `/api/developer/custom-launches/${encodeURIComponent(launchId)}?walletAddress=${encodeURIComponent(account)}&version=${version}`,
      {
        cache: "no-store",
        headers: await getAuthHeaders(),
        signal,
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw readApiError(response, body, "Unable to open this wallet handoff.");
    }
    const launch = parseLaunch(body, account);
    if (
      !launch
      || launchResourceIdentity(launch) !== launchId
      || launch.routeId !== `custom-launch:create:${version}`
    ) throw new Error("The API returned an invalid wallet handoff.");
    return launch;
  }, [account, getAuthHeaders]);

  const focusLaunchCard = useCallback((launchId: string) => {
    setHighlightedLaunchId(launchId);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document.getElementById(`custom-launch-${launchId}`)?.focus();
      });
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const initialRead = window.setTimeout(() => {
      void load(null, controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(initialRead);
      controller.abort();
    };
  }, [load]);

  useEffect(() => {
    const updateClock = () => setCurrentTimeMs(Date.now());
    const initialUpdate = window.setTimeout(updateClock, 0);
    const interval = window.setInterval(updateClock, 15_000);
    return () => {
      window.clearTimeout(initialUpdate);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!initialLaunchId || !requestIdPattern.test(initialLaunchId)) return;
    const version = initialLaunchChainId === "4663" ? "v4" : "v3";
    const deepLinkKey = `${account}:${version}:${initialLaunchId}`;
    if (deepLinkHandledRef.current === deepLinkKey) return;
    deepLinkHandledRef.current = deepLinkKey;
    exactHandoffLoadedRef.current = null;
    const controller = new AbortController();
    hydrateInFlightRef.current = true;
    setHydratingId(`custom-launch:create:${version}:${initialLaunchId}`);
    setError("");
    setStatusMessage("Loading the exact wallet handoff.");
    void readLaunchById(initialLaunchId, version, controller.signal)
      .then((launch) => {
        const key = launchResourceKey(launch);
        updateLaunch(launch);
        setHydratedReviews((current) => Object.freeze({
          ...current,
          [key]: launch,
        }));
        exactHandoffLoadedRef.current = deepLinkKey;
        setState("ready");
        setStatusMessage(
          [
            "awaiting_funding_authorization", "authorized",
            "wallet_action_required", "awaiting_wallet_signature",
          ]
            .includes(launch.status)
            ? "Wallet handoff loaded. Review every field before opening your wallet."
            : "Launch loaded. Its current status does not request a wallet action.",
        );
        focusLaunchCard(launchResourceIdentity(launch));
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to open this wallet handoff.",
        );
      })
      .finally(() => {
        if (deepLinkHandledRef.current !== deepLinkKey) return;
        hydrateInFlightRef.current = false;
        setHydratingId(null);
      });
    return () => controller.abort();
  }, [
    account,
    focusLaunchCard,
    initialLaunchId,
    initialLaunchChainId,
    readLaunchById,
    updateLaunch,
  ]);

  useEffect(() => () => {
    refreshControllerRef.current?.abort();
    refreshControllerRef.current = null;
    for (const controller of pollControllersRef.current.values()) {
      controller.abort();
    }
    pollControllersRef.current.clear();
    pendingFundingRef.current.clear();
  }, []);

  useEffect(() => {
    if (fundingRetryDelayMs === null) return;
    const timeout = window.setTimeout(() => {
      setFundingRetryDelayMs(null);
      setStatusMessage("Funding authorization submission can be retried.");
    }, fundingRetryDelayMs);
    return () => window.clearTimeout(timeout);
  }, [fundingRetryDelayMs]);

  const refresh = () => {
    if (state === "loading" || loadingMore || refreshing) return;
    const controller = new AbortController();
    refreshControllerRef.current?.abort();
    refreshControllerRef.current = controller;
    const timeout = window.setTimeout(
      () => controller.abort(launchHistoryRefreshTimeoutReason),
      launchHistoryRefreshTimeoutMs,
    );
    setRefreshing(true);
    setError("");
    setStatusMessage("Refreshing launch history.");
    void load(null, controller.signal, true).finally(() => {
      window.clearTimeout(timeout);
      if (refreshControllerRef.current === controller) {
        refreshControllerRef.current = null;
      }
    });
  };

  const checkOnchainStatus = async (launch: LaunchResource) => {
    const key = launchResourceKey(launch);
    if (checkInFlightRef.current || pollingIds[key]) return;
    checkInFlightRef.current = true;
    setCheckingId(key);
    clearLaunchError(key);
    setError("");
    try {
      const updated = await readLaunchResource(launch);
      updateLaunch(updated);
      clearLaunchError(key);
      setStatusMessage("Launch status updated.");
    } catch (cause) {
      reportLaunchError(key, cause, "Unable to check launch status.");
    } finally {
      checkInFlightRef.current = false;
      setCheckingId(null);
    }
  };

  const loadLaunchDetails = async (launch: LaunchResource) => {
    const key = launchResourceKey(launch);
    if (hydrateInFlightRef.current || hydratingId !== null) return;
    hydrateInFlightRef.current = true;
    setHydratingId(key);
    clearLaunchError(key);
    setError("");
    setStatusMessage("Loading the exact launch findings and evidence.");
    try {
      const current = await readLaunchResource(launch);
      updateLaunch(current);
      setHydratedReviews((reviews) => Object.freeze({
        ...reviews,
        [key]: current,
      }));
      clearLaunchError(key);
      setStatusMessage(
        current.status === "action_required"
          ? "Exact remediation loaded. Fix every listed item before creating a new request."
          : "Exact launch evidence loaded.",
      );
      focusLaunchCard(launchResourceIdentity(current));
    } catch (cause) {
      reportLaunchError(key, cause, "Unable to load the exact launch details.");
    } finally {
      hydrateInFlightRef.current = false;
      setHydratingId(null);
    }
  };

  const copyAgentFix = async (
    launch: LaunchResource,
    remediations: readonly CustomLaunchRemediationV1[],
  ) => {
    const key = launchResourceKey(launch);
    const fix = buildCustomLaunchAgentFixV1({
      requestId: launch.requestId,
      routeId: launch.routeId,
      remediations,
    });
    if (!fix) return;
    try {
      await copyToClipboard(fix);
      setFixCopyState((current) => Object.freeze({
        ...current,
        [key]: "copied",
      }));
      setStatusMessage(
        "Fix instructions copied without an API key, wallet signature or private key.",
      );
    } catch {
      setFixCopyState((current) => Object.freeze({
        ...current,
        [key]: "error",
      }));
      setStatusMessage("Fix instructions could not be copied.");
    }
  };

  const loadWalletReview = async (launch: LaunchResource) => {
    const key = launchResourceKey(launch);
    const v3Review = launch.routeId === "custom-launch:create:v3"
      && ["awaiting_funding_authorization", "authorized"].includes(launch.status);
    const v4Review = launch.routeId === "custom-launch:create:v4"
      && ["wallet_action_required", "awaiting_wallet_signature"].includes(launch.status);
    if (
      hydrateInFlightRef.current
      || hydratingId !== null
      || (!v3Review && !v4Review)
    ) return;
    hydrateInFlightRef.current = true;
    setHydratingId(key);
    clearLaunchError(key);
    setError("");
    setStatusMessage(
      v4Review
        ? "Loading the exact Robinhood Chain Router transaction for review."
        : launch.status === "awaiting_funding_authorization"
        ? "Loading the exact funding authorization for review."
        : "Loading the exact Router transaction for review.",
    );
    try {
      const current = await readLaunchResource(launch);
      if (
        current.routeId !== launch.routeId
        || current.status !== launch.status
      ) {
        updateLaunch(Object.freeze({ ...current, output: null }));
        setHydratedReviews((reviews) => {
          if (!reviews[key]) return reviews;
          const next = { ...reviews };
          delete next[key];
          return Object.freeze(next);
        });
        throw new Error(
          "This launch changed while its wallet review was loading. Review its current status.",
        );
      }
      if (v4Review) {
        if (current.rawResourceV4 === null
          || current.output === null
          || !isRecord(current.output.walletTransaction)
          || !isRecord(current.output.artifact)) {
          throw new Error(
            "The exact Robinhood Chain wallet artifact is unavailable. No wallet action was opened.",
          );
        }
        updateLaunch(current);
        setHydratedReviews((reviews) => Object.freeze({
          ...reviews,
          [key]: current,
        }));
        clearLaunchError(key);
        setStatusMessage(
          "Robinhood Chain review loaded. Check every field before the separate owner wallet transaction.",
        );
        return;
      }
      const currentProjectBinding = walletProjectRequestBindingV1(current);
      if (!currentProjectBinding) {
        throw new Error(
          "The launch metadata or its request binding is unavailable. No wallet action was opened.",
        );
      }
      const priorProjectBinding = walletProjectRequestBindingV1(launch);
      if (
        priorProjectBinding
        && !sameProjectRequestBindingV1(
          priorProjectBinding,
          currentProjectBinding,
        )
      ) {
        throw new Error(
          "The launch metadata changed while its wallet review was loading. Review the current immutable request; no wallet action was opened.",
        );
      }
      if (current.status === "awaiting_funding_authorization") {
        if (!fundingAuthorizationReview(current)) {
          throw new Error(
            "The funding challenge failed its safety checks. Refresh the launch and try again.",
          );
        }
        setStatusMessage(
          "Funding review loaded. Check every field before the separate wallet signature.",
        );
      } else if (!routerTransactionReview(current)) {
        throw new Error(
          "The Router transaction failed its safety checks. Refresh the launch and try again.",
        );
      } else {
        setStatusMessage(
          "Router review loaded. Check every field before the separate wallet transaction.",
        );
      }
      updateLaunch(current);
      setHydratedReviews((reviews) => Object.freeze({
        ...reviews,
        [key]: current,
      }));
      clearLaunchError(key);
    } catch (cause) {
      reportLaunchError(key, cause, "Unable to load the wallet review.");
    } finally {
      hydrateInFlightRef.current = false;
      setHydratingId(null);
    }
  };

  const startStatusPolling = useCallback((launch: LaunchResource) => {
    const key = launchResourceKey(launch);
    pollControllersRef.current.get(key)?.abort();
    const controller = new AbortController();
    pollControllersRef.current.set(key, controller);
    setPollingIds((current) => Object.freeze({
      ...current,
      [key]: true as const,
    }));

    void (async () => {
      let waitMs = 0;
      while (!controller.signal.aborted) {
        if (waitMs > 0 && !await pollDelay(waitMs, controller.signal)) return;
        try {
          const updated = await readLaunchResource(launch, controller.signal);
          updateLaunch(updated);
          clearLaunchError(key);
          setError("");
          if (terminalStatus(updated.status)) {
            setStatusMessage(
              updated.status === "finalized"
                ? "Launch finalized onchain."
                : "Launch tracking reached a terminal state.",
            );
            return;
          }
          if (updated.routeId === "custom-launch:create:v4") {
            if (![
              "wallet_action_required", "awaiting_wallet_signature", "authorized",
              "submitted", "sequencer_soft_confirmed", "ethereum_posted",
            ].includes(updated.status)) {
              throw new Error(
                "The Robinhood Chain launch returned an unexpected status after wallet broadcast.",
              );
            }
            setStatusMessage(
              updated.status === "ethereum_posted"
                ? "Transaction posted to Ethereum. Waiting for the bound finality policy."
                : updated.status === "sequencer_soft_confirmed"
                  ? "Transaction soft-confirmed by the sequencer. Waiting for Ethereum posting."
                  : updated.status === "submitted"
                    ? "Transaction independently discovered. Waiting for staged finality."
                    : "Transaction hash accepted as a discovery hint. Waiting for independent provider readback.",
            );
            waitMs = updated.status === "wallet_action_required"
              || updated.status === "awaiting_wallet_signature"
              ? authorizedPollIntervalMs
              : submittedPollIntervalMs;
            continue;
          }
          if (updated.status !== "authorized" && updated.status !== "submitted") {
            throw new Error("The launch returned an unexpected status after broadcast.");
          }
          setStatusMessage(
            updated.status === "submitted"
              ? "Transaction found. Waiting for finality."
              : "Transaction submitted. Waiting for the Router record.",
          );
          waitMs = updated.status === "submitted"
            ? submittedPollIntervalMs
            : authorizedPollIntervalMs;
        } catch (cause) {
          if (controller.signal.aborted) return;
          reportLaunchError(
            key,
            cause,
            "Unable to track the submitted transaction.",
          );
          if (cause instanceof LaunchHistoryRequestError) {
            const retryAfterMs = launchPollingRetryAfterMs(
              cause.status,
              cause.retryAfterMs,
            );
            if (retryAfterMs !== null) {
              waitMs = retryAfterMs;
              continue;
            }
          }
          return;
        }
      }
    })().finally(() => {
      if (pollControllersRef.current.get(key) === controller) {
        pollControllersRef.current.delete(key);
        setPollingIds((current) => {
          const next = { ...current };
          delete next[key];
          return Object.freeze(next);
        });
      }
    });
  }, [clearLaunchError, readLaunchResource, reportLaunchError, updateLaunch]);

  const startV3PreparationPolling = useCallback((launch: LaunchResource) => {
    const key = launchResourceKey(launch);
    pollControllersRef.current.get(key)?.abort();
    const controller = new AbortController();
    pollControllersRef.current.set(key, controller);
    setPollingIds((current) => Object.freeze({
      ...current,
      [key]: true as const,
    }));
    void (async () => {
      let waitMs = 0;
      while (!controller.signal.aborted) {
        if (waitMs > 0 && !await pollDelay(waitMs, controller.signal)) return;
        try {
          const updated = await readLaunchResource(launch, controller.signal);
          updateLaunch(updated);
          clearLaunchError(key);
          setError("");
          if (updated.status === "authorized") {
            setStatusMessage(
              "The exact Router transaction is ready for separate wallet review.",
            );
            return;
          }
          if (updated.status === "action_required") {
            setStatusMessage(
              "Source or configuration changes are required before Router simulation. No wallet action is needed.",
            );
            return;
          }
          if (terminalStatus(updated.status)) {
            setStatusMessage("Launch preparation reached a terminal state.");
            return;
          }
          if (
            updated.routeId !== "custom-launch:create:v3"
            || ![
              "awaiting_funding_authorization",
              "funding_authorization_verified",
              "pending_review",
              "prepared",
              "simulating",
            ].includes(updated.status)
          ) {
            throw new Error("The V3 launch returned an unexpected preparation status.");
          }
          setStatusMessage(
            updated.status === "simulating"
              ? "The exact Router transaction is being simulated."
              : updated.status === "pending_review"
                ? "Admission checks are still running before Router simulation."
                : updated.status === "prepared"
                  ? "The exact Router transaction is prepared and waiting for simulation."
                  : updated.status === "awaiting_funding_authorization"
                    ? "Funding authorization acceptance is still being reconciled."
                    : "The funding authorization is verified. Preparing the Router transaction.",
          );
          waitMs = authorizedPollIntervalMs;
        } catch (cause) {
          if (controller.signal.aborted) return;
          reportLaunchError(
            key,
            cause,
            "Unable to prepare the Router transaction.",
          );
          if (cause instanceof LaunchHistoryRequestError) {
            const retryAfterMs = launchPollingRetryAfterMs(
              cause.status,
              cause.retryAfterMs,
            );
            if (retryAfterMs !== null) {
              waitMs = retryAfterMs;
              continue;
            }
          }
          return;
        }
      }
    })().finally(() => {
      if (pollControllersRef.current.get(key) === controller) {
        pollControllersRef.current.delete(key);
        setPollingIds((current) => {
          const next = { ...current };
          delete next[key];
          return Object.freeze(next);
        });
      }
    });
  }, [clearLaunchError, readLaunchResource, reportLaunchError, updateLaunch]);

  const submitFundingAuthorization = async (launch: LaunchResource) => {
    if (
      fundingInFlightRef.current
      || fundingId !== null
      || fundingRetryDelayMs !== null
    ) return;
    const key = launchResourceKey(launch);
    fundingInFlightRef.current = true;
    setFundingId(key);
    clearLaunchError(key);
    setError("");
    try {
      const reviewedProjectBinding = walletProjectRequestBindingV1(launch);
      if (!reviewedProjectBinding) {
        throw new Error(
          "Load and review the bound project metadata before opening the wallet.",
        );
      }
      const reviewedAuthorization = fundingAuthorizationReview(launch);
      if (!reviewedAuthorization) {
        throw new Error(
          "Load and review the exact funding authorization before opening the wallet.",
        );
      }
      const current = await readLaunchResource(launch);
      updateLaunch(current);
      const currentProjectBinding = walletProjectRequestBindingV1(current);
      if (
        !currentProjectBinding
        || !sameProjectRequestBindingV1(
          reviewedProjectBinding,
          currentProjectBinding,
        )
      ) {
        forgetPendingFunding(key);
        throw new Error(
          "The project metadata or request binding changed after review. No wallet signature was requested.",
        );
      }
      if (!sameWalletHandoff(launch, current)) {
        forgetPendingFunding(key);
        throw new Error(
          "The wallet handoff changed after review. Reload its exact fields; no wallet signature was requested.",
        );
      }
      if (
        current.routeId !== "custom-launch:create:v3"
        || current.status !== "awaiting_funding_authorization"
        || !current.fundingIntentHash
      ) {
        forgetPendingFunding(key);
        throw new Error(
          "This launch is no longer awaiting a funding signature. Review its current status.",
        );
      }
      const authorization = prepareCustomLaunchFundingAuthorizationV3(
        current.output,
        account,
        current.launchId,
        current.fundingIntentHash,
      );
      if (!sameFundingAuthorization(reviewedAuthorization, authorization)) {
        forgetPendingFunding(key);
        throw new Error(
          "The funding authorization changed after review. Review the refreshed fields; no wallet signature was requested.",
        );
      }
      if (customLaunchWalletHandoffExpiredV1(current, Date.now())) {
        forgetPendingFunding(key);
        throw new Error(
          "This wallet handoff expired before signing. Reload the launch to request a current handoff.",
        );
      }
      let pending = pendingFundingRef.current.get(key);
      if (
        pending
        && (
          pending.authorization.fundingIntentHash
            !== authorization.fundingIntentHash
          || pending.authorization.typedDataDigest
            !== authorization.typedDataDigest
        )
      ) {
        forgetPendingFunding(key);
        pending = undefined;
      }
      if (!pending) {
        setStatusMessage(
          "Opening the wallet for step 1 of 2: USDC funding authorization.",
        );
        const signature = await signCustomLaunchFundingAuthorization(
          authorization,
        );
        if (customLaunchWalletHandoffExpiredV1(current, Date.now())) {
          throw new Error(
            "This wallet handoff expired while the wallet was open. The signature was not submitted.",
          );
        }
        pending = Object.freeze({
          authorization,
          body: createCustomLaunchFundingSubmissionV3(
            authorization,
            signature,
          ),
          idempotencyKey: crypto.randomUUID(),
        });
        rememberPendingFunding(key, pending);
      } else {
        setStatusMessage("Retrying the verified funding authorization submission.");
      }
      const headers = await getAuthHeaders();
      headers.set("Content-Type", "application/json");
      headers.set("Idempotency-Key", pending.idempotencyKey);
      const response = await fetch(
        `/api/developer/custom-launches/${
          encodeURIComponent(current.requestId)
        }/funding-authorization?walletAddress=${
          encodeURIComponent(account)
        }&version=v3`,
        {
          method: "POST",
          cache: "no-store",
          headers,
          body: JSON.stringify(pending.body),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) throw readApiError(
        response,
        body,
        "Unable to submit the funding authorization.",
      );
      const updated = parseLaunch(body, account);
      if (
        !updated
        || updated.routeId !== "custom-launch:create:v3"
        || updated.requestId !== current.requestId
      ) throw new Error("The API returned an invalid V3 launch status.");
      const updatedProjectBinding = walletProjectRequestBindingV1(updated);
      if (
        !updatedProjectBinding
        || !sameProjectRequestBindingV1(
          currentProjectBinding,
          updatedProjectBinding,
        )
      ) {
        throw new Error(
          "The project metadata binding changed after funding authorization. Stop and review the launch again.",
        );
      }
      forgetPendingFunding(key);
      setFundingRetryDelayMs(null);
      updateLaunch(updated);
      if (updated.status === "authorized") {
        clearLaunchError(key);
        setStatusMessage(
          "Funding verified. Step 2 of 2 is ready for separate Router review.",
        );
      } else if (terminalStatus(updated.status)) {
        setStatusMessage("Funding verification reached a terminal state.");
      } else {
        setStatusMessage(
          "Funding verified. Preparing and simulating the exact Router transaction.",
        );
        startV3PreparationPolling(updated);
      }
    } catch (cause) {
      if (
        cause instanceof LaunchHistoryRequestError
        && cause.retryAfterMs !== null
      ) {
        setFundingRetryDelayMs(cause.retryAfterMs);
      }
      if (
        cause instanceof LaunchHistoryRequestError
        && cause.status >= 400
        && cause.status < 500
        && cause.status !== 429
      ) forgetPendingFunding(key);
      reportLaunchError(
        key,
        cause,
        "The funding authorization could not be submitted.",
      );
    } finally {
      fundingInFlightRef.current = false;
      setFundingId(null);
    }
  };

  const submitWalletTransaction = async (launch: LaunchResource, robinhoodAction: "estimate" | "send" = "send") => {
    if (
      sendInFlightRef.current
      || submittingId !== null
    ) return;
    const key = launchResourceKey(launch);
    sendInFlightRef.current = true;
    setSubmittingId(key);
    clearLaunchError(key);
    setError("");
    try {
      if (launch.routeId === "custom-launch:create:v4") {
        if (launch.rawResourceV4 === null
          || !walletProjectMetadataReadyForReviewV1(launch)
          || !["wallet_action_required", "awaiting_wallet_signature"]
            .includes(launch.status)) {
          throw new Error(
            "Load and review the current Robinhood Chain transaction before opening the wallet.",
          );
        }
        const result = await sendCustomLaunchWalletActionV4({
          action: robinhoodAction,
          reviewedCost: robinhoodCosts[key],
          reviewedResource: launch.rawResourceV4,
          loadFreshCapabilities: readV4Capabilities,
          loadFreshResource: async () => {
            const current = await readLaunchResource(launch);
            updateLaunch(current);
            if (current.rawResourceV4 === null
              || !walletProjectMetadataReadyForReviewV1(current)) {
              throw new Error("The API omitted the exact Robinhood Chain wallet resource or its complete bound launch details.");
            }
            return current.rawResourceV4;
          },
        });
        if (typeof result !== "string") {
          setRobinhoodCosts((costs) => Object.freeze({ ...costs, [key]: result }));
          setStatusMessage(result.shortfallWei === "0"
            ? "Robinhood costs loaded. Review the estimate before choosing Send transaction."
            : "The Robinhood balance does not cover the current launch estimate. Review the funding shortfall.");
          return;
        }
        const transactionHash = result;
        if (!transactionHashPattern.test(transactionHash)) {
          throw new Error("The wallet returned an invalid transaction hash.");
        }
        setSubmittedHashes((currentHashes) => Object.freeze({
          ...currentHashes,
          [key]: transactionHash,
        }));
        clearLaunchError(key);
        setStatusMessage(
          "Transaction submitted from the wallet. Sending its hash for independent backend discovery.",
        );
        await submitV4SubmissionHint(launch, transactionHash);
        setStatusMessage(
          "Transaction hash accepted as a non-authoritative discovery hint. Waiting for independent provider verification.",
        );
        startStatusPolling(launch);
        return;
      }
      const reviewedProjectBinding = launch.routeId
        === "custom-launch:create:v3"
        ? walletProjectRequestBindingV1(launch)
        : null;
      if (
        launch.routeId === "custom-launch:create:v3"
        && !reviewedProjectBinding
      ) {
        throw new Error(
          "Load and review the bound project metadata before opening the wallet.",
        );
      }
      const reviewedRouter = launch.routeId === "custom-launch:create:v3"
        ? routerTransactionReview(launch)
        : null;
      if (launch.routeId === "custom-launch:create:v3" && !reviewedRouter) {
        throw new Error(
          "Load and review the exact Router transaction before opening the wallet.",
        );
      }
      const current = await readLaunchResource(launch);
      updateLaunch(current);
      setHydratedReviews((reviews) => Object.freeze({
        ...reviews,
        [key]: current,
      }));
      if (current.status !== "authorized") {
        throw new Error(
          "This launch is no longer awaiting a wallet signature. Review its current status.",
        );
      }
      if (current.routeId === "custom-launch:create:v3") {
        const currentProjectBinding = walletProjectRequestBindingV1(current);
        if (
          !reviewedProjectBinding
          || !currentProjectBinding
          || !sameProjectRequestBindingV1(
            reviewedProjectBinding,
            currentProjectBinding,
          )
        ) {
          throw new Error(
            "The project metadata or request binding changed after review. No transaction was requested from the wallet.",
          );
        }
      }
      if (!sameWalletHandoff(launch, current)) {
        throw new Error(
          "The wallet handoff changed after review. Reload its exact fields; no transaction was requested.",
        );
      }
      if (customLaunchWalletHandoffExpiredV1(current, Date.now())) {
        throw new Error(
          "This wallet handoff expired before the final wallet boundary. Reload the launch to request a current handoff.",
        );
      }
      let action: CustomLaunchWalletActionV1;
      if (current.routeId === "custom-launch:create:v3") {
        const currentRouter = prepareCustomLaunchRouterReviewV3(
          current.output,
          account,
        );
        if (!reviewedRouter || !sameRouterReview(reviewedRouter, currentRouter)) {
          throw new Error(
            "The Router transaction changed after review. Review the refreshed fields; no transaction was requested from the wallet.",
          );
        }
        action = currentRouter.walletAction;
      } else {
        action = current.routeId === "custom-launch:create:v2"
          ? prepareCustomLaunchWalletActionV2(
              current.output,
              account,
              current.launchProfileHash!,
            )
          : prepareCustomLaunchWalletActionV1(current.output, account);
      }
      const transactionHash = await sendCustomLaunchWalletAction(action);
      if (!transactionHashPattern.test(transactionHash)) {
        throw new Error("The wallet returned an invalid transaction hash.");
      }
      setSubmittedHashes((currentHashes) => Object.freeze({
        ...currentHashes,
        [key]: transactionHash,
      }));
      clearLaunchError(key);
      setStatusMessage(
        "Transaction submitted from the wallet. Tracking its Router status.",
      );
      startStatusPolling(current);
    } catch (cause) {
      if (launch.routeId === "custom-launch:create:v4") {
        setRobinhoodCosts((costs) => {
          const next = { ...costs };
          delete next[key];
          return Object.freeze(next);
        });
      }
      reportLaunchError(
        key,
        cause,
        "The wallet transaction could not be submitted.",
      );
    } finally {
      sendInFlightRef.current = false;
      setSubmittingId(null);
    }
  };

  return (
    <section
      className={styles.history}
      aria-busy={
        state === "loading"
        || loadingMore
        || refreshing
        || hydratingId !== null
        || fundingId !== null
        || submittingId !== null
      }
      aria-labelledby="launch-history-title"
    >
      <p className={styles.visuallyHidden} role="status" aria-live="polite">
        {statusMessage}
      </p>
      <div className={styles.heading}>
        <h2 id="launch-history-title" className={styles.visuallyHidden}>Launch history</h2>
        <p className={styles.visuallyHidden}>Your wallet approves every launch transaction.</p>
        <button
          className={styles.textButton}
          aria-busy={state === "loading" || refreshing}
          disabled={state === "loading" || loadingMore || refreshing}
          type="button"
          onClick={refresh}
        >
          <RefreshCw
            aria-hidden="true"
            className={styles.refreshIcon}
            data-spinning={state === "loading" || refreshing ? "true" : "false"}
            size={16}
            strokeWidth={1.9}
          />
          Refresh history
        </button>
      </div>

      {state === "loading" ? <HistorySkeleton /> : null}

      {state === "error" ? (
        <div className={styles.statePanel} role="alert">
          <h3>Launch history is unavailable</h3>
          <p>{error}</p>
          <p>
            If retrying does not help, share the request ID with support.
            Never share your API key.
          </p>
          <a
            href="https://discord.com/invite/programmable"
            rel="noreferrer"
            target="_blank"
          >
            Open Programmable support
          </a>
          <button className={styles.secondaryButton} type="button" onClick={refresh}>
            Try again
          </button>
        </div>
      ) : null}

      {state === "ready" && launches.length === 0 ? (
        <div className={styles.statePanel}>
          <h3>No launch requests</h3>
          <p>Accepted API requests will appear here.</p>
        </div>
      ) : null}

      {state === "ready" && launches.length > 0 ? (
        <ul className={styles.launchList}>
          {launches.map((launch) => {
            const key = launchResourceKey(launch);
            const resourceIdentity = launchResourceIdentity(launch);
            const reviewLaunch = reviewResourceForLaunch(
              launch,
              hydratedReviews[key],
            );
            const projectMetadataSummary = walletProjectMetadataSummaryV1(
              reviewLaunch,
            );
            const projectMetadataRequirements = projectMetadataSummary
              ? walletProjectMetadataRequirementsV1(
                  projectMetadataSummary.projectMetadata,
                )
              : null;
            const projectMetadataBinding = walletProjectMetadataBindingV1(
              reviewLaunch,
            );
            const projectMetadataReadyForProfile =
              walletProjectMetadataReadyForReviewV1(reviewLaunch);
            const projectRequestBinding = walletProjectRequestBindingV1(
              reviewLaunch,
            );
            const robinhoodFunding = parseRobinhoodFundingReviewV1(reviewLaunch.rawResourceV4);
            const currentRobinhoodCost = robinhoodFunding?.account.toLowerCase() === account.toLowerCase()
              && robinhoodCostMatchesReviewV1(robinhoodCosts[key], robinhoodFunding,
                currentTimeMs ?? Number.NaN) ? robinhoodCosts[key] : undefined;
            const robinhoodSendReady = currentRobinhoodCost?.shortfallWei === "0"
              && robinhoodFunding !== null && robinhoodFunding.fundingPlan?.launchMode !== "build-only"
              && !robinhoodGasBudgetExceededV1(currentRobinhoodCost, robinhoodFunding);
            const fundingReview = fundingAuthorizationReview(reviewLaunch);
            const routerReview = routerTransactionReview(reviewLaunch);
            const transaction = reviewLaunch.routeId
              === "custom-launch:create:v3"
              ? routerReview?.walletAction ?? null
              : walletTransaction(reviewLaunch);
            const transactionHash = onchainTransactionHash(reviewLaunch)
              ?? submittedHashes[key]
              ?? null;
            const remediations = customLaunchRemediationsV1(
              reviewLaunch.output,
              reviewLaunch.failure,
            );
            const warningFindingCodes = customLaunchWarningFindingCodesV1(
              reviewLaunch.output,
            );
            const showTruthLedger = reviewLaunch.routeId
              === "custom-launch:create:v3"
              && ["authorized", "submitted", "finalized"]
                .includes(reviewLaunch.status);
            const expiryCopy = handoffExpiryCopy(reviewLaunch);
            const handoffExpired = reviewLaunch.secondsRemaining === 0
              || customLaunchWalletHandoffExpiredV1(
                reviewLaunch,
                currentTimeMs ?? Number.NaN,
              );
            return (
              <li
                id={`custom-launch-${resourceIdentity}`}
                className={styles.launchItem}
                data-highlighted={
                  highlightedLaunchId === resourceIdentity ? "true" : "false"
                }
                key={key}
                tabIndex={-1}
              >
                <div className={styles.launchTopline}>
                  <div>
                    <h3>{projectMetadataSummary?.projectMetadata.token.name ?? `Launch ${shortId(resourceIdentity)}`}</h3>
                  </div>
                  <span className={styles.status} data-status={launch.status}>
                    {statusCopy(launch.status)}
                  </span>
                </div>
                <details
                  className={styles.launchReview}
                  open={highlightedLaunchId === resourceIdentity}
                >
                  <summary>Review launch</summary>
                <p className={styles.statusDescription}>
                  {statusDescription(launch.status)}
                </p>
                <details className={styles.detailDisclosure}>
                  <summary>Request details</summary>
                <dl className={styles.metadata}>
                  <div>
                    <dt>Created</dt>
                    <dd>{formatDate(launch.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{formatDate(launch.updatedAt)}</dd>
                  </div>
                  {launch.onchainLaunchId ? (
                    <div>
                      <dt>Onchain launch ID</dt>
                      <dd>
                        <code title={launch.onchainLaunchId}>
                          {shortId(launch.onchainLaunchId)}
                        </code>
                      </dd>
                    </div>
                  ) : null}
                  {reviewLaunch.walletHandoffUrl ? (
                    <div>
                      <dt>Wallet handoff</dt>
                      <dd>
                        <a href={reviewLaunch.walletHandoffUrl}>
                          Open this launch
                        </a>
                      </dd>
                    </div>
                  ) : null}
                </dl>
                </details>
                <DeveloperLaunchMetadataPreview launch={reviewLaunch} />
                {projectMetadataSummary
                  && projectMetadataRequirements
                  && requiresCurrentProjectMetadata(reviewLaunch)
                  && !projectMetadataRequirements.complete ? (
                    <div className={styles.metadataUnavailable} role="alert">
                      <strong>Required launch details are missing</strong>
                      <p>
                        Ask your agent to include the name, ticker, bio, profile
                        image, website and X, then repack and submit a new
                        request. These details must be bound before signing.
                      </p>
                    </div>
                  ) : null}
                {projectMetadataSummary
                  && projectMetadataReadyForProfile
                  && !projectMetadataBinding
                  && ["awaiting_funding_authorization", "authorized"]
                    .includes(reviewLaunch.status) ? (
                    <div className={styles.metadataUnavailable} role="status">
                      <strong>Load the exact wallet review</strong>
                      <p>
                        The project identity and digest are valid. Load the
                        current single-resource artifact before a funding
                        signature or Router transaction can open.
                      </p>
                    </div>
                  ) : null}
                {reviewLaunch.routeId === "custom-launch:create:v4" ? (
                  <DeveloperRobinhoodFundingPreview resource={reviewLaunch.rawResourceV4}
                    cost={currentRobinhoodCost} now={currentTimeMs ?? Number.NaN} />
                ) : null}
                {reviewLaunch.routeId === "custom-launch:create:v4"
                  && isRecord(reviewLaunch.rawResourceV4?.profile)
                  && reviewLaunch.rawResourceV4.profile.profileVersion === "4.1.0" ? (
                    <>
                      <DeveloperRobinhoodFeePreview resource={reviewLaunch.rawResourceV4} />
                      <DeveloperRobinhoodInitialBuyPreview resource={reviewLaunch.rawResourceV4} />
                    </>
                  ) : null}
                <AdmissionWarnings codes={warningFindingCodes} />
                {reviewLaunch.failure
                  && reviewLaunch.status !== "action_required" ? (
                  <p className={styles.failure}>
                    {reviewLaunch.failure.message}
                  </p>
                ) : null}
                {reviewLaunch.status === "action_required" ? (
                  <div className={styles.admissionNotice} role="status">
                    <strong>Fix source or configuration</strong>
                    <p>
                      Ask your builder to apply the fixes below, then rebuild,
                      repack and submit a new immutable request. Do not sign this
                      request.
                    </p>
                    {remediations.length === 0 ? (
                      <button
                        className={styles.loadDetailsButton}
                        aria-busy={hydratingId === key}
                        disabled={hydratingId !== null}
                        type="button"
                        onClick={() => void loadLaunchDetails(launch)}
                      >
                        View exact fixes
                      </button>
                    ) : null}
                    <RemediationDetails
                      copyState={fixCopyState[key]}
                      remediations={remediations}
                      onCopy={() => void copyAgentFix(
                        reviewLaunch,
                        remediations,
                      )}
                    />
                    <details className={styles.detailDisclosure}>
                      <summary>Review details</summary>
                      <p>Automatic admission found a blocking source or target-role condition. This result is not an audit or safety verdict, and no manual or project allowlist can bypass it.</p>
                    <a
                      href={PROGRAMMABLE_AGENT_SETUP_LINKS_V1.remediation}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Read the remediation catalog
                    </a>
                    </details>
                  </div>
                ) : null}
                {reviewLaunch.status !== "action_required"
                  && remediations.length > 0 ? (
                    <RemediationDetails
                      copyState={fixCopyState[key]}
                      remediations={remediations}
                      onCopy={() => void copyAgentFix(
                        reviewLaunch,
                        remediations,
                      )}
                    />
                  ) : null}
                {fundingReview ? (
                  <div className={styles.fundingReview}>
                    <div className={styles.stepHeading}>
                      <span>Step 1 of 2</span>
                      <strong>USDC funding authorization</strong>
                    </div>
                    <p>
                      This signature lets the predicted initializer receive
                      exactly the amount below. It does not send a transaction
                      and Programmable does not sign automatically.
                    </p>
                    <dl className={styles.reviewGrid}>
                      <div>
                        <dt>Amount</dt>
                        <dd>{formatUsdcAmount(fundingReview.value)}</dd>
                      </div>
                      <div>
                        <dt>Valid until</dt>
                        <dd>{fundingValidityCopy(fundingReview.validBefore)}</dd>
                      </div>
                      <div>
                        <dt>Network</dt>
                        <dd>Ethereum mainnet · chain {fundingReview.chainId}</dd>
                      </div>
                      <div>
                        <dt>Valid after</dt>
                        <dd>{fundingValidityCopy(fundingReview.validAfter)}</dd>
                      </div>
                      <div>
                        <dt>From</dt>
                        <dd><code>{fundingReview.from}</code></dd>
                      </div>
                      <div>
                        <dt>Recipient</dt>
                        <dd><code>{fundingReview.to}</code></dd>
                      </div>
                      <div>
                        <dt>Token</dt>
                        <dd><code>{fundingReview.token}</code></dd>
                      </div>
                      <div>
                        <dt>Authorization nonce</dt>
                        <dd><code>{fundingReview.nonce}</code></dd>
                      </div>
                      <div>
                        <dt>Funding intent</dt>
                        <dd><code>{fundingReview.fundingIntentHash}</code></dd>
                      </div>
                      <div>
                        <dt>Typed-data digest</dt>
                        <dd><code>{fundingReview.typedDataDigest}</code></dd>
                      </div>
                    </dl>
                  </div>
                ) : null}
                {reviewLaunch.routeId === "custom-launch:create:v3"
                  && reviewLaunch.status === "awaiting_funding_authorization"
                  && reviewLaunch.output !== null
                  && !fundingReview ? (
                    <p className={styles.failure} role="alert">
                      The funding challenge failed its safety checks. Refresh
                      this launch before opening the wallet.
                    </p>
                  ) : null}
                {transaction ? (
                  <details className={styles.transaction}>
                    <summary>Prepared transaction</summary>
                    <p>
                      Review these fields before approving the separate wallet
                      request. Programmable never signs automatically.
                    </p>
                    <pre>{JSON.stringify(transaction, null, 2)}</pre>
                  </details>
                ) : null}
                {routerReview ? (
                  <div className={styles.routerReview}>
                    <div className={styles.stepHeading}>
                      <span>
                        {fundingMode(reviewLaunch)
                          === "eip-3009-receive-with-authorization"
                          ? "Step 2 of 2"
                          : "Step 1 of 1"}
                      </span>
                      <strong>Router transaction</strong>
                    </div>
                    <p>
                      This is the irreversible Ethereum Mainnet transaction.
                      Your wallet will show gas and the exact native value before
                      you choose whether to send it. Programmable never signs or
                      broadcasts it automatically.
                    </p>
                    <dl className={styles.reviewGrid}>
                      <div>
                        <dt>Network</dt>
                        <dd>Ethereum mainnet</dd>
                      </div>
                      <div>
                        <dt>Native value</dt>
                        <dd>{routerReview.walletAction.valueWei} wei</dd>
                      </div>
                      <div>
                        <dt>Programmable fee</dt>
                        <dd>
                          {walletPlatformFeeDisclosureV3(
                            reviewLaunch.launchProfileVersion,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Router</dt>
                        <dd><code>{routerReview.walletAction.to}</code></dd>
                      </div>
                      <div>
                        <dt>Function selector</dt>
                        <dd><code>{routerReview.selector}</code></dd>
                      </div>
                      <div>
                        <dt>Graph commitment</dt>
                        <dd><code>{routerReview.graphCommitment}</code></dd>
                      </div>
                      <div>
                        <dt>Permit digest</dt>
                        <dd><code>{routerReview.permitDigest}</code></dd>
                      </div>
                      <div>
                        <dt>Initializer calldata hash</dt>
                        <dd><code>{routerReview.initializerCalldataHash}</code></dd>
                      </div>
                      <div>
                        <dt>Calldata size</dt>
                        <dd>{routerReview.calldataLengthBytes.toLocaleString("en")} bytes</dd>
                      </div>
                    </dl>
                  </div>
                ) : null}
                {reviewLaunch.routeId === "custom-launch:create:v3"
                  && reviewLaunch.status === "authorized"
                  && reviewLaunch.output !== null
                  && !routerReview ? (
                    <p className={styles.failure} role="alert">
                      The Router transaction failed its safety checks. Refresh
                      this launch before opening the wallet.
                    </p>
                  ) : null}
                {transactionHash ? (
                  <div className={styles.transactionHash}>
                    <span>Transaction hash</span>
                    <code>{transactionHash}</code>
                  </div>
                ) : null}
                {expiryCopy && [
                  "awaiting_funding_authorization",
                  "authorized",
                  "wallet_action_required",
                  "awaiting_wallet_signature",
                ].includes(reviewLaunch.status) ? (
                  <div
                    className={styles.handoffExpiry}
                    data-expired={handoffExpired ? "true" : "false"}
                    role={handoffExpired ? "alert" : "status"}
                  >
                    <strong>
                      {handoffExpired
                        ? "Wallet handoff expired"
                        : "Wallet handoff expires"}
                    </strong>
                    <span>{expiryCopy}</span>
                    <p>
                      The final wallet boundary always reloads the current
                      resource. An expired handoff never opens a stale signature
                      or transaction request.
                    </p>
                  </div>
                ) : null}
                {showTruthLedger ? (
                  <LaunchTruthLedger launch={reviewLaunch} />
                ) : null}
                {launchErrors[key] ? (
                  <p className={styles.inlineError} role="alert">
                    {launchErrors[key]}
                  </p>
                ) : null}
                {[
                  "awaiting_funding_authorization",
                  "funding_authorization_verified",
                  "simulating",
                  "authorized",
                  "wallet_action_required",
                  "awaiting_wallet_signature",
                  "submitted",
                  "sequencer_soft_confirmed",
                  "ethereum_posted",
                ].includes(launch.status) ? (
                  <div className={styles.launchActions}>
                    {["wallet_action_required", "awaiting_wallet_signature"]
                      .includes(launch.status)
                      && launch.routeId === "custom-launch:create:v4" ? (
                        reviewLaunch.rawResourceV4 !== null
                          && walletTransaction(reviewLaunch) !== null ? (
                            <button
                              className={styles.walletButton}
                            aria-busy={submittingId === key || hydratingId === key || fundingId === key}
                              disabled={
                                submittingId !== null
                                || hydratingId !== null
                                || checkingId !== null
                                || Boolean(pollingIds[key])
                                || handoffExpired
                                || !projectMetadataReadyForProfile
                                || robinhoodFunding === null
                                || robinhoodFunding.fundingPlan?.launchMode === "build-only"
                              }
                              type="button"
                              onClick={() => void submitWalletTransaction(reviewLaunch, robinhoodSendReady ? "send" : "estimate")}
                            >
                              {robinhoodSendReady ? "Send transaction" : "Estimate launch cost"}
                            </button>
                          ) : (
                            <button
                              className={styles.walletButton}
                            aria-busy={submittingId === key || hydratingId === key || fundingId === key}
                              disabled={hydratingId !== null || submittingId !== null}
                              type="button"
                              onClick={() => void loadWalletReview(launch)}
                            >
                              Load exact wallet review
                            </button>
                          )
                      ) : null}
                    {launch.status === "awaiting_funding_authorization"
                      && launch.routeId === "custom-launch:create:v3" ? (
                        fundingReview && projectRequestBinding ? (
                          <button
                            className={styles.walletButton}
                            aria-busy={submittingId === key || hydratingId === key || fundingId === key}
                            disabled={
                              fundingId !== null
                              || hydratingId !== null
                              || submittingId !== null
                              || checkingId !== null
                              || Boolean(pollingIds[key])
                              || fundingRetryDelayMs !== null
                              || handoffExpired
                            }
                            type="button"
                            onClick={() => void submitFundingAuthorization(
                              reviewLaunch,
                            )}
                          >
                            {pendingFundingIds[key]
                              ? "Retry funding submission"
                              : "Review and sign USDC authorization"}
                          </button>
                        ) : (
                          projectMetadataReadyForProfile
                        ) || projectRequestBinding?.mode
                          === "legacy-exact-retry" ? (
                          <button
                            className={styles.walletButton}
                            aria-busy={submittingId === key || hydratingId === key || fundingId === key}
                            disabled={
                              hydratingId !== null
                              || fundingId !== null
                              || handoffExpired
                              || submittingId !== null
                              || checkingId !== null
                              || Boolean(pollingIds[key])
                            }
                            type="button"
                            onClick={() => void loadWalletReview(launch)}
                          >
                            {reviewLaunch.output === null
                              ? "Load funding review"
                              : "Reload funding review"}
                          </button>
                        ) : null
                      ) : null}
                    {launch.status === "authorized"
                      && launch.routeId !== "custom-launch:create:v4" ? (
                      launch.routeId !== "custom-launch:create:v3"
                        || (routerReview && projectRequestBinding) ? (
                          <button
                            className={styles.walletButton}
                            aria-busy={submittingId === key || hydratingId === key || fundingId === key}
                            disabled={
                              submittingId !== null
                              || hydratingId !== null
                              || Boolean(pollingIds[key])
                              || checkingId !== null
                              || fundingId !== null
                              || handoffExpired
                            }
                            type="button"
                            onClick={() => void submitWalletTransaction(
                              launch.routeId === "custom-launch:create:v3"
                                ? reviewLaunch
                                : launch,
                            )}
                          >
                            Review and send launch transaction
                          </button>
                        ) : (
                          projectMetadataReadyForProfile
                        ) || projectRequestBinding?.mode
                          === "legacy-exact-retry" ? (
                          <button
                            className={styles.walletButton}
                            aria-busy={submittingId === key || hydratingId === key || fundingId === key}
                            disabled={
                              hydratingId !== null
                              || submittingId !== null
                              || checkingId !== null
                              || fundingId !== null
                              || Boolean(pollingIds[key])
                            }
                            type="button"
                            onClick={() => void loadWalletReview(launch)}
                          >
                            {reviewLaunch.output === null
                              ? "Load Router review"
                              : "Reload Router review"}
                          </button>
                        ) : null
                    ) : null}
                    <button
                      className={styles.checkButton}
                      aria-busy={checkingId === key || Boolean(pollingIds[key])}
                      disabled={
                        checkingId !== null
                          || submittingId !== null
                          || fundingId !== null
                          || hydratingId !== null
                          || Boolean(pollingIds[key])
                      }
                      type="button"
                      onClick={() => void checkOnchainStatus(launch)}
                    >
                      Check onchain status
                    </button>
                  </div>
                ) : null}
                </details>
              </li>
            );
          })}
        </ul>
      ) : null}

      {state === "ready" && nextCursor ? (
        <button
          className={styles.secondaryButton}
          disabled={loadingMore}
          aria-busy={loadingMore}
          type="button"
          onClick={() => void load(nextCursor)}
        >
          Load more
        </button>
      ) : null}
      {state === "ready" && error ? (
        <p className={styles.inlineError} role="alert">{error}</p>
      ) : null}
    </section>
  );
}
