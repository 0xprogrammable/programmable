"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronRight, Copy, Inbox, Puzzle, RefreshCw } from "lucide-react";
import { buildModuleSubmissionHandoff, moduleSubmissionFeedback, moduleSubmissionPresentation,
  type ProfileModuleSubmission } from "@/lib/profile/module-submission-handoff";
import styles from "./profile-module-submissions.module.css";

export type { ProfileModuleSubmission } from "@/lib/profile/module-submission-handoff";
export type ProfileModuleSubmissionsData =
  | Readonly<{ status: "ready"; items: readonly ProfileModuleSubmission[] }>
  | Readonly<{ status: "loading" | "error" | "unavailable" }>;

const unavailable: ProfileModuleSubmissionsData = { status: "unavailable" };
const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

function displayDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : dateFormat.format(date);
}

function SubmissionItem({ item }: { item: ProfileModuleSubmission }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [copyResult, setCopyResult] = useState<{ prompt: string; state: "copying" | "copied" | "failed" } | null>(null);
  const copying = useRef(false);
  const fallback = useRef<HTMLTextAreaElement>(null);
  const status = moduleSubmissionPresentation(item.reviewState);
  const feedback = moduleSubmissionFeedback(item.feedback);
  const submittedAt = displayDate(item.submittedAt);
  const updatedAt = displayDate(item.updatedAt);
  const prompt = buildModuleSubmissionHandoff(item);
  const copyState = copyResult?.prompt === prompt ? copyResult.state : "idle";

  useEffect(() => {
    if (copyState === "failed") { fallback.current?.focus(); fallback.current?.select(); }
  }, [copyState]);

  async function copyForAgent() {
    if (copying.current) return;
    copying.current = true;
    setCopyResult({ prompt, state: "copying" });
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(prompt);
      setCopyResult({ prompt, state: "copied" });
    } catch {
      setCopyResult({ prompt, state: "failed" });
    } finally { copying.current = false; }
  }

  return <li className={styles.item} data-open={open || undefined}>
    <div className={styles.header}>
      <button type="button" className={styles.row} aria-expanded={open} aria-controls={`${id}-detail`}
        aria-label={`${open ? "Hide" : "View"} details for ${item.title}, version ${item.version}, ${status.label}`} onClick={() => setOpen(value => !value)}>
        <span className={styles.moduleIcon} aria-hidden="true"><Puzzle size={22} strokeWidth={1.6} /></span>
        <span className={styles.copy}>
          <span className={styles.title}><strong>{item.title}</strong><span className={styles.version}>v{item.version}</span></span>
          <span className={`${styles.status} ${styles[status.tone]}`}><span className={styles.statusDot} aria-hidden="true" />{status.label}</span>
        </span>
        <span className={styles.open}><span>Details</span><ChevronRight size={16} strokeWidth={1.8} aria-hidden="true" /></span>
      </button>
      <button type="button" className={styles.agentAction} onClick={() => void copyForAgent()} disabled={copyState === "copying"}
        aria-busy={copyState === "copying"} aria-label={`Copy for agent: ${item.title}, version ${item.version}`} aria-describedby={copyState === "idle" ? undefined : `${id}-copy-status`}>
        {copyState === "copied" ? <Check size={16} strokeWidth={1.8} aria-hidden="true" /> : <Copy size={16} strokeWidth={1.8} aria-hidden="true" />}
        Copy for agent
      </button>
    </div>
    <div className={styles.detail} id={`${id}-detail`} hidden={!open}>
      {item.description ? <p className={styles.description}>{item.description}</p> : null}
      <p className={styles.reviewNote}>{status.note}</p>
      {feedback ? <div className={styles.feedback}><p className={styles.feedbackLabel}>Review feedback</p><p className={styles.feedbackText}>{feedback}</p></div> : null}
      <dl className={styles.metadata}>
        {submittedAt ? <div><dt>Submitted</dt><dd><time dateTime={item.submittedAt}>{submittedAt}</time></dd></div> : null}
        {updatedAt ? <div><dt>Last update</dt><dd><time dateTime={item.updatedAt}>{updatedAt}</time></dd></div> : null}
        <div className={styles.identity}><dt>Submission ID</dt><dd>{item.id}</dd></div>
      </dl>
    </div>
    <p className={copyState === "idle" ? styles.srOnly : styles.copyStatus} id={`${id}-copy-status`} role="status" aria-atomic="true">
      {copyState === "copied" ? "Copied. Paste it into your agent." : copyState === "failed" ? "Copy didn’t work. Select and copy the prompt below." : copyState === "copying" ? "Copying prompt…" : ""}
    </p>
    {copyState === "failed" ? <div className={styles.fallback}>
      <label htmlFor={`${id}-prompt`}>Prompt for your agent</label>
      <textarea ref={fallback} id={`${id}-prompt`} value={prompt} readOnly spellCheck={false} rows={8}
        aria-describedby={`${id}-copy-status`} onFocus={event => event.currentTarget.select()} />
    </div> : null}
  </li>;
}

/** The parent supplies the authenticated owner feed and controls refresh and pagination. */
export function ProfileModuleSubmissions({ data = unavailable, onRetry }: { data?: ProfileModuleSubmissionsData; onRetry?: () => void }) {
  if (data.status === "loading") return <div className={styles.loading} aria-busy="true">
    <p className={styles.srOnly} role="status">Loading submissions…</p>
    {[0, 1, 2].map(row => <div className={styles.skeleton} key={row} aria-hidden="true"><span /><div><span /><span /></div><span /></div>)}
  </div>;

  if (data.status === "ready" && data.items.length > 0) return <ul className={styles.list} aria-label="Your submitted modules">
    {data.items.map(item => <SubmissionItem key={item.id} item={item} />)}
  </ul>;

  if (data.status === "ready") return <div className={styles.state}>
    <span className={styles.icon} aria-hidden="true"><Puzzle size={28} strokeWidth={1.4} /></span>
    <h3>No submissions yet.</h3>
    <p>Build a module and submit it for review.</p>
    <Link className={styles.guide} href="/developers/modules">Build a module<ArrowUpRight size={16} aria-hidden="true" strokeWidth={1.8} /></Link>
  </div>;

  return <div className={styles.state} role="status">
    <span className={styles.icon} aria-hidden="true"><Inbox size={28} strokeWidth={1.4} /></span>
    <h3>Couldn’t load your submissions.</h3>
    {onRetry ? <button type="button" className={styles.guide} onClick={onRetry}><RefreshCw size={16} aria-hidden="true" strokeWidth={1.8} />Try again</button>
      : <Link className={styles.guide} href="/developer-reference/module-mode">Module guide<ArrowUpRight size={16} aria-hidden="true" strokeWidth={1.8} /></Link>}
  </div>;
}
