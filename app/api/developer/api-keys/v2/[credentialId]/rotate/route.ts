import { getProductionDeveloperApiKeyBridgeV1 } from
  "@/lib/server/custom-launch/api-key-bridge-v1";

export const dynamic = "force-dynamic";
export const maxDuration = 10;
export const runtime = "nodejs";

type RouteContext = Readonly<{
  params: Promise<Readonly<{ credentialId: string }>>;
}>;

export async function POST(request: Request, context: RouteContext) {
  const { credentialId } = await context.params;
  return getProductionDeveloperApiKeyBridgeV1().rotateV2(request, credentialId);
}
