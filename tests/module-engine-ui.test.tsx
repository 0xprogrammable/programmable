import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ModuleEngineBuilder } from "@/components/module-engine-builder";
import { ModuleEngineConsole } from "@/components/module-engine-console";
import { ModuleEngineTransactionReview } from "@/components/module-engine-transaction-review";
import { computeModuleEngineHostManifestHash } from "@/lib/module-engine/catalog";
import { prepareModuleEngineOperation } from "@/lib/module-engine/client";
import { fixture, ACCOUNT, QUOTE, TOKEN } from "./module-engine-fixture";

const actions = { wallet: { account: ACCOUNT, chainId: "4663", authenticated: true, sessionReady: true }, onConnect: vi.fn(), onSwitch: vi.fn(), onSubmit: vi.fn() };
describe("engine UI uses the existing wallet and reviewed configuration", () => {
  it("does not turn an unpublished source into an available launch", () => { const html = renderToStaticMarkup(<ModuleEngineBuilder {...actions} availability={{ schemaVersion: "programmable.module-engine.availability.v1", release: null, templates: [], reason: "Publication is pending." }} />); expect(html).toContain("Publication is pending."); expect(html).toContain("No engine source"); expect(html).not.toContain("Review launch"); });
  it("renders a general quote CA and shared schema fields without inventing a ticker list", () => { const f = fixture(); const html = renderToStaticMarkup(<ModuleEngineBuilder {...actions} {...f} />); expect(html).toContain('id="engine-quote"'); expect(html).toContain("exact ERC20 contract address"); expect(html).toContain("unlockTime"); expect(html).toContain("Check quote asset"); expect(html).not.toContain("USDC"); });
  it("makes a fixed asset and fixed nested value readable but not editable", () => { const f = fixture(); const m = f.template.manifest.manifest; m.revision.fixedQuoteAsset = QUOTE; m.catalogDefinition.schema = { type: "record", required: ["unlockTime"], fields: { unlockTime: { type: "uint", binding: { mode: "fixed", value: "2000000000" } } } }; f.template.manifestHash = computeModuleEngineHostManifestHash(f.template.manifest); const html = renderToStaticMarkup(<ModuleEngineBuilder {...actions} {...f} />); expect(html).toContain(`readOnly=""`); expect(html).toContain(QUOTE); expect(html).toContain("Fixed by template"); expect(html).toContain("2000000000"); });
  it("shows the exact target, calldata, amount and nonce before the wallet callback", async () => { const f = fixture(); const prepared = await prepareModuleEngineOperation({ ...f, account: ACCOUNT, token: TOKEN }); if (prepared.kind !== "execute") throw new Error(); const confirm = vi.fn(); const html = renderToStaticMarkup(<ModuleEngineTransactionReview prepared={prepared} busy={false} onConfirm={confirm} onEdit={vi.fn()} />); expect(html).toContain(f.host); expect(html).toContain(prepared.transaction.data); expect(html).toContain("5000000"); expect(html).toContain("Account nonce"); expect(html).toContain("Confirm in wallet"); expect(confirm).not.toHaveBeenCalled(); });
  it("requires actual state before exposing deposit, fulfillment or refund controls", () => { const f = fixture(); const html = renderToStaticMarkup(<ModuleEngineConsole {...actions} {...f} token={TOKEN} />); expect(html).toContain("Refresh engine state"); expect(html).not.toContain("Review operation"); expect(html).not.toContain("Review fulfillment"); expect(html).not.toContain("Review ETH claim"); });
});
