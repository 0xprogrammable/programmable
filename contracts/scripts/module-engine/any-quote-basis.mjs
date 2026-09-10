import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TREASURY, REWARD_ADMIN, address, canonicalJson, digest, need, sha256, validateParameters } from '../module-mode/core.mjs';
import { REPOSITORY_ROOT, repositoryState } from '../module-mode/build.mjs';
import { exactJson } from '../module-mode/source-readback.mjs';
import { sharedValidators } from '../module-mode/shared.mjs';
import { engineWire } from './shared.mjs';
const exec = promisify(execFile);

/** Select only the native V1 whose retained contracts are the active Engine's actual dependencies. */
export function selectAnyQuoteNativeBasis(current, history, engine) {
  need(history?.schemaVersion === 'programmable.module-mode-historical-releases.v1' && Array.isArray(history.releases), 'Native release history required');
  const candidates = [current, ...history.releases.map(entry => entry.release)].filter(release => release?.sourceVersion === 'module-native-v1'
    && release.enabled === true && release.status === 'active'
    && ['registry', 'tokenFactory', 'launchPolicy', 'poolManager'].every(role =>
      release.contracts?.[role] && engine.contracts?.[role] && canonicalJson(release.contracts[role]) === canonicalJson(engine.contracts[role])));
  const byDigest = new Map();
  for (const release of candidates) {
    if (byDigest.has(release.releaseDigest)) need(canonicalJson(byDigest.get(release.releaseDigest)) === canonicalJson(release), 'Conflicting historical V1 release');
    else byDigest.set(release.releaseDigest, release);
  }
  need(byDigest.size === 1, 'Exactly one retained native V1 source identity must match the Engine pins');
  return [...byDigest.values()][0];
}
export async function anyQuoteBasis(root = REPOSITORY_ROOT) {
  const state = await repositoryState(root), paths = {
    current: 'config/module-mode/robinhood.preview.json', history: 'config/module-mode/historical-releases.json',
    engine: 'config/module-engine/robinhood.json', parameters: 'ops/module-mode-deployment/release-parameters.v1.json',
    economics: 'contracts/scripts/module-mode/core.mjs',
  };
  const raw = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, file]) => [name, await readFile(path.join(root, file))])));
  for (const [name, file] of Object.entries(paths)) {
    const { stdout } = await exec('git', ['show', `${state.sourceCommit}:${file}`], { cwd: root, maxBuffer: 1024 * 1024 });
    need(sha256(stdout) === sha256(raw[name]), `Historical basis differs from its Git object: ${file}`);
  }
  const engine = exactJson(raw.engine, 'Current Engine identity'), wire = await engineWire();
  need(wire.computeModuleEngineReleaseDigest(engine) === engine.releaseDigest, 'Current Engine source identity differs');
  const previousRelease = selectAnyQuoteNativeBasis(exactJson(raw.current, 'Current native identity'), exactJson(raw.history, 'Native history'), engine);
  const { computeModuleModeReleaseDigest } = await sharedValidators();
  need(computeModuleModeReleaseDigest(previousRelease) === previousRelease.releaseDigest, 'Retained historical V1 digest differs');
  const parameters = validateParameters(exactJson(raw.parameters, 'Historical V1 release parameters'));
  need(parameters.minimumInitialBuyNative === previousRelease.minimumInitialBuyNative, 'Historical V1 initial buy differs');
  const body = { schemaVersion: 'programmable.module-mode-native-v2-basis.v1', chainId: 4663, status: 'historical-config-only-quorum-refresh-required',
    provenance: { sourceCommit: state.sourceCommit, files: Object.fromEntries(Object.entries(paths).map(([name, file]) => [file, { sha256: sha256(raw[name]) }])) },
    previousRelease, deploymentOwner: address(parameters.owner), registryOwner: address(parameters.reviewAuthority),
    treasury: TREASURY, rewardAdmin: REWARD_ADMIN, minimumInitialBuyNative: parameters.minimumInitialBuyNative, chainObservation: null };
  return { ...body, basisDigest: digest(body.schemaVersion, body) };
}
export async function assertAnyQuoteBasis(basis, root = REPOSITORY_ROOT) {
  need(canonicalJson(basis) === canonicalJson(await anyQuoteBasis(root)), 'Any Quote retained source basis differs');
}
