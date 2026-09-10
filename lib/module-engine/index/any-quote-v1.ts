import { decodeAbiParameters, encodeAbiParameters, keccak256, parseAbiParameters, type Address, type Hex } from "viem";
import { moduleEqual as equal, moduleHash as hash, moduleInteger as integer, moduleUint as uint, rejectModuleEvidence as fail } from "../../module-mode/release";
import { anyQuoteConfigurationParameters, MODULE_ENGINE_ANY_QUOTE_INDEX_ABI_V1 as abi } from "./abi-v1";
import { MODULE_ENGINE_ANY_QUOTE_CONFIGURATION_SCHEMA_ID, MODULE_ENGINE_ANY_QUOTE_PROFILE_ID, type ModuleEngineContractPin } from "./release-v1";
import { engineEvent, engineReadSet, same, type EngineBlock, type EngineLog } from "./proof-v1";

type Pins = Record<"host" | "ledger" | "poolManager" | "sharedHook" | "universalRouter" | "nativeRouteGuard", ModuleEngineContractPin>;
export function anyQuoteSourceBindings(pins: Pins): readonly (readonly [Address, string, Address | Hex])[] {
    return [
        [pins.host.address, "sharedHook", pins.sharedHook.address],
        [pins.host.address, "nativeRouteGuard", pins.nativeRouteGuard.address],
        [pins.host.address, "NATIVE_ROUTE_GUARD_CODE_HASH", pins.nativeRouteGuard.runtimeCodeHash],
        [pins.host.address, "quotePoolManager", pins.poolManager.address],
        [pins.host.address, "quotePoolManagerCodeHash", pins.poolManager.runtimeCodeHash],
        [pins.host.address, "UNIVERSAL_ROUTER", pins.universalRouter.address],
        [pins.host.address, "UNIVERSAL_ROUTER_CODE_HASH", pins.universalRouter.runtimeCodeHash],
        [pins.host.address, "quoteFeeProfileId", MODULE_ENGINE_ANY_QUOTE_PROFILE_ID],
        [pins.sharedHook.address, "host", pins.host.address],
        [pins.sharedHook.address, "ledger", pins.ledger.address],
        [pins.sharedHook.address, "poolManager", pins.poolManager.address],
        [pins.ledger.address, "host", pins.host.address],
        [pins.ledger.address, "hook", pins.sharedHook.address],
        [pins.ledger.address, "poolManager", pins.poolManager.address],
    ];
}

export function normalizeAnyQuoteMarket(value: unknown, block: EngineBlock, pins: Pins, launch: {
    launchId: Hex; token: Address; quoteAsset: Address; engine: Address; revisionId: Hex; familyId: Hex;
    configuration: Hex; configurationHash: Hex; resourcesHash: Hex; quoteDecimals: number;
    buyCreatorFeeBps: number; sellCreatorFeeBps: number; launchLogIndex: number;
}, logs: EngineLog[]) {
    if (launch.configuration.length !== 514) fail("anyQuote.configuration.length");
    const configuration = decodeAbiParameters(anyQuoteConfigurationParameters, launch.configuration)[0];
    equal(encodeAbiParameters(anyQuoteConfigurationParameters, [configuration]), launch.configuration, "anyQuote.configuration.canonical");
    for (const [field, expected] of [["schemaId", MODULE_ENGINE_ANY_QUOTE_CONFIGURATION_SCHEMA_ID], ["poolManager", pins.poolManager.address],
        ["poolManagerCodeHash", pins.poolManager.runtimeCodeHash], ["sharedHook", pins.sharedHook.address], ["quoteAsset", launch.quoteAsset]] as const)
        equal(typeof configuration[field] === "string" ? configuration[field].toLowerCase() : configuration[field], expected, `anyQuote.configuration.${field}`);
    const tick = configuration.initialTick;
    if (tick <= -887200 || tick >= 887200 || tick % 200 !== 0 || configuration.validUntil === 0n) fail("anyQuote.configuration.bounds");
    hash(configuration.priceEvidenceHash, "anyQuote.configuration.priceEvidence");
    const currencies = [launch.token, launch.quoteAsset].sort() as [Address, Address];
    const poolKey = { currency0: currencies[0], currency1: currencies[1], fee: 0, tickSpacing: 200, hooks: pins.sharedHook.address };
    const poolId = keccak256(encodeAbiParameters(parseAbiParameters("address,address,uint24,int24,address"), [...currencies, 0, 200, pins.sharedHook.address]));
    const registration = { launchId: launch.launchId, revisionId: launch.revisionId, familyId: launch.familyId, configurationHash: launch.configurationHash,
        token: launch.token, quoteAsset: launch.quoteAsset, initializer: launch.engine, initialTick: tick,
        buyCreatorFeeBps: launch.buyCreatorFeeBps, sellCreatorFeeBps: launch.sellCreatorFeeBps };
    const bound = engineEvent(logs, abi, pins.sharedHook.address, "SharedQuotePoolBound", poolId);
    for (const [field, expected] of Object.entries(registration))
        equal(bound.args[field === "initializer" ? "engine" : field], expected, `anyQuote.registration.${field}`);
    equal(bound.args.poolId, poolId, "anyQuote.registration.poolId");
    const initialized = engineEvent(logs, abi, pins.poolManager.address, "Initialize", poolId);
    if (bound.logIndex >= initialized.logIndex || initialized.logIndex >= launch.launchLogIndex) fail("anyQuote.registration.order");
    for (const [field, expected] of Object.entries(poolKey)) equal(initialized.args[field], expected, `anyQuote.initialize.${field}`);
    equal(initialized.args.tick, tick, "anyQuote.initialize.tick");
    const sqrt = BigInt(uint(initialized.args.sqrtPriceX96, "anyQuote.initialize.sqrt", true));
    if (sqrt < 4295128739n || sqrt >= 1461446703485210103287273052203988822378723970342n) fail("anyQuote.initialize.sqrt");
    const state = engineReadSet(value, block, abi);
    same(state.take(launch.engine, "poolKey"), poolKey, "anyQuote.poolKey");
    for (const [field, expected] of [["poolId", poolId], ["poolManager", pins.poolManager.address], ["sharedHook", pins.sharedHook.address],
        ["initialTick", tick], ["quoteDecimals", launch.quoteDecimals]] as const)
        equal(state.take(launch.engine, field), expected, `anyQuote.engine.${field}`);
    equal(state.take(pins.host.address, "poolIdOf", [launch.launchId]), poolId, "anyQuote.host.poolId");
    equal(state.take(pins.sharedHook.address, "poolIdOfLaunch", [launch.launchId]), poolId, "anyQuote.hook.poolId");
    same(state.take(pins.sharedHook.address, "poolConfig", [poolId]), registration, "anyQuote.hook.registration");
    const lower = launch.quoteAsset < launch.token ? -887200 : tick, upper = launch.quoteAsset < launch.token ? tick : 887200;
    equal(state.take(launch.engine, "tickLower"), lower, "anyQuote.lp.lower");
    equal(state.take(launch.engine, "tickUpper"), upper, "anyQuote.lp.upper");
    const liquidity = BigInt(uint(state.take(launch.engine, "lockedLiquidity"), "anyQuote.lp.liquidity", true));
    // V4 Pool.tickSpacingToMaxLiquidityPerTick for spacing 200 (8,873 usable ticks).
    if (liquidity > ((1n << 128n) - 1n) / 8873n) fail("anyQuote.lp.liquidity-cap");
    const dust = BigInt(uint(state.take(launch.engine, "lockedTokenDust"), "anyQuote.lp.dust"));
    if (dust >= 10n ** 27n) fail("anyQuote.lp.dust");
    equal(keccak256(encodeAbiParameters(parseAbiParameters("bytes32,int24,int24,uint128,uint256,uint8"),
        [poolId, lower, upper, liquidity, dust, integer(launch.quoteDecimals, "anyQuote.decimals", 36)])), launch.resourcesHash, "anyQuote.resourcesHash");
    state.done();
    return Object.freeze({ kind: "uniswap-v4" as const, chainId: 4663 as const, launchId: launch.launchId, poolManager: pins.poolManager.address,
        poolId, quoteAsset: launch.quoteAsset, primaryToken: launch.token, hook: pins.sharedHook.address, initialTick: tick });
}
