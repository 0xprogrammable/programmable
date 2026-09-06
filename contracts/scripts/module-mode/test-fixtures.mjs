// Synthetic bytes only for operator unit tests; never deployment artifacts.
import { keccak256, toHex, parseAbiParameters } from 'viem';
import { ARTIFACTS, buildPlan } from './core.mjs';

export const addr = number => `0x${number.toString(16).padStart(40, '0')}`;
export const params = { owner: addr(1), reviewAuthority: addr(2), minimumInitialBuyNative: '400000000000000', releaseLabel: 'test-native-v1' };
export function fixtures() {
  const ctor = {
    positionForwarderFactory: 'address positionManager', registry: 'address reviewAuthority',
    hook: 'address poolManager,address registry,address runtimeFactory,address treasury,address rewardAdmin,address noModuleRecipient',
    launcher: 'address poolManager,address positionManager,address tokenFactory,address hook,address positionPlanner,address launchPolicy,address positionForwarderFactory,address swapRouterFactory,bytes32 swapRouterFactoryCodeHash,uint256 minInitialBuyNative',
    runtime: 'address engine', rewardLedger: 'address poolManager,address registry,address treasury,address rewardAdmin,address noModuleRecipient',
    swapRouter: 'address poolManager,address hook,address source',
  };
  const immutables = { positionForwarderFactory: ['positionManager'], hook: ['poolManager', 'registry', 'runtimeFactory', 'ledger'],
    rewardLedger: ['poolManager', 'registry', 'hook', 'treasury', 'rewardAdmin', 'noModuleRecipient'], runtime: ['engine', 'engineCodeHash', 'vault'],
    budgetVault: ['runtime'], swapRouter: ['poolManager', 'hook', 'source'],
    launcher: ['poolManager', 'positionManager', 'tokenFactory', 'feeHook', 'positionPlanner', 'launchPolicy', 'positionForwarderFactory', 'swapRouterFactory', 'swapRouter', 'minInitialBuyNative'] };
  const artifacts = {}; let sequence = 1;
  for (const role of Object.keys(ARTIFACTS)) {
    const names = immutables[role] ?? []; artifacts[role] = { abi: [{ type: 'constructor', stateMutability: 'nonpayable', inputs: ctor[role] ? parseAbiParameters(ctor[role]) : [] }],
      bytecode: { object: `0x6000${(sequence++).toString(16).padStart(2, '0')}6000` }, deployedBytecode: { object: `0x${'00'.repeat(Math.max(1, names.length * 32))}`,
        immutableReferences: Object.fromEntries(names.map((name, i) => [`${i}`, [{ start: i * 32, length: 32 }]])) },
      immutableNames: Object.fromEntries(names.map((name, i) => [`${i}`, name])), compilationTarget: { [`src/${role}.sol`]: role } };
  }
  return { sourceCommit: 'a'.repeat(40), sourceTree: 'b'.repeat(40), sourceClean: true, buildDigest: keccak256(toHex('fixture-only-build')), artifacts };
}
export const build = fixtures(); export const plan = buildPlan(build, params);
