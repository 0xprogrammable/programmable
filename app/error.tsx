"use client";

import styles from "@/app/error-boundary.module.css";

type ErrorPageProps = Readonly<{
  error: Error & { digest?: string };
  unstable_retry: () => void;
}>;

export default function ErrorPage({ error, unstable_retry }: ErrorPageProps) {
  return (
    <section
      className={`${styles.page} page-width`}
      aria-labelledby="page-error-title"
    >
      <div className={styles.stage}>
        <div
          className={styles.message}
          role="alert"
          aria-describedby="page-error-description"
        >
          <h1 id="page-error-title">This page could not load.</h1>
          <p className={styles.description} id="page-error-description">
            Try again or reload the page.
          </p>
        </div>

        <p className={styles.guidance}>
          If you just sent a transaction, check your wallet and launch history
          before repeating it.
        </p>

        <div className={styles.actions}>
          <button
            className={styles.primaryAction}
            type="button"
            onClick={unstable_retry}
          >
            Try again
          </button>
          <button
            className={styles.secondaryAction}
            type="button"
            onClick={() => window.location.reload()}
          >
            Reload site
          </button>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Recover with a document navigation if the client router has failed. */}
          <a className={styles.textAction} href="/">Go home</a>
        </div>

        {error.digest ? (
          <p className={styles.reference}>
            Error reference <code>{error.digest}</code>
          </p>
        ) : null}
      </div>
    </section>
  );
}
