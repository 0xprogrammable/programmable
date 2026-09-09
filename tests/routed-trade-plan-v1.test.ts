import { describe, expect, it, vi } from "vitest";
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, toHex, type Hex } from "viem";
vi.mock("server-only", () => ({}));
vi.mock("@/contracts/spec/robinhood-custom-launch/chain-4663.v1.json", async importOriginal => {
  const original = await importOriginal<{ default: { contracts: { uniswap: Record<string, { runtimeCodeHash?: string }> } } }>();
  const value = structuredClone(original.default);
  const { keccak256 } = await import("viem");
  for (const entry of Object.values(value.contracts.uniswap)) if (entry.runtimeCodeHash) entry.runtimeCodeHash = keccak256("0x6001600055");
  return { default: value };
});
import { projectionFixture, controller, component, runtime, runtimeHash, hash, now, nowIso } from "./fixtures/universal-launch-v1";
import { buildLaunchPlanRoutedSwapV1, launchPlanTradeAmountsV1, launchPlanTradeBindingV1, launchPlanTradePreparationDigestV1,
  parseLaunchPlanTradeRequestV1, ROUTED_FEE_RECIPIENT_V1, ROUTED_TRADE_CONTRACTS_V1, ROUTED_TRADE_REQUEST_V1, ROUTED_TRADE_ROUTER_ABI_V1,
  ROUTED_TRADE_TOKEN_ABI_V1, validateLaunchPlanTradePreparationV1, type LaunchPlanTradeRequestV1 } from "@/lib/custom-launch/routed-trade-plan-v1";
import { prepareLaunchPlanTradeV1 } from "@/lib/server/custom-launch/routed-trade-plan-v1";
import { productionTradeRpcsV1, tradePostStateV1, type TradeRpcV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";
import { prepareLaunchPlanTradeWalletV1 } from "@/lib/custom-launch/routed-trade-wallet-v1";
import sdkVector from "@/contracts/spec/routed-trade-fee-vnext-vector.json";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const TAKE = parseAbi(["function take(address,address,uint256)"]);
function projection() {
  const original = projectionFixture();
  return { ...original, markets: [{ marketId: "unfamiliar-curve", kind: "uniswap_v4" as const,
    poolManager: ROUTED_TRADE_CONTRACTS_V1.poolManager.address as Hex, currency0: { address: ZERO }, currency1: { componentId: "settlement" },
    hooks: { address: ZERO }, fee: 3000, tickSpacing: 60 }], assuranceClaims: [{ claimType: "fee_on_programmable_routed_trades", subject: "route-fee",
    observedValue: { obligationId: "route-fee", mode: "programmable_routed", policyVersion: "programmable.custom-launch-fee.v1", rateBps: 20,
      scope: "programmable_built_or_routed_qualifying_swaps", recipient: ROUTED_FEE_RECIPIENT_V1, marketIds: ["unfamiliar-curve"] },
    status: "disclosed" as const, witness: { kind: "policy" as const, ref: "fixture:fee", details: {} }, assessor: "fixture", assessorVersion: "1", validAt: nowIso, blockNumber: "42" }] };
}
function request(): LaunchPlanTradeRequestV1 {
  return parseLaunchPlanTradeRequestV1({ schemaVersion: ROUTED_TRADE_REQUEST_V1, chainId: "4663", launchId: projection().launchId,
    planHash: projection().planHash, marketId: "unfamiliar-curve", owner: controller, zeroForOne: true, amountIn: "100000", slippageBps: 50,
    deadline: (now + 600n).toString(), hookData: "0x01020304" });
}
function fixtureRpc(options: { revert?: boolean; missingFee?: boolean; underpaid?: boolean; overspent?: boolean; contractWallet?: boolean } = {}): TradeRpcV1 {
  return vi.fn(async (method, params) => {
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_getBlockByNumber") return { number: "0x2a", hash, timestamp: toHex(now) };
    if (method === "eth_getCode") return String(params[0]).toLowerCase() === controller && !options.contractWallet ? "0x" : runtime;
    if (method === "eth_estimateGas") return "0x186a0";
    if (method === "eth_getBalance") return "0x100000000000000000";
    const tx = params[0] as { from: string; to: string; data: Hex; value: Hex };
    if (method === "eth_call") {
      if (tx.to.toLowerCase() === ROUTED_TRADE_CONTRACTS_V1.v4Quoter.address.toLowerCase()) return encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [50001n, 100000n]);
      if (tx.to.toLowerCase() === ROUTED_TRADE_CONTRACTS_V1.universalRouter.address.toLowerCase()) return "0x";
      const decoded = decodeFunctionData({ abi: ROUTED_TRADE_TOKEN_ABI_V1, data: tx.data });
      if (decoded.functionName === "decimals") return toHex(18n, { size: 32 });
      if (decoded.functionName === "balanceOf") {
        const owner = String(decoded.args[0]).toLowerCase() === controller;
        return toHex(owner ? params[2] ? 149901n : 100000n : params[2] ? options.underpaid ? 99n : 100n : 0n, { size: 32 });
      }
    }
    if (method === "debug_traceCall") {
      const config = params[2] as { tracer: string };
      if (config.tracer === "prestateTracer") return { pre: { [component]: { storage: { [hash]: toHex(0n, { size: 32 }) } }, [controller]: { balance: "0x100000000000000000" } },
        post: { [component]: { storage: { [hash]: toHex(1n, { size: 32 }) } }, [controller]: { balance: toHex(BigInt("0x100000000000000000") - (options.overspent ? 100001n : 100000n)) } } };
      const take = (recipient: string, amount: bigint) => ({ type: "CALL", from: ROUTED_TRADE_CONTRACTS_V1.universalRouter.address,
        to: ROUTED_TRADE_CONTRACTS_V1.poolManager.address, value: "0x0", gasUsed: "0x2710",
        input: encodeFunctionData({ abi: TAKE, functionName: "take", args: [component, recipient as Hex, amount] }), output: "0x" });
      return { type: "CALL", from: tx.from, to: tx.to, input: tx.data, value: tx.value, output: "0x", gasUsed: "0x186a0",
        ...(options.revert ? { error: "execution reverted" } : {}), calls: [...(options.missingFee ? [] : [take(ROUTED_FEE_RECIPIENT_V1, 100n)]), take(controller, 49901n)] };
    }
    throw new Error(`Unexpected fixture method ${method}`);
  });
}
const prepared = async (options: Parameters<typeof fixtureRpc>[0] = {}) => prepareLaunchPlanTradeV1(request(), {
  loadProjection: async () => projection(), rpcs: [fixtureRpc(options), fixtureRpc(options)], now: () => now });

describe("generic vNext routed swap", () => {
  it("collects the exact output-credit floor fee before the trader take in the canonical SDK transaction", () => {
    const tx = buildLaunchPlanRoutedSwapV1(projection(), request(), 50001n);
    expect(tx.data).toBe(sdkVector.buy.transactionData);
    expect(buildLaunchPlanRoutedSwapV1(projection(), { ...request(), zeroForOne: false }, 50001n).data).toBe(sdkVector.sell.transactionData);
    const decoded = decodeFunctionData({ abi: ROUTED_TRADE_ROUTER_ABI_V1, data: tx.data });
    expect(decoded.args[0]).toBe("0x1004"); // V4_SWAP, exact native refund SWEEP; no allow-revert bits.
    const [actions, params] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], decoded.args[1][0]!);
    expect(actions).toBe("0x060c100f");
    expect(decodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], params[2]!))
      .toEqual([component, ROUTED_FEE_RECIPIENT_V1, 20n]);
    expect(launchPlanTradeAmountsV1(50001n, 20, 50)).toMatchObject({ platformFeeAmount: "100", amountOut: "49901", amountOutMinimum: "49651" });
    expect(tx.value).toBe(request().amountIn);
  });
  it("keeps floor rounding at zero for dust and never claims a launch charge or no-market swap", async () => {
    expect(launchPlanTradeAmountsV1(499n, 20, 50).platformFeeAmount).toBe("0");
    const rpc = fixtureRpc();
    await expect(prepareLaunchPlanTradeV1(request(), { loadProjection: async () => projectionFixture(), rpcs: [rpc, rpc], now: () => now })).rejects.toMatchObject({ code: "NO_QUALIFYING_SWAP_FLOW" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not grant pool enforcement from a verified getter or a forged all-routes label", () => {
    const value = projection();
    value.assuranceClaims[0] = { ...value.assuranceClaims[0]!, claimType: "fee_on_proven_pool_paths", status: "verified" as never,
      observedValue: { ...value.assuranceClaims[0]!.observedValue, mode: "pool_enforced", scope: "proven_pool_paths" } };
    expect(launchPlanTradeBindingV1(value, request()).fee).toMatchObject({ mode: "programmable_routed", routedRateBps: 20 });
    value.assuranceClaims[0]!.observedValue.scope = "all_routes";
    expect(() => launchPlanTradeBindingV1(value, request())).toThrow(/policy/);
  });
  it("requires exact dual-provider runtime, trace and actual recipient credit before ready", async () => {
    const value = await prepared();
    expect(value).toMatchObject({ status: "ready", evidence: { actualWalletAuthorizationVerified: false,
      feeTransfer: { routedFeeAmount: "100", grossOutputCredit: "50001", traderOutputCredit: "49901", recipientBalanceIncrease: "100" } } });
    expect(validateLaunchPlanTradePreparationV1(value, projection(), request(), now)).toEqual(value);
    await expect(prepared({ missingFee: true })).rejects.toMatchObject({ code: "ROUTED_FEE_TRANSFER_UNPROVEN" });
    await expect(prepared({ underpaid: true })).rejects.toMatchObject({ code: "OUTPUT_CREDIT_ADAPTER_PENDING" });
    await expect(prepared({ overspent: true })).rejects.toMatchObject({ code: "INPUT_BUDGET_EFFECT_UNPROVEN" });
  });
  it("distinguishes agreed mechanical revert from disagreement and provider outage", async () => {
    await expect(prepared({ revert: true })).rejects.toMatchObject({ code: "TRADE_EXECUTION_REVERTED", status: 409 });
    await expect(prepareLaunchPlanTradeV1(request(), { loadProjection: async () => projection(), rpcs: [fixtureRpc(), fixtureRpc({ revert: true })], now: () => now }))
      .rejects.toMatchObject({ code: "TRADE_PROVIDER_DISAGREEMENT", status: 503 });
    await expect(prepareLaunchPlanTradeV1(request(), { loadProjection: async () => projection(), rpcs: [fixtureRpc(), async () => { throw new Error("secret provider URL"); }], now: () => now }))
      .rejects.toMatchObject({ code: "TRADE_ANALYSIS_PENDING", status: 503 });
  });
  it("rejects target, data, value, owner and fee substitution even after rehashing the response", async () => {
    const value = await prepared();
    for (const patch of [{ to: component }, { data: "0x12345678" }, { value: "0" }, { from: component }]) {
      const { preparationDigest: _old, ...body } = structuredClone(value); void _old;
      Object.assign(body.transaction, patch);
      expect(() => validateLaunchPlanTradePreparationV1({ ...body, preparationDigest: launchPlanTradePreparationDigestV1(body) }, projection(), request(), now)).toThrow(/differs/);
    }
    const tampered = structuredClone(value) as unknown as { fee: { recipient: string } }; tampered.fee.recipient = component;
    expect(() => validateLaunchPlanTradePreparationV1(tampered, projection(), request(), now)).toThrow();
  });
  it("accepts only independently configured dRPC and Alchemy domains", () => {
    expect(() => productionTradeRpcsV1({ ROBINHOOD_V4_RPC_PRIMARY_URL: "https://drpc.org.attacker.invalid/key", ROBINHOOD_V4_RPC_SECONDARY_URL: "https://rpc.alchemy.com/key" })).toThrow(/adapter/);
    expect(() => productionTradeRpcsV1({ ROBINHOOD_V4_RPC_PRIMARY_URL: "https://lb.drpc.org/key", ROBINHOOD_V4_RPC_SECONDARY_URL: "https://lb.drpc.org/other" })).toThrow();
    const configuration = { ROBINHOOD_V4_RPC_PRIMARY_URL: "https://lb.drpc.live/robinhood/fixturecredentialonly", ROBINHOOD_V4_RPC_SECONDARY_URL: "https://robinhood-mainnet.g.alchemy.com/v2/fixturecredentialonly" };
    const fetcher = vi.fn();
    expect(productionTradeRpcsV1(configuration, fetcher)).toHaveLength(2);
    expect(fetcher).not.toHaveBeenCalled();
    expect(() => productionTradeRpcsV1({ ...configuration, ROBINHOOD_V4_RPC_PRIMARY_TRUST_DOMAIN: "alchemy.com" })).toThrow();
    expect(() => productionTradeRpcsV1({ ...configuration, ROBINHOOD_V4_RPC_PRIMARY_AUTHENTICATION: "public" })).toThrow();
  });
  it("preserves cleared slots and destroyed accounts in poststate readbacks", () => {
    expect(tradePostStateV1({ pre: { [component]: { code: runtime, storage: { [hash]: hash } } }, post: {} }))
      .toEqual({ [component]: { code: "0x", balance: "0x0", nonce: "0x0", stateDiff: { [hash]: toHex(0n, { size: 32 }) } } });
  });
  it("prepares connected contract-wallet inner calls without fabricating an EOA nonce or owner approval", async () => {
    const value = await prepared({ contractWallet: true });
    const date = vi.spyOn(Date, "now").mockReturnValue(Number(now) * 1000);
    const calls: string[] = [];
    try {
      const review = await prepareLaunchPlanTradeWalletV1({ request: async ({ method }) => {
        calls.push(method); if (method === "eth_chainId") return "0x1237"; if (method === "eth_accounts") return [controller];
        if (method === "eth_getCode") return runtime; if (method === "eth_call") return "0x";
        if (method === "eth_estimateGas") return "0x186a0"; if (method === "eth_gasPrice") return "0x1"; if (method === "eth_getBalance") return "0x1000000000000";
        throw new Error(`Unexpected wallet request ${method}`);
      } }, controller, { action: "review", request: request(), projection: projection() }, (async () => Response.json(value)) as typeof fetch);
      expect(review.controllerKind).toBe("connected_contract_wallet"); expect(review.transaction).not.toHaveProperty("nonce");
      expect(calls).not.toContain("eth_getTransactionCount"); expect(calls).not.toContain("eth_sendTransaction");
      expect(review.preparation.evidence.actualWalletAuthorizationVerified).toBe(false);
      expect(keccak256(runtime)).toBe(runtimeHash);
    } finally { date.mockRestore(); }
  });
});
