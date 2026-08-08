import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  createHash,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";

vi.mock("server-only", () => ({}));

import {
  attestGitHubSessionAuthorityConfigurationV1,
  createGitHubSessionAuthorityHandlerV1,
  type PrivySessionAuthorityBoundaryV1,
} from "@/lib/server/custom-launch/github-session-authority-v1";
import { canonicalizeJson } from "@/lib/server/projection-target/canonical-json";
import {
  canonicalSha256,
  type Sha256Digest,
} from "@/lib/server/projection-target/hashing";

const NOW = new Date("2026-08-08T12:00:00.000Z");
const TOKEN = "privy-access-token-value-123456789";
const APP_ID = "privy-app-id";
const AUDIENCE = "programmable.github-session-authority.v1";
const KEY_ID = "github-session-v1";
const KEY_EPOCH = "1";
const HANDLE = `github-${"a".repeat(64)}`;
const LIST_CURSOR = "opaque_cursor_000000000001";
const DIGEST_A = digest("request-binding");

function fixture(linkedAccounts: readonly Readonly<{
  type: string;
  subject?: string;
}>[] = [{ type: "github_oauth", subject: "312577473" }], identity: Readonly<{
  appId?: string;
  issuer?: string;
  userId?: string;
  sessionId?: string;
  currentUserId?: string;
  issuedAt?: number;
  expiration?: number;
  now?: () => Date;
}> = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const workload = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicKeySpkiSha256 = rawSha256(
    publicKey.export({ format: "der", type: "spki" }),
  );
  const workloadPublicKeyPem = workload.publicKey.export({
    format: "pem",
    type: "spki",
  }).toString();
  const workloadPublicKeySpkiSha256 = rawSha256(
    workload.publicKey.export({ format: "der", type: "spki" }),
  );
  const boundary: PrivySessionAuthorityBoundaryV1 = Object.freeze({
    async verifyAccessToken(token: string) {
      if (token !== TOKEN) throw new TypeError("invalid token");
      return Object.freeze({
        appId: identity.appId ?? APP_ID,
        issuer: identity.issuer ?? "privy.io",
        userId: identity.userId ?? "did:privy:user",
        sessionId: identity.sessionId ?? "privy-session-1",
        issuedAt: identity.issuedAt ?? Math.floor(NOW.getTime() / 1_000) - 30,
        expiration: identity.expiration ?? Math.floor(NOW.getTime() / 1_000) + 3_600,
      });
    },
    async getCurrentUser(userId: string) {
      return Object.freeze({
        id: identity.currentUserId ?? userId,
        linkedAccounts: Object.freeze(linkedAccounts),
      });
    },
  });
  return {
    publicKey,
    workloadToken: createWorkloadToken(workload.privateKey),
    environment: Object.freeze({
      NEXT_PUBLIC_PRIVY_APP_ID: APP_ID,
      PRIVY_APP_SECRET: "privy-app-secret",
      PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_AUDIENCE: AUDIENCE,
      PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_KEY_ID: KEY_ID,
      PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_KEY_EPOCH: KEY_EPOCH,
      PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_PRIVATE_KEY_PEM: privateKeyPem,
      PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_PUBLIC_KEY_SPKI_SHA256:
        publicKeySpkiSha256,
      PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_WORKLOAD_ISSUER:
        "programmable-authority-token-broker-v1",
      PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_WORKLOAD_SUBJECT: "approval-runtime-v1",
      PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_WORKLOAD_KEY_ID: "workload-access-v1",
      PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_WORKLOAD_PUBLIC_KEY_PEM:
        workloadPublicKeyPem,
      PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_WORKLOAD_PUBLIC_KEY_SPKI_SHA256:
        workloadPublicKeySpkiSha256,
    }),
    handler: createGitHubSessionAuthorityHandlerV1({
      appId: APP_ID,
      audience: AUDIENCE,
      keyId: KEY_ID,
      keyEpoch: KEY_EPOCH,
      privateKeyPem,
      expectedPublicKeySpkiSha256: publicKeySpkiSha256,
      workloadIssuer: "programmable-authority-token-broker-v1",
      workloadSubject: "approval-runtime-v1",
      workloadKeyId: "workload-access-v1",
      workloadPublicKeyPem,
      expectedWorkloadPublicKeySpkiSha256: workloadPublicKeySpkiSha256,
      boundary,
      now: identity.now ?? (() => NOW),
    }),
  };
}

describe("GitHub session authority", () => {
  it("attests the exact production key pair and workload configuration without credentials", () => {
    const { environment } = fixture();
    const attestation = attestGitHubSessionAuthorityConfigurationV1(environment);
    expect(attestation).toMatchObject({
      schemaVersion:
        "programmable.github-session-authority-configuration-attestation.v1",
      appId: APP_ID,
      audience: AUDIENCE,
      keyId: KEY_ID,
      keyEpoch: KEY_EPOCH,
      workloadIssuer: "programmable-authority-token-broker-v1",
      workloadSubject: "approval-runtime-v1",
      workloadKeyId: "workload-access-v1",
      configurationHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    });
    expect(JSON.stringify(attestation)).not.toContain("PRIVATE KEY");
    expect(JSON.stringify(attestation)).not.toContain("privy-app-secret");
    expect(() => attestGitHubSessionAuthorityConfigurationV1({
      ...environment,
      PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_PUBLIC_KEY_SPKI_SHA256:
        digest("substituted-session-authority-key"),
    })).toThrow("public key binding differs");
    expect(() => attestGitHubSessionAuthorityConfigurationV1({
      ...environment,
      PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_WORKLOAD_PUBLIC_KEY_SPKI_SHA256:
        digest("substituted-workload-key"),
    })).toThrow("workload public key binding differs");
  });

  it("signs the exact V3 principal-application-list credential assertion", async () => {
    const { handler, publicKey, workloadToken } = fixture();
    const list = principalApplicationListRequest();
    const response = await handler(request(list.body, list.requestDigest, workloadToken));
    expect(response.status).toBe(200);
    const assertion = await response.json() as Record<string, unknown>;
    expect(assertion).toMatchObject({
      schemaVersion: "programmable.principal-application-list-session-assertion.v3",
      audience: AUDIENCE,
      keyId: KEY_ID,
      keyEpoch: KEY_EPOCH,
      algorithm: "Ed25519",
      requestDigest: list.requestDigest,
      operation: "list_applications",
      filterHash: "all_owned_custom_launch_applications_v1",
      canonicalTarget: `/v3/applications?limit=25&cursor=${LIST_CURSOR}`,
      limit: 25,
      cursor: LIST_CURSOR,
      appId: APP_ID,
      userId: "did:privy:user",
      githubUserId: "312577473",
      sessionId: "privy-session-1",
      credentialIssuer: "privy.io",
      credentialIssuedAt: Math.floor(NOW.getTime() / 1_000) - 30,
      credentialExpiresAt: Math.floor(NOW.getTime() / 1_000) + 3_600,
      credentialVerifiedAt: NOW.toISOString(),
      credentialVerificationHash: canonicalSha256(
        "programmable.principal-application-list-credential-verification.v3",
        {
          appId: APP_ID,
          userId: "did:privy:user",
          sessionId: "privy-session-1",
          githubUserId: "312577473",
          credentialIssuer: "privy.io",
          credentialIssuedAt: Math.floor(NOW.getTime() / 1_000) - 30,
          credentialExpiresAt: Math.floor(NOW.getTime() / 1_000) + 3_600,
        },
      ),
      issuedAt: NOW.toISOString(),
      expiresAt: "2026-08-08T12:01:00.000Z",
    });
    expect(verifies(assertion, publicKey)).toBe(true);
  });

  it("fails closed for list substitutions and exact Privy GitHub identity boundaries", async () => {
    const list = principalApplicationListRequest();
    const valid = fixture();
    expect((await valid.handler(request(
      { ...list.body, limit: 26 },
      list.requestDigest,
      valid.workloadToken,
    ))).status).toBe(400);
    expect((await valid.handler(request(
      { ...list.body, canonicalTarget: `/v3/applications?cursor=${LIST_CURSOR}&limit=25` },
      list.requestDigest,
      valid.workloadToken,
    ))).status).toBe(400);
    const wrongApp = fixture(undefined, { appId: "foreign-app" });
    expect((await wrongApp.handler(request(
      list.body,
      list.requestDigest,
      wrongApp.workloadToken,
    ))).status).toBe(401);
    const wrongIssuer = fixture(undefined, { issuer: "foreign.example" });
    expect((await wrongIssuer.handler(request(
      list.body,
      list.requestDigest,
      wrongIssuer.workloadToken,
    ))).status).toBe(401);

    for (const linkedAccounts of [
      [],
      [{ type: "github_oauth", subject: "312577473" },
        { type: "github_oauth", subject: "312577473" }],
      [{ type: "github_oauth", subject: "312577473" },
        { type: "github_oauth" }],
      [{ type: "github_oauth" }],
      [{ type: "github_oauth", subject: "0" }],
      [{ type: "github_oauth", subject: "0123" }],
      [{ type: "github_oauth", subject: "1".repeat(21) }],
    ] as const) {
      const rejected = fixture(linkedAccounts);
      expect((await rejected.handler(request(
        list.body,
        list.requestDigest,
        rejected.workloadToken,
      ))).status).toBe(403);
    }

    const twentyDigit = fixture([
      { type: "github_oauth", subject: "9".repeat(20) },
    ]);
    expect((await twentyDigit.handler(request(
      list.body,
      list.requestDigest,
      twentyDigit.workloadToken,
    ))).status).toBe(200);

    const wrongUser = fixture(undefined, { currentUserId: "did:privy:foreign" });
    expect((await wrongUser.handler(request(
      list.body,
      list.requestDigest,
      wrongUser.workloadToken,
    ))).status).toBe(401);
    const malformedSession = fixture(undefined, { sessionId: "invalid session" });
    expect((await malformedSession.handler(request(
      list.body,
      list.requestDigest,
      malformedSession.workloadToken,
    ))).status).toBe(401);
  });

  it("keeps public application ids disjoint from opaque V3 handles", async () => {
    const { handler, workloadToken } = fixture();
    const requestDigest = canonicalSha256(
      "programmable.github-session-verification-request.v1",
      {
        audience: AUDIENCE,
        applicationId: HANDLE,
        operation: "read_application_status",
        sessionCredentialHash: rawSha256(TOKEN),
      },
    );
    const response = await handler(request({
      schemaVersion: "programmable.github-session-verification-request.v1",
      audience: AUDIENCE,
      applicationId: HANDLE,
      operation: "read_application_status",
      sessionCredential: TOKEN,
      requestDigest,
    }, requestDigest, workloadToken));
    expect(response.status).toBe(400);
  });

  it("signs the exact V3 handle request for the current numeric GitHub link", async () => {
    const { handler, publicKey, workloadToken } = fixture();
    const requestDigest = canonicalSha256(
      "programmable.github-session-verification-request.v3",
      {
        audience: AUDIENCE,
        applicationHandle: HANDLE,
        operation: "read_custom_launch_entitlement",
        sessionCredentialHash: rawSha256(TOKEN),
      },
    );
    const response = await handler(request({
      schemaVersion: "programmable.github-session-verification-request.v3",
      audience: AUDIENCE,
      applicationHandle: HANDLE,
      operation: "read_custom_launch_entitlement",
      sessionCredential: TOKEN,
      requestDigest,
    }, requestDigest, workloadToken));
    expect(response.status).toBe(200);
    const envelope = await response.json() as Record<string, unknown>;
    expect(envelope).toMatchObject({
      schemaVersion: "programmable.github-session-assertion.v3",
      audience: AUDIENCE,
      keyId: KEY_ID,
      keyEpoch: KEY_EPOCH,
      algorithm: "Ed25519",
      requestDigest,
      applicationHandle: HANDLE,
      operation: "read_custom_launch_entitlement",
      githubUserId: "312577473",
      sessionId: "privy-session-1",
      issuedAt: NOW.toISOString(),
      expiresAt: "2026-08-08T12:01:00.000Z",
    });
    expect(verifies(envelope, publicKey)).toBe(true);
  });

  it("caps the signer-vouched V3 read assertion at the verified access-JWT expiry", async () => {
    const expiration = Math.floor(NOW.getTime() / 1_000) + 30;
    const { handler, publicKey, workloadToken } = fixture(undefined, { expiration });
    const requestDigest = canonicalSha256(
      "programmable.github-session-verification-request.v3",
      {
        audience: AUDIENCE,
        applicationHandle: HANDLE,
        operation: "read_application_status",
        sessionCredentialHash: rawSha256(TOKEN),
      },
    );
    const response = await handler(request({
      schemaVersion: "programmable.github-session-verification-request.v3",
      audience: AUDIENCE,
      applicationHandle: HANDLE,
      operation: "read_application_status",
      sessionCredential: TOKEN,
      requestDigest,
    }, requestDigest, workloadToken));
    expect(response.status).toBe(200);
    const assertion = await response.json() as Record<string, unknown>;
    expect(assertion.expiresAt).toBe("2026-08-08T12:00:30.000Z");
    expect(verifies(assertion, publicKey)).toBe(true);
  });

  it("signs the launch-mutation request and binds fresh JWT and identity verification", async () => {
    const { handler, publicKey, workloadToken } = fixture();
    const canonicalRequest = canonicalizeJson({
      schemaVersion: "programmable.launch-session-challenge-create-request.v2",
      audience: "programmable.launch-session.v2",
      idempotencyKey: "canary-1",
    });
    const githubSessionCredentialHash = canonicalSha256(
      "programmable.github-launch-session-credential.v2",
      { credential: TOKEN },
    );
    const preimage = {
      schemaVersion: "programmable.github-launch-mutation-verification-request.v3",
      authorityAudience: AUDIENCE,
      audience: "programmable.launch-session.v2",
      operation: "launch-session:challenge:create",
      requestBindingHash: DIGEST_A,
      canonicalRequestHash: rawSha256(canonicalRequest),
      githubSessionCredentialHash,
      requiredCredentialState: "valid",
      requireFreshCredentialVerification: true,
    } as const;
    const requestDigest = canonicalSha256(
      "programmable.github-launch-mutation-verification-request.v3",
      preimage,
    );
    const response = await handler(request({
      ...preimage,
      requestDigest,
      canonicalRequest,
      sessionCredential: TOKEN,
    }, requestDigest, workloadToken));
    expect(response.status).toBe(200);
    const envelope = await response.json() as Record<string, unknown>;
    expect(envelope).toMatchObject({
      schemaVersion: "programmable.github-launch-mutation-assertion.v3",
      authorityAudience: AUDIENCE,
      audience: "programmable.launch-session.v2",
      operation: "launch-session:challenge:create",
      requestBindingHash: DIGEST_A,
      requestDigest,
      githubUserId: "312577473",
      githubSessionCredentialHash,
      appId: APP_ID,
      userId: "did:privy:user",
      sessionId: "privy-session-1",
      credentialIssuer: "privy.io",
      credentialIssuedAt: Math.floor(NOW.getTime() / 1_000) - 30,
      credentialExpiresAt: Math.floor(NOW.getTime() / 1_000) + 3_600,
      credentialVerifiedAt: NOW.toISOString(),
      issuedAt: NOW.toISOString(),
      expiresAt: "2026-08-08T12:01:00.000Z",
    });
    expect(verifies(envelope, publicKey)).toBe(true);
  });

  it("accepts the exact grant-reissue mutation after fresh credential verification", async () => {
    const { handler, publicKey, workloadToken } = fixture();
    const canonicalRequest = canonicalizeJson({
      schemaVersion: "programmable.browser-wallet-grant-reissue-request.v1",
    });
    const githubSessionCredentialHash = canonicalSha256(
      "programmable.github-launch-session-credential.v2",
      { credential: TOKEN },
    );
    const preimage = {
      schemaVersion: "programmable.github-launch-mutation-verification-request.v3",
      authorityAudience: AUDIENCE,
      audience: "programmable.launch-session.v2",
      operation: "launch-session:launch:reissue",
      requestBindingHash: DIGEST_A,
      canonicalRequestHash: rawSha256(canonicalRequest),
      githubSessionCredentialHash,
      requiredCredentialState: "valid",
      requireFreshCredentialVerification: true,
    } as const;
    const requestDigest = canonicalSha256(
      "programmable.github-launch-mutation-verification-request.v3",
      preimage,
    );
    const response = await handler(request({
      ...preimage,
      requestDigest,
      canonicalRequest,
      sessionCredential: TOKEN,
    }, requestDigest, workloadToken));
    expect(response.status).toBe(200);
    const assertion = await response.json() as Record<string, unknown>;
    expect(assertion).toMatchObject({
      schemaVersion: "programmable.github-launch-mutation-assertion.v3",
      operation: "launch-session:launch:reissue",
      credentialIssuer: "privy.io",
      credentialVerifiedAt: NOW.toISOString(),
    });
    expect(verifies(assertion, publicKey)).toBe(true);
  });

  it("accepts the exact launch-authority refresh mutation after fresh credential verification", async () => {
    const { handler, publicKey, workloadToken } = fixture();
    const idempotencyKey = "launch-authority-refresh:v1:test-canary";
    const authenticationRequest = {
      schemaVersion: "programmable.principal-launch-authority-refresh-authentication.v1",
      applicationHandle: HANDLE,
      idempotencyKeyHash: canonicalSha256(
        "programmable.principal-launch-authority-refresh-authentication-idempotency.v1",
        { applicationHandle: HANDLE, idempotencyKey },
      ),
    } as const;
    const canonicalRequest = canonicalizeJson(authenticationRequest);
    const githubSessionCredentialHash = canonicalSha256(
      "programmable.github-launch-session-credential.v2",
      { credential: TOKEN },
    );
    const requestBindingHash = canonicalSha256(
      "programmable.principal-launch-authority-refresh-authentication.v1",
      authenticationRequest,
    );
    const preimage = {
      schemaVersion: "programmable.github-launch-mutation-verification-request.v3",
      authorityAudience: AUDIENCE,
      audience: "programmable.launch-session.v2",
      operation: "launch-session:authority:refresh",
      requestBindingHash,
      canonicalRequestHash: rawSha256(canonicalRequest),
      githubSessionCredentialHash,
      requiredCredentialState: "valid",
      requireFreshCredentialVerification: true,
    } as const;
    const requestDigest = canonicalSha256(
      "programmable.github-launch-mutation-verification-request.v3",
      preimage,
    );
    const response = await handler(request({
      ...preimage,
      requestDigest,
      canonicalRequest,
      sessionCredential: TOKEN,
    }, requestDigest, workloadToken));
    expect(response.status).toBe(200);
    const assertion = await response.json() as Record<string, unknown>;
    expect(assertion).toMatchObject({
      schemaVersion: "programmable.github-launch-mutation-assertion.v3",
      operation: "launch-session:authority:refresh",
      requestBindingHash,
      credentialIssuer: "privy.io",
      credentialVerifiedAt: NOW.toISOString(),
    });
    expect(verifies(assertion, publicKey)).toBe(true);
  });

  it("fails closed for expired, future or foreign access-token claims", async () => {
    const list = principalApplicationListRequest();
    for (const identity of [
      { expiration: Math.floor(NOW.getTime() / 1_000) },
      { issuedAt: Math.floor(NOW.getTime() / 1_000) + 1 },
      { issuer: "foreign.example" },
    ]) {
      const rejected = fixture(undefined, identity);
      expect((await rejected.handler(request(
        list.body,
        list.requestDigest,
        rejected.workloadToken,
      ))).status).toBe(401);
    }
  });

  it("uses the credential-verification instant as issuedAt when handler time advances", async () => {
    let call = 0;
    const advancing = fixture(undefined, {
      now: () => new Date(NOW.getTime() + call++ * 250),
    });
    const list = principalApplicationListRequest();
    const response = await advancing.handler(request(
      list.body,
      list.requestDigest,
      advancing.workloadToken,
    ));
    expect(response.status).toBe(200);
    const assertion = await response.json() as Record<string, unknown>;
    expect(assertion.credentialVerifiedAt).toBe("2026-08-08T12:00:00.250Z");
    expect(assertion.issuedAt).toBe("2026-08-08T12:00:00.250Z");
    expect(Date.parse(assertion.expiresAt as string)).toBe(
      NOW.getTime() + 60_250,
    );
  });

  it("fails closed for request substitution, foreign tokens and ambiguous GitHub links", async () => {
    const valid = fixture();
    const requestDigest = canonicalSha256(
      "programmable.github-session-verification-request.v3",
      {
        audience: AUDIENCE,
        applicationHandle: HANDLE,
        operation: "read_application_status",
        sessionCredentialHash: rawSha256(TOKEN),
      },
    );
    const body = {
      schemaVersion: "programmable.github-session-verification-request.v3",
      audience: AUDIENCE,
      applicationHandle: HANDLE,
      operation: "read_application_status",
      sessionCredential: TOKEN,
      requestDigest,
    };
    expect((await valid.handler(request(
      { ...body, applicationHandle: `github-${"b".repeat(64)}` },
      requestDigest,
      valid.workloadToken,
    ))).status).toBe(400);
    expect((await valid.handler(request(
      { ...body, sessionCredential: "foreign-privy-access-token-value-123" },
      requestDigest,
      valid.workloadToken,
    ))).status).toBe(400);

    const ambiguous = fixture([
      { type: "github_oauth", subject: "312577473" },
      { type: "github_oauth", subject: "312577473" },
    ]);
    expect((await ambiguous.handler(request(
      body,
      requestDigest,
      ambiguous.workloadToken,
    ))).status).toBe(403);
    expect((await valid.handler(request(
      body,
      requestDigest,
      "invalid-workload-token-value",
    ))).status).toBe(401);
  });
});

function principalApplicationListRequest(): Readonly<{
  body: Readonly<Record<string, unknown>>;
  requestDigest: Sha256Digest;
}> {
  const canonicalTarget = `/v3/applications?limit=25&cursor=${LIST_CURSOR}`;
  const requestDigest = canonicalSha256(
    "programmable.principal-application-list-session-verification-request.v3",
    {
      audience: AUDIENCE,
      operation: "list_applications",
      filterHash: "all_owned_custom_launch_applications_v1",
      canonicalTarget,
      limit: 25,
      cursor: LIST_CURSOR,
      sessionCredentialHash: canonicalSha256(
        "programmable.github-session-credential.v1",
        { credential: TOKEN },
      ),
    },
  );
  return Object.freeze({
    body: Object.freeze({
      schemaVersion:
        "programmable.principal-application-list-session-verification-request.v3",
      audience: AUDIENCE,
      operation: "list_applications",
      filterHash: "all_owned_custom_launch_applications_v1",
      canonicalTarget,
      limit: 25,
      cursor: LIST_CURSOR,
      sessionCredential: TOKEN,
      requestDigest,
    }),
    requestDigest,
  });
}

function request(body: object, requestDigest: string, workloadToken: string): Request {
  return new Request(
    "https://programmable.market/api/internal/custom-launch/session-authority",
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${workloadToken}`,
        "content-type": "application/json",
        "x-programmable-request-digest": requestDigest,
      },
      body: canonicalizeJson(body as never),
    },
  );
}

function createWorkloadToken(privateKey: KeyObject): string {
  const encodedHeader = Buffer.from(canonicalizeJson({
    alg: "EdDSA",
    kid: "workload-access-v1",
    typ: "JWT",
  }), "utf8").toString("base64url");
  const encodedPayload = Buffer.from(canonicalizeJson({
    schemaVersion: "programmable.workload-access-token.v1",
    iss: "programmable-authority-token-broker-v1",
    sub: "approval-runtime-v1",
    aud: AUDIENCE,
    jti: "workload-token-1",
    iat: Math.floor(NOW.getTime() / 1_000) - 1,
    exp: Math.floor(NOW.getTime() / 1_000) + 120,
  }), "utf8").toString("base64url");
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = sign(null, Buffer.from(signingInput, "ascii"), privateKey)
    .toString("base64url");
  return `${signingInput}.${signature}`;
}

function verifies(envelope: Record<string, unknown>, publicKey: KeyObject): boolean {
  const { signature, ...unsigned } = envelope;
  return typeof signature === "string" && verify(
    null,
    Buffer.from(canonicalizeJson(unsigned as never), "utf8"),
    publicKey,
    Buffer.from(signature, "base64url"),
  );
}

function rawSha256(value: string | Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function digest(label: string): Sha256Digest {
  return rawSha256(label);
}
