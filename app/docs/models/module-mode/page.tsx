import type { Metadata } from "next";
import Link from "next/link";
import { DocsShell } from "@/components/docs-shell";
import styles from "@/components/developer-docs.module.css";

export const metadata: Metadata = {
  title: "Module Mode · Programmable Docs",
  description: "Launch a coin with a bonding curve and optional, configurable modules.",
  alternates: { canonical: "/docs/models/module-mode" },
};
const sections = [
  { id: "launch", label: "Launch a coin" },
  { id: "configuration", label: "Configuration" },
  { id: "management", label: "Management" },
  { id: "developers", label: "Developers" },
] as const;

export default function ModuleModeOverviewPage() {
  return <DocsShell currentPath="/docs/models/module-mode" title="Module Mode" kicker="Launch models"
    parentHref="/docs/tokens" parentLabel="Launch models" sections={sections}
    description="Create a coin with a bonding curve. Launch with the base settings or add modules that change its behavior.">
    <section id="launch">
      <h2>Launch a coin</h2>
      <ol className={styles.steps}>
        <li>Open <Link href="/launch/modules">Module Mode</Link> and connect your wallet.</li>
        <li>Enter the coin details, creator fees and initial buy.</li>
        <li>Open <strong>Modules</strong> to find optional modules and complete their configuration.</li>
        <li>Review the coin, total fees, funding and wallet transaction, then confirm the launch.</li>
      </ol>
      <p className={styles.bodyCopy}>The active release determines the network, engine and supported configuration.
        Gas, the initial buy and any module funding are separate amounts in the launch review.</p>
    </section>
    <section id="configuration">
      <h2>Configuration and compatibility</h2>
      <p className={styles.bodyCopy}>A module declares its fields, types, units, allowed values and required
        capabilities. The website uses those declarations to build the form and check compatibility.
        Conflicting configurations or combinations outside the host&apos;s limits are rejected before launch.</p>
      <p className={styles.bodyCopy}>Modules can have state, operating budgets and management actions. A new
        capability or market engine requires a reviewed extension before it becomes available. The catalog
        comes from the service and grows independently of this guide.</p>
      <p className={styles.bodyCopy}>The native ETH engine charges an additional 0.20% protocol fee. With eligible
        module families, half is shared equally among those families. Without eligible families, the protocol
        receives the full fee. Creator fees and module operating budgets are accounted for separately.</p>
    </section>
    <section id="management">
      <h2>Manage a launched coin</h2>
      <p className={styles.bodyCopy}>After indexing, the coin appears in Explore and the launching wallet&apos;s
        profile. Its controls show supported reads and actions. Transaction actions require the wallet role
        specified by the deployed contracts.</p>
      <p className={styles.bodyCopy}>Each launch records its module revisions and configuration. Publishing
        another revision does not replace existing coins. Later state changes follow the deployed permissions.</p>
    </section>
    <section id="developers">
      <h2>Build and integrate</h2>
      <p className={styles.bodyCopy}>Submit reusable modules through the API with their source, configuration,
        management interface, author wallet and reward wallet. Read <Link href="/developer-reference/module-mode">Build
        a module</Link> for the package and review workflow.</p>
      <p className={styles.bodyCopy}>Indexers recognize the launch source independently of module names.
        Read <Link href="/developer-reference/module-mode-indexing">Index Module Mode launches</Link> for the
        ABI, canonical identity and finality procedure.</p>
    </section>
  </DocsShell>;
}
