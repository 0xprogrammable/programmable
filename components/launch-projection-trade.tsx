"use client";

import { useId, useRef, useState } from "react";
import { formatUnits, parseUnits, type Hex } from "viem";
import { useWallet } from "@/components/wallet-provider";
import type { LaunchProjectionV1 } from "@/lib/custom-launch/launch-plan-v1";
import { resolveProjectionAddress } from "@/lib/custom-launch/launch-projection-v1";
import type { LaunchPlanTradeWalletReviewV1 } from "@/lib/custom-launch/routed-trade-wallet-v1";
import styles from "./launch-projection-trade.module.css";

const short = (address: string) => address === "0x0000000000000000000000000000000000000000" ? "Native ETH" : `${address.slice(0, 6)}…${address.slice(-4)}`;
const amount = (value: string, decimals: number | null) => decimals === null ? `${value} smallest units` : formatUnits(BigInt(value), decimals);

/** Only a published market starts a quote. The server discovers mechanical
 * compatibility from the current exact transaction; names and tags are inert. */
export function LaunchProjectionTrade({ projection }: { projection: LaunchProjectionV1 }) {
  const wallet = useWallet(); const id = useId(), reviewButton = useRef<HTMLButtonElement>(null), reviewHeading = useRef<HTMLHeadingElement>(null);
  const [marketId, setMarketId] = useState(projection.primaryMarketId ?? projection.markets[0]?.marketId ?? "");
  const [zeroForOne, setZeroForOne] = useState(true), [raw, setRaw] = useState(""), [slippage, setSlippage] = useState("0.5"), [hookData, setHookData] = useState("0x");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [review, setReview] = useState<LaunchPlanTradeWalletReviewV1 | null>(null), [submitted, setSubmitted] = useState<Hex | null>(null);
  if (projection.sourceVersion !== "custom_launch_plan_v1" || projection.markets.length === 0) return null;
  const market = projection.markets.find(item => item.marketId === marketId) ?? projection.markets[0]!;
  const currency0 = resolveProjectionAddress(projection, market.currency0), currency1 = resolveProjectionAddress(projection, market.currency1);
  const inputCurrency = zeroForOne ? currency0 : currency1, outputCurrency = zeroForOne ? currency1 : currency0;
  const nativeInput = inputCurrency === "0x0000000000000000000000000000000000000000";
  const clear = () => { setReview(null); setError(""); setSubmitted(null); };
  async function prepare() {
    if (!wallet.wallet) { wallet.openWallet(); return; }
    setBusy(true); clear();
    try {
      const { parseLaunchPlanTradeRequestV1, ROUTED_TRADE_REQUEST_V1 } = await import("@/lib/custom-launch/routed-trade-plan-v1");
      const request = parseLaunchPlanTradeRequestV1({ schemaVersion: ROUTED_TRADE_REQUEST_V1, chainId: "4663", launchId: projection.launchId,
        planHash: projection.planHash, marketId: market.marketId, owner: wallet.wallet.account, zeroForOne, amountIn: nativeInput ? parseUnits(raw, 18).toString() : raw,
        slippageBps: Math.round(Number(slippage) * 100), deadline: (BigInt(Math.floor(Date.now() / 1000)) + 600n).toString(), hookData });
      const next = await wallet.sendLaunchPlanTradeWalletAction({ action: "review", projection, request });
      if (typeof next === "string") throw new Error("The trade review is unavailable.");
      setReview(next);
      requestAnimationFrame(() => reviewHeading.current?.focus());
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The current trade is unavailable."); }
    finally { setBusy(false); }
  }
  async function send() {
    if (!review || busy) return;
    setBusy(true); setError("");
    try {
      const hash = await wallet.sendLaunchPlanTradeWalletAction({ action: "send", projection, request: review.preparation.request, reviewed: review });
      if (typeof hash !== "string") throw new Error("The wallet did not submit a transaction.");
      setSubmitted(hash); setReview(null); reviewButton.current?.focus();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The wallet transaction was not submitted."); }
    finally { setBusy(false); }
  }
  return <section className={styles.trade} aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`}>Trade this market</h2>
    <p>Review the current swap, platform fee and minimum received before opening your wallet.</p>
    <form onSubmit={event => { event.preventDefault(); void prepare(); }}>
      <fieldset disabled={busy || !!review}>
        <div className={styles.fields}>
          <label htmlFor={`${id}-market`}>Market<select id={`${id}-market`} value={marketId} onChange={event => { clear(); setMarketId(event.target.value); }}>
            {projection.markets.map(item => <option key={item.marketId} value={item.marketId}>{item.marketId}</option>)}
          </select></label>
          <label htmlFor={`${id}-direction`}>Direction<select id={`${id}-direction`} value={String(zeroForOne)} onChange={event => { clear(); setZeroForOne(event.target.value === "true"); }}>
            <option value="true">{short(currency0)} → {short(currency1)}</option><option value="false">{short(currency1)} → {short(currency0)}</option>
          </select></label>
          <label htmlFor={`${id}-amount`}>{nativeInput ? "Amount (ETH)" : "Amount in smallest units"}<input id={`${id}-amount`} aria-describedby={`${id}-units`} inputMode={nativeInput ? "decimal" : "numeric"} pattern={nativeInput ? "[0-9]+(\\.[0-9]{1,18})?" : "[1-9][0-9]*"} required value={raw} onChange={event => { clear(); setRaw(event.target.value); }} /></label>
          <label htmlFor={`${id}-slippage`}>Maximum slippage (%)<input id={`${id}-slippage`} type="number" min="0.01" max="50" step="0.01" required value={slippage} onChange={event => { clear(); setSlippage(event.target.value); }} /></label>
        </div>
        <p id={`${id}-units`} className={styles.hint}>{nativeInput ? "Enter the ETH amount to swap. The review shows gas separately." : "Enter the token’s smallest units. The review uses its onchain decimals to display the amount."}</p>
        <details><summary>Exact assets and hook data</summary><p>From <code>{inputCurrency}</code><br />To <code>{outputCurrency}</code></p>
          <label htmlFor={`${id}-hook`}>Hook data (hex)<input id={`${id}-hook`} value={hookData} pattern="0x([0-9a-fA-F]{2})*" onChange={event => { clear(); setHookData(event.target.value); }} /></label>
        </details>
      </fieldset>
      {!review ? <button ref={reviewButton} type={wallet.wallet ? "submit" : "button"} onClick={wallet.wallet ? undefined : wallet.openWallet} disabled={busy}>{busy ? "Checking exact trade…" : wallet.wallet ? "Review trade" : "Connect wallet"}</button> : null}
    </form>
    {review ? <div className={styles.review} aria-label="Exact trade review">
      <h3 ref={reviewHeading} tabIndex={-1}>{review.preparation.status === "ready" ? "Review swap" : "Approval required"}</h3>
      <dl>
        <div><dt>Maximum input</dt><dd>{amount(review.preparation.request.amountIn, review.preparation.quote.inputDecimals)} {short(inputCurrency)}</dd></div>
        <div><dt>Expected received after route fee</dt><dd>{amount(review.preparation.quote.amountOut, review.preparation.quote.outputDecimals)} {short(outputCurrency)}</dd></div>
        <div><dt>Minimum received</dt><dd>{amount(review.preparation.quote.amountOutMinimum, review.preparation.quote.outputDecimals)} {short(outputCurrency)}</dd></div>
        <div><dt>Programmable route fee</dt><dd>{amount(review.preparation.quote.platformFeeAmount, review.preparation.quote.outputDecimals)} {short(outputCurrency)} ({review.preparation.fee.routedRateBps / 100}%)</dd></div>
        <div><dt>Fee recipient</dt><dd><code>{review.preparation.fee.recipient}</code></dd></div>
        <div><dt>Estimated transaction gas cost</dt><dd>{formatUnits(BigInt(review.maxGasCostWei), 18)} ETH</dd></div>
      </dl>
      <p>{review.preparation.fee.mode === "pool_enforced" ? "The published immutable pool fee proof covers the declared pool paths. This transaction adds no route fee."
        : "This fee applies to swaps built here. External routes and direct pool interactions can bypass it."}</p>
      {review.preparation.status === "approval_required" ? <p>This transaction approves only the requested input amount. Refresh the trade after that approval is included.</p> : null}
      {review.controllerKind === "connected_contract_wallet" ? <p>Your contract wallet must obtain its own approvals. Its wallet shows the final execution fee.</p> : null}
      <details><summary>Exact wallet transaction</summary><pre>{JSON.stringify(review.transaction, null, 2)}</pre></details>
      <div className={styles.actions}><button type="button" disabled={busy} onClick={() => void send()}>{busy ? "Checking wallet handoff…" : review.preparation.status === "ready" ? "Continue in wallet" : "Approve exact amount"}</button>
        <button className={styles.secondary} type="button" disabled={busy} onClick={() => { setReview(null); setError(""); requestAnimationFrame(() => reviewButton.current?.focus()); }}>Cancel review</button></div>
    </div> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {submitted ? <p role="status">Transaction submitted. <a href={`https://robinhoodchain.blockscout.com/tx/${submitted}`} target="_blank" rel="noreferrer">Check inclusion on Explorer<span className="sr-only"> (opens in a new tab)</span></a>. Refresh the trade when it is included.</p> : null}
  </section>;
}
