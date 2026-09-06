import { encodeAbiParameters, encodeFunctionData, getCreate2Address, keccak256, parseAbi, parseAbiParameters, toHex, type Address, type Hex } from "viem";
import { moduleAddress, computeModuleModeReleaseDigest } from "../../lib/module-mode/release";
import { nativeJson, type NativeModuleModeCatalogEntry } from "../../lib/module-mode/native-catalog";
import { createModuleModeHostManifest, computeModuleModeHostManifestHash, verifyModuleModePublication, type ModuleModeCatalogDefinition, type ModuleModeHostReleaseIdentity, type ModuleModeCatalogPublication } from "../../lib/server/module-mode/catalog";
import { validateModuleSubmissionRequest } from "../../packages/classic-modules/src/open-transport.mjs";
import { acceptedDecision, need, requireAuthenticatedReview, reviewDigest, same, type AuthenticatedReview } from "./review";
import { reviewRecord } from "../../lib/module-mode/review-contract";

export const CREATE2_DEPLOYER = Object.freeze({ address: "0x4e59b44847b379578588920ca78fbf26c0b4956c" as Address,
  runtimeCodeHash: "0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989" as Hex });
export const REGISTRY_ABI = parseAbi([
  "function owner() view returns (address)",
  "function families(bytes32 familyId) view returns (address author,address wallet)",
  "function registerReviewedFamily(address author,bytes32 salt,address rewardWallet,bytes32 submissionDigest) returns (bytes32)",
  "function approveRevision(bytes32 packageId,bytes32 familyId,address factory,bytes32 moduleCodeHash,bytes32 manifestHash,uint32 callbackGas)",
  "function getRevision(bytes32 packageId) view returns ((bytes32 familyId,address factory,bytes32 factoryCodeHash,bytes32 moduleCodeHash,bytes32 manifestHash,uint32 callbackGas,bool enabled) revision)",
  "event RevisionApproved(bytes32 indexed packageId,bytes32 indexed familyId,(bytes32 familyId,address factory,bytes32 factoryCodeHash,bytes32 moduleCodeHash,bytes32 manifestHash,uint32 callbackGas,bool enabled) revision)",
]);
export interface PublicationCall { action: "deployFactory" | "registerReviewedFamily" | "approveRevision"; chainId: 4663; from: Address; to: Address; value: "0x0"; data: Hex }
export function createHostPreparation(review: AuthenticatedReview, releaseValue: ModuleModeHostReleaseIdentity, definition: ModuleModeCatalogDefinition) {
  requireAuthenticatedReview(review);
  const release = nativeJson(releaseValue) as ModuleModeHostReleaseIdentity;
  need(release.releaseDigest === computeModuleModeReleaseDigest(release), "Release identity digest differs");
  const source = validateModuleSubmissionRequest(review.source); need(source.ok, "Invalid source submission");
  need(definition.source.path === review.artifact.program.sourcePath, "Published source is not the reviewed program component");
  const reviewedPlan = reviewRecord(review.job.plan), reviewedArtifact = reviewRecord(review.artifact);
  need(reviewedPlan.configurationCodec === "programmable.native-abi@1" && reviewedArtifact.configurationCodec === "programmable.native-abi@1", "Reviewed native configuration codec required");
  same(reviewedPlan.programAbi, reviewedArtifact.programAbi, "Reviewed build ABI mapping");
  same(reviewedPlan.programAbi, definition.programAbi, "Published configuration ABI mapping");
  const salt = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint256,bytes32,bytes32"),
    [keccak256(toHex("programmable.module-mode.factory.v1")), 4663n, release.releaseDigest, source.packageId]));
  const factory = getCreate2Address({ from: CREATE2_DEPLOYER.address, salt, bytecodeHash: review.artifact.factory.creationCodeHash }).toLowerCase() as Address;
  const nativeBinding = { familyId: source.familyId, packageId: source.packageId, factory,
    factoryCodeHash: review.artifact.factory.runtimeCodeHash, moduleCodeHash: review.artifact.program.runtimeCodeHash, callbackGas: review.artifact.callbackGas };
  const manifest = createModuleModeHostManifest({ release, definition, nativeBinding, descriptor: source.request.descriptor });
  return { schemaVersion: "programmable.module-mode-host-preparation.v1" as const, status: "review-required" as const, release,
    requestDigest: source.requestDigest, artifactDigest: review.artifact.artifactDigest, salt, nativeBinding, manifest,
    manifestHash: computeModuleModeHostManifestHash(manifest) };
}
export function prepareModulePublication(review: AuthenticatedReview, release: ModuleModeHostReleaseIdentity, definition: ModuleModeCatalogDefinition, reviewAuthority: Address) {
  const host = createHostPreparation(review, release, definition), decision = acceptedDecision(review);
  const owner = moduleAddress(reviewAuthority, "registry.owner");
  need(decision.command.hostManifestHash === host.manifestHash, "Acceptance covers another host manifest");
  const entry: NativeModuleModeCatalogEntry = { ...definition, status: "available", nativeBinding: { ...host.nativeBinding, manifestHash: host.manifestHash, reviewDigest: decision.decisionDigest } };
  const publication: ModuleModeCatalogPublication = { entry, requestDigest: review.job.subject.requestDigest, review: decision };
  verifyModuleModePublication({ release: host.release, publication, source: review.source, manifest: host.manifest, review: decision });
  const registry = host.release.contracts.registry.address;
  const base = { chainId: 4663 as const, from: owner, value: "0x0" as const };
  const calls: PublicationCall[] = [
    { ...base, action: "deployFactory", to: CREATE2_DEPLOYER.address, data: `${host.salt}${review.artifact.factory.creationBytecode.slice(2)}` },
    { ...base, action: "registerReviewedFamily", to: registry, data: encodeFunctionData({ abi: REGISTRY_ABI, functionName: "registerReviewedFamily",
      args: [moduleAddress(review.source.descriptor.author, "author"), review.source.descriptor.familySalt, moduleAddress(review.source.descriptor.rewardWallet, "reward"), review.job.subject.requestDigest] }) },
    { ...base, action: "approveRevision", to: registry, data: encodeFunctionData({ abi: REGISTRY_ABI, functionName: "approveRevision",
      args: [host.nativeBinding.packageId, host.nativeBinding.familyId, host.nativeBinding.factory, host.nativeBinding.moduleCodeHash, host.manifestHash, host.nativeBinding.callbackGas] }) },
  ];
  const contents = { schemaVersion: "programmable.module-mode-publication-plan.v1" as const,
    status: "unsigned-revalidation-required" as const, chainId: 4663 as const, release: host.release,
    submissionId: review.job.subject.submissionId, reviewRevision: review.job.reviewRevision, requestDigest: host.requestDigest,
    artifactDigest: host.artifactDigest, reviewDigest: decision.decisionDigest, reviewAuthority: owner, manifest: host.manifest, publication, calls,
    preconditions: { family: "register only if absent; otherwise require exact author and current reward wallet",
      revision: "immutable; never overwrite or automatically re-enable", factory: "deploy only if vacant; existing exact code still requires the actual deployment transaction",
      transactions: "Each call must be simulated immediately before signing. This file is not an armed wallet request." } };
  return { ...contents, planDigest: reviewDigest("programmable.module-mode-publication-plan.v1", contents) };
}
export type PublicationPlan = ReturnType<typeof prepareModulePublication>;
export function assertPublicationPlan(plan: PublicationPlan, review: AuthenticatedReview) {
  const expected = prepareModulePublication(review, plan.release, plan.manifest.manifest.catalogDefinition, plan.reviewAuthority);
  same(plan, expected, "Publication plan");
}
