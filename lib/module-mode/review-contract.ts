import { keccak256, sha256, toHex, type Hex } from "viem";
import { nativeCanonicalJson, nativeJson } from "./native-catalog";
import type { OpenSourcePackage } from "@/packages/classic-modules/src/open-packages.mjs";
import type { ModuleReviewDecisionCommandV1, ModuleReviewDecisionRecordV1 } from "@/lib/server/module-mode/review-decision-wire-v1";

export type { ModuleReviewDecisionCommandV1, ModuleReviewDecisionRecordV1 };
export const MODULE_REVIEW_STATES = ["awaiting_plan", "queued", "running", "built", "build_failed", "changes_requested", "accepted", "rejected"] as const;
export type ModuleReviewState = typeof MODULE_REVIEW_STATES[number];
export interface ReviewSubject { submissionId: string; principalId: string; author: string; requestDigest: Hex }
export interface ReviewProgramArgument { path: string[]; type: string }
export interface ReviewPlan { schemaVersion: "programmable.modules.native-build-plan.v1"; submissionId: string; requestDigest: Hex; programComponentId: string; factoryComponentId: string; configurationCodec: "programmable.native-abi@1"; programAbi: ReviewProgramArgument[]; callbackGas: number; cases: { id: string; parameters: unknown; budgetWei: string; expectedDeployment: "success" | "revert"; rawConfigBytes?: Hex }[] }
export interface ReviewContractArtifact { componentId: string; sourcePath: string; contractName: string; abi: unknown[]; abiHash: Hex; creationBytecode: Hex; creationCodeHash: Hex; runtimeBytecode: Hex; runtimeCodeHash: Hex; externalSelectors: string[] }
export interface ReviewBuildArtifact {
  schemaVersion: "programmable.modules.native-build.v1"; authority: "programmable.module-review.native-build.v1";
  subject: ReviewSubject; packageId: Hex; familyId: Hex; rewardWallet: string; sourceManifestHash: Hex; planDigest: Hex; configurationSchemaHash: Hex;
  compiler: { version: string; binarySha256: string; imageDigest: string; settingsHash: Hex; completeInputHash: Hex; reproducible: true };
  factory: ReviewContractArtifact; program: ReviewContractArtifact; configurationCodec: "programmable.native-abi@1"; programAbi: ReviewProgramArgument[]; callbackGas: number; cases: unknown[];
  tests: { schemaVersion: "programmable.modules.native-test-results.v1"; requestDigest: Hex; planDigest: Hex; harnessDigest: Hex; execution: "isolated-docker-anvil"; cases: Record<string, unknown>[]; allRequiredChecksPassed: boolean };
  reviewRequired: string[]; approved: false; registryApproved: false; available: false; artifactDigest: Hex;
}
export interface ReviewJob { subject: ReviewSubject; state: ModuleReviewState; reviewRevision: number; plan: ReviewPlan | null; planDigest: Hex | null; artifact: ReviewBuildArtifact | null; attempt: number; lastError: string | null; createdAt: string; updatedAt: string }
export interface ReviewQueueItem extends Omit<ReviewJob, "artifact" | "plan" | "planDigest"> { build: { artifactDigest: Hex; programName: string; testsPassed: boolean; caseCount: number } | null }
export interface ReviewQueue { schemaVersion: "programmable.modules.website-review-queue.v1"; jobs: ReviewQueueItem[]; nextCursor: string | null }
export interface ReviewSourceInfo { descriptor: OpenSourcePackage; packageId: Hex; familyId: Hex; files: { path: string; sha256: string; bytes: number }[] }
export interface ReviewAttempt { attempt: number; event: "claimed" | "completed" | "failed" | "expired"; requestDigest: Hex; planDigest: Hex; workerIdentity: null | { sourceCommit: string; runId: string; runAttempt: string; workflowRef: string; identityDigest: Hex }; artifactDigest: Hex | null; errorCode: string | null; createdAt: string }
export interface ReviewDetail { schemaVersion: "programmable.modules.website-review-detail.v1"; job: ReviewJob; decisions: ModuleReviewDecisionRecordV1[]; attempts: ReviewAttempt[]; source: ReviewSourceInfo }
export interface ReviewManifestCheck { schemaVersion: "programmable.modules.website-manifest-check.v1"; submissionId: string; requestDigest: Hex; reviewRevision: number; artifactDigest: Hex; hostManifestHash: Hex }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH = /^0x(?!0{64}$)[0-9a-f]{64}$/u;
const ADDRESS = /^0x(?!0{40}$)[0-9a-f]{40}$/u;
export function isReviewId(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
export function isReviewDigest(value: unknown): value is Hex { return typeof value === "string" && HASH.test(value); }
export function reviewRecord(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Module review data is invalid.");
  const result = value as Record<string, unknown>;
  if (keys && (Object.keys(result).length !== keys.length || keys.some((key) => !Object.hasOwn(result, key)))) throw new Error("Module review fields differ from the expected format.");
  return result;
}
function requireValue(ok: unknown, label: string): asserts ok { if (!ok) throw new Error(`Module review ${label} is invalid.`); }
function integer(value: unknown) { return Number.isSafeInteger(value) && Number(value) >= 0; }
function timestamp(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
const JOB_KEYS = ["subject", "state", "reviewRevision", "plan", "planDigest", "artifact", "attempt", "lastError", "createdAt", "updatedAt"];
function jobState(r: Record<string, unknown>) {
  requireValue(MODULE_REVIEW_STATES.includes(r.state as ModuleReviewState) && integer(r.reviewRevision) && integer(r.attempt) && (r.lastError === null || (typeof r.lastError === "string" && r.lastError.length <= 256)) && timestamp(r.createdAt) && timestamp(r.updatedAt), "job state");
}
export function reviewDigest(domain: string, value: unknown): Hex { return sha256(toHex(nativeCanonicalJson({ domain, value }))); }
export function parseReviewSubject(value: unknown): ReviewSubject {
  const r = reviewRecord(value, ["submissionId", "principalId", "author", "requestDigest"]);
  requireValue(isReviewId(r.submissionId) && isReviewId(r.principalId) && typeof r.author === "string" && ADDRESS.test(r.author) && isReviewDigest(r.requestDigest), "subject");
  return r as unknown as ReviewSubject;
}
export function parseReviewProgramAbi(value: unknown): ReviewProgramArgument[] {
  requireValue(Array.isArray(value) && value.length <= 128, "configuration ABI");
  for (const raw of value) {
    const argument = reviewRecord(raw, ["path", "type"]);
    requireValue(Array.isArray(argument.path) && argument.path.length <= 16 && argument.path.every(key => typeof key === "string" && /^(?:[A-Za-z_][A-Za-z0-9_]{0,63}|0|[1-9][0-9]{0,2})$/u.test(key) && !["__proto__", "prototype", "constructor"].includes(key)), "configuration ABI path");
    requireValue(typeof argument.type === "string" && argument.type.length > 0 && argument.type.length <= 128, "configuration ABI type");
    const type = /^(address|bool|string|bytes(?:[1-9]|[12][0-9]|3[0-2])?|uint(?:[1-9][0-9]{0,2})?)((?:\[(?:[1-9][0-9]{0,2})?\])*)$/u.exec(argument.type);
    requireValue(type !== null, "configuration ABI type");
    if (type[1].startsWith("uint") && type[1] !== "uint") {
      const bits = Number(type[1].slice(4));
      requireValue(bits >= 8 && bits <= 256 && bits % 8 === 0, "configuration ABI integer width");
    }
    const dimensions = [...type[2].matchAll(/\[([0-9]*)\]/gu)];
    requireValue(dimensions.length <= 12 && dimensions.every(([, size]) => size === "" || Number(size) <= 256), "configuration ABI array bounds");
  }
  return value as ReviewProgramArgument[];
}
export function parseReviewPlan(value: unknown, subject: ReviewSubject): ReviewPlan {
  const p = reviewRecord(nativeJson(value), ["schemaVersion", "submissionId", "requestDigest", "programComponentId", "factoryComponentId", "configurationCodec", "programAbi", "callbackGas", "cases"]);
  requireValue(p.schemaVersion === "programmable.modules.native-build-plan.v1" && p.submissionId === subject.submissionId && p.requestDigest === subject.requestDigest, "plan subject");
  requireValue(p.configurationCodec === "programmable.native-abi@1", "configuration codec");
  parseReviewProgramAbi(p.programAbi);
  const identifier = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;
  requireValue(typeof p.programComponentId === "string" && identifier.test(p.programComponentId) && typeof p.factoryComponentId === "string" && identifier.test(p.factoryComponentId) && p.programComponentId !== p.factoryComponentId, "plan components");
  requireValue(integer(p.callbackGas) && Number(p.callbackGas) >= 25_000 && Number(p.callbackGas) <= 500_000, "callback gas");
  requireValue(Array.isArray(p.cases) && p.cases.length >= 1 && p.cases.length <= 16, "plan cases");
  const ids = new Set<string>(); let positive = false;
  for (const raw of p.cases) {
    const c = reviewRecord(raw, ["id", "parameters", "budgetWei", "expectedDeployment", ...(Object.hasOwn(reviewRecord(raw), "rawConfigBytes") ? ["rawConfigBytes"] : [])]);
    requireValue(typeof c.id === "string" && identifier.test(c.id) && !ids.has(c.id), "case identifier"); ids.add(c.id);
    requireValue(typeof c.budgetWei === "string" && /^(0|[1-9][0-9]{0,38})$/u.test(c.budgetWei) && BigInt(c.budgetWei) < 2n ** 128n, "case budget");
    requireValue(c.expectedDeployment === "success" || c.expectedDeployment === "revert", "case outcome");
    requireValue(c.rawConfigBytes === undefined || (c.expectedDeployment === "revert" && typeof c.rawConfigBytes === "string" && /^0x(?:[0-9a-f]{2})*$/u.test(c.rawConfigBytes) && c.rawConfigBytes.length <= 32_770), "negative configuration");
    positive ||= c.expectedDeployment === "success";
  }
  requireValue(positive, "positive test coverage");
  return p as unknown as ReviewPlan;
}
export function parseReviewArtifact(value: unknown, subject: ReviewSubject): ReviewBuildArtifact {
  const r = reviewRecord(nativeJson(value));
  const { artifactDigest, ...contents } = r;
  requireValue(r.schemaVersion === "programmable.modules.native-build.v1" && r.authority === "programmable.module-review.native-build.v1" && isReviewDigest(artifactDigest) && reviewDigest("programmable.modules.native-build.v1", contents) === artifactDigest, "build digest");
  requireValue(nativeCanonicalJson(parseReviewSubject(r.subject)) === nativeCanonicalJson(subject), "build subject");
  requireValue(r.configurationCodec === "programmable.native-abi@1", "configuration codec");
  parseReviewProgramAbi(r.programAbi);
  for (const field of ["packageId", "familyId", "sourceManifestHash", "planDigest", "configurationSchemaHash"]) requireValue(isReviewDigest(r[field]), field);
  requireValue(typeof r.rewardWallet === "string" && ADDRESS.test(r.rewardWallet) && r.approved === false && r.registryApproved === false && r.available === false, "build authority");
  requireValue(integer(r.callbackGas) && Number(r.callbackGas) >= 25_000 && Number(r.callbackGas) <= 500_000 && Array.isArray(r.cases) && r.cases.length >= 1 && r.cases.length <= 16, "build cases");
  requireValue(Array.isArray(r.reviewRequired) && r.reviewRequired.length <= 32 && new Set(r.reviewRequired).size === r.reviewRequired.length && r.reviewRequired.every((area) => typeof area === "string" && /^[a-z][a-z0-9-]{0,127}$/u.test(area)), "required review areas");
  const compiler = reviewRecord(r.compiler);
  requireValue(compiler.reproducible === true && ["version", "binarySha256", "imageDigest"].every((key) => typeof compiler[key] === "string" && String(compiler[key]).length < 256), "compiler");
  requireValue(isReviewDigest(compiler.settingsHash) && isReviewDigest(compiler.completeInputHash), "compiler input");
  for (const key of ["factory", "program"]) {
    const c = reviewRecord(r[key]);
    requireValue(["componentId", "sourcePath", "contractName"].every((field) => typeof c[field] === "string" && String(c[field]).length <= 512) && Array.isArray(c.abi) && c.abi.length <= 256 && Array.isArray(c.externalSelectors), "compiled contract");
    requireValue(c.abiHash === reviewDigest("programmable.modules.abi.v1", c.abi) && c.externalSelectors.every((selector) => typeof selector === "string" && /^0x[0-9a-f]{8}$/u.test(selector)), "compiled ABI");
    for (const [bytes, hash, maximum] of [["runtimeBytecode", "runtimeCodeHash", 49_154], ["creationBytecode", "creationCodeHash", 98_306]] as const) {
      requireValue(typeof c[bytes] === "string" && /^0x(?:[0-9a-f]{2})+$/u.test(c[bytes]) && c[bytes].length <= maximum && keccak256(c[bytes] as Hex) === c[hash], "compiled bytecode");
    }
  }
  const tests = reviewRecord(r.tests);
  requireValue(tests.schemaVersion === "programmable.modules.native-test-results.v1" && tests.requestDigest === subject.requestDigest && tests.planDigest === r.planDigest && isReviewDigest(tests.harnessDigest) && tests.execution === "isolated-docker-anvil" && typeof tests.allRequiredChecksPassed === "boolean" && Array.isArray(tests.cases) && tests.cases.length <= 16, "build test results");
  requireValue(tests.cases.length === r.cases.length, "test coverage");
  const flags = ["codeHashMatched", "bindingMatched", "unauthorizedTradeReverted", "unauthorizedActionReverted", "callbackGasBound", "budgetIsolationChecked"];
  tests.cases.forEach((raw, index) => {
    const result = reviewRecord(raw, ["id", "configHash", "deploymentMatched", ...flags]);
    const compiled = reviewRecord((r.cases as unknown[])[index]);
    requireValue(typeof result.id === "string" && result.id === compiled.id && isReviewDigest(result.configHash) && result.configHash === compiled.configHash && typeof result.deploymentMatched === "boolean" && flags.every((key) => result[key] === null || typeof result[key] === "boolean"), "test case");
    if (tests.allRequiredChecksPassed) requireValue(result.deploymentMatched && flags.every((key) => result[key] === (compiled.expectedDeployment === "success" ? true : null)), "reported test success");
  });
  return r as unknown as ReviewBuildArtifact;
}
export function parseReviewJob(value: unknown): ReviewJob {
  const r = reviewRecord(value, JOB_KEYS);
  const subject = parseReviewSubject(r.subject);
  jobState(r);
  const plan = r.plan === null ? null : parseReviewPlan(r.plan, subject);
  requireValue(plan === null ? r.planDigest === null : r.planDigest === reviewDigest("programmable.modules.native-build-plan.v1", plan), "plan digest");
  const artifact = r.artifact === null ? null : parseReviewArtifact(r.artifact, subject);
  requireValue(!artifact || artifact.planDigest === r.planDigest, "build plan binding");
  requireValue(!artifact || (plan !== null && artifact.configurationCodec === plan.configurationCodec && nativeCanonicalJson(artifact.programAbi) === nativeCanonicalJson(plan.programAbi)), "build configuration ABI binding");
  requireValue(!["built", "accepted"].includes(String(r.state)) || artifact !== null, "required build");
  return { ...(r as unknown as ReviewJob), subject, plan, artifact };
}
export function parseReviewAttempt(value: unknown, subject: ReviewSubject): ReviewAttempt {
  const r = reviewRecord(value, ["attempt", "event", "requestDigest", "planDigest", "workerIdentity", "artifactDigest", "errorCode", "createdAt"]);
  requireValue(integer(r.attempt) && Number(r.attempt) > 0 && ["claimed", "completed", "failed", "expired"].includes(String(r.event)) && r.requestDigest === subject.requestDigest && isReviewDigest(r.planDigest) && (r.artifactDigest === null || isReviewDigest(r.artifactDigest)) && (r.errorCode === null || (typeof r.errorCode === "string" && /^[A-Z_a-z0-9]{1,128}$/u.test(r.errorCode))) && typeof r.createdAt === "string" && Number.isFinite(Date.parse(r.createdAt)), "build attempt");
  if (r.workerIdentity !== null) {
    const worker = reviewRecord(r.workerIdentity, ["sourceCommit", "runId", "runAttempt", "workflowRef", "identityDigest"]);
    requireValue(typeof worker.sourceCommit === "string" && /^[0-9a-f]{40}$/u.test(worker.sourceCommit) && typeof worker.runId === "string" && /^[1-9][0-9]{0,19}$/u.test(worker.runId) && typeof worker.runAttempt === "string" && /^[1-9][0-9]{0,9}$/u.test(worker.runAttempt) && typeof worker.workflowRef === "string" && worker.workflowRef.length <= 1024 && isReviewDigest(worker.identityDigest), "worker identity");
  }
  return r as unknown as ReviewAttempt;
}
export function summarizeReviewJob(job: ReviewJob): ReviewQueueItem {
  return { subject: job.subject, state: job.state, reviewRevision: job.reviewRevision, attempt: job.attempt, lastError: job.lastError, createdAt: job.createdAt, updatedAt: job.updatedAt, build: job.artifact ? { artifactDigest: job.artifact.artifactDigest, programName: job.artifact.program.contractName, testsPassed: job.artifact.tests.allRequiredChecksPassed, caseCount: job.artifact.tests.cases.length } : null };
}
export function parseReviewQueueItem(value: unknown): ReviewQueueItem {
  const r = reviewRecord(value, JOB_KEYS); jobState(r);
  const subject = parseReviewSubject(r.subject);
  requireValue(r.plan === null && r.artifact === null && (r.planDigest === null || isReviewDigest(r.planDigest)), "lightweight queue entry");
  return summarizeReviewJob({ ...r, subject } as unknown as ReviewJob);
}
export function reviewStateLabel(state: ModuleReviewState) {
  return ({ awaiting_plan: "Needs build plan", queued: "Queued", running: "Building", built: "Ready for review", build_failed: "Build failed", changes_requested: "Changes requested", accepted: "Review approved", rejected: "Rejected" })[state];
}
