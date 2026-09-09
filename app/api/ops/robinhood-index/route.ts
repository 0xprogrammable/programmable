import { timingSafeEqual } from "node:crypto";
import { robinhoodSource } from "@/lib/server/robinhood-index/source";
import { indexStore } from "@/lib/server/robinhood-index/store";
import { configuredModuleModeSources, type ModuleModeUnavailableSource } from "@/lib/server/robinhood-index/module-source";
import { moduleModeSnapshots } from "@/lib/server/robinhood-index/model";
import { syncRobinhoodIndex, syncModuleModeIndex } from "@/lib/server/robinhood-index/sync";
import { launchProjectionSourceV1, syncLaunchProjectionIndex } from "@/lib/server/robinhood-index/launch-projection-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
type ModuleLaneResult = Awaited<ReturnType<typeof syncModuleModeIndex>> | { status: "disabled" | "unavailable" };

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  const actual = request.headers.get("authorization");
  const authorized = expected && expected.length >= 32 && expected.length <= 1024 && actual
    && Buffer.byteLength(actual) === Buffer.byteLength(`Bearer ${expected}`)
    && timingSafeEqual(Buffer.from(actual), Buffer.from(`Bearer ${expected}`));
  const reply = (body: unknown, status: number) => Response.json(body, { status, headers: {
    "cache-control": "no-store", "x-content-type-options": "nosniff",
  } });
  if (!authorized) return reply({ error: "unauthorized" }, 401);
  if (new URL(request.url).search || request.body) return reply({ error: "invalid_request" }, 400);
  const startedAt = Date.now();
  try {
    const store = indexStore();
    let result: Awaited<ReturnType<typeof syncRobinhoodIndex>> | null = null;
    try { result = await syncRobinhoodIndex(await robinhoodSource(), store); }
    catch { /* A failed Custom source must not suppress independent Module Mode verification. */ }
    let launchProjections: Awaited<ReturnType<typeof syncLaunchProjectionIndex>> | { status: "unavailable" } = { status: "unavailable" };
    const projectionBudget = Math.min(45000, Math.max(1, 165000 - (Date.now() - startedAt)));
    try { launchProjections = await syncLaunchProjectionIndex(launchProjectionSourceV1(AbortSignal.timeout(projectionBudget)), store); }
    catch { /* Keep the previous verified rows and retry this source on the next scheduled pass. */ }
    // Keep a genuine rollup proof inside the job's wall-clock budget. A deadline is an error,
    // never permission to publish a partial proof or skip the final canonical checkpoint read.
    const remaining = 165_000 - (Date.now() - startedAt);
    let moduleMode: ModuleLaneResult = { status: "unavailable" };
    const moduleSources: Record<string, ModuleLaneResult> = {};
    let moduleUnavailableSources: readonly ModuleModeUnavailableSource[] = [];
    if (remaining > 0) {
      try {
        const inventory = await configuredModuleModeSources(undefined, AbortSignal.timeout(remaining));
        const { lanes } = inventory;
        moduleUnavailableSources = inventory.unavailableSources;
        const primary = lanes[0]?.releaseDigest;
        // A slow or failed generation must not permanently starve later sources. Use the existing
        // checkpoint timestamps for scheduling; CAS still fences every shared-envelope write.
        const saved = await store.read();
        const ages = new Map(moduleModeSnapshots(saved?.snapshot ?? null).map(source => [source.releaseDigest.toLowerCase(), Date.parse(source.updatedAt)]));
        for (const digest of ages.keys()) {
          if (!lanes.some(lane => lane.releaseDigest.toLowerCase() === digest)) moduleSources[digest] = { status: "unavailable" };
        }
        const ordered = [...lanes].sort((a, b) => (ages.get(a.releaseDigest.toLowerCase()) ?? 0) - (ages.get(b.releaseDigest.toLowerCase()) ?? 0));
        for (const [index, lane] of ordered.entries()) {
          moduleSources[lane.releaseDigest] = { status: "unavailable" };
          const budget = 165_000 - (Date.now() - startedAt);
          if (budget <= 0) continue;
          try {
            const source = await lane.source(AbortSignal.timeout(Math.max(1, Math.floor(budget / (ordered.length - index)))));
            moduleSources[lane.releaseDigest] = await syncModuleModeIndex(source, store, {
              budgetMs: Math.max(0, Math.min(90_000, (165_000 - (Date.now() - startedAt)) / (ordered.length - index))),
            });
          } catch { /* Keep other generations and this source's previous verified checkpoint. */ }
        }
        moduleMode = primary ? moduleSources[primary] : { status: "disabled" };
      } catch { /* Preserve each lane's last verified state; never report a failed source as an empty success. */ }
    }
    const failed = result === null || result.status === "partial" || launchProjections.status === "unavailable" || launchProjections.status === "partial" || moduleMode.status === "partial" || moduleMode.status === "unavailable"
      || moduleUnavailableSources.length > 0 || Object.values(moduleSources).some(source => source.status === "partial" || source.status === "unavailable");
    return reply({ ...(result ?? { error: "index_update_unavailable" }),
      custom: result ?? { status: "unavailable" }, launchProjections, moduleMode, moduleSources, moduleUnavailableSources }, failed ? 503 : 200);
  } catch { return reply({ error: "index_update_unavailable" }, 503); }
}
