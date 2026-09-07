import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { keccak256, toHex } from 'viem';
import { ARTIFACTS, digest, need, sha256 } from '../module-mode/core.mjs';
import { REPOSITORY_ROOT, sealBuild } from '../module-mode/build.mjs';
import { REUSED_ROLES } from './core.mjs';

const exec = promisify(execFile);

export const NATIVE_V2_ARTIFACTS = Object.freeze({ ...ARTIFACTS,
  registry: 'ModuleNativeRegistryV2.sol/ModuleNativeRegistryV2.json',
  swapRouterFactory: 'ModuleNativeSwapRouterFactoryV2.sol/ModuleNativeSwapRouterFactoryV2.json',
  hook: 'ModuleNativeHookV2.sol/ModuleNativeHookV2.json', launcher: 'ModuleNativeLaunchV2.sol/ModuleNativeLaunchV2.json',
  rewardLedger: 'ClassicModuleFeeLedgerV2.sol/ClassicModuleFeeLedgerV2.json',
  swapRouter: 'ModuleNativeSwapRouterV2.sol/ModuleNativeSwapRouterV2.json',
});

/** Same source/dependency/compiler seal as V1; only the immutable source generation is selected here. */
export async function sealNativeV2Build(options = {}) {
  const root = options.root ?? REPOSITORY_ROOT;
  const build = await sealBuild({ ...options, root, output: options.output ?? path.join(root, 'contracts/out/module-native-v2-deployment/build'),
    sourcePaths: ['src/module-mode/engine/ModuleNativeLaunchV2.sol', 'src/module-mode/modules/EveryNthBuyRewardV1.sol', 'src/module-mode/modules/TimedWalletBuyCapV1.sol'],
    artifactPaths: NATIVE_V2_ARTIFACTS });
  return bindReusedSourceClosure(build, root);
}

/** Same deployed runtime is necessary but insufficient: retain the actual published V1 source bytes as well. */
export async function bindReusedSourceClosure(build, root = REPOSITORY_ROOT) {
  const previous = JSON.parse(await readFile(path.join(root, 'config/module-mode/robinhood.preview.json'), 'utf8'));
  need(previous.sourceVersion === 'module-native-v1' && /^[a-f0-9]{40}$/.test(previous.sourceCommit), 'Historical V1 source commit required');
  const oldFile = async file => (await exec('git', ['show', `${previous.sourceCommit}:${file}`], { cwd: root, maxBuffer: 8 * 1024 * 1024 })).stdout;
  const oldPins = await oldFile('contracts/dependencies/source-pins.json');
  need(sha256(oldPins) === build.commitments.sourcePinsDigest, 'Reused dependency source pins differ from V1');
  const checked = new Map(), roles = {};
  for (const role of REUSED_ROLES) {
    roles[role] = {};
    for (const [file, source] of Object.entries(build.standardInputs[role].sources)) {
      const sourceHash = keccak256(toHex(source.content));
      if (file.startsWith('src/') && !checked.has(file)) {
        need(keccak256(toHex(await oldFile(`contracts/${file}`))) === sourceHash, `${role}: reused first-party source differs from published V1: ${file}`);
        checked.set(file, sourceHash);
      }
      roles[role][file] = sourceHash;
    }
  }
  const reuseSourceProvenance = { previousReleaseDigest: previous.releaseDigest, previousSourceCommit: previous.sourceCommit,
    dependencySourcePinsDigest: build.commitments.sourcePinsDigest, roles };
  return { ...build, reuseSourceProvenance, reuseSourceDigest: digest('programmable.module-mode-native-v2-reused-source.v1', reuseSourceProvenance) };
}
