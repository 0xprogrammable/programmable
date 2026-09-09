// Pure wire codec mirrored from the canonical backend stamp-custom-launch-plan-v1.ts.
// Server preparation and signing are intentionally absent from this browser module.
import { concatHex, encodeAbiParameters, hashTypedData, keccak256, parseAbiParameters, type Address, type Hex } from "viem";
import type { CustomLaunchPlanV1 } from "./launch-plan-v1";
import { canonicalBrowserSha256V2 } from "./browser-authority-v2";
type Sha256Digest = `sha256:${string}`;
const framedSha256Json = canonicalBrowserSha256V2;
const customLaunchPlanHashV1 = (plan: CustomLaunchPlanV1) => canonicalBrowserSha256V2("programmable.custom-launch-plan.v1", plan);
export const CUSTOM_LAUNCH_PLAN_STAMP_SELECTOR_V1 = "0xbda52856" as const;
const PERMIT_FIELDS = [
  { name: "chainId", type: "uint256" }, { name: "stamp", type: "address" }, { name: "controller", type: "address" },
  { name: "controllerRuntimeCodeHash", type: "bytes32" }, { name: "launchId", type: "bytes32" },
  { name: "planHash", type: "bytes32" }, { name: "manifestDigest", type: "bytes32" },
  { name: "componentsHash", type: "bytes32" }, { name: "marketsHash", type: "bytes32" },
  { name: "effectsHash", type: "bytes32" }, { name: "feeObligationsHash", type: "bytes32" },
  { name: "executionEvidenceHash", type: "bytes32" }, { name: "nonce", type: "bytes32" },
  { name: "validAfter", type: "uint64" }, { name: "deadline", type: "uint64" },
] as const;
const COMPONENT_FIELDS = [{ name: "componentId", type: "bytes32" }, { name: "account", type: "address" },
  { name: "runtimeCodeHash", type: "bytes32" }] as const;
const MARKET_FIELDS = [{ name: "marketId", type: "bytes32" }, { name: "poolManager", type: "address" },
  { name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] as const;
export const CUSTOM_LAUNCH_PLAN_STAMP_PERMIT_TYPES_V1 = { ProgrammableLaunchPlanStampPermitV1: PERMIT_FIELDS } as const;
export const CUSTOM_LAUNCH_PLAN_STAMP_ABI_V1 = [{ type: "function", name: "stampPlanV1", stateMutability: "nonpayable",
  inputs: [{ name: "permit", type: "tuple", components: PERMIT_FIELDS },
    { name: "components", type: "tuple[]", components: COMPONENT_FIELDS },
    { name: "markets", type: "tuple[]", components: MARKET_FIELDS }, { name: "platformSignature", type: "bytes" }], outputs: [] }] as const;
const COMPONENT_TYPEHASH = "0xa9cb6d20d244d15ab4a0da2a1573c293b669f578bec148258bffe621e21b1cc5" as Hex;
const MARKET_TYPEHASH = "0x35e0fdfa8ada04d4bb371d32164a686cd01ee4c67246bd4481a0cf94cd0c00c1" as Hex;
const STAMP_TYPEHASH = "0xd471d40b4f0024c6dd05aa42ff427d7408df1aee1f42c5586f6c67e28b552294" as Hex;
export interface CustomLaunchPlanStampPermitV1 {
  readonly chainId: string; readonly stamp: Address; readonly controller: Address; readonly controllerRuntimeCodeHash: Hex;
  readonly launchId: Hex; readonly planHash: Hex; readonly manifestDigest: Hex; readonly componentsHash: Hex;
  readonly marketsHash: Hex; readonly effectsHash: Hex; readonly feeObligationsHash: Hex;
  readonly executionEvidenceHash: Hex; readonly nonce: Hex; readonly validAfter: string; readonly deadline: string;
}
export interface CustomLaunchPlanStampComponentV1 { readonly componentId: Hex; readonly account: Address; readonly runtimeCodeHash: Hex }
export interface CustomLaunchPlanStampMarketV1 { readonly marketId: Hex; readonly poolManager: Address;
  readonly currency0: Address; readonly currency1: Address; readonly fee: number; readonly tickSpacing: number; readonly hooks: Address }
export function customLaunchPlanDigestBytesV1(digest: Sha256Digest): Hex {
  if (!/^sha256:[0-9a-f]{64}$/u.test(digest)) throw new TypeError("Noncanonical launch digest");
  return `0x${digest.slice(7)}`;
}
export function customLaunchPlanOccurrenceIdV1(planHash: Sha256Digest, kind: "component" | "market", id: string): Hex {
  return customLaunchPlanDigestBytesV1(framedSha256Json("programmable.custom-launch-plan-occurrence.v1", { planHash, kind, id }));
}
export function customLaunchPlanLaunchIdV1(plan: CustomLaunchPlanV1): Hex {
  return customLaunchPlanDigestBytesV1(framedSha256Json("programmable.custom-launch-plan-launch-id.v1",
    { chainId: plan.chainId, controller: plan.controller.address.toLowerCase(), planHash: customLaunchPlanHashV1(plan) }));
}
export function customLaunchPlanStampComponentsHashV1(components: readonly CustomLaunchPlanStampComponentV1[]): Hex {
  return keccak256(concatHex(components.map((component) => keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32,bytes32,address,bytes32"), [COMPONENT_TYPEHASH, component.componentId, component.account, component.runtimeCodeHash])))));
}
export function customLaunchPlanStampMarketsHashV1(markets: readonly CustomLaunchPlanStampMarketV1[]): Hex {
  return keccak256(concatHex(markets.map((market) => keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32,bytes32,address,address,address,uint24,int24,address"), [MARKET_TYPEHASH, market.marketId,
      market.poolManager, market.currency0, market.currency1, market.fee, market.tickSpacing, market.hooks])))));
}
export function customLaunchPlanStampPermitDigestV1(permit: CustomLaunchPlanStampPermitV1): Hex {
  return hashTypedData({ domain: { name: "ProgrammableLaunchPlanStamp", version: "1", chainId: BigInt(permit.chainId),
    verifyingContract: permit.stamp }, types: CUSTOM_LAUNCH_PLAN_STAMP_PERMIT_TYPES_V1,
    primaryType: "ProgrammableLaunchPlanStampPermitV1", message: abiPermit(permit) });
}
export function customLaunchPlanStampHashV1(permitDigest: Hex): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters("bytes32,bytes32"), [STAMP_TYPEHASH, permitDigest]));
}
function abiPermit(permit: CustomLaunchPlanStampPermitV1) {
  return { ...permit, chainId: BigInt(permit.chainId), validAfter: BigInt(permit.validAfter), deadline: BigInt(permit.deadline) };
}
