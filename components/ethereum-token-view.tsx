import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { RobinhoodCoinArtwork } from "@/components/robinhood-coin-artwork";
import { RobinhoodProjectLinks } from "@/components/robinhood-project-links";
import { coinTicker } from "@/lib/robinhood-presentation";
import type { CanonicalTokenExploreEntry } from "@/lib/tokens";
import styles from "./robinhood-token-view.module.css";

export function EthereumTokenView({ address, token, status, updatedAt }: {
  address: string;
  token: CanonicalTokenExploreEntry | null;
  status: "ready" | "stale" | "partial" | "unavailable";
  updatedAt: string | null;
}) {
  const links = token?.links?.map(link => ({ label: link.kind, url: link.url })) ?? [];
  return <div className={`${styles.page} page-width`}>
    <Link className={styles.back} href="/explore/ethereum"><ArrowLeft aria-hidden="true" size={16} />Back to Explore</Link>
    {token ? <article className={styles.market}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <RobinhoodCoinArtwork className={styles.avatar} imageUrl={token.imageUrl} eager />
          <div className={styles.identityText}>
            <div className={styles.nameRow}><h1>{token.name || "Unnamed token"}</h1>
              {links.length ? <RobinhoodProjectLinks links={links} name={token.name || "Token"} /> : null}
            </div>
            <p className={styles.subtitle}><span>{coinTicker(token.symbol)}</span><span>Ethereum</span></p>
            {token.description ? <p className={styles.bio}>{token.description}</p> : null}
          </div>
        </div>
        <a className={styles.secondaryButton} href={`https://etherscan.io/token/${address}`} target="_blank" rel="noreferrer">
          Explorer <ArrowUpRight aria-hidden="true" size={16} /><span className="sr-only"> (opens in a new tab)</span>
        </a>
      </header>
      <section className={styles.launchContext} aria-label="Programmable launch">
        <div><p className={styles.origin}>Programmable · {token.launchCategoryProvenance.category === "classic" ? "Classic" : "Custom"}</p>
          <p className={styles.launchDetails}>
            <span>Launched <time dateTime={token.launchedAt}>{new Date(token.launchedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</time></span>
            {token.launchBlockNumber ? <span>Block {token.launchBlockNumber}</span> : null}
            {token.launchTransactionHash ? <a href={`https://etherscan.io/tx/${token.launchTransactionHash}`} target="_blank" rel="noreferrer">Launch transaction<span className="sr-only"> (opens in a new tab)</span></a> : null}
            {token.creatorAddress ? <a href={`https://etherscan.io/address/${token.creatorAddress}`} target="_blank" rel="noreferrer">Creator wallet<span className="sr-only"> (opens in a new tab)</span></a> : null}
          </p>
        </div>
      </section>
      {status !== "ready" ? <p className={styles.notice} role="status">{status === "partial" ? "This token is verified. Some Ethereum launches are temporarily unavailable." : "Showing this token from the last verified index."}
        {updatedAt ? <> Updated <time dateTime={updatedAt} title={new Date(updatedAt).toUTCString()}>{new Date(updatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC</time>.</> : null}
      </p> : null}
      <p className={styles.notice}>Live market data and trading are not available on this page.</p>
    </article> : <section className={styles.empty}>
      <h1>{status === "ready" ? "Launch not found" : "Token details are temporarily unavailable"}</h1>
      <p>{status === "ready" ? "This address is not in the verified Ethereum launch index." : "The Ethereum launch index could not confirm this address. Try again shortly."}</p>
      <a href={`https://etherscan.io/token/${address}`} target="_blank" rel="noreferrer">View address on Etherscan<ArrowUpRight aria-hidden="true" size={16} /><span className="sr-only"> (opens in a new tab)</span></a>
    </section>}
  </div>;
}
