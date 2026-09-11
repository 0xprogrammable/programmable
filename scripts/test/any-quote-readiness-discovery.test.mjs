import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, keccak256, parseAbi, parseAbiParameters, toHex } from "viem";

const root = resolve(import.meta.dirname, "../..");
// Deterministic RPC fixtures have their own pinned bytecode profile. Production code and its
// runtime verification remain unchanged; the separate route-runtime test executes real contracts.
const profile = JSON.parse(await readFile(resolve(root, "contracts/spec/robinhood-custom-launch/chain-4663.v1.json"), "utf8"));
const fixtureCode = new Map();
for (const [index, name] of ["universalRouter", "poolManager", "stateView", "v4Quoter"].entries()) {
  const contract = profile.contracts.uniswap[name], code = `0x60${String(index + 1).padStart(2, "0")}600055`;
  fixtureCode.set(contract.address.toLowerCase(), code);
  contract.runtimeCodeHash = keccak256(code);
}
const bundled = await build({ absWorkingDir: root, stdin: { contents: ["types", "route", "discovery.server", "readiness.server"].map(name => `export * from './lib/module-engine/any-quote/${name}'`).join("\n") + "; export { agreedTradeRpcV1 } from './lib/server/custom-launch/routed-trade-rpc-v1'", resolveDir: root },
  bundle: true, format: "cjs", platform: "node", packages: "external", write: false,
  plugins: [{ name: "fixture-environment", setup(b) {
    b.onResolve({ filter: /^server-only$/ }, () => ({ path: "empty", namespace: "empty" }));
    b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "" }));
    b.onLoad({ filter: /chain-4663\.v1\.json$/ }, () => ({ contents: JSON.stringify(profile), loader: "json" }));
  } }],
});
const loaded = { exports: {} };
new Function("require", "module", "exports", bundled.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const a = loaded.exports;
const Q = "0x7100000000000000000000000000000000000000", MID = "0x4300000000000000000000000000000000000000";
const OTHER = "0x2200000000000000000000000000000000000000";
const ZERO = a.ANY_QUOTE_NATIVE;
const HASH = `0x${"aa".repeat(32)}`, NOW = 1_000_000n, HEIGHT = 20_000n;
const checkpoint = { number: String(HEIGHT), hash: HASH, timestamp: String(NOW) };
const initializeAbi = parseAbi(["event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)"]);
const readAbi = parseAbi([
  "function decimals() view returns (uint8)", "function totalSupply() view returns (uint256)", "function name() view returns (string)", "function symbol() view returns (string)",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)", "function getLiquidity(bytes32) view returns (uint128)",
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
]);
function pool(x = ZERO, y = Q, { fee = 0, liquidity = 10n ** 24n, hook = ZERO, block = 10_000n } = {}) {
  const key = { currency0: BigInt(x) < BigInt(y) ? x : y, currency1: BigInt(x) < BigInt(y) ? y : x, fee, tickSpacing: 60, hooks: hook };
  return { key, poolId: a.anyQuotePoolIdV1(key), liquidity, block };
}
function log(p, index = 0) {
  return { address: a.ANY_QUOTE_INFRASTRUCTURE.poolManager, removed: false, blockNumber: toHex(p.block), blockHash: HASH, logIndex: toHex(index),
    topics: encodeEventTopics({ abi: initializeAbi, eventName: "Initialize", args: { id: p.poolId, currency0: p.key.currency0, currency1: p.key.currency1 } }),
    data: encodeAbiParameters(parseAbiParameters("uint24,int24,address,uint160,int24"), [p.key.fee, p.key.tickSpacing, p.key.hooks, 1n << 96n, 0]) };
}
const filterLogs = (logs, filter) => logs.filter(item => BigInt(item.blockNumber) >= BigInt(filter.fromBlock) && BigInt(item.blockNumber) <= BigInt(filter.toBlock)
  && filter.topics.every((topic, i) => topic === null || topic.toLowerCase() === item.topics[i].toLowerCase()));
function fixture(pools, options = {}) {
  const calls = [], records = pools.map(log);
  const rpcs = [0, 1].map(provider => async (method, params) => {
    calls.push({ provider, method, params });
    if (options.override) {
      const result = await options.override({ provider, method, params });
      if (result !== undefined) return result;
    }
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_getBlockByNumber") return { number: toHex(options.height ?? HEIGHT), hash: HASH, timestamp: toHex(NOW) };
    if (method === "eth_getCode") return fixtureCode.get(params[0].toLowerCase()) ?? "0x600055";
    if (method === "eth_getLogs") return filterLogs(records, params[0]);
    if (method !== "eth_call") throw Error("Unexpected fixture RPC method");
    const { functionName, args } = decodeFunctionData({ abi: readAbi, data: params[0].data });
    let result;
    if (functionName === "decimals") result = params[0].to.toLowerCase() === "0x78f3556b67e17df817d51ef5a990cdaf09e8d3a9" ? 8 : 18;
    else if (functionName === "totalSupply") result = 10n ** 30n;
    else if (functionName === "name") result = "Fixture asset";
    else if (functionName === "symbol") result = "Q";
    else if (functionName === "latestRoundData") result = [1n, 2500n * 10n ** 8n, NOW, NOW, 1n];
    else if (functionName === "getSlot0") result = [1n << 96n, 0, 0, 0];
    else if (functionName === "getLiquidity") result = pools.find(p => p.poolId.toLowerCase() === args[0].toLowerCase())?.liquidity ?? 0n;
    else if (functionName === "quoteExactInputSingle") {
      const params = args[0], actual = pools.find(p => p.poolId.toLowerCase() === a.anyQuotePoolIdV1(params.poolKey).toLowerCase());
      if (!actual || actual.liquidity === 0n) throw Error("No executable fixture pool");
      result = [params.exactAmount * 99n / 100n, 100_000n];
    } else throw Error("Unexpected fixture read");
    return encodeFunctionResult({ abi: readAbi, functionName, result });
  });
  const fetchImpl = async url => {
    assert.equal(url, "https://api.robinhood.com/rhj/assets", "No Trading API call or credential is needed");
    return new Response(JSON.stringify({ assets: [] }), { status: 200 });
  };
  return { calls, rpcs, options: { now: NOW, rpcs, fetchImpl } };
}

test("Initialize records bind the real key, indexed asset, manager and canonical range", () => {
  const p = pool(), raw = log(p), expected = { currency: Q, otherCurrency: ZERO, fromBlock: 9070n, toBlock: HEIGHT };
  assert.deepEqual(a.parseAnyQuoteV4InitializeV1([raw], expected)[0].key, p.key);
  for (const invalid of [
    { ...raw, address: OTHER }, { ...raw, removed: true }, { ...raw, blockNumber: toHex(HEIGHT + 1n) },
    { ...raw, topics: [raw.topics[0], HASH, ...raw.topics.slice(2)] }, { ...raw, data: "0x00" },
  ]) assert.throws(() => a.parseAnyQuoteV4InitializeV1([invalid], expected), error => error.code === "V4_DISCOVERY_RESPONSE_INVALID" && error.status === "inconclusive");
  assert.throws(() => a.parseAnyQuoteV4InitializeV1([raw], { ...expected, currency: OTHER }));
  assert.throws(() => a.parseAnyQuoteV4InitializeV1([raw, raw], expected));
});

test("request-local discovery uses both providers and caches direct-pair logs for reverse routes", async () => {
  const f = fixture([pool()]), discovery = a.createAnyQuoteV4InitializeDiscoveryV1({ checkpoint, rpcs: f.rpcs });
  const [first, second] = await Promise.all([discovery.nativePools(Q), discovery.nativePools(Q)]);
  assert.deepEqual(first, second); assert.equal(first.length, 1);
  assert.equal(f.calls.length, 2); assert.deepEqual(f.calls.map(c => c.provider), [0, 1]);
  assert.equal(BigInt(f.calls[0].params[0].fromBlock), 9070n);
  assert.equal(BigInt(f.calls[0].params[0].toBlock), HEIGHT);
});

test("provider range limits split complete bounded ranges; failures and disagreement remain inconclusive", async () => {
  const f = fixture([pool()], { override: ({ method, params }) => { if (method === "eth_getLogs" && BigInt(params[0].toBlock) - BigInt(params[0].fromBlock) > 6000n) throw Error("range limit"); } });
  const discovery = a.createAnyQuoteV4InitializeDiscoveryV1({ checkpoint, rpcs: f.rpcs });
  assert.equal((await discovery.nativePools(Q)).length, 1);
  assert.equal(f.calls.length, 6);
  const failed = fixture([], { override: () => { throw Error("Private provider details must not leak"); } });
  await assert.rejects(() => a.createAnyQuoteV4InitializeDiscoveryV1({ checkpoint, rpcs: failed.rpcs }).nativePools(Q),
    error => error.code === "V4_DISCOVERY_PROVIDER_UNAVAILABLE" && error.status === "inconclusive");
  assert.ok(failed.calls.length <= 14);
  const disagree = fixture([pool()], { override: ({ provider }) => provider === 1 ? [] : undefined });
  await assert.rejects(() => a.createAnyQuoteV4InitializeDiscoveryV1({ checkpoint, rpcs: disagree.rpcs }).nativePools(Q), /V4_DISCOVERY_PROVIDER_DISAGREEMENT/);
  assert.equal(disagree.calls.length, 2);
});

const LONG_HEIGHT = 60_000_000n;
const longCheckpoint = { ...checkpoint, number: String(LONG_HEIGHT) };
const wideRange = params => BigInt(params[0].toBlock) - BigInt(params[0].fromBlock) >= 10_000n;
function quickNodeRangeLimit({ provider, method, params }) {
  if (provider === 0 && method === "eth_getLogs" && wideRange(params)) {
    throw Object.assign(Error("eth_getLogs is limited to a 10,000 range"), { status: 413, code: -32614 });
  }
}

test("60-million-block discovery verifies single-provider hints through both original RPCs in 10,000-block windows", async () => {
  const f = fixture([pool(), pool(ZERO, Q, { fee: 500, block: 19_999n }), pool(ZERO, Q, { fee: 3000, block: 50_000_000n })], { override: quickNodeRangeLimit });
  const discovery = a.createAnyQuoteV4InitializeDiscoveryV1({ checkpoint: longCheckpoint, rpcs: f.rpcs });
  const result = await discovery.nativePools(Q);
  assert.equal(result.length, 3);
  assert.equal(discovery.hasIncompleteCoverage(), true, "Verified candidates do not certify single-source index completeness");
  assert.equal(f.calls.length, 6, "One full-range attempt and two shared verification windows, each on both providers");
  const verifications = f.calls.slice(2);
  assert.ok(verifications.every(c => !wideRange(c.params)));
  assert.deepEqual(verifications.map(c => c.provider), [0, 1, 0, 1]);
  assert.deepEqual(await discovery.nativePools(Q), result);
  assert.equal(f.calls.length, 6, "Reverse discovery reuses verified records");
});

test("invented hints and narrow-range provider disagreement fail closed without another fallback", async () => {
  const p = pool(), real = log(p);
  for (const override of [
    info => { quickNodeRangeLimit(info); if (info.provider === 1 && wideRange(info.params)) return [{ ...real, blockHash: `0x${"bb".repeat(32)}` }]; },
    info => { quickNodeRangeLimit(info); if (info.provider === 0) return []; },
  ]) {
    const f = fixture([p], { override });
    await assert.rejects(() => a.createAnyQuoteV4InitializeDiscoveryV1({ checkpoint: longCheckpoint, rpcs: f.rpcs }).nativePools(Q),
      error => error.code === "V4_DISCOVERY_PROVIDER_DISAGREEMENT" && error.status === "inconclusive");
    assert.equal(f.calls.length, 4, "A rejected hint or disagreement cannot fall back to a preferred provider");
  }
  const disagree = fixture([p], { override: ({ provider }) => provider === 0 ? [] : undefined });
  await assert.rejects(() => a.createAnyQuoteV4InitializeDiscoveryV1({ checkpoint: longCheckpoint, rpcs: disagree.rpcs }).nativePools(Q), /V4_DISCOVERY_PROVIDER_DISAGREEMENT/);
  assert.equal(disagree.calls.length, 2, "Full-range disagreement is also terminal");
});

test("malformed successful responses are never treated as unavailable providers or accepted hints", async () => {
  for (const provider of [0, 1]) {
    const f = fixture([pool()], { override: info => {
      if (info.provider === provider) return [{ ...log(pool()), data: "0x00" }];
      quickNodeRangeLimit(info);
    } });
    await assert.rejects(() => a.createAnyQuoteV4InitializeDiscoveryV1({ checkpoint: longCheckpoint, rpcs: f.rpcs }).nativePools(Q),
      error => error.code === "V4_DISCOVERY_RESPONSE_INVALID" && error.status === "inconclusive");
    assert.equal(f.calls.length, 2);
  }
});

test("hint verification retains the fixed request budget and never accepts an unverified pool", async () => {
  const f = fixture(Array.from({ length: 24 }, (_, i) => pool(ZERO, Q, { fee: i * 500, block: 10_000n + BigInt(i) * 10_000n })), { override: quickNodeRangeLimit });
  await assert.rejects(() => a.createAnyQuoteV4InitializeDiscoveryV1({ checkpoint: longCheckpoint, rpcs: f.rpcs }).nativePools(Q),
    error => error.code === "V4_DISCOVERY_REQUEST_LIMIT" && error.status === "inconclusive");
  assert.equal(f.calls.length, 2, "An over-budget hint set stops before requesting verification windows");
});

test("empty direct hints still allow an independently verified indirect route; empty coverage stays inconclusive", async () => {
  const options = { height: LONG_HEIGHT, override: quickNodeRangeLimit };
  const f = fixture([pool(ZERO, MID), pool(MID, Q)], options);
  const result = await a.assessAnyQuoteAssetV1({ quoteAsset: Q }, f.options);
  assert.equal(result.status, "compatible", JSON.stringify(result));
  assert.deepEqual(result.routes.buy.hops.map(h => h.tokenOut.toLowerCase()), [MID, Q].map(x => x.toLowerCase()));
  assert.deepEqual(result.routes.sell.hops.map(h => h.tokenOut.toLowerCase()), [MID, ZERO].map(x => x.toLowerCase()));
  const reads = f.calls.filter(c => c.method === "eth_getLogs");
  assert.equal(reads.length, 12, "Four discovery attempts and two verification windows on each original provider");
  const absent = await a.assessAnyQuoteAssetV1({ quoteAsset: Q }, fixture([], options).options);
  assert.equal(absent.status, "inconclusive");
  assert.equal(absent.code, "V4_DISCOVERY_PROVIDER_UNAVAILABLE");
  assert.equal(absent.retryable, true);
});

test("arbitrary quote readiness works without a Trading API key and independently requotes both directions", async () => {
  const f = fixture([pool(ZERO, Q, { fee: 500, liquidity: 0n }), pool()]);
  const result = await a.assessAnyQuoteAssetV1({ quoteAsset: Q }, f.options);
  assert.equal(result.status, "compatible", JSON.stringify(result));
  assert.equal(result.routes.buy.provider, "uniswap-v4-initialize");
  assert.equal(result.routes.buy.hops[0].tokenIn, ZERO);
  assert.equal(result.routes.sell.hops[0].tokenOut, ZERO);
  assert.equal(result.price.source, "qualified-amm");
  assert.equal(result.checks.fullExecution, "required-before-signing");
  assert.equal(f.calls.filter(c => c.method === "eth_getLogs").length, 2);
  const quotes = f.calls.filter(c => c.method === "eth_call").map(c => ({ provider: c.provider, read: decodeFunctionData({ abi: readAbi, data: c.params[0].data }) })).filter(c => c.read.functionName === "quoteExactInputSingle");
  for (const provider of [0, 1]) for (const direction of [true, false]) assert.ok(quotes.some(q => q.provider === provider && q.read.args[0].zeroForOne === direction));
  assert.ok(quotes.every(q => q.read.args[0].poolKey.fee === 0), "Empty pool is never quoted");
});

test("discovery composes a native path through one independently verified intermediate", async () => {
  const f = fixture([pool(ZERO, MID), pool(MID, Q)]);
  const result = await a.assessAnyQuoteAssetV1({ quoteAsset: Q }, f.options);
  assert.equal(result.status, "compatible", JSON.stringify(result));
  assert.deepEqual(result.routes.buy.hops.map(h => h.tokenOut.toLowerCase()), [MID, Q].map(x => x.toLowerCase()));
  assert.deepEqual(result.routes.sell.hops.map(h => h.tokenOut.toLowerCase()), [MID, ZERO].map(x => x.toLowerCase()));
  assert.equal(f.calls.filter(c => c.method === "eth_getLogs").length, 8, "Pair/adjacency results are shared with sell discovery");
});

test("typed index/Graph candidates carry keys only and cannot bypass independent state or quotes", async () => {
  const p = pool(), f = fixture([p]);
  const callback = async ({ tokenIn }) => ({ schema: "programmable.any-quote.v4-candidates.v1", chainId: 4663,
    poolManager: a.ANY_QUOTE_INFRASTRUCTURE.poolManager, routes: [[a.anyQuoteV4CandidateHopV1(p, tokenIn === a.ANY_QUOTE_WETH ? ZERO : Q)]] });
  const result = await a.assessAnyQuoteAssetV1({ quoteAsset: Q }, { ...f.options, discoverExternalRoute: callback });
  assert.equal(result.status, "compatible", JSON.stringify(result)); assert.equal(result.routes.buy.provider, "uniswap-v4-discovery");
  assert.equal(f.calls.filter(c => c.method === "eth_getLogs").length, 0);
  const raw = await callback({ tokenIn: Q });
  assert.throws(() => a.parseAnyQuoteV4DiscoveryV1({ ...raw, chainId: 1 }));
  assert.throws(() => a.parseAnyQuoteV4DiscoveryV1({ ...raw, poolManager: OTHER }));
  assert.throws(() => a.parseAnyQuoteV4DiscoveryV1({ ...raw, routes: [[{ ...raw.routes[0][0], poolId: HASH }]] }));
  const absent = fixture([]);
  const noPool = await a.assessAnyQuoteAssetV1({ quoteAsset: Q }, { ...absent.options, discoverExternalRoute: callback });
  assert.equal(noPool.status, "inconclusive"); assert.equal(noPool.retryable, true);
});

test("provider identity/quote disagreement and absent coverage never become token incompatibility", async () => {
  const wrongCode = fixture([pool()], { override: ({ provider, method, params }) => provider === 1 && method === "eth_getCode" && params[0].toLowerCase() === a.ANY_QUOTE_INFRASTRUCTURE.poolManager.toLowerCase() ? "0x600099" : undefined });
  const quoteDisagreement = fixture([pool()], { override: ({ provider, method, params }) => {
    if (provider === 1 && method === "eth_call") {
      const decoded = decodeFunctionData({ abi: readAbi, data: params[0].data });
      if (decoded.functionName === "quoteExactInputSingle") return encodeFunctionResult({ abi: readAbi, functionName: decoded.functionName, result: [decoded.args[0].exactAmount, 100_000n] });
    }
  } });
  for (const f of [wrongCode, quoteDisagreement, fixture([])]) {
    const result = await a.assessAnyQuoteAssetV1({ quoteAsset: Q }, f.options);
    assert.equal(result.status, "inconclusive"); assert.equal(result.retryable, true);
  }
  const weth = await a.assessAnyQuoteAssetV1({ quoteAsset: a.ANY_QUOTE_WETH }, fixture([]).options);
  assert.equal(weth.status, "inconclusive"); assert.equal(weth.code, "ROUTE_ISOLATION_UNAVAILABLE");
});

test("large or cyclic candidate sets stay bounded and cannot produce a signable route", async () => {
  const raw = log(pool()), expected = { currency: Q, fromBlock: 9070n, toBlock: HEIGHT };
  assert.throws(() => a.parseAnyQuoteV4InitializeV1(Array(65).fill(raw), expected));
  const f = fixture(Array.from({ length: 9 }, (_, index) => pool(toHex(BigInt(index + 1) << 148n, { size: 20 }), Q)));
  const result = await a.assessAnyQuoteAssetV1({ quoteAsset: Q }, f.options);
  assert.equal(result.status, "inconclusive"); assert.equal(result.code, "V4_DISCOVERY_INTERMEDIATE_LIMIT");
  assert.equal(f.calls.filter(c => c.method === "eth_getLogs").length, 6, "Stops before unbounded intermediate queries");
  const p = pool(ZERO, MID), q = pool(), cycleFixture = fixture([p, q]);
  const cycle = await a.assessAnyQuoteAssetV1({ quoteAsset: Q }, { ...cycleFixture.options, discoverExternalRoute: async () => ({
    schema: "programmable.any-quote.v4-candidates.v1", chainId: 4663, poolManager: a.ANY_QUOTE_INFRASTRUCTURE.poolManager,
    routes: [[a.anyQuoteV4CandidateHopV1(p, ZERO), a.anyQuoteV4CandidateHopV1(p, MID), a.anyQuoteV4CandidateHopV1(q, ZERO)]],
  }) });
  assert.equal(cycle.status, "inconclusive");
});
