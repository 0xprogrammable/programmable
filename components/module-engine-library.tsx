"use client";

import { useDeferredValue, useId, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import type { ModuleEngineTemplate } from "@/lib/module-engine/catalog";
import { moduleEngineCategory, moduleEngineInterfaceLabel, moduleEngineOperationLabel } from "@/lib/module-engine/public-details";
import { MODULE_LIBRARY_PAGE_SIZE } from "@/lib/module-mode/library";
import { ModuleCategoryIcon } from "./module-library";
import styles from "./module-library.module.css";

export interface ModuleEngineLibraryProps {
  templates: readonly ModuleEngineTemplate[];
  selectedId: string;
  onSelect: (template: ModuleEngineTemplate) => void;
  disabled?: boolean;
}
/** Engine templates retain their own source, revision and operation wire throughout selection. */
export function ModuleEngineLibrary({ templates, selectedId, onSelect, disabled = false }: ModuleEngineLibraryProps) {
  const [query, setQuery] = useState(""), [kind, setKind] = useState("all"), [page, setPage] = useState(1);
  const deferred = useDeferredValue(query), id = useId();
  const results = useMemo(() => {
    const words = deferred.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
    return templates.filter(template => {
      const { catalogDefinition: definition, revision } = template.manifest.manifest;
      if (kind !== "all" && definition.interface !== kind) return false;
      const searchable = [definition.id, definition.title, definition.summary, definition.version, moduleEngineInterfaceLabel(definition.interface),
        ...revision.operationPermissions.map(operation => moduleEngineOperationLabel(operation.operationId))].join(" ").toLocaleLowerCase();
      return words.every(word => searchable.includes(word));
    });
  }, [templates, deferred, kind]);
  const pages = Math.max(1, Math.ceil(results.length / MODULE_LIBRARY_PAGE_SIZE)), currentPage = Math.min(page, pages);
  return <div className={styles.library}>
    <div className={styles.toolbar}>
      <div className={styles.search}><label className={styles.srOnly} htmlFor={`${id}-search`}>Search templates</label><Search size={18} aria-hidden="true" />
        <input id={`${id}-search`} type="search" placeholder="Search templates, operations…" value={query} disabled={disabled}
          onChange={event => { setQuery(event.target.value); setPage(1); }} autoComplete="off" /></div>
      <label className={styles.categorySelect}><span className={styles.srOnly}>Template type</span>
        <select value={kind} disabled={disabled} onChange={event => { setKind(event.target.value); setPage(1); }}>
          <option value="all">All template types</option>{(["quote-v1", "escrow-v1", "settlement-v1", "custom-v1"] as const).map(value =>
            <option key={value} value={value}>{moduleEngineInterfaceLabel(value)}</option>)}
        </select></label>
    </div>
    <div className={styles.resultCount} role="status" aria-live="polite">{results.length} {results.length === 1 ? "template" : "templates"}{query.trim() ? ` for “${query.trim()}”` : ""}</div>
    <div className={styles.results} aria-label="Template library">
      {results.slice((currentPage - 1) * MODULE_LIBRARY_PAGE_SIZE, currentPage * MODULE_LIBRARY_PAGE_SIZE).map(template => {
        const { catalogDefinition: definition, revision } = template.manifest.manifest, selected = definition.id === selectedId;
        return <article key={template.manifestHash} className={styles.module} data-selected={selected}>
          <div className={styles.moduleTop}><ModuleCategoryIcon category={moduleEngineCategory(definition.interface) === "trading" ? "trading" : "experiments"} /><span>{moduleEngineInterfaceLabel(definition.interface)}</span></div>
          <h3>{definition.title}</h3><p>{definition.summary}</p>
          <p>{revision.operationPermissions.map(operation => moduleEngineOperationLabel(operation.operationId)).join(" · ")}</p>
          <div className={styles.moduleBottom}><span className={styles.author}>v{definition.version}</span>
            <button type="button" className={styles.add} disabled={disabled} aria-label={`Use template ${definition.title}`} aria-pressed={selected}
              onClick={() => { if (!selected) onSelect(template); }}>{selected ? <Check size={16} aria-hidden="true" /> : null}{selected ? "Selected" : "Use template"}</button></div>
        </article>;
      })}
    </div>
    {results.length === 0 ? <div className={styles.empty}><strong>{query.trim() || kind !== "all" ? "No matching templates" : "No published templates are available"}</strong>
      {query.trim() || kind !== "all" ? <div><button type="button" disabled={disabled} onClick={() => { setQuery(""); setKind("all"); setPage(1); }}><X size={16} aria-hidden="true" />Clear filters</button></div> : null}</div> : null}
    {pages > 1 ? <nav className={styles.pagination} aria-label="Template library pages">
      <button type="button" disabled={disabled || currentPage === 1} onClick={() => setPage(currentPage - 1)} aria-label="Previous templates"><ChevronLeft size={18} /></button>
      <span>Page {currentPage} of {pages}</span>
      <button type="button" disabled={disabled || currentPage === pages} onClick={() => setPage(currentPage + 1)} aria-label="Next templates"><ChevronRight size={18} /></button>
    </nav> : null}
  </div>;
}
