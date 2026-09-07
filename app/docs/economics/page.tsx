import type { Metadata } from "next";
import Link from "next/link";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Fees and revenue · Programmable",
  description: "Creator and module rewards, platform fees and revenue allocation.",
  alternates: { canonical: "/docs/economics" },
};

const sections = [
  { id: "basis", label: "Fee units" },
  { id: "custom", label: "Custom Launches" },
  { id: "modules", label: "Module Mode" },
  { id: "revenue", label: "Revenue allocation" },
  { id: "analytics", label: "Analytics" },
] as const;

export default function EconomicsDocsPage() {
  return (
    <DocsShell currentPath="/docs/economics" title="Fees and revenue" sections={sections}
      description="Trading fees, recipient shares and protocol revenue are recorded separately for each launch model.">
      <section id="basis">
        <h2>Fee units</h2>
        <p>One basis point is 0.01%; 20 bps is 0.20%. Gas, initial purchases, liquidity deposits and module operating budgets are separate costs. The launch review shows the selected fees and funding before wallet confirmation.</p>
      </section>
      <section id="custom">
        <h2>Robinhood Custom Launches</h2>
        <p>Native20 charges the full 20 bps (0.20%) of gross native ETH per successful buy or sell for Programmable, rounded up to the next wei. Creator fees and Uniswap pool fees are additional. A 1 ETH gross trade accrues 0.002 ETH for Programmable.</p>
        <p>PoolManager native claims accrue to the fixed platform recipient <code>0xD88539d3c4C460136a733A3Fd60cf6BF269079da</code>. Anyone may trigger a claim, but its payment goes only to that recipient. Creator rewards use a separate balance; a creator fee of zero earns no creator rewards.</p>
        <p>The supported separate-contract and shared token/hook Native20 paths use this fee model. Ethereum Custom retains its own fee-certified 10 bps policy, and Ethereum Classic includes its 10 bps share in the selected transaction fee. Historical deployments keep their own contracts.</p>
      </section>
      <section id="modules">
        <h2>Module Mode</h2>
        <p>Coin creators choose a fee up to 10% under the active engine. It belongs to the coin creator. The Module Mode allocation policy adds 10 bps for Programmable and 20 bps in total for the authors of eligible modules used by the coin. The author allocation is shared among eligible module families, not charged once per module.</p>
        <p>Fee contracts are versioned. The deployed <code>module-native-v1</code> engine charges 20 bps in total, split 10/10 between Programmable and eligible module families. Without eligible families, the protocol receives the full 20 bps. The 10/20 policy requires a new engine release and does not change existing coins. Read the <a href="https://programmable.market/api/module-mode">active engine</a> and launch review for the applicable rate.</p>
      </section>
      <section id="revenue">
        <h2>Protocol revenue allocation</h2>
        <p>The revenue policy assigns 50% of net protocol revenue to V4 buybacks and burns and 50% to the treasury, with daily processing. Net revenue excludes creator, module author and other third-party liabilities. For Native20, the buyback allocation is equivalent to 10 bps of the qualifying trading amount; for a 10 bps Module platform share it is equivalent to 5 bps.</p>
        <p>Collected V4 from the project&apos;s main-token LP fees is also assigned to daily burns. Finalized transactions establish what was processed. A policy, an accrued balance and a completed burn must not be counted as the same event. Read <Link href="/docs/v4-token">V4 token</Link> for token identity and burn accounting.</p>
      </section>
      <section id="analytics">
        <h2>Analytics</h2>
        <p>The <a href="https://dune.com/programmablehq/analytics">Dune dashboard</a> refreshes every 24 hours and separates launch counts, creator rewards, protocol revenue and burns. Custom fees are counted when <code>NativeFeesAccrued</code> credits the recipient, including unclaimed balances. Claiming later does not create new revenue. Gas, liquidity deposits and LP fees are excluded from those Custom totals.</p>
      </section>
    </DocsShell>
  );
}
