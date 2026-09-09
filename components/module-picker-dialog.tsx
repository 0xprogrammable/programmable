"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./module-picker-dialog.module.css";

export function ModulePickerDialog({ title, description, children, onClose, footer }: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    const gutter = root.style.scrollbarGutter;
    root.style.scrollbarGutter = "stable";
    root.style.overflow = "hidden";
    element.showModal();
    const invalid = element.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]');
    (invalid ?? heading.current)?.focus();
    return () => {
      element.close();
      root.style.overflow = overflow;
      root.style.scrollbarGutter = gutter;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => {
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(':is(button, a[href], input, select, textarea, summary, [tabindex]):not(:disabled):not([tabindex="-1"])')).filter(element => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={styles.surface}>
      <header className={styles.header}>
        <div><h2 ref={heading} tabIndex={-1} id={`${id}-title`}>{title}</h2>{description ? <p id={`${id}-description`}>{description}</p> : null}</div>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close modules"><X size={20} aria-hidden="true" /></button>
      </header>
      <div className={styles.content}>{children}</div>
      <footer className={styles.footer}>{footer}<button type="button" className={styles.done} onClick={onClose}>Done</button></footer>
    </div>
  </dialog>;
}
