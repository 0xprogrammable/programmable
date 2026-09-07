import { encodeAbiParameters, formatUnits, sha256, stringToHex, type AbiParameter } from "viem";
import { MAX_METADATA_URL_BYTES, MAX_TOKEN_DESCRIPTION_BYTES, MAX_TOKEN_NAME_BYTES } from "@/lib/metadata-policy";
import { MAX_TOKEN_IMAGE_UPLOAD_BYTES } from "@/lib/token-image";
import type { ModuleDiscovery } from "./library";

import {
  compileOpenConfig,
  type OpenConfigContext,
  type OpenConfigSchema,
  type OpenConfigValue,
} from "@/packages/classic-modules/src/open-config.mjs";
import {
  evaluateOpenConstraints,
  type OpenConstraint,
} from "@/packages/classic-modules/src/open-constraints.mjs";

export type { OpenConfigContext, OpenConfigSchema, OpenConfigValue };
export type FormValue = string | boolean | FormValue[] | { [key: string]: FormValue };
export type FieldDisplay = { suffix?: string; decimals?: number; multiplier?: string; placeholder?: string; input?: "datetime-utc" | "duration" };

export interface ModuleModeEngineProfile { id: string; version: number; label: string }
export const NATIVE_ENGINE_PROFILE: ModuleModeEngineProfile = { id: "programmable.module-mode.native.v1", version: 1, label: "Native modules" };
export const LEGACY_ENGINE_PROFILE: ModuleModeEngineProfile = { id: "programmable.classic-modules.v1", version: 1, label: "Classic Modules V1" };
export type ModuleModeImage =
  | { kind: "none" }
  | { kind: "uri"; uri: string; contentVerified: false }
  | { kind: "local"; sha256: `0x${string}`; mimeType: "image/webp"; bytes: number };

export interface ProgramArgument { path: string[]; type: string }

/** Inert catalog data. A preview entry is not an admitted or deployed module. */
export interface ModuleModeCatalogEntry {
  id: string;
  title: string;
  summary: string;
  detail: string;
  version: string;
  status: "preview" | "available";
  engine: ModuleModeEngineProfile;
  source: { path: string; sha256: string };
  schema: OpenConfigSchema;
  defaults: FormValue;
  fields?: Record<string, FieldDisplay>;
  constraints?: OpenConstraint[];
  /** Explicit legacy ABI order; the open schema codec uses its own canonical field order. */
  legacyUint256Order?: string[];
  initialBuyLimitField?: string;
  initialBuyLimitEnabledField?: string;
  programAbi?: ProgramArgument[];
  funding?: { label: string; help: string; defaultEth: string };
  futureTimestampFields?: string[];
  nonzeroAccountFields?: string[];
  discovery?: ModuleDiscovery;
}

export interface ModuleModeState {
  name: string;
  symbol: string;
  description: string;
  tokenImage: ModuleModeImage;
  initialBuyEth: string;
  buyFeePercent: string;
  sellFeePercent: string;
  selectedModules: string[];
  moduleValues: Record<string, FormValue>;
  moduleFundingEth: Record<string, string>;
}
export interface BuilderIssue { path: string; message: string }
export interface ModuleModeDraft {
  format: "programmable.module-mode.draft.v0.1";
  status: "preview";
  launchable: false;
  onchainApproved: false;
  walletAuthorizationVerified: false;
  chainId: 4663;
  quoteAsset: "native-ETH";
  engine: ModuleModeEngineProfile;
  token: { name: string; symbol: string; description: string; image: Exclude<ModuleModeImage, { kind: "none" }> };
  initialBuyWei: string;
  totalProgramFundingWei: string;
  totalNativeValueWei: string;
  fees: { creatorBuyBps: number; creatorSellBps: number; programmableBps: 20; asset: "native-ETH" };
  modules: Array<{
    id: string;
    version: string;
    catalogDigest: `0x${string}`;
    source: ModuleModeCatalogEntry["source"];
    configuration: OpenConfigValue;
    configurationBytes: `0x${string}`;
    programConfigurationBytes: `0x${string}`;
    fundingWei: string;
    bindings: ReturnType<typeof compileOpenConfig>["bindings"];
    legacyConfigurationBytes?: `0x${string}`;
  }>;
  draftId: `0x${string}`;
}
export type DraftResult = { ok: true; draft: ModuleModeDraft } | { ok: false; issues: BuilderIssue[] };

const uint = (label: string, max: string, unit: string, min = "0"): OpenConfigSchema => ({ type: "uint", label, max, min, unit });
const ref = (instance: string, key: string) => ({ ref: { instance, path: [key] } });
const baseSchema: OpenConfigSchema = {
  type: "record", required: ["buyCreatorFeeBps", "sellCreatorFeeBps"],
  fields: {
    buyCreatorFeeBps: uint("Buy creator fee", "1000", "bps"),
    sellCreatorFeeBps: uint("Sell creator fee", "1000", "bps"),
  },
};

export const LEGACY_V1_MODULE_CATALOG: readonly ModuleModeCatalogEntry[] = [
  {
    id: "falling-creator-fee-v1", title: "Falling fees", version: "1",
    summary: "Let your creator fees decrease over time.",
    detail: "Fees decrease linearly from your starting rates to the targets below. The 0.20% Programmable fee stays the same.",
    status: "preview",
    engine: LEGACY_ENGINE_PROFILE,
    source: { path: "contracts/src/classic-modules/modules/FallingCreatorFeeV1.sol", sha256: "6a2702f1fe77386280a5964b0c711e4cbe86c775a1eded31d014a4eb9be7d26f" },
    schema: {
      type: "record", required: ["buyEnd", "sellEnd", "duration"],
      fields: {
        buyEnd: uint("Final buy fee", "1000", "bps"),
        sellEnd: uint("Final sell fee", "1000", "bps"),
        duration: { ...uint("Reach the final fees after", "2592000", "seconds", "60"), help: "From 1 minute to 43,200 minutes (30 days)." },
      },
    },
    defaults: { buyEnd: "0", sellEnd: "0", duration: "60" },
    fields: {
      "/buyEnd": { suffix: "%", decimals: 2 },
      "/sellEnd": { suffix: "%", decimals: 2 },
      "/duration": { suffix: "minutes", multiplier: "60" },
    },
    constraints: [
      { id: "buy-target", message: "The final buy fee must be at or below your starting buy fee.", left: ref("$self", "buyEnd"), operator: "lte", right: ref("base", "buyCreatorFeeBps") },
      { id: "sell-target", message: "The final sell fee must be at or below your starting sell fee.", left: ref("$self", "sellEnd"), operator: "lte", right: ref("base", "sellCreatorFeeBps") },
      { id: "must-decrease", message: "Set at least one starting creator fee above its final fee.", left: { add: [ref("$self", "buyEnd"), ref("$self", "sellEnd")] }, operator: "lt", right: { add: [ref("base", "buyCreatorFeeBps"), ref("base", "sellCreatorFeeBps")] } },
    ],
    legacyUint256Order: ["buyEnd", "sellEnd", "duration"],
  },
  {
    id: "quote-trade-limit-v1", title: "Trade limits", version: "1",
    summary: "Set the maximum ETH amount per trade.",
    detail: "Limits include fees. Set 0 for no limit on that side. Traders can split orders; this does not guarantee protection from snipers.",
    status: "preview",
    engine: LEGACY_ENGINE_PROFILE,
    source: { path: "contracts/src/classic-modules/modules/QuoteTradeLimitV1.sol", sha256: "6c02de7047a0965540eb03e27cdf767e3913befd9c35b5c8c4690efcbfd2eb38" },
    schema: {
      type: "record", required: ["buyLimit", "sellLimit"],
      fields: {
        buyLimit: uint("Maximum buy", "170141183460469231731687303715884105727", "ETH.wei"),
        sellLimit: uint("Maximum sell", "170141183460469231731687303715884105727", "ETH.wei"),
      },
    },
    defaults: { buyLimit: "1", sellLimit: "0" },
    fields: { "/buyLimit": { suffix: "ETH", decimals: 18 }, "/sellLimit": { suffix: "ETH", decimals: 18 } },
    constraints: [{ id: "one-limit", message: "Set a buy or sell limit above 0 ETH, or remove this module.", left: { add: [ref("$self", "buyLimit"), ref("$self", "sellLimit")] }, operator: "gt", right: { literal: "0", unit: "ETH.wei" } }],
    legacyUint256Order: ["buyLimit", "sellLimit"],
    initialBuyLimitField: "buyLimit",
  },
];

export const PREVIEW_MODULE_CATALOG: readonly ModuleModeCatalogEntry[] = [
  {
    id: "timed-wallet-buy-cap-v1", title: "Opening buy cap", version: "1", status: "preview", engine: NATIVE_ENGINE_PROFILE,
    summary: "Limit each wallet's total buys during the opening window.",
    detail: "Each wallet's buys add up toward its cap, including fees. The cap expires after the opening window. Sells are unrestricted by this module; multiple wallets can bypass a per-wallet cap.",
    source: { path: "contracts/src/module-mode/modules/TimedWalletBuyCapV1.sol", sha256: "ea0c547131d6e41878c0f75129db4a242059feda2e121edb8be024108cda9079" },
    schema: { type: "record", required: ["capNative", "duration", "includeInitialBuy"], fields: {
      capNative: { type: "uint", bits: 128, min: "1", label: "Maximum ETH per wallet", unit: "ETH.wei" },
      duration: { type: "uint", bits: 64, min: "1", max: "2592000", label: "Opening window", help: "From 1 second to 30 days, starting at launch.", unit: "seconds" },
      includeInitialBuy: { type: "bool", label: "Count the initial buy toward the cap" },
    } },
    defaults: { capNative: "0.1", duration: { amount: "30", unit: "minutes" }, includeInitialBuy: true },
    fields: { "/capNative": { decimals: 18, suffix: "ETH" }, "/duration": { input: "duration" } },
    initialBuyLimitField: "capNative", initialBuyLimitEnabledField: "includeInitialBuy",
    programAbi: [{ path: ["capNative"], type: "uint128" }, { path: ["duration"], type: "uint64" }, { path: ["includeInitialBuy"], type: "bool" }],
  },
  {
    id: "every-nth-buy-reward-v1", title: "Every Nth buy reward", version: "1", status: "preview", engine: NATIVE_ENGINE_PROFILE,
    summary: "Reward every Nth qualifying buy from a separate ETH budget.",
    detail: "Qualifying buys count toward a predictable reward paid to the buyer's wallet as a claim. Rewards are skipped when the budget cannot cover them; no debt is created. After the end date, only the fixed refund wallet can reclaim unused funds; existing buyer claims stay protected. A CTO cannot change that wallet.",
    source: { path: "contracts/src/module-mode/modules/EveryNthBuyRewardV1.sol", sha256: "0390c47404c11c9f15a2e6c87c8b8dc8e183623c7134e2903f9103168f6dfc0c" },
    schema: { type: "record", required: ["everyN", "minimumGrossNative", "rewardNative", "endsAt", "includeInitialBuy", "refundWallet"], fields: {
      everyN: { type: "uint", bits: 32, min: "1", label: "Reward every", unit: "buys" },
      minimumGrossNative: { type: "uint", bits: 128, min: "1", label: "Minimum qualifying buy", help: "The ETH buy amount includes fees.", unit: "ETH.wei" },
      rewardNative: { type: "uint", bits: 128, min: "1", label: "Reward amount", unit: "ETH.wei" },
      endsAt: { type: "uint", bits: 64, min: "1", label: "Rewards end at", help: "UTC time. Rewards stop at this time; the refund wallet can then reclaim unused funds.", unit: "unix.seconds" },
      includeInitialBuy: { type: "bool", label: "Count the initial buy toward rewards" },
      refundWallet: { type: "account", label: "Unused budget recipient", help: "Fixed at launch. This wallet can reclaim unused ETH after the end date. Changing the coin's creator fee recipient does not change it." },
    } },
    defaults: { everyN: "10", minimumGrossNative: "0.001", rewardNative: "0.0001", endsAt: "", includeInitialBuy: false, refundWallet: { address: "" } },
    fields: { "/everyN": { suffix: "buys" }, "/minimumGrossNative": { decimals: 18, suffix: "ETH" }, "/rewardNative": { decimals: 18, suffix: "ETH" }, "/endsAt": { input: "datetime-utc" } },
    programAbi: [{ path: ["everyN"], type: "uint32" }, { path: ["minimumGrossNative"], type: "uint128" }, { path: ["rewardNative"], type: "uint128" }, { path: ["endsAt"], type: "uint64" }, { path: ["includeInitialBuy"], type: "bool" }, { path: ["refundWallet"], type: "address" }],
    funding: { label: "Additional reward budget", defaultEth: "0.01", help: "Prepaid ETH for this module. A zero budget pays no rewards until funded. Unused funds can be reclaimed by the fixed refund wallet after the end date." },
    futureTimestampFields: ["endsAt"], nonzeroAccountFields: ["refundWallet"],
  },
];

export function createModuleModeState(): ModuleModeState {
  return { name: "", symbol: "", description: "", tokenImage: { kind: "none" }, initialBuyEth: "", buyFeePercent: "0", sellFeePercent: "0", selectedModules: [], moduleValues: {}, moduleFundingEth: {} };
}

export function utcDateTimeToSeconds(input: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(input);
  if (!match) throw new Error("Choose a date and time in UTC.");
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part ?? "0"));
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] ?? "00"}Z`);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second || date.getTime() < 0) throw new Error("Choose a valid date and time in UTC.");
  return String(date.getTime() / 1000);
}

export const DURATION_UNITS = { seconds: 1n, minutes: 60n, hours: 3600n, days: 86400n } as const;
export function durationToSeconds(value: FormValue): string {
  if (typeof value === "string") return parseExactUnits(value);
  const { amount, unit } = asFormRecord(value);
  if (typeof amount !== "string" || typeof unit !== "string" || !Object.hasOwn(DURATION_UNITS, unit)) throw new Error("Enter a duration and choose its unit.");
  const match = /^(\d+)(?:\.(\d{1,18}))?$/.exec(amount.trim());
  if (!match || amount.length > 100) throw new Error("Enter a positive duration.");
  const fraction = match[2] ?? "";
  const numerator = BigInt(`${match[1]}${fraction}`) * DURATION_UNITS[unit as keyof typeof DURATION_UNITS];
  const denominator = 10n ** BigInt(fraction.length);
  if (numerator % denominator !== 0n) throw new Error("Choose a duration that equals a whole number of seconds.");
  return (numerator / denominator).toString();
}

export function validateTokenImage(image: ModuleModeImage): string | null {
  if (!image || typeof image !== "object") return "Choose a token image or enter its public HTTPS image URL.";
  if (image.kind === "none") return "Choose a token image or enter its public HTTPS image URL.";
  if (image.kind === "uri") {
    try {
      const url = new URL(image.uri);
      if (url.protocol !== "https:" || !url.hostname.includes(".") || url.username || url.password || url.port || url.hash || new TextEncoder().encode(image.uri).length > MAX_METADATA_URL_BYTES) throw new Error();
      if (/^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.)/i.test(url.hostname) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(url.hostname) || url.hostname.endsWith(".local")) throw new Error();
      return null;
    } catch { return "Enter a public HTTPS image URL without credentials, or choose an image file."; }
  }
  return image.kind === "local" && image.mimeType === "image/webp" && /^0x[0-9a-f]{64}$/.test(image.sha256) && Number.isInteger(image.bytes) && image.bytes > 0 && image.bytes <= MAX_TOKEN_IMAGE_UPLOAD_BYTES ? null : "Choose the token image again so its prepared file can be checked.";
}

export function formatNativeWei(value: string) { return formatUnits(BigInt(value), 18); }

export function nativeValueBreakdown(state: ModuleModeState, catalog: readonly ModuleModeCatalogEntry[]) {
  try {
    const initial = BigInt(parseExactUnits(state.initialBuyEth || "0", 18));
    let funding = 0n;
    for (const id of state.selectedModules) if (catalog.find((entry) => entry.id === id)?.funding) funding += BigInt(parseExactUnits(state.moduleFundingEth[id] ?? "0", 18));
    return { initialBuy: formatUnits(initial, 18), funding: formatUnits(funding, 18), total: formatUnits(initial + funding, 18) };
  } catch { return { initialBuy: "—", funding: "—", total: "—" }; }
}

export function encodeProgramConfiguration(arguments_: ProgramArgument[], config: ReturnType<typeof compileOpenConfig>): `0x${string}` {
  function argumentValue(type: string, path: string[]): unknown {
    let value: unknown = config.value;
    for (const key of path) value = (value as Record<string, unknown>)?.[key];
    const array = /^(.*)\[([0-9]*)\]$/.exec(type);
    if (array) {
      if (!Array.isArray(value) || (array[2] !== "" && value.length !== Number(array[2]))) throw new Error("The configured list does not match the reviewed ABI array.");
      return value.map((_, index) => argumentValue(array[1], [...path, String(index)]));
    }
    if (/^uint(?:\d+)?$/.test(type)) return BigInt(String(value));
    if (type === "address") return configurationAddress(config, path);
    return value;
  }
  const values = arguments_.map((argument) => argumentValue(argument.type, argument.path));
  return encodeAbiParameters(arguments_.map((argument) => ({ type: argument.type } as AbiParameter)), values);
}

function configurationAddress(config: ReturnType<typeof compileOpenConfig>, path: string[]): string {
  let value: unknown = config.value;
  for (const key of path) value = (value as Record<string, unknown>)[key];
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as Record<string, unknown>).address === "string") return String((value as Record<string, unknown>).address);
  const pointer = path.reduce((parent, key) => pathKey(parent, key), "");
  const binding = config.bindings.find((item) => item.path === pointer);
  if (!binding) throw new Error("Bind the configured wallet before reviewing this program.");
  return binding.kind === "asset" ? binding.resolved.address : binding.resolved;
}

export function cloneFormValue<T extends FormValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function defaultSchemaValue(schema: OpenConfigSchema): FormValue {
  switch (schema.type) {
    case "record": return Object.fromEntries(schema.required.map((key) => [key, defaultSchemaValue(schema.fields[key])]));
    case "array": return Array.from({ length: schema.minItems ?? 0 }, () => defaultSchemaValue(schema.items));
    case "variant": { const branch = Object.keys(schema.variants)[0]; return { [schema.tag]: branch, ...asFormRecord(defaultSchemaValue(schema.variants[branch])) }; }
    case "bool": return false;
    case "account": return { address: "" };
    case "asset": return { asset: "" };
    case "component": return { component: "" };
    case "uint": return String(schema.min ?? "0");
    case "bytes": return "0x";
    default: return "";
  }
}
export function asFormRecord(value: FormValue | undefined): Record<string, FormValue> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function setModuleSelected(state: ModuleModeState, entry: ModuleModeCatalogEntry, selected: boolean): ModuleModeState {
  const defaults = cloneFormValue(entry.defaults);
  const defaultRecord = asFormRecord(defaults);
  for (const key of entry.futureTimestampFields ?? []) if (defaultRecord[key] === "") defaultRecord[key] = new Date(Date.now() + 86400_000).toISOString().slice(0, 16);
  return {
    ...state,
    selectedModules: selected ? [...new Set([...state.selectedModules, entry.id])] : state.selectedModules.filter((id) => id !== entry.id),
    moduleValues: Object.hasOwn(state.moduleValues, entry.id) ? state.moduleValues : { ...state.moduleValues, [entry.id]: defaults },
    moduleFundingEth: Object.hasOwn(state.moduleFundingEth, entry.id) || !entry.funding ? state.moduleFundingEth : { ...state.moduleFundingEth, [entry.id]: entry.funding.defaultEth },
  };
}

export function parseExactUnits(input: string, decimals = 0, multiplier = "1"): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77 || !/^[1-9]\d{0,77}$/.test(multiplier)) throw new Error("Invalid field display settings.");
  const value = input.trim();
  if (value.length > 160 || !/^\d+(?:\.\d+)?$/.test(value)) throw new Error("Enter a positive number or 0. Use a dot for decimals.");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error(decimals === 0 ? "Enter a whole number." : `Use no more than ${decimals} decimal places.`);
  return (BigInt(`${whole}${fraction.padEnd(decimals, "0")}`) * BigInt(multiplier)).toString();
}

function pathKey(path: string, key: string | number) { return `${path}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`; }

/** Converts display units without floating-point math, retaining invalid text in the form. */
export function configurationFromForm(schema: OpenConfigSchema, value: FormValue, fields: Record<string, FieldDisplay> = {}, path = "", schemaPath = ""): FormValue {
  if (schema.type === "uint") {
    try {
      const display = fields[schemaPath];
      if (display?.input === "duration") return durationToSeconds(value);
      if (typeof value !== "string") throw new Error("Enter a number.");
      if (display?.input === "datetime-utc") return utcDateTimeToSeconds(value);
      return parseExactUnits(value, display?.decimals, display?.multiplier);
    } catch (error) { throw Object.assign(error instanceof Error ? error : new Error("Check this number."), { path }); }
  }
  if (schema.type === "record") {
    const record = asFormRecord(value);
    return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, schema.fields[key] ? configurationFromForm(schema.fields[key], child, fields, pathKey(path, key), pathKey(schemaPath, key)) : child]));
  }
  if (schema.type === "array" && Array.isArray(value)) return value.map((child, index) => configurationFromForm(schema.items, child, fields, pathKey(path, index), `${schemaPath}/*`));
  if (schema.type === "variant") {
    const record = asFormRecord(value);
    const branch = record[schema.tag];
    if (typeof branch !== "string" || !schema.variants[branch]) return value;
    const children = { ...record }; delete children[schema.tag];
    return { [schema.tag]: branch, ...asFormRecord(configurationFromForm(schema.variants[branch], children, fields, path, `${schemaPath}/${branch}`)) };
  }
  return value;
}

export function feeBreakdown(buyPercent: string, sellPercent: string) {
  function total(value: string) { return /^(?:[0-9]|10)$/.test(value) ? `${Number(value)}.20%` : "—"; }
  return { buy: total(buyPercent), sell: total(sellPercent), programmable: "0.20%" };
}

export function programmableFeeAllocation(moduleCount: number) {
  return moduleCount > 0
    ? "0.10% to Programmable + 0.10% shared equally by the selected module authors."
    : "The full 0.20% goes to Programmable when no modules are selected.";
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

/** A local configuration check, never release, admission, price or wallet authorization evidence. */
export function validateModuleModeDraft(state: ModuleModeState, catalog: readonly ModuleModeCatalogEntry[] = PREVIEW_MODULE_CATALOG, context: OpenConfigContext = {}, engine: ModuleModeEngineProfile = NATIVE_ENGINE_PROFILE, nowSeconds = Math.floor(Date.now() / 1000), minimumInitialBuyWei?: string): DraftResult {
  const issues: BuilderIssue[] = [];
  if (!/^[a-z][a-z0-9_.-]{1,127}$/.test(engine.id) || !Number.isSafeInteger(engine.version) || engine.version < 1) issues.push({ path: "/engine", message: "The engine profile is missing or invalid. Refresh before reviewing." });
  const name = state.name.trim(); const symbol = state.symbol.trim(); const description = state.description.trim();
  if (!name || new TextEncoder().encode(name).length > MAX_TOKEN_NAME_BYTES) issues.push({ path: "/name", message: `Enter a token name of up to ${MAX_TOKEN_NAME_BYTES} UTF-8 bytes.` });
  if (!/^[A-Za-z0-9]{1,12}$/.test(symbol)) issues.push({ path: "/symbol", message: "Use 1–12 letters or numbers for the symbol." });
  if (new TextEncoder().encode(description).length > MAX_TOKEN_DESCRIPTION_BYTES) issues.push({ path: "/description", message: `Keep the description within ${MAX_TOKEN_DESCRIPTION_BYTES} UTF-8 bytes.` });
  const imageError = validateTokenImage(state.tokenImage);
  if (imageError) issues.push({ path: "/tokenImage", message: imageError });
  let initialBuyWei = "0";
  try { initialBuyWei = parseExactUnits(state.initialBuyEth, 18); if (BigInt(initialBuyWei) <= 0n || BigInt(initialBuyWei) > (1n << 127n) - 1n) throw new Error(); }
  catch { issues.push({ path: "/initialBuyEth", message: "Enter an ETH amount above 0, with up to 18 decimal places." }); }
  if (minimumInitialBuyWei !== undefined) {
    if (!/^[1-9]\d{0,77}$/.test(minimumInitialBuyWei) || BigInt(minimumInitialBuyWei) > (1n << 127n) - 1n) {
      issues.push({ path: "/initialBuyEth", message: "The launch minimum could not be verified. Refresh availability before continuing." });
    } else if (!issues.some((issue) => issue.path === "/initialBuyEth") && BigInt(initialBuyWei) < BigInt(minimumInitialBuyWei)) {
      issues.push({ path: "/initialBuyEth", message: `The launch minimum is ${formatNativeWei(minimumInitialBuyWei)} ETH. Increase your initial buy.` });
    }
  }
  for (const [key, value] of [["buyFeePercent", state.buyFeePercent], ["sellFeePercent", state.sellFeePercent]]) {
    if (!/^(?:[0-9]|10)$/.test(value)) issues.push({ path: `/${key}`, message: "Choose a whole percentage from 0% to 10%." });
  }
  const creatorBuyBps = Number(state.buyFeePercent) * 100;
  const creatorSellBps = Number(state.sellFeePercent) * 100;
  const modules: ModuleModeDraft["modules"] = [];
  if (new Set(state.selectedModules).size !== state.selectedModules.length) issues.push({ path: "/modules", message: "A module appears more than once. Remove its duplicate." });
  const seenCatalogIds = new Set<string>();
  for (const entry of catalog) {
    if (seenCatalogIds.has(entry.id)) issues.push({ path: "/modules", message: "The module catalog contains duplicate entries. Refresh before reviewing." });
    seenCatalogIds.add(entry.id);
  }
  for (const id of state.selectedModules) {
    const entry = catalog.find((candidate) => candidate.id === id);
    if (!entry) { issues.push({ path: `/modules/${id}`, message: "This module is missing from the current catalog. Your settings are kept." }); continue; }
    if (entry.engine.id !== engine.id || entry.engine.version !== engine.version) { issues.push({ path: `/modules/${id}`, message: `${entry.title} belongs to a different engine. Choose a module from this engine's catalog.` }); continue; }
    try {
      const value = state.moduleValues[id];
      if (value === undefined) throw new Error("Add the module settings.");
      const config = compileOpenConfig(entry.schema, configurationFromForm(entry.schema, value, entry.fields), context);
      if (!issues.some((issue) => issue.path.endsWith("FeePercent"))) {
        const constraints = evaluateOpenConstraints(entry.constraints ?? [], {
          $self: { schema: entry.schema, value: config.value },
          base: { schema: baseSchema, value: { buyCreatorFeeBps: String(creatorBuyBps), sellCreatorFeeBps: String(creatorSellBps) } },
        });
        issues.push(...constraints.violations.map((violation) => ({ path: `/modules/${id}`, message: violation.message })));
      }
      const record = config.value as Record<string, OpenConfigValue>;
      if (entry.initialBuyLimitField && (!entry.initialBuyLimitEnabledField || record[entry.initialBuyLimitEnabledField] === true)) {
        const limit = BigInt(String(record[entry.initialBuyLimitField]));
        if (limit > 0n && BigInt(initialBuyWei) > limit) issues.push({ path: "/initialBuyEth", message: `The initial buy exceeds the ${entry.title.toLowerCase()} maximum. Reduce the buy or increase the limit.` });
      }
      for (const key of entry.futureTimestampFields ?? []) {
        if (BigInt(String(record[key])) <= BigInt(nowSeconds)) issues.push({ path: `/modules/${id}/${key}`, message: "Choose an end date in the future. It will be checked again against chain time before launch." });
      }
      for (const key of entry.nonzeroAccountFields ?? []) {
        if (/^0x0{40}$/i.test(configurationAddress(config, [key]))) issues.push({ path: `/modules/${id}/${key}`, message: "Use a nonzero wallet address for the unused budget recipient." });
      }
      let fundingWei = "0";
      if (entry.funding) {
        try { fundingWei = parseExactUnits(state.moduleFundingEth[id] ?? "", 18); if (BigInt(fundingWei) > (1n << 256n) - 1n) throw new Error(); }
        catch { issues.push({ path: `/funding/${id}`, message: "Enter a valid additional ETH budget, with up to 18 decimal places. Use 0 for no funding at launch." }); }
      }
      const legacyConfigurationBytes = entry.legacyUint256Order ? encodeAbiParameters(entry.legacyUint256Order.map(() => ({ type: "uint256" })), entry.legacyUint256Order.map((key) => BigInt(String(record[key])))) : undefined;
      const programConfigurationBytes = entry.programAbi ? encodeProgramConfiguration(entry.programAbi, config) : legacyConfigurationBytes ?? config.encoded;
      modules.push({ id, version: entry.version, catalogDigest: sha256(stringToHex(stableJson(entry))), source: entry.source, configuration: config.value, configurationBytes: config.encoded, programConfigurationBytes, fundingWei, bindings: config.bindings, ...(legacyConfigurationBytes ? { legacyConfigurationBytes } : {}) });
    } catch (error) {
      const detail = error as { path?: string; message?: string };
      issues.push({ path: `/modules/${id}${detail.path ?? ""}`, message: detail.message ?? "Check the module settings." });
    }
  }
  const totalProgramFundingWei = modules.reduce((total, entry) => total + BigInt(entry.fundingWei), 0n).toString();
  const totalNativeValueWei = (BigInt(initialBuyWei) + BigInt(totalProgramFundingWei)).toString();
  if (BigInt(totalNativeValueWei) > (1n << 256n) - 1n) issues.push({ path: "/initialBuyEth", message: "The combined initial buy and program budgets exceed the native value limit." });
  if (issues.length > 0) return { ok: false, issues };
  const image: Exclude<ModuleModeImage, { kind: "none" }> = state.tokenImage.kind === "uri"
    ? { kind: "uri", uri: state.tokenImage.uri, contentVerified: false }
    : { kind: "local", sha256: (state.tokenImage as Extract<ModuleModeImage, { kind: "local" }>).sha256, mimeType: "image/webp", bytes: (state.tokenImage as Extract<ModuleModeImage, { kind: "local" }>).bytes };
  const draft = {
    format: "programmable.module-mode.draft.v0.1" as const, status: "preview" as const,
    launchable: false as const, onchainApproved: false as const, walletAuthorizationVerified: false as const,
    chainId: 4663 as const, quoteAsset: "native-ETH" as const,
    engine,
    token: { name, symbol, description, image }, initialBuyWei, totalProgramFundingWei, totalNativeValueWei,
    fees: { creatorBuyBps, creatorSellBps, programmableBps: 20 as const, asset: "native-ETH" as const },
    modules,
  };
  return { ok: true, draft: { ...draft, draftId: sha256(stringToHex(stableJson(draft))) } };
}

export function configurationSummary(schema: OpenConfigSchema, value: FormValue, fields: Record<string, FieldDisplay> = {}, title = "Configuration", path = "", bindings: ReturnType<typeof compileOpenConfig>["bindings"] = [], configurationPath = ""): { label: string; value: string }[] {
  const label = schema.label ?? title;
  if (fields[path]?.input === "duration") { const duration = asFormRecord(value); return [{ label, value: typeof value === "string" ? `${value} seconds` : `${duration.amount} ${duration.unit}` }]; }
  if (fields[path]?.input === "datetime-utc") return [{ label, value: `${String(value).replace("T", " ")} UTC` }];
  if (schema.type === "record") {
    const record = asFormRecord(value);
    return Object.entries(schema.fields).flatMap(([key, child]) => Object.hasOwn(record, key) ? configurationSummary(child, record[key], fields, key, `${path}/${key}`, bindings, `${configurationPath}/${key}`) : []);
  }
  if (schema.type === "array" && Array.isArray(value)) return value.flatMap((child, index) => configurationSummary(schema.items, child, fields, `${label} ${index + 1}`, `${path}/*`, bindings, `${configurationPath}/${index}`).map((item) => ({ ...item, label: `${label} ${index + 1} · ${item.label}` })));
  if (schema.type === "variant") {
    const record = asFormRecord(value); const branch = String(record[schema.tag]); const branchSchema = schema.variants[branch];
    return [{ label, value: branchSchema?.label ?? branch }, ...(branchSchema ? configurationSummary(branchSchema, record, fields, label, `${path}/${branch}`, bindings, configurationPath) : [])];
  }
  if (schema.type === "account") { const record = asFormRecord(value); const binding = bindings.find((item) => item.path === configurationPath && item.kind === "account"); return [{ label, value: typeof record.role === "string" ? `Role: ${record.role}${binding ? ` · ${binding.resolved}` : ""}` : String(record.address ?? "") }]; }
  if (schema.type === "asset" || schema.type === "component") return [{ label, value: String(asFormRecord(value)[schema.type] ?? "") }];
  return [{ label, value: schema.type === "bool" ? value ? "On" : "Off" : `${String(value)}${fields[path]?.suffix ? ` ${fields[path].suffix}` : ""}` }];
}
