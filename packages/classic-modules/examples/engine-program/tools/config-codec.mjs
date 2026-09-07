import { readFile } from 'node:fs/promises';
import { encodeAbiParameters, keccak256 } from 'viem';
import { compileOpenConfig } from '../../../src/open-packages.mjs';

export const CONFIGURATION_ABI = JSON.parse(await readFile(new URL('../configuration-abi.json', import.meta.url), 'utf8'));

/** This starter's explicit ABI adapter; schema validation and binding enforcement stay in the existing SDK. */
export function encodeSettlementConfiguration(schema, parameters) {
  const normalized = compileOpenConfig(schema, parameters).value;
  const encoded = encodeAbiParameters(CONFIGURATION_ABI, [
    normalized.quoteAsset, BigInt(normalized.minimumWindow), BigInt(normalized.maximumWindow),
  ]);
  return { normalized, encoded, configHash: keccak256(encoded) };
}
