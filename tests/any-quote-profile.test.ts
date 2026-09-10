import { describe, expect, it } from "vitest";
import { decodeAbiParameters, parseAbiParameters } from "viem";
import { compileOpenConfig } from "@/packages/classic-modules/src/open-config.mjs";
import { bindModuleEngineReleaseIdentity, bindModuleEngineTemplate, computeModuleEngineHostManifestHash,
  computeModuleEngineReleaseDigest, moduleEngineReleaseIdentity, type ModuleEngineAnyQuoteReleaseIdentity } from "@/lib/module-engine/catalog";
import { ANY_QUOTE_CONFIGURATION_ABI, createAnyQuoteConfigurationSchema } from "@/lib/module-engine/any-quote-configuration";
import { encodeModuleEngineConfiguration } from "@/lib/module-engine/configuration";
import { MODULE_ENGINE_ANY_QUOTE_SOURCE_VERSION, MODULE_ENGINE_ANY_QUOTE_SOURCE_ID,
  MODULE_ENGINE_ANY_QUOTE_PROFILE, MODULE_ENGINE_ANY_QUOTE_ECONOMICS_POLICY_ID,
  moduleEngineSourceId, moduleEngineContractRoles } from "@/lib/module-engine/profile";
import { fixture, addr, hash, QUOTE } from "./module-engine-fixture";

function sharedFixture() {
  const f = fixture();
  const identity: ModuleEngineAnyQuoteReleaseIdentity = { ...moduleEngineReleaseIdentity(f.release),
    sourceVersion: MODULE_ENGINE_ANY_QUOTE_SOURCE_VERSION, engineProfile: MODULE_ENGINE_ANY_QUOTE_PROFILE,
    economicsPolicyId: MODULE_ENGINE_ANY_QUOTE_ECONOMICS_POLICY_ID,
    contracts: { ...f.release.contracts, sharedHook: { address: addr(901), runtimeCodeHash: hash(901) },
      universalRouter: { address: addr(902), runtimeCodeHash: hash(902) }, nativeRouteGuard: { address: addr(903), runtimeCodeHash: hash(903) } } };
  identity.releaseDigest = computeModuleEngineReleaseDigest(identity);
  const template = structuredClone(f.template);
  template.manifest.manifest.release = identity;
  template.manifest.manifest.catalogDefinition = { ...template.manifest.manifest.catalogDefinition,
    interface: "quote-shared-v1", schema: createAnyQuoteConfigurationSchema(identity), configurationAbi: ANY_QUOTE_CONFIGURATION_ABI,
    defaults: { quoteAsset: QUOTE, initialTick: "-200", validUntil: "1800000000", priceEvidenceHash: hash(999) } };
  template.manifestHash = computeModuleEngineHostManifestHash(template.manifest);
  return { identity, template };
}

describe("Any Quote authenticated source and configuration", () => {
  it("binds its exact source, economics and all immutable infrastructure without changing native identity", () => {
    const { identity, template } = sharedFixture();
    expect(bindModuleEngineReleaseIdentity(identity)).toEqual(identity);
    expect(moduleEngineSourceId(identity)).toBe(MODULE_ENGINE_ANY_QUOTE_SOURCE_ID);
    expect(moduleEngineContractRoles(identity)).toContain("nativeRouteGuard");
    expect(bindModuleEngineTemplate(template, identity)).toEqual(template);
    const native = fixture();
    expect(bindModuleEngineReleaseIdentity(moduleEngineReleaseIdentity(native.release))).toEqual(moduleEngineReleaseIdentity(native.release));
  });
  it("rejects a substituted policy, missing guard pin and a native release relabeled as shared", () => {
    const { identity, template } = sharedFixture();
    expect(() => computeModuleEngineReleaseDigest({ ...identity, economicsPolicyId: fixture().release.economicsPolicyId })).toThrow();
    const missing = structuredClone(identity) as unknown as { contracts: Record<string, unknown> };
    delete missing.contracts.nativeRouteGuard;
    expect(() => bindModuleEngineReleaseIdentity(missing)).toThrow();
    template.manifest.manifest.release = moduleEngineReleaseIdentity(fixture().release);
    expect(() => computeModuleEngineHostManifestHash(template.manifest)).toThrow("authenticated source");
  });
  it("rejects mutable infrastructure or a fixed-CA revision under the free-CA profile", () => {
    const { template } = sharedFixture();
    template.manifest.manifest.revision.fixedQuoteAsset = QUOTE;
    expect(() => computeModuleEngineHostManifestHash(template.manifest)).toThrow("per-launch");
    const second = sharedFixture().template;
    const schema = second.manifest.manifest.catalogDefinition.schema;
    if (schema.type !== "record") throw new Error("Fixture schema");
    schema.fields.sharedHook.binding = { mode: "input" };
    expect(() => computeModuleEngineHostManifestHash(second.manifest)).toThrow("infrastructure");
  });
  it("keeps old quote-v1 fixed configuration enforcement", () => {
    const f = fixture();
    f.template.manifest.manifest.catalogDefinition.interface = "quote-v1";
    f.template.manifestHash = computeModuleEngineHostManifestHash(f.template.manifest);
    expect(() => bindModuleEngineTemplate(f.template)).toThrow("fixed reviewed configuration");
  });
  it.each(["-887000", "-200", "0", "200", "887000"])("encodes signed tick %s into the exact 256-byte canonical configuration", tick => {
    const { identity, template } = sharedFixture();
    const schema = template.manifest.manifest.catalogDefinition.schema;
    const config = compileOpenConfig(schema, { quoteAsset: QUOTE, initialTick: tick, validUntil: "1800000000", priceEvidenceHash: hash(999) });
    const bytes = encodeModuleEngineConfiguration(ANY_QUOTE_CONFIGURATION_ABI, config, schema);
    expect((bytes.length - 2) / 2).toBe(256);
    const decoded = decodeAbiParameters(parseAbiParameters("bytes32,address,bytes32,address,address,int24,uint64,bytes32"), bytes);
    expect(decoded[3].toLowerCase()).toBe(identity.contracts.sharedHook.address);
    expect(decoded[5]).toBe(Number(tick));
  });
  it.each(["-0", "+200", "0200", "1e3", "8388608", "-8388609"])("rejects invalid signed integer %s", tick => {
    const { template } = sharedFixture();
    const schema = template.manifest.manifest.catalogDefinition.schema;
    expect(() => encodeModuleEngineConfiguration(ANY_QUOTE_CONFIGURATION_ABI,
      compileOpenConfig(schema, { quoteAsset: QUOTE, initialTick: tick, validUntil: "1800000000", priceEvidenceHash: hash(999) }), schema)).toThrow();
  });
});
