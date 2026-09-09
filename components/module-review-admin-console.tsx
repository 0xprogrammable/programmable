"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, ChevronDown, Clipboard, Clock3, FileCode2, Inbox, Puzzle, RefreshCw, Search, Settings2, ShieldCheck } from "lucide-react";
import { useWallet } from "@/components/wallet-provider";
import { isWebsiteAdminWallet } from "@/lib/admin-access";
import { isReviewDigest, parseReviewPlan, reviewStateLabel, type ModuleReviewDecisionCommandV1, type ModuleReviewDecisionRecordV1, type ReviewDetail, type ReviewManifestCheck, type ReviewQueue } from "@/lib/module-mode/review-contract";
import { createPublicationSessionExporter, type PublicationSession, type PublicationSessionExportResult } from "@/lib/module-mode/publication-session";
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
  try {
    const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
const dateFormat = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC" });
function submittedDate(value: string) { return dateFormat.format(new Date(value)); }
function Status({ state }: { state: ReviewState }) {
  const label = ({ awaiting_plan: "Needs checks", queued: "Checks queued", running: "Checking", build_failed: "Checks failed" } as Partial<Record<ReviewState, string>>)[state] ?? reviewStateLabel(state);
  return <span className={styles.badge} data-state={state}><span aria-hidden="true" />{label}</span>;
}
function Hash({ label, value }: { label: string; value: string }) { return <div className={styles.hash}><dt>{label}</dt><dd>{value}</dd></div>; }
function JsonView({ title, value }: { title: string; value: unknown }) { return <details className={styles.disclosure}><summary>{title}</summary><pre tabIndex={0}>{json(value)}</pre></details>; }
function WalletIdentity({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return <div className={styles.walletIdentity}><dt>{label}</dt><dd><span title={value}>{short(value)}</span><button type="button" className={styles.iconButton} aria-label={`Copy ${label.toLowerCase()}`} title="Copy address" onClick={() => {
    void navigator.clipboard.writeText(value).then(() => { setCopied(true); setFailed(false); }, () => { setFailed(true); });
  }}>{copied ? <Check size={16} aria-hidden="true" /> : <Clipboard size={16} aria-hidden="true" />}</button></dd><span className={failed ? styles.error : styles.srOnly} role="status">{failed ? `Copy unavailable. ${value}` : copied ? `${label} copied` : ""}</span></div>;
}
const AREA_LABELS: Record<string, string> = {
  "complete-constructor-accepted-configuration-range": "All accepted constructor configurations",
  "external-calls-and-mutable-dependencies": "External calls and mutable dependencies",
  "callback-liveness-and-manipulation": "Callback execution and manipulation risks",
  "budget-and-management-roles": "Budget handling and management permissions",
  "composition-with-other-packages": "Compatibility with other modules",
};

export function ModuleReviewAdminConsole() {
  const { authenticated, authReady, sessionReady, connecting, disconnecting, wallet, getAccessToken, getIdentityToken, openWallet } = useWallet();
  const account = authenticated && isWebsiteAdminWallet(wallet?.account)
    ? wallet?.account.toLowerCase() ?? null : null;
  const session = useRef(account);
  useLayoutEffect(() => { session.current = account; }, [account]);
  const publicationSession = useRef<PublicationSession | null>(null);
  const publicationReady = Boolean(account && authReady && sessionReady && !disconnecting);
  useLayoutEffect(() => {
    publicationSession.current = publicationReady && account ? Object.freeze({ walletAddress: account }) : null;
    return () => { publicationSession.current = null; };
    // WalletProvider replaces the identity-token capability when its session/token changes.
    // Cleanup also cancels a pending export when the same wallet disconnects and reconnects.
  }, [account, publicationReady, getAccessToken, getIdentityToken]);
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
  return <div className={`${styles.page} page-width`} data-module-review-page>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>Admin</p><h1>Module reviews</h1></div>
      <details className={styles.tools} onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
        <summary><Settings2 size={17} aria-hidden="true" />Tools<ChevronDown size={14} aria-hidden="true" /></summary>
        <div className={styles.toolsMenu}>
          <Link className={styles.textLink} href="/admin/partners">Partner access <ArrowRight size={15} aria-hidden="true" /></Link>
          {account && <PublicationSessionDownload ready={publicationReady} readSession={() => publicationSession.current}
            getAccessToken={getAccessToken} getIdentityToken={getIdentityToken} />}
        </div>
      </details>
    </header>
    {account ? <>
      <ModuleReviewWorkspace key={account} account={account} request={request} />
    </> : <section className={styles.gate}>
      <div className={styles.gateMark} aria-hidden="true"><ShieldCheck size={24} /></div><h2>Connect your admin wallet</h2>
      <p>Connect the admin wallet to review submissions.</p>
      <button className={styles.primary} type="button" disabled={connecting} onClick={openWallet}>{connecting ? "Connecting…" : "Connect wallet"}</button>
    </section>}
  </div>;
}

export function PublicationSessionDownload({ ready, ...input }: {
  ready: boolean;
  readSession: () => PublicationSession | null;
  getAccessToken: () => Promise<string | null>;
  getIdentityToken: () => Promise<string | null>;
}) {
  const [exportSession] = useState(() => createPublicationSessionExporter());
  const [status, setStatus] = useState<"idle" | "pending" | PublicationSessionExportResult>("idle");
  const startDownload = async () => {
    const initial = input.readSession();
    if (!ready || initial === null) { setStatus("session-changed"); return; }
    setStatus("pending");
    const result = await exportSession({ ...input, download: text => download(text, "module-publication-session.json") });
    if (result !== "busy") setStatus(input.readSession() === initial ? result : "session-changed");
  };
  const notice = status === "downloaded" ? "Download requested. Set owner-only file permissions before using the publication operator."
    : status === "session-changed" ? "Your wallet session changed. Reconnect the admin wallet and try again."
      : status === "unavailable" ? "The session file could not be downloaded. Reconnect the admin wallet and try again."
        : status === "pending" ? "Preparing the private session file…" : "";
  return <section className={styles.sessionExport} aria-label="Publication session">
    <button className={styles.secondary} type="button" disabled={!ready || status === "pending"}
      aria-describedby="publication-session-handling" onClick={event => { if (event.detail <= 1) void startDownload(); }}>
      <ArrowDownToLine size={15} aria-hidden="true" />Download publication session
    </button>
    <p id="publication-session-handling" className={styles.caption}>Contains your login tokens. Keep this file private and outside the repository. Delete it when finished.</p>
    <p className={styles.caption} role="status" aria-live="polite" aria-atomic="true">{notice}</p>
  </section>;
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
  const [queryText, setQueryText] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "approved">("all");
  const [knownNames, setKnownNames] = useState<Record<string, { name: string; version: string }>>({});
  const lifetime = useRef<AbortController | null>(null);
  const selection = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const search = useRef<HTMLInputElement>(null);
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
      if (selection.current === generation) {
        setDetail(value);
        setKnownNames(names => ({ ...names, [`${id}:${value.job.subject.requestDigest}`]: { name: value.source.descriptor.name, version: value.source.descriptor.version } }));
        window.requestAnimationFrame(() => heading.current?.focus());
      }
      return true;
    } catch (e) { if (selection.current === generation) setError(message(e)); return false; }
    finally { if (selection.current === generation) setDetailLoading(false); }
  }, [account, guardedRequest]);
  const current = detail?.job.subject.submissionId === selected ? detail : null;
  const refreshQueue = () => { setLoading(true); setError(""); setRefresh(n => n + 1); if (selected) void loadDetail(selected); };
  const jobs = queue?.jobs ?? [];
  const visibleJobs = jobs.filter(job => {
    const identity = job.sourceSummary ?? knownNames[`${job.subject.submissionId}:${job.subject.requestDigest}`];
    const matchesState = filter === "all" || (filter === "approved" ? job.state === "accepted" : !["accepted", "rejected"].includes(job.state));
    return matchesState && [identity?.name, identity?.version, job.subject.submissionId, job.subject.author].join(" ").toLowerCase().includes(queryText.trim().toLowerCase());
  });
  return <>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {blocked ? <section className={styles.gate}><h2>Review access required</h2><p>Connect an authorized admin wallet to continue.</p></section> : <div className={styles.workspace} data-selected={selected !== null}>
      <aside className={styles.inbox} aria-label="Module submissions" aria-busy={loading}>
        <div className={styles.inboxHeading}><h2>Submissions{queue && <span className={styles.srOnly}> · {queue.jobs.length} on this page</span>}</h2><button type="button" className={styles.iconButton} aria-label="Refresh" title="Refresh submissions" disabled={loading || busy} onClick={refreshQueue}><RefreshCw size={16} aria-hidden="true" /></button></div>
        <label className={styles.search}><Search size={17} aria-hidden="true" /><span className={styles.srOnly}>Search this page by module, author or submission ID</span><input ref={search} type="search" placeholder="Search this page" value={queryText} onChange={event => setQueryText(event.target.value)} /></label>
        <div className={styles.filters} aria-label="Filter submissions on this page">{([["all", "All"], ["pending", "Pending"], ["approved", "Approved"]] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
        {!queue && loading && <div className={styles.queueSkeleton} role="status"><span className={styles.srOnly}>Loading submissions</span>{[0, 1, 2, 3].map(item => <div key={item}><span /><span /></div>)}</div>}
        {queue && visibleJobs.length === 0 && <div className={styles.empty}><Inbox size={24} aria-hidden="true" /><h3>{jobs.length ? "No matches on this page" : "No submissions yet"}</h3><p>{jobs.length ? "Try another name, filter or page." : "New module applications will appear here."}</p>{(queryText || filter !== "all") && <button type="button" className={styles.textButton} onClick={() => { setQueryText(""); setFilter("all"); }}>Clear filters</button>}</div>}
        <ul className={styles.submissions}>{visibleJobs.map(job => {
          const identity = job.sourceSummary ?? knownNames[`${job.subject.submissionId}:${job.subject.requestDigest}`];
          return <li key={job.subject.submissionId}><button type="button" className={styles.submission} aria-current={selected === job.subject.submissionId ? "true" : undefined} disabled={busy || loading} onClick={() => void loadDetail(job.subject.submissionId)}>
            <span className={styles.submissionHeading}><strong>{identity?.name ?? `Submission ${short(job.subject.submissionId)}`}</strong><ArrowRight size={15} aria-hidden="true" /></span>
            <span className={styles.submissionMeta}><span>{identity ? `v${identity.version}` : `By ${short(job.subject.author)}`}</span><time dateTime={job.createdAt} title={job.createdAt}>{submittedDate(job.createdAt)}</time></span>
            <Status state={job.state} />
          </button></li>;
        })}</ul>
        <div className={styles.pagination}><button className={styles.iconButton} aria-label="Previous page of submissions" disabled={!previous.length || busy || loading} onClick={() => { setLoading(true); setError(""); setCursor(previous.at(-1) ?? null); setPrevious(p => p.slice(0, -1)); }}><ArrowLeft size={17} /></button><span>Page {previous.length + 1}</span><button className={styles.iconButton} aria-label="Next page of submissions" disabled={!queue?.nextCursor || busy || loading} onClick={() => { setLoading(true); setError(""); setPrevious(p => [...p, cursor]); setCursor(queue!.nextCursor); }}><ArrowRight size={17} /></button></div>
      </aside>
      <section className={styles.detail} aria-busy={detailLoading} aria-label="Selected submission">
        {selected && <div className={styles.mobileDetailTools}><button type="button" className={styles.backToInbox} disabled={busy} onClick={() => { selection.current++; setSelected(null); setDetail(null); setDetailLoading(false); window.requestAnimationFrame(() => search.current?.focus()); }}><ArrowLeft size={17} aria-hidden="true" />All submissions</button><button type="button" className={styles.iconButton} aria-label="Refresh" title="Refresh submission" disabled={loading || busy} onClick={refreshQueue}><RefreshCw size={16} aria-hidden="true" /></button></div>}
        {detailLoading && <p className={styles.loadingDetail} role="status">Loading submission…</p>}
        {current ? <><div className={styles.detailHeading}><div className={styles.moduleMark}><Puzzle size={25} aria-hidden="true" /></div><div><h2 className={styles.detailTitle} ref={heading} tabIndex={-1}>{current.source.descriptor.name}</h2><p className={styles.detailVersion}>Version {current.source.descriptor.version}<span aria-hidden="true">·</span><time dateTime={current.job.createdAt}>Submitted {submittedDate(current.job.createdAt)}</time></p></div></div><ReviewEditor key={current.job.subject.submissionId} detail={current} account={account} request={guardedRequest} setParentBusy={setBusy} refresh={async () => { if (!await loadDetail(current.job.subject.submissionId)) throw new Error("The current review could not be refreshed."); setLoading(true); setRefresh(n => n + 1); }} /></> : !detailLoading && <div className={styles.selectionEmpty}><div className={styles.emptyMark}><Puzzle size={36} strokeWidth={1.4} aria-hidden="true" /></div><h2>Choose a module</h2><p>Open a submission to review its source, checks and next steps.</p></div>}
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
  const [fileQuery, setFileQuery] = useState("");
  const [tab, setTab] = useState<"overview" | "source" | "checks" | "decision">("overview");
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
    <div className={styles.detailMeta}><Status state={job.state} /><span>{source.files.length} source files</span></div>
    <nav className={styles.detailTabs} aria-label="Submission sections">{([["overview", "Overview"], ["source", "Source"], ["checks", "Checks"], ["decision", "Decision"]] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>)}</nav>
    <div className={styles.editorBody}>
    {tab === "overview" && <section className={styles.overview}>
      <h3>About this module</h3><p className={styles.description}>{source.descriptor.management.summary}</p>
      <dl className={styles.identities}><WalletIdentity label="Author wallet" value={job.subject.author} /><WalletIdentity label="Reward wallet" value={source.descriptor.rewardWallet} /></dl>
      <div className={styles.reviewProgress} aria-label="Review progress">
        <div data-complete="true"><span className={styles.stepMark}><Check size={16} aria-hidden="true" /></span><div><strong>Submission received</strong><p>Source and author recorded.</p></div></div>
        <div data-complete={canApprove || job.state === "accepted"}><span className={styles.stepMark}>{canApprove || job.state === "accepted" ? <Check size={16} aria-hidden="true" /> : <FileCode2 size={17} aria-hidden="true" />}</span><div><strong>{canApprove || job.state === "accepted" ? "Build checks passed" : job.state === "build_failed" ? "Build needs attention" : ["queued", "running"].includes(job.state) ? "Build checks in progress" : "Build checks needed"}</strong><p>{artifact ? `${artifact.tests.cases.length} test ${artifact.tests.cases.length === 1 ? "case" : "cases"} recorded.` : ["queued", "running"].includes(job.state) ? "Refresh to see the latest result." : "Prepare a test plan for this module."}</p></div></div>
        <div data-complete={job.state === "accepted" || job.state === "rejected"}><span className={styles.stepMark}>{terminal ? <Check size={16} aria-hidden="true" /> : <ShieldCheck size={17} aria-hidden="true" />}</span><div><strong>{job.state === "accepted" ? "Review approved" : job.state === "rejected" ? "Submission rejected" : job.state === "changes_requested" ? "Changes requested" : "Review decision"}</strong><p>{job.state === "accepted" ? "Ready for the separate publication process." : job.state === "rejected" || job.state === "changes_requested" ? "The decision is available to the author." : "Check the evidence and record your decision."}</p></div></div>
      </div>

      <details className={styles.disclosure}><summary>Technical details</summary><ul className={styles.capabilities}>{source.descriptor.requiresHost.map(capability => <li key={capability}>{capability}</li>)}</ul><dl><Hash label="Submission" value={id} /><Hash label="Request digest" value={job.subject.requestDigest} /><Hash label="Package ID" value={source.packageId} /><Hash label="Family ID" value={source.familyId} /></dl><p className={styles.caption}>Revision {job.reviewRevision} · Build attempt {job.attempt}</p><JsonView title="Configuration and management" value={{ configuration: source.descriptor.configuration, ports: source.descriptor.ports, constraints: source.descriptor.constraints, management: source.descriptor.management }} /></details>
    </section>}
    {tab === "source" && <section className={styles.section}><div className={styles.sectionHeading}><h3>Source files <span className={styles.muted}>{source.files.length}</span></h3><button type="button" className={styles.secondary} disabled={busy !== null} onClick={() => void run("source", async () => download(await readSource(), `module-${id}.json`))}><ArrowDownToLine size={16} aria-hidden="true" /> Download source</button></div>
      <label className={styles.fileSearch}><Search size={17} aria-hidden="true" /><span className={styles.srOnly}>Find a source file</span><input type="search" value={fileQuery} onChange={event => setFileQuery(event.target.value)} placeholder="Find a file" /></label>
      <ul className={styles.files}>{source.files.filter(file => file.path.toLowerCase().includes(fileQuery.toLowerCase())).map(file => <li key={file.path}><button type="button" className={styles.fileButton} disabled={busy !== null} onClick={() => void run("source", async () => { await readSource(); setSourceFile(file.path); })}><FileCode2 size={16} aria-hidden="true" /><span>{file.path}</span></button><span>{file.bytes.toLocaleString()} B</span></li>)}</ul>
      {fileQuery && !source.files.some(file => file.path.toLowerCase().includes(fileQuery.toLowerCase())) && <p className={styles.caption}>No files match this search.</p>}
      {sourceFile && <div className={styles.sourceViewer}><div className={styles.sectionHeading}><strong>{sourceFile}</strong><button type="button" className={styles.textButton} onClick={() => setSourceFile(null)}>Close source</button></div><pre tabIndex={0}>{code}</pre></div>}
      <JsonView title="Source manifest and file hashes" value={source.descriptor} />
    </section>}
    {tab === "checks" && <section className={styles.section}><h3>Build checks</h3>{artifact ? <><p className={styles.buildResult}><Check size={17} aria-hidden="true" /> {artifact.tests.allRequiredChecksPassed ? "Required build checks passed" : "Build checks are incomplete"}</p><p className={styles.muted}>{artifact.tests.cases.length} test {artifact.tests.cases.length === 1 ? "case" : "cases"} · Solidity {artifact.compiler.version} · {artifact.schemaVersion === "programmable.modules.engine-build.v1" ? `${artifact.executionGas.toLocaleString()} execution gas` : `${artifact.callbackGas.toLocaleString()} callback gas`}</p>
      {artifact.schemaVersion === "programmable.modules.engine-build.v1" ? <div className={styles.testTable}><table><caption>Isolated engine test results</caption><thead><tr>{["Case", "Deploy", "Code", "Context", "Resources", "Initialize auth", "Execute auth", "Operations"].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{artifact.tests.cases.map(test => <tr key={test.id}><th scope="row">{test.id}</th>{[test.deploymentMatched, test.codeHashMatched, test.contextMatched, test.resourcesMatched, test.unauthorizedInitializeReverted, test.unauthorizedExecuteReverted].map((flag, index) => <td key={index}>{flag === true ? "Pass" : flag === false ? "Fail" : "—"}</td>)}<td>{test.operations.length ? `${test.operations.filter(op => op.outcomeMatched && op.resultMatched && op.stateMatched && op.inputOutputBound && op.replayReverted && op.feesBacked).length}/${test.operations.length} passed` : "—"}</td></tr>)}</tbody></table></div> : <div className={styles.testTable}><table><caption>Isolated build test results</caption><thead><tr><th>Case</th><th>Deploy</th><th>Code</th><th>Binding</th><th>Trade auth</th><th>Action auth</th><th>Gas</th><th>Budget</th></tr></thead><tbody>{artifact.tests.cases.map((test, index) => <tr key={index}><th scope="row">{String(test.id)}</th>{["deploymentMatched", "codeHashMatched", "bindingMatched", "unauthorizedTradeReverted", "unauthorizedActionReverted", "callbackGasBound", "budgetIsolationChecked"].map(key => <td key={key}>{test[key] === true ? "Pass" : test[key] === false ? "Fail" : "—"}</td>)}</tr>)}</tbody></table></div>}<p className={styles.caption}>A dash means the check does not apply to that deployment case. Passing tests still requires a human source review.</p>
      <JsonView title="Compiler, ABI, bytecode and complete test artifact" value={artifact} /></> : <div className={styles.checksEmpty}><Clock3 size={24} aria-hidden="true" /><div><h4>{["queued", "running"].includes(job.state) ? "Checks are in progress" : "Checks have not passed yet"}</h4><p>{["queued", "running"].includes(job.state) ? "Refresh the submission to see the latest result." : "Import a reviewed test plan below to build and test this module."}</p></div></div>}
      {job.lastError && <p className={styles.error}>Last build error: {job.lastError}</p>}
      {detail.attempts.length > 0 && <details className={styles.disclosure}><summary>Worker runs and build history</summary><ol className={styles.history}>{detail.attempts.map((attempt, i) => <li key={i}><strong>Attempt {attempt.attempt} · {attempt.event}</strong><span>{attempt.createdAt}</span>{attempt.workerIdentity && <dl><Hash label="Worker source commit" value={attempt.workerIdentity.sourceCommit} /><Hash label="GitHub run / attempt" value={`${attempt.workerIdentity.runId} / ${attempt.workerIdentity.runAttempt}`} /><Hash label="Workflow" value={attempt.workerIdentity.workflowRef} /></dl>}{attempt.errorCode && <code>{attempt.errorCode}</code>}</li>)}</ol></details>}
      <details className={styles.disclosure} open={!artifact && canQueue}><summary>Build plan</summary><p>Import the reviewed plan for this submission. Starting a new build replaces the previous build result.</p><ImportJson id="review-plan" label="Build plan JSON" value={planText} onChange={setPlanText} maximum={262144} disabled={active || !canQueue} /><button className={styles.secondary} type="button" disabled={active || !canQueue} onClick={() => void run("plan", async () => {
        let plan; try { plan = parseReviewPlan(JSON.parse(planText), job.subject); } catch { throw new ReviewRequestError(400, "MODULE_REVIEW_PLAN_INVALID"); }
        await request(`/${id}/plan`, { expectedReviewRevision: job.reviewRevision, planJson: json(plan) }); setNotice("Build plan queued. Check the current status for worker results."); await refresh();
      }, true)}>{busy === "plan" ? "Queueing build…" : "Queue build"}</button>{!canQueue && <p className={styles.caption}>{self ? "An author cannot queue their own review build." : "A build can be queued when the submission needs a plan, failed, needs changes, or is ready for review."}</p>}</details>
    </section>}
    {self && <p className={styles.note}>This is your submission. Another authorized reviewer must make the decision.</p>}
    {tab === "decision" && !terminal && !self && !receipt && <section className={styles.section}><h3>Review decision</h3><p className={styles.muted}>Record your review here. Publication and onchain approval follow separately.</p>
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
    {tab === "decision" && detail.decisions.length > 0 && <section className={styles.section}><h3>Decision history</h3><ol className={styles.history}>{detail.decisions.map(decision => <li key={decision.decisionDigest}><strong>{decision.command.outcome === "accept" ? "Review approved" : decision.command.outcome === "reject" ? "Rejected" : "Changes requested"}</strong><span>{submittedDate(decision.decidedAt)} · {short(decision.reviewerWallet)}</span><p>{decision.command.reason}</p><JsonView title="Canonical decision record" value={decision} /></li>)}</ol></section>}
    </div>
    {tab === "overview" && (<div className={styles.overviewActions}><button type="button" className={styles.primary} onClick={() => setTab(canApprove || terminal || job.state === "changes_requested" ? "decision" : "checks")}>{terminal ? "View decision" : canApprove ? "Review module" : job.state === "changes_requested" ? "View feedback" : "Open checks"}<ArrowRight size={17} aria-hidden="true" /></button><button type="button" className={styles.secondary} onClick={() => setTab("source")}>View source</button></div>)}
  </div>;
}
