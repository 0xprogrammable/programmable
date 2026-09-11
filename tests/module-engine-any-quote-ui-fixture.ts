import { ANY_QUOTE_CONFIGURATION_ABI, createAnyQuoteConfigurationSchema } from "@/lib/module-engine/any-quote-configuration";
import { computeModuleEngineHostManifestHash, computeModuleEngineReleaseDigest, moduleEngineReleaseIdentity, type ModuleEngineSharedQuoteReleaseIdentity, type ModuleEngineRelease } from "@/lib/module-engine/catalog";
import { MODULE_ENGINE_ANY_QUOTE_ECONOMICS_POLICY_ID, MODULE_ENGINE_ANY_QUOTE_PROFILE, MODULE_ENGINE_ANY_QUOTE_SOURCE_VERSION, MODULE_ENGINE_ANY_QUOTE_ETH_SOURCE_VERSION, MODULE_ENGINE_ANY_QUOTE_ETH_PROFILE, MODULE_ENGINE_ANY_QUOTE_ETH_ECONOMICS_POLICY_ID } from "@/lib/module-engine/profile";
import { fixture, addr, hash, QUOTE } from "./module-engine-fixture";

/** Source-bound catalog fixture, not a deployment or availability claim. */
export function anyQuoteUiFixture(nativeEthFees = false) {
  const f = fixture();
  const identity: ModuleEngineSharedQuoteReleaseIdentity = { ...moduleEngineReleaseIdentity(f.release),
    ...(nativeEthFees ? { sourceVersion: MODULE_ENGINE_ANY_QUOTE_ETH_SOURCE_VERSION, engineProfile: MODULE_ENGINE_ANY_QUOTE_ETH_PROFILE, economicsPolicyId: MODULE_ENGINE_ANY_QUOTE_ETH_ECONOMICS_POLICY_ID } : { sourceVersion: MODULE_ENGINE_ANY_QUOTE_SOURCE_VERSION, engineProfile: MODULE_ENGINE_ANY_QUOTE_PROFILE, economicsPolicyId: MODULE_ENGINE_ANY_QUOTE_ECONOMICS_POLICY_ID }),
    contracts: { ...f.release.contracts, sharedHook: { address: addr(901), runtimeCodeHash: hash(901) }, universalRouter: { address: addr(902), runtimeCodeHash: hash(902) }, nativeRouteGuard: { address: addr(903), runtimeCodeHash: hash(903) } } };
  identity.releaseDigest = computeModuleEngineReleaseDigest(identity);
  const release: ModuleEngineRelease = { ...f.release, ...identity };
  const template = structuredClone(f.template);
  template.manifest.manifest.release = identity;
  template.manifest.manifest.catalogDefinition = { ...template.manifest.manifest.catalogDefinition,
    id: "any-quote-lp-v1", title: "Any Quote LP", summary: "Choose your pool pair. Trade with ETH.",
    detail: "Create a coin paired with a compatible ERC20 on Robinhood Chain. Liquidity stays permanently locked. Creator fee rates are fixed at launch.",
    interface: "quote-shared-v1", schema: createAnyQuoteConfigurationSchema(identity), configurationAbi: ANY_QUOTE_CONFIGURATION_ABI,
    defaults: { quoteAsset: QUOTE, initialTick: "-200", validUntil: "1800000000", priceEvidenceHash: hash(999) } };
  template.manifestHash = computeModuleEngineHostManifestHash(template.manifest);
  return { ...f, release, template, availability: { ...f.availability, release, templates: [template] } };
}
