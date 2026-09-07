#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeEventLog, decodeFunctionData } from 'viem';
import { address, bytes, canonicalJson, hash, hexQuantity, need } from '../module-mode/core.mjs';
import { bindIdentity } from '../module-mode/publication-plan.mjs';
import { createLifecycleCollectorPlan } from '../module-mode/lifecycle-plan.mjs';
import { exactJson } from '../module-mode/source-readback.mjs';
import { sealNativeV2Build } from './build.mjs';
import { ECONOMICS_POLICY_ID } from './core.mjs';

const ACTIONS = ['launch', 'buy', 'sell', 'buyExactOutput', 'sellExactOutput'];

/** These are transaction references for the authenticated backend collector, never lifecycle evidence or finality. */
export async function createNativeV2LifecycleCollectorPlan(identity, canaries, build) {
  await bindIdentity(identity);
  need(identity.sourceVersion === 'module-native-v2' && identity.economicsPolicyId === ECONOMICS_POLICY_ID
    && identity.sourceCommit === build.sourceCommit, 'Exact native V2 release/build required; other engines cannot inherit this lifecycle');
  // Retain existing release, token, canary order and actual launch/buy/sell reference checks.
  const base = createLifecycleCollectorPlan(identity, canaries), allHashes = new Set();
  for (let index = 0; index < canaries.length; index++) {
    const canary = canaries[index], target = base.canaries[index];
    for (const kind of ACTIONS) {
      const { plan, evidence } = canary[kind] ?? {}, step = plan?.steps?.[0], transaction = evidence?.transaction, receipt = evidence?.receipt;
      need(plan?.identity?.sourceVersion === 'module-native-v2' && plan.identity.economicsPolicyId === ECONOMICS_POLICY_ID
        && plan.identity.releaseDigest === identity.releaseDigest && plan.action?.kind === kind && plan.action.canaryKind === canary.kind
        && step?.expectation?.token === canary.token && evidence?.planDigest === plan.planDigest
        && evidence.status === 'included-code-verified-unfinalized' && transaction && receipt,
      'Actual native V2 canary operation reference required');
      const tx = hash(transaction.hash), to = kind === 'launch' ? identity.contracts.launcher.address : identity.contracts.swapRouter.address;
      need(!allHashes.has(tx), 'Duplicate canary transaction'); allHashes.add(tx);
      need(receipt.transactionHash === tx && receipt.status === '0x1' && receipt.blockHash === transaction.blockHash
        && receipt.blockNumber === transaction.blockNumber && BigInt(receipt.blockNumber) >= BigInt(identity.startBlock)
        && address(transaction.to) === to && address(step.to) === to && address(transaction.from) === address(step.sender)
        && bytes(transaction.input) === bytes(step.data) && transaction.value === hexQuantity(step.value)
        && transaction.chainId === '0x1237' && transaction.type === '0x2', 'Canary receipt/transaction differs from its exact operation');
      const decoded = decodeFunctionData({ abi: build.artifacts[kind === 'launch' ? 'launcher' : 'swapRouter'].abi, data: transaction.input });
      if (kind === 'launch') {
        need(decoded.functionName === 'launch', 'Native V2 launch call required'); const parameters = decoded.args[0];
        need(hash(parameters.expectedRecipeHash) === hash(step.expectation.recipeHash), 'V2 expected recipe differs');
        const economics = (receipt.logs ?? []).filter(log => address(log.address) === identity.contracts.hook.address).flatMap(log => {
          try { const event = decodeEventLog({ abi: build.artifacts.hook.abi, data: log.data, topics: log.topics, strict: true });
            return event.eventName === 'NativeEconomicsBound' ? [event.args] : []; } catch { return []; }
        });
        need(economics.length === 1, 'Actual NativeEconomicsBound V2 event required'); const event = economics[0];
        need(event.economicsPolicyId === ECONOMICS_POLICY_ID && event.poolId === step.expectation.poolId && Number(event.protocolFeeBps) === 10
          && Number(event.authorPoolFeeBps) === (event.eligibleFamilies.length ? 20 : 0)
          && event.selectionEligible.length === parameters.modules.length && event.selectionReviewDigests.length === parameters.modules.length
          && (canary.kind === 'plain' ? parameters.modules.length === 0 && event.eligibleFamilies.length === 0 : parameters.modules.length > 0 && event.eligibleFamilies.length > 0),
        'Native V2 policy or per-selection eligibility event snapshot differs');
      } else {
        const isBuy = kind.startsWith('buy'), exactOutput = kind.endsWith('ExactOutput');
        need(decoded.functionName === 'swap' && address(decoded.args[0]) === address(canary.token) && decoded.args[1] === isBuy
          && (exactOutput ? decoded.args[2] > 0n : decoded.args[2] < 0n), 'Actual native swap quadrant differs');
      }
      target[`${kind}TransactionHash`] = tx;
    }
  }
  return { ...base, schemaVersion: 'programmable.module-mode-lifecycle-plan.v2' };
}

async function main(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    need(['--identity', '--canaries', '--output', '--source-root'].includes(argv[i]) && argv[i + 1] && !options[argv[i].slice(2)], 'Use --identity FILE --canaries FILE --output FILE [--source-root DIRECTORY]');
    options[argv[i].slice(2)] = argv[i + 1];
  }
  need(options.identity && options.canaries && options.output, 'Actual identity and ten canary operation references required');
  const build = await sealNativeV2Build(options['source-root'] ? { root: path.resolve(options['source-root']) } : {});
  const plan = await createNativeV2LifecycleCollectorPlan(exactJson(await readFile(options.identity), 'Actual native V2 release'), exactJson(await readFile(options.canaries), 'Actual native V2 canaries'), build);
  await writeFile(options.output, `${canonicalJson(plan)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: 'actual-transaction-references-only-finality-unproven', schemaVersion: plan.schemaVersion, releaseDigest: plan.releaseDigest, canaries: plan.canaries.length }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
