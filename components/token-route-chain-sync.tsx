"use client";

import { type ReactNode } from "react";

import {
  useRouteViewChain,
  type ViewChainId,
} from "@/components/view-chain";

export function TokenRouteChainSync({
  chainId,
  children,
}: Readonly<{
  chainId: ViewChainId;
  children: ReactNode;
}>) {
  useRouteViewChain(chainId);

  return children;
}
