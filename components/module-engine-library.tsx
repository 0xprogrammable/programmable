"use client";

import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import type { ModuleEngineTemplate } from "@/lib/module-engine/catalog";
import { moduleEngineInterfaceLabel, moduleEngineOperationLabel } from "@/lib/module-engine/public-details";
import { MODULE_LIBRARY_PAGE_SIZE } from "@/lib/module-mode/library";
import styles from "./module-engine-library.module.css";

export interface ModuleEngineLibraryProps {
  templates: readonly ModuleEngineTemplate[];
  selectedId: string;
  onSelect: (template: ModuleEngineTemplate) => void;
  disabled?: boolean;
}
const categoryLabels = { "quote-v1": "Trading", "escrow-v1": "Deposits", "settlement-v1": "Payments", "custom-v1": "Custom" } as const;
const categoryFor = (profile: ModuleEngineTemplate["manifest"]["manifest"]["catalogDefinition"]["interface"]) => profile === "quote-shared-v1" ? "quote-v1" : profile;

/** Engine templates retain their own source, revision and operation wire throughout selection. */
export function ModuleEngineLibrary({ templates, selectedId, onSelect, disabled = false }: ModuleEngineLibraryProps) {
  const [query, setQuery] = useState(""), [kind, setKind] = useState("all"), [page, setPage] = useState(1);
  const deferred = useDeferredValue(query), id = useId();
  const categories = useMemo(() => (Object.keys(categoryLabels) as (keyof typeof categoryLabels)[])
    .filter(value => templates.some(template => categoryFor(template.manifest.manifest.catalogDefinition.interface) === value)), [templates]);
  const results = useMemo(() => {
    const words = deferred.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
    return templates.filter(template => {
      const { catalogDefinition: definition, revision } = template.manifest.manifest;
      if (kind !== "all" && categoryFor(definition.interface) !== kind) return false;
      const searchable = [definition.id, definition.title, definition.summary, definition.version, categoryLabels[categoryFor(definition.interface)], moduleEngineInterfaceLabel(definition.interface),
        ...revision.operationPermissions.map(operation => moduleEngineOperationLabel(operation.operationId))].join(" ").toLocaleLowerCase();
      return words.every(word => searchable.includes(word));
    });
  }, [templates, deferred, kind]);
  const pages = Math.max(1, Math.ceil(results.length / MODULE_LIBRARY_PAGE_SIZE)), currentPage = Math.min(page, pages);
  return <div className={styles.library}>
    <div className={styles.toolbar} hidden={templates.length < 2 && !query && kind === "all"}>
      <div className={styles.search}><label className={styles.srOnly} htmlFor={`${id}-search`}>Search modules</label><Search size={18} aria-hidden="true" />
        <input id={`${id}-search`} type="search" placeholder="Find a module" value={query} disabled={disabled}
          onChange={event => { setQuery(event.target.value); setPage(1); }} autoComplete="off" /></div>
      <label className={styles.categorySelect} hidden={categories.length < 2 && kind === "all"}><span className={styles.srOnly}>Module category</span>
        <select value={kind} disabled={disabled} onChange={event => { setKind(event.target.value); setPage(1); }}>
          <option value="all">All modules</option>{categories.map(value =>
            <option key={value} value={value}>{categoryLabels[value]}</option>)}
        </select></label>
    </div>
    <div className={styles.resultCount} hidden={!query.trim() && kind === "all"} role="status" aria-live="polite">{results.length} {results.length === 1 ? "module" : "modules"}{query.trim() ? ` for “${query.trim()}”` : ""}</div>
    <div className={styles.results} aria-label="Module library">
      {results.slice((currentPage - 1) * MODULE_LIBRARY_PAGE_SIZE, currentPage * MODULE_LIBRARY_PAGE_SIZE).map(template => {
        const { catalogDefinition: definition } = template.manifest.manifest, selected = definition.id === selectedId;
        return <article key={template.manifestHash} className={styles.module} data-selected={selected}>
          <div className={styles.moduleInfo}><h3>{definition.title}</h3><p>{definition.summary}</p><span>{categoryLabels[categoryFor(definition.interface)]} · v{definition.version}</span></div>
          <button type="button" className={styles.add} disabled={disabled} aria-label={`Choose module ${definition.title}`} aria-pressed={selected}
            onClick={() => { if (!selected) onSelect(template); }}><span className={styles.selectionIcon} aria-hidden="true">{selected ? <Check size={14} /> : null}</span>{selected ? "Selected" : "Choose"}</button>
        </article>;
      })}
    </div>
    {results.length === 0 ? <div className={styles.empty}><strong>{query.trim() || kind !== "all" ? "No matching modules" : "No modules available yet"}</strong>
      {query.trim() || kind !== "all" ? <div><button type="button" disabled={disabled} onClick={() => { setQuery(""); setKind("all"); setPage(1); }}><X size={16} aria-hidden="true" />Clear filters</button></div> : null}</div> : null}
    {pages > 1 ? <nav className={styles.pagination} aria-label="Module library pages">
      <button type="button" disabled={disabled || currentPage === 1} onClick={() => setPage(currentPage - 1)} aria-label="Previous modules"><ChevronLeft size={18} /></button>
      <span>Page {currentPage} of {pages}</span>
      <button type="button" disabled={disabled || currentPage === pages} onClick={() => setPage(currentPage + 1)} aria-label="Next modules"><ChevronRight size={18} /></button>
    </nav> : null}
  </div>;
}


function trapPickerFocus(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, a[href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter(element => !element.matches(":disabled") && element.getClientRects().length > 0);
  const first = controls[0], last = controls.at(-1);
  if (!first || !last) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (active === last || !event.currentTarget.contains(active))) { event.preventDefault(); first.focus(); }
}

export function ModuleEnginePicker({ open, onClose, ...library }: ModuleEngineLibraryProps & { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), close = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.documentElement;
    const overflow = root.style.overflow, gutter = root.style.scrollbarGutter;
    root.style.scrollbarGutter = "stable";
    root.style.overflow = "hidden";
    element.showModal();
    close.current?.focus();
    return () => {
      element.close();
      root.style.overflow = overflow;
      root.style.scrollbarGutter = gutter;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [open]);

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={`${id}-title`}
    onKeyDown={trapPickerFocus} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={styles.dialogSurface}>
      <header className={styles.dialogHeader}><div><h2 id={`${id}-title`}>Choose a module</h2></div><button ref={close} type="button" className={styles.close} aria-label="Close modules" onClick={onClose}><X size={20} aria-hidden="true" /></button></header>
      <div className={styles.dialogContent}><ModuleEngineLibrary {...library} /></div>
    </div>
  </dialog>;
}
