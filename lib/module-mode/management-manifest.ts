import { parseAbiItem, keccak256, stringToHex, type AbiFunction, type Hex } from "viem";
import { assertOpenConfigSchema, compileOpenConfig, type OpenConfigSchema } from "@/packages/classic-modules/src/open-config.mjs";
import { nativeJson } from "./native-catalog";
import { moduleHash, moduleRecord } from "./release";

export const MODULE_MANAGEMENT_FORMAT = "programmable.module-management.v1" as const;
export const MODULE_MANAGEMENT_CAPABILITIES = ["bound-reads@1", "native-budget@1", "runtime-actions@1", "open-config-inputs@1"] as const;
export type ManagementTarget = "program" | "runtime" | "vault" | "ledger";
export type ManagementBinding = "instanceId" | "launchKey" | "poolId" | "actor";
export type ManagementArgument = { binding: ManagementBinding } | { literal: string | boolean };
export interface ManagementRead {
  id: string; label: string; target: ManagementTarget; signature: string; args: ManagementArgument[];
  display: "native" | "integer" | "timestamp" | "address" | "boolean" | "text";
}
export interface ManagementAction {
  id: string; label: string; description: string; actionId: Hex;
  inputSchema: OpenConfigSchema; encoding: "empty" | "open-config";
  role: { kind: "connected-wallet" } | { kind: "read-wallet"; readId: string };
  availableAfterRead: string | null;
}
export interface ModuleManagementManifestV1 {
  format: typeof MODULE_MANAGEMENT_FORMAT;
  capabilities: string[];
  reads: ManagementRead[];
  actions: ManagementAction[];
  budget: { fundable: boolean; explanation: string; refundWalletRead: string | null; endsAtRead: string | null };
}

function text(value: unknown, name: string, maximum = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Error(`Invalid management ${name}.`);
  return value;
}
function id(value: unknown): string {
  const result = text(value, "identifier", 64);
  if (!/^[a-z][a-z0-9-]*$/.test(result)) throw new Error("Invalid management identifier.");
  return result;
}
function list(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error("Management exceeds the supported item limit.");
  return value;
}
const supported = new Set<string>(MODULE_MANAGEMENT_CAPABILITIES);
const targets = new Set(["program", "runtime", "vault", "ledger"]);
const bindings = new Set(["instanceId", "launchKey", "poolId", "actor"]);
const scalar = /^(?:u?int(?:8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)|address|bool|bytes32|string)$/;

/** A read description cannot introduce writes, arbitrary targets or dynamic dependency lookups. */
export function managementReadAbi(read: Pick<ManagementRead, "signature" | "args">): AbiFunction {
  const abi = parseAbiItem(read.signature);
  if (abi.type !== "function" || !["view", "pure"].includes(abi.stateMutability)
    || abi.inputs.length !== read.args.length || abi.inputs.length > 8 || abi.outputs.length !== 1
    || !scalar.test(abi.outputs[0].type) || abi.inputs.some(input => !scalar.test(input.type))) {
    throw new Error("Management reads require one scalar result and a read-only ABI.");
  }
  return abi;
}

/** Validates bounded inert catalogue data. Unsupported capabilities stay visible but confer no authority. */
export function bindModuleManagementManifest(value: unknown): ModuleManagementManifestV1 {
  const raw = moduleRecord(nativeJson(value), ["format", "capabilities", "reads", "actions", "budget"], "management");
  if (raw.format !== MODULE_MANAGEMENT_FORMAT) throw new Error("This management version is not supported yet.");
  const capabilities = list(raw.capabilities, 32).map(item => text(item, "capability", 96));
  if (new Set(capabilities).size !== capabilities.length) throw new Error("Duplicate management capability.");
  const reads = list(raw.reads, 32).map((item): ManagementRead => {
    const r = moduleRecord(item, ["id", "label", "target", "signature", "args", "display"], "management.read");
    if (!targets.has(String(r.target)) || !["native", "integer", "timestamp", "address", "boolean", "text"].includes(String(r.display))) {
      throw new Error("Unsupported management read target or display.");
    }
    const args = list(r.args, 8).map((argument): ManagementArgument => {
      if (!argument || typeof argument !== "object") throw new Error("Invalid bound read argument.");
      if (Object.hasOwn(argument, "binding")) {
        const a = moduleRecord(argument, ["binding"], "management.argument");
        if (!bindings.has(String(a.binding))) throw new Error("Unknown management binding.");
        return { binding: a.binding as ManagementBinding };
      }
      const a = moduleRecord(argument, ["literal"], "management.argument");
      if (typeof a.literal !== "boolean" && (typeof a.literal !== "string" || a.literal.length > 256)) throw new Error("Invalid read literal.");
      return { literal: a.literal as string | boolean };
    });
    const result: ManagementRead = { id: id(r.id), label: text(r.label, "label", 96), target: r.target as ManagementTarget,
      signature: text(r.signature, "read signature", 512), args, display: r.display as ManagementRead["display"] };
    managementReadAbi(result);
    return result;
  });
  const readMap = new Map(reads.map(read => [read.id, read]));
  if (readMap.size !== reads.length) throw new Error("Duplicate management read.");
  function reference(value: unknown, kind: "address" | "uint"): string | null {
    if (value === null) return null;
    const key = id(value); const read = readMap.get(key);
    const output = read && managementReadAbi(read).outputs[0].type;
    if (!output || (kind === "address" ? output !== "address" : !output.startsWith("uint"))) throw new Error("Management role or time references an incompatible read.");
    return key;
  }
  const actions = list(raw.actions, 16).map((item): ManagementAction => {
    const a = moduleRecord(item, ["id", "label", "description", "actionId", "inputSchema", "encoding", "role", "availableAfterRead"], "management.action");
    assertOpenConfigSchema(a.inputSchema as OpenConfigSchema);
    if (!["empty", "open-config"].includes(String(a.encoding))) throw new Error("This action input codec is not supported yet.");
    const inputSchema = a.inputSchema as OpenConfigSchema;
    if (a.encoding === "empty") {
      if (inputSchema.type !== "record" || Object.keys(inputSchema.fields).length !== 0) throw new Error("Empty actions require an empty input schema.");
      compileOpenConfig(inputSchema, {});
    }
    if (!a.role || typeof a.role !== "object") throw new Error("Action role is missing.");
    let role: ManagementAction["role"];
    if ((a.role as Record<string, unknown>).kind === "connected-wallet") {
      moduleRecord(a.role, ["kind"], "management.role"); role = { kind: "connected-wallet" };
    } else {
      const r = moduleRecord(a.role, ["kind", "readId"], "management.role");
      if (r.kind !== "read-wallet") throw new Error("Unknown action role.");
      const readId = reference(r.readId, "address");
      if (!readId) throw new Error("An action wallet role must name its read.");
      role = { kind: "read-wallet", readId };
    }
    return { id: id(a.id), label: text(a.label, "action label", 96), description: text(a.description, "action description", 1000),
      actionId: moduleHash(a.actionId, "management.actionId"), inputSchema, encoding: a.encoding as ManagementAction["encoding"],
      role, availableAfterRead: reference(a.availableAfterRead, "uint") };
  });
  if (new Set(actions.map(action => action.id)).size !== actions.length || new Set(actions.map(action => action.actionId)).size !== actions.length) throw new Error("Duplicate management action.");
  const b = moduleRecord(raw.budget, ["fundable", "explanation", "refundWalletRead", "endsAtRead"], "management.budget");
  if (typeof b.fundable !== "boolean") throw new Error("Invalid budget capability.");
  const manifest: ModuleManagementManifestV1 = { format: MODULE_MANAGEMENT_FORMAT, capabilities, reads, actions,
    budget: { fundable: b.fundable, explanation: text(b.explanation, "budget explanation", 1000),
      refundWalletRead: reference(b.refundWalletRead, "address"), endsAtRead: reference(b.endsAtRead, "uint") } };
  if ((reads.length && !capabilities.includes("bound-reads@1")) || (b.fundable && !capabilities.includes("native-budget@1"))
    || (actions.length && !capabilities.includes("runtime-actions@1"))
    || (actions.some(action => action.encoding === "open-config") && !capabilities.includes("open-config-inputs@1"))) {
    throw new Error("Management is missing a required declared capability.");
  }
  return manifest;
}

export function unsupportedManagementCapabilities(manifest: ModuleManagementManifestV1): string[] {
  return manifest.capabilities.filter(capability => !supported.has(capability));
}

const read = (id: string, label: string, signature: string, display: ManagementRead["display"], args: ManagementArgument[] = []): ManagementRead =>
  ({ id, label, target: "program", signature, display, args });

/** Catalogue-build references only. Runtime behavior dispatches exclusively through an authenticated manifest. */
export function referenceManagementManifest(kind: "reward" | "cap"): ModuleManagementManifestV1 {
  if (kind === "cap") return {
    format: MODULE_MANAGEMENT_FORMAT, capabilities: ["bound-reads@1"], actions: [],
    budget: { fundable: false, explanation: "This module does not require a separate reward budget.", refundWalletRead: null, endsAtRead: "ends-at" },
    reads: [
      read("cap", "Maximum buys per wallet", "function capNative() view returns (uint128)", "native"),
      read("spent", "Your qualifying buys", "function spentNative(address actor) view returns (uint256)", "native", [{ binding: "actor" }]),
      read("ends-at", "Opening cap ends", "function endsAt() view returns (uint64)", "timestamp"),
      read("initial-buy", "Initial buy counts", "function includeInitialBuy() view returns (bool)", "boolean"),
    ],
  };
  return {
    format: MODULE_MANAGEMENT_FORMAT, capabilities: ["bound-reads@1", "native-budget@1", "runtime-actions@1"],
    budget: { fundable: true, explanation: "Funds pay eligible buyers under these fixed rules. After expiry, unused funds can be reclaimed only by the displayed refund wallet, including funds added after expiry.", refundWalletRead: "refund-wallet", endsAtRead: "ends-at" },
    reads: [
      read("every-n", "Reward every Nth eligible buy", "function everyN() view returns (uint32)", "integer"),
      read("minimum-buy", "Minimum eligible buy", "function minimumGrossNative() view returns (uint128)", "native"),
      read("reward", "Reward per winner", "function rewardNative() view returns (uint128)", "native"),
      read("qualified", "Eligible buys", "function qualifiedBuys() view returns (uint256)", "integer"),
      read("rewarded", "Rewards earned", "function rewardedBuys() view returns (uint256)", "integer"),
      read("ends-at", "Rewards end", "function endsAt() view returns (uint64)", "timestamp"),
      read("refund-wallet", "Unused budget wallet", "function refundWallet() view returns (address)", "address"),
      read("reclaimed", "Unused budget credited back", "function totalReclaimed() view returns (uint256)", "native"),
      read("initial-buy", "Initial buy counts", "function includeInitialBuy() view returns (bool)", "boolean"),
    ],
    actions: [{ id: "reclaim-unused", label: "Reclaim unused budget", description: "Move only unused funds into the refund wallet's ETH claim. Existing buyer claims stay with their wallets.",
      actionId: keccak256(stringToHex("programmable.module-mode.reward.reclaim-unused.v1")), encoding: "empty",
      inputSchema: { type: "record", fields: {}, required: [] }, role: { kind: "read-wallet", readId: "refund-wallet" }, availableAfterRead: "ends-at" }],
  };
}
