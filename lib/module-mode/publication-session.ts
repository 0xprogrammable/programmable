import { isWebsiteAdminWallet } from "../admin-access";

/** A fresh object for each authenticated wallet/session generation. Contains no credentials. */
export type PublicationSession = Readonly<{ walletAddress: string }>;
export type PublicationSessionExportResult = "downloaded" | "busy" | "session-changed" | "unavailable";
type ExportInput = Readonly<{
  readSession: () => PublicationSession | null;
  getIdentityToken: () => Promise<string | null>;
  getAccessToken: () => Promise<string | null>;
  download: (json: string) => void;
}>;
const tokenPattern = /^[A-Za-z0-9_.-]{20,16384}$/u;

/** Local serialization only. The original operator still authenticates every private BFF read. */
export function createPublicationSessionExporter() {
  let pending = false;
  return async (input: ExportInput): Promise<PublicationSessionExportResult> => {
    // This lock is synchronous, before token access or the first await.
    if (pending) return "busy";
    pending = true;
    try {
      const session = input.readSession();
      if (!session || !isWebsiteAdminWallet(session.walletAddress)) return "session-changed";
      const isCurrent = () => input.readSession() === session && isWebsiteAdminWallet(session.walletAddress);
      if (!isCurrent()) return "session-changed";
      // Identity tokens are optional in the existing operator format.
      const identityToken = await input.getIdentityToken().catch(() => null);
      if (!isCurrent()) return "session-changed";
      const accessToken = await input.getAccessToken();
      if (!isCurrent()) return "session-changed";
      if (typeof accessToken !== "string" || !tokenPattern.test(accessToken)
        || (identityToken !== null && (typeof identityToken !== "string" || !tokenPattern.test(identityToken)))) return "unavailable";
      const text = JSON.stringify({ walletAddress: session.walletAddress.toLowerCase(), accessToken,
        ...(identityToken === null ? {} : { identityToken }) });
      // Match readOperatorSession's closed JSON, token bounds and complete file-size limit.
      if (new TextEncoder().encode(text).byteLength > 32_768) return "unavailable";
      if (!isCurrent()) return "session-changed";
      input.download(text);
      return "downloaded";
    } catch {
      // SDK errors may contain credentials. Only fixed result codes leave this helper.
      return "unavailable";
    } finally {
      pending = false;
    }
  };
}
