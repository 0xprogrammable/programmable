import { getProductionDeveloperApiKeyBridgeV1 } from
  "@/lib/server/custom-launch/api-key-bridge-v1";

export const dynamic = "force-dynamic";
export const maxDuration = 10;
export const runtime = "nodejs";

export async function GET(request: Request) {
  return getProductionDeveloperApiKeyBridgeV1().capabilitiesV2(request);
}
