import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson, ClassicModuleError, safeRelativePath, validateModuleManifest, validateConfigurationSchema } from './index.mjs';

export const FILE_LIMITS = Object.freeze({ manifest: 16_384, schema: 16_384, recipe: 32_768, catalogue: 32 * 1024 * 1024, artifact: 4 * 1024 * 1024, pack: 6 * 1024 * 1024 });
const fail = (code, message) => { throw new ClassicModuleError(code, message); };
const digestBytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = (value) => Buffer.from(`${canonicalJson(value)}\n`);
function assertResult(result) { if (!result.ok) throw new ClassicModuleError(result.errors[0].code, result.errors[0].message); }

/** Root is operator-selected; every path below it must consist of real directories and regular files. */
export async function checkedRoot(root) {
  const absolute = path.resolve(root);
  const stat = await fs.lstat(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('UNSAFE_ROOT', 'Root must be a real directory');
  return fs.realpath(absolute);
}
async function checkedParent(root, relative, create = false) {
  if (!safeRelativePath(relative)) fail('UNSAFE_PATH', 'Use a relative path without traversal, empty segments or symlinks');
  const parts = relative.split('/');
  let parent = root;
  for (const part of parts.slice(0, -1)) {
    parent = path.join(parent, part);
    if (create) await fs.mkdir(parent).catch((error) => { if (error.code !== 'EEXIST') throw error; });
    const stat = await fs.lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('UNSAFE_PATH', 'Path contains a symlink or non-directory');
  }
  return path.join(parent, parts.at(-1));
}
export async function readBoundedFile(root, relative, maximum) {
  const resolved = await checkedParent(await checkedRoot(root), relative);
  const handle = await fs.open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximum) fail('FILE_LIMIT', 'Expected a regular file within its size limit');
    // Fixed buffer prevents a concurrently growing input from exceeding the limit.
    const buffer = Buffer.alloc(maximum + 1);
    let count = 0;
    while (count <= maximum) {
      const { bytesRead } = await handle.read(buffer, count, maximum + 1 - count, null);
      if (bytesRead === 0) break;
      count += bytesRead;
    }
    if (count > maximum) fail('FILE_LIMIT', 'File grew beyond its size limit');
    return buffer.subarray(0, count);
  } finally { await handle.close(); }
}
export async function readJsonFile(root, relative, maximum) {
  const bytes = await readBoundedFile(root, relative, maximum);
  let parsed;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('INVALID_JSON', `Invalid UTF-8 JSON in ${relative}`); }
  canonicalJson(parsed);
  return parsed;
}
/** Atomic create, never overwrite. Returns false if a regular target already exists. */
export async function writeJsonExclusive(root, relative, value) {
  const resolved = await checkedParent(await checkedRoot(root), relative);
  const temporary = `${resolved}.tmp-${randomUUID()}`;
  let handle;
  try {
    handle = await fs.open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(jsonBytes(value)); await handle.sync(); await handle.close(); handle = null;
    try { await fs.link(temporary, resolved); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await fs.lstat(resolved);
      if (!existing.isFile() || existing.isSymbolicLink()) fail('UNSAFE_PATH', 'Output is not a regular file');
      return false;
    }
    return true;
  } finally { if (handle) await handle.close(); await fs.unlink(temporary).catch(() => {}); }
}
async function directory(root, relative) {
  const resolved = await checkedParent(root, `${relative}/entry`, true);
  return path.dirname(resolved);
}

export async function loadModulePackage(root, manifestPath) {
  const manifest = await readJsonFile(root, manifestPath, FILE_LIMITS.manifest);
  const validation = validateModuleManifest(manifest); assertResult(validation);
  const base = path.posix.dirname(manifestPath);
  const withinManifest = (file) => base === '.' ? file : `${base}/${file}`;
  const configSchema = await readJsonFile(root, withinManifest(manifest.configuration.schemaUri), FILE_LIMITS.schema);
  assertResult(validateConfigurationSchema(configSchema, manifest));
  const artifact = await readBoundedFile(root, withinManifest(manifest.source.artifactPath), FILE_LIMITS.artifact);
  if (digestBytes(artifact) !== manifest.source.artifactSha256) fail('SOURCE_ARTIFACT_DIGEST_MISMATCH', 'Source artifact bytes differ from the manifest SHA-256');
  return {
    format: 'programmable.classic.module-pack.v1', manifest, manifestHash: validation.manifestHash, configSchema,
    sourceArtifact: { sha256: manifest.source.artifactSha256, encoding: 'base64', bytes: artifact.toString('base64') },
    evidence: 'Hash binding only. Compilation, runtime/source verification, security review and onchain approval are not performed by this CLI.',
  };
}

function validId(id) { if (!/^0x[0-9a-f]{64}$/.test(id)) fail('INVALID_SUBMISSION_ID', 'Submission ID must be a lowercase manifest hash'); }
async function queuePath(root, queue, id) {
  if (!safeRelativePath(queue)) fail('UNSAFE_PATH', 'Queue must be a local relative path');
  validId(id); await directory(root, `${queue}/${id}`); return `${queue}/${id}`;
}
export async function submitToLocalQueue({ root, manifestPath, queue }) {
  const canonicalRoot = await checkedRoot(root);
  const pack = await loadModulePackage(canonicalRoot, manifestPath);
  const id = pack.manifestHash;
  const base = await queuePath(canonicalRoot, queue, id);
  const packBytes = jsonBytes(pack);
  const packageSha256 = digestBytes(packBytes);
  const created = await writeJsonExclusive(canonicalRoot, `${base}/package.json`, pack);
  if (!created) {
    const prior = await readBoundedFile(canonicalRoot, `${base}/package.json`, FILE_LIMITS.pack);
    if (digestBytes(prior) !== packageSha256) fail('SUBMISSION_COLLISION', 'An existing immutable submission has different package bytes');
  }
  const request = { schemaVersion: '1.0', id, name: pack.manifest.name, author: pack.manifest.author,
    rewardWalletAtSubmission: pack.manifest.rewardWallet, packageSha256, submittedAt: new Date().toISOString() };
  const requestCreated = await writeJsonExclusive(canonicalRoot, `${base}/request.json`, request);
  if (!requestCreated) {
    const previous = await readJsonFile(canonicalRoot, `${base}/request.json`, FILE_LIMITS.manifest);
    if (previous.id !== id || previous.packageSha256 !== packageSha256) fail('SUBMISSION_COLLISION', 'Stored request does not match its package');
  }
  return { id, idempotent: !requestCreated, status: (await localSubmissionStatus({ root: canonicalRoot, queue, id })).status,
    scope: 'local-only', onchainApproved: false };
}
async function reviewFiles(root, base) {
  let handle;
  try { handle = await fs.opendir(path.dirname(await checkedParent(root, `${base}/reviews/entry`))); }
  catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const names = [];
  let visited = 0;
  for await (const entry of handle) {
    if (++visited > 10_000) fail('QUEUE_LIMIT', 'Review history directory exceeds its entry limit');
    if (entry.isSymbolicLink()) fail('UNSAFE_PATH', 'Review queue contains a symlink');
    if (/^[0-9]{6}\.json$/.test(entry.name) && entry.isFile()) names.push(entry.name);
  }
  return names.sort();
}
export async function localSubmissionStatus({ root, queue, id }) {
  const canonicalRoot = await checkedRoot(root); validId(id);
  const base = `${queue}/${id}`;
  const request = await readJsonFile(canonicalRoot, `${base}/request.json`, FILE_LIMITS.manifest);
  if (request.id !== id) fail('SUBMISSION_CORRUPT', 'Request ID does not match its immutable directory');
  const files = await reviewFiles(canonicalRoot, base);
  let lastReview = null;
  if (files.length) {
    lastReview = await readJsonFile(canonicalRoot, `${base}/reviews/${files.at(-1)}`, FILE_LIMITS.manifest);
    if (lastReview.submissionId !== id || lastReview.packageSha256 !== request.packageSha256
      || lastReview.sequence !== Number(files.at(-1).slice(0, 6)) || lastReview.onchainApproved !== false
      || !['accepted', 'changes_requested', 'rejected'].includes(lastReview.decision)) {
      fail('REVIEW_CORRUPT', 'Stored review is not bound to this immutable submission');
    }
  }
  return { ...request, status: lastReview?.decision || 'submitted', reviewCount: files.length, lastReview,
    scope: 'local-only', onchainApproved: false };
}
export async function listLocalQueue({ root, queue }) {
  const canonicalRoot = await checkedRoot(root);
  const queueDirectory = path.dirname(await checkedParent(canonicalRoot, `${queue}/entry`));
  const ids = [];
  const handle = await fs.opendir(queueDirectory);
  let visited = 0;
  for await (const entry of handle) {
    if (++visited > 10_000) fail('QUEUE_LIMIT', 'Queue contains more than 10,000 entries');
    if (entry.isSymbolicLink()) fail('UNSAFE_PATH', 'Queue contains a symlink');
    if (entry.isDirectory() && /^0x[0-9a-f]{64}$/.test(entry.name)) ids.push(entry.name);
  }
  const submissions = [];
  for (const id of ids.sort()) submissions.push(await localSubmissionStatus({ root: canonicalRoot, queue, id }));
  return { scope: 'local-only', submissions };
}
export async function recordLocalReview({ root, queue, id, reviewer, decision, note }) {
  const canonicalRoot = await checkedRoot(root); validId(id);
  if (!/^0x[0-9a-fA-F]{40}$/.test(reviewer) || /^0x0{40}$/.test(reviewer)) fail('INVALID_REVIEWER', 'Specify the reviewing operator address');
  if (!['accepted', 'changes_requested', 'rejected'].includes(decision)) fail('INVALID_DECISION', 'Decision must be accepted, changes_requested or rejected');
  if (typeof note !== 'string' || note.trim().length === 0 || note.length > 4000) fail('INVALID_REVIEW_NOTE', 'A review note of 1–4000 characters is required');
  const base = `${queue}/${id}`;
  const status = await localSubmissionStatus({ root: canonicalRoot, queue, id });
  const packBytes = await readBoundedFile(canonicalRoot, `${base}/package.json`, FILE_LIMITS.pack);
  if (digestBytes(packBytes) !== status.packageSha256) fail('SUBMISSION_CORRUPT', 'Immutable package SHA-256 does not match its request');
  const reviewsDirectory = await directory(canonicalRoot, `${base}/reviews`);
  const lockFile = path.join(reviewsDirectory, 'review.lock');
  let lock;
  try { lock = await fs.open(lockFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); }
  catch (error) { if (error.code === 'EEXIST') fail('REVIEW_BUSY', 'Another local review holds the queue lock; retry after it finishes'); throw error; }
  try {
    const files = await reviewFiles(canonicalRoot, base);
    const sequence = files.length ? Number(files.at(-1).slice(0, 6)) + 1 : 1;
    if (sequence > 10_000) fail('QUEUE_LIMIT', 'Review history exceeds its limit');
    const record = { schemaVersion: '1.0', submissionId: id, packageSha256: status.packageSha256, sequence,
      reviewer, decision, note, recordedAt: new Date().toISOString(), authority: 'local-filesystem-operator', onchainApproved: false };
    if (!await writeJsonExclusive(canonicalRoot, `${base}/reviews/${String(sequence).padStart(6, '0')}.json`, record)) fail('REVIEW_COLLISION', 'Review sequence already exists');
    return record;
  } finally { await lock.close(); await fs.unlink(lockFile); }
}
