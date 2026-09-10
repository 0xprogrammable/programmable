import path from 'node:path';
import { REPOSITORY_ROOT, sealBuild } from '../module-mode/build.mjs';
import { bindReusedSourceClosure } from '../module-native-v2/build.mjs';
import { ANY_QUOTE_REUSED_ROLES, ANY_QUOTE_REUSE_DOMAIN } from './any-quote-core.mjs';
export const ANY_QUOTE_ARTIFACTS = Object.freeze({
  host: 'ModuleEngineAnyQuoteHostV1.sol/ModuleEngineAnyQuoteHostV1.json', sharedHook: 'AnyQuoteSharedHookV1.sol/AnyQuoteSharedHookV1.json',
  ledger: 'AnyQuoteLedgerV1.sol/AnyQuoteLedgerV1.json', nativeRouteGuard: 'AnyQuoteNativeRouteGuardV1.sol/AnyQuoteNativeRouteGuardV1.json',
  engine: 'AnyQuoteLPModuleV1.sol/AnyQuoteLPModuleV1.json', registry: 'ModuleNativeRegistryV1.sol/ModuleNativeRegistryV1.json',
  tokenFactory: 'UERC20Factory.sol/UERC20Factory.json', token: 'UERC20.sol/UERC20.json',
  launchPolicy: 'ClassicModuleLaunchPolicyV1.sol/ClassicModuleLaunchPolicyV1.json',
});
/** Existing exact Git/source/dependency seal, same compiler and size limits; no global LP engine deployment. */
export async function sealAnyQuoteBuild(options = {}) {
  const root = options.root ?? REPOSITORY_ROOT;
  const build = await sealBuild({ ...options, root, output: options.output ?? path.join(root, 'contracts/out/module-engine-any-quote-deployment/build'),
    sourcePaths: ['src/module-engine/any-quote/ModuleEngineAnyQuoteHostV1.sol', 'src/module-engine/any-quote/AnyQuoteLPModuleV1.sol',
      'src/module-mode/engine/ModuleNativeRegistryV1.sol'], artifactPaths: ANY_QUOTE_ARTIFACTS });
  return bindReusedSourceClosure(build, root, { roles: ANY_QUOTE_REUSED_ROLES, domain: ANY_QUOTE_REUSE_DOMAIN });
}
