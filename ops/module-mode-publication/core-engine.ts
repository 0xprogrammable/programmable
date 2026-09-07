import { encodeFunctionData, type Address } from "viem";
import { moduleAddress } from "../../lib/module-mode/release";
import { nativeJson } from "../../lib/module-mode/native-catalog";
import { moduleEngineHostAbi } from "../../lib/module-engine/abi";
import { computeModuleEngineHostManifestHash, moduleEngineReleaseIdentity, type ModuleEngineCatalogDefinition, type ModuleEngineReleaseIdentity, type ModuleEngineRevisionDefinition } from "../../lib/module-engine/catalog";
import { createReviewedModuleEngineManifest } from "../../lib/module-mode/review-engine-manifest";
import { acceptedDecision, need, requireEngineReview, reviewDigest, same, type AuthenticatedReview } from "./review";
import { REGISTRY_ABI, type PublicationCall } from "./core";
import { reviewRecord } from "../../lib/module-mode/review-contract";

export interface EnginePublicationDefinition { profile: "programmable.module-engine-solidity@1"; catalogDefinition: ModuleEngineCatalogDefinition; revision: ModuleEngineRevisionDefinition }
export function createEngineHostPreparation(review: AuthenticatedReview, releaseValue: ModuleEngineReleaseIdentity, definition: EnginePublicationDefinition) {
  requireEngineReview(review);
  const d = reviewRecord(nativeJson(definition), ["profile", "catalogDefinition", "revision"]);
  need(d.profile === "programmable.module-engine-solidity@1", "Engine publication definition required");
  const release = moduleEngineReleaseIdentity(releaseValue);
  const manifest = createReviewedModuleEngineManifest({ job: review.job, descriptor: review.source.descriptor, release, definition: d.catalogDefinition as ModuleEngineCatalogDefinition, revision: d.revision as ModuleEngineRevisionDefinition });
  return { schemaVersion: "programmable.module-engine-host-preparation.v1" as const, status: "review-required" as const, release,
    requestDigest: review.job.subject.requestDigest, artifactDigest: review.artifact.artifactDigest,
    manifest, manifestHash: computeModuleEngineHostManifestHash(manifest) };
}
export function engineRegistryRevision(host: ReturnType<typeof createEngineHostPreparation>) {
  const r = host.manifest.manifest.revision, engine = host.manifest.manifest.source.engine;
  return { familyId: r.familyId, creationCodeHash: engine.creationCodeHash, runtimeTemplateHash: engine.runtimeTemplateHash, manifestHash: host.manifestHash,
    fixedQuoteAsset: r.fixedQuoteAsset, fixedConfigurationHash: r.fixedConfigurationHash, initialOperationId: r.initialOperationId,
    executionGas: r.executionGas, moneyRights: r.moneyRights, coinRights: r.coinRights, enabled: true as const };
}
export function prepareEnginePublication(review: AuthenticatedReview, release: ModuleEngineReleaseIdentity, definition: EnginePublicationDefinition, reviewAuthority: Address) {
  requireEngineReview(review);
  const host = createEngineHostPreparation(review, release, definition), decision = acceptedDecision(review);
  need(decision.command.hostManifestHash === host.manifestHash, "Acceptance covers another engine host manifest");
  const owner = moduleAddress(reviewAuthority, "registry.owner"), r = host.manifest.manifest.revision, engine = review.artifact.engine;
  const revision = engineRegistryRevision(host), base = { chainId: 4663 as const, from: owner, value: "0x0" as const };
  const calls: PublicationCall[] = [
    { ...base, action: "registerReviewedFamily", to: host.release.contracts.registry.address,
      data: encodeFunctionData({ abi: REGISTRY_ABI, functionName: "registerReviewedFamily", args: [moduleAddress(review.source.descriptor.author, "author"), review.source.descriptor.familySalt, moduleAddress(review.source.descriptor.rewardWallet, "reward"), review.job.subject.requestDigest] }) },
    { ...base, action: "approveRevision", to: host.release.contracts.host.address,
      data: encodeFunctionData({ abi: moduleEngineHostAbi, functionName: "approveRevision", args: [r.packageId, revision, engine.immutableRuntimeOffsets, engine.immutableConstructorOffsets, r.operationPermissions, r.eligibleFamilies] }) },
  ];
  const contents = { schemaVersion: "programmable.module-engine-publication-plan.v1" as const, status: "unsigned-revalidation-required" as const,
    chainId: 4663 as const, release: host.release, submissionId: review.job.subject.submissionId, reviewRevision: review.job.reviewRevision,
    requestDigest: host.requestDigest, artifactDigest: host.artifactDigest, reviewDigest: decision.decisionDigest, reviewAuthority: owner,
    manifest: host.manifest, manifestHash: host.manifestHash, revision, calls,
    catalogPreparation: { schemaVersion: "programmable.module-engine.catalog.v1" as const, sourceReleaseDigest: host.release.releaseDigest,
      entries: [{ status: "prepared" as const, available: false as const, manifest: host.manifest, manifestHash: host.manifestHash, reviewDigest: decision.decisionDigest,
        requestDigest: host.requestDigest, review: decision }] },
    preconditions: { family: "register only if absent; otherwise require exact author and current reward wallet",
      revision: "immutable Host revision; never overwrite or automatically re-enable", feeFamilies: "exact reviewed sorted families; each must exist before admission",
      instance: "engine creation and constructor runtime binding occur per launch; publication does not deploy an engine instance",
      transactions: "Each call must be simulated immediately before signing. This file is not an armed wallet request.",
      availability: "Preparation is not a published or finalized catalogue entry. Export requires independent onchain readback." } };
  return { ...contents, planDigest: reviewDigest("programmable.module-engine-publication-plan.v1", contents) };
}
export type EnginePublicationPlan = ReturnType<typeof prepareEnginePublication>;
export function assertEnginePublicationPlan(plan: EnginePublicationPlan, review: AuthenticatedReview) {
  same(plan, prepareEnginePublication(review, plan.release, { profile: "programmable.module-engine-solidity@1", catalogDefinition: plan.manifest.manifest.catalogDefinition, revision: plan.manifest.manifest.revision }, plan.reviewAuthority), "Engine publication plan");
}
