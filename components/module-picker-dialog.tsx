"use client";

import { X } from "lucide-react";
import { useLayoutEffect, useId, useRef, type ReactNode } from "react";
import styles from "./module-picker-dialog.module.css";

export function ModulePickerDialog({ title, description, children, onClose, onDone, doneDisabled = false, footer, animateOpen = false, variant }: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  onDone?: () => void;
  doneDisabled?: boolean;
  animateOpen?: boolean;
  variant?: "library";
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const motion = useRef<Animation | null>(null);
  const closing = useRef(false);
  const closeCallback = useRef(onClose);
  useLayoutEffect(() => { closeCallback.current = onClose; }, [onClose]);
  const id = useId();

  function close(pointer: boolean) {
    const element = dialog.current;
    if (!element) return;
    if (!pointer || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !element.animate) {
      motion.current?.cancel();
      closeCallback.current();
      return;
    }
    if (closing.current) return;
    closing.current = true;
    const current = getComputedStyle(element);
    const opacity = current.opacity;
    const transform = current.transform;
    motion.current?.cancel();
    element.dataset.motion = "";
    element.dataset.closing = "";
    delete element.dataset.visible;
    if (surface.current) surface.current.inert = true;
    motion.current = element.animate([
      { opacity, transform },
      { opacity: 0, transform: "translateY(4px) scale(0.985)" },
    ], { duration: 140, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" });
    motion.current.onfinish = () => closeCallback.current();
  }

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    const gutter = root.style.scrollbarGutter;
    root.style.scrollbarGutter = "stable";
    root.style.overflow = "hidden";
    element.showModal();
    if (animateOpen && !window.matchMedia("(prefers-reduced-motion: reduce)").matches && element.animate) {
      element.dataset.motion = "";
      // Flush the initial backdrop state before changing its transition target.
      void getComputedStyle(element, "::backdrop").opacity;
      motion.current = element.animate([
        { opacity: 0, transform: "translateY(6px) scale(0.985)" },
        { opacity: 1, transform: "translateY(0) scale(1)" },
      ], { duration: 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
    }
    element.dataset.visible = "";
    const invalid = element.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]');
    (invalid ?? heading.current)?.focus();
    return () => {
      motion.current?.cancel();
      element.close();
      root.style.overflow = overflow;
      root.style.scrollbarGutter = gutter;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [animateOpen]);

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined}
    onCancel={event => { event.preventDefault(); close(false); }}
    onKeyDown={event => {
      if (event.key !== "Tab") return;
      if (closing.current) { event.preventDefault(); return; }
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(':is(button, a[href], input, select, textarea, summary, [tabindex]):not(:disabled):not([tabindex="-1"])')).filter(element => element.getClientRects().length > 0 && !element.closest("[inert]"));
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}
    onClick={event => { if (event.target === event.currentTarget) close(event.detail > 0); }}>
    <div ref={surface} className={`${styles.surface}${variant === "library" ? ` ${styles.librarySurface}` : ""}`}>
      <header className={styles.header}>
        <div><h2 ref={heading} tabIndex={-1} id={`${id}-title`}>{title}</h2>{description ? <p id={`${id}-description`}>{description}</p> : null}</div>
        <button type="button" className={styles.close} onClick={event => close(event.detail > 0)} aria-label="Close modules"><X size={20} aria-hidden="true" /></button>
      </header>
      <div className={styles.content}>{children}</div>
      <footer className={styles.footer}>{footer}<button type="button" className={styles.done} disabled={doneDisabled} onClick={event => onDone ? onDone() : close(event.detail > 0)}>Done</button></footer>
    </div>
  </dialog>;
}
