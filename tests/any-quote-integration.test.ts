import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, getAddress, getCreate2Address, keccak256, parseAbiParameters, type Hex, type TransactionReceipt } from "viem";
import { fixture, ACCOUNT, CODE, CODE_HASH, QUOTE, TOKEN, addr, hash } from "./module-engine-fixture";
import { moduleEngineReleaseIdentity, computeModuleEngineReleaseDigest, computeModuleEngineHostManifestHash, type ModuleEngineAnyQuoteReleaseIdentity } from "@/lib/module-engine/catalog";
import { MODULE_ENGINE_ANY_QUOTE_SOURCE_VERSION, MODULE_ENGINE_ANY_QUOTE_SOURCE_ID, MODULE_ENGINE_ANY_QUOTE_PROFILE, MODULE_ENGINE_ANY_QUOTE_PROFILE_ID, MODULE_ENGINE_ANY_QUOTE_ECONOMICS_POLICY_ID } from "@/lib/module-engine/profile";
import { ANY_QUOTE_CONFIGURATION_ABI, createAnyQuoteConfigurationSchema } from "@/lib/module-engine/any-quote-configuration";
import { ANY_QUOTE_INFRASTRUCTURE, ANY_QUOTE_NATIVE, ANY_QUOTE_NATIVE_BUY_OPERATION_ID, ANY_QUOTE_WETH } from "@/lib/module-engine/any-quote/types";
import { anyQuoteEvidenceHashV1, anyQuoteModulePoolKeyV1, anyQuotePoolIdV1, buildAnyQuoteSwapV1 } from "@/lib/module-engine/any-quote/route";
import { planAnyQuoteInitialPriceV1, encodeAnyQuoteConfigurationV1 } from "@/lib/module-engine/any-quote/price";
import { anyQuoteLaunchIntent, anyQuoteMinimumOutput, anyQuotePoolFor, assertAnyQuoteConfiguration, assertAnyQuoteLaunchPreparation, predictAnyQuoteToken, type AnyQuoteLaunchPreparation, type AnyQuoteTradeQuote } from "@/lib/module-engine/any-quote/integration";
import { compileModuleEngineLaunch, predictModuleEngineAddress } from "@/lib/module-engine/operation-plan";
import { prepareModuleEngineAnyQuoteSwap, prepareModuleEngineClaim, readModuleEngineAdministration, readModuleEngineFeeControls, prepareModuleEngineFeeChange, revalidateModuleEngineTransaction, releaseModuleEnginePreparation, verifyModuleEngineLaunchReceipt } from "@/lib/module-engine/client";
import { ENGINE_CONTEXT, moduleEngineAnyQuoteLedgerAbi, moduleEngineHostAbi, moduleEngineLaunchParameters, moduleEnginePlanParameters } from "@/lib/module-engine/abi";
import { readAnyQuoteLaunchPreview, readAnyQuoteReadiness } from "@/lib/server/module-engine/any-quote";
import { anyQuoteJsonRequest } from "@/lib/server/module-engine/any-quote-http";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/module-engine/any-quote/types", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/module-engine/any-quote/types")>();
  return { ...actual, ANY_QUOTE_INFRASTRUCTURE: { ...actual.ANY_QUOTE_INFRASTRUCTURE,
    poolManagerCodeHash: keccak256("0x60006000"), universalRouterCodeHash: keccak256("0x60006000") } };
});

function sharedFixture() {
  const f = fixture();
  const identity: ModuleEngineAnyQuoteReleaseIdentity = { ...moduleEngineReleaseIdentity(f.release), sourceVersion: MODULE_ENGINE_ANY_QUOTE_SOURCE_VERSION,
    engineProfile: MODULE_ENGINE_ANY_QUOTE_PROFILE, economicsPolicyId: MODULE_ENGINE_ANY_QUOTE_ECONOMICS_POLICY_ID,
    contracts: { ...f.release.contracts, poolManager: { address: ANY_QUOTE_INFRASTRUCTURE.poolManager.toLowerCase() as Hex, runtimeCodeHash: CODE_HASH },
      sharedHook: { address: addr(901), runtimeCodeHash: CODE_HASH }, universalRouter: { address: ANY_QUOTE_INFRASTRUCTURE.universalRouter.toLowerCase() as Hex, runtimeCodeHash: CODE_HASH }, nativeRouteGuard: { address: addr(903), runtimeCodeHash: CODE_HASH } } };
  identity.releaseDigest = computeModuleEngineReleaseDigest(identity);
  const release = { ...f.release, ...identity };
  Object.assign(f.release, release);
  const m = f.template.manifest.manifest;
  m.release = identity; m.catalogDefinition = { ...m.catalogDefinition, interface: "quote-shared-v1", configurationAbi: ANY_QUOTE_CONFIGURATION_ABI, schema: createAnyQuoteConfigurationSchema(identity), defaults: {} };
  f.template.manifestHash = computeModuleEngineHostManifestHash(f.template.manifest);
  let platformWallet = addr(99);
  const originalRead = vi.mocked(f.client.readContract).getMockImplementation()!;
  vi.mocked(f.client.readContract).mockImplementation(async input => {
    const fn = input.functionName;
    if (fn === "SOURCE_VERSION") return MODULE_ENGINE_ANY_QUOTE_SOURCE_ID;
    if (fn === "ECONOMICS_POLICY_ID") return MODULE_ENGINE_ANY_QUOTE_ECONOMICS_POLICY_ID;
    if (fn === "quoteFeeProfileId") return MODULE_ENGINE_ANY_QUOTE_PROFILE_ID;
    if (fn === "sharedHook" || fn === "hook") return identity.contracts.sharedHook.address;
    if (fn === "host") return release.contracts.host.address;
    if (fn === "ledger") return release.contracts.ledger.address;
    if (fn === "poolManager" || fn === "quotePoolManager") return identity.contracts.poolManager.address;
    if (fn === "quotePoolManagerCodeHash") return CODE_HASH;
    if (fn === "nativeRouteGuard") return identity.contracts.nativeRouteGuard.address;
    if (fn === "NATIVE_ROUTE_GUARD_CODE_HASH") return CODE_HASH;
    if (fn === "UNIVERSAL_ROUTER") return identity.contracts.universalRouter.address;
    if (fn === "UNIVERSAL_ROUTER_CODE_HASH") return CODE_HASH;
    if (fn === "PROTOCOL_FEE_BPS" || fn === "AUTHOR_POOL_FEE_BPS" || fn === "feeTerms" || fn === "claimable") throw new Error("Native fee ABI used for quote asset");
    if (fn === "platformFeeBps") return 30;
    if (fn === "quoteAsset") return QUOTE;
    if (fn === "configurationHash") return f.launch.configurationHash;
    if (fn === "poolIdOf" || fn === "poolId") return hash(801);
    if (fn === "claimableQuote" || fn === "claimedBy") { expect(input.args).toEqual([QUOTE, ACCOUNT]); return fn === "claimableQuote" ? f.state.claimable : f.state.claimed; }
    if (fn === "contributionByLaunch") return 2n;
    if (fn === "treasury") return platformWallet;
    if (fn === "contextHash") return keccak256(encodeAbiParameters(parseAbiParameters(ENGINE_CONTEXT), [{ host: f.host, launchId: f.launch.launchId, token: TOKEN, creator: ACCOUNT, quoteAsset: QUOTE, feeCollector: release.contracts.ledger.address }]));
    return originalRead(input);
  });
  vi.mocked(f.client.call).mockImplementation(async ({ data }) => {
    const decoded = decodeFunctionData({ abi: moduleEngineAnyQuoteLedgerAbi, data: data! });
    if (decoded.functionName === "claimQuoteTo") return { data: encodeFunctionResult({ abi: moduleEngineAnyQuoteLedgerAbi, functionName: "claimQuoteTo", result: f.state.claimable }) };
    if (decoded.functionName === "changePlatformWallet") return { data: "0x" };
    throw new Error("Unexpected quote simulation");
  });
  const intent = anyQuoteLaunchIntent({ ...f.launchInput, releaseDigest: release.releaseDigest, initialBuyWei: "0", slippageBps: 100 });
  const token = predictAnyQuoteToken(intent, identity), now = f.state.timestamp, expiry = (now + 120n).toString();
  const price = planAnyQuoteInitialPriceV1({ token, quoteAsset: QUOTE, quoteDecimals: 36, quoteUsd: { numerator: "2", denominator: "1" } });
  const readiness = { status: "compatible", chainId: 4663, quoteAsset: QUOTE, token: { name: "Quote", symbol: "Q", decimals: 36 }, checkpoint: { number: "100", hash: f.blockHash, timestamp: now.toString() },
    price: { usd: price.quoteUsd, source: "chainlink", observedAt: now.toString(), validUntil: expiry, evidenceHash: hash(81), heartbeatSeconds: 86400 },
    routes: {} as never, validUntil: expiry, evidenceHash: hash(82), checks: { codeAndMetadata: "verified", routePools: "verified-at-checkpoint", externalQuotes: "same-block-bidirectional", fullExecution: "required-before-signing" } } as const;
  const priceEvidenceHash = anyQuoteEvidenceHashV1({ domain: "programmable.any-quote.price-intent.v1", intent, readinessEvidenceHash: readiness.evidenceHash, price, validUntil: expiry });
  const preview: AnyQuoteLaunchPreparation = { schemaVersion: "programmable.any-quote.launch-preview.v1", intent, readiness, predictedToken: token, pool: anyQuotePoolFor(token, QUOTE, identity.contracts.sharedHook.address),
    ...encodeAnyQuoteConfigurationV1({ sharedHook: identity.contracts.sharedHook.address, quoteAsset: QUOTE, initialTick: price.initialTick, validUntil: BigInt(expiry), priceEvidenceHash }), initialTick: price.initialTick, validUntil: expiry,
    actualFdvUsd: price.actualFdvUsd, evidenceHash: "0x", initialBuy: null };
  preview.evidenceHash = anyQuoteEvidenceHashV1({ ...preview, evidenceHash: undefined });
  return { ...f, release, identity, intent, preview, setPlatformWallet: (next: Hex) => { platformWallet = next; } };
}

function tradeFixture(buy: boolean) {
  const f = sharedFixture(), pool = anyQuotePoolFor(TOKEN, QUOTE, f.identity.contracts.sharedHook.address), expiry = f.preview.validUntil;
  const key = { currency0: ANY_QUOTE_NATIVE, currency1: QUOTE, fee: 3000, tickSpacing: 60, hooks: ANY_QUOTE_NATIVE };
  const quote: AnyQuoteTradeQuote = { schemaVersion: "programmable.any-quote.trade-quote.v1", releaseDigest: f.release.releaseDigest, templateId: f.intent.templateId,
    account: ACCOUNT, token: TOKEN, quoteAsset: QUOTE, recipient: ACCOUNT, buy, inputAmount: "1000", output: "2000", minimumOutput: "1980", slippageBps: 100,
    validUntil: expiry, checkpoint: f.preview.readiness.checkpoint, pool, evidenceHash: "0x",
    externalRoute: { provider: "uniswap-trading-api", chainId: 4663, tokenIn: buy ? ANY_QUOTE_WETH : QUOTE, tokenOut: buy ? QUOTE : ANY_QUOTE_WETH,
      amountIn: buy ? "1000" : "3000", amountOut: buy ? "3000" : "2000", validUntil: expiry, checkpoint: f.preview.readiness.checkpoint, evidenceHash: hash(821),
      hops: [{ protocol: "V4", tokenIn: buy ? ANY_QUOTE_NATIVE : QUOTE, tokenOut: buy ? QUOTE : ANY_QUOTE_NATIVE, poolId: anyQuotePoolIdV1(key), key, hookData: "0x" }] } };
  quote.evidenceHash = anyQuoteEvidenceHashV1({ ...quote, evidenceHash: undefined });
  const allowance = { amount: 1000n, expiration: Number(expiry) }, originalRead = vi.mocked(f.client.readContract).getMockImplementation()!;
  vi.mocked(f.client.readContract).mockImplementation(async input => {
    if (input.functionName === "poolIdOf" || input.functionName === "poolId") return pool.poolId;
    if (input.functionName === "poolKey") return anyQuoteModulePoolKeyV1(pool);
    if (input.functionName === "allowance" && input.address?.toLowerCase() === ANY_QUOTE_INFRASTRUCTURE.permit2.toLowerCase()) return [allowance.amount, allowance.expiration, 0];
    return originalRead(input);
  });
  const permit2Runtime = readFileSync(new URL("../scripts/test/any-quote-route-permit2.hex", import.meta.url), "utf8").trim() as Hex;
  vi.mocked(f.client.getCode).mockImplementation(async ({ address }) => address.toLowerCase() === ANY_QUOTE_INFRASTRUCTURE.permit2.toLowerCase() ? permit2Runtime : CODE);
  vi.mocked(f.client.call).mockImplementation(async input => { expect(input.to?.toLowerCase()).toBe(f.identity.contracts.universalRouter.address); return { data: "0x" }; });
  return { ...f, quote, allowance };
}

describe("Any Quote financial integration", () => {
  it.each([true, false])("prepares and revalidates the full final ETH route with its reviewed minimum (buy=%s)", async buy => {
    const f = tradeFixture(buy), prepared = await prepareModuleEngineAnyQuoteSwap({ ...f, account: ACCOUNT });
    expect(prepared.kind).toBe("swap"); if (prepared.kind !== "swap") throw new Error("Unexpected funding approval");
    const expected = buildAnyQuoteSwapV1({ pool: f.quote.pool, owner: ACCOUNT, recipient: ACCOUNT, side: buy ? "buy" : "sell", amountIn: 1000n, minimumAmountOut: 1980n, deadline: BigInt(f.quote.validUntil), externalRoute: f.quote.externalRoute, now: f.state.timestamp });
    expect(prepared.transaction.data).toBe(expected.transaction.data); expect(BigInt(prepared.transaction.value)).toBe(buy ? 1000n : 0n);
    expect(prepared).toMatchObject({ minimumOutput: 1980n, outputAmount: 2000n, quoteAsset: QUOTE });
    await expect(revalidateModuleEngineTransaction(prepared, ACCOUNT)).resolves.toEqual(prepared.transaction);
    await expect(revalidateModuleEngineTransaction(prepared, ACCOUNT)).rejects.toThrow("fresh, verified");
    releaseModuleEnginePreparation(prepared); // Simulate an explicit wallet rejection, which alone permits a new attempt.
    f.state.timestamp = BigInt(f.quote.validUntil);
    await expect(revalidateModuleEngineTransaction(prepared, ACCOUNT)).rejects.toThrow("expired");
  });
  it("uses the UERC20 Permit2 allowance and requires only a finite router approval when needed", async () => {
    const f = tradeFixture(false); f.state.allowance = (1n << 256n) - 1n; f.allowance.amount = 999n;
    await expect(prepareModuleEngineAnyQuoteSwap({ ...f, account: ACCOUNT })).resolves.toMatchObject({ kind: "approval-required", allowanceKind: "permit2", amount: 1000n, currentAllowance: 999n, permit2Spender: f.identity.contracts.universalRouter.address });
    expect(f.client.call).not.toHaveBeenCalled();
    f.allowance.amount = 1000n;
    const prepared = await prepareModuleEngineAnyQuoteSwap({ ...f, account: ACCOUNT });
    if (prepared.kind !== "swap") throw new Error("Exact allowance should fund the sell");
    f.allowance.expiration = Number(f.state.timestamp);
    await expect(revalidateModuleEngineTransaction(prepared, ACCOUNT)).rejects.toThrow("Sell allowance changed");
  });
  it("matches the final AnyQuote host token graffiti domain while preserving native token predictions", async () => {
    const f = sharedFixture(), compiled = await compileModuleEngineLaunch({ ...f.launchInput, configuration: {}, anyQuotePreparation: f.preview }, f.release, f.template.manifest, 36, BigInt(f.preview.validUntil));
    const expectedGraffiti = keccak256(encodeAbiParameters(parseAbiParameters("string,address,bytes32"), ["programmable.module-engine.any-quote-token.v1", ACCOUNT, f.intent.creatorSalt]));
    const expectedToken = getCreate2Address({ from: f.release.contracts.tokenFactory.address, salt: keccak256(encodeAbiParameters(parseAbiParameters("string,string,uint8,address,bytes32"), [f.intent.name, f.intent.symbol, 18, f.host, expectedGraffiti])), bytecodeHash: f.release.tokenCreationCodeHash });
    expect(compiled.graffiti).toBe(expectedGraffiti); expect(compiled.predictedToken).toBe(expectedToken.toLowerCase()); expect(f.preview.predictedToken).toBe(expectedToken.toLowerCase());
    const native = fixture(), nativePlan = await compileModuleEngineLaunch(native.launchInput, native.release, native.template.manifest, 6, native.state.timestamp + 120n);
    expect(nativePlan.graffiti).toBe(keccak256(encodeAbiParameters(parseAbiParameters("string,address,bytes32"), ["programmable.module-engine.token.v1", ACCOUNT, native.launchInput.creatorSalt])));
  });
  it("compiles signed price config with 36 decimals, optional zero buy and ledger context without mining the LP engine", async () => {
    const f = sharedFixture(), compiled = await compileModuleEngineLaunch({ ...f.launchInput, configuration: {}, anyQuotePreparation: f.preview }, f.release, f.template.manifest, 36, BigInt(f.preview.validUntil));
    expect(compiled.engine).toBe(predictModuleEngineAddress(f.host, ACCOUNT, f.launchInput.engineSalt, compiled.launchId, compiled.initCodeHash));
    expect(compiled.context.feeCollector).toBe(f.release.contracts.ledger.address);
    expect(compiled.initialOperation.inputAmount).toBe(0n);
    expect(compiled.parameters.configuration.length).toBe(514);
    expect(decodeAbiParameters(parseAbiParameters("bytes32,address,bytes32,address,address,int24,uint64,bytes32"), compiled.parameters.configuration)[5]).toBe(f.preview.initialTick);
    expect(assertAnyQuoteLaunchPreparation(f.preview, f.intent, f.release, f.state.timestamp)).toBe(f.preview);
  });
  it.each(["account", "quoteAsset", "buyCreatorFeeBps", "creatorSalt", "engineSalt", "initialBuyWei"])("rejects a preview reused after %s changes", key => {
    const f = sharedFixture(), value = key === "buyCreatorFeeBps" ? 100 : key === "initialBuyWei" ? "1" : key.includes("Salt") ? hash(666) : addr(666);
    expect(() => assertAnyQuoteLaunchPreparation(f.preview, { ...f.intent, [key]: value }, f.release, f.state.timestamp)).toThrow("MISMATCH");
  });
  it("rejects expired or substituted quote configuration and old profile bypasses", () => {
    const f = sharedFixture();
    expect(() => assertAnyQuoteConfiguration({ configuration: f.preview.configuration, release: f.release, quoteAsset: QUOTE, now: BigInt(f.preview.validUntil), validUntil: BigInt(f.preview.validUntil) })).toThrow();
    expect(() => assertAnyQuoteConfiguration({ configuration: f.preview.configuration, release: fixture().release, quoteAsset: QUOTE, now: f.state.timestamp, validUntil: BigInt(f.preview.validUntil) })).toThrow();
    expect(() => assertAnyQuoteConfiguration({ configuration: f.preview.configuration, release: f.release, quoteAsset: addr(12), now: f.state.timestamp, validUntil: BigInt(f.preview.validUntil) })).toThrow();
  });
  it("floors only the final output for slippage and rejects dust", () => {
    expect(anyQuoteMinimumOutput(1001n, 100)).toBe(990n);
    expect(() => anyQuoteMinimumOutput(1n, 100)).toThrow("OUTPUT_TOO_SMALL");
    expect(() => anyQuoteMinimumOutput(100n, 1001)).toThrow("INVALID_SLIPPAGE");
  });
  it("prepares the same financial launch intent through the API without initial quote holdings", async () => {
    const f = sharedFixture(), preview = await readAnyQuoteLaunchPreview({ ...f.intent, description: "Quote launch" }, {
      client: f.client, availability: async () => ({ ...f.availability, release: f.release }), readiness: async () => f.preview.readiness,
    });
    expect(preview.initialBuy).toBeNull(); expect(preview.intent.initialBuyWei).toBe("0");
    expect(preview.configurationHash).toBe(f.preview.configurationHash);
    expect(assertAnyQuoteLaunchPreparation(preview, f.intent, f.release, f.state.timestamp)).toBe(preview);
    expect(f.client.call).not.toHaveBeenCalled();
  });
  it.each(["incompatible", "inconclusive"] as const)("keeps %s readiness distinct in the public API", async status => {
    const f = sharedFixture(), result = { status, chainId: 4663 as const, quoteAsset: QUOTE, code: status === "incompatible" ? "UNSUPPORTED_TOKEN_DECIMALS" : "PROVIDER_UNAVAILABLE", retryable: status === "inconclusive" };
    expect(await readAnyQuoteReadiness({ releaseDigest: f.release.releaseDigest, templateId: f.intent.templateId, quoteAsset: QUOTE }, {
      availability: async () => ({ ...f.availability, release: f.release }), readiness: async () => result,
    })).toEqual(result);
  });
  it("never exposes provider details as token incompatibility", async () => {
    const response = await anyQuoteJsonRequest(new Request("https://programmable.market/api/module-mode/any-quote/launch-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), async () => { throw new Error("private-provider-detail"); });
    expect(response.status).toBe(503);
    const body = await response.json(); expect(body).toMatchObject({ status: "inconclusive", retryable: true, quoteAsset: null });
    expect(JSON.stringify(body)).not.toContain("private-provider-detail");
  });
  it("reads and claims the quote ledger without native fee selectors", async () => {
    const f = sharedFixture();
    const admin = await readModuleEngineAdministration({ ...f, account: ACCOUNT, token: TOKEN });
    expect(admin.fees).toMatchObject({ feeAsset: QUOTE, claimable: 9n, buyPlatformBps: 30, sellPlatformBps: 30 });
    const prepared = await prepareModuleEngineClaim({ ...f, account: ACCOUNT, token: TOKEN, recipient: ACCOUNT });
    expect(prepared.feeAsset).toBe(QUOTE);
    expect(decodeFunctionData({ abi: moduleEngineAnyQuoteLedgerAbi, data: prepared.transaction.data })).toMatchObject({ functionName: "claimQuoteTo", args: [getAddress(QUOTE), ACCOUNT] });
    f.state.claimable = 8n;
    await expect(revalidateModuleEngineTransaction(prepared, ACCOUNT)).rejects.toThrow("Fee balance changed");
  });
  it("rotates only future platform credits with exact current beneficiary authority and preserves provenance", async () => {
    const f = sharedFixture(), snapshot = await readModuleEngineFeeControls({ ...f, account: addr(99), token: TOKEN });
    expect(snapshot.authors).toEqual([]); expect(snapshot.quoteFees).toBe(true);
    await expect(prepareModuleEngineFeeChange({ ...f, account: ACCOUNT, token: TOKEN, intent: { kind: "rotate-platform", recipient: addr(111) } })).rejects.toThrow("authority");
    const prepared = await prepareModuleEngineFeeChange({ ...f, account: addr(99), token: TOKEN, intent: { kind: "rotate-platform", recipient: addr(111) } });
    expect(decodeFunctionData({ abi: moduleEngineAnyQuoteLedgerAbi, data: prepared.transaction.data })).toMatchObject({ functionName: "changePlatformWallet", args: [getAddress(addr(111))] });
    f.setPlatformWallet(addr(112));
    await expect(revalidateModuleEngineTransaction(prepared, addr(99))).rejects.toThrow("changed");
    expect(f.state.claimable).toBe(9n);
  });
  it("requires the initial ETH buy output and consumed nonce when confirming an AnyQuote launch", async () => {
    const f = sharedFixture(), compiled = await compileModuleEngineLaunch({ ...f.launchInput, configuration: {}, anyQuotePreparation: f.preview }, f.release, f.template.manifest, 36, BigInt(f.preview.validUntil));
    const operation = { operationId: ANY_QUOTE_NATIVE_BUY_OPERATION_ID, actor: ACCOUNT, recipient: ACCOUNT, inputAsset: ANY_QUOTE_NATIVE, inputAmount: 1000n, outputAsset: TOKEN, minimumOutput: 990n, deadline: BigInt(f.preview.validUntil), nonce: 0n, data: "0x1234" as Hex };
    const parameters = { ...compiled.parameters, initialOperation: operation };
    f.launch.planHash = keccak256(encodeAbiParameters(moduleEnginePlanParameters, [4663n, f.host, ACCOUNT, parameters]));
    const log = (eventName: string, args: Record<string, unknown>) => {
      const event = moduleEngineHostAbi.find(item => item.type === "event" && item.name === eventName); if (event?.type !== "event") throw new Error("Missing event fixture");
      return { address: f.host, transactionHash: hash(200), blockNumber: 100n, blockHash: f.blockHash, removed: false,
        topics: encodeEventTopics({ abi: moduleEngineHostAbi, eventName, args } as never), data: encodeAbiParameters(event.inputs.filter(item => !item.indexed), event.inputs.filter(item => !item.indexed).map(item => args[item.name!])) };
    };
    const logs = [log("EngineLaunchBound", { ...f.launch, runtimeCodeHash: f.launch.engineCodeHash, economicsPolicyId: f.release.economicsPolicyId }),
      log("EngineLaunchParametersBound", { launchId: f.launch.launchId, encodedParameters: encodeAbiParameters(moduleEngineLaunchParameters, [parameters]) }),
      log("EngineOperationExecuted", { ...operation, launchId: f.launch.launchId, outputAmount: 1000n, resultHash: keccak256(operation.data) })];
    const receipt = { status: "success", transactionHash: hash(200), blockNumber: 100n, blockHash: f.blockHash, logs } as unknown as TransactionReceipt;
    f.state.nonce = 1n;
    await expect(verifyModuleEngineLaunchReceipt({ ...f, expected: f.launch, receipt })).resolves.toMatchObject({ kind: "launch", outputAmount: 1000n, finalized: false });
    f.state.nonce = 0n;
    await expect(verifyModuleEngineLaunchReceipt({ ...f, expected: f.launch, receipt })).rejects.toThrow("nonce was not consumed");
    f.state.nonce = 1n;
    await expect(verifyModuleEngineLaunchReceipt({ ...f, expected: f.launch, receipt: { ...receipt, logs: receipt.logs.slice(0, 2) } })).rejects.toThrow("exactly one");
  });
});
