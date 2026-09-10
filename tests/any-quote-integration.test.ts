import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, encodeFunctionResult, erc20Abi, getAddress, getCreate2Address, keccak256, parseAbi, parseAbiParameters, type Abi, type Address, type Hex, type TransactionReceipt } from "viem";
import { fixture, ACCOUNT, CODE, CODE_HASH, QUOTE, TOKEN, addr, hash } from "./module-engine-fixture";
import { moduleEngineReleaseIdentity, computeModuleEngineReleaseDigest, computeModuleEngineHostManifestHash, type ModuleEngineAnyQuoteReleaseIdentity } from "@/lib/module-engine/catalog";
import { MODULE_ENGINE_ANY_QUOTE_SOURCE_VERSION, MODULE_ENGINE_ANY_QUOTE_SOURCE_ID, MODULE_ENGINE_ANY_QUOTE_PROFILE, MODULE_ENGINE_ANY_QUOTE_PROFILE_ID, MODULE_ENGINE_ANY_QUOTE_ECONOMICS_POLICY_ID } from "@/lib/module-engine/profile";
import { ANY_QUOTE_CONFIGURATION_ABI, createAnyQuoteConfigurationSchema } from "@/lib/module-engine/any-quote-configuration";
import { ANY_QUOTE_INFRASTRUCTURE, ANY_QUOTE_NATIVE, ANY_QUOTE_NATIVE_BUY_OPERATION_ID, ANY_QUOTE_WETH } from "@/lib/module-engine/any-quote/types";
import { anyQuoteEvidenceHashV1, anyQuoteModulePoolKeyV1, anyQuotePoolIdV1, buildAnyQuoteSwapV1 } from "@/lib/module-engine/any-quote/route";
import { planAnyQuoteInitialPriceV1, encodeAnyQuoteConfigurationV1 } from "@/lib/module-engine/any-quote/price";
import { anyQuoteLaunchIntent, anyQuoteMinimumOutput, anyQuotePoolFor, assertAnyQuoteConfiguration, assertAnyQuoteLaunchPreparation, predictAnyQuoteToken, type AnyQuoteLaunchPreparation, type AnyQuoteTradeQuote } from "@/lib/module-engine/any-quote/integration";
import { compileModuleEngineLaunch, predictModuleEngineAddress } from "@/lib/module-engine/operation-plan";
import { prepareModuleEngineAnyQuoteSwap, prepareModuleEngineClaim, readModuleEngineLaunch, readModuleEngineAdministration, readModuleEngineFeeControls, prepareModuleEngineFeeChange, revalidateModuleEngineTransaction, releaseModuleEnginePreparation, verifyModuleEngineLaunchReceipt, verifyModuleEngineClaimReceipt } from "@/lib/module-engine/client";
import { ENGINE_CONTEXT, moduleEngineAnyQuoteHookAbi, moduleEngineAnyQuoteLedgerAbi, moduleEngineHostAbi, moduleEngineLaunchParameters, moduleEnginePlanParameters } from "@/lib/module-engine/abi";
import { readAnyQuoteLaunchPreview, readAnyQuoteReadiness } from "@/lib/server/module-engine/any-quote";
import { readAnyQuoteIdentityLaunchPreviewV1 } from "@/lib/server/module-engine/any-quote-preparation";
import { assertAnyQuoteLifecycleIdentityV1, prepareAnyQuoteLifecycleApprovalV1, prepareAnyQuoteLifecycleClaimV1, prepareAnyQuoteLifecycleLaunchV1, prepareAnyQuoteLifecycleSwapV1,
  revalidateAnyQuoteLifecyclePreparationV1, verifyAnyQuoteLifecycleReceiptV1, type AnyQuoteLifecyclePreparationV1 } from "@/lib/module-engine/any-quote/lifecycle";
import { anyQuoteJsonRequest } from "@/lib/server/module-engine/any-quote-http";
import { settlementRpcFixture } from "./any-quote-settlement-fixture";
import type { TradeRpcV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/module-engine/any-quote/types", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/module-engine/any-quote/types")>();
  return { ...actual, ANY_QUOTE_INFRASTRUCTURE: { ...actual.ANY_QUOTE_INFRASTRUCTURE,
    poolManagerCodeHash: keccak256("0x60006000"), universalRouterCodeHash: keccak256("0x60006000") } };
});

const registrationAbi = parseAbi(["event QuoteLaunchRegistered(bytes32 indexed launchId,address indexed asset,bytes32 configurationHash,address[] creatorWallets,uint16[] creatorSharesBps)"]);
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
  // Exact AnyQuoteLedgerV1.registerLaunch ABI; this commitment is independent of Host config bytes.
  const ledgerConfigurationHash = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint256,address,address,address,address,bytes32,address,address[],uint16[]"),
    [release.economicsPolicyId, 4663n, release.contracts.ledger.address, identity.contracts.poolManager.address, identity.contracts.sharedHook.address, f.host, f.launch.launchId, QUOTE, [ACCOUNT], [10_000]]));
  const feeState = { configurationHash: ledgerConfigurationHash, creatorWallets: [ACCOUNT] };
  const registration = { address: release.contracts.ledger.address, blockNumber: 100n, blockHash: f.blockHash, transactionHash: hash(199), transactionIndex: 0, logIndex: 0, removed: false,
    topics: encodeEventTopics({ abi: registrationAbi, eventName: "QuoteLaunchRegistered", args: { launchId: f.launch.launchId, asset: QUOTE } }),
    data: encodeAbiParameters(parseAbiParameters("bytes32,address[],uint16[]"), [ledgerConfigurationHash, [ACCOUNT], [10_000]]) };
  f.client.getLogs = vi.fn(async input => {
    expect(input).toMatchObject({ address: release.contracts.ledger.address, args: { launchId: f.launch.launchId, asset: QUOTE }, fromBlock: 1n, strict: true });
    expect(input.toBlock).toBeGreaterThanOrEqual(100n);
    return [registration];
  }) as NonNullable<typeof f.client.getLogs>;
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
    if (fn === "decimals" && input.address?.toLowerCase() === QUOTE.toLowerCase()) return 36;
    if (fn === "configurationHash") return feeState.configurationHash;
    if (fn === "creatorRecipients") return [feeState.creatorWallets, [10_000], 0n];
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
  const externalKey = { currency0: ANY_QUOTE_NATIVE, currency1: QUOTE, fee: 3000, tickSpacing: 60, hooks: ANY_QUOTE_NATIVE };
  const externalRoute = { provider: "uniswap-v4-initialize", chainId: 4663, tokenIn: ANY_QUOTE_WETH, tokenOut: QUOTE, amountIn: "1000", amountOut: "3000", validUntil: expiry,
    checkpoint: { number: "100", hash: f.blockHash, timestamp: now.toString() }, evidenceHash: hash(821),
    hops: [{ protocol: "V4", tokenIn: ANY_QUOTE_NATIVE, tokenOut: QUOTE, poolId: anyQuotePoolIdV1(externalKey), key: externalKey, hookData: "0x" }] } as const;
  const readiness = { status: "compatible", chainId: 4663, quoteAsset: QUOTE, token: { name: "Quote", symbol: "Q", decimals: 36 }, checkpoint: { number: "100", hash: f.blockHash, timestamp: now.toString() },
    price: { usd: price.quoteUsd, source: "chainlink", observedAt: now.toString(), validUntil: expiry, evidenceHash: hash(81), heartbeatSeconds: 86400 },
    routes: { buy: externalRoute, sell: externalRoute }, validUntil: expiry, evidenceHash: hash(82), checks: { codeAndMetadata: "verified", routePools: "verified-at-checkpoint", externalQuotes: "same-block-bidirectional", fullExecution: "required-before-signing" } } as const;
  const priceEvidenceHash = anyQuoteEvidenceHashV1({ domain: "programmable.any-quote.price-intent.v1", intent, readinessEvidenceHash: readiness.evidenceHash, price, validUntil: expiry });
  const preview: AnyQuoteLaunchPreparation = { schemaVersion: "programmable.any-quote.launch-preview.v1", intent, readiness, predictedToken: token, pool: anyQuotePoolFor(token, QUOTE, identity.contracts.sharedHook.address),
    ...encodeAnyQuoteConfigurationV1({ sharedHook: identity.contracts.sharedHook.address, quoteAsset: QUOTE, initialTick: price.initialTick, validUntil: BigInt(expiry), priceEvidenceHash }), initialTick: price.initialTick, validUntil: expiry,
    actualFdvUsd: price.actualFdvUsd, evidenceHash: "0x", initialBuy: null };
  preview.evidenceHash = anyQuoteEvidenceHashV1({ ...preview, evidenceHash: undefined });
  return { ...f, release, identity, intent, preview, registration, feeState, setPlatformWallet: (next: Hex) => { platformWallet = next; } };
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

function lifecycleHistory(f: ReturnType<typeof sharedFixture>) {
  const originalTimestamp = f.state.timestamp, history = { latest: 100n };
  vi.mocked(f.client.getBlock).mockImplementation(async input => {
    const number = input?.blockNumber ?? history.latest;
    return { number, hash: number === 100n ? f.blockHash : hash(Number(number)), timestamp: number === 100n ? originalTimestamp : f.state.timestamp } as never;
  });
  return history;
}
function lifecycleLog(address: Address, abi: Abi, eventName: string, args: Record<string, unknown>) {
  const event = abi.find(item => item.type === "event" && item.name === eventName); if (event?.type !== "event") throw new Error("Missing event");
  return { address, blockNumber: 101n, blockHash: hash(101), transactionHash: hash(202), transactionIndex: 0, logIndex: 0, removed: false,
    topics: encodeEventTopics({ abi, eventName, args } as never), data: encodeAbiParameters(event.inputs.filter(item => !item.indexed), event.inputs.filter(item => !item.indexed).map(item => args[item.name!])) };
}
function lifecycleReceipt(f: ReturnType<typeof sharedFixture>, preparation: AnyQuoteLifecyclePreparationV1, logs: ReturnType<typeof lifecycleLog>[]) {
  const transaction = preparation.prepared.transaction;
  vi.mocked(f.client.getTransaction).mockResolvedValue({ hash: hash(202), from: transaction.from, to: transaction.to, input: transaction.data, value: BigInt(transaction.value), chainId: 4663, blockNumber: 101n, blockHash: hash(101) } as never);
  return { status: "success", from: transaction.from, to: transaction.to, transactionHash: hash(202), blockNumber: 101n, blockHash: hash(101), logs } as unknown as TransactionReceipt;
}

describe("Any Quote source identity lifecycle preparation", () => {
  it("uses genuine identity packets while public reads and preparation remain active-gated", async () => {
    const f = tradeFixture(true), identity = f.identity;
    expect(identity).not.toHaveProperty("status"); expect(identity).not.toHaveProperty("lifecycleEvidenceDigest");
    await expect(assertAnyQuoteLifecycleIdentityV1({ ...f, identity })).resolves.toMatchObject({ release: identity });
    await expect(readModuleEngineLaunch({ ...f, release: identity as typeof f.release, token: TOKEN })).rejects.toThrow();
    await expect(prepareModuleEngineAnyQuoteSwap({ ...f, release: identity as typeof f.release, account: ACCOUNT })).rejects.toThrow();
    const prepared = await prepareAnyQuoteLifecycleSwapV1({ ...f, identity, account: ACCOUNT });
    if ("kind" in prepared) throw new Error("Unexpected approval");
    await expect(revalidateModuleEngineTransaction(prepared.prepared as never, ACCOUNT)).rejects.toThrow("fresh, verified");
    await expect(assertAnyQuoteLifecycleIdentityV1({ ...f, identity: f.release })).rejects.toThrow();
  });
  it.each([true, false])("roundtrips and revalidates identical unsigned route bytes without requoting (buy=%s)", async buy => {
    const f = tradeFixture(buy); lifecycleHistory(f);
    const preparation = await prepareAnyQuoteLifecycleSwapV1({ ...f, identity: f.identity, account: ACCOUNT });
    if ("kind" in preparation) throw new Error("Unexpected approval");
    const restored = JSON.parse(JSON.stringify(preparation)) as AnyQuoteLifecyclePreparationV1;
    expect(restored.prepared.blockNumber).toBe("100");
    await expect(revalidateAnyQuoteLifecyclePreparationV1({ ...f, identity: f.identity, preparation: restored })).resolves.toEqual(preparation.prepared.transaction);
    const changed = {
      ...structuredClone(restored),
      prepared: { ...restored.prepared, transaction: { ...restored.prepared.transaction, value: "0xffff" as Hex } },
    };
    changed.evidenceHash = anyQuoteEvidenceHashV1({ ...changed, evidenceHash: undefined });
    await expect(revalidateAnyQuoteLifecyclePreparationV1({ ...f, identity: f.identity, preparation: changed })).rejects.toThrow("original canonical preparation differs");
  });
  it("rejects expired materializations while retaining the original checkpoint", async () => {
    const f = tradeFixture(true), history = lifecycleHistory(f), preparation = await prepareAnyQuoteLifecycleSwapV1({ ...f, identity: f.identity, account: ACCOUNT });
    if ("kind" in preparation) throw new Error("Unexpected approval");
    history.latest = 101n; f.state.timestamp = BigInt(preparation.prepared.expiresAt);
    await expect(revalidateAnyQuoteLifecyclePreparationV1({ ...f, identity: f.identity, preparation })).rejects.toThrow("expired");
  });
  it("prepares only the finite required Permit2 predecessor of a bound sell", async () => {
    const f = tradeFixture(false); lifecycleHistory(f); f.allowance.amount = 0n;
    vi.mocked(f.client.call).mockResolvedValue({ data: "0x" });
    const preparation = await prepareAnyQuoteLifecycleApprovalV1({ ...f, identity: f.identity, account: ACCOUNT });
    if ("kind" in preparation) throw new Error("Unexpected missing approval");
    expect(preparation).toMatchObject({ recipe: { kind: "approve" }, prepared: { kind: "approve", amount: "1000", allowanceKind: "permit2" }, funding: { funding: { permit2Nonce: 0, erc20Allowance: f.state.allowance.toString() } } });
    await expect(revalidateAnyQuoteLifecyclePreparationV1({ ...f, identity: f.identity, preparation: JSON.parse(JSON.stringify(preparation)) })).resolves.toEqual(preparation.prepared.transaction);
    const buy = tradeFixture(true);
    await expect(prepareAnyQuoteLifecycleApprovalV1({ ...buy, identity: buy.identity, account: ACCOUNT })).rejects.toThrow("predecessor of a sell");
  });
  it("creates identity launch previews through the mandatory settlement gate and prepares the same zero-buy launch", async () => {
    const f = sharedFixture(), settlement = settlementRpcFixture(f.preview.readiness.routes.buy, addr(99));
    const preview = await readAnyQuoteIdentityLaunchPreviewV1({ ...f.intent, identity: f.identity, template: f.template, description: "Identity launch" }, { client: f.client, readiness: async () => f.preview.readiness, options: { rpcs: settlement.rpcs } });
    const input = { ...f.launchInput, anyQuotePreparation: preview };
    const compiled = await compileModuleEngineLaunch(input, f.identity, f.template.manifest, 36, BigInt(preview.validUntil));
    const read = vi.mocked(f.client.readContract).getMockImplementation()!;
    vi.mocked(f.client.readContract).mockImplementation(async value => value.functionName === "predictTokenAddress" ? [compiled.predictedToken, compiled.graffiti] : read(value));
    const result = { ...f.launch, launchId: compiled.launchId, token: compiled.predictedToken, engine: compiled.engine, constructorHash: compiled.constructorHash, initCodeHash: compiled.initCodeHash, configurationHash: compiled.configurationHash, planHash: compiled.planHash, engineCodeHash: compiled.engineCodeHash };
    vi.mocked(f.client.call).mockResolvedValue({ data: encodeFunctionResult({ abi: moduleEngineHostAbi, functionName: "launch", result }) });
    const preparation = await prepareAnyQuoteLifecycleLaunchV1({ ...f, identity: f.identity, input });
    if ("kind" in preparation) throw new Error("Unexpected funding");
    expect(preparation.prepared.transaction.value).toBe("0x0");
    await expect(revalidateAnyQuoteLifecyclePreparationV1({ ...f, identity: f.identity, preparation: JSON.parse(JSON.stringify(preparation)) })).resolves.toEqual(preparation.prepared.transaction);
    settlement.state.recipientAdjustment = -1n;
    await expect(readAnyQuoteIdentityLaunchPreviewV1({ ...f.intent, identity: f.identity, template: f.template, description: "Identity launch" }, { client: f.client, readiness: async () => f.preview.readiness, options: { rpcs: settlement.rpcs } })).rejects.toMatchObject({ status: "incompatible" });
  });
  it("binds a canonical swap receipt to the signed router bytes and final token transfer", async () => {
    const f = tradeFixture(true); lifecycleHistory(f);
    const preparation = await prepareAnyQuoteLifecycleSwapV1({ ...f, identity: f.identity, account: ACCOUNT });
    if ("kind" in preparation) throw new Error("Unexpected approval");
    const logs = [lifecycleLog(f.identity.contracts.sharedHook.address, moduleEngineAnyQuoteHookAbi, "QuotePoolSwap", { poolId: f.quote.pool.poolId, launchId: f.launch.launchId, swapSender: f.identity.contracts.universalRouter.address, buy: true, exactInput: true, grossQuote: 1000n, platformQuote: 3n, creatorQuote: 0n, coreAmount0: 1000n, coreAmount1: -2000n }),
      lifecycleLog(TOKEN, erc20Abi, "Transfer", { from: f.identity.contracts.poolManager.address, to: ACCOUNT, value: 2000n })];
    const receipt = lifecycleReceipt(f, preparation, logs);
    await expect(verifyAnyQuoteLifecycleReceiptV1({ ...f, identity: f.identity, preparation, receipt })).resolves.toMatchObject({ kind: "swap", outputAmount: "2000", finalized: false });
    await expect(verifyAnyQuoteLifecycleReceiptV1({ ...f, identity: f.identity, preparation, receipt: { ...receipt, logs: receipt.logs.slice(0, 1) } })).rejects.toThrow("below the signed minimum");
  });
  it.each(["valid", "missing-transfer", "duplicate-transfer", "wrong-source", "wrong-amount", "unchanged-total"])("binds claim receipts to actual PoolManager transfer and ledger total: %s", async mutation => {
    const f = sharedFixture(); lifecycleHistory(f);
    const preparation = await prepareAnyQuoteLifecycleClaimV1({ ...f, identity: f.identity, account: ACCOUNT, token: TOKEN, recipient: ACCOUNT });
    if ("kind" in preparation) throw new Error("Unexpected funding");
    const read = vi.mocked(f.client.readContract).getMockImplementation()!;
    vi.mocked(f.client.readContract).mockImplementation(async value => value.functionName === "claimedBy" && value.blockNumber === 101n ? mutation === "unchanged-total" ? 4n : 13n : read(value));
    const transfer = lifecycleLog(QUOTE, erc20Abi, "Transfer", { from: mutation === "wrong-source" ? f.identity.contracts.ledger.address : f.identity.contracts.poolManager.address, to: ACCOUNT, value: mutation === "wrong-amount" ? 8n : 9n });
    const logs = [lifecycleLog(f.identity.contracts.ledger.address, moduleEngineAnyQuoteLedgerAbi, "QuoteFeesClaimed", { asset: QUOTE, beneficiary: ACCOUNT, recipient: ACCOUNT, amount: 9n }), ...(mutation === "missing-transfer" ? [] : [transfer]), ...(mutation === "duplicate-transfer" ? [transfer] : [])];
    const receipt = lifecycleReceipt(f, preparation, logs), result = verifyAnyQuoteLifecycleReceiptV1({ ...f, identity: f.identity, preparation: JSON.parse(JSON.stringify(preparation)), receipt });
    if (mutation === "valid") {
      await expect(result).resolves.toMatchObject({ kind: "claim", outputAmount: "9", blockNumber: "101" });
      await expect(verifyModuleEngineClaimReceipt({ ...f, launch: f.launch, account: ACCOUNT, recipient: ACCOUNT, minimumAmount: 9n, claimedBefore: 4n, receipt })).resolves.toMatchObject({ outputAmount: 9n });
      const clock = vi.spyOn(Date, "now").mockReturnValue(Number(BigInt(preparation.prepared.expiresAt) + 3_600n) * 1000);
      try { await expect(verifyAnyQuoteLifecycleReceiptV1({ ...f, identity: f.identity, preparation, receipt })).resolves.toMatchObject({ outputAmount: "9" }); }
      finally { clock.mockRestore(); }
    } else await expect(result).rejects.toThrow();
  });
});

describe("Any Quote financial integration", () => {
  it("binds the real ledger commitment separately from Host config and retains claims after creator rotation", async () => {
    const f = sharedFixture();
    expect(f.feeState.configurationHash).not.toBe(f.launch.configurationHash);
    await expect(readModuleEngineLaunch({ ...f, token: TOKEN })).resolves.toEqual(f.launch);
    f.feeState.creatorWallets = [addr(111)];
    const admin = await readModuleEngineAdministration({ ...f, account: ACCOUNT, token: TOKEN });
    expect(admin.fees.creatorWallets).toEqual([addr(111)]);
    await expect(prepareModuleEngineClaim({ ...f, account: ACCOUNT, token: TOKEN, recipient: ACCOUNT })).resolves.toMatchObject({ kind: "claim", minimumAmount: 9n });
  });
  it("rejects the Host hash in ledger storage and rejects changed original recipients", async () => {
    const f = sharedFixture(), original = f.feeState.configurationHash;
    f.feeState.configurationHash = f.launch.configurationHash;
    await expect(readModuleEngineLaunch({ ...f, token: TOKEN })).rejects.toThrow("Ledger configuration differs");
    f.feeState.configurationHash = original;
    f.registration.data = encodeAbiParameters(parseAbiParameters("bytes32,address[],uint16[]"), [original, [addr(111)], [10_000]]);
    await expect(readModuleEngineLaunch({ ...f, token: TOKEN })).rejects.toThrow("Quote launch registration configuration differs");
  });
  it("keeps Host configuration independently bound to the derived launch ID", async () => {
    const f = sharedFixture(); f.launch.configurationHash = hash(991);
    await expect(readModuleEngineLaunch({ ...f, token: TOKEN })).rejects.toThrow("Derived launch ID differs");
  });
  it.each(["missing", "duplicate", "foreign-ledger", "foreign-launch", "foreign-asset", "removed", "future-block", "forked-block"])("rejects invalid original quote registration evidence: %s", async mutation => {
    const f = sharedFixture();
    if (mutation === "missing" || mutation === "duplicate") f.client.getLogs = vi.fn(async () => mutation === "missing" ? [] : [f.registration, f.registration]) as NonNullable<typeof f.client.getLogs>;
    if (mutation === "foreign-ledger") f.registration.address = addr(991);
    if (mutation === "foreign-launch" || mutation === "foreign-asset") f.registration.topics = encodeEventTopics({ abi: registrationAbi, eventName: "QuoteLaunchRegistered", args: { launchId: mutation === "foreign-launch" ? hash(991) : f.launch.launchId, asset: mutation === "foreign-asset" ? addr(991) : QUOTE } });
    if (mutation === "removed") f.registration.removed = true;
    if (mutation === "future-block") f.registration.blockNumber = 101n;
    if (mutation === "forked-block") f.registration.blockHash = hash(991);
    await expect(readModuleEngineLaunch({ ...f, token: TOKEN })).rejects.toThrow(/quote launch registration/i);
  });
  it("requires registration log access only for the Any Quote client", async () => {
    const f = sharedFixture(); delete f.client.getLogs;
    await expect(readModuleEngineLaunch({ ...f, token: TOKEN })).rejects.toThrow("registration logs are unavailable");
    const legacy = fixture();
    await expect(readModuleEngineLaunch({ ...legacy, token: TOKEN })).resolves.toEqual(legacy.launch);
  });
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
    const f = sharedFixture(), settlement = settlementRpcFixture(f.preview.readiness.routes.buy, addr(99)), preview = await readAnyQuoteLaunchPreview({ ...f.intent, description: "Quote launch" }, {
      client: f.client, availability: async () => ({ ...f.availability, release: f.release }), readiness: async () => f.preview.readiness,
      options: { rpcs: settlement.rpcs },
    });
    expect(preview.initialBuy).toBeNull(); expect(preview.intent.initialBuyWei).toBe("0");
    expect(preview.configurationHash).toBe(f.preview.configurationHash);
    expect(assertAnyQuoteLaunchPreparation(preview, f.intent, f.release, f.state.timestamp)).toBe(preview);
    expect(f.client.call).not.toHaveBeenCalled();
    expect(settlement.calls.some(call => call.method === "debug_traceCall")).toBe(true);
  });
  it.each([true, false])("pins initial-buy traces to the canonical hash and closes unsupported providers (supported=%s)", async supported => {
    const f = sharedFixture(), settlement = settlementRpcFixture(f.preview.readiness.routes.buy, addr(99));
    const initialTraces: unknown[][] = [];
    const rpcs = settlement.rpcs.map(provider => (async (method, params) => {
      const tx = params[0] as { from?: Address; to?: Address; data?: Hex; value?: Hex };
      if (method !== "debug_traceCall" || tx.to?.toLowerCase() !== f.host.toLowerCase()) return provider(method, params);
      initialTraces.push([...params]);
      expect(params[1]).toEqual({ blockHash: f.preview.readiness.checkpoint.hash, requireCanonical: true });
      if (!supported) throw new Error("Hash reference unsupported");
      return { type: "CALL", ...tx, input: tx.data, output: "0x", gasUsed: "0x100", calls: [
        { type: "CALL", from: f.identity.contracts.poolManager.address, to: f.preview.predictedToken, value: "0x0", gasUsed: "0x10",
          input: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [ACCOUNT, 2000n] }), output: encodeFunctionResult({ abi: erc20Abi, functionName: "transfer", result: true }) },
      ] };
    }) satisfies TradeRpcV1) as unknown as readonly [TradeRpcV1, TradeRpcV1];
    const result = readAnyQuoteIdentityLaunchPreviewV1({ ...f.intent, identity: f.identity, template: f.template, initialBuyWei: "1000", description: "Canonical initial buy" }, {
      client: f.client, readiness: async () => f.preview.readiness, options: { rpcs },
    });
    if (supported) await expect(result).resolves.toMatchObject({ initialBuy: { output: "2000", minimumOutput: "1980" } });
    else await expect(result).rejects.toMatchObject({ code: "TRADE_ANALYSIS_PENDING", status: 503 });
    expect(initialTraces).toHaveLength(2);
  });
  it.each(["taxed", "restricted", "unfunded"])("closes zero-buy launch preview when quote settlement is %s", async kind => {
    const f = sharedFixture(), settlement = settlementRpcFixture(f.preview.readiness.routes.buy, addr(99));
    if (kind === "taxed") settlement.state.recipientAdjustment = -1n;
    if (kind === "restricted") settlement.state.failed = true;
    if (kind === "unfunded") settlement.state.balance = 0n;
    await expect(readAnyQuoteLaunchPreview({ ...f.intent, description: "Zero buy settlement gate" }, {
      client: f.client, availability: async () => ({ ...f.availability, release: f.release }), readiness: async () => f.preview.readiness, options: { rpcs: settlement.rpcs },
    })).rejects.toMatchObject({ status: kind === "taxed" ? "incompatible" : "inconclusive" });
    expect(f.intent.initialBuyWei).toBe("0"); expect(f.client.call).not.toHaveBeenCalled();
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
