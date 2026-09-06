import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sourcePackage, SOURCE, HELP } from '../examples/open-packages/fixture.mjs';
import { MODULE_SUBMISSION_FORMAT, MODULE_TRANSPORT_LIMITS, validateModuleSubmissionRequest,
  parseModuleSubmissionJSON, moduleSubmissionFromPack } from '../src/open-transport.mjs';

function request() {
  const descriptor = sourcePackage();
  const content = { 'fixture/source.txt': SOURCE, 'fixture/README.md': HELP };
  return { format: MODULE_SUBMISSION_FORMAT, descriptor,
    files: descriptor.source.files.map((file) => ({ ...file, encoding: 'base64', bytes: Buffer.from(content[file.path]).toString('base64') })) };
}
test('wire request rechecks bytes and derives stable identity without inheriting local trust flags', () => {
  const a = request();
  const first = validateModuleSubmissionRequest(a);
  assert.equal(first.ok, true, JSON.stringify(first));
  const second = validateModuleSubmissionRequest({ ...a, files: [...a.files].reverse() });
  assert.equal(first.requestDigest, second.requestDigest);
  assert.equal(first.sourceBytesVerified, true);
  for (const flag of ['sourceRevisionVerified', 'authorAuthenticated', 'runtimeVerified', 'onchainApproved', 'available']) assert.equal(first[flag], false);
  const packed = moduleSubmissionFromPack({ ...a, onchainApproved: true, sourceRevisionVerified: true,
    format: 'programmable.classic.source-pack.v0.1' });
  assert.equal(Object.hasOwn(packed, 'onchainApproved'), false);
  assert.equal(validateModuleSubmissionRequest(packed).ok, true);
});
test('wire parser rejects unknown evidence, duplicate/missing/extra files and source substitution', () => {
  const edits = [
    (x) => { x.approved = true; }, (x) => { x.files[0].verified = true; },
    (x) => { x.files.push(x.files[0]); }, (x) => { x.files.pop(); },
    (x) => { x.files[0].path = '../private'; },
    (x) => { x.files[0].bytes = Buffer.from('changed').toString('base64'); },
    (x) => { x.files[0].sha256 = '0'.repeat(64); },
  ];
  for (const edit of edits) { const x = request(); edit(x); assert.equal(validateModuleSubmissionRequest(x).ok, false); }
});
test('API contributions can upload pinned bytes without a Git repository; partial provenance fails', () => {
  const x = request(); const withRepository = validateModuleSubmissionRequest(x);
  delete x.descriptor.source.repository; delete x.descriptor.source.revision;
  const uploaded = validateModuleSubmissionRequest(x);
  assert.equal(uploaded.ok, true);
  assert.equal(uploaded.sourceBytesVerified, true);
  assert.equal(uploaded.sourceRevisionVerified, false);
  assert.notEqual(uploaded.requestDigest, withRepository.requestDigest);
  x.descriptor.source.repository = 'https://example.invalid/source';
  assert.equal(validateModuleSubmissionRequest(x).ok, false);
  delete x.descriptor.source.repository; x.descriptor.source.revision = 'a'.repeat(40);
  assert.equal(validateModuleSubmissionRequest(x).ok, false);
});
test('canonical base64 rejects whitespace, alternate padding bits and ignored characters', () => {
  for (const encoding of ['YQ', 'YQ==\n', 'YR==', 'YQ===', '$YQ==', '-_==']) {
    const x = request(); x.files[0].bytes = encoding;
    assert.equal(validateModuleSubmissionRequest(x).ok, false, encoding);
  }
});
test('byte parsing bounds input before JSON parse and rejects malformed UTF-8', () => {
  assert.equal(parseModuleSubmissionJSON(Buffer.from(JSON.stringify(request()))).ok, true);
  assert.throws(() => parseModuleSubmissionJSON(Buffer.from([0xff])), { code: 'MODULE_REQUEST_JSON' });
  assert.throws(() => parseModuleSubmissionJSON('{'), { code: 'MODULE_REQUEST_JSON' });
  assert.throws(() => parseModuleSubmissionJSON(Buffer.alloc(MODULE_TRANSPORT_LIMITS.requestBytes + 1)), { code: 'MODULE_REQUEST_LIMIT' });
});
test('raw file and aggregate source limits account for base64 expansion', () => {
  const x = request(); x.files[0].bytes = 'A'.repeat(4 * Math.ceil((MODULE_TRANSPORT_LIMITS.fileBytes + 3) / 3));
  assert.equal(validateModuleSubmissionRequest(x).errors[0].code, 'MODULE_SOURCE_LIMIT');
  const y = request();
  const bytes = Buffer.alloc(MODULE_TRANSPORT_LIMITS.fileBytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  y.files = Array.from({ length: 5 }, (_, i) => ({ path: `fixture/f${i}.txt`, sha256, encoding: 'base64', bytes: bytes.toString('base64') }));
  y.descriptor.source.files = y.files.map(({path,sha256}) => ({path,sha256}));
  y.descriptor.documentation = y.files[0].path; y.descriptor.components[0].sourcePath = y.files[1].path;
  const result = validateModuleSubmissionRequest(y);
  assert.equal(result.ok, false); assert.equal(result.errors[0].code, 'MODULE_SOURCE_LIMIT');
});
test('supersession is an explicit UUID and changes request identity', () => {
  const x = request(); const first = validateModuleSubmissionRequest(x);
  x.supersedesSubmissionId = '12345678-1234-4234-9234-123456789abc';
  const revised = validateModuleSubmissionRequest(x);
  assert.equal(revised.ok, true); assert.notEqual(revised.requestDigest, first.requestDigest);
  x.supersedesSubmissionId = '../../other'; assert.equal(validateModuleSubmissionRequest(x).ok, false);
});
test('envelope and file accessors are rejected before they can run', () => {
  let calls = 0; const x = request();
  Object.defineProperty(x, 'descriptor', {enumerable:true,get(){calls++; return null;}});
  assert.equal(validateModuleSubmissionRequest(x).ok, false); assert.equal(calls, 0);
  const y = request(); Object.defineProperty(y.files[0], 'bytes', {enumerable:true,get(){calls++; return '';}});
  assert.equal(validateModuleSubmissionRequest(y).ok, false); assert.equal(calls, 0);
});
