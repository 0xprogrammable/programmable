import { afterEach, describe, expect, it, vi } from "vitest";

import { getWalletProviderOnChain, type WalletNetworkProvider } from "@/lib/wallet-network";

const target = { chainId: 4663, networkName: "Robinhood Chain" };
type Request = Parameters<WalletNetworkProvider["request"]>[0];

function fixture(cachedChainId = "eip155:1") {
  let providerChainId: unknown = "0x1";
  let active = true;
  const provider = {
    request: vi.fn(async (input: Request): Promise<unknown> => {
      if (input.method === "eth_chainId") return providerChainId;
      providerChainId = input.params[0].chainId;
      return null;
    }),
  };
  const wallet = {
    chainId: cachedChainId,
    getEthereumProvider: vi.fn(async () => provider),
    switchChain: vi.fn(async (chainId: number) => { providerChainId = chainId; }),
  };
  const assertCurrentSession = vi.fn(() => {
    if (!active) throw new Error("Wallet session changed");
  });
  return {
    wallet, provider, assertCurrentSession,
    setProviderChain(chainId: unknown) { providerChainId = chainId; },
    changeSession() { active = false; },
  };
}

afterEach(() => vi.useRealTimers());

describe("wallet provider network recovery", () => {
  it("returns without a prompt when the provider and SDK already agree on the target", async () => {
    const state = fixture("eip155:4663");
    state.setProviderChain(4663);
    await expect(getWalletProviderOnChain({ ...target, ...state })).resolves.toBe(state.provider);
    expect(state.wallet.getEthereumProvider).toHaveBeenCalledOnce();
    expect(state.wallet.switchChain).not.toHaveBeenCalled();
    expect(state.provider.request.mock.calls).toEqual([[{ method: "eth_chainId" }]]);
  });

  it("asks the SDK to synchronize when only its cached chain is wrong", async () => {
    const state = fixture();
    state.setProviderChain("0x1237");
    await expect(getWalletProviderOnChain({ ...target, ...state })).resolves.toBe(state.provider);
    expect(state.wallet.switchChain).toHaveBeenCalledExactlyOnceWith(4663);
    expect(state.wallet.getEthereumProvider).toHaveBeenCalledTimes(2);
    expect(state.provider.request.mock.calls).toEqual([[{ method: "eth_chainId" }], [{ method: "eth_chainId" }]]);
  });

  it("switches the actual provider when the SDK target cache would skip the request", async () => {
    const state = fixture("eip155:4663");
    // This matches Privy's cached-target early return: it cannot change the provider.
    state.wallet.switchChain.mockImplementation(async () => {});
    await expect(getWalletProviderOnChain({ ...target, ...state })).resolves.toBe(state.provider);
    expect(state.wallet.switchChain).not.toHaveBeenCalled();
    expect(state.wallet.getEthereumProvider).toHaveBeenCalledTimes(2);
    expect(state.provider.request.mock.calls).toEqual([
      [{ method: "eth_chainId" }],
      [{ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1237" }] }],
      [{ method: "eth_chainId" }],
    ]);
  });

  it("uses the SDK for a different cached chain and verifies its newly returned provider", async () => {
    const state = fixture();
    const switchedProvider = { request: vi.fn<WalletNetworkProvider["request"]>(async () => "0x1237") };
    state.wallet.getEthereumProvider.mockResolvedValueOnce(state.provider).mockResolvedValue(switchedProvider);
    await expect(getWalletProviderOnChain({ ...target, ...state })).resolves.toBe(switchedProvider);
    expect(state.wallet.switchChain).toHaveBeenCalledExactlyOnceWith(4663);
    expect(state.provider.request.mock.calls).toEqual([[{ method: "eth_chainId" }]]);
    expect(switchedProvider.request.mock.calls).toEqual([[{ method: "eth_chainId" }]]);
  });

  it("waits for provider convergence after the switch promise resolves", async () => {
    vi.useFakeTimers();
    const state = fixture();
    state.wallet.switchChain.mockImplementation(async () => {
      setTimeout(() => state.setProviderChain("0x01237"), 350);
    });
    const ready = getWalletProviderOnChain({ ...target, ...state });
    await vi.advanceTimersByTimeAsync(400);
    await expect(ready).resolves.toBe(state.provider);
    expect(state.wallet.switchChain).toHaveBeenCalledOnce();
    expect(state.provider.request.mock.calls.length).toBe(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["eip155:1", "eip155:4663"])("preserves wallet rejection for cached chain %s", async (cachedChain) => {
    const state = fixture(cachedChain);
    const rejection = Object.assign(new Error("User rejected the network switch"), { code: 4001 });
    state.wallet.switchChain.mockRejectedValue(rejection);
    state.provider.request.mockImplementation(async (input) => {
      if (input.method === "eth_chainId") return "0x1";
      throw rejection;
    });
    await expect(getWalletProviderOnChain({ ...target, ...state })).rejects.toBe(rejection);
    expect(state.wallet.getEthereumProvider).toHaveBeenCalledOnce();
  });

  it.each(["0x1", "garbage"])("stops within the readback budget when the provider remains %s", async (chain) => {
    vi.useFakeTimers();
    const state = fixture();
    state.wallet.switchChain.mockImplementation(async () => state.setProviderChain(chain));
    const failure = expect(getWalletProviderOnChain({ ...target, ...state })).rejects.toThrow("The wallet is not connected to Robinhood Chain");
    await vi.advanceTimersByTimeAsync(2_000);
    await failure;
    expect(state.wallet.switchChain).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds a readback request that never returns", async () => {
    vi.useFakeTimers();
    const state = fixture();
    state.provider.request.mockResolvedValueOnce("0x1").mockImplementation(() => new Promise(() => {}));
    const failure = expect(getWalletProviderOnChain({ ...target, ...state })).rejects.toThrow("The wallet is not connected to Robinhood Chain");
    await vi.advanceTimersByTimeAsync(2_000);
    await failure;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not prompt if the session changes during the initial provider read", async () => {
    const state = fixture();
    state.provider.request.mockImplementation(async () => {
      state.changeSession();
      return "0x1";
    });
    await expect(getWalletProviderOnChain({ ...target, ...state })).rejects.toThrow("Wallet session changed");
    expect(state.wallet.switchChain).not.toHaveBeenCalled();
    expect(state.provider.request).toHaveBeenCalledOnce();
  });

  it("does not reuse a provider after the session changes during the switch", async () => {
    const state = fixture();
    state.wallet.switchChain.mockImplementation(async () => state.changeSession());
    await expect(getWalletProviderOnChain({ ...target, ...state })).rejects.toThrow("Wallet session changed");
    expect(state.wallet.getEthereumProvider).toHaveBeenCalledOnce();
  });

  it("stops polling when the session changes while waiting for convergence", async () => {
    vi.useFakeTimers();
    const state = fixture();
    state.wallet.switchChain.mockImplementation(async () => {});
    const failure = expect(getWalletProviderOnChain({ ...target, ...state })).rejects.toThrow("Wallet session changed");
    await vi.advanceTimersByTimeAsync(0);
    expect(state.provider.request).toHaveBeenCalledTimes(2);
    state.changeSession();
    await vi.advanceTimersByTimeAsync(200);
    await failure;
    expect(state.provider.request).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects an invalid target before requesting a provider", async () => {
    const state = fixture();
    await expect(getWalletProviderOnChain({ ...target, ...state, chainId: Number.NaN })).rejects.toThrow("network is invalid");
    expect(state.wallet.getEthereumProvider).not.toHaveBeenCalled();
  });
});
