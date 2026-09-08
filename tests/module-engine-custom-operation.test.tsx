import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { decodeFunctionData } from "viem";
import { ModuleEngineBuilder } from "../components/module-engine-builder";
import { ModuleEngineTransactionReview } from "../components/module-engine-transaction-review";
import { ModuleEngineCustomOperationFields } from "../components/module-engine-custom-operation";
import { computeModuleEngineHostManifestHash, ENGINE_ZERO_ADDRESS, type ModuleEnginePermission } from "../lib/module-engine/catalog";
import { emptyModuleEngineCustomOperation, moduleEngineAssetOptions, moduleEngineCustomOperationIntent, type ModuleEngineCustomOperationForm } from "../lib/module-engine/custom-operation";
import { ENGINE_OPERATIONS, prepareModuleEngineLaunch, prepareModuleEngineOperation, revalidateModuleEngineTransaction } from "../lib/module-engine/client";
import { moduleEngineHostAbi } from "../lib/module-engine/abi";
import { ACCOUNT, QUOTE, TOKEN, addr, fixture, hash } from "./module-engine-fixture";

const permission: ModuleEnginePermission = { operationId: hash(501), inputRoles: 6, outputRoles: 1, authorization: 0 };
const customForm = () => ({ ...emptyModuleEngineCustomOperation(), inputRole: "quote" as const, inputAmount: "1.25", outputRole: "token" as const, minimumOutput: "2", recipient: addr(88), data: "0xcafe" });
function intent(form: ModuleEngineCustomOperationForm = customForm()) { return moduleEngineCustomOperationIntent({ permission, form, account: ACCOUNT, token: TOKEN, quoteAsset: QUOTE, quoteDecimals: 6 }); }
function customFixture() {
  const f = fixture(), m = f.template.manifest.manifest;
  m.catalogDefinition.interface = "custom-v1"; m.revision.moneyRights = 7; m.revision.operationPermissions = [permission];
  f.template.manifestHash = computeModuleEngineHostManifestHash(f.template.manifest);
  return f;
}

describe("explicit reviewed Engine operations", () => {
  it("converts exact displayed units, retains opaque data and uses only registered asset roles", () => {
    expect(moduleEngineAssetOptions(2).map(role => role.id)).toEqual(["none", "quote"]);
    expect(intent()).toEqual({ operationId: permission.operationId, inputAsset: QUOTE, inputAmount: 1_250_000n, outputAsset: TOKEN, minimumOutput: 2n * 10n ** 18n, recipient: addr(88), data: "0xcafe" });
    expect(intent({ ...customForm(), inputRole: "eth", inputAmount: "0.0002", recipient: "" })).toMatchObject({ inputAsset: ENGINE_ZERO_ADDRESS, inputAmount: 200_000_000_000_000n, recipient: ACCOUNT });
    expect(() => intent({ ...customForm(), inputRole: "token" })).toThrow("reviewed permissions");
    expect(() => intent({ ...customForm(), inputRole: "none" })).toThrow("must be zero");
    expect(() => intent({ ...customForm(), inputAmount: "1.0000001" })).toThrow("6 decimal places");
    expect(() => intent({ ...customForm(), data: "0x123" })).toThrow();
    expect(() => intent({ ...customForm(), data: `0x${"11".repeat(16_385)}` })).toThrow();
    expect(() => intent({ ...customForm(), recipient: ENGINE_ZERO_ADDRESS })).toThrow();
  });
  it("uses the existing exact approval and transaction revalidation for custom operations", async () => {
    const f = customFixture(); f.state.allowance = 0n;
    expect(await prepareModuleEngineOperation({ ...f, account: ACCOUNT, token: TOKEN, intent: intent() })).toMatchObject({ kind: "approval-required", token: QUOTE, amount: 1_250_000n });
    f.state.allowance = 1_250_000n;
    const prepared = await prepareModuleEngineOperation({ ...f, account: ACCOUNT, token: TOKEN, intent: intent() });
    if (prepared.kind !== "execute") throw new Error("Missing operation");
    expect(prepared.operation).toMatchObject(intent());
    f.state.nonce++;
    await expect(revalidateModuleEngineTransaction(prepared, ACCOUNT)).rejects.toThrow("nonce");
  });
  it("preserves creator authorization when preparing a custom action", async () => {
    const f = customFixture(); f.template.manifest.manifest.revision.operationPermissions[0] = { ...permission, authorization: 1 };
    f.template.manifestHash = computeModuleEngineHostManifestHash(f.template.manifest);
    await expect(prepareModuleEngineOperation({ ...f, account: addr(77), token: TOKEN, intent: intent() })).rejects.toThrow("Creator-only");
  });
  it("simulates a custom initial action with exact salts and initialization data", async () => {
    const f = customFixture(); f.template.manifest.manifest.revision.initialOperationId = permission.operationId;
    f.template.manifestHash = computeModuleEngineHostManifestHash(f.template.manifest);
    const prepared = await prepareModuleEngineLaunch({ ...f.launchInput, buyCreatorFeeBps: 500, launchData: "0xbeef", creatorSalt: hash(0), engineSalt: hash(503), initialOperation: ({ token, quoteAsset }) => moduleEngineCustomOperationIntent({ permission, form: customForm(), account: ACCOUNT, token, quoteAsset, quoteDecimals: 6 }) });
    if (prepared.kind !== "launch") throw new Error("Missing launch");
    expect(prepared.initialOperation).toMatchObject({ operationId: permission.operationId, inputAmount: 1_250_000n, outputAsset: prepared.predictedToken, data: "0xcafe" });
    const decoded = decodeFunctionData({ abi: moduleEngineHostAbi, data: prepared.transaction.data });
    expect(decoded.functionName).toBe("launch");
    expect(decoded.args?.[0]).toMatchObject({ creatorSalt: hash(0), engineSalt: hash(503), launchData: "0xbeef" });
    const html = renderToStaticMarkup(<ModuleEngineTransactionReview prepared={prepared} busy={false} showLaunchInputs tradeFees genericAction onConfirm={() => {}} onEdit={() => {}} />);
    expect(prepared).toMatchObject({ buyCreatorFeeBps: 500, sellCreatorFeeBps: 0 });
    expect(html).toContain("Registered creator fees"); expect(html).toContain("5% buy"); expect(html).toContain("Creator salt"); expect(html).toContain(hash(503)); expect(html).toContain("0xbeef");
  });
  it("keeps initialization bytes visible for custom launches without an initial operation", async () => {
    const f = customFixture(), prepared = await prepareModuleEngineLaunch({ ...f.launchInput, launchData: "0xbeef", creatorSalt: hash(0), engineSalt: hash(503) });
    if (prepared.kind !== "launch") throw new Error("Missing launch");
    const html = renderToStaticMarkup(<ModuleEngineTransactionReview prepared={prepared} busy={false} showLaunchInputs tradeFees onConfirm={() => {}} onEdit={() => {}} />);
    expect(html).toContain("Creator salt"); expect(html).toContain("Engine salt"); expect(html).toContain("Initialization data"); expect(html).toContain("0xbeef");
  });
  it("renders required custom launch controls without assigning a known payload ABI to its ID", () => {
    const f = customFixture(); f.template.manifest.manifest.revision.initialOperationId = ENGINE_OPERATIONS.request;
    f.template.manifest.manifest.revision.operationPermissions = [{ ...permission, operationId: ENGINE_OPERATIONS.request }];
    f.template.manifestHash = computeModuleEngineHostManifestHash(f.template.manifest);
    const html = renderToStaticMarkup(<ModuleEngineBuilder {...f} wallet={{ account: ACCOUNT, chainId: "4663", authenticated: true, sessionReady: true }} onConnect={() => {}} onSwitch={() => {}} onSubmit={async () => { throw new Error("No wallet"); }} />);
    expect(html).toContain("engine-initial-action-data"); expect(html).toContain("Advanced launch inputs"); expect(html).toContain("engine-creator-salt"); expect(html).toContain("engine-launch-data");
    expect(html).not.toContain('id="engine-beneficiary"'); expect(html).toContain("Creator fee terms"); expect(html).toContain('id="engine-buy-fee"');
    const fields = renderToStaticMarkup(<ModuleEngineCustomOperationFields id="custom" permission={{ ...permission, inputRoles: 0 }} value={emptyModuleEngineCustomOperation()} account={ACCOUNT} onChange={() => {}} />);
    expect(fields).toContain('for="custom-data"'); expect(fields).toContain('aria-describedby="custom-help custom-data-help"');
    expect(fields).not.toContain('<option value="eth">');
  });
  it("reviews native value and opaque bytes without mislabeling an unknown payload as settlement", async () => {
    const f = customFixture(), prepared = await prepareModuleEngineOperation({ ...f, account: ACCOUNT, token: TOKEN, intent: intent({ ...customForm(), inputRole: "eth", inputAmount: "0.0002" }) });
    if (prepared.kind !== "execute") throw new Error("Missing operation");
    const html = renderToStaticMarkup(<ModuleEngineTransactionReview prepared={{ ...prepared, operation: { ...prepared.operation, operationId: ENGINE_OPERATIONS.request } }} genericAction busy={false} onConfirm={() => {}} onEdit={() => {}} quoteAsset={QUOTE} quoteDecimals={6} />);
    expect(html).toContain("0.0002 ETH"); expect(html).toContain("0xcafe"); expect(html).toContain("Template action"); expect(html).not.toContain("Beneficiary wallet"); expect(html).not.toContain("action details could not be read");
  });
});
