import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadModulePackage, readBoundedFile, submitToLocalQueue, localSubmissionStatus, listLocalQueue,
  recordLocalReview, writeJsonExclusive, FILE_LIMITS } from '../src/io.mjs';

const packageRoot = path.resolve(new URL('..', import.meta.url).pathname);
const manifestPath = 'examples/falling-creator-fee/manifest.json';
const reviewer = `0x${'33'.repeat(20)}`;
async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-modules-sdk-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(path.join(packageRoot, 'examples'), path.join(root, 'examples'), { recursive: true });
  return root;
}
test('pack binds source bytes and canonical configuration schema without executing either', async () => {
  const pack = await loadModulePackage(packageRoot, manifestPath);
  assert.equal(pack.format, 'programmable.classic.module-pack.v1');
  assert.equal(pack.manifest.reviewStatus, 'requested');
  assert.equal(pack.sourceArtifact.encoding, 'base64');
  assert.match(pack.evidence, /not performed/);
});
test('source hash mismatch fails before packaging', async (t) => {
  const root = await temporary(t);
  await fs.appendFile(path.join(root, 'examples/falling-creator-fee/source-artifact.json'), ' ');
  await assert.rejects(loadModulePackage(root, manifestPath), { code: 'SOURCE_ARTIFACT_DIGEST_MISMATCH' });
});
test('relative traversal, final symlinks and parent-directory symlinks are rejected', async (t) => {
  const root = await temporary(t);
  await assert.rejects(readBoundedFile(root, '../secret', 100), { code: 'UNSAFE_PATH' });
  await fs.symlink(path.join(root, manifestPath), path.join(root, 'manifest-link.json'));
  await assert.rejects(readBoundedFile(root, 'manifest-link.json', FILE_LIMITS.manifest), (error) => ['ELOOP', 'EMLINK'].includes(error.code));
  await fs.symlink(path.join(root, 'examples'), path.join(root, 'linked-examples'));
  await assert.rejects(loadModulePackage(root, 'linked-examples/falling-creator-fee/manifest.json'), { code: 'UNSAFE_PATH' });
});
test('file reads are bounded and exclusive outputs do not overwrite previous content', async (t) => {
  const root = await temporary(t);
  await fs.writeFile(path.join(root, 'oversized.json'), 'x'.repeat(101));
  await assert.rejects(readBoundedFile(root, 'oversized.json', 100), { code: 'FILE_LIMIT' });
  assert.equal(await writeJsonExclusive(root, 'result.json', { value: 1 }), true);
  assert.equal(await writeJsonExclusive(root, 'result.json', { value: 2 }), false);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'result.json'), 'utf8')).value, 1);
});
test('local submission is immutable, idempotent and distinct from catalogue approval', async (t) => {
  const root = await temporary(t); const queue = 'queue';
  const first = await submitToLocalQueue({ root, manifestPath, queue });
  assert.equal(first.idempotent, false); assert.equal(first.status, 'submitted'); assert.equal(first.onchainApproved, false);
  const originalRequest = await fs.readFile(path.join(root, queue, first.id, 'request.json'), 'utf8');
  const second = await submitToLocalQueue({ root, manifestPath, queue });
  assert.equal(second.id, first.id); assert.equal(second.idempotent, true);
  assert.equal(await fs.readFile(path.join(root, queue, first.id, 'request.json'), 'utf8'), originalRequest);
  const change = await recordLocalReview({ root, queue, id: first.id, reviewer, decision: 'changes_requested', note: 'Add a worst-case gas test.' });
  assert.equal(change.sequence, 1); assert.equal(change.onchainApproved, false);
  const accepted = await recordLocalReview({ root, queue, id: first.id, reviewer, decision: 'accepted', note: 'Local review complete; independent release checks remain.' });
  assert.equal(accepted.sequence, 2);
  const status = await localSubmissionStatus({ root, queue, id: first.id });
  assert.equal(status.status, 'accepted'); assert.equal(status.reviewCount, 2); assert.equal(status.onchainApproved, false);
  assert.equal((await listLocalQueue({ root, queue })).submissions.length, 1);
  const stored = JSON.parse(await fs.readFile(path.join(root, queue, first.id, 'package.json'), 'utf8'));
  assert.equal(stored.manifest.reviewStatus, 'requested');
  assert.equal((await submitToLocalQueue({ root, manifestPath, queue })).status, 'accepted');
});
test('review refuses changed immutable package bytes and never accepts approved as a decision', async (t) => {
  const root = await temporary(t); const queue = 'queue';
  const { id } = await submitToLocalQueue({ root, manifestPath, queue });
  await assert.rejects(recordLocalReview({ root, queue, id, reviewer, decision: 'approved', note: 'No.' }), { code: 'INVALID_DECISION' });
  await fs.appendFile(path.join(root, queue, id, 'package.json'), ' ');
  await assert.rejects(recordLocalReview({ root, queue, id, reviewer, decision: 'accepted', note: 'No.' }), { code: 'SUBMISSION_CORRUPT' });
  await assert.rejects(submitToLocalQueue({ root, manifestPath, queue }), { code: 'SUBMISSION_COLLISION' });
});
test('parallel duplicate submissions produce one immutable local request', async (t) => {
  const root = await temporary(t); const queue = 'parallel-queue';
  const results = await Promise.all(Array.from({ length: 4 }, () => submitToLocalQueue({ root, manifestPath, queue })));
  assert.equal(new Set(results.map((result) => result.id)).size, 1);
  assert.equal(results.filter((result) => !result.idempotent).length, 1);
});
test('a review copied from another submission cannot change local status', async (t) => {
  const root = await temporary(t); const queue = 'queue';
  const { id } = await submitToLocalQueue({ root, manifestPath, queue });
  const review = await recordLocalReview({ root, queue, id, reviewer, decision: 'accepted', note: 'Bound local review.' });
  review.submissionId = `0x${'44'.repeat(32)}`;
  await fs.writeFile(path.join(root, queue, id, 'reviews/000001.json'), JSON.stringify(review));
  await assert.rejects(localSubmissionStatus({ root, queue, id }), { code: 'REVIEW_CORRUPT' });
});
test('CLI validates fixture modules/recipes and returns nonzero for unknown arguments', () => {
  const bin = path.join(packageRoot, 'bin/programmable-classic-modules.mjs');
  for (const args of [
    ['validate-module', '--manifest', manifestPath],
    ['validate-recipe', '--recipe', 'examples/offline-fixture-recipe.json', '--catalogue', 'examples/offline-fixture-catalogue.json'],
  ]) {
    const result = spawnSync(process.execPath, [bin, ...args], { cwd: packageRoot, encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).ok, true);
  }
  const invalid = spawnSync(process.execPath, [bin, 'validate-module', '--manifest', manifestPath, '--approve', 'yes'], { cwd: packageRoot, encoding: 'utf8' });
  assert.equal(invalid.status, 1); assert.match(invalid.stderr, /Invalid or duplicate option/);
});
