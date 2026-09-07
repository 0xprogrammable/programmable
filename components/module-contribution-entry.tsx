"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Copy } from "lucide-react";
import { useState } from "react";
import { buildAgentInstructions } from "@/lib/agent-connection";
import styles from "@/components/module-contribution-entry.module.css";

export function ModuleContributionEntry() {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  return <div className={styles.page}>
    <Link href="/launch/modules" className={styles.back}><ArrowLeft size={16} aria-hidden="true" />Module Mode</Link>
    <h1>Build a module</h1>
    <ol className={styles.steps}>
      <li><span>1</span><div><h2>Connect your agent</h2><p>Create an API key and copy the connection to your agent.</p><Link href="/developers/api-keys?purpose=modules">Get an API key<ArrowRight size={16} aria-hidden="true" /></Link></div></li>
      <li><span>2</span><div><h2>Build your idea</h2><p>Your agent gets the source format, configuration fields, website controls and examples from the guide.</p><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(buildAgentInstructions({ intent: "Build and submit a reusable Module Mode module" })); setCopied(true); setError(""); } catch { setError("Copy failed. Open the agent guide below."); } }}>{copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{copied ? "Copied" : "Copy agent instructions"}</button></div></li>
      <li><span>3</span><div><h2>Submit for review</h2><p>Include your EVM author and reward wallets. After approval and publication, others can add your module and you share in its fees.</p></div></li>
    </ol>
    {error ? <p role="alert">{error}</p> : null}
    <nav className={styles.resources} aria-label="Module developer resources"><Link href="/developer-reference/module-mode">Developer docs<ArrowRight size={16} /></Link><a href="/agents.md">Agent guide<ArrowRight size={16} /></a></nav>
  </div>;
}
