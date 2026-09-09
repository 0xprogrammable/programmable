import { getProductionDeveloperLaunchHistoryBridgeV1 } from "@/lib/server/custom-launch/launch-history-bridge-v1";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;
export async function GET(request: Request) { return getProductionDeveloperLaunchHistoryBridgeV1().universal(request); }
