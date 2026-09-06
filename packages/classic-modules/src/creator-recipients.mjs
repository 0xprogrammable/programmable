import { concatHex, encodeAbiParameters, encodeFunctionData, isAddress, keccak256, stringToHex } from 'viem';
import { ClassicModuleError } from './index.mjs';

export const MAX_CREATOR_SPLIT_RECIPIENTS = 1000;
export const CREATOR_SPLIT_DOMAIN = keccak256(stringToHex('programmable.classic.creator-split.v1'));
const MAX_UINT256 = (1n << 256n) - 1n;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const ZERO_HASH = `0x${'0'.repeat(64)}`;
const TAKEOVER_ABI = [{
  type: 'function', name: 'replaceCreatorWallets', stateMutability: 'nonpayable', outputs: [],
  inputs: [{ name: 'poolId', type: 'bytes32' }, { name: 'newWallets', type: 'address[]' },
    { name: 'expectedAdminRevision', type: 'uint256' }, { name: 'deadline', type: 'uint256' }],
}];
function requireCondition(condition, code, message) {
  if (!condition) throw new ClassicModuleError(code, message);
}
function plainRecord(value, keys, code) {
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).length === keys.length, code, `Expected fields: ${keys.join(', ')}`);
  const result = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    requireCondition(descriptor && Object.hasOwn(descriptor, 'value'), code, 'Expected plain data fields without accessors');
    result[key] = descriptor.value;
  }
  return result;
}
function denseArray(value, maximum, code) {
  requireCondition(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype
    && value.length >= 1 && value.length <= maximum, code, `Expected 1–${maximum} entries`);
  requireCondition(Reflect.ownKeys(value).length === value.length + 1, code, 'Expected a dense array without extra properties');
  const result = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    requireCondition(descriptor && Object.hasOwn(descriptor, 'value'), code, 'Expected a dense array without accessors');
    result.push(descriptor.value);
  }
  return result;
}
function unsignedInteger(value, label, maximum = MAX_UINT256) {
  requireCondition((typeof value === 'string' && value.length <= 78 && /^(0|[1-9][0-9]*)$/.test(value))
    || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0))
    || (typeof value === 'bigint' && value >= 0n), 'INVALID_INTEGER', `${label} must be a canonical unsigned integer`);
  const integer = BigInt(value);
  requireCondition(integer <= maximum, 'INTEGER_RANGE', `${label} is outside its supported range`);
  return integer;
}
function walletAddress(value, label) {
  requireCondition(typeof value === 'string' && isAddress(value)
    && value.toLowerCase() !== ZERO_ADDRESS, 'INVALID_ADDRESS', `${label} must be a nonzero wallet address with a valid checksum when mixed case`);
  return value.toLowerCase();
}
function leafHash(index, wallet, shareBps) {
  return keccak256(keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint16' }],
    [CREATOR_SPLIT_DOMAIN, BigInt(index), wallet, Number(shareBps)],
  )));
}
function pairHash(first, second) {
  return keccak256(concatHex(first < second ? [first, second] : [second, first]));
}

/** Prepare immutable splitter allocations and claim proofs; no deployment address or authority is inferred. */
export function buildCreatorSplit(recipients) {
  const rows = denseArray(recipients, MAX_CREATOR_SPLIT_RECIPIENTS, 'CREATOR_SPLIT_COUNT').map((input) => {
    const { wallet, shareBps } = plainRecord(input, ['wallet', 'shareBps'], 'CREATOR_SPLIT_RECIPIENT');
    const share = unsignedInteger(shareBps, 'shareBps', 10_000n);
    requireCondition(share > 0n, 'CREATOR_SPLIT_SHARE', 'Every recipient must have a positive share');
    return { wallet: walletAddress(wallet, 'wallet'), shareBps: share.toString() };
  }).sort((a, b) => a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0);
  let total = 0n;
  for (let index = 0; index < rows.length; index++) {
    requireCondition(index === 0 || rows[index - 1].wallet !== rows[index].wallet,
      'CREATOR_SPLIT_DUPLICATE', 'Recipient wallets must be unique');
    total += BigInt(rows[index].shareBps);
  }
  requireCondition(total === 10_000n, 'CREATOR_SPLIT_SHARE_TOTAL', 'Recipient shares must total exactly 10000 bps');

  const leaves = rows.map((row, index) => leafHash(index, row.wallet, row.shareBps));
  let width = 1;
  while (width < rows.length) width *= 2;
  const levels = [[...leaves, ...Array(width - rows.length).fill(ZERO_HASH)]];
  while (levels.at(-1).length > 1) {
    const previous = levels.at(-1); const next = [];
    for (let index = 0; index < previous.length; index += 2) next.push(pairHash(previous[index], previous[index + 1]));
    levels.push(next);
  }
  return {
    format: 'programmable.classic.creator-split.v1', root: levels.at(-1)[0], recipientCount: rows.length,
    // Solidity reads address20 followed by big-endian uint16, exactly 22 bytes per row.
    allocations: `0x${rows.map((row) => row.wallet.slice(2) + BigInt(row.shareBps).toString(16).padStart(4, '0')).join('')}`,
    recipients: rows.map((row, index) => {
      const proof = []; let position = index;
      for (const level of levels.slice(0, -1)) { proof.push(level[position ^ 1]); position = Math.floor(position / 2); }
      return { index: String(index), ...row, leaf: leaves[index], proof };
    }),
  };
}

/** Encode only: read the ledger's current revision and choose a deadline before asking an admin wallet to sign. */
export function encodeCreatorTakeover(input) {
  const { ledger, poolId, newWallets, expectedAdminRevision, deadline } = plainRecord(input,
    ['ledger', 'poolId', 'newWallets', 'expectedAdminRevision', 'deadline'], 'CREATOR_TAKEOVER_INPUT');
  const target = walletAddress(ledger, 'ledger');
  requireCondition(typeof poolId === 'string' && /^0x[0-9a-fA-F]{64}$/.test(poolId)
    && poolId.toLowerCase() !== ZERO_HASH, 'INVALID_POOL_ID', 'poolId must be nonzero bytes32');
  // Ordering is meaningful: each destination replaces the corresponding immutable creator share slot.
  // Repeated destinations are allowed when an administrator consolidates slots.
  const wallets = denseArray(newWallets, 10, 'CREATOR_TAKEOVER_SLOTS').map((wallet) => walletAddress(wallet, 'newWallets'));
  const revision = unsignedInteger(expectedAdminRevision, 'expectedAdminRevision');
  const expires = unsignedInteger(deadline, 'deadline');
  requireCondition(expires > 0n, 'INVALID_DEADLINE', 'deadline must be positive');
  return { target, data: encodeFunctionData({ abi: TAKEOVER_ABI, functionName: 'replaceCreatorWallets',
    args: [poolId.toLowerCase(), wallets, revision, expires] }), value: '0' };
}
