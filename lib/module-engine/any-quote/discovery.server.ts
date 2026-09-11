import "server-only";
import { decodeEventLog, keccak256, pad, parseAbi, stringToHex, toHex, type Address, type Hex } from "viem";
import { canonicalBrowserJsonV2 } from "@/lib/custom-launch/browser-authority-v2";
import { agreedTradeRpcV1, type TradeRpcV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";
import { anyQuotePoolIdV1 } from "./route";
import {
  ANY_QUOTE_INFRASTRUCTURE, ANY_QUOTE_NATIVE, AnyQuoteErrorV1, anyQuoteAddressV1, anyQuoteSameAddressV1,
  type AnyQuoteAmmHopV1, type AnyQuoteCheckpointV1, type AnyQuoteV4DiscoveryV1, type AnyQuoteV4PoolCandidateV1,
} from "./types";

// Official Uniswap v4-subgraph networks.json, robinhood-mainnet.PoolManager.startBlock.
// The existing application's Graph deployment is Ethereum-only and is not a Robinhood binding.
// https://github.com/Uniswap/v4-subgraph/blob/main/networks.json
export const ANY_QUOTE_V4_START_BLOCK = 9070n;
export const ANY_QUOTE_V4_MAX_POOL_CANDIDATES = 64;
const MAX_LOG_REQUESTS = 24;
const MAX_RANGE_SPLITS = 2;
const MAX_VERIFICATION_BLOCKS = 10_000n;
const initializeAbi = parseAbi(["event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)"]);
const initializeTopic = keccak256(stringToHex("Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)"));
type PoolRecord = AnyQuoteV4PoolCandidateV1 & { blockNumber: string; blockHash: Hex; logIndex: string; sqrtPriceX96: string; tick: number };
const invalid = (): never => { throw new AnyQuoteErrorV1("V4_DISCOVERY_RESPONSE_INVALID"); };
const quantity = (value: unknown) => typeof value === "string" && /^0x[0-9a-f]{1,64}$/i.test(value) ? BigInt(value) : invalid();

/** Decode the indexed Initialize wire without trusting a provider-supplied PoolId or address.
 * Canonical records are compared across independent providers before use. */
export function parseAnyQuoteV4InitializeV1(value: unknown, input: {
  currency: Address; otherCurrency?: Address; fromBlock: bigint; toBlock: bigint;
}): PoolRecord[] {
  if (!Array.isArray(value) || value.length > ANY_QUOTE_V4_MAX_POOL_CANDIDATES) return invalid();
  try {
    const result = value.map((raw): PoolRecord => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
      const log = raw as Record<string, unknown>;
      if (typeof log.address !== "string" || !anyQuoteSameAddressV1(log.address, ANY_QUOTE_INFRASTRUCTURE.poolManager)
        || log.removed !== false || typeof log.data !== "string" || !/^0x[0-9a-f]{320}$/i.test(log.data)
        || !Array.isArray(log.topics) || log.topics.length !== 4 || log.topics.some(t => typeof t !== "string" || !/^0x[0-9a-f]{64}$/i.test(t))
        || typeof log.blockHash !== "string" || !/^0x[0-9a-f]{64}$/i.test(log.blockHash)) return invalid();
      const blockNumber = quantity(log.blockNumber), logIndex = quantity(log.logIndex);
      if (blockNumber < input.fromBlock || blockNumber > input.toBlock) return invalid();
      const { args } = decodeEventLog({ abi: initializeAbi, eventName: "Initialize", data: log.data as Hex, topics: log.topics as [Hex, ...Hex[]], strict: true });
      const key = { currency0: anyQuoteAddressV1(args.currency0, true), currency1: anyQuoteAddressV1(args.currency1, true),
        fee: args.fee, tickSpacing: args.tickSpacing, hooks: anyQuoteAddressV1(args.hooks, true) };
      const has = (currency: Address) => anyQuoteSameAddressV1(key.currency0, currency) || anyQuoteSameAddressV1(key.currency1, currency);
      if (!has(input.currency) || (input.otherCurrency !== undefined && !has(input.otherCurrency))
        || anyQuotePoolIdV1(key).toLowerCase() !== args.id.toLowerCase()) return invalid();
      return { poolId: args.id.toLowerCase() as Hex, key, blockNumber: blockNumber.toString(), logIndex: logIndex.toString(),
        blockHash: log.blockHash.toLowerCase() as Hex, sqrtPriceX96: args.sqrtPriceX96.toString(), tick: args.tick };
    });
    if (new Set(result.map(pool => pool.poolId)).size !== result.length) return invalid();
    return result.sort((a, b) => a.poolId.localeCompare(b.poolId));
  } catch { return invalid(); }
}

export function anyQuoteV4CandidateHopV1(pool: AnyQuoteV4PoolCandidateV1, tokenIn: Address): Extract<AnyQuoteAmmHopV1, { protocol: "V4" }> {
  const key = pool.key;
  if (!anyQuoteSameAddressV1(tokenIn, key.currency0) && !anyQuoteSameAddressV1(tokenIn, key.currency1)) return invalid();
  return { protocol: "V4", tokenIn, tokenOut: anyQuoteSameAddressV1(tokenIn, key.currency0) ? key.currency1 : key.currency0,
    poolId: pool.poolId, key, hookData: "0x" };
}

/** Typed graph/index callbacks cannot supply quotes, calldata or a different chain binding. */
export function parseAnyQuoteV4DiscoveryV1(value: unknown): AnyQuoteV4DiscoveryV1 {
  try {
    if (!value || typeof value !== "object") return invalid();
    const root = value as AnyQuoteV4DiscoveryV1;
    if (root.schema !== "programmable.any-quote.v4-candidates.v1" || root.chainId !== 4663
      || !anyQuoteSameAddressV1(root.poolManager, ANY_QUOTE_INFRASTRUCTURE.poolManager)
      || !Array.isArray(root.routes) || root.routes.length > ANY_QUOTE_V4_MAX_POOL_CANDIDATES) return invalid();
    const routes = root.routes.map(path => {
      if (!Array.isArray(path) || path.length < 1 || path.length > 4) return invalid();
      return path.map((hop): Extract<AnyQuoteAmmHopV1, { protocol: "V4" }> => {
        if (!hop || hop.protocol !== "V4" || typeof hop.poolId !== "string" || !/^0x[0-9a-f]{64}$/i.test(hop.poolId)
          || anyQuotePoolIdV1(hop.key).toLowerCase() !== hop.poolId.toLowerCase()
          || typeof hop.hookData !== "string" || !/^0x(?:[0-9a-f]{2}){0,2048}$/i.test(hop.hookData)) return invalid();
        const tokenIn = anyQuoteAddressV1(hop.tokenIn, true), tokenOut = anyQuoteAddressV1(hop.tokenOut, true);
        const normalized = anyQuoteV4CandidateHopV1(hop, tokenIn);
        if (!anyQuoteSameAddressV1(normalized.tokenOut, tokenOut)) return invalid();
        return { ...normalized, hookData: hop.hookData };
      });
    });
    return { schema: root.schema, chainId: 4663, poolManager: ANY_QUOTE_INFRASTRUCTURE.poolManager, routes };
  } catch { return invalid(); }
}

/** A full-range response from one provider supplies discovery hints only. Both original
 * providers must independently agree on every hinted log in bounded canonical block ranges.
 * This verifies candidates, not index completeness; absent hints never prove no market.
 * Buy/sell and intermediate searches share one checkpoint, cache and request budget. */
export function createAnyQuoteV4InitializeDiscoveryV1(input: { checkpoint: AnyQuoteCheckpointV1; rpcs: readonly [TradeRpcV1, TradeRpcV1] }) {
  const toBlock = BigInt(input.checkpoint.number);
  if (toBlock < ANY_QUOTE_V4_START_BLOCK) throw new AnyQuoteErrorV1("V4_DISCOVERY_CHECKPOINT_UNAVAILABLE");
  let requests = 0;
  let incompleteCoverage = false;
  const agreed = agreedTradeRpcV1(input.rpcs);
  const cache = new Map<string, Promise<PoolRecord[]>>();
  const reserveRequest = () => {
    if (++requests > MAX_LOG_REQUESTS) throw new AnyQuoteErrorV1("V4_DISCOVERY_REQUEST_LIMIT");
  };
  const requireSame = (a: PoolRecord[], b: PoolRecord[]) => {
    if (canonicalBrowserJsonV2(a) !== canonicalBrowserJsonV2(b)) throw new AnyQuoteErrorV1("V4_DISCOVERY_PROVIDER_DISAGREEMENT");
  };
  const filter = (topics: readonly (Hex | null)[], fromBlock: bigint, end: bigint) =>
    [{ address: ANY_QUOTE_INFRASTRUCTURE.poolManager, fromBlock: toHex(fromBlock), toBlock: toHex(end), topics }];
  const verifyHints = async (hints: PoolRecord[], currency: Address, otherCurrency: Address | undefined, topics: readonly (Hex | null)[]) => {
    incompleteCoverage = true;
    // A single-provider empty result may prompt an intermediate search, never an incompatibility verdict.
    const windows: PoolRecord[][] = [];
    for (const hint of [...hints].sort((a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)))) {
      const last = windows.at(-1);
      if (last && BigInt(hint.blockNumber) - BigInt(last[0].blockNumber) < MAX_VERIFICATION_BLOCKS) last.push(hint);
      else windows.push([hint]);
    }
    if (requests + windows.length > MAX_LOG_REQUESTS) throw new AnyQuoteErrorV1("V4_DISCOVERY_REQUEST_LIMIT");
    const result: PoolRecord[] = [];
    for (let start = 0; start < windows.length; start += 4) result.push(...(await Promise.all(windows.slice(start, start + 4).map(async window => {
      reserveRequest();
      const fromBlock = BigInt(window[0].blockNumber), end = BigInt(window[window.length - 1].blockNumber);
      let verified: PoolRecord[];
      try {
        verified = await agreed("eth_getLogs", filter(topics, fromBlock, end),
          value => parseAnyQuoteV4InitializeV1(value, { currency, otherCurrency, fromBlock, toBlock: end }));
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
        throw new AnyQuoteErrorV1(code === "TRADE_PROVIDER_DISAGREEMENT" ? "V4_DISCOVERY_PROVIDER_DISAGREEMENT" : "V4_DISCOVERY_PROVIDER_UNAVAILABLE");
      }
      requireSame(verified, window.sort((a, b) => a.poolId.localeCompare(b.poolId)));
      return verified;
    }))).flat());
    return result.sort((a, b) => a.poolId.localeCompare(b.poolId));
  };
  const readRange = async (currency: Address, otherCurrency: Address | undefined, topics: readonly (Hex | null)[], fromBlock: bigint, end: bigint, depth = 0): Promise<PoolRecord[]> => {
    reserveRequest();
    const responses = await Promise.allSettled(input.rpcs.map(rpc => rpc("eth_getLogs", filter(topics, fromBlock, end))));
    // Invalid successful responses are terminal, not provider outages eligible for fallback.
    const records = responses.map(response => response.status === "fulfilled"
      ? parseAnyQuoteV4InitializeV1(response.value, { currency, otherCurrency, fromBlock, toBlock: end }) : null);
    if (records[0] !== null && records[1] !== null) { requireSame(records[0], records[1]); return records[0]; }
    const hints = records[0] ?? records[1];
    if (hints !== null) return verifyHints(hints, currency, otherCurrency, topics);
    if (depth >= MAX_RANGE_SPLITS || fromBlock === end) throw new AnyQuoteErrorV1("V4_DISCOVERY_PROVIDER_UNAVAILABLE");
    const middle = (fromBlock + end) / 2n;
    const result = (await Promise.all([
      readRange(currency, otherCurrency, topics, fromBlock, middle, depth + 1),
      readRange(currency, otherCurrency, topics, middle + 1n, end, depth + 1),
    ])).flat();
    if (result.length > ANY_QUOTE_V4_MAX_POOL_CANDIDATES) throw new AnyQuoteErrorV1("V4_DISCOVERY_CANDIDATE_LIMIT");
    return result;
  };
  const pools = (currency: Address, otherCurrency?: Address): Promise<PoolRecord[]> => {
    const key = `${currency.toLowerCase()}:${otherCurrency?.toLowerCase() ?? "*"}`;
    let pending = cache.get(key);
    if (!pending) {
      const topic = pad(currency);
      const filters: (Hex | null)[][] = otherCurrency === undefined
        ? [[initializeTopic, null, topic], [initializeTopic, null, null, topic]]
        : BigInt(currency) < BigInt(otherCurrency)
          ? [[initializeTopic, null, topic, pad(otherCurrency)]] : [[initializeTopic, null, pad(otherCurrency), topic]];
      pending = Promise.all(filters.map(topics => readRange(currency, otherCurrency, topics, ANY_QUOTE_V4_START_BLOCK, toBlock))).then(parts => {
        const result = parts.flat();
        if (result.length > ANY_QUOTE_V4_MAX_POOL_CANDIDATES) throw new AnyQuoteErrorV1("V4_DISCOVERY_CANDIDATE_LIMIT");
        return result.sort((a, b) => a.poolId.localeCompare(b.poolId));
      });
      cache.set(key, pending);
    }
    return pending;
  };
  return { nativePools: (currency: Address) => pools(currency, ANY_QUOTE_NATIVE), adjacentPools: (currency: Address) => pools(currency),
    hasIncompleteCoverage: () => incompleteCoverage };
}
