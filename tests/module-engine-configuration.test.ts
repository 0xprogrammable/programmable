import { describe, expect, it } from "vitest";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { compileOpenConfig, type OpenConfigSchema } from "@/packages/classic-modules/src/open-config.mjs";
import { encodeModuleEngineConfiguration, validateModuleEngineConfigurationAbi } from "@/lib/module-engine/configuration";
import { ACCOUNT, QUOTE } from "./module-engine-fixture";

describe("reviewed engine tuple configuration", () => {
  const schema: OpenConfigSchema = { type: "record", required: ["wallet", "route", "amount"], fields: { wallet: { type: "account" }, route: { type: "bytes", maxLength: 128 }, amount: { type: "uint" } } };
  const mapping = [{ path: [], type: "tuple", components: [{ name: "amount", type: "uint256" }, { name: "wallet", type: "address" }, { name: "route", type: "bytes" }] }] as const;
  it("encodes a dynamic root tuple with its leading offset and canonical named field order", () => { const config = compileOpenConfig(schema, { wallet: { role: "launchWallet" }, route: "0x1234", amount: "17" }, { roles: { launchWallet: ACCOUNT } }); const encoded = encodeModuleEngineConfiguration(mapping, config, schema); expect(encoded).toBe(encodeAbiParameters(parseAbiParameters("(uint256 amount,address wallet,bytes route)"), [{ amount: 17n, wallet: ACCOUNT, route: "0x1234" }])); expect(BigInt(`0x${encoded.slice(2, 66)}`)).toBe(32n); });
  it("rejects omitted tuple fields, duplicate names and primitive schema substitution", () => { expect(() => validateModuleEngineConfigurationAbi(schema, [{ path: [], type: "tuple", components: [mapping[0].components[0]] }])).toThrow("exactly once"); expect(() => validateModuleEngineConfigurationAbi(schema, [{ path: [], type: "tuple", components: [mapping[0].components[0], mapping[0].components[0], mapping[0].components[2]] }])).toThrow("Duplicate"); expect(() => validateModuleEngineConfigurationAbi(schema, [{ path: ["amount"], type: "address" }])).toThrow("does not match"); });
  it("preserves primitive bytes and applies fixed values through the shared SDK", () => { const fixed: OpenConfigSchema = { type: "record", required: ["quote"], fields: { quote: { type: "address", binding: { mode: "fixed", value: QUOTE } } } }; const config = compileOpenConfig(fixed, {}); expect(encodeModuleEngineConfiguration([{ path: ["quote"], type: "address" }], config, fixed)).toBe(encodeAbiParameters(parseAbiParameters("address"), [QUOTE])); expect(() => compileOpenConfig(fixed, { quote: ACCOUNT })).toThrow(); });
});
