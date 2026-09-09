import { getProductionModuleSubmissionProfileBridge, moduleSubmissionProfileError } from "@/lib/server/module-mode/submission-profile-bridge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(request: Request) {
  try {
    return await getProductionModuleSubmissionProfileBridge().list(request);
  } catch {
    return moduleSubmissionProfileError(503, "module_submissions_unavailable");
  }
}
