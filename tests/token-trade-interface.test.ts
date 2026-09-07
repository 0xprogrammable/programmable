import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = readFileSync(
  join(root, "components/token-trade.tsx"),
  "utf8",
);
const detailSource = readFileSync(
  join(root, "components/token-detail-view.tsx"),
  "utf8",
);
const styles = readFileSync(
  join(root, "components/token-experience.module.css"),
  "utf8",
);

describe("token trade amount interface", () => {
  it("keeps validation neutral until an amount submission fails", () => {
    expect(source).toContain(
      "amountInvalid ? styles.amountCardInvalid : \"\"",
    );
    expect(source).toContain(
      "aria-invalid={amountInvalid || undefined}",
    );
    expect(styles).toMatch(
      /\.amountInputRow:focus-within\s*\{[^}]*outline-color:\s*transparent;/s,
    );
    expect(styles).toMatch(
      /\.amountCardInvalid \.amountInputRow:focus-within\s*\{[^}]*outline-color:\s*var\(--danger\);/s,
    );
    expect(styles).toMatch(
      /\.amountInput:focus-visible\s*\{[^}]*box-shadow:\s*inset 0 -2px 0 var\(--focus\);[^}]*outline:\s*0;/s,
    );
    expect(styles).toMatch(
      /@media \(forced-colors: active\)[\s\S]*?\.amountInput:focus-visible\s*\{[^}]*outline:\s*2px solid ButtonText;/s,
    );
  });

  it("uses a compact amount surface without shrinking touch controls", () => {
    expect(styles).toMatch(
      /\.amountCard\s*\{[^}]*min-height:\s*116px;[^}]*padding:\s*10px 14px 9px;/s,
    );
    expect(styles).toMatch(
      /\.amountInput\s*\{[^}]*height:\s*44px;/s,
    );
    expect(styles).toMatch(
      /\.maxButton\s*\{[^}]*min-height:\s*44px;[^}]*min-width:\s*44px;/s,
    );
    expect(styles).toMatch(
      /\.sideButton\s*\{[^}]*min-height:\s*44px;/s,
    );
  });

  it("keeps Classic V4 hook costs distinct without relabeling legacy trades", () => {
    expect(source).toContain(
      'feePresentation = "legacy-pool"',
    );
    expect(source).toContain('"Hook swap fee"');
    expect(source).toContain('"Curve price impact"');
    expect(source).toContain("Total execution cost");
    expect(source).toContain("TRADE_SLIPPAGE_PRESET_BPS.map");
    expect(source).toMatch(
      /feePresentation === "classic-v4-hook"\s*\? "Hook swap fee"\s*:\s*"Pool fee"/s,
    );
    expect(source).toMatch(
      /feePresentation === "classic-v4-hook"\s*\? "Curve price impact"\s*:\s*"Estimated price impact"/s,
    );
    expect(source).toContain("deadline: String(input.nowSeconds + TRADE_QUOTE_VALIDITY_SECONDS)");
    expect(source).not.toContain("deadline: String(input.nowSeconds + 1_200)");
  });

  it("keeps token detail pages informational while the reusable trade component remains available", () => {
    expect(source).toContain("export function TokenTrade");
    expect(source).toContain("export function PreparedTradeReview");
    expect(detailSource).not.toMatch(/<(?:TokenTrade|PreparedTradeReview|CustomMarketTrade)\b/);
    expect(detailSource).not.toContain('fetch("/api/trade/prepare"');
    expect(detailSource).not.toContain("prepareNextTrade");
    expect(detailSource).toContain("<TokenPriceChart");
    expect(detailSource).toContain("TokenIdentityActions");
  });
});
