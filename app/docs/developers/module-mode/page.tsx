import type { Metadata } from "next";
import Link from "next/link";
import { DocsShell } from "@/components/docs-shell";
import styles from "@/components/developer-docs.module.css";

export const metadata: Metadata = {
  title: "Build a module · Programmable",
  description: "Give your agent an idea and an API key to build, submit and track a reusable module.",
  alternates: { canonical: "/developer-reference/module-mode" },
};
const sections = [
  { id: "start", label: "Get started" },
  { id: "package", label: "Your module package" },
  { id: "profiles", label: "Profiles and configuration" },
  { id: "api", label: "Submit and track" },
  { id: "review", label: "Review and availability" },
  { id: "rewards", label: "Author rewards" },
  { id: "recovery", label: "Recover transactions" },
] as const;
const cliDirectory = "/developers/module-mode-cli/v1.0.0-development.7";

export default function ModuleModeDeveloperPage() {
  return <DocsShell currentPath="/docs/developers/module-mode" title="Build a module"
    kicker="Module Mode" parentHref="/docs/developers" parentLabel="Developers" sections={sections}
    description="Start with an idea and an API key. Your agent builds the module and submits its source for review.">
    <p className={styles.bodyCopy}>
      Module Mode starts with a simple coin and adds optional programs. A contribution can provide
      its own logic, state and management actions, or propose a new market engine.
      Ideas do not have to fit a preset category. Required host capabilities and compatible configurations are part of the review.
    </p>
    <p className={styles.bodyCopy}>For product settings, read <Link href="/docs/models/module-mode">Module Mode</Link>.
      For terminal integration, read <Link href="/developer-reference/module-mode-indexing">Index Module Mode launches</Link>.</p>
    <section id="start">
      <h2>Get started</h2>
      <ol className={styles.steps}>
        <li>Connect your EVM wallet on <Link href="/developers/api-keys?purpose=modules">API keys</Link> and create a key with
          <strong> Launches + modules</strong> access.</li>
        <li>Save the key in your agent&apos;s <code>PROGRAMMABLE_API_KEY</code> secret environment.
          Describe your idea and copy the prompt from the key page.</li>
        <li>Your agent reads the <a href="/developers/module-mode-api-v1.md">API guide</a> and verifies the
          <a href={`${cliDirectory}/manifest.json`}> current CLI</a>. Before building, it runs <code>module-context</code>
          to obtain your author wallet, default reward wallet, permissions and prerequisites.</li>
        <li>The agent builds and checks the module, prepares its exact source request, submits it, then keeps the returned ID.
          Use <code> review-status-module</code> to follow its build, review feedback and next step.</li>
      </ol>
      <p className={styles.bodyCopy}>A GitHub repository or pull request is optional. The API receives the complete,
        hash-bound source package directly.</p>
      <p className={styles.bodyCopy}>Rewards default to the wallet linked to your key. Specify another payout address only
        if you want to use one. The agent resolves any missing asset, funding or exit requirements before coding.</p>
      <p className={styles.bodyCopy}>For an executable Engine contribution, download the source archive identified by the
        <a href="/developers/module-mode-starters/engine-program/v0.1.0-development.1/manifest.json"> Engine starter manifest</a>,
        verify its hash, then follow its README. The creator-attested settlement example has no approved revision or deployed host.</p>
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
      <p className={styles.bodyCopy}>Authenticated context provides the author and default reward wallet. Both become explicit
        fields in the source package. Repeated helper contracts or instances do not create extra author shares.</p>
    </section>
    <section id="profiles">
      <h2>Profiles and configuration</h2>
      <p className={styles.bodyCopy}>Native programs and Engine contributions use the same source API. The operator selects
        <code> programmable.native-solidity@1</code> for the Native callback interface or
        <code> programmable.module-engine-solidity@1</code> for executable constructor, initialization and operation logic.
        A capability name in a descriptor does not implement that behavior.</p>
      <p className={styles.bodyCopy}>These are installed review adapters. A new runtime, hook interface or external service
        can still be submitted with its actual requirements. Read the context&apos;s review coverage before building;
        the platform must provide any missing review environment or integration before publication.</p>
      <p className={styles.bodyCopy}>SDK development.4 fields can declare <code>binding.mode</code> as <code>input</code> or
        <code> fixed</code>. Inputs can vary within their schema. A fixed override fails API compilation, and the constructor
        and reviewed host revision must also enforce it. One general quote template can accept different token contract addresses;
        a fixed quote template binds one address. General quote trading still fixes its infrastructure configuration.</p>
      <p className={styles.bodyCopy}>The quote trading profile supports exact-input buys and sells. Fee conversion requires
        the reviewed direct Quote/WETH V3 route, qualified price history and liquidity, or direct WETH unwrap. User minimums
        can tighten its checks. Escrow and creator-attested settlement are non-trading profiles with funded liabilities and
        explicit withdrawal or expiry rules. Creator attestation does not independently prove delivery of an external service.</p>
      <p className={styles.bodyCopy}>Read the <a href="https://github.com/programmablehq/PROGRAMMABLE/blob/production/contracts/spec/module-engine-host-v1.md">Engine host specification</a>
        {" "}for exact permissions, ABI, market and token limits. These source profiles do not imply an available catalog entry.</p>
    </section>
    <section id="api">
      <h2>Submit and track</h2>
      <p className={styles.bodyCopy}>Use <code>https://api.programmable.market</code> and read the live capabilities
        before uploading. An absent or disabled capability means this deployment is not accepting contributions.</p>
      <dl className={`${styles.dataList} ${styles.technicalData}`}>
        <div><dt>Capabilities</dt><dd><code>GET /v1/modules/capabilities</code></dd></div>
        <div><dt>Author and prerequisites</dt><dd><code>GET /v1/modules/context</code></dd></div>
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
        {" · "}<a href={`${cliDirectory}/programmable-module-mode-1.0.0-development.7.mjs`}>Standalone CLI</a></p>
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
      <p className={styles.bodyCopy}><code>awaiting_plan</code> means the platform must select or provide the review path.
        Keep the existing submission. Submit a new version only when its source needs to change.</p>
      <p className={styles.bodyCopy}><code>status-module</code> keeps the historical intake receipt.
        <code> review-status-module</code> reads current progress with your existing Module contributions key.
        An <code>accepted</code> review is followed by registry admission and catalog activation.</p>
      <p className={styles.bodyCopy}>The Native and Engine Solidity build profiles each accept up to 4 MiB of packaged
        source, dependencies and documentation, and 16 KiB of encoded configuration. Engine review bounds execution to
        3,000,000 gas and initialization/operation data to 16 KiB each. Intake can store larger packages; a successful upload
        does not establish compatibility with a build profile.</p>
      <p className={styles.bodyCopy}>Public availability needs a reproducible build, the required security and
        compatibility checks, a reviewed version, exact deployed code and an active catalog binding.
        A new version does not silently change existing coins. Modules that need a new host capability
        include that extension in their review.</p>
    </section>
    <section id="rewards">
      <h2>Author rewards</h2>
      <p className={styles.bodyCopy}>Native V2 and the Engine V1 quote profile charge 0.10% without eligible families,
        or 0.30% with them: 0.10% for Programmable and 0.20% shared equally among distinct eligible families.
        The creator&apos;s selected fee is additional. Eligibility is explicitly bound during admission.</p>
      <p className={styles.bodyCopy}>Native V1 keeps its original 0.20% fee: 0.10% each for Programmable and eligible
        authors, or the full 0.20% for Programmable without eligible families. Old claims stay in their original ledger.
        Non-trading deposits, requests and refunds create no swap fees.</p>
      <p className={styles.bodyCopy}>Rewards arise from actual qualifying fees. Submitting a wallet or receiving
        a draft ID does not create a payout. Module operating budgets and already earned claims remain separate
        from the creator&apos;s personal fee recipient.</p>
      <p className={styles.bodyCopy}><Link href="/launch/modules">Open the Module Mode builder</Link></p>
    </section>
    <section id="recovery">
      <h2>Recover transactions and claims</h2>
      <p className={styles.bodyCopy}>After a timeout, keep the transaction hash from your wallet and check its receipt before
        starting another action. The original release, account, token, calldata and value must agree. A saved browser record
        is not permission to resend, and a mined receipt is separate from finalized indexing.</p>
      <p className={styles.bodyCopy}>If the website is unavailable, use the existing
        <a href="https://github.com/programmablehq/PROGRAMMABLE/blob/production/lib/module-mode/management.ts"> Native management client</a>
        {" or "}<a href="https://github.com/programmablehq/PROGRAMMABLE/blob/production/lib/module-engine/client.ts">Engine client</a>
        {" "}with the verified original release and your RPC. Read accrued credit in the original ledger and review its
        <code> claimTo(recipient)</code> call from the entitled wallet. Claims send zero native value apart from network gas.
        Module budgets and escrow refunds use their own instance or host actions. The source CLI does not send wallet transactions.</p>
    </section>
  </DocsShell>;
}
