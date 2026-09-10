"use client";

import { useEffect, useState } from "react";
import { isAddress, type Hex } from "viem";
import { Check, CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { fetchAnyQuoteReadiness } from "@/lib/module-engine/any-quote/integration-client";
import type { AnyQuoteReadinessV1 } from "@/lib/module-engine/any-quote/types";
import styles from "./module-mode-builder.module.css";
import engineStyles from "./module-engine-ui.module.css";

type AvailabilityStatus = "idle" | "invalid" | "checking" | AnyQuoteReadinessV1["status"];
export interface AnyQuoteAssetAvailability {
  status: AvailabilityStatus;
  result: AnyQuoteReadinessV1 | null;
  retry: () => void;
}

export function anyQuoteUserMessage(error: unknown, fallback: string): string {
  const failure = error as { code?: unknown; status?: unknown } | null;
  if (typeof failure?.code !== "string" || !["incompatible", "inconclusive"].includes(String(failure.status))) return fallback;
  if (failure.code === "INVALID_ADDRESS") return "Enter a valid token address on Robinhood Chain.";
  if (failure.code === "INVALID_AMOUNT") return "Enter a valid amount to continue.";
  if (failure.code === "OUTPUT_TOO_SMALL") return "This amount is too small for the current route. Increase the amount and try again.";
  if (failure.code === "MODULE_UNAVAILABLE") return "This module is temporarily unavailable. Please try again.";
  if (failure.status === "incompatible") return "Der Token ist leider nicht verfügbar.";
  if (/EXPIRED|STATE_CHANGED|PREVIEW_MISMATCH/.test(failure.code)) return "Your quote changed or expired. Review again for a current price and route.";
  return "The price and route could not be confirmed. Please try again.";
}

/** Displayed readiness always belongs to this release, template and CA, never the previous request. */
export function useAnyQuoteAssetAvailability({ enabled, releaseDigest, templateId, quoteAsset }: {
  enabled: boolean; releaseDigest?: Hex; templateId?: string; quoteAsset: string;
}): AnyQuoteAssetAvailability {
  const address = quoteAsset.trim().toLowerCase();
  const validAddress = isAddress(address) && !/^0x0{40}$/.test(address);
  const key = `${releaseDigest ?? ""}:${templateId ?? ""}:${address}`;
  const [attempt, setAttempt] = useState(0);
  const [checked, setChecked] = useState<{ key: string; attempt: number; result: AnyQuoteReadinessV1 | null; status: AvailabilityStatus } | null>(null);

  useEffect(() => {
    if (!enabled || !releaseDigest || !templateId || !validAddress) return;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(async () => {
      setChecked({ key, attempt, status: "checking", result: null });
      timeout = setTimeout(() => {
        controller.abort();
        setChecked({ key, attempt, status: "inconclusive", result: null });
      }, 20_000);
      try {
        const result = await fetchAnyQuoteReadiness({ releaseDigest, templateId, quoteAsset: address, signal: controller.signal });
        if (controller.signal.aborted) return;
        clearTimeout(timeout);
        if (result.chainId !== 4663 || result.quoteAsset?.toLowerCase() !== address) throw new Error("Availability belongs to another token.");
        if (result.status === "compatible") {
          const remaining = Number(result.validUntil) * 1_000 - Date.now();
          if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("Availability expired.");
          expiry = setTimeout(() => setChecked({ key, attempt, status: "inconclusive", result: null }), Math.min(remaining, 180_000));
        }
        setChecked({ key, attempt, status: result.status, result });
      } catch {
        if (!controller.signal.aborted) setChecked({ key, attempt, status: "inconclusive", result: null });
      } finally { clearTimeout(timeout); }
    }, 350);
    return () => { controller.abort(); clearTimeout(timer); clearTimeout(timeout); clearTimeout(expiry); };
  }, [enabled, releaseDigest, templateId, address, validAddress, key, attempt]);

  const current = checked?.key === key && checked.attempt === attempt ? checked : null;
  const status = !enabled || !address ? "idle" : !validAddress ? "invalid" : current?.status ?? "checking";
  return { status, result: current?.result ?? null, retry: () => setAttempt(value => value + 1) };
}

export function ModuleEngineAnyQuoteAsset({ value, onChange, availability }: {
  value: string; onChange: (value: string) => void; availability: AnyQuoteAssetAvailability;
}) {
  const [blurred, setBlurred] = useState(false);
  const invalid = availability.status === "incompatible" || availability.status === "invalid" && blurred;
  const ready = availability.status === "compatible" && availability.result?.status === "compatible" ? availability.result : null;
  const message = availability.status === "checking" ? "Checking token, price and ETH routes…"
    : ready ? `${ready.token.name || ready.token.symbol} (${ready.token.symbol}) is available.`
    : availability.status === "incompatible" ? "Der Token ist leider nicht verfügbar."
    : availability.status === "inconclusive" ? "Availability could not be checked. Please try again."
    : invalid ? "Enter a valid token address on Robinhood Chain." : null;
  return <div className={engineStyles.anyQuoteAsset}>
    <div className={styles.field}>
      <label htmlFor="engine-quote">Pair with</label>
      <input id="engine-quote" value={value} placeholder="Token contract address, 0x…" spellCheck={false} autoComplete="off" autoCapitalize="none"
        required aria-invalid={invalid || undefined} aria-describedby="engine-quote-help engine-quote-availability"
        onBlur={() => setBlurred(true)} onChange={event => { setBlurred(false); onChange(event.target.value); }} />
      <p id="engine-quote-help" className={styles.help}>Enter an ERC20 address on Robinhood Chain. Your coin trades with ETH; this token is its pool pair.</p>
    </div>
    <div id="engine-quote-availability" className={engineStyles.anyQuoteAvailability} data-status={availability.status} role="status" aria-live="polite" aria-atomic="true">
      {message ? <div className={engineStyles.anyQuoteStatusText}>
        {availability.status === "checking" ? <LoaderCircle className={engineStyles.anyQuoteSpinner} size={16} aria-hidden="true" /> : ready ? <Check size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}
        <span>{message}{ready ? <small>ETH buys and sells available. No {ready.token.symbol} balance needed to launch.</small> : null}</span>
      </div> : null}
      {availability.status === "inconclusive" ? <button type="button" className={engineStyles.anyQuoteRetry} onClick={availability.retry}><RefreshCw size={14} aria-hidden="true" />Retry</button> : null}
    </div>
  </div>;
}
