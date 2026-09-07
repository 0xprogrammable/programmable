import { encodeAbiParameters, parseAbiParameters } from 'viem';
import { address, canonicalJson, hash, need } from '../module-mode/core.mjs';
import { journalEntry } from '../module-mode/journal.mjs';
import { evidenceDigest, sourcifyVerificationRequests } from '../module-mode/evidence.mjs';
import { SOURCIFY_BASE, boundedPublicJson, exactJson, sourcifyNeedsRecompilation, sourcifyPreflight, validateSourcifySource } from '../module-mode/source-readback.mjs';
import { recompileSourcifyInput } from '../module-mode/source-recompile.mjs';
import { ENGINE_DEPLOYMENT_SCHEMA, ENGINE_NEW_ROLES, ENGINE_REUSED_ROLES } from './core.mjs';
import { engineWire } from './shared.mjs';
import { observeEngineReceipt } from './rpc.mjs';

export const ENGINE_SOURCE_SCHEMA = 'programmable.module-engine-source-verification-evidence.v1';
export function engineConstructorArguments(plan, role) {
  need(ENGINE_NEW_ROLES.includes(role), 'Retained dependencies have no new creation transaction');
  return role === 'host' ? plan.steps[0].constructorArguments : encodeAbiParameters(parseAbiParameters('address,address,address,address'),
    [plan.official.poolManager.address, plan.contracts.registry.address, plan.economics.treasury, plan.economics.rewardAdmin]);
}

/** The existing receipt/journal observer remains authoritative; only the canonical Engine release encoding differs. */
export async function collectEngineDeployment(plan, journal, providers) {
  need(plan.steps.length === 1 && plan.steps[0].role === 'host', 'Single reviewed core deployment stage required');
  const entry = await journalEntry(journal, plan.planDigest, 0); need(entry?.transactionHash, 'Actual protected host deployment transaction required');
  const observed = await observeEngineReceipt(plan, entry, providers); need(observed.status === 'included-code-verified-unfinalized', 'Actual host/ledger inclusion and code required');
  const { engineBindings, ...record } = observed, wire = await engineWire();
  const candidate = { ...plan.identityCandidate, startBlock: BigInt(record.receipt.blockNumber).toString() };
  const releaseDigest = wire.computeModuleEngineReleaseDigest(candidate);
  return { identity: { ...candidate, releaseDigest }, evidence: { schemaVersion: ENGINE_DEPLOYMENT_SCHEMA, chainId: 4663,
    sourceVersion: candidate.sourceVersion, sourceId: plan.sourceId, economicsPolicyId: candidate.economicsPolicyId,
    releaseDigest, sourceCommit: plan.sourceCommit, planDigest: plan.planDigest, buildDigest: plan.buildDigest,
    status: 'included-code-verified', finality: 'not-asserted', records: [record], engineBindings } };
}

export function engineSourceCreation(plan, role, evidence) {
  need(ENGINE_NEW_ROLES.includes(role) && evidence?.schemaVersion === ENGINE_DEPLOYMENT_SCHEMA && evidence.chainId === 4663
    && evidence.sourceVersion === plan.identityCandidate.sourceVersion && evidence.sourceId === plan.sourceId
    && evidence.economicsPolicyId === plan.economics.economicsPolicyId
    && evidence.sourceCommit === plan.sourceCommit && evidence.planDigest === plan.planDigest && evidence.buildDigest === plan.buildDigest
    && evidence.status === 'included-code-verified' && evidence.records?.length === 1, 'Matching actual Engine deployment evidence required');
  const record = evidence.records[0], pin = record.contracts?.[role];
  need(record.role === 'host' && record.status === 'included-code-verified-unfinalized' && record.receipt.status === '0x1'
    && pin?.address === plan.contracts[role].address && pin.runtimeCodeHash === plan.contracts[role].runtimeCodeHash
    && record.transaction.hash === record.receipt.transactionHash && address(record.transaction.from) === plan.parameters.owner,
  'Actual host/child code and receipt lineage differs');
  return { transactionHash: hash(record.receipt.transactionHash), blockNumber: record.receipt.blockNumber, transactionIndex: record.receipt.transactionIndex,
    transactionSender: address(record.transaction.from), deployer: role === 'host' ? plan.official.deterministicDeployer.address : plan.contracts.host.address };
}

export function engineSourceRequests(plan, build, deployment = null) {
  const contracts = Object.fromEntries(ENGINE_NEW_ROLES.map(role => [role, plan.contracts[role]]));
  const requests = sourcifyVerificationRequests({ ...plan, contracts }, build);
  if (deployment) for (const role of ENGINE_NEW_ROLES) {
    requests[role].body.creationTransactionHash = engineSourceCreation(plan, role, deployment).transactionHash;
    requests[role].status = 'unsubmitted-creation-bound';
  }
  return requests;
}
export function engineExplorerRequests(plan, build) {
  return Object.fromEntries(ENGINE_NEW_ROLES.map(role => {
    const pin = plan.contracts[role], [file, name] = Object.entries(build.artifacts[role].compilationTarget)[0];
    return [role, { method: 'POST', url: `https://robinhoodchain.blockscout.com/api/v2/smart-contracts/${pin.address}/verification/via/standard-input`,
      body: { compiler_version: 'v0.8.26+commit.8a97fa7a', license_type: 'none', contract_name: `${file}:${name}`,
        constructor_args: engineConstructorArguments(plan, role).slice(2), input: canonicalJson(build.standardInputs[role]) }, status: 'unsubmitted', runtimeCodeHash: pin.runtimeCodeHash }];
  }));
}

export function engineSourceReuse(plan, build, raw) {
  const previous = exactJson(raw, 'Actual prior native source evidence'), release = plan.basis.previousRelease;
  need(evidenceDigest(raw) === release.sourceVerificationDigest && previous.chainId === 4663 && previous.releaseDigest === release.releaseDigest
    && previous.sourceCommit === release.sourceCommit && previous.status === 'exact-source-and-runtime-verified' && Array.isArray(previous.records), 'Exact byte-bound historical source evidence required');
  return ENGINE_REUSED_ROLES.map(role => {
    const records = previous.records.filter(record => record.role === role), pin = plan.contracts[role];
    need(records.length === 1 && records[0].address === pin.address && records[0].runtimeCodeHash === pin.runtimeCodeHash
      && canonicalJson([...records[0].sourcePaths].sort()) === canonicalJson(Object.keys(build.standardInputs[role].sources).sort()), `${role}: historical source pin/closure differs`);
    hash(records[0].creationTransactionHash);
    return { ...records[0], sourceCommit: plan.sourceCommit, originalSourceCommit: previous.sourceCommit,
      reuse: { previousReleaseDigest: release.releaseDigest, previousSourceVerificationDigest: release.sourceVerificationDigest,
        equality: 'sealed-complete-runtime-and-source-closure', newCreationTransaction: false } };
  });
}
export async function collectEngineSource(plan, build, deployment, previousRaw, fetchImpl = fetch) {
  const reused = engineSourceReuse(plan, build, previousRaw), providerPreflight = await sourcifyPreflight(fetchImpl), records = [];
  for (const role of ENGINE_NEW_ROLES) {
    const creation = engineSourceCreation(plan, role, deployment), url = `${SOURCIFY_BASE}/v2/contract/4663/${plan.contracts[role].address}?fields=all`;
    const { raw, value } = await boundedPublicJson(url, fetchImpl);
    const recompilation = sourcifyNeedsRecompilation(build.standardInputs[role], value) ? await recompileSourcifyInput(value, build.standardInputs[role]) : undefined;
    const verified = validateSourcifySource({ plan, build, role, constructorArguments: engineConstructorArguments(plan, role), creation, recompilation }, value);
    records.push({ ...verified, url, responseBytesDigest: evidenceDigest(raw) });
  }
  return { schemaVersion: ENGINE_SOURCE_SCHEMA, chainId: 4663, sourceVersion: plan.identityCandidate.sourceVersion, sourceId: plan.sourceId,
    economicsPolicyId: plan.economics.economicsPolicyId, releaseDigest: hash(deployment.releaseDigest), sourceCommit: plan.sourceCommit,
    buildDigest: plan.buildDigest, status: 'exact-source-and-runtime-verified', providerPreflight, records: [...records, ...reused] };
}
