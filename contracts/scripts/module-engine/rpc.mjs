import { decodeFunctionResult, encodeFunctionData, keccak256, parseAbi } from 'viem';
import { address, bytes, canonicalJson, hash, hexQuantity, jsonSafe, need } from '../module-mode/core.mjs';
import { observeReceipt, observeStage } from '../module-mode/rpc.mjs';
import { ECONOMICS_POLICY_ID } from '../module-native-v2/core.mjs';
import { ENGINE_PLAN_SCHEMA, ENGINE_REUSED_ROLES } from './core.mjs';

/** Engine-specific immutable/source checks at the established observer's exact common or receipt block. */
export async function observeEngineBindings(plan, providers, blockNumber, blockHash, deployed = false) {
  need(plan.schemaVersion === ENGINE_PLAN_SCHEMA && plan.identityCandidate.sourceVersion === 'module-engine-v1', 'Engine source plan required');
  need(Array.isArray(providers) && providers.length === 2 && providers[0].providerId !== providers[1].providerId
    && providers[0].trustDomain !== providers[1].trustDomain, 'Independent provider quorum required');
  const block = hexQuantity(blockNumber), expectedHash = hash(blockHash), p = plan.contracts, reads = {};
  async function pair(method, params, label) {
    const values = await Promise.all(providers.map(provider => provider.rpc(method, params)));
    const views = method === 'eth_getBlockByNumber' ? values.map(value => value && ({ hash: value.hash, number: value.number,
      timestamp: value.timestamp, baseFeePerGas: value.baseFeePerGas })) : values;
    need(canonicalJson(views[0]) === canonicalJson(views[1]), `Provider disagreement: ${label}`); return values[0];
  }
  need(BigInt(await pair('eth_chainId', [], 'chain')) === 4663n, 'Wrong chain');
  const opening = await pair('eth_getBlockByNumber', [block, false], 'opening block');
  need(opening?.hash === expectedHash && BigInt(opening.number) === BigInt(block), 'Engine binding block differs');
  async function code(pin) {
    const runtime = bytes(await pair('eth_getCode', [pin.address, block], `code ${pin.address}`));
    need(runtime !== '0x' && keccak256(runtime) === pin.runtimeCodeHash, `Engine runtime differs at ${pin.address}`);
    return { address: pin.address, runtimeCodeHash: pin.runtimeCodeHash };
  }
  async function getter(role, target, signature, expected) {
    const abi = parseAbi([signature]), functionName = abi[0].name, data = encodeFunctionData({ abi, functionName });
    const result = decodeFunctionResult({ abi, functionName, data: await pair('eth_call', [{ to: target, data }, block], `${role}.${functionName}`) });
    const value = typeof result === 'string' && /^0x[0-9a-fA-F]{40}$/.test(result) ? address(result)
      : typeof result === 'number' && Number.isSafeInteger(result) ? result.toString() : jsonSafe(result);
    need(canonicalJson(value) === canonicalJson(jsonSafe(expected)), `Engine ${role}.${functionName} differs`); reads[`${role}.${functionName}`] = value;
  }
  const reusedContracts = {}, deployedContracts = {};
  for (const role of ENGINE_REUSED_ROLES) reusedContracts[role] = await code(p[role]);
  await code(plan.official.poolManager);
  const previousLedger = plan.basis.previousRelease.contracts.rewardLedger; await code(previousLedger);
  await getter('registry', p.registry.address, 'function owner() view returns (address)', plan.parameters.reviewAuthority);
  await getter('previousLedger', previousLedger.address, 'function treasury() view returns (address)', plan.economics.treasury);
  await getter('previousLedger', previousLedger.address, 'function rewardAdmin() view returns (address)', plan.economics.rewardAdmin);
  if (deployed) {
    for (const role of ['host', 'ledger']) deployedContracts[role] = await code(p[role]);
    await getter('host', p.host.address, 'function SOURCE_VERSION() view returns (bytes32)', plan.sourceId);
    await getter('ledger', p.ledger.address, 'function ECONOMICS_POLICY_ID() view returns (bytes32)', ECONOMICS_POLICY_ID);
    await getter('ledger', p.ledger.address, 'function PROTOCOL_FEE_BPS() view returns (uint16)', 10n);
    await getter('ledger', p.ledger.address, 'function AUTHOR_POOL_FEE_BPS() view returns (uint16)', 20n);
    const links = { host: { tokenFactory: p.tokenFactory.address, launchPolicy: p.launchPolicy.address, registry: p.registry.address, ledger: p.ledger.address },
      ledger: { poolManager: plan.official.poolManager.address, registry: p.registry.address, hook: p.host.address,
        treasury: plan.economics.treasury, rewardAdmin: plan.economics.rewardAdmin } };
    for (const [role, fields] of Object.entries(links)) for (const [field, expected] of Object.entries(fields)) {
      await getter(role, p[role].address, `function ${field}() view returns (address)`, expected);
    }
  }
  const closing = await pair('eth_getBlockByNumber', [block, false], 'closing block'); need(closing?.hash === expectedHash, 'Engine binding snapshot reorganized');
  return { schemaVersion: 'programmable.module-engine-deployment-bindings.v1', chainId: 4663, blockNumber: BigInt(block).toString(), blockHash: expectedHash,
    sourceId: plan.sourceId, economicsPolicyId: ECONOMICS_POLICY_ID, previousReleaseDigest: plan.basis.previousRelease.releaseDigest,
    reusedContracts, deployedContracts, reads, treasury: plan.economics.treasury, rewardAdmin: plan.economics.rewardAdmin,
    registryOwner: plan.parameters.reviewAuthority,
    providers: providers.map(({ role, providerId, trustDomain, authentication, endpointCommitment }) => ({ role, providerId, trustDomain, authentication, endpointCommitment })) };
}

export async function observeEngineStage(plan, stepIndex, providers) {
  const observation = await observeStage(plan, stepIndex, providers);
  const engineBindings = await observeEngineBindings(plan, providers, observation.blockNumber, observation.blockHash, observation.state === 'already-deployed-receipt-required');
  return { ...observation, engineBindings, authority: 'read-only-not-wallet-authority' };
}
export async function observeEngineReceipt(plan, entry, providers) {
  const result = await observeReceipt(plan, entry, providers);
  if (result.status !== 'included-code-verified-unfinalized') return result;
  return { ...result, engineBindings: await observeEngineBindings(plan, providers, result.receipt.blockNumber, result.receipt.blockHash, true) };
}
