import "server-only";
import { cache } from "react";

import { readRobinhoodToken } from "@/lib/server/robinhood-index/read";
import { readEthereumToken } from "@/lib/server/ethereum-explore";
import { tokenDetailPageChainId } from "@/lib/token-page-chain";

// A clean address URL resolves only from a verified Robinhood launch record.
// Explicit chain links remain authoritative, including Ethereum addresses that
// may also exist on Robinhood. Browser preferences never select token identity.
export const resolveTokenPage = cache(async (address: string, explicitChain?: string | string[]) => {
  const chainId = tokenDetailPageChainId(explicitChain);
  if (chainId === null) return null;
  if (explicitChain === "1") return readEthereumToken(address);

  const robinhood = await readRobinhoodToken(address);
  if (explicitChain === "4663" || robinhood.token !== null) {
    return { ...robinhood, chainId: 4663 as const };
  }
  return { chainId: null };
});
