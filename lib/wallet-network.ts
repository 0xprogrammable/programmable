import { normalizeWalletChainId, parseWalletChainId, walletChainIdsEqual } from "@/lib/wallet-chain-id";

export type WalletNetworkProvider = {
  request: (input:
    | { method: "eth_chainId" }
    | { method: "wallet_switchEthereumChain"; params: [{ chainId: `0x${string}` }] }
  ) => Promise<unknown>;
};

const NETWORK_READBACK_TIMEOUT_MS = 2_000;
const NETWORK_READBACK_INTERVAL_MS = 200;

function beforeDeadline<T>(request: () => Promise<T>, deadline: number, failure: () => Error): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.reject(failure());
  let timeout: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(failure()), remaining);
  });
  let response: Promise<T>;
  try {
    response = request();
  } catch (error) {
    clearTimeout(timeout!);
    return Promise.reject(error);
  }
  return Promise.race([response, expired]).finally(() => clearTimeout(timeout!));
}

export async function getWalletProviderOnChain<TProvider extends WalletNetworkProvider>(input: Readonly<{
  wallet: {
    chainId: unknown;
    getEthereumProvider: () => Promise<TProvider>;
    switchChain: (chainId: number) => Promise<unknown>;
  };
  chainId: number;
  assertCurrentSession: () => void;
  networkName: string;
}>): Promise<TProvider> {
  const { wallet, assertCurrentSession } = input;
  const chainId = parseWalletChainId(input.chainId);
  const chainHex = normalizeWalletChainId(input.chainId);
  const wrongNetwork = () => new Error(`The wallet is not connected to ${input.networkName}`);

  try {
    assertCurrentSession();
    if (chainId === null || chainHex === null) throw new Error("The requested wallet network is invalid");
    const provider = await wallet.getEthereumProvider();
    assertCurrentSession();
    const currentChainId = await provider.request({ method: "eth_chainId" });
    assertCurrentSession();
    if (walletChainIdsEqual(currentChainId, chainId) && walletChainIdsEqual(wallet.chainId, chainId)) return provider;

    if (walletChainIdsEqual(wallet.chainId, chainId)) {
      // An SDK cache can already show the target and skip its own switch request.
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
    } else {
      await wallet.switchChain(chainId);
    }
    assertCurrentSession();

    const deadline = Date.now() + NETWORK_READBACK_TIMEOUT_MS;
    const switchedProvider = await beforeDeadline(() => wallet.getEthereumProvider(), deadline, wrongNetwork);
    assertCurrentSession();
    while (Date.now() < deadline) {
      const observedChainId = await beforeDeadline(
        () => switchedProvider.request({ method: "eth_chainId" }), deadline, wrongNetwork,
      );
      assertCurrentSession();
      if (walletChainIdsEqual(observedChainId, chainId)) return switchedProvider;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(NETWORK_READBACK_INTERVAL_MS, Math.max(0, deadline - Date.now()))));
      assertCurrentSession();
    }
    throw wrongNetwork();
  } catch (error) {
    assertCurrentSession();
    throw error;
  }
}
