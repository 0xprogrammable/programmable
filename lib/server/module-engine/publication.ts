import type { Hex } from "viem";
import { bindModuleEngineTemplate, computeModuleEngineHostManifestHash, type ModuleEngineRelease, type ModuleEngineTemplate } from "@/lib/module-engine/catalog";
import { nativeJson } from "@/lib/module-mode/native-catalog";
import { moduleHash, moduleRecord } from "@/lib/module-mode/release";
import { parseReviewSubject, type ReviewSubject } from "@/lib/module-mode/review-contract";
import { parseEngineReviewArtifact, validateModuleEngineBuildPlanV1 } from "@/lib/module-mode/review-engine-contract";
import { verifyModuleEngineBuildArtifactV1 } from "@/lib/server/module-mode/review-engine-source";
import { createReviewedModuleEngineManifest } from "@/lib/module-mode/review-engine-manifest";
import type { ModuleEngineBuildArtifactV1, ModuleEngineBuildPlanV1 } from "@/lib/module-mode/review-engine-types";
import { validateModuleSubmissionRequest } from "@/packages/classic-modules/src/open-transport.mjs";
import { canonicalizeJson } from "../projection-target/canonical-json";
import { validateModuleReviewDecisionRecordV1, type ModuleReviewDecisionRecordV1 } from "../module-mode/review-decision-wire-v1";

export const MODULE_ENGINE_CATALOG_SCHEMA = "programmable.module-engine.catalog.v1" as const;
export interface ModuleEngineReviewedBuild {
  subject: ReviewSubject;
  plan: ModuleEngineBuildPlanV1;
  artifact: ModuleEngineBuildArtifactV1;
}
export interface ModuleEngineCatalogPublication {
  template: ModuleEngineTemplate;
  requestDigest: Hex;
  /** The existing authenticated publication operator supplies these exact protected records. */
  review: ModuleReviewDecisionRecordV1;
  reviewedBuild: ModuleEngineReviewedBuild;
}
export interface ModuleEngineCatalogFile {
  schemaVersion: typeof MODULE_ENGINE_CATALOG_SCHEMA;
  sourceReleaseDigest: Hex | null;
  entries: ModuleEngineCatalogPublication[];
}

function same(actual: unknown, expected: unknown, label: string): void {
  if (canonicalizeJson(actual) !== canonicalizeJson(expected)) throw new Error(`Engine publication ${label} differs.`);
}
function bindReview(value: unknown): ModuleReviewDecisionRecordV1 {
  if (!validateModuleReviewDecisionRecordV1(value)) throw new Error("Engine review decision is invalid.");
  return value;
}

/**
 * Protected, checked-in allowlist, activated only after the existing publisher's exact revision readback.
 * A prepared export is deliberately a different shape. Neither valid hashes nor a public JSON file
 * grant reviewer authority, source installation, revision admission, or website publication.
 */
export function bindModuleEngineCatalogFile(value: unknown, release: ModuleEngineRelease): ModuleEngineCatalogFile {
  const file = moduleRecord(nativeJson(value), ["schemaVersion", "sourceReleaseDigest", "entries"], "engineCatalog");
  if (file.schemaVersion !== MODULE_ENGINE_CATALOG_SCHEMA || !Array.isArray(file.entries) || file.entries.length > 1_000) throw new Error("Invalid Engine catalogue.");
  const sourceReleaseDigest = file.sourceReleaseDigest === null ? null : moduleHash(file.sourceReleaseDigest, "engineCatalog.sourceReleaseDigest");
  if ((sourceReleaseDigest === null && file.entries.length > 0) || (sourceReleaseDigest !== null && sourceReleaseDigest !== release.releaseDigest)) throw new Error("Engine catalogue belongs to another release.");
  const ids = new Set<string>(), packages = new Set<string>();
  const entries = file.entries.map(raw => {
    const entry = moduleRecord(raw, ["template", "requestDigest", "review", "reviewedBuild"], "engineCatalog.publication");
    const template = bindModuleEngineTemplate(entry.template, release), requestDigest = moduleHash(entry.requestDigest, "engineCatalog.requestDigest");
    const review = bindReview(entry.review), manifest = template.manifest.manifest;
    if (review.command.outcome !== "accept" || review.subject.requestDigest !== requestDigest
      || manifest.source.requestDigest !== requestDigest || review.command.hostManifestHash !== template.manifestHash
      || review.command.artifactDigest !== manifest.source.artifactDigest || review.decisionDigest !== template.reviewDigest) throw new Error("Engine acceptance binding differs.");
    const build = moduleRecord(entry.reviewedBuild, ["subject", "plan", "artifact"], "engineCatalog.reviewedBuild");
    const subject = parseReviewSubject(build.subject);
    same(subject, review.subject, "reviewed subject");
    const plan = validateModuleEngineBuildPlanV1(build.plan, subject);
    const artifact = parseEngineReviewArtifact(build.artifact, subject, plan);
    if (artifact.artifactDigest !== manifest.source.artifactDigest
      || artifact.reviewRequired.some(area => !review.command.acknowledgedReviewAreas.includes(area))) throw new Error("Engine reviewed build differs from acceptance.");
    if (ids.has(manifest.catalogDefinition.id) || packages.has(manifest.revision.packageId)) throw new Error("Duplicate Engine catalogue identity.");
    ids.add(manifest.catalogDefinition.id); packages.add(manifest.revision.packageId);
    return { template, requestDigest, review, reviewedBuild: { subject, plan, artifact } };
  });
  return { schemaVersion: MODULE_ENGINE_CATALOG_SCHEMA, sourceReleaseDigest, entries };
}

/** Public bytes must reconstruct the protected source/build/manifest; no private build data is returned. */
export function verifyModuleEnginePublication(input: {
  release: ModuleEngineRelease; publication: ModuleEngineCatalogPublication;
  source: unknown; manifest: unknown; review: unknown;
}): ModuleEngineTemplate {
  const { entries: [publication] } = bindModuleEngineCatalogFile({ schemaVersion: MODULE_ENGINE_CATALOG_SCHEMA,
    sourceReleaseDigest: input.release.releaseDigest, entries: [input.publication] }, input.release);
  const checked = validateModuleSubmissionRequest(input.source);
  if (!checked.ok || checked.requestDigest !== publication.requestDigest) throw new Error("Engine public source bytes differ.");
  if (checked.request.descriptor.author.toLowerCase() !== publication.review.subject.author) throw new Error("Engine source author differs from acceptance.");
  const { artifact, plan, subject } = publication.reviewedBuild;
  verifyModuleEngineBuildArtifactV1(artifact, subject, plan, checked.request);
  const template = publication.template, expected = createReviewedModuleEngineManifest({ job: { artifact, plan },
    descriptor: checked.request.descriptor, release: input.release,
    definition: template.manifest.manifest.catalogDefinition, revision: template.manifest.manifest.revision });
  same(expected, template.manifest, "protected manifest");
  same(input.manifest, expected, "public manifest");
  if (computeModuleEngineHostManifestHash(expected) !== template.manifestHash) throw new Error("Engine public manifest hash differs.");
  same(bindReview(nativeJson(input.review)), publication.review, "public review");
  return template;
}
