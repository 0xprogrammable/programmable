import { encodeAbiParameters, encodeDeployData, getCreate2Address, getContractAddress, keccak256, parseAbiParameters, toHex, zeroAddress } from 'viem';
import { OFFICIAL, OFFICIAL_SOURCE, HOOK_MASK, HOOK_FLAGS, REWARD_ADMIN, address, canonicalJson, digest, exactKeys,
  hash, jsonSafe, materializeRuntime, need, uint } from '../module-mode/core.mjs';
import { engineWire } from './shared.mjs';
import { ANY_QUOTE_ROUTER } from './any-quote-core.mjs';
export { anyQuoteEthBasis, assertAnyQuoteEthBasis } from './any-quote-eth-basis.mjs';

export const ANY_QUOTE_ETH_PLAN_SCHEMA = 'programmable.module-engine-any-quote-eth-deployment-plan.v1';
export const ANY_QUOTE_ETH_DEPLOYMENT_SCHEMA = 'programmable.module-engine-any-quote-eth-deployment-evidence.v1';
export const ANY_QUOTE_ETH_SOURCE_VERSION = 'module-engine-any-quote-eth-v1';
export const ANY_QUOTE_ETH_SOURCE_ID = keccak256(toHex('programmable.module-engine.any-quote.native-eth.v1'));
export const ANY_QUOTE_ETH_PROFILE = 'robinhood-any-quote.shared-hook.native-eth.v1';
export const ANY_QUOTE_ETH_ECONOMICS_POLICY_ID = keccak256(toHex('programmable.any-quote.base-30.creator-0-1000.native-eth.v1'));
export const ANY_QUOTE_ETH_NEW_ROLES = Object.freeze(['sharedHook', 'ledger', 'host']);
export const ANY_QUOTE_ETH_REUSED_ROLES = Object.freeze(['registry', 'tokenFactory', 'launchPolicy', 'nativeRouteGuard']);
export const ANY_QUOTE_ETH_REUSE_DOMAIN = 'programmable.module-engine-any-quote-eth.reused-source.v1';
export const ANY_QUOTE_ETH_GUARD_REUSE_DOMAIN = 'programmable.module-engine-any-quote-eth.reused-guard-source.v1';
const HOST_PATH = 'src/module-engine/any-quote/ModuleEngineAnyQuoteEthHostV1.sol';
function pin(artifact, target, immutableValues = {}) {
  const runtime = materializeRuntime(artifact, immutableValues), runtimeBytes = (runtime.length - 2) / 2;
  need(runtimeBytes > 0 && runtimeBytes <= 24576, 'Any Quote ETH runtime violates EIP-170');
  return { address: address(target), runtimeCodeHash: keccak256(runtime), runtimeBytes, immutableValues, runtime };
}
function creation(artifact, values) {
  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: values });
  const initcodeBytes = (data.length - 2) / 2;
  need(initcodeBytes > 0 && initcodeBytes <= 49152, 'Any Quote ETH complete initcode violates EIP-3860');
  const inputs = artifact.abi.find(item => item.type === 'constructor')?.inputs ?? [];
  return { data, initcodeBytes, initcodeHash: keccak256(data), constructorInputs: inputs,
    constructorArguments: encodeAbiParameters(inputs, values), constructorValues: jsonSafe(values) };
}
function literalPin(build, constant, expected) {
  const source = build.standardInputs.host.sources[HOST_PATH]?.content;
  const literal = source?.match(new RegExp(`\\b${constant}\\s*=\\s*(0x[0-9a-fA-F]+)\\s*;`))?.[1];
  need(literal?.toLowerCase() === expected, `Any Quote ETH compiled Host ${constant} differs`);
}

/** Predeploy the hook with its future CREATE Host bound; retain the already verified route guard. */
export async function buildAnyQuoteEthPlan(build, input, basis) {
  exactKeys(input, ['owner', 'ownerNonce', 'reviewAuthority', 'releaseLabel'], 'Any Quote ETH deployment parameters');
  const parameters = { owner: address(input.owner), ownerNonce: uint(input.ownerNonce, 'ownerNonce'),
    reviewAuthority: address(input.reviewAuthority), releaseLabel: input.releaseLabel };
  need(BigInt(parameters.ownerNonce) < (1n << 64n) - 2n, 'Bounded owner nonce required');
  need(typeof parameters.releaseLabel === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(parameters.releaseLabel)
    && parameters.releaseLabel.includes('any-quote'), 'Explicit bounded Any Quote release label required');
  const { basisDigest, ...body } = basis, previous = basis.previousRelease, guardRelease = basis.guardRelease;
  need(basis.schemaVersion === 'programmable.module-mode-native-v2-basis.v1' && basis.chainId === 4663
    && hash(basisDigest) === digest(basis.schemaVersion, body) && basis.provenance.sourceCommit === build.sourceCommit,
  'Sealed historical authority basis required');
  need(previous.sourceVersion === 'module-native-v1' && previous.enabled === true && previous.status === 'active'
    && parameters.owner === basis.deploymentOwner && parameters.reviewAuthority === basis.registryOwner
    && basis.rewardAdmin === REWARD_ADMIN, 'Existing deployment, Registry or reward rights differ');
  need(build.reuseSourceProvenance?.previousReleaseDigest === previous.releaseDigest
    && build.reuseSourceProvenance.previousSourceCommit === previous.sourceCommit
    && build.reuseSourceDigest === digest(ANY_QUOTE_ETH_REUSE_DOMAIN, build.reuseSourceProvenance), 'Exact retained source closure required');
  need(guardRelease?.sourceVersion === 'module-engine-any-quote-v1'
    && build.guardSourceProvenance?.previousReleaseDigest === guardRelease.releaseDigest
    && build.guardSourceProvenance.previousSourceCommit === guardRelease.sourceCommit
    && build.guardSourceDigest === digest(ANY_QUOTE_ETH_GUARD_REUSE_DOMAIN, build.guardSourceProvenance), 'Exact retained guard source closure required');
  need(canonicalJson(previous.contracts.poolManager) === canonicalJson(OFFICIAL.poolManager), 'Official PoolManager differs');
  const wire = await engineWire(), a = build.artifacts, contracts = {};
  for (const role of ANY_QUOTE_ETH_REUSED_ROLES) {
    const retained = (role === 'nativeRouteGuard' ? guardRelease : previous).contracts[role];
    contracts[role] = pin(a[role], retained.address);
    need(contracts[role].runtimeCodeHash === retained.runtimeCodeHash, `${role}: retained runtime differs`);
  }
  const hostNonce = BigInt(parameters.ownerNonce) + 1n, hostAddress = address(getContractAddress({ from: parameters.owner, nonce: hostNonce }));
  const hook = creation(a.sharedHook, [OFFICIAL.poolManager.address, hostAddress, basis.rewardAdmin]);
  const seed = keccak256(encodeAbiParameters(parseAbiParameters('string,uint256,string,address'),
    ['programmable.module-engine-any-quote.native-eth.shared-hook.v1', 4663n, parameters.releaseLabel, hostAddress]));
  let hookSalt, hookAddress, attempts;
  for (attempts = 0; attempts < 1_000_000; attempts++) {
    hookSalt = keccak256(encodeAbiParameters(parseAbiParameters('bytes32,uint256'), [seed, BigInt(attempts)]));
    hookAddress = address(getCreate2Address({ from: OFFICIAL.deterministicDeployer.address, salt: hookSalt, bytecodeHash: hook.initcodeHash }));
    if ((BigInt(hookAddress) & HOOK_MASK) === HOOK_FLAGS) break;
  }
  need(attempts < 1_000_000, 'Bounded shared hook mining exhausted');
  const ledgerAddress = address(getContractAddress({ from: hookAddress, nonce: 1n }));
  contracts.sharedHook = pin(a.sharedHook, hookAddress, { poolManager: OFFICIAL.poolManager.address, host: hostAddress, ledger: ledgerAddress });
  contracts.ledger = pin(a.ledger, ledgerAddress, { poolManager: OFFICIAL.poolManager.address, host: hostAddress, hook: hookAddress, rewardAdmin: basis.rewardAdmin });
  const host = creation(a.host, [contracts.tokenFactory.address, contracts.launchPolicy.address, contracts.registry.address,
    OFFICIAL.poolManager.address, basis.rewardAdmin, hookAddress, contracts.sharedHook.runtimeCodeHash, contracts.nativeRouteGuard.address]);
  contracts.host = pin(a.host, hostAddress, { tokenFactory: contracts.tokenFactory.address, launchPolicy: contracts.launchPolicy.address,
    registry: contracts.registry.address, sharedHook: hookAddress, sharedHookCodeHash: contracts.sharedHook.runtimeCodeHash,
    nativeRouteGuard: contracts.nativeRouteGuard.address, ledger: ledgerAddress,
    quotePoolManager: OFFICIAL.poolManager.address, quotePoolManagerCodeHash: OFFICIAL.poolManager.runtimeCodeHash });
  for (const [constant, expected] of [['TOKEN_FACTORY_CODE_HASH', contracts.tokenFactory.runtimeCodeHash],
    ['LAUNCH_POLICY_CODE_HASH', contracts.launchPolicy.runtimeCodeHash], ['NATIVE_ROUTE_GUARD_CODE_HASH', contracts.nativeRouteGuard.runtimeCodeHash],
    ['UNIVERSAL_ROUTER', ANY_QUOTE_ROUTER.address], ['UNIVERSAL_ROUTER_CODE_HASH', ANY_QUOTE_ROUTER.runtimeCodeHash]]) literalPin(build, constant, expected);
  need(build.standardInputs.host.sources[HOST_PATH].content.includes('SOURCE_VERSION = keccak256("programmable.module-engine.any-quote.native-eth.v1")'), 'Compiled native-fee Host source identity differs');
  const steps = [
    { index: 0, role: 'sharedHook', deploymentKind: 'create2', sender: parameters.owner, nonce: parameters.ownerNonce,
      to: OFFICIAL.deterministicDeployer.address, value: '0', ...hook, data: `${hookSalt}${hook.data.slice(2)}`,
      target: hookAddress, salt: hookSalt, expectedRoles: ['sharedHook', 'ledger'] },
    { index: 1, role: 'host', deploymentKind: 'create', sender: parameters.owner, nonce: String(hostNonce), to: null,
      value: '0', ...host, target: hostAddress, expectedRoles: ['host'] },
  ];
  const pins = { ...Object.fromEntries(Object.entries(contracts).map(([role, value]) => [role, { address: value.address, runtimeCodeHash: value.runtimeCodeHash }])),
    poolManager: OFFICIAL.poolManager, universalRouter: ANY_QUOTE_ROUTER };
  exactKeys(pins, wire.MODULE_ENGINE_ANY_QUOTE_CONTRACTS, 'Any Quote ETH nine-role source identity');
  const tokenCreationCodeHash = keccak256(a.token.bytecode.object);
  need(tokenCreationCodeHash === previous.tokenCreationCodeHash, 'Existing token generation differs');
  const identityCandidate = { schemaVersion: wire.MODULE_ENGINE_RELEASE_SCHEMA, sourceVersion: ANY_QUOTE_ETH_SOURCE_VERSION,
    engineProfile: ANY_QUOTE_ETH_PROFILE, chainId: 4663, sourceCommit: build.sourceCommit, tokenCreationCodeHash,
    economicsPolicyId: ANY_QUOTE_ETH_ECONOMICS_POLICY_ID, finalityPolicy: previous.finalityPolicy, contracts: pins };
  const plan = { schemaVersion: ANY_QUOTE_ETH_PLAN_SCHEMA, chainId: 4663, sourceCommit: build.sourceCommit, sourceTree: build.sourceTree,
    sourceClean: build.sourceClean, buildDigest: build.buildDigest, reuseSourceDigest: build.reuseSourceDigest, guardSourceDigest: build.guardSourceDigest,
    sourceId: ANY_QUOTE_ETH_SOURCE_ID, parameters, basis, official: OFFICIAL, officialSource: OFFICIAL_SOURCE,
    contracts, steps, reusedRoles: ANY_QUOTE_ETH_REUSED_ROLES, identityCandidate,
    sharedHookCreation: { ...hook, salt: hookSalt, target: hookAddress, deployer: OFFICIAL.deterministicDeployer.address, attempts: attempts + 1,
      hookFlags: toHex(HOOK_FLAGS), ledger: ledgerAddress },
    economics: { economicsPolicyId: ANY_QUOTE_ETH_ECONOMICS_POLICY_ID, platformFeeBps: 30,
      platformRecipient: wire.MODULE_ENGINE_ANY_QUOTE_PLATFORM_RECIPIENT, rewardAdmin: basis.rewardAdmin,
      creatorFeeBps: { minimum: 0, maximum: 1000, step: 100 }, feeAsset: zeroAddress, nativeFeeMaxLossBps: 500, lpFee: 0 },
    configurationSchemaId: wire.MODULE_ENGINE_ANY_QUOTE_CONFIGURATION_SCHEMA_ID,
    authority: { status: 'unapproved', liveTransactions: false, independentReview: 'required', sourceVerification: 'not-published', finality: 'unproven' } };
  return { ...plan, planDigest: digest(ANY_QUOTE_ETH_PLAN_SCHEMA, plan) };
}
export async function assertAnyQuoteEthPlan(plan, build) {
  need(canonicalJson(plan) === canonicalJson(await buildAnyQuoteEthPlan(build, plan.parameters, plan.basis)), 'Any Quote ETH plan differs from sealed source, nonce, pins or economics');
  return plan;
}
export function assertAnyQuoteEthProfile(plan) {
  need(plan?.schemaVersion === ANY_QUOTE_ETH_PLAN_SCHEMA && plan.chainId === 4663
    && plan.identityCandidate?.schemaVersion === 'programmable.module-engine.release.v1'
    && plan.identityCandidate.sourceVersion === ANY_QUOTE_ETH_SOURCE_VERSION && plan.identityCandidate.engineProfile === ANY_QUOTE_ETH_PROFILE
    && plan.sourceId === ANY_QUOTE_ETH_SOURCE_ID && plan.identityCandidate.economicsPolicyId === ANY_QUOTE_ETH_ECONOMICS_POLICY_ID
    && plan.economics?.economicsPolicyId === ANY_QUOTE_ETH_ECONOMICS_POLICY_ID
    && plan.economics.platformFeeBps === 30 && plan.economics.platformRecipient === '0xd88539d3c4c460136a733a3fd60cf6bf269079da'
    && plan.economics.feeAsset === zeroAddress && plan.economics.nativeFeeMaxLossBps === 500, 'Exact native-fee Any Quote source/economics profile required');
  exactKeys(plan.identityCandidate.contracts, ['host', 'registry', 'tokenFactory', 'launchPolicy', 'ledger', 'poolManager', 'sharedHook', 'universalRouter', 'nativeRouteGuard'], 'Any Quote ETH pins');
  need(plan.steps?.length === 2 && plan.steps[0].role === 'sharedHook' && plan.steps[0].deploymentKind === 'create2'
    && plan.steps[0].to === OFFICIAL.deterministicDeployer.address && canonicalJson(plan.steps[0].expectedRoles) === canonicalJson(['sharedHook', 'ledger'])
    && plan.steps[1].role === 'host' && plan.steps[1].deploymentKind === 'create' && plan.steps[1].to === null
    && canonicalJson(plan.steps[1].expectedRoles) === canonicalJson(['host'])
    && plan.steps.every((step, i) => step.index === i && step.value === '0' && step.sender === plan.parameters.owner
      && BigInt(step.nonce) === BigInt(plan.parameters.ownerNonce) + BigInt(i)), 'Exact hook then nonce-bound Host sequence required');
  return plan;
}
