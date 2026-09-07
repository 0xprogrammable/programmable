import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TREASURY, REWARD_ADMIN, address, canonicalJson, digest, need, sha256, validateParameters } from '../module-mode/core.mjs';
import { REPOSITORY_ROOT, repositoryState } from '../module-mode/build.mjs';
import { exactJson } from '../module-mode/source-readback.mjs';
import { sharedValidators } from '../module-mode/shared.mjs';
const exec = promisify(execFile);

export const BASIS_SCHEMA = 'programmable.module-mode-native-v2-basis.v1';
export const BASIS_PATHS = Object.freeze({ release: 'config/module-mode/robinhood.preview.json',
  parameters: 'ops/module-mode-deployment/release-parameters.v1.json', economics: 'contracts/scripts/module-mode/core.mjs' });

/** Historical, checked-in configuration is provenance; current chain authority still requires two RPC providers. */
export async function nativeV2Basis(root = REPOSITORY_ROOT) {
  const state = await repositoryState(root);
  const raw = Object.fromEntries(await Promise.all(Object.entries(BASIS_PATHS).map(async ([key, file]) => [key, await readFile(path.join(root, file))])));
  for (const [key, file] of Object.entries(BASIS_PATHS)) {
    const { stdout } = await exec('git', ['show', `${state.sourceCommit}:${file}`], { cwd: root, maxBuffer: 1024 * 1024 });
    need(sha256(stdout) === sha256(raw[key]), `Historical basis file differs from its Git object: ${file}`);
  }
  const previousRelease = exactJson(raw.release, 'Existing active V1 release');
  const parameters = validateParameters(exactJson(raw.parameters, 'Existing V1 release parameters'));
  const { computeModuleModeReleaseDigest } = await sharedValidators();
  need(previousRelease.sourceVersion === 'module-native-v1' && previousRelease.enabled === true && previousRelease.status === 'active'
    && computeModuleModeReleaseDigest(previousRelease) === previousRelease.releaseDigest, 'Existing active V1 release identity is not bound');
  need(parameters.minimumInitialBuyNative === previousRelease.minimumInitialBuyNative, 'Existing minimum initial buy differs');
  const body = { schemaVersion: BASIS_SCHEMA, chainId: 4663, status: 'historical-config-only-quorum-refresh-required',
    provenance: { sourceCommit: state.sourceCommit, files: Object.fromEntries(Object.entries(BASIS_PATHS).map(([key, file]) => [file, { sha256: sha256(raw[key]) }])) },
    previousRelease, deploymentOwner: address(parameters.owner), registryOwner: address(parameters.reviewAuthority),
    treasury: TREASURY, rewardAdmin: REWARD_ADMIN, minimumInitialBuyNative: parameters.minimumInitialBuyNative,
    chainObservation: null };
  return { ...body, basisDigest: digest(BASIS_SCHEMA, body) };
}

export async function assertNativeV2Basis(basis, root = REPOSITORY_ROOT) {
  need(canonicalJson(basis) === canonicalJson(await nativeV2Basis(root)), 'Historical basis differs from sealed repository configuration');
}
