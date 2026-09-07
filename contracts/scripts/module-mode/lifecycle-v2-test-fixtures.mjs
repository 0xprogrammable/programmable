// Synthetic parser/RPC fixtures only. No chain, reviewer, deployment or lifecycle authority.
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, getAbiItem, keccak256, parseAbi } from 'viem';
import { hexQuantity } from './core.mjs';
import { publicationFixture, launchAction } from './publication-test-fixtures.mjs';
import { publicationValidators } from './publication-shared.mjs';
import { createLifecyclePlan } from './lifecycle-plan.mjs';
import { registryAbi } from './publication-plan.mjs';
export const h = n => `0x${n.toString(16).padStart(64, '0')}`;
const stateAbi = parseAbi([
  'function creatorRecipients(bytes32 poolId) view returns (address[] wallets,uint16[] sharesBps,uint256 adminRevision)',
  'function instances(bytes32 launchKey) view returns ((bytes32 instanceId,bytes32 packageId,bytes32 configHash,address factory,bytes32 factoryCodeHash,address module,bytes32 moduleCodeHash,uint32 callbackGas)[])',
  'function launchBinding(bytes32 launchKey) view returns ((address source,address launchWallet,address token,address poolManager,bytes32 poolId,bytes32 recipeHash,bytes32 programHash))',
]);
export async function publicationV2Fixture(feeEligibility = { eligible: true, reviewDigest: h(907) }) {
  return publicationFixture(feeEligibility);
}
export async function nativeLaunchReference(f, selected = false) {
  const plan = await createLifecyclePlan({ ...f, modules: selected ? [f.module] : [], action: launchAction(f, selected) }), step = plan.steps[0];
  const transaction = { hash: h(100), from: f.owner, to: step.to, input: step.data, value: hexQuantity(step.value), nonce: '0x1', chainId: '0x1237', type: '0x2',
    gas: '0x100000', maxFeePerGas: '0x3e8', maxPriorityFeePerGas: '0xa', blockHash: h(200), blockNumber: '0x100' };
  const receipt = { transactionHash: transaction.hash, blockHash: transaction.blockHash, blockNumber: transaction.blockNumber, status: '0x1', gasUsed: '0x80000', transactionIndex: '0x0', logs: [] };
  return { plan, evidence: { status: 'included-code-verified-unfinalized', chainId: 4663, planDigest: plan.planDigest, releaseDigest: f.identity.releaseDigest,
    stepIndex: 0, kind: 'launch', transaction, receipt } };
}
export async function lifecycleV2RpcFixture(kind = 'launch', selected = false) {
  const f = await publicationV2Fixture(), api = await publicationValidators(), runtime = '0x600100';
  const launch = await nativeLaunchReference(f, selected);
  const exactOutput = kind.endsWith('ExactOutput'), isBuy = kind === 'launch' || kind.startsWith('buy');
  const action = kind === 'launch' ? launch.plan.action : { kind, canaryKind: selected ? 'modules' : 'plain', token: launch.plan.steps[0].target, launch,
    tokenCodeHash: keccak256(runtime), amount: '10000',
    ...(kind === 'approve' ? {} : { [exactOutput ? 'maximumInput' : 'minimumOut']: exactOutput ? '20000' : '20', deadline: launch.plan.action.deadline }) };
  const originalPlan = kind === 'launch' ? launch.plan : await createLifecyclePlan({ ...f, modules: selected ? [f.module] : [], action });
  // Observation fixtures substitute only their synthetic runtime pins; no source authority is claimed.
  const plan = structuredClone(originalPlan);
  for (const pin of Object.values(plan.identity.contracts)) pin.runtimeCodeHash = keccak256(runtime);
  const pins = plan.identity.contracts, step = plan.steps[0], expected = step.expectation, faults = new Set(), reads = [];
  let request, included = false, input = exactOutput ? 15000n : kind === 'launch' ? BigInt(expected.initialBuyNative) : 10000n;
  let output = exactOutput ? 10000n : kind === 'launch' ? 2000n : 100n;
  const latest = { number: '0x110', hash: h(210), timestamp: hexQuantity(Math.floor(Date.now() / 1000)), baseFeePerGas: '0x1' };
  const mined = { ...latest, number: '0x111', hash: h(211) }, txHash = h(101);
  const nativeRecord = { launchId: h(300), launchWallet: f.owner, token: step.target, poolId: expected.poolId, recipeHash: expected.recipeHash,
    hook: pins.hook.address, positionRecipient: f.owner, positionTokenId: 1n, initialBuyNative: BigInt(expected.initialBuyNative),
    initialBuyTokens: 2000n, runtime: pins.runtime.address, launchKey: expected.launchKey };
  const instances = expected.selections.map((selection, index) => ({ instanceId: h(index + 501), packageId: selection.packageId, configHash: keccak256(selection.config),
    factory: selection.factory, factoryCodeHash: selection.factoryCodeHash, module: `0x${(index + 701).toString(16).padStart(40, '0')}`,
    moduleCodeHash: selection.moduleCodeHash, callbackGas: selection.callbackGas }));
  const log = (emitter, abi, eventName, args, index) => {
    const event = getAbiItem({ abi, name: eventName }), values = event.inputs.filter(item => !item.indexed);
    return { address: emitter, topics: encodeEventTopics({ abi, eventName, args }), data: encodeAbiParameters(values, values.map(item => args[item.name])),
      transactionHash: txHash, blockHash: mined.hash, blockNumber: mined.number, transactionIndex: '0x0', logIndex: hexQuantity(index), removed: false };
  };
  const receipt = () => {
    const logs = [], add = (emitter, abi, name, args) => logs.push(log(emitter, abi, name, args, logs.length));
    if (kind === 'launch') {
      add(pins.launcher.address, api.moduleNativeLaunchAbiFor(plan.identity), 'ModuleNativeConfigurationBound', {
        launchId: nativeRecord.launchId, metadataHash: expected.metadataHash, creatorConfigurationHash: expected.creatorConfigurationHash, economicsHash: h(303) });
      add(pins.launcher.address, api.moduleNativeLaunchAbiFor(plan.identity), 'ModuleNativeProgramBound', {
        launchId: nativeRecord.launchId, launchKey: expected.launchKey, runtime: pins.runtime.address, fundingHash: expected.fundingHash, totalFunding: BigInt(expected.totalFunding) });
      if (!faults.has('missing-economics')) add(pins.hook.address, api.moduleNativeReadV2Abi, 'NativeEconomicsBound', {
        poolId: expected.poolId, economicsPolicyId: faults.has('event-policy') ? h(777) : plan.identity.economicsPolicyId,
        protocolFeeBps: faults.has('event-protocol') ? 20 : 10, authorPoolFeeBps: faults.has('event-authors') ? 10 : expected.authorPoolFeeBps,
        eligibleFamilies: faults.has('event-families') ? [h(778)] : expected.families,
        selectionEligible: faults.has('event-eligible') ? [false] : expected.selectionEligible,
        selectionReviewDigests: faults.has('event-review') ? [h(779)] : expected.selectionReviewDigests });
      if (faults.has('duplicate-economics')) logs.push({ ...logs[2], logIndex: hexQuantity(logs.length) });
    }
    if (kind !== 'approve') add(pins.swapRouter.address, api.moduleNativeRouterAbi, 'NativeTradeCompleted', {
      poolId: expected.poolId, actor: f.owner, recipient: faults.has('event-recipient') ? pins.registry.address : f.owner,
      isBuy: faults.has('event-side') ? !isBuy : isBuy, amountSpecified: faults.has('event-sign') ? (exactOutput ? -10000n : 10000n)
        : exactOutput ? 10000n : kind === 'launch' ? -BigInt(expected.initialBuyNative) : -10000n,
      nativeAmount: isBuy ? input : output, tokenAmount: isBuy ? output : input });
    return { transactionHash: txHash, blockHash: mined.hash, blockNumber: mined.number, status: '0x1', gasUsed: '0x10000', transactionIndex: '0x0', logs };
  };
  const rpc = async (method, params) => {
    reads.push({ method, params });
    if (method === 'eth_chainId') return '0x1237';
    if (method === 'eth_getBlockByNumber') {
      if (params[0] === '0x100') return { ...latest, number: '0x100', hash: launch.evidence.transaction.blockHash, transactions: [launch.evidence.transaction.hash] };
      return { ...(params[0] === '0x111' ? mined : latest), transactions: params[0] === '0x111' ? [txHash] : [] };
    }
    if (method === 'eth_getTransactionByHash') {
      if (params[0] === launch.evidence.transaction.hash) return launch.evidence.transaction;
      return { ...request, hash: txHash, input: request.data, blockHash: mined.hash, blockNumber: mined.number };
    }
    if (method === 'eth_getTransactionReceipt') return params[0] === launch.evidence.transaction.hash ? launch.evidence.receipt : receipt();
    if (method === 'eth_getCode') {
      if (params[0] === f.owner || (kind === 'launch' && params[0] === step.target && !included)) return '0x';
      if (params[0] === expected.selections[0]?.factory) return f.artifact.factory.runtimeBytecode;
      if (params[0] === instances[0]?.module) return f.artifact.program.runtimeBytecode;
      return runtime;
    }
    if (method === 'eth_getTransactionCount') return params[0] === step.target ? '0x0' : '0x2';
    if (method === 'eth_getBalance') return '0xffffffffffffffff';
    if (method === 'eth_estimateGas') return '0x186a0';
    if (method === 'eth_call') {
      const { to, data } = params[0];
      if (data === step.data) {
        if (kind === 'launch') return encodeFunctionResult({ abi: api.moduleNativeLaunchAbiFor(plan.identity), functionName: 'launch', result: nativeRecord });
        if (kind === 'approve') return step.result;
        return encodeFunctionResult({ abi: api.moduleNativeRouterAbi, functionName: 'swap', result: isBuy ? [input, output] : [output, input] });
      }
      const condition = [...step.preReads, ...step.postReads].find(value => value.data === data && value.to === to);
      if (condition) {
        if (faults.has('eligibility-pre') && condition.functionName === 'familyFeeEligibility') return '0x00';
        if (faults.has('preview-recipe') && condition.functionName === 'previewRecipe') return '0x00';
        return condition.result;
      }
      const abi = [...api.moduleNativeReadV2Abi, ...api.moduleNativeLaunchAbiFor(plan.identity), ...stateAbi, ...registryAbi];
      const decoded = decodeFunctionData({ abi, data }), fn = decoded.functionName;
      const respond = result => encodeFunctionResult({ abi, functionName: fn, result });
      if (fn === 'owner') return respond(f.owner);
      if (fn === 'ECONOMICS_POLICY_ID') return respond(faults.has('policy') ? h(790) : plan.identity.economicsPolicyId);
      if (fn === 'PROTOCOL_FEE_BPS') return respond(faults.has('protocol') ? 20 : 10);
      if (fn === 'AUTHOR_POOL_FEE_BPS') return respond(faults.has('authors') ? 10 : 20);
      if (fn === 'getLaunch') return respond(nativeRecord);
      if (fn === 'poolConfig') return respond([pins.launcher.address, f.owner, pins.swapRouter.address, pins.swapRouter.runtimeCodeHash,
        expected.creatorFeeBps, expected.creatorFeeBps, expected.recipeHash, expected.launchKey, faults.has('pool-fee') ? 20 : expected.platformFeeBps]);
      if (fn === 'platformFeeBps') return respond(faults.has('ledger-fee') ? 20 : expected.platformFeeBps);
      if (fn === 'eligibilitySnapshot') return respond([faults.has('snapshot-eligible') ? [false] : expected.selectionEligible,
        faults.has('snapshot-review') ? [h(792)] : expected.selectionReviewDigests]);
      if (fn === 'feeComponents') return respond([expected.creatorFeeBps, faults.has('components') ? 20 : expected.platformFeeBps, faults.has('protocol-pips') ? 1001 : 0, faults.has('lp-pips') ? 1 : 0]);
      if (fn === 'launchBinding') return respond({ source: pins.launcher.address, launchWallet: f.owner,
        token: step.target, poolManager: pins.poolManager.address, poolId: expected.poolId, recipeHash: expected.recipeHash, programHash: expected.programHash });
      if (fn === 'instances') return respond(instances);
      if (fn === 'creatorRecipients') return respond([expected.creatorWallets, expected.creatorSharesBps, 0n]);
    }
    throw new Error('Unexpected synthetic V2 lifecycle read');
  };
  const providers = [0, 1].map(i => ({ providerId: `native-v2-${i}`, trustDomain: `native-v2-${i}.invalid`, role: i ? 'secondary' : 'primary',
    authentication: 'fixture', endpointCommitment: `sha256:${h(80 + i).slice(2)}`, rpc }));
  return { f, plan, providers, faults, reads, txHash, originalPlan, setAmounts(paid, received) { input = paid; output = received; },
    include(prepared) { request = prepared.request; included = true; return { ...prepared, transactionHash: txHash }; } };
}
