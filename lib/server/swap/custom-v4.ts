import "server-only";
import { decodeEventLog, decodeFunctionData, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, getAddress, keccak256, parseAbi, toHex, type Address, type Hex } from "viem";
import chainProfile from "@/contracts/spec/robinhood-custom-launch/chain-4663.v1.json";
import type { RobinhoodLaunch } from "@/lib/robinhood-launches";
import { canonicalBrowserJsonV2, canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { isRobinhoodProjectedLaunch, projectionAddress, projectionHash, projectionObject, resolveProjectionAddress } from "@/lib/custom-launch/launch-projection-v1";
import { LaunchPlanTradeErrorV1, ROUTED_TRADE_CONTRACTS_V1, ROUTED_TRADE_PERMIT2_ABI_V1,
  ROUTED_TRADE_TOKEN_ABI_V1, type LaunchPlanTradeTransactionV1 } from "@/lib/custom-launch/routed-trade-plan-v1";
import { agreedTradeRpcV1, bytesV1, objectV1, pendingTradeV1, productionTradeRpcsV1, quantityV1, successfulTradeFramesV1,
  tradeBlockV1, tradePostStateV1, tradeTraceV1, type TradeRpcV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";
import { readRobinhoodToken } from "@/lib/server/robinhood-index/read";
import { buildCustomV4Swap, buildCustomV4SwapApproval, CUSTOM_V4_NATIVE, CUSTOM_V4_SWAP_DESCRIPTOR, CUSTOM_V4_SWAP_RESPONSE,
  customV4PoolId, customV4SwapAmounts, customV4SwapDescriptorDigest, customV4SwapPreparationDigest, parseCustomV4SwapRequest, validateCustomV4SwapDescriptor,
  type CustomV4RuntimeBinding, type CustomV4SwapDescriptor, type CustomV4SwapPreparation } from "@/lib/swap/custom-v4";

const INFRA = ["poolManager", "universalRouter", "v4Quoter", "stateView", "permit2"] as const;
const QUOTER = parseAbi(["function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns(uint256 amountOut,uint256 gasEstimate)"]);
const INITIALIZE = parseAbi(["event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)"]);
const TAKE = parseAbi(["function take(address currency,address to,uint256 amount)"]);
const STAMP = parseAbi([
  "function launchStamp(bytes32) view returns ((uint8 kind,address launchWallet,address token,address hook,address poolManager,bytes32 poolId,bytes32 poolKeyHash,bytes32 componentSetHash,bytes32 routePayloadHash,address routeLauncher,bytes32 routeLauncherRuntimeCodeHash,bytes32 expectedResultHash,bytes32 permitDigest,bytes32 stampHash))",
  "function launchStampV2(bytes32) view returns ((uint8 kind,address launchWallet,address token,address hook,address poolManager,bytes32 poolId,bytes32 poolKeyHash,bytes32 componentSetHash,bytes32 routePayloadHash,address routeLauncher,bytes32 routeLauncherRuntimeCodeHash,bytes32 expectedResultHash,bytes32 permitDigest,bytes32 stampHash))",
  "function componentRuntimeCodeHash(address) view returns(bytes32)",
  "function launchIdByToken(address) view returns(bytes32)",
]);
const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const transactionRpc = (tx: LaunchPlanTradeTransactionV1) => ({ from: tx.from, to: tx.to, data: tx.data, value: toHex(BigInt(tx.value)) });
const originCache = new Map<string, { expiresAt: number; value: Promise<CustomV4SwapDescriptor> }>();

function receiptV4(value: unknown) {
  const receipt = objectV1(value);
  if (quantityV1(receipt.status) !== 1n || !projectionHash(receipt.transactionHash) || !projectionHash(receipt.blockHash)
    || !Array.isArray(receipt.logs) || receipt.logs.length > 2048) return pendingTradeV1("SWAP_LAUNCH_RECEIPT_PENDING");
  return { transactionHash: receipt.transactionHash.toLowerCase(), blockHash: receipt.blockHash.toLowerCase(), blockNumber: quantityV1(receipt.blockNumber).toString(),
    logs: receipt.logs.map(value => { const log = objectV1(value);
      if (!projectionAddress(log.address) || !Array.isArray(log.topics) || !log.topics.every(projectionHash) || log.removed === true
        || !same(String(log.transactionHash), receipt.transactionHash as string) || !same(String(log.blockHash), receipt.blockHash as string)
        || quantityV1(log.blockNumber).toString() !== quantityV1(receipt.blockNumber).toString()) return pendingTradeV1("SWAP_LAUNCH_RECEIPT_PENDING");
      return { address: log.address.toLowerCase(), data: bytesV1(log.data), topics: log.topics.map(topic => topic.toLowerCase()) as [Hex, ...Hex[]], logIndex: quantityV1(log.logIndex).toString() };
    }) };
}

/** Only canonical saved-index rows enter this adapter. Router V1 stays Router
 * V1; multi-role launches retain their real finality and component evidence. */
export async function readCustomV4SwapDescriptor(launch: RobinhoodLaunch, dependencies: { rpcs?: readonly [TradeRpcV1, TradeRpcV1] } = {}): Promise<CustomV4SwapDescriptor> {
  // Historical source evidence is immutable. Every preparation below still
  // checks current runtimes, balance, approvals and exact execution afresh.
  if (dependencies.rpcs) return readVerifiedCustomV4SwapDescriptor(launch, dependencies.rpcs);
  const key = canonicalBrowserSha256V2("programmable.custom-v4-swap-origin.v1", launch), now = Date.now();
  const previous = originCache.get(key);
  if (previous && previous.expiresAt > now) return previous.value;
  originCache.delete(key);
  while (originCache.size >= 64) originCache.delete(originCache.keys().next().value!);
  const value = readVerifiedCustomV4SwapDescriptor(launch, productionTradeRpcsV1()).catch(error => { originCache.delete(key); throw error; });
  originCache.set(key, { expiresAt: now + 300_000, value });
  return value;
}

async function readVerifiedCustomV4SwapDescriptor(launch: RobinhoodLaunch, rpcs: readonly [TradeRpcV1, TradeRpcV1]): Promise<CustomV4SwapDescriptor> {
  if (![undefined, "multi-role-v2"].includes(launch.sourceKind) || !projectionHash(launch.transactionHash) || !projectionHash(launch.blockHash)
    || !/^[1-9][0-9]*$/.test(launch.blockNumber) || !launch.poolManager || !same(launch.poolManager, ROUTED_TRADE_CONTRACTS_V1.poolManager.address)
    || !launch.poolId || !projectionHash(launch.poolId) || !launch.hookAddress || !projectionAddress(launch.hookAddress)) return pendingTradeV1("SWAP_MARKET_ADAPTER_PENDING");
  const rpc = agreedTradeRpcV1(rpcs);
  const [chain, finals, block, receipt] = await Promise.all([
    rpc("eth_chainId", [], value => quantityV1(value).toString()), Promise.all(rpcs.map(async read => tradeBlockV1(await read("eth_getBlockByNumber", ["finalized", false])))),
    rpc("eth_getBlockByNumber", [toHex(BigInt(launch.blockNumber)), false], tradeBlockV1),
    rpc("eth_getTransactionReceipt", [launch.transactionHash], receiptV4),
  ]);
  if (chain !== "4663" || finals.some(final => BigInt(final.number) < BigInt(launch.blockNumber)) || !same(block.hash, launch.blockHash)
    || receipt.blockNumber !== launch.blockNumber || !same(receipt.blockHash, launch.blockHash) || !same(receipt.transactionHash, launch.transactionHash)) return pendingTradeV1("SWAP_LAUNCH_FINALITY_PENDING");
  const reference = { blockHash: block.hash, requireCanonical: true };
  const events = receipt.logs.filter(log => same(log.address, launch.poolManager!)).flatMap(log => {
    try { const event = decodeEventLog({ abi: INITIALIZE, data: log.data, topics: log.topics, strict: true });
      return same(event.args.id, launch.poolId!) ? [event.args] : []; } catch { return []; }
  });
  if (events.length !== 1) return pendingTradeV1("SWAP_POOL_ORIGIN_PENDING");
  const event = events[0]!, poolKey = { currency0: getAddress(event.currency0), currency1: getAddress(event.currency1), fee: event.fee,
    tickSpacing: event.tickSpacing, hooks: getAddress(event.hooks) };
  if (!same(customV4PoolId(poolKey), launch.poolId) || !same(poolKey.hooks, launch.hookAddress)
    || !same(poolKey.currency0, CUSTOM_V4_NATIVE) || !same(poolKey.currency1, launch.tokenAddress)) {
    throw new LaunchPlanTradeErrorV1("SWAP_NATIVE_MARKET_UNAVAILABLE", "This launch needs a separate ETH route before it can be swapped here.");
  }
  let router: Address, routerRuntimeCodeHash: Hex, onchainLaunchId: Hex;
  const runtimeBindings: CustomV4RuntimeBinding[] = [];
  if (launch.sourceKind === "multi-role-v2") {
    if (!isRobinhoodProjectedLaunch(launch)) return pendingTradeV1("SWAP_PROJECTION_BINDING_CHANGED");
    const projection = launch.launchProjection, witness = projection.finality.witness?.details.controllerWitness;
    if (projection.sourceVersion !== "multi_role_v2" || projection.finality.status !== "final" || !projectionObject(witness)
      || !projectionAddress(witness.router) || !projectionHash(witness.routerRuntimeCodeHash) || !projectionHash(witness.onchainLaunchId)
      || !projectionAddress(witness.controller) || !same(witness.controller, launch.creator)) return pendingTradeV1("SWAP_PROVENANCE_PENDING");
    router = getAddress(witness.router); routerRuntimeCodeHash = witness.routerRuntimeCodeHash; onchainLaunchId = witness.onchainLaunchId;
    const market = projection.markets.find(item => item.marketId === projection.primaryMarketId);
    if (!market || !same(market.poolManager, launch.poolManager) || customV4PoolId({ currency0: resolveProjectionAddress(projection, market.currency0),
      currency1: resolveProjectionAddress(projection, market.currency1), hooks: resolveProjectionAddress(projection, market.hooks), fee: market.fee, tickSpacing: market.tickSpacing }) !== customV4PoolId(poolKey)) return pendingTradeV1("SWAP_MARKET_BINDING_CHANGED");
    runtimeBindings.push(...projection.components.map(component => ({ address: getAddress(component.expectedAddress), runtimeCodeHash: component.runtimeCodeHash })));
  } else {
    const pinned = chainProfile.contracts.programmable.programmableLaunchStampRouter;
    if (!launch.routerAddress || !same(launch.routerAddress, pinned.address) || !projectionHash(launch.launchId) || !launch.stampHash || !projectionHash(launch.stampHash)) return pendingTradeV1("SWAP_STAMP_BINDING_CHANGED");
    router = getAddress(pinned.address); routerRuntimeCodeHash = pinned.runtimeCodeHash as Hex; onchainLaunchId = launch.launchId;
    await Promise.all([...new Set([launch.tokenAddress, launch.hookAddress])].filter(address => !same(address, CUSTOM_V4_NATIVE)).map(async address => {
      const raw = await rpc("eth_call", [{ to: router, data: encodeFunctionData({ abi: STAMP, functionName: "componentRuntimeCodeHash", args: [getAddress(address)] }) }, reference], bytesV1);
      const runtimeCodeHash = decodeFunctionResult({ abi: STAMP, functionName: "componentRuntimeCodeHash", data: raw });
      if (/^0x0{64}$/.test(runtimeCodeHash)) return pendingTradeV1("SWAP_COMPONENT_PROVENANCE_PENDING");
      runtimeBindings.push({ address: getAddress(address), runtimeCodeHash });
    }));
    const raw = await rpc("eth_call", [{ to: router, data: encodeFunctionData({ abi: STAMP, functionName: "launchIdByToken", args: [getAddress(launch.tokenAddress)] }) }, reference], bytesV1);
    if (!same(decodeFunctionResult({ abi: STAMP, functionName: "launchIdByToken", data: raw }), onchainLaunchId)) return pendingTradeV1("SWAP_STAMP_BINDING_CHANGED");
  }
  runtimeBindings.push({ address: router, runtimeCodeHash: routerRuntimeCodeHash });
  const stampFunction = launch.sourceKind === "multi-role-v2" ? "launchStampV2" : "launchStamp";
  const raw = await rpc("eth_call", [{ to: router, data: encodeFunctionData({ abi: STAMP, functionName: stampFunction, args: [onchainLaunchId] }) }, reference], bytesV1);
  const stamp = decodeFunctionResult({ abi: STAMP, functionName: stampFunction, data: raw });
  if (stamp.kind === 0 || !same(stamp.launchWallet, launch.creator) || !same(stamp.token, launch.tokenAddress) || !same(stamp.hook, launch.hookAddress)
    || !same(stamp.poolManager, launch.poolManager) || !same(stamp.poolId, launch.poolId) || /^0x0{64}$/.test(stamp.stampHash)
    || launch.stampHash !== null && !same(stamp.stampHash, launch.stampHash)) return pendingTradeV1("SWAP_STAMP_BINDING_CHANGED");
  if (launch.sourceKind === undefined) {
    const typeHash = keccak256(toHex("ProgrammablePoolKeyV1(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)"));
    const poolKeyHash = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
      [typeHash, poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]));
    if (!same(stamp.poolKeyHash, poolKeyHash)) return pendingTradeV1("SWAP_STAMP_POOL_CHANGED");
  }
  const bindings = new Map<string, CustomV4RuntimeBinding>();
  for (const binding of runtimeBindings) {
    const previous = bindings.get(binding.address.toLowerCase());
    if (previous && !same(previous.runtimeCodeHash, binding.runtimeCodeHash)) return pendingTradeV1("SWAP_RUNTIME_BINDING_CONFLICT");
    bindings.set(binding.address.toLowerCase(), binding);
  }
  await Promise.all([...bindings.values()].map(async binding => {
    const code = await rpc("eth_getCode", [binding.address, reference], bytesV1);
    if (code === "0x" || !same(keccak256(code), binding.runtimeCodeHash)) return pendingTradeV1("SWAP_LAUNCH_RUNTIME_CHANGED");
  }));
  const body: Omit<CustomV4SwapDescriptor, "descriptorDigest"> = { schemaVersion: CUSTOM_V4_SWAP_DESCRIPTOR, launch, poolKey,
    source: { kind: launch.sourceKind === "multi-role-v2" ? "multi_role_v2" : "router_v1", router, routerRuntimeCodeHash, onchainLaunchId, stampHash: stamp.stampHash },
    runtimeBindings: [...bindings.values()].sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase())) };
  return validateCustomV4SwapDescriptor({ ...body, descriptorDigest: customV4SwapDescriptorDigest(body) });
}

/** Quote, exact bounded approval or swap, and actual balance effects are read
 * from both providers at one current canonical block. No broadcast occurs. */
export async function prepareCustomV4Swap(input: unknown, dependencies: {
  loadLaunch?: (token: string) => Promise<RobinhoodLaunch | null>;
  rpcs?: readonly [TradeRpcV1, TradeRpcV1]; now?: () => bigint;
} = {}): Promise<CustomV4SwapPreparation> {
  const request = parseCustomV4SwapRequest(input), now = dependencies.now?.() ?? BigInt(Math.floor(Date.now() / 1000));
  if (BigInt(request.deadline) <= now + 30n || BigInt(request.deadline) > now + 1800n) throw new LaunchPlanTradeErrorV1("INVALID_DEADLINE", "Refresh the swap quote.", 400);
  const launch = await (dependencies.loadLaunch ?? (async token => (await readRobinhoodToken(token)).token))(request.token);
  if (!launch || !same(launch.tokenAddress, request.token)) return pendingTradeV1("SWAP_LAUNCH_NOT_INDEXED");
  const rpcs = dependencies.rpcs ?? productionTradeRpcsV1(), rpc = agreedTradeRpcV1(rpcs);
  const descriptor = await readCustomV4SwapDescriptor(launch, dependencies.rpcs ? { rpcs } : {});
  const latest = await Promise.all(rpcs.map(async read => tradeBlockV1(await read("eth_getBlockByNumber", ["latest", false]))));
  const height = BigInt(latest[0]!.number) < BigInt(latest[1]!.number) ? latest[0]!.number : latest[1]!.number;
  const tag = toHex(BigInt(height)), block = await rpc("eth_getBlockByNumber", [tag, false], tradeBlockV1);
  const checkpointNow = dependencies.now?.() ?? BigInt(Math.floor(Date.now() / 1000));
  if (BigInt(block.timestamp) > checkpointNow || BigInt(block.timestamp) + 60n < checkpointNow) return pendingTradeV1("SWAP_CHECKPOINT_STALE");
  const reference = { blockHash: block.hash, requireCanonical: true };
  const expected = new Map(descriptor.runtimeBindings.map(binding => [binding.address.toLowerCase(), binding.runtimeCodeHash.toLowerCase()]));
  for (const name of INFRA) { const pinned = ROUTED_TRADE_CONTRACTS_V1[name];
    if (expected.has(pinned.address.toLowerCase()) && expected.get(pinned.address.toLowerCase()) !== pinned.runtimeCodeHash.toLowerCase()) return pendingTradeV1("SWAP_RUNTIME_BINDING_CONFLICT");
    expected.set(pinned.address.toLowerCase(), pinned.runtimeCodeHash.toLowerCase()); }
  const runtimeBindings: CustomV4RuntimeBinding[] = [];
  await Promise.all([...new Set([...expected.keys(), request.owner.toLowerCase()])].map(async address => {
    const code = await rpc("eth_getCode", [address, reference], bytesV1), runtimeCodeHash = keccak256(code);
    if (expected.has(address) && (code === "0x" || expected.get(address) !== runtimeCodeHash)) return pendingTradeV1("SWAP_RUNTIME_CHANGED");
    runtimeBindings.push({ address: getAddress(address), runtimeCodeHash });
  }));
  const call = (to: Address, data: Hex, overrides?: Record<string, Record<string, unknown>>) => rpc("eth_call",
    [{ from: request.owner, to, data }, reference, ...(overrides ? [overrides] : [])], bytesV1);
  const tokenUint = async (functionName: "balanceOf" | "allowance" | "decimals", args: readonly unknown[], overrides?: Record<string, Record<string, unknown>>) => {
    const raw = await call(request.token, encodeFunctionData({ abi: ROUTED_TRADE_TOKEN_ABI_V1, functionName, args: args as never }), overrides);
    if (raw.length !== 66) return pendingTradeV1("SWAP_TOKEN_READ_PENDING"); return BigInt(raw);
  };
  const [quoteRaw, tokenDecimals] = await Promise.all([
    call(getAddress(ROUTED_TRADE_CONTRACTS_V1.v4Quoter.address), encodeFunctionData({ abi: QUOTER, functionName: "quoteExactInputSingle", args: [{
      poolKey: descriptor.poolKey, zeroForOne: request.buy, exactAmount: BigInt(request.amountIn), hookData: "0x" }] })), tokenUint("decimals", []),
  ]);
  const [amountOut] = decodeFunctionResult({ abi: QUOTER, functionName: "quoteExactInputSingle", data: quoteRaw });
  const amounts = customV4SwapAmounts(amountOut, request);
  if (tokenDecimals > 255n) return pendingTradeV1("SWAP_TOKEN_READ_PENDING");
  let transaction = buildCustomV4Swap(descriptor, request, amountOut);
  if (!request.buy) {
    const [balance, allowance, permitRaw] = await Promise.all([tokenUint("balanceOf", [request.owner]),
      tokenUint("allowance", [request.owner, ROUTED_TRADE_CONTRACTS_V1.permit2.address]),
      call(getAddress(ROUTED_TRADE_CONTRACTS_V1.permit2.address), encodeFunctionData({ abi: ROUTED_TRADE_PERMIT2_ABI_V1, functionName: "allowance",
        args: [request.owner, request.token, getAddress(ROUTED_TRADE_CONTRACTS_V1.universalRouter.address)] })),
    ]);
    if (balance < BigInt(request.amountIn)) throw new LaunchPlanTradeErrorV1("INSUFFICIENT_INPUT_BALANCE", "The wallet does not hold this token amount.", 400);
    const [permitted, expiration] = decodeFunctionResult({ abi: ROUTED_TRADE_PERMIT2_ABI_V1, functionName: "allowance", data: permitRaw });
    if (allowance < BigInt(request.amountIn)) transaction = buildCustomV4SwapApproval(request, "token_approval");
    else if (permitted < BigInt(request.amountIn) || BigInt(expiration) < BigInt(request.deadline)) transaction = buildCustomV4SwapApproval(request, "permit2_approval");
  }
  const trace = await rpc("debug_traceCall", [transactionRpc(transaction), tag, { tracer: "callTracer", timeout: "10s" }], tradeTraceV1);
  if (!same(trace.from, request.owner) || !trace.to || !same(trace.to, transaction.to) || trace.input !== transaction.data.toLowerCase()
    || trace.value !== transaction.value || trace.type !== "CALL") return pendingTradeV1("SWAP_TRACE_BINDING_CHANGED");
  if (trace.failed) throw new LaunchPlanTradeErrorV1("SWAP_EXECUTION_REVERTED", "This swap currently reverts. Try a smaller amount or refresh the quote.");
  const missing = [...new Set(successfulTradeFramesV1(trace).flatMap(frame => frame.to ? [frame.to] : []))]
    .filter(address => !same(address, CUSTOM_V4_NATIVE) && !runtimeBindings.some(binding => same(binding.address, address)));
  if (runtimeBindings.length + missing.length > 512) return pendingTradeV1("SWAP_TRACE_LIMIT");
  await Promise.all(missing.map(async address => runtimeBindings.push({ address: getAddress(address), runtimeCodeHash: keccak256(await rpc("eth_getCode", [address, reference], bytesV1)) })));
  const [result, estimate, posts] = await Promise.all([
    rpc("eth_call", [transactionRpc(transaction), reference], bytesV1),
    rpc("eth_estimateGas", [transactionRpc(transaction), tag], value => quantityV1(value).toString()),
    Promise.all(rpcs.map(async read => tradePostStateV1(await read("debug_traceCall", [transactionRpc(transaction), tag,
      { tracer: "prestateTracer", timeout: "10s", tracerConfig: { diffMode: true } }])))),
  ]);
  if (result !== trace.output || (transaction.kind === "token_approval" && result !== "0x" && BigInt(result) !== 1n)) return pendingTradeV1("SWAP_SIMULATION_DISAGREEMENT");
  const gas = (BigInt(estimate) * 120n + 99n) / 100n;
  if (gas === 0n || gas > 30_000_000n || BigInt(trace.gasUsed) > gas) return pendingTradeV1("SWAP_GAS_PENDING");
  transaction = { ...transaction, gasLimit: gas.toString() };
  // ArbOS also writes internal gas bookkeeping during a trace. Its counters can
  // differ between providers even when the same swap executes identically.
  // Require identical state for every source, runtime, owner and reached call,
  // then independently read the actual balance/allowance effects from each
  // provider's own application poststate. Chain-internal accounts cannot be
  // overridden by eth_call. No synthetic approval or balance is used.
  const reached = new Set(runtimeBindings.map(binding => binding.address.toLowerCase()));
  const applicationState = (post: Record<string, Record<string, unknown>>) => Object.fromEntries(Object.entries(post).filter(([address]) => reached.has(address.toLowerCase())));
  if (canonicalBrowserJsonV2(applicationState(posts[0]!)) !== canonicalBrowserJsonV2(applicationState(posts[1]!))) return pendingTradeV1("SWAP_POST_STATE_DISAGREEMENT");
  const postCall = async (to: Address, data: Hex) => {
    const results = await Promise.all(rpcs.map(async (read, index) => bytesV1(await read("eth_call", [{ from: request.owner, to, data }, reference, applicationState(posts[index]!)]))));
    if (results[0] !== results[1]) return pendingTradeV1("SWAP_EFFECT_DISAGREEMENT");
    return results[0]!;
  };
  const postTokenUint = async (functionName: "balanceOf" | "allowance", args: readonly unknown[]) => {
    const raw = await postCall(request.token, encodeFunctionData({ abi: ROUTED_TRADE_TOKEN_ABI_V1, functionName, args: args as never }));
    if (raw.length !== 66) return pendingTradeV1("SWAP_TOKEN_READ_PENDING"); return BigInt(raw);
  };
  let settlement: CustomV4SwapPreparation["evidence"]["settlement"] = null;
  if (transaction.kind === "swap") {
    const owner = request.owner.toLowerCase();
    const nativeBefore = BigInt(await rpc("eth_getBalance", [request.owner, reference], value => quantityV1(value).toString()));
    const nativeResults = posts.map(post => post[owner]?.balance === undefined ? nativeBefore : quantityV1(post[owner]!.balance));
    if (nativeResults[0] !== nativeResults[1]) return pendingTradeV1("SWAP_EFFECT_DISAGREEMENT");
    const nativeAfter = nativeResults[0]!;
    const [tokenBefore, tokenAfter] = await Promise.all([tokenUint("balanceOf", [request.owner]), postTokenUint("balanceOf", [request.owner])]);
    const inputDecrease = request.buy ? nativeBefore - nativeAfter : tokenBefore - tokenAfter;
    const outputIncrease = request.buy ? tokenAfter - tokenBefore : nativeAfter - nativeBefore;
    const output = request.buy ? request.token : CUSTOM_V4_NATIVE;
    const takes = successfulTradeFramesV1(trace).filter(frame => frame.type === "CALL" && same(frame.from, transaction.to)
      && frame.to && same(frame.to, ROUTED_TRADE_CONTRACTS_V1.poolManager.address)).flatMap(frame => {
        try { const decoded = decodeFunctionData({ abi: TAKE, data: frame.input });
          return same(decoded.args[0], output) ? [{ recipient: decoded.args[1], amount: decoded.args[2] }] : []; } catch { return []; }
      });
    if (inputDecrease < 0n || inputDecrease > BigInt(request.amountIn) || outputIncrease !== amountOut
      || takes.length !== 1 || !same(takes[0]!.recipient, request.owner) || takes[0]!.amount !== amountOut) return pendingTradeV1("SWAP_SETTLEMENT_UNPROVEN");
    settlement = { inputBalanceDecrease: inputDecrease.toString(), outputBalanceIncrease: outputIncrease.toString(), takeAmount: takes[0]!.amount.toString(),
      postStateDigest: canonicalBrowserSha256V2("programmable.custom-v4-swap-post-state.v1", posts) };
  } else if (transaction.kind === "token_approval") {
    if (await postTokenUint("allowance", [request.owner, ROUTED_TRADE_CONTRACTS_V1.permit2.address]) !== BigInt(request.amountIn)) return pendingTradeV1("EXACT_APPROVAL_UNPROVEN");
  } else {
    const raw = await postCall(getAddress(ROUTED_TRADE_CONTRACTS_V1.permit2.address), encodeFunctionData({ abi: ROUTED_TRADE_PERMIT2_ABI_V1,
      functionName: "allowance", args: [request.owner, request.token, getAddress(ROUTED_TRADE_CONTRACTS_V1.universalRouter.address)] }));
    const [amount, expiration] = decodeFunctionResult({ abi: ROUTED_TRADE_PERMIT2_ABI_V1, functionName: "allowance", data: raw });
    if (amount !== BigInt(request.amountIn) || BigInt(expiration) !== BigInt(request.deadline)) return pendingTradeV1("EXACT_APPROVAL_UNPROVEN");
  }
  if ((await rpc("eth_getBlockByNumber", [tag, false], tradeBlockV1)).hash !== block.hash) return pendingTradeV1("SWAP_CHECKPOINT_CHANGED");
  runtimeBindings.sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
  const completedAt = dependencies.now?.() ?? BigInt(Math.floor(Date.now() / 1000));
  if (BigInt(block.timestamp) + 60n < completedAt) return pendingTradeV1("SWAP_CHECKPOINT_STALE");
  const body: Omit<CustomV4SwapPreparation, "preparationDigest"> = { schemaVersion: CUSTOM_V4_SWAP_RESPONSE,
    status: transaction.kind === "swap" ? "ready" : "approval_required", request, descriptorDigest: descriptor.descriptorDigest,
    quote: { amountOut: amounts.amountOut, amountOutMinimum: amounts.amountOutMinimum,
      inputDecimals: request.buy ? 18 : Number(tokenDecimals), outputDecimals: request.buy ? Number(tokenDecimals) : 18,
      blockNumber: block.number, blockHash: block.hash, blockTimestamp: block.timestamp, validUntil: (completedAt + 25n).toString() }, transaction,
    evidence: { kind: "independent_rpc_simulation", providerDomains: ["drpc.org", "alchemy.com"], runtimeBindings,
      traceDigest: canonicalBrowserSha256V2("programmable.custom-v4-swap-trace.v1", trace), settlement, actualWalletAuthorizationVerified: false } };
  return { ...body, preparationDigest: customV4SwapPreparationDigest(body) };
}
