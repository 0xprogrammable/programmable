import { getAddress, sha256, toHex, type Address, type Hex } from "viem";
import type { SwapChainId } from "./types";

const PREFIX = "programmable:swap-pending:v1:";
const EVENT = "programmable:swap-pending-change";
export interface PendingSwap {
  version: 1;
  id: Hex;
  chainId: SwapChainId;
  owner: Address;
  token: Address;
  kind: "swap" | "approval";
  to: Address;
  dataHash: Hex;
  value: string;
  preparedBlock: string;
  createdAt: number;
  hash: Hex | null;
}
type PendingBody = Omit<PendingSwap, "id" | "hash">;
function key(owner: string, chainId: SwapChainId) { return `${PREFIX}${chainId}:${getAddress(owner).toLowerCase()}`; }
const digest = (body: PendingBody) => sha256(toHex(JSON.stringify(body)));
const hash = (value: unknown): value is Hex => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
function parse(raw: string, owner: string, chainId: SwapChainId): PendingSwap {
  if (raw.length > 4096) throw new Error("The saved swap cannot be read. Check your wallet activity before continuing.");
  const row = JSON.parse(raw) as PendingSwap;
  if (row.version !== 1 || row.chainId !== chainId || getAddress(row.owner) !== getAddress(owner)
    || !["swap", "approval"].includes(row.kind) || !hash(row.dataHash) || !hash(row.id)
    || (row.hash !== null && !hash(row.hash)) || !/^(0|[1-9][0-9]{0,77})$/.test(row.value)
    || !/^[1-9][0-9]{0,77}$/.test(row.preparedBlock) || !Number.isSafeInteger(row.createdAt) || row.createdAt <= 0) {
    throw new Error("The saved swap is invalid. Check your wallet activity before continuing.");
  }
  const body: PendingBody = { version: 1, chainId, owner: getAddress(row.owner), token: getAddress(row.token), kind: row.kind,
    to: getAddress(row.to), dataHash: row.dataHash, value: row.value, preparedBlock: row.preparedBlock, createdAt: row.createdAt };
  if (digest(body) !== row.id) throw new Error("The saved swap changed. Check your wallet activity before continuing.");
  return Object.freeze({ ...body, id: row.id, hash: row.hash });
}
export function getPendingSwap(owner: string, chainId: SwapChainId): PendingSwap | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key(owner, chainId));
  return raw === null ? null : parse(raw, owner, chainId);
}
export function subscribePendingSwap(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener);
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener("storage", listener); };
}
function notify() { window.dispatchEvent(new Event(EVENT)); }
export async function beginPendingSwap(input: Omit<PendingBody, "version" | "createdAt" | "dataHash"> & { data: Hex }): Promise<PendingSwap> {
  if (typeof navigator === "undefined" || !navigator.locks) throw new Error("Enable browser storage before opening your wallet.");
  return navigator.locks.request(key(input.owner, input.chainId), { mode: "exclusive", ifAvailable: true }, lock => {
    if (!lock || getPendingSwap(input.owner, input.chainId)) throw new Error("Check the previous swap in your wallet before sending another.");
    const body: PendingBody = { version: 1, chainId: input.chainId, owner: getAddress(input.owner), token: getAddress(input.token), kind: input.kind,
      to: getAddress(input.to), dataHash: sha256(input.data), value: input.value, preparedBlock: input.preparedBlock, createdAt: Date.now() };
    const pending = Object.freeze({ ...body, id: digest(body), hash: null });
    const raw = JSON.stringify(pending);
    window.localStorage.setItem(key(input.owner, input.chainId), raw);
    if (window.localStorage.getItem(key(input.owner, input.chainId)) !== raw) throw new Error("The swap could not be saved for recovery. No transaction was sent.");
    notify();
    return pending;
  });
}
export function recordPendingSwapHash(pending: PendingSwap, transactionHash: Hex): PendingSwap {
  if (!hash(transactionHash)) throw new Error("Enter a transaction hash from your wallet.");
  const current = getPendingSwap(pending.owner, pending.chainId);
  if (!current || current.id !== pending.id || (current.hash !== null && current.hash.toLowerCase() !== transactionHash.toLowerCase())) throw new Error("The saved swap changed. Check your wallet activity.");
  const next = Object.freeze({ ...current, hash: transactionHash });
  window.localStorage.setItem(key(pending.owner, pending.chainId), JSON.stringify(next));
  notify();
  return next;
}
export function clearPendingSwap(pending: PendingSwap) {
  const current = getPendingSwap(pending.owner, pending.chainId);
  if (!current) return;
  if (current.id !== pending.id) throw new Error("A newer swap is awaiting confirmation.");
  window.localStorage.removeItem(key(pending.owner, pending.chainId));
  notify();
}
