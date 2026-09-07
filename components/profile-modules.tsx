"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeftRight, ChevronLeft, ChevronRight, Coins, FlaskConical, Gift, Link2, Percent, Puzzle, RefreshCw, Shield, Waves } from "lucide-react";
import { ModuleDetailDialog } from "@/components/module-detail-dialog";
import { useLiveDataRefresh } from "@/components/use-live-data-refresh";
import { MODULE_CATEGORIES } from "@/lib/module-mode/library";
import type { ModulePublicDetails } from "@/lib/module-mode/public-details";
import { readModuleAuthorProfileResponse, type ModuleAuthorProfile } from "@/lib/profile/module-author-profile";
import styles from "./profile-modules.module.css";

const categoryIcons = { rewards: Gift, trading: ArrowLeftRight, fees: Percent, liquidity: Waves, pairs: Link2, supply: Coins, access: Shield, experiments: FlaskConical };

export function ProfileModuleCards({ items, onSelect }: { items: readonly ModulePublicDetails[]; onSelect: (item: ModulePublicDetails) => void }) {
  return <ul className={styles.list}>
    {items.map(item => {
      const category = MODULE_CATEGORIES.find(candidate => candidate.id === item.category.split("/")[0]);
      const Icon = category ? categoryIcons[category.id] : Puzzle;
      return <li key={`${item.packageId}:${item.manifestHash}`}>
        <button type="button" className={styles.card} onClick={() => onSelect(item)} aria-label={`View module ${item.title}, version ${item.version}`}>
          <span className={styles.icon} aria-hidden="true"><Icon size={20} strokeWidth={1.7} /></span>
          <span className={styles.copy}>
            <strong>{item.title}</strong>
            <span className={styles.description}>{item.description}</span>
            <span className={styles.meta}>{category?.label ?? "Experiments"}<span aria-hidden="true"> · </span>v{item.version}</span>
          </span>
          <ChevronRight className={styles.chevron} aria-hidden="true" size={18} strokeWidth={1.7} />
        </button>
      </li>;
    })}
  </ul>;
}

export function ProfileModules({ account, ownProfile = false }: { account: string; ownProfile?: boolean }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ModuleAuthorProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<ModulePublicDetails | null>(null);
  const refresh = useLiveDataRefresh({ intervalMs: 60_000 });
  const scoped = data?.account === account.toLowerCase() ? data : null;
  const items = scoped?.items ?? [];
  const shownPage = scoped?.page.number ?? page;

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    queueMicrotask(() => { if (!disposed) setLoading(true); });
    const query = new URLSearchParams({ account: account.toLowerCase(), page: String(page) });
    void fetch(`/api/profile/modules?${query}`, { signal: controller.signal, headers: { accept: "application/json" } })
      .then(async response => {
        if (!response.ok) throw new Error("Modules unavailable.");
        return readModuleAuthorProfileResponse(await response.json(), account);
      })
      .then(next => {
        if (controller.signal.aborted) return;
        if (next.status === "unavailable") throw new Error("Modules unavailable.");
        setData(next);
        setFailed(false);
      })
      .catch(() => { if (!disposed) setFailed(true); })
      .finally(() => { window.clearTimeout(timeout); if (!disposed) setLoading(false); });
    return () => { disposed = true; window.clearTimeout(timeout); controller.abort(); };
  }, [account, page, refresh, retry]);

  const partial = scoped?.status === "partial";
  const notice = failed ? `Couldn’t ${scoped ? "refresh" : "load"} modules.`
    : partial ? `Some module versions are unavailable. ${items.length ? "Showing verified publications." : "Refresh to check again."}`
      : loading && !scoped ? "Loading modules…" : "";

  return <section className={styles.section} aria-labelledby="profile-modules-title">
    <header className={styles.heading}>
      <h2 id="profile-modules-title">Modules{scoped && (!partial || scoped.page.totalItems > 0) ? <span className={styles.count}> {scoped.page.totalItems}{partial ? "+" : ""}</span> : null}</h2>
      <button type="button" className={styles.refresh} onClick={() => setRetry(value => value + 1)} disabled={loading} aria-label="Refresh modules" aria-busy={loading}>
        <RefreshCw aria-hidden="true" size={15} strokeWidth={1.8} /><span>Refresh</span>
      </button>
    </header>
    <p className={failed || partial ? styles.notice : styles.srOnly} role="status">{notice}</p>
    <div aria-busy={loading}>
      {items.length ? <ProfileModuleCards items={items} onSelect={setSelected} />
        : loading && !scoped ? <div className={styles.skeleton} aria-hidden="true"><span /><div><span /><span /></div></div>
          : !failed && !partial ? <div className={styles.empty}><p>No published modules yet.</p>{ownProfile ? <Link href="/developer-reference/module-mode">Build a module</Link> : null}</div> : null}
    </div>
    {(scoped?.page.totalPages ?? 1) > 1 ? <nav className={styles.pagination} aria-label="Module pages">
      <button type="button" aria-label="Previous module page" disabled={loading || shownPage === 1} onClick={() => setPage(Math.max(1, shownPage - 1))}><ChevronLeft aria-hidden="true" size={18} /></button>
      <span aria-live="polite" aria-atomic="true">{shownPage} / {scoped!.page.totalPages}</span>
      <button type="button" aria-label="Next module page" disabled={loading || shownPage === scoped!.page.totalPages} onClick={() => setPage(Math.min(scoped!.page.totalPages, shownPage + 1))}><ChevronRight aria-hidden="true" size={18} /></button>
    </nav> : null}
    {selected && selected.author === account.toLowerCase() ? <ModuleDetailDialog module={selected} onClose={() => setSelected(null)} /> : null}
  </section>;
}
