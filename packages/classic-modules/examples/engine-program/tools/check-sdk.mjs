import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadOpenSourcePackage } from '../../../src/open-package-io.mjs';
import { moduleSubmissionFromPack, validateModuleSubmissionRequest } from '../../../src/open-transport.mjs';
import { checkBuild, starterRoot } from './check-build.mjs';
import { materializePlan } from './materialize-plan.mjs';

const descriptor = JSON.parse(await readFile(resolve(starterRoot, 'module.json'), 'utf8'));
assert.equal(descriptor.extensions['programmable.starter-identity@1'].fixtureOnly, true,
  'This local fixture helper requires an explicitly prepared --fixture descriptor');
const pack = await loadOpenSourcePackage(starterRoot, 'module.json');
const request = moduleSubmissionFromPack(pack);
const checked = validateModuleSubmissionRequest(request);
assert.equal(checked.ok, true, JSON.stringify(checked.errors));
for (const field of ['authorAuthenticated', 'buildVerified', 'runtimeVerified', 'onchainApproved', 'available']) {
  assert.equal(checked[field], false, field);
}
const { artifact, build } = await checkBuild(starterRoot);
const { plan } = materializePlan(request, artifact, '00000000-0000-4000-8000-000000000053');
await mkdir(resolve(starterRoot, 'artifacts'), { recursive: true });
for (const [name, value] of [['submission.fixture.json', request], ['review-plan.fixture.json', plan]]) {
  await writeFile(resolve(starterRoot, 'artifacts', name), `${JSON.stringify(value, null, 2)}\n`);
}
console.log(JSON.stringify({
  packageId: checked.packageId, familyId: checked.familyId, requestDigest: checked.requestDigest,
  sourceFiles: pack.files.length, sourceBytes: checked.totalSourceBytes,
  localSourceHashesVerified: true, localCompilerReferenceMatched: true, fixtureOnly: true,
  proposedCases: plan.cases.length, proposedOperations: plan.cases.reduce((sum, entry) => sum + entry.operations.length, 0),
  protectedWorkerExecuted: false, apiSubmitted: false, reviewApproved: false, registryApproved: false, available: false,
  contracts: build.contracts,
}, null, 2));
