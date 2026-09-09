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
import sdkVector from "@/contracts/spec/routed-trade-fee-vnext-vector-v211.json";
import feeVectors from "@/contracts/spec/immutable-pool-fee-runtime-vectors-v1.json";
import { rebuildImmutablePoolFeeRuntimeProofV1, materializeImmutableFeeRuntimeWordsV1,
  type ImmutablePoolFeeRuntimeProofV1 } from "@/lib/custom-launch/immutable-pool-fee-runtime-custom-launch-plan-v1";
import { IMMUTABLE_POOL_FEE_RECIPES_V1 as feeRecipes } from "@/lib/custom-launch/immutable-pool-fee-recipes-custom-launch-plan-v1";
import type { LaunchProjectionV1 } from "@/lib/custom-launch/launch-plan-v1";

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

function immutablePoolFixture(index = 0, options: { unbacked?: boolean; wrongAccrual?: boolean; missingRecord?: boolean; missingVault?: boolean; sell?: boolean } = {}) {
  const vector = feeVectors.proofs[index]! as unknown as ImmutablePoolFeeRuntimeProofV1;
  const proof = rebuildImmutablePoolFeeRuntimeProofV1(vector, vector.market), recipes = feeRecipes[proof.recipeId];
  const tradeRequest = { ...request(), zeroForOne: !options.sell };
  const creatorAmount = proof.recipeId === "native_fee_kernel_v1" ? options.sell ? 250n : 150n : 0n;
  const quoteAmount = options.sell ? proof.recipeId === "blob_fee_controller_v2" ? 84800n : 99800n - creatorAmount : 50001n;
  const codes = Object.fromEntries(proof.runtimeBindings.filter(b => b.role !== "module").map(binding => [binding.address.toLowerCase(),
    materializeImmutableFeeRuntimeWordsV1((binding.role === "controller" && "controller" in recipes ? recipes.controller
      : binding.role === "hook" ? recipes.hook : recipes.vault), binding.immutableWords!)]));
  const value: LaunchProjectionV1 = { ...projection(), components: [...projection().components,
    ...proof.runtimeBindings.map(binding => ({ componentId: `fee-${binding.role}`, artifactId: `fee-source-${binding.role}`,
      expectedAddress: binding.address, runtimeCodeHash: binding.runtimeCodeHash }))], markets: [{ marketId: request().marketId, kind: "uniswap_v4",
        poolManager: proof.market.poolManager, currency0: { address: proof.market.currency0 }, currency1: { address: proof.market.currency1 },
        hooks: { address: proof.market.hooks }, fee: proof.market.fee, tickSpacing: proof.market.tickSpacing }] };
  const CALLBACK = parseAbi(["function beforeSwap(address,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),(bool zeroForOne,int256 amountSpecified,uint160 sqrtPriceLimitX96),bytes)",
    "function afterSwap(address,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),(bool zeroForOne,int256 amountSpecified,uint160 sqrtPriceLimitX96),int256,bytes)"]);
  const LEDGER = parseAbi(["function platformAccrued() view returns(uint256)", "function creatorAccrued() view returns(uint256)", "function balanceOf(address,uint256) view returns(uint256)", "function recordFees(uint256,uint256)"]);
  const key = { currency0: proof.market.currency0, currency1: proof.market.currency1, fee: proof.market.fee, tickSpacing: proof.market.tickSpacing, hooks: proof.market.hooks };
  const parameters = {zeroForOne:tradeRequest.zeroForOne,amountSpecified:-100000n,sqrtPriceLimitX96:4295128740n};
  const base = fixtureRpc();
  const rpc: TradeRpcV1 = async (method, params) => {
    if (method === "eth_getCode") {
      const address=String(params[0]).toLowerCase();
      return options.missingVault && address===proof.feeVault.toLowerCase()?"0x":codes[address]??base(method,params);
    }
    const tx=params[0] as {from:string;to:string;data:Hex;value:Hex};
    if (method === "eth_call" && tx.to.toLowerCase() === ROUTED_TRADE_CONTRACTS_V1.v4Quoter.address.toLowerCase()) return encodeAbiParameters([{type:"uint256"},{type:"uint256"}],[quoteAmount,100000n]);
    if (method === "eth_call" && tx.to.toLowerCase() === ROUTED_TRADE_CONTRACTS_V1.permit2.address.toLowerCase()) return encodeAbiParameters([{type:"uint160"},{type:"uint48"},{type:"uint48"}],[100000n,Number(BigInt(tradeRequest.deadline)),0]);
    if (method === "eth_call" && [proof.feeVault.toLowerCase(),proof.market.poolManager.toLowerCase()].includes(tx.to.toLowerCase())) {
      const name=decodeFunctionData({abi:LEDGER,data:tx.data}).functionName,post=!!params[2];
      return toHex(name==="platformAccrued"?1000n+(post?(options.wrongAccrual?199n:200n):0n)
        :name==="creatorAccrued"?500n+(post?creatorAmount:0n):1500n+(post?(options.unbacked?199n:200n)+creatorAmount:0n),{size:32});
    }
    if(method==="eth_call" && tx.to.toLowerCase()===proof.market.currency1.toLowerCase()){
      const decoded=decodeFunctionData({abi:ROUTED_TRADE_TOKEN_ABI_V1,data:tx.data});
      if(decoded.functionName==="balanceOf")return toHex(String(decoded.args[0]).toLowerCase()===controller?params[2]?options.sell?0n:150001n:100000n:0n,{size:32});
      if(decoded.functionName==="allowance")return toHex(100000n,{size:32});
      if(decoded.functionName==="decimals")return toHex(18n,{size:32});
    }
    if(method==="debug_traceCall" && (params[2] as {tracer:string}).tracer==="prestateTracer" && options.sell) return {pre:{[controller]:{balance:"0x100000000000000000"}},post:{[controller]:{balance:toHex(BigInt("0x100000000000000000")+quoteAmount)}}};
    if(method==="debug_traceCall" && (params[2] as {tracer:string}).tracer==="callTracer"){
      const frame=(from:string,to:string,input:Hex)=>({type:"CALL",from,to,input,output:"0x",value:"0x0",gasUsed:"0x2710"});
      return {type:"CALL",from:tx.from,to:tx.to,input:tx.data,value:tx.value,output:"0x",gasUsed:"0x186a0",calls:[
        frame(proof.market.poolManager,proof.market.hooks,encodeFunctionData({abi:CALLBACK,functionName:"beforeSwap",args:[ROUTED_TRADE_CONTRACTS_V1.universalRouter.address as Hex,key,parameters,tradeRequest.hookData]})),
        frame(proof.market.poolManager,proof.market.hooks,encodeFunctionData({abi:CALLBACK,functionName:"afterSwap",args:[ROUTED_TRADE_CONTRACTS_V1.universalRouter.address as Hex,key,parameters,options.sell?(100000n<<128n)+(1n<<128n)-100000n:((-99800n-creatorAmount)<<128n)+quoteAmount,tradeRequest.hookData]})),
        ...(options.missingRecord?[]:[frame(proof.feeRecorder,proof.feeVault,encodeFunctionData({abi:LEDGER,functionName:"recordFees",args:[200n,creatorAmount]}))]),
        frame(ROUTED_TRADE_CONTRACTS_V1.universalRouter.address,proof.market.poolManager,encodeFunctionData({abi:TAKE,functionName:"take",args:[options.sell?ZERO:proof.market.currency1,controller,quoteAmount]})),
      ]};
    }
    return base(method,params);
  };
  return {proof,codes,projection:value,rpc,request:tradeRequest,prepare:()=>prepareLaunchPlanTradeV1(tradeRequest,{loadProjection:async()=>value,rpcs:[rpc,rpc],now:()=>now})};
}

describe("generic vNext routed swap", () => {
  it("reuses each exact immutable native20 path without an additional output fee and verifies actual backed accrual", async()=>{
    for(let index=0;index<feeVectors.proofs.length;index++) for(const sell of [false,true]){
      const fixture=immutablePoolFixture(index,{sell}),value=await fixture.prepare();
      expect(value.fee).toMatchObject({mode:"pool_enforced",routedRateBps:0,rateBps:20,scope:"fee_on_proven_pool_paths"});
      expect(value.evidence.feeTransfer).toMatchObject({routedFeeAmount:"0",poolFeeAccrual:{platformAccruedIncrease:"200",grossNativeAmount:"100000"}});
      expect(validateLaunchPlanTradePreparationV1(value,fixture.projection,fixture.request,now)).toEqual(value);
      const decoded=decodeFunctionData({abi:ROUTED_TRADE_ROUTER_ABI_V1,data:value.transaction.data});
      expect(decodeAbiParameters([{type:"bytes"},{type:"bytes[]"}],decoded.args[1][0]!)[0]).toBe("0x060c0f");
    }
  });
  it("never suppresses routing from an unbacked, under-accrued, absent-vault or copied source witness", async()=>{
    for(const options of [{unbacked:true},{wrongAccrual:true},{missingRecord:true},{missingVault:true}]) await expect(immutablePoolFixture(0,options).prepare()).rejects.toMatchObject({status:503});
    const fixture=immutablePoolFixture(),value=await fixture.prepare();
    const changed=structuredClone(value);
    (changed.fee.poolEnforcementWitness as {recipient:string}).recipient=component;
    const {preparationDigest: oldDigest,...changedBody}=changed; void oldDigest;
    expect(()=>validateLaunchPlanTradePreparationV1({...changedBody,preparationDigest:launchPlanTradePreparationDigestV1(changedBody)},fixture.projection,request(),now)).toThrow(/runtime proof/);
    expect(()=>buildLaunchPlanRoutedSwapV1(fixture.projection,request(),50001n,structuredClone(fixture.proof))).toThrow();
    for(const mutation of [{nativePoolDelta:"99800"},{grossNativeAmount:"100001"},{platformAccruedBefore:"999"},{creatorAccruedIncrease:"149"},{backingBefore:"1499"}]){
      const altered=structuredClone(value),transfer=altered.evidence.feeTransfer as {poolFeeAccrual:Record<string,unknown>};
      Object.assign(transfer.poolFeeAccrual,mutation);
      const {preparationDigest: priorDigest,...alteredBody}=altered; void priorDigest;
      expect(()=>validateLaunchPlanTradePreparationV1({...alteredBody,preparationDigest:launchPlanTradePreparationDigestV1(alteredBody)},fixture.projection,request(),now)).toThrow();
    }
  });
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
