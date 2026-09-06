import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { keccak256, toHex } from 'viem';
import { canonicalJson, need } from './core.mjs';
import { exactJson, SOURCIFY_COMPILER } from './source-readback.mjs';

const exec = promisify(execFile);

/** Reproduce the provider's complete source/settings with the pinned compiler and no filesystem imports. */
export async function recompileSourcifyInput(value, expectedInput, environment = process.env) {
  need(value.compilation?.compilerVersion === SOURCIFY_COMPILER && value.stdJsonInput?.language === 'Solidity', 'Pinned Solidity compiler required');
  need(canonicalJson(value.sources) === canonicalJson(expectedInput.sources)
    && canonicalJson(value.stdJsonInput.sources) === canonicalJson(expectedInput.sources), 'Recompilation source closure differs');
  const binary = environment.MODULE_MODE_SOLC ?? 'solc';
  const { stdout: version } = await exec(binary, ['--version'], { timeout: 10000, maxBuffer: 4096 });
  need(version.includes(`Version: ${SOURCIFY_COMPILER}`), 'Pinned solc 0.8.26 required; set MODULE_MODE_SOLC');
  const input = { ...value.stdJsonInput, settings: { ...value.stdJsonInput.settings,
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode'] } } } };
  const encoded = JSON.stringify(input); need(Buffer.byteLength(encoded) <= 16 * 1024 * 1024, 'Recompilation input too large');
  const output = await new Promise((resolve, reject) => {
    const child = execFile(binary, ['--standard-json', '--no-import-callback'],
      { timeout: 45000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8', env: { PATH: environment.PATH ?? '' } },
      (error, stdout) => error ? reject(new Error('Pinned source recompilation failed')) : resolve(stdout));
    child.stdin.on('error', () => {}); child.stdin.end(encoded);
  });
  const result = exactJson(Buffer.from(output), 'Local compiler output');
  need(!(result.errors ?? []).some(error => error.severity === 'error'), 'Published compiler input does not compile');
  const separator = value.compilation.fullyQualifiedName.lastIndexOf(':');
  const file = value.compilation.fullyQualifiedName.slice(0, separator), name = value.compilation.fullyQualifiedName.slice(separator + 1);
  const artifact = result.contracts?.[file]?.[name]; need(artifact?.evm?.bytecode && artifact?.evm?.deployedBytecode, 'Recompiled target missing');
  return { compilerVersion: SOURCIFY_COMPILER, inputDigest: keccak256(toHex(canonicalJson(value.stdJsonInput))),
    creationBytecode: `0x${artifact.evm.bytecode.object}`, runtimeBytecode: `0x${artifact.evm.deployedBytecode.object}`, abi: artifact.abi };
}
