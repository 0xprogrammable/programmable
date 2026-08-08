import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";

import { SiteFooter } from "@/components/site-footer";
import styles from "@/app/not-found.module.css";

export default function NotFound() {
  return (
    <>
      <div className={`${styles.page} page-width`}>
        <section className={styles.stage} aria-labelledby="not-found-title">
          <div className={styles.copy}>
            <h1 id="not-found-title">This page isn’t available.</h1>
            <p className={styles.description}>
              The link may have moved. Explore current projects or return to the
              documentation.
            </p>
            <div className={styles.actions}>
              <Link className={styles.primaryAction} href="/explore">
                Explore projects
                <ArrowRight aria-hidden="true" size={17} />
              </Link>
              <Link className={styles.secondaryAction} href="/docs/developers">
                <BookOpen aria-hidden="true" size={17} />
                Open docs
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
            <span className={styles.code}>404</span>
          </div>
        </section>
      </div>
      <SiteFooter />
    </>
  );
}
