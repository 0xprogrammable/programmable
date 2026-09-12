import { formatUnits, parseUnits } from "viem";

export function parseSwapAmount(value: string, decimals: number): bigint | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255 || !/^(?:\d+\.?\d*|\.\d+)$/.test(value)) return null;
  const fraction = value.split(".")[1] ?? "";
  if (fraction.length > decimals || value.length > 160) return null;
  const result = parseUnits(value, decimals);
  return result > 0n && result < 2n ** 256n ? result : null;
}

/** Keep token precision out of floating point, including the Max amount. */
export function displaySwapAmount(value: bigint, decimals: number, precision = 6): string {
  const raw = formatUnits(value, decimals);
  const [whole, fraction = ""] = raw.split(".");
  if (value > 0n && whole === "0") {
    const first = fraction.search(/[1-9]/);
    return `0.${fraction.slice(0, Math.min(fraction.length, Math.max(precision, first + 3))).replace(/0+$/, "")}`;
  }
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const tail = fraction.slice(0, precision).replace(/0+$/, "");
  return tail ? `${grouped}.${tail}` : grouped;
}

export function maximumSwapInput(input: {
  side: "buy" | "sell"; chainId: 1 | 4663; nativeBalanceWei: bigint;
  tokenBalanceRaw: bigint; gasPriceWei: bigint; gasEstimate?: bigint;
}): bigint {
  if (input.side === "sell") return input.tokenBalanceRaw;
  const gasUnits = input.gasEstimate && input.gasEstimate > 2_000_000n ? input.gasEstimate : 2_000_000n;
  const estimatedReserve = gasUnits * input.gasPriceWei * 150n / 100n;
  const floor = parseUnits(input.chainId === 4663 ? "0.00002" : "0.0005", 18);
  const reserve = estimatedReserve > floor ? estimatedReserve : floor;
  return input.nativeBalanceWei > reserve ? input.nativeBalanceWei - reserve : 0n;
}
