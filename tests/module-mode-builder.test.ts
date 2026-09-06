import { describe, expect, it } from "vitest";
import { decodeAbiParameters } from "viem";

import {
  configurationFromForm,
  configurationSummary,
  createModuleModeState,
  defaultSchemaValue,
  feeBreakdown,
  programmableFeeAllocation,
  parseExactUnits,
  LEGACY_V1_MODULE_CATALOG as PREVIEW_MODULE_CATALOG,
  PREVIEW_MODULE_CATALOG as NATIVE_CATALOG,
  LEGACY_ENGINE_PROFILE,
  NATIVE_ENGINE_PROFILE,
  durationToSeconds,
  utcDateTimeToSeconds,
  nativeValueBreakdown,
  validateTokenImage,
  setModuleSelected,
  validateModuleModeDraft as validateBuilder,
  type OpenConfigContext,
  type ModuleModeCatalogEntry,
  type ModuleModeState,
  type OpenConfigSchema,
} from "@/lib/module-mode/builder";

function validState(): ModuleModeState {
  return { ...createModuleModeState(), name: "Garden", symbol: "GARDEN", initialBuyEth: "0.001", tokenImage: { kind: "uri", uri: "https://example.com/garden.webp", contentVerified: false } };
}

function validateModuleModeDraft(state: ModuleModeState, catalog: readonly ModuleModeCatalogEntry[] = PREVIEW_MODULE_CATALOG, context: OpenConfigContext = {}) {
  return validateBuilder(state, catalog, context, LEGACY_ENGINE_PROFILE);
}

describe("Module Mode draft", () => {
  it("starts with a normal coin, no modules and the immutable extra 20 bps", () => {
    const result = validateModuleModeDraft(validState());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.modules).toEqual([]);
    expect(result.draft.initialBuyWei).toBe("1000000000000000");
    expect(result.draft.fees).toEqual({ creatorBuyBps: 0, creatorSellBps: 0, programmableBps: 20, asset: "native-ETH" });
    expect(result.draft).toMatchObject({ chainId: 4663, status: "preview", launchable: false, onchainApproved: false, walletAuthorizationVerified: false });
    expect(JSON.stringify(result.draft)).not.toContain("implementation");
    expect(feeBreakdown("0", "10")).toEqual({ buy: "0.20%", sell: "10.20%", programmable: "0.20%" });
  });

  it("rejects invalid money and fee inputs without accepting rounded decimals", () => {
    for (const input of ["", "0", "-1", "1e-3", "Infinity", "0.0000000000000000001"]) {
      const result = validateModuleModeDraft({ ...validState(), initialBuyEth: input });
      expect(result.ok).toBe(false);
    }
    for (const fee of ["-1", "11", "0.5", "1e1"]) {
      const result = validateModuleModeDraft({ ...validState(), buyFeePercent: fee });
      expect(result.ok).toBe(false);
    }
    expect(parseExactUnits("0.000000000000000001", 18)).toBe("1");
    expect(parseExactUnits("9.99", 2)).toBe("999");
    expect(parseExactUnits("60", 0, "60")).toBe("3600");
    expect(() => parseExactUnits("9.999", 2)).toThrow("2 decimal places");
  });

  it("checks the active release minimum without changing the user's ETH amount", () => {
    const state = validState();
    const result = validateBuilder(state, NATIVE_CATALOG, {}, NATIVE_ENGINE_PROFILE, undefined, "1000000000000001");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual({ path: "/initialBuyEth", message: "The launch minimum is 0.001000000000000001 ETH. Increase your initial buy." });
    expect(state.initialBuyEth).toBe("0.001");
    expect(validateBuilder(state, NATIVE_CATALOG, {}, NATIVE_ENGINE_PROFILE, undefined, "1000000000000000").ok).toBe(true);
    for (const invalidMinimum of ["0", "-1", "1e3", "100.1", "", (1n << 127n).toString()]) {
      expect(validateBuilder(state, NATIVE_CATALOG, {}, NATIVE_ENGINE_PROFILE, undefined, invalidMinimum).ok).toBe(false);
    }
    expect(programmableFeeAllocation(0)).toContain("full 0.20%");
    expect(programmableFeeAllocation(1)).toContain("0.10% shared equally");
    expect(programmableFeeAllocation(8)).toEqual(programmableFeeAllocation(1));
  });

  it("binds settings and preserves a removed module's complete configuration for undo", () => {
    const entry = PREVIEW_MODULE_CATALOG[0];
    const state = setModuleSelected(validState(), entry, true);
    state.moduleValues[entry.id] = { buyEnd: "0.5", sellEnd: "0", duration: "120" };
    const removed = setModuleSelected(state, entry, false);
    const restored = setModuleSelected(removed, entry, true);
    expect(restored.moduleValues).toEqual(state.moduleValues);
    expect(restored.selectedModules).toEqual([entry.id]);
    expect(setModuleSelected(restored, entry, true).selectedModules).toEqual([entry.id]);
    expect(entry.defaults).toEqual({ buyEnd: "0", sellEnd: "0", duration: "60" });
  });

  it("checks falling fees against the starting rates and encodes the exact legacy ABI order", () => {
    const entry = PREVIEW_MODULE_CATALOG[0];
    const zeroFee = setModuleSelected(validState(), entry, true);
    const failed = validateModuleModeDraft(zeroFee);
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.issues.some((issue) => issue.message.includes("starting creator fee"))).toBe(true);
    const state = { ...zeroFee, buyFeePercent: "3", sellFeePercent: "5", moduleValues: { [entry.id]: { buyEnd: "1", sellEnd: "2", duration: "120" } } };
    const result = validateModuleModeDraft(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const selectedModule = result.draft.modules[0];
    expect(selectedModule.configuration).toEqual({ buyEnd: "100", sellEnd: "200", duration: "7200" });
    expect(decodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], selectedModule.legacyConfigurationBytes!)).toEqual([100n, 200n, 7200n]);
    expect(selectedModule.configurationBytes).not.toEqual(selectedModule.legacyConfigurationBytes);
    expect(validateModuleModeDraft({ ...state, buyFeePercent: "0" }).ok).toBe(false);
    expect(state.moduleValues[entry.id]).toEqual({ buyEnd: "1", sellEnd: "2", duration: "120" });
  });

  it("enforces the timer bounds, at least one trade limit and the initial buy limit", () => {
    const falling = PREVIEW_MODULE_CATALOG[0]; const limits = PREVIEW_MODULE_CATALOG[1];
    const lowDuration = setModuleSelected({ ...validState(), buyFeePercent: "1" }, falling, true);
    lowDuration.moduleValues[falling.id] = { buyEnd: "0", sellEnd: "0", duration: "0" };
    expect(validateModuleModeDraft(lowDuration).ok).toBe(false);
    lowDuration.moduleValues[falling.id] = { buyEnd: "0", sellEnd: "0", duration: "43201" };
    expect(validateModuleModeDraft(lowDuration).ok).toBe(false);
    const state = setModuleSelected(validState(), limits, true);
    state.moduleValues[limits.id] = { buyLimit: "0", sellLimit: "0" };
    expect(validateModuleModeDraft(state).ok).toBe(false);
    state.moduleValues[limits.id] = { buyLimit: "0.0001", sellLimit: "0" };
    const result = validateModuleModeDraft(state);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual({ path: "/initialBuyEth", message: "The initial buy exceeds the trade limits maximum. Reduce the buy or increase the limit." });
    state.moduleValues[limits.id] = { buyLimit: "0", sellLimit: "0.1" };
    expect(validateModuleModeDraft(state).ok).toBe(true);
  });

  it("combines both modules and binds changes to source metadata, fees and parameters", () => {
    let state = { ...validState(), buyFeePercent: "1", sellFeePercent: "2" };
    for (const entry of PREVIEW_MODULE_CATALOG) state = setModuleSelected(state, entry, true);
    const result = validateModuleModeDraft(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.modules).toHaveLength(2);
    const same = validateModuleModeDraft(JSON.parse(JSON.stringify(state)));
    expect(same).toEqual(result);
    const changed = validateModuleModeDraft({ ...state, buyFeePercent: "2" });
    if (!changed.ok) throw new Error("Expected valid changed draft");
    expect(changed.draft.draftId).not.toBe(result.draft.draftId);
    const changedCatalog = PREVIEW_MODULE_CATALOG.map((entry) => ({ ...entry, version: "2" }));
    const newVersion = validateModuleModeDraft(state, changedCatalog);
    if (!newVersion.ok) throw new Error("Expected valid changed version");
    expect(newVersion.draft.draftId).not.toBe(result.draft.draftId);
  });

  it("keeps stale module selections visible as errors and rejects duplicate catalog ids", () => {
    const state = { ...validState(), selectedModules: ["missing"] };
    const result = validateModuleModeDraft(state);
    expect(result.ok).toBe(false);
    expect(state.selectedModules).toEqual(["missing"]);
    expect(validateModuleModeDraft(validState(), [PREVIEW_MODULE_CATALOG[0], PREVIEW_MODULE_CATALOG[0]]).ok).toBe(false);
  });

  it("accepts a new nested schema with lists, optional values, variants and bound wallet roles", () => {
    const schema: OpenConfigSchema = {
      type: "record", required: ["recipients", "mode"], fields: {
        note: { type: "string", maxLength: 128 },
        recipients: { type: "array", minItems: 1, maxItems: 4, items: { type: "record", required: ["wallet", "share"], fields: { wallet: { type: "account" }, share: { type: "uint", max: "10000", unit: "bps" } } } },
        mode: { type: "variant", tag: "kind", variants: { immediate: { type: "record", fields: {}, required: [] }, timed: { type: "record", fields: { delay: { type: "uint", max: "100000", unit: "seconds" } }, required: ["delay"] } } },
      },
    };
    const entry: ModuleModeCatalogEntry = { id: "nested-example", title: "Nested example", summary: "Test fixture", detail: "Test fixture", status: "preview", engine: LEGACY_ENGINE_PROFILE, version: "1", source: { path: "test/example", sha256: "0".repeat(64) }, schema, defaults: { recipients: [{ wallet: { role: "creator" }, share: "100" }], mode: { kind: "timed", delay: "5" } }, fields: { "/recipients/*/share": { decimals: 2, suffix: "%" }, "/mode/timed/delay": { multiplier: "60", suffix: "minutes" } } };
    const state = setModuleSelected(validState(), entry, true);
    const noRole = validateModuleModeDraft(state, [entry]);
    expect(noRole.ok).toBe(false);
    const result = validateModuleModeDraft(state, [entry], { roles: { creator: "0x1111111111111111111111111111111111111111" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.modules[0].configuration).toEqual({ recipients: [{ wallet: { role: "creator" }, share: "10000" }], mode: { kind: "timed", delay: "300" } });
    expect(result.draft.modules[0].bindings).toHaveLength(1);
    expect(result.draft.walletAuthorizationVerified).toBe(false);
    const rebound = validateModuleModeDraft(state, [entry], { roles: { creator: "0x2222222222222222222222222222222222222222" } });
    if (!rebound.ok) throw new Error("Expected valid rebound preview");
    expect(rebound.draft.draftId).not.toBe(result.draft.draftId);
    const summary = configurationSummary(schema, entry.defaults, entry.fields);
    expect(summary.some((row) => row.value === "100 %")).toBe(true);
    expect(summary.some((row) => row.value === "5 minutes")).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("[object Object]");
  });

  it("keeps incomplete form text while reporting its exact nested path", () => {
    const schema: OpenConfigSchema = { type: "record", required: ["amount"], fields: { amount: { type: "uint", max: "100" } } };
    const input = { amount: "." };
    try { configurationFromForm(schema, input); throw new Error("Expected conversion to fail"); }
    catch (error) { expect(error).toMatchObject({ path: "/amount" }); }
    expect(input.amount).toBe(".");
    expect(defaultSchemaValue({ type: "record", fields: { optional: { type: "string", maxLength: 10 } }, required: [] })).toEqual({});
  });
});

describe("Native engine configuration", () => {
  it("binds the native engine even for a simple coin and separates it from legacy modules", () => {
    const result = validateBuilder(validState());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.engine).toEqual(NATIVE_ENGINE_PROFILE);
    expect(result.draft.totalProgramFundingWei).toBe("0");
    expect(result.draft.totalNativeValueWei).toBe(result.draft.initialBuyWei);
    expect(NATIVE_CATALOG.some((entry) => entry.id === "falling-creator-fee-v1")).toBe(false);
    expect(NATIVE_CATALOG.some((entry) => entry.id === "quote-trade-limit-v1")).toBe(false);
    const legacy = setModuleSelected(validState(), PREVIEW_MODULE_CATALOG[1], true);
    expect(validateBuilder(legacy, PREVIEW_MODULE_CATALOG).ok).toBe(false);
  });

  it("encodes the native wallet cap in exact typed ABI order, including the initial-buy flag", () => {
    const entry = NATIVE_CATALOG.find((candidate) => candidate.id === "timed-wallet-buy-cap-v1")!;
    const state = setModuleSelected(validState(), entry, true);
    const result = validateBuilder(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(decodeAbiParameters([{ type: "uint128" }, { type: "uint64" }, { type: "bool" }], result.draft.modules[0].programConfigurationBytes)).toEqual([100000000000000000n, 1800n, true]);
    expect(result.draft.modules[0].fundingWei).toBe("0");
    state.moduleValues[entry.id] = { capNative: "0.0001", duration: { amount: "1", unit: "seconds" }, includeInitialBuy: true };
    expect(validateBuilder(state).ok).toBe(false);
    state.moduleValues[entry.id] = { capNative: "0.0001", duration: { amount: "1", unit: "seconds" }, includeInitialBuy: false };
    expect(validateBuilder(state).ok).toBe(true);
    state.moduleValues[entry.id] = { capNative: "0.0001", duration: { amount: "30.0001", unit: "days" }, includeInitialBuy: false };
    expect(validateBuilder(state).ok).toBe(false);
  });

  it("preserves exact seconds across friendly duration units and rejects ambiguous timestamps", () => {
    expect(durationToSeconds({ amount: "1", unit: "seconds" })).toBe("1");
    expect(durationToSeconds({ amount: "0.5", unit: "minutes" })).toBe("30");
    expect(durationToSeconds({ amount: "1.5", unit: "hours" })).toBe("5400");
    expect(() => durationToSeconds({ amount: "0.5", unit: "seconds" })).toThrow("whole number");
    expect(utcDateTimeToSeconds("2030-01-01T12:30")).toBe(String(Date.UTC(2030, 0, 1, 12, 30) / 1000));
    expect(() => utcDateTimeToSeconds("2030-02-30T12:30")).toThrow("valid date");
    expect(() => utcDateTimeToSeconds("2030-01-01T12:30+02:00")).toThrow("UTC");
  });

  it("encodes the final reward ABI including its fixed refund wallet and separately funded budget", () => {
    const entry = NATIVE_CATALOG.find((candidate) => candidate.id === "every-nth-buy-reward-v1")!;
    const state = setModuleSelected(validState(), entry, true);
    const refundWallet = "0x1111111111111111111111111111111111111111";
    state.moduleValues[entry.id] = { everyN: "10", minimumGrossNative: "0.001", rewardNative: "0.0001", endsAt: "2030-01-02T12:00", includeInitialBuy: false, refundWallet: { role: "refund" } };
    const context = { roles: { refund: refundWallet } } as const;
    const now = Date.UTC(2030, 0, 1) / 1000;
    const result = validateBuilder(state, NATIVE_CATALOG, context, NATIVE_ENGINE_PROFILE, now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const program = result.draft.modules[0];
    expect((program.programConfigurationBytes.length - 2) / 2).toBe(192);
    expect(decodeAbiParameters([{ type: "uint32" }, { type: "uint128" }, { type: "uint128" }, { type: "uint64" }, { type: "bool" }, { type: "address" }], program.programConfigurationBytes)).toEqual([10, 1000000000000000n, 100000000000000n, BigInt(Date.UTC(2030, 0, 2, 12) / 1000), false, refundWallet]);
    expect(result.draft.totalProgramFundingWei).toBe("10000000000000000");
    expect(result.draft.initialBuyWei).toBe("1000000000000000");
    expect(result.draft.totalNativeValueWei).toBe("11000000000000000");
    expect(program.fundingWei).toBe(result.draft.totalProgramFundingWei);
    expect(nativeValueBreakdown(state, NATIVE_CATALOG)).toEqual({ initialBuy: "0.001", funding: "0.01", total: "0.011" });
    const summary = configurationSummary(entry.schema, state.moduleValues[entry.id], entry.fields, undefined, "", program.bindings);
    expect(summary.some((item) => item.value.includes(refundWallet))).toBe(true);
    expect(summary.some((item) => item.value === "2030-01-02 12:00 UTC")).toBe(true);
    const zero = validateBuilder({ ...state, moduleFundingEth: { [entry.id]: "0" } }, NATIVE_CATALOG, context, NATIVE_ENGINE_PROFILE, now);
    expect(zero.ok).toBe(true);
    if (zero.ok) expect(zero.draft.totalNativeValueWei).toBe(zero.draft.initialBuyWei);
    const removed = setModuleSelected(state, entry, false);
    expect(nativeValueBreakdown(removed, NATIVE_CATALOG).funding).toBe("0");
    expect(setModuleSelected(removed, entry, true).moduleFundingEth[entry.id]).toBe("0.01");
  });

  it("rejects expired rewards, a zero refund wallet and invalid native reward parameters", () => {
    const entry = NATIVE_CATALOG.find((candidate) => candidate.id === "every-nth-buy-reward-v1")!;
    const state = setModuleSelected(validState(), entry, true);
    const values = { everyN: "10", minimumGrossNative: "0.001", rewardNative: "0.0001", endsAt: "2030-01-02T12:00", includeInitialBuy: true, refundWallet: { address: "0x1111111111111111111111111111111111111111" } };
    const now = Date.UTC(2030, 0, 1) / 1000;
    for (const patch of [{ everyN: "0" }, { everyN: "4294967296" }, { minimumGrossNative: "0" }, { rewardNative: "0" }, { endsAt: "2030-01-01T00:00" }, { refundWallet: { address: `0x${"0".repeat(40)}` } }]) {
      state.moduleValues[entry.id] = { ...values, ...patch };
      expect(validateBuilder(state, NATIVE_CATALOG, {}, NATIVE_ENGINE_PROFILE, now).ok).toBe(false);
    }
    state.moduleValues[entry.id] = values;
    const initial = validateBuilder(state, NATIVE_CATALOG, {}, NATIVE_ENGINE_PROFILE, now);
    expect(initial.ok).toBe(true);
    state.moduleValues[entry.id] = { ...values, refundWallet: { address: "0x2222222222222222222222222222222222222222" } };
    const changed = validateBuilder(state, NATIVE_CATALOG, {}, NATIVE_ENGINE_PROFILE, now);
    if (initial.ok && changed.ok) expect(initial.draft.draftId).not.toBe(changed.draft.draftId);
  });

  it("requires a real image choice and binds the local fingerprint without inventing a public URI", () => {
    expect(validateBuilder({ ...validState(), tokenImage: { kind: "none" } }).ok).toBe(false);
    const local = { kind: "local" as const, sha256: `0x${"1".repeat(64)}` as const, mimeType: "image/webp" as const, bytes: 2148 };
    const result = validateBuilder({ ...validState(), tokenImage: local });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.token.image).toEqual(local);
    expect(result.draft.token.image).not.toHaveProperty("uri");
    const changed = validateBuilder({ ...validState(), tokenImage: { ...local, sha256: `0x${"2".repeat(64)}` } });
    if (!changed.ok) throw new Error("Expected changed image draft");
    expect(changed.draft.draftId).not.toEqual(result.draft.draftId);
    for (const uri of ["data:image/webp;base64,abc", "blob:https://example.com/image", "http://example.com/image", "https://user:password@example.com/image", "https://127.0.0.1/image", "https://example.com:8443/image"]) {
      expect(validateTokenImage({ kind: "uri", uri, contentVerified: false })).not.toBeNull();
    }
  });

  it("enforces the existing launch metadata limits", () => {
    expect(validateBuilder({ ...validState(), name: "a".repeat(49) }).ok).toBe(false);
    expect(validateBuilder({ ...validState(), description: "a".repeat(281) }).ok).toBe(false);
    expect(validateBuilder({ ...validState(), name: "a".repeat(48), description: "a".repeat(280) }).ok).toBe(true);
    expect(nativeValueBreakdown(validState(), NATIVE_CATALOG)).toEqual({ initialBuy: "0.001", funding: "0", total: "0.001" });
  });
});
