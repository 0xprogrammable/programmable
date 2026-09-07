import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { decodeAbiParameters, encodeFunctionData, encodeFunctionResult, getCreate2Address, keccak256, parseAbi, parseAbiParameters, toHex, zeroAddress } from 'viem';
import { fixtures, params, addr } from '../module-mode/test-fixtures.mjs';
import { buildPlan, digest } from '../module-mode/core.mjs';
import { evidenceBytes, evidenceDigest } from '../module-mode/evidence.mjs';
import { operatorSourceProfile, startOperator } from '../module-mode/operator.mjs';
import { rpcClient, walletRequest, prepareWalletRequest, revalidateWalletRequest } from '../module-mode/rpc.mjs';
import { assertContinuationPlan, walletRetryRequest } from '../module-mode/recovery.mjs';
import { ECONOMICS_POLICY_ID } from '../module-native-v2/core.mjs';
import { assertQuotePlan, assertQuoteProfile, assertQuoteIdentity, buildQuotePlan, quoteInfrastructureIdentity, quoteReviewConfiguration,
  quoteSimulationInput, QUOTE_CONFIGURATION_ABI, QUOTE_DEPLOYMENT_SCHEMA, QUOTE_IDENTITY_SCHEMA, QUOTE_PLAN_SCHEMA, QUOTE_REUSE_DOMAIN, QUOTE_ROLES } from './quote-core.mjs';
import { quoteConstructorArguments, quoteSourceCreation, quoteSourceRequests, quoteSourceReuse } from './quote-evidence.mjs';
import { observeQuoteBindings, observeQuoteReceipt, observeQuoteStage, WETH_ADMIN_SLOT, WETH_IMPLEMENTATION_SLOT,
  WETH_PROXY_OBSERVATION_SCHEMA } from './quote-rpc.mjs';
import { QUOTE_REVIEW_SETTINGS, quoteReviewSettings, quoteReviewSources } from './quote-review-compiler.mjs';
const h = value => keccak256(toHex(value));

// Only synthetic operator fixtures. Deployment preparation always compiles the committed real source closure.
function fixture() {
  const base = fixtures(), previousPlan = buildPlan(base, params);
  const names = ['router', 'factory', 'weth', 'routerCodeHash', 'factoryCodeHash', 'wethCodeHash'];
  const artifacts = { positionForwarderFactory: base.artifacts.positionForwarderFactory,
    positionPlanner: { abi: [{ type: 'constructor', stateMutability: 'nonpayable', inputs: [] }], bytecode: { object: '0x60016002' },
      deployedBytecode: { object: '0x60026003', immutableReferences: {} }, immutableNames: {}, compilationTarget: { 'src/planner.sol': 'PlannerFixture' } },
    converter: { abi: [{ type: 'constructor', stateMutability: 'nonpayable', inputs: parseAbiParameters('address router,address weth') }],
      bytecode: { object: '0x60026004' }, deployedBytecode: { object: `0x${'00'.repeat(names.length * 32)}`,
        immutableReferences: Object.fromEntries(names.map((name, i) => [String(i), [{ start: i * 32, length: 32 }]])) },
      immutableNames: Object.fromEntries(names.map((name, i) => [String(i), name])), compilationTarget: { 'src/converter.sol': 'ConverterFixture' } } };
  const build = { ...base, artifacts, standardInputs: Object.fromEntries(Object.keys(artifacts).map(role => [role,
    { language: 'Solidity', sources: { [`src/${role}.sol`]: { content: '// fixture only' } }, settings: {} }])) };
  build.reviewCompilerParity = { schemaVersion: 'programmable.module-engine-quote-compiler-parity.v1', settings: QUOTE_REVIEW_SETTINGS,
    plannerRuntimeCodeHash: keccak256(artifacts.positionPlanner.deployedBytecode.object), plannerRuntimeEmbeddedInEngineCreation: true,
    status: 'synthetic-fixture-no-compiler-proof' };
  const previousRelease = { ...previousPlan.identityCandidate, enabled: true, status: 'active', startBlock: '10', releaseDigest: h('prior-release') };
  const previousRaw = evidenceBytes({ chainId: 4663, releaseDigest: previousRelease.releaseDigest, sourceCommit: previousRelease.sourceCommit,
    status: 'exact-source-and-runtime-verified', records: [{ role: 'positionForwarderFactory', ...previousRelease.contracts.positionForwarderFactory,
      sourcePaths: ['src/positionForwarderFactory.sol'], creationTransactionHash: h('historical-forwarder') }] });
  previousRelease.sourceVerificationDigest = evidenceDigest(previousRaw);
  const body = { schemaVersion: 'programmable.module-mode-native-v2-basis.v1', chainId: 4663, provenance: { sourceCommit: build.sourceCommit },
    previousRelease, deploymentOwner: params.owner, registryOwner: params.reviewAuthority };
  const basis = { ...body, basisDigest: digest(body.schemaVersion, body) };
  build.reuseSourceProvenance = { previousReleaseDigest: previousRelease.releaseDigest, previousSourceCommit: previousRelease.sourceCommit };
  build.reuseSourceDigest = digest(QUOTE_REUSE_DOMAIN, build.reuseSourceProvenance);
  const parameters = { owner: params.owner, releaseLabel: 'fixture-quote-v1' }, plan = buildQuotePlan(build, parameters, basis);
  return { build, basis, plan, parameters, previousRaw };
}
test('Quote preparation is exactly two zero-value CREATE2 deployments with six bound converter immutables', () => {
  const { plan, build } = fixture(); assertQuotePlan(plan, build);
  assert.deepEqual(Object.keys(plan.contracts), QUOTE_ROLES); assert.equal(plan.steps.length, 2);
  assert.equal(plan.economics, undefined); assert.equal(plan.identityCandidate.releaseDigest, undefined);
  assert.equal(plan.identityCandidate.sourceVersion, 'module-engine-quote-v1');
  for (const step of plan.steps) {
    assert.equal(step.value, '0'); assert.equal(step.sender, params.owner); assert.equal(step.to, plan.official.deterministicDeployer.address);
    assert.equal(step.data, `${step.salt}${build.artifacts[step.role].bytecode.object.slice(2)}${step.constructorArguments.slice(2)}`);
    assert.equal(step.target, getCreate2Address({ from: step.to, salt: step.salt, bytecodeHash: step.initcodeHash }).toLowerCase());
    assert.equal(keccak256(plan.contracts[step.role].runtime), plan.contracts[step.role].runtimeCodeHash);
  }
  assert.equal(quoteConstructorArguments(plan, 'positionPlanner'), '0x');
  assert.deepEqual(decodeAbiParameters(parseAbiParameters('address,address'), quoteConstructorArguments(plan, 'converter')).map(a => a.toLowerCase()),
    [plan.dependencies.router.address, plan.dependencies.weth.address]);
  assert.equal(Object.keys(plan.contracts.converter.immutableValues).length, 6);
  assert.throws(() => quoteConstructorArguments(plan, 'host'), /Only the new/);
});
test('Plan reconstruction rejects injected economics, authority, altered source pins and oversized code', () => {
  const f = fixture();
  for (const change of [p => { p.economics = {}; }, p => { p.steps[0].value = '1'; }, p => { p.dependencies.router.address = addr(99); },
    p => { p.contracts.converter.immutableValues.factory = addr(99); }, p => { p.identityCandidate.schemaVersion = 'programmable.module-engine.release.v1'; }]) {
    const changed = structuredClone(f.plan); change(changed); assert.throws(() => assertQuotePlan(changed, f.build), /differs/);
  }
  assert.throws(() => buildQuotePlan(f.build, { ...f.parameters, treasury: params.owner }, f.basis), /keys/);
  assert.throws(() => buildQuotePlan(f.build, { ...f.parameters, owner: addr(99) }, f.basis), /owner/);
  for (const [role, field, size] of [['converter', 'bytecode', 49100], ['positionPlanner', 'deployedBytecode', 24577]]) {
    const bad = structuredClone(f.build); bad.artifacts[role][field].object = `0x${'01'.repeat(size)}`;
    assert.throws(() => buildQuotePlan(bad, f.parameters, f.basis), /EIP-/);
  }
  const bad = structuredClone(f.build); bad.artifacts.positionForwarderFactory.deployedBytecode.object = `0x${'00'.repeat(32)}01`;
  assert.throws(() => buildQuotePlan(bad, f.parameters, f.basis), /Forwarder runtime/);
});
test('The fourth exact operator profile does not relax any existing economics gate or allow extra roles', () => {
  const { plan } = fixture(), p = operatorSourceProfile(plan);
  assert.equal(p.observeStage, observeQuoteStage); assert.equal(p.observeReceipt, observeQuoteReceipt); assert.equal(p.assertPlan, assertQuotePlan);
  for (const mutate of [v => { v.identityCandidate.economicsPolicyId = ECONOMICS_POLICY_ID; }, v => { v.economics = {}; },
    v => { v.contracts.host = v.contracts.converter; }, v => { v.steps.push(v.steps[0]); }, v => { v.steps[0].expectedRoles.push('registry'); },
    v => { v.sourceVersion = 'module-native-v2'; }, v => { v.identityCandidate.sourceVersion = 'module-engine-v1'; }]) {
    const copy = structuredClone(plan); mutate(copy); assert.throws(() => operatorSourceProfile(copy));
  }
  for (const [schemaVersion, identitySchema, sourceVersion] of [
    ['programmable.module-mode-deployment-plan.v1', 'programmable.module-mode-source.v1', 'module-native-v1'],
    ['programmable.module-mode-native-v2-deployment-plan.v1', 'programmable.module-mode-source.v2', 'module-native-v2'],
    ['programmable.module-engine-deployment-plan.v1', 'programmable.module-engine.release.v1', 'module-engine-v1']]) {
    const old = { schemaVersion, chainId: 4663, identityCandidate: { schemaVersion: identitySchema, chainId: 4663, sourceVersion,
      economicsPolicyId: ECONOMICS_POLICY_ID }, economics: { economicsPolicyId: ECONOMICS_POLICY_ID } };
    assert.equal(operatorSourceProfile(old).sourceVersion, sourceVersion);
    if (sourceVersion !== 'module-native-v1') { delete old.economics; assert.throws(() => operatorSourceProfile(old), /economics policy/); }
  }
});
test('Compiler parity follows the actual literal public Engine policy and rejects drift or source alias collisions', () => {
  const source = `const NATIVE_SETTINGS_V1 = ${JSON.stringify(QUOTE_REVIEW_SETTINGS)};`;
  assert.deepEqual(quoteReviewSettings(source), QUOTE_REVIEW_SETTINGS);
  assert.throws(() => quoteReviewSettings(source.replace('"viaIR":true', '"viaIR":false')), /profile changed/);
  assert.throws(() => quoteReviewSettings(source.replace('"bytecodeHash":"none"', '"bytecodeHash":"none","appendCBOR":false')), /profile changed/);
  assert.throws(() => quoteReviewSettings('const NATIVE_SETTINGS_V1 = getSettings();'), /literal/);
  const content = '// byte-identical alias';
  const input = { sources: { 'lib/example/A.sol': { content } }, settings: { remappings: ['@example/=lib/example/'] } };
  assert.equal(quoteReviewSources(input)['@example/A.sol'].content, content);
  assert.throws(() => quoteReviewSources({ ...input, sources: { ...input.sources, '@example/A.sol': { content: '// changed' } } }), /collision/);
  const { plan, build } = fixture(); delete build.reviewCompilerParity;
  assert.throws(() => buildQuotePlan(build, plan.parameters, plan.basis), /Planner parity/);
});
test('Review config uses the exact nine-field dynamic tuple, explicit price/tier and fixed dependencies', () => {
  const { plan } = fixture(), result = quoteReviewConfiguration(plan, { initialQuotePerTokenX18: '1234567890000000000', feeTier: 3000 });
  assert.equal(result.status, 'unapproved-unpublished'); assert.equal(result.requiredFixedConfiguration, true);
  assert.equal(BigInt(result.configuration.slice(0, 66)), 32n, 'Single dynamic tuple has its leading ABI offset');
  const [decoded] = decodeAbiParameters(QUOTE_CONFIGURATION_ABI, result.configuration);
  assert.equal(decoded.initialQuotePerTokenX18, 1234567890000000000n); assert.equal(decoded.fixedQuoteAsset, zeroAddress);
  assert.equal(decoded.converter.toLowerCase(), plan.contracts.converter.address);
  assert.equal(decoded.converterCodeHash, plan.contracts.converter.runtimeCodeHash);
  assert.equal(decoded.feeConversionRouteSuffix, `0x000bb8${plan.dependencies.weth.address.slice(2)}`);
  for (const input of [{ feeTier: 3000 }, { initialQuotePerTokenX18: '0', feeTier: 3000 }, { initialQuotePerTokenX18: '1', feeTier: 17 },
    { initialQuotePerTokenX18: '1', feeTier: 3000, fixedQuoteAsset: addr(44) }, { initialQuotePerTokenX18: '1', feeTier: 3000, converter: addr(55) }]) {
    assert.throws(() => quoteReviewConfiguration(plan, input));
  }
});
test('Fork input includes all nine code pins, and infrastructure identity cannot become a release', () => {
  const { plan } = fixture(), [chain, senders, targets, data, pins, hashes] = decodeAbiParameters(
    parseAbiParameters('uint256,address[],address[],bytes[],address[],bytes32[]'), quoteSimulationInput(plan));
  assert.equal(chain, 4663n); assert.equal(senders.length, 2); assert.equal(targets.length, 2); assert.equal(data.length, 2);
  assert.equal(pins.length, 9); assert.equal(hashes.length, 9); assert.equal(new Set(pins).size, 9);
  const identity = quoteInfrastructureIdentity(plan, '123'); assertQuoteIdentity(plan, identity);
  assert.equal(identity.schemaVersion, QUOTE_IDENTITY_SCHEMA); assert.equal(identity.releaseDigest, undefined);
  assert.throws(() => assertQuoteIdentity(plan, { ...identity, releaseDigest: identity.infrastructureDigest }), /identity differs/);
});

const storageWord = target => `0x${'0'.repeat(24)}${target.slice(2)}`;
function proxyObservation(plan, blockNumber, blockHash, overrides = {}) {
  const implementation = overrides.implementation ?? addr(90), admin = addr(91), runtime = overrides.implementationRuntime ?? '0x6001600355';
  return { schemaVersion: WETH_PROXY_OBSERVATION_SCHEMA, proxy: plan.dependencies.weth.address,
    proxyRuntimeCodeHash: plan.dependencies.weth.runtimeCodeHash, blockNumber, blockHash,
    implementationSlot: WETH_IMPLEMENTATION_SLOT, implementationStorageValue: storageWord(implementation), implementation,
    implementationRuntime: runtime, implementationRuntimeCodeHash: keccak256(runtime), adminSlot: WETH_ADMIN_SLOT,
    adminStorageValue: storageWord(admin), admin, externalUpgradeAssumption: 'snapshot-only-not-immutable-implementation' };
}
function providersFor(original, overrides = {}) {
  const plan = structuredClone(original), calls = new Map(), runtimes = new Map(), readLog = [], blockHash = h('quote-block'), blockNumber = '0x30';
  for (const [index, [role, pin]] of Object.entries(plan.dependencies).entries()) {
    const runtime = `0x60${(index + 1).toString(16).padStart(2, '0')}6000`; pin.runtimeCodeHash = keccak256(runtime); runtimes.set(pin.address, runtime);
  }
  const proxy = proxyObservation(plan, blockNumber, blockHash, overrides);
  if (!overrides.emptyImplementation) runtimes.set(proxy.implementation, proxy.implementationRuntime);
  for (const role of overrides.deployed ?? []) runtimes.set(plan.contracts[role].address, plan.contracts[role].runtime);
  function getter(target, signature, result) {
    const abi = parseAbi([signature]), functionName = abi[0].name;
    calls.set(`${target}:${encodeFunctionData({ abi, functionName })}`, encodeFunctionResult({ abi, functionName, result }));
  }
  const d = plan.dependencies;
  getter(d.positionManager.address, 'function poolManager() view returns (address)', overrides.wrongLink ? addr(77) : d.poolManager.address);
  getter(d.positionForwarderFactory.address, 'function positionManager() view returns (address)', d.positionManager.address);
  getter(d.router.address, 'function factory() view returns (address)', d.v3Factory.address);
  getter(d.router.address, 'function WETH9() view returns (address)', d.weth.address);
  for (const [field, role] of [['router', 'router'], ['factory', 'v3Factory'], ['weth', 'weth']]) {
    getter(plan.contracts.converter.address, `function ${field}() view returns (address)`, d[role].address);
    getter(plan.contracts.converter.address, `function ${field}CodeHash() view returns (bytes32)`, overrides.converterHash ?? d[role].runtimeCodeHash);
  }
  let blockCalls = 0;
  const block = { number: blockNumber, hash: blockHash, timestamp: toHex(BigInt(Math.floor(Date.now() / 1000) - (overrides.stale ? 301 : 0))),
    baseFeePerGas: '0xa', transactions: overrides.entry ? [overrides.entry.transactionHash] : [] };
  const providers = [0, 1].map(index => ({ providerId: `provider${index}`, trustDomain: `provider${index}.example`, rpc: async (method, args) => {
    readLog.push({ index, method, args });
    if (method === 'eth_chainId') return overrides.wrongChain ? '0x1' : '0x1237';
    if (method === 'eth_getBlockByNumber') return { ...block, hash: overrides.reorg && ++blockCalls > 6 ? h('reorg') : blockHash };
    if (method === 'eth_getCode') { assert.equal(args[1], blockNumber); return overrides.badCode === args[0] ? '0xdeadbeef' : runtimes.get(args[0]) ?? '0x'; }
    if (method === 'eth_getStorageAt') {
      assert.equal(args[0], plan.dependencies.weth.address); assert.equal(args[2], blockNumber);
      assert.ok([WETH_IMPLEMENTATION_SLOT, WETH_ADMIN_SLOT].includes(args[1]));
      if (overrides.disagreeSlot === args[1] && index === 1) return storageWord(addr(92));
      return args[1] === WETH_IMPLEMENTATION_SLOT ? overrides.implementationWord ?? proxy.implementationStorageValue
        : overrides.adminWord ?? proxy.adminStorageValue;
    }
    if (method === 'eth_getTransactionCount') return args[0] === params.owner
      ? args[1] === 'pending' && overrides.pending ? '0x4' : '0x3' : overrides.targetNonce ? '0x1' : '0x0';
    if (method === 'eth_getBalance') return overrides.balance ?? '0xde0b6b3a7640000';
    if (method === 'eth_estimateGas') { assert.equal(args[1], blockNumber); return overrides.gasDisagreement && index ? '0x500000' : '0x200000'; }
    if (method === 'eth_call') {
      assert.equal(args[1], blockNumber); const request = args[0];
      if (request.to === d.deterministicDeployer.address) {
        assert.equal(request.value, '0x0'); const step = plan.steps.find(s => s.data === request.data); assert.ok(step);
        return overrides.wrongTarget ? addr(88) : step.target;
      }
      const result = calls.get(`${request.to}:${request.data}`); assert.ok(result, 'Only canonical dependency getters'); return result;
    }
    if (method === 'eth_getTransactionByHash') {
      const e = overrides.entry, s = plan.steps[e.stepIndex];
      return { ...e.request, hash: e.transactionHash, input: overrides.wrongInput ? '0x00' : s.data,
        blockHash, blockNumber, from: s.sender, to: s.to, value: '0x0' };
    }
    if (method === 'eth_getTransactionReceipt') return { transactionHash: overrides.entry.transactionHash, blockHash, blockNumber,
      status: '0x1', gasUsed: '0x100000', transactionIndex: '0x1' };
    throw new Error(`Unexpected RPC method ${method}`);
  } }));
  return { plan, providers, blockNumber, blockHash, readLog };
}
const ceilings = { maxGas: '4000000', maxFeePerGas: '100', maxPriorityFeePerGas: '1' };
test('Quote WETH bindings traverse the shared RPC transport for both slots and providers at the bound block', async () => {
  const { plan } = fixture();
  for (const stepIndex of [0, 1]) {
    const f = providersFor(plan, { deployed: QUOTE_ROLES.slice(0, stepIndex) }), transported = [];
    const providers = f.providers.map((provider, index) => ({ ...provider,
      rpc: rpcClient(`https://provider${index}.invalid/rpc`, provider.providerId, async (_url, options) => {
        assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
        const request = JSON.parse(options.body); assert.equal(request.jsonrpc, '2.0');
        transported.push({ index, method: request.method, params: request.params });
        const result = await provider.rpc(request.method, request.params);
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { status: 200 });
      }) }));
    const result = await observeQuoteStage(f.plan, stepIndex, providers);
    assert.equal(result.state, 'vacant-simulated');
    assert.deepEqual(result.quoteBindings.wethProxy, proxyObservation(f.plan, '48', f.blockHash));
    const storageReads = transported.filter(call => call.method === 'eth_getStorageAt');
    assert.equal(storageReads.length, 4);
    for (const index of [0, 1]) for (const slot of [WETH_IMPLEMENTATION_SLOT, WETH_ADMIN_SLOT]) {
      assert.deepEqual(storageReads.filter(call => call.index === index && call.params[1] === slot),
        [{ index, method: 'eth_getStorageAt', params: [f.plan.dependencies.weth.address, slot, f.blockNumber] }]);
    }
    assert.equal(transported.filter(call => call.method === 'eth_getCode' && call.params[0] === addr(90)
      && call.params[1] === f.blockNumber).length, 2, 'Both providers verify the bound implementation runtime');
  }
});
test('Shared RPC transport blocks write, signing, debug and impersonation methods before transport', async () => {
  let requests = 0;
  const rpc = rpcClient('https://provider.invalid/rpc', 'fixture', async () => { requests++; throw new Error('Unexpected transport'); });
  for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'eth_sign', 'eth_signTransaction', 'personal_sign',
    'eth_signTypedData_v4', 'wallet_sendCalls', 'debug_traceTransaction', 'debug_traceCall', 'anvil_impersonateAccount',
    'hardhat_impersonateAccount', 'anvil_setStorageAt', 'hardhat_setStorageAt', 'evm_setAutomine']) {
    await assert.rejects(rpc(method, []), /RPC method is outside the read-only inventory/);
  }
  assert.equal(requests, 0);
});
test('Both stages use one bound block for real dependency links, CREATE2 simulation and gas estimates', async () => {
  const { plan } = fixture();
  for (const stepIndex of [0, 1]) {
    const f = providersFor(plan, { deployed: QUOTE_ROLES.slice(0, stepIndex) });
    const result = await observeQuoteStage(f.plan, stepIndex, f.providers); assert.equal(result.state, 'vacant-simulated');
    assert.deepEqual(result.quoteBindings.deployedRoles, QUOTE_ROLES.slice(0, stepIndex));
    assert.deepEqual(result.quoteBindings.wethProxy, proxyObservation(f.plan, '48', f.blockHash));
    assert.equal(f.readLog.filter(call => call.method === 'eth_getStorageAt').length, 4, 'Both slots read through both providers');
    assert.equal(f.readLog.filter(call => call.method === 'eth_getCode' && call.args[0] === addr(90)).length, 2);
    const request = walletRequest(f.plan, result, ceilings); assert.equal(request.value, '0x0'); assert.equal(request.to, plan.steps[stepIndex].to);
    assert.equal(request.nonce, '0x3'); assert.equal(request.data, plan.steps[stepIndex].data);
    assert.ok(f.readLog.every(call => !/send|sign|debug|anvil/i.test(call.method)));
  }
});
test('WETH proxy slots require canonical nonzero addresses, provider agreement and actual implementation code', async () => {
  const { plan } = fixture();
  for (const override of [{ disagreeSlot: WETH_IMPLEMENTATION_SLOT }, { disagreeSlot: WETH_ADMIN_SLOT },
    { implementationWord: '0x01' }, { implementationWord: toHex(0n, { size: 32 }) },
    { implementationWord: `0x01${'00'.repeat(31)}` }, { adminWord: storageWord(zeroAddress) },
    { adminWord: `0x01${'00'.repeat(31)}` }, { emptyImplementation: true }]) {
    const f = providersFor(plan, override); await assert.rejects(observeQuoteStage(f.plan, 0, f.providers));
  }
  const disagreement = providersFor(plan), originalRpc = disagreement.providers[1].rpc;
  disagreement.providers[1].rpc = (method, args) => method === 'eth_getCode' && args[0] === addr(90) ? '0x00' : originalRpc(method, args);
  await assert.rejects(observeQuoteStage(disagreement.plan, 0, disagreement.providers), /Provider disagreement: WETH implementation runtime/);
});
test('A changed WETH implementation is captured separately even when the outer proxy runtime is unchanged', async () => {
  const { plan } = fixture(), first = providersFor(plan), second = providersFor(plan, { implementation: addr(93), implementationRuntime: '0x6002600355' });
  const left = await observeQuoteStage(first.plan, 0, first.providers), right = await observeQuoteStage(second.plan, 0, second.providers);
  assert.equal(left.quoteBindings.wethProxy.proxyRuntimeCodeHash, right.quoteBindings.wethProxy.proxyRuntimeCodeHash);
  assert.notEqual(left.quoteBindings.wethProxy.implementation, right.quoteBindings.wethProxy.implementation);
  assert.notEqual(left.quoteBindings.wethProxy.implementationRuntimeCodeHash, right.quoteBindings.wethProxy.implementationRuntimeCodeHash);
  assert.notEqual(evidenceDigest(evidenceBytes(left.quoteBindings)), evidenceDigest(evidenceBytes(right.quoteBindings)));
});
test('Unsafe dependency, quorum, vacancy, nonce, gas and freshness states cannot arm a stage', async () => {
  const { plan } = fixture();
  for (const override of [{ badCode: plan.dependencies.deterministicDeployer.address }, { wrongLink: true }, { wrongChain: true },
    { targetNonce: true }, { pending: true }, { gasDisagreement: true }, { wrongTarget: true }, { stale: true }, { reorg: true }]) {
    const f = providersFor(plan, override); await assert.rejects(observeQuoteStage(f.plan, 0, f.providers));
  }
  const f = providersFor(plan); await assert.rejects(observeQuoteStage(f.plan, 1, f.providers), /runtime differs/);
  await assert.rejects(observeQuoteStage(f.plan, 0, [f.providers[0], f.providers[0]]), /Independent/);
  await assert.rejects(observeQuoteStage(f.plan, 2, f.providers), /stage/);
  const empty = providersFor(plan, { balance: '0x0' });
  await assert.rejects(prepareWalletRequest(empty.plan, 0, empty.providers, ceilings, observeQuoteStage), /insufficient/);
});
test('An occupied matching converter requires its receipt and exact immutable getter readback', async () => {
  const { plan } = fixture(), f = providersFor(plan, { deployed: QUOTE_ROLES });
  const result = await observeQuoteStage(f.plan, 1, f.providers); assert.equal(result.state, 'already-deployed-receipt-required');
  assert.deepEqual(result.quoteBindings.deployedRoles, QUOTE_ROLES);
  assert.equal(result.quoteBindings.reads['converter.factoryCodeHash'], f.plan.dependencies.v3Factory.runtimeCodeHash);
  assert.throws(() => walletRequest(f.plan, result, ceilings), /vacant/);
  const bad = providersFor(plan, { deployed: QUOTE_ROLES, converterHash: h('wrong-immutable') });
  await assert.rejects(observeQuoteBindings(bad.plan, bad.providers, bad.blockNumber, bad.blockHash, QUOTE_ROLES), /getter differs/);
});
test('Shared pre-arm revalidation and same-nonce retry preserve the Quote payload; continuation remains closed', async () => {
  const { plan } = fixture(), f = providersFor(plan);
  const prepared = await prepareWalletRequest(f.plan, 0, f.providers, ceilings, observeQuoteStage);
  await revalidateWalletRequest(f.plan, prepared, f.providers, ceilings, observeQuoteStage);
  assert.deepEqual(walletRetryRequest(f.plan, prepared, prepared.observation, ceilings, prepared.requestDigest), prepared.request);
  const changed = structuredClone(prepared); changed.request.value = '0x1';
  assert.throws(() => walletRetryRequest(f.plan, changed, prepared.observation, ceilings, prepared.requestDigest), /digest differs/);
  assert.throws(() => assertContinuationPlan(plan, plan), /basis/);
});
test('A real receipt observer binds exact owner payload and rechecks all converter dependency pins at inclusion', async () => {
  const { plan } = fixture(), f = providersFor(plan), observation = await observeQuoteStage(f.plan, 0, f.providers);
  const entry = { stepIndex: 1, request: { ...walletRequest(plan, { ...observation, stepIndex: 1 }, ceilings) }, transactionHash: h('converter-tx') };
  const mined = providersFor(plan, { deployed: QUOTE_ROLES, entry }), result = await observeQuoteReceipt(mined.plan, entry, mined.providers);
  assert.equal(result.status, 'included-code-verified-unfinalized'); assert.equal(result.role, 'converter');
  assert.deepEqual(result.quoteBindings.deployedRoles, QUOTE_ROLES); assert.equal(result.quoteBindings.blockHash, result.receipt.blockHash);
  const wrong = providersFor(plan, { deployed: QUOTE_ROLES, entry, wrongInput: true });
  await assert.rejects(observeQuoteReceipt(wrong.plan, entry, wrong.providers), /does not match/);
});

function sourceEvidence(plan) {
  const records = plan.steps.map((step, i) => {
    const txHash = h(`deployment-${i}`), blockHash = h(`deployment-block-${i}`), blockNumber = toHex(BigInt(10 + i));
    return { stepIndex: i, role: step.role, status: 'included-code-verified-unfinalized',
      transaction: { hash: txHash, from: step.sender, to: step.to, input: step.data, value: '0x0', type: '0x2', chainId: '0x1237', blockHash, blockNumber },
      receipt: { status: '0x1', transactionHash: txHash, blockHash, blockNumber, transactionIndex: '0x0' },
      contracts: { [step.role]: plan.identityCandidate.contracts[step.role] },
      quoteBindings: { schemaVersion: 'programmable.module-engine-quote-bindings.v1', chainId: 4663, planDigest: plan.planDigest,
        blockNumber, blockHash, dependencies: plan.dependencies, deployedRoles: QUOTE_ROLES.slice(0, i + 1),
        wethProxy: proxyObservation(plan, blockNumber, blockHash) } };
  });
  return { schemaVersion: QUOTE_DEPLOYMENT_SCHEMA, chainId: 4663, sourceVersion: plan.identityCandidate.sourceVersion,
    sourceCommit: plan.sourceCommit, planDigest: plan.planDigest, buildDigest: plan.buildDigest, status: 'included-code-verified',
    infrastructureDigest: quoteInfrastructureIdentity(plan, '11').infrastructureDigest, records };
}
test('Source requests require both exact ordered zero-value CREATE2 receipt lineages, never a prediction', () => {
  const { plan, build } = fixture(), requests = quoteSourceRequests(plan, build), evidence = sourceEvidence(plan);
  assert.deepEqual(Object.keys(requests), QUOTE_ROLES);
  for (const request of Object.values(requests)) { assert.equal(request.body.creationTransactionHash, undefined); assert.match(request.status, /incomplete/); }
  assert.equal(quoteSourceCreation(plan, 'converter', evidence).deployer, plan.official.deterministicDeployer.address);
  assert.equal(quoteSourceRequests(plan, build, evidence).converter.body.creationTransactionHash, h('deployment-1'));
  for (const mutate of [e => { e.records.pop(); }, e => { e.records[0].transaction.from = addr(99); }, e => { e.records[1].transaction.to = addr(99); },
    e => { e.records[1].transaction.input = '0x'; }, e => { e.records[1].quoteBindings.blockHash = h('other'); },
    e => { e.records[1].contracts.converter.runtimeCodeHash = h('other'); }, e => { e.infrastructureDigest = h('other'); },
    e => { delete e.records[1].quoteBindings.wethProxy; }, e => { e.records[0].quoteBindings.wethProxy.blockHash = h('other'); },
    e => { e.records[0].quoteBindings.wethProxy.implementationRuntime = '0x00'; },
    e => { e.records[0].quoteBindings.wethProxy.implementation = addr(99); },
    e => { e.records[0].quoteBindings.wethProxy.adminStorageValue = storageWord(addr(99)); },
    e => { e.schemaVersion = 'programmable.module-engine-deployment-evidence.v1'; }, e => { e.records.reverse(); }]) {
    const bad = structuredClone(evidence); mutate(bad); assert.throws(() => quoteSourceCreation(plan, 'converter', bad));
  }
});
test('The retained Forwarder uses its exact historical source evidence and keeps the original creation transaction', () => {
  const { plan, build, previousRaw } = fixture(), reused = quoteSourceReuse(plan, build, previousRaw);
  assert.equal(reused.creationTransactionHash, h('historical-forwarder')); assert.equal(reused.reuse.newCreationTransaction, false);
  assert.throws(() => quoteSourceReuse(plan, build, Buffer.concat([previousRaw, Buffer.from(' ')])), /historical source/);
  const bad = structuredClone(build); bad.standardInputs.positionForwarderFactory.sources['src/injected.sol'] = { content: '// extra' };
  assert.throws(() => quoteSourceReuse(plan, bad, previousRaw), /closure/);
});
test('Both Quote preview routes render only the gas payer, all infrastructure pins and disabled mutations', async () => {
  const { plan } = fixture(), source = await readFile(new URL('../module-mode/operator.js', import.meta.url), 'utf8');
  for (const stepIndex of [0, 1]) {
    const { server, url } = await startOperator({ plan, stepIndex, uiCheck: true, port: 18791 + stepIndex });
    try {
      const html = await (await fetch(url)).text(), token = html.match(/name="operator-token" content="([a-f0-9]+)"/)[1];
      const headers = { origin: url, 'x-module-operator-token': token, 'content-type': 'application/json' };
      const state = await (await fetch(`${url}/state`, { method: 'POST', headers, body: '{}' })).json();
      assert.equal(state.sourceVersion, 'module-engine-quote-v1'); assert.equal(state.economics, undefined);
      assert.deepEqual(Object.keys(state.quoteInfrastructure.contracts), QUOTE_ROLES); assert.equal(state.value, '0');
      for (const route of ['/prepare', '/arm', '/prepare-retry', '/arm-retry', '/record', '/receipt']) {
        const response = await fetch(`${url}${route}`, { method: 'POST', headers, body: '{}' });
        assert.equal(response.status, 400); assert.match((await response.json()).error, /UI-check/);
      }
      const elements = new Map(), calls = [];
      const element = () => ({ hidden: false, disabled: false, checked: false, textContent: '', value: '', children: [],
        append(...nodes) { this.children.push(...nodes); }, focus() {}, querySelector() { return element(); } });
      const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
      runInNewContext(source, { document: { getElementById: get, querySelector: () => ({ content: token }), createElement: element },
        window: {}, fetch: async route => { calls.push(route); assert.equal(route, '/state'); return { ok: true, json: async () => state }; } });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(get('error').textContent, ''); assert.equal(get('minimum-row').hidden, true); assert.equal(get('connect').hidden, true);
      assert.equal(get('title').textContent, stepIndex === 0 ? 'Quote liquidity planner' : 'Quote to ETH converter');
      assert.equal(get('wallets-title').textContent, 'Gas payer'); assert.equal(get('wallets').children.length, 1);
      assert.equal(get('quote-pins').children.length, 18); assert.match(get('economics-summary').textContent, /Neither contract has administrative permissions/);
      assert.doesNotMatch(get('economics-summary').textContent, /bps|Treasury|Creator/);
      await get('prepare').onclick(); assert.equal(get('technical').open, true); assert.deepEqual(calls, ['/state']);
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
});
