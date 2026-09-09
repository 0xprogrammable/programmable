import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { getAddress, isAddress } from "viem";
import { MODULE_SUBMISSION_ID, MODULE_SUBMISSIONS_PAGE_SIZE, MODULE_SUBMISSIONS_SCHEMA, readWalletModuleSubmissions } from "@/lib/profile/module-submissions";
import { createPrivyWalletPrincipalAuthenticatorV1, WalletPrincipalAuthenticationErrorV1, type WalletPrincipalAuthenticatorV1 } from "../creator-article/wallet-principal.server";
import { createWalletAdminBffAssertionV2, requireWalletAdminBffAssertionKeyV2 } from "../custom-launch/wallet-admin-bff-assertion-v2";
import { discardBodyV1, readBoundedUtf8BodyV1 } from "../custom-launch/bounded-utf8-body-v1";
import { parseStrictJson } from "../projection-target/canonical-json";

const RESPONSE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  Vary: "Authorization, X-Privy-Identity-Token",
};
const MAXIMUM_BODY_BYTES = 65_536;

function response(status: number, value: unknown, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), { status, headers: { ...RESPONSE_HEADERS, ...extra } });
}

export function moduleSubmissionProfileError(status: number, code: string, extra: Record<string, string> = {}) {
  const requestId = randomUUID();
  return response(status, {
    schemaVersion: MODULE_SUBMISSIONS_SCHEMA,
    error: { code, requestId, message: status >= 500 ? "Module submissions are temporarily unavailable." : "The request could not be completed." },
  }, { ...extra, "X-Request-Id": requestId });
}

export function createModuleSubmissionProfileBridge(input: Readonly<{
  authenticator: WalletPrincipalAuthenticatorV1;
  backendBaseUrl: string;
  websiteToken: string;
  bffAssertionKeyV2: string;
  fetchBackend: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
  nonce?: () => string;
}>) {
  const base = new URL(input.backendBaseUrl);
  if ((base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname)))
    || base.username || base.password || base.search || base.hash
    || input.websiteToken.length < 43 || input.websiteToken.length > 512 || /\s|\u0000/u.test(input.websiteToken)) {
    throw new TypeError("Module submission bridge configuration is invalid.");
  }
  const key = requireWalletAdminBffAssertionKeyV2(input.bffAssertionKeyV2, input.websiteToken);
  const timeoutMs = input.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 8_000) throw new TypeError("Invalid submission timeout.");

  return Object.freeze({
    async list(request: Request): Promise<Response> {
      if (request.method !== "GET") return moduleSubmissionProfileError(405, "method_not_allowed", { Allow: "GET" });
      try {
        const query = new URL(request.url).searchParams;
        if ([...query.keys()].some(key => !["walletAddress", "cursor"].includes(key) || query.getAll(key).length !== 1)
          || request.body !== null) return moduleSubmissionProfileError(400, "request_schema_invalid");
        const requestedWallet = query.get("walletAddress");
        const cursor = query.get("cursor");
        if (!requestedWallet || !isAddress(requestedWallet) || (cursor !== null && !MODULE_SUBMISSION_ID.test(cursor))) {
          return moduleSubmissionProfileError(400, "request_schema_invalid");
        }
        const principal = await input.authenticator.authenticate(request);
        const walletAddress = getAddress(requestedWallet);
        if (!principal.wallets.some(wallet => wallet.toLowerCase() === walletAddress.toLowerCase())) {
          return moduleSubmissionProfileError(403, "wallet_not_linked");
        }
        const backendUrl = new URL("/v1/wallet-admin/module-submissions", base);
        backendUrl.searchParams.set("limit", String(MODULE_SUBMISSIONS_PAGE_SIZE));
        if (cursor !== null) backendUrl.searchParams.set("cursor", cursor);
        const assertion = createWalletAdminBffAssertionV2({
          method: "GET", requestTarget: `${backendUrl.pathname}${backendUrl.search}`,
          privyUserId: principal.privyUserId, walletAddress,
          issuedAt: (input.now?.() ?? new Date()).toISOString(),
          nonce: input.nonce?.() ?? randomBytes(16).toString("base64url"),
          bodyBytes: Buffer.alloc(0), assertionKey: key,
        });
        const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
        const backend = await input.fetchBackend(backendUrl, {
          method: "GET", cache: "no-store", redirect: "error", signal,
          headers: {
            Accept: "application/json", Authorization: `Bearer ${input.websiteToken}`,
            "X-Programmable-Privy-User-Id": principal.privyUserId,
            "X-Programmable-Wallet-Address": walletAddress,
            ...assertion,
          },
        });
        if (!backend.ok) {
          discardBodyV1(backend);
          if (backend.status === 429) {
            const retry = backend.headers.get("retry-after");
            return moduleSubmissionProfileError(429, "submission_rate_limit", retry && /^[1-9][0-9]{0,3}$/u.test(retry) ? { "Retry-After": retry } : {});
          }
          return moduleSubmissionProfileError(503, "module_submissions_unavailable");
        }
        if (!/^application\/json(?:\s*;|$)/iu.test(backend.headers.get("content-type") ?? "")) {
          discardBodyV1(backend);
          return moduleSubmissionProfileError(503, "module_submissions_unavailable");
        }
        const raw = await readBoundedUtf8BodyV1(backend, MAXIMUM_BODY_BYTES, { signal, timeoutMs });
        const data = readWalletModuleSubmissions(parseStrictJson(raw, { maximumBytes: MAXIMUM_BODY_BYTES, maximumDepth: 8 }), walletAddress);
        return response(200, data);
      } catch (error) {
        if (error instanceof WalletPrincipalAuthenticationErrorV1) return moduleSubmissionProfileError(error.status, error.code);
        return moduleSubmissionProfileError(503, "module_submissions_unavailable");
      }
    },
  });
}

let productionBridge: ReturnType<typeof createModuleSubmissionProfileBridge> | undefined;
export function getProductionModuleSubmissionProfileBridge() {
  productionBridge ??= createModuleSubmissionProfileBridge({
    authenticator: createPrivyWalletPrincipalAuthenticatorV1(),
    backendBaseUrl: process.env.PROGRAMMABLE_CUSTOM_LAUNCH_API_BASE_URL ?? "",
    websiteToken: process.env.PROGRAMMABLE_CUSTOM_LAUNCH_WEBSITE_TOKEN ?? "",
    bffAssertionKeyV2: process.env.PROGRAMMABLE_CUSTOM_LAUNCH_BFF_ASSERTION_KEY_V2 ?? "",
    fetchBackend: fetch,
  });
  return productionBridge;
}
