import { createHash } from "node:crypto";
import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { NATIVE_ENGINE_PROFILE } from "../../lib/module-mode/builder";
import { referenceManagementManifest } from "../../lib/module-mode/management-manifest";
import { bindActiveModuleModeRelease } from "../../lib/module-mode/release";
import { reviewDigest, type ReviewBuildArtifact, type ReviewDetail, type ReviewJob, type ReviewPlan, type ReviewSubject } from "../../lib/module-mode/review-contract";
import { createModuleModeHostManifest, computeModuleModeHostManifestHash, type ModuleModeCatalogDefinition } from "../../lib/server/module-mode/catalog";
import { validateModuleSubmissionRequest, type ModuleSubmissionRequest } from "../../packages/classic-modules/src/open-transport.mjs";
import { a, h, moduleEvidenceFixture } from "./module-mode-evidence";
import { WEBSITE_ADMIN_WALLET } from "../../lib/admin-access";

// Synthetic parser and UI fixtures. Never deployment, worker, reviewer, or publication evidence.
export function moduleReviewAdminFixture(author = a(900)) {
  const release = bindActiveModuleModeRelease(moduleEvidenceFixture().release);
  const files = [{ path: "README.md", text: "Synthetic module review fixture. Never publish or admit." },
    { path: "src/Program.sol", text: "// Synthetic parser fixture, not a deployable module.\ncontract Program {}\ncontract Factory {}\n" }].map(file => ({
    path: file.path, sha256: createHash("sha256").update(file.text).digest("hex"), encoding: "base64" as const, bytes: Buffer.from(file.text).toString("base64"),
  }));
  const schema = { type: "record" as const, fields: { capNative: { type: "uint" as const, bits: 128, min: "1", label: "Maximum buys" }, duration: { type: "uint" as const, bits: 64, min: "1", label: "Duration" } }, required: ["capNative", "duration"] };
  const source: ModuleSubmissionRequest = { format: "programmable.modules.submission.v0.1", files, descriptor: {
    format: "programmable.classic.source-package.v0.1", name: "Synthetic opening cap", version: "1.0.0", author, rewardWallet: a(901), familySalt: h(902),
    source: { files: files.map(({ path, sha256 }) => ({ path, sha256 })) }, configuration: schema,
    components: [
      { id: "program", runtime: "programmable.module-native-runtime@1", sourcePath: "src/Program.sol", entrypoint: "Program" },
      { id: "factory", runtime: "programmable.module-native-runtime@1", sourcePath: "src/Program.sol", entrypoint: "Factory" },
    ], ports: { inputs: {}, outputs: {} }, constraints: [], management: { summary: "A synthetic opening wallet cap for review-interface testing.", reads: [], actions: [] },
    requiresHost: ["programmable.module-native-runtime@1", "programmable.module-config-abi@1", "programmable.module-management@1"], documentation: "README.md",
  } };
  const checked = validateModuleSubmissionRequest(source);
  if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
  const subject: ReviewSubject = { submissionId: "00000000-0000-4000-8000-000000000001", principalId: "00000000-0000-4000-8000-000000000002", author, requestDigest: checked.requestDigest };
  const plan: ReviewPlan = { schemaVersion: "programmable.modules.native-build-plan.v1", submissionId: subject.submissionId, requestDigest: subject.requestDigest,
    programComponentId: "program", factoryComponentId: "factory", configurationCodec: "programmable.native-abi@1", programAbi: [{ path: ["capNative"], type: "uint128" }, { path: ["duration"], type: "uint64" }], callbackGas: 75000,
    cases: [{ id: "basic", parameters: { capNative: "1", duration: "60" }, budgetWei: "0", expectedDeployment: "success" }] };
  const compiled = (id: string, code: Hex) => ({ componentId: id, sourcePath: "src/Program.sol", contractName: id === "program" ? "Program" : "Factory",
    abi: [], abiHash: reviewDigest("programmable.modules.abi.v1", []), creationBytecode: code, creationCodeHash: keccak256(code), runtimeBytecode: code, runtimeCodeHash: keccak256(code), externalSelectors: [] });
  const planDigest = reviewDigest("programmable.modules.native-build-plan.v1", plan);
  const configBytes = encodeAbiParameters([{ type: "uint128" }, { type: "uint64" }], [1n, 60n]);
  const configHash = keccak256(configBytes);
  const contents: Omit<ReviewBuildArtifact, "artifactDigest"> = {
    schemaVersion: "programmable.modules.native-build.v1", authority: "programmable.module-review.native-build.v1", subject,
    packageId: checked.packageId, familyId: checked.familyId, rewardWallet: a(901), sourceManifestHash: reviewDigest("programmable.modules.source-manifest.v1", source.descriptor), planDigest,
    configurationSchemaHash: reviewDigest("programmable.modules.configuration-schema.v1", schema),
    compiler: { version: "0.8.26", binarySha256: h(4).slice(2), imageDigest: `sha256:${h(5).slice(2)}`, settingsHash: h(6), completeInputHash: h(7), reproducible: true },
    factory: compiled("factory", "0x6001"), program: compiled("program", "0x6002"), configurationCodec: plan.configurationCodec, programAbi: plan.programAbi, callbackGas: plan.callbackGas,
    cases: [{ ...plan.cases[0], configBytes, configHash, abiParameters: plan.programAbi.map(({ type }) => ({ type })) }],
    tests: { schemaVersion: "programmable.modules.native-test-results.v1", requestDigest: subject.requestDigest, planDigest, harnessDigest: h(8), execution: "isolated-docker-anvil", allRequiredChecksPassed: true,
      cases: [{ id: "basic", configHash, deploymentMatched: true, codeHashMatched: true, bindingMatched: true, unauthorizedTradeReverted: true, unauthorizedActionReverted: true, callbackGasBound: true, budgetIsolationChecked: true }] },
    reviewRequired: ["complete-constructor-accepted-configuration-range", "external-calls-and-mutable-dependencies", "callback-liveness-and-manipulation", "budget-and-management-roles", "composition-with-other-packages"],
    approved: false, registryApproved: false, available: false,
  };
  const artifact = { ...contents, artifactDigest: reviewDigest("programmable.modules.native-build.v1", contents) };
  const job: ReviewJob = { subject, state: "built", reviewRevision: 2, plan, planDigest, artifact, attempt: 1, lastError: null, createdAt: "2026-09-06T01:00:00.000Z", updatedAt: "2026-09-06T01:10:00.000Z" };
  const definition: ModuleModeCatalogDefinition = { id: "synthetic-opening-cap-v1", title: "Opening buy limit", summary: "Synthetic opening limit.", detail: "A parser fixture only.", version: "1.0.0",
    engine: NATIVE_ENGINE_PROFILE, source: { path: "src/Program.sol", sha256: files[1].sha256 }, schema, defaults: { capNative: "1", duration: "60" }, fields: { capNative: { suffix: "ETH", decimals: 18 } }, programAbi: plan.programAbi, management: referenceManagementManifest("cap"), requiresHost: source.descriptor.requiresHost };
  const binding = { familyId: checked.familyId, packageId: checked.packageId, factory: a(800), factoryCodeHash: artifact.factory.runtimeCodeHash, moduleCodeHash: artifact.program.runtimeCodeHash, callbackGas: 75000 };
  const manifest = createModuleModeHostManifest({ release, definition, nativeBinding: binding, descriptor: source.descriptor });
  const detail: ReviewDetail = { schemaVersion: "programmable.modules.website-review-detail.v1", job, decisions: [], attempts: [{ attempt: 1, event: "completed", requestDigest: subject.requestDigest, planDigest, workerIdentity: { sourceCommit: "a".repeat(40), runId: "12345", runAttempt: "1", workflowRef: "synthetic/fixture/.github/workflows/review.yml@refs/heads/test", identityDigest: h(11) }, artifactDigest: artifact.artifactDigest, errorCode: null, createdAt: job.updatedAt }], source: { descriptor: source.descriptor, packageId: checked.packageId, familyId: checked.familyId, files: files.map(file => ({ path: file.path, sha256: file.sha256, bytes: Buffer.from(file.bytes, "base64").byteLength })) } };
  return { release, source, subject, plan, artifact, job, definition, binding, manifest, manifestHash: computeModuleModeHostManifestHash(manifest), detail, reviewer: WEBSITE_ADMIN_WALLET.toLowerCase() as `0x${string}`, policyDigest: h(904) };
}
