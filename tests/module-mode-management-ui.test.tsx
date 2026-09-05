import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ModuleCoinConsoleView, type ModuleCoinConsoleViewProps } from "@/components/module-coin-console";
import { referenceManagementManifest } from "@/lib/module-mode/management-manifest";
import type { ModuleManagementSnapshot } from "@/lib/module-mode/management";
import { bindActiveModuleModeRelease } from "@/lib/module-mode/release";
import { a, h, moduleEvidenceFixture } from "./fixtures/module-mode-evidence";

vi.mock("@/components/wallet-provider", () => ({ useWallet: vi.fn() }));

// Synthetic presentation fixtures only; these objects never pass the native client's private transaction brand.
function state(): ModuleManagementSnapshot {
  const release = bindActiveModuleModeRelease(moduleEvidenceFixture().release);
  return { release, blockNumber: 100n, blockHash: h(100), timestamp: 2_000_000n, actor: a(90), name: "Orbit", symbol: "ORBIT",
    launch: { launchId: h(20), launchWallet: a(90), token: a(21), poolId: h(22), recipeHash: h(23), hook: release.contracts.hook.address,
      positionRecipient: a(24), positionTokenId: 1n, initialBuyNative: 1n, initialBuyTokens: 1n, runtime: release.contracts.runtime.address, launchKey: h(25) },
    instances: [{ index: 0, instanceId: h(30), packageId: h(31), configHash: h(32), factory: a(33), factoryCodeHash: h(34), module: a(35), moduleCodeHash: h(36), callbackGas: 300_000,
      title: "Buyer rewards", manifest: referenceManagementManifest("reward"), problem: null,
      reads: { "every-n": 3n, "minimum-buy": 1_000_000_000_000_000n, "reward": 10_000_000_000_000_000n, "qualified": 12n, "rewarded": 4n,
        "ends-at": 2_000_000n, "refund-wallet": a(90), "reclaimed": 0n, "initial-buy": false },
      available: 500_000_000_000_000_000n, claimable: 10_000_000_000_000_000n, claimed: 0n }],
    fees: { claimable: 200_000_000_000_000_000n, claimed: 100_000_000_000_000_000n, contributedByCoin: 300_000_000_000_000_000n,
      treasury: a(91), administrator: a(92), wallets: [a(90)], sharesBps: [10_000], adminRevision: 1n } };
}
function props(snapshot: ModuleManagementSnapshot | null = state()): ModuleCoinConsoleViewProps {
  return { token: a(21), snapshot, loading: false, unavailable: false, walletReady: true, onChain: true, phase: "idle", prepared: null,
    hash: null, error: "", onPrepare: vi.fn(), onPrepareTrade: vi.fn(), onConfirm: vi.fn(), onCancel: vi.fn(), onRefresh: vi.fn(), onCheckReceipt: vi.fn(), onWallet: vi.fn(), onSwitch: vi.fn() };
}
function view(input = props()) { return renderToStaticMarkup(<ModuleCoinConsoleView {...input} />); }
function button(html: string, label: string) {
  const result = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find(item => item.replace(/<[^>]*>/g, "") === label);
  expect(result, `Button ${label}`).toBeDefined(); return result!;
}
function review(snapshot = state()) {
  return { kind: "manage" as const, token: snapshot.launch.token, transaction: { chainId: 4663 as const, from: a(90), to: snapshot.release.contracts.budgetVault.address,
    data: "0x12345678" as const, value: "0xde0b6b3a7640000" as const, action: "manage" as const, description: `Fund Buyer rewards. Unused budget goes to ${a(95)}.` },
    account: a(90), releaseDigest: snapshot.release.releaseDigest, blockNumber: 100n, expiresAt: 2_000_300n, gasEstimate: 100_000n };
}

describe("Module Mode coin controls", () => {
  it("keeps an inactive release empty without a simulated launch, trade or claim action", () => {
    const html = view({ ...props(null), unavailable: true });
    expect(html).toContain("Module management is not available yet");
    for (const label of ["Review buy", "Review funding", "Claim ETH", "Confirm in wallet"]) expect(html).not.toContain(label);
  });
  it("shows real units, module budgets, generic declared reads and the global fee-claim scope", () => {
    const html = view();
    expect(html).toContain("0.5 ETH"); expect(html).toContain("0.01 ETH"); expect(html).toContain("Buyer rewards");
    expect(html).toContain("1970-01-24 03:33 UTC");
    expect(html).toContain("Available fees across your Module Mode coins"); expect(html).toContain("Earned from this coin");
    expect(button(html, "Claim ETH")).not.toContain("disabled"); expect(button(html, "Review buy")).not.toContain("disabled");
    expect(html).toContain('id="trade"'); expect(html).not.toMatch(/<p[^>]*>[^<]*<details/);
  });
  it("renders unknown claims as unknown until the wallet connects and disables actions on the wrong chain", () => {
    const snapshot = state(); snapshot.actor = null; snapshot.fees.claimable = null; snapshot.instances[0].claimable = null;
    const html = view({ ...props(snapshot), walletReady: false });
    expect(html).toContain("Your available claim</span><strong>— ETH"); expect(button(html, "Claim ETH")).toContain("disabled");
    expect(button(html, "Connect wallet")).not.toContain("disabled");
    const wrongChain = view({ ...props(), onChain: false }); expect(button(wrongChain, "Review buy")).toContain("disabled");
    expect(button(wrongChain, "Switch network")).not.toContain("disabled");
  });
  it("shows unsupported management while preserving already backed claims", () => {
    const snapshot = state(); snapshot.instances[0].problem = "Unsupported capability: future-ui@7";
    const html = view(props(snapshot)); expect(html).toContain("future-ui@7");
    expect(html).not.toContain("Review funding"); expect(html).not.toContain("Review reclaim");
    expect(button(html, "Claim ETH")).not.toContain("disabled");
  });
  it("keeps extreme declared timestamps readable without breaking the remaining controls", () => {
    const snapshot = state(); snapshot.instances[0].reads["ends-at"] = -(2n ** 128n);
    const html = view(props(snapshot)); expect(html).toContain("Unix seconds"); expect(button(html, "Claim ETH")).not.toContain("disabled");
  });
  it("gates refund controls by the declared wallet and deadline, and renders a new action schema without a module-name branch", () => {
    const snapshot = state(); const manifest = snapshot.instances[0].manifest!;
    const label = `Review ${manifest.actions[0].label.toLowerCase()}`;
    expect(button(view(props(snapshot)), label)).not.toContain("disabled");
    snapshot.instances[0].reads["ends-at"] = 2_000_001n; expect(button(view(props(snapshot)), label)).toContain("disabled");
    snapshot.instances[0].reads["ends-at"] = 2_000_000n; snapshot.actor = a(98); expect(button(view(props(snapshot)), label)).toContain("disabled");
    manifest.actions = [{ ...manifest.actions[0], id: "custom-choice", label: "Set experiment size", availableAfterRead: null, role: { kind: "connected-wallet" }, encoding: "open-config",
      inputSchema: { type: "record", fields: { count: { type: "uint", bits: 128, min: "1", label: "Experiment size" } }, required: ["count"] } }];
    const html = view(props(snapshot)); expect(html).toContain("Experiment size"); expect(button(html, "Review set experiment size")).not.toContain("disabled");
  });
  it("shows only the existing creator or administrator management role without redirecting old claims", () => {
    const snapshot = state();
    const own = view(props(snapshot)); expect(own).toContain("Change my fee wallet"); expect(own).not.toContain("Replace creator fee recipients");
    snapshot.actor = snapshot.fees.administrator; const admin = view(props(snapshot)); expect(admin).toContain("Replace creator fee recipients");
    expect(admin).toContain("Existing claims and module reward wallets are unaffected");
    snapshot.actor = a(97); const outsider = view(props(snapshot)); expect(outsider).not.toContain("Replace creator fee recipients"); expect(outsider).not.toContain("Change my fee wallet");
  });
  it("shows destination and effects in review, then exposes only read retries after an uncertain submission", () => {
    const prepared = review();
    const html = view({ ...props(), phase: "review", prepared }); expect(html).toContain(a(95)); expect(html).toContain("1 ETH"); expect(button(html, "Confirm in wallet")).not.toContain("disabled");
    for (const phase of ["pending", "unconfirmed", "checking"] as const) {
      const result = view({ ...props(), phase, prepared, hash: phase === "unconfirmed" ? null : h(999) });
      expect(result).not.toContain("Confirm in wallet"); expect(button(result, "Review buy")).toContain("disabled");
      expect(button(result, "Claim ETH")).toContain("disabled"); expect(result).toContain("never sends another transaction");
      expect(button(result, phase === "checking" ? "Checking confirmation…" : "Check confirmation")).toContain(phase === "checking" ? "disabled" : "type=\"submit\"");
    }
    const mined = view({ ...props(), phase: "mined", hash: h(999) }); expect(mined).toContain("Finality and indexing are separate checks");
    const reverted = view({ ...props(), phase: "reverted", hash: h(999) }); expect(reverted).toContain("Its changes were not applied");
  });
  it("keeps swap amounts, minimum output, fee split and limited approval distinct in review", () => {
    const base = review();
    const swap = { ...base, kind: "swap" as const, token: a(21), poolId: h(22), isBuy: true, amountSpecified: -(10n ** 18n), limit: 99n * 10n ** 18n, recipient: a(90),
      nativeAmount: 10n ** 18n, tokenAmount: 100n * 10n ** 18n, feeComponents: { creatorBps: 100, platformBps: 20, poolProtocolPips: 0, poolLpPips: 0 } };
    const buy = view({ ...props(), phase: "review", prepared: swap }); expect(buy).toContain("99 ORBIT"); expect(buy).toContain("1% creator + 0.2% platform");
    const approval = { ...base, kind: "approve" as const, token: a(21), amount: 5n * 10n ** 18n };
    expect(view({ ...props(), phase: "review", prepared: approval })).toContain("This approval does not sell your tokens");
  });
});
