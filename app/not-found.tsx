import Link from "next/link";
import { ArrowRight } from "lucide-react";

import styles from "@/app/not-found.module.css";

export default function NotFound() {
  return (
    <div className={`${styles.page} page-width`}>
      <section className={styles.stage} aria-labelledby="not-found-title">
        <div className={styles.copy}>
          <h1 id="not-found-title">Page not found.</h1>
          <p className={styles.description}>
            This link may have changed. Head back home or explore the latest coins.
          </p>
          <div className={styles.actions}>
            <Link className={styles.primaryAction} href="/explore">
              Explore tokens
              <ArrowRight aria-hidden="true" size={17} />
            </Link>
            <Link className={styles.secondaryAction} href="/">
              Go home
            </Link>
          </div>
        </div>

        <p className={styles.code} aria-hidden="true">
          404
        </p>
      </section>
    </div>
  );
}
