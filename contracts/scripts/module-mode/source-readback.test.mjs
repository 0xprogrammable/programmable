import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, toHex } from 'viem';
import { build, plan, addr } from './test-fixtures.mjs';
import { constructorArguments, sourceCreation, sourcifyVerificationRequests, validatePublishedSource } from './evidence.mjs';
import { exactJson, boundedPublicJson, sourcifyNeedsRecompilation, sourcifyPreflight, validateSourcifySource } from './source-readback.mjs';
import { canonicalJson } from './core.mjs';

const txHash = keccak256(toHex('test-only-never-live-transaction'));
function context(role = 'positionForwarderFactory') {
  const sourceBuild = structuredClone(build), artifact = sourceBuild.artifacts[role], args = constructorArguments(plan, role);
  artifact.metadata = { compiler: { version: '0.8.26+commit.8a97fa7a' }, settings: { compilationTarget: artifact.compilationTarget } };
  const sources = { [`src/${role}.sol`]: { content: '// synthetic unit fixture, not deployed\n' } };
  const settings = { optimizer: { enabled: true, runs: 1000 }, evmVersion: 'cancun', metadata: { appendCBOR: false, bytecodeHash: 'none' }, libraries: {}, remappings: [] };
  sourceBuild.standardInputs = { [role]: { language: 'Solidity', sources, settings: { ...settings, outputSelection: { '*': { '*': ['abi'] } } } } };
  const creation = { transactionHash: txHash, blockNumber: '123', transactionIndex: '2', deployer: plan.official.deterministicDeployer.address, transactionSender: plan.parameters.owner };
  const refs = artifact.deployedBytecode.immutableReferences;
  const transforms = Object.entries(refs).flatMap(([id, list]) => list.map(ref => ({ id, type: 'replace', offset: ref.start, reason: 'immutable' })));
  const immutables = Object.fromEntries(Object.entries(refs).map(([id, [ref]]) => [id, `0x${plan.contracts[role].runtime.slice(2 + ref.start * 2, 2 + (ref.start + ref.length) * 2)}`]));
  const value = { chainId: '4663', address: plan.contracts[role].address, match: 'match', creationMatch: 'match', runtimeMatch: 'match', matchId: '12', verifiedAt: '2026-09-06T12:00:00Z',
    compilation: { language: 'Solidity', compiler: 'solc', compilerVersion: '0.8.26+commit.8a97fa7a', compilerSettings: settings, name: role, fullyQualifiedName: `src/${role}.sol:${role}` },
    stdJsonInput: { language: 'Solidity', sources, settings }, sources, metadata: artifact.metadata, abi: artifact.abi, deployment: { ...creation, deployer: creation.transactionSender },
    creationBytecode: { recompiledBytecode: artifact.bytecode.object, onchainBytecode: `${artifact.bytecode.object}${args.slice(2)}`, cborAuxdata: {}, linkReferences: {},
      transformations: args === '0x' ? [] : [{ type: 'insert', offset: (artifact.bytecode.object.length - 2) / 2, reason: 'constructorArguments' }], transformationValues: args === '0x' ? {} : { constructorArguments: args } },
    runtimeBytecode: { recompiledBytecode: artifact.deployedBytecode.object, onchainBytecode: plan.contracts[role].runtime, cborAuxdata: {}, linkReferences: {}, immutableReferences: refs,
      transformations: transforms, transformationValues: transforms.length ? { immutables } : {} } };
  return { expected: { plan, build: sourceBuild, role, constructorArguments: args, creation }, value };
}

// Synthetic bytecode fixture carrying the exact solc-only trailer observed in the reviewed Quote
// Planner. It is not a deployment/compilation proof; the actual archived readback is checked separately.
function quotePlannerContext() {
  const role = 'positionPlanner', file = 'src/StockPairedPositionPlannerV3.sol', name = 'StockPairedPositionPlannerV3';
  const trailer = 'a164736f6c634300081a000a', runtime = `0x6001600055${trailer}`, creationCode = `0x6002600055${runtime.slice(2)}`;
  const settings = { optimizer: { enabled: true, runs: 1000 }, evmVersion: 'cancun', viaIR: true, metadata: { bytecodeHash: 'none' } };
  const sources = { [file]: { content: '// synthetic fixture, never deployed\n' } }, compilationTarget = { [file]: name };
  const metadata = { compiler: { version: '0.8.26+commit.8a97fa7a' },
    settings: { ...structuredClone(settings), compilationTarget, libraries: {}, remappings: [] } };
  const artifact = { abi: [], compilationTarget, metadata, bytecode: { object: creationCode, linkReferences: {} },
    deployedBytecode: { object: runtime, linkReferences: {}, immutableReferences: {} } };
  const creation = { transactionHash: txHash, blockNumber: '123', transactionIndex: '2', transactionSender: addr(1) };
  const pin = { address: addr(991), runtime, runtimeCodeHash: keccak256(runtime) };
  const bytecode = code => ({ recompiledBytecode: code, onchainBytecode: code,
    cborAuxdata: { 1: { offset: (code.length - 2 - trailer.length) / 2, value: `0x${trailer}` } },
    linkReferences: {}, transformations: [], transformationValues: {} });
  const value = { chainId: '4663', address: pin.address, match: 'match', creationMatch: 'match', runtimeMatch: 'match',
    matchId: '12', verifiedAt: '2026-09-07T22:11:31Z',
    compilation: { language: 'Solidity', compiler: 'solc', compilerVersion: '0.8.26+commit.8a97fa7a',
      compilerSettings: structuredClone(settings), name, fullyQualifiedName: `${file}:${name}` },
    stdJsonInput: { language: 'Solidity', sources: structuredClone(sources), settings: structuredClone(settings) },
    sources: structuredClone(sources), metadata: structuredClone(metadata), abi: [], deployment: { ...creation, deployer: creation.transactionSender },
    creationBytecode: bytecode(creationCode), runtimeBytecode: { ...bytecode(runtime), immutableReferences: {} } };
  const expected = { role, constructorArguments: '0x', creation, compilerAuxdataProfile: 'quote-planner-solc-0.8.26-v1',
    plan: { schemaVersion: 'programmable.module-engine-quote-deployment-plan.v1', chainId: 4663, sourceCommit: plan.sourceCommit,
      identityCandidate: { schemaVersion: 'programmable.module-engine-quote-infrastructure.v1', sourceVersion: 'module-engine-quote-v1', chainId: 4663 },
      contracts: { [role]: pin } },
    build: { artifacts: { [role]: artifact }, compilerMetadata: { [role]: structuredClone(metadata) },
      standardInputs: { [role]: { language: 'Solidity', sources, settings: { ...structuredClone(settings), outputSelection: { [file]: { [name]: ['abi'] } } } } } } };
  return { expected, value };
}

test('Quote Planner compiler CBOR describes an identical terminal version marker without transformations', () => {
  const { expected, value } = quotePlannerContext(), result = validateSourcifySource(expected, value);
  assert.equal(result.providerClassification, 'NO_METADATA_HASH_PROVIDER_MATCH');
  assert.equal(result.providerMatch, 'match');
  assert.equal(result.independentByteComparison, 'exact-complete-creation-and-runtime');
  assert.equal(result.runtimeCodeHash, expected.plan.contracts.positionPlanner.runtimeCodeHash);
  assert.equal(result.transformationPolicy, 'constructor-arguments-and-compiled-immutables-only');
  // Provider-local auxdata ids do not change the bound byte range or its exact bytes.
  value.creationBytecode.cborAuxdata = { 7: value.creationBytecode.cborAuxdata[1] };
  assert.equal(validateSourcifySource(expected, value).creationBytecodeHash, result.creationBytecodeHash);
});

test('Quote Planner CBOR cannot mask changed bytes, nonterminal regions or provider transformations', () => {
  const mutations = [
    v => { v.creationBytecode.recompiledBytecode += '00'; }, v => { v.creationBytecode.onchainBytecode += '00'; },
    v => { v.runtimeBytecode.recompiledBytecode += '00'; }, v => { v.runtimeBytecode.onchainBytecode += '00'; },
    v => { v.runtimeBytecode.onchainBytecode = `0x61${v.runtimeBytecode.onchainBytecode.slice(4)}`; },
    v => { v.runtimeBytecode.onchainBytecode = `${v.runtimeBytecode.onchainBytecode.slice(0, -2)}0b`; },
    ...['creationBytecode', 'runtimeBytecode'].flatMap(kind => [
      v => { v[kind].cborAuxdata = {}; }, v => { v[kind].cborAuxdata = null; }, v => { v[kind].cborAuxdata = []; },
      v => { v[kind].cborAuxdata[2] = structuredClone(v[kind].cborAuxdata[1]); },
      v => { v[kind].cborAuxdata = { unexpected: v[kind].cborAuxdata[1] }; },
      v => { v[kind].cborAuxdata[1].extra = true; }, v => { v[kind].cborAuxdata[1].offset--; },
      v => { v[kind].cborAuxdata[1].offset = -1; }, v => { v[kind].cborAuxdata[1].offset = 0.5; },
      v => { v[kind].cborAuxdata[1].offset = Number.MAX_SAFE_INTEGER; },
      v => { v[kind].cborAuxdata[1].value = '0xa164736f6c634300081b000a'; },
      v => { v[kind].cborAuxdata[1].value = '0x000a'; },
      v => { v[kind].transformations.push({ id: '1', type: 'replace', offset: v[kind].cborAuxdata[1].offset, reason: 'cborAuxdata' }); },
      v => { v[kind].transformationValues.cborAuxdata = { 1: v[kind].cborAuxdata[1].value }; },
      v => { v[kind].linkReferences = { unexpected: {} }; },
    ]),
  ];
  for (const mutate of mutations) {
    const { expected, value } = quotePlannerContext(); mutate(value);
    assert.throws(() => validateSourcifySource(expected, value), undefined, mutate.toString());
  }
});

test('Quote Planner full-byte equality still rejects embedded CBOR, a different compiler marker and an uncompiled runtime', () => {
  for (const kind of ['creationBytecode', 'runtimeBytecode']) for (const embedded of [true, false]) {
    const { expected, value } = quotePlannerContext(), artifact = expected.build.artifacts.positionPlanner;
    const code = value[kind], old = code.recompiledBytecode;
    const changed = embedded ? `${old}00` : old.replace('a164736f6c634300081a000a', 'a164736f6c634300081b000a');
    artifact[kind === 'creationBytecode' ? 'bytecode' : 'deployedBytecode'].object = changed;
    code.recompiledBytecode = changed; code.onchainBytecode = changed;
    if (!embedded) code.cborAuxdata[1].value = '0xa164736f6c634300081b000a';
    if (kind === 'runtimeBytecode') {
      expected.plan.contracts.positionPlanner.runtime = changed;
      expected.plan.contracts.positionPlanner.runtimeCodeHash = keccak256(changed);
    }
    // Even equality of every complete source/onchain byte cannot turn an inner byte range or a
    // compiler marker inconsistent with the full metadata into this profile's terminal auxdata.
    assert.throws(() => validateSourcifySource(expected, value), /compiler trailer/);
  }
  const { expected, value } = quotePlannerContext();
  const changed = `0x61${value.runtimeBytecode.onchainBytecode.slice(4)}`;
  value.runtimeBytecode.onchainBytecode = changed;
  expected.plan.contracts.positionPlanner.runtime = changed;
  expected.plan.contracts.positionPlanner.runtimeCodeHash = keccak256(changed);
  assert.throws(() => validateSourcifySource(expected, value), /complete runtime differs from its compiled template/);
});

test('Quote Planner CBOR opt-in requires its exact source profile, target and compiler metadata', () => {
  const mutations = [
    ({ expected }) => { delete expected.compilerAuxdataProfile; },
    ({ expected }) => { expected.compilerAuxdataProfile = 'allow-cbor'; },
    ({ expected }) => { expected.plan.schemaVersion = 'programmable.module-mode-deployment-plan.v1'; },
    ...['module-native-v1', 'module-native-v2', 'module-engine-v1'].map(version => ({ expected }) => { expected.plan.identityCandidate.sourceVersion = version; }),
    ({ expected }) => { expected.plan.identityCandidate.schemaVersion = 'programmable.module-engine.release.v1'; },
    ({ expected }) => { expected.plan.identityCandidate.chainId = 1; },
    ({ expected, value }) => {
      const old = expected.role; expected.role = 'converter';
      for (const entries of [expected.plan.contracts, expected.build.artifacts, expected.build.standardInputs, expected.build.compilerMetadata]) {
        entries.converter = entries[old]; delete entries[old];
      }
      value.creationBytecode.cborAuxdata = {}; value.runtimeBytecode.cborAuxdata = {};
    },
    ({ expected, value }) => {
      const target = { 'src/Other.sol': 'Other' };
      expected.build.artifacts.positionPlanner.compilationTarget = target;
      for (const metadata of [expected.build.artifacts.positionPlanner.metadata, expected.build.compilerMetadata.positionPlanner, value.metadata]) metadata.settings.compilationTarget = target;
      value.compilation.name = 'Other'; value.compilation.fullyQualifiedName = 'src/Other.sol:Other';
    },
    ({ expected, value }) => {
      for (const metadata of [expected.build.artifacts.positionPlanner.metadata, expected.build.compilerMetadata.positionPlanner, value.metadata]) metadata.compiler.version = '0.8.27+commit.40a35a09';
    },
    ...[
      s => { s.metadata.appendCBOR = false; }, s => { s.metadata.appendCBOR = true; }, s => { s.metadata.bytecodeHash = 'ipfs'; },
      s => { s.viaIR = false; }, s => { s.optimizer.runs = 999; }, s => { s.evmVersion = 'paris'; },
    ].map(mutate => ({ expected, value }) => {
      for (const settings of [expected.build.standardInputs.positionPlanner.settings, expected.build.artifacts.positionPlanner.metadata.settings,
        expected.build.compilerMetadata.positionPlanner.settings, value.compilation.compilerSettings, value.stdJsonInput.settings, value.metadata.settings]) mutate(settings);
    }),
  ];
  for (const mutate of mutations) {
    const fixture = quotePlannerContext(); mutate(fixture);
    assert.throws(() => validateSourcifySource(fixture.expected, fixture.value), undefined, mutate.toString());
  }
});

test('Native and Core readbacks keep the existing no-CBOR default and reject the Quote opt-in', () => {
  for (const sourceProfile of [undefined, 'module-native-v1', 'module-native-v2', 'module-engine-v1']) {
    const { expected, value } = context(); expected.sourceProfile = sourceProfile;
    assert.equal(validateSourcifySource(expected, value).providerClassification, 'NO_CBOR_PROVIDER_MATCH');
    expected.compilerAuxdataProfile = 'quote-planner-solc-0.8.26-v1';
    assert.throws(() => validateSourcifySource(expected, value), /Quote Planner/);
    delete expected.compilerAuxdataProfile;
    value.runtimeBytecode.cborAuxdata = { 1: { offset: 0, value: '0xa164736f6c634300081a000a' } };
    assert.throws(() => validateSourcifySource(expected, value), /unexpected runtime CBOR/);
  }
});
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
      transaction: { hash: txHash, from: step.sender }, receipt: { status: '0x1', transactionHash: txHash, blockNumber: '0x7b', transactionIndex: '0x2' },
      contracts: Object.fromEntries(step.expectedRoles.map(role => [role, structuredClone(plan.contracts[role])])) })) };
  const requests = sourcifyVerificationRequests(plan, sourceBuild, evidence);
  assert.equal(requests.runtime.body.creationTransactionHash, txHash);
  assert.equal(sourceCreation(plan, 'runtime', evidence).deployer, plan.contracts.runtimeFactory.address);
  assert.equal(sourceCreation(plan, 'budgetVault', evidence).deployer, plan.contracts.runtime.address);
  assert.equal(sourceCreation(plan, 'rewardLedger', evidence).deployer, plan.contracts.hook.address);
  assert.equal(sourceCreation(plan, 'rewardLedger', evidence).transactionSender, plan.parameters.owner);
  evidence.records[8].contracts.runtime.runtimeCodeHash = keccak256(toHex('wrong'));
  assert.throws(() => sourceCreation(plan, 'runtime', evidence), /code\/receipt/);
});
test('complete raw compiler metadata and ABI entries survive Foundry presentation differences', () => {
  const { expected, value } = context();
  expected.build.compilerMetadata = { [expected.role]: { ...value.metadata, output: { devdoc: { title: 'Real NatSpec' } } } };
  value.metadata = structuredClone(expected.build.compilerMetadata[expected.role]);
  value.abi = [...value.abi].reverse();
  assert.equal(validateSourcifySource(expected, value).providerMatch, 'match');
  value.metadata.output.devdoc.title = 'Altered';
  assert.throws(() => validateSourcifySource(expected, value), /metadata differs/);
});
test('only explicit false compiler defaults are normalized', () => {
  const { expected, value } = context();
  value.compilation.compilerSettings = structuredClone(value.compilation.compilerSettings);
  value.compilation.compilerSettings.viaIR = false;
  value.compilation.compilerSettings.metadata.useLiteralContent = false;
  value.stdJsonInput.settings = structuredClone(value.compilation.compilerSettings);
  assert.equal(sourcifyNeedsRecompilation(expected.build.standardInputs[expected.role], value), false);
  assert.equal(validateSourcifySource(expected, value).providerMatch, 'match');
  value.compilation.compilerSettings.viaIR = true;
  value.stdJsonInput.settings.viaIR = true;
  assert.throws(() => validateSourcifySource(expected, value), /compiler settings differ/);
});
test('deduplicated remappings require an exact input-bound pinned recompilation', () => {
  const { expected, value } = context();
  value.compilation.compilerSettings = structuredClone(value.compilation.compilerSettings);
  value.compilation.compilerSettings.remappings = ['unused/=lib/unused/'];
  value.stdJsonInput.settings = structuredClone(value.compilation.compilerSettings);
  assert.equal(sourcifyNeedsRecompilation(expected.build.standardInputs[expected.role], value), true);
  assert.throws(() => validateSourcifySource(expected, value), /recompilation required/);
  const a = expected.build.artifacts[expected.role];
  expected.recompilation = { compilerVersion: '0.8.26+commit.8a97fa7a', inputDigest: keccak256(toHex(canonicalJson(value.stdJsonInput))),
    creationBytecode: a.bytecode.object, runtimeBytecode: a.deployedBytecode.object, abi: a.abi };
  assert.equal(validateSourcifySource(expected, value).providerMatch, 'match');
  for (const change of [r => { r.inputDigest = txHash; }, r => { r.runtimeBytecode += '00'; }, r => { r.creationBytecode += '00'; }, r => { r.compilerVersion = '0.8.27'; }, r => { r.abi = []; }]) {
    const changed = structuredClone(expected); change(changed.recompilation); assert.throws(() => validateSourcifySource(changed, value));
  }
});
test('ABI comparison ignores item order only and Sourcify deployer means transaction sender', () => {
  const { expected, value } = context();
  value.abi = [...value.abi].reverse();
  assert.equal(validateSourcifySource(expected, value).providerMatch, 'match');
  value.deployment.deployer = expected.creation.deployer;
  assert.throws(() => validateSourcifySource(expected, value), /creation transaction differs/);
  value.deployment.deployer = expected.creation.transactionSender;
  value.abi.push(value.abi[0]);
  assert.throws(() => validateSourcifySource(expected, value), /Duplicate ABI/);
});
test('ABI argument order and published input/source identity remain exact', () => {
  const { expected, value } = context();
  const item = { type: 'function', name: 'synthetic', stateMutability: 'view',
    inputs: [{ name: 'recipient', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] };
  expected.build.artifacts[expected.role].abi = [item]; value.abi = structuredClone([item]);
  assert.equal(validateSourcifySource(expected, value).providerMatch, 'match');
  value.abi[0].inputs.reverse();
  assert.throws(() => validateSourcifySource(expected, value), /ABI differs/);
  value.abi = structuredClone([item]); value.stdJsonInput = structuredClone(value.stdJsonInput);
  value.stdJsonInput.sources['src/positionForwarderFactory.sol'].content += ' ';
  assert.throws(() => validateSourcifySource(expected, value), /standard input differs/);
});
test('Blockscout full flag alone never accepts absent creation bytes or incomplete source', () => {
  const { expected } = context();
  const v = { is_verified: true, is_fully_verified: true, is_partially_verified: false, is_changed_bytecode: false,
    compiler_version: 'v0.8.26+commit.8a97fa7a', optimization_enabled: true, optimizations_runs: 1000, evm_version: 'cancun',
    name: expected.role, file_path: `src/${expected.role}.sol`, deployed_bytecode: plan.contracts[expected.role].runtime };
  assert.throws(() => validatePublishedSource(plan, expected.build, expected.role, v), /hex bytes/);
});
