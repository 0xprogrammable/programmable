import { decodeEventLog, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, keccak256, parseAbiParameters } from 'viem';
import { OFFICIAL, address, bytes, canonicalJson, digest, exactKeys, hash, hexQuantity, jsonSafe, need, uint } from './core.mjs';
import { registryAbi, ZERO_ADDRESS } from './publication-plan.mjs';
import { publicationValidators } from './publication-shared.mjs';
const REQUEST_DOMAIN = 'programmable.module-mode-publication-owner-request.v1';
export function operationQuantity(value) { need(typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value), 'Invalid RPC quantity'); return BigInt(value); }
const pair = (providers, method, params) => Promise.all(providers.map(provider => provider.rpc(method, params)));
function same(values, label) { need(canonicalJson(values[0]) === canonicalJson(values[1]), `Provider disagreement: ${label}`); return values[0]; }
function requirePair(providers) { need(Array.isArray(providers) && providers.length === 2 && providers[0].trustDomain !== providers[1].trustDomain && providers[0].providerId !== providers[1].providerId, 'Independent provider quorum required'); }
const publicBindings = providers => providers.map(({ role, providerId, trustDomain, authentication, endpointCommitment }) => ({ role, providerId, trustDomain, authentication, endpointCommitment }));
async function blockSnapshot(providers) {
  requirePair(providers); need((await pair(providers, 'eth_chainId', [])).every(value => operationQuantity(value) === 4663n), 'Wrong chain');
  const heads = await pair(providers, 'eth_getBlockByNumber', ['latest', false]), numbers = heads.map(value => operationQuantity(value.number));
  const lower = numbers[0] < numbers[1] ? numbers[0] : numbers[1], upper = numbers[0] > numbers[1] ? numbers[0] : numbers[1]; need(upper - lower <= 4n, 'Provider head gap exceeds four blocks');
  const block = same((await pair(providers, 'eth_getBlockByNumber', [hexQuantity(lower), false])).map(b => ({ number: b.number, hash: hash(b.hash), timestamp: b.timestamp, baseFeePerGas: b.baseFeePerGas })), 'common block');
  need(operationQuantity(block.number) === lower, 'Block number differs');
  const age = BigInt(Math.floor(Date.now() / 1000)) - operationQuantity(block.timestamp); need(age >= -30n && age <= 300n, 'RPC block is stale or future dated'); return block;
}
async function code(providers, pin, block) {
  const runtime = bytes(same(await pair(providers, 'eth_getCode', [pin.address, block]), 'runtime code'));
  need(runtime !== '0x' && keccak256(runtime) === pin.runtimeCodeHash, `Runtime code mismatch at ${pin.address}`); return runtime;
}
async function readConditions(providers, reads, block) {
  for (const read of reads) need(bytes(same(await pair(providers, 'eth_call', [{ to: read.to, data: read.data }, block]), read.functionName)) === read.result, `Onchain ${read.functionName} binding differs`);
}
async function read(providers, target, abi, functionName, args, block) {
  return decodeFunctionResult({ abi, functionName, data: bytes(same(await pair(providers, 'eth_call', [{ to: target, data: encodeFunctionData({ abi, functionName, args }) }, block]), functionName)) });
}
function poolId(plan, token) { return keccak256(encodeAbiParameters(parseAbiParameters('address,address,uint24,int24,address'), [ZERO_ADDRESS, token, 0, 200, plan.identity.contracts.hook.address])); }
function bindLaunchRecord(plan, step, result, initial = false) {
  const pins = plan.identity.contracts;
  need(result.token.toLowerCase() === step.target && result.launchWallet.toLowerCase() === plan.owner && result.hook.toLowerCase() === pins.hook.address
    && result.runtime.toLowerCase() === pins.runtime.address && result.poolId === poolId(plan, step.target), 'Canary launch identity differs');
  hash(result.launchId); hash(result.recipeHash); hash(result.launchKey);
  if (initial) need(result.initialBuyNative === BigInt(step.expectation.initialBuyNative)
    && result.initialBuyTokens >= BigInt(step.expectation.minimumTokenOut), 'Canary initial purchase differs');
  return result;
}
async function assertCanaryToken(plan, step, providers, block) {
  const api = await publicationValidators();
  const result = await read(providers, plan.identity.contracts.launcher.address, api.moduleNativeLaunchAbi, 'getLaunch', [step.target], block);
  bindLaunchRecord(plan, step, result, step.kind === 'launch'); return result;
}
export async function observePublicationOperation(plan, stepIndex, providers) {
  const step = plan.steps[stepIndex]; need(step, 'Unknown operation step'); const block = await blockSnapshot(providers);
  await Promise.all(Object.values(plan.identity.contracts).map(pin => code(providers, pin, block.number)));
  if (step.kind === 'factory') await code(providers, OFFICIAL.deterministicDeployer, block.number);
  const owner = await read(providers, plan.identity.contracts.registry.address, registryAbi, 'owner', [], block.number);
  need(address(owner) === plan.owner, 'Registry review authority differs');
  for (const previous of plan.steps.slice(0, stepIndex)) {
    for (const pin of previous.newCode) await code(providers, pin, block.number);
    await readConditions(providers, previous.postReads, block.number);
  }
  for (const pin of step.requiredCode ?? []) await code(providers, pin, block.number);
  await readConditions(providers, step.preReads, block.number);
  if (['factory', 'launch'].includes(step.kind)) {
    need(same(await pair(providers, 'eth_getCode', [step.target, block.number]), 'target vacancy') === '0x', 'Target is already deployed; reconcile its actual receipt');
    need(operationQuantity(same(await pair(providers, 'eth_getTransactionCount', [step.target, block.number]), 'target nonce')) === 0n, 'CREATE2 target has a nonzero nonce');
  } else if (['buy', 'approve', 'sell'].includes(step.kind)) await assertCanaryToken(plan, step, providers, block.number);
  if (step.deadline) {
    const remaining = BigInt(step.deadline) - operationQuantity(block.timestamp); need(remaining >= 120n && remaining <= 3600n, 'Canary deadline must be between two minutes and one hour from the observed block');
  }
  need(same(await pair(providers, 'eth_getCode', [plan.owner, block.number]), 'owner code') === '0x', 'This wallet route requires the reviewed EOA');
  const latest = same(await pair(providers, 'eth_getTransactionCount', [plan.owner, 'latest']), 'latest nonce');
  const pending = same(await pair(providers, 'eth_getTransactionCount', [plan.owner, 'pending']), 'pending nonce'); need(latest === pending, 'Owner has a pending transaction');
  const balances = (await pair(providers, 'eth_getBalance', [plan.owner, 'pending'])).map(operationQuantity); const minimumBalance = balances[0] < balances[1] ? balances[0] : balances[1];
  const call = { from: plan.owner, to: step.to, value: hexQuantity(step.value), data: step.data };
  const simulation = bytes(same(await pair(providers, 'eth_call', [call, block.number]), 'operation simulation'));
  const api = await publicationValidators(); let decoded = null;
  if (step.result !== null) need(simulation === step.result, 'Operation simulation returned an unexpected result');
  else if (step.kind === 'launch') decoded = jsonSafe(bindLaunchRecord(plan, step, decodeFunctionResult({ abi: api.moduleNativeLaunchAbi, functionName: 'launch', data: simulation }), true));
  else {
    const amounts = decodeFunctionResult({ abi: api.moduleNativeRouterAbi, functionName: 'swap', data: simulation });
    need(amounts[step.kind === 'buy' ? 0 : 1] === BigInt(step.expectation.amount) && amounts[step.kind === 'buy' ? 1 : 0] >= BigInt(step.expectation.minimumOut), 'Swap simulation differs from exact input or minimum output');
    decoded = jsonSafe({ nativeAmount: amounts[0], tokenAmount: amounts[1] });
  }
  const estimates = (await pair(providers, 'eth_estimateGas', [call])).map(operationQuantity), high = estimates[0] > estimates[1] ? estimates[0] : estimates[1], low = estimates[0] < estimates[1] ? estimates[0] : estimates[1];
  need(high - low <= 1000n + high / 10000n, 'Provider gas estimates disagree');
  need((await pair(providers, 'eth_getBlockByNumber', [block.number, false])).every(value => value?.hash === block.hash), 'Snapshot was reorganized');
  return { state: 'operation-simulated', stepIndex, blockNumber: operationQuantity(block.number).toString(), blockHash: block.hash,
    nonce: operationQuantity(pending).toString(), minimumBalance: minimumBalance.toString(), baseFeePerGas: operationQuantity(block.baseFeePerGas).toString(),
    gasLimit: ((high * 10500n + 9999n) / 10000n + 25000n).toString(), estimates: estimates.map(String), simulatedResult: decoded,
    observedAt: new Date().toISOString(), providers: publicBindings(providers) };
}
export function publicationWalletRequest(plan, observation, ceilings) {
  exactKeys(ceilings, ['maxGas', 'maxFeePerGas', 'maxPriorityFeePerGas', 'maxValue'], 'Owner reviewed ceilings');
  for (const key of Object.keys(ceilings)) uint(ceilings[key], key, ['maxGas', 'maxFeePerGas'].includes(key));
  need(observation.state === 'operation-simulated', 'A successful fresh operation simulation is required');
  const step = plan.steps[observation.stepIndex], maxFee = BigInt(ceilings.maxFeePerGas), priority = BigInt(ceilings.maxPriorityFeePerGas);
  need(step && BigInt(step.value) <= BigInt(ceilings.maxValue), 'ETH value exceeds the owner reviewed ceiling');
  need(BigInt(observation.gasLimit) <= BigInt(ceilings.maxGas), 'Gas estimate exceeds the owner reviewed ceiling');
  need(priority <= maxFee && 2n * BigInt(observation.baseFeePerGas) + priority <= maxFee, 'Fee ceiling cannot cover the current base fee');
  need(BigInt(observation.minimumBalance) >= BigInt(step.value) + BigInt(observation.gasLimit) * maxFee, 'Owner balance cannot cover ETH value and maximum gas cost');
  return { chainId: '0x1237', from: plan.owner, to: step.to, value: hexQuantity(step.value), data: step.data, nonce: hexQuantity(observation.nonce), gas: hexQuantity(observation.gasLimit),
    maxFeePerGas: hexQuantity(maxFee), maxPriorityFeePerGas: hexQuantity(priority), accessList: [], type: '0x2' };
}
export async function preparePublicationRequest(plan, stepIndex, providers, ceilings) {
  const observation = await observePublicationOperation(plan, stepIndex, providers), request = publicationWalletRequest(plan, observation, ceilings), issuedAt = Date.now();
  const body = { planDigest: plan.planDigest, stepIndex, request, observation, issuedAt, expiresAt: issuedAt + 300000 };
  return { ...body, requestDigest: digest(REQUEST_DOMAIN, body) };
}
export function assertPublicationRequest(plan, entry) {
  const requestDigest = entry.requestDigest, body = Object.fromEntries(Object.entries(entry).filter(([key]) => !['requestDigest', 'authority', 'state', 'transactionHash'].includes(key)));
  need(digest(body.retryAttempt ? 'programmable.module-mode-owner-retry.v1' : REQUEST_DOMAIN, body) === requestDigest && body.planDigest === plan.planDigest, 'Stored owner request digest differs');
  const step = plan.steps[body.stepIndex], request = body.request;
  need(step && request.from === plan.owner && request.to === step.to && request.data === step.data && request.value === hexQuantity(step.value)
    && request.chainId === '0x1237' && request.type === '0x2' && canonicalJson(request.accessList) === '[]', 'Stored wallet payload differs from typed operation'); return body;
}
export async function revalidatePublicationRequest(plan, prepared, providers, ceilings) {
  assertPublicationRequest(plan, prepared);
  need(Date.now() >= prepared.issuedAt && prepared.expiresAt - Date.now() >= 60000, 'Owner request has expired');
  const fresh = await observePublicationOperation(plan, prepared.stepIndex, providers), next = publicationWalletRequest(plan, fresh, ceilings);
  for (const key of Object.keys(next).filter(key => key !== 'gas')) need(canonicalJson(next[key]) === canonicalJson(prepared.request[key]), `Owner request changed: ${key}`);
  need(BigInt(next.gas) <= BigInt(prepared.request.gas), 'Fresh gas estimate exceeds the reviewed request');
  need(BigInt(fresh.minimumBalance) >= BigInt(prepared.request.value) + BigInt(prepared.request.gas) * BigInt(prepared.request.maxFeePerGas), 'Owner balance fell below value and maximum gas cost'); return fresh;
}
function receiptLogs(logs) {
  need(Array.isArray(logs) && logs.length <= 4096, 'Receipt logs are unavailable or exceed bounds');
  return logs.map(log => ({ address: address(log.address), topics: log.topics.map(topic => bytes(topic)), data: bytes(log.data),
    blockNumber: log.blockNumber, blockHash: hash(log.blockHash), transactionHash: hash(log.transactionHash),
    transactionIndex: log.transactionIndex, logIndex: log.logIndex, removed: log.removed ?? false }));
}
export async function observePublicationReceipt(plan, entry, providers) {
  requirePair(providers); assertPublicationRequest(plan, entry); const step = plan.steps[entry.stepIndex], transactionHash = hash(entry.transactionHash);
  const txs = await pair(providers, 'eth_getTransactionByHash', [transactionHash]); need(txs.every(Boolean), 'Transaction is not observed by both providers');
  const tx = same(txs.map(t => ({ hash: t.hash, from: address(t.from), to: address(t.to), input: bytes(t.input), value: t.value, nonce: t.nonce, chainId: t.chainId,
    type: t.type, gas: t.gas, maxFeePerGas: t.maxFeePerGas, maxPriorityFeePerGas: t.maxPriorityFeePerGas, blockHash: t.blockHash, blockNumber: t.blockNumber })), 'transaction');
  for (const key of ['from', 'to', 'value', 'nonce', 'chainId', 'type', 'gas', 'maxFeePerGas', 'maxPriorityFeePerGas']) need(tx[key] === entry.request[key], `Wallet changed ${key}`);
  need(tx.hash === transactionHash && tx.input === entry.request.data, 'Wallet transaction data differs');
  const receipts = await pair(providers, 'eth_getTransactionReceipt', [transactionHash]); if (receipts.some(value => !value)) return { status: 'pending', transactionHash };
  const receipt = same(receipts.map(r => ({ transactionHash: r.transactionHash, blockHash: r.blockHash, blockNumber: r.blockNumber, status: r.status, gasUsed: r.gasUsed, transactionIndex: r.transactionIndex, logs: receiptLogs(r.logs) })), 'receipt');
  need(receipt.transactionHash === transactionHash && receipt.blockHash === tx.blockHash && receipt.blockNumber === tx.blockNumber && operationQuantity(receipt.status) === 1n, 'Transaction reverted or inclusion differs');
  need(operationQuantity(receipt.blockNumber) >= BigInt(entry.observation.blockNumber), 'Receipt predates preparation');
  need((await pair(providers, 'eth_getBlockByNumber', [receipt.blockNumber, false])).every(b => b?.hash === receipt.blockHash && b.transactions.includes(transactionHash)), 'Receipt is not canonical');
  const pins = [...Object.values(plan.identity.contracts), ...plan.steps.slice(0, entry.stepIndex + 1).flatMap(s => s.newCode), ...(step.requiredCode ?? [])];
  await Promise.all(pins.map(pin => code(providers, pin, receipt.blockNumber))); await readConditions(providers, step.postReads, receipt.blockNumber);
  let canary = null;
  if (['launch', 'buy', 'approve', 'sell'].includes(step.kind)) canary = jsonSafe(await assertCanaryToken(plan, step, providers, receipt.blockNumber));
  if (['launch', 'buy', 'sell'].includes(step.kind)) {
    const api = await publicationValidators(), events = [];
    need(Array.isArray(receipt.logs) && receipt.logs.length <= 4096, 'Receipt logs are unavailable or exceed bounds');
    for (const log of receipt.logs.filter(log => log.address?.toLowerCase() === plan.identity.contracts.swapRouter.address)) {
      try { const event = decodeEventLog({ abi: api.moduleNativeRouterAbi, data: log.data, topics: log.topics, strict: true }); if (event.eventName === 'NativeTradeCompleted') events.push(event.args); } catch { /* Other router events are not trade evidence. */ }
    }
    need(events.length === 1, 'Expected exactly one native trade event'); const event = events[0], isBuy = step.kind !== 'sell';
    need(event.poolId === poolId(plan, step.target) && address(event.actor) === plan.owner && address(event.recipient) === plan.owner && event.isBuy === isBuy, 'Trade event identity differs');
    const amount = BigInt(step.kind === 'launch' ? step.expectation.initialBuyNative : step.expectation.amount);
    const minimum = BigInt(step.kind === 'launch' ? step.expectation.minimumTokenOut : step.expectation.minimumOut);
    need(event.amountSpecified === -amount && (isBuy ? event.nativeAmount : event.tokenAmount) === amount && (isBuy ? event.tokenAmount : event.nativeAmount) >= minimum, 'Trade event amounts differ');
  }
  need((await pair(providers, 'eth_getBlockByNumber', [receipt.blockNumber, false])).every(b => b?.hash === receipt.blockHash), 'Receipt anchor changed during verification');
  return { status: 'included-code-verified-unfinalized', chainId: 4663, planDigest: plan.planDigest, releaseDigest: plan.identity.releaseDigest, stepIndex: entry.stepIndex,
    kind: step.kind, transaction: tx, receipt, contracts: pins, canary, providers: publicBindings(providers) };
}

export async function preparePublicationRetry(plan, entry, providers, ceilings, reviewedRequestDigest, retryAttempt) {
  need(entry && !entry.transactionHash && entry.requestDigest === hash(reviewedRequestDigest)
    && Number.isSafeInteger(retryAttempt) && retryAttempt > 0, 'An explicit unresolved same-request retry is required');
  assertPublicationRequest(plan, entry);
  const observation = await observePublicationOperation(plan, entry.stepIndex, providers), next = publicationWalletRequest(plan, observation, ceilings);
  for (const key of Object.keys(next).filter(key => key !== 'gas')) need(canonicalJson(next[key]) === canonicalJson(entry.request[key]), `Retry wallet field changed: ${key}`);
  need(BigInt(next.gas) <= BigInt(entry.request.gas), 'Retry estimate exceeds the original reviewed gas');
  need(BigInt(observation.minimumBalance) >= BigInt(entry.request.value) + BigInt(entry.request.gas) * BigInt(entry.request.maxFeePerGas), 'Retry is not funded for original gas plus value');
  const issuedAt = Date.now(), body = { planDigest: plan.planDigest, stepIndex: entry.stepIndex, request: entry.request, observation,
    issuedAt, expiresAt: issuedAt + 300000, retryAttempt, originalRequestDigest: entry.requestDigest };
  return { ...body, requestDigest: digest('programmable.module-mode-owner-retry.v1', body) };
}
