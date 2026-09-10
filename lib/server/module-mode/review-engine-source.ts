// Server and operator source reconstruction. Never imported by the browser review UI.
import { decodeAbiParameters, encodeAbiParameters, keccak256 } from "viem";
import { validateModuleSubmissionRequest } from "../../../packages/classic-modules/src/open-transport.mjs";
import { compileOpenConfig } from "../../../packages/classic-modules/src/open-config.mjs";
import { nativeCanonicalJson } from "../../module-mode/native-catalog";
import { encodeModuleEngineConfiguration } from "../../module-engine/configuration";
import { reviewDigest as moduleReviewDigestV1, type ReviewSubject as ModuleReviewSubjectV1 } from "../../module-mode/review-contract";
import { ENGINE_REVIEW_COMPILER, MODULE_REVIEW_LIMITS_V1, MODULE_ENGINE_REVIEW_HOST_V1, MODULE_ENGINE_REVIEW_ACTOR_V1, MODULE_ENGINE_REVIEW_AREAS_V1, validateModuleEngineBuildPlanV1, parseModuleEngineContractArtifactV1, materializeModuleEngineRuntimeV1, validateModuleEngineTestResultsV1 } from "../../module-mode/review-engine-contract";
import { MODULE_ENGINE_PROFILE_V1, MODULE_ENGINE_PLAN_SCHEMA_V1, MODULE_ENGINE_BUILD_SCHEMA_V1, MODULE_ENGINE_CONSTRUCTOR_ABI_V1, MODULE_ENGINE_CONTEXT_ABI_V1, type ModuleEngineBuildPlanV1, type ModuleEngineBuildArtifactV1, type ModuleEngineContractArtifactV1, type ModuleEngineCompiledCaseV1, type ModuleEngineTestResultV1 } from "../../module-mode/review-engine-types";
import { MODULE_ENGINE_SHARED_QUOTE_ENVIRONMENT_V1, MODULE_ENGINE_SHARED_QUOTE_REVIEW_LEDGER_V1, MODULE_ENGINE_SHARED_QUOTE_REVIEW_INFRASTRUCTURE_V1,
  MODULE_ENGINE_SHARED_QUOTE_POLICY_V1, MODULE_ENGINE_SHARED_QUOTE_CONFIGURATION_ABI_V1,
  MODULE_ENGINE_SHARED_QUOTE_REVIEW_AREAS_V1 } from "../../module-mode/review-engine-shared-quote";
const DIGEST = /^0x[0-9a-f]{64}$/u;
const ADDRESS = /^0x(?!0{40}$)[0-9a-f]{40}$/u;
const json = (value: unknown) => nativeCanonicalJson(value);
function need(ok: unknown, code: string): asserts ok { if (!ok) throw new Error(code); }
function object(value: unknown): Record<string, unknown> {
  need(value !== null && typeof value === "object" && !Array.isArray(value), "MODULE_ENGINE_OBJECT_INVALID");
  return value as Record<string, unknown>;
}
const NATIVE_SETTINGS_V1 = {optimizer:{enabled:true,runs:1000},evmVersion:"cancun",viaIR:true,metadata:{bytecodeHash:"none"}};
const ENGINE_SOURCE_ALIASES = [
  ["dependencies/scoped/openzeppelin/contracts/", "@openzeppelin/contracts/"],
  ["dependencies/scoped/openzeppelin/uniswap-hooks/", "@openzeppelin/uniswap-hooks/"],
  ["dependencies/scoped/uniswap/blocknumberish/", "@uniswap/blocknumberish/"],
  ["dependencies/scoped/uniswap/liquidity-launcher/", "@uniswap/liquidity-launcher/"],
  ["dependencies/scoped/uniswap/uerc20-factory/", "@uniswap/uerc20-factory/"],
  ["dependencies/scoped/uniswap/v4-core/", "@uniswap/v4-core/"],
  ["dependencies/scoped/uniswap/v4-periphery/", "@uniswap/v4-periphery/"],
  ["dependencies/scoped/solady/src/", "@solady/src/"],
] as const;
const SHARED_QUOTE_SOURCE_ALIASES = [
  ["lib/openzeppelin-contracts/contracts/", "@openzeppelin/contracts/"],
  ["lib/openzeppelin-uniswap-hooks/", "@openzeppelin/uniswap-hooks/"],
  ["lib/v4-core/", "@uniswap/v4-core/"],
  ["lib/v4-periphery/", "@uniswap/v4-periphery/"],
  ["lib/solmate/src/", "solmate/src/"],
  ["lib/forge-std/src/", "forge-std/"],
] as const;
function soliditySources(files: readonly {path:string;bytes:string}[], sharedQuote: boolean): Record<string,{content:string}> {
  const sources: Record<string,{content:string}> = Object.create(null);
  for (const f of files) if (f.path.endsWith(".sol")) sources[f.path]={content:new TextDecoder("utf-8",{fatal:true}).decode(Uint8Array.from(atob(f.bytes),c=>c.charCodeAt(0)))};
  const prefix="dependencies/openzeppelin-contracts/contracts/";
  for(const [path,source] of Object.entries(sources)) if(path.startsWith(prefix)) {const alias=`@openzeppelin/contracts/${path.slice(prefix.length)}`;need(!Object.hasOwn(sources,alias),"MODULE_BUILD_SOURCE_ALIAS_COLLISION");sources[alias]=source;}
  for(const [path,source] of Object.entries(sources)) {
    const match=ENGINE_SOURCE_ALIASES.find(([prefix])=>path.startsWith(prefix));
    if(!match) continue;
    const alias=`${match[1]}${path.slice(match[0].length)}`;
    need(!Object.hasOwn(sources,alias),"MODULE_BUILD_SOURCE_ALIAS_COLLISION");
    sources[alias]=source; delete sources[path];
  }
  if (sharedQuote) for (const [path, source] of Object.entries(sources)) {
    const match = SHARED_QUOTE_SOURCE_ALIASES.find(([prefix]) => path.startsWith(prefix));
    if (!match) continue;
    const alias = `${match[1]}${path.slice(match[0].length)}`;
    need(!Object.hasOwn(sources, alias), "MODULE_BUILD_SOURCE_ALIAS_COLLISION");
    sources[alias] = source; delete sources[path];
  }
  return sources;
}
function sourceInput(source: unknown, subject: ModuleReviewSubjectV1, plan: ModuleEngineBuildPlanV1) {
  need(new TextEncoder().encode(json(source)).length <= 24 * 1024 * 1024, "MODULE_BUILD_SOURCE_UNAVAILABLE");
  const checked = validateModuleSubmissionRequest(source);
  need(checked.ok && checked.requestDigest === subject.requestDigest && checked.request.descriptor.author.toLowerCase() === subject.author, "MODULE_BUILD_SOURCE_BINDING_INVALID");
  need(checked.totalSourceBytes <= MODULE_REVIEW_LIMITS_V1.sourceBytes, "MODULE_BUILD_PROFILE_CAPACITY_EXCEEDED");
  const target = checked.request.descriptor.components.find(c => c.id === plan.engineComponentId);
  need(target && target.runtime === MODULE_ENGINE_PROFILE_V1, "MODULE_BUILD_ADAPTER_UNSUPPORTED");
  need(/^[A-Za-z_$][A-Za-z0-9_$]{0,255}$/u.test(target.entrypoint), "MODULE_BUILD_ENTRYPOINT_INVALID");
  const sharedQuote = plan.testEnvironment?.profile === MODULE_ENGINE_SHARED_QUOTE_ENVIRONMENT_V1.profile;
  if (plan.testEnvironment?.profile === MODULE_ENGINE_SHARED_QUOTE_ENVIRONMENT_V1.profile) {
    need(checked.request.descriptor.requiresHost.includes(MODULE_ENGINE_SHARED_QUOTE_POLICY_V1.hostRequirement), "MODULE_ENGINE_SHARED_QUOTE_HOST_PROFILE_MISSING");
    const schema = object(checked.request.descriptor.configuration), fields = object(schema.fields);
    const fixedValue = (name: string) => object(object(fields[name]).binding).value;
    const manager = fixedValue("poolManager"), codeHash = fixedValue("poolManagerCodeHash"), hook = fixedValue("sharedHook");
    need(typeof manager === "string" && ADDRESS.test(manager) && typeof codeHash === "string" && DIGEST.test(codeHash)
      && codeHash !== `0x${"0".repeat(64)}` && typeof hook === "string" && ADDRESS.test(hook), "MODULE_ENGINE_SHARED_QUOTE_SOURCE_SCHEMA_INVALID");
    const expected = { type: "record", fields: {
      schemaId: { type: "bytes", maxLength: 32, binding: { mode: "fixed", value: MODULE_ENGINE_SHARED_QUOTE_POLICY_V1.configurationSchemaId } },
      poolManager: { type: "address", binding: { mode: "fixed", value: manager } },
      poolManagerCodeHash: { type: "bytes", maxLength: 32, binding: { mode: "fixed", value: codeHash } },
      sharedHook: { type: "address", binding: { mode: "fixed", value: hook } },
      quoteAsset: { type: "address", binding: { mode: "input" } },
      initialTick: { type: "string", maxLength: 8, binding: { mode: "input" } },
      validUntil: { type: "uint", bits: 64, min: "1", binding: { mode: "input" } },
      priceEvidenceHash: { type: "bytes", maxLength: 32, binding: { mode: "input" } },
    }, required: MODULE_ENGINE_SHARED_QUOTE_CONFIGURATION_ABI_V1.map(argument => argument.path[0]) };
    need(json(schema) === json(expected), "MODULE_ENGINE_SHARED_QUOTE_SOURCE_SCHEMA_INVALID");
  }
  const sources = soliditySources(checked.request.files, sharedQuote);
  need(Object.hasOwn(sources, target.sourcePath), "MODULE_BUILD_TARGET_MISSING");
  const standard = { language: "Solidity", sources, settings: NATIVE_SETTINGS_V1 };
  need(new TextEncoder().encode(json(standard)).length <= MODULE_REVIEW_LIMITS_V1.standardJsonBytes, "MODULE_BUILD_PROFILE_CAPACITY_EXCEEDED");
  return { checked, target, standard };
}
/** Reuses the reviewed source closure/settings for source publication; grants no build or review authority. */
export function moduleEngineStandardInputV1(source: unknown, subject: ModuleReviewSubjectV1, rawPlan: unknown) {
  return sourceInput(source, subject, validateModuleEngineBuildPlanV1(rawPlan, subject)).standard;
}
function compiledCases(plan: ModuleEngineBuildPlanV1, source: ReturnType<typeof sourceInput>, engine: ModuleEngineContractArtifactV1): ModuleEngineCompiledCaseV1[] {
  const descriptor = source.checked.request.descriptor;
  return plan.cases.map(c => {
    let configBytes = c.rawConfigBytes ?? encodeModuleEngineConfiguration(plan.configurationAbi, compileOpenConfig(descriptor.configuration, c.parameters, { roles: { author: descriptor.author, reward: descriptor.rewardWallet } }), descriptor.configuration);
    const sharedQuote = plan.testEnvironment?.profile === MODULE_ENGINE_SHARED_QUOTE_ENVIRONMENT_V1.profile;
    let sharedQuoteConfiguration: ModuleEngineCompiledCaseV1["sharedQuoteConfiguration"];
    if (sharedQuote && c.expectedDeployment === "success") {
      need(configBytes.length === 514, "MODULE_ENGINE_SHARED_QUOTE_CONFIGURATION_INVALID");
      const [schemaId, manager, codeHash, hook, quote, tick, validUntil, priceHash] = decodeAbiParameters(MODULE_ENGINE_SHARED_QUOTE_CONFIGURATION_ABI_V1, configBytes);
      const timestamp = BigInt(c.operations[0]?.timestamp ?? 1800000000);
      need(schemaId === MODULE_ENGINE_SHARED_QUOTE_POLICY_V1.configurationSchemaId && ADDRESS.test(manager.toLowerCase())
        && codeHash !== `0x${"0".repeat(64)}` && ADDRESS.test(hook.toLowerCase()) && quote.toLowerCase() === c.quoteAsset
        && tick % 200 === 0 && tick > -887200 && tick < 887200 && validUntil >= timestamp && validUntil <= timestamp + 180n
        && priceHash !== `0x${"0".repeat(64)}`, "MODULE_ENGINE_SHARED_QUOTE_CONFIGURATION_INVALID");
      // Admission above uses the exact submitted schema and values. Isolated execution then substitutes
      // only the owned manager/runtime/hook pins; dynamic quote, price and expiry fields remain byte-identical.
      sharedQuoteConfiguration = { sourceConfigBytes: configBytes, sourceConfigHash: keccak256(configBytes) };
      const infrastructure = MODULE_ENGINE_SHARED_QUOTE_REVIEW_INFRASTRUCTURE_V1;
      configBytes = encodeAbiParameters(MODULE_ENGINE_SHARED_QUOTE_CONFIGURATION_ABI_V1, [schemaId,
        infrastructure.poolManager, infrastructure.poolManagerCodeHash, infrastructure.sharedHook, quote, tick, validUntil, priceHash]);
    }
    const context = {
      host: MODULE_ENGINE_REVIEW_HOST_V1,
      launchId: moduleReviewDigestV1("programmable.modules.engine-review-launch.v1", { requestDigest: plan.requestDigest, caseId: c.id }),
      token: c.token, creator: MODULE_ENGINE_REVIEW_ACTOR_V1, quoteAsset: c.quoteAsset,
      feeCollector: sharedQuote ? MODULE_ENGINE_SHARED_QUOTE_REVIEW_LEDGER_V1 : MODULE_ENGINE_REVIEW_HOST_V1,
    };
    const constructorArgs = encodeAbiParameters(MODULE_ENGINE_CONSTRUCTOR_ABI_V1, [context, configBytes]);
    const runtimeBytecode = materializeModuleEngineRuntimeV1(engine, constructorArgs);
    const initCode = `${engine.creationBytecode}${constructorArgs.slice(2)}` as `0x${string}`;
    need((initCode.length - 2) / 2 <= MODULE_REVIEW_LIMITS_V1.creationBytes, "MODULE_ENGINE_INITCODE_TOO_LARGE");
    return { ...c, ...(sharedQuoteConfiguration === undefined ? {} : { sharedQuoteConfiguration }), context, contextHash: keccak256(encodeAbiParameters([{ type: "tuple", components: MODULE_ENGINE_CONTEXT_ABI_V1 }], [context])), configBytes, configHash: keccak256(configBytes), constructorArgs, constructorHash: keccak256(constructorArgs), initCodeHash: keccak256(initCode), runtimeBytecode, runtimeCodeHash: keccak256(runtimeBytecode) };
  });
}
/** Reconstruct isolated case byte identities for transport parity; this performs no execution and grants no review authority. */
export function moduleEngineCompiledCasesV1(sourceRequest: unknown, subject: ModuleReviewSubjectV1, rawPlan: unknown, engine: ModuleEngineContractArtifactV1) {
  const plan = validateModuleEngineBuildPlanV1(rawPlan, subject);
  return compiledCases(plan, sourceInput(sourceRequest, subject, plan), engine);
}
function compilerIdentity(standard: unknown) {
  return { version: ENGINE_REVIEW_COMPILER.version, binarySha256: ENGINE_REVIEW_COMPILER.binarySha256, imageDigest: ENGINE_REVIEW_COMPILER.imageDigest, settingsHash: moduleReviewDigestV1("programmable.modules.compiler-settings.v1", NATIVE_SETTINGS_V1), completeInputHash: moduleReviewDigestV1("programmable.modules.compiler-input.v1", standard), reproducible: true as const };
}
function artifactContents(subject: ModuleReviewSubjectV1, plan: ModuleEngineBuildPlanV1, source: ReturnType<typeof sourceInput>, engine: ModuleEngineContractArtifactV1, tests: ModuleEngineTestResultV1) {
  const descriptor = source.checked.request.descriptor;
  const planDigest = moduleReviewDigestV1(MODULE_ENGINE_PLAN_SCHEMA_V1, plan), cases = compiledCases(plan, source, engine);
  validateModuleEngineTestResultsV1(tests, subject.requestDigest, planDigest, cases, plan.testEnvironment);
  return {
    schemaVersion: MODULE_ENGINE_BUILD_SCHEMA_V1, authority: "programmable.module-review.engine-build.v1" as const, subject,
    packageId: source.checked.packageId, familyId: source.checked.familyId, rewardWallet: descriptor.rewardWallet.toLowerCase(),
    sourceManifestHash: moduleReviewDigestV1("programmable.modules.source-manifest.v1", descriptor), planDigest,
    configurationSchemaHash: moduleReviewDigestV1("programmable.modules.configuration-schema.v1", descriptor.configuration),
    configurationCodec: plan.configurationCodec, configurationAbi: plan.configurationAbi,
    ...(plan.testEnvironment === undefined ? {} : { testEnvironment: plan.testEnvironment }),
    compiler: compilerIdentity(source.standard), engine, executionGas: plan.executionGas, operationPermissions: plan.operationPermissions, moneyRights: plan.moneyRights, coinRights: plan.coinRights, testEconomics: plan.testEconomics, cases, tests,
    reviewRequired: plan.testEnvironment?.profile === MODULE_ENGINE_SHARED_QUOTE_ENVIRONMENT_V1.profile
      ? [...MODULE_ENGINE_REVIEW_AREAS_V1, ...MODULE_ENGINE_SHARED_QUOTE_REVIEW_AREAS_V1] : MODULE_ENGINE_REVIEW_AREAS_V1, approved: false as const, registryApproved: false as const, available: false as const,
  };
}
/** API-side reconstruction binds the authenticated worker result; no contributor code executes here. */
export function verifyModuleEngineBuildArtifactV1(artifact: ModuleEngineBuildArtifactV1, subject: ModuleReviewSubjectV1, rawPlan: unknown, sourceRequest: unknown): void {
  const plan = validateModuleEngineBuildPlanV1(rawPlan, subject), source = sourceInput(sourceRequest, subject, plan), value = artifact.engine;
  const engine = parseModuleEngineContractArtifactV1({ contracts: { [source.target.sourcePath]: { [source.target.entrypoint]: { abi: value.abi, evm: { bytecode: { object: value.creationBytecode.slice(2) }, deployedBytecode: { object: value.runtimeTemplate.slice(2), immutableReferences: Object.fromEntries(value.immutableReferences.map(r => [r.id, r.ranges])) } } } } } }, source.target, plan);
  const contents = artifactContents(subject, plan, source, engine, artifact.tests);
  const expected = { ...contents, artifactDigest: moduleReviewDigestV1(MODULE_ENGINE_BUILD_SCHEMA_V1, contents) };
  need(json(artifact) === json(expected) && new TextEncoder().encode(json(artifact)).length <= MODULE_REVIEW_LIMITS_V1.artifactBytes, "MODULE_REVIEW_BUILD_BINDING_INVALID");
}

