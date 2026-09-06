import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256 } from 'viem';
import { validateOpenPackage } from '../../../src/open-packages.mjs';
import { loadOpenSourcePackage } from '../../../src/open-package-io.mjs';
import { moduleSubmissionFromPack, validateModuleSubmissionRequest } from '../../../src/open-transport.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'));

const descriptor = await json('module.json');
const descriptorResult = validateOpenPackage(descriptor);
assert.equal(descriptorResult.ok, true, JSON.stringify(descriptorResult.errors));
const pack = await loadOpenSourcePackage(root, 'module.json');
const request = moduleSubmissionFromPack(pack);
const checked = validateModuleSubmissionRequest(request);
assert.equal(checked.ok, true, JSON.stringify(checked.errors));
assert.equal(checked.authorAuthenticated, false);
assert.equal(checked.buildVerified, false);
assert.equal(checked.runtimeVerified, false);
assert.equal(checked.onchainApproved, false);
assert.equal(checked.available, false);

const contracts = {};
for (const name of ['EveryNthBuyRewardV1', 'EveryNthBuyRewardFactoryV1']) {
  const artifact = await json(`out/EveryNthBuyRewardV1.sol/${name}.json`);
  assert.equal(artifact.metadata.compiler.version, '0.8.26+commit.8a97fa7a');
  assert.deepEqual(artifact.metadata.settings.optimizer, { enabled: true, runs: 1000 });
  assert.deepEqual(artifact.metadata.settings.metadata, { bytecodeHash: 'none', appendCBOR: false });
  assert.equal(artifact.metadata.settings.evmVersion, 'cancun');
  assert.deepEqual(artifact.metadata.settings.libraries, {});
  assert.equal(Object.keys(artifact.deployedBytecode.immutableReferences || {}).length, 0);
  for (const [path, source] of Object.entries(artifact.metadata.sources)) {
    assert.equal(keccak256(await readFile(resolve(root, path))), source.keccak256, `Stale build source: ${path}`);
  }
  contracts[name] = {
    creationCodeHash: keccak256(artifact.bytecode.object),
    runtimeCodeHash: keccak256(artifact.deployedBytecode.object),
    runtimeBytes: (artifact.deployedBytecode.object.length - 2) / 2,
  };
}
const build = {
  format: 'programmable.module-mode.local-build-reference.v1',
  compiler: '0.8.26+commit.8a97fa7a',
  settings: { evmVersion: 'cancun', optimizer: true, optimizerRuns: 1000, bytecodeHash: 'none', appendCBOR: false },
  contracts,
  deploymentEvidence: false,
  sourceVerificationEvidence: false,
};
if (process.argv.slice(2).includes('--write-build-reference')) {
  await writeFile(resolve(root, 'build-reference.json'), `${JSON.stringify(build, null, 2)}\n`);
} else {
  assert.deepEqual(await json('build-reference.json'), build, 'Build reference drifted; review source/settings before regenerating');
}
await mkdir(resolve(root, 'artifacts'), { recursive: true });
await writeFile(resolve(root, 'artifacts/source-pack.fixture.json'), `${JSON.stringify(pack, null, 2)}\n`);
await writeFile(resolve(root, 'artifacts/submission.fixture.json'), `${JSON.stringify(request, null, 2)}\n`);
console.log(JSON.stringify({
  packageId: checked.packageId, familyId: checked.familyId, requestDigest: checked.requestDigest,
  sourceFiles: pack.files.length, sourceBytes: checked.totalSourceBytes,
  sourceBytesVerified: true, localCompilerOutputMatchesReference: true,
  fixtureOnly: descriptor.extensions['programmable.starter-identity@1'].fixtureOnly,
  authorAuthenticated: false, reviewStatus: 'unreviewed', onchainApproved: false, available: false,
  contracts,
}, null, 2));
