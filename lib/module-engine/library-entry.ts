import type { ModuleEngineCatalogDefinition } from "./catalog";
import type { ModuleLibraryEntry } from "@/lib/module-mode/library";

/** Presentation only: the engine's reviewed manifest still owns launch eligibility. */
export function anyQuoteLibraryEntry(definition: ModuleEngineCatalogDefinition): ModuleLibraryEntry {
  return {
    id: definition.id,
    title: "Any Quote LP",
    summary: "Pair your coin with another token. Buy and sell with ETH.",
    status: "available",
    discovery: { category: "pairs", tags: ["liquidity", "pair", "ERC-20", "ETH"] },
    source: definition.source,
  };
}
