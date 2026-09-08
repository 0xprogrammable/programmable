/** LOCAL UI TEST ONLY. No RPC, API, wallet extension or transaction broadcast is used. */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { concatHex, decodeFunctionData, encodeAbiParameters, encodeFunctionResult, erc20Abi, keccak256, parseAbiParameters, type Address, type Hex } from "viem";
import { ModuleEngineBuilder } from "@/components/module-engine-builder";
import { ModuleEngineConsole } from "@/components/module-engine-console";
import type { ModuleModeWalletSnapshot } from "@/components/module-mode-wallet-state";
import { moduleEngineHostAbi, moduleEngineLedgerAbi } from "@/lib/module-engine/abi";
import { computeModuleEngineHostManifestHash, ENGINE_ZERO_ADDRESS } from "@/lib/module-engine/catalog";
import { encodeModuleEngineConfiguration } from "@/lib/module-engine/configuration";
import { compileOpenConfig } from "@/packages/classic-modules/src/open-config.mjs";
import { ENGINE_OPERATIONS, type ModuleEngineClient, type ModuleEngineOperation, type ModuleEngineReceiptResult, type PreparedModuleEngineTransaction } from "@/lib/module-engine/client";
import { fixture, ACCOUNT, QUOTE, TOKEN, addr, hash, CODE_HASH } from "../module-engine-fixture";
import "./module-engine-ui.css";

const scenarios = ["builder-general", "builder-library", "builder-fixed", "builder-approval", "builder-quote", "console-escrow", "console-unlocked", "console-settlement", "console-refund", "console-stranger", "console-quote", "builder-custom", "console-custom", "console-custom-stranger", "unavailable"];
const scenario = new URLSearchParams(location.search).get("scenario") ?? scenarios[0];
const test = fixture(), m = test.template.manifest.manifest;
const settlement = !scenario.includes("custom") && (scenario.includes("settlement") || scenario.includes("refund") || scenario.includes("stranger"));
const quoteProfile = scenario.includes("quote");
const unlocked = scenario.includes("unlocked");
const payer = addr(89), stranger = addr(85), beneficiary = addr(88), requestId = hash(86);
test.state.allowance = scenario === "builder-approval" ? 1n : 10n ** 30n;
test.state.balance = 12_500_000_000n;
test.state.claimable = 15_000_000_000_000_000n;
test.state.claimed = 8_000_000_000_000_000n;
if (scenario.includes("refund")) test.state.refundAfter = test.state.timestamp - 60n;
m.catalogDefinition.fields = { "/unlockTime": { input: "datetime-utc" } };
if (scenario === "builder-fixed") {
  m.revision.fixedQuoteAsset = QUOTE;
  m.catalogDefinition.schema = { type: "record", required: ["unlockTime"], fields: { unlockTime: { type: "uint", binding: { mode: "fixed", value: "2000000000" } } } };
  m.catalogDefinition.title = "Timed escrow · fixed asset";
}
if (scenario === "builder-approval") m.revision.initialOperationId = ENGINE_OPERATIONS.deposit;
if (settlement) {
  m.catalogDefinition.interface = "settlement-v1";
  m.catalogDefinition.title = "Funded settlement";
  m.catalogDefinition.detail = "Fund an obligation for a beneficiary. The creator can attest fulfillment; the payer can refund after the deadline.";
  m.revision.operationPermissions = [
    { operationId: ENGINE_OPERATIONS.request, inputRoles: 2, outputRoles: 0, authorization: 0 },
    { operationId: ENGINE_OPERATIONS.fulfill, inputRoles: 0, outputRoles: 2, authorization: 1 },
    { operationId: ENGINE_OPERATIONS.refund, inputRoles: 0, outputRoles: 2, authorization: 0 },
  ];
}
const suffix = concatHex(["0x000bb8", addr(96)]);
if (quoteProfile) {
  const values = { poolManager: test.release.contracts.poolManager.address, positionManager: addr(70), positionPlanner: addr(71), positionForwarderFactory: addr(72), converter: addr(73), converterCodeHash: CODE_HASH, initialQuotePerTokenX18: "1000000000000000", fixedQuoteAsset: ENGINE_ZERO_ADDRESS, feeConversionRouteSuffix: suffix };
  const components = Object.keys(values).map(name => ({ name, type: name === "converterCodeHash" ? "bytes32" : name === "feeConversionRouteSuffix" ? "bytes" : name === "initialQuotePerTokenX18" ? "uint256" : "address" }));
  const fields = Object.fromEntries(components.map(({ name, type }) => [name, { type: type === "uint256" ? "uint" : type.startsWith("bytes") ? "bytes" : "address", ...(type.startsWith("bytes") ? { maxLength: 128 } : {}), binding: { mode: "fixed", value: values[name as keyof typeof values] } }]));
  m.catalogDefinition.interface = "quote-v1"; m.revision.moneyRights = 3; m.revision.initialOperationId = ENGINE_OPERATIONS.buy;
  m.catalogDefinition.title = "Quote token market";
  m.catalogDefinition.detail = "Trade against your selected quote token. The template fixes how trade fees convert to ETH.";
  m.catalogDefinition.schema = { type: "record", required: ["configuration"], fields: { configuration: { type: "record", required: Object.keys(values), fields } } } as never;
  m.catalogDefinition.defaults = { configuration: values };
  m.catalogDefinition.configurationAbi = [{ path: ["configuration"], type: "tuple", components }];
  delete m.catalogDefinition.fields;
  m.revision.fixedConfigurationHash = keccak256(encodeModuleEngineConfiguration(m.catalogDefinition.configurationAbi, compileOpenConfig(m.catalogDefinition.schema, m.catalogDefinition.defaults), m.catalogDefinition.schema));
  m.revision.operationPermissions = [{ operationId: ENGINE_OPERATIONS.buy, inputRoles: 2, outputRoles: 1, authorization: 0 }, { operationId: ENGINE_OPERATIONS.sell, inputRoles: 1, outputRoles: 2, authorization: 0 }];
}
if (scenario.includes("custom")) {
  m.catalogDefinition.interface = "custom-v1";
  m.catalogDefinition.title = "Custom engine action";
  m.catalogDefinition.detail = "Fixture for explicit reviewed operation data and asset permissions.";
  m.revision.moneyRights = 7;
  m.revision.operationPermissions = [
    { operationId: hash(501), inputRoles: 6, outputRoles: 1, authorization: 0 },
    { operationId: hash(502), inputRoles: 0, outputRoles: 2, authorization: 1 },
  ];
  if (scenario === "builder-custom") m.revision.initialOperationId = hash(501);
}
test.template.manifestHash = computeModuleEngineHostManifestHash(test.template.manifest);
if (scenario === "builder-library") {
  const fixed = structuredClone(test.template), settlementTemplate = structuredClone(test.template);
  fixed.manifest.manifest.catalogDefinition.id = "fixed-escrow-v1"; fixed.manifest.manifest.catalogDefinition.title = "Fixed quote escrow";
  fixed.manifest.manifest.catalogDefinition.summary = "Time-locked deposits with a fixed quote token.";
  fixed.manifest.manifest.revision.packageId = hash(41); fixed.manifest.manifest.revision.fixedQuoteAsset = QUOTE;
  fixed.manifestHash = computeModuleEngineHostManifestHash(fixed.manifest);
  settlementTemplate.manifest.manifest.catalogDefinition.id = "settlement-v1"; settlementTemplate.manifest.manifest.catalogDefinition.title = "Funded settlement";
  settlementTemplate.manifest.manifest.catalogDefinition.interface = "settlement-v1"; settlementTemplate.manifest.manifest.catalogDefinition.summary = "Fund an obligation for a beneficiary.";
  settlementTemplate.manifest.manifest.revision.packageId = hash(42);
  settlementTemplate.manifest.manifest.revision.operationPermissions = [{ operationId: ENGINE_OPERATIONS.request, inputRoles: 2, outputRoles: 0, authorization: 0 }];
  settlementTemplate.manifestHash = computeModuleEngineHostManifestHash(settlementTemplate.manifest);
  test.availability.templates.push(fixed, settlementTemplate);
}
const baseRead = test.client.readContract.bind(test.client), baseCall = test.client.call.bind(test.client);
const rpcEvents: string[] = [];
test.client.readContract = (async (input: { functionName: string; address: Address }) => {
  rpcEvents.push(input.functionName);
  if (input.functionName === "balanceOf" && input.address === TOKEN) return 2_000n * 10n ** 18n;
  if (input.functionName === "unlockTime") return unlocked ? test.state.timestamp - 60n : test.state.timestamp + 3600n;
  if (input.functionName === "credit" || input.functionName === "totalLiability") return 125_000_000n;
  if (input.functionName === "weth") return addr(96);
  if (input.functionName === "feeConversionRoute") return concatHex([QUOTE, suffix]);
  if (input.functionName === "fixedConfigurationHash") return m.revision.fixedConfigurationHash;
  return baseRead(input as never);
}) as ModuleEngineClient["readContract"];
test.client.getBlock = (async () => { test.state.timestamp = BigInt(Math.floor(Date.now() / 1000)); return { number: 100n, hash: test.blockHash, timestamp: test.state.timestamp }; }) as ModuleEngineClient["getBlock"];
test.client.call = (async (input: { data: Hex; to: Address }) => {
  if (input.data.startsWith("0x095ea7b3")) return { data: encodeFunctionResult({ abi: erc20Abi, functionName: "approve", result: true }) };
  if (input.to === test.release.contracts.ledger.address) return { data: encodeFunctionResult({ abi: moduleEngineLedgerAbi, functionName: "claimTo", result: test.state.claimable }) };
  const decoded = decodeFunctionData({ abi: moduleEngineHostAbi, data: input.data });
  if (decoded.functionName === "execute") {
    const operation = decoded.args![1] as ModuleEngineOperation;
    const result = operation.operationId === ENGINE_OPERATIONS.request ? encodeAbiParameters(parseAbiParameters("bytes32"), [requestId]) : quoteProfile ? encodeAbiParameters(parseAbiParameters("uint256,uint256,uint256,uint256,uint256"), [operation.operationId === ENGINE_OPERATIONS.sell ? 1_250_000n : 1_000n * 10n ** 18n, 1_000_000n, 1_000n * 10n ** 18n, 100_000_000_000n, 0n]) : "0x1234";
    return { data: encodeFunctionResult({ abi: moduleEngineHostAbi, functionName: "execute", result }) };
  }
  return baseCall(input as never);
}) as ModuleEngineClient["call"];
const submissions: { kind: string; target: Address; value: Hex; data: Hex }[] = [], uploads: Hex[] = [];
Object.assign(window, { moduleEngineUiTest: { scenario, rpcEvents, submissions, uploads, account: ACCOUNT, quote: QUOTE, requestId, payer, beneficiary } });

function App() {
  const [wallet, setWallet] = useState<ModuleModeWalletSnapshot>({ authenticated: false, sessionReady: true });
  const [mode, setMode] = useState("confirm"), [blocked, setBlocked] = useState(false), [count, setCount] = useState(0);
  const actor = scenario.includes("refund") ? payer : scenario.includes("stranger") ? stranger : ACCOUNT;
  const actions = { wallet, onConnect: () => setWallet({ account: actor, chainId: "1", authenticated: true, sessionReady: true }), onSwitch: () => setWallet({ account: actor, chainId: "4663", authenticated: true, sessionReady: true }), blocked, blockedReason: "TEST ADAPTER: an unresolved wallet request holds the shared account lock.", onSubmit: async (prepared: PreparedModuleEngineTransaction): Promise<ModuleEngineReceiptResult> => {
    submissions.push({ kind: prepared.kind, target: prepared.transaction.to, value: prepared.transaction.value, data: prepared.transaction.data }); setCount(submissions.length);
    if (mode === "reject") throw new Error("Test wallet: request rejected. No transaction was sent.");
    if (mode === "pending") { setBlocked(true); throw new Error("Test wallet: response uncertain. Resolve the pending operation before retrying."); }
    if (prepared.kind === "approve") test.state.allowance = prepared.amount;
    if (prepared.kind === "claim") { test.state.claimed += test.state.claimable; test.state.claimable = 0n; }
    if (prepared.kind === "execute") test.state.nonce++;
    return { sourceKind: "module-engine-v1", kind: prepared.kind, status: "mined", finalized: false, indexed: false, transactionHash: hash(700 + submissions.length), blockNumber: 100n, blockHash: test.blockHash };
  } };
  return <><aside className="fixture-banner" aria-label="Local test adapters"><strong>LOCAL UI TEST · TEST WALLET / RPC / CATALOG</strong><p>Seeded contract responses and simulated wallet results. No real transaction or published availability.</p><div className="fixture-controls"><label>Test scenario<select value={scenario} onChange={event => { location.search = `?scenario=${event.target.value}`; }}>{scenarios.map(value => <option key={value}>{value}</option>)}</select></label><label>Test wallet response<select value={mode} onChange={event => setMode(event.target.value)}><option value="confirm">Simulate mined</option><option value="reject">Reject request</option><option value="pending">Uncertain request</option></select></label><output aria-label="Test wallet calls">Wallet calls: {count}</output></div></aside><main>{scenario.startsWith("console") ? <ModuleEngineConsole {...actions} release={test.release} template={test.template} token={TOKEN} client={test.client} statusContent={blocked ? <p role="status">TEST RECOVERY SLOT: the existing account request is pending.</p> : null} /> : <ModuleEngineBuilder {...actions} client={test.client} onUploadImage={async image => { uploads.push(image.sha256); return "https://fixture.invalid/coin-test.webp"; }} statusContent={blocked ? <p role="status">TEST RECOVERY SLOT: the existing account request is pending.</p> : null} versionContent={<div className="fixture-version"><label>Template version<select defaultValue="1"><option value="1">Version 1 · test publication</option></select></label></div>} availability={scenario === "unavailable" ? { schemaVersion: "programmable.module-engine.availability.v1", release: null, templates: [], reason: "No reviewed template is available in this test scenario." } : test.availability} />}</main></>;
}
createRoot(document.getElementById("root")!).render(<App />);
