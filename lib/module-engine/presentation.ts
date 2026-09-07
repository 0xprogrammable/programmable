/** A contract may bind any uint256 timestamp; values outside Date's range remain readable. */
export function moduleEngineUtcTimestamp(value: bigint): string {
  if (value < 0n || value > 8_640_000_000_000n) return `Unix time ${value.toString()} (UTC)`;
  return new Date(Number(value) * 1000).toISOString().replace("T", " ").replace(".000Z", " UTC");
}
