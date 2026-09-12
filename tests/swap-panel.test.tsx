import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { parseUnits } from "viem";
import { useWallet } from "../components/wallet-provider";
import { SwapPanel } from "../components/swap-panel";
import { displaySwapAmount, maximumSwapInput, parseSwapAmount } from "../components/swap-amount";

vi.mock("../components/wallet-provider", () => ({ useWallet: vi.fn() }));

describe("swap input precision and spend limits", () => {
  it("preserves the entire sell balance even beyond Number precision", () => {
    const balance = 12345678901234567890123456789n;
    expect(maximumSwapInput({ side: "sell", chainId: 4663, tokenBalanceRaw: balance, nativeBalanceWei: 1n, gasPriceWei: 1n })).toBe(balance);
    expect(parseSwapAmount("12345678901.234567890123456789", 18)).toBe(balance);
  });
  it("rejects unsupported precision and non-decimal input instead of rounding a trade", () => {
    for (const value of ["1e18", "-1", "Infinity", "1,000", "0", "1.0000001"]) expect(parseSwapAmount(value, 6)).toBeNull();
    expect(parseSwapAmount(".000001", 6)).toBe(1n);
    expect(parseSwapAmount("1.2", 0)).toBeNull();
    expect(parseSwapAmount((2n ** 256n).toString(), 0)).toBeNull();
  });
  it("keeps gas outside ETH Max and never returns a negative spend", () => {
    const input = { side: "buy" as const, chainId: 4663 as const, tokenBalanceRaw: 0n, gasPriceWei: 100_000_000n };
    const balance = parseUnits("1", 18);
    expect(maximumSwapInput({ ...input, nativeBalanceWei: balance })).toBe(balance - 300_000_000_000_000n);
    expect(maximumSwapInput({ ...input, nativeBalanceWei: 100n })).toBe(0n);
    expect(maximumSwapInput({ ...input, nativeBalanceWei: balance, gasEstimate: 4_000_000n })).toBe(balance - 600_000_000_000_000n);
  });
  it("shows very small real outputs without turning them into zero", () => {
    expect(displaySwapAmount(123n, 18)).toBe("0.000000000000000123");
    expect(displaySwapAmount(12345678901234567890123n, 18)).toBe("12,345.678901");
    expect(displaySwapAmount(0n, 18)).toBe("0");
  });
});

describe("swap initial state", () => {
  it("offers a wallet connection with no fabricated balance or quote", () => {
    vi.mocked(useWallet).mockReturnValue({ wallet: null, authenticated: false, sessionReady: true,
      connecting: false, openingWallet: false, switchingNetwork: false, disconnecting: false } as ReturnType<typeof useWallet>);
    const html = renderToStaticMarkup(<SwapPanel />);
    expect(html).toContain("Connect wallet");
    expect(html).toContain("Buy this coin with ETH");
    expect(html).toContain("Coin address");
    expect(html).not.toContain("Balance:");
    expect(html).not.toContain("Minimum received");
    expect(html).toMatch(/<output[^>]*data-empty="true"[^>]*>—<\/output>/);
  });
  it("keeps a token link tied to its explicit network", () => {
    vi.mocked(useWallet).mockReturnValue({ wallet: null, authenticated: false, sessionReady: true } as ReturnType<typeof useWallet>);
    const html = renderToStaticMarkup(<SwapPanel initialChainId={1} initialAddress="0x1111111111111111111111111111111111111111" />);
    expect(html).toContain('value="1" selected=""');
    expect(html).toContain('value="0x1111111111111111111111111111111111111111"');
  });
});
