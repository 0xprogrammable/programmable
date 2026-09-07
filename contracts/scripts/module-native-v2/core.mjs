import { encodeAbiParameters, encodeDeployData, getCreate2Address, getContractAddress, keccak256, parseAbiParameters, toHex } from 'viem';
import { OFFICIAL, OFFICIAL_SOURCE, HOOK_MASK, HOOK_FLAGS, TREASURY, REWARD_ADMIN, address, canonicalJson, digest, hash, jsonSafe, materializeRuntime, need, validateParameters } from '../module-mode/core.mjs';

export const PLAN_SCHEMA_V2 = 'programmable.module-mode-native-v2-deployment-plan.v1';
export const ECONOMICS_POLICY_ID = keccak256(toHex('programmable.module-mode.native-economics.v2'));
export const REUSED_ROLES = Object.freeze(['tokenFactory','positionPlanner','launchPolicy','positionForwarderFactory','runtimeFactory']);
export const NEW_ROLES = Object.freeze(['registry','swapRouterFactory','hook','rewardLedger','launcher','runtime','budgetVault','swapRouter']);
const create = (artifact, args = []) => encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args });
function pin(artifact, target, immutableValues = {}) {
  const runtime = materializeRuntime(artifact, immutableValues);
  need((runtime.length - 2) / 2 <= 24576, 'EIP-170 runtime limit exceeded');
  return { address: address(target), runtimeCodeHash: keccak256(runtime), runtimeBytes: (runtime.length - 2) / 2, immutableValues, runtime };
}
function childSalt(domain, types, values) {
  return keccak256(encodeAbiParameters(parseAbiParameters(`bytes32,${types}`), [keccak256(toHex(domain)), ...values]));
}

/** Uses only the new generation's four necessary deployments; all suitable immutable V1 dependencies are reused. */
export function buildNativeV2Plan(build, input, basis) {
  const parameters = validateParameters(input), a = build.artifacts, contracts = {}, steps = [];
  need(parameters.releaseLabel.includes('native-v2'), 'Explicit native-v2 release label required');
  need(basis?.schemaVersion === 'programmable.module-mode-native-v2-basis.v1' && basis.chainId === 4663, 'Native V2 bound basis required');
  const { basisDigest, ...body } = basis;
  need(hash(basisDigest) === digest(basis.schemaVersion, body), 'V1 basis digest differs');
  need(basis.provenance?.sourceCommit === build.sourceCommit, 'Historical basis source commit differs from sealed build');
  const previous = basis.previousRelease;
  need(previous?.sourceVersion === 'module-native-v1' && previous.enabled === true && previous.status === 'active', 'Active historical V1 source required');
  need(build.reuseSourceProvenance?.previousReleaseDigest === previous.releaseDigest
    && build.reuseSourceProvenance.previousSourceCommit === previous.sourceCommit
    && build.reuseSourceDigest === digest('programmable.module-mode-native-v2-reused-source.v1', build.reuseSourceProvenance), 'Exact original reused V1 source closure required');
  need(address(parameters.owner) === address(basis.deploymentOwner) && address(parameters.reviewAuthority) === address(basis.registryOwner), 'Bound deployment/review owner differs');
  need(address(basis.treasury) === TREASURY && address(basis.rewardAdmin) === REWARD_ADMIN, 'Established protocol recipient or reward administrator differs');
  need(parameters.minimumInitialBuyNative === basis.minimumInitialBuyNative && basis.minimumInitialBuyNative === previous.minimumInitialBuyNative, 'Established minimum initial buy differs');
  for (const role of ['poolManager','positionManager']) need(canonicalJson(previous.contracts[role]) === canonicalJson(OFFICIAL[role]), `Official ${role} differs`);
  const pm = OFFICIAL.poolManager.address, positions = OFFICIAL.positionManager.address;
  for (const role of REUSED_ROLES) {
    const values = role === 'positionForwarderFactory' ? { positionManager: positions } : {};
    contracts[role] = pin(a[role], previous.contracts[role].address, values);
    need(contracts[role].runtimeCodeHash === previous.contracts[role].runtimeCodeHash, `Reused ${role}: compiled bytecode differs from active V1 pin`);
  }
  function deploy(role, args, immutableValues = {}, mineHook = false) {
    const initcode = create(a[role], args), initcodeBytes = (initcode.length - 2) / 2;
    need(initcodeBytes <= 49152, `${role}: EIP-3860 initcode limit exceeded`);
    const initcodeHash = keccak256(initcode);
    const baseSalt = childSalt('programmable.module-mode.deployment.v2','uint256,string,string',[4663n,parameters.releaseLabel,role]);
    let salt = baseSalt, target = getCreate2Address({ from: OFFICIAL.deterministicDeployer.address, salt, bytecodeHash: initcodeHash }), attempts = 0;
    if (mineHook) {
      for (; attempts < 1000000; ++attempts) {
        salt = keccak256(encodeAbiParameters(parseAbiParameters('bytes32,uint256'),[baseSalt,BigInt(attempts)]));
        target = getCreate2Address({ from: OFFICIAL.deterministicDeployer.address,salt,bytecodeHash:initcodeHash });
        if ((BigInt(target) & HOOK_MASK) === HOOK_FLAGS) break;
      }
      need(attempts < 1000000, 'Hook salt search exhausted');
    }
    target = address(target);
    contracts[role] = pin(a[role],target,typeof immutableValues === 'function' ? immutableValues(target) : immutableValues);
    const inputs = a[role].abi.find(item => item.type === 'constructor')?.inputs ?? [];
    steps.push({ index:steps.length,role,sender:parameters.owner,to:OFFICIAL.deterministicDeployer.address,value:'0',data:`${salt}${initcode.slice(2)}`,
      target,salt,initcodeHash,initcodeBytes,constructorArguments:encodeAbiParameters(inputs,args),constructorInputs:inputs,constructorValues:jsonSafe(args),expectedRoles:[role],
      ...(mineHook ? { permissionMask:HOOK_MASK.toString(),permissionFlags:HOOK_FLAGS.toString(),saltSearchIndex:attempts } : {}) });
    return target;
  }
  const registry = deploy('registry',[parameters.reviewAuthority]);
  const swapRouterFactory = deploy('swapRouterFactory',[]);
  const runtimeFactory = contracts.runtimeFactory.address;
  const hook = deploy('hook',[pm,registry,runtimeFactory,basis.treasury,basis.rewardAdmin], target => ({ poolManager:pm,registry,runtimeFactory,ledger:getContractAddress({from:target,nonce:1n}) }),true);
  contracts.rewardLedger = pin(a.rewardLedger,getContractAddress({from:hook,nonce:1n}),{poolManager:pm,registry,hook,treasury:basis.treasury,rewardAdmin:basis.rewardAdmin});
  steps.at(-1).expectedRoles.push('rewardLedger');
  const runtime = address(getCreate2Address({from:runtimeFactory,salt:childSalt('programmable.module-mode.native-runtime.v1','address',[hook]),bytecode:create(a.runtime,[hook])}));
  const vault = address(getContractAddress({from:runtime,nonce:1n}));
  contracts.runtime = pin(a.runtime,runtime,{engine:hook,engineCodeHash:contracts.hook.runtimeCodeHash,vault});
  contracts.budgetVault = pin(a.budgetVault,vault,{runtime});
  deploy('launcher',[pm,positions,contracts.tokenFactory.address,hook,contracts.positionPlanner.address,contracts.launchPolicy.address,contracts.positionForwarderFactory.address,swapRouterFactory,
    contracts.swapRouterFactory.runtimeCodeHash,BigInt(parameters.minimumInitialBuyNative)],target=>{
    const router = address(getCreate2Address({from:swapRouterFactory,salt:childSalt('programmable.module-mode.native-router.v2','address,address,address',[target,pm,hook]),bytecode:create(a.swapRouter,[pm,hook,target])}));
    contracts.swapRouter=pin(a.swapRouter,router,{poolManager:pm,hook,source:target});
    return {poolManager:pm,positionManager:positions,tokenFactory:contracts.tokenFactory.address,feeHook:hook,positionPlanner:contracts.positionPlanner.address,launchPolicy:contracts.launchPolicy.address,
      positionForwarderFactory:contracts.positionForwarderFactory.address,swapRouterFactory,swapRouter:router,minInitialBuyNative:parameters.minimumInitialBuyNative};
  });
  steps.at(-1).expectedRoles.push('runtime','budgetVault','swapRouter');
  const pins={...Object.fromEntries(Object.entries(contracts).map(([role,value])=>[role,{address:value.address,runtimeCodeHash:value.runtimeCodeHash}])),poolManager:OFFICIAL.poolManager,positionManager:OFFICIAL.positionManager};
  const identityCandidate={schemaVersion:'programmable.module-mode-source.v2',sourceVersion:'module-native-v2',economicsPolicyId:ECONOMICS_POLICY_ID,chainId:4663,sourceCommit:build.sourceCommit,
    minimumInitialBuyNative:parameters.minimumInitialBuyNative,tokenCreationCodeHash:keccak256(a.token.bytecode.object),finalityPolicy:'robinhood-ethereum-finalized-v1',contracts:pins};
  const plan={schemaVersion:PLAN_SCHEMA_V2,chainId:4663,sourceCommit:build.sourceCommit,sourceTree:build.sourceTree,sourceClean:build.sourceClean,buildDigest:build.buildDigest,parameters,basis,
    reuseSourceDigest:build.reuseSourceDigest,
    economics:{economicsPolicyId:ECONOMICS_POLICY_ID,creatorFeeBpsMinimum:0,creatorFeeBpsMaximum:1000,creatorFeeStepBps:100,protocolFeeBps:10,eligibleAuthorPoolFeeBps:20,
      platformFeeBpsWithoutEligibleFamilies:10,platformFeeBpsWithEligibleFamilies:30,treasury:basis.treasury,rewardAdmin:basis.rewardAdmin,noModulePolicy:'10bps-protocol-only-no-author-pool'},
    officialSource:OFFICIAL_SOURCE,official:OFFICIAL,contracts,reusedRoles:REUSED_ROLES,steps,identityCandidate,
    authority:{status:'unapproved',liveTransactions:false,sourceVerification:'not-published',finality:'unproven'}};
  return {...plan,planDigest:digest(PLAN_SCHEMA_V2,plan)};
}
export function assertNativeV2Plan(plan,build){need(canonicalJson(plan)===canonicalJson(buildNativeV2Plan(build,plan.parameters,plan.basis)),'V2 plan differs from sealed build, native policy or inherited rights');return plan;}
