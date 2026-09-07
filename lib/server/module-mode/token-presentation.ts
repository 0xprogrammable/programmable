import "server-only";

import { decodeFunctionResult, encodeFunctionData, type Hex } from "viem";
import { ROBINHOOD_MAINNET_RPC_URL } from "@/lib/chains";
import { uerc20ReadAbi } from "@/lib/onchain/abis";
import { buildTokenLinks } from "@/lib/onchain/metadata";
import { hasUnsafeDisplayCharacters, MAX_TOKEN_DESCRIPTION_BYTES, utf8ByteLength } from "@/lib/metadata-policy";
import { isRobinhoodModuleLaunch, type RobinhoodLaunch } from "@/lib/robinhood-launches";
import type { RobinhoodCoinPresentation } from "@/lib/robinhood-presentation";
import { safePublicImageUrl } from "@/lib/safe-public-image-url";

type Metadata = Pick<RobinhoodCoinPresentation, "imageUrl" | "description" | "links">;
const MAX_RESPONSE_BYTES = 1_000_000;
const labels = { website: "Website", x: "X", telegram: "Telegram", discord: "Discord", github: "GitHub", gitbook: "GitBook" };
const metadataData = encodeFunctionData({ abi: uerc20ReadAbi, functionName: "metadata" });
const creatorData = encodeFunctionData({ abi: uerc20ReadAbi, functionName: "creator" });

async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok || response.redirected || !response.body
    || response.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json"
    || Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) throw new Error("Token metadata unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("Token metadata response too large");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Optional artwork and links for identities already authenticated by the saved launch index. */
export async function readModuleTokenMetadata(tokens: readonly RobinhoodLaunch[]): Promise<Map<string, Metadata>> {
  const native = tokens.filter(isRobinhoodModuleLaunch);
  if (native.length > 50) throw new Error("Too many token metadata reads");
  const batches = Array.from({ length: Math.ceil(native.length / 20) }, (_, index) => native.slice(index * 20, (index + 1) * 20));
  const signal = AbortSignal.timeout(5_000);
  const results = await Promise.allSettled(batches.map(async batch => {
    const calls = [{ jsonrpc: "2.0", id: 0, method: "eth_chainId", params: [] as unknown[] },
      ...batch.flatMap((token, index) => [metadataData, creatorData].map((data, field) => ({
        jsonrpc: "2.0", id: index * 2 + field + 1, method: "eth_call", params: [{ to: token.tokenAddress, data }, "latest"],
      })))];
    const raw = await responseJson(await fetch(ROBINHOOD_MAINNET_RPC_URL, {
      method: "POST", redirect: "error", cache: "no-store", signal,
      headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(calls),
    }));
    if (!Array.isArray(raw) || raw.length !== calls.length) throw new Error("Incomplete token metadata batch");
    const replies = new Map<number, Record<string, unknown>>();
    for (const row of raw) {
      if (!row || typeof row !== "object" || row.jsonrpc !== "2.0" || !Number.isSafeInteger(row.id)
        || row.id < 0 || row.id >= calls.length || replies.has(row.id)) throw new Error("Invalid token metadata batch");
      replies.set(row.id, row);
    }
    if (replies.get(0)?.result !== "0x1237" || replies.get(0)?.error) throw new Error("Token metadata chain mismatch");
    return batch.flatMap((token, index): [string, Metadata][] => {
      try {
        const metadata = replies.get(index * 2 + 1);
        const identity = replies.get(index * 2 + 2);
        if (metadata?.error || identity?.error || typeof metadata?.result !== "string" || typeof identity?.result !== "string") return [];
        const creator = decodeFunctionResult({ abi: uerc20ReadAbi, functionName: "creator", data: identity.result as Hex });
        if (creator.toLowerCase() !== token.sourceAddress.toLowerCase()) return [];
        const [description, website, image, extraData] = decodeFunctionResult({ abi: uerc20ReadAbi, functionName: "metadata", data: metadata.result as Hex });
        return [[token.tokenAddress.toLowerCase(), {
          imageUrl: safePublicImageUrl(image) ?? null,
          description: description && utf8ByteLength(description) <= MAX_TOKEN_DESCRIPTION_BYTES && !hasUnsafeDisplayCharacters(description) ? description : null,
          links: buildTokenLinks(website, extraData).map(link => ({ label: labels[link.kind], url: link.url })),
        }]];
      } catch { return []; }
    });
  }));
  return new Map(results.flatMap(result => result.status === "fulfilled" ? result.value : []));
}
