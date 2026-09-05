import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, toHex } from 'viem';
import { build, plan, addr } from './test-fixtures.mjs';
import { constructorArguments, sourceCreation, sourcifyVerificationRequests, validatePublishedSource } from './evidence.mjs';
import { exactJson, boundedPublicJson, sourcifyPreflight, validateSourcifySource } from './source-readback.mjs';

const txHash = keccak256(toHex('test-only-never-live-transaction'));
function context(role = 'positionForwarderFactory') {
  const sourceBuild = structuredClone(build), artifact = sourceBuild.artifacts[role], args = constructorArguments(plan, role);
  artifact.metadata = { compiler: { version: '0.8.26+commit.8a97fa7a' }, settings: { compilationTarget: artifact.compilationTarget } };
  const sources = { [`src/${role}.sol`]: { content: '// synthetic unit fixture, not deployed\n' } };
  const settings = { optimizer: { enabled: true, runs: 1000 }, evmVersion: 'cancun', metadata: { appendCBOR: false, bytecodeHash: 'none' }, libraries: {}, remappings: [] };
  sourceBuild.standardInputs = { [role]: { language: 'Solidity', sources, settings: { ...settings, outputSelection: { '*': { '*': ['abi'] } } } } };
  const creation = { transactionHash: txHash, blockNumber: '123', transactionIndex: '2', deployer: plan.official.deterministicDeployer.address };
  const refs = artifact.deployedBytecode.immutableReferences;
  const transforms = Object.entries(refs).flatMap(([id, list]) => list.map(ref => ({ id, type: 'replace', offset: ref.start, reason: 'immutable' })));
  const immutables = Object.fromEntries(Object.entries(refs).map(([id, [ref]]) => [id, `0x${plan.contracts[role].runtime.slice(2 + ref.start * 2, 2 + (ref.start + ref.length) * 2)}`]));
  const value = { chainId: '4663', address: plan.contracts[role].address, match: 'match', creationMatch: 'match', runtimeMatch: 'match', matchId: '12', verifiedAt: '2026-09-06T12:00:00Z',
    compilation: { language: 'Solidity', compiler: 'solc', compilerVersion: '0.8.26+commit.8a97fa7a', compilerSettings: settings, name: role, fullyQualifiedName: `src/${role}.sol:${role}` },
    stdJsonInput: { language: 'Solidity', sources, settings }, sources, metadata: artifact.metadata, abi: artifact.abi, deployment: creation,
    creationBytecode: { recompiledBytecode: artifact.bytecode.object, onchainBytecode: `${artifact.bytecode.object}${args.slice(2)}`, cborAuxdata: {}, linkReferences: {},
      transformations: args === '0x' ? [] : [{ type: 'insert', offset: (artifact.bytecode.object.length - 2) / 2, reason: 'constructorArguments' }], transformationValues: args === '0x' ? {} : { constructorArguments: args } },
    runtimeBytecode: { recompiledBytecode: artifact.deployedBytecode.object, onchainBytecode: plan.contracts[role].runtime, cborAuxdata: {}, linkReferences: {}, immutableReferences: refs,
      transformations: transforms, transformationValues: transforms.length ? { immutables } : {} } };
  return { expected: { plan, build: sourceBuild, role, constructorArguments: args, creation }, value };
}
test('Sourcify binds all bytes while honestly retaining the no-CBOR provider match', () => {
  for (const role of ['positionForwarderFactory', 'tokenFactory']) {
    const { expected, value } = context(role); const result = validateSourcifySource(expected, value);
    assert.equal(result.providerClassification, 'NO_CBOR_PROVIDER_MATCH'); assert.equal(result.providerMatch, 'match');
    assert.equal(result.independentByteComparison, 'exact-complete-creation-and-runtime');
    assert.equal(result.creationTransactionHash, txHash); assert.equal(result.runtimeCodeHash, plan.contracts[role].runtimeCodeHash);
    if (role === 'positionForwarderFactory') {
      const relabelled = structuredClone(value), runtime = relabelled.runtimeBytecode;
      runtime.immutableReferences['999'] = runtime.immutableReferences['0']; delete runtime.immutableReferences['0'];
      runtime.transformationValues.immutables['999'] = runtime.transformationValues.immutables['0']; delete runtime.transformationValues.immutables['0'];
      for (const transform of runtime.transformations) transform.id = '999';
      assert.equal(validateSourcifySource(expected, relabelled).runtimeCodeHash, result.runtimeCodeHash, 'AST ids may differ across compilation source sets, exact offsets and bytes may not');
    }
  }
});
test('provider flags, partial matches and metadata-ignore transformations cannot replace exact proof', () => {
  const { expected, value } = context();
  const mutations = [
    v => { v.creationMatch = null; }, v => { v.runtimeMatch = 'partial'; }, v => { v.match = 'exact_match'; },
    v => { v.creationBytecode.onchainBytecode += '00'; }, v => { v.runtimeBytecode.onchainBytecode += '00'; },
    v => { v.creationBytecode.recompiledBytecode += '00'; }, v => { v.runtimeBytecode.recompiledBytecode += '00'; },
    v => { v.creationBytecode.transformations[0].offset--; }, v => { v.runtimeBytecode.transformations[0].reason = 'cborAuxdata'; },
    v => { v.runtimeBytecode.cborAuxdata = { ignored: '0x00' }; }, v => { v.runtimeBytecode.linkReferences = { x: {} }; },
    v => { v.runtimeBytecode.immutableReferences['0'][0].length = 31; }, v => { v.runtimeBytecode.transformationValues.immutables['0'] = `0x${'ff'.repeat(32)}`; },
    v => { v.metadata.settings.compilationTarget = {}; }, v => { v.sources['src/positionForwarderFactory.sol'].content += ' '; },
    v => { v.compilation.compilerSettings.optimizer.runs++; }, v => { v.compilation.compilerVersion = '0.8.27'; },
    v => { v.deployment.transactionHash = keccak256(toHex('another-tx')); }, v => { v.deployment.blockNumber = '124'; },
    v => { v.deployment.deployer = addr(444); }, v => { v.chainId = '1'; }, v => { v.address = addr(555); }, v => { v.abi = []; },
  ];
  for (const mutate of mutations) { const changed = structuredClone(value); mutate(changed); assert.throws(() => validateSourcifySource(expected, changed), undefined, mutate.toString()); }
});
test('strict source response reader rejects duplicate keys, invalid UTF8, redirects/errors and unbounded bodies', async () => {
  assert.throws(() => exactJson(Buffer.from('{"chainId":4663,"chainId":1}'), 'test'), /Duplicate/);
  assert.throws(() => exactJson(Buffer.from([0xff]), 'test'), /UTF-8|UTF8/i);
  await assert.rejects(boundedPublicJson('https://sourcify.dev/server/test', async () => new Response('challenge', { status: 403 })), /HTTP 403/);
  await assert.rejects(boundedPublicJson('https://sourcify.dev/server/test', async () => new Response('{"x":123}', { headers: { 'content-type': 'application/json' } }), 2), /too large/);
});
test('Sourcify API and chain support are checked separately from verification', async () => {
  const api = { info: { version: '2.1.0' }, paths: { '/v2/verify/{chainId}/{address}': { post: { responses: { 202: {} } } }, '/v2/contract/{chainId}/{address}': { get: { responses: { 200: {} } } } } };
  let supported = true;
  const fetchImpl = async url => new Response(JSON.stringify(url.endsWith('/chains') ? [{ chainId: 4663, name: 'Robinhood Chain', supported }] : api), { headers: { 'content-type': 'application/json' } });
  assert.equal((await sourcifyPreflight(fetchImpl)).provider, 'sourcify-v2'); supported = false;
  await assert.rejects(sourcifyPreflight(fetchImpl), /support unavailable/);
});
test('source requests require actual parent transaction evidence, including child deployment pins', () => {
  const sourceBuild = { ...build, standardInputs: Object.fromEntries(Object.keys(build.artifacts).map(role => [role, { language: 'Solidity', sources: {}, settings: {} }])) };
  const before = sourcifyVerificationRequests(plan, sourceBuild); assert.equal(before.runtime.status, 'incomplete-actual-creation-transaction-required');
  assert.equal(Object.hasOwn(before.runtime.body, 'creationTransactionHash'), false);
  const evidence = { schemaVersion: 'programmable.module-mode-deployment-evidence.v1', chainId: 4663, sourceCommit: plan.sourceCommit, planDigest: plan.planDigest,
    buildDigest: plan.buildDigest, status: 'included-code-verified', records: plan.steps.map(step => ({ role: step.role, status: 'included-code-verified-unfinalized',
      transaction: { hash: txHash }, receipt: { status: '0x1', transactionHash: txHash, blockNumber: '0x7b', transactionIndex: '0x2' },
      contracts: Object.fromEntries(step.expectedRoles.map(role => [role, structuredClone(plan.contracts[role])])) })) };
  const requests = sourcifyVerificationRequests(plan, sourceBuild, evidence);
  assert.equal(requests.runtime.body.creationTransactionHash, txHash);
  assert.equal(sourceCreation(plan, 'runtime', evidence).deployer, plan.contracts.runtimeFactory.address);
  assert.equal(sourceCreation(plan, 'budgetVault', evidence).deployer, plan.contracts.runtime.address);
  assert.equal(sourceCreation(plan, 'rewardLedger', evidence).deployer, plan.contracts.hook.address);
  evidence.records[8].contracts.runtime.runtimeCodeHash = keccak256(toHex('wrong'));
  assert.throws(() => sourceCreation(plan, 'runtime', evidence), /code\/receipt/);
});
test('Blockscout full flag alone never accepts absent creation bytes or incomplete source', () => {
  const { expected } = context();
  const v = { is_verified: true, is_fully_verified: true, is_partially_verified: false, is_changed_bytecode: false,
    compiler_version: 'v0.8.26+commit.8a97fa7a', optimization_enabled: true, optimizations_runs: 1000, evm_version: 'cancun',
    name: expected.role, file_path: `src/${expected.role}.sol`, deployed_bytecode: plan.contracts[expected.role].runtime };
  assert.throws(() => validatePublishedSource(plan, expected.build, expected.role, v), /hex bytes/);
});
