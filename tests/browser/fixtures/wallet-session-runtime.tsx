import { useSyncExternalStore, type ReactNode } from "react";
import { WEBSITE_ADMIN_WALLET } from "../../../lib/admin-access";

// Only the SDK boundary is substituted. Wallet ownership, selection, login
// gating and the application dialog remain in the production WalletProvider.
export const accountA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const accountB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const accountC = "0xcccccccccccccccccccccccccccccccccccccccc";

type FixtureUser = {
  id: string;
  wallet?: { address: string };
  linkedAccounts: { type: "wallet"; chainType: "ethereum"; address: string }[];
};
type FixtureWallet = {
  address: string;
  chainId: string;
  linked: boolean;
  connectedAt: number;
  walletClientType: string;
  connectorType: string;
  isConnected: () => Promise<boolean>;
  switchChain: (chainId: number) => Promise<void>;
  disconnect: () => Promise<void>;
  getEthereumProvider: () => Promise<{ request: (input: { method: string }) => Promise<string | string[]> }>;
};
type FixtureState = {
  ready: boolean;
  authenticated: boolean;
  user: FixtureUser | null;
  walletsReady: boolean;
  wallets: FixtureWallet[];
  isOpen: boolean;
  calls: { method: string; options?: unknown }[];
  delayedLocks: boolean;
  waitingLocks: number;
  delayedNetworkSwitch: boolean;
  waitingNetworkSwitches: number;
  providerAccountOverride: string | null;
  providerChainOverride: string | null;
};

function user(id: string, primary: string | null, addresses: string[]): FixtureUser {
  return {
    id,
    ...(primary ? { wallet: { address: primary } } : {}),
    linkedAccounts: addresses.map((address) => ({ type: "wallet", chainType: "ethereum", address })),
  };
}

const forbidden = async (): Promise<never> => {
  record("forbidden-wallet-operation");
  throw new Error("Wallet signing and transactions are not available in this fixture.");
};

const pendingNetworkSwitches: { resolve: () => void; reject: (error: Error) => void }[] = [];

function wallet(address: string, linked = true, connectedAt = 1, initialChain = "eip155:4663"): FixtureWallet {
  let networkChain = initialChain;
  const provider = {
    request: async ({ method }: { method: string }) => {
      record(method, { address });
      if (method === "eth_chainId") return state.providerChainOverride
        ?? `0x${Number(networkChain.slice("eip155:".length)).toString(16)}`;
      if (method === "eth_accounts") return [state.providerAccountOverride ?? address];
      return forbidden();
    },
  };
  const getEthereumProvider = async () => {
    record("getEthereumProvider", { address });
    return provider;
  };
  return {
    address, linked, connectedAt, chainId: initialChain, walletClientType: "metamask", connectorType: "injected",
    isConnected: async () => true,
    switchChain: async (chainId) => {
      record("switchChain", { address, chainId });
      if (state.delayedNetworkSwitch) {
        await new Promise<void>((resolve, reject) => {
          pendingNetworkSwitches.push({ resolve, reject });
          update({ waitingNetworkSwitches: pendingNetworkSwitches.length });
        });
      }
      networkChain = `eip155:${chainId}`;
      // Privy 3.35.2 rewraps its connector wallet on chainChanged. The public
      // object changes, while connection methods survive the object spread.
      update({ wallets: state.wallets.map((candidate) => candidate.getEthereumProvider === getEthereumProvider
        ? { ...candidate, chainId: networkChain } : candidate) });
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    },
    disconnect: async () => { record("disconnect-provider", { address }); },
    getEthereumProvider,
  };
}

const alpha = user("fixture-user-alpha", accountA, [accountA]);
const alphaBoth = user("fixture-user-alpha", accountA, [accountA, accountB]);
const betaBoth = user("fixture-user-beta", accountA, [accountA, accountB]);
const betaC = user("fixture-user-beta", accountC, [accountC]);
const listeners = new Set<() => void>();
let state: FixtureState = {
  ready: true, authenticated: true, user: alpha, walletsReady: true,
  wallets: [wallet(accountB, false, 900), wallet(accountA)],
  isOpen: false, calls: [], delayedLocks: false, waitingLocks: 0,
  delayedNetworkSwitch: false, waitingNetworkSwitches: 0,
  providerAccountOverride: null, providerChainOverride: null,
};

function update(patch: Partial<FixtureState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function record(method: string, options?: unknown) {
  update({ calls: [...state.calls, { method, ...(options === undefined ? {} : { options }) }] });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function snapshot() { return state; }
function useFixtureState() { return useSyncExternalStore(subscribe, snapshot, snapshot); }

// The real Web Locks implementation still owns and releases the lock. A
// fixture-only barrier delays acquisition so account changes can occur while
// the production asynchronous login/reconnect code is awaiting its lease.
const nativeLocks = navigator.locks;
const waitingLocks: (() => void)[] = [];
Object.defineProperty(navigator, "locks", {
  configurable: true,
  value: {
    request: async (...args: Parameters<LockManager["request"]>) => {
      if (state.delayedLocks && args[0] === "programmable:wallet-login:v1") {
        await new Promise<void>((resolve) => {
          waitingLocks.push(resolve);
          update({ waitingLocks: waitingLocks.length });
        });
      }
      return nativeLocks.request(...args);
    },
    query: () => nativeLocks.query(),
  },
});

type LoginCallbacks = {
  onComplete: (result: { user: FixtureUser; loginAccount: { type: "wallet"; address: string } }) => void;
  onError: (code: string) => void;
};
type ConnectCallbacks = {
  onSuccess: (result: { wallet: FixtureWallet }) => void;
  onError: (code: string) => void;
};
type LinkCallbacks = {
  onSuccess: (result: { user: FixtureUser; linkedAccount: { type: "wallet"; address: string } }) => void;
  onError: (code: string) => void;
};
let loginCallbacks: LoginCallbacks;
let connectCallbacks: ConnectCallbacks;
let linkCallbacks: LinkCallbacks;

const login = (options: unknown) => { record("login", options); update({ isOpen: true }); };
const connectWallet = (options: unknown) => { record("connectWallet", options); update({ isOpen: true }); };
const linkWallet = (options: unknown) => { record("linkWallet", options); update({ isOpen: true }); };
const linkGithub = () => { record("linkGithub"); update({ isOpen: true }); };
const logout = async () => {
  record("logout");
  // Provider connections may outlive the SDK user. The product must ignore them.
  update({ authenticated: false, user: null, isOpen: false });
};
const getAccessToken = async () => null;
export const getIdentityToken = async () => null;
const refreshUser = async () => state.user;
const reauthorize = async () => { record("reauthorize"); };

export function PrivyProvider({ children }: { children: ReactNode }) { return children; }
export function usePrivy() {
  const current = useFixtureState();
  return {
    ready: current.ready, authenticated: current.authenticated, user: current.user,
    getAccessToken, logout,
  };
}
export function useWallets() {
  const current = useFixtureState();
  return { ready: current.walletsReady, wallets: current.wallets };
}
export function useModalStatus() { return { isOpen: useFixtureState().isOpen }; }
export function useLogin(callbacks: LoginCallbacks) { loginCallbacks = callbacks; return { login }; }
export function useConnectWallet(callbacks: ConnectCallbacks) { connectCallbacks = callbacks; return { connectWallet }; }
export function useLinkAccount(callbacks: LinkCallbacks) { linkCallbacks = callbacks; return { linkWallet, linkGithub }; }
export function useIdentityToken() { return { identityToken: null }; }
export function useUser() { return { refreshUser }; }
export function useOAuthTokens() { return { reauthorize }; }
export function useAuthorizationSignature() { return { generateAuthorizationSignature: forbidden }; }
export function useSendTransaction() { return { sendTransaction: forbidden }; }
export function useSignMessage() { return { signMessage: forbidden }; }
export function useLoginWithSiwe() { return { generateSiweMessage: forbidden, loginWithSiwe: forbidden }; }

function chooseScenario(scenario: string) {
  const base = {
    ready: true, authenticated: true, walletsReady: true, isOpen: false, calls: [],
    providerAccountOverride: null, providerChainOverride: null,
  };
  switch (scenario) {
    case "website-admin":
      update({ ...base, user: user("fixture-website-admin", WEBSITE_ADMIN_WALLET, [WEBSITE_ADMIN_WALLET]), wallets: [wallet(WEBSITE_ADMIN_WALLET)] }); break;
    case "both-owned":
      update({ ...base, user: alphaBoth, wallets: [wallet(accountB, true, 900), wallet(accountA)] }); break;
    case "foreign-linked":
      update({ ...base, user: alpha, wallets: [wallet(accountB, true, 900), wallet(accountA)] }); break;
    case "owned-with-foreign":
      update({ ...base, user: alphaBoth, wallets: [wallet(accountC, true, 1000), wallet(accountB, true, 900), wallet(accountA)] }); break;
    case "unsupported-network":
      update({ ...base, user: alpha, wallets: [wallet(accountA, true, 1, "eip155:8453")] }); break;
    case "stale-user-wallets":
      update({ ...base, user: betaC, wallets: [wallet(accountA), wallet(accountB, true, 900)] }); break;
    case "hydrating":
      update({ ...base, walletsReady: false, user: alpha, wallets: [] }); break;
    case "linked-disconnected":
      update({ ...base, user: alpha, wallets: [] }); break;
    case "email-without-wallet":
      update({ ...base, user: user("fixture-email-user", null, []), wallets: [] }); break;
    case "anonymous":
      update({ ...base, authenticated: false, user: null, wallets: [] }); break;
    default:
      update({ ...base, user: alpha, wallets: [wallet(accountB, false, 900), wallet(accountA)] });
  }
}

function completeLogin() {
  update({ authenticated: true, user: alphaBoth, wallets: [wallet(accountA), wallet(accountB, true, 900)], isOpen: false });
  loginCallbacks.onComplete({ user: alphaBoth, loginAccount: { type: "wallet", address: accountB } });
}

export function FixtureControls() {
  const current = useFixtureState();
  return <section aria-label="SDK fixture controls">
    <label>SDK scenario <select aria-label="SDK scenario" onChange={(event) => chooseScenario(event.target.value)} defaultValue="primary">
      <option value="primary">Primary wallet with unlinked recent wallet</option>
      <option value="website-admin">Website admin wallet</option>
      <option value="both-owned">Two linked owned wallets</option>
      <option value="foreign-linked">Foreign linked recent wallet</option>
      <option value="owned-with-foreign">Two owned wallets and one foreign wallet</option>
      <option value="unsupported-network">Connected wallet on an unsupported network</option>
      <option value="stale-user-wallets">New user with stale previous wallets</option>
      <option value="hydrating">Wallet list still hydrating</option>
      <option value="linked-disconnected">Known account, wallet disconnected</option>
      <option value="email-without-wallet">Email account without a wallet</option>
      <option value="anonymous">Anonymous</option>
    </select></label>
    <button onClick={() => update({ walletsReady: true })}>Finish wallet hydration</button>
    <button onClick={() => update({ authenticated: true, user: betaC })}>Change SDK user, keep old wallets</button>
    <button onClick={() => update({ authenticated: true, user: betaBoth })}>Change SDK user, same linked addresses</button>
    <button onClick={() => update({ authenticated: true, user: alpha, wallets: [wallet(accountA)] })}>Restore SDK session</button>
    <button onClick={() => update({ wallets: state.wallets.map((candidate) => wallet(
      candidate.address, candidate.linked, candidate.connectedAt + 1, candidate.chainId,
    )) })}>Replace connected wallet capability</button>
    <button onClick={() => update({ isOpen: true })}>Open SDK modal</button>
    <button onClick={() => update({ isOpen: false })}>Close SDK modal</button>
    <button onClick={() => update({ delayedLocks: !current.delayedLocks })} aria-pressed={current.delayedLocks}>Delay browser lock</button>
    <button onClick={() => {
      const pending = waitingLocks.splice(0);
      update({ waitingLocks: 0, delayedLocks: false });
      pending.forEach((resolve) => resolve());
    }}>Resume browser lock</button>
    <output aria-label="Pending browser locks">{current.waitingLocks}</output>
    <button onClick={() => update({ delayedNetworkSwitch: !current.delayedNetworkSwitch })}
      aria-pressed={current.delayedNetworkSwitch}>Delay network switch</button>
    <button onClick={() => {
      const pending = pendingNetworkSwitches.shift();
      update({ waitingNetworkSwitches: pendingNetworkSwitches.length, delayedNetworkSwitch: false });
      pending?.resolve();
    }}>Resolve network switch</button>
    <button onClick={() => {
      const pending = pendingNetworkSwitches.shift();
      update({ waitingNetworkSwitches: pendingNetworkSwitches.length, delayedNetworkSwitch: false });
      pending?.reject(Object.assign(new Error("User rejected network switch"), { code: 4001 }));
    }}>Reject network switch</button>
    <button onClick={() => update({ providerAccountOverride: accountC })}>Return a different provider account</button>
    <button onClick={() => update({ providerChainOverride: "0x1237" })}>Return the wrong provider network</button>
    <output aria-label="Pending network switches">{current.waitingNetworkSwitches}</output>
    <output aria-label="SDK calls">{JSON.stringify(current.calls)}</output>
    <output aria-label="SDK user">{current.user?.id ?? "anonymous"}</output>
    {current.isOpen ? <section role="dialog" aria-label="SDK wallet dialog">
      <p>Deterministic SDK prompt. No real wallet connection.</p>
      <button onClick={completeLogin}>Complete wallet B login</button>
      <button onClick={() => {
        const connected = wallet(accountA);
        update({ wallets: [connected], isOpen: false });
        connectCallbacks.onSuccess({ wallet: connected });
      }}>Complete wallet A reconnect</button>
      <button onClick={() => {
        update({ isOpen: false });
        linkCallbacks.onError("linked_to_another_user");
      }}>Reject linking foreign account</button>
      <button onClick={() => { update({ isOpen: false }); loginCallbacks.onError("exited_auth_flow"); }}>Cancel SDK login</button>
    </section> : null}
  </section>;
}
