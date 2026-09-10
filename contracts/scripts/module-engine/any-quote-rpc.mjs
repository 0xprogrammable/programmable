import { keccak256, toHex } from 'viem';
import { address, bytes, canonicalJson, hexQuantity, jsonSafe, need } from '../module-mode/core.mjs';
import { deploymentRpc as r, observeReceipt } from '../module-mode/rpc.mjs';
import { ANY_QUOTE_NEW_ROLES, ANY_QUOTE_REUSED_ROLES, ANY_QUOTE_ROUTER, assertAnyQuoteProfile } from './any-quote-core.mjs';

export async function observeAnyQuoteBindings(plan, providers, blockNumber, blockHash, deployedRoles = []) {
  assertAnyQuoteProfile(plan); r.requirePair(providers);
  need(deployedRoles.every(role => ANY_QUOTE_NEW_ROLES.includes(role)), 'Unknown deployed Any Quote role');
  const block = hexQuantity(blockNumber), p = plan.contracts, reads = {};
  const at = async () => {
    const blocks = await r.pair(providers, 'eth_getBlockByNumber', [block, false]);
    need(blocks.every(b => b && b.hash === blockHash && BigInt(b.number) === BigInt(block)), 'Any Quote binding block changed');
  };
  await at();
  need((await r.pair(providers, 'eth_chainId', [])).every(id => BigInt(id) === 4663n), 'Wrong chain');
  const reusedContracts = {}, deployedContracts = {};
  for (const role of ANY_QUOTE_REUSED_ROLES) { await r.readCode(providers, p[role], block); reusedContracts[role] = plan.identityCandidate.contracts[role]; }
  for (const pin of [plan.official.poolManager, plan.official.deterministicDeployer, ANY_QUOTE_ROUTER]) await r.readCode(providers, pin, block);
  for (const role of deployedRoles) { await r.readCode(providers, p[role], block); deployedContracts[role] = plan.identityCandidate.contracts[role]; }
  async function getter(role, name, type, expected) {
    const raw = await r.getter(providers, p[role].address, `function ${name}() view returns (${type})`, block);
    const value = type === 'address' ? address(raw) : jsonSafe(raw);
    need(canonicalJson(value) === canonicalJson(jsonSafe(expected)), `Any Quote ${role}.${name} differs`); reads[`${role}.${name}`] = value;
  }
  await getter('registry', 'owner', 'address', plan.parameters.reviewAuthority);
  if (deployedRoles.includes('host')) {
    need(['sharedHook', 'ledger', 'nativeRouteGuard'].every(role => deployedRoles.includes(role)), 'Complete Host child and guard observation required');
    await getter('host', 'SOURCE_VERSION', 'bytes32', plan.sourceId);
    await getter('host', 'quoteFeeProfileId', 'bytes32', keccak256(toHex(plan.identityCandidate.engineProfile)));
    await getter('host', 'UNIVERSAL_ROUTER', 'address', ANY_QUOTE_ROUTER.address);
    await getter('host', 'UNIVERSAL_ROUTER_CODE_HASH', 'bytes32', ANY_QUOTE_ROUTER.runtimeCodeHash);
    await getter('host', 'NATIVE_ROUTE_GUARD_CODE_HASH', 'bytes32', p.nativeRouteGuard.runtimeCodeHash);
    await getter('host', 'quotePoolManagerCodeHash', 'bytes32', plan.official.poolManager.runtimeCodeHash);
    const links = { host: { tokenFactory: p.tokenFactory.address, launchPolicy: p.launchPolicy.address, registry: p.registry.address,
      sharedHook: p.sharedHook.address, nativeRouteGuard: p.nativeRouteGuard.address, ledger: p.ledger.address, quotePoolManager: plan.official.poolManager.address },
      sharedHook: { poolManager: plan.official.poolManager.address, host: p.host.address, ledger: p.ledger.address },
      ledger: { poolManager: plan.official.poolManager.address, host: p.host.address, hook: p.sharedHook.address, rewardAdmin: plan.economics.rewardAdmin } };
    for (const [role, fields] of Object.entries(links)) for (const [name, expected] of Object.entries(fields)) await getter(role, name, 'address', expected);
    await getter('ledger', 'ECONOMICS_POLICY_ID', 'bytes32', plan.economics.economicsPolicyId);
    await getter('ledger', 'treasury', 'address', plan.economics.platformRecipient);
  }
  await at();
  return { schemaVersion: 'programmable.module-engine-any-quote-deployment-bindings.v1', chainId: 4663,
    blockNumber: BigInt(blockNumber).toString(), blockHash, sourceId: plan.sourceId, economicsPolicyId: plan.economics.economicsPolicyId,
    hookSalt: plan.sharedHookCreation.salt, sharedHook: p.sharedHook.address, nativeRouteGuard: p.nativeRouteGuard.address,
    guardCreate2: { deployer: plan.steps[0].to, salt: plan.steps[0].salt, initcodeHash: plan.steps[0].initcodeHash, target: p.nativeRouteGuard.address },
    previousReleaseDigest: plan.basis.previousRelease.releaseDigest, reusedContracts, deployedContracts, reads,
    platformRecipient: plan.economics.platformRecipient, rewardAdmin: plan.economics.rewardAdmin, registryOwner: plan.parameters.reviewAuthority,
    providers: r.publicBindings(providers) };
}
export async function observeAnyQuoteStage(plan, stepIndex, providers) {
  assertAnyQuoteProfile(plan); r.requirePair(providers); const step = plan.steps[stepIndex]; need(step, 'Unknown Any Quote stage');
  const block = await r.commonBlock(providers), completed = plan.steps.slice(0, stepIndex).flatMap(s => s.expectedRoles);
  const engineBindings = await observeAnyQuoteBindings(plan, providers, block.number, block.hash, completed);
  if (await r.readCode(providers, plan.contracts[step.role], block.number, true)) {
    const observed = await observeAnyQuoteBindings(plan, providers, block.number, block.hash, [...completed, ...step.expectedRoles]);
    return { state: 'already-deployed-receipt-required', stepIndex, blockNumber: BigInt(block.number).toString(), blockHash: block.hash, engineBindings: observed };
  }
  for (const role of step.expectedRoles) {
    need(!await r.readCode(providers, plan.contracts[role], block.number, true), 'Expected deployment address already has code');
    need(BigInt(r.same(await r.pair(providers, 'eth_getTransactionCount', [plan.contracts[role].address, block.number]), 'target nonce')) === 0n, 'Deployment target nonce is nonzero');
  }
  need(r.same(await r.pair(providers, 'eth_getCode', [step.sender, block.number]), 'owner code') === '0x', 'Existing operator requires the reviewed EOA');
  const latest = r.same(await r.pair(providers, 'eth_getTransactionCount', [step.sender, 'latest']), 'owner nonce');
  const pending = r.same(await r.pair(providers, 'eth_getTransactionCount', [step.sender, 'pending']), 'pending nonce');
  need(latest === pending && BigInt(pending) === BigInt(step.nonce), 'Reserved owner nonce changed; reconcile before rebuilding the plan');
  const balances = (await r.pair(providers, 'eth_getBalance', [step.sender, 'pending'])).map(BigInt);
  const call = { from: step.sender, ...(step.to === null ? {} : { to: step.to }), value: '0x0', data: step.data, nonce: hexQuantity(step.nonce) };
  const result = bytes(r.same(await r.pair(providers, 'eth_call', [call, block.number]), 'constructor simulation'));
  need(step.to === null ? keccak256(result) === plan.contracts.host.runtimeCodeHash : result === step.target,
    'Constructor simulation differs from the bound deployment');
  const estimates = (await r.pair(providers, 'eth_estimateGas', [call, block.number])).map(BigInt);
  const max = estimates.reduce((a, b) => a > b ? a : b), min = estimates.reduce((a, b) => a < b ? a : b);
  need(max - min <= 1000n + max / 10000n, 'Provider gas estimates disagree');
  need((await r.pair(providers, 'eth_getBlockByNumber', [block.number, false])).every(b => b?.hash === block.hash), 'Deployment snapshot reorganized');
  return { state: 'vacant-simulated', stepIndex, blockNumber: BigInt(block.number).toString(), blockHash: block.hash,
    nonce: BigInt(pending).toString(), minimumBalance: String(balances.reduce((a, b) => a < b ? a : b)),
    baseFeePerGas: String(BigInt(block.baseFeePerGas)), estimates: estimates.map(String),
    gasLimit: String((max * 10500n + 9999n) / 10000n + 25000n), observedAt: new Date().toISOString(),
    providers: r.publicBindings(providers), engineBindings, authority: 'read-only-not-wallet-authority' };
}
export async function observeAnyQuoteReceipt(plan, entry, providers) {
  assertAnyQuoteProfile(plan); const result = await observeReceipt(plan, entry, providers);
  if (result.status !== 'included-code-verified-unfinalized') return result;
  return { ...result, engineBindings: await observeAnyQuoteBindings(plan, providers, result.receipt.blockNumber, result.receipt.blockHash,
    plan.steps.slice(0, entry.stepIndex + 1).flatMap(step => step.expectedRoles)) };
}
