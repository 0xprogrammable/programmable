import "server-only";

import { readWebsiteRouterCustomIdentitySnapshotV1 } from "@/lib/alchemy/router-custom-public.server";
import { readEnvioClassicV3CatalogV1 } from "@/lib/market-data/envio-classic-v3-catalog.server";
import { publicExploreCatalogEntriesV1, publicExplorePresentationEntryV1 } from "@/lib/public-explore-catalog-v1";
import { isPublicExploreIdentityV1 } from "@/lib/explore-public-visibility";
import { ETHEREUM_EXPLORE_FILTERS } from "@/lib/ethereum-explore";
import type { CanonicalTokenExploreEntry } from "@/lib/tokens";

type SourceStatus = "current" | "last-known-good" | "unavailable";
type SourceEvidence = {
  source: "envio-classic-v3" | "canonical-launch-stamp-router";
  asOfBlock: string;
  asOfBlockHash: string;
  commitment: string;
  generatedAt: string;
  deployment?: string;
  sourceCommit?: string;
};
type CatalogSource = { entries: readonly CanonicalTokenExploreEntry[]; status: Exclude<SourceStatus, "unavailable">; generatedAt: string; evidence?: SourceEvidence };
type Dependencies = {
  classic: () => Promise<CatalogSource>;
  custom: () => Promise<CatalogSource>;
};
const readers: Dependencies = {
  classic: async () => {
    const catalog = await readEnvioClassicV3CatalogV1();
    return { ...catalog, entries: catalog.entries.filter((entry): entry is CanonicalTokenExploreEntry => entry.exploreKind === "token"),
      evidence: { source: catalog.source, asOfBlock: catalog.asOfBlock, asOfBlockHash: catalog.asOfBlockHash,
        commitment: catalog.evidence.commitment, generatedAt: catalog.generatedAt, deployment: catalog.evidence.deployment, sourceCommit: catalog.evidence.sourceCommit } };
  },
  custom: async () => {
    const catalog = await readWebsiteRouterCustomIdentitySnapshotV1();
    return { ...catalog, evidence: { source: catalog.source, asOfBlock: catalog.asOfBlock,
      asOfBlockHash: catalog.asOfBlockHash, commitment: catalog.identityCommitment, generatedAt: catalog.generatedAt } };
  },
};

/** Each source retains its existing release, provenance and finality checks. */
export async function readEthereumExploreCatalog(dependencies: Dependencies = readers) {
  const [classic, custom] = await Promise.allSettled([dependencies.classic(), dependencies.custom()]);
  const sources: { classic: SourceStatus; custom: SourceStatus } = {
    classic: classic.status === "fulfilled" ? classic.value.status : "unavailable",
    custom: custom.status === "fulfilled" ? custom.value.status : "unavailable",
  };
  const accepted = [classic, custom].flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  const entries = accepted.flatMap(source => source.entries).map(publicExplorePresentationEntryV1);
  const identities = new Set<string>();
  for (const entry of entries) {
    const identity = entry.tokenAddress.toLowerCase();
    if (identities.has(identity)) throw new Error("Conflicting Ethereum launch identities");
    identities.add(identity);
  }
  const status = accepted.length === 0 ? "unavailable" as const
    : accepted.length !== 2 ? "partial" as const
      : accepted.some(source => source.status !== "current") ? "stale" as const : "ready" as const;
  const updatedAt = accepted.map(source => source.generatedAt).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
  const sourceEvidence = { classic: classic.status === "fulfilled" ? classic.value.evidence ?? null : null,
    custom: custom.status === "fulfilled" ? custom.value.evidence ?? null : null };
  return { chainId: 1 as const, status, sources, sourceEvidence, updatedAt, entries };
}

export async function readEthereumLaunches(page = 1, query = "", filters = ETHEREUM_EXPLORE_FILTERS, pageSize: 10 | 50 = 10, dependencies?: Dependencies) {
  const catalog = await readEthereumExploreCatalog(dependencies);
  const q = query.normalize("NFC").trim().replace(/^\$/, "").toLowerCase();
  const visible = publicExploreCatalogEntriesV1(catalog.entries).filter((entry): entry is CanonicalTokenExploreEntry => entry.exploreKind === "token" && isPublicExploreIdentityV1(entry));
  const filtered = visible.filter(entry => (filters.mode === undefined || filters.mode === "all" || entry.launchCategoryProvenance.category === filters.mode)
    && (!q || [entry.name, entry.symbol, entry.tokenAddress].some(value => value?.normalize("NFC").toLowerCase().includes(q))));
  filtered.sort((a, b) => {
    const left = BigInt(a.launchBlockNumber ?? "0");
    const right = BigInt(b.launchBlockNumber ?? "0");
    const difference = left === right ? (a.launchLogIndex ?? 0) - (b.launchLogIndex ?? 0) : left > right ? 1 : -1;
    return (filters.sort === "oldest" ? difference : -difference) || a.tokenAddress.localeCompare(b.tokenAddress);
  });
  const totalPages = Math.ceil(filtered.length / pageSize);
  const number = Math.min(Math.max(1, page), Math.max(1, totalPages));
  const selected = filtered.slice((number - 1) * pageSize, number * pageSize);
  return {
    chainId: catalog.chainId, status: catalog.status, sources: catalog.sources, sourceEvidence: catalog.sourceEvidence, updatedAt: catalog.updatedAt,
    items: selected.map(entry => ({
      launchId: entry.launchStampProvenance?.launchId ?? entry.id,
      tokenAddress: entry.tokenAddress, hookAddress: entry.hookAddress, creator: entry.creatorAddress,
      transactionHash: entry.launchTransactionHash, blockNumber: entry.launchBlockNumber,
      launchedAt: entry.launchedAt, name: entry.name, symbol: entry.symbol, decimals: entry.tokenDecimals ?? null,
      category: entry.launchCategoryProvenance.category,
      provenance: entry.launchCategoryProvenance,
    })),
    presentations: selected.map(entry => ({ tokenAddress: entry.tokenAddress, imageUrl: entry.imageUrl ?? null,
      description: entry.description ?? null, links: (entry.links ?? []).map(link => ({ label: link.kind, url: link.url })), market: null })),
    page: { number, size: pageSize, totalItems: filtered.length, totalPages, hasMore: number < totalPages },
  };
}

export async function readEthereumToken(address: string) {
  try {
    const catalog = await readEthereumExploreCatalog();
    return { chainId: catalog.chainId, status: catalog.status, sources: catalog.sources, updatedAt: catalog.updatedAt,
      token: catalog.entries.find(entry => entry.tokenAddress.toLowerCase() === address.toLowerCase()) ?? null };
  } catch {
    return { chainId: 1 as const, status: "unavailable" as const, updatedAt: null, token: null };
  }
}
