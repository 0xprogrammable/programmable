"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { ArrowsLeftRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowsLeftRight";
import { CoinsIcon } from "@phosphor-icons/react/dist/ssr/Coins";
import { FlaskIcon } from "@phosphor-icons/react/dist/ssr/Flask";
import { GiftIcon } from "@phosphor-icons/react/dist/ssr/Gift";
import { LinkIcon } from "@phosphor-icons/react/dist/ssr/Link";
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/ssr/ShieldCheck";
import { SlidersHorizontalIcon } from "@phosphor-icons/react/dist/ssr/SlidersHorizontal";
import { WavesIcon } from "@phosphor-icons/react/dist/ssr/Waves";
import { ArrowRight, Check, ChevronLeft, ChevronRight, Plus, Search, X } from "lucide-react";
import type { ModuleModeCatalogEntry } from "@/lib/module-mode/builder";
import { MODULE_CATEGORIES, MODULE_LIBRARY_PAGE_SIZE, moduleAuthorLabel, moduleCategory, moduleDiscovery, searchModuleLibrary, type ModuleCategoryId } from "@/lib/module-mode/library";
import styles from "@/components/module-library.module.css";

const icons = { rewards: GiftIcon, trading: ArrowsLeftRightIcon, fees: SlidersHorizontalIcon,
  liquidity: WavesIcon, pairs: LinkIcon, supply: CoinsIcon, access: ShieldCheckIcon, experiments: FlaskIcon };

export function ModuleCategoryIcon({ category, size = 22 }: { category: ModuleCategoryId; size?: number }) {
  const Icon = icons[category];
  return <span className={styles.categoryIcon} data-category={category}><Icon size={size} weight="regular" aria-hidden="true" /></span>;
}

export function ModuleAuthor({ entry }: { entry: ModuleModeCatalogEntry }) {
  const author = moduleDiscovery(entry).author;
  return author ? <Link href={`/profile/${author}`} className={styles.author} title={`Module author ${author}`}>By {moduleAuthorLabel(entry)}</Link> : null;
}

export function ModuleLibrary({ catalog, selectedIds, onAdd, onRemove }: {
  catalog: readonly ModuleModeCatalogEntry[]; selectedIds: readonly string[];
  onAdd: (entry: ModuleModeCatalogEntry) => void; onRemove: (entry: ModuleModeCatalogEntry) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(1);
  const deferredQuery = useDeferredValue(query);
  const results = useMemo(() => searchModuleLibrary(catalog, deferredQuery, category), [catalog, deferredQuery, category]);
  const counts = useMemo(() => new Map(MODULE_CATEGORIES.map(item => [item.id,
    catalog.filter(entry => moduleCategory(entry).id === item.id).length])), [catalog]);
  const pages = Math.max(1, Math.ceil(results.length / MODULE_LIBRARY_PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const visible = results.slice((currentPage - 1) * MODULE_LIBRARY_PAGE_SIZE, currentPage * MODULE_LIBRARY_PAGE_SIZE);
  const selected = new Set(selectedIds);
  const reset = () => { setQuery(""); setCategory("all"); setPage(1); };
  return <div className={styles.library}>
    <div className={styles.toolbar}>
      <div className={styles.search}>
        <label className={styles.srOnly} htmlFor="module-search">Search modules</label>
        <Search size={18} aria-hidden="true" />
        <input id="module-search" type="search" placeholder="Search modules, ideas, authors…" value={query}
          onChange={event => { setQuery(event.target.value); setPage(1); }} autoComplete="off" />
      </div>
      <label className={styles.categorySelect}><span className={styles.srOnly}>Module category</span>
        <select value={category} onChange={event => { setCategory(event.target.value); setPage(1); }}>
          <option value="all">All categories</option>
          {MODULE_CATEGORIES.map(item => <option key={item.id} value={item.id}>{item.label} ({counts.get(item.id)})</option>)}
        </select>
      </label>
    </div>
    <div className={styles.categories} role="group" aria-label="Browse module categories">
      <button type="button" aria-pressed={category === "all"} onClick={() => { setCategory("all"); setPage(1); }}>All <span>{catalog.length}</span></button>
      {MODULE_CATEGORIES.filter(item => counts.get(item.id) || item.id === category).map(item =>
        <button type="button" key={item.id} aria-pressed={category === item.id} onClick={() => { setCategory(item.id); setPage(1); }}>
          <ModuleCategoryIcon category={item.id} size={18} />{item.label}<span>{counts.get(item.id)}</span>
        </button>)}
    </div>
    <div className={styles.resultCount} role="status" aria-live="polite">{results.length} {results.length === 1 ? "module" : "modules"}{query.trim() ? ` for “${query.trim()}”` : ""}</div>
    <div className={styles.results} aria-label="Module library">
      {visible.map(entry => { const added = selected.has(entry.id); const group = moduleCategory(entry); return <article key={entry.id} className={styles.module} data-selected={added}>
        <div className={styles.moduleTop}><ModuleCategoryIcon category={group.id} /><span>{group.label}</span>{entry.status === "preview" ? <span className={styles.preview}>Preview</span> : null}</div>
        <h3>{entry.title}</h3>
        <p>{entry.summary}</p>
        <div className={styles.moduleBottom}><ModuleAuthor entry={entry} />
          <button type="button" className={styles.add} aria-label={`${added ? "Remove" : "Add"} ${entry.title}`} aria-pressed={added}
            onClick={() => added ? onRemove(entry) : onAdd(entry)}>{added ? <Check size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}{added ? "Added" : "Add"}</button>
        </div>
      </article>; })}
    </div>
    {results.length === 0 ? <div className={styles.empty}>
      <strong>{query.trim() ? "No matching modules" : "No published modules in this category yet"}</strong>
      <div><button type="button" onClick={reset}><X size={16} aria-hidden="true" />Clear filters</button><Link href="/developers/modules">Build a module<ArrowRight size={16} aria-hidden="true" /></Link></div>
    </div> : null}
    {pages > 1 ? <nav className={styles.pagination} aria-label="Module library pages">
      <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} aria-label="Previous modules"><ChevronLeft size={18} /></button>
      <span>Page {currentPage} of {pages}</span>
      <button type="button" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)} aria-label="Next modules"><ChevronRight size={18} /></button>
    </nav> : null}
    {results.length > 0 ? <Link className={styles.contribute} href="/developers/modules"><Plus size={18} aria-hidden="true" /><span>Build your own module</span><ArrowRight size={16} aria-hidden="true" /></Link> : null}
  </div>;
}
