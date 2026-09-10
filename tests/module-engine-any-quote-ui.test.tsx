import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ModuleEngineBuilder } from "@/components/module-engine-builder";
import { ModuleEngineAnyQuoteAsset } from "@/components/module-engine-any-quote-asset";
import { ModuleEngineTransactionReview } from "@/components/module-engine-transaction-review";
import { ModuleEngineFeeChangeReview } from "@/components/module-engine-fee-controls";
import type { PreparedModuleEngineClaim, PreparedModuleEngineFeeChange, PreparedModuleEngineSwap } from "@/lib/module-engine/client";
import { anyQuoteUiFixture } from "./module-engine-any-quote-ui-fixture";
import { ACCOUNT, QUOTE, TOKEN, addr, hash } from "./module-engine-fixture";

const actions = { wallet: { authenticated: false, sessionReady: true }, onConnect: vi.fn(), onSwitch: vi.fn(), onSubmit: vi.fn() };
const base = { sourceKind: "module-engine-v1" as const, account: ACCOUNT, releaseDigest: hash(1), blockNumber: 100n, expiresAt: BigInt(Math.floor(Date.now() / 1_000) + 120), gasEstimate: 200_000n, transaction: { from: ACCOUNT, to: addr(2), data: "0x" as const, value: "0x0" as const }, token: TOKEN, launchId: hash(3), revisionId: hash(4), planHash: hash(5) };

describe("Any Quote LP visible economic and availability boundaries", () => {
  it("offers one CA and optional ETH buy before connecting, without pool, quote-funding or fee-conversion inputs", () => {
    const html = renderToStaticMarkup(<ModuleEngineBuilder {...actions} {...anyQuoteUiFixture()} />);
    expect(html.match(/id="engine-quote"/g)).toHaveLength(1);
    expect(html).toContain("Pair with");
    expect(html).toContain("Initial buy");
    expect(html).toContain("Connect wallet");
    expect(html).toContain("0.3% module fee per buy and sell");
    expect(html).not.toContain("Check token");
    for (const technical of ["Minimum fees in ETH", "Conversion route", "Fixed module settings", "initialTick", "priceEvidenceHash", "Creator fees accrue in ETH"]) expect(html).not.toContain(technical);
  });
  it("keeps provider trouble retryable without declaring the CA invalid", () => {
    const html = renderToStaticMarkup(<ModuleEngineAnyQuoteAsset value={QUOTE} onChange={vi.fn()} availability={{ status: "inconclusive", result: null, retry: vi.fn() }} />);
    expect(html).toContain("Availability could not be checked"); expect(html).toContain("Retry");
    expect(html).not.toContain('aria-invalid="true"'); expect(html).not.toContain("Der Token ist leider nicht verfügbar.");
    const unavailable = renderToStaticMarkup(<ModuleEngineAnyQuoteAsset value={QUOTE} onChange={vi.fn()} availability={{ status: "incompatible", result: { status: "incompatible", chainId: 4663, quoteAsset: QUOTE, code: "NON_ERC20", retryable: false }, retry: vi.fn() }} />);
    expect(unavailable).toContain('aria-invalid="true"'); expect(unavailable).toContain("Der Token ist leider nicht verfügbar.");
  });
  it.each([true, false])("reviews the final ETH direction instead of quote-funded host data (buy=%s)", buy => {
    const prepared: PreparedModuleEngineSwap = { ...base, kind: "swap", buy, quoteAsset: QUOTE, quoteDecimals: 6, recipient: ACCOUNT, inputAmount: 10n ** 18n, outputAmount: 2n * 10n ** 18n, minimumOutput: 19n * 10n ** 17n };
    const html = renderToStaticMarkup(<ModuleEngineTransactionReview prepared={prepared} anyQuote busy={false} onConfirm={vi.fn()} onEdit={vi.fn()} />);
    expect(html).toContain(buy ? "Buy with ETH" : "Sell to ETH"); expect(html).toContain(buy ? "2 tokens" : "2 ETH");
    expect(html).not.toContain("Minimum ETH from fee conversion"); expect(html).not.toContain("action details could not be read");
  });
  it("formats quote claims with the token's decimals and names the reward token", () => {
    const prepared: PreparedModuleEngineClaim = { ...base, kind: "claim", recipient: ACCOUNT, minimumAmount: 1_250_000n, claimedBefore: 0n, feeAsset: QUOTE, feeDecimals: 6 };
    const html = renderToStaticMarkup(<ModuleEngineTransactionReview prepared={prepared} anyQuote quoteAsset={QUOTE} quoteDecimals={6} busy={false} onConfirm={vi.fn()} onEdit={vi.fn()} />);
    expect(html).toContain("Review reward claim"); expect(html).toContain("1.25 pool pair tokens"); expect(html).toContain(QUOTE);
    expect(html).not.toContain("1.25 ETH");
  });
  it("reviews platform rotation as future module fees with historical claims retained", () => {
    const prepared: PreparedModuleEngineFeeChange = { ...base, kind: "rotate-platform", previousWallet: ACCOUNT, recipient: addr(77), authority: "treasury" };
    const html = renderToStaticMarkup(<ModuleEngineFeeChangeReview prepared={prepared} />);
    expect(html).toContain("Module fee wallet"); expect(html).toContain("full 0.3%"); expect(html).toContain("Existing claims stay with the wallets that earned them"); expect(html).not.toContain("Registered author");
  });
});
