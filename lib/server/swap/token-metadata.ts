import "server-only";
import { getAddress, toHex } from "viem";
import { agreedTradeRpcV1, bytesV1, productionTradeRpcsV1, quantityV1, tradeBlockV1, type TradeRpcV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";
import { SwapUnavailableError } from "@/lib/swap/types";

/** Older projected launches intentionally omit ERC-20 metadata. Read units
 * from the indexed token itself instead of assuming that it has 18 decimals. */
export async function readRobinhoodSwapDecimals(token: string, rpcs: readonly [TradeRpcV1, TradeRpcV1] = productionTradeRpcsV1()): Promise<number> {
  const rpc = agreedTradeRpcV1(rpcs);
  const [chain, heads] = await Promise.all([
    rpc("eth_chainId", [], value => quantityV1(value).toString()),
    Promise.all(rpcs.map(async read => tradeBlockV1(await read("eth_getBlockByNumber", ["latest", false])))),
  ]);
  if (chain !== "4663") throw new SwapUnavailableError("The token network could not be verified. Try again.", "TOKEN_METADATA_UNAVAILABLE");
  const height = BigInt(heads[0].number) < BigInt(heads[1].number) ? heads[0].number : heads[1].number;
  const block = await rpc("eth_getBlockByNumber", [toHex(BigInt(height)), false], tradeBlockV1);
  const value = await rpc("eth_call", [{ to: getAddress(token), data: "0x313ce567" }, { blockHash: block.hash, requireCanonical: true }], bytesV1);
  if (value.length !== 66 || BigInt(value) > 36n) throw new SwapUnavailableError("The token’s decimals could not be verified. Try again.", "TOKEN_METADATA_UNAVAILABLE");
  return Number(BigInt(value));
}
