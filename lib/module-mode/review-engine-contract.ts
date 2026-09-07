// Pure validation of the protected backend engine profile. No source compilation or execution occurs here.
import { bytesToHex, encodeAbiParameters, getContractAddress, hexToBytes, keccak256, parseAbi, toFunctionSelector, type Hex } from "viem";
import { validateModuleSubmissionRequest } from "../../packages/classic-modules/src/open-transport.mjs";
import { compileOpenConfig } from "../../packages/classic-modules/src/open-config.mjs";
import { nativeCanonicalJson, nativeJson } from "./native-catalog";
import { encodeProgramConfiguration } from "./builder";
import { parseReviewProgramAbi, reviewDigest as moduleReviewDigestV1, parseReviewSubject, type ReviewSubject as ModuleReviewSubjectV1 } from "./review-contract";
import { MODULE_ENGINE_BUILD_SCHEMA_V1, MODULE_ENGINE_PLAN_SCHEMA_V1, MODULE_ENGINE_PROFILE_V1, MODULE_ENGINE_CONFIGURATION_CODEC_V1, MODULE_ENGINE_CONTEXT_ABI_V1, MODULE_ENGINE_CONSTRUCTOR_ABI_V1, type ModuleEngineBuildArtifactV1, type ModuleEngineBuildPlanV1, type ModuleEngineContractArtifactV1, type ModuleEngineCompiledCaseV1, type ModuleEngineTestResultV1 } from "./review-engine-types";
type ModuleDigestV1 = Hex;
export const ENGINE_REVIEW_COMPILER = Object.freeze({version:"0.8.26+commit.8a97fa7a",binarySha256:"sha256:35ba6661f3bdaed995fc7af14c405502290cf681b3fd062fe8738cfdf6db14ed",imageDigest:"sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8"});
const NATIVE_SETTINGS_V1 = {optimizer:{enabled:true,runs:1000},evmVersion:"cancun",viaIR:true,metadata:{bytecodeHash:"none"}};
const MODULE_REVIEW_LIMITS_V1 = {sourceBytes:4*1024*1024,standardJsonBytes:5242880,creationBytes:49152,runtimeBytes:24576,configBytes:16384,artifactBytes:2*1024*1024};
function soliditySources(files: readonly {path:string;bytes:string}[]): Record<string,{content:string}> {
  const sources: Record<string,{content:string}> = Object.create(null);
  for (const f of files) if (f.path.endsWith(".sol")) sources[f.path]={content:new TextDecoder("utf-8",{fatal:true}).decode(Uint8Array.from(atob(f.bytes),c=>c.charCodeAt(0)))};
  const prefix="dependencies/openzeppelin-contracts/contracts/";
  for(const [path,source] of Object.entries(sources)) if(path.startsWith(prefix)) {const alias=`@openzeppelin/contracts/${path.slice(prefix.length)}`;need(!Object.hasOwn(sources,alias),"MODULE_BUILD_SOURCE_ALIAS_COLLISION");sources[alias]=source;}
  return sources;
}
export const MODULE_ENGINE_INTERFACE_V1 = parseAbi([
  "function contextHash() view returns(bytes32)",
  "function initialize(bytes launchData) returns(bytes32 resourcesHash)",
  "function execute((bytes32 operationId,address actor,address recipient,address inputAsset,uint256 inputAmount,address outputAsset,uint256 minimumOutput,uint256 deadline,uint256 nonce,bytes data) operation) payable returns(bytes result)",
]);
// Anvil's public fixture account, never a wallet credential. Each case restores the initial local snapshot.
export const MODULE_ENGINE_REVIEW_ACTOR_V1 = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as const;
export const MODULE_ENGINE_REVIEW_HOST_V1 = getContractAddress({ from: MODULE_ENGINE_REVIEW_ACTOR_V1, nonce: 0n }).toLowerCase() as `0x${string}`;
export const MODULE_ENGINE_REVIEW_AREAS_V1 = Object.freeze([
  "complete-constructor-accepted-configuration-range",
  "immutable-constructor-word-mapping",
  "external-chain-dependencies-and-asset-behavior",
  "operation-authority-funding-and-resource-conservation",
  "asynchronous-lifecycle-recovery-and-liveness",
  "composition-with-other-packages",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^0x[0-9a-f]{64}$/u;
const ADDRESS = /^0x(?!0{40}$)[0-9a-f]{40}$/u;
const ASSET = /^0x[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;
const json = (x: unknown) => nativeCanonicalJson(x);
function need(ok: unknown, code: string): asserts ok { if (!ok) throw new Error(code); }
function object(x: unknown): Record<string, unknown> {
  need(x !== null && typeof x === "object" && !Array.isArray(x), "MODULE_ENGINE_OBJECT_INVALID");
  return x as Record<string, unknown>;
}
function exact(x: unknown, keys: readonly string[]) {
  const value = object(x);
  need(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), "MODULE_ENGINE_SHAPE_INVALID");
  return value;
}
function hex(value: unknown, maximum: number = MODULE_REVIEW_LIMITS_V1.configBytes, minimum = 0): asserts value is `0x${string}` {
  need(typeof value === "string" && /^0x(?:[0-9a-f]{2})*$/u.test(value) && (value.length - 2) / 2 <= maximum && (value.length - 2) / 2 >= minimum, "MODULE_ENGINE_BYTES_INVALID");
}
function uint(value: unknown) {
  need(typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/u.test(value) && BigInt(value) < 2n ** 256n, "MODULE_ENGINE_AMOUNT_INVALID");
}
function subjectValid(subject: ModuleReviewSubjectV1) {
  exact(subject, ["submissionId", "principalId", "author", "requestDigest"]);
  need(UUID.test(subject.submissionId) && UUID.test(subject.principalId) && ADDRESS.test(subject.author) && DIGEST.test(subject.requestDigest), "MODULE_BUILD_SUBJECT_INVALID");
}

export function validateModuleEngineBuildPlanV1(value: unknown, subject: ModuleReviewSubjectV1): ModuleEngineBuildPlanV1 {
  subjectValid(subject);
  const p = exact(value, ["schemaVersion", "submissionId", "requestDigest", "engineComponentId", "configurationCodec", "configurationAbi", "immutableBindings", "operationPermissions", "moneyRights", "coinRights", "testEconomics", "executionGas", "cases"]);
  need(p.schemaVersion === MODULE_ENGINE_PLAN_SCHEMA_V1 && p.submissionId === subject.submissionId && p.requestDigest === subject.requestDigest, "MODULE_ENGINE_SUBJECT_MISMATCH");
  need(p.configurationCodec === MODULE_ENGINE_CONFIGURATION_CODEC_V1, "MODULE_ENGINE_CODEC_UNSUPPORTED");
  parseReviewProgramAbi(p.configurationAbi);
  need(typeof p.engineComponentId === "string" && IDENTIFIER.test(p.engineComponentId), "MODULE_ENGINE_TARGET_INVALID");
  need(Number.isSafeInteger(p.executionGas) && Number(p.executionGas) >= 50_000 && Number(p.executionGas) <= 3_000_000, "MODULE_ENGINE_GAS_INVALID");
  need(Number.isInteger(p.moneyRights) && Number(p.moneyRights) >= 0 && Number(p.moneyRights) <= 7 && p.coinRights === 0, "MODULE_ENGINE_RIGHTS_INVALID");
  const economics = exact(p.testEconomics, ["platformBps", "buyCreatorBps", "sellCreatorBps"]);
  need(economics.platformBps === 10 || economics.platformBps === 30, "MODULE_ENGINE_TEST_ECONOMICS_INVALID");
  for (const key of ["buyCreatorBps", "sellCreatorBps"]) need(Number.isInteger(economics[key]) && Number(economics[key]) >= 0 && Number(economics[key]) <= 2000 - Number(economics.platformBps), "MODULE_ENGINE_TEST_ECONOMICS_INVALID");
  need(Array.isArray(p.operationPermissions) && p.operationPermissions.length > 0 && p.operationPermissions.length <= 32, "MODULE_ENGINE_PERMISSIONS_INVALID");
  const permissions = new Set<string>();
  for (const raw of p.operationPermissions) {
    const permission = exact(raw, ["operationId", "inputRoles", "outputRoles", "authorization"]);
    need(typeof permission.operationId === "string" && DIGEST.test(permission.operationId) && permission.operationId !== `0x${"0".repeat(64)}` && !permissions.has(permission.operationId), "MODULE_ENGINE_PERMISSIONS_INVALID");
    permissions.add(permission.operationId);
    for (const key of ["inputRoles", "outputRoles"]) need(Number.isInteger(permission[key]) && Number(permission[key]) >= 0 && Number(permission[key]) <= 7, "MODULE_ENGINE_PERMISSIONS_INVALID");
    need((Number(permission.inputRoles) & ~Number(p.moneyRights)) === 0 && (permission.authorization === 0 || permission.authorization === 1), "MODULE_ENGINE_PERMISSIONS_INVALID");
  }
  need(Array.isArray(p.immutableBindings) && p.immutableBindings.length <= 128, "MODULE_ENGINE_IMMUTABLE_BINDINGS_INVALID");
  const immutableIds = new Set<string>();
  for (const entry of p.immutableBindings) {
    const binding = exact(entry, ["id", "constructorOffset"]);
    need(typeof binding.id === "string" && /^(0|[1-9][0-9]{0,9})$/u.test(binding.id) && !immutableIds.has(binding.id), "MODULE_ENGINE_IMMUTABLE_BINDINGS_INVALID");
    immutableIds.add(binding.id);
    need(Number.isSafeInteger(binding.constructorOffset) && Number(binding.constructorOffset) >= 0 && Number(binding.constructorOffset) <= MODULE_REVIEW_LIMITS_V1.configBytes + 224 && Number(binding.constructorOffset) % 32 === 0, "MODULE_ENGINE_IMMUTABLE_BINDINGS_INVALID");
  }
  need(Array.isArray(p.cases) && p.cases.length >= 1 && p.cases.length <= 16, "MODULE_ENGINE_CASES_INVALID");
  const caseIds = new Set<string>();
  let positive = false;
  for (const raw of p.cases) {
    const c = exact(raw, ["id", "parameters", "token", "quoteAsset", "launchData", "expectedResourcesHash", "expectedDeployment", "operations", ...(Object.hasOwn(object(raw), "rawConfigBytes") ? ["rawConfigBytes"] : [])]);
    need(typeof c.id === "string" && IDENTIFIER.test(c.id) && !caseIds.has(c.id), "MODULE_ENGINE_CASE_INVALID"); caseIds.add(c.id);
    for (const key of ["token", "quoteAsset"]) {
      need(typeof c[key] === "string" && ADDRESS.test(c[key]) && !([MODULE_ENGINE_REVIEW_HOST_V1, MODULE_ENGINE_REVIEW_ACTOR_V1] as readonly string[]).includes(c[key]), "MODULE_ENGINE_CONTEXT_INVALID");
    }
    need(c.token !== c.quoteAsset, "MODULE_ENGINE_CONTEXT_INVALID");
    hex(c.launchData);
    need(typeof c.expectedResourcesHash === "string" && DIGEST.test(c.expectedResourcesHash), "MODULE_ENGINE_RESOURCES_INVALID");
    need(c.expectedDeployment === "success" || c.expectedDeployment === "revert", "MODULE_ENGINE_CASE_INVALID");
    if (c.rawConfigBytes !== undefined) { need(c.expectedDeployment === "revert", "MODULE_ENGINE_NEGATIVE_CONFIG_INVALID"); hex(c.rawConfigBytes); }
    need(Array.isArray(c.operations) && c.operations.length <= 16, "MODULE_ENGINE_OPERATIONS_INVALID");
    need(c.expectedDeployment === "success" ? c.operations.length > 0 : c.operations.length === 0, "MODULE_ENGINE_OPERATION_COVERAGE_MISSING");
    const operationIds = new Set<string>();
    let successfulOperation = false;
    let timestamp = 1800000000;
    for (const rawOperation of c.operations) {
      const operation = exact(rawOperation, ["id", "actor", "operationId", "recipient", "inputAsset", "inputAmount", "outputAsset", "minimumOutput", "data", "expectedOutcome", "expectedResult", "assertions", ...(Object.hasOwn(object(rawOperation), "timestamp") ? ["timestamp"] : [])]);
      need(typeof operation.id === "string" && IDENTIFIER.test(operation.id) && !operationIds.has(operation.id), "MODULE_ENGINE_OPERATION_INVALID"); operationIds.add(operation.id);
      need(typeof operation.operationId === "string" && DIGEST.test(operation.operationId) && typeof operation.recipient === "string" && ADDRESS.test(operation.recipient), "MODULE_ENGINE_OPERATION_INVALID");
      need(operation.actor === "creator" || operation.actor === "user", "MODULE_ENGINE_ACTOR_INVALID");
      for (const key of ["inputAsset", "outputAsset"]) need(typeof operation[key] === "string" && ASSET.test(operation[key]) && ["0x0000000000000000000000000000000000000000", c.token, c.quoteAsset].includes(operation[key]), "MODULE_ENGINE_ASSET_FIXTURE_UNSUPPORTED");
      uint(operation.inputAmount); uint(operation.minimumOutput);
      // The hermetic test fixture has a bounded faucet; this limit is not a production asset restriction.
      need(BigInt(operation.inputAmount as string) <= 10n ** 24n && BigInt(operation.minimumOutput as string) <= 10n ** 24n, "MODULE_ENGINE_TEST_FUNDING_LIMIT");
      hex(operation.data); hex(operation.expectedResult);
      need(operation.expectedOutcome === "success" || operation.expectedOutcome === "revert", "MODULE_ENGINE_OPERATION_INVALID");
      need(operation.expectedOutcome !== "success" || permissions.has(operation.operationId), "MODULE_ENGINE_PERMISSION_COVERAGE_MISSING");
      need(operation.expectedOutcome !== "revert" || operation.expectedResult === "0x", "MODULE_ENGINE_REVERT_RESULT_INVALID");
      need(Array.isArray(operation.assertions) && operation.assertions.length <= 16 && (operation.expectedOutcome !== "success" || operation.assertions.length > 0), "MODULE_ENGINE_STATE_EVIDENCE_MISSING");
      for (const rawAssertion of operation.assertions) {
        const assertion = exact(rawAssertion, ["callData", "expectedData"]); hex(assertion.callData, 16384, 4); hex(assertion.expectedData);
      }
      if(operation.timestamp !== undefined) {
        need(Number.isSafeInteger(operation.timestamp) && Number(operation.timestamp) >= timestamp && Number(operation.timestamp) <= 1831536000, "MODULE_ENGINE_TIMESTAMP_INVALID");
        timestamp = Number(operation.timestamp);
      }
      successfulOperation ||= operation.expectedOutcome === "success";
    }
    need(c.expectedDeployment !== "success" || successfulOperation, "MODULE_ENGINE_OPERATION_COVERAGE_MISSING");
    positive ||= c.expectedDeployment === "success";
  }
  for (const operationId of permissions) need(p.cases.some(raw => (object(raw).operations as unknown[]).some(rawOperation => { const operation = object(rawOperation); return operation.operationId === operationId && operation.expectedOutcome === "success"; })), "MODULE_ENGINE_PERMISSION_COVERAGE_MISSING");
  for (const permission of p.operationPermissions) if (object(permission).authorization === 1)
    need(p.cases.some(raw => (object(raw).operations as unknown[]).some(rawOperation => { const operation = object(rawOperation); return operation.operationId === object(permission).operationId && operation.actor === "user" && operation.expectedOutcome === "revert"; })), "MODULE_ENGINE_AUTHORIZATION_EVIDENCE_MISSING");
  need(positive && new TextEncoder().encode(json(value)).length <= 256 * 1024, "MODULE_ENGINE_PLAN_INVALID");
  return JSON.parse(json(value)) as ModuleEngineBuildPlanV1;
}

function sourceInput(source: unknown, subject: ModuleReviewSubjectV1, plan: ModuleEngineBuildPlanV1) {
  need(new TextEncoder().encode(json(source)).length <= 24 * 1024 * 1024, "MODULE_BUILD_SOURCE_UNAVAILABLE");
  const checked = validateModuleSubmissionRequest(source);
  need(checked.ok && checked.requestDigest === subject.requestDigest && checked.request.descriptor.author.toLowerCase() === subject.author, "MODULE_BUILD_SOURCE_BINDING_INVALID");
  need(checked.totalSourceBytes <= MODULE_REVIEW_LIMITS_V1.sourceBytes, "MODULE_BUILD_PROFILE_CAPACITY_EXCEEDED");
  const target = checked.request.descriptor.components.find(c => c.id === plan.engineComponentId);
  need(target && target.runtime === MODULE_ENGINE_PROFILE_V1, "MODULE_BUILD_ADAPTER_UNSUPPORTED");
  need(/^[A-Za-z_$][A-Za-z0-9_$]{0,255}$/u.test(target.entrypoint), "MODULE_BUILD_ENTRYPOINT_INVALID");
  const sources = soliditySources(checked.request.files);
  need(Object.hasOwn(sources, target.sourcePath), "MODULE_BUILD_TARGET_MISSING");
  const standard = { language: "Solidity", sources, settings: NATIVE_SETTINGS_V1 };
  need(new TextEncoder().encode(json(standard)).length <= MODULE_REVIEW_LIMITS_V1.standardJsonBytes, "MODULE_BUILD_PROFILE_CAPACITY_EXCEEDED");
  return { checked, target, standard };
}
function abiTypes(parameters: unknown): unknown {
  need(Array.isArray(parameters), "MODULE_ENGINE_ABI_INVALID");
  return parameters.map(p => { const item = object(p); return { type: item.type, ...(item.components === undefined ? {} : { components: abiTypes(item.components) }) }; });
}
function contractArtifact(raw: unknown, target: { id: string; sourcePath: string; entrypoint: string }, plan: ModuleEngineBuildPlanV1): ModuleEngineContractArtifactV1 {
  const output = object(raw);
  need(output.errors === undefined || Array.isArray(output.errors) && !output.errors.some(e => object(e).severity === "error"), "MODULE_BUILD_COMPILATION_FAILED");
  const contract = object(object(object(output.contracts)[target.sourcePath])[target.entrypoint]);
  need(Array.isArray(contract.abi) && contract.abi.length <= 256, "MODULE_ENGINE_ABI_INVALID");
  const abi = contract.abi;
  const constructor = abi.find(x => object(x).type === "constructor");
  need(constructor && json(abiTypes(constructor.inputs)) === json(abiTypes(MODULE_ENGINE_CONSTRUCTOR_ABI_V1)) && constructor.stateMutability === "nonpayable", "MODULE_ENGINE_CONSTRUCTOR_ABI_MISMATCH");
  const functions = abi.filter(x => object(x).type === "function");
  for (const required of MODULE_ENGINE_INTERFACE_V1) {
    const actual = functions.find(x => toFunctionSelector(x) === toFunctionSelector(required));
    need(actual && json(abiTypes(actual.outputs)) === json(abiTypes(required.outputs)) && actual.stateMutability === required.stateMutability, "MODULE_ENGINE_INTERFACE_MISMATCH");
  }
  for (const c of plan.cases) for (const op of c.operations) for (const assertion of op.assertions) {
    need(functions.some(x => ["view", "pure"].includes(x.stateMutability) && toFunctionSelector(x) === assertion.callData.slice(0, 10)), "MODULE_ENGINE_ASSERTION_INTERFACE_INVALID");
  }
  const evm = object(contract.evm), deployed = object(evm.deployedBytecode);
  const creationBytecode = `0x${String(object(evm.bytecode).object)}` as const;
  const runtimeTemplate = `0x${String(deployed.object)}` as const;
  hex(creationBytecode, MODULE_REVIEW_LIMITS_V1.creationBytes, 1); hex(runtimeTemplate, MODULE_REVIEW_LIMITS_V1.runtimeBytes, 1);
  const refs = object(deployed.immutableReferences ?? {}), ranges: { id: string; start: number; length: 32; constructorOffset: number }[] = [];
  need(json(Object.keys(refs).sort()) === json(plan.immutableBindings.map(x => x.id).sort()), "MODULE_ENGINE_IMMUTABLE_COVERAGE_MISMATCH");
  for (const [id, rawRanges] of Object.entries(refs)) {
    const mapping = plan.immutableBindings.find(x => x.id === id)!;
    need(Array.isArray(rawRanges) && rawRanges.length > 0 && rawRanges.length <= 128, "MODULE_ENGINE_IMMUTABLE_RANGES_INVALID");
    for (const value of rawRanges) {
      const range = exact(value, ["start", "length"]);
      need(Number.isSafeInteger(range.start) && Number(range.start) >= 0 && range.length === 32 && Number(range.start) + 32 <= (runtimeTemplate.length - 2) / 2, "MODULE_ENGINE_IMMUTABLE_RANGES_INVALID");
      need(runtimeTemplate.slice(2 + Number(range.start) * 2, 2 + (Number(range.start) + 32) * 2) === "0".repeat(64), "MODULE_ENGINE_IMMUTABLE_TEMPLATE_INVALID");
      ranges.push({ id, start: Number(range.start), length: 32, constructorOffset: mapping.constructorOffset });
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  need(ranges.length <= 128 && ranges.every((r, i) => i === 0 || ranges[i - 1]!.start + 32 <= r.start), "MODULE_ENGINE_IMMUTABLE_RANGES_INVALID");
  return {
    componentId: target.id, sourcePath: target.sourcePath, contractName: target.entrypoint,
    abi, abiHash: moduleReviewDigestV1("programmable.modules.abi.v1", abi),
    creationBytecode, creationCodeHash: keccak256(creationBytecode), runtimeTemplate, runtimeTemplateHash: keccak256(runtimeTemplate),
    immutableReferences: Object.keys(refs).sort().map(id => ({ id, ranges: ranges.filter(r => r.id === id).map(({ start, length }) => ({ start, length })) })),
    immutableRuntimeOffsets: ranges.map(r => r.start), immutableConstructorOffsets: ranges.map(r => r.constructorOffset),
    externalSelectors: functions.map(x => toFunctionSelector(x)).sort(),
  };
}

/** Only compiler-authenticated zero slots may vary, and every value is copied from the exact constructor. */
export function materializeModuleEngineRuntimeV1(engine: ModuleEngineContractArtifactV1, constructorArgs: `0x${string}`): `0x${string}` {
  const runtime = hexToBytes(engine.runtimeTemplate), args = hexToBytes(constructorArgs);
  need(engine.immutableRuntimeOffsets.length === engine.immutableConstructorOffsets.length, "MODULE_ENGINE_IMMUTABLE_COVERAGE_MISMATCH");
  for (let i = 0; i < engine.immutableRuntimeOffsets.length; i++) {
    const to = engine.immutableRuntimeOffsets[i]!, from = engine.immutableConstructorOffsets[i]!;
    need(Number.isSafeInteger(from) && from >= 0 && from % 32 === 0 && from + 32 <= args.length && Number.isSafeInteger(to) && to >= 0 && to + 32 <= runtime.length && (i === 0 || engine.immutableRuntimeOffsets[i - 1]! + 32 <= to) && runtime.subarray(to, to + 32).every(x => x === 0), "MODULE_ENGINE_IMMUTABLE_CONSTRUCTOR_RANGE_INVALID");
    runtime.set(args.subarray(from, from + 32), to);
  }
  return bytesToHex(runtime);
}
function compiledCases(plan: ModuleEngineBuildPlanV1, source: ReturnType<typeof sourceInput>, engine: ModuleEngineContractArtifactV1): ModuleEngineCompiledCaseV1[] {
  const descriptor = source.checked.request.descriptor;
  return plan.cases.map(c => {
    const configBytes = c.rawConfigBytes ?? encodeProgramConfiguration(plan.configurationAbi.map(a => ({ type: a.type, path: [...a.path] })), compileOpenConfig(descriptor.configuration, c.parameters, { roles: { author: descriptor.author, reward: descriptor.rewardWallet } }));
    const context = {
      host: MODULE_ENGINE_REVIEW_HOST_V1,
      launchId: moduleReviewDigestV1("programmable.modules.engine-review-launch.v1", { requestDigest: plan.requestDigest, caseId: c.id }),
      token: c.token, creator: MODULE_ENGINE_REVIEW_ACTOR_V1, quoteAsset: c.quoteAsset, feeCollector: MODULE_ENGINE_REVIEW_HOST_V1,
    };
    const constructorArgs = encodeAbiParameters(MODULE_ENGINE_CONSTRUCTOR_ABI_V1, [context, configBytes]);
    const runtimeBytecode = materializeModuleEngineRuntimeV1(engine, constructorArgs);
    const initCode = `${engine.creationBytecode}${constructorArgs.slice(2)}` as `0x${string}`;
    need((initCode.length - 2) / 2 <= MODULE_REVIEW_LIMITS_V1.creationBytes, "MODULE_ENGINE_INITCODE_TOO_LARGE");
    return { ...c, context, contextHash: keccak256(encodeAbiParameters([{ type: "tuple", components: MODULE_ENGINE_CONTEXT_ABI_V1 }], [context])), configBytes, configHash: keccak256(configBytes), constructorArgs, constructorHash: keccak256(constructorArgs), initCodeHash: keccak256(initCode), runtimeBytecode, runtimeCodeHash: keccak256(runtimeBytecode) };
  });
}
function compilerIdentity(standard: unknown) {
  return { version: ENGINE_REVIEW_COMPILER.version, binarySha256: ENGINE_REVIEW_COMPILER.binarySha256, imageDigest: ENGINE_REVIEW_COMPILER.imageDigest, settingsHash: moduleReviewDigestV1("programmable.modules.compiler-settings.v1", NATIVE_SETTINGS_V1), completeInputHash: moduleReviewDigestV1("programmable.modules.compiler-input.v1", standard), reproducible: true as const };
}
function artifactContents(subject: ModuleReviewSubjectV1, plan: ModuleEngineBuildPlanV1, source: ReturnType<typeof sourceInput>, engine: ModuleEngineContractArtifactV1, tests: ModuleEngineTestResultV1) {
  const descriptor = source.checked.request.descriptor;
  const planDigest = moduleReviewDigestV1(MODULE_ENGINE_PLAN_SCHEMA_V1, plan), cases = compiledCases(plan, source, engine);
  validateModuleEngineTestResultsV1(tests, subject.requestDigest, planDigest, cases);
  return {
    schemaVersion: MODULE_ENGINE_BUILD_SCHEMA_V1, authority: "programmable.module-review.engine-build.v1" as const, subject,
    packageId: source.checked.packageId, familyId: source.checked.familyId, rewardWallet: descriptor.rewardWallet.toLowerCase(),
    sourceManifestHash: moduleReviewDigestV1("programmable.modules.source-manifest.v1", descriptor), planDigest,
    configurationSchemaHash: moduleReviewDigestV1("programmable.modules.configuration-schema.v1", descriptor.configuration),
    configurationCodec: plan.configurationCodec, configurationAbi: plan.configurationAbi,
    compiler: compilerIdentity(source.standard), engine, executionGas: plan.executionGas, operationPermissions: plan.operationPermissions, moneyRights: plan.moneyRights, coinRights: plan.coinRights, testEconomics: plan.testEconomics, cases, tests,
    reviewRequired: MODULE_ENGINE_REVIEW_AREAS_V1, approved: false as const, registryApproved: false as const, available: false as const,
  };
}
export function validateModuleEngineTestResultsV1(results: ModuleEngineTestResultV1, requestDigest: ModuleDigestV1, planDigest: ModuleDigestV1, cases: readonly ModuleEngineCompiledCaseV1[]) {
  exact(results, ["schemaVersion", "requestDigest", "planDigest", "harnessDigest", "execution", "cases", "allRequiredChecksPassed"]);
  need(results.schemaVersion === "programmable.modules.engine-test-results.v1" && results.execution === "isolated-docker-anvil" && results.requestDigest === requestDigest && results.planDigest === planDigest && DIGEST.test(results.harnessDigest), "MODULE_ENGINE_TEST_SUBJECT_MISMATCH");
  need(results.allRequiredChecksPassed === true && Array.isArray(results.cases) && results.cases.length === cases.length, "MODULE_ENGINE_TESTS_FAILED");
  results.cases.forEach((r: ModuleEngineTestResultV1["cases"][number], i: number) => {
    const c = cases[i]!;
    exact(r, ["id", "constructorHash", "runtimeCodeHash", "deploymentMatched", "codeHashMatched", "contextMatched", "resourcesMatched", "unauthorizedInitializeReverted", "unauthorizedExecuteReverted", "operations"]);
    need(r.id === c.id && r.constructorHash === c.constructorHash && r.runtimeCodeHash === c.runtimeCodeHash && r.deploymentMatched === true, "MODULE_ENGINE_TEST_CASE_MISMATCH");
    const positive = c.expectedDeployment === "success";
    need([r.codeHashMatched, r.contextMatched, r.resourcesMatched, r.unauthorizedInitializeReverted, r.unauthorizedExecuteReverted].every(v => v === (positive ? true : null)), "MODULE_ENGINE_TESTS_FAILED");
    need(Array.isArray(r.operations) && r.operations.length === c.operations.length, "MODULE_ENGINE_OPERATION_EVIDENCE_MISSING");
    r.operations.forEach((o, j) => {
      exact(o, ["id", "outcomeMatched", "resultMatched", "stateMatched", "inputOutputBound", "replayReverted", "feesBacked"]);
      need(o.id === c.operations[j]!.id && o.outcomeMatched === true && o.resultMatched === true && o.stateMatched === true && o.inputOutputBound === true && o.replayReverted === true && o.feesBacked === true, "MODULE_ENGINE_OPERATIONS_FAILED");
    });
  });
}

/** API-side reconstruction binds the authenticated worker result; no contributor code executes here. */
export function verifyModuleEngineBuildArtifactV1(artifact: ModuleEngineBuildArtifactV1, subject: ModuleReviewSubjectV1, rawPlan: unknown, sourceRequest: unknown): void {
  const plan = validateModuleEngineBuildPlanV1(rawPlan, subject), source = sourceInput(sourceRequest, subject, plan), value = artifact.engine;
  const engine = contractArtifact({ contracts: { [source.target.sourcePath]: { [source.target.entrypoint]: { abi: value.abi, evm: { bytecode: { object: value.creationBytecode.slice(2) }, deployedBytecode: { object: value.runtimeTemplate.slice(2), immutableReferences: Object.fromEntries(value.immutableReferences.map(r => [r.id, r.ranges])) } } } } } }, source.target, plan);
  const contents = artifactContents(subject, plan, source, engine, artifact.tests);
  const expected = { ...contents, artifactDigest: moduleReviewDigestV1(MODULE_ENGINE_BUILD_SCHEMA_V1, contents) };
  need(json(artifact) === json(expected) && new TextEncoder().encode(json(artifact)).length <= MODULE_REVIEW_LIMITS_V1.artifactBytes, "MODULE_REVIEW_BUILD_BINDING_INVALID");
}

/** DTO reader: byte identities and case evidence are checked before any UI or publisher consumes the build. */
export function parseEngineReviewArtifact(value: unknown, subject: ModuleReviewSubjectV1, plan?: ModuleEngineBuildPlanV1): ModuleEngineBuildArtifactV1 {
  const raw = object(nativeJson(value)), {artifactDigest,...contents}=raw;
  need(raw.schemaVersion===MODULE_ENGINE_BUILD_SCHEMA_V1 && raw.authority==="programmable.module-review.engine-build.v1" && typeof artifactDigest==="string" && DIGEST.test(artifactDigest) && moduleReviewDigestV1(MODULE_ENGINE_BUILD_SCHEMA_V1,contents)===artifactDigest,"MODULE_ENGINE_BUILD_DIGEST_INVALID");
  need(json(parseReviewSubject(raw.subject))===json(subject) && raw.approved===false && raw.registryApproved===false && raw.available===false,"MODULE_ENGINE_BUILD_AUTHORITY_INVALID");
  for(const field of ["packageId","familyId","sourceManifestHash","planDigest","configurationSchemaHash"]) need(typeof raw[field]==="string" && DIGEST.test(raw[field]),"MODULE_ENGINE_BUILD_IDENTITY_INVALID");
  need(typeof raw.rewardWallet==="string" && ADDRESS.test(raw.rewardWallet),"MODULE_ENGINE_REWARD_INVALID");
  need(json(raw.reviewRequired)===json(MODULE_ENGINE_REVIEW_AREAS_V1),"MODULE_ENGINE_REVIEW_COVERAGE_INVALID");
  need(raw.configurationCodec===MODULE_ENGINE_CONFIGURATION_CODEC_V1,"MODULE_ENGINE_CODEC_UNSUPPORTED"); parseReviewProgramAbi(raw.configurationAbi);
  const artifact=raw as unknown as ModuleEngineBuildArtifactV1;
  need(Array.isArray(artifact.cases) && artifact.cases.length>0 && artifact.cases.length<=16,"MODULE_ENGINE_CASES_INVALID");
  const engine=artifact.engine;
  need(engine && engine.abiHash===moduleReviewDigestV1("programmable.modules.abi.v1",engine.abi),"MODULE_ENGINE_ABI_INVALID");
  hex(engine.creationBytecode,MODULE_REVIEW_LIMITS_V1.creationBytes,1);hex(engine.runtimeTemplate,MODULE_REVIEW_LIMITS_V1.runtimeBytes,1);
  need(keccak256(engine.creationBytecode)===engine.creationCodeHash && keccak256(engine.runtimeTemplate)===engine.runtimeTemplateHash,"MODULE_ENGINE_CODE_INVALID");
  need(Array.isArray(engine.immutableReferences) && Array.isArray(engine.immutableRuntimeOffsets) && engine.immutableRuntimeOffsets.length<=128 && Array.isArray(engine.immutableConstructorOffsets),"MODULE_ENGINE_IMMUTABLE_RANGES_INVALID");
  if(plan) {
    need(artifact.planDigest===moduleReviewDigestV1(MODULE_ENGINE_PLAN_SCHEMA_V1,plan) && artifact.executionGas===plan.executionGas && artifact.moneyRights===plan.moneyRights && artifact.coinRights===plan.coinRights && json(artifact.operationPermissions)===json(plan.operationPermissions) && json(artifact.testEconomics)===json(plan.testEconomics) && json(artifact.configurationAbi)===json(plan.configurationAbi),"MODULE_ENGINE_BUILD_PLAN_MISMATCH");
    const rebuilt=contractArtifact({contracts:{[engine.sourcePath]:{[engine.contractName]:{abi:engine.abi,evm:{bytecode:{object:engine.creationBytecode.slice(2)},deployedBytecode:{object:engine.runtimeTemplate.slice(2),immutableReferences:Object.fromEntries(engine.immutableReferences.map(r=>[r.id,r.ranges]))}}}}}},{id:plan.engineComponentId,sourcePath:engine.sourcePath,entrypoint:engine.contractName},plan);
    need(json(engine)===json(rebuilt) && artifact.cases.length===plan.cases.length,"MODULE_ENGINE_BUILD_CONTRACT_MISMATCH");
  }
  for(const [i,c] of artifact.cases.entries()) {
    const context={host:MODULE_ENGINE_REVIEW_HOST_V1,launchId:moduleReviewDigestV1("programmable.modules.engine-review-launch.v1",{requestDigest:subject.requestDigest,caseId:c.id}),token:c.token,creator:MODULE_ENGINE_REVIEW_ACTOR_V1,quoteAsset:c.quoteAsset,feeCollector:MODULE_ENGINE_REVIEW_HOST_V1};
    hex(c.configBytes); const args=encodeAbiParameters(MODULE_ENGINE_CONSTRUCTOR_ABI_V1,[context,c.configBytes]);
    need(json(c.context)===json(context) && c.contextHash===keccak256(encodeAbiParameters([{type:"tuple",components:MODULE_ENGINE_CONTEXT_ABI_V1}],[context])) && c.configHash===keccak256(c.configBytes) && c.constructorArgs===args && c.constructorHash===keccak256(args) && c.initCodeHash===keccak256(`${engine.creationBytecode}${args.slice(2)}`) && c.runtimeBytecode===materializeModuleEngineRuntimeV1(engine,args) && c.runtimeCodeHash===keccak256(c.runtimeBytecode),"MODULE_ENGINE_INSTANCE_BINDING_INVALID");
    if(plan) for(const [key,value] of Object.entries(plan.cases[i])) need(json(object(c)[key])===json(value),"MODULE_ENGINE_BUILD_CASE_MISMATCH");
  }
  validateModuleEngineTestResultsV1(artifact.tests,subject.requestDigest,artifact.planDigest,artifact.cases);
  need(new TextEncoder().encode(json(artifact)).length<=MODULE_REVIEW_LIMITS_V1.artifactBytes,"MODULE_ENGINE_ARTIFACT_TOO_LARGE");
  return artifact;
}
