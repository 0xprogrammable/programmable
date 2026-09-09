import { Buffer } from 'node:buffer';
import { canonicalJson } from './canonical-json.mjs';
import { MODULE_SUBMISSION_FORMAT, MODULE_TRANSPORT_LIMITS, ModuleTransportError,
  validateModuleSubmissionRequest } from './open-transport.mjs';
import { MODULE_REVIEW_CAPABILITIES_SCHEMA, MODULE_REVIEW_STATUS_SCHEMA, bindModuleReviewCapabilities, bindModuleReviewStatus } from './open-review.mjs';
import { MODULE_CONTEXT_SCHEMA, bindModuleContext } from './open-context.mjs';
export { MODULE_CONTEXT_SCHEMA } from './open-context.mjs';
export { MODULE_REVIEW_CAPABILITIES_SCHEMA, MODULE_REVIEW_STATUS_SCHEMA } from './open-review.mjs';

export const MODULE_API_SCHEMA = 'programmable.modules.api.v0.1';
export const MODULE_API_CLIENT_LIMITS = Object.freeze({ responseBytes: 1024 * 1024, timeoutMs: 20_000, pageSize: 20 });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = /^0x[0-9a-f]{64}$/;
const wallet = /^0x[0-9a-fA-F]{40}$/;
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value > 0 && value <= maximum;

export class ModuleApiError extends Error {
  constructor(code, message, details = {}) {
    super(message); this.name = 'ModuleApiError'; this.code = code;
    for (const field of ['httpStatus', 'path', 'retryAfterSeconds', 'submissionMayExist']) {
      if (Object.hasOwn(details, field)) this[field] = details[field];
    }
  }
}
const need = (condition, code, message) => { if (!condition) throw new ModuleApiError(code, message); };

/** Explicit origin only. HTTP is limited to loopback for local integration checks. */
export function validateModuleApiOrigin(input) {
  need(typeof input === 'string' && input.length <= 2048 && input === input.trim()
    && !/[\s\\?#@]/.test(input) && /^[a-z]+:\/\/[^/]+\/?$/i.test(input),
  'MODULE_API_ORIGIN', 'Provide an HTTPS API origin without credentials, path, query or fragment');
  let parsed;
  try { parsed = new URL(input); } catch { throw new ModuleApiError('MODULE_API_ORIGIN', 'Provide an explicit HTTPS API origin'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  need((parsed.protocol === 'https:' || (parsed.protocol === 'http:' && loopback))
    && !parsed.username && !parsed.password && parsed.pathname === '/' && !parsed.search && !parsed.hash,
  'MODULE_API_ORIGIN', 'Only HTTPS origins, or loopback HTTP for local checks, are supported');
  return parsed.origin;
}

function submissionId(input) {
  need(typeof input === 'string' && uuid.test(input), 'MODULE_SUBMISSION_ID', 'Use the submission UUID returned by the API');
  return input.toLowerCase();
}
function validEnvelope(value) {
  need(plain(value) && value.schemaVersion === MODULE_API_SCHEMA,
    'MODULE_API_RESPONSE', 'The API response has an unsupported schema');
}
function publicCapabilities(value) {
  validEnvelope(value);
  need(plain(value.moduleContributions) && typeof value.moduleContributions.apiKeyIssuance === 'boolean'
    && typeof value.moduleContributions.submissions === 'boolean' && value.submissionFormat === MODULE_SUBMISSION_FORMAT
    && plain(value.limits) && ['httpBytes', 'sourceBytes', 'sourceFileBytes', 'sourceFiles', 'pageSize', 'requestSeconds', 'concurrentUploads']
      .every((key) => integer(value.limits[key]))
    && value.reviewAvailable === false && value.approved === false && value.available === false,
  'MODULE_API_RESPONSE', 'The API capabilities do not match the supported draft submission contract');
  return {
    schemaVersion: MODULE_API_SCHEMA,
    moduleContributions: { apiKeyIssuance: value.moduleContributions.apiKeyIssuance, submissions: value.moduleContributions.submissions },
    submissionFormat: MODULE_SUBMISSION_FORMAT,
    limits: Object.fromEntries(['httpBytes', 'sourceBytes', 'sourceFileBytes', 'sourceFiles', 'pageSize', 'requestSeconds', 'concurrentUploads']
      .map((key) => [key, value.limits[key]])),
    reviewAvailable: false, approved: false, available: false,
  };
}
function publicSubmission(value) {
  need(plain(value) && typeof value.submissionId === 'string' && uuid.test(value.submissionId)
    && ['packageId', 'familyId', 'requestDigest'].every((key) => typeof value[key] === 'string' && digest.test(value[key]))
    && ['author', 'rewardWallet'].every((key) => typeof value[key] === 'string' && wallet.test(value[key]) && !/^0x0{40}$/i.test(value[key]))
    && Number.isSafeInteger(value.totalSourceBytes) && value.totalSourceBytes >= 0 && value.totalSourceBytes <= MODULE_TRANSPORT_LIMITS.totalSourceBytes
    && typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 96
    && typeof value.version === 'string' && /^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}(?:-[a-z0-9.-]{1,40})?$/.test(value.version)
    && typeof value.createdAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.createdAt)
    && Number.isFinite(Date.parse(value.createdAt))
    && (value.supersedesSubmissionId === null || (typeof value.supersedesSubmissionId === 'string' && uuid.test(value.supersedesSubmissionId)))
    && value.status === 'draft_received' && value.reviewStatus === 'unreviewed' && value.sourceBytesVerified === true
    && ['sourceRevisionVerified', 'buildVerified', 'runtimeVerified', 'approved', 'available'].every((key) => value[key] === false),
  'MODULE_API_RESPONSE', 'The API receipt is incomplete or has an unsupported review state');
  return {
    submissionId: value.submissionId.toLowerCase(), packageId: value.packageId, familyId: value.familyId, requestDigest: value.requestDigest,
    author: value.author.toLowerCase(), rewardWallet: value.rewardWallet.toLowerCase(), totalSourceBytes: value.totalSourceBytes,
    name: value.name, version: value.version, createdAt: value.createdAt,
    supersedesSubmissionId: value.supersedesSubmissionId?.toLowerCase() ?? null,
    status: 'draft_received', reviewStatus: 'unreviewed', sourceBytesVerified: true, sourceRevisionVerified: false,
    buildVerified: false, runtimeVerified: false, approved: false, available: false,
  };
}

async function boundedJson(response) {
  const declared = response.headers.get('content-length');
  if (declared !== null) need(/^\d+$/.test(declared) && Number(declared) <= MODULE_API_CLIENT_LIMITS.responseBytes,
    'MODULE_API_RESPONSE_LIMIT', 'The API response exceeds its byte budget');
  need(response.body !== null, 'MODULE_API_RESPONSE', 'The API response is empty');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      need(size <= MODULE_API_CLIENT_LIMITS.responseBytes, 'MODULE_API_RESPONSE_LIMIT', 'The API response exceeds its byte budget');
      chunks.push(value);
    }
    need(/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || ''),
      'MODULE_API_RESPONSE', 'The API must return application/json');
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))); }
    catch { throw new ModuleApiError('MODULE_API_RESPONSE', 'The API returned invalid UTF-8 JSON'); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function responseError(response, body, apiKey) {
  const problem = plain(body) && [MODULE_API_SCHEMA, MODULE_CONTEXT_SCHEMA, MODULE_REVIEW_CAPABILITIES_SCHEMA, MODULE_REVIEW_STATUS_SCHEMA].includes(body.schemaVersion) && plain(body.error) ? body.error : {};
  const code = typeof problem.code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(problem.code)
    && (!apiKey || !problem.code.includes(apiKey)) ? problem.code : 'MODULE_API_HTTP';
  const path = typeof problem.path === 'string' && problem.path.length <= 512 && !/[\u0000-\u001f\u007f]/.test(problem.path)
    && (!apiKey || !problem.path.includes(apiKey)) ? problem.path : undefined;
  const delay = response.headers.get('retry-after');
  const retryAfterSeconds = delay !== null && /^\d{1,5}$/.test(delay) && integer(Number(delay), 86_400) ? Number(delay) : undefined;
  const messages = {
    400: 'The API rejected the submission or request parameters', 401: 'The module API key is missing, revoked or invalid',
    403: 'The API key lacks the required scope or does not own the declared author wallet', 404: 'The submission is not available to this API key',
    409: 'The submission conflicts with an existing immutable request or revision', 413: 'The API rejected the request byte size',
    429: 'The module contribution quota is exhausted; wait before retrying', 503: 'The requested module API operation is currently unavailable',
  };
  return new ModuleApiError(code, messages[response.status] || 'The module API request failed', {
    httpStatus: response.status, ...(path === undefined ? {} : { path }),
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  });
}

/** Node-only contribution client. No source execution, automatic retries, signing or admission. */
export function createModuleApiClient({ apiOrigin, apiKey, timeoutMs = MODULE_API_CLIENT_LIMITS.timeoutMs } = {}) {
  const origin = validateModuleApiOrigin(apiOrigin);
  need(integer(timeoutMs, 120_000), 'MODULE_API_TIMEOUT_CONFIG', 'Set a request timeout between 1 and 120000 milliseconds');
  if (apiKey !== undefined) need(typeof apiKey === 'string' && apiKey.length > 0 && apiKey.length <= 4096 && /^[A-Za-z0-9._~+/-]+={0,2}$/.test(apiKey),
    'MODULE_API_KEY', 'Provide a nonempty bearer API key without whitespace or unsupported characters');
  const requireKey = () => need(typeof apiKey === 'string', 'MODULE_API_KEY', 'A Module contributions API key is required');
  const noKeyEcho = (value) => {
    need(!apiKey || !JSON.stringify(value).includes(apiKey), 'MODULE_API_RESPONSE', 'The API response unexpectedly contains credential material');
    return value;
  };
  async function request(path, { authenticated = false, method = 'GET', body, idempotencyKey, statuses = [200] } = {}) {
    if (authenticated) requireKey();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(new URL(path, origin), {
        method, credentials: 'omit', redirect: 'error', signal: controller.signal, cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: { Accept: 'application/json', ...(authenticated ? { Authorization: `Bearer ${apiKey}` } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
        ...(body === undefined ? {} : { body }),
      });
      let value;
      try { value = await boundedJson(response); }
      catch (error) {
        // Cancel even when the Content-Length check fails before obtaining a reader.
        await response.body?.cancel().catch(() => {});
        if (!statuses.includes(response.status) && error instanceof ModuleApiError) throw responseError(response, null, apiKey);
        throw error;
      }
      if (!statuses.includes(response.status)) throw responseError(response, value, apiKey);
      return { body: value, httpStatus: response.status };
    } catch (error) {
      if (error instanceof ModuleApiError) throw error;
      throw new ModuleApiError(controller.signal.aborted ? 'MODULE_API_TIMEOUT' : 'MODULE_API_NETWORK',
        controller.signal.aborted ? 'The module API request timed out' : 'The module API could not be reached without a redirect');
    } finally { clearTimeout(timer); }
  }
  async function capabilities() { return noKeyEcho(publicCapabilities((await request('/v1/modules/capabilities')).body)); }
  const reviewResponse = (bind, ...args) => {
    try { return noKeyEcho(bind(...args)); }
    catch { throw new ModuleApiError('MODULE_REVIEW_RESPONSE', 'The module review response is unsupported, inconsistent or bound to a different source request'); }
  };
  async function reviewCapabilities() {
    return reviewResponse(bindModuleReviewCapabilities, (await request('/v1/modules/review-capabilities')).body);
  }
  async function status(id) {
    const expectedId = submissionId(id);
    const { body } = await request(`/v1/modules/submissions/${expectedId}`, { authenticated: true });
    validEnvelope(body); const submission = publicSubmission(body.submission);
    need(submission.submissionId === expectedId, 'MODULE_API_RECEIPT_MISMATCH', 'The API returned a different submission');
    return noKeyEcho({ schemaVersion: MODULE_API_SCHEMA, submission });
  }
  return Object.freeze({
    capabilities, reviewCapabilities,
    async context() {
      requireKey();
      await capabilities();
      const { body } = await request('/v1/modules/context', { authenticated: true });
      try { return noKeyEcho(bindModuleContext(body)); }
      catch { throw new ModuleApiError('MODULE_CONTEXT_RESPONSE', 'The API returned inconsistent author, permissions or module preparation requirements'); }
    },
    async reviewStatus(id) {
      requireKey(); const expectedId = submissionId(id);
      const caps = await reviewCapabilities();
      need(caps.statusReadAvailable, 'MODULE_REVIEW_UNAVAILABLE', 'This deployment is not ready to provide module review progress. The original intake receipt remains separate');
      const receipt = await status(expectedId);
      const { body } = await request(`/v1/modules/submissions/${expectedId}/review`, { authenticated: true });
      return reviewResponse(bindModuleReviewStatus, body, receipt.submission);
    },
    async submit(input, { idempotencyKey } = {}) {
      requireKey();
      need(typeof idempotencyKey === 'string' && /^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey),
        'MODULE_IDEMPOTENCY_KEY', 'Use a stable 16 to 128 character Idempotency-Key with letters, digits, dot, underscore, colon or hyphen');
      const validated = validateModuleSubmissionRequest(input);
      if (!validated.ok) {
        const issue = validated.errors[0]; throw new ModuleTransportError(issue.code, issue.message, issue.path);
      }
      const body = canonicalJson(validated.request);
      const caps = await capabilities();
      need(caps.moduleContributions.submissions, 'MODULE_SUBMISSIONS_UNAVAILABLE', 'This API is not accepting module submissions');
      need(Buffer.byteLength(body, 'utf8') <= caps.limits.httpBytes && validated.totalSourceBytes <= caps.limits.sourceBytes
        && validated.request.files.length <= caps.limits.sourceFiles
        && validated.request.files.every((file) => Buffer.byteLength(file.bytes, 'base64') <= caps.limits.sourceFileBytes),
      'MODULE_API_REQUEST_LIMIT', 'The pinned source package exceeds this API deployment\'s published limits');
      try {
        const { body: value, httpStatus } = await request('/v1/modules/submissions', { authenticated: true, method: 'POST', body, idempotencyKey, statuses: [200, 201] });
        validEnvelope(value); const submission = publicSubmission(value.submission);
        need(submission.packageId === validated.packageId && submission.familyId === validated.familyId
          && submission.requestDigest === validated.requestDigest && submission.author === validated.request.descriptor.author.toLowerCase()
          && submission.rewardWallet === validated.request.descriptor.rewardWallet.toLowerCase() && submission.totalSourceBytes === validated.totalSourceBytes
          && submission.name === validated.request.descriptor.name && submission.version === validated.request.descriptor.version
          && submission.supersedesSubmissionId === (validated.request.supersedesSubmissionId ?? null),
        'MODULE_API_RECEIPT_MISMATCH', 'The persisted receipt does not identify the exact source request sent');
        return noKeyEcho({ schemaVersion: MODULE_API_SCHEMA, submission, idempotent: httpStatus === 200 });
      } catch (error) {
        if (error instanceof ModuleApiError) error.submissionMayExist = error.httpStatus === undefined || error.httpStatus >= 500 || error.httpStatus === 409;
        throw error;
      }
    },
    status,
    async list({ cursor } = {}) {
      const query = cursor === undefined ? '' : `?cursor=${submissionId(cursor)}`;
      const { body } = await request(`/v1/modules/submissions${query}`, { authenticated: true });
      validEnvelope(body);
      need(Array.isArray(body.submissions) && body.submissions.length <= MODULE_API_CLIENT_LIMITS.pageSize
        && (body.nextCursor === null || (typeof body.nextCursor === 'string' && uuid.test(body.nextCursor))),
      'MODULE_API_RESPONSE', 'The API returned an invalid submission page');
      const submissions = body.submissions.map(publicSubmission);
      need(new Set(submissions.map((submission) => submission.submissionId)).size === submissions.length,
        'MODULE_API_RESPONSE', 'The API returned duplicate submissions');
      need(body.nextCursor === null || (submissions.length > 0 && body.nextCursor.toLowerCase() === submissions.at(-1).submissionId
        && body.nextCursor.toLowerCase() !== cursor?.toLowerCase()),
      'MODULE_API_RESPONSE', 'The API returned a cursor that does not advance this page');
      return noKeyEcho({ schemaVersion: MODULE_API_SCHEMA, submissions, nextCursor: body.nextCursor?.toLowerCase() ?? null });
    },
  });
}
