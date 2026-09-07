import path from 'node:path';
import { REPOSITORY_ROOT, sealBuild } from '../module-mode/build.mjs';
import { bindReusedSourceClosure } from '../module-native-v2/build.mjs';
import { ENGINE_REUSED_ROLES, ENGINE_REUSE_DOMAIN } from './core.mjs';
export const ENGINE_ARTIFACTS = Object.freeze({ host: 'ModuleEngineHostV1.sol/ModuleEngineHostV1.json',
  ledger: 'ClassicModuleFeeLedgerV2.sol/ClassicModuleFeeLedgerV2.json', registry: 'ModuleNativeRegistryV1.sol/ModuleNativeRegistryV1.json',
  tokenFactory: 'UERC20Factory.sol/UERC20Factory.json', token: 'UERC20.sol/UERC20.json',
  launchPolicy: 'ClassicModuleLaunchPolicyV1.sol/ClassicModuleLaunchPolicyV1.json' });

/** No new compiler configuration or dependency installation path. The shared sealer's defaults remain native V1. */
export async function sealEngineBuild(options = {}) {
  const root = options.root ?? REPOSITORY_ROOT;
  const build = await sealBuild({ ...options, root, output: options.output ?? path.join(root, 'contracts/out/module-engine-deployment/build'),
    sourcePaths: ['src/module-engine/ModuleEngineHostV1.sol', 'src/module-mode/engine/ModuleNativeRegistryV1.sol'], artifactPaths: ENGINE_ARTIFACTS });
  return bindReusedSourceClosure(build, root, { roles: ENGINE_REUSED_ROLES, domain: ENGINE_REUSE_DOMAIN });
}
