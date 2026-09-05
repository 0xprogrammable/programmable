import { Buffer } from 'node:buffer';

export const MODULE_REVIEW_CAPABILITIES_SCHEMA = 'programmable.modules.review-capabilities.v1';
export const MODULE_REVIEW_STATUS_SCHEMA = 'programmable.modules.review-status.v1';
export const MODULE_REVIEW_NEXT_ACTION = Object.freeze({
  awaiting_plan: 'await_review_plan', queued: 'await_build', running: 'await_build',
  built: 'await_reviewer_decision', build_failed: 'await_review_plan',
  changes_requested: 'submit_new_version', rejected: 'review_rejection', accepted: 'await_registry_admission',
});
const hash = /^0x(?!0{64}$)[0-9a-f]{64}$/;
const address = /^0x(?!0{40}$)[0-9a-f]{40}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const digest = (x) => typeof x === 'string' && hash.test(x);
const nullableDigest = (x) => x === null || digest(x);
const integer = (x, maximum) => Number.isSafeInteger(x) && x >= 0 && x <= maximum;
function need(value) { if (!value) throw new Error('Unsupported or inconsistent module review response'); }
function record(x, keys) {
  need(x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === keys.length
    && keys.every(key => Object.hasOwn(x, key)));
}
function time(x) {
  return typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x)
    && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x;
}

/** Public operational readiness only. A ready review service grants neither admission nor deployment authority. */
export function bindModuleReviewCapabilities(x) {
  record(x, ['schemaVersion', 'reviewAvailable', 'statusReadAvailable', 'reviewerPolicyDigest', 'workerSourceCommit',
    'workerAuthorityReady', 'databaseReady', 'approved', 'available']);
  need(x.schemaVersion === MODULE_REVIEW_CAPABILITIES_SCHEMA
    && ['reviewAvailable', 'statusReadAvailable', 'workerAuthorityReady', 'databaseReady'].every(key => typeof x[key] === 'boolean')
    && nullableDigest(x.reviewerPolicyDigest)
    && (x.workerSourceCommit === null || typeof x.workerSourceCommit === 'string' && /^(?!0{40}$)[0-9a-f]{40}$/.test(x.workerSourceCommit))
    && x.approved === false && x.available === false && x.reviewAvailable === x.statusReadAvailable);
  if (x.workerAuthorityReady) need(x.workerSourceCommit !== null);
  if (x.reviewAvailable) need(x.workerAuthorityReady && x.databaseReady && x.reviewerPolicyDigest !== null);
  return { ...x };
}

/** Validates an owner-only projection and binds it to the exact historical source receipt. Hashes remain server-recorded evidence references. */
export function bindModuleReviewStatus(x, receipt) {
  record(x, ['schemaVersion', 'submissionId', 'packageId', 'familyId', 'requestDigest', 'author', 'rewardWallet', 'version', 'review',
    'sourceBytesVerified', 'sourceRevisionVerified', 'runtimeVerified', 'approved', 'available']);
  need(x.schemaVersion === MODULE_REVIEW_STATUS_SCHEMA && typeof x.submissionId === 'string' && uuid.test(x.submissionId)
    && ['packageId', 'familyId', 'requestDigest'].every(key => digest(x[key]))
    && ['author', 'rewardWallet'].every(key => typeof x[key] === 'string' && address.test(x[key]))
    && typeof x.version === 'string' && /^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}(?:-[a-z0-9.-]{1,40})?$/.test(x.version)
    && x.sourceBytesVerified === true && ['sourceRevisionVerified', 'runtimeVerified', 'approved', 'available'].every(key => x[key] === false));
  need(['submissionId', 'packageId', 'familyId', 'requestDigest', 'author', 'rewardWallet', 'version'].every(key => x[key] === receipt[key]));
  const r = x.review;
  record(r, ['state', 'revision', 'attempt', 'createdAt', 'updatedAt', 'buildEvidenceRecorded', 'artifactDigest', 'lastError', 'latestDecision', 'nextAction']);
  need(typeof r.state === 'string' && Object.hasOwn(MODULE_REVIEW_NEXT_ACTION, r.state) && r.nextAction === MODULE_REVIEW_NEXT_ACTION[r.state]
    && integer(r.revision, 2_147_483_647) && integer(r.attempt, 1000) && time(r.createdAt) && time(r.updatedAt) && r.createdAt <= r.updatedAt
    && typeof r.buildEvidenceRecorded === 'boolean' && nullableDigest(r.artifactDigest) && r.buildEvidenceRecorded === (r.artifactDigest !== null)
    && (r.lastError === null || typeof r.lastError === 'string' && /^MODULE_[A-Z0-9_]{1,100}$/.test(r.lastError)));
  if (['built', 'accepted'].includes(r.state)) need(r.buildEvidenceRecorded);
  if (['awaiting_plan', 'queued', 'running', 'build_failed'].includes(r.state)) need(!r.buildEvidenceRecorded);
  if (r.latestDecision !== null) {
    const d = r.latestDecision;
    record(d, ['outcome', 'reason', 'reviewerWallet', 'decidedAt', 'decisionDigest', 'artifactDigest', 'hostManifestHash']);
    need(['accept', 'request_changes', 'reject'].includes(d.outcome) && typeof d.reason === 'string' && d.reason.trim() === d.reason
      && d.reason.length >= 10 && Buffer.byteLength(d.reason) <= 4096 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(d.reason)
      && typeof d.reviewerWallet === 'string' && address.test(d.reviewerWallet) && d.reviewerWallet !== x.author
      && time(d.decidedAt) && d.decidedAt <= r.updatedAt && digest(d.decisionDigest)
      && nullableDigest(d.artifactDigest) && nullableDigest(d.hostManifestHash));
    if (d.outcome === 'accept') need(d.artifactDigest !== null && d.hostManifestHash !== null);
    else need(d.artifactDigest === null && d.hostManifestHash === null);
  }
  if (r.state === 'accepted') need(r.latestDecision?.outcome === 'accept' && r.latestDecision.artifactDigest === r.artifactDigest);
  if (r.state === 'changes_requested') need(r.latestDecision?.outcome === 'request_changes');
  if (r.state === 'rejected') need(r.latestDecision?.outcome === 'reject');
  return { ...x, review: { ...r, latestDecision: r.latestDecision === null ? null : { ...r.latestDecision } } };
}
