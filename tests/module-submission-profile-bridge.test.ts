import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createModuleSubmissionProfileBridge } from "../lib/server/module-mode/submission-profile-bridge";
import { WalletPrincipalAuthenticationErrorV1 } from "../lib/server/creator-article/wallet-principal.server";
import { MODULE_SUBMISSIONS_SCHEMA } from "../lib/profile/module-submissions";

const owner = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const id = "40000000-0000-4000-8000-000000000004";
const websiteToken = "w".repeat(43);
const key = "k".repeat(43);
const now = "2026-09-09T10:00:00.000Z";

function submission() {
  return { submissionId: id, packageId: `0x${"ab".repeat(32)}`, familySalt: `0x${"cd".repeat(32)}`,
    name: "Stock pair", version: "1.0.0", author: owner, rewardWallet: other, createdAt: now,
    review: { state: "changes_requested", revision: 2, attempt: 1, updatedAt: now,
      latestDecision: { outcome: "request_changes", reason: "Handle the missing price response before placing an order.", decidedAt: now }, nextAction: "submit_new_version" },
    registryApproved: false, available: false };
}
function page(items: unknown[] = [submission()], nextCursor: string | null = null) {
  return { schemaVersion: MODULE_SUBMISSIONS_SCHEMA, submissions: items, nextCursor };
}
function setup(body: unknown = page()) {
  const authenticate = vi.fn().mockResolvedValue({ privyUserId: "did:privy:profile-test", privySessionId: "test-session", wallets: [owner] });
  const fetchBackend = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body));
  const bridge = createModuleSubmissionProfileBridge({ authenticator: { authenticate }, backendBaseUrl: "https://api.example.test", websiteToken,
    bffAssertionKeyV2: key, fetchBackend, now: () => new Date(now), nonce: () => "n".repeat(22) });
  return { authenticate, fetchBackend, bridge };
}
function request(query = `walletAddress=${owner}`) {
  return new Request(`https://programmable.market/api/profile/module-submissions?${query}`, { headers: { Authorization: "Bearer test-access-token", "X-Privy-Identity-Token": "test-identity-token" } });
}

describe("private module submission profile", () => {
  it("reads only after wallet authentication and sends the exact signed backend route", async () => {
    const { bridge, fetchBackend, authenticate } = setup();
    const incoming = request();
    const response = await bridge.list(incoming);
    expect(authenticate).toHaveBeenCalledWith(incoming);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(page());
    const [url, init] = fetchBackend.mock.calls[0]!;
    expect(String(url)).toBe("https://api.example.test/v1/wallet-admin/module-submissions?limit=5");
    expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${websiteToken}`);
    expect(headers.get("x-programmable-wallet-address")).toBe(owner);
    expect(headers.get("x-programmable-bff-assertion-version")).toBe("2");
    expect(headers.get("x-programmable-bff-assertion-signature")).toMatch(/^hmac-sha256:[a-f0-9]{64}$/u);
    expect(headers.get("x-privy-identity-token")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Authorization, X-Privy-Identity-Token");
  });

  it("never contacts the backend for an unlinked wallet or expired session", async () => {
    const { bridge, fetchBackend, authenticate } = setup();
    expect((await bridge.list(request(`walletAddress=${other}`))).status).toBe(403);
    authenticate.mockRejectedValue(new WalletPrincipalAuthenticationErrorV1(401, "privy_session_rejected"));
    const response = await bridge.list(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchBackend).not.toHaveBeenCalled();
  });

  it("rejects backend records owned by someone else even when the reward wallet matches", async () => {
    const body = page([{ ...submission(), author: other, rewardWallet: owner }]);
    const response = await setup(body).bridge.list(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("Stock pair");
  });

  it("does not forward extra backend fields, oversized feedback or raw upstream errors", async () => {
    for (const body of [page([{ ...submission(), principalId: "private-principal" }]), page([{ ...submission(), review: { ...submission().review, latestDecision: { outcome: "request_changes", reason: "x".repeat(5000), decidedAt: now } } }])]) {
      const response = await setup(body).bridge.list(request());
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("private-principal");
    }
    const { bridge, fetchBackend } = setup();
    fetchBackend.mockResolvedValue(new Response("private backend diagnostic", { status: 500 }));
    expect(await (await bridge.list(request())).text()).not.toContain("private backend diagnostic");
    fetchBackend.mockResolvedValue(new Response("x".repeat(65_537), { headers: { "content-type": "application/json" } }));
    expect((await bridge.list(request())).status).toBe(503);
  });

  it("preserves unavailable review and approved-but-unpublished states", async () => {
    const row = submission();
    for (const review of [null, { ...row.review, state: "accepted", latestDecision: { ...row.review.latestDecision, outcome: "accept" }, nextAction: "await_registry_admission" }]) {
      const response = await setup(page([{ ...row, review }])).bridge.list(request());
      expect(response.status).toBe(200);
      const actual = (await response.json()).submissions[0];
      expect(actual.review).toEqual(review);
      expect(actual.available).toBe(false);
      expect(actual.registryApproved).toBe(false);
    }
  });

  it("accepts a bounded page and binds the opaque cursor into the signed request", async () => {
    const items = Array.from({ length: 5 }, (_, index) => ({ ...submission(), submissionId: `40000000-0000-4000-8000-00000000000${index}` }));
    const { bridge, fetchBackend } = setup(page(items, items[4].submissionId));
    expect((await bridge.list(request(`walletAddress=${owner}&cursor=${id}`))).status).toBe(200);
    expect(String(fetchBackend.mock.calls[0]?.[0])).toContain(`limit=5&cursor=${id}`);
    for (const query of [`walletAddress=${owner}&walletAddress=${other}`, `walletAddress=${owner}&limit=100`, `walletAddress=${owner}&cursor=invalid`]) {
      expect((await bridge.list(request(query))).status).toBe(400);
    }
    expect(fetchBackend).toHaveBeenCalledTimes(1);
    expect((await setup(page([...items, submission()])).bridge.list(request())).status).toBe(503);
  });
});
