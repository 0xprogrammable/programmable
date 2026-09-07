import { describe, expect, it, vi } from "vitest";
import { sha256 } from "viem";

import { assertModuleModeWalletUnchanged, isModuleModeChain, isModuleModeWalletRejection, moduleModeSubmissionIsUncertain, moduleModeWalletStep, switchModuleModeNetwork, uploadModuleModeImage } from "@/components/module-mode-wallet-state";
import { PROGRAMMABLE_TOKEN_IMAGE_HOST } from "@/lib/token-image";

const account = `0x${"12".repeat(20)}`;
const connected = { account, chainId: "0x1237", authenticated: true, sessionReady: true };

describe("Module Mode wallet boundary", () => {
  it("switches through the wallet context's decimal network contract before allowing preparation", async () => {
    const state = { ...connected, chainId: "0x1" };
    const switchNetwork = vi.fn(async (chainId: string) => {
      // Match the public wallet context: RPC hex IDs are not accepted as network requests.
      if (chainId !== "4663") return false;
      state.chainId = "0x1237";
      return true;
    });
    expect(moduleModeWalletStep(state)).toBe("switch");
    await switchModuleModeNetwork(switchNetwork);
    expect(switchNetwork).toHaveBeenCalledOnce();
    expect(moduleModeWalletStep(state)).toBe("prepare");
  });

  it("reports a refused network change and preserves thrown wallet errors", async () => {
    await expect(switchModuleModeNetwork(async () => false)).rejects.toThrow("network change was not completed");
    const rejected = new Error("Network change cancelled.");
    await expect(switchModuleModeNetwork(async () => { throw rejected; })).rejects.toBe(rejected);
    expect(moduleModeWalletStep({ ...connected, chainId: "0x1" })).toBe("switch");
  });

  it("requires explicit connection and the actual Robinhood wallet chain before preparation", () => {
    expect(moduleModeWalletStep({ ...connected, authenticated: false })).toBe("connect");
    expect(moduleModeWalletStep({ ...connected, sessionReady: false })).toBe("connect");
    expect(moduleModeWalletStep({ ...connected, account: undefined })).toBe("connect");
    expect(moduleModeWalletStep({ ...connected, chainId: "0x1" })).toBe("switch");
    expect(moduleModeWalletStep(connected)).toBe("prepare");
    for (const chainId of ["0x1237", "4663"]) expect(isModuleModeChain(chainId)).toBe(true);
    for (const chainId of [undefined, "0x1", " 4663", "4663.0", "4.663e3", "0x", "banana"]) expect(isModuleModeChain(chainId)).toBe(false);
  });

  it("invalidates an intent when the wallet, network or authenticated session changes", () => {
    expect(() => assertModuleModeWalletUnchanged(connected, account)).not.toThrow();
    for (const changed of [{ ...connected, account: `0x${"13".repeat(20)}` }, { ...connected, chainId: "0x1" }, { ...connected, authenticated: false }]) {
      expect(() => assertModuleModeWalletUnchanged(changed, account)).toThrow("wallet or network changed");
    }
  });

  it("distinguishes definite wallet rejection from ambiguous submission failures", () => {
    expect(isModuleModeWalletRejection({ cause: { code: 4001 } })).toBe(true);
    expect(isModuleModeWalletRejection({ name: "UserRejectedRequestError" })).toBe(true);
    expect(isModuleModeWalletRejection(new Error("network timeout"))).toBe(false);
    expect(isModuleModeWalletRejection({ code: -32603 })).toBe(false);
    const circular = { cause: {} }; circular.cause = circular;
    expect(isModuleModeWalletRejection(circular)).toBe(false);
    expect(moduleModeSubmissionIsUncertain(new Error("RPC timed out"), true)).toBe(true);
    expect(moduleModeSubmissionIsUncertain({ walletRequestAttempted: true }, true)).toBe(true);
    expect(moduleModeSubmissionIsUncertain({ walletRequestAttempted: false }, true)).toBe(false);
    expect(moduleModeSubmissionIsUncertain({ walletRequestAttempted: true, walletRequestRejected: true }, true)).toBe(false);
    expect(moduleModeSubmissionIsUncertain({ code: 4001 }, true)).toBe(false);
    expect(moduleModeSubmissionIsUncertain(new Error("preparation failed"), false)).toBe(false);
  });

  it("uploads exact reviewed WebP bytes through the authenticated image endpoint", async () => {
    const blob = new Blob([new Uint8Array([82, 73, 70, 70])], { type: "image/webp" });
    const image = { kind: "local" as const, sha256: sha256(new Uint8Array(await blob.arrayBuffer())), bytes: blob.size, mimeType: "image/webp" as const };
    const uri = `https://${PROGRAMMABLE_TOKEN_IMAGE_HOST}/token-images/test.webp`;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ url: uri }));
    const guard = vi.fn();
    const result = await uploadModuleModeImage({ image, blob, getAccessToken: async () => "test-token", assertCurrentSession: guard, fetcher });
    expect(result).toEqual({ uri, sourceSha256: image.sha256 });
    expect(image).not.toHaveProperty("uri");
    expect(fetcher).toHaveBeenCalledWith("/api/token-image", expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer test-token" }, credentials: "same-origin", redirect: "error" }));
    const body = fetcher.mock.calls[0][1]?.body as FormData;
    expect((body.get("file") as File).type).toBe("image/webp");
    expect(guard.mock.calls.length).toBeGreaterThan(2);
  });

  it("never uploads changed bytes, an unauthenticated image, or a URI draft", async () => {
    const blob = new Blob(["original"], { type: "image/webp" });
    const image = { kind: "local" as const, sha256: sha256(new Uint8Array(await blob.arrayBuffer())), bytes: blob.size, mimeType: "image/webp" as const };
    const fetcher = vi.fn<typeof fetch>();
    const common = { image, blob, getAccessToken: async () => "test-token", assertCurrentSession: () => {}, fetcher };
    await expect(uploadModuleModeImage({ ...common, blob: new Blob(["modified"], { type: "image/webp" }) })).rejects.toThrow("image changed");
    await expect(uploadModuleModeImage({ ...common, blob: undefined })).rejects.toThrow("does not match");
    await expect(uploadModuleModeImage({ ...common, getAccessToken: async () => null })).rejects.toThrow("Reconnect");
    await expect(uploadModuleModeImage({ ...common, assertCurrentSession: () => { throw new Error("wallet changed"); } })).rejects.toThrow("wallet changed");
    expect(await uploadModuleModeImage({ ...common, image: { kind: "uri", uri: "https://example.com/token.webp", contentVerified: false } })).toEqual({ uri: "https://example.com/token.webp" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects redirected, non-JSON, external and failed image responses", async () => {
    const blob = new Blob(["image"], { type: "image/webp" });
    const image = { kind: "local" as const, sha256: sha256(new Uint8Array(await blob.arrayBuffer())), bytes: blob.size, mimeType: "image/webp" as const };
    for (const response of [Response.json({ url: "https://example.com/x.webp" }), new Response("<html>login</html>"), Response.json({ error: "expired" }, { status: 401 })]) {
      await expect(uploadModuleModeImage({ image, blob, getAccessToken: async () => "test-token", assertCurrentSession: () => {}, fetcher: vi.fn<typeof fetch>().mockResolvedValue(response) })).rejects.toThrow();
    }
  });
});
