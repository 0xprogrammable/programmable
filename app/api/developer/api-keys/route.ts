import { getProductionDeveloperApiKeyBridgeV1 } from
  "@/lib/server/custom-launch/api-key-bridge-v1";

export const dynamic = "force-dynamic";
// Module issuance rechecks readiness before its separate mutation request.
export const maxDuration = 20;
export const runtime = "nodejs";

export async function GET(request: Request) {
  return getProductionDeveloperApiKeyBridgeV1().list(request);
}

export async function POST(request: Request) {
  return getProductionDeveloperApiKeyBridgeV1().create(request);
}
