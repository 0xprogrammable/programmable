import "server-only";
import { decodeFunctionData, decodeFunctionResult, encodeFunctionData, getAddress, keccak256, parseAbi, toHex, type Address, type Hex } from "viem";
import type { LaunchProjectionV1 } from "@/lib/custom-launch/launch-plan-v1";
import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { buildLaunchPlanRoutedSwapV1, buildLaunchPlanTradeApprovalV1, launchPlanTradeAmountsV1, launchPlanTradeBindingV1,
  launchPlanTradePreparationDigestV1, LaunchPlanTradeErrorV1, parseLaunchPlanTradeRequestV1, ROUTED_TRADE_CONTRACTS_V1,
  ROUTED_TRADE_PERMIT2_ABI_V1, ROUTED_TRADE_RESPONSE_V1, ROUTED_TRADE_TOKEN_ABI_V1,
  type LaunchPlanTradePreparationV1, type LaunchPlanTradeTransactionV1 } from "@/lib/custom-launch/routed-trade-plan-v1";
import { indexStore } from "@/lib/server/robinhood-index/store";
import { snapshotLaunches } from "@/lib/server/robinhood-index/model";
import { agreedTradeRpcV1, bytesV1, pendingTradeV1, productionTradeRpcsV1, quantityV1, successfulTradeFramesV1,
  tradeBlockV1, tradePostStateV1, tradeTraceV1, type TradeRpcV1 } from "./routed-trade-rpc-v1";
import { immutablePoolFeeRequiredAddressesV1, proveImmutablePoolFeeRuntimeV1,
  type ImmutablePoolFeeMarketV1 } from "@/lib/custom-launch/immutable-pool-fee-runtime-custom-launch-plan-v1";
import { proveImmutablePoolFeeTradeAccrualV1 } from "./immutable-pool-fee-trade-v1";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const QUOTER = parseAbi(["function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns(uint256 amountOut,uint256 gasEstimate)"]);
const TAKE = parseAbi(["function take(address currency,address to,uint256 amount)"]);
const INFRA = ["poolManager", "universalRouter", "v4Quoter", "stateView", "permit2"] as const;
const transactionRpc = (tx: LaunchPlanTradeTransactionV1, withGas = false) => ({ from: tx.from, to: tx.to, data: tx.data,
  value: toHex(BigInt(tx.value)), ...(withGas ? { gas: toHex(BigInt(tx.gasLimit)) } : {}) });

async function loadIndexedProjection(launchId: string): Promise<LaunchProjectionV1 | null> {
  const stored = await indexStore().read();
  return snapshotLaunches(stored?.snapshot ?? null).find(item => item.launchProjection?.launchId === launchId)?.launchProjection ?? null;
}

/** Server-owned read model + two independent, current RPC observations. The only
 * injectable seams are for tests and composition; none are request parameters. */
export async function prepareLaunchPlanTradeV1(input: unknown, dependencies: {
  loadProjection?: (launchId: string) => Promise<LaunchProjectionV1 | null>;
  rpcs?: readonly [TradeRpcV1, TradeRpcV1]; now?: () => bigint;
} = {}): Promise<LaunchPlanTradePreparationV1> {
  const request = parseLaunchPlanTradeRequestV1(input), now = dependencies.now?.() ?? BigInt(Math.floor(Date.now() / 1000));
  if (BigInt(request.deadline) <= now + 30n || BigInt(request.deadline) > now + 1800n) throw new LaunchPlanTradeErrorV1("INVALID_DEADLINE", "Use a deadline between 30 seconds and 30 minutes from now.", 400);
  const projection = await (dependencies.loadProjection ?? loadIndexedProjection)(request.launchId).catch(() => pendingTradeV1("LAUNCH_INDEX_UNAVAILABLE"));
  if (!projection) return pendingTradeV1("LAUNCH_NOT_INDEXED");
  let binding = launchPlanTradeBindingV1(projection, request);
  const rpcs = dependencies.rpcs ?? productionTradeRpcsV1(), rpc = agreedTradeRpcV1(rpcs);
  const chain = await rpc("eth_chainId", [], value => quantityV1(value).toString());
  if (chain !== "4663") return pendingTradeV1("TRADE_CHAIN_MISMATCH");
  const latest = await Promise.allSettled(rpcs.map(async read => tradeBlockV1(await read("eth_getBlockByNumber", ["latest", false]))));
  if (latest[0].status !== "fulfilled" || latest[1].status !== "fulfilled") return pendingTradeV1();
  const height = BigInt(latest[0].value.number) < BigInt(latest[1].value.number) ? latest[0].value.number : latest[1].value.number;
  const tag = toHex(BigInt(height)), block = await rpc("eth_getBlockByNumber", [tag, false], tradeBlockV1);
  if (BigInt(block.timestamp) > now || BigInt(block.timestamp) + 60n < now) return pendingTradeV1("TRADE_CHECKPOINT_STALE");
  const reference = { blockHash: block.hash, requireCanonical: true };
  const runtimeBindings: { address: Address; runtimeCodeHash: Hex }[] = [];
  const runtimeCodes: Record<string, Hex> = {};
  const expected = new Map<string, string>();
  INFRA.forEach(name => expected.set(ROUTED_TRADE_CONTRACTS_V1[name].address.toLowerCase(), ROUTED_TRADE_CONTRACTS_V1[name].runtimeCodeHash.toLowerCase()));
  projection.components.forEach(component => {
    const previous = expected.get(component.expectedAddress.toLowerCase());
    if (previous && previous !== component.runtimeCodeHash.toLowerCase()) return pendingTradeV1("RUNTIME_BINDING_CONFLICT");
    expected.set(component.expectedAddress.toLowerCase(), component.runtimeCodeHash.toLowerCase());
  });
  const addresses = [...new Set([...expected.keys(), binding.inputCurrency.toLowerCase(), binding.outputCurrency.toLowerCase(), binding.poolKey.hooks.toLowerCase(), request.owner.toLowerCase(), binding.fee.recipient.toLowerCase()])].filter(address => address !== ZERO);
  await Promise.all(addresses.map(async address => {
    const code = await rpc("eth_getCode", [address, reference], bytesV1), hash = keccak256(code);
    if ((address !== request.owner.toLowerCase() && address !== binding.fee.recipient.toLowerCase() && code === "0x") || (expected.has(address) && expected.get(address) !== hash)) return pendingTradeV1("TRADE_RUNTIME_CHANGED");
    runtimeBindings.push({ address: getAddress(address), runtimeCodeHash: hash });
    runtimeCodes[address.toLowerCase()] = code;
  }));
  const feeMarket: ImmutablePoolFeeMarketV1 = { chainId: "4663", poolManager: getAddress(ROUTED_TRADE_CONTRACTS_V1.poolManager.address), ...binding.poolKey };
  const requiredFeeRuntimes = immutablePoolFeeRequiredAddressesV1(feeMarket, runtimeCodes[binding.poolKey.hooks.toLowerCase()] ?? "0x");
  if (requiredFeeRuntimes) await Promise.all(requiredFeeRuntimes.filter(address => runtimeCodes[address.toLowerCase()] === undefined).map(async address => {
    const code = await rpc("eth_getCode", [address, reference], bytesV1);
    runtimeCodes[address.toLowerCase()] = code;
    runtimeBindings.push({ address, runtimeCodeHash: keccak256(code) });
  }));
  const poolFeeProof = requiredFeeRuntimes ? proveImmutablePoolFeeRuntimeV1(feeMarket, runtimeCodes) ?? undefined : undefined;
  if (requiredFeeRuntimes && !poolFeeProof) return pendingTradeV1("IMMUTABLE_POOL_FEE_RUNTIME_PENDING");
  if (poolFeeProof) binding = launchPlanTradeBindingV1(projection, request, poolFeeProof);
  runtimeBindings.sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
  const call = async (to: Address, data: Hex, overrides?: Record<string, Record<string, unknown>>) => rpc("eth_call",
    [{ from: request.owner, to, data }, reference, ...(overrides ? [overrides] : [])], bytesV1);
  const tokenUint = async (token: Address, functionName: "balanceOf" | "allowance" | "decimals", args: readonly unknown[], overrides?: Record<string, Record<string, unknown>>) => {
    const data = encodeFunctionData({ abi: ROUTED_TRADE_TOKEN_ABI_V1, functionName, args: args as never });
    const raw = await call(token, data, overrides);
    if (raw.length !== 66) return pendingTradeV1("ASSET_READ_ADAPTER_PENDING");
    return BigInt(raw);
  };
  const quoteData = encodeFunctionData({ abi: QUOTER, functionName: "quoteExactInputSingle", args: [{ poolKey: binding.poolKey,
    zeroForOne: request.zeroForOne, exactAmount: BigInt(request.amountIn), hookData: request.hookData }] });
  const quoteRaw = await call(getAddress(ROUTED_TRADE_CONTRACTS_V1.v4Quoter.address), quoteData);
  let gross: bigint;
  try { [gross] = decodeFunctionResult({ abi: QUOTER, functionName: "quoteExactInputSingle", data: quoteRaw }); }
  catch { return pendingTradeV1("SWAP_QUOTE_ADAPTER_PENDING"); }
  const amounts = launchPlanTradeAmountsV1(gross, binding.fee.routedRateBps, request.slippageBps);
  const decimals = async (currency: Address) => currency === ZERO ? 18 : tokenUint(currency, "decimals", []).then(v => v <= 255n ? Number(v) : null).catch(() => null);
  const [inputDecimals, outputDecimals] = await Promise.all([decimals(binding.inputCurrency), decimals(binding.outputCurrency)]);
  let transaction = buildLaunchPlanRoutedSwapV1(projection, request, gross, poolFeeProof);
  if (binding.inputCurrency !== ZERO) {
    const [balance, allowance, raw] = await Promise.all([tokenUint(binding.inputCurrency, "balanceOf", [request.owner]),
      tokenUint(binding.inputCurrency, "allowance", [request.owner, ROUTED_TRADE_CONTRACTS_V1.permit2.address]),
      call(getAddress(ROUTED_TRADE_CONTRACTS_V1.permit2.address), encodeFunctionData({ abi: ROUTED_TRADE_PERMIT2_ABI_V1,
        functionName: "allowance", args: [request.owner, binding.inputCurrency, getAddress(ROUTED_TRADE_CONTRACTS_V1.universalRouter.address)] }))]);
    if (balance < BigInt(request.amountIn)) throw new LaunchPlanTradeErrorV1("INSUFFICIENT_INPUT_BALANCE", "The connected wallet does not hold the requested input amount.", 400);
    let permitted: readonly [bigint, number, number];
    try { permitted = decodeFunctionResult({ abi: ROUTED_TRADE_PERMIT2_ABI_V1, functionName: "allowance", data: raw }); }
    catch { return pendingTradeV1("ASSET_APPROVAL_ADAPTER_PENDING"); }
    if (allowance < BigInt(request.amountIn)) transaction = buildLaunchPlanTradeApprovalV1(request, binding.inputCurrency, "token_approval");
    else if (permitted[0] < BigInt(request.amountIn) || BigInt(permitted[1]) < BigInt(request.deadline)) transaction = buildLaunchPlanTradeApprovalV1(request, binding.inputCurrency, "permit2_approval");
  }
  // Both providers must expose the same actual revert trace; transport errors
  // remain pending and are never promoted to a permanent unsafe-model verdict.
  const trace = await rpc("debug_traceCall", [transactionRpc(transaction), tag,
    { tracer: "callTracer", timeout: "10s" }], tradeTraceV1);
  if (trace.from !== request.owner.toLowerCase() || trace.to !== transaction.to.toLowerCase() || trace.input !== transaction.data.toLowerCase()
    || trace.value !== transaction.value || trace.type !== "CALL") return pendingTradeV1("TRADE_TRACE_BINDING_CHANGED");
  if (trace.failed) throw new LaunchPlanTradeErrorV1("TRADE_EXECUTION_REVERTED", "The exact transaction currently reverts. Refresh its amount, approvals or hook data.");
  // Include reached implementations and dependencies, not only proxy bytecode.
  const missingRuntimes = [...new Set(successfulTradeFramesV1(trace).flatMap(frame => frame.to ? [frame.to] : []))]
    .filter(address => address !== ZERO && !runtimeBindings.some(binding => binding.address.toLowerCase() === address));
  if (runtimeBindings.length + missingRuntimes.length > 512) return pendingTradeV1("TRADE_TRACE_LIMIT");
  await Promise.all(missingRuntimes.map(async address => runtimeBindings.push({ address: getAddress(address),
    runtimeCodeHash: keccak256(await rpc("eth_getCode", [address, reference], bytesV1)) })));
  runtimeBindings.sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
  const [rawResult, estimateString, post] = await Promise.all([
    rpc("eth_call", [transactionRpc(transaction), reference], bytesV1),
    rpc("eth_estimateGas", [transactionRpc(transaction), tag], v => quantityV1(v).toString()),
    rpc("debug_traceCall", [transactionRpc(transaction), tag, { tracer: "prestateTracer", timeout: "10s", tracerConfig: { diffMode: true } }], tradePostStateV1),
  ]);
  if (rawResult !== trace.output || (transaction.kind === "token_approval" && rawResult !== "0x" && BigInt(rawResult) !== 1n)) return pendingTradeV1("TRADE_SIMULATION_DISAGREEMENT");
  const gas = (BigInt(estimateString) * 120n + 99n) / 100n;
  if (gas === 0n || gas > 30_000_000n || BigInt(trace.gasUsed) > gas) return pendingTradeV1("TRADE_GAS_PENDING");
  transaction = { ...transaction, gasLimit: gas.toString() };
  let feeTransfer: unknown = null;
  if (transaction.kind === "swap") {
    const nativeInput = binding.inputCurrency === ZERO;
    const inputBefore = nativeInput ? BigInt(await rpc("eth_getBalance", [request.owner, reference], v => quantityV1(v).toString()))
      : await tokenUint(binding.inputCurrency, "balanceOf", [request.owner]);
    const inputAfter = nativeInput ? post[request.owner.toLowerCase()]?.balance === undefined ? inputBefore : quantityV1(post[request.owner.toLowerCase()]!.balance)
      : await tokenUint(binding.inputCurrency, "balanceOf", [request.owner], post);
    if (inputBefore - inputAfter > BigInt(request.amountIn)) return pendingTradeV1("INPUT_BUDGET_EFFECT_UNPROVEN");
    const takes = successfulTradeFramesV1(trace).filter(frame => frame.type === "CALL" && frame.from === transaction.to.toLowerCase()
      && frame.to === ROUTED_TRADE_CONTRACTS_V1.poolManager.address.toLowerCase()).flatMap(frame => {
        try { const decoded = decodeFunctionData({ abi: TAKE, data: frame.input });
          return [{ currency: decoded.args[0].toLowerCase(), recipient: decoded.args[1].toLowerCase(), amount: decoded.args[2], frame }]; }
        catch { return []; }
      }).filter(item => item.currency === binding.outputCurrency.toLowerCase());
    const feeTakes = takes.filter(item => item.recipient === binding.fee.recipient.toLowerCase());
    const userTakes = takes.filter(item => item.recipient === request.owner.toLowerCase());
    const expectedTakeCount = binding.fee.routedRateBps && takes.length === 2 ? 2 : 1;
    // Exact command order matters when the trader is also the fee recipient.
    if (takes.length !== expectedTakeCount || userTakes.length === 0 || (expectedTakeCount === 2 && feeTakes.length === 0)) return pendingTradeV1("ROUTED_FEE_TRANSFER_UNPROVEN");
    const feeAmount = expectedTakeCount === 2 ? takes[0]!.amount : 0n, userAmount = takes.at(-1)!.amount, actualGross = feeAmount + userAmount;
    if ((expectedTakeCount === 2 && takes[0]!.recipient !== binding.fee.recipient.toLowerCase())
      || takes.at(-1)!.recipient !== request.owner.toLowerCase() || feeAmount !== actualGross * BigInt(binding.fee.routedRateBps) / 10_000n
      || userAmount < BigInt(amounts.amountOutMinimum) || actualGross < BigInt(amounts.grossAmountOutMinimum)) return pendingTradeV1("ROUTED_FEE_TRANSFER_UNPROVEN");
    if (actualGross !== gross) return pendingTradeV1("SWAP_QUOTE_SIMULATION_MISMATCH");
    const credit = async (recipient: Address) => {
      const native = binding.outputCurrency === ZERO;
      const before = native ? BigInt(await rpc("eth_getBalance", [recipient, reference], v => quantityV1(v).toString())) : await tokenUint(binding.outputCurrency, "balanceOf", [recipient]);
      const changed = post[recipient.toLowerCase()];
      const after = native ? changed?.balance === undefined ? before : quantityV1(changed.balance)
        : await tokenUint(binding.outputCurrency, "balanceOf", [recipient], post);
      return after - before;
    };
    const [feeCredit, ownerCredit] = await Promise.all([credit(binding.fee.recipient), credit(request.owner)]);
    const sameRecipient = request.owner.toLowerCase() === binding.fee.recipient.toLowerCase();
    // The displayed output is the actual recipient credit. Tokens whose transfer
    // accounting differs need an exact settlement adapter, regardless of name or
    // economic category; nominal PoolManager.take arguments are insufficient.
    if (sameRecipient ? ownerCredit !== actualGross : (binding.fee.routedRateBps && feeCredit !== feeAmount) || ownerCredit !== userAmount) return pendingTradeV1("OUTPUT_CREDIT_ADAPTER_PENDING");
    const poolFeeAccrual = poolFeeProof ? await proveImmutablePoolFeeTradeAccrualV1({ proof: poolFeeProof, request,
      router: transaction.to, trace, post, call }) : undefined;
    feeTransfer = { policyVersion: binding.fee.policyVersion, scope: binding.fee.scope, currency: binding.outputCurrency,
      inputCurrency: binding.inputCurrency, maximumInput: request.amountIn, inputBalanceDecrease: (inputBefore - inputAfter).toString(),
      recipient: binding.fee.recipient, rateBps: binding.fee.routedRateBps, base: binding.fee.base, rounding: binding.fee.rounding,
      grossOutputCredit: actualGross.toString(), routedFeeAmount: feeAmount.toString(), traderOutputCredit: userAmount.toString(),
      recipientBalanceIncrease: feeCredit.toString(), traderBalanceIncrease: ownerCredit.toString(),
      transferTraceDigest: canonicalBrowserSha256V2("programmable.routed-fee-transfer-trace.v1", takes.map(item => item.frame)),
      postStateDigest: canonicalBrowserSha256V2("programmable.routed-fee-post-state.v1", post),
      ...(poolFeeAccrual ? { poolFeeAccrual } : {}) };
  } else if (transaction.kind === "token_approval") {
    const allowance = await tokenUint(binding.inputCurrency, "allowance", [request.owner, ROUTED_TRADE_CONTRACTS_V1.permit2.address], post);
    if (allowance !== BigInt(request.amountIn)) return pendingTradeV1("EXACT_APPROVAL_UNPROVEN");
  } else {
    const raw = await call(getAddress(ROUTED_TRADE_CONTRACTS_V1.permit2.address), encodeFunctionData({ abi: ROUTED_TRADE_PERMIT2_ABI_V1,
      functionName: "allowance", args: [request.owner, binding.inputCurrency, getAddress(ROUTED_TRADE_CONTRACTS_V1.universalRouter.address)] }), post);
    const [amount, expiration] = decodeFunctionResult({ abi: ROUTED_TRADE_PERMIT2_ABI_V1, functionName: "allowance", data: raw });
    if (amount !== BigInt(request.amountIn) || BigInt(expiration) !== BigInt(request.deadline)) return pendingTradeV1("EXACT_APPROVAL_UNPROVEN");
  }
  const unchanged = await rpc("eth_getBlockByNumber", [tag, false], tradeBlockV1);
  if (unchanged.hash !== block.hash) return pendingTradeV1("TRADE_CHECKPOINT_CHANGED");
  const body: Omit<LaunchPlanTradePreparationV1, "preparationDigest"> = {
    schemaVersion: ROUTED_TRADE_RESPONSE_V1, status: transaction.kind === "swap" ? "ready" : "approval_required", request,
    projectionDigest: binding.projectionDigest, fee: binding.fee,
    quote: { ...amounts, blockNumber: block.number, blockHash: block.hash, blockTimestamp: block.timestamp,
      validUntil: (now + 25n).toString(), inputDecimals, outputDecimals }, transaction,
    evidence: { kind: "independent_rpc_simulation", providerDomains: ["drpc.org", "alchemy.com"], runtimeBindings,
      feeTransfer, traceDigest: canonicalBrowserSha256V2("programmable.launch-plan-trade-trace.v1", trace), actualWalletAuthorizationVerified: false },
  };
  return { ...body, preparationDigest: launchPlanTradePreparationDigestV1(body) };
}
