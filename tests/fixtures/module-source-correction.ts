import { createHash } from "node:crypto";
import { reviewDigest, type ReviewSourceCorrection } from "../../lib/module-mode/review-contract";
import type { ModuleSourceCorrectionCommand, ModuleSourceCorrectionReceipt } from "../../lib/server/module-mode/review-source-correction";
import { validateModuleSubmissionRequest } from "../../packages/classic-modules/src/open-transport.mjs";
import { moduleReviewAdminFixture } from "./module-review-admin";

// Synthetic API data only. None of these sources is built, accepted or sent to a real service.
export function moduleSourceCorrectionFixture() {
  const f = moduleReviewAdminFixture();
  const file = f.source.files[0];
  const inserted = Buffer.from("// Synthetic correction fixture only.\n");
  const patched = Buffer.concat([inserted, Buffer.from(file.bytes, "base64")]);
  const sha256 = createHash("sha256").update(patched).digest("hex");
  const command: ModuleSourceCorrectionCommand = { schemaVersion: "programmable.modules.source-correction.v1", expectedReviewRevision: f.job.reviewRevision,
    requestDigest: f.subject.requestDigest, version: "0.1.1-pm.1", reason: "Synthetic operator correction test only, never publish.", idempotencyKey: "synthetic:correction_v1.20260910",
    files: [{ path: file.path, expectedSha256: file.sha256, sha256, edits: [{ offset: 0, deleteBytes: 0, insertBase64: inserted.toString("base64") }] }] };
  const corrected = structuredClone(f.source);
  corrected.descriptor.version = command.version;
  corrected.descriptor.source = { files: corrected.descriptor.source.files.map(pin => pin.path === file.path ? { path: pin.path, sha256 } : pin) };
  corrected.files = corrected.files.map(item => item.path === file.path ? { ...item, sha256, bytes: patched.toString("base64") } : item);
  corrected.supersedesSubmissionId = f.subject.submissionId;
  const checked = validateModuleSubmissionRequest(corrected); if (!checked.ok) throw new Error("Invalid correction fixture");
  const contents: Omit<ReviewSourceCorrection, "correctionDigest"> = { schemaVersion: "programmable.modules.source-correction-record.v1",
    parentSubmissionId: f.subject.submissionId, submissionId: "00000000-0000-4000-8000-000000000009", principalId: f.subject.principalId,
    author: f.subject.author, rewardWallet: f.source.descriptor.rewardWallet.toLowerCase(), familyId: checked.familyId, baseRequestDigest: f.subject.requestDigest,
    requestDigest: checked.requestDigest, packageId: checked.packageId, version: command.version, correctedBy: f.reviewer, policyDigest: f.policyDigest,
    commandDigest: reviewDigest("programmable.modules.source-correction-command.v1", command), reason: command.reason, createdAt: f.job.updatedAt };
  const record: ReviewSourceCorrection = { ...contents, correctionDigest: reviewDigest("programmable.modules.source-correction-record.v1", contents) };
  const receipt: ModuleSourceCorrectionReceipt = { schemaVersion: "programmable.modules.source-correction-receipt.v1", created: true, sourceCorrection: record,
    approved: false, available: false, reviewStatus: "awaiting_plan" };
  const originalDetail = { schemaVersion: "programmable.modules.review-detail.v1", job: f.job, decisions: [], attempts: f.detail.attempts, sourceCorrection: null };
  const correctedDetail = { schemaVersion: "programmable.modules.review-detail.v1", job: { ...f.job,
    subject: { ...f.subject, submissionId: record.submissionId, requestDigest: record.requestDigest }, state: "awaiting_plan", reviewRevision: 0,
    plan: null, planDigest: null, artifact: null, attempt: 0, lastError: null }, decisions: [], attempts: [], sourceCorrection: record };
  const websiteDetail = { ...originalDetail, schemaVersion: "programmable.modules.website-review-detail.v1", source: f.detail.source };
  const correctedWebsiteDetail = { ...correctedDetail, schemaVersion: "programmable.modules.website-review-detail.v1", source: {
    descriptor: checked.request.descriptor, packageId: checked.packageId, familyId: checked.familyId,
    files: checked.request.files.map(item => ({ path: item.path, sha256: item.sha256, bytes: Buffer.from(item.bytes, "base64").byteLength })) } };
  return { ...f, command, corrected: checked.request, record, receipt, originalDetail, correctedDetail, websiteDetail, correctedWebsiteDetail };
}
