"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, RotateCcw } from "lucide-react";
import { useEffect, useRef } from "react";

import { SiteFooter } from "@/components/site-footer";
import styles from "@/app/not-found.module.css";

export default function ErrorPage({ reset }: { reset: () => void }) {
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <>
      <div className={`${styles.page} page-width`}>
        <section
          className={styles.stage}
          aria-labelledby="error-title"
          role="alert"
        >
          <div className={styles.copy}>
            <h1 id="error-title" ref={titleRef} tabIndex={-1}>
              Something went wrong.
            </h1>
            <p className={styles.description}>
              This page could not finish. Check your wallet before repeating
              a transaction, then try again or return to the project index.
            </p>
            <div className={styles.actions}>
              <button
                className={styles.primaryAction}
                type="button"
                onClick={reset}
              >
                <RotateCcw aria-hidden="true" size={17} />
                Try again
              </button>
              <Link className={styles.secondaryAction} href="/explore">
                Explore projects
                <ArrowRight aria-hidden="true" size={17} />
              </Link>
            </div>
          </div>

          <div className={styles.visual} aria-hidden="true">
            <Image
              className={styles.visualMark}
              src="/brand/loop/programmable-loop-mark-header-warm-ivory-v1-1536.png"
              alt=""
              width={146}
              height={192}
              priority
            />
            <span className={styles.errorSymbol}>!</span>
          </div>
        </section>
      </div>
      <SiteFooter />
    </>
  );
}
