"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import styles from "./module-mode-builder.module.css";
import loading from "./module-builder-loading.module.css";

export function ModuleBuilderLoading() {
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    const current = heading.current;
    return () => {
      if (document.activeElement !== current) return;
      requestAnimationFrame(() => {
        if (document.activeElement !== document.body) return;
        const next = document.querySelector<HTMLElement>("main h1");
        if (!next) return;
        next.tabIndex = -1;
        next.focus({ preventScroll: true });
      });
    };
  }, []);
  return <section className={[styles.page, styles.studio].join(" ")} aria-busy="true" aria-labelledby="module-loading-title">
    <div className={styles.pageTop}>
      <Link href="/launch" className={styles.backLink}><ArrowLeft size={16} aria-hidden="true" /> Launch</Link>
    </div>
    <div className={styles.layout}>
      <div className={styles.formPanel}>
        <header className={styles.heading}><h1 ref={heading} id="module-loading-title">Create a coin</h1></header>
        <p className={styles.liveRegion} role="status">Loading coin setup</p>
        <div className={loading.fields} aria-hidden="true">
          <div className={loading.pair}>{[0, 1].map(index => <div key={index}><span className={loading.label} /><span className={loading.control} /></div>)}</div>
          <div><span className={loading.label} /><span className={[loading.control, loading.image].join(" ")} /></div>
          <span className={loading.control} />
          <div><span className={loading.label} /><span className={loading.control} /></div>
          <div><span className={loading.label} /><span className={loading.control} /></div>
          <span className={loading.control} />
          <span className={loading.control} />
        </div>
      </div>
      <aside className={loading.preview} aria-hidden="true">
        <div className={loading.card}><span className={loading.avatar} /><span className={loading.label} /><span className={loading.label} /><div className={loading.rows}>{[0, 1, 2, 3].map(index => <span className={loading.label} key={index} />)}</div></div>
      </aside>
    </div>
  </section>;
}
