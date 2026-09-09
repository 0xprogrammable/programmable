"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { formatEther, type Hex } from "viem";
import { projectionObject } from "@/lib/custom-launch/launch-projection-v1";
import { readLaunchPlanResourceV1, type UniversalLaunchSource, type UniversalLaunchWalletInputV1, type UniversalLaunchWalletReviewV1 } from "@/lib/custom-launch/wallet-handoff-plan-v1";
import shared from "./developer-api-keys.module.css";
import styles from "./developer-launch-history.module.css";

type Entry = { sourceVersion: UniversalLaunchSource; controller: string; resource: Record<string, unknown> };
type Props = {
  account: string; initialLaunchId?: string | null;
  getAccessToken(): Promise<string | null>; getIdentityToken(): Promise<string | null>;
  sendWallet(input: UniversalLaunchWalletInputV1): Promise<UniversalLaunchWalletReviewV1 | Hex>;
};
const sources = ["custom_launch_plan_v1", "multi_role_v2"] as const;
const identity = (entry: Entry) => `${entry.sourceVersion}:${entry.resource.planId ?? entry.resource.launchId}`;
function parseEntries(value: unknown, account: string): { entries: Entry[]; nextCursor: string | null } {
  if (!projectionObject(value) || value.schemaVersion !== "programmable.website-launch-history.v1" || !Array.isArray(value.launches)
    || !(value.nextCursor === null || typeof value.nextCursor === "string")) throw new Error("Launch history is unavailable.");
  const entries = value.launches.map(candidate => {
    if (!projectionObject(candidate) || !sources.includes(candidate.sourceVersion as UniversalLaunchSource)
      || typeof candidate.controller !== "string" || candidate.controller.toLowerCase() !== account.toLowerCase()
      || !projectionObject(candidate.resource)) throw new Error("The history controller changed.");
    if (candidate.sourceVersion === "custom_launch_plan_v1") readLaunchPlanResourceV1(candidate.resource);
    return candidate as Entry;
  });
  return { entries, nextCursor: value.nextCursor };
}

/** Additional sources inside the existing API-key history. Each immutable source retains its own bytes and cursor. */
export function DeveloperUniversalLaunchHistory(props: Props) {
  const { account, getAccessToken, getIdentityToken } = props;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cursors, setCursors] = useState<Partial<Record<UniversalLaunchSource, string | null>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const request = useCallback(async (source: UniversalLaunchSource, id?: string, init?: RequestInit, suffix = "", cursor?: string) => {
    const [access, identityToken] = await Promise.all([getAccessToken(), getIdentityToken()]);
    if (!access) throw new Error("Sign in again to load your launch history.");
    const query = new URLSearchParams({ walletAddress: account, source });
    if (cursor) query.set("cursor", cursor);
    const response = await fetch(`/api/developer/custom-launch-plans${id ? `/${encodeURIComponent(id)}` : ""}${suffix}?${query}`, {
      ...init, cache: "no-store", redirect: "error", signal: init?.signal ?? AbortSignal.timeout(15000),
      headers: { Accept: "application/json", Authorization: `Bearer ${access}`,
        ...(identityToken ? { "X-Privy-Identity-Token": identityToken } : {}), ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    });
    if (!response.ok) throw new Error(response.status === 404 ? "This launch source is not available yet." : "Could not read the launch. Refresh to retry.");
    return response.json() as Promise<unknown>;
  }, [account, getAccessToken, getIdentityToken]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.allSettled(sources.map(async source => {
      const result = parseEntries(await request(source, undefined, { signal: controller.signal }), account);
      if (props.initialLaunchId && !result.entries.some(entry => String(entry.resource.planId ?? entry.resource.launchId) === props.initialLaunchId)) {
        try { result.entries.push(...parseEntries(await request(source, props.initialLaunchId, { signal: controller.signal }), account).entries); }
        catch { /* The immutable identifier may belong to another existing history source. */ }
      }
      return { source, ...result };
    })).then(results => {
      if (controller.signal.aborted) return;
      const successful = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
      setEntries(previous => [...new Map([...previous, ...successful.flatMap(result => result.entries)].map(entry => [identity(entry), entry])).values()]
        .sort((a, b) => Date.parse(String(b.resource.createdAt)) - Date.parse(String(a.resource.createdAt))));
      setCursors(previous => ({ ...previous, ...Object.fromEntries(successful.map(result => [result.source, result.nextCursor])) }));
      setError(results.some(result => result.status === "rejected") ? "Some custom launch sources could not be refreshed. Existing records remain available." : null);
      setLoading(false);
    });
    const timer = window.setInterval(() => setRefresh(value => value + 1), 30000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [request, account, props.initialLaunchId, refresh]);
  async function more(source: UniversalLaunchSource) {
    const cursor = cursors[source]; if (!cursor) return;
    setLoading(true);
    try {
      const result = parseEntries(await request(source, undefined, undefined, "", cursor), account);
      setEntries(previous => [...new Map([...previous, ...result.entries].map(entry => [identity(entry), entry])).values()]);
      setCursors(previous => ({ ...previous, [source]: result.nextCursor }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load more launches."); }
    finally { setLoading(false); }
  }
  return <section className={styles.history} aria-label="Custom project launch history">
    <div className={styles.heading}><button type="button" className={shared.secondaryButton} onClick={() => setRefresh(value => value + 1)} disabled={loading}>Refresh custom projects</button></div>
    <p role="status" className={styles.intro}>{loading ? "Loading custom projects…" : error ?? (entries.length ? "" : "No Custom Launch Plan or MultiRole requests for this controller.")}</p>
    <ul className={styles.launchList}>{entries.map(entry => <UniversalHistoryRow key={identity(entry)} entry={entry} sendWallet={props.sendWallet}
      load={async () => parseEntries(await request(entry.sourceVersion, String(entry.resource.planId ?? entry.resource.launchId)), account).entries[0].resource}
      onSubmitted={async (stepId, hash) => {
        if (entry.sourceVersion === "custom_launch_plan_v1") await request(entry.sourceVersion, String(entry.resource.planId), {
          method: "POST", body: JSON.stringify({ schemaVersion: "programmable.custom-launch-plan-step-proof.v1", transactionHash: hash.toLowerCase() }),
        }, `/steps/${encodeURIComponent(stepId)}/proofs`);
        else await request(entry.sourceVersion, String(entry.resource.launchId), { method: "POST",
          body: JSON.stringify({ schemaVersion: "programmable.multi-role-transaction-hint.v2", transactionHash: hash.toLowerCase() }),
        }, "/transaction-hints");
        setRefresh(value => value + 1);
      }} />)}</ul>
    {sources.map(source => cursors[source] ? <button key={source} type="button" className={shared.secondaryButton} disabled={loading} onClick={() => void more(source)}>Load more {source === "multi_role_v2" ? "MultiRole" : "Custom Launch Plan"} requests</button> : null)}
  </section>;
}

type Submission = { stepId: string; transactionHash: Hex; transactionDigest: string };
const submissionEvent = "programmable:launch-step-submitted";
function subscribeSubmissions(callback: () => void) {
  window.addEventListener("storage", callback); window.addEventListener(submissionEvent, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(submissionEvent, callback); };
}
function storedSubmission(key: string): string | null { try { return window.localStorage.getItem(key); } catch { return null; } }
function parseSubmission(raw: string | null, resource: Record<string, unknown>): Submission | null {
  if (!raw || raw.length > 1024) return null;
  try { const value: unknown = JSON.parse(raw); if (!projectionObject(value) || typeof value.stepId !== "string" || typeof value.transactionHash !== "string"
    || !/^0x[0-9a-f]{64}$/.test(value.transactionHash) || typeof value.transactionDigest !== "string") return null;
    const bound = Array.isArray(resource.steps) ? resource.steps.some(item => projectionObject(item) && item.stepId === value.stepId && item.transactionDigest === value.transactionDigest)
      : value.stepId === "multi-role-v2" && resource.walletTransactionPreimageHash === value.transactionDigest;
    return bound ? value as Submission : null;
  } catch { return null; }
}

function UniversalHistoryRow({ entry, load, sendWallet, onSubmitted }: {
  entry: Entry; load(): Promise<unknown>; sendWallet: Props["sendWallet"]; onSubmitted(step: string, hash: Hex): Promise<void>;
}) {
  const [review, setReview] = useState<UniversalLaunchWalletReviewV1 | null>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [submitted, setSubmitted] = useState<Submission | null>(null);
  const resource = entry.resource;
  const plan = entry.sourceVersion === "custom_launch_plan_v1" ? readLaunchPlanResourceV1(resource) : null;
  const step = plan?.steps.find(item => item.status === "wallet_action_ready");
  const walletReady = plan ? !!step : ["authorized", "awaiting_wallet_signature", "wallet_action_required"].includes(String(resource.status));
  const wallet = projectionObject(resource.wallet) ? resource.wallet : null;
  const summary = wallet && projectionObject(wallet.launchSummary) ? wallet.launchSummary : null;
  const title = plan?.plan.publication?.name ?? (typeof summary?.name === "string" ? summary.name : "Custom project");
  const id = String(resource.planId ?? resource.launchId);
  const journalKey = `programmable:launch-submission:4663:${entry.controller.toLowerCase()}:${entry.sourceVersion}:${id}`;
  const journal = useSyncExternalStore(subscribeSubmissions, () => storedSubmission(journalKey), () => null);
  const submission = parseSubmission(journal, resource) ?? submitted;
  const submissionFinal = submission && (plan ? plan.steps.find(item => item.stepId === submission.stepId)?.status === "final" : resource.status === "finalized");
  const pendingSubmission = submission && !submissionFinal ? submission : null;
  const loadFreshCapabilities = async () => {
    const response = await fetch(`https://api.programmable.market/v4/chains/4663/${plan ? "custom-launch-capabilities" : "multi-role-custom-launches/capabilities"}`, { cache: "no-store", credentials: "omit", redirect: "error" });
    if (!response.ok) throw new Error("Current wallet bindings are unavailable."); return response.json() as Promise<unknown>;
  };
  async function action(mode: "review" | "send") {
    setBusy(true); setError(null);
    try {
      const result = await sendWallet({ action: mode, sourceVersion: entry.sourceVersion, reviewedResource: resource,
        stepId: step?.stepId, reviewed: review ?? undefined, loadFreshResource: load, loadFreshCapabilities });
      if (typeof result === "string") {
        const submission = { stepId: step?.stepId ?? "multi-role-v2", transactionHash: result, transactionDigest: review?.binding ?? "" };
        setSubmitted(submission); setReview(null);
        try { window.localStorage.setItem(journalKey, JSON.stringify(submission)); window.dispatchEvent(new Event(submissionEvent)); } catch { /* The visible receipt remains available if local persistence is disabled. */ }
        try { await onSubmitted(step?.stepId ?? "multi-role-v2", result); }
        catch { setError("Transaction submitted. The tracking hint could not be saved; keep this hash and refresh status. Do not resend."); }
      } else setReview(result);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not prepare the wallet action."); }
    finally { setBusy(false); }
  }
  return <li className={styles.launchItem}>
    <div className={styles.launchTopline}><h3>{title}</h3><span className={styles.status}>{String(resource.status).replaceAll("_", " ")}</span></div>
    <dl className={styles.metadata}><div><dt>Controller</dt><dd><code>{entry.controller}</code></dd></div><div><dt>Launch ID</dt><dd><code>{id}</code></dd></div>
      {plan ? <><div><dt>Components / markets</dt><dd>{plan.plan.components.length} / {plan.plan.markets.length}</dd></div><div><dt>Manifest digest</dt><dd><code>{plan.manifestDigest}</code></dd></div></> : null}</dl>
    {plan ? <><ol>{plan.steps.map(item => <li key={item.stepId}>{item.stepId}: {item.status.replaceAll("_", " ")}</li>)}</ol>
      {plan.preflight?.findings.length ? <details className={styles.transaction}><summary>Findings and repairs</summary><pre>{JSON.stringify(plan.preflight.findings, null, 2)}</pre></details> : null}
      <details className={styles.transaction}><summary>Exact components, markets and fee obligations</summary><pre>{JSON.stringify({ components: plan.plan.components, markets: plan.plan.markets, feeObligations: plan.plan.feeObligations }, null, 2)}</pre></details></> : null}
    {submission ? <p className={styles.transactionHash}>{submissionFinal ? "Step final." : "Submitted; finality is pending."} <a href={`https://robinhoodchain.blockscout.com/tx/${submission.transactionHash}`} target="_blank" rel="noreferrer"><code>{submission.transactionHash}</code></a></p> : null}
    {pendingSubmission ? <button className={shared.secondaryButton} type="button" disabled={busy} onClick={() => { setBusy(true); void onSubmitted(pendingSubmission.stepId, pendingSubmission.transactionHash).catch(() => setError("Tracking is still unavailable. Keep this receipt and retry later.")).finally(() => setBusy(false)); }}>Retry transaction tracking</button> : null}
    {walletReady && !pendingSubmission ? <button ref={reviewButton} className={shared.secondaryButton} type="button" disabled={busy} onClick={() => void action("review")}>{busy ? "Checking wallet…" : "Review wallet transaction"}</button> : null}
    {review && walletReady && !pendingSubmission && review.stepId === (step?.stepId ?? "multi-role-v2") ? <div className={styles.projectReview}><h4>Exact wallet transaction</h4><dl className={styles.reviewGrid}>
      <div><dt>Chain / controller type</dt><dd>Robinhood 4663 · {review.controllerKind}</dd></div><div><dt>Target</dt><dd><code>{review.transaction.to}</code></dd></div>
      <div><dt>Transaction value</dt><dd>{formatEther(BigInt(review.valueWei))} ETH</dd></div><div><dt>Gas estimate at the current rate</dt><dd>{formatEther(BigInt(review.maxGasCostWei))} ETH</dd></div>
      <div><dt>Expires</dt><dd>{new Date(Number(review.deadline) * 1000).toISOString()}</dd></div><div><dt>Transaction binding</dt><dd><code>{review.binding}</code></dd></div></dl>
      {review.controllerAuthorization ? <p>Confirm the bound Safe nonce and owner threshold in the controller wallet. Its exact SafeTx uses zero gas refunds; signature collection and finality remain pending.</p> : null}
      <details className={styles.transaction}><summary>Calldata and exact effects</summary><pre>{JSON.stringify({ decodedOperation: review.decodedOperation, controllerAuthorization: review.controllerAuthorization, transaction: review.transaction, preconditions: review.preconditions, postconditions: review.postconditions }, null, 2)}</pre></details>
      <div className={styles.walletReviewActions}>
        <button className={shared.primaryButton} type="button" disabled={busy} onClick={() => void action("send")}>Confirm in controller wallet</button>
        <button className={shared.secondaryButton} type="button" disabled={busy} onClick={() => { setReview(null); setError(null); reviewButton.current?.focus(); }}>Cancel review</button>
      </div>
    </div> : null}
    <p className={styles.inlineError} role="status">{error ?? ""}</p>
  </li>;
}
