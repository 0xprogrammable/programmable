import { decodeFunctionResult, encodeFunctionData, keccak256, parseAbi } from 'viem';
import { address, bytes, canonicalJson, hash, hexQuantity, need } from '../module-mode/core.mjs';
import { observeReceipt, observeStage } from '../module-mode/rpc.mjs';
import { ECONOMICS_POLICY_ID, PLAN_SCHEMA_V2, REUSED_ROLES } from './core.mjs';

/** Additional V2 checks share the exact block already selected by the established quorum observer. */
export async function observeNativeV2Bindings(plan, providers, blockNumber, blockHash, deployedRoles = []) {
  need(plan.schemaVersion === PLAN_SCHEMA_V2 && plan.economics.economicsPolicyId === ECONOMICS_POLICY_ID, 'Native V2 policy-bound plan required');
  need(Array.isArray(providers) && providers.length === 2 && providers[0].trustDomain !== providers[1].trustDomain
    && providers[0].providerId !== providers[1].providerId, 'Independent provider quorum required');
  const block = hexQuantity(blockNumber), expectedHash = hash(blockHash), reads = {};
  async function pair(method, params, label) {
    const values = await Promise.all(providers.map(provider => provider.rpc(method, params)));
    const comparable = method === 'eth_getBlockByNumber' ? values.map(value => value && ({ number: value.number, hash: value.hash,
      timestamp: value.timestamp, baseFeePerGas: value.baseFeePerGas })) : values;
    need(canonicalJson(comparable[0]) === canonicalJson(comparable[1]), `Provider disagreement: ${label}`);
    return values[0];
  }
  need(BigInt(await pair('eth_chainId', [], 'chain')) === 4663n, 'Wrong chain');
  const opening = await pair('eth_getBlockByNumber', [block, false], 'snapshot block');
  need(opening?.hash === expectedHash && BigInt(opening.number) === BigInt(block), 'Native binding snapshot differs');
  async function code(pin) {
    const runtime = bytes(await pair('eth_getCode', [pin.address, block], `code ${pin.address}`));
    need(runtime !== '0x' && keccak256(runtime) === pin.runtimeCodeHash, `Native binding code differs at ${pin.address}`);
    return { address: pin.address, runtimeCodeHash: pin.runtimeCodeHash };
  }
  async function getter(role, target, signature, expected) {
    const abi = parseAbi([signature]), functionName = abi[0].name;
    const data = encodeFunctionData({ abi, functionName });
    const result = decodeFunctionResult({ abi, functionName, data: await pair('eth_call', [{ to: target, data }, block], `${role}.${functionName}`) });
    const normalized = typeof result === 'string' && /^0x[0-9a-fA-F]{40}$/.test(result) ? address(result) : result;
    need(canonicalJson(normalized) === canonicalJson(expected), `Native V2 ${role}.${functionName} differs`);
    reads[`${role}.${functionName}`] = normalized;
  }
  const reusedContracts = {}, deployedContracts = {}, pins = plan.contracts, previous = plan.basis.previousRelease.contracts;
  for (const role of REUSED_ROLES) reusedContracts[role] = await code(pins[role]);
  for (const role of ['registry', 'rewardLedger']) await code(previous[role]);
  await getter('previousRegistry', previous.registry.address, 'function owner() view returns (address)', plan.basis.registryOwner);
  await getter('previousLedger', previous.rewardLedger.address, 'function treasury() view returns (address)', plan.economics.treasury);
  await getter('previousLedger', previous.rewardLedger.address, 'function rewardAdmin() view returns (address)', plan.economics.rewardAdmin);
  for (const role of deployedRoles) deployedContracts[role] = await code(pins[role]);
  const has = role => deployedRoles.includes(role), policyGetters = {};
  for (const role of ['hook', 'rewardLedger', 'launcher', 'swapRouter']) if (has(role)) {
    await getter(role, pins[role].address, 'function ECONOMICS_POLICY_ID() view returns (bytes32)', ECONOMICS_POLICY_ID);
    policyGetters[role] = ECONOMICS_POLICY_ID;
  }
  if (has('registry')) await getter('registry', pins.registry.address, 'function owner() view returns (address)', plan.parameters.reviewAuthority);
  const links = { hook: { poolManager: plan.official.poolManager.address, registry: pins.registry.address,
    runtimeFactory: pins.runtimeFactory.address, ledger: pins.rewardLedger.address },
    rewardLedger: { poolManager: plan.official.poolManager.address, registry: pins.registry.address, hook: pins.hook.address,
      treasury: plan.economics.treasury, rewardAdmin: plan.economics.rewardAdmin },
    launcher: { feeHook: pins.hook.address, swapRouter: pins.swapRouter.address, swapRouterFactory: pins.swapRouterFactory.address },
    swapRouter: { poolManager: plan.official.poolManager.address, hook: pins.hook.address, source: pins.launcher.address },
    runtime: { engine: pins.hook.address, vault: pins.budgetVault.address }, budgetVault: { runtime: pins.runtime.address } };
  for (const [role, fields] of Object.entries(links)) if (has(role)) for (const [field, expected] of Object.entries(fields)) {
    await getter(role, pins[role].address, `function ${field}() view returns (address)`, expected);
  }
  if (has('launcher')) await getter('launcher', pins.launcher.address, 'function sourceVersion() view returns (string)', 'module-native-v2');
  if (has('runtime')) await getter('hook', pins.hook.address, 'function runtime() view returns (address)', pins.runtime.address);
  const closing = await pair('eth_getBlockByNumber', [block, false], 'closing snapshot block');
  need(closing?.hash === expectedHash, 'Native binding snapshot reorganized');
  return { schemaVersion: 'programmable.module-mode-native-v2-bindings.v1', chainId: 4663,
    blockNumber: BigInt(block).toString(), blockHash: expectedHash, previousReleaseDigest: plan.basis.previousRelease.releaseDigest,
    economicsPolicyId: ECONOMICS_POLICY_ID, reusedContracts, deployedContracts, policyGetters, reads,
    previousRegistryOwner: plan.basis.registryOwner, treasury: plan.economics.treasury, rewardAdmin: plan.economics.rewardAdmin,
    providers: providers.map(({ role, providerId, trustDomain, authentication, endpointCommitment }) => ({ role, providerId, trustDomain, authentication, endpointCommitment })) };
}

export async function observeNativeV2Stage(plan, stepIndex, providers) {
  const observation = await observeStage(plan, stepIndex, providers);
  const roles = plan.steps.slice(0, stepIndex).flatMap(step => step.expectedRoles);
  if (observation.state === 'already-deployed-receipt-required') roles.push(...plan.steps[stepIndex].expectedRoles);
  const nativeBindings = await observeNativeV2Bindings(plan, providers, observation.blockNumber, observation.blockHash, roles);
  return { ...observation, nativeBindings, authority: 'read-only-not-wallet-authority' };
}

export async function observeNativeV2Receipt(plan, entry, providers) {
  const evidence = await observeReceipt(plan, entry, providers);
  if (evidence.status !== 'included-code-verified-unfinalized') return evidence;
  const roles = plan.steps.slice(0, entry.stepIndex + 1).flatMap(step => step.expectedRoles);
  const nativeBindings = await observeNativeV2Bindings(plan, providers, evidence.receipt.blockNumber, evidence.receipt.blockHash, roles);
  return { ...evidence, nativeBindings };
}
