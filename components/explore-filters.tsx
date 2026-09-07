"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import {
  activeExploreFilterCount, DEFAULT_EXPLORE_FILTERS, LAUNCH_MODE_OPTIONS,
  type RobinhoodExploreFilters,
} from "@/lib/robinhood-explore-filters";
import styles from "./explore-filters.module.css";

export function ExploreFilters({ value = DEFAULT_EXPLORE_FILTERS, onApply, disabled = false }: {
  value?: RobinhoodExploreFilters;
  onApply?: (filters: RobinhoodExploreFilters) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [panelOffset, setPanelOffset] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const keyboardOpenRef = useRef(false);
  const panelId = useId();
  const count = activeExploreFilterCount(value);

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    if (keyboardOpenRef.current) rootRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    const resized = () => setOpen(false);
    window.addEventListener("resize", resized);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", resized);
    };
  }, [open]);

  return <div className={styles.root} ref={rootRef} style={{ "--filter-offset": `${panelOffset}px` } as CSSProperties}
    onKeyDown={(event) => {
      if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
    }}
    onBlurCapture={(event) => {
      if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) close();
    }}
  >
    <button className={styles.trigger} ref={triggerRef} type="button" disabled={disabled}
      aria-label={count ? `Filters, ${count} active` : "Filters"}
      aria-expanded={open} aria-controls={panelId} aria-haspopup="dialog"
      title={disabled ? "Filters are unavailable while Ethereum indexing is rebuilt" : undefined}
      data-active={count > 0}
      onClick={(event) => {
        if (open) close();
        else {
          keyboardOpenRef.current = event.detail === 0;
          const right = triggerRef.current?.getBoundingClientRect().right ?? window.innerWidth - 16;
          setPanelOffset(Math.min(0, right - Math.min(288, window.innerWidth - 32) - 16));
          setOpen(true);
        }
      }}
    >
      <SlidersHorizontal size={16} aria-hidden="true" />
      <span className={styles.label}>Filters</span>
      {count > 0 ? <span className={styles.count} aria-hidden="true">{count}</span> : null}
    </button>
    {open ? <div className={styles.panel} id={panelId} role="dialog" aria-label="Launch filters">
      <div className={styles.heading}>
        <div className={styles.headingLabel}>
          <h2>Filters</h2>
          <button className={styles.reset} type="button" onClick={() => onApply?.(DEFAULT_EXPLORE_FILTERS)}>Reset</button>
        </div>
        <button className={styles.close} type="button" aria-label="Close filters" onClick={() => close(true)}><X size={18} aria-hidden="true" /></button>
      </div>
      <fieldset className={styles.field}>
        <legend>Launch type</legend>
        <div className={`${styles.choices} ${styles.modeChoices}`}>
          {LAUNCH_MODE_OPTIONS.map(mode => <button type="button" key={mode.value}
            aria-pressed={(value.mode ?? "all") === mode.value}
            onClick={() => onApply?.({ ...value, mode: mode.value })}>{mode.label}</button>)}
        </div>
      </fieldset>
      <fieldset className={styles.field}>
        <legend>Age</legend>
        <div className={styles.choices}>
          <button type="button" aria-pressed={value.sort === "oldest"} onClick={() => onApply?.({ ...value, sort: "oldest" })}>Oldest</button>
          <button type="button" aria-pressed={value.sort === "newest"} onClick={() => onApply?.({ ...value, sort: "newest" })}>Newest</button>
        </div>
      </fieldset>
      <fieldset className={styles.field}>
        <legend>Market cap</legend>
        <div className={styles.choices}>
          <button type="button" aria-pressed={value.sort === "lowest"} onClick={() => onApply?.({ ...value, sort: "lowest" })}>Lowest</button>
          <button type="button" aria-pressed={value.sort === "highest"} onClick={() => onApply?.({ ...value, sort: "highest" })}>Highest</button>
        </div>
      </fieldset>
    </div> : null}
  </div>;
}
