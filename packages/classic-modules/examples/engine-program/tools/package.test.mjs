import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { decodeAbiParameters } from 'viem';
import { validateOpenPackage } from '../../../src/open-packages.mjs';
import { loadOpenSourcePackage } from '../../../src/open-package-io.mjs';
import { moduleSubmissionFromPack, validateModuleSubmissionRequest } from '../../../src/open-transport.mjs';
import { checkBuild, starterRoot } from './check-build.mjs';
import { CONFIGURATION_ABI, encodeSettlementConfiguration } from './config-codec.mjs';
import { FIXTURE, materializePlan } from './materialize-plan.mjs';
import { prepareDescriptor, readSource } from './prepare.mjs';

const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const submissionId = '00000000-0000-4000-8000-000000000053';
async function copy(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'programmable-engine-starter-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of await json(resolve(starterRoot, 'package-files.json'))) {
    await mkdir(dirname(resolve(root, path)), { recursive: true });
    await copyFile(resolve(starterRoot, path), resolve(root, path));
  }
  return root;
}
async function request(root) {
  await prepareDescriptor(root, {}, { fixture: true });
  return moduleSubmissionFromPack(await loadOpenSourcePackage(root, 'module.json'));
}

test('a copied source closure requires identity and prepares with the standalone existing CLI', async (t) => {
  const root = await copy(t);
  await assert.rejects(prepareDescriptor(root), /wallet/);
  const prepared = await prepareDescriptor(root, {}, { fixture: true });
  assert.equal(prepared.fixtureOnly, true);
  assert.equal(prepared.authorAuthenticated, false);
  const cli = resolve(root, 'standalone-module-cli.mjs');
  await copyFile(resolve(starterRoot, '../../../../public/developers/module-mode-cli/v1.0.0-development.4/programmable-module-mode-1.0.0-development.4.mjs'), cli);
  execFileSync(process.execPath, [cli, 'prepare-module-submission', '--root', root, '--package', 'module.json', '--out', 'submission.json'],
    { cwd: root, timeout: 10000, env: { NODE_PATH: '', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const value = await json(resolve(root, 'submission.json'));
  const checked = validateModuleSubmissionRequest(value);
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  assert.equal(checked.reviewStatus, 'unreviewed');
  for (const flag of ['authorAuthenticated', 'buildVerified', 'runtimeVerified', 'onchainApproved', 'available']) assert.equal(checked[flag], false);
  assert.equal(checked.totalSourceBytes, value.files.reduce((sum, file) => sum + Buffer.from(file.bytes, 'base64').length, 0));
  assert.equal(value.descriptor.components[0].runtime, 'programmable.module-engine-solidity@1');
});

test('free quotes share a package while fixed quotes bind a new revision of the same family', async (t) => {
  const root = await copy(t), freeRequest = await request(root);
  const free = validateModuleSubmissionRequest(freeRequest);
  const schema = freeRequest.descriptor.configuration;
  const first = encodeSettlementConfiguration(schema, { quoteAsset: FIXTURE.firstQuote });
  const second = encodeSettlementConfiguration(schema, { quoteAsset: FIXTURE.secondQuote });
  assert.notEqual(first.configHash, second.configHash);
  assert.deepEqual(decodeAbiParameters(CONFIGURATION_ABI, first.encoded), [FIXTURE.firstQuote, 60n, 2592000n]);
  assert.equal(validateOpenPackage(freeRequest.descriptor).packageId, free.packageId);
  const fixedSchema = structuredClone(schema);
  fixedSchema.fields.quoteAsset.binding = { mode: 'fixed', value: FIXTURE.firstQuote };
  await writeFile(resolve(root, 'config.schema.json'), `${JSON.stringify(fixedSchema, null, 2)}\n`);
  const template = await json(resolve(root, 'module.template.json'));
  template.version = '0.1.0-development.2';
  await writeFile(resolve(root, 'module.template.json'), `${JSON.stringify(template, null, 2)}\n`);
  const fixedRequest = await request(root), fixed = validateModuleSubmissionRequest(fixedRequest);
  assert.equal(fixed.ok, true, JSON.stringify(fixed.errors));
  assert.notEqual(fixed.packageId, free.packageId);
  assert.equal(fixed.familyId, free.familyId);
  assert.equal(encodeSettlementConfiguration(fixedSchema, {}).encoded, first.encoded);
  assert.throws(() => encodeSettlementConfiguration(fixedSchema, { quoteAsset: FIXTURE.secondQuote }), { code: 'OPEN_CONFIG_FIXED_OVERRIDE' });
  const artifact = await json(resolve(starterRoot, 'out/QuoteBoundSettlementV1.sol/QuoteBoundSettlementV1.json'));
  const { plan } = materializePlan(fixedRequest, artifact, submissionId);
  assert.equal(plan.cases.filter((entry) => entry.expectedDeployment === 'success').length, 1);
  assert.equal(plan.cases.find((entry) => entry.id === 'reject-context-quote-mismatch').quoteAsset, FIXTURE.secondQuote);
});

test('operator vectors derive identities from the actual compiler and exact source request', async (t) => {
  const root = await copy(t), first = await request(root);
  const { artifact } = await checkBuild();
  const a = materializePlan(first, artifact, submissionId);
  assert.equal(a.plan.cases.filter((entry) => entry.expectedDeployment === 'success').length, 2);
  assert.equal(a.plan.configurationCodec, 'programmable.engine-abi@1');
  assert.deepEqual(a.plan.immutableBindings, []);
  assert.equal(a.plan.coinRights, 0);
  assert.equal(a.plan.cases[0].operations.find((entry) => entry.id === 'refund-original-payer').timestamp, FIXTURE.refundAfter);
  await writeFile(resolve(root, 'README.md'), `${await readFile(resolve(root, 'README.md'), 'utf8')}\nSource revision fixture.\n`);
  const b = materializePlan(await request(root), artifact, submissionId);
  assert.notEqual(a.requestDigest, b.requestDigest);
  assert.notEqual(a.plan.cases[0].operations[0].expectedResult, b.plan.cases[0].operations[0].expectedResult);
  await writeFile(resolve(root, 'src/QuoteBoundSettlementV1.sol'), `${await readFile(resolve(root, 'src/QuoteBoundSettlementV1.sol'), 'utf8')}\n// Edited source requires rebuild.\n`);
  const editedRequest = await request(root);
  assert.throws(() => materializePlan(editedRequest, artifact, submissionId), /Compiler\/source mismatch/);
});

test('source hashes, pins and symlink boundaries fail closed', async (t) => {
  const root = await copy(t), value = await request(root);
  value.files[0].bytes = Buffer.from('tampered').toString('base64');
  assert.equal(validateModuleSubmissionRequest(value).ok, false);
  for (const pin of (await json(resolve(root, 'SOURCE-PINS.json'))).files) {
    assert.match(pin.revision, /^[0-9a-f]{40}$/u);
    assert.equal(createHash('sha256').update(await readSource(root, pin.path)).digest('hex'), pin.sha256);
  }
  await symlink(resolve(root, 'README.md'), resolve(root, 'linked.md'));
  await assert.rejects(readSource(root, 'linked.md'), /Symlink/);
  await assert.rejects(readSource(root, '../README.md'), /below/);
});
