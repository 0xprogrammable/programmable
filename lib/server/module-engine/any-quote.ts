import "server-only";
import type { Hex } from "viem";
import { moduleHash } from "@/lib/module-mode/release";
import { bindActiveModuleEngineRelease, moduleEngineReleaseIdentity } from "@/lib/module-engine/catalog";
import { assertModuleEngineRelease } from "@/lib/module-engine/client";
import { isModuleEngineSharedQuoteRelease, isModuleEngineAnyQuoteEthRelease } from "@/lib/module-engine/profile";
import { anyQuoteLaunchIntent } from "@/lib/module-engine/any-quote/integration";
import { assessAnyQuoteAssetV1 } from "@/lib/module-engine/any-quote/readiness.server";
import { AnyQuoteErrorV1 } from "@/lib/module-engine/any-quote/types";
import { anyQuoteNativeFeeRouteFromExternal } from "@/lib/module-engine/any-quote/native-fee-route";
import { readModuleEngineAvailability } from "./catalog";
import { anyQuotePreparationClientV1, anyQuotePreparationOptionsV1, readAnyQuoteIdentityLaunchPreviewV1, readAnyQuoteIdentityTradeQuoteV1,
  type AnyQuoteIdentityPreparationDependenciesV1, type AnyQuoteLaunchPreviewInput, type AnyQuoteTradeQuoteInputV1 } from "./any-quote-preparation";

export type { AnyQuoteLaunchPreviewInput } from "./any-quote-preparation";
type Selection = { releaseDigest: Hex; templateId: string };
export interface AnyQuoteIntegrationDependencies extends AnyQuoteIdentityPreparationDependenciesV1 { availability?: typeof readModuleEngineAvailability }
async function selection(input: Selection, deps: AnyQuoteIntegrationDependencies) {
  const digest = moduleHash(input.releaseDigest, "releaseDigest"), availability = await (deps.availability ?? readModuleEngineAvailability)(digest);
  if (!availability.release) throw new AnyQuoteErrorV1("MODULE_UNAVAILABLE");
  const release = bindActiveModuleEngineRelease(availability.release);
  if (release.releaseDigest !== digest || !isModuleEngineSharedQuoteRelease(release)) throw new AnyQuoteErrorV1("MODULE_UNAVAILABLE");
  const template = availability.templates.find(t => t.manifest.manifest.catalogDefinition.id === input.templateId);
  if (!template || template.manifest.manifest.catalogDefinition.interface !== "quote-shared-v1") throw new AnyQuoteErrorV1("MODULE_UNAVAILABLE");
  return { release, template };
}
export async function readAnyQuoteReadiness(input: Selection & { quoteAsset: string }, deps: AnyQuoteIntegrationDependencies = {}) {
  const { release } = await selection(input, deps);
  const readiness = await (deps.readiness ?? assessAnyQuoteAssetV1)({ quoteAsset: input.quoteAsset }, anyQuotePreparationOptionsV1(deps));
  if (isModuleEngineAnyQuoteEthRelease(release) && readiness.status === "compatible") {
    anyQuoteNativeFeeRouteFromExternal(readiness.routes.sell, { quoteAsset: readiness.quoteAsset, sharedHook: release.contracts.sharedHook.address });
  }
  return readiness;
}
export async function readAnyQuoteTradeQuote(input: AnyQuoteTradeQuoteInputV1, deps: AnyQuoteIntegrationDependencies = {}) {
  const { release, template } = await selection(input, deps);
  await assertModuleEngineRelease({ client: anyQuotePreparationClientV1(deps), release });
  return readAnyQuoteIdentityTradeQuoteV1({ ...input, identity: moduleEngineReleaseIdentity(release), template }, deps);
}
export async function readAnyQuoteLaunchPreview(input: AnyQuoteLaunchPreviewInput, deps: AnyQuoteIntegrationDependencies = {}) {
  const { release, template } = await selection(anyQuoteLaunchIntent(input), deps);
  await assertModuleEngineRelease({ client: anyQuotePreparationClientV1(deps), release });
  return readAnyQuoteIdentityLaunchPreviewV1({ ...input, identity: moduleEngineReleaseIdentity(release), template }, deps);
}
