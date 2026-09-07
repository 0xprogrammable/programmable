"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

export type MarketCapMetric =
  | { kind: "usd"; value: number }
  | { kind: "eth"; value: number }
  | { kind: "quote"; symbol: string; value: number };

export const MARKET_CAP_ANIMATION_DURATION_MS = 280;

const useClientLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

const usdStandardFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "standard",
  maximumFractionDigits: 2,
});
const usdCompactFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumSignificantDigits: 3,
});
const standardNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "standard",
  maximumFractionDigits: 4,
});
const standardLargeNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "standard",
  maximumFractionDigits: 1,
});
const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function compactUsd(value: number) {
  return value < 1_000
    ? usdStandardFormatter.format(value)
    : usdCompactFormatter.format(value);
}

function compactNumber(value: number) {
  return value >= 1_000
    ? compactNumberFormatter.format(value)
    : value >= 100
      ? standardLargeNumberFormatter.format(value)
      : standardNumberFormatter.format(value);
}

export function formatMarketCapMetric(
  metric: MarketCapMetric,
  value = metric.value,
) {
  return formatMarketCapValue(
    metric.kind,
    metric.kind === "quote" ? metric.symbol : "",
    value,
  );
}

function formatMarketCapValue(
  kind: MarketCapMetric["kind"],
  symbol: string,
  value: number,
) {
  if (kind === "usd") {
    return compactUsd(value);
  }

  const formatted =
    kind === "eth" && value > 0 && value < 0.0001
      ? value.toExponential(2)
      : compactNumber(value);

  return `${formatted} ${kind === "eth" ? "ETH" : symbol}`;
}

function hasSameMetricIdentity(
  previousMetric: MarketCapMetric,
  nextMetric: MarketCapMetric,
) {
  if (previousMetric.kind !== nextMetric.kind) return false;

  return previousMetric.kind !== "quote" ||
    (nextMetric.kind === "quote" &&
      previousMetric.symbol === nextMetric.symbol);
}

export function shouldAnimateMarketCapChange({
  nextMetric,
  nextReplayKey,
  previousMetric,
  previousReplayKey,
  reducedMotion,
  displayedValue,
}: Readonly<{
  nextMetric: MarketCapMetric;
  nextReplayKey: string;
  previousMetric: MarketCapMetric | null;
  previousReplayKey: string | null;
  reducedMotion: boolean;
  displayedValue?: number;
}>) {
  const fromValue = displayedValue ?? previousMetric?.value;
  if (
    previousMetric === null ||
    previousReplayKey !== nextReplayKey ||
    reducedMotion ||
    !hasSameMetricIdentity(previousMetric, nextMetric) ||
    !Number.isFinite(previousMetric.value) ||
    !Number.isFinite(nextMetric.value) ||
    fromValue === undefined || !Number.isFinite(fromValue) ||
    previousMetric.value < 0 || nextMetric.value < 0 || fromValue < 0 ||
    Object.is(fromValue, nextMetric.value)
  ) {
    return false;
  }

  return formatMarketCapMetric(previousMetric, fromValue) !== formatMarketCapMetric(nextMetric);
}

export function interpolateMarketCapValue(
  fromValue: number,
  toValue: number,
  progress: number,
) {
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const easedProgress = 1 - Math.pow(1 - clampedProgress, 3);
  return fromValue + (toValue - fromValue) * easedProgress;
}

export function AnimatedMarketCap({
  delay = 0,
  metric,
  replayKey,
}: {
  delay?: number;
  metric: MarketCapMetric;
  replayKey: string;
}) {
  const valueRef = useRef<HTMLSpanElement>(null);
  const currentValueRef = useRef(metric.value);
  const previousSnapshotRef = useRef<{
    metric: MarketCapMetric;
    replayKey: string;
  } | null>(null);
  const kind = metric.kind;
  const value = metric.value;
  const symbol = metric.kind === "quote" ? metric.symbol : "";
  const finalLabel = formatMarketCapValue(kind, symbol, value);

  useClientLayoutEffect(() => {
    const element = valueRef.current;
    if (!element) return;

    const nextMetric: MarketCapMetric =
      kind === "quote"
        ? { kind, symbol, value }
        : { kind, value };
    const previousSnapshot = previousSnapshotRef.current;
    const motionPreference = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    const fromValue = currentValueRef.current;
    const shouldAnimate = shouldAnimateMarketCapChange({
      nextMetric,
      nextReplayKey: replayKey,
      previousMetric: previousSnapshot?.metric ?? null,
      previousReplayKey: previousSnapshot?.replayKey ?? null,
      reducedMotion: motionPreference.matches,
      displayedValue: fromValue,
    });

    previousSnapshotRef.current = {
      metric: nextMetric,
      replayKey,
    };

    if (
      !shouldAnimate ||
      !Number.isFinite(fromValue) ||
      Object.is(fromValue, value)
    ) {
      element.textContent = finalLabel;
      currentValueRef.current = value;
      return;
    }

    let animationFrame = 0;
    let delayTimer = 0;
    let active = true;
    const normalizedDelay = Number.isFinite(delay) ? Math.max(0, delay) : 0;

    element.textContent = formatMarketCapValue(
      kind,
      symbol,
      fromValue,
    );

    const startAnimation = () => {
      const start = performance.now();

      const tick = (now: number) => {
        if (!active) return;
        const progress = (now - start) / MARKET_CAP_ANIMATION_DURATION_MS;
        const nextValue = interpolateMarketCapValue(
          fromValue,
          value,
          progress,
        );

        currentValueRef.current = nextValue;
        element.textContent = formatMarketCapValue(
          kind,
          symbol,
          nextValue,
        );

        if (progress < 1) {
          animationFrame = window.requestAnimationFrame(tick);
          return;
        }

        currentValueRef.current = value;
        element.textContent = finalLabel;
      };

      animationFrame = window.requestAnimationFrame(tick);
    };
    if (normalizedDelay > 0) delayTimer = window.setTimeout(startAnimation, normalizedDelay);
    else startAnimation();

    const motionChanged = (event: MediaQueryListEvent) => {
      if (!event.matches) return;
      active = false;
      window.clearTimeout(delayTimer);
      window.cancelAnimationFrame(animationFrame);
      currentValueRef.current = value;
      element.textContent = finalLabel;
    };
    motionPreference.addEventListener("change", motionChanged);

    return () => {
      active = false;
      window.clearTimeout(delayTimer);
      window.cancelAnimationFrame(animationFrame);
      motionPreference.removeEventListener("change", motionChanged);
    };
  }, [delay, finalLabel, kind, replayKey, symbol, value]);

  return (
    <strong
      className="animated-market-cap"
      style={{
        display: "inline-grid",
        fontVariantNumeric: "tabular-nums",
        inlineSize: "100%",
        maxInlineSize: "100%",
        minInlineSize: "7ch",
        overflow: "hidden",
        whiteSpace: "nowrap",
      }}
      title={finalLabel}
    >
      <span
        aria-hidden="true"
        style={{
          gridArea: "1 / 1",
          minInlineSize: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          visibility: "hidden",
        }}
      >
        {finalLabel}
      </span>
      <span
        aria-hidden="true"
        ref={valueRef}
        style={{
          gridArea: "1 / 1",
          minInlineSize: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {finalLabel}
      </span>
      <span className="sr-only">{finalLabel}</span>
    </strong>
  );
}
