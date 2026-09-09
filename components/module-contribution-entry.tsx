"use client";

import Link from "next/link";
import { ArrowRight, Check, ChevronDown, Copy } from "lucide-react";
import { useRef, useState, type Ref } from "react";
import { Disclosure } from "@/components/disclosure";
import { buildAgentInstructions } from "@/lib/agent-connection";
import styles from "@/components/module-contribution-entry.module.css";

export type BuilderKind = "module" | "hook";

export function BuilderSetupSteps({ keyReady }: { keyReady: boolean }) {
  return (
    <ol className={styles.setupSteps} aria-label="Builder setup">
      <li data-complete={keyReady} aria-current={!keyReady ? "step" : undefined}>
        <span aria-hidden="true">{keyReady ? <Check size={14} /> : "1"}</span>
        API key
      </li>
      <li aria-current={keyReady ? "step" : undefined}>
        <span aria-hidden="true">2</span>
        Your idea
      </li>
    </ol>
  );
}

export function BuilderIdeaPrompt({ kind, keyLabel, scopes, wallet, ideaRef }: {
  kind: BuilderKind;
  keyLabel: string;
  scopes: readonly string[];
  wallet: string;
  ideaRef?: Ref<HTMLTextAreaElement>;
}) {
  const [idea, setIdea] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const copyGeneration = useRef(0);
  const isModule = kind === "module";
  const instructions = buildAgentInstructions({
    scopes,
    wallet,
    intent: isModule
      ? `Build and submit a reusable Module Mode module for this idea: ${idea.trim()}`
      : `Build a complete custom hook project for this idea: ${idea.trim()}. Check current launch capabilities and requirements before coding. Prepare and submit the supported API request when authorized, preserve its receipt, and provide the website handoff for any wallet steps. Report required review or unsupported dependencies without promising publication`,
  });

  async function copyInstructions() {
    if (!idea.trim()) return;
    const generation = ++copyGeneration.current;
    try {
      await navigator.clipboard.writeText(instructions);
      if (generation !== copyGeneration.current) return;
      setCopied(true);
      setError("");
    } catch {
      if (generation !== copyGeneration.current) return;
      setCopied(false);
      setError("Copy failed. Open the prompt below and copy it manually.");
    }
  }

  return (
    <section className={styles.promptWorkspace} aria-labelledby="builder-prompt-title">
      <header className={styles.header}>
        <h2 id="builder-prompt-title">Describe your idea</h2>
        <p>Use your saved <strong>{keyLabel}</strong> key in your AI builder’s secure setup.</p>
      </header>

      <form onSubmit={(event) => { event.preventDefault(); void copyInstructions(); }}>
        <label className={styles.ideaField} htmlFor="builder-idea">
          <span>{isModule ? "What should your module do?" : "What should your hook do?"}</span>
          <textarea
            ref={ideaRef}
            id="builder-idea"
            value={idea}
            required
            maxLength={4000}
            placeholder={isModule
              ? "An attachment that uses a share of trading fees to reward holders."
              : "A coin with swap fees that change as trading activity increases."}
            onChange={(event) => {
              copyGeneration.current += 1;
              event.target.setCustomValidity(event.target.value.trim() ? "" : "Describe your idea first.");
              setIdea(event.target.value);
              setCopied(false);
              setError("");
            }}
          />
        </label>

        <div className={styles.actions}>
          <button className={styles.primaryAction} type="submit">
            {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
            {copied ? "Copied" : "Copy prompt"}
          </button>
        </div>
      </form>
      <p className={styles.copyStatus} role={error ? "alert" : "status"}>
        {error || (copied
          ? "Paste it into your AI builder to start. Your API key is not included in the prompt."
          : "The prompt gives your builder the current docs and submission steps. Your API key stays separate.")}
      </p>

      {idea.trim() ? (
        <Disclosure className={styles.promptDetails}>
          <summary>View prompt <ChevronDown size={16} aria-hidden="true" /></summary>
          <pre>{instructions}</pre>
        </Disclosure>
      ) : null}

      <div className={styles.nextStep}>
        <p>{isModule
          ? "Your key supplies the author and default reward wallet. Submitted modules are reviewed before they can be published."
          : "Your builder checks the launch requirements. Review and any wallet confirmations remain separate steps."}</p>
        <Link href={isModule ? "/profile?section=submissions#profile-modules-title" : "/developers/api-keys?view=history"}>
          {isModule ? "View submissions" : "View your launches"} <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
