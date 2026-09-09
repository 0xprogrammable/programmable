import { getProductionDeveloperLaunchHistoryBridgeV1 } from "@/lib/server/custom-launch/launch-history-bridge-v1";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ launchId: string }> }) {
  return getProductionDeveloperLaunchHistoryBridgeV1().universal(request, (await context.params).launchId, undefined, true);
}
