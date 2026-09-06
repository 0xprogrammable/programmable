import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, realpath, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256, toHex } from 'viem';
import { ARTIFACTS, digest, need, sha256 } from './core.mjs';

const exec = promisify(execFile);
export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export async function git(root, args) { const { stdout } = await exec('git', args, { cwd: root, maxBuffer: 8 * 1024 * 1024 }); return stdout.trim(); }
export async function repositoryState(root = REPOSITORY_ROOT) {
  const [sourceCommit, sourceTree, branch, remote, status] = await Promise.all([
    git(root, ['rev-parse', 'HEAD']), git(root, ['rev-parse', 'HEAD^{tree}']), git(root, ['branch', '--show-current']),
    git(root, ['remote', 'get-url', 'origin']), git(root, ['status', '--porcelain=v1', '--untracked-files=all']),
  ]);
  need(['https://github.com/programmablehq/PROGRAMMABLE.git', 'git@github.com:programmablehq/PROGRAMMABLE.git'].includes(remote), 'Unexpected canonical repository');
  return { sourceCommit, sourceTree, branch, sourceClean: status === '' };
}
function controlledEnvironment(environment) {
  for (const key of Object.keys(environment)) need(!/^(FOUNDRY_|DAPP_|SOLC_|REMAPPINGS$)/.test(key), `Inherited compiler override forbidden: ${key}`);
  const env = Object.fromEntries(['PATH', 'HOME', 'USER', 'TMPDIR', 'LANG', 'LC_ALL', 'NO_COLOR'].filter(key => environment[key] !== undefined).map(key => [key, environment[key]]));
  return { ...env, FOUNDRY_AUTO_DETECT_REMAPPINGS: 'false', FOUNDRY_TEST: 'out/module-mode-deployment/unused-test', FOUNDRY_SCRIPT: 'out/module-mode-deployment/unused-script' };
}
function walk(node, fn) {
  if (!node || typeof node !== 'object') return;
  fn(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(item => walk(item, fn));
    else if (typeof value === 'object') walk(value, fn);
  }
}

/** Always builds afresh. Candidate mode is explicitly unusable by the wallet operator. */
export async function sealBuild({ root = REPOSITORY_ROOT, output = path.join(root, 'contracts/out/module-mode-deployment/build'), candidate = false, environment = process.env } = {}) {
  const before = await repositoryState(root);
  need(candidate || before.sourceClean, 'Clean reviewed source is required; --candidate emits unusable preparation only');
  const contractsRoot = path.join(root, 'contracts'); await mkdir(output, { recursive: true });
  const sources = ['src/module-mode/engine/ModuleNativeLaunchV1.sol', 'src/module-mode/modules/EveryNthBuyRewardV1.sol', 'src/module-mode/modules/TimedWalletBuyCapV1.sol'];
  const forge = environment.MODULE_MODE_FORGE ?? 'forge';
  const version = (await exec(forge, ['--version'], { maxBuffer: 4096 })).stdout;
  need(version.includes('Version: 1.7.1') && version.includes('4072e48705af9d93e3c0f6e29e93b5e9a40caed8'), 'Pinned Foundry v1.7.1 is required; set MODULE_MODE_FORGE to its executable');
  await exec(forge, ['build', '--force', '--offline', '--use', '0.8.26', '--evm-version', 'cancun', '--optimize', 'true', '--optimizer-runs', '1000', '--no-metadata', '--ast', '--build-info',
    '--root', contractsRoot, '--config-path', path.join(contractsRoot, 'foundry.toml'), '--out', output, '--cache-path', path.join(output, 'cache'), '--build-info-path', path.join(output, 'build-info'), ...sources],
  { cwd: contractsRoot, env: controlledEnvironment(environment), maxBuffer: 16 * 1024 * 1024 });
  const astNames = new Map();
  // AST ids are build-local. Resolve the exact compiled variable names, never hardcode numeric ids.
  for (const directory of await readdir(output, { withFileTypes: true })) {
    if (!directory.isDirectory() || !directory.name.endsWith('.sol')) continue;
    for (const file of await readdir(path.join(output, directory.name))) {
      if (!file.endsWith('.json')) continue;
      const artifact = JSON.parse(await readFile(path.join(output, directory.name, file), 'utf8'));
      walk(artifact.ast, node => { if (node.nodeType === 'VariableDeclaration' && node.mutability === 'immutable') {
        const previous = astNames.get(String(node.id)); need(previous === undefined || previous === node.name, 'Ambiguous immutable AST id'); astNames.set(String(node.id), node.name);
      } });
    }
  }
  const artifacts = {}, sourceHashes = new Map(), standardInputs = {}, compilerMetadata = {};
  for (const [role, relative] of Object.entries(ARTIFACTS)) {
    const artifact = JSON.parse(await readFile(path.join(output, relative), 'utf8'));
    const metadata = typeof artifact.metadata === 'string' ? JSON.parse(artifact.metadata) : artifact.metadata;
    // Foundry's typed metadata drops some NatSpec fields and normalizes remappings.
    // Keep the compiler's complete JSON separately: existing plan/build commitments remain unchanged.
    need(typeof artifact.rawMetadata === 'string', `${role}: complete compiler metadata missing`);
    compilerMetadata[role] = JSON.parse(artifact.rawMetadata);
    need(metadata?.compiler?.version === '0.8.26+commit.8a97fa7a' && metadata.settings.optimizer.enabled === true
      && metadata.settings.optimizer.runs === 1000 && metadata.settings.evmVersion === 'cancun'
      && metadata.settings.metadata.bytecodeHash === 'none' && metadata.settings.metadata.appendCBOR === false
      && !metadata.settings.viaIR && Object.keys(metadata.settings.libraries ?? {}).length === 0, `${role}: compiler configuration differs`);
    need(Object.keys(artifact.bytecode.linkReferences ?? {}).length === 0 && Object.keys(artifact.deployedBytecode.linkReferences ?? {}).length === 0, `${role}: unresolved libraries`);
    const immutableNames = Object.fromEntries(Object.keys(artifact.deployedBytecode.immutableReferences ?? {}).map(id => { need(astNames.has(id), `${role}: unknown immutable ${id}`); return [id, astNames.get(id)]; }));
    artifacts[role] = { abi: artifact.abi, bytecode: artifact.bytecode, deployedBytecode: artifact.deployedBytecode, immutableNames, metadata, compilationTarget: metadata.settings.compilationTarget };
    const standardSources = {};
    for (const [sourcePath, source] of Object.entries(metadata.sources)) {
      need(/^(?:src|lib\/[a-z0-9-]+)\/[A-Za-z0-9_./-]+\.sol$/.test(sourcePath) && !sourcePath.split('/').includes('..'), 'Invalid compiler source path');
      const content = await readFile(path.join(contractsRoot, sourcePath), 'utf8');
      need(keccak256(toHex(content)) === source.keccak256, `${sourcePath}: source changed since compilation`);
      need(!sourceHashes.has(sourcePath) || sourceHashes.get(sourcePath) === source.keccak256, 'Inconsistent source closure');
      sourceHashes.set(sourcePath, source.keccak256); standardSources[sourcePath] = { content };
    }
    const settings = Object.fromEntries(Object.entries(metadata.settings).filter(([key]) => key !== 'compilationTarget'));
    standardInputs[role] = { language: 'Solidity', sources: standardSources, settings: { ...settings, outputSelection: { '*': { '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode'] } } } };
  }
  const sourcePinsText = await readFile(path.join(contractsRoot, 'dependencies/source-pins.json'), 'utf8');
  const sourcePins = JSON.parse(sourcePinsText); const roots = [...new Set([...sourceHashes.keys()].filter(p => p.startsWith('lib/')).map(p => p.split('/')[1]))];
  const dependencyStates = {};
  for (const dependency of roots) {
    const dependencyRoot = await realpath(path.join(contractsRoot, 'lib', dependency));
    const [top, commit, remote, status] = await Promise.all([git(dependencyRoot, ['rev-parse', '--show-toplevel']), git(dependencyRoot, ['rev-parse', 'HEAD']), git(dependencyRoot, ['remote', 'get-url', 'origin']), git(dependencyRoot, ['status', '--porcelain=v1', '--untracked-files=all'])]);
    need(await realpath(top) === dependencyRoot && status === '', `${dependency}: dependency checkout is not isolated and clean`);
    need(sourcePins.dependencies.some(pin => pin.commit === commit && pin.repository === remote), `${dependency}: source pin mismatch`);
    dependencyStates[dependency] = { commit, repository: remote };
  }
  // Git object bytes, not merely a clean flag, bind every compiled first-party and dependency source.
  for (const [sourcePath, sourceHash] of sourceHashes) {
    let cwd = root, revision = before.sourceCommit, relative = `contracts/${sourcePath}`;
    if (sourcePath.startsWith('lib/')) { const [, dependency, ...tail] = sourcePath.split('/'); cwd = await realpath(path.join(contractsRoot, 'lib', dependency)); revision = dependencyStates[dependency].commit; relative = tail.join('/'); }
    const { stdout } = await exec('git', ['show', `${revision}:${relative}`], { cwd, maxBuffer: 8 * 1024 * 1024 });
    need(keccak256(toHex(stdout)) === sourceHash, `${sourcePath}: compiled bytes do not match the sealed Git object`);
  }
  const after = await repositoryState(root);
  need(before.sourceCommit === after.sourceCommit && before.sourceTree === after.sourceTree && (candidate || after.sourceClean), 'Repository changed during sealing');
  const commitments = { sourceCommit: before.sourceCommit, sourceTree: before.sourceTree, compiler: '0.8.26+commit.8a97fa7a', forge: '1.7.1+4072e48705af9d93e3c0f6e29e93b5e9a40caed8',
    sourcePinsDigest: sha256(sourcePinsText), sources: Object.fromEntries([...sourceHashes].sort()), dependencies: dependencyStates,
    artifacts: Object.fromEntries(Object.entries(artifacts).map(([role, a]) => [role, digest('programmable.module-mode-build-artifact.v1', a)])) };
  return { ...before, sourceClean: before.sourceClean && !candidate, buildDigest: digest('programmable.module-mode-build.v1', commitments), commitments, artifacts, standardInputs, compilerMetadata };
}
