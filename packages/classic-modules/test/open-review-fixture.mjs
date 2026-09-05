import assert from 'node:assert/strict';
import { MODULE_REVIEW_CAPABILITIES_SCHEMA, MODULE_REVIEW_STATUS_SCHEMA } from '../src/open-client.mjs';
import { intakeHandler, json, apiError, submissionReceipt, TEST_KEY, SUBMISSION_ID } from './open-client-fixture.mjs';

// Synthetic local HTTP projections, not a review decision, worker identity or deployment proof.
const hash = (n) => `0x${n.toString(16).padStart(64, '0')}`;
export function reviewCapabilities() {
  return { schemaVersion: MODULE_REVIEW_CAPABILITIES_SCHEMA, reviewAvailable: true, statusReadAvailable: true,
    reviewerPolicyDigest: hash(91), workerSourceCommit: 'a'.repeat(40), workerAuthorityReady: true, databaseReady: true,
    approved: false, available: false };
}
export function reviewStatus(state = 'awaiting_plan') {
  const receipt = submissionReceipt();
  const outcome = { accepted: 'accept', rejected: 'reject', changes_requested: 'request_changes' }[state];
  const built = ['built', 'accepted', 'changes_requested'].includes(state);
  return { schemaVersion: MODULE_REVIEW_STATUS_SCHEMA,
    ...Object.fromEntries(['submissionId', 'packageId', 'familyId', 'requestDigest', 'author', 'rewardWallet', 'version'].map(key => [key, receipt[key]])),
    review: { state, revision: state === 'awaiting_plan' ? 0 : 2, attempt: state === 'awaiting_plan' ? 0 : 1,
      createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T01:00:00.000Z', buildEvidenceRecorded: built,
      artifactDigest: built ? hash(92) : null, lastError: state === 'build_failed' ? 'MODULE_BUILD_FAILED' : null,
      latestDecision: outcome ? { outcome, reason: 'Synthetic local review explanation.', reviewerWallet: '0x' + '77'.repeat(20),
        decidedAt: '2026-09-06T01:00:00.000Z', decisionDigest: hash(93), artifactDigest: outcome === 'accept' ? hash(92) : null,
        hostManifestHash: outcome === 'accept' ? hash(94) : null } : null,
      nextAction: { awaiting_plan: 'await_review_plan', queued: 'await_build', running: 'await_build', built: 'await_reviewer_decision',
        build_failed: 'await_review_plan', changes_requested: 'submit_new_version', rejected: 'review_rejection', accepted: 'await_registry_admission' }[state] },
    sourceBytesVerified: true, sourceRevisionVerified: false, runtimeVerified: false, approved: false, available: false };
}
export function reviewHandler({ caps = reviewCapabilities(), status = () => reviewStatus() } = {}) {
  const intake = intakeHandler();
  return async (request, response) => {
    if (request.method === 'GET' && request.url === '/v1/modules/review-capabilities') {
      assert.equal(request.headers.authorization, undefined); json(response, 200, caps); return;
    }
    if (request.method === 'GET' && request.url === `/v1/modules/submissions/${SUBMISSION_ID}/review`) {
      if (request.headers.authorization !== `Bearer ${TEST_KEY}`) { apiError(response, 401, 'API_KEY_INVALID'); return; }
      json(response, 200, status()); return;
    }
    return intake(request, response);
  };
}
