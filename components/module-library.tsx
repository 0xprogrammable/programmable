"use client";

import Link from "next/link";
import { useDeferredValue, useId, useMemo, useState } from "react";
import { ArrowsLeftRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowsLeftRight";
import { CoinsIcon } from "@phosphor-icons/react/dist/ssr/Coins";
import { FlaskIcon } from "@phosphor-icons/react/dist/ssr/Flask";
import { GiftIcon } from "@phosphor-icons/react/dist/ssr/Gift";
import { LinkIcon } from "@phosphor-icons/react/dist/ssr/Link";
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/ssr/ShieldCheck";
import { SlidersHorizontalIcon } from "@phosphor-icons/react/dist/ssr/SlidersHorizontal";
import { WavesIcon } from "@phosphor-icons/react/dist/ssr/Waves";
import { ArrowRight, ChevronLeft, ChevronRight, Plus, Search, X } from "lucide-react";
import { feeBreakdown, type ModuleModeFeePolicy } from "@/lib/module-mode/builder";
import { MODULE_CATEGORIES, MODULE_LIBRARY_PAGE_SIZE, moduleAuthorLabel, moduleCategory, moduleDiscovery, searchModuleLibrary, type ModuleCategoryId, type ModuleLibraryEntry } from "@/lib/module-mode/library";
import styles from "@/components/module-library.module.css";

const icons = { rewards: GiftIcon, trading: ArrowsLeftRightIcon, fees: SlidersHorizontalIcon,
  liquidity: WavesIcon, pairs: LinkIcon, supply: CoinsIcon, access: ShieldCheckIcon, experiments: FlaskIcon };

export function ModuleCategoryIcon({ category, size = 22 }: { category: ModuleCategoryId; size?: number }) {
  const Icon = icons[category];
  return <span className={styles.categoryIcon} data-category={category}><Icon size={size} weight="regular" aria-hidden="true" /></span>;
}

export function ModuleAuthor({ entry }: { entry: ModuleLibraryEntry }) {
  const author = moduleDiscovery(entry).author;
  return author ? <Link href={`/profile?account=${author}&chain=4663`} className={styles.author} title={`Module author ${author}`}>By {moduleAuthorLabel(entry)}</Link> : null;
}

export interface ModuleLibraryProps<Entry extends ModuleLibraryEntry> {
  catalog: readonly Entry[];
  selectedIds: readonly string[];
  onAdd: (entry: Entry) => void;
  onRemove: (entry: Entry) => void;
  feePolicyFor?: (entry: Entry) => ModuleModeFeePolicy | null;
  feeDescriptionFor?: (entry: Entry) => string | undefined;
  disabledFor?: (entry: Entry) => string | undefined;
  disabled?: boolean;
}

export function ModuleLibrary<Entry extends ModuleLibraryEntry>({ catalog, selectedIds, onAdd, onRemove, feePolicyFor, feeDescriptionFor, disabledFor, disabled = false }: ModuleLibraryProps<Entry>) {
  const id = useId();
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
  const hasFilters = Boolean(query.trim() || category !== "all");
  const reset = () => { setQuery(""); setCategory("all"); setPage(1); };
  return <div className={styles.library}>
    <div className={styles.toolbar} hidden={catalog.length < 5 && !query && category === "all"}>
      <div className={styles.search}>
        <label className={styles.srOnly} htmlFor={`${id}-search`}>Search modules</label>
        <Search size={18} aria-hidden="true" />
        <input id={`${id}-search`} type="search" placeholder="Find a module" value={query}
          onChange={event => { setQuery(event.target.value); setPage(1); }} autoComplete="off" />
      </div>

    </div>
    <div className={styles.categories} hidden={new Set(catalog.map(entry => moduleCategory(entry).id)).size < 2} role="group" aria-label="Browse module categories">
      <button type="button" aria-pressed={category === "all"} onClick={() => { setCategory("all"); setPage(1); }}>All</button>
      {MODULE_CATEGORIES.filter(item => counts.get(item.id) || item.id === category).map(item =>
        <button type="button" key={item.id} aria-pressed={category === item.id} onClick={() => { setCategory(item.id); setPage(1); }}>
          {item.label}
        </button>)}
    </div>
    <div className={styles.resultCount} hidden={!query.trim() && category === "all"} role="status" aria-live="polite">{results.length} {results.length === 1 ? "module" : "modules"}{query.trim() ? ` for “${query.trim()}”` : ""}</div>
    <div className={styles.results} aria-label="Module library">
      {visible.map(entry => {
        const added = selected.has(entry.id);
        const group = moduleCategory(entry);
        const feeOverride = feeDescriptionFor?.(entry);
        const selectionPolicy = feeOverride === undefined ? feePolicyFor?.(entry) : undefined;
        const feeDescription = feeOverride ?? (feePolicyFor ? selectionPolicy ? `Estimated platform fee: ${feeBreakdown("0", "0", selectionPolicy).programmable} per trade.` : "Platform fee unavailable." : undefined);
        const disabledReason = disabledFor?.(entry);
        const descriptionIds = [feeDescription !== undefined ? `${id}-${entry.id}-fee` : undefined, disabledReason ? `${id}-${entry.id}-disabled` : undefined].filter(Boolean).join(" ") || undefined;
        return <article key={entry.id} className={styles.module} data-selected={added}>
        <div className={styles.moduleTop}><ModuleCategoryIcon category={group.id} />{entry.status === "preview" ? <span className={styles.preview}>Draft only</span> : null}</div>
        <h3 id={`module-${entry.id}-title`} tabIndex={-1}>{entry.title}</h3>
        <p>{entry.summary}</p>
        {feeDescription !== undefined ? <div className={styles.selectionFee} id={`${id}-${entry.id}-fee`}>{feeDescription}</div> : null}
        {disabledReason ? <div className={styles.disabledReason} id={`${id}-${entry.id}-disabled`}>{disabledReason}</div> : null}
        <div className={styles.moduleBottom}><ModuleAuthor entry={entry} />
          <button type="button" className={styles.add} aria-label={`${added ? "Remove" : "Add"} ${entry.title}`} aria-pressed={added} aria-describedby={descriptionIds} disabled={disabled || (!added && Boolean(disabledReason))}
            onClick={() => added ? onRemove(entry) : onAdd(entry)}>{added ? <X size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}{added ? "Remove" : "Add"}</button>
        </div>
      </article>; })}
    </div>
    {results.length === 0 ? <div className={styles.empty}>
      <strong>{hasFilters ? "No matching modules" : "No modules available yet"}</strong>
      <div>{hasFilters ? <button type="button" onClick={reset}><X size={16} aria-hidden="true" />Clear filters</button> : null}<Link href="/developers/modules">Build a module<ArrowRight size={16} aria-hidden="true" /></Link></div>
    </div> : null}
    {pages > 1 ? <nav className={styles.pagination} aria-label="Module library pages">
      <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} aria-label="Previous modules"><ChevronLeft size={18} /></button>
      <span>Page {currentPage} of {pages}</span>
      <button type="button" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)} aria-label="Next modules"><ChevronRight size={18} /></button>
    </nav> : null}
    {results.length > 0 ? <Link className={styles.contribute} href="/developers/modules"><Plus size={18} aria-hidden="true" /><span>Create a module</span><ArrowRight size={16} aria-hidden="true" /></Link> : null}
  </div>;
}
