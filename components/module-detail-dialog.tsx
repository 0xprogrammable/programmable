"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import type { ModulePublicDetails } from "@/lib/module-mode/public-details";
import styles from "./module-detail-dialog.module.css";

export function ModuleDetailDialog({ module, onClose, packageId, familyId, title }: {
  module: ModulePublicDetails | null;
  onClose: () => void;
  packageId?: string;
  familyId?: string;
  title?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!element) return;
    const root = document.documentElement;
    const rootOverflow = root.style.overflow;
    const bodyOverflow = document.body.style.overflow;
    const scrollbarGutter = root.style.scrollbarGutter;
    root.style.scrollbarGutter = "stable";
    root.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    if (!element.open) element.showModal();
    close.current?.focus();
    return () => {
      element.close();
      root.style.overflow = rootOverflow;
      document.body.style.overflow = bodyOverflow;
      root.style.scrollbarGutter = scrollbarGutter;
      trigger?.focus();
    };
  }, []);

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={`${id}-title`}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={styles.surface}>
      <header className={styles.header}><h2 id={`${id}-title`}>{module?.title ?? title ?? "Module"}</h2><button ref={close} className={styles.close} type="button" aria-label="Close module details" onClick={onClose}><X size={20} aria-hidden="true" /></button></header>
      <p className={styles.description}>{module?.description || "Details for this module version are unavailable."}</p>
      {module ? <dl className={styles.facts}>
        <div><dt>Author</dt><dd><Link href={`/profile?account=${module.author}&chain=4663`} title={module.author}>{module.author.slice(0, 8)}…{module.author.slice(-6)}</Link></dd></div>
        <div><dt>Version</dt><dd>{module.version}</dd></div>
      </dl> : null}
      <details className={styles.identity}><summary>Module identity</summary><dl>
        {(module?.packageId ?? packageId) ? <div><dt>Package</dt><dd><code>{module?.packageId ?? packageId}</code></dd></div> : null}
        {(module?.familyId ?? familyId) ? <div><dt>Family</dt><dd><code>{module?.familyId ?? familyId}</code></dd></div> : null}
        {module ? <div><dt>Manifest</dt><dd><code>{module.manifestHash}</code></dd></div> : null}
      </dl></details>
    </div>
  </dialog>;
}
