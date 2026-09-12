import { describe, expect, it } from "vitest";
import { agreedTradeRpcV1, productionTradeRpcsV1, TradeRpcExecutionRevertedV1, type TradeRpcV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";

const environment = {
  ROBINHOOD_V4_RPC_PRIMARY_URL: `https://lb.drpc.live/robinhood/${"fixture".repeat(4)}`,
  ROBINHOOD_V4_RPC_SECONDARY_URL: `https://robinhood-mainnet.g.alchemy.com/v2/${"fixture".repeat(4)}`,
};
const response = (error: unknown): typeof fetch => async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error }));
const revert = (data: `0x${string}`): TradeRpcV1 => async () => { throw new TradeRpcExecutionRevertedV1(data); };
const success: TradeRpcV1 = async () => "0x01";
const outage: TradeRpcV1 = async () => { throw Error("provider unavailable"); };

describe("Any Quote opt-in execution-revert evidence", () => {
  it("retains bounded EVM revert bytes while removing provider messages", async () => {
    const rpc = productionTradeRpcsV1(environment, response({ code: 3, message: "execution reverted: private provider text", data: "0xABCD" }))[0];
    await expect(rpc("eth_call", [])).rejects.toMatchObject({ code: "TRADE_EXECUTION_REVERTED", data: "0xabcd", message: "The simulated call reverted." });
    await expect(rpc("eth_getLogs", [])).rejects.toMatchObject({ code: "TRADE_ANALYSIS_PENDING" });
  });
  it("does not turn malformed, oversized or provider errors into execution evidence", async () => {
    for (const error of [
      { code: 3, message: "rate limited", data: "0xabcd" },
      { code: -32000, message: "execution reverted", data: "0xabcd" },
      { code: 3, message: "execution reverted", data: "not bytes" },
      { code: 3, message: "execution reverted", data: `0x${"ab".repeat(32_769)}` },
    ]) await expect(productionTradeRpcsV1(environment, response(error))[0]("eth_call", [])).rejects.toMatchObject({ code: "TRADE_ANALYSIS_PENDING" });
  });
  it("rejects a malformed envelope containing both a result and an error", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x01",
      error: { code: 3, message: "execution reverted", data: "0xabcd" } }));
    await expect(productionTradeRpcsV1(environment, fetcher)[0]("eth_call", [])).rejects.toMatchObject({ code: "TRADE_ANALYSIS_PENDING" });
  });
  it("keeps default provider agreement behavior unchanged", async () => {
    await expect(agreedTradeRpcV1([revert("0x12"), revert("0x12")])("eth_call", [], String)).rejects.toMatchObject({ code: "TRADE_ANALYSIS_PENDING" });
  });
  it("only confirms identical independent revert results when requested", async () => {
    await expect(agreedTradeRpcV1([revert("0x12"), revert("0x12")], { preserveExecutionReverts: true })("eth_call", [], String))
      .rejects.toMatchObject({ code: "TRADE_EXECUTION_REVERTED", data: "0x12" });
    for (const pair of [[revert("0x12"), revert("0x34")], [revert("0x12"), success], [success, revert("0x12")]] as const)
      await expect(agreedTradeRpcV1(pair, { preserveExecutionReverts: true })("eth_call", [], String)).rejects.toMatchObject({ code: "TRADE_PROVIDER_DISAGREEMENT" });
    await expect(agreedTradeRpcV1([revert("0x12"), outage], { preserveExecutionReverts: true })("eth_call", [], String))
      .rejects.toMatchObject({ code: "TRADE_ANALYSIS_PENDING" });
  });
});
