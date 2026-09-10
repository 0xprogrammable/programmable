import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  acquireBrowserWalletLoginLease,
  createWalletLoginAttemptGate,
  WALLET_LOGIN_OTHER_TAB_MESSAGE,
} from "../lib/wallet-login-lock";

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

describe("wallet login lock", () => {
  it("turns a same-tab double click into exactly one Privy login invocation", () => {
    const gate = createWalletLoginAttemptGate();
    const login = vi.fn();
    const startLogin = () => {
      if (!gate.tryStart()) return;
      login();
    };

    startLogin();
    startLogin();

    expect(login).toHaveBeenCalledOnce();
    expect(gate.isPending()).toBe(true);
  });

  it("unlocks the same tab after every settled login attempt", () => {
    const gate = createWalletLoginAttemptGate();

    expect(gate.tryStart()).toBe(true);
    expect(gate.tryStart()).toBe(false);
    gate.settle();
    expect(gate.isPending()).toBe(false);
    expect(gate.tryStart()).toBe(true);
  });

  it("holds the Web Lock until the active Privy attempt releases it", async () => {
    const locks = new ExclusiveTestLocks();
    const firstRuntime = { locks };
    const secondRuntime = { locks };
    const first = await acquireBrowserWalletLoginLease(firstRuntime);
    expect(locks.active.size).toBe(1);

    await expect(
      acquireBrowserWalletLoginLease(secondRuntime),
    ).rejects.toMatchObject({
      name: "WalletLoginPendingError",
      message: WALLET_LOGIN_OTHER_TAB_MESSAGE,
    });
    expect(locks.active.size).toBe(1);

    first.release();
    first.release();
    await vi.waitFor(() => expect(locks.active.size).toBe(0));

    const second = await acquireBrowserWalletLoginLease(secondRuntime);
    expect(locks.active.size).toBe(1);
    second.release();
    await vi.waitFor(() => expect(locks.active.size).toBe(0));
  });

  it("degrades to a safe no-op lease when Web Locks are unavailable", async () => {
    const first = await acquireBrowserWalletLoginLease({});
    const second = await acquireBrowserWalletLoginLease({});

    expect(first.release).toBeTypeOf("function");
    expect(second.release).toBeTypeOf("function");
    expect(() => {
      first.release();
      first.release();
      second.release();
    }).not.toThrow();
  });

  it("wires settlement, busy UI and the accessible cross-tab status", () => {
    const provider = readFileSync(
      join(process.cwd(), "components/wallet-provider.tsx"),
      "utf8",
    );
    const apiKeys = readFileSync(
      join(process.cwd(), "components/developer-api-keys.tsx"),
      "utf8",
    );

    expect(provider).toContain(
      "if (!walletLoginAttemptGateRef.current.tryStart()) return;",
    );
    expect(provider).toMatch(
      /onComplete: \(\{ user: signedInUser, loginAccount \}\) => \{\s+settleWalletLoginAttempt\(\);/u,
    );
    expect(provider).toMatch(
      /onError: \(errorCode\) => \{\s+settleWalletLoginAttempt\(\);/u,
    );
    expect(provider).toContain(
      "loginPending || (accountSwitchRequested && !providerTimedOut) || (!providerSettled && !providerTimedOut)",
    );
    expect(provider).not.toContain("walletLoginExpiryTimerRef");
    expect(provider).toContain('? "Opening wallet"');
    expect(provider).toContain('role="status"');
    expect(provider).toContain("{walletLoginStatus}");
    expect(apiKeys).toContain("disabled={connecting}");
    expect(apiKeys).toContain("aria-busy={connecting}");
    expect(apiKeys).toContain("<span>Connect wallet</span>");
  });
});
