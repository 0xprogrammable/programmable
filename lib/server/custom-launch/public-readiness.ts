import "server-only";

import { createHash } from "node:crypto";

import type { TrustedLaunchPermitSignerV2 } from "@/lib/custom-launch/contract-v2";
import { isReviewAuthorityModeV1 } from "@/lib/custom-launch/review-authority-v1";
import { attestGitHubSessionAuthorityConfigurationV1 } from "./github-session-authority-v1";

const SIGNER_KEYS = [
  "keyId",
  "publicKeyBase64Url",
  "publicKeySpkiSha256",
  "signerComponentBindingHash",
  "signerEpoch",
] as const;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/u;
const POSITIVE_EPOCH = /^[1-9][0-9]{0,19}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function isCustomLaunchPublicEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (environment.PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED !== "true") {
    return false;
  }
  const origin = environment.PROGRAMMABLE_APPROVAL_SERVICE_V2_ORIGIN?.trim();
  if (!origin || !environment.NEXT_PUBLIC_PRIVY_APP_ID?.trim() || !environment.PRIVY_APP_SECRET?.trim()) {
    return false;
  }
  if (
    !DIGEST.test(environment.PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH ?? "")
    || !isReviewAuthorityModeV1(
      environment.PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_REVIEW_AUTHORITY_MODE,
    )
  ) return false;
  if (configuredLaunchPermitSignersV2(environment).length === 0) return false;
  try {
    attestGitHubSessionAuthorityConfigurationV1(environment);
    const url = new URL(origin);
    return url.protocol === "https:"
      && (url.origin === origin || `${url.origin}/` === origin)
      && url.username === ""
      && url.password === ""
      && url.pathname === "/"
      && url.search === ""
      && url.hash === "";
  } catch {
    return false;
  }
}

export function isCustomLaunchRegistryPublicReadEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.PROGRAMMABLE_CUSTOM_REGISTRY_PUBLIC_ENABLED === "true";
}

export function configuredLaunchPermitSignersV2(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): readonly TrustedLaunchPermitSignerV2[] {
  const source = environment.PROGRAMMABLE_LAUNCH_PERMIT_SIGNERS_V2_JSON?.trim();
  if (!source || Buffer.byteLength(source, "utf8") > 65_536) return [];
  try {
    const parsed = JSON.parse(source) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 32) return [];
    const identities = new Set<string>();
    const signers = parsed.map((candidate) => parseSigner(candidate));
    for (const signer of signers) {
      const identity = [
        signer.keyId,
        signer.signerEpoch,
        signer.signerComponentBindingHash,
      ].join("\0");
      if (identities.has(identity)) return [];
      identities.add(identity);
    }
    return Object.freeze(signers);
  } catch {
    return [];
  }
}

function parseSigner(value: unknown): TrustedLaunchPermitSignerV2 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("permit signer is invalid");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join("\0") !== [...SIGNER_KEYS].sort().join("\0")
    || typeof record.keyId !== "string" || !SAFE_ID.test(record.keyId)
    || typeof record.signerEpoch !== "string" || !POSITIVE_EPOCH.test(record.signerEpoch)
    || typeof record.signerComponentBindingHash !== "string"
    || !DIGEST.test(record.signerComponentBindingHash)
    || typeof record.publicKeyBase64Url !== "string"
    || !BASE64URL.test(record.publicKeyBase64Url)
    || typeof record.publicKeySpkiSha256 !== "string"
    || !DIGEST.test(record.publicKeySpkiSha256)
  ) throw new TypeError("permit signer is invalid");
  const publicKey = Buffer.from(record.publicKeyBase64Url, "base64url");
  if (
    publicKey.byteLength !== 32
    || publicKey.toString("base64url") !== record.publicKeyBase64Url
  ) throw new TypeError("permit signer public key is invalid");
  const spkiHash = `sha256:${createHash("sha256")
    .update(Buffer.concat([ED25519_SPKI_PREFIX, publicKey]))
    .digest("hex")}`;
  if (spkiHash !== record.publicKeySpkiSha256) {
    throw new TypeError("permit signer SPKI binding is invalid");
  }
  return Object.freeze({
    keyId: record.keyId,
    signerEpoch: record.signerEpoch,
    signerComponentBindingHash: record.signerComponentBindingHash as `sha256:${string}`,
    publicKeyBase64Url: record.publicKeyBase64Url,
    publicKeySpkiSha256: record.publicKeySpkiSha256 as `sha256:${string}`,
  });
}
