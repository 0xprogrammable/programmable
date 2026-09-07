import type { Metadata } from "next";
import Link from "next/link";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "V4 token · Programmable",
  description: "The Programmable token on Robinhood Chain, liquidity fees and burn accounting.",
  alternates: { canonical: "/docs/v4-token" },
};

const sections = [
  { id: "token", label: "Token identity" },
  { id: "liquidity", label: "Liquidity fees" },
  { id: "allocation", label: "Revenue allocation" },
  { id: "burns", label: "Burn accounting" },
] as const;

export default function V4TokenDocsPage() {
  return (
    <DocsShell currentPath="/docs/v4-token" title="V4 token" sections={sections}
      description="V4 is the Programmable token on Robinhood Chain. Its contract address identifies the token independently of a name or ticker.">
      <section id="token">
        <h2>Token identity</h2>
        <p>Programmable (V4) uses Robinhood Chain Mainnet, chain ID 4663. Its fixed supply is one billion V4 with 18 decimals and no later mint function.</p>
        <p>The contract is <a href="https://robinhoodchain.blockscout.com/token/0xC60bA256B44334A0Cd2C7242E98B88f031abB006"><code>0xC60bA256B44334A0Cd2C7242E98B88f031abB006</code></a>. Historical Ethereum tokens have different addresses and balances.</p>
      </section>
      <section id="liquidity">
        <h2>Liquidity fees</h2>
        <p>The canonical V4/ETH pool uses a 1% LP fee after its initial 30-second launch period. Active liquidity providers earn their proportional share in the input asset: ETH on buys and V4 on sells. Ordinary token transfers do not pay this pool fee.</p>
        <p>The main position, NFT 1708785, is held by the <a href="https://robinhoodchain.blockscout.com/address/0x9f9424BbCCe8a865f70155fe40Fb22A103eBEc63">PositionFeesForwarder locker</a>, with its withdrawal lock set to the maximum uint256 block number. Collecting fees leaves the position locked and forwards proceeds to the fixed fee recipient.</p>
      </section>
      <section id="allocation">
        <h2>Revenue allocation</h2>
        <p>The published protocol allocation assigns 50% of net protocol revenue to V4 buybacks and burns and 50% to the treasury, with daily processing. Creator and module author rewards are separate liabilities. V4 collected from the project&apos;s LP fees is also allocated to daily burns.</p>
        <p>Read <Link href="/docs/economics">Fees and revenue</Link> for the rates and contract versions. An allocation policy and an executed claim, purchase or burn are different records. Use <a href="https://dune.com/programmablehq/analytics">Dune</a> to inspect observed execution.</p>
      </section>
      <section id="burns">
        <h2>Burn accounting</h2>
        <p>Burns transfer V4 to <code>0x000000000000000000000000000000000000dEaD</code>, removing it from circulation. This token has no supply-reducing burn function, so the transfers do not reduce <code>totalSupply</code>. Report the burn-address balance separately.</p>
        <p>More qualifying volume can generate more fees and tokens available to burn. The amount depends on trading direction and the position&apos;s liquidity share. Holding V4 creates no equity or claim on protocol revenue, and buybacks or burns do not guarantee a price or return.</p>
      </section>
    </DocsShell>
  );
}
