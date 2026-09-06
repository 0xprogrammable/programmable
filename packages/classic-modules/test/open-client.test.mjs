import test from 'node:test';
import assert from 'node:assert/strict';
import { createModuleApiClient, validateModuleApiOrigin, ModuleApiError, MODULE_API_CLIENT_LIMITS, MODULE_API_SCHEMA } from '../src/open-client.mjs';
import { validateModuleSubmissionRequest } from '../src/open-transport.mjs';
import { TEST_KEY, IDEMPOTENCY_KEY, SUBMISSION_ID, OTHER_ID, THIRD_ID, sourceRequest, apiCapabilities,
  submissionReceipt, json, apiError, requestBody, localServer, intakeHandler } from './open-client-fixture.mjs';

test('API origins reject credentials, nonlocal HTTP, paths and URL-normalization escapes', () => {
  for (const origin of [undefined, '', 'http://api.example', 'https://user:password@api.example', 'https://@api.example',
    'https://api.example/v1', 'https://api.example/..', 'https://api.example/?', 'https://api.example/#',
    'https://api.example?token=value', 'https://api.example#value', ' https://api.example', 'https://api.\nexample',
    'https://api.example\\@other.example', 'ftp://localhost', 'http://localhost.evil.example', 'http://192.168.1.2']) {
    assert.throws(() => validateModuleApiOrigin(origin), { code: 'MODULE_API_ORIGIN' });
  }
  assert.equal(validateModuleApiOrigin('https://api.example/'), 'https://api.example');
  assert.equal(validateModuleApiOrigin('https://api.example:443'), 'https://api.example');
  assert.equal(validateModuleApiOrigin('http://localhost:8181'), 'http://localhost:8181');
  assert.equal(validateModuleApiOrigin('http://127.0.0.1:8181'), 'http://127.0.0.1:8181');
  assert.equal(validateModuleApiOrigin('http://[::1]:8181'), 'http://[::1]:8181');
});

test('real HTTP submission pins identity, keeps scopes on one origin, and replays the same immutable draft', async (t) => {
  const { apiOrigin, seen } = await localServer(t, intakeHandler());
  const client = createModuleApiClient({ apiOrigin, apiKey: TEST_KEY });
  const request = sourceRequest(); request.descriptor.rewardWallet = `0x${'2'.repeat(40)}`;
  const first = await client.submit(request, { idempotencyKey: IDEMPOTENCY_KEY });
  const replay = await client.submit({ ...request, files: [...request.files].reverse() }, { idempotencyKey: IDEMPOTENCY_KEY });
  assert.equal(first.idempotent, false); assert.equal(replay.idempotent, true);
  assert.deepEqual(first.submission, replay.submission);
  assert.equal(first.submission.requestDigest, validateModuleSubmissionRequest(request).requestDigest);
  assert.equal(first.submission.rewardWallet, request.descriptor.rewardWallet);
  assert.equal(first.submission.status, 'draft_received'); assert.equal(first.submission.reviewStatus, 'unreviewed');
  for (const flag of ['sourceRevisionVerified', 'buildVerified', 'runtimeVerified', 'approved', 'available']) assert.equal(first.submission[flag], false);
  assert.equal(seen.length, 4);
  for (const sent of seen) {
    assert.equal(sent.headers.authorization, sent.method === 'POST' ? `Bearer ${TEST_KEY}` : undefined);
    assert.equal(sent.headers.cookie, undefined);
    assert.equal(sent.headers['idempotency-key'], sent.method === 'POST' ? IDEMPOTENCY_KEY : undefined);
  }
  const changed = structuredClone(request); changed.descriptor.name = 'Changed package';
  await assert.rejects(client.submit(changed, { idempotencyKey: IDEMPOTENCY_KEY }), { code: 'MODULE_IDEMPOTENCY_CONFLICT', httpStatus: 409 });
});

test('disabled or incompatible capabilities and deployment limits prevent any credentialed upload', async (t) => {
  const changes = [
    (c) => { c.moduleContributions.submissions = false; }, (c) => { c.submissionFormat = 'unknown'; },
    (c) => { c.schemaVersion = 'unknown'; }, (c) => { delete c.limits; }, (c) => { c.limits.sourceBytes = 1; },
    (c) => { c.limits.sourceFileBytes = 1; }, (c) => { c.limits.httpBytes = 1; }, (c) => { c.limits.sourceFiles = 1; },
  ];
  for (const change of changes) {
    const caps = apiCapabilities(); change(caps);
    const { apiOrigin, seen } = await localServer(t, intakeHandler({ capabilities: caps }));
    await assert.rejects(createModuleApiClient({ apiOrigin, apiKey: TEST_KEY }).submit(sourceRequest(), { idempotencyKey: IDEMPOTENCY_KEY }));
    assert.equal(seen.length, 1); assert.equal(seen[0].url, '/v1/modules/capabilities'); assert.equal(seen[0].headers.authorization, undefined);
  }
  const caps = apiCapabilities(); caps.moduleContributions.apiKeyIssuance = false;
  const { apiOrigin } = await localServer(t, intakeHandler({ capabilities: caps }));
  assert.equal((await createModuleApiClient({ apiOrigin, apiKey: TEST_KEY }).submit(sourceRequest(), { idempotencyKey: IDEMPOTENCY_KEY })).idempotent, false);
});

test('invalid local source, IDs, credentials and idempotency keys fail without a network request', async (t) => {
  const { apiOrigin, seen } = await localServer(t, intakeHandler());
  const client = createModuleApiClient({ apiOrigin, apiKey: TEST_KEY });
  for (const key of ['', 'short', 'x'.repeat(129), 'contains space........', 'a'.repeat(16) + '\r\nInjected: yes']) {
    await assert.rejects(client.submit(sourceRequest(), { idempotencyKey: key }), { code: 'MODULE_IDEMPOTENCY_KEY' });
  }
  const changed = sourceRequest(); changed.files[0].bytes = Buffer.from('unmatched source').toString('base64');
  await assert.rejects(client.submit(changed, { idempotencyKey: IDEMPOTENCY_KEY }), { code: 'MODULE_FILE_HASH' });
  for (const field of ['author', 'rewardWallet']) {
    const invalid = sourceRequest(); invalid.descriptor[field] = `0x${'0'.repeat(40)}`;
    await assert.rejects(client.submit(invalid, { idempotencyKey: IDEMPOTENCY_KEY }), { code: 'OPEN_ADDRESS' });
  }
  await assert.rejects(client.status('../private'), { code: 'MODULE_SUBMISSION_ID' });
  await assert.rejects(client.list({ cursor: 'bad?limit=100' }), { code: 'MODULE_SUBMISSION_ID' });
  await assert.rejects(createModuleApiClient({ apiOrigin }).status(SUBMISSION_ID), { code: 'MODULE_API_KEY' });
  for (const key of ['', ' leading-whitespace', 'header\ninjection', 'quote"value', 'back\\slash', 'x'.repeat(4097)]) assert.throws(() => createModuleApiClient({ apiOrigin, apiKey: key }), { code: 'MODULE_API_KEY' });
  for (const timeoutMs of [0, -1, 1.5, 120001, Infinity]) assert.throws(() => createModuleApiClient({ apiOrigin, timeoutMs }), { code: 'MODULE_API_TIMEOUT_CONFIG' });
  assert.equal(seen.length, 0);
});

test('receipt cannot substitute immutable request identity or promote intake into approval', async (t) => {
  const changes = [
    (s) => { s.requestDigest = `0x${'f'.repeat(64)}`; }, (s) => { s.packageId = `0x${'f'.repeat(64)}`; },
    (s) => { s.familyId = `0x${'f'.repeat(64)}`; }, (s) => { s.author = `0x${'f'.repeat(40)}`; },
    (s) => { s.rewardWallet = `0x${'f'.repeat(40)}`; }, (s) => { s.name = 'Different module'; }, (s) => { s.version = '1.0.0'; },
    (s) => { s.totalSourceBytes += 1; }, (s) => { s.supersedesSubmissionId = OTHER_ID; }, (s) => { s.approved = true; },
    (s) => { s.runtimeVerified = true; }, (s) => { s.status = 'approved'; }, (s) => { s.sourceBytesVerified = false; },
  ];
  for (const change of changes) {
    const { apiOrigin } = await localServer(t, intakeHandler({ mutateReceipt: (value) => { const s = structuredClone(value); change(s); return s; } }));
    await assert.rejects(createModuleApiClient({ apiOrigin, apiKey: TEST_KEY }).submit(sourceRequest(), { idempotencyKey: IDEMPOTENCY_KEY }),
      (error) => error instanceof ModuleApiError && error.submissionMayExist === true);
  }
});

test('status and bounded cursor pagination preserve identity and strip unknown response fields', async (t) => {
  const { apiOrigin, seen } = await localServer(t, (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${TEST_KEY}`);
    if (request.url === `/v1/modules/submissions/${SUBMISSION_ID}`) {
      json(response, 200, { schemaVersion: MODULE_API_SCHEMA, debug: TEST_KEY, submission: { ...submissionReceipt(), secret: TEST_KEY } });
    } else if (request.url === '/v1/modules/submissions') {
      json(response, 200, { schemaVersion: MODULE_API_SCHEMA, submissions: [submissionReceipt(), submissionReceipt(sourceRequest(), OTHER_ID)], nextCursor: OTHER_ID });
    } else {
      assert.equal(request.url, `/v1/modules/submissions?cursor=${OTHER_ID}`);
      json(response, 200, { schemaVersion: MODULE_API_SCHEMA, submissions: [submissionReceipt(sourceRequest(), THIRD_ID)], nextCursor: null });
    }
  });
  const client = createModuleApiClient({ apiOrigin, apiKey: TEST_KEY });
  assert.equal((await client.status(SUBMISSION_ID.toUpperCase())).submission.submissionId, SUBMISSION_ID);
  const first = await client.list(); const last = await client.list({ cursor: first.nextCursor });
  assert.equal(first.submissions.length, 2); assert.equal(last.submissions.length, 1); assert.equal(last.nextCursor, null);
  assert.equal(seen.length, 3); assert.ok(!JSON.stringify(first).includes(TEST_KEY));
});

test('pagination rejects duplicates, oversized pages, nonadvancing cursors and mismatched status IDs', async (t) => {
  const replies = [
    { submissions: [submissionReceipt(), submissionReceipt()], nextCursor: null },
    { submissions: Array.from({ length: 21 }, () => submissionReceipt()), nextCursor: null },
    { submissions: [], nextCursor: OTHER_ID },
    { submissions: [submissionReceipt()], nextCursor: OTHER_ID },
    { submissions: [submissionReceipt(sourceRequest(), OTHER_ID)], nextCursor: OTHER_ID },
  ];
  for (const body of replies) {
    const { apiOrigin } = await localServer(t, (_request, response) => json(response, 200, { schemaVersion: MODULE_API_SCHEMA, ...body }));
    await assert.rejects(createModuleApiClient({ apiOrigin, apiKey: TEST_KEY }).list({ cursor: OTHER_ID }), { code: 'MODULE_API_RESPONSE' });
  }
  const { apiOrigin } = await localServer(t, (_request, response) => json(response, 200, { schemaVersion: MODULE_API_SCHEMA, submission: submissionReceipt(sourceRequest(), OTHER_ID) }));
  await assert.rejects(createModuleApiClient({ apiOrigin, apiKey: TEST_KEY }).status(SUBMISSION_ID), { code: 'MODULE_API_RECEIPT_MISMATCH' });
});

test('authentication, author mismatch, conflict and rate-limit errors are useful without echoing server secrets', async (t) => {
  for (const [status, code] of [[401, 'API_KEY_INVALID'], [403, 'MODULE_AUTHOR_MISMATCH'], [409, 'MODULE_IDEMPOTENCY_CONFLICT'], [429, 'MODULE_RATE_LIMITED'], [503, 'MODULE_SUBMISSIONS_UNAVAILABLE']]) {
    const { apiOrigin } = await localServer(t, (request, response) => {
      if (request.url.endsWith('/capabilities')) json(response, 200, apiCapabilities());
      else apiError(response, status, code, { path: '/descriptor/author', message: `Do not log ${TEST_KEY}`, debug: TEST_KEY }, { 'Retry-After': '60' });
    });
    await assert.rejects(createModuleApiClient({ apiOrigin, apiKey: TEST_KEY }).submit(sourceRequest(), { idempotencyKey: IDEMPOTENCY_KEY }), (error) => {
      assert.equal(error.code, code); assert.equal(error.httpStatus, status); assert.equal(error.path, '/descriptor/author');
      assert.equal(error.retryAfterSeconds, 60); assert.ok(!JSON.stringify(error).includes(TEST_KEY)); assert.ok(!error.message.includes(TEST_KEY));
      return true;
    });
  }
  const reflectedKey = 'SHOULD_NEVER_BE_A_PUBLIC_ERROR_CODE';
  const { apiOrigin } = await localServer(t, (_request, response) => apiError(response, 401, reflectedKey, { path: `/secret/${reflectedKey}` }));
  await assert.rejects(createModuleApiClient({ apiOrigin, apiKey: reflectedKey }).status(SUBMISSION_ID), (error) => {
    assert.equal(error.code, 'MODULE_API_HTTP'); assert.equal(error.path, undefined); assert.ok(!JSON.stringify(error).includes(reflectedKey)); return true;
  });
});

test('redirects are never followed for either capabilities or authenticated requests', async (t) => {
  const destination = await localServer(t, (_request, response) => json(response, 200, {}));
  for (const redirectAt of ['capabilities', 'submission']) {
    const { apiOrigin, seen } = await localServer(t, (request, response) => {
      if (redirectAt === 'submission' && request.url.endsWith('/capabilities')) json(response, 200, apiCapabilities());
      else { response.writeHead(307, { Location: `${destination.apiOrigin}/receive` }); response.end(); }
    });
    await assert.rejects(createModuleApiClient({ apiOrigin, apiKey: TEST_KEY }).submit(sourceRequest(), { idempotencyKey: IDEMPOTENCY_KEY }), { code: 'MODULE_API_NETWORK' });
    assert.equal(seen.length, redirectAt === 'capabilities' ? 1 : 2);
  }
  assert.equal(destination.seen.length, 0);
});

test('response byte budgets apply before parsing and to a chunked body', async (t) => {
  for (const declared of [true, false]) {
    const { apiOrigin } = await localServer(t, (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json', ...(declared ? { 'Content-Length': MODULE_API_CLIENT_LIMITS.responseBytes + 1 } : {}) });
      response.end('x'.repeat(MODULE_API_CLIENT_LIMITS.responseBytes + 1));
    });
    await assert.rejects(createModuleApiClient({ apiOrigin }).capabilities(), { code: 'MODULE_API_RESPONSE_LIMIT' });
  }
});

test('invalid UTF-8, malformed JSON, and non-JSON responses never become successful capabilities', async (t) => {
  for (const [body, contentType] of [[Buffer.from([0xff]), 'application/json'], ['{', 'application/json'], [JSON.stringify(apiCapabilities()), 'text/html']]) {
    const { apiOrigin } = await localServer(t, (_request, response) => { response.writeHead(200, { 'Content-Type': contentType }); response.end(body); });
    await assert.rejects(createModuleApiClient({ apiOrigin }).capabilities(), { code: 'MODULE_API_RESPONSE' });
  }
});

test('timeout covers a partially read upload receipt and makes uncertainty explicit without retrying', async (t) => {
  const { apiOrigin, seen } = await localServer(t, async (request, response) => {
    if (request.url.endsWith('/capabilities')) json(response, 200, apiCapabilities());
    else { await requestBody(request); response.writeHead(201, { 'Content-Type': 'application/json' }); response.write('{'); }
  });
  await assert.rejects(createModuleApiClient({ apiOrigin, apiKey: TEST_KEY, timeoutMs: 500 }).submit(sourceRequest(), { idempotencyKey: IDEMPOTENCY_KEY }),
    { code: 'MODULE_API_TIMEOUT', submissionMayExist: true });
  assert.equal(seen.filter((entry) => entry.method === 'POST').length, 1);
});

test('lost POST response can be retried with the original key and exactly the same source identity', async (t) => {
  let persisted; let firstRequestBody;
  const { apiOrigin, seen } = await localServer(t, async (request, response) => {
    if (request.url.endsWith('/capabilities')) { json(response, 200, apiCapabilities()); return; }
    assert.equal(request.headers['idempotency-key'], IDEMPOTENCY_KEY);
    const body = await requestBody(request);
    if (!persisted) { firstRequestBody = body; persisted = submissionReceipt(JSON.parse(body)); response.destroy(); }
    else { assert.equal(body, firstRequestBody); json(response, 200, { schemaVersion: MODULE_API_SCHEMA, submission: persisted }); }
  });
  const client = createModuleApiClient({ apiOrigin, apiKey: TEST_KEY });
  await assert.rejects(client.submit(sourceRequest(), { idempotencyKey: IDEMPOTENCY_KEY }), { code: 'MODULE_API_NETWORK', submissionMayExist: true });
  assert.equal(seen.filter((entry) => entry.method === 'POST').length, 1);
  const replay = await client.submit(sourceRequest(), { idempotencyKey: IDEMPOTENCY_KEY });
  assert.equal(replay.idempotent, true); assert.equal(replay.submission.submissionId, SUBMISSION_ID);
  assert.equal(seen.filter((entry) => entry.method === 'POST').length, 2);
});

test('supersession binds the new immutable receipt to an explicit prior UUID', async (t) => {
  const { apiOrigin } = await localServer(t, intakeHandler());
  const request = sourceRequest(); request.supersedesSubmissionId = OTHER_ID.toUpperCase();
  const receipt = await createModuleApiClient({ apiOrigin, apiKey: TEST_KEY }).submit(request, { idempotencyKey: IDEMPOTENCY_KEY });
  assert.equal(receipt.submission.supersedesSubmissionId, OTHER_ID);
});

test('agent source uploads do not require a Git repository or invented revision evidence', async (t) => {
  const { apiOrigin } = await localServer(t, intakeHandler());
  const request = sourceRequest(); delete request.descriptor.source.repository; delete request.descriptor.source.revision;
  const receipt = await createModuleApiClient({ apiOrigin, apiKey: TEST_KEY }).submit(request, { idempotencyKey: IDEMPOTENCY_KEY });
  assert.equal(receipt.submission.requestDigest, validateModuleSubmissionRequest(request).requestDigest);
  assert.equal(receipt.submission.sourceBytesVerified, true); assert.equal(receipt.submission.sourceRevisionVerified, false);
});
