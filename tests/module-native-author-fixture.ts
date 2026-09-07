import { decodeFunctionData, encodeEventTopics, type Address, type Hex, type TransactionReceipt } from "viem";
import { PREVIEW_MODULE_CATALOG } from "@/lib/module-mode/builder";
import { managementCoreAbi, readModuleManagementSnapshot, type ModuleManagementIntent } from "@/lib/module-mode/management";
import { prepareModuleNativeManagementTransaction, type ModuleNativeClient, type PreparedModuleNativeManagement } from "@/lib/module-mode/native-client";
import { bindActiveModuleModeRelease, computeModuleModeReleaseDigest, MODULE_MODE_ECONOMICS_POLICY_V2, type ModuleModeDependency } from "@/lib/module-mode/release";
import type { NativeModuleModeCatalogEntry } from "@/lib/module-mode/native-catalog";
import { a, h, moduleEvidenceFixture } from "./fixtures/module-mode-evidence";

/** Synthetic RPC only. Actual private preparation, code/getter validation and receipt logic remain in use. */
export function nativeAuthorFixture(v2 = false) {
  const f = moduleEvidenceFixture(0, 2);
  const candidate = v2 ? { ...f.release, schemaVersion: "programmable.module-mode-source.v2", sourceVersion: "module-native-v2", economicsPolicyId: MODULE_MODE_ECONOMICS_POLICY_V2 } : f.release;
  const release = bindActiveModuleModeRelease({ ...candidate, releaseDigest: computeModuleModeReleaseDigest(candidate) });
  const pins = release.contracts, launch = f.evidence.getLaunch.record, actor = a(300), recipient = a(999);
  const rawInstances = f.evidence.program.instances;
  const instances = rawInstances.map(({ bindingHash: _, ...instance }) => { void _; return instance; });
  const catalog: NativeModuleModeCatalogEntry[] = instances.map((instance, index) => ({ ...PREVIEW_MODULE_CATALOG[1], id: `author-fixture-${index}`, title: index ? "Trading rewards" : "Buyer rewards", status: "available",
    nativeBinding: { packageId: instance.packageId, familyId: f.evidence.program.families[index], factory: instance.factory, factoryCodeHash: instance.factoryCodeHash, moduleCodeHash: instance.moduleCodeHash, callbackGas: instance.callbackGas, manifestHash: h(800 + index), reviewDigest: h(900 + index), ...(v2 ? { feeEligibility: { eligible: true, reviewDigest: h(1000 + index) } } : {}) } }));
  const state = { author: actor, wallet: a(400), chainId: 4663, blockNumber: 100n, blockHash: h(400), timestamp: BigInt(Math.floor(Date.now() / 1000)), enabled: true,
    codeMismatch: false, instanceMismatch: false, manifestMismatch: false, familyMismatch: false, getterMissing: false, missingSecond: false, canonical: true, simulationFails: false, gas: 100_000n };
  const roles = new Map(Object.entries(pins).map(([role, pin]) => [pin.address.toLowerCase(), role as ModuleModeDependency]));
  const simulated: { to: Address; data: Hex; value: bigint }[] = [];
  let receipt: TransactionReceipt;
  let tx: { hash: Hex; blockNumber: bigint; blockHash: Hex; from: Address; to: Address; input: Hex; value: bigint; chainId: number };
  const client = {
    getChainId: async () => state.chainId,
    getBlock: async ({ blockNumber }: { blockNumber?: bigint }) => ({ number: blockNumber ?? state.blockNumber, hash: state.canonical ? state.blockHash : h(777), timestamp: state.timestamp }),
    getCode: async ({ address }: { address: Address }) => {
      if (state.codeMismatch && address === pins.registry.address) return "0x1234";
      return f.evidence.runtimeReads.find(read => read.address.toLowerCase() === address.toLowerCase())?.code;
    },
    readContract: async ({ address, functionName: fn, args }: { address: Address; functionName: string; args: readonly unknown[] }) => {
      const role = roles.get(address.toLowerCase());
      if (fn === "getLaunch") return launch;
      if (fn === "getLaunchIdentity") return f.evidence.identity.record;
      if (fn === "instances") return instances;
      if (fn === "bindingHash") return rawInstances.find(row => row.module === address)?.bindingHash;
      if (fn === "instanceOf") return state.instanceMismatch ? h(999) : instances.find(row => row.module === args[0])?.instanceId;
      if (fn === "getRevision") {
        const index = instances.findIndex(row => row.packageId === args[0]);
        if (index < 0) throw new Error("Unknown revision");
        const { packageId: _, reviewDigest: __, feeEligibility: ___, ...pin } = catalog[index].nativeBinding; void _; void __; void ___;
        return { ...pin, familyId: state.familyMismatch ? h(999) : pin.familyId, manifestHash: state.manifestMismatch ? h(999) : pin.manifestHash, enabled: state.enabled };
      }
      if (fn === "families") {
        if (state.getterMissing || (state.missingSecond && args[0] === catalog[1].nativeBinding.familyId)) throw new Error("Getter unavailable");
        return [state.author, state.wallet];
      }
      if (fn === "creator") return pins.launcher.address;
      if (fn === "totalSupply") return 1_000_000_000n * 10n ** 18n;
      if (fn === "decimals") return 18;
      if (fn === "name") return "Author controls fixture";
      if (fn === "symbol") return "TEST";
      if (fn === "creatorRecipients") return [[a(800)], [10000], 0n];
      if (fn === "treasury") return a(901);
      if (fn === "rewardAdmin") return a(902);
      if (fn === "available" || fn === "claimable") return 1_000_000_000_000_000_000n;
      if (["claimed", "claimedBy", "contributionByPool"].includes(fn)) return 100n;
      if (fn === "poolConfig") return [pins.launcher.address, launch.launchWallet, pins.swapRouter.address, pins.swapRouter.runtimeCodeHash, 0, 1000, launch.recipeHash, launch.launchKey, ...(v2 ? [30] : [])];
      if (fn === "platformFeeBps") return 30;
      if (fn === "ECONOMICS_POLICY_ID") return MODULE_MODE_ECONOMICS_POLICY_V2;
      if (fn === "PROTOCOL_FEE_BPS") return 10;
      if (fn === "AUTHOR_POOL_FEE_BPS") return 20;
      if (fn === "minInitialBuyNative") return 1000n;
      if (fn === "engineCodeHash") return pins.hook.runtimeCodeHash;
      if (fn === "runtimeOf") return pins.runtime.address;
      if (fn === "routerOf") return pins.swapRouter.address;
      const target = fn === "feeHook" || fn === "engine" ? "hook" : fn === "ledger" ? "rewardLedger" : fn === "vault" ? "budgetVault" : fn === "source" ? "launcher" : fn;
      if (target in pins && role) return pins[target as ModuleModeDependency].address;
      throw new Error(`Unexpected read ${role}.${fn}`);
    },
    call: async ({ to, data, value = 0n }: { to: Address; data: Hex; value?: bigint }) => {
      const decoded = decodeFunctionData({ abi: managementCoreAbi, data });
      if (!["changeAuthorWallet", "claimTo"].includes(decoded.functionName) || state.simulationFails) throw new Error("Simulation reverted");
      simulated.push({ to, data, value }); return { data: "0x" };
    },
    estimateGas: async () => state.gas,
    getTransaction: async () => tx, waitForTransactionReceipt: async () => receipt,
  } as unknown as ModuleNativeClient;
  const input = { client, release, catalog, token: launch.token, actor };
  const prepare = (intent: ModuleManagementIntent = { kind: "rotate-author", packageId: instances[0].packageId, recipient }, account = actor, deadline = state.timestamp + 300n) => prepareModuleNativeManagementTransaction({ ...input, actor: account, intent, deadline });
  function mined(prepared: PreparedModuleNativeManagement, status: "success" | "reverted" = "success", previousWallet = state.wallet) {
    const blockNumber = ++state.blockNumber, blockHash = state.blockHash, transactionHash = h(Number(blockNumber) + 600);
    const change = prepared.authorWalletChange;
    const logs: TransactionReceipt["logs"] = [];
    if (change && status === "success") {
      state.wallet = change.recipient;
      logs.push({ address: pins.registry.address, blockHash, blockNumber, transactionHash, transactionIndex: 0, logIndex: 0, removed: false,
        topics: encodeEventTopics({ abi: managementCoreAbi, eventName: "AuthorWalletChanged", args: { familyId: change.familyId, previousWallet, wallet: change.recipient } }) as [Hex, ...Hex[]], data: "0x" });
    }
    receipt = { transactionHash, blockNumber, blockHash, status, from: prepared.account, to: prepared.transaction.to, logs } as TransactionReceipt;
    tx = { hash: transactionHash, blockNumber, blockHash, from: prepared.account, to: prepared.transaction.to, input: prepared.transaction.data, value: BigInt(prepared.transaction.value), chainId: 4663 };
    return { receipt, tx, transactionHash };
  }
  return { ...input, state, instances, launch, simulated, prepare, mined, recipient, snapshot: () => readModuleManagementSnapshot(input) };
}
