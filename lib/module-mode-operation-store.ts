import { sha256, toHex, type Address, type Hex } from "viem";
import type { PreparedModuleNativeLaunch, PreparedModuleNativeManagement } from "./module-mode/native-client";
import { moduleAddress, moduleHash, moduleRecord, moduleUint } from "./module-mode/release";

const PREFIX = "programmable:module-operation:v1:4663:";
const CHANGE = "programmable:module-operation-change";
const UNAVAILABLE = "storage-unavailable";
const MAX_RECORD_LENGTH = 4_096;

type RecoveryPreparation = PreparedModuleNativeLaunch | PreparedModuleNativeManagement;
export type ModuleModeOperation = Readonly<{
  version: 1;
  id: Hex;
  kind: "launch" | "manage";
  chainId: 4663;
  account: Address;
  target: Address;
  value: string;
  calldataHash: Hex;
  releaseDigest: Hex;
  preparedBlock: string;
  createdAtMs: number;
  token: Address;
  launch: Readonly<{ draftId: Hex; poolId: Hex; recipeHash: Hex; launchKey: Hex; minimumTokenOut: string }> | null;
  transactionHash: Hex | null;
}>;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type StoreRuntime = {
  storage: StorageLike;
  locks: { request: <T>(name: string, options: { mode: "exclusive"; ifAvailable: true }, callback: (lock: unknown | null) => Promise<T>) => Promise<T> };
  notify: () => void;
  now: () => number;
};
function runtime(): StoreRuntime {
  if (typeof window === "undefined" || typeof navigator === "undefined" || !navigator.locks) throw new Error("Transaction recovery storage is unavailable. Enable browser storage before opening your wallet.");
  return { storage: window.localStorage, locks: navigator.locks, notify: () => window.dispatchEvent(new Event(CHANGE)), now: Date.now };
}
function key(account: string) { return `${PREFIX}${moduleAddress(account, "operation.account")}`; }
function identity(record: Omit<ModuleModeOperation, "id" | "transactionHash">): Hex {
  return sha256(toHex(JSON.stringify(record)));
}

/** Storage is a recovery hint, never a signable preparation or release authorization. */
export function parseModuleModeOperation(raw: string, account: string): ModuleModeOperation {
  if (raw.length > MAX_RECORD_LENGTH) throw new Error("The saved transaction record cannot be read. Check your wallet activity before continuing.");
  const value = moduleRecord(JSON.parse(raw), ["version", "id", "kind", "chainId", "account", "target", "value", "calldataHash", "releaseDigest", "preparedBlock", "createdAtMs", "token", "launch", "transactionHash"], "operation");
  if (value.version !== 1 || value.chainId !== 4663 || !["launch", "manage"].includes(String(value.kind)) || !Number.isSafeInteger(value.createdAtMs) || (value.createdAtMs as number) <= 0) throw new Error("The saved transaction record is invalid. Check your wallet activity before continuing.");
  const boundAccount = moduleAddress(value.account, "operation.account");
  if (boundAccount !== moduleAddress(account, "operation.expectedAccount")) throw new Error("The saved transaction belongs to a different wallet.");
  let launch: ModuleModeOperation["launch"] = null;
  if (value.kind === "launch") {
    const candidate = moduleRecord(value.launch, ["draftId", "poolId", "recipeHash", "launchKey", "minimumTokenOut"], "operation.launch");
    launch = { draftId: moduleHash(candidate.draftId, "operation.draftId"), poolId: moduleHash(candidate.poolId, "operation.poolId"), recipeHash: moduleHash(candidate.recipeHash, "operation.recipeHash"), launchKey: moduleHash(candidate.launchKey, "operation.launchKey"), minimumTokenOut: moduleUint(candidate.minimumTokenOut, "operation.minimumTokenOut", true) };
  } else if (value.launch !== null) throw new Error("The saved transaction type is invalid.");
  const bound = { version: 1 as const, kind: value.kind as ModuleModeOperation["kind"], chainId: 4663 as const, account: boundAccount,
    target: moduleAddress(value.target, "operation.target"), value: moduleUint(value.value, "operation.value"), calldataHash: moduleHash(value.calldataHash, "operation.calldataHash"),
    releaseDigest: moduleHash(value.releaseDigest, "operation.releaseDigest"), preparedBlock: moduleUint(value.preparedBlock, "operation.preparedBlock", true), createdAtMs: value.createdAtMs as number,
    token: moduleAddress(value.token, "operation.token"), launch };
  const id = moduleHash(value.id, "operation.id");
  if (identity(bound) !== id) throw new Error("The saved transaction record changed. Check your wallet activity before continuing.");
  return Object.freeze({ ...bound, ...(launch ? { launch: Object.freeze(launch) } : {}), id, transactionHash: value.transactionHash === null ? null : moduleHash(value.transactionHash, "operation.transactionHash") });
}

/** Persist before the provider is invoked. No TTL can turn an unknown broadcast into permission to resend. */
export async function beginModuleModeOperation(prepared: RecoveryPreparation, suppliedRuntime?: StoreRuntime): Promise<ModuleModeOperation> {
  const store = suppliedRuntime ?? runtime();
  const bound = { version: 1 as const, kind: prepared.kind, chainId: 4663 as const, account: moduleAddress(prepared.account, "operation.account"),
    target: moduleAddress(prepared.transaction.to, "operation.target"), value: BigInt(prepared.transaction.value).toString(), calldataHash: sha256(prepared.transaction.data),
    releaseDigest: prepared.releaseDigest, preparedBlock: prepared.blockNumber.toString(), createdAtMs: store.now(),
    token: moduleAddress(prepared.kind === "launch" ? prepared.predictedToken : prepared.token, "operation.token"),
    launch: prepared.kind === "launch" ? { draftId: prepared.draftId, poolId: prepared.poolId, recipeHash: prepared.recipeHash, launchKey: prepared.launchKey, minimumTokenOut: prepared.minimumTokenOut.toString() } : null };
  if (prepared.transaction.chainId !== 4663 || moduleAddress(prepared.transaction.from, "operation.from") !== bound.account) throw new Error("The transaction is bound to a different wallet or chain.");
  const operation = parseModuleModeOperation(JSON.stringify({ ...bound, id: identity(bound), transactionHash: null }), bound.account);
  return store.locks.request(`${key(bound.account)}:exclusive`, { mode: "exclusive", ifAvailable: true }, async lock => {
    if (!lock || store.storage.getItem(key(bound.account)) !== null) throw new Error("A previous Module Mode transaction needs confirmation. Check its status before sending another transaction.");
    const raw = JSON.stringify(operation);
    store.storage.setItem(key(bound.account), raw);
    if (store.storage.getItem(key(bound.account)) !== raw) throw new Error("The transaction recovery record could not be saved. Your wallet was not opened.");
    store.notify();
    return operation;
  });
}

export function rememberModuleModeTransactionHash(operation: ModuleModeOperation, transactionHash: Hex, suppliedRuntime?: StoreRuntime): ModuleModeOperation {
  const store = suppliedRuntime ?? runtime();
  const raw = store.storage.getItem(key(operation.account));
  if (!raw || parseModuleModeOperation(raw, operation.account).id !== operation.id) throw new Error("The saved transaction record changed. Keep the transaction hash from your wallet.");
  const next = { ...operation, transactionHash: moduleHash(transactionHash, "operation.transactionHash") };
  const encoded = JSON.stringify(next);
  store.storage.setItem(key(operation.account), encoded);
  if (store.storage.getItem(key(operation.account)) !== encoded) throw new Error("The transaction hash could not be saved. Keep it from your wallet activity.");
  store.notify();
  return Object.freeze(next);
}

/** Call only after authoritative receipt verification or a definite preflight failure / user rejection. */
export function clearModuleModeOperation(operation: ModuleModeOperation, suppliedRuntime?: StoreRuntime): void {
  const store = suppliedRuntime ?? runtime();
  const raw = store.storage.getItem(key(operation.account));
  if (raw && parseModuleModeOperation(raw, operation.account).id === operation.id) {
    store.storage.removeItem(key(operation.account));
    if (store.storage.getItem(key(operation.account)) !== null) throw new Error("The confirmed transaction record could not be cleared. Reload to check its confirmation again.");
    store.notify();
  }
}

export function moduleModeOperationSnapshot(account: string | undefined): string | null {
  if (!account || typeof window === "undefined") return null;
  try { return window.localStorage.getItem(key(account)); } catch { return UNAVAILABLE; }
}
export function subscribeToModuleModeOperation(account: string | undefined, onChange: () => void): () => void {
  if (!account || typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === key(account)) onChange(); };
  window.addEventListener("storage", onStorage); window.addEventListener(CHANGE, onChange);
  return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(CHANGE, onChange); };
}
export function moduleModeOperationPath(operation: ModuleModeOperation): string {
  return operation.kind === "launch" ? "/launch/modules" : `/launch/modules/manage/${operation.token}`;
}
