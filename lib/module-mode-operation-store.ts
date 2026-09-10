import { sha256, toHex, type Address, type Hex } from "viem";
import type { ModuleNativeAuthorWalletChange, PreparedModuleNativeLaunch, PreparedModuleNativeManagement } from "./module-mode/native-client";
import type { ModuleEngineFeeChange, PreparedModuleEngineTransaction } from "./module-engine/client";
import { validateAnyQuoteExternalRouteV1 } from "./module-engine/any-quote/route";
import type { AnyQuoteExternalRouteV1 } from "./module-engine/any-quote/types";
import { moduleAddress, moduleHash, moduleRecord, moduleUint } from "./module-mode/release";

const PREFIX = "programmable:module-operation:v1:4663:";
const CHANGE = "programmable:module-operation-change";
const UNAVAILABLE = "storage-unavailable";
const MAX_RECORD_LENGTH = 4_096;
const MAX_ROUTE_RECORD_LENGTH = 32_768;

type NativeRecoveryPreparation = PreparedModuleNativeLaunch | PreparedModuleNativeManagement;
type EngineRecoveryPreparation = PreparedModuleEngineTransaction;
export type ModuleModeRecoveryPreparation = NativeRecoveryPreparation | EngineRecoveryPreparation;
type RecoveryPreparation = ModuleModeRecoveryPreparation;
type OperationBinding = Readonly<{
  id: Hex;
  chainId: 4663;
  account: Address;
  target: Address;
  value: string;
  calldataHash: Hex;
  releaseDigest: Hex;
  preparedBlock: string;
  createdAtMs: number;
  token: Address;
  transactionHash: Hex | null;
}>;
type ModuleNativeWalletOperationV1 = OperationBinding & Readonly<{
  version: 1;
  /** Existing v1 records predate the source discriminator and remain byte compatible. */
  sourceKind?: never;
  kind: "launch" | "manage";
  launch: Readonly<{ draftId: Hex; poolId: Hex; recipeHash: Hex; launchKey: Hex; minimumTokenOut: string }> | null;
}>;
export type ModuleNativeAuthorWalletOperation = OperationBinding & Readonly<{
  version: 4; sourceKind?: never; kind: "manage"; launch: null;
  authorWalletChange: ModuleNativeAuthorWalletChange;
}>;
export type ModuleNativeWalletOperation = ModuleNativeWalletOperationV1 | ModuleNativeAuthorWalletOperation;
type ModuleEngineWalletOperationV2 = OperationBinding & Readonly<{
  version: 2;
  sourceKind: "module-engine-v1";
  kind: "launch" | "execute" | "approve" | "claim";
  launch: Readonly<{ launchId: Hex; revisionId: Hex; planHash: Hex }> | null;
  execution: Readonly<{ operationId: Hex; nonce: string }> | null;
  approval: Readonly<{ spender: Address; amount: string }> | null;
  claim: Readonly<{ recipient: Address; minimumAmount: string; claimedBefore: string }> | null;
}>;
type SavedModuleEngineFeeChange = Exclude<ModuleEngineFeeChange, { kind: "replace-creators" }>
  | (Omit<Extract<ModuleEngineFeeChange, { kind: "replace-creators" }>, "expectedAdminRevision" | "deadline"> & Readonly<{ expectedAdminRevision: string; deadline: string }>);
export type ModuleEngineFeeWalletOperation = OperationBinding & Readonly<{
  version: 3; sourceKind: "module-engine-v1"; kind: ModuleEngineFeeChange["kind"];
  launch: Readonly<{ launchId: Hex; revisionId: Hex; planHash: Hex }>;
  feeChange: SavedModuleEngineFeeChange;
}>;
export type ModuleEngineRouteWalletOperation = OperationBinding & Readonly<{
  version: 5; sourceKind: "module-engine-v1"; kind: "swap" | "approve";
  launch: Readonly<{ launchId: Hex; revisionId: Hex; planHash: Hex }> | null;
  swap: Readonly<{ buy: boolean; recipient: Address; quoteAsset: Address; inputAmount: string; minimumOutput: string; deadline: string; externalRoute: AnyQuoteExternalRouteV1 }> | null;
  approval: Readonly<{ spender: Address; amount: string; allowanceKind: "erc20" | "permit2"; permit2Spender: Address | null; expiration: string | null }> | null;
}>;
export type ModuleEngineWalletOperation = ModuleEngineWalletOperationV2 | ModuleEngineFeeWalletOperation | ModuleEngineRouteWalletOperation;
export type ModuleModeOperation = ModuleNativeWalletOperation | ModuleEngineWalletOperation;

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
function identity(record: object): Hex {
  return sha256(toHex(JSON.stringify(record)));
}

/** Storage is a recovery hint, never a signable preparation or release authorization. */
export function parseModuleModeOperation(raw: string, account: string): ModuleModeOperation {
  if (raw.length > MAX_ROUTE_RECORD_LENGTH) throw new Error("The saved transaction record cannot be read. Check your wallet activity before continuing.");
  const decoded = JSON.parse(raw);
  if (decoded?.version === 5) return parseEngineRouteOperation(decoded, account);
  if (raw.length > MAX_RECORD_LENGTH) throw new Error("The saved transaction record is too large.");
  if (decoded?.version === 4) return parseNativeAuthorOperation(decoded, account);
  if (decoded?.version === 3) return parseEngineFeeOperation(decoded, account);
  if (decoded?.version === 2) return parseEngineOperation(decoded, account);
  const value = moduleRecord(decoded, ["version", "id", "kind", "chainId", "account", "target", "value", "calldataHash", "releaseDigest", "preparedBlock", "createdAtMs", "token", "launch", "transactionHash"], "operation");
  if (value.version !== 1 || value.chainId !== 4663 || !["launch", "manage"].includes(String(value.kind)) || !Number.isSafeInteger(value.createdAtMs) || (value.createdAtMs as number) <= 0) throw new Error("The saved transaction record is invalid. Check your wallet activity before continuing.");
  const boundAccount = moduleAddress(value.account, "operation.account");
  if (boundAccount !== moduleAddress(account, "operation.expectedAccount")) throw new Error("The saved transaction belongs to a different wallet.");
  let launch: ModuleNativeWalletOperation["launch"] = null;
  if (value.kind === "launch") {
    const candidate = moduleRecord(value.launch, ["draftId", "poolId", "recipeHash", "launchKey", "minimumTokenOut"], "operation.launch");
    launch = { draftId: moduleHash(candidate.draftId, "operation.draftId"), poolId: moduleHash(candidate.poolId, "operation.poolId"), recipeHash: moduleHash(candidate.recipeHash, "operation.recipeHash"), launchKey: moduleHash(candidate.launchKey, "operation.launchKey"), minimumTokenOut: moduleUint(candidate.minimumTokenOut, "operation.minimumTokenOut", true) };
  } else if (value.launch !== null) throw new Error("The saved transaction type is invalid.");
  const bound = { version: 1 as const, kind: value.kind as ModuleNativeWalletOperation["kind"], chainId: 4663 as const, account: boundAccount,
    target: moduleAddress(value.target, "operation.target"), value: moduleUint(value.value, "operation.value"), calldataHash: moduleHash(value.calldataHash, "operation.calldataHash"),
    releaseDigest: moduleHash(value.releaseDigest, "operation.releaseDigest"), preparedBlock: moduleUint(value.preparedBlock, "operation.preparedBlock", true), createdAtMs: value.createdAtMs as number,
    token: moduleAddress(value.token, "operation.token"), launch };
  const id = moduleHash(value.id, "operation.id");
  if (identity(bound) !== id) throw new Error("The saved transaction record changed. Check your wallet activity before continuing.");
  return Object.freeze({ ...bound, ...(launch ? { launch: Object.freeze(launch) } : {}), id, transactionHash: value.transactionHash === null ? null : moduleHash(value.transactionHash, "operation.transactionHash") });
}

function parseNativeAuthorOperation(decoded: unknown, account: string): ModuleNativeAuthorWalletOperation {
  const value = moduleRecord(decoded, ["version", "id", "kind", "chainId", "account", "target", "value", "calldataHash", "releaseDigest", "preparedBlock", "createdAtMs", "token", "launch", "authorWalletChange", "transactionHash"], "authorOperation");
  if (value.version !== 4 || value.kind !== "manage" || value.chainId !== 4663 || value.value !== "0" || value.launch !== null || !Number.isSafeInteger(value.createdAtMs) || Number(value.createdAtMs) <= 0) throw new Error("The saved author wallet operation is invalid.");
  const actor = moduleAddress(value.account, "operation.account");
  if (actor !== moduleAddress(account, "operation.expectedAccount")) throw new Error("The saved transaction belongs to a different wallet.");
  const change = moduleRecord(value.authorWalletChange, ["launchId", "poolId", "recipeHash", "launchKey", "packageId", "familyId", "author", "previousWallet", "recipient"], "authorOperation.change");
  const authorWalletChange = Object.freeze({ launchId: moduleHash(change.launchId, "launchId"), poolId: moduleHash(change.poolId, "poolId"), recipeHash: moduleHash(change.recipeHash, "recipeHash"), launchKey: moduleHash(change.launchKey, "launchKey"), packageId: moduleHash(change.packageId, "packageId"), familyId: moduleHash(change.familyId, "familyId"), author: moduleAddress(change.author, "author"), previousWallet: moduleAddress(change.previousWallet, "previousWallet"), recipient: moduleAddress(change.recipient, "recipient") });
  if (authorWalletChange.author !== actor || authorWalletChange.previousWallet === authorWalletChange.recipient) throw new Error("The saved author authority or recipient is invalid.");
  const bound = { version: 4 as const, kind: "manage" as const, chainId: 4663 as const, account: actor, target: moduleAddress(value.target, "operation.target"), value: "0", calldataHash: moduleHash(value.calldataHash, "calldataHash"), releaseDigest: moduleHash(value.releaseDigest, "releaseDigest"), preparedBlock: moduleUint(value.preparedBlock, "preparedBlock", true), createdAtMs: Number(value.createdAtMs), token: moduleAddress(value.token, "token"), launch: null, authorWalletChange };
  const id = moduleHash(value.id, "operation.id");
  if (identity(bound) !== id) throw new Error("The saved transaction record changed. Check your wallet activity before continuing.");
  return Object.freeze({ ...bound, id, transactionHash: value.transactionHash === null ? null : moduleHash(value.transactionHash, "transactionHash") });
}

function parseEngineOperation(decoded: unknown, account: string): ModuleEngineWalletOperationV2 {
  const value = moduleRecord(decoded, ["version", "sourceKind", "id", "kind", "chainId", "account", "target", "value", "calldataHash", "releaseDigest", "preparedBlock", "createdAtMs", "token", "launch", "execution", "approval", "claim", "transactionHash"], "engineOperation");
  if (value.version !== 2 || value.sourceKind !== "module-engine-v1" || value.chainId !== 4663 || !["launch", "execute", "approve", "claim"].includes(String(value.kind))
    || !Number.isSafeInteger(value.createdAtMs) || (value.createdAtMs as number) <= 0) throw new Error("The saved engine transaction record is invalid.");
  const boundAccount = moduleAddress(value.account, "operation.account");
  if (boundAccount !== moduleAddress(account, "operation.expectedAccount")) throw new Error("The saved transaction belongs to a different wallet.");
  let launch: ModuleEngineWalletOperationV2["launch"] = null;
  let approval: ModuleEngineWalletOperationV2["approval"] = null;
  if (value.kind === "approve") {
    const candidate = moduleRecord(value.approval, ["spender", "amount"], "engineOperation.approval");
    approval = Object.freeze({ spender: moduleAddress(candidate.spender, "operation.spender"), amount: moduleUint(candidate.amount, "operation.amount") });
    if (value.launch !== null) throw new Error("The saved approval cannot contain a launch binding.");
  } else {
    const candidate = moduleRecord(value.launch, ["launchId", "revisionId", "planHash"], "engineOperation.launch");
    launch = Object.freeze({ launchId: moduleHash(candidate.launchId, "operation.launchId"), revisionId: moduleHash(candidate.revisionId, "operation.revisionId"), planHash: moduleHash(candidate.planHash, "operation.planHash") });
    if (value.approval !== null) throw new Error("The saved engine transaction type is invalid.");
  }
  let execution: ModuleEngineWalletOperationV2["execution"] = null;
  if (value.kind === "execute") {
    const operation = moduleRecord(value.execution, ["operationId", "nonce"], "engineOperation.execution");
    execution = Object.freeze({ operationId: moduleHash(operation.operationId, "operation.operationId"), nonce: moduleUint(operation.nonce, "operation.nonce") });
  } else if (value.execution !== null) throw new Error("The saved engine transaction type is invalid.");
  let claim: ModuleEngineWalletOperationV2["claim"] = null;
  if (value.kind === "claim") {
    const candidate = moduleRecord(value.claim, ["recipient", "minimumAmount", "claimedBefore"], "engineOperation.claim");
    claim = Object.freeze({ recipient: moduleAddress(candidate.recipient, "operation.recipient"), minimumAmount: moduleUint(candidate.minimumAmount, "operation.minimumAmount", true), claimedBefore: moduleUint(candidate.claimedBefore, "operation.claimedBefore") });
  } else if (value.claim !== null) throw new Error("The saved engine transaction type is invalid.");
  const bound = { version: 2 as const, sourceKind: "module-engine-v1" as const, kind: value.kind as ModuleEngineWalletOperationV2["kind"], chainId: 4663 as const, account: boundAccount,
    target: moduleAddress(value.target, "operation.target"), value: moduleUint(value.value, "operation.value"), calldataHash: moduleHash(value.calldataHash, "operation.calldataHash"),
    releaseDigest: moduleHash(value.releaseDigest, "operation.releaseDigest"), preparedBlock: moduleUint(value.preparedBlock, "operation.preparedBlock", true), createdAtMs: value.createdAtMs as number,
    token: moduleAddress(value.token, "operation.token"), launch, execution, approval, claim };
  const id = moduleHash(value.id, "operation.id");
  if (identity(bound) !== id) throw new Error("The saved transaction record changed. Check your wallet activity before continuing.");
  return Object.freeze({ ...bound, id, transactionHash: value.transactionHash === null ? null : moduleHash(value.transactionHash, "operation.transactionHash") });
}

function parseEngineFeeOperation(decoded: unknown, account: string): ModuleEngineFeeWalletOperation {
  const value = moduleRecord(decoded, ["version", "sourceKind", "id", "kind", "chainId", "account", "target", "value", "calldataHash", "releaseDigest", "preparedBlock", "createdAtMs", "token", "launch", "feeChange", "transactionHash"], "feeOperation");
  if (value.version !== 3 || value.sourceKind !== "module-engine-v1" || value.chainId !== 4663 || !Number.isSafeInteger(value.createdAtMs) || (value.createdAtMs as number) <= 0 || value.value !== "0") throw new Error("The saved fee operation is invalid.");
  const actor = moduleAddress(value.account, "operation.account");
  if (actor !== moduleAddress(account, "expected account")) throw new Error("The saved transaction belongs to a different wallet.");
  const rawLaunch = moduleRecord(value.launch, ["launchId", "revisionId", "planHash"], "feeOperation.launch");
  const launch = Object.freeze({ launchId: moduleHash(rawLaunch.launchId, "launchId"), revisionId: moduleHash(rawLaunch.revisionId, "revisionId"), planHash: moduleHash(rawLaunch.planHash, "planHash") });
  const kind = value.kind;
  let feeChange: SavedModuleEngineFeeChange;
  if (kind === "rotate-platform") {
    const change = moduleRecord(value.feeChange, ["kind", "previousWallet", "recipient", "authority"], "platformOperation.change");
    const previousWallet = moduleAddress(change.previousWallet, "previous wallet"), recipient = moduleAddress(change.recipient, "new wallet");
    if (change.kind !== kind || previousWallet === recipient || !["treasury", "reward-admin"].includes(String(change.authority))
      || (change.authority === "treasury" && previousWallet !== actor)) throw new Error("The saved platform recipient is invalid.");
    feeChange = Object.freeze({ kind, previousWallet, recipient, authority: change.authority as "treasury" | "reward-admin" });
  } else if (kind === "rotate-creator" || kind === "rotate-author") {
    const change = moduleRecord(value.feeChange, kind === "rotate-creator" ? ["kind", "index", "previousWallet", "recipient", "shareBps"] : ["kind", "familyId", "author", "previousWallet", "recipient"], "feeOperation.change");
    const previousWallet = moduleAddress(change.previousWallet, "previous wallet"), recipient = moduleAddress(change.recipient, "new wallet");
    if (change.kind !== kind || recipient === previousWallet) throw new Error("The saved wallet change is invalid.");
    if (kind === "rotate-creator") {
      if (!Number.isInteger(change.index) || Number(change.index) < 0 || Number(change.index) >= 10 || !Number.isInteger(change.shareBps) || Number(change.shareBps) <= 0 || Number(change.shareBps) > 10_000 || previousWallet !== actor) throw new Error("The saved creator slot is invalid.");
      feeChange = Object.freeze({ kind, index: Number(change.index), previousWallet, recipient, shareBps: Number(change.shareBps) });
    } else {
      const author = moduleAddress(change.author, "author"); if (author !== actor) throw new Error("The saved author differs from the wallet.");
      feeChange = Object.freeze({ kind, familyId: moduleHash(change.familyId, "family"), author, previousWallet, recipient });
    }
  } else {
    if (kind !== "replace-creators") throw new Error("The saved fee operation is unsupported.");
    const change = moduleRecord(value.feeChange, ["kind", "previousWallets", "recipients", "sharesBps", "expectedAdminRevision", "deadline", "authority"], "feeOperation.change");
    if (change.kind !== kind || !Array.isArray(change.recipients) || change.recipients.length < 1 || change.recipients.length > 10 || !Array.isArray(change.previousWallets) || change.previousWallets.length !== change.recipients.length
      || !Array.isArray(change.sharesBps) || change.sharesBps.length !== change.recipients.length || !change.sharesBps.every(share => Number.isInteger(share) && share > 0 && share <= 10_000) || change.sharesBps.reduce((sum, share) => sum + share, 0) !== 10_000
      || !["treasury", "reward-admin"].includes(String(change.authority))) throw new Error("The saved creator recipients are invalid.");
    feeChange = Object.freeze({ kind, previousWallets: Object.freeze(change.previousWallets.map(wallet => moduleAddress(wallet, "previous wallet"))), recipients: Object.freeze(change.recipients.map(wallet => moduleAddress(wallet, "new wallet"))),
      sharesBps: Object.freeze([...change.sharesBps] as number[]), expectedAdminRevision: moduleUint(change.expectedAdminRevision, "admin revision"), deadline: moduleUint(change.deadline, "deadline", true), authority: change.authority as "treasury" | "reward-admin" });
  }
  const bound = { version: 3 as const, sourceKind: "module-engine-v1" as const, kind: feeChange.kind, chainId: 4663 as const, account: actor, target: moduleAddress(value.target, "target"), value: "0",
    calldataHash: moduleHash(value.calldataHash, "calldataHash"), releaseDigest: moduleHash(value.releaseDigest, "releaseDigest"), preparedBlock: moduleUint(value.preparedBlock, "preparedBlock", true), createdAtMs: value.createdAtMs as number,
    token: moduleAddress(value.token, "token"), launch, feeChange };
  const id = moduleHash(value.id, "operation.id"); if (identity(bound) !== id) throw new Error("The saved transaction record changed. Check your wallet activity before continuing.");
  return Object.freeze({ ...bound, id, transactionHash: value.transactionHash === null ? null : moduleHash(value.transactionHash, "transactionHash") });
}

function parseEngineRouteOperation(decoded: unknown, account: string): ModuleEngineRouteWalletOperation {
  const value = moduleRecord(decoded, ["version", "sourceKind", "id", "kind", "chainId", "account", "target", "value", "calldataHash", "releaseDigest", "preparedBlock", "createdAtMs", "token", "launch", "swap", "approval", "transactionHash"], "routeOperation");
  if (value.version !== 5 || value.sourceKind !== "module-engine-v1" || value.chainId !== 4663 || !["swap", "approve"].includes(String(value.kind)) || !Number.isSafeInteger(value.createdAtMs) || Number(value.createdAtMs) <= 0) throw new Error("The saved route operation is invalid.");
  const actor = moduleAddress(value.account, "account"); if (actor !== moduleAddress(account, "expected account")) throw new Error("The saved transaction belongs to a different wallet.");
  let launch: ModuleEngineRouteWalletOperation["launch"] = null, swap: ModuleEngineRouteWalletOperation["swap"] = null, approval: ModuleEngineRouteWalletOperation["approval"] = null;
  if (value.kind === "swap") {
    const savedLaunch = moduleRecord(value.launch, ["launchId", "revisionId", "planHash"], "routeOperation.launch");
    launch = { launchId: moduleHash(savedLaunch.launchId, "launchId"), revisionId: moduleHash(savedLaunch.revisionId, "revisionId"), planHash: moduleHash(savedLaunch.planHash, "planHash") };
    const saved = moduleRecord(value.swap, ["buy", "recipient", "quoteAsset", "inputAmount", "minimumOutput", "deadline", "externalRoute"], "routeOperation.swap");
    if (typeof saved.buy !== "boolean" || value.approval !== null) throw new Error("The saved swap is invalid.");
    const externalRoute = saved.externalRoute as AnyQuoteExternalRouteV1; validateAnyQuoteExternalRouteV1(externalRoute);
    swap = { buy: saved.buy, recipient: moduleAddress(saved.recipient, "recipient"), quoteAsset: moduleAddress(saved.quoteAsset, "quoteAsset"), inputAmount: moduleUint(saved.inputAmount, "inputAmount", true), minimumOutput: moduleUint(saved.minimumOutput, "minimumOutput", true), deadline: moduleUint(saved.deadline, "deadline", true), externalRoute };
    if (String(value.value) !== (swap.buy ? swap.inputAmount : "0")) throw new Error("The saved swap funding differs.");
  } else {
    const saved = moduleRecord(value.approval, ["spender", "amount", "allowanceKind", "permit2Spender", "expiration"], "routeOperation.approval");
    if (value.launch !== null || value.swap !== null || value.value !== "0" || !["erc20", "permit2"].includes(String(saved.allowanceKind))) throw new Error("The saved route approval is invalid.");
    if (saved.allowanceKind === "erc20" && (saved.permit2Spender !== null || saved.expiration !== null)) throw new Error("The saved token approval is invalid.");
    approval = { spender: moduleAddress(saved.spender, "spender"), amount: moduleUint(saved.amount, "amount"), allowanceKind: saved.allowanceKind as "erc20" | "permit2",
      permit2Spender: saved.allowanceKind === "permit2" ? moduleAddress(saved.permit2Spender, "permit2Spender") : null, expiration: saved.allowanceKind === "permit2" ? moduleUint(saved.expiration, "expiration", true) : null };
  }
  const bound = { version: 5 as const, sourceKind: "module-engine-v1" as const, kind: value.kind as "swap" | "approve", chainId: 4663 as const, account: actor, target: moduleAddress(value.target, "target"), value: moduleUint(value.value, "value"), calldataHash: moduleHash(value.calldataHash, "calldataHash"), releaseDigest: moduleHash(value.releaseDigest, "releaseDigest"), preparedBlock: moduleUint(value.preparedBlock, "preparedBlock", true), createdAtMs: Number(value.createdAtMs), token: moduleAddress(value.token, "token"), launch, swap, approval };
  const id = moduleHash(value.id, "id"); if (identity(bound) !== id) throw new Error("The saved transaction record changed. Check your wallet activity before continuing.");
  return Object.freeze({ ...bound, id, transactionHash: value.transactionHash === null ? null : moduleHash(value.transactionHash, "transactionHash") });
}

/** Persist before the provider is invoked. No TTL can turn an unknown broadcast into permission to resend. */
export function beginModuleModeOperation(prepared: NativeRecoveryPreparation, suppliedRuntime?: StoreRuntime): Promise<ModuleNativeWalletOperation>;
export function beginModuleModeOperation(prepared: EngineRecoveryPreparation, suppliedRuntime?: StoreRuntime): Promise<ModuleEngineWalletOperation>;
export function beginModuleModeOperation(prepared: RecoveryPreparation, suppliedRuntime?: StoreRuntime): Promise<ModuleModeOperation>;
export async function beginModuleModeOperation(prepared: RecoveryPreparation, suppliedRuntime?: StoreRuntime): Promise<ModuleModeOperation> {
  const store = suppliedRuntime ?? runtime();
  if ("sourceKind" in prepared) {
    if (prepared.sourceKind !== "module-engine-v1") throw new Error("The transaction source is unsupported.");
    if (prepared.kind === "rotate-platform" || prepared.kind === "rotate-creator" || prepared.kind === "replace-creators" || prepared.kind === "rotate-author") {
      const feeChange: SavedModuleEngineFeeChange = prepared.kind === "rotate-platform" ? { kind: prepared.kind, previousWallet: prepared.previousWallet, recipient: prepared.recipient, authority: prepared.authority } : prepared.kind === "rotate-creator" ? { kind: prepared.kind, index: prepared.index, previousWallet: prepared.previousWallet, recipient: prepared.recipient, shareBps: prepared.shareBps }
        : prepared.kind === "rotate-author" ? { kind: prepared.kind, familyId: prepared.familyId, author: prepared.author, previousWallet: prepared.previousWallet, recipient: prepared.recipient }
          : { kind: prepared.kind, previousWallets: prepared.previousWallets, recipients: prepared.recipients, sharesBps: prepared.sharesBps, expectedAdminRevision: prepared.expectedAdminRevision.toString(), deadline: prepared.deadline.toString(), authority: prepared.authority };
      const bound = { version: 3 as const, sourceKind: "module-engine-v1" as const, kind: prepared.kind, chainId: 4663 as const, account: moduleAddress(prepared.account, "account"),
        target: moduleAddress(prepared.transaction.to, "target"), value: BigInt(prepared.transaction.value).toString(), calldataHash: sha256(prepared.transaction.data), releaseDigest: prepared.releaseDigest, preparedBlock: prepared.blockNumber.toString(), createdAtMs: store.now(),
        token: prepared.token, launch: { launchId: prepared.launchId, revisionId: prepared.revisionId, planHash: prepared.planHash }, feeChange };
      return persistOperation(prepared, bound, store);
    }
    if (prepared.kind === "swap" || (prepared.kind === "approve" && prepared.allowanceKind)) {
      const bound = { version: 5 as const, sourceKind: "module-engine-v1" as const, kind: prepared.kind, chainId: 4663 as const,
        account: moduleAddress(prepared.account, "account"), target: moduleAddress(prepared.transaction.to, "target"), value: BigInt(prepared.transaction.value).toString(),
        calldataHash: sha256(prepared.transaction.data), releaseDigest: prepared.releaseDigest, preparedBlock: prepared.blockNumber.toString(), createdAtMs: store.now(), token: moduleAddress(prepared.token, "token"),
        launch: prepared.kind === "swap" ? { launchId: prepared.launchId, revisionId: prepared.revisionId, planHash: prepared.planHash } : null,
        swap: prepared.kind === "swap" ? { buy: prepared.buy, recipient: moduleAddress(prepared.recipient, "recipient"), quoteAsset: moduleAddress(prepared.quoteAsset, "quoteAsset"), inputAmount: prepared.inputAmount.toString(), minimumOutput: prepared.minimumOutput.toString(), deadline: prepared.expiresAt.toString(), externalRoute: prepared.externalRoute } : null,
        approval: prepared.kind === "approve" ? { spender: moduleAddress(prepared.spender, "spender"), amount: prepared.amount.toString(), allowanceKind: prepared.allowanceKind!, permit2Spender: prepared.permit2Spender ? moduleAddress(prepared.permit2Spender, "permit2Spender") : null, expiration: prepared.expiration?.toString() ?? null } : null };
      return persistOperation(prepared, bound, store);
    }
    const bound = { version: 2 as const, sourceKind: "module-engine-v1" as const, kind: prepared.kind, chainId: 4663 as const, account: moduleAddress(prepared.account, "operation.account"),
      target: moduleAddress(prepared.transaction.to, "operation.target"), value: BigInt(prepared.transaction.value).toString(), calldataHash: sha256(prepared.transaction.data),
      releaseDigest: prepared.releaseDigest, preparedBlock: prepared.blockNumber.toString(), createdAtMs: store.now(),
      token: moduleAddress(prepared.kind === "launch" ? prepared.predictedToken : prepared.token, "operation.token"),
      launch: prepared.kind === "approve" ? null : { launchId: prepared.launchId, revisionId: prepared.revisionId, planHash: prepared.planHash },
      execution: prepared.kind === "execute" ? { operationId: prepared.operation.operationId, nonce: prepared.operation.nonce.toString() } : null,
      approval: prepared.kind === "approve" ? { spender: prepared.spender, amount: prepared.amount.toString() } : null,
      claim: prepared.kind === "claim" ? { recipient: prepared.recipient, minimumAmount: prepared.minimumAmount.toString(), claimedBefore: prepared.claimedBefore.toString() } : null };
    return persistOperation(prepared, bound, store);
  }
  if (prepared.kind === "manage" && prepared.authorWalletChange) {
    const bound = { version: 4 as const, kind: "manage" as const, chainId: 4663 as const, account: moduleAddress(prepared.account, "operation.account"), target: moduleAddress(prepared.transaction.to, "operation.target"), value: BigInt(prepared.transaction.value).toString(), calldataHash: sha256(prepared.transaction.data), releaseDigest: prepared.releaseDigest, preparedBlock: prepared.blockNumber.toString(), createdAtMs: store.now(), token: prepared.token, launch: null, authorWalletChange: prepared.authorWalletChange };
    return persistOperation(prepared, bound, store);
  }
  const bound = { version: 1 as const, kind: prepared.kind, chainId: 4663 as const, account: moduleAddress(prepared.account, "operation.account"),
    target: moduleAddress(prepared.transaction.to, "operation.target"), value: BigInt(prepared.transaction.value).toString(), calldataHash: sha256(prepared.transaction.data),
    releaseDigest: prepared.releaseDigest, preparedBlock: prepared.blockNumber.toString(), createdAtMs: store.now(),
    token: moduleAddress(prepared.kind === "launch" ? prepared.predictedToken : prepared.token, "operation.token"),
    launch: prepared.kind === "launch" ? { draftId: prepared.draftId, poolId: prepared.poolId, recipeHash: prepared.recipeHash, launchKey: prepared.launchKey, minimumTokenOut: prepared.minimumTokenOut.toString() } : null };
  return persistOperation(prepared, bound, store);
}

async function persistOperation(prepared: RecoveryPreparation, bound: { account: Address }, store: StoreRuntime): Promise<ModuleModeOperation> {
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

export async function rememberModuleModeTransactionHash(operation: ModuleModeOperation, transactionHash: Hex, suppliedRuntime?: StoreRuntime): Promise<ModuleModeOperation> {
  const store = suppliedRuntime ?? runtime();
  return store.locks.request(`${key(operation.account)}:exclusive`, { mode: "exclusive", ifAvailable: true }, async lock => {
    if (!lock) throw new Error("Transaction recovery is busy in another tab. Keep the transaction hash from your wallet.");
    const raw = store.storage.getItem(key(operation.account));
    if (!raw || parseModuleModeOperation(raw, operation.account).id !== operation.id) throw new Error("The saved transaction record changed. Keep the transaction hash from your wallet.");
    const next = { ...operation, transactionHash: moduleHash(transactionHash, "operation.transactionHash") };
    const encoded = JSON.stringify(next);
    store.storage.setItem(key(operation.account), encoded);
    if (store.storage.getItem(key(operation.account)) !== encoded) throw new Error("The transaction hash could not be saved. Keep it from your wallet activity.");
    store.notify();
    return Object.freeze(next);
  });
}

/** Call only after authoritative receipt verification or a definite preflight failure / user rejection. */
export async function clearModuleModeOperation(operation: ModuleModeOperation, suppliedRuntime?: StoreRuntime): Promise<void> {
  const store = suppliedRuntime ?? runtime();
  return store.locks.request(`${key(operation.account)}:exclusive`, { mode: "exclusive", ifAvailable: true }, async lock => {
    if (!lock) throw new Error("Transaction recovery is busy in another tab. Check its confirmation again.");
    const raw = store.storage.getItem(key(operation.account));
    if (raw && parseModuleModeOperation(raw, operation.account).id === operation.id) {
      store.storage.removeItem(key(operation.account));
      if (store.storage.getItem(key(operation.account)) !== null) throw new Error("The confirmed transaction record could not be cleared. Reload to check its confirmation again.");
      store.notify();
    }
  });
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
  if (operation.sourceKind === "module-engine-v1") return `${operation.kind === "launch" || operation.kind === "approve" ? "/launch/modules" : `/launch/modules/manage/${operation.token}`}?sourceKind=module-engine-v1&releaseDigest=${operation.releaseDigest}`;
  return operation.kind === "launch" ? "/launch/modules" : `/launch/modules/manage/${operation.token}${operation.version === 4 ? `?releaseDigest=${operation.releaseDigest}` : ""}`;
}
