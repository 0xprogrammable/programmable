import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import styles from "./token-experience.module.css";

export function TokenDetailShell() {
  return (
    <div className={`${styles.page} page-width`} aria-busy="true">
      <div className={styles.navigationRow}>
        <Link className={styles.back} href="/explore">
          <ArrowLeft aria-hidden="true" size={16} />
          Explore
        </Link>
      </div>

      <div
        className={`${styles.layout} ${styles.classicLayout} ${styles.readOnlyLayout} ${styles.detailSkeleton}`}
        aria-hidden="true"
        data-skeleton-model="neutral"
      >
        <section className={styles.overview}>
          <div className={styles.identity}>
            <div
              className={`${styles.image} ${styles.detailSkeletonArt}`}
              data-skeleton="true"
            />

            <div className={styles.identityCopy}>
              <div className={styles.tokenSymbolRow}>
                <span
                  className={`${styles.detailSkeletonLine} ${styles.detailSkeletonSymbol}`}
                  data-skeleton="true"
                />
              </div>
              <span
                className={`${styles.detailSkeletonLine} ${styles.detailSkeletonName}`}
                data-skeleton="true"
              />
              <div className={styles.addressActions}>
                <span
                  className={`${styles.detailSkeletonLine} ${styles.detailSkeletonAddress}`}
                  data-skeleton="true"
                />
              </div>
            </div>
          </div>

          <div className={styles.marketChart}>
            <div
              className={styles.detailSkeletonChart}
              data-skeleton="true"
            />
            <dl className={styles.metrics} data-count="4">
              {Array.from({ length: 4 }, (_, index) => (
                <div className={styles.metric} key={index}>
                  <dt
                    className={`${styles.detailSkeletonLine} ${styles.detailSkeletonMetricLabel}`}
                    data-skeleton="true"
                  />
                  <dd
                    className={`${styles.detailSkeletonLine} ${styles.detailSkeletonMetricValue}`}
                    data-skeleton="true"
                  />
                </div>
              ))}
            </dl>
          </div>
        </section>


      </div>

      <span className="sr-only" role="status" aria-live="polite">
        Loading token details
      </span>
    </div>
  );
}
