import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readSource } from './prepare.mjs';

export const starterRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keccak = (hex) => execFileSync('cast', ['keccak', hex], { encoding: 'utf8', timeout: 5000 }).trim();

/** A local source/build comparison only. Uploaded tools are never executed by the review worker. */
export async function checkBuild(root = starterRoot, { writeReference = false } = {}) {
  const pins = JSON.parse(await readSource(root, 'SOURCE-PINS.json'));
  for (const file of pins.files) {
    assert.equal(createHash('sha256').update(await readSource(root, file.path)).digest('hex'), file.sha256,
      `Pinned source drift: ${file.path}`);
  }
  const artifact = JSON.parse(await readSource(root, 'out/QuoteBoundSettlementV1.sol/QuoteBoundSettlementV1.json'));
  const metadata = artifact.metadata;
  assert.equal(metadata.compiler.version, '0.8.26+commit.8a97fa7a');
  assert.equal(metadata.settings.evmVersion, 'cancun');
  assert.equal(metadata.settings.viaIR, true);
  assert.deepEqual(metadata.settings.optimizer, { enabled: true, runs: 1000 });
  assert.equal(metadata.settings.metadata.bytecodeHash, 'none');
  assert.notEqual(metadata.settings.metadata.appendCBOR, false);
  assert.deepEqual(metadata.settings.libraries, {});
  assert.deepEqual(artifact.deployedBytecode.immutableReferences || {}, {});
  for (const [path, source] of Object.entries(metadata.sources)) {
    assert.equal(keccak(`0x${Buffer.from(await readSource(root, path)).toString('hex')}`), source.keccak256,
      `Stale compiler source: ${path}`);
  }
  const constructor = artifact.abi.find((entry) => entry.type === 'constructor');
  assert.deepEqual(constructor.inputs.map((entry) => entry.type), ['tuple', 'bytes']);
  assert.deepEqual(constructor.inputs[0].components.map(({ name, type }) => ({ name, type })), [
    { name: 'host', type: 'address' }, { name: 'launchId', type: 'bytes32' },
    { name: 'token', type: 'address' }, { name: 'creator', type: 'address' },
    { name: 'quoteAsset', type: 'address' }, { name: 'feeCollector', type: 'address' },
  ]);
  const build = {
    format: 'programmable.module-mode.local-build-reference.v1',
    compiler: metadata.compiler.version,
    settings: { evmVersion: 'cancun', optimizer: true, optimizerRuns: 1000, viaIR: true, bytecodeHash: 'none', appendCBOR: true },
    contracts: {
      QuoteBoundSettlementV1: {
        creationCodeHash: keccak(artifact.bytecode.object), runtimeCodeHash: keccak(artifact.deployedBytecode.object),
        runtimeBytes: (artifact.deployedBytecode.object.length - 2) / 2,
      },
    },
    deploymentEvidence: false, sourceVerificationEvidence: false,
  };
  if (writeReference) {
    const target = resolve(root, 'build-reference.json');
    try { assert.equal((await lstat(target)).isSymbolicLink(), false, 'Build reference cannot be a symlink'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await writeFile(target, `${JSON.stringify(build, null, 2)}\n`);
  }
  else assert.deepEqual(JSON.parse(await readFile(resolve(root, 'build-reference.json'), 'utf8')), build,
    'Local build reference drifted; review source/settings before regenerating');
  return { artifact, build };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--write-build-reference') || args.length > 1) throw new Error('Unknown option');
  checkBuild(starterRoot, { writeReference: args.includes('--write-build-reference') })
    .then(({ build }) => console.log(JSON.stringify(build, null, 2)))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
