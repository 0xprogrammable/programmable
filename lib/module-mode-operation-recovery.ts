import { decodeFunctionData, sha256, type Hex } from "viem";
import { moduleNativeLaunchAbiFor } from "./module-mode/native-abi";
import { ModuleNativeTransactionRevertedError, readModuleNativeLaunch, type ModuleNativeClient, type ModuleNativeReceiptResult } from "./module-mode/native-client";
import { parseModuleModeAvailability } from "./module-mode/native-catalog";
import { bindActiveModuleModeRelease, moduleHash, type ModuleModeRelease } from "./module-mode/release";
import { parseModuleModeOperation, type ModuleModeOperation } from "./module-mode-operation-store";

function requireMatch(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`The transaction does not match the saved ${label}. Check the hash in your wallet activity.`);
}
function same(a: unknown, b: unknown) { return typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase(); }

/** The normal availability authority resolves the exact historical release. Storage cannot authorize one. */
export async function fetchModuleModeOperationRelease(releaseDigest: Hex): Promise<ModuleModeRelease> {
  const digest = moduleHash(releaseDigest, "operation.releaseDigest");
  const response = await fetch(`/api/module-mode?releaseDigest=${digest}`, { cache: "no-store", credentials: "same-origin", redirect: "error" });
  if (!response.ok || response.redirected || response.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") throw new Error("The original launch version could not be verified. Your saved transaction remains protected. Check again later.");
  const availability = parseModuleModeAvailability(await response.json());
  if (!availability.release || !same(availability.release.releaseDigest, digest)) throw new Error("The original launch version is not available for verification. Your saved transaction remains protected.");
  return availability.release;
}

/** Read-only reconciliation. It never rehydrates the private native preparation brand or calls a wallet. */
export async function recoverModuleModeOperation(input: {
  client: ModuleNativeClient; operation: ModuleModeOperation; release: ModuleModeRelease; transactionHash: Hex;
}): Promise<ModuleNativeReceiptResult> {
  const operation = parseModuleModeOperation(JSON.stringify(input.operation), input.operation.account);
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
