import { encodeFunctionData, decodeFunctionResult, keccak256, parseAbi } from 'viem';
import { assertRobinhoodFoundationRpcProviders } from '../robinhood-custom-launch-owner-envelope-core.mjs';
import { resolveReviewedRobinhoodProviderCommitments } from '../robinhood-custom-launch-provider-commitment-custody.mjs';
import { OFFICIAL, address, bytes, canonicalJson, digest, exactKeys, hash, hexQuantity, need, uint } from './core.mjs';
import { REPOSITORY_ROOT } from './build.mjs';

const METHODS = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getTransactionCount', 'eth_getBalance', 'eth_getCode', 'eth_call', 'eth_estimateGas', 'eth_getTransactionByHash', 'eth_getTransactionReceipt']);
const MAX_BYTES = 4 * 1024 * 1024;
export async function reviewedProviders(environment = process.env) {
  const urls = [environment.ROBINHOOD_MAINNET_RPC_URL_PRIMARY, environment.ROBINHOOD_MAINNET_RPC_URL_SECONDARY];
  const commitments = await resolveReviewedRobinhoodProviderCommitments({ env: environment, repositoryRoot: REPOSITORY_ROOT });
  const bindings = assertRobinhoodFoundationRpcProviders({ rpcUrls: urls, endpointCommitments: commitments });
  return bindings.map((binding, index) => ({ ...binding, rpc: rpcClient(urls[index], binding.providerId) }));
}
/** This client cannot send a transaction, sign, impersonate, modify state or use debug RPC. */
export function rpcClient(url, label, fetchImpl = fetch) {
  let nextId = 0; let tail = Promise.resolve();
  return async function rpc(method, params = []) {
    need(METHODS.has(method), 'RPC method is outside the read-only inventory');
    const start = tail; let release; tail = new Promise(resolve => { release = resolve; }); await start;
    try {
      const response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error',
        body: JSON.stringify({ jsonrpc: '2.0', id: ++nextId, method, params }), signal: AbortSignal.timeout(15000) });
      need(response.ok, `${label}: ${method} HTTP request failed`);
      const chunks = []; let total = 0;
      for await (const chunk of response.body) { total += chunk.length; need(total <= MAX_BYTES, 'RPC response limit exceeded'); chunks.push(chunk); }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      need(payload.jsonrpc === '2.0' && payload.id === nextId && !payload.error && Object.hasOwn(payload, 'result'), `${label}: ${method} RPC response failed`);
      return payload.result;
    } catch { throw new Error(`${label}: ${method} read failed`); }
    finally { release(); }
  };
}
function quantity(value, label) { need(typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value), `${label}: invalid RPC quantity`); return BigInt(value); }
async function pair(providers, method, params) { return Promise.all(providers.map(provider => provider.rpc(method, params))); }
function same(values, label) { need(canonicalJson(values[0]) === canonicalJson(values[1]), `Provider disagreement: ${label}`); return values[0]; }
function publicBindings(providers) {
  return providers.map(({ role, providerId, trustDomain, authentication, endpointCommitment }) => ({ role, providerId, trustDomain, authentication, endpointCommitment }));
}
async function commonBlock(providers) {
  const chains = await pair(providers, 'eth_chainId', []); need(chains.every(id => quantity(id, 'chainId') === 4663n), 'Wrong chain');
  const heads = await pair(providers, 'eth_getBlockByNumber', ['latest', false]);
  const numbers = heads.map(block => quantity(block.number, 'head')); const gap = numbers[0] > numbers[1] ? numbers[0] - numbers[1] : numbers[1] - numbers[0]; need(gap <= 4n, 'Provider head gap exceeds four blocks');
  const number = numbers[0] < numbers[1] ? numbers[0] : numbers[1];
  const blocks = await pair(providers, 'eth_getBlockByNumber', [hexQuantity(number), false]);
  need(blocks.every(block => block && quantity(block.number, 'block') === number), 'Missing common block');
  same(blocks.map(block => ({ hash: hash(block.hash), number: block.number, timestamp: block.timestamp, baseFeePerGas: block.baseFeePerGas })), 'common block');
  const age = BigInt(Math.floor(Date.now() / 1000)) - quantity(blocks[0].timestamp, 'timestamp'); need(age >= -30n && age <= 300n, 'RPC block is stale or future dated');
  return blocks[0];
}
async function readCode(providers, pin, block, allowEmpty = false) {
  const code = same(await pair(providers, 'eth_getCode', [pin.address, block]), `code ${pin.address}`);
  bytes(code); if (code === '0x' && allowEmpty) return false;
  need(code !== '0x' && keccak256(code) === pin.runtimeCodeHash, `Runtime code mismatch at ${pin.address}`); return true;
}
async function getter(providers, target, signature, block) {
  const abi = parseAbi([signature]); const fn = abi[0].name; const data = encodeFunctionData({ abi, functionName: fn });
  const result = same(await pair(providers, 'eth_call', [{ to: target, data }, block]), `getter ${fn}`);
  return decodeFunctionResult({ abi, functionName: fn, data: result });
}
function requirePair(providers) { need(Array.isArray(providers) && providers.length === 2 && providers[0].trustDomain !== providers[1].trustDomain && providers[0].providerId !== providers[1].providerId, 'Independent provider quorum required'); }
export async function observeStage(plan, stepIndex, providers) {
  requirePair(providers); const step = plan.steps[stepIndex]; need(step, 'Unknown deployment stage'); const block = await commonBlock(providers);
  for (const pin of Object.values(OFFICIAL)) await readCode(providers, pin, block.number);
  need(address(await getter(providers, OFFICIAL.positionManager.address, 'function poolManager() view returns (address)', block.number)) === OFFICIAL.poolManager.address, 'PositionManager binding changed');
  const completedRoles = plan.steps.slice(0, stepIndex).flatMap(previous => previous.expectedRoles);
  for (const role of completedRoles) await readCode(providers, plan.contracts[role], block.number);
  if (stepIndex > plan.steps.findIndex(stage => stage.role === 'registry')) need(address(await getter(providers, plan.contracts.registry.address, 'function owner() view returns (address)', block.number)) === plan.parameters.reviewAuthority, 'Review authority differs');
  const exists = await readCode(providers, plan.contracts[step.role], block.number, true);
  if (exists) return { state: 'already-deployed-receipt-required', stepIndex, blockNumber: quantity(block.number).toString(), blockHash: block.hash };
  // A counterfactual target with a nonzero nonce cannot be used by CREATE2 even if code is empty.
  const targetNonce = same(await pair(providers, 'eth_getTransactionCount', [step.target, 'latest']), 'target nonce'); need(quantity(targetNonce) === 0n, 'CREATE2 target nonce is not zero');
  const ownerCode = same(await pair(providers, 'eth_getCode', [step.sender, block.number]), 'deployer code'); need(ownerCode === '0x', 'This EIP-1559 owner operator requires the reviewed EOA, not an unhandled smart-account route');
  const latest = same(await pair(providers, 'eth_getTransactionCount', [step.sender, 'latest']), 'latest owner nonce');
  const pending = same(await pair(providers, 'eth_getTransactionCount', [step.sender, 'pending']), 'pending owner nonce'); need(latest === pending, 'Owner has a pending transaction');
  const balances = await pair(providers, 'eth_getBalance', [step.sender, 'pending']); const minimumBalance = balances.map(v => quantity(v)).reduce((a, b) => a < b ? a : b);
  const call = { from: step.sender, to: step.to, value: '0x0', data: step.data };
  const calls = await pair(providers, 'eth_call', [call, 'latest']); const result = same(calls, 'constructor simulation');
  need(bytes(result) === step.target, 'CREATE2 simulation returned another address');
  const estimates = (await pair(providers, 'eth_estimateGas', [call])).map(value => quantity(value, 'gas estimate'));
  const maximumEstimate = estimates.reduce((a, b) => a > b ? a : b); const minimumEstimate = estimates.reduce((a, b) => a < b ? a : b);
  need(maximumEstimate - minimumEstimate <= 1000n + maximumEstimate / 10000n, 'Provider gas estimates disagree');
  const closing = await pair(providers, 'eth_getBlockByNumber', [block.number, false]); need(closing.every(value => value?.hash === block.hash), 'Snapshot block was reorganized');
  return { state: 'vacant-simulated', stepIndex, blockNumber: quantity(block.number).toString(), blockHash: block.hash,
    nonce: quantity(pending).toString(), minimumBalance: minimumBalance.toString(), baseFeePerGas: quantity(block.baseFeePerGas).toString(),
    estimates: estimates.map(value => value.toString()), gasLimit: ((maximumEstimate * 10500n + 9999n) / 10000n + 25000n).toString(),
    observedAt: new Date().toISOString(), providers: publicBindings(providers) };
}
export function walletRequest(plan, observation, ceilings) {
  exactKeys(ceilings, ['maxGas', 'maxFeePerGas', 'maxPriorityFeePerGas'], 'fee ceilings');
  for (const key of Object.keys(ceilings)) uint(ceilings[key], key, key !== 'maxPriorityFeePerGas');
  need(observation.state === 'vacant-simulated', 'Only a vacant simulated stage can be armed');
  const step = plan.steps[observation.stepIndex]; need(step, 'Unknown stage');
  need(BigInt(observation.gasLimit) <= BigInt(ceilings.maxGas), 'Gas estimate exceeds the owner-reviewed gas limit');
  const maxFee = BigInt(ceilings.maxFeePerGas), priority = BigInt(ceilings.maxPriorityFeePerGas);
  need(priority <= maxFee && 2n * BigInt(observation.baseFeePerGas) + priority <= maxFee, 'Fee ceiling cannot safely cover the current base fee');
  need(BigInt(observation.minimumBalance) >= BigInt(observation.gasLimit) * maxFee, 'Deployer has insufficient native ETH for maximum gas cost');
  return { chainId: '0x1237', from: step.sender, to: step.to, value: '0x0', data: step.data, nonce: hexQuantity(observation.nonce),
    gas: hexQuantity(observation.gasLimit), maxFeePerGas: hexQuantity(maxFee), maxPriorityFeePerGas: hexQuantity(priority), accessList: [], type: '0x2' };
}
export async function prepareWalletRequest(plan, stepIndex, providers, ceilings) {
  const observation = await observeStage(plan, stepIndex, providers); const request = walletRequest(plan, observation, ceilings);
  const issued = Date.now(); const prepared = { planDigest: plan.planDigest, stepIndex, request, observation, issuedAt: issued, expiresAt: issued + 300000 };
  return { ...prepared, requestDigest: digest('programmable.module-mode-owner-request.v1', prepared) };
}
export async function revalidateWalletRequest(plan, prepared, providers, ceilings) {
  need(prepared.planDigest === plan.planDigest && Date.now() >= prepared.issuedAt && prepared.expiresAt - Date.now() >= 60000, 'Owner request expired or belongs to another plan');
  const fresh = await observeStage(plan, prepared.stepIndex, providers); const request = walletRequest(plan, fresh, ceilings);
  need(request.nonce === prepared.request.nonce, 'Owner nonce changed');
  // Keep the reviewed payload and gas. A fresh estimate may shrink but may not exceed the reviewed allowance.
  need(BigInt(request.gas) <= BigInt(prepared.request.gas), 'Fresh gas estimate exceeds reviewed request');
  for (const key of ['chainId', 'from', 'to', 'value', 'data', 'maxFeePerGas', 'maxPriorityFeePerGas', 'type']) need(request[key] === prepared.request[key], `Owner request changed: ${key}`);
  need(BigInt(fresh.minimumBalance) >= BigInt(prepared.request.gas) * BigInt(prepared.request.maxFeePerGas), 'Owner balance fell below reviewed maximum cost');
  return fresh;
}
export async function observeReceipt(plan, entry, providers) {
  requirePair(providers); const txHash = hash(entry.transactionHash, 'transactionHash'); const step = plan.steps[entry.stepIndex]; need(step, 'Unknown receipt stage');
  const txs = await pair(providers, 'eth_getTransactionByHash', [txHash]); need(txs[0] && txs[1], 'Transaction not observed by both providers');
  const tx = same(txs.map(t => ({ hash: t.hash, from: address(t.from), to: address(t.to), input: bytes(t.input), value: t.value, nonce: t.nonce, chainId: t.chainId, type: t.type, gas: t.gas,
    maxFeePerGas: t.maxFeePerGas, maxPriorityFeePerGas: t.maxPriorityFeePerGas, blockHash: t.blockHash, blockNumber: t.blockNumber })), 'transaction');
  const request = entry.request; need(tx.hash === txHash && tx.from === step.sender && tx.to === step.to && tx.input === step.data && quantity(tx.value) === 0n && quantity(tx.chainId) === 4663n && quantity(tx.type) === 2n, 'Receipt transaction does not match the deployment');
  need(tx.nonce === request.nonce && tx.gas === request.gas && tx.maxFeePerGas === request.maxFeePerGas && tx.maxPriorityFeePerGas === request.maxPriorityFeePerGas, 'Wallet changed the reviewed nonce or gas fields');
  const receipts = await pair(providers, 'eth_getTransactionReceipt', [txHash]);
  if (!receipts[0] || !receipts[1]) return { status: 'pending', transactionHash: txHash };
  const receipt = same(receipts.map(r => ({ transactionHash: r.transactionHash, blockHash: r.blockHash, blockNumber: r.blockNumber, status: r.status, gasUsed: r.gasUsed, transactionIndex: r.transactionIndex })), 'receipt');
  need(receipt.transactionHash === txHash && receipt.blockHash === tx.blockHash && receipt.blockNumber === tx.blockNumber, 'Transaction/receipt inclusion mismatch');
  const blocks = await pair(providers, 'eth_getBlockByNumber', [receipt.blockNumber, false]);
  need(blocks.every(block => block?.hash === receipt.blockHash && block.transactions.includes(txHash)), 'Receipt is not in the canonical block');
  need(quantity(receipt.status) === 1n, 'Transaction reverted; prove vacancy and explicitly resolve before any retry');
  for (const role of step.expectedRoles) await readCode(providers, plan.contracts[role], receipt.blockNumber);
  return { status: 'included-code-verified-unfinalized', chainId: 4663, stepIndex: entry.stepIndex, role: step.role,
    transaction: tx, receipt, contracts: Object.fromEntries(step.expectedRoles.map(role => [role, { address: plan.contracts[role].address, runtimeCodeHash: plan.contracts[role].runtimeCodeHash }])),
    providers: publicBindings(providers) };
}
