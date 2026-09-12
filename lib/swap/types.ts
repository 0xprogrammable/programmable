import type { Address, Hex } from "viem";
import type { ModuleModeAvailability } from "@/lib/module-mode/native-catalog";
import type { ModuleEngineAvailability, ModuleEngineTemplate } from "@/lib/module-engine/catalog";
import type { LaunchProjectionV1 } from "@/lib/custom-launch/launch-plan-v1";
import type { CustomV4SwapDescriptor } from "./custom-v4";

export const SWAP_TOKEN_SCHEMA = "programmable.swap-token.v1" as const;
export type SwapChainId = 1 | 4663;
export type SwapSide = "buy" | "sell";
export interface SwapToken {
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
}
export type SwapRoute =
  | { kind: "module-native"; availability: ModuleModeAvailability }
  | { kind: "any-quote"; availability: ModuleEngineAvailability; template: ModuleEngineTemplate }
  | { kind: "custom-v4"; descriptor: CustomV4SwapDescriptor }
  | { kind: "custom-vnext"; projection: LaunchProjectionV1; marketId: string }
  | { kind: "classic"; hook: Address; poolId: Hex; launchModel: "classic" | "deep" | "stock-paired"; launchModelVersion?: string; quoteAsset?: Address };

interface SwapDescriptorBase {
  schemaVersion: typeof SWAP_TOKEN_SCHEMA;
  chainId: SwapChainId;
  token: SwapToken;
  manageHref: string | null;
}
export type SwapTokenDescriptor = SwapDescriptorBase & (
  | { status: "ready"; route: SwapRoute }
  | { status: "unavailable"; route: null; reason: string }
);

/** Display data only. The private preparation binding remains in memory. */
export interface SwapReview {
  kind: "swap" | "approval";
  chainId: SwapChainId;
  token: Address;
  owner: Address;
  side: SwapSide;
  amountIn: bigint;
  amountOut: bigint | null;
  minimumOutput: bigint | null;
  expiresAt: bigint;
  gasEstimate: bigint;
  approvalLabel?: string;
}

export interface SwapReceipt {
  status: "success" | "reverted";
  hash: Hex;
  chainId: SwapChainId;
  blockNumber: bigint;
}

export class SwapUnavailableError extends Error {
  constructor(message: string, readonly code = "SWAP_UNAVAILABLE") {
    super(message);
    this.name = "SwapUnavailableError";
  }
}
