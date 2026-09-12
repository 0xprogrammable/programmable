import "server-only";
import { getAddress, isAddress } from "viem";
import { readRobinhoodToken } from "@/lib/server/robinhood-index/read";
import { readEthereumToken } from "@/lib/server/ethereum-explore";
import { readModuleModeAvailability } from "@/lib/server/module-mode/catalog";
import { readModuleEngineAvailability } from "@/lib/server/module-engine/catalog";
import { isRobinhoodNativeModuleLaunch, isRobinhoodEngineLaunch, robinhoodModuleManageHref, type RobinhoodLaunch } from "@/lib/robinhood-launches";
import { isModuleEngineSharedQuoteRelease } from "@/lib/module-engine/profile";
import { resolveProjectionAddress } from "@/lib/custom-launch/launch-projection-v1";
import { readCustomV4SwapDescriptor } from "./custom-v4";
import { readRobinhoodSwapDecimals } from "./token-metadata";
import { SWAP_TOKEN_SCHEMA, SwapUnavailableError, type SwapChainId, type SwapTokenDescriptor } from "@/lib/swap/types";

const ZERO = "0x0000000000000000000000000000000000000000";
export interface SwapTokenDependencies {
  robinhood: typeof readRobinhoodToken;
  ethereum: typeof readEthereumToken;
  native: typeof readModuleModeAvailability;
  engine: typeof readModuleEngineAvailability;
  custom: typeof readCustomV4SwapDescriptor;
  decimals: typeof readRobinhoodSwapDecimals;
}
const readers: SwapTokenDependencies = {
  robinhood: readRobinhoodToken, ethereum: readEthereumToken,
  native: readModuleModeAvailability, engine: readModuleEngineAvailability, custom: readCustomV4SwapDescriptor, decimals: readRobinhoodSwapDecimals,
};

function tokenMetadata(row: { tokenAddress: string; name: string | null; symbol: string | null; decimals?: number | null; tokenDecimals?: number }) {
  const decimals = row.decimals ?? row.tokenDecimals;
  if (!Number.isInteger(decimals) || decimals! < 0 || decimals! > 36) throw new SwapUnavailableError("The token’s decimals could not be verified. Try again.", "TOKEN_METADATA_UNAVAILABLE");
  return { address: getAddress(row.tokenAddress), name: row.name?.trim() || "Token", symbol: row.symbol?.trim() || "TOKEN", decimals: decimals! };
}
function unavailable(base: Pick<SwapTokenDescriptor, "schemaVersion" | "chainId" | "token" | "manageHref">, reason: string): SwapTokenDescriptor {
  return { ...base, status: "unavailable", route: null, reason };
}

/** Resolve the actual saved launch source. Explore visibility and new-launch
 * eligibility never select a different pool or hide a holder’s existing coin. */
export async function resolveSwapToken(input: { address: string; chainId?: SwapChainId }, dependencies: SwapTokenDependencies = readers): Promise<SwapTokenDescriptor> {
  if (!isAddress(input.address) || input.address.toLowerCase() === ZERO) throw new SwapUnavailableError("Enter a token contract address.", "INVALID_ADDRESS");
  if (input.chainId !== undefined && input.chainId !== 1 && input.chainId !== 4663) throw new SwapUnavailableError("Select Ethereum or Robinhood Chain.", "INVALID_CHAIN");
  const address = getAddress(input.address), chainId = input.chainId ?? 4663;
  if (chainId === 1) {
    const result = await dependencies.ethereum(address);
    if (!result.token) throw new SwapUnavailableError(result.status === "unavailable" ? "Ethereum token details are temporarily unavailable. Try again." : "This token is not in the verified Ethereum launch index.", result.status === "unavailable" ? "INDEX_UNAVAILABLE" : "TOKEN_NOT_FOUND");
    const row = result.token, base = { schemaVersion: SWAP_TOKEN_SCHEMA, chainId: 1 as const, token: tokenMetadata(row), manageHref: null };
    if (row.launchStampProvenance || row.launchModel === "custom-graph" || row.launchModel === "adaptive") return unavailable(base, "An ETH swap route is not available for this launch yet.");
    if (!row.hookAddress || !row.poolId) return unavailable(base, "No verified trading pool is available for this coin.");
    return { ...base, status: "ready", route: { kind: "classic", hook: getAddress(row.hookAddress), poolId: row.poolId,
      launchModel: row.launchModel === "deep" || row.launchModel === "stock-paired" ? row.launchModel : "classic",
      ...(row.launchModelVersion ? { launchModelVersion: row.launchModelVersion } : {}),
      ...(row.quoteAssetAddress ? { quoteAsset: getAddress(row.quoteAssetAddress) } : {}) } };
  }
  const result = await dependencies.robinhood(address);
  if (!result.token) throw new SwapUnavailableError(result.status === "unavailable" ? "Robinhood token details are temporarily unavailable. Try again." : "This token is not in the verified Robinhood launch index.", result.status === "unavailable" ? "INDEX_UNAVAILABLE" : "TOKEN_NOT_FOUND");
  const row = result.token;
  // The index also resolves component addresses. A component is not implicitly
  // the primary trade token, and must never swap some other token by accident.
  if (row.tokenAddress.toLowerCase() !== address.toLowerCase()) throw new SwapUnavailableError("Enter the coin’s token address, rather than one of its supporting contracts.", "NOT_PRIMARY_TOKEN");
  return resolveRobinhoodSwapToken(row, dependencies);
}

async function resolveRobinhoodSwapToken(row: RobinhoodLaunch, dependencies: SwapTokenDependencies): Promise<SwapTokenDescriptor> {
  const decimals = row.decimals ?? await dependencies.decimals(row.tokenAddress);
  const base = { schemaVersion: SWAP_TOKEN_SCHEMA, chainId: 4663 as const, token: tokenMetadata({ ...row, decimals }), manageHref: robinhoodModuleManageHref(row) };
  if (isRobinhoodNativeModuleLaunch(row)) {
    const availability = await dependencies.native(row.sourceReleaseDigest);
    if (!availability.release || availability.release.releaseDigest.toLowerCase() !== row.sourceReleaseDigest.toLowerCase()) return unavailable(base, "This coin’s original module version is temporarily unavailable. Try again.");
    return { ...base, status: "ready", route: { kind: "module-native", availability } };
  }
  if (isRobinhoodEngineLaunch(row)) {
    const availability = await dependencies.engine(row.sourceReleaseDigest);
    if (!availability.release || availability.release.releaseDigest.toLowerCase() !== row.sourceReleaseDigest.toLowerCase()) return unavailable(base, "This coin’s original module version is temporarily unavailable. Try again.");
    const template = availability.templates.find(item => item.manifest.manifest.revision.packageId.toLowerCase() === row.engineRevisionId.toLowerCase());
    if (!template) return unavailable(base, "This coin’s original module could not be verified. Try again.");
    if (isModuleEngineSharedQuoteRelease(availability.release) && template.manifest.manifest.catalogDefinition.interface === "quote-shared-v1") return { ...base, status: "ready", route: { kind: "any-quote", availability, template } };
    return unavailable(base, row.primaryMarket ? "This module trades in its pool pair token. ETH swaps are not available for this version; use its coin controls." : "This module has no trading pool. Open its coin controls to use it.");
  }
  if (row.launchProjection?.sourceVersion === "custom_launch_plan_v1") {
    const projection = row.launchProjection;
    const market = projection.markets.find(item => {
      const assets = [resolveProjectionAddress(projection, item.currency0), resolveProjectionAddress(projection, item.currency1)].map(value => value.toLowerCase());
      return assets.includes(ZERO) && assets.includes(base.token.address.toLowerCase());
    });
    if (!market) return unavailable(base, "This launch has no verified ETH trading pool.");
    return { ...base, status: "ready", route: { kind: "custom-vnext", projection, marketId: market.marketId } };
  }
  if (row.sourceKind !== undefined && row.sourceKind !== "multi-role-v2") return unavailable(base, "This launch’s swap route is not available yet.");
  return { ...base, status: "ready", route: { kind: "custom-v4", descriptor: await dependencies.custom(row) } };
}
