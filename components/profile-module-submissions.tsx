import Link from "next/link";
import { ArrowUpRight, ChevronRight, Inbox, Puzzle, RefreshCw } from "lucide-react";
import type { ModuleReviewState } from "@/lib/module-mode/review-contract";
import styles from "./profile-module-submissions.module.css";

export type ProfileModuleSubmission = Readonly<{
  id: string;
  title: string;
  version: string;
  description?: string;
  reviewState: ModuleReviewState;
  submittedAt?: string;
  updatedAt?: string;
  feedback?: string;
}>;

export type ProfileModuleSubmissionsData =
  | Readonly<{ status: "ready"; items: readonly ProfileModuleSubmission[] }>
  | Readonly<{ status: "loading" | "error" | "unavailable" }>;

const unavailable: ProfileModuleSubmissionsData = { status: "unavailable" };
const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });
const reviewPresentation: Record<ModuleReviewState, { label: string; tone: "neutral" | "attention" | "success"; note: string }> = {
  awaiting_plan: { label: "Submitted", tone: "neutral", note: "Waiting for the review to start." },
  queued: { label: "Queued", tone: "neutral", note: "Your module is waiting for its checks." },
  running: { label: "Checking", tone: "neutral", note: "Checks are running." },
  built: { label: "Ready for review", tone: "neutral", note: "Checks are complete. Your module is ready for a reviewer." },
  build_failed: { label: "Checks failed", tone: "attention", note: "This version did not pass its checks." },
  changes_requested: { label: "Changes requested", tone: "attention", note: "A reviewer has requested changes to this version." },
  accepted: { label: "Review approved", tone: "success", note: "Review is approved. Publication is a separate step." },
  rejected: { label: "Not approved", tone: "attention", note: "This version was not approved." },
};

function displayDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : dateFormat.format(date);
}

/** Display data must come from an authenticated owner feed. No submission-history reader is connected yet. */
export function ProfileModuleSubmissions({ data = unavailable, onRetry }: { data?: ProfileModuleSubmissionsData; onRetry?: () => void }) {
  if (data.status === "loading") return <div className={styles.loading} aria-busy="true">
    <p className={styles.srOnly} role="status">Loading submissions…</p>
    {[0, 1, 2].map(row => <div className={styles.skeleton} key={row} aria-hidden="true"><span /><div><span /><span /></div><span /></div>)}
  </div>;

  if (data.status === "ready" && data.items.length > 0) return <ul className={styles.list} aria-label="Your submitted modules">
    {data.items.map(item => {
      const status = reviewPresentation[item.reviewState];
      const submittedAt = displayDate(item.submittedAt);
      const updatedAt = displayDate(item.updatedAt);
      return <li key={item.id}>
        <details className={styles.item}>
          <summary className={styles.row} aria-label={`${item.title}, version ${item.version}, ${status.label}. View details`}>
            <span className={styles.moduleIcon} aria-hidden="true"><Puzzle size={22} strokeWidth={1.6} /></span>
            <span className={styles.copy}>
              <span className={styles.title}><strong>{item.title}</strong><span className={styles.version}>v{item.version}</span></span>
            </span>
            <span className={`${styles.status} ${styles[status.tone]}`}><span className={styles.statusDot} aria-hidden="true" />{status.label}</span>
            <span className={styles.open}><span>Details</span><ChevronRight size={16} strokeWidth={1.8} aria-hidden="true" /></span>
          </summary>
          <div className={styles.detail}>
            {item.description ? <p className={styles.description}>{item.description}</p> : null}
            {submittedAt || updatedAt ? <dl className={styles.dates}>
              {submittedAt ? <div><dt>Submitted</dt><dd><time dateTime={item.submittedAt}>{submittedAt}</time></dd></div> : null}
              {updatedAt ? <div><dt>Last update</dt><dd><time dateTime={item.updatedAt}>{updatedAt}</time></dd></div> : null}
            </dl> : null}
            <p className={styles.reviewNote}>{item.feedback || status.note}</p>
            {item.reviewState === "accepted" && item.feedback ? <p className={styles.publicationNote}>{status.note}</p> : null}
          </div>
        </details>
      </li>;
    })}
  </ul>;

  if (data.status === "ready") return <div className={styles.state}>
    <span className={styles.icon} aria-hidden="true"><Puzzle size={28} strokeWidth={1.4} /></span>
    <h3>No submissions yet.</h3>
  </div>;

  if (data.status === "error") return <div className={styles.state} role="status">
    <span className={styles.icon} aria-hidden="true"><Inbox size={28} strokeWidth={1.4} /></span>
    <h3>Couldn’t load your submissions.</h3>
    {onRetry ? <button type="button" className={styles.guide} onClick={onRetry}><RefreshCw size={16} aria-hidden="true" strokeWidth={1.8} />Try again</button> : null}
  </div>;

  return <div className={styles.state}>
    <span className={styles.icon} aria-hidden="true"><Inbox size={28} strokeWidth={1.4} /></span>
    <h3>History isn’t available here yet.</h3>
    <p>Check the status with your agent.</p>
    <Link className={styles.guide} href="/developer-reference/module-mode">Module guide<ArrowUpRight size={16} aria-hidden="true" strokeWidth={1.8} /></Link>
  </div>;
}
