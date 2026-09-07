import { describe, expect, it, vi } from "vitest";
import { keccak256, type Address, type Hex } from "viem";
import frozen from "./fixtures/module-engine-review-build.json";
import { bindActiveModuleEngineRelease, computeModuleEngineHostManifestHash, computeModuleEngineReleaseDigest, MODULE_ENGINE_AVAILABILITY_SCHEMA, MODULE_ENGINE_CONTRACTS, type ModuleEngineAvailability, type ModuleEngineCatalogDefinition, type ModuleEngineRelease, type ModuleEngineRevisionDefinition } from "../lib/module-engine/catalog";
import { MODULE_MODE_ECONOMICS_POLICY_V2, MODULE_MODE_FINALITY_POLICY } from "../lib/module-mode/release";
import { reviewDigest, type ReviewSubject } from "../lib/module-mode/review-contract";
import type { ModuleEngineBuildArtifactV1, ModuleEngineBuildPlanV1 } from "../lib/module-mode/review-engine-types";
import { createReviewedModuleEngineManifest } from "../lib/module-mode/review-engine-manifest";
import { createModuleEngineAvailabilityReader, createModuleEngineHistoricalAvailabilityReader, configuredModuleEngineReleaseDigests, MODULE_ENGINE_HISTORICAL_RELEASES_SCHEMA, readModuleEngineAvailability, readModuleEngineLaunchVersions, type ModuleEngineAvailabilityDependencies } from "../lib/server/module-engine/catalog";
import { bindModuleEngineCatalogFile, MODULE_ENGINE_CATALOG_SCHEMA, verifyModuleEnginePublication, type ModuleEngineCatalogPublication } from "../lib/server/module-engine/publication";
import { MODULE_MODE_AVAILABILITY_TTL_MS, MODULE_MODE_PUBLICATION_TTL_MS, MODULE_MODE_UNAVAILABLE_TTL_MS, moduleModePublicationUrl } from "../lib/server/module-mode/catalog";
import { computeModuleReviewDecisionDigestV1, type ModuleReviewDecisionRecordV1 } from "../lib/server/module-mode/review-decision-wire-v1";
import { validateModuleSubmissionRequest } from "../packages/classic-modules/src/open-transport.mjs";
import { createModuleModeHttpCollector } from "../lib/server/robinhood-index/module-source";

const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
function mutablePublication(value: ModuleEngineCatalogPublication) {
  const result = structuredClone(value);
  return { ...result, review: { ...result.review, command: { ...result.review.command } }, reviewedBuild: { ...result.reviewedBuild,
    subject: { ...result.reviewedBuild.subject }, artifact: { ...result.reviewedBuild.artifact, compiler: { ...result.reviewedBuild.artifact.compiler } } } };
}
// The compiler fixture is a parser vector, and every authority/provider receipt here is synthetic.
// These tests never compile, execute, publish, approve or send the fixture's engine.
function fixture(seed = 1) {
  const source = structuredClone(frozen.source), checked = validateModuleSubmissionRequest(source);
  if (!checked.ok) throw new Error("Invalid test source");
  const subject = structuredClone(frozen.subject) as ReviewSubject;
  const plan = structuredClone(frozen.plan) as ModuleEngineBuildPlanV1, artifact = structuredClone(frozen.artifact) as ModuleEngineBuildArtifactV1;
  const raw = { schemaVersion: "programmable.module-engine.release.v1" as const, sourceVersion: "module-engine-v1" as const,
    engineProfile: "programmable.module-engine-solidity@1" as const, chainId: 4663 as const, sourceCommit: seed.toString(16).padStart(40, "0"),
    startBlock: "1", tokenCreationCodeHash: hash(30), economicsPolicyId: MODULE_MODE_ECONOMICS_POLICY_V2, finalityPolicy: MODULE_MODE_FINALITY_POLICY,
    contracts: Object.fromEntries(MODULE_ENGINE_CONTRACTS.map((role, index) => [role, { address: address(200 + seed * 10 + index), runtimeCodeHash: keccak256("0x6000") }])) as ModuleEngineRelease["contracts"] };
  const release = bindActiveModuleEngineRelease({ ...raw, releaseDigest: computeModuleEngineReleaseDigest(raw), enabled: true, status: "active",
    deploymentEvidenceDigest: hash(100), sourceVerificationDigest: hash(101), lifecycleEvidenceDigest: hash(102) });
  const definition: ModuleEngineCatalogDefinition = { id: "fixture-engine", title: "Fixture engine", summary: "Synthetic test only.",
    detail: "Parser fixture only, never a published engine.", version: source.descriptor.version, interface: "custom-v1",
    source: source.descriptor.source.files[0], schema: checked.request.descriptor.configuration, defaults: { cap: "5" }, configurationAbi: artifact.configurationAbi, constraints: [] };
  const revision: ModuleEngineRevisionDefinition = { packageId: artifact.packageId, familyId: artifact.familyId, fixedQuoteAsset: address(0),
    fixedConfigurationHash: hash(0), initialOperationId: hash(0), executionGas: artifact.executionGas, moneyRights: artifact.moneyRights, coinRights: 0,
    operationPermissions: structuredClone(artifact.operationPermissions) as ModuleEngineRevisionDefinition["operationPermissions"], eligibleFamilies: [artifact.familyId] };
  const manifest = createReviewedModuleEngineManifest({ job: { artifact, plan }, descriptor: checked.request.descriptor, release, definition, revision });
  const manifestHash = computeModuleEngineHostManifestHash(manifest);
  const contents: Omit<ModuleReviewDecisionRecordV1, "decisionDigest"> = { schemaVersion: "programmable.modules.review-decision.v1", reviewerWallet: address(999), policyDigest: hash(55), subject,
    command: { schemaVersion: "programmable.modules.review-command.v1", submissionId: subject.submissionId, requestDigest: subject.requestDigest,
      expectedReviewRevision: 2, outcome: "accept", reason: "Synthetic acceptance fixture, never reviewer authority.", artifactDigest: artifact.artifactDigest,
      hostManifestHash: manifestHash, acknowledgedReviewAreas: [...artifact.reviewRequired] }, decidedAt: "2026-09-07T01:00:00.000Z", registryApproved: false, available: false };
  const review = { ...contents, decisionDigest: computeModuleReviewDecisionDigestV1(contents) };
  const template = { status: "available" as const, manifest, manifestHash, reviewDigest: review.decisionDigest };
  const publication: ModuleEngineCatalogPublication = { template, requestDigest: subject.requestDigest, review, reviewedBuild: { subject, plan, artifact } };
  const catalog = { schemaVersion: MODULE_ENGINE_CATALOG_SCHEMA, sourceReleaseDigest: release.releaseDigest, entries: [publication] };
  const responses = { source, manifest, review };
  const fetchPublic = vi.fn<typeof fetch>(async (url, init) => {
    const kind = String(url).split("/").at(-1)?.replace(".json", "") as keyof typeof responses;
    expect(String(url)).toBe(moduleModePublicationUrl(artifact.packageId, kind));
    expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store", headers: { accept: "application/json" } });
    return Response.json(responses[kind]);
  });
  const authenticateRelease = vi.fn(async (actual: ModuleEngineRelease) => { expect(actual).toEqual(release); });
  const dependencies: ModuleEngineAvailabilityDependencies = { releaseProfile: release, catalogFile: catalog, collector: () => ({ authenticateRelease }), fetchPublic };
  return { source, release, subject, plan, artifact, definition, revision, manifest, review, template, publication, catalog, responses, fetchPublic, authenticateRelease, dependencies };
}
function redigestReview(publication: ModuleEngineCatalogPublication) {
  const { decisionDigest: _digest, ...contents } = publication.review;
  void _digest;
  publication.review = { ...contents, decisionDigest: computeModuleReviewDecisionDigestV1(contents) };
  publication.template.reviewDigest = publication.review.decisionDigest;
}
function availability(f: ReturnType<typeof fixture>): ModuleEngineAvailability {
  return { schemaVersion: MODULE_ENGINE_AVAILABILITY_SCHEMA, release: f.release, templates: [f.template], reason: null };
}

describe("Engine publication authority and immutable bytes", () => {
  it("reconstructs the complete compiled artifact and exact public manifest from source", () => {
    const f = fixture();
    expect(verifyModuleEnginePublication({ ...f, ...f.responses })).toEqual(f.template);
    expect(bindModuleEngineCatalogFile(f.catalog, f.release)).toEqual(f.catalog);
  });
  it("rejects a preparation even when its digests and accepted review are internally consistent", () => {
    const f = fixture();
    const prepared = { schemaVersion: MODULE_ENGINE_CATALOG_SCHEMA, sourceReleaseDigest: f.release.releaseDigest,
      entries: [{ status: "prepared", available: false, manifest: f.manifest, manifestHash: f.template.manifestHash,
        reviewDigest: f.review.decisionDigest, requestDigest: f.subject.requestDigest, review: f.review }] };
    expect(() => bindModuleEngineCatalogFile(prepared, f.release)).toThrow();
    expect(() => bindModuleEngineCatalogFile({ ...f.catalog, entries: [{ ...f.publication, reviewedBuild: undefined }] }, f.release)).toThrow();
  });
  it("requires exact source bytes and the complete public review", () => {
    const f = fixture(), source = structuredClone(f.source), review = { ...f.review, command: { ...f.review.command } };
    source.files[0].bytes = Buffer.from("Changed bytes").toString("base64");
    expect(() => verifyModuleEnginePublication({ ...f, ...f.responses, source })).toThrow("source bytes");
    review.command.reason = "Different accepted explanation changes the review identity.";
    expect(() => verifyModuleEnginePublication({ ...f, ...f.responses, review })).toThrow("review decision");
    const publication = mutablePublication(f.publication); publication.review.command.reason = review.command.reason; redigestReview(publication);
    expect(() => verifyModuleEnginePublication({ ...f, publication, ...f.responses })).toThrow("public review");
  });
  it.each(["request", "manifest", "artifact", "decision", "subject", "coverage", "reviewer"] as const)("rejects substituted %s acceptance binding", kind => {
    const f = fixture(), p = mutablePublication(f.publication);
    if (kind === "request") p.requestDigest = hash(555);
    if (kind === "manifest") p.review.command.hostManifestHash = hash(556);
    if (kind === "artifact") p.review.command.artifactDigest = hash(557);
    if (kind === "decision") p.template.reviewDigest = hash(558);
    if (kind === "subject") p.reviewedBuild.subject.principalId = "00000000-0000-4000-8000-000000000099";
    if (kind === "coverage") p.review.command.acknowledgedReviewAreas = [];
    if (kind === "reviewer") p.review.reviewerWallet = p.review.subject.author;
    if (["manifest", "artifact", "coverage", "reviewer"].includes(kind)) redigestReview(p);
    expect(() => bindModuleEngineCatalogFile({ ...f.catalog, entries: [p] }, f.release)).toThrow();
  });
  it("rejects a validly rehashed compiler substitution during full source reconstruction", () => {
    const f = fixture(), p = mutablePublication(f.publication), artifact = p.reviewedBuild.artifact;
    artifact.compiler.binarySha256 = `sha256:${"99".repeat(32)}`;
    const { artifactDigest: _digest, ...contents } = artifact;
    void _digest;
    artifact.artifactDigest = reviewDigest("programmable.modules.engine-build.v1", contents);
    p.template.manifest.manifest.source.compiler = artifact.compiler;
    p.template.manifest.manifest.source.artifactDigest = artifact.artifactDigest;
    p.template.manifestHash = computeModuleEngineHostManifestHash(p.template.manifest);
    p.review.command.artifactDigest = artifact.artifactDigest; p.review.command.hostManifestHash = p.template.manifestHash; redigestReview(p);
    expect(() => verifyModuleEnginePublication({ release: f.release, publication: p, source: f.source, manifest: p.template.manifest, review: p.review })).toThrow("BUILD_BINDING");
  });
  it("rejects a published manifest with an unreviewed revision permission", () => {
    const f = fixture(), manifest = structuredClone(f.manifest);
    manifest.manifest.revision.operationPermissions[0].authorization = 1;
    expect(() => verifyModuleEnginePublication({ ...f, ...f.responses, manifest })).toThrow("public manifest");
  });
  it("rejects duplicate IDs, another exact release and native source impersonation", () => {
    const f = fixture(), other = fixture(2);
    expect(() => bindModuleEngineCatalogFile({ ...f.catalog, entries: [f.publication, f.publication] }, f.release)).toThrow("Duplicate");
    expect(() => bindModuleEngineCatalogFile(f.catalog, other.release)).toThrow("another release");
    expect(() => bindModuleEngineCatalogFile({ ...f.catalog, sourceReleaseDigest: other.release.releaseDigest }, other.release)).toThrow();
    expect(() => bindModuleEngineCatalogFile({ ...f.catalog, entries: [{ ...f.publication, template: { ...f.template, status: "native" } }] }, f.release)).toThrow();
  });
});

describe("bounded Engine availability using the existing source authority", () => {
  it("starts honestly disabled without fabricated release IDs, network calls or templates", async () => {
    expect(configuredModuleEngineReleaseDigests()).toEqual([]);
    expect(await readModuleEngineAvailability()).toEqual({ schemaVersion: MODULE_ENGINE_AVAILABILITY_SCHEMA, release: null, templates: [], reason: "Engine modules are being prepared." });
    expect((await readModuleEngineAvailability(hash(999))).release).toBeNull();
  });
  it("authenticates the installed release and returns only the public template shape", async () => {
    const f = fixture(), result = await createModuleEngineAvailabilityReader(f.dependencies)();
    expect(result).toEqual(availability(f)); expect(f.authenticateRelease).toHaveBeenCalledOnce(); expect(f.fetchPublic).toHaveBeenCalledTimes(3);
    const json = JSON.stringify(result);
    for (const key of ["reviewedBuild", "principalId", "submissionId", "reviewerWallet", "workerIdentity", "acknowledgedReviewAreas"]) expect(json).not.toContain(key);
  });
  it("keeps source authority mandatory even when the public bytes are valid", async () => {
    const f = fixture(); f.authenticateRelease.mockRejectedValue(new Error("Private service detail must stay private"));
    const result = await createModuleEngineAvailabilityReader(f.dependencies)();
    expect(result.release).toBeNull(); expect(result.templates).toEqual([]); expect(result.reason).not.toContain("Private"); expect(f.fetchPublic).not.toHaveBeenCalled();
  });
  it("bounds missing public files, redirects, MIME, duplicate JSON and excessive declared bytes", async () => {
    const responses = [new Response("{}", { status: 404 }), new Response("{}", { status: 302, headers: { location: "https://untrusted.invalid" } }),
      new Response("{}", { headers: { "content-type": "text/html" } }), new Response('{"a":1,"a":2}', { headers: { "content-type": "application/json" } }),
      new Response("{}", { headers: { "content-type": "application/json", "content-length": String(64 * 1024 * 1024) } })];
    for (const response of responses) {
      const f = fixture(); f.fetchPublic.mockResolvedValueOnce(response);
      expect((await createModuleEngineAvailabilityReader(f.dependencies)()).release).toBeNull();
    }
  });
  it("caps a stalled public read even when the transport ignores abort", async () => {
    const f = fixture(); f.fetchPublic.mockImplementation(() => new Promise(() => undefined));
    const result = await createModuleEngineAvailabilityReader({ ...f.dependencies, budgetMs: 20 })();
    expect(result.release).toBeNull(); expect(f.fetchPublic.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it("coalesces callers, returns isolated snapshots and expires authority before publication cache", async () => {
    const f = fixture(); let now = 1_000;
    const read = createModuleEngineAvailabilityReader({ ...f.dependencies, now: () => now });
    const [first, second] = await Promise.all([read(), read()]);
    expect(f.authenticateRelease).toHaveBeenCalledTimes(1); expect(f.fetchPublic).toHaveBeenCalledTimes(3);
    first.templates.length = 0; expect(second.templates).toHaveLength(1); expect((await read()).templates).toHaveLength(1);
    now += MODULE_MODE_AVAILABILITY_TTL_MS + 1;
    await read(); expect(f.authenticateRelease).toHaveBeenCalledTimes(2); expect(f.fetchPublic).toHaveBeenCalledTimes(3);
    now += MODULE_MODE_PUBLICATION_TTL_MS + 1;
    await read(); expect(f.fetchPublic).toHaveBeenCalledTimes(6);
  });
  it("never lets cached publications override a revoked or unavailable installed source", async () => {
    const f = fixture(); let now = 0;
    const read = createModuleEngineAvailabilityReader({ ...f.dependencies, now: () => now });
    expect((await read()).release).toEqual(f.release);
    now += MODULE_MODE_AVAILABILITY_TTL_MS + 1; f.authenticateRelease.mockRejectedValueOnce(new Error("Unavailable"));
    expect((await read()).release).toBeNull();
    now += MODULE_MODE_UNAVAILABLE_TTL_MS + 1; expect((await read()).release).toEqual(f.release); expect(f.fetchPublic).toHaveBeenCalledTimes(3);
  });
  it("includes activation evidence and accepted review in publication-cache identity", async () => {
    const f = fixture(); let now = 0;
    const read = createModuleEngineAvailabilityReader({ ...f.dependencies, now: () => now });
    await read(); f.release.lifecycleEvidenceDigest = hash(666); now += MODULE_MODE_AVAILABILITY_TTL_MS + 1;
    await read(); expect(f.fetchPublic).toHaveBeenCalledTimes(6);
    f.publication.review = { ...f.publication.review, command: { ...f.publication.review.command, reason: "New exact historical review receipt fixture." } }; redigestReview(f.publication);
    f.responses.review = f.publication.review; now += MODULE_MODE_AVAILABILITY_TTL_MS + 1;
    await read(); expect(f.fetchPublic).toHaveBeenCalledTimes(9);
  });
  it("uses the installed source endpoint with the exact digest and complete activation comparison", async () => {
    const f = fixture(), fetchBackend = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe("https://backend.invalid/internal/module-mode-index/v1/release");
      expect(JSON.parse(String(init?.body))).toEqual({ sourceReleaseDigest: f.release.releaseDigest });
      expect(init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
      return Response.json({ schemaVersion: "programmable.module-mode-index.v1", result: f.release });
    });
    const collector = createModuleModeHttpCollector({ backendBaseUrl: "https://backend.invalid", websiteToken: "synthetic_test_service_credential_00000000", fetchBackend });
    await expect(collector.authenticateRelease(f.release)).resolves.toBeUndefined();
    fetchBackend.mockResolvedValueOnce(Response.json({ schemaVersion: "programmable.module-mode-index.v1", result: { ...f.release, lifecycleEvidenceDigest: hash(777) } }));
    await expect(collector.authenticateRelease(f.release)).rejects.toThrow("active release differs");
  });
});

describe("exact historical Engine generations", () => {
  it("retains an authenticated historical template without sampling mutable revision enablement", async () => {
    const f = fixture();
    const read = createModuleEngineHistoricalAvailabilityReader({ historical: { schemaVersion: MODULE_ENGINE_HISTORICAL_RELEASES_SCHEMA,
      releases: [{ release: f.release, catalog: f.catalog }] }, dependencies: f.dependencies });
    expect(await read(f.release.releaseDigest.toUpperCase().replace("0X", "0x"))).toEqual(availability(f));
    expect((await read(hash(999))).release).toBeNull(); expect(f.authenticateRelease).toHaveBeenCalledOnce();
  });
  it("rejects duplicate or unbounded historical authority snapshots", () => {
    const f = fixture(), entry = { release: f.release, catalog: f.catalog };
    for (const releases of [[entry, entry], Array.from({ length: 33 }, () => entry)]) expect(() => createModuleEngineHistoricalAvailabilityReader({
      historical: { schemaVersion: MODULE_ENGINE_HISTORICAL_RELEASES_SCHEMA, releases }, dependencies: f.dependencies })).toThrow();
  });
  it("keeps healthy launch versions when another historical generation is unavailable or substituted", async () => {
    const f = fixture(), g = fixture(2), read = vi.fn(async (digest: string) => {
      if (digest === f.release.releaseDigest) return availability(f);
      if (digest === hash(888)) return availability(g);
      throw new Error("One unavailable history");
    });
    expect(await readModuleEngineLaunchVersions({ digests: [f.release.releaseDigest, g.release.releaseDigest, hash(888), f.release.releaseDigest], read })).toEqual([
      { releaseDigest: f.release.releaseDigest, label: `Engine v1 · ${f.release.releaseDigest.slice(2, 10)}`, sourceKind: "module-engine-v1" },
    ]);
    expect(read).toHaveBeenCalledTimes(3);
    await expect(readModuleEngineLaunchVersions({ digests: Array.from({ length: 34 }, (_, n) => hash(n + 1)), read })).rejects.toThrow("inventory");
  });
});
