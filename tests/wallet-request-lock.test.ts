import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  runWithBrowserWalletRequestLock,
  WALLET_REQUEST_LOCK_TTL_MS,
  WalletRequestPendingError,
  WalletRequestNotSubmittedError,
} from "../lib/wallet-request-lock";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

class ThrowingStorage extends MemoryStorage {
  constructor(private readonly failingOperation: "get" | "set") {
    super();
  }

  override getItem(key: string) {
    if (this.failingOperation === "get") {
      throw new Error("storage read unavailable");
    }
    return super.getItem(key);
  }

  override setItem(key: string, value: string) {
    if (this.failingOperation === "set") {
      throw new Error("storage write unavailable");
    }
    super.setItem(key, value);
  }
}

class ExclusiveTestLocks {
  readonly active = new Set<string>();

  async request<Result>(
    name: string,
    _options: Readonly<{ mode: "exclusive"; ifAvailable: true }>,
    callback: (lock: Readonly<{ name: string }> | null) => Promise<Result>,
  ): Promise<Result> {
    if (this.active.has(name)) return callback(null);
    this.active.add(name);
    try {
      return await callback(Object.freeze({ name }));
    } finally {
      this.active.delete(name);
    }
  }
}

const ACCOUNT = `0x${"a".repeat(40)}`;
const SESSION = "did:privy:production-session";
const SUBJECT = JSON.stringify({
  kind: "launch",
  chainId: 1,
  from: ACCOUNT,
  to: `0x${"b".repeat(40)}`,
  data: "0x1234",
  value: "0x0",
});
const cryptoRuntime = {
  subtle: webcrypto.subtle,
  getRandomValues: (array: Uint8Array) => {
    webcrypto.getRandomValues(array as Uint8Array<ArrayBuffer>);
    return array;
  },
};

function deferred<Result>() {
  let resolve!: (value: Result) => void;
  const promise = new Promise<Result>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function runtime(
  input?: Readonly<{
    localStorage?: MemoryStorage;
    sessionStorage?: MemoryStorage;
    locks?: ExclusiveTestLocks;
    now?: () => number;
  }>,
) {
  return {
    localStorage: input?.localStorage ?? new MemoryStorage(),
    sessionStorage: input?.sessionStorage ?? new MemoryStorage(),
    locks: input?.locks ?? new ExclusiveTestLocks(),
    crypto: cryptoRuntime,
    now: input?.now ?? (() => 1_800_000_000_000),
    notify: vi.fn(),
  };
}

function request(
  execute: () => Promise<string>,
  requestRuntime: ReturnType<typeof runtime>,
  assertCurrentSession: () => void | Promise<void> = () => undefined,
) {
  return runWithBrowserWalletRequestLock({
    sessionSubject: SESSION,
    account: ACCOUNT,
    chainId: "1",
    requestSubject: SUBJECT,
    assertCurrentSession,
    execute,
    runtime: requestRuntime,
  });
}

describe("production wallet request lock", () => {
  it("gates every production transaction and permit entrypoint before wallet I/O", () => {
    const provider = readFileSync(
      join(process.cwd(), "components/wallet-provider.tsx"),
      "utf8",
    );
    const preparedStart = provider.indexOf(
      "const sendTransaction = useCallback",
    );
    const preparedEnd = provider.indexOf(
      "const signPredictionPermit = useCallback",
      preparedStart,
    );
    const predictionPermitEnd = provider.indexOf(
      "const signLaunchMessage = useCallback",
      preparedEnd,
    );
    const customStart = provider.indexOf(
      "const sendBrowserWalletAction = useCallback",
      predictionPermitEnd,
    );
    const customEnd = provider.indexOf(
      "const readTradeBalances = useCallback",
      customStart,
    );

    expect(preparedStart).toBeGreaterThan(-1);
    expect(preparedEnd).toBeGreaterThan(preparedStart);
    expect(predictionPermitEnd).toBeGreaterThan(preparedEnd);
    expect(customStart).toBeGreaterThan(predictionPermitEnd);
    expect(customEnd).toBeGreaterThan(customStart);

    for (const [entrypoint, switchExpression] of [
      [provider.slice(preparedStart, preparedEnd), "switchChain(target.chain.id)"],
      [provider.slice(customStart, customEnd), "switchChain(appChain.id)"],
    ] as const) {
      const switchChain = entrypoint.indexOf(switchExpression);
      const postSwitchSessionCheck = entrypoint.indexOf(
        "assertCurrentSession();",
        switchChain,
      );
      const lock = entrypoint.indexOf("runWithBrowserWalletRequestLock({");
      expect(switchChain).toBeGreaterThan(-1);
      expect(postSwitchSessionCheck).toBeGreaterThan(switchChain);
      expect(postSwitchSessionCheck).toBeLessThan(lock);
      expect(lock).toBeGreaterThan(-1);
      expect(entrypoint.indexOf("sendPrivyTransaction(")).toBeGreaterThan(lock);
      expect(
        entrypoint.indexOf('method: "eth_sendTransaction"'),
      ).toBeGreaterThan(lock);
      expect(entrypoint).toContain("assertCurrentSession");
    }

    const predictionPermit = provider.slice(preparedEnd, predictionPermitEnd);
    const predictionSwitch = predictionPermit.indexOf(
      "switchChain(robinhoodChain.id)",
    );
    const predictionSessionCheck = predictionPermit.indexOf(
      "assertCurrentSession();",
      predictionSwitch,
    );
    const predictionLock = predictionPermit.indexOf(
      "runWithBrowserWalletRequestLock({",
    );
    expect(predictionSwitch).toBeGreaterThan(-1);
    expect(predictionSessionCheck).toBeGreaterThan(predictionSwitch);
    expect(predictionSessionCheck).toBeLessThan(predictionLock);
    expect(predictionPermit.indexOf('method: "eth_signTypedData_v4"'))
      .toBeGreaterThan(predictionLock);
  });

  it("keeps the branded Prediction V2 account and wallet capability inside the lock", () => {
    const provider = readFileSync(
      join(process.cwd(), "components/wallet-provider.tsx"),
      "utf8",
    );
    const start = provider.indexOf(
      "const sendPredictionV2Transaction = useCallback",
    );
    const end = provider.indexOf(
      "const signPredictionPermit = useCallback",
      start,
    );
    const entrypoint = provider.slice(start, end);
    const lock = entrypoint.indexOf("runWithBrowserWalletRequestLock({");
    const execute = entrypoint.indexOf("execute: async () => {");
    const providerAccess = entrypoint.indexOf(
      "boundWallet.getEthereumProvider()",
    );
    const privySubmission = entrypoint.indexOf(
      "submitPredictionV2PrivyTransactionV2({",
    );
    const eip1193Submission = entrypoint.indexOf(
      "submitPredictionV2Eip1193TransactionV2({",
    );

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(lock).toBeGreaterThan(-1);
    expect(execute).toBeGreaterThan(lock);
    expect(providerAccess).toBeGreaterThan(execute);
    expect(privySubmission).toBeGreaterThan(providerAccess);
    expect(eip1193Submission).toBeGreaterThan(providerAccess);
    expect(entrypoint).toContain("current.walletCapability !== boundWallet");
    expect(entrypoint).toContain("wallet: boundWallet");
    expect(entrypoint).toContain("submission.wallet !== boundWallet");
    expect(entrypoint).toContain("address: submission.account");
    expect(entrypoint).toContain("assertExternalWalletAuthorityCurrent({");
    expect(entrypoint).not.toContain("address: wallet.account");
    expect(entrypoint).not.toContain("switchChain(");
  });

  it("turns a forced same-tab double click into exactly one wallet send", async () => {
    const hold = deferred<string>();
    const send = vi.fn(() => hold.promise);
    const requestRuntime = runtime();

    const first = request(send, requestRuntime);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    await expect(request(send, requestRuntime)).rejects.toBeInstanceOf(
      WalletRequestPendingError,
    );

    hold.resolve(`0x${"1".repeat(64)}`);
    await expect(first).resolves.toBe(`0x${"1".repeat(64)}`);
    expect(send).toHaveBeenCalledOnce();
    expect(requestRuntime.localStorage.values).toHaveLength(0);
  });

  it("accepts the full validated prepared-transaction calldata envelope", async () => {
    const requestRuntime = runtime();
    const send = vi.fn(async () => `0x${"6".repeat(64)}`);

    await expect(
      runWithBrowserWalletRequestLock({
        sessionSubject: SESSION,
        account: ACCOUNT,
        chainId: "1",
        requestSubject: `prepared:${"a".repeat(131_074)}`,
        assertCurrentSession: () => undefined,
        execute: send,
        runtime: requestRuntime,
      }),
    ).resolves.toBe(`0x${"6".repeat(64)}`);
    expect(send).toHaveBeenCalledOnce();
  });

  it("stores only bounded request, session and tab bindings", async () => {
    const hold = deferred<string>();
    const requestRuntime = runtime();
    const pending = request(() => hold.promise, requestRuntime);
    await vi.waitFor(() =>
      expect(requestRuntime.localStorage.values).toHaveLength(1),
    );

    const raw = [...requestRuntime.localStorage.values.values()][0];
    const lease = JSON.parse(raw ?? "null") as Record<string, unknown>;
    expect(lease).toMatchObject({ version: 1 });
    expect(lease.tabId).toMatch(/^[0-9a-f]{32}$/u);
    expect(lease.requestId).toMatch(/^[0-9a-f]{32}$/u);
    expect(lease.sessionHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(lease.subjectHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(raw).not.toContain(SESSION);
    expect(raw).not.toContain(SUBJECT);

    hold.resolve(`0x${"7".repeat(64)}`);
    await pending;
  });

  it("turns simultaneous requests from two tabs into exactly one wallet send", async () => {
    const localStorage = new MemoryStorage();
    const locks = new ExclusiveTestLocks();
    const firstRuntime = runtime({
      localStorage,
      locks,
      sessionStorage: new MemoryStorage(),
    });
    const secondRuntime = runtime({
      localStorage,
      locks,
      sessionStorage: new MemoryStorage(),
    });
    const hold = deferred<string>();
    const firstSend = vi.fn(() => hold.promise);
    const secondSend = vi.fn(async () => `0x${"2".repeat(64)}`);

    const first = request(firstSend, firstRuntime);
    await vi.waitFor(() => expect(firstSend).toHaveBeenCalledOnce());
    await expect(request(secondSend, secondRuntime)).rejects.toBeInstanceOf(
      WalletRequestPendingError,
    );
    expect(secondSend).not.toHaveBeenCalled();

    hold.resolve(`0x${"1".repeat(64)}`);
    await first;
    expect(firstSend).toHaveBeenCalledOnce();
    expect(secondSend).not.toHaveBeenCalled();
  });

  it("binds and revalidates the current session before wallet I/O", async () => {
    const requestRuntime = runtime();
    const send = vi.fn(async () => `0x${"1".repeat(64)}`);

    await expect(
      request(send, requestRuntime, () => {
        throw new Error("The wallet session changed. Try again");
      }),
    ).rejects.toThrow("wallet session changed");
    expect(send).not.toHaveBeenCalled();
    expect(requestRuntime.localStorage.values).toHaveLength(0);
  });

  it("retains an ambiguous failed send until bounded crash recovery expires", async () => {
    let now = 1_800_000_000_000;
    const requestRuntime = runtime({ now: () => now });
    const ambiguousSend = vi.fn(async () => {
      throw new Error("Wallet connection was interrupted");
    });

    await expect(request(ambiguousSend, requestRuntime)).rejects.toThrow(
      "interrupted",
    );
    expect(requestRuntime.localStorage.values).toHaveLength(1);
    await expect(request(vi.fn(), requestRuntime)).rejects.toBeInstanceOf(
      WalletRequestPendingError,
    );

    now += WALLET_REQUEST_LOCK_TTL_MS + 1;
    const recoveredSend = vi.fn(async () => `0x${"3".repeat(64)}`);
    await expect(request(recoveredSend, requestRuntime)).resolves.toBe(
      `0x${"3".repeat(64)}`,
    );
    expect(recoveredSend).toHaveBeenCalledOnce();
    expect(requestRuntime.localStorage.values).toHaveLength(0);
  });

  it("releases a locally classified preflight failure but ignores untrusted no-send flags", async () => {
    const requestRuntime = runtime();
    await expect(request(async () => {
      throw new WalletRequestNotSubmittedError("The reviewed launch expired before wallet I/O");
    }, requestRuntime)).rejects.toThrow("expired");
    expect(requestRuntime.localStorage.values).toHaveLength(0);
    await expect(request(async () => {
      throw Object.assign(new Error("Provider connection interrupted"), { walletRequestAttempted: false });
    }, requestRuntime)).rejects.toThrow("interrupted");
    expect(requestRuntime.localStorage.values).toHaveLength(1);
  });

  it("releases an explicit user rejection without weakening unknown failures", async () => {
    const requestRuntime = runtime();
    await expect(
      request(async () => {
        throw Object.assign(new Error("User rejected the request"), {
          code: 4001,
        });
      }, requestRuntime),
    ).rejects.toMatchObject({ code: 4001 });
    expect(requestRuntime.localStorage.values).toHaveLength(0);

    const retry = vi.fn(async () => `0x${"4".repeat(64)}`);
    await expect(request(retry, requestRuntime)).resolves.toBe(
      `0x${"4".repeat(64)}`,
    );
    expect(retry).toHaveBeenCalledOnce();
  });

  it("fails closed when browser lock state is malformed", async () => {
    const requestRuntime = runtime();
    requestRuntime.localStorage.setItem(
      `programmable:wallet-request:v1:1:${ACCOUNT}`,
      "not-json",
    );
    const send = vi.fn(async () => `0x${"5".repeat(64)}`);

    await expect(request(send, requestRuntime)).rejects.toBeInstanceOf(
      WalletRequestPendingError,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("fails closed before wallet I/O when browser storage is unavailable", async () => {
    for (const requestRuntime of [
      runtime({ sessionStorage: new ThrowingStorage("set") }),
      runtime({ localStorage: new ThrowingStorage("get") }),
      runtime({ localStorage: new ThrowingStorage("set") }),
    ]) {
      const send = vi.fn(async () => `0x${"8".repeat(64)}`);
      await expect(request(send, requestRuntime)).rejects.toThrow(
        /storage|wallet request/iu,
      );
      expect(send).not.toHaveBeenCalled();
    }
  });

  it("fails closed before wallet I/O without browser locks or crypto", async () => {
    const missingBrowserRuntimeSend = vi.fn(async () => `0x${"9".repeat(64)}`);
    await expect(
      runWithBrowserWalletRequestLock({
        sessionSubject: SESSION,
        account: ACCOUNT,
        chainId: "1",
        requestSubject: SUBJECT,
        assertCurrentSession: () => undefined,
        execute: missingBrowserRuntimeSend,
      }),
    ).rejects.toThrow("Safe wallet request locking is unavailable");
    expect(missingBrowserRuntimeSend).not.toHaveBeenCalled();

    for (const requestRuntime of [
      { ...runtime(), locks: undefined as never },
      {
        ...runtime(),
        crypto: {
          ...cryptoRuntime,
          subtle: undefined as never,
        },
      },
    ]) {
      const send = vi.fn(async () => `0x${"a".repeat(64)}`);
      await expect(request(send, requestRuntime)).rejects.toThrow();
      expect(send).not.toHaveBeenCalled();
    }
  });
});
