import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import frozen from "./fixtures/module-engine-review-build.json";
import configuredNativeRelease from "../config/module-mode/robinhood.preview.json";
import { fixture as engineClientFixture } from "./module-engine-fixture";
import { moduleReviewAdminFixture } from "./fixtures/module-review-admin";
import { WEBSITE_ADMIN_WALLET } from "../lib/admin-access";
import { computeModuleEngineHostManifestHash, computeModuleEngineReleaseDigest, type ModuleEngineCatalogDefinition } from "../lib/module-engine/catalog";
import { createReviewedModuleEngineManifest } from "../lib/module-mode/review-engine-manifest";
import type { ModuleEngineBuildArtifactV1, ModuleEngineBuildPlanV1 } from "../lib/module-mode/review-engine-types";
import { parseReviewSubject, type ReviewJob } from "../lib/module-mode/review-contract";
import { computeModuleModeHostManifestHash, createModuleModeHostManifest, type ModuleModeHostReleaseIdentity } from "../lib/server/module-mode/catalog";
import { computeModuleReviewDecisionDigestV1, type ModuleReviewDecisionCommandV1, type ModuleReviewDecisionRecordV1 } from "../lib/server/module-mode/review-decision-wire-v1";

const installed = vi.hoisted(() => ({ engine: null as unknown, authenticate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/config/module-engine/review-release.json", () => ({ get default() { return installed.engine; } }));
vi.mock("@/lib/server/creator-article/wallet-principal.server", () => ({
  createPrivyWalletPrincipalAuthenticatorV1: () => ({ authenticate: installed.authenticate }),
  WalletPrincipalAuthenticationErrorV1: class extends Error {},
}));

const reviewer = WEBSITE_ADMIN_WALLET.toLowerCase() as `0x${string}`;
const serviceToken = `service_${"a".repeat(48)}`;

// Existing synthetic compiler/parser fixtures only; no deployment, review or publication evidence.
function engineReviewFixture() {
  const source = structuredClone(frozen.source), subject = parseReviewSubject(frozen.subject);
  const plan = structuredClone(frozen.plan) as ModuleEngineBuildPlanV1;
  const artifact = structuredClone(frozen.artifact) as ModuleEngineBuildArtifactV1;
  const job: ReviewJob = { subject, state: "built", reviewRevision: 2, plan, planDigest: artifact.planDigest, artifact,
    attempt: 1, lastError: null, createdAt: "2026-09-07T01:00:00.000Z", updatedAt: "2026-09-07T01:10:00.000Z" };
  const release = engineClientFixture().template.manifest.manifest.release;
  const definition: ModuleEngineCatalogDefinition = { id: "review-config-fixture", title: "Synthetic fixture", summary: "Synthetic review route test.",
    detail: "Never publish or admit this fixture.", version: source.descriptor.version, interface: "custom-v1", source: source.descriptor.source.files[0],
    schema: source.descriptor.configuration as ModuleEngineCatalogDefinition["schema"], defaults: { cap: "5" }, configurationAbi: artifact.configurationAbi, constraints: [] };
  const manifest = createReviewedModuleEngineManifest({ job, descriptor: source.descriptor as Parameters<typeof createReviewedModuleEngineManifest>[0]["descriptor"], release, definition,
    revision: { packageId: artifact.packageId, familyId: artifact.familyId, fixedQuoteAsset: `0x${"0".repeat(40)}`, fixedConfigurationHash: `0x${"0".repeat(64)}`,
      initialOperationId: `0x${"0".repeat(64)}`, executionGas: artifact.executionGas, moneyRights: artifact.moneyRights, coinRights: 0,
      operationPermissions: [...artifact.operationPermissions], eligibleFamilies: [artifact.familyId] } });
  return { source, subject, artifact, job, release, manifest, manifestHash: computeModuleEngineHostManifestHash(manifest) };
}

function routeSetup(f: Pick<ReturnType<typeof engineReviewFixture>, "source" | "subject" | "job" | "artifact"> | ReturnType<typeof moduleReviewAdminFixture>) {
  const backend = vi.fn<typeof fetch>(async (url, init) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname.endsWith("/source")) return Response.json(f.source);
    if (pathname.endsWith("/decisions") && init?.method === "POST") {
      const command = JSON.parse(Buffer.from(init.body as Uint8Array).toString()) as ModuleReviewDecisionCommandV1;
      const record: Omit<ModuleReviewDecisionRecordV1, "decisionDigest"> = { schemaVersion: "programmable.modules.review-decision.v1", reviewerWallet: reviewer,
        policyDigest: `0x${"1".repeat(64)}`, subject: f.subject, command, decidedAt: "2026-09-07T02:00:00.000Z", registryApproved: false, available: false };
      return Response.json({ schemaVersion: "programmable.modules.review-decision-receipt.v1", decision: { ...record, decisionDigest: computeModuleReviewDecisionDigestV1(record) } }, { status: 201 });
    }
    return Response.json({ schemaVersion: "programmable.modules.review-detail.v1", job: f.job, decisions: [], attempts: [] });
  });
  vi.stubGlobal("fetch", backend);
  const post = async (kind: "manifest" | "decision", body: Record<string, unknown>) => {
    const route = kind === "manifest" ? await import("../app/api/admin/modules/[id]/manifest/route") : await import("../app/api/admin/modules/[id]/decisions/route");
    return route.POST(new Request(`https://programmable.market/api/admin/modules/${f.subject.submissionId}/${kind}`, { method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer synthetic-test-session" }, body: JSON.stringify({ walletAddress: reviewer, ...body }) }),
    { params: Promise.resolve({ id: f.subject.submissionId }) });
  };
  const manifest = (value: unknown, extra: Record<string, unknown> = {}) => post("manifest", { expectedReviewRevision: 2, hostManifestJson: JSON.stringify(value), ...extra });
  const accept = (value: unknown, hostManifestHash: `0x${string}`) => post("decision", { hostManifestJson: JSON.stringify(value), command: {
    schemaVersion: "programmable.modules.review-command.v1", submissionId: f.subject.submissionId, requestDigest: f.subject.requestDigest, expectedReviewRevision: 2,
    outcome: "accept", reason: "Synthetic fixture; never publish.", artifactDigest: f.artifact.artifactDigest, hostManifestHash, acknowledgedReviewAreas: f.artifact.reviewRequired,
  } });
  return { backend, manifest, accept };
}

beforeEach(() => {
  vi.resetModules(); installed.engine = null;
  installed.authenticate.mockReset().mockResolvedValue({ privyUserId: "did:privy:test-reviewer", privySessionId: "test-session", wallets: [reviewer] });
  vi.stubEnv("PROGRAMMABLE_CUSTOM_LAUNCH_API_BASE_URL", "https://review.example.invalid");
  vi.stubEnv("PROGRAMMABLE_CUSTOM_LAUNCH_WEBSITE_TOKEN", serviceToken);
  vi.stubEnv("PROGRAMMABLE_CUSTOM_LAUNCH_BFF_ASSERTION_KEY_V2", `assert_${"b".repeat(48)}`);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("installed Engine review identity at the actual admin BFF routes", () => {
  it("uses the server identity for manifest checking and independently authenticated acceptance before catalogue activation", async () => {
    const f = engineReviewFixture(); installed.engine = f.release; const route = routeSetup(f);
    expect(f.release).not.toHaveProperty("status"); expect(f.release).not.toHaveProperty("lifecycleEvidenceDigest");
    const checked = await route.manifest(f.manifest);
    expect(checked.status).toBe(200); expect(await checked.json()).toMatchObject({ hostManifestHash: f.manifestHash, artifactDigest: f.artifact.artifactDigest });
    expect((await route.accept(f.manifest, f.manifestHash)).status).toBe(201);
    const writes = route.backend.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(writes).toHaveLength(1); expect(String(writes[0][0])).toBe(`https://review.example.invalid/v1/wallet-admin/module-review/${f.subject.submissionId}/decisions`);
    const headers = new Headers(writes[0][1]?.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${serviceToken}`);
    expect(headers.get("X-Programmable-Bff-Assertion-Signature")).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
    expect(installed.authenticate).toHaveBeenCalledTimes(2);
  });

  it("keeps null closed for Engine checks and acceptance even when the submitted manifest is valid", async () => {
    const f = engineReviewFixture(), route = routeSetup(f);
    for (const result of [await route.manifest(f.manifest), await route.accept(f.manifest, f.manifestHash)]) {
      expect(result.status).toBe(409); expect(await result.json()).toEqual({ error: { code: "MODULE_REVIEW_HOST_RELEASE_UNAVAILABLE" } });
    }
    expect(route.backend.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
    const { GET } = await import("../app/api/admin/modules/[id]/source/route");
    const source = await GET(new Request(`https://programmable.market/api/admin/modules/${f.subject.submissionId}/source?walletAddress=${reviewer}`), { params: Promise.resolve({ id: f.subject.submissionId }) });
    expect(source.status).toBe(200); expect(await source.json()).toEqual(f.source);
  });

  it("rejects a caller-selected source commit even after the caller recomputes a valid release digest", async () => {
    const f = engineReviewFixture(); installed.engine = f.release; const route = routeSetup(f), changed = structuredClone(f.manifest);
    const release = { ...changed.manifest.release, sourceCommit: "e".repeat(40) };
    changed.manifest.release = { ...release, releaseDigest: computeModuleEngineReleaseDigest(release) };
    expect((await route.manifest(changed)).status).toBe(400);
    expect((await route.manifest(f.manifest, { engineReleaseIdentity: f.release })).status).toBe(400);
    expect(route.backend.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it.each(["sourceVersion", "sourceCommit", "sourceUrl", "activation"])("strictly rejects invalid installed %s policy without forwarding acceptance", async field => {
    const f = engineReviewFixture();
    installed.engine = { ...f.release, ...(field === "sourceVersion" ? { sourceVersion: "module-mode-native-v1" }
      : field === "sourceCommit" ? { sourceCommit: "f".repeat(40) }
      : field === "sourceUrl" ? { sourceUrl: "https://caller.example.invalid/source.json" } : { status: "active", enabled: true }) };
    const route = routeSetup(f), result = await route.accept(f.manifest, f.manifestHash);
    expect(result.status).toBe(503); expect(await result.json()).toEqual({ error: { code: "MODULE_REVIEW_SERVICE_UNAVAILABLE" } });
    expect(route.backend.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it.each([null, { sourceVersion: "invalid" }])("preserves Native manifest and acceptance when Engine configuration is %j", async engine => {
    installed.engine = engine;
    const f = moduleReviewAdminFixture(), route = routeSetup(f);
    const manifest = createModuleModeHostManifest({ release: configuredNativeRelease as ModuleModeHostReleaseIdentity, definition: f.definition, nativeBinding: f.binding, descriptor: f.source.descriptor });
    const hash = computeModuleModeHostManifestHash(manifest);
    expect((await route.manifest(manifest)).status).toBe(200);
    expect((await route.accept(manifest, hash)).status).toBe(201);
  });
});
