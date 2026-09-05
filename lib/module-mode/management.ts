import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, toHex,
  type Abi, type Address, type Hex } from "viem";
import { compileOpenConfig } from "@/packages/classic-modules/src/open-config.mjs";
import { configurationSummary, type ModuleModeCatalogEntry, type FormValue } from "./builder";
import { assertModuleNativeRelease, readModuleNativeLaunch, type ModuleNativeClient, type ModuleNativeLaunchRecord } from "./native-client";
import { bindNativeCatalogEntry, nativeJson, type NativeModuleModeCatalogEntry } from "./native-catalog";
import { moduleAddress, moduleHash, moduleRecord, moduleUint, type ModuleModeRelease } from "./release";
import { bindModuleManagementManifest, managementReadAbi, unsupportedManagementCapabilities,
  type ManagementAction, type ManagementRead, type ManagementTarget, type ModuleManagementManifestV1 } from "./management-manifest";

export const managementCoreAbi = parseAbi([
  "function instances(bytes32 launchKey) view returns ((bytes32 instanceId,bytes32 packageId,bytes32 configHash,address factory,bytes32 factoryCodeHash,address module,bytes32 moduleCodeHash,uint32 callbackGas)[])",
  "function bindingHash() view returns (bytes32)", "function instanceOf(address module) view returns (bytes32)",
  "function actionNonce(bytes32 launchKey,address actor) view returns (uint64)",
  "function executeAction(bytes32 launchKey,uint256 index,bytes32 actionId,bytes inputs,uint64 expectedNonce,uint256 deadline) returns (bytes32)",
  "function available(bytes32 instanceId) view returns (uint256)",
  "function claimable(bytes32 instanceId,address actor) view returns (uint256)",
  "function claimed(bytes32 instanceId,address actor) view returns (uint256)",
  "function fund(bytes32 instanceId) payable", "function claimTo(bytes32 instanceId,address recipient) returns (uint256)",
  "function creatorRecipients(bytes32 poolId) view returns (address[] wallets,uint16[] sharesBps,uint256 adminRevision)",
  "function treasury() view returns (address)", "function rewardAdmin() view returns (address)",
  "function claimable(address actor) view returns (uint256)", "function claimedBy(address actor) view returns (uint256)",
  "function contributionByPool(bytes32 poolId,address actor) view returns (uint256)",
  "function claimTo(address recipient) returns (uint256)",
  "function changeCreatorWallet(bytes32 poolId,uint256 index,address newWallet)",
  "function replaceCreatorWallets(bytes32 poolId,address[] newWallets,uint256 expectedAdminRevision,uint256 deadline)",
  "function getRevision(bytes32 packageId) view returns ((bytes32 familyId,address factory,bytes32 factoryCodeHash,bytes32 moduleCodeHash,bytes32 manifestHash,uint32 callbackGas,bool enabled))",
  "function name() view returns (string)", "function symbol() view returns (string)",
]);

export type ManagementValue = string | bigint | boolean | null;
export interface ModuleManagedInstance {
  index: number; instanceId: Hex; packageId: Hex; configHash: Hex; factory: Address; factoryCodeHash: Hex;
  module: Address; moduleCodeHash: Hex; callbackGas: number;
  title: string; manifest: ModuleManagementManifestV1 | null; problem: string | null;
  reads: Record<string, ManagementValue>; available: bigint; claimable: bigint | null; claimed: bigint | null;
}
export interface ModuleManagementSnapshot {
  release: ModuleModeRelease; launch: ModuleNativeLaunchRecord; blockNumber: bigint; blockHash: Hex; timestamp: bigint;
  actor: Address | null; name: string; symbol: string; instances: ModuleManagedInstance[];
  fees: { claimable: bigint | null; claimed: bigint | null; contributedByCoin: bigint | null;
    treasury: Address; administrator: Address; wallets: Address[]; sharesBps: number[]; adminRevision: bigint };
}
export type ModuleManagementIntent =
  | { kind: "fund"; instanceId: Hex; amountWei: string }
  | { kind: "claim"; instanceId: Hex; recipient: Address }
  | { kind: "program"; instanceId: Hex; actionId: string; inputs: FormValue }
  | { kind: "claim-fees"; recipient: Address }
  | { kind: "rotate-creator"; index: number; recipient: Address }
  | { kind: "replace-creators"; recipients: Address[] };
export interface ModuleManagementBuildInput {
  client: ModuleNativeClient; release: ModuleModeRelease; catalog: readonly ModuleModeCatalogEntry[];
  token: Address; actor: Address; intent: ModuleManagementIntent; deadline: bigint;
}

function requireValue(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function uint(value: unknown, label: string) { return BigInt(moduleUint(typeof value === "bigint" ? value.toString() : value, label)); }
async function read(client: ModuleNativeClient, address: Address, functionName: string, args: readonly unknown[], blockNumber: bigint): Promise<unknown> {
  return client.readContract({ address, abi: managementCoreAbi as Abi, functionName, args, blockNumber });
}
async function codeMatches(client: ModuleNativeClient, address: Address, expected: Hex, blockNumber: bigint) {
  const code = await client.getCode({ address, blockNumber });
  requireValue(code && code !== "0x" && same(keccak256(code), expected), "The module's deployed code differs from its launch binding.");
}
function boundTargets(snapshot: Pick<ModuleManagementSnapshot, "release" | "launch">, instance: Pick<ModuleManagedInstance, "module">): Record<ManagementTarget, Address> {
  return { program: instance.module, runtime: snapshot.launch.runtime, vault: snapshot.release.contracts.budgetVault.address, ledger: snapshot.release.contracts.rewardLedger.address };
}

async function readManifestValue(input: { client: ModuleNativeClient; read: ManagementRead; snapshot: Pick<ModuleManagementSnapshot, "release" | "launch" | "actor" | "blockNumber">; instance: ModuleManagedInstance }): Promise<ManagementValue> {
  const { client, read: declaration, snapshot, instance } = input;
  if (!snapshot.actor && declaration.args.some(arg => "binding" in arg && arg.binding === "actor")) return null;
  const abi = managementReadAbi(declaration);
  const bindings = { instanceId: instance.instanceId, launchKey: snapshot.launch.launchKey, poolId: snapshot.launch.poolId, actor: snapshot.actor };
  const args = declaration.args.map((argument, index) => {
    const value = "binding" in argument ? bindings[argument.binding] : argument.literal;
    if (/^u?int/.test(abi.inputs[index].type)) return BigInt(String(value));
    return value;
  });
  const result = await client.call({ to: boundTargets(snapshot, instance)[declaration.target],
    data: encodeFunctionData({ abi: [abi], functionName: abi.name, args }), blockNumber: snapshot.blockNumber, gas: 150_000n });
  requireValue(result.data && result.data.length <= 8194, "The module returned too much management data.");
  const decoded: unknown = decodeFunctionResult({ abi: [abi], functionName: abi.name, data: result.data });
  const value = typeof decoded === "number" && Number.isSafeInteger(decoded) ? BigInt(decoded) : decoded;
  requireValue(typeof value === "bigint" || typeof value === "boolean" || (typeof value === "string" && value.length <= 2048), "The module returned an unsupported management value.");
  return value;
}

/** Reads only an authenticated launch and its registered instance buckets; catalogue targets never become addresses. */
export async function readModuleManagementSnapshot(input: Omit<ModuleManagementBuildInput, "intent" | "deadline" | "actor"> & { actor?: Address | null }): Promise<ModuleManagementSnapshot> {
  const { client, release, catalog, token } = input;
  const actor = input.actor ? moduleAddress(input.actor, "management.actor") : null;
  const block = await assertModuleNativeRelease({ client, release });
  const launch = await readModuleNativeLaunch({ client, release, token, blockNumber: block.blockNumber });
  const ledger = release.contracts.rewardLedger.address;
  const vault = release.contracts.budgetVault.address;
  const nativeEntries = catalog.filter(entry => entry.status === "available").map(bindNativeCatalogEntry);
  requireValue(new Set(nativeEntries.map(entry => entry.nativeBinding.packageId.toLowerCase())).size === nativeEntries.length, "The module catalogue contains ambiguous package bindings.");
  const [rawInstances, rawRecipients, treasury, administrator, feeClaimable, feeClaimed, contribution, name, symbol] = await Promise.all([
    read(client, launch.runtime, "instances", [launch.launchKey], block.blockNumber),
    read(client, ledger, "creatorRecipients", [launch.poolId], block.blockNumber),
    read(client, ledger, "treasury", [], block.blockNumber), read(client, ledger, "rewardAdmin", [], block.blockNumber),
    actor ? read(client, ledger, "claimable", [actor], block.blockNumber) : null,
    actor ? read(client, ledger, "claimedBy", [actor], block.blockNumber) : null,
    actor ? read(client, ledger, "contributionByPool", [launch.poolId, actor], block.blockNumber) : null,
    read(client, token, "name", [], block.blockNumber), read(client, token, "symbol", [], block.blockNumber),
  ]);
  requireValue(Array.isArray(rawInstances) && rawInstances.length <= 16, "The runtime returned an invalid instance list.");
  requireValue(Array.isArray(rawRecipients) && rawRecipients.length === 3, "The fee recipient record is unavailable.");
  const [wallets, sharesBps, adminRevision] = rawRecipients as [Address[], number[], bigint];
  requireValue(Array.isArray(wallets) && wallets.length > 0 && wallets.length <= 10 && Array.isArray(sharesBps)
    && wallets.length === sharesBps.length && sharesBps.every(share => Number.isSafeInteger(share) && share > 0)
    && sharesBps.reduce((sum, share) => sum + share, 0) === 10_000, "The fee recipient allocation is invalid.");
  const snapshot: ModuleManagementSnapshot = {
    release, launch, blockNumber: block.blockNumber, blockHash: block.blockHash, timestamp: block.timestamp, actor,
    name: typeof name === "string" ? name.slice(0, 128) : "Module coin", symbol: typeof symbol === "string" ? symbol.slice(0, 32) : "",
    instances: [], fees: { treasury: moduleAddress(treasury, "treasury"), administrator: moduleAddress(administrator, "administrator"),
      wallets: wallets.map(wallet => moduleAddress(wallet, "creatorRecipient")), sharesBps, adminRevision: uint(adminRevision, "adminRevision"),
      claimable: feeClaimable === null ? null : uint(feeClaimable, "feeClaimable"), claimed: feeClaimed === null ? null : uint(feeClaimed, "feeClaimed"),
      contributedByCoin: contribution === null ? null : uint(contribution, "contributionByCoin") },
  };
  snapshot.instances = await Promise.all(rawInstances.map(async (raw, index): Promise<ModuleManagedInstance> => {
    const r = moduleRecord(raw, ["instanceId", "packageId", "configHash", "factory", "factoryCodeHash", "module", "moduleCodeHash", "callbackGas"], "runtime.instance");
    const instance: ModuleManagedInstance = {
      index, instanceId: moduleHash(r.instanceId, "instanceId"), packageId: moduleHash(r.packageId, "packageId"), configHash: moduleHash(r.configHash, "configHash"),
      factory: moduleAddress(r.factory, "factory"), factoryCodeHash: moduleHash(r.factoryCodeHash, "factoryCodeHash"),
      module: moduleAddress(r.module, "module"), moduleCodeHash: moduleHash(r.moduleCodeHash, "moduleCodeHash"), callbackGas: Number(r.callbackGas),
      title: `Module ${index + 1}`, manifest: null, problem: null, reads: {}, available: 0n, claimable: null, claimed: null,
    };
    requireValue(Number.isSafeInteger(instance.callbackGas) && instance.callbackGas >= 25_000 && instance.callbackGas <= 500_000, "Invalid instance callback budget.");
    const [available, claimable, claimed] = await Promise.all([
      read(client, vault, "available", [instance.instanceId], block.blockNumber),
      actor ? read(client, vault, "claimable", [instance.instanceId, actor], block.blockNumber) : null,
      actor ? read(client, vault, "claimed", [instance.instanceId, actor], block.blockNumber) : null,
    ]);
    instance.available = uint(available, "available"); instance.claimable = claimable === null ? null : uint(claimable, "claimable");
    instance.claimed = claimed === null ? null : uint(claimed, "claimed");
    try {
      const entry = nativeEntries.find(candidate => same(candidate.nativeBinding.packageId, instance.packageId));
      requireValue(entry, "Management for this module is not in the approved catalogue yet. Existing claims remain available.");
      instance.title = entry.title;
      await verifyInstance({ client, snapshot, instance, entry });
      instance.manifest = bindModuleManagementManifest(entry.management);
      const unsupported = unsupportedManagementCapabilities(instance.manifest);
      requireValue(unsupported.length === 0, `Management support is still required for: ${unsupported.join(", ")}.`);
      const values = await Promise.all(instance.manifest.reads.map(async declaration => [declaration.id,
        await readManifestValue({ client, read: declaration, snapshot, instance })] as const));
      instance.reads = Object.fromEntries(values);
    } catch (error) {
      instance.problem = error instanceof Error ? error.message : "This module's management could not be verified.";
    }
    return instance;
  }));
  const canonical = await client.getBlock({ blockNumber: block.blockNumber });
  requireValue(canonical.hash && same(canonical.hash, block.blockHash), "The chain changed during the read. Refresh before continuing.");
  return snapshot;
}

async function verifyInstance({ client, snapshot, instance, entry }: { client: ModuleNativeClient; snapshot: ModuleManagementSnapshot; instance: ModuleManagedInstance; entry: NativeModuleModeCatalogEntry }) {
  const pin = entry.nativeBinding;
  for (const key of ["factory", "factoryCodeHash", "moduleCodeHash"] as const) requireValue(same(instance[key], pin[key]), "The catalogue does not match this instance's immutable launch binding.");
  requireValue(instance.callbackGas === pin.callbackGas, "The module callback budget differs from its reviewed binding.");
  const [bindingHash, registeredInstance, revision] = await Promise.all([
    read(client, instance.module, "bindingHash", [], snapshot.blockNumber),
    read(client, snapshot.launch.runtime, "instanceOf", [instance.module], snapshot.blockNumber),
    read(client, snapshot.release.contracts.registry.address, "getRevision", [instance.packageId], snapshot.blockNumber),
    codeMatches(client, instance.module, instance.moduleCodeHash, snapshot.blockNumber),
    codeMatches(client, instance.factory, instance.factoryCodeHash, snapshot.blockNumber),
  ]);
  const expectedBinding = keccak256(encodeAbiParameters(
    [{ type: "address" }, ...Array.from({ length: 4 }, () => ({ type: "bytes32" } as const))],
    [snapshot.launch.runtime, snapshot.launch.launchKey, instance.instanceId, instance.packageId, instance.configHash],
  ));
  requireValue(typeof bindingHash === "string" && same(bindingHash, expectedBinding)
    && typeof registeredInstance === "string" && same(registeredInstance, instance.instanceId), "The program is not bound to this launch and configuration.");
  const r = moduleRecord(revision, ["familyId", "factory", "factoryCodeHash", "moduleCodeHash", "manifestHash", "callbackGas", "enabled"], "revision");
  for (const key of ["familyId", "factory", "factoryCodeHash", "moduleCodeHash", "manifestHash"] as const) requireValue(typeof r[key] === "string" && same(r[key], pin[key]), "The reviewed registry revision differs from this catalogue.");
  requireValue(Number(r.callbackGas) === instance.callbackGas, "The registry callback budget changed.");
  // A new-launch availability toggle never removes an existing instance's claims or immutable action rights.
}

export function managementActionProblem(action: ManagementAction, instance: ModuleManagedInstance, snapshot: ModuleManagementSnapshot): string | null {
  if (instance.problem) return instance.problem;
  if (!snapshot.actor) return "Connect your wallet to continue.";
  if (action.role.kind === "read-wallet") {
    const role = instance.reads[action.role.readId];
    if (typeof role !== "string" || !same(role, snapshot.actor)) return "Only the displayed action wallet can use this control.";
  }
  if (action.availableAfterRead) {
    const after = instance.reads[action.availableAfterRead];
    if ((typeof after !== "bigint" && typeof after !== "number") || snapshot.timestamp < BigInt(after)) return "This action becomes available after the displayed end time.";
  }
  return null;
}

function checkedIntent(value: ModuleManagementIntent): ModuleManagementIntent {
  const raw = nativeJson(value) as Record<string, unknown>;
  const keys: Record<ModuleManagementIntent["kind"], string[]> = {
    fund: ["kind", "instanceId", "amountWei"], claim: ["kind", "instanceId", "recipient"],
    program: ["kind", "instanceId", "actionId", "inputs"], "claim-fees": ["kind", "recipient"],
    "rotate-creator": ["kind", "index", "recipient"], "replace-creators": ["kind", "recipients"],
  };
  requireValue(raw && Object.hasOwn(keys, String(raw.kind)), "Unknown management operation.");
  moduleRecord(raw, keys[raw.kind as ModuleManagementIntent["kind"]], "management.intent");
  return raw as unknown as ModuleManagementIntent;
}

/** Specific, unbranded candidate. Only the native client can brand and later revalidate this reconstructed operation. */
export async function buildModuleManagementTransaction(input: ModuleManagementBuildInput) {
  const actor = moduleAddress(input.actor, "management.actor");
  const intent = checkedIntent(input.intent);
  const snapshot = await readModuleManagementSnapshot({ ...input, actor });
  requireValue(typeof input.deadline === "bigint" && input.deadline > snapshot.timestamp && input.deadline <= snapshot.timestamp + 900n,
    "The review expired or its deadline is too far ahead. Prepare the action again.");
  const ledger = input.release.contracts.rewardLedger.address;
  const vault = input.release.contracts.budgetVault.address;
  let to = vault; let value = 0n; let data: Hex; let description: string;
  if (intent.kind === "fund" || intent.kind === "claim" || intent.kind === "program") {
    const id = moduleHash(intent.instanceId, "management.instanceId");
    const instance = snapshot.instances.find(item => same(item.instanceId, id));
    requireValue(instance, "This module does not belong to this coin.");
    if (intent.kind === "claim") {
      const recipient = moduleAddress(intent.recipient, "claim.recipient");
      requireValue(!same(recipient, vault) && (instance.claimable ?? 0n) > 0n, "This wallet has no claim to withdraw, or the recipient is invalid.");
      data = encodeFunctionData({ abi: managementCoreAbi, functionName: "claimTo", args: [id, recipient] });
      description = `Claim your existing ${instance.title} ETH balance to ${recipient}.`;
    } else {
      requireValue(!instance.problem && instance.manifest, instance.problem ?? "This module has no approved management manifest.");
      if (intent.kind === "fund") {
        requireValue(instance.manifest.budget.fundable, "This module does not accept an additional reward budget.");
        value = uint(intent.amountWei, "fund.amountWei"); requireValue(value > 0n, "Enter an ETH amount above zero.");
        data = encodeFunctionData({ abi: managementCoreAbi, functionName: "fund", args: [id] });
        const refund = instance.manifest.budget.refundWalletRead ? instance.reads[instance.manifest.budget.refundWalletRead] : null;
        description = `Add ETH to ${instance.title}. ${instance.manifest.budget.explanation}${typeof refund === "string" ? ` Unused budget wallet: ${refund}.` : ""}`;
      } else {
        const action = instance.manifest.actions.find(candidate => candidate.id === intent.actionId);
        requireValue(action, "This action is not declared by the reviewed module.");
        const problem = managementActionProblem(action, instance, snapshot); requireValue(!problem, problem ?? "Action unavailable.");
        const compiled = compileOpenConfig(action.inputSchema, intent.inputs, { roles: { connectedWallet: actor, launchWallet: snapshot.launch.launchWallet } });
        const inputs = action.encoding === "empty" ? "0x" : compiled.encoded;
        requireValue(inputs.length <= 32_770, "Action inputs exceed the runtime limit.");
        const nonce = uint(await read(input.client, snapshot.launch.runtime, "actionNonce", [snapshot.launch.launchKey, actor], snapshot.blockNumber), "action.nonce");
        to = snapshot.launch.runtime;
        data = encodeFunctionData({ abi: managementCoreAbi, functionName: "executeAction", args: [snapshot.launch.launchKey, BigInt(instance.index), action.actionId, inputs, nonce, input.deadline] });
        const summary = configurationSummary(action.inputSchema, compiled.value as FormValue, {}, "Inputs", "", compiled.bindings);
        description = `${action.label}. ${action.description}${summary.length ? ` ${summary.map(item => `${item.label}: ${item.value}`).join("; ")}.` : ""}`;
      }
    }
  } else {
    to = ledger;
    if (intent.kind === "claim-fees") {
      const recipient = moduleAddress(intent.recipient, "fees.recipient");
      requireValue((snapshot.fees.claimable ?? 0n) > 0n, "This wallet has no fee balance to claim.");
      data = encodeFunctionData({ abi: managementCoreAbi, functionName: "claimTo", args: [recipient] });
      description = `Claim your full available Module Mode fee balance to ${recipient}.`;
    } else if (intent.kind === "rotate-creator") {
      requireValue(Number.isSafeInteger(intent.index) && intent.index >= 0 && intent.index < snapshot.fees.wallets.length
        && same(snapshot.fees.wallets[intent.index], actor), "Only the current recipient can change its own fee wallet.");
      const recipient = moduleAddress(intent.recipient, "creator.recipient");
      requireValue(!same(recipient, actor), "Choose a different fee wallet.");
      data = encodeFunctionData({ abi: managementCoreAbi, functionName: "changeCreatorWallet", args: [snapshot.launch.poolId, BigInt(intent.index), recipient] });
      description = `Send your future creator fees to ${recipient}. Previously credited fees stay with their original wallet.`;
    } else {
      requireValue(same(actor, snapshot.fees.administrator) || same(actor, snapshot.fees.treasury), "Only the existing fee administrator or treasury can replace recipients.");
      requireValue(Array.isArray(intent.recipients) && intent.recipients.length === snapshot.fees.wallets.length, "Keep the existing number of fee recipient slots and their fixed shares.");
      const recipients = intent.recipients.map(recipient => moduleAddress(recipient, "creator.recipient"));
      data = encodeFunctionData({ abi: managementCoreAbi, functionName: "replaceCreatorWallets", args: [snapshot.launch.poolId, recipients, snapshot.fees.adminRevision, input.deadline] });
      description = `Replace future creator fee recipients: ${recipients.map((recipient, index) => `${recipient} (${snapshot.fees.sharesBps[index] / 100}%)`).join(", ")}. Old claims and module reward wallets remain unchanged.`;
    }
  }
  const transaction = { chainId: 4663 as const, from: actor, to, data, value: toHex(value) };
  await input.client.call({ account: actor, to, data, value, blockNumber: snapshot.blockNumber });
  const gasEstimate = await input.client.estimateGas({ account: actor, to, data, value });
  const canonical = await input.client.getBlock({ blockNumber: snapshot.blockNumber });
  requireValue(canonical.hash && same(canonical.hash, snapshot.blockHash), "The chain changed during simulation. Prepare the action again.");
  return { transaction, expiresAt: input.deadline, gasEstimate, description };
}

export function moduleManagementChainMatches(chainId: string | null | undefined): boolean {
  try { return !!chainId && BigInt(chainId.startsWith("eip155:") ? chainId.slice(7) : chainId) === 4663n; }
  catch { return false; }
}
