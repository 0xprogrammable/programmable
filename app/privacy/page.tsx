import type { Metadata } from "next";
import Link from "next/link";

import styles from "@/app/privacy/privacy.module.css";

export const metadata: Metadata = {
  title: "Privacy & settings · Programmable",
  description: "How your account, browser preferences and submissions work, and where to manage them.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <div className={`${styles.page} page-width`}>
      <header className={styles.header}>
        <h1>Privacy &amp; settings</h1>
        <p>Your account, the data you share and the settings you control.</p>
        <div className={styles.actions}>
          <Link className={styles.primaryAction} href="/profile">Open profile</Link>
          <Link className={styles.secondaryAction} href="/developers/api-keys">Manage API keys</Link>
        </div>
      </header>

      <div className={styles.sections}>
        <section className={styles.section} aria-labelledby="privacy-account">
          <h2 id="privacy-account">Your account</h2>
          <div>
            <p>
              Programmable uses Privy for wallet, email and GitHub sign in.
              Your account and connected wallets determine which API keys,
              launches and submissions you can manage.
            </p>
            <p>
              To sign out, open your wallet at the top of the page and choose
              Disconnect. Signing out does not revoke API keys. Manage them on the{" "}
              <Link href="/developers/api-keys">API keys page</Link>.
            </p>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="privacy-browser">
          <h2 id="privacy-browser">Cookies &amp; browser data</h2>
          <div>
            <p>
              This site saves your selected Explore network in a cookie and
              browser storage. It also saves session hints and local profile
              details so they remain available when you return.
            </p>
            <p>
              You can clear this site&apos;s cookies and storage in your browser
              settings. This removes local preferences and may sign you out.
              Submitted modules, API keys and blockchain records remain.
            </p>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="privacy-submissions">
          <h2 id="privacy-submissions">What you share</h2>
          <div>
            <p>
              Module submissions include your source package, author wallet and
              reward wallet. The platform stores the package and review record.
              Sign in with the author wallet to see progress in{" "}
              <Link href="/profile?section=submissions">your submissions</Link>.
              A different reward wallet does not change the author.
            </p>
            <p>
              Transactions, token metadata and published catalog entries are
              public. Keep passwords, API keys and personal documents out of
              source packages and public descriptions.
            </p>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="privacy-services">
          <h2 id="privacy-services">Connected services</h2>
          <div>
            <p>
              Vercel serves this website. Privy provides sign in and wallet
              connection. Their notices explain how they handle data when you
              use these services.
            </p>
            <div className={styles.serviceLinks}>
              <a href="https://www.privy.io/privacy-policy" target="_blank" rel="noreferrer">
                Privy privacy policy <span aria-hidden="true">↗</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              <a href="https://vercel.com/legal/privacy-notice" target="_blank" rel="noreferrer">
                Vercel privacy notice <span aria-hidden="true">↗</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
