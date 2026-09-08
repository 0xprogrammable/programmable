import type { Address } from "viem";
import { parseExactUnits } from "@/lib/module-mode/builder";
import { moduleAddress, moduleBytes, moduleHash } from "@/lib/module-mode/release";
import { ENGINE_ZERO_ADDRESS, type ModuleEnginePermission } from "./catalog";
import type { ModuleEngineOperationIntent } from "./client";

export type ModuleEngineAssetRole = "none" | "token" | "quote" | "eth";
export interface ModuleEngineCustomOperationForm {
  inputRole: ModuleEngineAssetRole; inputAmount: string;
  outputRole: ModuleEngineAssetRole; minimumOutput: string;
  recipient: string; data: string;
}
export function emptyModuleEngineCustomOperation(): ModuleEngineCustomOperationForm {
  return { inputRole: "none", inputAmount: "0", outputRole: "none", minimumOutput: "0", recipient: "", data: "0x" };
}
const roles = [
  { id: "none", bit: 0, label: "None" },
  { id: "token", bit: 1, label: "Primary token" },
  { id: "quote", bit: 2, label: "Quote token" },
  { id: "eth", bit: 4, label: "ETH" },
] as const;
export function moduleEngineAssetOptions(mask: number) {
  return roles.filter(role => role.bit === 0 || (mask & role.bit) === role.bit);
}

/** Data stays opaque. A permission ID or source label does not establish a payload ABI. */
export function moduleEngineCustomOperationIntent(input: {
  permission: ModuleEnginePermission; form: ModuleEngineCustomOperationForm;
  account: Address; token: Address; quoteAsset: Address; quoteDecimals: number;
}): ModuleEngineOperationIntent {
  const { permission, form } = input;
  function asset(role: ModuleEngineAssetRole, amount: string, mask: number, label: string) {
    if (!moduleEngineAssetOptions(mask).some(option => option.id === role)) throw new Error(`${label} asset is outside this operation's reviewed permissions.`);
    const value = BigInt(parseExactUnits(amount, role === "quote" ? input.quoteDecimals : 18));
    if (value >= 1n << 256n) throw new Error(`${label} amount exceeds the supported limit.`);
    if (role === "none" && value !== 0n) throw new Error(`${label} amount must be zero when no asset is selected.`);
    return { address: role === "token" ? input.token : role === "quote" ? input.quoteAsset : ENGINE_ZERO_ADDRESS, amount: value };
  }
  if (!/^0x(?:[a-fA-F0-9]{2})*$/u.test(form.data.trim()) || form.data.trim().length > 32_770) throw new Error("Action data must be hex bytes starting with 0x, up to 16 KiB.");
  const send = asset(form.inputRole, form.inputAmount, permission.inputRoles, "Input");
  const receive = asset(form.outputRole, form.minimumOutput, permission.outputRoles, "Output");
  return { operationId: moduleHash(permission.operationId, "reviewed operation ID"),
    recipient: moduleAddress(form.recipient.trim() || input.account, "recipient wallet"),
    inputAsset: send.address, inputAmount: send.amount, outputAsset: receive.address, minimumOutput: receive.amount,
    data: moduleBytes(form.data.trim(), "action data", 16_384) };
}
