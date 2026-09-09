import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookie: vi.fn(),
  readToken: vi.fn(),
  readEthereumToken: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookie }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
}));
vi.mock("../lib/server/robinhood-index/read", () => ({
  readRobinhoodToken: mocks.readToken,
}));
vi.mock("../lib/server/ethereum-explore", () => ({
  readEthereumToken: mocks.readEthereumToken,
}));

import ExplorePage from "../app/explore/page";
import ExploreChainPage, { generateMetadata as exploreMetadata } from "../app/explore/[chain]/page";
import TokenPage, { generateMetadata as tokenMetadata } from "../app/token/[address]/page";
import { AppShell } from "../components/app-shell";
import { exploreChainIdFromSlug, exploreChainPath } from "../lib/explore-chain";
import { resolveTokenPage } from "../lib/server/token-page";
import { VIEW_CHAIN_COOKIE_NAME } from "../lib/view-chain";

const address = "0x1111111111111111111111111111111111111111";
const token = { tokenAddress: address, name: "Example token" };

beforeEach(() => {
  mocks.cookie.mockReset();
  mocks.readToken.mockReset().mockResolvedValue({ status: "ready", token: null, updatedAt: null });
  mocks.readEthereumToken.mockReset().mockResolvedValue({ chainId: 1, status: "ready", token: null, updatedAt: null });
});

describe("Explore chain routes", () => {
  it("starts the app shell on Robinhood instead of overriding the provider default", () => {
    expect(AppShell({ children: null }).props.initialViewChainId).toBe(4663);
    expect(AppShell({ children: null, initialViewChainId: 1 }).props.initialViewChainId).toBe(1);
  });

  it("ignores legacy automatically saved Ethereum but respects a new explicit choice", async () => {
    const cookieJar = new Map([["programmable-view-chain", "1"]]);
    mocks.cookie.mockImplementation((name: string) => {
      const value = cookieJar.get(name);
      return value ? { value } : undefined;
    });
    await expect(ExplorePage({ searchParams: Promise.resolve({}) }))
      .rejects.toThrow("REDIRECT:/explore/robinhood");
    expect(mocks.cookie).toHaveBeenCalledWith("programmable-view-chain-v2");

    cookieJar.set(VIEW_CHAIN_COOKIE_NAME, "1");
    await expect(ExplorePage({ searchParams: Promise.resolve({}) }))
      .rejects.toThrow("REDIRECT:/explore/ethereum");
  });

  it("opens Robinhood on a fresh visit and retains a deliberate Ethereum selection", async () => {
    await expect(ExplorePage({ searchParams: Promise.resolve({}) }))
      .rejects.toThrow("REDIRECT:/explore/robinhood");
    mocks.cookie.mockReturnValue({ value: "1" });
    await expect(ExplorePage({ searchParams: Promise.resolve({}) }))
      .rejects.toThrow("REDIRECT:/explore/ethereum");
  });

  it("preserves explicit legacy links independently of the saved preference", async () => {
    mocks.cookie.mockReturnValue({ value: "1" });
    await expect(ExplorePage({ searchParams: Promise.resolve({ chain: "4663" }) }))
      .rejects.toThrow("REDIRECT:/explore/robinhood");
    expect(mocks.cookie).not.toHaveBeenCalled();
    await expect(ExplorePage({ searchParams: Promise.resolve({ chain: "1" }) }))
      .rejects.toThrow("REDIRECT:/explore/ethereum");
  });

  it("rejects unsupported and repeated legacy chain parameters", async () => {
    for (const chain of ["8453", ["1", "4663"]]) {
      await expect(ExplorePage({ searchParams: Promise.resolve({ chain }) }))
        .rejects.toThrow("NOT_FOUND");
    }
  });

  it.each([
    ["robinhood", 4663, "Robinhood"],
    ["ethereum", 1, "Ethereum"],
  ] as const)("binds %s page, title and canonical to the same chain", async (slug, chainId, name) => {
    const props = { params: Promise.resolve({ chain: slug }) };
    expect(exploreChainIdFromSlug(slug)).toBe(chainId);
    expect((await ExploreChainPage(props)).props.chainId).toBe(chainId);
    expect(await exploreMetadata(props)).toMatchObject({
      title: `Explore ${name} · Programmable`,
      alternates: { canonical: exploreChainPath(chainId) },
    });
  });

  it("does not interpret arbitrary path segments as a chain", async () => {
    expect(exploreChainIdFromSlug("base")).toBeNull();
    await expect(ExploreChainPage({ params: Promise.resolve({ chain: "base" }) }))
      .rejects.toThrow("NOT_FOUND");
  });
});

describe("verified token routing", () => {
  it("resolves a clean URL from the exact Robinhood record independently of cookies", async () => {
    mocks.cookie.mockReturnValue({ value: "1" });
    mocks.readToken.mockResolvedValue({ status: "ready", token, updatedAt: null });
    expect(await resolveTokenPage(address)).toMatchObject({ chainId: 4663, token });
    expect(mocks.readToken).toHaveBeenCalledWith(address);
    expect(mocks.cookie).not.toHaveBeenCalled();
  });

  it("keeps explicit Ethereum authoritative even when the address exists on Robinhood", async () => {
    mocks.readToken.mockResolvedValue({ status: "ready", token, updatedAt: null });
    const ethereumResult = { chainId: 1, status: "ready", token: { ...token, name: "Ethereum token" }, updatedAt: null };
    mocks.readEthereumToken.mockResolvedValue(ethereumResult);
    expect(await resolveTokenPage(address, "1")).toEqual(ethereumResult);
    expect(mocks.readEthereumToken).toHaveBeenCalledExactlyOnceWith(address);
    expect(mocks.readToken).not.toHaveBeenCalled();
  });

  it("keeps explicit Robinhood links scoped even when the index is unavailable", async () => {
    mocks.readToken.mockResolvedValue({ status: "unavailable", token: null, updatedAt: null });
    expect(await resolveTokenPage(address, "4663")).toMatchObject({ chainId: 4663, token: null });
  });

  it("does not infer Ethereum from an unknown address or a Robinhood index failure", async () => {
    expect(await resolveTokenPage(address)).toEqual({ chainId: null });
    mocks.readToken.mockResolvedValue({ status: "unavailable", token: null, updatedAt: null });
    expect(await resolveTokenPage(address)).toEqual({ chainId: null });
  });

  it("rejects invalid or repeated chain values before reading a token", async () => {
    expect(await resolveTokenPage(address, "8453")).toBeNull();
    expect(await resolveTokenPage(address, ["1", "4663"])).toBeNull();
    expect(mocks.readToken).not.toHaveBeenCalled();
    expect(mocks.readEthereumToken).not.toHaveBeenCalled();
  });

  it("validates the address before reading any token data", async () => {
    await expect(TokenPage({
      params: Promise.resolve({ address: "not-an-address" }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow("NOT_FOUND");
    expect(mocks.readToken).not.toHaveBeenCalled();
    expect(mocks.readEthereumToken).not.toHaveBeenCalled();
  });

  it("uses the clean token URL as the canonical for old and new Robinhood links", async () => {
    mocks.readToken.mockResolvedValue({ status: "ready", token, updatedAt: null });
    for (const search of [{}, { chain: "4663" }]) {
      expect(await tokenMetadata({
        params: Promise.resolve({ address }),
        searchParams: Promise.resolve(search),
      })).toMatchObject({
        title: "Example token · Programmable",
        alternates: { canonical: `/token/${address}` },
      });
    }
  });
});
