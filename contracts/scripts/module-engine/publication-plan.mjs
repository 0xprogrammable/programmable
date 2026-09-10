#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { encodeFunctionData } from 'viem';
import { address, canonicalJson, digest, exactKeys, jsonSafe, need } from '../module-mode/core.mjs';
import { repositoryState } from '../module-mode/build.mjs';
import { publicationValidators } from '../module-mode/publication-shared.mjs';
import { readOperatorJson, readCondition, registryAbi, ZERO_ADDRESS } from '../module-mode/publication-plan.mjs';

export const ENGINE_PUBLICATION_OPERATOR_SCHEMA = 'programmable.module-engine-publication-owner-plan.v1';
export const ENGINE_LIFECYCLE_OPERATOR_SCHEMA = 'programmable.module-engine-lifecycle-owner-plan.v1';
export const isEngineOperationPlan = plan => [ENGINE_PUBLICATION_OPERATOR_SCHEMA, ENGINE_LIFECYCLE_OPERATOR_SCHEMA].includes(plan?.schemaVersion);
export function equal(a, b, label) { need(canonicalJson(jsonSafe(a)) === canonicalJson(jsonSafe(b)), `${label} differs`); }
// Resources (for example a position NFT ID) can advance between simulation and mining.
// The immutable plan is exact; each actual resourcesHash must instead match its canonical Host event/getter.
export function equalEngineLaunchPlan(actual, expected, label) {
  const withoutResources = value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'resourcesHash'));
  equal(withoutResources(actual), withoutResources(expected), label);
}
export async function bindEngineIdentity(identity) {
  const api = await publicationValidators(), result = api.moduleEngineReleaseIdentity(identity);
  equal(identity, result, 'Immutable engine release');
  return result;
}
/** Local consistency only. Authenticated current acceptance is checked separately before every wallet handoff. */
export async function bindEngineReview(bundle, identity) {
  exactKeys(bundle, ['source', 'manifest', 'review', 'artifact', 'buildPlan'], 'Engine accepted bundle');
  const api = await publicationValidators(); await bindEngineIdentity(identity);
  const source = api.validateModuleSubmissionRequest(bundle.source); need(source.ok, 'Invalid engine source package');
  need(api.validateModuleReviewDecisionRecordV1(bundle.review), 'Invalid engine review decision');
  const review = bundle.review, subject = api.parseReviewSubject(review.subject), artifact = api.parseReviewArtifact(bundle.artifact, subject), buildPlan = api.parseReviewPlan(bundle.buildPlan, subject);
  if (api.isModuleEngineAnyQuoteRelease(identity)) need(subject.author === '0x2bb333d48dfaf1596d9036671d2e43168994249e'
    && source.familyId === '0x6e348066f0f7596b0efa2013f5b96b0846390a32cf8b86706b2b06c8eaf935cc',
  'Any Quote accepted revision must preserve its original author and family');
  need(artifact.schemaVersion === 'programmable.modules.engine-build.v1' && buildPlan.schemaVersion === 'programmable.modules.engine-build-plan.v1', 'Protected engine profile required');
  api.verifyModuleEngineBuildArtifactV1(artifact, subject, buildPlan, source.request);
  need(review.command.outcome === 'accept' && review.command.artifactDigest === artifact.artifactDigest
    && review.reviewerWallet !== subject.author && artifact.reviewRequired.every(area => review.command.acknowledgedReviewAreas.includes(area)), 'Complete independent engine acceptance required');
  const definition = { profile: 'programmable.module-engine-solidity@1', catalogDefinition: bundle.manifest.manifest.catalogDefinition, revision: bundle.manifest.manifest.revision };
  const manifest = api.createReviewedModuleEngineManifest({ job: { artifact, plan: buildPlan }, descriptor: source.request.descriptor, release: identity,
    definition: definition.catalogDefinition, revision: definition.revision });
  equal(manifest, bundle.manifest, 'Reviewed engine manifest'); const manifestHash = api.computeModuleEngineHostManifestHash(manifest);
  need(review.command.hostManifestHash === manifestHash && source.requestDigest === subject.requestDigest && source.request.descriptor.author.toLowerCase() === subject.author,
    'Engine acceptance/source binding differs');
  return { source: source.request, artifact, buildPlan, review, manifest, manifestHash, definition, revision: api.engineRegistryRevision({ manifest, manifestHash }),
    reviewAuthority: address(review.reviewerWallet), familyId: source.familyId, packageId: source.packageId };
}
export async function assertAuthenticatedEngineOperationPlan(plan, sessionFile) {
  need(typeof sessionFile === 'string' && sessionFile.length > 0, 'Private reviewer session file required for engine operations');
  const api = await publicationValidators(), session = await api.readOperatorSession(sessionFile);
  need(address(session.walletAddress) === plan.reviewAuthority, 'Engine reviewer session differs; the operation actor is a separate wallet');
  const current = await api.createAuthenticatedReviewReader(session).read(plan.bundle.review.subject.submissionId);
  await assertCurrentEngineReview(plan, current);
}
/** Only genuine objects from the existing authenticated reader pass acceptedDecision/prepareEnginePublication. */
export async function assertCurrentEngineReview(plan, current) {
  const api = await publicationValidators(), checked = await bindEngineReview(plan.bundle, plan.identity), decision = api.acceptedDecision(current);
  equal(decision, plan.bundle.review, 'Current authenticated engine decision'); equal(current.source, plan.bundle.source, 'Current authenticated engine source');
  equal(current.artifact, plan.bundle.artifact, 'Current protected engine artifact'); equal(current.job.plan, plan.bundle.buildPlan, 'Current protected engine build plan');
  const publication = api.prepareEnginePublication(current, plan.identity, checked.definition, plan.owner);
  equal(publication.manifest, checked.manifest, 'Authenticated engine host manifest');
  if (plan.schemaVersion === ENGINE_PUBLICATION_OPERATOR_SCHEMA) for (const step of plan.steps) {
    const call = publication.calls.find(call => call.action === step.functionName);
    need(call && call.from === plan.owner && call.to === step.to && call.data === step.data && BigInt(call.value) === BigInt(step.value), 'Canonical engine publication call differs');
  }
}
export function enginePlanBody(schemaVersion, identity, owner, checked, bundle, sourceState, fields) {
  need(/^[0-9a-f]{40}$/.test(sourceState.sourceCommit) && /^[0-9a-f]{40}$/.test(sourceState.sourceTree) && typeof sourceState.sourceClean === 'boolean', 'Exact operator source state required');
  const body = jsonSafe({ schemaVersion, chainId: 4663, sourceCommit: sourceState.sourceCommit, sourceTree: sourceState.sourceTree, sourceClean: sourceState.sourceClean,
    identity, owner, reviewAuthority: checked.reviewAuthority, bundle, ...fields });
  return { ...body, planDigest: digest(schemaVersion, body) };
}
export async function createEnginePublicationOperatorPlan({ identity, owner, bundle, familyState, sourceState }) {
  owner = address(owner); const checked = await bindEngineReview(bundle, identity), api = await publicationValidators();
  need(['absent', 'existing'].includes(familyState), 'Explicit absent/existing family state required; quorum verifies it');
  const { manifest, revision, source, familyId, packageId } = checked, engine = manifest.manifest.source.engine, r = manifest.manifest.revision;
  const registry = identity.contracts.registry.address, host = identity.contracts.host.address;
  const author = address(source.descriptor.author), reward = address(source.descriptor.rewardWallet);
  const familyRead = readCondition(registry, registryAbi, 'families', [familyId], [author, reward]), steps = [];
  if (familyState === 'absent') {
    const args = [author, source.descriptor.familySalt, reward, checked.artifact.subject.requestDigest];
    steps.push({ kind: 'engine-family', label: `Register ${r.familyId} contributor family`, sender: owner, to: registry, target: registry, value: '0',
      functionName: 'registerReviewedFamily', arguments: args, data: encodeFunctionData({ abi: registryAbi, functionName: 'registerReviewedFamily', args }),
      preReads: [readCondition(registry, registryAbi, 'families', [familyId], [ZERO_ADDRESS, ZERO_ADDRESS])], postReads: [familyRead], newCode: [] });
  }
  const args = [packageId, revision, engine.immutableRuntimeOffsets, engine.immutableConstructorOffsets, r.operationPermissions, r.eligibleFamilies];
  steps.push({ kind: 'engine-revision', label: `Admit ${manifest.manifest.catalogDefinition.title}`, sender: owner, to: host, target: host, value: '0',
    functionName: 'approveRevision', arguments: args, data: encodeFunctionData({ abi: api.moduleEngineHostAbi, functionName: 'approveRevision', args }),
    preReads: [familyRead], postReads: [], newCode: [] });
  return enginePlanBody(ENGINE_PUBLICATION_OPERATOR_SCHEMA, identity, owner, checked, bundle, sourceState, { familyState, steps });
}
export async function assertEnginePublicationOperatorPlan(plan) {
  const rebuilt = await createEnginePublicationOperatorPlan({ ...plan, sourceState: plan }); equal(plan, rebuilt, 'Engine publication owner plan'); return plan;
}
async function main(argv) {
  const command = argv.shift(), options = {}; let candidate = false;
  const keys = command === 'bundle' ? ['identity', 'definition', 'submission', 'session-file', 'output'] : ['identity', 'bundle', 'owner', 'family-state', 'output'];
  need(['bundle', 'prepare'].includes(command), 'Expected bundle or prepare');
  for (let i = 0; i < argv.length; i++) { const key = argv[i]; if (key === '--candidate' && command === 'prepare') { need(!candidate, 'Duplicate candidate'); candidate = true; continue; }
    need(keys.includes(key.slice(2)) && !options[key.slice(2)] && argv[i + 1] && !argv[i + 1].startsWith('--'), 'Unknown, duplicate or missing engine publication argument'); options[key.slice(2)] = argv[++i]; }
  need(Object.keys(options).length === keys.length, `Required: ${keys.map(k => `--${k}`).join(' ')}`);
  const identity = await readOperatorJson(options.identity); let output;
  if (command === 'bundle') {
    const api = await publicationValidators(), session = await api.readOperatorSession(options['session-file']);
    const review = await api.createAuthenticatedReviewReader(session).read(options.submission), accepted = api.acceptedDecision(review);
    need(address(session.walletAddress) === address(accepted.reviewerWallet), 'Use the accepted reviewer session');
    const host = api.createEngineHostPreparation(review, identity, await readOperatorJson(options.definition));
    output = { source: review.source, manifest: host.manifest, review: accepted, artifact: review.artifact, buildPlan: review.job.plan };
    await bindEngineReview(output, identity);
  } else {
    const state = await repositoryState(); need(candidate || state.sourceClean, 'Clean operator source required');
    output = await createEnginePublicationOperatorPlan({ identity, bundle: await readOperatorJson(options.bundle), owner: options.owner, familyState: options['family-state'], sourceState: { ...state, sourceClean: !candidate && state.sourceClean } });
  }
  await writeFile(options.output, `${canonicalJson(output)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ authority: 'preparation-only', ...(output.planDigest ? { planDigest: output.planDigest, steps: output.steps.length, sourceClean: output.sourceClean } : { manifestHash: (await publicationValidators()).computeModuleEngineHostManifestHash(output.manifest) }) }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(() => { console.error('Engine publication preparation failed; no wallet authority or output was granted.'); process.exitCode = 1; });
