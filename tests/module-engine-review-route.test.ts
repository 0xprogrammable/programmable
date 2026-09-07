import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { validateModuleSubmissionRequest } from "../packages/classic-modules/src/open-transport.mjs";
import frozen from "./fixtures/module-engine-review-build.json";
import configuredNativeRelease from "../config/module-mode/robinhood.preview.json";
import { fixture as engineClientFixture } from "./module-engine-fixture";
import { moduleReviewAdminFixture } from "./fixtures/module-review-admin";
import { WEBSITE_ADMIN_WALLET } from "../lib/admin-access";
import { computeModuleEngineHostManifestHash, computeModuleEngineReleaseDigest, type ModuleEngineCatalogDefinition } from "../lib/module-engine/catalog";
import { createReviewedModuleEngineManifest } from "../lib/module-mode/review-engine-manifest";
import type { ModuleEngineBuildArtifactV1, ModuleEngineBuildPlanV1 } from "../lib/module-mode/review-engine-types";
import { MODULE_ENGINE_QUOTE_ENVIRONMENT_V1 } from "../lib/module-mode/review-engine-types";
import { moduleEngineStandardInputV1, parseEngineReviewArtifact, validateModuleEngineBuildPlanV1, verifyModuleEngineBuildArtifactV1 } from "../lib/module-mode/review-engine-contract";
import { parseReviewSubject, reviewDigest, type ReviewJob } from "../lib/module-mode/review-contract";
import { computeModuleModeHostManifestHash, createModuleModeHostManifest, type ModuleModeHostReleaseIdentity } from "../lib/server/module-mode/catalog";
import { computeModuleReviewDecisionDigestV1, type ModuleReviewDecisionCommandV1, type ModuleReviewDecisionRecordV1 } from "../lib/server/module-mode/review-decision-wire-v1";
import { computeModuleModeReleaseDigest } from "../lib/module-mode/release";

const installed = vi.hoisted(() => ({ engine: null as unknown, native: null as unknown, authenticate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/config/module-engine/review-release.json", () => ({ get default() { return installed.engine; } }));
vi.mock("@/config/module-mode/review-release.json", () => ({ get default() { return installed.native; } }));
vi.mock("@/lib/server/creator-article/wallet-principal.server", () => ({
  createPrivyWalletPrincipalAuthenticatorV1: () => ({ authenticate: installed.authenticate }),
  WalletPrincipalAuthenticationErrorV1: class extends Error {},
}));

const reviewer = WEBSITE_ADMIN_WALLET.toLowerCase() as `0x${string}`;
const nativeIdentityKeys = ["schemaVersion", "sourceVersion", "chainId", "sourceCommit", "startBlock",
  "minimumInitialBuyNative", "tokenCreationCodeHash", "finalityPolicy", "contracts", "releaseDigest"];
const nativeV1Identity = Object.fromEntries(nativeIdentityKeys.map(key => [key, configuredNativeRelease[key as keyof typeof configuredNativeRelease]]));
const nativeV2IdentityBytes = readFileSync(new URL("../config/module-mode/review-release.json", import.meta.url));
const nativeV2Identity = JSON.parse(nativeV2IdentityBytes.toString()) as ModuleModeHostReleaseIdentity;

describe("source-bound Quote dependency environment", () => {
  it("preserves the ordinary protected artifact and exact plan digest", () => {
    const subject=parseReviewSubject(frozen.subject), plan=validateModuleEngineBuildPlanV1(frozen.plan,subject);
    expect(reviewDigest("programmable.modules.engine-build-plan.v1",plan)).toBe(frozen.artifact.planDigest);
    expect(reviewDigest("programmable.modules.compiler-input.v1",moduleEngineStandardInputV1(frozen.source,subject,plan))).toBe(frozen.artifact.compiler.completeInputHash);
    expect(()=>verifyModuleEngineBuildArtifactV1(frozen.artifact as ModuleEngineBuildArtifactV1,subject,plan,frozen.source)).not.toThrow();
    expect(validateModuleEngineBuildPlanV1({...plan,testEnvironment:MODULE_ENGINE_QUOTE_ENVIRONMENT_V1},subject).testEnvironment).toEqual(MODULE_ENGINE_QUOTE_ENVIRONMENT_V1);
  });
  it.each([null,undefined,{},"quote",{...MODULE_ENGINE_QUOTE_ENVIRONMENT_V1,profile:"other"},{...MODULE_ENGINE_QUOTE_ENVIRONMENT_V1,sourceDigest:`0x${"00".repeat(32)}`},{...MODULE_ENGINE_QUOTE_ENVIRONMENT_V1,rpcUrl:"https://caller.example.invalid"},{...MODULE_ENGINE_QUOTE_ENVIRONMENT_V1,bytecode:"0x00"},{...MODULE_ENGINE_QUOTE_ENVIRONMENT_V1,state:{}}])("rejects caller-controlled environment data %j",value=>{
    expect(()=>validateModuleEngineBuildPlanV1({...frozen.plan,testEnvironment:value},parseReviewSubject(frozen.subject))).toThrow();
  });
  it("rejects an environment added to an otherwise valid artifact without matching the protected plan", () => {
    const {artifactDigest: _digest,...contents}=frozen.artifact; void _digest;
    const changed={...contents,testEnvironment:MODULE_ENGINE_QUOTE_ENVIRONMENT_V1};
    const artifact={...changed,artifactDigest:reviewDigest("programmable.modules.engine-build.v1",changed)};
    expect(()=>parseEngineReviewArtifact(artifact,parseReviewSubject(frozen.subject),frozen.plan as ModuleEngineBuildPlanV1)).toThrow("MODULE_ENGINE_BUILD_PLAN_MISMATCH");
  });
  it("publishes the same byte-preserving scoped source aliases and rejects collisions", () => {
    const prefixes=["openzeppelin/contracts/","openzeppelin/uniswap-hooks/","uniswap/blocknumberish/","uniswap/liquidity-launcher/","uniswap/uerc20-factory/","uniswap/v4-core/","uniswap/v4-periphery/","solady/src/"];
    const source=structuredClone(frozen.source),content="// exact source bytes\npragma solidity 0.8.26;\n";
    const sha256=createHash("sha256").update(content).digest("hex");
    const append=(path:string)=>{source.files.push({path,sha256,encoding:"base64",bytes:Buffer.from(content).toString("base64")});source.descriptor.source.files.push({path,sha256});};
    for(const prefix of prefixes) append(`dependencies/scoped/${prefix}Probe.sol`);
    const standard=()=>{
      const checked=validateModuleSubmissionRequest(source);expect(checked.ok).toBe(true);if(!checked.ok)throw new Error("Invalid source fixture");
      const subject=parseReviewSubject({...frozen.subject,requestDigest:checked.requestDigest});
      return moduleEngineStandardInputV1(checked.request,subject,{...frozen.plan,requestDigest:checked.requestDigest});
    };
    const input=standard();
    for(const prefix of prefixes){expect(input.sources[`@${prefix}Probe.sol`].content).toBe(content);expect(input.sources).not.toHaveProperty(`dependencies/scoped/${prefix}Probe.sol`);}
    append("dependencies/openzeppelin-contracts/contracts/Probe.sol");
    expect(standard).toThrow("MODULE_BUILD_SOURCE_ALIAS_COLLISION");
  });
});
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
  vi.resetModules(); installed.engine = null; installed.native = structuredClone(nativeV1Identity);
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

describe("installed Native review identity at the actual admin BFF routes", () => {
  function nativeReviewFixture(release = nativeV2Identity) {
    const f = moduleReviewAdminFixture();
    // Only the adopted host identity is actual. Source/build/eligibility are synthetic test inputs.
    const binding = { ...f.binding, ...(release.sourceVersion === "module-native-v2"
      ? { feeEligibility: { eligible: true, reviewDigest: `0x${"7".repeat(64)}` as const } } : {}) };
    const manifest = createModuleModeHostManifest({ release, definition: f.definition, nativeBinding: binding, descriptor: f.source.descriptor });
    return { ...f, manifest, manifestHash: computeModuleModeHostManifestHash(manifest) };
  }

  it("installs the exact adopted NativeV2 identity without public activation fields", async () => {
    const { bindModuleModeReviewReleaseIdentity } = await import("../lib/server/module-mode/review-client");
    expect(nativeV2IdentityBytes.byteLength).toBe(3401);
    expect(createHash("sha256").update(nativeV2IdentityBytes).digest("hex")).toBe("36100920548506582be173ef0aeef392b413602fc7f4490c1c758829097aae1e");
    expect(bindModuleModeReviewReleaseIdentity(nativeV2Identity)).toEqual(nativeV2Identity);
    expect(nativeV2Identity.releaseDigest).toBe("0xe81f122e0bd21e0984e21c71ffce56f315e82f22e485cc19e0e490d4d5b7bd49");
    expect(nativeV2Identity.sourceCommit).toBe("17b64b6613108dbc6ffdf767607bde6ea33343cd");
    expect(nativeV2Identity).not.toHaveProperty("enabled");
    expect(nativeV2Identity).not.toHaveProperty("lifecycleEvidenceDigest");
    expect(bindModuleModeReviewReleaseIdentity(nativeV1Identity)).toEqual(nativeV1Identity);
    expect(configuredNativeRelease.sourceVersion).toBe("module-native-v1");
  });

  it("uses the separately installed V2 identity for manifest checking and authenticated acceptance", async () => {
    installed.native = nativeV2Identity;
    const f = nativeReviewFixture(), route = routeSetup(f);
    expect((await route.manifest(f.manifest)).status).toBe(200);
    expect((await route.accept(f.manifest, f.manifestHash)).status).toBe(201);
    const writes = route.backend.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(writes).toHaveLength(1);
    expect(String(writes[0][0])).toBe(`https://review.example.invalid/v1/wallet-admin/module-review/${f.subject.submissionId}/decisions`);
    const headers = new Headers(writes[0][1]?.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${serviceToken}`);
    expect(headers.get("X-Programmable-Bff-Assertion-Signature")).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
    expect(installed.authenticate).toHaveBeenCalledTimes(2);
  });

  it("keeps an absent Native slot closed without blocking the original source download", async () => {
    installed.native = null;
    const f = nativeReviewFixture(), route = routeSetup(f);
    for (const result of [await route.manifest(f.manifest), await route.accept(f.manifest, f.manifestHash)]) {
      expect(result.status).toBe(409);
      expect(await result.json()).toEqual({ error: { code: "MODULE_REVIEW_HOST_RELEASE_UNAVAILABLE" } });
    }
    const { GET } = await import("../app/api/admin/modules/[id]/source/route");
    const result = await GET(new Request(`https://programmable.market/api/admin/modules/${f.subject.submissionId}/source?walletAddress=${reviewer}`), { params: Promise.resolve({ id: f.subject.submissionId }) });
    expect(result.status).toBe(200); expect(await result.json()).toEqual(f.source);
    expect(route.backend.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it.each(["sourceVersion", "schemaVersion", "sourceCommit", "chainId", "economicsPolicyId", "missingEconomics", "sourceUrl", "activation", "proof", "pin", "duplicatePin", "accessor"])("rejects invalid installed Native %s before acceptance", async field => {
    const release = structuredClone(nativeV2Identity) as unknown as Record<string, unknown>;
    if (field === "sourceVersion") release.sourceVersion = "module-native-v3";
    if (field === "schemaVersion") release.schemaVersion = "programmable.module-mode-source.v1";
    if (field === "sourceCommit") release.sourceCommit = "f".repeat(40);
    if (field === "chainId") release.chainId = 1;
    if (field === "economicsPolicyId") release.economicsPolicyId = `0x${"8".repeat(64)}`;
    if (field === "missingEconomics") delete release.economicsPolicyId;
    if (field === "sourceUrl") release.sourceUrl = "https://caller.example.invalid/source.json";
    if (field === "activation") { release.enabled = true; release.status = "active"; }
    if (field === "proof") release.lifecycleEvidenceDigest = `0x${"8".repeat(64)}`;
    const pins = release.contracts as Record<string, { address: string; runtimeCodeHash: string }>;
    if (field === "pin") pins.registry.runtimeCodeHash = `0x${"8".repeat(64)}`;
    if (field === "duplicatePin") pins.registry.address = pins.hook.address;
    const accessor = vi.fn(() => "module-native-v2");
    if (field === "accessor") Object.defineProperty(release, "sourceVersion", { enumerable: true, get: accessor });
    installed.native = release;
    const f = nativeReviewFixture(), route = routeSetup(f);
    for (const result of [await route.manifest(f.manifest), await route.accept(f.manifest, f.manifestHash)]) {
      expect(result.status).toBe(503);
      expect(await result.json()).toEqual({ error: { code: "MODULE_REVIEW_SERVICE_UNAVAILABLE" } });
    }
    expect(accessor).not.toHaveBeenCalled();
    expect(route.backend.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("rejects V1 manifests, caller release overrides and a correctly rehashed alternate V2 source", async () => {
    installed.native = nativeV2Identity;
    const f = nativeReviewFixture(), route = routeSetup(f);
    const v1 = nativeReviewFixture(nativeV1Identity as ModuleModeHostReleaseIdentity);
    expect((await route.manifest(v1.manifest)).status).toBe(400);
    expect((await route.manifest(f.manifest, { releaseIdentity: nativeV2Identity })).status).toBe(400);
    const changedRelease = { ...nativeV2Identity, sourceCommit: "e".repeat(40) };
    changedRelease.releaseDigest = computeModuleModeReleaseDigest(changedRelease);
    const changed = nativeReviewFixture(changedRelease);
    expect((await route.manifest(changed.manifest)).status).toBe(400);
    expect((await route.accept(changed.manifest, changed.manifestHash)).status).toBe(400);
    expect(route.backend.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("rechecks the exact V2 fee-eligibility tuple on acceptance", async () => {
    installed.native = nativeV2Identity;
    const f = nativeReviewFixture(), route = routeSetup(f), changed = structuredClone(f.manifest);
    expect((await route.manifest(f.manifest)).status).toBe(200);
    changed.manifest.runtimeBinding.feeEligibility = { eligible: false, reviewDigest: `0x${"0".repeat(64)}` };
    expect((await route.accept(changed, f.manifestHash)).status).toBe(400);
    expect(route.backend.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it.each([null, { sourceVersion: "invalid" }])("preserves Engine checking and acceptance when Native configuration is %j", async native => {
    installed.native = native;
    const f = engineReviewFixture(); installed.engine = f.release;
    const route = routeSetup(f);
    expect((await route.manifest(f.manifest)).status).toBe(200);
    expect((await route.accept(f.manifest, f.manifestHash)).status).toBe(201);
  });
});
