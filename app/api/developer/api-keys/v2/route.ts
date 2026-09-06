import { getProductionDeveloperApiKeyBridgeV1 } from
  "@/lib/server/custom-launch/api-key-bridge-v1";

export const dynamic = "force-dynamic";
export const maxDuration = 10;
export const runtime = "nodejs";

export async function POST(request: Request) {
  return getProductionDeveloperApiKeyBridgeV1().createV2(request);
}

export async function GET(request: Request) {
  return getProductionDeveloperApiKeyBridgeV1().listV2(request);
}
