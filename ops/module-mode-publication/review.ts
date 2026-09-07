import { verifyModuleEngineBuildArtifactV1 } from "../../lib/module-mode/review-engine-contract";
import type { ModuleEngineBuildArtifactV1, ModuleEngineBuildPlanV1 } from "../../lib/module-mode/review-engine-types";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { moduleAddress } from "../../lib/module-mode/release";
import { nativeCanonicalJson, nativeJson } from "../../lib/module-mode/native-catalog";
import { isReviewId, parseReviewAttempt, parseReviewJob, reviewDigest, reviewRecord, type ReviewAttempt, type ReviewBuildArtifact, type AnyReviewBuildArtifact, type ReviewPlan, type ReviewJob } from "../../lib/module-mode/review-contract";
import { validateModuleReviewDecisionRecordV1, type ModuleReviewDecisionRecordV1 } from "../../lib/server/module-mode/review-decision-wire-v1";
import { parseStrictJson } from "../../lib/server/projection-target/canonical-json";
import { validateModuleSubmissionRequest, type ModuleSubmissionRequest } from "../../packages/classic-modules/src/open-transport.mjs";
export { reviewDigest } from "../../lib/module-mode/review-contract";

export const REVIEW_ORIGIN = "https://programmable.market";
// Same native profile as the protected backend compiler. New pins require a reviewed operator release.
export const NATIVE_COMPILER = Object.freeze({
  version: "0.8.26+commit.8a97fa7a",
  binarySha256: "sha256:35ba6661f3bdaed995fc7af14c405502290cf681b3fd062fe8738cfdf6db14ed",
  imageDigest: "sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8",
});
export const NATIVE_SETTINGS = Object.freeze({ optimizer: { enabled: true, runs: 1000 }, evmVersion: "cancun", viaIR: true, metadata: { bytecodeHash: "none" } });
export class ModulePublicationError extends Error { constructor(message: string) { super(message); this.name = "ModulePublicationError"; } }
export function need(condition: unknown, message: string): asserts condition { if (!condition) throw new ModulePublicationError(message); }
export function same(a: unknown, b: unknown, label: string) { need(nativeCanonicalJson(a) === nativeCanonicalJson(b), `${label} differs`); }
export function exactJson(bytes: Uint8Array, maximumBytes = 24 * 1024 * 1024): unknown {
  return parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes), { maximumBytes, maximumDepth: 40 });
}
export interface OperatorSession { walletAddress: string; accessToken: string; identityToken?: string }
export async function readOperatorSession(file: string): Promise<OperatorSession> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    need(info.isFile() && info.nlink === 1 && info.uid === process.getuid?.() && (info.mode & 0o077) === 0 && info.size <= 32_768, "Session file must be a private, owner-only regular file");
    return bindSession(exactJson(await handle.readFile(), 32_768));
  } finally { await handle.close(); }
}
function bindSession(value: unknown): OperatorSession {
  const r = reviewRecord(value, ["walletAddress", "accessToken", ...(Object.hasOwn(reviewRecord(value), "identityToken") ? ["identityToken"] : [])]);
  const walletAddress = moduleAddress(r.walletAddress, "session.wallet");
  for (const key of ["accessToken", ...(r.identityToken === undefined ? [] : ["identityToken"])]) {
    need(typeof r[key] === "string" && /^[A-Za-z0-9_.-]{20,16384}$/u.test(r[key]), "Invalid operator session token");
  }
  return { walletAddress, accessToken: r.accessToken as string, ...(r.identityToken ? { identityToken: r.identityToken as string } : {}) };
}
export interface AuthenticatedReview {
  job: ReviewJob; artifact: AnyReviewBuildArtifact; source: ModuleSubmissionRequest; sourceBytes: Uint8Array;
  decisions: ModuleReviewDecisionRecordV1[]; observedAt: number; worker: unknown;
}
const authenticated = new WeakMap<object, string>();
function snapshotDigest(value: AuthenticatedReview) {
  return reviewDigest("programmable.modules.authenticated-publication-read.v1", { ...value, sourceBytes: Buffer.from(value.sourceBytes).toString("base64") });
}
export function requireAuthenticatedReview(value: AuthenticatedReview): void {
  need(authenticated.get(value) === snapshotDigest(value) && Date.now() - value.observedAt >= 0 && Date.now() - value.observedAt <= 300_000, "Fresh authenticated review read required");
}
function bindSource(job: ReviewJob, sourceBytes: Uint8Array): { source: ModuleSubmissionRequest; artifact: AnyReviewBuildArtifact } {
  const checked = validateModuleSubmissionRequest(exactJson(sourceBytes));
  need(checked.ok, "Invalid immutable submission");
  const source = checked.request, artifact = job.artifact;
  need(artifact && job.plan && ["built", "accepted"].includes(job.state), "Completed protected module build required");
  need(checked.requestDigest === job.subject.requestDigest && source.descriptor.author.toLowerCase() === job.subject.author, "Source does not bind the authenticated author");
  need(artifact.packageId === checked.packageId && artifact.familyId === checked.familyId && artifact.rewardWallet === source.descriptor.rewardWallet.toLowerCase(), "Build package identity differs");
  need(artifact.sourceManifestHash === reviewDigest("programmable.modules.source-manifest.v1", source.descriptor)
    && artifact.configurationSchemaHash === reviewDigest("programmable.modules.configuration-schema.v1", source.descriptor.configuration), "Build source manifest differs");
  const sources: Record<string, { content: string }> = Object.create(null);
  for (const file of source.files) if (file.path.endsWith(".sol")) sources[file.path] = { content: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(file.bytes, "base64")) };
  // Must match the protected builder's fixed alias inventory; package build scripts/config are inert.
  const prefix = "dependencies/openzeppelin-contracts/contracts/";
  for (const [path, content] of Object.entries(sources)) if (path.startsWith(prefix)) {
    const alias = `@openzeppelin/contracts/${path.slice(prefix.length)}`;
    need(!Object.hasOwn(sources, alias), "Compiler source alias collision");
    sources[alias] = content;
  }
  same(artifact.compiler, { ...NATIVE_COMPILER,
    settingsHash: reviewDigest("programmable.modules.compiler-settings.v1", NATIVE_SETTINGS),
    completeInputHash: reviewDigest("programmable.modules.compiler-input.v1", { language: "Solidity", sources, settings: NATIVE_SETTINGS }), reproducible: true }, "Pinned compiler/input");
  if (artifact.schemaVersion === "programmable.modules.engine-build.v1") {
    need(job.plan.schemaVersion === "programmable.modules.engine-build-plan.v1", "Engine build plan required");
    verifyModuleEngineBuildArtifactV1(artifact, job.subject, job.plan, source);
    return { source, artifact };
  }
  need(job.plan.schemaVersion === "programmable.modules.native-build-plan.v1", "Native build plan required");
  const nativePlan = job.plan;
  for (const role of ["factory", "program"] as const) {
    const compiled = artifact[role];
    const component = source.descriptor.components.find(component => component.id === nativePlan[`${role}ComponentId`]);
    const profiles = ["programmable.native-solidity@1", role === "factory" ? "evm-solidity-0.8.26@1" : "programmable.module-native-runtime@1"];
    need(component && profiles.includes(component.runtime) && component.id === compiled.componentId
      && component.sourcePath === compiled.sourcePath && component.entrypoint === compiled.contractName, "Compiled component differs from the reviewed source");
  }
  const constructor = artifact.factory.abi.find(item => reviewRecord(item).type === "constructor");
  need(constructor === undefined || (Array.isArray(reviewRecord(constructor).inputs) && (reviewRecord(constructor).inputs as unknown[]).length === 0), "Native factory constructor arguments are unsupported by this profile");
  need(artifact.tests.allRequiredChecksPassed && artifact.callbackGas === job.plan.callbackGas, "Protected test results or callback budget differ");
  return { source, artifact };
}
async function body(response: Response, maximum: number): Promise<Uint8Array> {
  need(response.status === 200 && !response.redirected && response.body && /^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? ""), "Authenticated review endpoint unavailable");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  try {
    for (;;) { const item = await reader.read(); if (item.done) break; total += item.value.byteLength; need(total <= maximum, "Review response too large"); chunks.push(item.value); }
    return Buffer.concat(chunks);
  } catch (error) { await reader.cancel(); throw error; } finally { reader.releaseLock(); }
}
function completedWorker(job: ReviewJob, artifact: AnyReviewBuildArtifact, history: unknown) {
  need(Array.isArray(history) && history.length >= 2 && history.length <= 24, "Review worker attempts missing");
  need(job.attempt > 0 && job.attempt <= 1000, "Current protected worker attempt missing");
  const attempts = history.map(value => parseReviewAttempt(value, job.subject));
  let previous: ReviewAttempt | undefined;
  for (const attempt of attempts) {
    // The backend returns attempt DESC,event, not chronological append order across attempts.
    need(attempt.attempt <= job.attempt && (!previous || previous.attempt > attempt.attempt
      || (previous.attempt === attempt.attempt && previous.event < attempt.event)), "Worker history order or uniqueness differs");
    previous = attempt;
  }
  const current = attempts.filter(attempt => attempt.attempt === job.attempt);
  const [claimed, completed] = current;
  need(current.length === 2 && claimed.event === "claimed" && completed.event === "completed", "Current claimed/completed worker pair missing");
  need(claimed.planDigest === job.planDigest && completed.planDigest === job.planDigest
    && claimed.artifactDigest === null && claimed.errorCode === null && completed.errorCode === null
    && completed.artifactDigest === artifact.artifactDigest && completed.workerIdentity === null,
  "Current worker build binding differs");
  need(Date.parse(job.createdAt) <= Date.parse(claimed.createdAt) && Date.parse(claimed.createdAt) <= Date.parse(completed.createdAt)
    && Date.parse(completed.createdAt) <= Date.parse(job.updatedAt), "Current worker event timing differs");
  // Claim stores identity; completion stores the artifact after the backend validates the same lease,
  // attempt, request, plan and worker hash under a row lock. Never borrow an older attempt's worker.
  const worker = claimed.workerIdentity;
  need(worker, "Protected worker provenance missing");
  const { identityDigest, ...identityFields } = worker;
  need(identityDigest === reviewDigest("programmable.modules.worker-identity.v1", identityFields)
    && worker.workflowRef === "programmablehq/programmable-open-hook-v2-internal/.github/workflows/protected-module-review-v1.yml@refs/heads/main",
  "Protected worker provenance differs");
  return worker;
}
/** Production uses only this fixed-origin BFF, never local JSON as reviewer authority. */
export function createAuthenticatedReviewReader(sessionValue: OperatorSession, fetchImpl: typeof fetch = fetch) {
  const session = bindSession(sessionValue);
  return Object.freeze({ async read(submissionId: string): Promise<AuthenticatedReview> {
    need(isReviewId(submissionId), "Invalid submission identifier");
    const request = async (suffix: string, maximum: number) => {
      const url = `${REVIEW_ORIGIN}/api/admin/modules/${submissionId}${suffix}?walletAddress=${session.walletAddress}`;
      try {
        const response = await fetchImpl(url, { method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000),
          headers: { Accept: "application/json", Authorization: `Bearer ${session.accessToken}`, ...(session.identityToken ? { "X-Privy-Identity-Token": session.identityToken } : {}) } });
        return await body(response, maximum);
      } catch { throw new Error("Authenticated module review read failed; refresh the operator session or check the service"); }
    };
    const [detailBytes, sourceBytes] = await Promise.all([request("", 4 * 1024 * 1024), request("/source", 24 * 1024 * 1024)]);
    const detail = reviewRecord(exactJson(detailBytes, 4 * 1024 * 1024));
    need(detail.schemaVersion === "programmable.modules.website-review-detail.v1", "Wrong review detail format");
    const job = parseReviewJob(detail.job); need(job.subject.submissionId === submissionId, "Wrong review subject");
    const { source, artifact } = bindSource(job, sourceBytes);
    need(Array.isArray(detail.decisions) && detail.decisions.length <= 64 && detail.decisions.every(record => validateModuleReviewDecisionRecordV1(record) && nativeCanonicalJson(record.subject) === nativeCanonicalJson(job.subject)), "Review decisions differ from their subject");
    const worker = completedWorker(job, artifact, detail.attempts);
    const closing = reviewRecord(exactJson(await request("", 4 * 1024 * 1024), 4 * 1024 * 1024));
    same(closing.job, detail.job, "Concurrent review revision"); same(closing.decisions, detail.decisions, "Concurrent review decision");
    same(closing.attempts, detail.attempts, "Concurrent worker history");
    const snapshot = nativeJson({ job, artifact, source, decisions: detail.decisions, observedAt: Date.now(), worker });
    const result = Object.freeze({ ...(snapshot as Omit<AuthenticatedReview, "sourceBytes">), sourceBytes: Uint8Array.from(sourceBytes) });
    authenticated.set(result, snapshotDigest(result)); return result;
  } });
}
export function acceptedDecision(value: AuthenticatedReview): ModuleReviewDecisionRecordV1 {
  requireAuthenticatedReview(value);
  const decision = value.decisions.at(-1);
  need(value.job.state === "accepted" && decision?.command.outcome === "accept"
    && decision.command.expectedReviewRevision + 1 === value.job.reviewRevision
    && decision.command.artifactDigest === value.artifact.artifactDigest
    && decision.reviewerWallet !== value.job.subject.author
    && value.artifact.reviewRequired.every(area => decision.command.acknowledgedReviewAreas.includes(area)), "Current accepted review revision required");
  return decision;
}

export function requireNativeReview(value: AuthenticatedReview): asserts value is AuthenticatedReview & {artifact:ReviewBuildArtifact;job:ReviewJob & {plan:ReviewPlan}} {
  requireAuthenticatedReview(value);
  need(value.artifact.schemaVersion === "programmable.modules.native-build.v1" && value.job.plan?.schemaVersion === "programmable.modules.native-build-plan.v1", "Native publication profile required");
}
export function requireEngineReview(value: AuthenticatedReview): asserts value is AuthenticatedReview & {artifact:ModuleEngineBuildArtifactV1;job:ReviewJob & {plan:ModuleEngineBuildPlanV1}} {
  requireAuthenticatedReview(value);
  need(value.artifact.schemaVersion === "programmable.modules.engine-build.v1" && value.job.plan?.schemaVersion === "programmable.modules.engine-build-plan.v1", "Engine publication profile required");
}
