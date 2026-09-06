#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeAbiParameters, encodeFunctionData, encodeFunctionResult, getCreate2Address, keccak256, parseAbiParameters, toHex } from 'viem';
import { address, bytes, canonicalJson, digest, exactKeys, hash, hexQuantity, jsonSafe, need, uint } from './core.mjs';
import { repositoryState } from './build.mjs';
import { bindIdentity, bindPublicationModule, readCondition, readOperatorJson, registryAbi } from './publication-plan.mjs';
import { publicationValidators } from './publication-shared.mjs';

export const LIFECYCLE_OPERATOR_SCHEMA = 'programmable.module-mode-lifecycle-operator-plan.v1';
const SELECTIONS = '(bytes32 packageId,address factory,bytes32 factoryCodeHash,bytes32 moduleCodeHash,uint32 callbackGas,bytes config)[]';
const same = (a, b, label) => need(canonicalJson(a) === canonicalJson(b), `${label} differs`);
export function predictLifecycleToken(identity, owner, action) {
  const graffiti = keccak256(encodeAbiParameters(parseAbiParameters('string,uint256,address,address,bytes32'),
    ['programmable.module-mode.native-token.v1', 4663n, identity.contracts.launcher.address, owner, hash(action.creatorSalt)]));
  const salt = keccak256(encodeAbiParameters(parseAbiParameters('string,string,uint8,address,bytes32'),
    [action.name, action.symbol, 18, identity.contracts.launcher.address, graffiti]));
  return { token: getCreate2Address({ from: identity.contracts.tokenFactory.address, salt, bytecodeHash: identity.tokenCreationCodeHash }).toLowerCase(), graffiti };
}
/** Exact 9a native-hook/runtime formulas. Configuration bytes and creator fee rates are inside the recipe. */
export function lifecycleLaunchCommitments(identity, owner, action, families, selections, token) {
  const pins = identity.contracts;
  const poolId = keccak256(encodeAbiParameters(parseAbiParameters('address,address,uint24,int24,address'),
    ['0x0000000000000000000000000000000000000000', token, 0, 200, pins.hook.address]));
  const recipeHash = keccak256(encodeAbiParameters(parseAbiParameters(`string,uint256,address,address,uint16,uint16,bytes32[],${SELECTIONS}`),
    ['programmable.module-mode.native-recipe.v1', 4663n, pins.hook.address, pins.registry.address, action.creatorFeeBps, action.creatorFeeBps, families, selections]));
  const programHash = keccak256(encodeAbiParameters(parseAbiParameters(`bytes32,${SELECTIONS}`), [keccak256(toHex('programmable.module-mode.native-program.v1')), selections]));
  const launchKey = keccak256(encodeAbiParameters(parseAbiParameters('bytes32,uint256,address,address,(address source,address launchWallet,address token,address poolManager,bytes32 poolId,bytes32 recipeHash,bytes32 programHash)'),
    [keccak256(toHex('programmable.module-mode.native-binding.v1')), 4663n, pins.runtime.address, pins.hook.address,
      { source: pins.launcher.address, launchWallet: owner, token, poolManager: pins.poolManager.address, poolId, recipeHash, programHash }]));
  const metadataHash = keccak256(encodeAbiParameters(parseAbiParameters('string,string,(string description,string website,string image,bytes extraData)'), [action.name, action.symbol, action.metadata]));
  const creatorConfigurationHash = keccak256(encodeAbiParameters(parseAbiParameters('address[],uint16[]'), [action.creatorWallets, action.creatorSharesBps]));
  return { poolId, recipeHash, programHash, launchKey, metadataHash, creatorConfigurationHash, creatorFeeBps: action.creatorFeeBps,
    creatorWallets: action.creatorWallets.map(value => address(value)), creatorSharesBps: action.creatorSharesBps,
    selections: jsonSafe(selections), families };
}
/** Local consistency checks never turn receipt JSON into chain authority; the live observer re-reads this hash. */
export async function bindLifecycleLaunchReference(reference, identity, owner, modules, canaryKind, token) {
  exactKeys(reference, ['plan', 'evidence'], 'Verified launch reference'); const { plan, evidence } = reference;
  need(plan?.schemaVersion === LIFECYCLE_OPERATOR_SCHEMA && plan.action?.kind === 'launch', 'Reference must be an original native launch operation plan');
  await assertLifecyclePlan(plan);
  need(plan.identity.releaseDigest === identity.releaseDigest && plan.owner === owner && plan.action.canaryKind === canaryKind
    && plan.steps[0].target === token, 'Referenced launch identity or canary kind differs');
  const ordered = entries => [...entries].sort((a, b) => a.artifact.packageId.localeCompare(b.artifact.packageId));
  same(ordered(plan.modules), ordered(modules), 'Referenced launch module bundle');
  const step = plan.steps[0], tx = evidence?.transaction, receipt = evidence?.receipt;
  need(evidence?.status === 'included-code-verified-unfinalized' && evidence.kind === 'launch' && evidence.stepIndex === 0
    && evidence.planDigest === plan.planDigest && evidence.releaseDigest === identity.releaseDigest && evidence.chainId === 4663,
  'Verified launch operation evidence required');
  need(tx && receipt && hash(tx.hash) === receipt.transactionHash && address(tx.from) === owner && address(tx.to) === step.to
    && bytes(tx.input) === step.data && tx.value === hexQuantity(step.value) && tx.chainId === '0x1237' && tx.type === '0x2', 'Referenced launch transaction differs from its exact plan');
  need(typeof tx.blockNumber === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(tx.blockNumber)
    && receipt.blockNumber === tx.blockNumber && receipt.blockHash === hash(tx.blockHash) && receipt.status === '0x1'
    && BigInt(tx.blockNumber) >= BigInt(identity.startBlock), 'Referenced launch receipt is not successful matching inclusion');
  return step.expectation;
}
export async function createLifecyclePlan({ identity, owner, modules = [], action, sourceState }) {
  await bindIdentity(identity); owner = address(owner); need(Array.isArray(modules) && modules.length <= 8, 'At most eight reviewed modules per canary');
  const checked = []; for (const input of modules) checked.push(await bindPublicationModule(input, identity, owner));
  need(new Set(checked.map(m => m.familyId)).size === checked.length, 'Duplicate module family');
  checked.sort((a, b) => a.familyId.localeCompare(b.familyId));
  const api = await publicationValidators(), pins = identity.contracts;
  const preReads = checked.map(module => readCondition(pins.registry.address, registryAbi, 'getRevision', [module.packageId], {
    familyId: module.familyId, factory: module.factory, factoryCodeHash: module.factoryCodeHash, moduleCodeHash: module.moduleCodeHash,
    manifestHash: module.manifestHash, callbackGas: module.callbackGas, enabled: true,
  }));
  const requiredCode = checked.map(module => ({ address: module.factory, runtimeCodeHash: module.factoryCodeHash }));
  let step;
  if (action.kind === 'launch') {
    exactKeys(action, ['kind', 'canaryKind', 'name', 'symbol', 'creatorSalt', 'metadata', 'creatorWallets', 'creatorSharesBps', 'creatorFeeBps', 'moduleConfigurations', 'initialBuyNative', 'minimumTokenOut', 'deadline'], 'Launch action');
    need(['plain', 'modules'].includes(action.canaryKind) && (action.canaryKind === 'plain' ? checked.length === 0 : checked.length > 0), 'Canary kind differs from selected modules');
    need(typeof action.name === 'string' && Buffer.byteLength(action.name) > 0 && Buffer.byteLength(action.name) <= 48 && typeof action.symbol === 'string' && /^[A-Za-z0-9]{1,12}$/.test(action.symbol), 'Valid bounded token name and symbol required');
    exactKeys(action.metadata, ['description', 'website', 'image', 'extraData'], 'Launch metadata');
    need(Object.values(action.metadata).every(v => typeof v === 'string'), 'String metadata required');
    need(Buffer.byteLength(action.metadata.description) <= 280 && Buffer.byteLength(action.metadata.website) <= 2048
      && Buffer.byteLength(action.metadata.image) <= 2048 && (bytes(action.metadata.extraData).length - 2) / 2 <= 1200, 'Metadata exceeds the released contract limits');
    need(Number.isSafeInteger(action.creatorFeeBps) && action.creatorFeeBps >= 0 && action.creatorFeeBps <= 1000 && action.creatorFeeBps % 100 === 0
      && (action.canaryKind === 'plain' ? action.creatorFeeBps === 0 : action.creatorFeeBps > 0), 'Plain canary requires 0% and module canary requires a positive whole-percent creator fee');
    need(Array.isArray(action.creatorWallets) && action.creatorWallets.length > 0 && action.creatorWallets.length <= 10
      && Array.isArray(action.creatorSharesBps) && action.creatorSharesBps.length === action.creatorWallets.length, 'Creator recipients required');
    action.creatorWallets.forEach(wallet => address(wallet));
    need(new Set(action.creatorWallets.map(wallet => wallet.toLowerCase())).size === action.creatorWallets.length
      && action.creatorSharesBps.every(share => Number.isSafeInteger(share) && share > 0 && share <= 10000)
      && action.creatorSharesBps.reduce((a, b) => a + b, 0) === 10000, 'Unique creator recipients must total 10000 bps');
    need(Array.isArray(action.moduleConfigurations) && action.moduleConfigurations.length === checked.length, 'One configuration and budget per selected module required');
    const configurations = new Map(action.moduleConfigurations.map(value => {
      exactKeys(value, ['packageId', 'config', 'funding'], 'Module configuration'); return [hash(value.packageId), { config: bytes(value.config), funding: uint(value.funding) }];
    }));
    need(configurations.size === checked.length && checked.every(m => configurations.has(m.packageId)), 'Module configuration identities differ');
    for (const input of modules) if (input.manifest.manifest.catalogDefinition.management?.budget?.fundable === false) need(configurations.get(input.artifact.packageId).funding === '0', 'This reviewed module cannot receive a funding budget');
    const selections = checked.map(module => ({ packageId: module.packageId, factory: module.factory, factoryCodeHash: module.factoryCodeHash,
      moduleCodeHash: module.moduleCodeHash, callbackGas: module.callbackGas, config: configurations.get(module.packageId).config }));
    const funding = checked.map(module => BigInt(configurations.get(module.packageId).funding));
    need(BigInt(uint(action.initialBuyNative, 'initial buy', true)) >= BigInt(identity.minimumInitialBuyNative), 'Initial buy is below the released minimum');
    uint(action.minimumTokenOut, 'minimum token output', true); uint(action.deadline, 'deadline', true);
    const predicted = predictLifecycleToken(identity, owner, action);
    const commitments = lifecycleLaunchCommitments(identity, owner, action, checked.map(item => item.familyId), selections, predicted.token);
    const parameters = { name: action.name, symbol: action.symbol, buyCreatorFeeBps: action.creatorFeeBps, sellCreatorFeeBps: action.creatorFeeBps,
      creatorSalt: action.creatorSalt, metadata: action.metadata, creatorWallets: action.creatorWallets, creatorSharesBps: action.creatorSharesBps,
      modules: selections, moduleFunding: funding, initialBuyNative: BigInt(action.initialBuyNative), minimumInitialTokenOut: BigInt(action.minimumTokenOut), deadline: BigInt(action.deadline) };
    step = { kind: 'launch', label: `Launch ${action.canaryKind} canary ${action.name}`, sender: owner, to: pins.launcher.address,
      value: (BigInt(action.initialBuyNative) + funding.reduce((a, b) => a + b, 0n)).toString(), target: predicted.token, functionName: 'launch', arguments: jsonSafe(parameters),
      data: encodeFunctionData({ abi: api.moduleNativeLaunchAbi, functionName: 'launch', args: [parameters] }),
      result: null, preReads: [...preReads, readCondition(pins.launcher.address, api.moduleNativeLaunchAbi, 'predictTokenAddress', [action.name, action.symbol, owner, action.creatorSalt], [predicted.token, predicted.graffiti])],
      postReads: [], newCode: [], requiredCode, deadline: action.deadline,
      expectation: { ...commitments, fundingHash: keccak256(encodeAbiParameters(parseAbiParameters('uint256[]'), [funding])), totalFunding: funding.reduce((a, b) => a + b, 0n).toString(), canaryKind: action.canaryKind, token: predicted.token, initialBuyNative: action.initialBuyNative, minimumTokenOut: action.minimumTokenOut } };
  } else if (['buy', 'approve', 'sell'].includes(action.kind)) {
    exactKeys(action, action.kind === 'approve' ? ['kind', 'canaryKind', 'token', 'amount', 'tokenCodeHash', 'launch'] : ['kind', 'canaryKind', 'token', 'amount', 'minimumOut', 'deadline', 'tokenCodeHash', 'launch'], 'Trade action');
    need(['plain', 'modules'].includes(action.canaryKind) && (action.canaryKind === 'plain' ? checked.length === 0 : checked.length > 0), 'Trade canary kind differs from modules');
    const token = address(action.token), amount = BigInt(uint(action.amount, 'exact input amount', true));
    const launchExpectation = await bindLifecycleLaunchReference(action.launch, identity, owner, modules, action.canaryKind, token);
    need(amount < 1n << 127n, 'Amount exceeds native engine amount bound'); requiredCode.push({ address: token, runtimeCodeHash: hash(action.tokenCodeHash) });
    if (action.kind === 'approve') {
      const args = [pins.swapRouter.address, amount];
      step = { kind: 'approve', label: `Approve exactly ${amount} token units for the native router`, sender: owner, to: token, value: '0', target: token,
        functionName: 'approve', arguments: jsonSafe(args), data: encodeFunctionData({ abi: api.moduleNativeApprovalAbi, functionName: 'approve', args }),
        result: encodeFunctionResult({ abi: api.moduleNativeApprovalAbi, functionName: 'approve', result: true }), preReads, requiredCode, newCode: [],
        postReads: [readCondition(token, api.moduleNativeReadAbi, 'allowance', [owner, pins.swapRouter.address], amount)], expectation: { ...launchExpectation, token, canaryKind: action.canaryKind } };
    } else {
      uint(action.minimumOut, 'minimum output', true); uint(action.deadline, 'deadline', true);
      const args = [token, action.kind === 'buy', -amount, BigInt(action.minimumOut), owner, BigInt(action.deadline)];
      step = { kind: action.kind, label: `${action.kind === 'buy' ? 'Buy' : 'Sell'} ${action.canaryKind} canary`, sender: owner, to: pins.swapRouter.address,
        value: action.kind === 'buy' ? amount.toString() : '0', target: token, functionName: 'swap', arguments: jsonSafe(args),
        data: encodeFunctionData({ abi: api.moduleNativeRouterAbi, functionName: 'swap', args }), result: null, preReads, postReads: [], newCode: [], requiredCode,
        deadline: action.deadline, expectation: { ...launchExpectation, token, canaryKind: action.canaryKind, amount: amount.toString(), minimumOut: action.minimumOut } };
    }
  } else throw new Error('Only native launch, buy, exact approval and sell operations are supported');
  const body = { schemaVersion: LIFECYCLE_OPERATOR_SCHEMA, chainId: 4663, sourceCommit: sourceState.sourceCommit, sourceTree: sourceState.sourceTree,
    sourceClean: sourceState.sourceClean, identity, owner, modules, action, steps: [step] };
  return { ...body, planDigest: digest(LIFECYCLE_OPERATOR_SCHEMA, body) };
}
export async function assertLifecyclePlan(plan) {
  const expected = await createLifecyclePlan({ identity: plan.identity, owner: plan.owner, modules: plan.modules, action: plan.action, sourceState: plan });
  need(canonicalJson(plan) === canonicalJson(expected), 'Lifecycle operation plan differs'); return plan;
}
/** Collector input is emitted only from actual verified launch/buy/sell operator records. Finality remains the backend collector's job. */
export function createLifecycleCollectorPlan(identity, canaries) {
  need(Array.isArray(canaries) && canaries.length === 2, 'Plain and module canaries required');
  const allHashes = new Set();
  const result = canaries.map((canary, i) => {
    const kind = i === 0 ? 'plain' : 'modules'; need(canary.kind === kind, 'Canary order differs'); const token = address(canary.token);
    const records = {};
    for (const action of ['launch', 'buy', 'sell']) {
      const { plan, evidence } = canary[action]; need(plan.identity?.releaseDigest === identity.releaseDigest && plan.action?.kind === action && plan.action?.canaryKind === kind
        && plan.steps[0]?.expectation?.token === token && evidence?.planDigest === plan.planDigest && evidence?.status === 'included-code-verified-unfinalized', 'Actual bound canary operation evidence required');
      const tx = hash(evidence.transaction.hash); need(!allHashes.has(tx), 'Duplicate canary transaction'); allHashes.add(tx); records[`${action}TransactionHash`] = tx;
    }
    return { kind, token, ...records };
  });
  need(result[0].token !== result[1].token, 'Canaries must use distinct tokens');
  return { schemaVersion: 'programmable.module-mode-lifecycle-plan.v1', chainId: 4663, releaseDigest: identity.releaseDigest, sourceCommit: identity.sourceCommit, canaries: result };
}
async function main(argv) {
  const options = {}; let candidate = false;
  for (let i = 0; i < argv.length; i++) { const key = argv[i]; if (key === '--candidate') { need(!candidate, 'Duplicate candidate option'); candidate = true; continue; }
    need(['--identity', '--modules', '--action', '--owner', '--output'].includes(key) && !options[key] && argv[i + 1] && !argv[i + 1].startsWith('--'), 'Expected --identity FILE --modules FILE --action FILE --owner ADDRESS --output FILE [--candidate]'); options[key] = argv[++i]; }
  need(Object.keys(options).length === 5, 'All lifecycle inputs are required'); const state = await repositoryState(); need(candidate || state.sourceClean, 'Clean source required; candidate is preparation only');
  const plan = await createLifecyclePlan({ identity: await readOperatorJson(options['--identity']), modules: await readOperatorJson(options['--modules']), action: await readOperatorJson(options['--action']),
    owner: options['--owner'], sourceState: { ...state, sourceClean: !candidate && state.sourceClean } });
  await writeFile(options['--output'], `${canonicalJson(plan)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ planDigest: plan.planDigest, kind: plan.action.kind, token: plan.steps[0].target, value: plan.steps[0].value, sourceClean: plan.sourceClean, authority: 'preparation-only' }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
