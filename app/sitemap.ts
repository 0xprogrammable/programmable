import type { MetadataRoute } from "next";

const SITE_ORIGIN = "https://programmable.market";

const PUBLIC_ROUTES = [
  "",
  "/explore",
  "/launch",
  "/swap",
  "/launch/modules",
  "/developers/modules",
  "/developers/hooks",
  "/developers/api-keys",
  "/privacy",
  "/docs",
  "/docs/economics",
  "/docs/v4-token",
  "/docs/trust",
  "/docs/status",
  "/docs/tokens",
  "/docs/infrastructure",
  "/docs/creators",
  "/docs/creators/launch",
  "/docs/creators/templates",
  "/docs/creators/earnings",
  "/docs/creators/programs",
  "/docs/developers",
  "/docs/developers/custom-launch",
  "/docs/developers/verify",
  "/docs/developers/indexing",
  "/docs/developers/machine-readable",
  "/developer-reference/robinhood-terminal-indexer",
  "/developer-reference/module-mode",
  "/developer-reference/module-mode-indexing",
  "/docs/models/module-mode",
  "/docs/launch-stamps",
  "/docs/models/classic",
  "/docs/models/custom",
  "/developer-reference/stock-paired",
  "/profile",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map((route) => ({
    url: `${SITE_ORIGIN}${route}`,
  }));
}
