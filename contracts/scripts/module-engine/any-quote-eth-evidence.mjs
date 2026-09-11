import { encodeAbiParameters, parseAbiParameters } from 'viem';
import { address, canonicalJson, hash, need } from '../module-mode/core.mjs';
import { journalEntry } from '../module-mode/journal.mjs';
import { evidenceDigest, sourcifyVerificationRequests } from '../module-mode/evidence.mjs';
import { SOURCIFY_BASE, boundedPublicJson, sourcifyNeedsRecompilation, sourcifyPreflight, validateSourcifySource } from '../module-mode/source-readback.mjs';
import { recompileSourcifyInput } from '../module-mode/source-recompile.mjs';
import { engineSourceReuse } from './evidence.mjs';
import { exactJson } from '../module-mode/source-readback.mjs';
import { ANY_QUOTE_ETH_DEPLOYMENT_SCHEMA, ANY_QUOTE_ETH_NEW_ROLES, assertAnyQuoteEthProfile } from './any-quote-eth-core.mjs';
import { observeAnyQuoteEthReceipt } from './any-quote-eth-rpc.mjs';
import { engineWire } from './shared.mjs';

export const ANY_QUOTE_ETH_SOURCE_SCHEMA = 'programmable.module-engine-any-quote-eth-source-verification-evidence.v1';
export function anyQuoteEthConstructorArguments(plan, role) {
  assertAnyQuoteEthProfile(plan); need(ANY_QUOTE_ETH_NEW_ROLES.includes(role), 'Only new Any Quote sources have a creation transaction');
  if (role === 'host') return plan.steps[1].constructorArguments;
  if (role === 'sharedHook') return plan.sharedHookCreation.constructorArguments;
  return encodeAbiParameters(parseAbiParameters('address,address,address'),
    [plan.official.poolManager.address, plan.contracts.host.address, plan.economics.rewardAdmin]);
}
export async function collectAnyQuoteEthDeployment(plan, journal, providers) {
  assertAnyQuoteEthProfile(plan); const records = []; let engineBindings;
  for (const step of plan.steps) {
    const entry = await journalEntry(journal, plan.planDigest, step.index); need(entry?.transactionHash, `Stage ${step.index}: actual armed wallet transaction required`);
    const observed = await observeAnyQuoteEthReceipt(plan, entry, providers);
    need(observed.status === 'included-code-verified-unfinalized', `Stage ${step.index}: actual inclusion and runtime proof required`);
    const { engineBindings: bindings, ...record } = observed; engineBindings = bindings; records.push(record);
  }
  need(BigInt(records[0].transaction.nonce) + 1n === BigInt(records[1].transaction.nonce), 'Deployment nonce sequence differs');
  const identity = { ...plan.identityCandidate, startBlock: BigInt(records[1].receipt.blockNumber).toString() };
  const releaseDigest = (await engineWire()).computeModuleEngineReleaseDigest(identity);
  return { identity: { ...identity, releaseDigest }, evidence: { schemaVersion: ANY_QUOTE_ETH_DEPLOYMENT_SCHEMA, chainId: 4663,
    sourceVersion: identity.sourceVersion, sourceId: plan.sourceId, economicsPolicyId: identity.economicsPolicyId, releaseDigest,
    sourceCommit: plan.sourceCommit, planDigest: plan.planDigest, buildDigest: plan.buildDigest,
    status: 'included-code-verified', finality: 'not-asserted', records, engineBindings } };
}
export function anyQuoteEthSourceCreation(plan, role, evidence) {
  assertAnyQuoteEthProfile(plan); need(ANY_QUOTE_ETH_NEW_ROLES.includes(role), 'Unknown new Any Quote source');
  need(evidence?.schemaVersion === ANY_QUOTE_ETH_DEPLOYMENT_SCHEMA && evidence.chainId === 4663
    && evidence.sourceVersion === plan.identityCandidate.sourceVersion && evidence.sourceId === plan.sourceId
    && evidence.economicsPolicyId === plan.economics.economicsPolicyId && evidence.sourceCommit === plan.sourceCommit
    && evidence.planDigest === plan.planDigest && evidence.buildDigest === plan.buildDigest
    && evidence.status === 'included-code-verified' && evidence.records?.length === 2, 'Matching actual Any Quote deployment evidence required');
  const index = role === 'host' ? 1 : 0, step = plan.steps[index], record = evidence.records[index], pin = record.contracts?.[role];
  need(record.role === step.role && record.stepIndex === index && record.status === 'included-code-verified-unfinalized'
    && record.receipt.status === '0x1' && record.transaction.hash === record.receipt.transactionHash
    && pin?.address === plan.contracts[role].address && pin.runtimeCodeHash === plan.contracts[role].runtimeCodeHash
    && address(record.transaction.from) === plan.parameters.owner && record.transaction.to === step.to
    && record.transaction.input === step.data && BigInt(record.transaction.nonce) === BigInt(step.nonce), 'Actual Any Quote creation lineage differs');
  if (index === 1) need(record.receipt.contractAddress === plan.contracts.host.address, 'Direct Host creation address differs');
  const deployer = role === 'host' ? plan.parameters.owner : role === 'sharedHook' ? plan.steps[0].to : plan.contracts.sharedHook.address;
  return { transactionHash: hash(record.receipt.transactionHash), blockNumber: record.receipt.blockNumber,
    transactionIndex: record.receipt.transactionIndex, transactionSender: plan.parameters.owner, deployer };
}
export function anyQuoteEthSourceRequests(plan, build, deployment = null) {
  const requests = sourcifyVerificationRequests({ ...plan, contracts: Object.fromEntries(ANY_QUOTE_ETH_NEW_ROLES.map(role => [role, plan.contracts[role]])) }, build);
  if (deployment) for (const role of ANY_QUOTE_ETH_NEW_ROLES) {
    requests[role].body.creationTransactionHash = anyQuoteEthSourceCreation(plan, role, deployment).transactionHash;
    requests[role].status = 'unsubmitted-creation-bound';
  }
  return requests;
}
export function anyQuoteEthExplorerRequests(plan, build) {
  return Object.fromEntries(ANY_QUOTE_ETH_NEW_ROLES.map(role => {
    const pin = plan.contracts[role], [file, name] = Object.entries(build.artifacts[role].compilationTarget)[0];
    return [role, { method: 'POST', url: `https://robinhoodchain.blockscout.com/api/v2/smart-contracts/${pin.address}/verification/via/standard-input`,
      body: { compiler_version: 'v0.8.26+commit.8a97fa7a', license_type: 'none', contract_name: `${file}:${name}`,
        constructor_args: anyQuoteEthConstructorArguments(plan, role).slice(2), input: canonicalJson(build.standardInputs[role]) },
      status: 'unsubmitted', runtimeCodeHash: pin.runtimeCodeHash }];
  }));
}
export function anyQuoteEthGuardSourceReuse(plan, build, raw) {
  assertAnyQuoteEthProfile(plan);
  const previous = exactJson(raw, 'Actual prior guard source evidence'), release = plan.basis.guardRelease;
  need(evidenceDigest(raw) === release.sourceVerificationDigest && previous.chainId === 4663
    && previous.schemaVersion === 'programmable.module-engine-any-quote-source-verification-evidence.v1'
    && previous.sourceVersion === release.sourceVersion && previous.releaseDigest === release.releaseDigest
    && previous.sourceCommit === release.sourceCommit && previous.status === 'exact-source-and-runtime-verified'
    && Array.isArray(previous.records), 'Exact byte-bound historical guard source evidence required');
  const records = previous.records.filter(record => record.role === 'nativeRouteGuard'), pin = plan.contracts.nativeRouteGuard;
  need(records.length === 1 && records[0].address === pin.address && records[0].runtimeCodeHash === pin.runtimeCodeHash
    && canonicalJson([...records[0].sourcePaths].sort()) === canonicalJson(Object.keys(build.standardInputs.nativeRouteGuard.sources).sort()), 'Historical guard source pin/closure differs');
  hash(records[0].creationTransactionHash);
  return { ...records[0], sourceCommit: plan.sourceCommit, originalSourceCommit: previous.sourceCommit,
    reuse: { previousReleaseDigest: release.releaseDigest, previousSourceVerificationDigest: release.sourceVerificationDigest,
      equality: 'sealed-complete-runtime-and-source-closure', newCreationTransaction: false } };
}
export async function collectAnyQuoteEthSource(plan, build, deployment, previousRaw, previousGuardRaw, fetchImpl = fetch) {
  const reused = [...engineSourceReuse(plan, build, previousRaw), anyQuoteEthGuardSourceReuse(plan, build, previousGuardRaw)],
    providerPreflight = await sourcifyPreflight(fetchImpl), records = [];
  for (const role of ANY_QUOTE_ETH_NEW_ROLES) {
    const creation = anyQuoteEthSourceCreation(plan, role, deployment), url = `${SOURCIFY_BASE}/v2/contract/4663/${plan.contracts[role].address}?fields=all`;
    const { raw, value } = await boundedPublicJson(url, fetchImpl);
    const recompilation = sourcifyNeedsRecompilation(build.standardInputs[role], value) ? await recompileSourcifyInput(value, build.standardInputs[role]) : undefined;
    records.push({ ...validateSourcifySource({ plan, build, role, constructorArguments: anyQuoteEthConstructorArguments(plan, role), creation, recompilation }, value),
      url, responseBytesDigest: evidenceDigest(raw) });
  }
  return { schemaVersion: ANY_QUOTE_ETH_SOURCE_SCHEMA, chainId: 4663, sourceVersion: plan.identityCandidate.sourceVersion, sourceId: plan.sourceId,
    economicsPolicyId: plan.economics.economicsPolicyId, releaseDigest: hash(deployment.releaseDigest), sourceCommit: plan.sourceCommit,
    buildDigest: plan.buildDigest, status: 'exact-source-and-runtime-verified', providerPreflight, records: [...records, ...reused] };
}
