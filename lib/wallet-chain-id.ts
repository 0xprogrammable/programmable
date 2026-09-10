const decimalChainIdPattern = /^[1-9][0-9]*$/;
const hexChainIdPattern = /^0x[0-9a-f]+$/i;

/** Parse provider and SDK chain IDs without coercing unrelated values. */
export function parseWalletChainId(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string" || value.trim() !== value) return null;

  const isCaip = value.startsWith("eip155:");
  const reference = isCaip ? value.slice("eip155:".length) : value;
  if (!decimalChainIdPattern.test(reference)
    && (isCaip || !hexChainIdPattern.test(reference))) return null;

  const chainId = Number(reference);
  return Number.isSafeInteger(chainId) && chainId > 0 ? chainId : null;
}

export function normalizeWalletChainId(value: unknown): `0x${string}` | null {
  const chainId = parseWalletChainId(value);
  return chainId === null ? null : `0x${chainId.toString(16)}`;
}

export function walletChainIdsEqual(left: unknown, right: unknown): boolean {
  const chainId = parseWalletChainId(left);
  return chainId !== null && chainId === parseWalletChainId(right);
}
