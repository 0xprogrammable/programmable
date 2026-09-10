import { concatHex, decodeAbiParameters, encodeAbiParameters, getCreate2Address, keccak256, parseAbiParameters, toHex, type Address, type Hex } from "viem";
import { moduleAddress as address, moduleBytes as bytes, moduleEqual as equal, moduleHash as hash, moduleInteger as integer, moduleRecord as record, moduleUint as uint, rejectModuleEvidence as fail } from "../../module-mode/release";
import { MODULE_ENGINE_INDEX_ABI_V1, MODULE_ENGINE_ANY_QUOTE_INDEX_ABI_V1, MODULE_ENGINE_PARAMETERS_MAX_BYTES_V1, ENGINE_LAUNCH_PARAMETERS, moduleEngineConstructorParameters, moduleEnginePlanParameters } from "./abi-v1";
import { moduleEngineReleaseIdentity, isModuleEngineAnyQuoteRelease, moduleEngineSourceId, type ModuleEngineReleaseIdentity } from "./release-v1";
import { bound, canonicalEngineLog, engineEvent, engineReadSet, finality, list, plain, same, text, type EngineBlock } from "./proof-v1";
import { anyQuoteSourceBindings, normalizeAnyQuoteMarket } from "./any-quote-v1";
export const MODULE_ENGINE_EVIDENCE_SCHEMA_V1 = "programmable.module-engine.evidence.v1" as const;
export const MODULE_ENGINE_PROVENANCE_SCHEMA_V1 = "programmable.module-engine.provenance.v1" as const;
const zeroHash = `0x${"00".repeat(32)}`;
const zeroAddress = `0x${"00".repeat(20)}`;
const optionalHash = (value: unknown, label: string) => { const v = bytes(value, label, 32); if (v.length !== 66)
    fail(label); return v; };
const obj = (value: unknown, label: string) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
        fail(label);
    return record(value, Object.keys(value), label);
};
/** Internal consistency after authenticated dual-RPC observation; it does not admit caller supplied launch JSON. */
export function normalizeModuleEngineLaunchV1(value: unknown, profile: ModuleEngineReleaseIdentity) {
    const release = moduleEngineReleaseIdentity(profile), anyQuote = isModuleEngineAnyQuoteRelease(release);
    const abi = anyQuote ? MODULE_ENGINE_ANY_QUOTE_INDEX_ABI_V1 : MODULE_ENGINE_INDEX_ABI_V1;
    const pins = Object.fromEntries(Object.entries(release.contracts).map(([role, pin]) => [role, { address: address(pin.address, `engine.${role}`), runtimeCodeHash: hash(pin.runtimeCodeHash, `engine.${role}.code`) }])) as typeof release.contracts;
    const raw = record(value, ["schemaVersion", "header", "receipt", "event", "state", "runtimeReads", "market", "verification"], "engine.evidence");
    equal(raw.schemaVersion, MODULE_ENGINE_EVIDENCE_SCHEMA_V1, "engine.schema");
    const header = record(raw.header, ["chainId", "blockNumber", "blockHash"], "engine.header");
    equal(header.chainId, 4663, "engine.chain");
    const block: EngineBlock = { chainId: 4663, blockNumber: uint(header.blockNumber, "engine.block", true), blockHash: hash(header.blockHash, "engine.blockHash") };
    if (BigInt(block.blockNumber) < BigInt(release.startBlock))
        fail("engine.before-source");
    const receipt = bound(raw.receipt, ["transactionHash", "status", "logs"], block, "engine.receipt");
    equal(receipt.status, "success", "engine.receipt.status");
    const tx = hash(receipt.transactionHash, "engine.transaction");
    const verification = finality(raw.verification, release, block, tx);
    const logs = list(receipt.logs, "engine.receipt.logs", 4096).map(log => canonicalEngineLog(log, block, tx));
    let last = -1;
    for (const log of logs) {
        if (log.logIndex <= last)
            fail("engine.receipt.log-order");
        last = log.logIndex;
    }
    const event = canonicalEngineLog(raw.event, block, tx);
    same(logs.find(log => log.logIndex === event.logIndex), event, "engine.discovery.receipt");
    const emitted = engineEvent(logs, abi, pins.host.address, "EngineLaunchBound", event.topics[1]);
    same(emitted.log, event, "engine.discovery.event");
    const launchId = hash(emitted.args.launchId, "engine.launchId"), token = address(emitted.args.token, "engine.token"), engine = address(emitted.args.engine, "engine.engine");
    const state = engineReadSet(raw.state, block, abi);
    equal(state.take(pins.host.address, "SOURCE_VERSION"), moduleEngineSourceId(release), "engine.sourceVersion");
    for (const role of ["registry", "tokenFactory", "launchPolicy", "ledger"] as const)
        equal(state.take(pins.host.address, role), pins[role].address, `engine.host.${role}`);
    equal(state.take(pins.ledger.address, "ECONOMICS_POLICY_ID"), release.economicsPolicyId, "engine.ledger.policy");
    if (isModuleEngineAnyQuoteRelease(release)) {
        for (const [account, getter, expected] of anyQuoteSourceBindings(release.contracts)) equal(state.take(account, getter), expected, `anyQuote.source.${getter}`);
    } else for (const [field, expected] of [["hook", pins.host.address], ["registry", pins.registry.address], ["poolManager", pins.poolManager.address]] as const)
        equal(state.take(pins.ledger.address, field), expected, `engine.ledger.${field}`);
    equal(emitted.args.economicsPolicyId, release.economicsPolicyId, "engine.event.policy");
    const launch = obj(state.take(pins.host.address, "getLaunch", [launchId]), "engine.launch");
    for (const [field, eventValue] of Object.entries(emitted.args))
        if (field !== "economicsPolicyId")
            equal(launch[field === "runtimeCodeHash" ? "engineCodeHash" : field], eventValue, `engine.launch.${field}`);
    // Policy is an immutable ledger binding; it is deliberately absent from the host's Launch struct.
    const creator = address(launch.creator, "engine.creator"), quoteAsset = address(launch.quoteAsset, "engine.quoteAsset"), revisionId = hash(launch.revisionId, "engine.revisionId");
    if (token === quoteAsset)
        fail("engine.identical-assets");
    equal(state.take(pins.host.address, "launchIdOf", [token]), launchId, "engine.token-launch");
    equal(state.take(pins.host.address, "engineLaunchId", [engine]), launchId, "engine.engine-launch");
    const inputs = engineEvent(logs, abi, pins.host.address, "EngineLaunchParametersBound", launchId);
    if (inputs.logIndex <= emitted.logIndex)
        fail("engine.inputs.order");
    const encoded = bytes(inputs.args.encodedParameters, "engine.parameters", MODULE_ENGINE_PARAMETERS_MAX_BYTES_V1);
    const parameterAbi = parseAbiParameters(`${ENGINE_LAUNCH_PARAMETERS} parameters`);
    const decoded = decodeAbiParameters(parameterAbi, encoded)[0];
    equal(encoded, encodeAbiParameters(parameterAbi, [decoded]), "engine.parameters.canonical");
    const p = obj(plain(decoded), "engine.parameters");
    const configuration = bytes(p.configuration, "engine.configuration", 16384), creation = bytes(p.creationCode, "engine.creationCode", 49152), template = bytes(p.runtimeTemplate, "engine.runtimeTemplate", 24576);
    if (creation === "0x" || template === "0x")
        fail("engine.empty-code");
    bytes(p.launchData, "engine.launchData", 16384);
    equal(hash(p.revisionId, "engine.parameter.revision"), revisionId, "engine.parameter.revision");
    equal(address(p.quoteAsset, "engine.parameter.quote"), quoteAsset, "engine.parameter.quote");
    const configHash = keccak256(configuration);
    equal(configHash, launch.configurationHash, "engine.configurationHash");
    equal(keccak256(encodeAbiParameters(parseAbiParameters("uint256,address,address,bytes32,bytes32"), [4663n, pins.host.address, token, revisionId, configHash])), launchId, "engine.computedLaunchId");
    equal(keccak256(encodeAbiParameters(moduleEnginePlanParameters, [4663n, pins.host.address, creator, decoded])), launch.planHash, "engine.computedPlanHash");
    const context = { host: pins.host.address, launchId, token, creator, quoteAsset, feeCollector: anyQuote ? pins.ledger.address : pins.host.address };
    const constructor = encodeAbiParameters(moduleEngineConstructorParameters, [context, configuration]);
    equal(keccak256(constructor), launch.constructorHash, "engine.constructorHash");
    const initCode = concatHex([creation, constructor]);
    if ((initCode.length - 2) / 2 > 49152)
        fail("engine.initCode.bound");
    equal(keccak256(initCode), launch.initCodeHash, "engine.initCodeHash");
    const salt = keccak256(encodeAbiParameters(parseAbiParameters("address,bytes32,bytes32"), [creator, optionalHash(p.engineSalt, "engine.engineSalt"), launchId]));
    equal(getCreate2Address({ from: pins.host.address, salt, bytecodeHash: keccak256(initCode) }).toLowerCase(), engine, "engine.create2");
    equal(state.take(engine, "contextHash"), keccak256(encodeAbiParameters(parseAbiParameters("(address host,bytes32 launchId,address token,address creator,address quoteAsset,address feeCollector)"), [context])), "engine.contextHash");
    const revisionTuple = list(state.take(pins.host.address, "getRevision", [revisionId]), "engine.revision", 4);
    if (revisionTuple.length !== 4)
        fail("engine.revision");
    const revision = obj(revisionTuple[0], "engine.revision.record");
    const familyId = hash(revision.familyId, "engine.familyId"), manifestHash = hash(revision.manifestHash, "engine.manifestHash");
    const family = list(state.take(pins.registry.address, "families", [familyId]), "engine.family", 2);
    if (family.length !== 2)
        fail("engine.family");
    address(family[0], "engine.family.author");
    address(family[1], "engine.family.wallet");
    equal(revision.creationCodeHash, keccak256(creation), "engine.revision.creation");
    equal(revision.runtimeTemplateHash, keccak256(template), "engine.revision.runtime");
    equal(integer(revision.coinRights, "engine.coinRights"), 0, "engine.coinRights");
    const moneyRights = integer(revision.moneyRights, "engine.moneyRights", 7);
    if (integer(revision.executionGas, "engine.executionGas", 10000000) < 50000 || typeof revision.enabled !== "boolean")
        fail("engine.revision.execution");
    if (address(revision.fixedQuoteAsset, "engine.fixedQuote", true) !== zeroAddress)
        equal(revision.fixedQuoteAsset, quoteAsset, "engine.fixedQuote");
    if (optionalHash(revision.fixedConfigurationHash, "engine.fixedConfiguration") !== zeroHash)
        equal(revision.fixedConfigurationHash, configHash, "engine.fixedConfiguration");
    const offsets = list(revisionTuple[1], "engine.runtimeOffsets", 128), bindings = list(revisionTuple[2], "engine.constructorOffsets", 128);
    if (offsets.length !== bindings.length)
        fail("engine.immutable.length");
    let runtime = template, lastOffset = -32;
    offsets.forEach((value, index) => {
        const offset = integer(value, "engine.runtimeOffset", 24544), binding = integer(bindings[index], "engine.constructorOffset", 113984);
        if (offset < lastOffset + 32 || binding % 32 !== 0 || (offset + 32) * 2 > template.length - 2 || (binding + 32) * 2 > constructor.length - 2)
            fail("engine.immutable.bounds");
        lastOffset = offset;
        if (template.slice(2 + offset * 2, 2 + (offset + 32) * 2) !== "0".repeat(64))
            fail("engine.immutable.nonzero");
        runtime = `${runtime.slice(0, 2 + offset * 2)}${constructor.slice(2 + binding * 2, 2 + (binding + 32) * 2)}${runtime.slice(2 + (offset + 32) * 2)}` as Hex;
    });
    equal(keccak256(runtime), launch.engineCodeHash, "engine.runtimeHash");
    const eligibleFamilies = list(revisionTuple[3], "engine.eligibleFamilies", 8).map(value => hash(value, "engine.eligibleFamily"));
    let prior = 0n;
    for (const f of eligibleFamilies) {
        if (BigInt(f) <= prior)
            fail("engine.eligibleFamily.order");
        prior = BigInt(f);
    }
    const platformFeeBps = anyQuote || eligibleFamilies.length ? 30 : 10;
    const creatorFees = [p.buyCreatorFeeBps, p.sellCreatorFeeBps].map(value => { const bps = integer(value, "engine.creatorFee", 1000); if (bps % 100 !== 0)
        fail("engine.creatorFee.step"); return bps; });
    equal(launch.buyCreatorFeeBps, creatorFees[0], "engine.buyFee");
    equal(launch.sellCreatorFeeBps, creatorFees[1], "engine.sellFee");
    if (!anyQuote) {
        same(state.take(pins.host.address, "feeTerms", [launchId, true]), [platformFeeBps, creatorFees[0]], "engine.buyFeeTerms");
        same(state.take(pins.host.address, "feeTerms", [launchId, false]), [platformFeeBps, creatorFees[1]], "engine.sellFeeTerms");
    }
    const registered = engineEvent(logs, abi, pins.ledger.address, anyQuote ? "QuoteLaunchRegistered" : "PoolRegistered", launchId);
    if (registered.logIndex >= emitted.logIndex)
        fail("engine.ledger.registration-order");
    const wallets = list(p.creatorWallets, "engine.creatorWallets", 10).map(value => address(value, "engine.creatorWallet")), shares = list(p.creatorSharesBps, "engine.creatorShares", 10).map(value => integer(value, "engine.creatorShare", 10000));
    if (!wallets.length || wallets.length !== shares.length || shares.some(v => v === 0) || shares.reduce((a, b) => a + b, 0) !== 10000 || new Set(wallets).size !== wallets.length)
        fail("engine.creatorAllocation");
    const ledgerConfig = isModuleEngineAnyQuoteRelease(release) ? keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint256,address,address,address,address,bytes32,address,address[],uint16[]"), [release.economicsPolicyId, 4663n, pins.ledger.address, pins.poolManager.address, release.contracts.sharedHook.address, pins.host.address, launchId, quoteAsset, wallets, shares])) : keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint256,address,address,bytes32,address[],uint16[],bytes32[]"), [release.economicsPolicyId, 4663n, pins.ledger.address, pins.host.address, launchId, wallets, shares, eligibleFamilies]));
    equal(registered.args.configurationHash, ledgerConfig, "engine.ledgerConfiguration.event");
    same(registered.args.creatorWallets, wallets, "engine.ledgerCreators");
    same(registered.args.creatorSharesBps, shares, "engine.ledgerShares");
    if (anyQuote) equal(registered.args.asset, quoteAsset, "anyQuote.ledger.asset");
    else same(registered.args.moduleFamilies, eligibleFamilies, "engine.ledgerFamilies");
    equal(state.take(pins.ledger.address, "configurationHash", [launchId]), ledgerConfig, "engine.ledgerConfiguration.getter");
    equal(state.take(pins.ledger.address, "platformFeeBps", [launchId]), platformFeeBps, "engine.platformFee");
    if (anyQuote) equal(state.take(pins.ledger.address, "quoteAsset", [launchId]), quoteAsset, "anyQuote.ledger.quoteAsset");
    else {
        equal(state.take(pins.ledger.address, "moduleCount", [launchId]), String(eligibleFamilies.length), "engine.familiesCount");
        eligibleFamilies.forEach((family, index) => equal(state.take(pins.ledger.address, "moduleFamilyAt", [launchId, BigInt(index)]), family, "engine.feeFamily"));
    }
    const name = text(p.name, "engine.name", 64), symbol = text(p.symbol, "engine.symbol", 16);
    for (const [getter, expected] of [["name", name], ["symbol", symbol], ["decimals", 18], ["totalSupply", "1000000000000000000000000000"], ["creator", pins.host.address]] as const)
        equal(state.take(token, getter), expected, `engine.token.${getter}`);
    const graffiti = keccak256(encodeAbiParameters(parseAbiParameters("string,address,bytes32"), [anyQuote ? "programmable.module-engine.any-quote-token.v1" : "programmable.module-engine.token.v1", creator, optionalHash(p.creatorSalt, "engine.creatorSalt")]));
    equal(state.take(token, "graffiti"), graffiti, "engine.token.graffiti");
    const tokenSalt = keccak256(encodeAbiParameters(parseAbiParameters("string,string,uint8,address,bytes32"), [name, symbol, 18, pins.host.address, graffiti]));
    equal(getCreate2Address({ from: pins.tokenFactory.address, salt: tokenSalt, bytecodeHash: release.tokenCreationCodeHash }).toLowerCase(), token, "engine.token.create2");
    equal(state.take(pins.tokenFactory.address, "getUERC20Address", [name, symbol, 18, pins.host.address, graffiti]), token, "engine.token.prediction");
    const quoteDecimals = integer(state.take(quoteAsset, "decimals"), "engine.quoteDecimals", anyQuote ? 36 : 18);
    const operation = obj(p.initialOperation, "engine.initialOperation");
    bytes(operation.data, "engine.initialData", 16384);
    const operationId = optionalHash(operation.operationId, "engine.operationId"), requiredOperation = optionalHash(revision.initialOperationId, "engine.requiredOperation");
    if (operationId !== zeroHash) {
        const nativeBuy = anyQuote && operationId === keccak256(toHex("spot.buy.native-exact-input.v1"));
        if (!nativeBuy) equal(operationId, requiredOperation, "engine.initialOperationId");
        const permission = nativeBuy ? { operationId, inputRoles: 4, outputRoles: 1, authorization: 0 } : obj(state.take(pins.host.address, "permission", [revisionId, operationId]), "engine.permission");
        equal(permission.operationId, operationId, "engine.permission.id");
        const inputRoles = integer(permission.inputRoles, "engine.inputRoles", 7), outputRoles = integer(permission.outputRoles, "engine.outputRoles", 7);
        integer(permission.authorization, "engine.authorization", 1);
        if (!nativeBuy && (inputRoles & ~moneyRights) !== 0)
            fail("engine.permission.moneyRights");
        equal(operation.actor, creator, "engine.operation.actor");
        equal(uint(operation.nonce, "engine.operation.nonce"), "0", "engine.initialNonce");
        const executed = engineEvent(logs.filter(log => log.logIndex < emitted.logIndex), abi, pins.host.address, "EngineOperationExecuted", launchId);
        for (const key of ["operationId", "actor", "recipient", "nonce", "inputAsset", "inputAmount", "outputAsset"])
            equal(executed.args[key], operation[key], `engine.operation.${key}`);
        if (BigInt(uint(executed.args.outputAmount, "engine.output")) < BigInt(uint(operation.minimumOutput, "engine.minimumOutput")))
            fail("engine.output.short");
        hash(executed.args.resultHash, "engine.operation.resultHash");
        const role = (asset: unknown, amount: unknown) => { const a = address(asset, "engine.asset", true); return a === zeroAddress ? (uint(amount, "engine.amount") === "0" ? 0 : 4) : a === token ? 1 : a === quoteAsset ? 2 : fail("engine.asset.role"); };
        const inRole = role(operation.inputAsset, operation.inputAmount), outRole = role(operation.outputAsset, operation.minimumOutput);
        if ((inRole & inputRoles) !== inRole || (outRole & outputRoles) !== outRole)
            fail("engine.operation.permissions");
    }
    else if (anyQuote) {
        for (const key of ["actor", "recipient", "inputAsset", "outputAsset"]) equal(operation[key], zeroAddress, "anyQuote.initial.empty-address");
        for (const key of ["inputAmount", "minimumOutput", "deadline", "nonce"]) equal(operation[key], "0", "anyQuote.initial.empty-amount");
        equal(operation.data, "0x", "anyQuote.initial.empty-data");
    } else equal(requiredOperation, zeroHash, "engine.initial.required");
    state.done();
    const codes = list(raw.runtimeReads, "engine.codes", 16).map(v => { const r = bound(v, ["address", "code"], block, "engine.code"); return { address: address(r.address, "engine.code.address"), code: bytes(r.code, "engine.code.bytes", 24576) }; });
    const seen = new Set<string>();
    for (const code of codes) {
        if (code.code === "0x" || seen.has(code.address))
            fail("engine.code.duplicate-or-empty");
        seen.add(code.address);
    }
    const used = new Set<Address>();
    const requireCode = (account: Address, expected?: Hex) => { const code = codes.find(c => c.address === account); if (!code)
        fail("engine.code.missing"); used.add(account); if (expected)
        equal(keccak256(code.code), expected, "engine.code.pin"); return code.code; };
    for (const pin of Object.values(pins))
        requireCode(pin.address, pin.runtimeCodeHash);
    // UERC20 has per-launch immutables. Authority comes from the pinned factory/creation hash,
    // CREATE2 and immutable getters above; retain the actual token runtime hash as an observation.
    const tokenRuntimeCodeHash = keccak256(requireCode(token));
    equal(requireCode(engine, hash(launch.engineCodeHash, "engine.code.hash")), runtime, "engine.runtime.bytes");
    requireCode(quoteAsset);
    const primaryMarket = isModuleEngineAnyQuoteRelease(release) ? normalizeAnyQuoteMarket(raw.market, block, release.contracts, { launchId, token, quoteAsset, engine, revisionId, familyId, configuration, configurationHash: configHash, quoteDecimals, resourcesHash: hash(launch.resourcesHash, "anyQuote.resourcesHash"), buyCreatorFeeBps: creatorFees[0]!, sellCreatorFeeBps: creatorFees[1]!, launchLogIndex: emitted.logIndex }, logs) : raw.market === null ? null : normalizeMarket(raw.market, block, pins, launchId, token, quoteAsset, engine, quoteDecimals, hash(launch.resourcesHash, "engine.resourcesHash"), logs);
    if (used.size !== codes.length)
        fail("engine.code.unused");
    return Object.freeze({ schemaVersion: MODULE_ENGINE_PROVENANCE_SCHEMA_V1, kind: "module-engine" as const, chainId: 4663 as const, sourceVersion: release.sourceVersion, sourceReleaseDigest: release.releaseDigest,
        host: pins.host.address, launchId, token, tokenRuntimeCodeHash, creator, quoteAsset, quoteDecimals, engine, revisionId, familyId, manifestHash, engineCodeHash: hash(launch.engineCodeHash, "engine.runtimeHash"), configurationHash: configHash,
        constructorHash: hash(launch.constructorHash, "engine.constructorHash"), initCodeHash: hash(launch.initCodeHash, "engine.initCodeHash"), planHash: hash(launch.planHash, "engine.planHash"), resourcesHash: hash(launch.resourcesHash, "engine.resourcesHash"),
        transactionHash: tx, logIndex: event.logIndex, blockNumber: block.blockNumber, blockHash: block.blockHash, name, symbol, configuration, economicsPolicyId: release.economicsPolicyId,
        ...(anyQuote ? { feeLedgerAddress: pins.ledger.address } : {}),
        protocolFeeBps: anyQuote ? 30 : 10, authorPoolFeeBps: anyQuote ? 0 : eligibleFamilies.length ? 20 : 0, platformFeeBps, buyCreatorFeeBps: creatorFees[0]!, sellCreatorFeeBps: creatorFees[1]!, eligibleFamilies: Object.freeze(eligibleFamilies),
        creatorWallets: Object.freeze(wallets), creatorSharesBps: Object.freeze(shares), primaryMarket, marketStatus: primaryMarket ? "verified" as const : "unobserved" as const, ...verification });
}
function normalizeMarket(value: unknown, block: EngineBlock, pins: ModuleEngineReleaseIdentity["contracts"], launchId: Hex, token: Address, quoteAsset: Address, engine: Address, quoteDecimals: number, resourcesHash: Hex, logs: ReturnType<typeof canonicalEngineLog>[]) {
    const state = engineReadSet(value, block, MODULE_ENGINE_INDEX_ABI_V1);
    const poolKey = obj(state.take(engine, "poolKey"), "engine.market.poolKey");
    const currencies = [token, quoteAsset].sort();
    same(poolKey, { currency0: currencies[0], currency1: currencies[1], fee: 0, tickSpacing: 200, hooks: engine }, "engine.market.poolKey");
    const poolId = keccak256(encodeAbiParameters(parseAbiParameters("address,address,uint24,int24,address"), [currencies[0]!, currencies[1]!, 0, 200, engine]));
    equal(state.take(engine, "poolId"), poolId, "engine.market.poolId");
    equal(state.take(engine, "poolManager"), pins.poolManager.address, "engine.market.poolManager");
    const initialize = engineEvent(logs, MODULE_ENGINE_INDEX_ABI_V1, pins.poolManager.address, "Initialize", poolId);
    for (const [key, value] of Object.entries(poolKey))
        equal(initialize.args[key], value, `engine.market.initialize.${key}`);
    const absolute = state.take(engine, "initialAbsoluteTick");
    if (typeof absolute !== "number" || !Number.isInteger(absolute) || absolute <= 0 || absolute >= 887272 || absolute % 200 !== 0)
        fail("engine.market.tick");
    const tick = quoteAsset < token ? absolute : -absolute;
    equal(initialize.args.tick, tick, "engine.market.tick");
    const sqrt = BigInt(uint(initialize.args.sqrtPriceX96, "engine.market.sqrtPrice", true));
    if (sqrt < 4295128739n || sqrt >= 1461446703485210103287273052203988822378723970342n)
        fail("engine.market.sqrtPrice");
    equal(state.take(engine, "quoteDecimals"), quoteDecimals, "engine.market.quoteDecimals");
    const positionTokenId = uint(state.take(engine, "positionTokenId"), "engine.market.positionTokenId", true), positionRecipient = address(state.take(engine, "positionRecipient"), "engine.market.positionRecipient");
    const dust = uint(state.take(engine, "lockedTokenDust"), "engine.market.dust");
    equal(keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint256,address,int24,uint8,uint256"), [poolId, BigInt(positionTokenId), positionRecipient, tick, quoteDecimals, BigInt(dust)])), resourcesHash, "engine.market.resourcesHash");
    state.done();
    return Object.freeze({ kind: "uniswap-v4" as const, chainId: 4663 as const, launchId, poolManager: pins.poolManager.address, poolId, quoteAsset, primaryToken: token, hook: engine, initialTick: tick });
}
export type ModuleEngineProvenanceV1 = ReturnType<typeof normalizeModuleEngineLaunchV1>;
export function normalizeModuleEngineLaunchesV1(values: readonly unknown[], profile: ModuleEngineReleaseIdentity) { if (values.length > 32)
    fail("engine.launches.limit"); const result = values.map(value => normalizeModuleEngineLaunchV1(value, profile)); if (new Set(result.map(value => `${value.transactionHash}:${value.logIndex}`)).size !== result.length || new Set(result.map(value => value.launchId)).size !== result.length)
    fail("engine.launches.duplicate"); return Object.freeze(result); }
