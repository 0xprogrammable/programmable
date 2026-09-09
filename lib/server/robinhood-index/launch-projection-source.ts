import { createPublicClient, http, keccak256, parseAbi } from "viem";
import { ROBINHOOD_MAINNET_RPC_URL } from "@/lib/chains";
import type { LaunchProjectionV1 } from "@/lib/custom-launch/launch-plan-v1";
import { LAUNCH_PROJECTION_FEED_V1, parseLaunchProjectionV1, projectionAddress, projectionHash, projectionObject, projectionToRobinhoodLaunch } from "@/lib/custom-launch/launch-projection-v1";
import { canonicalBrowserJsonV2 } from "@/lib/custom-launch/browser-authority-v2";
import { parseSnapshot } from "./model";
import type { IndexStore } from "./store";

export type LaunchProjectionSourceV1 = {
  page(cursor: string | null): Promise<{ launches: readonly LaunchProjectionV1[]; nextCursor: string | null }>;
  verify(projection: LaunchProjectionV1): Promise<{ launchedAt: string | null }>;
};
const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const MULTI_ROLE_PROVENANCE_ABI = parseAbi([
  "function launchStampV2(bytes32 launchId) view returns ((uint8 kind,address launchWallet,address token,address hook,address poolManager,bytes32 poolId,bytes32 poolKeyHash,bytes32 componentSetHash,bytes32 routePayloadHash,address routeLauncher,bytes32 routeLauncherRuntimeCodeHash,bytes32 expectedResultHash,bytes32 permitDigest,bytes32 stampHash) record)",
]);
const PLAN_PROVENANCE_ABI = parseAbi([
  "function launchStampV1(bytes32 launchId) view returns ((bytes32 stampHash,bytes32 permitDigest,bytes32 planHash,bytes32 manifestDigest,address controller,uint256 blockNumber) record)",
]);

/** Existing saved-index lane. Failed reads preserve the previous verified rows and pagination checkpoint. */
export async function syncLaunchProjectionIndex(source: LaunchProjectionSourceV1, store: IndexStore, now = Date.now) {
  const saved = await store.read();
  if (!saved) throw new Error("Canonical Robinhood index must be initialized first");
  const old = saved.snapshot.launchProjections;
  const page = await source.page(old?.nextCursor ?? null);
  const rows = new Map((old?.items ?? []).map(row => [`${row.sourceKind}:${row.launchId}`, row]));
  for (const candidate of page.launches) {
    const projection = parseLaunchProjectionV1(candidate);
    // Router V1 already owns its immutable historical rows in this same index.
    if (projection.sourceVersion === "router_v1") continue;
    const key = `${projection.sourceVersion === "multi_role_v2" ? "multi-role-v2" : "custom-launch-plan-v1"}:${projection.launchId}`;
    const previous = rows.get(key);
    if (previous?.launchProjection && canonicalBrowserJsonV2(previous.launchProjection) === canonicalBrowserJsonV2(projection)) continue;
    if (previous?.launchProjection && (previous.launchProjection.planHash !== projection.planHash
      || previous.launchProjection.controller.toLowerCase() !== projection.controller.toLowerCase()
      || previous.blockNumber !== projection.finality.blockNumber || previous.blockHash.toLowerCase() !== projection.finality.blockHash?.toLowerCase())) {
      throw new Error("Projection origin changed; reconcile the existing launch");
    }
    const verified = await source.verify(projection);
    rows.set(key, projectionToRobinhoodLaunch(projection, verified.launchedAt));
  }
  await store.write(parseSnapshot({ ...saved.snapshot, launchProjections: {
    version: 1, sourceUrl: LAUNCH_PROJECTION_FEED_V1, updatedAt: new Date(now()).toISOString(),
    nextCursor: page.nextCursor, items: [...rows.values()],
  } }), saved.etag);
  return { status: page.nextCursor === null ? "ready" as const : "partial" as const, indexed: rows.size, nextCursor: page.nextCursor };
}

/** Backend finality includes the independently verified L1 witness. The Website additionally reads
 * receipt, canonical L2 block and every component runtime from two independent RPCs before storing it. */
export function launchProjectionSourceV1(signal: AbortSignal = AbortSignal.timeout(30000)): LaunchProjectionSourceV1 {
  const rpcUrls = [process.env.ROBINHOOD_RPC_URL?.trim() || "https://rpc-robinhood.blockmachine.io",
    process.env.ROBINHOOD_RPC_SECONDARY_URL?.trim() || ROBINHOOD_MAINNET_RPC_URL];
  const urls = rpcUrls.map(value => new URL(value));
  if (urls.some(url => url.protocol !== "https:" || url.username || url.password) || urls[0].hostname === urls[1].hostname) {
    throw new Error("Independent Robinhood RPCs are required");
  }
  const clients = rpcUrls.map(url => createPublicClient({ transport: http(url, { timeout: 8000, retryCount: 0,
    fetchOptions: { signal } }) }));
  return {
    async page(cursor) {
      const url = new URL(LAUNCH_PROJECTION_FEED_V1);
      url.searchParams.set("limit", "10");
      if (cursor) url.searchParams.set("cursor", cursor);
      const response = await fetch(url, { signal, redirect: "error", cache: "no-store", headers: { accept: "application/json" } });
      if (!response.ok || response.redirected || response.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
        || !response.body || Number(response.headers.get("content-length")) > 16_777_216) throw new Error("Launch projection feed unavailable");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
          if (size > 16_777_216) throw new Error("Projection page exceeded its byte budget"); chunks.push(value); }
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!projectionObject(value) || value.schemaVersion !== "programmable.launch-projection-page.v1"
        || !Array.isArray(value.launches) || value.launches.length > 10
        || !(value.nextCursor === null || typeof value.nextCursor === "string" && value.nextCursor.length > 0 && value.nextCursor.length <= 4096)
        || value.nextCursor !== null && (value.nextCursor === cursor || value.launches.length === 0)) throw new Error("Invalid projection page");
      return { launches: value.launches.map(parseLaunchProjectionV1), nextCursor: value.nextCursor };
    },
    async verify(value) {
      const projection = parseLaunchProjectionV1(value);
      if (projection.chainId !== "4663" || projection.finality.status !== "final" || !projection.finality.witness) throw new Error("Launch finality is pending");
      const height = BigInt(projection.finality.blockNumber!);
      const observations = await Promise.all(clients.map(async client => {
        const [chain, final, block] = await Promise.all([client.getChainId(), client.getBlock({ blockTag: "finalized" }), client.getBlock({ blockNumber: height })]);
        if (chain !== 4663 || final.number < height || !same(block.hash, projection.finality.blockHash!)) throw new Error("Projection canonical block mismatch");
        for (const hash of projection.finality.transactionHashes) {
          const receipt = await client.getTransactionReceipt({ hash });
          if (receipt.status !== "success" || receipt.blockNumber > height
            || !same((await client.getBlock({ blockNumber: receipt.blockNumber })).hash, receipt.blockHash)) throw new Error("Projection receipt mismatch");
        }
        for (const component of projection.components) {
          const code = await client.getCode({ address: component.expectedAddress, blockNumber: height });
          if (!code || code === "0x" || !same(keccak256(code), component.runtimeCodeHash)) throw new Error("Projection runtime mismatch");
        }
        const details = projection.finality.witness!.details;
        const witness = projection.sourceVersion === "multi_role_v2" ? details.controllerWitness : details.stamp;
        if (!projectionObject(witness) || !projectionHash(witness.onchainLaunchId)) throw new Error("Projection controller witness unavailable");
        const source = projection.sourceVersion === "multi_role_v2" ? witness.router : witness.address;
        const runtimeHash = projection.sourceVersion === "multi_role_v2" ? witness.routerRuntimeCodeHash : witness.runtimeCodeHash;
        if (!projectionAddress(source) || !projectionHash(runtimeHash) || !projectionAddress(witness.controller)
          || !same(witness.controller, projection.controller)) throw new Error("Projection controller binding mismatch");
        const sourceCode = await client.getCode({ address: source, blockNumber: height });
        if (!sourceCode || !same(keccak256(sourceCode), runtimeHash)) throw new Error("Projection provenance runtime mismatch");
        if (projection.sourceVersion === "multi_role_v2") {
          const stamp = await client.readContract({ address: source, abi: MULTI_ROLE_PROVENANCE_ABI, functionName: "launchStampV2", args: [witness.onchainLaunchId], blockNumber: height });
          if (!same(stamp.launchWallet, projection.controller) || /^0x0{64}$/.test(stamp.stampHash)) throw new Error("Projection original controller mismatch");
        } else {
          const stamp = await client.readContract({ address: source, abi: PLAN_PROVENANCE_ABI, functionName: "launchStampV1", args: [witness.onchainLaunchId], blockNumber: height });
          if (!same(stamp.controller, projection.controller) || stamp.blockNumber !== height
            || stamp.planHash !== `0x${projection.planHash?.slice(7)}` || stamp.manifestDigest !== `0x${projection.manifestDigest?.slice(7)}`
            || stamp.stampHash !== witness.stampHash || stamp.permitDigest !== witness.permitDigest) throw new Error("Projection plan stamp mismatch");
        }
        return { blockHash: block.hash, launchedAt: new Date(Number(block.timestamp) * 1000).toISOString() };
      }));
      if (observations[0].blockHash !== observations[1].blockHash || observations[0].launchedAt !== observations[1].launchedAt) throw new Error("Projection providers disagree");
      return { launchedAt: observations[0].launchedAt };
    },
  };
}
