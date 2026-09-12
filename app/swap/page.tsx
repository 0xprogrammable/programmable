import type { Metadata } from "next";
import { SwapPanel } from "@/components/swap-panel";

export const metadata: Metadata = {
  title: "Swap · Programmable",
  description: "Buy and sell Programmable coins with ETH. Enter a coin address to find its trading route.",
  alternates: { canonical: "/swap" },
};

export default async function SwapPage({ searchParams }: {
  searchParams: Promise<{ token?: string | string[]; chain?: string | string[] }>;
}) {
  const query = await searchParams;
  return <SwapPanel initialAddress={typeof query.token === "string" ? query.token : ""}
    initialChainId={query.chain === "1" ? 1 : 4663} />;
}
