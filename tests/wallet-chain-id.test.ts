import { describe, expect, it } from "vitest";

import { normalizeWalletChainId, parseWalletChainId, walletChainIdsEqual } from "@/lib/wallet-chain-id";

describe("wallet chain IDs", () => {
  it("recognizes the same Robinhood chain from provider and SDK representations", () => {
    const variants = [4663, "4663", "0x1237", "0x01237", "0X1237", "eip155:4663"];
    for (const value of variants) {
      expect(parseWalletChainId(value)).toBe(4663);
      expect(normalizeWalletChainId(value)).toBe("0x1237");
      for (const other of variants) expect(walletChainIdsEqual(value, other)).toBe(true);
    }
  });

  it("preserves positive chain IDs across the safe integer range", () => {
    for (const chainId of [1, 10, 11155111, Number.MAX_SAFE_INTEGER]) {
      const hex = `0x${chainId.toString(16)}`;
      for (const value of [chainId, String(chainId), hex.toUpperCase(), `eip155:${chainId}`]) {
        expect(parseWalletChainId(value)).toBe(chainId);
        expect(normalizeWalletChainId(value)).toBe(hex);
        expect(walletChainIdsEqual(value, chainId)).toBe(true);
      }
    }
  });

  it("never treats a different valid chain as Robinhood", () => {
    for (const value of [1, "1", "0x1", "eip155:1", 4664, "0x1238"]) {
      expect(walletChainIdsEqual(value, 4663)).toBe(false);
      expect(walletChainIdsEqual("eip155:4663", value)).toBe(false);
    }
  });

  it("rejects malformed, nonpositive and unsafe IDs instead of rounding or coercing", () => {
    const invalid: unknown[] = [
      null, undefined, true, false, {}, [], [4663], 4663n,
      { toString: () => "4663", valueOf: () => 4663 },
      0, -0, -1, 4663.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1, Number.MAX_VALUE,
      "", "0", "00", "04663", "-4663", "+4663", "4663.0", "4.663e3", "4663n",
      "4663garbage", "4663\u0000", "0b1001000110111", "0o11067", "0x", "0x0", "0x0000", "0x123g",
      "9007199254740992", "9007199254740993", "0x20000000000000", "eip155:9007199254740992",
      "eip155:", "eip155:0", "eip155:04663", "eip155:0x1237", "eip155:4663:extra", "EIP155:4663", "other:4663",
    ];
    for (const value of invalid) {
      expect(parseWalletChainId(value)).toBeNull();
      expect(normalizeWalletChainId(value)).toBeNull();
      expect(walletChainIdsEqual(value, 4663)).toBe(false);
      expect(walletChainIdsEqual(4663, value)).toBe(false);
      expect(walletChainIdsEqual(value, value)).toBe(false);
    }
  });

  it("rejects surrounding or internal whitespace in every string format", () => {
    for (const value of ["4663", "0x1237", "eip155:4663"]) {
      for (const whitespace of [" ", "\t", "\n", "\r\n", "\u00a0", "\u2028", "\ufeff"]) {
        for (const malformed of [`${whitespace}${value}`, `${value}${whitespace}`, `${value.slice(0, 2)}${whitespace}${value.slice(2)}`]) {
          expect(parseWalletChainId(malformed)).toBeNull();
          expect(walletChainIdsEqual(malformed, 4663)).toBe(false);
        }
      }
    }
    expect(parseWalletChainId("eip155: 4663")).toBeNull();
    expect(parseWalletChainId("eip155:\n4663")).toBeNull();
  });
});
