"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeftRight, ArrowUpRight, ChevronLeft, ChevronRight, Coins, FlaskConical, Gift, Link2, Percent, Puzzle, RefreshCw, Shield, Waves } from "lucide-react";
import { ModuleDetailDialog } from "@/components/module-detail-dialog";
import { ProfileModuleSubmissions } from "@/components/profile-module-submissions";
import { useLiveDataRefresh } from "@/components/use-live-data-refresh";
import { MODULE_CATEGORIES } from "@/lib/module-mode/library";
import type { ModulePublicDetails } from "@/lib/module-mode/public-details";
import { readModuleAuthorProfileResponse, type ModuleAuthorProfile } from "@/lib/profile/module-author-profile";
import styles from "./profile-modules.module.css";

const categoryIcons = { rewards: Gift, trading: ArrowLeftRight, fees: Percent, liquidity: Waves, pairs: Link2, supply: Coins, access: Shield, experiments: FlaskConical };
type ProfileModulesSection = "published" | "submissions";

export function ProfileModuleCards({ items, onSelect }: { items: readonly ModulePublicDetails[]; onSelect: (item: ModulePublicDetails) => void }) {
  return <ul className={styles.list}>
    {items.map(item => {
      const category = MODULE_CATEGORIES.find(candidate => candidate.id === item.category.split("/")[0]);
      const Icon = category ? categoryIcons[category.id] : Puzzle;
      return <li key={`${item.sourceKind ?? "native"}:${item.packageId}:${item.manifestHash}`}>
        <button type="button" className={styles.card} onClick={() => onSelect(item)} aria-label={`View module ${item.title}, version ${item.version}`}>
          <span className={styles.icon} aria-hidden="true"><Icon size={22} strokeWidth={1.6} /></span>
          <span className={styles.copy}>
            <span className={styles.titleRow}><strong>{item.title}</strong><span className={styles.version}>v{item.version}</span></span>
            <span className={styles.description}>{item.description}</span>
            <span className={styles.meta}>{category?.label ?? "Module"}</span>
          </span>
          <ChevronRight className={styles.chevron} aria-hidden="true" size={18} strokeWidth={1.7} />
        </button>
      </li>;
    })}
  </ul>;
}

export function ProfileModules({ account, ownProfile = false, initialSection = "published" }: { account: string; ownProfile?: boolean; initialSection?: ProfileModulesSection }) {
  const [selectedSection, setSelectedSection] = useState<ProfileModulesSection>(initialSection);
  const section = ownProfile ? selectedSection : "published";
  const tabId = useId();
  const tabsRef = useRef<HTMLDivElement>(null);
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
    if (section !== "published") return;
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
  }, [account, page, refresh, retry, section]);

  function navigateTabs(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next: ProfileModulesSection = event.key === "Home" ? "published" : event.key === "End" ? "submissions" : section === "published" ? "submissions" : "published";
    setSelectedSection(next);
    tabsRef.current?.querySelector<HTMLButtonElement>(`[data-section="${next}"]`)?.focus();
  }

  const partial = scoped?.status === "partial";
  const notice = failed ? `Couldn’t ${scoped ? "refresh" : "load"} modules.`
    : partial ? `Some module versions are unavailable. ${items.length ? "Showing verified publications." : "Refresh to check again."}`
      : loading && !scoped ? "Loading modules…" : "";

  return <section className={styles.section} aria-labelledby="profile-modules-title">
    <header className={styles.heading}>
      <div>
        <h2 id="profile-modules-title">Modules{!ownProfile && scoped && (!partial || scoped.page.totalItems > 0) ? <span className={styles.count}> {scoped.page.totalItems}{partial ? "+" : ""}</span> : null}</h2>
      </div>
      {ownProfile ? <div className={styles.headingActions}>
        <Link className={styles.buildLink} href="/developers/modules">Build a module<ArrowUpRight aria-hidden="true" size={16} strokeWidth={1.8} /></Link>
        {section === "published" ? <button type="button" className={styles.refresh} onClick={() => setRetry(value => value + 1)} disabled={loading} aria-label="Refresh modules" title="Refresh modules" aria-busy={loading}><RefreshCw aria-hidden="true" size={16} strokeWidth={1.8} /></button> : <span className={styles.refreshPlaceholder} aria-hidden="true" />}
      </div>
        : <button type="button" className={styles.refresh} onClick={() => setRetry(value => value + 1)} disabled={loading} aria-label="Refresh modules" aria-busy={loading}>
          <RefreshCw aria-hidden="true" size={16} strokeWidth={1.8} />
        </button>}
    </header>
    {ownProfile ? <div className={styles.toolbar}>
      <div className={styles.tabs} ref={tabsRef} role="tablist" aria-label="Your modules" onKeyDown={navigateTabs}>
        <button type="button" role="tab" id={`${tabId}-published`} aria-controls={`${tabId}-panel`} aria-selected={section === "published"} tabIndex={section === "published" ? 0 : -1} data-section="published" onClick={() => setSelectedSection("published")}>
          Published{scoped && (!partial || scoped.page.totalItems > 0) ? <span className={styles.tabCount}>{scoped.page.totalItems}{partial ? "+" : ""}</span> : null}
        </button>
        <button type="button" role="tab" id={`${tabId}-submissions`} aria-controls={`${tabId}-panel`} aria-selected={section === "submissions"} tabIndex={section === "submissions" ? 0 : -1} data-section="submissions" onClick={() => setSelectedSection("submissions")}>Submissions</button>
      </div>
    </div> : null}
    <div className={styles.content} id={ownProfile ? `${tabId}-panel` : undefined} role={ownProfile ? "tabpanel" : undefined} aria-labelledby={ownProfile ? `${tabId}-${section}` : undefined} tabIndex={ownProfile ? 0 : undefined}>
      {section === "submissions" ? <ProfileModuleSubmissions /> : <>
      <p className={failed || partial ? styles.notice : styles.srOnly} role="status">{notice}</p>
      <div aria-busy={loading}>
      {items.length ? <ProfileModuleCards items={items} onSelect={setSelected} />
        : loading && !scoped ? <div className={styles.loading} aria-hidden="true">{[0, 1].map(row => <div className={styles.skeleton} key={row}><span /><div><span /><span /><span /></div></div>)}</div>
          : !failed && !partial ? <div className={styles.empty}><span className={styles.emptyIcon} aria-hidden="true"><Puzzle size={28} strokeWidth={1.4} /></span><h3>No published modules yet.</h3></div> : null}
      </div>
    {(scoped?.page.totalPages ?? 1) > 1 ? <nav className={styles.pagination} aria-label="Module pages">
      <button type="button" aria-label="Previous module page" disabled={loading || shownPage === 1} onClick={() => setPage(Math.max(1, shownPage - 1))}><ChevronLeft aria-hidden="true" size={18} /></button>
      <span aria-live="polite" aria-atomic="true">{shownPage} / {scoped!.page.totalPages}</span>
      <button type="button" aria-label="Next module page" disabled={loading || shownPage === scoped!.page.totalPages} onClick={() => setPage(Math.min(scoped!.page.totalPages, shownPage + 1))}><ChevronRight aria-hidden="true" size={18} /></button>
    </nav> : null}
      </>}
    </div>
    {selected && selected.author === account.toLowerCase() ? <ModuleDetailDialog module={selected} onClose={() => setSelected(null)} /> : null}
  </section>;
}
