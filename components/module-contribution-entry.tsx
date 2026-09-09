"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Copy, Plus, Puzzle } from "lucide-react";
import { useState } from "react";
import { buildAgentInstructions } from "@/lib/agent-connection";
import styles from "@/components/module-contribution-entry.module.css";

export function ModuleContributionEntry() {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function copyInstructions() {
    try {
      await navigator.clipboard.writeText(buildAgentInstructions({
        intent: "Build and submit a reusable Module Mode module",
      }));
      setCopied(true);
      setError("");
    } catch {
      setError("Copy failed. Open the agent guide below.");
    }
  }

  return (
    <div className={styles.page}>
      <Link href="/launch/modules" className={styles.back}>
        <ArrowLeft size={16} aria-hidden="true" /> Modules
      </Link>

      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>For builders</p>
          <h1>Build a module.</h1>
          <p className={styles.intro}>
            Make an attachment that other people can add to their coins.
          </p>
          <Link href="/developers/api-keys?purpose=modules" className={styles.primaryAction}>
            Connect your builder <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <button className={styles.copyAction} type="button" onClick={() => void copyInstructions()}>
            {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
            {copied ? "Instructions copied" : "Already connected? Copy instructions"}
          </button>
          <p className={styles.copyStatus} role={error ? "alert" : "status"}>
            {error || (copied ? "Paste them into your builder to get started." : "")}
          </p>
        </div>

        <figure className={styles.modulePreview} aria-label="A module adds a new ability to a coin.">
          <div className={styles.coinTile} aria-hidden="true">
            <span className={styles.coinMark}>P</span>
            <span>Your coin</span>
          </div>
          <div className={styles.connector} aria-hidden="true"><Plus size={20} strokeWidth={1.6} /></div>
          <div className={styles.attachmentTile} aria-hidden="true">
            <Puzzle size={30} strokeWidth={1.5} />
            <span>Your module</span>
          </div>
        </figure>
      </header>

      <ol className={styles.steps} aria-label="From idea to published module">
        <li>
          <span className={styles.stepNumber}>1</span>
          <div><h2>Make it</h2><p>Describe your idea. Your builder writes and tests the module.</p></div>
        </li>
        <li>
          <span className={styles.stepNumber}>2</span>
          <div><h2>Send it for review</h2><p>Your builder submits the source and checks for feedback.</p></div>
        </li>
        <li>
          <span className={styles.stepNumber}>3</span>
          <div><h2>Share it</h2><p>Once approved and published, people can add it to their coins.</p></div>
        </li>
      </ol>

      <div className={styles.footer}>
        <Link href="/profile?section=submissions#profile-modules-title" className={styles.profileLink}>
          Your submissions <ArrowRight size={16} aria-hidden="true" />
        </Link>
        <details className={styles.resources}>
          <summary>Developer resources <ChevronDown size={16} aria-hidden="true" /></summary>
          <nav aria-label="Module developer resources">
            <Link href="/developer-reference/module-mode">Module docs <ArrowRight size={16} aria-hidden="true" /></Link>
            <a href="/agents.md">Agent guide <ArrowRight size={16} aria-hidden="true" /></a>
          </nav>
        </details>
      </div>
    </div>
  );
}
