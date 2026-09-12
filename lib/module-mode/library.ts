/** Discovery metadata is reviewed with a module. Categories never grant runtime capabilities. */
export interface ModuleDiscovery {
  category: string;
  tags?: string[];
  author?: `0x${string}`;
}

/** Display data only; runtime admission and configuration stay with the caller. */
export interface ModuleLibraryEntry {
  id: string;
  title: string;
  summary: string;
  status: "available" | "preview";
  discovery?: ModuleDiscovery;
  source?: { sha256: string };
  nativeBinding?: { packageId?: string };
}

export const MODULE_CATEGORIES = [
  { id: "rewards", label: "Rewards", hint: "Buyer rewards, distributions and incentives" },
  { id: "trading", label: "Trading", hint: "Buy limits, opening rules and trade mechanics" },
  { id: "fees", label: "Fees", hint: "Fee schedules, splits and routing" },
  { id: "liquidity", label: "Liquidity", hint: "Pool funding, positions and liquidity rules" },
  { id: "pairs", label: "Pairs", hint: "Quote assets and market variants" },
  { id: "supply", label: "Supply", hint: "Burns, minting and token distribution" },
  { id: "access", label: "Access", hint: "Allow lists, ownership and community controls" },
  { id: "experiments", label: "Experiments", hint: "New mechanics and integrations" },
] as const;
export type ModuleCategoryId = typeof MODULE_CATEGORIES[number]["id"];
export const MODULE_LIBRARY_PAGE_SIZE = 12;

// The first publications predate discovery metadata. These exact package identities preserve their
// immutable reviewed manifests; later publications carry discovery in their own catalog definition.
const STARTER_DISCOVERY: Readonly<Record<string, ModuleDiscovery>> = {
  "0xc282a1952918d927ab564e62260b9c77c55319d7e1a226cc7490bd25fcd825f2": {
    category: "rewards/buyer-rewards", tags: ["ETH", "Every Nth buy", "Budget"],
    author: "0x2bb333d48dfaf1596d9036671d2e43168994249e",
  },
  "0xbb60720f5c3a0d49ed1ab63fa5c92a3db36404362827d4c952b99eca04558a08": {
    category: "trading/opening-limits", tags: ["Buy cap", "Opening window", "Per wallet"],
    author: "0x2bb333d48dfaf1596d9036671d2e43168994249e",
  },
};

export function moduleDiscovery(entry: ModuleLibraryEntry): ModuleDiscovery {
  if (entry.discovery) return entry.discovery;
  const binding = entry.nativeBinding;
  const published = binding?.packageId ? STARTER_DISCOVERY[binding.packageId.toLowerCase()] : undefined;
  if (published) return published;
  if (entry.source?.sha256 === "ea0c547131d6e41878c0f75129db4a242059feda2e121edb8be024108cda9079") return { category: "trading/opening-limits", tags: ["Buy cap", "Opening window"] };
  if (entry.source?.sha256 === "0390c47404c11c9f15a2e6c87c8b8dc8e183623c7134e2903f9103168f6dfc0c") return { category: "rewards/buyer-rewards", tags: ["ETH", "Every Nth buy"] };
  return { category: "experiments" };
}

export function moduleCategory(entry: ModuleLibraryEntry) {
  const parent = moduleDiscovery(entry).category.split("/")[0];
  return MODULE_CATEGORIES.find(category => category.id === parent) ?? MODULE_CATEGORIES[7];
}

export function moduleAuthorLabel(entry: ModuleLibraryEntry) {
  const author = moduleDiscovery(entry).author;
  return author ? `${author.slice(0, 6)}…${author.slice(-4)}` : null;
}

export function searchModuleLibrary<Entry extends ModuleLibraryEntry>(catalog: readonly Entry[], query: string, category: string): Entry[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return catalog.filter(entry => {
    if (category !== "all" && moduleCategory(entry).id !== category) return false;
    const discovery = moduleDiscovery(entry);
    const searchable = [entry.title, entry.summary, entry.id, discovery.author ?? "", discovery.category,
      moduleCategory(entry).label, ...(discovery.tags ?? [])].join(" ").toLocaleLowerCase();
    return words.every(word => searchable.includes(word));
  });
}

export function isModuleDiscovery(value: unknown): value is ModuleDiscovery {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).every(key => ["category", "tags", "author"].includes(key))
    && typeof item.category === "string" && /^[a-z][a-z0-9-]{0,39}(\/[a-z][a-z0-9-]{0,39}){0,2}$/.test(item.category)
    && (item.author === undefined || typeof item.author === "string" && /^0x[0-9a-fA-F]{40}$/.test(item.author) && !/^0x0{40}$/.test(item.author))
    && (item.tags === undefined || Array.isArray(item.tags) && item.tags.length <= 12
      && item.tags.every(tag => typeof tag === "string" && tag.trim().length > 0 && tag.length <= 40));
}
