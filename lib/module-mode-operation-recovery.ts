import { decodeFunctionData, encodeAbiParameters, encodeFunctionData, erc20Abi, keccak256, sha256, type AbiParameterToPrimitiveType, type Hex } from "viem";
import { moduleNativeLaunchAbiFor } from "./module-mode/native-abi";
import { managementCoreAbi } from "./module-mode/management";
import { ModuleNativeTransactionRevertedError, readModuleNativeLaunch, verifyModuleNativeAuthorWalletReceipt, type ModuleNativeClient, type ModuleNativeReceiptResult } from "./module-mode/native-client";
import { parseModuleModeAvailability } from "./module-mode/native-catalog";
import { bindActiveModuleModeRelease, moduleHash, type ModuleModeRelease } from "./module-mode/release";
import { parseModuleModeOperation, type ModuleModeOperation } from "./module-mode-operation-store";
import { bindActiveModuleEngineRelease, ENGINE_ZERO_HASH, parseModuleEngineAvailability, type ModuleEngineRelease } from "./module-engine/catalog";
import { isModuleEngineAnyQuoteRelease } from "./module-engine/profile";
import { ANY_QUOTE_INFRASTRUCTURE } from "./module-engine/any-quote/types";
import { anyQuotePoolFor } from "./module-engine/any-quote/integration";
import { buildAnyQuoteSwapV1 } from "./module-engine/any-quote/route";
import { moduleEngineAnyQuoteLedgerAbi, moduleEnginePermit2Abi, moduleEngineAuthorWalletAbi, moduleEngineHostAbi, moduleEnginePlanParameters } from "./module-engine/abi";
import { ModuleEngineTransactionRevertedError, readModuleEngineLaunch, verifyModuleEngineAnyQuoteSwapReceipt, verifyModuleEngineFeeChangeReceipt, type ModuleEngineFeeChange, verifyModuleEngineApprovalReceipt, verifyModuleEngineClaimReceipt, verifyModuleEngineLaunchReceipt, verifyModuleEngineOperationReceipt, type ModuleEngineClient, type ModuleEngineOperation, type ModuleEngineReceiptResult } from "./module-engine/client";

function requireMatch(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`The transaction does not match the saved ${label}. Check the hash in your wallet activity.`);
}
function same(a: unknown, b: unknown) { return typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase(); }
type EngineLaunchParameters = AbiParameterToPrimitiveType<(typeof moduleEnginePlanParameters)[3]>;
function decodeEngineCall(data: Hex): { functionName: "launch"; args: readonly [EngineLaunchParameters] } | { functionName: "execute"; args: readonly [Hex, ModuleEngineOperation] } {
  const decoded = decodeFunctionData({ abi: moduleEngineHostAbi, data });
  // The released ABI performs the tuple decoding; narrow its broad host ABI to the two wallet operations.
  if (decoded.functionName === "launch" && decoded.args?.length === 1) return { functionName: "launch", args: decoded.args as unknown as readonly [EngineLaunchParameters] };
  if (decoded.functionName === "execute" && decoded.args?.length === 2) return { functionName: "execute", args: decoded.args as unknown as readonly [Hex, ModuleEngineOperation] };
  throw new Error("The transaction does not match a supported engine wallet function.");
}

/** The normal availability authority resolves the exact historical release. Storage cannot authorize one. */
export async function fetchModuleModeOperationRelease(releaseDigest: Hex): Promise<ModuleModeRelease> {
  const digest = moduleHash(releaseDigest, "operation.releaseDigest");
  const response = await fetch(`/api/module-mode?releaseDigest=${digest}`, { cache: "no-store", credentials: "same-origin", redirect: "error" });
  if (!response.ok || response.redirected || response.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") throw new Error("The original launch version could not be verified. Your saved transaction remains protected. Check again later.");
  const availability = parseModuleModeAvailability(await response.json());
  if (!availability.release || !same(availability.release.releaseDigest, digest)) throw new Error("The original launch version is not available for verification. Your saved transaction remains protected.");
  return availability.release;
}

/** An engine source is resolved through its own exact release authority; native availability never substitutes for it. */
export async function fetchModuleEngineOperationRelease(releaseDigest: Hex): Promise<ModuleEngineRelease> {
  const digest = moduleHash(releaseDigest, "operation.releaseDigest");
  const response = await fetch(`/api/module-mode?sourceKind=module-engine-v1&releaseDigest=${digest}`, { cache: "no-store", credentials: "same-origin", redirect: "error" });
  if (!response.ok || response.redirected || response.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") throw new Error("The original engine version could not be verified. Your saved transaction remains protected. Check again later.");
  const availability = parseModuleEngineAvailability(await response.json());
  if (!availability.release || !same(availability.release.releaseDigest, digest)) throw new Error("The original engine version is not available for verification. Your saved transaction remains protected.");
  return availability.release;
}

/** Read-only reconciliation. It never rehydrates the private native preparation brand or calls a wallet. */
export async function recoverModuleModeOperation(input: {
  client: ModuleNativeClient; operation: ModuleModeOperation; release: ModuleModeRelease; transactionHash: Hex;
}): Promise<ModuleNativeReceiptResult> {
  const operation = parseModuleModeOperation(JSON.stringify(input.operation), input.operation.account);
  requireMatch(operation.sourceKind !== "module-engine-v1", "native source");
  const release = bindActiveModuleModeRelease(input.release);
  requireMatch(same(release.releaseDigest, operation.releaseDigest), "release version");
  const transactionHash = moduleHash(input.transactionHash, "operation.transactionHash");
  requireMatch(await input.client.getChainId() === 4663, "network");
  const receipt = await input.client.waitForTransactionReceipt({ hash: transactionHash, confirmations: 1, timeout: 60_000, retryCount: 1 });
  const [tx, block] = await Promise.all([input.client.getTransaction({ hash: transactionHash }), input.client.getBlock({ blockNumber: receipt.blockNumber })]);
  requireMatch(same(receipt.transactionHash, transactionHash) && same(tx.hash, transactionHash), "transaction hash");
  requireMatch(tx.chainId === 4663 && same(tx.from, operation.account) && same(receipt.from, operation.account), "wallet and network");
  requireMatch(same(tx.to, operation.target) && same(receipt.to, operation.target), "contract");
  requireMatch(sha256(tx.input) === operation.calldataHash && tx.value === BigInt(operation.value), "transaction data and value");
  requireMatch(same(tx.blockHash, receipt.blockHash) && same(block.hash, receipt.blockHash) && tx.blockNumber === receipt.blockNumber && block.number === receipt.blockNumber, "canonical block");
  requireMatch(receipt.blockNumber > BigInt(operation.preparedBlock) && receipt.blockNumber >= BigInt(release.startBlock), "preparation block");
  if (operation.version === 4) {
    requireMatch(same(operation.target, release.contracts.registry.address) && tx.value === 0n, "author registry and zero value");
    const decoded = decodeFunctionData({ abi: managementCoreAbi, data: tx.input });
    requireMatch(decoded.functionName === "changeAuthorWallet" && same(decoded.args[0], operation.authorWalletChange.familyId) && same(decoded.args[1], operation.authorWalletChange.recipient), "author wallet function and recipients");
    requireMatch(same(tx.input, encodeFunctionData({ abi: managementCoreAbi, functionName: "changeAuthorWallet", args: [operation.authorWalletChange.familyId, operation.authorWalletChange.recipient] })), "canonical author calldata");
    if (receipt.status === "reverted") throw new ModuleNativeTransactionRevertedError(transactionHash, receipt.blockNumber, receipt.blockHash);
    return verifyModuleNativeAuthorWalletReceipt({ client: input.client, release, token: operation.token, account: operation.account, change: operation.authorWalletChange, receipt });
  }
  const allowedTargets = operation.kind === "launch" ? [release.contracts.launcher.address] : [release.contracts.runtime.address, release.contracts.budgetVault.address, release.contracts.rewardLedger.address];
  requireMatch(allowedTargets.some(target => same(target, operation.target)), "release contract");
  if (receipt.status === "reverted") throw new ModuleNativeTransactionRevertedError(transactionHash, receipt.blockNumber, receipt.blockHash);
  requireMatch(receipt.status === "success", "receipt status");
  // Reuse the native client's immutable source, bytecode, pool and token readback at the receipt block.
  const launch = await readModuleNativeLaunch({ client: input.client, release, token: operation.token, blockNumber: receipt.blockNumber });
  if (operation.kind === "launch" && operation.launch) {
    const decoded = decodeFunctionData({ abi: moduleNativeLaunchAbiFor(release), data: tx.input });
    requireMatch(decoded.functionName === "launch", "launch function");
    const parameters = decoded.args[0];
    requireMatch(same(launch.token, operation.token) && same(launch.launchWallet, operation.account) && same(launch.poolId, operation.launch.poolId)
      && same(launch.recipeHash, operation.launch.recipeHash) && same(launch.launchKey, operation.launch.launchKey), "launch identity and module revision");
    requireMatch(parameters.initialBuyNative === launch.initialBuyNative && parameters.minimumInitialTokenOut === BigInt(operation.launch.minimumTokenOut)
      && launch.initialBuyTokens >= parameters.minimumInitialTokenOut, "initial buy");
  }
  const canonical = await input.client.getBlock({ blockNumber: receipt.blockNumber });
  requireMatch(canonical.number === receipt.blockNumber && same(canonical.hash, receipt.blockHash), "canonical block after verification");
  return { status: "mined", finalized: false, indexed: false, transactionHash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash,
    kind: operation.kind, token: operation.token, ...(operation.kind === "launch" ? { launch } : {}) };
}

/** Exact engine reconciliation uses its real host identity and nonce. Storage never becomes a private preparation. */
export async function recoverModuleEngineOperation(input: {
  client: ModuleEngineClient; operation: ModuleModeOperation; release: ModuleEngineRelease; transactionHash: Hex;
}): Promise<ModuleEngineReceiptResult> {
  const operation = parseModuleModeOperation(JSON.stringify(input.operation), input.operation.account);
  requireMatch(operation.sourceKind === "module-engine-v1", "engine source");
  const release = bindActiveModuleEngineRelease(input.release);
  requireMatch(same(release.releaseDigest, operation.releaseDigest), "engine release version");
  const transactionHash = moduleHash(input.transactionHash, "operation.transactionHash");
  requireMatch(await input.client.getChainId() === 4663, "network");
  const receipt = await input.client.waitForTransactionReceipt({ hash: transactionHash, confirmations: 1, timeout: 60_000, retryCount: 1 });
  const [tx, block] = await Promise.all([input.client.getTransaction({ hash: transactionHash }), input.client.getBlock({ blockNumber: receipt.blockNumber })]);
  requireMatch(same(receipt.transactionHash, transactionHash) && same(tx.hash, transactionHash), "transaction hash");
  requireMatch(tx.chainId === 4663 && same(tx.from, operation.account) && same(receipt.from, operation.account), "wallet and network");
  requireMatch(same(tx.to, operation.target) && same(receipt.to, operation.target), "contract");
  requireMatch(sha256(tx.input) === operation.calldataHash && tx.value === BigInt(operation.value), "transaction data and value");
  requireMatch(same(tx.blockHash, receipt.blockHash) && same(block.hash, receipt.blockHash) && tx.blockNumber === receipt.blockNumber && block.number === receipt.blockNumber, "canonical block");
  requireMatch(receipt.blockNumber > BigInt(operation.preparedBlock) && receipt.blockNumber >= BigInt(release.startBlock), "preparation block");
  if (operation.version === 5) requireMatch(isModuleEngineAnyQuoteRelease(release), "shared quote source");
  const target = operation.version === 5 && operation.kind === "swap" && isModuleEngineAnyQuoteRelease(release) ? release.contracts.universalRouter.address
    : operation.version === 5 && operation.approval?.allowanceKind === "permit2" ? ANY_QUOTE_INFRASTRUCTURE.permit2
    : operation.kind === "approve" ? operation.token : operation.kind === "rotate-author" ? release.contracts.registry.address
    : operation.kind === "claim" || operation.version === 3 ? release.contracts.ledger.address : release.contracts.host.address;
  requireMatch(same(operation.target, target), "engine release contract");
  const readBoundLaunch = async () => {
    requireMatch(operation.launch, "engine launch binding");
    const launch = await readModuleEngineLaunch({ client: input.client, release, token: operation.token, blockNumber: receipt.blockNumber });
    requireMatch(same(launch.token, operation.token) && same(launch.launchId, operation.launch.launchId)
      && same(launch.revisionId, operation.launch.revisionId) && same(launch.planHash, operation.launch.planHash), "engine launch identity and revision");
    return launch;
  };

  let result: ModuleEngineReceiptResult;
  if (operation.version === 5) {
    requireMatch(isModuleEngineAnyQuoteRelease(release), "shared quote source");
    if (operation.kind === "swap") {
      requireMatch(operation.swap && operation.launch, "shared quote swap binding");
      const saved = operation.swap, pool = anyQuotePoolFor(operation.token, saved.quoteAsset, release.contracts.sharedHook.address);
      const compiled = buildAnyQuoteSwapV1({ pool, owner: operation.account, recipient: saved.recipient, side: saved.buy ? "buy" : "sell", amountIn: BigInt(saved.inputAmount), minimumAmountOut: BigInt(saved.minimumOutput), deadline: BigInt(saved.deadline), externalRoute: saved.externalRoute, now: BigInt(saved.deadline) - 1n });
      requireMatch(String(compiled.balanceAccounting.mode) === "unlock-deltas" && same(compiled.transaction.to, tx.to) && same(compiled.transaction.data, tx.input) && BigInt(compiled.transaction.value) === tx.value, "canonical complete ETH route");
      if (receipt.status === "reverted") throw new ModuleEngineTransactionRevertedError(transactionHash, receipt.blockNumber, receipt.blockHash);
      requireMatch(receipt.status === "success", "receipt status");
      const launch = await readBoundLaunch(); requireMatch(same(launch.quoteAsset, saved.quoteAsset), "swap quote asset");
      result = await verifyModuleEngineAnyQuoteSwapReceipt({ client: input.client, release, launch, quote: { pool, buy: saved.buy, recipient: saved.recipient }, minimumOutput: BigInt(saved.minimumOutput), receipt });
    } else {
      requireMatch(operation.approval && tx.value === 0n && same(operation.approval.spender, ANY_QUOTE_INFRASTRUCTURE.permit2), "bounded Permit2 funding");
      const saved = operation.approval;
      if (saved.allowanceKind === "permit2") requireMatch(saved.expiration && same(saved.permit2Spender, release.contracts.universalRouter.address), "Permit2 router and expiry");
      const data = saved.allowanceKind === "permit2"
        ? encodeFunctionData({ abi: moduleEnginePermit2Abi, functionName: "approve", args: [operation.token, release.contracts.universalRouter.address, BigInt(saved.amount), Number(saved.expiration)] })
        : encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [saved.spender, BigInt(saved.amount)] });
      requireMatch(same(data, tx.input), "canonical bounded approval");
      if (receipt.status === "reverted") throw new ModuleEngineTransactionRevertedError(transactionHash, receipt.blockNumber, receipt.blockHash);
      requireMatch(receipt.status === "success", "receipt status");
      await readModuleEngineLaunch({ client: input.client, release, token: operation.token, blockNumber: receipt.blockNumber });
      result = await verifyModuleEngineApprovalReceipt({ client: input.client, release, account: operation.account, token: operation.token, amount: BigInt(saved.amount), spender: saved.spender, allowanceKind: saved.allowanceKind, ...(saved.allowanceKind === "permit2" ? { permit2Spender: release.contracts.universalRouter.address, expiration: BigInt(saved.expiration!) } : {}), receipt });
    }
  } else if (operation.version === 3) {
    const saved = operation.feeChange;
    const change: ModuleEngineFeeChange = saved.kind === "replace-creators" ? { ...saved, expectedAdminRevision: BigInt(saved.expectedAdminRevision), deadline: BigInt(saved.deadline) } : saved;
    requireMatch(change.kind === operation.kind && tx.value === 0n, "fee change kind and value");
    const data = change.kind === "rotate-platform" ? encodeFunctionData({ abi: moduleEngineAnyQuoteLedgerAbi, functionName: "changePlatformWallet", args: [change.recipient] }) : change.kind === "rotate-author"
      ? encodeFunctionData({ abi: moduleEngineAuthorWalletAbi, functionName: "changeAuthorWallet", args: [change.familyId, change.recipient] })
      : change.kind === "rotate-creator"
        ? encodeFunctionData({ abi: managementCoreAbi, functionName: "changeCreatorWallet", args: [operation.launch.launchId, BigInt(change.index), change.recipient] })
        : encodeFunctionData({ abi: managementCoreAbi, functionName: "replaceCreatorWallets", args: [operation.launch.launchId, [...change.recipients], change.expectedAdminRevision, change.deadline] });
    requireMatch(same(data, tx.input), "canonical fee change data");
    if (receipt.status === "reverted") throw new ModuleEngineTransactionRevertedError(transactionHash, receipt.blockNumber, receipt.blockHash);
    requireMatch(receipt.status === "success", "receipt status");
    result = await verifyModuleEngineFeeChangeReceipt({ client: input.client, release, launch: await readBoundLaunch(), account: operation.account, change, receipt });
  } else if (operation.kind === "approve") {
    requireMatch(operation.approval && same(operation.approval.spender, release.contracts.host.address) && tx.value === 0n, "bounded engine spender");
    const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.input });
    requireMatch(decoded.functionName === "approve" && same(decoded.args[0], operation.approval.spender) && decoded.args[1] === BigInt(operation.approval.amount), "engine approval");
    requireMatch(same(encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: decoded.args }), tx.input), "canonical approval data");
    if (receipt.status === "reverted") throw new ModuleEngineTransactionRevertedError(transactionHash, receipt.blockNumber, receipt.blockHash);
    requireMatch(receipt.status === "success", "receipt status");
    result = await verifyModuleEngineApprovalReceipt({ client: input.client, release, account: operation.account, token: operation.token, amount: BigInt(operation.approval.amount), receipt });
  } else if (operation.kind === "claim") {
    requireMatch(operation.claim && tx.value === 0n, "engine fee claim");
    const shared = isModuleEngineAnyQuoteRelease(release), launch = await readBoundLaunch();
    if (shared) {
      const decoded = decodeFunctionData({ abi: moduleEngineAnyQuoteLedgerAbi, data: tx.input });
      requireMatch(decoded.functionName === "claimQuoteTo" && same(decoded.args[0], launch.quoteAsset) && same(decoded.args[1], operation.claim.recipient), "quote claim asset and recipient");
      requireMatch(same(encodeFunctionData({ abi: moduleEngineAnyQuoteLedgerAbi, functionName: "claimQuoteTo", args: decoded.args }), tx.input), "canonical quote claim data");
    } else {
      const decoded = decodeFunctionData({ abi: managementCoreAbi, data: tx.input });
      requireMatch(decoded.functionName === "claimTo" && decoded.args.length === 1 && same(decoded.args[0], operation.claim.recipient), "engine claim recipient");
      requireMatch(same(encodeFunctionData({ abi: managementCoreAbi, functionName: "claimTo", args: decoded.args }), tx.input), "canonical engine claim data");
    }
    if (receipt.status === "reverted") throw new ModuleEngineTransactionRevertedError(transactionHash, receipt.blockNumber, receipt.blockHash);
    requireMatch(receipt.status === "success", "receipt status");
    result = await verifyModuleEngineClaimReceipt({ client: input.client, release, launch, account: operation.account, recipient: operation.claim.recipient,
      minimumAmount: BigInt(operation.claim.minimumAmount), claimedBefore: BigInt(operation.claim.claimedBefore), receipt });
  } else {
    requireMatch(operation.launch, "engine launch binding");
    const decoded = decodeEngineCall(tx.input);
    if (operation.kind === "launch") {
      requireMatch(decoded.functionName === "launch", "engine launch function");
      const parameters = decoded.args[0];
      requireMatch(same(encodeFunctionData({ abi: moduleEngineHostAbi, functionName: "launch", args: [parameters] }), tx.input), "canonical engine launch data");
      requireMatch(same(parameters.revisionId, operation.launch.revisionId)
        && same(keccak256(encodeAbiParameters(moduleEnginePlanParameters, [4663n, release.contracts.host.address, operation.account, parameters])), operation.launch.planHash), "engine revision and plan");
    } else {
      requireMatch(decoded.functionName === "execute" && operation.execution, "engine operation function");
      requireMatch(same(encodeFunctionData({ abi: moduleEngineHostAbi, functionName: "execute", args: decoded.args }), tx.input), "canonical engine operation data");
      requireMatch(same(decoded.args[0], operation.launch.launchId) && same(decoded.args[1].operationId, operation.execution.operationId)
        && decoded.args[1].nonce === BigInt(operation.execution.nonce) && same(decoded.args[1].actor, operation.account), "engine operation identity and nonce");
    }
    if (receipt.status === "reverted") throw new ModuleEngineTransactionRevertedError(transactionHash, receipt.blockNumber, receipt.blockHash);
    requireMatch(receipt.status === "success", "receipt status");
    const launch = await readBoundLaunch();
    if (decoded.functionName === "launch") {
      requireMatch(same(launch.creator, operation.account), "engine launch wallet");
      result = await verifyModuleEngineLaunchReceipt({ client: input.client, release, expected: launch, receipt });
      if (!isModuleEngineAnyQuoteRelease(release) && !same(decoded.args[0].initialOperation.operationId, ENGINE_ZERO_HASH)) {
        const initial = await verifyModuleEngineOperationReceipt({ client: input.client, release, launch, operation: decoded.args[0].initialOperation, receipt });
        result = { ...result, outputAmount: initial.outputAmount };
      }
    } else {
      requireMatch(decoded.functionName === "execute", "engine operation function");
      result = await verifyModuleEngineOperationReceipt({ client: input.client, release, launch, operation: decoded.args[1], receipt });
    }
  }
  const canonical = await input.client.getBlock({ blockNumber: receipt.blockNumber });
  requireMatch(canonical.number === receipt.blockNumber && same(canonical.hash, receipt.blockHash), "canonical block after verification");
  return result;
}
