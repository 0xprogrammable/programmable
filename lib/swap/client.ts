"use client";

import { createPublicClient, getAddress, http, isAddress, sha256, type Address, type Hex } from "viem";
import { mainnet } from "viem/chains";
import type { PreparedTransaction } from "@/lib/prepared-transaction";
import { parseModuleModeAvailability } from "@/lib/module-mode/native-catalog";
import { parseModuleEngineAvailability } from "@/lib/module-engine/catalog";
import { createModuleEngineClient } from "@/lib/module-engine/client";
import { parseLaunchProjectionV1, resolveProjectionAddress } from "@/lib/custom-launch/launch-projection-v1";
import type { LaunchPlanTradeWalletInputV1, LaunchPlanTradeWalletReviewV1 } from "@/lib/custom-launch/routed-trade-wallet-v1";
import type { PreparedModuleModeTransaction } from "@/components/module-mode-wallet-state";
import type { CustomV4SwapWalletInput, CustomV4SwapWalletReview } from "./custom-v4";
import { SWAP_TOKEN_SCHEMA, SwapUnavailableError, type SwapChainId, type SwapReceipt, type SwapReview, type SwapSide, type SwapTokenDescriptor } from "./types";
import { beginPendingSwap, clearPendingSwap, getPendingSwap, recordPendingSwapHash, subscribePendingSwap, type PendingSwap } from "./pending";

export { getPendingSwap, recordPendingSwapHash, subscribePendingSwap };
export type { PendingSwap };
export type SwapWalletActions = {
  sendModuleModeTransaction: (transaction: PreparedModuleModeTransaction) => Promise<Hex>;
  sendLaunchPlanTradeWalletAction: (input: LaunchPlanTradeWalletInputV1) => Promise<LaunchPlanTradeWalletReviewV1 | Hex>;
  sendCustomV4SwapWalletAction: (input: CustomV4SwapWalletInput) => Promise<CustomV4SwapWalletReview | Hex>;
  sendTransaction: (transaction: PreparedTransaction) => Promise<Hex>;
};
export interface PrepareSwapInput {
  descriptor: SwapTokenDescriptor;
  owner: Address;
  side: SwapSide;
  amountIn: bigint;
  slippageBps?: number;
}
interface SwapBinding {
  transaction: { from: Address; to: Address; data: Hex; value: string; preparedBlock: string };
  submit: (wallet: SwapWalletActions) => Promise<Hex>;
  wait?: (hash: Hex) => Promise<SwapReceipt>;
  refresh?: () => Promise<void>;
  state: "ready" | "pending" | "submitted";
}
const bindings = new WeakMap<SwapReview, SwapBinding>();
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const now = () => BigInt(Math.floor(Date.now() / 1000));
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function requireValue(value: unknown, message: string): asserts value { if (!value) throw new SwapUnavailableError(message); }

/** Response parsing does not create signing authority. Each adapter reconstructs
 * and verifies the exact source and transaction before its wallet boundary. */
export function parseSwapTokenDescriptor(value: unknown, expected: { address: string; chainId?: SwapChainId }): SwapTokenDescriptor {
  requireValue(object(value) && value.schemaVersion === SWAP_TOKEN_SCHEMA && [1, 4663].includes(Number(value.chainId)) && object(value.token), "The token response is invalid.");
  const row = value as unknown as SwapTokenDescriptor, token = row.token;
  requireValue(isAddress(token.address) && same(token.address, expected.address) && (expected.chainId === undefined || row.chainId === expected.chainId), "The token response belongs to another token or network.");
  requireValue(typeof token.name === "string" && token.name.length > 0 && token.name.length <= 256
    && typeof token.symbol === "string" && token.symbol.length > 0 && token.symbol.length <= 128
    && Number.isInteger(token.decimals) && token.decimals >= 0 && token.decimals <= 36, "The token details could not be verified.");
  requireValue(row.manageHref === null || typeof row.manageHref === "string" && /^\/launch\/modules\/manage\/0x[0-9a-f]{40}\?/i.test(row.manageHref), "The coin controls link is invalid.");
  if (row.status === "unavailable") {
    requireValue(row.route === null && typeof row.reason === "string" && row.reason.length <= 512, "The route status is invalid.");
    return row;
  }
  requireValue(row.status === "ready" && object(row.route), "The token route is invalid.");
  const route = row.route;
  if (route.kind === "module-native") {
    const availability = parseModuleModeAvailability(route.availability);
    requireValue(row.chainId === 4663 && availability.release, "The module version is unavailable.");
    return { ...row, route: { kind: "module-native", availability } };
  }
  if (route.kind === "any-quote") {
    const availability = parseModuleEngineAvailability(route.availability);
    const template = availability.templates.find(item => item.manifestHash === route.template?.manifestHash);
    requireValue(row.chainId === 4663 && availability.release && template, "The module version is unavailable.");
    return { ...row, route: { kind: "any-quote", availability, template } };
  }
  if (route.kind === "custom-vnext") {
    const projection = parseLaunchProjectionV1(route.projection);
    requireValue(row.chainId === 4663 && projection.sourceVersion === "custom_launch_plan_v1" && projection.markets.some(market => market.marketId === route.marketId), "The launch market is invalid.");
    return { ...row, route: { ...route, projection } };
  }
  if (route.kind === "classic") {
    requireValue(row.chainId === 1 && isAddress(route.hook) && /^0x[0-9a-f]{64}$/i.test(route.poolId)
      && ["classic", "deep", "stock-paired"].includes(route.launchModel), "The Ethereum market is invalid.");
    return row;
  }
  requireValue(route.kind === "custom-v4" && row.chainId === 4663 && object(route.descriptor), "The swap adapter is unavailable.");
  return row;
}

async function jsonResponse(response: Response): Promise<unknown> {
  if (response.redirected || response.headers.get("content-type")?.split(";", 1)[0] !== "application/json") throw new SwapUnavailableError("The swap service is temporarily unavailable. Try again.");
  if (Number(response.headers.get("content-length") ?? 0) > 2_097_152) throw new SwapUnavailableError("The swap response is invalid.");
  const text = await response.text();
  if (new TextEncoder().encode(text).length > 2_097_152) throw new SwapUnavailableError("The swap response is invalid.");
  const body: unknown = JSON.parse(text);
  if (!response.ok) throw new SwapUnavailableError(object(body) && typeof body.error === "string" && body.error.length <= 512 ? body.error : "The swap service is temporarily unavailable. Try again.", object(body) && typeof body.code === "string" ? body.code : undefined);
  return body;
}
export async function fetchSwapToken(input: { address: string; chainId?: SwapChainId; signal?: AbortSignal }): Promise<SwapTokenDescriptor> {
  requireValue(isAddress(input.address), "Enter a token contract address.");
  const query = new URLSearchParams({ address: input.address, chain: String(input.chainId ?? 4663) });
  const response = await fetch(`/api/swap/token?${query}`, { cache: "no-store", credentials: "same-origin", redirect: "error", signal: input.signal });
  return parseSwapTokenDescriptor(await jsonResponse(response), { ...input, chainId: input.chainId ?? 4663 });
}
function seal(review: SwapReview, binding: Omit<SwapBinding, "state">): SwapReview {
  const value = Object.freeze(review);
  bindings.set(value, { ...binding, state: "ready" });
  return value;
}
function display(input: PrepareSwapInput, fields: Pick<SwapReview, "kind" | "amountOut" | "minimumOutput" | "expiresAt" | "gasEstimate"> & Pick<Partial<SwapReview>, "approvalLabel">): SwapReview {
  return { chainId: input.descriptor.chainId, token: input.descriptor.token.address, owner: getAddress(input.owner), side: input.side, amountIn: input.amountIn, ...fields };
}

export async function prepareSwap(input: PrepareSwapInput, wallet: SwapWalletActions): Promise<SwapReview> {
  requireValue(input.descriptor.status === "ready", input.descriptor.status === "unavailable" ? input.descriptor.reason : "The swap route is unavailable.");
  requireValue(isAddress(input.owner) && ["buy", "sell"].includes(input.side) && input.amountIn > 0n && input.amountIn < (1n << 127n), "Enter an amount greater than zero.");
  const slippageBps = input.slippageBps ?? 100;
  requireValue(Number.isInteger(slippageBps) && slippageBps >= 1 && slippageBps <= 1000, "Use slippage between 0.01% and 10%.");
  requireValue(!getPendingSwap(input.owner, input.descriptor.chainId), "Check the previous swap in your wallet before sending another.");
  const route = input.descriptor.route, account = getAddress(input.owner), token = input.descriptor.token.address;
  if (route.kind === "module-native") {
    const native = await import("@/lib/module-mode/native-client"), client = createModuleEngineClient();
    const quote = await native.prepareModuleNativeSwap({ client, availability: route.availability, account, token,
      isBuy: input.side === "buy", amountSpecified: -input.amountIn, recipient: account, slippageBps });
    const prepared = quote.kind === "approval-required"
      ? await native.prepareModuleNativeApproval({ client, availability: route.availability, account, token, amount: quote.amount }) : quote;
    const bound = prepared, swap = prepared.kind === "swap" ? prepared : null;
    return seal(display(input, { kind: swap ? "swap" : "approval", amountOut: swap ? input.side === "buy" ? swap.tokenAmount : swap.nativeAmount : null,
      minimumOutput: swap?.limit ?? null, expiresAt: prepared.expiresAt, gasEstimate: prepared.gasEstimate,
      ...(swap ? {} : { approvalLabel: `Approve ${input.descriptor.token.symbol}` }) }), {
      transaction: { ...prepared.transaction, value: BigInt(prepared.transaction.value).toString(), preparedBlock: prepared.blockNumber.toString() },
      refresh: async () => {
        const response = await fetch(`/api/module-mode?releaseDigest=${bound.releaseDigest}`, { cache: "no-store", credentials: "same-origin", redirect: "error" });
        const current = parseModuleModeAvailability(await jsonResponse(response));
        requireValue(current.release?.releaseDigest === bound.releaseDigest, "The coin’s module version changed. Refresh the quote.");
      },
      submit: actions => actions.sendModuleModeTransaction(bound),
      wait: async hash => {
        try { const receipt = await native.waitForModuleNativeReceipt({ client, prepared: bound, transactionHash: hash }); return { status: "success", hash, chainId: 4663, blockNumber: receipt.blockNumber }; }
        catch (error) { if (error instanceof native.ModuleNativeTransactionRevertedError) return { status: "reverted", hash, chainId: 4663, blockNumber: error.blockNumber }; throw error; }
      },
    });
  }
  if (route.kind === "any-quote") {
    const engine = await import("@/lib/module-engine/client"), availabilityClient = await import("@/lib/module-engine/availability-client");
    const { quoteModuleEngineAnyQuoteTrade } = await import("@/lib/module-engine/any-quote/integration-client");
    const release = route.availability.release;
    requireValue(release, "The module version is unavailable.");
    const client = createModuleEngineClient(), quote = await quoteModuleEngineAnyQuoteTrade({ client, release, template: route.template,
      account, token, buy: input.side === "buy", inputAmount: input.amountIn, recipient: account, slippageBps });
    const prepared = quote.kind === "approval-required"
      ? await engine.prepareModuleEngineApproval({ client, release, account, token: quote.token,
        amount: quote.currentAllowance > 0n && quote.allowanceKind !== "permit2" ? 0n : quote.amount,
        spender: quote.spender, allowanceKind: quote.allowanceKind, permit2Spender: quote.permit2Spender, expiration: quote.expiration })
      : quote.prepared;
    const engineState = await import("@/components/module-mode-wallet-state"), store = await import("@/lib/module-mode-operation-store");
    requireValue(store.moduleModeOperationSnapshot(account) === null, "A previous module transaction is awaiting confirmation. Open this coin’s controls to check it.");
    let operation: import("@/lib/module-mode-operation-store").ModuleModeOperation | undefined;
    const isSwap = prepared.kind === "swap";
    return seal(display(input, { kind: isSwap ? "swap" : "approval", amountOut: isSwap ? prepared.outputAmount : null,
      minimumOutput: isSwap ? prepared.minimumOutput : null, expiresAt: prepared.expiresAt, gasEstimate: prepared.gasEstimate,
      ...(isSwap ? {} : { approvalLabel: prepared.kind === "approve" && prepared.amount === 0n ? "Reset allowance" : `Approve ${input.descriptor.token.symbol}` }) }), {
      transaction: { ...prepared.transaction, value: BigInt(prepared.transaction.value).toString(), preparedBlock: prepared.blockNumber.toString() },
      refresh: async () => availabilityClient.assertModuleEngineOperationAvailability(prepared, route.availability, await availabilityClient.fetchModuleEngineAvailability(prepared.releaseDigest)),
      submit: async actions => {
        let walletCalled = false;
        try {
          const result = await engineState.submitModuleModeOperation(prepared, transaction => {
            walletCalled = true;
            return actions.sendModuleModeTransaction(transaction);
          });
          operation = result.operation;
          return result.transactionHash;
        } catch (error) {
          if (!walletCalled) throw Object.assign(new Error(error instanceof Error ? error.message : "The transaction could not be prepared."), { walletRequestAttempted: false, cause: error });
          throw error;
        }
      },
      wait: async hash => {
        try {
          const receipt = await engine.observeModuleEngineReceipt(prepared, hash);
          if (operation) await store.clearModuleModeOperation(operation);
          return { status: "success", hash, chainId: 4663, blockNumber: receipt.blockNumber };
        } catch (error) {
          if (error instanceof engine.ModuleEngineTransactionRevertedError) {
            if (operation) await store.clearModuleModeOperation(operation);
            return { status: "reverted", hash, chainId: 4663, blockNumber: error.blockNumber };
          }
          throw error;
        }
      },
    });
  }
  if (route.kind === "custom-v4") {
    const request = { token, owner: account, buy: input.side === "buy", amountIn: input.amountIn.toString(), slippageBps, deadline: (now() + 600n).toString() };
    const reviewed = await wallet.sendCustomV4SwapWalletAction({ action: "review", descriptor: route.descriptor, request });
    requireValue(typeof reviewed !== "string", "The wallet returned no swap review.");
    const preparation = reviewed.preparation, tx = preparation.transaction;
    return seal(display(input, { kind: preparation.status === "ready" ? "swap" : "approval", amountOut: BigInt(preparation.quote.amountOut),
      minimumOutput: BigInt(preparation.quote.amountOutMinimum), expiresAt: BigInt(preparation.quote.validUntil), gasEstimate: BigInt(tx.gasLimit),
      ...(preparation.status === "ready" ? {} : { approvalLabel: `Approve ${input.descriptor.token.symbol}` }) }), {
      transaction: { ...tx, preparedBlock: preparation.quote.blockNumber },
      submit: async actions => {
        const hash = await actions.sendCustomV4SwapWalletAction({ action: "send", descriptor: route.descriptor, request, reviewed });
        requireValue(typeof hash === "string", "The wallet did not return a transaction hash.");
        return hash;
      },
    });
  }
  if (route.kind === "custom-vnext") {
    const api = await import("@/lib/custom-launch/routed-trade-plan-v1"), projection = route.projection;
    const market = projection.markets.find(item => item.marketId === route.marketId);
    requireValue(market, "The trading market changed.");
    const currency0 = resolveProjectionAddress(projection, market.currency0), currency1 = resolveProjectionAddress(projection, market.currency1);
    const inputCurrency = input.side === "buy" ? "0x0000000000000000000000000000000000000000" : token;
    const outputCurrency = input.side === "buy" ? token : "0x0000000000000000000000000000000000000000";
    requireValue([currency0, currency1].some(asset => same(asset, inputCurrency)) && [currency0, currency1].some(asset => same(asset, outputCurrency)), "This pool has no ETH swap route.");
    const request = api.parseLaunchPlanTradeRequestV1({ schemaVersion: api.ROUTED_TRADE_REQUEST_V1, chainId: "4663", launchId: projection.launchId,
      planHash: projection.planHash, marketId: market.marketId, owner: account, zeroForOne: same(inputCurrency, currency0), amountIn: input.amountIn.toString(), slippageBps, deadline: (now() + 600n).toString(), hookData: "0x" });
    const reviewed = await wallet.sendLaunchPlanTradeWalletAction({ action: "review", projection, request });
    requireValue(typeof reviewed !== "string", "The wallet returned no swap review.");
    const preparation = reviewed.preparation, tx = preparation.transaction;
    return seal(display(input, { kind: preparation.status === "ready" ? "swap" : "approval", amountOut: BigInt(preparation.quote.amountOut),
      minimumOutput: BigInt(preparation.quote.amountOutMinimum), expiresAt: BigInt(preparation.quote.validUntil), gasEstimate: BigInt(tx.gasLimit),
      ...(preparation.status === "ready" ? {} : { approvalLabel: `Approve ${input.descriptor.token.symbol}` }) }), {
      transaction: { ...tx, preparedBlock: preparation.quote.blockNumber },
      submit: async actions => { const hash = await actions.sendLaunchPlanTradeWalletAction({ action: "send", projection, request, reviewed }); requireValue(typeof hash === "string", "The wallet did not return a transaction hash."); return hash; },
    });
  }
  const api = await import("@/lib/trade/client"), deadline = (now() + 300n).toString();
  const request = { chainId: 1 as const, owner: account, token, side: input.side, amountIn: input.amountIn.toString(), slippageBps, deadline };
  const context = { ...request, hook: route.hook, poolId: route.poolId, launchModel: route.launchModel, launchModelVersion: route.launchModelVersion, quoteAsset: route.quoteAsset };
  const fetchPrepared = async () => api.validatePreparedTradeResponse(await jsonResponse(await fetch("/api/trade/prepare", { method: "POST", cache: "no-store", credentials: "same-origin", redirect: "error", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) })), context);
  const prepared = await fetchPrepared(), client = createPublicClient({ chain: mainnet, transport: http() }), block = await client.getBlockNumber();
  return seal(display(input, { kind: prepared.status === "ready" ? "swap" : "approval", amountOut: BigInt(prepared.quote.amountOut),
    minimumOutput: BigInt(prepared.quote.amountOutMinimum), expiresAt: BigInt(prepared.quote.deadline), gasEstimate: BigInt(prepared.quote.gasEstimate),
    ...(prepared.status === "ready" ? {} : { approvalLabel: `Approve ${input.descriptor.token.symbol}` }) }), {
    transaction: { from: account, to: prepared.transaction.to, data: prepared.transaction.data, value: prepared.transaction.value, preparedBlock: block.toString() },
    refresh: async () => { const latest = await fetchPrepared(); requireValue(latest.transaction.to === prepared.transaction.to && latest.transaction.data === prepared.transaction.data && latest.transaction.value === prepared.transaction.value, "The swap quote changed. Review it again."); },
    submit: actions => actions.sendTransaction(prepared.transaction),
  });
}

function definitelyNotSent(error: unknown): boolean {
  if (!object(error)) return false;
  return error.walletRequestAttempted === false || error.walletRequestRejected === true || error.code === 4001 || error.code === "4001" || error.name === "UserRejectedRequestError";
}
export async function submitSwap(review: SwapReview, wallet: SwapWalletActions): Promise<{ hash: Hex; wait: () => Promise<SwapReceipt> }> {
  const binding = bindings.get(review);
  requireValue(binding?.state === "ready", "Prepare a fresh swap before opening your wallet.");
  requireValue(now() < review.expiresAt, "The quote expired. Get a fresh quote.");
  await binding.refresh?.();
  const pending = await beginPendingSwap({ chainId: review.chainId, owner: review.owner, token: review.token, kind: review.kind,
    to: binding.transaction.to, data: binding.transaction.data, value: binding.transaction.value, preparedBlock: binding.transaction.preparedBlock });
  binding.state = "pending";
  let transactionHash: Hex;
  try { transactionHash = await binding.submit(wallet); }
  catch (error) {
    if (definitelyNotSent(error)) { await clearPendingSwap(pending); binding.state = "ready"; }
    throw error;
  }
  binding.state = "submitted";
  let recorded = pending;
  try { recorded = await recordPendingSwapHash(pending, transactionHash); } catch { /* Keep the returned hash and the original pending record for recovery. */ }
  return { hash: transactionHash, wait: async () => {
    const result = binding.wait ? await binding.wait(transactionHash) : await recoverSwap(recorded, transactionHash);
    await clearPendingSwap(pending);
    return result;
  } };
}

/** Read-only recovery binds the actual mined transaction to the saved calldata,
 * owner, asset, chain and block. It never sends or recreates a preparation. */
export async function recoverSwap(pending: PendingSwap, transactionHash: Hex | null = pending.hash): Promise<SwapReceipt> {
  requireValue(transactionHash && /^0x[0-9a-f]{64}$/i.test(transactionHash), "Enter the transaction hash from your wallet.");
  const current = getPendingSwap(pending.owner, pending.chainId);
  requireValue(current?.id === pending.id && (current.hash === null || same(current.hash, transactionHash)), "The saved swap changed. Check its latest transaction.");
  const client = pending.chainId === 4663 ? createModuleEngineClient() : createPublicClient({ chain: mainnet, transport: http() });
  requireValue(await client.getChainId() === pending.chainId, "The receipt provider is on another network.");
  const receipt = await client.waitForTransactionReceipt({ hash: transactionHash, confirmations: 1, timeout: 60_000, retryCount: 1 });
  const [tx, block] = await Promise.all([client.getTransaction({ hash: transactionHash }), client.getBlock({ blockNumber: receipt.blockNumber })]);
  requireValue(same(receipt.transactionHash, transactionHash) && same(tx.hash, transactionHash) && same(tx.from, pending.owner)
    && tx.to && same(tx.to, pending.to) && tx.chainId === pending.chainId && sha256(tx.input) === pending.dataHash && tx.value === BigInt(pending.value)
    && same(receipt.from, pending.owner) && receipt.to && same(receipt.to, pending.to)
    && tx.blockHash === receipt.blockHash && block.hash === receipt.blockHash && tx.blockNumber === receipt.blockNumber
    && receipt.blockNumber > BigInt(pending.preparedBlock), "This transaction does not match the saved swap.");
  if (pending.chainId === 4663) {
    const store = await import("@/lib/module-mode-operation-store"), raw = store.moduleModeOperationSnapshot(pending.owner);
    if (raw) {
      const operation = store.parseModuleModeOperation(raw, pending.owner);
      if (operation.sourceKind === "module-engine-v1" && operation.calldataHash === pending.dataHash && same(operation.target, pending.to)) {
        const recovery = await import("@/lib/module-mode-operation-recovery"), engine = await import("@/lib/module-engine/client");
        try { await recovery.recoverModuleEngineOperation({ client, operation, release: await recovery.fetchModuleEngineOperationRelease(operation.releaseDigest), transactionHash }); }
        catch (error) { if (!(error instanceof engine.ModuleEngineTransactionRevertedError)) throw error; }
        await store.clearModuleModeOperation(operation);
      }
    }
  }
  requireValue((await client.getBlock({ blockNumber: receipt.blockNumber })).hash === receipt.blockHash, "The receipt block changed. Check again.");
  await clearPendingSwap(pending);
  return { status: receipt.status === "success" ? "success" : "reverted", hash: transactionHash, chainId: pending.chainId, blockNumber: receipt.blockNumber };
}
