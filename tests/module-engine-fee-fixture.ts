import { vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Abi, type Address, type TransactionReceipt } from "viem";
import { moduleEngineAuthorWalletAbi, moduleEngineLedgerAbi } from "@/lib/module-engine/abi";
import type { ModuleEngineClient, PreparedModuleEngineFeeChange } from "@/lib/module-engine/client";
import { ACCOUNT, addr, fixture, hash } from "./module-engine-fixture";

export function feeFixture() {
  const f = fixture(), state = { creatorWallets: [ACCOUNT, addr(89)], creatorSharesBps: [6000, 4000], adminRevision: 4n,
    treasury: addr(96), administrator: addr(95), author: ACCOUNT, authorWallet: addr(97) };
  const original = f.client.readContract;
  f.client.readContract = vi.fn(async (input: Parameters<ModuleEngineClient["readContract"]>[0]) => {
    if (input.functionName === "creatorRecipients") return [[...state.creatorWallets], [...state.creatorSharesBps], state.adminRevision];
    if (input.functionName === "treasury") return state.treasury;
    if (input.functionName === "rewardAdmin") return state.administrator;
    if (input.functionName === "families") return [state.author, state.authorWallet];
    return original(input);
  }) as ModuleEngineClient["readContract"];
  f.client.call = vi.fn(async () => ({ data: "0x" as const }));
  f.client.getBlock = vi.fn(async (input?: { blockNumber?: bigint }) => ({ number: input?.blockNumber ?? 100n, hash: input?.blockNumber === 101n ? hash(101) : f.blockHash, timestamp: f.state.timestamp })) as unknown as ModuleEngineClient["getBlock"];
  const input = { client: f.client, release: f.release, template: f.template, token: f.launch.token, account: ACCOUNT };
  function mined(prepared: PreparedModuleEngineFeeChange) {
    const receipt = { transactionHash: hash(200), blockHash: hash(101), blockNumber: 101n, from: prepared.account, to: prepared.transaction.to, status: "success", logs: [] } as unknown as TransactionReceipt;
    function log(abi: Abi, eventName: string, args: Record<string, unknown>) {
      const event = abi.find(item => item.type === "event" && item.name === eventName);
      if (!event || event.type !== "event") throw new Error("Missing event");
      receipt.logs.push({ address: prepared.transaction.to, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber, transactionHash: receipt.transactionHash, transactionIndex: 0, removed: false, logIndex: receipt.logs.length,
        topics: encodeEventTopics({ abi, eventName, args } as never) as TransactionReceipt["logs"][number]["topics"], data: encodeAbiParameters(event.inputs.filter(item => !item.indexed), event.inputs.filter(item => !item.indexed).map(item => args[item.name!])) });
    }
    if (prepared.kind === "rotate-platform") throw new Error("Use the Any Quote ledger fixture for platform rotation.");
    if (prepared.kind === "rotate-author") {
      log(moduleEngineAuthorWalletAbi, "AuthorWalletChanged", { familyId: prepared.familyId, previousWallet: state.authorWallet, wallet: prepared.recipient }); state.authorWallet = prepared.recipient;
    } else if (prepared.kind === "rotate-creator") {
      log(moduleEngineLedgerAbi, "CreatorWalletChanged", { poolId: prepared.launchId, index: BigInt(prepared.index), previousWallet: state.creatorWallets[prepared.index], newWallet: prepared.recipient, effectiveCreatorFeesReceived: 777n }); state.creatorWallets[prepared.index] = prepared.recipient;
    } else {
      state.creatorWallets.forEach((previousWallet, index) => { if (previousWallet !== prepared.recipients[index]) log(moduleEngineLedgerAbi, "CreatorWalletChanged", { poolId: prepared.launchId, index: BigInt(index), previousWallet, newWallet: prepared.recipients[index], effectiveCreatorFeesReceived: 777n }); });
      log(moduleEngineLedgerAbi, "CreatorRecipientsReplaced", { poolId: prepared.launchId, administrator: prepared.account, adminRevision: prepared.expectedAdminRevision + 1n, wallets: prepared.recipients, effectiveCreatorFeesReceived: 777n });
      state.creatorWallets = [...prepared.recipients]; state.adminRevision++;
    }
    f.client.waitForTransactionReceipt = vi.fn(async () => receipt);
    f.client.getTransaction = vi.fn(async () => ({ hash: receipt.transactionHash, chainId: 4663, from: prepared.account, to: prepared.transaction.to, input: prepared.transaction.data, value: 0n, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash })) as unknown as ModuleEngineClient["getTransaction"];
    return receipt;
  }
  return { ...f, fees: state, input, mined };
}
export function feeStore() {
  const storage = new Map<string, string>();
  const runtime = { now: () => 1_000_000_000, notify: vi.fn(), storage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } },
    locks: { request: async <T>(_name: string, _options: unknown, callback: (lock: object | null) => Promise<T>) => callback({}) } };
  return { runtime, storage };
}
export const NEW_WALLET: Address = addr(111);
