import { decodeFunctionResult, encodeFunctionData, getAddress, hashTypedData, keccak256, parseAbi, type Address, type Hex } from "viem";
import { canonicalBrowserJsonV2, canonicalBrowserSha256V2 } from "./browser-authority-v2";
import { projectionAddress, projectionHash, projectionObject } from "./launch-projection-v1";
import type { LaunchPlanRecordV1, LaunchWalletStepV1 } from "./launch-plan-v1";
import type { LaunchWalletProviderV1 } from "./wallet-handoff-plan-v1";
const ABI = parseAbi(["function masterCopy() view returns (address)", "function VERSION() view returns (string)",
  "function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)", "function nonce() view returns (uint256)",
  "function getModulesPaginated(address start,uint256 pageSize) view returns(address[] array,address next)"]);
const TYPES = { SafeTx: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" },
  { name: "operation", type: "uint8" }, { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" }, { name: "gasPrice", type: "uint256" },
  { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" }, { name: "nonce", type: "uint256" }] } as const;
const ZERO = "0x0000000000000000000000000000000000000000";
const SENTINEL = "0x0000000000000000000000000000000000000001";
// Canonical Safe storage layout, shared with the independently source-bound runtime adapter.
const SLOTS = { singleton: `0x${"00".repeat(32)}`, guard: "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8",
  fallbackHandler: "0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5" };
const fail = (): never => { throw new Error("The Safe authority or exact account transaction changed. Refresh its controller review."); };
const object = (value: unknown) => projectionObject(value) ? value : fail();
const address = (value: unknown): Address => projectionAddress(value) ? getAddress(value) : fail();
const hex = (value: unknown): Hex => typeof value === "string" && /^0x(?:[0-9a-f]{2})*$/i.test(value) ? value as Hex : fail();
const same = (a: unknown, b: unknown) => canonicalBrowserJsonV2(a) === canonicalBrowserJsonV2(b);

/** Available only when the connected provider account is the declared contract controller.
 * Approval collection remains in that account's wallet; an owner EOA never impersonates it. */
export async function verifySafeWalletReviewV1(provider: LaunchWalletProviderV1, resource: LaunchPlanRecordV1, step: LaunchWalletStepV1) {
  const evidence = object(resource.admissionEvidence); const simulation = object(evidence.simulation);
  const observations = Array.isArray(simulation.steps) ? simulation.steps : fail();
  const observation = object(observations.find(item => projectionObject(item) && item.stepId === step.stepId && item.transactionDigest === step.transactionDigest));
  const witness = object(observation.witness);
  const authorization = object(object(witness.details).walletAuthorization);
  const snapshot = object(authorization.authoritySnapshot);
  const typedData = object(authorization.typedData); const message = object(typedData.message);
  const controller = address(step.controller.address);
  const expected = { domain: { chainId: 4663, verifyingContract: controller }, types: TYPES, primaryType: "SafeTx",
    message: { to: step.transaction.to, value: step.transaction.value, data: step.transaction.data, operation: 0, safeTxGas: "0", baseGas: "0", gasPrice: "0",
      gasToken: ZERO, refundReceiver: ZERO, nonce: step.transaction.nonce } };
  if (authorization.schemaVersion !== "programmable.safe-launch-authorization.v1" || authorization.kind !== "safe_eip712"
    || authorization.status !== "owner_signature_required" || authorization.actualSignaturesVerified !== false
    || address(authorization.controller) !== controller || authorization.controllerRuntimeCodeHash !== step.controller.runtimeCodeHash
    || authorization.transactionDigest !== step.transactionDigest || authorization.controllerNonce !== step.transaction.nonce
    || !same(typedData, expected) || snapshot.schemaVersion !== "programmable.safe-launch-authority.v1" || snapshot.version !== "1.4.1"
    || authorization.authoritySnapshotDigest !== canonicalBrowserSha256V2("programmable.safe-launch-authority.v1", snapshot)
    || !same(authorization.execution, { to: controller, value: "0", function: "execTransaction", gasLimit: step.transaction.gasLimit })) fail();
  const digest = hashTypedData({ domain: expected.domain, types: TYPES, primaryType: "SafeTx", message: {
    to: address(message.to), value: BigInt(String(message.value)), data: hex(message.data), operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n,
    gasToken: ZERO, refundReceiver: ZERO, nonce: BigInt(step.transaction.nonce) } });
  if (digest !== authorization.typedDataDigest) fail();
  const call = async (functionName: "masterCopy" | "VERSION" | "getOwners" | "getThreshold" | "nonce") => decodeFunctionResult({ abi: ABI, functionName,
    data: hex(await provider.request({ method: "eth_call", params: [{ to: controller, data: encodeFunctionData({ abi: ABI, functionName }) }, "latest"] })) });
  const storageAddress = async (slot: string) => {
    const word = await provider.request({ method: "eth_getStorageAt", params: [controller, slot, "latest"] });
    if (!projectionHash(word) || !/^0x0{24}/i.test(word)) return fail(); return address(`0x${word.slice(-40)}`);
  };
  const [singleton, version, owners, threshold, nonce, singletonSlot, guard, fallbackHandler] = await Promise.all([
    call("masterCopy"), call("VERSION"), call("getOwners"), call("getThreshold"), call("nonce"),
    storageAddress(SLOTS.singleton), storageAddress(SLOTS.guard), storageAddress(SLOTS.fallbackHandler),
  ]);
  if (version !== "1.4.1" || typeof nonce !== "bigint" || nonce.toString() !== step.transaction.nonce || typeof threshold !== "bigint"
    || threshold.toString() !== snapshot.threshold || authorization.threshold !== snapshot.threshold || !Array.isArray(owners)
    || !Array.isArray(snapshot.owners) || !same(owners, snapshot.owners.map(item => address(object(item).address)))
    || !same(owners, authorization.requiredOwners) || singletonSlot !== address(singleton)
    || address(object(snapshot.singleton).address) !== singletonSlot || address(object(snapshot.guard).address) !== guard
    || address(object(snapshot.fallbackHandler).address) !== fallbackHandler) fail();
  const modules: Address[] = []; let cursor: Address = SENTINEL;
  for (let page = 0; ; page++) {
    const [items, next] = decodeFunctionResult({ abi: ABI, functionName: "getModulesPaginated", data: hex(await provider.request({ method: "eth_call", params: [
      { to: controller, data: encodeFunctionData({ abi: ABI, functionName: "getModulesPaginated", args: [cursor, 32n] }) }, "latest"] })) });
    modules.push(...items);
    if (next === SENTINEL) break;
    if (page >= 8 || items.length === 0 || modules.length > 256 || next === cursor) fail(); cursor = next;
  }
  if (!Array.isArray(snapshot.modules) || !same(modules, snapshot.modules.map(item => address(object(item).address)))) fail();
  const ownerRows = Array.isArray(snapshot.owners) ? snapshot.owners : fail();
  const moduleRows = Array.isArray(snapshot.modules) ? snapshot.modules : fail();
  for (const identity of [snapshot.singleton, ...ownerRows, ...moduleRows, snapshot.guard, snapshot.fallbackHandler]) {
    const item = object(identity); const account = address(item.address);
    const code = account === ZERO ? "0x" : hex(await provider.request({ method: "eth_getCode", params: [account, "latest"] }));
    if ((code === "0x" ? null : keccak256(code)) !== item.runtimeCodeHash) fail();
  }
  return authorization;
}
