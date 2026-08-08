import { handleProductionGitHubSessionAuthorityV1 } from
  "@/lib/server/custom-launch/github-session-authority-v1";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleProductionGitHubSessionAuthorityV1(request);
}
