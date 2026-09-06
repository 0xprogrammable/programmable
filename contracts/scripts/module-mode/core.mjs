import { createHash } from 'node:crypto';
import { encodeAbiParameters, encodeDeployData, getCreate2Address, getContractAddress, keccak256, parseAbiParameters, toHex } from 'viem';

export const CHAIN_ID = 4663;
export const PLAN_SCHEMA = 'programmable.module-mode-deployment-plan.v1';
export const TREASURY = '0xd88539d3c4c460136a733a3fd60cf6bf269079da';
export const REWARD_ADMIN = '0x79879fe6f00c0986ca521ea6f5b276b5e28b1b9c';
export const HOOK_MASK = (1n << 14n) - 1n;
export const HOOK_FLAGS = (1n << 13n) | (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
export const OFFICIAL = Object.freeze({
  poolManager: { address: '0x8366a39cc670b4001a1121b8f6a443a643e40951', runtimeCodeHash: '0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626' },
  positionManager: { address: '0x58daec3116aae6d93017baaea7749052e8a04fa7', runtimeCodeHash: '0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2' },
  deterministicDeployer: { address: '0x4e59b44847b379578588920ca78fbf26c0b4956c', runtimeCodeHash: '0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989' },
});
export const OFFICIAL_SOURCE = Object.freeze({
  repository: 'https://github.com/Uniswap/contracts', commit: '4cfc406c8e34da3ce04e60657a7825075b64fd22',
  path: 'deployments/json/4663.json', sha256: '21964cefbfc24b0ee89e7427acf74d223ce5a50aeb4216a9bac361a6148dea15',
});
export const ARTIFACTS = Object.freeze({
  tokenFactory: 'UERC20Factory.sol/UERC20Factory.json', token: 'UERC20.sol/UERC20.json',
  positionPlanner: 'ClassicModulePositionPlannerV1.sol/ClassicModulePositionPlannerV1.json',
  launchPolicy: 'ClassicModuleLaunchPolicyV1.sol/ClassicModuleLaunchPolicyV1.json',
  positionForwarderFactory: 'LockedPositionFeeForwarderFactoryV1.sol/LockedPositionFeeForwarderFactoryV1.json',
  registry: 'ModuleNativeRegistryV1.sol/ModuleNativeRegistryV1.json',
  runtimeFactory: 'ModuleNativeRuntimeFactoryV1.sol/ModuleNativeRuntimeFactoryV1.json',
  swapRouterFactory: 'ModuleNativeSwapRouterFactoryV1.sol/ModuleNativeSwapRouterFactoryV1.json',
  hook: 'ModuleNativeHookV1.sol/ModuleNativeHookV1.json', launcher: 'ModuleNativeLaunchV1.sol/ModuleNativeLaunchV1.json',
  rewardLedger: 'ClassicModuleFeeLedgerV1.sol/ClassicModuleFeeLedgerV1.json',
  runtime: 'ModuleNativeRuntimeV1.sol/ModuleNativeRuntimeV1.json', budgetVault: 'ModuleNativeBudgetVaultV1.sol/ModuleNativeBudgetVaultV1.json',
  swapRouter: 'ModuleNativeSwapRouterV1.sol/ModuleNativeSwapRouterV1.json',
  rewardFactory: 'EveryNthBuyRewardV1.sol/EveryNthBuyRewardFactoryV1.json',
  rewardModule: 'EveryNthBuyRewardV1.sol/EveryNthBuyRewardV1.json',
  capFactory: 'TimedWalletBuyCapV1.sol/TimedWalletBuyCapFactoryV1.json',
  capModule: 'TimedWalletBuyCapV1.sol/TimedWalletBuyCapV1.json',
});
export function need(condition, message) { if (!condition) throw new Error(message); }
export function exactKeys(value, keys, label) {
  need(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|'), `${label}: unexpected keys`);
}
export function address(value, label = 'address') { need(typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) && BigInt(value) !== 0n, `${label}: nonzero EVM address required`); return value.toLowerCase(); }
export function hash(value, label = 'hash') { need(typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value) && BigInt(value) !== 0n, `${label}: nonzero bytes32 required`); return value.toLowerCase(); }
export function uint(value, label = 'uint', positive = false) { need(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && value.length <= 78 && BigInt(value) < (1n << 256n) && (!positive || BigInt(value) > 0n), `${label}: decimal integer required`); return value; }
export function bytes(value, label = 'bytes') { need(typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(value), `${label}: hex bytes required`); return value.toLowerCase(); }
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}
export function digest(domain, value) { return keccak256(toHex(canonicalJson({ domain, value }))); }
export function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
export function hexQuantity(value) { return `0x${BigInt(value).toString(16)}`; }
export function jsonSafe(value) { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item)); }
export function validateParameters(value) {
  exactKeys(value, ['owner', 'reviewAuthority', 'minimumInitialBuyNative', 'releaseLabel'], 'parameters');
  need(typeof value.releaseLabel === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value.releaseLabel), 'releaseLabel: lowercase identifier required');
  return { owner: address(value.owner, 'owner'), reviewAuthority: address(value.reviewAuthority, 'reviewAuthority'),
    minimumInitialBuyNative: uint(value.minimumInitialBuyNative, 'minimumInitialBuyNative', true), releaseLabel: value.releaseLabel };
}
export function materializeRuntime(artifact, immutableValues = {}) {
  let runtime = bytes(artifact.deployedBytecode.object, 'artifact runtime').slice(2);
  const references = artifact.deployedBytecode.immutableReferences ?? {};
  const names = new Set(); const occupied = new Set();
  for (const [id, ranges] of Object.entries(references)) {
    const name = artifact.immutableNames[id];
    need(typeof name === 'string' && Object.hasOwn(immutableValues, name), `Missing immutable value ${name ?? id}`);
    names.add(name);
    const word = BigInt(immutableValues[name]).toString(16).padStart(64, '0');
    need(word.length === 64, `Invalid immutable ${name}`);
    for (const range of ranges) {
      need(Number.isSafeInteger(range.start) && range.start >= 0 && range.length === 32 && (range.start + 32) * 2 <= runtime.length, 'Invalid immutable reference');
      for (let i = range.start; i < range.start + 32; i++) { need(!occupied.has(i), 'Overlapping immutable references'); occupied.add(i); }
      runtime = runtime.slice(0, range.start * 2) + word + runtime.slice((range.start + 32) * 2);
    }
  }
  need(Object.keys(immutableValues).every(name => names.has(name)), 'Unexpected immutable value');
  return `0x${runtime}`;
}
function creation(artifact, args = []) { return encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args }); }
function saltFor(label, role) { return keccak256(encodeAbiParameters(parseAbiParameters('string,uint256,string,string'), ['programmable.module-mode.deployment.v1', 4663n, label, role])); }
function childSalt(domain, types, values) { return keccak256(encodeAbiParameters(parseAbiParameters(`bytes32,${types}`), [keccak256(toHex(domain)), ...values])); }
function pin(artifact, target, immutableValues) {
  const runtime = materializeRuntime(artifact, immutableValues);
  need((runtime.length - 2) / 2 <= 24_576, `EIP-170 size limit: ${target}`);
  return { address: target.toLowerCase(), runtimeCodeHash: keccak256(runtime), runtimeBytes: (runtime.length - 2) / 2, immutableValues, runtime };
}
export function buildPlan(build, input) {
  const parameters = validateParameters(input); const a = build.artifacts; const steps = []; const contracts = {};
  const pm = OFFICIAL.poolManager.address, positions = OFFICIAL.positionManager.address;
  function deploy(role, args = [], immutableValues = {}, hook = false) {
    const initcode = creation(a[role], args); need((initcode.length - 2) / 2 <= 49_152, `${role}: EIP-3860 initcode size limit`);
    const initcodeHash = keccak256(initcode); const baseSalt = saltFor(parameters.releaseLabel, role);
    let salt = baseSalt, target = getCreate2Address({ from: OFFICIAL.deterministicDeployer.address, salt, bytecodeHash: initcodeHash });
    let attempts = 0;
    if (hook) {
      for (; attempts < 1_000_000; attempts++) {
        salt = keccak256(encodeAbiParameters(parseAbiParameters('bytes32,uint256'), [baseSalt, BigInt(attempts)]));
        target = getCreate2Address({ from: OFFICIAL.deterministicDeployer.address, salt, bytecodeHash: initcodeHash });
        if ((BigInt(target) & HOOK_MASK) === HOOK_FLAGS) break;
      }
      need(attempts < 1_000_000, 'Hook salt mining limit reached');
    }
    const values = typeof immutableValues === 'function' ? immutableValues(target.toLowerCase()) : immutableValues;
    contracts[role] = pin(a[role], target, values);
    const constructor = a[role].abi.find(entry => entry.type === 'constructor');
    const constructorArguments = encodeAbiParameters(constructor?.inputs ?? [], args);
    steps.push({ index: steps.length, role, sender: parameters.owner, to: OFFICIAL.deterministicDeployer.address, value: '0',
      data: `${salt}${initcode.slice(2)}`, target: target.toLowerCase(), salt, initcodeHash, initcodeBytes: (initcode.length - 2) / 2,
      constructorArguments, constructorInputs: constructor?.inputs ?? [], constructorValues: jsonSafe(args),
      expectedRoles: [role], ...(hook ? { permissionMask: HOOK_MASK.toString(), permissionFlags: HOOK_FLAGS.toString(), saltSearchIndex: attempts } : {}) });
    return target.toLowerCase();
  }
  const tokenFactory = deploy('tokenFactory');
  const planner = deploy('positionPlanner');
  const policy = deploy('launchPolicy');
  const forwarder = deploy('positionForwarderFactory', [positions], { positionManager: positions });
  const registry = deploy('registry', [parameters.reviewAuthority]);
  const runtimeFactory = deploy('runtimeFactory');
  const swapRouterFactory = deploy('swapRouterFactory');
  const hook = deploy('hook', [pm, registry, runtimeFactory, TREASURY, REWARD_ADMIN, TREASURY], target => ({
    poolManager: pm, registry, runtimeFactory, ledger: getContractAddress({ from: target, nonce: 1n }),
  }), true);
  const ledger = getContractAddress({ from: hook, nonce: 1n }).toLowerCase();
  contracts.rewardLedger = pin(a.rewardLedger, ledger, { poolManager: pm, registry, hook, treasury: TREASURY, rewardAdmin: REWARD_ADMIN, noModuleRecipient: TREASURY });
  steps.at(-1).expectedRoles.push('rewardLedger');
  const runtimeSalt = childSalt('programmable.module-mode.native-runtime.v1', 'address', [hook]);
  const runtime = getCreate2Address({ from: runtimeFactory, salt: runtimeSalt, bytecode: creation(a.runtime, [hook]) }).toLowerCase();
  const vault = getContractAddress({ from: runtime, nonce: 1n }).toLowerCase();
  contracts.runtime = pin(a.runtime, runtime, { engine: hook, engineCodeHash: contracts.hook.runtimeCodeHash, vault });
  contracts.budgetVault = pin(a.budgetVault, vault, { runtime });
  deploy('launcher', [pm, positions, tokenFactory, hook, planner, policy, forwarder, swapRouterFactory,
    contracts.swapRouterFactory.runtimeCodeHash, BigInt(parameters.minimumInitialBuyNative)], target => {
    const routerSalt = childSalt('programmable.module-mode.native-router.v1', 'address,address,address', [target, pm, hook]);
    const router = getCreate2Address({ from: swapRouterFactory, salt: routerSalt, bytecode: creation(a.swapRouter, [pm, hook, target]) }).toLowerCase();
    contracts.swapRouter = pin(a.swapRouter, router, { poolManager: pm, hook, source: target });
    return { poolManager: pm, positionManager: positions, tokenFactory, feeHook: hook, positionPlanner: planner, launchPolicy: policy,
      positionForwarderFactory: forwarder, swapRouterFactory, swapRouter: router, minInitialBuyNative: parameters.minimumInitialBuyNative };
  });
  steps.at(-1).expectedRoles.push('runtime', 'budgetVault', 'swapRouter');
  // Module factories, including the starters, use the same reviewed publication pipeline.
  // They are not part of the base-engine deployment or its immutable release identity.
  const pins = { ...Object.fromEntries(Object.entries(contracts).map(([role, value]) => [role, { address: value.address, runtimeCodeHash: value.runtimeCodeHash }])),
    poolManager: OFFICIAL.poolManager, positionManager: OFFICIAL.positionManager };
  const identityCandidate = { schemaVersion: 'programmable.module-mode-source.v1', sourceVersion: 'module-native-v1', chainId: CHAIN_ID,
    sourceCommit: build.sourceCommit, minimumInitialBuyNative: parameters.minimumInitialBuyNative,
    tokenCreationCodeHash: keccak256(a.token.bytecode.object), finalityPolicy: 'robinhood-ethereum-finalized-v1',
    contracts: pins };
  const plan = { schemaVersion: PLAN_SCHEMA, chainId: CHAIN_ID, sourceCommit: build.sourceCommit, sourceTree: build.sourceTree,
    buildDigest: build.buildDigest, sourceClean: build.sourceClean, parameters,
    economics: { creatorFeeBpsMinimum: 0, creatorFeeBpsMaximum: 1000, creatorFeeStepBps: 100, protocolFeeBps: 20,
      treasuryFeeBps: 10, distinctModuleAuthorsFeeBps: 10, treasury: TREASURY, rewardAdmin: REWARD_ADMIN,
      noModuleRecipient: TREASURY, noModulePolicy: 'both-protocol-halves-to-treasury', minimumInitialBuyUnit: 'native-ETH-wei',
      minimumInitialBuyBasis: 'gross-trade-input-excluding-module-funding-and-network-gas' },
    officialSource: OFFICIAL_SOURCE, official: OFFICIAL, contracts, steps, identityCandidate,
    authority: { status: 'unapproved', liveTransactions: false, sourceVerification: 'not-published', finality: 'unproven' } };
  return { ...plan, planDigest: digest(PLAN_SCHEMA, plan) };
}
export function assertPlan(plan, build) {
  const expected = buildPlan(build, plan.parameters);
  need(canonicalJson(plan) === canonicalJson(expected), 'Plan differs from freshly sealed source, parameters, code or constructors');
  return plan;
}
export function simulationInput(plan) {
  return encodeAbiParameters(parseAbiParameters('uint256,address[],address[],bytes[],address[],bytes32[]'), [
    4663n, plan.steps.map(step => step.sender), plan.steps.map(step => step.to), plan.steps.map(step => step.data),
    [...Object.values(OFFICIAL), ...Object.values(plan.contracts)].map(item => item.address),
    [...Object.values(OFFICIAL), ...Object.values(plan.contracts)].map(item => item.runtimeCodeHash),
  ]);
}
