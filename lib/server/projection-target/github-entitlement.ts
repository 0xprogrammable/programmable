import "server-only";

import { PrivyClient } from "@privy-io/node";

import {
  canonicalizeJson,
  parseStrictJson,
  type JsonValue,
} from "./canonical-json";
import {
  canonicalSha256,
  type Sha256Digest,
} from "./hashing";
import type {
  AuthenticatedWebsiteEntitlementSummaryV1,
  PostgresProjectionTargetAtomicStoreV1,
} from "./postgres-store";
import {
  getProductionWebsiteProjectionTargetV1,
} from "./website-target";

const GITHUB_USER_ID = /^[1-9][0-9]{0,19}$/u;
const MAXIMUM_PRIVY_TOKEN_BYTES = 131_072;

export interface AuthenticatedGitHubPrincipalV1 {
  readonly privyUserId: string;
  readonly githubUserId: string;
  readonly githubUsername: string | null;
  readonly githubPrincipalHash: Sha256Digest;
}

export interface WebsiteEntitlementReadAuthenticatorV1 {
  authenticate(request: Request): Promise<AuthenticatedGitHubPrincipalV1>;
}

export interface PrivyGitHubAuthorityBoundaryV1 {
  verifyAccessToken(token: string): Promise<Readonly<{
    appId: string;
    userId: string;
    sessionId: string;
  }>>;
  verifyIdentityToken(token: string): Promise<Readonly<{
    userId: string;
    sessionId: string;
  }>>;
  getCurrentUser(userId: string): Promise<Readonly<{
    id: string;
    linkedAccounts: readonly Readonly<{
      type: string;
      subject?: string;
      username?: string | null;
    }>[];
  }>>;
}

export function createAuthenticatedWebsiteEntitlementReadHandlerV1(
  input: Readonly<{
    authenticator: WebsiteEntitlementReadAuthenticatorV1;
    store: PostgresProjectionTargetAtomicStoreV1;
    now?: () => Date;
  }>,
): (request: Request) => Promise<Response> {
  if (
    input.authenticator === null
    || typeof input.authenticator !== "object"
    || typeof input.authenticator.authenticate !== "function"
  ) throw new TypeError("website entitlement authenticator is invalid");
  if (!(input.store instanceof Object)) {
    throw new TypeError("website entitlement store is invalid");
  }
  if (input.now !== undefined && typeof input.now !== "function") {
    throw new TypeError("website entitlement clock is invalid");
  }
  const now = input.now ?? (() => new Date());

  return async function authenticatedWebsiteEntitlementRead(
    request: Request,
  ): Promise<Response> {
    if (request.method !== "GET") {
      return errorResponse(405, "method_not_allowed", "GET");
    }
    const url = new URL(request.url);
    if (
      url.username !== ""
      || url.password !== ""
      || url.search !== ""
      || url.hash !== ""
    ) return errorResponse(400, "invalid_request");
    if (request.headers.get("accept")?.trim().toLowerCase()
      !== "application/json") {
      return errorResponse(406, "json_response_required");
    }

    let principal: AuthenticatedGitHubPrincipalV1;
    try {
      principal = await input.authenticator.authenticate(request);
    } catch (error) {
      if (error instanceof GitHubPrincipalAuthenticationErrorV1) {
        return errorResponse(error.status, error.code);
      }
      return errorResponse(401, "authentication_rejected");
    }

    try {
      const entitlements =
        await input.store.findActiveWebsiteEntitlementsByPrincipal({
          githubUserId: principal.githubUserId,
          githubPrincipalHash: principal.githubPrincipalHash,
          now: now(),
          signal: request.signal,
        });
      return jsonResponse(200, {
        schemaVersion: "programmable.authenticated-website-entitlements.v1",
        subject: {
          provider: "github",
          githubUserId: principal.githubUserId,
          githubUsername: principal.githubUsername,
          githubPrincipalHash: principal.githubPrincipalHash,
        },
        entitlements,
        launchAuthority: false,
        nextAction: entitlements.length > 0
          ? "request_launch_permit"
          : "wait_for_approved_submission",
      });
    } catch {
      return errorResponse(503, "entitlement_store_unavailable");
    }
  };
}

let productionHandler: ((request: Request) => Promise<Response>) | null = null;

export async function handleProductionAuthenticatedWebsiteEntitlementReadV1(
  request: Request,
): Promise<Response> {
  try {
    if (productionHandler === null) {
      const target = getProductionWebsiteProjectionTargetV1();
      await target.assertProductionReadiness();
      productionHandler = createAuthenticatedWebsiteEntitlementReadHandlerV1({
        authenticator: createPrivyGitHubPrincipalAuthenticatorV1(),
        store: target.store,
      });
    }
    return await productionHandler(request);
  } catch {
    return errorResponse(503, "entitlement_service_unavailable");
  }
}

export function createPrivyGitHubPrincipalAuthenticatorV1():
WebsiteEntitlementReadAuthenticatorV1 {
  const appId = requiredEnvironment("NEXT_PUBLIC_PRIVY_APP_ID");
  const appSecret = requiredEnvironment("PRIVY_APP_SECRET");
  const privy = new PrivyClient({ appId, appSecret });

  return createPrivyGitHubPrincipalAuthenticatorFromBoundaryV1({
    appId,
    boundary: Object.freeze({
      async verifyAccessToken(token: string) {
        const value = await privy.utils().auth().verifyAccessToken(token);
        return Object.freeze({
          appId: value.app_id,
          userId: value.user_id,
          sessionId: value.session_id,
        });
      },
      async verifyIdentityToken(token: string) {
        const user = await privy.users().get({ id_token: token });
        const claims = verifiedIdentitySessionClaims(token);
        if (claims.userId !== user.id) {
          throw new TypeError("Privy identity subject mismatch");
        }
        return claims;
      },
      async getCurrentUser(userId: string) {
        const user = await privy.users()._get(userId);
        return Object.freeze({
          id: user.id,
          linkedAccounts: Object.freeze(user.linked_accounts.map((account) =>
            Object.freeze({
              type: account.type,
              ...(account.type === "github_oauth"
                ? { subject: account.subject, username: account.username }
                : {}),
            }))),
        });
      },
    }),
  });
}

export function createPrivyGitHubPrincipalAuthenticatorFromBoundaryV1(
  input: Readonly<{
    appId: string;
    boundary: PrivyGitHubAuthorityBoundaryV1;
  }>,
): WebsiteEntitlementReadAuthenticatorV1 {
  if (!input.appId || typeof input.boundary?.verifyAccessToken !== "function"
    || typeof input.boundary.verifyIdentityToken !== "function"
    || typeof input.boundary.getCurrentUser !== "function") {
    throw new TypeError("Privy GitHub authority boundary is invalid");
  }

  return Object.freeze({
    async authenticate(request: Request): Promise<AuthenticatedGitHubPrincipalV1> {
      const accessToken = bearerToken(request.headers.get("authorization"));
      const identityToken = boundedToken(
        request.headers.get("x-privy-identity-token"),
        "identity token",
      );
      let access;
      let identity;
      let user;
      try {
        [access, identity] = await Promise.all([
          input.boundary.verifyAccessToken(accessToken),
          input.boundary.verifyIdentityToken(identityToken),
        ]);
        if (
          access.userId !== identity.userId
          || access.sessionId !== identity.sessionId
          || access.appId !== input.appId
        ) throw new TypeError("Privy token binding mismatch");
        user = await input.boundary.getCurrentUser(access.userId);
      } catch {
        throw new GitHubPrincipalAuthenticationErrorV1(
          401,
          "privy_session_rejected",
        );
      }
      if (access.userId !== user.id) {
        throw new GitHubPrincipalAuthenticationErrorV1(
          401,
          "privy_identity_mismatch",
        );
      }
      const githubAccounts = user.linkedAccounts.filter(
        (account): account is Readonly<{
          type: "github_oauth";
          subject: string;
          username?: string | null;
        }> => account.type === "github_oauth"
          && typeof account.subject === "string",
      );
      const githubSubjects = new Set(githubAccounts.map(({ subject }) => subject));
      if (githubAccounts.length < 1) {
        throw new GitHubPrincipalAuthenticationErrorV1(
          403,
          "github_account_required",
        );
      }
      if (githubAccounts.length !== 1 || githubSubjects.size !== 1) {
        throw new GitHubPrincipalAuthenticationErrorV1(
          403,
          "github_identity_ambiguous",
        );
      }
      const account = githubAccounts[0]!;
      const githubUserId = account.subject;
      if (!GITHUB_USER_ID.test(githubUserId)) {
        throw new GitHubPrincipalAuthenticationErrorV1(
          403,
          "github_identity_invalid",
        );
      }
      return Object.freeze({
        privyUserId: user.id,
        githubUserId,
        githubUsername: account.username ?? null,
        githubPrincipalHash: canonicalSha256(
          "programmable.github-submitter-principal.v1",
          { githubUserId },
        ),
      });
    },
  });
}

export class GitHubPrincipalAuthenticationErrorV1 extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: string,
  ) {
    super(code);
    this.name = "GitHubPrincipalAuthenticationErrorV1";
  }
}

function bearerToken(value: string | null): string {
  if (!value?.startsWith("Bearer ")) {
    throw new GitHubPrincipalAuthenticationErrorV1(401, "session_required");
  }
  return boundedToken(value.slice("Bearer ".length), "access token");
}

function boundedToken(value: string | null, label: string): string {
  if (
    value === null
    || value.length < 20
    || Buffer.byteLength(value, "utf8") > MAXIMUM_PRIVY_TOKEN_BYTES
    || /[\s\u0000]/u.test(value)
  ) {
    throw new GitHubPrincipalAuthenticationErrorV1(
      401,
      `${label.replaceAll(" ", "_")}_invalid`,
    );
  }
  return value;
}

function verifiedIdentitySessionClaims(token: string): Readonly<{
  userId: string;
  sessionId: string;
}> {
  const segments = token.split(".");
  if (segments.length !== 3 || segments[1] === undefined) {
    throw new TypeError("Privy identity token is invalid");
  }
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.from(segments[1], "base64url"),
    );
  } catch {
    throw new TypeError("Privy identity token is invalid");
  }
  const payload = jsonRecord(
    parseStrictJson(decoded, {
      maximumBytes: MAXIMUM_PRIVY_TOKEN_BYTES,
      maximumDepth: 16,
    }),
    "Privy identity token payload",
  );
  if (
    typeof payload.sub !== "string"
    || typeof payload.sid !== "string"
    || payload.sub.length < 1
    || payload.sid.length < 1
    || payload.sub.length > 512
    || payload.sid.length > 512
  ) throw new TypeError("Privy identity token session is invalid");
  return Object.freeze({ userId: payload.sub, sessionId: payload.sid });
}

function jsonRecord(
  value: JsonValue,
  label: string,
): Readonly<Record<string, JsonValue>> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is not configured`);
  return value;
}

function jsonResponse(
  status: number,
  body: Readonly<Record<string, unknown>>,
  allow?: string,
): Response {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    vary: "authorization, x-privy-identity-token",
  });
  if (allow !== undefined) headers.set("allow", allow);
  return new Response(canonicalizeJson(body), { status, headers });
}

function errorResponse(status: number, code: string, allow?: string): Response {
  return jsonResponse(status, {
    schemaVersion: "programmable.authenticated-website-entitlement-error.v1",
    code,
  }, allow);
}

export type { AuthenticatedWebsiteEntitlementSummaryV1 };
