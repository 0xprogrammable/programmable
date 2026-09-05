import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { moduleAddress } from "../../lib/module-mode/release";
import { nativeCanonicalJson, nativeJson } from "../../lib/module-mode/native-catalog";
import { isReviewId, parseReviewAttempt, parseReviewJob, reviewDigest, reviewRecord, type ReviewBuildArtifact, type ReviewJob } from "../../lib/module-mode/review-contract";
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
  job: ReviewJob; artifact: ReviewBuildArtifact; source: ModuleSubmissionRequest; sourceBytes: Uint8Array;
  decisions: ModuleReviewDecisionRecordV1[]; observedAt: number; worker: unknown;
}
const authenticated = new WeakMap<object, string>();
function snapshotDigest(value: AuthenticatedReview) {
  return reviewDigest("programmable.modules.authenticated-publication-read.v1", { ...value, sourceBytes: Buffer.from(value.sourceBytes).toString("base64") });
}
export function requireAuthenticatedReview(value: AuthenticatedReview): void {
  need(authenticated.get(value) === snapshotDigest(value) && Date.now() - value.observedAt >= 0 && Date.now() - value.observedAt <= 300_000, "Fresh authenticated review read required");
}
function bindSource(job: ReviewJob, sourceBytes: Uint8Array): { source: ModuleSubmissionRequest; artifact: ReviewBuildArtifact } {
  const checked = validateModuleSubmissionRequest(exactJson(sourceBytes));
  need(checked.ok, "Invalid immutable submission");
  const source = checked.request, artifact = job.artifact;
  need(artifact && job.plan && ["built", "accepted"].includes(job.state), "Completed protected native build required");
  need(checked.requestDigest === job.subject.requestDigest && source.descriptor.author.toLowerCase() === job.subject.author, "Source does not bind the authenticated author");
  need(artifact.packageId === checked.packageId && artifact.familyId === checked.familyId && artifact.rewardWallet === source.descriptor.rewardWallet.toLowerCase(), "Build package identity differs");
  need(artifact.sourceManifestHash === reviewDigest("programmable.modules.source-manifest.v1", source.descriptor)
    && artifact.configurationSchemaHash === reviewDigest("programmable.modules.configuration-schema.v1", source.descriptor.configuration), "Build source manifest differs");
  const sources: Record<string, { content: string }> = Object.create(null);
  for (const file of source.files) if (file.path.endsWith(".sol")) sources[file.path] = { content: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(file.bytes, "base64")) };
  same(artifact.compiler, { ...NATIVE_COMPILER,
    settingsHash: reviewDigest("programmable.modules.compiler-settings.v1", NATIVE_SETTINGS),
    completeInputHash: reviewDigest("programmable.modules.compiler-input.v1", { language: "Solidity", sources, settings: NATIVE_SETTINGS }), reproducible: true }, "Pinned compiler/input");
  for (const role of ["factory", "program"] as const) {
    const compiled = artifact[role];
    const component = source.descriptor.components.find(component => component.id === job.plan![`${role}ComponentId`]);
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
    need(Array.isArray(detail.attempts) && detail.attempts.length <= 24, "Review worker attempts missing");
    const completed = detail.attempts.map(value => parseReviewAttempt(value, job.subject)).filter(attempt => attempt.event === "completed" && attempt.artifactDigest === artifact.artifactDigest && attempt.planDigest === job.planDigest).at(-1);
    need(completed?.workerIdentity && completed.errorCode === null && completed.workerIdentity.workflowRef === "programmablehq/programmable-open-hook-v2-internal/.github/workflows/protected-module-review-v1.yml@refs/heads/main", "Protected worker provenance missing");
    const closing = reviewRecord(exactJson(await request("", 4 * 1024 * 1024), 4 * 1024 * 1024));
    same(closing.job, detail.job, "Concurrent review revision"); same(closing.decisions, detail.decisions, "Concurrent review decision");
    const snapshot = nativeJson({ job, artifact, source, decisions: detail.decisions, observedAt: Date.now(), worker: completed.workerIdentity });
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
