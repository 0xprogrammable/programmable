import Link from "next/link";
import { ArrowUpRight, Inbox } from "lucide-react";
import styles from "./profile-module-submissions.module.css";

/** Own-profile presentation only. No authenticated submission-history reader is connected yet. */
export function ProfileModuleSubmissions() {
  return <div className={styles.state}>
    <span className={styles.icon} aria-hidden="true"><Inbox size={28} strokeWidth={1.4} /></span>
    <h3>Submission history isn’t available here yet.</h3>
    <p>Your agent can check the latest review status of each module you’ve sent.</p>
    <Link className={styles.guide} href="/developer-reference/module-mode">Module guide<ArrowUpRight size={16} aria-hidden="true" strokeWidth={1.8} /></Link>
  </div>;
}
