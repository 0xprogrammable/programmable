import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isAddress, type Address } from "viem";
import { ModuleCoinConsole } from "@/components/module-coin-console";

export const metadata: Metadata = {
  title: "Coin controls · Module Mode · Programmable",
  description: "Manage your coin's module budgets, ETH claims and creator fee recipients.",
  robots: { index: false, follow: true },
};

export default async function ModuleCoinManagementPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address, { strict: false }) || /^0x0{40}$/i.test(address)) notFound();
  return <ModuleCoinConsole token={address.toLowerCase() as Address} />;
}
