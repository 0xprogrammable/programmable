export const LAUNCH_SORT_OPTIONS = [
  { value: "highest", label: "Highest market cap" },
  { value: "lowest", label: "Lowest market cap" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
] as const;

export const LAUNCH_MODE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "module", label: "Module" },
  { value: "custom", label: "Custom" },
] as const;

export const ROBINHOOD_EXPLORE_PAGE_SIZE = 10;

export type RobinhoodExploreFilters = {
  sort: typeof LAUNCH_SORT_OPTIONS[number]["value"];
  mode?: typeof LAUNCH_MODE_OPTIONS[number]["value"];
};

export const DEFAULT_EXPLORE_FILTERS: RobinhoodExploreFilters = { sort: "highest", mode: "all" };

export function activeExploreFilterCount(filters: RobinhoodExploreFilters) {
  return Number(filters.sort !== DEFAULT_EXPLORE_FILTERS.sort) + Number((filters.mode ?? "all") !== "all");
}

export type RobinhoodExploreRequest = { page: number; q: string } & RobinhoodExploreFilters;

export function sameRobinhoodExploreRequest(a: RobinhoodExploreRequest | null | undefined, b: RobinhoodExploreRequest) {
  return Boolean(a && a.page === b.page && a.q === b.q && a.sort === b.sort && (a.mode ?? "all") === (b.mode ?? "all"));
}

export function parseRobinhoodExploreQuery(query: URLSearchParams) {
  const page = query.get("page") ?? "1";
  const q = query.get("q") ?? "";
  const sort = query.get("sort") ?? DEFAULT_EXPLORE_FILTERS.sort;
  const mode = query.get("mode") ?? "all";
  const pageSize = query.get("pageSize") ?? "50";
  if ([...query.keys()].some((key) => !["page", "q", "sort", "mode", "pageSize"].includes(key) || query.getAll(key).length !== 1)
    || !/^[1-9]\d{0,5}$/.test(page) || q.length > 128
    || !LAUNCH_SORT_OPTIONS.some((option) => option.value === sort)
    || !LAUNCH_MODE_OPTIONS.some((option) => option.value === mode)
    || !["10", "50"].includes(pageSize)) return null;
  return { page: Number(page), pageSize: Number(pageSize) as 10 | 50, q, filters: { sort, mode } as RobinhoodExploreFilters };
}
