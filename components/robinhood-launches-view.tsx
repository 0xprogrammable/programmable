"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { ExploreChainSelector } from "@/components/explore-chain-selector";
import { ExploreFilters } from "@/components/explore-filters";
import { AnimatedMarketCap } from "@/components/animated-market-cap";
import { ExploreIndexResetView } from "@/components/explore-index-reset-view";
import { useViewChain, type ViewChainId } from "@/components/view-chain";
import { MODULE_TOKEN_FALLBACK_IMAGE, RobinhoodCoinArtwork } from "@/components/robinhood-coin-artwork";
import { RobinhoodProjectLinks } from "@/components/robinhood-project-links";
import { rememberRobinhoodTokenPresentations } from "@/components/robinhood-presentation-cache";
import { coinAge, coinTicker, mergeRobinhoodPresentations, type RobinhoodCoinPresentation } from "@/lib/robinhood-presentation";
import { activeExploreFilterCount, DEFAULT_EXPLORE_FILTERS, ROBINHOOD_EXPLORE_PAGE_SIZE, sameRobinhoodExploreRequest, type RobinhoodExploreFilters, type RobinhoodExploreRequest } from "@/lib/robinhood-explore-filters";
import { isRobinhoodModuleLaunch } from "@/lib/robinhood-launches";
import { isPinnedRobinhoodToken } from "@/lib/robinhood-explore-policy";
import styles from "@/components/robinhood-launches-view.module.css";

type Launch = {
  launchId: string;
  tokenAddress: string;
  hookAddress: string;
  creator: string;
  transactionHash: string;
  blockNumber: string;
  launchedAt: string | null;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
};

type LaunchResponse = {
  chainId: 4663;
  status: "ready" | "syncing" | "stale" | "unavailable";
  updatedAt: string | null;
  items: Launch[];
  presentations: RobinhoodCoinPresentation[];
  page: {
    number: number;
    size: number;
    totalItems: number;
    totalPages: number;
    hasMore: boolean;
  };
};

type Request = RobinhoodExploreRequest;
type Snapshot = { request: Request; data: LaunchResponse };

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const REFRESH_MS = 30_000;
const REQUEST_TIMEOUT_MS = 15_000;

// Public, browser-only navigation state. Nothing is written during server rendering.
let rememberedSnapshot: { value: Snapshot; savedAt: number } | null = null;
function readRememberedSnapshot() {
  if (typeof window === "undefined" || !rememberedSnapshot || Date.now() - rememberedSnapshot.savedAt >= 300_000) return null;
  const value = rememberedSnapshot.value;
  return { ...value, data: { ...value.data,
    presentations: mergeRobinhoodPresentations([], value.data.presentations).items,
  } };
}
function rememberSnapshot(value: Snapshot) {
  if (typeof window !== "undefined") rememberedSnapshot = { value, savedAt: Date.now() };
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDate(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

function isText(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length <= 4_096);
}

function isLaunch(value: unknown): value is Launch {
  if (!isObject(value)) return false;
  return typeof value.launchId === "string" && HASH.test(value.launchId)
    && (value.sourceKind === undefined || isRobinhoodModuleLaunch(value))
    && typeof value.tokenAddress === "string" && ADDRESS.test(value.tokenAddress)
    && ((typeof value.hookAddress === "string" && ADDRESS.test(value.hookAddress)) || (value.sourceKind === "module-engine-v1" && value.hookAddress === null))
    && typeof value.creator === "string" && ADDRESS.test(value.creator)
    && typeof value.transactionHash === "string" && HASH.test(value.transactionHash)
    && typeof value.blockNumber === "string" && /^\d+$/.test(value.blockNumber)
    && isDate(value.launchedAt) && isText(value.name) && isText(value.symbol)
    && (value.decimals === null || (Number.isInteger(value.decimals)
      && Number(value.decimals) >= 0 && Number(value.decimals) <= 255));
}

function readResponse(value: unknown): LaunchResponse {
  if (!isObject(value) || value.chainId !== 4663
    || !["ready", "syncing", "stale", "unavailable"].includes(String(value.status))
    || !isDate(value.updatedAt) || !Array.isArray(value.items)
    || value.items.length > 50 || !value.items.every(isLaunch) || !isObject(value.page)
    || !Array.isArray(value.presentations) || value.presentations.length > 50
    || !value.presentations.every((item) => isObject(item) && typeof item.tokenAddress === "string" && ADDRESS.test(item.tokenAddress))) {
    throw new Error("Invalid launch response");
  }
  const page = value.page;
  if (!Number.isSafeInteger(page.number) || Number(page.number) < 1
    || (page.size !== ROBINHOOD_EXPLORE_PAGE_SIZE && page.size !== 50) || !Number.isSafeInteger(page.totalItems) || Number(page.totalItems) < 0
    || !Number.isSafeInteger(page.totalPages) || Number(page.totalPages) < 0
    || typeof page.hasMore !== "boolean") {
    throw new Error("Invalid launch pagination");
  }
  return value as LaunchResponse;
}

export function RobinhoodLaunchesView({
  embedded = false,
  chainId,
}: Readonly<{ embedded?: boolean; chainId?: ViewChainId }>) {
  const { hydrated, viewChainId, setViewChainId } = useViewChain();

  useEffect(() => {
    if (!hydrated || chainId === undefined) return;
    // The explicit route wins after the shared preference is restored.
    const timer = window.setTimeout(() => setViewChainId(chainId), 0);
    return () => window.clearTimeout(timer);
  }, [chainId, hydrated, setViewChainId]);

  if ((chainId ?? viewChainId) !== 4663) return <ExploreIndexResetView embedded={embedded} />;

  return <RobinhoodLaunchList embedded={embedded} enabled={hydrated} />;
}

function RobinhoodLaunchList({ embedded, enabled }: { embedded: boolean; enabled: boolean }) {
  const headingId = useId();
  const searchId = useId();
  const statusId = useId();
  const listId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [initial] = useState(readRememberedSnapshot);
  const [search, setSearch] = useState(initial?.request.q ?? "");
  const [request, setRequest] = useState<Request>(initial?.request ?? { page: 1, q: "", ...DEFAULT_EXPLORE_FILTERS });
  const [snapshot, setSnapshot] = useState<Snapshot | null>(initial);
  const [loading, setLoading] = useState(true);
  const [failedRequest, setFailedRequest] = useState<Request | null>(null);
  const [now, setNow] = useState(Date.now);
  const presentations = new Map((snapshot?.data.presentations ?? []).map((item) => [item.tokenAddress.toLowerCase(), item]));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const q = search.trim();
      setRequest((current) => current.q === q ? current : { ...current, page: 1, q });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let controller: AbortController | null = null;
    let refreshTimer: number | undefined;
    const isVisible = () => document.visibilityState !== "hidden";

    async function load() {
      if (disposed || controller || !isVisible()) return;
      const activeController = new AbortController();
      controller = activeController;
      const timeout = window.setTimeout(() => activeController.abort(), REQUEST_TIMEOUT_MS);
      setLoading(true);

      try {
        const query = new URLSearchParams({ page: String(request.page), pageSize: String(ROBINHOOD_EXPLORE_PAGE_SIZE),
          q: request.q, sort: request.sort, mode: request.mode ?? "all" });
        const response = await fetch(`/api/explore/robinhood?${query}`, {
          signal: activeController.signal,
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error("Launch request failed");
        const data = readResponse(await response.json());
        if (disposed || activeController.signal.aborted) return;
        setSnapshot((current) => {
          const sameRequest = sameRobinhoodExploreRequest(current?.request, request);
          if (sameRequest && current && current.data.items.length > 0
            && data.items.length === 0 && data.status !== "ready") {
            return rememberSnapshot({ request, data: { ...current.data, status: data.status,
              presentations: mergeRobinhoodPresentations(current.data.presentations, null).items,
            } });
          }
          const presentations = mergeRobinhoodPresentations(current?.data.presentations ?? [], data.presentations).items;
          rememberRobinhoodTokenPresentations(presentations);
          return rememberSnapshot({ request, data: { ...data,
            presentations,
          } });
        });
        setFailedRequest(null);
        setNow(Date.now());
      } catch {
        if (!disposed && isVisible() && activeController.signal.reason !== "hidden") {
          setFailedRequest(request);
          setSnapshot((current) => current ? rememberSnapshot({ ...current, data: { ...current.data,
            presentations: mergeRobinhoodPresentations(current.data.presentations, null).items,
          } }) : null);
        }
      } finally {
        window.clearTimeout(timeout);
        controller = null;
        if (!disposed) {
          setLoading(false);
          if (isVisible()) refreshTimer = window.setTimeout(load, activeController.signal.reason === "hidden" ? 0 : REFRESH_MS);
        }
      }
    }

    function visibilityChanged() {
      window.clearTimeout(refreshTimer);
      if (!isVisible()) controller?.abort("hidden");
      else void load();
    }

    void load();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      disposed = true;
      controller?.abort();
      window.clearTimeout(refreshTimer);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [enabled, request]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequest((current) => ({ ...current, page: 1, q: search.trim() }));
  }

  function clearSearch() {
    setSearch("");
    setRequest((current) => ({ ...current, page: 1, q: "" }));
    searchRef.current?.focus();
  }

  function applyFilters(filters: RobinhoodExploreFilters) {
    setRequest((current) => current.sort === filters.sort && (current.mode ?? "all") === (filters.mode ?? "all")
      ? current : { ...current, ...filters, page: 1 });
  }

  function changePage(page: number) {
    setRequest((current) => ({ ...current, page }));
  }

  const failed = sameRobinhoodExploreRequest(failedRequest, request);
  const sameRequest = sameRobinhoodExploreRequest(snapshot?.request, request);
  const pending = !sameRequest && !failed;
  const data = sameRequest ? snapshot?.data : undefined;
  const pinned = snapshot?.data.items.find(launch => isPinnedRobinhoodToken(launch.tokenAddress));
  const items = data?.items ?? (pending && pinned ? [pinned] : []);
  const hasRows = items.length > 0;
  const updatingSearch = search.trim() !== request.q;
  const hasFilters = activeExploreFilterCount(request) > 0;
  const slots = pending || (data && data.page.totalPages > 1) ? Math.max(0, ROBINHOOD_EXPLORE_PAGE_SIZE - items.length) : 0;
  const canPrevious = enabled && !pending && !updatingSearch && Boolean(data && data.page.number > 1);
  const canNext = enabled && !pending && !updatingSearch && Boolean(data?.page.hasMore);
  const Heading = embedded ? "h2" : "h1";
  const StateHeading = embedded ? "h3" : "h2";
  const count = data?.page.totalItems ?? 0;
  const statusText = pending || loading ? hasRows ? "Updating launches…" : "Loading launches…" : failed
    ? hasRows ? "Could not refresh. Showing the last loaded results." : "Launches are temporarily unavailable."
    : data?.status === "stale" || data?.status === "unavailable"
      ? hasRows ? "Showing saved launches. Updates are temporarily unavailable." : "Launches are temporarily unavailable."
      : data?.status === "syncing"
        ? "New launches are being checked."
        : updatingSearch ? "Loading launches…" : "";
  const emptyTitle = loading
    ? "Loading Robinhood launches"
    : failed || data?.status === "unavailable" || data?.status === "stale"
      ? "Launches are temporarily unavailable"
      : data?.status === "syncing"
        ? "Checking Robinhood launches"
        : snapshot?.request.q || hasFilters ? "No matching launches" : "No finalized launches yet";

  return (
    <div className={`${styles.page} explore-page page-width`}>
      <header className={styles.heading}>
        <Heading data-explore-heading id={headingId}>Explore</Heading>
      </header>

      <section className={styles.body} aria-labelledby={headingId}>
        <div className={styles.toolbar}>
          <form className={styles.search} role="search" onSubmit={submitSearch}>
            <Search aria-hidden="true" size={18} />
            <label className="sr-only" htmlFor={searchId}>Search Robinhood launches by name, symbol or address</label>
            <input
              id={searchId}
              ref={searchRef}
              name="q"
              type="search"
              autoComplete="off"
              spellCheck={false}
              maxLength={128}
              placeholder="Search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape" && search) { event.preventDefault(); clearSearch(); } }}
              aria-describedby={statusId}
            />
            {search ? (
              <button className={styles.clearSearch} type="button" onClick={clearSearch} aria-label="Clear search">
                <X aria-hidden="true" size={16} />
              </button>
            ) : null}
          </form>
          <ExploreChainSelector chainId={4663} />
          <ExploreFilters value={request} onApply={applyFilters} />
          <nav className={styles.pagination} aria-label="Launch pages">
            <button type="button" aria-disabled={!canPrevious} aria-label="Previous page" title="Previous page" aria-controls={listId}
              onClick={() => { if (canPrevious && data) changePage(data.page.number - 1); }}>
              <ChevronLeft aria-hidden="true" size={18} />
            </button>
            <button type="button" aria-disabled={!canNext} aria-label="Next page" title="Next page" aria-controls={listId}
              onClick={() => { if (canNext && data) changePage(data.page.number + 1); }}>
              <ChevronRight aria-hidden="true" size={18} />
            </button>
          </nav>
        </div>

        <p className="sr-only" id={statusId} role="status">
          {statusText || (data ? `${count} ${count === 1 ? "token" : "tokens"}. Page ${data.page.number} of ${Math.max(1, data.page.totalPages)}.` : null)}
        </p>

        {hasRows || pending ? (
          <ul className={styles.list} id={listId} aria-label="Robinhood token launches" aria-busy={pending || loading}>
            {items.map((launch, index) => {
              const details = presentations.get(launch.tokenAddress.toLowerCase());
              return (
              <li key={launch.tokenAddress.toLowerCase()} className={styles.item}>
                <article className={styles.row}>
                <Link className={styles.cardLink} href={`/token/${launch.tokenAddress}`} prefetch={false}>
                  <RobinhoodCoinArtwork
                    eager={index < 5}
                    imageUrl={details?.imageUrl} loading={loading && !details}
                    fallbackImageUrl={isRobinhoodModuleLaunch(launch) ? MODULE_TOKEN_FALLBACK_IMAGE : undefined}
                    className={styles.artwork}
                  />
                  <div className={styles.identity}>
                    <div className={styles.nameRow}>
                      <strong className={styles.name} title={launch.name?.trim() || "Unnamed token"}>{launch.name?.trim() || "Unnamed token"}</strong>
                    </div>
                    <span className={styles.symbol} title={launch.symbol || undefined}>{coinTicker(launch.symbol)}</span>
                    <span className={styles.mode}>{isRobinhoodModuleLaunch(launch) ? "Module" : "Custom"}</span>
                  </div>
                  <div className={styles.cardFooter}>
                    <div className={styles.marketCap} title={details?.market ? `Observed ${new Date(details.market.observedAt).toUTCString()}` : "Market data is not available yet"}>
                      <span>Market cap</span>
                      {details?.market?.marketCapUsd != null && Number.isFinite(details.market.marketCapUsd) && details.market.marketCapUsd >= 0
                        ? <AnimatedMarketCap metric={{ kind: "usd", value: details.market.marketCapUsd }} replayKey={`4663:${launch.tokenAddress.toLowerCase()}:${details.market.poolId.toLowerCase()}:market-cap`} />
                        : <strong>—</strong>}
                    </div>
                    {launch.launchedAt ? <time className={styles.launched} dateTime={launch.launchedAt} title={`Launched ${new Date(launch.launchedAt).toUTCString()}`}>{coinAge(launch.launchedAt, now)}</time> : null}
                  </div>
                </Link>
                {details?.links.length ? <RobinhoodProjectLinks links={details.links}
                  name={launch.name?.trim() || "Token"} className={styles.socials} /> : null}
                </article>
              </li>
            );})}
            {Array.from({ length: slots }, (_, index) => <li key={`slot-${index}`}
              className={`${styles.item} ${pending ? styles.skeleton : styles.emptySlot}`} aria-hidden="true">
              <div className={styles.row}>
                <div className={`${styles.artwork} ${styles.skeletonArtwork}`} />
                <div className={styles.identity}>
                  <span className={`${styles.skeletonLine} ${styles.skeletonName}`} />
                  <span className={`${styles.skeletonLine} ${styles.skeletonSymbol}`} />
                  <span className={`${styles.skeletonLine} ${styles.skeletonMode}`} />
                </div>
                <div className={styles.cardFooter}><div className={styles.marketCap}>
                  <span className={`${styles.skeletonLine} ${styles.skeletonCaption}`} />
                  <span className={`${styles.skeletonLine} ${styles.skeletonNumber}`} />
                </div><span className={`${styles.skeletonLine} ${styles.skeletonAge}`} /></div>
              </div>
            </li>)}
          </ul>
        ) : (
          <div className={styles.empty} id={listId} aria-busy={loading}>
            <StateHeading>{emptyTitle}</StateHeading>
            <p>{loading || data?.status === "syncing" ? "Verified launches will appear here." : failed || data?.status === "unavailable" || data?.status === "stale" ? "Updates will resume automatically." : snapshot?.request.q || hasFilters ? "Try another search or change the filters." : "New Robinhood launches appear after verification."}</p>
            {!loading && snapshot?.request.q ? <button className={styles.textButton} type="button" onClick={clearSearch}>Clear search</button> : null}
            {!loading && hasFilters ? <button className={styles.textButton} type="button" onClick={() => applyFilters(DEFAULT_EXPLORE_FILTERS)}>Clear filters</button> : null}
            {!loading && failed ? <button className={styles.textButton} type="button" onClick={() => {
              setFailedRequest(null); setRequest(current => ({ ...current }));
            }}>Try again</button> : null}
          </div>
        )}
      </section>
    </div>
  );
}
