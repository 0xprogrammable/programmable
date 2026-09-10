import { keccak256, sha256, toHex, type Address, type Hex } from "viem";
import { assertOpenConfigSchema, type OpenConfigSchema, type OpenConfigValue } from "@/packages/classic-modules/src/open-config.mjs";
import { assertOpenConstraints, type OpenConstraint } from "@/packages/classic-modules/src/open-constraints.mjs";
import { validateOpenPackage, type OpenSourcePackage } from "@/packages/classic-modules/src/open-packages.mjs";
import type { FieldDisplay } from "@/lib/module-mode/builder";
import { nativeCanonicalJson, nativeJson } from "@/lib/module-mode/native-catalog";
import { MODULE_MODE_FINALITY_POLICY, moduleAddress, moduleBytes, moduleHash, moduleInteger, moduleRecord, moduleUint } from "@/lib/module-mode/release";
import { validateModuleEngineConfigurationAbi } from "./configuration";
import { MODULE_ENGINE_RELEASE_SCHEMA, MODULE_ENGINE_PROFILE, moduleEngineSourceId, moduleEngineContractRoles,
  type ModuleEngineReleaseProfile, type ModuleEngineNativeReleaseProfile,
  type ModuleEngineAnyQuoteReleaseProfile } from "./profile";
import { validateAnyQuoteManifestProfile } from "./any-quote-configuration";
export * from "./profile";

export const MODULE_ENGINE_CONFIGURATION_CODEC = "programmable.engine-abi@1" as const;
export const MODULE_ENGINE_HOST_MANIFEST_DOMAIN = "programmable.module-engine.host-manifest.v1" as const;
export const MODULE_ENGINE_AVAILABILITY_SCHEMA = "programmable.module-engine.availability.v1" as const;
export const ENGINE_ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
export const ENGINE_ZERO_HASH = `0x${"00".repeat(32)}` as Hex;
interface ModuleEngineReleaseFields {
  chainId: 4663; sourceCommit: string; startBlock: string; tokenCreationCodeHash: Hex;
  finalityPolicy: typeof MODULE_MODE_FINALITY_POLICY; releaseDigest: Hex;
}
export type ModuleEngineNativeReleaseIdentity = ModuleEngineReleaseFields & ModuleEngineNativeReleaseProfile;
export type ModuleEngineAnyQuoteReleaseIdentity = ModuleEngineReleaseFields & ModuleEngineAnyQuoteReleaseProfile;
export type ModuleEngineReleaseIdentity = ModuleEngineReleaseFields & ModuleEngineReleaseProfile;
export type ModuleEngineRelease = ModuleEngineReleaseIdentity & {
  enabled: true; status: "active"; deploymentEvidenceDigest: Hex; sourceVerificationDigest: Hex; lifecycleEvidenceDigest: Hex;
}
export interface ModuleEnginePermission { operationId: Hex; inputRoles: number; outputRoles: number; authorization: 0 | 1 }
export interface ModuleEngineRevisionDefinition {
  packageId: Hex; familyId: Hex; fixedQuoteAsset: Address; fixedConfigurationHash: Hex; initialOperationId: Hex;
  executionGas: number; moneyRights: number; coinRights: 0; operationPermissions: ModuleEnginePermission[]; eligibleFamilies: Hex[];
}
export interface ModuleEngineArtifact {
  componentId: string; sourcePath: string; contractName: string; abi: readonly unknown[]; abiHash: Hex;
  creationBytecode: Hex; creationCodeHash: Hex; runtimeTemplate: Hex; runtimeTemplateHash: Hex;
  immutableReferences: readonly { id: string; ranges: readonly { start: number; length: 32 }[] }[];
  immutableRuntimeOffsets: readonly number[]; immutableConstructorOffsets: readonly number[]; externalSelectors: readonly string[];
}
export interface ModuleEngineReviewedSource {
  requestDigest: Hex; artifactDigest: Hex; sourceManifestHash: Hex; configurationSchemaHash: Hex;
  compiler: { version: string; binarySha256: string; imageDigest: string; settingsHash: Hex; completeInputHash: Hex; reproducible: true };
  engine: ModuleEngineArtifact;
}
export interface ModuleEngineConfigurationComponent { readonly name: string; readonly type: string; readonly components?: readonly ModuleEngineConfigurationComponent[] }
export interface ModuleEngineConfigurationArgument { readonly path: readonly string[]; readonly type: string; readonly components?: readonly ModuleEngineConfigurationComponent[] }
export interface ModuleEngineCatalogDefinition {
  id: string; title: string; summary: string; detail: string; version: string;
  interface: "quote-v1" | "quote-shared-v1" | "escrow-v1" | "settlement-v1" | "custom-v1";
  source: { path: string; sha256: string }; schema: OpenConfigSchema; defaults: OpenConfigValue;
  configurationAbi: readonly ModuleEngineConfigurationArgument[];
  constraints: readonly OpenConstraint[]; fields?: Record<string, FieldDisplay>;
}
export interface ModuleEngineHostManifest {
  domain: typeof MODULE_ENGINE_HOST_MANIFEST_DOMAIN;
  manifest: { release: ModuleEngineReleaseIdentity; catalogDefinition: ModuleEngineCatalogDefinition;
    configurationCodec: typeof MODULE_ENGINE_CONFIGURATION_CODEC; source: ModuleEngineReviewedSource; revision: ModuleEngineRevisionDefinition };
}
export interface ModuleEngineTemplate {
  status: "available"; manifest: ModuleEngineHostManifest; manifestHash: Hex; reviewDigest: Hex;
}
export interface ModuleEngineAvailability {
  schemaVersion: typeof MODULE_ENGINE_AVAILABILITY_SCHEMA; release: ModuleEngineRelease | null; templates: ModuleEngineTemplate[]; reason: string | null;
}
const IDENTITY_KEYS = ["schemaVersion", "sourceVersion", "engineProfile", "chainId", "sourceCommit", "startBlock", "tokenCreationCodeHash", "economicsPolicyId", "finalityPolicy", "releaseDigest", "contracts"];
function need(value: unknown, message: string): asserts value { if (!value) throw new Error(`Module engine: ${message}`); }
function same(a: unknown, b: unknown, label: string) { need(nativeCanonicalJson(a) === nativeCanonicalJson(b), `${label} differs.`); }
export function moduleEngineOptionalHash(value: unknown, label: string): Hex {
  const hash = moduleBytes(value, label, 32); need(hash.length === 66, `${label} must be bytes32.`); return hash;
}
function identity(value: unknown): ModuleEngineReleaseIdentity {
  const r = moduleRecord(nativeJson(value), IDENTITY_KEYS, "engine.release");
  moduleEngineSourceId(r);
  need(r.chainId === 4663 && r.finalityPolicy === MODULE_MODE_FINALITY_POLICY, "Unsupported engine release/profile.");
  need(typeof r.sourceCommit === "string" && /^[a-f0-9]{40}$/.test(r.sourceCommit), "Invalid source commit.");
  moduleUint(r.startBlock, "engine.startBlock", true); moduleHash(r.tokenCreationCodeHash, "engine.tokenCreationCodeHash");
  moduleHash(r.economicsPolicyId, "engine.economicsPolicyId");
  const roles = moduleEngineContractRoles(r);
  const pins = moduleRecord(r.contracts, roles, "engine.contracts"); const addresses = new Set<string>();
  for (const role of roles) {
    const pin = moduleRecord(pins[role], ["address", "runtimeCodeHash"], `engine.${role}`);
    const address = moduleAddress(pin.address, role); moduleHash(pin.runtimeCodeHash, role); need(!addresses.has(address), "Duplicate release address."); addresses.add(address);
  }
  moduleHash(r.releaseDigest, "engine.releaseDigest"); return r as unknown as ModuleEngineReleaseIdentity;
}
/** Identity has no activation or proof fields, so a reviewed manifest cannot create a proof/hash cycle. */
export function computeModuleEngineReleaseDigest(value: Omit<ModuleEngineReleaseIdentity, "releaseDigest"> | ModuleEngineReleaseIdentity): Hex {
  const plain = nativeJson(value) as Record<string, unknown>;
  const picked = Object.fromEntries(IDENTITY_KEYS.filter(key => key !== "releaseDigest").map(key => [key, plain[key]]));
  identity({ ...picked, releaseDigest: `0x${"01".repeat(32)}` });
  return keccak256(toHex(nativeCanonicalJson({ domain: MODULE_ENGINE_RELEASE_SCHEMA, release: picked })));
}
export function bindModuleEngineReleaseIdentity(value: unknown): ModuleEngineReleaseIdentity {
  const r = identity(value); same(r.releaseDigest, computeModuleEngineReleaseDigest(r), "Release digest"); return r;
}
export function moduleEngineReleaseIdentity(value: ModuleEngineReleaseIdentity): ModuleEngineReleaseIdentity {
  return bindModuleEngineReleaseIdentity(Object.fromEntries(IDENTITY_KEYS.map(key => [key, (value as unknown as Record<string, unknown>)[key]])));
}
export function bindActiveModuleEngineRelease(value: unknown): ModuleEngineRelease {
  const raw = moduleRecord(nativeJson(value), [...IDENTITY_KEYS, "enabled", "status", "deploymentEvidenceDigest", "sourceVerificationDigest", "lifecycleEvidenceDigest"], "engine.activeRelease");
  need(raw.enabled === true && raw.status === "active", "Engine source is not active.");
  moduleEngineReleaseIdentity(raw as unknown as ModuleEngineRelease);
  for (const key of ["deploymentEvidenceDigest", "sourceVerificationDigest", "lifecycleEvidenceDigest"]) moduleHash(raw[key], key);
  return raw as unknown as ModuleEngineRelease;
}
export function bindModuleEngineDefinition(value: unknown): ModuleEngineCatalogDefinition {
  const raw = nativeJson(value) as ModuleEngineCatalogDefinition;
  moduleRecord(raw, ["id", "title", "summary", "detail", "version", "interface", "source", "schema", "defaults", "configurationAbi", "constraints", ...(Object.hasOwn(raw, "fields") ? ["fields"] : [])], "engine.definition");
  need(typeof raw.id === "string" && /^[a-z][a-z0-9_.-]{1,127}$/.test(raw.id), "Invalid template ID.");
  need([raw.title, raw.summary, raw.detail, raw.version].every(item => typeof item === "string" && item.length > 0 && item.length <= 4000), "Invalid template text.");
  need(["quote-v1", "quote-shared-v1", "escrow-v1", "settlement-v1", "custom-v1"].includes(raw.interface), "Unsupported presentation profile.");
  moduleRecord(raw.source, ["path", "sha256"], "engine.source");
  need(typeof raw.source.path === "string" && raw.source.path.length <= 300 && /^[a-f0-9]{64}$/.test(raw.source.sha256), "Invalid source path/hash.");
  assertOpenConfigSchema(raw.schema); assertOpenConstraints(raw.constraints);
  need(Array.isArray(raw.configurationAbi) && raw.configurationAbi.length <= 128, "Invalid configuration ABI.");
  validateModuleEngineConfigurationAbi(raw.schema, raw.configurationAbi);
  return raw;
}
export function bindModuleEngineRevision(value: unknown): ModuleEngineRevisionDefinition {
  const r = moduleRecord(nativeJson(value), ["packageId", "familyId", "fixedQuoteAsset", "fixedConfigurationHash", "initialOperationId", "executionGas", "moneyRights", "coinRights", "operationPermissions", "eligibleFamilies"], "engine.revision");
  moduleHash(r.packageId, "engine.packageId"); moduleHash(r.familyId, "engine.familyId"); moduleAddress(r.fixedQuoteAsset, "engine.fixedQuoteAsset", true);
  moduleEngineOptionalHash(r.fixedConfigurationHash, "engine.fixedConfigurationHash"); moduleEngineOptionalHash(r.initialOperationId, "engine.initialOperationId");
  need(moduleInteger(r.executionGas, "engine.executionGas", 10_000_000) >= 50_000, "Execution gas is too low.");
  moduleInteger(r.moneyRights, "engine.moneyRights", 7); need(r.coinRights === 0, "Additional coin rights are unsupported.");
  need(Array.isArray(r.operationPermissions) && r.operationPermissions.length > 0 && r.operationPermissions.length <= 32, "Invalid operation permissions.");
  const ids = new Set<string>();
  for (const permission of r.operationPermissions) {
    const p = moduleRecord(permission, ["operationId", "inputRoles", "outputRoles", "authorization"], "engine.permission"); const id = moduleHash(p.operationId, "engine.operationId");
    need(!ids.has(id), "Duplicate operation permission."); ids.add(id);
    need((moduleInteger(p.inputRoles, "inputRoles", 7) & ~Number(r.moneyRights)) === 0, "Operation exceeds money rights.");
    moduleInteger(p.outputRoles, "outputRoles", 7); moduleInteger(p.authorization, "authorization", 1);
  }
  need(r.initialOperationId === ENGINE_ZERO_HASH || ids.has(String(r.initialOperationId).toLowerCase()), "Initial operation has no permission.");
  need(Array.isArray(r.eligibleFamilies) && r.eligibleFamilies.length <= 8, "Invalid fee families.");
  let prior = 0n; for (const family of r.eligibleFamilies) { const hash = moduleHash(family, "engine.eligibleFamily"); need(BigInt(hash) > prior, "Fee families must be sorted and unique."); prior = BigInt(hash); }
  return r as unknown as ModuleEngineRevisionDefinition;
}
function bindSource(value: unknown): ModuleEngineReviewedSource {
  const r = moduleRecord(nativeJson(value), ["requestDigest", "artifactDigest", "sourceManifestHash", "configurationSchemaHash", "compiler", "engine"], "engine.reviewedSource");
  for (const name of ["requestDigest", "artifactDigest", "sourceManifestHash", "configurationSchemaHash"]) moduleHash(r[name], name);
  const compiler = moduleRecord(r.compiler, ["version", "binarySha256", "imageDigest", "settingsHash", "completeInputHash", "reproducible"], "engine.compiler");
  need(compiler.reproducible === true && typeof compiler.version === "string" && compiler.version.startsWith("0.8.26"), "Unsupported reproducible compiler.");
  for (const name of ["settingsHash", "completeInputHash"]) moduleHash(compiler[name], name);
  need(typeof compiler.binarySha256 === "string" && /^sha256:[a-f0-9]{64}$/.test(compiler.binarySha256) && typeof compiler.imageDigest === "string" && /^sha256:[a-f0-9]{64}$/.test(compiler.imageDigest), "Invalid compiler pins.");
  const e = moduleRecord(r.engine, ["componentId", "sourcePath", "contractName", "abi", "abiHash", "creationBytecode", "creationCodeHash", "runtimeTemplate", "runtimeTemplateHash", "immutableReferences", "immutableRuntimeOffsets", "immutableConstructorOffsets", "externalSelectors"], "engine.artifact");
  for (const name of ["componentId", "sourcePath", "contractName"]) need(typeof e[name] === "string" && String(e[name]).length > 0 && String(e[name]).length <= 300, "Invalid engine component.");
  const creation = moduleBytes(e.creationBytecode, "engine.creationBytecode", 49_152), runtime = moduleBytes(e.runtimeTemplate, "engine.runtimeTemplate", 24_576);
  need(creation !== "0x" && runtime !== "0x", "Missing engine bytecode."); same(keccak256(creation), e.creationCodeHash, "Creation code"); same(keccak256(runtime), e.runtimeTemplateHash, "Runtime template");
  moduleHash(e.abiHash, "engine.abiHash"); need(Array.isArray(e.abi) && Array.isArray(e.externalSelectors), "Invalid engine ABI.");
  same(e.abiHash, sha256(toHex(nativeCanonicalJson({ domain: "programmable.modules.abi.v1", value: e.abi }))), "Engine ABI digest");
  need(e.externalSelectors.every(selector => typeof selector === "string" && /^0x[a-f0-9]{8}$/.test(selector)), "Invalid external selectors.");
  need(Array.isArray(e.immutableRuntimeOffsets) && Array.isArray(e.immutableConstructorOffsets) && e.immutableRuntimeOffsets.length === e.immutableConstructorOffsets.length && e.immutableRuntimeOffsets.length <= 128, "Invalid immutable mapping.");
  let previous = -32;
  e.immutableRuntimeOffsets.forEach((offset, index) => {
    const start = moduleInteger(offset, "engine.runtimeOffset", 24_576 - 32); need(start >= previous + 32 && start * 2 + 64 <= runtime.length - 2, "Overlapping or out-of-bounds immutable.");
    need(runtime.slice(2 + start * 2, 2 + start * 2 + 64) === "0".repeat(64), "Immutable template slot is not zero."); previous = start;
    need(moduleInteger((e.immutableConstructorOffsets as unknown[])[index], "engine.constructorOffset", 16_640) % 32 === 0, "Unaligned constructor word.");
  });
  need(Array.isArray(e.immutableReferences), "Missing compiler immutable references.");
  const allRanges: number[] = []; const immutableIds = new Set<string>();
  for (const item of e.immutableReferences) {
    const reference = moduleRecord(item, ["id", "ranges"], "engine.immutableReference"); need(typeof reference.id === "string" && !immutableIds.has(reference.id), "Duplicate immutable ID."); immutableIds.add(reference.id);
    need(Array.isArray(reference.ranges) && reference.ranges.length > 0, "Invalid immutable ranges.");
    for (const range of reference.ranges) { const slot = moduleRecord(range, ["start", "length"], "engine.immutableRange"); need(slot.length === 32, "Invalid immutable width."); allRanges.push(moduleInteger(slot.start, "engine.immutableStart")); }
  }
  same(allRanges.sort((a, b) => a - b), e.immutableRuntimeOffsets, "Complete compiler immutable inventory");
  return r as unknown as ModuleEngineReviewedSource;
}
export function computeModuleEngineHostManifestHash(value: ModuleEngineHostManifest): Hex {
  const envelope = moduleRecord(nativeJson(value), ["domain", "manifest"], "engine.hostManifest"); need(envelope.domain === MODULE_ENGINE_HOST_MANIFEST_DOMAIN, "Wrong host manifest domain.");
  const m = moduleRecord(envelope.manifest, ["release", "catalogDefinition", "configurationCodec", "source", "revision"], "engine.manifest");
  bindModuleEngineReleaseIdentity(m.release); bindModuleEngineDefinition(m.catalogDefinition); bindModuleEngineRevision(m.revision); bindSource(m.source);
  validateAnyQuoteManifestProfile(m.release, m.catalogDefinition as ModuleEngineCatalogDefinition, m.revision as ModuleEngineRevisionDefinition);
  need(m.configurationCodec === MODULE_ENGINE_CONFIGURATION_CODEC, "Wrong configuration codec.");
  return keccak256(toHex(nativeCanonicalJson(envelope)));
}
/** Produces reviewable identity only; the publisher must independently authenticate the accepted review. */
export function createModuleEngineHostManifest(input: { release: ModuleEngineReleaseIdentity; definition: ModuleEngineCatalogDefinition;
  revision: ModuleEngineRevisionDefinition; source: ModuleEngineReviewedSource; descriptor: OpenSourcePackage }): ModuleEngineHostManifest {
  const release = moduleEngineReleaseIdentity(input.release), definition = bindModuleEngineDefinition(input.definition), revision = bindModuleEngineRevision(input.revision), source = bindSource(input.source);
  const checked = validateOpenPackage(input.descriptor); need(checked.ok, "Invalid engine source descriptor.");
  same(checked.packageId, revision.packageId, "Source package"); same(checked.familyId, revision.familyId, "Source family");
  same(definition.schema, checked.descriptor.configuration, "Source configuration"); same(definition.constraints, checked.descriptor.constraints, "Source constraints"); same(definition.version, checked.descriptor.version, "Source version");
  need(checked.descriptor.source.files.some(file => file.path === definition.source.path && file.sha256 === definition.source.sha256), "Source file is not in the reviewed package.");
  need(checked.descriptor.components.some(component => component.id === source.engine.componentId && component.sourcePath === source.engine.sourcePath && component.runtime === MODULE_ENGINE_PROFILE), "Engine component/profile differs.");
  same(definition.source.path, source.engine.sourcePath, "Engine source path");
  same(source.sourceManifestHash, sha256(toHex(nativeCanonicalJson({ domain: "programmable.modules.source-manifest.v1", value: checked.descriptor }))), "Source manifest digest");
  same(source.configurationSchemaHash, sha256(toHex(nativeCanonicalJson({ domain: "programmable.modules.configuration-schema.v1", value: checked.descriptor.configuration }))), "Configuration schema digest");
  const result: ModuleEngineHostManifest = { domain: MODULE_ENGINE_HOST_MANIFEST_DOMAIN, manifest: { release, catalogDefinition: definition, configurationCodec: MODULE_ENGINE_CONFIGURATION_CODEC, source, revision } };
  computeModuleEngineHostManifestHash(result); return result;
}
export function bindModuleEngineTemplate(value: unknown, release?: ModuleEngineReleaseIdentity): ModuleEngineTemplate {
  const r = moduleRecord(nativeJson(value), ["status", "manifest", "manifestHash", "reviewDigest"], "engine.template"); need(r.status === "available", "Template publication is not available.");
  moduleHash(r.reviewDigest, "engine.reviewDigest"); same(computeModuleEngineHostManifestHash(r.manifest as ModuleEngineHostManifest), moduleHash(r.manifestHash, "engine.manifestHash"), "Host manifest");
  const template = r as unknown as ModuleEngineTemplate;
  if (release) same(template.manifest.manifest.release, moduleEngineReleaseIdentity(release), "Template source release");
  if (template.manifest.manifest.catalogDefinition.interface === "quote-v1") need(template.manifest.manifest.revision.fixedConfigurationHash !== ENGINE_ZERO_HASH, "Spot dependencies and pricing require a fixed reviewed configuration.");
  return template;
}
/** This serialized response must come from the authenticated source endpoint. Parsing is not publication approval. */
export function parseModuleEngineAvailability(value: unknown): ModuleEngineAvailability {
  const r = moduleRecord(nativeJson(value), ["schemaVersion", "release", "templates", "reason"], "engine.availability"); need(r.schemaVersion === MODULE_ENGINE_AVAILABILITY_SCHEMA && Array.isArray(r.templates) && r.templates.length <= 1000, "Invalid engine availability.");
  need(r.reason === null || typeof r.reason === "string" && r.reason.length <= 2000, "Invalid unavailable reason.");
  const release = r.release === null ? null : bindActiveModuleEngineRelease(r.release);
  need(release || r.templates.length === 0, "Available templates need an active source.");
  const templates = r.templates.map(item => bindModuleEngineTemplate(item, release!));
  need(new Set(templates.map(item => item.manifest.manifest.revision.packageId)).size === templates.length, "Duplicate engine revision.");
  return { schemaVersion: MODULE_ENGINE_AVAILABILITY_SCHEMA, release, templates, reason: r.reason as string | null };
}
