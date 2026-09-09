import { encodeAbiParameters, getAddress, getContractAddress, keccak256, parseAbiParameters, stringToHex, type Address, type Hex } from "viem";
import { IMMUTABLE_POOL_FEE_RECIPES_V1 as recipes } from "./immutable-pool-fee-recipes-custom-launch-plan-v1";

/** The recipes prove one fee property for an exact PoolKey. They confer no
 * source-model eligibility, caller authority or observed-chain status. */
export const IMMUTABLE_POOL_FEE_PROOF_SCHEMA_V1 = "programmable.immutable-pool-fee-runtime-proof.v1" as const;
export const IMMUTABLE_POOL_FEE_RECIPIENT_V1 = "0xD88539d3c4C460136a733A3Fd60cf6BF269079da" as Address;
export const IMMUTABLE_POOL_FEE_MANAGER_V1 = "0x8366a39CC670B4001A1121B8F6A443A643e40951" as Address;
export type ImmutablePoolFeeMarketV1 = Readonly<{ chainId: "4663"; poolManager: Address; currency0: Address;
  currency1: Address; fee: number; tickSpacing: number; hooks: Address }>;
type Recipe = Readonly<{ runtimeTemplateHex: Hex; immutableWords: readonly Readonly<{ name: string; byteOffsets: readonly number[] }>[] }>;
export type ImmutablePoolFeeRecipeIdV1 = keyof typeof recipes;
export type ImmutablePoolFeeRuntimeBindingV1 = Readonly<{ role: "hook" | "controller" | "vault" | "module";
  address: Address; runtimeCodeHash: Hex; immutableWords: Readonly<Record<string, Hex>> | null }>;
export interface ImmutablePoolFeeRuntimeProofV1 {
  readonly schemaVersion: typeof IMMUTABLE_POOL_FEE_PROOF_SCHEMA_V1;
  readonly recipeId: ImmutablePoolFeeRecipeIdV1;
  readonly sourceArtifactHash: string;
  readonly market: ImmutablePoolFeeMarketV1;
  readonly recipient: Address;
  readonly rateBps: 20;
  readonly denominator: 10000;
  readonly scope: "exact_pool_key";
  readonly feeCurrency: "native";
  readonly assessmentBase: "gross_native_leg";
  readonly rounding: "ceil_per_trade";
  readonly accrual: "backed_pool_manager_native_claims";
  readonly claim: "permissionless_fixed_recipient";
  readonly feeVault: Address;
  readonly feeRecorder: Address;
  readonly runtimeBindings: readonly ImmutablePoolFeeRuntimeBindingV1[];
  readonly proofDigest: Hex;
}
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const WORD0 = `0x${"0".repeat(64)}` as Hex;
const issued = new WeakSet<object>();
const lower = (v: string) => v.toLowerCase();
const eq = (a: string, b: string) => lower(a) === lower(b);
const fail = (): never => { throw new TypeError("Exact immutable pool fee source/runtime binding differs"); };
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
}
function frozen<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}
function digest(value: unknown): Hex { return keccak256(stringToHex(`${IMMUTABLE_POOL_FEE_PROOF_SCHEMA_V1}\n${canonical(value)}`)); }
function addressWord(words: Readonly<Record<string, Hex>>, key: string): Address {
  const value = words[key]; if (!value || BigInt(value) >= 1n << 160n) return fail();
  return getAddress(`0x${value.slice(-40)}`);
}
function numberWord(words: Readonly<Record<string, Hex>>, key: string): bigint {
  if (words[key] === undefined) return fail(); return BigInt(words[key]!);
}
function recipeFor(id: ImmutablePoolFeeRecipeIdV1, role: "hook" | "controller" | "vault"): Recipe {
  const selected = recipes[id];
  if (role === "controller") return "controller" in selected ? selected.controller : fail();
  return selected[role];
}

/** Byte-for-byte matching, including every repeated immutable occurrence. */
export function readImmutableFeeRuntimeWordsV1(recipe: Recipe, runtime: Hex): Readonly<Record<string, Hex>> | null {
  if (!/^0x(?:[0-9a-f]{2})+$/i.test(runtime) || runtime.length !== recipe.runtimeTemplateHex.length) return null;
  let normalized = runtime.toLowerCase(); const words: Record<string, Hex> = {}, used = new Set<number>();
  for (const immutable of recipe.immutableWords) {
    if (immutable.byteOffsets.length === 0) return null;
    let value: Hex | undefined;
    for (const offset of immutable.byteOffsets) {
      if (!Number.isSafeInteger(offset) || offset < 0 || offset * 2 + 66 > runtime.length) return null;
      const start = offset * 2 + 2, candidate = runtime.slice(start, start + 64).toLowerCase();
      if (recipe.runtimeTemplateHex.slice(start, start + 64) !== "0".repeat(64) || value && value !== `0x${candidate}`) return null;
      for (let i = offset; i < offset + 32; i++) { if (used.has(i)) return null; used.add(i); }
      value = `0x${candidate}`;
      normalized = `${normalized.slice(0, start)}${"0".repeat(64)}${normalized.slice(start + 64)}`;
    }
    words[immutable.name] = value!;
  }
  return normalized === recipe.runtimeTemplateHex.toLowerCase() ? frozen(words) : null;
}
export function materializeImmutableFeeRuntimeWordsV1(recipe: Recipe, words: Readonly<Record<string, Hex>>): Hex {
  if (Object.keys(words).sort().join() !== recipe.immutableWords.map(w => w.name).sort().join()) return fail();
  let runtime: string = recipe.runtimeTemplateHex;
  for (const immutable of recipe.immutableWords) {
    const word = words[immutable.name]; if (!word || !/^0x[0-9a-f]{64}$/.test(word)) return fail();
    for (const offset of immutable.byteOffsets) { const start = offset * 2 + 2;
      runtime = `${runtime.slice(0, start)}${word.slice(2)}${runtime.slice(start + 64)}`; }
  }
  return runtime as Hex;
}
function hookCandidate(market: ImmutablePoolFeeMarketV1, runtime: Hex) {
  if (market.chainId !== "4663" || !eq(market.poolManager, IMMUTABLE_POOL_FEE_MANAGER_V1) || !eq(market.currency0, ZERO)) return null;
  for (const id of Object.keys(recipes) as ImmutablePoolFeeRecipeIdV1[]) {
    const words = readImmutableFeeRuntimeWordsV1(recipes[id].hook, runtime); if (!words) continue;
    try {
      if (!eq(addressWord(words, "poolManager"), market.poolManager)) continue;
      const blob = id === "blob_fee_controller_v2", vault = addressWord(words, blob ? "platformFeeVault" : "feeVault");
      const controller = blob ? addressWord(words, "platformFeeController") : market.hooks;
      if (!eq(vault, getContractAddress({ from: controller, nonce: 1n }))) continue;
      if (blob) {
        const domain = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,bytes32,bytes32,uint256,address"), [
          keccak256(stringToHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
          keccak256(stringToHex("Blob")), keccak256(stringToHex("1")), 4663n, market.hooks]));
        if (!eq(controller, getContractAddress({ from: market.hooks, nonce: 1n })) || !eq(market.currency1, market.hooks)
          || market.fee !== 3000 || market.tickSpacing !== 60 || (BigInt(market.hooks) & 0x3fffn) !== 0x10ccn
          || numberWord(words, "decimals") !== 18n || numberWord(words, "INITIAL_CHAIN_ID") !== 4663n
          || words.INITIAL_DOMAIN_SEPARATOR !== domain || eq(addressWord(words, "treasury"), ZERO)) continue;
      } else {
        if (!eq(addressWord(words, "token"), market.currency1) || numberWord(words, "lpFee") !== BigInt(market.fee)
          || numberWord(words, "tickSpacing") !== BigInt(market.tickSpacing) || market.tickSpacing <= 0
          || (BigInt(market.hooks) & 0x3fffn) !== 0x20ccn || numberWord(words, "creatorBuyFeeBps") + 20n >= 10000n
          || numberWord(words, "creatorSellFeeBps") + 20n >= 10000n || numberWord(words, "maxModuleLpFeePips") > 1000000n) continue;
        if (id === "native20_combined_v2" && (!eq(market.currency1, market.hooks) || market.fee !== 0 || market.tickSpacing !== 60
          || numberWord(words, "initialSqrtPriceX96") !== 1747735933952748037356115466503453n
          || !eq(addressWord(words, "module"), ZERO) || words.moduleCodeHash !== WORD0 || numberWord(words, "maxModuleLpFeePips") !== 0n)) continue;
        if (eq(addressWord(words, "module"), ZERO) !== (words.moduleCodeHash === WORD0)) continue;
      }
      return { id, words, vault, controller };
    } catch { continue; }
  }
  return null;
}
export function immutablePoolFeeRequiredAddressesV1(market: ImmutablePoolFeeMarketV1, hookRuntime: Hex): readonly Address[] | null {
  const candidate = hookCandidate(market, hookRuntime); if (!candidate) return null;
  const feeModule = candidate.id === "blob_fee_controller_v2" ? ZERO : addressWord(candidate.words, "module");
  return frozen([...new Set([market.hooks, candidate.controller, candidate.vault, ...(feeModule === ZERO ? [] : [feeModule])].map(address => getAddress(address)))]);
}

/** The caller independently reads all runtimeBindings on chain before calling
 * the proof observed. Backend compilation may use the same pure source proof
 * conditionally, with mandatory final runtime observations for every binding. */
export function proveImmutablePoolFeeRuntimeV1(market: ImmutablePoolFeeMarketV1, codes: Readonly<Record<string, Hex>>): ImmutablePoolFeeRuntimeProofV1 | null {
  const code = (address: Address) => codes[lower(address)] ?? codes[address];
  const hookCode = code(market.hooks); if (!hookCode) return null;
  const candidate = hookCandidate(market, hookCode); if (!candidate) return null;
  const { id, words, vault, controller } = candidate;
  const vaultCode = code(vault); if (!vaultCode) return null;
  const vaultWords = readImmutableFeeRuntimeWordsV1(recipes[id].vault, vaultCode);
  if (!vaultWords || !eq(addressWord(vaultWords, "poolManager"), market.poolManager)
    || !eq(addressWord(vaultWords, "kernel"), controller) || eq(addressWord(vaultWords, "creatorRecipient"), ZERO)) return null;
  const bindings: ImmutablePoolFeeRuntimeBindingV1[] = [{ role: "hook", address: getAddress(market.hooks), runtimeCodeHash: keccak256(hookCode), immutableWords: words },
    { role: "vault", address: vault, runtimeCodeHash: keccak256(vaultCode), immutableWords: vaultWords }];
  if (id === "blob_fee_controller_v2") {
    const controllerCode = code(controller); if (!controllerCode) return null;
    const controllerWords = readImmutableFeeRuntimeWordsV1(recipes[id].controller, controllerCode);
    if (!controllerWords || !eq(addressWord(controllerWords, "poolManager"), market.poolManager)
      || !eq(addressWord(controllerWords, "hook"), market.hooks) || !eq(addressWord(controllerWords, "feeVault"), vault)
      || !eq(addressWord(vaultWords, "creatorRecipient"), addressWord(words, "treasury"))) return null;
    bindings.push({ role: "controller", address: controller, runtimeCodeHash: keccak256(controllerCode), immutableWords: controllerWords });
  } else {
    const feeModule = addressWord(words, "module");
    if (!eq(feeModule, ZERO)) {
      const moduleCode = code(feeModule); if (moduleCode !== undefined && keccak256(moduleCode) !== words.moduleCodeHash) return null;
      bindings.push({ role: "module", address: feeModule, runtimeCodeHash: words.moduleCodeHash!, immutableWords: null });
    }
  }
  bindings.sort((a, b) => a.role.localeCompare(b.role));
  const body = { schemaVersion: IMMUTABLE_POOL_FEE_PROOF_SCHEMA_V1, recipeId: id, sourceArtifactHash: recipes[id].sourceArtifactHash,
    market: { ...market, poolManager: getAddress(market.poolManager), currency0: getAddress(market.currency0), currency1: getAddress(market.currency1), hooks: getAddress(market.hooks) },
    recipient: IMMUTABLE_POOL_FEE_RECIPIENT_V1, rateBps: 20 as const, denominator: 10000 as const, scope: "exact_pool_key" as const,
    feeCurrency: "native" as const, assessmentBase: "gross_native_leg" as const, rounding: "ceil_per_trade" as const,
    accrual: "backed_pool_manager_native_claims" as const, claim: "permissionless_fixed_recipient" as const,
    feeVault: vault, feeRecorder: controller, runtimeBindings: bindings };
  const proof = frozen({ ...body, proofDigest: digest(body) }); issued.add(proof); return proof;
}
export function assertIssuedImmutablePoolFeeRuntimeProofV1(proof: ImmutablePoolFeeRuntimeProofV1, market: ImmutablePoolFeeMarketV1): void {
  if (!issued.has(proof) || canonical(proof.market) !== canonical({ ...market, poolManager: getAddress(market.poolManager),
    currency0: getAddress(market.currency0), currency1: getAddress(market.currency1), hooks: getAddress(market.hooks) })) return fail();
}

/** Rebuild the pinned runtime bytes from a serialized property witness. This
 * validates the source statement only. The caller still checks every resulting
 * runtime hash against independent current chain reads, never a success flag. */
export function rebuildImmutablePoolFeeRuntimeProofV1(value: unknown, market: ImmutablePoolFeeMarketV1): ImmutablePoolFeeRuntimeProofV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const supplied = value as ImmutablePoolFeeRuntimeProofV1;
  if (!Object.hasOwn(recipes, supplied.recipeId) || !Array.isArray(supplied.runtimeBindings) || supplied.runtimeBindings.length > 4) return fail();
  const codes: Record<string, Hex> = {};
  for (const binding of supplied.runtimeBindings) {
    if (!binding || !["hook", "controller", "vault", "module"].includes(binding.role)) return fail();
    if (binding.role !== "module") codes[lower(binding.address)] = materializeImmutableFeeRuntimeWordsV1(recipeFor(supplied.recipeId, binding.role), binding.immutableWords!);
  }
  const proof = proveImmutablePoolFeeRuntimeV1(market, codes);
  if (!proof || canonical(proof) !== canonical(supplied)) return fail();
  return proof;
}
