import "server-only";

import { PrivyClient } from "@privy-io/node";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";

import {
  canonicalizeJson,
  parseStrictJson,
  type JsonValue,
} from "../projection-target/canonical-json";
import {
  canonicalSha256,
  type Sha256Digest,
} from "../projection-target/hashing";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const GITHUB_USER_ID = /^[1-9][0-9]{0,19}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/u;
const APPLICATION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const APPLICATION_HANDLE = /^github-[0-9a-f]{64}$/u;
const LIST_CURSOR = /^[A-Za-z0-9_-]{16,512}$/u;
const TOKEN = /^[\x21-\x7e]{20,16384}$/u;
const MAXIMUM_REQUEST_BYTES = 65_536;
const ASSERTION_LIFETIME_MS = 60_000;
const PRINCIPAL_APPLICATION_LIST_FILTER_V2 =
  "all_owned_custom_launch_applications_v1";

const READ_OPERATIONS = new Set([
  "read_application_status",
  "read_custom_launch_entitlement",
  "read_launch_descriptor",
  "read_launch_presentation",
  "read_launch_execution_status",
  "write_launch_presentation",
  "submit_application_appeal",
]);
const V3_OPERATIONS = new Set([...READ_OPERATIONS].filter(
  (operation) => operation !== "submit_application_appeal",
));
const MUTATION_OPERATIONS = new Set([
  "launch-session:authority:refresh",
  "launch-session:challenge:create",
  "launch-session:preparation:bind",
  "launch-session:wallet:authenticate",
  "launch-session:launch:authorize",
  "launch-session:launch:report",
  "launch-session:launch:reissue",
]);

export interface PrivySessionAuthorityBoundaryV1 {
  verifyAccessToken(token: string): Promise<Readonly<{
    appId: string;
    issuer: string;
    userId: string;
    sessionId: string;
    issuedAt: number;
    expiration: number;
  }>>;
  getCurrentUser(userId: string): Promise<Readonly<{
    id: string;
    linkedAccounts: readonly Readonly<{
      type: string;
      subject?: string;
    }>[];
  }>>;
}

interface AuthorityConfigurationV1 {
  readonly appId: string;
  readonly audience: string;
  readonly keyId: string;
  readonly keyEpoch: string;
  readonly privateKey: KeyObject;
  readonly publicKeySpkiSha256: Sha256Digest;
  readonly workloadIssuer: string;
  readonly workloadSubject: string;
  readonly workloadKeyId: string;
  readonly workloadPublicKey: KeyObject;
  readonly workloadPublicKeySpkiSha256: Sha256Digest;
  readonly boundary: PrivySessionAuthorityBoundaryV1;
  readonly now: () => Date;
}

export interface GitHubSessionAuthorityConfigurationAttestationV1 {
  readonly schemaVersion: "programmable.github-session-authority-configuration-attestation.v1";
  readonly appId: string;
  readonly audience: string;
  readonly keyId: string;
  readonly keyEpoch: string;
  readonly publicKeySpkiSha256: Sha256Digest;
  readonly workloadIssuer: string;
  readonly workloadSubject: string;
  readonly workloadKeyId: string;
  readonly workloadPublicKeySpkiSha256: Sha256Digest;
  readonly configurationHash: Sha256Digest;
}

export function createGitHubSessionAuthorityHandlerV1(input: Readonly<{
  appId: string;
  audience: string;
  keyId: string;
  keyEpoch: string;
  privateKeyPem: string;
  expectedPublicKeySpkiSha256: Sha256Digest;
  workloadIssuer: string;
  workloadSubject: string;
  workloadKeyId: string;
  workloadPublicKeyPem: string;
  expectedWorkloadPublicKeySpkiSha256: Sha256Digest;
  boundary: PrivySessionAuthorityBoundaryV1;
  now?: () => Date;
}>): (request: Request) => Promise<Response> {
  const configuration = validateConfiguration(input);
  return async function githubSessionAuthority(request: Request): Promise<Response> {
    if (request.method !== "POST") return errorResponse(405, "method_not_allowed", "POST");
    const url = new URL(request.url);
    if (url.username || url.password || url.search || url.hash
      || request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
        !== "application/json"
      || request.headers.get("accept")?.trim().toLowerCase() !== "application/json") {
      return errorResponse(400, "invalid_request");
    }
    try {
      authenticateWorkloadToken(
        configuration,
        bearerToken(request.headers.get("authorization")),
      );
      const body = await strictCanonicalRequest(request);
      const requestDigestHeader = request.headers.get("x-programmable-request-digest");
      const response = await authorize(configuration, body, requestDigestHeader);
      return jsonResponse(200, response);
    } catch (error) {
      if (error instanceof SessionAuthorityAuthenticationErrorV1) {
        return errorResponse(error.status, error.code);
      }
      return errorResponse(400, "session_authority_request_invalid");
    }
  };
}

let productionHandler: ((request: Request) => Promise<Response>) | null = null;

export async function handleProductionGitHubSessionAuthorityV1(
  request: Request,
): Promise<Response> {
  try {
    productionHandler ??= createProductionHandler();
    return await productionHandler(request);
  } catch {
    return errorResponse(503, "session_authority_unavailable");
  }
}

function createProductionHandler(): (request: Request) => Promise<Response> {
  const input = productionAuthorityInput(process.env);
  const { appId, appSecret } = input;
  const privy = new PrivyClient({ appId, appSecret });
  return createGitHubSessionAuthorityHandlerV1({
    appId,
    audience: input.audience,
    keyId: input.keyId,
    keyEpoch: input.keyEpoch,
    privateKeyPem: input.privateKeyPem,
    expectedPublicKeySpkiSha256: input.expectedPublicKeySpkiSha256,
    workloadIssuer: input.workloadIssuer,
    workloadSubject: input.workloadSubject,
    workloadKeyId: input.workloadKeyId,
    workloadPublicKeyPem: input.workloadPublicKeyPem,
    expectedWorkloadPublicKeySpkiSha256:
      input.expectedWorkloadPublicKeySpkiSha256,
    boundary: Object.freeze({
      async verifyAccessToken(token: string) {
        const value = await privy.utils().auth().verifyAccessToken(token);
        return Object.freeze({
          appId: value.app_id,
          issuer: value.issuer,
          userId: value.user_id,
          sessionId: value.session_id,
          issuedAt: value.issued_at,
          expiration: value.expiration,
        });
      },
      async getCurrentUser(userId: string) {
        const user = await privy.users()._get(userId);
        return Object.freeze({
          id: user.id,
          linkedAccounts: Object.freeze(user.linked_accounts.map((account) =>
            Object.freeze({
              type: account.type,
              ...(account.type === "github_oauth" ? { subject: account.subject } : {}),
            }))),
        });
      },
    }),
  });
}

export function attestGitHubSessionAuthorityConfigurationV1(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Readonly<GitHubSessionAuthorityConfigurationAttestationV1> {
  const input = productionAuthorityInput(environment);
  const configuration = validateConfiguration({
    appId: input.appId,
    audience: input.audience,
    keyId: input.keyId,
    keyEpoch: input.keyEpoch,
    privateKeyPem: input.privateKeyPem,
    expectedPublicKeySpkiSha256: input.expectedPublicKeySpkiSha256,
    workloadIssuer: input.workloadIssuer,
    workloadSubject: input.workloadSubject,
    workloadKeyId: input.workloadKeyId,
    workloadPublicKeyPem: input.workloadPublicKeyPem,
    expectedWorkloadPublicKeySpkiSha256:
      input.expectedWorkloadPublicKeySpkiSha256,
    boundary: UNREACHABLE_CONFIGURATION_BOUNDARY,
  });
  const binding = Object.freeze({
    schemaVersion:
      "programmable.github-session-authority-configuration-attestation.v1" as const,
    appId: configuration.appId,
    audience: configuration.audience,
    keyId: configuration.keyId,
    keyEpoch: configuration.keyEpoch,
    publicKeySpkiSha256: configuration.publicKeySpkiSha256,
    workloadIssuer: configuration.workloadIssuer,
    workloadSubject: configuration.workloadSubject,
    workloadKeyId: configuration.workloadKeyId,
    workloadPublicKeySpkiSha256:
      configuration.workloadPublicKeySpkiSha256,
  });
  return Object.freeze({
    ...binding,
    configurationHash: canonicalSha256(
      "programmable.github-session-authority-configuration-attestation.v1",
      binding,
    ),
  });
}

const UNREACHABLE_CONFIGURATION_BOUNDARY: PrivySessionAuthorityBoundaryV1 =
  Object.freeze({
    async verifyAccessToken() {
      throw new TypeError("configuration attestation does not verify credentials");
    },
    async getCurrentUser() {
      throw new TypeError("configuration attestation does not read users");
    },
  });

function productionAuthorityInput(
  environment: Readonly<Record<string, string | undefined>>,
): Readonly<{
  appId: string;
  appSecret: string;
  audience: string;
  keyId: string;
  keyEpoch: string;
  privateKeyPem: string;
  expectedPublicKeySpkiSha256: Sha256Digest;
  workloadIssuer: string;
  workloadSubject: string;
  workloadKeyId: string;
  workloadPublicKeyPem: string;
  expectedWorkloadPublicKeySpkiSha256: Sha256Digest;
}> {
  return Object.freeze({
    appId: requiredEnvironment(environment, "NEXT_PUBLIC_PRIVY_APP_ID"),
    appSecret: requiredEnvironment(environment, "PRIVY_APP_SECRET"),
    audience: requiredEnvironment(
      environment,
      "PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_AUDIENCE",
    ),
    keyId: requiredEnvironment(
      environment,
      "PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_KEY_ID",
    ),
    keyEpoch: requiredEnvironment(
      environment,
      "PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_KEY_EPOCH",
    ),
    privateKeyPem: requiredEnvironment(
      environment,
      "PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_PRIVATE_KEY_PEM",
    ),
    expectedPublicKeySpkiSha256: requiredDigestEnvironment(
      environment,
      "PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_PUBLIC_KEY_SPKI_SHA256",
    ),
    workloadIssuer: requiredEnvironment(
      environment,
      "PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_WORKLOAD_ISSUER",
    ),
    workloadSubject: requiredEnvironment(
      environment,
      "PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_WORKLOAD_SUBJECT",
    ),
    workloadKeyId: requiredEnvironment(
      environment,
      "PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_WORKLOAD_KEY_ID",
    ),
    workloadPublicKeyPem: requiredEnvironment(
      environment,
      "PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_WORKLOAD_PUBLIC_KEY_PEM",
    ),
    expectedWorkloadPublicKeySpkiSha256: requiredDigestEnvironment(
      environment,
      "PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_WORKLOAD_PUBLIC_KEY_SPKI_SHA256",
    ),
  });
}

async function authorize(
  configuration: AuthorityConfigurationV1,
  body: Readonly<Record<string, JsonValue>>,
  requestDigestHeader: string | null,
): Promise<Readonly<Record<string, JsonValue>>> {
  const schemaVersion = body.schemaVersion;
  if (schemaVersion === "programmable.github-session-verification-request.v1") {
    return authorizeRead(configuration, body, requestDigestHeader, false);
  }
  if (schemaVersion === "programmable.github-session-verification-request.v3") {
    return authorizeRead(configuration, body, requestDigestHeader, true);
  }
  if (
    schemaVersion ===
      "programmable.principal-application-list-session-verification-request.v3"
  ) {
    return authorizePrincipalApplicationListV3(
      configuration,
      body,
      requestDigestHeader,
    );
  }
  if (schemaVersion === "programmable.github-launch-mutation-verification-request.v3") {
    return authorizeMutation(configuration, body, requestDigestHeader);
  }
  throw new TypeError("session verification schema is invalid");
}

async function authorizePrincipalApplicationListV3(
  configuration: AuthorityConfigurationV1,
  body: Readonly<Record<string, JsonValue>>,
  requestDigestHeader: string | null,
): Promise<Readonly<Record<string, JsonValue>>> {
  exactKeys(body, [
    "schemaVersion", "audience", "operation", "filterHash", "canonicalTarget",
    "limit", "cursor", "sessionCredential", "requestDigest",
  ]);
  const credential = sessionCredential(body.sessionCredential);
  const requestDigest = digest(body.requestDigest, "requestDigest");
  const canonicalTarget = text(body.canonicalTarget, "canonicalTarget");
  const limit = body.limit;
  const cursor = body.cursor;
  if (
    typeof limit !== "number"
    || !Number.isSafeInteger(limit)
    || limit < 1
    || limit > 100
    || !(cursor === null
      || (typeof cursor === "string" && LIST_CURSOR.test(cursor)))
  ) throw new TypeError("principal application list selector is invalid");
  const expectedCanonicalTarget = cursor === null
    ? `/v3/applications?limit=${limit}`
    : `/v3/applications?limit=${limit}&cursor=${cursor}`;
  const expectedDigest = canonicalSha256(
    "programmable.principal-application-list-session-verification-request.v3",
    {
      audience: configuration.audience,
      operation: "list_applications",
      filterHash: PRINCIPAL_APPLICATION_LIST_FILTER_V2,
      canonicalTarget: expectedCanonicalTarget,
      limit,
      cursor,
      sessionCredentialHash: canonicalSha256(
        "programmable.github-session-credential.v1",
        { credential },
      ),
    },
  );
  if (
    body.audience !== configuration.audience
    || body.operation !== "list_applications"
    || body.filterHash !== PRINCIPAL_APPLICATION_LIST_FILTER_V2
    || canonicalTarget !== expectedCanonicalTarget
    || requestDigestHeader !== requestDigest
    || requestDigest !== expectedDigest
  ) throw new TypeError("principal application list request is not exact");

  const principal = await verifyCurrentPrincipal(configuration, credential);
  const timing = assertionTiming(configuration, principal.expiration, principal.credentialVerifiedAt);
  return signed(configuration, {
    schemaVersion: "programmable.principal-application-list-session-assertion.v3",
    audience: configuration.audience,
    keyId: configuration.keyId,
    keyEpoch: configuration.keyEpoch,
    algorithm: "Ed25519",
    requestDigest,
    operation: "list_applications",
    filterHash: PRINCIPAL_APPLICATION_LIST_FILTER_V2,
    canonicalTarget,
    limit,
    cursor,
    appId: principal.appId,
    userId: principal.userId,
    githubUserId: principal.githubUserId,
    sessionId: principal.sessionId,
    credentialIssuer: principal.issuer,
    credentialIssuedAt: principal.issuedAt,
    credentialExpiresAt: principal.expiration,
    credentialVerifiedAt: principal.credentialVerifiedAt,
    credentialVerificationHash: canonicalSha256(
      "programmable.principal-application-list-credential-verification.v3",
      {
        appId: principal.appId,
        userId: principal.userId,
        sessionId: principal.sessionId,
        githubUserId: principal.githubUserId,
        credentialIssuer: principal.issuer,
        credentialIssuedAt: principal.issuedAt,
        credentialExpiresAt: principal.expiration,
      },
    ),
    issuedAt: timing.issuedAt,
    expiresAt: timing.expiresAt,
  });
}

async function authorizeRead(
  configuration: AuthorityConfigurationV1,
  body: Readonly<Record<string, JsonValue>>,
  requestDigestHeader: string | null,
  v3: boolean,
): Promise<Readonly<Record<string, JsonValue>>> {
  const identityField = v3 ? "applicationHandle" : "applicationId";
  exactKeys(body, [
    "schemaVersion", "audience", identityField, "operation",
    "sessionCredential", "requestDigest",
  ]);
  const identity = text(body[identityField], identityField);
  const operation = text(body.operation, "operation");
  const credential = sessionCredential(body.sessionCredential);
  const requestDigest = digest(body.requestDigest, "requestDigest");
  const expectedDigest = canonicalSha256(
    v3
      ? "programmable.github-session-verification-request.v3"
      : "programmable.github-session-verification-request.v1",
    {
      audience: configuration.audience,
      [identityField]: identity,
      operation,
      sessionCredentialHash: rawSha256(credential),
    },
  );
  if (
    body.audience !== configuration.audience
    || requestDigestHeader !== requestDigest
    || requestDigest !== expectedDigest
    || !(v3
      ? APPLICATION_HANDLE.test(identity)
      : APPLICATION_ID.test(identity) && !APPLICATION_HANDLE.test(identity))
    || !(v3 ? V3_OPERATIONS : READ_OPERATIONS).has(operation)
  ) throw new TypeError("session verification request is not exact");
  const principal = await verifyCurrentPrincipal(configuration, credential);
  const timing = assertionTiming(configuration, principal.expiration, principal.credentialVerifiedAt);
  return signed(configuration, {
    schemaVersion: v3
      ? "programmable.github-session-assertion.v3"
      : "programmable.github-session-assertion.v1",
    audience: configuration.audience,
    keyId: configuration.keyId,
    keyEpoch: configuration.keyEpoch,
    algorithm: "Ed25519",
    requestDigest,
    [identityField]: identity,
    operation,
    githubUserId: principal.githubUserId,
    sessionId: principal.sessionId,
    issuedAt: timing.issuedAt,
    expiresAt: timing.expiresAt,
  });
}

async function authorizeMutation(
  configuration: AuthorityConfigurationV1,
  body: Readonly<Record<string, JsonValue>>,
  requestDigestHeader: string | null,
): Promise<Readonly<Record<string, JsonValue>>> {
  exactKeys(body, [
    "schemaVersion", "authorityAudience", "audience", "operation",
    "requestBindingHash", "canonicalRequestHash", "githubSessionCredentialHash",
    "requiredCredentialState", "requireFreshCredentialVerification", "requestDigest",
    "canonicalRequest", "sessionCredential",
  ]);
  const operation = text(body.operation, "operation");
  const credential = sessionCredential(body.sessionCredential);
  const requestBindingHash = digest(body.requestBindingHash, "requestBindingHash");
  const canonicalRequestHash = digest(body.canonicalRequestHash, "canonicalRequestHash");
  const githubSessionCredentialHash = digest(
    body.githubSessionCredentialHash,
    "githubSessionCredentialHash",
  );
  const requestDigest = digest(body.requestDigest, "requestDigest");
  const canonicalRequest = text(body.canonicalRequest, "canonicalRequest");
  assertCanonicalJsonText(canonicalRequest);
  const requestPreimage = {
    schemaVersion: "programmable.github-launch-mutation-verification-request.v3",
    authorityAudience: configuration.audience,
    audience: "programmable.launch-session.v2",
    operation,
    requestBindingHash,
    canonicalRequestHash,
    githubSessionCredentialHash,
    requiredCredentialState: "valid",
    requireFreshCredentialVerification: true,
  };
  if (
    body.authorityAudience !== configuration.audience
    || body.audience !== "programmable.launch-session.v2"
    || !MUTATION_OPERATIONS.has(operation)
    || body.requiredCredentialState !== "valid"
    || body.requireFreshCredentialVerification !== true
    || canonicalRequestHash !== rawSha256(canonicalRequest)
    || githubSessionCredentialHash !== canonicalSha256(
      "programmable.github-launch-session-credential.v2",
      { credential },
    )
    || requestDigestHeader !== requestDigest
    || requestDigest !== canonicalSha256(
      "programmable.github-launch-mutation-verification-request.v3",
      requestPreimage,
    )
  ) throw new TypeError("launch mutation verification request is not exact");
  const principal = await verifyCurrentPrincipal(configuration, credential);
  const timing = assertionTiming(configuration, principal.expiration, principal.credentialVerifiedAt);
  return signed(configuration, {
    schemaVersion: "programmable.github-launch-mutation-assertion.v3",
    authorityAudience: configuration.audience,
    audience: "programmable.launch-session.v2",
    keyId: configuration.keyId,
    keyEpoch: configuration.keyEpoch,
    algorithm: "Ed25519",
    operation,
    requestBindingHash,
    requestDigest,
    githubUserId: principal.githubUserId,
    githubSessionCredentialHash,
    appId: principal.appId,
    userId: principal.userId,
    sessionId: principal.sessionId,
    credentialIssuer: principal.issuer,
    credentialIssuedAt: principal.issuedAt,
    credentialExpiresAt: principal.expiration,
    credentialVerifiedAt: principal.credentialVerifiedAt,
    credentialVerificationHash: canonicalSha256(
      "programmable.github-launch-mutation-credential-verification.v3",
      {
        appId: principal.appId,
        userId: principal.userId,
        sessionId: principal.sessionId,
        githubUserId: principal.githubUserId,
        credentialIssuer: principal.issuer,
        credentialIssuedAt: principal.issuedAt,
        credentialExpiresAt: principal.expiration,
        githubSessionCredentialHash,
      },
    ),
    issuedAt: timing.issuedAt,
    expiresAt: timing.expiresAt,
  });
}

async function verifyCurrentPrincipal(
  configuration: AuthorityConfigurationV1,
  credential: string,
): Promise<Readonly<{
  appId: string;
  issuer: "privy.io";
  userId: string;
  githubUserId: string;
  sessionId: string;
  issuedAt: number;
  expiration: number;
  credentialVerifiedAt: string;
}>> {
  let access;
  let user;
  try {
    access = await configuration.boundary.verifyAccessToken(credential);
    if (
      access.appId !== configuration.appId
      || access.issuer !== "privy.io"
      || !SAFE_ID.test(access.appId)
      || !SAFE_ID.test(access.userId)
      || !SAFE_ID.test(access.sessionId)
      || !Number.isSafeInteger(access.issuedAt)
      || !Number.isSafeInteger(access.expiration)
      || access.expiration <= access.issuedAt
    ) throw new TypeError("Privy access assertion is invalid");
    user = await configuration.boundary.getCurrentUser(access.userId);
  } catch {
    throw new SessionAuthorityAuthenticationErrorV1(401, "privy_session_rejected");
  }
  if (user.id !== access.userId) {
    throw new SessionAuthorityAuthenticationErrorV1(401, "privy_identity_mismatch");
  }
  const credentialVerifiedAt = configuration.now();
  const nowSeconds = Math.floor(credentialVerifiedAt.getTime() / 1_000);
  if (!Number.isFinite(credentialVerifiedAt.getTime())
    || access.issuedAt > nowSeconds
    || access.expiration <= nowSeconds) {
    throw new SessionAuthorityAuthenticationErrorV1(401, "privy_session_rejected");
  }
  const githubAccounts = user.linkedAccounts.filter(
    (account) => account.type === "github_oauth",
  );
  if (githubAccounts.length !== 1) {
    throw new SessionAuthorityAuthenticationErrorV1(
      403,
      githubAccounts.length === 0 ? "github_account_required" : "github_identity_ambiguous",
    );
  }
  const githubUserId = githubAccounts[0]!.subject;
  if (typeof githubUserId !== "string" || !GITHUB_USER_ID.test(githubUserId)) {
    throw new SessionAuthorityAuthenticationErrorV1(403, "github_identity_invalid");
  }
  return Object.freeze({
    appId: access.appId,
    issuer: "privy.io" as const,
    userId: access.userId,
    githubUserId,
    sessionId: access.sessionId,
    issuedAt: access.issuedAt,
    expiration: access.expiration,
    credentialVerifiedAt: credentialVerifiedAt.toISOString(),
  });
}

function assertionTiming(
  configuration: AuthorityConfigurationV1,
  accessExpirationSeconds: number,
  credentialVerifiedAt?: string,
): Readonly<{ issuedAt: string; expiresAt: string }> {
  const now = configuration.now();
  const nowMs = now.getTime();
  const issuedAtMs = credentialVerifiedAt === undefined
    ? nowMs
    : Date.parse(credentialVerifiedAt);
  const expiresAtMs = Math.min(
    accessExpirationSeconds * 1_000,
    issuedAtMs + ASSERTION_LIFETIME_MS,
  );
  if (
    !Number.isFinite(nowMs)
    || !Number.isFinite(issuedAtMs)
    || issuedAtMs > nowMs
    || (credentialVerifiedAt !== undefined
      && new Date(issuedAtMs).toISOString() !== credentialVerifiedAt)
    || expiresAtMs <= nowMs + 1_000
  ) {
    throw new SessionAuthorityAuthenticationErrorV1(401, "privy_session_rejected");
  }
  return Object.freeze({
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
  });
}

function signed(
  configuration: AuthorityConfigurationV1,
  unsigned: Readonly<Record<string, JsonValue>>,
): Readonly<Record<string, JsonValue>> {
  const signature = sign(
    null,
    Buffer.from(canonicalizeJson(unsigned), "utf8"),
    configuration.privateKey,
  ).toString("base64url");
  return Object.freeze({ ...unsigned, signature });
}

function validateConfiguration(input: Readonly<{
  appId: string;
  audience: string;
  keyId: string;
  keyEpoch: string;
  privateKeyPem: string;
  expectedPublicKeySpkiSha256: Sha256Digest;
  workloadIssuer: string;
  workloadSubject: string;
  workloadKeyId: string;
  workloadPublicKeyPem: string;
  expectedWorkloadPublicKeySpkiSha256: Sha256Digest;
  boundary: PrivySessionAuthorityBoundaryV1;
  now?: () => Date;
}>): AuthorityConfigurationV1 {
  if (
    !SAFE_ID.test(input.appId)
    || !SAFE_ID.test(input.audience) || !SAFE_ID.test(input.keyId) || !SAFE_ID.test(input.keyEpoch)
    || typeof input.privateKeyPem !== "string" || input.privateKeyPem.length > 32_768
    || !DIGEST.test(input.expectedPublicKeySpkiSha256)
    || !SAFE_ID.test(input.workloadIssuer)
    || !SAFE_ID.test(input.workloadSubject)
    || !SAFE_ID.test(input.workloadKeyId)
    || typeof input.workloadPublicKeyPem !== "string"
    || input.workloadPublicKeyPem.length > 32_768
    || !DIGEST.test(input.expectedWorkloadPublicKeySpkiSha256)
    || typeof input.boundary?.verifyAccessToken !== "function"
    || typeof input.boundary.getCurrentUser !== "function"
    || (input.now !== undefined && typeof input.now !== "function")
  ) throw new TypeError("GitHub session authority configuration is invalid");
  const privateKey = createPrivateKey(input.privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new TypeError("GitHub session authority key must be Ed25519");
  }
  const publicKeySpkiSha256 = rawSha256(
    createPublicKey(input.privateKeyPem).export({ format: "der", type: "spki" }),
  );
  if (publicKeySpkiSha256 !== input.expectedPublicKeySpkiSha256) {
    throw new TypeError("GitHub session authority public key binding differs");
  }
  const workloadPublicKey = createPublicKey(input.workloadPublicKeyPem);
  if (workloadPublicKey.asymmetricKeyType !== "ed25519") {
    throw new TypeError("GitHub session workload key must be Ed25519");
  }
  const workloadPublicKeySpkiSha256 = rawSha256(
    workloadPublicKey.export({ format: "der", type: "spki" }),
  );
  if (workloadPublicKeySpkiSha256 !== input.expectedWorkloadPublicKeySpkiSha256) {
    throw new TypeError("GitHub session workload public key binding differs");
  }
  return Object.freeze({
    appId: input.appId,
    audience: input.audience,
    keyId: input.keyId,
    keyEpoch: input.keyEpoch,
    privateKey,
    publicKeySpkiSha256,
    workloadIssuer: input.workloadIssuer,
    workloadSubject: input.workloadSubject,
    workloadKeyId: input.workloadKeyId,
    workloadPublicKey,
    workloadPublicKeySpkiSha256,
    boundary: input.boundary,
    now: input.now ?? (() => new Date()),
  });
}

function authenticateWorkloadToken(
  configuration: AuthorityConfigurationV1,
  token: string,
): void {
  const segments = token.split(".");
  if (segments.length !== 3) throw new SessionAuthorityAuthenticationErrorV1(
    401,
    "workload_authentication_required",
  );
  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  try {
    if (encodedHeader === undefined || encodedPayload === undefined
      || encodedSignature === undefined) throw new TypeError("workload token segments invalid");
    const header = jsonRecord(decodeCanonicalJwtSegment(encodedHeader, 4_096));
    exactKeys(header, ["alg", "kid", "typ"]);
    const signature = decodeBase64Url(encodedSignature, 64);
    if (
      header.alg !== "EdDSA"
      || header.kid !== configuration.workloadKeyId
      || header.typ !== "JWT"
      || signature.byteLength !== 64
      || !verify(
        null,
        Buffer.from(`${encodedHeader}.${encodedPayload}`, "ascii"),
        configuration.workloadPublicKey,
        signature,
      )
    ) throw new TypeError("workload token signature invalid");
    const payload = jsonRecord(decodeCanonicalJwtSegment(encodedPayload, 16_384));
    exactKeys(payload, ["aud", "exp", "iat", "iss", "jti", "schemaVersion", "sub"]);
    const nowSeconds = Math.floor(configuration.now().getTime() / 1_000);
    if (
      payload.schemaVersion !== "programmable.workload-access-token.v1"
      || payload.iss !== configuration.workloadIssuer
      || payload.sub !== configuration.workloadSubject
      || payload.aud !== configuration.audience
      || !SAFE_ID.test(text(payload.jti, "workload jti"))
      || !Number.isSafeInteger(payload.iat)
      || !Number.isSafeInteger(payload.exp)
      || (payload.iat as number) > nowSeconds
      || (payload.exp as number) <= nowSeconds
      || (payload.exp as number) <= (payload.iat as number)
      || (payload.exp as number) - (payload.iat as number) > 600
    ) throw new TypeError("workload token claims invalid");
  } catch {
    throw new SessionAuthorityAuthenticationErrorV1(
      401,
      "workload_authentication_required",
    );
  }
}

function bearerToken(value: string | null): string {
  if (value === null || !value.startsWith("Bearer ")) {
    throw new SessionAuthorityAuthenticationErrorV1(
      401,
      "workload_authentication_required",
    );
  }
  const token = value.slice("Bearer ".length);
  if (!TOKEN.test(token)) throw new SessionAuthorityAuthenticationErrorV1(
    401,
    "workload_authentication_required",
  );
  return token;
}

function decodeCanonicalJwtSegment(value: string, maximumBytes: number): JsonValue {
  const decoded = decodeBase64Url(value, maximumBytes);
  const source = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
  const parsed = parseStrictJson(source, { maximumBytes, maximumDepth: 8 });
  if (canonicalizeJson(parsed) !== source) {
    throw new TypeError("workload token segment is not canonical JSON");
  }
  return parsed;
}

function decodeBase64Url(value: string, maximumBytes: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.includes("=")
    || value.length > maximumBytes * 2) {
    throw new TypeError("workload token segment is invalid");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength > maximumBytes || decoded.toString("base64url") !== value) {
    throw new TypeError("workload token segment is not canonical base64url");
  }
  return decoded;
}

async function strictCanonicalRequest(
  request: Request,
): Promise<Readonly<Record<string, JsonValue>>> {
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength < 2 || bytes.byteLength > MAXIMUM_REQUEST_BYTES) {
    throw new TypeError("session authority request size is invalid");
  }
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const value = jsonRecord(parseStrictJson(source, {
    maximumBytes: MAXIMUM_REQUEST_BYTES,
    maximumDepth: 16,
  }));
  if (canonicalizeJson(value) !== source) {
    throw new TypeError("session authority request is not canonical JSON");
  }
  return value;
}

function assertCanonicalJsonText(value: string): void {
  const parsed = parseStrictJson(value, {
    maximumBytes: 32_768,
    maximumDepth: 16,
  });
  if (canonicalizeJson(parsed) !== value) {
    throw new TypeError("canonical request is not canonical JSON");
  }
}

function jsonRecord(value: JsonValue): Readonly<Record<string, JsonValue>> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new TypeError("session authority request must be an object");
  }
  return value;
}

function exactKeys(value: object, expected: readonly string[]): void {
  const observed = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (observed.length !== sorted.length
    || observed.some((key, index) => key !== sorted[index])) {
    throw new TypeError("session authority request fields are invalid");
  }
}

function text(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 32_768) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function digest(value: JsonValue | undefined, label: string): Sha256Digest {
  const candidate = text(value, label);
  if (!DIGEST.test(candidate)) throw new TypeError(`${label} is invalid`);
  return candidate as Sha256Digest;
}

function sessionCredential(value: JsonValue | undefined): string {
  const credential = text(value, "sessionCredential");
  if (!TOKEN.test(credential)) throw new TypeError("session credential is invalid");
  return credential;
}

function rawSha256(value: string | Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function requiredEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) throw new TypeError(`${name} is not configured`);
  return value;
}

function requiredDigestEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): Sha256Digest {
  const value = requiredEnvironment(environment, name);
  if (!DIGEST.test(value)) throw new TypeError(`${name} is invalid`);
  return value as Sha256Digest;
}

function jsonResponse(
  status: number,
  body: Readonly<Record<string, JsonValue>>,
  allow?: string,
): Response {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  if (allow !== undefined) headers.set("allow", allow);
  return new Response(canonicalizeJson(body), { status, headers });
}

function errorResponse(status: number, code: string, allow?: string): Response {
  return jsonResponse(status, {
    schemaVersion: "programmable.github-session-authority-error.v1",
    code,
  }, allow);
}

class SessionAuthorityAuthenticationErrorV1 extends Error {
  constructor(readonly status: 401 | 403, readonly code: string) {
    super(code);
    this.name = "SessionAuthorityAuthenticationErrorV1";
  }
}
