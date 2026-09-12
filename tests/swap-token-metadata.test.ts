import { describe, expect, it, vi } from "vitest";
import { toHex } from "viem";
import { readRobinhoodSwapDecimals } from "@/lib/server/swap/token-metadata";
import type { TradeRpcV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";

vi.mock("server-only", () => ({}));
const token = `0x${"12".repeat(20)}`;
const block = { number: "0x64", hash: `0x${"34".repeat(32)}`, timestamp: "0x100" };
function provider(decimals: number, chain = "0x1237") {
  return vi.fn(async (method: string) => {
    if (method === "eth_chainId") return chain;
    if (method === "eth_getBlockByNumber") return block;
    if (method === "eth_call") return toHex(decimals, { size: 32 });
    throw new Error("Unexpected RPC method");
  }) as unknown as TradeRpcV1;
}

describe("projected swap token units", () => {
  it("reads actual token decimals at the same canonical block on both providers", async () => {
    const a = provider(6), b = provider(6);
    expect(await readRobinhoodSwapDecimals(token, [a, b])).toBe(6);
    for (const rpc of [a, b]) expect(rpc).toHaveBeenCalledWith("eth_call", [
      { to: token, data: "0x313ce567" }, { blockHash: block.hash, requireCanonical: true },
    ]);
  });
  it("rejects providers that disagree about token units", async () => {
    await expect(readRobinhoodSwapDecimals(token, [provider(6), provider(18)])).rejects.toThrow();
  });
  it("rejects a response from another network", async () => {
    await expect(readRobinhoodSwapDecimals(token, [provider(18, "0x1"), provider(18, "0x1")])).rejects.toMatchObject({ code: "TOKEN_METADATA_UNAVAILABLE" });
  });
  it("rejects units outside the swap input range", async () => {
    await expect(readRobinhoodSwapDecimals(token, [provider(255), provider(255)])).rejects.toMatchObject({ code: "TOKEN_METADATA_UNAVAILABLE" });
  });
});
