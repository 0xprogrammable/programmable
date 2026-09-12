import { Actions, URVersion, V4Planner } from "@uniswap/v4-sdk";
import { CommandType, RoutePlanner, UniversalRouterVersion } from "@uniswap/universal-router-sdk";
import { encodeAbiParameters, encodeFunctionData, getAddress, keccak256, toHex, type Address, type Hex } from "viem";
import type { RobinhoodLaunch } from "@/lib/robinhood-launches";
import { canonicalBrowserJsonV2, canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { projectionObject } from "@/lib/custom-launch/launch-projection-v1";
import { launchPlanTradeAmountsV1, LaunchPlanTradeErrorV1, ROUTED_TRADE_CONTRACTS_V1, ROUTED_TRADE_PERMIT2_ABI_V1,
  ROUTED_TRADE_ROUTER_ABI_V1, ROUTED_TRADE_TOKEN_ABI_V1, type LaunchPlanTradeTransactionV1 } from "@/lib/custom-launch/routed-trade-plan-v1";
import type { LaunchWalletProviderV1 } from "@/lib/custom-launch/wallet-handoff-plan-v1";

export const CUSTOM_V4_SWAP_RESPONSE = "programmable.custom-v4-swap-preparation.v1" as const;
export const CUSTOM_V4_SWAP_DESCRIPTOR = "programmable.custom-v4-swap-descriptor.v1" as const;
export const CUSTOM_V4_NATIVE = "0x0000000000000000000000000000000000000000" as Address;
const SENDER = "0x0000000000000000000000000000000000000001" as Address;
const HASH = /^0x[0-9a-f]{64}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const UINT128_MAX = (1n << 128n) - 1n;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export type CustomV4PoolKey = Readonly<{ currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }>;
export type CustomV4RuntimeBinding = Readonly<{ address: Address; runtimeCodeHash: Hex }>;
export type CustomV4SwapDescriptor = Readonly<{
  schemaVersion: typeof CUSTOM_V4_SWAP_DESCRIPTOR; launch: RobinhoodLaunch; poolKey: CustomV4PoolKey;
  source: Readonly<{ kind: "router_v1" | "multi_role_v2"; router: Address; routerRuntimeCodeHash: Hex; onchainLaunchId: Hex; stampHash: Hex }>;
  runtimeBindings: readonly CustomV4RuntimeBinding[]; descriptorDigest: `sha256:${string}`;
}>;
export type CustomV4SwapRequest = Readonly<{ token: Address; owner: Address; buy: boolean; amountIn: string; slippageBps: number; deadline: string }>;
export type CustomV4SwapPreparation = Readonly<{
  schemaVersion: typeof CUSTOM_V4_SWAP_RESPONSE; status: "ready" | "approval_required"; request: CustomV4SwapRequest;
  descriptorDigest: `sha256:${string}`;
  quote: Readonly<{ amountOut: string; amountOutMinimum: string; inputDecimals: number; outputDecimals: number;
    blockNumber: string; blockHash: Hex; blockTimestamp: string; validUntil: string }>;
  transaction: LaunchPlanTradeTransactionV1;
  evidence: Readonly<{ kind: "independent_rpc_simulation"; providerDomains: readonly ["drpc.org", "alchemy.com"];
    runtimeBindings: readonly CustomV4RuntimeBinding[]; traceDigest: `sha256:${string}`;
    actualWalletAuthorizationVerified: false;
    settlement: Readonly<{ inputBalanceDecrease: string; outputBalanceIncrease: string; takeAmount: string;
      postStateDigest: `sha256:${string}` }> | null }>;
  preparationDigest: `sha256:${string}`;
}>;
export type CustomV4SwapWalletInput = Readonly<{ action: "review" | "send"; descriptor: CustomV4SwapDescriptor;
  request: CustomV4SwapRequest; reviewed?: CustomV4SwapWalletReview }>;
export type CustomV4SwapWalletReview = Readonly<{ binding: `sha256:${string}`; preparation: CustomV4SwapPreparation;
  controllerKind: "eoa" | "connected_contract_wallet"; maxGasCostWei: string;
  transaction: { chainId: "0x1237"; from: Address; to: Address; data: Hex; value: Hex; gas: Hex; nonce?: Hex } }>;

const invalid = (code: string, message = "Refresh the current swap before continuing.", status: 400 | 409 | 503 = 409): never => {
  throw new LaunchPlanTradeErrorV1(code, message, status);
};
const uint = (value: unknown, maximum = UINT128_MAX): bigint => {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) > maximum) return invalid("INVALID_SWAP_AMOUNT");
  return BigInt(value);
};
export function parseCustomV4SwapRequest(value: unknown): CustomV4SwapRequest {
  if (!projectionObject(value) || Object.keys(value).sort().join() !== ["token", "owner", "buy", "amountIn", "slippageBps", "deadline"].sort().join()
    || typeof value.token !== "string" || !ADDRESS.test(value.token) || same(value.token, CUSTOM_V4_NATIVE)
    || typeof value.owner !== "string" || !ADDRESS.test(value.owner) || same(value.owner, CUSTOM_V4_NATIVE)
    || typeof value.buy !== "boolean" || !Number.isInteger(value.slippageBps) || Number(value.slippageBps) < 1 || Number(value.slippageBps) > 5000
    || uint(value.amountIn) === 0n || uint(value.deadline, (1n << 48n) - 1n) === 0n) return invalid("INVALID_SWAP_REQUEST", "The swap amount or wallet is invalid.", 400);
  return Object.freeze({ ...value, token: getAddress(value.token), owner: getAddress(value.owner) }) as CustomV4SwapRequest;
}
export function customV4PoolId(key: CustomV4PoolKey) {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
    [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]));
}
export function customV4SwapDescriptorDigest(value: Omit<CustomV4SwapDescriptor, "descriptorDigest">) {
  return canonicalBrowserSha256V2(CUSTOM_V4_SWAP_DESCRIPTOR, value);
}
export function validateCustomV4SwapDescriptor(value: CustomV4SwapDescriptor): CustomV4SwapDescriptor {
  const { launch, poolKey: key, source, runtimeBindings, descriptorDigest, ...rest } = value;
  if (rest.schemaVersion !== CUSTOM_V4_SWAP_DESCRIPTOR || !launch || !key || !source || !Array.isArray(runtimeBindings)
    || ![undefined, "multi-role-v2"].includes(launch.sourceKind) || !ADDRESS.test(launch.tokenAddress)
    || !HASH.test(launch.transactionHash) || !HASH.test(launch.blockHash) || !/^[1-9][0-9]*$/.test(launch.blockNumber)
    || ![key.currency0, key.currency1, key.hooks, source.router].every(item => typeof item === "string" && ADDRESS.test(item))
    || !same(key.currency0, CUSTOM_V4_NATIVE) || !same(key.currency1, launch.tokenAddress)
    || !Number.isInteger(key.fee) || key.fee < 0 || (key.fee > 1_000_000 && key.fee !== 0x800000)
    || !Number.isInteger(key.tickSpacing) || key.tickSpacing < 1 || key.tickSpacing > 32767
    || !launch.poolManager || !same(launch.poolManager, ROUTED_TRADE_CONTRACTS_V1.poolManager.address)
    || !launch.poolId || !same(customV4PoolId(key), launch.poolId) || !launch.hookAddress || !same(key.hooks, launch.hookAddress)
    || source.kind !== (launch.sourceKind === "multi-role-v2" ? "multi_role_v2" : "router_v1")
    || !HASH.test(source.routerRuntimeCodeHash) || !HASH.test(source.onchainLaunchId) || !HASH.test(source.stampHash)
    || runtimeBindings.length === 0 || runtimeBindings.length > 256
    || runtimeBindings.some(binding => !ADDRESS.test(binding.address) || !HASH.test(binding.runtimeCodeHash))
    || new Set(runtimeBindings.map(binding => binding.address.toLowerCase())).size !== runtimeBindings.length
    || runtimeBindings.find(binding => same(binding.address, source.router))?.runtimeCodeHash.toLowerCase() !== source.routerRuntimeCodeHash.toLowerCase()
    || descriptorDigest !== customV4SwapDescriptorDigest({ ...rest, launch, poolKey: key, source, runtimeBindings })) return invalid("SWAP_MARKET_CHANGED");
  return value;
}
export function buildCustomV4Swap(descriptor: CustomV4SwapDescriptor, request: CustomV4SwapRequest, amountOut: bigint): LaunchPlanTradeTransactionV1 {
  validateCustomV4SwapDescriptor(descriptor);
  if (!same(request.token, descriptor.launch.tokenAddress)) return invalid("SWAP_TOKEN_CHANGED");
  const amounts = launchPlanTradeAmountsV1(amountOut, 0, request.slippageBps);
  const input = request.buy ? CUSTOM_V4_NATIVE : request.token, output = request.buy ? request.token : CUSTOM_V4_NATIVE;
  const planner = new V4Planner();
  planner.addAction(Actions.SWAP_EXACT_IN_SINGLE, [{ poolKey: descriptor.poolKey, zeroForOne: request.buy,
    amountIn: request.amountIn, amountOutMinimum: amounts.amountOutMinimum, hookData: "0x" }], URVersion.V2_0);
  planner.addAction(Actions.SETTLE_ALL, [input, request.amountIn], URVersion.V2_0);
  planner.addAction(Actions.TAKE_ALL, [output, amounts.amountOutMinimum], URVersion.V2_0);
  const route = new RoutePlanner();
  route.addCommand(CommandType.V4_SWAP, [planner.finalize()], false, UniversalRouterVersion.V2_0);
  if (request.buy) route.addCommand(CommandType.SWEEP, [CUSTOM_V4_NATIVE, SENDER, 0], false, UniversalRouterVersion.V2_0);
  return { kind: "swap", chainId: "4663", from: request.owner, to: getAddress(ROUTED_TRADE_CONTRACTS_V1.universalRouter.address),
    data: encodeFunctionData({ abi: ROUTED_TRADE_ROUTER_ABI_V1, functionName: "execute", args: [route.commands as Hex, route.inputs as Hex[], BigInt(request.deadline)] }),
    value: request.buy ? request.amountIn : "0", gasLimit: "1" };
}
export function buildCustomV4SwapApproval(request: CustomV4SwapRequest, kind: "token_approval" | "permit2_approval"): LaunchPlanTradeTransactionV1 {
  if (request.buy) return invalid("UNEXPECTED_SWAP_APPROVAL");
  return { kind, chainId: "4663", from: request.owner, value: "0", gasLimit: "1",
    to: kind === "token_approval" ? request.token : getAddress(ROUTED_TRADE_CONTRACTS_V1.permit2.address),
    data: kind === "token_approval" ? encodeFunctionData({ abi: ROUTED_TRADE_TOKEN_ABI_V1, functionName: "approve",
      args: [getAddress(ROUTED_TRADE_CONTRACTS_V1.permit2.address), BigInt(request.amountIn)] })
      : encodeFunctionData({ abi: ROUTED_TRADE_PERMIT2_ABI_V1, functionName: "approve", args: [request.token,
        getAddress(ROUTED_TRADE_CONTRACTS_V1.universalRouter.address), BigInt(request.amountIn), Number(BigInt(request.deadline))] }) };
}
export const customV4SwapPreparationDigest = (value: Omit<CustomV4SwapPreparation, "preparationDigest">) => canonicalBrowserSha256V2(CUSTOM_V4_SWAP_RESPONSE, value);
export function validateCustomV4SwapPreparation(value: unknown, context: { descriptor: CustomV4SwapDescriptor; request: CustomV4SwapRequest }, now = BigInt(Math.floor(Date.now() / 1000))): CustomV4SwapPreparation {
  const descriptor = validateCustomV4SwapDescriptor(context.descriptor), request = parseCustomV4SwapRequest(context.request);
  if (!projectionObject(value) || value.schemaVersion !== CUSTOM_V4_SWAP_RESPONSE || !projectionObject(value.quote)
    || !projectionObject(value.transaction) || !projectionObject(value.evidence)) return invalid("INVALID_SWAP_PREPARATION");
  const prepared = value as unknown as CustomV4SwapPreparation, quote = prepared.quote, evidence = prepared.evidence, tx = prepared.transaction;
  const amounts = launchPlanTradeAmountsV1(uint(quote.amountOut), 0, request.slippageBps);
  if (canonicalBrowserJsonV2(prepared.request) !== canonicalBrowserJsonV2(request) || prepared.descriptorDigest !== descriptor.descriptorDigest
    || quote.amountOutMinimum !== amounts.amountOutMinimum || uint(quote.validUntil) <= now || uint(quote.validUntil) > now + 30n
    || uint(quote.blockTimestamp) > now || uint(quote.blockTimestamp) + 90n < now || uint(request.deadline) <= now
    || !HASH.test(quote.blockHash) || uint(quote.blockNumber) === 0n
    || ![quote.inputDecimals, quote.outputDecimals].every(item => Number.isInteger(item) && item >= 0 && item <= 255)
    || (request.buy ? quote.inputDecimals : quote.outputDecimals) !== 18
    || evidence.kind !== "independent_rpc_simulation" || evidence.actualWalletAuthorizationVerified !== false
    || canonicalBrowserJsonV2(evidence.providerDomains) !== canonicalBrowserJsonV2(["drpc.org", "alchemy.com"])
    || !DIGEST.test(evidence.traceDigest) || !Array.isArray(evidence.runtimeBindings) || evidence.runtimeBindings.length > 512
    || !["swap", "token_approval", "permit2_approval"].includes(tx.kind)
    || prepared.status !== (tx.kind === "swap" ? "ready" : "approval_required")
    || descriptor.runtimeBindings.some(required => !evidence.runtimeBindings.some(binding => same(binding.address, required.address) && same(binding.runtimeCodeHash, required.runtimeCodeHash)))) return invalid("STALE_SWAP_PREPARATION");
  if (evidence.runtimeBindings.some(binding => !ADDRESS.test(binding.address) || !HASH.test(binding.runtimeCodeHash))
    || new Set(evidence.runtimeBindings.map(binding => binding.address.toLowerCase())).size !== evidence.runtimeBindings.length) return invalid("INVALID_SWAP_RUNTIME");
  for (const name of ["poolManager", "universalRouter", "v4Quoter", "stateView", "permit2"] as const) {
    const pinned = ROUTED_TRADE_CONTRACTS_V1[name];
    if (!evidence.runtimeBindings.some(binding => same(binding.address, pinned.address) && same(binding.runtimeCodeHash, pinned.runtimeCodeHash))) return invalid("SWAP_INFRASTRUCTURE_CHANGED");
  }
  const settlement = evidence.settlement;
  if (tx.kind === "swap" ? !settlement || uint(settlement.inputBalanceDecrease) > uint(request.amountIn)
    || settlement.outputBalanceIncrease !== quote.amountOut || settlement.takeAmount !== quote.amountOut || !DIGEST.test(settlement.postStateDigest)
    : settlement !== null) return invalid("SWAP_OUTPUT_UNPROVEN");
  const expected = tx.kind === "swap" ? buildCustomV4Swap(descriptor, request, uint(quote.amountOut)) : buildCustomV4SwapApproval(request, tx.kind);
  const gas = uint(tx.gasLimit);
  if (gas === 0n || gas > 30_000_000n || canonicalBrowserJsonV2({ ...tx, gasLimit: "1" }) !== canonicalBrowserJsonV2(expected)) return invalid("SWAP_TRANSACTION_CHANGED");
  const { preparationDigest, ...body } = prepared;
  if (preparationDigest !== customV4SwapPreparationDigest(body)) return invalid("SWAP_PREPARATION_CHANGED");
  return prepared;
}

/** No transaction is sent here. The wallet provider owns the single-send lock,
 * reviewed-action comparison, pending record and eth_sendTransaction boundary. */
export async function prepareCustomV4SwapWallet(provider: LaunchWalletProviderV1, account: string, input: CustomV4SwapWalletInput, fetcher: typeof fetch = fetch): Promise<CustomV4SwapWalletReview> {
  const from = getAddress(account), request = parseCustomV4SwapRequest(input.request);
  if (from !== request.owner) throw new Error("Connect the wallet used for this swap.");
  const response = await fetcher("/api/swap/custom/prepare", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
  const body: unknown = await response.json();
  if (!response.ok) throw new LaunchPlanTradeErrorV1(projectionObject(body) && typeof body.code === "string" ? body.code : "SWAP_UNAVAILABLE",
    projectionObject(body) && typeof body.error === "string" && body.error.length < 512 ? body.error : "The swap could not be prepared.", response.status === 400 ? 400 : response.status === 409 ? 409 : 503);
  const preparation = validateCustomV4SwapPreparation(body, { descriptor: input.descriptor, request });
  const quantity = (value: unknown) => typeof value === "string" && /^0x[0-9a-f]{1,64}$/i.test(value) ? BigInt(value) : invalid("INVALID_WALLET_READ");
  const [chain, accounts, controllerCode] = await Promise.all([provider.request({ method: "eth_chainId" }), provider.request({ method: "eth_accounts" }),
    provider.request({ method: "eth_getCode", params: [from, "latest"] })]);
  if (quantity(chain) !== 4663n || !Array.isArray(accounts) || typeof accounts[0] !== "string" || getAddress(accounts[0]) !== from
    || typeof controllerCode !== "string" || !/^0x(?:[0-9a-f]{2})*$/i.test(controllerCode)) throw new Error("The connected wallet or network changed.");
  const controllerKind = controllerCode === "0x" ? "eoa" as const : "connected_contract_wallet" as const;
  await Promise.all(preparation.evidence.runtimeBindings.map(async binding => {
    const code = await provider.request({ method: "eth_getCode", params: [binding.address, "latest"] });
    if (typeof code !== "string" || !/^0x(?:[0-9a-f]{2})*$/i.test(code) || !same(keccak256(code as Hex), binding.runtimeCodeHash)) throw new Error("A swap contract changed. Refresh before signing.");
  }));
  const tx = preparation.transaction;
  const nonce = controllerKind === "eoa" ? toHex(quantity(await provider.request({ method: "eth_getTransactionCount", params: [from, "pending"] }))) : undefined;
  const transaction = { chainId: "0x1237" as const, from, to: tx.to, data: tx.data, value: toHex(BigInt(tx.value)), gas: toHex(BigInt(tx.gasLimit)), ...(nonce ? { nonce } : {}) };
  await provider.request({ method: "eth_call", params: [transaction, "latest"] });
  const [estimate, price, balance] = await Promise.all([provider.request({ method: "eth_estimateGas", params: [transaction] }),
    provider.request({ method: "eth_gasPrice" }), provider.request({ method: "eth_getBalance", params: [from, "latest"] })]);
  if (quantity(estimate) > BigInt(tx.gasLimit)) throw new Error("The gas requirement changed. Review the swap again.");
  const cost = BigInt(tx.gasLimit) * quantity(price);
  if (controllerKind === "eoa" && quantity(balance) < cost + BigInt(tx.value)) throw new Error("Keep enough ETH in the wallet for the swap and gas.");
  const binding = canonicalBrowserSha256V2("programmable.custom-v4-swap-wallet.v1", { transaction,
    descriptorDigest: preparation.descriptorDigest, runtimeBindings: preparation.evidence.runtimeBindings, controllerKind });
  return { binding, preparation, controllerKind, maxGasCostWei: cost.toString(), transaction };
}
