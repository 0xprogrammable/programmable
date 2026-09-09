"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProfileProjectsSection, ProfileProjectsSkeleton } from "@/components/profile-projects";
import { AnimatedMarketCap } from "@/components/animated-market-cap";
import { MODULE_TOKEN_FALLBACK_IMAGE, RobinhoodCoinArtwork } from "@/components/robinhood-coin-artwork";
import { useLiveDataRefresh } from "@/components/use-live-data-refresh";
import { useRobinhoodPresentation } from "@/components/use-robinhood-presentation";
import { readRobinhoodProfileResponse } from "@/lib/profile/robinhood-profile";
import { isRobinhoodModuleLaunch, ROBINHOOD_PROFILE_PAGE_SIZE, type RobinhoodProfileLaunchList } from "@/lib/robinhood-launches";
import { coinAge, coinTicker } from "@/lib/robinhood-presentation";
import styles from "./robinhood-profile-launches.module.css";

const snapshots = new Map<string, { data: RobinhoodProfileLaunchList; savedAt: number }>();
const cacheKey = (account: string, page: number) => `4663:${account.toLowerCase()}:${page}`;
function remembered(account: string) {
  if (typeof window === "undefined") return null;
  const saved = snapshots.get(cacheKey(account, 1));
  return saved && Date.now() - saved.savedAt < 300_000 ? saved.data : null;
}

export function RobinhoodProfileLaunches({ account }: { account: string }) {
  return <RobinhoodAccountLaunches key={account.toLowerCase()} account={account.toLowerCase()} />;
}

function RobinhoodAccountLaunches({ account }: { account: string }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(() => remembered(account));
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(Date.now);
  const refresh = useLiveDataRefresh({ intervalMs: 30_000 });
  const scoped = data?.account === account.toLowerCase() ? data : null;
  const items = scoped?.items ?? [];
  const shownPage = scoped?.page.number ?? page;
  const presentationQuery = new URLSearchParams({ account: account.toLowerCase(), page: String(shownPage), pageSize: String(ROBINHOOD_PROFILE_PAGE_SIZE) }).toString();
  const presentation = useRobinhoodPresentation(presentationQuery, items.length > 0);
  const details = new Map(presentation.items.map((item) => [item.tokenAddress.toLowerCase(), item]));
  const notice = failed
    ? items.length > 0
      ? page !== shownPage ? `Couldn’t load page ${page}. Showing page ${shownPage}.` : "Couldn’t refresh launches."
      : "Couldn’t load launches."
    : scoped?.status === "stale" ? "Launch data may be out of date. Refresh to check again."
    : scoped?.status === "syncing" && items.length > 0 ? "Checking for more launches…" : "";

  function requestPage(nextPage: number) {
    setLoading(true);
    setFailed(false);
    setPage(nextPage);
    setRetry((value) => value + 1);
  }

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    queueMicrotask(() => { if (!controller.signal.aborted) { setLoading(true); setFailed(false); } });
    const query = new URLSearchParams({ account: account.toLowerCase(), page: String(page), pageSize: String(ROBINHOOD_PROFILE_PAGE_SIZE) });
    void fetch(`/api/profile/robinhood?${query}`, { signal: controller.signal, headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("Profile unavailable");
        return readRobinhoodProfileResponse(await response.json(), account);
      })
      .then((next) => {
        if (controller.signal.aborted) return;
        if (next.status === "unavailable") throw new Error("Profile unavailable");
        setData(next);
        setPage(next.page.number);
        setFailed(false);
        setNow(Date.now());
        const key = cacheKey(account, next.page.number);
        snapshots.delete(key);
        snapshots.set(key, { data: next, savedAt: Date.now() });
        while (snapshots.size > 8) snapshots.delete(snapshots.keys().next().value!);
      })
      .catch(() => { if (!disposed) setFailed(true); })
      .finally(() => { window.clearTimeout(timeout); if (!disposed) setLoading(false); });
    return () => { disposed = true; window.clearTimeout(timeout); controller.abort(); };
  }, [account, page, refresh, retry]);

  return <ProfileProjectsSection
    refreshInProgress={loading}
    onRefresh={() => requestPage(shownPage)}
    currentPage={shownPage}
    totalPages={scoped?.page.totalPages ?? 1}
    totalItems={scoped?.page.totalItems}
    onPageChange={requestPage}
    pageChangePending={loading}
    statusMessage={loading ? page !== shownPage ? `Loading launches page ${page}` : "Refreshing launches" : notice}
  >
    {items.length > 0 && notice ? <p className={styles.notice}>{notice}</p> : null}
    {items.length ? <ul className={styles.list} aria-busy={loading}>
      {items.map((launch) => {
        const detail = details.get(launch.tokenAddress.toLowerCase());
        return <li key={launch.launchId}>
          <Link className={styles.row} href={`/token/${launch.tokenAddress}`} prefetch={false}>
            <RobinhoodCoinArtwork className={styles.artwork} imageUrl={detail?.imageUrl} loading={presentation.loading && !detail}
              fallbackImageUrl={isRobinhoodModuleLaunch(launch) ? MODULE_TOKEN_FALLBACK_IMAGE : undefined} />
            <span className={styles.identity}><strong>{launch.name?.trim() || (launch.launchProjection ? "Unnamed contract" : "Unnamed token")}</strong><small>{coinTicker(launch.symbol)}</small><small>{isRobinhoodModuleLaunch(launch) ? "Module" : "Custom"}</small></span>
            <span className={styles.metrics}>
              {detail?.market?.marketCapUsd != null ? <><small>Market cap</small><AnimatedMarketCap metric={{ kind: "usd", value: detail.market.marketCapUsd }} replayKey={`profile:4663:${launch.tokenAddress.toLowerCase()}`} /></> : null}
              {launch.launchedAt ? <time dateTime={launch.launchedAt}>{coinAge(launch.launchedAt, now)}</time> : null}
            </span>
          </Link>
        </li>;
      })}
    </ul> : loading && !scoped ? <ProfileProjectsSkeleton />
      : failed || scoped?.status === "stale" ? <div className={styles.empty}><p>Couldn’t load launches.</p><button type="button" onClick={() => requestPage(shownPage)}>Try again</button></div>
      : <div className={styles.empty}><p>{scoped?.status === "syncing" ? "Checking launches…" : "No launches yet."}</p><Link href="/launch">Launch a token</Link></div>}
  </ProfileProjectsSection>;
}
