#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { encodeFunctionData, erc20Abi } from 'viem';
import { address, bytes, canonicalJson, digest, exactKeys, hash, jsonSafe, need, uint } from '../module-mode/core.mjs';
import { repositoryState } from '../module-mode/build.mjs';
import { readCondition, readOperatorJson, ZERO_ADDRESS } from '../module-mode/publication-plan.mjs';
import { publicationValidators } from '../module-mode/publication-shared.mjs';
import { assertPublicationRequest } from '../module-mode/publication-rpc.mjs';
import { bindEngineReview, enginePlanBody, equal, equalEngineLaunchPlan, assertEnginePublicationOperatorPlan, ENGINE_PUBLICATION_OPERATOR_SCHEMA, ENGINE_LIFECYCLE_OPERATOR_SCHEMA } from './publication-plan.mjs';
import { assertAnyQuotePlan, ANY_QUOTE_DEPLOYMENT_SCHEMA } from './any-quote-core.mjs';
import { ANY_QUOTE_SOURCE_SCHEMA } from './any-quote-evidence.mjs';
import { assertAnyQuoteEthPlan, ANY_QUOTE_ETH_DEPLOYMENT_SCHEMA } from './any-quote-eth-core.mjs';
import { ANY_QUOTE_ETH_SOURCE_SCHEMA } from './any-quote-eth-evidence.mjs';
import { evidenceDigest } from '../module-mode/evidence.mjs';
import { exactJson } from '../module-mode/source-readback.mjs';
const ZERO_HASH = `0x${'0'.repeat(64)}`;
export function optionalHash(value) { need(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value), 'Canonical bytes32 required'); return value; }
export function bindEngineIntent(intent, token, quote, actor, deadline, nonce, api) {
  exactKeys(intent, ['operationId', 'recipient', 'inputAsset', 'inputAmount', 'outputAsset', 'minimumOutput', 'data'], 'Engine operation intent');
  const asset = role => { need(['primary', 'quote', 'native'].includes(role), 'Explicit primary/quote/native asset role required'); return role === 'primary' ? token : role === 'quote' ? quote : ZERO_ADDRESS; };
  return api.moduleEngineOperation({ operationId: hash(intent.operationId), recipient: address(intent.recipient), inputAsset: asset(intent.inputAsset), inputAmount: BigInt(uint(intent.inputAmount)),
    outputAsset: asset(intent.outputAsset), minimumOutput: BigInt(uint(intent.minimumOutput)), data: bytes(intent.data) }, actor, BigInt(uint(deadline, 'deadline', true)), BigInt(uint(nonce)));
}
export function assertEnginePermission(revision, launch, operation, actor) {
  const permission = revision.operationPermissions.find(p => p.operationId === operation.operationId);
  need(permission && operation.actor === actor && (permission.authorization === 0 || (permission.authorization === 1 && actor === launch.creator)), 'Engine operation actor or creator authority differs');
  const role = (asset, amount) => asset === ZERO_ADDRESS ? BigInt(amount) === 0n ? 0 : 4 : asset === launch.token ? 1 : asset === launch.quoteAsset ? 2 : -1;
  const input = role(operation.inputAsset, operation.inputAmount), output = role(operation.outputAsset, operation.minimumOutput);
  need(input >= 0 && output >= 0 && (permission.inputRoles & input) === input && (permission.outputRoles & output) === output, 'Engine asset roles exceed the accepted operation permission');
  return permission;
}
function fundingSteps(action, owner, host, operation) {
  exactKeys(action.funding, ['mode', 'expectedAllowance'], 'Exact engine funding'); uint(action.funding.expectedAllowance, 'expectedAllowance');
  const erc20 = operation.inputAsset !== ZERO_ADDRESS && BigInt(operation.inputAmount) > 0n, mode = action.funding.mode;
  if (!erc20) { need(mode === 'none' && action.funding.expectedAllowance === '0', 'No ERC20 approval is allowed for this operation'); return []; }
  need(['existing', 'approve', 'reset-approve'].includes(mode), 'Select exact existing allowance or bounded approval');
  const amount = operation.inputAmount.toString(), before = action.funding.expectedAllowance;
  need(BigInt(amount) < (1n << 256n) - 1n, 'Unlimited ERC20 allowance is forbidden');
  if (mode === 'existing') { need(before === amount, 'Existing allowance must equal the exact operation amount'); return []; }
  need(mode === 'approve' ? before === '0' : BigInt(before) > 0n, 'Allowance reset mode differs from the reviewed existing allowance');
  const approval = (amount, prior) => ({ kind: 'engine-approve', label: amount === '0' ? 'Reset the exact Host funding allowance' : 'Approve the exact next operation input', sender: owner,
    to: operation.inputAsset, target: operation.inputAsset, value: '0', functionName: 'approve', arguments: [host, amount],
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [host, BigInt(amount)] }), approval: { spender: host, amount, previousAllowance: prior, operationId: operation.operationId },
    preReads: [readCondition(operation.inputAsset, erc20Abi, 'allowance', [owner, host], BigInt(prior))],
    postReads: [readCondition(operation.inputAsset, erc20Abi, 'allowance', [owner, host], BigInt(amount))], newCode: [] });
  return [...(mode === 'reset-approve' ? [approval('0', before)] : []), approval(amount, '0')];
}
function quotePin(value) {
  exactKeys(value, ['address', 'runtimeCodeHash', 'decimals'], 'Reviewed quote asset');
  need(Number.isInteger(value.decimals) && value.decimals >= 0 && value.decimals <= 18, 'Quote decimals are unsupported');
  return { address: address(value.address), runtimeCodeHash: hash(value.runtimeCodeHash), decimals: value.decimals };
}
export const isAnyQuoteEthLifecyclePlan = plan => plan?.schemaVersion === ENGINE_LIFECYCLE_OPERATOR_SCHEMA && plan.identity?.sourceVersion === 'module-engine-any-quote-eth-v1';
export const isAnyQuoteLifecyclePlan = plan => plan?.schemaVersion === ENGINE_LIFECYCLE_OPERATOR_SCHEMA
  && ['module-engine-any-quote-v1', 'module-engine-any-quote-eth-v1'].includes(plan.identity?.sourceVersion);
export const ANY_QUOTE_PACKET_SCHEMA = 'programmable.module-engine-any-quote-preactivation-packet.v1';
export const ANY_QUOTE_ETH_PACKET_SCHEMA = 'programmable.module-engine-any-quote-eth-preactivation-packet.v1';
const checkedDeploymentPlans = new Map();
/** These are real earlier artifacts, not an active release or a claim of successful validation. */
export async function bindAnyQuotePreactivationPacket(packet, identity, bundle) {
  const nativeFees = identity.sourceVersion === 'module-engine-any-quote-eth-v1', packetSchema = nativeFees ? ANY_QUOTE_ETH_PACKET_SCHEMA : ANY_QUOTE_PACKET_SCHEMA;
  const rawKeys = ['deploymentEvidenceRaw', 'sourceVerificationEvidenceRaw', 'previousSourceVerificationEvidenceRaw', ...(nativeFees ? ['previousGuardSourceVerificationEvidenceRaw'] : [])];
  exactKeys(packet, ['schemaVersion', 'deploymentPlan', 'build', 'deploymentEntries', ...rawKeys, 'admission'], 'Any Quote pre-activation packet');
  for (const key of rawKeys)
    need(typeof packet[key] === 'string' && Buffer.byteLength(packet[key]) > 0 && Buffer.byteLength(packet[key]) <= 16 * 1024 * 1024, 'Bounded exact evidence file bytes required');
  need(packet.schemaVersion === packetSchema && packet.build?.sourceClean === true && packet.deploymentPlan?.sourceClean === true, 'Actual clean-source Any Quote deployment packet required');
  // CREATE2 salt mining is deterministic but slow. Cache only a successful in-process
  // reconstruction under the complete plan/build bytes; any mutation gets a different key.
  const deploymentKey = digest('programmable.any-quote.operator-deployment-input.v1', { plan: packet.deploymentPlan, build: packet.build });
  if (!checkedDeploymentPlans.has(deploymentKey)) {
    const check = (nativeFees ? assertAnyQuoteEthPlan : assertAnyQuotePlan)(packet.deploymentPlan, packet.build); checkedDeploymentPlans.set(deploymentKey, check);
    try { await check; } catch (error) { checkedDeploymentPlans.delete(deploymentKey); throw error; }
    if (checkedDeploymentPlans.size > 8) checkedDeploymentPlans.delete(checkedDeploymentPlans.keys().next().value);
  } else await checkedDeploymentPlans.get(deploymentKey);
  const deployment = exactJson(Buffer.from(packet.deploymentEvidenceRaw), 'Actual Any Quote deployment evidence');
  const source = exactJson(Buffer.from(packet.sourceVerificationEvidenceRaw), 'Actual Any Quote source evidence');
  need(deployment.schemaVersion === (nativeFees ? ANY_QUOTE_ETH_DEPLOYMENT_SCHEMA : ANY_QUOTE_DEPLOYMENT_SCHEMA) && deployment.status === 'included-code-verified'
    && source.schemaVersion === (nativeFees ? ANY_QUOTE_ETH_SOURCE_SCHEMA : ANY_QUOTE_SOURCE_SCHEMA) && source.status === 'exact-source-and-runtime-verified', 'Completed deployment and exact source evidence required');
  for (const evidence of [deployment, source]) need(evidence.chainId === 4663 && evidence.releaseDigest === identity.releaseDigest
    && evidence.sourceCommit === identity.sourceCommit && evidence.buildDigest === packet.build.buildDigest
    && evidence.sourceVersion === identity.sourceVersion && evidence.economicsPolicyId === identity.economicsPolicyId, 'Pre-activation evidence identity differs');
  need(deployment.planDigest === packet.deploymentPlan.planDigest && deployment.records?.length === 2 && packet.deploymentEntries?.length === 2, 'Both actual deployment entries required');
  const api = await publicationValidators(), candidate = { ...packet.deploymentPlan.identityCandidate, startBlock: BigInt(deployment.records[1].receipt.blockNumber).toString() };
  equal({ ...candidate, releaseDigest: api.computeModuleEngineReleaseDigest(candidate) }, identity, 'Actual deployed Any Quote release');
  exactKeys(packet.admission, ['plan', 'entry', 'evidence'], 'Observed Any Quote admission');
  const admission = packet.admission;
  need(admission.plan?.schemaVersion === ENGINE_PUBLICATION_OPERATOR_SCHEMA, 'Actual owner admission plan required');
  await assertEnginePublicationOperatorPlan(admission.plan); equal(admission.plan.identity, identity, 'Admission release'); equal(admission.plan.bundle, bundle, 'Admission accepted review');
  assertPublicationRequest(admission.plan, admission.entry);
  need(admission.plan.steps[admission.entry.stepIndex]?.kind === 'engine-revision'
    && admission.evidence?.status === 'included-code-verified-unfinalized' && admission.evidence.planDigest === admission.plan.planDigest
    && admission.evidence.transaction?.hash === admission.entry.transactionHash, 'Actual observed revision admission required');
  return { packetDigest: digest(packetSchema, packet), deploymentEvidenceDigest: evidenceDigest(Buffer.from(packet.deploymentEvidenceRaw)),
    sourceVerificationDigest: evidenceDigest(Buffer.from(packet.sourceVerificationEvidenceRaw)), admissionRequestDigest: hash(admission.entry.requestDigest) };
}
function anyQuoteSteps(action, identity, owner, api, checked) {
  const nativeFees = api.isModuleEngineAnyQuoteEthRelease(identity);
  const infrastructure = api.ANY_QUOTE_INFRASTRUCTURE, templateId = checked.manifest.manifest.catalogDefinition.id;
  const base = (kind, target, value, intent, label) => ({ kind: `any-quote-${kind}`, label, sender: owner, target,
    to: kind === 'launch' ? identity.contracts.host.address : kind === 'claim' ? identity.contracts.ledger.address : identity.contracts.universalRouter.address,
    value, data: null, functionName: kind, arguments: intent, intent, preReads: [], postReads: [], newCode: [], preparation: 'fresh-canonical-any-quote' });
  if (action.kind === 'launch') {
    exactKeys(action, ['kind', 'input'], 'Any Quote bootstrap launch action');
    const intent = api.anyQuoteLaunchIntent(action.input);
    exactKeys(action.input, [...Object.keys(intent), 'description', 'imageUri', 'socialLinks'], 'Any Quote launch input');
    equal({ ...action.input, ...intent }, action.input, 'Canonical Any Quote launch intent');
    need(intent.releaseDigest === identity.releaseDigest && intent.templateId === templateId && intent.account === owner
      && (nativeFees ? BigInt(intent.initialBuyWei) > 0n : intent.initialBuyWei === '0'),
    nativeFees ? 'Reviewed native-fee launch requires a positive initial ETH buy' : 'Reviewed zero-buy bootstrap launch required; ETH purchase is a separate step');
    need(typeof action.input.description === 'string' && typeof action.input.imageUri === 'string' && action.input.socialLinks && typeof action.input.socialLinks === 'object'
      && !Array.isArray(action.input.socialLinks), 'Complete launch metadata required');
    return [base('launch', api.predictAnyQuoteToken(intent, identity), intent.initialBuyWei, action.input, `Launch ${intent.symbol} with Any Quote`)];
  }
  if (action.kind === 'claim') {
    exactKeys(action, ['kind', 'token', 'recipient'], 'Any Quote beneficiary claim');
    return [base('claim', address(action.token), '0', { token: address(action.token), recipient: address(action.recipient) }, nativeFees ? 'Claim accrued ETH fees' : 'Claim accrued quote fees')];
  }
  need(['buy', 'sell'].includes(action.kind), 'Closed Any Quote launch, ETH buy, ETH sell or beneficiary claim required');
  exactKeys(action, ['kind', 'token', 'recipient', 'inputAmount', 'slippageBps', ...(action.kind === 'sell' ? ['funding'] : [])], 'Any Quote trade intent');
  const intent = { token: address(action.token), recipient: address(action.recipient), inputAmount: uint(action.inputAmount, 'Exact trade input', true), slippageBps: api.anyQuoteSlippageBps(action.slippageBps) };
  need(BigInt(intent.inputAmount) < 1n << 128n, 'Any Quote input exceeds the canonical amount bound');
  const steps = [];
  if (action.kind === 'sell') {
    const funding = action.funding;
    exactKeys(funding, ['erc20Allowance', 'permit2Amount', 'permit2Expiration', 'permit2Nonce', 'permit2Mode'], 'Exact sell funding snapshot');
    for (const [key, value] of Object.entries(funding).filter(([key]) => key !== 'permit2Mode')) uint(value, key);
    need(BigInt(funding.erc20Allowance) < 1n << 256n && BigInt(funding.permit2Amount) < 1n << 160n
      && ['permit2Expiration', 'permit2Nonce'].every(k => BigInt(funding[k]) < 1n << 48n), 'Allowance snapshot exceeds canonical bounds');
    need(['existing', 'approve'].includes(funding.permit2Mode) && (funding.permit2Mode === 'approve' || BigInt(funding.permit2Amount) >= BigInt(intent.inputAmount)), 'Explicit sufficient existing Permit2 allowance or exact approval required');
    const approval = (allowanceKind, spender) => {
      const step = base('approve', intent.token, '0', { ...intent, allowanceKind, spender, amount: intent.inputAmount,
        maximumApprovalLifetimeSeconds: 300, funding }, `Approve the exact ${intent.inputAmount} token sell input`);
      step.to = allowanceKind === 'erc20' ? intent.token : address(infrastructure.permit2); return step;
    };
    if (BigInt(funding.erc20Allowance) < BigInt(intent.inputAmount)) steps.push(approval('erc20', address(infrastructure.permit2)));
    // The stable snapshot makes every predecessor explicit. No approval or expiration is invented during preparation.
    if (funding.permit2Mode === 'approve')
      steps.push(approval('permit2', identity.contracts.universalRouter.address));
  }
  steps.push(base(action.kind, intent.token, action.kind === 'buy' ? intent.inputAmount : '0', intent, action.kind === 'buy' ? 'Buy with ETH' : 'Sell the exact token input for ETH'));
  return steps;
}
export async function createEngineLifecycleOperatorPlan({ identity, owner, bundle, action, sourceState, preactivation }) {
  owner = address(owner); const checked = await bindEngineReview(bundle, identity), api = await publicationValidators(), m = checked.manifest.manifest, host = identity.contracts.host.address;
  if (api.isModuleEngineSharedQuoteRelease(identity)) {
    const proofBindings = await bindAnyQuotePreactivationPacket(preactivation, identity, bundle), steps = anyQuoteSteps(action, identity, owner, api, checked);
    return enginePlanBody(ENGINE_LIFECYCLE_OPERATOR_SCHEMA, identity, owner, checked, bundle, sourceState, { action, preactivation, proofBindings, steps });
  }
  need(preactivation === undefined, 'Pre-activation packet applies only to Any Quote');
  need(action && ['launch', 'execute'].includes(action.kind), 'Closed Engine launch/execute profile required');
  let compiled, operation, expected, quote, reference = null;
  if (action.kind === 'launch') {
    exactKeys(action, ['kind', 'name', 'symbol', 'description', 'imageUri', 'socialLinks', 'quote', 'configuration', 'creatorSalt', 'engineSalt', 'launchData', 'creatorWallets', 'creatorSharesBps', 'buyCreatorFeeBps', 'sellCreatorFeeBps', 'initialOperation', 'deadline', 'funding'], 'Engine launch action');
    quote = quotePin(action.quote); uint(action.deadline, 'deadline', true);
    const input = { ...action, account: owner, quoteAsset: quote.address, creatorSalt: optionalHash(action.creatorSalt), engineSalt: optionalHash(action.engineSalt),
      initialOperation: action.initialOperation === null ? undefined : ({ token, quoteAsset }) => bindEngineIntent(action.initialOperation, token, quoteAsset, owner, action.deadline, '0', api) };
    compiled = await api.compileModuleEngineLaunch(input, identity, checked.manifest, quote.decimals, BigInt(action.deadline));
    operation = compiled.initialOperation;
    expected = { launchId: compiled.launchId, revisionId: m.revision.packageId, creator: owner, token: compiled.predictedToken, quoteAsset: quote.address, engine: compiled.engine,
      engineCodeHash: compiled.engineCodeHash, constructorHash: compiled.constructorHash, initCodeHash: compiled.initCodeHash, configurationHash: compiled.configurationHash,
      planHash: compiled.planHash, buyCreatorFeeBps: compiled.buyCreatorFeeBps, sellCreatorFeeBps: compiled.sellCreatorFeeBps };
    need(operation.inputAsset !== expected.token || operation.inputAmount === 0n, 'The uncreated primary token cannot pre-fund its own launch');

  } else {
    exactKeys(action, ['kind', 'launch', 'intent', 'nonce', 'deadline', 'funding'], 'Engine execute action');
    reference = action.launch; exactKeys(reference, ['plan', 'entry', 'evidence'], 'Original Engine launch reference');
    need(reference.plan?.schemaVersion === ENGINE_LIFECYCLE_OPERATOR_SCHEMA && reference.plan.action?.kind === 'launch', 'Reference must be an original Engine launch plan');
    await assertEngineLifecycleOperatorPlan(reference.plan); equal(reference.plan.identity, identity, 'Referenced release');
    equal(reference.plan.bundle.manifest, bundle.manifest, 'Referenced reviewed engine manifest');
    assertPublicationRequest(reference.plan, reference.entry); const launchStep = reference.plan.steps[reference.entry.stepIndex];
    need(launchStep?.kind === 'engine-launch' && reference.entry.transactionHash === reference.evidence?.transaction?.hash && reference.evidence.status === 'included-code-verified-unfinalized'
      && reference.evidence.sourceKind === 'module-engine-v1' && reference.evidence.planDigest === reference.plan.planDigest, 'Original bound engine launch receipt required');
    expected = launchStep.expectation; quote = reference.plan.action.quote;
    equalEngineLaunchPlan(reference.evidence.canary, reference.entry.observation.simulatedResult, 'Referenced simulated/actual Engine launch');
    for (const [key, value] of Object.entries(expected)) equal(reference.evidence.canary[key], value, `Referenced launch ${key}`);
    operation = bindEngineIntent(action.intent, expected.token, expected.quoteAsset, owner, action.deadline, action.nonce, api);
  }
  if (operation.operationId !== ZERO_HASH) assertEnginePermission(m.revision, expected, operation, owner);
  const steps = fundingSteps(action, owner, host, operation), params = compiled?.parameters;
  steps.push({ kind: action.kind === 'launch' ? 'engine-launch' : 'engine-execute', label: action.kind === 'launch' ? `Launch ${params.symbol} with ${m.catalogDefinition.title}` : `Execute ${operation.operationId}`,
    sender: owner, to: host, target: expected.token, value: operation.inputAsset === ZERO_ADDRESS ? operation.inputAmount.toString() : '0',
    functionName: action.kind, arguments: jsonSafe(action.kind === 'launch' ? [params] : [expected.launchId, operation]),
    data: encodeFunctionData({ abi: api.moduleEngineHostAbi, functionName: action.kind, args: action.kind === 'launch' ? [params] : [expected.launchId, operation] }),
    deadline: action.deadline, expectation: expected, operation: jsonSafe(operation), preReads: [], postReads: [],
    newCode: action.kind === 'launch' ? [{ address: expected.engine, runtimeCodeHash: expected.engineCodeHash }] : [] });
  // Approval UI displays the same already-derived operation, recipient, bound token and exact maximum allowance.
  for (const step of steps) if (step.kind === 'engine-approve') { step.expectation = expected; step.operation = jsonSafe(operation); step.deadline = action.deadline; }
  return enginePlanBody(ENGINE_LIFECYCLE_OPERATOR_SCHEMA, identity, owner, checked, bundle, sourceState, { action, steps });
}
export async function assertEngineLifecycleOperatorPlan(plan) {
  const rebuilt = await createEngineLifecycleOperatorPlan({ ...plan, sourceState: plan }); equal(plan, rebuilt, 'Engine lifecycle owner plan'); return plan;
}
async function main(argv) {
  const options = {}; let candidate = false;
  for (let i = 0; i < argv.length; i++) { const key = argv[i]; if (key === '--candidate') { need(!candidate, 'Duplicate candidate'); candidate = true; continue; }
    need(['--identity', '--bundle', '--owner', '--action', '--preactivation', '--output'].includes(key) && !options[key] && argv[i + 1] && !argv[i + 1].startsWith('--'), 'Expected --identity FILE --bundle FILE --owner ADDRESS --action FILE --output FILE [--preactivation FILE] [--candidate]'); options[key] = argv[++i]; }
  need(['--identity', '--bundle', '--owner', '--action', '--output'].every(key => options[key]), 'All Engine lifecycle inputs are required'); const state = await repositoryState(); need(candidate || state.sourceClean, 'Clean operator source required');
  const plan = await createEngineLifecycleOperatorPlan({ identity: await readOperatorJson(options['--identity']), bundle: await readOperatorJson(options['--bundle']), owner: options['--owner'], action: await readOperatorJson(options['--action']),
    ...(options['--preactivation'] ? { preactivation: await readOperatorJson(options['--preactivation']) } : {}), sourceState: { ...state, sourceClean: !candidate && state.sourceClean } });
  await writeFile(options['--output'], `${canonicalJson(plan)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ authority: 'preparation-only', planDigest: plan.planDigest, steps: plan.steps.length, sourceClean: plan.sourceClean }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
