import { encodeAbiParameters, parseAbiParameters } from 'viem';
import { canonicalJson, hash, need } from '../module-mode/core.mjs';
import { collectDeploymentEvidence, constructorArguments, evidenceDigest, sourceCreation, sourcifyVerificationRequests } from '../module-mode/evidence.mjs';
import { SOURCIFY_BASE, boundedPublicJson, sourcifyNeedsRecompilation, sourcifyPreflight, validateSourcifySource } from '../module-mode/source-readback.mjs';
import { recompileSourcifyInput } from '../module-mode/source-recompile.mjs';
import { NEW_ROLES, REUSED_ROLES, ECONOMICS_POLICY_ID, PLAN_SCHEMA_V2 } from './core.mjs';
import { observeNativeV2Bindings } from './rpc.mjs';

export function nativeV2ConstructorArguments(plan, role) {
  need(NEW_ROLES.includes(role), 'Reused contracts have no new creation transaction');
  return role === 'rewardLedger'
    ? encodeAbiParameters(parseAbiParameters('address,address,address,address'), [plan.official.poolManager.address,
      plan.contracts.registry.address, plan.economics.treasury, plan.economics.rewardAdmin])
    : constructorArguments(plan, role);
}

export function nativeV2SourceRequests(plan, build, deploymentEvidence = null) {
  need(plan.schemaVersion === PLAN_SCHEMA_V2, 'Native V2 plan required');
  const newlyDeployed = { ...plan, contracts: Object.fromEntries(NEW_ROLES.map(role => [role, plan.contracts[role]])) };
  // The parent/child receipt resolver still needs all pins, including the reused runtime factory.
  const requests = sourcifyVerificationRequests(newlyDeployed, build);
  for (const role of NEW_ROLES) if (deploymentEvidence) {
    const creation = sourceCreation(plan, role, deploymentEvidence);
    requests[role].body.creationTransactionHash = creation.transactionHash;
    requests[role].status = 'unsubmitted-creation-bound';
  }
  return requests;
}

export function nativeV2ExplorerRequests(plan, build) {
  return Object.fromEntries(NEW_ROLES.map(role => {
    const pin = plan.contracts[role], [file, name] = Object.entries(build.artifacts[role].compilationTarget)[0];
    return [role, { method: 'POST', url: `https://robinhoodchain.blockscout.com/api/v2/smart-contracts/${pin.address}/verification/via/standard-input`,
      body: { compiler_version: 'v0.8.26+commit.8a97fa7a', license_type: 'none', contract_name: `${file}:${name}`,
        constructor_args: nativeV2ConstructorArguments(plan, role).slice(2), input: canonicalJson(build.standardInputs[role]) },
      status: 'unsubmitted', runtimeCodeHash: pin.runtimeCodeHash }];
  }));
}

export async function collectNativeV2Deployment(plan, journal, providers) {
  const result = await collectDeploymentEvidence(plan, journal, providers);
  const launcher = result.evidence.records.find(record => record.role === 'launcher');
  const nativeBindings = await observeNativeV2Bindings(plan, providers, launcher.receipt.blockNumber, launcher.receipt.blockHash, NEW_ROLES);
  return { ...result, evidence: { ...result.evidence, sourceVersion: 'module-native-v2', economicsPolicyId: ECONOMICS_POLICY_ID, nativeBindings } };
}

/** Reuse is evidenced by the prior release and exact current source/runtime pins, without inventing new receipts. */
export function nativeV2SourceReuse(plan, build, previousRaw) {
  const previous = JSON.parse(Buffer.from(previousRaw).toString('utf8'));
  const release = plan.basis.previousRelease;
  need(evidenceDigest(previousRaw) === release.sourceVerificationDigest && previous.releaseDigest === release.releaseDigest
    && previous.chainId === 4663 && previous.sourceCommit === release.sourceCommit
    && previous.status === 'exact-source-and-runtime-verified' && Array.isArray(previous.records), 'Actual byte-bound V1 source verification evidence required for reuse');
  return REUSED_ROLES.map(role => {
    const matches = previous.records.filter(record => record.role === role), pin = plan.contracts[role];
    need(matches.length === 1 && matches[0].address === pin.address && matches[0].runtimeCodeHash === pin.runtimeCodeHash, `${role}: prior verification pin differs`);
    need(matches[0].sourcePaths?.length === Object.keys(build.standardInputs[role].sources).length
      && matches[0].sourcePaths.every(file => Object.hasOwn(build.standardInputs[role].sources, file)), `${role}: reused source closure differs`);
    return { ...matches[0], sourceCommit: plan.sourceCommit, originalSourceCommit: previous.sourceCommit,
      reuse: { previousReleaseDigest: release.releaseDigest, previousSourceVerificationDigest: release.sourceVerificationDigest,
        equality: 'sealed-complete-runtime-and-source-closure', newCreationTransaction: false } };
  });
}

/** Same complete source/creation/runtime validator as V1, with actual V2 constructors and receipt lineage. GET only. */
export async function collectNativeV2Source(plan, build, deploymentEvidence, previousSourceRaw, fetchImpl = fetch) {
  const reused = nativeV2SourceReuse(plan, build, previousSourceRaw);
  const providerPreflight = await sourcifyPreflight(fetchImpl), records = [];
  for (const role of NEW_ROLES) {
    const pin = plan.contracts[role], creation = sourceCreation(plan, role, deploymentEvidence);
    const url = `${SOURCIFY_BASE}/v2/contract/4663/${pin.address}?fields=all`;
    const { raw, value } = await boundedPublicJson(url, fetchImpl);
    const recompilation = sourcifyNeedsRecompilation(build.standardInputs[role], value)
      ? await recompileSourcifyInput(value, build.standardInputs[role]) : undefined;
    const verified = validateSourcifySource({ plan, build, role, constructorArguments: nativeV2ConstructorArguments(plan, role), creation, recompilation }, value);
    records.push({ ...verified, url, responseBytesDigest: evidenceDigest(raw) });
  }
  return { schemaVersion: 'programmable.module-mode-source-verification-evidence.v1', chainId: 4663, sourceVersion: 'module-native-v2',
    economicsPolicyId: ECONOMICS_POLICY_ID, releaseDigest: hash(deploymentEvidence.releaseDigest), sourceCommit: plan.sourceCommit,
    buildDigest: plan.buildDigest, status: 'exact-source-and-runtime-verified', providerPreflight, records: [...records, ...reused] };
}
