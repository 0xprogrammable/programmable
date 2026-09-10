import { encodeAbiParameters, encodeDeployData, getCreate2Address, getContractAddress, keccak256, parseAbiParameters, toHex } from 'viem';
import { OFFICIAL, OFFICIAL_SOURCE, HOOK_MASK, HOOK_FLAGS, REWARD_ADMIN, address, canonicalJson, digest, exactKeys,
  hash, jsonSafe, materializeRuntime, need, uint } from '../module-mode/core.mjs';
import { engineWire } from './shared.mjs';
export { anyQuoteBasis, assertAnyQuoteBasis } from './any-quote-basis.mjs';

export const ANY_QUOTE_PLAN_SCHEMA = 'programmable.module-engine-any-quote-deployment-plan.v1';
export const ANY_QUOTE_DEPLOYMENT_SCHEMA = 'programmable.module-engine-any-quote-deployment-evidence.v1';
export const ANY_QUOTE_NEW_ROLES = Object.freeze(['nativeRouteGuard', 'host', 'sharedHook', 'ledger']);
export const ANY_QUOTE_REUSED_ROLES = Object.freeze(['tokenFactory', 'launchPolicy', 'registry']);
export const ANY_QUOTE_REUSE_DOMAIN = 'programmable.module-engine-any-quote.reused-source.v1';
export const ANY_QUOTE_ROUTER = Object.freeze({ address: '0x06afba43fd06227fa663b0daecf536f6eaa6bf99',
  runtimeCodeHash: '0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5' });
function pin(artifact, target, immutableValues = {}) {
  const runtime = materializeRuntime(artifact, immutableValues), runtimeBytes = (runtime.length - 2) / 2;
  need(runtimeBytes > 0 && runtimeBytes <= 24576, 'Any Quote runtime violates EIP-170');
  return { address: address(target), runtimeCodeHash: keccak256(runtime), runtimeBytes, immutableValues, runtime };
}
function creation(artifact, values) {
  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: values });
  const initcodeBytes = (data.length - 2) / 2;
  need(initcodeBytes > 0 && initcodeBytes <= 49152, 'Any Quote complete initcode violates EIP-3860');
  const inputs = artifact.abi.find(item => item.type === 'constructor')?.inputs ?? [];
  return { data, initcodeBytes, initcodeHash: keccak256(data), constructorInputs: inputs,
    constructorArguments: encodeAbiParameters(inputs, values), constructorValues: jsonSafe(values) };
}
function literalPin(build, constant, expected) {
  const source = build.standardInputs.host.sources['src/module-engine/any-quote/ModuleEngineAnyQuoteHostV1.sol']?.content;
  const literal = source?.match(new RegExp(`\\b${constant}\\s*=\\s*(0x[0-9a-fA-F]+)\\s*;`))?.[1];
  need(literal?.toLowerCase() === expected, `Any Quote compiled Host ${constant} differs`);
}
/** The host must be CREATE: its address is known before mining the hook salt embedded in its initcode. */
export async function buildAnyQuotePlan(build, input, basis) {
  exactKeys(input, ['owner', 'ownerNonce', 'reviewAuthority', 'releaseLabel'], 'Any Quote deployment parameters');
  const parameters = { owner: address(input.owner), ownerNonce: uint(input.ownerNonce, 'ownerNonce'),
    reviewAuthority: address(input.reviewAuthority), releaseLabel: input.releaseLabel };
  need(BigInt(parameters.ownerNonce) < (1n << 64n) - 2n, 'Bounded owner nonce required');
  need(typeof parameters.releaseLabel === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(parameters.releaseLabel)
    && parameters.releaseLabel.includes('any-quote'), 'Explicit bounded Any Quote release label required');
  const { basisDigest, ...body } = basis, previous = basis.previousRelease;
  need(basis.schemaVersion === 'programmable.module-mode-native-v2-basis.v1' && basis.chainId === 4663
    && hash(basisDigest) === digest(basis.schemaVersion, body) && basis.provenance.sourceCommit === build.sourceCommit,
  'Sealed historical authority basis required');
  need(previous.sourceVersion === 'module-native-v1' && previous.enabled === true && previous.status === 'active'
    && parameters.owner === basis.deploymentOwner && parameters.reviewAuthority === basis.registryOwner
    && basis.rewardAdmin === REWARD_ADMIN, 'Existing deployment, Registry or reward rights differ');
  need(build.reuseSourceProvenance?.previousReleaseDigest === previous.releaseDigest
    && build.reuseSourceProvenance.previousSourceCommit === previous.sourceCommit
    && build.reuseSourceDigest === digest(ANY_QUOTE_REUSE_DOMAIN, build.reuseSourceProvenance), 'Exact retained source closure required');
  need(canonicalJson(previous.contracts.poolManager) === canonicalJson(OFFICIAL.poolManager), 'Official PoolManager differs');
  const wire = await engineWire(), a = build.artifacts, contracts = {};
  for (const role of ANY_QUOTE_REUSED_ROLES) {
    contracts[role] = pin(a[role], previous.contracts[role].address);
    need(contracts[role].runtimeCodeHash === previous.contracts[role].runtimeCodeHash, `${role}: retained runtime differs`);
  }
  const guard = creation(a.nativeRouteGuard, []);
  const guardSalt = keccak256(encodeAbiParameters(parseAbiParameters('string,uint256,string,string'),
    ['programmable.module-engine-any-quote.deployment.v1', 4663n, parameters.releaseLabel, 'nativeRouteGuard']));
  const guardAddress = address(getCreate2Address({ from: OFFICIAL.deterministicDeployer.address, salt: guardSalt, bytecodeHash: guard.initcodeHash }));
  contracts.nativeRouteGuard = pin(a.nativeRouteGuard, guardAddress);
  const hostNonce = BigInt(parameters.ownerNonce) + 1n, hostAddress = address(getContractAddress({ from: parameters.owner, nonce: hostNonce }));
  const hook = creation(a.sharedHook, [OFFICIAL.poolManager.address, hostAddress, basis.rewardAdmin]);
  const seed = keccak256(encodeAbiParameters(parseAbiParameters('string,uint256,string,address'),
    ['programmable.module-engine-any-quote.shared-hook.v1', 4663n, parameters.releaseLabel, hostAddress]));
  let hookSalt, hookAddress, attempts;
  for (attempts = 0; attempts < 1_000_000; attempts++) {
    hookSalt = keccak256(encodeAbiParameters(parseAbiParameters('bytes32,uint256'), [seed, BigInt(attempts)]));
    hookAddress = address(getCreate2Address({ from: hostAddress, salt: hookSalt, bytecodeHash: hook.initcodeHash }));
    if ((BigInt(hookAddress) & HOOK_MASK) === HOOK_FLAGS) break;
  }
  need(attempts < 1_000_000, 'Bounded shared hook mining exhausted');
  const ledgerAddress = address(getContractAddress({ from: hookAddress, nonce: 1n }));
  contracts.sharedHook = pin(a.sharedHook, hookAddress, { poolManager: OFFICIAL.poolManager.address, host: hostAddress, ledger: ledgerAddress });
  contracts.ledger = pin(a.ledger, ledgerAddress, { poolManager: OFFICIAL.poolManager.address, host: hostAddress, hook: hookAddress, rewardAdmin: basis.rewardAdmin });
  const host = creation(a.host, [contracts.tokenFactory.address, contracts.launchPolicy.address, contracts.registry.address,
    OFFICIAL.poolManager.address, basis.rewardAdmin, hookSalt, guardAddress]);
  contracts.host = pin(a.host, hostAddress, { tokenFactory: contracts.tokenFactory.address, launchPolicy: contracts.launchPolicy.address,
    registry: contracts.registry.address, sharedHook: hookAddress, nativeRouteGuard: guardAddress, ledger: ledgerAddress,
    quotePoolManager: OFFICIAL.poolManager.address, quotePoolManagerCodeHash: OFFICIAL.poolManager.runtimeCodeHash });
  for (const [constant, expected] of [['TOKEN_FACTORY_CODE_HASH', contracts.tokenFactory.runtimeCodeHash],
    ['LAUNCH_POLICY_CODE_HASH', contracts.launchPolicy.runtimeCodeHash], ['NATIVE_ROUTE_GUARD_CODE_HASH', contracts.nativeRouteGuard.runtimeCodeHash],
    ['UNIVERSAL_ROUTER', ANY_QUOTE_ROUTER.address], ['UNIVERSAL_ROUTER_CODE_HASH', ANY_QUOTE_ROUTER.runtimeCodeHash]]) literalPin(build, constant, expected);
  const hostSource = build.standardInputs.host.sources['src/module-engine/any-quote/ModuleEngineAnyQuoteHostV1.sol'].content;
  need(hostSource.includes('SOURCE_VERSION = keccak256("programmable.module-engine.any-quote.v1")'), 'Compiled Host source identity differs');
  const steps = [
    { index: 0, role: 'nativeRouteGuard', deploymentKind: 'create2', sender: parameters.owner, nonce: parameters.ownerNonce,
      to: OFFICIAL.deterministicDeployer.address, value: '0', ...guard, data: `${guardSalt}${guard.data.slice(2)}`,
      target: guardAddress, salt: guardSalt, expectedRoles: ['nativeRouteGuard'] },
    { index: 1, role: 'host', deploymentKind: 'create', sender: parameters.owner, nonce: String(hostNonce), to: null,
      value: '0', ...host, target: hostAddress, expectedRoles: ['host', 'sharedHook', 'ledger'] },
  ];
  const pins = { ...Object.fromEntries(Object.entries(contracts).map(([role, value]) => [role, { address: value.address, runtimeCodeHash: value.runtimeCodeHash }])),
    poolManager: OFFICIAL.poolManager, universalRouter: ANY_QUOTE_ROUTER };
  exactKeys(pins, wire.MODULE_ENGINE_ANY_QUOTE_CONTRACTS, 'Any Quote nine-role source identity');
  const tokenCreationCodeHash = keccak256(a.token.bytecode.object);
  need(tokenCreationCodeHash === previous.tokenCreationCodeHash, 'Existing token generation differs');
  const identityCandidate = { schemaVersion: wire.MODULE_ENGINE_RELEASE_SCHEMA, sourceVersion: wire.MODULE_ENGINE_ANY_QUOTE_SOURCE_VERSION,
    engineProfile: wire.MODULE_ENGINE_ANY_QUOTE_PROFILE, chainId: 4663, sourceCommit: build.sourceCommit, tokenCreationCodeHash,
    economicsPolicyId: wire.MODULE_ENGINE_ANY_QUOTE_ECONOMICS_POLICY_ID, finalityPolicy: previous.finalityPolicy, contracts: pins };
  const plan = { schemaVersion: ANY_QUOTE_PLAN_SCHEMA, chainId: 4663, sourceCommit: build.sourceCommit, sourceTree: build.sourceTree,
    sourceClean: build.sourceClean, buildDigest: build.buildDigest, reuseSourceDigest: build.reuseSourceDigest,
    sourceId: wire.MODULE_ENGINE_ANY_QUOTE_SOURCE_ID, parameters, basis, official: OFFICIAL, officialSource: OFFICIAL_SOURCE,
    contracts, steps, reusedRoles: ANY_QUOTE_REUSED_ROLES, identityCandidate,
    sharedHookCreation: { ...hook, salt: hookSalt, target: hookAddress, deployer: hostAddress, attempts: attempts + 1,
      hookFlags: toHex(HOOK_FLAGS), ledger: ledgerAddress },
    economics: { economicsPolicyId: wire.MODULE_ENGINE_ANY_QUOTE_ECONOMICS_POLICY_ID, platformFeeBps: 30,
      platformRecipient: wire.MODULE_ENGINE_ANY_QUOTE_PLATFORM_RECIPIENT, rewardAdmin: basis.rewardAdmin,
      creatorFeeBps: { minimum: 0, maximum: 1000, step: 100 }, feeAsset: 'per-launch-quote-asset', lpFee: 0 },
    configurationSchemaId: wire.MODULE_ENGINE_ANY_QUOTE_CONFIGURATION_SCHEMA_ID,
    authority: { status: 'unapproved', liveTransactions: false, independentReview: 'required', sourceVerification: 'not-published', finality: 'unproven' } };
  return { ...plan, planDigest: digest(ANY_QUOTE_PLAN_SCHEMA, plan) };
}
export async function assertAnyQuotePlan(plan, build) {
  need(canonicalJson(plan) === canonicalJson(await buildAnyQuotePlan(build, plan.parameters, plan.basis)), 'Any Quote plan differs from sealed source, nonce, pins or economics');
  return plan;
}
export function assertAnyQuoteProfile(plan) {
  need(plan?.schemaVersion === ANY_QUOTE_PLAN_SCHEMA && plan.chainId === 4663
    && plan.identityCandidate?.schemaVersion === 'programmable.module-engine.release.v1'
    && plan.identityCandidate.sourceVersion === 'module-engine-any-quote-v1'
    && plan.identityCandidate.engineProfile === 'robinhood-any-quote.shared-hook.v1'
    && plan.identityCandidate.economicsPolicyId === keccak256(toHex('programmable.any-quote.base-30.creator-0-1000.v1'))
    && plan.economics?.economicsPolicyId === plan.identityCandidate.economicsPolicyId
    && plan.economics.platformFeeBps === 30 && plan.economics.platformRecipient === '0xd88539d3c4c460136a733a3fd60cf6bf269079da',
  'Exact Any Quote source/economics profile required');
  exactKeys(plan.identityCandidate.contracts, ['host', 'registry', 'tokenFactory', 'launchPolicy', 'ledger', 'poolManager', 'sharedHook', 'universalRouter', 'nativeRouteGuard'], 'Any Quote pins');
  need(plan.steps?.length === 2 && plan.steps[0].role === 'nativeRouteGuard' && plan.steps[0].deploymentKind === 'create2'
    && plan.steps[1].role === 'host' && plan.steps[1].deploymentKind === 'create' && plan.steps[1].to === null
    && plan.steps.every((step, i) => step.index === i && step.value === '0' && BigInt(step.nonce) === BigInt(plan.parameters.ownerNonce) + BigInt(i)),
  'Exact guard then nonce-bound Host sequence required');
  return plan;
}
