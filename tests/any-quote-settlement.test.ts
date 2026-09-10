import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, parseAbi, type Address } from "viem";
import { anyQuotePoolIdV1, buildAnyQuoteSettlementProbeV1 } from "@/lib/module-engine/any-quote/route";
import { ANY_QUOTE_INFRASTRUCTURE, ANY_QUOTE_NATIVE, ANY_QUOTE_WETH, type AnyQuoteExternalRouteV1 } from "@/lib/module-engine/any-quote/types";
import { verifyAnyQuoteLaunchSettlementV1, verifyAnyQuoteSettlementTraceV1 } from "@/lib/server/module-engine/any-quote-settlement";
import { tradeTraceV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";
import { settlementRpcFixture } from "./any-quote-settlement-fixture";
vi.mock("server-only", () => ({}));
const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const owner = address(101), quote = address(102), treasury = address(103), creator = address(104), ledger = address(105);
const key = { currency0: ANY_QUOTE_NATIVE, currency1: quote, fee: 3000, tickSpacing: 60, hooks: ANY_QUOTE_NATIVE };
const route: AnyQuoteExternalRouteV1 = { provider: "uniswap-v4-initialize", chainId: 4663, tokenIn: ANY_QUOTE_WETH, tokenOut: quote,
  amountIn: "1000", amountOut: "2000", validUntil: "140", checkpoint: { number: "100", timestamp: "100", hash: `0x${"11".repeat(32)}` }, evidenceHash: `0x${"22".repeat(32)}`,
  hops: [{ protocol: "V4", tokenIn: ANY_QUOTE_NATIVE, tokenOut: quote, key, poolId: anyQuotePoolIdV1(key), hookData: "0x" }] };
const input = { account: owner, ledger, creatorWallets: [creator], buyCreatorFeeBps: 100, sellCreatorFeeBps: 0, externalRoute: route, deadline: 140n, now: 100n };
const probe = () => buildAnyQuoteSettlementProbeV1({ owner, recipient: treasury, externalRoute: route, deadline: 140n, now: 100n });
describe("Any Quote launch settlement admission", () => {
  it("emits only a simulation probe with four balance reads around exact native settlement", () => {
    const built = probe(), decoded = decodeFunctionData({ abi: parseAbi(["function execute(bytes,bytes[],uint256) payable"]), data: built.transaction.data });
    expect(decoded.args[0]).toBe("0x0e0e100e0e"); expect(built.simulationOnly).toBe(true);
    expect(built).not.toHaveProperty("nativeBuyOperationData"); expect(built).not.toHaveProperty("balanceAccounting");
    const f = settlementRpcFixture(route, treasury);
    expect(verifyAnyQuoteSettlementTraceV1(built, tradeTraceV1(f.trace(built)))).toMatchObject({ amount: "2000", managerDebit: "2000", recipientCredit: "2000" });
  });
  it.each(["recipient", "manager"])("rejects a successful clean transfer with an inexact %s balance effect", side => {
    const f = settlementRpcFixture(route, treasury);
    if (side === "recipient") f.state.recipientAdjustment = -1n; else f.state.managerAdjustment = -1n;
    expect(() => verifyAnyQuoteSettlementTraceV1(probe(), tradeTraceV1(f.trace(probe())))).toThrowError(expect.objectContaining({ code: "QUOTE_SETTLEMENT_AMOUNT_MISMATCH", status: "incompatible" }));
  });
  it("preserves inconclusive for reverts, extra hook quote movements and invalid ordered balance reads", () => {
    const f = settlementRpcFixture(route, treasury); f.state.failed = true;
    expect(() => verifyAnyQuoteSettlementTraceV1(probe(), tradeTraceV1(f.trace(probe())))).toThrowError(expect.objectContaining({ status: "inconclusive" }));
    f.state.failed = false; f.state.extraQuoteMovement = true; f.state.managerAdjustment = 20n;
    expect(() => verifyAnyQuoteSettlementTraceV1(probe(), tradeTraceV1(f.trace(probe())))).toThrowError(expect.objectContaining({ code: "QUOTE_SETTLEMENT_EXTRA_ASSET_MOVEMENT", status: "inconclusive" }));
    f.state.extraQuoteMovement = false; f.state.managerAdjustment = 0n;
    const original = tradeTraceV1(f.trace(probe()));
    const changed = { ...original, calls: [original.calls[1], original.calls[0], ...original.calls.slice(2)] };
    expect(() => verifyAnyQuoteSettlementTraceV1(probe(), changed)).toThrowError(expect.objectContaining({ status: "inconclusive" }));
    const spoofed = tradeTraceV1(f.trace(probe())); spoofed.calls[0].from = quote;
    expect(() => verifyAnyQuoteSettlementTraceV1(probe(), spoofed)).toThrowError(expect.objectContaining({ status: "inconclusive" }));
  });
  it("uses both providers, actual current treasury and all fee recipients without funding overrides", async () => {
    const f = settlementRpcFixture(route, treasury);
    expect(await verifyAnyQuoteLaunchSettlementV1({ ...input, creatorWallets: [creator, treasury], rpcs: f.rpcs })).toMatch(/^0x[0-9a-f]{64}$/);
    const traces = f.calls.filter(c => c.method === "debug_traceCall"); expect(traces).toHaveLength(4);
    for (const call of traces) {
      expect(call.params).toHaveLength(3); expect(call.params[2]).toEqual({ tracer: "callTracer", timeout: "10s" });
      expect(call.params[0]).toMatchObject({ from: owner, to: ANY_QUOTE_INFRASTRUCTURE.universalRouter });
    }
    const zeroFees = settlementRpcFixture(route, treasury);
    await verifyAnyQuoteLaunchSettlementV1({ ...input, buyCreatorFeeBps: 0, rpcs: zeroFees.rpcs });
    expect(zeroFees.calls.filter(c => c.method === "debug_traceCall")).toHaveLength(2);
  });
  it("does not create funding or diagnose a reorg/provider failure as token incompatibility", async () => {
    const f = settlementRpcFixture(route, treasury); f.state.balance = 999n;
    await expect(verifyAnyQuoteLaunchSettlementV1({ ...input, rpcs: f.rpcs })).rejects.toMatchObject({ code: "QUOTE_SETTLEMENT_PROBE_UNFUNDED", status: "inconclusive" });
    expect(f.calls.some(c => c.method === "debug_traceCall")).toBe(false);
    const stale = settlementRpcFixture(route, treasury); stale.state.staleCheckpoint = true; stale.state.recipientAdjustment = -1n;
    await expect(verifyAnyQuoteLaunchSettlementV1({ ...input, rpcs: stale.rpcs })).rejects.toMatchObject({ status: "inconclusive" });
    const failed = async () => { throw Error("private provider detail"); };
    await expect(verifyAnyQuoteLaunchSettlementV1({ ...input, rpcs: [failed, failed] })).rejects.toMatchObject({ code: "QUOTE_SETTLEMENT_EXECUTION_INCONCLUSIVE", status: "inconclusive" });
  });
});
