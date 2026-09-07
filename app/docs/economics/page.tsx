import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";

import { DocsExternalLink } from "@/components/docs-external-link";
import docsStyles from "@/components/docs-experience.module.css";
import styles from "@/components/docs-hub.module.css";
import {
  formatBps,
  PROGRAMMABLE_FEE_TABLE,
  PROGRAMMABLE_PUBLIC_REPOSITORIES,
  PROGRAMMABLE_REVENUE_TARGET,
} from "@/components/docs-public-policy";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Economics · Programmable",
  description:
    "Understand Programmable fees, creator shares, template shares and protocol revenue allocation.",
  alternates: { canonical: "/docs/economics" },
};

const sections = [
  { id: "basis", label: "How to read the fees" },
  { id: "launch-fees", label: "Launch fee policies" },
  { id: "creator", label: "Creator earnings" },
  { id: "revenue", label: "Protocol revenue" },
  { id: "boundaries", label: "Boundaries" },
] as const;

const feeRows = [
  {
    path: "Classic",
    total: PROGRAMMABLE_FEE_TABLE.classic.total,
    split: `${formatBps(PROGRAMMABLE_FEE_TABLE.classic.programmableBps)} to Programmable. The remainder becomes creator rewards.`,
    treatment: PROGRAMMABLE_FEE_TABLE.classic.chargeMode,
  },
  {
    path: "Ethereum Custom (fee-certified)",
    total: formatBps(PROGRAMMABLE_FEE_TABLE.standardCustom.totalBps),
    split: `${formatBps(PROGRAMMABLE_FEE_TABLE.standardCustom.programmableBps)} to Programmable. Project economics are defined by the release.`,
    treatment: PROGRAMMABLE_FEE_TABLE.standardCustom.chargeMode,
  },
  {
    path: "Robinhood Custom (Native20)",
    total: `${formatBps(PROGRAMMABLE_FEE_TABLE.robinhoodCustom.programmableBps)} platform fee`,
    split: "The full platform fee belongs to Programmable. Creator fees are defined separately by the project.",
    treatment: PROGRAMMABLE_FEE_TABLE.robinhoodCustom.chargeMode,
  },
  {
    path: "Public template",
    total: formatBps(PROGRAMMABLE_FEE_TABLE.publicTemplate.totalBps),
    split: `${formatBps(PROGRAMMABLE_FEE_TABLE.publicTemplate.creatorBps)} to the template creator and ${formatBps(PROGRAMMABLE_FEE_TABLE.publicTemplate.programmableBps)} to Programmable.`,
    treatment: PROGRAMMABLE_FEE_TABLE.publicTemplate.chargeMode,
  },
] as const;

export default function EconomicsDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/economics"
      description="One place for launch fees, creator shares and the way Programmable allocates protocol revenue."
      sections={sections}
      title="Economics"
    >
      <section id="basis">
        <h2>How to read the fees</h2>
        <p>
          One basis point is 0.01%. A fee of 10 bps is 0.10% of the stated
          basis. The basis and charge treatment matter as much as the number.
        </p>
        <p>
          Classic includes the Programmable share inside the fee selected for
          that launch. Ethereum Custom uses a separate 10 bps policy on a
          fee-certified market path. Robinhood Custom with Native20 charges
          20 bps (0.20%) of the gross native ETH amount per successful buy or
          sell, rounded up to the next wei. Creator and pool fees are additional.
          Template fees are a different product
          path and are not stacked with another unnamed template charge.
        </p>
      </section>

      <section id="launch-fees">
        <h2>Launch fee policies</h2>
        <p>
          Each row describes one fee path. The exact release, contract and
          template version determine which path applies to a launch.
        </p>

        <div
          aria-label="Programmable launch fee policies"
          className={styles.tableWrap}
          role="region"
          tabIndex={0}
        >
          <table className={`${styles.comparisonTable} ${styles.policyTable}`}>
            <thead>
              <tr>
                <th scope="col">Path</th>
                <th scope="col">Total or selected fee</th>
                <th scope="col">Split</th>
                <th scope="col">Treatment</th>
              </tr>
            </thead>
            <tbody>
              {feeRows.map((row) => (
                <tr key={row.path}>
                  <th scope="row">{row.path}</th>
                  <td data-label="Total or selected fee">{row.total}</td>
                  <td data-label="Split">{row.split}</td>
                  <td data-label="Treatment">{row.treatment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={docsStyles.callout}>
          <strong>Each path is bound to its exact release.</strong>
          <p>
            The policy describes the split; the matching release and public
            record determine whether a particular launch, template or recipient
            can use it. Public template intake is not active. This policy page
            is not an execution receipt.
          </p>
        </div>
      </section>

      <section id="creator">
        <h2>Creator earnings</h2>
        <p>
          Classic creator rewards are the selected swap fee minus the 10 bps
          Programmable share. Robinhood Custom creator rewards accrue separately
          from the 20 bps platform fee at the project&apos;s configured buy or sell rate.
          Public template creators receive 10 bps from
          official launches that use their exact template version once that
          separately documented payout path is active.
        </p>
        <p>
          Earnings depend on actual qualifying activity. API preparation,
          listing or template publication does not promise trading volume or a
          fixed payment.
        </p>
        <p className={styles.inlineAction}>
          <Link href="/docs/creators/earnings">Read the creator guide</Link>
        </p>
      </section>

      <section id="revenue">
        <h2>Protocol revenue</h2>
        <p>
          The <a href="https://dune.com/programmablehq/analytics">Dune dashboard</a>{" "}
          reports finalized Custom Launch stamps, creator rewards in ETH and
          Programmable protocol revenue in ETH. Fee totals include credited,
          unclaimed balances from supported native fee events. Gas, liquidity,
          LP fees and withdrawals are excluded. Historical fee models without
          those events are outside the ETH totals.
        </p>
        <p>
          The published protocol allocation assigns 80% of attributable net
          protocol revenue to V4 buybacks and 20% to the treasury. V4 purchases
          go to the protocol revenue wallet. They are not burns.
        </p>

        <div
          aria-label="Protocol revenue allocation"
          className={styles.splitBar}
          style={
            {
              "--split-first": `${PROGRAMMABLE_REVENUE_TARGET.buybackBps}fr`,
              "--split-second": `${PROGRAMMABLE_REVENUE_TARGET.treasuryBps}fr`,
            } as CSSProperties
          }
        >
          <span>80% V4 buybacks</span>
          <span>20% treasury</span>
        </div>

        <p>
          The exact processor and activation record determine when this
          allocation is used; the current deployment record may bind a different
          processor until this policy is activated. No separate keeper share is
          described by this policy.
        </p>

        <p className={styles.inlineAction}>
          <Link href="/docs/v4-token">Read about V4 and revenue cycles</Link>
        </p>
      </section>

      <section id="boundaries">
        <h2>Boundaries</h2>
        <ul className={docsStyles.contentList}>
          <li>
            Attributable net revenue means the amount that belongs to
            Programmable after creator and partner liabilities are separated.
          </li>
          <li>
            Revenue processing applies only to verified supported sources. A new
            fee source requires its own activated source profile.
          </li>
          <li>
            Eligible revenue is evaluated in cycles with a minimum interval of
            24 hours. Thresholds, finality, provider health or safety gates can
            delay execution.
          </li>
          <li>
            Fee and revenue documentation does not promise token value, volume,
            holder yield or future purchases.
          </li>
        </ul>

        <p>
          Technical integrators should use the versioned machine contracts in
          the developer repository rather than parsing this page.
        </p>
        <DocsExternalLink
          href={PROGRAMMABLE_PUBLIC_REPOSITORIES.developers}
          variant="chip"
        >
          Developer contracts
        </DocsExternalLink>
      </section>
    </DocsShell>
  );
}
