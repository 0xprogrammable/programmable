import { isReviewDigest, parseReviewSourceCorrection, reviewDigest, reviewRecord, type ReviewDetail, type ReviewSourceCorrection } from "../../module-mode/review-contract";

export const MODULE_SOURCE_CORRECTION_LIMIT = 262_144;
export interface ModuleSourceCorrectionCommand {
  schemaVersion: "programmable.modules.source-correction.v1";
  expectedReviewRevision: number;
  requestDigest: `0x${string}`;
  version: string;
  reason: string;
  idempotencyKey: string;
  files: { path: string; expectedSha256: string | null; sha256: string; edits: { offset: number; deleteBytes: number; insertBase64: string }[] }[];
}
export interface ModuleSourceCorrectionReceipt {
  schemaVersion: "programmable.modules.source-correction-receipt.v1";
  created: boolean;
  sourceCorrection: ReviewSourceCorrection;
  reviewStatus: "awaiting_plan";
  approved: false;
  available: false;
}
const HASH = /^[0-9a-f]{64}$/u;
function need(value: unknown): asserts value { if (!value) throw new Error("Module source correction is invalid."); }
function integer(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0 && !Object.is(value, -0); }
export function isModuleCorrectionIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{16,128}$/u.test(value);
}
export function parseModuleSourceCorrectionCommand(value: unknown): ModuleSourceCorrectionCommand {
  const r = reviewRecord(value, ["schemaVersion", "expectedReviewRevision", "requestDigest", "version", "reason", "idempotencyKey", "files"]);
  need(Buffer.byteLength(JSON.stringify(r)) <= MODULE_SOURCE_CORRECTION_LIMIT);
  need(r.schemaVersion === "programmable.modules.source-correction.v1" && integer(r.expectedReviewRevision) && isReviewDigest(r.requestDigest));
  need(typeof r.version === "string" && /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-pm\.[1-9][0-9]*$/u.test(r.version) && r.version.length <= 128);
  need(typeof r.reason === "string" && r.reason.trim() === r.reason && !r.reason.includes("\0") && Buffer.byteLength(r.reason) >= 10 && Buffer.byteLength(r.reason) <= 4096);
  need(isModuleCorrectionIdempotencyKey(r.idempotencyKey));
  need(Array.isArray(r.files) && r.files.length > 0 && r.files.length <= 16);
  const paths = new Set<string>();
  let totalEdits = 0; let insertedBytes = 0;
  for (const raw of r.files) {
    const f = reviewRecord(raw, ["path", "expectedSha256", "sha256", "edits"]);
    need(typeof f.path === "string" && f.path.length > 0 && Buffer.byteLength(f.path) <= 1024 && !f.path.startsWith("/") && !/[\\\u0000]/u.test(f.path)
      && f.path.split("/").every(part => part !== "" && part !== "." && part !== "..") && !paths.has(f.path));
    paths.add(f.path);
    need((f.expectedSha256 === null || (typeof f.expectedSha256 === "string" && HASH.test(f.expectedSha256))) && typeof f.sha256 === "string" && HASH.test(f.sha256) && f.sha256 !== f.expectedSha256);
    need(Array.isArray(f.edits) && f.edits.length > 0 && f.edits.length <= 64);
    totalEdits += f.edits.length; need(totalEdits <= 256);
    let previousEnd = -1; let previousOffset = -1;
    for (const rawEdit of f.edits) {
      const edit = reviewRecord(rawEdit, ["offset", "deleteBytes", "insertBase64"]);
      need(integer(edit.offset) && integer(edit.deleteBytes) && edit.offset >= previousEnd && edit.offset > previousOffset
        && edit.offset + edit.deleteBytes <= 4 * 1024 * 1024 && typeof edit.insertBase64 === "string");
      need(edit.insertBase64.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/u.test(edit.insertBase64)
        && Buffer.from(edit.insertBase64, "base64").toString("base64") === edit.insertBase64);
      insertedBytes += Buffer.from(edit.insertBase64, "base64").byteLength; need(insertedBytes <= 128 * 1024);
      need(edit.deleteBytes > 0 || edit.insertBase64.length > 0);
      previousEnd = edit.offset + edit.deleteBytes;
      previousOffset = edit.offset;
      need(Number.isSafeInteger(previousEnd));
    }
    if (f.expectedSha256 === null) {
      const insertion = reviewRecord(f.edits[0]);
      need(f.edits.length === 1 && insertion.offset === 0 && insertion.deleteBytes === 0);
    }
  }
  return r as unknown as ModuleSourceCorrectionCommand;
}

export function parseModuleSourceCorrectionReceipt(value: unknown): ModuleSourceCorrectionReceipt {
  const r = reviewRecord(value, ["schemaVersion", "created", "sourceCorrection", "reviewStatus", "approved", "available"]);
  need(r.schemaVersion === "programmable.modules.source-correction-receipt.v1" && typeof r.created === "boolean"
    && r.reviewStatus === "awaiting_plan" && r.approved === false && r.available === false);
  parseReviewSourceCorrection(r.sourceCorrection);
  return r as unknown as ModuleSourceCorrectionReceipt;
}
export function bindModuleSourceCorrectionReceipt(receipt: ModuleSourceCorrectionReceipt, parent: ReviewDetail, wallet: string, command?: ModuleSourceCorrectionCommand): void {
  const record = receipt.sourceCorrection;
  need(record.parentSubmissionId === parent.job.subject.submissionId && record.principalId === parent.job.subject.principalId
    && record.author === parent.job.subject.author && record.rewardWallet === parent.source.descriptor.rewardWallet.toLowerCase()
    && record.familyId === parent.source.familyId && record.baseRequestDigest === parent.job.subject.requestDigest
    && record.correctedBy === wallet && record.requestDigest !== parent.job.subject.requestDigest && record.packageId !== parent.source.packageId
    && (command === undefined || (record.version === command.version && record.reason === command.reason
      && record.commandDigest === reviewDigest("programmable.modules.source-correction-command.v1", command))));
}
