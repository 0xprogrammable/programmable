import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import frozen from "./fixtures/module-engine-review-build.json";
import { fixture, addr, hash } from "./module-engine-fixture";
import { ModuleDetailDialog } from "../components/module-detail-dialog";
import { ModuleEngineLibrary } from "../components/module-engine-library";
import { computeModuleEngineHostManifestHash, type ModuleEngineCatalogDefinition, type ModuleEngineRevisionDefinition, type ModuleEngineAvailability } from "../lib/module-engine/catalog";
import { isModuleEnginePublicCapabilities, moduleEngineAssetRoles, moduleEngineOperationLabel } from "../lib/module-engine/public-details";
import { ENGINE_OPERATIONS } from "../lib/module-engine/client";
import { moduleDetailsForLaunch, readPublicModuleDetailsResponse } from "../lib/module-mode/public-details";
import { createReviewedModuleEngineManifest } from "../lib/module-mode/review-engine-manifest";
import { parseReviewSubject } from "../lib/module-mode/review-contract";
import { parseEngineReviewArtifact, validateModuleEngineBuildPlanV1 } from "../lib/module-mode/review-engine-contract";
import { validateModuleSubmissionRequest } from "../packages/classic-modules/src/open-transport.mjs";
import { MODULE_ENGINE_CATALOG_SCHEMA } from "../lib/server/module-engine/publication";
import { configuredPublicModuleEngineCatalog, readPublicModuleEngineDetails, resolvePublicModuleEngineDetails } from "../lib/server/module-engine/public-details";
import { computeModuleReviewDecisionDigestV1, type ModuleReviewDecisionRecordV1 } from "../lib/server/module-mode/review-decision-wire-v1";

function publicationFixture() {
  const { release } = fixture(), checked = validateModuleSubmissionRequest(frozen.source);
  if (!checked.ok) throw new Error("Invalid synthetic source");
  const subject = parseReviewSubject(frozen.subject), plan = validateModuleEngineBuildPlanV1(frozen.plan, subject), artifact = parseEngineReviewArtifact(frozen.artifact, subject, plan);
  const definition: ModuleEngineCatalogDefinition = { id: "fixture-engine", title: "Engine publication", summary: "Synthetic fixture only.", detail: "Reviewed operations remain bound to this exact published revision.",
    version: checked.request.descriptor.version, interface: "custom-v1", source: checked.request.descriptor.source.files[0], schema: checked.request.descriptor.configuration,
    defaults: { cap: "5" }, configurationAbi: artifact.configurationAbi, constraints: [] };
  const revision: ModuleEngineRevisionDefinition = { packageId: artifact.packageId, familyId: artifact.familyId, fixedQuoteAsset: addr(0), fixedConfigurationHash: hash(0), initialOperationId: hash(0),
    executionGas: artifact.executionGas, moneyRights: artifact.moneyRights, coinRights: 0, operationPermissions: artifact.operationPermissions.map(permission => ({ ...permission })), eligibleFamilies: [artifact.familyId] };
  const manifest = createReviewedModuleEngineManifest({ job: { artifact, plan }, descriptor: checked.request.descriptor, release, definition, revision }), manifestHash = computeModuleEngineHostManifestHash(manifest);
  const contents: Omit<ModuleReviewDecisionRecordV1, "decisionDigest"> = { schemaVersion: "programmable.modules.review-decision.v1", reviewerWallet: addr(999), policyDigest: hash(900), subject,
    command: { schemaVersion: "programmable.modules.review-command.v1", submissionId: subject.submissionId, requestDigest: subject.requestDigest, expectedReviewRevision: 1,
      outcome: "accept", reason: "Synthetic accepted receipt, never publication authority.", artifactDigest: artifact.artifactDigest, hostManifestHash: manifestHash, acknowledgedReviewAreas: artifact.reviewRequired },
    decidedAt: "2026-09-07T01:00:00.000Z", registryApproved: false, available: false };
  const review = { ...contents, decisionDigest: computeModuleReviewDecisionDigestV1(contents) }, template = { status: "available" as const, manifest, manifestHash, reviewDigest: review.decisionDigest };
  const catalog = { schemaVersion: MODULE_ENGINE_CATALOG_SCHEMA, sourceReleaseDigest: release.releaseDigest, entries: [{ template, requestDigest: subject.requestDigest, review, reviewedBuild: { subject, plan, artifact } }] };
  const availability: ModuleEngineAvailability = { schemaVersion: "programmable.module-engine.availability.v1", release, templates: [template], reason: null };
  return { catalog, availability, template, subject, artifact };
}

describe("public Engine publications", () => {
  it("uses accepted authorship and exact registered operations without private build fields", () => {
    const f = publicationFixture(), response = resolvePublicModuleEngineDetails(f.availability, f.catalog)!;
    expect(response.sourceKind).toBe("module-engine-v1"); expect(response.items[0].author).toBe(f.subject.author);
    expect(response.items[0]).toMatchObject({ sourceKind: "module-engine-v1", engine: { operations: f.artifact.operationPermissions } });
    expect(JSON.stringify(response)).not.toMatch(/principalId|submissionId|reviewerWallet|reviewedBuild|rewardWallet|compiler|creationBytecode/);
    expect(readPublicModuleDetailsResponse(response)).toEqual(response);
  });
  it("does not project an unauthenticated source or a changed template", () => {
    const f = publicationFixture();
    expect(resolvePublicModuleEngineDetails({ ...f.availability, release: null }, f.catalog)).toBeNull();
    const changed = structuredClone(f.availability); changed.templates[0].manifest.manifest.catalogDefinition.title = "Substituted";
    expect(resolvePublicModuleEngineDetails(changed, f.catalog)?.items).toEqual([]);
    expect(resolvePublicModuleEngineDetails(f.availability, { ...f.catalog, sourceReleaseDigest: hash(444) })).toBeNull();
  });
  it("keeps the disabled current source and unknown history unavailable", async () => {
    expect(configuredPublicModuleEngineCatalog(hash(777))).toBeNull();
    expect(await readPublicModuleEngineDetails(hash(777))).toBeNull();
  });
  it("never applies Native details to an Engine or Engine details to a Native row", () => {
    const f = publicationFixture(), details = resolvePublicModuleEngineDetails(f.availability, f.catalog)!;
    const item = details.items[0], launch = { sourceKind: "module-engine-v1" as const, sourceReleaseDigest: details.releaseDigest, modulePackageIds: [item.packageId], moduleFamilyIds: [item.familyId] };
    expect(moduleDetailsForLaunch(launch, details)[0].details).toEqual(item);
    expect(moduleDetailsForLaunch({ ...launch, sourceKind: "module-native-v2" }, details)[0].details).toBeNull();
    expect(moduleDetailsForLaunch(launch, { ...details, sourceKind: undefined })[0].details).toBeNull();
    expect(moduleDetailsForLaunch({ ...launch, sourceReleaseDigest: hash(999) }, details)[0].details).toBeNull();
    expect(moduleDetailsForLaunch({ ...launch, moduleFamilyIds: [hash(999)] }, details)[0].details).toBeNull();
    for (const invalid of [{ ...details, sourceKind: undefined }, { ...details, sourceKind: "unknown" }, { ...details, items: [{ ...item, sourceKind: undefined }] }]) expect(readPublicModuleDetailsResponse(invalid)).toBeNull();
  });
  it("shows precise role bits and only the operation names actually supplied", () => {
    expect([0, 1, 2, 4, 7].map(moduleEngineAssetRoles)).toEqual(["None", "Primary token", "Quote asset", "ETH", "Primary token, Quote asset, ETH"]);
    expect(moduleEngineOperationLabel(ENGINE_OPERATIONS.deposit)).toBe("Deposit");
    expect(moduleEngineOperationLabel(hash(77))).toMatch(/^Custom operation /u);
    const f = publicationFixture(), item = resolvePublicModuleEngineDetails(f.availability, f.catalog)!.items[0];
    const html = renderToStaticMarkup(<ModuleDetailDialog module={item} onClose={() => {}} />);
    expect(html).toContain("Reviewed operations"); expect(html).toContain("Creator request"); expect(html).toContain("Quote asset");
    expect(html).not.toContain("Mint"); expect(html).not.toContain("Burn");
    expect(isModuleEnginePublicCapabilities({ interface: "custom-v1", operations: [{ operationId: hash(1), inputRoles: 8, outputRoles: 0, authorization: 0 }] })).toBe(false);
  });
  it("uses Engine templates directly in the library without a Native binding or guessed author", () => {
    const f = fixture();
    const html = renderToStaticMarkup(<ModuleEngineLibrary templates={[f.template]} selectedId={f.template.manifest.manifest.catalogDefinition.id} onSelect={() => {}} />);
    expect(html).toContain("Template library"); expect(html).toContain("Search templates"); expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Deposit"); expect(html).not.toContain("By 0x"); expect(html).not.toContain("nativeBinding");
  });
});
