"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, RefreshCw } from "lucide-react";
import { useWallet } from "@/components/wallet-provider";
import { isWebsiteAdminWallet } from "@/lib/admin-access";
import { isReviewDigest, parseReviewPlan, reviewStateLabel, type ModuleReviewDecisionCommandV1, type ModuleReviewDecisionRecordV1, type ReviewDetail, type ReviewManifestCheck, type ReviewQueue } from "@/lib/module-mode/review-contract";
import styles from "./module-review-admin-console.module.css";

type RequestReview = (path: string, body?: unknown, signal?: AbortSignal, asText?: boolean) => Promise<unknown>;
type ReviewState = ReviewDetail["job"]["state"];
class ReviewRequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super(errorCopy(status, code)); }
}
function errorCopy(status: number, code: string) {
  if (status === 401) return "Your wallet session expired. Reconnect to continue.";
  if (status === 403) return code === "MODULE_REVIEW_SELF_DECISION_FORBIDDEN" ? "An author cannot review their own submission." : "This wallet does not have module review access.";
  if (code === "MODULE_REVIEW_HOST_RELEASE_UNAVAILABLE") return "The host release is not pinned yet. Review approval needs the real release identity before a host manifest can be checked.";
  if (status === 409) return "The review changed or is not ready for this action. Refresh its current status before continuing.";
  if (status === 413) return "The file is too large for this review step.";
  if (status === 400 || status === 415) return "The supplied JSON or review fields do not match this submission. Check the file and try again.";
  if (status === 429) return "Too many requests. Wait a moment, then try again.";
  if (status === 404) return "This submission could not be found.";
  return "The review service could not confirm this request. Try checking the current status.";
}
function message(error: unknown) { return error instanceof Error ? error.message : "The request could not be completed."; }
function short(value: string) { return `${value.slice(0, 8)}…${value.slice(-6)}`; }
function json(value: unknown) { return JSON.stringify(value, null, 2); }
function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Status({ state }: { state: ReviewState }) { return <span className={styles.badge} data-state={state}>{reviewStateLabel(state)}</span>; }
function Hash({ label, value }: { label: string; value: string }) { return <div className={styles.hash}><dt>{label}</dt><dd>{value}</dd></div>; }
function JsonView({ title, value }: { title: string; value: unknown }) { return <details className={styles.disclosure}><summary>{title}</summary><pre tabIndex={0}>{json(value)}</pre></details>; }
const AREA_LABELS: Record<string, string> = {
  "complete-constructor-accepted-configuration-range": "All accepted constructor configurations",
  "external-calls-and-mutable-dependencies": "External calls and mutable dependencies",
  "callback-liveness-and-manipulation": "Callback execution and manipulation risks",
  "budget-and-management-roles": "Budget handling and management permissions",
  "composition-with-other-packages": "Compatibility with other modules",
};

export function ModuleReviewAdminConsole() {
  const { authenticated, connecting, wallet, getAccessToken, getIdentityToken, openWallet } = useWallet();
  const account = authenticated && isWebsiteAdminWallet(wallet?.account)
    ? wallet?.account.toLowerCase() ?? null : null;
  const session = useRef(account);
  useLayoutEffect(() => { session.current = account; }, [account]);
  const request = useCallback<RequestReview>(async (path, body, signal, asText) => {
    const identity = await getIdentityToken().catch(() => null);
    const token = await getAccessToken();
    if (!token || !account || session.current !== account) throw new ReviewRequestError(401, "SESSION_CHANGED");
    const headers = new Headers({ Accept: "application/json", Authorization: `Bearer ${token}` });
    if (identity) headers.set("X-Privy-Identity-Token", identity);
    if (body !== undefined) headers.set("Content-Type", "application/json");
    const result = await fetch(`/api/admin/modules${path}`, { method: body === undefined ? "GET" : "POST", headers,
      body: body === undefined ? undefined : JSON.stringify({ ...body as object, walletAddress: account }),
      cache: "no-store", credentials: "omit", signal });
    if (session.current !== account) throw new ReviewRequestError(401, "SESSION_CHANGED");
    const text = await result.text();
    if (!result.ok) {
      let code = "MODULE_REVIEW_SERVICE_UNAVAILABLE";
      try { code = JSON.parse(text).error?.code ?? code; } catch { /* Use the generic service error. */ }
      throw new ReviewRequestError(result.status, code);
    }
    return asText ? text : JSON.parse(text);
  }, [account, getAccessToken, getIdentityToken]);
  return <div className={`${styles.page} page-width`}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>Modules</p><h1>Admin Dashboard</h1></div>
      <Link className={styles.textLink} href="/admin/partners">Partner access <ArrowRight size={15} aria-hidden="true" /></Link>
    </header>
    {account ? <ModuleReviewWorkspace key={account} account={account} request={request} /> : <section className={styles.gate}>
      <div className={styles.gateMark} aria-hidden="true">M</div><h2>Admin wallet required</h2>
      <p>Connect the admin wallet to review submissions.</p>
      <button className={styles.primary} type="button" disabled={connecting} onClick={openWallet}>{connecting ? "Connecting…" : "Connect wallet"}</button>
    </section>}
  </div>;
}

// The authenticated host owns the request function. This workspace has no credential or authority of its own.
export function ModuleReviewWorkspace({ account, request }: { account: string; request: RequestReview }) {
  const [queue, setQueue] = useState<ReviewQueue | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [previous, setPrevious] = useState<(string | null)[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const selection = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, []);
  const guardedRequest = useCallback<RequestReview>(async (...args) => {
    try { return await request(args[0], args[1], args[2] ?? lifetime.current?.signal, args[3]); }
    catch (e) { if (e instanceof ReviewRequestError && [401, 403].includes(e.status) && e.code !== "MODULE_REVIEW_SELF_DECISION_FORBIDDEN") { setBlocked(true); setDetail(null); setQueue(null); setError(e.message); } throw e; }
  }, [request]);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ walletAddress: account }); if (cursor) query.set("cursor", cursor);
    request(`?${query}`, undefined, controller.signal).then(value => {
      const result = value as ReviewQueue;
      if (result.schemaVersion !== "programmable.modules.website-review-queue.v1" || !Array.isArray(result.jobs)) throw new Error("The review queue response is invalid.");
      if (!controller.signal.aborted) { setQueue(result); setBlocked(false); }
    }).catch(e => {
      if (controller.signal.aborted) return;
      if (e instanceof ReviewRequestError && [401, 403].includes(e.status)) { setBlocked(true); setDetail(null); setQueue(null); }
      setError(message(e));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [account, cursor, refresh, request]);
  const loadDetail = useCallback(async (id: string) => {
    const generation = ++selection.current; setSelected(id); setDetailLoading(true); setError("");
    try {
      const value = await guardedRequest(`/${id}?walletAddress=${encodeURIComponent(account)}`) as ReviewDetail;
      if (value.schemaVersion !== "programmable.modules.website-review-detail.v1" || value.job.subject.submissionId !== id) throw new Error("The review detail response is invalid.");
      if (selection.current === generation) { setDetail(value); window.requestAnimationFrame(() => heading.current?.focus()); }
      return true;
    } catch (e) { if (selection.current === generation) setError(message(e)); return false; }
    finally { if (selection.current === generation) setDetailLoading(false); }
  }, [account, guardedRequest]);
  const current = detail?.job.subject.submissionId === selected ? detail : null;
  return <>
    <div className={styles.toolbar}><p>Private review inbox <span className={styles.muted}>· {short(account)}</span></p><button type="button" className={styles.secondary} disabled={loading || busy} onClick={() => { setLoading(true); setError(""); setRefresh(n => n + 1); if (selected) void loadDetail(selected); }}><RefreshCw size={14} aria-hidden="true" /> Refresh</button></div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {blocked ? <section className={styles.gate}><h2>Review access required</h2><p>Use a wallet that is included in the module reviewer allowlist.</p></section> : <div className={styles.workspace}>
      <aside className={styles.inbox} aria-label="Module submissions" aria-busy={loading}>
        <div className={styles.inboxHeading}><h2>Submissions</h2>{queue && <span>{queue.jobs.length} on this page</span>}</div>
        {!queue && loading && <p className={styles.empty}>Loading submissions…</p>}
        {queue?.jobs.length === 0 && <p className={styles.empty}>No submissions on this page. New API submissions appear here once they reach the review service.</p>}
        <ul className={styles.submissions}>{queue?.jobs.map(job => <li key={job.subject.submissionId}><button type="button" className={styles.submission} aria-current={selected === job.subject.submissionId ? "true" : undefined} disabled={busy || loading} onClick={() => void loadDetail(job.subject.submissionId)}>
          <strong>{job.build?.programName ?? "Module submission"}</strong><span className={styles.identifier}>{short(job.subject.submissionId)}</span><Status state={job.state} />
          <span className={styles.muted}>{job.build ? `${job.build.caseCount} test ${job.build.caseCount === 1 ? "case" : "cases"} · ${job.build.testsPassed ? "Checks passed" : "Checks incomplete"}` : `Build attempt ${job.attempt}`}</span>
        </button></li>)}</ul>
        <div className={styles.pagination}><button className={styles.iconButton} aria-label="Previous page of submissions" disabled={!previous.length || busy || loading} onClick={() => { setLoading(true); setError(""); setCursor(previous.at(-1) ?? null); setPrevious(p => p.slice(0, -1)); }}><ArrowLeft size={17} /></button><span>Page {previous.length + 1}</span><button className={styles.iconButton} aria-label="Next page of submissions" disabled={!queue?.nextCursor || busy || loading} onClick={() => { setLoading(true); setError(""); setPrevious(p => [...p, cursor]); setCursor(queue!.nextCursor); }}><ArrowRight size={17} /></button></div>
      </aside>
      <section className={styles.detail} aria-busy={detailLoading} aria-label="Selected submission">
        {detailLoading && <p className={styles.caption} role="status">Checking source and build evidence…</p>}{current ? <><h2 className={styles.detailTitle} ref={heading} tabIndex={-1}>{current.source.descriptor.name} <span>v{current.source.descriptor.version}</span></h2><ReviewEditor key={current.job.subject.submissionId} detail={current} account={account} request={guardedRequest} setParentBusy={setBusy} refresh={async () => { if (!await loadDetail(current.job.subject.submissionId)) throw new Error("The current review could not be refreshed."); setLoading(true); setRefresh(n => n + 1); }} /></> : <div className={styles.selectionEmpty}><p className={styles.eyebrow}>Source → Build → Decision</p><h2>Select a submission</h2><p>Each review keeps the submitted source, build results, and decision together.</p><p className={styles.note}>Review approval does not publish a module or approve it onchain.</p></div>}
      </section>
    </div>}
  </>;
}

function ImportJson({ id, label, value, onChange, maximum, disabled }: { id: string; label: string; value: string; onChange: (v: string) => void; maximum: number; disabled: boolean }) {
  const [error, setError] = useState("");
  return <div className={styles.importField}><label htmlFor={id}>{label}</label><input type="file" aria-label={`Import ${label}`} accept="application/json,.json" disabled={disabled} onChange={async event => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    setError(""); if (file.size > maximum) { setError("This JSON file is too large."); return; }
    try { onChange(await file.text()); } catch { setError("The file could not be read."); }
  }} /><textarea id={id} value={value} disabled={disabled} spellCheck={false} rows={6} onChange={event => { setError(""); onChange(event.target.value); }} aria-describedby={error ? `${id}-error` : undefined} aria-invalid={error ? true : undefined} />{error && <p id={`${id}-error`} className={styles.error}>{error}</p>}</div>;
}
function ReviewEditor({ detail, account, request, refresh, setParentBusy }: { detail: ReviewDetail; account: string; request: RequestReview; refresh: () => Promise<void>; setParentBusy: (busy: boolean) => void }) {
  const { job, source } = detail;
  const artifact = job.artifact;
  const id = job.subject.submissionId;
  const [planText, setPlanText] = useState(job.plan ? json(job.plan) : "");
  const [manifestText, setManifestText] = useState("");
  const [manifestCheck, setManifestCheck] = useState<ReviewManifestCheck | null>(null);
  const [outcome, setOutcome] = useState<ModuleReviewDecisionCommandV1["outcome"]>("request_changes");
  const [reason, setReason] = useState("");
  const [areas, setAreas] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<ModuleReviewDecisionCommandV1 | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [receipt, setReceipt] = useState<ModuleReviewDecisionRecordV1 | null>(null);
  const [sourceText, setSourceText] = useState<string | null>(null);
  const [sourceFile, setSourceFile] = useState<string | null>(null);
  const [seenRevision, setSeenRevision] = useState(job.reviewRevision);
  const operationLock = useRef(false);
  if (seenRevision !== job.reviewRevision) {
    setSeenRevision(job.reviewRevision); setConfirmation(null); setManifestCheck(null); setUncertain(false); setReceipt(null); setAreas([]); setPlanText(job.plan ? json(job.plan) : "");
  }
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const confirmRef = useRef<HTMLHeadingElement>(null);
  const self = account.toLowerCase() === job.subject.author;
  const terminal = ["accepted", "rejected"].includes(job.state);
  const canQueue = !self && ["awaiting_plan", "build_failed", "changes_requested", "built"].includes(job.state);
  const canApprove = job.state === "built" && artifact?.tests.allRequiredChecksPassed === true;
  const active = busy !== null || uncertain || terminal || receipt !== null;
  const run = async (label: string, action: () => Promise<void>, mutation = false) => {
    if (operationLock.current) return; operationLock.current = true; setBusy(label); setParentBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (e) { setError(message(e)); if (mutation && (!(e instanceof ReviewRequestError) || ![400, 401, 403, 404, 409, 413, 415, 429].includes(e.status))) setUncertain(true); }
    finally { operationLock.current = false; setBusy(null); setParentBusy(false); }
  };
  useEffect(() => { if (confirmation) confirmRef.current?.focus(); }, [confirmation]);
  const readSource = async () => {
    if (sourceText) return sourceText;
    const value = await request(`/${id}/source?walletAddress=${encodeURIComponent(account)}`, undefined, undefined, true) as string;
    setSourceText(value); return value;
  };
  let code: string | null = null;
  if (sourceText && sourceFile) {
    try { const file = JSON.parse(sourceText).files.find((f: { path: string }) => f.path === sourceFile); code = new TextDecoder().decode(Uint8Array.from(atob(file.bytes), c => c.charCodeAt(0))); }
    catch { code = "This file could not be displayed. Download the original submission to inspect its bytes."; }
  }
  const reviewDecision = (event: FormEvent) => {
    event.preventDefault(); setError("");
    const cleanReason = reason.trim();
    if (cleanReason.length < 10 || new TextEncoder().encode(cleanReason).length > 4096 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(cleanReason)) { setError("Write a clear reason of at least 10 characters, within 4 KB."); reasonRef.current?.focus(); return; }
    if (outcome === "accept" && (!canApprove || !artifact || !manifestCheck || manifestCheck.reviewRevision !== job.reviewRevision || manifestCheck.artifactDigest !== artifact.artifactDigest || artifact.reviewRequired.some(area => !areas.includes(area)))) { setError("Approval needs a successful current build, a checked host manifest, and every required review area acknowledged."); return; }
    setConfirmation({ schemaVersion: "programmable.modules.review-command.v1", submissionId: id, requestDigest: job.subject.requestDigest, expectedReviewRevision: job.reviewRevision, outcome, reason: cleanReason,
      artifactDigest: outcome === "accept" ? artifact!.artifactDigest : null, hostManifestHash: outcome === "accept" ? manifestCheck!.hostManifestHash : null, acknowledgedReviewAreas: outcome === "accept" ? areas : [] });
  };
  return <div className={styles.editor}>
    <div className={styles.detailMeta}><Status state={job.state} /><span>Revision {job.reviewRevision}</span><span>Build attempt {job.attempt}</span></div>
    <dl className={styles.identities}><Hash label="Author wallet" value={job.subject.author} /><Hash label="Reward wallet" value={source.descriptor.rewardWallet} /><Hash label="Submission" value={id} /></dl>
    <section className={styles.section}><h3>What this module needs</h3><p>{source.descriptor.management.summary}</p><ul className={styles.capabilities}>{source.descriptor.requiresHost.map(capability => <li key={capability}>{capability}</li>)}</ul><JsonView title="Configuration, compatibility and management" value={{ configuration: source.descriptor.configuration, ports: source.descriptor.ports, constraints: source.descriptor.constraints, management: source.descriptor.management }} /></section>
    <section className={styles.section}><div className={styles.sectionHeading}><h3>Submitted source</h3><button type="button" className={styles.secondary} disabled={busy !== null} onClick={() => void run("source", async () => download(await readSource(), `module-${id}.json`))}><ArrowDownToLine size={14} aria-hidden="true" /> Download source</button></div>
      <ul className={styles.files}>{source.files.map(file => <li key={file.path}><button type="button" className={styles.fileButton} disabled={busy !== null} onClick={() => void run("source", async () => { await readSource(); setSourceFile(file.path); })}>{file.path}</button><span>{file.bytes.toLocaleString()} B</span></li>)}</ul>
      {sourceFile && <div className={styles.sourceViewer}><div className={styles.sectionHeading}><strong>{sourceFile}</strong><button type="button" className={styles.textButton} onClick={() => setSourceFile(null)}>Close source</button></div><pre tabIndex={0}>{code}</pre></div>}
      <JsonView title="Source manifest and file hashes" value={source.descriptor} />
    </section>
    <section className={styles.section}><h3>Build evidence</h3>{artifact ? <><p className={styles.buildResult}><Check size={17} aria-hidden="true" /> {artifact.tests.allRequiredChecksPassed ? "Required build checks passed" : "Build checks are incomplete"}</p><p className={styles.muted}>{artifact.tests.cases.length} test {artifact.tests.cases.length === 1 ? "case" : "cases"} · Solidity {artifact.compiler.version} · {artifact.callbackGas.toLocaleString()} callback gas</p>
      <div className={styles.testTable}><table><caption>Isolated build test results</caption><thead><tr><th>Case</th><th>Deploy</th><th>Code</th><th>Binding</th><th>Trade auth</th><th>Action auth</th><th>Gas</th><th>Budget</th></tr></thead><tbody>{artifact.tests.cases.map((test, index) => <tr key={index}><th scope="row">{String(test.id)}</th>{["deploymentMatched", "codeHashMatched", "bindingMatched", "unauthorizedTradeReverted", "unauthorizedActionReverted", "callbackGasBound", "budgetIsolationChecked"].map(key => <td key={key}>{test[key] === true ? "Pass" : test[key] === false ? "Fail" : "—"}</td>)}</tr>)}</tbody></table></div><p className={styles.caption}>A dash means the check does not apply to that deployment case. Passing tests still requires a human source review.</p>
      <JsonView title="Compiler, ABI, bytecode and complete test artifact" value={artifact} /></> : <p className={styles.muted}>No completed build artifact is attached to this revision.</p>}
      {job.lastError && <p className={styles.error}>Last build error: {job.lastError}</p>}
      {detail.attempts.length > 0 && <details className={styles.disclosure}><summary>Worker runs and build history</summary><ol className={styles.history}>{detail.attempts.map((attempt, i) => <li key={i}><strong>Attempt {attempt.attempt} · {attempt.event}</strong><span>{attempt.createdAt}</span>{attempt.workerIdentity && <dl><Hash label="Worker source commit" value={attempt.workerIdentity.sourceCommit} /><Hash label="GitHub run / attempt" value={`${attempt.workerIdentity.runId} / ${attempt.workerIdentity.runAttempt}`} /><Hash label="Workflow" value={attempt.workerIdentity.workflowRef} /></dl>}{attempt.errorCode && <code>{attempt.errorCode}</code>}</li>)}</ol></details>}
      <details className={styles.disclosure}><summary>Queue a reviewed build plan</summary><p>Import the operator plan for this exact submission. A new build clears the previous artifact and uses the fixed review worker.</p><ImportJson id="review-plan" label="Build plan JSON" value={planText} onChange={setPlanText} maximum={262144} disabled={active || !canQueue} /><button className={styles.secondary} type="button" disabled={active || !canQueue} onClick={() => void run("plan", async () => {
        let plan; try { plan = parseReviewPlan(JSON.parse(planText), job.subject); } catch { throw new ReviewRequestError(400, "MODULE_REVIEW_PLAN_INVALID"); }
        await request(`/${id}/plan`, { expectedReviewRevision: job.reviewRevision, planJson: json(plan) }); setNotice("Build plan queued. Check the current status for worker results."); await refresh();
      }, true)}>{busy === "plan" ? "Queueing build…" : "Queue build"}</button>{!canQueue && <p className={styles.caption}>{self ? "An author cannot queue their own review build." : "A build can be queued when the submission needs a plan, failed, needs changes, or is ready for review."}</p>}</details>
    </section>
    {self && <p className={styles.note}>This is your submission. Another authorized reviewer must make the decision.</p>}
    {!terminal && !self && !receipt && <section className={styles.section}><h3>Review decision</h3><p className={styles.muted}>Approval records the reviewed build and host manifest. Publication and onchain admission happen separately.</p>
      <details className={styles.disclosure}><summary>Check a host manifest for approval</summary><p>The import must match this build, source configuration, website controls, and the configured host release.</p><ImportJson id="review-manifest" label="Host manifest JSON" value={manifestText} onChange={text => { setManifestText(text); setManifestCheck(null); setConfirmation(null); }} maximum={2 * 1024 * 1024} disabled={active} /><button type="button" className={styles.secondary} disabled={active || !artifact} onClick={() => void run("manifest", async () => {
        const value = await request(`/${id}/manifest`, { expectedReviewRevision: job.reviewRevision, hostManifestJson: manifestText }) as ReviewManifestCheck;
        if (value.schemaVersion !== "programmable.modules.website-manifest-check.v1" || value.submissionId !== id || value.reviewRevision !== job.reviewRevision || value.requestDigest !== job.subject.requestDigest || value.artifactDigest !== artifact?.artifactDigest || !isReviewDigest(value.hostManifestHash)) throw new Error("The checked manifest belongs to a different review.");
        setManifestCheck(value); setNotice("Host manifest matches this build and release.");
      })}>{busy === "manifest" ? "Checking manifest…" : "Check manifest"}</button>{!artifact && <p className={styles.caption}>A completed build is required.</p>}{manifestCheck && <dl><Hash label="Checked host manifest hash" value={manifestCheck.hostManifestHash} /></dl>}</details>
      <form onSubmit={reviewDecision}><fieldset disabled={active || confirmation !== null} className={styles.decisionFields}><legend className={styles.srOnly}>Review outcome and reason</legend><label htmlFor="review-outcome">Outcome</label><select id="review-outcome" value={outcome} onChange={event => setOutcome(event.target.value as typeof outcome)}><option value="request_changes">Request changes</option><option value="reject">Reject submission</option><option value="accept" disabled={!canApprove}>Approve review</option></select>{!canApprove && <p className={styles.caption}>Approval becomes available after the current build passes its required checks.</p>}
        {outcome === "accept" && <><p className={styles.note}>A checked host manifest and all review acknowledgements are required.</p>{artifact?.reviewRequired.map(area => <label className={styles.checkbox} key={area}><input type="checkbox" checked={areas.includes(area)} onChange={event => setAreas(old => event.target.checked ? [...old, area] : old.filter(item => item !== area))} />{AREA_LABELS[area] ?? area}</label>)}</>}
        <label htmlFor="review-reason">Reason <span className={styles.muted}>(required)</span></label><textarea ref={reasonRef} id="review-reason" value={reason} rows={4} required minLength={10} maxLength={4096} onChange={event => setReason(event.target.value)} aria-describedby="review-reason-help" /><p id="review-reason-help" className={styles.caption}>Explain the finding and the next step. This reason is saved in the decision record.</p><button className={styles.primary} type="submit">Review decision <ArrowRight size={16} aria-hidden="true" /></button>
      </fieldset></form>
      {confirmation && <section className={styles.confirmation} aria-labelledby="confirm-review-heading"><h4 id="confirm-review-heading" ref={confirmRef} tabIndex={-1}>{confirmation.outcome === "accept" ? "Approve this review?" : confirmation.outcome === "reject" ? "Reject this submission?" : "Request these changes?"}</h4><p className={styles.confirmReason}>{confirmation.reason}</p><dl><Hash label="Submission digest" value={confirmation.requestDigest} />{confirmation.artifactDigest && <Hash label="Build artifact" value={confirmation.artifactDigest} />}{confirmation.hostManifestHash && <Hash label="Host manifest" value={confirmation.hostManifestHash} />}</dl><p className={styles.caption}>Saved under {account}. This does not publish source or send an onchain transaction.</p><div className={styles.actions}><button type="button" className={styles.secondary} disabled={active} onClick={() => setConfirmation(null)}>Edit decision</button><button type="button" className={styles.primary} disabled={active} onClick={() => void run("decision", async () => {
        const value = await request(`/${id}/decisions`, { command: confirmation, hostManifestJson: confirmation.outcome === "accept" ? manifestText : null }) as { decision: ModuleReviewDecisionRecordV1 };
        setReceipt(value.decision); setConfirmation(null); setNotice("Decision recorded. The module has not been published by this action.");
      }, true)}>{busy === "decision" ? "Saving decision…" : confirmation.outcome === "accept" ? "Approve review" : confirmation.outcome === "reject" ? "Reject submission" : "Request changes"}</button></div></section>}
    </section>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p className={styles.success} role="status">{notice}</p>}
    {uncertain && <p className={styles.note}>The server may have recorded the action. Check the current review before submitting anything again.</p>}
    {(uncertain || receipt) && <button type="button" className={styles.secondary} disabled={busy !== null} onClick={() => void run("refresh", async () => { await refresh(); setUncertain(false); setConfirmation(null); setManifestCheck(null); })}>Check current review status</button>}
    {receipt && <dl><Hash label="Recorded decision digest" value={receipt.decisionDigest} /></dl>}
    {detail.decisions.length > 0 && <section className={styles.section}><h3>Decision history</h3><ol className={styles.history}>{detail.decisions.map(decision => <li key={decision.decisionDigest}><strong>{decision.command.outcome === "accept" ? "Review approved" : decision.command.outcome === "reject" ? "Rejected" : "Changes requested"}</strong><span>{decision.decidedAt} · {short(decision.reviewerWallet)}</span><p>{decision.command.reason}</p><JsonView title="Canonical decision record" value={decision} /></li>)}</ol></section>}
    <details className={styles.disclosure}><summary>Submission identity</summary><dl><Hash label="Request digest" value={job.subject.requestDigest} /><Hash label="Package ID" value={source.packageId} /><Hash label="Family ID" value={source.familyId} /></dl></details>
  </div>;
}
