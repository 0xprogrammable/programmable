import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isAddress } from "viem";

import { TokenIndexResetView } from "@/components/token-index-reset-view";
import { RobinhoodTokenView } from "@/components/robinhood-token-view";
import { EthereumTokenView } from "@/components/ethereum-token-view";
import { TokenRouteChainSync } from "@/components/token-route-chain-sync";
import { resolveTokenPage } from "@/lib/server/token-page";
import { genericTokenDetailMetadata } from "@/lib/token-detail-metadata";
import { tokenDetailPageChainId } from "@/lib/token-page-chain";
import { robinhoodLaunchDescription } from "@/lib/robinhood-launches";

type TokenPageSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ address: string }>;
  searchParams: TokenPageSearchParams;
}): Promise<Metadata> {
  const [{ address }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);
  if (isAddress(address) && tokenDetailPageChainId(resolvedSearchParams.chain) !== null) {
    const resolved = await resolveTokenPage(address, resolvedSearchParams.chain);
    if (resolved?.chainId === 1 && resolved.token) return {
      title: `${resolved.token.name || address} · Programmable`,
      description: resolved.token.description || "Verified Programmable launch on Ethereum.",
      alternates: { canonical: `/token/${resolved.token.tokenAddress}?chain=1` },
    };
    const token = resolved?.chainId === 4663 ? resolved.token : null;
    if (token) return {
      title: `${token.name || address} · Programmable`,
      description: robinhoodLaunchDescription(token),
      alternates: { canonical: `/token/${token.tokenAddress}` },
    };
  }
  return genericTokenDetailMetadata(address, true, tokenDetailPageChainId(resolvedSearchParams.chain) ?? 1);
}

export default async function TokenPage({
  params,
  searchParams,
}: {
  params: Promise<{ address: string }>;
  searchParams: TokenPageSearchParams;
}) {
  const [{ address }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);
  if (
    !isAddress(address) ||
    tokenDetailPageChainId(resolvedSearchParams.chain) === null
  ) {
    notFound();
  }
  const resolved = await resolveTokenPage(address, resolvedSearchParams.chain);
  if (resolved === null) notFound();
  if (resolved.chainId === 4663) {
    return <TokenRouteChainSync key={4663} chainId={4663}>
      <RobinhoodTokenView address={address} token={resolved.token} status={resolved.status} />
    </TokenRouteChainSync>;
  }
  if (resolved.chainId === 1) {
    return <TokenRouteChainSync key={1} chainId={1}><EthereumTokenView address={address} token={resolved.token} status={resolved.status} updatedAt={resolved.updatedAt} /></TokenRouteChainSync>;
  }
  return <TokenIndexResetView unresolved />;
}
