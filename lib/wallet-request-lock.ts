const WALLET_REQUEST_LOCK_PREFIX = "programmable:wallet-request:v1";
const WALLET_REQUEST_TAB_KEY = "programmable:wallet-request-tab:v1";
const WALLET_REQUEST_CHANGE_EVENT = "programmable:wallet-request-lock-change";
const HEX_32 = /^[0-9a-f]{64}$/u;
const HEX_16 = /^[0-9a-f]{32}$/u;
const ACCOUNT = /^0x[0-9a-f]{40}$/u;
const MAX_REQUEST_SUBJECT_LENGTH = 262_144;

export const WALLET_REQUEST_LOCK_TTL_MS = 5 * 60 * 1_000;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type LockManagerLike = Readonly<{
  request: <Result>(
    name: string,
    options: Readonly<{ mode: "exclusive"; ifAvailable: true }>,
    callback: (lock: Readonly<{ name: string }> | null) => Promise<Result>,
  ) => Promise<Result>;
}>;

type CryptoLike = Readonly<{
  subtle: Pick<SubtleCrypto, "digest">;
  getRandomValues: (array: Uint8Array) => Uint8Array;
}>;

type WalletRequestLockRuntime = Readonly<{
  localStorage: StorageLike;
  sessionStorage: StorageLike;
  locks: LockManagerLike;
  crypto: CryptoLike;
  now: () => number;
  notify: () => void;
}>;

type WalletRequestLeaseV1 = Readonly<{
  version: 1;
  tabId: string;
  sessionHash: string;
  requestId: string;
  subjectHash: string;
  acquiredAtMs: number;
  expiresAtMs: number;
}>;

export class WalletRequestPendingError extends Error {
  constructor() {
    super("A wallet request is already pending in another Programmable tab");
    this.name = "WalletRequestPendingError";
  }
}

/** Only local preflight code may use this before invoking any wallet send method. */
export class WalletRequestNotSubmittedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletRequestNotSubmittedError";
  }
}

function normalizedAccount(account: string): string {
  const normalized = account.toLowerCase();
  if (!ACCOUNT.test(normalized)) {
    throw new Error("The wallet request account is invalid");
  }
  return normalized;
}

function normalizedChainId(chainId: string): string {
  if (!/^[1-9][0-9]{0,15}$/u.test(chainId)) {
    throw new Error("The wallet request chain is invalid");
  }
  return chainId;
}

function storageKey(account: string, chainId: string): string {
  return `${WALLET_REQUEST_LOCK_PREFIX}:${normalizedChainId(chainId)}:${normalizedAccount(account)}`;
}

function bytesToLowerHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function sha256(crypto: CryptoLike, value: string): Promise<string> {
  return bytesToLowerHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  );
}

function randomId(crypto: CryptoLike): string {
  return bytesToLowerHex(crypto.getRandomValues(new Uint8Array(16)));
}

function exactLease(value: unknown): WalletRequestLeaseV1 | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (
    Object.keys(record).sort().join(",") !==
      "acquiredAtMs,expiresAtMs,requestId,sessionHash,subjectHash,tabId,version" ||
    record.version !== 1 ||
    typeof record.tabId !== "string" ||
    !HEX_16.test(record.tabId) ||
    typeof record.sessionHash !== "string" ||
    !HEX_32.test(record.sessionHash) ||
    typeof record.requestId !== "string" ||
    !HEX_16.test(record.requestId) ||
    typeof record.subjectHash !== "string" ||
    !HEX_32.test(record.subjectHash) ||
    !Number.isSafeInteger(record.acquiredAtMs) ||
    !Number.isSafeInteger(record.expiresAtMs) ||
    (record.expiresAtMs as number) <= (record.acquiredAtMs as number) ||
    (record.expiresAtMs as number) - (record.acquiredAtMs as number) !==
      WALLET_REQUEST_LOCK_TTL_MS
  ) {
    return null;
  }
  return record as WalletRequestLeaseV1;
}

function readLease(
  storage: StorageLike,
  key: string,
): Readonly<{
  raw: string | null;
  lease: WalletRequestLeaseV1 | null;
}> {
  const raw = storage.getItem(key);
  if (raw === null) return Object.freeze({ raw, lease: null });
  try {
    return Object.freeze({ raw, lease: exactLease(JSON.parse(raw)) });
  } catch {
    return Object.freeze({ raw, lease: null });
  }
}

function currentTabId(runtime: WalletRequestLockRuntime): string {
  const existing = runtime.sessionStorage.getItem(WALLET_REQUEST_TAB_KEY);
  if (existing !== null) {
    if (!HEX_16.test(existing)) {
      throw new Error("The wallet request tab identity is invalid");
    }
    return existing;
  }
  const created = randomId(runtime.crypto);
  runtime.sessionStorage.setItem(WALLET_REQUEST_TAB_KEY, created);
  if (runtime.sessionStorage.getItem(WALLET_REQUEST_TAB_KEY) !== created) {
    throw new Error("The wallet request tab identity is unavailable");
  }
  return created;
}

function browserRuntime(): WalletRequestLockRuntime {
  if (
    typeof window === "undefined" ||
    typeof navigator === "undefined" ||
    navigator.locks === undefined ||
    typeof crypto === "undefined" ||
    crypto.subtle === undefined
  ) {
    throw new Error(
      "Safe wallet request locking is unavailable in this browser",
    );
  }
  return Object.freeze({
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    locks: navigator.locks as LockManagerLike,
    crypto,
    now: Date.now,
    notify: () => window.dispatchEvent(new Event(WALLET_REQUEST_CHANGE_EVENT)),
  });
}

export function errorIsExplicitWalletRejection(error: unknown): boolean {
  const code =
    error !== null && typeof error === "object" && "code" in error
      ? (error as Readonly<{ code?: unknown }>).code
      : undefined;
  const message =
    error instanceof Error
      ? error.message
      : error !== null &&
          typeof error === "object" &&
          "message" in error &&
          typeof (error as Readonly<{ message?: unknown }>).message === "string"
        ? (error as Readonly<{ message: string }>).message
        : "";
  return code === 4001 || /user rejected|user denied/iu.test(message);
}

function removeExactLease(
  runtime: WalletRequestLockRuntime,
  key: string,
  raw: string,
): void {
  try {
    if (runtime.localStorage.getItem(key) === raw) {
      runtime.localStorage.removeItem(key);
      runtime.notify();
    }
  } catch {
    // A completed or explicitly rejected wallet request is authoritative. If
    // cleanup is blocked, retain the fail-closed lease until its bounded TTL.
  }
}

export function browserWalletRequestIsPending(
  account: string | undefined,
  chainId: string,
  now = Date.now(),
): boolean {
  if (typeof window === "undefined" || account === undefined) return false;
  try {
    const { raw, lease } = readLease(
      window.localStorage,
      storageKey(account, chainId),
    );
    // Unknown bytes never silently enable a second wallet request.
    return raw !== null && (lease === null || lease.expiresAtMs > now);
  } catch {
    return true;
  }
}

export function subscribeToBrowserWalletRequest(
  account: string | undefined,
  chainId: string,
  onChange: () => void,
): () => void {
  if (typeof window === "undefined" || account === undefined) {
    return () => undefined;
  }
  let key: string;
  try {
    key = storageKey(account, chainId);
  } catch {
    return () => undefined;
  }
  let expiryTimer: number | undefined;
  const scheduleExpiry = () => {
    if (expiryTimer !== undefined) window.clearTimeout(expiryTimer);
    expiryTimer = undefined;
    try {
      const { lease } = readLease(window.localStorage, key);
      if (lease === null) return;
      const delay = lease.expiresAtMs - Date.now();
      if (delay > 0) {
        expiryTimer = window.setTimeout(onChange, delay + 1);
      }
    } catch {
      return;
    }
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.storageArea === window.localStorage && event.key === key) {
      scheduleExpiry();
      onChange();
    }
  };
  const handleLocalChange = () => {
    scheduleExpiry();
    onChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(WALLET_REQUEST_CHANGE_EVENT, handleLocalChange);
  scheduleExpiry();
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(WALLET_REQUEST_CHANGE_EVENT, handleLocalChange);
    if (expiryTimer !== undefined) window.clearTimeout(expiryTimer);
  };
}

export async function runWithBrowserWalletRequestLock<Result>(
  input: Readonly<{
    sessionSubject: string;
    account: string;
    chainId: string;
    requestSubject: string;
    assertCurrentSession: () => void | Promise<void>;
    execute: () => Promise<Result>;
    runtime?: WalletRequestLockRuntime;
  }>,
): Promise<Result> {
  if (input.sessionSubject.length < 1 || input.sessionSubject.length > 512) {
    throw new Error("The wallet request session is unavailable");
  }
  if (
    input.requestSubject.length < 1 ||
    input.requestSubject.length > MAX_REQUEST_SUBJECT_LENGTH
  ) {
    throw new Error("The wallet request subject is invalid");
  }
  const account = normalizedAccount(input.account);
  const chainId = normalizedChainId(input.chainId);
  const runtime = input.runtime ?? browserRuntime();
  const key = storageKey(account, chainId);
  const lockName = `${key}:exclusive`;
  const [sessionHash, subjectHash] = await Promise.all([
    sha256(
      runtime.crypto,
      JSON.stringify([input.sessionSubject, account, chainId]),
    ),
    sha256(runtime.crypto, input.requestSubject),
  ]);
  const tabId = currentTabId(runtime);
  const requestId = randomId(runtime.crypto);

  return runtime.locks.request(
    lockName,
    { mode: "exclusive", ifAvailable: true },
    async (lock) => {
      if (lock === null) throw new WalletRequestPendingError();
      const now = runtime.now();
      const existing = readLease(runtime.localStorage, key);
      if (
        existing.raw !== null &&
        (existing.lease === null || existing.lease.expiresAtMs > now)
      ) {
        throw new WalletRequestPendingError();
      }
      if (existing.raw !== null) runtime.localStorage.removeItem(key);

      const lease: WalletRequestLeaseV1 = Object.freeze({
        version: 1,
        tabId,
        sessionHash,
        requestId,
        subjectHash,
        acquiredAtMs: now,
        expiresAtMs: now + WALLET_REQUEST_LOCK_TTL_MS,
      });
      const raw = JSON.stringify(lease);
      runtime.localStorage.setItem(key, raw);
      if (runtime.localStorage.getItem(key) !== raw) {
        throw new Error("The wallet request lock could not be verified");
      }
      runtime.notify();

      let executionStarted = false;
      let releaseLease = false;
      try {
        await input.assertCurrentSession();
        executionStarted = true;
        const result = await input.execute();
        releaseLease = true;
        return result;
      } catch (error) {
        releaseLease =
          !executionStarted || error instanceof WalletRequestNotSubmittedError || errorIsExplicitWalletRejection(error);
        throw error;
      } finally {
        if (releaseLease) removeExactLease(runtime, key, raw);
      }
    },
  );
}
