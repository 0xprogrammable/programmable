import { encodeAbiParameters, keccak256, stringToHex } from 'viem';
import { compileOpenConfig } from '../../../src/open-config.mjs';

// An explicit adapter from schema values to this factory's ABI. A host must review
// and support this mapping; packing source never imports or executes this file.
export const CONFIG_ABI = [
  { name: 'everyN', type: 'uint32' },
  { name: 'minimumGrossNative', type: 'uint128' },
  { name: 'rewardNative', type: 'uint128' },
  { name: 'endsAt', type: 'uint64' },
  { name: 'includeInitialBuy', type: 'bool' },
  { name: 'refundWallet', type: 'address' },
];
export const RECLAIM_UNUSED = keccak256(stringToHex('programmable.module-mode.reward.reclaim-unused.v1'));

export function encodeRewardConfiguration(schema, values, chainTimestamp) {
  const normalized = compileOpenConfig(schema, values).value;
  if ((typeof chainTimestamp === 'number' && !Number.isSafeInteger(chainTimestamp))
    || !/^(0|[1-9][0-9]*)$/.test(String(chainTimestamp))
    || BigInt(normalized.endsAt) <= BigInt(chainTimestamp)) throw new Error('endsAt must be after the chain timestamp');
  if (/^0x0{40}$/.test(normalized.refundWallet)) throw new Error('refundWallet must be nonzero');
  const abiValues = CONFIG_ABI.map(({ name, type }) => type.startsWith('uint') ? BigInt(normalized[name]) : normalized[name]);
  const config = encodeAbiParameters(CONFIG_ABI, abiValues);
  return { config, configHash: keccak256(config), normalized };
}

export function encodeReclaimInputs(inputs) {
  if (!inputs || Object.getPrototypeOf(inputs) !== Object.prototype || Reflect.ownKeys(inputs).length !== 0) {
    throw new Error('reclaim-unused takes an empty input record');
  }
  // The OpenConfig empty-record sentinel is NOT the module's zero-byte action input.
  return '0x';
}
