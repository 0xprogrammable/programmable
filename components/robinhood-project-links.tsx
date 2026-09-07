import { BookOpen, Globe, Link2, Send } from "lucide-react";
import { DiscordBrandIcon, GitHubBrandIcon, XBrandIcon } from "@/components/brand-icons";
import type { RobinhoodCoinPresentation } from "@/lib/robinhood-presentation";
import styles from "./robinhood-project-links.module.css";

export function RobinhoodProjectLinks({ links, name, className = "" }: {
  links: RobinhoodCoinPresentation["links"];
  name: string;
  className?: string;
}) {
  if (links.length === 0) return null;
  return <nav className={`${styles.links} ${className}`} aria-label={`${name} links`}>
    {links.map((link) => <a key={`${link.label}:${link.url}`} href={link.url}
      target="_blank" rel="noopener noreferrer" title={link.label}
      aria-label={`${link.label} (opens in a new tab)`}>
      <ProjectLinkIcon label={link.label} />
    </a>)}
  </nav>;
}

function ProjectLinkIcon({ label }: { label: string }) {
  const platform = label.toLowerCase();
  if (platform === "x" || platform === "twitter") return <XBrandIcon />;
  if (platform === "website") return <Globe aria-hidden="true" size={18} />;
  if (platform === "github") return <GitHubBrandIcon />;
  if (platform === "discord") return <DiscordBrandIcon />;
  if (platform === "telegram") return <Send aria-hidden="true" size={18} />;
  if (platform === "gitbook" || platform === "docs") return <BookOpen aria-hidden="true" size={18} />;
  return <Link2 aria-hidden="true" size={18} />;
}
