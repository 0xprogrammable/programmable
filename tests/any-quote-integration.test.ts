import { describe, expect, it, vi } from "vitest";
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionResult, getAddress, keccak256, parseAbiParameters, type Hex } from "viem";
import { fixture, ACCOUNT, CODE_HASH, QUOTE, TOKEN, addr, hash } from "./module-engine-fixture";
import { moduleEngineReleaseIdentity, computeModuleEngineReleaseDigest, computeModuleEngineHostManifestHash, type ModuleEngineAnyQuoteReleaseIdentity } from "@/lib/module-engine/catalog";
import { MODULE_ENGINE_ANY_QUOTE_SOURCE_VERSION, MODULE_ENGINE_ANY_QUOTE_SOURCE_ID, MODULE_ENGINE_ANY_QUOTE_PROFILE, MODULE_ENGINE_ANY_QUOTE_PROFILE_ID, MODULE_ENGINE_ANY_QUOTE_ECONOMICS_POLICY_ID } from "@/lib/module-engine/profile";
import { ANY_QUOTE_CONFIGURATION_ABI, createAnyQuoteConfigurationSchema } from "@/lib/module-engine/any-quote-configuration";
import { ANY_QUOTE_INFRASTRUCTURE } from "@/lib/module-engine/any-quote/types";
import { anyQuoteEvidenceHashV1 } from "@/lib/module-engine/any-quote/route";
import { planAnyQuoteInitialPriceV1, encodeAnyQuoteConfigurationV1 } from "@/lib/module-engine/any-quote/price";
import { anyQuoteLaunchIntent, anyQuoteMinimumOutput, anyQuotePoolFor, assertAnyQuoteConfiguration, assertAnyQuoteLaunchPreparation, predictAnyQuoteToken, type AnyQuoteLaunchPreparation } from "@/lib/module-engine/any-quote/integration";
import { compileModuleEngineLaunch, predictModuleEngineAddress } from "@/lib/module-engine/operation-plan";
import { prepareModuleEngineClaim, readModuleEngineAdministration, readModuleEngineFeeControls, prepareModuleEngineFeeChange, revalidateModuleEngineTransaction } from "@/lib/module-engine/client";
import { ENGINE_CONTEXT, moduleEngineAnyQuoteLedgerAbi } from "@/lib/module-engine/abi";
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

describe("Any Quote financial integration", () => {
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
});
