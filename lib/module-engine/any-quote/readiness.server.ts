import "server-only";
import { decodeFunctionResult, encodeFunctionData, keccak256, parseAbi, toHex, type Abi, type Address, type Hex } from "viem";
import { agreedTradeRpcV1, productionTradeRpcsV1, tradeBlockV1, type TradeRpcV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";
import {
  ANY_QUOTE_INFRASTRUCTURE as INFRA, ANY_QUOTE_NATIVE, ANY_QUOTE_WETH, ANY_QUOTE_USDG,
  AnyQuoteErrorV1, anyQuoteAddressV1, anyQuoteSameAddressV1, anyQuoteUintV1,
  type AnyQuoteAmmHopV1, type AnyQuoteExternalRouteV1,
  type AnyQuotePriceEvidenceV1, type AnyQuoteRationalV1, type AnyQuoteReadinessV1,
} from "./types";
import { anyQuoteEvidenceHashV1, parseAnyQuoteExternalRouteV1, requireAnyQuoteNativeUnlockRouteV1, validateAnyQuoteExternalRouteV1 } from "./route";
import { anyQuoteRationalV1, multiplyAnyQuoteRationalsV1, parseAnyQuoteDecimalV1 } from "./price";
import { ANY_QUOTE_V4_MAX_POOL_CANDIDATES, anyQuoteV4CandidateHopV1, createAnyQuoteV4InitializeDiscoveryV1, parseAnyQuoteV4DiscoveryV1 } from "./discovery.server";

const QUOTE_URL = "https://trade-api.gateway.uniswap.org/v1/quote";
const ASSETS_URL = "https://api.robinhood.com/rhj/assets";
const FEEDS_URL = "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json";
const ETH_USD = "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9" as Address;
const USDG_USD = "0x61B7e5650328764B076A108EFF5fa7282a1B9aD2" as Address;
const UINT128_MAX = (1n << 128n) - 1n;
const Q192 = 1n << 192n;
const ROUTE_LIFETIME = 45n;
const PROBE_OWNER = "0x000000000000000000000000000000000000dEaD" as Address;
const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new AnyQuoteErrorV1("PROVIDER_RESPONSE_INVALID");
  return v as Record<string, unknown>;
};
const bytes = (v: unknown): Hex => {
  if (typeof v !== "string" || !/^0x(?:[a-f0-9]{2})*$/i.test(v)) throw new AnyQuoteErrorV1("RPC_RESPONSE_INVALID");
  return v.toLowerCase() as Hex;
};
const quantity = (v: unknown): bigint => {
  if (typeof v !== "string" || !/^0x[0-9a-f]{1,64}$/i.test(v)) throw new AnyQuoteErrorV1("RPC_RESPONSE_INVALID");
  return BigInt(v);
};
const min = (...v: bigint[]) => v.reduce((a, b) => a < b ? a : b);
export type AnyQuoteReadinessOptionsV1 = {
  /** Server configuration only. Never put this key into an API response, URL, evidence or cache key. */
  apiKey?: string;
  rpcs?: readonly [TradeRpcV1, TradeRpcV1];
  fetchImpl?: typeof fetch;
  now?: bigint;
  timeoutMs?: number;
  /** Server-owned adapter: either the official API wire or AnyQuoteV4DiscoveryV1 pool candidates.
   * Discovery never grants execution authority; all keys/state/quotes are independently verified. */
  discoverExternalRoute?: (input: { tokenIn: Address; tokenOut: Address; amountIn: bigint }) => Promise<unknown>;
};

async function fetchJson(url: string, options: AnyQuoteReadinessOptionsV1, body?: unknown) {
  const timeout = Math.min(15_000, Math.max(500, options.timeoutMs ?? 5_000));
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: body === undefined ? "GET" : "POST", cache: "no-store", redirect: "error", signal: controller.signal,
      headers: { Accept: "application/json", ...(body === undefined ? {} : {
        "Content-Type": "application/json", "x-api-key": options.apiKey!, "x-universal-router-version": "2.1.1",
      }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 404 && body !== undefined) throw new AnyQuoteErrorV1("MARKET_ROUTE_UNAVAILABLE");
    if (!response.ok || !response.body || Number(response.headers.get("content-length") ?? 0) > 1_048_576) throw new AnyQuoteErrorV1("PROVIDER_UNAVAILABLE");
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
    try { for (;;) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.length;
      if (length > 1_048_576) { await reader.cancel(); throw new AnyQuoteErrorV1("PROVIDER_RESPONSE_TOO_LARGE"); }
      chunks.push(part.value);
    } } finally { reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof AnyQuoteErrorV1) throw error;
    throw new AnyQuoteErrorV1("PROVIDER_UNAVAILABLE");
  } finally { clearTimeout(timer); }
}

async function context(options: AnyQuoteReadinessOptionsV1) {
  const now = options.now ?? BigInt(Math.floor(Date.now() / 1000));
  const rpcs = options.rpcs ?? productionTradeRpcsV1();
  const agreed = agreedTradeRpcV1(rpcs);
  const chainId = await agreed("eth_chainId", [], value => quantity(value).toString());
  if (chainId !== "4663") throw new AnyQuoteErrorV1("PROVIDER_CHAIN_MISMATCH");
  const heads = await Promise.all(rpcs.map(async rpc => tradeBlockV1(await rpc("eth_getBlockByNumber", ["latest", false]))));
  const height = min(...heads.map(h => BigInt(h.number)));
  const checkpoint = await agreed("eth_getBlockByNumber", [toHex(height), false], tradeBlockV1);
  if (BigInt(checkpoint.timestamp) > now + 10n || now - BigInt(checkpoint.timestamp) > 60n) throw new AnyQuoteErrorV1("PROVIDER_CHECKPOINT_STALE");
  const block = { blockHash: checkpoint.hash, requireCanonical: true };
  // Repeated quote sizes and both directions share immutable reads only within this checkpoint.
  const reads = new Map<string, Promise<unknown>>();
  const cached = <T>(key: string, read: () => Promise<T>): Promise<T> => {
    if (!reads.has(key)) reads.set(key, read());
    return reads.get(key) as Promise<T>;
  };
  const code = async (address: Address) => cached(`code:${address.toLowerCase()}`, () => agreed("eth_getCode", [address, block], bytes));
  const call = async (to: Address, signature: string, args: readonly unknown[] = []) => {
    const abi: Abi = parseAbi([signature]), functionName = /^function ([A-Za-z0-9_]+)/.exec(signature)?.[1];
    if (!functionName) throw new AnyQuoteErrorV1("INVALID_READ_CALL");
    const data = encodeFunctionData({ abi, functionName, args });
    return cached(`call:${to.toLowerCase()}:${data}`, async () => decodeFunctionResult({ abi, functionName, data: await agreed("eth_call", [{ to, data }, block], bytes) }));
  };
  const pin = async (address: Address, hash: Hex) => {
    if (keccak256(await code(address)).toLowerCase() !== hash.toLowerCase()) throw new AnyQuoteErrorV1("INFRASTRUCTURE_RUNTIME_MISMATCH");
  };
  await Promise.all([
    pin(INFRA.universalRouter, INFRA.universalRouterCodeHash), pin(INFRA.poolManager, INFRA.poolManagerCodeHash),
    pin(INFRA.stateView, INFRA.stateViewCodeHash), pin(INFRA.v4Quoter, INFRA.v4QuoterCodeHash),
  ]);
  let discovery: ReturnType<typeof createAnyQuoteV4InitializeDiscoveryV1> | undefined;
  return { now, checkpoint, block, code, call, pin,
    discovery: () => discovery ??= createAnyQuoteV4InitializeDiscoveryV1({ checkpoint, agreed }) };
}
type Context = Awaited<ReturnType<typeof context>>;

/** Every quoted hop is independently identified onchain. Same-block quotes do not simulate
 * state changes shared between different hooks; the final composed transaction must be simulated. */
async function inspectHop(hop: AnyQuoteAmmHopV1, ctx: Context): Promise<AnyQuoteRationalV1> {
  let token0: Address, rawN: bigint, rawD: bigint;
  if (hop.protocol === "V4") {
    const [slot, liquidity] = await Promise.all([
      ctx.call(INFRA.stateView, "function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)", [hop.poolId]),
      ctx.call(INFRA.stateView, "function getLiquidity(bytes32) view returns (uint128)", [hop.poolId]),
    ]);
    const [sqrt] = slot as readonly [bigint, number, number, number];
    if (sqrt === 0n || liquidity === 0n) throw new AnyQuoteErrorV1("MARKET_LIQUIDITY_UNAVAILABLE");
    if (!anyQuoteSameAddressV1(hop.key.hooks, ANY_QUOTE_NATIVE) && await ctx.code(hop.key.hooks) === "0x") throw new AnyQuoteErrorV1("ROUTE_HOOK_MISSING");
    token0 = hop.key.currency0; rawN = sqrt * sqrt; rawD = Q192;
  } else {
    await ctx.pin(hop.protocol === "V3" ? INFRA.v3Factory : INFRA.v2Factory, hop.protocol === "V3" ? INFRA.v3FactoryCodeHash : INFRA.v2FactoryCodeHash);
    const actual = hop.protocol === "V3"
      ? await ctx.call(INFRA.v3Factory, "function getPool(address,address,uint24) view returns (address)", [hop.tokenIn, hop.tokenOut, hop.fee])
      : await ctx.call(INFRA.v2Factory, "function getPair(address,address) view returns (address)", [hop.tokenIn, hop.tokenOut]);
    if (typeof actual !== "string" || !anyQuoteSameAddressV1(actual, hop.pool) || await ctx.code(hop.pool) === "0x") throw new AnyQuoteErrorV1("ROUTE_FACTORY_MISMATCH");
    const [a, b] = await Promise.all([ctx.call(hop.pool, "function token0() view returns (address)"), ctx.call(hop.pool, "function token1() view returns (address)")]);
    token0 = anyQuoteAddressV1(a);
    if (![a, b].every(t => typeof t === "string" && (anyQuoteSameAddressV1(t, hop.tokenIn) || anyQuoteSameAddressV1(t, hop.tokenOut))) || a === b) throw new AnyQuoteErrorV1("ROUTE_POOL_ASSETS_MISMATCH");
    if (hop.protocol === "V3") {
      const [slot, liquidity] = await Promise.all([
        ctx.call(hop.pool, "function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)"),
        ctx.call(hop.pool, "function liquidity() view returns (uint128)"),
      ]);
      const [sqrt] = slot as readonly [bigint];
      if (sqrt === 0n || liquidity === 0n) throw new AnyQuoteErrorV1("MARKET_LIQUIDITY_UNAVAILABLE");
      rawN = sqrt * sqrt; rawD = Q192;
    } else {
      const [reserve0, reserve1] = await ctx.call(hop.pool, "function getReserves() view returns (uint112,uint112,uint32)") as readonly [bigint, bigint, number];
      rawN = reserve1; rawD = reserve0;
    }
  }
  return anyQuoteSameAddressV1(token0, hop.tokenIn) ? anyQuoteRationalV1(rawN, rawD) : anyQuoteRationalV1(rawD, rawN);
}
async function quoteHops(hops: readonly AnyQuoteAmmHopV1[], amountIn: bigint, ctx: Context): Promise<bigint> {
  let amount = amountIn;
  for (const hop of hops) {
    if (amount <= 0n || amount > UINT128_MAX) throw new AnyQuoteErrorV1("QUOTE_AMOUNT_OUTSIDE_ROUTER_RANGE");
    if (hop.protocol === "V4") {
      const k = hop.key;
      const [out] = await ctx.call(INFRA.v4Quoter, "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)", [{
        poolKey: k, zeroForOne: anyQuoteSameAddressV1(hop.tokenIn, k.currency0), exactAmount: amount, hookData: hop.hookData,
      }]) as readonly [bigint, bigint];
      amount = out;
    } else if (hop.protocol === "V3") {
      await ctx.pin(INFRA.v3Quoter, INFRA.v3QuoterCodeHash);
      const path = `${hop.tokenIn}${hop.fee.toString(16).padStart(6, "0")}${hop.tokenOut.slice(2)}`;
      const [out] = await ctx.call(INFRA.v3Quoter, "function quoteExactInput(bytes,uint256) returns (uint256,uint160[],uint32[],uint256)", [path, amount]) as readonly [bigint];
      amount = out;
    } else {
      const [reserves, token0] = await Promise.all([
        ctx.call(hop.pool, "function getReserves() view returns (uint112,uint112,uint32)"), ctx.call(hop.pool, "function token0() view returns (address)"),
      ]);
      const [a, b] = reserves as readonly [bigint, bigint, number];
      const [rIn, rOut] = anyQuoteSameAddressV1(String(token0), hop.tokenIn) ? [a, b] : [b, a];
      if (rIn === 0n || rOut === 0n) throw new AnyQuoteErrorV1("MARKET_LIQUIDITY_UNAVAILABLE");
      amount = amount * 997n * rOut / (rIn * 1000n + amount * 997n);
    }
  }
  if (amount <= 0n || amount > UINT128_MAX) throw new AnyQuoteErrorV1("QUOTE_AMOUNT_OUTSIDE_ROUTER_RANGE");
  return amount;
}

type DiscoveryInput = { tokenIn: Address; tokenOut: Address; amountIn: bigint };
type V4Hop = Extract<AnyQuoteAmmHopV1, { protocol: "V4" }>;
async function boundedMap<T, R>(values: readonly T[], read: (value: T) => Promise<R>) {
  const result: PromiseSettledResult<R>[] = [];
  for (let start = 0; start < values.length; start += 4) result.push(...await Promise.allSettled(values.slice(start, start + 4).map(read)));
  return result;
}

async function chooseNativeCandidate(paths: readonly (readonly V4Hop[])[], input: DiscoveryInput, ctx: Context,
  provider: "uniswap-v4-initialize" | "uniswap-v4-discovery") {
  if (paths.length > ANY_QUOTE_V4_MAX_POOL_CANDIDATES) throw new AnyQuoteErrorV1("V4_DISCOVERY_CANDIDATE_LIMIT");
  const buy = anyQuoteSameAddressV1(input.tokenIn, ANY_QUOTE_WETH);
  const outcomes = await boundedMap(paths, async hops => {
    const expectedIn = buy ? ANY_QUOTE_NATIVE : input.tokenIn, expectedOut = buy ? input.tokenOut : ANY_QUOTE_NATIVE;
    if (hops.length === 0 || !anyQuoteSameAddressV1(hops[0].tokenIn, expectedIn)
      || !anyQuoteSameAddressV1(hops[hops.length - 1].tokenOut, expectedOut)) throw new AnyQuoteErrorV1("V4_DISCOVERY_ROUTE_MISMATCH");
    const seen = new Set([expectedIn.toLowerCase()]);
    for (let i = 0; i < hops.length; i++) {
      if ((i > 0 && !anyQuoteSameAddressV1(hops[i - 1].tokenOut, hops[i].tokenIn)) || seen.has(hops[i].tokenOut.toLowerCase())) throw new AnyQuoteErrorV1("V4_DISCOVERY_ROUTE_MISMATCH");
      seen.add(hops[i].tokenOut.toLowerCase());
    }
    const spots = await Promise.all(hops.map(hop => inspectHop(hop, ctx)));
    const amountOut = await quoteHops(hops, input.amountIn, ctx);
    const route: AnyQuoteExternalRouteV1 = { provider, chainId: 4663, tokenIn: input.tokenIn, tokenOut: input.tokenOut,
      amountIn: input.amountIn.toString(), amountOut: amountOut.toString(), hops, checkpoint: ctx.checkpoint,
      validUntil: (ctx.now + ROUTE_LIFETIME).toString(), evidenceHash: "0x" };
    requireAnyQuoteNativeUnlockRouteV1(route, buy ? "buy" : "sell");
    return { route: { ...route, evidenceHash: anyQuoteEvidenceHashV1({ ...route, evidenceHash: undefined }) },
      spot: spots.reduce(multiplyAnyQuoteRationalsV1, anyQuoteRationalV1(1n, 1n)) };
  });
  return outcomes.flatMap(value => value.status === "fulfilled" ? [value.value] : [])
    .sort((a, b) => BigInt(a.route.amountOut) > BigInt(b.route.amountOut) ? -1 : BigInt(a.route.amountOut) < BigInt(b.route.amountOut) ? 1 : a.route.evidenceHash.localeCompare(b.route.evidenceHash))[0] ?? null;
}

async function discoverNativeV4(input: DiscoveryInput, ctx: Context) {
  const buy = anyQuoteSameAddressV1(input.tokenIn, ANY_QUOTE_WETH), quote = buy ? input.tokenOut : input.tokenIn;
  const discovery = ctx.discovery(), nativePools = await discovery.nativePools(quote);
  const direct = await chooseNativeCandidate(nativePools.map(pool => [anyQuoteV4CandidateHopV1(pool, buy ? ANY_QUOTE_NATIVE : quote)]), input, ctx, "uniswap-v4-initialize");
  if (direct) return direct;
  const adjacent = await discovery.adjacentPools(quote);
  const inspected = await boundedMap(adjacent, async pool => {
    const hop = anyQuoteV4CandidateHopV1(pool, quote);
    if (anyQuoteSameAddressV1(hop.tokenOut, ANY_QUOTE_NATIVE) || anyQuoteSameAddressV1(hop.tokenOut, ANY_QUOTE_WETH)) return null;
    await inspectHop(hop, ctx);
    return { pool, intermediate: hop.tokenOut };
  });
  const live = inspected.flatMap(value => value.status === "fulfilled" && value.value ? [value.value] : []);
  const intermediates = [...new Set(live.map(value => value.intermediate))];
  if (intermediates.length > 8) throw new AnyQuoteErrorV1("V4_DISCOVERY_INTERMEDIATE_LIMIT");
  const native = new Map(await Promise.all(intermediates.map(async asset => [asset, await discovery.nativePools(asset)] as const)));
  const paths = live.flatMap(({ pool, intermediate }) => (native.get(intermediate) ?? []).map(first => buy
    ? [anyQuoteV4CandidateHopV1(first, ANY_QUOTE_NATIVE), anyQuoteV4CandidateHopV1(pool, intermediate)]
    : [anyQuoteV4CandidateHopV1(pool, quote), anyQuoteV4CandidateHopV1(first, intermediate)]));
  const routed = await chooseNativeCandidate(paths, input, ctx, "uniswap-v4-initialize");
  if (!routed) throw new AnyQuoteErrorV1("NATIVE_V4_EXECUTABLE_ROUTE_UNAVAILABLE");
  return routed;
}

async function discover(input: DiscoveryInput, ctx: Context, options: AnyQuoteReadinessOptionsV1) {
  if (anyQuoteSameAddressV1(input.tokenIn, input.tokenOut) && anyQuoteSameAddressV1(input.tokenIn, ANY_QUOTE_WETH)) {
    const value: AnyQuoteExternalRouteV1 = { provider: "weth-identity", chainId: 4663, ...input,
      amountIn: input.amountIn.toString(), amountOut: input.amountIn.toString(), hops: [], checkpoint: ctx.checkpoint,
      validUntil: (ctx.now + ROUTE_LIFETIME).toString(), evidenceHash: "0x" };
    return { route: { ...value, evidenceHash: anyQuoteEvidenceHashV1(value) }, spot: anyQuoteRationalV1(1n, 1n) };
  }
  if (!options.discoverExternalRoute && (!options.apiKey || !/^[\x21-\x7e]{16,512}$/.test(options.apiKey))) return discoverNativeV4(input, ctx);
  const raw = options.discoverExternalRoute ? await options.discoverExternalRoute(input) : await fetchJson(QUOTE_URL, options, {
    type: "EXACT_INPUT", amount: input.amountIn.toString(), tokenInChainId: 4663, tokenOutChainId: 4663,
    tokenIn: input.tokenIn, tokenOut: input.tokenOut, swapper: PROBE_OWNER, recipient: PROBE_OWNER,
    protocols: ["V2", "V3", "V4"], hooksOptions: "V4_HOOKS_INCLUSIVE", routingPreference: "BEST_PRICE", slippageTolerance: 1,
    permitAmount: "EXACT", generatePermitAsTransaction: false,
  });
  if (raw && typeof raw === "object" && "schema" in raw) {
    const discovered = parseAnyQuoteV4DiscoveryV1(raw);
    const result = await chooseNativeCandidate(discovered.routes, input, ctx, "uniswap-v4-discovery");
    if (!result) throw new AnyQuoteErrorV1("NATIVE_V4_EXECUTABLE_ROUTE_UNAVAILABLE");
    return result;
  }
  const parsed = parseAnyQuoteExternalRouteV1(raw, { ...input, checkpoint: ctx.checkpoint, validUntil: ctx.now + ROUTE_LIFETIME });
  requireAnyQuoteNativeUnlockRouteV1(parsed, anyQuoteSameAddressV1(input.tokenIn, ANY_QUOTE_WETH) ? "buy" : "sell");
  const spots = await Promise.all(parsed.hops.map(hop => inspectHop(hop, ctx)));
  const amountOut = await quoteHops(parsed.hops, input.amountIn, ctx);
  const route = { ...parsed, amountOut: amountOut.toString() };
  return { route: { ...route, evidenceHash: anyQuoteEvidenceHashV1({ ...route, evidenceHash: undefined }) },
    spot: spots.reduce(multiplyAnyQuoteRationalsV1, anyQuoteRationalV1(1n, 1n)) };
}

export function validateAnyQuoteFeedRoundV1(input: { roundId: bigint; answer: bigint; updatedAt: bigint; answeredInRound: bigint; decimals: number; heartbeatSeconds: number; now: bigint }) {
  if (input.answer <= 0n || input.roundId <= 0n || input.answeredInRound < input.roundId || input.updatedAt <= 0n || input.updatedAt > input.now
    || !Number.isInteger(input.decimals) || input.decimals < 0 || input.decimals > 36
    || !Number.isInteger(input.heartbeatSeconds) || input.heartbeatSeconds < 1 || input.heartbeatSeconds > 604_800
    || input.now - input.updatedAt > BigInt(input.heartbeatSeconds)) throw new AnyQuoteErrorV1("PRICE_FEED_UNAVAILABLE");
  return anyQuoteRationalV1(input.answer, 10n ** BigInt(input.decimals));
}
async function chainlink(feed: Address, heartbeatSeconds: number, ctx: Context): Promise<AnyQuotePriceEvidenceV1> {
  const [round, decimalValue] = await Promise.all([
    ctx.call(feed, "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"),
    ctx.call(feed, "function decimals() view returns (uint8)"),
  ]);
  const [roundId, answer, , updatedAt, answeredInRound] = round as readonly [bigint, bigint, bigint, bigint, bigint];
  const usd = validateAnyQuoteFeedRoundV1({ roundId, answer, updatedAt, answeredInRound, decimals: Number(decimalValue), heartbeatSeconds, now: ctx.now });
  const validUntil = min(ctx.now + ROUTE_LIFETIME, updatedAt + BigInt(heartbeatSeconds));
  return { usd, source: "chainlink", observedAt: updatedAt.toString(), validUntil: validUntil.toString(), heartbeatSeconds,
    evidenceHash: anyQuoteEvidenceHashV1({ feed, roundId: String(roundId), answer: String(answer), updatedAt: String(updatedAt), checkpoint: ctx.checkpoint, heartbeatSeconds }) };
}

async function trustedPrice(asset: Address, ctx: Context, options: AnyQuoteReadinessOptionsV1): Promise<AnyQuotePriceEvidenceV1 | null> {
  if (anyQuoteSameAddressV1(asset, ANY_QUOTE_WETH)) return chainlink(ETH_USD, 86_400, ctx);
  if (anyQuoteSameAddressV1(asset, ANY_QUOTE_USDG)) return chainlink(USDG_USD, 86_400, ctx);
  // A stock-catalog outage is not evidence against an unrelated ERC20's independent AMM market.
  const catalogValue = await fetchJson(ASSETS_URL, options).catch(() => null);
  if (catalogValue === null) return null;
  const catalog = record(catalogValue);
  if (!Array.isArray(catalog.assets) || catalog.assets.length > 4096) throw new AnyQuoteErrorV1("STOCK_CATALOG_UNAVAILABLE");
  const stock = catalog.assets.map(record).find(a => Array.isArray(a.deployments) && a.deployments.map(record).some(d => Number(d.chainId) === 4663 && typeof d.contractAddress === "string" && anyQuoteSameAddressV1(d.contractAddress, asset)));
  if (!stock) return null;
  const paused = await ctx.call(asset, "function oraclePaused() view returns (bool)");
  if (paused !== false) throw new AnyQuoteErrorV1("STOCK_ORACLE_PAUSED");
  if (typeof stock.tokenSymbol !== "string" || !/^[A-Z0-9.\-]{1,20}$/.test(stock.tokenSymbol)) throw new AnyQuoteErrorV1("STOCK_IDENTITY_UNAVAILABLE");
  // Contract address comes from Robinhood's official registry, never from an ERC20 symbol match.
  try {
    const directory = await fetchJson(FEEDS_URL, options);
    if (!Array.isArray(directory) || directory.length > 4096) throw new AnyQuoteErrorV1("PRICE_DIRECTORY_UNAVAILABLE");
    const feeds = directory.map(record).filter(f => {
      const d = record(f.docs);
      return d.blockchainName === "Robinhood" && d.baseAsset === stock.tokenSymbol && d.quoteAsset === "USD" && d.productTypeCode === "primaryTokenizedPrice";
    });
    if (feeds.length === 1) return await chainlink(anyQuoteAddressV1(feeds[0].proxyAddress), Number(feeds[0].heartbeat), ctx);
  } catch { /* A fresh authoritative stock REST price is a separate, explicitly labelled fallback. */ }
  const rawPrice = await fetchJson(`https://api.robinhood.com/rhj/prices/${encodeURIComponent(stock.tokenSymbol)}`, options);
  const multiplier = await ctx.call(asset, "function uiMultiplier() view returns (uint256)") as bigint;
  const parsed = parseAnyQuoteStockPriceV1(rawPrice, { asset, symbol: stock.tokenSymbol, now: ctx.now, multiplier });
  return { usd: parsed.usd, source: "robinhood-stock-rest", observedAt: parsed.observedAt.toString(), validUntil: min(parsed.observedAt + 60n, ctx.now + ROUTE_LIFETIME).toString(), heartbeatSeconds: 60,
    evidenceHash: anyQuoteEvidenceHashV1({ asset, symbol: stock.tokenSymbol, bid: parsed.bid, ask: parsed.ask, generatedAt: parsed.generatedAt, multiplier: multiplier.toString(), checkpoint: ctx.checkpoint }) };
}

/** Robinhood REST returns a quotes collection, bound by both symbol and deployment identity. */
export function parseAnyQuoteStockPriceV1(value: unknown, input: { asset: Address; symbol: string; now: bigint; multiplier: bigint }) {
  const envelope = record(value);
  if (!Array.isArray(envelope.quotes) || envelope.quotes.length > 4096) throw new AnyQuoteErrorV1("STOCK_PRICE_UNAVAILABLE");
  const matching = envelope.quotes.map(record).filter(price => price.tokenSymbol === input.symbol && Array.isArray(price.deployments)
    && price.deployments.map(record).some(d => Number(d.chainId) === 4663 && typeof d.contractAddress === "string" && anyQuoteSameAddressV1(d.contractAddress, input.asset)));
  if (matching.length !== 1) throw new AnyQuoteErrorV1("STOCK_PRICE_IDENTITY_MISMATCH");
  const price = matching[0];
  if (price.currency !== "USD" || price.isTradingHalt !== false || typeof price.generatedAt !== "string"
    || typeof price.bid !== "string" || typeof price.ask !== "string") throw new AnyQuoteErrorV1("STOCK_PRICE_UNAVAILABLE");
  const stamp = Date.parse(price.generatedAt);
  if (!Number.isFinite(stamp)) throw new AnyQuoteErrorV1("STOCK_PRICE_UNAVAILABLE");
  const observed = BigInt(Math.floor(stamp / 1000));
  if (observed > input.now || input.now - observed > 60n) throw new AnyQuoteErrorV1("STOCK_PRICE_STALE");
  const bid = parseAnyQuoteDecimalV1(price.bid), ask = parseAnyQuoteDecimalV1(price.ask);
  const bn = BigInt(bid.numerator), bd = BigInt(bid.denominator), an = BigInt(ask.numerator), ad = BigInt(ask.denominator);
  if (bn * ad > an * bd || (an * bd - bn * ad) * 10_000n > bn * ad * 200n) throw new AnyQuoteErrorV1("STOCK_SPREAD_UNAVAILABLE");
  const usd = multiplyAnyQuoteRationalsV1(anyQuoteRationalV1(bn * ad + an * bd, 2n * bd * ad), anyQuoteRationalV1(input.multiplier, 10n ** 18n));
  return { usd, observedAt: observed, bid: price.bid, ask: price.ask, generatedAt: price.generatedAt };
}

/** Compare execution prices per unit across sizes, so constant pool/hook fees cancel.
 * This is an instantaneous depth qualification, not a TWAP or a token security certification. */
export function qualifyAnyQuoteDepthV1(smallIn: bigint, smallOut: bigint, largeIn: bigint, largeOut: bigint) {
  if (smallIn <= 0n || smallOut <= 0n || largeIn <= smallIn || largeOut <= 0n) throw new AnyQuoteErrorV1("MARKET_DEPTH_UNAVAILABLE");
  const base = smallOut * largeIn, observed = largeOut * smallIn;
  const difference = base > observed ? base - observed : observed - base;
  if (difference * 10_000n > base * 200n) throw new AnyQuoteErrorV1("MARKET_PRICE_IMPACT_TOO_HIGH");
}

export async function assessAnyQuoteAssetV1(input: { quoteAsset: string; probeEthAmount?: bigint }, options: AnyQuoteReadinessOptionsV1 = {}): Promise<AnyQuoteReadinessV1> {
  let quoteAsset: Address | null = null;
  try {
    quoteAsset = anyQuoteAddressV1(input.quoteAsset);
    const ctx = await context(options);
    if (await ctx.code(quoteAsset) === "0x") throw new AnyQuoteErrorV1("TOKEN_CONTRACT_NOT_FOUND", "incompatible");
    const [decimalsValue, totalSupply, name, symbol] = await Promise.all([
      ctx.call(quoteAsset, "function decimals() view returns (uint8)"), ctx.call(quoteAsset, "function totalSupply() view returns (uint256)"),
      ctx.call(quoteAsset, "function name() view returns (string)").catch(() => "Token"), ctx.call(quoteAsset, "function symbol() view returns (string)").catch(() => "ERC20"),
    ]);
    const decimals = Number(decimalsValue);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new AnyQuoteErrorV1("UNSUPPORTED_TOKEN_DECIMALS", "incompatible");
    if (typeof totalSupply !== "bigint" || totalSupply === 0n) throw new AnyQuoteErrorV1("TOKEN_SUPPLY_UNAVAILABLE");
    const [ethPrice, authoritative] = await Promise.all([chainlink(ETH_USD, 86_400, ctx), trustedPrice(quoteAsset, ctx, options)]);
    const referenceEth = 10n ** 18n * BigInt(ethPrice.usd.denominator) / BigInt(ethPrice.usd.numerator);
    const probe = input.probeEthAmount ?? referenceEth;
    if (probe <= 0n || probe > 10n ** 19n) throw new AnyQuoteErrorV1("INVALID_PROBE_AMOUNT");
    const { route: buy, spot } = await discover({ tokenIn: ANY_QUOTE_WETH, tokenOut: quoteAsset, amountIn: probe }, ctx, options);
    const { route: sell } = await discover({ tokenIn: quoteAsset, tokenOut: ANY_QUOTE_WETH, amountIn: BigInt(buy.amountOut) }, ctx, options);
    requireAnyQuoteNativeUnlockRouteV1(buy, "buy");
    requireAnyQuoteNativeUnlockRouteV1(sell, "sell");
    const marketUsd = multiplyAnyQuoteRationalsV1(ethPrice.usd, anyQuoteRationalV1(BigInt(spot.denominator) * 10n ** BigInt(decimals), BigInt(spot.numerator) * 10n ** 18n));
    if (authoritative) {
      // Compare fee-free pool spot against the reference. Swap/hook fees are already in the quotes.
      const market = BigInt(marketUsd.numerator) * BigInt(authoritative.usd.denominator);
      const reference = BigInt(authoritative.usd.numerator) * BigInt(marketUsd.denominator);
      const difference = market > reference ? market - reference : reference - market;
      if (difference * 10_000n > reference * 1_000n) throw new AnyQuoteErrorV1("REFERENCE_MARKET_PRICE_DISAGREEMENT");
    }
    let price = authoritative;
    if (price === null) {
      const smallIn = referenceEth, largeIn = referenceEth * 100n;
      const smallOut = await quoteHops(buy.hops, smallIn, ctx);
      const [largeOut, reverseSmall, reverseLarge] = await Promise.all([
        quoteHops(buy.hops, largeIn, ctx), quoteHops(sell.hops, smallOut, ctx), quoteHops(sell.hops, smallOut * 100n, ctx),
      ]);
      qualifyAnyQuoteDepthV1(smallIn, smallOut, largeIn, largeOut);
      qualifyAnyQuoteDepthV1(smallOut, reverseSmall, smallOut * 100n, reverseLarge);
      const usd = marketUsd;
      price = { usd, source: "qualified-amm", observedAt: ctx.checkpoint.timestamp, validUntil: min(ctx.now + ROUTE_LIFETIME, BigInt(ethPrice.validUntil)).toString(), heartbeatSeconds: 45,
        evidenceHash: anyQuoteEvidenceHashV1({ policy: "any-quote.depth-usd-1-100.impact-200bps.v1", spot, ethPrice, checkpoint: ctx.checkpoint,
          buy: buy.evidenceHash, sell: sell.evidenceHash, smallIn: smallIn.toString(), smallOut: smallOut.toString(), largeIn: largeIn.toString(), largeOut: largeOut.toString(),
          reverseSmall: reverseSmall.toString(), reverseLarge: reverseLarge.toString(), feeTreatment: "Pool spot price excludes swap fees; execution probes include all observed pool and hook fees." }) };
    }
    const validUntil = min(BigInt(price.validUntil), BigInt(buy.validUntil), BigInt(sell.validUntil));
    if (validUntil <= ctx.now) throw new AnyQuoteErrorV1("READINESS_EXPIRED");
    const evidenceHash = anyQuoteEvidenceHashV1({ schema: "any-quote.readiness.v1", quoteAsset, decimals, checkpoint: ctx.checkpoint, price, buy: buy.evidenceHash, sell: sell.evidenceHash });
    return { status: "compatible", chainId: 4663, quoteAsset, token: { decimals,
      name: typeof name === "string" ? name.slice(0, 128) : "Token", symbol: typeof symbol === "string" ? symbol.slice(0, 32) : "ERC20" },
      checkpoint: ctx.checkpoint, price, routes: { buy, sell }, validUntil: validUntil.toString(), evidenceHash,
      checks: { codeAndMetadata: "verified", routePools: "verified-at-checkpoint", externalQuotes: "same-block-bidirectional", fullExecution: "required-before-signing" } };
  } catch (error) {
    const known = error instanceof AnyQuoteErrorV1 ? error : new AnyQuoteErrorV1("PROVIDER_OR_EXECUTION_INCONCLUSIVE");
    return { status: known.status, chainId: 4663, quoteAsset, code: known.code, retryable: known.status === "inconclusive" };
  }
}

/** Requote one previously validated topology for the exact current trade amount. */
export async function requoteAnyQuoteExternalRouteV1(route: AnyQuoteExternalRouteV1, amountIn: bigint, options: AnyQuoteReadinessOptionsV1 = {}) {
  validateAnyQuoteExternalRouteV1(route);
  anyQuoteUintV1(amountIn.toString(), UINT128_MAX);
  const ctx = await context(options);
  await Promise.all(route.hops.map(hop => inspectHop(hop, ctx)));
  const amountOut = await quoteHops(route.hops, amountIn, ctx);
  const result = { ...route, amountIn: amountIn.toString(), amountOut: amountOut.toString(), checkpoint: ctx.checkpoint, validUntil: (ctx.now + ROUTE_LIFETIME).toString() };
  return { ...result, evidenceHash: anyQuoteEvidenceHashV1({ ...result, evidenceHash: undefined }) };
}
