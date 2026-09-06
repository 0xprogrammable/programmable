import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { SOURCE, HELP, sourcePackage } from '../examples/open-packages/fixture.mjs';
import { MODULE_SUBMISSION_FORMAT, validateModuleSubmissionRequest } from '../src/open-transport.mjs';
import { MODULE_API_SCHEMA } from '../src/open-client.mjs';

// Deliberately public inert test credentials. These never identify a deployed API.
export const TEST_KEY = 'local_only_modules_test_credential_123456789';
export const IDEMPOTENCY_KEY = 'local-only-test-revision-1';
export const SUBMISSION_ID = 'a1234567-1234-4234-9234-123456789abc';
export const OTHER_ID = 'b1234567-1234-4234-9234-123456789abc';
export const THIRD_ID = 'c1234567-1234-4234-9234-123456789abc';
export const FILE_CONTENT = { 'fixture/source.txt': SOURCE, 'fixture/README.md': HELP };
export function sourceRequest() {
  const descriptor = sourcePackage();
  return { format: MODULE_SUBMISSION_FORMAT, descriptor,
    files: descriptor.source.files.map((file) => ({ ...file, encoding: 'base64', bytes: Buffer.from(FILE_CONTENT[file.path]).toString('base64') })) };
}
export function apiCapabilities() {
  return { schemaVersion: MODULE_API_SCHEMA, moduleContributions: { apiKeyIssuance: true, submissions: true },
    submissionFormat: MODULE_SUBMISSION_FORMAT,
    limits: { httpBytes: 25165824, sourceBytes: 16777216, sourceFileBytes: 4194304, sourceFiles: 128, pageSize: 20, requestSeconds: 15, concurrentUploads: 2 },
    reviewAvailable: false, approved: false, available: false };
}
export function submissionReceipt(request = sourceRequest(), id = SUBMISSION_ID) {
  const verified = validateModuleSubmissionRequest(request);
  assert.equal(verified.ok, true, JSON.stringify(verified));
  return { submissionId: id, packageId: verified.packageId, familyId: verified.familyId, requestDigest: verified.requestDigest,
    author: request.descriptor.author.toLowerCase(), rewardWallet: request.descriptor.rewardWallet.toLowerCase(),
    totalSourceBytes: verified.totalSourceBytes, name: request.descriptor.name, version: request.descriptor.version,
    createdAt: '2026-09-06T00:00:00.000Z', supersedesSubmissionId: request.supersedesSubmissionId?.toLowerCase() ?? null,
    status: 'draft_received', reviewStatus: 'unreviewed', sourceBytesVerified: true, sourceRevisionVerified: false,
    buildVerified: false, runtimeVerified: false, approved: false, available: false };
}
export function json(response, status, value, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json', ...headers }); response.end(JSON.stringify(value));
}
export function apiError(response, status, code, extras = {}, headers = {}) {
  json(response, status, { schemaVersion: MODULE_API_SCHEMA, error: { code, ...extras } }, headers);
}
export async function requestBody(request) {
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}
export async function localServer(t, handler) {
  const failures = []; const seen = [];
  const server = createServer((request, response) => {
    seen.push({ method: request.method, url: request.url, headers: request.headers });
    Promise.resolve().then(() => handler(request, response)).catch((error) => { failures.push(error); response.destroy(); });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => {
    const closed = new Promise((resolve) => server.close(resolve)); server.closeAllConnections(); await closed;
    assert.deepEqual(failures, [], 'The local API fixture failed');
  });
  return { apiOrigin: `http://127.0.0.1:${server.address().port}`, seen, server };
}
export function intakeHandler({ capabilities = apiCapabilities(), mutateReceipt = (value) => value } = {}) {
  const stored = new Map();
  return async (request, response) => {
    if (request.method === 'GET' && request.url === '/v1/modules/capabilities') {
      assert.equal(request.headers.authorization, undefined); json(response, 200, capabilities); return;
    }
    if (request.headers.authorization !== `Bearer ${TEST_KEY}`) { apiError(response, 401, 'API_KEY_INVALID'); return; }
    if (request.method === 'POST' && request.url === '/v1/modules/submissions') {
      assert.equal(request.headers['content-type'], 'application/json');
      const body = JSON.parse(await requestBody(request));
      const checked = validateModuleSubmissionRequest(body); assert.equal(checked.ok, true);
      const idempotencyKey = request.headers['idempotency-key'];
      const previous = stored.get(idempotencyKey);
      if (previous && previous.requestDigest !== checked.requestDigest) { apiError(response, 409, 'MODULE_IDEMPOTENCY_CONFLICT'); return; }
      const value = previous || submissionReceipt(body); stored.set(idempotencyKey, value);
      json(response, previous ? 200 : 201, { schemaVersion: MODULE_API_SCHEMA, submission: mutateReceipt(value) }); return;
    }
    if (request.method === 'GET' && request.url === `/v1/modules/submissions/${SUBMISSION_ID}`) {
      json(response, 200, { schemaVersion: MODULE_API_SCHEMA, submission: submissionReceipt() }); return;
    }
    if (request.method === 'GET' && request.url === '/v1/modules/submissions') {
      json(response, 200, { schemaVersion: MODULE_API_SCHEMA, submissions: [submissionReceipt()], nextCursor: null }); return;
    }
    apiError(response, 404, 'MODULE_SUBMISSION_NOT_FOUND');
  };
}
