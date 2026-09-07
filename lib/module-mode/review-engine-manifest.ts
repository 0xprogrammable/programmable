import type { ModuleEngineCatalogDefinition, ModuleEngineReleaseIdentity, ModuleEngineRevisionDefinition } from "../module-engine/catalog";
import { createModuleEngineHostManifest, ENGINE_ZERO_ADDRESS, ENGINE_ZERO_HASH } from "../module-engine/catalog";
import { nativeCanonicalJson } from "./native-catalog";
import type { ReviewJob } from "./review-contract";
import type { OpenSourcePackage } from "../../packages/classic-modules/src/open-packages.mjs";

/** The same build-to-manifest binding is enforced at independent review and publication. */
export function createReviewedModuleEngineManifest(input: { job: ReviewJob; descriptor: OpenSourcePackage;
  release: ModuleEngineReleaseIdentity; definition: ModuleEngineCatalogDefinition; revision: ModuleEngineRevisionDefinition }) {
  const { artifact, plan } = input.job;
  if (artifact?.schemaVersion !== "programmable.modules.engine-build.v1" || plan?.schemaVersion !== "programmable.modules.engine-build-plan.v1") throw new Error("Reviewed engine build and plan required.");
  const revision = input.revision;
  const same = (a: unknown, b: unknown, label: string) => { if (nativeCanonicalJson(a) !== nativeCanonicalJson(b)) throw new Error(`Engine ${label} differs from the protected build.`); };
  same(revision.packageId, artifact.packageId, "package"); same(revision.familyId, artifact.familyId, "family");
  for (const key of ["executionGas", "moneyRights", "coinRights", "operationPermissions"] as const) same(revision[key], artifact[key], key);
  same(input.definition.configurationAbi, artifact.configurationAbi, "configuration mapping"); same(plan.configurationAbi, artifact.configurationAbi, "plan configuration mapping");
  if (artifact.testEconomics.platformBps !== (revision.eligibleFamilies.length ? 30 : 10)) throw new Error("Engine fee-family mode differs from the protected economics vectors.");
  const positive = artifact.cases.filter(c => c.expectedDeployment === "success");
  if (revision.fixedQuoteAsset !== ENGINE_ZERO_ADDRESS && !positive.some(c => c.quoteAsset === revision.fixedQuoteAsset)) throw new Error("Fixed quote asset has no successful reviewed instance.");
  if (revision.fixedConfigurationHash !== ENGINE_ZERO_HASH && !positive.some(c => c.configHash === revision.fixedConfigurationHash && (revision.fixedQuoteAsset === ENGINE_ZERO_ADDRESS || c.quoteAsset === revision.fixedQuoteAsset))) throw new Error("Fixed configuration has no successful reviewed instance.");
  if (revision.initialOperationId !== ENGINE_ZERO_HASH && !positive.some(c => c.operations.some(o => o.operationId === revision.initialOperationId && o.actor === "creator" && o.expectedOutcome === "success"))) throw new Error("Initial operation has no successful creator vector.");
  if (input.definition.interface === "quote-v1" && revision.fixedConfigurationHash === ENGINE_ZERO_HASH) throw new Error("Quote engine dependencies require a fixed reviewed configuration.");
  return createModuleEngineHostManifest({ release: input.release, definition: input.definition, revision, descriptor: input.descriptor,
    source: { requestDigest: artifact.subject.requestDigest, artifactDigest: artifact.artifactDigest, sourceManifestHash: artifact.sourceManifestHash,
      configurationSchemaHash: artifact.configurationSchemaHash, compiler: artifact.compiler, engine: artifact.engine } });
}
