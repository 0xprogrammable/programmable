import { encodeAbiParameters, keccak256, type Address } from "viem";
import type { LaunchAddressRefV1, LaunchClaimDescriptorV1, LaunchProjectionV1 } from "./launch-plan-v1";
import type { RobinhoodLaunch } from "@/lib/robinhood-launches";

export const LAUNCH_PROJECTION_FEED_V1 = "https://api.programmable.market/v4/chains/4663/finalized-launch-projections";
export const projectionAddress = (value: unknown): value is Address => typeof value === "string" && /^0x[\da-f]{40}$/i.test(value);
export const projectionHash = (value: unknown): value is `0x${string}` => typeof value === "string" && /^0x[\da-f]{64}$/i.test(value);
export const projectionUint = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value);
export const projectionObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const digest = (value: unknown) => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 4096;
const hex = (value: unknown) => typeof value === "string" && /^0x(?:[0-9a-f]{2})*$/i.test(value) && value.length <= 2_097_154;
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const witness = (value: unknown) => projectionObject(value) && text(value.kind) && text(value.ref) && projectionObject(value.details);
const list = (value: unknown, maximum = 256): value is unknown[] => Array.isArray(value) && value.length <= maximum;
const ref = (value: unknown) => projectionObject(value) && (projectionAddress(value.address) || text(value.componentId));
const member = (value: unknown, options: readonly string[]) => typeof value === "string" && options.includes(value);

export function isBoundLaunchClaimDescriptorV1(value: unknown): value is LaunchClaimDescriptorV1 {
  return projectionObject(value) && text(value.claimId) && projectionUint(value.chainId)
    && [value.asset, value.accrualContract, value.requiredController, value.beneficiary].every(projectionAddress)
    && (value.immutableRecipient === null || projectionAddress(value.immutableRecipient))
    && projectionHash(value.runtimeCodeHash) && witness(value.proof)
    && projectionObject(value.read) && value.read.resultType === "uint256" && hex(value.read.data)
    && projectionObject(value.claim) && hex(value.claim.data) && String(value.claim.data).length >= 10 && value.claim.value === "0";
}

/** Structural parsing of the public read model, never an eligibility or finality decision. */
export function parseLaunchProjectionV1(value: unknown): LaunchProjectionV1 {
  if (!projectionObject(value) || value.schemaVersion !== "programmable.launch-projection.v1"
    || !member(value.sourceVersion, ["router_v1", "multi_role_v2", "custom_launch_plan_v1"])
    || !text(value.launchId) || !projectionUint(value.chainId) || !projectionAddress(value.controller)
    || !(value.manifestDigest === null || digest(value.manifestDigest)) || !(value.planHash === null || digest(value.planHash))
    || !list(value.components) || !list(value.markets) || !list(value.assuranceClaims, 1024) || !list(value.claimDescriptors)
    || !value.claimDescriptors.every(isBoundLaunchClaimDescriptorV1)
    || !projectionObject(value.distribution) || !projectionObject(value.finality)
    || !member(value.sourceVerification, ["pending", "verified", "partial", "failed"])) throw new Error("Invalid launch projection");
  const ids = new Set<string>();
  for (const component of value.components) {
    if (!projectionObject(component) || !text(component.componentId) || !text(component.artifactId)
      || !projectionAddress(component.expectedAddress) || !projectionHash(component.runtimeCodeHash)
      || ids.has(component.componentId)) throw new Error("Invalid projection component");
    ids.add(component.componentId);
  }
  const validRef = (candidate: unknown) => ref(candidate) && projectionObject(candidate)
    && (projectionAddress(candidate.address) || typeof candidate.componentId === "string" && ids.has(candidate.componentId));
  const markets = new Set<string>();
  for (const market of value.markets) {
    if (!projectionObject(market) || !text(market.marketId) || markets.has(market.marketId) || market.kind !== "uniswap_v4"
      || !projectionAddress(market.poolManager) || ![market.currency0, market.currency1, market.hooks].every(validRef)
      || !Number.isInteger(market.fee) || Number(market.fee) < 0 || Number(market.fee) > 0xffffff
      || !Number.isInteger(market.tickSpacing) || Number(market.tickSpacing) < -8388608 || Number(market.tickSpacing) > 8388607) {
      throw new Error("Invalid projection market");
    }
    markets.add(market.marketId);
  }
  if (!(value.primaryComponentId === null || typeof value.primaryComponentId === "string" && ids.has(value.primaryComponentId))
    || !(value.primaryMarketId === null || typeof value.primaryMarketId === "string" && markets.has(value.primaryMarketId))) {
    throw new Error("Invalid projection primary reference");
  }
  for (const claim of value.assuranceClaims) {
    if (!projectionObject(claim) || !text(claim.claimType) || !text(claim.subject) || !Object.hasOwn(claim, "observedValue")
      || !member(claim.status, ["verified", "unresolved", "disclosed"]) || !witness(claim.witness)
      || !text(claim.assessor) || !text(claim.assessorVersion) || !text(claim.validAt)
      || !(claim.blockNumber === null || projectionUint(claim.blockNumber))) throw new Error("Invalid projection claim");
  }
  for (const claim of value.claimDescriptors) {
    if (claim.chainId !== value.chainId) {
      throw new Error("Claim descriptor chain differs from the launch");
    }
  }
  const distribution = value.distribution;
  if (!member(distribution.programmableRouting, ["untested", "compatible", "adapter_required", "incompatible"])
    || !member(distribution.uniswapApi, ["not_requested", "pending", "available", "unavailable"])
    || !member(distribution.uniswapLabsRouting, ["unknown", "automatic", "review_required", "allowed", "unavailable"])
    || !member(distribution.hooklist, ["not_requested", "queued", "submitted", "merged", "rejected"])) throw new Error("Invalid distribution state");
  const finality = value.finality;
  if (!member(finality.status, ["pending", "final"]) || !list(finality.transactionHashes) || !finality.transactionHashes.every(projectionHash)
    || !(finality.blockNumber === null || projectionUint(finality.blockNumber)) || !(finality.blockHash === null || projectionHash(finality.blockHash))
    || !(finality.witness === null || witness(finality.witness))
    || (finality.status === "final" && (!finality.transactionHashes.length || finality.blockNumber === null || finality.blockHash === null || finality.witness === null))) {
    throw new Error("Invalid projection finality");
  }
  if (Object.hasOwn(value, "createdAt") && !date(value.createdAt)) throw new Error("Invalid projection time");
  if (Object.hasOwn(value, "finalizedAt") && !(value.finalizedAt === null || date(value.finalizedAt))) throw new Error("Invalid projection time");
  // Publication is optional presentation. Never turn a missing image, name or symbol into a technical gate.
  if (value.publication !== null && (!projectionObject(value.publication)
    || !member(value.publication.visibility, ["listed", "unlisted"]))) throw new Error("Invalid publication visibility");
  return value as unknown as LaunchProjectionV1;
}

export function resolveProjectionAddress(projection: LaunchProjectionV1, reference: LaunchAddressRefV1): Address {
  if ("address" in reference) return reference.address;
  const component = projection.components.find(item => item.componentId === reference.componentId);
  if (!component) throw new Error("Unknown component reference");
  return component.expectedAddress;
}

export function projectionPrimaryAddress(projection: LaunchProjectionV1): Address | null {
  return projection.components.find(item => item.componentId === projection.primaryComponentId)?.expectedAddress ?? null;
}

/** The address used by existing Coin routes is an identity, not an inferred ERC-20 role. */
export function projectionToRobinhoodLaunch(projection: LaunchProjectionV1, launchedAt: string | null = null): RobinhoodLaunch {
  if (projection.chainId !== "4663" || projection.finality.status !== "final") throw new Error("Projection is not final on Robinhood");
  const primaryAssetAddress = projectionPrimaryAddress(projection);
  const address = primaryAssetAddress ?? projection.components[0]?.expectedAddress;
  if (!address) throw new Error("Projection has no addressable component");
  const market = projection.markets.find(item => item.marketId === projection.primaryMarketId) ?? null;
  const cleanText = (value: unknown) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, 128) || null : null;
  return {
    sourceKind: projection.sourceVersion === "multi_role_v2" ? "multi-role-v2" : "custom-launch-plan-v1",
    launchProjection: projection, primaryAssetAddress, routerAddress: null, stampHash: null,
    launchId: projection.launchId, tokenAddress: address, creator: projection.controller,
    hookAddress: market ? resolveProjectionAddress(projection, market.hooks) : null,
    poolManager: market?.poolManager ?? null,
    poolId: market ? keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
      [resolveProjectionAddress(projection, market.currency0), resolveProjectionAddress(projection, market.currency1), market.fee, market.tickSpacing, resolveProjectionAddress(projection, market.hooks)])) : null,
    transactionHash: projection.finality.transactionHashes.at(-1)!, blockNumber: projection.finality.blockNumber!, blockHash: projection.finality.blockHash!,
    logIndex: 0, launchedAt, name: cleanText(projection.publication?.name), symbol: cleanText(projection.publication?.symbol), decimals: null,
  };
}

export function isRobinhoodProjectedLaunch(value: unknown): value is RobinhoodLaunch & { launchProjection: LaunchProjectionV1; primaryAssetAddress: string | null } {
  if (!projectionObject(value) || !member(value.sourceKind, ["multi-role-v2", "custom-launch-plan-v1"])) return false;
  try {
    const projection = parseLaunchProjectionV1(value.launchProjection);
    const expected = projectionToRobinhoodLaunch(projection, typeof value.launchedAt === "string" ? value.launchedAt : null);
    return ["launchId", "tokenAddress", "creator", "hookAddress", "poolManager", "poolId", "blockNumber", "blockHash", "transactionHash", "primaryAssetAddress", "routerAddress", "stampHash", "name", "symbol"]
      .every(key => (value[key] as string | null)?.toLowerCase() === (expected[key as keyof RobinhoodLaunch] as string | null)?.toLowerCase());
  } catch { return false; }
}

export function projectionPublicUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
