import { encodeAbiParameters, encodeDeployData, getCreate2Address, keccak256, parseAbiParameters, zeroAddress } from 'viem';
import { OFFICIAL, OFFICIAL_SOURCE, address, canonicalJson, digest, exactKeys, hash, jsonSafe, materializeRuntime, need, simulationInput, uint } from '../module-mode/core.mjs';
import { nativeV2Basis, assertNativeV2Basis } from '../module-native-v2/basis.mjs';

export const QUOTE_PLAN_SCHEMA = 'programmable.module-engine-quote-deployment-plan.v1';
export const QUOTE_IDENTITY_SCHEMA = 'programmable.module-engine-quote-infrastructure.v1';
export const QUOTE_DEPLOYMENT_SCHEMA = 'programmable.module-engine-quote-deployment-evidence.v1';
export const QUOTE_SOURCE_VERSION = 'module-engine-quote-v1';
export const QUOTE_ROLES = Object.freeze(['positionPlanner', 'converter']);
export const QUOTE_REUSE_DOMAIN = 'programmable.module-engine-quote.reused-source.v1';
export const QUOTE_ROUTING = Object.freeze({
  v3Factory: { address: '0x1f7d7550b1b028f7571e69a784071f0205fd2efa', runtimeCodeHash: '0xec72b1abd1f2faee020cfea9c646bd8994f9fb389054f6e574f103a895091739' },
  router: { address: '0xcaf681a66d020601342297493863e78c959e5cb2', runtimeCodeHash: '0x6f36c378e272c6324c48f045182bcb54bd8ad654cf9ebd42e8893d52c4cb25dc' },
  weth: { address: '0x0bd7d308f8e1639fab988df18a8011f41eacad73', runtimeCodeHash: '0x5706be52f64875fee65a2cec0d80e47a23d8793cbe85d214b48445e2d05f5353' },
});
export const QUOTE_CONFIGURATION_ABI = parseAbiParameters('(address poolManager,address positionManager,address positionPlanner,address positionForwarderFactory,address converter,bytes32 converterCodeHash,uint256 initialQuotePerTokenX18,address fixedQuoteAsset,bytes feeConversionRouteSuffix)');
export const quoteBasis = nativeV2Basis;
export const assertQuoteBasis = assertNativeV2Basis;

/** This closed infrastructure identity cannot masquerade as a launch source or acquire an economics policy. */
export function assertQuoteProfile(plan) {
  const identity = plan?.identityCandidate;
  need(plan?.schemaVersion === QUOTE_PLAN_SCHEMA && plan.chainId === 4663 && identity?.chainId === 4663
    && identity.schemaVersion === QUOTE_IDENTITY_SCHEMA && identity.sourceVersion === QUOTE_SOURCE_VERSION
    && plan.economics === undefined && identity.economicsPolicyId === undefined, 'Exact Quote infrastructure schema required');
  for (const pins of [plan.contracts, identity.contracts]) exactKeys(pins, QUOTE_ROLES, 'Quote infrastructure roles');
  need(Array.isArray(plan.steps) && plan.steps.length === 2 && plan.steps.every((step, i) => step.index === i
    && step.role === QUOTE_ROLES[i] && step.value === '0' && canonicalJson(step.expectedRoles) === canonicalJson([QUOTE_ROLES[i]])),
  'Only the two zero-value Planner/Converter stages are permitted');
  return plan;
}
function pin(artifact, target, values = {}) {
  const runtime = materializeRuntime(artifact, values), runtimeBytes = (runtime.length - 2) / 2;
  need(runtimeBytes > 0 && runtimeBytes <= 24576, 'Quote runtime violates EIP-170');
  return { address: address(target), runtimeCodeHash: keccak256(runtime), runtimeBytes, immutableValues: values, runtime };
}
export function buildQuotePlan(build, input, basis) {
  exactKeys(input, ['owner', 'releaseLabel'], 'Quote deployment parameters');
  const parameters = { owner: address(input.owner), releaseLabel: input.releaseLabel };
  need(typeof parameters.releaseLabel === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(parameters.releaseLabel)
    && parameters.releaseLabel.includes('quote'), 'Explicit bounded Quote release label required');
  const { basisDigest, ...body } = basis;
  need(basis.schemaVersion === 'programmable.module-mode-native-v2-basis.v1' && basis.chainId === 4663
    && hash(basisDigest) === digest(basis.schemaVersion, body) && basis.provenance.sourceCommit === build.sourceCommit
    && basis.deploymentOwner === parameters.owner, 'Existing source-bound deployment owner required');
  const previous = basis.previousRelease;
  need(previous.enabled === true && previous.status === 'active' && previous.sourceVersion === 'module-native-v1'
    && canonicalJson(previous.contracts.poolManager) === canonicalJson(OFFICIAL.poolManager), 'Existing official V4 basis differs');
  need(build.reuseSourceProvenance?.previousReleaseDigest === previous.releaseDigest
    && build.reuseSourceProvenance.previousSourceCommit === previous.sourceCommit
    && build.reuseSourceDigest === digest(QUOTE_REUSE_DOMAIN, build.reuseSourceProvenance), 'Exact retained Forwarder source closure required');
  const forwarder = previous.contracts.positionForwarderFactory;
  const boundForwarder = pin(build.artifacts.positionForwarderFactory, forwarder.address, { positionManager: OFFICIAL.positionManager.address });
  need(boundForwarder.runtimeCodeHash === forwarder.runtimeCodeHash, 'Retained Forwarder runtime differs from compiled source');
  const dependencies = { ...OFFICIAL, ...QUOTE_ROUTING, positionForwarderFactory: forwarder };
  const contracts = {}, steps = [];
  for (const role of QUOTE_ROLES) {
    const artifact = build.artifacts[role], args = role === 'converter' ? [dependencies.router.address, dependencies.weth.address] : [];
    const initcode = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args });
    const initcodeBytes = (initcode.length - 2) / 2; need(initcodeBytes > 0 && initcodeBytes <= 49152, 'Quote initcode violates EIP-3860');
    const initcodeHash = keccak256(initcode), salt = keccak256(encodeAbiParameters(parseAbiParameters('string,uint256,string,string'),
      ['programmable.module-engine-quote.deployment.v1', 4663n, parameters.releaseLabel, role]));
    const target = address(getCreate2Address({ from: OFFICIAL.deterministicDeployer.address, salt, bytecodeHash: initcodeHash }));
    const values = role === 'converter' ? { router: dependencies.router.address, factory: dependencies.v3Factory.address,
      weth: dependencies.weth.address, routerCodeHash: dependencies.router.runtimeCodeHash,
      factoryCodeHash: dependencies.v3Factory.runtimeCodeHash, wethCodeHash: dependencies.weth.runtimeCodeHash } : {};
    contracts[role] = pin(artifact, target, values);
    const inputs = artifact.abi.find(item => item.type === 'constructor')?.inputs ?? [];
    steps.push({ index: steps.length, role, sender: parameters.owner, to: OFFICIAL.deterministicDeployer.address, value: '0',
      data: `${salt}${initcode.slice(2)}`, target, salt, initcodeHash, initcodeBytes, constructorInputs: inputs,
      constructorArguments: encodeAbiParameters(inputs, args), constructorValues: jsonSafe(args), expectedRoles: [role] });
  }
  need(contracts.positionPlanner.runtimeCodeHash !== previous.contracts.positionPlanner.runtimeCodeHash, 'Classic native Planner is not the Quote Planner');
  need(build.reviewCompilerParity?.schemaVersion === 'programmable.module-engine-quote-compiler-parity.v1'
    && build.reviewCompilerParity.plannerRuntimeCodeHash === contracts.positionPlanner.runtimeCodeHash
    && build.reviewCompilerParity.plannerRuntimeEmbeddedInEngineCreation === true, 'Exact Engine review-profile Planner parity required');
  const identityCandidate = { schemaVersion: QUOTE_IDENTITY_SCHEMA, sourceVersion: QUOTE_SOURCE_VERSION, chainId: 4663,
    sourceCommit: build.sourceCommit, contracts: Object.fromEntries(QUOTE_ROLES.map(role => [role, {
      address: contracts[role].address, runtimeCodeHash: contracts[role].runtimeCodeHash }])), dependencies };
  const plan = { schemaVersion: QUOTE_PLAN_SCHEMA, chainId: 4663, sourceCommit: build.sourceCommit, sourceTree: build.sourceTree,
    sourceClean: build.sourceClean, buildDigest: build.buildDigest, reuseSourceDigest: build.reuseSourceDigest, parameters, basis,
    official: OFFICIAL, officialSource: OFFICIAL_SOURCE, dependencies, contracts, steps, identityCandidate, reviewCompilerParity: build.reviewCompilerParity,
    funding: { transactionValueWei: '0', gas: 'separately-observed-owner-reviewed-EIP1559-ceilings-required' },
    authority: { status: 'unapproved', liveTransactions: false, independentReview: 'required', sourceVerification: 'not-published',
      finality: 'unproven', templateReview: 'not-approved', templatePublication: 'not-published' } };
  assertQuoteProfile(plan);
  return { ...plan, planDigest: digest(QUOTE_PLAN_SCHEMA, plan) };
}
export function assertQuotePlan(plan, build) {
  need(canonicalJson(plan) === canonicalJson(buildQuotePlan(build, plan.parameters, plan.basis)), 'Quote plan differs from sealed source, dependencies or stages');
  return plan;
}
export function quoteInfrastructureIdentity(plan, deploymentBlock) {
  assertQuoteProfile(plan);
  const candidate = { ...plan.identityCandidate, deploymentBlock: uint(deploymentBlock, 'deploymentBlock', true) };
  return { ...candidate, infrastructureDigest: digest(QUOTE_IDENTITY_SCHEMA, candidate) };
}
export function assertQuoteIdentity(plan, identity) {
  need(canonicalJson(identity) === canonicalJson(quoteInfrastructureIdentity(plan, identity.deploymentBlock)), 'Quote infrastructure identity differs');
  return identity;
}
/** Reuse the existing simulation script, including every retained routing and V4 runtime pin. */
export function quoteSimulationInput(plan) {
  assertQuoteProfile(plan);
  const retained = Object.fromEntries(Object.entries(plan.dependencies).filter(([role]) => !Object.hasOwn(OFFICIAL, role)));
  return simulationInput({ ...plan, contracts: { ...retained, ...plan.contracts } });
}
/** Explicit review inputs are required; deploying infrastructure does not select a token price or approve a template. */
export function quoteReviewConfiguration(plan, input) {
  assertQuoteProfile(plan); exactKeys(input, ['initialQuotePerTokenX18', 'feeTier'], 'Quote review configuration');
  const price = BigInt(uint(input.initialQuotePerTokenX18, 'initialQuotePerTokenX18', true));
  need(Number.isSafeInteger(input.feeTier) && [100, 500, 3000, 10000].includes(input.feeTier), 'Explicit standard direct V3 fee tier required');
  const d = plan.dependencies, p = plan.contracts, value = { poolManager: d.poolManager.address, positionManager: d.positionManager.address,
    positionPlanner: p.positionPlanner.address, positionForwarderFactory: d.positionForwarderFactory.address,
    converter: p.converter.address, converterCodeHash: p.converter.runtimeCodeHash, initialQuotePerTokenX18: price,
    fixedQuoteAsset: zeroAddress, feeConversionRouteSuffix: `0x${input.feeTier.toString(16).padStart(6, '0')}${d.weth.address.slice(2)}` };
  const configuration = encodeAbiParameters(QUOTE_CONFIGURATION_ABI, [value]);
  return { schemaVersion: 'programmable.module-engine-quote-review-configuration.v1', planDigest: plan.planDigest,
    status: 'unapproved-unpublished', requiredFixedConfiguration: true, fixedQuoteAsset: zeroAddress,
    abi: QUOTE_CONFIGURATION_ABI, value: jsonSafe(value), configuration, configurationHash: keccak256(configuration),
    eligibility: 'each-actual-quote-market-must-pass-current-converter-oracle-checks' };
}
