import { sha256, type Hex } from "viem";

import type { ModuleModeDraft } from "@/lib/module-mode/builder";
import { isProgrammableTokenImageUrl, readTokenImageUploadResponse } from "@/lib/token-image";

export interface ModuleModeWalletSnapshot {
  account?: string;
  chainId?: string;
  authenticated: boolean;
  sessionReady: boolean;
}

export function isModuleModeChain(chainId: string | undefined) {
  return Boolean(chainId && /^(?:0x[0-9a-f]+|[1-9]\d*)$/i.test(chainId) && BigInt(chainId) === 4663n);
}

export function moduleModeWalletStep(wallet: ModuleModeWalletSnapshot): "connect" | "switch" | "prepare" {
  if (!wallet.authenticated || !wallet.sessionReady || !wallet.account) return "connect";
  return isModuleModeChain(wallet.chainId) ? "prepare" : "switch";
}

export function assertModuleModeWalletUnchanged(current: ModuleModeWalletSnapshot, expectedAccount: string) {
  if (moduleModeWalletStep(current) !== "prepare" || current.account?.toLowerCase() !== expectedAccount.toLowerCase()) {
    throw new Error("Your wallet or network changed. Return to the draft and prepare again with the current wallet.");
  }
}

/** Only a definite user rejection permits a fresh send attempt without reconciliation. */
export function isModuleModeWalletRejection(error: unknown): boolean {
  let current = error;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { code?: unknown; name?: unknown; cause?: unknown; walletRequestRejected?: unknown };
    if (candidate.code === 4001 || candidate.code === "4001" || candidate.name === "UserRejectedRequestError" || candidate.walletRequestRejected === true) return true;
    current = candidate.cause;
  }
  return false;
}

export function moduleModeSubmissionIsUncertain(error: unknown, providerCalled: boolean) {
  if (!providerCalled || isModuleModeWalletRejection(error)) return false;
  return (error as { walletRequestAttempted?: unknown } | null)?.walletRequestAttempted !== false;
}

/** Upload only the exact prepared file that the user reviewed. No draft mutation. */
export async function uploadModuleModeImage(input: {
  image: ModuleModeDraft["token"]["image"];
  blob?: Blob;
  getAccessToken: () => Promise<string | null>;
  assertCurrentSession: () => void;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<{ uri: string; sourceSha256?: Hex }> {
  input.assertCurrentSession();
  if (input.image.kind === "uri") return { uri: input.image.uri };
  const blob = input.blob;
  if (!blob || blob.type !== input.image.mimeType || blob.size !== input.image.bytes) {
    throw new Error("The prepared image does not match your draft. Choose the image again.");
  }
  const digest = sha256(new Uint8Array(await blob.arrayBuffer()));
  if (digest !== input.image.sha256) throw new Error("The image changed after review. Choose the image again before launching.");
  input.assertCurrentSession();
  const accessToken = await input.getAccessToken();
  input.assertCurrentSession();
  if (!accessToken) throw new Error("Reconnect your wallet to upload the token image.");
  const form = new FormData();
  form.append("file", new File([blob], "token-image.webp", { type: "image/webp" }));
  const response = await (input.fetcher ?? fetch)("/api/token-image", {
    method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: form,
    credentials: "same-origin", redirect: "error", signal: input.signal,
  });
  const body = await readTokenImageUploadResponse(response);
  input.assertCurrentSession();
  if (!response.ok || typeof body?.url !== "string" || !isProgrammableTokenImageUrl(body.url)) {
    throw new Error(response.status === 401 ? "Your session expired. Reconnect your wallet before preparing again." : "The token image could not be published. Your draft and original image are kept; try preparing again.");
  }
  return { uri: body.url, sourceSha256: digest };
}
