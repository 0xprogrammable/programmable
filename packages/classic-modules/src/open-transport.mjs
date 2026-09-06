import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.mjs';
import { validateOpenPackage, OPEN_PLAN_LIMITS } from './open-packages.mjs';

export const MODULE_SUBMISSION_FORMAT = 'programmable.modules.submission.v0.1';
export const MODULE_TRANSPORT_LIMITS = Object.freeze({
  requestBytes: 24 * 1024 * 1024, fileBytes: 4 * 1024 * 1024,
  totalSourceBytes: 16 * 1024 * 1024, files: 128,
  descriptorBytes: OPEN_PLAN_LIMITS.bytes,
});
export class ModuleTransportError extends Error {
  constructor(code, message, path = '') {
    super(message); this.name = 'ModuleTransportError'; this.code = code; this.path = path;
  }
}
const need = (condition, code, message, path = '') => {
  if (!condition) throw new ModuleTransportError(code, message, path);
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isPlain = (value) => value !== null && typeof value === 'object'
  && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function record(value, required, optional, path) {
  need(isPlain(value), 'MODULE_REQUEST_SHAPE', 'Expected an ordinary JSON object', path);
  const keys = Reflect.ownKeys(value);
  need(keys.length <= required.length + optional.length, 'MODULE_REQUEST_SHAPE', 'Unexpected request properties', path);
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    need(typeof key === 'string' && [...required, ...optional].includes(key)
      && property.enumerable && Object.hasOwn(property, 'value'),
    'MODULE_REQUEST_SHAPE', 'Only declared inert fields are allowed', path);
  }
  need(required.every((key) => Object.hasOwn(value, key)), 'MODULE_REQUEST_SHAPE', 'Required field is missing', path);
}
function fileArray(value) {
  need(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype,
    'MODULE_FILES', 'Expected a JSON array of files', '/files');
  need(value.length > 0 && value.length <= MODULE_TRANSPORT_LIMITS.files,
    'MODULE_FILES', 'Source package must contain 1 to 128 files', '/files');
  need(Reflect.ownKeys(value).length === value.length + 1, 'MODULE_FILES', 'Sparse or extended arrays are unsupported', '/files');
  for (let i = 0; i < value.length; i++) {
    const property = Object.getOwnPropertyDescriptor(value, String(i));
    need(property && property.enumerable && Object.hasOwn(property, 'value'),
      'MODULE_FILES', 'Source entries must be inert JSON data', `/files/${i}`);
  }
}

/** Validate uploaded bytes; no source import, execution, fetching, wallet proof or admission. */
export function validateModuleSubmissionRequest(input) {
  try {
    record(input, ['format', 'descriptor', 'files'], ['supersedesSubmissionId'], '');
    need(input.format === MODULE_SUBMISSION_FORMAT, 'MODULE_REQUEST_FORMAT', 'Unsupported module submission format', '/format');
    if (Object.hasOwn(input, 'supersedesSubmissionId')) need(typeof input.supersedesSubmissionId === 'string'
      && uuid.test(input.supersedesSubmissionId), 'MODULE_REVISION', 'Expected a submission UUID', '/supersedesSubmissionId');
    const checked = validateOpenPackage(input.descriptor);
    if (!checked.ok) {
      const issue = checked.errors[0];
      throw new ModuleTransportError(issue.code, issue.message, `/descriptor${issue.path}`);
    }
    fileArray(input.files);
    const pinned = new Map(checked.descriptor.source.files.map((file) => [file.path, file.sha256]));
    need(input.files.length === pinned.size, 'MODULE_FILE_SET', 'Upload must contain exactly the pinned source files', '/files');
    const files = [];
    const seen = new Set();
    let totalSourceBytes = 0;
    for (let i = 0; i < input.files.length; i++) {
      const file = input.files[i]; const at = `/files/${i}`;
      record(file, ['path', 'sha256', 'encoding', 'bytes'], [], at);
      need(typeof file.path === 'string' && pinned.has(file.path) && !seen.has(file.path),
        'MODULE_FILE_SET', 'Unknown or repeated source path', `${at}/path`);
      seen.add(file.path);
      need(file.sha256 === pinned.get(file.path), 'MODULE_FILE_HASH', 'File hash differs from the pinned descriptor', `${at}/sha256`);
      need(file.encoding === 'base64' && typeof file.bytes === 'string',
        'MODULE_FILE_ENCODING', 'Source bytes must use canonical base64', `${at}/bytes`);
      // Bound encoded length before decoding or allocating a large Buffer.
      need(file.bytes.length <= 4 * Math.ceil(MODULE_TRANSPORT_LIMITS.fileBytes / 3),
        'MODULE_SOURCE_LIMIT', 'Source file exceeds its byte budget', `${at}/bytes`);
      need(file.bytes.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(file.bytes),
        'MODULE_FILE_ENCODING', 'Invalid base64 encoding', `${at}/bytes`);
      const bytes = Buffer.from(file.bytes, 'base64');
      need(bytes.length <= MODULE_TRANSPORT_LIMITS.fileBytes, 'MODULE_SOURCE_LIMIT', 'Source file exceeds its byte budget', `${at}/bytes`);
      need(bytes.toString('base64') === file.bytes, 'MODULE_FILE_ENCODING', 'Base64 encoding is not canonical', `${at}/bytes`);
      totalSourceBytes += bytes.length;
      need(totalSourceBytes <= MODULE_TRANSPORT_LIMITS.totalSourceBytes,
        'MODULE_SOURCE_LIMIT', 'Source package exceeds its aggregate byte budget', '/files');
      need(hash(bytes) === file.sha256, 'MODULE_FILE_HASH', 'Uploaded bytes do not match their pinned hash', `${at}/bytes`);
      files.push({ path: file.path, sha256: file.sha256, encoding: 'base64', bytes: file.bytes });
    }
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const request = {
      format: MODULE_SUBMISSION_FORMAT, descriptor: checked.descriptor, files,
      ...(Object.hasOwn(input, 'supersedesSubmissionId') ? { supersedesSubmissionId: input.supersedesSubmissionId.toLowerCase() } : {}),
    };
    const serialized = canonicalJson(request);
    need(Buffer.byteLength(serialized, 'utf8') <= MODULE_TRANSPORT_LIMITS.requestBytes,
      'MODULE_REQUEST_LIMIT', 'Serialized request exceeds the HTTP byte budget');
    return {
      ok: true, request, packageId: checked.packageId, familyId: checked.familyId,
      requestDigest: `0x${hash(canonicalJson({ domain: MODULE_SUBMISSION_FORMAT, request }))}`,
      totalSourceBytes, sourceBytesVerified: true, sourceRevisionVerified: false,
      authorAuthenticated: false, buildVerified: false, runtimeVerified: false,
      reviewStatus: 'unreviewed', onchainApproved: false, available: false,
    };
  } catch (error) {
    return { ok: false, errors: [{ code: error.code || 'MODULE_REQUEST_INVALID', message: error.message, path: error.path || '' }] };
  }
}

/** Apply the wire byte limit before JSON parsing. The HTTP server must also bound streaming reads. */
export function parseModuleSubmissionJSON(body) {
  need(typeof body === 'string' || body instanceof Uint8Array, 'MODULE_REQUEST_BODY', 'Expected UTF-8 JSON bytes');
  need((typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : body.byteLength) <= MODULE_TRANSPORT_LIMITS.requestBytes,
    'MODULE_REQUEST_LIMIT', 'Request exceeds the HTTP byte budget');
  let input;
  try {
    const json = typeof body === 'string' ? body : new TextDecoder('utf-8', { fatal: true }).decode(body);
    input = JSON.parse(json);
  } catch { throw new ModuleTransportError('MODULE_REQUEST_JSON', 'Request must be valid UTF-8 JSON'); }
  return validateModuleSubmissionRequest(input);
}

/** Strip local pack evidence; only source declarations/bytes cross the contribution API boundary. */
export function moduleSubmissionFromPack(pack, options = {}) {
  need(pack && pack.format === 'programmable.classic.source-pack.v0.1', 'MODULE_PACK_FORMAT', 'Expected an open source pack');
  record(options, [], ['supersedesSubmissionId'], '/options');
  const result = validateModuleSubmissionRequest({
    format: MODULE_SUBMISSION_FORMAT, descriptor: pack.descriptor, files: pack.files,
    ...(Object.hasOwn(options, 'supersedesSubmissionId') ? { supersedesSubmissionId: options.supersedesSubmissionId } : {}),
  });
  if (!result.ok) {
    const issue = result.errors[0]; throw new ModuleTransportError(issue.code, issue.message, issue.path);
  }
  return result.request;
}
