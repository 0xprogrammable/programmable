import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isAddress, type Address } from "viem";
import { ModuleCoinConsole } from "@/components/module-coin-console";
import { moduleModeCoinReleaseSelection, parseModuleModePageSelection } from "@/lib/module-mode/release-selection";
import { readRobinhoodToken } from "@/lib/server/robinhood-index/read";

export const metadata: Metadata = {
  title: "Coin controls · Module Mode · Programmable",
  description: "Manage your coin's module budgets, ETH claims and creator fee recipients.",
  robots: { index: false, follow: true },
};

export default async function ModuleCoinManagementPage({ params, searchParams }: { params: Promise<{ address: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { address } = await params;
  if (!isAddress(address, { strict: false }) || /^0x0{40}$/i.test(address)) notFound();
  const token = address.toLowerCase() as Address;
  let selection;
  try { selection = moduleModeCoinReleaseSelection(parseModuleModePageSelection(await searchParams), (await readRobinhoodToken(token)).token); } catch { notFound(); }
  if (selection.sourceKind) notFound();
  return <ModuleCoinConsole key={`${token}:${selection.releaseDigest ?? "current"}`} token={token} releaseDigest={selection.releaseDigest} />;
}
