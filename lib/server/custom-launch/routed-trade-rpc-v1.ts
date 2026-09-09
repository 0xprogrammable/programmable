import { getAddress, toHex, type Address, type Hex } from "viem";
import { canonicalBrowserJsonV2 } from "@/lib/custom-launch/browser-authority-v2";
import { LaunchPlanTradeErrorV1 } from "@/lib/custom-launch/routed-trade-plan-v1";

export type TradeRpcV1 = (method: string, params: readonly unknown[]) => Promise<unknown>;
export const pendingTradeV1 = (code = "TRADE_ANALYSIS_PENDING"): never => { throw new LaunchPlanTradeErrorV1(code, "The exact trade could not be verified across independent providers. Try again when its execution adapter is available.", 503); };
export const objectV1 = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : pendingTradeV1();
export const bytesV1 = (v: unknown): Hex => typeof v === "string" && /^0x(?:[0-9a-f]{2})*$/i.test(v) ? v.toLowerCase() as Hex : pendingTradeV1();
export const quantityV1 = (v: unknown): bigint => typeof v === "string" && /^0x[0-9a-f]{1,64}$/i.test(v) ? BigInt(v) : pendingTradeV1();
const addressV1 = (v: unknown): Address => typeof v === "string" && /^0x[0-9a-f]{40}$/i.test(v) ? getAddress(v).toLowerCase() as Address : pendingTradeV1();

/** Independent domains are authority, not just two URLs. Credentials never enter evidence or errors. */
export function productionTradeRpcsV1(env: Readonly<Record<string, string | undefined>> = process.env, fetcher: typeof fetch = fetch): readonly [TradeRpcV1, TradeRpcV1] {
  const endpoints = [env.ROBINHOOD_V4_RPC_PRIMARY_URL ?? env.ROBINHOOD_RPC_URL,
    env.ROBINHOOD_V4_RPC_SECONDARY_URL ?? env.ROBINHOOD_SECONDARY_RPC_URL];
  const domains = ["drpc.org", "alchemy.com"];
  return endpoints.map((endpoint, index) => {
    let url: URL;
    try { url = new URL(endpoint ?? ""); } catch { return pendingTradeV1("TRADE_PROVIDER_CONFIGURATION_PENDING"); }
    const domain = domains[index]!;
    const prefix = index === 0 ? "ROBINHOOD_V4_RPC_PRIMARY" : "ROBINHOOD_V4_RPC_SECONDARY";
    const providerId = index === 0 ? "drpc" : "alchemy";
    // Same reviewed endpoints as the existing Robinhood V4 submission adapter.
    const reviewed = index === 0 ? /^https:\/\/lb\.drpc\.live\/robinhood\/[A-Za-z0-9_-]{16,256}$/.test(endpoint ?? "")
      : /^https:\/\/robinhood-mainnet\.g\.alchemy\.com\/v2\/[A-Za-z0-9_-]{16,256}$/.test(endpoint ?? "");
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || !reviewed
      || (env[`${prefix}_PROVIDER_ID`] !== undefined && env[`${prefix}_PROVIDER_ID`] !== providerId)
      || (env[`${prefix}_TRUST_DOMAIN`] !== undefined && env[`${prefix}_TRUST_DOMAIN`] !== domain)
      || (env[`${prefix}_AUTHENTICATION`] !== undefined && env[`${prefix}_AUTHENTICATION`] !== "provider-credential")) return pendingTradeV1("TRADE_PROVIDER_CONFIGURATION_PENDING");
    return async (method: string, params: readonly unknown[]) => {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetcher(url, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), cache: "no-store", signal: controller.signal });
        if (!response.ok || !response.body || Number(response.headers.get("content-length") ?? 0) > 1_048_576) return pendingTradeV1();
        const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
        try {
          for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length;
            if (size > 1_048_576) { await reader.cancel(); return pendingTradeV1(); } chunks.push(part.value); }
        } finally { reader.releaseLock(); }
        const data = objectV1(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        if (data.jsonrpc !== "2.0" || data.id !== 1 || data.error || !Object.hasOwn(data, "result")) return pendingTradeV1();
        return data.result;
      } catch { return pendingTradeV1(); } finally { clearTimeout(timeout); }
    };
  }) as unknown as readonly [TradeRpcV1, TradeRpcV1];
}
export function agreedTradeRpcV1(rpcs: readonly [TradeRpcV1, TradeRpcV1]) {
  return async <T>(method: string, params: readonly unknown[], parse: (value: unknown) => T): Promise<T> => {
    const values = await Promise.allSettled(rpcs.map(async rpc => parse(await rpc(method, params))));
    if (values[0].status !== "fulfilled" || values[1].status !== "fulfilled") return pendingTradeV1();
    if (canonicalBrowserJsonV2(values[0].value) !== canonicalBrowserJsonV2(values[1].value)) return pendingTradeV1("TRADE_PROVIDER_DISAGREEMENT");
    return values[0].value;
  };
}
export function tradeBlockV1(value: unknown) {
  const b = objectV1(value), hash = bytesV1(b.hash);
  if (hash.length !== 66) return pendingTradeV1();
  return { number: quantityV1(b.number).toString(), hash, timestamp: quantityV1(b.timestamp).toString() };
}
export interface TradeTraceV1 { type: string; from: Address; to: Address | null; input: Hex; output: Hex; value: string; gasUsed: string; failed: boolean; calls: readonly TradeTraceV1[] }
export function tradeTraceV1(value: unknown): TradeTraceV1 {
  let count = 0;
  const parse = (v: unknown, depth: number): TradeTraceV1 => {
    if (++count > 8192 || depth > 128) return pendingTradeV1("TRADE_TRACE_LIMIT");
    const frame = objectV1(v);
    if (typeof frame.type !== "string" || !["CALL", "STATICCALL", "DELEGATECALL", "CALLCODE", "CREATE", "CREATE2", "SELFDESTRUCT"].includes(frame.type)
      || (frame.error !== undefined && typeof frame.error !== "string") || (frame.calls !== undefined && !Array.isArray(frame.calls))) return pendingTradeV1();
    return { type: frame.type, from: addressV1(frame.from), to: frame.to === undefined ? null : addressV1(frame.to),
      input: bytesV1(frame.input ?? "0x"), output: bytesV1(frame.output ?? "0x"), value: quantityV1(frame.value ?? "0x0").toString(),
      gasUsed: quantityV1(frame.gasUsed ?? "0x0").toString(), failed: !!frame.error,
      calls: (frame.calls as unknown[] ?? []).map(child => parse(child, depth + 1)) };
  };
  return parse(value, 0);
}
export const successfulTradeFramesV1 = (trace: TradeTraceV1): readonly TradeTraceV1[] => trace.failed ? [] : [trace, ...trace.calls.flatMap(successfulTradeFramesV1)];

/** Geth diffMode omits unchanged fields. A pre-only account was deleted and a
 * pre-only storage slot cleared. Never substitute guessed balances or allowance. */
export function tradePostStateV1(value: unknown): Record<string, Record<string, unknown>> {
  const normalize = (value: unknown) => {
    const entries = Object.entries(objectV1(value)).map(([address, account]) => [addressV1(address), objectV1(account)] as const);
    if (new Set(entries.map(([address]) => address)).size !== entries.length) return pendingTradeV1();
    return Object.fromEntries(entries);
  };
  const diff = objectV1(value), pre = normalize(diff.pre), post = normalize(diff.post);
  const addresses = [...new Set([...Object.keys(pre), ...Object.keys(post)])];
  if (addresses.length > 4096) return pendingTradeV1("TRADE_TRACE_LIMIT");
  const zero = `0x${"0".repeat(64)}`;
  return Object.fromEntries(addresses.map(raw => {
    const address = addressV1(raw), before = pre[raw] === undefined ? {} : objectV1(pre[raw]), after = post[raw] === undefined ? null : objectV1(post[raw]);
    const priorStorage = before.storage === undefined ? {} : objectV1(before.storage), nextStorage = after?.storage === undefined ? {} : objectV1(after.storage);
    const slots = [...new Set([...Object.keys(priorStorage), ...Object.keys(nextStorage)])];
    if (slots.length > 8192) return pendingTradeV1("TRADE_TRACE_LIMIT");
    const stateDiff = Object.fromEntries(slots.map(slot => {
      const key = bytesV1(slot), val = nextStorage[slot] === undefined ? zero : bytesV1(nextStorage[slot]);
      if (key.length !== 66 || val.length !== 66) return pendingTradeV1();
      return [key, val];
    }));
    if (after === null) return [address, { code: "0x", balance: "0x0", nonce: "0x0", stateDiff }];
    if (after.nonce !== undefined && (!Number.isSafeInteger(after.nonce) || Number(after.nonce) < 0)) return pendingTradeV1();
    return [address, { ...(after.code === undefined ? {} : { code: bytesV1(after.code) }),
      ...(after.balance === undefined ? {} : { balance: toHex(quantityV1(after.balance)) }),
      ...(after.nonce === undefined ? {} : { nonce: toHex(Number(after.nonce)) }), ...(slots.length ? { stateDiff } : {}) }];
  }));
}
