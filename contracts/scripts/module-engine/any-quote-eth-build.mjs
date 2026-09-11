import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { keccak256, toHex } from 'viem';
import { REPOSITORY_ROOT, sealBuild } from '../module-mode/build.mjs';
import { digest, need, sha256 } from '../module-mode/core.mjs';
import { bindReusedSourceClosure } from '../module-native-v2/build.mjs';
import { ANY_QUOTE_ARTIFACTS } from './any-quote-build.mjs';
import { ANY_QUOTE_ETH_REUSE_DOMAIN, ANY_QUOTE_ETH_GUARD_REUSE_DOMAIN } from './any-quote-eth-core.mjs';
import { anyQuoteEthBasis } from './any-quote-eth-basis.mjs';
const exec = promisify(execFile);
export const ANY_QUOTE_ETH_ARTIFACTS = Object.freeze({ ...ANY_QUOTE_ARTIFACTS,
  host: 'ModuleEngineAnyQuoteEthHostV1.sol/ModuleEngineAnyQuoteEthHostV1.json',
  sharedHook: 'AnyQuoteEthSharedHookV1.sol/AnyQuoteEthSharedHookV1.json', ledger: 'AnyQuoteEthLedgerV1.sol/AnyQuoteEthLedgerV1.json' });

/** The guard belongs to the earlier Any Quote source, independently of the three native V1 dependencies. */
export async function bindAnyQuoteEthGuardSourceClosure(build, root, guardRelease) {
  need(guardRelease?.sourceVersion === 'module-engine-any-quote-v1' && /^[a-f0-9]{40}$/.test(guardRelease.sourceCommit), 'Prior Any Quote guard source required');
  const oldFile = async file => (await exec('git', ['show', `${guardRelease.sourceCommit}:${file}`], { cwd: root, maxBuffer: 8 * 1024 * 1024 })).stdout;
  need(sha256(await oldFile('contracts/dependencies/source-pins.json')) === build.commitments.sourcePinsDigest, 'Retained guard dependency source pins differ');
  const sources = {};
  for (const [file, source] of Object.entries(build.standardInputs.nativeRouteGuard.sources)) {
    const sourceHash = keccak256(toHex(source.content));
    if (file.startsWith('src/')) need(keccak256(toHex(await oldFile(`contracts/${file}`))) === sourceHash, `Retained guard source differs: ${file}`);
    sources[file] = sourceHash;
  }
  const guardSourceProvenance = { previousReleaseDigest: guardRelease.releaseDigest, previousSourceCommit: guardRelease.sourceCommit,
    dependencySourcePinsDigest: build.commitments.sourcePinsDigest, roles: { nativeRouteGuard: sources } };
  return { ...build, guardSourceProvenance, guardSourceDigest: digest(ANY_QUOTE_ETH_GUARD_REUSE_DOMAIN, guardSourceProvenance) };
}
export async function sealAnyQuoteEthBuild(options = {}) {
  const root = options.root ?? REPOSITORY_ROOT;
  const build = await sealBuild({ ...options, root, output: options.output ?? path.join(root, 'contracts/out/module-engine-any-quote-eth-deployment/build'),
    sourcePaths: ['src/module-engine/any-quote/ModuleEngineAnyQuoteEthHostV1.sol', 'src/module-engine/any-quote/AnyQuoteEthSharedHookV1.sol',
      'src/module-mode/engine/ModuleNativeRegistryV1.sol'], artifactPaths: ANY_QUOTE_ETH_ARTIFACTS });
  const basis = await anyQuoteEthBasis(root);
  const native = await bindReusedSourceClosure(build, root, { roles: ['registry', 'tokenFactory', 'launchPolicy'], domain: ANY_QUOTE_ETH_REUSE_DOMAIN, previousRelease: basis.previousRelease });
  return bindAnyQuoteEthGuardSourceClosure(native, root, basis.guardRelease);
}
