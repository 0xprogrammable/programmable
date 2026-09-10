import { decodeAbiParameters, decodeFunctionData, encodeFunctionData, encodeFunctionResult, erc20Abi, parseAbi, parseAbiParameters, toHex, type Address } from "viem";
import { buildAnyQuoteSettlementProbeV1 } from "@/lib/module-engine/any-quote/route";
import { ANY_QUOTE_INFRASTRUCTURE as INFRA, type AnyQuoteExternalRouteV1 } from "@/lib/module-engine/any-quote/types";
import type { TradeRpcV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";
const managerAbi = parseAbi(["function unlock(bytes) returns (bytes)", "function take(address,address,uint256)"]);
const executeAbi = parseAbi(["function execute(bytes,bytes[],uint256) payable"]);
const treasuryAbi = parseAbi(["function treasury() view returns (address)"]);
export function settlementRpcFixture(route: AnyQuoteExternalRouteV1, treasury: Address) {
  const state = { balance: BigInt(route.amountIn) * 10n, recipientAdjustment: 0n, managerAdjustment: 0n, failed: false, extraQuoteMovement: false, staleCheckpoint: false };
  const calls: { provider: number; method: string; params: readonly unknown[] }[] = [];
  const trace = (probe: ReturnType<typeof buildAnyQuoteSettlementProbeV1>) => {
    const frame = (from: Address, to: Address, input: `0x${string}`, output: `0x${string}` = "0x", children: unknown[] = [], type = "CALL") => ({
      type, from, to, input, output, value: "0x0", gasUsed: "0x100", calls: children,
    });
    const balance = (owner: Address, amount: bigint) => frame(INFRA.universalRouter, probe.asset,
      encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [owner] }), toHex(amount, { size: 32 }), [], "STATICCALL");
    const transfer = frame(INFRA.poolManager, probe.asset, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [probe.recipient, probe.amountOut] }), toHex(1n, { size: 32 }));
    const take = frame(INFRA.universalRouter, INFRA.poolManager, encodeFunctionData({ abi: managerAbi, functionName: "take", args: [probe.asset, probe.recipient, probe.amountOut] }), "0x", [transfer]);
    const extra = frame(treasury, probe.asset, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [INFRA.poolManager, 20n] }), toHex(1n, { size: 32 }));
    const unlock = frame(INFRA.universalRouter, INFRA.poolManager, encodeFunctionData({ abi: managerAbi, functionName: "unlock", args: [probe.unlockData] }), "0x", state.extraQuoteMovement ? [extra, take] : [take]);
    return { ...frame(probe.transaction.from, INFRA.universalRouter, probe.transaction.data, "0x", [
      balance(probe.recipient, 9000n), balance(INFRA.poolManager, probe.amountOut * 100n), unlock,
      balance(probe.recipient, 9000n + probe.amountOut + state.recipientAdjustment), balance(INFRA.poolManager, probe.amountOut * 99n + state.managerAdjustment),
    ]), value: toHex(probe.amountIn), ...(state.failed ? { error: "execution reverted" } : {}) };
  };
  const rpcs = [0, 1].map(provider => (async (method, params) => {
    calls.push({ provider, method, params });
    if (method === "eth_getBalance") return toHex(state.balance);
    if (method === "eth_call") return encodeFunctionResult({ abi: treasuryAbi, functionName: "treasury", result: treasury });
    if (method === "eth_getBlockByNumber") return { hash: state.staleCheckpoint ? `0x${"00".repeat(32)}` : route.checkpoint.hash };
    if (method !== "debug_traceCall") throw Error("Unexpected settlement fixture method");
    const tx = params[0] as { from: Address; data: `0x${string}` };
    const decoded = decodeFunctionData({ abi: executeAbi, data: tx.data });
    const recipient = decodeAbiParameters(parseAbiParameters("address,address,uint256"), decoded.args[1][0])[0];
    return trace(buildAnyQuoteSettlementProbeV1({ owner: tx.from, recipient, externalRoute: route, deadline: decoded.args[2], now: BigInt(route.checkpoint.timestamp) }));
  }) satisfies TradeRpcV1) as unknown as readonly [TradeRpcV1, TradeRpcV1];
  return { state, calls, trace, rpcs };
}
