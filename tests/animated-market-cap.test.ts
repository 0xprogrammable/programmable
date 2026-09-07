import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AnimatedMarketCap,
  formatMarketCapMetric,
  interpolateMarketCapValue,
  MARKET_CAP_ANIMATION_DURATION_MS,
  shouldAnimateMarketCapChange,
  type MarketCapMetric,
} from "../components/animated-market-cap";

function shouldAnimate(
  previousMetric: MarketCapMetric | null,
  nextMetric: MarketCapMetric,
  options: Readonly<{
    nextReplayKey?: string;
    previousReplayKey?: string | null;
    reducedMotion?: boolean;
    displayedValue?: number;
  }> = {},
) {
  return shouldAnimateMarketCapChange({
    nextMetric,
    nextReplayKey: options.nextReplayKey ?? "token-1",
    previousMetric,
    previousReplayKey:
      options.previousReplayKey === undefined
        ? "token-1"
        : options.previousReplayKey,
    reducedMotion: options.reducedMotion ?? false,
    displayedValue: options.displayedValue,
  });
}

describe("market cap formatting", () => {
  it("keeps the Explore USD format while values animate", () => {
    const metric = { kind: "usd", value: 194_000 } as const;

    expect(formatMarketCapMetric(metric, 0)).toBe("$0.00");
    expect(formatMarketCapMetric(metric, 97_000)).toBe("$97K");
    expect(formatMarketCapMetric(metric)).toBe("$194K");
  });

  it("preserves ETH and quote-asset units", () => {
    expect(
      formatMarketCapMetric({ kind: "eth", value: 12.5 }),
    ).toBe("12.5 ETH");
    expect(
      formatMarketCapMetric({
        kind: "quote",
        symbol: "NVDAon",
        value: 4_200,
      }),
    ).toBe("4.2K NVDAon");
  });

  it("formats the current frame consistently when crossing thousands and millions", () => {
    expect(formatMarketCapMetric({ kind: "usd", value: 950 }, 1_050)).toBe("$1.05K");
    expect(formatMarketCapMetric({ kind: "usd", value: 1_050 }, 950)).toBe("$950.00");
    expect(formatMarketCapMetric({ kind: "usd", value: 1_001_000 }, 999_000)).toBe("$999K");
    expect(formatMarketCapMetric({ kind: "usd", value: 999_000 }, 1_001_000)).toBe("$1M");
    expect(formatMarketCapMetric({ kind: "eth", value: 950 }, 1_050)).toBe("1.1K ETH");
  });
});

describe("market cap animation decisions", () => {
  it("renders the first value immediately", () => {
    expect(
      shouldAnimate(null, { kind: "usd", value: 194_000 }, {
        previousReplayKey: null,
      }),
    ).toBe(false);
  });

  it("animates genuine increases and decreases for the same metric", () => {
    expect(
      shouldAnimate(
        { kind: "usd", value: 194_000 },
        { kind: "usd", value: 220_000 },
      ),
    ).toBe(true);
    expect(
      shouldAnimate(
        { kind: "usd", value: 220_000 },
        { kind: "usd", value: 194_000 },
      ),
    ).toBe(true);
  });

  it("does not animate no-ops or changes hidden by compact formatting", () => {
    expect(
      shouldAnimate(
        { kind: "usd", value: 194_000 },
        { kind: "usd", value: 194_000 },
      ),
    ).toBe(false);
    expect(
      shouldAnimate(
        { kind: "usd", value: 194_000 },
        { kind: "usd", value: 194_100 },
      ),
    ).toBe(false);
  });

  it("does not let replayKey changes trigger or bridge animations", () => {
    const metric = { kind: "usd", value: 194_000 } as const;

    expect(
      shouldAnimate(metric, metric, {
        nextReplayKey: "token-2",
        previousReplayKey: "token-1",
      }),
    ).toBe(false);
    expect(
      shouldAnimate(metric, { kind: "usd", value: 220_000 }, {
        nextReplayKey: "token-2",
        previousReplayKey: "token-1",
      }),
    ).toBe(false);
  });

  it("snaps for reduced motion, metric changes, and quote-symbol changes", () => {
    expect(
      shouldAnimate(
        { kind: "usd", value: 194_000 },
        { kind: "usd", value: 220_000 },
        { reducedMotion: true },
      ),
    ).toBe(false);
    expect(
      shouldAnimate(
        { kind: "usd", value: 194_000 },
        { kind: "eth", value: 220_000 },
      ),
    ).toBe(false);
    expect(
      shouldAnimate(
        { kind: "quote", symbol: "ETH", value: 194_000 },
        { kind: "quote", symbol: "HOOD", value: 220_000 },
      ),
    ).toBe(false);
  });

  it("animates a recorded zero without inventing a zero for the initial value", () => {
    expect(
      shouldAnimate(
        { kind: "usd", value: 0 },
        { kind: "usd", value: 220_000 },
      ),
    ).toBe(true);
    expect(shouldAnimate(null, { kind: "usd", value: 220_000 }, { displayedValue: 0 })).toBe(false);
    expect(shouldAnimate({ kind: "usd", value: 100 }, { kind: "usd", value: 0 })).toBe(true);
  });

  it("snaps for negative or non-finite values", () => {
    expect(shouldAnimate({ kind: "usd", value: -1 }, { kind: "usd", value: 100 })).toBe(false);
    expect(
      shouldAnimate(
        { kind: "usd", value: 194_000 },
        { kind: "usd", value: Number.POSITIVE_INFINITY },
      ),
    ).toBe(false);
  });

  it("retargets an interrupted count from the displayed value even if targets share a label", () => {
    const previousTarget = { kind: "usd", value: 1_000_000 } as const;
    const nextTarget = { kind: "usd", value: 1_000_100 } as const;
    expect(formatMarketCapMetric(previousTarget)).toBe(formatMarketCapMetric(nextTarget));
    expect(shouldAnimate(previousTarget, nextTarget, { displayedValue: 975_000 })).toBe(true);
    expect(shouldAnimate(previousTarget, nextTarget, { displayedValue: nextTarget.value })).toBe(false);
    expect(shouldAnimate(previousTarget, nextTarget, { displayedValue: 975_000, reducedMotion: true })).toBe(false);
  });
});

describe("market cap interpolation", () => {
  it("uses a 280ms cubic ease-out in both directions", () => {
    expect(MARKET_CAP_ANIMATION_DURATION_MS).toBe(280);
    expect(interpolateMarketCapValue(100, 200, 0)).toBe(100);
    expect(interpolateMarketCapValue(100, 200, 0.5)).toBe(187.5);
    expect(interpolateMarketCapValue(100, 200, 1)).toBe(200);
    expect(interpolateMarketCapValue(200, 100, 0.5)).toBe(112.5);
  });

  it("clamps late or early animation frames to their endpoints", () => {
    expect(interpolateMarketCapValue(100, 200, -1)).toBe(100);
    expect(interpolateMarketCapValue(100, 200, 2)).toBe(200);
  });

  it.each([[999_000, 1_001_000], [1_001_000, 999_000]])("never overshoots %s to %s across a unit boundary", (from, to) => {
    const values = Array.from({ length: 61 }, (_, index) => interpolateMarketCapValue(from, to, index / 60));
    expect(values[0]).toBe(from);
    expect(values.at(-1)).toBe(to);
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(Math.min(from, to));
      expect(value).toBeLessThanOrEqual(Math.max(from, to));
    }
    const changes = values.slice(1).map((value, index) => Math.abs(value - values[index]));
    expect(changes.every((change, index) => index === 0 || change <= changes[index - 1])).toBe(true);
  });
});

describe("market cap accessibility and sizing", () => {
  it("keeps the visual counter hidden from assistive tech and exposes the final value", () => {
    const html = renderToStaticMarkup(
      createElement(AnimatedMarketCap, {
        metric: { kind: "usd", value: 194_000 },
        replayKey: "token-1",
      }),
    );

    expect(html.match(/aria-hidden="true"/g)).toHaveLength(2);
    expect(html).toContain('<span class="sr-only">$194K</span>');
    expect(html).toContain("font-variant-numeric:tabular-nums");
    expect(html).toContain("inline-size:100%");
    expect(html).toContain("min-inline-size:7ch");
    expect(html).toContain('title="$194K"');
  });
});
