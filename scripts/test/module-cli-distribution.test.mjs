import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import {
  buildModuleCli, MODULE_CLI_SOURCE_PATHS, MODULE_CLI_RELEASE_ROOT,
} from '../build-module-cli.mjs';
import { localServer, sourceRequest, TEST_KEY, IDEMPOTENCY_KEY, SUBMISSION_ID } from
  '../../packages/classic-modules/test/open-client-fixture.mjs';
import { reviewHandler, reviewStatus } from '../../packages/classic-modules/test/open-review-fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const execAsync = promisify(execFile);
function git(root, args) {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
    '-c', 'user.name=Module CLI fixture', '-c', 'user.email=module-cli@example.invalid', ...args],
  { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'programmable-module-cli-build-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const relative of MODULE_CLI_SOURCE_PATHS) {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await fs.cp(path.join(ROOT, relative), path.join(root, relative), { recursive: true });
  }
  await fs.symlink(await fs.realpath(path.join(ROOT, 'node_modules')), path.join(root, 'node_modules'));
  git(root, ['init', '--quiet']);
  git(root, ['add', '--', ...MODULE_CLI_SOURCE_PATHS]);
  git(root, ['commit', '--quiet', '-m', 'Fixture source']);
  return root;
}
function standalone(root, file, args) {
  return execFileSync(process.execPath, [file, ...args], {
    cwd: root, encoding: 'utf8', timeout: 10_000,
    env: { NODE_PATH: '', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

test('reproduces a source-bound CLI and runs the copied file without npm or node_modules', async (t) => {
  const root = await fixture(t);
  await assert.rejects(buildModuleCli({ root }), { code: 'DISTRIBUTION_DRIFT' });
  const written = await buildModuleCli({ root, write: true });
  const checked = await buildModuleCli({ root });
  assert.equal(checked.sha256, written.sha256);
  assert.equal(checked.sourceDigest, written.sourceDigest);
  const independentRoot = await fixture(t);
  const independent = await buildModuleCli({ root: independentRoot, write: true });
  assert.equal(independent.sha256, written.sha256);
  assert.equal(independent.sourceDigest, written.sourceDigest);
  assert.ok(written.bytes < 1_048_576);
  const manifest = JSON.parse(await fs.readFile(path.join(root, written.manifestPath), 'utf8'));
  const artifact = await fs.readFile(path.join(root, written.artifactPath));
  assert.equal(manifest.artifact.sha256, digest(artifact));
  assert.equal(manifest.artifact.bytes, artifact.length);
  assert.equal(manifest.version, JSON.parse(await fs.readFile(path.join(root, 'packages/classic-modules/package.json'), 'utf8')).version);
  assert.equal(manifest.runtime.requiresNpmInstall, false);
  assert.equal(manifest.assurance.signed, false);
  assert.equal(manifest.assurance.moduleApproval, false);
  assert.ok(manifest.source.files.some((item) => item.path === 'scripts/build-module-cli.mjs'));
  assert.ok(manifest.source.files.some((item) => item.path === 'package-lock.json'));
  assert.ok(manifest.source.files.every((item) => !path.isAbsolute(item.path)));
  assert.ok(!manifest.dependencies.some((item) => ['ws', 'bufferutil', 'node-gyp-build'].includes(item.name)));
  assert.ok(!JSON.stringify(manifest).includes(git(root, ['rev-parse', 'HEAD'])));
  assert.ok(!artifact.includes(Buffer.from(root)));
  const isolated = await fs.mkdtemp(path.join(os.tmpdir(), 'programmable-module-cli-standalone-'));
  t.after(() => fs.rm(isolated, { recursive: true, force: true }));
  const download = path.join(isolated, manifest.artifact.file);
  await fs.copyFile(path.join(root, written.artifactPath), download);
  assert.equal(standalone(isolated, download, ['--version']).trim(), manifest.version);
  const help = standalone(isolated, download, ['--help']);
  assert.match(help, /module-capabilities/u);
  assert.match(help, /submit-module/u);
  assert.match(help, /status-module/u);
  assert.match(help, /review-status-module/u);
  assert.match(help, /review-capabilities/u);
  assert.equal((await fs.readdir(isolated)).length, 1);
});

for (const staged of [false, true]) {
  test(`rejects ${staged ? 'staged' : 'unstaged'} source before producing a release`, async (t) => {
    const root = await fixture(t);
    const relative = 'packages/classic-modules/src/cli.mjs';
    await fs.appendFile(path.join(root, relative), '\n// Uncommitted candidate.\n');
    if (staged) git(root, ['add', '--', relative]);
    await assert.rejects(buildModuleCli({ root, write: true }), { code: 'SOURCE_NOT_COMMITTED' });
    await assert.rejects(fs.access(path.join(root, MODULE_CLI_RELEASE_ROOT)), { code: 'ENOENT' });
  });
}

test('rejects untracked candidate source', async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'packages/classic-modules/src/untracked.mjs'), 'export const pending = true;\n');
  await assert.rejects(buildModuleCli({ root, write: true }), { code: 'SOURCE_NOT_COMMITTED' });
});

test('compares committed bytes even when the Git index hides a worktree edit', async (t) => {
  const root = await fixture(t);
  const relative = 'packages/classic-modules/src/cli.mjs';
  git(root, ['update-index', '--assume-unchanged', '--', relative]);
  await fs.appendFile(path.join(root, relative), '\n// Hidden worktree drift.\n');
  await assert.rejects(buildModuleCli({ root, write: true }), { code: 'SOURCE_NOT_COMMITTED' });
});

test('requires a new package version for a committed release with changed source', async (t) => {
  const root = await fixture(t);
  const first = await buildModuleCli({ root, write: true });
  const firstBytes = await fs.readFile(path.join(root, first.artifactPath));
  git(root, ['add', '--', MODULE_CLI_RELEASE_ROOT]);
  git(root, ['commit', '--quiet', '-m', 'Versioned fixture release']);
  const cliPath = 'packages/classic-modules/src/cli.mjs';
  await fs.appendFile(path.join(root, cliPath), '\n// New committed source.\n');
  git(root, ['add', '--', cliPath]);
  git(root, ['commit', '--quiet', '-m', 'Changed source']);
  await assert.rejects(buildModuleCli({ root, write: true }), { code: 'VERSION_ALREADY_BOUND' });
  const packagePath = 'packages/classic-modules/package.json';
  const metadata = JSON.parse(await fs.readFile(path.join(root, packagePath), 'utf8'));
  metadata.version = '1.0.0-development.2';
  await fs.writeFile(path.join(root, packagePath), `${JSON.stringify(metadata, null, 2)}\n`);
  await assert.rejects(buildModuleCli({ root, write: true }), { code: 'SOURCE_NOT_COMMITTED' });
  git(root, ['add', '--', packagePath]);
  git(root, ['commit', '--quiet', '-m', 'Next distribution version']);
  const next = await buildModuleCli({ root, write: true });
  assert.notEqual(next.artifactPath, first.artifactPath);
  assert.notEqual(next.sourceDigest, first.sourceDigest);
  assert.deepEqual(await fs.readFile(path.join(root, first.artifactPath)), firstBytes);
});

test('detects modified output without silently replacing it', async (t) => {
  const root = await fixture(t);
  const result = await buildModuleCli({ root, write: true });
  await fs.appendFile(path.join(root, result.artifactPath), '\n// Modified download.\n');
  await assert.rejects(buildModuleCli({ root }), { code: 'DISTRIBUTION_DRIFT' });
  await assert.rejects(buildModuleCli({ root, write: true }), { code: 'OUTPUT_EXISTS' });
});

test('rejects an installed build tool that disagrees with the lock', async (t) => {
  const root = await fixture(t);
  const relative = 'package-lock.json';
  const lock = JSON.parse(await fs.readFile(path.join(root, relative), 'utf8'));
  lock.packages['node_modules/esbuild'].version = '0.0.0';
  await fs.writeFile(path.join(root, relative), `${JSON.stringify(lock)}\n`);
  git(root, ['add', '--', relative]);
  git(root, ['commit', '--quiet', '-m', 'Mismatched fixture lock']);
  await assert.rejects(buildModuleCli({ root, write: true }), { code: 'BUILDER_LOCK' });
});

test('requires the SDK dependency declarations to match the bundled lock versions', async (t) => {
  const root = await fixture(t);
  const relative = 'packages/classic-modules/package.json';
  const metadata = JSON.parse(await fs.readFile(path.join(root, relative), 'utf8'));
  metadata.dependencies.ajv = '8.17.1';
  await fs.writeFile(path.join(root, relative), `${JSON.stringify(metadata)}\n`);
  git(root, ['add', '--', relative]);
  git(root, ['commit', '--quiet', '-m', 'Mismatched SDK dependency declaration']);
  await assert.rejects(buildModuleCli({ root, write: true }), { code: 'SDK_DEPENDENCY_LOCK' });
});

test('refuses distribution output through a directory symlink', async (t) => {
  const root = await fixture(t);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'programmable-module-cli-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'public/developers'), { recursive: true });
  await fs.symlink(outside, path.join(root, MODULE_CLI_RELEASE_ROOT));
  await assert.rejects(buildModuleCli({ root, write: true }), { code: 'OUTPUT_PATH' });
  assert.deepEqual(await fs.readdir(outside), []);
});

test('the copied standalone file submits pinned source and reads it through a real local HTTP fixture', async (t) => {
  const root = await fixture(t);
  const built = await buildModuleCli({ root, write: true });
  const isolated = await fs.mkdtemp(path.join(os.tmpdir(), 'programmable-module-cli-http-'));
  t.after(() => fs.rm(isolated, { recursive: true, force: true }));
  const download = path.join(isolated, path.basename(built.artifactPath));
  await fs.copyFile(path.join(root, built.artifactPath), download);
  await fs.writeFile(path.join(isolated, 'request.json'), JSON.stringify(sourceRequest()));
  const { apiOrigin, seen } = await localServer(t, reviewHandler({ status: () => reviewStatus('accepted') }));
  const run = async (args, authenticated = false) => {
    const { stdout, stderr } = await execAsync(process.execPath, [download, ...args], {
      cwd: isolated, timeout: 10_000, maxBuffer: 1024 * 1024,
      env: { NODE_PATH: '', NODE_ENV: 'test', ...(authenticated ? { PROGRAMMABLE_MODULES_API_KEY: TEST_KEY } : {}) },
    });
    assert.equal(stderr, '');
    assert.ok(!stdout.includes(TEST_KEY));
    return JSON.parse(stdout);
  };
  const capabilities = await run(['module-capabilities', '--api-origin', apiOrigin]);
  assert.equal(capabilities.moduleContributions.submissions, true);
  const args = ['submit-module', '--request', 'request.json', '--api-origin', apiOrigin, '--idempotency-key', IDEMPOTENCY_KEY];
  const submitted = await run(args, true);
  assert.equal(submitted.submission.submissionId, SUBMISSION_ID);
  assert.equal(submitted.submission.status, 'draft_received');
  assert.equal(submitted.submission.approved, false);
  assert.equal(submitted.idempotent, false);
  const replayed = await run(args, true);
  assert.equal(replayed.idempotent, true);
  assert.equal(replayed.submission.requestDigest, submitted.submission.requestDigest);
  const status = await run(['status-module', '--api-origin', apiOrigin, '--id', SUBMISSION_ID], true);
  assert.equal(status.submission.submissionId, SUBMISSION_ID);
  assert.equal(status.submission.available, false);
  const reviewCaps = await run(['review-capabilities', '--api-origin', apiOrigin]);
  assert.equal(reviewCaps.statusReadAvailable, true);
  const review = await run(['review-status-module', '--api-origin', apiOrigin, '--id', SUBMISSION_ID], true);
  assert.equal(review.review.state, 'accepted');
  assert.equal(review.review.nextAction, 'await_registry_admission');
  assert.equal(review.packageId, submitted.submission.packageId);
  assert.equal(review.requestDigest, submitted.submission.requestDigest);
  assert.equal(review.approved, false); assert.equal(review.available, false); assert.equal(review.runtimeVerified, false);
  assert.ok(seen.filter((request) => request.url.endsWith('/capabilities'))
    .every((request) => request.headers.authorization === undefined));
  assert.deepEqual((await fs.readdir(isolated)).sort(), [path.basename(download), 'request.json'].sort());
});
