import { createHash } from "node:crypto";

import { put, type PutBlobResult } from "@vercel/blob";
import { PrivyClient } from "@privy-io/node";
import { NextResponse } from "next/server";

import type {
  TokenImageUploadReceiptLaunchScopeV1,
  TokenImageUploadReceiptOwnerV1,
} from "@/lib/custom-launch/token-image-upload-receipt-v1";
import type { Sha256DigestV2 } from "@/lib/custom-launch/contract-v2";
import {
  createPrivyGitHubPrincipalAuthenticatorV1,
  type AuthenticatedGitHubPrincipalV1,
} from "@/lib/server/projection-target/github-entitlement";
import {
  parseStrictJson,
  type JsonValue,
} from "@/lib/server/projection-target/canonical-json";
import {
  createProductionTokenImageUploadReceiptSignerV1,
  type TokenImageUploadReceiptSignerV1,
} from "@/lib/server/token-image-upload-receipt-v1";
import { verifyTokenImageWebpV1 } from "@/lib/server/token-image-webp-v1";
import {
  getProgrammableTokenImageAssetName,
  MAX_TOKEN_IMAGE_UPLOAD_BYTES,
  PROGRAMMABLE_TOKEN_IMAGE_HOST,
  PROGRAMMABLE_TOKEN_IMAGE_STORE_ID,
  TOKEN_IMAGE_OUTPUT_SIZE,
} from "@/lib/token-image";

const READBACK_TIMEOUT_MS = 5_000;
const MAXIMUM_RECEIPT_SCOPE_BYTES = 2_048;
const moduleFetch = globalThis.fetch.bind(globalThis);

const responseHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  Vary: "Authorization, X-Privy-Identity-Token",
};

type TokenImageUploadSessionV1 = Readonly<{ privyUserId: string }>;
type TokenImageReadbackV1 = Readonly<{
  url: string;
  etag: string;
  contentType: string;
  bytes: Uint8Array;
}>;

export type TokenImageUploadHandlerDependenciesV1 = Readonly<{
  blobToken: string;
  authenticateSession(request: Request): Promise<TokenImageUploadSessionV1 | null>;
  authenticatePrincipal(request: Request): Promise<AuthenticatedGitHubPrincipalV1>;
  prepareReceiptSigner(): Promise<TokenImageUploadReceiptSignerV1>;
  putBlob(pathname: string, file: File, token: string): Promise<PutBlobResult>;
  readBlob(blob: PutBlobResult, signal: AbortSignal): Promise<TokenImageReadbackV1>;
  readbackTimeoutMs?: number;
}>;

export function createTokenImageUploadHandlerV1(
  dependencies: TokenImageUploadHandlerDependenciesV1,
): (request: Request) => Promise<Response> {
  return async function tokenImageUpload(request: Request): Promise<Response> {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (
      Number.isFinite(contentLength)
      && contentLength > MAX_TOKEN_IMAGE_UPLOAD_BYTES + 100_000
    ) return errorResponse("Choose a smaller image", 413);

    const session = await dependencies.authenticateSession(request);
    if (!session) return errorResponse("Connect your wallet and try again", 401);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return errorResponse("The image could not be read", 400);
    }
    const file = form.get("file");
    if (!(file instanceof File)) return errorResponse("Choose an image", 400);
    if (
      file.type !== "image/webp"
      || file.size === 0
      || file.size > MAX_TOKEN_IMAGE_UPLOAD_BYTES
    ) return errorResponse("Choose a valid token image", 400);

    let verifiedSource;
    try {
      verifiedSource = await verifyTokenImageWebpV1(file);
    } catch {
      return errorResponse("Choose a valid token image", 400);
    }

    let scope: TokenImageUploadReceiptLaunchScopeV1 | null = null;
    try {
      scope = parseReceiptScope(form.get("receiptScope"));
    } catch {
      return errorResponse("The image upload request is invalid", 400);
    }
    let principal: AuthenticatedGitHubPrincipalV1 | null = null;
    let signer: TokenImageUploadReceiptSignerV1 | null = null;
    if (scope !== null) {
      try {
        principal = await dependencies.authenticatePrincipal(request);
      } catch {
        return errorResponse("Connect the approved GitHub account and try again", 403);
      }
      if (principal.privyUserId !== session.privyUserId) {
        return errorResponse("Connect the approved GitHub account and try again", 403);
      }
      try {
        // Resolve signer authority before the irreversible Blob write. There is
        // deliberately no local/private-key fallback.
        signer = await dependencies.prepareReceiptSigner();
      } catch {
        return errorResponse("Verified image uploads are temporarily unavailable", 503);
      }
    }

    let blob: PutBlobResult;
    try {
      blob = await dependencies.putBlob(
        `token-images/${crypto.randomUUID()}.webp`,
        new File(
          [Uint8Array.from(verifiedSource.bytes).buffer],
          "custom-launch.webp",
          { type: "image/webp" },
        ),
        dependencies.blobToken,
      );
      validateWrittenBlob(blob);
    } catch {
      return errorResponse("The image could not be uploaded", 502);
    }

    let readback: TokenImageReadbackV1;
    let verifiedReadback;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error("token image readback deadline exceeded")),
        dependencies.readbackTimeoutMs ?? READBACK_TIMEOUT_MS,
      );
      const signal = AbortSignal.any([request.signal, controller.signal]);
      try {
        readback = await dependencies.readBlob(blob, signal);
      } finally {
        clearTimeout(timeout);
      }
      validateReadback(blob, readback);
      verifiedReadback = await verifyTokenImageWebpV1(readback.bytes);
      if (
        rawDigest(verifiedReadback.bytes) !== rawDigest(verifiedSource.bytes)
        || verifiedReadback.bytes.byteLength !== verifiedSource.bytes.byteLength
      ) throw new TypeError("token image readback bytes changed");
    } catch {
      return errorResponse("The uploaded image could not be verified", 502);
    }

    if (scope === null || principal === null || signer === null) {
      return NextResponse.json(
        { url: blob.url },
        { status: 201, headers: responseHeaders },
      );
    }

    const uploadOwner: TokenImageUploadReceiptOwnerV1 = Object.freeze({
      provider: "privy-github",
      privyUserId: principal.privyUserId,
      githubUserId: principal.githubUserId,
      githubPrincipalHash: principal.githubPrincipalHash as Sha256DigestV2,
    });
    try {
      const receipt = await signer.sign({
        launchScope: scope,
        uploadOwner,
        blob: Object.freeze({
          storeId: PROGRAMMABLE_TOKEN_IMAGE_STORE_ID,
          host: PROGRAMMABLE_TOKEN_IMAGE_HOST,
          pathname: blob.pathname,
          url: blob.url,
          etag: normalizeStrongEtag(blob.etag),
        }),
        image: Object.freeze({
          contentSha256: rawDigest(verifiedReadback.bytes),
          mediaType: "image/webp",
          byteLength: verifiedReadback.bytes.byteLength,
          width: TOKEN_IMAGE_OUTPUT_SIZE,
          height: TOKEN_IMAGE_OUTPUT_SIZE,
        }),
        signal: request.signal,
      });
      return NextResponse.json(
        { url: blob.url, receipt },
        { status: 201, headers: responseHeaders },
      );
    } catch {
      // The Blob may now be orphaned. Never delete it here: deletion is an
      // independent external mutation and a receipt/presentation was not issued.
      return errorResponse("The uploaded image could not be verified", 502);
    }
  };
}

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: responseHeaders });
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
}

async function verifyPrivySession(request: Request): Promise<TokenImageUploadSessionV1 | null> {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const appSecret = process.env.PRIVY_APP_SECRET?.trim();
  const accessToken = getBearerToken(request);
  if (!appId || !appSecret || !accessToken) return null;
  const privy = new PrivyClient({ appId, appSecret });
  try {
    const session = await privy.utils().auth().verifyAccessToken(accessToken);
    if (session.app_id !== appId || !session.user_id) return null;
    return Object.freeze({ privyUserId: session.user_id });
  } catch {
    return null;
  }
}

export async function readProductionTokenImageBlobV1(
  blob: PutBlobResult,
  signal: AbortSignal,
  transport: typeof fetch = moduleFetch,
): Promise<TokenImageReadbackV1> {
  const response = await transport(blob.url, {
    method: "GET",
    redirect: "error",
    cache: "no-store",
    credentials: "omit",
    signal,
    headers: {
      accept: "image/webp",
    },
  });
  if (response.redirected || response.status !== 200 || response.url !== blob.url) {
    throw new TypeError("token image readback target changed");
  }
  const contentType = response.headers.get("content-type")
    ?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const etag = response.headers.get("etag") ?? "";
  return Object.freeze({
    url: response.url,
    etag,
    contentType,
    bytes: await readBoundedBody(response, MAX_TOKEN_IMAGE_UPLOAD_BYTES),
  });
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new TypeError("token image readback is too large");
  }
  if (response.body === null) throw new TypeError("token image readback is empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) throw new TypeError("token image readback is too large");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total < 1) throw new TypeError("token image readback is empty");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parseReceiptScope(value: FormDataEntryValue | null):
TokenImageUploadReceiptLaunchScopeV1 | null {
  if (value === null) return null;
  if (
    typeof value !== "string"
    || value.length < 1
    || new TextEncoder().encode(value).byteLength > MAXIMUM_RECEIPT_SCOPE_BYTES
  ) throw new TypeError("token image receipt scope is invalid");
  const parsed = parseStrictJson(value, {
    maximumBytes: MAXIMUM_RECEIPT_SCOPE_BYTES,
    maximumDepth: 3,
  });
  const record = jsonRecord(parsed, "token image receipt scope");
  exactKeys(record, [
    "applicationHandle", "applicationId", "grantBindingHash", "grantId",
  ], "token image receipt scope");
  if (
    typeof record.applicationId !== "string"
    || typeof record.applicationHandle !== "string"
    || typeof record.grantId !== "string"
    || typeof record.grantBindingHash !== "string"
    || record.applicationId.length < 1
    || record.applicationId.length > 256
    || !/^github-[0-9a-f]{64}$/u.test(record.applicationHandle)
    || record.grantId.length < 1
    || record.grantId.length > 256
    || !/^sha256:[0-9a-f]{64}$/u.test(record.grantBindingHash)
  ) throw new TypeError("token image receipt scope is invalid");
  return Object.freeze({
    applicationId: record.applicationId,
    applicationHandle: record.applicationHandle as `github-${string}`,
    grantId: record.grantId,
    grantBindingHash: record.grantBindingHash as Sha256DigestV2,
  });
}

function validateWrittenBlob(blob: PutBlobResult): void {
  const asset = getProgrammableTokenImageAssetName(blob.url);
  const url = new URL(blob.url);
  if (
    asset === ""
    || blob.contentType !== "image/webp"
    || blob.pathname !== url.pathname.slice(1)
    || normalizeStrongEtag(blob.etag) === ""
  ) throw new TypeError("written token image Blob is invalid");
}

function validateReadback(blob: PutBlobResult, readback: TokenImageReadbackV1): void {
  if (
    readback.url !== blob.url
    || readback.contentType !== "image/webp"
    || normalizeStrongEtag(readback.etag) !== normalizeStrongEtag(blob.etag)
    || readback.bytes.byteLength < 1
    || readback.bytes.byteLength > MAX_TOKEN_IMAGE_UPLOAD_BYTES
  ) throw new TypeError("token image Blob readback is invalid");
}

function normalizeStrongEtag(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.startsWith("W/") || trimmed.length > 256) {
    throw new TypeError("token image Blob etag is invalid");
  }
  const unquoted = trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1)
    : trimmed;
  if (unquoted === "" || /[\s\u0000-\u001f\u007f"]/u.test(unquoted)) {
    throw new TypeError("token image Blob etag is invalid");
  }
  return unquoted;
}

function rawDigest(bytes: Uint8Array): Sha256DigestV2 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function jsonRecord(value: JsonValue, label: string): Readonly<Record<string, JsonValue>> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function exactKeys(
  value: Readonly<Record<string, JsonValue>>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} has unknown or missing fields`);
  }
}

let productionHandler: ((request: Request) => Promise<Response>) | null = null;

export async function POST(request: Request) {
  const blobToken = process.env.TOKEN_IMAGE_BLOB_READ_WRITE_TOKEN?.trim();
  if (!blobToken) {
    return errorResponse("Image uploads are temporarily unavailable", 503);
  }
  if (productionHandler === null) {
    productionHandler = createTokenImageUploadHandlerV1({
      blobToken,
      authenticateSession: verifyPrivySession,
      authenticatePrincipal(request) {
        return createPrivyGitHubPrincipalAuthenticatorV1().authenticate(request);
      },
      prepareReceiptSigner: () => createProductionTokenImageUploadReceiptSignerV1(),
      putBlob(pathname, file, token) {
        return put(pathname, file, {
          access: "public",
          addRandomSuffix: true,
          allowOverwrite: false,
          cacheControlMaxAge: 31_536_000,
          contentType: "image/webp",
          token,
        });
      },
      readBlob: readProductionTokenImageBlobV1,
    });
  }
  return productionHandler(request);
}
