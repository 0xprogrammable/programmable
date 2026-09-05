import assert from 'node:assert/strict';
import test from 'node:test';
import { createModuleApiClient } from '../src/open-client.mjs';
import { runCli } from '../src/cli.mjs';
import { localServer, json, TEST_KEY, SUBMISSION_ID, OTHER_ID } from './open-client-fixture.mjs';
import { reviewCapabilities, reviewStatus, reviewHandler } from './open-review-fixture.mjs';

test('reads actual HTTP review progress while retaining the historical intake contract', async t => {
  let current = reviewStatus();
  const { apiOrigin, seen } = await localServer(t, reviewHandler({ status: () => current }));
  const client = createModuleApiClient({ apiOrigin, apiKey: TEST_KEY });
  assert.equal((await client.capabilities()).reviewAvailable, false);
  assert.equal((await client.reviewCapabilities()).reviewAvailable, true);
  for (const state of ['awaiting_plan', 'queued', 'running', 'built', 'build_failed', 'changes_requested', 'rejected', 'accepted']) {
    current = reviewStatus(state);
    const result = await client.reviewStatus(SUBMISSION_ID);
    assert.equal(result.review.state, state); assert.equal(result.approved, false); assert.equal(result.available, false); assert.equal(result.runtimeVerified, false);
    assert.equal(result.review.nextAction, current.review.nextAction);
    assert.equal(result.packageId, (await client.status(SUBMISSION_ID)).submission.packageId);
  }
  assert.equal((await client.status(SUBMISSION_ID)).submission.status, 'draft_received');
  assert.ok(seen.every(r => r.method === 'GET'));
  assert.ok(seen.filter(r => r.url.endsWith('capabilities')).every(r => r.headers.authorization === undefined));
  assert.ok(seen.filter(r => r.url.includes('/submissions/')).every(r => r.headers.authorization === `Bearer ${TEST_KEY}`));
});

test('does not disclose credentials to unavailable or contradictory review services', async t => {
  const caps = { ...reviewCapabilities(), reviewAvailable: false, statusReadAvailable: false };
  const { apiOrigin, seen } = await localServer(t, reviewHandler({ caps }));
  const client = createModuleApiClient({ apiOrigin, apiKey: TEST_KEY });
  assert.equal((await client.reviewCapabilities()).statusReadAvailable, false);
  await assert.rejects(client.reviewStatus(SUBMISSION_ID), { code: 'MODULE_REVIEW_UNAVAILABLE' });
  assert.ok(seen.every(r => r.headers.authorization === undefined));
  caps.reviewAvailable = true;
  await assert.rejects(client.reviewCapabilities(), { code: 'MODULE_REVIEW_RESPONSE' });
  caps.statusReadAvailable = true; caps.workerAuthorityReady = false;
  await assert.rejects(client.reviewCapabilities(), { code: 'MODULE_REVIEW_RESPONSE' });
  await assert.rejects(createModuleApiClient({ apiOrigin }).reviewStatus(SUBMISSION_ID), { code: 'MODULE_API_KEY' });
});

test('rejects substituted source identities, unsafe evidence claims and malformed next steps', async t => {
  let current = reviewStatus('accepted');
  const { apiOrigin } = await localServer(t, reviewHandler({ status: () => current }));
  const client = createModuleApiClient({ apiOrigin, apiKey: TEST_KEY });
  const mutations = [
    x => { x.submissionId = OTHER_ID; }, x => { x.packageId = `0x${'a'.repeat(64)}`; },
    x => { x.familyId = `0x${'b'.repeat(64)}`; }, x => { x.requestDigest = `0x${'c'.repeat(64)}`; },
    x => { x.author = `0x${'b'.repeat(40)}`; }, x => { x.rewardWallet = `0x${'c'.repeat(40)}`; },
    x => { x.version = '9.9.9'; }, x => { x.review.state = 'deployed'; },
    x => { x.review.nextAction = 'launch_now'; }, x => { x.approved = true; }, x => { x.available = true; },
    x => { x.runtimeVerified = true; }, x => { x.review.latestDecision = null; },
    x => { x.review.artifactDigest = `0x${'d'.repeat(64)}`; }, x => { x.review.buildEvidenceRecorded = false; },
    x => { x.review.latestDecision.reviewerWallet = x.author; }, x => { x.review.latestDecision.hostManifestHash = null; },
    x => { x.review.latestDecision.reason = 'Bad\u001b[0m reason'; }, x => { x.review.latestDecision.reason = TEST_KEY; },
    x => { x.review.latestDecision.reason = 'é'.repeat(2050); }, x => { x.review.latestDecision.reason = ' tiny '; },
    x => { x.review.revision = 2_147_483_648; }, x => { x.review.attempt = 1001; },
    x => { x.review.updatedAt = '2026-02-31T00:00:00.000Z'; }, x => { x.review.nextUrl = 'https://example.invalid'; },
  ];
  for (const mutate of mutations) {
    current = reviewStatus('accepted'); mutate(current);
    await assert.rejects(client.reviewStatus(SUBMISSION_ID), { code: 'MODULE_REVIEW_RESPONSE' });
  }
});

test('preserves a previous change request when an operator rebuilds the same source revision', async t => {
  const current = reviewStatus('queued'); current.review.latestDecision = reviewStatus('changes_requested').review.latestDecision;
  const { apiOrigin } = await localServer(t, reviewHandler({ status: () => current }));
  const result = await createModuleApiClient({ apiOrigin, apiKey: TEST_KEY }).reviewStatus(SUBMISSION_ID);
  assert.equal(result.review.state, 'queued'); assert.equal(result.review.latestDecision.outcome, 'request_changes');
  assert.equal(result.review.artifactDigest, null);
});

test('preserves versioned private review failure codes without exposing response text or credentials', async t => {
  const route = reviewHandler();
  let problem = { code: 'MODULE_REVIEW_JOB_UNAVAILABLE', message: `Private operator detail ${TEST_KEY}` };
  const { apiOrigin, seen } = await localServer(t, (request, response) => {
    if (request.url === `/v1/modules/submissions/${SUBMISSION_ID}/review`) {
      json(response, 503, { schemaVersion: 'programmable.modules.review-status.v1', error: problem });
      return;
    }
    return route(request, response);
  });
  const client = createModuleApiClient({ apiOrigin, apiKey: TEST_KEY });
  await assert.rejects(client.reviewStatus(SUBMISSION_ID), error => {
    assert.equal(error.code, 'MODULE_REVIEW_JOB_UNAVAILABLE');
    assert.equal(error.httpStatus, 503);
    assert.equal(error.submissionMayExist, undefined);
    assert.ok(!error.message.includes(TEST_KEY));
    assert.ok(!error.message.includes('Private operator detail'));
    return true;
  });
  problem = { code: TEST_KEY, message: 'Unsafe response code.' };
  await assert.rejects(client.reviewStatus(SUBMISSION_ID), { code: 'MODULE_API_HTTP', httpStatus: 503 });
  assert.ok(seen.every(request => request.method === 'GET'));
  assert.equal(seen.filter(request => request.url.endsWith('/review')).length, 2);
});

test('bounds and rejects review capability redirects before private reads', async t => {
  const { apiOrigin, seen } = await localServer(t, (_request, response) => {
    response.writeHead(302, { Location: 'https://example.invalid/review' }); response.end();
  });
  await assert.rejects(createModuleApiClient({ apiOrigin, apiKey: TEST_KEY }).reviewStatus(SUBMISSION_ID), { code: 'MODULE_API_NETWORK' });
  assert.equal(seen.length, 1); assert.equal(seen[0].headers.authorization, undefined);
  const oversized = await localServer(t, (_request, response) => json(response, 200, { ...reviewCapabilities(), unexpected: 'x'.repeat(1_048_576) }));
  await assert.rejects(createModuleApiClient({ apiOrigin: oversized.apiOrigin }).reviewCapabilities(), { code: 'MODULE_API_RESPONSE_LIMIT' });
});

test('CLI reads owner review progress and emits the exact next action without executing or approving source', async t => {
  const { apiOrigin, seen } = await localServer(t, reviewHandler({ status: () => reviewStatus('changes_requested') }));
  let stdout = '', stderr = '';
  const io = { stdout: { write: value => { stdout += value; } }, stderr: { write: value => { stderr += value; } }, env: { PROGRAMMABLE_MODULES_API_KEY: TEST_KEY } };
  assert.equal(await runCli(['review-capabilities', '--api-origin', apiOrigin], io), 0);
  assert.equal(JSON.parse(stdout).statusReadAvailable, true); stdout = '';
  assert.equal(await runCli(['review-status-module', '--api-origin', apiOrigin, '--id', SUBMISSION_ID], io), 0);
  const result = JSON.parse(stdout); assert.equal(result.ok, true); assert.equal(result.review.nextAction, 'submit_new_version');
  assert.equal(result.approved, false); assert.equal(result.available, false); assert.ok(!stdout.includes(TEST_KEY)); assert.equal(stderr, '');
  assert.ok(seen.every(r => r.method === 'GET'));
});
