import "server-only";
import { decodeFunctionData, decodeFunctionResult, encodeFunctionData, erc20Abi, parseAbi, toHex, type Address, type Hex } from "viem";
import { anyQuoteEvidenceHashV1, buildAnyQuoteSettlementProbeV1 } from "@/lib/module-engine/any-quote/route";
import { ANY_QUOTE_INFRASTRUCTURE as INFRA, AnyQuoteErrorV1, anyQuoteAddressV1, anyQuoteSameAddressV1, type AnyQuoteExternalRouteV1 } from "@/lib/module-engine/any-quote/types";
import { agreedTradeRpcV1, successfulTradeFramesV1, tradeTraceV1, type TradeRpcV1, type TradeTraceV1 } from "../custom-launch/routed-trade-rpc-v1";

const managerAbi = parseAbi(["function unlock(bytes) returns (bytes)", "function take(address,address,uint256)"]);
const treasuryAbi = parseAbi(["function treasury() view returns (address)"]);
type Probe = ReturnType<typeof buildAnyQuoteSettlementProbeV1>;
const pending = (code = "QUOTE_SETTLEMENT_EXECUTION_INCONCLUSIVE"): never => { throw new AnyQuoteErrorV1(code); };
const quantity = (value: unknown) => typeof value === "string" && /^0x[0-9a-f]{1,64}$/i.test(value) ? BigInt(value).toString() : pending();
const same = (a: string | null, b: string) => a !== null && anyQuoteSameAddressV1(a, b);

/** Four direct balance reads are emitted by our five fixed UR commands. Nested token/proxy
 * calls cannot impersonate them. A transfer mismatch is definitive only when no other quote
 * mutation occurred; hooks that move quote during the swap remain inconclusive. */
export function verifyAnyQuoteSettlementTraceV1(probe: Probe, trace: TradeTraceV1) {
  const tx = probe.transaction;
  if (trace.failed || trace.type !== "CALL" || !same(trace.from, tx.from) || !same(trace.to, tx.to)
    || trace.input !== tx.data.toLowerCase() || BigInt(trace.value) !== probe.amountIn || trace.output !== "0x"
    || trace.calls.length !== 5) return pending();
  const readBalance = (frame: TradeTraceV1, owner: Address): bigint => {
    if (frame.failed || frame.type !== "STATICCALL" || !same(frame.from, tx.to) || !same(frame.to, probe.asset)
      || !/^0x[0-9a-f]{64}$/.test(frame.output)) return pending();
    try {
      const decoded = decodeFunctionData({ abi: erc20Abi, data: frame.input });
      if (decoded.functionName !== "balanceOf" || !same(decoded.args[0], owner)) return pending();
      return BigInt(frame.output);
    } catch { return pending(); }
  };
  const beforeRecipient = readBalance(trace.calls[0], probe.recipient), beforeManager = readBalance(trace.calls[1], INFRA.poolManager);
  const afterRecipient = readBalance(trace.calls[3], probe.recipient), afterManager = readBalance(trace.calls[4], INFRA.poolManager);
  const unlock = trace.calls[2];
  if (unlock.failed || unlock.type !== "CALL" || !same(unlock.from, tx.to) || !same(unlock.to, INFRA.poolManager)) return pending();
  try {
    const decoded = decodeFunctionData({ abi: managerAbi, data: unlock.input });
    if (decoded.functionName !== "unlock" || decoded.args[0] !== probe.unlockData) return pending();
  } catch { return pending(); }
  const frames = successfulTradeFramesV1(unlock);
  const mutations = frames.filter(frame => same(frame.to, probe.asset) && frame.type !== "STATICCALL" && frame.type !== "DELEGATECALL");
  // A proxy's delegatecall is part of this same token transfer, not another token movement.
  if (mutations.length !== 1) return pending("QUOTE_SETTLEMENT_EXTRA_ASSET_MOVEMENT");
  const transfer = mutations[0];
  if (transfer.type !== "CALL" || !same(transfer.from, INFRA.poolManager)) return pending();
  let nominal: bigint;
  try {
    const decoded = decodeFunctionData({ abi: erc20Abi, data: transfer.input });
    if (decoded.functionName !== "transfer" || !same(decoded.args[0], probe.recipient)
      || (transfer.output !== "0x" && decodeFunctionResult({ abi: erc20Abi, functionName: "transfer", data: transfer.output }) !== true)) return pending();
    nominal = decoded.args[1];
  } catch { return pending(); }
  const takes = frames.filter(frame => frame.type === "CALL" && same(frame.from, tx.to) && same(frame.to, INFRA.poolManager)).flatMap(frame => {
    try { const decoded = decodeFunctionData({ abi: managerAbi, data: frame.input }); return decoded.functionName === "take" && same(decoded.args[0], probe.asset) ? [{ frame, args: decoded.args }] : []; } catch { return []; }
  });
  if (takes.length !== 1 || !same(takes[0].args[1], probe.recipient) || takes[0].args[2] !== nominal
    || !takes[0].frame.calls.includes(transfer) || nominal !== probe.amountOut || nominal <= 0n) return pending("QUOTE_SETTLEMENT_QUOTE_MISMATCH");
  if (afterRecipient < beforeRecipient || afterRecipient - beforeRecipient !== nominal
    || afterManager > beforeManager || beforeManager - afterManager !== nominal) {
    throw new AnyQuoteErrorV1("QUOTE_SETTLEMENT_AMOUNT_MISMATCH", "incompatible");
  }
  return { recipient: probe.recipient, amount: nominal.toString(), managerDebit: (beforeManager - afterManager).toString(), recipientCredit: (afterRecipient - beforeRecipient).toString() };
}

/** Admission-only probe; no transaction, output estimate or synthetic funding is returned to the
 * client. Each recipient is simulated independently against the same unchanged checkpoint. */
export async function verifyAnyQuoteLaunchSettlementV1(input: {
  account: Address; ledger: Address; creatorWallets: readonly Address[]; buyCreatorFeeBps: number; sellCreatorFeeBps: number;
  externalRoute: AnyQuoteExternalRouteV1; deadline: bigint; now: bigint; rpcs: readonly [TradeRpcV1, TradeRpcV1];
}) {
  try {
    const route = input.externalRoute, ref = { blockHash: route.checkpoint.hash, requireCanonical: true }, rpc = agreedTradeRpcV1(input.rpcs);
    const [balanceText, treasury] = await Promise.all([
      rpc("eth_getBalance", [input.account, ref], quantity),
      rpc("eth_call", [{ to: input.ledger, data: encodeFunctionData({ abi: treasuryAbi, functionName: "treasury" }) }, ref], value => {
        try { return anyQuoteAddressV1(decodeFunctionResult({ abi: treasuryAbi, functionName: "treasury", data: String(value) as Hex })); } catch { return pending(); }
      }),
    ]);
    if (BigInt(balanceText) < BigInt(route.amountIn)) return pending("QUOTE_SETTLEMENT_PROBE_UNFUNDED");
    const recipients = [...new Set([treasury, ...(input.buyCreatorFeeBps > 0 || input.sellCreatorFeeBps > 0 ? input.creatorWallets : [])].map(address => address.toLowerCase()))] as Address[];
    if (recipients.length > 11) return pending();
    const verified = [];
    const canonical = () => rpc("eth_getBlockByNumber", [toHex(BigInt(route.checkpoint.number)), false], value => {
      if (!value || typeof value !== "object" || !("hash" in value) || value.hash !== route.checkpoint.hash) return pending("QUOTE_SETTLEMENT_CHECKPOINT_CHANGED");
      return route.checkpoint.hash;
    });
    for (const recipient of recipients) {
      const probe = buildAnyQuoteSettlementProbeV1({ owner: input.account, recipient, externalRoute: route, deadline: input.deadline, now: input.now });
      const transaction = { ...probe.transaction, value: toHex(probe.amountIn) };
      // Bind execution itself to A: a numbered trace can execute at B even if the subsequent
      // canonical read returns A again. Providers without hash-reference support stay inconclusive.
      const trace = await rpc("debug_traceCall", [transaction, ref, { tracer: "callTracer", timeout: "10s" }], tradeTraceV1);
      await canonical();
      verified.push(verifyAnyQuoteSettlementTraceV1(probe, trace));
    }
    return anyQuoteEvidenceHashV1({ policy: "programmable.any-quote.settlement-probe.v1", account: input.account, ledger: input.ledger,
      route: route.evidenceHash, checkpoint: route.checkpoint, verified });
  } catch (error) {
    if (error instanceof AnyQuoteErrorV1 && error.code === "QUOTE_SETTLEMENT_AMOUNT_MISMATCH") throw error;
    if (error instanceof AnyQuoteErrorV1 && error.status === "inconclusive") throw error;
    return pending();
  }
}
