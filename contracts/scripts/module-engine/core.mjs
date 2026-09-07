import { encodeAbiParameters, encodeDeployData, getCreate2Address, getContractAddress, keccak256, parseAbiParameters, toHex } from 'viem';
import { OFFICIAL, OFFICIAL_SOURCE, TREASURY, REWARD_ADMIN, address, canonicalJson, digest, exactKeys, hash, jsonSafe, materializeRuntime, need } from '../module-mode/core.mjs';
import { nativeV2Basis, assertNativeV2Basis } from '../module-native-v2/basis.mjs';
import { ECONOMICS_POLICY_ID } from '../module-native-v2/core.mjs';
import { engineWire } from './shared.mjs';

export const ENGINE_PLAN_SCHEMA = 'programmable.module-engine-deployment-plan.v1';
export const ENGINE_DEPLOYMENT_SCHEMA = 'programmable.module-engine-deployment-evidence.v1';
export const ENGINE_NEW_ROLES = Object.freeze(['host', 'ledger']);
export const ENGINE_REUSED_ROLES = Object.freeze(['tokenFactory', 'launchPolicy', 'registry']);
export const ENGINE_REUSE_DOMAIN = 'programmable.module-engine.reused-source.v1';

// The inherited basis remains the exact existing V1 configuration proof, including its explicit missing-quorum status.
export const engineBasis = nativeV2Basis;
export const assertEngineBasis = assertNativeV2Basis;
function pin(artifact, target, immutableValues = {}) {
  const runtime = materializeRuntime(artifact, immutableValues), runtimeBytes = (runtime.length - 2) / 2;
  need(runtimeBytes <= 24576, 'EIP-170 runtime limit exceeded');
  return { address: address(target), runtimeCodeHash: keccak256(runtime), runtimeBytes, immutableValues, runtime };
}
export async function buildEnginePlan(build, input, basis) {
  exactKeys(input, ['owner', 'reviewAuthority', 'releaseLabel'], 'Engine deployment parameters');
  const parameters = { owner: address(input.owner), reviewAuthority: address(input.reviewAuthority), releaseLabel: input.releaseLabel };
  need(typeof parameters.releaseLabel === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(parameters.releaseLabel)
    && parameters.releaseLabel.includes('engine'), 'Explicit bounded engine release label required');
  const { basisDigest, ...body } = basis;
  need(basis.schemaVersion === 'programmable.module-mode-native-v2-basis.v1' && basis.chainId === 4663
    && hash(basisDigest) === digest(basis.schemaVersion, body) && basis.provenance.sourceCommit === build.sourceCommit, 'Sealed historical native authority basis required');
  const previous = basis.previousRelease;
  need(previous.sourceVersion === 'module-native-v1' && previous.enabled === true && previous.status === 'active'
    && parameters.owner === basis.deploymentOwner && parameters.reviewAuthority === basis.registryOwner
    && basis.treasury === TREASURY && basis.rewardAdmin === REWARD_ADMIN, 'Existing deployment/registry/protocol rights differ');
  need(build.reuseSourceProvenance?.previousReleaseDigest === previous.releaseDigest
    && build.reuseSourceProvenance.previousSourceCommit === previous.sourceCommit
    && build.reuseSourceDigest === digest(ENGINE_REUSE_DOMAIN, build.reuseSourceProvenance), 'Exact reused original source closure required');
  need(canonicalJson(previous.contracts.poolManager) === canonicalJson(OFFICIAL.poolManager), 'Official PoolManager pin differs');
  const wire = await engineWire(), a = build.artifacts, contracts = {};
  for (const role of ENGINE_REUSED_ROLES) {
    contracts[role] = pin(a[role], previous.contracts[role].address);
    need(contracts[role].runtimeCodeHash === previous.contracts[role].runtimeCodeHash, `${role}: reused compiled runtime differs from actual V1 pin`);
  }
  const args = [contracts.tokenFactory.address, contracts.launchPolicy.address, contracts.registry.address,
    OFFICIAL.poolManager.address, basis.treasury, basis.rewardAdmin];
  const initcode = encodeDeployData({ abi: a.host.abi, bytecode: a.host.bytecode.object, args }), initcodeBytes = (initcode.length - 2) / 2;
  need(initcodeBytes <= 49152, 'Engine host exceeds complete EIP-3860 initcode limit');
  const initcodeHash = keccak256(initcode), salt = keccak256(encodeAbiParameters(parseAbiParameters('string,uint256,string,string'),
    ['programmable.module-engine.deployment.v1', 4663n, parameters.releaseLabel, 'host']));
  const target = address(getCreate2Address({ from: OFFICIAL.deterministicDeployer.address, salt, bytecodeHash: initcodeHash }));
  const ledger = address(getContractAddress({ from: target, nonce: 1n }));
  contracts.host = pin(a.host, target, { tokenFactory: args[0], launchPolicy: args[1], registry: args[2], ledger });
  contracts.ledger = pin(a.ledger, ledger, { poolManager: args[3], registry: args[2], hook: target, treasury: basis.treasury, rewardAdmin: basis.rewardAdmin });
  const inputs = a.host.abi.find(item => item.type === 'constructor').inputs;
  const steps = [{ index: 0, role: 'host', sender: parameters.owner, to: OFFICIAL.deterministicDeployer.address, value: '0',
    data: `${salt}${initcode.slice(2)}`, target, salt, initcodeHash, initcodeBytes, constructorInputs: inputs,
    constructorArguments: encodeAbiParameters(inputs, args), constructorValues: jsonSafe(args), expectedRoles: ['host', 'ledger'] }];
  const pins = { ...Object.fromEntries(Object.entries(contracts).map(([role, p]) => [role, { address: p.address, runtimeCodeHash: p.runtimeCodeHash }])), poolManager: OFFICIAL.poolManager };
  need(canonicalJson(Object.keys(pins).sort()) === canonicalJson([...wire.MODULE_ENGINE_CONTRACTS].sort()), 'Engine six-role source wire differs');
  const tokenCreationCodeHash = keccak256(a.token.bytecode.object);
  need(tokenCreationCodeHash === previous.tokenCreationCodeHash, 'Existing primary-token generation differs');
  const identityCandidate = { schemaVersion: wire.MODULE_ENGINE_RELEASE_SCHEMA, sourceVersion: wire.MODULE_ENGINE_SOURCE_VERSION,
    engineProfile: wire.MODULE_ENGINE_PROFILE, chainId: 4663, sourceCommit: build.sourceCommit, tokenCreationCodeHash,
    economicsPolicyId: ECONOMICS_POLICY_ID, finalityPolicy: previous.finalityPolicy, contracts: pins };
  const plan = { schemaVersion: ENGINE_PLAN_SCHEMA, chainId: 4663, sourceCommit: build.sourceCommit, sourceTree: build.sourceTree, sourceClean: build.sourceClean,
    buildDigest: build.buildDigest, reuseSourceDigest: build.reuseSourceDigest, sourceId: wire.MODULE_ENGINE_SOURCE_ID, parameters, basis,
    economics: { economicsPolicyId: ECONOMICS_POLICY_ID, treasury: basis.treasury, rewardAdmin: basis.rewardAdmin, protocolFeeBps: 10,
      eligibleAuthorPoolFeeBps: 20, platformFeeBpsWithoutEligibleFamilies: 10, platformFeeBpsWithEligibleFamilies: 30 },
    official: OFFICIAL, officialSource: OFFICIAL_SOURCE, contracts, reusedRoles: ENGINE_REUSED_ROLES, steps, identityCandidate,
    authority: { status: 'unapproved', liveTransactions: false, independentReview: 'required', sourceVerification: 'not-published', finality: 'unproven' } };
  return { ...plan, planDigest: digest(ENGINE_PLAN_SCHEMA, plan) };
}
export async function assertEnginePlan(plan, build) {
  need(canonicalJson(plan) === canonicalJson(await buildEnginePlan(build, plan.parameters, plan.basis)), 'Engine plan differs from sealed source, six pins or inherited rights');
  return plan;
}
