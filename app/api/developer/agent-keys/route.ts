import { getProductionDeveloperApiKeyBridgeV1 } from "@/lib/server/custom-launch/api-key-bridge-v1";
export const dynamic = "force-dynamic";
export const maxDuration = 10;
export const runtime = "nodejs";
export async function POST(request: Request) {
  return getProductionDeveloperApiKeyBridgeV1().createAgent(request);
}
