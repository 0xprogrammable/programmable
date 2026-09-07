/** Website administration. Authentication and backend permissions remain required. */
export const WEBSITE_ADMIN_WALLET = "0x79879fe6f00c0986Ca521eA6F5b276b5E28b1b9C" as const;

export function isWebsiteAdminWallet(wallet: string | null | undefined): boolean {
  return typeof wallet === "string"
    && wallet.toLowerCase() === WEBSITE_ADMIN_WALLET.toLowerCase();
}
