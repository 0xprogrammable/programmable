import "server-only";

import {
  parseStrictJson,
  type JsonValue,
} from "../projection-target/canonical-json";
import {
  getProductionWebsiteProjectionTargetV1,
} from "../projection-target/website-target";
import {
  configuredLaunchPermitSignersV2,
  isCustomLaunchPublicEnabled,
} from "./public-readiness";
import { attestGitHubSessionAuthorityConfigurationV1 } from "./github-session-authority-v1";
import {
  exactReviewAuthorityModeV1,
  type ReviewAuthorityModeV1,
} from "@/lib/custom-launch/review-authority-v1";

const ETHEREUM_CHAIN_ID = "1";
const MAXIMUM_SERVICE_RESPONSE_BYTES = 16_384;
const SERVICE_TIMEOUT_MS = 5_000;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const COMMIT_SHA = /^[0-9a-f]{40}$/u;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const DEPLOYMENT_HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const RESPONSE_HEADERS = {
  "cache-control": "no-store, max-age=0",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
} as const;

export interface CustomLaunchDeploymentReadinessDependenciesV1 {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly serviceFetch: typeof fetch;
  readonly assertWebsiteProjectionDatabaseReadiness: () => Promise<void>;
  readonly now: () => Date;
}

export function createCustomLaunchDeploymentReadinessHandlerV1(
  dependencies: CustomLaunchDeploymentReadinessDependenciesV1,
): (request: Request) => Promise<Response> {
  if (
    typeof dependencies.serviceFetch !== "function"
    || typeof dependencies.assertWebsiteProjectionDatabaseReadiness !== "function"
    || typeof dependencies.now !== "function"
  ) throw new TypeError("Custom launch deployment readiness dependencies are invalid");

  return async function customLaunchDeploymentReadiness(request: Request): Promise<Response> {
    if (!validRequest(request)) return errorResponse(400, "invalid_readiness_request", dependencies.now);

    const publicState =
      dependencies.environment.PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED;
    if (publicState !== "true" && publicState !== "false") {
      return errorResponse(503, "custom_launch_not_ready", dependencies.now);
    }

    try {
      const candidateEnvironment = publicState === "true"
        ? dependencies.environment
        : { ...dependencies.environment, PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED: "true" };
      if (!isCustomLaunchPublicEnabled(candidateEnvironment)) {
        throw new TypeError("Custom launch public configuration is incomplete");
      }
      const signers = configuredLaunchPermitSignersV2(dependencies.environment);
      const sessionAuthority =
        attestGitHubSessionAuthorityConfigurationV1(dependencies.environment);
      const release = exactReleaseIdentity(dependencies.environment);
      const approvalServiceRelease = exactExpectedApprovalServiceReleaseIdentity(
        dependencies.environment,
      );
      const serviceOrigin = exactServiceOrigin(
        dependencies.environment.PROGRAMMABLE_APPROVAL_SERVICE_V2_ORIGIN,
      );
      await Promise.all([
        dependencies.assertWebsiteProjectionDatabaseReadiness(),
        assertApprovalServiceReadiness(
          serviceOrigin,
          approvalServiceRelease,
          dependencies.serviceFetch,
        ),
      ]);

      if (publicState === "false") {
        return Response.json({
          schemaVersion: "programmable.custom-launch-deployment-readiness.v1",
          status: "disabled",
          chainId: ETHEREUM_CHAIN_ID,
          components: {
            approvalService: "ready",
            githubSessionAuthority: "ready",
            permitSignerKeyring: "ready",
            publicConfiguration: "ready",
            websiteProjectionDatabase: "ready",
          },
          approvalServiceRelease,
          sessionAuthority,
          release,
          checkedAt: dependencies.now().toISOString(),
        }, { status: 200, headers: RESPONSE_HEADERS });
      }

      const signer = signers[0]!;
      const query = new URLSearchParams({
        keyId: signer.keyId,
        signerEpoch: signer.signerEpoch,
        signerComponentBindingHash: signer.signerComponentBindingHash,
        publicKeySpkiSha256: signer.publicKeySpkiSha256,
      });
      return Response.json({
        schemaVersion: "programmable.custom-launch-deployment-readiness.v1",
        status: "ready",
        chainId: ETHEREUM_CHAIN_ID,
        components: {
          approvalService: "ready",
          githubSessionAuthority: "ready",
          permitSignerKeyring: "ready",
          publicConfiguration: "ready",
          websiteProjectionDatabase: "ready",
        },
        approvalServiceRelease,
        sessionAuthority,
        release,
        trustedTimePath: `/api/custom-launch/trusted-time?${query.toString()}`,
        checkedAt: dependencies.now().toISOString(),
      }, { status: 200, headers: RESPONSE_HEADERS });
    } catch {
      return errorResponse(503, "custom_launch_not_ready", dependencies.now);
    }
  };
}

export interface ExpectedApprovalServiceReleaseIdentityV1 {
  readonly packageArtifactHash: `sha256:${string}`;
  readonly reviewAuthorityMode: ReviewAuthorityModeV1;
}

function exactExpectedApprovalServiceReleaseIdentity(
  environment: Readonly<Record<string, string | undefined>>,
): Readonly<ExpectedApprovalServiceReleaseIdentityV1> {
  const packageArtifactHash =
    environment.PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH;
  const reviewAuthorityMode = exactReviewAuthorityModeV1(
    environment.PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_REVIEW_AUTHORITY_MODE,
  );
  if (
    typeof packageArtifactHash !== "string"
    || !SHA256_DIGEST.test(packageArtifactHash)
  ) throw new TypeError("Approval service release identity is unavailable");
  return Object.freeze({
    packageArtifactHash: packageArtifactHash as `sha256:${string}`,
    reviewAuthorityMode,
  });
}

let productionHandler:
  | ReturnType<typeof createCustomLaunchDeploymentReadinessHandlerV1>
  | null = null;

export function handleProductionCustomLaunchDeploymentReadinessV1(
  request: Request,
): Promise<Response> {
  productionHandler ??= createCustomLaunchDeploymentReadinessHandlerV1({
    environment: process.env,
    serviceFetch: globalThis.fetch.bind(globalThis),
    assertWebsiteProjectionDatabaseReadiness: async () => {
      await getProductionWebsiteProjectionTargetV1().assertProductionReadiness();
    },
    now: () => new Date(),
  });
  return productionHandler(request);
}

function validRequest(request: Request): boolean {
  const url = new URL(request.url);
  return request.method === "GET"
    && request.body === null
    && request.headers.get("accept")?.trim().toLowerCase() === "application/json"
    && !request.headers.has("content-type")
    && url.username === ""
    && url.password === ""
    && url.search === ""
    && url.hash === "";
}

function exactServiceOrigin(value: string | undefined): URL {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new TypeError("Approval service origin is unavailable");
  }
  const url = new URL(value);
  if (
    url.protocol !== "https:"
    || (url.origin !== value && `${url.origin}/` !== value)
    || url.username !== ""
    || url.password !== ""
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== ""
  ) throw new TypeError("Approval service origin is invalid");
  return new URL(url.origin);
}

function exactReleaseIdentity(
  environment: Readonly<Record<string, string | undefined>>,
): Readonly<{ commitSha: string; deploymentHost: string }> {
  const commitSha = environment.PROGRAMMABLE_RELEASE_COMMIT_SHA;
  const deploymentHost = environment.VERCEL_URL;
  if (
    typeof commitSha !== "string"
    || !COMMIT_SHA.test(commitSha)
    || typeof deploymentHost !== "string"
    || deploymentHost !== deploymentHost.toLowerCase()
    || !DEPLOYMENT_HOST.test(deploymentHost)
  ) throw new TypeError("Production release identity is unavailable");
  return Object.freeze({ commitSha, deploymentHost });
}

export async function assertApprovalServiceReadiness(
  origin: URL,
  expectedRelease: Readonly<ExpectedApprovalServiceReleaseIdentityV1>,
  serviceFetch: typeof fetch,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SERVICE_TIMEOUT_MS);
  try {
    const response = await serviceFetch(new URL("/readyz", origin), {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type")
      ?.split(";", 1)[0]?.trim().toLowerCase();
    const declaredLength = response.headers.get("content-length");
    if (
      response.status !== 200
      || contentType !== "application/json"
      || (declaredLength !== null && (!/^\d+$/u.test(declaredLength)
        || Number(declaredLength) > MAXIMUM_SERVICE_RESPONSE_BYTES))
    ) {
      await response.body?.cancel();
      throw new TypeError("Approval service readiness response is invalid");
    }
    const bytes = await readBoundedResponse(response, MAXIMUM_SERVICE_RESPONSE_BYTES);
    const value = parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes), {
      maximumBytes: MAXIMUM_SERVICE_RESPONSE_BYTES,
      maximumDepth: 8,
    });
    if (!isReadyServiceEnvelope(value, expectedRelease)) {
      throw new TypeError("Approval service readiness response is invalid");
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedResponse(response: Response, maximumBytes: number): Promise<Uint8Array> {
  if (response.body === null) throw new TypeError("Approval service readiness body is missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maximumBytes) throw new TypeError("Approval service readiness body is too large");
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (length === 0) throw new TypeError("Approval service readiness body is missing");
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function isReadyServiceEnvelope(
  value: JsonValue,
  expectedRelease: Readonly<ExpectedApprovalServiceReleaseIdentityV1>,
): boolean {
  if (!isRecord(value) || exactKeys(value, ["data", "requestId", "schemaVersion"]) === false) return false;
  if (value.schemaVersion !== "2.0.0" || typeof value.requestId !== "string"
    || !REQUEST_ID.test(value.requestId) || !isRecord(value.data)) return false;
  if (
    !exactKeys(value.data, ["release", "reviewAuthorityMode", "status"])
    || value.data.status !== "ready"
    || value.data.reviewAuthorityMode !== expectedRelease.reviewAuthorityMode
    || !isRecord(value.data.release)
    || !exactKeys(value.data.release, ["packageArtifactHash"])
  ) return false;
  return value.data.release.packageArtifactHash === expectedRelease.packageArtifactHash;
}

function isRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: { readonly [key: string]: JsonValue }, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function errorResponse(
  status: number,
  code: string,
  now: () => Date,
): Response {
  return Response.json({
    schemaVersion: "programmable.custom-launch-deployment-readiness.v1",
    status: "unready",
    chainId: ETHEREUM_CHAIN_ID,
    code,
    checkedAt: now().toISOString(),
  }, { status, headers: RESPONSE_HEADERS });
}
