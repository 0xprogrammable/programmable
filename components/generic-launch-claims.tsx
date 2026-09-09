"use client";
import { useEffect, useState } from "react";
import { formatEther, type Hex } from "viem";
import { isBoundLaunchClaimDescriptorV1, projectionObject, projectionUint } from "@/lib/custom-launch/launch-projection-v1";
import type { LaunchClaimReadV1, LaunchClaimWalletInputV1, LaunchClaimWalletReviewV1 } from "@/lib/custom-launch/claim-handoff-v1";
import styles from "./generic-launch-claims.module.css";

type Props = { account: string; sendWallet?: (input: LaunchClaimWalletInputV1) => Promise<LaunchClaimWalletReviewV1 | Hex> };
type ClaimPage = { claims: LaunchClaimReadV1[]; nextCursor: string | null };
async function readClaims(account: string, signal?: AbortSignal, cursor?: string): Promise<ClaimPage> {
  const response = await fetch(`/api/profile/robinhood/claims?account=${encodeURIComponent(account)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store", signal: signal ?? AbortSignal.timeout(15000) });
  const value: unknown = await response.json();
  if (!response.ok || !projectionObject(value) || value.schemaVersion !== "programmable.launch-claim-page.v1" || value.account !== account.toLowerCase()
    || !Array.isArray(value.claims) || value.claims.length > 20 || !(value.nextCursor === null || typeof value.nextCursor === "string" && /^[1-9][0-9]{0,6}$/.test(value.nextCursor))) throw new Error("Claim balances are temporarily unavailable.");
  const claims = value.claims.map(item => {
    if (!projectionObject(item) || typeof item.launchId !== "string" || !isBoundLaunchClaimDescriptorV1(item.descriptor)
      || !(item.claimableRaw === null || projectionUint(item.claimableRaw)) || !["ready", "analysis_pending"].includes(String(item.status))
      || !(item.blockNumber === null || projectionUint(item.blockNumber))
      || ![item.descriptor.requiredController, item.descriptor.beneficiary].some(address => address.toLowerCase() === account.toLowerCase())) throw new Error("Invalid bound claim.");
    return item as LaunchClaimReadV1;
  });
  return { claims, nextCursor: value.nextCursor as string | null };
}
export function GenericLaunchClaims({ account, sendWallet }: Props) {
  const [claims, setClaims] = useState<LaunchClaimReadV1[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null); const [loadingMore, setLoadingMore] = useState(false);
  const [message, setMessage] = useState("Loading claim balances…"); const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void readClaims(account, controller.signal).then(page => {
      if (controller.signal.aborted) return; setClaims(page.claims); setNextCursor(page.nextCursor); setMessage(page.claims.length ? "" : "No bound claim positions are attached to these launches.");
    }).catch(() => { if (!controller.signal.aborted) setMessage("Claim balances are temporarily unavailable. Refresh to retry."); });
    return () => controller.abort();
  }, [account, refresh]);
  async function more() {
    if (!nextCursor) return; setLoadingMore(true);
    try { const page = await readClaims(account, undefined, nextCursor);
      setClaims(previous => [...new Map([...previous, ...page.claims].map(item => [`${item.launchId}:${item.descriptor.accrualContract}:${item.descriptor.claimId}`, item])).values()]); setNextCursor(page.nextCursor);
    } catch { setMessage("More claims could not be loaded. Try again."); } finally { setLoadingMore(false); }
  }
  async function freshClaim(claim: LaunchClaimReadV1) {
    let cursor: string | undefined; const seen = new Set<string>();
    for (;;) { const page = await readClaims(account, undefined, cursor);
      const found = page.claims.find(item => item.launchId === claim.launchId && item.descriptor.claimId === claim.descriptor.claimId && item.descriptor.accrualContract.toLowerCase() === claim.descriptor.accrualContract.toLowerCase());
      if (found) return found; if (!page.nextCursor || seen.has(page.nextCursor)) throw new Error("The bound claim is no longer available.");
      seen.add(page.nextCursor); cursor = page.nextCursor;
    }
  }
  return <div className={styles.claims}><p role="status">{message}</p>
    {claims.map(claim => <Claim key={`${claim.descriptor.accrualContract}:${claim.descriptor.claimId}`} claim={claim} sendWallet={sendWallet}
      fresh={() => freshClaim(claim)} />)}
    {nextCursor ? <button type="button" disabled={loadingMore} onClick={() => void more()}>{loadingMore ? "Loading more claims…" : "Load more claims"}</button> : null}
    <button type="button" onClick={() => setRefresh(value => value + 1)}>Refresh claims</button>
  </div>;
}
function Claim({ claim, sendWallet, fresh }: { claim: LaunchClaimReadV1; sendWallet: Props["sendWallet"]; fresh(): Promise<LaunchClaimReadV1> }) {
  const [review, setReview] = useState<LaunchClaimWalletReviewV1 | null>(null);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [submitted, setSubmitted] = useState<Hex | null>(null);
  const descriptor = claim.descriptor;
  async function act(action: "review" | "send") {
    if (!sendWallet) return;
    setBusy(true); setMessage("");
    try {
      const result = await sendWallet({ action, claim, reviewed: review ?? undefined, loadFreshClaim: fresh });
      if (typeof result === "string") { setSubmitted(result); setReview(null); setMessage("Claim transaction submitted. Receipt and finality are pending."); }
      else setReview(result);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The claim could not be prepared."); }
    finally { setBusy(false); }
  }
  return <article><h3>{claim.name || "Custom launch"}</h3><dl>
    <div><dt>Claimable</dt><dd>{claim.claimableRaw === null ? "Read pending" : `${claim.claimableRaw} raw units`}{claim.blockNumber ? <small>Block {claim.blockNumber}</small> : null}</dd></div>
    <div><dt>Asset</dt><dd><code>{descriptor.asset}</code></dd></div><div><dt>Accrual contract</dt><dd><code>{descriptor.accrualContract}</code></dd></div>
    <div><dt>Recipient</dt><dd><code>{descriptor.immutableRecipient ?? descriptor.beneficiary}</code><small>{descriptor.immutableRecipient ? "Immutable recipient" : "Bound beneficiary snapshot"}</small></dd></div>
    <div><dt>Required controller</dt><dd><code>{descriptor.requiredController}</code></dd></div></dl>
    {sendWallet && !submitted ? <button type="button" disabled={busy || claim.status !== "ready" || claim.claimableRaw === "0"} onClick={() => void act("review")}>Review claim</button> : null}
    {review ? <><p>Transaction value: 0 ETH. Gas estimate at the current rate: {formatEther(BigInt(review.maxGasCostWei))} ETH.</p>
      <details><summary>Exact claim call and proof</summary><pre>{JSON.stringify({ transaction: review.transaction, descriptor: review.descriptor }, null, 2)}</pre></details>
      <button type="button" disabled={busy} onClick={() => void act("send")}>Confirm claim in wallet</button></> : null}
    <p role="status">{message}</p>{submitted ? <a href={`https://robinhoodchain.blockscout.com/tx/${submitted}`} target="_blank" rel="noreferrer">View claim receipt<span className="sr-only"> (opens in a new tab)</span></a> : null}
  </article>;
}
