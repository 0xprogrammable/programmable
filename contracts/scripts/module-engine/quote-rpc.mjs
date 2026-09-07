import { decodeFunctionResult, encodeFunctionData, keccak256, parseAbi } from 'viem';
import { address, bytes, canonicalJson, hash, hexQuantity, jsonSafe, need } from '../module-mode/core.mjs';
import { observeReceipt } from '../module-mode/rpc.mjs';
import { assertQuoteProfile, QUOTE_ROLES } from './quote-core.mjs';

export const WETH_PROXY_OBSERVATION_SCHEMA = 'programmable.module-engine-quote-weth-proxy-observation.v1';
export const WETH_IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
export const WETH_ADMIN_SLOT = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';

function slotAddress(value) {
  const word = hash(value, 'WETH proxy storage word');
  need(word.slice(2, 26) === '0'.repeat(24), 'WETH proxy slot is not a canonical address');
  return address(`0x${word.slice(26)}`, 'WETH proxy slot address');
}
/** The observation binds external proxy state at one block; it cannot freeze future upgrades. */
export function assertQuoteWethProxyObservation(plan, bindings) {
  const value = bindings?.wethProxy;
  need(value?.schemaVersion === WETH_PROXY_OBSERVATION_SCHEMA && value.proxy === plan.dependencies.weth.address
    && value.proxyRuntimeCodeHash === plan.dependencies.weth.runtimeCodeHash && value.blockNumber === bindings.blockNumber
    && value.blockHash === bindings.blockHash && value.implementationSlot === WETH_IMPLEMENTATION_SLOT
    && value.adminSlot === WETH_ADMIN_SLOT && value.externalUpgradeAssumption === 'snapshot-only-not-immutable-implementation',
  'Bound WETH proxy observation required');
  need(value.implementation === slotAddress(value.implementationStorageValue) && value.admin === slotAddress(value.adminStorageValue),
    'WETH proxy slot/address binding differs');
  const runtime = bytes(value.implementationRuntime, 'WETH implementation runtime');
  need(runtime !== '0x' && keccak256(runtime) === hash(value.implementationRuntimeCodeHash), 'WETH implementation runtime hash differs');
  return value;
}

function pairRequired(providers) {
  need(Array.isArray(providers) && providers.length === 2 && providers.every(p => typeof p.providerId === 'string' && p.providerId
    && typeof p.trustDomain === 'string' && p.trustDomain) && providers[0].providerId !== providers[1].providerId
    && providers[0].trustDomain !== providers[1].trustDomain, 'Independent provider quorum required');
}
function q(value) { need(typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value), 'Canonical RPC quantity required'); return BigInt(value); }
async function pair(providers, method, params, label) {
  const values = await Promise.all(providers.map(p => p.rpc(method, params)));
  need(canonicalJson(values[0]) === canonicalJson(values[1]), `Provider disagreement: ${label ?? method}`); return values[0];
}
function publicProviders(providers) {
  return providers.map(({ role, providerId, trustDomain, authentication, endpointCommitment }) => ({ role, providerId, trustDomain, authentication, endpointCommitment }));
}
async function code(providers, pin, block, vacant = false) {
  const runtime = bytes(await pair(providers, 'eth_getCode', [pin.address, block], `code ${pin.address}`));
  if (runtime === '0x' && vacant) return false;
  need(runtime !== '0x' && keccak256(runtime) === pin.runtimeCodeHash, `Quote runtime differs at ${pin.address}`); return true;
}
async function blockAt(providers, number, expectedHash) {
  const blocks = await Promise.all(providers.map(p => p.rpc('eth_getBlockByNumber', [number, false])));
  need(blocks.every(b => b && q(b.number) === q(number) && hash(b.hash) === expectedHash), 'Quote block changed or reorganized');
  need(canonicalJson(blocks.map(b => [b.number, b.hash, b.timestamp, b.baseFeePerGas])[0])
    === canonicalJson(blocks.map(b => [b.number, b.hash, b.timestamp, b.baseFeePerGas])[1]), 'Provider disagreement: block');
  return blocks[0];
}
async function commonBlock(providers) {
  need(q(await pair(providers, 'eth_chainId', [])) === 4663n, 'Wrong chain');
  const heads = await Promise.all(providers.map(p => p.rpc('eth_getBlockByNumber', ['latest', false]))), heights = heads.map(b => q(b.number));
  const low = heights[0] < heights[1] ? 0 : 1; need(heights[1 - low] - heights[low] <= 4n, 'Provider head gap exceeds four blocks');
  const b = await blockAt(providers, heads[low].number, hash(heads[low].hash));
  const age = BigInt(Math.floor(Date.now() / 1000)) - q(b.timestamp); need(age >= -30n && age <= 300n, 'Quote block is stale or future dated'); return b;
}

/** Seven retained runtime pins and their dependency links are checked at one block, before any wallet request. */
export async function observeQuoteBindings(plan, providers, blockNumber, blockHash, deployedRoles = []) {
  assertQuoteProfile(plan); pairRequired(providers);
  need(deployedRoles.every(role => QUOTE_ROLES.includes(role)) && new Set(deployedRoles).size === deployedRoles.length, 'Unknown deployed Quote role');
  need(q(await pair(providers, 'eth_chainId', [])) === 4663n, 'Wrong chain');
  const block = hexQuantity(blockNumber); await blockAt(providers, block, hash(blockHash));
  const reads = {}, d = plan.dependencies;
  for (const pin of Object.values(d)) await code(providers, pin, block);
  const [implementationStorageValue, adminStorageValue] = await Promise.all([
    pair(providers, 'eth_getStorageAt', [d.weth.address, WETH_IMPLEMENTATION_SLOT, block], 'WETH implementation slot'),
    pair(providers, 'eth_getStorageAt', [d.weth.address, WETH_ADMIN_SLOT, block], 'WETH admin slot'),
  ]);
  const implementation = slotAddress(implementationStorageValue), admin = slotAddress(adminStorageValue);
  const implementationRuntime = bytes(await pair(providers, 'eth_getCode', [implementation, block], 'WETH implementation runtime'));
  need(implementationRuntime !== '0x', 'WETH implementation has no runtime');
  const wethProxy = { schemaVersion: WETH_PROXY_OBSERVATION_SCHEMA, proxy: d.weth.address, proxyRuntimeCodeHash: d.weth.runtimeCodeHash,
    blockNumber: BigInt(blockNumber).toString(), blockHash, implementationSlot: WETH_IMPLEMENTATION_SLOT,
    implementationStorageValue: hash(implementationStorageValue), implementation, implementationRuntime,
    implementationRuntimeCodeHash: keccak256(implementationRuntime), adminSlot: WETH_ADMIN_SLOT,
    adminStorageValue: hash(adminStorageValue), admin, externalUpgradeAssumption: 'snapshot-only-not-immutable-implementation' };
  async function getter(role, target, signature, expected) {
    const abi = parseAbi([signature]), functionName = abi[0].name;
    const result = decodeFunctionResult({ abi, functionName,
      data: await pair(providers, 'eth_call', [{ to: target, data: encodeFunctionData({ abi, functionName }) }, block], `${role}.${functionName}`) });
    const normalized = typeof result === 'string' && /^0x[0-9a-fA-F]{40}$/.test(result) ? address(result) : jsonSafe(result);
    need(canonicalJson(normalized) === canonicalJson(expected), `Quote dependency getter differs: ${role}.${functionName}`); reads[`${role}.${functionName}`] = normalized;
  }
  await getter('positionManager', d.positionManager.address, 'function poolManager() view returns (address)', d.poolManager.address);
  await getter('positionForwarderFactory', d.positionForwarderFactory.address, 'function positionManager() view returns (address)', d.positionManager.address);
  await getter('router', d.router.address, 'function factory() view returns (address)', d.v3Factory.address);
  await getter('router', d.router.address, 'function WETH9() view returns (address)', d.weth.address);
  for (const role of deployedRoles) await code(providers, plan.contracts[role], block);
  if (deployedRoles.includes('converter')) {
    for (const [field, role] of [['router', 'router'], ['factory', 'v3Factory'], ['weth', 'weth']]) {
      await getter('converter', plan.contracts.converter.address, `function ${field}() view returns (address)`, d[role].address);
      await getter('converter', plan.contracts.converter.address, `function ${field}CodeHash() view returns (bytes32)`, d[role].runtimeCodeHash);
    }
  }
  await blockAt(providers, block, blockHash);
  const bindings = { schemaVersion: 'programmable.module-engine-quote-bindings.v1', chainId: 4663, planDigest: plan.planDigest,
    blockNumber: BigInt(blockNumber).toString(), blockHash, dependencies: d, deployedRoles, reads, wethProxy, providers: publicProviders(providers) };
  assertQuoteWethProxyObservation(plan, bindings); return bindings;
}
export async function observeQuoteStage(plan, stepIndex, providers) {
  assertQuoteProfile(plan); pairRequired(providers);
  need(Number.isSafeInteger(stepIndex) && stepIndex >= 0 && stepIndex < 2, 'Unknown Quote stage');
  const step = plan.steps[stepIndex], block = await commonBlock(providers), completed = QUOTE_ROLES.slice(0, stepIndex);
  const quoteBindings = await observeQuoteBindings(plan, providers, block.number, block.hash, completed);
  if (await code(providers, plan.contracts[step.role], block.number, true)) {
    const deployedBindings = await observeQuoteBindings(plan, providers, block.number, block.hash, [...completed, step.role]);
    return { state: 'already-deployed-receipt-required', stepIndex, blockNumber: q(block.number).toString(), blockHash: block.hash, quoteBindings: deployedBindings };
  }
  need(q(await pair(providers, 'eth_getTransactionCount', [step.target, block.number], 'target nonce')) === 0n, 'CREATE2 target nonce is not zero');
  need(await pair(providers, 'eth_getCode', [step.sender, block.number], 'owner code') === '0x', 'Existing owner operator requires the reviewed EOA');
  const latest = await pair(providers, 'eth_getTransactionCount', [step.sender, 'latest'], 'owner nonce');
  const pending = await pair(providers, 'eth_getTransactionCount', [step.sender, 'pending'], 'pending nonce'); need(latest === pending, 'Owner has a pending transaction');
  const balances = await Promise.all(providers.map(p => p.rpc('eth_getBalance', [step.sender, 'pending'])));
  const minimumBalance = balances.map(q).reduce((a, b) => a < b ? a : b);
  const call = { from: step.sender, to: step.to, value: '0x0', data: step.data };
  need(bytes(await pair(providers, 'eth_call', [call, block.number], 'CREATE2 simulation')) === step.target, 'CREATE2 returned a different target');
  const estimates = (await Promise.all(providers.map(p => p.rpc('eth_estimateGas', [call, block.number])))).map(q);
  const max = estimates.reduce((a, b) => a > b ? a : b), min = estimates.reduce((a, b) => a < b ? a : b);
  need(max - min <= 1000n + max / 10000n, 'Provider gas estimates disagree');
  await blockAt(providers, block.number, block.hash);
  return { state: 'vacant-simulated', stepIndex, blockNumber: q(block.number).toString(), blockHash: block.hash, nonce: q(pending).toString(),
    minimumBalance: minimumBalance.toString(), baseFeePerGas: q(block.baseFeePerGas).toString(), estimates: estimates.map(String),
    gasLimit: ((max * 10500n + 9999n) / 10000n + 25000n).toString(), observedAt: new Date().toISOString(),
    providers: publicProviders(providers), quoteBindings, authority: 'read-only-not-wallet-authority' };
}
export async function observeQuoteReceipt(plan, entry, providers) {
  assertQuoteProfile(plan);
  const result = await observeReceipt(plan, entry, providers);
  if (result.status !== 'included-code-verified-unfinalized') return result;
  return { ...result, quoteBindings: await observeQuoteBindings(plan, providers, result.receipt.blockNumber,
    result.receipt.blockHash, QUOTE_ROLES.slice(0, entry.stepIndex + 1)) };
}
