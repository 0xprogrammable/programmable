import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { NATIVE_ENGINE_PROFILE } from "../lib/module-mode/builder";
import { referenceManagementManifest } from "../lib/module-mode/management-manifest";
import type { NativeModuleModeCatalogEntry } from "../lib/module-mode/native-catalog";
import { bindActiveModuleModeRelease } from "../lib/module-mode/release";
import {
  bindModuleModeCatalogFile, computeModuleModeHostManifestHash, createModuleModeAvailabilityReader,
  createModuleModeHostManifest, MODULE_MODE_CATALOG_SCHEMA, moduleModePublicationUrl,
  verifyModuleModePublication, type ModuleModeAvailabilityDependencies, type ModuleModeCatalogDefinition,
} from "../lib/server/module-mode/catalog";
import { computeModuleReviewDecisionDigestV1, type ModuleReviewDecisionRecordV1 } from "../lib/server/module-mode/review-decision-wire-v1";
import { createModuleModeHttpCollector } from "../lib/server/robinhood-index/module-source";
import { validateModuleSubmissionRequest, type ModuleSubmissionRequest } from "../packages/classic-modules/src/open-transport.mjs";
import { canonicalizeJson } from "../lib/server/projection-target/canonical-json";
import preview from "../config/module-mode/robinhood.preview.json";
import catalogFile from "../config/module-mode/catalog.json";
import { a, h, moduleEvidenceFixture } from "./fixtures/module-mode-evidence";

// Entirely synthetic parser/transport fixtures. These objects are never deployment, review or provider evidence.
function fixture(options: { requiresHost?: string[]; managementCapabilities?: string[] } = {}) {
  const release = bindActiveModuleModeRelease(moduleEvidenceFixture().release);
  const files = [{ path: "README.md", text: "Synthetic catalogue fixture; never publish." },
    { path: "src/Program.sol", text: "// Synthetic parser test. No compiled or deployable program.\n" }].map(file => ({
    path: file.path, sha256: createHash("sha256").update(file.text).digest("hex"), encoding: "base64" as const, bytes: Buffer.from(file.text).toString("base64"),
  }));
  const schema = { type: "record" as const, fields: { capNative: { type: "uint" as const, bits: 128, min: "1", label: "Maximum buys" } }, required: ["capNative"] };
  const source: ModuleSubmissionRequest = { format: "programmable.modules.submission.v0.1", files, descriptor: {
    format: "programmable.classic.source-package.v0.1", name: "Synthetic opening cap", version: "1.0.0", author: a(900), rewardWallet: a(901), familySalt: h(902),
    source: { files: files.map(({ path, sha256 }) => ({ path, sha256 })) }, configuration: schema,
    components: [{ id: "program", runtime: "programmable.module-native-runtime@1", sourcePath: "src/Program.sol", entrypoint: "Program" }],
    ports: { inputs: {}, outputs: {} }, constraints: [], management: { summary: "Synthetic parser fixture.", reads: [], actions: [] },
    requiresHost: options.requiresHost ?? ["programmable.module-native-runtime@1", "programmable.module-config-abi@1", "programmable.module-management@1"], documentation: "README.md",
  } };
  const checked = validateModuleSubmissionRequest(source);
  if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
  const definition: ModuleModeCatalogDefinition = {
    id: "synthetic-opening-cap-v1", title: "Opening buy limit", summary: "Synthetic opening limit.", detail: "A parser fixture only.", version: "1.0.0",
    engine: NATIVE_ENGINE_PROFILE, source: { path: "src/Program.sol", sha256: files[1].sha256 }, schema, defaults: { capNative: "1" },
    fields: { capNative: { suffix: "ETH", decimals: 18 } }, programAbi: [{ path: ["capNative"], type: "uint128" }],
    management: { ...referenceManagementManifest("cap"), ...(options.managementCapabilities ? { capabilities: options.managementCapabilities } : {}) },
    requiresHost: source.descriptor.requiresHost,
  };
  const binding = { familyId: checked.familyId, packageId: checked.packageId, factory: a(800), factoryCodeHash: h(801), moduleCodeHash: h(802), callbackGas: 75_000 };
  const manifest = createModuleModeHostManifest({ release, definition, nativeBinding: binding, descriptor: source.descriptor });
  const manifestHash = computeModuleModeHostManifestHash(manifest);
  const reviewContent: Omit<ModuleReviewDecisionRecordV1, "decisionDigest"> = {
    schemaVersion: "programmable.modules.review-decision.v1", reviewerWallet: a(903), policyDigest: h(904),
    subject: { submissionId: "00000000-0000-4000-8000-000000000001", principalId: "00000000-0000-4000-8000-000000000002", author: a(900), requestDigest: checked.requestDigest },
    command: { schemaVersion: "programmable.modules.review-command.v1", submissionId: "00000000-0000-4000-8000-000000000001", requestDigest: checked.requestDigest,
      expectedReviewRevision: 0, outcome: "accept", reason: "Synthetic test decision only; never publish or admit.", artifactDigest: h(905), hostManifestHash: manifestHash,
      acknowledgedReviewAreas: ["source-review", "configuration", "management"] },
    decidedAt: "2026-09-06T00:00:00.000Z", registryApproved: false, available: false,
  };
  const review = { ...reviewContent, decisionDigest: computeModuleReviewDecisionDigestV1(reviewContent) };
  const entry: NativeModuleModeCatalogEntry = { ...definition, status: "available", nativeBinding: { ...binding, manifestHash, reviewDigest: review.decisionDigest } };
  const publication = { entry, requestDigest: checked.requestDigest, review };
  const catalog = { schemaVersion: MODULE_MODE_CATALOG_SCHEMA, sourceReleaseDigest: release.releaseDigest, entries: [publication] };
  const responses = { source, manifest, review };
  const fetchPublic = vi.fn<typeof fetch>(async (url, init) => {
    const kind = String(url).split("/").at(-1)?.replace(".json", "") as keyof typeof responses;
    expect(String(url)).toBe(moduleModePublicationUrl(binding.packageId, kind));
    expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store", headers: { accept: "application/json" } });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return Response.json(responses[kind]);
  });
  const authenticateRelease = vi.fn(async (value: unknown) => { expect(value).toEqual(release); });
  const dependencies: ModuleModeAvailabilityDependencies = { releaseProfile: release, catalogFile: catalog,
    collector: () => ({ authenticateRelease }), fetchPublic };
  return { release, source, definition, binding, manifest, manifestHash, review, publication, catalog, responses, fetchPublic, authenticateRelease, dependencies };
}

describe("Module Mode host publication identity", () => {
  it("constructs a manifest before activation and review without dummy proof fields", () => {
    const f = fixture();
    const identity = Object.fromEntries(Object.entries(f.release).filter(([key]) => !["enabled", "status", "deploymentEvidenceDigest", "sourceVerificationDigest", "lifecycleEvidenceDigest"].includes(key)));
    expect(createModuleModeHostManifest({ ...f, release: identity as typeof f.release, nativeBinding: f.binding, descriptor: f.source.descriptor })).toEqual(f.manifest);
    expect(f.manifest.manifest.runtimeBinding).not.toHaveProperty("manifestHash");
    expect(f.manifest.manifest.runtimeBinding).not.toHaveProperty("reviewDigest");
    expect(f.manifest.manifest.catalogDefinition).not.toHaveProperty("status");
    expect(f.manifest.manifest.catalogDefinition).not.toHaveProperty("nativeBinding");
  });
  it("pins deterministic canonical host-manifest and append-only review golden vectors", () => {
    const f = fixture();
    expect(f.manifestHash).toBe("0xb50de16a7c50e3717b3468d45a53d87d07050ad2dd20e7cab1e9e06d25432fce");
    expect(f.review.decisionDigest).toBe("0xfc4ecf32ceaa9bb1e0bf13960b0bf26c14a0381b3483819fed297d681073cad5");
    const reordered = JSON.parse(JSON.stringify(f.manifest), (_key, value) => value && !Array.isArray(value) && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).reverse()) : value);
    expect(computeModuleModeHostManifestHash(reordered)).toBe(f.manifestHash);
    expect(computeModuleModeHostManifestHash(f.manifest)).not.toBe(f.review.decisionDigest);
  });
  it.each([
    ["source package", (x: ReturnType<typeof fixture>["manifest"]) => { x.manifest.sourcePackageId = h(91); }],
    ["schema", (x: ReturnType<typeof fixture>["manifest"]) => { x.manifest.configuration.schema.label = "Other label"; }],
    ["ABI mapping", (x: ReturnType<typeof fixture>["manifest"]) => { x.manifest.configuration.abiMapping[0].type = "uint256"; }],
    ["management", (x: ReturnType<typeof fixture>["manifest"]) => { x.manifest.management.reads[0].label = "Changed"; }],
    ["host requirements", (x: ReturnType<typeof fixture>["manifest"]) => { x.manifest.requiresHost.push("other.runtime@1"); }],
    ["release", (x: ReturnType<typeof fixture>["manifest"]) => { x.manifest.runtimeBinding.sourceReleaseDigest = h(92); }],
    ["registry", (x: ReturnType<typeof fixture>["manifest"]) => { x.manifest.runtimeBinding.registry = { address: a(12), runtimeCodeHash: h(93) }; }],
    ["factory", (x: ReturnType<typeof fixture>["manifest"]) => { x.manifest.runtimeBinding.factory = a(13); }],
    ["module code", (x: ReturnType<typeof fixture>["manifest"]) => { x.manifest.runtimeBinding.moduleCodeHash = h(94); }],
    ["gas", (x: ReturnType<typeof fixture>["manifest"]) => { x.manifest.runtimeBinding.callbackGas++; }],
    ["UI units", (x: ReturnType<typeof fixture>["manifest"]) => { x.manifest.catalogDefinition.fields!.capNative.decimals = 6; }],
    ["default", (x: ReturnType<typeof fixture>["manifest"]) => { x.manifest.catalogDefinition.defaults = { capNative: "99" }; }],
  ])("binds every %s field", (_label, mutate) => {
    const f = fixture(); const changed = structuredClone(f.manifest); mutate(changed);
    expect(computeModuleModeHostManifestHash(changed)).not.toBe(f.manifestHash);
  });
  it("binds exact source bytes, author, source path, config, manifest and historical review", () => {
    const f = fixture();
    expect(verifyModuleModePublication({ ...f, ...f.responses })).toEqual(f.publication.entry);
    expect(f.source.descriptor.source).not.toHaveProperty("repository");
    const changed = structuredClone(f.source); changed.files[0].bytes = Buffer.from("Substituted content").toString("base64");
    expect(() => verifyModuleModePublication({ ...f, ...f.responses, source: changed })).toThrow("source bytes");
    const review = structuredClone(f.review); review.command = { ...review.command, reason: "Substituted review decision contents." };
    expect(() => verifyModuleModePublication({ ...f, ...f.responses, review })).toThrow("review decision");
  });
  it("does not accept unreviewed or misleading historical availability flags", () => {
    const f = fixture(); const changed = structuredClone(f.catalog);
    changed.entries[0].review.available = true as never;
    expect(() => bindModuleModeCatalogFile(changed, f.release)).toThrow("review decision");
    const rejected = structuredClone(f.catalog);
    rejected.entries[0].review.command = { ...rejected.entries[0].review.command, outcome: "reject", artifactDigest: null, hostManifestHash: null };
    const contents = Object.fromEntries(Object.entries(rejected.entries[0].review).filter(([key]) => key !== "decisionDigest")) as Omit<ModuleReviewDecisionRecordV1, "decisionDigest">;
    rejected.entries[0].review.decisionDigest = computeModuleReviewDecisionDigestV1(contents);
    rejected.entries[0].entry.nativeBinding.reviewDigest = rejected.entries[0].review.decisionDigest;
    expect(() => bindModuleModeCatalogFile(rejected, f.release)).toThrow("acceptance");
  });
  it("rejects catalogue release mismatches and duplicate identities", () => {
    const f = fixture();
    expect(() => bindModuleModeCatalogFile({ ...f.catalog, sourceReleaseDigest: h(1001) }, f.release)).toThrow("another release");
    expect(() => bindModuleModeCatalogFile({ ...f.catalog, entries: [...f.catalog.entries, ...f.catalog.entries] }, f.release)).toThrow("Duplicate");
    expect(() => moduleModePublicationUrl("../../private" as never, "source")).toThrow();
  });
  it("does not turn an unsupported management capability into working website controls", () => {
    const f = fixture({ managementCapabilities: ["bound-reads@1", "unimplemented-control@1"] });
    expect(() => verifyModuleModePublication({ ...f, ...f.responses })).toThrow("unavailable host capability");
  });
});

describe("Read-only Module Mode availability", () => {
  it("ships an empty publication allowlist and only proposal cards while disabled", async () => {
    expect(catalogFile).toEqual({ schemaVersion: MODULE_MODE_CATALOG_SCHEMA, sourceReleaseDigest: null, entries: [] });
    const f = fixture(); const read = createModuleModeAvailabilityReader({ ...f.dependencies, releaseProfile: preview, catalogFile });
    const result = await read();
    expect(result.release).toBeNull(); expect(result.reason).toContain("being prepared");
    expect(result.catalog.every(entry => entry.status === "preview" && !Object.hasOwn(entry, "nativeBinding"))).toBe(true);
    expect(f.authenticateRelease).not.toHaveBeenCalled(); expect(f.fetchPublic).not.toHaveBeenCalled();
  });
  it("allows a verified plain launch before a first reviewed module exists", async () => {
    const f = fixture(); const read = createModuleModeAvailabilityReader({ ...f.dependencies, catalogFile });
    expect(await read()).toEqual({ schemaVersion: "programmable.module-mode.availability.v1", release: f.release, catalog: [], reason: null });
    expect(f.authenticateRelease).toHaveBeenCalledTimes(1); expect(f.fetchPublic).not.toHaveBeenCalled();
  });
  it("authenticates the complete release before publishing an exact module entry", async () => {
    const f = fixture();
    f.fetchPublic.mockImplementation(async url => { expect(f.authenticateRelease).toHaveBeenCalledTimes(1);
      const kind = String(url).split("/").at(-1)?.replace(".json", "") as keyof typeof f.responses; return Response.json(f.responses[kind]); });
    expect(await createModuleModeAvailabilityReader(f.dependencies)()).toEqual({ schemaVersion: "programmable.module-mode.availability.v1",
      release: f.release, catalog: [f.publication.entry], reason: null });
    expect(f.fetchPublic).toHaveBeenCalledTimes(3);
  });
  it("fails closed when the real private collector lacks its service credential", async () => {
    const f = fixture(); const fetchBackend = vi.fn<typeof fetch>();
    const read = createModuleModeAvailabilityReader({ ...f.dependencies, collector: signal => createModuleModeHttpCollector({
      backendBaseUrl: "https://api.programmable.market", websiteToken: "", fetchBackend, signal,
    }) });
    expect(await read()).toMatchObject({ release: null, catalog: [], reason: expect.stringContaining("temporarily unavailable") });
    expect(fetchBackend).not.toHaveBeenCalled(); expect(f.fetchPublic).not.toHaveBeenCalled();
  });
  it("does not expose a provider error or fall back to preview addresses", async () => {
    const f = fixture();
    f.authenticateRelease.mockRejectedValue(new Error("INTERNAL token=private-do-not-echo"));
    const result = await createModuleModeAvailabilityReader(f.dependencies)();
    expect(result.release).toBeNull(); expect(result.catalog).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/INTERNAL|private-do-not-echo|0x/u);
  });
  it("keeps modules needing an unimplemented host adapter unavailable", async () => {
    const f = fixture({ requiresHost: ["unimplemented.host-adapter@1"] });
    expect(await createModuleModeAvailabilityReader(f.dependencies)()).toMatchObject({ release: null, catalog: [] });
  });
  it("deduplicates in-flight reads, caches exact immutable files, and rechecks auth after 10 seconds", async () => {
    const f = fixture(); let now = 1;
    const read = createModuleModeAvailabilityReader({ ...f.dependencies, now: () => now });
    const results = await Promise.all([read(), read(), read()]);
    expect(results.every(result => result.release !== null)).toBe(true);
    expect(f.authenticateRelease).toHaveBeenCalledTimes(1); expect(f.fetchPublic).toHaveBeenCalledTimes(3);
    results[0].catalog[0].title = "Caller mutation";
    expect((await read()).catalog[0].title).toBe("Opening buy limit");
    now += 10_001; expect((await read()).release).toEqual(f.release);
    expect(f.authenticateRelease).toHaveBeenCalledTimes(2); expect(f.fetchPublic).toHaveBeenCalledTimes(3);
    now += 10_001; f.authenticateRelease.mockRejectedValue(new Error("private auth revoked"));
    expect(await read()).toMatchObject({ release: null, catalog: [] });
    expect(f.fetchPublic).toHaveBeenCalledTimes(3);
  });
  it("does not reuse a publication success for changed interpretation or review bytes", async () => {
    const f = fixture(); let now = 1;
    const read = createModuleModeAvailabilityReader({ ...f.dependencies, now: () => now });
    expect((await read()).release).not.toBeNull();
    f.catalog.entries[0].entry.fields!.capNative.decimals = 6;
    now += 10_001;
    expect(await read()).toMatchObject({ release: null, catalog: [] });
    expect(f.fetchPublic).toHaveBeenCalledTimes(6);
  });
  it.each(["source", "manifest", "review"])("does not expose a module with missing public %s bytes", async kind => {
    const f = fixture(); const base = f.fetchPublic.getMockImplementation()!;
    f.fetchPublic.mockImplementation(async (...args) => String(args[0]).endsWith(`/${kind}.json`) ? new Response("missing", { status: 404 }) : base(...args));
    expect(await createModuleModeAvailabilityReader(f.dependencies)()).toMatchObject({ release: null, catalog: [] });
  });
  it.each([
    ["duplicate keys", () => new Response('{"format":"x","format":"y"}', { headers: { "content-type": "application/json" } })],
    ["oversized declaration", () => new Response("{}", { headers: { "content-type": "application/json", "content-length": String(24 * 1024 * 1024 + 1) } })],
    ["HTML", () => new Response("<html>login</html>", { headers: { "content-type": "text/html" } })],
    ["redirect", () => new Response(null, { status: 302, headers: { location: "https://foreign.example/source.json" } })],
    ["inexact length", () => new Response("{}", { headers: { "content-type": "application/json", "content-length": "3" } })],
  ])("rejects %s publication responses", async (_label, response) => {
    const f = fixture(); f.fetchPublic.mockImplementation(async () => response());
    expect(await createModuleModeAvailabilityReader(f.dependencies)()).toMatchObject({ release: null, catalog: [] });
  });
  it("bounds an unresponsive collector without returning old active data", async () => {
    const f = fixture(); f.authenticateRelease.mockImplementation(async () => new Promise(() => {}));
    const read = createModuleModeAvailabilityReader({ ...f.dependencies, budgetMs: 20 });
    expect(await read()).toMatchObject({ release: null, catalog: [] });
    expect(f.fetchPublic).not.toHaveBeenCalled();
  });
  it("keeps the public route read-only and uncached at the browser boundary", async () => {
    const route = await import("../app/api/module-mode/route");
    const response = await route.GET(); const body = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.release).toBeNull(); expect(body.catalog.every((entry: { status: string }) => entry.status === "preview")).toBe(true);
    expect(Object.keys(route)).not.toContain("POST");
  });
  it("uses canonical JSON rather than mutable property insertion order", () => {
    expect(canonicalizeJson({ z: [1, false], a: "é" })).toBe('{"a":"é","z":[1,false]}');
  });
});
