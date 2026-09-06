import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCli } from '../src/cli.mjs';
import { parseModuleSubmissionJSON } from '../src/open-transport.mjs';
import { sourcePackage } from '../examples/open-packages/fixture.mjs';
import { TEST_KEY, IDEMPOTENCY_KEY, SUBMISSION_ID, OTHER_ID, FILE_CONTENT, apiCapabilities,
  json, apiError, localServer, intakeHandler } from './open-client-fixture.mjs';

async function workspace(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'programmable-module-api-cli-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'fixture'));
  for (const [file, contents] of Object.entries(FILE_CONTENT)) await fs.writeFile(path.join(root, file), contents);
  await fs.writeFile(path.join(root, 'module.json'), JSON.stringify(sourcePackage()));
  return root;
}
async function cli(root, command, options = {}, env = {}) {
  let stdout = ''; let stderr = '';
  const exitCode = await runCli([command, '--root', root, ...Object.entries(options).flatMap(([key, value]) => [`--${key}`, value])], {
    env, stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } },
  });
  return { exitCode, stdout, stderr, result: JSON.parse(stdout || stderr) };
}

test('CLI prepares a pinned source request offline with two EVM wallets and no trusted review claim', async (t) => {
  const root = await workspace(t);
  const result = await cli(root, 'prepare-module-submission', { package: 'module.json', out: 'request.json', supersedes: OTHER_ID });
  assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.result.scope, 'prepared-source-submission');
  const wire = await fs.readFile(path.join(root, 'request.json'));
  const checked = parseModuleSubmissionJSON(wire);
  assert.equal(checked.ok, true); assert.equal(checked.requestDigest, result.result.requestDigest);
  assert.equal(checked.request.supersedesSubmissionId, OTHER_ID);
  assert.equal(result.result.author, sourcePackage().author); assert.equal(result.result.rewardWallet, sourcePackage().rewardWallet);
  assert.equal(result.result.authorAuthenticated, false); assert.equal(result.result.runtimeVerified, false); assert.equal(result.result.approved, false);
  assert.equal(result.result.available, false); assert.equal(result.result.reviewStatus, 'unreviewed');
  assert.equal((await cli(root, 'prepare-module-submission', { package: 'module.json', out: 'request.json' })).exitCode, 1);
  assert.deepEqual(await fs.readFile(path.join(root, 'request.json')), wire);
});

test('CLI capabilities, authenticated submission, status and listing use the real HTTP API', async (t) => {
  const root = await workspace(t);
  const { apiOrigin, seen } = await localServer(t, intakeHandler());
  const env = { PROGRAMMABLE_MODULES_API_KEY: TEST_KEY };
  const caps = await cli(root, 'module-capabilities', { 'api-origin': apiOrigin }, env);
  assert.equal(caps.exitCode, 0, caps.stderr); assert.equal(caps.result.moduleContributions.submissions, true);
  const args = { package: 'module.json', 'api-origin': apiOrigin, 'idempotency-key': IDEMPOTENCY_KEY };
  const submitted = await cli(root, 'submit-module', args, env);
  assert.equal(submitted.exitCode, 0, submitted.stderr); assert.equal(submitted.result.idempotent, false);
  assert.equal(submitted.result.submission.status, 'draft_received'); assert.equal(submitted.result.submission.approved, false);
  const replay = await cli(root, 'submit-module', args, env); assert.equal(replay.result.idempotent, true);
  const status = await cli(root, 'status-module', { 'api-origin': apiOrigin, id: submitted.result.submission.submissionId }, env);
  assert.equal(status.exitCode, 0, status.stderr); assert.equal(status.result.submission.submissionId, SUBMISSION_ID);
  const list = await cli(root, 'list-module-submissions', { 'api-origin': apiOrigin }, env);
  assert.equal(list.exitCode, 0, list.stderr); assert.equal(list.result.submissions.length, 1);
  for (const result of [caps, submitted, replay, status, list]) assert.ok(!`${result.stdout}${result.stderr}`.includes(TEST_KEY));
  assert.equal(seen.filter((request) => request.url.endsWith('/capabilities')).every((request) => request.headers.authorization === undefined), true);
});

test('CLI requires environment credentials, explicit origin and explicit stable idempotency without logging secret arguments', async (t) => {
  const root = await workspace(t); const { apiOrigin, seen } = await localServer(t, intakeHandler());
  const args = { package: 'module.json', 'api-origin': apiOrigin, 'idempotency-key': IDEMPOTENCY_KEY };
  assert.equal((await cli(root, 'submit-module', args)).result.errors[0].code, 'MODULE_API_KEY');
  for (const field of ['api-origin', 'idempotency-key']) {
    const omitted = { ...args }; delete omitted[field];
    assert.equal((await cli(root, 'submit-module', omitted, { PROGRAMMABLE_MODULES_API_KEY: TEST_KEY })).exitCode, 1);
  }
  for (const command of ['submit-module', TEST_KEY]) {
    const rejected = await cli(root, command, { ...args, [`api-key=${TEST_KEY}`]: TEST_KEY }, { PROGRAMMABLE_MODULES_API_KEY: TEST_KEY });
    assert.equal(rejected.exitCode, 1); assert.ok(!rejected.stderr.includes(TEST_KEY));
  }
  assert.equal(seen.length, 0);
});

test('CLI does not upload changed source or an absent or zero reward wallet', async (t) => {
  const root = await workspace(t); const { apiOrigin, seen } = await localServer(t, intakeHandler());
  const args = { package: 'module.json', 'api-origin': apiOrigin, 'idempotency-key': IDEMPOTENCY_KEY };
  const env = { PROGRAMMABLE_MODULES_API_KEY: TEST_KEY };
  await fs.appendFile(path.join(root, 'fixture/source.txt'), '// changed');
  assert.equal((await cli(root, 'submit-module', args, env)).result.errors[0].code, 'OPEN_SOURCE_HASH');
  for (const rewardWallet of [undefined, `0x${'0'.repeat(40)}`]) {
    await fs.writeFile(path.join(root, 'module.json'), JSON.stringify({ ...sourcePackage(), rewardWallet }));
    assert.equal((await cli(root, 'submit-module', args, env)).exitCode, 1);
  }
  assert.equal(seen.length, 0);
});

test('CLI creates a linked immutable source revision and reports API author failures as failures', async (t) => {
  const root = await workspace(t); const env = { PROGRAMMABLE_MODULES_API_KEY: TEST_KEY };
  const accepted = await localServer(t, intakeHandler());
  const args = { package: 'module.json', 'api-origin': accepted.apiOrigin, 'idempotency-key': IDEMPOTENCY_KEY, supersedes: OTHER_ID };
  const revised = await cli(root, 'submit-module', args, env);
  assert.equal(revised.exitCode, 0, revised.stderr); assert.equal(revised.result.submission.supersedesSubmissionId, OTHER_ID);
  const rejected = await localServer(t, (request, response) => {
    if (request.url.endsWith('/capabilities')) json(response, 200, apiCapabilities());
    else apiError(response, 403, 'MODULE_AUTHOR_MISMATCH', { path: '/descriptor/author', message: TEST_KEY });
  });
  const failure = await cli(root, 'submit-module', { ...args, 'api-origin': rejected.apiOrigin }, env);
  assert.equal(failure.exitCode, 1); assert.equal(failure.stdout, ''); assert.equal(failure.result.ok, false);
  assert.equal(failure.result.errors[0].code, 'MODULE_AUTHOR_MISMATCH'); assert.equal(failure.result.errors[0].httpStatus, 403);
  assert.equal(failure.result.errors[0].path, '/descriptor/author'); assert.ok(!failure.stderr.includes(TEST_KEY));
});

test('CLI can replay prepared bytes after source edits without silently rebuilding or rewriting the request', async (t) => {
  const root = await workspace(t); const env = { PROGRAMMABLE_MODULES_API_KEY: TEST_KEY };
  const { apiOrigin, seen } = await localServer(t, intakeHandler());
  const prepared = await cli(root, 'prepare-module-submission', { package: 'module.json', out: 'request.json' });
  assert.equal(prepared.exitCode, 0, prepared.stderr);
  const original = await fs.readFile(path.join(root, 'request.json'));
  const args = { request: 'request.json', 'api-origin': apiOrigin, 'idempotency-key': IDEMPOTENCY_KEY };
  const first = await cli(root, 'submit-module', args, env);
  assert.equal(first.exitCode, 0, first.stderr); assert.equal(first.result.idempotent, false);
  await fs.appendFile(path.join(root, 'fixture/source.txt'), '// this later workspace edit must not enter the retry');
  const replay = await cli(root, 'submit-module', args, env);
  assert.equal(replay.exitCode, 0, replay.stderr); assert.equal(replay.result.idempotent, true);
  assert.equal(replay.result.submission.requestDigest, prepared.result.requestDigest);
  assert.deepEqual(await fs.readFile(path.join(root, 'request.json')), original);
  assert.equal((await cli(root, 'submit-module', { ...args, package: 'module.json' }, env)).exitCode, 1);
  assert.equal((await cli(root, 'submit-module', { ...args, supersedes: OTHER_ID }, env)).exitCode, 1);
  const corrupted = JSON.parse(original); corrupted.files[0].bytes = Buffer.from('changed').toString('base64');
  await fs.writeFile(path.join(root, 'request.json'), JSON.stringify(corrupted));
  assert.equal((await cli(root, 'submit-module', args, env)).result.errors[0].code, 'MODULE_FILE_HASH');
  assert.equal(seen.filter((request) => request.method === 'POST').length, 2);
});
