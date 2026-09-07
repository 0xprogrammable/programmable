import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { address, canonicalJson, hash, need } from '../module-mode/core.mjs';
import { journalEntry } from '../module-mode/journal.mjs';
import { evidenceBytes, evidenceDigest, sourcifyVerificationRequests } from '../module-mode/evidence.mjs';
import { SOURCIFY_BASE, SOURCIFY_QUOTE_PLANNER_AUXDATA_PROFILE, boundedPublicJson, exactJson, sourcifyNeedsRecompilation, sourcifyPreflight, validateSourcifySource } from '../module-mode/source-readback.mjs';
import { recompileSourcifyInput } from '../module-mode/source-recompile.mjs';
import { assertQuoteProfile, QUOTE_DEPLOYMENT_SCHEMA, QUOTE_ROLES, quoteInfrastructureIdentity } from './quote-core.mjs';
import { assertQuoteWethProxyObservation, observeQuoteReceipt } from './quote-rpc.mjs';

export const QUOTE_SOURCE_SCHEMA = 'programmable.module-engine-quote-source-verification-evidence.v1';
export function quoteConstructorArguments(plan, role) {
  assertQuoteProfile(plan); need(QUOTE_ROLES.includes(role), 'Only the new Quote roles have creation transactions');
  return plan.steps[QUOTE_ROLES.indexOf(role)].constructorArguments;
}
export async function collectQuoteDeployment(plan, journal, providers) {
  assertQuoteProfile(plan); const records = [];
  for (const step of plan.steps) {
    const entry = await journalEntry(journal, plan.planDigest, step.index);
    need(entry?.transactionHash, `${step.role}: actual protected deployment transaction required`);
    const record = await observeQuoteReceipt(plan, entry, providers);
    need(record.status === 'included-code-verified-unfinalized', `${step.role}: actual inclusion and runtime required`); records.push(record);
  }
  const identity = quoteInfrastructureIdentity(plan, BigInt(records[1].receipt.blockNumber).toString());
  const evidence = { schemaVersion: QUOTE_DEPLOYMENT_SCHEMA, chainId: 4663, sourceVersion: identity.sourceVersion,
    infrastructureDigest: identity.infrastructureDigest, sourceCommit: plan.sourceCommit, planDigest: plan.planDigest,
    buildDigest: plan.buildDigest, status: 'included-code-verified', finality: 'not-asserted', templatePublication: 'not-proven', records };
  for (const role of QUOTE_ROLES) quoteSourceCreation(plan, role, evidence);
  return { identity, evidence };
}
export function quoteSourceCreation(plan, role, evidence) {
  assertQuoteProfile(plan); need(QUOTE_ROLES.includes(role), 'Unknown Quote creation role');
  need(evidence?.schemaVersion === QUOTE_DEPLOYMENT_SCHEMA && evidence.chainId === 4663
    && evidence.sourceVersion === plan.identityCandidate.sourceVersion && evidence.sourceCommit === plan.sourceCommit
    && evidence.planDigest === plan.planDigest && evidence.buildDigest === plan.buildDigest
    && evidence.status === 'included-code-verified' && evidence.records?.length === 2, 'Matching actual Quote deployment evidence required');
  const records = evidence.records;
  need(new Set(records.map(record => record.receipt?.transactionHash)).size === 2
    && BigInt(records[0].receipt.blockNumber) <= BigInt(records[1].receipt.blockNumber)
    && (records[0].receipt.blockNumber !== records[1].receipt.blockNumber
      || BigInt(records[0].receipt.transactionIndex) < BigInt(records[1].receipt.transactionIndex)), 'Quote deployment stages are not in distinct ordered transactions');
  need(evidence.infrastructureDigest === quoteInfrastructureIdentity(plan, BigInt(records[1].receipt.blockNumber).toString()).infrastructureDigest,
    'Quote infrastructure digest differs');
  for (const [index, record] of records.entries()) {
    const step = plan.steps[index], pin = record.contracts?.[step.role], bindings = record.quoteBindings;
    need(record.stepIndex === index && record.role === step.role && record.status === 'included-code-verified-unfinalized'
      && record.receipt.status === '0x1' && pin?.address === step.target && pin.runtimeCodeHash === plan.contracts[step.role].runtimeCodeHash
      && record.transaction.hash === record.receipt.transactionHash && record.transaction.blockHash === record.receipt.blockHash
      && record.transaction.blockNumber === record.receipt.blockNumber && address(record.transaction.from) === step.sender
      && address(record.transaction.to) === step.to && record.transaction.input === step.data && BigInt(record.transaction.value) === 0n
      && BigInt(record.transaction.chainId) === 4663n && BigInt(record.transaction.type) === 2n,
    'Actual Quote transaction, code or receipt lineage differs');
    need(bindings?.schemaVersion === 'programmable.module-engine-quote-bindings.v1' && bindings.chainId === 4663
      && bindings.planDigest === plan.planDigest && BigInt(bindings.blockNumber) === BigInt(record.receipt.blockNumber)
      && bindings.blockHash === record.receipt.blockHash && canonicalJson(bindings.dependencies) === canonicalJson(plan.dependencies)
      && canonicalJson(bindings.deployedRoles) === canonicalJson(QUOTE_ROLES.slice(0, index + 1)), 'Quote dependency readback differs');
    assertQuoteWethProxyObservation(plan, bindings);
  }
  const record = records[QUOTE_ROLES.indexOf(role)];
  return { transactionHash: hash(record.receipt.transactionHash), blockNumber: record.receipt.blockNumber,
    transactionIndex: record.receipt.transactionIndex, transactionSender: address(record.transaction.from),
    deployer: plan.official.deterministicDeployer.address };
}
export function quoteSourceRequests(plan, build, deployment = null) {
  assertQuoteProfile(plan); const requests = sourcifyVerificationRequests(plan, build);
  if (deployment) for (const role of QUOTE_ROLES) {
    requests[role].body.creationTransactionHash = quoteSourceCreation(plan, role, deployment).transactionHash;
    requests[role].status = 'unsubmitted-creation-bound';
  }
  return requests;
}
export function quoteExplorerRequests(plan, build) {
  return Object.fromEntries(QUOTE_ROLES.map(role => {
    const pin = plan.contracts[role], [file, name] = Object.entries(build.artifacts[role].compilationTarget)[0];
    return [role, { method: 'POST', url: `https://robinhoodchain.blockscout.com/api/v2/smart-contracts/${pin.address}/verification/via/standard-input`,
      body: { compiler_version: 'v0.8.26+commit.8a97fa7a', license_type: 'none', contract_name: `${file}:${name}`,
        constructor_args: quoteConstructorArguments(plan, role).slice(2), input: canonicalJson(build.standardInputs[role]) },
      status: 'unsubmitted', runtimeCodeHash: pin.runtimeCodeHash }];
  }));
}
export function quoteSourceReuse(plan, build, raw) {
  const previous = exactJson(raw, 'Actual prior native source evidence'), release = plan.basis.previousRelease;
  need(evidenceDigest(raw) === release.sourceVerificationDigest && previous.chainId === 4663 && previous.releaseDigest === release.releaseDigest
    && previous.sourceCommit === release.sourceCommit && previous.status === 'exact-source-and-runtime-verified'
    && Array.isArray(previous.records), 'Exact byte-bound historical source evidence required');
  const role = 'positionForwarderFactory', records = previous.records.filter(record => record.role === role), pin = plan.dependencies[role];
  need(records.length === 1 && records[0].address === pin.address && records[0].runtimeCodeHash === pin.runtimeCodeHash
    && canonicalJson([...records[0].sourcePaths].sort()) === canonicalJson(Object.keys(build.standardInputs[role].sources).sort()),
  'Retained Forwarder source pin/closure differs');
  hash(records[0].creationTransactionHash);
  return { ...records[0], sourceCommit: plan.sourceCommit, originalSourceCommit: previous.sourceCommit,
    reuse: { previousReleaseDigest: release.releaseDigest, previousSourceVerificationDigest: release.sourceVerificationDigest,
      equality: 'sealed-complete-runtime-and-source-closure', newCreationTransaction: false } };
}
export async function collectQuoteSource(plan, build, deployment, previousRaw, fetchImpl = fetch) {
  const reused = quoteSourceReuse(plan, build, previousRaw), records = [];
  for (const role of QUOTE_ROLES) quoteSourceCreation(plan, role, deployment);
  const providerPreflight = await sourcifyPreflight(fetchImpl);
  for (const role of QUOTE_ROLES) {
    const creation = quoteSourceCreation(plan, role, deployment), url = `${SOURCIFY_BASE}/v2/contract/4663/${plan.contracts[role].address}?fields=all`;
    const { raw, value } = await boundedPublicJson(url, fetchImpl);
    const recompilation = sourcifyNeedsRecompilation(build.standardInputs[role], value) ? await recompileSourcifyInput(value, build.standardInputs[role]) : undefined;
    const verified = validateSourcifySource({ plan, build, role, constructorArguments: quoteConstructorArguments(plan, role), creation, recompilation,
      ...(role === 'positionPlanner' ? { compilerAuxdataProfile: SOURCIFY_QUOTE_PLANNER_AUXDATA_PROFILE } : {}) }, value);
    records.push({ ...verified, url, responseBytesDigest: evidenceDigest(raw) });
  }
  return { schemaVersion: QUOTE_SOURCE_SCHEMA, chainId: 4663, sourceVersion: plan.identityCandidate.sourceVersion,
    infrastructureDigest: hash(deployment.infrastructureDigest), sourceCommit: plan.sourceCommit, planDigest: plan.planDigest,
    buildDigest: plan.buildDigest, status: 'exact-source-and-runtime-verified', providerPreflight, records: [...records, reused] };
}
/** Infrastructure evidence intentionally has no launch-source releaseDigest or activation flag. */
export async function writeQuoteEvidence(directory, kind, evidence, infrastructureDigest) {
  const schemas = { deployment: QUOTE_DEPLOYMENT_SCHEMA, sourceVerification: QUOTE_SOURCE_SCHEMA };
  need(Object.hasOwn(schemas, kind) && evidence.schemaVersion === schemas[kind] && evidence.chainId === 4663
    && evidence.infrastructureDigest === hash(infrastructureDigest), 'Quote evidence identity differs');
  const file = kind === 'deployment' ? 'deployment.json' : 'source-verification.json', raw = evidenceBytes(evidence);
  await writeFile(path.join(directory, file), raw, { flag: 'wx', mode: 0o600 }); return { file, digest: evidenceDigest(raw) };
}
