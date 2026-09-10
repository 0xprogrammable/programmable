import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createModuleReviewClient } from "../lib/server/module-mode/review-client";
import type { WalletPrincipalAuthenticatorV1 } from "../lib/server/creator-article/wallet-principal.server";
import { reviewDigest } from "../lib/module-mode/review-contract";
import { moduleSourceCorrectionFixture } from "./fixtures/module-source-correction";

vi.mock("server-only", () => ({}));
const SERVICE = "service_" + "a".repeat(48), KEY = "assert_" + "b".repeat(48), TIME = "2026-09-06T02:00:00.000Z", NONCE = "abcdefghijklmnopqrstuv";
function setup(options: { wallet?: string; linked?: boolean; committed?: boolean } = {}) {
  const f = moduleSourceCorrectionFixture(); const wallet = options.wallet ?? f.reviewer;
  let committed = options.committed ?? false;
  const fetchBackend = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/corrections")) {
      if (init?.method === "POST") { committed = true; return Response.json(f.receipt, { status: 201 }); }
      return committed ? Response.json({ ...f.receipt, created: false }) : Response.json({ error: { code: "MODULE_CORRECTION_NOT_FOUND" } }, { status: 404 });
    }
    if (url.pathname.includes(f.record.submissionId)) return Response.json(url.pathname.endsWith("/source") ? f.corrected : f.correctedDetail);
    return Response.json(url.pathname.endsWith("/source") ? f.source : f.originalDetail);
  });
  const client = createModuleReviewClient({ authenticator: { authenticate: vi.fn(async () => ({ privyUserId: "did:privy:correction-admin", privySessionId: "synthetic-correction-session", wallets: options.linked === false ? [] : [wallet] })) } as unknown as WalletPrincipalAuthenticatorV1,
    backendBaseUrl: "https://review.example.invalid", websiteToken: SERVICE, bffAssertionKeyV2: KEY, fetchBackend, now: () => new Date(TIME), nonce: () => NONCE });
  const post = (command: unknown = f.command, extra: object = {}) => new Request(`https://programmable.example/api/admin/modules/${f.subject.submissionId}/corrections`, { method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer synthetic_browser_token", "X-Programmable-Bff-Assertion-Signature": "forged-browser-signature" }, body: JSON.stringify({ walletAddress: wallet, command, ...extra }) });
  const read = (suffix = "", id = f.subject.submissionId) => new Request(`https://programmable.example/api/admin/modules/${id}${suffix}?walletAddress=${wallet}`);
  return { ...f, client, fetchBackend, wallet, post, read };
}
describe("Module admin source correction BFF", () => {
  it.each([{ linked: false }, { wallet: "0x2222222222222222222222222222222222222222" }])("requires the actual linked admin wallet before any upstream call: %j", async options => {
    const f = setup(options); const response = await f.client.handle(f.post(), "correction", f.subject.submissionId);
    expect(response.status).toBe(403); expect(f.fetchBackend).not.toHaveBeenCalled();
  });
  it("binds the exact correction bytes, method, target and authenticated editor while preserving attribution", async () => {
    const f = setup(); const response = await f.client.handle(f.post(), "correction", f.subject.submissionId);
    expect(response.status).toBe(201); expect(await response.json()).toEqual(f.receipt);
    const posts = f.fetchBackend.mock.calls.filter(([, init]) => init?.method === "POST"); expect(posts).toHaveLength(1);
    const [url, init] = posts[0]; const bytes = Buffer.from(init!.body as Uint8Array); const headers = new Headers(init!.headers);
    expect(JSON.parse(bytes.toString())).toEqual(f.command); expect(String(url)).toBe(`https://review.example.invalid/v1/wallet-admin/module-review/${f.subject.submissionId}/corrections`);
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const signed = `programmable.custom-launch-api.wallet-bff-assertion.v2\0POST\0/v1/wallet-admin/module-review/${f.subject.submissionId}/corrections\0did:privy:correction-admin\0${f.wallet}\0${TIME}\0${NONCE}\0${digest}`;
    expect(headers.get("X-Programmable-Bff-Assertion-Signature")).toBe(`hmac-sha256:${createHmac("sha256", KEY).update(signed).digest("hex")}`);
    expect(JSON.stringify(init)).not.toContain("synthetic_browser_token"); expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(f.receipt.sourceCorrection.author).not.toBe(f.wallet); expect(f.receipt.approved).toBe(false);
  });
  it.each(["attribution", "version", "revision", "hash", "unknownField"])("rejects changed %s before mutation", async kind => {
    const f = setup(); const command = structuredClone(f.command) as unknown as Record<string, unknown>;
    if (kind === "attribution") command.correctedBy = f.subject.author;
    if (kind === "version") command.version = "0.1.1";
    if (kind === "revision") command.expectedReviewRevision = 1;
    if (kind === "hash") (command.files as { expectedSha256: string }[])[0].expectedSha256 = "b".repeat(64);
    const response = await f.client.handle(f.post(command, kind === "unknownField" ? { accessToken: "do-not-forward" } : {}), "correction", f.subject.submissionId);
    expect([400, 409]).toContain(response.status); expect(f.fetchBackend.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });
  it("rejects streamed oversized correction input before forwarding it", async () => {
    const f = setup(); const response = await f.client.handle(f.post({ ...f.command, reason: "x".repeat(262_145) }), "correction", f.subject.submissionId);
    expect(response.status).toBe(413); expect(f.fetchBackend).not.toHaveBeenCalled();
  });
  it("recovers a committed same-key correction even after the parent revision advances", async () => {
    const f = setup({ committed: true }); f.originalDetail.job = { ...f.job, reviewRevision: f.job.reviewRevision + 3 };
    const response = await f.client.handle(f.post(), "correction", f.subject.submissionId);
    expect(response.status).toBe(200); expect((await response.json()).sourceCorrection).toEqual(f.record);
    expect(f.fetchBackend.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    const conflict = await f.client.handle(f.post({ ...f.command, reason: "Another correction must not reuse the earlier idempotency key." }), "correction", f.subject.submissionId);
    expect(conflict.status).toBe(409);
  });
  it("offers an authenticated reconciliation read and validates query selectors", async () => {
    const f = setup({ committed: true });
    const get = new Request(`${f.read("/corrections").url}&idempotencyKey=${encodeURIComponent(f.command.idempotencyKey)}`);
    const response = await f.client.handle(get, "correction-status", f.subject.submissionId);
    expect(response.status).toBe(200); expect((await response.json()).created).toBe(false);
    const wrong = new Request(get.url + "&correctedBy=" + f.subject.author);
    expect((await f.client.handle(wrong, "correction-status", f.subject.submissionId)).status).toBe(400);
  });
  it("rejects a correctly digested correction receipt that changes the original reward wallet", async () => {
    const f = setup({ committed: true }); const { correctionDigest: _digest, ...contents } = f.record;
    expect(_digest).toBe(f.receipt.sourceCorrection.correctionDigest);
    const changed = { ...contents, rewardWallet: f.wallet };
    f.receipt.sourceCorrection = { ...changed, correctionDigest: reviewDigest("programmable.modules.source-correction-record.v1", changed) };
    const response = await f.client.handle(f.post(), "correction", f.subject.submissionId);
    expect(response.status).toBe(502); expect(f.fetchBackend.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });
  it("does not accept a replay receipt whose version differs from the exact command", async () => {
    const f = setup({ committed: true }); const { correctionDigest: _digest, ...contents } = f.record;
    expect(_digest).toBe(f.receipt.sourceCorrection.correctionDigest);
    const changed = { ...contents, version: "0.1.2-pm.1" };
    f.receipt.sourceCorrection = { ...changed, correctionDigest: reviewDigest("programmable.modules.source-correction-record.v1", changed) };
    const response = await f.client.handle(f.post(), "correction", f.subject.submissionId);
    expect(response.status).toBe(502); expect(f.fetchBackend.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });
  it("exposes verified correction provenance in admin detail, bound to the new immutable source", async () => {
    const f = setup(); const response = await f.client.handle(f.read("", f.record.submissionId), "detail", f.record.submissionId);
    expect(response.status).toBe(200); expect((await response.json()).sourceCorrection).toEqual(f.record);
    f.correctedDetail.sourceCorrection = { ...f.record, requestDigest: f.subject.requestDigest };
    expect((await f.client.handle(f.read("", f.record.submissionId), "detail", f.record.submissionId)).status).toBe(502);
  });
});
