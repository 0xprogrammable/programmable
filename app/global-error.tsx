"use client";

import styles from "@/app/error-boundary.module.css";

type GlobalErrorProps = Readonly<{
  error: Error & { digest?: string };
  unstable_retry: () => void;
}>;

export default function GlobalError({
  error,
  unstable_retry,
}: GlobalErrorProps) {
  return (
    <html lang="en" data-theme="dark">
      <body className={styles.globalBody}>
        <main
          className={styles.globalPage}
          aria-labelledby="global-error-title"
        >
          <div className={styles.stage}>
            <div
              className={styles.message}
              role="alert"
              aria-describedby="global-error-description"
            >
              <h1 id="global-error-title">Programmable could not load.</h1>
              <p className={styles.description} id="global-error-description">
                Try again or reload the page.
              </p>
            </div>

            <p className={styles.guidance}>
              If you just sent a transaction, check your wallet before
              repeating it.
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
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- The failed root layout may not provide a functioning client router. */}
              <a className={styles.textAction} href="/">Go home</a>
            </div>

            {error.digest ? (
              <p className={styles.reference}>
                Error reference <code>{error.digest}</code>
              </p>
            ) : null}
          </div>
        </main>
      </body>
    </html>
  );
}
