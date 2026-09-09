import { encodeAbiParameters, keccak256 } from 'viem';

// Shared inert helpers. Browser-facing validators must not import the legacy AJV entry point.
export class ClassicModuleError extends Error {
  constructor(code, message, path = '') {
    super(message);
    this.name = 'ClassicModuleError';
    this.code = code;
    this.path = path;
  }
}
function requireCondition(condition, code, message, path = '') {
  if (!condition) throw new ClassicModuleError(code, message, path);
}
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
export function nonzeroAddress(value, label) {
  requireCondition(typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
    && value.toLowerCase() !== ZERO_ADDRESS, 'INVALID_ADDRESS', `${label} must be a nonzero address`);
}
export function safeRelativePath(value) {
  return typeof value === 'string' && value.length <= 240
    && value.split('/').every((part) => /^[A-Za-z0-9._@+()[\]-]+$/u.test(part)
      && part !== '.' && part !== '..');
}
export function familyIdFor(author, salt) {
  nonzeroAddress(author, 'author');
  requireCondition(/^0x[0-9a-fA-F]{64}$/.test(salt), 'INVALID_SALT', 'Family salt must be bytes32');
  return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [author, salt]));
}
