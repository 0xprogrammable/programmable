import { LAUNCH_PROJECTION_FEED_V1 } from "@/lib/custom-launch/launch-projection-v1";
import { readLaunchContractSetupV1 } from "@/lib/server/custom-launch/launch-contract-setup-v1";
import { launchProjectionSourceV1 } from "@/lib/server/robinhood-index/launch-projection-source";
import { indexStore } from "@/lib/server/robinhood-index/store";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

/** Installed consumer evidence only. Individual launch visibility requires its public route reads. */
export async function GET(request: Request) {
  if (new URL(request.url).search || request.body) return Response.json({ error: "invalid_request" }, { status: 400 });
  const reply = (value: unknown, status: number) => Response.json(value, { status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  const commit = process.env.VERCEL_GIT_COMMIT_SHA;
  const host = process.env.VERCEL_URL;
  const deploymentUrl = host && /^[a-z0-9][a-z0-9.-]*\.vercel\.app$/i.test(host) ? `https://${host}` : null;
  const base = { schemaVersion: "programmable.website-launch-projection-readiness.v1", generatedAt: new Date().toISOString(),
    commit: commit && /^[0-9a-f]{40}$/.test(commit) ? commit : null, deploymentUrl,
    recognizedSources: ["router_v1", "multi_role_v2", "custom_launch_plan_v1"] };
  try {
    launchProjectionSourceV1(AbortSignal.timeout(5000)); // Validate configured independent providers without exposing private RPC URLs.
    const [setup, saved] = await Promise.all([readLaunchContractSetupV1(), indexStore().read()]);
    const lane = saved?.snapshot.launchProjections;
    const installed = Boolean(base.commit && deploymentUrl && lane?.sourceUrl === LAUNCH_PROJECTION_FEED_V1);
    return reply({ ...base, consumerState: installed ? "installed" : "unavailable", manifestDigest: setup.manifestDigest,
      adapter: { sourceUrl: LAUNCH_PROJECTION_FEED_V1, storage: "existing_robinhood_index", readState: lane ? "ready" : "unavailable",
        lastUpdatedAt: lane?.updatedAt ?? null, nextCursor: lane?.nextCursor ?? null, indexedLaunches: lane?.items.length ?? null } }, installed ? 200 : 503);
  } catch {
    return reply({ ...base, consumerState: "unavailable", manifestDigest: null,
      adapter: { sourceUrl: LAUNCH_PROJECTION_FEED_V1, storage: "existing_robinhood_index", readState: "unavailable",
        lastUpdatedAt: null, nextCursor: null, indexedLaunches: null } }, 503);
  }
}
