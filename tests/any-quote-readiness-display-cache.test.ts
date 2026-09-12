import { describe, expect, it } from "vitest";
import { forgetAnyQuoteDisplayCheck, readAnyQuoteDisplayCheck, readAnyQuoteDisplaySymbol, rememberAnyQuoteDisplayCheck } from "@/lib/module-engine/any-quote/readiness-display-cache";
import type { AnyQuoteReadinessV1 } from "@/lib/module-engine/any-quote/types";

// These tests only exercise a display cache; the remaining readiness fields are opaque to it.
const result = (validUntil: number) => ({ status: "compatible", validUntil: String(validUntil), token: { name: "Example", symbol: "PAIR", decimals: 18 } }) as Extract<AnyQuoteReadinessV1, { status: "compatible" }>;

describe("short-lived Any Quote display handoff", () => {
  it("reuses a result only for its exact context and until its evidence expires", () => {
    const key = "release-a:template-a:quote-a", ready = result(1_050);
    rememberAnyQuoteDisplayCheck(key, ready, 1_000_000);
    expect(readAnyQuoteDisplayCheck(key, 1_049_999)).toBe(ready);
    for (const other of ["release-b:template-a:quote-a", "release-a:template-b:quote-a", "release-a:template-a:quote-b"])
      expect(readAnyQuoteDisplayCheck(other, 1_000_000)).toBeNull();
    expect(readAnyQuoteDisplayCheck(key, 1_050_000)).toBeNull();
    expect(readAnyQuoteDisplaySymbol(key)).toBe("PAIR");
    expect(readAnyQuoteDisplaySymbol("release-a:template-a:another-quote")).toBeUndefined();
  });
  it("caps long-lived evidence and lets retry discard a previously successful display", () => {
    const key = "bounded-display", ready = result(5_000);
    rememberAnyQuoteDisplayCheck(key, ready, 1_000_000);
    expect(readAnyQuoteDisplayCheck(key, 1_179_999)).toBe(ready);
    expect(readAnyQuoteDisplayCheck(key, 1_180_000)).toBeNull();
    rememberAnyQuoteDisplayCheck(key, ready, 1_000_000);
    forgetAnyQuoteDisplayCheck(key);
    expect(readAnyQuoteDisplayCheck(key, 1_000_000)).toBeNull();
    expect(readAnyQuoteDisplaySymbol(key)).toBe("PAIR");
    rememberAnyQuoteDisplayCheck(key, result(999), 1_000_000);
    expect(readAnyQuoteDisplayCheck(key, 1_000_000)).toBeNull();
  });
});
