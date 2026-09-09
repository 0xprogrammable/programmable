"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Copy } from "lucide-react";
import { useState } from "react";
import { buildAgentInstructions } from "@/lib/agent-connection";
import styles from "@/components/module-contribution-entry.module.css";

export function ModuleContributionEntry() {
  const [idea, setIdea] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const instructions = buildAgentInstructions({
    intent: idea.trim()
      ? `Build and submit a reusable Module Mode module. The module should do the following: ${idea.trim().replace(/\.+$/u, "")}`
      : "Build and submit a reusable Module Mode module. Ask me what my module should do before starting",
  });

  async function copyInstructions() {
    try {
      await navigator.clipboard.writeText(instructions);
      setCopied(true);
      setError("");
    } catch {
      setError("Copy failed. Open the prompt below and copy it manually.");
    }
  }

  return (
    <div className={styles.page}>
      <nav className={styles.navigation} aria-label="Module builder navigation">
        <Link href="/launch/modules" className={styles.back}>
          <ArrowLeft size={16} aria-hidden="true" /> Modules
        </Link>
        <Link href="/profile?section=submissions#profile-modules-title" className={styles.textLink}>
          Submissions <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </nav>

      <section className={styles.workspace} aria-labelledby="module-builder-title">
        <header className={styles.header}>
          <h1 id="module-builder-title">Build a module</h1>
          <p>A module gives a coin a new ability. Describe yours and let your AI builder create it.</p>
        </header>

        <label className={styles.ideaField} htmlFor="module-idea">
          <span>Your idea</span>
          <textarea
            id="module-idea"
            value={idea}
            maxLength={4000}
            placeholder="Reward every 10th buyer with a share of the fees."
            onChange={(event) => {
              setIdea(event.target.value);
              setCopied(false);
              setError("");
            }}
          />
        </label>

        <div className={styles.actions}>
          <button className={styles.primaryAction} type="button" onClick={() => void copyInstructions()}>
            {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
            Copy prompt
          </button>
          <Link href="/developers/api-keys?purpose=modules" className={styles.secondaryAction}>
            Get API key <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
        <p className={styles.copyStatus} role={error ? "alert" : "status"}>
          {error || (copied ? "Prompt copied. Paste it into your AI builder." : "Paste the prompt into your AI builder. Connect the API key through its secure setup.")}
        </p>

        <details className={styles.promptDetails}>
          <summary>View prompt <ChevronDown size={16} aria-hidden="true" /></summary>
          <pre>{instructions}</pre>
        </details>

        <p className={styles.reviewNote}>Your builder submits the module for review. Approval is required before publication.</p>
      </section>

      <nav className={styles.resources} aria-label="Module developer resources">
        <Link href="/developer-reference/module-mode">Module docs <ArrowRight size={16} aria-hidden="true" /></Link>
        <a href="/agents.md">Agent guide <ArrowRight size={16} aria-hidden="true" /></a>
      </nav>
    </div>
  );
}
