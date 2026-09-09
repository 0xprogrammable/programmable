"use client";

import { useCallback, useLayoutEffect, useRef, useState, type ComponentPropsWithRef, type ComponentPropsWithoutRef, type Dispatch, type MouseEvent, type SetStateAction } from "react";
import styles from "./disclosure.module.css";

const easing = "cubic-bezier(0.16, 1, 0.3, 1)";
const canAnimate = () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Layout has to follow a disclosure's contents. Measure only at its endpoints;
 * keep this short, local height transition interruptible from its current size. */
function animateHeight(element: HTMLElement, from: number, to: number, expanded: boolean, finish: () => void) {
  const original = { height: element.style.height, overflow: element.style.overflow, boxSizing: element.style.boxSizing };
  element.style.overflow = "clip";
  element.style.boxSizing = "border-box";
  const animation = element.animate([{ height: `${from}px` }, { height: `${to}px` }], {
    duration: expanded ? 180 : 140,
    easing,
  });
  const cancel = () => {
    animation.onfinish = null;
    animation.cancel();
    Object.assign(element.style, original);
  };
  animation.onfinish = () => { cancel(); finish(); };
  return cancel;
}

/** Native details, including its summary, DOM shape, and public .open ref. */
export function Disclosure({ ref, className, onClick, onToggle, onInvalidCapture, ...props }: ComponentPropsWithRef<"details">) {
  const element = useRef<HTMLDetailsElement | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  const target = useRef<boolean | null>(null);
  const expectedOpen = useRef<boolean | null>(null);
  const observer = useRef<MutationObserver | null>(null);
  const inertChildren = useRef(new Map<HTMLElement, boolean>());

  const restoreChildren = useCallback(() => {
    for (const [child, inert] of inertChildren.current) child.inert = inert;
    inertChildren.current.clear();
  }, []);

  const hideChildren = useCallback((details: HTMLDetailsElement) => {
    for (const child of Array.from(details.children)) {
      if (child instanceof HTMLElement && child.tagName !== "SUMMARY") {
        inertChildren.current.set(child, child.inert);
        child.inert = true;
      }
    }
  }, []);

  const settle = useCallback((expanded: boolean) => {
    const details = element.current;
    if (!details) return;
    cancel.current?.();
    cancel.current = null;
    target.current = null;
    expectedOpen.current = expanded;
    details.open = expanded;
    observer.current?.takeRecords();
    delete details.dataset.disclosureClosing;
    delete details.dataset.disclosurePointer;
    details.querySelector(":scope > summary")?.removeAttribute("aria-expanded");
    restoreChildren();
    if (!expanded) hideChildren(details);
  }, [hideChildren, restoreChildren]);

  useLayoutEffect(() => {
    const details = element.current;
    if (!details) return;
    // Validation may assign .open = true while an exit still retains open content.
    // That assignment emits a mutation even when no native toggle event is needed.
    observer.current = new MutationObserver(() => settle(details.open));
    observer.current.observe(details, { attributes: true, attributeFilter: ["open"] });
    settle(details.open);
    return () => { observer.current?.disconnect(); cancel.current?.(); restoreChildren(); };
  }, [restoreChildren, settle]);

  return <details {...props} ref={node => {
    element.current = node;
    if (typeof ref === "function") return ref(node);
    if (ref) ref.current = node;
  }} className={`${styles.details}${className ? ` ${className}` : ""}`}
    onInvalidCapture={event => { settle(true); onInvalidCapture?.(event); }}
    onToggle={event => {
      // Native keyboard, find-in-page, and validation-driven .open changes stay instant.
      if (event.currentTarget.open !== expectedOpen.current) settle(event.currentTarget.open);
      onToggle?.(event);
    }}
    onClick={event => {
      onClick?.(event);
      const details = event.currentTarget;
      const clicked = event.target instanceof Element ? event.target : null;
      const summary = clicked?.closest("summary");
      if (event.defaultPrevented || !summary || summary.parentElement !== details
        || clicked?.closest("a, button, input, select, textarea")) return;
      const expanded = !(target.current ?? details.open);
      event.preventDefault();
      if (event.detail === 0 || !canAnimate() || !details.animate) { settle(expanded); return; }

      const from = details.getBoundingClientRect().height;
      cancel.current?.();
      restoreChildren();
      target.current = expanded;
      // Measure the natural endpoint before retaining open content for the exit.
      details.open = expanded;
      const to = details.getBoundingClientRect().height;
      expectedOpen.current = true;
      details.open = true;
      observer.current?.takeRecords();
      details.dataset.disclosurePointer = "";
      details.toggleAttribute("data-disclosure-closing", !expanded);
      summary.setAttribute("aria-expanded", String(expanded));
      if (!expanded) hideChildren(details);
      cancel.current = animateHeight(details, from, to, expanded, () => settle(expanded));
    }} />;
}

/** Explicitly distinguishes pointer toggles from validation or keyboard updates. */
export function useDisclosureState(initial = false) {
  const [state, update] = useState({ expanded: initial, pointer: false });
  const setExpanded: Dispatch<SetStateAction<boolean>> = value => update(current => ({ expanded: typeof value === "function" ? value(current.expanded) : value, pointer: false }));
  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    const pointer = event.detail > 0;
    update(current => ({ expanded: !current.expanded, pointer }));
  };
  return { expanded: state.expanded, setExpanded, toggle, panelProps: state };
}

export function DisclosurePanel({ expanded, pointer, className, children, ...props }: ComponentPropsWithoutRef<"div"> & {
  expanded: boolean;
  pointer: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [initiallyHidden] = useState(!expanded);
  const cancel = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const panel = element.current;
    if (!panel) return;
    const from = panel.getBoundingClientRect().height;
    cancel.current?.();
    cancel.current = null;
    panel.inert = !expanded;
    if (!pointer || !canAnimate() || !panel.animate) { panel.hidden = !expanded; return; }
    panel.hidden = false;
    const to = expanded ? panel.getBoundingClientRect().height : 0;
    cancel.current = animateHeight(panel, from, to, expanded, () => {
      panel.hidden = !expanded;
      cancel.current = null;
    });
  }, [expanded, pointer]);
  useLayoutEffect(() => () => cancel.current?.(), []);

  return <div {...props} ref={element} className={styles.panel} hidden={initiallyHidden}>
    <div className={className}>{children}</div>
  </div>;
}
