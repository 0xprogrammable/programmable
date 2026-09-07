import { keccak256, toHex } from "viem";
import type { ModulePublicDetailsBase } from "../module-mode/public-details";
import type { ModuleEngineCatalogDefinition, ModuleEnginePermission } from "./catalog";

export interface ModuleEnginePublicDetails extends ModulePublicDetailsBase {
  sourceKind: "module-engine-v1";
  engine: { interface: ModuleEngineCatalogDefinition["interface"]; operations: ModuleEnginePermission[] };
}
const interfaces = ["quote-v1", "escrow-v1", "settlement-v1", "custom-v1"];
const operationNames = new Map([
  ["spot.buy.exact-input.v1", "Buy"], ["spot.sell.exact-input.v1", "Sell"], ["escrow.deposit.v1", "Deposit"], ["escrow.withdraw.v1", "Withdraw"],
  ["settlement.request.v1", "Request payment"], ["settlement.fulfill.v1", "Fulfill payment"], ["settlement.refund.v1", "Refund payment"],
].map(([id, label]) => [keccak256(toHex(id)), label]));

export function moduleEngineOperationLabel(operationId: string): string {
  return operationNames.get(operationId.toLowerCase() as `0x${string}`) ?? `Custom operation ${operationId.slice(2, 10)}`;
}
export function moduleEngineInterfaceLabel(value: ModuleEngineCatalogDefinition["interface"]): string {
  return ({ "quote-v1": "Trading", "escrow-v1": "Escrow", "settlement-v1": "Settlement", "custom-v1": "Custom template" })[value];
}
export function moduleEngineCategory(value: ModuleEngineCatalogDefinition["interface"]): string {
  return value === "quote-v1" ? "trading" : "experiments";
}
/** Display exactly the Host's asset-role bitmask, without claiming mint, burn or arbitrary wallet access. */
export function moduleEngineAssetRoles(roles: number): string {
  return [[1, "Primary token"], [2, "Quote asset"], [4, "ETH"]].filter(([bit]) => (roles & Number(bit)) !== 0).map(([, label]) => label).join(", ") || "None";
}
export function isModuleEnginePublicCapabilities(value: unknown): value is ModuleEnginePublicDetails["engine"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (Object.keys(item).length !== 2 || !interfaces.includes(String(item.interface)) || !Array.isArray(item.operations)
    || item.operations.length < 1 || item.operations.length > 32) return false;
  const ids = new Set<string>();
  return item.operations.every(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const operation = raw as Record<string, unknown>;
    if (Object.keys(operation).length !== 4 || typeof operation.operationId !== "string" || !/^0x(?!0{64}$)[a-f\d]{64}$/iu.test(operation.operationId)
      || ids.has(operation.operationId.toLowerCase()) || (operation.authorization !== 0 && operation.authorization !== 1)
      || [operation.inputRoles, operation.outputRoles].some(roles => !Number.isInteger(roles) || Number(roles) < 0 || Number(roles) > 7)) return false;
    ids.add(operation.operationId.toLowerCase()); return true;
  });
}
