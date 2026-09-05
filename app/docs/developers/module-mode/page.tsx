import type { Metadata } from "next";
import Link from "next/link";
import { DocsShell } from "@/components/docs-shell";
import styles from "@/components/developer-docs.module.css";

export const metadata: Metadata = {
  title: "Build a module · Programmable",
  description: "Create, submit and track a Module Mode source package with your EVM wallet and an API key.",
  alternates: { canonical: "/docs/developers/module-mode" },
};
const sections = [
  { id: "start", label: "Get started" },
  { id: "package", label: "Your module package" },
  { id: "api", label: "Submit and track" },
  { id: "review", label: "Review and availability" },
  { id: "rewards", label: "Author rewards" },
] as const;
const cliDirectory = "/developers/module-mode-cli/v1.0.0-development.2";

export default function ModuleModeDeveloperPage() {
  return <DocsShell currentPath="/docs/developers/module-mode" title="Build a module"
    kicker="Module Mode" parentHref="/docs/developers" parentLabel="Developers" sections={sections}
    description="Turn an idea into a reusable part of a coin. Submit the source through the API, with its configuration, wallet declarations and controls.">
    <p className={styles.bodyCopy}>
      Module Mode starts with a simple coin and adds optional programs. A contribution can provide
      its own logic, state and management actions, or propose a new market engine.
      Its required host capabilities and compatible configurations are part of the review.
    </p>
    <section id="start">
      <h2>Get started</h2>
      <ol className={styles.steps}>
        <li>Connect your EVM wallet on <Link href="/developers/api-keys">API keys</Link> and choose
          <strong> Module contributions</strong>. The option becomes available when the API accepts submissions.</li>
        <li>Give your agent the <a href="/developers/module-mode-api-v1.md">API guide</a> and the
          <a href={`${cliDirectory}/manifest.json`}> pinned CLI manifest</a>. Verify the file hash from
          that manifest before running the standalone CLI with Node.js 24.14 or later in the Node 24 line.</li>
        <li>Provide your idea, author wallet and reward wallet. Keep the API key in the agent&apos;s
          <code> PROGRAMMABLE_MODULES_API_KEY</code> secret environment.</li>
        <li>Build and test the module, prepare its exact source request, submit it, then keep the returned ID.
          Use <code> review-status-module</code> to follow its build, review feedback and next step.</li>
      </ol>
      <p className={styles.bodyCopy}>A GitHub repository or pull request is optional. The API receives the complete,
        hash-bound source package directly.</p>
    </section>
    <section id="package">
      <h2>Your module package</h2>
      <dl className={styles.dataList}>
        <div><dt>Identity</dt><dd>Name, explicit version, stable module family, EVM author and EVM reward wallet.</dd></div>
        <div><dt>Source</dt><dd>Every required source file and its SHA-256. Optional Git provenance includes both the repository and exact revision.</dd></div>
        <div><dt>Configuration</dt><dd>Typed fields, units, defaults in the host catalog, limits and compatibility conditions.</dd></div>
        <div><dt>Capabilities</dt><dd>Required runtime, contracts, dependencies, resources, funding and failure behavior.</dd></div>
        <div><dt>Management</dt><dd>Reads, actions, input schemas, authorized roles and instructions for any controls your module needs.</dd></div>
      </dl>
      <p className={styles.bodyCopy}>The author must match the wallet that owns the API key. The reward wallet may be
        different. Both must be nonzero EVM addresses. Repeated helper contracts or instances do not create extra author shares.</p>
    </section>
    <section id="api">
      <h2>Submit and track</h2>
      <p className={styles.bodyCopy}>Use <code>https://api.programmable.market</code> and read the live capabilities
        before uploading. An absent or disabled capability means this deployment is not accepting contributions.</p>
      <dl className={`${styles.dataList} ${styles.technicalData}`}>
        <div><dt>Capabilities</dt><dd><code>GET /v1/modules/capabilities</code></dd></div>
        <div><dt>Submit source</dt><dd><code>POST /v1/modules/submissions</code></dd></div>
        <div><dt>Your submissions</dt><dd><code>GET /v1/modules/submissions</code></dd></div>
        <div><dt>One submission</dt><dd><code>GET /v1/modules/submissions/:id</code></dd></div>
        <div><dt>Review readiness</dt><dd><code>GET /v1/modules/review-capabilities</code></dd></div>
        <div><dt>Build and review progress</dt><dd><code>GET /v1/modules/submissions/:id/review</code></dd></div>
      </dl>
      <p className={styles.bodyCopy}>Module keys carry <code>modules:submit</code> and <code>modules:read</code>.
        Use one stable idempotency key for each exact request. If a connection fails, retry the same saved request
        and key. Changed source becomes a new immutable revision.</p>
      <p className={styles.bodyCopy}><a href="/developers/module-mode-api-v1.md">Read the complete API and CLI guide</a>
        {" · "}<a href={`${cliDirectory}/programmable-module-mode-1.0.0-development.2.mjs`}>Standalone CLI</a></p>
    </section>
    <section id="review">
      <h2>Review and availability</h2>
      <p className={styles.bodyCopy}>The intake API stores an unreviewed source draft. Its
        <code> draft_received</code> receipt proves that the exact package was saved. It does not execute the
        uploaded source or approve the module.</p>
      <p className={styles.bodyCopy}>The separate review status follows the operator&apos;s build plan,
        queued build, result and reviewer decision. Read its <code>nextAction</code>: wait for the build or
        decision, apply requested changes in a new source version, or wait for registry admission after acceptance.
        The review capability must be enabled before these private progress reads are available.</p>
      <p className={styles.bodyCopy}><code>status-module</code> keeps the historical intake receipt.
        <code> review-status-module</code> reads current progress with your existing Module contributions key.
        An <code>accepted</code> review still reports no onchain approval or public availability.</p>
      <p className={styles.bodyCopy}>Public availability needs a reproducible build, the required security and
        compatibility checks, a reviewed version, exact deployed code and an active catalog binding.
        A new version does not silently change existing coins. Modules that need a new host capability
        include that extension in their review.</p>
    </section>
    <section id="rewards">
      <h2>Author rewards</h2>
      <p className={styles.bodyCopy}>The native ETH engine charges 0.20% in protocol fees in addition to the
        creator&apos;s selected fee. Half is for Programmable and half is shared equally among the distinct,
        eligible module families used by the coin. Eligibility and attribution are bound during review.</p>
      <p className={styles.bodyCopy}>Rewards arise from actual qualifying fees. Submitting a wallet or receiving
        a draft ID does not create a payout. Module operating budgets and already earned claims remain separate
        from the creator&apos;s personal fee recipient.</p>
      <p className={styles.bodyCopy}><Link href="/launch/modules">Open the Module Mode builder</Link></p>
    </section>
  </DocsShell>;
}
