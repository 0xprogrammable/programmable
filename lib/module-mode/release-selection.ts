import type { Hex } from "viem";
import { isRobinhoodModuleLaunch, type RobinhoodLaunch } from "@/lib/robinhood-launches";

export interface ModuleModeReleaseSelection { releaseDigest?: Hex; sourceKind?: "module-engine-v1" }
export interface ModuleModeLaunchVersion extends ModuleModeReleaseSelection { releaseDigest: Hex; label: string }

/** Selectors only choose an authority reader. They never authenticate a release or transaction. */
export function parseModuleModeReleaseSelection(query: URLSearchParams): ModuleModeReleaseSelection {
  const releaseDigest = query.get("releaseDigest") ?? undefined;
  const sourceKind = query.get("sourceKind") ?? undefined;
  if ([...query.keys()].some(key => key !== "releaseDigest" && key !== "sourceKind")
    || query.getAll("releaseDigest").length > 1 || query.getAll("sourceKind").length > 1
    || (releaseDigest !== undefined && !/^0x(?!0{64}$)[0-9a-f]{64}$/u.test(releaseDigest))
    || (sourceKind !== undefined && sourceKind !== "module-engine-v1")) throw new Error("Invalid Module Mode release selection.");
  return { ...(releaseDigest ? { releaseDigest: releaseDigest as Hex } : {}), ...(sourceKind ? { sourceKind } : {}) };
}

export function moduleModeReleaseQuery(selection: ModuleModeReleaseSelection): string {
  const query = new URLSearchParams(Object.entries(selection).filter((entry): entry is [string, string] => entry[1] !== undefined));
  parseModuleModeReleaseSelection(query);
  return query.size ? `?${query}` : "";
}

export function parseModuleModePageSelection(value: Record<string, string | string[] | undefined>): ModuleModeReleaseSelection {
  const query = new URLSearchParams();
  for (const [key, entry] of Object.entries(value)) for (const item of Array.isArray(entry) ? entry : entry === undefined ? [] : [entry]) query.append(key, item);
  return parseModuleModeReleaseSelection(query);
}

/** A saved canonical coin identity wins over a URL hint. Unknown coins still require onchain binding. */
export function moduleModeCoinReleaseSelection(selection: ModuleModeReleaseSelection, indexed: RobinhoodLaunch | null): ModuleModeReleaseSelection {
  if (!indexed) return selection;
  if (!isRobinhoodModuleLaunch(indexed) || selection.sourceKind
    || (selection.releaseDigest && selection.releaseDigest !== indexed.sourceReleaseDigest.toLowerCase())) throw new Error("Coin and release selection differ.");
  return { releaseDigest: indexed.sourceReleaseDigest.toLowerCase() as Hex };
}
