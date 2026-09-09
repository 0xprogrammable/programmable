import { getProductionDeveloperLaunchHistoryBridgeV1 } from "@/lib/server/custom-launch/launch-history-bridge-v1";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;
export async function GET(request: Request, context: { params: Promise<{ launchId: string }> }) {
  return getProductionDeveloperLaunchHistoryBridgeV1().universal(request, (await context.params).launchId);
}
