import type { Hex } from "viem";
import { moduleModeReleaseQuery } from "@/lib/module-mode/release-selection";
import { parseModuleEngineAvailability, type ModuleEngineAvailability } from "./catalog";
import type { PreparedModuleEngineTransaction } from "./client";
import { ANY_QUOTE_INFRASTRUCTURE } from "./any-quote/types";
import { isModuleEngineSharedQuoteRelease } from "./profile";

/** The normal Module Mode endpoint selects the exact source authority; URLs never supply authority. */
export async function fetchModuleEngineAvailability(releaseDigest?: Hex, signal?: AbortSignal): Promise<ModuleEngineAvailability> {
  const response = await fetch(`/api/module-mode${moduleModeReleaseQuery({ sourceKind: "module-engine-v1", releaseDigest })}`, {
    cache: "no-store", credentials: "same-origin", redirect: "error", signal,
  });
  if ((response.status !== 200 && response.status !== 503) || response.redirected
    || response.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") {
    throw new Error("This template version could not be checked. Your draft is kept.");
  }
  const availability = parseModuleEngineAvailability(await response.json());
  if (releaseDigest && availability.release && availability.release.releaseDigest !== releaseDigest) {
    throw new Error("The requested template version could not be verified.");
  }
  if (response.status === 503 && availability.release) throw new Error("Template availability could not be verified.");
  return availability;
}

/** Refresh publication authority immediately before the existing wallet provider revalidates the call. */
export function assertModuleEngineOperationAvailability(prepared: PreparedModuleEngineTransaction,
  previous: ModuleEngineAvailability, current: ModuleEngineAvailability): void {
  const before = parseModuleEngineAvailability(previous), latest = parseModuleEngineAvailability(current);
  if (!before.release || !latest.release || before.release.releaseDigest !== prepared.releaseDigest
    || latest.release.releaseDigest !== prepared.releaseDigest) throw new Error("The template version changed. Review the transaction again.");
  if (prepared.kind === "approve") {
    const release = latest.release, shared = isModuleEngineSharedQuoteRelease(release);
    const spender = shared ? ANY_QUOTE_INFRASTRUCTURE.permit2 : release.contracts.host.address;
    // ERC20 approvals fund Permit2 itself; only Permit2 allowances name the reviewed router.
    const routerAvailable = prepared.allowanceKind === "permit2"
      ? shared && prepared.permit2Spender?.toLowerCase() === release.contracts.universalRouter.address.toLowerCase()
      : prepared.permit2Spender === undefined;
    if (prepared.spender.toLowerCase() !== spender.toLowerCase() || !routerAvailable || latest.templates.length === 0) {
      throw new Error("The approved funding contract is no longer available.");
    }
    return;
  }
  const original = before.templates.find(item => item.manifest.manifest.revision.packageId === prepared.revisionId);
  const published = latest.templates.find(item => item.manifest.manifest.revision.packageId === prepared.revisionId);
  if (!original || !published || original.manifestHash !== published.manifestHash || original.reviewDigest !== published.reviewDigest) {
    throw new Error("The selected template changed. Review its current settings before continuing.");
  }
}
