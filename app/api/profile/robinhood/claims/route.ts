import { createPublicClient, http, keccak256 } from "viem";
import { robinhoodChain } from "@/lib/chains";
import { readRobinhoodProfileClaimDescriptors } from "@/lib/server/robinhood-index/read";
import type { LaunchClaimReadV1 } from "@/lib/custom-launch/claim-handoff-v1";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams; const account = query.get("account");
  const cursor = query.get("cursor");
  if (!account || !/^0x[0-9a-f]{40}$/i.test(account) || [...query.keys()].some(key => !["account", "cursor"].includes(key))
    || query.getAll("account").length !== 1 || query.getAll("cursor").length > 1 || cursor !== null && !/^(0|[1-9][0-9]{0,6})$/.test(cursor)) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  try {
    const descriptors = await readRobinhoodProfileClaimDescriptors(account);
    const client = createPublicClient({ chain: robinhoodChain, transport: http(undefined, { retryCount: 0, timeout: 5000 }) });
    const block = descriptors.length ? await client.getBlock({ blockTag: "latest" }) : null;
    const start = Number(cursor ?? 0);
    const page = descriptors.slice(start, start + 20);
    const claims: LaunchClaimReadV1[] = await Promise.all(page.map(async (item): Promise<LaunchClaimReadV1> => {
      try {
        const [code, result] = await Promise.all([client.getCode({ address: item.descriptor.accrualContract, blockNumber: block!.number }),
          client.call({ account: item.descriptor.requiredController, to: item.descriptor.accrualContract, data: item.descriptor.read.data, blockNumber: block!.number })]);
        if (!code || keccak256(code).toLowerCase() !== item.descriptor.runtimeCodeHash.toLowerCase()
          || !result.data || !/^0x[0-9a-f]{64}$/i.test(result.data)) throw new Error("Claim read changed");
        return { ...item, status: "ready", claimableRaw: BigInt(result.data).toString(), blockNumber: block!.number.toString() };
      } catch { return { ...item, status: "analysis_pending", claimableRaw: null, blockNumber: null }; }
    }));
    return Response.json({ schemaVersion: "programmable.launch-claim-page.v1", account: account.toLowerCase(), claims,
      nextCursor: start + page.length < descriptors.length ? String(start + page.length) : null },
      { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch { return Response.json({ error: "claims_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } }); }
}
