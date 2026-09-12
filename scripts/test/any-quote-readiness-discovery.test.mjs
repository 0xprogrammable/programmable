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
const multicallAddress = "0xca11bde05977b3631167028862be2a173976ca11", multicallCode = "0x6006600055";
fixtureCode.set(multicallAddress, multicallCode);
const bundled = await build({ absWorkingDir: root, stdin: { contents: ["types", "route", "discovery.server", "readiness.server"].map(name => `export * from './lib/module-engine/any-quote/${name}'`).join("\n") + "; export { agreedTradeRpcV1, TradeRpcExecutionRevertedV1 } from './lib/server/custom-launch/routed-trade-rpc-v1'; export { quoteModule } from './lib/server/module-engine/any-quote-preparation'", resolveDir: root },
  bundle: true, format: "cjs", platform: "node", packages: "external", write: false,
  plugins: [{ name: "fixture-environment", setup(b) {
    b.onResolve({ filter: /^server-only$/ }, () => ({ path: "empty", namespace: "empty" }));
    b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "" }));
    b.onLoad({ filter: /chain-4663\.v1\.json$/ }, () => ({ contents: JSON.stringify(profile), loader: "json" }));
    b.onLoad({ filter: /lib\/chains\.ts$/ }, async args => ({ contents: (await readFile(args.path, "utf8")).replace(
      /"0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891"/, JSON.stringify(keccak256(multicallCode))), loader: "ts" }));
    // Expose the unchanged private reader only to this test bundle; production exports remain closed.
    b.onLoad({ filter: /any-quote-preparation\.ts$/ }, async args => ({ contents: `${await readFile(args.path, "utf8")}\nexport { quoteModule };`, loader: "ts" }));
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
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)",
  "function decimals() view returns (uint8)", "function totalSupply() view returns (uint256)", "function name() view returns (string)", "function symbol() view returns (string)",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)", "function getLiquidity(bytes32) view returns (uint128)",
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
]);

test("module quotes compare exact canonical amounts through both RPCs for buys and sells", async () => {
  const modulePool = { token: OTHER, quoteAsset: Q, sharedHook: MID,
    poolId: a.anyQuotePoolIdV1({ currency0: OTHER, currency1: Q, fee: 0, tickSpacing: 200, hooks: MID }) };
  const expected = (1n << 100n) + 7n, calls = [];
  const rpcs = [0, 1].map(provider => async (method, params) => {
    calls.push({ provider, method, params });
    assert.deepEqual(params[1], { blockHash: HASH, requireCanonical: true });
    if (method === "eth_getCode") return fixtureCode.get(a.ANY_QUOTE_INFRASTRUCTURE.v4Quoter.toLowerCase());
    assert.equal(method, "eth_call");
    return encodeFunctionResult({ abi: readAbi, functionName: "quoteExactInputSingle", result: [expected, 100_000n] });
  });
  for (const buy of [true, false]) assert.equal(await a.quoteModule(modulePool, buy, 1n, checkpoint, { options: { rpcs } }), expected);
  assert.equal(calls.length, 8);
  assert.equal(calls.filter(call => call.method === "eth_call" && call.provider === 0).length, 2);
  assert.equal(calls.filter(call => call.method === "eth_call" && call.provider === 1).length, 2);
});

test("module quotes retain provider disagreement, positive uint128 and runtime checks", async () => {
  const modulePool = { token: OTHER, quoteAsset: Q, sharedHook: MID,
    poolId: a.anyQuotePoolIdV1({ currency0: OTHER, currency1: Q, fee: 0, tickSpacing: 200, hooks: MID }) };
  const rpcPair = (amounts, runtime) => [0, 1].map(provider => async method => method === "eth_getCode"
    ? runtime ?? fixtureCode.get(a.ANY_QUOTE_INFRASTRUCTURE.v4Quoter.toLowerCase())
    : encodeFunctionResult({ abi: readAbi, functionName: "quoteExactInputSingle", result: [amounts[provider], 100_000n] }));
  await assert.rejects(a.quoteModule(modulePool, true, 1n, checkpoint, { options: { rpcs: rpcPair([2n ** 100n, 2n ** 100n + 1n]) } }), error => error.code === "TRADE_PROVIDER_DISAGREEMENT");
  for (const amount of [0n, 1n << 128n]) await assert.rejects(a.quoteModule(modulePool, true, 1n, checkpoint, { options: { rpcs: rpcPair([amount, amount]) } }), error => error.code === "TRADE_ANALYSIS_PENDING");
  await assert.rejects(a.quoteModule(modulePool, true, 1n, checkpoint, { options: { rpcs: rpcPair([1n, 1n], "0x00") } }), /QUOTER_RUNTIME_MISMATCH/);
});
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
    else if (functionName === "aggregate3") result = args[0].map(call => {
      assert.equal(call.target.toLowerCase(), a.ANY_QUOTE_INFRASTRUCTURE.stateView.toLowerCase());
      assert.equal(call.allowFailure, false);
      const read = decodeFunctionData({ abi: readAbi, data: call.callData });
      assert.equal(read.functionName, "getLiquidity");
      return { success: true, returnData: encodeFunctionResult({ abi: readAbi, functionName: "getLiquidity",
        result: pools.find(p => p.poolId.toLowerCase() === read.args[0].toLowerCase())?.liquidity ?? 0n }) };
    });
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

test("popular tokens rank active pool hints in pinned batches before canonical verification", async () => {
  const pools = Array.from({ length: 155 }, (_, i) => pool(ZERO, Q, { fee: i * 500, block: 10_000n + BigInt(i) * 10_000n,
    liquidity: i < 130 ? 0n : BigInt(i + 1) }));
  const f = fixture(pools, { override: quickNodeRangeLimit });
  const discovery = a.createAnyQuoteV4InitializeDiscoveryV1({ checkpoint: longCheckpoint, rpcs: f.rpcs });
  const selected = await discovery.nativePools(Q);
  assert.equal(selected.length, 16);
  assert.deepEqual(new Set(selected.map(value => value.poolId)), new Set(pools.slice(-16).map(value => value.poolId)));
  assert.equal(discovery.hasIncompleteCoverage(), true, "A bounded shortlist never claims index completeness");
  const logs = f.calls.filter(value => value.method === "eth_getLogs");
  assert.equal(logs.length, 34, "One full-range hint query and16 canonical verification windows on each provider");
  for (const selectedPool of selected) for (const provider of [0, 1]) assert.ok(logs.some(call => call.provider === provider
    && BigInt(call.params[0].fromBlock) === BigInt(selectedPool.blockNumber) && !wideRange(call.params)));
  const batches = f.calls.filter(call => call.method === "eth_call");
  assert.equal(batches.length, 6, "155 pools use three liquidity reads per independent provider");
  assert.ok(batches.every(call => call.params[1].blockHash === HASH && call.params[1].requireCanonical === true));
  const priorCalls = f.calls.length;
  assert.deepEqual(await discovery.nativePools(Q), selected);
  assert.equal(f.calls.length, priorCalls, "The reverse route reuses this request's verified pool keys");
});

test("shortlist verification permits unrelated canonical logs in the same bounded window", async () => {
  const pools = Array.from({ length: 24 }, (_, i) => pool(ZERO, Q, { fee: i * 500, block: 10_000n + BigInt(i), liquidity: i % 2 ? 1n : 0n }));
  const f = fixture(pools, { override: quickNodeRangeLimit });
  const selected = await a.createAnyQuoteV4InitializeDiscoveryV1({ checkpoint: longCheckpoint, rpcs: f.rpcs }).nativePools(Q);
  assert.equal(selected.length, 12);
  assert.deepEqual(new Set(selected.map(value => value.poolId)), new Set(pools.filter(p => p.liquidity > 0n).map(p => p.poolId)));
});

test("active pool ranking cannot ignore provider disagreement, malformed data or changed infrastructure", async () => {
  const pools = Array.from({ length: 24 }, (_, i) => pool(ZERO, Q, { fee: i * 500, block: 10_000n + BigInt(i) * 10_000n }));
  for (const corruption of ["disagreement", "malformed", "runtime"]) {
    const f = fixture(pools, { override: info => {
      quickNodeRangeLimit(info);
      if (corruption === "runtime" && info.method === "eth_getCode" && info.params[0].toLowerCase() === multicallAddress) return "0x00";
      if (info.method !== "eth_call" || info.params[0].to.toLowerCase() !== multicallAddress || info.provider !== 1) return;
      if (corruption === "malformed") return "0x00";
      if (corruption === "disagreement") {
        const read = decodeFunctionData({ abi: readAbi, data: info.params[0].data });
        return encodeFunctionResult({ abi: readAbi, functionName: "aggregate3", result: read.args[0].map(() => ({ success: true,
          returnData: encodeFunctionResult({ abi: readAbi, functionName: "getLiquidity", result: 0n }) })) });
      }
    } });
    await assert.rejects(() => a.createAnyQuoteV4InitializeDiscoveryV1({ checkpoint: longCheckpoint, rpcs: f.rpcs }).nativePools(Q));
    assert.equal(f.calls.filter(call => call.method === "eth_getLogs").length, 2, "Untrusted ranking must never reach candidate verification");
  }
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

const ONE_DOLLAR_ETH = 10n ** 18n / 2500n;
function quoteWithDepth(thinPools) {
  return ({ method, params }) => {
    if (method !== "eth_call") return;
    const read = decodeFunctionData({ abi: readAbi, data: params[0].data });
    if (read.functionName !== "quoteExactInputSingle") return;
    const quote = read.args[0], thin = thinPools.some(p => p.poolId === a.anyQuotePoolIdV1(quote.poolKey));
    const scale = thin ? (quote.exactAmount <= ONE_DOLLAR_ETH ? 100n : 90n) : 99n;
    return encodeFunctionResult({ abi: readAbi, functionName: read.functionName, result: [quote.exactAmount * scale / 100n, 100_000n] });
  };
}

test("a thin pool with the best small quote cannot displace a depth-qualified buy or sell route", async () => {
  const thin = pool(), deep = pool(ZERO, Q, { fee: 500 });
  const f = fixture([thin, deep], { override: quoteWithDepth([thin]) });
  const result = await a.assessAnyQuoteAssetV1({ quoteAsset: Q }, f.options);
  assert.equal(result.status, "compatible", JSON.stringify(result));
  for (const side of ["buy", "sell"]) assert.equal(result.routes[side].hops[0].poolId, deep.poolId);
  assert.equal(result.price.source, "qualified-amm");
  const quotes = f.calls.filter(c => c.method === "eth_call")
    .filter(c => decodeFunctionData({ abi: readAbi, data: c.params[0].data }).functionName === "quoteExactInputSingle");
  const unique = new Set(quotes.map(c => `${c.provider}:${JSON.stringify(c.params)}`));
  assert.equal(unique.size, quotes.length, "Final evidence reuses the same checkpoint-local depth quotes");
});

test("depth qualification retains the concrete policy failure when every candidate is too thin", async () => {
  const pools = [pool(), pool(ZERO, Q, { fee: 500 })];
  const f = fixture(pools, { override: quoteWithDepth(pools) });
  const result = await a.assessAnyQuoteAssetV1({ quoteAsset: Q }, f.options);
  assert.equal(result.status, "inconclusive"); assert.equal(result.retryable, true);
  assert.equal(result.code, "MARKET_PRICE_IMPACT_TOO_HIGH");
});

test("direct depth failures allow an independently qualified intermediate route", async () => {
  const thin = pool(), f = fixture([thin, pool(ZERO, MID), pool(MID, Q)], { override: quoteWithDepth([thin]) });
  const result = await a.assessAnyQuoteAssetV1({ quoteAsset: Q }, f.options);
  assert.equal(result.status, "compatible", JSON.stringify(result));
  assert.deepEqual(result.routes.buy.hops.map(h => h.tokenOut.toLowerCase()), [MID, Q].map(x => x.toLowerCase()));
  assert.deepEqual(result.routes.sell.hops.map(h => h.tokenOut.toLowerCase()), [MID, ZERO].map(x => x.toLowerCase()));
});

test("a reverted candidate quote stays non-executable without treating malformed successful data as a revert", async () => {
  const reverting = pool(), deep = pool(ZERO, Q, { fee: 500 }), rejectedBy = new Set();
  const f = fixture([reverting, deep], { override: info => {
    if (info.method !== "eth_call") return;
    const read = decodeFunctionData({ abi: readAbi, data: info.params[0].data });
    if (read.functionName === "quoteExactInputSingle" && read.args[0].poolKey.fee === 0) {
      rejectedBy.add(info.provider);
      throw Object.assign(Error("execution reverted"), { code: 3, data: "0x" });
    }
    return quoteWithDepth([])(info);
  } });
  const result = await a.assessAnyQuoteAssetV1({ quoteAsset: Q }, f.options);
  assert.equal(result.status, "compatible", JSON.stringify(result));
  assert.deepEqual([...rejectedBy], [0, 1], "Both RPCs rejected the non-executable candidate call");
  for (const side of ["buy", "sell"]) assert.equal(result.routes[side].hops[0].poolId, deep.poolId);
});

test("an independently agreed depth revert can select another qualified pool", async () => {
  const failing = pool(), deep = pool(ZERO, Q, { fee: 500 });
  const f = fixture([failing, deep], { override: info => {
    if (info.method !== "eth_call") return;
    const read = decodeFunctionData({ abi: readAbi, data: info.params[0].data });
    if (read.functionName === "quoteExactInputSingle" && read.args[0].poolKey.fee === 0 && read.args[0].exactAmount > ONE_DOLLAR_ETH)
      throw new a.TradeRpcExecutionRevertedV1("0x1234");
  } });
  const result = await a.assessAnyQuoteAssetV1({ quoteAsset: Q }, f.options);
  assert.equal(result.status, "compatible", JSON.stringify(result));
  for (const side of ["buy", "sell"]) assert.equal(result.routes[side].hops[0].poolId, deep.poolId);
});

test("unconfirmed or inconsistent depth reverts never select another pool", async () => {
  for (const other of ["success", "different-revert", "outage"]) {
    const f = fixture([pool(), pool(ZERO, Q, { fee: 500 })], { override: info => {
      if (info.method !== "eth_call") return;
      const read = decodeFunctionData({ abi: readAbi, data: info.params[0].data });
      if (read.functionName !== "quoteExactInputSingle" || read.args[0].poolKey.fee !== 0 || read.args[0].exactAmount <= ONE_DOLLAR_ETH) return;
      if (info.provider === 0) throw new a.TradeRpcExecutionRevertedV1("0x1234");
      if (other === "different-revert") throw new a.TradeRpcExecutionRevertedV1("0x5678");
      if (other === "outage") throw Error("provider unavailable");
    } });
    const result = await a.assessAnyQuoteAssetV1({ quoteAsset: Q }, f.options);
    assert.equal(result.status, "inconclusive", `${other}: ${JSON.stringify(result)}`);
    assert.equal(result.retryable, true);
    if (other !== "outage") assert.equal(result.code, "TRADE_PROVIDER_DISAGREEMENT");
  }
});

test("provider disagreement and malformed initial or depth quotes cannot fall back to a healthy pool", async () => {
  const thin = pool(), deep = pool(ZERO, Q, { fee: 500 });
  for (const stage of ["initial", "depth"]) for (const corruption of ["disagreement", "non-hex", "short-abi"]) {
    const f = fixture([thin, deep], { override: info => {
      if (info.method !== "eth_call") return;
      const read = decodeFunctionData({ abi: readAbi, data: info.params[0].data });
      if (read.functionName !== "quoteExactInputSingle") return;
      const quote = read.args[0], targeted = quote.poolKey.fee === 0
        && (stage === "initial" ? quote.exactAmount <= ONE_DOLLAR_ETH : quote.exactAmount > ONE_DOLLAR_ETH);
      if (targeted && (info.provider === 1 || corruption === "short-abi")) {
        if (corruption === "non-hex") return "malformed RPC bytes";
        if (corruption === "short-abi") return "0x00";
        return encodeFunctionResult({ abi: readAbi, functionName: read.functionName, result: [quote.exactAmount * 2n, 100_000n] });
      }
      return quoteWithDepth([thin])(info);
    } });
    const result = await a.assessAnyQuoteAssetV1({ quoteAsset: Q }, f.options);
    assert.equal(result.status, "inconclusive", `${stage}/${corruption}: ${JSON.stringify(result)}`);
    assert.equal(result.retryable, true);
    assert.equal(result.code, corruption === "disagreement" ? "TRADE_PROVIDER_DISAGREEMENT" : "RPC_RESPONSE_INVALID");
  }
});

test("authoritative reference-price checks qualify a candidate before its better small quote wins", async () => {
  const asset = a.ANY_QUOTE_USDG, offReference = pool(ZERO, asset), matching = pool(ZERO, asset, { fee: 500 });
  const f = fixture([offReference, matching], { override: info => {
    if (info.method !== "eth_call") return;
    const read = decodeFunctionData({ abi: readAbi, data: info.params[0].data });
    if (read.functionName === "decimals" && info.params[0].to.toLowerCase() === "0x61b7e5650328764b076a108eff5fa7282a1b9ad2")
      return encodeFunctionResult({ abi: readAbi, functionName: read.functionName, result: 8 });
    if (read.functionName === "getSlot0" && read.args[0] === offReference.poolId)
      return encodeFunctionResult({ abi: readAbi, functionName: read.functionName, result: [2n << 96n, 0, 0, 0] });
    return quoteWithDepth([offReference])(info);
  } });
  const result = await a.assessAnyQuoteAssetV1({ quoteAsset: asset }, f.options);
  assert.equal(result.status, "compatible", JSON.stringify(result));
  assert.equal(result.routes.buy.hops[0].poolId, matching.poolId);
  assert.equal(result.price.source, "chainlink");
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
