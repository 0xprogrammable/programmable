import { decodeEventLog, decodeFunctionResult, encodeFunctionData, keccak256, type Address, type Hex } from "viem";
import { moduleAddress, moduleBytes, moduleHash } from "../../lib/module-mode/release";
import { CREATE2_DEPLOYER, REGISTRY_ABI, assertPublicationPlan, type PublicationPlan, type PublicationCall } from "./core";
import { need, same, exactJson, acceptedDecision, type AuthenticatedReview } from "./review";

export interface PublicationProvider { providerId: string; trustDomain: string; endpointCommitment: string; rpc(method: string, parameters: unknown[]): Promise<unknown> }
const METHODS = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_call", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getTransactionCount", "eth_estimateGas"]);
export function publicationRpc(url: string, fetchImpl: typeof fetch = fetch): PublicationProvider["rpc"] {
  let id = 0;
  return async (method, params) => {
    need(METHODS.has(method), "Read-only publication RPC method required");
    const current = ++id;
    try {
      const response = await fetchImpl(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000), headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: current, method, params }) });
      need(response.ok && response.body, "RPC response unavailable");
      const chunks: Uint8Array[] = []; let total = 0;
      const reader = response.body.getReader();
      try { for (;;) { const item = await reader.read(); if (item.done) break; total += item.value.byteLength; need(total <= 4 * 1024 * 1024, "RPC response too large"); chunks.push(item.value); } }
      catch (error) { await reader.cancel(); throw error; } finally { reader.releaseLock(); }
      const payload = record(exactJson(Buffer.concat(chunks), 4 * 1024 * 1024));
      need(payload.jsonrpc === "2.0" && payload.id === current && !payload.error && Object.hasOwn(payload, "result"), "RPC response invalid"); return payload.result;
    } catch { throw new Error(`Publication ${method} read failed`); }
  };
}
function record(value: unknown): Record<string, unknown> { need(value && typeof value === "object" && !Array.isArray(value), "Invalid RPC object"); return value as Record<string, unknown>; }
function quantity(value: unknown): bigint { need(typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/iu.test(value), "Invalid RPC quantity"); return BigInt(value); }
function hex(value: bigint): Hex { return `0x${value.toString(16)}`; }
function quorum(providers: PublicationProvider[]) {
  need(providers.length === 2 && providers.every(p => typeof p.providerId === "string" && p.providerId && typeof p.trustDomain === "string" && p.trustDomain && typeof p.endpointCommitment === "string" && p.endpointCommitment), "Two reviewed RPC providers required");
  need(providers[0].providerId !== providers[1].providerId && providers[0].trustDomain !== providers[1].trustDomain && providers[0].endpointCommitment !== providers[1].endpointCommitment, "Independent RPC providers required");
}
async function pair(providers: PublicationProvider[], method: string, params: unknown[]) { return Promise.all(providers.map(p => p.rpc(method, params))); }
async function equalRead(providers: PublicationProvider[], method: string, params: unknown[]) { const result = await pair(providers, method, params); same(result[0], result[1], `Provider ${method}`); return result[0]; }
async function code(providers: PublicationProvider[], address: Address, block: Hex, hash: Hex) {
  const value = moduleBytes(await equalRead(providers, "eth_getCode", [address, block]), "publication.code");
  need(value !== "0x" && keccak256(value) === hash, "Runtime code differs from the pinned reviewed artifact");
}
async function getter(providers: PublicationProvider[], target: Address, name: "owner" | "families" | "getRevision", args: readonly Hex[], block: Hex) {
  const data = encodeFunctionData({ abi: REGISTRY_ABI, functionName: name, args: args as never });
  return decodeFunctionResult({ abi: REGISTRY_ABI, functionName: name, data: moduleBytes(await equalRead(providers, "eth_call", [{ to: target, data }, block]), "publication.getter", 4096) });
}
async function snapshot(providers: PublicationProvider[]) {
  quorum(providers);
  need((await pair(providers, "eth_chainId", [])).every(value => quantity(value) === 4663n), "Wrong publication chain");
  const heads = (await pair(providers, "eth_getBlockByNumber", ["latest", false])).map(record);
  const nums = heads.map(h => quantity(h.number)); need((nums[0] > nums[1] ? nums[0] - nums[1] : nums[1] - nums[0]) <= 4n, "RPC head gap exceeds four blocks");
  const number = hex(nums[0] < nums[1] ? nums[0] : nums[1]);
  const blocks = (await pair(providers, "eth_getBlockByNumber", [number, false])).map(record);
  const block = { number, hash: moduleHash(blocks[0].hash, "publication.block"), timestamp: blocks[0].timestamp };
  for (const value of blocks) same({ number: value.number, hash: value.hash, timestamp: value.timestamp }, block, "Common block");
  const age = BigInt(Math.floor(Date.now() / 1000)) - quantity(block.timestamp); need(age >= -30n && age <= 300n, "Publication block is stale or future dated");
  return block;
}
async function closing(providers: PublicationProvider[], block: { number: Hex; hash: Hex }) {
  const blocks = (await pair(providers, "eth_getBlockByNumber", [block.number, false])).map(record);
  need(blocks.every(value => value.hash === block.hash && value.number === block.number), "Publication snapshot reorganized");
}
export async function readPublicationOwner(release: PublicationPlan["release"], providers: PublicationProvider[]) {
  const block = await snapshot(providers);
  for (const pin of Object.values(release.contracts)) await code(providers, pin.address, block.number, pin.runtimeCodeHash);
  await code(providers, CREATE2_DEPLOYER.address, block.number, CREATE2_DEPLOYER.runtimeCodeHash);
  const owner = moduleAddress(await getter(providers, release.contracts.registry.address, "owner", [], block.number), "publication.owner");
  await closing(providers, block); return owner;
}
function expectedRevision(plan: PublicationPlan) {
  const { familyId, factory, factoryCodeHash, moduleCodeHash, manifestHash, callbackGas } = plan.publication.entry.nativeBinding;
  return { familyId, factory, factoryCodeHash, moduleCodeHash, manifestHash, callbackGas, enabled: true };
}
function normalizedRevision(value: unknown) {
  const r = record(value);
  return { familyId: moduleHash(r.familyId, "revision.family"), factory: moduleAddress(r.factory, "revision.factory"),
    factoryCodeHash: moduleHash(r.factoryCodeHash, "revision.factoryCode"), moduleCodeHash: moduleHash(r.moduleCodeHash, "revision.moduleCode"),
    manifestHash: moduleHash(r.manifestHash, "revision.manifest"), callbackGas: r.callbackGas, enabled: r.enabled };
}
async function checkReceipt(plan: PublicationPlan, call: PublicationCall, txHash: Hex, providers: PublicationProvider[], currentBlock: Hex) {
  const txs = (await pair(providers, "eth_getTransactionByHash", [txHash])).map(record);
  const receipts = (await pair(providers, "eth_getTransactionReceipt", [txHash])).map(record);
  const normalizeTx = (t: Record<string, unknown>) => ({ hash: t.hash, from: moduleAddress(t.from, "transaction.from"), to: moduleAddress(t.to, "transaction.to"), input: moduleBytes(t.input, "transaction.input", 49_184), value: t.value, chainId: t.chainId, blockHash: t.blockHash, blockNumber: t.blockNumber });
  const tx = normalizeTx(txs[0]); same(tx, normalizeTx(txs[1]), "Transaction quorum");
  need(tx.hash === txHash && tx.to === call.to && tx.input === call.data && quantity(tx.value) === 0n && quantity(tx.chainId) === 4663n
    && (call.action === "deployFactory" || tx.from === call.from), "Included transaction differs from the reviewed operation");
  const normalized = receipts.map(r => ({ transactionHash: r.transactionHash, blockNumber: r.blockNumber, blockHash: r.blockHash, status: r.status, transactionIndex: r.transactionIndex, logs: r.logs }));
  same(normalized[0], normalized[1], "Receipt quorum"); const receipt = normalized[0];
  need(receipt.transactionHash === txHash && receipt.blockHash === tx.blockHash && receipt.blockNumber === tx.blockNumber && quantity(receipt.status) === 1n && quantity(receipt.blockNumber) <= quantity(currentBlock), "Successful canonical receipt required");
  const blocks = (await pair(providers, "eth_getBlockByNumber", [receipt.blockNumber, false])).map(record);
  need(blocks.every(b => b.hash === receipt.blockHash && b.number === receipt.blockNumber && Array.isArray(b.transactions) && b.transactions.includes(txHash)), "Transaction is not in the canonical block");
  if (call.action === "deployFactory") await code(providers, plan.publication.entry.nativeBinding.factory, receipt.blockNumber as Hex, plan.publication.entry.nativeBinding.factoryCodeHash);
  if (call.action === "approveRevision") {
    need(Array.isArray(receipt.logs), "Admission event missing");
    const matches = receipt.logs.filter(raw => {
      const log = record(raw); if (String(log.address).toLowerCase() !== call.to || log.removed === true) return false;
      try {
        const parsed = decodeEventLog({ abi: REGISTRY_ABI, eventName: "RevisionApproved", data: log.data as Hex, topics: log.topics as [Hex, ...Hex[]], strict: true });
        const binding = plan.publication.entry.nativeBinding;
        if (parsed.args.packageId !== binding.packageId || parsed.args.familyId !== binding.familyId) return false;
        same(normalizedRevision(parsed.args.revision), expectedRevision(plan), "Admission event"); return true;
      } catch { return false; }
    });
    need(matches.length === 1, "Exact Registry admission event missing");
  }
  return { action: call.action, transaction: tx, receipt };
}
export async function observePublicationReadback(plan: PublicationPlan, review: AuthenticatedReview, providers: PublicationProvider[], transactions: { factory: Hex; family: Hex | null; revision: Hex }) {
  assertPublicationPlan(plan, review); acceptedDecision(review); const block = await snapshot(providers);
  for (const pin of Object.values(plan.release.contracts)) await code(providers, pin.address, block.number, pin.runtimeCodeHash);
  await code(providers, CREATE2_DEPLOYER.address, block.number, CREATE2_DEPLOYER.runtimeCodeHash);
  need(moduleAddress(await getter(providers, plan.release.contracts.registry.address, "owner", [], block.number), "publication.owner") === plan.reviewAuthority, "Registry authority changed");
  const binding = plan.publication.entry.nativeBinding;
  await code(providers, binding.factory, block.number, binding.factoryCodeHash);
  const family = await getter(providers, plan.release.contracts.registry.address, "families", [binding.familyId], block.number) as unknown as readonly Address[];
  same(family.map(value => moduleAddress(value, "family.wallet")),
    [moduleAddress(review.source.descriptor.author, "author"), moduleAddress(review.source.descriptor.rewardWallet, "reward")], "Registered family author/reward wallet");
  const revision = await getter(providers, plan.release.contracts.registry.address, "getRevision", [binding.packageId], block.number);
  same(normalizedRevision(revision), expectedRevision(plan), "Current immutable Registry revision");
  const selected = [[plan.calls[0], moduleHash(transactions.factory, "factory.transaction")],
    ...(transactions.family === null ? [] : [[plan.calls[1], moduleHash(transactions.family, "family.transaction")]]),
    [plan.calls[2], moduleHash(transactions.revision, "revision.transaction")]] as [PublicationCall, Hex][];
  need(new Set(selected.map(([, hash]) => hash)).size === selected.length, "Repeated publication transaction");
  const receipts = [];
  for (const [call, hash] of selected) receipts.push(await checkReceipt(plan, call, hash, providers, block.number));
  await closing(providers, block); assertPublicationPlan(plan, review);
  return { schemaVersion: "programmable.module-mode-publication-readback.v1" as const, status: "canonical-inclusion-verified" as const,
    finality: "separate-robinhood-ethereum-finality-proof-required" as const, chainId: 4663, releaseDigest: plan.release.releaseDigest, planDigest: plan.planDigest,
    packageId: binding.packageId, reviewDigest: plan.reviewDigest, block, factory: { address: binding.factory, runtimeCodeHash: binding.factoryCodeHash },
    revision: expectedRevision(plan), receipts, providers: providers.map(p => ({ providerId: p.providerId, trustDomain: p.trustDomain, endpointCommitment: p.endpointCommitment })), observedAt: new Date().toISOString() };
}
