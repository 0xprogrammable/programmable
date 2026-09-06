import { timingSafeEqual } from "node:crypto";
import { robinhoodSource } from "@/lib/server/robinhood-index/source";
import { indexStore } from "@/lib/server/robinhood-index/store";
import { configuredModuleModeSource } from "@/lib/server/robinhood-index/module-source";
import { syncRobinhoodIndex, syncModuleModeIndex } from "@/lib/server/robinhood-index/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

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
    // Keep a genuine rollup proof inside the job's wall-clock budget. A deadline is an error,
    // never permission to publish a partial proof or skip the final canonical checkpoint read.
    const remaining = 165_000 - (Date.now() - startedAt);
    let moduleMode: Awaited<ReturnType<typeof syncModuleModeIndex>> | { status: "disabled" | "unavailable" } = { status: "unavailable" };
    if (remaining > 0) {
      try {
        const moduleSource = await configuredModuleModeSource(undefined, AbortSignal.timeout(remaining));
        moduleMode = moduleSource ? await syncModuleModeIndex(moduleSource, store, {
          budgetMs: Math.max(0, Math.min(90_000, 165_000 - (Date.now() - startedAt))),
        }) : { status: "disabled" };
      } catch { /* Preserve each lane's last verified state; never report a failed source as an empty success. */ }
    }
    const failed = result === null || result.status === "partial" || moduleMode.status === "partial" || moduleMode.status === "unavailable";
    return reply({ ...(result ?? { error: "index_update_unavailable" }),
      custom: result ?? { status: "unavailable" }, moduleMode }, failed ? 503 : 200);
  } catch { return reply({ error: "index_update_unavailable" }, 503); }
}
