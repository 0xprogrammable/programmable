import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { decodeAbiParameters, decodeFunctionData, parseAbi, parseAbiParameters } from "viem";

const root = resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const bundled = await build({ absWorkingDir: root, stdin: {
  contents: ['types', 'price', 'route', 'readiness.server'].map(n => `export * from './lib/module-engine/any-quote/${n}';`).join('\n'), resolveDir: root,
}, bundle: true, format: "cjs", platform: "node", packages: "external", write: false,
  plugins: [{ name: "server-only-test", setup(b) { b.onResolve({ filter: /^server-only$/ }, () => ({ path: "empty", namespace: "empty" })); b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "" })); } }],
});
const loadedModule = { exports: {} };
new Function("require", "module", "exports", bundled.outputFiles[0].text)(require, loadedModule, loadedModule.exports);
const a = loadedModule.exports;
const TOKEN0 = "0x0100000000000000000000000000000000000000";
const TOKEN1 = "0xff00000000000000000000000000000000000000";
const QUOTE = "0x5000000000000000000000000000000000000000";
const HOOK = "0x720e649549F7BC2118aCBA9F4C9ae6fCC7586080";
const OWNER = "0x7900000000000000000000000000000000000000";
const HASH = `0x${"11".repeat(32)}`;
const checkpoint = { number: "1", hash: HASH, timestamp: "100" };
const key = (x, y, hooks = HOOK) => ({ currency0: BigInt(x) < BigInt(y) ? x : y, currency1: BigInt(x) < BigInt(y) ? y : x, fee: 0, tickSpacing: 200, hooks });
const pool = (token = TOKEN0, quote = QUOTE) => ({ token, quoteAsset: quote, sharedHook: HOOK, poolId: a.anyQuotePoolIdV1(key(token, quote)) });
const route = (hops, tokenIn = a.ANY_QUOTE_WETH, tokenOut = QUOTE) => ({ provider: hops.length ? "uniswap-trading-api" : "weth-identity", chainId: 4663, tokenIn, tokenOut, amountIn: "100", amountOut: "100", hops, checkpoint, validUntil: "145", evidenceHash: HASH });
const v3 = (tokenIn, tokenOut) => ({ protocol: "V3", tokenIn, tokenOut, pool: "0x6000000000000000000000000000000000000000", fee: 500 });
const v4 = (tokenIn, tokenOut) => ({ protocol: "V4", tokenIn, tokenOut, key: key(tokenIn, tokenOut), poolId: a.anyQuotePoolIdV1(key(tokenIn, tokenOut)), hookData: "0x" });
const trade = externalRoute => a.buildAnyQuoteSwapV1({ pool: pool(), owner: OWNER, recipient: OWNER, side: "buy", amountIn: 100n, minimumAmountOut: 50n, deadline: 140n, now: 100n, externalRoute });

test("rational launch prices cover both asset orders and 0 through 36 decimals", () => {
  for (let decimals = 0; decimals <= 36; decimals++) for (const token of [TOKEN0, TOKEN1]) {
    const result = a.planAnyQuoteInitialPriceV1({ token, quoteAsset: QUOTE, quoteDecimals: decimals, quoteUsd: a.parseAnyQuoteDecimalV1("218.34206876") });
    assert.ok(result.initialTick % 200 === 0);
    const { numerator: n, denominator: d } = result.actualFdvUsd;
    const difference = BigInt(n) - 5000n * BigInt(d);
    assert.ok((difference < 0n ? -difference : difference) * 100n < 5000n * BigInt(d) * 2n);
    assert.ok(BigInt(result.lockedLiquidity) > 0n);
  }
});
test("very cheap quotes stay rational and mathematical liquidity overflow is rejected", () => {
  const usd = a.parseAnyQuoteDecimalV1("0.000000000000000000000001");
  assert.deepEqual(usd, { numerator: "1", denominator: "1000000000000000000000000" });
  const result = a.planAnyQuoteInitialPriceV1({ token: TOKEN0, quoteAsset: QUOTE, quoteDecimals: 0, quoteUsd: usd });
  assert.ok(BigInt(result.lockedLiquidity) > 0n);
  assert.throws(() => a.planAnyQuoteInitialPriceV1({ token: TOKEN0, quoteAsset: QUOTE, quoteDecimals: 36, quoteUsd: usd }), /INITIAL_LIQUIDITY_OUTSIDE_POOL_RANGE/);
});
test("configuration is exactly 256 bytes and rejects endpoint ticks", () => {
  const data = a.encodeAnyQuoteConfigurationV1({ sharedHook: HOOK, quoteAsset: QUOTE, initialTick: -10000, validUntil: 140n, priceEvidenceHash: HASH });
  assert.equal(data.configuration.length, 514);
  const words = decodeAbiParameters(parseAbiParameters("bytes32,address,bytes32,address,address,int24,uint64,bytes32"), data.configuration);
  assert.equal(words[5], -10000);
  for (const tick of [-887200, 887200, 1]) assert.throws(() => a.encodeAnyQuoteConfigurationV1({ sharedHook: HOOK, quoteAsset: QUOTE, initialTick: tick, validUntil: 140n, priceEvidenceHash: HASH }));
});
test("mixed V3/V4 native buy uses actual intermediate balances and final minimum", () => {
  const MID = "0x4000000000000000000000000000000000000000";
  const built = trade(route([v3(a.ANY_QUOTE_WETH, MID), v4(MID, QUOTE)]));
  assert.equal(built.transaction.to.toLowerCase(), "0x06afba43fd06227fa663b0daecf536f6eaa6bf99");
  assert.ok([...Buffer.from(built.commands.slice(2), "hex")].every(c => (c & 0x80) === 0));
  const decoded = decodeFunctionData({ abi: parseAbi(["function execute(bytes,bytes[],uint256) payable"]), data: built.transaction.data });
  assert.equal(decoded.args[2], 140n);
  const [recipient, amount] = decodeAbiParameters(parseAbiParameters("address,uint256,uint256,bytes,bool,uint256[]"), built.inputs[1]);
  assert.equal(recipient, "0x0000000000000000000000000000000000000002");
  assert.equal(amount, 1n << 255n);
  const commandBytes = [...Buffer.from(built.commands.slice(2), "hex")];
  const finalV4 = commandBytes.lastIndexOf(16);
  const [actions, params] = decodeAbiParameters(parseAbiParameters("bytes,bytes[]"), built.inputs[finalV4]);
  assert.equal(actions, "0x0b060e0e");
  const [swap] = decodeAbiParameters(parseAbiParameters("((address,address,uint24,int24,address),bool,uint128,uint128,uint256,bytes)"), params[1]);
  assert.equal(swap[2], 0n); assert.equal(swap[3], 50n); assert.equal(swap[4], 0n);
  const take = decodeAbiParameters(parseAbiParameters("address,address,uint256"), params[2]);
  assert.equal(take[1].toLowerCase(), OWNER.toLowerCase());
  assert.equal(built.balanceAccounting.existingDonationsCountAsUserFunding, false);
  assert.equal(built.requireZeroRouterBalances, undefined);
});
test("external native V4 and V2 transitions compile; WETH identity needs no external pool", () => {
  const native = trade(route([v4(a.ANY_QUOTE_NATIVE, QUOTE)]));
  assert.ok(native.commands.startsWith("0x0b0c10"));
  const v2 = { protocol: "V2", tokenIn: a.ANY_QUOTE_WETH, tokenOut: QUOTE, pool: "0x6000000000000000000000000000000000000000" };
  assert.ok(trade(route([v2])).commands.startsWith("0x0b08"));
  const identity = a.buildAnyQuoteSwapV1({ pool: pool(TOKEN0, a.ANY_QUOTE_WETH), owner: OWNER, recipient: OWNER, side: "buy", amountIn: 100n, minimumAmountOut: 1n, deadline: 140n, now: 100n, externalRoute: route([], a.ANY_QUOTE_WETH, a.ANY_QUOTE_WETH) });
  assert.ok(identity.commands.startsWith("0x0b10"));
});
test("sell binds Permit2 ingress and ETH output minimum", () => {
  const built = a.buildAnyQuoteSwapV1({ pool: pool(), owner: OWNER, recipient: OWNER, side: "sell", amountIn: 100n, minimumAmountOut: 50n, deadline: 140n, now: 100n, externalRoute: route([v4(QUOTE, a.ANY_QUOTE_NATIVE)], QUOTE, a.ANY_QUOTE_WETH) });
  assert.equal(built.transaction.value, "0"); assert.equal(built.approval.amount, "100");
  assert.ok(built.commands.startsWith("0x10100b0c"));
  const [to, minimum] = decodeAbiParameters(parseAbiParameters("address,uint256"), built.inputs[3]);
  assert.equal(to.toLowerCase(), OWNER.toLowerCase()); assert.equal(minimum, 50n);
});
test("route parser binds chain, amount, pool id and rejects splits/orders/cycles", () => {
  const p = v4(a.ANY_QUOTE_NATIVE, QUOTE);
  const response = { routing: "CLASSIC", quote: { tradeType: "EXACT_INPUT", input: { token: a.ANY_QUOTE_WETH, amount: "100" }, output: { token: QUOTE, amount: "200" }, route: [[{ type: "v4-pool", address: p.poolId, tokenIn: { address: p.tokenIn, chainId: 4663 }, tokenOut: { address: p.tokenOut, chainId: 4663 }, fee: "0", tickSpacing: "200", hooks: HOOK }]] } };
  const expected = { tokenIn: a.ANY_QUOTE_WETH, tokenOut: QUOTE, amountIn: 100n, checkpoint, validUntil: 145n };
  assert.equal(a.parseAnyQuoteExternalRouteV1(response, expected).hops[0].protocol, "V4");
  assert.throws(() => a.parseAnyQuoteExternalRouteV1({ ...response, routing: "DUTCH_V3" }, expected));
  assert.throws(() => a.parseAnyQuoteExternalRouteV1({ ...response, quote: { ...response.quote, route: [...response.quote.route, ...response.quote.route] } }, expected));
  assert.throws(() => a.validateAnyQuoteExternalRouteV1(route([v3(a.ANY_QUOTE_WETH, QUOTE), v3(QUOTE, a.ANY_QUOTE_WETH)], a.ANY_QUOTE_WETH, a.ANY_QUOTE_WETH)), /CYCLIC/);
  assert.throws(() => trade({ ...route([v3(a.ANY_QUOTE_WETH, QUOTE)]), validUntil: "130" }), /TRADE_BOUNDS/);
});
test("feed freshness follows heartbeat, and constant high fees do not fail depth qualification", () => {
  const value = { roundId: 1n, answer: 250000000000n, updatedAt: 1n, answeredInRound: 1n, decimals: 8, heartbeatSeconds: 86400, now: 8000n };
  assert.deepEqual(a.validateAnyQuoteFeedRoundV1(value), { numerator: "2500", denominator: "1" });
  assert.throws(() => a.validateAnyQuoteFeedRoundV1({ ...value, now: 90000n }), /PRICE_FEED/);
  a.qualifyAnyQuoteDepthV1(100n, 80n, 10000n, 7980n);
  assert.throws(() => a.qualifyAnyQuoteDepthV1(100n, 80n, 10000n, 7000n), /PRICE_IMPACT/);
});
test("invalid CA is incompatible, while provider failure remains inconclusive", async () => {
  assert.equal((await a.assessAnyQuoteAssetV1({ quoteAsset: "no" })).status, "incompatible");
  const rpc = async () => { throw new Error("do not leak credential from provider"); };
  const result = await a.assessAnyQuoteAssetV1({ quoteAsset: QUOTE }, { rpcs: [rpc, rpc] });
  assert.equal(result.status, "inconclusive"); assert.equal(result.retryable, true);
  assert.ok(!JSON.stringify(result).includes("credential"));
});
test("agreed chain quantities serialize canonically before checkpoint and runtime checks", async () => {
  const methods = [];
  const rpc = async method => {
    methods.push(method);
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_getBlockByNumber") return { number: "0x1", hash: HASH, timestamp: "0x64" };
    throw new Error("runtime unavailable");
  };
  const result = await a.assessAnyQuoteAssetV1({ quoteAsset: QUOTE }, { now: 100n, rpcs: [rpc, rpc] });
  assert.equal(result.status, "inconclusive");
  assert.ok(methods.includes("eth_getCode"));
});
test("stock REST quote envelope binds chain and CA and applies multiplier exactly once", () => {
  const quote = { tokenSymbol: "NVDA", deployments: [{ chainId: 4663, contractAddress: QUOTE }], bid: "218.82", ask: "218.84", currency: "USD", isTradingHalt: false, generatedAt: "2026-09-10T16:00:00Z" };
  const input = { asset: QUOTE, symbol: "NVDA", now: BigInt(Date.parse(quote.generatedAt) / 1000) + 1n, multiplier: 101n * 10n ** 16n };
  assert.deepEqual(a.parseAnyQuoteStockPriceV1({ quotes: [quote] }, input).usd, { numerator: "2210183", denominator: "10000" });
  assert.throws(() => a.parseAnyQuoteStockPriceV1(quote, input), /STOCK_PRICE_UNAVAILABLE/);
  assert.throws(() => a.parseAnyQuoteStockPriceV1({ quotes: [{ ...quote, deployments: [{ chainId: 1, contractAddress: QUOTE }] }] }, input), /IDENTITY_MISMATCH/);
  assert.throws(() => a.parseAnyQuoteStockPriceV1({ quotes: [{ ...quote, deployments: [{ chainId: 4663, contractAddress: TOKEN0 }] }] }, input), /IDENTITY_MISMATCH/);
  assert.throws(() => a.parseAnyQuoteStockPriceV1({ quotes: [quote] }, { ...input, now: input.now + 61n }), /STOCK_PRICE_STALE/);
});
