import { createHash, createHmac } from "node:crypto";
import { createServer } from "node:http";
import { brotliCompressSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { createModuleReviewClient } from "../lib/server/module-mode/review-client";
import { computeModuleReviewDecisionDigestV1, type ModuleReviewDecisionCommandV1, type ModuleReviewDecisionRecordV1 } from "../lib/server/module-mode/review-decision-wire-v1";
import type { WalletPrincipalAuthenticatorV1 } from "../lib/server/creator-article/wallet-principal.server";
import { moduleReviewAdminFixture } from "./fixtures/module-review-admin";
import { reviewDigest } from "../lib/module-mode/review-contract";
import { computeModuleModeHostManifestHash, createModuleModeAvailabilityReader, createModuleModeHostManifest, type ModuleModeHostReleaseIdentity } from "../lib/server/module-mode/catalog";
import { bindActiveModuleModeRelease, computeModuleModeReleaseDigest } from "../lib/module-mode/release";
import configuredRelease from "../config/module-mode/robinhood.preview.json";
import configuredCatalog from "../config/module-mode/catalog.json";

vi.mock("server-only", () => ({}));

const WEBSITE_TOKEN = "service_" + "a".repeat(48);
const ASSERTION_KEY = "assert_" + "b".repeat(48);
const TIME = "2026-09-06T02:00:00.000Z";
const NONCE = "abcdefghijklmnopqrstuv";
function setup(options: { wallet?: string; release?: boolean | "configured" } = {}) {
  const f = moduleReviewAdminFixture(); const wallet = options.wallet ?? f.reviewer;
  const authenticate = vi.fn(async () => ({ privyUserId: "did:privy:test-reviewer", privySessionId: "session-review", wallets: [wallet] }));
  const queue = { schemaVersion: "programmable.modules.review-queue.v1", jobs: [{ ...f.job, plan: null, artifact: null }], nextCursor: null };
  const detail = { schemaVersion: "programmable.modules.review-detail.v1", job: f.job, decisions: [] as ModuleReviewDecisionRecordV1[], attempts: f.detail.attempts };
  const sourceRaw = JSON.stringify(f.source, null, 2) + "\n";
  const fetchBackend = vi.fn<typeof fetch>(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/source")) return new Response(sourceRaw, { headers: { "Content-Type": "application/json" } });
    if (path.endsWith("/plan") && init?.method === "POST") return Response.json({ schemaVersion: "programmable.modules.review-plan-receipt.v1", job: { ...f.job, state: "queued", reviewRevision: 3, artifact: null }, approved: false, available: false }, { status: 202 });
    if (path.endsWith("/decisions") && init?.method === "POST") {
      const command = JSON.parse(Buffer.from(init.body as Uint8Array).toString()) as ModuleReviewDecisionCommandV1;
      const contents: Omit<ModuleReviewDecisionRecordV1, "decisionDigest"> = { schemaVersion: "programmable.modules.review-decision.v1", reviewerWallet: wallet, policyDigest: f.policyDigest, subject: f.subject, command, decidedAt: TIME, registryApproved: false, available: false };
      return Response.json({ schemaVersion: "programmable.modules.review-decision-receipt.v1", decision: { ...contents, decisionDigest: computeModuleReviewDecisionDigestV1(contents) } }, { status: 201 });
    }
    return Response.json(path.endsWith(f.subject.submissionId) ? detail : queue);
  });
  const client = createModuleReviewClient({ authenticator: { authenticate } as WalletPrincipalAuthenticatorV1, backendBaseUrl: "https://review.example.invalid", websiteToken: WEBSITE_TOKEN, bffAssertionKeyV2: ASSERTION_KEY, fetchBackend, now: () => new Date(TIME), nonce: () => NONCE,
    ...(options.release === "configured" ? {} : { releaseIdentity: options.release === false ? { enabled: false, status: "preview", releaseDigest: null } : f.release }) });
  const read = (suffix = "") => new Request(`https://programmable.example/api/admin/modules${suffix}?walletAddress=${wallet}`, { headers: { Authorization: "Bearer browser-private-token", "X-Programmable-Bff-Assertion-Signature": "forged-browser-value" } });
  const post = (suffix: string, body: object) => new Request(`https://programmable.example/api/admin/modules/${f.subject.submissionId}/${suffix}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer browser-private-token" }, body: JSON.stringify({ walletAddress: wallet, ...body }) });
  const command = (outcome: ModuleReviewDecisionCommandV1["outcome"] = "accept"): ModuleReviewDecisionCommandV1 => ({ schemaVersion: "programmable.modules.review-command.v1", submissionId: f.subject.submissionId, requestDigest: f.subject.requestDigest, expectedReviewRevision: 2, outcome, reason: "Synthetic review test only. Do not publish this fixture.", artifactDigest: outcome === "accept" ? f.artifact.artifactDigest : null, hostManifestHash: outcome === "accept" ? f.manifestHash : null, acknowledgedReviewAreas: outcome === "accept" ? f.artifact.reviewRequired : [] });
  return { ...f, wallet, authenticate, fetchBackend, client, read, post, command, queue, detail, sourceRaw };
}

describe("Module review admin BFF", () => {
  it("reads the review queue through a transport that compresses negotiated responses", async () => {
    const f = setup();
    const receivedEncodings: (string | undefined)[] = [];
    const server = createServer((request, response) => {
      receivedEncodings.push(request.headers["accept-encoding"]);
      const body = Buffer.from(JSON.stringify(f.queue));
      const compressed = request.headers["accept-encoding"] !== "identity";
      response.writeHead(200, { "Content-Type": "application/json", ...(compressed ? { "Content-Encoding": "br" } : {}) });
      response.end(compressed ? brotliCompressSync(body) : body);
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server has no TCP address");
      const client = createModuleReviewClient({ authenticator: { authenticate: f.authenticate } as WalletPrincipalAuthenticatorV1,
        backendBaseUrl: `http://127.0.0.1:${address.port}`, websiteToken: WEBSITE_TOKEN,
        bffAssertionKeyV2: ASSERTION_KEY, fetchBackend: fetch, now: () => new Date(TIME), nonce: () => NONCE });
      const result = await client.handle(f.read(), "list");
      expect(result.status).toBe(200);
      expect(await result.json()).toMatchObject({ schemaVersion: "programmable.modules.website-review-queue.v1", jobs: [{ state: "built" }] });
      expect(receivedEncodings).toEqual(["identity"]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
  it("still rejects a backend that returns an encoded response despite identity negotiation", async () => {
    const f = setup();
    f.fetchBackend.mockResolvedValue(Response.json(f.queue, { headers: { "Content-Encoding": "br" } }));
    const result = await f.client.handle(f.read(), "list");
    expect(result.status).toBe(502);
    expect(await result.json()).toEqual({ error: { code: "MODULE_REVIEW_RESPONSE_INVALID" } });
  });
  it("returns the lightweight private queue through a body-and-target-bound v2 assertion", async () => {
    const f = setup(); const request = new Request(`${f.read().url}&cursor=${f.subject.submissionId}`, { headers: f.read().headers });
    const result = await f.client.handle(request, "list"); expect(result.status).toBe(200);
    const data = await result.json(); expect(data).toMatchObject({ schemaVersion: "programmable.modules.website-review-queue.v1", jobs: [{ state: "built", build: null }] });
    expect(result.headers.get("Cache-Control")).toBe("no-store"); expect(JSON.stringify(data)).not.toContain(WEBSITE_TOKEN);
    const [url, init] = f.fetchBackend.mock.calls[0]; const headers = new Headers(init?.headers);
    expect(String(url)).toBe(`https://review.example.invalid/v1/wallet-admin/module-review?cursor=${f.subject.submissionId}`);
    expect(headers.get("Authorization")).toBe(`Bearer ${WEBSITE_TOKEN}`);
    const hash = `sha256:${createHash("sha256").update(Buffer.alloc(0)).digest("hex")}`;
    const signing = `programmable.custom-launch-api.wallet-bff-assertion.v2\0GET\0/v1/wallet-admin/module-review?cursor=${f.subject.submissionId}\0did:privy:test-reviewer\0${f.wallet}\0${TIME}\0${NONCE}\0${hash}`;
    expect(headers.get("X-Programmable-Bff-Assertion-Signature")).toBe(`hmac-sha256:${createHmac("sha256", ASSERTION_KEY).update(signing).digest("hex")}`);
    expect(JSON.stringify(init)).not.toContain("browser-private-token"); expect(init).toMatchObject({ redirect: "error", cache: "no-store" });
  });
  it("does not grant reviewer authority from an authenticated wallet alone", async () => {
    const f = setup(); f.fetchBackend.mockResolvedValue(Response.json({ error: { code: "MODULE_REVIEW_ADMIN_FORBIDDEN", message: WEBSITE_TOKEN } }, { status: 403 }));
    const result = await f.client.handle(f.read(), "list"); expect(result.status).toBe(403); expect(await result.text()).not.toContain(WEBSITE_TOKEN);
  });
  it("rejects an unlinked wallet before any backend read", async () => {
    const f = setup(); const result = await f.client.handle(new Request(f.read().url.replace(f.wallet, f.subject.author)), "list"); expect(result.status).toBe(403); expect(f.fetchBackend).not.toHaveBeenCalled();
  });
  it("binds detail to the verified source and preserves original download bytes", async () => {
    const f = setup(); const result = await f.client.handle(f.read(`/${f.subject.submissionId}`), "detail", f.subject.submissionId);
    expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ source: { descriptor: f.source.descriptor }, job: f.job, attempts: f.detail.attempts });
    const source = await f.client.handle(f.read(`/${f.subject.submissionId}/source`), "source", f.subject.submissionId);
    expect(source.status).toBe(200); expect(await source.text()).toBe(f.sourceRaw); expect(source.headers.get("Content-Disposition")).toContain("attachment");
  });
  it("rejects substituted source bytes", async () => {
    const f = setup(); const normal = f.fetchBackend.getMockImplementation()!;
    f.fetchBackend.mockImplementation(async (url, init) => String(url).endsWith("/source") ? Response.json({ ...f.source, files: f.source.files.map(file => ({ ...file, bytes: Buffer.from("substituted").toString("base64") })) }) : normal(url, init));
    const result = await f.client.handle(f.read(`/${f.subject.submissionId}`), "detail", f.subject.submissionId); expect(result.status).toBe(502);
  });
  it("never turns a source manifest hash into host approval and blocks unpinned releases", async () => {
    const f = setup({ release: false }); const result = await f.client.handle(f.post("manifest", { expectedReviewRevision: 2, hostManifestJson: JSON.stringify(f.manifest) }), "manifest", f.subject.submissionId);
    expect(result.status).toBe(409); expect(await result.json()).toEqual({ error: { code: "MODULE_REVIEW_HOST_RELEASE_UNAVAILABLE" } });
    expect(f.artifact.sourceManifestHash).not.toBe(f.manifestHash); expect(f.fetchBackend.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it("checks the canonical host manifest without publishing it", async () => {
    const f = setup(); const result = await f.client.handle(f.post("manifest", { expectedReviewRevision: 2, hostManifestJson: JSON.stringify(f.manifest) }), "manifest", f.subject.submissionId);
    expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ hostManifestHash: f.manifestHash, artifactDigest: f.artifact.artifactDigest, reviewRevision: 2 });
    expect(f.fetchBackend.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it("checks a private manifest against the real pending host identity without an active release", async () => {
    const f = setup({ release: "configured" });
    expect(configuredRelease.releaseDigest).toBe(computeModuleModeReleaseDigest(configuredRelease));
    expect(configuredRelease.lifecycleEvidenceDigest).toBeNull();
    expect(() => bindActiveModuleModeRelease(configuredRelease)).toThrow("release.enabled");
    // Only the host identity is real here; the source/build fixture remains synthetic and unapproved.
    const manifest = createModuleModeHostManifest({ release: configuredRelease as ModuleModeHostReleaseIdentity,
      definition: f.definition, nativeBinding: f.binding, descriptor: f.source.descriptor });
    const result = await f.client.handle(f.post("manifest", { expectedReviewRevision: 2, hostManifestJson: JSON.stringify(manifest) }), "manifest", f.subject.submissionId);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ hostManifestHash: computeModuleModeHostManifestHash(manifest), artifactDigest: f.artifact.artifactDigest });
    expect(f.fetchBackend.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it("keeps public launches disabled while the pending host identity permits private review", async () => {
    const authenticateRelease = vi.fn(async () => { throw new Error("A disabled preview must not authenticate as active"); });
    const fetchPublic = vi.fn<typeof fetch>(async () => { throw new Error("A disabled preview must not fetch publications"); });
    const read = createModuleModeAvailabilityReader({ releaseProfile: configuredRelease, catalogFile: configuredCatalog,
      collector: () => ({ authenticateRelease }), fetchPublic });
    const result = await read();
    expect(result.release).toBeNull();
    expect(result.catalog.length).toBeGreaterThan(0);
    expect(result.catalog.every(entry => entry.status === "preview" && !("nativeBinding" in entry))).toBe(true);
    expect(authenticateRelease).not.toHaveBeenCalled();
    expect(fetchPublic).not.toHaveBeenCalled();
  });
  it.each(["type", "order"] as const)("rejects an internally canonical host manifest whose ABI %s differs from the built plan", async kind => {
    const f = setup(); const manifest = structuredClone(f.manifest);
    const mapping = structuredClone(f.plan.programAbi);
    if (kind === "type") mapping[0].type = "uint256";
    else mapping.reverse();
    manifest.manifest.configuration.abiMapping = mapping;
    manifest.manifest.catalogDefinition.programAbi = mapping;
    const manifestJson = JSON.stringify(manifest);
    const checked = await f.client.handle(f.post("manifest", { expectedReviewRevision: 2, hostManifestJson: manifestJson }), "manifest", f.subject.submissionId);
    expect(checked.status).toBe(400);
    expect(await checked.json()).toEqual({ error: { code: "MODULE_REVIEW_MANIFEST_ABI_MISMATCH" } });
    const command = { ...f.command(), hostManifestHash: computeModuleModeHostManifestHash(manifest) };
    const decision = await f.client.handle(f.post("decisions", { command, hostManifestJson: manifestJson }), "decision", f.subject.submissionId);
    expect(decision.status).toBe(400);
    expect(f.fetchBackend.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it("records an exact accepted review and rechecks the manifest on the final POST", async () => {
    const f = setup(); const command = f.command(); const result = await f.client.handle(f.post("decisions", { command, hostManifestJson: JSON.stringify(f.manifest) }), "decision", f.subject.submissionId);
    expect(result.status).toBe(201); expect(await result.json()).toMatchObject({ decision: { command, reviewerWallet: f.wallet, available: false, registryApproved: false } });
    const calls = f.fetchBackend.mock.calls.filter(([, init]) => init?.method === "POST"); expect(calls).toHaveLength(1);
    const bytes = Buffer.from(calls[0][1]?.body as Uint8Array); expect(JSON.parse(bytes.toString())).toEqual(command);
    expect(new Headers(calls[0][1]?.headers).get("X-Programmable-Bff-Assertion-Body-Sha256")).toBe(`sha256:${createHash("sha256").update(bytes).digest("hex")}`);
  });
  it.each(["running", "build_failed", "changes_requested", "accepted", "rejected"] as const)("does not approve the %s state even with an attached successful artifact", async state => {
    const f = setup(); f.detail.job = { ...f.job, state };
    const result = await f.client.handle(f.post("decisions", { command: f.command(), hostManifestJson: JSON.stringify(f.manifest) }), "decision", f.subject.submissionId);
    expect(result.status).toBe(409);
    expect(f.fetchBackend.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it("does not approve a build with unsuccessful checks", async () => {
    const f = setup(); const { artifactDigest: _oldDigest, ...contents } = f.artifact;
    expect(_oldDigest).toBe(f.job.artifact?.artifactDigest);
    const changed = { ...contents, tests: { ...contents.tests, allRequiredChecksPassed: false } };
    const artifact = { ...changed, artifactDigest: reviewDigest("programmable.modules.native-build.v1", changed) };
    f.detail.job = { ...f.job, artifact };
    const result = await f.client.handle(f.post("decisions", { command: { ...f.command(), artifactDigest: artifact.artifactDigest }, hostManifestJson: JSON.stringify(f.manifest) }), "decision", f.subject.submissionId);
    expect(result.status).toBe(409);
    expect(f.fetchBackend.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it.each(["hash", "acknowledgements", "revision", "manifest"])("rejects approval with changed %s before mutation", async kind => {
    const f = setup(); const command = { ...f.command() }; const manifest = structuredClone(f.manifest);
    if (kind === "hash") command.hostManifestHash = f.artifact.sourceManifestHash;
    if (kind === "acknowledgements") command.acknowledgedReviewAreas = [];
    if (kind === "revision") command.expectedReviewRevision = 1;
    if (kind === "manifest") manifest.manifest.catalogDefinition.summary = "Changed after preview";
    const result = await f.client.handle(f.post("decisions", { command, hostManifestJson: JSON.stringify(manifest) }), "decision", f.subject.submissionId);
    expect([400, 409]).toContain(result.status); expect(f.fetchBackend.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it("forbids author self-review even when the backend authenticated reads succeed", async () => {
    const base = moduleReviewAdminFixture(); const f = setup({ wallet: base.subject.author });
    const result = await f.client.handle(f.post("decisions", { command: f.command("reject"), hostManifestJson: null }), "decision", f.subject.submissionId);
    expect(result.status).toBe(403); expect(f.fetchBackend.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it("requires no host pins for a request-changes decision", async () => {
    const f = setup({ release: false }); const result = await f.client.handle(f.post("decisions", { command: f.command("request_changes"), hostManifestJson: null }), "decision", f.subject.submissionId);
    expect(result.status).toBe(201);
  });
  it("queues only a validated explicit plan bound to the current revision", async () => {
    const f = setup(); const result = await f.client.handle(f.post("plan", { expectedReviewRevision: 2, planJson: JSON.stringify(f.plan) }), "plan", f.subject.submissionId);
    expect(result.status).toBe(202); const calls = f.fetchBackend.mock.calls.filter(([, init]) => init?.method === "POST"); expect(calls).toHaveLength(1);
    expect(JSON.parse(Buffer.from(calls[0][1]?.body as Uint8Array).toString())).toEqual({ expectedReviewRevision: 2, plan: f.plan });
  });
  it("does not forward invalid plan controls, duplicate JSON keys, or extra query selectors", async () => {
    const f = setup(); const badPlan = await f.client.handle(f.post("plan", { expectedReviewRevision: 2, planJson: JSON.stringify({ ...f.plan, shell: "sh" }) }), "plan", f.subject.submissionId); expect(badPlan.status).toBe(400);
    const request = new Request(f.read().url + "&cursor=x&cursor=y"); expect((await f.client.handle(request, "list")).status).toBe(400);
    const duplicate = new Request(`https://programmable.example/api/admin/modules/${f.subject.submissionId}/plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: `{"walletAddress":"${f.wallet}","walletAddress":"${f.subject.author}"}` });
    expect((await f.client.handle(duplicate, "plan", f.subject.submissionId)).status).toBe(400); expect(f.fetchBackend.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it("fails closed when a decision receipt claims publication or changes its digest", async () => {
    const f = setup(); const normal = f.fetchBackend.getMockImplementation()!;
    f.fetchBackend.mockImplementation(async (url, init) => { const result = await normal(url, init); if (init?.method !== "POST") return result;
      const value = await result.json(); value.decision.available = true; return Response.json(value, { status: 201 }); });
    const result = await f.client.handle(f.post("decisions", { command: f.command("reject"), hostManifestJson: null }), "decision", f.subject.submissionId); expect(result.status).toBe(502);
  });
});
