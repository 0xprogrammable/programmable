import type { Metadata } from "next";
import Link from "next/link";
import { DocsShell } from "@/components/docs-shell";
import styles from "@/components/developer-docs.module.css";
import { moduleModeIndexerContract as contract } from "@/lib/module-mode/indexer-contract";

export const metadata: Metadata = {
  title: "Index Module Mode launches · Programmable",
  description: "Discover and verify Module Mode coins independently of their selected modules.",
  alternates: { canonical: "/developer-reference/module-mode-indexing" },
};
const sections = [
  { id: "discovery", label: "Discovery" },
  { id: "verify", label: "Verify a launch" },
  { id: "identity", label: "Record identity" },
  { id: "modules", label: "Module configuration" },
  { id: "reads", label: "Public reads" },
] as const;

export default function ModuleModeIndexingPage() {
  return <DocsShell currentPath="/developer-reference/module-mode-indexing"
    title="Index Module Mode launches" kicker="Developers" parentHref="/docs/developers"
    parentLabel="Developers" sections={sections}
    description="Index the launch contract, then attach its module configuration. The same identity rules apply to base coins and configured coins.">
    <p className={styles.bodyCopy}>This reference covers <code>{contract.sourceVersion}</code> on Robinhood Chain.
      A new module using this source version keeps the same launch interface. A new source version requires
      its published adapter and deployment binding.</p>
    <p className={styles.bodyCopy}><a href={contract.markdown}>Complete indexing reference</a>
      {" · "}<a href="https://programmable.market/api/module-mode/indexer/v1">JSON contract and ABI</a></p>
    <section id="discovery">
      <h2>Discovery</h2>
      <p className={styles.bodyCopy}>Read the <a href="https://programmable.market/api/module-mode/indexer/v1">indexer contract</a> for the
        ABI, event topics and record fields. Read <a href={contract.release.url}>Module Mode availability</a>
        {" "}for the current <code>release</code>. Require the supported schema, chain, source version and an active,
        enabled release.</p>
      <p className={styles.bodyCopy}>Use the launcher address, runtime hash, dependencies and start block from that
        release. Retain its digest and source commit with the checkpoint. Historical releases keep their own
        bindings when a new release becomes available.</p>
    </section>
    <section id="verify">
      <h2>Verify a launch</h2>
      <ol className={styles.steps}>
        <li>Verify chain 4663 and the launcher&apos;s deployed runtime. Scan <code>ModuleNativeLaunched</code>
          {" "}from that launcher in complete, bounded block ranges.</li>
        <li>Check the successful receipt and event coordinates. At the same canonical block, compare the event
          with <code>getLaunch(token)</code> and <code>getLaunchIdentity(token)</code>.
          Require <code>launchIdentityVersion()</code> to return 1.</li>
        <li>Verify the matching program, configuration and token identity events. Bind the pool, runtime,
          module revisions, instances and code hashes using the source version&apos;s verifier.</li>
        <li>Establish the L2 block&apos;s batch membership and finalized Ethereum posting under
          {" "}<code>{contract.release.finalityPolicy}</code>. A sequencer receipt is insufficient.</li>
        <li>Commit the records and checkpoint together after the full range passes. Recheck saved block hashes
          on restart and rescan from the last matching checkpoint after a reorganization.</li>
      </ol>
      <p className={styles.bodyCopy}>The <a href={contract.markdown}>complete reference</a> specifies provider
        agreement, commitments, retry handling and integration checks. A consistency check over supplied JSON
        still requires the collector to authenticate the underlying chain evidence.</p>
    </section>
    <section id="identity">
      <h2>Record identity</h2>
      <dl className={`${styles.dataList} ${styles.technicalData}`}>
        {(["token", "pool", "launch", "event"] as const).map(key => <div key={key}>
          <dt>{key === "token" ? "Coin" : key.charAt(0).toUpperCase() + key.slice(1)}</dt>
          <dd><code>{contract.identities[key].join(" + ")}</code></dd>
        </div>)}
      </dl>
      <p className={styles.bodyCopy}>The creator is the verified <code>launchWallet</code>. A relayer,
        module author or fee recipient does not replace that identity.</p>
      <p className={styles.bodyCopy}>Native records use <code>sourceKind: module-native-v1</code>, with
        {" "}<code>routerAddress</code> and <code>stampHash</code> set to <code>null</code>.
        Custom Launches use the separate <Link href="/developer-reference/robinhood-terminal-indexer">Custom
        terminal integration</Link>. Both sources can share a token index using the keys above.</p>
    </section>
    <section id="modules">
      <h2>Module configuration</h2>
      <p className={styles.bodyCopy}>Store package and family IDs as opaque identifiers. Preserve selected
        revisions, configuration bytes, instances and commitments in their recorded order. Empty selections
        are valid. A module name or category is never a condition for recognizing a launch.</p>
      <p className={styles.bodyCopy}>Display names, icons and controls are optional metadata. An unfamiliar module
        or unavailable trading adapter does not remove a verified coin. Read revision evidence at the launch
        block; disabling a module for new launches does not erase existing coins.</p>
    </section>
    <section id="reads">
      <h2>Public reads</h2>
      <p className={styles.bodyCopy}>The <a href={contract.reads.websiteList.url}>Explore API</a> returns website
        records with status, timestamp and pagination. It applies presentation filters. Use contract event
        scanning for a complete independent archive.</p>
      <p className={styles.bodyCopy}>For creator records, read <code>/api/profile/robinhood?account=&#123;launchWallet&#125;</code>
        {" "}and traverse all pages. Preserve previously verified rows during a temporary outage and report
        freshness separately from identity and market support.</p>
    </section>
  </DocsShell>;
}
