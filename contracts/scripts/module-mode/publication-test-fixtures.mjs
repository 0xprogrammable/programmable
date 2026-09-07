// Synthetic tests only. These bytes and decisions are never deployment or review evidence.
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getCreate2Address, keccak256, toHex } from 'viem';
import { REPOSITORY_ROOT } from './build.mjs';
import { OFFICIAL, canonicalJson, sha256 } from './core.mjs';
import { publicationValidators } from './publication-shared.mjs';
let fixtureModule;
export async function publicationFixture(feeEligibility) {
  if (!fixtureModule) {
    const result = await build({ absWorkingDir: REPOSITORY_ROOT, stdin: { contents: "export { moduleReviewAdminFixture } from './tests/fixtures/module-review-admin';", resolveDir: REPOSITORY_ROOT, loader: 'ts' },
      write: false, bundle: true, platform: 'node', target: 'node24', format: 'esm', packages: 'external', treeShaking: true, tsconfig: path.join(REPOSITORY_ROOT, 'tsconfig.json'), logLevel: 'silent' });
    const directory = path.join(REPOSITORY_ROOT, 'contracts/out/module-mode-publication/test'); await mkdir(directory, { recursive: true });
    const output = result.outputFiles[0].contents, filename = path.join(directory, `${sha256(output)}-${process.pid}.mjs`); await writeFile(filename, output);
    fixtureModule = await import(pathToFileURL(filename).href);
  }
  const f = fixtureModule.moduleReviewAdminFixture(), api = await publicationValidators();
  const identity = { ...f.release, contracts: { ...f.release.contracts, poolManager: OFFICIAL.poolManager, positionManager: OFFICIAL.positionManager } };
  if (feeEligibility) Object.assign(identity, { schemaVersion: 'programmable.module-mode-source.v2', sourceVersion: 'module-native-v2', economicsPolicyId: keccak256(toHex('programmable.module-mode.native-economics.v2')) });
  identity.releaseDigest = api.computeModuleModeReleaseDigest(identity);
  const factorySalt = keccak256(toHex('synthetic-test-factory-salt'));
  const factory = getCreate2Address({ from: OFFICIAL.deterministicDeployer.address, salt: factorySalt, bytecode: f.artifact.factory.creationBytecode }).toLowerCase();
  const manifest = api.createModuleModeHostManifest({ release: identity, definition: f.definition, nativeBinding: { ...f.binding, factory, ...(feeEligibility ? { feeEligibility } : {}) }, descriptor: f.source.descriptor });
  const contents = { schemaVersion: 'programmable.modules.review-decision.v1', reviewerWallet: f.reviewer, policyDigest: f.policyDigest, subject: f.subject,
    command: { schemaVersion: 'programmable.modules.review-command.v1', submissionId: f.subject.submissionId, requestDigest: f.subject.requestDigest, expectedReviewRevision: 2,
      outcome: 'accept', reason: 'Synthetic operator test only. Never reviewer authority.', artifactDigest: f.artifact.artifactDigest,
      hostManifestHash: api.computeModuleModeHostManifestHash(manifest), acknowledgedReviewAreas: f.artifact.reviewRequired },
    decidedAt: '2026-09-06T12:00:00.000Z', registryApproved: false, available: false };
  const review = { ...contents, decisionDigest: `0x${sha256(canonicalJson({ domain: contents.schemaVersion, value: contents }))}` };
  const sourceState = { sourceClean: false, sourceCommit: 'a'.repeat(40), sourceTree: 'b'.repeat(40) };
  return { ...f, identity, owner: f.reviewer, sourceState, module: { source: f.source, manifest, review, artifact: f.artifact, factorySalt } };
}
export function launchAction(f, modules = false) {
  return { kind: 'launch', canaryKind: modules ? 'modules' : 'plain', name: 'Operator canary test', symbol: 'OPTEST', creatorSalt: keccak256(toHex('synthetic-test-canary')),
    metadata: { description: 'Synthetic transaction test', website: '', image: 'https://example.invalid/synthetic.png', extraData: '0x' }, creatorWallets: [f.owner], creatorSharesBps: [10000], creatorFeeBps: modules ? 100 : 0,
    moduleConfigurations: modules ? [{ packageId: f.artifact.packageId, config: f.artifact.cases[0].configBytes, funding: '0' }] : [], initialBuyNative: '400000000000000', minimumTokenOut: '1000', deadline: String(Math.floor(Date.now() / 1000) + 600) };
}
