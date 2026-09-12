import Image from "next/image";
import Link from "next/link";

import styles from "@/components/site-footer.module.css";

const productLinks = [
  { href: "/explore", label: "Explore" },
  { href: "/swap", label: "Swap" },
  { href: "/launch", label: "Launch" },
  { href: "/launch/modules", label: "Modules" },
  { href: "/developers/api-keys", label: "API keys" },
  { href: "/profile", label: "Profile" },
  { href: "/docs", label: "Docs" },
];

const resourceLinks = [
  { href: "/developers/modules", label: "Build a module" },
  { href: "/developers/hooks", label: "Build a custom hook" },
  {
    href: "/analytics",
    label: "Analytics",
  },
  {
    href: "https://github.com/programmablehq",
    label: "GitHub",
    external: true,
  },
  {
    href: "https://dexscreener.com/robinhood/0x3df16f271060e4941c0386047def159f42e629dc0455db623c5b363eeacbcc1d",
    label: "DEX Screener",
    external: true,
  },
  {
    href: "https://discord.com/invite/programmable",
    label: "Discord",
    external: true,
  },
  {
    href: "https://x.com/ProgrammableHQ",
    label: "X",
    external: true,
  },
];

const informationLinks = [
  { href: "/privacy", label: "Privacy & settings" },
  { href: "/agents.md", label: "Agent guide" },
];

export function SiteFooter() {
  return (
    <footer
      className={`${styles.footer} page-width`}
      data-site-footer
      aria-label="Site footer"
    >
      <div className={styles.surface}>
        <section className={styles.brand}>
          <Link
            className={styles.brandLink}
            href="/"
            prefetch={false}
            aria-label="Programmable home"
          >
            <Image
              className={styles.mark}
              src="/brand/loop/programmable-loop-mark-header-warm-ivory-v1-1536.png"
              alt=""
              width={1168}
              height={1536}
              sizes="38px"
            />
            <span>Programmable</span>
          </Link>
          <p className={styles.copyright}>© 2026 Programmable</p>
        </section>

        <nav className={styles.column} aria-label="Product">
          <h2 className={styles.label}>Product</h2>
          <ul>
            {productLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href} prefetch={false}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav className={styles.column} aria-label="Resources">
          <h2 className={styles.label}>Resources</h2>
          <ul>
            {resourceLinks.map((link) => (
              <li key={link.href}>
                {link.external ? (
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${link.label} (opens in a new tab)`}
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link href={link.href} prefetch={false}>
                    {link.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </nav>

        <section className={styles.risk}>
          <h2 className={styles.label}>Risk notice</h2>
          <p>
            Transactions are irreversible. Tokens may lose all value or be
            difficult to sell. No financial advice or guarantees.
          </p>
          <nav className={styles.informationLinks} aria-label="Site information">
            {informationLinks.map((link) => (
              <Link key={link.href} href={link.href} prefetch={false}>
                {link.label}
              </Link>
            ))}
          </nav>
        </section>
      </div>
    </footer>
  );
}
