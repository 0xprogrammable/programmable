#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { encodeFunctionData, erc20Abi } from 'viem';
import { address, bytes, canonicalJson, exactKeys, hash, jsonSafe, need, uint } from '../module-mode/core.mjs';
import { repositoryState } from '../module-mode/build.mjs';
import { readCondition, readOperatorJson, ZERO_ADDRESS } from '../module-mode/publication-plan.mjs';
import { publicationValidators } from '../module-mode/publication-shared.mjs';
import { assertPublicationRequest } from '../module-mode/publication-rpc.mjs';
import { bindEngineReview, enginePlanBody, equal, equalEngineLaunchPlan, ENGINE_LIFECYCLE_OPERATOR_SCHEMA } from './publication-plan.mjs';
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
export async function createEngineLifecycleOperatorPlan({ identity, owner, bundle, action, sourceState }) {
  owner = address(owner); const checked = await bindEngineReview(bundle, identity), api = await publicationValidators(), m = checked.manifest.manifest, host = identity.contracts.host.address;
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
    need(['--identity', '--bundle', '--owner', '--action', '--output'].includes(key) && !options[key] && argv[i + 1] && !argv[i + 1].startsWith('--'), 'Expected --identity FILE --bundle FILE --owner ADDRESS --action FILE --output FILE [--candidate]'); options[key] = argv[++i]; }
  need(Object.keys(options).length === 5, 'All Engine lifecycle inputs are required'); const state = await repositoryState(); need(candidate || state.sourceClean, 'Clean operator source required');
  const plan = await createEngineLifecycleOperatorPlan({ identity: await readOperatorJson(options['--identity']), bundle: await readOperatorJson(options['--bundle']), owner: options['--owner'], action: await readOperatorJson(options['--action']), sourceState: { ...state, sourceClean: !candidate && state.sourceClean } });
  await writeFile(options['--output'], `${canonicalJson(plan)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ authority: 'preparation-only', planDigest: plan.planDigest, steps: plan.steps.length, sourceClean: plan.sourceClean }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
