import type { AnyQuoteReadinessV1 } from "./types";

type CompatibleReadiness = Extract<AnyQuoteReadinessV1, { status: "compatible" }>;
type Entry = { result: CompatibleReadiness; expiresAt: number };
const displayed = new Map<string, Entry>();
const symbols = new Map<string, string>();

/** The ticker remains display-only after its price and route check expires. */
export function readAnyQuoteDisplaySymbol(key: string): string | undefined { return symbols.get(key); }

/** Reuses a recent display check across builders. Launch preparation still fetches fresh authority. */
export function readAnyQuoteDisplayCheck(key: string, now = Date.now()): CompatibleReadiness | null {
  const entry = displayed.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) { displayed.delete(key); return null; }
  return entry.result;
}

export function rememberAnyQuoteDisplayCheck(key: string, result: CompatibleReadiness, now = Date.now()): void {
  const expiresAt = Math.min(Number(result.validUntil) * 1_000, now + 180_000);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return;
  displayed.delete(key);
  displayed.set(key, { result, expiresAt });
  while (displayed.size > 32) displayed.delete(displayed.keys().next().value!);
  symbols.delete(key);
  symbols.set(key, result.token.symbol);
  while (symbols.size > 32) symbols.delete(symbols.keys().next().value!);
}

export function forgetAnyQuoteDisplayCheck(key: string): void { displayed.delete(key); }
