import type { RobinhoodExploreFilters } from "./robinhood-explore-filters";

export const ETHEREUM_EXPLORE_FILTERS: RobinhoodExploreFilters = { sort: "newest", mode: "all" };
export const ETHEREUM_EXPLORE_MODES = [
  { value: "all", label: "All" },
  { value: "classic", label: "Classic" },
  { value: "custom", label: "Custom" },
] as const;

export function parseEthereumExploreQuery(query: URLSearchParams) {
  const page = query.get("page") ?? "1";
  const pageSize = query.get("pageSize") ?? "10";
  const q = query.get("q") ?? "";
  const sort = query.get("sort") ?? "newest";
  const mode = query.get("mode") ?? "all";
  if ([...query.keys()].some(key => !["page", "pageSize", "q", "sort", "mode"].includes(key) || query.getAll(key).length !== 1)
    || !/^[1-9]\d{0,5}$/.test(page) || !["10", "50"].includes(pageSize) || q.length > 128
    || !["newest", "oldest"].includes(sort) || !ETHEREUM_EXPLORE_MODES.some(option => option.value === mode)) return null;
  return { page: Number(page), pageSize: Number(pageSize) as 10 | 50, q,
    filters: { sort, mode } as RobinhoodExploreFilters };
}
