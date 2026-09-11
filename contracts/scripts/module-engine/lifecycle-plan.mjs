#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { address, canonicalJson, exactKeys, hash, need, uint } from '../module-mode/core.mjs';
import { exactJson } from '../module-mode/source-readback.mjs';
import { engineWire } from './shared.mjs';

/** References only. The separate authenticated Engine collector fetches actual receipts/state/finality itself. */
export async function createEngineLifecyclePlan(release, canaries) {
  (await engineWire()).bindModuleEngineReleaseIdentity(release);
  need(Array.isArray(canaries) && canaries.length >= 1 && canaries.length <= 16, 'One to sixteen actual Engine canary references required');
  const transactions = new Set(), launches = new Set();
  const uniqueTransaction = value => { const tx = hash(value); need(!transactions.has(tx), 'Duplicate lifecycle transaction'); transactions.add(tx); return tx; };
  const checked = canaries.map(canary => {
    exactKeys(canary, ['launchId', 'launchTransactionHash', 'manifestHash', 'operations'], 'Engine lifecycle canary');
    const launchId = hash(canary.launchId); need(!launches.has(launchId), 'Duplicate canary launch'); launches.add(launchId);
    const launchTransactionHash = uniqueTransaction(canary.launchTransactionHash), manifestHash = hash(canary.manifestHash), nonces = new Set();
    need(Array.isArray(canary.operations) && canary.operations.length >= 1 && canary.operations.length <= 16, 'One to sixteen actual operation references required');
    const operations = canary.operations.map(operation => {
      if (['module-engine-any-quote-v1', 'module-engine-any-quote-eth-v1'].includes(release.sourceVersion)) {
        const nativeFees = release.sourceVersion === 'module-engine-any-quote-eth-v1';
        const swapKind = nativeFees ? 'native-fee-pool-swap' : 'quote-pool-swap', claimKind = nativeFees ? 'native-eth-claim' : 'quote-claim';
        need([swapKind, claimKind].includes(operation.kind), 'Canonical Any Quote swap or claim reference required');
        exactKeys(operation, operation.kind === swapKind ? ['kind', 'transactionHash', 'logIndex', 'poolId', 'buy']
          : ['kind', 'transactionHash', 'logIndex', ...(nativeFees ? [] : ['asset']), 'beneficiary', 'recipient'], 'Any Quote lifecycle reference');
        need(Number.isSafeInteger(operation.logIndex) && operation.logIndex >= 0, 'Canonical receipt log index required');
        const transactionHash = uniqueTransaction(operation.transactionHash);
        if (operation.kind === swapKind) {
          need(typeof operation.buy === 'boolean', 'Explicit swap direction required');
          return { kind: operation.kind, transactionHash, logIndex: operation.logIndex, poolId: hash(operation.poolId), buy: operation.buy };
        }
        return { kind: operation.kind, transactionHash, logIndex: operation.logIndex, ...(nativeFees ? {} : { asset: address(operation.asset) }), beneficiary: address(operation.beneficiary), recipient: address(operation.recipient) };
      }
      exactKeys(operation, ['transactionHash', 'operationId', 'actor', 'nonce'], 'Engine operation reference');
      const transactionHash = uniqueTransaction(operation.transactionHash), actor = address(operation.actor), nonce = uint(operation.nonce, 'operation nonce');
      const key = `${actor}:${nonce}`; need(!nonces.has(key), 'Duplicate actor operation nonce'); nonces.add(key);
      return { transactionHash, operationId: hash(operation.operationId), actor, nonce };
    });
    return { launchId, launchTransactionHash, manifestHash, operations };
  });
  return { schemaVersion: 'programmable.module-engine-lifecycle-plan.v1', release, canaries: checked };
}
async function main(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    need(['--release', '--canaries', '--output'].includes(argv[i]) && argv[i + 1] && !options[argv[i].slice(2)], 'Use --release FILE --canaries FILE --output FILE');
    options[argv[i].slice(2)] = argv[i + 1];
  }
  need(options.release && options.canaries && options.output, 'Actual release and transaction references required');
  const plan = await createEngineLifecyclePlan(exactJson(await readFile(options.release), 'Engine release identity'), exactJson(await readFile(options.canaries), 'Actual Engine canary references'));
  await writeFile(options.output, `${canonicalJson(plan)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: 'transaction-reference-input-only-no-evidence-or-finality', releaseDigest: plan.release.releaseDigest, canaries: plan.canaries.length }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
