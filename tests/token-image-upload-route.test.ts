import type { PutBlobResult } from "@vercel/blob";
import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createTokenImageUploadHandlerV1,
  readProductionTokenImageBlobV1,
  type TokenImageUploadHandlerDependenciesV1,
} from "../app/api/token-image/handler";
import type {
  SignedTokenImageUploadReceiptV1,
} from "../lib/custom-launch/token-image-upload-receipt-v1";
import type {
  TokenImageUploadReceiptSignerV1,
} from "../lib/server/token-image-upload-receipt-v1";
import {
  PROGRAMMABLE_TOKEN_IMAGE_HOST,
} from "../lib/token-image";

const BLOB_URL = `https://${PROGRAMMABLE_TOKEN_IMAGE_HOST}/token-images/example.webp`;
const BLOB: PutBlobResult = Object.freeze({
  url: BLOB_URL,
  downloadUrl: `${BLOB_URL}?download=1`,
  pathname: "token-images/example.webp",
  contentType: "image/webp",
  contentDisposition: "inline",
  etag: "etag-1",
});
const SCOPE = JSON.stringify({
  applicationId: "application-1",
  applicationHandle: `github-${"a".repeat(64)}`,
  grantId: "123e4567-e89b-42d3-a456-426614174002",
  grantBindingHash: `sha256:${"33".repeat(32)}`,
});

let webp: Uint8Array;
let jpeg: Uint8Array;

beforeAll(async () => {
  webp = await sharp({
    create: {
      width: 1_000,
      height: 1_000,
      channels: 4,
      background: { r: 21, g: 32, b: 43, alpha: 1 },
    },
  }).webp().toBuffer();
  jpeg = await sharp({
    create: {
      width: 1_000,
      height: 1_000,
      channels: 3,
      background: { r: 21, g: 32, b: 43 },
    },
  }).jpeg().toBuffer();
});

describe("token image upload route", () => {
  it("returns a JSON session error before reading or writing image data", async () => {
    const putBlob = vi.fn<Dependencies["putBlob"]>();
    const handler = createTokenImageUploadHandlerV1(dependencies({
      authenticateSession: async () => null,
      putBlob,
    }));
    const response = await handler(request(webp));
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.json()).resolves.toEqual({
      error: "Connect your wallet and try again",
    });
    expect(putBlob).not.toHaveBeenCalled();
  });

  it("rejects JPEG bytes relabelled as WebP before Blob write", async () => {
    const putBlob = vi.fn<Dependencies["putBlob"]>();
    const handler = createTokenImageUploadHandlerV1(dependencies({ putBlob }));
    const response = await handler(request(jpeg));
    expect(response.status).toBe(400);
    expect(putBlob).not.toHaveBeenCalled();
  });

  it("requires a configured managed signer before a scoped Blob write", async () => {
    const putBlob = vi.fn<Dependencies["putBlob"]>();
    const handler = createTokenImageUploadHandlerV1(dependencies({
      putBlob,
      prepareReceiptSigner: async () => {
        throw new TypeError("unconfigured");
      },
    }));
    const response = await handler(request(webp, true));
    expect(response.status).toBe(503);
    expect(putBlob).not.toHaveBeenCalled();
  });

  it("rejects foreign Privy principal before a scoped Blob write", async () => {
    const putBlob = vi.fn<Dependencies["putBlob"]>();
    const handler = createTokenImageUploadHandlerV1(dependencies({
      putBlob,
      authenticatePrincipal: async () => ({
        privyUserId: "did:privy:other",
        githubUserId: "123",
        githubUsername: "project",
        githubPrincipalHash: `sha256:${"22".repeat(32)}`,
      }),
    }));
    const response = await handler(request(webp, true));
    expect(response.status).toBe(403);
    expect(putBlob).not.toHaveBeenCalled();
  });

  it("does not issue a receipt when readback bytes, ETag or URL differ", async () => {
    for (const readBlob of [
      async () => ({ ...readback(webp), bytes: Uint8Array.from([...webp, 0]) }),
      async () => ({ ...readback(webp), etag: "etag-2" }),
      async () => ({ ...readback(webp), url: `${BLOB_URL}.other` }),
    ]) {
      const signer = signerStub();
      const handler = createTokenImageUploadHandlerV1(dependencies({
        readBlob,
        prepareReceiptSigner: async () => signer,
      }));
      const response = await handler(request(webp, true));
      expect(response.status).toBe(502);
      expect(signer.sign).not.toHaveBeenCalled();
    }
  });

  it("does not publish a receipt when readback times out", async () => {
    const signer = signerStub();
    const handler = createTokenImageUploadHandlerV1(dependencies({
      readbackTimeoutMs: 5,
      readBlob: async (_blob, signal) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        void resolve;
      }),
      prepareReceiptSigner: async () => signer,
    }));
    const response = await handler(request(webp, true));
    expect(response.status).toBe(502);
    expect(signer.sign).not.toHaveBeenCalled();
  });

  it("rejects a redirected, oversized or wrong-type production readback", async () => {
    for (const response of [
      ({ redirected: true, status: 200, url: BLOB_URL }) as Response,
      new Response(Uint8Array.from(webp).buffer, {
        status: 200,
        headers: {
          "content-type": "image/webp",
          "content-length": "1000001",
          etag: "etag-1",
        },
      }),
      new Response(Uint8Array.from(webp).buffer, {
        status: 200,
        headers: { "content-type": "image/jpeg", etag: "etag-1" },
      }),
    ]) {
      await expect(readProductionTokenImageBlobV1(
        BLOB,
        new AbortController().signal,
        async () => response,
      )).rejects.toThrow();
    }
  });

  it("publishes the exact remotely signed receipt only after valid readback", async () => {
    const receipt = {
      schemaVersion: "programmable.signed-token-image-upload-receipt.v1",
    } as SignedTokenImageUploadReceiptV1;
    const signer = signerStub(receipt);
    const handler = createTokenImageUploadHandlerV1(dependencies({
      prepareReceiptSigner: async () => signer,
    }));
    const response = await handler(request(webp, true));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ url: BLOB_URL, receipt });
    expect(signer.sign).toHaveBeenCalledWith(expect.objectContaining({
      launchScope: expect.objectContaining({ applicationId: "application-1" }),
      blob: expect.objectContaining({
        url: BLOB_URL,
        etag: "etag-1",
      }),
      image: expect.objectContaining({
        byteLength: webp.byteLength,
        width: 1_000,
        height: 1_000,
        mediaType: "image/webp",
      }),
    }));
  });
});

type Dependencies = TokenImageUploadHandlerDependenciesV1;

function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    blobToken: "blob-token",
    authenticateSession: async () => ({ privyUserId: "did:privy:user-1" }),
    authenticatePrincipal: async () => ({
      privyUserId: "did:privy:user-1",
      githubUserId: "123",
      githubUsername: "project",
      githubPrincipalHash: `sha256:${"22".repeat(32)}`,
    }),
    prepareReceiptSigner: async () => signerStub(),
    putBlob: async () => BLOB,
    readBlob: async () => readback(webp),
    ...overrides,
  };
}

function request(bytes: Uint8Array, scoped = false): Request {
  const form = new FormData();
  form.append("file", new File(
    [Uint8Array.from(bytes).buffer],
    "image.webp",
    { type: "image/webp" },
  ));
  if (scoped) form.append("receiptScope", SCOPE);
  return new Request("https://programmable.example/api/token-image", {
    method: "POST",
    headers: {
      authorization: "Bearer access-token",
      "x-privy-identity-token": "identity-token",
    },
    body: form,
  });
}

function readback(bytes: Uint8Array) {
  return Object.freeze({
    url: BLOB_URL,
    etag: "etag-1",
    contentType: "image/webp",
    bytes: Uint8Array.from(bytes),
  });
}

function signerStub(receipt = {} as SignedTokenImageUploadReceiptV1):
TokenImageUploadReceiptSignerV1 {
  return {
    binding: {} as TokenImageUploadReceiptSignerV1["binding"],
    sign: vi.fn(async () => receipt),
  };
}
